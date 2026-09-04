import {
  BrowserLlmClient,
  type LlmClient,
  type LlmMessage,
  type LlmTimeoutErrorFactory,
  type LlmTokenUsage,
} from '../llm/LlmClient';
import {
  resolveExplicitApiConfigForTaskAsync,
  type ApiConfigArchive,
} from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { deriveNpcCurrentAge } from '../time/npcAge';
import { filterProtagonistNpcClones } from '../state/playerNpcBoundary';
import { isNpcPhysicallyPresent } from '../state/npcPresence';
import { selectPromptContext } from '../state/selectPromptContext';
import { resolveNpcBackgroundActivityAgainstCurrentMatters } from '../state/currentMatterLifecycle';
import type { LuanShiNpc, RuntimeState, WorldBook } from '../types';
import {
  buildMemoryContextPackage,
  formatMemoryContextPackageForPrompt,
  type MemoryContextPackage,
} from '../memory';
import { resolvePromptTemplate } from '../prompts/PromptResolver';
import { isTurnExecutionCancelled } from '../turn/TurnExecutionContext';
import { isHardTurnBudgetExceededError } from '../turn/TurnLlmBudget';

export interface NpcIntentSimulationTarget {
  npcId: string;
  npcName: string;
  scope: 'present' | 'focused' | 'mentioned';
  sex?: string;
  age?: number;
  role?: string;
  locationId?: string;
  summary?: string;
  appearance?: string;
  personality?: string;
  motivation?: string;
  relationToPlayer?: string;
  recentAttitude?: string;
  backgroundActivity?: LuanShiNpc['backgroundActivity'];
  memoryCount: number;
}

export interface NpcIntentSimulationIntent {
  npcId: string;
  npcName: string;
  shouldAct: boolean;
  intent: string;
  trigger: string;
  perceptionBasis?: string;
  relationshipBasis?: string;
  emotionalState?: string;
  confidence?: number;
}

export interface NpcIntentSimulationPackage {
  protocolVersion: 'coc.v2.npcIntent.v1';
  generatedAt: string;
  source: 'npcSimulation';
  intents: NpcIntentSimulationIntent[];
}

export type NpcIntentSimulationContractDiagnosticCode =
  | 'npc-trajectory-missing-target'
  | 'npc-trajectory-duplicate-target'
  | 'npc-trajectory-unknown-target'
  | 'npc-trajectory-invalid-row'
  | 'npc-trajectory-stale-contract'
  | 'npc-trajectory-count-mismatch';

export interface NpcIntentSimulationContractValidation {
  valid: boolean;
  package: NpcIntentSimulationPackage;
  diagnosticCodes: NpcIntentSimulationContractDiagnosticCode[];
}

export type NpcIntentSimulationStatus = 'completed' | 'skipped' | 'failed';

export interface NpcIntentSimulationResult {
  status: NpcIntentSimulationStatus;
  reason?: string;
  package?: NpcIntentSimulationPackage;
  targetNpcIds: string[];
  provider?: string;
  model?: string;
  usage?: LlmTokenUsage;
  rawContent?: string;
  diagnosticCodes?: NpcIntentSimulationContractDiagnosticCode[];
}

export interface SelectNpcIntentSimulationTargetsOptions {
  maxNpcCount?: number;
}

export interface NpcIntentSimulationExecutionOptions extends SelectNpcIntentSimulationTargetsOptions {
  apiConfig?: ApiConfigArchive | null;
  llmClient?: LlmClient;
  memoryContextPackage?: MemoryContextPackage;
  signal?: AbortSignal;
  timeoutMs?: number;
  timeoutErrorFactory?: LlmTimeoutErrorFactory;
}

export async function getConfiguredNpcSimulationApiConfig(): Promise<ApiConfigArchive | null> {
  return resolveExplicitApiConfigForTaskAsync('npcSimulation');
}

