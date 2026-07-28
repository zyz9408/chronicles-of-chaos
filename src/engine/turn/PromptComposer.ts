// ============================================================
// Engine - PromptComposer
// 组合完整 prompt 上下文（为未来接入真实 LLM 做准备）
// ============================================================

import type {
  BondThreadEntry,
  WorldBook,
  StartBookmark,
  TimelineAnchor,
  RuntimeState,
  OpeningCrisisTemplate,
  HeroineThreadEntry,
  LuanShiNpc,
  PlotPlanEntry,
  FactionLedgerEntry,
  TroopLedgerEntry,
  ResourceLedger,
  CombatRecord,
  ConflictRecord,
  HoldingLedgerEntry,
  DomesticReportEntry,
  DomesticReportResourceDelta,
  PrivateAssetEntry,
  PrivateAssetProjectEntry,
  CharacterUniqueArt,
  CharacterCheckHook,
  ActionIntent,
  Quest,
} from '../types';
import {
  CANONICAL_LOCATION_PROTOCOL_CLAUSES,
  formatCanonicalLocationProtocol,
} from '../prompts/LocationIdentityProtocol';
import {
  RELATIONSHIP_THREAD_PROJECTION_LIMITS,
  selectPromptContext,
  type NpcMemoryProjectionBlock,
  type RelationshipThreadProjection,
  type SelectedPromptContext,
} from '../state/selectPromptContext';
import { filterProtagonistNpcClones } from '../state/playerNpcBoundary';
import { isNpcPhysicallyPresent } from '../state/npcPresence';
import {
  isOpenCurrentMatter,
  resolveNpcBackgroundActivityAgainstCurrentMatters,
} from '../state/currentMatterLifecycle';
import type { SituationProjectionSectionId } from '../state/situationProjection';
import { buildCurrentMapProjection } from '../map/runtimeMap';
import { buildPromptModules, type PromptModule } from './PromptModuleRegistry';
import { formatCurrency } from '../character/currency';
import { getFameTierLabel, getMoralityTierLabel } from '../character/reputation';
import { deriveNpcCurrentAge, isAdultFemaleNpcAt } from '../time/npcAge';
import { formatGameDateLabelForNarrative } from '../time/gameClock';
import { deriveCurrentWeather, formatWeatherForPrompt } from '../time/weather';
import {
  buildMemoryContextPackage,
  formatMemoryContextPackageForPrompt,
  type MemoryContextPackage,
  type MemoryRetrievalResult,
} from '../memory';
import { resolvePromptContent, resolvePromptTemplate } from '../prompts/PromptResolver';
import {
  ADULT_INTIMACY_COMMON_PROTOCOL_TEMPLATE,
  ADULT_INTIMACY_DIRECT_REALISM_FINAL_REMINDER_TEMPLATE,
  ADULT_INTIMACY_DIRECT_REALISM_TEMPLATE,
  ADULT_INTIMACY_RELATIONSHIP_IMMERSION_FINAL_REMINDER_TEMPLATE,
  ADULT_INTIMACY_RELATIONSHIP_IMMERSION_TEMPLATE,
  NARRATIVE_PROSE_FINAL_REVIEW_TEMPLATE,
  NARRATIVE_PROSE_STYLE_GUIDE_TEMPLATE,
  RELATIONSHIP_THREAD_PROJECTION_GUIDE_TEMPLATE,
} from '../prompts/PromptContentTemplates';
import { buildNarrativeLengthGuidance } from '../prompts/NarrativeLengthGuidance';
import { formatNpcIntentPackageForPrompt, type NpcIntentSimulationPackage } from '../npc/NpcIntentSimulation';
import { buildNpcNarrativeProfileProjection } from '../narrativeQuality/NpcNarrativeProfileProjection';
import {
  buildNarrativeMomentumProjection,
  type NarrativeMomentumCue,
} from '../narrativeQuality/NarrativeMomentumProjection';
import {
  buildMilitarySupplyNarrativeProjection,
  type MilitarySupplyNarrativeProjectionData,
} from '../narrativeQuality/MilitarySupplyNarrativeProjection';
import { buildTemporalProjection } from '../time/TemporalProjection';
import {
  buildRuntimePromptTokenEstimate,
  type RuntimePromptTokenEstimate,
} from './PromptRuntimeTokenEstimate';
import {
  formatHoldingAnnualSettlementPreview,
  type HoldingAnnualSettlementPromptPreview,
} from '../holdings/HoldingAnnualSettlementRuntime';
import { projectHoldingSiegeSupply } from '../holdings/HoldingSiegeSupply';
import {
  holdingHasHouseholdAdministration,
  holdingHasLandAdministration,
  resolveHoldingCivilAdministrationScope,
} from '../holdings/HoldingCivilAdministration';
import {
  loadAdultIntimacyStyleFromStorage,
  loadPregnancyModeFromStorage,
} from '../settings/DisplaySettings';
import { getPregnancyMonth, getPregnancyStatusLabel } from '../pregnancy/PregnancyLifecycle';
import { interpretAction } from './ActionInterpreter';
import {
  ITEM_QUALITY_TIERS,
  SEMANTIC_EFFECT_CONDITIONS,
  SEMANTIC_EFFECT_OPERATIONS,
  SEMANTIC_EFFECT_TARGETS,
  SEMANTIC_EFFECT_TRIGGERS,
  TROOP_PRIMARY_CLASSES,
  TROOP_SEMANTIC_TAGS,
} from '../encounterV2/EncounterContracts';
import {
  EQUIPMENT_QUALITY_LIMITS,
  ITEM_EFFECT_LIMITS,
  UNIQUE_ART_POWER_RULES,
} from '../encounterV2/EncounterContractValidation';

export interface PromptContext {
  systemPrompt: string;
  userPrompt: string;
  adultIntimacyFinalReminder: string;
  narrativeProseFinalReview: string;
  narrativeContext: string;
  stateWriterContext: string;
  modules: PromptModule[];
  estimatedTokens: number;
  runtimeTokenEstimate: RuntimePromptTokenEstimate;
  memoryContextPackage: MemoryContextPackage;
  narrativeMomentumCue?: NarrativeMomentumCue;
  militarySupplyNarrativeProjection?: MilitarySupplyNarrativeProjectionData;
  worldBookId: string;
  timestamp: string;
}

export interface ComposePromptOptions {
  retrievedMemories?: MemoryRetrievalResult[];
  npcIntentPackage?: NpcIntentSimulationPackage;
  memoryContextPackage?: MemoryContextPackage;
  holdingAnnualSettlementPreview?: HoldingAnnualSettlementPromptPreview;
  actionIntent?: ActionIntent;
  persistentPromptGuide?: string;
}

const DEFAULT_WORLDLINE_KNOWLEDGE_PROJECTION_POLICY = [
  '世界线资料库与剧情包只提供纠偏和参考，不是铁轨。',
  '优先级：本局事实 > 玩家行动 > 当前状态/动态系统落库内容 > StoryPack 参考 > KnowledgeBase 资料 > WorldBook 基调 > 模型常识。',
  '资料提示不得强迫原史实发生，不得覆盖玩家已经造成的改变。',
  'StoryPack sourceRef 只追踪候选素材来源；被投喂不等于正文已经采用，不得因为候选出现就宣告事件发生、重开已结事项或写入状态。',
].join('\n');

function buildEncounterV2ProjectionSchemaPrompt(): string {
  const uniqueArtRules = Object.entries(UNIQUE_ART_POWER_RULES)
    .map(([powerClass, rule]) => `${powerClass}=倍率${rule.powerMultiplier}/体力${rule.staminaCost}`)
    .join('，');
  const equipmentLimits = Object.entries(EQUIPMENT_QUALITY_LIMITS)
    .map(([tier, limits]) => (
      `${tier}{伤害≤${limits.weaponBaseDamage},命中≤${limits.accuracyBonus},破甲≤${limits.armorPenetration},格挡≤${limits.blockBonus},护甲≤${limits.armorTier}}`
    ))
    .join('，');
  const itemLimits = Object.entries(ITEM_EFFECT_LIMITS)
    .map(([tier, value]) => `${tier}≤${value}`)
    .join('，');
  return [
    '## Encounter V2 能力语义投影精确结构',
    '- semanticProjections 必须是数组；每项公共必填字段为 projectionVersion=1、sourceId、status、rulesetScopes、effects、profileKind。sourceId 只能逐字复用下方 encounterV2StableSources。',
    '- status 只能 executable / narrative_only；narrative_only 必须 effects=[]。rulesetScopes 只能 personal_combat / war，且至少一项。',
    `- effects 每项必填 trigger/condition/operation/target/value/priority。trigger=${SEMANTIC_EFFECT_TRIGGERS.join('|')}。`,
    `- condition=${SEMANTIC_EFFECT_CONDITIONS.join('|')}。`,
    `- operation=${SEMANTIC_EFFECT_OPERATIONS.join('|')}。`,
    `- target=${SEMANTIC_EFFECT_TARGETS.join('|')}。value 必须是有限数字，priority 必须是整数；无法可靠选择白名单时整项写 narrative_only，不得自造枚举。`,
    '- 特质精确示例：{"projectionVersion":1,"profileKind":"ability","sourceId":"trait_稳定ID","status":"executable","rulesetScopes":["personal_combat"],"effects":[{"trigger":"battle_start","condition":"always","operation":"modify_accuracy","target":"self","value":5,"priority":10}],"sourceType":"trait","activation":"passive"}。',
    `- 绝艺 powerClass 固定档位：${uniqueArtRules}；不得自行填写其他倍率/体力。maxHits=1—5，accuracyModifier=-20—20，perEncounterLimit 为正整数；只有 light/standard 可 allowAutoUse=true。`,
    '- 绝艺精确示例：{"projectionVersion":1,"profileKind":"ability","sourceId":"art_稳定ID","status":"executable","rulesetScopes":["personal_combat"],"effects":[{"trigger":"before_attack","condition":"always","operation":"extra_attack","target":"single_enemy","value":1,"priority":20,"perEncounterLimit":1}],"sourceType":"unique_art","activation":"active","targetMode":"single_enemy","purpose":"damage","powerClass":"standard","powerMultiplier":1.35,"staminaCost":14,"accuracyModifier":0,"maxHits":2,"perEncounterLimit":1,"blockable":true,"armorPiercing":false,"canCrit":true,"allowAutoUse":true}。',
    `- 装备 qualityTier 只能 ${ITEM_QUALITY_TIERS.join('|')}；中文普通/良好/精良/珍贵/传说/绝世通常依次映射 white/green/blue/purple/orange/red。数值上限：${equipmentLimits}；speedModifier=-25—25。`,
    '- 装备精确示例：{"projectionVersion":1,"profileKind":"equipment","sourceId":"eq_稳定ID","status":"executable","rulesetScopes":["personal_combat"],"effects":[],"equipmentSlot":"weapon","qualityTier":"blue","weaponWeight":"polearm","weaponBaseDamage":12,"accuracyBonus":4,"armorPenetration":3,"speedModifier":-5}。',
    `- 战斗物品回复强度上限：${itemLimits}；combatUse=true 时必须 executable 且至少一个 effect。`,
    '- 物品精确示例：{"projectionVersion":1,"profileKind":"item","sourceId":"item_稳定ID","status":"executable","rulesetScopes":["personal_combat"],"effects":[{"trigger":"before_action","condition":"self_hp_below_30","operation":"restore_hp","target":"self","value":20,"priority":20,"perEncounterLimit":1}],"combatUse":true,"qualityTier":"green","consumable":true,"quantityPerUse":1,"perEncounterLimit":1,"allowAutoUse":false}。',
    `- 部队 primaryClass 只能 ${TROOP_PRIMARY_CLASSES.join('|')}；tags 最多 3 个且只能 ${TROOP_SEMANTIC_TAGS.join('|')}。`,
    '- 部队精确示例：{"projectionVersion":1,"profileKind":"troop","sourceId":"troop_稳定ID","status":"executable","rulesetScopes":["war"],"effects":[],"primaryClass":"infantry","tags":["defensive"]}。',
  ].join('\n');
}

const ADULT_PRIVATE_PROFILE_PROJECTION_BLOCKERS = [
  '政务',
  '军务',
  '议事',
  '议事厅',
  '公堂',
  '厅中',
  '户籍',
  '钱粮',
  '粮草',
  '治理',
  '任命',
  '征税',
  '军令',
  '行军',
  '赶路',
  '旅行',
  '出发',
  '抵达',
  '巡营',
  '战斗',
  '迎战',
  '敌兵',
  '杀敌',
  '拔刀',
  '放箭',
  '突围',
  '拜访',
  '公开',
  '宴会',
  '寒暄',
  '行礼',
  '拜见',
  '旁听',
  '众人',
];

const ADULT_PRIVATE_SCENE_TERMS = [
  '成人亲密',
  '成年亲密',
  '成人互动',
  '成人场景',
  '私密场景',
  '私密互动',
  '房事',
  '同房',
  '床笫',
  '欢好',
  '云雨',
  '合欢',
  '春宵',
  '初夜',
  '洞房',
  '性事',
  '性爱',
  '性交',
  '做爱',
  '宽衣上榻',
  '上榻',
];

const ADULT_PRIVATE_CONTINUATION_TERMS = [
  '继续',
  '延续',
  '顺着',
  '回应她',
  '回应他',
  '安抚她',
  '安抚他',
  '贴近',
  '靠近',
  '保持',
  '不要停',
  '自然延续',
];

const ADULT_PRIVATE_DISCUSSION_TERMS = [
  '打听',
  '询问',
  '谈论',
  '讨论',
  '听说',
  '讲讲',
  '问问',
];

const ADULT_PRIVATE_DIRECT_ACTION_TERMS = [
  '同房',
  '入内室',
  '房事',
  '上榻',
  '宽衣',
  '宽衣上榻',
  '成人亲密互动',
  '私密互动',
  '欢好',
  '云雨',
  '合欢',
  '春宵',
  '洞房',
  '性事',
  '性爱',
  '性交',
  '做爱',
];

const ADULT_PRIVATE_INVITATION_CONTEXT_TERMS = [
  '只有彼此',
  '是否愿意',
  '愿意',
  '邀请',
  '邀她',
  '邀他',
  '带她入内室',
  '带他入内室',
  '一起入内室',
  '是否入内室',
  '一起上榻',
  '是否上榻',
  '一起宽衣',
  '是否宽衣',
  '继续',
];

function buildAdultIntimacyGuidance(): string {
  const style = loadAdultIntimacyStyleFromStorage();
  const commonProtocol = resolvePromptContent(
    'nsfw.adultIntimacy.commonProtocol',
    ADULT_INTIMACY_COMMON_PROTOCOL_TEMPLATE,
  );
  const styleId = style === 'directRealism'
    ? 'nsfw.adultIntimacy.directRealism'
    : 'nsfw.adultIntimacy.relationshipImmersion';
  const styleTitle = style === 'directRealism' ? '直白写实' : '关系沉浸';
  const defaultStyleTemplate = style === 'directRealism'
    ? ADULT_INTIMACY_DIRECT_REALISM_TEMPLATE
    : ADULT_INTIMACY_RELATIONSHIP_IMMERSION_TEMPLATE;
  const styleGuidance = resolvePromptContent(styleId, defaultStyleTemplate);

  return [
    '## 成人亲密描写指南',
    commonProtocol,
    '',
    `## 成人亲密描写风格：${styleTitle}`,
    styleGuidance,
  ].join('\n').trim();
}

function buildAdultIntimacyFinalReminder(): string {
  return loadAdultIntimacyStyleFromStorage() === 'directRealism'
    ? ADULT_INTIMACY_DIRECT_REALISM_FINAL_REMINDER_TEMPLATE
    : ADULT_INTIMACY_RELATIONSHIP_IMMERSION_FINAL_REMINDER_TEMPLATE;
}

function buildNarrativeProseStyleGuidance(): string {
  return [
    '## 正文文风指南',
    resolvePromptContent('main.narrativeProseStyleGuide', NARRATIVE_PROSE_STYLE_GUIDE_TEMPLATE),
  ].join('\n').trim();
}

function buildNarrativeProseFinalReview(): string {
  return resolvePromptContent(
    'main.narrativeProseFinalReview',
    NARRATIVE_PROSE_FINAL_REVIEW_TEMPLATE,
  ).trim();
}

function buildRelationshipThreadProjectionGuidance(): string {
  return resolvePromptContent(
    'main.relationshipThreadProjectionGuide',
    RELATIONSHIP_THREAD_PROJECTION_GUIDE_TEMPLATE,
  );
}

/**
 * 组合生成完整 prompt 上下文
 */
