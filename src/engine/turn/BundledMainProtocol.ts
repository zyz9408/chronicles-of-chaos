import type { RuntimeState, WorldBook } from '../types';
import type { ApiFeatureExecutionModes } from '../settings/ApiConfigManager';
import {
  selectNpcIntentSimulationTargets,
  validateNpcIntentSimulationResponse,
  type NpcIntentSimulationResult,
  type NpcIntentSimulationContractDiagnosticCode,
  type NpcIntentSimulationTarget,
} from '../npc/NpcIntentSimulation';
import {
  applyRelationshipWorldEvolutionPackage,
  parseRelationshipWorldEvolutionResponse,
  selectRelationshipWorldEvolutionCandidates,
  type RelationshipWorldEvolutionCandidate,
  type RelationshipWorldEvolutionResult,
} from '../worldEvolution/RelationshipWorldEvolution';
import {
  buildRecentTurnMemorySummaryTask,
  clearMemorySummaryMaintenance,
  parseMemorySummaryResult,
  reapplyMemorySummaryExecutionResult,
  type MemorySummaryExecutionResult,
  type MemorySummaryTaskInput,
} from '../memory';
import type { NarratorResponse } from './MockNarrator';

export const BUNDLED_MAIN_PROTOCOL_VERSION = 'coc.v2.bundledMain.v1' as const;
export const BUNDLED_MAIN_PROMPT_CHARACTER_BUDGET = 32_000;
export const BUNDLED_MAIN_FEATURE_OUTPUT_TOKEN_BUDGET = 4_096;

export interface BundledMainPlan {
  revision: 1;
  protocolVersion: typeof BUNDLED_MAIN_PROTOCOL_VERSION;
  promptCharacterBudget: number;
  featureOutputTokenBudget: number;
  modes: ApiFeatureExecutionModes;
  modules: {
    stateWriteback: { planned: boolean };
    npcCompletion: { planned: boolean };
    npcSimulation: { planned: boolean; targetCount: number };
    worldEvolution: { planned: boolean; targetCount: number };
    memorySummary: { planned: boolean; activeScopes: string[] };
  };
  npcSimulationTargets: NpcIntentSimulationTarget[];
  worldEvolutionCandidates: RelationshipWorldEvolutionCandidate[];
  memorySummaryTask?: MemorySummaryTaskInput;
}

export function buildBundledMainPlan(
  state: RuntimeState,
  playerInput: string,
  modes: ApiFeatureExecutionModes,
  options: {
    openingInitialization?: boolean;
    npcSimulationEnabled?: boolean;
    npcSimulationMaxNpcCount?: number;
    worldEvolutionMaxNpcCount?: number;
  } = {},
): BundledMainPlan {
  const npcSimulationTargets = modes.npcSimulation === 'bundledMain'
    && options.npcSimulationEnabled !== false
    ? selectNpcIntentSimulationTargets(state, playerInput, {
        maxNpcCount: options.npcSimulationMaxNpcCount,
      })
    : [];
  const worldEvolutionCandidates = modes.worldEvolution === 'bundledMain'
    && !options.openingInitialization
    ? selectRelationshipWorldEvolutionCandidates(
        state,
        playerInput,
        options.worldEvolutionMaxNpcCount,
        npcSimulationTargets.map((target) => target.npcId),
      )
    : [];
  const memorySummaryTask = modes.memorySummary === 'bundledMain'
    && !options.openingInitialization
    ? buildRecentTurnMemorySummaryTask(state)
    : undefined;

  const plan: BundledMainPlan = {
    revision: 1,
    protocolVersion: BUNDLED_MAIN_PROTOCOL_VERSION,
    promptCharacterBudget: BUNDLED_MAIN_PROMPT_CHARACTER_BUDGET,
    featureOutputTokenBudget: BUNDLED_MAIN_FEATURE_OUTPUT_TOKEN_BUDGET,
    modes,
    modules: {
      stateWriteback: { planned: modes.stateWriteback === 'bundledMain' },
      npcCompletion: { planned: modes.npcCompletion === 'bundledMain' },
      npcSimulation: { planned: npcSimulationTargets.length > 0, targetCount: npcSimulationTargets.length },
      worldEvolution: { planned: worldEvolutionCandidates.length > 0, targetCount: worldEvolutionCandidates.length },
      memorySummary: {
        planned: Boolean(memorySummaryTask?.activeScopes.length),
        activeScopes: memorySummaryTask?.activeScopes ?? [],
      },
    },
    npcSimulationTargets,
    worldEvolutionCandidates,
    ...(memorySummaryTask?.activeScopes.length ? { memorySummaryTask } : {}),
  };
  return fitBundledMainPlanToBudget(plan);
}

export function fitBundledMainPlanToBudget(plan: BundledMainPlan): BundledMainPlan {
  let fitted = plan;
  if (formatBundledMainProtocolForPrompt(fitted).length <= fitted.promptCharacterBudget) return fitted;
  fitted = {
    ...fitted,
    modules: { ...fitted.modules, memorySummary: { planned: false, activeScopes: [] } },
    memorySummaryTask: undefined,
  };
  if (formatBundledMainProtocolForPrompt(fitted).length <= fitted.promptCharacterBudget) return fitted;
  return {
    ...fitted,
    modules: { ...fitted.modules, worldEvolution: { planned: false, targetCount: 0 } },
    worldEvolutionCandidates: [],
  };
}

