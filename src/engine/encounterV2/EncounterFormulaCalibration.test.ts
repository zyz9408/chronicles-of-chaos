import { describe, expect, it } from 'vitest';
import { simulateCombatWithLocalAi } from './CombatAi';
import { createCombatEngineState, finalizeCombatResult } from './CombatEngine';
import { createCombatEncounterSnapshot } from './CombatSnapshotAdapter';
import {
  bundle,
  makeArmorProfile,
  makeCombatIntent,
  makeCombatantSource,
  makeNpcCombatantSource,
  makeWeaponProfile,
} from './CombatTestFixtures';
import type { EquipmentSemanticProfile, EncounterOutcome } from './EncounterContracts';
import { createInitialWarState, createSealedWarResult, executeWarRound } from './WarEngine';
import { createValidatedWarProjectionBundle, createWarEncounterSnapshot } from './WarSnapshotAdapter';
import type { WarTactic } from './WarTypes';
import {
  makeTroopProfile,
  makeWarCommander,
  makeWarIntent,
  makeWarTroop,
} from './WarTestFixtures';

const SEEDS = Array.from({ length: 96 }, (_, index) => `formula-${index + 1}`);

interface EquipmentLoadout {
  weapon?: Partial<EquipmentSemanticProfile>;
  armor?: Partial<EquipmentSemanticProfile>;
}

interface CombatScenario {
  playerMartial: number;
  enemyMartial: number;
  players?: number;
  enemies?: number;
  playerLoadout?: EquipmentLoadout;
  enemyLoadout?: EquipmentLoadout;
}

function equipmentFor(
  owner: string,
  loadout: EquipmentLoadout | undefined,
): {
  equipment: Array<{ id: string; slot: 'weapon' | 'armor'; name: string; quality: string; description: string }>;
  projections: EquipmentSemanticProfile[];
} {
  const equipment: Array<{ id: string; slot: 'weapon' | 'armor'; name: string; quality: string; description: string }> = [];
  const projections: EquipmentSemanticProfile[] = [];
  if (loadout?.weapon) {
    const id = `${owner}_weapon`;
    equipment.push({ id, slot: 'weapon', name: id, quality: 'blue', description: '' });
    projections.push(makeWeaponProfile(id, loadout.weapon));
  }
  if (loadout?.armor) {
    const id = `${owner}_armor`;
    equipment.push({ id, slot: 'armor', name: id, quality: 'blue', description: '' });
    projections.push(makeArmorProfile(id, loadout.armor));
  }
  return { equipment, projections };
}

function runCombat(seed: string, scenario: CombatScenario) {
  const playerIds = Array.from({ length: scenario.players ?? 1 }, (_, index) => `player_${index + 1}`);
  const enemyIds = Array.from({ length: scenario.enemies ?? 1 }, (_, index) => `enemy_${index + 1}`);
  const playerKits = playerIds.map((id) => equipmentFor(id, scenario.playerLoadout));
  const enemyKits = enemyIds.map((id) => equipmentFor(id, scenario.enemyLoadout));
  const intent = makeCombatIntent(playerIds, enemyIds);
  intent.encounterId = `combat_${seed}`;
  intent.seed = seed;
  const snapshot = createCombatEncounterSnapshot({
    sessionId: `session_${seed}`,
    intent,
    playerSources: playerIds.map((id, index) => makeCombatantSource(id, {
      abilityScores: { 武力: scenario.playerMartial, 机运: 50 },
      equipment: playerKits[index].equipment,
    })),
    enemySources: enemyIds.map((id, index) => makeNpcCombatantSource(id, {
      abilityScores: { 武力: scenario.enemyMartial, 机运: 50 },
      equipment: enemyKits[index].equipment,
    })),
    projections: bundle(
      ...playerKits.flatMap((kit) => kit.projections),
      ...enemyKits.flatMap((kit) => kit.projections),
    ),
    threatTier: 'standard',
    lootableItemIds: [],
    capturableEquipmentItemIds: [],
  });
  return finalizeCombatResult(
    simulateCombatWithLocalAi(createCombatEngineState(snapshot), { maxActions: 500 }),
    '2026-07-20T08:00:00.000Z',
  );
}

interface WarScenario {
  playerSize: number;
  enemySize: number;
  playerScore?: number;
  enemyScore?: number;
  playerClass?: Parameters<typeof makeTroopProfile>[1];
  enemyClass?: Parameters<typeof makeTroopProfile>[1];
  playerTags?: Parameters<typeof makeTroopProfile>[2];
  enemyTags?: Parameters<typeof makeTroopProfile>[2];
  environment?: Array<'open' | 'difficult' | 'fortified' | 'water'>;
  playerTactic?: WarTactic;
  enemyTactic?: WarTactic;
}

function commanderAbilities(score: number) {
  return { 统率: score, 智力: score, 武力: score, 魅力: score, 政治: score };
}

