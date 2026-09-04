import type { RuntimeState, TroopLedgerEntry } from '../types';
import { tryCreateGameClockFromDateLabel, type GameClock } from '../time/gameClock';
import { isCurrentTroopLedgerEntry } from '../state/troopLifecycle';
import { resolveTroopFatiguePercent, troopFatigueBandFromPercent } from './TroopFatigue';

export const TROOP_FATIGUE_RECOVERY_MINIMUM_MINUTES = 480;
export const TROOP_FATIGUE_RECOVERY_POINTS_PER_DAY = 8;
export const TROOP_FATIGUE_RECOVERY_MINIMUM_SUPPLIES = 40;

export interface TroopFatigueRecoveryAdjustment {
  troopId: string;
  previousFatigue: number;
  nextFatigue: number;
  recoveredPoints: number;
  elapsedMinutes: number;
}

export function applyDeterministicTroopFatigueRecovery(
  state: RuntimeState,
  options: { previousState: RuntimeState; warParticipantTroopIds?: readonly string[] },
): { state: RuntimeState; adjustments: TroopFatigueRecoveryAdjustment[]; elapsedMinutes: number } {
  const elapsedMinutes = elapsedGameMinutes(options.previousState, state);
  if (elapsedMinutes < TROOP_FATIGUE_RECOVERY_MINIMUM_MINUTES) {
    return { state, adjustments: [], elapsedMinutes };
  }
  const recoveryPoints = Math.floor((elapsedMinutes * TROOP_FATIGUE_RECOVERY_POINTS_PER_DAY) / 1440);
  if (recoveryPoints <= 0) return { state, adjustments: [], elapsedMinutes };
  const warParticipants = new Set(options.warParticipantTroopIds ?? []);
  const adjustments: TroopFatigueRecoveryAdjustment[] = [];
  const troops = (state.troops ?? []).map((troop) => {
    if (!isEligibleForRecovery(state, troop, warParticipants)
      || troop.lastDeterministicFatigueRecoveryAt === state.currentDate) return troop;
    const previousFatigue = resolveTroopFatiguePercent(troop);
    const nextFatigue = Math.max(0, previousFatigue - recoveryPoints);
    if (nextFatigue === previousFatigue) return troop;
    adjustments.push({
      troopId: troop.troopId, previousFatigue, nextFatigue,
      recoveredPoints: previousFatigue - nextFatigue, elapsedMinutes,
    });
    return {
      ...troop,
      warFatiguePercent: nextFatigue,
      fatigue: troopFatigueBandFromPercent(nextFatigue),
      lastDeterministicFatigueRecoveryAt: state.currentDate,
    };
  });
  return adjustments.length > 0
    ? { state: { ...state, troops }, adjustments, elapsedMinutes }
    : { state, adjustments, elapsedMinutes };
}

function isEligibleForRecovery(
  state: RuntimeState,
  troop: TroopLedgerEntry,
  warParticipants: Set<string>,
): boolean {
  if (troop.detailLevel === 'intelligence'
    || (troop.detailLevel === undefined && troop.lifecycleStatus === 'unknown')
    || !isCurrentTroopLedgerEntry(troop)
    || troop.lifecycleStatus !== 'active'
    || troop.activityTempo !== 'resting'
    || (troop.movementStatus && !['none', 'arrived', 'cancelled'].includes(troop.movementStatus))
    || !troop.locationId
    || warParticipants.has(troop.troopId)
    || typeof troop.supplies !== 'number'
    || !Number.isFinite(troop.supplies)
    || troop.supplies < TROOP_FATIGUE_RECOVERY_MINIMUM_SUPPLIES) return false;
  return isPlayerControlled(state, troop);
}

function isPlayerControlled(state: RuntimeState, troop: TroopLedgerEntry): boolean {
  if (troop.leaderNpcId === 'player' || troop.leaderNpcId === state.player.id
    || troop.factionId?.startsWith('faction_player')) return true;
  const faction = troop.factionId
    ? (state.factions ?? []).find((entry) => entry.factionId === troop.factionId)
    : undefined;
  if (faction && [state.player.id, state.player.name, 'player', '主角'].includes(faction.actualController ?? '')) return true;
  return new Set([
    'self', 'own', 'owned', 'controlled', 'subordinate', 'friendly', 'allied',
    '你直接统领', '自势力相关', '友军', '盟友',
  ]).has(troop.relationToPlayer.trim());
}

function elapsedGameMinutes(previousState: RuntimeState, nextState: RuntimeState): number {
  const previous = previousState.currentTime ?? tryCreateGameClockFromDateLabel(previousState.currentDate);
  const next = nextState.currentTime ?? tryCreateGameClockFromDateLabel(nextState.currentDate);
  if (!previous || !next) return 0;
  return Math.max(0, clockMinutes(next) - clockMinutes(previous));
}

function clockMinutes(clock: GameClock): number {
  return (((clock.year * 12 + (clock.month - 1)) * 30 + (clock.day - 1)) * 24 + clock.hour) * 60 + clock.minute;
}
