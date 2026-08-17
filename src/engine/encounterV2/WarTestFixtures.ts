import type { CharacterTrait, CharacterUniqueArt } from '../types/actor';
import type { TroopLedgerEntry } from '../types/luanshi';
import {
  ENCOUNTER_CONTRACT_VERSION,
  SEMANTIC_PROJECTION_VERSION,
  WAR_RULESET_VERSION,
  type TraitSemanticProfile,
  type TroopSemanticProfile,
  type UniqueArtSemanticProfile,
  type WarStartIntent,
} from './EncounterContracts';
import type { WarCommanderSource } from './WarTypes';

export function makeWarIntent(
  playerTroopIds: string[] = ['troop_player_infantry'],
  enemyTroopIds: string[] = ['troop_enemy_cavalry'],
  committedStrengths: {
    player?: number[];
    enemy?: number[];
    commandScope?: 'overall_command' | 'subordinate_sector' | 'independent';
  } = {},
): WarStartIntent {
  return {
    contractVersion: ENCOUNTER_CONTRACT_VERSION,
    encounterId: 'encounter_war_batch3',
    kind: 'war',
    rulesetVersion: WAR_RULESET_VERSION,
    sourceTurnNumber: 30,
    locationId: 'location_xinye_field',
    reason: 'Batch 3 deterministic war fixture.',
    seed: 'war-batch3-seed',
    createdAt: '2026-07-20T03:00:00.000Z',
    playerForce: {
      troopIds: playerTroopIds,
      commanderActorId: 'player_liuping',
    },
    enemyForce: {
      troopIds: enemyTroopIds,
      commanderActorId: 'npc_enemy_commander',
    },
    participation: {
      commandScope: committedStrengths.commandScope ?? 'independent',
      mission: 'defeat_local_force',
      playerCommitments: playerTroopIds.map((troopId, index) => ({
        troopId,
        committedStrength: committedStrengths.player?.[index] ?? 1_000,
      })),
      enemyCommitments: enemyTroopIds.map((troopId, index) => ({
        troopId,
        committedStrength: committedStrengths.enemy?.[index] ?? 1_000,
      })),
    },
    objective: 'defeat_enemy',
    environmentTags: ['open'],
    policy: {
      lethality: 'standard',
      allowRetreat: true,
      allowSurrender: true,
      allowCapture: true,
      lootPolicy: 'none',
    },
  };
}

export function makeWarTroop(
  troopId: string,
  overrides: Partial<TroopLedgerEntry> = {},
): TroopLedgerEntry {
  return {
    troopId,
    name: troopId,
    size: 1_000,
    troopType: '不得从此字段猜兵种',
    quality: '中',
    fatigue: '低',
    readiness: '中',
    lifecycleStatus: 'active',
    morale: 60,
    training: 60,
    supplies: 70,
    task: '迎战',
    relationToPlayer: '参战方',
    ...overrides,
  };
}

function makeTrait(id: string): CharacterTrait {
  return {
    id,
    label: id,
    description: id,
    source: 'event',
  };
}

function makeUniqueArt(id: string): CharacterUniqueArt {
  return {
    id,
    name: id,
    rarity: 'blue',
    domain: 'warfare',
    level: 1,
    description: id,
    effectSummary: id,
    source: 'event',
  };
}

export function makeWarCommander(
  actorId: string,
  overrides: Partial<WarCommanderSource> = {},
): WarCommanderSource {
  return {
    id: actorId,
    name: actorId,
    abilityScores: {
      统率: 70,
      智力: 60,
      武力: 55,
      魅力: 50,
      政治: 45,
    },
    traits: [makeTrait(`${actorId}_trait_stable_command`)],
    uniqueArts: [makeUniqueArt(`${actorId}_art_decisive_order`)],
    ...overrides,
  };
}

export function makeTroopProfile(
  sourceId: string,
  primaryClass: TroopSemanticProfile['primaryClass'] = 'infantry',
  tags: TroopSemanticProfile['tags'] = [],
  composition?: TroopSemanticProfile['composition'],
): TroopSemanticProfile {
  return {
    profileKind: 'troop',
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    sourceId,
    status: 'executable',
    rulesetScopes: ['war'],
    primaryClass,
    tags,
    ...(composition ? { composition } : {}),
    effects: [],
  };
}

export function makeWarTraitProfile(sourceId: string): TraitSemanticProfile {
  return {
    profileKind: 'ability',
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    sourceId,
    sourceType: 'trait',
    status: 'executable',
    rulesetScopes: ['war'],
    activation: 'passive',
    effects: [{
      trigger: 'war_round_start',
      condition: 'low_morale',
      operation: 'modify_morale',
      target: 'own_force',
      value: 4,
      priority: 20,
    }],
  };
}

export function makeWarArtProfile(sourceId: string): UniqueArtSemanticProfile {
  return {
    profileKind: 'ability',
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    sourceId,
    sourceType: 'unique_art',
    status: 'executable',
    rulesetScopes: ['war'],
    activation: 'active',
    targetMode: 'all_allies',
    purpose: 'mixed',
    powerClass: 'standard',
    powerMultiplier: 1.35,
    staminaCost: 14,
    accuracyModifier: 0,
    maxHits: 1,
    perEncounterLimit: 1,
    blockable: false,
    armorPiercing: false,
    canCrit: false,
    allowAutoUse: false,
    effects: [{
      trigger: 'before_war_resolution',
      condition: 'always',
      operation: 'modify_effective_strength',
      target: 'own_force',
      value: 20,
      priority: 50,
      perEncounterLimit: 1,
    }],
  };
}
