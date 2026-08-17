import { describe, expect, it } from 'vitest';
import { chooseCombatAiAction, runAutoCombatUntilPause, shouldPauseAutoCombat } from './CombatAi';
import { createCombatEngineState } from './CombatEngine';
import { createCombatEncounterSnapshot } from './CombatSnapshotAdapter';
import {
  bundle,
  makeCombatIntent,
  makeCombatantSource,
  makeDamageArtProfile,
  makeHealingItemProfile,
  makeNpcCombatantSource,
} from './CombatTestFixtures';

function buildAiState() {
  const artLight = makeDamageArtProfile('art_light', {
    powerClass: 'light', powerMultiplier: 1.10, staminaCost: 8,
  });
  const artUltimate = makeDamageArtProfile('art_ultimate', {
    powerClass: 'ultimate', powerMultiplier: 2, staminaCost: 32, allowAutoUse: false,
  });
  const player = makeCombatantSource('player', {
    uniqueArts: [
      { id: 'art_light', name: '', rarity: 'blue', domain: 'personalCombat', level: 1, description: '', effectSummary: '', source: 'opening' },
      { id: 'art_ultimate', name: '', rarity: 'red', domain: 'personalCombat', level: 1, description: '', effectSummary: '', source: 'opening' },
    ],
    inventory: [{ id: 'medicine', name: '', quantity: 3 }],
  });
  const intent = makeCombatIntent(['player', 'ally'], ['enemy']);
  const snapshot = createCombatEncounterSnapshot({
    sessionId: 'session_ai',
    intent,
    playerSources: [player, makeCombatantSource('ally')],
    enemySources: [makeNpcCombatantSource('enemy')],
    projections: bundle(artLight, artUltimate, makeHealingItemProfile('medicine')),
    threatTier: 'minor',
    lootableItemIds: [],
    capturableEquipmentItemIds: [],
  });
  return createCombatEngineState(snapshot);
}

describe('CombatAi', () => {
  it('never chooses consumables, ultimate arts, retreat or surrender', () => {
    const state = buildAiState();
    state.phase = 'awaiting_action';
    state.currentActorId = 'player';
    state.combatants.find((combatant) => combatant.actorId === 'player')!.hp = 30;

    const action = chooseCombatAiAction(state, 'player');

    expect(action.type).not.toBe('use_item');
    expect(action.type).not.toBe('retreat');
    expect(action.type).not.toBe('surrender');
    if (action.type === 'unique_art') expect(action.artId).not.toBe('art_ultimate');

    state.combatants.find((combatant) => combatant.actorId === 'player')!.defending = true;
    expect(chooseCombatAiAction(state, 'player').type).not.toBe('defend');
  });

  it('prioritizes a valid one-time rescue for a downed ally', () => {
    const state = buildAiState();
    state.phase = 'awaiting_action';
    state.currentActorId = 'player';
    const ally = state.combatants.find((combatant) => combatant.actorId === 'ally')!;
    ally.hp = 0;
    ally.downCount = 1;
    ally.statuses = ['downed'];

    expect(chooseCombatAiAction(state, 'player')).toEqual({
      type: 'stabilize', actorId: 'player', targetId: 'ally',
    });
  });

  it('does not choose stabilization when the acting ally cannot pay 25 HP', () => {
    for (const rescuerHp of [25, 24, 1]) {
      const state = buildAiState();
      state.phase = 'awaiting_action';
      state.currentActorId = 'player';
      state.combatants.find((combatant) => combatant.actorId === 'player')!.hp = rescuerHp;
      const ally = state.combatants.find((combatant) => combatant.actorId === 'ally')!;
      ally.hp = 0;
      ally.downCount = 1;
      ally.statuses = ['downed'];

      expect(chooseCombatAiAction(state, 'player').type).not.toBe('stabilize');
    }
  });

  it('applies the same rescue threshold to an enemy retainer protecting a downed commander', () => {
    const intent = makeCombatIntent(['player'], ['enemy_commander', 'enemy_retainer']);
    const snapshot = createCombatEncounterSnapshot({
      sessionId: 'session_enemy_rescue',
      intent,
      playerSources: [makeCombatantSource('player')],
      enemySources: [
        makeNpcCombatantSource('enemy_commander'),
        makeNpcCombatantSource('enemy_retainer'),
      ],
      projections: bundle(),
      threatTier: 'minor',
      lootableItemIds: [],
      capturableEquipmentItemIds: [],
    });
    const state = createCombatEngineState(snapshot);
    state.phase = 'awaiting_action';
    state.currentActorId = 'enemy_retainer';
    const commander = state.combatants.find((combatant) => combatant.actorId === 'enemy_commander')!;
    const retainer = state.combatants.find((combatant) => combatant.actorId === 'enemy_retainer')!;
    commander.hp = 0;
    commander.downCount = 1;
    commander.statuses = ['downed'];
    retainer.hp = 25;

    expect(chooseCombatAiAction(state, 'enemy_retainer').type).not.toBe('stabilize');

    retainer.hp = 26;
    expect(chooseCombatAiAction(state, 'enemy_retainer')).toEqual({
      type: 'stabilize', actorId: 'enemy_retainer', targetId: 'enemy_commander',
    });
  });

  it('pauses automatic combat on low player HP, any player down or disposition decisions', () => {
    const lowHp = buildAiState();
    lowHp.combatants[0].hp = 24;
    expect(shouldPauseAutoCombat(lowHp)).toBe('player_low_hp');

    const downed = buildAiState();
    downed.combatants[1].hp = 0;
    downed.combatants[1].downCount = 1;
    downed.combatants[1].statuses = ['downed'];
    expect(shouldPauseAutoCombat(downed)).toBe('player_downed');

    const disposition = buildAiState();
    disposition.phase = 'awaiting_disposition';
    disposition.pendingDecision = { kind: 'fatal_disposition', targetSide: 'enemy', targetActorIds: ['enemy'] };
    expect(shouldPauseAutoCombat(disposition)).toBe('decision_required');
  });

  it('returns a paused state without spending an item or silently choosing a fatal decision', () => {
    const state = buildAiState();
    state.combatants[0].hp = 24;
    const paused = runAutoCombatUntilPause(state, { maxActions: 100 });

    expect(paused.phase).toBe('auto_paused');
    expect(paused.autoPauseReason).toBe('player_low_hp');
    expect(paused.combatants[0].itemQuantities.medicine).toBe(3);
    expect(paused.actionLog).toHaveLength(0);
  });
});
