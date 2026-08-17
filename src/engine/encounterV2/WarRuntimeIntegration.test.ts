import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import {
  completeWarNarrativeTurn,
  commitWarResultToRuntime,
  prepareWarEncounterForPlay,
  stageWarEncounter,
} from './WarRuntimeIntegration';
import {
  createSealedWarResult,
  executeWarRound,
  resolveWarDecision,
  resumeWarAfterAutoPause,
} from './WarEngine';
import {
  makeTroopProfile,
  makeWarArtProfile,
  makeWarIntent,
  makeWarTroop,
} from './WarTestFixtures';
import {
  createValidatedWarProjectionBundle,
  createWarEncounterSnapshot,
} from './WarSnapshotAdapter';
import type { WarEngineState } from './WarTypes';
import type { WarStartIntent } from './EncounterContracts';

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
      abilityScores: { 统率: 96, 智力: 90, 武力: 88, 魅力: 75, 政治: 60 },
      inventory: [],
      equipment: [],
      traits: [],
      uniqueArts: [],
      summary: '测试主角',
    },
    currentLocationId: 'location_xinye_field',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [{
      id: 'quest_untouched',
      title: '不应被战争内部推进',
      description: '仅用于验证边界。',
      status: 'active',
      priority: 'medium',
      createdAt: '公元194年05月01日 00:00',
      updatedAt: '公元194年05月01日 00:00',
    }],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [{
      turnNumber: 1,
      date: '公元194年05月03日 02:00',
      playerInput: '亲自指挥攻取新野',
      narrativeText: '两军已经列阵。',
      fullNarrativeText: '两军已经列阵。',
      statePatchSummary: '战争触发',
      timestamp: '2026-07-20T00:00:00.000Z',
    }],
    localSituationNotes: [],
    npcs: [{
      npcId: 'npc_enemy_commander',
      name: '敌军主将',
      sex: '男',
      age: 35,
      role: '敌将',
      isPresent: false,
      isFocused: true,
      summary: '守军主将',
      appearance: '披甲执锐',
      personality: '谨慎',
      motivation: '守住新野',
      relationToPlayer: '敌对',
      contactLevel: 1,
      recentAttitude: '严阵以待',
      abilityScores: { 统率: 35, 智力: 40, 武力: 45, 魅力: 35, 政治: 30 },
      traits: [],
      uniqueArts: [],
      equipment: [],
      inventory: [],
      memories: [],
    }],
    troops: [
      makeWarTroop('troop_player_infantry', {
        name: '主力步兵营',
        size: 5_000,
        morale: 90,
        training: 90,
        supplies: 90,
        factionId: 'faction_player',
        locationId: 'location_xinye_field',
      }),
      makeWarTroop('troop_enemy_cavalry', {
        name: '新野守军',
        size: 120,
        morale: 20,
        training: 30,
        supplies: 30,
        factionId: 'faction_enemy',
        locationId: 'location_xinye_field',
        knownLevel: '听闻',
        certainty: 'reported',
      }),
    ],
    factions: [{
      factionId: 'faction_player',
      name: '荆州官府',
      type: '官府',
      summary: '我方势力',
      stanceToPlayer: '拥护',
      knownLevel: '亲历',
      relatedTroopIds: ['troop_player_infantry'],
      recentActions: [],
    }, {
      factionId: 'faction_enemy',
      name: '新野守军',
      type: '军阀',
      summary: '敌对势力',
      stanceToPlayer: '敌对',
      knownLevel: '亲历',
      relatedTroopIds: ['troop_enemy_cavalry'],
      recentActions: [],
    }],
    holdings: [{
      holdingId: 'holding_xinye',
      name: '新野县城',
      type: 'city',
      status: 'contested',
      summary: '正在交战的城池。',
      locationId: 'location_xinye_field',
      factionId: 'faction_enemy',
      actualController: '新野守军',
      scaleLevel: 2,
      agriculture: 40,
      commerce: 35,
      population: 40,
      publicOrder: 30,
      popularSupport: 30,
      defense: 55,
      recruitPotential: 40,
      armory: 45,
      horseSupply: 25,
      corruption: 20,
      siege: { status: 'encircled', supplyLine: 'cut', preparation: 'prepared' },
      garrisonTroopIds: ['troop_enemy_cavalry'],
      updatedAt: '公元194年05月03日 02:00',
    }],
    worldTrends: [{
      trendId: 'trend_untouched',
      title: '不应被战争内部推进',
      severity: '中',
      summary: '仅用于验证边界。',
      knownToPlayer: true,
      status: 'active',
      scope: 'realm',
      happenedAt: '公元194年05月01日 00:00',
      updatedAt: '公元194年05月01日 00:00',
    }],
  };
}

