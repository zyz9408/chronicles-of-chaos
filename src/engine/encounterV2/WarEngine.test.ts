import { describe, expect, it } from 'vitest';
import { verifyEncounterResultHash } from './EncounterDeterminism';
import {
  attemptWarRetreat,
  createInitialWarState,
  createSealedWarResult,
  executeWarRound,
  offerWarSurrender,
  resolveWarDecision,
} from './WarEngine';
import {
  AGGRESSIVE_WAR_RULESET_VERSION,
  COMMAND_WAR_RULESET_VERSION,
  REBALANCED_WAR_RULESET_VERSION,
} from './EncounterContracts';
import {
  createValidatedWarProjectionBundle,
  createWarEncounterSnapshot,
} from './WarSnapshotAdapter';
import {
  makeTroopProfile,
  makeWarArtProfile,
  makeWarCommander,
  makeWarIntent,
  makeWarTraitProfile,
  makeWarTroop,
} from './WarTestFixtures';
import type { WarEncounterSnapshot, WarEngineState, WarRoundOrders } from './WarTypes';

function makeSnapshot(options: {
  seed?: string;
  environmentTags?: Array<'open' | 'difficult' | 'fortified' | 'water'>;
  objective?: 'defeat_enemy' | 'capture_holding' | 'break_siege' | 'relieve_siege';
  playerTroops?: ReturnType<typeof makeWarTroop>[];
  enemyTroops?: ReturnType<typeof makeWarTroop>[];
  includeWarArt?: boolean;
  rulesetVersion?: WarEncounterSnapshot['intent']['rulesetVersion'];
  warDifficulty?: 'story' | 'easy' | 'standard' | 'hard' | 'brutal';
  playerCommanderOverrides?: Parameters<typeof makeWarCommander>[1];
  enemyCommanderOverrides?: Parameters<typeof makeWarCommander>[1];
} = {}): WarEncounterSnapshot {
  const playerTroops = options.playerTroops ?? [makeWarTroop('troop_player_infantry')];
  const enemyTroops = options.enemyTroops ?? [makeWarTroop('troop_enemy_cavalry')];
  const intent = makeWarIntent(
    playerTroops.map((troop) => troop.troopId),
    enemyTroops.map((troop) => troop.troopId),
  );
  intent.seed = options.seed ?? intent.seed;
  intent.rulesetVersion = options.rulesetVersion ?? intent.rulesetVersion;
  intent.environmentTags = options.environmentTags ?? intent.environmentTags;
  intent.objective = options.objective ?? intent.objective;
  if (intent.objective !== 'defeat_enemy') intent.targetHoldingId = 'holding_test_target';
  const profiles = [
    ...playerTroops.map((troop) => makeTroopProfile(troop.troopId, 'infantry', ['anti_cavalry'])),
    ...enemyTroops.map((troop) => makeTroopProfile(troop.troopId, 'cavalry', ['mobile'])),
    makeWarTraitProfile('player_liuping_trait_stable_command'),
    ...(options.includeWarArt ? [makeWarArtProfile('player_liuping_art_decisive_order')] : []),
  ];
  return createWarEncounterSnapshot({
    sessionId: 'session_war_batch3',
    intent,
    playerTroops,
    enemyTroops,
    playerCommander: makeWarCommander('player_liuping', options.playerCommanderOverrides),
    warDifficulty: options.warDifficulty,
    enemyCommander: makeWarCommander('npc_enemy_commander', options.enemyCommanderOverrides),
    projections: createValidatedWarProjectionBundle(profiles),
  });
}

function runOrders(snapshot: WarEncounterSnapshot, orders: WarRoundOrders[], maxRounds = orders.length): WarEngineState {
  let state = createInitialWarState(snapshot);
  for (const order of orders.slice(0, maxRounds)) {
    if (state.phase !== 'awaiting_round') break;
    state = executeWarRound(state, order);
  }
  return state;
}

