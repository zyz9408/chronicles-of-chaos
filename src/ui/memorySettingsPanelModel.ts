import type { MemoryProjectionSettings, RuntimeState } from '../engine/types';
import { ensureLuanShiState, type NormalizedLuanShiState } from '../engine/state/createInitialRuntimeState';

export type MemorySettingField =
  | 'enableAutoMemorySummary'
  | 'preferDedicatedMemorySummaryApi'
  | 'recentRawTurnLimit'
  | 'recentTurnLimit'
  | 'recentTurnCompressThreshold'
  | 'recentTurnKeepAfterCompress'
  | 'npcRecentMemoryDefaultLimit'
  | 'npcRecentMemoryImportantLimit'
  | 'focusedNpcRecentMemoryLimit'
  | 'npcMemoryCompressThreshold'
  | 'npcMemoryKeepAfterCompress'
  | 'midTermSummaryLimit'
  | 'longTermFactLimit'
  | 'vectorResultLimit'
  | 'maxPromptMemoryTokens'
  | 'recentStoryTokenBudget'
  | 'npcMemoryTokenBudget'
  | 'midTermTokenBudget'
  | 'longTermFactTokenBudget'
  | 'locationMemoryTokenBudget'
  | 'retrievalTokenBudget';

export interface MemorySettingControl {
  field: MemorySettingField;
  label: string;
  description: string;
  kind: 'boolean' | 'number';
  min?: number;
  max?: number;
  step?: number;
}

export interface MemorySettingSection {
  id: string;
  title: string;
  description: string;
  controls: MemorySettingControl[];
}

export interface MemoryArchiveStats {
  recentTurnSummaries: number;
  midTermSummaries: number;
  longTermStorySummaries: number;
  longTermFacts: number;
  npcInteractionSummaries: number;
  npcMidTermSummaries: number;
  npcLongTermSummaries: number;
  locationMemorySummaries: number;
}

export interface MemorySettingsPanelModel {
  available: boolean;
  emptyReason?: string;
  settings: MemoryProjectionSettings | null;
  archiveStats: MemoryArchiveStats;
  sections: MemorySettingSection[];
}

