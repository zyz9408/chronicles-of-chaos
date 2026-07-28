import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../../engine/types';
import { findNearDuplicateStoryThreads } from '../../engine/worldline/StoryPackTooling';
import { buildWorldlineKnowledgeProjection } from '../../engine/worldline/WorldlineKnowledgeProjection';
import { threeKingdomsGenericStoryPack } from './storyPack';
import { THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS } from './storyPackBatch1Content';
import {
  THREE_KINGDOMS_STORY_PACK_BATCH_2_BLUEPRINTS,
  THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS,
} from './storyPackBatch2Content';
import {
  buildThreeKingdomsStoryPackCoverage,
  validateThreeKingdomsStoryPack,
} from './storyPackBuilder';
import {
  THREE_KINGDOMS_STORY_ERA_BANDS,
  THREE_KINGDOMS_STORY_REGIONS,
  THREE_KINGDOMS_STORY_ROLE_PERSPECTIVES,
} from './storyPackCatalog';

const PRIORITY_DOMAINS = new Set([
  'trade_market',
  'justice_security',
  'diplomacy_alliance',
  'frontier_ethnic',
  'scholars_ritual',
  'family_daily_life',
]);

function makeState(): RuntimeState {
  return {
    worldBookId: 'threeKingdoms',
    currentDate: '公元220年04月01日 08:00（辰时）',
    currentLocationId: 'location_unknown',
    npcs: [],
    activeQuests: [],
    knownRumors: [],
    worldTrends: [],
  } as unknown as RuntimeState;
}

