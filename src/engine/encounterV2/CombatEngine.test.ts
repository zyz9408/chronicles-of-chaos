import { describe, expect, it } from 'vitest';
import { verifyEncounterResultHash } from './EncounterDeterminism';
import {
  advanceCombatToNextAction,
  createCombatEngineState,
  executeCombatAction,
  finalizeCombatResult,
  resolveCombatDecision,
} from './CombatEngine';
import { simulateCombatWithLocalAi } from './CombatAi';
import { createCombatEncounterSnapshot } from './CombatSnapshotAdapter';
import type { CombatEngineState, CombatRuntimeCombatant } from './CombatTypes';
import {
  bundle,
  makeCombatIntent,
  makeCombatantSource,
  makeDamageArtProfile,
  makeHealingItemProfile,
  makeNpcCombatantSource,
  makeWeaponProfile,
} from './CombatTestFixtures';

function buildSnapshot(options: {
  players?: number;
  enemies?: number;
  seed?: string;
  playerOverrides?: Parameters<typeof makeCombatantSource>[1];
  enemyOverrides?: Parameters<typeof makeNpcCombatantSource>[1];
  projections?: ReturnType<typeof bundle>;
  lootableItemIds?: string[];
  capturableEquipmentItemIds?: string[];
  lethality?: 'nonlethal' | 'standard' | 'fatal';
} = {}) {
  const playerIds = Array.from({ length: options.players ?? 1 }, (_, index) => `player_${index + 1}`);
  const enemyIds = Array.from({ length: options.enemies ?? 1 }, (_, index) => `enemy_${index + 1}`);
  const intent = makeCombatIntent(playerIds, enemyIds);
  intent.seed = options.seed ?? 'engine-seed';
  intent.policy.lethality = options.lethality ?? 'standard';
  return createCombatEncounterSnapshot({
    sessionId: `session_${intent.seed}`,
    intent,
    playerSources: playerIds.map((id) => makeCombatantSource(id, options.playerOverrides)),
    enemySources: enemyIds.map((id) => makeNpcCombatantSource(id, options.enemyOverrides)),
    projections: options.projections ?? bundle(),
    threatTier: 'standard',
    lootableItemIds: options.lootableItemIds ?? [],
    capturableEquipmentItemIds: options.capturableEquipmentItemIds ?? [],
  });
}

function forceTurn(
  state: CombatEngineState,
  actorId: string,
  transform: (combatants: CombatRuntimeCombatant[]) => CombatRuntimeCombatant[] = (combatants) => combatants,
): CombatEngineState {
  return {
    ...state,
    phase: 'awaiting_action',
    currentActorId: actorId,
    combatants: transform(state.combatants.map((combatant) => ({
      ...combatant,
      statuses: [...combatant.statuses],
      artUsage: { ...combatant.artUsage },
      itemUsage: { ...combatant.itemUsage },
      itemQuantities: { ...combatant.itemQuantities },
      modifiers: { ...combatant.modifiers },
    }))),
  };
}

