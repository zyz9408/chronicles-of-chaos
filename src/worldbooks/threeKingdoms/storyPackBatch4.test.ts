import { describe, expect, it } from 'vitest';
import type { RuntimeState, WorldlineStoryThread } from '../../engine/types';
import { findNearDuplicateStoryThreads } from '../../engine/worldline/StoryPackTooling';
import { buildWorldlineKnowledgeProjection } from '../../engine/worldline/WorldlineKnowledgeProjection';
import { threeKingdomsGenericStoryPack } from './storyPack';
import { THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS } from './storyPackBatch1Content';
import { THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS } from './storyPackBatch2Content';
import { THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS } from './storyPackBatch3Content';
import {
  THREE_KINGDOMS_STORY_PACK_BATCH_4_BLUEPRINTS,
  THREE_KINGDOMS_STORY_PACK_BATCH_4_ERA_QUOTAS,
  THREE_KINGDOMS_STORY_PACK_BATCH_4_FACET_QUOTAS,
  THREE_KINGDOMS_STORY_PACK_BATCH_4_REGION_QUOTAS,
  THREE_KINGDOMS_STORY_PACK_BATCH_4_ROLE_QUOTAS,
  THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS,
} from './storyPackBatch4Content';
import {
  buildThreeKingdomsStoryPackCoverage,
  validateThreeKingdomsStoryPack,
} from './storyPackBuilder';
import { THREE_KINGDOMS_STORY_DOMAINS } from './storyPackCatalog';

