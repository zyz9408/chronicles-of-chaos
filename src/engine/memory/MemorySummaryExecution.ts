import {
  BrowserLlmClient,
  type LlmClient,
  type LlmMessage,
  type LlmTimeoutErrorFactory,
  type LlmTokenUsage,
} from '../llm/LlmClient';
import { resolvePromptContent, resolvePromptTemplate } from '../prompts/PromptResolver';
import {
  resolveApiConfigForTaskAsync,
  resolveExplicitApiConfigForTaskAsync,
  type ApiConfigArchive,
} from '../settings/ApiConfigManager';
import type {
  LocationMemorySummary,
  LongTermStoryMemorySummary,
  LongTermMemoryFact,
  MemoryImportance,
  MidTermMemorySummary,
  NpcInteractionSummary,
  NpcLongTermMemorySummary,
  NpcMidTermMemorySummary,
  RuntimeState,
} from '../types';
import {
  applyMemorySummaryResult,
  buildRecentTurnMemorySummaryTask,
  type MemorySummaryCompressionScope,
  type MemorySummaryResult,
  type MemorySummaryTaskInput,
} from './MemorySummaryProjection';

export type MemorySummaryExecutionStatus = 'applied' | 'skipped' | 'failed';

export interface MemorySummaryExecutionOptions {
  apiConfig?: ApiConfigArchive | null;
  llmClient?: LlmClient;
  signal?: AbortSignal;
  timeoutMs?: number;
  timeoutErrorFactory?: LlmTimeoutErrorFactory;
}

export interface MemorySummaryExecutionResult {
  status: MemorySummaryExecutionStatus;
  reason?: string;
  newState: RuntimeState;
  appliedSummaries: string[];
  ignoredSummaries: string[];
  sourceRecentTurnCount: number;
  keptRecentTurnCount: number;
  activeScopes?: MemorySummaryCompressionScope[];
  apiTaskId?: 'memorySummary' | 'mainNarrative';
  provider?: string;
  model?: string;
  usage?: LlmTokenUsage;
  rawContent?: string;
  /** 仅用于把后台生成结果安全重放到更新后的同一存档状态，不进入持久化。 */
  task?: MemorySummaryTaskInput;
  summaryResult?: MemorySummaryResult;
}

export type ConfiguredMemorySummaryExecutionOptions = Omit<MemorySummaryExecutionOptions, 'apiConfig'>;

export async function executeMemorySummaryCompressionWithConfiguredApi(
  state: RuntimeState,
  options: ConfiguredMemorySummaryExecutionOptions = {},
): Promise<MemorySummaryExecutionResult> {
  const configured = await getConfiguredMemorySummaryApiConfig(state);
  return executeMemorySummaryCompression(state, {
    ...options,
    apiConfig: configured.config,
  }, configured.apiTaskId);
}

export async function getConfiguredMemorySummaryApiConfig(state?: RuntimeState): Promise<{
  config: ApiConfigArchive | null;
  apiTaskId?: 'memorySummary' | 'mainNarrative';
}> {
  const preferDedicatedMemorySummaryApi = state?.memoryArchive?.settings.preferDedicatedMemorySummaryApi ?? true;

  if (preferDedicatedMemorySummaryApi) {
    const memoryConfig = await resolveExplicitApiConfigForTaskAsync('memorySummary');
    if (memoryConfig) return { config: memoryConfig, apiTaskId: 'memorySummary' };
  }

  const fallback = await resolveApiConfigForTaskAsync(
    preferDedicatedMemorySummaryApi ? 'memorySummary' : 'mainNarrative',
  );
  if (!fallback) return { config: null };
  return { config: fallback, apiTaskId: 'mainNarrative' };
}

