import {
  COMBAT_RULESET_VERSION,
  ENCOUNTER_CONTRACT_VERSION,
  SEMANTIC_PROJECTION_VERSION,
  type EquipmentSemanticProfile,
  type ItemCombatProfile,
  type PersonalCombatStartIntent,
  type TraitSemanticProfile,
  type UniqueArtSemanticProfile,
} from './EncounterContracts';
import type { CombatCharacterSource, CombatProjectionBundle } from './CombatTypes';

export function makeCombatIntent(
  playerIds: string[] = ['player_liuping'],
  enemyIds: string[] = ['npc_enemy_guard'],
): PersonalCombatStartIntent {
  return {
    contractVersion: ENCOUNTER_CONTRACT_VERSION,
    encounterId: 'encounter_combat_batch1',
    kind: 'personal_combat',
    rulesetVersion: COMBAT_RULESET_VERSION,
    sourceTurnNumber: 29,
    locationId: 'location_hanshui_camp',
    reason: 'Batch 1 deterministic combat fixture.',
    seed: 'combat-batch1-seed',
    createdAt: '2026-07-20T00:00:00.000Z',
    playerParty: { actorIds: playerIds },
    enemyParty: { actorIds: enemyIds },
    partySelection: 'locked',
    policy: {
      lethality: 'standard',
      allowRetreat: true,
      allowSurrender: true,
      allowCapture: true,
      lootPolicy: 'actual_items_only',
    },
  };
}

export function makeCombatantSource(
  actorId: string,
  overrides: Partial<CombatCharacterSource> = {},
): CombatCharacterSource {
  return {
    id: actorId,
    name: actorId,
    level: 3,
    xp: 20,
    abilityScores: { 武力: 70, 机运: 50 },
    vitals: { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 },
    traits: [],
    uniqueArts: [],
    equipment: [],
    inventory: [],
    ...overrides,
  };
}

export function makeNpcCombatantSource(
  npcId: string,
  overrides: Partial<CombatCharacterSource> = {},
): CombatCharacterSource {
  const source = makeCombatantSource(npcId, overrides);
  delete source.id;
  source.npcId = npcId;
  return source;
}

export function makeTraitProfile(sourceId: string, value = 5): TraitSemanticProfile {
  return {
    profileKind: 'ability',
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    sourceId,
    sourceType: 'trait',
    status: 'executable',
    rulesetScopes: ['personal_combat'],
    activation: 'passive',
    effects: [{
      trigger: 'before_attack',
      condition: 'always',
      operation: 'modify_accuracy',
      target: 'self',
      value,
      priority: 10,
    }],
  };
}

export function makeWeaponProfile(
  sourceId: string,
  overrides: Partial<EquipmentSemanticProfile> = {},
): EquipmentSemanticProfile {
  return {
    profileKind: 'equipment',
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    sourceId,
    status: 'executable',
    rulesetScopes: ['personal_combat'],
    equipmentSlot: 'weapon',
    qualityTier: 'blue',
    weaponWeight: 'standard',
    weaponBaseDamage: 12,
    accuracyBonus: 4,
    armorPenetration: 2,
    blockBonus: 0,
    armorTier: 0,
    speedModifier: 0,
    effects: [],
    ...overrides,
  };
}

export function makeArmorProfile(
  sourceId: string,
  overrides: Partial<EquipmentSemanticProfile> = {},
): EquipmentSemanticProfile {
  return {
    profileKind: 'equipment',
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    sourceId,
    status: 'executable',
    rulesetScopes: ['personal_combat'],
    equipmentSlot: 'armor',
    qualityTier: 'blue',
    armorWeight: 'medium',
    weaponBaseDamage: 0,
    accuracyBonus: 0,
    armorPenetration: 0,
    blockBonus: 5,
    armorTier: 3,
    speedModifier: 0,
    effects: [],
    ...overrides,
  };
}

export function makeDamageArtProfile(
  sourceId: string,
  overrides: Partial<UniqueArtSemanticProfile> = {},
): UniqueArtSemanticProfile {
  return {
    profileKind: 'ability',
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    sourceId,
    sourceType: 'unique_art',
    status: 'executable',
    rulesetScopes: ['personal_combat'],
    activation: 'active',
    targetMode: 'single_enemy',
    purpose: 'damage',
    powerClass: 'standard',
    powerMultiplier: 1.35,
    staminaCost: 14,
    accuracyModifier: 5,
    maxHits: 3,
    perEncounterLimit: 2,
    blockable: true,
    armorPiercing: false,
    canCrit: true,
    allowAutoUse: true,
    effects: [{
      trigger: 'before_attack',
      condition: 'always',
      operation: 'modify_damage_multiplier',
      target: 'single_enemy',
      value: 1.35,
      priority: 40,
    }],
    ...overrides,
  };
}

export function makeHealingItemProfile(sourceId: string): ItemCombatProfile {
  return {
    profileKind: 'item',
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    sourceId,
    status: 'executable',
    rulesetScopes: ['personal_combat'],
    combatUse: true,
    qualityTier: 'green',
    consumable: true,
    quantityPerUse: 1,
    perEncounterLimit: 2,
    allowAutoUse: false,
    effects: [{
      trigger: 'before_action',
      condition: 'always',
      operation: 'restore_hp',
      target: 'self',
      value: 20,
      priority: 20,
    }],
  };
}

export function bundle(...profiles: CombatProjectionBundle['profiles']): CombatProjectionBundle {
  return { profiles };
}
