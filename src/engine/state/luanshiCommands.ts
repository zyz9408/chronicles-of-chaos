import type {
  CalendarEraEntry,
  BondThreadEntry,
  CharacterEffect,
  CharacterEquipmentItem,
  CharacterReputation,
  CharacterTrait,
  CharacterUniqueArt,
  CharacterUniqueArtDomain,
  CharacterTraitRarity,
  CharacterVitals,
  CombatRecord,
  ConflictRecord,
  DomesticReportEntry,
  EquipmentSlot,
  FactionLedgerEntry,
  HeroineThreadEntry,
  HoldingLedgerEntry,
  HoldingSiegePreparation,
  HoldingSiegeStatus,
  HoldingSupplyLineStatus,
  InventoryItem,
  LuanShiNpcAdultPrivateProfile,
  LuanShiNpc,
  LuanShiNpcRelationshipNetworkEntry,
  LuanShiNpcWombProfile,
  NpcMemorySource,
  PrivateAssetEntry,
  PrivateAssetProjectDelta,
  PrivateAssetProjectEntry,
  ResourceLedger,
  RuntimeState,
  TroopLedgerEntry,
  TurnEventRecord,
} from '../types';
import { claimsReservedSystemDomesticReportIdentity } from '../domesticReports';
import {
  validateHoldingCivilAdministrationFields,
} from '../holdings/HoldingCivilAdministration';
import { ensureLuanShiState } from './createInitialRuntimeState';
import { deriveNpcCurrentAge, isAdultFemaleNpcAt } from '../time/npcAge';
import { looksLikeEngineeringFactionType, normalizeFactionType } from './factionTypeNormalization';
import {
  EQUIPMENT_SLOTS,
  validateCheckHooks,
  validateEquipmentItem,
  validateEquipmentItemAtPath,
  validateInventoryItem,
  validateInventoryItemAtPath,
} from '../character/loadoutProtocol';
import { isProtagonistNpcClone, PROTAGONIST_NPC_REJECTION_MESSAGE } from './playerNpcBoundary';
import { findHeroineThreadByIdentity } from './HeroineThreadIdentity';
import { isNpcPhysicallyPresent } from './npcPresence';

export interface CharacterIdentityUpdateFields {
  name?: string | null;
  courtesyName?: string | null;
  artName?: string | null;
  aliases?: string[] | null;
  commonAddress?: string | null;
  birthOrigin?: string | null;
  birthOriginDescription?: string | null;
  currentIdentity?: string | null;
  currentIdentityDescription?: string | null;
  factionId?: string | null;
  factionName?: string | null;
  allegianceTarget?: string | null;
  officeTitle?: string | null;
  militaryTitle?: string | null;
  nobleTitle?: string | null;
  identitySummary?: string | null;
  appearance?: string | null;
  personality?: string | null;
}

export type CharacterIdentityUpdateCommand = CharacterIdentityUpdateFields & {
  action: 'updateCharacterIdentity';
  characterId?: string;
  characterName?: string;
  characterType?: 'player' | 'npc';
};

export type PlayerInventoryChange =
  | { action: 'upsert'; item: InventoryItem }
  | { action: 'remove'; itemId: string; quantity?: number }
  | { action: 'setQuantity'; itemId: string; quantity: number };

export type PlayerEquipmentChange =
  | { action: 'equipFromInventory'; itemId: string; slot?: EquipmentSlot; treasureIndex?: number }
  | { action: 'upsert'; item: CharacterEquipmentItem; treasureIndex?: number }
  | { action: 'remove'; equipmentId: string }
  | { action: 'unequip'; equipmentId: string };

export interface PlayerLoadoutUpdateCommand {
  action: 'updatePlayerLoadout';
  characterId?: string;
  characterName?: string;
  personalMoney?: number;
  personalMoneyDelta?: number;
  equipment?: CharacterEquipmentItem[];
  equipmentChanges?: PlayerEquipmentChange[];
  inventory?: InventoryItem[];
  inventoryChanges?: PlayerInventoryChange[];
  summary?: string;
}

export type NpcInventoryChange = PlayerInventoryChange;

export type NpcEquipmentChange =
  | { action: 'upsert'; item: CharacterEquipmentItem; treasureIndex?: number }
  | { action: 'remove'; equipmentId: string }
  | { action: 'unequip'; equipmentId: string };

export interface NpcLoadoutUpdateCommand {
  action: 'updateNpcLoadout';
  npcId: string;
  npcName: string;
  equipment?: CharacterEquipmentItem[];
  equipmentChanges?: NpcEquipmentChange[];
  inventory?: InventoryItem[];
  inventoryChanges?: NpcInventoryChange[];
  summary?: string;
  updatedAt?: string;
  source?: string;
}

export interface PlayerTraitsUpdateCommand {
  action: 'updatePlayerTraits';
  characterId?: string;
  characterName?: string;
  traits: CharacterTrait[];
  summary?: string;
}

export interface CharacterUniqueArtsUpdateCommand {
  action: 'updateCharacterUniqueArts';
  characterType: 'player' | 'npc';
  characterId?: string;
  characterName?: string;
  uniqueArts: CharacterUniqueArt[];
  summary?: string;
  updatedAt?: string;
  source?: string;
}

export type ResourceLedgerUpdateCommand = Partial<ResourceLedger> & {
  action: 'updateResourceLedger';
  playerResources?: Record<string, number>;
  summary?: string;
};

export type FactionLedgerUpsertCommand = FactionLedgerEntry & {
  action: 'upsertFactionLedger';
};

export type TroopScoreInput = TroopLedgerEntry['morale'] | string;

export type TroopLedgerUpsertCommand = {
  action: 'upsertTroopLedger';
  troopId: string;
} & Partial<Omit<TroopLedgerEntry, 'troopId' | 'morale' | 'training'>> & {
  morale?: TroopScoreInput;
  training?: TroopScoreInput;
};

export type ConflictRecordUpsertCommand = Omit<ConflictRecord, 'summary'> & {
  action: 'upsertConflictRecord';
  summary?: string;
};

export type CombatRecordUpsertCommand = CombatRecord & {
  action: 'upsertCombatRecord';
};

export type CalendarEraUpsertCommand = CalendarEraEntry & {
  action: 'upsertCalendarEra';
};

export interface HeroineThreadUpsertCommand {
  action: 'upsertHeroineThread';
  heroineThreadId: string;
  npcId?: string;
  npcName?: string;
  status?: HeroineThreadEntry['status'];
  stage?: string;
  relationshipRole?: string;
  summary?: string;
  currentPull?: string | null;
  riskNotes?: string | null;
  promiseNotes?: string | null;
  recentProgress?: string | null;
  tags?: HeroineThreadEntry['tags'] | null;
  milestones?: HeroineThreadEntry['milestones'] | null;
  lastUpdatedAt?: string;
  source?: string | null;
}

export interface BondThreadUpsertCommand {
  action: 'upsertBondThread';
  bondThreadId: string;
  targetNpcIds?: BondThreadEntry['targetNpcIds'] | null;
  targetNames?: string[] | string;
  bondType?: BondThreadEntry['bondType'];
  status?: BondThreadEntry['status'];
  summary?: string;
  currentTension?: string | null;
  promiseNotes?: string | null;
  conflictNotes?: string | null;
  recentProgress?: string | null;
  tags?: BondThreadEntry['tags'] | null;
  milestones?: BondThreadEntry['milestones'] | null;
  lastUpdatedAt?: string;
  source?: string | null;
}

export interface HoldingSiegeUpdate {
  status: HoldingSiegeStatus | 'none';
  supplyLine?: HoldingSupplyLineStatus;
  preparation?: HoldingSiegePreparation;
}

export type HoldingLedgerUpsertCommand = Omit<HoldingLedgerEntry, 'siege'> & {
  action: 'upsertHoldingLedger';
  siege?: HoldingSiegeUpdate;
};

export type DomesticReportUpsertCommand = DomesticReportEntry & {
  action: 'upsertDomesticReport';
};

export type PrivateAssetUpsertCommand = Omit<PrivateAssetEntry, 'updatedAt'> & {
  action: 'upsertPrivateAsset';
  updatedAt?: string;
};

export type PrivateAssetProjectUpsertCommand = Omit<PrivateAssetProjectEntry, 'updatedAt'> & {
  action: 'upsertPrivateAssetProject';
  updatedAt?: string;
};

export interface CharacterReputationUpdateCommand {
  action: 'updateCharacterReputation';
  characterId: string;
  characterName?: string;
  characterType?: 'player' | 'npc';
  moralityDelta?: number;
  fameDelta?: number;
  tags?: CharacterReputation['tags'];
  summary?: string;
  updatedAt?: string;
}

export interface NpcProfileUpsertCommand {
  action: 'upsertNpcProfile';
  npcId: string;
  name: string;
  courtesyName?: string | null;
  artName?: string | null;
  aliases?: string[] | null;
  commonAddress?: string | null;
  sex: LuanShiNpc['sex'];
  age: number;
  birthDate?: string | null;
  ageKnownAtDate?: string | null;
  role: string;
  factionId?: string | null;
  factionName?: string | null;
  locationId: string;
  isPresent: boolean;
  isFocused: boolean;
  birthOrigin?: string | null;
  birthOriginDescription?: string | null;
  currentIdentity: string;
  currentIdentityDescription?: string | null;
  allegianceTarget?: string | null;
  officeTitle?: string | null;
  militaryTitle?: string | null;
  nobleTitle?: string | null;
  identitySummary?: string | null;
  summary: string;
  appearance: string;
  personality: string;
  motivation: string;
  relationToPlayer: string;
  contactLevel: number;
  recentAttitude: string;
  abilityScores: Record<string, number>;
  vitals?: CharacterVitals;
  traits: CharacterTrait[];
  uniqueArts?: CharacterUniqueArt[];
  effects?: CharacterEffect[];
  equipment?: CharacterEquipmentItem[];
  inventory?: InventoryItem[];
}

export interface NpcPresenceUpdateCommand {
  action: 'updateNpcPresence';
  npcId: string;
  locationId: string;
  isPresent: boolean;
  isFocused?: boolean;
}

export interface NpcBackgroundActivityUpdateCommand {
  action: 'updateNpcBackgroundActivity';
  npcId: string;
  activity: LuanShiNpc['backgroundActivity'] | null;
}

export interface NpcFemaleProfileUpdateCommand {
  action: 'updateNpcFemaleProfile';
  npcId: string;
  npcName: string;
  birthday?: string | null;
  addressToPlayer?: string | null;
  relationshipNotes?: string | null;
  publicIntimacyNotes?: string | null;
  appearanceDescription?: string | null;
  bodyDescription?: string | null;
  clothingStyle?: string | null;
  appearanceExtension?: string | null;
  personalityCore?: string | null;
  affectionProgressionCondition?: string | null;
  relationshipProgressionCondition?: string | null;
  relationshipNetwork?: LuanShiNpcRelationshipNetworkEntry[] | null;
  emotionalBoundary?: string | null;
  adultPrivateProfile?: LuanShiNpcAdultPrivateProfile | null;
  updatedAt?: string | null;
  source?: string | null;
}

export interface PregnancyRiskRecordCommand {
  action: 'recordPregnancyRisk';
  npcId: string;
  npcName: string;
  riskType: 'unprotected' | 'tryingToConceive' | 'reducedRisk';
  summary: string;
}

export interface PregnancyResolutionCommand {
  action: 'resolvePregnancy';
  npcId: string;
  npcName: string;
  outcome: 'liveBirth' | 'ended';
  summary: string;
  childName?: string;
  childSex?: '男' | '女';
}

export type LuanShiCommand =
  | {
      action: 'pushNpcMemory';
      npcId: string;
      npcName: string;
      source: NpcMemorySource;
      eventId?: string;
      value: string;
    }
    | {
        action: 'recordTurnEvent';
        eventId?: string;
        happenedAt?: string;
        locationId: string;
        summary: string;
        presentNpcIds?: string[];
        involvedNpcIds?: string[];
        visibility: TurnEventRecord['visibility'];
      }
  | CharacterIdentityUpdateCommand
  | PlayerLoadoutUpdateCommand
  | NpcLoadoutUpdateCommand
  | PlayerTraitsUpdateCommand
  | CharacterUniqueArtsUpdateCommand
  | ResourceLedgerUpdateCommand
  | FactionLedgerUpsertCommand
  | TroopLedgerUpsertCommand
  | HoldingLedgerUpsertCommand
  | DomesticReportUpsertCommand
  | PrivateAssetUpsertCommand
  | PrivateAssetProjectUpsertCommand
  | ConflictRecordUpsertCommand
  | CombatRecordUpsertCommand
  | CalendarEraUpsertCommand
  | HeroineThreadUpsertCommand
  | BondThreadUpsertCommand
  | CharacterReputationUpdateCommand
  | NpcProfileUpsertCommand
  | NpcPresenceUpdateCommand
  | NpcBackgroundActivityUpdateCommand
  | NpcFemaleProfileUpdateCommand
  | PregnancyRiskRecordCommand
  | PregnancyResolutionCommand;

