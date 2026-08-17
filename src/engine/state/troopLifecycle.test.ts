import { describe, expect, it } from 'vitest';
import type { TroopLedgerEntry } from '../types';
import {
  isCurrentTroopLedgerEntry,
  isTerminalTroopLedgerEntry,
  normalizeCurrentTroopReferenceIds,
} from './troopLifecycle';

function troop(
  troopId: string,
  lifecycleStatus: TroopLedgerEntry['lifecycleStatus'],
): Pick<TroopLedgerEntry, 'troopId' | 'lifecycleStatus' | 'mergedIntoTroopId' | 'childTroopIds'> {
  return { troopId, lifecycleStatus };
}

describe('troopLifecycle', () => {
  it('archives routed and destroyed formations instead of projecting them as current troops', () => {
    expect(isCurrentTroopLedgerEntry(troop('troop_active', 'active'))).toBe(true);
    expect(isCurrentTroopLedgerEntry(troop('troop_unknown', 'unknown'))).toBe(true);
    expect(isCurrentTroopLedgerEntry(troop('troop_routed', 'routed'))).toBe(false);
    expect(isTerminalTroopLedgerEntry(troop('troop_destroyed', 'destroyed'))).toBe(true);
  });

  it('removes defeated formations from current faction and garrison references', () => {
    const troops = [
      troop('troop_active', 'active'),
      troop('troop_routed', 'routed'),
      troop('troop_destroyed', 'destroyed'),
    ];

    expect(normalizeCurrentTroopReferenceIds(
      ['troop_active', 'troop_routed', 'troop_destroyed'],
      troops,
    )).toEqual(['troop_active']);
  });
});
