import { describe, expect, it } from 'vitest';
import {
  resolveTroopFatiguePercent,
  troopFatigueBandFromPercent,
  troopFatigueCombatMultiplier,
  troopFatiguePercentFromBand,
  troopFatigueRetreatPenaltyPoints,
} from './TroopFatigue';

describe('TroopFatigue', () => {
  it('uses one canonical mapping for fatigue bands and exact values', () => {
    expect(troopFatiguePercentFromBand('低')).toBe(15);
    expect(troopFatiguePercentFromBand('中')).toBe(35);
    expect(troopFatiguePercentFromBand('高')).toBe(60);
    expect(troopFatiguePercentFromBand('极高')).toBe(85);
    expect(troopFatigueBandFromPercent(24)).toBe('低');
    expect(troopFatigueBandFromPercent(25)).toBe('中');
    expect(troopFatigueBandFromPercent(50)).toBe('高');
    expect(troopFatigueBandFromPercent(75)).toBe('极高');
  });

  it('repairs an old stale exact value when the newer display band disagrees', () => {
    expect(resolveTroopFatiguePercent({ fatigue: '低', warFatiguePercent: 85 })).toBe(15);
    expect(resolveTroopFatiguePercent({ fatigue: '高', warFatiguePercent: 62 })).toBe(62);
  });

  it('keeps the combat and retreat effects aligned with War V2 formulas', () => {
    expect(troopFatigueCombatMultiplier(60)).toBeCloseTo(0.6, 6);
    expect(troopFatigueCombatMultiplier(100)).toBe(0.35);
    expect(troopFatigueRetreatPenaltyPoints(60)).toBe(9);
  });
});
