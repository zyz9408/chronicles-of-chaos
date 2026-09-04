import type { CharacterUniqueArt, RuntimeState } from '../types';
import { augmentUniqueArtProjectionWithAuthoredRules } from '../abilities/AbilityRuleEngine';
import { normalizeUniqueArtRarity } from '../character/NpcUniqueArtPolicy';
import {
  SEMANTIC_PROJECTION_VERSION,
  type EncounterRulesetScope,
  type SemanticEffect,
  type SemanticEffectOperation,
  type SemanticEffectTarget,
  type SemanticEffectTrigger,
  type SemanticProjection,
  type UniqueArtPowerClass,
  type UniqueArtSemanticProfile,
} from './EncounterContracts';

const UNIQUE_ART_RARITY_RANK: Readonly<Record<string, number>> = Object.freeze({
  white: 0,
  green: 1,
  blue: 2,
  purple: 3,
  orange: 4,
  red: 5,
});

const UNIQUE_ART_POWER_RULES: Readonly<Record<UniqueArtPowerClass, {
  powerMultiplier: number;
  staminaCost: number;
}>> = Object.freeze({
  light: { powerMultiplier: 1.10, staminaCost: 8 },
  standard: { powerMultiplier: 1.35, staminaCost: 14 },
  heavy: { powerMultiplier: 1.65, staminaCost: 22 },
  ultimate: { powerMultiplier: 2.00, staminaCost: 32 },
});

const PERSONAL_ART_DAMAGE_FLOOR: Readonly<Record<UniqueArtPowerClass, number>> = Object.freeze({
  light: 1.20,
  standard: 1.60,
  heavy: 2.35,
  ultimate: 3.20,
});

const AGGRESSIVE_WAR_ART_CLASS_EFFECT_SCALE: Readonly<Record<UniqueArtPowerClass, number>> = Object.freeze({
  light: 3.50,
  standard: 8.50,
  heavy: 9.00,
  ultimate: 14.00,
});

const ENHANCED_WAR_ART_CLASS_EFFECT_SCALE: Readonly<Record<UniqueArtPowerClass, number>> = Object.freeze({
  light: 4.50,
  standard: 10.50,
  heavy: 13.50,
  ultimate: 20.00,
});

const UNIQUE_ART_POWER_CLASS_RANK: Readonly<Record<UniqueArtPowerClass, number>> = Object.freeze({
  light: 0,
  standard: 1,
  heavy: 2,
  ultimate: 3,
});

const PERSONAL_ART_ACCURACY_FLOOR: Readonly<Record<UniqueArtPowerClass, number>> = Object.freeze({
  light: 2,
  standard: 5,
  heavy: 8,
  ultimate: 12,
});

const CONTINUOUS_EFFECT_OPERATIONS = new Set<SemanticEffectOperation>([
  'modify_accuracy',
  'modify_evasion',
  'modify_block',
  'modify_critical',
  'modify_damage_flat',
  'modify_damage_multiplier',
  'modify_armor',
  'modify_armor_penetration',
  'modify_speed',
  'modify_stamina_cost',
  'restore_hp',
  'restore_stamina',
  'modify_retreat',
  'modify_surrender',
  'modify_capture',
  'modify_morale',
  'modify_supply',
  'modify_fatigue',
  'modify_casualty_rate',
  'modify_effective_strength',
]);

const WAR_EFFECT_OPERATIONS = new Set<SemanticEffectOperation>([
  'modify_morale',
  'modify_supply',
  'modify_fatigue',
  'modify_casualty_rate',
  'modify_effective_strength',
  'apply_status',
  'remove_status',
]);

const WAR_EFFECT_TRIGGERS = new Set<SemanticEffectTrigger>([
  'war_round_start',
  'before_war_resolution',
  'after_war_resolution',
]);

const WAR_EFFECT_TARGETS = new Set<SemanticEffectTarget>([
  'own_force',
  'enemy_force',
]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits = 2): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function artRarityRank(art: Pick<CharacterUniqueArt, 'rarity'>): number {
  return UNIQUE_ART_RARITY_RANK[normalizeUniqueArtRarity(art.rarity)] ?? 0;
}

