import { describe, expect, it } from 'vitest';
import type { HoldingLedgerEntry, RuntimeState, TroopLedgerEntry } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { validateLuanShiCommand } from '../state/luanshiCommands';
import { applyLuanShiCommand } from '../state/luanshiReducers';
import { calculateTroopMonthlyUpkeep } from '../holdings/HoldingAnnualSettlement';
import { calculateHoldingMonthlyUpkeepPreview } from '../holdings/HoldingAnnualSettlementRuntime';
import {
  applyHeavyCavalryShortageDegradation,
  calculateHeavyCavalryFormationCost,
  settleDueHeavyCavalryFormationProjects,
  startHeavyCavalryFormation,
} from './HeavyCavalryFormation';

function makeHolding(overrides: Partial<HoldingLedgerEntry> = {}): HoldingLedgerEntry {
  return {
    holdingId: 'holding_camp',
    name: '北岸大营',
    type: 'camp',
    status: 'controlled',
    summary: '具备基础军需能力。',
    locationId: 'place_camp',
    factionId: 'faction_player',
    civilAdministrationScope: 'none',
    scaleLevel: 2,
    agriculture: 0,
    commerce: 0,
    population: 0,
    publicOrder: 0,
    popularSupport: 0,
    defense: 60,
    recruitPotential: 50,
    armory: 45,
    horseSupply: 45,
    updatedAt: '公元190年01月01日 08:00（辰时）',
    ...overrides,
  };
}

function makeState(holding = makeHolding()): RuntimeState {
  return ensureLuanShiState({
    engineVersion: 'test',
    worldBookId: 'test',
    worldBookVersion: 'test',
    worldBookSource: 'official',
    startDate: '公元190年01月01日 08:00（辰时）',
    currentDate: '公元190年01月01日 08:00（辰时）',
    player: {
      id: 'player',
      name: '刘兴',
      roleType: '将领',
      factionId: 'faction_player',
      locationId: 'place_camp',
      summary: '统领本部。',
    },
    currentLocationId: 'place_camp',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    holdings: [holding],
    factions: [{
      factionId: 'faction_player',
      name: '荆州军府',
      type: '军阀集团',
      summary: '地方军府。',
      stanceToPlayer: '自势力',
      knownLevel: '亲历',
      recentActions: [],
    }],
    resources: {
      money: 100_000,
      grain: 100_000,
      horses: 2_000,
      arms: 3_000,
      recruits: 2_000,
      weapons: [],
      documents: [],
      tokens: [],
      importantSupplies: [],
    },
  });
}

function makeStartInput(size: number) {
  return {
    projectId: `project_heavy_${size}`,
    troopId: `troop_heavy_${size}`,
    troopName: '新编甲骑',
    holdingId: 'holding_camp',
    factionId: 'faction_player',
    requestedSize: size,
    supportLevel: 'limited' as const,
    leaderNpcId: 'player',
    relationToPlayer: '你直接统领',
    upkeepSource: 'player_resources' as const,
  };
}

function makeHeavyTroop(overrides: Partial<TroopLedgerEntry> = {}): TroopLedgerEntry {
  return {
    troopId: 'troop_heavy',
    name: '玄甲骑',
    size: 100,
    troopType: '重骑兵',
    logisticsClass: 'heavy_cavalry',
    quality: '高',
    fatigue: '低',
    readiness: '高',
    lifecycleStatus: 'active',
    morale: 75,
    training: 80,
    supplies: 100,
    upkeepSource: 'player_resources',
    task: '驻训',
    relationToPlayer: '你直接统领',
    ...overrides,
  };
}

