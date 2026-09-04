import type {
  CharacterEffect,
  CharacterEquipmentItem,
  CharacterReputation,
  CharacterTrait,
  CharacterUniqueArt,
  CharacterVitals,
  InventoryItem,
} from './actor';
import type { MapNode, MapRouteEdgeV1 } from './map';

export type NpcMemorySource = '亲历' | '听闻' | '误会' | '推测';

/**
 * 新人物进入长期人物志时的准入依据。
 *
 * 该字段只属于写回协议，不持久化到 LuanShiNpc。已有 NPC 的正常更新不需要
 * 重复声明；新 NPC 必须给出一个可由本回合事实承接的理由和证据。
 */
export type NpcProfilePersistenceReason =
  | 'opening_cast'
  | 'historical_figure'
  | 'active_system_role'
  | 'recurring_contact'
  | 'player_committed_relationship'
  | 'strategic_actor';

export interface NpcMemoryEntry {
  memoryId: string;
  eventId?: string;
  source: NpcMemorySource;
  content: string;
  createdAt: string;
}

export type NpcAwarenessSourceType = 'npcProfile' | 'rumor' | 'worldTrend' | 'currentMatter' | 'memory' | 'playerMention' | 'conflict';

export interface NpcAwarenessReference {
  name: string;
  npcId?: string;
  sourceNote?: string;
  contactLevel?: number;
  historicalImportance?: number;
  playerRelevance?: string[];
  unresolvedHooks?: string[];
}

export interface NpcAwarenessEntry {
  awarenessId: string;
  npcId?: string;
  name: string;
  sourceType: NpcAwarenessSourceType;
  sourceIds: string[];
  contactLevel: number;
  relationshipStrength?: number;
  historicalImportance?: number;
  playerRelevance: string[];
  lastMentionedAt?: string;
  lastDirectInteractionAt?: string;
  lastPresenceBeatAt?: string;
  cooldownUntil?: string;
  unresolvedHooks?: string[];
  knownToPlayer: boolean;
  archiveVisible: boolean;
  updatedAt: string;
}

export interface NpcPresenceUpdate {
  id: string;
  createdAt: string;
  kind: 'rumor' | 'letter' | 'envoy' | 'sighting' | 'publicEvent' | 'absence';
  summary: string;
  source: string;
  certainty?: 'confirmed' | 'reported' | 'rumor' | 'uncertain';
  relatedWorldTrendIds?: string[];
  relatedRumorIds?: string[];
  relatedConflictIds?: string[];
  readByPlayer: boolean;
}

export type CorrespondenceParty =
  | {
      kind: 'player';
      playerId?: string;
      name: string;
    }
  | {
      kind: 'npc';
      npcId: string;
      name: string;
    };

export type CorrespondenceDirection = 'outgoing' | 'incoming';

export type CorrespondenceSource = 'ui' | 'narrative' | 'npcEvolution' | 'system';

export type CorrespondenceChannel = 'letter' | 'envoy';

export type CorrespondenceStatus =
  | 'draft'
  | 'queued'
  | 'inTransit'
  | 'deliveredPendingProcessing'
  | 'delivered'
  | 'read'
  | 'processed'
  | 'cancelled'
  | 'lost';

/**
 * 书信正文的长期真值。NPC 记忆只保存概括；letterId 仅留在内部关联字段中，
 * 不复制第二份全文，也不向玩家显示内部编码。
 */
export interface CorrespondenceEntry {
  letterId: string;
  direction: CorrespondenceDirection;
  sender: CorrespondenceParty;
  recipient: CorrespondenceParty;
  subject: string;
  body: string;
  summary?: string;
  source: CorrespondenceSource;
  sourceRefId?: string;
  sourceTurnNumber?: number;
  replyToLetterId?: string;
  channel: CorrespondenceChannel;
  status: CorrespondenceStatus;
  originLocationId?: string;
  targetLocationId?: string;
  createdAt: string;
  sentAt?: string;
  deliveryDueAt?: string;
  deliveredAt?: string;
  readAt?: string;
  processedAt?: string;
  /** 处理该来信的结构化动作 ID，用于 noReply/reply 重放幂等。 */
  processedBySourceRefId?: string;
  relatedCommitmentIds?: string[];
  /** 关联事务已经结束时，尚未送达的提醒信保留记录但不再投递。 */
  cancelledAt?: string;
  cancelReason?: string;
}

export interface CorrespondenceResourceBundle {
  /** 玩家个人钱财，底层单位为钱。 */
  playerMoneyQian?: number;
  /** 势力/府库公共钱财，底层单位为贯。 */
  moneyGuan?: number;
  grain?: number;
  horses?: number;
  arms?: number;
  recruits?: number;
}

export type CorrespondenceCommitmentDeliverable =
  | {
      kind: 'visit';
      npcId: string;
      entourageSummary?: string;
    }
  | {
      kind: 'troop';
      troopIds: string[];
      expectedCount?: number;
      compositionSummary?: string;
    }
  | {
      kind: 'resources';
      resources: CorrespondenceResourceBundle;
    }
  | {
      kind: 'items';
      itemIds: string[];
      itemSummary?: string;
    }
  | {
      kind: 'intel';
      summary: string;
    }
  | {
      kind: 'other';
      summary: string;
    };

export type CorrespondenceCommitmentStatus =
  | 'accepted'
  | 'preparing'
  | 'inTransit'
  | 'due'
  | 'fulfilled'
  | 'partial'
  | 'delayed'
  | 'failed'
  | 'cancelled';