export interface LuanShiCommandValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const memorySources: NpcMemorySource[] = ['亲历', '听闻', '误会', '推测'];
const eventVisibilities: TurnEventRecord['visibility'][] = ['私密', '在场可知', '传闻扩散', '公开'];
const eventVisibilityAliases: Record<string, TurnEventRecord['visibility']> = {
  private: '私密',
  secret: '私密',
  hidden: '私密',
  in_presence: '在场可知',
  present: '在场可知',
  present_only: '在场可知',
  witnessed: '在场可知',
  rumor: '传闻扩散',
  rumour: '传闻扩散',
  rumor_spread: '传闻扩散',
  rumour_spread: '传闻扩散',
  hearsay: '传闻扩散',
  public: '公开',
  open: '公开',
};
const heroineThreadStatuses: HeroineThreadEntry['status'][] = ['active', 'paused', 'resolved', 'archived'];
const bondThreadStatuses: BondThreadEntry['status'][] = ['active', 'paused', 'resolved', 'archived'];
const bondThreadTypes: BondThreadEntry['bondType'][] = [
  'sworn',
  'kinship',
  'mentor',
  'lordVassal',
  'ally',
  'debt',
  'rival',
  'enemy',
  'other',
];
const npcSexes: LuanShiNpc['sex'][] = ['男', '女', '其他'];
const ledgerKnownLevels: FactionLedgerEntry['knownLevel'][] = ['亲历', '听闻', '推测'];
const holdingTypes: HoldingLedgerEntry['type'][] = [
  'county',
  'commandery',
  'city',
  'fort',
  'pass',
  'camp',
  'estate',
  'port',
  'village',
  'other',
];
const holdingStatuses: HoldingLedgerEntry['status'][] = ['controlled', 'contested', 'temporary', 'lost', 'archived'];
const holdingScaleLevels: HoldingLedgerEntry['scaleLevel'][] = [1, 2, 3, 4, 5];
const holdingSiegeStatuses: HoldingSiegeStatus[] = ['blockaded', 'encircled'];
const holdingSupplyLineStatuses: HoldingSupplyLineStatus[] = ['open', 'strained', 'cut'];
const holdingSiegePreparations: HoldingSiegePreparation[] = ['none', 'prepared', 'stockpiled'];
const holdingScoreFields = [
  'agriculture',
  'commerce',
  'population',
  'publicOrder',
  'popularSupport',
  'defense',
  'recruitPotential',
  'armory',
  'horseSupply',
] as const satisfies readonly (keyof HoldingLedgerEntry)[];
const holdingOptionalTextFields = [
  'locationId',
  'factionId',
  'nominalAllegiance',
  'actualController',
  'stewardNpcId',
  'sourceNote',
] as const satisfies readonly (keyof HoldingLedgerEntry)[];
const holdingOptionalNumberFields = [
  'localTreasury',
  'localGranary',
  'farmlandMu',
  'registeredHouseholds',
] as const satisfies readonly (keyof HoldingLedgerEntry)[];
const holdingOptionalListFields = [
  'aliases',
  'garrisonTroopIds',
  'relatedNpcIds',
  'riskNotes',
  'recentChanges',
] as const satisfies readonly (keyof HoldingLedgerEntry)[];
const privateAssetTypes: PrivateAssetEntry['type'][] = [
  'estate',
  'farmland',
  'workshop',
  'ranch',
  'shop',
  'ferry',
  'mine',
  'other',
];
const privateAssetOwnerScopes: PrivateAssetEntry['ownerScope'][] = [
  'personal',
  'clan',
  'household',
  'retainer',
  'faction',
];
const privateAssetStatuses: PrivateAssetEntry['status'][] = [
  'active',
  'damaged',
  'occupied',
  'disputed',
  'archived',
];
const privateAssetOptionalTextFields = [
  'locationId',
  'locationDescription',
  'managerNpcId',
  'sourceNote',
] as const satisfies readonly (keyof PrivateAssetEntry)[];
const privateAssetOptionalNumberFields = [
  'mu',
  'households',
  'workers',
  'ranchCapacity',
] as const satisfies readonly (keyof PrivateAssetEntry)[];
const privateAssetOptionalListFields = [
  'conditionNotes',
  'riskNotes',
  'recentChanges',
] as const satisfies readonly (keyof PrivateAssetEntry)[];
const privateAssetProjectTypes: PrivateAssetProjectEntry['type'][] = [
  'expand_farmland',
  'irrigation',
  'build_workshop',
  'expand_workshop',
  'build_ranch',
  'expand_ranch',
  'recruit_tenants',
  'repair',
  'anti_corruption',
  'other',
];
const privateAssetProjectStatuses: PrivateAssetProjectEntry['status'][] = [
  'planned',
  'active',
  'blocked',
  'completed',
  'cancelled',
];
const troopQualities: NonNullable<TroopLedgerEntry['quality']>[] = ['低', '中', '高', '精锐'];
const troopFatigueLevels: NonNullable<TroopLedgerEntry['fatigue']>[] = ['低', '中', '高', '极高'];
const troopReadinessLevels: NonNullable<TroopLedgerEntry['readiness']>[] = ['低', '中', '高'];
const troopLifecycleStatuses: NonNullable<TroopLedgerEntry['lifecycleStatus']>[] = [
  'active',
  'routed',
  'merged',
  'split',
  'destroyed',
  'surrendered',
  'disbanded',
  'unknown',
  'archived',
];
const troopCertainties: NonNullable<TroopLedgerEntry['certainty']>[] = ['confirmed', 'reported', 'rumor', 'uncertain'];
const troopStrengthTrends: NonNullable<TroopLedgerEntry['strengthTrend']>[] = ['increased', 'decreased', 'stable', 'unknown'];
const troopUpkeepSources: NonNullable<TroopLedgerEntry['upkeepSource']>[] = [
  'player_resources',
  'superior_provision',
  'mixed',
  'unknown',
];
const troopOrderStatuses: NonNullable<TroopLedgerEntry['orderStatus']>[] = [
  'none',
  'issued',
  'inTransit',
  'delivered',
  'delayed',
  'lost',
  'cancelled',
];
const troopMovementStatuses: NonNullable<TroopLedgerEntry['movementStatus']>[] = [
  'none',
  'waitingOrder',
  'preparing',
  'marching',
  'arrived',
  'blocked',
  'interrupted',
  'cancelled',
];
const conflictTypes: ConflictRecord['type'][] = ['个人战斗', '战争', '军事冲突', '对峙', '其他', '野战', '伏击', '追击', '围城', '守城', '夜袭', '抢粮', '营寨战', '巷战', '水战'];
const conflictScopes: NonNullable<ConflictRecord['scope']>[] = ['selfRelated', 'other'];
const conflictRecordLevels: NonNullable<ConflictRecord['recordLevel']>[] = ['brief', 'full'];
const conflictResultLevels: NonNullable<ConflictRecord['resultLevel']>[] = [
  'decisiveWin',
  'win',
  'minorWin',
  'stalemate',
  'minorLoss',
  'loss',
  'decisiveLoss',
];
const conflictAdvantageBands: NonNullable<NonNullable<ConflictRecord['judgement']>['baselineAdvantage']>[] = [
  'overwhelmingAdvantage',
  'clearAdvantage',
  'slightAdvantage',
  'even',
  'slightDisadvantage',
  'clearDisadvantage',
  'overwhelmingDisadvantage',
];
const conflictTurningPointTypes: NonNullable<NonNullable<ConflictRecord['turningPoints']>[number]['type']>[] = [
  'duelVictory',
  'duelDefeat',
  'commanderSlain',
  'commanderCaptured',
  'commanderWounded',
  'commanderFled',
  'ambush',
  'fireAttack',
  'supplyDestroyed',
  'gateBreached',
  'reinforcementArrived',
  'moraleCollapse',
  'terrainBreakthrough',
  'playerAction',
  'other',
];
const conflictTurningPointImpacts: NonNullable<NonNullable<ConflictRecord['turningPoints']>[number]['impact']>[] = [
  'minor',
  'moderate',
  'major',
  'critical',
];
const conflictScoreFields = ['troopBase', 'commander', 'tactical', 'turningPoint', 'playerAction', 'uniqueArts', 'total'] as const;
const combatKinds: CombatRecord['kind'][] = ['duel', 'melee', 'assassination', 'escape', 'capture', 'battlefieldDuel', 'other'];
const combatParticipantSides: NonNullable<CombatRecord['participants']>[number]['side'][] = ['player', 'ally', 'enemy', 'neutral'];
const combatResultLevels: CombatRecord['resultLevel'][] = ['decisiveWin', 'win', 'stalemate', 'loss', 'decisiveLoss'];
const combatOutcomeTags: NonNullable<CombatRecord['outcomeTags']>[number][] = [
  'kill',
  'wound',
  'seriousWound',
  'capture',
  'forceRetreat',
  'escape',
  'woundedRetreat',
  'disarm',
  'rout',
];
const combatSignificanceLevels: CombatRecord['significance'][] = ['minor', 'notable', 'major', 'legendary'];
const combatScoreFields = [
  'personalBase',
  'equipment',
  'status',
  'environment',
  'combatMethod',
  'playerAction',
  'turningPoint',
  'total',
] as const;
const factionOptionalTextFields = [
  'nominalAllegiance',
  'legalIdentity',
  'actualController',
  'knownSphere',
  'sourceNote',
  'lastKnownAt',
  'updatedAt',
] as const satisfies readonly (keyof FactionLedgerEntry)[];
const abstractFactionPlaceholderIds = new Set([
  'faction_bandits',
  'faction_warlord_proto',
  'faction_scholars_network',
]);
const abstractFactionPlaceholderNames = new Set([
  '各路盗匪',
  '各路匪盗',
  '未来军阀集团',
  '在野士人网络',
  '在野人士网络',
]);
const troopOptionalTextFields = [
  'factionId',
  'previousFactionId',
  'allegianceChangedAt',
  'allegianceChangeReason',
  'troopType',
  'specialDesignation',
  'leaderNpcId',
  'locationId',
  'lastKnownLocationId',
  'lastKnownAt',
  'orderIssuedAt',
  'orderDeliveredAt',
  'orderSummary',
  'destinationLocationId',
  'routeId',
  'departedAt',
  'estimatedArrivalAt',
  'arrivedAt',
  'movementNotes',
  'parentTroopId',
  'mergedIntoTroopId',
  'destroyedInBattleId',
  'lastBattleId',
  'sourceNote',
  'lastChangeReason',
  'updatedAt',
] as const satisfies readonly (keyof TroopLedgerEntry)[];
const troopOptionalListFields = [
  'aliases',
  'statusTags',
  'childTroopIds',
  'mergedFromTroopIds',
] as const satisfies readonly (keyof TroopLedgerEntry)[];
const factionOptionalListFields = [
  'aliases',
  'corePersonNpcIds',
  'knownMemberNpcIds',
  'relatedTroopIds',
] as const satisfies readonly (keyof FactionLedgerEntry)[];
const requiredNpcAbilityNames = ['武力', '统率', '智力', '政治', '魅力', '机运'] as const;
const traitRarities: CharacterTraitRarity[] = ['white', 'green', 'blue', 'red', 'gold'];
const uniqueArtDomains: CharacterUniqueArtDomain[] = [
  'personalCombat',
  'warfare',
  'strategy',
  'social',
  'governance',
  'survival',
  'craft',
  'other',
];
const femaleProfileTextFields = [
  'birthday',
  'addressToPlayer',
  'relationshipNotes',
  'publicIntimacyNotes',
  'appearanceDescription',
  'bodyDescription',
  'clothingStyle',
  'appearanceExtension',
  'personalityCore',
  'affectionProgressionCondition',
  'relationshipProgressionCondition',
  'emotionalBoundary',
  'updatedAt',
  'source',
] as const satisfies readonly (keyof NpcFemaleProfileUpdateCommand)[];
const adultPrivateProfileTextFields = [
  'summary',
  'breastDescription',
  'vaginaDescription',
  'anusDescription',
  'sexualPreferenceNotes',
  'sensitiveSpotNotes',
  'preferenceNotes',
  'boundaryNotes',
  'sensitiveNotes',
  'relationshipRiskNotes',
  'firstNightPartner',
  'firstNightTime',
  'firstNightDescription',
  'updatedAt',
  'source',
] as const satisfies readonly (keyof LuanShiNpcAdultPrivateProfile)[];

const identityFieldNames = [
  'name',
  'courtesyName',
  'artName',
  'aliases',
  'commonAddress',
  'birthOrigin',
  'birthOriginDescription',
  'currentIdentity',
  'currentIdentityDescription',
  'factionId',
  'factionName',
  'allegianceTarget',
  'officeTitle',
  'militaryTitle',
  'nobleTitle',
  'identitySummary',
  'appearance',
  'personality',
] as const satisfies readonly (keyof CharacterIdentityUpdateFields)[];

const stringIdentityFieldNames = identityFieldNames.filter((field) => field !== 'aliases');

export function normalizeTurnEventVisibility(value: unknown): TurnEventRecord['visibility'] | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (eventVisibilities.includes(trimmed as TurnEventRecord['visibility'])) {
    return trimmed as TurnEventRecord['visibility'];
  }
  return eventVisibilityAliases[trimmed.toLowerCase()];
}