export async function executeMemorySummaryCompression(
  state: RuntimeState,
  options: MemorySummaryExecutionOptions = {},
  apiTaskId?: 'memorySummary' | 'mainNarrative',
): Promise<MemorySummaryExecutionResult> {
  const task = buildRecentTurnMemorySummaryTask(state);
  if (task.activeScopes.length === 0) {
    return {
      status: 'skipped',
      reason: 'threshold not reached',
      newState: state,
      appliedSummaries: [],
      ignoredSummaries: [],
      sourceRecentTurnCount: 0,
      keptRecentTurnCount: 0,
      activeScopes: [],
      apiTaskId,
    };
  }

  if (!options.apiConfig) {
    return {
      status: 'skipped',
      reason: 'memory summary api not configured',
      newState: state,
      appliedSummaries: [],
      ignoredSummaries: [],
      sourceRecentTurnCount: 0,
      keptRecentTurnCount: 0,
      activeScopes: task.activeScopes,
      apiTaskId,
    };
  }

  const llmClient = options.llmClient ?? new BrowserLlmClient();
  const result = await llmClient.generate({
    config: options.apiConfig,
    messages: buildMemorySummaryCompressionMessages(task),
    temperature: 0,
    maxOutputTokens: options.apiConfig.maxOutputTokens,
    responseFormat: 'json_object',
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    timeoutErrorFactory: options.timeoutErrorFactory,
  });
  const parsed = parseMemorySummaryResult(result.content, task.createdAt);
  return reapplyMemorySummaryExecutionResult(state, {
    status: 'applied',
    newState: state,
    appliedSummaries: [],
    ignoredSummaries: [],
    sourceRecentTurnCount: task.sourceRecentTurnSummaries.length,
    keptRecentTurnCount: task.keptRecentTurnIds.length,
    activeScopes: task.activeScopes,
    apiTaskId,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
    rawContent: result.content,
    task,
    summaryResult: parsed,
  });
}

/**
 * 将已完成的摘要生成结果应用到当前最新状态。
 * 只消费原任务中的稳定来源 ID，因此后台请求期间新增的回合和 NPC 记忆会保留。
 */
export function reapplyMemorySummaryExecutionResult(
  state: RuntimeState,
  result: MemorySummaryExecutionResult,
): MemorySummaryExecutionResult {
  if (!result.task || !result.summaryResult) {
    return { ...result, newState: state };
  }

  const application = applyMemorySummaryResult(state, result.summaryResult, result.task);
  const nextState = application.state;

  if (application.appliedStoryRecentCompression && nextState.memoryArchive) {
    const keptIds = new Set(result.task.keptRecentTurnIds);
    const compressedIds = new Set(
      result.task.sourceRecentTurnSummaries.map((summary) => summary.id),
    );
    nextState.memoryArchive.recentTurnSummaries = nextState.memoryArchive.recentTurnSummaries
      .filter((summary) => !compressedIds.has(summary.id) || keptIds.has(summary.id));
  }

  return {
    ...result,
    status: application.appliedSummaries.length > 0 ? 'applied' : 'skipped',
    reason: application.appliedSummaries.length > 0
      ? undefined
      : 'summary result had no valid entries',
    newState: nextState,
    appliedSummaries: application.appliedSummaries,
    ignoredSummaries: application.ignoredSummaries,
  };
}

export function appendMemorySummaryExecutionSummary(
  state: RuntimeState,
  result: MemorySummaryExecutionResult,
): void {
  const latestLog = state.turnLog[state.turnLog.length - 1];
  if (!latestLog || result.status === 'skipped') return;

  const routeLabel = result.apiTaskId ? `[${result.apiTaskId}]` : '';
  const sourceLabel = buildMemorySummarySourceLabel(result.task);
  const suffix = result.status === 'applied'
    ? `memorySummary${routeLabel}：${result.appliedSummaries.join('、')}；${sourceLabel}`
    : `memorySummary${routeLabel}失败：${result.reason ?? '未知原因'}`;

  latestLog.statePatchSummary = [
    latestLog.statePatchSummary,
    suffix,
  ].join('；');
}

