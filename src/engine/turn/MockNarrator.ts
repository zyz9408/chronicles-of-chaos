// ============================================================
// Engine - MockNarrator
// 第一阶段不接真实 LLM，根据输入生成简单但有区别的叙事
// ============================================================

import type {
  CharacterEffect,
  CharacterEquipmentItem,
  CharacterTrait,
  CharacterUniqueArt,
  CharacterVitals,
  BondThreadEntry,
  CorrespondenceCommitmentDeliverable,
  InventoryItem,
  LuanShiNpcFemaleProfile,
  MapLayerKind,
  MapRouteEdgeV1,
  NpcAwarenessReference,
  NpcProfilePersistenceReason,
  PersonalEscortEntitlement,
  PrivateAssetEntry,
  StatePatch,
  SuggestedAction,
  TurnOrdinaryCheck,
} from '../types';
import type {
  EncounterStartIntent,
  EncounterTransitionDecision,
  SemanticProjection,
} from '../encounterV2/EncounterContracts';
import type { ActionIntent } from '../types';
import type { PlayerRecoveryKind } from '../character/PlayerRecoveryContracts';
import type { CharacterIdentityUpdateFields } from '../state/luanshiCommands';
import { interpretAction } from './ActionInterpreter';

export interface NarratorTurnSummaryWriteback {
  /** 一句话记录本回合核心结果，供摘要、回合列表、后续记忆压缩使用。 */
  brief: string;
  /** 玩家本回合输入在剧情中的有效行为摘要。 */
  playerActionSummary?: string;
  /** 玩家当前能直接感知到的后果。 */
  visibleConsequence?: string;
  /** 记忆重要性只用于后续筛选，不直接决定剧情。 */
  memoryImportance?: 'low' | 'medium' | 'high';
  /**
   * 本回合结束时玩家当前场景的完整 NPC 在场名单。
   * 这是结构化场景真值，不包含同城、远场关注或仅通过书信出现的人物。
   */
  scenePresence?: NarratorScenePresenceSnapshot;
  /**
   * 本回合已经完成、应进入私人产业账本的产权取得事实。
   * 这里只提供事实门禁与稳定来源，不直接绕过严格的私产命令校验。
   */
  privateAssetAcquisitions?: NarratorPrivateAssetAcquisitionFact[];
  /**
   * 本回合已经成立的稳定身份变化事实。
   * 本地只按该结构化事实补齐严格命令，不从正文关键词推断身份变化。
   */
  identityChanges?: NarratorIdentityChangeFact[];
  /**
   * 本回合已经跨过人物志长期准入边界的新人物事实。
   * 当完整人物档案遗漏或未通过合同时，辅助建档只依据这里的结构化事实补全，
   * 不扫描正文猜测人物重要性。
   */
  npcAdmissions?: NarratorNpcAdmissionFact[];
  /**
   * 本回合已经成立、应进入红颜或羁绊账本的长期关系事实。
   * 本地只按该结构化事实补齐严格关系命令，不从正文关键词推断关系成立。
   */
  relationshipAdmissions?: NarratorRelationshipAdmissionFact[];
  /**
   * 正文已真实完成的寄信、回信或收信处理。书信正文只能从此结构化事实进入账本，
   * 本地不扫描 narrativeText 猜测。
   */
  correspondenceActions?: NarratorCorrespondenceActionFact[];
  /** 到期承诺在本回合正文中的结构化结算；本地会原子结算可确定的资源、人员与既有部队。 */
  commitmentResolutions?: NarratorCommitmentResolutionFact[];
}

export interface NarratorScenePresenceSnapshot {
  /** 本回合结束时的当前场景 ID；地点切换时应对应最终 toSceneId/toLocationId。 */
  locationId: string;
  /** 已有人物志稳定 NPC ID 的完整名单；无人时必须明确返回空数组。 */
  presentNpcIds: string[];
}

