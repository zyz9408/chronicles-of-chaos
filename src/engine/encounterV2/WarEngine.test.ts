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
} = {}): WarEncounterSnapshot {
  const playerTroops = options.playerTroops ?? [makeWarTroop('troop_player_infantry')];
  const enemyTroops = options.enemyTroops ?? [makeWarTroop('troop_enemy_cavalry')];
  const intent = makeWarIntent(
    playerTroops.map((troop) => troop.troopId),
    enemyTroops.map((troop) => troop.troopId),
  );
  intent.seed = options.seed ?? intent.seed;
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
    playerCommander: makeWarCommander('player_liuping'),
    enemyCommander: makeWarCommander('npc_enemy_commander'),
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

  it('settles an accumulated class advantage at the strict ten-round cap', () => {
    const snapshot = makeSnapshot({ seed: 'war-ten-round-seed' });
    const orders: WarRoundOrders[] = Array.from({ length: 10 }, () => ({
      player: { type: 'tactic', tactic: 'hold_position' },
      enemy: { type: 'tactic', tactic: 'hold_position' },
    }));
    const state = runOrders(snapshot, orders);

    expect(state.round).toBe(10);
    expect(state.phase).toBe('resolved');
    expect(state.outcome).toBe('enemy_victory');
    expect(state.exitReason).toBe('round_limit');
    expect(state.actionLog[state.actionLog.length - 1]?.values.roundLimitOutcome).toBe('enemy_victory');
    expect(() => executeWarRound(state, orders[0])).toThrow(/等待战争轮次/);
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
