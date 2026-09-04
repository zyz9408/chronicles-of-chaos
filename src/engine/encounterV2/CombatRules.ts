import type { CombatArmorWeight, CombatRuntimeCombatant, CombatWeaponWeight } from './CombatTypes';
import type { EncounterScopedCombatant } from './EncounterContracts';

export const COMBAT_GAUGE_THRESHOLD = 1000 as const;
export const COMBAT_STABILIZE_HP_COST = 25 as const;
export const COMBAT_STABILIZE_HP_RESTORE = 25 as const;
export const COMBAT_STABILIZE_STAMINA_RESTORE = 20 as const;
export const ARMOR_REDUCTION_BY_TIER = Object.freeze([0, 0.07, 0.15, 0.24, 0.35, 0.48] as const);
export const SCOPED_NORMAL_ATTACK_DAMAGE_CAP: Readonly<Record<EncounterScopedCombatant['archetype'], number>> = Object.freeze({
  rabble: 14,
  militia: 16,
  regular: 20,
  veteran: 26,
  elite: 32,
});

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

export function normalizeCombatStatuses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
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
    80
      + (input.attackerMartial - input.defenderMartial) * 0.55
      + input.weaponAccuracy
      + input.attackerAccuracy
      - input.defenderEvasion
      + (input.attackerLuck - input.defenderLuck) * 0.1,
    25,
    97,
  );
}

export function calculateV21HitChance(input: {
  attackerMartial: number;
  defenderMartial: number;
  attackerIntelligence: number;
  defenderIntelligence: number;
  weaponAccuracy: number;
  attackerAccuracy: number;
  defenderEvasion: number;
  attackerLuck: number;
  defenderLuck: number;
}): number {
  return clamp(
    80
      + (input.attackerMartial - input.defenderMartial) * 0.60
      + (input.attackerIntelligence - input.defenderIntelligence) * 0.10
      + input.weaponAccuracy
      + input.attackerAccuracy
      - input.defenderEvasion
      + (input.attackerLuck - input.defenderLuck) * 0.1,
    20,
    98,
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
    12
      + (input.defenderMartial - input.attackerMartial) * 0.30
      + input.equipmentBlock
      + input.defenderBlock
      + input.defendActionBonus
      - input.attackerPenetration,
    0,
    75,
  );
}

export function calculateV21BlockChance(input: {
  attackerMartial: number;
  defenderMartial: number;
  attackerIntelligence: number;
  defenderIntelligence: number;
  equipmentBlock: number;
  defenderBlock: number;
  defendActionBonus: number;
  attackerPenetration: number;
}): number {
  return clamp(
    12
      + (input.defenderMartial - input.attackerMartial) * 0.35
      + (input.defenderIntelligence - input.attackerIntelligence) * 0.08
      + input.equipmentBlock
      + input.defenderBlock
      + input.defendActionBonus
      - input.attackerPenetration,
    0,
    75,
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
  maxDamage?: number;
}): number {
  let damage = input.weaponBaseDamage
    + Math.floor(input.attackerMartial * 0.12)
    + input.flatDamage
    + input.randomVariance;
  if (input.critical && !input.blocked) damage *= 1.5;
  if (input.blocked) damage *= input.defenderWasDefending ? 0.2 : 0.4;
  else if (input.defenderWasDefending) damage *= 0.8;
  const armorReduction = ARMOR_REDUCTION_BY_TIER[clamp(Math.trunc(input.armorTier), 0, 5)] ?? 0;
  damage *= 1 - armorReduction;
  return Math.min(input.maxDamage ?? 35, Math.max(1, Math.round(damage)));
}

export function calculateV21NormalAttackDamage(input: {
  weaponBaseDamage: number;
  attackerMartial: number;
  flatDamage: number;
  randomVariance: number;
  critical: boolean;
  blocked: boolean;
  defenderWasDefending: boolean;
  armorTier: number;
  maxDamage?: number;
}): number {
  let damage = input.weaponBaseDamage
    + Math.floor(input.attackerMartial * 0.16)
    + input.flatDamage
    + input.randomVariance;
  if (input.critical && !input.blocked) damage *= 1.5;
  if (input.blocked) damage *= input.defenderWasDefending ? 0.2 : 0.4;
  else if (input.defenderWasDefending) damage *= 0.8;
  const armorReduction = ARMOR_REDUCTION_BY_TIER[clamp(Math.trunc(input.armorTier), 0, 5)] ?? 0;
  damage *= 1 - armorReduction;
  return Math.min(input.maxDamage ?? 35, Math.max(1, Math.round(damage)));
}

export function calculateV21ScopedDamageCap(baseCap: number, martial: number): number {
  const adjustment = clamp(Math.trunc((clamp(martial, 0, 100) - 50) / 5), -10, 10);
  return Math.max(1, baseCap + adjustment);
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

export function canStabilizeAlly(
  actor: Pick<CombatRuntimeCombatant, 'actorId' | 'side' | 'hp'>,
  target: Pick<CombatRuntimeCombatant, 'actorId' | 'side' | 'hp' | 'downCount' | 'revivedOnce'>,
): boolean {
  return actor.actorId !== target.actorId
    && actor.side === target.side
    && actor.hp > COMBAT_STABILIZE_HP_COST
    && target.hp === 0
    && target.downCount === 1
    && !target.revivedOnce;
}