export function composePrompt(
  worldBook: WorldBook,
  bookmark: StartBookmark | undefined,
  timelineAnchors: TimelineAnchor[],
  crisis: OpeningCrisisTemplate | undefined,
  runtimeState: RuntimeState,
  playerInput: string,
  options: ComposePromptOptions = {},
): PromptContext {
  const actionIntent = options.actionIntent ?? interpretAction(playerInput);
  const narrativeBaseline = resolvePromptContent('worldbook.narrativeBaseline', worldBook.prompts.narrativeBaseline);
  const forbiddenTopics = worldBook.prompts.forbiddenTopics;
  const outputFormat = worldBook.prompts.outputFormat;
  const toneGuide = resolvePromptContent('worldbook.toneGuide', worldBook.prompts.toneGuide);
  const worldlineKnowledgeProjectionPolicy = resolvePromptContent(
    'worldline.knowledgeProjectionPolicy',
    DEFAULT_WORLDLINE_KNOWLEDGE_PROJECTION_POLICY,
  );

  // 时代锚点摘要
  const anchorSummaries = timelineAnchors
    .slice(0, 3)
    .map((a) => `【${a.label}】${a.summary}`)
    .join('\n');

  // 开局书签摘要
  const bookmarkSummary = bookmark
    ? `开局书签：${bookmark.label}\n时代背景：${bookmark.situationSummary}`
    : '无特定开局书签';

  // 当前危机
  const crisisSummary = crisis
    ? `【当前危机】${crisis.label}\n${crisis.crisisSummary}\n开场提示：${crisis.firstSceneHint}`
    : '暂无特定危机';

  // 当前状态摘要
  const narrativeProjection = generateNarrativeContext(runtimeState, worldBook, playerInput, options);
  const narrativeContext = narrativeProjection.text;
  const rawStateWriterContext = generateStateWriterContext(runtimeState, worldBook, playerInput, actionIntent);
  const stateWriterContext = resolvePromptTemplate('main.stateWriterProtocol', rawStateWriterContext, {
    stateWriterContext: rawStateWriterContext,
    currentLocationId: runtimeState.currentLocationId,
    playerInput,
  });
  const modules = buildPromptModules({
    worldBook,
    runtimeState,
    narrativeContext,
    stateWriterContext,
  });
  const defaultSystemPrompt = `
${narrativeBaseline}

${toneGuide}

## 当前世界书/时代包
- 当前世界书/时代包：${worldBook.manifest.name}
- 类型：${worldBook.manifest.genre}
- 引擎层只提供通用乱世文字游戏规则；具体时代、官制、地名、人物、势力、风俗和历史压力，必须来自当前世界书、开局书签、运行状态与玩家输入。
- 不要把某个时代包里的专有设定当成所有世界都通用的底层规则。

## 世界线资料库与剧情包边界
${worldlineKnowledgeProjectionPolicy}

## 叙事节奏与时间入文规则
- 正文不得使用“公元18xx年”或状态栏式完整公元日期；需要交代年份时使用当前世界书的真实年号表达，例如“中平六年（189年）九月”，必要时可在括号中保留公元年锚点。
- 当前时间是上下文锚点，不是每回合固定开场模板；时间入文必须服务叙事，而不是把状态栏内容机械复述到正文开头。
- 大幅跳时、跨日、抵达新地点、重大军政事件、战前战后转场、等待结果、天气或城门时辰造成压力时，可以用明确时间开头，以形成史诗感或转场感。
- 普通回合优先从玩家上一轮行动的后果、眼前人物反应、现场变化开头，再自然带出“过了一盏茶”“辰时将尽”“午后城门人声渐密”等时间感。
- 正文若需要提及一天内时间，应优先使用“辰时、巳时、午时”等古代表达；确需精确时刻时可写成“辰时（08:00）”一类括注。可以用“一刻、盏茶、一炷香、半日、入夜”等叙事单位，不要把现代几点几分当成机械开场模板。
- 不要在每回合重复完整时代背景、年号背景或天下大势；只有宏观局势确实变化、玩家进入新阶段，或本回合需要强调历史压力时才重新铺陈。

## 时间写回规则
- 只要本回合叙事中有时间经过，就必须写入 timeAdvance；不要假设系统会自动推进时间。
- 若正文使用了明确时间推进或等待、赶路、疗伤等耗时描写，statePatches 必须写入 timeAdvance，且正文时间感应与写回分钟数保持一致。
- timeAdvance.payload 应优先使用 minutesAdvanced，并写明 reason 与 category。普通交谈、观察、搜查通常是 15-30 分钟；赶路、战斗、等待、军务、疗伤可能是数小时或数日；若玩家明确选择长期训练、屯田、养伤、潜伏、赶造或等待，可使用 daysAdvanced 推进数十日至一年以内。
- timeAdvance 字段范围：minutesAdvanced 1-4320、hoursAdvanced 1-72、daysAdvanced 1-365、timeBlocksAdvanced 1-36；超过三天优先使用 daysAdvanced，不得把长期推进换算成超限分钟数。
- 本地游戏历法按每月 30 天、每年 12 个月折算；长期跳时正文日期与 daysAdvanced 必须按此简化历法保持一致。
- 若涉及地点移动，按叙事常识给出合理耗时；后续地图系统会把真实出现过的路线耗时沉淀为本地基准。
- currentDate、occurredAt、updatedAt 等结构化时间必须保留精确 HH:mm 与时辰，例如“公元189年09月01日 08:30（辰时）”；不要只写“辰时”导致状态栏丢失准确时间。

## 当前时代锚点
${anchorSummaries || '暂无特定时代信息'}

## 开局设定
${bookmarkSummary}

## 当前危机
${crisisSummary}

## 禁止事项
${forbiddenTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')}

## 输出格式
${outputFormat}
`.trim();
  const currentEraDate = formatGameDateLabelForNarrative(
    runtimeState.currentDate,
    runtimeState.currentTime,
    runtimeState.calendarEras,
  );
  const eraDateRule = [
    '## 年号纪年规则',
  `- 当前日期锚点：${currentEraDate}`,
  '- 正文不得使用“公元18xx年”或完整公元日期；需要交代年份时，使用年号表达，例如“中平六年（189年）九月”。',
  '- 年号只按结构化年号表和剧情明确改元延续；皇帝死亡但无人改元时，不要凭空改元。',
  '- 结构化年号表中由剧情正式建立的新年号优先于世界书的史实兜底年号，并持续沿用到剧情再次正式改元；史实兜底不得自行把架空时间线切回史实年号。',
].join('\n');
  const defaultSystemPromptWithEraRule = `${defaultSystemPrompt}\n\n${eraDateRule}`;
  const systemPrompt = resolvePromptTemplate('main.systemPrompt', defaultSystemPromptWithEraRule, {
    'worldbook.narrativeBaseline': narrativeBaseline,
    'worldbook.toneGuide': toneGuide,
    'worldline.knowledgeProjectionPolicy': worldlineKnowledgeProjectionPolicy,
    timelineAnchors: anchorSummaries || '暂无特定时代信息',
    startBookmark: bookmarkSummary,
    openingCrisis: crisisSummary,
    forbiddenTopics: forbiddenTopics.map((t, i) => `${i + 1}. ${t}`).join('\n'),
    outputFormat,
    playerInput,
  });
  const narrativeProseStyleGuidance = buildNarrativeProseStyleGuidance();
  const narrativeLengthGuidance = buildNarrativeLengthGuidance();
  const adultIntimacyGuidance = buildAdultIntimacyGuidance();
  const narrativeProseFinalReview = buildNarrativeProseFinalReview();
  const adultIntimacyFinalReminder = buildAdultIntimacyFinalReminder();
  const nextTurnNumber = runtimeState.turnLog.length + 1;
  const promptTimestamp = new Date().toISOString();
  const encounterIntentCreatedAt = promptTimestamp;

  const defaultUserPrompt = `
## 当前游戏状态
${narrativeContext}

## 玩家行动
${playerInput}

## narrativeText 显示格式
- narrativeText 只写玩家可读正文，不写 thinking、短期记忆、命令规划、选项文本或 Markdown。
- 叙述、动作、环境、心理活动请单独成行，并以 \`【旁白】\` 开头。
- 角色直接说出口的台词请单独成行，并以 \`【角色名】\` 开头；只有玩家输入提供了逐字台词时，才可用当前主角姓名标记并忠实承接，不要使用 \`【你】\`；玩家只输入行动意图或概述时，禁止自行扩写 \`【主角名】\` 台词。
- 临时出现的军士、门吏、仆从、路人等人物只要有直接台词，也必须使用可读姓名或身份标签，例如 \`【王六】\`、\`【军士】\`、\`【门吏】\`；不要把直接台词塞进 \`【旁白】\` 段。
- 没有明确说话人的内容归入 \`【旁白】\`；不要在正文里输出 XML 标签或旧式命令块。
- 若本回合包含 ordinaryChecks，必须在 narrativeText 中把 \`[[判定:checkId]]\` 单独放在判定发生的位置。
- 若本回合写入 upsertConflictRecord 并包含战争/战事判定，必须在 narrativeText 中把 \`[[判定:battle:conflictId]]\` 单独放在对应战事裁定发生的位置。
- 只有旧式、已经在正文内完成且不进入 Combat V2 的个人冲突记录，才允许用 upsertCombatRecord 与 \`[[判定:combat:combatId]]\`。凡输出 personal_combat 触发，禁止输出 upsertCombatRecord 和 combat 判定标记；凡输出 war 触发，禁止输出 upsertConflictRecord 和 battle 判定标记。
- 判定标记的顺序是：先写触发判定的动作、疑点、交锋或战局压力，再放标记，再写判定后的可见反馈、结果余波或人物反应；不要把所有判定标记集中在开头或末尾。
- 除非存在同一 ID 的 ordinaryChecks、upsertConflictRecord 或 upsertCombatRecord，不得在 narrativeText 中输出 \`[[判定:...]]\`；不要把判定标记当成正文或提示词。

${narrativeProseStyleGuidance}

${narrativeLengthGuidance}

${adultIntimacyGuidance}

Map V1 movement rule: locationChange.toLocationId must be a concrete place ID; optional toSceneId must be a scene under toLocationId. A newly confirmed permanent story place or scene may be created in locationWriteSuggestions and entered in the same turn by reusing those exact stable IDs.

## 状态补丁协议
请根据以上所有信息，生成叙事内容和建议的状态补丁。
- 优先使用 statePatches 数组写入状态；即使只有一个状态变更，也建议放入数组。
- 如果本回合有多个状态变更，例如时间经过、事件记录、地点变化、资源变化，应全部写入 statePatches，不要因为只能写一个而省略时间。
- 只要叙事中有时间经过，statePatches 中必须包含 timeAdvance。
- 兼容旧格式：如果确实只有一个状态变更，也可以返回 statePatch；但不要同时返回 statePatch 和 statePatches。
- NPC 记忆默认写入 writeback.npcMemorySuggestions；不要把同一 NPC 的同一事件记忆同时写入 statePatches.pushNpcMemory 和 writeback.npcMemorySuggestions。
- 如果本回合正文、当前事项、风声线索或纪事中多次点名与玩家当前处境直接相关的敌方将领、朝廷重臣、军府同僚、传令使者、战略对手或历史重点人物，必须在 writeback.npcProfileSuggestions 写入人物志；即使其不在场，也应建立简要远场人物档案，不得只在正文中反复点名。
- 本回合直接出场、发话、发令、参与战斗、参与任务推进或被玩家当面处理的有名有姓人物，尤其是历史重点人物、上级、君主、重臣、将领、谋士、使者、谈判对象和战略对手，必须在 writeback.npcProfileSuggestions 建档或更新；不得只写入正文、当前事项、风声线索、天下纪事或 npcAwarenessRegistered。
- 如果当前势力账本为空，或本回合正文/任务/风声/纪事已经点名主角归属势力、对手势力、朝廷、军府、地方官府、豪族宗族等当前政治主体，必须用 upsertFactionLedger 写回相关当前势力；不得只把势力留在正文或动态条目里。

## 主剧情响应协议 V1
只返回 JSON 对象，字段建议完整包含：
- protocolVersion: 固定返回 "lsfy.turn.v1"，用于本地识别主剧情响应协议版本。
- narrativeText: 本回合正文。
- suggestedActions: 给玩家看的建议行动数组，每项包含 label、description、actionType。
- ordinaryChecks: 可选。普通日常行动存在明确不确定性，且不属于战争/个人战时，给出轻量判定展示数组；不要每回合机械输出。
- statePatches: 真正要立即写入本地状态的补丁数组；时间推进、资源变化、任务变化等核心状态必须放这里。
- statePatch: 旧兼容字段；优先使用 statePatches 时这里返回 null。
- writeback: 结构化写回对象；本地会校验并写入摘要、主角档案、主角记忆、NPC档案、NPC记忆、地图地点、路线、任务/剧情建议。时间推进等核心状态仍使用 statePatches。

Combat V2 触发协议（只负责开战，不负责胜负）：
- 当本回合叙事已经让玩家与具体敌对人物正式进入个人战、单挑、刺杀、近身突围或最多 3 对 3 的规则冲突时，在 writeback.encounterStartIntent 输出一次 personal_combat；正文停在双方正式交手前或第一击将发未发处。
- 触发回合不得裁定胜负、伤亡、俘虏、撤退、战利品或战后影响；不得输出 upsertCombatRecord。下一阶段由本地 Combat Engine 唯一裁定。
- encounterStartIntent 必须严格使用：{"contractVersion":1,"encounterId":"combat_稳定ID","kind":"personal_combat","rulesetVersion":"combat-v2.0.0","sourceTurnNumber":${nextTurnNumber},"locationId":"当前稳定地点ID","reason":"冲突缘由","seed":"combat_seed_稳定ID","createdAt":"${encounterIntentCreatedAt}","policy":{"lethality":"nonlethal|standard|fatal","allowRetreat":true,"allowSurrender":true,"allowCapture":true,"lootPolicy":"actual_items_only|none"},"playerParty":{"actorIds":["稳定角色ID，1至3名"]},"enemyParty":{"actorIds":["稳定角色ID，1至3名"]},"partySelection":"player_choice|locked"}。
- 双方 actorIds 必须逐字复用当前状态中的 player.id / npcId / actor.id，双方不得重叠；不得用姓名代替 ID，不得临时创造参战者 ID。允许玩家选同伴时用 player_choice；剧情锁定阵容时用 locked。
- 若只是口角、威胁、尚未实际交锋、纯战争调度或叙事已经完成的小动作，不要触发 Combat V2。
- writeback.semanticProjections 是能力语义解析层候选。凡本次参战者使用了尚无本地映射的特质、绝艺、装备或战斗物品，应按稳定 sourceId 输出投影；profileKind 只能是 ability/equipment/item，status 只能 executable/narrative_only，rulesetScopes 至少含 personal_combat。无法可靠落入白名单效果时必须 status=narrative_only、effects=[]，不得臆造本地规则。
- 特质是 activation=passive 的永久战斗 BUFF；绝艺是 activation=active 的技能，必须给出 targetMode、purpose、powerClass、powerMultiplier、staminaCost、accuracyModifier、maxHits、perEncounterLimit、blockable、armorPiercing、canCrit、allowAutoUse。装备投影必须给 equipmentSlot、qualityTier，可按原物品语义提供 weaponWeight/armorWeight/weaponBaseDamage/accuracyBonus/armorPenetration/blockBonus/armorTier/speedModifier。物品投影必须给 combatUse、qualityTier、consumable、quantityPerUse、perEncounterLimit，可给 allowAutoUse。

War V2 触发协议（只处理玩家亲自参与或直接指挥、已经爆发的具体军队冲突）：
- 当玩家本人正在战场并直接指挥当前账本中的具体部队，且军队冲突、攻城强攻、突围或解围已经正式爆发时，在 writeback.encounterStartIntent 输出一次 war；正文停在两军开始规则裁定之前。
- 触发回合不得裁定胜负、伤亡、俘虏、士气/补给/疲劳变化、溃散、投降、撤退、追击或领地/围城结果；不得输出 upsertConflictRecord 或 battle 判定标记。下一阶段由本地 War Engine 唯一裁定。
- 远场战争、其他势力战争、玩家只听闻/观察但不直接指挥的战事，仍使用开放叙事和既有 upsertConflictRecord；不得触发 War V2，也不得让 War V2 内部推进远场 NPC、暗流、纪事或事项。
- war intent 必须严格使用：{"contractVersion":1,"encounterId":"war_稳定ID","kind":"war","rulesetVersion":"war-v2.0.0","sourceTurnNumber":${nextTurnNumber},"locationId":"当前稳定地点ID","reason":"战争缘由","seed":"war_seed_稳定ID","createdAt":"${encounterIntentCreatedAt}","policy":{"lethality":"nonlethal|standard|fatal","allowRetreat":true,"allowSurrender":true,"allowCapture":true,"lootPolicy":"none"},"playerForce":{"troopIds":["我方稳定troopId"],"commanderActorId":"稳定角色ID，可选"},"enemyForce":{"troopIds":["敌方稳定troopId"],"commanderActorId":"稳定角色ID，可选"},"objective":"defeat_enemy|capture_holding|break_siege|relieve_siege","targetHoldingId":"领地/围城目标时必填的稳定holdingId","environmentTags":["open|difficult|fortified|water"]}。
- troopIds、commanderActorId 与 targetHoldingId 必须逐字复用当前状态中的稳定 ID；双方 troopIds 不得重叠。capture_holding / break_siege / relieve_siege 必须提供 targetHoldingId，defeat_enemy 应省略；不得按名称、兵种文案或正文临时猜 ID。
- writeback.semanticProjections 中每支参战部队应以 troopId 输出 profileKind=troop、rulesetScopes 含 war 的投影，并用 primaryClass/tags 表达本地允许的兵种与军势标签；主将特质/绝艺继续按稳定 sourceId 输出 ability 投影。无法可靠落入白名单时标为 narrative_only，不得从部队名称或正文猜本地加成。

${buildEncounterV2ProjectionSchemaPrompt()}

ordinaryChecks 结构：
[
  {
    "checkId": "稳定判定ID",
    "label": "四到八字判定名",
    "target": "对象或场景，可选",
    "ability": "相关六维，如武力/统率/智力/政治/魅力/机运，可选",
    "difficulty": 16,
    "total": 23,
    "result": "大成功/成功/勉强成功/失败/大失败等自然语言结果",
    "summary": "一句话说明为什么得到这个结果",
    "details": [
      { "label": "基础", "value": 14, "text": "智力" },
      { "label": "特质", "value": 5, "text": "谨慎敏锐" },
      { "label": "环境", "value": 4, "text": "换班混乱" }
    ],
    "tags": ["日常", "试探"]
  }
]

ordinaryChecks 边界：
- 只用于普通日常行动，例如试探、潜行、说服、辨认、搜查、追踪、临场应变；远场或玩家未直接指挥的战争仍使用 upsertConflictRecord.judgement；玩家亲自直接指挥且已正式爆发的战争进入 War V2，正式个人战进入 Combat V2，不再由主叙事直接裁定。
- 参考主角六维、特质、绝艺、装备、状态、直接参与或对抗 NPC 的六维、特质、绝艺、装备和携物、地点、天气和当前局势；特质和绝艺只能在与行动直接相关时作为 details 加成或减成。
- difficulty/total 是 UI 可复盘参考，不是状态写回；如果结果改变事实，仍要写 statePatches 或 writeback。
- 每个 ordinaryChecks[].checkId 必须在 narrativeText 中有对应独立标记 \`[[判定:checkId]]\`，标记位置就是判定卡展示位置；标记只作 UI 占位，本地会隐藏标记并显示判定卡；不得出现没有对应 ordinaryChecks 项的孤儿标记。

writeback 结构：
{
  "turnSummary": {
    "brief": "一句话概括本回合客观结果",
    "playerActionSummary": "一句话概括玩家本回合输入或意图",
    "visibleConsequence": "玩家已能观察到的后果",
    "memoryImportance": "low/medium/high"
  },
  "protagonistProfile": {
    "birthOrigin": "主角具体出身；若开局选项是概念标签，必须转成世界书内可承接的具体出身",
    "birthOriginDescription": "出身说明",
    "currentIdentity": "主角当前具体身份；若开局生成具体官职/军职，不要保留军中将校等概念标签",
    "currentIdentityDescription": "当前身份说明",
    "factionName": "可选所属势力",
    "allegianceTarget": "可选效力对象",
    "officeTitle": "可选官职",
    "militaryTitle": "可选军职",
    "nobleTitle": "可选爵位/封号",
    "identitySummary": "稳定身份摘要",
    "appearance": "稳定外貌描写；玩家未填写时由 LLM 根据开局生成",
    "personality": "稳定核心性格；玩家未填写时由 LLM 根据开局生成"
  },
  "protagonistMemory": {
    "recentTurnSummary": "一句话概括主角本回合关键行为，可用于主角过往摘要",
    "keyDeed": { "summary": "仅在本回合形成不可逆或长期重要里程碑时填写，否则省略", "impact": "对身份、势力、领地、重大关系、承诺或长期局势的持续影响", "locationId": "可选地点ID" }
  },
  "npcProfileSuggestions": [
    {
      "npcId": "稳定唯一ID",
      "name": "姓名",
      "courtesyName": "可选字",
      "artName": "可选号",
      "aliases": ["可选别称"],
      "commonAddress": "常用称呼/外号",
      "sex": "男/女/其他",
      "age": 0,
      "birthDate": "可选，出生日期/年份，如 公元156年 或 公元156年04月12日",
      "ageKnownAtDate": "可选，该 age 对应的游戏内日期；缺省时本地使用当前时间",
      "role": "人物定位",
      "factionId": "可选势力ID",
      "factionName": "可选势力名",
      "locationId": "当前地点ID",
      "isPresent": true,
      "isFocused": false,
      "birthOrigin": "可选出身",
      "currentIdentity": "当前具体身份",
      "officeTitle": "可选官职",
      "militaryTitle": "可选军职",
      "nobleTitle": "可选爵位/封号",
      "identitySummary": "身份摘要",
      "summary": "人物简介",
      "appearance": "外貌",
      "personality": "性格",
      "motivation": "核心动机",
      "relationToPlayer": "与主角关系",
      "contactLevel": 0,
      "recentAttitude": "近期态度",
      "abilityScores": { "武力": 50, "统率": 50, "智力": 50, "政治": 50, "魅力": 50, "机运": 50 },
      "traits": [
        { "id": "trait_id", "label": "特质名", "description": "说明", "source": "history/event/identity/custom", "rarity": "white/green/blue/red/gold", "promptHint": "如何影响叙事与判断", "checkHooks": [{ "scope": "适用场景", "modifier": 0, "note": "判定提示" }] }
      ],
      "femaleProfile": {
        "birthday": "女性 NPC 生日/生辰展示字段，可选；不要写出生年份/日期，出生年份/日期写 NPC 基础档案 birthDate",
        "addressToPlayer": "对主角称呼，可选",
        "appearanceDescription": "稳定外貌描写：后续正文与文生图锚点，写稳定档案真值",
        "bodyDescription": "稳定身材描写：后续正文与文生图锚点，写稳定档案真值",
        "clothingStyle": "稳定衣着风格：后续正文与文生图锚点，写稳定档案真值",
        "personalityCore": "核心性格特征",
        "affectionProgressionCondition": "好感度突破条件",
        "relationshipProgressionCondition": "关系突破条件",
        "relationshipNetwork": [{ "targetName": "对象姓名", "relationship": "关系", "notes": "备注" }],
        "relationshipNotes": "关系记录",
        "publicIntimacyNotes": "公开亲昵边界",
        "emotionalBoundary": "情绪边界",
        "adultPrivateProfile": {
          "summary": "成年私密摘要，不可替代下列长期字段",
          "breastDescription": "胸部描述：长期私密锚点/未来文生图锚点，直白具体",
          "vaginaDescription": "小穴描述：长期私密锚点/未来文生图锚点，直白具体",
          "anusDescription": "屁穴描述：长期私密锚点/未来文生图锚点，直白具体",
          "sexualPreferenceNotes": "性癖：长期信息",
          "sensitiveSpotNotes": "敏感点：长期信息",
          "preferenceNotes": "偏好记录：长期信息",
          "boundaryNotes": "边界记录：长期信息",
          "sensitiveNotes": "敏感记录：长期信息",
          "relationshipRiskNotes": "关系风险：长期信息",
          "wombProfile": { "status": "状态", "cervixStatus": "宫口状态", "inseminationRecords": [{ "date": "日期", "description": "描述", "pregnancyCheckDate": "怀孕判定日" }] },
          "virgin": true,
          "firstNightPartner": "初夜夺取者",
          "firstNightTime": "初夜时间",
          "firstNightDescription": "初夜描述",
          "updatedAt": "更新时间",
          "source": "来源"
        }
      }
    }
  ],
  "npcMemorySuggestions": [
    { "npcId": "可选，已知则必须准确", "npcName": "人物名", "source": "亲历/听闻/误会/推测", "content": "NPC应记住的内容", "eventId": "可选" }
  ],
  "locationWriteSuggestions": [
    { "locationId": "稳定地点ID", "name": "地点/场景名", "aliases": ["可选精确别名"], "kind": "县城/城邑/据点/场景等，由当前世界书语境决定", "mapLayer": "place/scene", "parentId": "canonical 父地点ID", "parentPath": "可选路径", "summary": "地点摘要", "permanence": "permanent/rumor/temporary" }
  ],
  "routeWriteSuggestions": [
    { "routeId": "required route id", "fromPlaceId": "concrete place id", "toPlaceId": "concrete place id", "name": "route name", "routeKind": "官道/水路/小路/山道/渡口等，按当前世界书语境填写", "status": "route status", "source": "llm/player/system/worldbook", "knownLevel": "亲历/听闻/推测", "riskLevel": 0, "standardTravelMinutes": 0, "travelTimeText": "optional", "notes": "optional" }
  ],
  "questChanges": [
    { "action": "add/update/complete/fail/invalidate/archive；complete/fail/invalidate 同回合进入历史归档", "questId": "可选，更新/完成/失败/失效/归档时必须复用已有 questId", "title": "可选", "summary": "任务变化摘要", "currentStep": "可选当前步骤", "stakes": "可选风险", "deadlineAt": "可选期限", "outcomeSummary": "可选已发生后果摘要", "archiveReason": "归档原因，可选", "experienceReward": "仅首次 complete 时可写 1-1000 的正整数", "consequenceTags": [], "affectedNpcIds": [], "affectedFactionIds": [], "affectedPlaceIds": [], "affectedForceIds": [], "affectedHoldingIds": [], "followUpHooks": [], "severity": "minor/moderate/major/critical 可选", "relatedNpcIds": [], "relatedLocationIds": [], "threadId": "可选事态线ID" }
  ],
  "signalChanges": [
    { "action": "add/update/verify/markFalse/expire/convert/archive", "rumorId": "可选；非 add 时必须复用已有 rumorId", "title": "可选", "content": "风声/线索/情报正文，非 add 可省略", "source": "来源", "status": "open/investigating/verified/false/expired/converted/archived 可选", "signalType": "rumor/clue/report/omen 可选", "confidence": "low/medium/high 可选", "potentialOutcomeSummary": "若属实可能造成的后果", "archiveReason": "归档原因，可选", "convertedToQuestIds": [], "convertedToWorldTrendIds": [], "consequenceTags": [], "affectedNpcIds": [], "affectedFactionIds": [], "affectedPlaceIds": [], "affectedForceIds": [], "affectedHoldingIds": [], "followUpHooks": [], "severity": "minor/moderate/major/critical 可选", "relatedLocationIds": [], "threadId": "可选事态线ID", "expiresAt": "可选" }
  ],
  "plotPlanSuggestions": [
    { "action": "add/update/complete/discard", "plotId": "可选", "title": "可选", "horizon": "近期/中期/后期", "status": "待触发/进行中/已完成/废弃", "priority": "低/中/高", "summary": "剧情计划变化摘要", "notBeforeAt": "可选，不得在此时间前解决/触发", "lastAdvancedAt": "可选，最近一次有实质推进的游戏内时间" }
  ],
  "worldEventUpdates": [
    { "eventId": "必须复用已有纪事ID", "summary": "可选更新摘要", "status": "active/cooling/historical/corrected 可选", "archiveReason": "历史化/归档原因，可选", "severity": "low/medium/high/critical 可选", "scope": "local/regional/realm/world 可选", "certainty": "confirmed/reported/rumor/uncertain 可选", "visibility": "可选", "locationId": "可选", "outcomeSummary": "可选已发生后果摘要", "progressSummary": "可选，已经成立的当前进展", "nextCheckAt": "可选，下一次需要复核的游戏内时间，不保证完成", "lastAdvancedAt": "可选，最近一次确认实质推进的时间", "consequenceTags": [], "affectedNpcIds": [], "affectedFactionIds": [], "affectedPlaceIds": [], "affectedForceIds": [], "affectedHoldingIds": [], "followUpHooks": [], "sourceQuestIds": [], "sourceSignalIds": [], "sourceConflictIds": [], "threadId": "可选事态线ID" }
  ],
  "worldEventSummary": { "eventId": "可选稳定纪事ID", "title": "可选标题", "summary": "区域以上客观事件摘要", "status": "active/cooling/historical/corrected；新纪事必填", "visibility": "私密", "scope": "regional/realm/world；新纪事必填，local 不收录", "certainty": "confirmed/reported/rumor/uncertain 可选", "severity": "low/medium/high/critical；新纪事必填", "locationId": "可选", "presentNpcIds": [], "involvedNpcIds": [], "affectedNpcIds": [], "affectedFactionIds": [], "affectedPlaceIds": [], "affectedForceIds": [], "affectedHoldingIds": [], "consequenceTags": [], "outcomeSummary": "已发生后果摘要", "progressSummary": "active/cooling 时必填，已经成立的当前进展", "nextCheckAt": "active/cooling 时与 lastAdvancedAt 至少一项，下一次复核时间", "lastAdvancedAt": "active/cooling 时与 nextCheckAt 至少一项，最近实质推进时间", "followUpHooks": [], "sourceQuestIds": [], "sourceSignalIds": [], "sourceConflictIds": [], "threadId": "可选事态线ID", "happenedAt": "可选发生时间", "knownToPlayer": true, "source": "可选情报来源", "archiveReason": "历史化/归档原因，可选" }
}

地点 canonical 身份规则：
${formatCanonicalLocationProtocol()}
`.trim();
  const resolvedUserPrompt = resolvePromptTemplate('main.userPrompt', defaultUserPrompt, {
    narrativeContext,
    stateWriterContext,
    playerInput,
    currentDate: runtimeState.currentDate,
    currentLocation: runtimeState.currentLocationId,
    memoryContext: narrativeContext,
    npcContext: narrativeContext,
    mapContext: narrativeContext,
    playerArchive: narrativeContext,
    worldbookContext: systemPrompt,
    narrativeProseStyleGuidance,
    narrativeProseFinalReview,
    adultIntimacyGuidance,
    adultIntimacyFinalReminder,
  });
  const userPromptWithoutAdultFinalReminder = adultIntimacyFinalReminder
    ? resolvedUserPrompt.replace(adultIntimacyFinalReminder, '').trim()
    : resolvedUserPrompt;
  const userPromptWithoutFinalReviews = narrativeProseFinalReview
    ? userPromptWithoutAdultFinalReminder.replace(narrativeProseFinalReview, '').trim()
    : userPromptWithoutAdultFinalReminder;
  const userPrompt = [
    userPromptWithoutFinalReviews,
    options.persistentPromptGuide?.trim(),
    narrativeProseFinalReview,
    adultIntimacyFinalReminder,
  ].filter(Boolean).join('\n\n');
  const runtimeTokenEstimate = buildRuntimePromptTokenEstimate({
    systemPrompt,
    userPrompt,
    narrativeContext,
    stateWriterContext,
    memoryContextPackage: narrativeProjection.memoryContextPackage,
    situationProjectionText: narrativeProjection.situationProjectionText,
    situationProjectionSections: narrativeProjection.situationProjectionSections,
  });

  return {
    systemPrompt,
    userPrompt,
    adultIntimacyFinalReminder,
    narrativeProseFinalReview,
    narrativeContext,
    stateWriterContext,
    modules,
    estimatedTokens: runtimeTokenEstimate.total.estimatedTokens,
    runtimeTokenEstimate,
    memoryContextPackage: narrativeProjection.memoryContextPackage,
    narrativeMomentumCue: narrativeProjection.narrativeMomentumCue,
    militarySupplyNarrativeProjection: narrativeProjection.militarySupplyNarrativeProjection,
    worldBookId: worldBook.manifest.id,
    timestamp: promptTimestamp,
  };
}

interface NarrativeContextResult {
  text: string;
  memoryContextPackage: MemoryContextPackage;
  situationProjectionText: string;
  situationProjectionSections: Array<{
    id: SituationProjectionSectionId;
    label: string;
    text: string;
  }>;
  narrativeMomentumCue?: NarrativeMomentumCue;
  militarySupplyNarrativeProjection?: MilitarySupplyNarrativeProjectionData;
}