export function formatBundledMainProtocolForPrompt(plan: BundledMainPlan): string {
  const requested: string[] = [];
  if (plan.modules.npcSimulation.planned) {
    const frozenTargetIds = plan.npcSimulationTargets.map((target) => target.npcId);
    requested.push([
      '### npcSimulation（同轮完整冻结轨迹）',
      '必须为每个冻结目标恰好返回一项 intents；没有行动的 NPC 也不得省略，必须返回 shouldAct=false。',
      '输出必须原样回传 expectedCount 与 frozenTargetIds。',
      JSON.stringify({ expectedCount: frozenTargetIds.length, frozenTargetIds, targets: plan.npcSimulationTargets }),
      '最终响应须按下列骨架返回完整 npcSimulation，不得删除、增加或重复任何冻结行。',
      JSON.stringify({
        protocolVersion: BUNDLED_MAIN_PROTOCOL_VERSION,
        expectedCount: frozenTargetIds.length,
        frozenTargetIds,
        intents: plan.npcSimulationTargets.map((target) => ({
          npcId: target.npcId,
          npcName: target.npcName,
          shouldAct: false,
          intent: '无行动时填写结构化原因',
          trigger: '无行动时填写结构化依据',
        })),
      }),
    ].join('\n'));
  }
  if (plan.modules.worldEvolution.planned) {
    requested.push([
      'worldEvolution：只能评价以下冻结候选，不得虚构候选或改写 evaluationId。',
      JSON.stringify({
        protocolVersion: 'coc.v2.relationshipWorldEvolution.v1',
        candidates: plan.worldEvolutionCandidates,
        decisions: [],
      }),
    ].join('\n'));
  }
  if (plan.modules.memorySummary.planned && plan.memorySummaryTask) {
    requested.push([
      'memorySummary：只压缩以下请求前已冻结的来源；不得把本回合新正文混入摘要。',
      JSON.stringify(plan.memorySummaryTask),
    ].join('\n'));
  }

  return [
    `## 同轮功能封装协议 ${BUNDLED_MAIN_PROTOCOL_VERSION}`,
    '本回合只有一次主请求。stateWriteback 与 npcCompletion 继续写入既有 statePatches/writeback 结构；不要另造同名顶层字段。',
    '仅将已计划的 npcSimulation、worldEvolution、memorySummary 放入顶层 bundledFeatures。',
    `顶层格式：${JSON.stringify({
      protocolVersion: BUNDLED_MAIN_PROTOCOL_VERSION,
      npcSimulation: {},
      worldEvolution: {},
      memorySummary: {},
    })}`,
    '未计划的模块必须省略。模块结果若不完整会被本地隔离或延后，不得用正文暗示其已经写入。',
    `三个辅助模块合计最多使用约 ${plan.featureOutputTokenBudget} 个输出 token；优先保证主正文与状态写回完整。`,
    ...requested,
  ].join('\n\n');
}

export function resolveBundledNpcSimulation(
  response: NarratorResponse,
  plan: BundledMainPlan,
  currentDate: string,
): NpcIntentSimulationResult {
  const targets = plan.npcSimulationTargets;
  if (!plan.modules.npcSimulation.planned) {
    return { status: 'skipped', reason: 'bundled npc simulation not planned', targetNpcIds: [] };
  }
  const raw = response.bundledFeatures?.npcSimulation;
  if (!raw) {
    return { status: 'failed', reason: 'bundled npc simulation missing', targetNpcIds: targets.map((item) => item.npcId) };
  }
  const frozenTargetIds = targets.map((target) => target.npcId);
  const echoedIds = Array.isArray(raw.frozenTargetIds)
    ? raw.frozenTargetIds.filter((value): value is string => typeof value === 'string').map((value) => value.trim())
    : [];
  const rawRows = Array.isArray(raw.intents) ? raw.intents : [];
  const rawRowIds = rawRows.map((row) => isRecord(row) && typeof row.npcId === 'string' ? row.npcId.trim() : '');
  const exactSet = (values: string[], expected: string[]) => values.length === expected.length
    && new Set(values).size === values.length
    && values.every((value) => expected.includes(value));
  const echoValid = raw.protocolVersion === BUNDLED_MAIN_PROTOCOL_VERSION
    && raw.expectedCount === frozenTargetIds.length
    && exactSet(echoedIds, frozenTargetIds)
    && exactSet(rawRowIds, frozenTargetIds);
  const validation = validateNpcIntentSimulationResponse(JSON.stringify({
    ...raw,
    protocolVersion: 'coc.v2.npcIntent.v1',
  }), targets);
  if (!echoValid || !validation.valid) {
    const echoDiagnostics: NpcIntentSimulationContractDiagnosticCode[] = [];
    if (raw.protocolVersion !== BUNDLED_MAIN_PROTOCOL_VERSION) echoDiagnostics.push('npc-trajectory-stale-contract');
    if (raw.expectedCount !== frozenTargetIds.length || rawRows.length !== frozenTargetIds.length) {
      echoDiagnostics.push('npc-trajectory-count-mismatch');
    }
    if (!exactSet(echoedIds, frozenTargetIds)) echoDiagnostics.push('npc-trajectory-missing-target');
    const diagnosticCodes = [...new Set([...echoDiagnostics, ...validation.diagnosticCodes])];
    return {
      status: 'failed',
      reason: `bundled npc simulation quarantined: ${diagnosticCodes.join(', ')}`,
      targetNpcIds: targets.map((item) => item.npcId),
      diagnosticCodes,
      rawContent: JSON.stringify(raw),
    };
  }
  return {
    status: 'completed',
    package: { ...validation.package, generatedAt: validation.package.generatedAt || currentDate },
    targetNpcIds: targets.map((item) => item.npcId),
    rawContent: JSON.stringify(raw),
  };
}