export function validateLuanShiCommand(
  state: RuntimeState,
  command: LuanShiCommand,
): LuanShiCommandValidation {
  const normalized = ensureLuanShiState(state);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (command.action === 'recordTurnEvent') {
    validateRecordTurnEventCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'updateCharacterIdentity') {
    validateUpdateCharacterIdentityCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'updatePlayerLoadout') {
    validateUpdatePlayerLoadoutCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'updateNpcLoadout') {
    validateUpdateNpcLoadoutCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'updatePlayerTraits') {
    validateUpdatePlayerTraitsCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'updateCharacterUniqueArts') {
    validateUpdateCharacterUniqueArtsCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'updateResourceLedger') {
    validateUpdateResourceLedgerCommand(command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'upsertFactionLedger') {
    validateUpsertFactionLedgerCommand(command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'upsertTroopLedger') {
    validateUpsertTroopLedgerCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'upsertHoldingLedger') {
    validateUpsertHoldingLedgerCommand(command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'upsertDomesticReport') {
    validateUpsertDomesticReportCommand(command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'upsertPrivateAsset') {
    validateUpsertPrivateAssetCommand(command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'upsertPrivateAssetProject') {
    validateUpsertPrivateAssetProjectCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'upsertConflictRecord') {
    validateUpsertConflictRecordCommand(command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'upsertCombatRecord') {
    validateUpsertCombatRecordCommand(command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'upsertCalendarEra') {
    validateUpsertCalendarEraCommand(command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'upsertHeroineThread') {
    validateUpsertHeroineThreadCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'upsertBondThread') {
    validateUpsertBondThreadCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'updateCharacterReputation') {
    validateUpdateCharacterReputationCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'upsertNpcProfile') {
    validateUpsertNpcProfileCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'updateNpcPresence') {
    validateNpcPresenceUpdateCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'updateNpcBackgroundActivity') {
    validateNpcBackgroundActivityUpdateCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'updateNpcFemaleProfile') {
    validateNpcFemaleProfileUpdateCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'recordPregnancyRisk') {
    validatePregnancyRiskRecordCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'resolvePregnancy') {
    validatePregnancyResolutionCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  if (command.action === 'pushNpcMemory') {
    validatePushNpcMemoryCommand(normalized, command, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  errors.push(`未知乱世命令：${String((command as { action?: unknown }).action)}`);
  return { valid: false, errors, warnings };
}

const resourceNumberFields = ['money', 'grain', 'horses', 'arms', 'recruits'] as const satisfies readonly (keyof ResourceLedger)[];
const resourceListFields = ['weapons', 'documents', 'tokens', 'importantSupplies'] as const satisfies readonly (keyof ResourceLedger)[];
const personalMoneyResourceKeys = new Set(['钱财', 'money']);

export function isPersonalMoneyResourceKey(resourceKey: string): boolean {
  return personalMoneyResourceKeys.has(resourceKey.trim().toLowerCase());
}

function validateUpdateResourceLedgerCommand(
  command: ResourceLedgerUpdateCommand,
  errors: string[],
): void {
  const hasLedgerField = [
    ...resourceNumberFields,
    ...resourceListFields,
    'playerResources',
    'summary',
  ].some((field) => Object.prototype.hasOwnProperty.call(command, field));

  if (!hasLedgerField) {
    errors.push('updateResourceLedger 至少需要一个资源字段。');
  }

  for (const field of resourceNumberFields) {
    const value = command[field];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      errors.push(`updateResourceLedger.${field} 必须是大于等于 0 的数字。`);
    }
  }

  for (const field of resourceListFields) {
    validateStringList(command[field], `updateResourceLedger.${field}`, errors);
  }

  if (command.playerResources !== undefined) {
    if (!command.playerResources || typeof command.playerResources !== 'object' || Array.isArray(command.playerResources)) {
      errors.push('updateResourceLedger.playerResources 必须是资源名到数字的对象。');
    } else {
      for (const [key, value] of Object.entries(command.playerResources)) {
        const resourceKey = key.trim();
        if (!resourceKey) {
          errors.push('updateResourceLedger.playerResources 不能包含空资源名。');
        }
        if (isPersonalMoneyResourceKey(resourceKey)) {
          errors.push(
            `updateResourceLedger.playerResources.${key} 是个人钱财保留字段；普通收支请改用 updatePlayerLoadout.personalMoneyDelta，只有开局初始化或明确重算才使用 absolute personalMoney。`,
          );
        }
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          errors.push(`updateResourceLedger.playerResources.${key} 必须是大于等于 0 的数字。`);
        }
      }
    }
  }

  if (command.summary !== undefined && typeof command.summary !== 'string') {
    errors.push('updateResourceLedger.summary 必须是字符串。');
  }
}

function validateUpsertFactionLedgerCommand(
  command: FactionLedgerUpsertCommand,
  errors: string[],
): void {
  const factionId = typeof command.factionId === 'string' ? command.factionId.trim() : '';
  const factionName = typeof command.name === 'string' ? command.name.trim() : '';
  if (abstractFactionPlaceholderIds.has(factionId) || abstractFactionPlaceholderNames.has(factionName)) {
    errors.push('upsertFactionLedger 不得写入世界书抽象占位势力；请改为具体势力、组织或人物集团。');
  }

  for (const field of ['factionId', 'name', 'type', 'summary', 'stanceToPlayer'] as const) {
    if (!isNonEmptyString(command[field])) {
      errors.push(`upsertFactionLedger.${field} 不能为空。`);
    }
  }
  if (isNonEmptyString(command.type) && !normalizeFactionType(command.type) && looksLikeEngineeringFactionType(command.type)) {
    errors.push('upsertFactionLedger.type 必须使用中文势力类型；不得写入英文枚举或下划线工程词。');
  }

  if (!ledgerKnownLevels.includes(command.knownLevel)) {
    errors.push(`upsertFactionLedger.knownLevel 非法：${String(command.knownLevel)}`);
  }

  if (!Array.isArray(command.recentActions)) {
    errors.push('upsertFactionLedger.recentActions 必须是字符串数组。');
  } else {
    validateStringList(command.recentActions, 'upsertFactionLedger.recentActions', errors);
  }

  for (const field of factionOptionalTextFields) {
    validateOptionalString(command[field], `upsertFactionLedger.${field}`, errors);
  }

  for (const field of factionOptionalListFields) {
    validateOptionalStringList(command[field], `upsertFactionLedger.${field}`, errors);
  }
}

function validateUpsertTroopLedgerCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: TroopLedgerUpsertCommand,
  errors: string[],
): void {
  const troopId = typeof command.troopId === 'string' ? command.troopId.trim() : '';
  if (!troopId) {
    errors.push('upsertTroopLedger.troopId 不能为空。');
  }
  const existingTroop = troopId ? state.troops.find((troop) => troop.troopId === troopId) : undefined;
  const isExistingTroop = existingTroop !== undefined;

  for (const field of ['troopId', 'name', 'task', 'relationToPlayer'] as const) {
    if ((field !== 'troopId' && isExistingTroop && command[field] === undefined)) {
      continue;
    }
    if (!isNonEmptyString(command[field])) {
      errors.push(`upsertTroopLedger.${field} 不能为空。`);
    }
  }

  if (command.supplies === undefined) {
    if (!isExistingTroop) {
      validateSuppliesValue(command.supplies, errors);
    }
  } else {
    validateSuppliesValue(command.supplies, errors);
  }

  if (command.size === undefined) {
    if (!isExistingTroop) {
      errors.push('upsertTroopLedger.size 必须是大于等于 0 的整数。');
    }
  } else if (!Number.isInteger(command.size) || command.size < 0) {
    errors.push('upsertTroopLedger.size 必须是大于等于 0 的整数。');
  }

  if (command.previousSize !== undefined && (!Number.isInteger(command.previousSize) || command.previousSize < 0)) {
    errors.push('upsertTroopLedger.previousSize 必须是大于等于 0 的整数。');
  }

  for (const field of ['morale', 'training'] as const) {
    const value = command[field];
    if (value === undefined && isExistingTroop) {
      continue;
    }
    if (normalizeTroopScore(value) === undefined) {
      errors.push(`upsertTroopLedger.${field} 必须是 0 到 100 之间的数字。`);
    }
  }

  for (const field of troopOptionalTextFields) {
    validateOptionalString(command[field], `upsertTroopLedger.${field}`, errors);
  }

  for (const field of troopOptionalListFields) {
    validateOptionalStringList(command[field], `upsertTroopLedger.${field}`, errors);
  }

  if (command.knownLevel !== undefined && !ledgerKnownLevels.includes(command.knownLevel)) {
    errors.push(`upsertTroopLedger.knownLevel 非法：${String(command.knownLevel)}`);
  }
  if (command.certainty !== undefined && !troopCertainties.includes(command.certainty)) {
    errors.push(`upsertTroopLedger.certainty 非法：${String(command.certainty)}`);
  }
  const effectiveKnownLevel = command.knownLevel ?? existingTroop?.knownLevel;
  const effectiveCertainty = command.certainty ?? existingTroop?.certainty;
  if ((command.knownLevel !== undefined || command.certainty !== undefined)
    && effectiveKnownLevel === '推测'
    && effectiveCertainty === 'confirmed') {
    errors.push('upsertTroopLedger.knownLevel=推测 与 certainty=confirmed 互相矛盾。');
  }
  if (command.quality !== undefined && normalizeTroopQuality(command.quality) === undefined) {
    errors.push(`upsertTroopLedger.quality 非法：${String(command.quality)}`);
  }
  if (command.fatigue !== undefined && normalizeTroopFatigue(command.fatigue) === undefined) {
    errors.push(`upsertTroopLedger.fatigue 非法：${String(command.fatigue)}`);
  }
  if (command.readiness !== undefined && normalizeTroopReadiness(command.readiness) === undefined) {
    errors.push(`upsertTroopLedger.readiness 非法：${String(command.readiness)}`);
  }
  if (command.lifecycleStatus !== undefined && !troopLifecycleStatuses.includes(command.lifecycleStatus)) {
    errors.push(`upsertTroopLedger.lifecycleStatus 非法：${String(command.lifecycleStatus)}`);
  }
  if (command.lifecycleStatus === 'destroyed') {
    if (command.size !== 0) {
      errors.push('upsertTroopLedger.lifecycleStatus=destroyed 时必须显式写 size=0。');
    }
    if (!isNonEmptyString(command.destroyedInBattleId)) {
      errors.push('upsertTroopLedger.lifecycleStatus=destroyed 时必须提供 destroyedInBattleId。');
    }
  }
  if (command.lifecycleStatus === 'split'
    && (!Array.isArray(command.childTroopIds) || command.childTroopIds.filter(isNonEmptyString).length < 2)) {
    errors.push('upsertTroopLedger.lifecycleStatus=split 时必须提供至少两个 childTroopIds。');
  }
  if (command.lifecycleStatus === 'merged' && !isNonEmptyString(command.mergedIntoTroopId)) {
    errors.push('upsertTroopLedger.lifecycleStatus=merged 时必须提供 mergedIntoTroopId。');
  }
  if (command.orderStatus !== undefined && !troopOrderStatuses.includes(command.orderStatus)) {
    errors.push(`upsertTroopLedger.orderStatus 非法：${String(command.orderStatus)}`);
  }
  if (command.movementStatus !== undefined && !troopMovementStatuses.includes(command.movementStatus)) {
    errors.push(`upsertTroopLedger.movementStatus 非法：${String(command.movementStatus)}`);
  }
  const previousTroop = troopId ? state.troops.find((troop) => troop.troopId === troopId) : undefined;
  const explicitLocationId = command.locationId?.trim();
  const explicitLastKnownLocationId = command.lastKnownLocationId?.trim();
  const effectiveDestinationLocationId = command.destinationLocationId?.trim() ?? previousTroop?.destinationLocationId;
  if (explicitLocationId && explicitLastKnownLocationId && explicitLocationId !== explicitLastKnownLocationId) {
    errors.push('upsertTroopLedger.locationId 与 lastKnownLocationId 同批写回时必须一致。');
  }
  if (
    previousTroop
    && explicitLocationId
    && previousTroop.locationId
    && explicitLocationId !== previousTroop.locationId
    && ['waitingOrder', 'preparing', 'marching'].includes(command.movementStatus ?? previousTroop.movementStatus ?? '')
  ) {
    errors.push('upsertTroopLedger 行军未抵达时不得直接改变 locationId。');
  }
  if (command.movementStatus === 'arrived') {
    const arrivalLocationId = explicitLocationId ?? effectiveDestinationLocationId;
    if (!arrivalLocationId) {
      errors.push('upsertTroopLedger.movementStatus=arrived 时必须提供 locationId、destinationLocationId 或沿用已有目标地点。');
    } else {
      if (effectiveDestinationLocationId && arrivalLocationId !== effectiveDestinationLocationId) {
        errors.push('upsertTroopLedger.movementStatus=arrived 时 locationId 必须与目标地点一致。');
      }
      if (explicitLastKnownLocationId && explicitLastKnownLocationId !== arrivalLocationId) {
        errors.push('upsertTroopLedger.movementStatus=arrived 时 lastKnownLocationId 必须与抵达地点一致。');
      }
    }
  }
  if (command.strengthTrend !== undefined && normalizeTroopStrengthTrend(command.strengthTrend) === undefined) {
    errors.push(`upsertTroopLedger.strengthTrend 非法：${String(command.strengthTrend)}`);
  }
  if (command.upkeepSource !== undefined && !troopUpkeepSources.includes(command.upkeepSource)) {
    errors.push(`upsertTroopLedger.upkeepSource 非法：${String(command.upkeepSource)}`);
  }
}

export function canonicalRelationshipStableKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validateUpsertHoldingLedgerCommand(
  command: HoldingLedgerUpsertCommand,
  errors: string[],
): void {
  for (const field of ['holdingId', 'name', 'summary', 'updatedAt'] as const) {
    if (!isNonEmptyString(command[field])) {
      errors.push(`upsertHoldingLedger.${field} cannot be empty.`);
    }
  }

  if (!holdingTypes.includes(command.type)) {
    errors.push(`upsertHoldingLedger.type is invalid: ${String(command.type)}`);
  }
  if (!holdingStatuses.includes(command.status)) {
    errors.push(`upsertHoldingLedger.status is invalid: ${String(command.status)}`);
  }
  if (!holdingScaleLevels.includes(command.scaleLevel)) {
    errors.push('upsertHoldingLedger.scaleLevel must be 1, 2, 3, 4, or 5.');
  }

  for (const field of holdingScoreFields) {
    validateScoreNumber(command[field], `upsertHoldingLedger.${field}`, errors);
  }
  for (const field of holdingOptionalTextFields) {
    validateOptionalString(command[field], `upsertHoldingLedger.${field}`, errors);
  }
  for (const field of holdingOptionalNumberFields) {
    validateOptionalNonNegativeNumber(command[field], `upsertHoldingLedger.${field}`, errors);
  }
  validateOptionalScoreNumber(command.eliteControlledShare, 'upsertHoldingLedger.eliteControlledShare', errors);
  validateOptionalRelationNumber(command.localEliteRelation, 'upsertHoldingLedger.localEliteRelation', errors);
  errors.push(...validateHoldingCivilAdministrationFields(command));
  for (const field of holdingOptionalListFields) {
    validateOptionalStringList(command[field], `upsertHoldingLedger.${field}`, errors);
  }
  validateHoldingSiegeUpdate(command.siege, errors);
}

function validateHoldingSiegeUpdate(value: HoldingSiegeUpdate | undefined, errors: string[]): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('upsertHoldingLedger.siege 必须是对象。');
    return;
  }
  if (value.status !== 'none' && !holdingSiegeStatuses.includes(value.status)) {
    errors.push(`upsertHoldingLedger.siege.status 非法：${String(value.status)}。`);
  }
  if (value.status === 'none') {
    return;
  }
  if (!value.supplyLine || !holdingSupplyLineStatuses.includes(value.supplyLine)) {
    errors.push(`upsertHoldingLedger.siege.supplyLine 非法：${String(value.supplyLine)}。`);
  }
  if (!value.preparation || !holdingSiegePreparations.includes(value.preparation)) {
    errors.push(`upsertHoldingLedger.siege.preparation 非法：${String(value.preparation)}。`);
  }
}

function validateUpsertDomesticReportCommand(
  command: DomesticReportUpsertCommand,
  errors: string[],
): void {
  if (claimsReservedSystemDomesticReportIdentity(command)) {
    errors.push('upsertDomesticReport cannot write identities reserved for local system reports (reportId starting with "system:", source="system", or a local settlement kind).');
  }
  for (const field of ['reportId', 'settledAt', 'title', 'summary'] as const) {
    if (!isNonEmptyString(command[field])) {
      errors.push(`upsertDomesticReport.${field} cannot be empty.`);
    }
  }
  if (
    (typeof command.year !== 'number' || !Number.isFinite(command.year))
    && !isNonEmptyString(command.year)
  ) {
    errors.push('upsertDomesticReport.year must be a finite number or non-empty string.');
  }
  validateDomesticReportResourceDelta(command.income, 'upsertDomesticReport.income', errors);
  validateDomesticReportResourceDelta(command.expenses, 'upsertDomesticReport.expenses', errors);
  validateDomesticReportResourceDelta(command.netChange, 'upsertDomesticReport.netChange', errors);

  if (command.holdingHighlights !== undefined) {
    if (!Array.isArray(command.holdingHighlights)) {
      errors.push('upsertDomesticReport.holdingHighlights must be an array.');
    } else {
      command.holdingHighlights.forEach((highlight, index) => {
        if (!highlight || typeof highlight !== 'object' || Array.isArray(highlight)) {
          errors.push(`upsertDomesticReport.holdingHighlights[${index}] must be an object.`);
          return;
        }
        if (!isNonEmptyString(highlight.holdingId)) {
          errors.push(`upsertDomesticReport.holdingHighlights[${index}].holdingId cannot be empty.`);
        }
        if (!isNonEmptyString(highlight.summary)) {
          errors.push(`upsertDomesticReport.holdingHighlights[${index}].summary cannot be empty.`);
        }
      });
    }
  }
  if (command.privateAssetHighlights !== undefined) {
    if (!Array.isArray(command.privateAssetHighlights)) {
      errors.push('upsertDomesticReport.privateAssetHighlights must be an array.');
    } else {
      command.privateAssetHighlights.forEach((highlight, index) => {
        if (!highlight || typeof highlight !== 'object' || Array.isArray(highlight)) {
          errors.push(`upsertDomesticReport.privateAssetHighlights[${index}] must be an object.`);
          return;
        }
        if (!isNonEmptyString(highlight.privateAssetId)) {
          errors.push(`upsertDomesticReport.privateAssetHighlights[${index}].privateAssetId cannot be empty.`);
        }
        if (!isNonEmptyString(highlight.summary)) {
          errors.push(`upsertDomesticReport.privateAssetHighlights[${index}].summary cannot be empty.`);
        }
      });
    }
  }
  if (command.projectHighlights !== undefined) {
    if (!Array.isArray(command.projectHighlights)) {
      errors.push('upsertDomesticReport.projectHighlights must be an array.');
    } else {
      command.projectHighlights.forEach((highlight, index) => {
        if (!highlight || typeof highlight !== 'object' || Array.isArray(highlight)) {
          errors.push(`upsertDomesticReport.projectHighlights[${index}] must be an object.`);
          return;
        }
        if (!isNonEmptyString(highlight.projectId)) {
          errors.push(`upsertDomesticReport.projectHighlights[${index}].projectId cannot be empty.`);
        }
        if (highlight.assetId !== undefined && !isNonEmptyString(highlight.assetId)) {
          errors.push(`upsertDomesticReport.projectHighlights[${index}].assetId cannot be empty.`);
        }
        if (!isNonEmptyString(highlight.summary)) {
          errors.push(`upsertDomesticReport.projectHighlights[${index}].summary cannot be empty.`);
        }
      });
    }
  }
  validateOptionalStringList(command.warnings, 'upsertDomesticReport.warnings', errors);
  if (typeof command.readByPlayer !== 'boolean') {
    errors.push('upsertDomesticReport.readByPlayer must be a boolean.');
  }
}

function validateUpsertPrivateAssetCommand(
  command: PrivateAssetUpsertCommand,
  errors: string[],
): void {
  for (const field of ['privateAssetId', 'name', 'summary'] as const) {
    if (!isNonEmptyString(command[field])) {
      errors.push(`upsertPrivateAsset.${field} cannot be empty.`);
    }
  }
  validateEngineManagedUpdatedAt(command.updatedAt, 'upsertPrivateAsset.updatedAt', errors);

  if (!privateAssetTypes.includes(command.type)) {
    errors.push(`upsertPrivateAsset.type is invalid: ${String(command.type)}`);
  }
  if (!privateAssetOwnerScopes.includes(command.ownerScope)) {
    errors.push(`upsertPrivateAsset.ownerScope is invalid: ${String(command.ownerScope)}`);
  }
  if (!privateAssetStatuses.includes(command.status)) {
    errors.push(`upsertPrivateAsset.status is invalid: ${String(command.status)}`);
  }

  for (const field of privateAssetOptionalTextFields) {
    validateOptionalString(command[field], `upsertPrivateAsset.${field}`, errors);
  }
  for (const field of privateAssetOptionalNumberFields) {
    validateOptionalNonNegativeNumber(command[field], `upsertPrivateAsset.${field}`, errors);
  }
  if (
    command.workshopScale !== undefined
    && (typeof command.workshopScale !== 'number'
      || !Number.isFinite(command.workshopScale)
      || command.workshopScale < 1
      || command.workshopScale > 5)
  ) {
    errors.push('upsertPrivateAsset.workshopScale must be a number between 1 and 5.');
  }
  for (const field of privateAssetOptionalListFields) {
    validateOptionalStringList(command[field], `upsertPrivateAsset.${field}`, errors);
  }
}

function validateUpsertPrivateAssetProjectCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: PrivateAssetProjectUpsertCommand,
  errors: string[],
): void {
  for (const field of ['projectId', 'assetId', 'title', 'startedAt'] as const) {
    if (!isNonEmptyString(command[field])) {
      errors.push(`upsertPrivateAssetProject.${field} cannot be empty.`);
    }
  }
  validateEngineManagedUpdatedAt(command.updatedAt, 'upsertPrivateAssetProject.updatedAt', errors);

  if (!privateAssetProjectTypes.includes(command.type)) {
    errors.push(`upsertPrivateAssetProject.type is invalid: ${String(command.type)}`);
  }
  if (!privateAssetProjectStatuses.includes(command.status)) {
    errors.push(`upsertPrivateAssetProject.status is invalid: ${String(command.status)}`);
  }
  if (isNonEmptyString(command.assetId) && !state.privateAssets.some((asset) => asset.privateAssetId === command.assetId.trim())) {
    errors.push(`upsertPrivateAssetProject.assetId does not reference an existing private asset: ${command.assetId}`);
  }

  validateOptionalString(command.expectedCompleteAt, 'upsertPrivateAssetProject.expectedCompleteAt', errors);
  validateOptionalNonNegativeNumber(command.investedMoney, 'upsertPrivateAssetProject.investedMoney', errors);
  validateOptionalNonNegativeNumber(command.investedGrain, 'upsertPrivateAssetProject.investedGrain', errors);
  validateOptionalStringList(command.riskNotes, 'upsertPrivateAssetProject.riskNotes', errors);
  validateOptionalStringList(command.progressNotes, 'upsertPrivateAssetProject.progressNotes', errors);
  validatePrivateAssetProjectDelta(command.targetDelta, 'upsertPrivateAssetProject.targetDelta', errors);
}

function validatePrivateAssetProjectDelta(
  value: PrivateAssetProjectDelta | undefined,
  fieldName: string,
  errors: string[],
): void {
  if (value === undefined || value === null) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${fieldName} must be an object.`);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (!['mu', 'households', 'workers', 'workshopScale', 'ranchCapacity'].includes(key)) {
      errors.push(`${fieldName}.${key} is not supported.`);
      continue;
    }
    if (item === undefined || item === null) continue;
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      errors.push(`${fieldName}.${key} must be a finite number.`);
    }
  }
}

function validateDomesticReportResourceDelta(
  value: unknown,
  fieldName: string,
  errors: string[],
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${fieldName} must be a resource delta object.`);
    return;
  }
  const delta = value as DomesticReportUpsertCommand['income'];
  for (const field of resourceNumberFields) {
    const item = delta[field];
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      errors.push(`${fieldName}.${field} must be a finite number.`);
    }
  }
}

function validateUpsertConflictRecordCommand(
  command: ConflictRecordUpsertCommand,
  errors: string[],
): void {
  for (const field of ['conflictId', 'title', 'occurredAt', 'outcome'] as const) {
    if (!isNonEmptyString(command[field])) {
      errors.push(`upsertConflictRecord.${field} 不能为空。`);
    }
  }
  if (command.summary !== undefined && !isNonEmptyString(command.summary)) {
    errors.push('upsertConflictRecord.summary 不能为空。');
  }

  if (!conflictTypes.includes(command.type)) {
    errors.push(`upsertConflictRecord.type 非法：${String(command.type)}。战事类型应描述战斗方式，如伏击/追击/围城/抢粮；覆灭/招降/合并/溃退属于结果或效果。`);
  }

  if (command.scope !== undefined && !conflictScopes.includes(command.scope)) {
    errors.push(`upsertConflictRecord.scope 非法：${String(command.scope)}`);
  }
  if (command.recordLevel !== undefined && !conflictRecordLevels.includes(command.recordLevel)) {
    errors.push(`upsertConflictRecord.recordLevel 非法：${String(command.recordLevel)}`);
  }

  if (command.resultLevel !== undefined && !conflictResultLevels.includes(command.resultLevel)) {
    errors.push(`upsertConflictRecord.resultLevel 非法：${String(command.resultLevel)}`);
  }

  for (const field of ['locationId', 'locationName', 'result', 'winnerSide', 'loserSide', 'reportText', 'imageKey', 'updatedAt'] as const) {
    validateOptionalString(command[field], `upsertConflictRecord.${field}`, errors);
  }

  for (const field of [
    'sides',
    'commanderNpcIds',
    'involvedTroopIds',
    'involvedFactionIds',
    'involvedNpcIds',
    'decisiveFactors',
    'troopEffects',
    'factionEffects',
    'placeEffects',
    'relatedQuestIds',
    'relatedTrendIds',
    'resultTags',
  ] as const) {
    validateOptionalStringList(command[field], `upsertConflictRecord.${field}`, errors);
  }
  validateConflictJudgement(command.judgement, errors);
  validateConflictTurningPoints(command.turningPoints, errors);
}

function validateConflictJudgement(value: unknown, errors: string[]): void {
  if (value === undefined || value === null) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('upsertConflictRecord.judgement 必须是对象。');
    return;
  }

  const judgement = value as NonNullable<ConflictRecord['judgement']>;
  if (judgement.method !== 'warJudgementV1') {
    errors.push(`upsertConflictRecord.judgement.method 非法：${String(judgement.method)}`);
  }
  validateOptionalString(judgement.perspectiveSide, 'upsertConflictRecord.judgement.perspectiveSide', errors);
  const baselineAdvantage = (judgement as { baselineAdvantage?: unknown }).baselineAdvantage;
  const isKnownBaselineAdvantage = typeof baselineAdvantage === 'string'
    && conflictAdvantageBands.includes(
      baselineAdvantage as NonNullable<NonNullable<ConflictRecord['judgement']>['baselineAdvantage']>,
    );
  const isNumericBaselineAdvantage = typeof baselineAdvantage === 'number' && Number.isFinite(baselineAdvantage);
  if (baselineAdvantage !== undefined && !isKnownBaselineAdvantage && !isNumericBaselineAdvantage) {
    errors.push(`upsertConflictRecord.judgement.baselineAdvantage 非法：${String(judgement.baselineAdvantage)}`);
  }
  validateOptionalString(judgement.commanderAssessment, 'upsertConflictRecord.judgement.commanderAssessment', errors);
  validateOptionalString(judgement.tacticalAssessment, 'upsertConflictRecord.judgement.tacticalAssessment', errors);
  validateOptionalString(judgement.underdogReason, 'upsertConflictRecord.judgement.underdogReason', errors);

  if (judgement.scoreBreakdown !== undefined) {
    if (!judgement.scoreBreakdown || typeof judgement.scoreBreakdown !== 'object' || Array.isArray(judgement.scoreBreakdown)) {
      errors.push('upsertConflictRecord.judgement.scoreBreakdown 必须是对象。');
      return;
    }
    for (const field of conflictScoreFields) {
      validateOptionalBoundedNumber(
        judgement.scoreBreakdown[field],
        `upsertConflictRecord.judgement.scoreBreakdown.${field}`,
        errors,
        field === 'total' ? 250 : 100,
      );
    }
    validateOptionalStringList(
      judgement.scoreBreakdown.notes,
      'upsertConflictRecord.judgement.scoreBreakdown.notes',
      errors,
    );
  }
}

function validateConflictTurningPoints(value: unknown, errors: string[]): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    errors.push('upsertConflictRecord.turningPoints 必须是数组。');
    return;
  }

  value.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`upsertConflictRecord.turningPoints[${index}] 必须是对象。`);
      return;
    }
    const point = item as NonNullable<ConflictRecord['turningPoints']>[number];
    if (!conflictTurningPointTypes.includes(point.type)) {
      errors.push(`upsertConflictRecord.turningPoints[${index}].type 非法：${String(point.type)}`);
    }
    if (!isNonEmptyString(point.summary)) {
      errors.push(`upsertConflictRecord.turningPoints[${index}].summary 不能为空。`);
    }
    if (!conflictTurningPointImpacts.includes(point.impact)) {
      errors.push(`upsertConflictRecord.turningPoints[${index}].impact 非法：${String(point.impact)}`);
    }
    validateOptionalString(point.side, `upsertConflictRecord.turningPoints[${index}].side`, errors);
    validateOptionalStringList(point.relatedNpcIds, `upsertConflictRecord.turningPoints[${index}].relatedNpcIds`, errors);
    validateOptionalStringList(point.relatedTroopIds, `upsertConflictRecord.turningPoints[${index}].relatedTroopIds`, errors);
    validateOptionalBoundedNumber(
      point.scoreModifier,
      `upsertConflictRecord.turningPoints[${index}].scoreModifier`,
      errors,
      100,
    );
  });
}