export function selectNpcIntentSimulationTargets(
  state: RuntimeState,
  playerInput: string,
  options: SelectNpcIntentSimulationTargetsOptions = {},
): NpcIntentSimulationTarget[] {
  const normalized = ensureLuanShiState(state);
  const maxNpcCount = Math.max(0, options.maxNpcCount ?? 5);
  if (maxNpcCount === 0) return [];

  return filterProtagonistNpcClones(normalized, normalized.npcs)
    .map((npc) => {
      const backgroundActivity = resolveNpcBackgroundActivityAgainstCurrentMatters(
        npc.backgroundActivity,
        normalized.activeQuests,
        normalized.currentDate,
      );
      const scope = getNpcSimulationScope(normalized, npc, playerInput);
      return scope
        ? { npc, backgroundActivity, scope, priority: getNpcSimulationPriority(scope) }
        : undefined;
    })
    .filter((entry): entry is {
      npc: LuanShiNpc;
      backgroundActivity: LuanShiNpc['backgroundActivity'];
      scope: NpcIntentSimulationTarget['scope'];
      priority: number;
    } => Boolean(entry))
    .sort((left, right) => left.priority - right.priority)
    .slice(0, maxNpcCount)
    .map(({ npc, backgroundActivity, scope }) => ({
      npcId: npc.npcId,
      npcName: npc.name,
      scope,
      sex: npc.sex,
      age: deriveNpcCurrentAge(npc, normalized.currentDate),
      role: npc.currentIdentity ?? npc.role,
      locationId: npc.locationId,
      summary: npc.summary,
      appearance: npc.appearance,
      personality: npc.personality,
      motivation: npc.motivation,
      relationToPlayer: npc.relationToPlayer,
      recentAttitude: npc.recentAttitude,
      backgroundActivity: backgroundActivity
        ? {
            ...backgroundActivity,
            ...(backgroundActivity.sourceIds ? { sourceIds: [...backgroundActivity.sourceIds] } : {}),
          }
        : undefined,
      memoryCount: npc.memories?.length ?? 0,
    }));
}

export function parseNpcIntentSimulationResponse(
  content: string,
  allowedTargets: NpcIntentSimulationTarget[],
): NpcIntentSimulationPackage {
  const payload = parseJsonObject(content);
  const allowedById = new Map(allowedTargets.map((target) => [target.npcId, target]));
  const rawIntents = Array.isArray(payload.intents) ? payload.intents : [];
  const intents = rawIntents
    .map((item) => normalizeIntent(item, allowedById))
    .filter((intent): intent is NpcIntentSimulationIntent => Boolean(intent));

  return {
    protocolVersion: 'coc.v2.npcIntent.v1',
    generatedAt: readString(payload.generatedAt),
    source: 'npcSimulation',
    intents,
  };
}

export function validateNpcIntentSimulationResponse(
  content: string,
  frozenTargets: NpcIntentSimulationTarget[],
): NpcIntentSimulationContractValidation {
  const payload = parseJsonObject(content);
  const diagnostics: NpcIntentSimulationContractDiagnosticCode[] = [];
  if (payload.protocolVersion !== 'coc.v2.npcIntent.v1') {
    diagnostics.push('npc-trajectory-stale-contract');
  }
  if (!Array.isArray(payload.intents)) {
    diagnostics.push('npc-trajectory-invalid-row');
  }
  const rawIntents = Array.isArray(payload.intents) ? payload.intents : [];
  const allowedIds = new Set(frozenTargets.map((target) => target.npcId));
  const seenIds = new Set<string>();
  rawIntents.forEach((row) => {
    if (!isRecord(row)) {
      diagnostics.push('npc-trajectory-invalid-row');
      return;
    }
    const npcId = readString(row.npcId).trim();
    const frozenTarget = frozenTargets.find((target) => target.npcId === npcId);
    if (!allowedIds.has(npcId)) diagnostics.push('npc-trajectory-unknown-target');
    if (seenIds.has(npcId)) diagnostics.push('npc-trajectory-duplicate-target');
    seenIds.add(npcId);
    if (!npcId
      || !readString(row.npcName).trim()
      || frozenTarget?.npcName !== readString(row.npcName).trim()
      || typeof row.shouldAct !== 'boolean'
      || !readString(row.intent).trim()
      || !readString(row.trigger).trim()) {
      diagnostics.push('npc-trajectory-invalid-row');
      return;
    }
  });
  if (rawIntents.length !== frozenTargets.length) diagnostics.push('npc-trajectory-count-mismatch');
  if (frozenTargets.some((target) => !seenIds.has(target.npcId))) {
    diagnostics.push('npc-trajectory-missing-target');
  }
  const uniqueDiagnostics = [...new Set(diagnostics)];
  return {
    valid: uniqueDiagnostics.length === 0,
    package: parseNpcIntentSimulationResponse(content, frozenTargets),
    diagnosticCodes: uniqueDiagnostics,
  };
}

