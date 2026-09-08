import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import scenarios from '../../scripts/balance/scenarios.json';
import { createCombatEncounterSnapshot } from '../../src/engine/encounterV2/CombatSnapshotAdapter';
import { createCombatEngineState } from '../../src/engine/encounterV2/CombatEngine';
import { simulateCombatWithLocalAi } from '../../src/engine/encounterV2/CombatAi';
import { makeCombatantSource, makeCombatIntent, bundle } from '../../src/engine/encounterV2/CombatTestFixtures';
import { createValidatedWarProjectionBundle, createWarEncounterSnapshot } from '../../src/engine/encounterV2/WarSnapshotAdapter';
import { createInitialWarState, executeWarRound, resolveWarDecision, resumeWarAfterAutoPause } from '../../src/engine/encounterV2/WarEngine';
import { makeWarCommander, makeWarIntent, makeWarTroop, makeTroopProfile } from '../../src/engine/encounterV2/WarTestFixtures';
import { COMBAT_RULESET_VERSION, WAR_RULESET_VERSION } from '../../src/engine/encounterV2/EncounterContracts';

describe('persistent real-engine balance simulator', () => {
  it('runs deterministic baseline/current scenarios and records distributions', () => {
    const metrics: Array<Record<string, string | number>> = [];
    const n = Number(process.env.BALANCE_SEEDS ?? scenarios.seeds);
    const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)];
    for (const version of new Set(['combat-v2.1.0', COMBAT_RULESET_VERSION])) for (const scenario of scenarios.combat) {
      const actions: number[] = []; const hp: number[] = []; let wins = 0;
      for (let seed = 0; seed < n; seed++) {
        const enemies = Array.from({ length: scenario.count }, (_, i) => `foe_${i}`);
        const intent = { ...makeCombatIntent(['hero'], enemies), seed: `balance:${seed}`, rulesetVersion: version as typeof COMBAT_RULESET_VERSION };
        const source = (id: string, martial: number) => makeCombatantSource(id, { abilityScores: { 武力: martial, 智力: 50, 统率: 50, 机运: 50 }, vitals: { hp: id === 'hero' && 'hp' in scenario ? Number(scenario.hp) : 100, maxHp: 100, stamina: 100, maxStamina: 100 } });
        const snapshot = createCombatEncounterSnapshot({ sessionId: 'balance', intent, playerSources: [source('hero', scenario.hero)], enemySources: enemies.map(id => source(id, scenario.foe)), projections: bundle(), threatTier: 'standard', combatDifficulty: 'standard', lootableItemIds: [], capturableEquipmentItemIds: [] });
        const end = simulateCombatWithLocalAi(createCombatEngineState(snapshot), { maxActions: 500 });
        expect(end.phase).toBe('resolved');
        if (end.outcome === 'player_victory') wins++;
        actions.push(end.actionLog.filter(row => row.actorId === 'hero').length);
        hp.push(end.combatants.find(actor => actor.actorId === 'hero')!.hp);
      }
      metrics.push({ mode: 'combat', version, name: scenario.name, seeds: n, winRate: wins / n, actionsP50: quantile(actions, 0.5), actionsP90: quantile(actions, 0.9), hpP50: quantile(hp, 0.5) });
    }
    for (const version of new Set(['war-v2.6.0', WAR_RULESET_VERSION])) for (const scenario of scenarios.war) {
      let wins = 0; let draws = 0; const ownLoss: number[] = []; const enemyLoss: number[] = [];
      for (let seed = 0; seed < n; seed++) {
        const intent = { ...makeWarIntent(['own'], ['enemy'], { player: [scenario.own], enemy: [scenario.enemy] }), rulesetVersion: version as typeof WAR_RULESET_VERSION, seed: `balance:${seed}` };
        const commander = (id: string, score: number) => makeWarCommander(id, { abilityScores: { 统率: score, 智力: score, 武力: 50, 魅力: 50, 政治: 50 }, traits: [], uniqueArts: [] });
        const snapshot = createWarEncounterSnapshot({ sessionId: 'balance', intent, playerTroops: [makeWarTroop('own', { size: scenario.own })], enemyTroops: [makeWarTroop('enemy', { size: scenario.enemy })], playerCommander: commander('player_liuping', scenario.hero), enemyCommander: commander('npc_enemy_commander', scenario.foe), projections: createValidatedWarProjectionBundle([makeTroopProfile('own'), makeTroopProfile('enemy')]), warDifficulty: 'standard' });
        let end = createInitialWarState(snapshot);
        for (let step = 0; step < 30 && end.phase !== 'resolved'; step++) {
          if (end.phase === 'awaiting_decision') end = resolveWarDecision(end, { choice: end.pendingDecision?.kind === 'pursuit' ? 'stop_pursuit' : 'accept_surrender' });
          else if (end.phase === 'auto_paused') end = resumeWarAfterAutoPause(end);
          else end = executeWarRound(end, { player: { type: 'tactic', tactic: 'steady_advance' }, enemy: { type: 'tactic', tactic: 'steady_advance' } });
        }
        expect(end.phase).toBe('resolved');
        if (end.outcome === 'player_victory') wins++;
        if (end.outcome === 'draw') draws++;
        const strength = (side: string) => end.forces.filter(force => force.side === side).reduce((sum, force) => sum + force.remainingStrength, 0);
        ownLoss.push(scenario.own - strength('player')); enemyLoss.push(scenario.enemy - strength('enemy'));
      }
      metrics.push({ mode: 'war', version, name: scenario.name, seeds: n, winRate: wins / n, drawRate: draws / n, ownLossP50: quantile(ownLoss, 0.5), enemyLossP50: quantile(enemyLoss, 0.5) });
    }
    const current = (name: string, version: string) => metrics.find(row => row.name === name && row.version === version)!;
    expect(Number(current('100 vs 40 civilian', COMBAT_RULESET_VERSION).actionsP50)).toBeLessThanOrEqual(3);
    expect(Number(current('100 vs three 40 guards', COMBAT_RULESET_VERSION).winRate)).toBeGreaterThanOrEqual(0.95);
    expect(Number(current('100 at 60HP vs three 40 guards', COMBAT_RULESET_VERSION).winRate)).toBeGreaterThanOrEqual(0.85);
    expect(Number(current('100 vs 100 peer', COMBAT_RULESET_VERSION).winRate)).toBeGreaterThanOrEqual(0.3);
    expect(Number(current('100 vs 100 peer', COMBAT_RULESET_VERSION).winRate)).toBeLessThanOrEqual(0.7);
    expect(Number(current('40 vs 100 reverse', COMBAT_RULESET_VERSION).winRate)).toBeLessThanOrEqual(0.05);
    expect(Number(current('commander 100 outnumbered tenfold', WAR_RULESET_VERSION).winRate)).toBeLessThanOrEqual(0.05);
    fs.mkdirSync('output/balance', { recursive: true });
    fs.writeFileSync(process.env.BALANCE_REPORT ?? 'output/balance/latest.json', JSON.stringify({ model: 'real-engines-v1', assumptions: 'standard difficulty; full health unless scenario overrides; no equipment or arts; same luck/intelligence in combat; equal training and supply; war steady advance; built-in AI in combat', metrics }, null, 2));
    console.log(JSON.stringify(metrics));
  }, 120_000);
});