export function buildMemorySummaryCompressionMessages(task: MemorySummaryTaskInput): LlmMessage[] {
  const sourceTurnContext = buildSourceTurnCompressionContext(task);
  const outputShape: Record<string, unknown> = {};
  if (task.activeScopes.includes('playerRecentToMid')) {
    outputShape.midTermSummaries = [
      {
        summaryId: 'stable_id',
        title: '阶段标题',
        fromCreatedAt: '起始时间',
        toCreatedAt: '结束时间',
        summary: '阶段摘要',
        relatedNpcIds: ['npc_id'],
        relatedLocationIds: ['location_id'],
        tags: ['tag'],
        sourceRecentTurnIds: ['recent_turn_id'],
        updatedAt: task.createdAt,
      },
    ];
    outputShape.longTermFacts = [
      {
        factId: 'stable_id',
        category: 'identity/promise/enmity/relationship/world/location/consequence/other',
        createdAt: '发生时间',
        updatedAt: task.createdAt,
        summary: '长期事实',
        importance: 'low/medium/high/critical',
        relatedNpcIds: ['npc_id'],
        relatedLocationIds: ['location_id'],
        sourceTurnNumbers: [1],
        tags: ['tag'],
      },
    ];
    outputShape.npcInteractionSummaries = [
      {
        npcId: 'npc_id',
        npcName: 'NPC名称',
        summary: '该 NPC 与主角的长期互动摘要',
        fromCreatedAt: '起始时间',
        toCreatedAt: '结束时间',
        sourceMemoryIds: ['memory_id'],
        tags: ['tag'],
        updatedAt: task.createdAt,
      },
    ];
    outputShape.locationMemorySummaries = [
      {
        locationId: 'location_id',
        locationName: '地点名',
        summary: '地点长期记忆摘要',
        recentEventIds: ['event_id'],
        tags: ['tag'],
        updatedAt: task.createdAt,
      },
    ];
  }
  if (task.activeScopes.includes('playerMidToLong')) {
    outputShape.longTermStorySummaries = [
      {
        summaryId: 'stable_long_story_id',
        title: '长期阶段标题',
        fromCreatedAt: '起始时间',
        toCreatedAt: '结束时间',
        summary: '由十条中期摘要压缩成的长期生平摘要',
        sourceMidTermSummaryIds: ['mid_term_summary_id'],
        relatedNpcIds: ['npc_id'],
        relatedLocationIds: ['location_id'],
        tags: ['tag'],
        updatedAt: task.createdAt,
      },
    ];
    outputShape.longTermFacts ??= [
      {
        factId: 'stable_id',
        category: 'identity/promise/enmity/relationship/world/location/consequence/other',
        createdAt: '发生时间',
        updatedAt: task.createdAt,
        summary: '长期事实',
        importance: 'low/medium/high/critical',
        relatedNpcIds: ['npc_id'],
        relatedLocationIds: ['location_id'],
        sourceTurnNumbers: [1],
        tags: ['tag'],
      },
    ];
  }
  if (task.activeScopes.includes('npcRawToMid')) {
    outputShape.npcMidTermSummaries = [
      {
        summaryId: 'stable_npc_mid_id',
        npcId: 'npc_id',
        npcName: 'NPC名称',
        summary: '由该 NPC 二十条原始记忆压缩成的中期记忆',
        fromCreatedAt: '起始时间',
        toCreatedAt: '结束时间',
        sourceMemoryIds: ['memory_id'],
        tags: ['tag'],
        updatedAt: task.createdAt,
      },
    ];
    outputShape.npcInteractionSummaries ??= [
      {
        npcId: 'npc_id',
        npcName: 'NPC名称',
        summary: '该 NPC 与主角的长期互动摘要',
        fromCreatedAt: '起始时间',
        toCreatedAt: '结束时间',
        sourceMemoryIds: ['memory_id'],
        tags: ['tag'],
        updatedAt: task.createdAt,
      },
    ];
  }
  if (task.activeScopes.includes('npcMidToLong')) {
    outputShape.npcLongTermSummaries = [
      {
        summaryId: 'stable_npc_long_id',
        npcId: 'npc_id',
        npcName: 'NPC名称',
        summary: '由该 NPC 十条中期记忆压缩成的长期记忆',
        fromCreatedAt: '起始时间',
        toCreatedAt: '结束时间',
        sourceMidTermSummaryIds: ['npc_mid_term_summary_id'],
        tags: ['tag'],
        updatedAt: task.createdAt,
      },
    ];
  }
  outputShape.notes = ['可选调试说明'];
  const outputJsonSchema = JSON.stringify(outputShape, null, 2);
  const compressionRules = [
    '- 保留因果、承诺、未完成目标、地点变化、NPC关系变化、重要物品线索、不可逆后果。',
    '- 已完成、失败、失效或归档的承诺/事项必须保留其终态与结果；不得重新压缩成待办、尚未交付或仍需履行。',
    '- 普通闲聊不要进入长期事实。',
    '- sourceRecentTurnIds、sourceMemoryIds、sourceMidTermSummaryIds 与摘要稳定 ID 最终由本地引擎按实际批次覆盖；不要拆分同一批次或为同一主体返回多条摘要。',
    '- NPC 记忆必须保留亲历、听闻、误会、推测等信息来源与置信边界；不得把听闻改写为亲历，不得把误会或推测改写为确定事实，NPC 相信的内容不得自动写成世界客观事实。',
    ...(task.activeScopes.includes('playerRecentToMid') ? [
      '- 中期摘要用于替代这一批连续短期记忆，应该有明确时间范围；只能生成一条玩家中期摘要。',
      '- 长期事实只写后续游玩仍然重要的稳定事实；已有事实发生演进时必须复用 factId，不得更换 ID 新增同义事实。',
      '- NPC互动摘要只写本批次涉及 NPC 与主角/当前事件的可承接关系史。',
      '- 地点记忆摘要只写本批次涉及地点后续相关时应想起的变化或线索。',
    ] : []),
    ...(task.activeScopes.includes('playerMidToLong') ? [
      '- 十条玩家中期摘要只能生成一条长期剧情摘要，必须保留承诺、因果、关系与未完成线索。',
      '- 长期事实只写后续游玩仍然重要的稳定事实；已有事实发生演进时必须复用 factId。',
    ] : []),
    ...(task.activeScopes.includes('npcRawToMid') ? [
      '- 每个 NPC 原始记忆块只能生成一条 NPC 中期记忆；不得处理未提供的 NPC。',
    ] : []),
    ...(task.activeScopes.includes('npcMidToLong') ? [
      '- 每个 NPC 的十条中期记忆只能生成一条 NPC 长期记忆；不得处理未提供的 NPC。',
    ] : []),
    '- 只输出本任务 JSON 结构列出的数组；没有列出的层级本次未达阈值，禁止生成。',
  ].join('\n');
  const defaultSystemPrompt = [
    '你是乱世风云录 V2 的记忆压缩器。',
    '只返回 JSON 对象，不要输出 Markdown、解释、标签或正文叙事。',
    `本次只整理已达到本地阈值的队列：${task.activeScopes.join(', ')}。`,
    '不要发明没有来源的新事实；不确定的内容宁可不写。',
    '不要删除或改写本地原始回合正文；本地会完整保留 turnLog，你只负责生成分层摘要。',
  ].join('\n');
  const activeInputSections = [
    ...(task.activeScopes.includes('playerRecentToMid') ? [
      '### 待压缩玩家短期回合',
      JSON.stringify(task.sourceRecentTurnSummaries, null, 2),
      '',
      '### 对应回合正文原文',
      JSON.stringify(sourceTurnContext, null, 2),
      '',
      '### 相关既有玩家中期摘要',
      JSON.stringify(task.existingMidTermSummaries, null, 2),
      '',
      '### 相关既有长期事实',
      JSON.stringify(task.existingLongTermFacts, null, 2),
      '',
      '### 相关既有 NPC 互动摘要',
      JSON.stringify(task.existingNpcInteractionSummaries, null, 2),
      '',
      '### 相关既有地点摘要',
      JSON.stringify(task.existingLocationMemorySummaries, null, 2),
    ] : []),
    ...(task.activeScopes.includes('playerMidToLong') ? [
      '### 待压缩玩家中期摘要',
      JSON.stringify(task.sourceMidTermSummaries, null, 2),
      '',
      '### 既有长期剧情摘要',
      JSON.stringify(task.existingLongTermStorySummaries, null, 2),
      '',
      '### 相关既有长期事实',
      JSON.stringify(task.existingLongTermFacts, null, 2),
    ] : []),
    ...(task.activeScopes.includes('npcRawToMid') ? [
      '### 待压缩 NPC 原始记忆块',
      JSON.stringify(task.relatedNpcMemoryBlocks, null, 2),
      '',
      '### 相关既有 NPC 中长期记忆',
      JSON.stringify({
        midTerm: task.existingNpcMidTermSummaries,
        longTerm: task.existingNpcLongTermSummaries,
      }, null, 2),
    ] : []),
    ...(task.activeScopes.includes('npcMidToLong') ? [
      '### 待压缩 NPC 中期记忆块',
      JSON.stringify(task.sourceNpcMidTermBlocks, null, 2),
      '',
      '### 相关既有 NPC 长期记忆',
      JSON.stringify(task.existingNpcLongTermSummaries, null, 2),
    ] : []),
  ];
  const defaultUserPrompt = [
    '## 任务',
    `只整理这些已达到阈值的队列：${task.activeScopes.join(', ')}`,
    '',
    '## 输出 JSON 结构',
    outputJsonSchema,
    '',
    '## 压缩原则',
    compressionRules,
    '',
    '## 近期记忆压缩输入',
    `createdAt: ${task.createdAt}`,
    `currentLocationId: ${task.currentLocationId}`,
    `sourceRecentTurnCount: ${task.sourceRecentTurnSummaries.length}`,
    `keptRecentTurnIds: ${task.keptRecentTurnIds.join(', ')}`,
    `tokenBudgetHint: ${JSON.stringify(task.tokenBudgetHint)}`,
    '',
    ...activeInputSections,
  ].join('\n');
  const userTemplateValues = {
    createdAt: task.createdAt,
    currentLocationId: task.currentLocationId,
    sourceRecentTurnSummaries: JSON.stringify(task.sourceRecentTurnSummaries, null, 2),
    sourceTurnLogs: JSON.stringify(sourceTurnContext, null, 2),
    sourceMidTermSummaries: JSON.stringify(task.sourceMidTermSummaries, null, 2),
    relatedNpcMemoryBlocks: JSON.stringify(task.relatedNpcMemoryBlocks, null, 2),
    sourceNpcMidTermBlocks: JSON.stringify(task.sourceNpcMidTermBlocks, null, 2),
    existingMidTermSummaries: JSON.stringify(task.existingMidTermSummaries, null, 2),
    existingLongTermStorySummaries: JSON.stringify(task.existingLongTermStorySummaries, null, 2),
    existingLongTermFacts: JSON.stringify(task.existingLongTermFacts, null, 2),
    existingNpcInteractionSummaries: JSON.stringify(task.existingNpcInteractionSummaries, null, 2),
    existingNpcMidTermSummaries: JSON.stringify(task.existingNpcMidTermSummaries, null, 2),
    existingNpcLongTermSummaries: JSON.stringify(task.existingNpcLongTermSummaries, null, 2),
    existingLocationMemorySummaries: JSON.stringify(task.existingLocationMemorySummaries, null, 2),
    outputJsonSchema,
    compressionRules,
  };

  return [
    {
      role: 'system',
      content: resolvePromptContent('memory.summaryCompressionSystemPrompt', defaultSystemPrompt),
    },
    {
      role: 'user',
      content: [
        resolvePromptTemplate('memory.summaryCompressionUserPrompt', defaultUserPrompt, userTemplateValues),
        '',
        '## P1 分层压缩强制输入（即使自定义模板较旧也必须处理）',
        `activeCompressionScopes: ${JSON.stringify(task.activeScopes)}`,
        '- 只有 activeCompressionScopes 列出的队列达到阈值；禁止生成其他层级。',
        `playerRecentBatchQualified: ${task.activeScopes.includes('playerRecentToMid')}`,
        `playerRecentBatchThreshold: ${task.recentTurnCompressThreshold}`,
        `playerMidBatchQualified: ${task.activeScopes.includes('playerMidToLong')}`,
        '- playerRecentBatchQualified=false 时 midTermSummaries=[]；playerRecentBatchQualified=false 且 playerMidBatchQualified=false 时 longTermFacts=[]。',
        '- 每个合格玩家批次只返回一条摘要；每个 npcRawMemoryBlocks/npcMidTermBlocks 主体只返回一条摘要。',
        '- 来源 ID 和稳定摘要 ID 由本地覆盖，不得把一个批次拆成多条摘要。',
        '- 已完成、失败、失效或归档的承诺/事项必须保留其终态与结果；不得重新压缩成待办、尚未交付或仍需履行。',
        `sourceRecentTurnIds: ${JSON.stringify(task.sourceRecentTurnSummaries.map((item) => item.id))}`,
        `sourceMidTermSummaryIds: ${JSON.stringify(task.sourceMidTermSummaries.map((item) => item.summaryId))}`,
        `npcRawMemoryBlockIds: ${JSON.stringify(task.relatedNpcMemoryBlocks.map((block) => ({
          npcId: block.npcId,
          sourceMemoryIds: block.memories.map((memory) => memory.memoryId),
        })))}`,
        `npcMidTermBlockIds: ${JSON.stringify(task.sourceNpcMidTermBlocks.map((block) => ({
          npcId: block.npcId,
          sourceMidTermSummaryIds: block.summaries.map((summary) => summary.summaryId),
        })))}`,
      ].join('\n'),
    },
  ];
}