function artLevel(art: Pick<CharacterUniqueArt, 'level' | 'maxLevel'>): number {
  const maximum = Number.isInteger(art.maxLevel)
    ? clamp(Math.trunc(art.maxLevel!), 1, 10)
    : 10;
  return clamp(Number.isInteger(art.level) ? Math.trunc(art.level) : 1, 1, maximum);
}

function compatibilityPowerClass(
  art: Pick<CharacterUniqueArt, 'rarity'>,
): UniqueArtPowerClass {
  const rarityRank = artRarityRank(art);
  if (rarityRank >= 5) return 'ultimate';
  if (rarityRank >= 4) return 'heavy';
  if (rarityRank >= 2) return 'standard';
  return 'light';
}

function warPowerClass(
  art: Pick<CharacterUniqueArt, 'rarity'>,
): UniqueArtPowerClass {
  const rarityRank = artRarityRank(art);
  if (rarityRank >= 4) return 'ultimate';
  if (rarityRank >= 3) return 'heavy';
  if (rarityRank >= 2) return 'standard';
  return 'light';
}

function strongestPowerClass(
  stored: UniqueArtPowerClass,
  rarityFloor: UniqueArtPowerClass,
): UniqueArtPowerClass {
  return UNIQUE_ART_POWER_CLASS_RANK[stored] >= UNIQUE_ART_POWER_CLASS_RANK[rarityFloor]
    ? stored
    : rarityFloor;
}

function baseCompatibilityFields(
  art: Pick<CharacterUniqueArt, 'id' | 'rarity'>,
): Pick<
  UniqueArtSemanticProfile,
  | 'projectionVersion'
  | 'sourceId'
  | 'profileKind'
  | 'sourceType'
  | 'status'
  | 'activation'
  | 'powerClass'
  | 'powerMultiplier'
  | 'staminaCost'
  | 'perEncounterLimit'
  | 'blockable'
  | 'armorPiercing'
  | 'canCrit'
  | 'allowAutoUse'
> {
  const powerClass = compatibilityPowerClass(art);
  const powerRules = UNIQUE_ART_POWER_RULES;
  return {
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    sourceId: art.id,
    profileKind: 'ability',
    sourceType: 'unique_art',
    status: 'executable',
    activation: 'active',
    powerClass,
    powerMultiplier: powerRules[powerClass].powerMultiplier,
    staminaCost: powerRules[powerClass].staminaCost,
    perEncounterLimit: 1,
    blockable: powerClass !== 'ultimate',
    armorPiercing: false,
    canCrit: true,
    allowAutoUse: powerClass === 'light' || powerClass === 'standard',
  };
}

export function createCompatibilityPersonalCombatArtProjection(
  art: Pick<CharacterUniqueArt, 'id' | 'rarity'>,
): UniqueArtSemanticProfile {
  return {
    ...baseCompatibilityFields(art),
    rulesetScopes: ['personal_combat'],
    targetMode: 'single_enemy',
    purpose: 'damage',
    accuracyModifier: 0,
    maxHits: 1,
    effects: [{
      trigger: 'before_attack',
      condition: 'always',
      operation: 'modify_accuracy',
      target: 'self',
      value: 2 + artRarityRank(art),
      priority: 20,
      perEncounterLimit: 1,
    }],
  };
}

export function createCompatibilityWarArtProjection(
  art: Pick<CharacterUniqueArt, 'id' | 'rarity'>,
): UniqueArtSemanticProfile {
  return {
    ...baseCompatibilityFields(art),
    rulesetScopes: ['war'],
    targetMode: 'all_allies',
    purpose: 'mixed',
    accuracyModifier: 0,
    maxHits: 1,
    blockable: false,
    armorPiercing: false,
    canCrit: false,
    allowAutoUse: false,
    effects: [{
      trigger: 'before_war_resolution',
      condition: 'always',
      operation: 'modify_effective_strength',
      target: 'own_force',
      value: 6 + artRarityRank(art),
      priority: 40,
      perEncounterLimit: 1,
    }],
  };
}

function isUniqueArtProjection(profile: SemanticProjection | undefined): profile is UniqueArtSemanticProfile {
  return Boolean(
    profile
      && profile.profileKind === 'ability'
      && profile.sourceType === 'unique_art',
  );
}

