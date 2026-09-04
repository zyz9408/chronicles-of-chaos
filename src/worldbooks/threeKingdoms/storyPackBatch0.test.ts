import { describe, expect, it } from 'vitest';
import {
  buildStoryPackCoverageReport,
  validateWorldlineStoryPack,
} from '../../engine/worldline/StoryPackTooling';
import { threeKingdomsGenericStoryPack } from './storyPack';
import {
  createThreeKingdomsStoryThread,
  validateThreeKingdomsStoryPack,
} from './storyPackBuilder';
import {
  THREE_KINGDOMS_STORY_DOMAINS,
  THREE_KINGDOMS_STORY_PACK_CATALOG,
} from './storyPackCatalog';

describe('Three Kingdoms StoryPack Batch 0', () => {
  it('freezes 16 unique top-level domains with unique subdomains', () => {
    expect(THREE_KINGDOMS_STORY_DOMAINS).toHaveLength(16);
    expect(new Set(THREE_KINGDOMS_STORY_DOMAINS.map((domain) => domain.id)).size).toBe(16);
    expect(new Set(THREE_KINGDOMS_STORY_DOMAINS.map((domain) => domain.code)).size).toBe(16);

    for (const domain of THREE_KINGDOMS_STORY_DOMAINS) {
      expect(domain.subdomains.length).toBeGreaterThanOrEqual(8);
      expect(new Set(domain.subdomains.map((subdomain) => subdomain.id)).size)
        .toBe(domain.subdomains.length);
    }
  });

  it('keeps the Batch 0 official pack contract valid after Batch 1-3 content is registered', () => {
    expect(threeKingdomsGenericStoryPack.id).toBe('threeKingdoms.genericStory.v1');
    expect(threeKingdomsGenericStoryPack.version).toBe('0.5.0');
    expect(threeKingdomsGenericStoryPack.threads).toHaveLength(1500);
    expect(validateWorldlineStoryPack(
      threeKingdomsGenericStoryPack,
      THREE_KINGDOMS_STORY_PACK_CATALOG,
    )).toEqual([]);
  }, 15_000);

  it('builds Batch 1-ready threads with official IDs and source references', () => {
    const thread = createThreeKingdomsStoryThread({
      kind: 'domainSituation',
      domain: 'logistics',
      subdomain: 'warehousing',
      motifId: 'ledger_stock_mismatch',
      facet: 'ledger_resources',
      title: '仓册与实粮不符',
      summary: '仓册记录与眼前实粮出现差异，需要在限期前核对可验证数目。',
      entrySignals: ['resource:grain_shortage', '核对仓册'],
      escalationShapes: ['限期复核', '责任归属争执'],
      rolePerspectives: ['official'],
      relatedTags: ['粮草'],
      timeRange: { start: '公元184年', end: '公元280年' },
      reusePolicy: 'context_reusable',
      cooldownTurns: 10,
      promptSafeVersion: '1.0.0',
      usageBoundary: '不得虚构粮草数值、盗卖结论或已经发生的损失。',
    });
    const pack = {
      ...threeKingdomsGenericStoryPack,
      threads: [thread],
    };

    expect(thread.id).toContain('threeKingdoms.genericStory.v1.domain_situation.logistics.warehousing');
    expect(thread.sourceRef?.providerId).toBe(threeKingdomsGenericStoryPack.id);
    expect(validateThreeKingdomsStoryPack(pack)).toEqual([]);
  });

  it('reports the combined official content through the Batch 0 coverage tool', () => {
    const report = buildStoryPackCoverageReport(
      threeKingdomsGenericStoryPack,
      THREE_KINGDOMS_STORY_PACK_CATALOG,
    );

    expect(report.totalThreads).toBe(1500);
    expect(report.missingDomainIds).toEqual([]);
    expect(report.missingSubdomainIds).toEqual([]);
  });
});