function makeOrdinaryTroop(overrides: Partial<TroopLedgerEntry> = {}): TroopLedgerEntry {
  return {
    troopId: 'troop_existing_ordinary',
    name: '左营步卒',
    detailLevel: 'operational',
    size: 800,
    factionId: 'faction_player',
    troopType: '步卒',
    logisticsClass: 'ordinary',
    quality: '中',
    fatigue: '低',
    readiness: '中',
    lifecycleStatus: 'active',
    leaderNpcId: 'player',
    morale: 65,
    training: 60,
    supplies: 100,
    upkeepSource: 'player_resources',
    task: '驻训',
    relationToPlayer: '你直接统领',
    ...overrides,
  };
}

describe('HeavyCavalryFormation', () => {
  it('atomically starts a limited 20-rider project and deducts every required resource', () => {
    const state = makeState();
    const cost = calculateHeavyCavalryFormationCost(20);
    const result = startHeavyCavalryFormation(state, makeStartInput(20));

    expect(result.ok).toBe(true);
    expect(result.project?.reserveHorseCount).toBe(3);
    expect(result.project?.expectedCompleteAt).not.toBe(state.currentDate);
    expect(result.state.resources).toMatchObject({
      money: state.resources!.money - cost.money,
      grain: state.resources!.grain - cost.grain,
      horses: state.resources!.horses - cost.horses,
      arms: state.resources!.arms - cost.arms,
      recruits: state.resources!.recruits - cost.recruits,
    });
    expect(result.state.troops).toHaveLength(0);
  });

  it('rejects an over-cap or unaffordable project without mutating any resource', () => {
    const state = makeState();
    const overCap = startHeavyCavalryFormation(state, makeStartInput(21));
    expect(overCap.ok).toBe(false);
    expect(overCap.state).toBe(state);
    expect(overCap.state.resources).toEqual(state.resources);

    const poorState = { ...state, resources: { ...state.resources!, horses: 10 } };
    const unaffordable = startHeavyCavalryFormation(poorState, makeStartInput(20));
    expect(unaffordable.ok).toBe(false);
    expect(unaffordable.state.resources).toEqual(poorState.resources);
  });

  it('atomically transfers personnel from an existing controlled troop without inventing material resources', () => {
    const base = makeState(makeHolding({ armory: 45, horseSupply: 45 }));
    const state = ensureLuanShiState({
      ...base,
      troops: [makeOrdinaryTroop()],
      resources: { ...base.resources!, recruits: 15 },
      playerResources: { raw_iron: 2_000 },
    });
    const result = startHeavyCavalryFormation(state, {
      ...makeStartInput(50),
      supportLevel: 'stable',
      personnelSource: 'existing_troop',
      sourceTroopId: 'troop_existing_ordinary',
    });

    expect(result.ok).toBe(true);
    expect(result.project).toMatchObject({
      personnelSource: 'existing_troop',
      sourceTroopId: 'troop_existing_ordinary',
      investedRecruits: 50,
    });
    expect(result.state.resources?.recruits).toBe(15);
    expect(result.state.playerResources).toEqual({ raw_iron: 2_000 });
    expect(result.state.troops?.[0]).toMatchObject({
      troopId: 'troop_existing_ordinary',
      previousSize: 800,
      size: 750,
      childTroopIds: ['troop_heavy_50'],
      lifecycleStatus: 'active',
      strengthTrend: 'decreased',
    });
  });

  it('keeps resources and source troop unchanged when a transferred formation lacks reserve horses', () => {
    const base = makeState(makeHolding({ armory: 45, horseSupply: 45 }));
    const state = ensureLuanShiState({
      ...base,
      troops: [makeOrdinaryTroop()],
      resources: { ...base.resources!, recruits: 15, horses: 52 },
    });
    const result = startHeavyCavalryFormation(state, {
      ...makeStartInput(50),
      supportLevel: 'stable',
      personnelSource: 'existing_troop',
      sourceTroopId: 'troop_existing_ordinary',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('战马不足（含备用马需58匹，现52匹）');
    expect(result.state).toBe(state);
    expect(result.state.resources).toEqual(state.resources);
    expect(result.state.troops).toEqual(state.troops);
    expect(result.state.heavyCavalryFormationProjects).toEqual([]);
  });

  it('rejects a foreign, intelligence-only or undersized troop as a personnel source', () => {
    const base = makeState(makeHolding({ armory: 45, horseSupply: 45 }));
    for (const source of [
      makeOrdinaryTroop({ factionId: 'faction_enemy', leaderNpcId: 'npc_enemy' }),
      makeOrdinaryTroop({ detailLevel: 'intelligence' }),
      makeOrdinaryTroop({ size: 49 }),
    ]) {
      const state = ensureLuanShiState({ ...base, troops: [source] });
      const result = startHeavyCavalryFormation(state, {
        ...makeStartInput(50),
        supportLevel: 'stable',
        personnelSource: 'existing_troop',
        sourceTroopId: source.troopId,
      });
      expect(result.ok).toBe(false);
      expect(result.state).toBe(state);
    }
  });

  it('allows 200 only with stable infrastructure and 500 only with major-faction evidence', () => {
    const stableState = makeState(makeHolding({ scaleLevel: 3, armory: 75, horseSupply: 75 }));
    const stable = startHeavyCavalryFormation(stableState, {
      ...makeStartInput(200),
      supportLevel: 'stable',
    });
    expect(stable.ok).toBe(true);

    const majorState = makeState(makeHolding({ scaleLevel: 4, armory: 90, horseSupply: 90 }));
    const withoutEvidence = startHeavyCavalryFormation(majorState, {
      ...makeStartInput(500),
      supportLevel: 'major_faction',
    });
    expect(withoutEvidence.ok).toBe(false);

    const withEvent = ensureLuanShiState({
      ...majorState,
      turnEvents: [{
        eventId: 'evt_major_authorization',
        happenedAt: majorState.currentDate,
        locationId: 'place_camp',
        summary: '军府正式批准五百甲骑组建与马械调拨。',
        presentNpcIds: [],
        involvedNpcIds: [],
        visibility: '公开',
      }],
    });
    const accepted = startHeavyCavalryFormation(withEvent, {
      ...makeStartInput(500),
      supportLevel: 'major_faction',
      supportEvidenceRefId: 'evt_major_authorization',
    });
    expect(accepted.ok).toBe(true);
  });

  it('completes locally after the due date and never creates an elite unit directly', () => {
    const started = startHeavyCavalryFormation(makeState(), makeStartInput(20));
    const settled = settleDueHeavyCavalryFormationProjects({
      ...started.state,
      currentDate: started.project!.expectedCompleteAt,
    });
    expect(settled.heavyCavalryFormationProjects?.[0].status).toBe('completed');
    expect(settled.troops?.[0]).toMatchObject({
      troopId: 'troop_heavy_20',
      size: 20,
      logisticsClass: 'heavy_cavalry',
      quality: '高',
      training: 55,
      readiness: '中',
      upkeepSource: 'player_resources',
    });
    expect(settled.troops?.[0].quality).not.toBe('精锐');
    expect(settled.troops?.[0].acquisitionEvidence?.kind).toBe('formation_project');
  });

  it('blocks direct heavy-cavalry creation and expansion without prior structured evidence', () => {
    const state = makeState();
    const direct = validateLuanShiCommand(state, {
      action: 'upsertTroopLedger',
      troopId: 'troop_cheat',
      name: '千骑玄甲',
      size: 1_000,
      troopType: '重骑兵',
      logisticsClass: 'heavy_cavalry',
      morale: 90,
      training: 90,
      supplies: 100,
      quality: '精锐',
      task: '出征',
      relationToPlayer: '你直接统领',
    });
    expect(direct.valid).toBe(false);
    expect(direct.errors.join('\n')).toContain('不得通过普通 upsertTroopLedger');

    const existingState = ensureLuanShiState({ ...state, troops: [makeHeavyTroop()] });
    const expansion = validateLuanShiCommand(existingState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_heavy',
      size: 500,
    });
    expect(expansion.valid).toBe(false);
    expect(expansion.errors.join('\n')).toContain('既有重骑扩编');
  });

  it('accepts a factual superior grant and preserves it in the troop ledger', () => {
    const state = ensureLuanShiState({
      ...makeState(),
      turnEvents: [{
        eventId: 'evt_grant',
        happenedAt: '公元190年01月01日 08:00（辰时）',
        locationId: 'place_camp',
        summary: '上级将现成五十甲骑正式拨入主角麾下。',
        presentNpcIds: [],
        involvedNpcIds: [],
        visibility: '公开',
      }],
    });
    const command = {
      action: 'upsertTroopLedger' as const,
      troopId: 'troop_granted',
      name: '军府拨给甲骑',
      size: 50,
      troopType: '重骑兵',
      logisticsClass: 'heavy_cavalry' as const,
      acquisitionEvidence: {
        kind: 'superior_grant' as const,
        occurredAt: state.currentDate,
        sourceRefId: 'evt_grant',
        summary: '军府将现成甲骑正式调拨。',
      },
      morale: 65,
      training: 65,
      supplies: 100,
      quality: '高' as const,
      task: '听候军令',
      relationToPlayer: '你直接统领',
    };
    expect(validateLuanShiCommand(state, command).valid).toBe(true);
    const next = applyLuanShiCommand(state, command);
    expect(next.troops[0].acquisitionEvidence?.sourceRefId).toBe('evt_grant');
  });

  it('charges heavy cavalry substantially more and degrades readiness before the establishment', () => {
    const heavy = makeHeavyTroop();
    const ordinary = { ...heavy, logisticsClass: 'ordinary' as const, troopType: '骑兵' };
    const heavyUpkeep = calculateTroopMonthlyUpkeep({ ...heavy, size: 1_000 });
    const ordinaryUpkeep = calculateTroopMonthlyUpkeep({ ...ordinary, size: 1_000 });
    expect(heavyUpkeep.money).toBeGreaterThan(ordinaryUpkeep.money);
    expect(heavyUpkeep.horses).toBeGreaterThan(ordinaryUpkeep.horses);
    expect(heavyUpkeep.arms).toBeGreaterThan(ordinaryUpkeep.arms);

    const first = applyHeavyCavalryShortageDegradation(heavy, 1);
    expect(first.size).toBe(100);
    expect(first.deployableSize).toBeLessThan(100);
    expect(first.readiness).toBe('低');
    const second = applyHeavyCavalryShortageDegradation(first, 1);
    const third = applyHeavyCavalryShortageDegradation(second, 1);
    expect(third.logisticsClass).toBe('ordinary');
    expect(third.troopType).toBe('骑兵');
    expect(third.statusTags).toContain('缺马退化为普通骑兵');
  });

  it('applies the same degradation through the real monthly upkeep preview', () => {
    let state = ensureLuanShiState({
      ...makeState(),
      troops: [makeHeavyTroop()],
      resources: {
        ...makeState().resources!,
        money: 0,
        grain: 0,
        horses: 0,
        arms: 0,
        recruits: 0,
      },
    });

    const first = calculateHoldingMonthlyUpkeepPreview(state)!;
    expect(first.shortage.horses).toBeGreaterThan(0);
    expect(first.nextTroops[0]).toMatchObject({ readiness: '低', deployableSize: 92 });
    state = ensureLuanShiState({ ...state, troops: first.nextTroops });
    const second = calculateHoldingMonthlyUpkeepPreview(state)!;
    state = ensureLuanShiState({ ...state, troops: second.nextTroops });
    const third = calculateHoldingMonthlyUpkeepPreview(state)!;
    expect(third.nextTroops[0]).toMatchObject({ logisticsClass: 'ordinary', troopType: '骑兵' });
  });
});