export interface CorrespondenceCommitmentResolution {
  /** Stable resolution fact ID. Replaying the same turn must not settle twice. */
  sourceRefId?: string;
  status: Extract<
    CorrespondenceCommitmentStatus,
    'fulfilled' | 'partial' | 'delayed' | 'failed' | 'cancelled'
  >;
  summary: string;
  resolvedAt: string;
  nextExpectedAt?: string;
  /** The exact subset delivered by a partial settlement. */
  deliveredDeliverables?: CorrespondenceCommitmentDeliverable[];
  appliedOperationIds?: string[];
}

/**
 * NPC 通过已送达书信明确接受的未来承诺。待履约不提前增加资源；到期后必须由
 * 正常回合结构化结算，重试依靠 commitmentId 保证幂等。
 */
export interface CorrespondenceCommitment {
  commitmentId: string;
  sourceCorrespondenceId: string;
  sourceRefId?: string;
  promisorNpcId: string;
  promisorName: string;
  promisee: CorrespondenceParty;
  summary: string;
  status: CorrespondenceCommitmentStatus;
  acceptedAt: string;
  originLocationId?: string;
  targetLocationId: string;
  expectedAt: string;
  deliverables: CorrespondenceCommitmentDeliverable[];
  /** Outstanding balance after one or more partial settlements. */
  remainingDeliverables?: CorrespondenceCommitmentDeliverable[];
  conditions?: string[];
  progressSummary?: string;
  lastUpdatedAt: string;
  resolution?: CorrespondenceCommitmentResolution;
  /** Bounded idempotency/audit history for repeated partial settlements. */
  resolutionHistory?: CorrespondenceCommitmentResolution[];
}

export type NpcBackgroundActivityStatus = 'planned' | 'active' | 'blocked' | 'completed' | 'cancelled';

export type NpcBackgroundActivitySource = 'narrative' | 'quest' | 'plot' | 'worldTrend' | 'conflict' | 'system';

export type NpcBackgroundActivityVisibility = 'hidden' | 'playerKnown' | 'public';

export interface NpcBackgroundActivity {
  activityId: string;
  summary: string;
  status: NpcBackgroundActivityStatus;
  locationId?: string;
  startedAt?: string;
  dueAt?: string;
  lastEvaluatedAt?: string;
  sourceType?: NpcBackgroundActivitySource;
  sourceIds?: string[];
  visibility?: NpcBackgroundActivityVisibility;
}

/**
 * 后台世界演化的轻量调度元数据。事实本体仍只写入 backgroundActivity、
 * memories、presenceUpdates 与既有世界账本；这里不保存第二份剧情事实。
 */
export interface NpcBackgroundEvolutionMeta {
  lastAttemptAt?: string;
  nextRetryAt?: string;
  lastEvaluationId?: string;
  consecutiveFailures?: number;
}

export interface RemoteNpcPresenceBeat {
  beatId: string;
  awarenessId: string;
  npcId?: string;
  name: string;
  beatType: 'rumor' | 'letter' | 'envoy' | 'invitation' | 'request' | 'warning' | 'absence' | 'publicMention';
  triggerReason: string;
  suggestedDelivery: string;
  relevanceSummary: string;
  urgency: 'low' | 'medium' | 'high';
  expiresAt?: string;
  sourceIds: string[];
}

export interface LuanShiNpcRelationshipNetworkEntry {
  targetName: string;
  relationship: string;
  notes?: string;
}

export interface LuanShiNpcWombRecord {
  date: string;
  description: string;
  pregnancyCheckDate?: string;
}

export type LuanShiPregnancyStatus =
  | 'pendingCheck'
  | 'suspected'
  | 'confirmed'
  | 'deliveryDue'
  | 'postpartum';

export interface LuanShiPregnancyState {
  pregnancyId: string;
  status: LuanShiPregnancyStatus;
  cycleKey: string;
  firstExposureAt: string;
  checkAt: string;
  exposureCount: number;
  chanceBasisPoints: number;
  rollBasisPoints: number;
  fatherCharacterIds: string[];
  paternityStatus: 'known' | 'uncertain';
  disclosure: 'private' | 'public';
  tryingToConceive?: boolean;
  hasUnprotectedExposure?: boolean;
  riskEventKeys?: string[];
  conceptionAt?: string;
  confirmedAt?: string;
  estimatedDueAt?: string;
  deliveryWindowStartAt?: string;
  deliveryWindowEndAt?: string;
  resolvedAt?: string;
  outcome?: 'liveBirth' | 'ended';
  outcomeSummary?: string;
  childNpcId?: string;
  postpartumUntil?: string;
}

export interface LuanShiPregnancyCheckRecord {
  cycleKey: string;
  firstExposureAt: string;
  checkedAt: string;
  result: 'notPregnant' | 'pregnant';
  chanceBasisPoints: number;
  rollBasisPoints: number;
}

export interface LuanShiPregnancyHistoryEntry {
  pregnancyId: string;
  outcome: 'liveBirth' | 'ended';
  resolvedAt: string;
  summary: string;
  childNpcId?: string;
}

export interface LuanShiNpcWombProfile {
  status?: string;
  cervixStatus?: string;
  inseminationRecords?: LuanShiNpcWombRecord[];
  pregnancy?: LuanShiPregnancyState;
  /**
   * Later exposure-day checks waiting behind `pregnancy` while its status is
   * `pendingCheck`. Same-day exposures merge into one batch; different game
   * days retain independent deterministic rolls and check dates.
   */
  pendingPregnancyChecks?: LuanShiPregnancyState[];
  lastPregnancyCheck?: LuanShiPregnancyCheckRecord;
  pregnancyHistory?: LuanShiPregnancyHistoryEntry[];
}

