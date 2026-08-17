import { describe, expect, it } from 'vitest';
import type {
  HoldingLedgerEntry,
  PrivateAssetEntry,
  PrivateAssetProjectEntry,
  ResourceLedger,
  TroopLedgerEntry,
} from '../types';
import {
  calculateHoldingOutputProjection,
  applyEmergencyHoldingLevy,
  calculateHoldingAnnualSettlement,
  completeDuePrivateAssetProjects,
  isAnnualSettlementPrivateAsset,
  isUpkeepTroop,
} from './HoldingAnnualSettlement';
import {
  applyHoldingAnnualSettlementRuntime,
  applyHoldingMonthlyUpkeepRuntime,
  applyHoldingSettlementTimelineRuntime,
  calculateHoldingMonthlyUpkeepPreview,
  prepareHoldingAnnualSettlement,
} from './HoldingAnnualSettlementRuntime';

function makeHolding(overrides: Partial<HoldingLedgerEntry> = {}): HoldingLedgerEntry {
  return {
    holdingId: 'holding_yingchuan',
    name: 'Yingchuan commandery',
    type: 'commandery',
    status: 'controlled',
    summary: 'A controlled commandery used for annual settlement tests.',
    scaleLevel: 3,
    agriculture: 80,
    commerce: 60,
    population: 70,
    publicOrder: 65,
    popularSupport: 60,
    defense: 55,
    recruitPotential: 70,
    armory: 45,
    horseSupply: 30,
    corruption: 20,
    localTreasury: 40,
    localGranary: 1200,
    updatedAt: '189-09-01',
    ...overrides,
  };
}

describe('troop lifecycle upkeep boundary', () => {
  it('charges only current troop records and excludes every terminal regroup state', () => {
    expect(isUpkeepTroop(makeTroop({ lifecycleStatus: 'active' }))).toBe(true);
    expect(isUpkeepTroop(makeTroop({ lifecycleStatus: 'unknown' }))).toBe(true);

    for (const lifecycleStatus of ['routed', 'merged', 'split', 'destroyed', 'surrendered', 'disbanded', 'archived'] as const) {
      expect(isUpkeepTroop(makeTroop({ lifecycleStatus })), lifecycleStatus).toBe(false);
    }
  });
});

describe('holding civil scale output projection', () => {
  it('lets a regional city use its larger civil ledger while keeping collection bounded', () => {
    const small = calculateHoldingOutputProjection(makeHolding({
      type: 'city',
      civilAdministrationScope: 'territorial',
      civilScaleLevel: 3,
      farmlandMu: 180_000,
      registeredHouseholds: 16_000,
    }));
    const regional = calculateHoldingOutputProjection(makeHolding({
      type: 'city',
      civilAdministrationScope: 'territorial',
      civilScaleLevel: 5,
      farmlandMu: 1_200_000,
      registeredHouseholds: 90_000,
    }));

    expect(regional.estimatedOutput.grain).toBeGreaterThan(small.estimatedOutput.grain);
    expect(regional.estimatedOutput.money).toBeGreaterThan(small.estimatedOutput.money);
    expect(regional.actualCollection.grain).toBeLessThanOrEqual(regional.estimatedOutput.grain);
    expect(regional.actualCollection.money).toBeLessThanOrEqual(regional.estimatedOutput.money);
  });
});

function makeResources(overrides: Partial<ResourceLedger> = {}): ResourceLedger {
  return {
    money: 100,
    grain: 1000,
    horses: 20,
    arms: 10,
    recruits: 30,
    weapons: [],
    documents: [],
    tokens: [],
    importantSupplies: [],
    ...overrides,
  };
}

function makeTroop(overrides: Partial<TroopLedgerEntry> = {}): TroopLedgerEntry {
  return {
    troopId: 'troop_player_cavalry',
    name: 'Player cavalry',
    size: 100,
    factionId: 'faction_player',
    troopType: 'cavalry',
    quality: '高',
    lifecycleStatus: 'active',
    morale: 70,
    training: 65,
    supplies: 'stable',
    task: 'garrison',
    relationToPlayer: 'self',
    ...overrides,
  };
}

function makePrivateAsset(overrides: Partial<PrivateAssetEntry> = {}): PrivateAssetEntry {
  return {
    privateAssetId: 'asset_li_estate',
    name: 'Li clan estate',
    type: 'estate',
    ownerScope: 'personal',
    status: 'active',
    summary: 'A family estate used for private asset settlement tests.',
    locationDescription: 'outside Yingchuan',
    mu: 120,
    households: 18,
    workers: 12,
    workshopScale: 1,
    ranchCapacity: 20,
    updatedAt: '189-09-01',
    ...overrides,
  };
}

function makeSixMoneyPrivateAsset(): PrivateAssetEntry {
  return makePrivateAsset({
    mu: 0,
    households: 0,
    workers: 5,
    workshopScale: 1,
    ranchCapacity: 0,
  });
}

function makeLegacyAnnualSettlementReport(overrides: Record<string, unknown> = {}) {
  return {
    reportId: 'domestic_189',
    year: 189,
    settledAt: '189-09-01 08:00',
    title: '189年内政收支',
    summary: '本年收入 钱财+6；军费与维持支出 无变化；最终净变 钱财+6。本年无到期私产工程。',
    income: { money: 6, grain: 0, horses: 0, arms: 0, recruits: 0 },
    expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
    netChange: { money: 6, grain: 0, horses: 0, arms: 0, recruits: 0 },
    readByPlayer: true,
    ...overrides,
  };
}

function makePrivateAssetProject(
  overrides: Partial<PrivateAssetProjectEntry> = {},
): PrivateAssetProjectEntry {
  return {
    projectId: 'project_expand_estate',
    assetId: 'asset_li_estate',
    title: 'Expand the Li estate fields',
    type: 'expand_farmland',
    status: 'active',
    startedAt: '189-03-01',
    expectedCompleteAt: '189-08-01',
    investedMoney: 12,
    investedGrain: 80,
    targetDelta: { mu: 40, households: 6 },
    updatedAt: '189-03-01',
    ...overrides,
  };
}

function makeSettlementTimelineState(
  year: number,
  month: number,
  day = 2,
  overrides: Record<string, unknown> = {},
) {
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return {
    currentDate: date,
    currentTime: { year, month, day, hour: 8, minute: 0 },
    resources: makeResources({
      money: 100_000,
      grain: 100_000,
      horses: 100_000,
      arms: 100_000,
      recruits: 100_000,
    }),
    holdings: [makeHolding()],
    troops: [makeTroop({ troopType: '步卒', quality: '中' })],
    privateAssets: [],
    privateAssetProjects: [],
    domesticReports: [],
    turnLog: [{
      turnNumber: 1,
      date,
      playerInput: 'wait through the settlement timeline',
      narrativeText: 'Time passes.',
      statePatchSummary: 'none',
      timestamp: '2026-01-01T00:00:00.000Z',
    }],
    ...overrides,
  } as any;
}

describe('isAnnualSettlementPrivateAsset', () => {
  it('accepts only active and damaged assets from the current status contract', () => {
    const matrix = [
      ['active', true],
      ['damaged', true],
      ['occupied', false],
      ['disputed', false],
      ['archived', false],
    ] as const;

    for (const [status, expected] of matrix) {
      expect(isAnnualSettlementPrivateAsset(makePrivateAsset({ status }))).toBe(expected);
    }
  });
});

