import type { TroopLedgerEntry } from '../types';

export type TroopFatigueBand = NonNullable<TroopLedgerEntry['fatigue']>;

export const TROOP_FATIGUE_PERCENT_BY_BAND: Readonly<Record<TroopFatigueBand, number>> = Object.freeze({
  低: 15,
  中: 35,
  高: 60,
  极高: 85,
});

function clampFatiguePercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function troopFatigueBandFromPercent(value: number): TroopFatigueBand {
  const normalized = clampFatiguePercent(value);
  if (normalized >= 75) return '极高';
  if (normalized >= 50) return '高';
  if (normalized >= 25) return '中';
  return '低';
}

export function troopFatiguePercentFromBand(value: TroopLedgerEntry['fatigue']): number {
  return value ? TROOP_FATIGUE_PERCENT_BY_BAND[value] : TROOP_FATIGUE_PERCENT_BY_BAND.低;
}

/**
 * Resolves the exact value used by War V2. Older ordinary-turn writeback could
 * update only the display band and leave a stale exact value behind. Because a
 * War V2 result always writes both fields together, a mismatch means the band
 * is the newer recoverable fact and should repair the exact value.
 */
export function resolveTroopFatiguePercent(
  source: Pick<TroopLedgerEntry, 'fatigue' | 'warFatiguePercent'>,
): number {
  const exact = Number.isFinite(source.warFatiguePercent)
    ? clampFatiguePercent(source.warFatiguePercent!)
    : undefined;
  if (exact === undefined) return troopFatiguePercentFromBand(source.fatigue);
  if (source.fatigue && troopFatigueBandFromPercent(exact) !== source.fatigue) {
    return troopFatiguePercentFromBand(source.fatigue);
  }
  return exact;
}

export function troopFatigueCombatMultiplier(value: number): number {
  return Math.max(0.35, Math.min(1, 1 - clampFatiguePercent(value) / 150));
}

export function troopFatigueRetreatPenaltyPoints(value: number): number {
  return clampFatiguePercent(value) * 0.15;
}