/** 生成正文叙事用状态摘要，尽量少暴露内部 ID。 */
function generateNarrativeContext(
  state: RuntimeState,
  worldBook: WorldBook,
  playerInput: string,
  options: ComposePromptOptions = {},
): NarrativeContextResult {
  const selected = selectPromptContext(state, { queryTexts: [playerInput] });
  const mapProjection = buildCurrentMapProjection(worldBook, state);
  const adultPrivateProfileNpcIds = selectAdultPrivateProfileProjectionNpcIds(state, selected, playerInput);
  const memoryContextPackage = options.memoryContextPackage
    ?? buildMemoryContextPackage(state, playerInput, {
      retrievedMemories: options.retrievedMemories,
    });
  const parts: string[] = [];

  const narrativeDate = formatGameDateLabelForNarrative(selected.currentDate, state.currentTime, state.calendarEras);
  parts.push(`当前日期：${narrativeDate}`);
  parts.push(`当前地点：${selected.currentLocation?.name ?? selected.currentLocationId}`);
  parts.push(formatWeatherForPrompt(deriveCurrentWeather(state)));
  if (typeof state.worldStateDelta.openingLocationPath === 'string' && state.worldStateDelta.openingLocationPath.trim()) {
    parts.push(`开局路径：${state.worldStateDelta.openingLocationPath}`);
  }
  if (typeof state.worldStateDelta.openingSceneName === 'string' && state.worldStateDelta.openingSceneName.trim()) {
    parts.push(`当前场景：${state.worldStateDelta.openingSceneName}`);
  }
  parts.push(`玩家：${state.player.name}（${state.player.roleType} / ${state.player.socialClass ?? '未知'}）`);
  parts.push(...buildMapNarrativeContext(mapProjection));
    parts.push(buildPlayerArchiveContext(selected.player, worldBook, state.worldStateDelta.openingExtraRequest, playerInput));
  parts.push(...formatMemoryContextPackageForPrompt(memoryContextPackage, { includeNpcMemoryBlocks: false }));
  const resolvedCurrentMatterContinuity = formatResolvedCurrentMatterContinuity(
    selected.resolvedCurrentMatters,
  );
  if (resolvedCurrentMatterContinuity) {
    parts.push(resolvedCurrentMatterContinuity);
  }
  const ledgerProjection = formatLedgerProjection(
    selected.resources,
    selected.playerResources,
    selected.relevantFactions,
    selected.relevantTroops,
    state.conflicts ?? [],
    selected.relevantHoldings,
    selected.relevantCombatRecords,
    state.privateAssets ?? [],
    state.privateAssetProjects ?? [],
    state.domesticReports ?? [],
    state.turnLog.length,
  );
  if (ledgerProjection) {
    parts.push(ledgerProjection);
  }

  if (options.holdingAnnualSettlementPreview) {
    parts.push(formatHoldingAnnualSettlementPreview(options.holdingAnnualSettlementPreview));
  }

  const militarySupplyNarrativeProjection = buildMilitarySupplyNarrativeProjection(state);
  if (militarySupplyNarrativeProjection.text) {
    parts.push(militarySupplyNarrativeProjection.text);
  }

  if (selected.currentLocation) {
    parts.push(`地点摘要：${selected.currentLocation.summary}`);
  }

  if (selected.presentNpcs.length > 0 || selected.focusedNpcs.length > 0) {
    parts.push('人物叙事边界：人物底档用于稳定判断与行动取向，应与本回合记忆、关系和意图共同使用；不得机械复读为固定口癖，也不得让档案覆盖本局新事实。');
  }

  if (selected.presentNpcs.length > 0) {
    parts.push(
      `在场人物：${selected.presentNpcs
        .map((npc) => formatNpcNarrative(state, npc, selected.currentDate, playerInput, adultPrivateProfileNpcIds.has(npc.npcId)))
        .join('；')}`,
    );
  }

  if (selected.focusedNpcs.length > 0) {
    parts.push(
      `相关人物：${selected.focusedNpcs
        .map((npc) => formatNpcNarrative(state, npc, selected.currentDate, playerInput, adultPrivateProfileNpcIds.has(npc.npcId)))
        .join('；')}`,
    );
  }

  if (memoryContextPackage.npcMemoryBlocks.length > 0) {
    parts.push(formatNpcMemoryProjection(memoryContextPackage.npcMemoryBlocks, state.calendarEras));
  }

  const relationshipThreadProjection = formatRelationshipThreadProjection(
    selected.relationshipThreads,
    state.calendarEras,
  );
  if (relationshipThreadProjection) {
    parts.push(relationshipThreadProjection);
  }

  if (options.npcIntentPackage && options.npcIntentPackage.intents.length > 0) {
    parts.push(formatNpcIntentPackageForPrompt(options.npcIntentPackage));
  }

  if (selected.recentTurnEvents.length > 0) {
    parts.push(
      `近期事件：${selected.recentTurnEvents
        .map((event) => `${formatGameDateLabelForNarrative(event.happenedAt, undefined, state.calendarEras)} ${event.summary}`)
        .join('；')}`,
    );
  }

  if (state.knownActors.length > 0) {
    parts.push(`已知人物：${state.knownActors.map((a) => `${a.name}(${a.roleType})`).join('、')}`);
  }

  if (selected.situationProjection.text) {
    parts.push(selected.situationProjection.text);
  }

  const temporalProjection = buildTemporalProjection(state);
  if (temporalProjection.text) {
    parts.push(temporalProjection.text);
  }

  if (selected.localSituationNotes.length > 0) {
    parts.push(`当地情况：${selected.localSituationNotes.join('；')}`);
  }

  const narrativeMomentumProjection = buildNarrativeMomentumProjection({
    currentDate: selected.currentDate,
    currentTime: state.currentTime,
    currentMatters: selected.activeQuests,
    plotPlans: selected.relevantPlotPlans,
    remoteNpcBeats: selected.remoteNpcPresenceBeats,
    trends: selected.relevantWorldTrends,
    signals: selected.relevantSignals,
  });
  if (narrativeMomentumProjection.text) {
    parts.push(narrativeMomentumProjection.text);
  }

  return {
    text: parts.join('\n'),
    memoryContextPackage,
    situationProjectionText: selected.situationProjection.text,
    situationProjectionSections: selected.situationProjection.sections.map((section) => ({
      id: section.id,
      label: section.label,
      text: section.text,
    })),
    narrativeMomentumCue: narrativeMomentumProjection.cue,
    militarySupplyNarrativeProjection: militarySupplyNarrativeProjection.data,
  };
}

function formatPlotPlanForPrompt(plan: PlotPlanEntry): string {
  return [
    plan.title,
    `plotId=${plan.plotId}`,
    `horizon=${plan.horizon}`,
    `status=${plan.status}`,
    `priority=${plan.priority}`,
    plan.notBeforeAt ? `notBeforeAt=${plan.notBeforeAt}` : '',
    plan.lastAdvancedAt ? `lastAdvancedAt=${plan.lastAdvancedAt}` : '',
    `summary=${plan.description}`,
  ].filter(Boolean).join('；');
}

function formatNpcMemoryProjection(
  blocks: NpcMemoryProjectionBlock[],
  calendarEras?: RuntimeState['calendarEras'],
): string {
  const lines = ['NPC记忆投影：'];

  for (const block of blocks) {
    const scopeText = block.scope === 'present' ? '在场' : '离场关注';
    const importanceText = block.importance === 'important' ? '重要' : '普通';
    lines.push(`- ${block.npcName}（${scopeText}/${importanceText}，近期${block.memories.length}/${block.totalMemoryCount}条）`);

    for (const summary of block.longTermSummaries) {
      lines.push(`  - 长期｜${summary.fromCreatedAt}-${summary.toCreatedAt}：${summary.summary}`);
    }

    for (const summary of block.midTermSummaries) {
      lines.push(`  - 中期｜${summary.fromCreatedAt}-${summary.toCreatedAt}：${summary.summary}`);
    }

    for (const memory of block.memories) {
      const rawTimeText = memory.createdAt?.trim();
      const timeText = rawTimeText ? formatGameDateLabelForNarrative(rawTimeText, undefined, calendarEras) : '时间缺失';
      lines.push(`  - ${timeText}｜${memory.source}：${memory.content}`);
    }

    for (const memory of block.retrievedMemories) {
      const rawTimeText = memory.time?.trim();
      const timeText = rawTimeText
        ? formatGameDateLabelForNarrative(rawTimeText, undefined, calendarEras)
        : '时间缺失';
      lines.push(`  - 定向召回｜${timeText}：${memory.text}`);
    }

    if (block.omittedMemoryCount > 0) {
      lines.push(`  - 已省略${block.omittedMemoryCount}条较早记忆；本地仍完整保留。`);
    }
  }

  return lines.join('\n');
}

function formatRelationshipThreadProjection(
  projection: RelationshipThreadProjection,
  calendarEras?: RuntimeState['calendarEras'],
): string | undefined {
  if (projection.heroineThreads.length === 0 && projection.bondThreads.length === 0) return undefined;

  const lines = ['关系线承接（已成立长期关系线）：'];

  if (projection.heroineThreads.length > 0) {
    lines.push('红颜关系线：');
    for (const thread of projection.heroineThreads) {
      lines.push(...formatHeroineThreadProjectionLines(thread, calendarEras));
    }
  }

  if (projection.bondThreads.length > 0) {
    lines.push('羁绊关系线：');
    for (const thread of projection.bondThreads) {
      lines.push(...formatBondThreadProjectionLines(thread, calendarEras));
    }
  }

  if (projection.omittedHeroineThreadCount > 0 || projection.omittedBondThreadCount > 0) {
    lines.push(
      `- 已按相关性和 token 预算省略：红颜${projection.omittedHeroineThreadCount}条，羁绊${projection.omittedBondThreadCount}条；本地关系线仍完整保留。`,
    );
  }

  lines.push('', '关系线提示纪律：', buildRelationshipThreadProjectionGuidance());

  return capRelationshipThreadProjection(lines.join('\n'));
}

function formatHeroineThreadProjectionLines(
  thread: HeroineThreadEntry,
  calendarEras?: RuntimeState['calendarEras'],
): string[] {
  const lines = [
    `- 红颜｜${thread.npcName}｜heroineThreadId=${thread.heroineThreadId}｜npcId=${thread.npcId}｜status=${thread.status}｜stage=${thread.stage}｜role=${thread.relationshipRole}`,
    `  摘要：${compactPromptText(thread.summary)}`,
  ];
  appendOptionalThreadLine(lines, '牵引', thread.currentPull);
  appendOptionalThreadLine(lines, '承诺', thread.promiseNotes);
  appendOptionalThreadLine(lines, '风险', thread.riskNotes);
  appendOptionalThreadLine(lines, '进展', thread.recentProgress);
  appendTagsLine(lines, thread.tags);
  appendMilestonesLine(lines, thread.milestones, calendarEras);
  return lines;
}

function formatBondThreadProjectionLines(
  thread: BondThreadEntry,
  calendarEras?: RuntimeState['calendarEras'],
): string[] {
  const lines = [
    `- 羁绊｜${thread.targetNames.join('、')}｜bondThreadId=${thread.bondThreadId}｜type=${thread.bondType}｜status=${thread.status}`,
    `  摘要：${compactPromptText(thread.summary)}`,
  ];
  appendOptionalThreadLine(lines, '张力', thread.currentTension);
  appendOptionalThreadLine(lines, '承诺', thread.promiseNotes);
  appendOptionalThreadLine(lines, '冲突', thread.conflictNotes);
  appendOptionalThreadLine(lines, '进展', thread.recentProgress);
  appendTagsLine(lines, thread.tags);
  appendMilestonesLine(lines, thread.milestones, calendarEras);
  return lines;
}

function appendOptionalThreadLine(lines: string[], label: string, value: string | undefined): void {
  const text = compactPromptText(value);
  if (text) lines.push(`  ${label}：${text}`);
}

function appendTagsLine(lines: string[], tags: string[] | undefined): void {
  const selectedTags = (tags ?? [])
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, RELATIONSHIP_THREAD_PROJECTION_LIMITS.tagsPerThread);
  if (selectedTags.length > 0) {
    lines.push(`  标签：${selectedTags.join('、')}`);
  }
}

function appendMilestonesLine(
  lines: string[],
  milestones: Array<{ happenedAt: string; summary: string }> | undefined,
  calendarEras?: RuntimeState['calendarEras'],
): void {
  const selectedMilestones = (milestones ?? []).slice(-RELATIONSHIP_THREAD_PROJECTION_LIMITS.milestonesPerThread);
  if (selectedMilestones.length === 0) return;

  lines.push(
    `  里程碑：${selectedMilestones
      .map((milestone) => `${formatGameDateLabelForNarrative(milestone.happenedAt, undefined, calendarEras)} ${compactPromptText(milestone.summary, 80)}`)
      .join('；')}`,
  );
}

function compactPromptText(value: string | undefined, maxLength = 140): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function capRelationshipThreadProjection(text: string): string {
  const budget = RELATIONSHIP_THREAD_PROJECTION_LIMITS.textBudgetChars;
  if (text.length <= budget) return text;

  const suffix = '\n- 关系线承接已按 token 预算截断；本地完整关系线仍保留。';
  return `${text.slice(0, Math.max(0, budget - suffix.length))}${suffix}`;
}

function formatLedgerProjection(
  resources: ResourceLedger,
  playerResources: Record<string, number>,
  factions: FactionLedgerEntry[],
  troops: TroopLedgerEntry[],
  conflicts: ConflictRecord[],
  holdings: HoldingLedgerEntry[],
  combatRecords: CombatRecord[],
  privateAssets: PrivateAssetEntry[],
  privateAssetProjects: PrivateAssetProjectEntry[],
  domesticReports: DomesticReportEntry[],
  currentTurn: number,
): string {
  const lines: string[] = [];
  const resourceLine = formatResourceLedger(resources, playerResources);
  if (resourceLine) {
    lines.push(resourceLine);
  }

  if (factions.length > 0) {
    lines.push(`势力账本：${factions.map(formatFactionLedgerLine).join('；')}`);
  }

  if (troops.length > 0) {
    lines.push(`部队账本：${troops.map(formatTroopLedgerLine).join('；')}`);
  }

  if (holdings.length > 0) {
    lines.push(`领地账本：${holdings.map((holding) => formatHoldingLedgerLine(holding, currentTurn)).join('；')}`);
  }

  const activePrivateAssets = privateAssets
    .filter((asset) => asset.status !== 'archived')
    .slice(0, 6);
  if (activePrivateAssets.length > 0) {
    lines.push(`私人产业账本：${activePrivateAssets.map(formatPrivateAssetLedgerLine).join('；')}`);
  }

  const activePrivateProjects = privateAssetProjects
    .filter((project) => project.status !== 'completed' && project.status !== 'cancelled')
    .slice(0, 5);
  if (activePrivateProjects.length > 0) {
    lines.push(`私产工程账本：${activePrivateProjects.map(formatPrivateAssetProjectLine).join('；')}`);
  }

  const recentConflicts = conflicts.slice(-5);
  if (recentConflicts.length > 0) {
    lines.push(`战事记录：${recentConflicts.map(formatConflictRecordLine).join('；')}`);
  }

  if (combatRecords.length > 0) {
    lines.push(`个人战记录：${combatRecords.map(formatCombatRecordLine).join('；')}`);
  }

  const recentDomesticReports = domesticReports.slice(-3);
  if (recentDomesticReports.length > 0) {
    lines.push(`内政报告：${recentDomesticReports.map(formatDomesticReportLine).join('；')}`);
  }

  return lines.join('\n');
}

function formatResourceLedger(
  resources: ResourceLedger,
  playerResources: Record<string, number>,
): string {
  const parts = [
    resources.money > 0 ? `钱财${resources.money}` : '',
    resources.grain > 0 ? `粮草${resources.grain}` : '',
    resources.horses > 0 ? `马匹${resources.horses}` : '',
    resources.arms > 0 ? `军械${resources.arms}` : '',
    resources.recruits > 0 ? `可征召人手${resources.recruits}` : '',
    resources.weapons.length > 0 ? `兵械：${resources.weapons.join('、')}` : '',
    resources.documents.length > 0 ? `文书：${resources.documents.join('、')}` : '',
    resources.tokens.length > 0 ? `信物：${resources.tokens.join('、')}` : '',
    resources.importantSupplies.length > 0 ? `重要补给：${resources.importantSupplies.join('、')}` : '',
  ].filter(Boolean);
  const playerResourceParts = Object.entries(playerResources)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => `${name}${value}`);

  if (playerResourceParts.length > 0) {
    parts.push(`玩家资源：${playerResourceParts.join('、')}`);
  }

  return parts.length > 0 ? `资源账本：${parts.join('；')}` : '';
}

function formatHoldingLedgerLine(holding: HoldingLedgerEntry, currentTurn: number): string {
  const civilScope = resolveHoldingCivilAdministrationScope(holding);
  const hasHouseholdAdministration = holdingHasHouseholdAdministration(holding);
  const hasLandAdministration = holdingHasLandAdministration(holding);
  const siegeProjection = projectHoldingSiegeSupply(holding, currentTurn);
  return [
    holding.name,
    `holdingId=${holding.holdingId}`,
    `type=${holding.type}`,
    `status=${holding.status}`,
    `scale=${holding.scaleLevel}`,
    `civilAdministrationScope=${civilScope}`,
    holding.locationId ? `locationId=${holding.locationId}` : '',
    holding.factionId ? `factionId=${holding.factionId}` : '',
    holding.nominalAllegiance ? `名义归属=${holding.nominalAllegiance}` : '',
    holding.actualController ? `实际控制=${holding.actualController}` : '',
    holding.stewardNpcId ? `主事=${holding.stewardNpcId}` : '',
    hasLandAdministration && holding.farmlandMu !== undefined ? `田亩=${holding.farmlandMu}` : '',
    hasHouseholdAdministration && holding.registeredHouseholds !== undefined ? `编户=${holding.registeredHouseholds}` : '',
    hasHouseholdAdministration && holding.eliteControlledShare !== undefined ? `地方豪强掌控=${holding.eliteControlledShare}%` : '',
    hasHouseholdAdministration && holding.localEliteRelation !== undefined ? `地方豪强关系=${formatSignedNumber(holding.localEliteRelation)}` : '',
    siegeProjection ? `围城=${siegeProjection.siegeStatusText}` : '',
    siegeProjection ? `补给线=${siegeProjection.supplyLineText}` : '',
    siegeProjection ? `备战储备=${siegeProjection.preparationText}` : '',
    siegeProjection ? `守城补给=${siegeProjection.supplyText}` : '',
    hasLandAdministration ? `农业=${holding.agriculture}` : '',
    hasHouseholdAdministration ? `商贸=${holding.commerce}` : '',
    hasHouseholdAdministration ? `人口=${holding.population}` : '',
    hasHouseholdAdministration ? `治安=${holding.publicOrder}` : '',
    hasHouseholdAdministration ? `民心=${holding.popularSupport}` : '',
    `城防=${holding.defense}`,
    hasHouseholdAdministration ? `兵源=${holding.recruitPotential}` : '',
    `军械=${holding.armory}`,
    `马源=${holding.horseSupply}`,
    hasHouseholdAdministration && holding.corruption !== undefined ? `腐败=${holding.corruption}` : '',
    holding.garrisonTroopIds && holding.garrisonTroopIds.length > 0 ? `驻防部队=${holding.garrisonTroopIds.join('/')}` : '',
    holding.relatedNpcIds && holding.relatedNpcIds.length > 0 ? `相关人物=${holding.relatedNpcIds.join('/')}` : '',
    holding.riskNotes && holding.riskNotes.length > 0 ? `风险=${holding.riskNotes.join('/')}` : '',
    holding.recentChanges && holding.recentChanges.length > 0 ? `近况=${holding.recentChanges.join('/')}` : '',
    holding.sourceNote ? `来源=${holding.sourceNote}` : '',
    `更新=${holding.updatedAt}`,
    holding.summary,
  ].filter(Boolean).join('，');
}

function formatPrivateAssetLedgerLine(asset: PrivateAssetEntry): string {
  return [
    asset.name,
    `privateAssetId=${asset.privateAssetId}`,
    `type=${asset.type}`,
    `ownerScope=${asset.ownerScope}`,
    `status=${asset.status}`,
    asset.locationId ? `locationId=${asset.locationId}` : '',
    asset.locationDescription ? `位置=${asset.locationDescription}` : '',
    asset.managerNpcId ? `主事=${asset.managerNpcId}` : '',
    asset.mu !== undefined ? `亩=${asset.mu}` : '',
    asset.households !== undefined ? `户=${asset.households}` : '',
    asset.workers !== undefined ? `人手=${asset.workers}` : '',
    asset.workshopScale !== undefined ? `工坊=${asset.workshopScale}` : '',
    asset.ranchCapacity !== undefined ? `牧场=${asset.ranchCapacity}` : '',
    asset.conditionNotes && asset.conditionNotes.length > 0 ? `状态=${asset.conditionNotes.join('/')}` : '',
    asset.riskNotes && asset.riskNotes.length > 0 ? `风险=${asset.riskNotes.join('/')}` : '',
    asset.recentChanges && asset.recentChanges.length > 0 ? `近况=${asset.recentChanges.join('/')}` : '',
    asset.sourceNote ? `来源=${asset.sourceNote}` : '',
    `更新=${asset.updatedAt}`,
    asset.summary,
  ].filter(Boolean).join('，');
}

function formatPrivateAssetProjectLine(project: PrivateAssetProjectEntry): string {
  return [
    project.title,
    `projectId=${project.projectId}`,
    `assetId=${project.assetId}`,
    `type=${project.type}`,
    `status=${project.status}`,
    `startedAt=${project.startedAt}`,
    project.expectedCompleteAt ? `expectedCompleteAt=${project.expectedCompleteAt}` : '',
    project.investedMoney !== undefined ? `money=${project.investedMoney}` : '',
    project.investedGrain !== undefined ? `grain=${project.investedGrain}` : '',
    formatPrivateProjectDelta(project.targetDelta),
    project.riskNotes && project.riskNotes.length > 0 ? `风险=${project.riskNotes.join('/')}` : '',
    project.progressNotes && project.progressNotes.length > 0 ? `进展=${project.progressNotes.join('/')}` : '',
    `更新=${project.updatedAt}`,
  ].filter(Boolean).join('，');
}

function formatPrivateProjectDelta(delta?: PrivateAssetProjectEntry['targetDelta']): string {
  if (!delta) return '';
  return [
    delta.mu !== undefined ? `mu${delta.mu >= 0 ? '+' : ''}${delta.mu}` : '',
    delta.households !== undefined ? `households${delta.households >= 0 ? '+' : ''}${delta.households}` : '',
    delta.workers !== undefined ? `workers${delta.workers >= 0 ? '+' : ''}${delta.workers}` : '',
    delta.workshopScale !== undefined ? `workshopScale${delta.workshopScale >= 0 ? '+' : ''}${delta.workshopScale}` : '',
    delta.ranchCapacity !== undefined ? `ranchCapacity${delta.ranchCapacity >= 0 ? '+' : ''}${delta.ranchCapacity}` : '',
  ].filter(Boolean).join('/');
}

function formatDomesticReportLine(report: DomesticReportEntry): string {
  return [
    report.title,
    `reportId=${report.reportId}`,
    `year=${report.year}`,
    `settledAt=${report.settledAt}`,
    `income=${formatDomesticDelta(report.income)}`,
    `expenses=${formatDomesticDelta(report.expenses)}`,
    `net=${formatDomesticDelta(report.netChange)}`,
    report.warnings && report.warnings.length > 0 ? `warnings=${report.warnings.join('/')}` : '',
    report.summary,
  ].filter(Boolean).join('，');
}

function formatDomesticDelta(delta: DomesticReportResourceDelta): string {
  return [
    delta.money !== 0 ? `money=${delta.money}` : '',
    delta.grain !== 0 ? `grain=${delta.grain}` : '',
    delta.horses !== 0 ? `horses=${delta.horses}` : '',
    delta.arms !== 0 ? `arms=${delta.arms}` : '',
    delta.recruits !== 0 ? `recruits=${delta.recruits}` : '',
  ].filter(Boolean).join('/') || '0';
}

function formatFactionLedgerLine(faction: FactionLedgerEntry): string {
  return [
    faction.name,
    `factionId=${faction.factionId}`,
    faction.aliases && faction.aliases.length > 0 ? `别名=${faction.aliases.join('/')}` : '',
    faction.type,
    `known=${faction.knownLevel}`,
    `stance=${faction.stanceToPlayer}`,
    faction.nominalAllegiance ? `名义归属=${faction.nominalAllegiance}` : '',
    faction.legalIdentity ? `合法身份=${faction.legalIdentity}` : '',
    faction.actualController ? `实际主事=${faction.actualController}` : '',
    faction.knownSphere ? `范围=${faction.knownSphere}` : '',
    faction.corePersonNpcIds && faction.corePersonNpcIds.length > 0 ? `核心人物=${faction.corePersonNpcIds.join('/')}` : '',
    faction.knownMemberNpcIds && faction.knownMemberNpcIds.length > 0 ? `成员=${faction.knownMemberNpcIds.join('/')}` : '',
    faction.relatedTroopIds && faction.relatedTroopIds.length > 0 ? `关联部队=${faction.relatedTroopIds.join('/')}` : '',
    faction.sourceNote ? `来源=${faction.sourceNote}` : '',
    faction.lastKnownAt ? `消息时间=${faction.lastKnownAt}` : '',
    faction.updatedAt ? `更新=${faction.updatedAt}` : '',
    faction.summary,
    faction.recentActions.length > 0 ? `recent=${faction.recentActions.join('/')}` : '',
  ].filter(Boolean).join('，');
}

