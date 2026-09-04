import { describe, expect, it } from 'vitest';
import type { RuntimeState, TroopLedgerEntry } from '../types';
import { applyDeterministicTroopFatigueRecovery } from './TroopFatigueRecovery';

function troop(overrides: Partial<TroopLedgerEntry> = {}): TroopLedgerEntry {
  return {
    troopId: 'troop_player', name: '亲兵', detailLevel: 'operational', size: 100,
    morale: 70, training: 60, supplies: 80, task: '休整', relationToPlayer: 'self',
    fatigue: '高', warFatiguePercent: 60, activityTempo: 'resting', lifecycleStatus: 'active',
    locationId: 'place_camp', movementStatus: 'none', ...overrides,
  };
}

function state(currentDate: string, troops: TroopLedgerEntry[]): RuntimeState {
  return {
    currentDate, player: { id: 'player', name: '刘兴' }, factions: [], troops,
  } as unknown as RuntimeState;
}

describe('applyDeterministicTroopFatigueRecovery', () => {
  it('recovers eight exact fatigue points per full day of eligible rest', () => {
    const previous = state('公元184年04月20日 08:00', [troop()]);
    const next = state('公元184年04月21日 08:00', [troop()]);
    const result = applyDeterministicTroopFatigueRecovery(next, { previousState: previous });
    expect(result.elapsedMinutes).toBe(1440);
    expect(result.adjustments[0]).toMatchObject({ previousFatigue: 60, nextFatigue: 52, recoveredPoints: 8 });
    expect(result.state.troops?.[0]).toMatchObject({ fatigue: '高', warFatiguePercent: 52, lastDeterministicFatigueRecoveryAt: next.currentDate });
  });

  it('requires at least eight hours and floors proportional recovery', () => {
    const previous = state('公元184年04月20日 08:00', [troop()]);
    const short = state('公元184年04月20日 15:59', [troop()]);
    expect(applyDeterministicTroopFatigueRecovery(short, { previousState: previous }).adjustments).toEqual([]);
    const eightHours = state('公元184年04月20日 16:00', [troop()]);
    expect(applyDeterministicTroopFatigueRecovery(eightHours, { previousState: previous }).adjustments[0].recoveredPoints).toBe(2);
  });

  it('excludes moving, undersupplied, non-resting, enemy and war participant troops', () => {
    const previous = state('公元184年04月20日 08:00', []);
    const next = state('公元184年04月21日 08:00', [
      troop({ troopId: 'moving', movementStatus: 'marching' }),
      troop({ troopId: 'hungry', supplies: 39 }),
      troop({ troopId: 'training', activityTempo: 'training' }),
      troop({ troopId: 'enemy', relationToPlayer: '敌军' }),
      troop({ troopId: 'war' }),
    ]);
    const result = applyDeterministicTroopFatigueRecovery(next, { previousState: previous, warParticipantTroopIds: ['war'] });
    expect(result.adjustments).toEqual([]);
  });
});
