import {
  advanceCombatToNextAction,
  executeCombatAction,
  resolveCombatDecision,
} from './CombatEngine';
import type {
  CombatAction,
  CombatAutoPauseReason,
  CombatEngineState,
} from './CombatTypes';

function isActive(combatant: CombatEngineState['combatants'][number]): boolean {
  return combatant.hp > 0
    && !combatant.statuses.includes('dead')
    && !combatant.statuses.includes('captured')
    && !combatant.statuses.includes('surrendered');
}

export function shouldPauseAutoCombat(state: CombatEngineState): CombatAutoPauseReason | undefined {
  if (state.phase === 'awaiting_disposition') return 'decision_required';
  const playerDowned = state.combatants.some((combatant) => combatant.side === 'player' && combatant.downCount > 0 && combatant.hp === 0);
  if (playerDowned) return 'player_downed';
  if (state.combatants.some((combatant) => combatant.downCount > 0 && combatant.hp === 0)) return 'combatant_downed';
  const playerLowHp = state.combatants.some((combatant) => combatant.side === 'player' && combatant.hp > 0 && combatant.hp < 25);
  if (playerLowHp) return 'player_low_hp';
  return undefined;
}

export function chooseCombatAiAction(state: CombatEngineState, actorId: string): CombatAction {
  const actor = state.combatants.find((candidate) => candidate.actorId === actorId);
  if (!actor || !isActive(actor)) throw new Error(`本地 AI 无法操作 ${actorId}。`);
  const actorSnapshot = state.snapshot.combatants.find((candidate) => candidate.actorId === actorId);
  if (!actorSnapshot) throw new Error(`本地 AI 缺少 ${actorId} 的冻结快照。`);
  const allies = state.combatants.filter((candidate) => candidate.side === actor.side);
  const enemies = state.combatants.filter((candidate) => candidate.side !== actor.side && isActive(candidate));

  const rescueTarget = allies
    .filter((candidate) => candidate.hp === 0 && candidate.downCount === 1 && !candidate.revivedOnce)
    .sort((left, right) => left.stableOrder - right.stableOrder)[0];
  if (rescueTarget) return { type: 'stabilize', actorId, targetId: rescueTarget.actorId };

  const usableArts = actorSnapshot.uniqueArtProfiles
    .filter((art) => art.allowAutoUse
      && (art.powerClass === 'light' || art.powerClass === 'standard')
      && (actor.artUsage[art.sourceId] ?? 0) < art.perEncounterLimit
      && actor.stamina >= art.staminaCost)
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const healingArt = usableArts.find((art) => art.purpose === 'healing' || art.purpose === 'protection');
  const woundedAlly = allies
    .filter((candidate) => isActive(candidate) && candidate.hp / candidate.maxHp < 0.6)
    .sort((left, right) => left.hp / left.maxHp - right.hp / right.maxHp || left.stableOrder - right.stableOrder)[0];
  if (healingArt && woundedAlly) {
    const targetIds = healingArt.targetMode === 'self' ? [actorId] : [woundedAlly.actorId];
    return { type: 'unique_art', actorId, artId: healingArt.sourceId, targetIds };
  }

  if ((actor.hp / actor.maxHp < 0.4 || actor.stamina < 20) && !actor.defending) {
    return { type: 'defend', actorId };
  }

  const damageArt = usableArts.find((art) => art.purpose === 'damage' || art.purpose === 'mixed');
  const target = enemies.sort((left, right) => left.hp - right.hp || left.stableOrder - right.stableOrder)[0];
  if (!target) return { type: 'defend', actorId };
  if (damageArt) return { type: 'unique_art', actorId, artId: damageArt.sourceId, targetIds: [target.actorId] };
  return { type: 'normal_attack', actorId, targetId: target.actorId };
}

export function simulateCombatWithLocalAi(
  input: CombatEngineState,
  options: { maxActions: number },
): CombatEngineState {
  let state = input;
  while (state.phase !== 'resolved' && state.actionLog.length < options.maxActions) {
    if (state.phase === 'awaiting_disposition') {
      state = resolveCombatDecision(
        state,
        state.pendingDecision?.kind === 'enemy_surrender'
          ? { choice: 'accept_surrender' }
          : { choice: 'spare' },
      );
      continue;
    }
    if (state.phase !== 'awaiting_action') state = advanceCombatToNextAction(state);
    if (state.phase !== 'awaiting_action' || !state.currentActorId) continue;
    state = executeCombatAction(state, chooseCombatAiAction(state, state.currentActorId));
  }
  if (state.phase !== 'resolved') throw new Error(`本地 AI 在 ${options.maxActions} 次行动内未完成战斗。`);
  return state;
}

export function runAutoCombatUntilPause(
  input: CombatEngineState,
  options: { maxActions: number },
): CombatEngineState {
  let state = input;
  const startingActionCount = state.actionLog.length;
  while (state.phase !== 'resolved' && state.actionLog.length - startingActionCount < options.maxActions) {
    const pauseReason = shouldPauseAutoCombat(state);
    if (pauseReason) return { ...state, phase: 'auto_paused', autoPauseReason: pauseReason };
    if (state.phase !== 'awaiting_action') state = advanceCombatToNextAction(state);
    if (state.phase !== 'awaiting_action' || !state.currentActorId) continue;
    state = executeCombatAction(state, chooseCombatAiAction(state, state.currentActorId));
  }
  if (state.phase === 'resolved') return state;
  return { ...state, phase: 'auto_paused', autoPauseReason: 'action_limit' };
}
