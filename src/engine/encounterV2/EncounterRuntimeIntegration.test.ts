import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { applyPlayerExperience } from '../character/progression';
import {
  acceptCombatEncounterOffer,
  completeCombatNarrativeTurn,
  commitCombatResultToRuntime,
  declineCombatEncounterOffer,
  prepareCombatEncounterForPlay,
  stageCombatEncounter,
  stageCombatEncounterOffer,
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
      xp: 490,
      growthPoints: 0,
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

function withDianWeiAlly(state: RuntimeState): RuntimeState {
  state.npcs = [
    ...(state.npcs ?? []),
    {
      npcId: 'npc_dian_wei',
      name: '典韦',
      sex: '男',
      age: 31,
      role: '玩家护卫',
      isPresent: true,
      isFocused: true,
      summary: '随玩家一同迎敌。',
      appearance: '持双戟。',
      personality: '忠勇',
      motivation: '护卫玩家',
      relationToPlayer: '忠诚',
      contactLevel: 80,
      recentAttitude: '并肩作战',
      abilityScores: { 武力: 97, 机运: 55 },
      vitals: { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 },
      traits: [],
      uniqueArts: [],
      equipment: [],
      inventory: [],
      memories: [],
    },
  ];
  return state;
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

  it('stages and prepares combat while the player has three equipped treasures', () => {
    const state = makeRuntimeState();
    state.player.equipment = [1, 2, 3].map((index) => ({
      id: `player_treasure_${index}`,
      slot: 'treasure' as const,
      name: `玩家宝物${index}`,
      quality: index === 3 ? '绝世' : '传说',
      description: '三宝物槽开战回归。',
    }));

    const staged = stageCombatEncounter(state, {
      saveId: 'save_three_treasures',
      intent: makeIntent(),
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    const prepared = prepareCombatEncounterForPlay(staged, {
      selectedPlayerActorIds: ['player_liuping'],
      startedAt: '2026-07-20T01:01:00.000Z',
    });
    const playerSnapshot = prepared.snapshot.combatants.find((entry) => entry.actorId === 'player_liuping');

    expect(prepared.session.status).toBe('fighting');
    expect(playerSnapshot?.equipmentItemIds).toEqual([
      'player_treasure_1',
      'player_treasure_2',
      'player_treasure_3',
    ]);
  });

  it('uses the same projected slots when freezing capturable enemy equipment', () => {
    const state = makeRuntimeState();
    const enemy = state.npcs?.[0];
    expect(enemy).toBeDefined();
    enemy!.equipment = [1, 2, 3, 4].map((index) => ({
      id: `enemy_treasure_${index}`,
      slot: 'treasure' as const,
      name: `敌方宝物${index}`,
      quality: '精良',
      description: '战利品槽位投影回归。',
    }));

    const staged = stageCombatEncounter(state, {
      saveId: 'save_enemy_treasure_overflow',
      intent: makeIntent(),
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    const prepared = prepareCombatEncounterForPlay(staged, {
      selectedPlayerActorIds: ['player_liuping'],
      startedAt: '2026-07-20T01:01:00.000Z',
    });

    expect(prepared.snapshot.capturableEquipmentItemIds).toEqual([
      'enemy_treasure_1',
      'enemy_treasure_2',
      'enemy_treasure_3',
    ]);
  });

  it('does not use the player-only level field to rate NPC combat threat', () => {
    const lowLevel = makeRuntimeState();
    lowLevel.player.level = 1;
    const highLevel = makeRuntimeState();
    highLevel.player.level = 99;

    const prepare = (state: RuntimeState, saveId: string) => {
      const staged = stageCombatEncounter(state, {
        saveId,
        intent: makeIntent(),
        projections: [],
        createdAt: '2026-07-20T01:00:00.000Z',
      });
      return prepareCombatEncounterForPlay(staged, {
        selectedPlayerActorIds: ['player_liuping'],
        startedAt: '2026-07-20T01:01:00.000Z',
      }).snapshot.threatTier;
    };

    expect(prepare(lowLevel, 'save_level_1')).toBe(prepare(highLevel, 'save_level_99'));
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

  it('rejects a personal-combat roster or selection that omits the actual player', () => {
    const state = withDianWeiAlly(makeRuntimeState());
    const missingPlayerIntent = {
      ...makeIntent(),
      playerParty: { actorIds: ['npc_dian_wei'] },
    };

    expect(() => stageCombatEncounter(state, {
      saveId: 'save_missing_player',
      intent: missingPlayerIntent,
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    })).toThrow(/必须包含当前玩家 player_liuping/);

    const staged = stageCombatEncounter(state, {
      saveId: 'save_selection_missing_player',
      intent: {
        ...makeIntent(),
        playerParty: { actorIds: ['npc_dian_wei', 'player_liuping'] },
      },
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    expect(() => prepareCombatEncounterForPlay(staged, {
      selectedPlayerActorIds: ['npc_dian_wei'],
      startedAt: '2026-07-20T01:01:00.000Z',
    })).toThrow(/出战阵容必须包含当前玩家 player_liuping/);
  });

  it('awards and commits XP to the actual player when an NPC ally is listed first', () => {
    const state = withDianWeiAlly(makeRuntimeState());
    const staged = stageCombatEncounter(state, {
      saveId: 'save_ally_before_player',
      intent: {
        ...makeIntent(),
        playerParty: { actorIds: ['npc_dian_wei', 'player_liuping'] },
        partySelection: 'locked',
      },
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    const prepared = prepareCombatEncounterForPlay(staged, {
      startedAt: '2026-07-20T01:01:00.000Z',
    });
    expect(prepared.snapshot.combatants.slice(0, 2).map((entry) => entry.actorId)).toEqual([
      'npc_dian_wei',
      'player_liuping',
    ]);

    const finished = simulateCombatWithLocalAi(prepared.engineState, { maxActions: 500 });
    const result = finalizeCombatResult(finished, '2026-07-20T01:02:00.000Z', {
      playerActorId: staged.player.id,
    });
    const experienceDelta = result.deltas.find((delta) => delta.field === 'xp');
    expect(experienceDelta).toMatchObject({
      targetId: 'player_liuping',
      beforeValue: 490,
      afterValue: 490 + result.experienceAward,
    });
    expect(result.deltas.some((delta) => delta.field === 'xp' && delta.targetId === 'npc_dian_wei')).toBe(false);

    const committed = commitCombatResultToRuntime(staged, {
      saveId: 'save_ally_before_player',
      session: prepared.session,
      result,
      committedAt: '2026-07-20T01:02:00.000Z',
    });
    expect(committed.player.xp).not.toBe(staged.player.xp);
    expect(committed.encounterV2?.active?.checkpoint.checkpointKind).toBe('post_result');
  });

  it('persists a one-off story offer and accepts or declines it without advancing the turn', () => {
    const original = makeRuntimeState();
    const offered = stageCombatEncounterOffer(original, {
      saveId: 'save_offer',
      intent: makeIntent(),
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });

    expect(offered.turnLog).toHaveLength(1);
    expect(offered.encounterV2?.active).toBeUndefined();
    expect(offered.encounterV2?.pendingOffer).toMatchObject({
      offerId: 'offer:encounter_combat_batch1',
      intent: { kind: 'personal_combat' },
    });
    expect(() => stageCombatEncounter(offered, {
      saveId: 'save_offer',
      intent: makeIntent(),
      projections: [],
      createdAt: '2026-07-20T01:00:01.000Z',
    })).toThrow(/待确认冲突/);

    const accepted = acceptCombatEncounterOffer(offered, {
      saveId: 'save_offer',
      acceptedAt: '2026-07-20T01:01:00.000Z',
    });
    expect(accepted.turnLog).toHaveLength(1);
    expect(accepted.encounterV2?.pendingOffer).toBeUndefined();
    expect(accepted.encounterV2?.active?.session.status).toBe('pending');

    const declined = declineCombatEncounterOffer(offered);
    expect(declined.turnLog).toHaveLength(1);
    expect(declined.encounterV2?.pendingOffer).toBeUndefined();
    expect(declined.encounterV2?.active).toBeUndefined();
  });

  it('keeps locally derived escort IDs stable from an offer through acceptance', () => {
    const state = makeRuntimeState();
    state.player.personalEscortEntitlement = {
      status: 'customary',
      bases: ['household_status'],
      updatedAt: state.currentDate,
    };
    const offered = stageCombatEncounterOffer(state, {
      saveId: 'save_escort_offer',
      intent: { ...makeIntent(), escortAvailability: 'normal' },
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    const offerIntent = offered.encounterV2?.pendingOffer?.intent;
    expect(offerIntent?.playerParty.actorIds).toEqual([
      'player_liuping',
      'encounter_combat_batch1:scoped:player_guard_1',
      'encounter_combat_batch1:scoped:player_guard_2',
    ]);
    const accepted = acceptCombatEncounterOffer(offered, {
      saveId: 'save_escort_offer',
      acceptedAt: '2026-07-20T01:01:00.000Z',
    });
    expect(accepted.encounterV2?.active?.session.intent).toMatchObject({
      playerParty: { actorIds: offerIntent?.playerParty.actorIds },
    });
  });

  it('derives nonpersistent escorts only from structured entitlement plus normal scene availability', () => {
    const state = makeRuntimeState();
    state.player.personalEscortEntitlement = {
      status: 'customary',
      bases: ['military_command'],
      updatedAt: state.currentDate,
    };
    const staged = stageCombatEncounter(state, {
      saveId: 'save_structured_escorts',
      intent: { ...makeIntent(), escortAvailability: 'normal' },
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    const stagedIntent = staged.encounterV2?.active?.session.intent;
    if (stagedIntent?.kind !== 'personal_combat') throw new Error('personal combat not staged');
    const guardIds = stagedIntent.playerParty.actorIds.filter((actorId) => actorId.includes(':scoped:player_guard_'));
    expect(guardIds).toHaveLength(2);
    expect(stagedIntent.playerParty.actorIds).toHaveLength(3);
    expect(stagedIntent.scopedCombatants?.filter((entry) => entry.systemRole === 'temporary_escort')).toHaveLength(2);

    const prepared = prepareCombatEncounterForPlay(staged, {
      startedAt: '2026-07-20T01:01:00.000Z',
    });
    for (const guardId of guardIds) {
      expect(prepared.snapshot.combatants.find((entry) => entry.actorId === guardId)).toMatchObject({
        side: 'player',
        persistent: false,
        martial: 52,
      });
    }
    const result = finalizeCombatResult(
      simulateCombatWithLocalAi(prepared.engineState, { maxActions: 300 }),
      '2026-07-20T01:02:00.000Z',
      { playerActorId: state.player.id },
    );
    expect(result.deltas.some((delta) => guardIds.includes(delta.targetId))).toBe(false);
    expect(result.deltas.filter((delta) => delta.field === 'xp')).toEqual([
      expect.objectContaining({ targetId: state.player.id }),
    ]);
    const committed = commitCombatResultToRuntime(staged, {
      saveId: 'save_structured_escorts',
      session: prepared.session,
      result,
      committedAt: '2026-07-20T01:02:00.000Z',
    });
    expect(committed.npcs?.some((npc) => guardIds.includes(npc.npcId))).toBe(false);
    expect(committed.knownActors.some((actor) => guardIds.includes(actor.id))).toBe(false);
    expect(committed.player.personalEscortEntitlement).toEqual(state.player.personalEscortEntitlement);
    expect(committed.combatRecords?.[0].relatedNpcIds?.some((actorId) => guardIds.includes(actorId))).toBe(false);
  });

  it('honors explicitly-solo and explicit-none boundaries without reading identity prose', () => {
    const customary = makeRuntimeState();
    customary.player.personalEscortEntitlement = {
      status: 'customary',
      bases: ['official_position'],
      updatedAt: customary.currentDate,
    };
    const solo = stageCombatEncounter(customary, {
      saveId: 'save_explicitly_solo',
      intent: { ...makeIntent(), escortAvailability: 'explicitly_solo' },
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    expect(solo.encounterV2?.active?.session.intent).toMatchObject({
      playerParty: { actorIds: ['player_liuping'] },
    });

    const denied = makeRuntimeState();
    denied.player.currentIdentity = '手握重兵的显贵大将军';
    denied.player.officeTitle = '州牧';
    denied.player.personalEscortEntitlement = {
      status: 'none',
      bases: [],
      updatedAt: denied.currentDate,
    };
    const noEscort = stageCombatEncounter(denied, {
      saveId: 'save_explicit_none',
      intent: { ...makeIntent(), escortAvailability: 'normal' },
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    expect(noEscort.encounterV2?.active?.session.intent).toMatchObject({
      playerParty: { actorIds: ['player_liuping'] },
    });

    const proseOnly = makeRuntimeState();
    proseOnly.player.currentIdentity = '手握重兵、出入皆有卫士簇拥的权贵';
    const conservative = stageCombatEncounter(proseOnly, {
      saveId: 'save_no_semantic_guess',
      intent: { ...makeIntent(), escortAvailability: 'normal' },
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    expect(conservative.encounterV2?.active?.session.intent).toMatchObject({
      playerParty: { actorIds: ['player_liuping'] },
    });

    const legacyStructured = makeRuntimeState();
    legacyStructured.player.factionAssetAccess = {
      label: '军府资产调度权',
      accessLevel: 'manager',
      summary: '可直接管理所属军府资源。',
    };
    const bridged = stageCombatEncounter(legacyStructured, {
      saveId: 'save_legacy_structured_authority',
      intent: { ...makeIntent(), escortAvailability: 'normal' },
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    const bridgedIntent = bridged.encounterV2?.active?.session.intent;
    if (bridgedIntent?.kind !== 'personal_combat') throw new Error('personal combat not staged');
    expect(bridgedIntent.playerParty.actorIds).toHaveLength(3);
  });

  it('uses only the remaining party slot when a named ally is already present', () => {
    const state = withDianWeiAlly(makeRuntimeState());
    state.player.personalEscortEntitlement = {
      status: 'customary',
      bases: ['explicit_retinue'],
      updatedAt: state.currentDate,
    };
    const staged = stageCombatEncounter(state, {
      saveId: 'save_named_ally_plus_guard',
      intent: {
        ...makeIntent(),
        escortAvailability: 'normal',
        playerParty: { actorIds: ['player_liuping', 'npc_dian_wei'] },
      },
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    const stagedIntent = staged.encounterV2?.active?.session.intent;
    if (stagedIntent?.kind !== 'personal_combat') throw new Error('personal combat not staged');
    expect(stagedIntent.playerParty.actorIds).toEqual([
      'player_liuping',
      'npc_dian_wei',
      'encounter_combat_batch1:scoped:player_guard_1',
    ]);
  });

  it('materializes anonymous enemies only inside the encounter and never writes them into NPC state', () => {
    const state = makeRuntimeState();
    const scopedActorId = 'encounter_combat_batch1:scoped:enemy_1';
    const intent = {
      ...makeIntent(),
      enemyParty: { actorIds: [scopedActorId] },
      scopedCombatants: [{
        actorId: scopedActorId,
        name: '持矛溃卒',
        archetype: 'rabble' as const,
        weaponClass: 'polearm' as const,
        armorClass: 'light' as const,
      }],
    };
    const staged = stageCombatEncounter(state, {
      saveId: 'save_scoped_enemy',
      intent,
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    const prepared = prepareCombatEncounterForPlay(staged, {
      startedAt: '2026-07-20T01:01:00.000Z',
    });
    const scopedSnapshot = prepared.snapshot.combatants.find((entry) => entry.actorId === scopedActorId);

    expect(scopedSnapshot).toMatchObject({
      name: '持矛溃卒',
      persistent: false,
      martial: 30,
      weapon: { weight: 'polearm', qualityTier: 'white' },
      armor: { weight: 'light', qualityTier: 'white' },
    });
    expect(prepared.snapshot.capturableEquipmentItemIds).toEqual([]);
    expect(prepared.snapshot.lootableItemIds).toEqual([]);

    const result = finalizeCombatResult(
      simulateCombatWithLocalAi(prepared.engineState, { maxActions: 200 }),
      '2026-07-20T01:02:00.000Z',
      { playerActorId: state.player.id },
    );
    expect(result.deltas.some((delta) => delta.targetId === scopedActorId)).toBe(false);
    const committed = commitCombatResultToRuntime(staged, {
      saveId: 'save_scoped_enemy',
      session: prepared.session,
      result,
      committedAt: '2026-07-20T01:02:00.000Z',
    });

    expect(committed.npcs).toEqual(state.npcs);
    expect(committed.knownActors).toEqual(state.knownActors);
    const scopedRecord = committed.combatRecords?.[0].participants
      .find((participant) => participant.participantId === scopedActorId);
    expect(scopedRecord).toMatchObject({ name: '持矛溃卒', side: 'enemy' });
    expect(scopedRecord?.npcId).toBeUndefined();
    expect(committed.combatRecords?.[0].relatedNpcIds).not.toContain(scopedActorId);
  });

  it('locally constrains an overpowered anonymous enemy group before combat starts', () => {
    const enemyIds = [1, 2, 3].map((index) => `encounter_combat_batch1:scoped:elite_${index}`);
    const staged = stageCombatEncounter(makeRuntimeState(), {
      saveId: 'save_scoped_enemy_budget',
      intent: {
        ...makeIntent(),
        enemyParty: { actorIds: enemyIds },
        scopedCombatants: enemyIds.map((actorId, index) => ({
          actorId,
          name: `临时敌人${index + 1}`,
          archetype: 'elite' as const,
          weaponClass: 'standard' as const,
          armorClass: 'light' as const,
        })),
      },
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    const prepared = prepareCombatEncounterForPlay(staged, {
      startedAt: '2026-07-20T01:01:00.000Z',
    });

    expect(prepared.session.intent.kind).toBe('personal_combat');
    if (prepared.session.intent.kind !== 'personal_combat') throw new Error('expected personal combat intent');
    expect(prepared.session.intent.scopedCombatants?.map((entry) => entry.archetype)).toEqual([
      'elite',
      'rabble',
      'rabble',
    ]);
    expect(prepared.snapshot.combatants
      .filter((entry) => enemyIds.includes(entry.actorId))
      .map((entry) => entry.combatArchetype)).toEqual(['elite', 'rabble', 'rabble']);
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
    expect(finished.actionLog.some((entry) => (
      entry.actionType === 'unique_art' && entry.values.artId === 'art_player_spear'
    ))).toBe(true);
    const result = finalizeCombatResult(finished, '2026-07-20T01:02:00.000Z', {
      playerActorId: staged.player.id,
    });
    expect(result.experienceAward).toBeGreaterThan(0);

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
    const expectedProgression = applyPlayerExperience(
      staged.player,
      result.experienceAward,
      '个人战斗',
    ).player;
    expect(committed.player).toMatchObject({
      level: expectedProgression.level,
      xp: expectedProgression.xp,
      growthPoints: expectedProgression.growthPoints,
    });
    expect(committed.player.level).toBeGreaterThan(5);
    const progressedArt = committed.player.uniqueArts?.find((art) => art.id === 'art_player_spear');
    expect(progressedArt?.progress).toBeGreaterThan(0);
    const progressRecord = progressedArt?.progressHistory?.[(progressedArt.progressHistory?.length ?? 1) - 1];
    expect(progressRecord).toMatchObject({
      source: 'actual_use',
      sourceRefId: `combat:${result.encounterId}`,
      appliedTurnKey: `2:${staged.currentDate}`,
    });
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

  it('uses existing persistent combat statuses as the frozen baseline when saving another battle', () => {
    const state = makeRuntimeState();
    state.player.combatStatuses = ['wounded', 'severely_wounded', 'wounded'];
    const staged = stageCombatEncounter(state, {
      saveId: 'save_existing_combat_statuses',
      intent: makeIntent(),
      projections: [makeDamageArtProfile('art_player_spear')],
      createdAt: '2026-07-20T01:00:00.000Z',
    });
    const prepared = prepareCombatEncounterForPlay(staged, {
      selectedPlayerActorIds: [state.player.id],
      startedAt: '2026-07-20T01:01:00.000Z',
    });

    const initialPlayer = prepared.snapshot.combatants.find((entry) => entry.actorId === state.player.id);
    expect(initialPlayer?.combatStatuses).toEqual(['severely_wounded', 'wounded']);
    const finished = simulateCombatWithLocalAi(prepared.engineState, { maxActions: 200 });
    const playerCombatant = finished.combatants.find((entry) => entry.actorId === state.player.id);
    if (!playerCombatant) throw new Error('expected player combatant');
    playerCombatant.statuses.push('downed', 'wounded');
    const result = finalizeCombatResult(finished, '2026-07-20T01:02:00.000Z', {
      playerActorId: state.player.id,
    });
    const statusDelta = result.deltas.find((delta) => (
      delta.targetId === state.player.id && delta.field === 'combatStatuses'
    ));
    expect(statusDelta?.beforeValue).toEqual(['severely_wounded', 'wounded']);
    expect(statusDelta?.afterValue).toEqual(expect.arrayContaining(['downed', 'severely_wounded', 'wounded']));

    const committed = commitCombatResultToRuntime(staged, {
      saveId: 'save_existing_combat_statuses',
      session: prepared.session,
      result,
      committedAt: '2026-07-20T01:02:00.000Z',
    });
    expect(committed.player.combatStatuses).toEqual(statusDelta?.afterValue);

    const duplicate = commitCombatResultToRuntime(committed, {
      saveId: 'save_existing_combat_statuses',
      session: prepared.session,
      result,
      committedAt: '2026-07-20T01:03:00.000Z',
    });
    expect(duplicate).toEqual(committed);
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
      { playerActorId: staged.player.id },
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
