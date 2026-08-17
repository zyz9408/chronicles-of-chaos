import type { LlmMessage } from '../llm/LlmClient';
import { compileCreativePromptMessages } from '../prompts/CreativePromptCompiler';
import type {
  CreativeNarrativeScope,
  TavernManagementSettings,
} from '../prompts/TavernPresetStore';

export type TurnPromptCacheLayout = 'default' | 'deepseek_prefix';

export const TURN_DYNAMIC_CONTEXT_MARKER = '## 本回合动态上下文';
export const STATE_WRITER_STABLE_PROTOCOL_MARKER = '## 稳定状态写回规则';

export interface StateWriterContextSections {
  runtimeContext: string;
  stableProtocol: string;
}

export function stripStateWriterStableProtocolMarker(stateWriterContext: string): string {
  const markerIndex = stateWriterContext.indexOf(STATE_WRITER_STABLE_PROTOCOL_MARKER);
  if (markerIndex < 0) return stateWriterContext;
  const beforeMarker = stateWriterContext.slice(0, markerIndex);
  let afterMarker = stateWriterContext.slice(
    markerIndex + STATE_WRITER_STABLE_PROTOCOL_MARKER.length,
  );
  if (afterMarker.startsWith('\r\n')) {
    afterMarker = afterMarker.slice(2);
  } else if (afterMarker.startsWith('\n')) {
    afterMarker = afterMarker.slice(1);
  }
  return `${beforeMarker}${afterMarker}`;
}

export function splitStateWriterContext(
  stateWriterContext: string,
): StateWriterContextSections | null {
  const stableProtocolIndex = stateWriterContext.indexOf(STATE_WRITER_STABLE_PROTOCOL_MARKER);
  if (stableProtocolIndex <= 0) return null;
  return {
    runtimeContext: stateWriterContext.slice(0, stableProtocolIndex).trimEnd(),
    stableProtocol: stateWriterContext.slice(stableProtocolIndex).trimStart(),
  };
}

export function resolveTurnPromptCacheLayout(config: {
  provider?: string;
  model?: string;
  baseUrl?: string;
}): TurnPromptCacheLayout {
  const normalizedModel = config.model?.trim().toLowerCase() ?? '';
  // Production reports show DeepSeek V4 Flash can finish a high-cache request
  // with reasoning tokens but no final content after the prefix reordering.
  // Keep the proven legacy ordering for Flash while retaining the optimization
  // for DeepSeek Pro and other explicitly identified DeepSeek models.
  if (normalizedModel.includes('deepseek-v4-flash')) return 'default';
  if (config.provider?.trim().toLowerCase() === 'deepseek') return 'deepseek_prefix';
  if (normalizedModel.includes('deepseek')) return 'deepseek_prefix';
  try {
    const hostname = new URL(config.baseUrl ?? '').hostname.toLowerCase();
    if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) {
      return 'deepseek_prefix';
    }
  } catch {
    // Invalid or relative compatible endpoints use the unchanged default layout.
  }
  return 'default';
}