describe('calculateHoldingAnnualSettlement', () => {
  it('computes yearly public resources from controlled holdings without troop upkeep', () => {
    const result = calculateHoldingAnnualSettlement({
      year: 189,
      settledAt: '189-09-01',
      holdings: [makeHolding()],
      troops: [makeTroop()],
      currentResources: makeResources(),
    });

    expect(result.income.grain).toBeGreaterThan(0);
    expect(result.income.money).toBeGreaterThan(0);
    expect(result.income.recruits).toBeGreaterThan(0);
    expect(result.expenses.grain).toBe(0);
    expect(result.expenses.money).toBe(0);
    expect(result.nextResources.grain).toBe(
      1000 + result.income.grain - result.expenses.grain,
    );
    expect(result.nextHoldings[0]).toMatchObject({
      holdingId: 'holding_yingchuan',
      agriculture: 80,
      corruption: 23,
    });
    expect(result.report).toMatchObject({
      reportId: 'system:holding-annual:189',
      source: 'system',
      kind: 'holdingAnnualSettlement',
      year: 189,
      settledAt: '189-09-01',
      readByPlayer: false,
      income: result.income,
      expenses: result.expenses,
      netChange: result.netChange,
    });
  });

  it('keeps local estimated output stable while local elite relation changes actual collection', () => {
    const baseEliteHolding = makeHolding({
      farmlandMu: 12000,
      registeredHouseholds: 1800,
      eliteControlledShare: 90,
      corruption: 20,
    });

    const hostile = calculateHoldingOutputProjection({
      ...baseEliteHolding,
      localEliteRelation: -80,
    });
    const cooperative = calculateHoldingOutputProjection({
      ...baseEliteHolding,
      localEliteRelation: 80,
    });

    expect(hostile.estimatedOutput.grain).toBe(cooperative.estimatedOutput.grain);
    expect(hostile.estimatedOutput.money).toBe(cooperative.estimatedOutput.money);
    expect(cooperative.actualCollection.grain).toBeGreaterThan(hostile.actualCollection.grain);
    expect(cooperative.actualCollection.money).toBeGreaterThan(hostile.actualCollection.money);
    expect(hostile.collectionRate.grain).toBeLessThan(0.55);
    expect(hostile.collectionRate.money).toBeLessThan(0.55);
  });

  it('uses actual local elite collection for yearly holding income', () => {
    const cooperative = makeHolding({
      farmlandMu: 12000,
      registeredHouseholds: 1800,
      eliteControlledShare: 80,
      localEliteRelation: 80,
    });
    const hostile = makeHolding({
      farmlandMu: 12000,
      registeredHouseholds: 1800,
      eliteControlledShare: 80,
      localEliteRelation: -80,
    });

    const cooperativeResult = calculateHoldingAnnualSettlement({
      year: 189,
      settledAt: '189-09-01',
      holdings: [cooperative],
      troops: [],
      currentResources: makeResources(),
    });
    const hostileResult = calculateHoldingAnnualSettlement({
      year: 189,
      settledAt: '189-09-01',
      holdings: [hostile],
      troops: [],
      currentResources: makeResources(),
    });

    expect(cooperativeResult.income.grain).toBeGreaterThan(hostileResult.income.grain);
    expect(cooperativeResult.income.money).toBeGreaterThan(hostileResult.income.money);
  });

  it('builds annual cash tax from registered households plus commerce while preserving grain projection', () => {
    const estate = makeHolding({
      holdingId: 'holding_wei_estate',
      name: 'Wei estate',
      type: 'estate',
      civilAdministrationScope: 'territorial',
      scaleLevel: 1,
      agriculture: 30,
      commerce: 10,
      population: 50,
      publicOrder: 70,
      popularSupport: 70,
      corruption: 0,
      farmlandMu: 2000,
      registeredHouseholds: 150,
      eliteControlledShare: 0,
      localEliteRelation: -50,
    });

    const projection = calculateHoldingOutputProjection(estate);
    const settlement = calculateHoldingAnnualSettlement({
      year: 189,
      settledAt: '189-09-01',
      holdings: [estate],
      troops: [],
      currentResources: makeResources({ money: 0, grain: 0 }),
    });

    expect(projection.estimatedOutput.grain).toBe(400);
    expect(projection.estimatedOutput.money).toBe(37);
    expect(projection.actualCollection.grain).toBe(340);
    expect(projection.actualCollection.money).toBe(31);
    expect(projection.collectionRate.money).toBe(0.84);
    expect(settlement.income).toMatchObject({ grain: 340, money: 31 });
    expect(settlement.nextResources).toMatchObject({ grain: 340, money: 31 });
  });

  it('keeps household cash tax at zero commerce and adds commerce as a separate cash source', () => {
    const baseEstate = makeHolding({
      type: 'estate',
      civilAdministrationScope: 'territorial',
      scaleLevel: 1,
      population: 50,
      registeredHouseholds: 150,
      farmlandMu: 2000,
      eliteControlledShare: 0,
    });

    const noCommerce = calculateHoldingOutputProjection({ ...baseEstate, commerce: 0 });
    const fullCommerce = calculateHoldingOutputProjection({ ...baseEstate, commerce: 100 });
    const halfHouseholds = calculateHoldingOutputProjection({
      ...baseEstate,
      commerce: 0,
      registeredHouseholds: 75,
    });

    expect(noCommerce.estimatedOutput.money).toBe(36);
    expect(fullCommerce.estimatedOutput.money).toBe(48);
    expect(halfHouseholds.estimatedOutput.money).toBe(18);
  });

  it('keeps the legacy scale cash projection when a migrated holding has no registered-household truth', () => {
    const migratedHolding = makeHolding({
      farmlandMu: 12000,
      registeredHouseholds: undefined,
      eliteControlledShare: 0,
    });

    const projection = calculateHoldingOutputProjection(migratedHolding);

    expect(projection.estimatedOutput.money).toBe(82);
    expect(projection.actualCollection.money).toBe(60);
  });

  it('falls back to existing scale-based income when local elite fields are absent', () => {
    const holding = makeHolding();
    const projection = calculateHoldingOutputProjection(holding);
    const result = calculateHoldingAnnualSettlement({
      year: 189,
      settledAt: '189-09-01',
      holdings: [holding],
      troops: [],
      currentResources: makeResources(),
    });

    expect(projection.actualCollection.grain).toBe(result.income.grain);
    expect(projection.actualCollection.money).toBe(result.income.money);
    expect(projection.collectionRate.grain).toBe(1);
    expect(projection.collectionRate.money).toBe(1);
  });

  it('excludes a pure military holding from civil output, settlement, and levy', () => {
    const camp = makeHolding({
      holdingId: 'holding_plain_camp',
      name: '普通军营',
      type: 'camp',
      civilAdministrationScope: 'none',
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 0,
      popularSupport: 0,
      recruitPotential: 0,
      defense: 80,
      armory: 70,
      horseSupply: 60,
    });

    expect(calculateHoldingOutputProjection(camp)).toEqual({
      estimatedOutput: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      actualCollection: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      collectionRate: { money: 1, grain: 1 },
    });

    const settlement = calculateHoldingAnnualSettlement({
      year: 189,
      settledAt: '189-09-01',
      holdings: [camp],
      troops: [],
      currentResources: makeResources({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 }),
    });
    expect(settlement.income).toEqual({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 });
    expect(settlement.nextHoldings[0].corruption).toBeUndefined();
    expect(settlement.report.holdingHighlights).toEqual([]);

    const levy = applyEmergencyHoldingLevy({
      holding: camp,
      levyType: 'grain',
      intensity: 'exhaustive',
    });
    expect(levy.resourceGain.grain).toBe(0);
    expect(levy.nextHolding).toMatchObject({
      holdingId: camp.holdingId,
      civilAdministrationScope: 'none',
    });
    expect(levy.nextHolding.corruption).toBeUndefined();
    expect(levy.warnings).toEqual([expect.stringContaining('no grain civil yield')]);
  });

  it('keeps household-only holdings out of agricultural output while allowing money', () => {
    const portTown = makeHolding({
      holdingId: 'holding_port_town',
      type: 'port',
      civilAdministrationScope: 'households',
      agriculture: 0,
      registeredHouseholds: 900,
      farmlandMu: undefined,
    });

    const projection = calculateHoldingOutputProjection(portTown);
    expect(projection.actualCollection.grain).toBe(0);
    expect(projection.actualCollection.money).toBeGreaterThan(0);
    expect(projection.actualCollection.recruits).toBeGreaterThan(0);
  });

  it('keeps an explicitly mixed tuntian camp in the full civil settlement path', () => {
    const tuntianCamp = makeHolding({
      holdingId: 'holding_tuntian',
      type: 'camp',
      civilAdministrationScope: 'mixed',
      farmlandMu: 2500,
      registeredHouseholds: 295,
    });

    const projection = calculateHoldingOutputProjection(tuntianCamp);
    expect(projection.actualCollection.grain).toBeGreaterThan(0);
    expect(projection.actualCollection.money).toBeGreaterThan(0);
  });

  it('ignores lost or archived holdings for yearly income', () => {
    const result = calculateHoldingAnnualSettlement({
      year: 190,
      settledAt: '190-09-01',
      holdings: [
        makeHolding({ status: 'lost', agriculture: 100, commerce: 100, population: 100 }),
        makeHolding({ holdingId: 'holding_archived', status: 'archived', agriculture: 100 }),
      ],
      troops: [],
      currentResources: makeResources({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 }),
    });

    expect(result.income).toMatchObject({
      money: 0,
      grain: 0,
      horses: 0,
      arms: 0,
      recruits: 0,
    });
    expect(result.nextHoldings[0].corruption).toBe(20);
  });

  it('adds active private asset production to yearly income and the domestic report', () => {
    const result = calculateHoldingAnnualSettlement({
      year: 189,
      settledAt: '189-09-01',
      holdings: [],
      troops: [],
      privateAssets: [
        makePrivateAsset(),
        makePrivateAsset({
          privateAssetId: 'asset_archived',
          name: 'Archived estate',
          status: 'archived',
          mu: 1000,
          households: 100,
        }),
      ],
      currentResources: makeResources({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 }),
    });

    expect(result.income.grain).toBeGreaterThan(0);
    expect(result.income.money).toBeGreaterThan(0);
    expect(result.income.horses).toBeGreaterThan(0);
    expect(result.income.arms).toBeGreaterThan(0);
    expect(result.report.privateAssetHighlights).toEqual([
      expect.objectContaining({
        privateAssetId: 'asset_li_estate',
        summary: expect.stringContaining('Li clan estate'),
      }),
    ]);
  });

  it('uses the same private-asset eligibility matrix for income and report highlights', () => {
    const assets = ([
      'active',
      'damaged',
      'occupied',
      'disputed',
      'archived',
    ] as const).map((status) => ({
      ...makeSixMoneyPrivateAsset(),
      privateAssetId: `asset_${status}`,
      name: `${status} estate`,
      status,
    }));
    const settle = (privateAssets: PrivateAssetEntry[]) => calculateHoldingAnnualSettlement({
      year: 189,
      settledAt: '189-09-01',
      holdings: [],
      troops: [],
      privateAssets,
      currentResources: makeResources({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 }),
    });

    const active = settle([assets[0]]);
    const damaged = settle([assets[1]]);
    const ineligible = settle(assets.slice(2));
    const combined = settle(assets);

    expect(active.income).toMatchObject({ money: 6, grain: 0, horses: 0, arms: 12, recruits: 0 });
    expect(damaged.income).toMatchObject({ money: 3, grain: 0, horses: 0, arms: 6, recruits: 0 });
    expect(ineligible.income).toMatchObject({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 });
    expect(combined.income).toMatchObject({ money: 9, grain: 0, horses: 0, arms: 18, recruits: 0 });
    expect(combined.report.privateAssetHighlights?.map((highlight) => highlight.privateAssetId)).toEqual([
      'asset_active',
      'asset_damaged',
    ]);
  });

  it('keeps annual settlement from charging troop upkeep because upkeep is monthly', () => {
    const result = calculateHoldingAnnualSettlement({
      year: 189,
      settledAt: '189-09-01',
      holdings: [],
      troops: [makeTroop({ troopType: '骑兵', quality: '高' })],
      currentResources: makeResources({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 }),
    });

    expect(result.expenses).toMatchObject({
      grain: 0,
      money: 0,
      horses: 0,
      arms: 0,
      recruits: 0,
    });
  });
});

