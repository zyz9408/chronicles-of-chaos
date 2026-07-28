import { executeWarRound } from './WarEngine';
import type {
  WarAutoPauseReason,
  WarEngineState,
  WarRoundOrder,
} from './WarTypes';
import type { EncounterSide } from './EncounterContracts';

function activeForces(state: WarEngineState, side: EncounterSide) {
  return state.forces.filter((force) => force.side === side
    && force.lifecycleStatus === 'active'
    && force.remainingStrength > 0);
}

function weightedAverage(
  state: WarEngineState,
  side: EncounterSide,
  selector: (force: WarEngineState['forces'][number]) => number,
): number {
  const forces = activeForces(state, side);
  const total = forces.reduce((sum, force) => sum + force.remainingStrength, 0);
  if (total <= 0) return 0;
  return forces.reduce((sum, force) => sum + selector(force) * force.remainingStrength, 0) / total;
}

export function shouldPauseAutoWar(
  state: WarEngineState,
  side: EncounterSide,
): WarAutoPauseReason | undefined {
  if (state.phase === 'awaiting_decision') return 'decision_required';
  if (state.snapshot.intent.policy.lethality === 'fatal') return 'fatal_risk';
  if (state.forces.some((force) => force.lifecycleStatus === 'routed')) return 'force_routed';
  if (weightedAverage(state, side, (force) => force.morale) < 25) return 'low_morale';
  if (weightedAverage(state, side, (force) => force.supply) < 25) return 'low_supply';
  if (state.round >= 10) return 'round_limit';
  return undefined;
}

export function chooseWarAiOrder(state: WarEngineState, side: EncounterSide): WarRoundOrder {
  if (state.phase !== 'awaiting_round') throw new Error('本地战争 AI 只在等待轮次时选择普通战术。');
  const forces = activeForces(state, side);
  if (forces.length === 0) throw new Error(`${side} 已无可指挥部队。`);
  const snapshots = new Map(state.snapshot.forces.map((force) => [force.troopId, force] as const));
  const morale = weightedAverage(state, side, (force) => force.morale);
  const supply = weightedAverage(state, side, (force) => force.supply);
  if (morale < 40 || supply < 40) return { type: 'tactic', tactic: 'hold_position' };
  const totalStrength = forces.reduce((sum, force) => sum + force.remainingStrength, 0);
  const taggedShare = (tag: string, primaryClass?: string) => forces.reduce((sum, force) => {
    const snapshot = snapshots.get(force.troopId);
    if (!snapshot) return sum;
    return snapshot.tags.includes(tag as never) || snapshot.primaryClass === primaryClass
      ? sum + force.remainingStrength
      : sum;
  }, 0) / Math.max(1, totalStrength);
  const defensiveShare = taggedShare('defensive');
  if (state.snapshot.environmentTags.includes('fortified') && defensiveShare >= 0.35) {
    return { type: 'tactic', tactic: 'hold_position' };
  }
  const mobileShare = taggedShare('mobile', state.snapshot.environmentTags.includes('water') ? 'naval' : 'cavalry');
  if ((state.snapshot.environmentTags.includes('open') || state.snapshot.environmentTags.includes('water'))
    && mobileShare >= 0.35) {
    return { type: 'tactic', tactic: 'flank' };
  }
  if (morale >= 70 && supply >= 60 && taggedShare('assault') >= 0.35) {
    return { type: 'tactic', tactic: 'all_out_assault' };
  }
  return { type: 'tactic', tactic: 'steady_advance' };
}

export function runAutoWarUntilPause(
  input: WarEngineState,
  options: { maxRounds: number },
): WarEngineState {
  if (input.phase === 'awaiting_decision') {
    return { ...input, autoPauseReason: 'decision_required' };
  }
  if (input.phase === 'resolved' || input.phase === 'auto_paused') return input;
  let state = input;
  const startingRound = state.round;
  while (state.phase === 'awaiting_round' && state.round - startingRound < options.maxRounds) {
    const playerPause = shouldPauseAutoWar(state, 'player');
    const enemyPause = shouldPauseAutoWar(state, 'enemy');
    const pauseReason = playerPause ?? enemyPause;
    if (pauseReason) return { ...state, phase: 'auto_paused', autoPauseReason: pauseReason };
    state = executeWarRound(state, {
      player: chooseWarAiOrder(state, 'player'),
      enemy: chooseWarAiOrder(state, 'enemy'),
    });
    if (state.phase === 'resolved') return state;
    const afterPause = shouldPauseAutoWar(state, 'player') ?? shouldPauseAutoWar(state, 'enemy');
    if (afterPause) return { ...state, phase: 'auto_paused', autoPauseReason: afterPause };
  }
  if (state.phase === 'resolved') return state;
  return { ...state, phase: 'auto_paused', autoPauseReason: 'round_limit' };
}