function validateSuppliesValue(value: unknown, errors: string[]): void {
  if (isNonEmptyString(value)) return;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) return;
  errors.push('upsertTroopLedger.supplies 必须是非空文本或 0 到 100 之间的数值。');
}

export function normalizeTroopScore(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;

  const compact = value.trim().replace(/\s+/g, '');
  if (!compact) return undefined;
  const numericMatch = compact.match(/^(\d+(?:\.\d+)?)(?:\/100)?$/);
  if (numericMatch) {
    const numericValue = Number(numericMatch[1]);
    return Number.isFinite(numericValue) && numericValue >= 0 && numericValue <= 100
      ? numericValue
      : undefined;
  }

  const scoreAliases: Record<string, number> = {
    ['\u6781\u4f4e']: 15,
    ['\u5f88\u4f4e']: 20,
    ['\u6781\u5dee']: 15,
    ['\u5f88\u5dee']: 20,
    ['\u5dee']: 20,
    ['\u8f83\u4f4e']: 30,
    ['\u4f4e']: 30,
    ['\u4f4e\u843d']: 30,
    ['\u666e\u901a']: 50,
    ['\u4e00\u822c']: 50,
    ['\u4e2d\u7b49']: 50,
    ['\u4e2d']: 50,
    ['\u8f83\u9ad8']: 70,
    ['\u9ad8']: 75,
    ['\u826f\u597d']: 75,
    ['\u4f18\u79c0']: 85,
    ['\u5f88\u9ad8']: 85,
    ['\u7cbe\u9510']: 85,
    ['\u6781\u9ad8']: 90,
  };

  return scoreAliases[compact];
}

type TroopQuality = NonNullable<TroopLedgerEntry['quality']>;
type TroopFatigue = NonNullable<TroopLedgerEntry['fatigue']>;
type TroopReadiness = NonNullable<TroopLedgerEntry['readiness']>;
type TroopStrengthTrend = NonNullable<TroopLedgerEntry['strengthTrend']>;

export function normalizeTroopQuality(value: unknown): TroopLedgerEntry['quality'] | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (troopQualities.includes(trimmed as TroopQuality)) {
      return trimmed as TroopQuality;
    }
    if (trimmed === '普通' || trimmed === '一般') return '中';
    if (trimmed === '精锐部队') return '精锐';
  }
  const numericScore = normalizeNumericScoreInput(value);
  if (numericScore !== undefined) {
    if (numericScore >= 85) return '精锐';
    if (numericScore >= 70) return '高';
    if (numericScore >= 40) return '中';
    return '低';
  }
  return undefined;
}

export function normalizeTroopFatigue(value: unknown): TroopLedgerEntry['fatigue'] | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (troopFatigueLevels.includes(trimmed as TroopFatigue)) {
      return trimmed as TroopFatigue;
    }
    if (trimmed === '中等' || trimmed === '一般') return '中';
    if (trimmed === '很低' || trimmed === '轻微') return '低';
    if (trimmed === '很高' || trimmed === '严重' || trimmed === '极重') return '极高';
  }
  const numericScore = normalizeNumericScoreInput(value);
  if (numericScore !== undefined) {
    if (numericScore >= 86) return '极高';
    if (numericScore >= 66) return '高';
    if (numericScore >= 36) return '中';
    return '低';
  }
  return undefined;
}

export function normalizeTroopReadiness(value: unknown): TroopLedgerEntry['readiness'] | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (troopReadinessLevels.includes(trimmed as TroopReadiness)) {
      return trimmed as TroopReadiness;
    }
    if (trimmed === '中等' || trimmed === '一般') return '中';
    if (trimmed === '中高' || trimmed === '较高' || trimmed === '很高') return '高';
    if (
      trimmed === '较低'
      || trimmed === '很低'
      || trimmed === '\u5dee'
      || trimmed === '\u5f88\u5dee'
      || trimmed === '\u6781\u5dee'
      || trimmed === '\u7cdf\u7cd5'
    ) return '低';
  }
  const numericScore = normalizeNumericScoreInput(value);
  if (numericScore !== undefined) {
    if (numericScore >= 70) return '高';
    if (numericScore >= 40) return '中';
    return '低';
  }
  return undefined;
}

function normalizeNumericScoreInput(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const compact = value.trim().replace(/\s+/g, '');
  const numericMatch = compact.match(/^(\d+(?:\.\d+)?)(?:\/100)?$/);
  if (!numericMatch) return undefined;
  const numericValue = Number(numericMatch[1]);
  return Number.isFinite(numericValue) && numericValue >= 0 && numericValue <= 100 ? numericValue : undefined;
}

export function normalizeTroopStrengthTrend(value: unknown): TroopLedgerEntry['strengthTrend'] | undefined {
  if (typeof value !== 'string') return undefined;
  const compact = value.trim().replace(/\s+/g, '').toLowerCase();
  if (!compact) return undefined;
  if (troopStrengthTrends.includes(compact as TroopStrengthTrend)) {
    return compact as TroopStrengthTrend;
  }

  if (
    compact.includes('increase')
    || compact.includes('rise')
    || compact.includes('grow')
    || compact.includes('增强')
    || compact.includes('增加')
    || compact.includes('增长')
    || compact.includes('上升')
    || compact.includes('提升')
    || compact.includes('扩编')
    || compact.includes('增员')
    || compact.includes('补充')
    || compact.includes('壮大')
    || compact.includes('成军')
    || compact.includes('变强')
    || compact.includes('涨')
  ) {
    return 'increased';
  }
  if (
    compact.includes('decrease')
    || compact.includes('fall')
    || compact.includes('drop')
    || compact.includes('减少')
    || compact.includes('下降')
    || compact.includes('削弱')
    || compact.includes('减员')
    || compact.includes('折损')
    || compact.includes('伤亡')
    || compact.includes('损耗')
    || compact.includes('溃散')
    || compact.includes('缩水')
    || compact.includes('变弱')
  ) {
    return 'decreased';
  }
  if (
    compact.includes('stable')
    || compact.includes('unchanged')
    || compact.includes('稳定')
    || compact.includes('持平')
    || compact.includes('不变')
    || compact.includes('无变化')
    || compact.includes('维持')
    || compact.includes('照旧')
  ) {
    return 'stable';
  }
  if (
    compact.includes('unknown')
    || compact.includes('未知')
    || compact.includes('不明')
    || compact.includes('待确认')
  ) {
    return 'unknown';
  }
  return undefined;
}

function validateOptionalBoundedNumber(
  value: unknown,
  fieldName: string,
  errors: string[],
  absoluteLimit: number,
): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > absoluteLimit) {
    errors.push(`${fieldName} 必须是绝对值不超过 ${absoluteLimit} 的数字。`);
  }
}

function validateScoreNumber(value: unknown, fieldName: string, errors: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    errors.push(`${fieldName} must be a number between 0 and 100.`);
  }
}

function validateOptionalNonNegativeNumber(value: unknown, fieldName: string, errors: string[]): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push(`${fieldName} must be a non-negative number.`);
  }
}

function validateOptionalScoreNumber(value: unknown, fieldName: string, errors: string[]): void {
  if (value === undefined || value === null) return;
  validateScoreNumber(value, fieldName, errors);
}

function validateOptionalRelationNumber(value: unknown, fieldName: string, errors: string[]): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -100 || value > 100) {
    errors.push(`${fieldName} must be a number between -100 and 100.`);
  }
}

function validateStringList(value: unknown, fieldName: string, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${fieldName} 必须是字符串数组。`);
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      errors.push(`${fieldName}[${index}] 必须是非空字符串。`);
    }
  });
}

function validateStringListOrString(value: unknown, fieldName: string, errors: string[]): void {
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      errors.push(`${fieldName} must be a non-empty string or string array.`);
    }
    return;
  }
  validateStringList(value, fieldName, errors);
}

function cleanStringListInput(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateOptionalString(value: unknown, fieldName: string, errors: string[]): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${fieldName} 必须是非空字符串。`);
  }
}