export function buildTurnOutputRequirements(): string {
  return [
    '## 回合输出要求',
    '- 只返回 JSON 对象，不要添加 Markdown 或解释文字。',
    '- 严格遵循上文“主剧情响应协议 V1”和结构化写回格式；不要另起格式。',
    '- 真实主剧情回合必须在 statePatches 中写入合理 timeAdvance；有多个状态变更时全部写入数组。',
    '- 普通日常行动需要裁定且不属于战争/个人战时，可按当前 prompt 的 X/Y 差值合同输出 ordinaryChecks；difficulty 必须写入运行时合同给出的本局最终 Y，不得使用未修正基准；不要每回合机械输出。',
    '- 合同完整且结果一致的 ordinaryChecks 由本地自动发放阅历，成败均有成长；不得为刷阅历虚构或拆分判定，也不要在 statePatches/writeback 重复写经验。',
    '- narrativeText 中只有存在同一 ID 的 ordinaryChecks、upsertConflictRecord 或 upsertCombatRecord 时才可输出 `[[判定:...]]` 占位；不得输出孤儿判定标记。',
    '- writeback 只作为建议写回/诊断对象；需要立即生效的事实必须同时给出对应 statePatches。',
    '- 每回合必须输出 writeback.playerRecoveryKind，且只能是 none/rest/treatment。只有最终正文已经实际完成睡眠或休整才用 rest，已经实际完成治疗或疗伤才用 treatment；计划、询问、等待、被打断或未完成都用 none。不得返回生命、体力、恢复量或时长数值；rest/treatment 必须同时有与正文一致的正向 timeAdvance，由本地按实际游戏时钟差结算。',
    '- 每回合必须输出 writeback.encounterTransitionDecision：明确物理攻击已发动或不可避免交锋用 start；仍可选择是否交手的拔刀、威胁、追逐、对峙用 offer；没有本地冲突边界用 none。start/offer 必须同时提供合法 encounterStartIntent，none 必须返回 null。',
    '- mode=start 的个人战必须把 narrativeText 停在第一击命中和伤害结果之前；不得裁定胜负、伤亡、战利品或战后影响，不得写入 upsertCombatRecord。攻击由同伴或敌人发动时同样必须切入。',
    '- encounterStartIntent 的已有角色必须引用当前上下文稳定 actorId/npcId，主角使用 player.id。个人战还必须输出 escortAvailability：正文明确主角独自潜入、遣散护卫、与随从失散或确实孤身时写 explicitly_solo，其余现场可正常随行时写 normal。模型不得创建我方临时护卫；本地只会依据主角长期 personalEscortEntitlement 与该场景字段派生。没有长期人物身份的匿名敌人只允许通过 scopedCombatants 声明闭集原型/武器/护甲，ID 必须使用 encounterId:scoped:* 且只存在于本场；不得写入人物志、记忆或长期装备。',
    '- 若玩家亲自参与或直接指挥的具体军队冲突已经正式爆发，必须输出 mode=start 与 kind:"war" 的 encounterStartIntent，正文停在开战前；War 不使用 offer。不得裁定胜负、伤亡、领地结果或追击，不得写入 upsertConflictRecord。远场战争、玩家未直接参与的世界战事仍沿用开放叙事写回，不进入本地 War V2。',
    '- War V2 双方 troopIds、commanderActorId 与 targetHoldingId 必须复用当前账本稳定 ID；若地图目标或实际参战部队已经在正文中明确成立但尚未入账，必须在同响应 statePatches 中用完整 upsertHoldingLedger / upsertTroopLedger 声明开战前实体，再逐字引用同批 ID。战争目标领地的新声明必须写 operation=create 与 status=contested，并附 kind=war_target 的 controlEvidence；单纯驻军、守城或位于城墙不得登记为玩家领地。禁止按名称或正文猜孤立 ID，禁止夹带胜负、伤亡、溃散或领地易手。',
    '- War V2 的 troopIds 只能引用 lifecycleStatus=active/unknown 的当前建制；routed/merged/split/destroyed/surrendered/disbanded/archived 只作为历史与剧情对象。追击、收拢、招降、押解或清剿零散溃兵继续开放剧情并按需使用 ordinaryChecks；不得复活旧 troopId、擅自替换其他现役部队或强行进入战争。',
    '- 新生成或明确更新特质、装备、战斗物品时，可在 writeback.semanticProjections 同批输出能力语义投影；domain=personalCombat/warfare 的新绝艺必须逐字复用新绝艺 id，同批输出对应 personal_combat/war scope 的 executable unique_art 投影。稳定效果明确承诺每回合恢复生命/体力的新绝艺还必须输出 passive/hybrid、runtime_turn + after_runtime_turn 的结构化恢复投影；个人战每轮也生效时增加 personal_combat + round_start。本地不按名称或文案猜恢复。该投影是长期稳定语义蓝图，绝艺升级由本地调整本场有效数值，不得在后续开战回合重复生成或覆盖。新获得、购买或制作的生命/体力恢复消耗品必须逐字复用物品稳定 itemId，同批输出 executable 的 item 投影，并只用 restore_hp/restore_stamina、target=self 和正整数 quantityPerUse 表达可执行恢复及消耗。本地只接受白名单 schema，无法稳定执行的非战斗能力必须标为 narrative_only。',
    '- 返回前必须完成主角经济与背包闭环核对：以 playerEconomySnapshot 为写回前真值，只按玩家行动与最终 narrativeText 已经成立的事实写入个人钱财和物品变化；不得把正文提及既有物品误写成再次获得，也不得让购买、出售、领取资源后交回一次性凭证等双边变化只写一侧。',
    '',
    '## narrativeText 显示格式',
    '- narrativeText 只写玩家可读正文，不写 thinking、短期记忆、命令规划、选项文本或 Markdown。',
    '- 叙述、动作、环境、心理活动请单独成行，并以 `【旁白】` 开头。',
    '- 角色直接说出口的台词请单独成行，并以 `【角色名】` 开头；只有玩家输入提供了逐字台词时，才可用当前主角姓名标记并忠实承接，不要使用 `【你】`；玩家只输入行动意图或概述时，禁止自行扩写 `【主角名】` 台词。',
    '- 临时出现的军士、门吏、仆从、路人等人物只要有直接台词，也必须使用可读姓名或身份标签，例如 `【王六】`、`【军士】`、`【门吏】`；不要把直接台词塞进 `【旁白】` 段。',
    '- 没有明确说话人的内容归入 `【旁白】`；不要在正文里输出 XML 标签或旧式命令块。',
  ].join('\n');
}

