import { describe, expect, it } from 'vitest';
import {
  chooseWarAiOrder,
  runAutoWarUntilPause,
  shouldPauseAutoWar,
} from './WarAi';
import { createInitialWarState, offerWarSurrender } from './WarEngine';
import { createValidatedWarProjectionBundle, createWarEncounterSnapshot } from './WarSnapshotAdapter';
import {
  makeTroopProfile,
  makeWarArtProfile,
  makeWarCommander,
  makeWarIntent,
  makeWarTroop,
} from './WarTestFixtures';

function makeState(overrides: { morale?: number; supply?: number; fatal?: boolean } = {}) {
  const playerTroop = makeWarTroop('troop_player_infantry', {
    morale: overrides.morale ?? 60,
    supplies: overrides.supply ?? 70,
  });
  const enemyTroop = makeWarTroop('troop_enemy_cavalry');
  const intent = makeWarIntent();
  if (overrides.fatal) intent.policy.lethality = 'fatal';
  const snapshot = createWarEncounterSnapshot({
    sessionId: 'session_war_ai',
    intent,
    playerTroops: [playerTroop],
    enemyTroops: [enemyTroop],
    playerCommander: makeWarCommander('player_liuping'),
    enemyCommander: makeWarCommander('npc_enemy_commander'),
    projections: createValidatedWarProjectionBundle([
      makeTroopProfile('troop_player_infantry', 'infantry', ['defensive']),
      makeTroopProfile('troop_enemy_cavalry', 'cavalry', ['mobile']),
      makeWarArtProfile('player_liuping_art_decisive_order'),
    ]),
  });
  return createInitialWarState(snapshot);
}

describe('WarAi', () => {
  it('selects only ordinary tactics and never war arts, retreat, surrender, pursuit or disposition', () => {
    const state = makeState();
    const order = chooseWarAiOrder(state, 'player');

    expect(order.type).toBe('tactic');
    if (order.type === 'tactic') {
      expect(['steady_advance', 'all_out_assault', 'hold_position', 'flank']).toContain(order.tactic);
    }
    expect(JSON.stringify(order)).not.toMatch(/art|retreat|surrender|pursuit|capture|kill/);
  });

  it('pauses on morale/supply danger, decisions and fatal risk', () => {
    expect(shouldPauseAutoWar(makeState({ morale: 20 }), 'player')).toBe('low_morale');
    expect(shouldPauseAutoWar(makeState({ supply: 20 }), 'player')).toBe('low_supply');
    expect(shouldPauseAutoWar(makeState({ fatal: true }), 'player')).toBe('fatal_risk');
    expect(shouldPauseAutoWar(offerWarSurrender(makeState(), 'enemy'), 'player')).toBe('decision_required');
  });

  it('runs deterministic ordinary rounds only until a danger boundary or resolution', () => {
    const first = runAutoWarUntilPause(makeState(), { maxRounds: 10 });
    const second = runAutoWarUntilPause(makeState(), { maxRounds: 10 });

    expect(first).toEqual(second);
    expect(['auto_paused', 'resolved']).toContain(first.phase);
    expect(first.actionLog.every((entry) => entry.actionType === 'war_round')).toBe(true);
  });

  it('never consumes or answers a pending surrender/pursuit decision', () => {
    const pending = offerWarSurrender(makeState(), 'enemy');
    const stopped = runAutoWarUntilPause(pending, { maxRounds: 10 });

    expect(stopped.phase).toBe('awaiting_decision');
    expect(stopped.pendingDecision).toEqual(pending.pendingDecision);
    expect(stopped.actionLog).toEqual(pending.actionLog);
    expect(stopped.autoPauseReason).toBe('decision_required');
  });
});