function validateOptionalStringList(value: unknown, fieldName: string, errors: string[]): void {
  if (value === undefined || value === null) return;
  validateStringList(value, fieldName, errors);
}

function validateUpsertCombatRecordCommand(
  command: CombatRecordUpsertCommand,
  errors: string[],
): void {
  for (const field of ['combatId', 'title', 'summary', 'occurredAt', 'outcome'] as const) {
    if (!isNonEmptyString(command[field])) {
      errors.push(`upsertCombatRecord.${field} cannot be empty.`);
    }
  }

  if (!combatKinds.includes(command.kind)) {
    errors.push(`upsertCombatRecord.kind is invalid: ${String(command.kind)}`);
  }
  if (typeof command.playerInvolved !== 'boolean') {
    errors.push('upsertCombatRecord.playerInvolved must be a boolean.');
  }
  if (!combatResultLevels.includes(command.resultLevel)) {
    errors.push(`upsertCombatRecord.resultLevel is invalid: ${String(command.resultLevel)}`);
  }
  if (!combatSignificanceLevels.includes(command.significance)) {
    errors.push(`upsertCombatRecord.significance is invalid: ${String(command.significance)}`);
  }
  if (command.chronicleWorthy !== undefined && typeof command.chronicleWorthy !== 'boolean') {
    errors.push('upsertCombatRecord.chronicleWorthy must be a boolean.');
  }

  validateCombatParticipants(command.participants, errors);
  validateCombatOutcomeTags(command.outcomeTags, errors);
  for (const field of ['locationId', 'locationName', 'briefText', 'reportText', 'imageKey', 'updatedAt'] as const) {
    validateOptionalString(command[field], `upsertCombatRecord.${field}`, errors);
  }
  for (const field of ['relatedNpcIds', 'relatedConflictIds', 'relatedQuestIds', 'relatedTrendIds', 'visualTags', 'reputationEffects'] as const) {
    validateOptionalStringList(command[field], `upsertCombatRecord.${field}`, errors);
  }
  validateCombatJudgement(command.judgement, errors);
}

function validateUpsertCalendarEraCommand(
  command: CalendarEraUpsertCommand,
  errors: string[],
): void {
  if (!isNonEmptyString(command.eraId)) {
    errors.push('upsertCalendarEra.eraId cannot be empty.');
  }
  if (!isNonEmptyString(command.eraName)) {
    errors.push('upsertCalendarEra.eraName cannot be empty.');
  }
  if (!Number.isInteger(command.startYear) || command.startYear <= 0) {
    errors.push('upsertCalendarEra.startYear must be a positive integer.');
  }
  if (command.startMonth !== undefined && (!Number.isInteger(command.startMonth) || command.startMonth < 1 || command.startMonth > 12)) {
    errors.push('upsertCalendarEra.startMonth must be between 1 and 12.');
  }
  if (command.startDay !== undefined && (!Number.isInteger(command.startDay) || command.startDay < 1 || command.startDay > 30)) {
    errors.push('upsertCalendarEra.startDay must be between 1 and 30.');
  }
  validateOptionalString(command.rulerName, 'upsertCalendarEra.rulerName', errors);
  validateOptionalString(command.source, 'upsertCalendarEra.source', errors);
  validateOptionalString(command.note, 'upsertCalendarEra.note', errors);
}

function validateUpsertHeroineThreadCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: HeroineThreadUpsertCommand,
  errors: string[],
): void {
  const heroineThreadId = canonicalRelationshipStableKey(command.heroineThreadId);
  const lookup = validatePersistedRelationshipCollection<HeroineThreadEntry>(
    state.heroineThreads,
    'heroineThreads',
    'heroineThreadId',
    heroineThreadId,
    errors,
    (entry, fieldName) => validatePersistedHeroineThreadShape(state, entry, fieldName, errors),
  );
  if (!lookup.valid) return;
  const existingByThreadId = lookup.existing;
  const requestedNpcId = isNonEmptyString(command.npcId) ? command.npcId.trim() : undefined;
  const existing = existingByThreadId
    ?? findHeroineThreadByIdentity(state.heroineThreads, heroineThreadId, requestedNpcId);

  if (!heroineThreadId) {
    errors.push('upsertHeroineThread.heroineThreadId cannot be empty.');
  }
  if (existingByThreadId && requestedNpcId && requestedNpcId !== existingByThreadId.npcId.trim()) {
    errors.push('upsertHeroineThread cannot change npcId for an existing heroineThreadId.');
  }
  for (const field of ['npcId', 'npcName', 'stage', 'relationshipRole', 'summary'] as const) {
    if ((!existing || command[field] !== undefined) && !isNonEmptyString(command[field])) {
      errors.push(`upsertHeroineThread.${field} cannot be empty.`);
    }
  }
  validateManagedRelationshipUpdatedAt(command.lastUpdatedAt, 'upsertHeroineThread.lastUpdatedAt', errors);

  if ((!existing || command.status !== undefined) && !heroineThreadStatuses.includes(command.status as HeroineThreadEntry['status'])) {
    errors.push(`upsertHeroineThread.status is invalid: ${String(command.status)}`);
  }

  const finalNpcId = isNonEmptyString(command.npcId) ? command.npcId.trim() : existing?.npcId;
  const npc = finalNpcId
    ? state.npcs.find((item) => item.npcId === finalNpcId)
    : undefined;
  if (finalNpcId && !npc) {
    errors.push(`upsertHeroineThread.npcId does not exist: ${finalNpcId}`);
  } else if (npc) {
    const age = deriveNpcCurrentAge(npc, state.currentDate);
    if (age === undefined || age < 18) {
      errors.push('upsertHeroineThread.npcId must reference an adult NPC.');
    }
  }
  if (!finalNpcId && existing) {
    errors.push('upsertHeroineThread.npcId must reference an adult NPC.');
  }

  for (const field of ['currentPull', 'riskNotes', 'promiseNotes', 'recentProgress', 'source'] as const) {
    validateOptionalString(command[field], `upsertHeroineThread.${field}`, errors);
  }
  validateOptionalStringList(command.tags, 'upsertHeroineThread.tags', errors);
  validateRelationshipMilestones(command.milestones, 'upsertHeroineThread.milestones', errors);
}

function validateUpsertBondThreadCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: BondThreadUpsertCommand,
  errors: string[],
): void {
  const bondThreadId = canonicalRelationshipStableKey(command.bondThreadId);
  const lookup = validatePersistedRelationshipCollection<BondThreadEntry>(
    state.bondThreads,
    'bondThreads',
    'bondThreadId',
    bondThreadId,
    errors,
    (entry, fieldName) => validatePersistedBondThreadShape(state, entry, fieldName, errors),
  );
  if (!lookup.valid) return;
  const existing = lookup.existing;

  if (!bondThreadId) {
    errors.push('upsertBondThread.bondThreadId cannot be empty.');
  }
  if ((!existing || command.summary !== undefined) && !isNonEmptyString(command.summary)) {
    errors.push('upsertBondThread.summary cannot be empty.');
  }
  validateManagedRelationshipUpdatedAt(command.lastUpdatedAt, 'upsertBondThread.lastUpdatedAt', errors);

  if ((!existing || command.bondType !== undefined) && !bondThreadTypes.includes(command.bondType as BondThreadEntry['bondType'])) {
    errors.push(`upsertBondThread.bondType is invalid: ${String(command.bondType)}`);
  }
  if ((!existing || command.status !== undefined) && !bondThreadStatuses.includes(command.status as BondThreadEntry['status'])) {
    errors.push(`upsertBondThread.status is invalid: ${String(command.status)}`);
  }

  if (!existing || command.targetNames !== undefined) {
    validateStringListOrString(command.targetNames, 'upsertBondThread.targetNames', errors);
  }
  const hasTargetNpcIdsPatch = Object.prototype.hasOwnProperty.call(command, 'targetNpcIds')
    && command.targetNpcIds !== undefined;
  const finalTargetNpcIds = hasTargetNpcIdsPatch
    ? command.targetNpcIds === null
      ? undefined
      : cleanStringListInput(command.targetNpcIds)
    : existing?.targetNpcIds;
  const finalTargetNames = command.targetNames !== undefined
    ? cleanStringListInput(command.targetNames)
    : existing?.targetNames ?? [];
  if ((!existing && command.targetNames === undefined) || (!finalTargetNpcIds?.length && finalTargetNames.length === 0)) {
    errors.push('upsertBondThread.targetNames cannot be empty.');
  }
  validateOptionalStringList(command.targetNpcIds, 'upsertBondThread.targetNpcIds', errors);
  if (existing?.targetNpcIds?.length && Array.isArray(command.targetNpcIds) && finalTargetNpcIds?.length === 0) {
    errors.push('upsertBondThread.targetNpcIds must use null to switch from NPC ids to name-only mode.');
  }
  if (finalTargetNpcIds?.length) {
    for (const targetNpcId of finalTargetNpcIds) {
      if (!state.npcs.some((npc) => npc.npcId === targetNpcId)) {
        errors.push(`upsertBondThread.targetNpcIds does not exist: ${targetNpcId}`);
      }
    }
  }
  for (const field of ['currentTension', 'promiseNotes', 'conflictNotes', 'recentProgress', 'source'] as const) {
    validateOptionalString(command[field], `upsertBondThread.${field}`, errors);
  }
  validateOptionalStringList(command.tags, 'upsertBondThread.tags', errors);
  validateRelationshipMilestones(command.milestones, 'upsertBondThread.milestones', errors);
}

function validateEngineManagedUpdatedAt(
  value: unknown,
  fieldName: string,
  errors: string[],
): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' && value.trim().length === 0) return;
  validateOptionalString(value, fieldName, errors);
}

function validatePersistedRelationshipCollection<T>(
  collectionValue: unknown,
  collectionName: string,
  idField: string,
  targetId: string,
  errors: string[],
  validateEntry: (entry: T, fieldName: string) => boolean,
): { valid: boolean; existing?: T; index?: number } {
  if (!Array.isArray(collectionValue)) {
    errors.push(`${collectionName} must be an array before applying a relationship command.`);
    return { valid: false };
  }

  let valid = true;
  let existing: T | undefined;
  let existingIndex: number | undefined;
  const firstIndexById = new Map<string, number>();
  collectionValue.forEach((entry, index) => {
    const fieldName = `${collectionName}[${index}]`;
    if (!isPlainRelationshipRecord(entry)) {
      errors.push(`${fieldName} must be an object before applying a relationship command.`);
      valid = false;
      return;
    }
    const stableId = canonicalRelationshipStableKey(entry[idField]);
    if (!stableId) {
      errors.push(`${fieldName}.${idField} cannot be empty.`);
      valid = false;
      return;
    }

    const firstIndex = firstIndexById.get(stableId);
    if (firstIndex !== undefined) {
      errors.push(`${fieldName}.${idField} is duplicate: ${stableId}; first defined at ${collectionName}[${firstIndex}].${idField}.`);
      valid = false;
    } else {
      firstIndexById.set(stableId, index);
    }

    if (!validateEntry(entry as T, fieldName)) {
      valid = false;
    }

    if (targetId && stableId === targetId && existing === undefined) {
      existing = entry as T;
      existingIndex = index;
    }
  });

  return { valid, existing, index: existingIndex };
}

function validatePersistedHeroineThreadShape(
  state: ReturnType<typeof ensureLuanShiState>,
  entry: HeroineThreadEntry,
  fieldName: string,
  errors: string[],
): boolean {
  const startErrorCount = errors.length;
  const record = entry as unknown as Record<string, unknown>;
  validatePersistedRequiredStrings(
    record,
    ['heroineThreadId', 'npcId', 'npcName', 'stage', 'relationshipRole', 'summary', 'lastUpdatedAt'],
    fieldName,
    errors,
  );
  if (!heroineThreadStatuses.includes(record.status as HeroineThreadEntry['status'])) {
    errors.push(`${fieldName}.status is invalid: ${String(record.status)}`);
  }
  validatePersistedOptionalStrings(record, ['currentPull', 'riskNotes', 'promiseNotes', 'recentProgress', 'source'], fieldName, errors);
  validatePersistedStringArray(record.tags, `${fieldName}.tags`, errors, true);
  validatePersistedRelationshipMilestones(record.milestones, `${fieldName}.milestones`, errors);
  if (isNonEmptyString(record.npcId)) {
    const npcId = record.npcId.trim();
    const npc = state.npcs.find((item) => item.npcId === npcId);
    if (!npc) {
      errors.push(`${fieldName}.npcId does not exist: ${npcId}`);
    } else {
      const age = deriveNpcCurrentAge(npc, state.currentDate);
      if (age === undefined || age < 18) {
        errors.push(`${fieldName}.npcId must reference an adult NPC: ${npcId}`);
      }
    }
  }
  return errors.length === startErrorCount;
}

function validatePersistedBondThreadShape(
  state: ReturnType<typeof ensureLuanShiState>,
  entry: BondThreadEntry,
  fieldName: string,
  errors: string[],
): boolean {
  const startErrorCount = errors.length;
  const record = entry as unknown as Record<string, unknown>;
  validatePersistedRequiredStrings(record, ['bondThreadId', 'summary', 'lastUpdatedAt'], fieldName, errors);
  if (!bondThreadTypes.includes(record.bondType as BondThreadEntry['bondType'])) {
    errors.push(`${fieldName}.bondType is invalid: ${String(record.bondType)}`);
  }
  if (!bondThreadStatuses.includes(record.status as BondThreadEntry['status'])) {
    errors.push(`${fieldName}.status is invalid: ${String(record.status)}`);
  }
  validatePersistedStringArray(record.targetNames, `${fieldName}.targetNames`, errors, false);
  validatePersistedStringArray(record.targetNpcIds, `${fieldName}.targetNpcIds`, errors, true);
  validatePersistedOptionalStrings(record, ['currentTension', 'promiseNotes', 'conflictNotes', 'recentProgress', 'source'], fieldName, errors);
  validatePersistedStringArray(record.tags, `${fieldName}.tags`, errors, true);
  validatePersistedRelationshipMilestones(record.milestones, `${fieldName}.milestones`, errors);
  const hasPersistedTargetNpcIds = Array.isArray(record.targetNpcIds) && record.targetNpcIds.length > 0;
  if (!hasPersistedTargetNpcIds && Array.isArray(record.targetNames) && !record.targetNames.some(isNonEmptyString)) {
    errors.push(`${fieldName}.targetNames cannot be empty.`);
  }
  if (Array.isArray(record.targetNpcIds)) {
    record.targetNpcIds.forEach((targetNpcId, index) => {
      if (typeof targetNpcId === 'string' && !state.npcs.some((npc) => npc.npcId === targetNpcId)) {
        errors.push(`${fieldName}.targetNpcIds[${index}] does not exist: ${targetNpcId}`);
      }
    });
  }
  return errors.length === startErrorCount;
}

function validatePersistedRequiredStrings(
  record: Record<string, unknown>,
  fields: readonly string[],
  fieldName: string,
  errors: string[],
): void {
  for (const field of fields) {
    if (!isNonEmptyString(record[field])) errors.push(`${fieldName}.${field} cannot be empty.`);
  }
}

function validatePersistedOptionalStrings(
  record: Record<string, unknown>,
  fields: readonly string[],
  fieldName: string,
  errors: string[],
): void {
  for (const field of fields) {
    if (record[field] !== undefined && typeof record[field] !== 'string') {
      errors.push(`${fieldName}.${field} must be a string when present.`);
    }
  }
}

function validatePersistedStringArray(
  value: unknown,
  fieldName: string,
  errors: string[],
  optional: boolean,
): void {
  if (value === undefined && optional) return;
  if (!Array.isArray(value)) {
    errors.push(`${fieldName} must be an array.`);
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string') errors.push(`${fieldName}[${index}] must be a string.`);
  });
}

