// ============================================================
// Engine Core Types - Actor
// ============================================================

import type { NpcAwarenessReference } from './luanshi';
import type { RelationshipTargetKind } from './statePatch';

export type CharacterTraitSource = 'opening' | 'history' | 'event' | 'training' | 'injury' | 'custom';
export type CharacterTraitRarity = 'white' | 'green' | 'blue' | 'red' | 'gold';
export type CharacterUniqueArtRarity = CharacterTraitRarity;
export type CharacterUniqueArtDomain =
  | 'personalCombat'
  | 'warfare'
  | 'strategy'
  | 'social'
  | 'governance'
  | 'survival'
  | 'craft'
  | 'other';

export interface CharacterCheckHook {
  scope: string;
  modifier?: number;
  note: string;
}

export interface CharacterTrait {
  id: string;
  label: string;
  description: string;
  source: CharacterTraitSource | string;
  rarity?: CharacterTraitRarity | string;
  promptHint?: string;
  checkHooks?: CharacterCheckHook[];
}

export interface CharacterUniqueArt {
  id: string;
  name: string;
  rarity: CharacterUniqueArtRarity | string;
  domain: CharacterUniqueArtDomain | string;
  level: number;
  maxLevel?: number;
  progress?: number;
  description: string;
  effectSummary: string;
  source: CharacterTraitSource | string;
  acquiredAt?: string;
  upgradedAt?: string;
  promptHint?: string;
  checkHooks?: CharacterCheckHook[];
  tags?: string[];
  relatedNpcIds?: string[];
  relatedFactionIds?: string[];
}

export type CharacterEffectType = 'buff' | 'debuff' | 'mixed';
export type CharacterEffectDuration = 'short' | 'long' | 'until_resolved';

export interface CharacterEffect {
  id: string;
  label: string;
  type: CharacterEffectType;
  duration: CharacterEffectDuration;
  description: string;
  source: string;
  promptHint?: string;
  checkHooks?: CharacterCheckHook[];
}

export interface CharacterVitals {
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
}

export type EquipmentSlot = 'weapon' | 'armor' | 'mount' | 'treasure';
export type EquipmentQuality = string;

export interface CharacterEquipmentItem {
  id: string;
  slot: EquipmentSlot;
  name: string;
  quality: EquipmentQuality;
  description: string;
  condition?: string;
  statBonuses?: Record<string, number>;
  promptHint?: string;
  checkHooks?: CharacterCheckHook[];
  unlocks?: string[];
  risks?: string[];
}

export type InventoryItemCategory =
  | 'equipment'
  | 'document'
  | 'token'
  | 'consumable'
  | 'supply'
  | 'material'
  | 'misc'
  | string;

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  description?: string;
  category?: InventoryItemCategory;
  quality?: EquipmentQuality;
  equipSlot?: EquipmentSlot;
  condition?: string;
  statBonuses?: Record<string, number>;
  promptHint?: string;
  checkHooks?: CharacterCheckHook[];
  unlocks?: string[];
  risks?: string[];
  keyItem?: boolean;
  updatedAt?: string;
}

export interface ReputationTag {
  label: string;
  source: string;
}

export interface CharacterReputation {
  morality: number;
  fame: number;
  tags: ReputationTag[];
  summary: string;
}

export interface PlayerDeed {
  id: string;
  date: string;
  locationId?: string;
  summary: string;
  impact?: string;
}

export interface PlayerMemory {
  summary: string;
  keyDeeds: PlayerDeed[];
  recentTurns: string[];
}

export interface FactionAssetAccess {
  factionId?: string;
  factionName?: string;
  label: string;
  accessLevel: 'none' | 'request' | 'limited' | 'manager' | 'full';
  summary: string;
}