export async function executeNpcIntentSimulation(
  worldBook: WorldBook,
  state: RuntimeState,
  playerInput: string,
  options: NpcIntentSimulationExecutionOptions = {},
): Promise<NpcIntentSimulationResult> {
  if (!options.apiConfig) {
    return {
      status: 'skipped',
      reason: 'npc simulation api not configured',
      targetNpcIds: [],
    };
  }

  const targets = selectNpcIntentSimulationTargets(state, playerInput, options);
  if (targets.length === 0) {
    return {
      status: 'skipped',
      reason: 'no relevant npc targets',
      targetNpcIds: [],
    };
  }

  try {
    const llmClient = options.llmClient ?? new BrowserLlmClient();
    const memoryContextPackage = options.memoryContextPackage ?? buildMemoryContextPackage(state, playerInput);
    const result = await llmClient.generate({
      config: options.apiConfig,
      messages: buildNpcIntentSimulationMessages(worldBook, state, playerInput, targets, memoryContextPackage),
      temperature: options.apiConfig.temperature ?? 0.2,
      maxOutputTokens: options.apiConfig.maxOutputTokens,
      responseFormat: 'json_object',
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      timeoutErrorFactory: options.timeoutErrorFactory,
    });
    const validation = validateNpcIntentSimulationResponse(result.content, targets);
    const parsed = validation.package;
    const intentPackage: NpcIntentSimulationPackage = {
      ...parsed,
      generatedAt: parsed.generatedAt || ensureLuanShiState(state).currentDate,
    };

    return {
      status: 'completed',
      package: intentPackage,
      targetNpcIds: targets.map((target) => target.npcId),
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      rawContent: result.content,
      ...(validation.diagnosticCodes.length > 0 ? { diagnosticCodes: validation.diagnosticCodes } : {}),
    };
  } catch (error) {
    rethrowIfNpcSimulationCancelled(error, options.signal);
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : 'unknown npc simulation failure',
      targetNpcIds: targets.map((target) => target.npcId),
    };
  }
}

function rethrowIfNpcSimulationCancelled(error: unknown, signal?: AbortSignal): void {
  if (isTurnExecutionCancelled(error)) throw error;
  if (signal?.aborted) throw signal.reason ?? error;
  if (error instanceof DOMException && error.name === 'AbortError') throw error;
  if (isHardTurnBudgetExceededError(error)) throw error;
}

