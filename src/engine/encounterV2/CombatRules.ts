import type { CombatArmorWeight, CombatWeaponWeight } from './CombatTypes';

export const COMBAT_GAUGE_THRESHOLD = 1000 as const;
export const ARMOR_REDUCTION_BY_TIER = Object.freeze([0, 0.05, 0.10, 0.16, 0.22, 0.30] as const);

const WEAPON_SPEED: Record<CombatWeaponWeight, number> = {
  unarmed: 5,
  light: 8,
  standard: 0,
  polearm: -4,
  heavy: -10,
  ranged: -3,
};

const ARMOR_SPEED: Record<CombatArmorWeight, number> = {
  none: 5,
  light: 3,
  medium: 0,
  heavy: -10,
};

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calculateDerivedSpeed(input: {
  weaponWeight: CombatWeaponWeight;
  armorWeight: CombatArmorWeight;
  equipmentSpeed: number;
  traitSpeed?: number;
}): number {
  return clamp(
    100 + WEAPON_SPEED[input.weaponWeight] + ARMOR_SPEED[input.armorWeight]
      + input.equipmentSpeed + (input.traitSpeed ?? 0),
    60,
    160,
  );
}

export function calculateHitChance(input: {
  attackerMartial: number;
  defenderMartial: number;
  weaponAccuracy: number;
  attackerAccuracy: number;
  defenderEvasion: number;
  attackerLuck: number;
  defenderLuck: number;
}): number {
  return clamp(
    82
      + (input.attackerMartial - input.defenderMartial) * 0.35
      + input.weaponAccuracy
      + input.attackerAccuracy
      - input.defenderEvasion
      + (input.attackerLuck - input.defenderLuck) * 0.1,
    45,
    96,
  );
}

export function calculateBlockChance(input: {
  attackerMartial: number;
  defenderMartial: number;
  equipmentBlock: number;
  defenderBlock: number;
  defendActionBonus: number;
  attackerPenetration: number;
}): number {
  return clamp(
    10
      + (input.defenderMartial - input.attackerMartial) * 0.15
      + input.equipmentBlock
      + input.defenderBlock
      + input.defendActionBonus
      - input.attackerPenetration,
    0,
    65,
  );
}

export function calculateCriticalChance(attackerLuck: number, defenderLuck: number, modifier = 0): number {
  return clamp(5 + (attackerLuck - defenderLuck) * 0.1 + modifier, 2, 20);
}

export function calculateNormalAttackDamage(input: {
  weaponBaseDamage: number;
  attackerMartial: number;
  flatDamage: number;
  randomVariance: number;
  critical: boolean;
  blocked: boolean;
  defenderWasDefending: boolean;
  armorTier: number;
}): number {
  let damage = input.weaponBaseDamage
    + Math.floor(input.attackerMartial * 0.10)
    + input.flatDamage
    + input.randomVariance;
  if (input.critical && !input.blocked) damage *= 1.5;
  if (input.blocked) damage *= input.defenderWasDefending ? 0.2 : 0.4;
  else if (input.defenderWasDefending) damage *= 0.8;
  const armorReduction = ARMOR_REDUCTION_BY_TIER[clamp(Math.trunc(input.armorTier), 0, 5)] ?? 0;
  damage *= 1 - armorReduction;
  return Math.min(35, Math.max(1, Math.round(damage)));
}

export function calculateRetreatChance(input: {
  ownAverageSpeed: number;
  enemyAverageSpeed: number;
  ownDowned: number;
  modifier: number;
}): number {
  return clamp(
    55 + (input.ownAverageSpeed - input.enemyAverageSpeed) * 0.5 - input.ownDowned * 10 + input.modifier,
    20,
    90,
  );
}