function formatTroopLedgerLine(troop: TroopLedgerEntry): string {
  return [
    troop.name,
    `troopId=${troop.troopId}`,
    troop.aliases && troop.aliases.length > 0 ? `别名=${troop.aliases.join('/')}` : '',
    `size=${troop.size}`,
    troop.previousSize !== undefined ? `规模变化=${troop.previousSize}->${troop.size}` : '',
    troop.factionId ? `factionId=${troop.factionId}` : '',
    troop.previousFactionId ? `previousFactionId=${troop.previousFactionId}` : '',
    troop.allegianceChangedAt ? `allegianceChangedAt=${troop.allegianceChangedAt}` : '',
    troop.allegianceChangeReason ? `allegianceChangeReason=${troop.allegianceChangeReason}` : '',
    troop.troopType ? `兵种=${troop.troopType}` : '',
    troop.specialDesignation ? `番号=${troop.specialDesignation}` : '',
    troop.quality ? `素质=${troop.quality}` : '',
    troop.fatigue ? `疲劳=${troop.fatigue}` : '',
    troop.readiness ? `整备=${troop.readiness}` : '',
    troop.lifecycleStatus ? `状态=${troop.lifecycleStatus}` : '',
    troop.statusTags && troop.statusTags.length > 0 ? `状态标记=${troop.statusTags.join('/')}` : '',
    troop.locationId ? `locationId=${troop.locationId}` : '',
    troop.lastKnownLocationId ? `lastKnownLocationId=${troop.lastKnownLocationId}` : '',
    troop.orderStatus ? `orderStatus=${troop.orderStatus}` : '',
    troop.orderIssuedAt ? `orderIssuedAt=${troop.orderIssuedAt}` : '',
    troop.orderDeliveredAt ? `orderDeliveredAt=${troop.orderDeliveredAt}` : '',
    troop.orderSummary ? `orderSummary=${troop.orderSummary}` : '',
    troop.destinationLocationId ? `destinationLocationId=${troop.destinationLocationId}` : '',
    troop.routeId ? `routeId=${troop.routeId}` : '',
    troop.movementStatus ? `movementStatus=${troop.movementStatus}` : '',
    troop.departedAt ? `departedAt=${troop.departedAt}` : '',
    troop.estimatedArrivalAt ? `estimatedArrivalAt=${troop.estimatedArrivalAt}` : '',
    troop.arrivedAt ? `arrivedAt=${troop.arrivedAt}` : '',
    troop.movementNotes ? `movementNotes=${troop.movementNotes}` : '',
    troop.lastKnownAt ? `消息时间=${troop.lastKnownAt}` : '',
    troop.knownLevel ? `known=${troop.knownLevel}` : '',
    troop.certainty ? `certainty=${troop.certainty}` : '',
    troop.leaderNpcId ? `leaderNpcId=${troop.leaderNpcId}` : '',
    `morale=${troop.morale}`,
    `training=${troop.training}`,
    `supplies=${troop.supplies}`,
    `task=${troop.task}`,
    `relation=${troop.relationToPlayer}`,
    troop.parentTroopId ? `parent=${troop.parentTroopId}` : '',
    troop.childTroopIds && troop.childTroopIds.length > 0 ? `children=${troop.childTroopIds.join('/')}` : '',
    troop.mergedFromTroopIds && troop.mergedFromTroopIds.length > 0 ? `mergedFrom=${troop.mergedFromTroopIds.join('/')}` : '',
    troop.mergedIntoTroopId ? `mergedInto=${troop.mergedIntoTroopId}` : '',
    troop.destroyedInBattleId ? `destroyedIn=${troop.destroyedInBattleId}` : '',
    troop.lastBattleId ? `lastBattle=${troop.lastBattleId}` : '',
    troop.strengthTrend ? `trend=${troop.strengthTrend}` : '',
    troop.lastChangeReason ? `变化原因=${troop.lastChangeReason}` : '',
    troop.updatedAt ? `更新=${troop.updatedAt}` : '',
  ].filter(Boolean).join('，');
}

function formatConflictRecordLine(conflict: ConflictRecord): string {
  return [
    conflict.title,
    `conflictId=${conflict.conflictId}`,
    `type=${conflict.type}`,
    conflict.scope ? `scope=${conflict.scope}` : '',
    conflict.recordLevel ? `record=${conflict.recordLevel}` : '',
    conflict.locationName ?? conflict.locationId ? `地点=${conflict.locationName ?? conflict.locationId}` : '',
    `发生=${conflict.occurredAt}`,
    conflict.sides && conflict.sides.length > 0 ? `双方=${conflict.sides.join('/')}` : '',
    conflict.involvedTroopIds && conflict.involvedTroopIds.length > 0 ? `部队=${conflict.involvedTroopIds.join('/')}` : '',
    conflict.involvedFactionIds && conflict.involvedFactionIds.length > 0 ? `势力=${conflict.involvedFactionIds.join('/')}` : '',
    conflict.result ? `结果=${conflict.result}` : '',
    `结局=${conflict.outcome}`,
    conflict.troopEffects && conflict.troopEffects.length > 0 ? `部队影响=${conflict.troopEffects.join('/')}` : '',
    conflict.resultLevel ? `resultLevel=${conflict.resultLevel}` : '',
    conflict.judgement ? formatConflictJudgementBrief(conflict.judgement) : '',
    conflict.turningPoints && conflict.turningPoints.length > 0
      ? `turningPoints=${conflict.turningPoints.map((point) => `${point.type}:${point.summary}`).join('/')}`
      : '',
    conflict.resultTags && conflict.resultTags.length > 0 ? `resultTags=${conflict.resultTags.join('/')}` : '',
    conflict.relatedTrendIds && conflict.relatedTrendIds.length > 0 ? `relatedTrends=${conflict.relatedTrendIds.join('/')}` : '',
    conflict.summary,
  ].filter(Boolean).join('，');
}