describe('Three Kingdoms StoryPack Batch 2', () => {
  it('adds exactly 100 substantive motifs and 300 three-perspective threads', () => {
    expect(THREE_KINGDOMS_STORY_PACK_BATCH_2_BLUEPRINTS).toHaveLength(16);
    expect(THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS).toHaveLength(300);
    expect(threeKingdomsGenericStoryPack.version).toBe('0.5.0');
    expect(threeKingdomsGenericStoryPack.threads).toHaveLength(1500);
    expect(threeKingdomsGenericStoryPack.threads.slice(300, 600))
      .toEqual(THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS);

    const motifKeys = new Set(THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS.map((thread) => (
      `${thread.domain}/${thread.subdomain}/${thread.motifId}`
    )));
    expect(motifKeys.size).toBe(100);

    for (const motifKey of motifKeys) {
      const trio = THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS.filter((thread) => (
        `${thread.domain}/${thread.subdomain}/${thread.motifId}` === motifKey
      ));
      expect(trio).toHaveLength(3);
      expect(new Set(trio.map((thread) => thread.facet)).size).toBe(3);
      expect(new Set(trio.map((thread) => thread.title)).size).toBe(3);
      expect(new Set(trio.map((thread) => thread.summary)).size).toBe(3);
      expect(new Set(trio.flatMap((thread) => thread.rolePerspectives ?? [])).size).toBe(3);
    }
  });

  it('focuses ten motifs on each agreed Batch 2 priority domain', () => {
    const motifCounts = new Map(
      THREE_KINGDOMS_STORY_PACK_BATCH_2_BLUEPRINTS.map((domain) => (
        [domain.domain, domain.motifs.length]
      )),
    );

    expect([...motifCounts.values()].reduce((sum, count) => sum + count, 0)).toBe(100);
    for (const [domainId, count] of motifCounts) {
      expect(count).toBe(PRIORITY_DOMAINS.has(domainId) ? 10 : 4);
    }
  });

  it('covers every catalog subdomain after combining Batch 1 and Batch 2', () => {
    const report = buildThreeKingdomsStoryPackCoverage(threeKingdomsGenericStoryPack);

    expect(report.totalThreads).toBe(1500);
    expect(report.missingDomainIds).toEqual([]);
    expect(report.missingSubdomainIds).toEqual([]);
    for (const count of Object.values(report.countsBySubdomain)) {
      expect(count).toBeGreaterThan(0);
    }
  });

  it('passes official validation and cross-batch uniqueness gates', () => {
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

    const batch1Motifs = new Set(THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS.map((thread) => (
      `${thread.domain}/${thread.subdomain}/${thread.motifId}`
    )));
    const batch2Motifs = new Set(THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS.map((thread) => (
      `${thread.domain}/${thread.subdomain}/${thread.motifId}`
    )));
    expect([...batch2Motifs].some((motif) => batch1Motifs.has(motif))).toBe(false);
  }, 30_000);

  it('covers all role perspectives, era bands, and region markers', () => {
    for (const perspective of THREE_KINGDOMS_STORY_ROLE_PERSPECTIVES) {
      expect(THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS.some((thread) => (
        thread.rolePerspectives?.includes(perspective)
      ))).toBe(true);
    }
    for (const eraBand of THREE_KINGDOMS_STORY_ERA_BANDS) {
      expect(THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS.some((thread) => (
        thread.relatedTags?.includes(`era:${eraBand.id}`)
      ))).toBe(true);
    }
    for (const region of THREE_KINGDOMS_STORY_REGIONS) {
      expect(THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS.some((thread) => (
        thread.relatedTags?.includes(`region:${region}`)
      ))).toBe(true);
    }
  });

  it('keeps all new content detached from named NPCs and authoritative writeback', () => {
    for (const thread of THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS) {
      expect(thread.relatedNpcNames).toBeUndefined();
      expect(thread.sourceRef).toEqual({
        providerId: threeKingdomsGenericStoryPack.id,
        sourceType: 'storyThread',
        sourceId: thread.id,
      });
      expect(thread.usageBoundary).toContain('候选');
      expect(thread.usageBoundary).toContain('不得');
      expect(thread.summary.length).toBeGreaterThanOrEqual(45);
    }
  });

  it('only admits Batch 2 aftermath through structured result signals', () => {
    const aftermath = THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS
      .filter((thread) => thread.kind === 'aftermath');

    expect(aftermath).toHaveLength(12);
    expect(aftermath.every((thread) => thread.domain === 'aftermath_transition')).toBe(true);
    expect(aftermath.every((thread) => thread.entrySignals?.some((signal) => (
      signal.startsWith('aftermath:')
      || signal.startsWith('combat:')
      || signal.startsWith('war:')
      || signal.startsWith('disaster:')
      || signal.startsWith('matter:resolved')
    )))).toBe(true);
  });

  it.each([
    ['商队合伙', '.trade_market.merchants.caravan_joint_loss.'],
    ['翻供供状', '.justice_security.interrogation.confession_retraction.'],
    ['停战生效时辰', '.diplomacy_alliance.truce.truce_clock_mismatch.'],
    ['边疆盟约牧地边界', '.frontier_ethnic.frontier_treaty.grazing_boundary_terms.'],
    ['经学异本讲席', '.scholars_ritual.classics.variant_classic_text.'],
    ['旅舍行囊寄存木牌', '.family_daily_life.inns.inn_luggage_mixup.'],
  ])('projects the relevant priority-domain motif for query %s', (query, idPart) => {
    const result = buildWorldlineKnowledgeProjection({
      state: makeState(),
      storyPacks: [threeKingdomsGenericStoryPack],
      mode: 'default',
      queryTexts: [query],
    });

    expect(result.hints.length).toBeGreaterThan(0);
    expect(result.hints.length).toBeLessThanOrEqual(4);
    expect(result.hints.some((hint) => hint.id.includes(idPart))).toBe(true);
    const selectedThreads = result.hints.map((hint) => (
      threeKingdomsGenericStoryPack.threads.find((thread) => thread.id === hint.id)
    ));
    expect(selectedThreads.every(Boolean)).toBe(true);
    expect(new Set(selectedThreads.map((thread) => (
      `${thread?.domain}/${thread?.motifId}`
    ))).size).toBe(selectedThreads.length);
  });

  it('uses one slot for a three-facet motif and none for generic continue', () => {
    const specific = buildWorldlineKnowledgeProjection({
      state: makeState(),
      storyPacks: [threeKingdomsGenericStoryPack],
      mode: 'strict',
      queryTexts: ['核对借贷借券与收成抵押'],
    });
    const generic = buildWorldlineKnowledgeProjection({
      state: makeState(),
      storyPacks: [threeKingdomsGenericStoryPack],
      mode: 'strict',
      queryTexts: ['继续'],
    });

    const lendingHints = specific.hints.filter((hint) => (
      hint.id.includes('.trade_market.lending.harvest_backed_loan.')
    ));
    expect(lendingHints).toHaveLength(1);
    expect(generic.hints).toEqual([]);
  });
});