const effectiveMemorySettingSections: MemorySettingSection[] = [
  {
    id: 'summary',
    title: '自动压缩',
    description: '玩家每 20 条近期摘要压缩为 1 条中期；每 10 条中期再压缩为 1 条长期。',
    controls: [
      {
        field: 'enableAutoMemorySummary',
        label: '自动记忆压缩',
        description: '关闭后不会在回合结束后自动调用记忆压缩 API。',
        kind: 'boolean',
      },
      {
        field: 'preferDedicatedMemorySummaryApi',
        label: '优先使用记忆摘要 API',
        description: '开启后优先走“记忆压缩/摘要”任务路由；未配置时仍回退主剧情 API。',
        kind: 'boolean',
      },
      {
        field: 'recentTurnCompressThreshold',
        label: '近期摘要压缩阈值',
        description: '累计达到该数量后生成一条玩家中期摘要，推荐 20。',
        kind: 'number',
        min: 5,
        max: 500,
        step: 1,
      },
      {
        field: 'recentTurnKeepAfterCompress',
        label: '压缩后保留近期摘要',
        description: '压缩完成后仍保留多少条近期摘要，保证刚发生的事不被过早折叠。',
        kind: 'number',
        min: 1,
        max: 200,
        step: 1,
      },
    ],
  },
  {
    id: 'story',
    title: '正文记忆投喂',
    description: '控制主线正文回放和近期剧情摘要进入 prompt 的数量。',
    controls: [
      {
        field: 'recentRawTurnLimit',
        label: '近期正文回放回合数',
        description: '每回合直接投喂最近多少条原始正文，数值越大越连贯，也越吃 token。',
        kind: 'number',
        min: 0,
        max: 20,
        step: 1,
      },
      {
        field: 'recentTurnLimit',
        label: '近期剧情摘要保留上限',
        description: '本地近期摘要保留上限；超过后依靠压缩摘要承接更早剧情。',
        kind: 'number',
        min: 1,
        max: 200,
        step: 1,
      },
    ],
  },
  {
    id: 'npc',
    title: 'NPC 记忆投喂',
    description: '控制近期投喂与三层压缩；NPC 长期记忆全部投喂，中期按重要度选取。',
    controls: [
      {
        field: 'npcRecentMemoryDefaultLimit',
        label: '在场普通 NPC 记忆条数',
        description: '普通在场 NPC 默认投喂的个人记忆数量。',
        kind: 'number',
        min: 0,
        max: 20,
        step: 1,
      },
      {
        field: 'npcRecentMemoryImportantLimit',
        label: '在场重要 NPC 记忆条数',
        description: '被标记重要或关注的在场 NPC 可投喂更多个人记忆。',
        kind: 'number',
        min: 0,
        max: 50,
        step: 1,
      },
      {
        field: 'focusedNpcRecentMemoryLimit',
        label: '离场关注 NPC 记忆条数',
        description: '不在场但仍被关注的 NPC 默认投喂的个人记忆数量。',
        kind: 'number',
        min: 0,
        max: 20,
        step: 1,
      },
      {
        field: 'npcMemoryCompressThreshold',
        label: 'NPC 原始记忆压缩批量',
        description: '每名 NPC 累计多少条未压缩原始记忆后生成一条中期记忆，推荐 20。',
        kind: 'number',
        min: 5,
        max: 100,
        step: 1,
      },
      {
        field: 'npcMemoryKeepAfterCompress',
        label: 'NPC 原始记忆本地保留',
        description: '压缩成功后仍在本地保留的最新原始记忆上限，推荐 40。',
        kind: 'number',
        min: 10,
        max: 200,
        step: 1,
      },
    ],
  },
  {
    id: 'layers',
    title: '分层摘要与检索',
    description: '控制中期、长期和检索增强层进入 prompt 的数量。',
    controls: [
      {
        field: 'midTermSummaryLimit',
        label: '中期摘要投喂条数',
        description: '当前地点或相关 NPC 命中的中期剧情摘要最多投喂多少条。',
        kind: 'number',
        min: 0,
        max: 50,
        step: 1,
      },
      {
        field: 'longTermFactLimit',
        label: '长期事实投喂条数',
        description: '当前相关长期事实最多投喂多少条。',
        kind: 'number',
        min: 0,
        max: 100,
        step: 1,
      },
      {
        field: 'vectorResultLimit',
        label: '检索记忆投喂条数',
        description: '语义向量或本地关键词检索最多补入多少条旧记忆。',
        kind: 'number',
        min: 0,
        max: 50,
        step: 1,
      },
    ],
  },
  {
    id: 'budget',
    title: 'Token 预算',
    description: '控制记忆上下文总体预算与各层分配；超出总预算时会按比例缩放。',
    controls: [
      {
        field: 'maxPromptMemoryTokens',
        label: '最大记忆投喂 Token',
        description: '记忆上下文包的总预算上限。',
        kind: 'number',
        min: 1000,
        max: 200000,
        step: 1000,
      },
      {
        field: 'recentStoryTokenBudget',
        label: '正文/近期摘要预算',
        description: '近期正文回放与近期剧情摘要共用预算。',
        kind: 'number',
        min: 0,
        max: 200000,
        step: 1000,
      },
      {
        field: 'npcMemoryTokenBudget',
        label: 'NPC 记忆预算',
        description: 'NPC 长期互动摘要与个人记忆共用预算。',
        kind: 'number',
        min: 0,
        max: 200000,
        step: 1000,
      },
      {
        field: 'midTermTokenBudget',
        label: '中期摘要预算',
        description: '中期剧情摘要预算。',
        kind: 'number',
        min: 0,
        max: 200000,
        step: 1000,
      },
      {
        field: 'longTermFactTokenBudget',
        label: '长期事实预算',
        description: '长期档案事实预算。',
        kind: 'number',
        min: 0,
        max: 200000,
        step: 1000,
      },
      {
        field: 'locationMemoryTokenBudget',
        label: '地点记忆预算',
        description: '地点记忆摘要预算。',
        kind: 'number',
        min: 0,
        max: 200000,
        step: 1000,
      },
      {
        field: 'retrievalTokenBudget',
        label: '检索增强预算',
        description: '向量检索或本地检索补入记忆的预算。',
        kind: 'number',
        min: 0,
        max: 200000,
        step: 1000,
      },
    ],
  },
];