function runWar(seed: string, scenario: WarScenario) {
  const player = makeWarTroop('troop_player', { size: scenario.playerSize });
  const enemy = makeWarTroop('troop_enemy', { size: scenario.enemySize });
  const intent = makeWarIntent([player.troopId], [enemy.troopId]);
  intent.encounterId = `war_${seed}`;
  intent.seed = seed;
  intent.environmentTags = scenario.environment ?? ['open'];
  const snapshot = createWarEncounterSnapshot({
    sessionId: `session_${seed}`,
    intent,
    playerTroops: [player],
    enemyTroops: [enemy],
    playerCommander: makeWarCommander('player_liuping', {
      abilityScores: commanderAbilities(scenario.playerScore ?? 60),
    }),
    enemyCommander: makeWarCommander('npc_enemy_commander', {
      abilityScores: commanderAbilities(scenario.enemyScore ?? 60),
    }),
    projections: createValidatedWarProjectionBundle([
      makeTroopProfile(player.troopId, scenario.playerClass ?? 'infantry', scenario.playerTags ?? []),
      makeTroopProfile(enemy.troopId, scenario.enemyClass ?? 'infantry', scenario.enemyTags ?? []),
    ]),
  });
  let state = createInitialWarState(snapshot);
  while (state.phase === 'awaiting_round') {
    state = executeWarRound(state, {
      player: { type: 'tactic', tactic: scenario.playerTactic ?? 'steady_advance' },
      enemy: { type: 'tactic', tactic: scenario.enemyTactic ?? 'steady_advance' },
    });
  }
  return createSealedWarResult(state, '2026-07-20T09:00:00.000Z');
}

function summarize(results: Array<ReturnType<typeof runCombat> | ReturnType<typeof runWar>>) {
  const outcomes = results.reduce<Record<EncounterOutcome, number>>((counts, result) => {
    counts[result.outcome] += 1;
    return counts;
  }, {
    player_victory: 0,
    enemy_victory: 0,
    player_retreat: 0,
    enemy_retreat: 0,
    surrender: 0,
    draw: 0,
  });
  const actionCounts = results.map((result) => result.actionLog.length).sort((a, b) => a - b);
  return {
    outcomes,
    meanActions: Number((actionCounts.reduce((sum, value) => sum + value, 0) / actionCounts.length).toFixed(2)),
    p50Actions: actionCounts[Math.floor(actionCounts.length / 2)],
    p90Actions: actionCounts[Math.floor(actionCounts.length * 0.9)],
  };
}