/** 角色/人物 */
export interface Actor {
  id: string;
  name: string;
  courtesyName?: string;
  artName?: string;
  aliases?: string[];
  commonAddress?: string;
  sex?: '男' | '女' | '其他';
  age?: number;
  roleType: string;          // 对应 Ontology 中的 actorRoleTypes
  factionId?: string;
  factionName?: string;
  locationId?: string;
  socialClass?: string;      // 对应 Ontology 中的 socialClasses
  birthOrigin?: string;
  birthOriginDescription?: string;
  currentIdentity?: string;
  currentIdentityDescription?: string;
  allegianceTarget?: string;
  officeTitle?: string;
  militaryTitle?: string;
  nobleTitle?: string;
  identitySummary?: string;
  appearance?: string;
  personality?: string;
  abilityScores?: Record<string, number>;
  level?: number;
  xp?: number;
  growthPoints?: number;
  vitals?: CharacterVitals;
  combatStatuses?: string[];
  traits?: CharacterTrait[];
  uniqueArts?: CharacterUniqueArt[];
  effects?: CharacterEffect[];
  equipment?: CharacterEquipmentItem[];
  inventory?: InventoryItem[];
  personalMoney?: number;
  reputation?: CharacterReputation;
  playerMemory?: PlayerMemory;
  factionAssetAccess?: FactionAssetAccess;
  summary: string;
  relationshipWithPlayer?: string;
  situationSummary?: string;
  openingExtraRequest?: string;
  customNotes?: string;
}

/** 人际关系 */
export interface Relationship {
  id: string;
  actorId: string;
  targetId: string;          // 可以是 actorId 或 factionId
  targetKind?: RelationshipTargetKind;
  targetType: RelationshipTargetKind;
  type: string;              // 对应 Ontology 中的 relationshipTypes
  value: number;             // -100 到 100
  description: string;
}

/** 传闻 */
export type RumorSignalType = 'rumor' | 'clue' | 'report' | 'omen';
export type RumorConfidence = 'low' | 'medium' | 'high';
export type RumorStatus = 'open' | 'investigating' | 'verified' | 'false' | 'expired' | 'converted' | 'archived';

export interface Rumor {
  id: string;
  title?: string;
  content: string;
  source: string;
  status?: RumorStatus;
  signalType?: RumorSignalType;
  confidence?: RumorConfidence;
  potentialOutcomeSummary?: string;
  consequenceTags?: string[];
  affectedNpcIds?: string[];
  affectedFactionIds?: string[];
  affectedPlaceIds?: string[];
  affectedForceIds?: string[];
  affectedHoldingIds?: string[];
  followUpHooks?: string[];
  severity?: QuestConsequenceSeverity;
  relatedLocationIds?: string[];
  relatedRegionId?: string;
  relatedFactionId?: string;
  relatedActorId?: string;
  npcAwarenessRefs?: NpcAwarenessReference[];
  threadId?: string;
  expiresAt?: string;
  archiveReason?: string;
  archivedAt?: string;
  convertedToQuestIds?: string[];
  convertedToWorldTrendIds?: string[];
  verified: boolean;
  createdAt: string;         // 游戏内日期
}

export type QuestStatus = 'active' | 'completed' | 'failed' | 'invalidated' | 'archived';
export type QuestPriority = 'low' | 'medium' | 'high';
export type QuestConsequenceSeverity = 'minor' | 'moderate' | 'major' | 'critical';

/** 当前事项：玩家承诺、牵挂、风险和可行动线索。 */
export interface Quest {
  id: string;
  title: string;
  description: string;
  status: QuestStatus;
  giverId?: string;          // 委托人 actorId
  targetLocationId?: string;
  source?: string;
  currentStep?: string;
  stakes?: string;
  deadlineAt?: string;
  priority?: QuestPriority;
  relatedNpcIds?: string[];
  relatedLocationIds?: string[];
  relatedFactionIds?: string[];
  outcomeSummary?: string;
  consequenceTags?: string[];
  affectedNpcIds?: string[];
  affectedFactionIds?: string[];
  affectedPlaceIds?: string[];
  affectedForceIds?: string[];
  affectedHoldingIds?: string[];
  followUpHooks?: string[];
  severity?: QuestConsequenceSeverity;
  threadId?: string;
  archiveReason?: string;
  archivedAt?: string;
  completionExperienceAwarded?: number;
  createdAt: string;
  updatedAt: string;
}
