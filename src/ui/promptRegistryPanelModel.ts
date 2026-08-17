import {
  getPromptRegistry,
  type PromptContentViewType,
  type PromptEditLevel,
  type PromptRegistryCategory,
  type PromptRegistryEntry,
  type PromptRiskLevel,
  isRuntimeOverridePromptEntry,
} from '../engine/prompts/PromptRegistry';
import { getPromptOverride } from '../engine/prompts/PromptOverrideStore';
import { resolvePromptContent } from '../engine/prompts/PromptResolver';

export interface PromptCategorySummary {
  category: PromptRegistryCategory;
  label: string;
  description: string;
  totalCount: number;
  highCount: number;
  lockedCount: number;
  order: number;
}

export interface PromptEntryDisplayModel {
  entry: PromptRegistryEntry;
  displayTitle: string;
  displayCategory: string;
  userDescription: string;
  contentViewType: PromptContentViewType | 'summaryOnly';
  contentText: string;
  contentNotes: string;
  contentPreview: string;
  isEditable: boolean;
  isCustomized: boolean;
  readonlyReason: string;
}

export interface PromptEntryEditabilityOptions {
  allowHighRiskEditing?: boolean;
}

export interface PromptEntryDisplayModelOptions extends PromptEntryEditabilityOptions {
  storage?: Storage;
}

const categoryLabels: Record<PromptRegistryCategory, string> = {
  'main.system': '主剧情 / 系统身份',
  'main.userProtocol': '主剧情 / 主回合协议',
  'main.narrativeStyle': '主剧情 / 正文文风',
  'main.stateWriter': '状态写回协议',
  'opening.trueOpening': '开场剧情',
  'npc.profileWriteback': 'NPC 建档',
  'npc.memoryWriteback': 'NPC 记忆写回',
  'npc.intentSimulation': 'NPC 动态模拟',
  'femaleProfile.writeback': '女性档案写回',
  'nsfw.adultIntimacy': '成人亲密描写',
  'map.writeback': '地图 / 移动写回',
  'memory.contextProjection': '记忆上下文投喂',
  'memory.summaryCompression': '记忆压缩',
  'worldbook.prompts': '世界书提示词',
  'settings.taskDescriptions': '设置 / 任务说明',
};

const categoryDescriptions: Record<PromptRegistryCategory, string> = {
  'main.system': '主回合 system prompt、世界书基调与当前叙事身份。',
  'main.userProtocol': '主回合玩家输入、JSON 输出、writeback、世界事件与剧情计划协议。',
  'main.narrativeStyle': '普通正文的场面、行动反馈、人物反应、有限视角与回合收口规则。',
  'main.stateWriter': 'StatePatch / LuanShiCommand 写回约束与可用命令说明。',
  'opening.trueOpening': '开场剧情、开局特质、行装与角色档案规则。',
  'npc.profileWriteback': 'NPC 普通档案、ID 稳定与在场 / 关注 NPC 投喂。',
  'npc.memoryWriteback': 'NPC 记忆写回与 pushNpcMemory 相关协议。',
  'npc.intentSimulation': 'NPC 动态模拟辅助模型的未裁定意图建议协议。',
  'femaleProfile.writeback': '女性档案、成人档案、年龄门禁与开局女性 NPC 建档。',
  'nsfw.adultIntimacy': '成人亲密场景通过现有门禁后的正文描写风格提示词。',
  'map.writeback': '当前地图上下文、地点写回、路线写回与移动规则。',
  'memory.contextProjection': '分层记忆投喂、NPC 记忆投喂与向量输入说明。',
  'memory.summaryCompression': '记忆压缩 API 的 system/user prompt 与 JSON schema。',
  'worldbook.prompts': '世界书叙事基准、语气、时间锚点和开局危机。',
  'settings.taskDescriptions': '设置页、API 任务与 prompt 协议文档索引。',
};

const categoryOrder: PromptRegistryCategory[] = [
  'main.system',
  'main.userProtocol',
  'main.narrativeStyle',
  'main.stateWriter',
  'opening.trueOpening',
  'npc.profileWriteback',
  'npc.memoryWriteback',
  'npc.intentSimulation',
  'femaleProfile.writeback',
  'nsfw.adultIntimacy',
  'map.writeback',
  'memory.contextProjection',
  'memory.summaryCompression',
  'worldbook.prompts',
  'settings.taskDescriptions',
];

const riskLevelLabels: Record<PromptRiskLevel, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

const editLevelLabels: Record<PromptEditLevel, string> = {
  safe: '可编辑候选',
  advanced: '高级编辑候选',
  locked: '协议锁定',
};

function buildContentPreview(contentText: string): string {
  const lines = contentText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.slice(0, 4).join('\n');
}