export interface NarratorNpcAdmissionFact {
  sourceRefId: string;
  npcId: string;
  name: string;
  persistenceReason: NpcProfilePersistenceReason;
  persistenceEvidence: string;
  summary: string;
}

export interface NarratorCorrespondenceCommitmentFact {
  commitmentId: string;
  summary: string;
  targetLocationId: string;
  expectedAt: string;
  originLocationId?: string;
  deliverables: CorrespondenceCommitmentDeliverable[];
  conditions?: string[];
}

export interface NarratorCorrespondenceActionFact {
  sourceRefId: string;
  action: 'send' | 'reply' | 'acknowledge' | 'noReply';
  /** noReply 必须引用已经送达并等待 NPC 处理的玩家来信；acknowledge 仅兼容旧输出且不会关闭待回信状态。 */
  sourceLetterId?: string;
  /** 对被处理原信的简短事实概括；用于 NPC 长期记忆，不得复制原信或包含内部 ID。 */
  sourceLetterSummary?: string;
  /** 新建书信的稳定 ID；重试时必须保持不变。 */
  letterId?: string;
  direction?: 'player_to_npc' | 'npc_to_player';
  /**
   * sent 表示本回合只完成寄出，仍需按路程投递；received 表示最终正文已经明确展示
   * 收件人实际收到/拆阅该信，本地必须立即落为已送达，不能再次制造一段虚假的在途时间。
   */
  deliveryState?: 'sent' | 'received';
  senderNpcId?: string;
  recipientNpcId?: string;
  subject?: string;
  body?: string;
  summary?: string;
  replyToLetterId?: string;
  channel?: 'letter' | 'envoy';
  originLocationId?: string;
  targetLocationId?: string;
  /** 本信直接讨论或提醒的既有承诺；用于承诺结束后取消尚未送达的过期提醒。 */
  relatedCommitmentIds?: string[];
  commitments?: NarratorCorrespondenceCommitmentFact[];
}

export interface NarratorCommitmentResolutionFact {
  sourceRefId: string;
  commitmentId: string;
  status: 'fulfilled' | 'partial' | 'delayed' | 'failed' | 'cancelled';
  summary: string;
  nextExpectedAt?: string;
  /** partial 必须列出本次真正交付的承诺子集/数量。 */
  deliveredDeliverables?: CorrespondenceCommitmentDeliverable[];
  appliedOperationIds?: string[];
}

export type NarratorRelationshipAdmissionFact =
  | NarratorHeroineRelationshipAdmissionFact
  | NarratorBondRelationshipAdmissionFact;

export interface NarratorHeroineRelationshipAdmissionFact {
  sourceRefId: string;
  relationshipKind: 'heroine';
  npcId: string;
  stage: string;
  relationshipRole: string;
  summary: string;
  currentPull?: string;
  riskNotes?: string;
  promiseNotes?: string;
  source?: string;
}

export interface NarratorBondRelationshipAdmissionFact {
  sourceRefId: string;
  relationshipKind: 'bond';
  targetNpcIds?: string[];
  targetNames: string[];
  bondType: BondThreadEntry['bondType'];
  summary: string;
  currentTension?: string;
  promiseNotes?: string;
  conflictNotes?: string;
  source?: string;
}

export interface NarratorPrivateAssetAcquisitionFact {
  sourceRefId: string;
  /** 完整字段存在时，本地可直接物化严格私产命令；旧响应可继续只提供事实门禁字段。 */
  privateAssetId?: string;
  assetName: string;
  type?: PrivateAssetEntry['type'];
  ownerScope?: PrivateAssetEntry['ownerScope'];
  status?: PrivateAssetEntry['status'];
  kind: 'purchase' | 'grant' | 'inheritance' | 'construction' | 'seizure' | 'transfer';
  summary: string;
  locationId?: string;
  locationDescription?: string;
  managerNpcId?: string;
  mu?: number;
  households?: number;
  workers?: number;
  workshopScale?: PrivateAssetEntry['workshopScale'];
  ranchCapacity?: number;
  costMoney?: number;
  costGrain?: number;
}

