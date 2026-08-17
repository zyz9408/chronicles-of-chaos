import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import type { WarStartIntent } from '../encounterV2/EncounterContracts';
import { ensureLuanShiState } from './createInitialRuntimeState';
import { analyzeHoldingDeletion, deleteHoldingSafely } from './HoldingDeletion';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '1.6.10',
    worldBookId: 'holding-delete-test',
    worldBookVersion: '1.0.0',
    worldBookSource: 'official',
    startDate: '公元190年01月01日',
    currentDate: '公元190年01月02日',
    player: {
      id: 'player',
      name: '林砚',
      roleType: '军侯',
      summary: '正在军中任职。',
    },
    currentLocationId: 'loc_false_camp',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    holdings: [{
      holdingId: 'holding_false_camp',
      name: '误生成营地',
      type: 'camp',
      status: 'controlled',
      summary: '玩家只是驻扎于此，却被错误登记为领地。',
      civilAdministrationScope: 'none',
      scaleLevel: 1,
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 50,
      popularSupport: 50,
      defense: 40,
      recruitPotential: 20,
      armory: 10,
      horseSupply: 5,
      garrisonTroopIds: ['troop_guard'],
      updatedAt: '公元190年01月02日',
    }, {
      holdingId: 'holding_real_city',
      name: '真实城池',
      type: 'city',
      status: 'controlled',
      summary: '玩家实际掌控的城池。',
      civilAdministrationScope: 'territorial',
      scaleLevel: 2,
      agriculture: 45,
      commerce: 40,
      population: 12000,
      publicOrder: 60,
      popularSupport: 55,
      defense: 50,
      recruitPotential: 40,
      armory: 30,
      horseSupply: 15,
      updatedAt: '公元190年01月02日',
    }],
    holdingGovernanceProjects: [{
      projectId: 'project_completed',
      holdingId: 'holding_false_camp',
      type: 'garrison_drill',
      status: 'completed',
      host: { actorType: 'player', actorId: 'player' },
      startedAt: '公元190年01月01日',
      expectedCompleteAt: '公元190年01月02日',
      investedMoney: 1,
      investedGrain: 1,
      baseline: {
        holdingStatus: 'controlled',
        civilAdministrationScope: 'none',
        scaleLevel: 1,
        agriculture: 0,
        commerce: 0,
        population: 0,
        publicOrder: 50,
        popularSupport: 50,
        defense: 40,
        recruitPotential: 20,
        armory: 10,
        horseSupply: 5,
      },
      expectedEffects: {},
      risk: 'low',
      modifiers: {
        hostAbilityScore: 50,
        durationMultiplier: 1,
        costMultiplier: 1,
        effectMultiplier: 1,
        riskStepsReduced: 0,
      },
      updatedAt: '公元190年01月02日',
    }],
    troops: [{
      troopId: 'troop_guard',
      name: '营地守军',
      size: 80,
      lifecycleStatus: 'active',
      morale: 60,
      training: 50,
      supplies: 50,
      task: '驻守',
      relationToPlayer: '受玩家指挥',
    }],
    locations: [{
      locationId: 'loc_false_camp',
      name: '临时营地',
      type: 'camp',
      summary: '行军途中搭建的营地。',
      knownLevel: '亲历',
      recentEvents: [],
    }],
  });
}