export function getPromptCategoryLabel(category: PromptRegistryCategory): string {
  return categoryLabels[category] ?? category;
}

export function getPromptCategoryDescription(category: PromptRegistryCategory): string {
  return categoryDescriptions[category] ?? '当前分类暂无说明。';
}

export function getRiskLevelLabel(level: PromptRiskLevel): string {
  return riskLevelLabels[level];
}

export function getEditLevelLabel(level: PromptEditLevel): string {
  return editLevelLabels[level];
}

function isPromptEntryHighRisk(entry: PromptRegistryEntry): boolean {
  return entry.riskLevel === 'high' || entry.editLevel === 'locked' || entry.protocolBound;
}

function getPromptEntryReadonlyReason(entry: PromptRegistryEntry, allowHighRiskEditing: boolean): string {
  if (!entry.runtimeUsed) return '非运行时提示词 / 仅说明，不会进入 LLM。';
  if (!isRuntimeOverridePromptEntry(entry)) {
    return '当前条目是运行时数据投影、索引或聚合说明，尚无独立稳定的 override 接入点。';
  }
  if (isPromptEntryHighRisk(entry) && !allowHighRiskEditing) {
    return '高风险或协议锁定提示词默认只读；开启高风险项编辑后可修改。';
  }
  return '';
}

function normalizeDisplayModelOptions(
  optionsOrStorage?: PromptEntryDisplayModelOptions | Storage,
): PromptEntryDisplayModelOptions {
  if (!optionsOrStorage) return {};
  const maybeStorage = optionsOrStorage as Partial<Storage>;
  if (typeof maybeStorage.getItem === 'function' && typeof maybeStorage.setItem === 'function') {
    return { storage: optionsOrStorage as Storage };
  }
  return optionsOrStorage as PromptEntryDisplayModelOptions;
}

export function isPromptEntryEditable(
  entry: PromptRegistryEntry,
  options: PromptEntryEditabilityOptions = {},
): boolean {
  return getPromptEntryReadonlyReason(entry, Boolean(options.allowHighRiskEditing)) === '';
}

export function getPromptEntryDisplayModel(
  entry: PromptRegistryEntry,
  optionsOrStorage?: PromptEntryDisplayModelOptions | Storage,
): PromptEntryDisplayModel {
  const options = normalizeDisplayModelOptions(optionsOrStorage);
  const defaultContentText = entry.defaultContent
    ?? entry.defaultContentTemplate
    ?? entry.defaultContentPreview
    ?? '此条提示词为运行时动态拼接或文档索引，当前仅展示用途说明和高级信息。';
  const readonlyReason = getPromptEntryReadonlyReason(entry, Boolean(options.allowHighRiskEditing));
  const isEditable = readonlyReason === '';
  const override = getPromptOverride(entry.id, options.storage);
  const contentText = resolvePromptContent(entry.id, defaultContentText, options.storage);
  const contentNotes = entry.contentNotes
    ?? (entry.editLevel === 'locked' ? '协议锁定：当前仅供查看，暂不开放编辑。' : '');

  return {
    entry,
    displayTitle: entry.displayTitleZh ?? entry.title,
    displayCategory: entry.displayCategoryZh ?? getPromptCategoryLabel(entry.category),
    userDescription: entry.userFacingDescription ?? entry.description,
    contentViewType: entry.contentViewType ?? (entry.protocolBound ? 'lockedProtocol' : 'summaryOnly'),
    contentText,
    contentNotes,
    contentPreview: buildContentPreview(contentText),
    isEditable,
    isCustomized: Boolean(override),
    readonlyReason,
  };
}

export function getPromptRegistryCategorySummaries(
  entries: PromptRegistryEntry[] = getPromptRegistry(),
): PromptCategorySummary[] {
  return categoryOrder
    .map((category, index) => {
      const categoryEntries = entries.filter((entry) => entry.category === category);
      return {
        category,
        label: getPromptCategoryLabel(category),
        description: getPromptCategoryDescription(category),
        totalCount: categoryEntries.length,
        highCount: categoryEntries.filter((entry) => entry.riskLevel === 'high').length,
        lockedCount: categoryEntries.filter((entry) => entry.editLevel === 'locked').length,
        order: index + 1,
      };
    })
    .filter((summary) => summary.totalCount > 0);
}

export function getPromptRegistryEntriesByCategory(
  category: PromptRegistryCategory,
  entries: PromptRegistryEntry[] = getPromptRegistry(),
): PromptRegistryEntry[] {
  return entries
    .filter((entry) => entry.category === category)
    .sort((left, right) => left.order - right.order);
}

export function getPromptRegistryGlobalActionLabels(): string[] {
  return ['高风险项编辑', '恢复全部默认', '导入提示词', '导出提示词'];
}