export interface NarratorIdentityChangeFact extends Omit<
  CharacterIdentityUpdateFields,
  'currentIdentity' | 'currentIdentityDescription' | 'identitySummary' | 'personalEscortEntitlement'
> {
  sourceRefId: string;
  characterType: 'player' | 'npc';
  characterId: string;
  currentIdentity: string;
  currentIdentityDescription: string;
  identitySummary: string;
  summary: string;
  personalEscortEntitlement?: Omit<PersonalEscortEntitlement, 'updatedAt'>;
}

export interface NarratorProtagonistMemoryWriteback {
  recentTurnSummary?: string;
  keyDeed?: {
    summary: string;
    impact?: string;
    locationId?: string;
  };
}

export type NarratorProtagonistProfileWriteback = CharacterIdentityUpdateFields;

export interface NarratorNpcMemorySuggestion {
  npcId?: string;
  npcName?: string;
  source: string;
  content: string;
  eventId?: string;
}

export interface NarratorNpcProfileSuggestion {
  npcId: string;
  name: string;
  /** 仅新建人物必填；已有 npcId/稳定身份更新时可省略。 */
  persistenceReason?: NpcProfilePersistenceReason;
  /** 仅新建人物必填；简述本回合中已经成立的长期承接事实。 */
  persistenceEvidence?: string;
  courtesyName?: string | null;
  artName?: string | null;
  aliases?: string[] | null;
  commonAddress?: string | null;
  sex: '男' | '女' | '其他';
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
  femaleProfile?: LuanShiNpcFemaleProfile | null;
}

export interface NarratorLocationWriteSuggestion {
  locationId?: string;
  name: string;
  aliases?: string[];
  kind: string;
  mapLayer?: MapLayerKind;
  parentId?: string;
  parentPath?: string;
  summary: string;
  permanence: 'permanent' | 'rumor' | 'temporary';
  connectedRegionIds?: string[];
  controlHint?: string;
  tensionHint?: string;
}

export interface NarratorRouteWriteSuggestion {
  routeId?: string;
  fromPlaceId: string;
  toPlaceId: string;
  name: string;
  routeKind?: string;
  status: string;
  source?: MapRouteEdgeV1['source'];
  knownLevel: MapRouteEdgeV1['knownLevel'];
  riskLevel?: number;
  standardTravelMinutes?: number;
  travelTimeText?: string;
  notes?: string;
}

export interface NarratorQuestChangeSuggestion {
  action: 'add' | 'update' | 'complete' | 'fail' | 'invalidate' | 'archive';
  questId?: string;
  title?: string;
  summary?: string;
  currentStep?: string;
  stakes?: string;
  deadlineAt?: string;
  source?: string;
  priority?: 'low' | 'medium' | 'high';
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
  severity?: 'minor' | 'moderate' | 'major' | 'critical';
  threadId?: string;
  archiveReason?: string;
  experienceReward?: number;
}

export interface NarratorSignalChangeSuggestion {
  action: 'add' | 'update' | 'verify' | 'markFalse' | 'expire' | 'convert' | 'archive';
  rumorId?: string;
  title?: string;
  content?: string;
  source?: string;
  status?: 'open' | 'investigating' | 'verified' | 'false' | 'expired' | 'converted' | 'archived';
  signalType?: 'rumor' | 'clue' | 'report' | 'omen';
  confidence?: 'low' | 'medium' | 'high';
  potentialOutcomeSummary?: string;
  consequenceTags?: string[];
  affectedNpcIds?: string[];
  affectedFactionIds?: string[];
  affectedPlaceIds?: string[];
  affectedForceIds?: string[];
  affectedHoldingIds?: string[];
  followUpHooks?: string[];
  severity?: 'minor' | 'moderate' | 'major' | 'critical';
  relatedLocationIds?: string[];
  threadId?: string;
  expiresAt?: string;
  npcAwarenessRefs?: NpcAwarenessReference[];
  archiveReason?: string;
  convertedToQuestIds?: string[];
  convertedToWorldTrendIds?: string[];
}

