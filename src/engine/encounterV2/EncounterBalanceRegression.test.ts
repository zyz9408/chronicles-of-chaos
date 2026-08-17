import { describe, expect, it } from 'vitest';
import { simulateCombatWithLocalAi } from './CombatAi';
import { createCombatEngineState, finalizeCombatResult } from './CombatEngine';
import { createCombatEncounterSnapshot } from './CombatSnapshotAdapter';
import {
  bundle,
  makeCombatIntent,
  makeCombatantSource,
  makeNpcCombatantSource,
} from './CombatTestFixtures';
import { createInitialWarState, createSealedWarResult, executeWarRound } from './WarEngine';
import {
  createValidatedWarProjectionBundle,
  createWarEncounterSnapshot,
} from './WarSnapshotAdapter';
import {
  makeTroopProfile,
  makeWarCommander,
  makeWarIntent,
  makeWarTroop,
} from './WarTestFixtures';
import type { EncounterOutcome } from './EncounterContracts';

const BALANCE_SEEDS = Array.from({ length: 48 }, (_, index) => `balance-seed-${index + 1}`);

function countOutcomes(outcomes: EncounterOutcome[]): Record<EncounterOutcome, number> {
  return outcomes.reduce<Record<EncounterOutcome, number>>((counts, outcome) => {
    counts[outcome] += 1;
    return counts;
  }, {
    player_victory: 0,
    enemy_victory: 0,
    player_retreat: 0,
    enemy_retreat: 0,
    surrender: 0,
    draw: 0,
  });
}

function runCombat(seed: string, input: {
  players?: number;
  enemies?: number;
  playerMartial: number;
  enemyMartial: number;
}) {
  const playerIds = Array.from({ length: input.players ?? 1 }, (_, index) => `player_${index + 1}`);
  const enemyIds = Array.from({ length: input.enemies ?? 1 }, (_, index) => `enemy_${index + 1}`);
  const intent = makeCombatIntent(playerIds, enemyIds);
  intent.encounterId = `encounter_combat_${seed}`;
  intent.seed = seed;
  const snapshot = createCombatEncounterSnapshot({
    sessionId: `session_combat_${seed}`,
    intent,
    playerSources: playerIds.map((actorId) => makeCombatantSource(actorId, {
      abilityScores: { 武力: input.playerMartial, 机运: 50 },
    })),
    enemySources: enemyIds.map((actorId) => makeNpcCombatantSource(actorId, {
      abilityScores: { 武力: input.enemyMartial, 机运: 50 },
    })),
    projections: bundle(),
    threatTier: 'standard',
    lootableItemIds: [],
    capturableEquipmentItemIds: [],
  });
  const state = simulateCombatWithLocalAi(createCombatEngineState(snapshot), { maxActions: 500 });
  return finalizeCombatResult(state, '2026-07-20T08:00:00.000Z', { playerActorId: playerIds[0] });
}

function runWar(seed: string, advantaged: boolean) {
  const playerTroop = makeWarTroop('troop_player', advantaged ? {
    size: 1_500,
    morale: 85,
    training: 85,
    quality: '高',
    readiness: '高',
    supplies: 90,
    fatigue: '低',
  } : {});
  const enemyTroop = makeWarTroop('troop_enemy', advantaged ? {
    size: 800,
    morale: 55,
    training: 50,
    quality: '中',
    readiness: '中',
    supplies: 60,
    fatigue: '低',
  } : {});
  const intent = makeWarIntent([playerTroop.troopId], [enemyTroop.troopId], {
    player: [playerTroop.size],
    enemy: [enemyTroop.size],
  });
  intent.encounterId = `encounter_war_${seed}`;
  intent.seed = seed;
  const snapshot = createWarEncounterSnapshot({
    sessionId: `session_war_${seed}`,
    intent,
    playerTroops: [playerTroop],
    enemyTroops: [enemyTroop],
    playerCommander: makeWarCommander('player_liuping', advantaged ? {
      abilityScores: { 统率: 85, 智力: 80, 武力: 65, 魅力: 60, 政治: 55 },
    } : {}),
    enemyCommander: makeWarCommander('npc_enemy_commander', advantaged ? {
      abilityScores: { 统率: 55, 智力: 50, 武力: 55, 魅力: 45, 政治: 45 },
    } : {}),
    projections: createValidatedWarProjectionBundle([
      makeTroopProfile(playerTroop.troopId, 'infantry'),
      makeTroopProfile(enemyTroop.troopId, 'infantry'),
    ]),
  });
  let state = createInitialWarState(snapshot);
  while (state.phase === 'awaiting_round') {
    state = executeWarRound(state, {
      player: { type: 'tactic', tactic: 'steady_advance' },
      enemy: { type: 'tactic', tactic: 'steady_advance' },
    });
  }
  return createSealedWarResult(state, '2026-07-20T09:00:00.000Z');
}

