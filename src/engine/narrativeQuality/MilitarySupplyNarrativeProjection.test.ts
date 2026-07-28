import { describe, expect, it } from 'vitest';
import type { ResourceLedger, RuntimeState, TroopLedgerEntry } from '../types';
import { calculateHoldingMonthlyUpkeepPreview } from '../holdings/HoldingAnnualSettlementRuntime';
import { buildMilitarySupplyNarrativeProjection } from './MilitarySupplyNarrativeProjection';

function makeResources(overrides: Partial<ResourceLedger> = {}): ResourceLedger {
  return {
    money: 50,
    grain: 1000,
    horses: 20,
    arms: 20,
    recruits: 0,
    weapons: [],
    documents: [],
    tokens: [],
    importantSupplies: [],
    ...overrides,
  };
}

function makeTroop(overrides: Partial<TroopLedgerEntry> = {}): TroopLedgerEntry {
  return {
    troopId: 'troop_player',
    name: '亲军步卒',
    size: 100,
    factionId: 'faction_player',
    troopType: '步卒',
    quality: '中',
    lifecycleStatus: 'active',
    morale: 70,
    training: 65,
    supplies: 60,
    task: '驻防',
    relationToPlayer: '你直接统领',
    locationId: 'loc_camp',
    upkeepSource: 'player_resources',
    ...overrides,
  };
}

function makeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    currentDate: '公元189年08月15日 10:00（巳时）',
    currentTime: { year: 189, month: 8, day: 15, hour: 10, minute: 0 },
    currentLocationId: 'loc_camp',
    currentPlaceId: 'loc_camp',
    resources: makeResources(),
    troops: [
      makeTroop(),
      makeTroop({
        troopId: 'troop_superior',
        name: '州府援军',
        factionId: 'faction_government',
        relationToPlayer: '友军',
        locationId: 'loc_remote',
        upkeepSource: 'superior_provision',
      }),
      makeTroop({
        troopId: 'troop_mixed',
        name: '合供骑队',
        factionId: 'faction_government',
        troopType: '骑兵',
        relationToPlayer: '协同',
        upkeepSource: 'mixed',
      }),
    ],
    holdings: [],
    ...overrides,
  } as RuntimeState;
}

describe('buildMilitarySupplyNarrativeProjection', () => {
  it('projects the exact source-aware monthly preview without copying settlement formulas', () => {
    const state = makeState();
    const settlementPreview = calculateHoldingMonthlyUpkeepPreview(state);
    const projection = buildMilitarySupplyNarrativeProjection(state);

    expect(settlementPreview).toBeDefined();
    expect(projection.data).toMatchObject({
      currentResources: { money: 50, grain: 1000, horses: 20, arms: 20 },
      activeTroopCount: 3,
      monthlyRequired: settlementPreview?.requiredExpenses,
      externalProvision: settlementPreview?.income,
      playerRequired: settlementPreview?.playerRequiredExpenses,
      shortage: settlementPreview?.shortage,
      sourceShares: [
        { source: 'player_resources', troopCount: 1, countRatio: 1 / 3 },
        { source: 'superior_provision', troopCount: 1, countRatio: 1 / 3 },
        { source: 'mixed', troopCount: 1, countRatio: 1 / 3 },
      ],
      nextMonthlyUpkeepAt: '189-09-01 08:00',
      nextAnnualSettlementAt: '189-09-01 08:00',
    });
    expect(projection.text).toContain('Military Supply Truth / 军需叙事真值（本地只读）');
    expect(projection.text).toContain('正式军需官、账房或有账册依据者必须以此为数值锚点');
    expect(projection.text).toContain('玩家本回合明确要求核账、逐项报告或精确数字时');
    expect(projection.text).toContain('必须逐项复述投影中的数值与单位');
    expect(projection.text).toContain('不得写入或覆盖本地月度军需与九月年度结算');
  });

  it('updates sustainable months from the current ledger and keeps local troop details compact', () => {
    const state = makeState({
      troops: [makeTroop({ locationId: 'loc_camp' })],
      resources: makeResources({ money: 50, grain: 1000 }),
    });
    const wellSupplied = buildMilitarySupplyNarrativeProjection(state);
    const reduced = buildMilitarySupplyNarrativeProjection({
      ...state,
      resources: makeResources({ money: 10, grain: 150 }),
    });

    expect(wellSupplied.data?.sustainableMonths).toBeCloseTo(10, 6);
    expect(reduced.data?.sustainableMonths).toBeCloseTo(1.5, 6);
    expect(reduced.data?.limitingResource).toBe('grain');
    expect(reduced.data?.currentLocationTroops).toEqual([
      expect.objectContaining({ troopId: 'troop_player', name: '亲军步卒' }),
    ]);
    expect(reduced.text).toContain('按当前库存与供给结构约可维持1.5个月');
  });

  it('rolls the September settlement boundary into the next year after September', () => {
    const projection = buildMilitarySupplyNarrativeProjection(makeState({
      currentDate: '公元189年10月02日 08:00（辰时）',
      currentTime: { year: 189, month: 10, day: 2, hour: 8, minute: 0 },
      troops: [makeTroop()],
    }));

    expect(projection.data?.nextMonthlyUpkeepAt).toBe('189-11-01 08:00');
    expect(projection.data?.nextAnnualSettlementAt).toBe('190-09-01 08:00');
  });

  it('does not inject a military projection when no current troop consumes upkeep', () => {
    const projection = buildMilitarySupplyNarrativeProjection(makeState({
      troops: [makeTroop({ lifecycleStatus: 'merged' })],
    }));

    expect(projection).toEqual({ data: undefined, text: '' });
  });
});