function hasExecutableScope(
  profile: SemanticProjection | undefined,
  scope: EncounterRulesetScope,
): profile is UniqueArtSemanticProfile {
  if (!(isUniqueArtProjection(profile)
    && profile.status === 'executable'
    && profile.rulesetScopes.includes(scope)
    && profile.effects.length > 0)) return false;
  if (scope !== 'war') return true;
  return profile.effects.some((effect) => WAR_EFFECT_OPERATIONS.has(effect.operation)
    && WAR_EFFECT_TRIGGERS.has(effect.trigger)
    && WAR_EFFECT_TARGETS.has(effect.target));
}

function mergeCompatibilityScope(
  existing: SemanticProjection | undefined,
  compatibility: UniqueArtSemanticProfile,
  scope: EncounterRulesetScope,
): UniqueArtSemanticProfile {
  if (!isUniqueArtProjection(existing) || existing.status === 'narrative_only') {
    return compatibility;
  }
  return {
    ...clone(existing),
    status: 'executable',
    rulesetScopes: existing.rulesetScopes.includes(scope)
      ? [...existing.rulesetScopes]
      : [...existing.rulesetScopes, scope],
    effects: [...clone(existing.effects), ...clone(compatibility.effects)],
  };
}

export function ensureUniqueArtCompatibilityProfiles(
  profiles: Map<string, SemanticProjection>,
  arts: readonly CharacterUniqueArt[],
): boolean {
  let changed = false;
  for (const art of arts) {
    const existing = profiles.get(art.id);
    if (art.domain === 'personalCombat' && !hasExecutableScope(existing, 'personal_combat')) {
      profiles.set(
        art.id,
        mergeCompatibilityScope(existing, createCompatibilityPersonalCombatArtProjection(art), 'personal_combat'),
      );
      changed = true;
      continue;
    }
    if (art.domain === 'warfare' && !hasExecutableScope(existing, 'war')) {
      profiles.set(
        art.id,
        mergeCompatibilityScope(existing, createCompatibilityWarArtProjection(art), 'war'),
      );
      changed = true;
    }
  }
  return changed;
}

function collectStableUniqueArts(state: RuntimeState): CharacterUniqueArt[] {
  const byId = new Map<string, CharacterUniqueArt>();
  const collect = (arts: readonly CharacterUniqueArt[] | undefined) => {
    for (const art of arts ?? []) {
      const id = art.id?.trim();
      if (id && !byId.has(id)) byId.set(id, clone(art));
    }
  };
  collect(state.player.uniqueArts);
  for (const npc of state.npcs ?? []) collect(npc.uniqueArts);
  for (const actor of state.knownActors ?? []) collect(actor.uniqueArts);
  return [...byId.values()];
}

/**
 * Old saves and incomplete provider responses may contain a combat-capable art
 * without an executable semantic projection. Materialize one bounded profile
 * from structured domain/rarity fields and persist it in the existing ledger.
 * No name, description, or narrative text is interpreted here.
 */
export function ensureStableUniqueArtProjections(state: RuntimeState): RuntimeState {
  // A legacy pre-encounter checkpoint may have been hashed before compatibility
  // profiles existed. Do not mutate its ledger during save migration; the
  // snapshot adapters can still materialize the bounded profile transiently,
  // and persistence resumes after the encounter leaves the active slot.
  if (state.encounterV2?.active?.checkpoint.checkpointKind === 'pre_encounter') return state;
  const existingProfiles = state.encounterV2?.semanticProjections ?? [];
  const bySourceId = new Map(existingProfiles.map((profile) => [profile.sourceId, clone(profile)]));
  const changed = ensureUniqueArtCompatibilityProfiles(bySourceId, collectStableUniqueArts(state));

  if (!changed) return state;
  return {
    ...clone(state),
    encounterV2: {
      semanticProjections: [...bySourceId.values()],
      appliedResultHashes: [...(state.encounterV2?.appliedResultHashes ?? [])],
      narratedResultHashes: [...(state.encounterV2?.narratedResultHashes ?? [])],
      ...(state.encounterV2?.active ? { active: clone(state.encounterV2.active) } : {}),
      ...(state.encounterV2?.pendingOffer ? { pendingOffer: clone(state.encounterV2.pendingOffer) } : {}),
    },
  };
}

