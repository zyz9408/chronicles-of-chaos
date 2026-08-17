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

const MATRIX_SIZE = 1_000;

function equippedPair(owner: string, quality: string) {
  return [
    { id: `${owner}_weapon`, slot: 'weapon' as const, name: '结构化武器', quality, description: '' },
    { id: `${owner}_armor`, slot: 'armor' as const, name: '结构化护甲', quality, description: '' },
  ];
}

function runCombat(seed: string, input: {
  playerMartial: number;
  enemyMartial: number;
  enemyCount: number;
  playerQuality: string;
  enemyQuality: string;
}) {
  const enemyIds = Array.from({ length: input.enemyCount }, (_, index) => `enemy_${index + 1}`);
  const intent = makeCombatIntent(['player'], enemyIds);
  intent.encounterId = `combat_${seed}`;
  intent.seed = seed;
  const snapshot = createCombatEncounterSnapshot({
    sessionId: `session_${seed}`,
    intent,
    playerSources: [makeCombatantSource('player', {
      abilityScores: { 武力: input.playerMartial, 机运: 50 },
      equipment: equippedPair('player', input.playerQuality),
    })],
    enemySources: enemyIds.map((actorId) => makeNpcCombatantSource(actorId, {
      abilityScores: { 武力: input.enemyMartial, 机运: 50 },
      equipment: equippedPair(actorId, input.enemyQuality),
    })),
    projections: bundle(),
    threatTier: 'standard',
    lootableItemIds: [],
    capturableEquipmentItemIds: [],
  });
  return finalizeCombatResult(
    simulateCombatWithLocalAi(createCombatEngineState(snapshot), { maxActions: 500 }),
    '2026-07-30T00:00:00.000Z',
    { playerActorId: 'player' },
  );
}

describe('Combat V2 elite and equipment regression matrix', () => {
  it('prevents a high-martial combatant in red gear from being randomly downed by one ordinary soldier', () => {
    const results = Array.from({ length: MATRIX_SIZE }, (_, index) => runCombat(`red-one-${index}`, {
      playerMartial: 95,
      enemyMartial: 35,
      enemyCount: 1,
      playerQuality: 'red',
      enemyQuality: 'white',
    }));

    expect(results.filter((result) => result.outcome === 'player_victory')).toHaveLength(MATRIX_SIZE);
    expect(Math.max(...results.map((result) => result.actionLog.length))).toBeLessThan(30);
  }, 15_000);

  it('keeps three ordinary soldiers dangerous without routinely defeating a famous-warrior profile in orange gear', () => {
    const results = Array.from({ length: MATRIX_SIZE }, (_, index) => runCombat(`orange-three-${index}`, {
      playerMartial: 90,
      enemyMartial: 40,
      enemyCount: 3,
      playerQuality: 'orange',
      enemyQuality: 'white',
    }));
    const playerVictories = results.filter((result) => result.outcome === 'player_victory').length;
    const enemyVictories = results.filter((result) => result.outcome === 'enemy_victory').length;

    expect(playerVictories).toBeGreaterThanOrEqual(980);
    expect(enemyVictories).toBeLessThanOrEqual(20);
    expect(Math.max(...results.map((result) => result.actionLog.length))).toBeLessThan(150);
  }, 15_000);
});