describe('WarEngine deterministic rounds', () => {
  it('replays the same seed and full tactic sequence exactly', () => {
    const snapshot = makeSnapshot({ seed: 'war-replay-seed' });
    const orders: WarRoundOrders[] = Array.from({ length: 5 }, (_, index) => ({
      player: { type: 'tactic', tactic: index % 2 === 0 ? 'all_out_assault' : 'steady_advance' },
      enemy: { type: 'tactic', tactic: index % 2 === 0 ? 'flank' : 'hold_position' },
    }));

    expect(runOrders(snapshot, orders)).toEqual(runOrders(snapshot, orders));
  });

  it('applies tactic counters, simultaneous casualties and bounded resource changes', () => {
    const state = executeWarRound(createInitialWarState(makeSnapshot({ seed: 'war-counter-seed' })), {
      player: { type: 'tactic', tactic: 'all_out_assault' },
      enemy: { type: 'tactic', tactic: 'flank' },
    });
    const player = state.forces.find((force) => force.side === 'player');
    const enemy = state.forces.find((force) => force.side === 'enemy');

    expect(state.round).toBe(1);
    expect(state.actionLog).toHaveLength(1);
    expect(state.actionLog[0].values.counterWinner).toBe('player');
    expect(player?.remainingStrength).toBeLessThan(1_000);
    expect(enemy?.remainingStrength).toBeLessThan(1_000);
    expect(player?.supply).toBe(62);
    expect(player?.fatigue).toBe(25);
    for (const force of state.forces) {
      expect(force.morale).toBeGreaterThanOrEqual(0);
      expect(force.morale).toBeLessThanOrEqual(100);
      expect(force.supply).toBeGreaterThanOrEqual(0);
      expect(force.supply).toBeLessThanOrEqual(100);
      expect(force.fatigue).toBeGreaterThanOrEqual(0);
      expect(force.fatigue).toBeLessThanOrEqual(100);
    }
  });

  it('applies War V2.6 intelligence to tactics and martial ability to aggressive pressure only', () => {
    const commanderOverrides = {
      playerCommanderOverrides: { abilityScores: { 统率: 70, 智力: 90, 武力: 90, 魅力: 50, 政治: 50 } },
      enemyCommanderOverrides: { abilityScores: { 统率: 70, 智力: 50, 武力: 50, 魅力: 50, 政治: 50 } },
    };
    const orders: WarRoundOrders = {
      player: { type: 'tactic', tactic: 'all_out_assault' },
      enemy: { type: 'tactic', tactic: 'hold_position' },
    };
    const current = executeWarRound(createInitialWarState(makeSnapshot({
      seed: 'war-v26-attributes',
      ...commanderOverrides,
    })), orders);
    const legacy = executeWarRound(createInitialWarState(makeSnapshot({
      seed: 'war-v26-attributes',
      rulesetVersion: REBALANCED_WAR_RULESET_VERSION,
      ...commanderOverrides,
    })), orders);
    const currentValues = current.actionLog[0].values;
    const legacyValues = legacy.actionLog[0].values;

    expect(currentValues).toMatchObject({
      playerIntelligenceTacticFactorBps: 11_600,
      playerMartialPressureBps: 11_000,
      enemyIntelligenceTacticFactorBps: 8_400,
      enemyMartialPressureBps: 10_000,
    });
    expect(legacyValues.playerIntelligenceTacticFactorBps).toBe(10_000);
    expect(legacyValues.playerMartialPressureBps).toBe(10_000);
  });

  it('applies the frozen war difficulty through player effective strength', () => {
    const orders: WarRoundOrders = {
      player: { type: 'tactic', tactic: 'steady_advance' },
      enemy: { type: 'tactic', tactic: 'steady_advance' },
    };
    const story = executeWarRound(createInitialWarState(makeSnapshot({ seed: 'war-difficulty', warDifficulty: 'story' })), orders);
    const brutal = executeWarRound(createInitialWarState(makeSnapshot({ seed: 'war-difficulty', warDifficulty: 'brutal' })), orders);
    const storyLog = story.actionLog[0]?.values;
    const brutalLog = brutal.actionLog[0]?.values;

    expect(story.snapshot.warDifficulty).toBe('story');
    expect(storyLog?.warDifficulty).toBe('story');
    expect(Number(storyLog?.playerEffective)).toBeGreaterThan(Number(brutalLog?.playerEffective));
    expect(Number(storyLog?.playerCasualties)).toBeLessThanOrEqual(Number(brutalLog?.playerCasualties));
    expect(Number(storyLog?.enemyCasualties)).toBeGreaterThanOrEqual(Number(brutalLog?.enemyCasualties));
  });

  it('allows one explicit war art per side and rejects a second use', () => {
    const snapshot = makeSnapshot({ includeWarArt: true });
    const first = executeWarRound(createInitialWarState(snapshot), {
      player: { type: 'war_art', artId: 'player_liuping_art_decisive_order' },
      enemy: { type: 'tactic', tactic: 'steady_advance' },
    });

    expect(first.usedWarArt.player).toBe('player_liuping_art_decisive_order');
    expect(() => executeWarRound(first, {
      player: { type: 'war_art', artId: 'player_liuping_art_decisive_order' },
      enemy: { type: 'tactic', tactic: 'steady_advance' },
    })).toThrow(/每场战争只能使用一次/);
  });

  it('gives a blue warfare art a material one-round strength impact instead of a token bonus', () => {
    const snapshot = makeSnapshot({ includeWarArt: true, seed: 'war-art-strength-impact' });
    const baseline = executeWarRound(createInitialWarState(snapshot), {
      player: { type: 'tactic', tactic: 'steady_advance' },
      enemy: { type: 'tactic', tactic: 'steady_advance' },
    });
    const withArt = executeWarRound(createInitialWarState(snapshot), {
      player: { type: 'war_art', artId: 'player_liuping_art_decisive_order' },
      enemy: { type: 'tactic', tactic: 'steady_advance' },
    });
    const baselineEffective = Number(baseline.actionLog[0]?.values.playerEffective);
    const artEffective = Number(withArt.actionLog[0]?.values.playerEffective);

    // Numerical-superiority compression remains active after the raw +67.5% art budget,
    // but even a blue art must still move the actually engaged strength by at least 20%.
    expect(artEffective).toBeGreaterThanOrEqual(baselineEffective * 1.20);
    expect(withArt.usedWarArt.player).toBe('player_liuping_art_decisive_order');
  });

  it('preserves frozen War V2.4 art resolution while War V2.5 applies the enhanced budget', () => {
    const artOrders: WarRoundOrders = {
      player: { type: 'war_art', artId: 'player_liuping_art_decisive_order' },
      enemy: { type: 'tactic', tactic: 'steady_advance' },
    };
    const baselineOrders: WarRoundOrders = {
      player: { type: 'tactic', tactic: 'steady_advance' },
      enemy: { type: 'tactic', tactic: 'steady_advance' },
    };
    const v24Snapshot = makeSnapshot({
      includeWarArt: true,
      seed: 'war-art-ruleset-isolation',
      rulesetVersion: AGGRESSIVE_WAR_RULESET_VERSION,
    });
    const currentSnapshot = makeSnapshot({
      includeWarArt: true,
      seed: 'war-art-ruleset-isolation',
    });
    const v24 = executeWarRound(createInitialWarState(v24Snapshot), artOrders);
    const v24Baseline = executeWarRound(createInitialWarState(v24Snapshot), baselineOrders);
    const current = executeWarRound(createInitialWarState(currentSnapshot), artOrders);
    const currentBaseline = executeWarRound(createInitialWarState(currentSnapshot), baselineOrders);
    const v24Uplift = Number(v24.actionLog[0]?.values.playerEffective)
      / Number(v24Baseline.actionLog[0]?.values.playerEffective);
    const currentUplift = Number(current.actionLog[0]?.values.playerEffective)
      / Number(currentBaseline.actionLog[0]?.values.playerEffective);

    expect(v24.snapshot.intent.rulesetVersion).toBe(AGGRESSIVE_WAR_RULESET_VERSION);
    expect(currentUplift).toBeGreaterThan(v24Uplift);
  });

  it('allows a participating deputy war art while preserving the one-art-per-side limit', () => {
    const intent = makeWarIntent();
    const deputy = makeWarCommander('npc_zhao_yun', {
      name: '赵云',
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
    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_deputy_art',
      intent,
      playerTroops: [makeWarTroop('troop_player_infantry')],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      playerOfficers: [{ source: deputy, role: 'deputy', troopIds: ['troop_player_infantry'] }],
      projections: createValidatedWarProjectionBundle([
        makeWarArtProfile('art_zhao_break_formation'),
      ]),
    });
    const first = executeWarRound(createInitialWarState(snapshot), {
      player: { type: 'war_art', artId: 'art_zhao_break_formation' },
      enemy: { type: 'tactic', tactic: 'steady_advance' },
    });

    expect(first.usedWarArt.player).toBe('art_zhao_break_formation');
    expect(() => executeWarRound(first, {
      player: { type: 'war_art', artId: 'art_zhao_break_formation' },
      enemy: { type: 'tactic', tactic: 'steady_advance' },
    })).toThrow(/每场战争只能使用一次/);
  });

  it('stops applying a troop semantic profile after that troop leaves the active force', () => {
    const playerTroops = [
      makeWarTroop('troop_player_banner'),
      makeWarTroop('troop_player_line'),
    ];
    const enemyTroops = [makeWarTroop('troop_enemy_line')];
    const intent = makeWarIntent(
      playerTroops.map((troop) => troop.troopId),
      enemyTroops.map((troop) => troop.troopId),
    );
    const buffProfile = makeTroopProfile('troop_player_banner');
    buffProfile.effects = [{
      trigger: 'before_war_resolution',
      condition: 'always',
      operation: 'modify_effective_strength',
      target: 'own_force',
      value: 30,
      priority: 10,
    }];
    const build = (withBuff: boolean) => createWarEncounterSnapshot({
      sessionId: withBuff ? 'session_war_inactive_buff' : 'session_war_inactive_base',
      intent: { ...intent, seed: 'war-inactive-profile-seed' },
      playerTroops,
      enemyTroops,
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([
        withBuff ? buffProfile : makeTroopProfile('troop_player_banner'),
        makeTroopProfile('troop_player_line'),
        makeTroopProfile('troop_enemy_line'),
      ]),
    });
    const run = (snapshot: WarEncounterSnapshot) => {
      const initial = createInitialWarState(snapshot);
      const banner = initial.forces.find((force) => force.troopId === 'troop_player_banner');
      if (!banner) throw new Error('missing banner fixture');
      banner.remainingStrength = 0;
      banner.casualties = banner.initialStrength;
      banner.morale = 0;
      banner.lifecycleStatus = 'destroyed';
      return executeWarRound(initial, {
        player: { type: 'tactic', tactic: 'steady_advance' },
        enemy: { type: 'tactic', tactic: 'steady_advance' },
      });
    };

    const buffed = run(build(true));
    const baseline = run(build(false));
    expect(buffed.actionLog[0].values.playerEffective).toBe(baseline.actionLog[0].values.playerEffective);
  });

  it('lets prepared anti-cavalry route cavalry within the strict ten-round cap', () => {
    const snapshot = makeSnapshot({ seed: 'war-ten-round-seed' });
    const orders: WarRoundOrders[] = Array.from({ length: 10 }, () => ({
      player: { type: 'tactic', tactic: 'hold_position' },
      enemy: { type: 'tactic', tactic: 'hold_position' },
    }));
    const state = runOrders(snapshot, orders);

    expect(state.round).toBe(10);
    expect(state.phase).toBe('resolved');
    expect(state.outcome).toBe('player_victory');
    expect(state.exitReason).toBe('force_routed');
    expect(state.actionLog[state.actionLog.length - 1]?.values.roundLimitOutcome).toBeUndefined();
    expect(() => executeWarRound(state, orders[0])).toThrow(/等待战争轮次/);
  });

  it('keeps in-progress War V2.1 sessions on their original result path', () => {
    const state = executeWarRound(createInitialWarState(makeSnapshot({
      seed: 'war-v21-compatibility-seed',
      rulesetVersion: COMMAND_WAR_RULESET_VERSION,
    })), {
      player: { type: 'tactic', tactic: 'all_out_assault' },
      enemy: { type: 'tactic', tactic: 'steady_advance' },
    });
    const values = state.actionLog[0].values;

    expect(values.playerOpeningShock).toBeUndefined();
    expect(values.enemyOpeningShock).toBeUndefined();
  });
});

