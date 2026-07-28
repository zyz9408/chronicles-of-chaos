import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../../engine/types';
import { findNearDuplicateStoryThreads } from '../../engine/worldline/StoryPackTooling';
import { buildWorldlineKnowledgeProjection } from '../../engine/worldline/WorldlineKnowledgeProjection';
import { threeKingdomsGenericStoryPack } from './storyPack';
import { THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS } from './storyPackBatch1Content';
import { THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS } from './storyPackBatch2Content';
import {
  THREE_KINGDOMS_STORY_PACK_BATCH_3_BLUEPRINTS,
  THREE_KINGDOMS_STORY_PACK_BATCH_3_DRAMA_FUNCTIONS,
  THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS,
} from './storyPackBatch3Content';
import {
  buildThreeKingdomsStoryPackCoverage,
  validateThreeKingdomsStoryPack,
} from './storyPackBuilder';
import {
  THREE_KINGDOMS_STORY_DOMAINS,
  THREE_KINGDOMS_STORY_ERA_BANDS,
  THREE_KINGDOMS_STORY_REGIONS,
  THREE_KINGDOMS_STORY_ROLE_PERSPECTIVES,
} from './storyPackCatalog';

function makeState(currentDate = '公元220年04月01日 08:00（辰时）'): RuntimeState {
  return {
    worldBookId: 'threeKingdoms',
    currentDate,
    currentLocationId: 'location_unknown',
    npcs: [],
    activeQuests: [],
    knownRumors: [],
    worldTrends: [],
  } as unknown as RuntimeState;
}

function motifKey(thread: {
  domain?: string;
  subdomain?: string;
  motifId?: string;
}): string {
  return `${thread.domain}/${thread.subdomain}/${thread.motifId}`;
}