function makeIntent(): WarStartIntent {
  return {
    ...makeWarIntent(undefined, undefined, { player: [5_000], enemy: [120] }),
    sourceTurnNumber: 1,
    reason: '新野攻城战',
    objective: 'capture_holding' as const,
    targetHoldingId: 'holding_xinye',
    environmentTags: ['fortified'],
  };
}

function finishWar(input: WarEngineState): WarEngineState {
  let state = input;
  for (let guard = 0; guard < 80 && state.phase !== 'resolved'; guard += 1) {
    if (state.phase === 'awaiting_round') {
      state = executeWarRound(state, {
        player: { type: 'tactic', tactic: 'all_out_assault' },
        enemy: { type: 'tactic', tactic: 'steady_advance' },
      });
    } else if (state.phase === 'awaiting_decision' && state.pendingDecision) {
      state = resolveWarDecision(state, {
        choice: state.pendingDecision.kind === 'pursuit' ? 'pursue' : 'accept_surrender',
      });
    } else if (state.phase === 'auto_paused') {
      state = resumeWarAfterAutoPause(state);
    }
  }
  if (state.phase !== 'resolved') throw new Error('war fixture did not resolve');
  return state;
}

describe('War V2 runtime integration', () => {
  it('stages a legal war without optional commanders as a pending JSON-safe session', () => {
    const intent = makeIntent();
    delete intent.playerForce.commanderActorId;
    delete intent.enemyForce.commanderActorId;

    const staged = stageWarEncounter(makeRuntimeState(), {
      saveId: 'save_war_no_commanders',
      intent,
      projections: [],
      createdAt: '2026-07-20T00:30:00.000Z',
    });

    expect(staged.encounterV2?.active?.session.status).toBe('pending');
    expect(staged.encounterV2?.active?.checkpoint.checkpointKind).toBe('pre_encounter');
    const prepared = prepareWarEncounterForPlay(staged, { startedAt: '2026-07-20T00:31:00.000Z' });
    expect(prepared.snapshot.commanders).toEqual({});
    expect(prepared.engineState.phase).toBe('awaiting_round');
  });

  it('persists the local heavy-cavalry projection before battle even when the LLM omitted it', () => {
    const state = makeRuntimeState();
    state.troops![0].logisticsClass = 'heavy_cavalry';
    const staged = stageWarEncounter(state, {
      saveId: 'save_war_structured_heavy_cavalry',
      intent: makeIntent(),
      projections: [],
      createdAt: '2026-07-20T00:30:00.000Z',
    });
    const stored = staged.encounterV2?.semanticProjections.find(
      (profile) => profile.sourceId === 'troop_player_infantry',
    );
    const prepared = prepareWarEncounterForPlay(staged, { startedAt: '2026-07-20T00:31:00.000Z' });
    const force = prepared.snapshot.forces.find((entry) => entry.troopId === 'troop_player_infantry');

    expect(stored).toMatchObject({
      profileKind: 'troop',
      primaryClass: 'cavalry',
      tags: ['heavy', 'mobile', 'assault'],
    });
    expect(force).toMatchObject({
      primaryClass: 'cavalry',
      tags: ['heavy', 'mobile', 'assault'],
    });
  });

  it('derives participating officers from selected troop IDs and excludes unrelated NPCs', () => {
    const state = makeRuntimeState();
    state.npcs!.push({
      ...state.npcs![0],
      npcId: 'npc_zhao_yun',
      name: '赵云',
      relationToPlayer: '同袍',
      abilityScores: { 统率: 92, 智力: 78, 武力: 96, 魅力: 80, 政治: 55 },
      uniqueArts: [{
        id: 'art_zhao_break_formation',
        name: '七进七出',
        rarity: 'orange',
        domain: 'warfare',
        level: 4,
        description: '冲阵破敌。',
        effectSummary: '提高有效战力。',
        source: 'history',
      }],
    });
    state.npcs!.push({
      ...state.npcs![0],
      npcId: 'npc_unrelated',
      name: '未参战谋士',
    });
    state.troops![0].deputyNpcIds = ['npc_zhao_yun'];
    const staged = stageWarEncounter(state, {
      saveId: 'save_war_officer_projection',
      intent: makeIntent(),
      projections: [makeWarArtProfile('art_zhao_break_formation')],
      createdAt: '2026-07-20T00:30:00.000Z',
    });
    const prepared = prepareWarEncounterForPlay(staged, { startedAt: '2026-07-20T00:31:00.000Z' });

    expect(prepared.snapshot.officers?.player.map((officer) => officer.actorId)).toEqual(['npc_zhao_yun']);
    expect(prepared.snapshot.officers?.player[0].uniqueArtLabels).toEqual({
      art_zhao_break_formation: '七进七出',
    });
    expect(JSON.stringify(prepared.snapshot.officers)).not.toContain('npc_unrelated');
  });

  it('lets the player use a stored warfare art when the triggering response omitted its projection', () => {
    const state = makeRuntimeState();
    state.player.uniqueArts = [{
      id: 'art_player_formation',
      name: '军阵整肃',
      rarity: 'orange',
      domain: 'warfare',
      level: 4,
      description: '稳定军阵。',
      effectSummary: '提高军势协同。',
      source: 'opening',
    }];
    const staged = stageWarEncounter(state, {
      saveId: 'save_war_player_art_compatibility',
      intent: makeIntent(),
      projections: [
        makeTroopProfile('troop_player_infantry'),
        makeTroopProfile('troop_enemy_cavalry'),
      ],
      createdAt: '2026-07-20T00:30:00.000Z',
    });
    const prepared = prepareWarEncounterForPlay(staged, { startedAt: '2026-07-20T00:31:00.000Z' });

    expect(prepared.snapshot.commanders.player?.uniqueArtLabels).toEqual({
      art_player_formation: '军阵整肃',
    });
    const afterArt = executeWarRound(prepared.engineState, {
      player: { type: 'war_art', artId: 'art_player_formation' },
      enemy: { type: 'tactic', tactic: 'steady_advance' },
    });
    expect(afterArt.usedWarArt.player).toBe('art_player_formation');
    const result = createSealedWarResult(finishWar(afterArt), '2026-07-20T00:40:00.000Z');
    const committed = commitWarResultToRuntime(staged, {
      saveId: 'save_war_player_art_compatibility',
      session: prepared.session,
      result,
      committedAt: '2026-07-20T00:40:00.000Z',
    });
    const progressedArt = committed.player.uniqueArts?.find((art) => art.id === 'art_player_formation');
    expect(progressedArt?.progress).toBeGreaterThan(0);
    const progressRecord = progressedArt?.progressHistory?.[(progressedArt.progressHistory?.length ?? 1) - 1];
    expect(progressRecord).toMatchObject({
      source: 'actual_use',
      sourceRefId: `war:${result.encounterId}`,
      appliedTurnKey: `2:${staged.currentDate}`,
    });
  });

  it('migrates a pending pre-compatibility checkpoint before playing a stored warfare art', () => {
    const state = makeRuntimeState();
    state.player.uniqueArts = [{
      id: 'art_player_formation',
      name: '军阵整肃',
      rarity: 'orange',
      domain: 'warfare',
      level: 4,
      description: '稳定军阵。',
      effectSummary: '提高军势协同。',
      source: 'opening',
    }];
    const intent = makeIntent();
    const projections = [
      makeTroopProfile('troop_player_infantry'),
      makeTroopProfile('troop_enemy_cavalry'),
    ];
    const staged = stageWarEncounter(state, {
      saveId: 'save_war_player_art_legacy_checkpoint',
      intent,
      projections,
      createdAt: '2026-07-20T00:30:00.000Z',
    });
    const legacySnapshot = createWarEncounterSnapshot({
      sessionId: `session:${intent.encounterId}`,
      intent,
      playerLevel: state.player.level,
      playerTroops: state.troops!.filter((troop) => intent.playerForce.troopIds.includes(troop.troopId)),
      enemyTroops: state.troops!.filter((troop) => intent.enemyForce.troopIds.includes(troop.troopId)),
      playerCommander: state.player,
      enemyCommander: state.npcs![0],
      projections: createValidatedWarProjectionBundle(projections),
      repairStoredWarArtProjections: false,
    });
    const legacyPending = {
      ...staged,
      encounterV2: {
        ...staged.encounterV2!,
        semanticProjections: staged.encounterV2!.semanticProjections.filter(
          (profile) => profile.sourceId !== 'art_player_formation',
        ),
        active: {
          ...staged.encounterV2!.active!,
          session: {
            ...staged.encounterV2!.active!.session,
            snapshotHash: legacySnapshot.snapshotHash,
          },
        },
      },
    };

    const prepared = prepareWarEncounterForPlay(legacyPending, { startedAt: '2026-07-20T00:31:00.000Z' });

    expect(prepared.session.snapshotHash).toBe(prepared.snapshot.snapshotHash);
    expect(prepared.snapshot.commanders.player?.uniqueArtLabels).toEqual({
      art_player_formation: '军阵整肃',
    });
  });

  it('migrates a pending checkpoint whose legacy deployable strength exceeds surviving troop size', () => {
    const state = makeRuntimeState();
    state.troops![0] = makeWarTroop('troop_player_infantry', {
      ...state.troops![0],
      size: 300,
      deployableSize: 300,
    });
    const intent = makeWarIntent(
      ['troop_player_infantry'],
      ['troop_enemy_cavalry'],
      { player: [300], enemy: [120] },
    );
    intent.sourceTurnNumber = state.turnLog.length;
    const projections = [
      makeTroopProfile('troop_player_infantry', 'infantry', ['heavy']),
      makeTroopProfile('troop_enemy_cavalry', 'cavalry', ['mobile']),
    ];
    const staged = stageWarEncounter(state, {
      saveId: 'save_war_stale_capacity_checkpoint',
      intent,
      projections,
      createdAt: '2026-08-17T12:00:00.000Z',
    });
    const legacyTroops = staged.troops!.map((troop) => (
      troop.troopId === 'troop_player_infantry'
        ? { ...troop, size: 282, deployableSize: 300 }
        : troop
    ));
    const legacySnapshot = createWarEncounterSnapshot({
      sessionId: `session:${intent.encounterId}`,
      intent,
      playerLevel: state.player.level,
      playerTroops: [legacyTroops[0]],
      enemyTroops: [legacyTroops[1]],
      playerCommander: state.player,
      enemyCommander: state.npcs![0],
      projections: createValidatedWarProjectionBundle(projections),
      preserveLegacyDeployableOverflow: true,
    });
    const legacyPending = {
      ...staged,
      troops: legacyTroops,
      encounterV2: {
        ...staged.encounterV2!,
        active: {
          ...staged.encounterV2!.active!,
          session: {
            ...staged.encounterV2!.active!.session,
            snapshotHash: legacySnapshot.snapshotHash,
          },
          checkpoint: {
            ...staged.encounterV2!.active!.checkpoint,
            snapshotHash: legacySnapshot.snapshotHash,
          },
        },
      },
    };

    expect(legacySnapshot.snapshotHash).toBe(staged.encounterV2!.active!.session.snapshotHash);
    const prepared = prepareWarEncounterForPlay(legacyPending, { startedAt: '2026-08-17T12:01:00.000Z' });

    expect(prepared.session.snapshotHash).toBe(prepared.snapshot.snapshotHash);
    expect(prepared.snapshot.snapshotHash).not.toBe(legacySnapshot.snapshotHash);
    expect(prepared.snapshot.forces.find((force) => force.troopId === 'troop_player_infantry')).toMatchObject({
      initialStrength: 282,
      sourceStrength: 282,
      commitmentKind: 'full',
    });
    const result = createSealedWarResult(finishWar(prepared.engineState), '2026-08-17T12:10:00.000Z');
    const committed = commitWarResultToRuntime(legacyPending, {
      saveId: 'save_war_stale_capacity_checkpoint',
      session: prepared.session,
      result,
      committedAt: '2026-08-17T12:10:00.000Z',
    });
    const troop = committed.troops?.find((entry) => entry.troopId === 'troop_player_infantry');
    expect(troop?.deployableSize).toBeLessThanOrEqual(troop?.size ?? -1);
  });

  it('canonicalizes the reserved player commander alias to the actual runtime player ID', () => {
    const intent = makeIntent();
    intent.playerForce.commanderActorId = 'player';

    const staged = stageWarEncounter(makeRuntimeState(), {
      saveId: 'save_war_player_alias',
      intent,
      projections: [],
      createdAt: '2026-07-20T01:00:00.000Z',
    });

    expect(staged.encounterV2?.active?.session.intent).toMatchObject({
      kind: 'war',
      playerForce: { commanderActorId: 'player_liuping' },
    });
  });

  it('stages a pre-war checkpoint and rebuilds the local engine from stable troop IDs', () => {
    const staged = stageWarEncounter(makeRuntimeState(), {
      saveId: 'save_batch4',
      intent: makeIntent(),
      projections: [
        makeTroopProfile('troop_player_infantry', 'infantry', ['heavy']),
        makeTroopProfile('troop_enemy_cavalry', 'cavalry', ['mobile']),
      ],
      createdAt: '2026-07-20T04:00:00.000Z',
    });

    expect(staged.encounterV2?.active?.session.status).toBe('pending');
    expect(staged.encounterV2?.active?.checkpoint.checkpointKind).toBe('pre_encounter');
    const prepared = prepareWarEncounterForPlay(staged, { startedAt: '2026-07-20T04:01:00.000Z' });
    expect(prepared.session.status).toBe('fighting');
    expect(prepared.snapshot.forces.map((force) => `${force.side}:${force.troopId}`)).toEqual([
      'player:troop_player_infantry',
      'enemy:troop_enemy_cavalry',
    ]);
    expect(prepared.engineState.phase).toBe('awaiting_round');
  });

  it('settles troops, capture objective, siege state and conflict archive exactly once', () => {
    const initial = makeRuntimeState();
    const untouchedQuest = JSON.stringify(initial.activeQuests);
    const untouchedTrends = JSON.stringify(initial.worldTrends);
    const staged = stageWarEncounter(initial, {
      saveId: 'save_batch4',
      intent: makeIntent(),
      projections: [
        makeTroopProfile('troop_player_infantry', 'infantry', ['heavy']),
        makeTroopProfile('troop_enemy_cavalry', 'cavalry', ['mobile']),
      ],
      createdAt: '2026-07-20T04:00:00.000Z',
    });
    const prepared = prepareWarEncounterForPlay(staged, { startedAt: '2026-07-20T04:01:00.000Z' });
    const result = createSealedWarResult(finishWar(prepared.engineState), '2026-07-20T04:10:00.000Z');
    expect(result.objectiveAchieved).toBe(true);
    expect(result.experienceAward).toBe(200);
    expect(result.forces.find((force) => force.troopId === 'troop_enemy_cavalry')?.lifecycleStatus)
      .toBe('routed');

    const committed = commitWarResultToRuntime(staged, {
      saveId: 'save_batch4',
      session: prepared.session,
      result,
      committedAt: '2026-07-20T04:10:00.000Z',
      locationName: '荆州 - 南阳郡 - 新野县城',
    });
    expect(committed.encounterV2?.active?.session.status).toBe('narrative_pending');
    expect(committed.encounterV2?.appliedResultHashes).toEqual([result.resultHash]);
    expect(committed.player).toMatchObject({ level: 6, xp: 190, growthPoints: 4 });
    expect(committed.conflicts).toHaveLength(1);
    expect(committed.conflicts?.[0].conflictId).toBe(result.encounterId);
    expect(committed.conflicts?.[0].summary).toContain('本地战争判定');
    expect(committed.conflicts?.[0].summary).not.toMatch(/War Engine/i);
    expect(committed.holdings?.[0]).toMatchObject({
      holdingId: 'holding_xinye',
      status: 'controlled',
      factionId: 'faction_player',
      actualController: '荆州官府',
    });
    expect(committed.holdings?.[0].siege).toBeUndefined();
    expect(committed.troops?.find((troop) => troop.troopId === 'troop_enemy_cavalry')).toMatchObject({
      lifecycleStatus: 'routed',
      lastBattleId: result.encounterId,
      knownLevel: '亲历',
      certainty: 'confirmed',
      lastKnownAt: initial.currentDate,
    });
    expect(committed.factions?.find((faction) => faction.factionId === 'faction_enemy')?.relatedTroopIds)
      .toEqual([]);
    expect(committed.holdings?.[0].garrisonTroopIds).toEqual(['troop_player_infantry']);
    expect(JSON.stringify(committed.activeQuests)).toBe(untouchedQuest);
    expect(JSON.stringify(committed.worldTrends)).toBe(untouchedTrends);

    const duplicate = commitWarResultToRuntime(committed, {
      saveId: 'save_batch4',
      session: prepared.session,
      result,
      committedAt: '2026-07-20T04:11:00.000Z',
    });
    expect(duplicate).toEqual(committed);
    expect(duplicate.conflicts).toHaveLength(1);
  });

  it('settles only the committed detachment and leaves the wider campaign state untouched', () => {
    const initial = makeRuntimeState();
    initial.troops![0].deployableSize = 340;
    initial.troops = [
      ...(initial.troops ?? []),
      makeWarTroop('troop_imperial_main_force', {
        name: '皇甫嵩所部主力',
        detailLevel: 'intelligence',
        lifecycleStatus: 'unknown',
        strengthEstimate: { min: 20_000, max: 30_000 },
        relationToPlayer: '友军',
      }),
    ];
    const intent = makeWarIntent(
      ['troop_player_infantry'],
      ['troop_enemy_cavalry'],
      { player: [100], enemy: [120], commandScope: 'subordinate_sector' },
    );
    intent.reason = '朝廷大军会战中的局部接战';
    intent.sourceTurnNumber = initial.turnLog.length;
    intent.participation = {
      ...intent.participation!,
      alliedMainForceIds: ['troop_imperial_main_force'],
    };

    const staged = stageWarEncounter(initial, {
      saveId: 'save_subordinate_sector',
      intent,
      projections: [
        makeTroopProfile('troop_player_infantry', 'infantry', ['heavy']),
        makeTroopProfile('troop_enemy_cavalry', 'cavalry', ['mobile']),
      ],
      createdAt: '2026-07-20T04:00:00.000Z',
    });
    const prepared = prepareWarEncounterForPlay(staged, { startedAt: '2026-07-20T04:01:00.000Z' });
    expect(prepared.snapshot.forces.find((force) => force.troopId === 'troop_player_infantry')).toMatchObject({
      initialStrength: 100,
      sourceStrength: 5_000,
      commitmentKind: 'detachment',
    });
    const result = createSealedWarResult(finishWar(prepared.engineState), '2026-07-20T04:10:00.000Z');
    const committed = commitWarResultToRuntime(staged, {
      saveId: 'save_subordinate_sector',
      session: prepared.session,
      result,
      committedAt: '2026-07-20T04:10:00.000Z',
    });
    const playerResult = result.forces.find((force) => force.troopId === 'troop_player_infantry')!;
    expect(committed.troops?.find((troop) => troop.troopId === 'troop_player_infantry')).toMatchObject({
      size: 5_000 - playerResult.casualties,
      deployableSize: 340 - playerResult.casualties,
      lifecycleStatus: 'active',
    });
    const committedPlayerTroop = committed.troops?.find((troop) => troop.troopId === 'troop_player_infantry');
    expect(committedPlayerTroop?.statusTags ?? []).not.toContain('routed');
    expect(committedPlayerTroop?.changeHistory?.[committedPlayerTroop.changeHistory.length - 1]).toMatchObject({
      eventId: `war:${result.encounterId}:troop_player_infantry`,
    });
    expect(committed.holdings?.find((holding) => holding.holdingId === 'holding_xinye')).toMatchObject({
      status: 'contested',
      siege: { status: 'encircled' },
    });
  });

  it('settles a later war when an older result left deployableSize above the surviving troop size', () => {
    const initial = makeRuntimeState();
    initial.troops![0] = makeWarTroop('troop_player_infantry', {
      ...initial.troops![0],
      size: 282,
      deployableSize: 300,
    });
    const intent = makeWarIntent(
      ['troop_player_infantry'],
      ['troop_enemy_cavalry'],
      { player: [282], enemy: [120] },
    );
    intent.sourceTurnNumber = initial.turnLog.length;
    intent.reason = '连续作战后的再次接战';

    const staged = stageWarEncounter(initial, {
      saveId: 'save_stale_deployable_overflow',
      intent,
      projections: [
        makeTroopProfile('troop_player_infantry', 'infantry', ['heavy']),
        makeTroopProfile('troop_enemy_cavalry', 'cavalry', ['mobile']),
      ],
      createdAt: '2026-08-17T13:00:00.000Z',
    });
    const prepared = prepareWarEncounterForPlay(staged, { startedAt: '2026-08-17T13:01:00.000Z' });
    expect(prepared.snapshot.forces.find((force) => force.troopId === 'troop_player_infantry')).toMatchObject({
      initialStrength: 282,
      sourceStrength: 282,
      commitmentKind: 'full',
    });

    const result = createSealedWarResult(finishWar(prepared.engineState), '2026-08-17T13:10:00.000Z');
    const committed = commitWarResultToRuntime(staged, {
      saveId: 'save_stale_deployable_overflow',
      session: prepared.session,
      result,
      committedAt: '2026-08-17T13:10:00.000Z',
    });
    const troop = committed.troops?.find((entry) => entry.troopId === 'troop_player_infantry');
    expect(troop?.deployableSize).toBeLessThanOrEqual(troop?.size ?? -1);
  });

  it('adds one result-only narrative turn and then clears the active war', () => {
    const staged = stageWarEncounter(makeRuntimeState(), {
      saveId: 'save_batch4',
      intent: makeIntent(),
      projections: [
        makeTroopProfile('troop_player_infantry', 'infantry'),
        makeTroopProfile('troop_enemy_cavalry', 'cavalry'),
      ],
      createdAt: '2026-07-20T04:00:00.000Z',
    });
    const prepared = prepareWarEncounterForPlay(staged, { startedAt: '2026-07-20T04:01:00.000Z' });
    const result = createSealedWarResult(finishWar(prepared.engineState), '2026-07-20T04:10:00.000Z');
    const committed = commitWarResultToRuntime(staged, {
      saveId: 'save_batch4',
      session: prepared.session,
      result,
      committedAt: '2026-07-20T04:10:00.000Z',
    });

    const narrated = completeWarNarrativeTurn(committed, {
      resultHash: result.resultHash,
      narrativeText: '【旁白】新野城头易帜，战场终于归于沉寂。',
      suggestedActions: [{ label: '整顿城防', description: '清点伤亡并接管城防。', actionType: 'command' }],
      completedAt: '2026-07-20T04:12:00.000Z',
      provider: 'openai',
      model: 'test-model',
    });
    expect(narrated.turnLog).toHaveLength(2);
    expect(narrated.conflicts?.[0].reportText).toContain('城头易帜');
    expect(narrated.encounterV2?.active).toBeUndefined();
    expect(narrated.encounterV2?.narratedResultHashes).toEqual([result.resultHash]);

    expect(completeWarNarrativeTurn(narrated, {
      resultHash: result.resultHash,
      narrativeText: '不应重复写入',
      suggestedActions: [],
      completedAt: '2026-07-20T04:13:00.000Z',
    })).toEqual(narrated);
  });
});