export interface NarratorPlotPlanSuggestion {
  action: 'add' | 'update' | 'complete' | 'discard';
  plotId?: string;
  title?: string;
  horizon?: '近期' | '中期' | '后期';
  status?: '待触发' | '进行中' | '已完成' | '废弃';
  priority?: '低' | '中' | '高';
  summary: string;
  notBeforeAt?: string;
  lastAdvancedAt?: string;
}

export interface NarratorWorldEventSummary {
  eventId?: string;
  title?: string;
  summary: string;
  status?: 'active' | 'cooling' | 'historical' | 'corrected';
  visibility?: string;
  scope?: 'local' | 'regional' | 'realm' | 'world';
  certainty?: 'confirmed' | 'reported' | 'rumor' | 'uncertain';
  severity?: 'low' | 'medium' | 'high' | 'critical' | string;
  locationId?: string;
  presentNpcIds?: string[];
  involvedNpcIds?: string[];
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
  happenedAt?: string;
  knownToPlayer?: boolean;
  source?: string;
  archiveReason?: string;
}

export interface NarratorWorldEventUpdate {
  eventId: string;
  title?: string;
  summary?: string;
  status?: 'active' | 'cooling' | 'historical' | 'corrected';
  severity?: 'low' | 'medium' | 'high' | 'critical' | string;
  scope?: 'local' | 'regional' | 'realm' | 'world';
  certainty?: 'confirmed' | 'reported' | 'rumor' | 'uncertain';
  visibility?: string;
  locationId?: string;
  outcomeSummary?: string;
  progressSummary?: string;
  nextCheckAt?: string;
  lastAdvancedAt?: string;
  consequenceTags?: string[];
  affectedNpcIds?: string[];
  affectedFactionIds?: string[];
  affectedPlaceIds?: string[];
  affectedForceIds?: string[];
  affectedHoldingIds?: string[];
  followUpHooks?: string[];
  sourceQuestIds?: string[];
  sourceSignalIds?: string[];
  sourceConflictIds?: string[];
  npcAwarenessRefs?: NpcAwarenessReference[];
  threadId?: string;
  archiveReason?: string;
}

export interface NarratorFactionRecentActionSuggestion {
  factionId: string;
  summary: string;
  knownLevel: '亲历' | '听闻' | '推测';
  observedAt?: string;
  sourceNote?: string;
}

export interface NarratorWritebackProtocol {
  turnSummary?: NarratorTurnSummaryWriteback | null;
  protagonistProfile?: NarratorProtagonistProfileWriteback | null;
  protagonistMemory?: NarratorProtagonistMemoryWriteback | null;
  npcProfileSuggestions?: NarratorNpcProfileSuggestion[];
  npcMemorySuggestions: NarratorNpcMemorySuggestion[];
  factionRecentActionSuggestions?: NarratorFactionRecentActionSuggestion[];
  locationWriteSuggestions: NarratorLocationWriteSuggestion[];
  routeWriteSuggestions: NarratorRouteWriteSuggestion[];
  questChanges: NarratorQuestChangeSuggestion[];
  signalChanges?: NarratorSignalChangeSuggestion[];
  plotPlanSuggestions?: NarratorPlotPlanSuggestion[];
  worldEventUpdates?: NarratorWorldEventUpdate[];
  worldEventSummary?: NarratorWorldEventSummary | null;
  /** Required semantic routing decision for the current narrative boundary. */
  encounterTransitionDecision?: EncounterTransitionDecision | null;
  /**
   * Main-narrator semantic authority for completed recovery in this turn.
   * Local runtime owns all numeric HP/stamina settlement.
   */
  playerRecoveryKind?: PlayerRecoveryKind;
  /** Combat/War V2 only starts a local rules session; it never carries a model-authored outcome. */
  encounterStartIntent?: EncounterStartIntent | null;
  /** Persisted, locally validated candidates keyed by the stable sourceId of a trait/art/item/equipment entry. */
  semanticProjections?: SemanticProjection[];
  debugNotes: string[];
}

