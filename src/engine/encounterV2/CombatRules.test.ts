import { describe, expect, it } from 'vitest';
import {
  ARMOR_REDUCTION_BY_TIER,
  calculateBlockChance,
  calculateCriticalChance,
  calculateDerivedSpeed,
  calculateHitChance,
  calculateNormalAttackDamage,
  calculateRetreatChance,
} from './CombatRules';

describe('CombatRules', () => {
  it('locks speed adjustments and the 60—160 clamp', () => {
    expect(calculateDerivedSpeed({ weaponWeight: 'light', armorWeight: 'light', equipmentSpeed: 10 })).toBe(121);
    expect(calculateDerivedSpeed({ weaponWeight: 'heavy', armorWeight: 'heavy', equipmentSpeed: -99 })).toBe(60);
    expect(calculateDerivedSpeed({ weaponWeight: 'unarmed', armorWeight: 'none', equipmentSpeed: 999 })).toBe(160);
  });

  it('calculates and clamps hit chance exactly', () => {
    expect(calculateHitChance({
      attackerMartial: 80, defenderMartial: 60, weaponAccuracy: 5,
      attackerAccuracy: 3, defenderEvasion: 4, attackerLuck: 70, defenderLuck: 50,
    })).toBe(95);
    expect(calculateHitChance({
      attackerMartial: 1, defenderMartial: 100, weaponAccuracy: -50,
      attackerAccuracy: -50, defenderEvasion: 50, attackerLuck: 1, defenderLuck: 100,
    })).toBe(45);
  });

  it('calculates block and critical boundaries exactly', () => {
    expect(calculateBlockChance({
      attackerMartial: 50, defenderMartial: 80, equipmentBlock: 20,
      defenderBlock: 10, defendActionBonus: 30, attackerPenetration: 0,
    })).toBe(65);
    expect(calculateBlockChance({
      attackerMartial: 100, defenderMartial: 1, equipmentBlock: 0,
      defenderBlock: -20, defendActionBonus: 0, attackerPenetration: 20,
    })).toBe(0);
    expect(calculateCriticalChance(100, 1, 99)).toBe(20);
    expect(calculateCriticalChance(1, 100, -99)).toBe(2);
  });

  it('locks armor tiers and normal-attack damage cap, block and defend reductions', () => {
    expect(ARMOR_REDUCTION_BY_TIER).toEqual([0, 0.05, 0.10, 0.16, 0.22, 0.30]);
    expect(calculateNormalAttackDamage({
      weaponBaseDamage: 30, attackerMartial: 100, flatDamage: 20, randomVariance: 2,
      critical: true, blocked: false, defenderWasDefending: false, armorTier: 0,
    })).toBe(35);
    expect(calculateNormalAttackDamage({
      weaponBaseDamage: 20, attackerMartial: 80, flatDamage: 0, randomVariance: 1,
      critical: false, blocked: true, defenderWasDefending: false, armorTier: 0,
    })).toBe(12);
    expect(calculateNormalAttackDamage({
      weaponBaseDamage: 20, attackerMartial: 80, flatDamage: 0, randomVariance: 1,
      critical: false, blocked: true, defenderWasDefending: true, armorTier: 0,
    })).toBe(6);
    expect(calculateNormalAttackDamage({
      weaponBaseDamage: 20, attackerMartial: 80, flatDamage: 0, randomVariance: 1,
      critical: false, blocked: false, defenderWasDefending: true, armorTier: 0,
    })).toBe(23);
  });

  it('locks the deterministic retreat formula to 20—90 percent', () => {
    expect(calculateRetreatChance({ ownAverageSpeed: 120, enemyAverageSpeed: 100, ownDowned: 1, modifier: 5 })).toBe(60);
    expect(calculateRetreatChance({ ownAverageSpeed: 20, enemyAverageSpeed: 200, ownDowned: 3, modifier: -99 })).toBe(20);
    expect(calculateRetreatChance({ ownAverageSpeed: 200, enemyAverageSpeed: 20, ownDowned: 0, modifier: 99 })).toBe(90);
  });
});