function validatePersistedRelationshipMilestones(value: unknown, fieldName: string, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${fieldName} must be an array.`);
    return;
  }
  value.forEach((item, index) => {
    if (!isPlainRelationshipRecord(item)) {
      errors.push(`${fieldName}[${index}] must be an object.`);
      return;
    }
    for (const field of ['milestoneId', 'happenedAt', 'summary'] as const) {
      if (!isNonEmptyString(item[field])) errors.push(`${fieldName}[${index}].${field} cannot be empty.`);
    }
    if (item.source !== undefined && typeof item.source !== 'string') {
      errors.push(`${fieldName}[${index}].source must be a string when present.`);
    }
  });
}

function isPlainRelationshipRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateRelationshipMilestones(value: unknown, fieldName: string, errors: string[]): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    errors.push(`${fieldName} must be an array.`);
    return;
  }

  value.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${fieldName}[${index}] must be an object.`);
      return;
    }

    const milestone = item as { milestoneId?: unknown; happenedAt?: unknown; summary?: unknown; source?: unknown };
    for (const field of ['milestoneId', 'happenedAt', 'summary'] as const) {
      if (!isNonEmptyString(milestone[field])) {
        errors.push(`${fieldName}[${index}].${field} cannot be empty.`);
      }
    }
    validateOptionalString(milestone.source, `${fieldName}[${index}].source`, errors);
  });
}