export interface LuanShiNpcAdultPrivateProfile {
  enabled?: boolean;
  ageConfirmedAdult?: boolean;
  summary?: string;
  breastDescription?: string;
  vaginaDescription?: string;
  anusDescription?: string;
  sexualPreferenceNotes?: string;
  sensitiveSpotNotes?: string;
  preferenceNotes?: string;
  boundaryNotes?: string;
  sensitiveNotes?: string;
  relationshipRiskNotes?: string;
  wombProfile?: LuanShiNpcWombProfile;
  virgin?: boolean;
  firstNightPartner?: string;
  firstNightTime?: string;
  firstNightDescription?: string;
  updatedAt?: string;
  source?: string;
}

export interface LuanShiNpcFemaleProfile {
  birthday?: string;
  addressToPlayer?: string;
  relationshipNotes?: string;
  publicIntimacyNotes?: string;
  appearanceDescription?: string;
  bodyDescription?: string;
  clothingStyle?: string;
  appearanceExtension?: string;
  personalityCore?: string;
  affectionProgressionCondition?: string;
  relationshipProgressionCondition?: string;
  relationshipNetwork?: LuanShiNpcRelationshipNetworkEntry[];
  emotionalBoundary?: string;
  adultPrivateProfile?: LuanShiNpcAdultPrivateProfile;
  updatedAt?: string;
  source?: string;
}

export interface LuanShiNpc {
  npcId: string;
  name: string;
  courtesyName?: string;
  artName?: string;
  aliases?: string[];
  commonAddress?: string;
  sex: '男' | '女' | '其他';
  /** Legacy compatibility snapshot; runtime age is derived from birthDate. */
  age: number;
  /** Canonical complete in-world birthday after persistence migration. */
  birthDate?: string;
  /** Legacy migration input only. New writes must not depend on this field. */
  ageKnownAtDate?: string;
  role: string;
  factionId?: string;
  factionName?: string;
  locationId?: string;
  isPresent: boolean;
  isFocused: boolean;
  birthOrigin?: string;
  birthOriginDescription?: string;
  currentIdentity?: string;
  currentIdentityDescription?: string;
  allegianceTarget?: string;
  officeTitle?: string;
  militaryTitle?: string;
  nobleTitle?: string;
  identitySummary?: string;
  summary: string;
  appearance: string;
  personality: string;
  motivation: string;
  relationToPlayer: string;
  contactLevel: number;
  recentAttitude: string;
  backgroundEvolutionMeta?: NpcBackgroundEvolutionMeta;
  abilityScores?: Record<string, number>;
  vitals?: CharacterVitals;
  combatStatuses?: string[];
  traits?: CharacterTrait[];
  uniqueArts?: CharacterUniqueArt[];
  effects?: CharacterEffect[];
  equipment?: CharacterEquipmentItem[];
  inventory?: InventoryItem[];
  reputation?: CharacterReputation;
  parentLinks?: {
    motherNpcId: string;
    fatherCharacterId?: string;
  };
  femaleProfile?: LuanShiNpcFemaleProfile;
  backgroundActivity?: NpcBackgroundActivity;
  presenceUpdates?: NpcPresenceUpdate[];
  memories: NpcMemoryEntry[];
}

export interface TurnEventRecord {
  eventId: string;
  happenedAt: string;
  locationId: string;
  summary: string;
  presentNpcIds: string[];
  involvedNpcIds: string[];
  visibility: '私密' | '在场可知' | '传闻扩散' | '公开';
}

export interface LocationLedgerEntry {
  locationId: string;
  name: string;
  type: string;
  controller?: string;
  summary: string;
  knownLevel: '亲历' | '听闻' | '推测';
  recentEvents: string[];
}

export interface RouteLedgerEntry {
  routeId: string;
  fromLocationId: string;
  toLocationId: string;
  name: string;
  travelTime: string;
  riskLevel: number;
  status: string;
  source: '亲历' | '听闻' | '推测';
}

export interface ResourceLedger {
  /** 势力/府库公共钱财，固定以“贯”为底层单位；不得与 player.personalMoney 的“钱”混用。 */
  money: number;
  grain: number;
  horses: number;
  arms: number;
  recruits: number;
  weapons: string[];
  documents: string[];
  tokens: string[];
  importantSupplies: string[];
}

export type HoldingType =
  | 'county'
  | 'commandery'
  | 'city'
  | 'fort'
  | 'pass'
  | 'camp'
  | 'estate'
  | 'port'
  | 'village'
  | 'other';

export type HoldingCivilAdministrationScope =
  | 'none'
  | 'households'
  | 'territorial'
  | 'mixed';

/**
 * 民政辖境的实际体量，与城防/设施规模 scaleLevel 分离。
 * 例如一座城防规模为 3 的郡治，仍可管理 5 级民政辖境。
 */
export type HoldingCivilScaleLevel = 1 | 2 | 3 | 4 | 5;

export type HoldingStatus = 'controlled' | 'contested' | 'temporary' | 'lost' | 'archived';

export type HoldingControlEvidenceKind =
  | 'opening'
  | 'formal_handover'
  | 'grant'
  | 'capture'
  | 'founding'
  | 'temporary_administration'
  | 'active_contest'
  | 'war_target'
  | 'control_loss';