describe('领地账本安全删除', () => {
  it('只移除目标领地与其已结束治理项目，保留地图、驻军和其他领地', () => {
    const state = makeState();
    const result = deleteHoldingSafely(state, 'holding_false_camp');

    expect(result.deleted).toBe(true);
    expect(result.analysis).toMatchObject({
      exists: true,
      canDelete: true,
      removableGovernanceProjectCount: 1,
      preservedGarrisonTroopCount: 1,
    });
    expect(result.state.holdings?.map((holding) => holding.holdingId)).toEqual(['holding_real_city']);
    expect(result.state.holdingGovernanceProjects).toEqual([]);
    expect(result.state.troops?.map((troop) => troop.troopId)).toEqual(['troop_guard']);
    expect(result.state.locations?.map((location) => location.locationId)).toEqual(['loc_false_camp']);
    expect(result.state.currentLocationId).toBe('loc_false_camp');
    expect(state.holdings?.map((holding) => holding.holdingId)).toEqual([
      'holding_false_camp',
      'holding_real_city',
    ]);
  });

  it('阻止删除仍被实时治理、重骑组建、当前事项或战争引用的领地', () => {
    const state = makeState();
    state.holdingGovernanceProjects![0].status = 'blocked';
    state.heavyCavalryFormationProjects = [{
      projectId: 'heavy_project',
      troopId: 'troop_heavy',
      troopName: '重骑营',
      holdingId: 'holding_false_camp',
      requestedSize: 20,
      supportLevel: 'limited',
      status: 'active',
      startedAt: state.currentDate,
      expectedCompleteAt: '公元190年03月02日',
      investedMoney: 100,
      investedGrain: 100,
      investedHorses: 24,
      investedArms: 20,
      investedRecruits: 20,
      reserveHorseCount: 4,
      relationToPlayer: '受玩家指挥',
      upkeepSource: 'player_resources',
      updatedAt: state.currentDate,
    }];
    state.activeQuests = [{
      id: 'quest_holding',
      title: '修整营垒',
      description: '完成营垒修整。',
      status: 'active',
      affectedHoldingIds: ['holding_false_camp'],
      createdAt: state.currentDate,
      updatedAt: state.currentDate,
    }];
    const warIntent: WarStartIntent = {
      contractVersion: 1,
      encounterId: 'war_holding',
      kind: 'war',
      rulesetVersion: 'war-v2.3.0',
      sourceTurnNumber: 2,
      locationId: 'loc_false_camp',
      reason: '敌军来袭',
      seed: 'seed_war',
      createdAt: '2026-08-05T00:00:00.000Z',
      policy: {
        lethality: 'standard',
        allowRetreat: true,
        allowSurrender: true,
        allowCapture: true,
        lootPolicy: 'actual_items_only',
      },
      playerForce: { troopIds: ['troop_guard'] },
      enemyForce: { troopIds: ['troop_enemy'] },
      objective: 'capture_holding',
      targetHoldingId: 'holding_false_camp',
      environmentTags: ['open'],
    };
    state.encounterV2 = {
      semanticProjections: [],
      active: {
        session: {
          sessionId: 'session_war',
          status: 'pending',
          intent: warIntent,
          snapshotHash: 'fnv1a64:war',
          createdAt: '2026-08-05T00:00:00.000Z',
        },
        checkpoint: {
          checkpointKind: 'pre_encounter',
          checkpointId: 'checkpoint_war',
          saveId: 'save_war',
          sessionId: 'session_war',
          encounterId: 'war_holding',
          intent: warIntent,
          snapshotHash: 'fnv1a64:war',
          createdAt: '2026-08-05T00:00:00.000Z',
        },
      },
      appliedResultHashes: [],
      narratedResultHashes: [],
    };

    const analysis = analyzeHoldingDeletion(state, 'holding_false_camp');
    const result = deleteHoldingSafely(state, 'holding_false_camp');

    expect(analysis.canDelete).toBe(false);
    expect(analysis.blockers.map((blocker) => blocker.kind)).toEqual(expect.arrayContaining([
      'holding_governance_project',
      'heavy_cavalry_project',
      'active_quest',
      'active_encounter',
    ]));
    expect(result.deleted).toBe(false);
    expect(result.state).toBe(state);
  });

  it('不存在的领地不会产生删除写回', () => {
    const state = makeState();
    const result = deleteHoldingSafely(state, 'holding_missing');

    expect(result.deleted).toBe(false);
    expect(result.analysis).toMatchObject({
      holdingId: 'holding_missing',
      exists: false,
      canDelete: false,
    });
    expect(result.state).toBe(state);
  });
});