describe('Encounter V2 deterministic balance regression', () => {
  it('keeps ordinary Combat exchanges bounded while rewarding a clear martial advantage', () => {
    const balanced = BALANCE_SEEDS.map((seed) => runCombat(seed, {
      playerMartial: 70,
      enemyMartial: 70,
    }));
    const advantaged = BALANCE_SEEDS.map((seed) => runCombat(`adv-${seed}`, {
      playerMartial: 90,
      enemyMartial: 45,
    }));
    const threeVsThree = BALANCE_SEEDS.slice(0, 16).map((seed) => runCombat(`party-${seed}`, {
      players: 3,
      enemies: 3,
      playerMartial: 70,
      enemyMartial: 70,
    }));
    const all = [...balanced, ...advantaged, ...threeVsThree];
    const largestSingleHit = Math.max(...all.flatMap((result) => result.actionLog
      .map((entry) => Number(entry.values.damage ?? 0))));
    const actionCounts = all.map((result) => result.actionLog.length);
    const balancedCounts = countOutcomes(balanced.map((result) => result.outcome));
    const advantagedCounts = countOutcomes(advantaged.map((result) => result.outcome));

    expect(largestSingleHit).toBeLessThanOrEqual(35);
    expect(Math.min(...actionCounts)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...actionCounts)).toBeLessThan(220);
    expect(balancedCounts.player_victory).toBeGreaterThan(0);
    expect(balancedCounts.enemy_victory).toBeGreaterThan(0);
    expect(advantagedCounts.player_victory).toBeGreaterThanOrEqual(42);
    expect(advantagedCounts.enemy_victory).toBeLessThanOrEqual(3);
  });

  it('keeps War rounds and casualty rates bounded while making a material advantage decisive', () => {
    const balanced = BALANCE_SEEDS.map((seed) => runWar(seed, false));
    const advantaged = BALANCE_SEEDS.map((seed) => runWar(`adv-${seed}`, true));
    const all = [...balanced, ...advantaged];
    const roundRates = all.flatMap((result) => result.actionLog
      .filter((entry) => entry.actionType === 'war_round')
      .flatMap((entry) => [
        Number(entry.values.playerCasualtyRateBps ?? 0),
        Number(entry.values.enemyCasualtyRateBps ?? 0),
      ]));
    const balancedCounts = countOutcomes(balanced.map((result) => result.outcome));
    const advantagedCounts = countOutcomes(advantaged.map((result) => result.outcome));

    expect(Math.min(...roundRates)).toBeGreaterThanOrEqual(50);
    expect(Math.max(...roundRates)).toBeLessThanOrEqual(800);
    expect(all.every((result) => result.roundsCompleted >= 1 && result.roundsCompleted <= 10)).toBe(true);
    expect(balancedCounts.player_victory + balancedCounts.enemy_victory + balancedCounts.draw).toBe(BALANCE_SEEDS.length);
    expect(advantagedCounts.player_victory).toBeGreaterThanOrEqual(40);
    expect(advantagedCounts.enemy_victory).toBe(0);
  });
});