describe('WarEngine decisions and immutable result', () => {
  it('keeps original troop IDs and writes surrendered/captured terminal facts only after explicit acceptance', () => {
    const initial = createInitialWarState(makeSnapshot());
    const offered = offerWarSurrender(initial, 'enemy');

    expect(offered.phase).toBe('awaiting_decision');
    expect(offered.pendingDecision).toEqual({
      kind: 'surrender_offer',
      decidingSide: 'player',
      offeringSide: 'enemy',
    });

    const rejected = resolveWarDecision(offered, { choice: 'reject_surrender' });
    expect(rejected.phase).toBe('awaiting_round');

    const accepted = resolveWarDecision(offerWarSurrender(rejected, 'enemy'), { choice: 'accept_surrender' });
    const enemy = accepted.forces.find((force) => force.side === 'enemy');
    expect(accepted.phase).toBe('resolved');
    expect(accepted.outcome).toBe('surrender');
    expect(enemy).toMatchObject({
      troopId: 'troop_enemy_cavalry',
      lifecycleStatus: 'surrendered',
      capturedCount: enemy?.remainingStrength,
    });
    expect(accepted.forces).toHaveLength(2);
  });

  it('requires an explicit pursuit decision after a successful retreat and never opens a second war', () => {
    const initial = createInitialWarState(makeSnapshot({ seed: 'war-retreat-seed' }));
    let state = attemptWarRetreat(initial, 'enemy');
    expect(state.round).toBe(1);
    for (let attempt = 1; attempt < 8 && state.phase === 'awaiting_round'; attempt += 1) {
      state = attemptWarRetreat(state, 'enemy');
    }
    expect(['awaiting_decision', 'resolved']).toContain(state.phase);
    if (state.phase === 'awaiting_decision') {
      expect(state.pendingDecision?.kind).toBe('pursuit');
      const beforeRounds = state.round;
      state = resolveWarDecision(state, { choice: 'pursue' });
      expect(state.phase).toBe('resolved');
      expect(state.round).toBe(beforeRounds);
      expect(state.pursuit.status).toBe('resolved');
      expect(state.pursuit.extraCasualties).toBeGreaterThanOrEqual(0);
    }
  });

  it('uses registered objective conditions so breaking a siege can succeed through a player withdrawal', () => {
    let state = createInitialWarState(makeSnapshot({
      seed: 'war-break-siege-3',
      objective: 'break_siege',
      environmentTags: ['fortified'],
    }));
    for (let attempt = 0; attempt < 10 && state.phase === 'awaiting_round'; attempt += 1) {
      state = attemptWarRetreat(state, 'player');
    }
    expect(state.phase).toBe('awaiting_decision');
    state = resolveWarDecision(state, { choice: 'stop_pursuit' });

    expect(state.outcome).toBe('player_retreat');
    expect(state.objectiveAchieved).toBe(true);
  });

  it('seals a complete result with casualties, objective, lifecycle, pursuit and idempotent deltas', () => {
    const accepted = resolveWarDecision(
      offerWarSurrender(createInitialWarState(makeSnapshot()), 'enemy'),
      { choice: 'accept_surrender' },
    );
    const result = createSealedWarResult(accepted, '2026-07-20T04:00:00.000Z');

    expect(result).toMatchObject({
      kind: 'war',
      objective: 'defeat_enemy',
      objectiveAchieved: true,
      exitReason: 'surrender',
      roundsCompleted: 0,
      experienceAward: 40,
    });
    expect(result.forces.find((force) => force.side === 'enemy')).toMatchObject({
      troopId: 'troop_enemy_cavalry',
      initialStrength: 1_000,
      remainingStrength: 1_000,
      casualties: 0,
      capturedCount: 1_000,
      lifecycleStatus: 'surrendered',
    });
    expect(new Set(result.deltas.map((delta) => delta.idempotencyKey)).size).toBe(result.deltas.length);
    expect(verifyEncounterResultHash(result)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => {
      (result.forces as unknown as Array<{ morale: number }>)[0].morale = 0;
    }).toThrow();
  });
});