const effectiveControlByField = new Map(
  effectiveMemorySettingSections.flatMap((section) => section.controls.map((control) => [control.field, control] as const)),
);

export function getEffectiveMemorySettingControls(): MemorySettingControl[] {
  return effectiveMemorySettingSections.flatMap((section) => section.controls);
}

export function buildMemorySettingsPanelModel(runtimeState?: RuntimeState | null): MemorySettingsPanelModel {
  if (!runtimeState) {
    return {
      available: false,
      emptyReason: '进入存档后可调整该存档的记忆压缩、投喂层数与 token 预算。',
      settings: null,
      archiveStats: emptyArchiveStats(),
      sections: effectiveMemorySettingSections,
    };
  }

  const normalized = ensureLuanShiState(runtimeState);
  const archive = normalized.memoryArchive;

  return {
    available: true,
    settings: archive.settings,
    archiveStats: {
      recentTurnSummaries: archive.recentTurnSummaries.length,
      midTermSummaries: archive.midTermSummaries.length,
      longTermStorySummaries: archive.longTermStorySummaries.length,
      longTermFacts: archive.longTermFacts.length,
      npcInteractionSummaries: archive.npcInteractionSummaries.length,
      npcMidTermSummaries: archive.npcMidTermSummaries.length,
      npcLongTermSummaries: archive.npcLongTermSummaries.length,
      locationMemorySummaries: archive.locationMemorySummaries.length,
    },
    sections: effectiveMemorySettingSections,
  };
}

export function applyMemorySettingsPatch(
  runtimeState: RuntimeState,
  patch: Partial<MemoryProjectionSettings>,
): NormalizedLuanShiState {
  const normalized = ensureLuanShiState(runtimeState);
  const settings = normalizeMemoryProjectionSettings({
    ...normalized.memoryArchive.settings,
    ...patch,
  });

  return {
    ...normalized,
    memoryArchive: {
      schemaVersion: 2,
      recentTurnSummaries: [...normalized.memoryArchive.recentTurnSummaries],
      midTermSummaries: [...normalized.memoryArchive.midTermSummaries],
      longTermStorySummaries: [...normalized.memoryArchive.longTermStorySummaries],
      longTermFacts: [...normalized.memoryArchive.longTermFacts],
      npcInteractionSummaries: [...normalized.memoryArchive.npcInteractionSummaries],
      npcMidTermSummaries: [...normalized.memoryArchive.npcMidTermSummaries],
      npcLongTermSummaries: [...normalized.memoryArchive.npcLongTermSummaries],
      locationMemorySummaries: [...normalized.memoryArchive.locationMemorySummaries],
      settings,
    },
  };
}

export function normalizeMemoryProjectionSettings(settings: MemoryProjectionSettings): MemoryProjectionSettings {
  const normalized: MemoryProjectionSettings = { ...settings };

  for (const control of effectiveControlByField.values()) {
    const value = normalized[control.field];
    if (control.kind === 'boolean') {
      normalized[control.field] = Boolean(value) as never;
      continue;
    }

    const rawNumber = Number(value);
    const min = control.min ?? 0;
    const max = control.max ?? Number.MAX_SAFE_INTEGER;
    const nextNumber = Number.isFinite(rawNumber) ? Math.trunc(rawNumber) : min;
    normalized[control.field] = Math.max(min, Math.min(max, nextNumber)) as never;
  }

  normalized.recentTurnKeepAfterCompress = Math.min(
    normalized.recentTurnKeepAfterCompress,
    normalized.recentTurnCompressThreshold,
    normalized.recentTurnLimit,
  );

  return normalized;
}

function emptyArchiveStats(): MemoryArchiveStats {
  return {
    recentTurnSummaries: 0,
    midTermSummaries: 0,
    longTermStorySummaries: 0,
    longTermFacts: 0,
    npcInteractionSummaries: 0,
    npcMidTermSummaries: 0,
    npcLongTermSummaries: 0,
    locationMemorySummaries: 0,
  };
}