/**
 * 当前领地控制状态的结构化事实依据。旧存档允许缺失；新建领地以及控制状态变化必须提供。
 * 单纯驻守、守城、经过或位于城墙之上不是合法 kind。
 */
export interface HoldingControlEvidence {
  kind: HoldingControlEvidenceKind;
  occurredAt: string;
  sourceRefId: string;
  summary: string;
}

export type HoldingSiegeStatus = 'blockaded' | 'encircled';
export type HoldingSupplyLineStatus = 'open' | 'strained' | 'cut';
export type HoldingSiegePreparation = 'none' | 'prepared' | 'stockpiled';

/**
 * 活动围城的轻量事实层。精确府库、粮仓不参与计算；断补回合和初始耐久由本地引擎写入。
 */
export interface HoldingSiegeState {
  status: HoldingSiegeStatus;
  supplyLine: HoldingSupplyLineStatus;
  preparation: HoldingSiegePreparation;
  cutOffAtTurn?: number;
  initialEnduranceTurns?: number;
}

export interface HoldingLedgerEntry {
  holdingId: string;
  name: string;
  aliases?: string[];
  type: HoldingType;
  status: HoldingStatus;
  summary: string;
  locationId?: string;
  factionId?: string;
  nominalAllegiance?: string;
  actualController?: string;
  controlEvidence?: HoldingControlEvidence;
  stewardNpcId?: string;
  /** 已被结构化任命、可参与本领地治理项目的其他 NPC。 */
  governanceOfficerNpcIds?: string[];
  /**
   * 民政账本适用范围。旧存档可缺省，由兼容层仅按既有结构字段保守归类；
   * 新写回必须显式提供，禁止按名称或正文关键词猜测。
   */
  civilAdministrationScope?: HoldingCivilAdministrationScope;
  /** 旧存档可缺省，由地点档案与既有田亩/编户数据确定性推导。 */
  civilScaleLevel?: HoldingCivilScaleLevel;
  scaleLevel: 1 | 2 | 3 | 4 | 5;
  agriculture: number;
  commerce: number;
  population: number;
  publicOrder: number;
  popularSupport: number;
  defense: number;
  recruitPotential: number;
  armory: number;
  horseSupply: number;
  /**
   * 税收、征收与经营收益链路中的损耗评分。
   * 无民政收益辖境不携带该字段；旧档兼容层会移除纯军事设施上的历史残留。
   */
  corruption?: number;
  farmlandMu?: number;
  registeredHouseholds?: number;
  eliteControlledShare?: number;
  localEliteRelation?: number;
  localTreasury?: number;
  localGranary?: number;
  siege?: HoldingSiegeState;
  garrisonTroopIds?: string[];
  relatedNpcIds?: string[];
  riskNotes?: string[];
  recentChanges?: string[];
  sourceNote?: string;
  updatedAt: string;
}

export type HoldingGovernanceProjectType =
  | 'land_survey'
  | 'household_registration'
  | 'irrigation'
  | 'anti_corruption'
  | 'public_order'
  | 'refugee_resettlement'
  | 'commerce'
  | 'relief'
  | 'garrison_drill'
  | 'position_fortification'
  | 'armory_maintenance'
  | 'beacon_maintenance'
  | 'route_patrol';

export type HoldingGovernanceProjectStatus = 'active' | 'blocked' | 'completed' | 'cancelled';
export type HoldingGovernanceProjectRisk = 'low' | 'moderate' | 'high';
export type HoldingGovernanceActorType = 'player' | 'npc';

export interface HoldingGovernanceActorRef {
  actorType: HoldingGovernanceActorType;
  actorId: string;
}

export interface HoldingGovernanceProjectFieldRange {
  min: number;
  max: number;
}

export interface HoldingGovernanceProjectEffects {
  farmlandMu?: number;
  registeredHouseholds?: number;
  population?: number;
  agriculture?: number;
  commerce?: number;
  publicOrder?: number;
  popularSupport?: number;
  corruption?: number;
  defense?: number;
  recruitPotential?: number;
  armory?: number;
  horseSupply?: number;
}

export type HoldingGovernanceProjectEffectRanges = {
  [K in keyof HoldingGovernanceProjectEffects]?: HoldingGovernanceProjectFieldRange;
};

export interface HoldingGovernanceProjectBaseline extends HoldingGovernanceProjectEffects {
  holdingStatus: HoldingStatus;
  civilAdministrationScope: HoldingCivilAdministrationScope;
  civilScaleLevel?: HoldingCivilScaleLevel;
  scaleLevel: HoldingLedgerEntry['scaleLevel'];
}

export interface HoldingGovernanceProjectResult {
  completedAt: string;
  deltas: HoldingGovernanceProjectEffects;
  summary: string;
}

export interface HoldingGovernanceProjectModifiers {
  hostAbilityScore: number;
  assistantAbilityScore?: number;
  durationMultiplier: number;
  costMultiplier: number;
  effectMultiplier: number;
  riskStepsReduced: number;
}

export interface HoldingGovernanceProjectEntry {
  projectId: string;
  holdingId: string;
  type: HoldingGovernanceProjectType;
  status: HoldingGovernanceProjectStatus;
  host: HoldingGovernanceActorRef;
  assistant?: HoldingGovernanceActorRef;
  startedAt: string;
  expectedCompleteAt: string;
  investedMoney: number;
  investedGrain: number;
  baseline: HoldingGovernanceProjectBaseline;
  expectedEffects: HoldingGovernanceProjectEffectRanges;
  risk: HoldingGovernanceProjectRisk;
  modifiers: HoldingGovernanceProjectModifiers;
  appliedArtIds?: string[];
  result?: HoldingGovernanceProjectResult;
  blockedReason?: string;
  cancelledAt?: string;
  updatedAt: string;
}

