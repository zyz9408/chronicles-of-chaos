import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import {
  completeCombatNarrativeTurn,
  commitCombatResultToRuntime,
  prepareCombatEncounterForPlay,
  stageCombatEncounter,
  assertEncounterPersistenceAllowed,
} from './EncounterRuntimeIntegration';
import {
  finalizeCombatResult,
} from './CombatEngine';
import { simulateCombatWithLocalAi } from './CombatAi';
import {
  makeCombatIntent,
  makeDamageArtProfile,
} from './CombatTestFixtures';

function makeRuntimeState(): RuntimeState {
  return {
    engineVersion: '0.1.0',
    worldBookId: 'sanguo',
    worldBookVersion: '1',
    worldBookSource: 'official',
    startDate: '公元194年05月03日 02:00',
    currentDate: '公元194年05月03日 02:00',
    currentTime: { year: 194, month: 5, day: 3, hour: 2, minute: 0 },
    player: {
      id: 'player_liuping',
      name: '刘平',
      roleType: '将领',
      level: 5,
      xp: 100,
      abilityScores: { 武力: 96, 机运: 60 },
      vitals: { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 },
      uniqueArts: [{
        id: 'art_player_spear',
        name: '七探蛇盘枪',
        rarity: 'red',
        domain: 'personalCombat',
        level: 3,
        description: '枪势连绵。',
        effectSummary: '连续攻击。',
        source: 'history',
      }],
      inventory: [],
      equipment: [],
      traits: [],
      summary: '测试主角',
    },
    currentLocationId: 'location_hanshui_camp',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [{
      turnNumber: 1,
      date: '公元194年05月03日 02:00',
      playerInput: '迎击来敌',
      narrativeText: '敌军已逼近营门。',
      fullNarrativeText: '敌军已逼近营门。',
      statePatchSummary: '战斗触发',
      timestamp: '2026-07-20T00:00:00.000Z',
    }],
    localSituationNotes: [],
    npcs: [{
      npcId: 'npc_enemy_guard',
      name: '西凉悍卒',
      sex: '男',
      age: 30,
      role: '敌军',
      isPresent: true,
      isFocused: true,
      summary: '拦路敌兵',
      appearance: '披甲持刀',
      personality: '凶悍',
      motivation: '截杀刘平',
      relationToPlayer: '敌对',
      contactLevel: 1,
      recentAttitude: '杀意明显',
      abilityScores: { 武力: 42, 机运: 40 },
      vitals: { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 },
      traits: [],
      uniqueArts: [],
      equipment: [],
      inventory: [],
      memories: [],
    }],
  };
}

function makeIntent() {
  return {
    ...makeCombatIntent(),
    sourceTurnNumber: 1,
    reason: '汉水大营遭遇战',
    partySelection: 'player_choice' as const,
  };
}

