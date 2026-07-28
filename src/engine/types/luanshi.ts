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
  age: number;
  birthDate?: string;
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

export type HoldingStatus = 'controlled' | 'contested' | 'temporary' | 'lost' | 'archived';

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
  stewardNpcId?: string;
  /**
   * 民政账本适用范围。旧存档可缺省，由兼容层仅按既有结构字段保守归类；
   * 新写回必须显式提供，禁止按名称或正文关键词猜测。
   */
  civilAdministrationScope?: HoldingCivilAdministrationScope;
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

export interface PrivateAssetEntry {
  privateAssetId: string;
  name: string;
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
}

export interface TroopLedgerEntry {
  troopId: string;
  name: string;
  aliases?: string[];
  size: number;
  previousSize?: number;
  factionId?: string;
  previousFactionId?: string;
  allegianceChangedAt?: string;
  allegianceChangeReason?: string;
  troopType?: string;
  specialDesignation?: string;
  quality?: '低' | '中' | '高' | '精锐';
  fatigue?: '低' | '中' | '高' | '极高';
  /** War Engine V2 的精确疲劳值；旧记录缺省时仍由 fatigue 档位投影。 */
  warFatiguePercent?: number;
  readiness?: '低' | '中' | '高';
  lifecycleStatus?: 'active' | 'routed' | 'merged' | 'split' | 'destroyed' | 'surrendered' | 'disbanded' | 'unknown' | 'archived';
  statusTags?: string[];
  leaderNpcId?: string;
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
  updatedAt?: string;
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
  privateAssets: PrivateAssetEntry[];
  privateAssetProjects: PrivateAssetProjectEntry[];
  domesticReports: DomesticReportEntry[];
  factions: FactionLedgerEntry[];
  troops: TroopLedgerEntry[];
  court: CourtLedger;
  situationOverview: SituationOverview;
  plotPlan: PlotPlanEntry[];
  worldTrends: WorldTrendEntry[];
  conflicts: ConflictRecord[];
  combatRecords: CombatRecord[];
  npcAwarenessIndex: NpcAwarenessEntry[];
  heroineThreads: HeroineThreadEntry[];
  bondThreads: BondThreadEntry[];
}