describe('Encounter V2 formula calibration matrix', () => {
  it('keeps the Combat martial curve monotonic without fixed-side initiative bias', () => {
    const martial = [40, 55, 70, 85, 100].map((playerMartial) => ({
      playerMartial,
      ...summarize(SEEDS.map((seed) => runCombat(`${seed}-m${playerMartial}`, {
        playerMartial,
        enemyMartial: 70,
      }))),
    }));
    const playerWins = martial.map((entry) => entry.outcomes.player_victory);

    expect(playerWins).toEqual([...playerWins].sort((left, right) => left - right));
    expect(playerWins[0]).toBeLessThanOrEqual(5);
    expect(playerWins[1]).toBeLessThanOrEqual(25);
    expect(playerWins[2]).toBeGreaterThanOrEqual(36);
    expect(playerWins[2]).toBeLessThanOrEqual(60);
    expect(playerWins[3]).toBeGreaterThanOrEqual(70);
    expect(playerWins[3]).toBeLessThanOrEqual(94);
    expect(playerWins[4]).toBeGreaterThanOrEqual(90);
    expect(Math.max(...martial.map((entry) => entry.p90Actions))).toBeLessThan(50);
  });

  it('keeps heavy/light weapons, armor and 3v3 exchanges inside playable bands', () => {
    const equipmentScenarios: Array<{
      name: string;
      playerLoadout?: EquipmentLoadout;
      enemyLoadout?: EquipmentLoadout;
    }> = [
      {
        name: 'bare-vs-bare',
        playerLoadout: undefined,
        enemyLoadout: undefined,
      },
      {
        name: 'heavy-vs-light',
        playerLoadout: { weapon: { weaponWeight: 'heavy', weaponBaseDamage: 14, accuracyBonus: 3 } },
        enemyLoadout: { weapon: { weaponWeight: 'light', weaponBaseDamage: 10, accuracyBonus: 3 } },
      },
      {
        name: 'light-vs-heavy',
        playerLoadout: { weapon: { weaponWeight: 'light', weaponBaseDamage: 10, accuracyBonus: 3 } },
        enemyLoadout: { weapon: { weaponWeight: 'heavy', weaponBaseDamage: 14, accuracyBonus: 3 } },
      },
      {
        name: 'heavy-armor-vs-none',
        playerLoadout: { armor: { armorWeight: 'heavy', armorTier: 3, blockBonus: 6 } },
        enemyLoadout: undefined,
      },
    ];
    const equipment = equipmentScenarios.map((scenario) => ({
      name: scenario.name,
      ...summarize(SEEDS.map((seed) => runCombat(`${seed}-${scenario.name}`, {
        playerMartial: 70,
        enemyMartial: 70,
        playerLoadout: scenario.playerLoadout,
        enemyLoadout: scenario.enemyLoadout,
      }))),
    }));
    const threeVsThree = summarize(SEEDS.slice(0, 32).map((seed) => runCombat(`${seed}-3v3`, {
      players: 3,
      enemies: 3,
      playerMartial: 70,
      enemyMartial: 70,
    })));

    const byName = new Map(equipment.map((entry) => [entry.name, entry]));
    expect(byName.get('bare-vs-bare')!.outcomes.player_victory).toBeGreaterThanOrEqual(36);
    expect(byName.get('bare-vs-bare')!.outcomes.player_victory).toBeLessThanOrEqual(60);
    expect(byName.get('heavy-vs-light')!.outcomes.player_victory).toBeGreaterThanOrEqual(35);
    expect(byName.get('heavy-vs-light')!.outcomes.player_victory).toBeLessThanOrEqual(65);
    expect(byName.get('light-vs-heavy')!.outcomes.player_victory).toBeGreaterThanOrEqual(35);
    expect(byName.get('light-vs-heavy')!.outcomes.player_victory).toBeLessThanOrEqual(65);
    expect(byName.get('heavy-armor-vs-none')!.outcomes.player_victory).toBeGreaterThanOrEqual(48);
    expect(byName.get('heavy-armor-vs-none')!.outcomes.player_victory).toBeLessThanOrEqual(75);
    expect(threeVsThree.p90Actions).toBeLessThan(150);
  });

  it('resolves clear War advantages at the round limit while preserving close draws', () => {
    const scenarios: Array<{ name: string; value: WarScenario }> = [
      { name: 'ratio-0.75', value: { playerSize: 750, enemySize: 1_000 } },
      { name: 'ratio-1.00', value: { playerSize: 1_000, enemySize: 1_000 } },
      { name: 'ratio-1.25', value: { playerSize: 1_250, enemySize: 1_000 } },
      { name: 'ratio-1.50', value: { playerSize: 1_500, enemySize: 1_000 } },
      { name: 'command-plus-20', value: { playerSize: 1_000, enemySize: 1_000, playerScore: 80, enemyScore: 60 } },
      {
        name: 'counter-win',
        value: { playerSize: 1_000, enemySize: 1_000, playerTactic: 'all_out_assault', enemyTactic: 'flank' },
      },
      {
        name: 'counter-loss',
        value: { playerSize: 1_000, enemySize: 1_000, playerTactic: 'flank', enemyTactic: 'all_out_assault' },
      },
      {
        name: 'open-mobile-flank',
        value: {
          playerSize: 1_000,
          enemySize: 1_000,
          playerClass: 'cavalry',
          playerTags: ['mobile'],
          environment: ['open'],
          playerTactic: 'flank',
        },
      },
      {
        name: 'fortified-bad-flank',
        value: {
          playerSize: 1_000,
          enemySize: 1_000,
          environment: ['fortified'],
          playerTactic: 'flank',
          enemyTactic: 'hold_position',
          enemyTags: ['defensive'],
        },
      },
      {
        name: 'water-naval',
        value: {
          playerSize: 1_000,
          enemySize: 1_000,
          playerClass: 'naval',
          enemyClass: 'infantry',
          environment: ['water'],
        },
      },
    ];
    const curve = new Map(scenarios.map((scenario) => {
      const results = SEEDS.map((seed) => runWar(`${seed}-${scenario.name}`, scenario.value));
      return [scenario.name, { results, summary: summarize(results) }] as const;
    }));

    expect(curve.get('ratio-0.75')!.summary.outcomes.enemy_victory).toBeGreaterThanOrEqual(90);
    expect(curve.get('ratio-1.00')!.summary.outcomes.draw).toBe(SEEDS.length);
    expect(curve.get('ratio-1.25')!.summary.outcomes.player_victory).toBeGreaterThanOrEqual(90);
    expect(curve.get('ratio-1.50')!.summary.outcomes.player_victory).toBeGreaterThanOrEqual(90);
    expect(curve.get('command-plus-20')!.summary.outcomes.player_victory).toBeGreaterThanOrEqual(80);
    expect(curve.get('counter-win')!.summary.outcomes.player_victory).toBeGreaterThanOrEqual(90);
    expect(curve.get('counter-loss')!.summary.outcomes.enemy_victory).toBeGreaterThanOrEqual(90);
    expect(curve.get('open-mobile-flank')!.summary.outcomes.player_victory).toBeGreaterThanOrEqual(90);
    expect(curve.get('fortified-bad-flank')!.summary.outcomes.enemy_victory).toBeGreaterThanOrEqual(90);
    expect(curve.get('water-naval')!.summary.outcomes.player_victory).toBeGreaterThanOrEqual(90);
    expect([...curve.values()].every(({ results }) => results.every((result) => (
      result.objectiveAchieved === (result.outcome === 'player_victory')
    )))).toBe(true);
  });
});
