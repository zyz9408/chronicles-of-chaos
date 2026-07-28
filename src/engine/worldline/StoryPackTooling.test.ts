import { describe, expect, it } from 'vitest';
import type { WorldlineStoryPack } from '../types';
import {
  buildStoryPackCoverageReport,
  createStructuredStoryThread,
  findNearDuplicateStoryThreads,
  validateWorldlineStoryPack,
} from './StoryPackTooling';

const catalog = {
  domains: [
    {
      id: 'logistics',
      subdomains: [
        { id: 'grain' },
        { id: 'transport' },
      ],
    },
    {
      id: 'aftermath',
      subdomains: [
        { id: 'wounded' },
      ],
    },
  ],
  facets: ['ledger_resources', 'aftermath_cost'],
  rolePerspectives: ['soldier', 'official'],
  eraBands: [
    { id: '184_191', startYear: 184, endYear: 191 },
    { id: '192_207', startYear: 192, endYear: 207 },
  ],
} as const;

function makeThread(overrides: Partial<Parameters<typeof createStructuredStoryThread>[0]> = {}) {
  return createStructuredStoryThread({
    packId: 'test.storypack.v1',
    worldBookId: 'wb_test',
    kind: 'domainSituation',
    domain: 'logistics',
    subdomain: 'grain',
    motifId: 'ledger_mismatch',
    facet: 'ledger_resources',
    title: '仓册与实粮不符',
    summary: '仓吏拿出的册页与眼前存粮不符，各方都要求先核对能被验证的数目。',
    entrySignals: ['resource:grain_shortage', '仓册'],
    escalationShapes: ['限期复核', '责任归属争执'],
    rolePerspectives: ['official'],
    relatedTags: ['粮草'],
    timeRange: { start: '公元184年', end: '公元207年' },
    reusePolicy: 'context_reusable',
    cooldownTurns: 10,
    promptSafeVersion: '1.0.0',
    usageBoundary: '只提供核账压力，不得虚构粮草数值、偷盗结论或已发生损失。',
    ...overrides,
  });
}

function makePack(threads = [makeThread()]): WorldlineStoryPack {
  return {
    id: 'test.storypack.v1',
    worldBookId: 'wb_test',
    name: 'Test StoryPack',
    version: '0.1.0',
    description: 'test',
    threads,
  };
}

describe('StoryPackTooling', () => {
  it('builds deterministic IDs and stable source references', () => {
    const thread = makeThread();

    expect(thread.id).toBe(
      'test.storypack.v1.domain_situation.logistics.grain.ledger_mismatch.ledger_resources',
    );
    expect(thread.sourceRef).toEqual({
      providerId: 'test.storypack.v1',
      sourceType: 'storyThread',
      sourceId: thread.id,
    });
    expect(thread.entrySignals).toEqual(['resource:grain_shortage', '仓册']);
  });

  it('accepts a complete structured pack', () => {
    expect(validateWorldlineStoryPack(makePack(), catalog)).toEqual([]);
  });

  it('rejects low-signal triggers, invalid aftermath prerequisites, and prompt fragments', () => {
    const invalid = makeThread({
      kind: 'aftermath',
      domain: 'aftermath',
      subdomain: 'wounded',
      motifId: 'wounded_followup',
      facet: 'aftermath_cost',
      title: 'TODO 战后伤兵',
      entrySignals: ['继续'],
    });

    const issues = validateWorldlineStoryPack(makePack([invalid]), catalog);
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'thread.promptFragment',
      'thread.entrySignals.lowSignal',
      'thread.aftermath.missingResultSignal',
    ]));
  });

  it('rejects fixed player identities, inevitable outcomes, and KnowledgeBase event leakage', () => {
    const invalid = makeThread({
      title: '赤壁之战后的粮草',
      summary: '玩家身为刘平已经接管粮仓，这一冲突一定会引发兵变。',
    });

    const issues = validateWorldlineStoryPack(makePack([invalid]), catalog, {
      forbiddenHistoricalTerms: ['赤壁之战'],
    });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'thread.fixedPlayerIdentity',
      'thread.inevitableOutcome',
      'thread.historicalEventLeak',
    ]));
  });

  it('reports invalid catalog metadata and unstable source references', () => {
    const invalid = {
      ...makeThread(),
      domain: 'unknown',
      subdomain: 'unknown',
      facet: 'unknown',
      rolePerspectives: ['unknown'],
      sourceRef: {
        providerId: 'other',
        sourceType: 'storyThread' as const,
        sourceId: 'other',
      },
    };

    const issues = validateWorldlineStoryPack(makePack([invalid]), catalog);
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'thread.domain.invalid',
      'thread.facet.invalid',
      'thread.rolePerspective.invalid',
      'thread.sourceRef.invalid',
    ]));
  });

  it('finds near-duplicate variants instead of accepting title-only rewrites', () => {
    const left = makeThread();
    const right = {
      ...makeThread({
        motifId: 'ledger_mismatch_copy',
        facet: 'aftermath_cost',
      }),
      title: '仓册和实际粮草不符',
      summary: '仓吏拿出的册页与眼前存粮不符，各方都要求先核对能被验证的数目。',
    };

    expect(findNearDuplicateStoryThreads([left, right], 0.7)).toEqual([
      expect.objectContaining({
        leftId: left.id,
        rightId: right.id,
      }),
    ]);
    expect(validateWorldlineStoryPack(makePack([left, right]), catalog, {
      nearDuplicateThreshold: 0.7,
    }).map((issue) => issue.code)).toContain('thread.nearDuplicate');
  });

  it('builds domain, subdomain, facet, kind, and era coverage', () => {
    const aftermath = makeThread({
      kind: 'aftermath',
      domain: 'aftermath',
      subdomain: 'wounded',
      motifId: 'wounded_followup',
      facet: 'aftermath_cost',
      entrySignals: ['combat:resolved'],
      reusePolicy: 'arc_singleton',
      timeRange: { start: '公元192年', end: '公元207年' },
    });
    const report = buildStoryPackCoverageReport(makePack([makeThread(), aftermath]), catalog);

    expect(report.totalThreads).toBe(2);
    expect(report.countsByKind.domainSituation).toBe(1);
    expect(report.countsByKind.aftermath).toBe(1);
    expect(report.countsByDomain).toEqual({
      logistics: 1,
      aftermath: 1,
    });
    expect(report.countsByEraBand).toEqual({
      '184_191': 1,
      '192_207': 2,
    });
    expect(report.missingDomainIds).toEqual([]);
    expect(report.missingSubdomainIds).toEqual(['logistics/transport']);
  });

  it('keeps legacy threads readable when structured validation is explicitly disabled', () => {
    const legacyPack = makePack([
      {
        id: 'legacy_thread',
        worldBookId: 'wb_test',
        title: 'Legacy thread',
        summary: 'Legacy summary',
        usageBoundary: 'Legacy boundary',
      },
    ]);

    expect(validateWorldlineStoryPack(legacyPack, catalog, {
      requireStructuredMetadata: false,
    })).toEqual([]);
  });
});
