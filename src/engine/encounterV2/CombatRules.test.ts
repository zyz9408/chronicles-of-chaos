import { describe, expect, it } from 'vitest';
import {
  ARMOR_REDUCTION_BY_TIER,
  SCOPED_NORMAL_ATTACK_DAMAGE_CAP,
  calculateBlockChance,
  calculateCriticalChance,
  calculateDerivedSpeed,
  calculateHitChance,
  calculateNormalAttackDamage,
  calculateV21BlockChance,
  calculateV21HitChance,
  calculateV21NormalAttackDamage,
  calculateV21ScopedDamageCap,
  calculateRetreatChance,
  canStabilizeAlly,
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
    })).toBe(97);
    expect(calculateHitChance({
      attackerMartial: 1, defenderMartial: 100, weaponAccuracy: -50,
      attackerAccuracy: -50, defenderEvasion: 50, attackerLuck: 1, defenderLuck: 100,
    })).toBe(25);
  });

  it('gives Combat V2.1 martial and intelligence separate bounded hit contributions', () => {
    expect(calculateV21HitChance({
      attackerMartial: 80, defenderMartial: 60,
      attackerIntelligence: 70, defenderIntelligence: 50,
      weaponAccuracy: 0, attackerAccuracy: 0, defenderEvasion: 0,
      attackerLuck: 50, defenderLuck: 50,
    })).toBe(94);
    expect(calculateV21HitChance({
      attackerMartial: 0, defenderMartial: 100,
      attackerIntelligence: 0, defenderIntelligence: 100,
      weaponAccuracy: -50, attackerAccuracy: -50, defenderEvasion: 50,
      attackerLuck: 0, defenderLuck: 100,
    })).toBe(20);
  });

  it('gives Combat V2.1 intelligence a defensive read and lets martial raise scoped damage caps', () => {
    expect(calculateV21BlockChance({
      attackerMartial: 70, defenderMartial: 70,
      attackerIntelligence: 50, defenderIntelligence: 75,
      equipmentBlock: 0, defenderBlock: 0, defendActionBonus: 0, attackerPenetration: 0,
    })).toBe(14);
    expect(calculateV21NormalAttackDamage({
      weaponBaseDamage: 20, attackerMartial: 80, flatDamage: 0, randomVariance: 1,
      critical: false, blocked: true, defenderWasDefending: false, armorTier: 0,
    })).toBe(13);
    expect(calculateV21ScopedDamageCap(SCOPED_NORMAL_ATTACK_DAMAGE_CAP.rabble, 100)).toBe(24);
    expect(calculateV21ScopedDamageCap(SCOPED_NORMAL_ATTACK_DAMAGE_CAP.elite, 0)).toBe(22);
  });

  it('calculates block and critical boundaries exactly', () => {
    expect(calculateBlockChance({
      attackerMartial: 50, defenderMartial: 80, equipmentBlock: 20,
      defenderBlock: 10, defendActionBonus: 30, attackerPenetration: 0,
    })).toBe(75);
    expect(calculateBlockChance({
      attackerMartial: 100, defenderMartial: 1, equipmentBlock: 0,
      defenderBlock: -20, defendActionBonus: 0, attackerPenetration: 20,
    })).toBe(0);
    expect(calculateCriticalChance(100, 1, 99)).toBe(20);
    expect(calculateCriticalChance(1, 100, -99)).toBe(2);
  });

  it('locks armor tiers and normal-attack damage cap, block and defend reductions', () => {
    expect(ARMOR_REDUCTION_BY_TIER).toEqual([0, 0.07, 0.15, 0.24, 0.35, 0.48]);
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
    })).toBe(24);
    expect(calculateNormalAttackDamage({
      weaponBaseDamage: 6, attackerMartial: 35, flatDamage: 0, randomVariance: 0,
      critical: false, blocked: false, defenderWasDefending: false, armorTier: 5,
    })).toBe(5);
    expect(SCOPED_NORMAL_ATTACK_DAMAGE_CAP).toEqual({
      rabble: 14,
      militia: 16,
      regular: 20,
      veteran: 26,
      elite: 32,
    });
    expect(calculateNormalAttackDamage({
      weaponBaseDamage: 30, attackerMartial: 100, flatDamage: 20, randomVariance: 2,
      critical: true, blocked: false, defenderWasDefending: false, armorTier: 0,
      maxDamage: SCOPED_NORMAL_ATTACK_DAMAGE_CAP.rabble,
    })).toBe(14);
  });

  it('locks the deterministic retreat formula to 20—90 percent', () => {
    expect(calculateRetreatChance({ ownAverageSpeed: 120, enemyAverageSpeed: 100, ownDowned: 1, modifier: 5 })).toBe(60);
    expect(calculateRetreatChance({ ownAverageSpeed: 20, enemyAverageSpeed: 200, ownDowned: 3, modifier: -99 })).toBe(20);
    expect(calculateRetreatChance({ ownAverageSpeed: 200, enemyAverageSpeed: 20, ownDowned: 0, modifier: 99 })).toBe(90);
  });

  it('requires a living ally with more than the 25 HP stabilization cost', () => {
    const target = { actorId: 'commander', side: 'enemy' as const, hp: 0, downCount: 1, revivedOnce: false };
    expect(canStabilizeAlly({ actorId: 'retainer', side: 'enemy', hp: 26 }, target)).toBe(true);
    expect(canStabilizeAlly({ actorId: 'retainer', side: 'enemy', hp: 25 }, target)).toBe(false);
    expect(canStabilizeAlly({ actorId: 'retainer', side: 'enemy', hp: 1 }, target)).toBe(false);
    expect(canStabilizeAlly({ actorId: 'outsider', side: 'player', hp: 100 }, target)).toBe(false);
    expect(canStabilizeAlly(
      { actorId: 'retainer', side: 'enemy', hp: 100 },
      { ...target, downCount: 2 },
    )).toBe(false);
  });
});