function makeState(currentDate = '公元263年10月01日 08:00（辰时）'): RuntimeState {
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

function countBy(
  threads: readonly WorldlineStoryThread[],
  selector: (thread: WorldlineStoryThread) => string | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const thread of threads) {
    const key = selector(thread);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

describe('Three Kingdoms StoryPack Batch 4', () => {
  it('adds exactly 126 motifs and 500 threads to version 0.5.0', () => {
    expect(THREE_KINGDOMS_STORY_PACK_BATCH_4_BLUEPRINTS).toHaveLength(16);
    expect(THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS).toHaveLength(500);
    expect(new Set(THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS.map(motifKey)).size)
      .toBe(126);
    expect(threeKingdomsGenericStoryPack.version).toBe('0.5.0');
    expect(threeKingdomsGenericStoryPack.threads).toHaveLength(1500);
    expect(threeKingdomsGenericStoryPack.threads.slice(1000))
      .toEqual(THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS);
  });

  it('matches the corrected kind and domain construction matrix', () => {
    expect(countBy(THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS, (thread) => thread.kind))
      .toEqual({
        structuralPressure: 50,
        domainSituation: 250,
        dramaMotif: 75,
        aftermath: 125,
      });
    expect(countBy(THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS, (thread) => thread.domain))
      .toEqual({
        military_camp: 15,
        war_pressure: 20,
        logistics: 25,
        administration: 25,
        justice_security: 20,
        agriculture_disaster: 30,
        trade_market: 30,
        migration_population: 30,
        clan_local_society: 30,
        court_legitimacy: 20,
        diplomacy_alliance: 20,
        intelligence_covert: 20,
        frontier_ethnic: 35,
        scholars_ritual: 25,
        family_daily_life: 30,
        aftermath_transition: 125,
      });
  });

  it('raises every catalog subdomain to at least five threads and two motifs', () => {
    const report = buildThreeKingdomsStoryPackCoverage(threeKingdomsGenericStoryPack);
    expect(report.totalThreads).toBe(1500);
    expect(report.missingDomainIds).toEqual([]);
    expect(report.missingSubdomainIds).toEqual([]);

    for (const domain of THREE_KINGDOMS_STORY_DOMAINS) {
      for (const subdomain of domain.subdomains) {
        const threads = threeKingdomsGenericStoryPack.threads.filter((thread) => (
          thread.domain === domain.id && thread.subdomain === subdomain.id
        ));
        expect(
          threads.length,
          `${domain.id}/${subdomain.id} thread density`,
        ).toBeGreaterThanOrEqual(5);
        expect(
          new Set(threads.map((thread) => thread.motifId)).size,
          `${domain.id}/${subdomain.id} motif density`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('meets exact era, region, role, facet, and seasonal quotas', () => {
    expect(countBy(
      THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS,
      (thread) => thread.relatedTags?.find((tag) => tag.startsWith('era:'))?.slice(4),
    )).toEqual(THREE_KINGDOMS_STORY_PACK_BATCH_4_ERA_QUOTAS);
    expect(countBy(
      THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS,
      (thread) => thread.relatedTags?.find((tag) => tag.startsWith('region:'))?.slice(7),
    )).toEqual(THREE_KINGDOMS_STORY_PACK_BATCH_4_REGION_QUOTAS);
    expect(countBy(
      THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS,
      (thread) => thread.rolePerspectives?.[0],
    )).toEqual(THREE_KINGDOMS_STORY_PACK_BATCH_4_ROLE_QUOTAS);
    expect(countBy(
      THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS,
      (thread) => thread.facet,
    )).toEqual(THREE_KINGDOMS_STORY_PACK_BATCH_4_FACET_QUOTAS);
    expect(countBy(
      THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS,
      (thread) => thread.relatedTags?.find((tag) => tag.startsWith('season:'))?.slice(7),
    )).toEqual({
      spring: 125,
      summer: 125,
      autumn: 125,
      winter: 125,
    });
  });

  it('expresses late-era, regional, and seasonal meaning in text rather than tags alone', () => {
    const lateEra = THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS.filter((thread) => (
      thread.relatedTags?.includes('era:250_280')
    ));
    expect(lateEra).toHaveLength(180);
    expect(lateEra.every((thread) => (
      /世代更替|长期战争疲劳|制度已经常态化|新旧官吏|旧制新制|持续交接/.test(
        `${thread.title}${thread.summary}`,
      )
    ))).toBe(true);

    expect(THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS.every((thread) => (
      thread.relatedTags?.includes('semantic:regional')
      && /北方平原|边塞关隘|关中塬地|巴蜀山道|荆襄江汉水网|江东潮汐|淮南陂塘|南中山谷/.test(
        `${thread.title}${thread.summary}`,
      )
    ))).toBe(true);
    expect(THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS.every((thread) => (
      thread.relatedTags?.includes('semantic:seasonal')
      && /春耕|春季|夏汛|夏季|秋收|秋季|冬藏|冬季/.test(`${thread.title}${thread.summary}`)
    ))).toBe(true);
    expect(new Set(
      THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS.map((thread) => thread.domain),
    ).size).toBe(16);
  });

  it('adds the exact 25-motif / 125-thread structured aftermath allocation', () => {
    const aftermath = THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS
      .filter((thread) => thread.kind === 'aftermath');
    expect(aftermath).toHaveLength(125);
    expect(new Set(aftermath.map(motifKey)).size).toBe(25);
    expect(countBy(aftermath, (thread) => thread.subdomain)).toEqual({
      captives: 10,
      remains: 15,
      missing: 10,
      revenge: 15,
      reconstruction: 10,
      relief: 15,
      arms_recovery: 10,
      old_officials_disposal: 10,
      public_trust: 15,
      victory_distribution: 15,
    });
    expect(aftermath.every((thread) => thread.entrySignals?.every((signal) => (
      signal.startsWith('aftermath:')
      || signal.startsWith('combat:')
      || signal.startsWith('war:')
      || signal.startsWith('disaster:')
      || signal.startsWith('regime:')
      || signal.startsWith('matter:resolved')
    )))).toBe(true);
    expect(aftermath.every((thread) => (
      thread.usageBoundary.includes('结构化结果')
      && thread.summary.includes('不创建前置结果')
    ))).toBe(true);
  });

  it('passes validation, uniqueness, and the 0.86 near-duplicate gate', () => {
    expect(validateThreeKingdomsStoryPack(threeKingdomsGenericStoryPack)).toEqual([]);
    expect(findNearDuplicateStoryThreads(threeKingdomsGenericStoryPack.threads, 0.86))
      .toEqual([]);

    expect(new Set(threeKingdomsGenericStoryPack.threads.map((thread) => thread.title)).size)
      .toBe(1500);
    expect(new Set(threeKingdomsGenericStoryPack.threads.map((thread) => thread.summary)).size)
      .toBe(1500);
  }, 30_000);

  it('keeps Batch 1 through 4 motif keys pairwise disjoint', () => {
    const batches = [
      THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS,
      THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS,
      THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS,
      THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS,
    ];
    for (let left = 0; left < batches.length; left += 1) {
      for (let right = left + 1; right < batches.length; right += 1) {
        const leftKeys = new Set(batches[left].map(motifKey));
        expect(batches[right].some((thread) => leftKeys.has(motifKey(thread)))).toBe(false);
      }
    }
  });

  it('keeps Batch 4 detached from named NPCs and authoritative writeback', () => {
    for (const thread of THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS) {
      expect(thread.relatedNpcNames).toBeUndefined();
      expect(thread.sourceRef).toEqual({
        providerId: threeKingdomsGenericStoryPack.id,
        sourceType: 'storyThread',
        sourceId: thread.id,
      });
      expect(thread.usageBoundary).toContain('候选');
      expect(thread.usageBoundary).toContain('不得');
      expect(thread.summary.length).toBeGreaterThanOrEqual(120);
    }
  });

  it.each([
    ['合营操练口令差异分组名单', '.military_camp.unit_integration.mixed_unit_seasonal_drill.'],
    ['雨季岔路伏击前兆车辙覆水', '.war_pressure.ambush.rain_route_ambush_warning.'],
    ['晚期新官交接跨年待办属吏轮值', '.administration.new_officials.late_office_handover_calendar.'],
    ['边疆盟约季节关口迁牧路线', '.frontier_ethnic.frontier_treaty.seasonal_treaty_checkpoint.'],
    ['冬季乡学家庭劳作弹性授课', '.scholars_ritual.local_education.winter_school_household.'],
    ['换季团聚家务协商共同支出', '.family_daily_life.reunion.seasonal_reunion_household.'],
    ['disaster:resolved 公告纠错最初数字后续复核', '.aftermath_transition.public_trust.post_disaster_notice_correction.'],
    ['regime:changed 旧吏服务交接熟悉民生日常忠诚怀疑实际办事记录', '.aftermath_transition.old_officials_disposal.old_clerk_service_transfer.'],
  ])('projects the expected Batch 4 motif for query %s', (query, idPart) => {
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

  it('uses one slot per motif and none for generic continue', () => {
    const specific = buildWorldlineKnowledgeProjection({
      state: makeState(),
      storyPacks: [threeKingdomsGenericStoryPack],
      mode: 'strict',
      queryTexts: ['雨季岔路伏击前兆车辙覆水折枝高度'],
    });
    const generic = buildWorldlineKnowledgeProjection({
      state: makeState(),
      storyPacks: [threeKingdomsGenericStoryPack],
      mode: 'strict',
      queryTexts: ['继续'],
    });

    expect(specific.hints.filter((hint) => (
      hint.id.includes('.war_pressure.ambush.rain_route_ambush_warning.')
    ))).toHaveLength(1);
    expect(generic.hints).toEqual([]);
  });
});