describe('Combat V2 runtime integration', () => {
  it('does not stage a new combat while the player has zero HP', () => {
    const state = makeRuntimeState();
    state.player.vitals = { hp: 0, maxHp: 100, stamina: 100, maxStamina: 100 };

    expect(() => stageCombatEncounter(state, {
      saveId: 'save_zero_hp',
      intent: makeIntent(),
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    })).toThrow(/生命为 0/);
  });

  it('stages an immutable pre-encounter checkpoint and resumes into a fighting session', () => {
    const original = makeRuntimeState();
    const staged = stageCombatEncounter(original, {
      saveId: 'save_batch2',
      intent: makeIntent(),
      projections: [makeDamageArtProfile('art_player_spear')],
      createdAt: '2026-07-20T01:00:00.000Z',
    });

    expect(original.encounterV2).toBeUndefined();
    expect(staged.encounterV2?.active?.session.status).toBe('pending');
    expect(staged.encounterV2?.active?.checkpoint.checkpointKind).toBe('pre_encounter');
    expect(staged.encounterV2?.semanticProjections).toHaveLength(1);
    expect(Object.isFrozen(staged.encounterV2?.active?.session)).toBe(true);

    const prepared = prepareCombatEncounterForPlay(staged, {
      selectedPlayerActorIds: ['player_liuping'],
      startedAt: '2026-07-20T01:01:00.000Z',
    });
    expect(prepared.session.status).toBe('fighting');
    expect(prepared.snapshot.combatants.map((entry) => `${entry.side}:${entry.actorId}`)).toEqual([
      'player:player_liuping',
      'enemy:npc_enemy_guard',
    ]);
    expect(prepared.engineState.phase).toBe('advancing');
  });

  it('rejects a trigger whose stable participant does not exist in runtime state', () => {
    const intent = makeIntent();
    intent.enemyParty = { actorIds: ['npc_missing'] };

    expect(() => stageCombatEncounter(makeRuntimeState(), {
      saveId: 'save_batch2',
      intent,
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    })).toThrow(/npc_missing/);
  });

  it('canonicalizes the reserved player alias to the actual runtime player ID', () => {
    const intent = makeIntent();
    intent.playerParty.actorIds = ['player'];

    const staged = stageCombatEncounter(makeRuntimeState(), {
      saveId: 'save_batch2_player_alias',
      intent,
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });

    expect(staged.encounterV2?.active?.session.intent).toMatchObject({
      kind: 'personal_combat',
      playerParty: { actorIds: ['player_liuping'] },
    });
  });

  it('persists a sealed result once, creates a post-result checkpoint, and never reapplies deltas', () => {
    const staged = stageCombatEncounter(makeRuntimeState(), {
      saveId: 'save_batch2',
      intent: makeIntent(),
      projections: [makeDamageArtProfile('art_player_spear')],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    const prepared = prepareCombatEncounterForPlay(staged, {
      selectedPlayerActorIds: ['player_liuping'],
      startedAt: '2026-07-20T01:01:00.000Z',
    });
    const finished = simulateCombatWithLocalAi(prepared.engineState, { maxActions: 200 });
    const result = finalizeCombatResult(finished, '2026-07-20T01:02:00.000Z');

    const committed = commitCombatResultToRuntime(staged, {
      saveId: 'save_batch2',
      session: prepared.session,
      result,
      committedAt: '2026-07-20T01:02:00.000Z',
      locationName: '荆州 - 南阳郡 - 新野县城',
    });
    expect(committed.encounterV2?.active?.session.status).toBe('narrative_pending');
    expect(committed.encounterV2?.active?.checkpoint.checkpointKind).toBe('post_result');
    expect(committed.encounterV2?.appliedResultHashes).toEqual([result.resultHash]);
    expect(committed.combatRecords).toHaveLength(1);
    expect(committed.combatRecords?.[0].locationName).toBe('荆州 - 南阳郡 - 新野县城');
    expect(committed.currentTime?.minute).toBe(result.elapsedMinutes);

    const duplicate = commitCombatResultToRuntime(committed, {
      saveId: 'save_batch2',
      session: prepared.session,
      result,
      committedAt: '2026-07-20T01:03:00.000Z',
    });
    expect(duplicate).toEqual(committed);
    expect(duplicate.combatRecords).toHaveLength(1);
  });

  it('adds exactly one N+1 narrative turn and then clears the active encounter', () => {
    const staged = stageCombatEncounter(makeRuntimeState(), {
      saveId: 'save_batch2',
      intent: makeIntent(),
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    const prepared = prepareCombatEncounterForPlay(staged, {
      selectedPlayerActorIds: ['player_liuping'],
      startedAt: '2026-07-20T01:01:00.000Z',
    });
    const result = finalizeCombatResult(
      simulateCombatWithLocalAi(prepared.engineState, { maxActions: 200 }),
      '2026-07-20T01:02:00.000Z',
    );
    const committed = commitCombatResultToRuntime(staged, {
      saveId: 'save_batch2',
      session: prepared.session,
      result,
      committedAt: '2026-07-20T01:02:00.000Z',
    });

    const narrated = completeCombatNarrativeTurn(committed, {
      resultHash: result.resultHash,
      narrativeText: '【旁白】营门前的短兵相接终于分出胜负。',
      suggestedActions: [{ label: '整顿行装', description: '检查伤势与所得。', actionType: 'rest' }],
      completedAt: '2026-07-20T01:03:00.000Z',
      provider: 'openai',
      model: 'test-model',
    });
    expect(narrated.turnLog).toHaveLength(2);
    expect(narrated.turnLog[1].turnNumber).toBe(2);
    expect(narrated.turnLog[1].fullNarrativeText).toContain('分出胜负');
    expect(narrated.combatRecords?.[0].reportText).toContain('分出胜负');
    expect(narrated.encounterV2?.active).toBeUndefined();
    expect(narrated.encounterV2?.narratedResultHashes).toEqual([result.resultHash]);

    const duplicate = completeCombatNarrativeTurn(narrated, {
      resultHash: result.resultHash,
      narrativeText: '不应重复写入',
      suggestedActions: [],
      completedAt: '2026-07-20T01:04:00.000Z',
    });
    expect(duplicate).toEqual(narrated);
    expect(duplicate.turnLog).toHaveLength(2);
  });

  it('allows pre/post checkpoints but rejects persistence of a fighting session', () => {
    const staged = stageCombatEncounter(makeRuntimeState(), {
      saveId: 'save_batch2',
      intent: makeIntent(),
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    expect(() => assertEncounterPersistenceAllowed(staged)).not.toThrow();

    const fighting = prepareCombatEncounterForPlay(staged, {
      selectedPlayerActorIds: ['player_liuping'],
      startedAt: '2026-07-20T01:01:00.000Z',
    }).session;
    expect(() => assertEncounterPersistenceAllowed({
      ...staged,
      encounterV2: {
        ...staged.encounterV2!,
        active: { ...staged.encounterV2!.active!, session: fighting },
      },
    })).toThrow(/战斗进行中禁止存档/);
  });
});