describe('completeDuePrivateAssetProjects', () => {
  it('completes due private asset projects and applies their target deltas locally', () => {
    const result = completeDuePrivateAssetProjects({
      currentDate: '189-09-01',
      privateAssets: [makePrivateAsset()],
      projects: [makePrivateAssetProject()],
    });

    expect(result.nextPrivateAssets[0]).toMatchObject({
      privateAssetId: 'asset_li_estate',
      mu: 160,
      households: 24,
      updatedAt: '189-09-01',
    });
    expect(result.nextPrivateAssets[0].recentChanges?.join('\n')).toContain(
      'Expand the Li estate fields',
    );
    expect(result.nextProjects[0]).toMatchObject({
      projectId: 'project_expand_estate',
      status: 'completed',
      updatedAt: '189-09-01',
    });
    expect(result.completedProjects).toEqual([
      expect.objectContaining({ projectId: 'project_expand_estate' }),
    ]);
  });

  it('leaves future, blocked, and missing-asset projects unchanged', () => {
    const result = completeDuePrivateAssetProjects({
      currentDate: '189-09-01',
      privateAssets: [makePrivateAsset()],
      projects: [
        makePrivateAssetProject({
          projectId: 'project_future',
          expectedCompleteAt: '189-10-01',
          targetDelta: { mu: 80 },
        }),
        makePrivateAssetProject({
          projectId: 'project_blocked',
          status: 'blocked',
          targetDelta: { mu: 80 },
        }),
        makePrivateAssetProject({
          projectId: 'project_missing_asset',
          assetId: 'asset_missing',
          targetDelta: { mu: 80 },
        }),
      ],
    });

    expect(result.nextPrivateAssets[0].mu).toBe(120);
    expect(result.nextProjects.map((project) => project.status)).toEqual([
      'active',
      'blocked',
      'active',
    ]);
    expect(result.completedProjects).toEqual([]);
  });
});