function buildSourceTurnCompressionContext(task: MemorySummaryTaskInput): Array<Record<string, unknown>> {
  return task.sourceTurnLogs.map((turn) => ({
    turnNumber: turn.turnNumber,
    date: turn.date,
    playerInput: turn.playerInput,
    narrativeText: turn.fullNarrativeText || turn.narrativeText,
    statePatchSummary: turn.statePatchSummary,
  }));
}

function buildMemorySummarySourceLabel(task?: MemorySummaryTaskInput): string {
  if (!task) return '已整理达到阈值的记忆队列';
  const labels = [
    ...(task.activeScopes.includes('playerRecentToMid')
      ? [`玩家短期${task.sourceRecentTurnSummaries.length}条`]
      : []),
    ...(task.activeScopes.includes('playerMidToLong')
      ? [`玩家中期${task.sourceMidTermSummaries.length}条`]
      : []),
    ...(task.activeScopes.includes('npcRawToMid')
      ? [`NPC原始记忆${task.relatedNpcMemoryBlocks.reduce((sum, block) => sum + block.memories.length, 0)}条`]
      : []),
    ...(task.activeScopes.includes('npcMidToLong')
      ? [`NPC中期记忆${task.sourceNpcMidTermBlocks.reduce((sum, block) => sum + block.summaries.length, 0)}条`]
      : []),
  ];
  return `仅整理达到阈值队列（${labels.join('、')}）`;
}