export type PrivateAssetType =
  | 'estate'
  | 'farmland'
  | 'workshop'
  | 'ranch'
  | 'shop'
  | 'ferry'
  | 'mine'
  | 'other';

export type PrivateAssetOwnerScope = 'personal' | 'clan' | 'household' | 'retainer' | 'faction';

export type PrivateAssetStatus = 'active' | 'damaged' | 'occupied' | 'disputed' | 'archived';

export type PrivateAssetAcquisitionKind =
  | 'opening'
  | 'purchase'
  | 'grant'
  | 'inheritance'
  | 'construction'
  | 'seizure'
  | 'transfer';

export interface PrivateAssetAcquisition {
  kind: PrivateAssetAcquisitionKind;
  occurredAt: string;
  sourceRefId: string;
  summary: string;
  costMoney?: number;
  costGrain?: number;
}

export interface PrivateAssetEntry {
  privateAssetId: string;
  name: string;
  aliases?: string[];
  type: PrivateAssetType;
  ownerScope: PrivateAssetOwnerScope;
  status: PrivateAssetStatus;
  summary: string;
  locationId?: string;
  locationDescription?: string;
  managerNpcId?: string;
  mu?: number;
  households?: number;
  workers?: number;
  workshopScale?: 1 | 2 | 3 | 4 | 5;
  ranchCapacity?: number;
  conditionNotes?: string[];
  riskNotes?: string[];
  recentChanges?: string[];
  sourceNote?: string;
  acquisition?: PrivateAssetAcquisition;
  updatedAt: string;
}

export type PrivateAssetProjectType =
  | 'expand_farmland'
  | 'irrigation'
  | 'build_workshop'
  | 'expand_workshop'
  | 'build_ranch'
  | 'expand_ranch'
  | 'recruit_tenants'
  | 'repair'
  | 'anti_corruption'
  | 'other';

export type PrivateAssetProjectStatus = 'planned' | 'active' | 'blocked' | 'completed' | 'cancelled';

export interface PrivateAssetProjectDelta {
  mu?: number;
  households?: number;
  workers?: number;
  workshopScale?: number;
  ranchCapacity?: number;
}

export interface PrivateAssetProjectEntry {
  projectId: string;
  assetId: string;
  title: string;
  type: PrivateAssetProjectType;
  status: PrivateAssetProjectStatus;
  startedAt: string;
  expectedCompleteAt?: string;
  investedMoney?: number;
  investedGrain?: number;
  targetDelta?: PrivateAssetProjectDelta;
  host?: HoldingGovernanceActorRef;
  assistant?: HoldingGovernanceActorRef;
  risk?: HoldingGovernanceProjectRisk;
  modifiers?: HoldingGovernanceProjectModifiers;
  appliedArtIds?: string[];
  cancelledAt?: string;
  riskNotes?: string[];
  progressNotes?: string[];
  updatedAt: string;
}

export interface DomesticReportResourceDelta {
  money: number;
  grain: number;
  horses: number;
  arms: number;
  recruits: number;
}

export interface DomesticReportHoldingHighlight {
  holdingId: string;
  summary: string;
}

export interface DomesticReportPrivateAssetHighlight {
  privateAssetId: string;
  summary: string;
}

export interface DomesticReportProjectHighlight {
  projectId: string;
  assetId?: string;
  summary: string;
}

export interface DomesticReportEntry {
  reportId: string;
  source?: 'system' | 'llm';
  kind?: string;
  year: number | string;
  settledAt: string;
  title: string;
  summary: string;
  income: DomesticReportResourceDelta;
  expenses: DomesticReportResourceDelta;
  netChange: DomesticReportResourceDelta;
  holdingHighlights?: DomesticReportHoldingHighlight[];
  privateAssetHighlights?: DomesticReportPrivateAssetHighlight[];
  projectHighlights?: DomesticReportProjectHighlight[];
  warnings?: string[];
  readByPlayer: boolean;
}

export interface FactionRecentActionEntry {
  summary: string;
  knownLevel: '亲历' | '听闻' | '推测';
  observedAt?: string;
  sourceNote?: string;
}

export interface FactionLedgerEntry {
  factionId: string;
  name: string;
  aliases?: string[];
  type: string;
  summary: string;
  stanceToPlayer: string;
  knownLevel: '亲历' | '听闻' | '推测';
  nominalAllegiance?: string;
  legalIdentity?: string;
  actualController?: string;
  knownSphere?: string;
  corePersonNpcIds?: string[];
  knownMemberNpcIds?: string[];
  relatedTroopIds?: string[];
  sourceNote?: string;
  lastKnownAt?: string;
  updatedAt?: string;
  recentActions: string[];
  /** 引擎维护的逐条动作档案；recentActions 保留为旧存档与提示词兼容投影。 */
  recentActionRecords?: FactionRecentActionEntry[];
}