export interface NarratorResponse {
  protocolVersion?: string;
  narrativeText: string;
  suggestedActions: SuggestedAction[];
  ordinaryChecks?: TurnOrdinaryCheck[];
  statePatches?: StatePatch[];
  statePatch: StatePatch | null;
  writeback?: NarratorWritebackProtocol;
}

interface MockContext {
  bookmarkLabel: string;
  locationName: string;
  playerName: string;
  playerRole: string;
  playerPersonalMoney: number;
  crisisLabel: string;
  crisisSummary: string;
  playerInput: string;
}

/**
 * Mock 叙事生成器
 * 根据上下文和输入关键词生成有区别的叙事文本
 */
export function generateMockNarrative(context: MockContext): NarratorResponse {
  const intent = interpretAction(context.playerInput);
  const responses = getResponsesByIntent(intent, context);

  // 随机选取一个变体
  const idx = Math.floor(Math.random() * responses.length);
  const response = responses[idx];
  return {
    ...response,
    writeback: {
      turnSummary: null,
      protagonistProfile: null,
      protagonistMemory: null,
      npcProfileSuggestions: [],
      npcMemorySuggestions: [],
      factionRecentActionSuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      signalChanges: [],
      plotPlanSuggestions: [],
      worldEventUpdates: [],
      worldEventSummary: null,
      encounterTransitionDecision: null,
      encounterStartIntent: null,
      semanticProjections: [],
      playerRecoveryKind: intent === 'rest' ? 'rest' : 'none',
      debugNotes: [],
    },
  };
}

function getResponsesByIntent(
  intent: ActionIntent,
  ctx: MockContext,
): NarratorResponse[] {
  switch (intent) {
    case 'move':
      return generateMoveResponses(ctx);
    case 'inquire':
      return generateInquireResponses(ctx);
    case 'interact':
      return generateInteractResponses(ctx);
    case 'rest':
      return generateRestResponses(ctx);
    case 'trade':
      return generateTradeResponses(ctx);
    case 'explore':
      return generateExploreResponses(ctx);
    case 'combat':
      return generateCombatResponses();
    default:
      return generateDefaultResponses(ctx);
  }
}

/** 移动类行动 */
function generateMoveResponses(ctx: MockContext): NarratorResponse[] {
  const targets = [
    { loc: '官署', id: 'loc_yingchuan_office' },
    { loc: '市集', id: 'loc_yingchuan_market' },
    { loc: '驿道', id: 'loc_yingchuan_road' },
    { loc: '豪族庄园', id: 'loc_yingchuan_estate' },
    { loc: '村落', id: 'loc_yingchuan_village' },
    { loc: '黄巾活动传闻区域', id: 'loc_yingchuan_huangjin_rumor' },
  ];

  return targets.map((t) => ({
    narrativeText: `你收拾行装，沿着大道向${t.loc}而去。\n\n时值${ctx.bookmarkLabel}，路上行人稀稀落落，多是面带忧色的百姓。远处田间的庄稼长势尚好，但听说附近的村子已有不少人家弃田逃难去了。\n\n走了约莫半日，${t.loc}已在眼前。这里比起方才所见更多了几分${t.loc === '黄巾活动传闻区域' ? '紧张气氛，几个头裹黄巾的身影在巷口一闪而过' : '生气，几间铺子还开着门'}。\n\n你深呼吸一口，踏入了这片新天地。`,
    suggestedActions: [
      { label: '观察周围环境', description: '看看这里有什么值得注意的地方', actionType: 'explore' },
      { label: '打听本地消息', description: '向路人或店家询问近期听闻', actionType: 'inquire' },
      { label: '寻找落脚处', description: '先找个地方安顿下来', actionType: 'rest' },
    ],
    statePatch: {
      type: 'locationChange',
      payload: { fromLocationId: 'current', toLocationId: t.id, reason: `玩家前往${t.loc}` },
      reason: `玩家主动移动至${t.loc}`,
    },
  }));
}