export function parseMemorySummaryResult(content: string, fallbackUpdatedAt: string): MemorySummaryResult {
  const parsed = parseJsonObject(content);
  if (!parsed) return {};

  return {
    midTermSummaries: parseArray(parsed.midTermSummaries, (item) => parseMidTermSummary(item, fallbackUpdatedAt)),
    longTermStorySummaries: parseArray(
      parsed.longTermStorySummaries,
      (item) => parseLongTermStorySummary(item, fallbackUpdatedAt),
    ),
    longTermFacts: parseArray(parsed.longTermFacts, (item) => parseLongTermFact(item, fallbackUpdatedAt)),
    npcInteractionSummaries: parseArray(parsed.npcInteractionSummaries, (item) => parseNpcInteractionSummary(item, fallbackUpdatedAt)),
    npcMidTermSummaries: parseArray(
      parsed.npcMidTermSummaries,
      (item) => parseNpcMidTermSummary(item, fallbackUpdatedAt),
    ),
    npcLongTermSummaries: parseArray(
      parsed.npcLongTermSummaries,
      (item) => parseNpcLongTermSummary(item, fallbackUpdatedAt),
    ),
    locationMemorySummaries: parseArray(parsed.locationMemorySummaries, (item) => parseLocationMemorySummary(item, fallbackUpdatedAt)),
    notes: parseStringArray(parsed.notes),
  };
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace
    ? candidate.slice(firstBrace, lastBrace + 1)
    : candidate;

  try {
    const value = JSON.parse(jsonText) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function parseMidTermSummary(value: unknown, fallbackUpdatedAt: string): MidTermMemorySummary | null {
  if (
    !isRecord(value)
    || typeof value.summaryId !== 'string'
    || typeof value.title !== 'string'
    || typeof value.fromCreatedAt !== 'string'
    || typeof value.toCreatedAt !== 'string'
    || typeof value.summary !== 'string'
  ) {
    return null;
  }

  return {
    summaryId: value.summaryId,
    title: value.title,
    fromCreatedAt: value.fromCreatedAt,
    toCreatedAt: value.toCreatedAt,
    summary: value.summary,
    relatedNpcIds: parseOptionalStringArray(value.relatedNpcIds),
    relatedLocationIds: parseOptionalStringArray(value.relatedLocationIds),
    tags: parseOptionalStringArray(value.tags),
    sourceRecentTurnIds: parseOptionalStringArray(value.sourceRecentTurnIds),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : fallbackUpdatedAt,
  };
}

function parseLongTermStorySummary(
  value: unknown,
  fallbackUpdatedAt: string,
): LongTermStoryMemorySummary | null {
  if (
    !isRecord(value)
    || typeof value.summaryId !== 'string'
    || typeof value.title !== 'string'
    || typeof value.fromCreatedAt !== 'string'
    || typeof value.toCreatedAt !== 'string'
    || typeof value.summary !== 'string'
  ) return null;

  return {
    summaryId: value.summaryId,
    title: value.title,
    fromCreatedAt: value.fromCreatedAt,
    toCreatedAt: value.toCreatedAt,
    summary: value.summary,
    sourceMidTermSummaryIds: parseStringArray(value.sourceMidTermSummaryIds) ?? [],
    relatedNpcIds: parseOptionalStringArray(value.relatedNpcIds),
    relatedLocationIds: parseOptionalStringArray(value.relatedLocationIds),
    tags: parseOptionalStringArray(value.tags),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : fallbackUpdatedAt,
  };
}

function parseLongTermFact(value: unknown, fallbackUpdatedAt: string): LongTermMemoryFact | null {
  if (
    !isRecord(value)
    || typeof value.factId !== 'string'
    || typeof value.createdAt !== 'string'
    || typeof value.summary !== 'string'
  ) {
    return null;
  }

  return {
    factId: value.factId,
    category: parseLongTermFactCategory(value.category),
    createdAt: value.createdAt,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : fallbackUpdatedAt,
    summary: value.summary,
    importance: parseMemoryImportance(value.importance),
    relatedNpcIds: parseOptionalStringArray(value.relatedNpcIds),
    relatedLocationIds: parseOptionalStringArray(value.relatedLocationIds),
    sourceTurnNumbers: parseOptionalNumberArray(value.sourceTurnNumbers),
    tags: parseOptionalStringArray(value.tags),
  };
}

function parseNpcInteractionSummary(value: unknown, fallbackUpdatedAt: string): NpcInteractionSummary | null {
  if (
    !isRecord(value)
    || typeof value.npcId !== 'string'
    || typeof value.npcName !== 'string'
    || typeof value.summary !== 'string'
  ) {
    return null;
  }

  return {
    npcId: value.npcId,
    npcName: value.npcName,
    summary: value.summary,
    fromCreatedAt: typeof value.fromCreatedAt === 'string' ? value.fromCreatedAt : undefined,
    toCreatedAt: typeof value.toCreatedAt === 'string' ? value.toCreatedAt : undefined,
    sourceMemoryIds: parseOptionalStringArray(value.sourceMemoryIds),
    tags: parseOptionalStringArray(value.tags),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : fallbackUpdatedAt,
  };
}

function parseNpcMidTermSummary(value: unknown, fallbackUpdatedAt: string): NpcMidTermMemorySummary | null {
  if (
    !isRecord(value)
    || typeof value.summaryId !== 'string'
    || typeof value.npcId !== 'string'
    || typeof value.npcName !== 'string'
    || typeof value.summary !== 'string'
    || typeof value.fromCreatedAt !== 'string'
    || typeof value.toCreatedAt !== 'string'
  ) return null;

  return {
    summaryId: value.summaryId,
    npcId: value.npcId,
    npcName: value.npcName,
    summary: value.summary,
    fromCreatedAt: value.fromCreatedAt,
    toCreatedAt: value.toCreatedAt,
    sourceMemoryIds: parseStringArray(value.sourceMemoryIds) ?? [],
    tags: parseOptionalStringArray(value.tags),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : fallbackUpdatedAt,
  };
}

function parseNpcLongTermSummary(value: unknown, fallbackUpdatedAt: string): NpcLongTermMemorySummary | null {
  if (
    !isRecord(value)
    || typeof value.summaryId !== 'string'
    || typeof value.npcId !== 'string'
    || typeof value.npcName !== 'string'
    || typeof value.summary !== 'string'
    || typeof value.fromCreatedAt !== 'string'
    || typeof value.toCreatedAt !== 'string'
  ) return null;

  return {
    summaryId: value.summaryId,
    npcId: value.npcId,
    npcName: value.npcName,
    summary: value.summary,
    fromCreatedAt: value.fromCreatedAt,
    toCreatedAt: value.toCreatedAt,
    sourceMidTermSummaryIds: parseStringArray(value.sourceMidTermSummaryIds) ?? [],
    tags: parseOptionalStringArray(value.tags),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : fallbackUpdatedAt,
  };
}

function parseLocationMemorySummary(value: unknown, fallbackUpdatedAt: string): LocationMemorySummary | null {
  if (!isRecord(value) || typeof value.locationId !== 'string' || typeof value.summary !== 'string') {
    return null;
  }

  return {
    locationId: value.locationId,
    locationName: typeof value.locationName === 'string' ? value.locationName : undefined,
    summary: value.summary,
    recentEventIds: parseOptionalStringArray(value.recentEventIds),
    tags: parseOptionalStringArray(value.tags),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : fallbackUpdatedAt,
  };
}

function parseArray<T>(value: unknown, parser: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(parser).filter((item): item is T => item !== null);
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

function parseOptionalStringArray(value: unknown): string[] | undefined {
  const parsed = parseStringArray(value);
  return parsed && parsed.length > 0 ? parsed : undefined;
}

function parseOptionalNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  return parsed.length > 0 ? parsed : undefined;
}

function parseLongTermFactCategory(value: unknown): LongTermMemoryFact['category'] {
  if (
    value === 'identity'
    || value === 'promise'
    || value === 'enmity'
    || value === 'relationship'
    || value === 'world'
    || value === 'location'
    || value === 'consequence'
    || value === 'other'
  ) {
    return value;
  }
  return 'other';
}

function parseMemoryImportance(value: unknown): MemoryImportance {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'critical') {
    return value;
  }
  return 'medium';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