export interface TroopLedgerEntry {
  troopId: string;
  name: string;
  aliases?: string[];
  /**
   * intelligence 只表示“这支军事力量已被玩家知晓”，不得直接进入确定性战争、
   * 征募维护或精确兵力结算；operational 才是字段足以执行本地规则的完整建制。
   * 旧存档缺省时按 operational 兼容。
   */
  detailLevel?: 'intelligence' | 'operational';
  size: number;
  /** 军情层可保存区间估计，避免为了准入友军/敌军而伪造精确 size。 */
  strengthEstimate?: {
    min: number;
    max: number;
    asOf?: string;
    basis?: string;
  };
  /** Locally maintained field for units temporarily unable to deploy because of logistics. */
  deployableSize?: number;
  previousSize?: number;
  factionId?: string;
  previousFactionId?: string;
  allegianceChangedAt?: string;
  allegianceChangeReason?: string;
  troopType?: string;
  /** Stable logistics class. New heavy cavalry must use the local formation/evidence contract. */
  logisticsClass?: 'ordinary' | 'heavy_cavalry';
  acquisitionEvidence?: TroopAcquisitionEvidence;
  specialDesignation?: string;
  quality?: '低' | '中' | '高' | '精锐';
  fatigue?: '低' | '中' | '高' | '极高';
  /** War Engine V2 的精确疲劳值；旧记录缺省时仍由 fatigue 档位投影。 */
  warFatiguePercent?: number;
  /** 本回合部队的活动节奏；本地确定性疲劳恢复只认 resting。 */
  activityTempo?: 'resting' | 'stationary_duty' | 'training' | 'marching' | 'combat' | 'unknown';
  /** 本地确定性恢复的幂等时间戳，不由模型写入。 */
  lastDeterministicFatigueRecoveryAt?: string;
  readiness?: '低' | '中' | '高';
  lifecycleStatus?: 'active' | 'routed' | 'merged' | 'split' | 'destroyed' | 'surrendered' | 'disbanded' | 'unknown' | 'archived';
  statusTags?: string[];
  /** 实际带领该建制的将领；玩家本人亲自统领时可使用玩家稳定 ID。 */
  leaderNpcId?: string;
  /** 随军副将，最多两名；只保存稳定 NPC ID，不保存姓名副本。 */
  deputyNpcIds?: string[];
  /** 随军军师，最多一名；只保存稳定 NPC ID。 */
  strategistNpcId?: string;
  locationId?: string;
  lastKnownLocationId?: string;
  lastKnownAt?: string;
  knownLevel?: '亲历' | '听闻' | '推测';
  certainty?: 'confirmed' | 'reported' | 'rumor' | 'uncertain';
  orderStatus?: 'none' | 'issued' | 'inTransit' | 'delivered' | 'delayed' | 'lost' | 'cancelled';
  orderIssuedAt?: string;
  orderDeliveredAt?: string;
  orderSummary?: string;
  destinationLocationId?: string;
  routeId?: string;
  movementStatus?: 'none' | 'waitingOrder' | 'preparing' | 'marching' | 'arrived' | 'blocked' | 'interrupted' | 'cancelled';
  departedAt?: string;
  estimatedArrivalAt?: string;
  arrivedAt?: string;
  movementNotes?: string;
  morale: number;
  training: number;
  supplies: string | number;
  /**
   * Internal upkeep routing. This is used by local monthly settlement and is not
   * meant to be displayed as a player-facing troop field.
   */
  upkeepSource?: 'player_resources' | 'superior_provision' | 'mixed' | 'unknown';
  task: string;
  relationToPlayer: string;
  /** 当前作战隶属关系；不同于 parentTroopId 的拆分/合并建制谱系。 */
  operationalParentForceId?: string;
  parentTroopId?: string;
  childTroopIds?: string[];
  /** 由 reducer 按 mergedIntoTroopId 反向维护的合并来源，不依赖 LLM 重复填写。 */
  mergedFromTroopIds?: string[];
  mergedIntoTroopId?: string;
  destroyedInBattleId?: string;
  lastBattleId?: string;
  strengthTrend?: 'increased' | 'decreased' | 'stable' | 'unknown';
  sourceNote?: string;
  lastChangeReason?: string;
  /** 由 reducer 根据结构化 changeEvent 追加；模型不得整段覆盖。 */
  changeHistory?: TroopChangeRecord[];
  updatedAt?: string;
}

export type TroopChangeKind =
  | 'observed'
  | 'commander_changed'
  | 'strength_changed'
  | 'defeated'
  | 'routed'
  | 'reorganized'
  | 'merged'
  | 'split'
  | 'surrendered'
  | 'destroyed'
  | 'moved';

export interface TroopChangeRecord {
  eventId: string;
  kind: TroopChangeKind;
  occurredAt: string;
  summary: string;
  sourceNote?: string;
}

export type TroopAcquisitionKind =
  | 'opening'
  | 'formation_project'
  | 'superior_grant'
  | 'transfer'
  | 'incorporation'
  | 'observed_existing';

export interface TroopAcquisitionEvidence {
  kind: TroopAcquisitionKind;
  occurredAt: string;
  sourceRefId: string;
  summary: string;
}

export type HeavyCavalrySupportLevel = 'limited' | 'stable' | 'major_faction' | 'state_level';
export type HeavyCavalryFormationStatus = 'active' | 'completed' | 'cancelled';

/** Local deterministic project; LLM may request it but cannot choose costs, duration or final quality. */
export interface HeavyCavalryFormationProjectEntry {
  projectId: string;
  troopId: string;
  troopName: string;
  holdingId: string;
  factionId?: string;
  requestedSize: number;
  supportLevel: HeavyCavalrySupportLevel;
  supportEvidenceRefId?: string;
  status: HeavyCavalryFormationStatus;
  startedAt: string;
  expectedCompleteAt: string;
  investedMoney: number;
  investedGrain: number;
  investedHorses: number;
  investedArms: number;
  investedRecruits: number;
  /** 兵员可来自府库可征召人手，也可从玩家实际控制的现役部队原子转编。 */
  personnelSource?: 'recruit_pool' | 'existing_troop';
  sourceTroopId?: string;
  reserveHorseCount: number;
  leaderNpcId?: string;
  relationToPlayer: string;
  upkeepSource: NonNullable<TroopLedgerEntry['upkeepSource']>;
  completedAt?: string;
  updatedAt: string;
}