function validateManagedRelationshipUpdatedAt(value: unknown, fieldName: string, errors: string[]): void {
  if (value === undefined) return;
  if (value === null || typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${fieldName} must be a non-empty string when provided and cannot be null.`);
  }
}

function validateCombatParticipants(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('upsertCombatRecord.participants must contain at least one participant.');
    return;
  }

  value.forEach((participant, index) => {
    if (!participant || typeof participant !== 'object' || Array.isArray(participant)) {
      errors.push(`upsertCombatRecord.participants[${index}] must be an object.`);
      return;
    }
    const item = participant as CombatRecord['participants'][number];
    if (!isNonEmptyString(item.name)) {
      errors.push(`upsertCombatRecord.participants[${index}].name cannot be empty.`);
    }
    if (!combatParticipantSides.includes(item.side)) {
      errors.push(`upsertCombatRecord.participants[${index}].side is invalid: ${String(item.side)}`);
    }
    for (const field of ['participantId', 'npcId', 'role', 'outcome'] as const) {
      validateOptionalString(item[field], `upsertCombatRecord.participants[${index}].${field}`, errors);
    }
    if (item.reputationFame !== undefined) {
      if (typeof item.reputationFame !== 'number' || !Number.isFinite(item.reputationFame) || item.reputationFame < 0 || item.reputationFame > 100) {
        errors.push(`upsertCombatRecord.participants[${index}].reputationFame must be a number from 0 to 100.`);
      }
    }
  });
}

function validateCombatOutcomeTags(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('upsertCombatRecord.outcomeTags must be an array.');
    return;
  }
  value.forEach((tag, index) => {
    if (!combatOutcomeTags.includes(tag as NonNullable<CombatRecord['outcomeTags']>[number])) {
      errors.push(`upsertCombatRecord.outcomeTags[${index}] is invalid: ${String(tag)}`);
    }
  });
}

function validateCombatJudgement(value: CombatRecord['judgement'], errors: string[]): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('upsertCombatRecord.judgement must be an object.');
    return;
  }
  if (value.method !== 'combatJudgementV1') {
    errors.push(`upsertCombatRecord.judgement.method must be combatJudgementV1, received ${String(value.method)}.`);
  }
  validateOptionalString(value.perspectiveSide, 'upsertCombatRecord.judgement.perspectiveSide', errors);
  validateOptionalString(value.underdogReason, 'upsertCombatRecord.judgement.underdogReason', errors);
  validateOptionalString(value.decisiveMoment, 'upsertCombatRecord.judgement.decisiveMoment', errors);
  if (value.advantageBand !== undefined && !conflictAdvantageBands.includes(value.advantageBand)) {
    errors.push(`upsertCombatRecord.judgement.advantageBand is invalid: ${String(value.advantageBand)}`);
  }

  const scoreBreakdown = value.scoreBreakdown;
  if (scoreBreakdown === undefined) return;
  if (!scoreBreakdown || typeof scoreBreakdown !== 'object' || Array.isArray(scoreBreakdown)) {
    errors.push('upsertCombatRecord.judgement.scoreBreakdown must be an object.');
    return;
  }
  for (const field of combatScoreFields) {
    validateOptionalBoundedNumber(
      scoreBreakdown[field],
      `upsertCombatRecord.judgement.scoreBreakdown.${field}`,
      errors,
      200,
    );
  }
  validateOptionalStringList(scoreBreakdown.notes, 'upsertCombatRecord.judgement.scoreBreakdown.notes', errors);
}

function validateUpdateCharacterReputationCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: CharacterReputationUpdateCommand,
  errors: string[],
): void {
  if (!isNonEmptyString(command.characterId)) {
    errors.push('updateCharacterReputation.characterId cannot be empty.');
    return;
  }

  const isPlayerTarget = command.characterType === 'player'
    || command.characterId === 'player'
    || command.characterId === state.player.id;
  const npc = isPlayerTarget ? undefined : state.npcs.find((item) => item.npcId === command.characterId);

  if (command.characterType !== undefined && !['player', 'npc'].includes(command.characterType)) {
    errors.push(`updateCharacterReputation.characterType is invalid: ${String(command.characterType)}`);
  }
  if (!isPlayerTarget && !npc) {
    errors.push(`updateCharacterReputation.characterId does not exist: ${command.characterId}`);
  }
  if (isPlayerTarget && command.characterName && command.characterName !== state.player.name) {
    errors.push(`updateCharacterReputation.characterName does not match player: expected ${state.player.name}, received ${command.characterName}`);
  }
  if (npc && command.characterName && command.characterName !== npc.name) {
    errors.push(`updateCharacterReputation.characterName does not match npc: expected ${npc.name}, received ${command.characterName}`);
  }

  const hasUpdate = ['moralityDelta', 'fameDelta', 'tags', 'summary'].some((field) =>
    Object.prototype.hasOwnProperty.call(command, field),
  );
  if (!hasUpdate) {
    errors.push('updateCharacterReputation requires at least one reputation field.');
  }
  validateOptionalBoundedNumber(command.moralityDelta, 'updateCharacterReputation.moralityDelta', errors, 100);
  validateOptionalBoundedNumber(command.fameDelta, 'updateCharacterReputation.fameDelta', errors, 100);
  validateOptionalString(command.summary, 'updateCharacterReputation.summary', errors);
  validateOptionalString(command.updatedAt, 'updateCharacterReputation.updatedAt', errors);
  validateReputationTags(command.tags, errors);
}

function validateReputationTags(value: CharacterReputationUpdateCommand['tags'], errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('updateCharacterReputation.tags must be an array.');
    return;
  }
  value.forEach((tag, index) => {
    if (!tag || typeof tag !== 'object' || Array.isArray(tag)) {
      errors.push(`updateCharacterReputation.tags[${index}] must be an object.`);
      return;
    }
    if (!isNonEmptyString(tag.label)) {
      errors.push(`updateCharacterReputation.tags[${index}].label cannot be empty.`);
    }
    if (!isNonEmptyString(tag.source)) {
      errors.push(`updateCharacterReputation.tags[${index}].source cannot be empty.`);
    }
  });
}

function validateUpsertNpcProfileCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: NpcProfileUpsertCommand,
  errors: string[],
): void {
  const requiredStringFields = [
    ['npcId', command.npcId],
    ['name', command.name],
    ['role', command.role],
    ['locationId', command.locationId],
    ['currentIdentity', command.currentIdentity],
    ['summary', command.summary],
    ['appearance', command.appearance],
    ['personality', command.personality],
    ['motivation', command.motivation],
    ['relationToPlayer', command.relationToPlayer],
    ['recentAttitude', command.recentAttitude],
  ] as const;

  for (const [field, value] of requiredStringFields) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push(`upsertNpcProfile.${field} 不能为空。`);
    }
  }

  const existingNpc = state.npcs.find((npc) => npc.npcId === command.npcId);
  if (existingNpc && existingNpc.name !== command.name) {
    errors.push(`npcName 与 npcId 不匹配：期望 ${existingNpc.name}，收到 ${command.name}`);
  }

  if (isProtagonistNpcClone(state, command)) {
    errors.push(PROTAGONIST_NPC_REJECTION_MESSAGE);
  }

  if (!npcSexes.includes(command.sex)) {
    errors.push(`upsertNpcProfile.sex 非法：${String(command.sex)}`);
  }

  if (!Number.isInteger(command.age) || command.age <= 0) {
    errors.push('upsertNpcProfile.age 必须是大于 0 的整数。');
  }

  for (const field of ['birthDate', 'ageKnownAtDate'] as const) {
    const value = command[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      errors.push(`upsertNpcProfile.${field} 必须是字符串或 null。`);
    }
  }

  if (typeof command.isPresent !== 'boolean') {
    errors.push('upsertNpcProfile.isPresent 必须是布尔值。');
  }

  if (typeof command.isFocused !== 'boolean') {
    errors.push('upsertNpcProfile.isFocused 必须是布尔值。');
  }

  if (typeof command.contactLevel !== 'number' || !Number.isFinite(command.contactLevel) || command.contactLevel < 0) {
    errors.push('upsertNpcProfile.contactLevel 必须是大于等于 0 的数字。');
  }

  validateNpcAbilityScores(command.abilityScores, errors);
  validateNpcTraits(command.traits, errors);

  if (command.uniqueArts !== undefined) {
    validateUniqueArtList(command.uniqueArts, 'upsertNpcProfile.uniqueArts', errors, { allowEmpty: true });
  }

  if (command.effects !== undefined) {
    if (!Array.isArray(command.effects)) {
      errors.push('upsertNpcProfile.effects 必须是状态数组。');
    } else {
      command.effects.forEach((effect, index) => validateNpcEffect(effect, index, errors));
    }
  }

  if (command.equipment !== undefined) {
    if (!Array.isArray(command.equipment)) {
      errors.push('upsertNpcProfile.equipment 必须是装备数组。');
    } else {
      command.equipment.forEach((item, index) => validateEquipmentItem(item, index, errors, 'upsertNpcProfile.equipment'));
    }
  }

  if (command.inventory !== undefined) {
    if (!Array.isArray(command.inventory)) {
      errors.push('upsertNpcProfile.inventory 必须是物品数组。');
    } else {
      command.inventory.forEach((item, index) => validateInventoryItem(item, index, errors, 'upsertNpcProfile.inventory'));
    }
  }

  if (command.vitals !== undefined) {
    const vitals = command.vitals;
    const fields = ['hp', 'maxHp', 'stamina', 'maxStamina'] as const;
    for (const field of fields) {
      if (typeof vitals[field] !== 'number' || !Number.isFinite(vitals[field]) || vitals[field] < 0) {
        errors.push(`upsertNpcProfile.vitals.${field} 必须是大于等于 0 的数字。`);
      }
    }
  }
}

function validateNpcPresenceUpdateCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: NpcPresenceUpdateCommand,
  errors: string[],
): void {
  const npcId = typeof command.npcId === 'string' ? command.npcId.trim() : '';
  const locationId = typeof command.locationId === 'string' ? command.locationId.trim() : '';

  if (!npcId) errors.push('updateNpcPresence.npcId 不能为空。');
  if (npcId && !state.npcs.some((npc) => npc.npcId === npcId)) {
    errors.push(`updateNpcPresence.npcId 未匹配已有 NPC：${npcId}`);
  }
  if (!locationId) errors.push('updateNpcPresence.locationId 不能为空。');
  if (typeof command.isPresent !== 'boolean') {
    errors.push('updateNpcPresence.isPresent 必须是布尔值。');
  }
  if (command.isFocused !== undefined && typeof command.isFocused !== 'boolean') {
    errors.push('updateNpcPresence.isFocused 必须是布尔值。');
  }
}

const npcBackgroundActivityStatuses = ['planned', 'active', 'blocked', 'completed', 'cancelled'] as const;
const npcBackgroundActivitySources = ['narrative', 'quest', 'plot', 'worldTrend', 'conflict', 'system'] as const;
const npcBackgroundActivityVisibilities = ['hidden', 'playerKnown', 'public'] as const;

function validateNpcBackgroundActivityUpdateCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: NpcBackgroundActivityUpdateCommand,
  errors: string[],
): void {
  const npcId = typeof command.npcId === 'string' ? command.npcId.trim() : '';
  if (!npcId) errors.push('updateNpcBackgroundActivity.npcId 不能为空。');
  if (npcId && !state.npcs.some((npc) => npc.npcId === npcId)) {
    errors.push(`updateNpcBackgroundActivity.npcId 未匹配已有 NPC：${npcId}`);
  }

  if (command.activity === null) return;
  if (!command.activity || typeof command.activity !== 'object' || Array.isArray(command.activity)) {
    errors.push('updateNpcBackgroundActivity.activity 必须是对象或 null。');
    return;
  }

  const activity = command.activity;
  if (!isNonEmptyString(activity.activityId)) {
    errors.push('updateNpcBackgroundActivity.activity.activityId 不能为空。');
  }
  if (!isNonEmptyString(activity.summary)) {
    errors.push('updateNpcBackgroundActivity.activity.summary 不能为空。');
  }
  if (!npcBackgroundActivityStatuses.includes(activity.status as typeof npcBackgroundActivityStatuses[number])) {
    errors.push(`updateNpcBackgroundActivity.activity.status 非法：${String(activity.status)}`);
  }

  for (const field of ['locationId', 'startedAt', 'dueAt', 'lastEvaluatedAt'] as const) {
    const value = activity[field];
    if (value !== undefined && !isNonEmptyString(value)) {
      errors.push(`updateNpcBackgroundActivity.activity.${field} 必须是非空字符串。`);
    }
  }
  if (
    activity.sourceType !== undefined
    && !npcBackgroundActivitySources.includes(activity.sourceType)
  ) {
    errors.push(`updateNpcBackgroundActivity.activity.sourceType 非法：${String(activity.sourceType)}`);
  }
  if (
    activity.visibility !== undefined
    && !npcBackgroundActivityVisibilities.includes(activity.visibility)
  ) {
    errors.push(`updateNpcBackgroundActivity.activity.visibility 非法：${String(activity.visibility)}`);
  }
  if (activity.sourceIds !== undefined) {
    if (!Array.isArray(activity.sourceIds) || activity.sourceIds.some((value) => !isNonEmptyString(value))) {
      errors.push('updateNpcBackgroundActivity.activity.sourceIds 必须是非空字符串数组。');
    }
  }
}

function validateNpcAbilityScores(value: unknown, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('upsertNpcProfile.abilityScores 必须是对象，并包含完整六维。');
    return;
  }

  const scores = value as Record<string, unknown>;
  for (const abilityName of requiredNpcAbilityNames) {
    const score = scores[abilityName];
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      errors.push(`upsertNpcProfile.abilityScores 缺少有效六维：${abilityName}`);
    }
  }
}

function validateNpcTraits(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('upsertNpcProfile.traits 至少需要 1 条特质；普通 NPC 通常 1-2 条，历史重点人物可更多。');
    return;
  }

  value.forEach((trait, index) => {
    if (!trait || typeof trait !== 'object') {
      errors.push(`upsertNpcProfile.traits[${index}] 必须是对象。`);
      return;
    }

    const item = trait as CharacterTrait;
    if (!item.id?.trim()) errors.push(`upsertNpcProfile.traits[${index}].id 不能为空。`);
    if (!item.label?.trim()) errors.push(`upsertNpcProfile.traits[${index}].label 不能为空。`);
    if (!item.description?.trim()) errors.push(`upsertNpcProfile.traits[${index}].description 不能为空。`);
    if (typeof item.source !== 'string' || item.source.trim().length === 0) {
      errors.push(`upsertNpcProfile.traits[${index}].source 不能为空。`);
    }
    validateCheckHooks(item.checkHooks, `upsertNpcProfile.traits[${index}].checkHooks`, errors);
  });
}

function validateNpcEffect(effect: CharacterEffect, index: number, errors: string[]): void {
  if (!effect || typeof effect !== 'object') {
    errors.push(`upsertNpcProfile.effects[${index}] 必须是对象。`);
    return;
  }

  if (!effect.id?.trim()) errors.push(`upsertNpcProfile.effects[${index}].id 不能为空。`);
  if (!effect.label?.trim()) errors.push(`upsertNpcProfile.effects[${index}].label 不能为空。`);
  if (!['buff', 'debuff', 'mixed'].includes(effect.type)) {
    errors.push(`upsertNpcProfile.effects[${index}].type 非法：${String(effect.type)}`);
  }
  if (!['short', 'long', 'until_resolved'].includes(effect.duration)) {
    errors.push(`upsertNpcProfile.effects[${index}].duration 非法：${String(effect.duration)}`);
  }
  if (!effect.description?.trim()) errors.push(`upsertNpcProfile.effects[${index}].description 不能为空。`);
  if (!effect.source?.trim()) errors.push(`upsertNpcProfile.effects[${index}].source 不能为空。`);
  validateCheckHooks(effect.checkHooks, `upsertNpcProfile.effects[${index}].checkHooks`, errors);
}

function validateUpdatePlayerTraitsCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: PlayerTraitsUpdateCommand,
  errors: string[],
): void {
  const characterId = command.characterId?.trim();
  if (characterId && characterId !== 'player' && characterId !== state.player.id) {
    errors.push(`updatePlayerTraits can only target the player, received characterId: ${characterId}`);
  }

  if (command.characterName && command.characterName !== state.player.name) {
    errors.push(`updatePlayerTraits.characterName does not match player: expected ${state.player.name}, received ${command.characterName}`);
  }

  validatePlayerTraitList(command.traits, errors);

  if (command.summary !== undefined && typeof command.summary !== 'string') {
    errors.push('updatePlayerTraits.summary must be a string.');
  }
}

function validatePlayerTraitList(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('updatePlayerTraits.traits requires at least one trait.');
    return;
  }

  value.forEach((trait, index) => {
    if (!trait || typeof trait !== 'object') {
      errors.push(`updatePlayerTraits.traits[${index}] must be an object.`);
      return;
    }

    const item = trait as CharacterTrait;
    if (!item.id?.trim()) errors.push(`updatePlayerTraits.traits[${index}].id cannot be empty.`);
    if (!item.label?.trim()) errors.push(`updatePlayerTraits.traits[${index}].label cannot be empty.`);
    if (!item.description?.trim()) errors.push(`updatePlayerTraits.traits[${index}].description cannot be empty.`);
    if (typeof item.source !== 'string' || item.source.trim().length === 0) {
      errors.push(`updatePlayerTraits.traits[${index}].source cannot be empty.`);
    }
    if (!traitRarities.includes(item.rarity as CharacterTraitRarity)) {
      errors.push(`updatePlayerTraits.traits[${index}].rarity must be one of white/green/blue/red/gold.`);
    }
    validateCheckHooks(item.checkHooks, `updatePlayerTraits.traits[${index}].checkHooks`, errors);
  });
}

function validateUpdateCharacterUniqueArtsCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: CharacterUniqueArtsUpdateCommand,
  errors: string[],
): void {
  if (command.characterType !== 'player' && command.characterType !== 'npc') {
    errors.push('updateCharacterUniqueArts.characterType must be player or npc.');
    return;
  }

  const characterId = command.characterId?.trim();
  const characterName = command.characterName?.trim();

  if (command.characterType === 'player') {
    if (characterId && characterId !== 'player' && characterId !== state.player.id) {
      errors.push(`updateCharacterUniqueArts can only target player ${state.player.id}, received characterId: ${characterId}`);
    }
    if (characterName && characterName !== state.player.name) {
      errors.push(`updateCharacterUniqueArts.characterName does not match player: expected ${state.player.name}, received ${characterName}`);
    }
  } else {
    if (!characterId && !characterName) {
      errors.push('updateCharacterUniqueArts for npc requires characterId or unique characterName.');
    } else if (characterId) {
      const npc = state.npcs.find((item) => item.npcId === characterId);
      if (!npc) {
        errors.push(`updateCharacterUniqueArts target npc not found: ${characterId}`);
      } else if (characterName && npc.name !== characterName) {
        errors.push(`updateCharacterUniqueArts.characterName does not match npcId ${characterId}: expected ${npc.name}, received ${characterName}`);
      }
    } else if (characterName) {
      const matches = state.npcs.filter((item) => item.name === characterName);
      if (matches.length === 0) {
        errors.push(`updateCharacterUniqueArts target npc not found by name: ${characterName}`);
      } else if (matches.length > 1) {
        errors.push(`updateCharacterUniqueArts target npc name is ambiguous: ${characterName}`);
      }
    }
  }

  validateUniqueArtList(command.uniqueArts, 'updateCharacterUniqueArts.uniqueArts', errors, { allowEmpty: true });

  for (const field of ['summary', 'updatedAt', 'source'] as const) {
    const value = command[field];
    if (value !== undefined && typeof value !== 'string') {
      errors.push(`updateCharacterUniqueArts.${field} must be a string.`);
    }
  }
}

function validateUniqueArtList(
  value: unknown,
  fieldName: string,
  errors: string[],
  options: { allowEmpty?: boolean } = {},
): void {
  if (!Array.isArray(value)) {
    errors.push(`${fieldName} must be an array.`);
    return;
  }

  if (value.length === 0 && !options.allowEmpty) {
    errors.push(`${fieldName} requires at least one unique art.`);
    return;
  }

  value.forEach((art, index) => {
    const prefix = `${fieldName}[${index}]`;
    if (!art || typeof art !== 'object') {
      errors.push(`${prefix} must be an object.`);
      return;
    }

    const item = art as CharacterUniqueArt;
    if (!item.id?.trim()) errors.push(`${prefix}.id cannot be empty.`);
    if (!item.name?.trim()) errors.push(`${prefix}.name cannot be empty.`);
    if (!item.description?.trim()) errors.push(`${prefix}.description cannot be empty.`);
    if (!item.effectSummary?.trim()) errors.push(`${prefix}.effectSummary cannot be empty.`);
    if (typeof item.source !== 'string' || item.source.trim().length === 0) {
      errors.push(`${prefix}.source cannot be empty.`);
    }
    if (!traitRarities.includes(item.rarity as CharacterTraitRarity)) {
      errors.push(`${prefix}.rarity must be one of white/green/blue/red/gold.`);
    }
    if (!uniqueArtDomains.includes(item.domain as CharacterUniqueArtDomain)) {
      errors.push(`${prefix}.domain is invalid.`);
    }
    if (!Number.isInteger(item.level) || item.level < 1 || item.level > 10) {
      errors.push(`${prefix}.level must be an integer from 1 to 10.`);
    }
    if (item.maxLevel !== undefined) {
      if (!Number.isInteger(item.maxLevel) || item.maxLevel < 1 || item.maxLevel > 10) {
        errors.push(`${prefix}.maxLevel must be an integer from 1 to 10.`);
      } else if (Number.isInteger(item.level) && item.maxLevel < item.level) {
        errors.push(`${prefix}.maxLevel cannot be lower than level.`);
      }
    }
    if (item.progress !== undefined && (typeof item.progress !== 'number' || !Number.isFinite(item.progress) || item.progress < 0 || item.progress > 100)) {
      errors.push(`${prefix}.progress must be a number from 0 to 100.`);
    }

    for (const field of ['acquiredAt', 'upgradedAt', 'promptHint'] as const) {
      const text = item[field];
      if (text !== undefined && typeof text !== 'string') {
        errors.push(`${prefix}.${field} must be a string.`);
      }
    }

    validateOptionalStringList(item.tags, `${prefix}.tags`, errors);
    validateOptionalStringList(item.relatedNpcIds, `${prefix}.relatedNpcIds`, errors);
    validateOptionalStringList(item.relatedFactionIds, `${prefix}.relatedFactionIds`, errors);
    validateCheckHooks(item.checkHooks, `${prefix}.checkHooks`, errors);
    item.checkHooks?.forEach((hook, hookIndex) => {
      if (typeof hook.modifier === 'number' && Number.isFinite(hook.modifier) && Math.abs(hook.modifier) > 30) {
        errors.push(`${prefix}.checkHooks[${hookIndex}].modifier must be between -30 and 30.`);
      }
    });
  });
}

function validateUpdatePlayerLoadoutCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: PlayerLoadoutUpdateCommand,
  errors: string[],
): void {
  const characterId = command.characterId?.trim();
  if (characterId && characterId !== 'player' && characterId !== state.player.id) {
    errors.push(`updatePlayerLoadout 只能写回主角行装，收到 characterId：${characterId}`);
  }

  if (command.characterName && command.characterName !== state.player.name) {
    errors.push(`characterName 与 player 不匹配：期望 ${state.player.name}，收到 ${command.characterName}`);
  }

  const hasLoadoutField = ['personalMoney', 'personalMoneyDelta', 'equipment', 'equipmentChanges', 'inventory', 'inventoryChanges', 'summary'].some((field) =>
    Object.prototype.hasOwnProperty.call(command, field),
  );
  if (!hasLoadoutField) {
    errors.push('updatePlayerLoadout 至少需要一个行装字段。');
  }

  if (command.personalMoney !== undefined) {
    if (typeof command.personalMoney !== 'number' || !Number.isFinite(command.personalMoney) || command.personalMoney < 0) {
      errors.push('updatePlayerLoadout.personalMoney 必须是大于等于 0 的数字。');
    }
  }

  if (command.personalMoney !== undefined && command.personalMoneyDelta !== undefined) {
    errors.push('updatePlayerLoadout.personalMoney 与 personalMoneyDelta 不能同时提供。');
  }

  if (command.personalMoneyDelta !== undefined) {
    if (typeof command.personalMoneyDelta !== 'number' || !Number.isFinite(command.personalMoneyDelta)) {
      errors.push('updatePlayerLoadout.personalMoneyDelta 必须是 finite number。');
    } else {
      const currentMoney = typeof state.player?.personalMoney === 'number' && Number.isFinite(state.player.personalMoney)
        ? state.player.personalMoney
        : null;
      if (currentMoney !== null && currentMoney + command.personalMoneyDelta < 0) {
        errors.push('updatePlayerLoadout.personalMoneyDelta 会导致个人钱财余额不足。');
      }
    }
  }

  if (command.equipment !== undefined) {
    if (!Array.isArray(command.equipment)) {
      errors.push('updatePlayerLoadout.equipment 必须是装备数组。');
    } else {
      command.equipment.forEach((item, index) => validateEquipmentItem(item, index, errors));
    }
  }

  if (command.equipmentChanges !== undefined) {
    validateEquipmentChanges(command.equipmentChanges, errors);
  }

  if (command.inventory !== undefined) {
    if (!Array.isArray(command.inventory)) {
      errors.push('updatePlayerLoadout.inventory 必须是物品数组。');
    } else {
      command.inventory.forEach((item, index) => validateInventoryItem(item, index, errors));
    }
  }

  if (command.inventoryChanges !== undefined) {
    validateInventoryChanges(
      command.inventoryChanges,
      errors,
      'updatePlayerLoadout.inventoryChanges',
      Array.isArray(command.inventory) ? command.inventory : state.player?.inventory,
    );
  }

  if (command.summary !== undefined && typeof command.summary !== 'string') {
    errors.push('updatePlayerLoadout.summary 必须是字符串。');
  }
}

function validateUpdateNpcLoadoutCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: NpcLoadoutUpdateCommand,
  errors: string[],
): void {
  const npcId = typeof command.npcId === 'string' ? command.npcId.trim() : '';
  const npcName = typeof command.npcName === 'string' ? command.npcName.trim() : '';
  const npc = state.npcs.find((entry) => entry.npcId === npcId);

  if (!npcId) errors.push('updateNpcLoadout.npcId 不能为空。');
  if (!npcName) errors.push('updateNpcLoadout.npcName 不能为空。');
  if (npcId && !npc) errors.push(`updateNpcLoadout.npcId 未匹配已有 NPC：${npcId}`);
  if (npc && npcName && npc.name !== npcName) {
    errors.push(`updateNpcLoadout.npcName 与 NPC 不匹配：期望 ${npc.name}，收到 ${command.npcName}`);
  }

  const hasLoadoutField = ['equipment', 'equipmentChanges', 'inventory', 'inventoryChanges', 'summary'].some((field) =>
    Object.prototype.hasOwnProperty.call(command, field),
  );
  if (!hasLoadoutField) errors.push('updateNpcLoadout 至少需要一个行装字段。');

  if (command.equipment !== undefined) {
    if (!Array.isArray(command.equipment)) {
      errors.push('updateNpcLoadout.equipment 必须是装备数组。');
    } else {
      command.equipment.forEach((item, index) => validateEquipmentItem(item, index, errors, 'updateNpcLoadout.equipment'));
    }
  }

  if (command.equipmentChanges !== undefined) {
    validateEquipmentChanges(command.equipmentChanges, errors, 'updateNpcLoadout.equipmentChanges', {
      allowEquipFromInventory: false,
    });
  }

  if (command.inventory !== undefined) {
    if (!Array.isArray(command.inventory)) {
      errors.push('updateNpcLoadout.inventory 必须是物品数组。');
    } else {
      command.inventory.forEach((item, index) => validateInventoryItem(item, index, errors, 'updateNpcLoadout.inventory'));
    }
  }

  if (command.inventoryChanges !== undefined) {
    validateInventoryChanges(
      command.inventoryChanges,
      errors,
      'updateNpcLoadout.inventoryChanges',
      Array.isArray(command.inventory) ? command.inventory : npc?.inventory,
    );
  }

  if (command.summary !== undefined && typeof command.summary !== 'string') {
    errors.push('updateNpcLoadout.summary 必须是字符串。');
  }
  if (command.updatedAt !== undefined && typeof command.updatedAt !== 'string') {
    errors.push('updateNpcLoadout.updatedAt 必须是字符串。');
  }
  if (command.source !== undefined && typeof command.source !== 'string') {
    errors.push('updateNpcLoadout.source 必须是字符串。');
  }
}

function validateEquipmentChanges(
  changes: PlayerEquipmentChange[] | NpcEquipmentChange[],
  errors: string[],
  fieldPrefix = 'updatePlayerLoadout.equipmentChanges',
  options: { allowEquipFromInventory: boolean } = { allowEquipFromInventory: true },
): void {
  if (!Array.isArray(changes)) {
    errors.push(`${fieldPrefix} 必须是数组。`);
    return;
  }
  changes.forEach((change, index) => {
    const fieldName = `${fieldPrefix}[${index}]`;
    if (!change || typeof change !== 'object') {
      errors.push(`${fieldName} 必须是对象。`);
      return;
    }
    if (options.allowEquipFromInventory && change.action === 'equipFromInventory') {
      if (!change.itemId?.trim()) errors.push(`${fieldName}.itemId 不能为空。`);
      if (change.slot !== undefined && !EQUIPMENT_SLOTS.includes(change.slot)) {
        errors.push(`${fieldName}.slot 非法：${String(change.slot)}`);
      }
      if (change.treasureIndex !== undefined && (!Number.isInteger(change.treasureIndex) || change.treasureIndex < 0 || change.treasureIndex > 2)) {
        errors.push(`${fieldName}.treasureIndex 必须是 0-2 的整数。`);
      }
      return;
    }
    if (change.action === 'upsert') {
      validateEquipmentItemAtPath(change.item, `${fieldName}.item`, errors);
      if (change.treasureIndex !== undefined && (!Number.isInteger(change.treasureIndex) || change.treasureIndex < 0 || change.treasureIndex > 2)) {
        errors.push(`${fieldName}.treasureIndex 必须是 0-2 的整数。`);
      }
      return;
    }
    if (change.action === 'remove' || change.action === 'unequip') {
      if (!change.equipmentId?.trim()) errors.push(`${fieldName}.equipmentId 不能为空。`);
      return;
    }
    errors.push(`${fieldName}.action 非法：${String((change as { action?: unknown }).action)}`);
  });
}

function validateInventoryChanges(
  changes: PlayerInventoryChange[] | NpcInventoryChange[],
  errors: string[],
  fieldPrefix = 'updatePlayerLoadout.inventoryChanges',
  baseInventory?: InventoryItem[],
): void {
  if (!Array.isArray(changes)) {
    errors.push(`${fieldPrefix} 必须是数组。`);
    return;
  }
  const hasInventoryContext = Array.isArray(baseInventory);
  const quantitiesById = new Map<string, number>();
  for (const item of baseInventory ?? []) {
    const itemId = typeof item?.id === 'string' ? item.id.trim() : '';
    if (!itemId || !Number.isFinite(item.quantity) || item.quantity <= 0) continue;
    quantitiesById.set(itemId, Math.max(1, Math.floor(item.quantity)));
  }

  changes.forEach((change, index) => {
    const fieldName = `${fieldPrefix}[${index}]`;
    if (!change || typeof change !== 'object') {
      errors.push(`${fieldName} 必须是对象。`);
      return;
    }
    if (change.action === 'upsert') {
      validateInventoryItemAtPath(change.item, `${fieldName}.item`, errors);
      const itemId = typeof change.item?.id === 'string' ? change.item.id.trim() : '';
      if (itemId && Number.isFinite(change.item.quantity) && change.item.quantity > 0) {
        quantitiesById.set(itemId, Math.max(1, Math.floor(change.item.quantity)));
      }
      return;
    }
    if (change.action === 'remove') {
      const itemId = change.itemId?.trim();
      if (!itemId) errors.push(`${fieldName}.itemId 不能为空。`);
      const quantityValid = change.quantity === undefined || (Number.isFinite(change.quantity) && change.quantity > 0);
      if (!quantityValid) {
        errors.push(`${fieldName}.quantity 必须是大于 0 的数字。`);
      }
      if (itemId) {
        const currentQuantity = quantitiesById.get(itemId);
        const removeQuantity = change.quantity === undefined ? 1 : Math.max(1, Math.floor(change.quantity));
        if (hasInventoryContext) {
          if (currentQuantity === undefined) {
            errors.push(`${fieldName}.itemId 未匹配当前库存：${itemId}`);
          } else if (quantityValid && removeQuantity > currentQuantity) {
            errors.push(`${fieldName}.quantity 超过当前库存 ${itemId} 的现有数量 ${currentQuantity}。`);
          } else if (quantityValid) {
            const nextQuantity = currentQuantity - removeQuantity;
            if (nextQuantity > 0) quantitiesById.set(itemId, nextQuantity);
            else quantitiesById.delete(itemId);
          }
        }
      }
      return;
    }
    if (change.action === 'setQuantity') {
      const itemId = change.itemId?.trim();
      if (!itemId) errors.push(`${fieldName}.itemId 不能为空。`);
      const quantityValid = Number.isFinite(change.quantity) && change.quantity >= 0;
      if (!quantityValid) {
        errors.push(`${fieldName}.quantity 必须是大于等于 0 的数字。`);
      }
      if (itemId) {
        if (hasInventoryContext && !quantitiesById.has(itemId)) {
          errors.push(`${fieldName}.itemId 未匹配当前库存：${itemId}`);
        } else if (hasInventoryContext && quantityValid) {
          const nextQuantity = Math.max(0, Math.floor(change.quantity));
          if (nextQuantity > 0) quantitiesById.set(itemId, nextQuantity);
          else quantitiesById.delete(itemId);
        }
      }
      return;
    }
    errors.push(`${fieldName}.action 非法：${String((change as { action?: unknown }).action)}`);
  });
}

function validatePushNpcMemoryCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: Extract<LuanShiCommand, { action: 'pushNpcMemory' }>,
  errors: string[],
): void {
  const npc = state.npcs.find((item) => item.npcId === command.npcId);

  if (!npc) {
    errors.push(`npcId 不存在：${command.npcId}`);
  } else if (npc.name !== command.npcName) {
    errors.push(`npcName 与 npcId 不匹配：期望 ${npc.name}，收到 ${command.npcName}`);
  }

  if (!command.value.trim()) {
    errors.push('NPC 记忆内容 value 不能为空。');
  }

  if (!memorySources.includes(command.source)) {
    errors.push(`未知记忆来源：${String(command.source)}`);
  }

  if (npc && command.source === '亲历' && !isNpcPhysicallyPresent(state, npc)) {
    errors.push(`NPC ${npc.name} 当前不在场，不能写入亲历记忆。`);
  }

  if (npc && command.source === '亲历' && command.eventId) {
    const event = state.turnEvents.find((item) => item.eventId === command.eventId);
    if (!event) {
      errors.push(`亲历记忆引用的 eventId 不存在：${command.eventId}`);
    } else if (!event.presentNpcIds.includes(command.npcId)) {
      errors.push(`NPC ${npc.name} 不在事件 ${command.eventId} 的在场名单中，不能写入亲历记忆。`);
    }
  }
}

function validateNpcFemaleProfileUpdateCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: NpcFemaleProfileUpdateCommand,
  errors: string[],
): void {
  if (command.action !== 'updateNpcFemaleProfile') {
    errors.push(`updateNpcFemaleProfile.action 非法：${String(command.action)}`);
  }

  if (typeof command.npcId !== 'string' || command.npcId.trim().length === 0) {
    errors.push('updateNpcFemaleProfile 必须包含 npcId。');
    return;
  }

  const npc = state.npcs.find((item) => item.npcId === command.npcId);
  if (!npc) {
    errors.push(`npcId 不存在：${command.npcId}`);
  } else if (command.npcName && command.npcName !== npc.name) {
    errors.push(`npcName 与 npcId 不匹配：期望 ${npc.name}，收到 ${command.npcName}`);
  }

  const hasProfileField = [
    'birthday',
    'addressToPlayer',
    'relationshipNotes',
    'publicIntimacyNotes',
    'appearanceDescription',
    'bodyDescription',
    'clothingStyle',
    'appearanceExtension',
    'personalityCore',
    'affectionProgressionCondition',
    'relationshipProgressionCondition',
    'relationshipNetwork',
    'emotionalBoundary',
    'adultPrivateProfile',
  ].some((field) => Object.prototype.hasOwnProperty.call(command, field));
  if (!hasProfileField) {
    errors.push('updateNpcFemaleProfile 至少需要一个女性档案字段。');
  }

  for (const field of femaleProfileTextFields) {
    const value = command[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      errors.push(`updateNpcFemaleProfile.${field} 必须是字符串或 null。`);
    }
  }

  validateRelationshipNetwork(command.relationshipNetwork, errors);

  if (command.adultPrivateProfile === undefined || command.adultPrivateProfile === null) {
    return;
  }

  if (typeof command.adultPrivateProfile !== 'object' || Array.isArray(command.adultPrivateProfile)) {
    errors.push('updateNpcFemaleProfile.adultPrivateProfile 必须是对象或 null。');
    return;
  }

  const adultPrivateProfile = command.adultPrivateProfile;
  for (const field of adultPrivateProfileTextFields) {
    const value = adultPrivateProfile[field];
    if (value !== undefined && typeof value !== 'string') {
      errors.push(`updateNpcFemaleProfile.adultPrivateProfile.${field} 必须是字符串。`);
    }
  }

  for (const field of ['enabled', 'ageConfirmedAdult'] as const) {
    const value = adultPrivateProfile[field];
    if (value !== undefined && typeof value !== 'boolean') {
      errors.push(`updateNpcFemaleProfile.adultPrivateProfile.${field} 必须是布尔值。`);
    }
  }

  if (adultPrivateProfile.virgin !== undefined && typeof adultPrivateProfile.virgin !== 'boolean') {
    errors.push('updateNpcFemaleProfile.adultPrivateProfile.virgin must be a boolean.');
  }

  validateWombProfile(adultPrivateProfile.wombProfile, errors);
}

function validateRelationshipNetwork(
  value: NpcFemaleProfileUpdateCommand['relationshipNetwork'],
  errors: string[],
): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    errors.push('updateNpcFemaleProfile.relationshipNetwork must be an array or null.');
    return;
  }

  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`updateNpcFemaleProfile.relationshipNetwork[${index}] must be an object.`);
      return;
    }

    if (!isNonEmptyString(entry.targetName)) {
      errors.push(`updateNpcFemaleProfile.relationshipNetwork[${index}].targetName cannot be empty.`);
    }
    if (!isNonEmptyString(entry.relationship)) {
      errors.push(`updateNpcFemaleProfile.relationshipNetwork[${index}].relationship cannot be empty.`);
    }
    if (entry.notes !== undefined && typeof entry.notes !== 'string') {
      errors.push(`updateNpcFemaleProfile.relationshipNetwork[${index}].notes must be a string.`);
    }
  });
}

function validateWombProfile(value: LuanShiNpcWombProfile | undefined, errors: string[]): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('updateNpcFemaleProfile.adultPrivateProfile.wombProfile must be an object.');
    return;
  }

  if (value.status !== undefined && typeof value.status !== 'string') {
    errors.push('updateNpcFemaleProfile.adultPrivateProfile.wombProfile.status must be a string.');
  }
  if (value.cervixStatus !== undefined && typeof value.cervixStatus !== 'string') {
    errors.push('updateNpcFemaleProfile.adultPrivateProfile.wombProfile.cervixStatus must be a string.');
  }

  for (const field of ['pregnancy', 'pendingPregnancyChecks', 'lastPregnancyCheck', 'pregnancyHistory'] as const) {
    if (value[field] !== undefined) {
      errors.push(`updateNpcFemaleProfile.adultPrivateProfile.wombProfile.${field} is engine-managed; use pregnancy lifecycle commands.`);
    }
  }

  if (value.inseminationRecords === undefined) return;
  if (!Array.isArray(value.inseminationRecords)) {
    errors.push('updateNpcFemaleProfile.adultPrivateProfile.wombProfile.inseminationRecords must be an array.');
    return;
  }

  value.inseminationRecords.forEach((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      errors.push(`updateNpcFemaleProfile.adultPrivateProfile.wombProfile.inseminationRecords[${index}] must be an object.`);
      return;
    }
    if (!isNonEmptyString(record.date)) {
      errors.push(`updateNpcFemaleProfile.adultPrivateProfile.wombProfile.inseminationRecords[${index}].date cannot be empty.`);
    }
    if (!isNonEmptyString(record.description)) {
      errors.push(`updateNpcFemaleProfile.adultPrivateProfile.wombProfile.inseminationRecords[${index}].description cannot be empty.`);
    }
    if (record.pregnancyCheckDate !== undefined && typeof record.pregnancyCheckDate !== 'string') {
      errors.push(`updateNpcFemaleProfile.adultPrivateProfile.wombProfile.inseminationRecords[${index}].pregnancyCheckDate must be a string.`);
    }
  });
}

function validatePregnancyRiskRecordCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: PregnancyRiskRecordCommand,
  errors: string[],
): void {
  const npc = state.npcs.find((entry) => entry.npcId === command.npcId);
  if (!npc) {
    errors.push(`recordPregnancyRisk.npcId does not exist: ${command.npcId}`);
    return;
  }
  if (npc.name !== command.npcName.trim()) {
    errors.push('recordPregnancyRisk.npcName must match the canonical NPC name.');
  }
  if (!isAdultFemaleNpcAt(npc, state.currentDate)) {
    errors.push('recordPregnancyRisk.npcId must reference an adult female NPC.');
  }
  if (!['unprotected', 'tryingToConceive', 'reducedRisk'].includes(command.riskType)) {
    errors.push(`recordPregnancyRisk.riskType is invalid: ${String(command.riskType)}`);
  }
  if (!isNonEmptyString(command.summary)) {
    errors.push('recordPregnancyRisk.summary cannot be empty.');
  }
}

function validatePregnancyResolutionCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: PregnancyResolutionCommand,
  errors: string[],
): void {
  const npc = state.npcs.find((entry) => entry.npcId === command.npcId);
  if (!npc) {
    errors.push(`resolvePregnancy.npcId does not exist: ${command.npcId}`);
    return;
  }
  if (npc.name !== command.npcName.trim()) {
    errors.push('resolvePregnancy.npcName must match the canonical NPC name.');
  }
  if (!isAdultFemaleNpcAt(npc, state.currentDate)) {
    errors.push('resolvePregnancy.npcId must reference an adult female NPC.');
  }
  const pregnancy = npc.femaleProfile?.adultPrivateProfile?.wombProfile?.pregnancy;
  if (!pregnancy || pregnancy.status === 'pendingCheck' || pregnancy.status === 'postpartum') {
    errors.push('resolvePregnancy requires an active suspected, confirmed, or delivery-due pregnancy.');
  }
  if (command.outcome !== 'liveBirth' && command.outcome !== 'ended') {
    errors.push(`resolvePregnancy.outcome is invalid: ${String(command.outcome)}`);
  }
  if (command.outcome === 'liveBirth' && pregnancy?.status === 'suspected') {
    errors.push('resolvePregnancy.liveBirth requires a confirmed or delivery-due pregnancy.');
  }
  if (!isNonEmptyString(command.summary)) {
    errors.push('resolvePregnancy.summary cannot be empty.');
  }
  if (command.childName !== undefined && !isNonEmptyString(command.childName)) {
    errors.push('resolvePregnancy.childName must be a non-empty string when provided.');
  }
  if (command.childSex !== undefined && command.childSex !== '男' && command.childSex !== '女') {
    errors.push('resolvePregnancy.childSex must be 男 or 女 when provided.');
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateUpdateCharacterIdentityCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: CharacterIdentityUpdateCommand,
  errors: string[],
): void {
  const isPlayerTarget = command.characterType === 'player'
    || command.characterId === 'player'
    || command.characterId === state.player.id;
  if (!isPlayerTarget && !command.characterId?.trim()) {
    errors.push('updateCharacterIdentity 必须包含 characterId。');
    return;
  }
  const npc = isPlayerTarget ? undefined : state.npcs.find((item) => item.npcId === command.characterId);

  if (!isPlayerTarget && !npc) {
    errors.push(`characterId 不存在：${command.characterId}`);
  }

  if (isPlayerTarget && command.characterName && command.characterName !== state.player.name) {
    errors.push(`characterName 与 player 不匹配：期望 ${state.player.name}，收到 ${command.characterName}`);
  }

  if (npc && command.characterName && command.characterName !== npc.name) {
    errors.push(`characterName 与 characterId 不匹配：期望 ${npc.name}，收到 ${command.characterName}`);
  }

  const hasIdentityField = identityFieldNames.some((field) => Object.prototype.hasOwnProperty.call(command, field));
  if (!hasIdentityField) {
    errors.push('updateCharacterIdentity 至少需要一个身份字段。');
  }

  for (const field of stringIdentityFieldNames) {
    const value = command[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      errors.push(`updateCharacterIdentity.${field} 必须是字符串或 null。`);
    }
  }

  if (command.aliases !== undefined && command.aliases !== null) {
    if (!Array.isArray(command.aliases)) {
      errors.push('updateCharacterIdentity.aliases 必须是字符串数组。');
    } else if (command.aliases.some((alias) => typeof alias !== 'string')) {
      errors.push('updateCharacterIdentity.aliases 只能包含字符串。');
    }
  }
}

function validateRecordTurnEventCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: Extract<LuanShiCommand, { action: 'recordTurnEvent' }>,
  errors: string[],
): void {
  if (!command.locationId.trim()) {
    errors.push('recordTurnEvent 必须包含 locationId。');
  }

  if (!command.summary.trim()) {
    errors.push('recordTurnEvent 必须包含 summary。');
  }

  const hasPresentNpcIds = Object.prototype.hasOwnProperty.call(command, 'presentNpcIds');
  if (hasPresentNpcIds && !Array.isArray(command.presentNpcIds)) {
    errors.push('recordTurnEvent 必须包含 presentNpcIds 数组。');
    return;
  }

  if (!normalizeTurnEventVisibility(command.visibility)) {
    errors.push(`未知事件可见性：${String(command.visibility)}`);
  }

  const knownNpcIds = new Set(state.npcs.map((npc) => npc.npcId));
  const presentNpcIds = Array.isArray(command.presentNpcIds) ? command.presentNpcIds : [];
  const referencedNpcIds = [
    ...presentNpcIds,
    ...(command.involvedNpcIds ?? []),
  ];

  for (const npcId of referencedNpcIds) {
    if (!knownNpcIds.has(npcId)) {
      errors.push(`recordTurnEvent 引用了未知 NPC：${npcId}`);
    }
  }
}