describe('applyHoldingAnnualSettlementRuntime', () => {
  it('overrides an LLM-written report with the local annual settlement result', () => {
    const baseState = {
      currentDate: '189-09-01',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      resources: makeResources(),
      holdings: [makeHolding()],
      troops: [makeTroop()],
      privateAssets: [makePrivateAsset()],
      privateAssetProjects: [makePrivateAssetProject()],
      domesticReports: [],
      turnLog: [
        {
          turnNumber: 1,
          date: '189-09-01',
          playerInput: 'check the accounts',
          narrativeText: 'The account books are opened.',
          fullNarrativeText: 'The account books are opened.',
          statePatchSummary: 'LLM writeback',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    } as any;
    const preview = prepareHoldingAnnualSettlement(baseState);
    expect(preview).toBeDefined();
    const conflictingReport = {
      reportId: 'system:holding-annual:189',
      source: 'llm',
      kind: 'specialDomesticReport',
      year: 189,
      settledAt: '189-09-01',
      title: 'LLM invented settlement',
      summary: 'LLM should not own annual settlement numbers.',
      income: { money: 999, grain: 999, horses: 999, arms: 999, recruits: 999 },
      expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 999, grain: 999, horses: 999, arms: 999, recruits: 999 },
      warnings: ['Preserve this warning.'],
      readByPlayer: false,
    };

    const contaminatedState = {
      ...baseState,
      domesticReports: [conflictingReport],
    } as any;

    const result = applyHoldingAnnualSettlementRuntime(contaminatedState, preview);
    const report = result.state.domesticReports?.find((item) => item.reportId === 'system:holding-annual:189');
    const relocatedConflict = result.state.domesticReports?.find((item) => item.title === conflictingReport.title);

    expect(result.meta?.status).toBe('applied');
    expect(report?.title).toBe('189年内政收支');
    expect(report?.summary).toContain('本年收入');
    expect(report?.summary).not.toContain('LLM should not own');
    expect(report?.source).toBe('system');
    expect(report?.kind).toBe('holdingAnnualSettlement');
    expect(relocatedConflict).toEqual({
      ...conflictingReport,
      reportId: 'legacy-conflict:system:holding-annual:189:year-189:1',
    });
    expect(result.state.domesticReports).toHaveLength(2);
    expect(new Set(result.state.domesticReports?.map((item) => item.reportId)).size).toBe(2);
    expect(result.state.resources).toEqual(preview?.nextResources);
    expect(result.state.holdings?.[0].corruption).toBe(preview?.nextHoldings[0].corruption);
    expect(result.state.privateAssets?.[0].mu).toBe(preview?.nextPrivateAssets[0].mu);
    expect(result.state.privateAssetProjects?.[0].status).toBe('completed');
    expect(result.state.turnLog[0].statePatchSummary).toContain('年度结算[system:holding-annual:189]');

    const repeated = applyHoldingAnnualSettlementRuntime(result.state, preview);
    expect(repeated.meta).toBeUndefined();
    expect(repeated.state.domesticReports?.map((item) => item.reportId)).toEqual(
      result.state.domesticReports?.map((item) => item.reportId),
    );
  });

  it('uses post-writeback resources as the settlement base without a report conflict', () => {
    const previousState = {
      currentDate: '189-09-01',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      resources: makeResources({ money: 100, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      holdings: [],
      troops: [],
      privateAssets: [makeSixMoneyPrivateAsset()],
      privateAssetProjects: [],
      domesticReports: [],
      turnLog: [],
    } as any;
    const preview = prepareHoldingAnnualSettlement(previousState);
    expect(preview?.income.money).toBe(6);
    expect(preview?.nextResources.money).toBe(106);
    const postWritebackState = {
      ...previousState,
      resources: makeResources({ money: 150, grain: 0, horses: 0, arms: 0, recruits: 0 }),
    } as any;

    const result = applyHoldingAnnualSettlementRuntime(postWritebackState, preview);

    expect(result.state.resources?.money).toBe(156);
  });

  it('previews and settles a damaged-only private asset with the calculator half-output rule', () => {
    const state = {
      currentDate: '189-09-01',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      resources: makeResources({ money: 100, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      holdings: [],
      troops: [],
      privateAssets: [{ ...makeSixMoneyPrivateAsset(), status: 'damaged' }],
      privateAssetProjects: [],
      domesticReports: [],
      turnLog: [],
    } as any;

    const preview = prepareHoldingAnnualSettlement(state);
    const result = applyHoldingAnnualSettlementRuntime(state, preview);

    expect(preview?.income.money).toBe(3);
    expect(result.meta?.status).toBe('applied');
    expect(result.state.resources?.money).toBe(103);
    expect(result.state.domesticReports?.[0]).toMatchObject({
      reportId: 'system:holding-annual:189',
      income: expect.objectContaining({ money: 3 }),
      privateAssetHighlights: [
        expect.objectContaining({ privateAssetId: 'asset_li_estate' }),
      ],
    });
  });

  it('does not enter annual settlement for an ineligible-only private-asset state', () => {
    const state = {
      currentDate: '189-09-01',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      resources: makeResources({ money: 100, grain: 200, horses: 3, arms: 4, recruits: 5 }),
      holdings: [],
      troops: [],
      privateAssets: (['occupied', 'disputed', 'archived'] as const).map((status) => ({
        ...makeSixMoneyPrivateAsset(),
        privateAssetId: `asset_${status}`,
        name: `${status} estate`,
        status,
      })),
      privateAssetProjects: [],
      domesticReports: [],
      turnLog: [],
    } as any;

    const preview = prepareHoldingAnnualSettlement(state);
    const result = applyHoldingAnnualSettlementRuntime(state, preview);

    expect(preview).toBeUndefined();
    expect(result.meta).toBeUndefined();
    expect(result.state.resources).toEqual(state.resources);
    expect(result.state.domesticReports).toEqual([]);
  });

  it('uses post-writeback resources as the settlement base when the system report id is occupied', () => {
    const previousState = {
      currentDate: '189-09-01',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      resources: makeResources({ money: 100, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      holdings: [],
      troops: [],
      privateAssets: [makeSixMoneyPrivateAsset()],
      privateAssetProjects: [],
      domesticReports: [],
      turnLog: [],
    } as any;
    const preview = prepareHoldingAnnualSettlement(previousState);
    expect(preview?.income.money).toBe(6);
    const postWritebackState = {
      ...previousState,
      resources: makeResources({ money: 150, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      domesticReports: [{
        reportId: 'system:holding-annual:189',
        source: 'llm',
        kind: 'specialDomesticReport',
        year: 189,
        settledAt: '189-09-01',
        title: 'Occupied id',
        summary: 'Must be preserved without changing the resource base.',
        income: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
        expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
        netChange: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
        readByPlayer: false,
      }],
    } as any;

    const result = applyHoldingAnnualSettlementRuntime(postWritebackState, preview);

    expect(result.state.resources?.money).toBe(156);
    expect(result.state.domesticReports?.find((report) => report.title === 'Occupied id')?.reportId).toBe(
      'legacy-conflict:system:holding-annual:189:year-189:1',
    );
  });

  it('keeps the post-writeback resource base through preview and later-year settlement composition', () => {
    const previousState = {
      currentDate: '189-09-01',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      resources: makeResources({ money: 100, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      holdings: [],
      troops: [],
      privateAssets: [makeSixMoneyPrivateAsset()],
      privateAssetProjects: [],
      domesticReports: [],
      turnLog: [],
    } as any;
    const preview = prepareHoldingAnnualSettlement(previousState);
    const postWritebackState = {
      ...previousState,
      currentDate: '190-10-02',
      currentTime: { year: 190, month: 10, day: 2, hour: 8, minute: 0 },
      resources: makeResources({ money: 150, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      domesticReports: [{
        reportId: 'system:holding-annual:189',
        source: 'llm',
        year: 189,
        settledAt: '189-09-01',
        title: 'Occupied id before long jump',
        summary: 'Preserve this report.',
        income: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
        expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
        netChange: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
        readByPlayer: false,
      }],
    } as any;

    const result = applyHoldingAnnualSettlementRuntime(postWritebackState, preview, { previousState });

    expect(result.state.resources?.money).toBe(162);
    expect(result.state.domesticReports?.filter((report) => report.kind === 'holdingAnnualSettlement').map((report) => report.year)).toEqual([189, 190]);
  });

  it('does not charge yearly troop upkeep during the ninth-month harvest settlement', () => {
    const baseState = {
      currentDate: '189-09-01',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      resources: makeResources({ money: 100, grain: 1000, horses: 20, arms: 10, recruits: 30 }),
      holdings: [makeHolding()],
      troops: [makeTroop({ troopType: '骑兵', quality: '高' })],
      privateAssets: [],
      privateAssetProjects: [],
      domesticReports: [],
      turnLog: [
        {
          turnNumber: 1,
          date: '189-09-01',
          playerInput: 'check the accounts',
          narrativeText: 'The account books are opened.',
          fullNarrativeText: 'The account books are opened.',
          statePatchSummary: 'LLM writeback',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    } as any;
    const preview = prepareHoldingAnnualSettlement(baseState);
    expect(preview).toBeDefined();

    const result = applyHoldingAnnualSettlementRuntime(baseState, preview);

    expect(result.meta?.expenses).toEqual({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 });
    expect(result.state.resources?.grain).toBe(1000 + (preview?.income.grain ?? 0));
  });

  it('settles harvest income when a long time jump crosses ninth month', () => {
    const previousState = {
      currentDate: '189-08-28',
      currentTime: { year: 189, month: 8, day: 28, hour: 8, minute: 0 },
      resources: makeResources({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      holdings: [makeHolding()],
      troops: [],
      privateAssets: [],
      privateAssetProjects: [],
      domesticReports: [],
      turnLog: [
        {
          turnNumber: 1,
          date: '189-08-28',
          playerInput: 'wait',
          narrativeText: 'Waiting.',
          statePatchSummary: 'none',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    } as any;
    const crossedState = {
      ...previousState,
      currentDate: '189-10-02',
      currentTime: { year: 189, month: 10, day: 2, hour: 8, minute: 0 },
      domesticReports: [
        {
          reportId: 'domestic_189',
          year: 189,
          settledAt: '189-09-01',
          title: 'Legacy annual report',
          summary: 'This old report remains readable but is not the system settlement.',
          income: { money: 1, grain: 1, horses: 0, arms: 0, recruits: 0 },
          expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
          netChange: { money: 1, grain: 1, horses: 0, arms: 0, recruits: 0 },
          readByPlayer: true,
        },
        {
          reportId: 'system:holding-annual:189',
          year: 188,
          settledAt: '189-09-01',
          title: 'Mismatched system collision',
          summary: 'A wrong year must not suppress local settlement.',
          income: { money: 999, grain: 999, horses: 999, arms: 999, recruits: 999 },
          expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
          netChange: { money: 999, grain: 999, horses: 999, arms: 999, recruits: 999 },
          source: 'system',
          kind: 'holdingAnnualSettlement',
          readByPlayer: false,
        },
      ],
    } as any;

    const result = applyHoldingAnnualSettlementRuntime(crossedState, undefined, { previousState });

    expect(result.meta?.reportId).toBe('system:holding-annual:189');
    expect(result.state.domesticReports?.filter((report) => report.reportId === 'system:holding-annual:189')).toHaveLength(1);
    expect(result.state.domesticReports?.find((report) => report.reportId === 'system:holding-annual:189')).toMatchObject({
      year: 189,
      source: 'system',
      kind: 'holdingAnnualSettlement',
    });
    const legacyReport = result.state.domesticReports?.find((report) => report.reportId === 'domestic_189');
    expect(legacyReport).toMatchObject({ title: 'Legacy annual report' });
    expect(legacyReport?.source).toBeUndefined();
    expect(legacyReport?.kind).toBeUndefined();
    expect(result.state.domesticReports?.find((report) => report.title === 'Mismatched system collision')).toMatchObject({
      reportId: 'legacy-conflict:system:holding-annual:189:year-188:1',
      year: 188,
      source: 'system',
      kind: 'holdingAnnualSettlement',
      summary: 'A wrong year must not suppress local settlement.',
    });
    expect(new Set(result.state.domesticReports?.map((report) => report.reportId)).size).toBe(
      result.state.domesticReports?.length,
    );
    expect(result.state.resources?.grain).toBeGreaterThan(0);
  });

  it('upgrades a reliable legacy annual report without settling the same September twice', () => {
    const baseState = {
      currentDate: '189-09-15',
      currentTime: { year: 189, month: 9, day: 15, hour: 8, minute: 0 },
      resources: makeResources(),
      holdings: [makeHolding()],
      troops: [],
      privateAssets: [],
      privateAssetProjects: [],
      domesticReports: [makeLegacyAnnualSettlementReport()],
      turnLog: [{
        turnNumber: 1,
        date: '189-09-15',
        playerInput: 'inspect the accounts',
        narrativeText: 'The old accounts are opened.',
        statePatchSummary: 'none',
        timestamp: '2026-01-01T00:00:00.000Z',
      }],
    } as any;
    const originalResources = structuredClone(baseState.resources);
    const originalCorruption = baseState.holdings[0].corruption;

    const first = applyHoldingAnnualSettlementRuntime(baseState);
    const second = applyHoldingAnnualSettlementRuntime(first.state);

    expect(first.meta).toBeUndefined();
    expect(first.state.resources).toEqual(originalResources);
    expect(first.state.holdings?.[0].corruption).toBe(originalCorruption);
    expect(first.state.domesticReports).toEqual([
      expect.objectContaining({
        reportId: 'system:holding-annual:189',
        source: 'system',
        kind: 'holdingAnnualSettlement',
        title: '189年内政收支',
      }),
    ]);
    expect(first.state.turnLog[0].statePatchSummary).toBe('none');
    expect(first.state.turnLog[0].displayMeta?.holdingAnnualSettlement).toBeUndefined();
    expect(second.meta).toBeUndefined();
    expect(second.state).toEqual(first.state);
  });

  it('uses a reliable legacy annual report as the settled marker after crossing September', () => {
    const previousState = {
      currentDate: '189-08-28',
      currentTime: { year: 189, month: 8, day: 28, hour: 8, minute: 0 },
      resources: makeResources(),
      holdings: [makeHolding()],
      troops: [],
      privateAssets: [],
      privateAssetProjects: [],
      domesticReports: [],
      turnLog: [],
    } as any;
    const crossedState = {
      ...previousState,
      currentDate: '189-10-02',
      currentTime: { year: 189, month: 10, day: 2, hour: 8, minute: 0 },
      domesticReports: [makeLegacyAnnualSettlementReport()],
    } as any;

    const result = applyHoldingAnnualSettlementRuntime(crossedState, undefined, { previousState });

    expect(result.meta).toBeUndefined();
    expect(result.state.resources).toEqual(crossedState.resources);
    expect(result.state.holdings?.[0].corruption).toBe(crossedState.holdings[0].corruption);
    expect(result.state.domesticReports).toEqual([
      expect.objectContaining({
        reportId: 'system:holding-annual:189',
        source: 'system',
        kind: 'holdingAnnualSettlement',
      }),
    ]);
  });

  it.each([
    ['arbitrary title', { title: '189 private notes' }],
    ['arbitrary summary', { summary: 'The model invented an annual report.' }],
    ['missing delta', { netChange: undefined }],
    ['non-September timestamp', { settledAt: '189-08-31 08:00' }],
    ['model source', { source: 'llm' }],
  ])('does not mistake an ordinary domestic report with %s for a legacy system settlement', (_case, override) => {
    const state = {
      currentDate: '189-09-15',
      currentTime: { year: 189, month: 9, day: 15, hour: 8, minute: 0 },
      resources: makeResources({ money: 100, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      holdings: [],
      troops: [],
      privateAssets: [makeSixMoneyPrivateAsset()],
      privateAssetProjects: [],
      domesticReports: [makeLegacyAnnualSettlementReport(override)],
      turnLog: [],
    } as any;

    const result = applyHoldingAnnualSettlementRuntime(state);

    expect(result.meta?.status).toBe('applied');
    expect(result.state.resources?.money).toBe(106);
    expect(result.state.domesticReports?.some((report) => report.reportId === 'system:holding-annual:189')).toBe(true);
    expect(result.state.domesticReports?.some((report) => report.reportId === 'domestic_189')).toBe(true);
  });

  it('upgrades a reliable legacy report and preserves a conflicting reserved-id report', () => {
    const reservedConflict = {
      ...makeLegacyAnnualSettlementReport(),
      reportId: 'system:holding-annual:189',
      source: 'llm',
      title: 'Imported model report',
      summary: 'This model-authored content must be preserved.',
    };
    const state = {
      currentDate: '189-09-15',
      currentTime: { year: 189, month: 9, day: 15, hour: 8, minute: 0 },
      resources: makeResources(),
      holdings: [makeHolding()],
      troops: [],
      privateAssets: [],
      privateAssetProjects: [],
      domesticReports: [makeLegacyAnnualSettlementReport(), reservedConflict],
      turnLog: [],
    } as any;

    const first = applyHoldingAnnualSettlementRuntime(state);
    const second = applyHoldingAnnualSettlementRuntime(first.state);
    const ids = first.state.domesticReports?.map((report) => report.reportId) ?? [];

    expect(first.meta).toBeUndefined();
    expect(first.state.resources).toEqual(state.resources);
    expect(first.state.holdings?.[0].corruption).toBe(state.holdings[0].corruption);
    expect(first.state.domesticReports).toHaveLength(2);
    expect(first.state.domesticReports?.find((report) => report.title === '189年内政收支')).toMatchObject({
      reportId: 'system:holding-annual:189',
      source: 'system',
      kind: 'holdingAnnualSettlement',
    });
    expect(first.state.domesticReports?.find((report) => report.title === 'Imported model report')).toEqual({
      ...reservedConflict,
      reportId: 'legacy-conflict:system:holding-annual:189:year-189:1',
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.state).toEqual(first.state);
  });

  it('is idempotent only when the reserved report has the complete system identity', () => {
    const baseState = {
      currentDate: '189-09-01',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      resources: makeResources(),
      holdings: [makeHolding()],
      troops: [],
      privateAssets: [],
      privateAssetProjects: [],
      domesticReports: [],
      turnLog: [],
    } as any;
    const preview = prepareHoldingAnnualSettlement(baseState);
    expect(preview).toBeDefined();

    const first = applyHoldingAnnualSettlementRuntime(baseState, preview);
    const second = applyHoldingAnnualSettlementRuntime(first.state, preview);

    expect(first.meta?.status).toBe('applied');
    expect(second.meta).toBeUndefined();
    expect(second.state.resources).toEqual(first.state.resources);
    expect(second.state.domesticReports?.filter((report) => report.reportId === 'system:holding-annual:189')).toHaveLength(1);
  });

  it('deduplicates repeated canonical system reports and relocates divergent duplicates without settling again', () => {
    const baseState = {
      currentDate: '189-09-01',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      resources: makeResources({ money: 100, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      holdings: [],
      troops: [],
      privateAssets: [makeSixMoneyPrivateAsset()],
      privateAssetProjects: [],
      domesticReports: [],
      turnLog: [],
    } as any;
    const preview = prepareHoldingAnnualSettlement(baseState);
    expect(preview).toBeDefined();
    const canonicalReport = preview!.report;
    const exactDuplicate = {
      ...canonicalReport,
      income: { ...canonicalReport.income },
      expenses: { ...canonicalReport.expenses },
      netChange: { ...canonicalReport.netChange },
      privateAssetHighlights: canonicalReport.privateAssetHighlights?.map((highlight) => ({ ...highlight })),
    };
    const divergentDuplicate = {
      ...canonicalReport,
      title: 'Imported divergent canonical report',
      summary: 'Preserve this divergent imported content.',
      warnings: ['Imported warning must survive relocation.'],
    };
    const importedState = {
      ...baseState,
      domesticReports: [canonicalReport, exactDuplicate, divergentDuplicate],
    } as any;

    const result = applyHoldingAnnualSettlementRuntime(importedState, preview);
    const canonicalReports = result.state.domesticReports?.filter(
      (report) => report.reportId === 'system:holding-annual:189',
    ) ?? [];
    const relocated = result.state.domesticReports?.find(
      (report) => report.title === divergentDuplicate.title,
    );

    expect(result.meta).toBeUndefined();
    expect(result.state.resources?.money).toBe(100);
    expect(canonicalReports).toEqual([canonicalReport]);
    expect(relocated).toEqual({
      ...divergentDuplicate,
      reportId: 'legacy-conflict:system:holding-annual:189:year-189:1',
    });
    expect(result.state.domesticReports).toHaveLength(2);
    expect(new Set(result.state.domesticReports?.map((report) => report.reportId)).size).toBe(2);

    const repeated = applyHoldingAnnualSettlementRuntime(result.state, preview);
    expect(repeated.meta).toBeUndefined();
    expect(repeated.state.domesticReports).toEqual(result.state.domesticReports);
    expect(repeated.state.resources).toEqual(result.state.resources);
  });

  it('settles every crossed September in year order with boundary timestamps', () => {
    const previousState = {
      currentDate: '189-08-28',
      currentTime: { year: 189, month: 8, day: 28, hour: 8, minute: 0 },
      resources: makeResources({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      holdings: [makeHolding()],
      troops: [],
      privateAssets: [],
      privateAssetProjects: [],
      domesticReports: [],
      turnLog: [{
        turnNumber: 1,
        date: '189-08-28',
        playerInput: 'wait',
        narrativeText: 'Waiting.',
        statePatchSummary: 'none',
        timestamp: '2026-01-01T00:00:00.000Z',
      }],
    } as any;
    const crossedState = {
      ...previousState,
      currentDate: '190-10-02',
      currentTime: { year: 190, month: 10, day: 2, hour: 8, minute: 0 },
    } as any;

    const result = applyHoldingAnnualSettlementRuntime(crossedState, undefined, { previousState });
    const annualReports = result.state.domesticReports?.filter((report) => report.kind === 'holdingAnnualSettlement') ?? [];

    expect(annualReports.map((report) => report.reportId)).toEqual([
      'system:holding-annual:189',
      'system:holding-annual:190',
    ]);
    expect(annualReports.map((report) => report.settledAt)).toEqual([
      '189-09-01 08:00',
      '190-09-01 08:00',
    ]);
    expect(result.state.resources?.money).toBe(
      annualReports.reduce((total, report) => total + report.netChange.money, 0),
    );
    expect(result.state.holdings?.[0].corruption).toBe(makeHolding().corruption! + 6);
    expect(result.state.turnLog[0].statePatchSummary.indexOf('system:holding-annual:189')).toBeLessThan(
      result.state.turnLog[0].statePatchSummary.indexOf('system:holding-annual:190'),
    );
    expect(result.meta?.year).toBe(190);
  });

  it('keeps crossed September settlement order when the final state is itself in September', () => {
    const previousState = {
      currentDate: '189-08-28',
      currentTime: { year: 189, month: 8, day: 28, hour: 8, minute: 0 },
      resources: makeResources({ money: 100, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      holdings: [],
      troops: [],
      privateAssets: [makeSixMoneyPrivateAsset()],
      privateAssetProjects: [],
      domesticReports: [],
      turnLog: [],
    } as any;
    const finalSeptemberState = {
      ...previousState,
      currentDate: '190-09-02',
      currentTime: { year: 190, month: 9, day: 2, hour: 8, minute: 0 },
    } as any;

    const result = applyHoldingAnnualSettlementRuntime(finalSeptemberState, undefined, { previousState });
    const annualReports = result.state.domesticReports?.filter((report) => report.kind === 'holdingAnnualSettlement') ?? [];

    expect(annualReports.map((report) => report.reportId)).toEqual([
      'system:holding-annual:189',
      'system:holding-annual:190',
    ]);
    expect(annualReports.map((report) => report.settledAt)).toEqual([
      '189-09-01 08:00',
      '190-09-01 08:00',
    ]);
    expect(result.state.resources?.money).toBe(112);
    expect(result.meta?.year).toBe(190);
  });

  it('skips an existing system settlement year without blocking later crossed Septembers', () => {
    const existing190Report = {
      reportId: 'system:holding-annual:190',
      source: 'system',
      kind: 'holdingAnnualSettlement',
      year: 190,
      settledAt: '190-09-01 08:00',
      title: '190年内政收支',
      summary: 'Already settled.',
      income: { money: 1, grain: 2, horses: 0, arms: 0, recruits: 0 },
      expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 1, grain: 2, horses: 0, arms: 0, recruits: 0 },
      readByPlayer: true,
    };
    const previousState = {
      currentDate: '189-08-28',
      currentTime: { year: 189, month: 8, day: 28, hour: 8, minute: 0 },
      resources: makeResources({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      holdings: [makeHolding()],
      troops: [],
      privateAssets: [],
      privateAssetProjects: [],
      domesticReports: [],
      turnLog: [{
        turnNumber: 1,
        date: '189-08-28',
        playerInput: 'wait longer',
        narrativeText: 'Waiting longer.',
        statePatchSummary: 'none',
        timestamp: '2026-01-01T00:00:00.000Z',
      }],
    } as any;
    const crossedState = {
      ...previousState,
      currentDate: '191-10-02',
      currentTime: { year: 191, month: 10, day: 2, hour: 8, minute: 0 },
      domesticReports: [existing190Report],
    } as any;

    const result = applyHoldingAnnualSettlementRuntime(crossedState, undefined, { previousState });
    const annualReports = result.state.domesticReports?.filter((report) => report.kind === 'holdingAnnualSettlement') ?? [];

    expect(annualReports.map((report) => report.reportId).sort()).toEqual([
      'system:holding-annual:189',
      'system:holding-annual:190',
      'system:holding-annual:191',
    ]);
    expect(annualReports.find((report) => report.year === 190)).toEqual(existing190Report);
    expect(annualReports.find((report) => report.year === 189)?.settledAt).toBe('189-09-01 08:00');
    expect(annualReports.find((report) => report.year === 191)?.settledAt).toBe('191-09-01 08:00');
    expect(result.state.turnLog[0].statePatchSummary).not.toContain('年度结算[system:holding-annual:190]');
    expect(result.state.turnLog[0].statePatchSummary.indexOf('system:holding-annual:189')).toBeLessThan(
      result.state.turnLog[0].statePatchSummary.indexOf('system:holding-annual:191'),
    );
    expect(result.meta?.year).toBe(191);
  });

  it('continues later crossed September settlements after applying a precomputed current-year preview', () => {
    const previousState = {
      currentDate: '189-09-01',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      resources: makeResources({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      holdings: [makeHolding()],
      troops: [],
      privateAssets: [],
      privateAssetProjects: [],
      domesticReports: [],
      turnLog: [{
        turnNumber: 1,
        date: '189-09-01',
        playerInput: 'wait through next year',
        narrativeText: 'Waiting.',
        statePatchSummary: 'none',
        timestamp: '2026-01-01T00:00:00.000Z',
      }],
    } as any;
    const preview = prepareHoldingAnnualSettlement(previousState);
    expect(preview).toBeDefined();
    const crossedState = {
      ...previousState,
      currentDate: '190-10-02',
      currentTime: { year: 190, month: 10, day: 2, hour: 8, minute: 0 },
    } as any;

    const result = applyHoldingAnnualSettlementRuntime(crossedState, preview, { previousState });

    expect(result.state.domesticReports?.filter((report) => report.kind === 'holdingAnnualSettlement').map((report) => report.reportId)).toEqual([
      'system:holding-annual:189',
      'system:holding-annual:190',
    ]);
    expect(result.meta?.year).toBe(190);
  });
});

describe('applyHoldingSettlementTimelineRuntime', () => {
  it('completes due private-asset projects on ordinary dated turns without waiting for September', () => {
    const previousState = makeSettlementTimelineState(189, 6, 1, {
      privateAssets: [makePrivateAsset()],
      privateAssetProjects: [makePrivateAssetProject({
        startedAt: '189-05-01',
        expectedCompleteAt: '189-06-02',
        updatedAt: '189-05-01',
      })],
    });
    const finalState = {
      ...previousState,
      currentDate: '189-06-03',
      currentTime: { year: 189, month: 6, day: 3, hour: 8, minute: 0 },
    } as any;

    const result = applyHoldingSettlementTimelineRuntime(finalState, previousState);

    expect(result.annualMeta).toBeUndefined();
    expect(result.monthlyMeta).toBeUndefined();
    expect(result.state.privateAssetProjects?.[0]).toMatchObject({
      projectId: 'project_expand_estate',
      status: 'completed',
      updatedAt: '189-06-03',
    });
    expect(result.state.privateAssets?.[0].mu).toBe(makePrivateAsset().mu! + 40);
    expect(result.state.privateAssets?.[0].households).toBe(makePrivateAsset().households! + 6);
    expect(result.state.turnLog[0].statePatchSummary).toContain('私产工程到期');
    expect(result.state.turnLog[0].statePatchSummary).toContain('project_expand_estate');
  });

  it('settles three crossed Septembers once in month order on rolling state', () => {
    const previousState = makeSettlementTimelineState(189, 8, 28, {
      privateAssets: [makePrivateAsset()],
      privateAssetProjects: [makePrivateAssetProject()],
    });
    const finalState = {
      ...previousState,
      currentDate: '191-10-02',
      currentTime: { year: 191, month: 10, day: 2, hour: 8, minute: 0 },
    } as any;

    const result = applyHoldingSettlementTimelineRuntime(finalState, previousState);
    const reports = result.state.domesticReports ?? [];
    const annualReports = reports.filter((report) => report.kind === 'holdingAnnualSettlement');
    const monthlyReports = reports.filter((report) => report.kind === 'holdingMonthlyUpkeep');

    expect(annualReports.map((report) => report.reportId)).toEqual([
      'system:holding-annual:189',
      'system:holding-annual:190',
      'system:holding-annual:191',
    ]);
    expect(annualReports.map((report) => report.settledAt)).toEqual([
      '189-09-01 08:00',
      '190-09-01 08:00',
      '191-09-01 08:00',
    ]);
    expect(result.annualMeta?.year).toBe(191);
    expect(result.state.holdings?.[0].corruption).toBe(makeHolding().corruption! + 9);
    expect(result.state.privateAssetProjects?.[0].status).toBe('completed');
    expect(result.state.privateAssets?.[0].mu).toBe(makePrivateAsset().mu! + 40);

    expect(monthlyReports).toHaveLength(26);
    expect(result.monthlyMeta?.settledMonths).toHaveLength(26);
    expect(monthlyReports[0].reportId).toBe('system:holding-monthly-upkeep:189-09');
    expect(monthlyReports[monthlyReports.length - 1]?.reportId).toBe(
      'system:holding-monthly-upkeep:191-10',
    );
    expect(new Set(monthlyReports.map((report) => report.reportId)).size).toBe(monthlyReports.length);

    for (const year of [189, 190, 191]) {
      const annualIndex = reports.findIndex((report) => report.reportId === `system:holding-annual:${year}`);
      const septemberUpkeepIndex = reports.findIndex(
        (report) => report.reportId === `system:holding-monthly-upkeep:${year}-09`,
      );
      expect(annualIndex).toBeGreaterThanOrEqual(0);
      expect(septemberUpkeepIndex).toBeGreaterThan(annualIndex);
    }

    expect(result.state.resources?.money).toBe(
      previousState.resources.money
        + reports.reduce((total, report) => total + report.netChange.money, 0),
    );
    const summary = result.state.turnLog[0].statePatchSummary;
    expect(summary.indexOf('system:holding-annual:189')).toBeLessThan(
      summary.indexOf('system:holding-annual:190'),
    );
    expect(summary.indexOf('system:holding-annual:190')).toBeLessThan(
      summary.indexOf('system:holding-annual:191'),
    );
  });

  it('keeps monthly upkeep ordered when a cross-year jump never reaches September', () => {
    const previousState = makeSettlementTimelineState(189, 10);
    const finalState = {
      ...previousState,
      currentDate: '190-08-02',
      currentTime: { year: 190, month: 8, day: 2, hour: 8, minute: 0 },
    } as any;
    const expectedMonthlyIds = [
      'system:holding-monthly-upkeep:189-11',
      'system:holding-monthly-upkeep:189-12',
      'system:holding-monthly-upkeep:190-01',
      'system:holding-monthly-upkeep:190-02',
      'system:holding-monthly-upkeep:190-03',
      'system:holding-monthly-upkeep:190-04',
      'system:holding-monthly-upkeep:190-05',
      'system:holding-monthly-upkeep:190-06',
      'system:holding-monthly-upkeep:190-07',
      'system:holding-monthly-upkeep:190-08',
    ];

    const result = applyHoldingSettlementTimelineRuntime(finalState, previousState);
    const annualReports = result.state.domesticReports?.filter(
      (report) => report.kind === 'holdingAnnualSettlement',
    ) ?? [];
    const monthlyIds = result.state.domesticReports
      ?.filter((report) => report.kind === 'holdingMonthlyUpkeep')
      .map((report) => report.reportId) ?? [];

    expect(result.annualMeta).toBeUndefined();
    expect(annualReports).toEqual([]);
    expect(result.monthlyMeta?.settledMonths.map((month) => month.monthId)).toEqual(expectedMonthlyIds);
    expect(monthlyIds).toEqual(expectedMonthlyIds);
    expect(new Set(monthlyIds).size).toBe(monthlyIds.length);
    expect(result.state.turnLog[0].statePatchSummary).not.toContain('年度结算[');
  });

  it('is idempotent when the settled timeline is replayed from the original previous state', () => {
    const previousState = makeSettlementTimelineState(189, 8, 28);
    const finalState = {
      ...previousState,
      currentDate: '189-10-02',
      currentTime: { year: 189, month: 10, day: 2, hour: 8, minute: 0 },
    } as any;
    const first = applyHoldingSettlementTimelineRuntime(finalState, previousState);

    const repeated = applyHoldingSettlementTimelineRuntime(first.state, previousState);

    expect(first.annualMeta?.year).toBe(189);
    expect(first.monthlyMeta?.settledMonths.map((month) => month.monthId)).toEqual([
      'system:holding-monthly-upkeep:189-09',
      'system:holding-monthly-upkeep:189-10',
    ]);
    expect(repeated.annualMeta).toBeUndefined();
    expect(repeated.monthlyMeta).toBeUndefined();
    expect(repeated.state.resources).toEqual(first.state.resources);
    expect(repeated.state.troops).toEqual(first.state.troops);
    expect(repeated.state.domesticReports).toEqual(first.state.domesticReports);
    expect(repeated.state.turnLog).toEqual(first.state.turnLog);
  });

  it('applies a current-September preview once before later crossed settlements', () => {
    const previousState = makeSettlementTimelineState(189, 9, 1, {
      privateAssets: [makeSixMoneyPrivateAsset()],
    });
    const preview = prepareHoldingAnnualSettlement(previousState);
    expect(preview?.year).toBe(189);
    const finalState = {
      ...previousState,
      currentDate: '190-10-02',
      currentTime: { year: 190, month: 10, day: 2, hour: 8, minute: 0 },
      resources: makeResources({
        money: 120_000,
        grain: 120_000,
        horses: 120_000,
        arms: 120_000,
        recruits: 120_000,
      }),
    } as any;

    const result = applyHoldingSettlementTimelineRuntime(finalState, previousState, preview);
    const annualReports = result.state.domesticReports?.filter(
      (report) => report.kind === 'holdingAnnualSettlement',
    ) ?? [];
    const summary = result.state.turnLog[0].statePatchSummary;

    expect(annualReports.map((report) => report.reportId)).toEqual([
      'system:holding-annual:189',
      'system:holding-annual:190',
    ]);
    expect(new Set(annualReports.map((report) => report.reportId)).size).toBe(2);
    expect(result.annualMeta?.year).toBe(190);
    expect(summary.match(/system:holding-annual:189/g)).toHaveLength(1);
    expect(summary.match(/system:holding-annual:190/g)).toHaveLength(1);
    expect(summary.indexOf('system:holding-annual:189')).toBeLessThan(
      summary.indexOf('system:holding-annual:190'),
    );
    const settledMonths = result.monthlyMeta?.settledMonths ?? [];
    expect(settledMonths[settledMonths.length - 1]?.monthId).toBe(
      'system:holding-monthly-upkeep:190-10',
    );
  });
});

describe('applyHoldingMonthlyUpkeepRuntime', () => {
  it('never charges allied, enemy, or neutral armies to the player even when legacy upkeep sources are wrong', () => {
    const playerTroop = makeTroop({
      troopId: 'troop_player_guard',
      name: '主角直属亲军',
      size: 120,
      upkeepSource: 'player_resources',
    });
    const externalTroops = [
      makeTroop({
        troopId: 'troop_cao_cavalry',
        name: '曹操东甲骑兵',
        size: 1000,
        factionId: 'faction_han_court',
        relationToPlayer: '友军',
        leaderNpcId: 'npc_cao_cao',
        upkeepSource: 'player_resources',
      }),
      makeTroop({
        troopId: 'troop_yellow_turban_guard',
        name: '阳翟黄巾守军',
        size: 3000,
        factionId: 'faction_taipingdao',
        relationToPlayer: '敌对',
        leaderNpcId: 'npc_bo_cai',
        upkeepSource: 'player_resources',
      }),
      makeTroop({
        troopId: 'troop_external_unknown',
        name: '长社汉军主力',
        size: 10000,
        factionId: 'faction_han_court',
        relationToPlayer: '友军',
        leaderNpcId: 'npc_huangfu_song',
        upkeepSource: 'unknown',
      }),
      makeTroop({
        troopId: 'troop_external_mixed',
        name: '协同部队',
        size: 800,
        factionId: 'faction_han_court',
        relationToPlayer: '协同友军',
        leaderNpcId: 'npc_ally_general',
        upkeepSource: 'mixed',
      }),
    ];
    const previousState = {
      currentDate: '189-07-02',
      currentTime: { year: 189, month: 7, day: 2, hour: 8, minute: 0 },
      resources: makeResources({ money: 5000, grain: 50000, horses: 500, arms: 500, recruits: 0 }),
      holdings: [makeHolding()],
      factions: [{
        factionId: 'faction_han_court',
        name: '汉室朝廷',
        type: '朝廷',
        summary: '主角当前效力的朝廷，但并非由主角控制。',
        stanceToPlayer: '自势力相关',
        knownLevel: '亲历',
        recentActions: [],
      }],
      troops: [playerTroop, ...externalTroops],
      domesticReports: [],
      turnLog: [],
    } as any;
    const currentState = {
      ...previousState,
      currentDate: '189-08-02',
      currentTime: { year: 189, month: 8, day: 2, hour: 8, minute: 0 },
    } as any;

    const preview = calculateHoldingMonthlyUpkeepPreview(currentState);
    const result = applyHoldingMonthlyUpkeepRuntime(currentState, previousState);

    expect(preview?.activeTroopCount).toBe(1);
    expect(preview?.troopBreakdown.map((entry) => entry.troopId)).toEqual(['troop_player_guard']);
    expect(preview?.sourceTroopCounts).toEqual({
      player_resources: 1,
      superior_provision: 0,
      mixed: 0,
    });
    expect(result.state.resources).toMatchObject({
      money: 5000 - (preview?.playerRequiredExpenses.money ?? 0),
      grain: 50000 - (preview?.playerRequiredExpenses.grain ?? 0),
      horses: 500 - (preview?.playerRequiredExpenses.horses ?? 0),
      arms: 500 - (preview?.playerRequiredExpenses.arms ?? 0),
    });
    expect(result.state.troops?.slice(1)).toEqual(externalTroops);
  });

  it('keeps directly commanded government troops in the ledger while respecting superior provision', () => {
    const troop = makeTroop({
      troopId: 'troop_han_direct_command',
      factionId: 'faction_han_court',
      relationToPlayer: '你直接统领',
      leaderNpcId: 'player',
      upkeepSource: 'superior_provision',
    });
    const state = {
      currentDate: '189-08-02',
      currentTime: { year: 189, month: 8, day: 2, hour: 8, minute: 0 },
      resources: makeResources(),
      troops: [troop],
      holdings: [],
    } as any;

    const preview = calculateHoldingMonthlyUpkeepPreview(state);

    expect(preview?.troopBreakdown).toEqual([
      expect.objectContaining({
        troopId: 'troop_han_direct_command',
        source: 'superior_provision',
      }),
    ]);
    expect(preview?.playerRequiredExpenses).toEqual({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 });
  });

  it('recognizes a custom player faction only through its structured actual controller', () => {
    const troop = makeTroop({
      troopId: 'troop_custom_player_faction',
      factionId: 'faction_linyan_command',
      relationToPlayer: '自势力相关',
      leaderNpcId: 'npc_subordinate_general',
      upkeepSource: 'player_resources',
    });
    const state = {
      currentDate: '189-08-02',
      currentTime: { year: 189, month: 8, day: 2, hour: 8, minute: 0 },
      player: { id: 'player_linyan', name: '林砚' },
      resources: makeResources(),
      factions: [{
        factionId: 'faction_linyan_command',
        name: '林砚军府',
        type: '军府',
        summary: '主角自立军府。',
        stanceToPlayer: '自势力相关',
        actualController: 'player_linyan',
        knownLevel: '亲历',
        recentActions: [],
      }],
      troops: [troop],
      holdings: [],
    } as any;

    expect(calculateHoldingMonthlyUpkeepPreview(state)?.troopBreakdown).toEqual([
      expect.objectContaining({ troopId: 'troop_custom_player_faction', source: 'player_resources' }),
    ]);
  });

  it('does not create a player upkeep settlement when the ledger contains only external armies', () => {
    const externalTroop = makeTroop({
      troopId: 'troop_external_only',
      name: '黄巾外军',
      factionId: 'faction_taipingdao',
      relationToPlayer: '敌对',
      leaderNpcId: 'npc_yellow_turban_general',
      upkeepSource: 'player_resources',
    });
    const previousState = {
      currentDate: '189-07-02',
      currentTime: { year: 189, month: 7, day: 2, hour: 8, minute: 0 },
      resources: makeResources(),
      holdings: [makeHolding()],
      troops: [externalTroop],
      domesticReports: [],
      turnLog: [],
    } as any;
    const currentState = {
      ...previousState,
      currentDate: '189-08-02',
      currentTime: { year: 189, month: 8, day: 2, hour: 8, minute: 0 },
    } as any;

    const result = applyHoldingMonthlyUpkeepRuntime(currentState, previousState);

    expect(result.meta).toBeUndefined();
    expect(result.state.resources).toEqual(previousState.resources);
    expect(result.state.troops).toEqual([externalTroop]);
    expect(result.state.domesticReports).toEqual([]);
  });

  it('uses the same source-aware preview values for the actual monthly deduction', () => {
    const previousState = {
      currentDate: '189-07-02',
      currentTime: { year: 189, month: 7, day: 2, hour: 8, minute: 0 },
      resources: makeResources({ money: 200, grain: 5000, horses: 30, arms: 20, recruits: 0 }),
      troops: [
        makeTroop({ upkeepSource: 'player_resources', troopType: '步卒', quality: '中' }),
        makeTroop({
          troopId: 'troop_superior',
          factionId: 'faction_government',
          relationToPlayer: '友军',
          upkeepSource: 'superior_provision',
          troopType: '步卒',
          quality: '中',
          supplies: 60,
        }),
      ],
      domesticReports: [],
      turnLog: [],
    } as any;
    const currentState = {
      ...previousState,
      currentDate: '189-08-02',
      currentTime: { year: 189, month: 8, day: 2, hour: 8, minute: 0 },
    } as any;
    const preview = calculateHoldingMonthlyUpkeepPreview(currentState);

    const result = applyHoldingMonthlyUpkeepRuntime(currentState, previousState);
    const settled = result.meta?.settledMonths[0];

    expect(preview).toBeDefined();
    expect(settled?.income).toEqual(preview?.income);
    expect(settled?.requiredExpenses).toEqual(preview?.requiredExpenses);
    expect(settled?.expenses).toEqual(preview?.expenses);
    expect(settled?.shortage).toEqual(preview?.shortage);
    expect(result.meta?.netChange).toEqual(preview?.netChange);
  });

  it('charges one month of troop upkeep for each crossed month boundary', () => {
    const previousState = {
      currentDate: '189-04-02',
      currentTime: { year: 189, month: 4, day: 2, hour: 8, minute: 0 },
      resources: makeResources({ money: 200, grain: 5000, horses: 30, arms: 20, recruits: 0 }),
      troops: [makeTroop({ size: 100, troopType: '骑兵', quality: '高' })],
      domesticReports: [],
      turnLog: [
        {
          turnNumber: 1,
          date: '189-04-02',
          playerInput: 'train for months',
          narrativeText: 'Training begins.',
          statePatchSummary: 'none',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    } as any;
    const currentState = {
      ...previousState,
      currentDate: '189-07-03',
      currentTime: { year: 189, month: 7, day: 3, hour: 8, minute: 0 },
    } as any;

    const result = applyHoldingMonthlyUpkeepRuntime(currentState, previousState);

    expect(result.meta?.settledMonths.map((month) => month.monthId)).toEqual([
      'system:holding-monthly-upkeep:189-05',
      'system:holding-monthly-upkeep:189-06',
      'system:holding-monthly-upkeep:189-07',
    ]);
    expect(result.meta?.expenses).toEqual({ money: 27, grain: 489, horses: 6, arms: 3, recruits: 0 });
    expect(result.state.resources).toMatchObject({
      money: 173,
      grain: 4511,
      horses: 24,
      arms: 17,
    });
    expect(result.state.domesticReports?.map((report) => report.reportId)).toEqual([
      'system:holding-monthly-upkeep:189-05',
      'system:holding-monthly-upkeep:189-06',
      'system:holding-monthly-upkeep:189-07',
    ]);
    expect(result.state.domesticReports).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'system', kind: 'holdingMonthlyUpkeep' }),
    ]));
  });

  it('does not charge the same monthly upkeep twice', () => {
    const previousState = {
      currentDate: '189-04-02',
      currentTime: { year: 189, month: 4, day: 2, hour: 8, minute: 0 },
      resources: makeResources({ money: 200, grain: 5000, horses: 30, arms: 20, recruits: 0 }),
      troops: [makeTroop({ size: 100, troopType: '步卒', quality: '中' })],
      domesticReports: [
        {
          reportId: 'system:holding-monthly-upkeep:189-05',
          source: 'system',
          kind: 'holdingMonthlyUpkeep',
          year: '189-05',
          settledAt: '189-05-01',
          title: '189年05月军需消耗',
          summary: 'Already charged.',
          income: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
          expenses: { money: 60, grain: 100, horses: 0, arms: 5, recruits: 0 },
          netChange: { money: -60, grain: -100, horses: 0, arms: -5, recruits: 0 },
          readByPlayer: false,
        },
      ],
      turnLog: [],
    } as any;
    const currentState = {
      ...previousState,
      currentDate: '189-06-02',
      currentTime: { year: 189, month: 6, day: 2, hour: 8, minute: 0 },
    } as any;

    const result = applyHoldingMonthlyUpkeepRuntime(currentState, previousState);

    expect(result.meta?.settledMonths.map((month) => month.monthId)).toEqual([
      'system:holding-monthly-upkeep:189-06',
    ]);
    expect(result.state.resources?.grain).toBe(4900);
  });

  it('records monthly upkeep shortages separately from actual stockpile deductions', () => {
    const previousState = {
      currentDate: '189-07-02',
      currentTime: { year: 189, month: 7, day: 2, hour: 8, minute: 0 },
      resources: makeResources({ money: 20, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      troops: [makeTroop({ size: 100, troopType: '步卒', quality: '中' })],
      domesticReports: [],
      turnLog: [],
    } as any;
    const currentState = {
      ...previousState,
      currentDate: '189-08-02',
      currentTime: { year: 189, month: 8, day: 2, hour: 8, minute: 0 },
    } as any;

    const result = applyHoldingMonthlyUpkeepRuntime(currentState, previousState);
    const report = result.state.domesticReports?.find(
      (entry) => entry.reportId === 'system:holding-monthly-upkeep:189-08',
    );

    expect(result.state.resources).toMatchObject({
      money: 15,
      grain: 0,
      horses: 0,
      arms: 0,
    });
    expect(report?.expenses).toEqual({ money: 5, grain: 0, horses: 0, arms: 0, recruits: 0 });
    expect(report?.netChange).toEqual({ money: -5, grain: 0, horses: 0, arms: 0, recruits: 0 });
    expect(report?.summary).toContain('缺口 粮草100石');
  });

  it('allows story-written grain to enter the ledger before monthly upkeep is deducted', () => {
    const previousState = {
      currentDate: '189-07-02',
      currentTime: { year: 189, month: 7, day: 2, hour: 8, minute: 0 },
      resources: makeResources({ money: 20, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      troops: [makeTroop({ size: 100, troopType: '步卒', quality: '中' })],
      domesticReports: [],
      turnLog: [],
    } as any;
    const currentState = {
      ...previousState,
      currentDate: '189-08-02',
      currentTime: { year: 189, month: 8, day: 2, hour: 8, minute: 0 },
      resources: makeResources({ money: 20, grain: 150, horses: 0, arms: 2, recruits: 0 }),
    } as any;

    const result = applyHoldingMonthlyUpkeepRuntime(currentState, previousState);
    const report = result.state.domesticReports?.find(
      (entry) => entry.reportId === 'system:holding-monthly-upkeep:189-08',
    );

    expect(result.state.resources).toMatchObject({
      money: 15,
      grain: 50,
      horses: 0,
      arms: 2,
    });
    expect(report?.expenses).toEqual({ money: 5, grain: 100, horses: 0, arms: 0, recruits: 0 });
    expect(report?.summary).not.toContain('缺口');
  });

  it('uses superior provision for non-independent troops without draining player resources', () => {
    const previousState = {
      currentDate: '189-07-02',
      currentTime: { year: 189, month: 7, day: 2, hour: 8, minute: 0 },
      resources: makeResources({ money: 20, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      troops: [makeTroop({
        size: 100,
        troopType: '步卒',
        quality: '中',
        supplies: 40,
        upkeepSource: 'superior_provision',
      })],
      domesticReports: [],
      turnLog: [],
    } as any;
    const currentState = {
      ...previousState,
      currentDate: '189-08-02',
      currentTime: { year: 189, month: 8, day: 2, hour: 8, minute: 0 },
    } as any;

    const result = applyHoldingMonthlyUpkeepRuntime(currentState, previousState);
    const report = result.state.domesticReports?.find(
      (entry) => entry.reportId === 'system:holding-monthly-upkeep:189-08',
    );

    expect(result.state.resources).toMatchObject({
      money: 20,
      grain: 0,
      horses: 0,
      arms: 0,
    });
    expect(result.state.troops?.[0]?.supplies).toBe(35);
    expect(report?.income).toEqual({ money: 5, grain: 90, horses: 0, arms: 0, recruits: 0 });
    expect(report?.expenses).toEqual({ money: 5, grain: 90, horses: 0, arms: 0, recruits: 0 });
    expect(report?.netChange).toEqual({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 });
    expect(report?.warnings?.join('\n')).toContain('军需缺口：粮草10石');
  });

  it('allows surplus superior provision to enter the player resource ledger', () => {
    const previousState = {
      currentDate: '189-07-02',
      currentTime: { year: 189, month: 7, day: 2, hour: 8, minute: 0 },
      resources: makeResources({ money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 }),
      troops: [makeTroop({
        size: 100,
        troopType: '步卒',
        quality: '中',
        supplies: 90,
        upkeepSource: 'superior_provision',
      })],
      domesticReports: [],
      turnLog: [],
    } as any;
    const currentState = {
      ...previousState,
      currentDate: '189-08-02',
      currentTime: { year: 189, month: 8, day: 2, hour: 8, minute: 0 },
    } as any;

    const result = applyHoldingMonthlyUpkeepRuntime(currentState, previousState);
    const report = result.state.domesticReports?.find(
      (entry) => entry.reportId === 'system:holding-monthly-upkeep:189-08',
    );

    expect(result.state.resources).toMatchObject({
      money: 1,
      grain: 10,
      horses: 0,
      arms: 0,
    });
    expect(result.state.troops?.[0]?.supplies).toBe(90);
    expect(report?.income).toEqual({ money: 6, grain: 110, horses: 0, arms: 0, recruits: 0 });
    expect(report?.expenses).toEqual({ money: 5, grain: 100, horses: 0, arms: 0, recruits: 0 });
    expect(report?.netChange).toEqual({ money: 1, grain: 10, horses: 0, arms: 0, recruits: 0 });
    expect(report?.summary).not.toContain('缺口');
  });

  it('does not let imported model reports preempt monthly upkeep and preserves id conflicts', () => {
    const oldIdReport = {
      reportId: 'upkeep_189_05',
      source: 'llm',
      kind: 'specialDomesticReport',
      year: '189-05',
      settledAt: '189-05-01',
      title: 'Model notes under the old id',
      summary: 'This is not a local upkeep settlement.',
      income: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      readByPlayer: true,
    };
    const reservedIdConflict = {
      ...oldIdReport,
      reportId: 'system:holding-monthly-upkeep:189-05',
      title: 'Imported reserved-id collision',
    };
    const previousState = {
      currentDate: '189-04-02',
      currentTime: { year: 189, month: 4, day: 2, hour: 8, minute: 0 },
      resources: makeResources({ money: 200, grain: 5000, horses: 30, arms: 20, recruits: 0 }),
      troops: [makeTroop({ size: 100, troopType: '步卒', quality: '中' })],
      domesticReports: [oldIdReport, reservedIdConflict],
      turnLog: [],
    } as any;
    const currentState = {
      ...previousState,
      currentDate: '189-05-02',
      currentTime: { year: 189, month: 5, day: 2, hour: 8, minute: 0 },
    } as any;

    const first = applyHoldingMonthlyUpkeepRuntime(currentState, previousState);
    const repeated = applyHoldingMonthlyUpkeepRuntime(first.state, previousState);
    const ids = first.state.domesticReports?.map((report) => report.reportId) ?? [];

    expect(first.meta?.status).toBe('applied');
    expect(first.state.resources?.money).toBeLessThan(200);
    expect(first.state.domesticReports?.find((report) => report.title === oldIdReport.title)).toEqual(oldIdReport);
    expect(first.state.domesticReports?.find((report) => report.title === reservedIdConflict.title)).toEqual({
      ...reservedIdConflict,
      reportId: 'legacy-conflict:system:holding-monthly-upkeep:189-05:year-189-05:1',
    });
    expect(first.state.domesticReports?.find(
      (report) => report.reportId === 'system:holding-monthly-upkeep:189-05',
    )).toMatchObject({ source: 'system', kind: 'holdingMonthlyUpkeep' });
    expect(new Set(ids).size).toBe(ids.length);
    expect(repeated.meta).toBeUndefined();
    expect(repeated.state).toEqual(first.state);
  });
});

describe('applyEmergencyHoldingLevy', () => {
  it('adds resources but damages local order and corruption for a harsh levy', () => {
    const holding = makeHolding({ popularSupport: 50, publicOrder: 45, corruption: 30 });

    const result = applyEmergencyHoldingLevy({
      holding,
      levyType: 'grain',
      intensity: 'heavy',
      repeatedThisYear: true,
    });

    expect(result.resourceGain.grain).toBeGreaterThan(0);
    expect(result.nextHolding.popularSupport).toBeLessThan(holding.popularSupport);
    expect(result.nextHolding.publicOrder).toBeLessThan(holding.publicOrder);
    expect(result.nextHolding.corruption!).toBeGreaterThan(holding.corruption!);
    expect(result.warnings.join('\n')).toContain('repeated');
  });
});