export interface CourtLedger {
  rulerName: string;
  orderSummary: string;
  legitimacyPressure: string;
  edicts: string[];
  wantedNotices: string[];
  keyOfficials: string[];
}

export interface SituationOverview {
  summary: string;
  currentPressure: string[];
  immediateHooks: string[];
}

export interface PlotPlanEntry {
  plotId: string;
  title: string;
  horizon: '近期' | '中期' | '后期';
  status: '待触发' | '进行中' | '已完成' | '废弃';
  description: string;
  priority: '低' | '中' | '高';
  notBeforeAt?: string;
  lastAdvancedAt?: string;
}

export interface WorldTrendEntry {
  trendId: string;
  title: string;
  severity: '低' | '中' | '高' | '极高';
  summary: string;
  knownToPlayer: boolean;
  status?: 'active' | 'cooling' | 'historical' | 'corrected';
  happenedAt?: string;
  learnedAt?: string;
  visibility?: TurnEventRecord['visibility'] | string;
  scope?: 'local' | 'regional' | 'realm' | 'world';
  certainty?: 'confirmed' | 'reported' | 'rumor' | 'uncertain';
  source?: string;
  locationId?: string;
  relatedNpcIds?: string[];
  relatedFactionIds?: string[];
  relatedPlaceIds?: string[];
  affectedNpcIds?: string[];
  affectedFactionIds?: string[];
  affectedPlaceIds?: string[];
  affectedForceIds?: string[];
  affectedHoldingIds?: string[];
  consequenceTags?: string[];
  outcomeSummary?: string;
  progressSummary?: string;
  nextCheckAt?: string;
  lastAdvancedAt?: string;
  followUpHooks?: string[];
  sourceQuestIds?: string[];
  sourceSignalIds?: string[];
  sourceConflictIds?: string[];
  npcAwarenessRefs?: NpcAwarenessReference[];
  threadId?: string;
  archiveReason?: string;
  archivedAt?: string;
  updatedAt: string;
}

export type ConflictResultLevel =
  | 'decisiveWin'
  | 'win'
  | 'minorWin'
  | 'stalemate'
  | 'minorLoss'
  | 'loss'
  | 'decisiveLoss';

export type ConflictAdvantageBand =
  | 'overwhelmingAdvantage'
  | 'clearAdvantage'
  | 'slightAdvantage'
  | 'even'
  | 'slightDisadvantage'
  | 'clearDisadvantage'
  | 'overwhelmingDisadvantage';

export type ConflictTurningPointType =
  | 'duelVictory'
  | 'duelDefeat'
  | 'commanderSlain'
  | 'commanderCaptured'
  | 'commanderWounded'
  | 'commanderFled'
  | 'ambush'
  | 'fireAttack'
  | 'supplyDestroyed'
  | 'gateBreached'
  | 'reinforcementArrived'
  | 'moraleCollapse'
  | 'terrainBreakthrough'
  | 'playerAction'
  | 'other';

export type ConflictTurningPointImpact = 'minor' | 'moderate' | 'major' | 'critical';

export interface ConflictScoreBreakdown {
  troopBase?: number;
  commander?: number;
  tactical?: number;
  uniqueArts?: number;
  turningPoint?: number;
  playerAction?: number;
  total?: number;
  notes?: string[];
}

export interface ConflictTurningPoint {
  type: ConflictTurningPointType;
  side?: string;
  summary: string;
  impact: ConflictTurningPointImpact;
  relatedNpcIds?: string[];
  relatedTroopIds?: string[];
  scoreModifier?: number;
}

export interface ConflictJudgement {
  method: 'warJudgementV1' | 'warEngineV2';
  perspectiveSide?: string;
  baselineAdvantage?: ConflictAdvantageBand;
  scoreBreakdown?: ConflictScoreBreakdown;
  commanderAssessment?: string;
  tacticalAssessment?: string;
  underdogReason?: string;
}

export interface ConflictRecord {
  conflictId: string;
  type: '个人战斗' | '战争' | '军事冲突' | '对峙' | '其他' | '野战' | '伏击' | '追击' | '围城' | '守城' | '夜袭' | '抢粮' | '营寨战' | '巷战' | '水战';
  title: string;
  summary: string;
  occurredAt: string;
  outcome: string;
  scope?: 'selfRelated' | 'other';
  recordLevel?: 'brief' | 'full';
  locationId?: string;
  locationName?: string;
  sides?: string[];
  commanderNpcIds?: string[];
  involvedTroopIds?: string[];
  involvedFactionIds?: string[];
  involvedNpcIds?: string[];
  result?: string;
  resultLevel?: ConflictResultLevel;
  winnerSide?: string;
  loserSide?: string;
  judgement?: ConflictJudgement;
  turningPoints?: ConflictTurningPoint[];
  resultTags?: string[];
  decisiveFactors?: string[];
  reportText?: string;
  troopEffects?: string[];
  factionEffects?: string[];
  placeEffects?: string[];
  relatedQuestIds?: string[];
  relatedTrendIds?: string[];
  imageKey?: string;
  updatedAt?: string;
}

