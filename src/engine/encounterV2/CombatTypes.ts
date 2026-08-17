import type {
  EncounterActionLogEntry,
  EncounterOutcome,
  EncounterScopedCombatant,
  EncounterSide,
  EquipmentSemanticProfile,
  ItemCombatProfile,
  ItemQualityTier,
  PersonalCombatStartIntent,
  SemanticProjection,
  TraitSemanticProfile,
  UniqueArtSemanticProfile,
} from './EncounterContracts';
import type { EncounterRandomSnapshot } from './EncounterDeterminism';
import type {
  CharacterEquipmentItem,
  CharacterTrait,
  CharacterUniqueArt,
  CharacterVitals,
  InventoryItem,
} from '../types/actor';
import type { GameDifficultyLevel } from '../types/runtimeState';

export type CombatThreatTier = 'minor' | 'standard' | 'major' | 'deadly';
export type CombatWeaponWeight = 'unarmed' | 'light' | 'standard' | 'polearm' | 'heavy' | 'ranged';
export type CombatArmorWeight = 'none' | 'light' | 'medium' | 'heavy';

/** Structural adapter input shared by Actor and LuanShiNpc. */
export interface CombatCharacterSource {
  id?: string;
  npcId?: string;
  name: string;
  level?: number;
  xp?: number;
  abilityScores?: Record<string, number>;
  vitals?: CharacterVitals;
  /** Persistent statuses already present before this encounter begins. */
  combatStatuses?: string[];
  traits?: CharacterTrait[];
  uniqueArts?: CharacterUniqueArt[];
  equipment?: CharacterEquipmentItem[];
  inventory?: InventoryItem[];
  persistent?: boolean;
  combatArchetype?: EncounterScopedCombatant['archetype'];
}

export interface CombatProjectionBundle {
  profiles: SemanticProjection[];
}

export interface CombatWeaponSnapshot {
  sourceId: string | null;
  qualityTier: ItemQualityTier | null;
  weight: CombatWeaponWeight;
  baseDamage: number;
  accuracyBonus: number;
  armorPenetration: number;
}

export interface CombatArmorSnapshot {
  sourceId: string | null;
  qualityTier: ItemQualityTier | null;
  weight: CombatArmorWeight;
  armorTier: 0 | 1 | 2 | 3 | 4 | 5;
  blockBonus: number;
}

export interface CombatInventorySnapshot {
  itemId: string;
  quantity: number;
}

export interface CombatantSnapshot {
  actorId: string;
  name: string;
  side: EncounterSide;
  stableOrder: number;
  persistent: boolean;
  combatArchetype?: EncounterScopedCombatant['archetype'];
  level: number;
  xp: number;
  martial: number;
  luck: number;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  /** Frozen persistent-status baseline used by the result transaction. */
  combatStatuses?: string[];
  speed: number;
  weapon: CombatWeaponSnapshot;
  armor: CombatArmorSnapshot;
  traitProfiles: TraitSemanticProfile[];
  uniqueArtProfiles: UniqueArtSemanticProfile[];
  equipmentProfiles: EquipmentSemanticProfile[];
  itemProfiles: ItemCombatProfile[];
  inventory: CombatInventorySnapshot[];
  equipmentItemIds: string[];
}

export interface CombatEncounterSnapshot {
  snapshotVersion: 1 | 2;
  snapshotHash: string;
  sessionId: string;
  intent: PersonalCombatStartIntent;
  seed: string;
  threatTier: CombatThreatTier;
  /** Frozen per-save combat difficulty. Legacy snapshots default to standard. */
  combatDifficulty?: GameDifficultyLevel;
  combatants: CombatantSnapshot[];
  lootableItemIds: string[];
  capturableEquipmentItemIds: string[];
}

export type CombatPhase =
  | 'advancing'
  | 'awaiting_action'
  | 'awaiting_disposition'
  | 'auto_paused'
  | 'resolved';

export type CombatAutoPauseReason =
  | 'player_low_hp'
  | 'player_downed'
  | 'combatant_downed'
  | 'decision_required'
  | 'action_limit';

export interface CombatRuntimeCombatant {
  actorId: string;
  side: EncounterSide;
  stableOrder: number;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  speed: number;
  gauge: number;
  defending: boolean;
  downCount: number;
  revivedOnce: boolean;
  statuses: string[];
  artUsage: Record<string, number>;
  itemUsage: Record<string, number>;
  itemQuantities: Record<string, number>;
  modifiers: {
    accuracy: number;
    evasion: number;
    block: number;
    critical: number;
    damageFlat: number;
    damageMultiplier: number;
    armor: number;
    armorPenetration: number;
    staminaCost: number;
    retreat: number;
  };
}

export interface CombatPendingDecision {
  kind: 'fatal_disposition' | 'enemy_surrender';
  targetSide: EncounterSide;
  targetActorIds: string[];
}

export interface CombatEngineState {
  snapshot: CombatEncounterSnapshot;
  phase: CombatPhase;
  currentActorId?: string;
  pendingDecision?: CombatPendingDecision;
  outcome?: EncounterOutcome;
  combatants: CombatRuntimeCombatant[];
  randomState: EncounterRandomSnapshot;
  actionLog: EncounterActionLogEntry[];
  autoPauseReason?: CombatAutoPauseReason;
}

export type CombatAction =
  | { type: 'normal_attack'; actorId: string; targetId: string }
  | { type: 'defend'; actorId: string }
  | { type: 'unique_art'; actorId: string; artId: string; targetIds: string[] }
  | { type: 'use_item'; actorId: string; itemId: string; targetIds: string[] }
  | { type: 'stabilize'; actorId: string; targetId: string }
  | { type: 'retreat'; actorId: string }
  | { type: 'surrender'; actorId: string };

export type CombatDecision =
  | { choice: 'spare' }
  | { choice: 'capture' }
  | { choice: 'kill' }
  | { choice: 'accept_surrender' }
  | { choice: 'reject_surrender' };