/** 打听消息类行动 */
function generateInquireResponses(ctx: MockContext): NarratorResponse[] {
  const rumors = [
    '听说颍川城外最近不太平，有几个村子夜里进了贼人',
    '有人说在城南见过太平道的人在分符水，官府已经派人去查了',
    '郡府今日又贴出了征粮告示，说是朝廷平乱急需粮草',
    '荀家的小公子据说在寻访有才学的士子，不知意欲何为',
  ];

  const rumor = rumors[Math.floor(Math.random() * rumors.length)];

  return [{
    narrativeText: `你在${ctx.locationName}四处打听消息。\n\n茶肆里，几个闲人正在低声议论。你凑近了些，只听其中一人说道："${rumor}。"\n\n旁边的人立刻嘘声制止，四下张望。看到你，眼神里多了几分警惕。\n\n不过，你还是听到了些有用的东西。这年头，消息就是命。`,
    suggestedActions: [
      { label: '继续打听', description: '换个地方再探听更多消息', actionType: 'inquire' },
      { label: '追查线索', description: '顺着听到的消息深入调查', actionType: 'explore' },
      { label: '做好防备', description: '根据消息做好准备', actionType: 'other' },
    ],
    statePatch: {
      type: 'rumorAdded',
      payload: {
        rumorId: `rumor_${Date.now()}`,
        content: rumor,
        source: `${ctx.locationName}茶肆`,
        relatedRegionId: 'loc_yingchuan',
        verified: false,
      },
      reason: '玩家在茶肆打听到一则传闻',
    },
  }];
}
/** 互动类行动 */
function generateInteractResponses(ctx: MockContext): NarratorResponse[] {
  const encounters = [
    {
      name: '陈姓老吏',
      role: '小吏',
      scene: `你在${ctx.locationName}遇到了一位在衙门做了二十年文书的老吏。他看起来疲惫不堪，但眼神里透着精明。\n\n"这年头，做吏也不容易。"他叹了口气，"上头催征发，下头骂催命，我们夹在中间，两头不是人。"`,
    },
    {
      name: '游侠张横',
      role: '游侠',
      scene: `一个佩剑的汉子在街角拦住了你。他自称张横，是个游走四方的游侠。\n\n"我看你气度不凡，不像寻常百姓。"他上下打量你，"这乱世里，多条朋友多条路。要不要一起喝碗酒？"`,
    },
  ];

  const encounter = encounters[Math.floor(Math.random() * encounters.length)];

  return [{
    narrativeText: encounter.scene,
    suggestedActions: [
      { label: '深入交谈', description: `与${encounter.name}进一步攀谈`, actionType: 'interact' },
      { label: '婉拒离开', description: '礼貌告辞，继续做自己的事', actionType: 'other' },
    ],
    statePatch: {
      type: 'actorDiscovered',
      payload: {
        actorId: `actor_${encounter.name.replace(/\s/g, '_')}`,
        name: encounter.name,
        roleType: encounter.role,
        locationId: ctx.locationName,
        summary: encounter.scene.slice(0, 100),
        relationshipWithPlayer: '初次见面',
      },
      reason: `玩家在${ctx.locationName}遇到了${encounter.name}`,
    },
  }];
}
/** 休息类行动 */
function generateRestResponses(ctx: MockContext): NarratorResponse[] {
  return [{
    narrativeText: `你在${ctx.locationName}找了一处安身之所，歇息下来。\n\n窗外偶有行人匆匆而过，远处隐约传来更夫的梆子声。在这个动荡的年代，能有一处遮风挡雨的地方已是不易。\n\n你闭上眼睛，让疲惫的身体慢慢恢复。明天的事，明天再说吧。\n\n一夜无话。`,
    suggestedActions: [
      { label: '整理装备', description: '检查随身物品，为接下来的行动做准备', actionType: 'other' },
      { label: '出门看看', description: '新的一天开始了，出去看看吧', actionType: 'explore' },
    ],
    statePatch: {
      type: 'timeAdvance',
      payload: { daysAdvanced: 1, reason: '玩家休息了一夜' },
      reason: '玩家休息一天，时间推进',
    },
  }];
}
/** 交易类行动 */
function generateTradeResponses(ctx: MockContext): NarratorResponse[] {
  return [{
    narrativeText: `你来到${ctx.locationName}的市集。虽然时局不稳，但市集上仍有些摊贩在做买卖。\n\n粮价又涨了不少，一石米已要寻常人家半月的开销。布匹、盐铁也都不便宜。\n\n你转了一圈，买了些必需之物。摊贩一边收钱一边叹气："这日子，越来越难过了。"`,
    suggestedActions: [
      { label: '打听粮价走势', description: '问问粮商最近的行情', actionType: 'inquire' },
      { label: '看看其他货物', description: '在市集中继续转悠', actionType: 'explore' },
    ],
    statePatch: {
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'updatePlayerLoadout',
          characterId: 'player',
          personalMoneyDelta: -Math.min(50, Math.max(0, Math.floor(ctx.playerPersonalMoney))),
        },
      },
      reason: '玩家在市集购买物资',
    },
  }];
}
/** 探索类行动 */
function generateExploreResponses(ctx: MockContext): NarratorResponse[] {
  return [{
    narrativeText: `你在${ctx.locationName}四处走动，仔细观察周围的一切。\n\n街角的告示板上贴满了官府公文，大多是征发和缉盗的内容。墙根下坐着几个流民，神情麻木。远处一个学馆里传出朗朗书声，与这乱世景象形成奇异的对比。\n\n你发现了一些平时不会注意到的细节。`,
    suggestedActions: [
      { label: '查看告示', description: '仔细阅读官府张贴的公文', actionType: 'inquire' },
      { label: '与流民交谈', description: '听听这些流离失所的人怎么说', actionType: 'interact' },
      { label: '去学馆看看', description: '读书声传来的地方或许有故事', actionType: 'explore' },
    ],
    statePatch: {
      type: 'localSituationChanged',
      payload: { notes: [`${ctx.locationName}市面萧条，流民增多，告示多为征发类公文`] },
      reason: '玩家探索周边环境',
    },
  }];
}
/** 战斗类行动 */
function generateCombatResponses(): NarratorResponse[] {
  return [{
    narrativeText: `狭路相逢，你与对方动起手来。\n\n几个回合下来，你的衣衫已沾了尘土，气息也急促起来。对方显然也不是等闲之辈，你来我往之间谁也没占到太大便宜。\n\n"停！"对方忽然后退一步，"这乱世里，拼命不值得。今天算平手如何？"`,
    suggestedActions: [
      { label: '握手言和', description: '对方说得有理，不如化敌为友', actionType: 'interact' },
      { label: '继续追击', description: '不能轻易放过对方', actionType: 'combat' },
    ],
    statePatch: {
      type: 'localSituationChanged',
      payload: { notes: ['发生了冲突，但未分胜负'] },
      reason: '玩家卷入了一场战斗',
    },
  }];
}
/** 默认响应 */
function generateDefaultResponses(ctx: MockContext): NarratorResponse[] {
  return [{
    narrativeText: `你在${ctx.locationName}停留片刻，思考着接下来的行动。\n\n风吹过街道，卷起几片落叶。远处传来模糊的人声，不知是争吵还是寻常的寒暄。\n\n这个时代，每一天都充满了不确定。你深吸一口气，决定继续前行。`,
    suggestedActions: [
      { label: '四处走走', description: '看看周围有什么值得关注的事', actionType: 'explore' },
      { label: '打听消息', description: '找人聊聊，了解最新情况', actionType: 'inquire' },
      { label: '休息片刻', description: '找个地方歇歇脚', actionType: 'rest' },
    ],
    statePatch: null,
  }];
}