function withoutTrailingReminder(userPrompt: string, finalReminder: string): string {
  const normalizedPrompt = userPrompt.trimEnd();
  const normalizedReminder = finalReminder.trim();
  if (!normalizedReminder || !normalizedPrompt.endsWith(normalizedReminder)) return normalizedPrompt;
  return normalizedPrompt.slice(0, -normalizedReminder.length).trimEnd();
}

export function buildTurnUserMessage(
  userPrompt: string,
  stateWriterContext: string,
  finalReminder = '',
  narrativeProseFinalReview = '',
  narrativeLengthFinalReminder = '',
  cacheLayout: TurnPromptCacheLayout = 'default',
): string {
  const normalizedReminder = finalReminder.trim();
  const normalizedProseFinalReview = narrativeProseFinalReview.trim();
  const normalizedLengthFinalReminder = narrativeLengthFinalReminder.trim();
  const promptWithoutAdultReminder = withoutTrailingReminder(userPrompt, normalizedReminder);
  const promptWithoutLengthReminder = withoutTrailingReminder(
    promptWithoutAdultReminder,
    normalizedLengthFinalReminder,
  );
  const stableAndDynamicPrompt = withoutTrailingReminder(
    promptWithoutLengthReminder,
    normalizedProseFinalReview,
  );
  const mainDynamicIndex = stableAndDynamicPrompt.indexOf(TURN_DYNAMIC_CONTEXT_MARKER);
  const stateWriterSections = splitStateWriterContext(stateWriterContext);
  const canUseDeepSeekPrefixLayout = cacheLayout === 'deepseek_prefix'
    && mainDynamicIndex > 0
    && stateWriterSections !== null;

  if (canUseDeepSeekPrefixLayout) {
    const stableMainPrompt = stableAndDynamicPrompt.slice(0, mainDynamicIndex).trimEnd();
    const dynamicMainPrompt = stableAndDynamicPrompt.slice(mainDynamicIndex).trimStart();
    return [
      buildTurnOutputRequirements(),
      '',
      stableMainPrompt,
      '',
      stateWriterSections.stableProtocol,
      '',
      dynamicMainPrompt,
      '',
      '## 状态写入上下文（本回合运行态）',
      stateWriterSections.runtimeContext,
      ...(normalizedProseFinalReview ? ['', normalizedProseFinalReview] : []),
      ...(normalizedLengthFinalReminder ? ['', normalizedLengthFinalReminder] : []),
      ...(normalizedReminder ? ['', normalizedReminder] : []),
    ].join('\n');
  }

  return [
    buildTurnOutputRequirements(),
    '',
    stableAndDynamicPrompt,
    '',
    '## 状态写入上下文',
    stripStateWriterStableProtocolMarker(stateWriterContext),
    ...(normalizedProseFinalReview ? ['', normalizedProseFinalReview] : []),
    ...(normalizedLengthFinalReminder ? ['', normalizedLengthFinalReminder] : []),
    ...(normalizedReminder ? ['', normalizedReminder] : []),
  ].join('\n');
}

export function buildTurnMessages(
  systemPrompt: string,
  userPrompt: string,
  stateWriterContext: string,
  finalReminder = '',
  narrativeProseFinalReview = '',
  narrativeLengthFinalReminder = '',
  creativeOptions: {
    scope?: CreativeNarrativeScope;
    playerName?: string;
    settings?: TavernManagementSettings;
    cacheLayout?: TurnPromptCacheLayout;
  } = {},
): LlmMessage[] {
  return compileCreativePromptMessages({
    systemPrompt,
    runtimeUserMessage: buildTurnUserMessage(
      userPrompt,
      stateWriterContext,
      finalReminder,
      narrativeProseFinalReview,
      narrativeLengthFinalReminder,
      creativeOptions.cacheLayout,
    ),
    scope: creativeOptions.scope ?? 'turn',
    playerName: creativeOptions.playerName,
    settings: creativeOptions.settings,
  }).messages;
}