function masteryFactor(art: Pick<CharacterUniqueArt, 'level' | 'maxLevel' | 'rarity'>): number {
  const levelBonus = (artLevel(art) - 1) * 0.035;
  const rarityBonus = artRarityRank(art) * 0.015;
  return clamp(1 + levelBonus + rarityBonus, 1, 1.40);
}

function warMasteryFactor(art: Pick<CharacterUniqueArt, 'level' | 'maxLevel'>): number {
  return clamp(1 + (artLevel(art) - 1) * 0.07, 1, 1.63);
}

function scaleEffect(effect: SemanticEffect, factor: number): SemanticEffect {
  if (!CONTINUOUS_EFFECT_OPERATIONS.has(effect.operation)) return clone(effect);
  return {
    ...clone(effect),
    value: round(effect.value * factor),
  };
}

/**
 * Compile a frozen encounter value from a stable semantic profile. The stored
 * profile remains unchanged; level/rarity only affect the per-encounter copy.
 */
export function materializeLevelledUniqueArtProjection(
  art: Pick<CharacterUniqueArt, 'id' | 'level' | 'maxLevel' | 'rarity'>,
  profile: UniqueArtSemanticProfile,
  scope: EncounterRulesetScope,
  options?: { aggressiveWarScaling?: boolean; enhancedWarScaling?: boolean },
): UniqueArtSemanticProfile {
  if (profile.sourceId !== art.id || !profile.rulesetScopes.includes(scope)) return clone(profile);
  const level = artLevel(art);
  const factor = masteryFactor(art);
  const useAggressiveWarScaling = scope === 'war' && options?.aggressiveWarScaling === true;
  const aggressivePowerClass = warPowerClass(art);
  const personalPowerClass = strongestPowerClass(profile.powerClass, compatibilityPowerClass(art));
  const personalPowerFloor = PERSONAL_ART_DAMAGE_FLOOR[personalPowerClass];
  const warPowerRule = UNIQUE_ART_POWER_RULES[aggressivePowerClass];
  const warEffectScale = options?.enhancedWarScaling
    ? ENHANCED_WAR_ART_CLASS_EFFECT_SCALE
    : AGGRESSIVE_WAR_ART_CLASS_EFFECT_SCALE;
  const warEffectFactor = warEffectScale[aggressivePowerClass] * warMasteryFactor(art);
  const staminaDiscount = Math.min(0.14, (level - 1) * 0.015);
  const accuracyBonus = Math.floor((level - 1) / 2) + Math.floor(artRarityRank(art) / 2);

  const materialized: UniqueArtSemanticProfile = {
    ...clone(profile),
    powerClass: useAggressiveWarScaling
      ? aggressivePowerClass
      : scope === 'personal_combat' ? personalPowerClass : profile.powerClass,
    powerMultiplier: scope === 'personal_combat'
      ? round(clamp(Math.max(profile.powerMultiplier, personalPowerFloor) * factor, 1, 4.50))
      : useAggressiveWarScaling
        ? round(clamp(warPowerRule.powerMultiplier * warMasteryFactor(art), 1, 5.00))
        : profile.powerMultiplier,
    staminaCost: Math.max(4, Math.round(profile.staminaCost * (1 - staminaDiscount))),
    accuracyModifier: scope === 'personal_combat'
      ? clamp(Math.max(profile.accuracyModifier, PERSONAL_ART_ACCURACY_FLOOR[personalPowerClass]) + accuracyBonus, -20, 20)
      : clamp(profile.accuracyModifier + accuracyBonus, -20, 20),
    blockable: scope === 'personal_combat' && personalPowerClass === 'ultimate'
      ? false
      : profile.blockable,
    armorPiercing: scope === 'personal_combat'
      ? profile.armorPiercing || personalPowerClass === 'heavy' || personalPowerClass === 'ultimate'
      : profile.armorPiercing,
    effects: profile.effects.map((effect) => scaleEffect(
      effect,
      useAggressiveWarScaling ? warEffectFactor : factor,
    )),
  };
  return augmentUniqueArtProjectionWithAuthoredRules(art as CharacterUniqueArt, materialized);
}
