import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../../engine/types';
import { findNearDuplicateStoryThreads } from '../../engine/worldline/StoryPackTooling';
import { buildWorldlineKnowledgeProjection } from '../../engine/worldline/WorldlineKnowledgeProjection';
import { threeKingdomsGenericStoryPack } from './storyPack';
import {
  THREE_KINGDOMS_STORY_PACK_BATCH_1_BLUEPRINTS,
  THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS,
} from './storyPackBatch1Content';
import {
  buildThreeKingdomsStoryPackCoverage,
  validateThreeKingdomsStoryPack,
} from './storyPackBuilder';
import {
  THREE_KINGDOMS_STORY_DOMAINS,
  THREE_KINGDOMS_STORY_ERA_BANDS,
  THREE_KINGDOMS_STORY_FACETS,
  THREE_KINGDOMS_STORY_REGIONS,
} from './storyPackCatalog';

const PRIORITY_DOMAINS = new Set([
  'military_camp',
  'war_pressure',
  'logistics',
  'administration',
  'agriculture_disaster',
  'migration_population',
  'clan_local_society',
  'intelligence_covert',
]);

describe('Three Kingdoms StoryPack Batch 1', () => {
  it('keeps Batch 1 at exactly 150 substantive motifs and 300 threads', () => {
    expect(THREE_KINGDOMS_STORY_PACK_BATCH_1_BLUEPRINTS).toHaveLength(16);
    expect(THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS).toHaveLength(300);
    expect(threeKingdomsGenericStoryPack.threads.slice(0, 300))
      .toEqual(THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS);

    const motifKeys = new Set(THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS.map((thread) => (
      `${thread.domain}/${thread.subdomain}/${thread.motifId}`
    )));
    expect(motifKeys.size).toBe(150);

    for (const motifKey of motifKeys) {
      const pair = THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS.filter((thread) => (
        `${thread.domain}/${thread.subdomain}/${thread.motifId}` === motifKey
      ));
      expect(pair).toHaveLength(2);
      expect(new Set(pair.map((thread) => thread.facet)).size).toBe(2);
      expect(new Set(pair.map((thread) => thread.title)).size).toBe(2);
      expect(new Set(pair.map((thread) => thread.summary)).size).toBe(2);
    }
  });

  it('covers every domain with 8-10 base motifs and prioritizes the agreed eight domains', () => {
    const motifCounts = new Map<string, number>();
    for (const domain of THREE_KINGDOMS_STORY_PACK_BATCH_1_BLUEPRINTS) {
      motifCounts.set(domain.domain, domain.motifs.length);
    }

    expect([...motifCounts.keys()].sort()).toEqual(
      THREE_KINGDOMS_STORY_DOMAINS.map((domain) => domain.id).sort(),
    );
    for (const [domainId, count] of motifCounts) {
      expect(count).toBeGreaterThanOrEqual(8);
      expect(count).toBeLessThanOrEqual(10);
      if (PRIORITY_DOMAINS.has(domainId)) expect(count).toBe(10);
    }
  });

  it('passes the official content validator without warnings or near duplicates', () => {
    expect(validateThreeKingdomsStoryPack(threeKingdomsGenericStoryPack)).toEqual([]);
    expect(findNearDuplicateStoryThreads(
      THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS,
      0.86,
    )).toEqual([]);
  }, 30_000);

  it('covers every thread kind, facet, era band, and region marker', () => {
    const report = buildThreeKingdomsStoryPackCoverage(threeKingdomsGenericStoryPack);
    expect(report.totalThreads).toBe(1500);
    expect(report.missingDomainIds).toEqual([]);

    for (const count of Object.values(report.countsByKind)) {
      expect(count).toBeGreaterThan(0);
    }
    for (const facet of THREE_KINGDOMS_STORY_FACETS) {
      expect(report.countsByFacet[facet]).toBeGreaterThan(0);
    }
    for (const eraBand of THREE_KINGDOMS_STORY_ERA_BANDS) {
      expect(report.countsByEraBand[eraBand.id]).toBeGreaterThan(0);
      expect(THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS.some((thread) => (
        thread.relatedTags?.includes(`era:${eraBand.id}`)
      ))).toBe(true);
    }
    for (const region of THREE_KINGDOMS_STORY_REGIONS) {
      expect(THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS.some((thread) => (
        thread.relatedTags?.includes(`region:${region}`)
      ))).toBe(true);
    }
  });

  it('keeps generic content detached from named NPCs and authoritative state changes', () => {
    const titles = new Set<string>();
    const summaries = new Set<string>();

    for (const thread of THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS) {
      expect(thread.relatedNpcNames).toBeUndefined();
      expect(thread.sourceRef).toEqual({
        providerId: threeKingdomsGenericStoryPack.id,
        sourceType: 'storyThread',
        sourceId: thread.id,
      });
      expect(thread.usageBoundary).toContain('候选');
      expect(thread.usageBoundary).toContain('不得');
      expect(thread.summary.length).toBeGreaterThanOrEqual(35);
      expect(titles.has(thread.title)).toBe(false);
      expect(summaries.has(thread.summary)).toBe(false);
      titles.add(thread.title);
      summaries.add(thread.summary);
    }
  });

  it('requires structured result signals for every aftermath thread', () => {
    const aftermathThreads = THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS
      .filter((thread) => thread.kind === 'aftermath');
    expect(aftermathThreads.length).toBeGreaterThanOrEqual(16);
    expect(aftermathThreads.every((thread) => thread.domain === 'aftermath_transition')).toBe(true);
    expect(aftermathThreads.every((thread) => thread.entrySignals?.some((signal) => (
      signal.startsWith('aftermath:')
      || signal.startsWith('combat:')
      || signal.startsWith('war:')
      || signal.startsWith('disaster:')
      || signal.startsWith('regime:')
      || signal.startsWith('matter:resolved')
    )))).toBe(true);
  });

  it('projects only a small relevant slice from the real 300-thread pack', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: {
        worldBookId: 'threeKingdoms',
        currentDate: '公元194年04月01日 08:00（辰时）',
        currentLocationId: 'location_storehouse',
        npcs: [],
        activeQuests: [],
        knownRumors: [],
        worldTrends: [],
      } as unknown as RuntimeState,
      storyPacks: [threeKingdomsGenericStoryPack],
      mode: 'default',
      queryTexts: ['去仓房核对账册与抄本'],
    });

    expect(result.hints.length).toBeGreaterThan(0);
    expect(result.hints.length).toBeLessThanOrEqual(4);
    expect(result.hints.every((hint) => hint.sourceType === 'storyPack')).toBe(true);
    expect(result.hints.some((hint) => hint.id.includes('.logistics.ledgers.'))).toBe(true);
    expect(result.hints.every((hint) => (
      hint.sourceRef?.providerId === threeKingdomsGenericStoryPack.id
    ))).toBe(true);
  });

  it('does not project any of the 300 threads for a generic continue request', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: {
        worldBookId: 'threeKingdoms',
        currentDate: '公元194年04月01日 08:00（辰时）',
        currentLocationId: 'location_unknown',
        npcs: [],
        activeQuests: [],
        knownRumors: [],
        worldTrends: [],
      } as unknown as RuntimeState,
      storyPacks: [threeKingdomsGenericStoryPack],
      mode: 'strict',
      queryTexts: ['继续'],
    });

    expect(result.hints).toEqual([]);
  });
});