describe('Three Kingdoms StoryPack Batch 3', () => {
  it('preserves exactly 80 motifs and 400 five-function threads in the expanded pack', () => {
    expect(THREE_KINGDOMS_STORY_PACK_BATCH_3_BLUEPRINTS).toHaveLength(16);
    expect(THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS).toHaveLength(400);
    expect(threeKingdomsGenericStoryPack.version).toBe('0.5.0');
    expect(threeKingdomsGenericStoryPack.threads).toHaveLength(1500);
    expect(threeKingdomsGenericStoryPack.threads.slice(600, 1000))
      .toEqual(THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS);

    const motifKeys = new Set(THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS.map(motifKey));
    expect(motifKeys.size).toBe(80);

    for (const key of motifKeys) {
      const quintet = THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS
        .filter((thread) => motifKey(thread) === key);
      expect(quintet).toHaveLength(5);
      expect(new Set(quintet.map((thread) => thread.facet)))
        .toEqual(new Set(THREE_KINGDOMS_STORY_PACK_BATCH_3_DRAMA_FUNCTIONS));
      expect(new Set(quintet.map((thread) => thread.title)).size).toBe(5);
      expect(new Set(quintet.map((thread) => thread.summary)).size).toBe(5);
      expect(new Set(quintet.flatMap((thread) => thread.rolePerspectives ?? [])).size).toBe(5);
      expect(new Set(quintet.map((thread) => thread.escalationShapes?.join('|'))).size).toBe(5);
    }
  });

  it('adds five motifs and 25 threads to every catalog domain', () => {
    const catalogDomains = THREE_KINGDOMS_STORY_DOMAINS.map((domain) => domain.id).sort();
    const blueprintDomains = THREE_KINGDOMS_STORY_PACK_BATCH_3_BLUEPRINTS
      .map((domain) => domain.domain)
      .sort();
    expect(blueprintDomains).toEqual(catalogDomains);

    for (const domain of THREE_KINGDOMS_STORY_PACK_BATCH_3_BLUEPRINTS) {
      expect(domain.motifs).toHaveLength(5);
      const threads = THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS
        .filter((thread) => thread.domain === domain.domain);
      expect(threads).toHaveLength(25);
      expect(new Set(threads.map((thread) => thread.motifId)).size).toBe(5);
    }
  });

  it('adds 375 dramaMotif threads and 25 structured aftermath threads', () => {
    const dramaMotifs = THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS
      .filter((thread) => thread.kind === 'dramaMotif');
    const aftermath = THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS
      .filter((thread) => thread.kind === 'aftermath');

    expect(dramaMotifs).toHaveLength(375);
    expect(dramaMotifs.every((thread) => thread.domain !== 'aftermath_transition')).toBe(true);
    expect(aftermath).toHaveLength(25);
    expect(aftermath.every((thread) => thread.domain === 'aftermath_transition')).toBe(true);
    expect(aftermath.every((thread) => thread.entrySignals?.every((signal) => (
      signal.startsWith('aftermath:')
      || signal.startsWith('combat:')
      || signal.startsWith('war:')
      || signal.startsWith('disaster:')
      || signal.startsWith('regime:')
      || signal.startsWith('matter:resolved')
    )))).toBe(true);
  });

  it('passes full-pack validation, uniqueness, and 0.86 near-duplicate gates', () => {
    expect(validateThreeKingdomsStoryPack(threeKingdomsGenericStoryPack)).toEqual([]);
    expect(findNearDuplicateStoryThreads(threeKingdomsGenericStoryPack.threads, 0.86))
      .toEqual([]);

    const titles = new Set<string>();
    const summaries = new Set<string>();
    for (const thread of threeKingdomsGenericStoryPack.threads) {
      expect(titles.has(thread.title)).toBe(false);
      expect(summaries.has(thread.summary)).toBe(false);
      titles.add(thread.title);
      summaries.add(thread.summary);
    }
  }, 30_000);

  it('keeps Batch 1, 2, and 3 motif keys disjoint', () => {
    const batch1Motifs = new Set(THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS.map(motifKey));
    const batch2Motifs = new Set(THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS.map(motifKey));
    const batch3Motifs = new Set(THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS.map(motifKey));

    expect([...batch2Motifs].some((key) => batch1Motifs.has(key))).toBe(false);
    expect([...batch3Motifs].some((key) => batch1Motifs.has(key))).toBe(false);
    expect([...batch3Motifs].some((key) => batch2Motifs.has(key))).toBe(false);
  });

  it('preserves full catalog, era, region, and role-perspective coverage', () => {
    const report = buildThreeKingdomsStoryPackCoverage(threeKingdomsGenericStoryPack);
    expect(report.totalThreads).toBe(1500);
    expect(report.missingDomainIds).toEqual([]);
    expect(report.missingSubdomainIds).toEqual([]);

    for (const perspective of THREE_KINGDOMS_STORY_ROLE_PERSPECTIVES) {
      expect(THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS.some((thread) => (
        thread.rolePerspectives?.includes(perspective)
      ))).toBe(true);
    }
    for (const eraBand of THREE_KINGDOMS_STORY_ERA_BANDS) {
      expect(THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS.some((thread) => (
        thread.relatedTags?.includes(`era:${eraBand.id}`)
      ))).toBe(true);
    }
    for (const region of THREE_KINGDOMS_STORY_REGIONS) {
      expect(THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS.some((thread) => (
        thread.relatedTags?.includes(`region:${region}`)
      ))).toBe(true);
    }
  });

  it('keeps Batch 3 detached from named NPCs and authoritative writeback', () => {
    for (const thread of THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS) {
      expect(thread.relatedNpcNames).toBeUndefined();
      expect(thread.sourceRef).toEqual({
        providerId: threeKingdomsGenericStoryPack.id,
        sourceType: 'storyThread',
        sourceId: thread.id,
      });
      expect(thread.usageBoundary).toContain('候选');
      expect(thread.usageBoundary).toContain('不得');
      expect(thread.summary.length).toBeGreaterThanOrEqual(55);
    }
  });

  it.each([
    ['换防承诺哨位缺额值夜排班', '.military_camp.guard_duty.relief_watch_oath.'],
    ['临时桥过桥次序涨水期限', '.logistics.transport.bridge_crossing_priority.'],
    ['荐书截止相反评价名册封存', '.scholars_ritual.recommendation.recommendation_deadline_second_letter.'],
    ['互市散场日落封道安全通行', '.frontier_ethnic.frontier_trade.sunset_market_safe_passage.'],
    ['婚期逼近本人意愿迎亲出发', '.family_daily_life.marriage.wedding_deadline_missing_consent.'],
    ['disaster:resolved 灾后重建临时安置', '.aftermath_transition.reconstruction.displaced_household_cost_after_disaster.'],
  ])('projects the expected Batch 3 motif for pressure query %s', (query, idPart) => {
    const result = buildWorldlineKnowledgeProjection({
      state: makeState(),
      storyPacks: [threeKingdomsGenericStoryPack],
      mode: 'default',
      queryTexts: [query],
    });

    expect(result.hints.length).toBeGreaterThan(0);
    expect(result.hints.length).toBeLessThanOrEqual(4);
    expect(result.hints.some((hint) => hint.id.includes(idPart))).toBe(true);
  });

  it('uses one slot for a five-function motif and none for generic continue', () => {
    const specific = buildWorldlineKnowledgeProjection({
      state: makeState(),
      storyPacks: [threeKingdomsGenericStoryPack],
      mode: 'strict',
      queryTexts: ['临时桥过桥次序涨水期限验桥工匠'],
    });
    const generic = buildWorldlineKnowledgeProjection({
      state: makeState(),
      storyPacks: [threeKingdomsGenericStoryPack],
      mode: 'strict',
      queryTexts: ['继续'],
    });

    const bridgeHints = specific.hints.filter((hint) => (
      hint.id.includes('.logistics.transport.bridge_crossing_priority.')
    ));
    expect(bridgeHints).toHaveLength(1);
    expect(generic.hints).toEqual([]);
  });
});
