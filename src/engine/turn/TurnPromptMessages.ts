import type { LlmMessage } from '../llm/LlmClient';
import { compileCreativePromptMessages } from '../prompts/CreativePromptCompiler';
import type {
  CreativeNarrativeScope,
  TavernManagementSettings,
} from '../prompts/TavernPresetStore';

export function buildTurnOutputRequirements(): string {
  return [
    '## 回合输出要求',
    '- 只返回 JSON 对象，不要添加 Markdown 或解释文字。',
    '- 严格遵循上文“主剧情响应协议 V1”和结构化写回格式；不要另起格式。',
    '- 真实主剧情回合必须在 statePatches 中写入合理 timeAdvance；有多个状态变更时全部写入数组。',
    '- 普通日常行动需要裁定且不属于战争/个人战时，可输出 ordinaryChecks；不要每回合机械输出。',
    '- narrativeText 中只有存在同一 ID 的 ordinaryChecks、upsertConflictRecord 或 upsertCombatRecord 时才可输出 `[[判定:...]]` 占位；不得输出孤儿判定标记。',
    '- writeback 只作为建议写回/诊断对象；需要立即生效的事实必须同时给出对应 statePatches。',
    '- 若本回合只推进到个人冲突正式爆发，必须在 writeback.encounterStartIntent 输出 personal_combat 触发，并把 narrativeText 停在交锋即将开始的位置；此回合不得裁定胜负、伤亡、战利品或战后影响，不得写入 upsertCombatRecord。',
    '- encounterStartIntent 的双方只能引用当前上下文已有稳定 actorId/npcId；主角使用 player.id。不得按姓名临时编造参战 ID。',
    '- 若玩家亲自参与或直接指挥的具体军队冲突已经正式爆发，必须输出 kind:"war" 的 encounterStartIntent，正文停在开战前；不得裁定胜负、伤亡、领地结果或追击，不得写入 upsertConflictRecord。远场战争、玩家未直接参与的世界战事仍沿用开放叙事写回，不进入本地 War V2。',
    '- War V2 双方 troopIds 与 commanderActorId 必须复用当前账本稳定 ID；capture_holding / break_siege / relieve_siege 必须提供 targetHoldingId，不能按名称或正文猜领地。',
    '- 新生成或明确更新特质、绝艺、装备、战斗物品时，可在 writeback.semanticProjections 同批输出能力语义投影；本地只接受白名单 schema，无法稳定执行的能力必须标为 narrative_only。',
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
): string {
  const normalizedReminder = finalReminder.trim();
  const normalizedProseFinalReview = narrativeProseFinalReview.trim();
  const promptWithoutAdultReminder = withoutTrailingReminder(userPrompt, normalizedReminder);
  return [
    withoutTrailingReminder(promptWithoutAdultReminder, normalizedProseFinalReview),
    '',
    '## 状态写入上下文',
    stateWriterContext,
    '',
    buildTurnOutputRequirements(),
    ...(normalizedProseFinalReview ? ['', normalizedProseFinalReview] : []),
    ...(normalizedReminder ? ['', normalizedReminder] : []),
  ].join('\n');
}

export function buildTurnMessages(
  systemPrompt: string,
  userPrompt: string,
  stateWriterContext: string,
  finalReminder = '',
  narrativeProseFinalReview = '',
  creativeOptions: {
    scope?: CreativeNarrativeScope;
    playerName?: string;
    settings?: TavernManagementSettings;
  } = {},
): LlmMessage[] {
  return compileCreativePromptMessages({
    systemPrompt,
    runtimeUserMessage: buildTurnUserMessage(
      userPrompt,
      stateWriterContext,
      finalReminder,
      narrativeProseFinalReview,
    ),
    scope: creativeOptions.scope ?? 'turn',
    playerName: creativeOptions.playerName,
    settings: creativeOptions.settings,
  }).messages;
}
