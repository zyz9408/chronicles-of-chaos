import {
  loadNarrativeLengthFromStorage,
  type NarrativeLengthPreference,
} from '../settings/DisplaySettings';

export interface NarrativeLengthContract {
  preference: NarrativeLengthPreference;
  label: string;
  minimumCharacters: number;
  maximumCharacters: number;
  retryMinimumCharacters: number;
  rangeText: string;
  guidance: string;
  settingsDescription: string;
}

export interface NarrativeLengthEvaluation {
  preference: NarrativeLengthPreference;
  label: string;
  minimumCharacters: number;
  maximumCharacters: number;
  retryMinimumCharacters: number;
  actualCharacters: number;
  status: 'under_minimum' | 'within_target' | 'over_target';
  meetsMinimum: boolean;
  withinRetryTolerance: boolean;
}

export const NARRATIVE_LENGTH_CONTRACTS: Record<NarrativeLengthPreference, NarrativeLengthContract> = {
  compact: {
    preference: 'compact',
    label: '精简',
    minimumCharacters: 300,
    maximumCharacters: 600,
    retryMinimumCharacters: 270,
    rangeText: '300-600 字',
    guidance: '只保留关键场面、行动反馈和必要对白，不展开支线细节。',
    settingsDescription: '更短的剧情推进，适合快速测试。',
  },
  standard: {
    preference: 'standard',
    label: '标准',
    minimumCharacters: 600,
    maximumCharacters: 1000,
    retryMinimumCharacters: 540,
    rangeText: '600-1000 字',
    guidance: '写清关键互动、行动反馈、人物取舍和局面变化，避免只做摘要。',
    settingsDescription: '默认篇幅，兼顾细节和推进。',
  },
  rich: {
    preference: 'rich',
    label: '丰富',
    minimumCharacters: 1000,
    maximumCharacters: 1600,
    retryMinimumCharacters: 900,
    rangeText: '1000-1600 字',
    guidance: '增加有效阻力、动作细节、对话往复、心理变化和关系余波；环境只有实际参与因果时才展开。',
    settingsDescription: '更重视有效对白、行动过程、阻力与后果。',
  },
  long: {
    preference: 'long',
    label: '长篇',
    minimumCharacters: 1600,
    maximumCharacters: 2400,
    retryMinimumCharacters: 1440,
    rangeText: '1600-2400 字',
    guidance: '以完整因果链推进为目标，充分展开动作、对话、人物取舍、局势代价和后续钩子；环境只有实际参与因果时才展开。除非玩家行动极短且确实无事发生，不要压缩成 600-800 字短段。',
    settingsDescription: '更完整地展开因果链，消耗更多输出 token。',
  },
};

export function getNarrativeLengthContract(
  preference: NarrativeLengthPreference = loadNarrativeLengthFromStorage(),
): NarrativeLengthContract {
  return NARRATIVE_LENGTH_CONTRACTS[preference] ?? NARRATIVE_LENGTH_CONTRACTS.standard;
}

export function buildNarrativeLengthGuidance(
  contract: NarrativeLengthContract = getNarrativeLengthContract(),
): string {
  return [
    '## 正文篇幅要求',
    `当前设置：${contract.label}（目标 narrativeText 正文 ${contract.rangeText}，最低 ${contract.minimumCharacters} 个非空白字符）。`,
    contract.guidance,
    '这里的字数只指 narrativeText 正文；不要把建议行动、状态写回或 JSON 字段名计入正文篇幅。',
    '不要为了凑字机械复述背景、重复资料库或堆砌空泛总结；应把篇幅用在可见事实、人物互动、行动过程、判定前后反馈和关系/局势后果上。',
  ].join('\n');
}

export function buildNarrativeLengthFinalReminder(
  contract: NarrativeLengthContract = getNarrativeLengthContract(),
): string {
  return [
    '## 正文篇幅提交前检查',
    `完成上述正文删改后，narrativeText 仍必须不少于 ${contract.minimumCharacters} 个非空白字符，目标范围为 ${contract.rangeText}。`,
    '返回 JSON 前只对 narrativeText 自行计数；建议行动、状态写回、JSON 字段名和空白均不计入。',
    '若正文不足，必须在不新增玩家决定、不改变判定、胜负、时间、钱财、物品或其他写回事实的前提下，用当前已经成立的有效对白、行动过程、阻力、证据、人物取舍和可见后果补足。',
    '禁止用背景复述、资料库摘抄、同义反复、空泛总结或与因果无关的环境描写凑字；不要输出计数过程。',
  ].join('\n');
}

export function countNarrativeCharacters(text: string): number {
  return text.replace(/\s+/g, '').length;
}

export function evaluateNarrativeLength(
  text: string,
  contract: NarrativeLengthContract = getNarrativeLengthContract(),
): NarrativeLengthEvaluation {
  const actualCharacters = countNarrativeCharacters(text);
  const status = actualCharacters < contract.minimumCharacters
    ? 'under_minimum'
    : actualCharacters > contract.maximumCharacters
      ? 'over_target'
      : 'within_target';

  return {
    preference: contract.preference,
    label: contract.label,
    minimumCharacters: contract.minimumCharacters,
    maximumCharacters: contract.maximumCharacters,
    retryMinimumCharacters: contract.retryMinimumCharacters,
    actualCharacters,
    status,
    meetsMinimum: actualCharacters >= contract.minimumCharacters,
    withinRetryTolerance: actualCharacters >= contract.retryMinimumCharacters,
  };
}

export function shouldRegenerateNarrativeLength(
  evaluation: NarrativeLengthEvaluation,
  retryEnabled = true,
): boolean {
  return retryEnabled
    && !evaluation.withinRetryTolerance
    && (evaluation.preference === 'rich' || evaluation.preference === 'long');
}

export function buildNarrativeLengthRegenerationDirective(
  evaluation: NarrativeLengthEvaluation,
): string {
  return [
    '## 正文篇幅不合格：整份响应重生成',
    `上一份候选的 narrativeText 只有 ${evaluation.actualCharacters} 个非空白字符，低于“${evaluation.label}”档重写阈值 ${evaluation.retryMinimumCharacters} 个（目标下限 ${evaluation.minimumCharacters} 个）；该候选已被整份丢弃，正文和写回均未生效。`,
    '请从头重新生成一份完整、独立、可校验的 JSON 响应，重新给出 narrativeText、suggestedActions、statePatches/statePatch、ordinaryChecks 与 writeback；不得只补写正文片段，不得引用、修补或延续上一候选 JSON。',
    `新 narrativeText 必须达到 ${evaluation.minimumCharacters}-${evaluation.maximumCharacters} 字目标范围，返回前按非空白字符自行复核。`,
    '在不新增玩家决定、不改变判定事实和结构化状态合同的前提下，用有效对白、行动过程、现实阻力、证据变化、人物取舍与可见后果补足；禁止背景复述、同义反复和无因果环境灌水。',
    '只返回新的完整 JSON 对象，不输出解释、计数过程或上一候选内容。',
  ].join('\n');
}