export type CombatRecordKind =
  | 'duel'
  | 'melee'
  | 'assassination'
  | 'escape'
  | 'capture'
  | 'battlefieldDuel'
  | 'other';

export type CombatResultLevel =
  | 'decisiveWin'
  | 'win'
  | 'stalemate'
  | 'loss'
  | 'decisiveLoss';

export type CombatOutcomeTag =
  | 'kill'
  | 'wound'
  | 'seriousWound'
  | 'capture'
  | 'forceRetreat'
  | 'escape'
  | 'woundedRetreat'
  | 'disarm'
  | 'rout';

export type CombatSignificance = 'minor' | 'notable' | 'major' | 'legendary';

export type CombatParticipantSide = 'player' | 'ally' | 'enemy' | 'neutral';

export interface CombatParticipant {
  participantId?: string;
  npcId?: string;
  name: string;
  side: CombatParticipantSide;
  role?: string;
  reputationFame?: number;
  outcome?: string;
}

export interface CombatScoreBreakdown {
  personalBase?: number;
  equipment?: number;
  status?: number;
  environment?: number;
  combatMethod?: number;
  uniqueArts?: number;
  playerAction?: number;
  turningPoint?: number;
  total?: number;
  notes?: string[];
}

export interface CombatJudgement {
  method: 'combatJudgementV1';
  perspectiveSide?: string;
  scoreBreakdown?: CombatScoreBreakdown;
  advantageBand?: ConflictAdvantageBand;
  underdogReason?: string;
  decisiveMoment?: string;
}

export interface CombatRecord {
  combatId: string;
  kind: CombatRecordKind;
  title: string;
  summary: string;
  occurredAt: string;
  locationId?: string;
  locationName?: string;
  participants: CombatParticipant[];
  playerInvolved: boolean;
  resultLevel: CombatResultLevel;
  outcomeTags?: CombatOutcomeTag[];
  outcome: string;
  significance: CombatSignificance;
  chronicleWorthy?: boolean;
  relatedNpcIds?: string[];
  relatedConflictIds?: string[];
  relatedQuestIds?: string[];
  relatedTrendIds?: string[];
  judgement?: CombatJudgement;
  briefText?: string;
  reportText?: string;
  imageKey?: string;
  visualTags?: string[];
  reputationEffects?: string[];
  updatedAt?: string;
}

export interface CalendarEraEntry {
  eraId: string;
  eraName: string;
  startYear: number;
  startMonth?: number;
  startDay?: number;
  rulerName?: string;
  source?: string;
  note?: string;
}

export type HeroineThreadStatus = 'active' | 'paused' | 'resolved' | 'archived';

export interface HeroineThreadMilestone {
  milestoneId: string;
  happenedAt: string;
  summary: string;
  source?: string;
}

export interface HeroineThreadEntry {
  heroineThreadId: string;
  npcId: string;
  npcName: string;
  status: HeroineThreadStatus;
  stage: string;
  relationshipRole: string;
  summary: string;
  currentPull?: string;
  riskNotes?: string;
  promiseNotes?: string;
  recentProgress?: string;
  tags?: string[];
  milestones?: HeroineThreadMilestone[];
  lastUpdatedAt: string;
  source?: string;
}

export type BondThreadStatus = 'active' | 'paused' | 'resolved' | 'archived';

export type BondThreadType =
  | 'sworn'
  | 'kinship'
  | 'mentor'
  | 'lordVassal'
  | 'ally'
  | 'debt'
  | 'rival'
  | 'enemy'
  | 'other';

export interface BondThreadMilestone {
  milestoneId: string;
  happenedAt: string;
  summary: string;
  source?: string;
}

export interface BondThreadEntry {
  bondThreadId: string;
  targetNpcIds?: string[];
  targetNames: string[];
  bondType: BondThreadType;
  status: BondThreadStatus;
  summary: string;
  currentTension?: string;
  promiseNotes?: string;
  conflictNotes?: string;
  recentProgress?: string;
  tags?: string[];
  milestones?: BondThreadMilestone[];
  lastUpdatedAt: string;
  source?: string;
}

export interface LuanShiRuntimeFields {
  calendarEras: CalendarEraEntry[];
  npcs: LuanShiNpc[];
  turnEvents: TurnEventRecord[];
  locations: LocationLedgerEntry[];
  routes: RouteLedgerEntry[];
  mapNodes: MapNode[];
  routeEdges: MapRouteEdgeV1[];
  resources: ResourceLedger;
  holdings: HoldingLedgerEntry[];
  holdingGovernanceProjects: HoldingGovernanceProjectEntry[];
  privateAssets: PrivateAssetEntry[];
  privateAssetProjects: PrivateAssetProjectEntry[];
  domesticReports: DomesticReportEntry[];
  factions: FactionLedgerEntry[];
  troops: TroopLedgerEntry[];
  heavyCavalryFormationProjects: HeavyCavalryFormationProjectEntry[];
  court: CourtLedger;
  situationOverview: SituationOverview;
  plotPlan: PlotPlanEntry[];
  worldTrends: WorldTrendEntry[];
  conflicts: ConflictRecord[];
  combatRecords: CombatRecord[];
  npcAwarenessIndex: NpcAwarenessEntry[];
  heroineThreads: HeroineThreadEntry[];
  bondThreads: BondThreadEntry[];
  correspondence: CorrespondenceEntry[];
  correspondenceCommitments: CorrespondenceCommitment[];
}