function formatSignedNumber(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatCombatRecordLine(combat: CombatRecord): string {
  const locationText = combat.locationName ?? combat.locationId;
  const participants = combat.participants
    .map((participant) => [
      participant.name,
      participant.npcId ? `npcId=${participant.npcId}` : '',
      `side=${participant.side}`,
      participant.role ? `role=${participant.role}` : '',
      participant.outcome ? `outcome=${participant.outcome}` : '',
    ].filter(Boolean).join('/'))
    .join(' vs ');

  return [
    combat.title,
    `combatId=${combat.combatId}`,
    `kind=${combat.kind}`,
    `significance=${combat.significance}`,
    locationText ? `地点=${locationText}` : '',
    `发生=${combat.occurredAt}`,
    participants ? `参与=${participants}` : '',
    combat.playerInvolved ? 'playerInvolved=true' : '',
    `resultLevel=${combat.resultLevel}`,
    combat.outcomeTags && combat.outcomeTags.length > 0 ? `outcomeTags=${combat.outcomeTags.join('/')}` : '',
    `outcome=${combat.outcome}`,
    combat.judgement ? formatCombatJudgementBrief(combat.judgement) : '',
    combat.relatedNpcIds && combat.relatedNpcIds.length > 0 ? `relatedNpcs=${combat.relatedNpcIds.join('/')}` : '',
    combat.relatedConflictIds && combat.relatedConflictIds.length > 0 ? `relatedConflicts=${combat.relatedConflictIds.join('/')}` : '',
    combat.relatedQuestIds && combat.relatedQuestIds.length > 0 ? `relatedQuests=${combat.relatedQuestIds.join('/')}` : '',
    combat.relatedTrendIds && combat.relatedTrendIds.length > 0 ? `relatedTrends=${combat.relatedTrendIds.join('/')}` : '',
    combat.briefText ? `brief=${compactPromptText(combat.briefText, 90)}` : '',
    combat.summary,
  ].filter(Boolean).join('，');
}

function formatConflictJudgementBrief(judgement: NonNullable<ConflictRecord['judgement']>): string {
  const score = judgement.scoreBreakdown;
  const scoreParts = [
    score?.troopBase !== undefined ? `troopBase=${score.troopBase}` : '',
    score?.commander !== undefined ? `commander=${score.commander}` : '',
    score?.tactical !== undefined ? `tactical=${score.tactical}` : '',
    score?.turningPoint !== undefined ? `turningPoint=${score.turningPoint}` : '',
    score?.playerAction !== undefined ? `playerAction=${score.playerAction}` : '',
    score?.total !== undefined ? `total=${score.total}` : '',
  ].filter(Boolean).join('/');

  return [
    `judgement=${judgement.method}`,
    judgement.baselineAdvantage ? `baseline=${judgement.baselineAdvantage}` : '',
    scoreParts ? `score=${scoreParts}` : '',
    judgement.underdogReason ? `underdogReason=${judgement.underdogReason}` : '',
  ].filter(Boolean).join(',');
}

function formatCombatJudgementBrief(judgement: NonNullable<CombatRecord['judgement']>): string {
  const score = judgement.scoreBreakdown;
  const scoreParts = [
    score?.personalBase !== undefined ? `personalBase=${score.personalBase}` : '',
    score?.equipment !== undefined ? `equipment=${score.equipment}` : '',
    score?.status !== undefined ? `status=${score.status}` : '',
    score?.environment !== undefined ? `environment=${score.environment}` : '',
    score?.combatMethod !== undefined ? `combatMethod=${score.combatMethod}` : '',
    score?.uniqueArts !== undefined ? `uniqueArts=${score.uniqueArts}` : '',
    score?.playerAction !== undefined ? `playerAction=${score.playerAction}` : '',
    score?.turningPoint !== undefined ? `turningPoint=${score.turningPoint}` : '',
    score?.total !== undefined ? `total=${score.total}` : '',
  ].filter(Boolean).join('/');

  return [
    `judgement=${judgement.method}`,
    judgement.perspectiveSide ? `side=${judgement.perspectiveSide}` : '',
    judgement.advantageBand ? `advantage=${judgement.advantageBand}` : '',
    scoreParts ? `score=${scoreParts}` : '',
    judgement.decisiveMoment ? `decisive=${judgement.decisiveMoment}` : '',
    judgement.underdogReason ? `underdogReason=${judgement.underdogReason}` : '',
  ].filter(Boolean).join(',');
}

function buildMapNarrativeContext(mapProjection: ReturnType<typeof buildCurrentMapProjection>): string[] {
  const parts: string[] = [];

  if (mapProjection.displayPath) {
    parts.push(`当前位置路径：${mapProjection.displayPath}`);
  }
  if (mapProjection.currentPlace) {
    parts.push(`当前具体地点：${mapProjection.currentPlace.name}（${mapProjection.currentPlace.level}）——${mapProjection.currentPlace.summary}`);
  }
  if (mapProjection.currentScene) {
    parts.push(`当前场景：${mapProjection.currentScene.name}——${mapProjection.currentScene.summary}`);
  }
  if (mapProjection.scenes.length > 0) {
    parts.push(`地点内场景：${mapProjection.scenes.map((scene) => `${scene.name}（${scene.summary}）`).join('；')}`);
  }
  if (mapProjection.nearbyRoutes.length > 0) {
    parts.push(`附近路线：${mapProjection.nearbyRoutes.map((route) => {
      const travelText = route.travelTimeText
        ? `，${route.travelTimeText}`
        : route.standardTravelMinutes
          ? `，约${route.standardTravelMinutes}分钟`
          : '';
      const riskText = route.riskLevel != null ? `，风险${route.riskLevel}` : '';
      const kindText = route.routeKind ? `${route.routeKind}，` : '';
      return `${route.name} -> ${route.toPlaceName}（${kindText}${route.status}${travelText}${riskText}）`;
    }).join('；')}`);
  }

  return parts;
}

function selectAdultPrivateProfileProjectionNpcIds(
  state: RuntimeState,
  selected: SelectedPromptContext,
  playerInput: string,
): Set<string> {
  const candidates = filterProtagonistNpcClones(state, state.npcs ?? [])
    .filter((npc) => hasProjectableAdultPrivateProfile(npc, selected.currentDate));
  if (candidates.length === 0) return new Set();

  const currentInput = playerInput.trim();
  if (!currentInput || containsAny(currentInput, ADULT_PRIVATE_PROFILE_PROJECTION_BLOCKERS)) return new Set();

  const allowedNpcIds = new Set<string>();
  if (hasExplicitAdultPrivateAction(currentInput) && !isAdultTopicDiscussionOnly(currentInput)) {
    for (const npc of candidates) {
      if (npcIdentityMentioned(npc, currentInput)) {
        allowedNpcIds.add(npc.npcId);
      }
    }

  }

  const recentPrivateSceneText = buildRecentAdultPrivateSceneText(state);
  if (recentPrivateSceneText && isPrivateSceneContinuation(currentInput)) {
    const currentMentionedNpcIds = candidates
      .filter((npc) => npcIdentityMentioned(npc, currentInput))
      .map((npc) => npc.npcId);
    const targetCandidates = currentMentionedNpcIds.length > 0
      ? candidates.filter((npc) => currentMentionedNpcIds.includes(npc.npcId))
      : candidates;
    for (const npc of targetCandidates) {
      if (npcIdentityMentioned(npc, recentPrivateSceneText)) {
        allowedNpcIds.add(npc.npcId);
      }
    }
  }

  return allowedNpcIds;
}

function hasProjectableAdultPrivateProfile(npc: LuanShiNpc, currentDate: string): boolean {
  const adultProfile = npc.femaleProfile?.adultPrivateProfile;
  return Boolean(
    npc.sex === '女'
      && adultProfile
      && adultProfile.enabled !== false
      && adultProfile.ageConfirmedAdult !== false
      && isAdultFemaleNpcAt(npc, currentDate),
  );
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function isAdultTopicDiscussionOnly(text: string): boolean {
  return containsAny(text, ADULT_PRIVATE_DISCUSSION_TERMS) && !hasExplicitAdultPrivateAction(text);
}

function hasExplicitAdultPrivateAction(text: string): boolean {
  if (!containsAny(text, ADULT_PRIVATE_DIRECT_ACTION_TERMS)) return false;
  if (!containsAny(text, ADULT_PRIVATE_DISCUSSION_TERMS)) return true;
  return containsAny(text, ADULT_PRIVATE_INVITATION_CONTEXT_TERMS);
}

function buildRecentAdultPrivateSceneText(state: RuntimeState): string {
  return (state.turnLog ?? [])
    .slice(-2)
    .map((entry) => [
      entry.playerInput,
      entry.narrativeText,
      entry.fullNarrativeText ?? '',
    ].join('\n'))
    .filter((text) => containsAny(text, ADULT_PRIVATE_SCENE_TERMS))
    .join('\n');
}

function isPrivateSceneContinuation(text: string): boolean {
  return containsAny(text, ADULT_PRIVATE_CONTINUATION_TERMS) || containsAny(text, ADULT_PRIVATE_SCENE_TERMS);
}

function formatNpcNarrative(
  state: RuntimeState,
  npc: LuanShiNpc,
  currentDate: string,
  playerInput: string,
  includeAdultPrivateProfile = false,
): string {
  const narrativeProfile = buildNpcNarrativeProfileProjection(npc, { playerInput });
  const parts = [
    npc.courtesyName ? `字${npc.courtesyName}` : '',
    npc.artName ? `号${npc.artName}` : '',
    npc.aliases && npc.aliases.length > 0 ? `别称：${npc.aliases.join('、')}` : '',
    npc.commonAddress ? `常用称呼：${npc.commonAddress}` : '',
    npc.currentIdentity ? `当前身份：${npc.currentIdentity}` : npc.role ? `身份：${npc.role}` : '',
    npc.factionName || npc.factionId ? `所属势力：${npc.factionName ?? npc.factionId}` : '',
    npc.allegianceTarget ? `效力对象：${npc.allegianceTarget}` : '',
    npc.officeTitle ? `官职：${npc.officeTitle}` : '',
    npc.militaryTitle ? `军职：${npc.militaryTitle}` : '',
    npc.nobleTitle ? `爵位/封号：${npc.nobleTitle}` : '',
    npc.identitySummary ? `身份摘要：${npc.identitySummary}` : '',
    ...narrativeProfile.parts,
    formatNpcBackgroundActivity(state, npc),
    formatNpcAbilityScores(npc),
    formatNpcTraits(npc),
    formatNpcUniqueArts(npc),
    formatNpcEffects(npc),
    formatNpcFemaleProfile(npc, currentDate, includeAdultPrivateProfile),
    `态度：${npc.recentAttitude}`,
    `关系：${npc.relationToPlayer}`,
  ].filter(Boolean);

  return `${npc.name}（${parts.join('，')}）`;
}

function pushOptionalText(parts: string[], label: string, value?: string | null): void {
  if (typeof value !== 'string' || value.trim().length === 0) return;
  parts.push(`${label}：${value.trim()}`);
}

function pushOptionalBoolean(parts: string[], label: string, value?: boolean): void {
  if (typeof value !== 'boolean') return;
  parts.push(`${label}：${value ? '是' : '否'}`);
}

function formatFemaleProfileRelationshipNetwork(profile: LuanShiNpc['femaleProfile']): string {
  return (profile?.relationshipNetwork ?? [])
    .filter((entry) => entry.targetName?.trim() && entry.relationship?.trim())
    .map((entry) => {
      const base = `${entry.targetName.trim()}=${entry.relationship.trim()}`;
      return entry.notes?.trim() ? `${base}(${entry.notes.trim()})` : base;
    })
    .join('；');
}

function formatFemaleProfileWombRecords(profile: LuanShiNpc['femaleProfile']): string {
  return (profile?.adultPrivateProfile?.wombProfile?.inseminationRecords ?? [])
    .filter((record) => record.date?.trim() && record.description?.trim())
    .map((record) => {
      const base = `${record.date.trim()}=${record.description.trim()}`;
      return record.pregnancyCheckDate?.trim()
        ? `${base}(怀孕判定日:${record.pregnancyCheckDate.trim()})`
        : base;
    })
    .join('；');
}

function formatNpcBackgroundActivity(state: RuntimeState, npc: LuanShiNpc): string {
  const activity = resolveNpcBackgroundActivityAgainstCurrentMatters(
    npc.backgroundActivity,
    state.activeQuests ?? [],
    state.currentDate,
  );
  if (!activity) return '';
  const isTerminal = activity.status === 'completed' || activity.status === 'cancelled';
  const details = [
    isTerminal
      ? `已结束后台行动（不可作为当前待办续写）：${activity.summary}`
      : `后台行动：${activity.summary}`,
    `activityId=${activity.activityId}`,
    `status=${activity.status}`,
    activity.locationId ? `locationId=${activity.locationId}` : '',
    activity.startedAt ? `startedAt=${activity.startedAt}` : '',
    activity.dueAt ? `dueAt=${activity.dueAt}` : '',
    activity.visibility ? `visibility=${activity.visibility}` : '',
  ].filter(Boolean);
  return details.join('；');
}

function formatPregnancyNarrativeFact(npc: LuanShiNpc, currentDate: string): string {
  const pregnancy = npc.femaleProfile?.adultPrivateProfile?.wombProfile?.pregnancy;
  if (!pregnancy || pregnancy.status === 'pendingCheck' || !isAdultFemaleNpcAt(npc, currentDate)) return '';

  const parts = [getPregnancyStatusLabel(pregnancy.status)];
  const month = getPregnancyMonth(currentDate, pregnancy);
  if (month !== undefined && pregnancy.status !== 'postpartum') parts.push(`孕期第${month}月`);
  if (pregnancy.estimatedDueAt && pregnancy.status !== 'postpartum') parts.push(`预计分娩：${pregnancy.estimatedDueAt}`);
  if (pregnancy.fatherCharacterIds.includes('player')) parts.push('父系：主角');
  if (pregnancy.paternityStatus === 'uncertain') parts.push('父系未定');
  return parts.join('、');
}

function formatNpcFemaleProfile(npc: LuanShiNpc, currentDate: string, includeAdultPrivateProfile = false): string {
  const profile = npc.femaleProfile;
  if (!profile || npc.sex !== '女') return '';

  const publicParts: string[] = [];
  pushOptionalText(publicParts, '生日', profile.birthday);
  pushOptionalText(publicParts, '对主角称呼', profile.addressToPlayer);
  pushOptionalText(publicParts, '关系记录', profile.relationshipNotes);
  pushOptionalText(publicParts, '公开亲昵边界', profile.publicIntimacyNotes);
  pushOptionalText(publicParts, '外貌描写', profile.appearanceDescription);
  pushOptionalText(publicParts, '身材描写', profile.bodyDescription);
  pushOptionalText(publicParts, '衣着风格', profile.clothingStyle);
  pushOptionalText(publicParts, '外貌补充', profile.appearanceExtension);
  pushOptionalText(publicParts, '核心性格特征', profile.personalityCore);
  pushOptionalText(publicParts, '好感度突破条件', profile.affectionProgressionCondition);
  pushOptionalText(publicParts, '关系突破条件', profile.relationshipProgressionCondition);
  pushOptionalText(publicParts, '关系网变量', formatFemaleProfileRelationshipNetwork(profile));
  pushOptionalText(publicParts, '情绪边界', profile.emotionalBoundary);
  pushOptionalText(publicParts, '怀孕事实', formatPregnancyNarrativeFact(npc, currentDate));

  const adultParts: string[] = [];
  const adultProfile = profile.adultPrivateProfile;
  if (includeAdultPrivateProfile && adultProfile && isAdultFemaleNpcAt(npc, currentDate) && adultProfile.enabled !== false && adultProfile.ageConfirmedAdult !== false) {
    pushOptionalText(adultParts, '私密摘要', adultProfile.summary);
    pushOptionalText(adultParts, '胸部描述', adultProfile.breastDescription);
    pushOptionalText(adultParts, '小穴描述', adultProfile.vaginaDescription);
    pushOptionalText(adultParts, '屁穴描述', adultProfile.anusDescription);
    pushOptionalText(adultParts, '性癖', adultProfile.sexualPreferenceNotes);
    pushOptionalText(adultParts, '敏感点', adultProfile.sensitiveSpotNotes);
    pushOptionalText(adultParts, '偏好记录', adultProfile.preferenceNotes);
    pushOptionalText(adultParts, '边界记录', adultProfile.boundaryNotes);
    pushOptionalText(adultParts, '敏感记录', adultProfile.sensitiveNotes);
    pushOptionalText(adultParts, '关系风险', adultProfile.relationshipRiskNotes);
    pushOptionalText(adultParts, '子宫状态', adultProfile.wombProfile?.status);
    pushOptionalText(adultParts, '宫口状态', adultProfile.wombProfile?.cervixStatus);
    pushOptionalText(adultParts, '内射记录', formatFemaleProfileWombRecords(profile));
    pushOptionalBoolean(adultParts, '是否处女', adultProfile.virgin);
    pushOptionalText(adultParts, '初夜夺取者', adultProfile.firstNightPartner);
    pushOptionalText(adultParts, '初夜时间', adultProfile.firstNightTime);
    pushOptionalText(adultParts, '初夜描述', adultProfile.firstNightDescription);
  }

  const parts = [
    publicParts.length > 0 ? `女性档案：${publicParts.join('；')}` : '',
    adultParts.length > 0 ? `成人私密档案：${adultParts.join('；')}` : '',
  ].filter(Boolean);

  return parts.join('，');
}

function formatNpcAbilityScores(npc: LuanShiNpc): string {
  if (!npc.abilityScores) return '';
  const ordered = ['武力', '统率', '智力', '政治', '魅力', '机运'];
  const entries = [
    ...ordered
      .filter((label) => typeof npc.abilityScores?.[label] === 'number')
      .map((label) => [label, npc.abilityScores?.[label]] as const),
    ...Object.entries(npc.abilityScores).filter(([label]) => !ordered.includes(label)),
  ];
  if (entries.length === 0) return '';
  return `能力：${entries.map(([label, value]) => `${label}${value}`).join('、')}`;
}

function formatNpcTraits(npc: LuanShiNpc): string {
  if (!npc.traits || npc.traits.length === 0) return '';
  return `特质：${npc.traits.map((trait) => {
    const hint = trait.promptHint ? `；${trait.promptHint}` : '';
    const hooks = trait.checkHooks && trait.checkHooks.length > 0
      ? `；promptHint/checkHooks：${trait.checkHooks.map((hook) => `${hook.scope}${hook.modifier != null ? `${hook.modifier >= 0 ? '+' : ''}${hook.modifier}` : ''}（${hook.note}）`).join('、')}`
      : '';
    return `${trait.label}（${trait.description}${hint}${hooks}）`;
  }).join('、')}`;
}

function formatNpcEffects(npc: LuanShiNpc): string {
  if (!npc.effects || npc.effects.length === 0) return '';
  return `状态：${npc.effects.map((effect) => {
    const hint = effect.promptHint ? `；${effect.promptHint}` : '';
    return `${effect.label}（${effect.type}/${effect.duration}，${effect.description}${hint}）`;
  }).join('、')}`;
}

function formatUniqueArtLevel(art: CharacterUniqueArt): string {
  const maxLevel = art.maxLevel ? `/${art.maxLevel}` : '';
  const progress = typeof art.progress === 'number'
    ? `，进度${Math.max(0, Math.min(100, Math.round(art.progress)))}%`
    : '';
  return `Lv.${art.level}${maxLevel}${progress}`;
}

function formatUniqueArtForPrompt(art: CharacterUniqueArt): string {
  const rarity = art.rarity ? `/${art.rarity}` : '';
  const domain = art.domain ? `/${art.domain}` : '';
  const hint = art.promptHint ? `；提示=${art.promptHint}` : '';
  const hooks = art.checkHooks && art.checkHooks.length > 0
    ? `；checkHooks=${art.checkHooks.map((hook) => `${hook.scope}:${hook.modifier ?? 0}${hook.note ? `(${hook.note})` : ''}`).join('、')}`
    : '';
  return `${art.name}（${art.id}${rarity}${domain}，${formatUniqueArtLevel(art)}，${art.effectSummary}${hint}${hooks}）`;
}

function formatPlayerUniqueArts(player: RuntimeState['player']): string {
  if (!player.uniqueArts || player.uniqueArts.length === 0) return '';
  return `绝艺：${player.uniqueArts.map(formatUniqueArtForPrompt).join('、')}`;
}

function formatNpcUniqueArts(npc: LuanShiNpc): string {
  if (!npc.uniqueArts || npc.uniqueArts.length === 0) return '';
  return `绝艺：${npc.uniqueArts.map(formatUniqueArtForPrompt).join('、')}`;
}

function formatPlayerNameLine(player: RuntimeState['player']): string {
  const nameParts = [
    player.courtesyName ? `字${player.courtesyName}` : '',
    player.artName ? `号${player.artName}` : '',
  ].filter(Boolean);
  const aliasText = player.aliases && player.aliases.length > 0 ? `；别称：${player.aliases.join('、')}` : '';
  return `姓名：${player.name}${nameParts.length > 0 ? `，${nameParts.join('，')}` : ''}${aliasText}`;
}

function buildPlayerArchiveContext(
  player: RuntimeState['player'],
  worldBook: WorldBook,
  openingExtraRequest?: unknown,
  playerInput = '',
): string {
  const hiddenAbilityKeys = new Set(worldBook.characterOptions?.hiddenAbilityKeys ?? []);
  const abilityText = player.abilityScores
    ? Object.entries(player.abilityScores)
        .filter(([key]) => !hiddenAbilityKeys.has(key))
        .map(([key, value]) => `${key}${value}`)
        .join('、')
    : '';
  const archiveLines = [
        formatPlayerNameLine(player),
    player.sex || player.age ? `性别年龄：${player.sex ?? '未知'}，${player.age ?? '未知'}岁` : '',
    player.birthOrigin ? `出身：${player.birthOrigin}` : '',
    player.birthOriginDescription ? `出身说明：${player.birthOriginDescription}` : '',
    player.currentIdentity ? `当前身份：${player.currentIdentity}` : '',
    player.currentIdentityDescription ? `身份说明：${player.currentIdentityDescription}` : '',
    player.commonAddress ? `常用称呼：${player.commonAddress}` : '',
    player.factionName || player.factionId ? `所属势力：${player.factionName ?? player.factionId}` : '',
    player.allegianceTarget ? `效力对象：${player.allegianceTarget}` : '',
    player.officeTitle ? `官职：${player.officeTitle}` : '',
    player.militaryTitle ? `军职：${player.militaryTitle}` : '',
    player.nobleTitle ? `爵位/封号：${player.nobleTitle}` : '',
    player.identitySummary ? `身份摘要：${player.identitySummary}` : '',
    player.appearance ? `外貌：${player.appearance}` : '',
    player.personality ? `性格：${player.personality}` : '',
    abilityText ? `能力：${abilityText}` : '',
    formatPlayerProgress(player),
    formatPlayerVitals(player),
    formatPlayerReputation(player),
    formatPlayerTraits(player),
    formatPlayerUniqueArts(player),
    formatPlayerEffects(player),
    formatPlayerEquipment(player),
    formatPlayerInventory(player, playerInput),
    typeof player.personalMoney === 'number' ? `个人钱财：${formatCurrency(player.personalMoney)}` : '',
    formatPlayerMemory(player),
    player.situationSummary ? `开局处境：${player.situationSummary}` : '',
  ].filter(Boolean);
  const guidanceLines = [
    player.appearance
      ? '外貌用于 NPC 第一印象、称呼反应、场景描写和他人是否容易识别主角。'
      : '',
    player.personality
      ? '性格必须影响主角默认行事风格、情绪触发点、接受阈值与关系边界；除非玩家明确输入或剧情压力足够，不要让主角突然做出与性格相反的主动行为。'
      : '',
  ].filter(Boolean);

  return [
    '主角档案：',
    archiveLines.length > 0 ? archiveLines.map((line) => `- ${line}`).join('\n') : '- 暂无补充档案。',
    buildOpeningExtraRequestContext(player, openingExtraRequest),
    guidanceLines.length > 0
      ? `主角叙事约束：\n${guidanceLines.map((line) => `- ${line}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n');
}

function formatPlayerProgress(player: RuntimeState['player']): string {
  if (player.level == null && player.xp == null && player.growthPoints == null) return '';
  return `阅历：Lv.${player.level ?? 1}，经验 ${player.xp ?? 0}，成长点 ${player.growthPoints ?? 0}`;
}

function formatPlayerVitals(player: RuntimeState['player']): string {
  if (!player.vitals) return '';
  return `生命：${player.vitals.hp}/${player.vitals.maxHp}，体力：${player.vitals.stamina}/${player.vitals.maxStamina}`;
}

function formatPlayerReputation(player: RuntimeState['player']): string {
  if (!player.reputation) return '';
  const moralityText = `${player.reputation.morality}（${getMoralityTierLabel(player.reputation.morality)}）`;
  const fameText = `${player.reputation.fame}（${getFameTierLabel(player.reputation.fame)}）`;
  const tags = player.reputation.tags.length > 0
    ? `，标签：${player.reputation.tags.map((tag) => `${tag.label}${tag.source ? `（${tag.source}）` : ''}`).join('、')}`
    : '';
  const summary = player.reputation.summary ? `；${player.reputation.summary}` : '';
  return `声名：德行：${moralityText}，名声：${fameText}${tags}${summary}`;
}

function formatPlayerTraits(player: RuntimeState['player']): string {
  if (!player.traits || player.traits.length === 0) return '';
  return `特质：${player.traits.map((trait) => {
    const hint = trait.promptHint ? `；${trait.promptHint}` : '';
    return `${trait.label}（${trait.description}${hint}）`;
  }).join('、')}`;
}

function formatPlayerEffects(player: RuntimeState['player']): string {
  if (!player.effects || player.effects.length === 0) return '';
  return `当前状态：${player.effects.map((effect) => {
    const typeText = effect.type === 'buff' ? '增益' : effect.type === 'debuff' ? '减益' : '混合';
    const hint = effect.promptHint ? `；${effect.promptHint}` : '';
    return `${effect.label}（${typeText}/${effect.duration}，${effect.description}${hint}）`;
  }).join('、')}`;
}

function formatPlayerEquipment(player: RuntimeState['player']): string {
  if (!player.equipment || player.equipment.length === 0) return '';
  const slotNames: Record<string, string> = {
    weapon: '武器',
    armor: '防具',
    mount: '坐骑',
    treasure: '宝物',
  };
  return `装备：${player.equipment.map((item) => {
    const details = [
      item.quality,
      item.condition ? `状态=${item.condition}` : '',
    ].filter(Boolean);
    return `${slotNames[item.slot] ?? item.slot}-${item.name}${details.length > 0 ? `（${details.join('，')}）` : ''}`;
  }).join('、')}`;
}

function formatPlayerInventory(player: RuntimeState['player'], playerInput = ''): string {
  if (!player.inventory || player.inventory.length === 0) return '';
  const relevantItems = selectRelevantPlayerInventory(player, playerInput);
  if (relevantItems.length === 0) return '';
  return `当前相关背包：${relevantItems.map((item) => formatInventoryItemBrief(item)).join('、')}`;
}

function selectRelevantPlayerInventory(player: RuntimeState['player'], playerInput: string) {
  return (player.inventory ?? [])
    .filter((item) => isInventoryItemRelevant(item, playerInput))
    .slice(0, 6);
}

function appendPlayerEconomyWritebackSnapshot(
  parts: string[],
  player: RuntimeState['player'],
): void {
  const inventory = player.inventory ?? [];
  parts.push('playerEconomySnapshot:');
  parts.push(`- personalMoney: ${typeof player.personalMoney === 'number' && Number.isFinite(player.personalMoney) ? player.personalMoney : 0}`);
  parts.push(`- inventoryCount: ${inventory.length}`);
  parts.push('- currentPlayerInventory 是写回前完整背包真值，不是获得候选；仅在玩家行动与最终正文已经成立的事实要求变化时才写入变更。');
  if (inventory.length === 0) {
    parts.push('- currentPlayerInventory: empty');
    return;
  }
  parts.push('- currentPlayerInventory:');
  for (const item of inventory) {
    const details = [
      `itemId: ${item.id}`,
      `name: ${item.name}`,
      `quantity: ${item.quantity}`,
      item.category ? `category: ${item.category}` : '',
      item.keyItem ? 'keyItem: true' : 'keyItem: false',
      item.equipSlot ? `equipSlot: ${item.equipSlot}` : '',
    ].filter(Boolean);
    parts.push(`  - ${details.join('; ')}`);
  }
}

function formatNpcLoadout(npc: LuanShiNpc, playerInput: string, actionIntent: ActionIntent): string {
  const parts = [
    formatNpcEquipment(npc.equipment, playerInput, actionIntent),
    formatNpcInventory(npc.inventory, playerInput, actionIntent),
  ].filter(Boolean);
  return parts.length > 0 ? `npcLoadout: ${parts.join('；')}` : '';
}

function formatNpcEquipment(
  equipment: LuanShiNpc['equipment'] | undefined,
  playerInput: string,
  actionIntent: ActionIntent,
): string {
  if (!equipment || equipment.length === 0) return '';
  const slotNames: Record<string, string> = {
    weapon: '武器',
    armor: '防具',
    mount: '坐骑',
    treasure: '宝物',
  };
  return `装备=${equipment.map((item) => {
    const details = [
      item.quality,
      item.condition ? `状态=${item.condition}` : '',
      formatLoadoutStatBonuses(item.statBonuses),
      item.promptHint ? `promptHint=${item.promptHint}` : '',
      formatLoadoutCheckHooks(item.checkHooks, actionIntent, isLoadoutItemTextRelevant(item, playerInput)),
      item.unlocks && item.unlocks.length > 0 ? `unlocks=${item.unlocks.join('/')}` : '',
      item.risks && item.risks.length > 0 ? `risks=${item.risks.join('/')}` : '',
    ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
    return `${slotNames[item.slot] ?? item.slot}-${item.name}${details.length > 0 ? `（${details.join('，')}）` : ''}`;
  }).join('、')}`;
}

function formatNpcInventory(
  inventory: LuanShiNpc['inventory'] | undefined,
  playerInput: string,
  actionIntent: ActionIntent,
): string {
  if (!inventory || inventory.length === 0) return '';
  const textRelevantItems = inventory.filter((item) => isLoadoutItemTextRelevant(item, playerInput));
  const textRelevantSet = new Set(textRelevantItems);
  const explicitlyRelevantItems = inventory.filter((item) => isInventoryItemRelevant(item, playerInput));
  const explicitlyRelevantSet = new Set(explicitlyRelevantItems);
  const sceneCompatibleItems = inventory.filter((item) => (
    !explicitlyRelevantSet.has(item)
    && hasSceneCompatibleLoadoutJudgementAnchor(item, actionIntent)
  ));
  const relevantItems = [...explicitlyRelevantItems, ...sceneCompatibleItems].slice(0, 6);
  if (relevantItems.length === 0) return '';
  return `携物=${relevantItems.map((item) => (
    formatInventoryItemBrief(item, true, actionIntent, textRelevantSet.has(item))
  )).join('、')}`;
}

function formatInventoryItemBrief(
  item: NonNullable<RuntimeState['player']['inventory']>[number],
  includeJudgementAnchors = false,
  actionIntent?: ActionIntent,
  includeUnclassifiedHooks = false,
): string {
  const details = [
    item.category,
    item.quality,
    item.equipSlot ? `可装备=${item.equipSlot}` : '',
    item.keyItem ? '关键' : '',
    item.condition ? `状态=${item.condition}` : '',
    includeJudgementAnchors ? formatLoadoutStatBonuses(item.statBonuses) : '',
    includeJudgementAnchors && item.promptHint ? `promptHint=${item.promptHint}` : '',
    includeJudgementAnchors && actionIntent
      ? formatLoadoutCheckHooks(item.checkHooks, actionIntent, includeUnclassifiedHooks)
      : '',
    includeJudgementAnchors && item.unlocks && item.unlocks.length > 0 ? `unlocks=${item.unlocks.join('/')}` : '',
    includeJudgementAnchors && item.risks && item.risks.length > 0 ? `risks=${item.risks.join('/')}` : '',
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  return `${item.name}x${item.quantity}${details.length > 0 ? `（${details.join('，')}）` : ''}`;
}

function formatLoadoutStatBonuses(statBonuses?: Record<string, number>): string {
  if (!statBonuses || Object.keys(statBonuses).length === 0) return '';
  return `statBonuses=${Object.entries(statBonuses)
    .map(([name, value]) => `${name}${value >= 0 ? '+' : ''}${value}`)
    .join('/')}`;
}

function formatLoadoutCheckHooks(
  checkHooks: CharacterCheckHook[] | undefined,
  actionIntent: ActionIntent,
  includeUnclassifiedHooks = false,
): string {
  const hooks = checkHooks ?? [];
  const compatibleHooks = hooks.filter((hook) => isJudgementScopeCompatible(hook.scope, actionIntent));
  const unclassifiedHooks = includeUnclassifiedHooks
    ? hooks.filter((hook) => classifyJudgementScope(hook.scope) === 'unclassified' && hook.scope.trim())
    : [];
  const formatHooks = (items: CharacterCheckHook[]) => items.map((hook) => {
    const modifier = hook.modifier === undefined ? '' : `${hook.modifier >= 0 ? '+' : ''}${hook.modifier}`;
    return `${hook.scope}:${modifier}${hook.note ? `(${hook.note})` : ''}`;
  }).join('/');
  return [
    compatibleHooks.length > 0 ? `checkHooks=${formatHooks(compatibleHooks)}` : '',
    unclassifiedHooks.length > 0
      ? `语义判断hooks=${formatHooks(unclassifiedHooks)}（未分类scope，仅因当前输入明确相关）`
      : '',
  ].filter(Boolean).join('，');
}

function hasSceneCompatibleLoadoutJudgementAnchor(
  item: NonNullable<RuntimeState['player']['inventory']>[number],
  actionIntent: ActionIntent,
): boolean {
  return item.checkHooks?.some((hook) => (
    hook.scope?.trim()
    && hook.note?.trim()
    && (hook.modifier === undefined || Number.isFinite(hook.modifier))
    && isJudgementScopeCompatible(hook.scope, actionIntent)
  )) ?? false;
}

function isJudgementScopeCompatible(scope: string, actionIntent: ActionIntent): boolean {
  const category = classifyJudgementScope(scope);
  return actionIntent === 'combat' ? category === 'combat' : category === 'ordinary';
}

function classifyJudgementScope(scope: string): 'ordinary' | 'combat' | 'unclassified' {
  const normalizedScope = scope.trim().toLowerCase();
  if (['personalcombat', 'combat', 'duel'].some((prefix) => (
    normalizedScope === prefix || normalizedScope.startsWith(`${prefix}.`)
  ))) return 'combat';
  if (['ordinarycheck', 'ordinary'].some((prefix) => (
    normalizedScope === prefix || normalizedScope.startsWith(`${prefix}.`)
  ))) return 'ordinary';
  return 'unclassified';
}

function isInventoryItemRelevant(item: NonNullable<RuntimeState['player']['inventory']>[number], playerInput: string): boolean {
  if (item.keyItem || item.category === 'document' || item.category === 'token') return true;
  return isLoadoutItemTextRelevant(item, playerInput);
}

function isLoadoutItemTextRelevant(
  item: { name: string; description?: string; category?: string; quality?: string },
  playerInput: string,
): boolean {
  const input = playerInput.trim().toLowerCase();
  if (!input) return false;
  const searchable = [item.name, item.description, item.category, item.quality]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  return searchable.some((part) => input.includes(part.toLowerCase()));
}

function formatPlayerMemory(player: RuntimeState['player']): string {
  if (!player.playerMemory) return '';
  // recentTurns 由统一近期层承接；keyDeeds 由 MemoryContextPackage 在长期预算内限量投影。
  return `主角履历摘要：${player.playerMemory.summary}`;
}

function buildOpeningExtraRequestContext(player: RuntimeState['player'], fallbackRequest?: unknown): string {
  const request = (player.openingExtraRequest ?? (typeof fallbackRequest === 'string' ? fallbackRequest : '')).trim();
  if (!request) return '';

  return [
    '开局额外要求（最高优先级）：',
    `- ${request}`,
    '- 若开局额外要求与世界书、开局书签、出身、身份、地点或危机模板存在冲突，以开局额外要求为最高优先级；在不破坏世界基本逻辑的前提下进行自洽解释。',
  ].join('\n');
}

/** 生成状态写入用上下文，保留 ID 和命令约束。 */
function appendMapV1WritebackRules(parts: string[]): void {
  parts.push('mapV1WritebackRules:');
  parts.push('- locationChange.toLocationId must be a concrete place ID. If the player moves into a scene inside that place, include optional toSceneId; toSceneId must be a scene under toLocationId. Never set toLocationId to a region or scene.');
  parts.push('- 地点移动必须使用顶层 statePatch.type=locationChange，并把 toLocationId/toSceneId 直接放在该 patch.payload；不得把 updateLocation/locationChange 写入 payload.command.action。');
  parts.push('- 已存在地点移动：toLocationId 只能逐字复用 currentPlaceId 或 knownNearbyRoutes.toPlaceId；toSceneId 只能逐字复用 localScenes.sceneId，或所选 knownNearbyRoutes 下 destinationScenes.sceneId，且只能属于目标具体地点。');
  parts.push('- 本回合新生成的永久剧情地点/场景：先在 locationWriteSuggestions 按“父地点在前、子场景在后”写入，permanence=permanent；随后 locationChange 可以逐字引用 locationWriteSuggestions 中完全相同的稳定 ID。新具体地点的 parentId 必须复用 availableParentRegions 中真实存在的 nodeId，并把该项 path 原样写入 parentPath；新场景的 parentId 必须是本回合新地点或已有具体地点 ID。');
  parts.push('- 首次实际移动到本回合新建具体地点时，应同时写 routeWriteSuggestions 连接 currentPlaceId 与新地点；若遗漏，本地会依据本回合已确认的实际移动补一条可返回路线，不估算耗时。');
  parts.push('- 离开后再次进入已知剧情地点/场景时，必须复用 knownNearbyRoutes.toPlaceId 与其 destinationScenes.sceneId，不得为同一地点另造 ID，也不得重复输出 locationWriteSuggestions。');
  parts.push(...CANONICAL_LOCATION_PROTOCOL_CLAUSES.map((clause) => `- ${clause}`));
  parts.push('- mapLayer=place means a concrete route endpoint; mapLayer=scene means a scene inside a place; do not connect routes to regions or scenes.');
  parts.push('- routeWriteSuggestions must include routeId, fromPlaceId, toPlaceId, name, routeKind, status, knownLevel; from/to must both be concrete place IDs.');
  parts.push('- If this turn confirms a route travel time, write standardTravelMinutes and travelTimeText; the local engine stores it as an observed baseline.');
  parts.push('- Do not infer persistent map data from prose. Only structured writeback fields are persisted.');
}

function appendOpenCurrentMatterLifecycleLedger(parts: string[], state: RuntimeState): void {
  const openMatters = (state.activeQuests ?? [])
    .filter(isOpenCurrentMatter)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id));
  if (openMatters.length === 0) return;

  parts.push('openCurrentMatterLifecycleLedger:');
  for (const quest of openMatters) {
    parts.push([
      `- questId: ${quest.id}`,
      `title: ${compactLifecycleValue(quest.title)}`,
      `updatedAt: ${quest.updatedAt}`,
      `currentStep: ${compactLifecycleValue(quest.currentStep) || 'none'}`,
      `deadlineAt: ${quest.deadlineAt?.trim() || 'none'}`,
      `relatedNpcIds: ${(quest.relatedNpcIds ?? []).join(',') || 'none'}`,
      `relatedLocationIds: ${(quest.relatedLocationIds ?? []).join(',') || 'none'}`,
      `relatedFactionIds: ${(quest.relatedFactionIds ?? []).join(',') || 'none'}`,
    ].join('; '));
  }
}

function formatResolvedCurrentMatterContinuity(matters: Quest[]): string {
  if (matters.length === 0) return '';
  return [
    '已结事项连续性（结构化终态，优先于旧记忆与 NPC 旧计划）：',
    ...matters.map((quest) => {
      const result = compactLifecycleValue(quest.outcomeSummary)
        || compactLifecycleValue(quest.archiveReason)
        || '终态已确认，未提供额外结果摘要';
      return `- [${quest.status}] ${compactLifecycleValue(quest.title)}；结束于 ${quest.archivedAt ?? quest.updatedAt}；结果：${result}`;
    }),
    '- 硬约束：上述事项已经结束，不得把原承诺、交付或任务重新写成尚未发生、仍待履行或再次首次发生。只有玩家明确发起新的同类事项，或本回合出现新的结构化因果时，才可建立新的稳定事项。',
  ].join('\n');
}

function appendResolvedCurrentMatterContinuityLedger(parts: string[], matters: Quest[]): void {
  if (matters.length === 0) return;
  parts.push('resolvedCurrentMatterContinuityLedger:');
  for (const quest of matters) {
    parts.push([
      `- questId: ${quest.id}`,
      `status: ${quest.status}`,
      `title: ${compactLifecycleValue(quest.title)}`,
      `updatedAt: ${quest.updatedAt}`,
      `archivedAt: ${quest.archivedAt ?? 'none'}`,
      `outcomeSummary: ${compactLifecycleValue(quest.outcomeSummary) || 'none'}`,
      `relatedNpcIds: ${(quest.relatedNpcIds ?? []).join(',') || 'none'}`,
      `relatedLocationIds: ${(quest.relatedLocationIds ?? []).join(',') || 'none'}`,
      `relatedFactionIds: ${(quest.relatedFactionIds ?? []).join(',') || 'none'}`,
    ].join('; '));
  }
}

function compactLifecycleValue(value: string | undefined): string {
  return value?.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
}

function appendTroopWritebackStableIndex(parts: string[], state: RuntimeState, playerInput: string): void {
  const troops = [...(state.troops ?? [])];
  if (troops.length === 0) return;

  const normalizedQuery = playerInput.toLocaleLowerCase('zh-Hans-CN');
  const playerId = state.player?.id;
  const currentLocationIds = new Set([
    state.currentLocationId,
    state.currentPlaceId,
    state.currentSceneId,
  ].filter((value): value is string => Boolean(value?.trim())));
  const score = (troop: TroopLedgerEntry): number => {
    const queryMatched = [
      troop.troopId,
      troop.name,
      troop.specialDesignation,
      ...(troop.aliases ?? []),
    ].some((value) => {
      const normalized = value?.trim().toLocaleLowerCase('zh-Hans-CN');
      return Boolean(normalized && normalizedQuery.includes(normalized));
    });
    const playerCommanded = troop.leaderNpcId === 'player'
      || Boolean(playerId && troop.leaderNpcId === playerId)
      || /self|own|owned|subordinate|direct_command|directCommand|player_direct|controlled|己方|直属|统领|麾下|受你/.test(
        troop.relationToPlayer?.trim() ?? '',
      );
    const atCurrentLocation = currentLocationIds.has(troop.locationId ?? '')
      || currentLocationIds.has(troop.lastKnownLocationId ?? '');
    return (queryMatched ? 1000 : 0) + (playerCommanded ? 100 : 0) + (atCurrentLocation ? 50 : 0);
  };
  troops.sort((left, right) => (
    score(right) - score(left)
    || (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
    || left.troopId.localeCompare(right.troopId)
  ));

  parts.push('troopStableIndex:');
  parts.push('- 这是全部已登记部队的紧凑稳定 ID 真值表；更新、移动、整编时必须复用 troopId，不得按正文名称另建重复部队。');
  for (const troop of troops) {
    parts.push([
      `- troopId: ${troop.troopId}`,
      `name: ${compactLifecycleValue(troop.name)}`,
      `aliases: ${(troop.aliases ?? []).map(compactLifecycleValue).filter(Boolean).join(',') || 'none'}`,
      `designation: ${compactLifecycleValue(troop.specialDesignation) || 'none'}`,
      `lifecycleStatus: ${troop.lifecycleStatus ?? 'unknown'}`,
      `relationToPlayer: ${compactLifecycleValue(troop.relationToPlayer) || 'unknown'}`,
      `locationId: ${troop.locationId?.trim() || 'unknown'}`,
      `lastKnownLocationId: ${troop.lastKnownLocationId?.trim() || 'unknown'}`,
      `destinationLocationId: ${troop.destinationLocationId?.trim() || 'none'}`,
      `movementStatus: ${troop.movementStatus ?? 'none'}`,
      `updatedAt: ${troop.updatedAt?.trim() || 'unknown'}`,
    ].join('; '));
  }
}

function generateStateWriterContext(
  state: RuntimeState,
  worldBook: WorldBook,
  playerInput: string,
  actionIntent: ActionIntent,
): string {
  const selected = selectPromptContext(state, { queryTexts: [playerInput] });
  const pregnancyMode = loadPregnancyModeFromStorage();
  const mapProjection = buildCurrentMapProjection(worldBook, state, {
    sceneLimit: Number.POSITIVE_INFINITY,
    routeLimit: Number.POSITIVE_INFINITY,
    destinationSceneLimit: Number.POSITIVE_INFINITY,
  });
  const adultPrivateProfileNpcIds = selectAdultPrivateProfileProjectionNpcIds(state, selected, playerInput);
  const npcReuseCandidates = selectNpcReuseCandidates(state, selected, playerInput);
  const parts: string[] = [];

  parts.push(`currentDate: ${selected.currentDate}`);
  parts.push(`currentLocationId: ${selected.currentLocationId}`);
  if (selected.currentLocation) {
    parts.push(`currentLocationName: ${selected.currentLocation.name}`);
  }

  parts.push(`currentPlaceId: ${mapProjection.currentPlaceId}`);
  if (mapProjection.currentSceneId) {
    parts.push(`currentSceneId: ${mapProjection.currentSceneId}`);
  }
  if (mapProjection.displayPath) {
    parts.push(`currentPlacePath: ${mapProjection.displayPath}`);
  }
  if (mapProjection.currentHierarchy.length > 0) {
    parts.push('currentLocationHierarchy:');
    for (const node of mapProjection.currentHierarchy) {
      parts.push(`- nodeId: ${node.id}; mapLayer: ${node.mapLayer ?? 'unknown'}; name: ${node.name}`);
    }
  }
  if (mapProjection.availableParentRegions.length > 0) {
    parts.push('availableParentRegions:');
    for (const region of mapProjection.availableParentRegions) {
      parts.push(`- nodeId: ${region.id}; path: ${region.path}; name: ${region.name}`);
    }
  }
  if (mapProjection.scenes.length > 0) {
    parts.push('localScenes:');
    for (const scene of mapProjection.scenes) {
      parts.push(`- sceneId: ${scene.id}; name: ${scene.name}; summary: ${scene.summary}`);
    }
  }
  if (mapProjection.nearbyRoutes.length > 0) {
    parts.push('knownNearbyRoutes:');
    for (const route of mapProjection.nearbyRoutes) {
      const travelTime = route.travelTimeText
        ?? (route.standardTravelMinutes ? `${route.standardTravelMinutes} minutes` : 'unknown');
      parts.push(
        `- routeId: ${route.routeId}; toPlaceId: ${route.toPlaceId}; name: ${route.name}; routeKind: ${route.routeKind ?? 'unknown'}; status: ${route.status}; travelTime: ${travelTime}`,
      );
      if (route.destinationScenes.length > 0) {
        parts.push('  destinationScenes:');
        for (const scene of route.destinationScenes) {
          parts.push(`  - sceneId: ${scene.id}; name: ${scene.name}; summary: ${scene.summary}`);
        }
      }
    }
  }

  appendEncounterV2StableSources(parts, state, selected, playerInput);
  appendPlayerEconomyWritebackSnapshot(parts, state.player);
  appendTroopWritebackStableIndex(parts, state, playerInput);
  appendOpenCurrentMatterLifecycleLedger(parts, state);
  appendResolvedCurrentMatterContinuityLedger(parts, selected.resolvedCurrentMatters);

  if (selected.presentNpcs.length > 0) {
    parts.push('presentNpcs:');
    for (const npc of selected.presentNpcs) {
      parts.push(formatNpcStateWriterLine(
        state,
        npc,
        selected.currentDate,
        playerInput,
        actionIntent,
        adultPrivateProfileNpcIds.has(npc.npcId),
      ));
    }
  }

  if (selected.focusedNpcs.length > 0) {
    parts.push('focusedNpcs:');
    for (const npc of selected.focusedNpcs) {
      parts.push(formatNpcStateWriterLine(
        state,
        npc,
        selected.currentDate,
        playerInput,
        actionIntent,
        adultPrivateProfileNpcIds.has(npc.npcId),
      ));
    }
  }

  if (npcReuseCandidates.length > 0) {
    parts.push('npcReuseCandidates:');
    parts.push('- 已有人物志候选：若本回合正文让这些人物出场、发话、被拜访或被更新，必须复用下列 npcId，不得另建同名 NPC。');
    for (const npc of npcReuseCandidates) {
      parts.push(formatNpcStateWriterLine(
        state,
        npc,
        selected.currentDate,
        playerInput,
        actionIntent,
        adultPrivateProfileNpcIds.has(npc.npcId),
      ));
    }
  }

  if (selected.recentTurnEvents.length > 0) {
    parts.push('recentTurnEvents:');
    for (const event of selected.recentTurnEvents) {
      parts.push(
        `- eventId: ${event.eventId}; locationId: ${event.locationId}; presentNpcIds: ${event.presentNpcIds.join(',')}; summary: ${event.summary}`,
      );
    }
  }

  if (selected.relevantPlotPlans.length > 0) {
    parts.push('hiddenPlotPlans:');
    for (const plan of selected.relevantPlotPlans) {
      parts.push(`- ${formatPlotPlanForPrompt(plan)}`);
    }
  }

  parts.push('allowedLuanShiCommands:');
  parts.push('- writeback.protagonistMemory.keyDeed 是低频终身里程碑，不是普通回合摘要。只允许身份/官爵变化、重大胜败、领地或势力控制变化、重要人物正式归附或决裂、不可逆关系变化、重大承诺及其兑现/背弃、会持续影响后续剧情的重大后果。');
  parts.push('- 不得把出发、赶路、抵达、准备、开会、普通谋划、定下普通计划、拉开序幕、进入阶段、排兵布阵、普通训练/检阅/选拔、重复确认既有结果写成 keyDeed；这些内容只写 turnSummary、NPC记忆、任务或相关账本。无法说明长期不可逆影响时必须省略 keyDeed。');
      parts.push('- payload.command.action=upsertCalendarEra: 只在改元、称帝、新政权正式宣布年号变化时写入；必须包含稳定唯一的 eraId、eraName、startYear，可含 startMonth/startDay/rulerName/source/note；剧情正式改元时 source 写 "runtime.story"。皇帝死亡但无人改元时沿用旧年号，不要凭空新增。');
  appendMapV1WritebackRules(parts);
  parts.push('- upsertTroopLedger.supplies: 可写 0-100 数值补给水平，或简短补给状态文本。若本回合明确清点粮草、军需或行军补给，优先写可比较的数值。');
  parts.push('- upsertTroopLedger.troopType 只能写具体兵种，例如 步卒/骑兵/弓弩兵/水军/斥候/辎重队/守军/民兵/混编/乱兵；不得写“部队/军队/人马/队伍”等泛称。番号、营名、郡兵、亲兵、某某部写 specialDesignation，不要塞进 troopType。');
  parts.push('- upsertTroopLedger.morale/training: 必须写 0-100 数字，不要写“低/中/高/极低”等文本；quality/fatigue/readiness 才使用枚举文本。');
  parts.push('- upsertTroopLedger.strengthTrend 只能写 increased/decreased/stable/unknown，分别表示兵力增强、减弱、稳定、未知；不要写“大幅增强/缓慢上升/减员中”等自然语言，变化细节写入 lastChangeReason 或 sourceNote。');
  parts.push('- upsertTroopLedger.upkeepSource 是内部军需来源字段，不在 UI 作为常规字段展示；只能写 player_resources/superior_provision/mixed/unknown。独立势力、自家府库、私产或领地承担写 player_resources；非独立势力下由主公、州府、朝廷或军府拨付军粮军饷写 superior_provision；上级拨付不足、主角再用自家资源补足写 mixed；不确定才写 unknown。');
  parts.push('- upsertTroopLedger.size 是当前已入账兵力绝对值，不是本回合提到的人数增量。只有本回合明确发生新的招募完成、调拨、收编、招降、归队、合并、伤亡或逃散等兵员变化时才改 size/previousSize；操练、训练、整顿、打散编入、以老带新、分屯、换装、补给或军纪整肃只更新 training/morale/readiness/fatigue/supplies/task/statusTags/sourceNote/lastChangeReason，必须保持原 size。不得把同一批已入账新卒重复加到 size；若是再次扩军，必须写明“再次/另募/新一批/调拨/收编”等新的兵源来源。');
  parts.push('- upsertTroopLedger.orderStatus/movementStatus: orderStatus 只能用 none/issued/inTransit/delivered/delayed/lost/cancelled，不得自造 ordered；movementStatus 只能用 none/waitingOrder/preparing/marching/arrived/blocked/interrupted/cancelled。部队已经启程时写 marching，并用 departedAt 记录启程时点，不得自造 departed。远程军令不得立刻改写 locationId；下令时先写 orderStatus、orderIssuedAt、orderSummary、destinationLocationId、routeId、movementStatus、estimatedArrivalAt、movementNotes。只有军令送达、部队启程或抵达得到正文确认、使者回报或可靠情报确认后，才推进 orderDeliveredAt、departedAt、arrivedAt，并在实际抵达或可靠情报确认后更新 locationId、lastKnownLocationId、lastKnownAt。');
  parts.push('- upsertConflictRecord.judgement.scoreBreakdown: troopBase/commander/tactical/turningPoint/playerAction/uniqueArts 为单项参考分，单项绝对值不超过 100；战争 scoreBreakdown.total 必须等于已写分项之和，可超过 100，但战争 scoreBreakdown.total 绝对值不得超过 250；若原始合计越界则等比收敛分项，不得只截断 total。');
  parts.push('- payload.command.action=updateResourceLedger: 更新资源账本的已知数量与清单；可写 money、grain、horses、arms、recruits、weapons、documents、tokens、importantSupplies、playerResources。money/grain/horses/arms/recruits 写当前总量，不是本回合增量。weapons/documents/tokens/importantSupplies 必须是字符串数组，即使只有一项也写成如 ["箭矢三箱"]，不得直接写单字符串。playerResources 只能是“资源名: 非负数字”的对象；备注、来源、说明或原因写 summary，不得在 playerResources 内写 notes/text/说明。领取军饷粮草、缴获粮草军械、豪族捐赠钱粮、购买或消耗军需等具体剧情事实造成资源变化时，应使用 updateResourceLedger 写入资源账本；月度军需和九月年度结算仍由本地计算，不要反向改写。只在剧情事实造成资源变化时使用，不要为了描述气氛机械写。');
  parts.push('- payload.type=resourceChanged: 只操作 playerResources 的通用键；resource 必须非空，change 与 newValue 必须且只能提供一个：mode=delta 时只写 finite change，mode=absolute 时只写 finite newValue，严禁同时写两个数值字段。没有明确非空 resource 键时不得输出 resourceChanged；它不替代 updateResourceLedger 的资源账本总量、清单与剧情事实写回用途。');
  parts.push('- payload.type=relationshipChange: 必须写 actorId、targetId、targetKind、value；targetKind=actor/faction，value 必须是 -100 到 100 的 finite number。targetType 仅可在已有 targetKind 时作为一致性 alias，targetType 不得单独提供；factionId 仅可在 targetKind=faction 时与显式 targetId 一致，不得用于补足 targetId 或 targetKind。');
  parts.push('- payload.command.action=upsertHoldingLedger: 新增或更新玩家/自势力已经掌控、临时控制、争夺或失去的领地；必须包含稳定 holdingId、name、type、status、summary、civilAdministrationScope、scaleLevel、agriculture、commerce、population、publicOrder、popularSupport、defense、recruitPotential、armory、horseSupply、updatedAt；存在民政收益辖境时还必须包含 corruption。已有领地再次更新时必须复用原 holdingId；若该领地已有 locationId，不得用同一 locationId 另造 holding_xxx 新条目；若旧领地暂缺 locationId，但 name 与 type 明确相同，也必须复用旧 holdingId 并补齐 locationId，不得另建同名条目。type 只能是 county/commandery/city/fort/pass/camp/estate/port/village/other；status 只能是 controlled/contested/temporary/lost/archived；civilAdministrationScope 只能是 none/households/territorial/mixed；scaleLevel 只能是 1-5，表示领地规模档位，不能写 10/30/100；适用评分为 0-100。可包含 locationId、factionId、nominalAllegiance、actualController、stewardNpcId、farmlandMu、registeredHouseholds、eliteControlledShare、localEliteRelation、siege、garrisonTroopIds、relatedNpcIds、riskNotes、recentChanges、sourceNote。farmlandMu、registeredHouseholds 必须是非负数字；eliteControlledShare 表示地方豪强掌控比例、范围为 0-100，localEliteRelation 表示地方豪强关系、范围为 -100 到 100；riskNotes/recentChanges=array，即使只有一条也写字符串数组。');
  parts.push('- 领地民政范围：civilAdministrationScope=none 表示纯军营、堡垒、关隘、港口设施等无民政或收益辖境，agriculture/commerce/population/publicOrder/popularSupport/recruitPotential 必须全为 0，且不得写 corruption/farmlandMu/registeredHouseholds/eliteControlledShare/localEliteRelation；腐败只适用于存在税收、征收或经营收益链路的 households/territorial/mixed。households 表示只辖居民或港镇民户，agriculture 必须为 0、不得写 farmlandMu，可写编户与豪强字段；territorial 表示郡县、乡里或含完整周边辖境的城池，可写全部民政字段；mixed 表示屯田营、附属聚落军镇等军民混合辖境，可写全部民政字段。不能只按 type 猜：普通 camp 通常是 none，但明确管屯田与民户的 camp 应写 mixed；纯港口设施是 none，港镇可写 households。范围事实由 LLM 根据剧情明确裁定，本地不按名称或正文关键词代判。');
  parts.push('- 领地账本边界：V1 只记录玩家或自势力相关领地，不做全国领地模拟。默认守城士卒不自动写入部队账本；只有剧情明确出现可承接的实际部队时才另写 upsertTroopLedger。civilAdministrationScope=none 的领地不参与年度民政产出、征收或征兵；其他范围才按适用字段进入结算。领地钱粮总数以资源账本为唯一真值，不得输出 localTreasury/localGranary；旧存档字段只做兼容，不再展示或接受新写入。地方估产、实际征收和实征率由本地计算，不得直接写 estimatedOutput/actualCollection/collectionRate；LLM 只写范围允许的事实锚点。非九月额外征收、强征兵员、急调钱粮可以发生，但必须使用资源账本记录来源、去向，并同步体现适用的领地后果，不能只增加资源。');
  parts.push('- 围城补给写回：仅在具体领地发生封锁或围城时写 siege。siege.status 只能用 blockaded/encircled/none，siege.supplyLine 只能用 open/strained/cut，siege.preparation 只能用 none/prepared/stockpiled。围城解除时写 siege.status=none；围城中断补、恢复粮道或确有提前屯粮事实时才更新对应枚举。不得写 cutOffAtTurn、initialEnduranceTurns 或自行估算粮石、钱贯；可支撑回合由本地计算。当上下文投影为补给紧张、濒临断粮或粮秣告罄时，正文与相关领地/部队写回应承接士气、治安、伤病、逃亡或投降风险，但不得机械一次性全部触发。');
  parts.push('- 领地/私产写回边界：没有实际控制、临时控制、争夺、治理或失去具体领地时，不得输出 upsertHoldingLedger。军职、统兵、守城、镇守、军营、兵营、武库、库房、军械清点、斥候名册只表示部队或军需上下文，不等于控制领地；除非明确有治理、接掌、辖有或民政权责，否则不得输出 upsertHoldingLedger。私人庄园、田产、工坊、马场、铺面等应使用 upsertPrivateAsset；私人产业不等于控制领地。若本回合或开局事实已经明确私人产业或控制领地，必须写入对应账本，不得只写进正文、记忆或摘要。玩家个人钱财的普通收支写 updatePlayerLoadout.personalMoneyDelta，势力总资源写 updateResourceLedger。');
  parts.push('- payload.command.action=upsertPrivateAsset: 新增或更新玩家私人产业；必须包含 stable privateAssetId、name、type、ownerScope、status、summary。updatedAt 是引擎管理的技术时间戳，可省略，空值由引擎按当前游戏时间补齐。type 只能是 estate/farmland/workshop/ranch/shop/ferry/mine/other；ownerScope 只能是 personal/clan/household/retainer/faction；status 只能是 active/damaged/occupied/disputed/archived。可包含 locationId、managerNpcId、mu、households、workers、workshopScale、ranchCapacity、conditionNotes、riskNotes、recentChanges、sourceNote。私人产业用于庄园、田产、工坊、马场、铺面等，不等于背包物品，也不等于控制领地。');
  parts.push('- payload.command.action=upsertPrivateAssetProject: 新增或更新私人产业长期工程；必须包含 stable projectId、assetId、title、type、status、startedAt。updatedAt 是引擎管理的技术时间戳，可省略，空值由引擎按当前游戏时间补齐。type 只能是 expand_farmland/irrigation/build_workshop/expand_workshop/build_ranch/expand_ranch/recruit_tenants/repair/anti_corruption/other；status 只能是 planned/active/blocked/completed/cancelled。可包含 expectedCompleteAt、investedMoney、investedGrain、targetDelta、progressNotes、riskNotes。长期扩建工程由内政结算检查到期后自动完成，不需要写入当前事项，除非工程受阻、需要玩家决策或产生剧情冲突。');
  parts.push('- payload.command.action=upsertDomesticReport: 只新增或更新剧情中需要单独留档的特殊内政报告；必须包含 reportId、year、settledAt、title、summary、income、expenses、netChange、readByPlayer。income/expenses/netChange 都必须包含 money、grain、horses、arms、recruits。可包含 holdingHighlights[{holdingId,summary}]、privateAssetHighlights[{privateAssetId,summary}]、projectHighlights[{projectId,assetId,summary}]、warnings。合法模型报告统一归一为 source=llm；不得每回合机械生成内政报告。');
  parts.push('- 本地九月年度结算报告无需模型生成，月度军需报告也由本地规则生成，部队粮草、军饷、马匹、军械维持由本地按月扣除。system: 命名空间只由本地规则写入；模型不得写入 system: reportId、source=system 或 kind=holdingAnnualSettlement，也不得反向凭空改写本地结算数值。');
  parts.push('- payload.command.action=upsertFactionLedger: 新增或更新势力档案；必须包含稳定 factionId、name、type、summary、stanceToPlayer、knownLevel(亲历/听闻/推测)、recentActions。recentActions 不得省略，至少写 1 条当前已知行动、近期动作、控制举措或本局接触事实。type 必须使用中文势力类型，例如朝廷、政权、地方官府、军府、军阀集团、豪族宗族、叛乱组织、盗匪流寇、士人社群、游侠组织、宗族武装等；不得输出 warlord，也不得输出 clan/local_government/government 等英文枚举或下划线工程词。可包含 aliases、nominalAllegiance(名义归属)、legalIdentity(合法身份/官职名分)、actualController(实际主事)、knownSphere(已知势力范围)、corePersonNpcIds、knownMemberNpcIds、relatedTroopIds、sourceNote、lastKnownAt、updatedAt。用于记录可承接的势力事实，不替代任务、风声或纪事。');
  parts.push('- upsertFactionLedger.stanceToPlayer 必须写简短关系文本，例如亲善/友好/中立/戒备/敌对/自势力相关；不得写数字评分，也不得写 neutral/friendly/hostile 等英文枚举。');
  parts.push('- 势力档案稳定规则：factionId 表示实际可持续行动主体；同一行动主体不得因别名、官署名、头衔变化另建势力。地方官、豪族或军头名义归属朝廷/王国/宗主时，复用其稳定 factionId，并在名义归属、合法身份、实际主事、已知势力范围中说明，不要再新增“郡府/朝廷/某官署”重复势力。不得写入“未来军阀集团/潜在势力/某类人网络”这类抽象占位势力；只有剧情中出现可承接的具体行动主体时才建档。');
  parts.push('- 势力账本承接规则：如果正文、当前事项、风声线索或天下纪事中已经点名具体官府、军府、朝廷、宗族、叛乱组织、部队归属或当前政治主体，并且它对玩家处境有长期承接价值，必须同时使用 upsertFactionLedger 写入或更新势力账本；不得只把它留在正文、任务、风声或纪事里。');
  parts.push('- 势力/部队边界：营、曲、残部、亲兵、前锋、守卒、某营某部这类军事单位属于部队或子部，不是势力；除非剧情明确其脱离原主并形成可持续独立行动主体，否则不得把部队单位写成独立势力。此类信息应写入 upsertTroopLedger.name/specialDesignation/statusTags/task/sourceNote，并让 troop.factionId 指向真实归属势力。');
  parts.push('- payload.command.action=upsertTroopLedger: 新增或更新部队账本；必须包含 troopId、name、size、morale、training、supplies、task、relationToPlayer。upsertTroopLedger 不得输出空对象或缺少 troopId 的占位对象；更新已有部队必须复用上下文中的稳定 troopId，无法确认身份或新建必填字段不完整时省略整条命令。新建部队必须包含 quality、readiness、fatigue、lifecycleStatus、knownLevel、certainty；quality 使用低/中/高/精锐，readiness 使用低/中/高，fatigue 使用低/中/高/极高，lifecycleStatus 通常写 active，亲历清点写 knownLevel=亲历、certainty=confirmed。可包含 aliases、previousSize、factionId、previousFactionId、allegianceChangedAt、allegianceChangeReason、troopType、specialDesignation、quality、fatigue、readiness、lifecycleStatus(active/routed/merged/split/destroyed/surrendered/disbanded/unknown/archived)、statusTags、leaderNpcId、locationId、lastKnownLocationId、lastKnownAt、knownLevel、certainty、parentTroopId、childTroopIds、mergedFromTroopIds、mergedIntoTroopId、destroyedInBattleId、lastBattleId、strengthTrend、upkeepSource、sourceNote、lastChangeReason、updatedAt。只记录已知部队事实，不做自动战争结算。mergedFromTroopIds 由本地根据旧部的 mergedIntoTroopId 自动维护，模型可省略但不得写错。');
  parts.push('- 部队情报字段必须分开裁定：knownLevel 表示证据来源层级（亲历/听闻/推测），certainty 表示该条情报可信度（confirmed/reported/rumor/uncertain），两者不得机械同步。可靠军报可以是 knownLevel=听闻、certainty=confirmed；失联通常只降低 certainty，不得在证据来源未变化时把 knownLevel 从听闻改为推测；knownLevel=推测 与 certainty=confirmed 互相矛盾，不得组合。');
  parts.push('- upsertTroopLedger.relationToPlayer 必须写简短关系文本，例如 self/你直接统领/自势力相关/友军/中立/敌对；不得写数字评分。玩家亲自统领、直接清点或由主角麾下掌握的部队，leaderNpcId 写 player；副将、军侯、带兵副手、亲兵队率等下属不得把副手写成主将，可写入 NPC 档案、sourceNote 或 statusTags。若已知归属势力，troop.factionId 指向真实归属势力；不要因缺 factionId 新建未知势力，也不要把营、曲、某部写成势力。');
  parts.push('- 部队账本稳定规则：同一支部队必须复用稳定 troopId；减员、增员、改名、移动、整编、状态变化都更新同一 troopId。部队换旗、起义、倒戈、假降转公开、被收编时不得因此新建部队；必须复用原 troopId，更新 factionId，并写 previousFactionId、allegianceChangedAt、allegianceChangeReason。拆分时保留 parentTroopId/childTroopIds；合并或招降时写 mergedIntoTroopId 或 lifecycleStatus=surrendered/merged；覆灭时写 lifecycleStatus=destroyed 与 destroyedInBattleId。不得因为战后人数变化另建一支同名部队。整编重组产生新建制时，可以为真正的新建制建立新 troopId，但必须在同一批写回中逐一复用旧 troopId，把每支已撤销旧部更新为 lifecycleStatus=merged/disbanded/split；能明确承接去向时同步写 mergedIntoTroopId 或 childTroopIds。终态旧建制只保留历史，不得继续计入当前兵力，也不得仍作为当前驻军或势力现役部队。');
  parts.push('- 部队位置写回合同：locationId、lastKnownLocationId、destinationLocationId 只能逐字复用地图上下文或同批 locationWriteSuggestions 中的 canonical 地点 ID，不得发明 unknown/loc_unknown 占位 ID。确认当前位置时同时写 locationId 与相同的 lastKnownLocationId，并写 lastKnownAt；movementStatus=arrived 时当前位置、最后已知位置和目标地点必须一致。远场部队位置未确认时应省略位置字段，不得根据正文关键词猜测。');
  parts.push('- 更换 destinationLocationId 表示开始新的移动周期：只写本次新军令实际成立的 routeId、orderIssuedAt/orderDeliveredAt、departedAt、estimatedArrivalAt、arrivedAt 和 movementNotes，不得沿用上一趟行军的路线或时间。若新路线尚未确定就省略 routeId；本地会清除上一周期未被本回合明确重写的路线、军令说明和移动时间。');
  parts.push('- War V2 写回边界：玩家亲自参与或直接指挥、且已经正式爆发的具体军队冲突，必须只输出 kind=war 的 encounterStartIntent 与所需 semanticProjections；触发回合禁止 upsertConflictRecord、战争判定、伤亡、部队终态、领地易手或围城解除写回。troopIds、commanderActorId、targetHoldingId 必须复用上下文稳定 ID；本地引擎结算后会一次性写回这些事实。');
  parts.push('- 远场战争边界：其他势力战争、玩家只听闻/观察或未直接指挥的开放叙事战争继续使用战争判定 V1 与 upsertConflictRecord，不得触发 War V2。War V2 也不负责推进远场 NPC、暗流、纪事或事项。');
  parts.push('- payload.command.action=upsertConflictRecord: 新增或更新战事记录；一场战争/战斗/军事冲突只写一条 conflictId。必须包含 conflictId、type、title、occurredAt、outcome；建议包含 summary（漏写时系统以 outcome 作为摘要）。type 只能用 个人战斗/战争/军事冲突/对峙/其他/野战/伏击/追击/围城/守城/夜袭/抢粮/营寨战/巷战/水战；常见示例为伏击/追击/围城/抢粮。防御反击不得自造为 type，可按实际规模选守城/战争/军事冲突，并把反击事实写入 title、summary、outcome 或 turningPoints。覆灭/招降/合并/溃退是结果或效果，应写入 outcome、result、troopEffects 或 factionEffects，不得作为 type。自势力相关战事可写 scope=selfRelated、recordLevel=full、reportText；其他势力战事只写 scope=other、recordLevel=brief、summary/outcome。战事记录只是归档入口，部队实体变化必须额外使用 upsertTroopLedger，势力、地点、NPC、任务、纪事变化也必须额外使用对应结构化写回。若战事已公开、被听闻或对局势有承接价值，应另写 worldEventSummary/sourceConflictIds=[conflictId]；参与者或亲历者 NPC 记忆可用 eventId=conflictId；远场意识索引可用 sourceType=conflict、sourceIds=[conflictId]。');
  parts.push('- 战争判定 V1：当正文发生需要裁定的战争/军事冲突时，upsertConflictRecord 可写 resultLevel(decisiveWin/win/minorWin/stalemate/minorLoss/loss/decisiveLoss)、judgement.method=warJudgementV1、judgement.baselineAdvantage、judgement.scoreBreakdown{troopBase,commander,tactical,turningPoint,playerAction,uniqueArts,total,notes}、judgement.commanderAssessment、judgement.tacticalAssessment、judgement.underdogReason、turningPoints[{type,side,summary,impact,relatedNpcIds,relatedTroopIds,scoreModifier}]、resultTags。turningPoints[].type 只能用 duelVictory/duelDefeat/commanderSlain/commanderCaptured/commanderWounded/commanderFled/ambush/fireAttack/supplyDestroyed/gateBreached/reinforcementArrived/moraleCollapse/terrainBreakthrough/playerAction/other；不得自造 tacticalAdvantage 等近义工程词。turningPoints[].impact 只能用 minor/moderate/major/critical，不得写自然语言影响描述。评分只是本地可复盘参考，不替代正文因果；统率是主帅权重最高项，智力影响战术，武力只在单挑/冲阵/阵斩等场景显著放大，政治/魅力主要影响军心、服从和临阵号召；绝艺只在其 domain/promptHint 与当场战局直接相关时写入 uniqueArts 分。若本回合需要展示该战事判定，narrativeText 中必须用独立行 `[[判定:battle:conflictId]]` 放在战局裁定发生处，不要集中在正文末尾。');
  parts.push('- 战争判定边界：以少胜多、以弱胜强时，战争 underdogReason 必须是非空字符串，并用 decisiveFactors/turningPoints 支撑；没有以弱胜强事实时省略该字段，不得写空字符串。主帅被斩、被俘、重伤、逃走属于 major/critical 转折，必须作为 turningPoints(type=commanderSlain/commanderCaptured/commanderWounded/commanderFled) 记录，不得当作轻微修饰。单挑或个人战若改变战局，先在本场战争里记录 duelVictory/duelDefeat/commanderSlain 等 turningPoints；个人战弹窗和个人战详细记录由后续个人战系统承接。');
  parts.push('- payload.command.action=upsertCombatRecord: 新增或更新个人战/战斗记录；用于玩家亲历战斗、单挑、刺杀、突围、擒拿、战场叫阵、在场 NPC 之间的个人交锋。必须包含 combatId、kind、title、summary、occurredAt、participants、playerInvolved、resultLevel、outcome、significance；kind 只能用 duel/melee/assassination/escape/capture/battlefieldDuel/other；resultLevel 只能用 decisiveWin/win/stalemate/loss/decisiveLoss；significance 只能用 minor/notable/major/legendary；participants 必须是对象数组 [{name, side, participantId?, npcId?, role?, outcome?}]，side 只能用 player/ally/enemy/neutral，不要写字符串数组。可包含 outcomeTags、locationId、locationName、relatedNpcIds、relatedConflictIds、relatedQuestIds、relatedTrendIds、chronicleWorthy、briefText、reportText、imageKey、visualTags、reputationEffects。summary 建议 50-90 字客观概括；briefText 建议 20-40 字，用作列表短句；reportText 建议 180-240 字，必须是可读战斗过程描写，结合环境、对手、招式/动作、关键转折和结果余波；reportText/briefText 不得包含【旁白】、【角色名】、Markdown 标题或渲染标签，不要只写“某人取胜/证明能力”这类一句话结论。个人战记录独立于 upsertConflictRecord；军队/部队级战争仍写 upsertConflictRecord。若个人战改变战局，用 relatedConflictIds 关联战事，并在战事 turningPoints 中同步写 duelVictory/duelDefeat/commanderSlain 等转折。');
  parts.push('- 个人战判定 V1：upsertCombatRecord 可写 judgement.method=combatJudgementV1、judgement.perspectiveSide、judgement.advantageBand、judgement.scoreBreakdown{personalBase,equipment,status,environment,combatMethod,playerAction,turningPoint,uniqueArts,total,notes}、judgement.decisiveMoment、judgement.underdogReason。advantageBand 只能用 overwhelmingAdvantage/clearAdvantage/slightAdvantage/even/slightDisadvantage/clearDisadvantage/overwhelmingDisadvantage；scoreBreakdown.notes 必须是字符串数组；scoreBreakdown 各数值字段（包括 total）绝对值不得超过 200，total 必须等于已写分项之和，若原始合计越界则等比收敛分项，不得只截断 total。评分是本地可复盘参考，不替代正文因果；以弱胜强必须写明 underdogReason；参战 NPC 的武器、防具、坐骑、宝物、关键携物、特质和绝艺应进入 scoreBreakdown.equipment/status/uniqueArts 或 notes；不得只计算主角装备。绝艺只在其 domain/promptHint 与当场个人战、单挑、刺杀、突围或谋略直接相关时写入 uniqueArts 分。若本回合需要展示该个人战判定，narrativeText 中必须用独立行 `[[判定:combat:combatId]]` 放在交锋裁定发生处，不要集中在正文末尾。个人战若公开、击败名将、造成死亡/重伤/俘虏、影响任务或局势，应另写 worldEventSummary 或相关当前事项/风声/纪事后果锚点，并给亲历/在场 NPC 写记忆。');
  parts.push('- payload.command.action=updateCharacterReputation: 更新主角或已有 NPC 的名声/德行锚点；characterType=player 或 npc，characterId 必须复用稳定 ID。fame/morality 最终范围为 -1000~1000，0 为未形成公论；fame 负值代表恶名、正值代表美名，morality 负值代表失德、正值代表有德。单次 fameDelta/moralityDelta 绝对值不得超过 100，普通行为应小幅调整，summary/tags 说明来源；tags 必须是对象数组 [{label, source}]，不要写字符串数组；不要每场普通战斗都机械加声望。');
  parts.push('- 注意：所有 LuanShiCommand 写回必须使用 {type:"luanshiCommand", payload:{command:{action:"..."}}}；payload.command.action 不得遗漏。recordTurnEvent、pushNpcMemory、updateCharacterIdentity、updateNpcBackgroundActivity、updatePlayerLoadout、upsertTroopLedger、upsertHeroineThread、upsertBondThread 不是顶层 statePatch.type；不得把 recordTurnEvent、upsertTroopLedger、upsertHeroineThread、upsertBondThread 等 action 名写成顶层 type；updateNpcBackgroundActivity 同样必须放在 type=luanshiCommand 的 payload.command 内。');
  parts.push('- payload.command.action=recordTurnEvent: 记录客观发生的回合事件，必须包含 locationId、summary、visibility；recordTurnEvent.visibility 必须且只能单选 私密/在场可知/传闻扩散/公开，不得输出斜杠组合值；presentNpcIds 若无明确在场 NPC 写 []。');
  parts.push('- payload.command.action=pushNpcMemory: 写入 NPC 记忆，必须包含 npcId、npcName、source、value；亲历记忆只能写给在场 NPC。普通 NPC 记忆默认使用 writeback.npcMemorySuggestions；pushNpcMemory 仅用于需要立即强制写入的特殊情况。若使用 pushNpcMemory 写入某条 NPC 记忆，不得再在 writeback.npcMemorySuggestions 写入同一 NPC、同一事件、同一内容的记忆。');
  parts.push('- payload.type=questAdded: 新增“当前事项/玩家牵连”，用于记录玩家承诺、委托、牵挂、期限、风险或可行动目标。payload 必须包含 title，可包含 questId、description、source、currentStep、stakes、deadlineAt、priority(low/medium/high)、relatedNpcIds、relatedLocationIds、relatedFactionIds、threadId、outcomeSummary、consequenceTags、affectedNpcIds、affectedFactionIds、affectedPlaceIds、affectedForceIds、affectedHoldingIds、followUpHooks、severity(minor/moderate/major/critical)。不要把远方天下大势本身写成任务；只有玩家被卷入、承诺、受托、被追责或有明确可行动牵连时才写。');
  parts.push('- 交易/供应事项写回：玩家与 NPC 已达成包含具体数量、交付日期或验收标准的采购、供应、交割承诺时，本回合必须用 questAdded 建立可追踪事项，不能只留在正文或 NPC 记忆；后续交付、验收、违约或取消必须复用同一 questId 用 questUpdated/questChanges 收口，不得让同一批货反复送达。');
  parts.push('- payload.type=questUpdated: 更新当前事项，必须包含 questId；可更新 status(active/completed/failed/invalidated)、description、currentStep、stakes、deadlineAt、priority、后果锚点和关联 ID。若前提被玩家行动或世界事实破坏，使用 status=invalidated，而不是强行延续旧路线。');
  parts.push('- 当前事项生命周期审阅：openCurrentMatterLifecycleLedger 是全量未结事项，不受正文相关性前四条裁剪。每回合逐项审阅全部未结事项；只有本回合已经成立的结构化事实明确证明事项完成、失败或前提失效时，才复用 questId 输出 complete/fail/invalidate。未变化的事项不输出命令；不得按标题关键词、存续时长或期限到达自动结案。');
  parts.push('- 当前事项终态合同：complete/fail/invalidate 都是终态，完成、失败、失效后同回合进入历史归档并由本地写 archivedAt，同时保留 completed/failed/invalidated 结果标签。writeback.questChanges action=archive 只用于没有成功/失败结论但已不再属于当前游玩牵连的旧事项，必须复用已有 questId，并写明 summary/archiveReason。归档不会改变 NPC、地点、势力、部队或领地实体状态。');
  parts.push('- 已结事项连续性合同：resolvedCurrentMatterContinuityLedger 是相关事项的结构化终态真值，优先于旧回合摘要、NPC 旧记忆和旧后台计划；不得复开同一 questId，不得把其中已经兑现的承诺、已经交付的物资或已经完成的任务重新写成未发生。确有新的同类事件时，必须有本回合新因果并使用新的稳定 questId。');
  parts.push('- writeback.questChanges.experienceReward 只允许出现在事项第一次 action=complete 时，必须是 1-1000 的正整数并有正文中的实际完成依据；普通 update、archive、重复 complete 不得发放阅历。等级、经验阈值和成长点由本地 progression 统一计算，不得直接伪造 level/xp/growthPoints。');
  parts.push('- 当前事项后果锚点只记录“此事项造成了什么影响、影响了哪些对象、后续可牵出什么”，不等于实体状态更新。若后果改变 NPC 生死、位置、关系、记忆、在场状态，或改变地点/势力/部队/领地等实体事实，必须额外使用对应结构化写回（如 upsertNpcProfile、writeback.npcMemorySuggestions、必要时的 pushNpcMemory、relationshipChange、locationWriteSuggestions、未来的势力/部队/领地写回），不能只写入当前事项后果摘要。');
  parts.push('- payload.type=rumorAdded: 新增“风声线索/传闻/线索/情报”，用于记录玩家已听闻、发现或可合理感知但尚未坐实的动态信号。payload 必须包含 content，可包含 rumorId、title、source、signalType(rumor/clue/report/omen)、confidence(low/medium/high)、potentialOutcomeSummary、consequenceTags、affectedNpcIds、affectedFactionIds、affectedPlaceIds、affectedForceIds、affectedHoldingIds、followUpHooks、severity(minor/moderate/major/critical)、relatedLocationIds、relatedRegionId、relatedFactionId、relatedActorId、threadId、expiresAt。');
  parts.push('- 风声线索的后果是潜在后果，不是已经发生的实体事实；entity state changes require separate structured writeback。若线索被证实、演变成天下纪事，或改变 NPC 位置/关系/记忆、地点状态、势力/部队/领地状态，必须额外使用对应结构化写回；NPC 记忆优先写入 writeback.npcMemorySuggestions，不得只写入风声线索。');
  parts.push('- writeback.signalChanges 支持 action=update/verify/markFalse/expire/convert/archive；非 add 时必须复用已有 rumorId。verify 表示线索被证实，markFalse 表示证伪，expire 表示过期，convert 表示已转化为当前事项或纪事，archive 表示不再进入默认投喂但保留历史。');
  parts.push('- writeback.worldEventSummary: 只写“区域以上纪事/已发生或已获知的大势变化”。新纪事必须提供 scope(regional/realm/world)、severity、status，并提供可验证的宏观影响锚点：sourceConflictIds，或 affectedFactionIds/affectedForceIds/affectedHoldingIds/affectedPlaceIds 的有效组合。可选溯源与后果字段包括 sourceQuestIds、sourceSignalIds、sourceConflictIds、consequenceTags、affectedNpcIds、affectedFactionIds、affectedPlaceIds、affectedForceIds、affectedHoldingIds、followUpHooks。scope=local、仅 affectedNpcIds/sourceQuestIds、主角招人/训练/整编/领物/赶路等个人重要行动都不是纪事；这些事实留在 turnSummary、当前事项、NPC记忆和实体账本。本地准入门禁会拒绝不合格纪事但仍保留客观回合事件。');
  parts.push('- 历史锚点终态：Worldline Knowledge 中的 hintId 是历史锚点稳定追踪 ID；若同条提示另有 cardId，cardId 只用于诊断来源卡，终态标签必须使用 hintId。只有本回合已经通过区域以上、certainty=confirmed 的天下纪事确认某历史事件或本局等价结果确已实现时，才在该纪事 consequenceTags 增加 worldline:realized:<hintId>；只有结构化事实已明确使原事件不可能发生时，才增加 worldline:diverged:<hintId>。不得仅因年份到达、模型推测、资料卡出现或暂时未发生就写终态，也不得由模型写 worldline:expired。历史适用性为 diverged/realized/expired 时不得重演原事件；transformed_candidate 只能承接结构压力，不能换名复刻。');
  parts.push('- 纪事生命周期：已经结束的一次性事件写 status=historical 和 outcomeSummary。只有确实仍在演化的区域以上事件才写 active/cooling，并同时提供 progressSummary 以及 nextCheckAt 或 lastAdvancedAt；否则本地按已结束纪事归入历史。');
  parts.push('- writeback.worldEventUpdates: 更新已有纪事生命周期，必须复用 eventId；可把 status 设为 active/cooling/historical/corrected，并可写 archiveReason。historical 表示该纪事成为历史背景，默认不再作为当前局势投喂。');
  parts.push('- 天下纪事后果锚点只记录“此事件已经造成什么影响、影响哪些对象、后续牵出什么”，entity state changes require separate structured writeback。若事件改变 NPC 生死/位置/关系/记忆，或改变地点、势力、部队、领地等实体事实，必须额外使用对应结构化写回；不得只写 worldEventSummary。');
  parts.push('- 远场 NPC 存在感候选只是未裁定建议，不是已发生事实。若候选只说明“某人被风声/天下纪事/旧关系/战事提及”，可用 payload.type=npcAwarenessRegistered 登记隐藏意识索引；战事来源使用 sourceType=conflict、sourceIds=[conflictId]。若候选在正文中真正通过书信、使者、传闻、邀请、警告、公开消息或缺席感进入玩家视野，并且目标 NPC 已有人物志档案，可用 payload.type=npcPresenceUpdated 记录近况提示，并可写 relatedConflictIds。任何 NPC 位置、关系、记忆、任务、风声或天下纪事变化仍要求 entity state changes require separate structured writeback。');
  parts.push('- writeback.npcProfileSuggestions 与 payload.command.action=upsertNpcProfile 使用同一字段；遇到新 NPC、在场 NPC、剧情重要 NPC 或当前世界书中的历史重点人物，优先写入 writeback.npcProfileSuggestions，本地会校验并落入人物志。');
  parts.push('- 人物志承接规则：若正文、当前事项、风声线索或天下纪事中反复点名与玩家当前处境直接相关的上级、同僚、使者、敌将、谈判对象、历史重点人物，必须写入人物志并给稳定 npcId；主角本人不写入 NPC 档案；不得只在动态条目中引用其姓名而没有可承接 NPC 档案。');
  parts.push('- 人物志稳定身份规则：已有 NPC 必须复用上下文中的稳定 npcId；以辖区加唯一官职作为占位名的人物（例如“颍川太守”）若人物志已存在，不得改用 prefect/taishou 等另一套 npcId 重复建档，应更新同一人物档案。普通同名人物仍不得仅凭姓名强行合并。');
  parts.push('- 历史重点人物档案优先服从资料库、本局既有档案与已成立记忆；创建或补全时应让 summary/personality/motivation 分别承载人物定位、稳定决策倾向和当前长期动机。不得为了“更有戏”随机覆盖 personality 或 motivation，不得把人物简化为固定口癖；本局已经发生的身份、关系和记忆变化优先于历史惯性。');
  parts.push('- 人物志强制闭环：本回合直接出场、发话、发令、参与战斗、参与任务推进或被玩家当面处理的有名有姓人物，尤其是历史重点人物、上级、君主、重臣、将领、谋士、使者、谈判对象和战略对手，必须在 writeback.npcProfileSuggestions 建档或更新；不得只写入正文、当前事项、风声线索、天下纪事或 npcAwarenessRegistered。若只是远方传闻中被提及且尚未进入玩家可互动视野，可先用 npcAwarenessRegistered。');
  parts.push('- payload.command.action=upsertNpcProfile: 新增或更新 NPC 档案；命令名只能写 upsertNpcProfile，不得输出 updateNpcProfile。若需要通过 statePatches 强制立即生效，可以使用此命令。必须包含 npcId/name/sex/age/role/currentIdentity/locationId/isPresent/isFocused/summary/appearance/personality/motivation/relationToPlayer/contactLevel/recentAttitude/abilityScores/traits。relationToPlayer/recentAttitude 必须写自然中文短句，不得写 neutral/hostile/submissive 等英文枚举。upsertNpcProfile 即使更新已有 NPC 也必须提供完整必填字段，不得省略 appearance/personality/motivation 等现有档案内容；若只需更新身份、行装或在场状态，改用对应的窄命令，不要输出残缺 upsertNpcProfile。可选 birthDate 与 ageKnownAtDate；birthDate 可用于后续按 currentDate 派生当前年龄，ageKnownAtDate 缺省时本地使用当前时间。abilityScores 必须包含武力、统率、智力、政治、魅力、机运；机运是隐藏判定资料，不要在玩家面板明牌解释。普通 NPC 通常 1-2 条特质，历史重点人物可 3-6 条，并应符合当前世界书历史定位。traits[].source 不得省略或写空字符串；可用 identity、event、history、worldline、writeback 等简短来源。traits[].rarity 必须使用 white/green/blue/red/gold；普通人物、玩家自填或不确定特质默认 white，历史重点人物可按世界书定位提高等级。rarity 只表示 UI 颜色和叙事权重，不直接加数值。特质通过 promptHint/checkHooks 影响叙事与轻量判定，不作为复杂技能树。重要 NPC 行装：创建或补全当前局势关键的上级、君主、重臣、将领、豪族首脑、使者、谈判对象或直接交锋者时，若其身份/场景足以推断长期随身装备、官印符节、军令凭证、家族信物或随身文书，应在同一条 writeback.npcProfileSuggestions[].equipment / writeback.npcProfileSuggestions[].inventory 写入 1-3 件稳定行装；equipment 每项包含 id/slot/name/quality/description，slot 只能是 weapon/armor/mount/treasure；inventory 每项包含 id/name/quantity/category/description。不得硬编码具体名人专属宝物，不确定时写身份层级通用物件；普通远场传闻人物不要机械补行装。若本回合创建或补全的重要 NPC 已经在剧情中确认长期绝艺，可在 writeback.npcProfileSuggestions[].uniqueArts 随档案写入，字段同 updateCharacterUniqueArts.uniqueArts；不要给每个普通 NPC 机械生成绝艺。');
  parts.push('- payload.command.action=updateNpcPresence: 已有 NPC 离开、到达、同行、分队或移动到其他地点/场景时，用此窄命令更新 npcId/locationId/isPresent，可选 isFocused；不得为改在场状态而输出残缺 upsertNpcProfile。isPresent=true 只表示 NPC 与玩家处于同一当前场景，或明确仍在同一同行队伍；同城但不在当前场景、远场关注、可到达、任务相关都不等于在场。');
  parts.push('- payload.command.action=updateNpcBackgroundActivity: 只为重要、当前剧情相关、正在执行任务或存在未结事项的已有 NPC 记录一个最重要的后台行动槽；必须包含 npcId 与 activity。activity 为对象时必须包含 activityId、summary、status(planned/active/blocked/completed/cancelled)，可含 locationId、startedAt、dueAt、lastEvaluatedAt、sourceType(narrative/quest/plot/worldTrend/conflict/system)、sourceIds、visibility(hidden/playerKnown/public)；activity=null 表示明确清除旧槽。summary 只写当前正在做什么或已经确认到哪一步，dueAt 只是下一复核时间，不等于届时必然成功、到达、死亡、完成任务或触发事件。不得给所有 NPC 每回合机械生成后台行动；时间投影中的 due/re-entry 项只是未裁定候选，必须结合本回合可见事实后再结构化写回。');
  parts.push('- 进行中世界事件沿用 worldEventSummary/worldEventUpdates，不另造事件表。progressSummary 只写已经成立的当前进展；nextCheckAt 是下一复核时间；lastAdvancedAt 只在本回合确认发生实质推进时更新。nextCheckAt 到达只表示允许评估，不得自动历史化、自动结算或提前写未来结果。');
  parts.push('- LLM 生成或补全 NPC 时，必须提供明确年龄。不得生成“年龄未知”的 NPC。age 应为当前游戏时间下可解析的数字；若知道出生年份/日期，可以额外提供 birthDate。不要每回合批量改写 NPC.age，跨年后的当前年龄由本地按 currentDate 派生。');
  parts.push('- 当创建或补全符合条件的女性 NPC 档案时，优先在 writeback.npcProfileSuggestions[].femaleProfile 内随普通 NPC 档案一起写入；如果使用 statePatches，则必须在同一批输出中先使用 upsertNpcProfile 创建/更新普通 NPC 档案，再使用 updateNpcFemaleProfile 写入女性档案，二者必须使用同一个 npcId。已有 NPC 必须复用上下文提供的 npcId，不得生成漂移 ID。');
  parts.push('- 女性 NPC 当前年龄小于 18 或年龄缺失/无法解析时，不得输出、补全、投喂 adultPrivateProfile；只能自然承接普通人物关系、记忆和公开档案。');
  parts.push('- 女性档案完整度：appearanceDescription、bodyDescription、clothingStyle 是后续正文与文生图的完整稳定锚点；写入时必须是稳定档案真值，不写玩家误读版，不写当前过程态，也不得保留“未知 / 不详 / 待补充 / 略 / 普通 / 正常”这类占位值。');
  parts.push('- 成年女性长期关系锚点：当成年女性 NPC 被明确创建或补全为红颜、夫人外交、内宅牵引或长期亲密关系目标，且剧情已经形成可承接的身体印象、偏好、边界、敏感、风险或关系控制信息时，应在同一 femaleProfile 中建立 adultPrivateProfile 作为长期私密锚点；不得因为尚未进入成人场景就忽略已形成的长期私密边界、偏好与风险锚点。没有稳定事实时不要硬编具体身体字段，也不要用“未知/待补充”占位。');
    parts.push('- adultPrivateProfile 写作口径：身体字段是长期私密锚点和未来文生图锚点，应直白、具体、稳定；偏好、边界、敏感、风险、子宫和初夜字段是长期信息。正文过程态、审美赞美和当前动作流水账应留在正文或 NPC 记忆，不得写成正文小作文；避免诗化比喻、审美套话、泛泛赞美和同义形容词堆叠，不要把无关部位或无关偏好机械枚举进档案。年龄与出生信息只写 NPC 基础档案 age/birthDate；bodyDescription 与 adultPrivateProfile 身体字段只记录可观察、稳定的身体事实，不要把年龄描述固化为每回合必读标签。“三十多岁”“四十出头”“熟女”“熟透”等词都允许在正文自然使用，不设禁词；档案层只负责避免固定回灌，不限制正文首次或自然使用。');
  parts.push('- payload.command.action=updateNpcFemaleProfile: 仅在成年女性 NPC 的女性档案或成人私密档案出现新增长期信息量时使用；不得每回合机械更新，也不得凭空补全。必须包含 npcId、npcName；公开女性档案可写入 birthday、addressToPlayer、relationshipNotes、publicIntimacyNotes、appearanceDescription、bodyDescription、clothingStyle、appearanceExtension、personalityCore、affectionProgressionCondition、relationshipProgressionCondition、relationshipNetwork[{targetName,relationship,notes}]、emotionalBoundary、updatedAt、source。birthday 仅作为女性档案展示字段，不作为年龄锚点；出生年份/日期写 NPC 基础档案 birthDate。adultPrivateProfile 仅在当前年龄 >= 18 且剧情已产生有效信息时写入，可包含 adultPrivateProfile.summary、adultPrivateProfile.breastDescription、adultPrivateProfile.vaginaDescription、adultPrivateProfile.anusDescription、adultPrivateProfile.sexualPreferenceNotes、adultPrivateProfile.sensitiveSpotNotes、adultPrivateProfile.preferenceNotes、adultPrivateProfile.boundaryNotes、adultPrivateProfile.sensitiveNotes、adultPrivateProfile.relationshipRiskNotes、adultPrivateProfile.wombProfile{status,cervixStatus,inseminationRecords[{date,description,pregnancyCheckDate}]}、adultPrivateProfile.virgin、adultPrivateProfile.firstNightPartner、adultPrivateProfile.firstNightTime、adultPrivateProfile.firstNightDescription、adultPrivateProfile.updatedAt、adultPrivateProfile.source。');
  parts.push('- updateNpcFemaleProfile 写回口径：保留旧档案并按新增事实合并总结；只记录长期可承接的关系状态、偏好、边界、风险与公开档案变化，临时过程态优先写入正文或 NPC 记忆。成人私密档案若写入，不得只写 adultPrivateProfile.summary 来替代 breastDescription、vaginaDescription、anusDescription、sexualPreferenceNotes、sensitiveSpotNotes、boundaryNotes 等长期字段。wombProfile.pregnancy、pendingPregnancyChecks、lastPregnancyCheck、pregnancyHistory 是引擎管理真值，禁止通过 updateNpcFemaleProfile 直接写入或覆盖。');
  parts.push(`- 怀孕与子嗣承接当前设置=${pregnancyMode}。仅限主角与当前年龄 >= 18 的女性 NPC；不得为未成年人、年龄缺失人物或普通 NPC-NPC 互动建立怀孕机会。${pregnancyMode === 'off' ? '当前已关闭：不得输出 recordPregnancyRisk；既有孕期仍由引擎推进。' : '当前允许建立新机会，但发生一次也不等于必然怀孕，概率、延迟判定、孕期月份与分娩窗口全部由引擎计算。'}`);
  parts.push('- payload.command.action=recordPregnancyRisk：只有本回合正文已明确发生主角与成年女性 NPC 之间具有受孕可能的行为时才写入，禁止凭关系亲密、同床、接吻或含糊暗示推断。必须包含 npcId、npcName、riskType(unprotected/tryingToConceive/reducedRisk)、summary；同一名女性每回合最多一条。unprotected=明确未避孕且体内射精；tryingToConceive=双方明确求子/备孕且发生有效行为；reducedRisk=明确存在体外或避孕但仍保留低风险。引擎会把同一游戏日的多次有效行为合并为一次概率加成，不同游戏日各自建立延后判定批次；任一批次确认受孕后，后续未决批次自动失效。不要输出概率、骰值、判定结果、受孕日或预产期。');
  parts.push('- payload.command.action=resolvePregnancy：只有上下文已存在疑似/确认/临产妊娠，且本回合正文明确发生妊娠结束时才写入。必须包含 npcId、npcName、outcome(liveBirth/ended)、summary；liveBirth 可在正文已确定时附 childName、childSex(男/女)，未取名则省略 childName，由引擎建立诚实的临时名。不得随机编造流产、死胎或致命难产；outcome=ended 仅能承接玩家明确选择或已经成立的严重剧情事实。出生孩子由引擎创建为普通人物志 NPC 与亲属缘份，不另建子嗣管理系统。');
  parts.push('- payload.command.action=upsertHeroineThread: 新增或更新红颜关系线索；仅用于成年 NPC 与主角之间已经形成可长期承接的情感牵引、承诺、风险、阶段推进或近期进展时使用，不得每回合机械写入。同一 npcId 只能保留一条红颜关系线；上下文已投喂该 NPC 的关系线时，必须逐字复用已投喂的 heroineThreadId，禁止为同一人物另造 ht_、thread_、bond_ 等新 ID。新建时必须完整包含 heroineThreadId、npcId、npcName、status(active/paused/resolved/archived)、stage、relationshipRole、summary；更新已有 heroineThreadId 时，可仅包含 heroineThreadId 与明确变化字段，未提供字段会保留。lastUpdatedAt 可省略并由系统填入当前游戏时间；若提供应为非空字符串，lastUpdatedAt 显式 null 不允许。可选字段包括 currentPull、riskNotes、promiseNotes、recentProgress、tags、milestones[{milestoneId,happenedAt,summary,source}]、source；null 只能清空可选字段，tags、milestones 也可用显式空数组清空，属性值为 undefined 等同未提供且不得清空。npcId、npcName、status、stage、relationshipRole、summary 等必要字段不得用 null 清空。必须复用人物志中现存成年 NPC 的 npcId，npcName 会按该 NPC 人物志 canonical name 规范化，未知 npcId 不得写入。红颜是独立关系档案，不替代 femaleProfile/adultPrivateProfile，也不写入普通羁绊。');
  parts.push('- payload.command.action=upsertBondThread: 新增或更新非红颜的羁绊关系线；用于结义、亲族、师徒、君臣、盟友、恩债、竞争、仇敌等长期关系，不用于红颜、恋慕或成人私密关系。新建时必须完整包含 bondThreadId、targetNames(string[])、bondType(sworn/kinship/mentor/lordVassal/ally/debt/rival/enemy/other)、status(active/paused/resolved/archived)、summary；更新已有 bondThreadId 时，可仅包含 bondThreadId 与明确变化字段，未提供字段会保留。lastUpdatedAt 可省略并由系统填入当前游戏时间；若提供应为非空字符串，lastUpdatedAt 显式 null 不允许。可选字段包括 targetNpcIds、currentTension、promiseNotes、conflictNotes、recentProgress、tags、milestones[{milestoneId,happenedAt,summary,source}]、source；null 只能清空可选字段，tags、milestones 也可用显式空数组清空，属性值为 undefined 等同未提供且不得清空。targetNames、bondType、status、summary 等必要字段不得用 null 清空。若提供 targetNpcIds，targetNpcIds 必须逐项复用人物志中现存 NPC 的 npcId，targetNames 会按对应人物志 canonical name 规范化，未知 ID 不得写入；从 ID 模式切换为名称模式必须显式写 targetNpcIds:null，无法确认 ID 时仅写 targetNames，不得臆造 targetNpcIds。');
  parts.push('- writeback.protagonistProfile: 主角档案开局具体化与补空入口；真开局可用于落定具体出身/身份/外貌/性格。普通回合不得用 protagonistProfile 反复改写已有出身、身份、外貌、性格或身份摘要；它只用于补齐仍为空的主角档案锚点。剧情中真实产生新的稳定官职、军职、所属关系或身份变化时，使用 statePatches 中的 updateCharacterIdentity。');
  parts.push('- payload.command.action=updateCharacterIdentity: 更新主角或 NPC 的姓名/字/号/别称/常用称呼、出身、当前身份、所属势力、效力对象、官职、军职、爵位封号、身份摘要、稳定外貌与核心性格；称呼只供识别显示，正文中具体如何称呼由 LLM 根据关系与场景自然发挥。只有正文实际确立新的稳定身份事实时才写入，不要把普通回合的措辞、摘要改写、当前事项、风声线索或纪事转述当成身份变化；稳定身份事实不得只写入记忆、事项或纪事，必须同步 updateCharacterIdentity；凡 currentIdentity 发生变化，必须在同一命令同步写入与新身份匹配的 currentIdentityDescription，并同步刷新已经发生变化的 identitySummary，不得沿用旧身份说明；不要留下与主角档案冲突的具体身份。');
  parts.push('- payload.command.action=updatePlayerLoadout: 更新主角个人钱财、装备和背包。personalMoney 是开局初始化或明确重算时的绝对余额；普通回合买卖、花费、赠予、领取、存取、个人军饷或缴获必须使用 personalMoneyDelta，支出写负数、收入写正数，不能与 personalMoney 同时提供，也不得透支。个人钱财只写 player.personalMoney，不得写入 playerResources.money/钱财；势力总资源仍写 updateResourceLedger。真开局可用 equipment/inventory 写入初始全量行装。普通回合获得、失去、消耗、损坏、赠送、换装时优先使用 inventoryChanges/equipmentChanges 做局部变更，不要为了一件物品覆盖整个背包。获得/新增背包物品使用 inventoryChanges:[{action:"upsert", item:{id,name,quantity,...}}]，不要用 action:"add"。inventoryChanges.remove/setQuantity.itemId 必须非空，并逐字复用 playerEconomySnapshot.currentPlayerInventory 中的稳定 itemId；没有明确目标 itemId 时省略该候选，不得输出空 itemId。更新同一种既有物品时必须复用其 itemId，upsert.quantity 写变化后的绝对总数，不得为同名既有物品另造 ID。消耗品实际使用、物品交出/赠送/遗失/损毁/过期，或一次性凭证的权益已经兑现时，同一回合必须用 inventoryChanges.remove 或 setQuantity 写回减少/移除；部分消耗写 remove.quantity，全部耗尽可写 setQuantity=0。仅出示、核验或仍可重复使用的长期凭证不得移除；关键物品也不等于永久不可移除，是否移除只取决于本回合是否已真实完成其生命周期。装备品级 quality 由 LLM 按剧情判断写成自然语言短标签，不受固定枚举限制。可装备背包物品应写 category=equipment、equipSlot(weapon/armor/mount/treasure)、quality、description；从背包装备到身上使用 equipmentChanges: [{ action:"equipFromInventory", itemId, slot, treasureIndex? }]，equipFromInventory.itemId 必须非空；没有实际换装不要输出空 itemId 的 equipmentChanges 候选。');
  parts.push('- 主角经济与背包写回核对：返回 JSON 前，先核对玩家行动与最终正文已经成立的事实，再逐项对照 playerEconomySnapshot。仅在正文中提到、看见或回忆既有物品，不等于再次获得，不得再次 upsert；只有实际取得、数量增加或稳定属性变化才更新。购买成立时必须同时写入物品获得与负数 personalMoneyDelta；出售成立时必须同时写入物品减少与正数 personalMoneyDelta。领取势力粮草、军械等公共资源时写 updateResourceLedger；若同时交回一次性手令或凭证，必须另写 updatePlayerLoadout.inventoryChanges.remove/setQuantity。支付、赠予、领取、退还、存取等个人钱财变化不得只写在正文。以上事实判断由 LLM 依据本回合最终正文完成；本地不会按关键词代替你裁定。');
  parts.push('- 单一物品操作范围：玩家明确操作某一个稳定物品时，只能改变该物品的稳定 ID；不得因为其他物品同属手令、凭证、文书、药品，名称相似，或此前回合曾被提及，就顺带消耗、核销、交出或移除其他背包物品。若本回合确实要让多个现存物品完成生命周期，玩家行动必须逐项明确点名这些物品并逐项复用对应稳定 ID；不能用正文中的“全部凭证”“同类文书”等概括替代玩家授权。');
  parts.push('- payload.command.action=updateNpcLoadout: 更新已有 NPC 装备、携物；NPC 装备、携物获得、失去、损坏、交出、赠送、夺取、搜得、托付、消耗时写局部变更，优先使用 inventoryChanges/equipmentChanges，不要为了一件物品覆盖 NPC 全量行装。updateNpcLoadout.equipmentChanges action 只能用 upsert/remove/unequip，NPC 不支持玩家专属 equipFromInventory；NPC 把携物换成装备时，同批用 inventoryChanges.remove 与 equipmentChanges.upsert 表达。必须包含 npcId/npcName；NPC 与玩家物品转移必须成对写 updateNpcLoadout + updatePlayerLoadout，确保双方得失同步。');
  parts.push('- payload.command.action=updatePlayerTraits: 更新主角开局/补全特质，并同步 worldStateDelta.openingTraitDetails。traits[].rarity 必须使用 white/green/blue/red/gold；rarity 由 LLM 按世界书、开局要求和角色定位判断，只表示 UI 颜色和叙事/轻量判定权重，不是直接数值加成。');
  parts.push('- payload.command.action=updateCharacterUniqueArts: 更新主角或 NPC 的绝艺；characterType=player/npc，NPC 必须复用稳定 npcId 或唯一 npcName。uniqueArts 是完整列表，每项必须包含 id、name、rarity、domain、level、description、effectSummary、source；可含 maxLevel、progress、acquiredAt、upgradedAt、promptHint、checkHooks、tags。rarity 使用 white/green/blue/red/gold；domain 只能是 personalCombat/warfare/strategy/social/governance/survival/craft/other。绝艺是可学习、可升级的长期能力锚点，不是固定招式树；获得、学习、升级或剧情确认长期能力变化时才写，不要每回合机械改写。');

  return parts.join('\n');
}

function appendEncounterV2StableSources(
  parts: string[],
  state: RuntimeState,
  selected: SelectedPromptContext,
  playerInput: string,
): void {
  parts.push('encounterV2StableSources:');
  parts.push('- 仅供 Encounter V2 触发和能力投影；actorId/sourceId/troopId/holdingId 必须逐字复用，禁止把姓名、player 别名或临时新 ID 当作稳定 ID。');
  parts.push(`- playerActorId: ${state.player.id}; playerName: ${state.player.name}`);

  for (const trait of state.player.traits ?? []) {
    parts.push(`- sourceId: ${trait.id}; ownerActorId: ${state.player.id}; sourceType: trait; label: ${trait.label}`);
  }
  for (const art of state.player.uniqueArts ?? []) {
    parts.push(`- sourceId: ${art.id}; ownerActorId: ${state.player.id}; sourceType: unique_art; label: ${art.name}; domain: ${art.domain}`);
  }
  for (const equipment of state.player.equipment ?? []) {
    parts.push(`- sourceId: ${equipment.id}; ownerActorId: ${state.player.id}; sourceType: equipment; slot: ${equipment.slot}; label: ${equipment.name}; quality: ${equipment.quality ?? 'unknown'}`);
  }
  for (const item of selectRelevantPlayerInventory(state.player, playerInput)) {
    parts.push(`- sourceId: ${item.id}; ownerActorId: ${state.player.id}; sourceType: item; label: ${item.name}; quantity: ${item.quantity}; quality: ${item.quality ?? 'unknown'}`);
  }

  const npcById = new Map<string, LuanShiNpc>();
  for (const npc of [...selected.presentNpcs, ...selected.focusedNpcs]) npcById.set(npc.npcId, npc);
  for (const npc of npcById.values()) {
    parts.push(`- actorId: ${npc.npcId}; actorName: ${npc.name}; sourceType: npc`);
    for (const trait of npc.traits ?? []) {
      parts.push(`- sourceId: ${trait.id}; ownerActorId: ${npc.npcId}; sourceType: trait; label: ${trait.label}`);
    }
    for (const art of npc.uniqueArts ?? []) {
      parts.push(`- sourceId: ${art.id}; ownerActorId: ${npc.npcId}; sourceType: unique_art; label: ${art.name}; domain: ${art.domain}`);
    }
    for (const equipment of npc.equipment ?? []) {
      parts.push(`- sourceId: ${equipment.id}; ownerActorId: ${npc.npcId}; sourceType: equipment; slot: ${equipment.slot}; label: ${equipment.name}; quality: ${equipment.quality ?? 'unknown'}`);
    }
  }

  for (const troop of selected.relevantTroops) {
    parts.push(`- troopId: ${troop.troopId}; troopName: ${troop.name}; troopType: ${troop.troopType}; factionId: ${troop.factionId ?? 'unknown'}; locationId: ${troop.locationId ?? 'unknown'}; leaderActorId: ${troop.leaderNpcId ?? 'unknown'}`);
  }
  for (const holding of selected.relevantHoldings) {
    parts.push(`- holdingId: ${holding.holdingId}; holdingName: ${holding.name}; locationId: ${holding.locationId ?? 'unknown'}; status: ${holding.status}`);
  }
}

const NPC_REUSE_CANDIDATE_LIMIT = 8;

function selectNpcReuseCandidates(
  state: RuntimeState,
  selected: SelectedPromptContext,
  playerInput: string,
): LuanShiNpc[] {
  const existingNpcs = filterProtagonistNpcClones(state, state.npcs ?? []);
  if (existingNpcs.length === 0) return [];

  const alreadyProjectedIds = new Set([
    ...selected.presentNpcs.map((npc) => npc.npcId),
    ...selected.focusedNpcs.map((npc) => npc.npcId),
  ]);
  const npcById = new Map(existingNpcs.map((npc) => [npc.npcId, npc]));
  const scores = new Map<string, number>();
  const matterText = buildNpcReuseMatterText(selected);

  const addScore = (npcId: string | undefined, score: number): void => {
    if (!npcId || alreadyProjectedIds.has(npcId) || !npcById.has(npcId)) return;
    scores.set(npcId, (scores.get(npcId) ?? 0) + score);
  };

  for (const quest of selected.activeQuests) {
    for (const npcId of quest.relatedNpcIds ?? []) addScore(npcId, 100);
    for (const npcId of quest.affectedNpcIds ?? []) addScore(npcId, 80);
  }

  for (const signal of selected.relevantSignals) {
    addScore(signal.relatedActorId, 80);
    for (const npcId of signal.affectedNpcIds ?? []) addScore(npcId, 60);
    for (const ref of signal.npcAwarenessRefs ?? []) addScore(ref.npcId, 60);
  }

  for (const trend of selected.relevantWorldTrends) {
    for (const npcId of trend.relatedNpcIds ?? []) addScore(npcId, 70);
    for (const npcId of trend.affectedNpcIds ?? []) addScore(npcId, 60);
    for (const ref of trend.npcAwarenessRefs ?? []) addScore(ref.npcId, 55);
  }

  for (const npc of existingNpcs) {
    if (alreadyProjectedIds.has(npc.npcId)) continue;
    if (npcIdentityMentioned(npc, playerInput)) addScore(npc.npcId, 90);
    if (npcIdentityMentioned(npc, matterText)) addScore(npc.npcId, 35);
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .map(([npcId]) => npcById.get(npcId))
    .filter((npc): npc is LuanShiNpc => Boolean(npc))
    .slice(0, NPC_REUSE_CANDIDATE_LIMIT);
}

function buildNpcReuseMatterText(selected: SelectedPromptContext): string {
  const chunks: string[] = [];

  for (const quest of selected.activeQuests) {
    chunks.push(
      quest.title,
      quest.description,
      quest.source ?? '',
      quest.currentStep ?? '',
      quest.stakes ?? '',
      quest.outcomeSummary ?? '',
      ...(quest.consequenceTags ?? []),
      ...(quest.followUpHooks ?? []),
    );
  }

  for (const signal of selected.relevantSignals) {
    chunks.push(
      signal.title ?? '',
      signal.content,
      signal.source,
      signal.potentialOutcomeSummary ?? '',
      ...(signal.consequenceTags ?? []),
      ...(signal.followUpHooks ?? []),
    );
  }

  for (const trend of selected.relevantWorldTrends) {
    chunks.push(
      trend.title,
      trend.summary,
      trend.source ?? '',
      trend.outcomeSummary ?? '',
      ...(trend.consequenceTags ?? []),
      ...(trend.followUpHooks ?? []),
    );
  }

  return chunks.filter(Boolean).join('\n');
}

function npcIdentityMentioned(npc: LuanShiNpc, text: string): boolean {
  if (!text) return false;
  return getNpcIdentityTokens(npc).some((token) => text.includes(token));
}

function getNpcIdentityTokens(npc: LuanShiNpc): string[] {
  return [
    npc.name,
    npc.courtesyName,
    npc.artName,
    npc.commonAddress,
    ...(npc.aliases ?? []),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value && value.length >= 2));
}

function formatNpcStateWriterLine(
  state: RuntimeState,
  npc: LuanShiNpc,
  currentDate: string,
  playerInput: string,
  actionIntent: ActionIntent,
  includeAdultPrivateProfile = false,
): string {
  const currentAge = deriveNpcCurrentAge(npc, currentDate);
  return [
    `- npcId: ${npc.npcId}`,
    `npcName: ${npc.name}`,
    npc.courtesyName ? `courtesyName: ${npc.courtesyName}` : '',
    npc.artName ? `artName: ${npc.artName}` : '',
    npc.aliases && npc.aliases.length > 0 ? `aliases: ${npc.aliases.join('、')}` : '',
    currentAge !== undefined ? `currentAge: ${currentAge}` : 'currentAge: unknown',
    npc.ageKnownAtDate ? `ageKnownAtDate: ${npc.ageKnownAtDate}` : '',
    npc.birthDate ? `birthDate: ${npc.birthDate}` : '',
    `role: ${npc.role}`,
    `currentIdentity: ${npc.currentIdentity ?? npc.role}`,
    `commonAddress: ${npc.commonAddress ?? 'none'}`,
    `faction: ${npc.factionName ?? npc.factionId ?? 'none'}`,
    `isPresent: ${isNpcPhysicallyPresent(state, npc)}`,
    npc.locationId ? `locationId: ${npc.locationId}` : '',
    npc.abilityScores ? `abilityScores: ${formatNpcAbilityScores(npc).replace('能力：', '')}` : '',
    npc.traits && npc.traits.length > 0 ? `traits: ${npc.traits.map((trait) => `${trait.label}${trait.promptHint ? `(${trait.promptHint})` : ''}`).join('、')}` : '',
    npc.uniqueArts && npc.uniqueArts.length > 0 ? `uniqueArts: ${npc.uniqueArts.map((art) => `${art.name}/${art.domain}/Lv.${art.level}${art.promptHint ? `(${art.promptHint})` : ''}`).join('、')}` : '',
    formatNpcLoadout(npc, playerInput, actionIntent),
    formatNpcFemaleProfile(npc, currentDate, includeAdultPrivateProfile),
  ].filter(Boolean).join('; ');
}