export function applyBundledWorldEvolution(
  state: RuntimeState,
  worldBook: WorldBook,
  response: NarratorResponse,
  plan: BundledMainPlan,
): RelationshipWorldEvolutionResult {
  const candidates = plan.worldEvolutionCandidates;
  if (!plan.modules.worldEvolution.planned) {
    return { status: 'skipped', reason: 'bundled world evolution not planned', state, targetNpcIds: [], appliedNpcIds: [] };
  }
  const raw = response.bundledFeatures?.worldEvolution;
  const rawDecisions = raw && Array.isArray(raw.decisions) ? raw.decisions : [];
  const decisionIds = rawDecisions.map((decision) => isRecord(decision) && typeof decision.npcId === 'string' ? decision.npcId.trim() : '');
  const candidateIds = candidates.map((candidate) => candidate.npcId);
  const exactDecisionSet = decisionIds.length === candidateIds.length
    && new Set(decisionIds).size === decisionIds.length
    && decisionIds.every((id) => candidateIds.includes(id));
  if (!raw || raw.protocolVersion !== 'coc.v2.relationshipWorldEvolution.v1' || !exactDecisionSet) {
    return { status: 'failed', reason: 'bundled world evolution missing or stale', state, targetNpcIds: candidates.map((item) => item.npcId), appliedNpcIds: [] };
  }
  const parsed = parseRelationshipWorldEvolutionResponse(JSON.stringify(raw), state, candidates, worldBook);
  if (parsed.decisions.length !== rawDecisions.length) {
    return { status: 'failed', reason: 'bundled world evolution contained invalid decisions', state, targetNpcIds: candidateIds, appliedNpcIds: [] };
  }
  const application = applyRelationshipWorldEvolutionPackage(state, parsed, candidates);
  if (application.appliedNpcIds.length !== candidates.length) {
    return { status: 'failed', reason: 'bundled world evolution atomic application rejected', state, targetNpcIds: candidateIds, appliedNpcIds: [] };
  }
  return {
    status: application.appliedNpcIds.length > 0 ? 'completed' : 'failed',
    reason: application.appliedNpcIds.length > 0
      ? `已演化 ${application.appliedNpcIds.length} 名关系人物`
      : 'bundled world evolution had no valid decisions',
    state: application.state,
    targetNpcIds: candidates.map((item) => item.npcId),
    appliedNpcIds: application.appliedNpcIds,
    rawContent: JSON.stringify(raw),
  };
}

export function applyBundledMemorySummary(
  state: RuntimeState,
  response: NarratorResponse,
  plan: BundledMainPlan,
): MemorySummaryExecutionResult {
  const task = plan.memorySummaryTask;
  const raw = response.bundledFeatures?.memorySummary;
  if (!plan.modules.memorySummary.planned || !task) {
    return { status: 'skipped', reason: 'bundled memory summary not planned', newState: state, appliedSummaries: [], ignoredSummaries: [], sourceRecentTurnCount: 0, keptRecentTurnCount: 0, activeScopes: [] };
  }
  if (!raw) {
    return { status: 'failed', reason: 'bundled memory summary missing', newState: state, appliedSummaries: [], ignoredSummaries: [], sourceRecentTurnCount: task.sourceRecentTurnSummaries.length, keptRecentTurnCount: task.keptRecentTurnIds.length, activeScopes: task.activeScopes, apiTaskId: 'mainNarrative', task };
  }
  const applied = reapplyMemorySummaryExecutionResult(state, {
    status: 'applied',
    newState: state,
    appliedSummaries: [],
    ignoredSummaries: [],
    sourceRecentTurnCount: task.sourceRecentTurnSummaries.length,
    keptRecentTurnCount: task.keptRecentTurnIds.length,
    activeScopes: task.activeScopes,
    apiTaskId: 'mainNarrative',
    rawContent: JSON.stringify(raw),
    task,
    summaryResult: parseMemorySummaryResult(JSON.stringify(raw), task.createdAt),
  });
  return applied.status === 'applied'
    ? { ...applied, newState: clearMemorySummaryMaintenance(applied.newState) }
    : applied;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