describe('CombatEngine deterministic core', () => {
  it.each([
    [1, 1],
    [1, 3],
    [2, 2],
    [3, 3],
  ])('replays fixed-seed %iv%i combat to the same sealed result', (players, enemies) => {
    const snapshot = buildSnapshot({ players, enemies, seed: `matrix-${players}v${enemies}` });
    const first = simulateCombatWithLocalAi(createCombatEngineState(snapshot), { maxActions: 500 });
    const second = simulateCombatWithLocalAi(createCombatEngineState(snapshot), { maxActions: 500 });
    const firstResult = finalizeCombatResult(first, '2026-07-20T00:30:00.000Z');
    const secondResult = finalizeCombatResult(second, '2026-07-20T00:30:00.000Z');

    expect(first.phase).toBe('resolved');
    expect(firstResult.resultHash).toBe(secondResult.resultHash);
    expect(firstResult.actionLog).toEqual(secondResult.actionLog);
    expect(verifyEncounterResultHash(firstResult)).toBe(true);
  });

  it('selects a ready actor by overflow, speed, then frozen stable order', () => {
    const snapshot = buildSnapshot({ players: 2, enemies: 1 });
    const state = createCombatEngineState(snapshot);
    state.combatants[0].gauge = 990;
    state.combatants[1].gauge = 990;
    state.combatants[2].gauge = 0;
    state.combatants[0].speed = 100;
    state.combatants[1].speed = 120;

    const ready = advanceCombatToNextAction(state);

    expect(ready.currentActorId).toBe('player_2');
    expect(ready.phase).toBe('awaiting_action');
  });

  it('defend restores six stamina, lasts until the next action and is logged', () => {
    let state = forceTurn(createCombatEngineState(buildSnapshot()), 'player_1', (combatants) => {
      combatants[0].stamina = 80;
      return combatants;
    });
    state = executeCombatAction(state, { type: 'defend', actorId: 'player_1' });
    expect(state.combatants[0]).toMatchObject({ stamina: 86, defending: true });

    state = forceTurn(state, 'player_1');
    state = executeCombatAction(state, { type: 'normal_attack', actorId: 'player_1', targetId: 'enemy_1' });
    expect(state.combatants[0].defending).toBe(false);
    expect(state.actionLog.map((entry) => entry.actionType)).toEqual(['defend', 'normal_attack']);
  });

  it('spends stamina once for a multi-hit art and enforces its per-battle limit', () => {
    const art = makeDamageArtProfile('art_three_hits', { perEncounterLimit: 1 });
    const snapshot = buildSnapshot({
      playerOverrides: {
        uniqueArts: [{
          id: 'art_three_hits', name: '', rarity: 'blue', domain: 'personalCombat', level: 1,
          description: '', effectSummary: '', source: 'opening',
        }],
      },
      enemyOverrides: { vitals: { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 } },
      projections: bundle(art),
    });
    let state = forceTurn(createCombatEngineState(snapshot), 'player_1');
    state = executeCombatAction(state, {
      type: 'unique_art', actorId: 'player_1', artId: 'art_three_hits', targetIds: ['enemy_1'],
    });

    expect(state.combatants[0].stamina).toBe(86);
    expect(state.combatants[0].artUsage.art_three_hits).toBe(1);
    expect(state.actionLog[0].values.hitsAttempted).toBe(3);

    state = forceTurn(state, 'player_1');
    expect(() => executeCombatAction(state, {
      type: 'unique_art', actorId: 'player_1', artId: 'art_three_hits', targetIds: ['enemy_1'],
    })).toThrow('使用次数');
  });

  it('uses a projected combat item as one action and consumes exactly the declared quantity', () => {
    const snapshot = buildSnapshot({
      playerOverrides: {
        vitals: { hp: 40, maxHp: 100, stamina: 100, maxStamina: 100 },
        inventory: [{ id: 'medicine', name: 'medicine', quantity: 2 }],
      },
      projections: bundle(makeHealingItemProfile('medicine')),
    });
    let state = forceTurn(createCombatEngineState(snapshot), 'player_1');
    state = executeCombatAction(state, {
      type: 'use_item', actorId: 'player_1', itemId: 'medicine', targetIds: ['player_1'],
    });

    expect(state.combatants[0].hp).toBe(60);
    expect(state.combatants[0].itemQuantities.medicine).toBe(1);
    expect(state.actionLog).toHaveLength(1);

    const resolved = { ...state, phase: 'resolved' as const, outcome: 'player_victory' as const };
    const result = finalizeCombatResult(resolved, '2026-07-20T00:15:00.000Z');
    expect(result.deltas.filter((delta) => delta.targetKind === 'item')).toHaveLength(1);
    expect(result.deltas.find((delta) => delta.targetKind === 'item')).toMatchObject({ beforeValue: 2, afterValue: 1 });
  });

  it('enforces an item effect target instead of trusting a caller-supplied enemy ID', () => {
    const snapshot = buildSnapshot({
      playerOverrides: { inventory: [{ id: 'medicine', name: 'medicine', quantity: 1 }] },
      projections: bundle(makeHealingItemProfile('medicine')),
    });
    const state = forceTurn(createCombatEngineState(snapshot), 'player_1');

    expect(() => executeCombatAction(state, {
      type: 'use_item', actorId: 'player_1', itemId: 'medicine', targetIds: ['enemy_1'],
    })).toThrow('目标');
  });

  it('allows one stabilization, applies severe injury and rejects recovery after a second down', () => {
    let state = createCombatEngineState(buildSnapshot({ players: 2 }));
    state = forceTurn(state, 'player_2', (combatants) => {
      const target = combatants[0];
      target.hp = 0;
      target.downCount = 1;
      target.statuses = ['downed'];
      return combatants;
    });
    state = executeCombatAction(state, { type: 'stabilize', actorId: 'player_2', targetId: 'player_1' });
    expect(state.combatants[0]).toMatchObject({ hp: 25, stamina: 20, revivedOnce: true });
    expect(state.combatants[0].statuses).toContain('severely_wounded');

    state = forceTurn(state, 'player_2', (combatants) => {
      const target = combatants[0];
      target.hp = 0;
      target.downCount = 2;
      target.statuses = ['downed', 'severely_wounded'];
      return combatants;
    });
    expect(() => executeCombatAction(state, {
      type: 'stabilize', actorId: 'player_2', targetId: 'player_1',
    })).toThrow('第二次倒地');
  });

  it('replays retreat success or failure with the same seed and applies a fixed failure penalty', () => {
    const snapshot = buildSnapshot({ seed: 'retreat-replay' });
    const attempt = () => executeCombatAction(
      forceTurn(createCombatEngineState(snapshot), 'player_1'),
      { type: 'retreat', actorId: 'player_1' },
    );
    const first = attempt();
    const second = attempt();

    expect(first.outcome).toBe(second.outcome);
    expect(first.actionLog).toEqual(second.actionLog);
    if (first.phase !== 'resolved') {
      expect(first.combatants[0].stamina).toBe(92);
      expect(first.combatants[0].statuses).toContain('retreat_failed');
    }
  });

  it('requires an explicit fatal disposition and never lets prose decide death', () => {
    let state = createCombatEngineState(buildSnapshot({ lethality: 'fatal' }));
    state = forceTurn(state, 'player_1', (combatants) => {
      const enemy = combatants.find((combatant) => combatant.actorId === 'enemy_1');
      if (!enemy) throw new Error('missing enemy');
      enemy.hp = 0;
      enemy.downCount = 2;
      enemy.statuses = ['downed'];
      return combatants;
    });
    state = executeCombatAction(state, { type: 'defend', actorId: 'player_1' });

    expect(state.phase).toBe('awaiting_disposition');
    expect(state.combatants.find((combatant) => combatant.actorId === 'enemy_1')?.statuses).not.toContain('dead');

    state = resolveCombatDecision(state, { choice: 'kill' });
    expect(state.phase).toBe('resolved');
    expect(state.combatants.find((combatant) => combatant.actorId === 'enemy_1')?.statuses).toContain('dead');
  });

  it('keeps surrender policy-bound and pauses enemy surrender for an explicit player decision', () => {
    const snapshot = buildSnapshot();
    let state = forceTurn(createCombatEngineState(snapshot), 'enemy_1');
    state = executeCombatAction(state, { type: 'surrender', actorId: 'enemy_1' });
    expect(state.phase).toBe('awaiting_disposition');
    expect(state.pendingDecision?.kind).toBe('enemy_surrender');

    state = resolveCombatDecision(state, { choice: 'accept_surrender' });
    expect(state.phase).toBe('resolved');
    expect(state.outcome).toBe('surrender');
    expect(state.combatants.find((combatant) => combatant.actorId === 'enemy_1')?.statuses).toContain('captured');

    const forbiddenIntent = makeCombatIntent(['player_1'], ['enemy_1']);
    forbiddenIntent.policy.allowSurrender = false;
    const forbiddenSnapshot = createCombatEncounterSnapshot({
      sessionId: 'session_surrender_forbidden',
      intent: forbiddenIntent,
      playerSources: [makeCombatantSource('player_1')],
      enemySources: [makeNpcCombatantSource('enemy_1')],
      projections: bundle(),
      threatTier: 'minor',
      lootableItemIds: [],
      capturableEquipmentItemIds: [],
    });
    const forbidden = forceTurn(createCombatEngineState(forbiddenSnapshot), 'enemy_1');
    expect(() => executeCombatAction(forbidden, { type: 'surrender', actorId: 'enemy_1' })).toThrow('不允许投降');
  });

  it('settles XP, real loot, captured equipment and elapsed time exactly once in a frozen result', () => {
    const enemyInventory = [{ id: 'loot_real', name: 'loot', quantity: 1 }];
    const enemyEquipment = [{ id: 'equipment_real', slot: 'weapon' as const, name: '', quality: '', description: '' }];
    const snapshot = buildSnapshot({
      enemyOverrides: { inventory: enemyInventory, equipment: enemyEquipment },
      projections: bundle(makeWeaponProfile('equipment_real')),
      lootableItemIds: ['loot_real'],
      capturableEquipmentItemIds: ['equipment_real'],
    });
    const state = {
      ...createCombatEngineState(snapshot),
      phase: 'resolved' as const,
      outcome: 'player_victory' as const,
      actionLog: Array.from({ length: 13 }, (_, index) => ({
        sequence: index + 1,
        actionId: `action_${index + 1}`,
        actorId: 'player_1',
        targetIds: ['enemy_1'],
        actionType: 'normal_attack',
        randomDrawStart: index,
        randomDrawEnd: index + 1,
        summaryKey: 'combat.normal_attack.hit',
        values: { damage: 1 },
      })),
    };
    const first = finalizeCombatResult(state, '2026-07-20T00:30:00.000Z');
    const second = finalizeCombatResult(state, '2026-07-20T00:30:00.000Z');

    expect(first).toMatchObject({
      elapsedMinutes: 30,
      experienceAward: 30,
      lootItemIds: ['loot_real'],
      capturedEquipmentItemIds: ['equipment_real'],
    });
    expect(first.resultHash).toBe(second.resultHash);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.combatants)).toBe(true);
  });
});