export function formatNpcIntentPackageForPrompt(intentPackage: NpcIntentSimulationPackage): string {
  if (intentPackage.intents.length === 0) return '';

  return [
    '未裁定 NPC 意图建议：',
    '以下内容来自可选 NPC 动态模拟预处理。这不是已发生事实，不是状态写回，也不是主剧情裁定结果；主剧情模型可以采纳、改写或忽略。',
    ...intentPackage.intents.map((intent) => {
      const actionText = intent.shouldAct ? intent.intent : '暂无明显意图';
      const details = [
        intent.perceptionBasis ? `感知依据：${intent.perceptionBasis}` : '',
        intent.relationshipBasis ? `关系/利益依据：${intent.relationshipBasis}` : '',
        intent.emotionalState ? `情绪状态：${intent.emotionalState}` : '',
        typeof intent.confidence === 'number' ? `置信度：${intent.confidence}` : '',
      ].filter(Boolean).join('；');
      return `- ${intent.npcName}(${intent.npcId})：${actionText} // 触发时机：${intent.trigger}${details ? `；${details}` : ''}`;
    }),
  ].join('\n');
}

function buildNpcIntentSimulationMessages(
  worldBook: WorldBook,
  state: RuntimeState,
  playerInput: string,
  targets: NpcIntentSimulationTarget[],
  memoryContextPackage: MemoryContextPackage,
): LlmMessage[] {
  const normalized = ensureLuanShiState(state);
  const resolvedCurrentMatters = selectPromptContext(normalized).resolvedCurrentMatters;
  const resolvedMatterContinuity = resolvedCurrentMatters.length > 0
    ? resolvedCurrentMatters.map((quest) => (
        `- questId=${quest.id}; status=${quest.status}; title=${quest.title}; `
        + `outcome=${quest.outcomeSummary?.trim() || quest.archiveReason?.trim() || '终态已确认'}`
      )).join('\n')
    : '- none';
  const outputJsonSchema = JSON.stringify({
    protocolVersion: 'coc.v2.npcIntent.v1',
    generatedAt: normalized.currentDate,
    intents: [
      {
        npcId: 'must_match_input_target_id',
        npcName: 'NPC名称',
        shouldAct: true,
        intent: '本回合未裁定行动意图；无行动时写“暂无明显意图”',
        trigger: '具体触发条件、看见/听见什么、或条件不足原因',
        perceptionBasis: '该 NPC 能知道或感知到什么',
        relationshipBasis: '关系、利益、职责或风险依据',
        emotionalState: '克制且有阈值的情绪状态',
        confidence: 0.7,
      },
    ],
  }, null, 2);
  const memoryContext = formatMemoryContextPackageForPrompt(memoryContextPackage).join('\n\n') || '暂无相关分层记忆。';
  const defaultSystemPrompt = [
    '你是《乱世风云录 V2》的 NPC 动态模拟预处理器。',
    '你的任务是为本回合相关 NPC 生成“未裁定 NPC 意图建议”，供主剧情模型参考。',
    '你不是主剧情模型：不写正文、不裁定成败、不修改状态、不输出 statePatches、commands、writeback 或 Markdown。',
    'NPC 只能依据自己能看见、听见、亲历、被公开告知或合理推断的信息行动；不能使用玩家内心、系统变量、未来剧情、其他地点私密事件。',
    '没有足够刺激、利益关联、职责压力或感知输入时，应输出 shouldAct=false 和“暂无明显意图”。',
    '若目标携带 backgroundActivity，它只是该人物已经存在的背景处境；不得在此推进或结算后台时间线。',
    '每个目标 NPC 最多输出一个意图；所有目标 NPC 放在同一个 JSON intents 数组中。',
  ].join('\n');
  const defaultUserPrompt = [
    '## 当前任务',
    '请根据目标 NPC 档案、当前场景、玩家输入和相关记忆，返回未裁定 NPC 意图建议。',
    '',
    `当前世界书：${worldBook.manifest.name}`,
    `当前时间：${normalized.currentDate}`,
    `当前地点：${normalized.currentLocationId}`,
    `玩家：${normalized.player.name}（${normalized.player.roleType}）`,
    `玩家输入：${playerInput}`,
    '',
    '## 目标 NPC',
    JSON.stringify(targets, null, 2),
    '',
    '## 相关记忆上下文',
    memoryContext,
    '',
    '## 已结事项连续性',
    resolvedMatterContinuity,
    '- 上述结构化终态优先于旧记忆和旧后台计划；不得把已兑现承诺、已交付款项物资或已完成任务当成待办重新推进。',
    '',
    '## 输出 JSON 结构',
    outputJsonSchema,
    '',
    '## 输出规则',
    '- 只返回 JSON 对象，不要输出 Markdown、XML、解释文字或正文叙事。',
    '- npcId 必须来自目标 NPC，不得编造漂移 ID。',
    '- 不要输出 statePatches、statePatch、writeback、commands、LuanShiCommand。',
    '- intent 是候选动作，不是已经发生的事实；主剧情模型会决定是否采纳。',
    '- 不得推进、结算或重排 backgroundActivity；后台世界演化由独立执行器负责。',
    '- trigger 必须具体，说明看见/听见什么、何时触发，或为什么条件不足。',
  ].join('\n');

  const terminalContinuityGuard = [
    '## 已结事项连续性强制约束',
    resolvedMatterContinuity,
    '- 以上事项已经结束。不得因旧记忆或旧 backgroundActivity 再次生成同一承诺、交付或任务的首次执行意图；只有本回合出现新的结构化因果才可提出新的同类行动。',
  ].join('\n');

  return [
    {
      role: 'system',
      content: [
        resolvePromptTemplate('npcSimulation.systemPrompt', defaultSystemPrompt, {
          outputJsonSchema,
          playerInput,
        }),
        terminalContinuityGuard,
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: [
        resolvePromptTemplate('npcSimulation.userPrompt', defaultUserPrompt, {
          currentDate: normalized.currentDate,
          currentLocation: normalized.currentLocationId,
          playerInput,
          targetNpcs: JSON.stringify(targets, null, 2),
          memoryContext,
          resolvedCurrentMatters: resolvedMatterContinuity,
          outputJsonSchema,
        }),
        terminalContinuityGuard,
      ].join('\n\n'),
    },
  ];
}

function getNpcSimulationScope(
  state: RuntimeState,
  npc: LuanShiNpc,
  playerInput: string,
): NpcIntentSimulationTarget['scope'] | undefined {
  if (isNpcPhysicallyPresent(state, npc)) return 'present';
  if (npc.isFocused) return 'focused';
  if (npc.name && playerInput.includes(npc.name)) return 'mentioned';
  return undefined;
}

function getNpcSimulationPriority(scope: NpcIntentSimulationTarget['scope']): number {
  if (scope === 'present') return 0;
  if (scope === 'focused') return 1;
  if (scope === 'mentioned') return 2;
  return 3;
}

function parseJsonObject(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content);
    return isRecord(parsed) ? parsed : {};
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) return {};
    const parsed = JSON.parse(content.slice(start, end + 1));
    return isRecord(parsed) ? parsed : {};
  }
}

function normalizeIntent(
  value: unknown,
  allowedById: Map<string, NpcIntentSimulationTarget>,
): NpcIntentSimulationIntent | undefined {
  if (!isRecord(value)) return undefined;
  const npcId = readString(value.npcId);
  const target = allowedById.get(npcId);
  if (!target) return undefined;

  const intent = readString(value.intent).trim();
  const trigger = readString(value.trigger).trim();
  if (!intent || !trigger) return undefined;

  const shouldAct = typeof value.shouldAct === 'boolean'
    ? value.shouldAct
    : !intent.includes('暂无明显意图');

  return {
    npcId: target.npcId,
    npcName: readString(value.npcName).trim() || target.npcName,
    shouldAct,
    intent,
    trigger,
    perceptionBasis: readOptionalString(value.perceptionBasis),
    relationshipBasis: readOptionalString(value.relationshipBasis),
    emotionalState: readOptionalString(value.emotionalState),
    confidence: normalizeConfidence(value.confidence),
  };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown): string | undefined {
  const text = readString(value).trim();
  return text || undefined;
}

function normalizeConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
