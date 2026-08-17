// ============================================================
// Engine - TurnOrchestrator
// 回合流程编排器 - 统一协调整个回合流程
// ============================================================

import type {
  WorldBook,
  RuntimeState,
  StatePatch,
  PatchValidationResult,
  SuggestedAction,
  TurnDisplayMeta,
  TurnProcessingStage,
  TurnProcessingStageEvent,
  RuntimeLocationWriteDiagnostic,
} from '../types';
import type { PromptModule } from './PromptModuleRegistry';
import { interpretAction } from './ActionInterpreter';
import { composePrompt } from './PromptComposer';
import {
  generateMockNarrative,
  type NarratorNpcProfileSuggestion,
  type NarratorResponse,
  type NarratorWritebackProtocol,
} from './MockNarrator';
import {
  parseNarratorResponse,
  type ParseNarratorResponseOptions,
} from './NarratorResponseParser';
import { isAllowedPatchType, validatePatch } from './StatePatchValidator';
import {
  applyPatchToDraft,
  createStatePatchDraft,
  finalizeStatePatchDraft,
  type ApplyPatchOptions,
} from './StatePatchApplier';
import {
  applyAcceptedNpcProfilesForCompliance,
  appendNarratorWritebackSummary,
  applyNarratorWriteback,
  dropRejectedLocationDependencies,
  ensureGeneratedStoryLocationReturnRoute,
  prepareNarratorLocationWriteback,
  remapNarratorStatePatchLocationReferences,
  tryApplyNpcProfileForCompliance,
  type NarratorMapWritebackRepairDiagnostic,
  type NarratorLocationWritebackPreparation,
  type NarratorWritebackApplyOptions,
} from './NarratorWritebackApplier';
import {
  extractLuanShiCommandFromPatch,
  isKnownLuanShiCommandAction,
  normalizeLuanShiCommandPatch,
} from './LuanShiCommandPatch';
import {
  matchesRecoverableStatePatchBusinessIdentity,
  normalizeResourceChangedPayload,
  normalizeStatePatchContract,
} from './StatePatchContract';
import { buildTurnDisplayMeta } from './turnDisplay';
import { mergeRepairWritebackProtocol } from './writebackDedupe';
import { resolveCurrentTimelineAnchors, generateWorldSnapshot } from '../worldbook/WorldSnapshotResolver';
import { isCurrentTroopLedgerEntry } from '../state/troopLifecycle';
import { resolveBondTargetNpcIdsByExactName } from '../state/BondThreadIdentity';
import { getStartBookmark } from '../worldbook/StartBookmarkResolver';
import { getCrisisTemplate } from '../worldbook/OpeningCrisisResolver';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import {
  LlmEmptyContentError,
  type EmbeddingClient,
  type LlmClient,
  type LlmMessage,
  type LlmTokenUsage,
} from '../llm/LlmClient';
import {
  appendMemorySummaryExecutionSummary,
  buildMemoryContextPackage,
  executeMemorySummaryCompression,
  prepareMemoryVectorRetrieval,
  type MemoryContextPackage,
  type MemorySummaryExecutionResult,
  type MemoryVectorRetrievalResult,
} from '../memory';
import { buildBattleJudgementCards, buildOrdinaryJudgementCards } from './turnJudgementCards';
import {
  findOrphanJudgementMarkers,
  sanitizeDanglingConflictReferences,
  type JudgementMarkerIntegrityIssue,
} from './JudgementWritebackIntegrity';
import {
  executeNpcIntentSimulation,
  type NpcIntentSimulationResult,
} from '../npc/NpcIntentSimulation';
import {
  executeRelationshipWorldEvolution,
  type RelationshipWorldEvolutionResult,
} from '../worldEvolution/RelationshipWorldEvolution';
import {
  buildTurnMessages,
  resolveTurnPromptCacheLayout,
  splitStateWriterContext,
  stripStateWriterStableProtocolMarker,
  type TurnPromptCacheLayout,
} from './TurnPromptMessages';
import {
  buildNarrativeLengthRegenerationDirective,
  evaluateNarrativeLength,
  shouldRegenerateNarrativeLength,
} from '../prompts/NarrativeLengthGuidance';
import type { RuntimePromptTokenEstimate } from './PromptRuntimeTokenEstimate';
import {
  buildCurrentLocationDisplayPath,
  buildRuntimeMapIndex,
  canonicalizeLocationChangeSceneTargets,
} from '../map/runtimeMap';
import { isNpcPhysicallyPresent } from '../state/npcPresence';
import {
  applyPlayerVitalsAfterTurn,
} from '../character/PlayerStaminaRuntime';
import { settlePassiveUniqueArtsAfterRuntimeTurn } from '../character/PlayerPassiveUniqueArtRuntime';
import {
  applyPlayerExperience,
  calculateOrdinaryCheckExperienceAwards,
} from '../character/progression';
import { getGameDifficultyProfile } from '../settings/GameDifficulty';
import {
  applyHoldingAnnualSettlementRuntime,
  applyHoldingSettlementTimelineRuntime,
  prepareHoldingAnnualSettlement,
} from '../holdings/HoldingAnnualSettlementRuntime';
import { validateLuanShiCommand, type LuanShiCommand } from '../state/luanshiCommands';
import { detectMissingNpcProfileCandidates, type MissingNpcProfileCandidate } from './NpcProfileCompliance';
import {
  detectNpcUniqueArtComplianceCandidates,
  type NpcUniqueArtComplianceCandidate,
} from './NpcUniqueArtCompliance';
import {
  completeNpcUniqueArtsLocally,
  evaluateNpcUniqueArtCompliance,
} from '../character/NpcUniqueArtPolicy';
import { isTurnExecutionCancelled } from './TurnExecutionContext';
import {
  createTurnLlmBudget,
  isHardTurnBudgetExceededError,
  type PostNarrativeLlmBudget,
  type TurnLlmBudget,
  type TurnLlmRequestBudget,
} from './TurnLlmBudget';
import type {
  EncounterStartIntent,
  EncounterTransitionDecision,
  SemanticProjection,
  WarStartIntent,
} from '../encounterV2/EncounterContracts';
import type { TavernManagementSettings } from '../prompts/TavernPresetStore';
import { advanceCorrespondenceState } from '../correspondence';

export interface TurnExecutionOptions {
  apiConfig?: ApiConfigArchive | null;
  stateWritebackApiConfig?: ApiConfigArchive | null;
  stateWritebackFallbackApiConfig?: ApiConfigArchive | null;
  npcCompletionApiConfig?: ApiConfigArchive | null;
  npcCompletionFallbackApiConfig?: ApiConfigArchive | null;
  memorySummaryApiConfig?: ApiConfigArchive | null;
  memorySummaryApiTaskId?: 'memorySummary' | 'mainNarrative';
  embeddingApiConfig?: ApiConfigArchive | null;
  npcSimulationApiConfig?: ApiConfigArchive | null;
  npcSimulationMaxNpcCount?: number;
  worldEvolutionApiConfig?: ApiConfigArchive | null;
  worldEvolutionMaxNpcCount?: number;
  persistentPromptGuide?: string;
  tavernSettings?: TavernManagementSettings;
  llmClient?: LlmClient;
  stateWritebackLlmClient?: LlmClient;
  stateWritebackFallbackLlmClient?: LlmClient;
  npcCompletionLlmClient?: LlmClient;
  npcCompletionFallbackLlmClient?: LlmClient;
  memorySummaryLlmClient?: LlmClient;
  embeddingClient?: EmbeddingClient;
  npcSimulationLlmClient?: LlmClient;
  worldEvolutionLlmClient?: LlmClient;
  narratorWritebackOptions?: NarratorWritebackApplyOptions;
  openingInitialization?: boolean;
  /**
   * UI 可先原子提交主回合，再把记忆压缩作为独立维护任务执行。
   * 默认保持旧调用方行为。
   */
  deferMemorySummaryCompression?: boolean;
  onContentDelta?: (delta: string) => void;
  onContentReset?: () => void;
  onStageChange?: (event: TurnProcessingStageEvent) => void;
  signal?: AbortSignal;
}

export interface TurnResult {
  narrativeText: string;
  suggestedActions: SuggestedAction[];
  statePatch: StatePatch | null;
  patchValidation: PatchValidationResult | null;
  newRuntimeState: RuntimeState;
  actionIntent: string;
  promptContext: string;
  narrativeContext: string;
  stateWriterContext: string;
  promptModules: PromptModule[];
  promptEstimatedTokens: number;
  runtimeTokenEstimate: RuntimePromptTokenEstimate;
  generationMode: 'llm' | 'mock';
  generationProvider?: string;
  generationModel?: string;
  memoryContextPackage: MemoryContextPackage;
  memoryVectorRetrieval?: MemoryVectorRetrievalResult;
  npcIntentSimulation?: NpcIntentSimulationResult;
  worldEvolution?: RelationshipWorldEvolutionResult;
  memorySummary?: MemorySummaryExecutionResult;
  turnDisplayMeta: TurnDisplayMeta;
  statePatches?: StatePatch[];
  writeback?: NarratorWritebackProtocol;
  locationWritebackDiagnostics: RuntimeLocationWriteDiagnostic[];
  locationWritebackErrors: string[];
  routeWritebackErrors: string[];
  stateWritebackWarnings: string[];
  encounterTransitionDecision?: EncounterTransitionDecision;
  encounterStartIntent?: EncounterStartIntent;
  semanticProjections?: SemanticProjection[];
}

type TurnProcessingStageEmitter = (event: TurnProcessingStageEvent) => void;

const NPC_PROFILE_REPAIR_SKIPPED_AFTER_STATE_WRITEBACK_FAILURE_NOTE =
  'NPC建档合规修复跳过：同一后处理 API 的状态写回整理已失败';
const NPC_PROFILE_REPAIR_SKIPPED_AFTER_STATE_WRITEBACK_FAILURE_DETAIL =
  'same post-turn api already failed during state writeback repair';
const OPTIONAL_WRITEBACK_PRIMARY_TIMEOUT_MS = 120_000;

class TimeAdvanceRepairError extends Error {
  constructor(
    message: string,
    public readonly usage?: LlmTokenUsage,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'TimeAdvanceRepairError';
  }
}

function createTurnProcessingStageRecorder(
  onStageChange?: (event: TurnProcessingStageEvent) => void,
): { events: TurnProcessingStageEvent[]; emit: TurnProcessingStageEmitter } {
  const events: TurnProcessingStageEvent[] = [];
  return {
    events,
    emit: (event) => {
      events.push(event);
      onStageChange?.(event);
    },
  };
}

async function runProcessingStage<T>(
  emit: TurnProcessingStageEmitter,
  stage: TurnProcessingStage,
  label: string,
  meta: Pick<TurnProcessingStageEvent, 'provider' | 'model'>,
  task: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  emit({ stage, label, status: 'started', startedAt: startedAtIso, ...meta });
  try {
    const result = await task();
    const usage = extractStageTokenUsage(result);
    emit({
      stage,
      label,
      status: 'finished',
      startedAt: startedAtIso,
      elapsedMs: Date.now() - startedAt,
      ...(usage ? { usage } : {}),
      ...meta,
    });
    return result;
  } catch (error) {
    const usage = extractStageTokenUsage(error);
    emit({
      stage,
      label,
      status: 'failed',
      startedAt: startedAtIso,
      elapsedMs: Date.now() - startedAt,
      detail: getErrorMessage(error),
      ...(usage ? { usage } : {}),
      ...meta,
    });
    throw error;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rethrowIfTurnCancelled(error: unknown, signal?: AbortSignal): void {
  if (isTurnExecutionCancelled(error)) throw error;
  if (isHardTurnBudgetExceededError(error)) throw error;
  if (signal?.aborted) throw signal.reason ?? error;
  if (error instanceof DOMException && error.name === 'AbortError') throw error;
}

class NpcProfileRepairAcceptanceError extends Error {
  constructor(
    message: string,
    public readonly response: NarratorResponse,
    public readonly usage?: LlmTokenUsage,
  ) {
    super(message);
    this.name = 'NpcProfileRepairAcceptanceError';
  }
}

function extractStageTokenUsage(value: unknown): LlmTokenUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const usage = (value as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const source = usage as Record<string, unknown>;
  const normalized: LlmTokenUsage = {};
  for (const key of [
    'promptTokens',
    'completionTokens',
    'totalTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'cacheMissTokens',
  ] as const) {
    const tokenCount = source[key];
    if (typeof tokenCount === 'number' && Number.isFinite(tokenCount)) {
      normalized[key] = Math.max(0, Math.floor(tokenCount));
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isSameApiConfig(a: ApiConfigArchive | null | undefined, b: ApiConfigArchive | null | undefined): boolean {
  if (!a || !b) return false;
  return a.provider === b.provider
    && a.model === b.model
    && normalizeApiBaseUrl(a.baseUrl) === normalizeApiBaseUrl(b.baseUrl);
}

function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/**
 * 执行完整回合流程
 */
export async function executeTurn(
  worldBook: WorldBook,
  runtimeState: RuntimeState,
  playerInput: string,
  options: TurnExecutionOptions = {},
): Promise<TurnResult> {
  options.signal?.throwIfAborted();
  // 书信与承诺只按游戏时钟推进；到期内容在下一次正常回合进入既有主叙事调用，
  // 不会在后台额外调用 API。
  runtimeState = advanceCorrespondenceState(runtimeState, runtimeState.currentDate).state;
  const turnLlmBudget = createTurnLlmBudget(options.signal);
  const processingStageRecorder = createTurnProcessingStageRecorder(options.onStageChange);
  const emitProcessingStage = processingStageRecorder.emit;

  // 1. 粗略识别行动类型
  const actionIntent = interpretAction(playerInput);

  // 2. 获取上下文信息
  const bookmark = runtimeState.startBookmarkId
    ? getStartBookmark(worldBook, runtimeState.startBookmarkId)
    : undefined;

  const timelineAnchors = resolveCurrentTimelineAnchors(worldBook, runtimeState.currentDate);

  const crisis = runtimeState.currentCrisisId
    ? getCrisisTemplate(worldBook, runtimeState.currentCrisisId)
    : undefined;

  const memoryVectorRetrieval = options.embeddingApiConfig
    ? await runProcessingStage(
        emitProcessingStage,
        'retrievingMemory',
        '检索相关记忆',
        { provider: options.embeddingApiConfig.provider, model: options.embeddingApiConfig.model },
        () => {
          const requestBudget = turnLlmBudget.getAuxiliaryRequestBudget();
          return prepareMemoryVectorRetrieval(runtimeState, playerInput, {
            apiConfig: options.embeddingApiConfig!,
            embeddingClient: options.embeddingClient,
            // 先取较宽候选池，再由统一记忆包按每名 NPC 的 3/5 条额度定向分发。
            limit: Math.max(runtimeState.memoryArchive?.settings.vectorResultLimit ?? 6, 30),
            ...requestBudget,
          });
        },
      )
    : undefined;

  const memoryContextPackage = buildMemoryContextPackage(runtimeState, playerInput, {
    retrievedMemories: memoryVectorRetrieval?.retrievedMemories,
  });

  const npcIntentSimulationStartedAt = Date.now();
  const npcIntentSimulationStartedAtIso = new Date(npcIntentSimulationStartedAt).toISOString();
  emitProcessingStage({
    stage: 'simulatingNpcs',
    label: '模拟相关 NPC',
    status: 'started',
    startedAt: npcIntentSimulationStartedAtIso,
    provider: options.npcSimulationApiConfig?.provider,
    model: options.npcSimulationApiConfig?.model,
  });
  const npcSimulationRequestBudget = options.npcSimulationApiConfig
    ? turnLlmBudget.getAuxiliaryRequestBudget()
    : undefined;
  const npcIntentSimulation = await executeNpcIntentSimulation(worldBook, runtimeState, playerInput, {
      apiConfig: options.npcSimulationApiConfig ?? null,
      llmClient: options.npcSimulationLlmClient ?? options.llmClient,
      memoryContextPackage,
      maxNpcCount: options.npcSimulationMaxNpcCount,
      ...(npcSimulationRequestBudget ?? {}),
    });
  emitProcessingStage({
    stage: 'simulatingNpcs',
    label: '模拟相关 NPC',
    status: npcIntentSimulation.status === 'skipped'
      ? 'skipped'
      : npcIntentSimulation.status === 'failed'
        ? 'failed'
        : 'finished',
    startedAt: npcIntentSimulationStartedAtIso,
    elapsedMs: Date.now() - npcIntentSimulationStartedAt,
    detail: npcIntentSimulation.reason,
    provider: npcIntentSimulation.provider ?? options.npcSimulationApiConfig?.provider,
    model: npcIntentSimulation.model ?? options.npcSimulationApiConfig?.model,
    ...(npcIntentSimulation.usage ? { usage: npcIntentSimulation.usage } : {}),
  });

  const holdingAnnualSettlementPreview = prepareHoldingAnnualSettlement(runtimeState);

  // 3. 组合 prompt（为真实 LLM 预留）
  const promptContext = composePrompt(
    worldBook,
    bookmark,
    timelineAnchors,
    crisis,
    runtimeState,
    playerInput,
    {
      retrievedMemories: memoryVectorRetrieval?.retrievedMemories,
      memoryContextPackage,
      npcIntentPackage: npcIntentSimulation.package,
      holdingAnnualSettlementPreview,
      actionIntent,
      persistentPromptGuide: options.persistentPromptGuide,
    },
  );

  // 4. 获取所在地点名称
  const locationName = getLocationName(worldBook, runtimeState);

  // 5. 调用叙事生成器：有 API 配置时走真实 LLM，否则保留本地模拟兜底。
  const generation = await generateNarratorResponse({
    options,
    emitProcessingStage,
    worldBook,
    runtimeState,
    currentDate: runtimeState.currentDate,
    systemPrompt: promptContext.systemPrompt,
    userPrompt: promptContext.userPrompt,
    adultIntimacyFinalReminder: promptContext.adultIntimacyFinalReminder,
    narrativeProseFinalReview: promptContext.narrativeProseFinalReview,
    narrativeLengthFinalReminder: promptContext.narrativeLengthFinalReminder,
    narrativeLengthContract: promptContext.narrativeLengthContract,
    narrativeLengthRetryEnabled: promptContext.narrativeLengthRetryEnabled,
    stateWriterContext: promptContext.stateWriterContext,
    encounterIntentCreatedAt: promptContext.timestamp,
    turnLlmBudget,
    fallbackContext: {
      bookmarkLabel: bookmark?.label ?? '乱世',
      locationName,
      playerName: runtimeState.player.name,
      playerRole: runtimeState.player.roleType,
      playerPersonalMoney: runtimeState.player.personalMoney ?? 0,
      crisisLabel: crisis?.label ?? '未知危机',
      crisisSummary: crisis?.crisisSummary ?? '身处乱世',
      playerInput,
    },
  });
  const generationElapsedMs = processingStageRecorder.events.find(
    (event) => event.stage === 'generatingNarrative' && event.status === 'finished',
  )?.elapsedMs;
  turnLlmBudget.throwIfExceeded();
  let narratorResponse = generation.response;
  const rawStatePatches = collectStatePatches(narratorResponse);

  let locationPreparation = prepareNarratorLocationWriteback(
    runtimeState,
    narratorResponse.writeback,
    worldBook,
    { statePatches: rawStatePatches },
  );
  const remappedStatePatches = remapNarratorStatePatchLocationReferences(
    rawStatePatches,
    locationPreparation.aliasMap,
  );
  const encounterTransitionDecision = narratorResponse.writeback?.encounterTransitionDecision ?? undefined;
  const encounterStartIntent = narratorResponse.writeback?.encounterStartIntent ?? undefined;
  const semanticProjections = narratorResponse.writeback?.semanticProjections ?? [];
  const encounterPatchGuard = quarantineEncounterTriggerResultPatches(
    remappedStatePatches,
    encounterStartIntent,
  );
  const canonicalStatePatches = encounterPatchGuard.patches;
  locationPreparation = ensureGeneratedStoryLocationReturnRoute(
    runtimeState,
    locationPreparation,
    canonicalStatePatches,
    worldBook,
  );
  narratorResponse = {
    ...narratorResponse,
    writeback: locationPreparation.writeback,
  };

  // 6. 校验 StatePatch
  const npcAwareLocationState = applyAcceptedNpcProfilesForCompliance(
    locationPreparation.state,
    narratorResponse.writeback?.npcProfileSuggestions ?? [],
  );
  let statePatchTransaction = prepareStatePatchTransaction(
    canonicalStatePatches,
    worldBook,
    runtimeState,
    { openingInitialization: options.openingInitialization },
    npcAwareLocationState,
    !encounterStartIntent,
  );
  const rejectedMovementLocationIds = collectRejectedMovementLocationIds(
    canonicalStatePatches,
    statePatchTransaction.sourcePatchIndexes,
    statePatchTransaction.patchValidationResults,
  );
  const preparedLocationIdsBeforeDependencyFiltering = new Set(
    (locationPreparation.writeback?.locationWriteSuggestions ?? [])
      .map((suggestion) => suggestion.locationId?.trim() ?? '')
      .filter(Boolean),
  );
  const locationDependencyRolledBack = [...rejectedMovementLocationIds]
    .some((id) => preparedLocationIdsBeforeDependencyFiltering.has(id));
  const dependencyRollbackLocationErrors = locationDependencyRolledBack
    ? [...locationPreparation.errors]
    : [];
  const dependencyRollbackRouteErrors = locationDependencyRolledBack
    ? [...locationPreparation.routeErrors]
    : [];
  const dependencyRollbackDiagnostics = locationDependencyRolledBack
    ? locationPreparation.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        candidateIds: [...diagnostic.candidateIds],
      }))
    : [];
  if (rejectedMovementLocationIds.size > 0) {
    const dependencySafeWriteback = dropRejectedLocationDependencies(
      narratorResponse.writeback,
      rejectedMovementLocationIds,
    );
    locationPreparation = prepareNarratorLocationWriteback(
      runtimeState,
      dependencySafeWriteback,
      worldBook,
      { statePatches: statePatchTransaction.statePatches },
    );
    locationPreparation = ensureGeneratedStoryLocationReturnRoute(
      runtimeState,
      locationPreparation,
      statePatchTransaction.statePatches,
      worldBook,
    );
    narratorResponse = {
      ...narratorResponse,
      writeback: locationPreparation.writeback,
    };
  }
  const movementPatches = canonicalStatePatches.filter(
    (patch) => normalizeNarratorStatePatch(patch).type === 'locationChange',
  );
  const movementPatchTransaction = prepareStatePatchTransaction(
    movementPatches,
    worldBook,
    runtimeState,
    { openingInitialization: options.openingInitialization },
    locationPreparation.state,
    false,
  );
  const movementDependencyValid = movementPatches.length > 0
    && movementPatchTransaction.patchValidation?.valid === true
    && !locationDependencyRolledBack;
  const {
    statePatches,
    statePatchDraft,
    patchValidationResults,
    patchValidation,
    invalidPatchNotes,
    quarantinedPatchNotes,
    quarantineMode,
  } = statePatchTransaction;
  const statePatchTransactionFailed = statePatches.length > 0 && patchValidation?.valid === false;
  const mapContinuitySalvaged = statePatchTransactionFailed
    && !locationDependencyRolledBack
    && (
      locationPreparation.appliedCount > 0
      || locationPreparation.appliedRouteCount > 0
      || movementDependencyValid
    );
  const failedWritebackBase = mapContinuitySalvaged
    ? movementDependencyValid
      ? movementPatchTransaction.statePatchDraft
      : locationPreparation.state
    : runtimeState;
  const uniqueArtProgressPatchesForSalvage = statePatches.filter((patch, index) => (
    patchValidationResults[index]?.valid === true
    && extractLuanShiCommandFromPatch(patch)?.action === 'recordCharacterUniqueArtProgress'
  ));
  const uniqueArtProgressSalvageTransaction = statePatchTransactionFailed
    && uniqueArtProgressPatchesForSalvage.length > 0
    ? prepareStatePatchTransaction(
        uniqueArtProgressPatchesForSalvage,
        worldBook,
        failedWritebackBase,
        { openingInitialization: options.openingInitialization },
        failedWritebackBase,
        false,
      )
    : undefined;
  const uniqueArtProgressSalvaged = uniqueArtProgressSalvageTransaction?.patchValidation?.valid === true
    ? uniqueArtProgressSalvageTransaction.statePatches.length
    : 0;
  const stateWritebackWarnings = [
    ...quarantinedPatchNotes,
    ...(mapContinuitySalvaged ? invalidPatchNotes : []),
    ...(uniqueArtProgressSalvaged > 0
      ? [`状态批次其余内容回滚，但已独立保留 ${uniqueArtProgressSalvaged} 条绝艺成长事实。`]
      : []),
  ];
  if (encounterStartIntent && statePatchTransactionFailed) {
    const validationDetail = invalidPatchNotes.slice(0, 3).join('；');
    throw new Error(
      'Encounter V2 开战所需状态声明未通过原子校验；本回合未写入'
      + `${validationDetail ? `：${validationDetail}` : ''}`
      + '。请重试或更换更遵守结构化写回的 API。',
    );
  }
  if (encounterStartIntent) {
    assertEncounterReferenceIntegrity(
      statePatchDraft,
      narratorResponse,
      encounterStartIntent,
      true,
    );
  }
  const locationWritebackRolledBack = locationDependencyRolledBack;
  const locationWritebackRollbackMessage = locationDependencyRolledBack
    ? '移动补丁 locationChange 未通过校验，相关新地点与路线依赖组已回滚；其他合法状态已保留。'
    : '因状态补丁校验失败，本回合已准备的地点与路线写回已回滚。';
  const locationWritebackErrors = [
    ...dependencyRollbackLocationErrors,
    ...locationPreparation.errors,
    ...(locationWritebackRolledBack ? [locationWritebackRollbackMessage] : []),
  ];
  const routeWritebackErrors = [
    ...dependencyRollbackRouteErrors,
    ...locationPreparation.routeErrors,
  ];
  const locationWritebackDiagnostics: RuntimeLocationWriteDiagnostic[] = [
    ...dependencyRollbackDiagnostics,
    ...locationPreparation.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      candidateIds: [...diagnostic.candidateIds],
    })),
    ...(locationWritebackRolledBack
      ? [{
          code: 'location-writeback-rolled-back' as const,
          message: locationWritebackRollbackMessage,
          incomingLocationId: [...rejectedMovementLocationIds][0] ?? '',
          candidateIds: [],
        }]
      : []),
  ];

  // 7. 应用 StatePatch
  const turnNumber = runtimeState.turnLog.length + 1;
  let newState = runtimeState;
  const turnDisplayMeta = buildTurnDisplayMeta({
    turnNumber,
    elapsedMs: generationElapsedMs,
    promptTokens: generation.usage?.promptTokens ?? promptContext.estimatedTokens,
    completionTokens: generation.usage?.completionTokens,
    totalTokens: generation.usage?.totalTokens,
    cacheReadTokens: generation.usage?.cacheReadTokens,
    cacheWriteTokens: generation.usage?.cacheWriteTokens,
    cacheMissTokens: generation.usage?.cacheMissTokens,
    rawResponse: generation.rawContent,
    provider: generation.provider,
    model: generation.model,
    npcIntentSimulation,
    promptTokenEstimate: promptContext.runtimeTokenEstimate,
    processingStages: processingStageRecorder.events,
    memoryRecall: memoryContextPackage.memoryRecall,
    narrativeLength: {
      ...evaluateNarrativeLength(
        narratorResponse.narrativeText,
        promptContext.narrativeLengthContract,
      ),
      retryEnabled: promptContext.narrativeLengthRetryEnabled,
      ...generation.narrativeLengthRegeneration,
    },
  });
  turnDisplayMeta.locationWriteback = {
    errors: locationWritebackErrors,
    routeErrors: routeWritebackErrors,
    diagnostics: locationWritebackDiagnostics,
  };

  newState = await runProcessingStage(
    emitProcessingStage,
    'applyingState',
    '应用状态写回',
    {},
    async () => {
      if (statePatches.length > 0 && patchValidation?.valid) {
        const patchedState = finalizeStatePatchDraft(
          statePatchDraft,
          statePatches,
          turnNumber,
          playerInput,
          narratorResponse.narrativeText,
          turnDisplayMeta,
        );
        patchedState.lastPatchValidation = patchValidation ?? undefined;
        return patchedState;
      }
      if (statePatches.length === 0) {
        // 即使没有 patch，也记录回合日志
        const copiedState = JSON.parse(JSON.stringify(locationPreparation.state)) as RuntimeState;
        copiedState.turnLog.push({
          turnNumber,
          date: copiedState.currentDate,
          playerInput,
          narrativeText: summarizeNarrativeText(narratorResponse.narrativeText),
          fullNarrativeText: narratorResponse.narrativeText,
          statePatchSummary: '无状态变更',
          timestamp: new Date().toISOString(),
          displayMeta: turnDisplayMeta,
        });
        return copiedState;
      }
      // 有 patch 但校验失败时，其他状态仍整组回滚；仅独立保留已验证的地图+移动依赖组。
      const continuityBase = uniqueArtProgressSalvaged > 0
        ? uniqueArtProgressSalvageTransaction!.statePatchDraft
        : failedWritebackBase;
      const copiedState = JSON.parse(JSON.stringify(continuityBase)) as RuntimeState;
      copiedState.turnLog.push({
        turnNumber,
        date: copiedState.currentDate,
        playerInput,
        narrativeText: summarizeNarrativeText(narratorResponse.narrativeText),
        fullNarrativeText: narratorResponse.narrativeText,
        statePatchSummary: [
          `状态变更校验失败：${invalidPatchNotes.join('；') || '未知原因'}`,
          uniqueArtProgressSalvaged > 0
            ? `已独立保留 ${uniqueArtProgressSalvaged} 条绝艺成长事实`
            : '',
        ].filter(Boolean).join('；'),
        timestamp: new Date().toISOString(),
        displayMeta: turnDisplayMeta,
      });
      copiedState.lastPatchValidation = patchValidation ?? undefined;
      return copiedState;
    },
  );

  if (locationDependencyRolledBack) {
    appendLocationWritebackRollbackSummary(newState, locationWritebackRollbackMessage);
    appendQuarantinedPeripheralSummary(newState, quarantinedPatchNotes, quarantineMode);
  } else if (statePatchTransactionFailed) {
    if (mapContinuitySalvaged) {
      appendLocationContinuitySalvageSummary(newState);
    } else {
      appendLocationWritebackWarningSummary(newState, locationPreparation);
    }
  } else {
    appendQuarantinedPeripheralSummary(newState, quarantinedPatchNotes, quarantineMode);
  }
  appendEncounterTriggerQuarantineSummary(newState, encounterPatchGuard.removedCount);
  let memorySummary: MemorySummaryExecutionResult | undefined;
  let worldEvolution: RelationshipWorldEvolutionResult | undefined;
  if (!statePatchTransactionFailed) {
    const conflictReferenceSanitization = sanitizeDanglingConflictReferences(
      newState,
      narratorResponse.writeback,
    );
    narratorResponse = {
      ...narratorResponse,
      writeback: conflictReferenceSanitization.writeback,
    };
    const writebackApplication = applyNarratorWriteback(
      newState,
      narratorResponse.writeback,
      worldBook,
      {
        ...options.narratorWritebackOptions,
        preparedLocationWriteback: locationPreparation,
        previousState: runtimeState,
      },
    );
    newState = writebackApplication.state;
    appendNarratorWritebackSummary(newState, writebackApplication);
    appendConflictReferenceWarningSummary(newState, conflictReferenceSanitization.removedConflictIds);
  }

  if (!options.openingInitialization) {
    newState = applyPlayerVitalsAfterTurn(newState, {
      previousState: runtimeState,
      playerInput,
      actionIntent,
      recoveryKind: narratorResponse.writeback?.playerRecoveryKind,
    }).state;
    newState = settlePassiveUniqueArtsAfterRuntimeTurn(newState, runtimeState).state;
  }

  const ordinaryExperienceAwards = options.openingInitialization
    ? []
    : calculateOrdinaryCheckExperienceAwards(
      runtimeState.player.level ?? 1,
      narratorResponse.ordinaryChecks,
      getGameDifficultyProfile(runtimeState.gameDifficulty).difficultyOffset,
    );
  if (ordinaryExperienceAwards.length > 0) {
    const totalExperience = ordinaryExperienceAwards
      .reduce((sum, award) => sum + award.experienceAward, 0);
    const experienceResult = applyPlayerExperience(
      newState.player,
      totalExperience,
      `普通判定 ${ordinaryExperienceAwards.length} 项`,
    );
    newState.player = experienceResult.player;
    const latestTurn = newState.turnLog[newState.turnLog.length - 1];
    if (latestTurn) {
      latestTurn.statePatchSummary = [
        latestTurn.statePatchSummary,
        experienceResult.summary,
      ].filter(Boolean).join('；');
    }
  }

  if (statePatchTransactionFailed) {
    const holdingSettlementApplication = applyHoldingAnnualSettlementRuntime(
      newState,
      holdingAnnualSettlementPreview,
      { previousState: runtimeState },
    );
    newState = holdingSettlementApplication.state;
    if (holdingSettlementApplication.meta) {
      turnDisplayMeta.holdingAnnualSettlement = holdingSettlementApplication.meta;
    }
  } else {
    const settlementTimeline = applyHoldingSettlementTimelineRuntime(
      newState,
      runtimeState,
      holdingAnnualSettlementPreview,
    );
    newState = settlementTimeline.state;
    if (settlementTimeline.annualMeta) {
      turnDisplayMeta.holdingAnnualSettlement = settlementTimeline.annualMeta;
    }
    newState = advanceCorrespondenceState(newState, newState.currentDate).state;
    if (!options.openingInitialization) {
      worldEvolution = await runProcessingStage(
        emitProcessingStage,
        'evolvingWorld',
        '演化关系人物近况',
        {
          provider: options.worldEvolutionApiConfig?.provider,
          model: options.worldEvolutionApiConfig?.model,
        },
        () => executeRelationshipWorldEvolution(worldBook, newState, playerInput, {
          apiConfig: options.worldEvolutionApiConfig ?? null,
          llmClient: options.worldEvolutionLlmClient ?? options.llmClient,
          maxNpcCount: options.worldEvolutionMaxNpcCount,
          excludedNpcIds: npcIntentSimulation.status === 'completed'
            ? npcIntentSimulation.targetNpcIds
            : [],
          signal: options.signal,
        }),
      );
      newState = worldEvolution.state;
      turnDisplayMeta.worldEvolution = {
        status: worldEvolution.status,
        reason: worldEvolution.reason,
        targetNpcIds: [...worldEvolution.targetNpcIds],
        appliedNpcIds: [...worldEvolution.appliedNpcIds],
        provider: worldEvolution.provider,
        model: worldEvolution.model,
        usage: worldEvolution.usage,
      };
    }
    if (!options.deferMemorySummaryCompression) {
      memorySummary = await runPostTurnMemorySummaryCompression(
        newState,
        options,
        emitProcessingStage,
        generation.postNarrativeBudget ?? turnLlmBudget.startPostNarrativeBudget(),
      );
      newState = memorySummary.newState;
    }
  }
  const judgementCards = [
    ...buildOrdinaryJudgementCards(
      narratorResponse.ordinaryChecks,
      Object.fromEntries(ordinaryExperienceAwards.map((award) => [
        award.checkId,
        award.experienceAward,
      ])),
    ),
    ...buildBattleJudgementCards(runtimeState, newState),
  ];
  if (judgementCards.length > 0) {
    turnDisplayMeta.judgementCards = judgementCards;
  }
  turnDisplayMeta.processingStages = processingStageRecorder.events;
  syncLatestTurnSuggestedActions(newState, narratorResponse.suggestedActions);
  syncLatestTurnDisplayMeta(newState, turnDisplayMeta);
  if (encounterStartIntent) {
    assertEncounterReferenceIntegrity(
      newState,
      narratorResponse,
      encounterStartIntent,
      false,
    );
    if (encounterStartIntent.sourceTurnNumber !== newState.turnLog.length) {
      throw new Error(
        `Encounter V2 触发回合 ${encounterStartIntent.sourceTurnNumber} 与原子提交后的回合 ${newState.turnLog.length} 不一致；本回合未写入。`,
      );
    }
  }
  turnLlmBudget.throwIfExceeded();

  // 8. 生成世界快照摘要用于展示
  const worldSnapshot = generateWorldSnapshot(
    worldBook,
    newState.currentDate,
    newState.currentLocationId,
  );

  return {
    narrativeText: narratorResponse.narrativeText,
    suggestedActions: narratorResponse.suggestedActions,
    statePatch: statePatches[0] ?? null,
    statePatches,
    patchValidation,
    newRuntimeState: newState,
    actionIntent,
    promptContext: worldSnapshot.worldSummary,
    narrativeContext: promptContext.narrativeContext,
    stateWriterContext: promptContext.stateWriterContext,
    promptModules: promptContext.modules,
    promptEstimatedTokens: promptContext.estimatedTokens,
    runtimeTokenEstimate: promptContext.runtimeTokenEstimate,
    generationMode: generation.mode,
    generationProvider: generation.provider,
    generationModel: generation.model,
    memoryContextPackage: promptContext.memoryContextPackage,
    memoryVectorRetrieval,
    npcIntentSimulation,
    worldEvolution,
    memorySummary,
    turnDisplayMeta,
    writeback: narratorResponse.writeback,
    locationWritebackDiagnostics,
    locationWritebackErrors,
    routeWritebackErrors,
    stateWritebackWarnings,
    encounterTransitionDecision,
    encounterStartIntent,
    semanticProjections,
  };
}

function appendLocationWritebackRollbackSummary(
  state: RuntimeState,
  message = '因状态补丁校验失败，本回合已准备的地点与路线未写入',
): void {
  const latest = state.turnLog[state.turnLog.length - 1];
  if (!latest) return;
  latest.statePatchSummary = [
    latest.statePatchSummary,
    `地图写回回滚：${message}`,
  ].filter(Boolean).join('；');
}

function appendLocationContinuitySalvageSummary(state: RuntimeState): void {
  const latest = state.turnLog[state.turnLog.length - 1];
  if (!latest) return;
  latest.statePatchSummary = [
    latest.statePatchSummary,
    '地图与移动依赖组已独立保留，其他未通过校验的状态仍整组回滚',
  ].filter(Boolean).join('；');
}

function appendLocationWritebackWarningSummary(
  state: RuntimeState,
  preparation: NarratorLocationWritebackPreparation,
): void {
  const locationCount = preparation.errors.length;
  const routeCount = preparation.routeErrors.length;
  if (locationCount + routeCount === 0) return;
  const latest = state.turnLog[state.turnLog.length - 1];
  if (!latest) return;
  latest.statePatchSummary = [
    latest.statePatchSummary,
    `地图写回警告：${locationCount} 条地点建议、${routeCount} 条路线建议未写入`,
  ].filter(Boolean).join('；');
}

function syncLatestTurnDisplayMeta(state: RuntimeState, displayMeta: TurnDisplayMeta): void {
  const latestLog = state.turnLog[state.turnLog.length - 1];
  if (!latestLog) return;
  latestLog.displayMeta = {
    ...latestLog.displayMeta,
    ...displayMeta,
  };
}

async function runPostTurnMemorySummaryCompression(
  state: RuntimeState,
  options: TurnExecutionOptions,
  emitProcessingStage?: TurnProcessingStageEmitter,
  postNarrativeBudget?: PostNarrativeLlmBudget,
): Promise<MemorySummaryExecutionResult> {
  const memorySummaryApiTaskId = options.memorySummaryApiTaskId
    ?? (options.memorySummaryApiConfig ? 'memorySummary' : options.apiConfig ? 'mainNarrative' : undefined);
  const apiConfig = options.memorySummaryApiConfig ?? options.apiConfig ?? null;
  const stageStartedAt = Date.now();
  emitProcessingStage?.({
    stage: 'compressingMemory',
    label: '整理到阈值记忆',
    status: 'started',
    provider: apiConfig?.provider,
    model: apiConfig?.model,
  });

  try {
    const requestBudget = apiConfig ? postNarrativeBudget?.getChildRequestBudget() : undefined;
    const result = await executeMemorySummaryCompression(state, {
      apiConfig,
      llmClient: options.memorySummaryLlmClient ?? options.llmClient,
      ...(requestBudget ?? { signal: options.signal }),
    }, memorySummaryApiTaskId);
    appendMemorySummaryExecutionSummary(result.newState, result);
    emitProcessingStage?.({
      stage: 'compressingMemory',
      label: '整理到阈值记忆',
      status: result.status === 'skipped' ? 'skipped' : result.status === 'failed' ? 'failed' : 'finished',
      elapsedMs: Date.now() - stageStartedAt,
      detail: result.reason,
      provider: apiConfig?.provider,
      model: apiConfig?.model,
      ...(result.usage ? { usage: result.usage } : {}),
    });
    return result;
  } catch (error) {
    rethrowIfTurnCancelled(error, options.signal);
    const failed: MemorySummaryExecutionResult = {
      status: 'failed',
      reason: getErrorMessage(error),
      newState: state,
      appliedSummaries: [],
      ignoredSummaries: [],
      sourceRecentTurnCount: 0,
      keptRecentTurnCount: 0,
      apiTaskId: memorySummaryApiTaskId,
    };
    appendMemorySummaryExecutionSummary(state, failed);
    emitProcessingStage?.({
      stage: 'compressingMemory',
      label: '整理到阈值记忆',
      status: 'failed',
      elapsedMs: Date.now() - stageStartedAt,
      detail: failed.reason,
      provider: apiConfig?.provider,
      model: apiConfig?.model,
    });
    return failed;
  }
}

function collectStatePatches(response: NarratorResponse): StatePatch[] {
  if (response.statePatches && response.statePatches.length > 0) {
    return response.statePatches;
  }
  return response.statePatch ? [response.statePatch] : [];
}

interface StructuredScenePresenceRoster {
  locationId: string;
  presentNpcIds: string[];
}

function findLatestLocationTransition(patches: StatePatch[]): {
  patchIndex: number;
  targetLocationId: string;
} | null {
  for (let patchIndex = patches.length - 1; patchIndex >= 0; patchIndex -= 1) {
    const patch = patches[patchIndex];
    if (patch.type !== 'locationChange') continue;
    const toSceneId = typeof patch.payload?.toSceneId === 'string'
      ? patch.payload.toSceneId.trim()
      : '';
    const toLocationId = typeof patch.payload?.toLocationId === 'string'
      ? patch.payload.toLocationId.trim()
      : '';
    const targetLocationId = toSceneId || toLocationId;
    if (targetLocationId) return { patchIndex, targetLocationId };
  }
  return null;
}

function readRecordTurnEventSceneRoster(
  patches: StatePatch[],
  startIndex: number,
): StructuredScenePresenceRoster | null {
  for (let patchIndex = patches.length - 1; patchIndex >= startIndex; patchIndex -= 1) {
    const command = extractLuanShiCommandFromPatch(patches[patchIndex]);
    if (command?.action !== 'recordTurnEvent') continue;
    const locationId = typeof command.locationId === 'string' ? command.locationId.trim() : '';
    if (!locationId || !Array.isArray(command.presentNpcIds)) continue;
    return {
      locationId,
      presentNpcIds: [...new Set(
        command.presentNpcIds
          .filter((npcId): npcId is string => typeof npcId === 'string')
          .map((npcId) => npcId.trim())
          .filter(Boolean),
      )],
    };
  }
  return null;
}

function resolveStructuredScenePresenceRoster(
  response: NarratorResponse,
  patches: StatePatch[],
): StructuredScenePresenceRoster | null {
  const transition = findLatestLocationTransition(patches);
  const summaryRoster = response.writeback?.turnSummary?.scenePresence;
  if (summaryRoster) {
    return {
      locationId: transition?.targetLocationId ?? summaryRoster.locationId,
      presentNpcIds: [...new Set(summaryRoster.presentNpcIds)],
    };
  }
  return readRecordTurnEventSceneRoster(
    patches,
    transition ? transition.patchIndex + 1 : 0,
  );
}

function requiresScenePresenceWritebackReview(response: NarratorResponse): boolean {
  const patches = collectStatePatches(response);
  const transition = findLatestLocationTransition(patches);
  if (!transition) return false;
  if (response.writeback?.turnSummary?.scenePresence) return false;
  if (readRecordTurnEventSceneRoster(patches, transition.patchIndex + 1)) return false;

  return !patches.slice(transition.patchIndex + 1).some((patch) => {
    const command = extractLuanShiCommandFromPatch(patch);
    return (
      (command?.action === 'updateNpcPresence' || command?.action === 'upsertNpcProfile')
      && command.isPresent === true
      && typeof command.npcId === 'string'
      && command.npcId.trim().length > 0
    );
  });
}

/**
 * Materializes only explicit structured facts emitted by the narrator.
 * No prose scanning or keyword inference is performed here.
 */
function materializeStructuredTurnSummaryStatePatches(
  response: NarratorResponse,
  runtimeState: RuntimeState,
  currentDate: string,
): NarratorResponse {
  const turnSummary = response.writeback?.turnSummary;
  const patches = collectStatePatches(response).map((patch) => ({ ...patch }));
  const scenePresenceRoster = resolveStructuredScenePresenceRoster(response, patches);
  if (!turnSummary && !scenePresenceRoster) return response;

  let changed = false;
  const pendingNpcIds = new Set<string>();
  const pendingNpcNames = new Set<string>();
  const registerPendingNpc = (npcId: unknown, name: unknown) => {
    if (typeof npcId === 'string' && npcId.trim()) pendingNpcIds.add(npcId.trim());
    if (typeof name === 'string' && name.trim()) pendingNpcNames.add(name.trim());
  };
  for (const fact of turnSummary?.npcAdmissions ?? []) registerPendingNpc(fact.npcId, fact.name);
  for (const profile of response.writeback?.npcProfileSuggestions ?? []) registerPendingNpc(profile.npcId, profile.name);
  for (const patch of patches) {
    const command = extractLuanShiCommandFromPatch(patch);
    if (command?.action === 'upsertNpcProfile') registerPendingNpc(command.npcId, command.name);
  }
  for (const npc of runtimeState.npcs ?? []) {
    pendingNpcIds.delete(npc.npcId);
    pendingNpcNames.delete(npc.name);
  }

  for (const fact of turnSummary?.identityChanges ?? []) {
    const target = fact.characterType === 'player'
      ? runtimeState.player
      : (runtimeState.npcs ?? []).find((npc) => npc.npcId === fact.characterId);
    if (!target || !structuredIdentityFactChangesTarget(fact, target)) continue;

    const canonicalCharacterId = fact.characterType === 'player' ? runtimeState.player.id : fact.characterId;
    const canonicalCharacterName = target.name;
    const matchingIndex = patches.findIndex((patch) => {
      const command = extractLuanShiCommandFromPatch(patch);
      if (command?.action !== 'updateCharacterIdentity') return false;
      if (fact.characterType === 'player') {
        return command.characterType === 'player'
          || command.characterId === 'player'
          || command.characterId === runtimeState.player.id;
      }
      return command.characterId === fact.characterId;
    });
    const existingCommand = matchingIndex >= 0
      ? extractLuanShiCommandFromPatch(patches[matchingIndex])
      : undefined;
    const command: Record<string, unknown> = {
      ...(existingCommand ?? {}),
      action: 'updateCharacterIdentity',
      characterType: fact.characterType,
      characterId: canonicalCharacterId,
      characterName: canonicalCharacterName,
      currentIdentity: fact.currentIdentity,
      currentIdentityDescription: fact.currentIdentityDescription,
      identitySummary: fact.identitySummary,
    };
    for (const field of [
      'factionId',
      'factionName',
      'allegianceTarget',
      'officeTitle',
      'militaryTitle',
      'nobleTitle',
    ] as const) {
      if (Object.prototype.hasOwnProperty.call(fact, field)) command[field] = fact[field];
    }
    if (fact.characterType === 'player' && fact.personalEscortEntitlement) {
      command.personalEscortEntitlement = {
        ...fact.personalEscortEntitlement,
        updatedAt: currentDate,
      };
    }

    const materializedPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: matchingIndex >= 0 && patches[matchingIndex].reason.trim()
        ? patches[matchingIndex].reason
        : `结构化身份事实：${fact.sourceRefId}（${fact.summary}）`,
      payload: { command },
    } as StatePatch;
    if (matchingIndex >= 0) patches[matchingIndex] = materializedPatch;
    else patches.push(materializedPatch);
    changed = true;
  }

  for (const fact of turnSummary?.relationshipAdmissions ?? []) {
    if (fact.relationshipKind === 'heroine') {
      const npc = (runtimeState.npcs ?? []).find((item) => item.npcId === fact.npcId);
      if (!npc || (runtimeState.heroineThreads ?? []).some((thread) => thread.npcId === npc.npcId)) continue;
      const heroineThreadId = buildStructuredRelationshipThreadId('heroine', [npc.npcId]);
      const matchingIndex = patches.findIndex((patch) => {
        const command = extractLuanShiCommandFromPatch(patch);
        return command?.action === 'upsertHeroineThread'
          && (command.heroineThreadId === heroineThreadId || command.npcId === npc.npcId);
      });
      const existingCommand = matchingIndex >= 0
        ? extractLuanShiCommandFromPatch(patches[matchingIndex])
        : undefined;
      const command: Record<string, unknown> = {
        ...(existingCommand ?? {}),
        action: 'upsertHeroineThread',
        heroineThreadId,
        npcId: npc.npcId,
        npcName: npc.name,
        status: 'active',
        stage: fact.stage,
        relationshipRole: fact.relationshipRole,
        summary: fact.summary,
        source: fact.source ?? `结构化关系事实：${fact.sourceRefId}`,
      };
      for (const field of ['currentPull', 'riskNotes', 'promiseNotes'] as const) {
        if (fact[field] !== undefined) command[field] = fact[field];
      }
      const materializedPatch: StatePatch = {
        type: 'luanshiCommand',
        reason: matchingIndex >= 0 && patches[matchingIndex].reason.trim()
          ? patches[matchingIndex].reason
          : `结构化红颜关系事实：${fact.sourceRefId}（${fact.summary}）`,
        payload: { command },
      } as StatePatch;
      if (matchingIndex >= 0) patches[matchingIndex] = materializedPatch;
      else patches.push(materializedPatch);
      changed = true;
      continue;
    }

    const suppliedNpcIds = [...new Set(fact.targetNpcIds ?? [])];
    const suppliedIdsAreValid = suppliedNpcIds.length > 0
      && suppliedNpcIds.every((npcId) => (runtimeState.npcs ?? []).some((npc) => npc.npcId === npcId));
    const exactResolvedNpcIds = resolveBondTargetNpcIdsByExactName(
      fact.targetNames,
      runtimeState.npcs ?? [],
    );
    const targetNpcIds = suppliedIdsAreValid ? suppliedNpcIds : exactResolvedNpcIds;
    const waitsForSameTurnNpc = targetNpcIds.length === 0 && (
      suppliedNpcIds.some((npcId) => pendingNpcIds.has(npcId))
      || fact.targetNames.some((name) => pendingNpcNames.has(name))
    );
    if (waitsForSameTurnNpc) continue;
    const stableTargets = targetNpcIds.length > 0 ? targetNpcIds : fact.targetNames;
    const existingBond = (runtimeState.bondThreads ?? []).find((thread) => (
      thread.bondType === fact.bondType
      && sameStableStringSet(
        thread.targetNpcIds?.length ? thread.targetNpcIds : thread.targetNames,
        stableTargets,
      )
    ));
    if (existingBond) continue;

    const bondThreadId = buildStructuredRelationshipThreadId('bond', [fact.bondType, ...stableTargets]);
    const matchingIndex = patches.findIndex((patch) => {
      const command = extractLuanShiCommandFromPatch(patch);
      return command?.action === 'upsertBondThread' && command.bondThreadId === bondThreadId;
    });
    const existingCommand = matchingIndex >= 0
      ? extractLuanShiCommandFromPatch(patches[matchingIndex])
      : undefined;
    const command: Record<string, unknown> = {
      ...(existingCommand ?? {}),
      action: 'upsertBondThread',
      bondThreadId,
      targetNames: fact.targetNames,
      ...(targetNpcIds.length > 0 ? { targetNpcIds } : {}),
      bondType: fact.bondType,
      status: 'active',
      summary: fact.summary,
      source: fact.source ?? `结构化关系事实：${fact.sourceRefId}`,
    };
    for (const field of ['currentTension', 'promiseNotes', 'conflictNotes'] as const) {
      if (fact[field] !== undefined) command[field] = fact[field];
    }
    const materializedPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: matchingIndex >= 0 && patches[matchingIndex].reason.trim()
        ? patches[matchingIndex].reason
        : `结构化羁绊关系事实：${fact.sourceRefId}（${fact.summary}）`,
      payload: { command },
    } as StatePatch;
    if (matchingIndex >= 0) patches[matchingIndex] = materializedPatch;
    else patches.push(materializedPatch);
    changed = true;
  }

  const persistedPrivateAssetSources = new Set(
    (runtimeState.privateAssets ?? [])
      .map((asset) => asset.acquisition?.sourceRefId?.trim())
      .filter((sourceRefId): sourceRefId is string => Boolean(sourceRefId)),
  );
  for (const fact of turnSummary?.privateAssetAcquisitions ?? []) {
    if (persistedPrivateAssetSources.has(fact.sourceRefId)) continue;
    if (!canMaterializePrivateAssetAcquisitionFact(fact, runtimeState)) continue;

    const matchingIndex = patches.findIndex((patch) => {
      const command = extractLuanShiCommandFromPatch(patch);
      if (command?.action !== 'upsertPrivateAsset') return false;
      if (command.privateAssetId === fact.privateAssetId) return true;
      return command.acquisition?.sourceRefId === fact.sourceRefId;
    });
    const existingCommand = matchingIndex >= 0
      ? extractLuanShiCommandFromPatch(patches[matchingIndex])
      : undefined;
    const command: Record<string, unknown> = {
      ...(existingCommand ?? {}),
      action: 'upsertPrivateAsset',
      operation: 'create',
      privateAssetId: fact.privateAssetId,
      name: fact.assetName,
      type: fact.type,
      ownerScope: fact.ownerScope,
      status: fact.status,
      summary: fact.summary,
      acquisition: {
        kind: fact.kind,
        occurredAt: currentDate,
        sourceRefId: fact.sourceRefId,
        summary: fact.summary,
        ...(fact.costMoney !== undefined ? { costMoney: fact.costMoney } : {}),
        ...(fact.costGrain !== undefined ? { costGrain: fact.costGrain } : {}),
      },
    };
    for (const field of [
      'locationId',
      'locationDescription',
      'managerNpcId',
      'mu',
      'households',
      'workers',
      'workshopScale',
      'ranchCapacity',
    ] as const) {
      if (fact[field] !== undefined) command[field] = fact[field];
    }
    if (typeof command.updatedAt !== 'string' || !command.updatedAt.trim()) delete command.updatedAt;

    const materializedPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: matchingIndex >= 0 && patches[matchingIndex].reason.trim()
        ? patches[matchingIndex].reason
        : `结构化私产取得事实：${fact.sourceRefId}（${fact.summary}）`,
      payload: { command },
    } as StatePatch;
    if (matchingIndex >= 0) patches[matchingIndex] = materializedPatch;
    else patches.push(materializedPatch);
    changed = true;
  }

  if (scenePresenceRoster) {
    const knownNpcIds = new Set((runtimeState.npcs ?? []).map((npc) => npc.npcId));
    const explicitlyUpdatedNpcIds = new Set<string>();
    for (const patch of patches) {
      const command = extractLuanShiCommandFromPatch(patch);
      if (command?.action !== 'updateNpcPresence' && command?.action !== 'upsertNpcProfile') continue;
      if (typeof command.npcId === 'string' && command.npcId.trim()) {
        explicitlyUpdatedNpcIds.add(command.npcId.trim());
      }
    }
    for (const npcId of scenePresenceRoster.presentNpcIds) {
      if (!knownNpcIds.has(npcId) || explicitlyUpdatedNpcIds.has(npcId)) continue;
      patches.push({
        type: 'luanshiCommand',
        reason: `结构化场景在场名单：${npcId} 位于 ${scenePresenceRoster.locationId}`,
        payload: {
          command: {
            action: 'updateNpcPresence',
            npcId,
            locationId: scenePresenceRoster.locationId,
            isPresent: true,
          },
        },
      } as StatePatch);
      changed = true;
    }
  }

  return changed
    ? {
        ...response,
        statePatches: patches,
        statePatch: null,
      }
    : response;
}

function buildStructuredRelationshipThreadId(kind: 'heroine' | 'bond', parts: string[]): string {
  const fingerprint = stableRelationshipFactFingerprint(
    [kind, ...parts.map((part) => part.trim()).sort()].join('|'),
  );
  return `${kind === 'heroine' ? 'heroine' : 'bond'}_${fingerprint}`;
}

function stableRelationshipFactFingerprint(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return `${(first >>> 0).toString(36).padStart(7, '0')}${(second >>> 0).toString(36).padStart(7, '0')}`;
}

function sameStableStringSet(left: readonly string[], right: readonly string[]): boolean {
  const normalize = (values: readonly string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function structuredIdentityFactChangesTarget(
  fact: NonNullable<NonNullable<NarratorWritebackProtocol['turnSummary']>['identityChanges']>[number],
  target: RuntimeState['player'] | NonNullable<RuntimeState['npcs']>[number],
): boolean {
  if (target.currentIdentity !== fact.currentIdentity) return true;
  if (target.currentIdentityDescription !== fact.currentIdentityDescription) return true;
  if (target.identitySummary !== fact.identitySummary) return true;
  for (const field of [
    'factionId',
    'factionName',
    'allegianceTarget',
    'officeTitle',
    'militaryTitle',
    'nobleTitle',
  ] as const) {
    if (
      Object.prototype.hasOwnProperty.call(fact, field)
      && (target[field] ?? null) !== (fact[field] ?? null)
    ) return true;
  }
  if (fact.characterType === 'player' && fact.personalEscortEntitlement) {
    const current = runtimeEscortFingerprint(
      'personalEscortEntitlement' in target ? target.personalEscortEntitlement : undefined,
    );
    const next = runtimeEscortFingerprint(fact.personalEscortEntitlement);
    if (current !== next) return true;
  }
  return false;
}

function runtimeEscortFingerprint(
  value: { status: 'none' | 'customary'; bases: readonly string[] } | null | undefined,
): string {
  return value ? `${value.status}:${[...value.bases].sort().join(',')}` : 'missing';
}

function canMaterializePrivateAssetAcquisitionFact(
  fact: NonNullable<NonNullable<NarratorWritebackProtocol['turnSummary']>['privateAssetAcquisitions']>[number],
  runtimeState: RuntimeState,
): boolean {
  if (!fact.privateAssetId || !fact.type || !fact.ownerScope || !fact.status) return false;
  if ((runtimeState.privateAssets ?? []).some((asset) => asset.privateAssetId === fact.privateAssetId)) return false;
  if (
    (fact.kind === 'purchase' || fact.kind === 'construction')
    && (fact.costMoney ?? 0) <= 0
    && (fact.costGrain ?? 0) <= 0
  ) return false;
  return true;
}

function requiresPrivateAssetAcquisitionWritebackReview(
  runtimeState: RuntimeState,
  response: NarratorResponse,
): boolean {
  const facts = response.writeback?.turnSummary?.privateAssetAcquisitions ?? [];
  if (facts.length === 0) return false;

  const persistedSourceRefIds = new Set(
    (runtimeState.privateAssets ?? [])
      .map((asset) => asset.acquisition?.sourceRefId?.trim())
      .filter((sourceRefId): sourceRefId is string => Boolean(sourceRefId)),
  );
  const patchedSourceRefIds = new Set<string>();
  for (const patch of collectStatePatches(response)) {
    if (patch.type !== 'luanshiCommand' || !isPlainRecord(patch.payload)) continue;
    const nestedCommand = patch.payload.command;
    const command = isPlainRecord(nestedCommand)
      ? nestedCommand
      : typeof patch.payload.action === 'string'
        ? patch.payload
        : undefined;
    if (command?.action !== 'upsertPrivateAsset' || !isPlainRecord(command.acquisition)) continue;
    const sourceRefId = command.acquisition.sourceRefId;
    if (typeof sourceRefId === 'string' && sourceRefId.trim()) {
      patchedSourceRefIds.add(sourceRefId.trim());
    }
  }

  return facts.some((fact) => (
    !persistedSourceRefIds.has(fact.sourceRefId)
    && !patchedSourceRefIds.has(fact.sourceRefId)
  ));
}

const PLAYER_MONEY_WRITEBACK_REVIEW_PATTERN =
  /购买|买下|出售|卖出|支付|付给|付出|花费|酬劳|赏钱|收款|进账|领取军饷|个人军饷|存入|取出|提款|存款|退钱|退款/;
const PLAYER_INVENTORY_WRITEBACK_REVIEW_PATTERN =
  /获得|取得|领取|收下|收走|购买|买下|捡到|缴获|入手|出售|卖出|卖给|消耗|使用|服用|吃下|喝下|交出|交给|交回|收回|赠予|赠送|送出|遗失|丢失|损毁|毁坏|过期|兑付|兑现|提取/;
const PLAYER_INVENTORY_LIFECYCLE_WRITEBACK_REVIEW_PATTERN =
  /出售|卖出|卖给|收走|收下|消耗|服用|吃下|喝下|交出|交给|交回|收回|赠予|赠送|送出|遗失|丢失|损毁|毁坏|过期|兑付|兑现|提取/;
const PLAYER_INVENTORY_ACQUISITION_WRITEBACK_REVIEW_PATTERN =
  /获得|取得|领取|收下|购买|买下|捡到|缴获|入手/;
const PLAYER_INVENTORY_DESTRUCTIVE_SCOPE_DIAGNOSTIC_PREFIX =
  '主角物品破坏范围越界：';

class PlayerInventoryScopeReviewError extends Error {
  constructor() {
    super('主角物品写回范围复核未能排除对未点名物品的破坏性修改，本回合未提交，请重试。');
    this.name = 'PlayerInventoryScopeReviewError';
  }
}

function requiresPlayerEconomyWritebackReview(
  runtimeState: RuntimeState,
  response: NarratorResponse,
): boolean {
  // Only completed facts in the final narrative can justify a focused review.
  // The player's input is an intention and may have failed or remained pending.
  const text = response.narrativeText;
  const commands = collectStatePatches(response)
    .map((patch) => extractLuanShiCommandFromPatch(patch))
    .filter((command): command is LuanShiCommand => Boolean(command));
  const playerLoadoutCommands = commands.filter((command): command is Extract<LuanShiCommand, { action: 'updatePlayerLoadout' }> => (
    command.action === 'updatePlayerLoadout'
  ));
  const hasMoneyWriteback = playerLoadoutCommands.some((command) => (
    command.personalMoney !== undefined || command.personalMoneyDelta !== undefined
  ));
  const narrativeClauses = splitPlayerEconomyReviewClauses(text);
  const playerReferences = ['你', '主角', runtimeState.player.name.trim()].filter(Boolean);
  const hasCompletedPersonalMoneyFact = narrativeClauses.some((clause) => (
    PLAYER_MONEY_WRITEBACK_REVIEW_PATTERN.test(clause)
    && playerReferences.some((reference) => clause.includes(reference))
    && (
      /[0-9零〇一二两三四五六七八九十百千万]+\s*(?:钱|文|贯|金)/.test(clause)
      || /个人钱财|私囊|腰包|私钱|军饷/.test(clause)
    )
  ));
  if (hasCompletedPersonalMoneyFact && !hasMoneyWriteback) {
    return true;
  }

  if (!PLAYER_INVENTORY_WRITEBACK_REVIEW_PATTERN.test(text)) return false;
  const touchedInventoryIds = new Set<string>();
  let hasAnyInventoryWriteback = false;
  for (const command of playerLoadoutCommands) {
    if (Array.isArray(command.inventory)) hasAnyInventoryWriteback = true;
    for (const change of command.inventoryChanges ?? []) {
      hasAnyInventoryWriteback = true;
      if (change.action === 'upsert') {
        touchedInventoryIds.add(change.item.id);
        const normalizedName = normalizeInventoryIdentityName(change.item.name);
        const matchingExistingItems = (runtimeState.player.inventory ?? []).filter((item) => (
          normalizeInventoryIdentityName(item.name) === normalizedName
          && areInventoryIdentityCategoriesCompatible(item.category, change.item.category)
        ));
        if (normalizedName && matchingExistingItems.length === 1) {
          touchedInventoryIds.add(matchingExistingItems[0].id);
        }
      } else {
        touchedInventoryIds.add(change.itemId);
      }
    }
  }

  const currentInventory = runtimeState.player.inventory ?? [];
  const itemMentionTokens = buildUniqueInventoryMentionTokens(currentInventory);
  const namedExistingItems = currentInventory.filter((item) => narrativeClauses.some((clause) => (
    clauseMentionsInventoryItem(clause, item, itemMentionTokens)
  )));
  if (namedExistingItems.some((item) => (
    !touchedInventoryIds.has(item.id)
    && narrativeClauses.some((clause) => (
      clauseMentionsInventoryItem(clause, item, itemMentionTokens)
      && (
        PLAYER_INVENTORY_LIFECYCLE_WRITEBACK_REVIEW_PATTERN.test(clause)
        || (item.category === 'consumable' && /使用|用掉|用尽/.test(clause))
      )
    ))
  ))) {
    return true;
  }

  const acquisitionWithoutExistingItem = narrativeClauses.some((clause) => (
    PLAYER_INVENTORY_ACQUISITION_WRITEBACK_REVIEW_PATTERN.test(clause)
    && playerReferences.some((reference) => clause.includes(reference))
    && !/粮草|军粮|军械|军需|府库|粮仓|部队|全军/.test(clause)
  )) && namedExistingItems.length === 0;
  return acquisitionWithoutExistingItem && !hasAnyInventoryWriteback;
}

function splitPlayerEconomyReviewClauses(text: string): string[] {
  return text
    .split(/[。！？!?；;\r\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function buildUniqueInventoryMentionTokens(
  inventory: NonNullable<RuntimeState['player']['inventory']>,
): Map<string, Set<string>> {
  const tokenOwners = new Map<string, Set<string>>();
  for (const item of inventory) {
    const normalizedName = item.name.replace(/\s+/g, '');
    for (let index = 0; index < normalizedName.length - 1; index += 1) {
      const token = normalizedName.slice(index, index + 2);
      if (!/[\p{Script=Han}]{2}/u.test(token)) continue;
      const owners = tokenOwners.get(token) ?? new Set<string>();
      owners.add(item.id);
      tokenOwners.set(token, owners);
    }
  }

  const result = new Map<string, Set<string>>();
  for (const item of inventory) {
    const tokens = new Set<string>();
    for (const [token, owners] of tokenOwners) {
      if (owners.size === 1 && owners.has(item.id)) tokens.add(token);
    }
    result.set(item.id, tokens);
  }
  return result;
}

function clauseMentionsInventoryItem(
  clause: string,
  item: NonNullable<RuntimeState['player']['inventory']>[number],
  itemMentionTokens: Map<string, Set<string>>,
): boolean {
  const normalizedName = item.name.trim();
  if (normalizedName && clause.includes(normalizedName)) return true;
  return [...(itemMentionTokens.get(item.id) ?? [])].some((token) => clause.includes(token));
}

function buildPlayerInventoryDestructiveScopeDiagnostics(
  runtimeState: RuntimeState,
  playerInput: string,
  response: NarratorResponse,
): StatePatchValidationDiagnostic[] {
  const currentInventory = runtimeState.player.inventory ?? [];
  const explicitlyNamedIds = new Set(
    currentInventory
      .filter((item) => item.name.trim().length > 0 && playerInput.includes(item.name))
      .map((item) => item.id),
  );
  if (explicitlyNamedIds.size === 0) return [];

  const currentById = new Map(currentInventory.map((item) => [item.id, item]));
  return collectStatePatches(response).flatMap((patch, patchIndex) => {
    const command = extractLuanShiCommandFromPatch(patch);
    if (command?.action !== 'updatePlayerLoadout') return [];

    const unexpectedTargets = new Set<string>();
    for (const change of command.inventoryChanges ?? []) {
      if (change.action === 'upsert') continue;
      const existing = currentById.get(change.itemId);
      if (!existing || explicitlyNamedIds.has(existing.id)) continue;
      const destructive = change.action === 'remove'
        || (
          change.action === 'setQuantity'
          && Number.isFinite(change.quantity)
          && change.quantity < existing.quantity
        );
      if (destructive) unexpectedTargets.add(`${existing.id}（${existing.name}）`);
    }
    if (unexpectedTargets.size === 0) return [];

    return [{
      patchIndex,
      patchType: patch.type,
      commandAction: command.action,
      errors: [
        `${PLAYER_INVENTORY_DESTRUCTIVE_SCOPE_DIAGNOSTIC_PREFIX}本回合玩家明确点名的现存物品范围为 ${[...explicitlyNamedIds].join('、')}，但该命令还破坏性修改了未点名物品 ${[...unexpectedTargets].join('、')}。必须由 LLM 结合玩家行动与最终正文逐项复核，并从同一 updatePlayerLoadout 槽位移除所有未被玩家行动明确点名的破坏性修改；不能因同属手令、凭证、文书或名称相似而批量移除。若正文把玩家未操作的其他物品概括成已经核销、交出或消耗，也必须最小修正该错误叙述。`,
      ],
      warnings: [],
    }];
  });
}

function hasPlayerInventoryDestructiveScopeDiagnostic(
  diagnostics: StatePatchValidationDiagnostic[],
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.errors.some((error) => (
    error.startsWith(PLAYER_INVENTORY_DESTRUCTIVE_SCOPE_DIAGNOSTIC_PREFIX)
  )));
}

const optionalIdentityFields = [
  'name',
  'courtesyName',
  'artName',
  'aliases',
  'commonAddress',
  'birthOrigin',
  'birthOriginDescription',
  'currentIdentity',
  'currentIdentityDescription',
  'factionId',
  'factionName',
  'allegianceTarget',
  'officeTitle',
  'militaryTitle',
  'nobleTitle',
  'identitySummary',
  'appearance',
  'personality',
];

const optionalLoadoutFields = [
  'personalMoney',
  'personalMoneyDelta',
  'equipment',
  'equipmentChanges',
  'inventory',
  'inventoryChanges',
  'summary',
];

interface PreparedNarratorStatePatch {
  patch: StatePatch;
  sourcePatchIndex: number;
}

function normalizeNarratorStatePatch(patch: StatePatch): StatePatch {
  return normalizeStatePatchContract(normalizeLuanShiCommandPatch(patch));
}

type PlayerInventoryItem = NonNullable<RuntimeState['player']['inventory']>[number];

/**
 * Keeps narrator writeback on the inventory's existing stable identity.
 *
 * This does not infer whether prose acquired or consumed an item. It only
 * prevents a unique, exactly named existing item from becoming a second item
 * because the narrator invented a different ID for an upsert.
 */
function canonicalizeNarratorPlayerInventoryItemIds(
  patches: StatePatch[],
  runtimeState: RuntimeState,
): StatePatch[] {
  let workingInventory = (runtimeState.player.inventory ?? []).map((item) => ({ ...item }));

  return patches.map((sourcePatch) => {
    const patch = normalizeLuanShiCommandPatch(sourcePatch);
    const command = extractLuanShiCommandFromPatch(patch);
    if (command?.action !== 'updatePlayerLoadout') return sourcePatch;

    if (Array.isArray(command.inventory)) {
      workingInventory = command.inventory.map((item) => ({ ...item }));
    }
    if (!Array.isArray(command.inventoryChanges)) return sourcePatch;

    let changed = false;
    const inventoryChanges = command.inventoryChanges.map((change) => {
      if (change.action === 'upsert' && change.item && typeof change.item === 'object') {
        const item = canonicalizeInventoryUpsertItem(change.item, workingInventory);
        changed ||= item.id !== change.item.id;
        applyInventoryChangeToIdentityContext(workingInventory, { ...change, item });
        return item === change.item ? change : { ...change, item };
      }

      applyInventoryChangeToIdentityContext(workingInventory, change);
      return change;
    });

    if (!changed) return sourcePatch;
    return {
      ...patch,
      payload: {
        ...patch.payload,
        command: {
          ...command,
          inventoryChanges,
        },
      },
    };
  });
}

function canonicalizeInventoryUpsertItem(
  item: PlayerInventoryItem,
  currentInventory: PlayerInventoryItem[],
): PlayerInventoryItem {
  const incomingId = typeof item.id === 'string' ? item.id.trim() : '';
  if (incomingId && currentInventory.some((existing) => existing.id === incomingId)) {
    return item;
  }

  const normalizedName = normalizeInventoryIdentityName(item.name);
  if (!normalizedName) return item;
  const matches = currentInventory.filter((existing) => (
    normalizeInventoryIdentityName(existing.name) === normalizedName
    && areInventoryIdentityCategoriesCompatible(existing.category, item.category)
  ));
  if (matches.length !== 1) return item;

  return {
    ...item,
    id: matches[0].id,
  };
}

function normalizeInventoryIdentityName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000·•・—–‐\-_:：,，.。;；、'"“”‘’《》〈〉（）()【】[\]]+/g, '');
}

function areInventoryIdentityCategoriesCompatible(
  existingCategory: PlayerInventoryItem['category'],
  incomingCategory: PlayerInventoryItem['category'],
): boolean {
  const existing = existingCategory?.trim().toLowerCase();
  const incoming = incomingCategory?.trim().toLowerCase();
  if (!existing || !incoming || existing === incoming) return true;
  return existing !== 'equipment' && incoming !== 'equipment';
}

function applyInventoryChangeToIdentityContext(
  inventory: PlayerInventoryItem[],
  change: NonNullable<Extract<LuanShiCommand, { action: 'updatePlayerLoadout' }>['inventoryChanges']>[number],
): void {
  if (change.action === 'upsert') {
    const index = inventory.findIndex((item) => item.id === change.item.id);
    if (index >= 0) inventory[index] = { ...inventory[index], ...change.item };
    else inventory.push({ ...change.item });
    return;
  }

  const index = inventory.findIndex((item) => item.id === change.itemId);
  if (index < 0) return;
  if (change.action === 'setQuantity') {
    if (!Number.isFinite(change.quantity)) return;
    if (change.quantity <= 0) inventory.splice(index, 1);
    else inventory[index] = { ...inventory[index], quantity: Math.floor(change.quantity) };
    return;
  }

  const removeQuantity = change.quantity === undefined ? 1 : change.quantity;
  if (!Number.isFinite(removeQuantity) || removeQuantity <= 0) return;
  const nextQuantity = inventory[index].quantity - Math.floor(removeQuantity);
  if (nextQuantity <= 0) inventory.splice(index, 1);
  else inventory[index] = { ...inventory[index], quantity: nextQuantity };
}

function collectKnownNpcIds(runtimeState: RuntimeState, patches: StatePatch[]): Set<string> {
  const ids = new Set((runtimeState.npcs ?? []).map((npc) => npc.npcId));

  for (const patch of patches) {
    const command = extractLuanShiCommandFromPatch(patch);
    if (command?.action !== 'upsertNpcProfile') continue;

    const npcId = (command as { npcId?: unknown }).npcId;
    if (typeof npcId === 'string' && npcId.trim()) {
      ids.add(npcId.trim());
    }
  }

  return ids;
}

function sanitizeNarratorStatePatch(
  patch: StatePatch,
  runtimeState: RuntimeState,
  knownNpcIds: Set<string>,
): StatePatch | undefined {
  if (patch.type !== 'luanshiCommand') return patch;

  const command = extractLuanShiCommandFromPatch(patch);
  if (!command) return patch;

  if (isEmptyOptionalLuanShiCommand(command)) return undefined;

  if (command.action === 'recordTurnEvent') {
    return sanitizeRecordTurnEventPatch(patch, command, knownNpcIds);
  }

  if (command.action === 'updateCharacterUniqueArts') {
    return sanitizePlayerUniqueArtsPatch(patch, command, runtimeState);
  }

  if (command.action === 'recordCharacterUniqueArtProgress' && command.characterType === 'player') {
    return {
      ...patch,
      payload: {
        ...patch.payload,
        command: {
          ...command,
          characterId: runtimeState.player.id,
          characterName: runtimeState.player.name,
        },
      },
    };
  }

  return patch;
}

function isEmptyOptionalLuanShiCommand(command: LuanShiCommand): boolean {
  if (command.action === 'updateCharacterIdentity') {
    return !optionalIdentityFields.some((field) => Object.prototype.hasOwnProperty.call(command, field));
  }

  if (command.action === 'updatePlayerLoadout') {
    return !optionalLoadoutFields.some((field) => Object.prototype.hasOwnProperty.call(command, field));
  }

  return false;
}

function sanitizeRecordTurnEventPatch(
  patch: StatePatch,
  command: LuanShiCommand,
  knownNpcIds: Set<string>,
): StatePatch {
  const recordCommand = command as Extract<LuanShiCommand, { action: 'recordTurnEvent' }>;

  return {
    ...patch,
    payload: {
      ...patch.payload,
      command: {
        ...recordCommand,
        presentNpcIds: filterKnownNpcIds(recordCommand.presentNpcIds, knownNpcIds),
        involvedNpcIds: filterKnownNpcIds(recordCommand.involvedNpcIds, knownNpcIds),
      },
    },
  };
}

function filterKnownNpcIds(values: unknown, knownNpcIds: Set<string>): string[] {
  if (!Array.isArray(values)) return [];

  return values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0 && knownNpcIds.has(value));
}

function sanitizePlayerUniqueArtsPatch(
  patch: StatePatch,
  command: Extract<LuanShiCommand, { action: 'updateCharacterUniqueArts' }>,
  runtimeState: RuntimeState,
): StatePatch {
  if (command.characterType !== 'player') {
    return patch;
  }

  return {
    ...patch,
    payload: {
      ...patch.payload,
      command: {
        ...command,
        characterId: runtimeState.player.id,
        characterName: runtimeState.player.name,
      },
    },
  };
}

function mergeTimeAdvanceRepairResponse(
  original: NarratorResponse,
  repaired: NarratorResponse,
): NarratorResponse {
  const originalPatches = collectStatePatches(original)
    .filter((patch) => normalizeNarratorStatePatch(patch).type !== 'timeAdvance');
  const repairedTimeAdvancePatches = collectStatePatches(repaired)
    .map((patch) => normalizeNarratorStatePatch(patch))
    .filter((patch) => patch.type === 'timeAdvance');
  const nextPatches = [...originalPatches, ...repairedTimeAdvancePatches];

  return {
    ...original,
    protocolVersion: original.protocolVersion ?? repaired.protocolVersion,
    statePatches: nextPatches.length > 0 ? nextPatches : undefined,
    statePatch: null,
  };
}

function hasMeaningfulWriteback(writeback: NarratorWritebackProtocol | undefined): boolean {
  if (!writeback) return false;
  return Boolean(
    writeback.turnSummary
    || writeback.protagonistMemory
    || (writeback.npcProfileSuggestions?.length ?? 0) > 0
    || (writeback.npcMemorySuggestions?.length ?? 0) > 0
    || (writeback.factionRecentActionSuggestions?.length ?? 0) > 0
    || (writeback.locationWriteSuggestions?.length ?? 0) > 0
    || (writeback.routeWriteSuggestions?.length ?? 0) > 0
    || (writeback.questChanges?.length ?? 0) > 0
    || (writeback.signalChanges?.length ?? 0) > 0
    || (writeback.plotPlanSuggestions?.length ?? 0) > 0
    || (writeback.worldEventUpdates?.length ?? 0) > 0
    || writeback.worldEventSummary
    || writeback.playerRecoveryKind
    || writeback.encounterTransitionDecision
    || writeback.encounterStartIntent
    || (writeback.semanticProjections?.length ?? 0) > 0
    || (writeback.debugNotes?.length ?? 0) > 0
  );
}

export interface StatePatchTransactionPreparation {
  statePatches: StatePatch[];
  sourcePatchIndexes: number[];
  statePatchDraft: RuntimeState;
  patchValidationResults: PatchValidationResult[];
  patchValidation: PatchValidationResult | null;
  invalidPatchNotes: string[];
  quarantinedPatchNotes: string[];
  quarantineMode?: 'battle' | 'continuity';
}

export function quarantineEncounterTriggerResultPatches(
  patches: StatePatch[],
  encounterStartIntent: EncounterStartIntent | undefined,
): { patches: StatePatch[]; removedCount: number } {
  if (!encounterStartIntent) return { patches, removedCount: 0 };
  const forbiddenAction = encounterStartIntent.kind === 'war'
    ? 'upsertConflictRecord'
    : 'upsertCombatRecord';
  const retained = patches.filter((patch) => {
    const command = extractLuanShiCommandFromPatch(normalizeNarratorStatePatch(patch));
    return command?.action !== forbiddenAction;
  });
  return {
    patches: retained,
    removedCount: patches.length - retained.length,
  };
}

function collectRejectedMovementLocationIds(
  sourcePatches: StatePatch[],
  preparedSourceIndexes: number[],
  validationResults: PatchValidationResult[],
): Set<string> {
  const rejectedSourceIndexes = new Set(
    preparedSourceIndexes.flatMap((sourcePatchIndex, transactionIndex) => (
      validationResults[transactionIndex]?.valid === false ? [sourcePatchIndex] : []
    )),
  );
  const rejected = new Set<string>();
  sourcePatches.forEach((sourcePatch, index) => {
    if (!rejectedSourceIndexes.has(index)) return;
    const patch = normalizeNarratorStatePatch(sourcePatch);
    if (patch.type !== 'locationChange') return;
    for (const field of ['toLocationId', 'toSceneId'] as const) {
      const value = patch.payload?.[field];
      if (typeof value === 'string' && value.trim()) rejected.add(value.trim());
    }
  });
  return rejected;
}

function appendEncounterTriggerQuarantineSummary(state: RuntimeState, removedCount: number): void {
  if (removedCount <= 0) return;
  const latest = state.turnLog[state.turnLog.length - 1];
  if (!latest) return;
  latest.statePatchSummary = [
    latest.statePatchSummary,
    `Encounter V2 已隔离 ${removedCount} 条触发回合战果写回；胜负将由本地引擎裁定`,
  ].filter(Boolean).join('；');
}

interface StatePatchValidationDiagnostic {
  patchIndex: number;
  patchType: string;
  commandAction?: string;
  errors: string[];
  warnings: string[];
}

export function prepareStatePatchTransaction(
  patches: StatePatch[],
  worldBook: WorldBook,
  runtimeState: RuntimeState,
  applyOptions: ApplyPatchOptions = {},
  initialDraft?: RuntimeState,
  enableContinuityQuarantine = true,
): StatePatchTransactionPreparation {
  const transactionBaseState = initialDraft ?? runtimeState;
  const canonicalPatches = canonicalizeNarratorPlayerInventoryItemIds(
    canonicalizeLocationChangeSceneTargets(
      worldBook,
      transactionBaseState,
      patches,
    ),
    transactionBaseState,
  );
  const knownNpcIds = collectKnownNpcIds(runtimeState, canonicalPatches);
  const preparedPatches: PreparedNarratorStatePatch[] = [];
  let statePatchDraft = createStatePatchDraft(transactionBaseState);
  const patchValidationResults: PatchValidationResult[] = [];
  let hasValidTimeAdvance = false;
  const updatedNpcRelationshipIds = new Set<string>();

  for (let sourcePatchIndex = 0; sourcePatchIndex < canonicalPatches.length; sourcePatchIndex += 1) {
    const rawPatch = fillNarratorUniqueArtProgressMechanics(
      canonicalPatches[sourcePatchIndex],
      runtimeState,
    );
    const knownQuestIds = statePatchDraft.activeQuests.map((quest) => quest.id);
    let validation = validatePatch(rawPatch, worldBook, knownQuestIds, statePatchDraft);
    if (!validation.valid && isIgnorableRawOptionalCommandNoOp(rawPatch) && canIgnoreSanitizedNoOp(validation)) {
      continue;
    }

    if (!validation.valid) {
      preparedPatches.push({ patch: rawPatch, sourcePatchIndex });
      patchValidationResults.push(validation);
      continue;
    }

    const normalizedPatch = normalizeNarratorStatePatch(rawPatch);
    const sanitizedPatch = sanitizeNarratorStatePatch(normalizedPatch, runtimeState, knownNpcIds);
    if (!sanitizedPatch) continue;

    const patch = sanitizedPatch;
    if (patch.type === 'timeAdvance') {
      if (hasValidTimeAdvance) {
        validation = {
          valid: false,
          errors: ['同一 StatePatch 事务最多允许一个有效 timeAdvance。'],
          warnings: validation.warnings,
        };
      } else {
        hasValidTimeAdvance = true;
      }
    }
    const command = extractLuanShiCommandFromPatch(patch);
    if (command?.action === 'updateNpcRelationship') {
      const npcId = typeof command.npcId === 'string' ? command.npcId.trim() : '';
      if (npcId) {
        if (updatedNpcRelationshipIds.has(npcId)) {
          validation = {
            valid: false,
            errors: [`同一 StatePatch 事务每个 NPC 最多允许一条 updateNpcRelationship：${npcId}`],
            warnings: validation.warnings,
          };
        } else {
          updatedNpcRelationshipIds.add(npcId);
        }
      }
    }
    preparedPatches.push({ patch, sourcePatchIndex });
    if (!validation.valid) {
      patchValidationResults.push(validation);
      continue;
    }
    if (!applyPatchToDraft(statePatchDraft, patch, applyOptions)) {
      patchValidationResults.push({
        valid: false,
        errors: [`${patch.type} 应用守卫拒绝了非有限或非法运算结果。`],
        warnings: validation.warnings,
      });
      continue;
    }
    patchValidationResults.push(validation);
  }

  const hasValidJudgementRecord = preparedPatches.some((entry, index) => (
    patchValidationResults[index]?.valid === true && isJudgementRecordPatch(entry.patch)
  ));
  const quarantinedTransactionIndexes = new Set<number>();
  if (hasValidJudgementRecord) {
    preparedPatches.forEach((entry, index) => {
      const validation = patchValidationResults[index];
      if (
        validation?.valid === false
        && canIgnoreSanitizedNoOp(validation)
        && isQuarantinableBattlePeripheralPatch(entry.patch)
      ) {
        quarantinedTransactionIndexes.add(index);
      }
    });
  }

  if (enableContinuityQuarantine) {
    const failedContinuityDomains = new Set<string>();
    preparedPatches.forEach((entry, index) => {
      if (patchValidationResults[index]?.valid !== false) return;
      const domain = getContinuityQuarantineDomain(entry.patch);
      if (domain) failedContinuityDomains.add(domain);
    });
    if (failedContinuityDomains.size > 0) {
      preparedPatches.forEach((entry, index) => {
        const domain = getContinuityQuarantineDomain(entry.patch);
        if (domain && failedContinuityDomains.has(domain)) quarantinedTransactionIndexes.add(index);
      });
    }
  }

  const effectivePreparedPatches = preparedPatches.filter((_, index) => !quarantinedTransactionIndexes.has(index));
  const effectiveValidationResults = patchValidationResults.filter((_, index) => !quarantinedTransactionIndexes.has(index));
  const quarantinedPatchNotes = [...quarantinedTransactionIndexes].flatMap((index) => {
    const entry = preparedPatches[index];
    const validation = patchValidationResults[index];
    if (!entry || !validation) return [];
    const command = extractLuanShiCommandFromPatch(entry.patch);
    const label = command?.action ?? entry.patch.type;
    return [`${label}: ${validation.valid ? '同域存在非法补丁，按域原子隔离' : validation.errors.join('；')}`];
  });
  if (quarantinedPatchNotes.length > 0 && effectiveValidationResults.length > 0) {
    effectiveValidationResults[0] = {
      ...effectiveValidationResults[0],
      warnings: [
        ...effectiveValidationResults[0].warnings,
        ...quarantinedPatchNotes.map((note) => `${hasValidJudgementRecord ? '战事核心写回已保留' : '回合连续性写回已保留'}，附属补丁被隔离：${note}`),
      ],
    };
  }

  if (quarantinedTransactionIndexes.size > 0) {
    statePatchDraft = createStatePatchDraft(transactionBaseState);
    effectivePreparedPatches.forEach((entry, index) => {
      if (effectiveValidationResults[index]?.valid) {
        applyPatchToDraft(statePatchDraft, entry.patch, applyOptions);
      }
    });
  }

  const statePatches = effectivePreparedPatches.map((entry) => entry.patch);
  const sourcePatchIndexes = effectivePreparedPatches.map((entry) => entry.sourcePatchIndex);

  const patchValidation = statePatches.length > 0
    ? combinePatchValidationResults(effectiveValidationResults)
    : null;
  const invalidPatchNotes = statePatches.flatMap((patch, index) => {
    const validation = effectiveValidationResults[index];
    if (!validation || validation.valid) return [];
    return validation.errors.map((error) => `${patch.type}: ${error}`);
  });

  return {
    statePatches,
    sourcePatchIndexes,
    statePatchDraft,
    patchValidationResults: effectiveValidationResults,
    patchValidation,
    invalidPatchNotes,
    quarantinedPatchNotes,
    quarantineMode: quarantinedPatchNotes.length > 0
      ? hasValidJudgementRecord ? 'battle' : 'continuity'
      : undefined,
  };
}

function fillNarratorUniqueArtProgressMechanics(
  patch: StatePatch,
  runtimeState: RuntimeState,
): StatePatch {
  const command = extractLuanShiCommandFromPatch(patch);
  if (command?.action !== 'recordCharacterUniqueArtProgress') return patch;

  const raw = command as LuanShiCommand & Record<string, unknown>;
  const artId = typeof raw.artId === 'string' ? raw.artId.trim() : '';
  const source = typeof raw.source === 'string' ? raw.source.trim() : '';
  const characterType = raw.characterType === 'player' || raw.characterType === 'npc'
    ? raw.characterType
    : '';
  const submittedCharacterId = typeof raw.characterId === 'string' ? raw.characterId.trim() : '';
  const characterId = characterType === 'player'
    ? runtimeState.player.id
    : submittedCharacterId;
  const characterName = characterType === 'player'
    ? runtimeState.player.name
    : typeof raw.characterName === 'string' ? raw.characterName.trim() : '';
  const turnRef = `turn:${runtimeState.turnLog.length + 1}`;
  const sourceItemId = typeof raw.sourceItemId === 'string' ? raw.sourceItemId.trim() : '';
  const instructorNpcId = typeof raw.instructorNpcId === 'string' ? raw.instructorNpcId.trim() : '';
  const sourceRefId = typeof raw.sourceRefId === 'string' && raw.sourceRefId.trim()
    ? raw.sourceRefId.trim()
    : sourceItemId
      ? `item:${sourceItemId}`
      : instructorNpcId
        ? `npc:${instructorNpcId}`
        : `${turnRef}:unique-art:${characterId || characterName || 'unknown'}:${artId || 'unknown'}:${source || 'unknown'}`;
  const eventId = typeof raw.eventId === 'string' && raw.eventId.trim()
    ? raw.eventId.trim()
    : `${turnRef}:unique-art-progress:${characterId || characterName || 'unknown'}:${artId || 'unknown'}:${source || 'unknown'}`;
  const occurredAt = typeof raw.occurredAt === 'string' && raw.occurredAt.trim()
    ? raw.occurredAt.trim()
    : runtimeState.currentDate;

  return {
    ...patch,
    payload: {
      ...patch.payload,
      command: {
        ...command,
        ...(characterId ? { characterId } : {}),
        ...(characterName ? { characterName } : {}),
        eventId,
        occurredAt,
        sourceRefId,
      },
    },
  };
}

function getContinuityQuarantineDomain(patch: StatePatch): string | undefined {
  if (isExplicitlyTypedAmbiguousResourcePatch(patch)) return 'resource-and-loadout';
  const command = extractLuanShiCommandFromPatch(patch);
  if (!command) return undefined;
  const action = String(command.action ?? '').trim();
  if (!isKnownLuanShiCommandAction(action)) return action ? `unknown:${action}` : undefined;
  if (action === 'updateResourceLedger' || action === 'updatePlayerLoadout' || action === 'updateNpcLoadout') {
    return 'resource-and-loadout';
  }
  if (action === 'updateCharacterIdentity') return 'character-identity';
  if (action === 'upsertHoldingLedger') return 'holdings';
  if (action === 'upsertPrivateAsset' || action === 'upsertPrivateAssetProject') {
    return 'private-assets-and-projects';
  }
  if (action === 'recordCharacterUniqueArtProgress') return 'unique-art-progress';
  if (action === 'startHeavyCavalryFormation') return 'heavy-cavalry-formation';
  if (action === 'pushNpcMemory') return 'npc-memory';
  if (action === 'updateNpcPresence' || action === 'updateNpcBackgroundActivity') {
    return 'npc-presence-and-background-activity';
  }
  return undefined;
}

function isExplicitlyTypedAmbiguousResourcePatch(patch: StatePatch): boolean {
  if (patch.type !== 'resourceChanged' || !patch.payload || typeof patch.payload !== 'object') {
    return false;
  }
  const payload = patch.payload as Record<string, unknown>;
  const hasChange = Object.prototype.hasOwnProperty.call(payload, 'change');
  const hasNewValue = Object.prototype.hasOwnProperty.call(payload, 'newValue');
  return (payload.mode === 'delta' || payload.mode === 'absolute') && hasChange && hasNewValue;
}

function prepareNarratorStatePatchTransaction(
  patches: StatePatch[],
  writeback: NarratorWritebackProtocol | undefined,
  worldBook: WorldBook,
  runtimeState: RuntimeState,
): StatePatchTransactionPreparation {
  const locationPreparation = prepareNarratorLocationWriteback(
    runtimeState,
    writeback,
    worldBook,
    { statePatches: patches },
  );
  const canonicalPatches = remapNarratorStatePatchLocationReferences(
    patches,
    locationPreparation.aliasMap,
  );
  const npcAwareLocationState = applyAcceptedNpcProfilesForCompliance(
    locationPreparation.state,
    writeback?.npcProfileSuggestions ?? [],
  );
  return prepareStatePatchTransaction(
    canonicalPatches,
    worldBook,
    runtimeState,
    {},
    npcAwareLocationState,
    false,
  );
}

function isJudgementRecordPatch(patch: StatePatch): boolean {
  const command = extractLuanShiCommandFromPatch(patch);
  return command?.action === 'upsertConflictRecord' || command?.action === 'upsertCombatRecord';
}

function isQuarantinableBattlePeripheralPatch(patch: StatePatch): boolean {
  if (patch.type === 'resourceChanged') return true;
  const command = extractLuanShiCommandFromPatch(patch);
  return command?.action === 'updateResourceLedger' || command?.action === 'updatePlayerLoadout';
}

export function prepareNpcComplianceAcceptedRuntimeState(input: {
  patches: StatePatch[];
  worldBook: WorldBook;
  runtimeState: RuntimeState;
  writeback?: NarratorWritebackProtocol;
  applyOptions?: ApplyPatchOptions;
}): RuntimeState | undefined {
  const profileAwareState = applyAcceptedNpcProfilesForCompliance(
    input.runtimeState,
    input.writeback?.npcProfileSuggestions ?? [],
  );
  const transaction = prepareStatePatchTransaction(
    input.patches,
    input.worldBook,
    input.runtimeState,
    input.applyOptions,
    profileAwareState,
  );
  const preparedBaseState = transaction.statePatches.length === 0
    ? profileAwareState
    : transaction.patchValidation?.valid === true
      ? transaction.statePatchDraft
      : undefined;
  if (!preparedBaseState) return undefined;
  return preparedBaseState;
}

function canIgnoreSanitizedNoOp(validation: PatchValidationResult): boolean {
  return !validation.errors.some((error) => (
    error.includes('wholeWorldState') || error.includes('结构化权力')
  ));
}

function isIgnorableRawOptionalCommandNoOp(patch: StatePatch): boolean {
  if (patch.type === 'resourceChanged') {
    if (!isPlainRecord(patch.payload)) return false;
    const allowedKeys = new Set(['resource', 'mode', 'change', 'newValue']);
    if (Object.keys(patch.payload).some((key) => !allowedKeys.has(key))) return false;
    const resource = patch.payload.resource;
    const hasNoTarget = resource === undefined
      || (typeof resource === 'string' && resource.trim().length === 0);
    if (!hasNoTarget) return false;
    return normalizeResourceChangedPayload({
      ...patch.payload,
      resource: '__ignored_no_target__',
    }).ok;
  }

  if (patch.type !== 'luanshiCommand' || !isPlainRecord(patch.payload)) return false;
  const nestedCommand = patch.payload.command;
  const command = isPlainRecord(nestedCommand)
    ? nestedCommand
    : typeof patch.payload.action === 'string'
      ? patch.payload
      : undefined;
  if (!command) return false;

  if (command.action === 'updateCharacterIdentity') {
    return !optionalIdentityFields.some((field) => Object.prototype.hasOwnProperty.call(command, field));
  }
  if (command.action === 'updatePlayerLoadout') {
    return !optionalLoadoutFields.some((field) => Object.prototype.hasOwnProperty.call(command, field));
  }
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildStatePatchValidationDiagnostics(
  transaction: StatePatchTransactionPreparation,
): StatePatchValidationDiagnostic[] {
  return transaction.patchValidationResults.flatMap((validation, transactionIndex) => {
    if (validation.valid) return [];
    const patch = transaction.statePatches[transactionIndex];
    if (!patch) return [];
    const command = extractLuanShiCommandFromPatch(patch);

    return [{
      patchIndex: transaction.sourcePatchIndexes[transactionIndex] ?? transactionIndex,
      patchType: patch.type,
      ...(command?.action ? { commandAction: command.action } : {}),
      errors: [...validation.errors],
      warnings: [...validation.warnings],
    }];
  });
}

function combinePatchValidationResults(results: PatchValidationResult[]): PatchValidationResult {
  return {
    valid: results.every((result) => result.valid),
    errors: results.flatMap((result) => result.errors),
    warnings: results.flatMap((result) => result.warnings),
  };
}

interface GenerateNarratorResponseInput {
  options: TurnExecutionOptions;
  emitProcessingStage: TurnProcessingStageEmitter;
  worldBook: WorldBook;
  runtimeState: RuntimeState;
  currentDate: string;
  systemPrompt: string;
  userPrompt: string;
  adultIntimacyFinalReminder: string;
  narrativeProseFinalReview: string;
  narrativeLengthFinalReminder: string;
  narrativeLengthContract: import('../prompts/NarrativeLengthGuidance').NarrativeLengthContract;
  narrativeLengthRetryEnabled: boolean;
  stateWriterContext: string;
  encounterIntentCreatedAt: string;
  turnLlmBudget: TurnLlmBudget;
  fallbackContext: Parameters<typeof generateMockNarrative>[0];
}

function appendConflictReferenceWarningSummary(state: RuntimeState, conflictIds: string[]): void {
  if (conflictIds.length === 0) return;
  const latest = state.turnLog[state.turnLog.length - 1];
  if (!latest) return;
  latest.statePatchSummary = [
    latest.statePatchSummary,
    `已隔离无对应战事实体的纪事引用：${conflictIds.join('、')}`,
  ].filter(Boolean).join('；');
}

function appendQuarantinedPeripheralSummary(
  state: RuntimeState,
  notes: string[],
  mode?: 'battle' | 'continuity',
): void {
  if (notes.length === 0) return;
  const latest = state.turnLog[state.turnLog.length - 1];
  if (!latest) return;
  latest.statePatchSummary = [
    latest.statePatchSummary,
    mode === 'battle'
      ? `战事核心已写入，${notes.length} 条未通过校验的附属资源补丁已隔离`
      : `本回合已继续提交，${notes.length} 条未通过校验的附属补丁已按域隔离`,
  ].filter(Boolean).join('；');
}

function syncLatestTurnSuggestedActions(
  state: RuntimeState,
  suggestedActions: SuggestedAction[],
): void {
  const latestLog = state.turnLog[state.turnLog.length - 1];
  if (!latestLog) return;
  latestLog.suggestedActions = suggestedActions.map((action) => ({ ...action }));
}

async function generateNarratorResponse(input: GenerateNarratorResponseInput): Promise<{
  response: NarratorResponse;
  mode: 'llm' | 'mock';
  provider?: string;
  model?: string;
  usage?: LlmTokenUsage;
  rawContent: string;
  postNarrativeBudget?: PostNarrativeLlmBudget;
  narrativeLengthRegeneration?: {
    regenerationAttempted: true;
    firstAttemptCharacters: number;
    regenerationResolved: boolean;
  };
}> {
  const { apiConfig, llmClient } = input.options;

  if (apiConfig && !llmClient) {
    throw new Error('已配置 API，但当前回合缺少 LLM 客户端');
  }

  if (apiConfig && llmClient) {
    const mainNarrativeRequestBudget = input.turnLlmBudget.getMainNarrativeRequestBudget();
    const baseMessages = buildTurnMessages(
      input.systemPrompt,
      input.userPrompt,
      input.stateWriterContext,
      input.adultIntimacyFinalReminder,
      input.narrativeProseFinalReview,
      input.narrativeLengthFinalReminder,
      {
        scope: input.options.openingInitialization ? 'opening' : 'turn',
        playerName: input.runtimeState.player.name,
        settings: input.options.tavernSettings,
        cacheLayout: resolveTurnPromptCacheLayout(apiConfig),
      },
    );
    let result = await runProcessingStage(
      input.emitProcessingStage,
      'generatingNarrative',
      '生成正文',
      { provider: apiConfig.provider, model: apiConfig.model },
      () => llmClient.generate({
        config: apiConfig,
        messages: baseMessages,
        temperature: apiConfig.temperature,
        maxOutputTokens: apiConfig.maxOutputTokens,
        responseFormat: 'json_object',
        onContentDelta: input.options.onContentDelta,
        ...mainNarrativeRequestBudget,
      }),
    );
    input.options.signal?.throwIfAborted();
    let response = parseNarratorResponse(result.content, {
      encounterIntentCreatedAt: input.encounterIntentCreatedAt,
      encounterIntentSourceTurnNumber: input.runtimeState.turnLog.length + 1,
      correspondenceSources: buildCorrespondenceParserSources(input.runtimeState),
    });
    let rawContent = result.content;
    let usage = result.usage;
    const firstLengthEvaluation = evaluateNarrativeLength(
      response.narrativeText,
      input.narrativeLengthContract,
    );
    let narrativeLengthRegeneration:
      | {
        regenerationAttempted: true;
        firstAttemptCharacters: number;
        regenerationResolved: boolean;
      }
      | undefined;
    if (shouldRegenerateNarrativeLength(
      firstLengthEvaluation,
      input.narrativeLengthRetryEnabled,
    )) {
      input.options.onContentReset?.();
      const regenerationRequestBudget = input.turnLlmBudget.getMainNarrativeRequestBudget();
      const regenerationDirective = buildNarrativeLengthRegenerationDirective(firstLengthEvaluation);
      result = await runProcessingStage(
        input.emitProcessingStage,
        'regeneratingNarrative',
        '重生成篇幅不足的正文',
        {
          provider: apiConfig.provider,
          model: apiConfig.model,
        },
        () => llmClient.generate({
          config: apiConfig,
          messages: [
            ...baseMessages,
            { role: 'user', content: regenerationDirective },
          ],
          temperature: apiConfig.temperature,
          maxOutputTokens: apiConfig.maxOutputTokens,
          responseFormat: 'json_object',
          onContentDelta: input.options.onContentDelta,
          ...regenerationRequestBudget,
        }),
      );
      input.options.signal?.throwIfAborted();
      response = parseNarratorResponse(result.content, {
        encounterIntentCreatedAt: input.encounterIntentCreatedAt,
        encounterIntentSourceTurnNumber: input.runtimeState.turnLog.length + 1,
        correspondenceSources: buildCorrespondenceParserSources(input.runtimeState),
      });
      rawContent = result.content;
      usage = mergeTokenUsage(usage, result.usage);
      const regeneratedEvaluation = evaluateNarrativeLength(
        response.narrativeText,
        input.narrativeLengthContract,
      );
      narrativeLengthRegeneration = {
        regenerationAttempted: true,
        firstAttemptCharacters: firstLengthEvaluation.actualCharacters,
        regenerationResolved: !shouldRegenerateNarrativeLength(regeneratedEvaluation),
      };
      if (shouldRegenerateNarrativeLength(regeneratedEvaluation)) {
        throw new Error(
          `正文连续两次低于“${regeneratedEvaluation.label}”档重写阈值`
          + `（本次 ${regeneratedEvaluation.actualCharacters}/${regeneratedEvaluation.retryMinimumCharacters} 字，`
          + `目标下限 ${regeneratedEvaluation.minimumCharacters} 字）；`
          + '本回合未写入，请重试或更换更遵守篇幅要求的 API。',
        );
      }
    }
    response = materializeStructuredTurnSummaryStatePatches(
      response,
      input.runtimeState,
      input.currentDate,
    );
    const postNarrativeBudget = input.turnLlmBudget.startPostNarrativeBudget();
    let stateWritebackRepairFailedApiConfig: ApiConfigArchive | null = null;
    let stateWritebackRepairSucceeded = false;
    let successfulStateWritebackApiConfig: ApiConfigArchive | null = null;
    let successfulStateWritebackLlmClient: LlmClient | null = null;
    const judgementMarkerIntegrityIssues = findOrphanJudgementMarkers(
      response.narrativeText,
      collectStatePatches(response),
    );
    const playerInventoryScopeDiagnostics = buildPlayerInventoryDestructiveScopeDiagnostics(
      input.runtimeState,
      input.fallbackContext.playerInput,
      response,
    );
    const configuredStateWritebackApiConfig = input.options.stateWritebackApiConfig;
    const configuredStateWritebackFallbackApiConfig = input.options.stateWritebackFallbackApiConfig;
    const repairSourcePatches = collectStatePatches(response);
    const mapWritebackRepairDiagnostics = prepareNarratorLocationWriteback(
      input.runtimeState,
      response.writeback,
      input.worldBook,
      { statePatches: repairSourcePatches },
    ).repairDiagnostics;
    const statePatchDiagnostics = [
      ...buildStatePatchValidationDiagnostics(
        prepareNarratorStatePatchTransaction(
          repairSourcePatches,
          response.writeback,
          input.worldBook,
          input.runtimeState,
        ),
      ),
      ...playerInventoryScopeDiagnostics,
    ];
    const playerEconomyWritebackReviewRequired = playerInventoryScopeDiagnostics.length > 0
      || (
        !configuredStateWritebackApiConfig
        && requiresPlayerEconomyWritebackReview(input.runtimeState, response)
      );
    const privateAssetAcquisitionWritebackReviewRequired =
      requiresPrivateAssetAcquisitionWritebackReview(input.runtimeState, response);
    const scenePresenceWritebackReviewRequired = !input.options.openingInitialization
      && requiresScenePresenceWritebackReview(response);
    const generalStatePatchRepairDiagnostics = statePatchDiagnostics.filter(
      (diagnostic) => diagnostic.patchType !== 'timeAdvance',
    );
    const encounterStartIntentPresent = Boolean(response.writeback?.encounterStartIntent);
    const shouldBorrowMainApiForStateWriteback = (
      !input.options.openingInitialization
      && !encounterStartIntentPresent
      && (
        generalStatePatchRepairDiagnostics.length > 0
        || mapWritebackRepairDiagnostics.length > 0
      )
    )
      || judgementMarkerIntegrityIssues.length > 0
      || playerEconomyWritebackReviewRequired
      || privateAssetAcquisitionWritebackReviewRequired
      || scenePresenceWritebackReviewRequired;
    const stateWritebackApiConfig = configuredStateWritebackApiConfig
      ?? (shouldBorrowMainApiForStateWriteback ? apiConfig : null);

    if (stateWritebackApiConfig) {
      const stateWritebackLlmClient = configuredStateWritebackApiConfig
        ? (input.options.stateWritebackLlmClient ?? llmClient)
        : llmClient;
      const stateWritebackRepairRequiresRetry = statePatchDiagnostics.length > 0
        || mapWritebackRepairDiagnostics.length > 0
        || judgementMarkerIntegrityIssues.length > 0
        || playerEconomyWritebackReviewRequired
        || privateAssetAcquisitionWritebackReviewRequired
        || scenePresenceWritebackReviewRequired;
      try {
        const repairLabel = judgementMarkerIntegrityIssues.length > 0
          ? '补全判定写回'
          : playerEconomyWritebackReviewRequired
            ? '核对物品与个人钱财写回'
            : privateAssetAcquisitionWritebackReviewRequired
              ? '补全私人产业产权写回'
              : scenePresenceWritebackReviewRequired
                ? '补全当前场景在场名单'
                : '整理状态写回';
        const repaired = await runStateWritebackRepairStage({
          emit: input.emitProcessingStage,
          label: repairLabel,
          meta: {
            provider: stateWritebackApiConfig.provider,
            model: stateWritebackApiConfig.model,
          },
          initialRequestBudget: postNarrativeBudget.getChildRequestBudget({
            allowRetry: stateWritebackRepairRequiresRetry,
          }),
          retryRequestBudget: () => capOptionalWritebackRequestBudget(
            postNarrativeBudget.getChildRequestBudget({ allowRetry: false }),
          ),
          retryEmptyContent: !configuredStateWritebackFallbackApiConfig,
          request: (requestBudget) => requestStateWritebackRepair({
            apiConfig: stateWritebackApiConfig,
            llmClient: stateWritebackLlmClient,
            runtimeState: input.runtimeState,
            currentDate: input.currentDate,
            playerInput: input.fallbackContext.playerInput,
            stateWriterContext: input.stateWriterContext,
            encounterIntentCreatedAt: input.encounterIntentCreatedAt,
            originalResponse: response,
            statePatchDiagnostics,
            mapWritebackRepairDiagnostics,
            judgementMarkerIntegrityIssues,
            playerEconomyWritebackReviewRequired,
            playerEconomyWritebackReviewAttempt: 1,
            scenePresenceWritebackReviewRequired,
            requestBudget: capOptionalWritebackRequestBudget(requestBudget),
          }),
        });
        const repairSourceResponse = response;
        let repairMerge = mergeStateWritebackRepairResponse(repairSourceResponse, repaired.response, {
          worldBook: input.worldBook,
          runtimeState: input.runtimeState,
          statePatchDiagnostics,
          mapWritebackRepairDiagnostics,
          judgementMarkerIntegrityIssues,
        });
        usage = mergeTokenUsage(usage, repaired.usage);
        const generalReviewCandidateDiagnostics = !stateWritebackRepairRequiresRetry
          && !repairMerge.patchCandidateAccepted
          ? buildStatePatchValidationDiagnostics(
              prepareNarratorStatePatchTransaction(
                collectStatePatches(repaired.response),
                repaired.response.writeback,
                input.worldBook,
                input.runtimeState,
              ),
            ).filter(isCanonicalResourceWritebackDiagnostic)
          : [];
        if (generalReviewCandidateDiagnostics.length > 0) {
          const candidateRepairSource = {
            ...repaired.response,
            narrativeText: repairSourceResponse.narrativeText,
            suggestedActions: repairSourceResponse.suggestedActions,
          };
          const candidateRepair = await runStateWritebackRepairStage({
            emit: input.emitProcessingStage,
            label: '校正状态写回',
            meta: {
              provider: stateWritebackApiConfig.provider,
              model: stateWritebackApiConfig.model,
            },
            initialRequestBudget: capOptionalWritebackRequestBudget(
              postNarrativeBudget.getChildRequestBudget(),
            ),
            retryRequestBudget: () => capOptionalWritebackRequestBudget(
              postNarrativeBudget.getChildRequestBudget({ allowRetry: false }),
            ),
            retryEmptyContent: !configuredStateWritebackFallbackApiConfig,
            request: (requestBudget) => requestStateWritebackRepair({
              apiConfig: stateWritebackApiConfig,
              llmClient: stateWritebackLlmClient,
              runtimeState: input.runtimeState,
              currentDate: input.currentDate,
              playerInput: input.fallbackContext.playerInput,
              stateWriterContext: input.stateWriterContext,
              encounterIntentCreatedAt: input.encounterIntentCreatedAt,
              originalResponse: candidateRepairSource,
              statePatchDiagnostics: generalReviewCandidateDiagnostics,
              mapWritebackRepairDiagnostics,
              judgementMarkerIntegrityIssues,
              playerEconomyWritebackReviewRequired: false,
              playerEconomyWritebackReviewAttempt: 1,
              scenePresenceWritebackReviewRequired:
                requiresScenePresenceWritebackReview(candidateRepairSource),
              requestBudget,
            }),
          });
          repairMerge = mergeStateWritebackRepairResponse(candidateRepairSource, candidateRepair.response, {
            worldBook: input.worldBook,
            runtimeState: input.runtimeState,
            statePatchDiagnostics: generalReviewCandidateDiagnostics,
            mapWritebackRepairDiagnostics,
            judgementMarkerIntegrityIssues,
          });
          usage = mergeTokenUsage(usage, candidateRepair.usage);
        }
        const economyReviewStillRequired = playerEconomyWritebackReviewRequired
          && (
            !repairMerge.patchCandidateAccepted
            || buildPlayerInventoryDestructiveScopeDiagnostics(
              input.runtimeState,
              input.fallbackContext.playerInput,
              repairMerge.response,
            ).length > 0
          );
        if (economyReviewStillRequired) {
          const secondReview = await runStateWritebackRepairStage({
            emit: input.emitProcessingStage,
            label: '再次核对物品与个人钱财写回',
            meta: {
              provider: stateWritebackApiConfig.provider,
              model: stateWritebackApiConfig.model,
            },
            initialRequestBudget: capOptionalWritebackRequestBudget(
              postNarrativeBudget.getChildRequestBudget(),
            ),
            retryRequestBudget: () => capOptionalWritebackRequestBudget(
              postNarrativeBudget.getChildRequestBudget({ allowRetry: false }),
            ),
            retryEmptyContent: !configuredStateWritebackFallbackApiConfig,
            request: (requestBudget) => requestStateWritebackRepair({
              apiConfig: stateWritebackApiConfig,
              llmClient: stateWritebackLlmClient,
              runtimeState: input.runtimeState,
              currentDate: input.currentDate,
              playerInput: input.fallbackContext.playerInput,
              stateWriterContext: input.stateWriterContext,
              encounterIntentCreatedAt: input.encounterIntentCreatedAt,
              originalResponse: repairSourceResponse,
              statePatchDiagnostics,
              mapWritebackRepairDiagnostics,
              judgementMarkerIntegrityIssues,
              playerEconomyWritebackReviewRequired,
              playerEconomyWritebackReviewAttempt: 2,
              scenePresenceWritebackReviewRequired,
              requestBudget,
            }),
          });
          repairMerge = mergeStateWritebackRepairResponse(repairSourceResponse, secondReview.response, {
            worldBook: input.worldBook,
            runtimeState: input.runtimeState,
            statePatchDiagnostics,
            mapWritebackRepairDiagnostics,
            judgementMarkerIntegrityIssues,
          });
          usage = mergeTokenUsage(usage, secondReview.usage);
        }
        if (
          buildPlayerInventoryDestructiveScopeDiagnostics(
            input.runtimeState,
            input.fallbackContext.playerInput,
            repairMerge.response,
          ).length > 0
        ) {
          throw new PlayerInventoryScopeReviewError();
        }
        response = repairMerge.response;
        rawContent = JSON.stringify(response, null, 2);
        stateWritebackRepairSucceeded = true;
        successfulStateWritebackApiConfig = stateWritebackApiConfig;
        successfulStateWritebackLlmClient = stateWritebackLlmClient;
        if (judgementMarkerIntegrityIssues.length > 0 && !repairMerge.patchCandidateAccepted) {
          response = appendWritebackDebugNote(response, '判定标记缺少对应战事/个人战记录，自动补全结果未通过校验。');
        }
        if (playerEconomyWritebackReviewRequired && !repairMerge.patchCandidateAccepted) {
          response = appendWritebackDebugNote(response, '物品与个人钱财写回复核结果未通过校验，已保留主回合原始写回。');
        }
        if (privateAssetAcquisitionWritebackReviewRequired && !repairMerge.patchCandidateAccepted) {
          response = appendWritebackDebugNote(response, '正文已确认私人产业产权取得，但补写结果未通过校验。');
        }
      } catch (error) {
        rethrowIfTurnCancelled(error, input.options.signal);
        if (error instanceof PlayerInventoryScopeReviewError) throw error;
        stateWritebackRepairFailedApiConfig = stateWritebackApiConfig;
        response = appendWritebackDebugNote(
          response,
          `状态写回整理失败：${getErrorMessage(error)}`,
        );
        const stateWritebackFallbackApiConfig = configuredStateWritebackFallbackApiConfig
          && !isSameApiConfig(configuredStateWritebackFallbackApiConfig, stateWritebackApiConfig)
          ? configuredStateWritebackFallbackApiConfig
          : (
              (
                statePatchDiagnostics.length > 0
                || mapWritebackRepairDiagnostics.length > 0
                || judgementMarkerIntegrityIssues.length > 0
                || playerEconomyWritebackReviewRequired
                || privateAssetAcquisitionWritebackReviewRequired
                || scenePresenceWritebackReviewRequired
              )
              && !isSameApiConfig(stateWritebackApiConfig, apiConfig)
                ? apiConfig
                : null
            );
        const stateWritebackFallbackLlmClient = stateWritebackFallbackApiConfig
          ? (
              configuredStateWritebackFallbackApiConfig
              && isSameApiConfig(stateWritebackFallbackApiConfig, configuredStateWritebackFallbackApiConfig)
                ? (input.options.stateWritebackFallbackLlmClient ?? llmClient)
                : llmClient
            )
          : null;
        if (stateWritebackFallbackApiConfig && stateWritebackFallbackLlmClient) {
          try {
            const fallbackRepair = await runStateWritebackRepairStage({
              emit: input.emitProcessingStage,
              label: playerEconomyWritebackReviewRequired
                ? '核对物品与个人钱财写回（备用 API）'
                : privateAssetAcquisitionWritebackReviewRequired
                  ? '补全私人产业产权写回（备用 API）'
                  : scenePresenceWritebackReviewRequired
                    ? '补全当前场景在场名单（备用 API）'
                    : '整理状态写回（备用 API）',
              meta: {
                provider: stateWritebackFallbackApiConfig.provider,
                model: stateWritebackFallbackApiConfig.model,
              },
              initialRequestBudget: capOptionalWritebackRequestBudget(
                postNarrativeBudget.getChildRequestBudget({ allowRetry: false }),
              ),
              retryRequestBudget: () => capOptionalWritebackRequestBudget(
                postNarrativeBudget.getChildRequestBudget({ allowRetry: false }),
              ),
              retryEmptyContent: false,
              request: (requestBudget) => requestStateWritebackRepair({
                apiConfig: stateWritebackFallbackApiConfig,
                llmClient: stateWritebackFallbackLlmClient,
                runtimeState: input.runtimeState,
                currentDate: input.currentDate,
                playerInput: input.fallbackContext.playerInput,
                stateWriterContext: input.stateWriterContext,
                encounterIntentCreatedAt: input.encounterIntentCreatedAt,
                originalResponse: response,
                statePatchDiagnostics,
                mapWritebackRepairDiagnostics,
                judgementMarkerIntegrityIssues,
                playerEconomyWritebackReviewRequired,
                playerEconomyWritebackReviewAttempt: 1,
                scenePresenceWritebackReviewRequired,
                requestBudget,
              }),
            });
            const fallbackMerge = mergeStateWritebackRepairResponse(response, fallbackRepair.response, {
              worldBook: input.worldBook,
              runtimeState: input.runtimeState,
              statePatchDiagnostics,
              mapWritebackRepairDiagnostics,
              judgementMarkerIntegrityIssues,
            });
            response = fallbackMerge.response;
            rawContent = JSON.stringify(response, null, 2);
            usage = mergeTokenUsage(usage, fallbackRepair.usage);
            stateWritebackRepairSucceeded = true;
            successfulStateWritebackApiConfig = stateWritebackFallbackApiConfig;
            successfulStateWritebackLlmClient = stateWritebackFallbackLlmClient;
            response = appendWritebackDebugNote(
              response,
              `状态写回主要 API 失败，已切换备用 API：${stateWritebackFallbackApiConfig.model}`,
            );
          } catch (fallbackError) {
            rethrowIfTurnCancelled(fallbackError, input.options.signal);
            response = appendWritebackDebugNote(
              response,
              `备用状态写回 API 失败：${getErrorMessage(fallbackError)}`,
            );
          }
        }
      }
    }

    response = materializeStructuredTurnSummaryStatePatches(
      response,
      input.runtimeState,
      input.currentDate,
    );
    if (scenePresenceWritebackReviewRequired && requiresScenePresenceWritebackReview(response)) {
      response = appendWritebackDebugNote(
        response,
        '地点切换缺少结构化当前场景在场名单，未能安全补全 NPC 在场状态。',
      );
    }
    rawContent = JSON.stringify(response, null, 2);

    const encounterTransitionRepairRequirement = buildEncounterTransitionRepairRequirement(
      response,
      input.runtimeState,
      input.worldBook,
    );
    if (encounterTransitionRepairRequirement.downgradeTerminalWarToNarrative) {
      const startedAt = Date.now();
      const startedAtIso = new Date(startedAt).toISOString();
      const detail = [
        'code=encounter_transition_downgraded_terminal_troop',
        `troopIds=${encounterTransitionRepairRequirement.terminalTroopIds.join(',')}`,
      ].join('；');
      input.emitProcessingStage({
        stage: 'repairingStateWriteback',
        label: '按剧情承接战争切入',
        status: 'started',
        startedAt: startedAtIso,
        detail,
      });
      response = downgradeTerminalWarEncounterToNarrative(
        response,
        encounterTransitionRepairRequirement,
      );
      rawContent = JSON.stringify(response, null, 2);
      input.emitProcessingStage({
        stage: 'repairingStateWriteback',
        label: '按剧情承接战争切入',
        status: 'finished',
        startedAt: startedAtIso,
        elapsedMs: Date.now() - startedAt,
        detail,
      });
    } else if (encounterTransitionRepairRequirement.required) {
      let repairRequirement = encounterTransitionRepairRequirement;
      let repairCompleted = false;
      for (let attempt = 1; attempt <= 2 && !repairCompleted; attempt += 1) {
        try {
          const repaired = await runProcessingStage(
            input.emitProcessingStage,
            'repairingStateWriteback',
            attempt === 1 ? '校正战斗切入' : '再次校正战斗切入',
            { provider: apiConfig.provider, model: apiConfig.model },
            () => requestEncounterTransitionRepair({
              apiConfig,
              llmClient,
              worldBook: input.worldBook,
              runtimeState: input.runtimeState,
              playerInput: input.fallbackContext.playerInput,
              encounterIntentCreatedAt: input.encounterIntentCreatedAt,
              originalResponse: response,
              requirement: repairRequirement,
              requestBudget: postNarrativeBudget.getChildRequestBudget({ allowRetry: false }),
            }),
          );
          usage = mergeTokenUsage(usage, repaired.usage);
          response = mergeEncounterTransitionRepairResponse(response, repaired.response, {
            runtimeState: input.runtimeState,
            worldBook: input.worldBook,
            requirement: encounterTransitionRepairRequirement,
          });
          rawContent = JSON.stringify(response, null, 2);
          repairCompleted = true;
        } catch (error) {
          rethrowIfTurnCancelled(error, input.options.signal);
          const repairError = getErrorMessage(error);
          if (attempt === 1) {
            repairRequirement = {
              ...repairRequirement,
              referenceErrors: [
                ...repairRequirement.referenceErrors,
                `首份切入校正未通过本地原子校验，必须完整重做声明：${repairError}`,
              ],
            };
            continue;
          }
          response = appendWritebackDebugNote(
            response,
            `战斗切入结构化校正连续两次失败：${repairError}`,
          );
        }
      }
    }

    if (!hasExplicitTimeAdvancePatch(response)) {
      const useStateWritebackApi = Boolean(
        successfulStateWritebackApiConfig
        && successfulStateWritebackLlmClient
        && stateWritebackRepairSucceeded,
      );
      const primaryRepairApiConfig = useStateWritebackApi ? successfulStateWritebackApiConfig! : apiConfig;
      const primaryRepairLlmClient = useStateWritebackApi ? successfulStateWritebackLlmClient! : llmClient;
      let repaired: Awaited<ReturnType<typeof requestTimeAdvanceRepair>>;

      try {
        repaired = await runProcessingStage(
          input.emitProcessingStage,
          'repairingTimeAdvance',
          '修复时间推进',
          { provider: primaryRepairApiConfig.provider, model: primaryRepairApiConfig.model },
          () => requestTimeAdvanceRepair({
            apiConfig: primaryRepairApiConfig,
            llmClient: primaryRepairLlmClient,
            currentDate: input.currentDate,
            playerInput: input.fallbackContext.playerInput,
            originalContent: JSON.stringify(response, null, 2),
            requestBudget: postNarrativeBudget.getChildRequestBudget(),
          }),
        );
      } catch (error) {
        rethrowIfTurnCancelled(error, input.options.signal);
        if (!useStateWritebackApi) {
          if (error instanceof TimeAdvanceRepairError && error.originalError !== undefined) {
            throw error.originalError;
          }
          throw error;
        }
        if (error instanceof TimeAdvanceRepairError) {
          usage = mergeTokenUsage(usage, error.usage);
        }

        response = appendWritebackDebugNote(
          response,
          `状态写回 API 未能补齐时间推进，已回退主剧情 API：${getErrorMessage(error)}`,
        );
        repaired = await runProcessingStage(
          input.emitProcessingStage,
          'repairingTimeAdvance',
          '修复时间推进（备用）',
          { provider: apiConfig.provider, model: apiConfig.model },
          () => requestTimeAdvanceRepair({
            apiConfig,
            llmClient,
            currentDate: input.currentDate,
            playerInput: input.fallbackContext.playerInput,
            originalContent: JSON.stringify(response, null, 2),
            requestBudget: postNarrativeBudget.getChildRequestBudget(),
          }),
        );
      }

      response = mergeTimeAdvanceRepairResponse(response, repaired.response);
      rawContent = JSON.stringify(response, null, 2);
      usage = mergeTokenUsage(usage, repaired.usage);
    }

    input.options.signal?.throwIfAborted();
    const acceptedRuntimeState = prepareNpcComplianceAcceptedRuntimeState({
      patches: collectStatePatches(response),
      worldBook: input.worldBook,
      runtimeState: input.runtimeState,
      writeback: response.writeback,
      applyOptions: { openingInitialization: input.options.openingInitialization },
    });
    const missingNpcProfileCandidates = detectMissingNpcProfileCandidates({
      runtimeState: input.runtimeState,
      acceptedRuntimeState,
      response,
    });
    if (missingNpcProfileCandidates.length > 0) {
      const npcProfileRepairApiConfig = input.options.npcCompletionApiConfig ?? apiConfig;
      const npcProfileRepairLlmClient = input.options.npcCompletionApiConfig
        ? (input.options.npcCompletionLlmClient ?? llmClient)
        : llmClient;
      const npcProfileFallbackApiConfig = input.options.npcCompletionFallbackApiConfig
        && !isSameApiConfig(input.options.npcCompletionFallbackApiConfig, npcProfileRepairApiConfig)
        ? input.options.npcCompletionFallbackApiConfig
        : null;
      const npcProfileFallbackLlmClient = npcProfileFallbackApiConfig
        ? (input.options.npcCompletionFallbackLlmClient ?? llmClient)
        : null;
      const skipPrimaryAfterStateWritebackFailure = isSameApiConfig(
        stateWritebackRepairFailedApiConfig,
        npcProfileRepairApiConfig,
      );
      if (skipPrimaryAfterStateWritebackFailure) {
        input.emitProcessingStage({
          stage: 'repairingNpcProfiles',
          label: '补全 NPC 人物志',
          status: 'skipped',
          detail: NPC_PROFILE_REPAIR_SKIPPED_AFTER_STATE_WRITEBACK_FAILURE_DETAIL,
          provider: npcProfileRepairApiConfig.provider,
          model: npcProfileRepairApiConfig.model,
        });
        response = appendWritebackDebugNote(
          response,
          NPC_PROFILE_REPAIR_SKIPPED_AFTER_STATE_WRITEBACK_FAILURE_NOTE,
        );
        rawContent = JSON.stringify(response, null, 2);
      }

      let npcProfileRepairCompleted = false;
      if (!skipPrimaryAfterStateWritebackFailure) {
        try {
          const repaired = await runProcessingStage(
            input.emitProcessingStage,
            'repairingNpcProfiles',
            '补全 NPC 人物志',
            {
              provider: npcProfileRepairApiConfig.provider,
              model: npcProfileRepairApiConfig.model,
            },
            async () => {
              const repairedResult = await requestNpcProfileComplianceRepair({
                apiConfig: npcProfileRepairApiConfig,
                llmClient: npcProfileRepairLlmClient,
                runtimeState: input.runtimeState,
                currentDate: input.currentDate,
                playerInput: input.fallbackContext.playerInput,
                candidates: missingNpcProfileCandidates,
                originalResponse: response,
                requestBudget: capOptionalWritebackRequestBudget(
                  postNarrativeBudget.getChildRequestBudget({ allowRetry: false }),
                ),
              });
              return mergeRequiredNpcProfileRepairResult({
                original: response,
                repaired: repairedResult,
                runtimeState: input.runtimeState,
                candidates: missingNpcProfileCandidates,
              });
            },
          );
          response = repaired.response;
          rawContent = JSON.stringify(response, null, 2);
          usage = mergeTokenUsage(usage, repaired.usage);
          npcProfileRepairCompleted = true;
        } catch (error) {
          rethrowIfTurnCancelled(error, input.options.signal);
          if (error instanceof NpcProfileRepairAcceptanceError) {
            response = error.response;
            usage = mergeTokenUsage(usage, error.usage);
          }
          response = appendWritebackDebugNote(
            response,
            error instanceof NpcProfileRepairAcceptanceError
              ? `NPC建档主要 API 已返回但未落库：${getErrorMessage(error)}`
              : `NPC建档主要 API 失败：${getErrorMessage(error)}`,
          );
          rawContent = JSON.stringify(response, null, 2);
        }
      }

      if (!npcProfileRepairCompleted && npcProfileFallbackApiConfig && npcProfileFallbackLlmClient) {
        try {
          const repaired = await runProcessingStage(
            input.emitProcessingStage,
            'repairingNpcProfiles',
            '补全 NPC 人物志（备用 API）',
            {
              provider: npcProfileFallbackApiConfig.provider,
              model: npcProfileFallbackApiConfig.model,
            },
            async () => {
              const repairedResult = await requestNpcProfileComplianceRepair({
                apiConfig: npcProfileFallbackApiConfig,
                llmClient: npcProfileFallbackLlmClient,
                runtimeState: input.runtimeState,
                currentDate: input.currentDate,
                playerInput: input.fallbackContext.playerInput,
                candidates: missingNpcProfileCandidates,
                originalResponse: response,
                requestBudget: capOptionalWritebackRequestBudget(
                  postNarrativeBudget.getChildRequestBudget({ allowRetry: false }),
                ),
              });
              return mergeRequiredNpcProfileRepairResult({
                original: response,
                repaired: repairedResult,
                runtimeState: input.runtimeState,
                candidates: missingNpcProfileCandidates,
              });
            },
          );
          response = repaired.response;
          response = appendWritebackDebugNote(
            response,
            `NPC建档主要 API 未完成，已切换备用 API：${npcProfileFallbackApiConfig.model}`,
          );
          rawContent = JSON.stringify(response, null, 2);
          usage = mergeTokenUsage(usage, repaired.usage);
        } catch (fallbackError) {
          rethrowIfTurnCancelled(fallbackError, input.options.signal);
          if (fallbackError instanceof NpcProfileRepairAcceptanceError) {
            response = fallbackError.response;
            usage = mergeTokenUsage(usage, fallbackError.usage);
          }
          response = appendWritebackDebugNote(
            response,
            fallbackError instanceof NpcProfileRepairAcceptanceError
              ? `NPC建档备用 API 已返回但未落库：${getErrorMessage(fallbackError)}`
              : `NPC建档备用 API 失败：${getErrorMessage(fallbackError)}`,
          );
          rawContent = JSON.stringify(response, null, 2);
        }
      }
    }

    input.options.signal?.throwIfAborted();
    const postNpcAdmissionRuntimeState = prepareNpcComplianceAcceptedRuntimeState({
      patches: collectStatePatches(response),
      worldBook: input.worldBook,
      runtimeState: input.runtimeState,
      writeback: response.writeback,
      applyOptions: { openingInitialization: input.options.openingInitialization },
    });
    if (postNpcAdmissionRuntimeState) {
      response = materializeStructuredTurnSummaryStatePatches(
        response,
        postNpcAdmissionRuntimeState,
        input.currentDate,
      );
      const unresolvedAdmissions = (response.writeback?.turnSummary?.npcAdmissions ?? [])
        .filter((fact) => !(postNpcAdmissionRuntimeState.npcs ?? []).some((npc) => (
          npc.npcId === fact.npcId || npc.name === fact.name
        )));
      if (unresolvedAdmissions.length > 0) {
        response = appendWritebackDebugNote(
          response,
          `结构化人物准入尚未完成建档：${unresolvedAdmissions.map((fact) => fact.name).join('、')}`,
        );
      }
      rawContent = JSON.stringify(response, null, 2);
    }

    input.options.signal?.throwIfAborted();
    const uniqueArtAcceptedRuntimeState = prepareNpcComplianceAcceptedRuntimeState({
      patches: collectStatePatches(response),
      worldBook: input.worldBook,
      runtimeState: input.runtimeState,
      writeback: response.writeback,
      applyOptions: { openingInitialization: input.options.openingInitialization },
    });
    const uniqueArtCandidates = uniqueArtAcceptedRuntimeState
      ? detectNpcUniqueArtComplianceCandidates({
          runtimeState: input.runtimeState,
          acceptedRuntimeState: uniqueArtAcceptedRuntimeState,
          response,
          playerInput: input.fallbackContext.playerInput,
        })
      : [];
    if (uniqueArtCandidates.length > 0) {
      const startedAt = Date.now();
      const startedAtIso = new Date(startedAt).toISOString();
      input.emitProcessingStage({
        stage: 'repairingNpcProfiles',
        label: '本地补全 NPC 稳定绝艺',
        status: 'started',
        startedAt: startedAtIso,
        provider: 'local',
        model: 'npc-unique-art-policy-v1',
        detail: `候选：${uniqueArtCandidates.map((candidate) => candidate.name).join('、')}`,
      });
      const localRepair = mergeNpcUniqueArtComplianceLocally({
        original: response,
        acceptedRuntimeState: uniqueArtAcceptedRuntimeState ?? input.runtimeState,
        candidates: uniqueArtCandidates,
        currentDate: input.currentDate,
      });
      response = localRepair.response;
      rawContent = JSON.stringify(response, null, 2);
      input.emitProcessingStage({
        stage: 'repairingNpcProfiles',
        label: '本地补全 NPC 稳定绝艺',
        status: 'finished',
        startedAt: startedAtIso,
        elapsedMs: Date.now() - startedAt,
        provider: 'local',
        model: 'npc-unique-art-policy-v1',
        detail: localRepair.appliedNames.length > 0
          ? `已写入：${localRepair.appliedNames.join('、')}`
          : `未写入：${localRepair.rejectionNotes.join('；') || '候选已满足本地合同'}`,
      });
    }

    return {
      response,
      mode: 'llm',
      provider: result.provider,
      model: result.model,
      usage,
      rawContent,
      postNarrativeBudget,
      narrativeLengthRegeneration,
    };
  }

  const mockResponse = generateMockNarrative(input.fallbackContext);
  return {
    response: mockResponse,
    mode: 'mock',
    rawContent: JSON.stringify(mockResponse, null, 2),
  };
}

interface EncounterTransitionRepairRequirement {
  required: boolean;
  referenceErrors: string[];
  preserveWarStart: boolean;
  invalidDeclarationPatchIndexes: number[];
  downgradeTerminalWarToNarrative: boolean;
  terminalTroopIds: string[];
}

function buildEncounterTransitionRepairRequirement(
  response: NarratorResponse,
  runtimeState: RuntimeState,
  worldBook: WorldBook,
): EncounterTransitionRepairRequirement {
  const decision = response.writeback?.encounterTransitionDecision;
  const intent = response.writeback?.encounterStartIntent;
  const preserveWarStart = decision?.mode === 'start' && intent?.kind === 'war';
  if (!decision) {
    return {
      required: false,
      referenceErrors: [],
      preserveWarStart,
      invalidDeclarationPatchIndexes: [],
      downgradeTerminalWarToNarrative: false,
      terminalTroopIds: [],
    };
  }
  if (decision.mode === 'none') {
    return {
      required: Boolean(intent),
      referenceErrors: intent ? ['mode=none 不得携带 encounterStartIntent。'] : [],
      preserveWarStart,
      invalidDeclarationPatchIndexes: [],
      downgradeTerminalWarToNarrative: false,
      terminalTroopIds: [],
    };
  }
  if (!intent) {
    return {
      required: true,
      referenceErrors: [`mode=${decision.mode} 缺少合法 encounterStartIntent。`],
      preserveWarStart,
      invalidDeclarationPatchIndexes: [],
      downgradeTerminalWarToNarrative: false,
      terminalTroopIds: [],
    };
  }
  if (decision.mode === 'offer' && intent.kind !== 'personal_combat') {
    return {
      required: true,
      referenceErrors: ['offer 只能绑定 personal_combat。'],
      preserveWarStart,
      invalidDeclarationPatchIndexes: [],
      downgradeTerminalWarToNarrative: false,
      terminalTroopIds: [],
    };
  }

  const preview = prepareNarratorStatePatchTransaction(
    collectStatePatches(response),
    response.writeback,
    worldBook,
    runtimeState,
  );
  const invalidDeclarationPatchIndexes = preview.statePatches.flatMap((patch, index) => {
    if (preview.patchValidationResults[index]?.valid !== false) return [];
    const action = extractLuanShiCommandFromPatch(normalizeNarratorStatePatch(patch))?.action;
    return action === 'upsertTroopLedger' || action === 'upsertHoldingLedger'
      ? [preview.sourcePatchIndexes[index]]
      : [];
  });
  const invalidDeclarationErrors = preview.statePatches.flatMap((patch, index) => {
    if (preview.patchValidationResults[index]?.valid !== false) return [];
    const action = extractLuanShiCommandFromPatch(normalizeNarratorStatePatch(patch))?.action;
    if (action !== 'upsertTroopLedger' && action !== 'upsertHoldingLedger') return [];
    const sourceIndex = preview.sourcePatchIndexes[index];
    return preview.patchValidationResults[index].errors.map(
      (error) => `原 statePatches[${sourceIndex}] 的 ${action} 声明无效，必须用完整声明替换：${error}`,
    );
  });
  const referenceErrors = [
    ...collectEncounterReferenceErrors(
      preview.statePatchDraft,
      response,
      intent,
    ),
    ...invalidDeclarationErrors,
  ];
  const terminalTroopIds = intent.kind === 'war'
    ? collectTerminalWarTroopReferences(preview.statePatchDraft, intent)
        .map((reference) => reference.troopId)
    : [];
  return {
    required: referenceErrors.length > 0,
    referenceErrors,
    preserveWarStart: preserveWarStart && terminalTroopIds.length === 0,
    invalidDeclarationPatchIndexes,
    downgradeTerminalWarToNarrative: terminalTroopIds.length > 0,
    terminalTroopIds: [...new Set(terminalTroopIds)],
  };
}

function downgradeTerminalWarEncounterToNarrative(
  response: NarratorResponse,
  requirement: EncounterTransitionRepairRequirement,
): NarratorResponse {
  const originalIntent = response.writeback?.encounterStartIntent;
  if (!originalIntent || originalIntent.kind !== 'war') return response;

  const quarantined = quarantineEncounterTriggerResultPatches(
    collectStatePatches(response),
    originalIntent,
  );
  const writeback = normalizeWriteback(response.writeback);
  const troopIds = [...new Set(requirement.terminalTroopIds)].sort();
  const quarantineNote = quarantined.removedCount > 0
    ? `；已隔离 ${quarantined.removedCount} 条触发回合战争结果写回`
    : '';

  return {
    ...response,
    statePatches: quarantined.patches.length > 0 ? quarantined.patches : undefined,
    statePatch: null,
    writeback: {
      ...writeback,
      encounterTransitionDecision: {
        mode: 'none',
        reason: '参战引用包含历史建制，本回合按开放剧情承接。',
      },
      encounterStartIntent: null,
      debugNotes: [
        ...writeback.debugNotes,
        `code=encounter_transition_downgraded_terminal_troop；troopIds=${troopIds.join(',')}`
          + `；message=历史建制不进入 War V2，正文与其他合法写回继续提交${quarantineNote}。`,
      ],
    },
  };
}

function mergeEncounterTransitionRepairResponse(
  original: NarratorResponse,
  repaired: NarratorResponse,
  input: {
    runtimeState: RuntimeState;
    worldBook: WorldBook;
    requirement: EncounterTransitionRepairRequirement;
  },
): NarratorResponse {
  const repairedDecision = repaired.writeback?.encounterTransitionDecision;
  const repairedIntent = repaired.writeback?.encounterStartIntent;
  const originalDecision = original.writeback?.encounterTransitionDecision;
  const originalIntent = original.writeback?.encounterStartIntent;
  const decision = input.requirement.preserveWarStart ? originalDecision : repairedDecision;
  const intent = input.requirement.preserveWarStart ? originalIntent : repairedIntent;
  if (!decision) throw new Error('校正响应缺少 encounterTransitionDecision。');
  if (decision.mode !== 'none' && !intent) {
    throw new Error(`校正响应选择 ${decision.mode}，但缺少合法 encounterStartIntent。`);
  }
  if (decision.mode === 'offer' && intent?.kind !== 'personal_combat') {
    throw new Error('校正响应的 offer 只能绑定 personal_combat。');
  }
  if (input.requirement.preserveWarStart && (decision.mode !== 'start' || intent?.kind !== 'war')) {
    throw new Error('既有战争 start 的原始意图已经失效，不能仅靠声明修复。');
  }

  const declarationPatches = collectEncounterEntityDeclarationPatches(repaired);
  if (decision.mode === 'none' && declarationPatches.length > 0) {
    throw new Error('mode=none 不得附带战争实体声明。');
  }

  const writeback = normalizeWriteback(original.writeback);
  const invalidDeclarationPatchIndexes = new Set(
    input.requirement.invalidDeclarationPatchIndexes,
  );
  const retainedOriginalPatches = collectStatePatches(original)
    .filter((_, index) => !invalidDeclarationPatchIndexes.has(index));
  const mergedPatches = [
    ...retainedOriginalPatches,
    ...declarationPatches,
  ];
  const replacementCount = invalidDeclarationPatchIndexes.size;
  const declarationSummary = [
    replacementCount > 0 ? `替换 ${replacementCount} 条无效战争实体声明` : '',
    declarationPatches.length > 0 ? `写入 ${declarationPatches.length} 条完整战争实体声明` : '',
  ].filter(Boolean).join('，');
  const candidate: NarratorResponse = {
    ...original,
    statePatches: mergedPatches.length > 0 ? mergedPatches : undefined,
    statePatch: null,
    writeback: {
      ...writeback,
      encounterTransitionDecision: decision,
      encounterStartIntent: decision.mode === 'none' ? null : intent,
      debugNotes: [
        ...writeback.debugNotes,
        declarationSummary
          ? `Encounter V2 切入引用已由窄结构化请求校正，${declarationSummary}；正文及其他写回保持不变。`
          : 'Encounter V2 切入决定已由窄结构化请求校正；正文及其他写回保持不变。',
      ],
    },
  };
  const remaining = buildEncounterTransitionRepairRequirement(
    candidate,
    input.runtimeState,
    input.worldBook,
  );
  if (remaining.required) {
    throw new Error(`校正后的 Encounter V2 引用仍不完整：${remaining.referenceErrors.join('；')}`);
  }
  return candidate;
}

function collectEncounterEntityDeclarationPatches(response: NarratorResponse): StatePatch[] {
  const patches = collectStatePatches(response);
  for (const patch of patches) {
    const command = extractLuanShiCommandFromPatch(normalizeNarratorStatePatch(patch));
    if (command?.action !== 'upsertTroopLedger' && command?.action !== 'upsertHoldingLedger') {
      throw new Error('切入窄修复只允许追加 upsertTroopLedger / upsertHoldingLedger。');
    }
  }
  return patches;
}

interface TerminalWarTroopReference {
  troopId: string;
  sideLabel: '我方' | '敌方';
  lifecycleStatus: NonNullable<RuntimeState['troops']>[number]['lifecycleStatus'];
}

function collectTerminalWarTroopReferences(
  state: RuntimeState,
  intent: WarStartIntent,
): TerminalWarTroopReference[] {
  const troopsById = new Map((state.troops ?? []).map((troop) => [troop.troopId, troop]));
  const references: TerminalWarTroopReference[] = [];
  const collect = (troopIds: readonly string[], sideLabel: TerminalWarTroopReference['sideLabel']) => {
    for (const troopId of troopIds) {
      const troop = troopsById.get(troopId);
      if (!troop || isCurrentTroopLedgerEntry(troop)) continue;
      references.push({
        troopId,
        sideLabel,
        lifecycleStatus: troop.lifecycleStatus ?? 'archived',
      });
    }
  };
  collect(intent.playerForce.troopIds, '我方');
  collect(intent.enemyForce.troopIds, '敌方');
  return references;
}

function collectEncounterReferenceErrors(
  state: RuntimeState,
  response: NarratorResponse,
  intent: EncounterStartIntent,
  includeUnappliedActorSuggestions = true,
): string[] {
  const actorIds = new Set<string>([
    state.player.id,
    ...(state.knownActors ?? []).map((actor) => actor.id),
    ...(state.npcs ?? []).map((npc) => npc.npcId),
    ...(includeUnappliedActorSuggestions
      ? (response.writeback?.npcProfileSuggestions ?? []).map((npc) => npc.npcId)
      : []),
  ]);

  if (intent.kind === 'personal_combat') {
    const scopedIds = new Set((intent.scopedCombatants ?? []).map((combatant) => combatant.actorId));
    return [...intent.playerParty.actorIds, ...intent.enemyParty.actorIds]
      .filter((actorId) => !actorIds.has(actorId) && !scopedIds.has(actorId))
      .map((actorId) => `个人战角色 ${actorId} 不存在于当前角色账本或本场临时声明。`);
  }

  const troopIds = new Set((state.troops ?? []).map((troop) => troop.troopId));
  const holdingIds = new Set((state.holdings ?? []).map((holding) => holding.holdingId));
  const errors: string[] = [];
  for (const troopId of intent.playerForce.troopIds) {
    if (!troopIds.has(troopId)) errors.push(`我方部队 ${troopId} 不存在于当前或同回合声明的部队账本。`);
  }
  for (const troopId of intent.enemyForce.troopIds) {
    if (!troopIds.has(troopId)) errors.push(`敌方部队 ${troopId} 不存在于当前或同回合声明的部队账本。`);
  }
  for (const reference of collectTerminalWarTroopReferences(state, intent)) {
    errors.push(
      `${reference.sideLabel}部队 ${reference.troopId} 的 lifecycleStatus=${reference.lifecycleStatus ?? 'archived'}`
      + '，属于历史建制，不能进入 War V2；可继续作为追击、收拢、招降或战后处置的剧情对象。',
    );
  }
  for (const [label, actorId] of [
    ['我方主将', intent.playerForce.commanderActorId],
    ['敌方主将', intent.enemyForce.commanderActorId],
  ] as const) {
    if (actorId && !actorIds.has(actorId)) errors.push(`${label} ${actorId} 不存在于当前或同回合声明的角色账本。`);
  }
  if (
    intent.objective !== 'defeat_enemy'
    && (!intent.targetHoldingId || !holdingIds.has(intent.targetHoldingId))
  ) {
    errors.push(`战争目标领地 ${intent.targetHoldingId ?? '(missing)'} 不存在于当前或同回合声明的领地账本。`);
  }
  return errors;
}

function assertEncounterReferenceIntegrity(
  state: RuntimeState,
  response: NarratorResponse,
  intent: EncounterStartIntent,
  includeUnappliedActorSuggestions: boolean,
): void {
  const errors = collectEncounterReferenceErrors(
    state,
    response,
    intent,
    includeUnappliedActorSuggestions,
  );
  if (errors.length > 0) {
    throw new Error(
      `Encounter V2 引用完整性校验失败：${errors.join('；')} 本回合未写入，避免保存正文与底层战斗分裂的状态。`,
    );
  }
}

async function requestEncounterTransitionRepair(input: {
  apiConfig: ApiConfigArchive;
  llmClient: LlmClient;
  worldBook: WorldBook;
  runtimeState: RuntimeState;
  playerInput: string;
  encounterIntentCreatedAt: string;
  originalResponse: NarratorResponse;
  requirement: EncounterTransitionRepairRequirement;
  requestBudget: TurnLlmRequestBudget;
}): Promise<{
  response: NarratorResponse;
  usage?: LlmTokenUsage;
}> {
  const result = await input.llmClient.generate({
    config: input.apiConfig,
    messages: buildEncounterTransitionRepairMessages(input),
    temperature: 0,
    maxOutputTokens: Math.min(input.apiConfig.maxOutputTokens ?? 4096, 4096),
    responseFormat: 'json_object',
    ...input.requestBudget,
  });
  input.requestBudget.signal?.throwIfAborted();
  return {
    response: parseNarratorResponse(result.content, {
      encounterIntentCreatedAt: input.encounterIntentCreatedAt,
      encounterIntentSourceTurnNumber: input.runtimeState.turnLog.length + 1,
      correspondenceSources: buildCorrespondenceParserSources(input.runtimeState),
    }),
    usage: result.usage,
  };
}

function buildEncounterTransitionRepairMessages(input: {
  worldBook: WorldBook;
  runtimeState: RuntimeState;
  playerInput: string;
  encounterIntentCreatedAt: string;
  originalResponse: NarratorResponse;
  requirement: EncounterTransitionRepairRequirement;
}): LlmMessage[] {
  const actorLines = [
    `- player.id=${input.runtimeState.player.id}；name=${input.runtimeState.player.name}`,
    ...input.runtimeState.knownActors.slice(0, 24)
      .map((actor) => `- actor.id=${actor.id}；name=${actor.name}`),
    ...(input.runtimeState.npcs ?? []).slice(0, 24)
      .map((npc) => `- npcId=${npc.npcId}；name=${npc.name}；在场=${isNpcPhysicallyPresent(input.runtimeState, npc) ? '是' : '否'}`),
  ];
  const troopLines = (input.runtimeState.troops ?? [])
    .filter(isCurrentTroopLedgerEntry)
    .slice(0, 24)
    .map((troop) => (
      `- troopId=${troop.troopId}；name=${troop.name}；factionId=${troop.factionId ?? 'unknown'}；`
      + `locationId=${troop.locationId ?? troop.lastKnownLocationId ?? 'unknown'}`
    ));
  const holdingLines = (input.runtimeState.holdings ?? [])
    .slice(0, 24)
    .map((holding) => (
      `- holdingId=${holding.holdingId}；name=${holding.name}；locationId=${holding.locationId ?? 'unknown'}；`
      + `status=${holding.status}；controller=${holding.actualController ?? holding.factionId ?? 'unknown'}`
    ));
  const preview = prepareNarratorStatePatchTransaction(
    collectStatePatches(input.originalResponse),
    input.originalResponse.writeback,
    input.worldBook,
    input.runtimeState,
  );
  const mapIndex = buildRuntimeMapIndex(input.worldBook, preview.statePatchDraft);
  const mapLines = Object.values(mapIndex.nodeById)
    .slice(0, 48)
    .map((node) => `- locationId=${node.id}；name=${node.name}；level=${node.level}`);
  const nextTurnNumber = input.runtimeState.turnLog.length + 1;

  return [
    {
      role: 'system',
      content: [
        '你是乱世风云录的 Encounter V2 切入校正器。',
        '只判断已经生成的正文边界，不得重写正文，不得补写胜负、伤害、状态补丁、人物志、记忆或其他写回。',
        '只返回一个符合指定外壳的 JSON 对象，不要输出 Markdown 或解释。',
        '每次必须给 encounterTransitionDecision：',
        '- start：兵刃已经挥出、箭矢已经射出、骑手已经冲入敌阵、双方已经发生不可避免的身体交锋；即使攻击由同伴或敌人发动也算 start。',
        '- offer：仅用于个人战；拔刀、威胁、追逐、对峙、准备冲锋，但玩家仍可决定是否交手。',
        '- none：没有本地冲突边界、只是远处观察/传闻，或无需规则裁定的小动作已完整结束。',
        'start/offer 必须同时输出合法 encounterStartIntent；none 必须输出 null。War 只允许 start/none。',
        '已有姓名人物必须复用角色账本稳定 ID。只有没有长期身份且不应进人物志的溃卒、匪徒、刺客等短时敌人可用 scopedCombatants。',
        '临时敌人 actorId 必须为 encounterId + ":scoped:enemy_N"，必须同时出现在 enemyParty.actorIds；archetype 只能 rabble/militia/regular/veteran/elite，weaponClass 只能 unarmed/light/standard/polearm/heavy/ranged，armorClass 只能 none/light/medium/heavy。',
        '不得输出临时敌人的自由属性、等级、装备数值或战利品。',
        'War 必须优先复用现有 troopId / holdingId。若正文已经明确建立了地图目标或实际参战部队、但账本确实尚未登记，可以在本次响应的 statePatches 中追加完整 upsertTroopLedger / upsertHoldingLedger，并让 war intent 逐字引用同批新 ID。',
        'War 只能引用下方“可复用当前部队 ID”。历史建制不得进入 playerForce/enemyForce；追击、收拢、招降、押解或清剿零散溃兵可以继续开放剧情，不得为了强行进入 War V2 复活旧 troopId 或随意替换其他现役部队。',
        '同批声明只登记开战前已经成立的实体事实；禁止写胜负、伤亡、溃散、领地易手、围城解除、upsertConflictRecord 或其他状态补丁。',
        '若原响应已有未通过校验的 upsertTroopLedger / upsertHoldingLedger，本次必须返回对应实体的完整合法声明；运行时会用本次声明替换原失败槽，不能只补零散字段。',
        '不得按名称把目标模糊映射到不相干旧条目；新增战争目标领地必须复用真实 Map locationId，写 operation=create、status=contested，并附 kind=war_target 的 controlEvidence。单纯驻军、守城或位于城墙不得登记为玩家领地。新增部队必须给出剧情已经明确的规模、阵营、位置与战备事实。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `当前稳定地点 ID：${input.runtimeState.currentLocationId}`,
        `当前存档时间（新声明 updatedAt 必须逐字使用）：${input.runtimeState.currentDate}`,
        `本次 sourceTurnNumber：${nextTurnNumber}`,
        `本地 createdAt：${input.encounterIntentCreatedAt}`,
        `玩家行动：${input.playerInput}`,
        `必须修复的引用问题：${input.requirement.referenceErrors.join('；') || '切入结构不完整'}`,
        '',
        '## 可复用角色 ID',
        actorLines.join('\n'),
        '',
        '## 可复用当前部队 ID',
        troopLines.join('\n') || '- 无',
        '',
        '## 可复用当前领地 ID',
        holdingLines.join('\n') || '- 无',
        '',
        '## 可复用 Map V1 地点 ID',
        mapLines.join('\n') || '- 无',
        '',
        '## 已生成正文（只读）',
        input.originalResponse.narrativeText,
        '',
        '返回格式外壳：',
        JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '',
          suggestedActions: [],
          statePatches: [],
          statePatch: null,
          writeback: {
            encounterTransitionDecision: {
              mode: 'none|offer|start',
              reason: '一句话语义依据',
            },
            encounterStartIntent: null,
          },
        }, null, 2),
        '',
        'personal_combat intent 必须使用 contractVersion=1、rulesetVersion="combat-v2.0.0"、当前 sourceTurnNumber/locationId/createdAt；playerParty/enemyParty 各 1—3 人且不得重叠。',
        input.requirement.preserveWarStart
          ? '原响应已有合法 start + war intent：本次只返回实体声明，运行时会原样保留原 encounterTransitionDecision / encounterStartIntent；不得改写 ID、playerForce/enemyForce、objective、policy、seed 或 createdAt。'
          : 'war intent 必须使用 contractVersion=1、rulesetVersion="war-v2.1.0"，并只引用当前账本或本次 statePatches 同批完整声明的稳定 ID；必须使用 playerForce/enemyForce，不得写 attacker/defender。',
        '新部队声明必须至少包含 action=upsertTroopLedger、troopId、name、size、morale、training、supplies、task、relationToPlayer、troopType、quality、fatigue、readiness、lifecycleStatus、knownLevel、certainty、locationId，并在已知时包含 factionId。',
        '部队字段枚举必须逐字使用本项目合同：relationToPlayer 写自然中文短句（如“敌对”），troopType 写具体中文兵种（步卒/骑兵/弓弩兵/水军/斥候/辎重队/守军/民兵/混编/乱兵），quality 只能低/中/高/精锐，fatigue 只能低/中/高/极高，readiness 只能低/中/高，lifecycleStatus 本场新军写 active，knownLevel 只能亲历/听闻/推测，certainty 只能 confirmed/reported/rumor/uncertain；不得写 hostile/infantry/regular/exact/full、数字 readiness/fatigue/certainty 或英文 task。',
        '新领地声明必须包含 action=upsertHoldingLedger、operation=create、holdingId、name、type、status=contested、summary、civilAdministrationScope、scaleLevel、agriculture、commerce、population、publicOrder、popularSupport、defense、recruitPotential、armory、horseSupply、locationId、actualController、updatedAt，并包含 controlEvidence={kind:"war_target",occurredAt:当前存档时间,sourceRefId:本次 encounterId,summary:已明确成立的战争目标事实}；民政范围不是 none 时还必须写 civilScaleLevel=1-5。type 只能 county/city/fort/pass/camp/estate/port/village/other，county 是具体县城/县邑，州与郡国是区域父级而不是领地实体，禁止 commandery；status 只能 controlled/contested/temporary/lost/archived，civilAdministrationScope 只能 none/households/territorial/mixed；scaleLevel 是据点规模，civilScaleLevel 是独立民政体量；city 最高民政 5 级，county/fort/pass/camp/port 最高 4 级，estate/other 最高 3 级，village 最高 2 级；各项分数只能 0-100，田亩编户不得超过类型、范围与民政规模上限，updatedAt 必须是上方给出的当前存档时间字符串，不得为空或写数字。',
        'civilAdministrationScope 不是 none 时还要包含 corruption=0-100；等于 none 时 agriculture/commerce/population/publicOrder/popularSupport/recruitPotential 必须全部为 0 且不得包含 corruption、farmlandMu、registeredHouseholds、eliteControlledShare、localEliteRelation。',
        '声明补丁外壳固定为 {"type":"luanshiCommand","reason":"登记本回合开战前已经成立的战争实体","payload":{"command":{...}}}。',
      ].join('\n'),
    },
  ];
}

interface StateWritebackRepairResult {
  response: NarratorResponse;
  rawContent: string;
  usage?: LlmTokenUsage;
}

async function runStateWritebackRepairStage(input: {
  emit: TurnProcessingStageEmitter;
  label: string;
  meta: Pick<TurnProcessingStageEvent, 'provider' | 'model'>;
  initialRequestBudget: TurnLlmRequestBudget;
  retryRequestBudget: () => TurnLlmRequestBudget;
  retryEmptyContent?: boolean;
  request: (requestBudget: TurnLlmRequestBudget) => Promise<StateWritebackRepairResult>;
}): Promise<StateWritebackRepairResult> {
  try {
    return await runProcessingStage(
      input.emit,
      'repairingStateWriteback',
      input.label,
      input.meta,
      () => input.request(input.initialRequestBudget),
    );
  } catch (error) {
    if (!(error instanceof LlmEmptyContentError)) throw error;
    if (input.retryEmptyContent === false) throw error;

    try {
      const retried = await runProcessingStage(
        input.emit,
        'repairingStateWriteback',
        `${input.label}（空输出重试）`,
        input.meta,
        () => input.request(input.retryRequestBudget()),
      );
      return {
        ...retried,
        usage: mergeTokenUsage(error.usage, retried.usage),
      };
    } catch (retryError) {
      if (retryError instanceof LlmEmptyContentError) {
        throw new LlmEmptyContentError(
          '状态写回连续两次返回空内容',
          mergeTokenUsage(error.usage, retryError.usage),
        );
      }
      throw retryError;
    }
  }
}

async function requestStateWritebackRepair(input: {
  apiConfig: ApiConfigArchive;
  llmClient: LlmClient;
  runtimeState: RuntimeState;
  currentDate: string;
  playerInput: string;
  stateWriterContext: string;
  encounterIntentCreatedAt: string;
  originalResponse: NarratorResponse;
  statePatchDiagnostics: StatePatchValidationDiagnostic[];
  mapWritebackRepairDiagnostics: NarratorMapWritebackRepairDiagnostic[];
  judgementMarkerIntegrityIssues: JudgementMarkerIntegrityIssue[];
  playerEconomyWritebackReviewRequired: boolean;
  playerEconomyWritebackReviewAttempt: 1 | 2;
  scenePresenceWritebackReviewRequired: boolean;
  requestBudget: TurnLlmRequestBudget;
}): Promise<{
  response: NarratorResponse;
  rawContent: string;
  usage?: LlmTokenUsage;
}> {
  const result = await input.llmClient.generate({
    config: input.apiConfig,
    messages: buildStateWritebackRepairMessages({
      ...input,
      cacheLayout: resolveTurnPromptCacheLayout(input.apiConfig),
    }),
    temperature: 0,
    maxOutputTokens: input.apiConfig.maxOutputTokens,
    responseFormat: 'json_object',
    ...input.requestBudget,
  });
  input.requestBudget.signal?.throwIfAborted();

  return {
    response: parseNarratorResponse(result.content, {
      encounterIntentCreatedAt: input.encounterIntentCreatedAt,
      encounterIntentSourceTurnNumber: input.runtimeState.turnLog.length + 1,
      correspondenceSources: buildCorrespondenceParserSources(input.runtimeState),
    }),
    rawContent: result.content,
    usage: result.usage,
  };
}

function buildStateWritebackRepairMessages(input: {
  runtimeState: RuntimeState;
  currentDate: string;
  playerInput: string;
  stateWriterContext: string;
  originalResponse: NarratorResponse;
  statePatchDiagnostics: StatePatchValidationDiagnostic[];
  mapWritebackRepairDiagnostics: NarratorMapWritebackRepairDiagnostic[];
  judgementMarkerIntegrityIssues: JudgementMarkerIntegrityIssue[];
  playerEconomyWritebackReviewRequired: boolean;
  playerEconomyWritebackReviewAttempt: 1 | 2;
  scenePresenceWritebackReviewRequired: boolean;
  cacheLayout?: TurnPromptCacheLayout;
}): LlmMessage[] {
  const allowInventoryScopeNarrativeCorrection =
    hasPlayerInventoryDestructiveScopeDiagnostic(input.statePatchDiagnostics);
  const privateAssetAcquisitionWritebackReviewRequired =
    requiresPrivateAssetAcquisitionWritebackReview(input.runtimeState, input.originalResponse);
  const inventoryScopeInstruction = allowInventoryScopeNarrativeCorrection
    ? '本次存在“主角物品破坏范围越界”诊断：suggestedActions、ordinaryChecks 仍不得重写；narrativeText 只允许最小删除或改正“玩家未操作的其他物品已核销、交出、消耗、遗失或损毁”这类越界事实，其余正文必须保持原意与顺序。'
    : '不得重写 narrativeText、suggestedActions、ordinaryChecks；这些字段由主回合正文决定。';
  const stateWriterSections = input.cacheLayout === 'deepseek_prefix'
    ? splitStateWriterContext(input.stateWriterContext)
    : null;
  const useDeepSeekPrefixLayout = stateWriterSections !== null;
  return [
    {
      role: 'system',
      content: [
        '你是乱世风云录的状态写回整理器。',
        '只返回一个 JSON 对象，不要输出 Markdown 或解释。',
        ...(useDeepSeekPrefixLayout ? [] : [inventoryScopeInstruction]),
        '你的任务只是在不新增剧情事实的前提下，整理 statePatches/statePatch 和 writeback。',
        '所有状态修改仍会经过严格 validator；不要输出 setState、path、value 之类任意变量写入。',
        '不确定的事实不要写入；不得制造未知势力、未知部队、占位主将或工程枚举。',
        '部队 knownLevel 表示证据来源层级（亲历/听闻/推测），certainty 表示可信度（confirmed/reported/rumor/uncertain），不得机械同步；可靠军报可为听闻+confirmed，失联通常只降低 certainty，推测+confirmed 不得组合。',
        '若正文已经明确某个钱粮、势力、部队、人物、任务、风声或纪事发生变化，应补成现有协议允许的结构化写回。',
        '若 turnSummary.privateAssetAcquisitions 非空，逐项核对是否已有使用相同 sourceRefId 的 upsertPrivateAsset。产权已完成但命令缺失时，必须在 statePatches 尾部补齐 operation=create 的严格私产命令；已有同一产业则复用其 privateAssetId 更新，禁止重复建档。不得把谈判、看契书、代管、驻守、租用、口头许诺、争议中产权或玩家单方面声称取得补成私产。',
        '逐句复核最终 narrativeText 中已有势力已经采取的新行动：玩家以该势力成员、首领或代表身份完成的势力行为，以及通过传闻、军报、密报、使者或线索新获知的其他势力行动，都必须在 writeback.factionRecentActionSuggestions 逐项补齐；必须复用当前势力稳定 factionId，并按亲历/听闻/推测填写 knownLevel。通用 statePatches.recordFactionRecentAction 只作兼容，不要在两处重复同一动作。不得把提议、问题、计划、背景介绍或未发生结果提前落账。',
        '必须逐项核对玩家行动、最终 narrativeText、主角个人钱财余额和完整背包真值：个人收支已成立却缺少 personalMoneyDelta、物品实际获得却缺少 upsert、物品消耗/交出/遗失/损毁/过期或一次性凭证权益兑现却缺少 remove/setQuantity 时，应在尾部补齐对应 updatePlayerLoadout。',
        '仅在正文中提到、看见、出示、核验或回忆既有物品不等于再次获得；不得为此追加 upsert。更新同一种既有物品必须逐字复用当前背包 itemId，不得另造 ID；upsert.quantity 是变化后的绝对总数。',
        '购买、出售或以个人钱财换取/交出物品已经成立时，钱财与物品两侧必须成对写回；势力粮草、军械等公共资源仍写 updateResourceLedger，不得混入个人钱财。',
        '单一物品操作不得扩散到其他稳定 ID：不能因同属手令、凭证、文书、药品、名称相似或此前曾被提及，就批量消耗、核销、交出或移除其他物品。若原响应破坏性修改了玩家行动未明确点名的现存物品，必须从同一 updatePlayerLoadout 槽位移除这些额外变更；本回合确需操作多个现存物品时，玩家行动必须逐项明确点名。',
        '状态写入上下文中的 openCurrentMatterLifecycleLedger 是全量未结事项：逐项审阅，只有本回合事实明确完成、失败或失效时才复用 questId 写 complete/fail/invalidate；不得只看前四条，也不得按标题关键词、存续时长或期限机械结案。',
        'complete/fail/invalidate 是当前事项终态并由本地同回合归入历史；archive 只用于无成功/失败结论但已不再牵连玩家的旧事项。',
        'worldEventSummary 只允许区域以上大势：scope 必须为 regional/realm/world，并有冲突或势力/部队/领地/跨地点宏观锚点；local 和主角个人重要行动不得补成纪事。一次性结束事件写 historical，active/cooling 必须有 progressSummary 和复核/推进时间锚点。',
        'statePatches 必须保留已有的合法 timeAdvance；若原响应缺少有效 timeAdvance，应根据玩家行动与正文补充合理的时间推进。',
        '若提供 StatePatch validator 逐条诊断，必须在一次响应中处理全部失败项，并返回修正后的完整有序 statePatches。',
        '若提供地图写回逐条诊断，必须按 kind 与 suggestionIndex 修正原 locationWriteSuggestions/routeWriteSuggestions 对应槽位；复用原稳定 ID，不得删除失败槽或改写无关合法地点。',
        '若提供判定标记一致性诊断，必须按标记中的稳定 ID 在 statePatches 尾部补充对应 upsertConflictRecord 或 upsertCombatRecord；只能使用正文已明确发生的事实，不得改写或删除 narrativeText 中的判定标记。',
        '若本次要求补全当前场景在场名单，必须根据原始最终正文与最后一条 locationChange，在 writeback.turnSummary.scenePresence 返回本回合结束时的完整场景真值：locationId 使用最终 toSceneId，未提供时使用最终 toLocationId；presentNpcIds 只填已经存在的人物志稳定 npcId，无人时明确返回 []。同城异场景、远场关注、书信、传闻、正在赶来或任务相关者不得列入。不得扫描关键词或创造新 NPC。',
        'StatePatch validator 逐条诊断非空时，返回数组的前 N 项必须按原始 patchIndex 一一对应；不得增删、合并或重排槽位（这里的槽位只指原始 N 项）。若同时存在判定标记一致性诊断，只允许在这 N 项之后追加对应的判定记录。',
        'StatePatch validator 逐条诊断为空时，原始 raw statePatches 必须作为修复数组规范化后深度不变的同序前缀；只能在尾部追加正文有依据的缺失写回，不得删除、替换或重排原槽，新增项也不得与原前缀或其他新增项规范化后完全相同。',
        '未报错 raw 槽位必须在规范化后与原 patch 深度完全一致，包括 sanitizer 会过滤的 no-op；每个报错槽位必须保留原 reason 作为意图锚点，并在同一索引提供可通过 validator 且不会被 sanitizer 过滤的合法替代。',
        '原槽属于已支持 patch 类型且 command action 也已知时，修复后还必须保持同一规范化 type/command action；只有原槽本身是未知 patch 类型，或 luanshiCommand 的 action 本身未知时，才允许按正文与 reason 锚点改成合法协议。',
        '未知 patch 类型或未知 command action 的失败槽，reason 必须非空且在本批未知失败槽中唯一；重复或空 reason 无法安全绑定原意图，整批自动修复会被拒绝。',
        '原有 timeAdvance 必须保持原索引且规范化后的完整内容不变；不得把原有非 timeAdvance 槽改成 timeAdvance。',
        '不得通过静默删除失败条目来规避诊断；若原状态变化有正文依据，必须改写为合法协议并保留其语义。',
        'timeAdvance 必须使用协议范围内的正数：minutesAdvanced 1-4320、hoursAdvanced 1-72、daysAdvanced 1-365、timeBlocksAdvanced 1-36；超过三天优先改用 daysAdvanced，不得用 0、负数或超限值占位。',
        'resourceChanged 必须且只能提供 change 或 newValue 之一：mode=delta 时只写 change，mode=absolute 时只写 newValue；不得同时保留两个数值字段。',
        '若正文没有足够证据，则保留原写回，不要为了补字段编造。',
        '部队 size 是当前已入账兵力绝对值，不是本回合提到的人数增量；操练、训练、整顿、打散编入、以老带新、分屯、换装、补给或军纪整肃只更新训练、士气、任务、标签、补给等字段，保持原 size。',
        '不得把同一批已入账新卒重复加到 size；只有明确出现再次扩军、另募、新一批兵源、调拨、收编、招降、归队、合并、伤亡或逃散时，才允许改 size/previousSize，并在 lastChangeReason/sourceNote 写明新来源。',
        'updateNpcBackgroundActivity 必须直接包含已有 npcId 与 activity；activity 为对象时必须包含 activityId、summary、status，清除旧槽时才写 null；不得只保留 action。',
        ...(useDeepSeekPrefixLayout
          ? ['', stateWriterSections.stableProtocol, '', inventoryScopeInstruction]
          : []),
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `当前时间：${input.currentDate}`,
        `当前地点ID：${input.runtimeState.currentLocationId}`,
        `玩家：${input.runtimeState.player.name}（${input.runtimeState.player.roleType}）`,
        `玩家行动：${input.playerInput}`,
        '',
        useDeepSeekPrefixLayout ? '## 状态写入上下文（本回合运行态）' : '## 状态写入上下文',
        useDeepSeekPrefixLayout
          ? stateWriterSections.runtimeContext
          : stripStateWriterStableProtocolMarker(input.stateWriterContext),
        '',
        '## 已知状态摘要',
        formatStateWritebackRuntimeSummary(input.runtimeState),
        '',
        '## StatePatch validator 逐条诊断',
        JSON.stringify(input.statePatchDiagnostics, null, 2),
        '',
        '## 地图写回逐条诊断',
        JSON.stringify(input.mapWritebackRepairDiagnostics, null, 2),
        '',
        '## 判定标记一致性诊断',
        JSON.stringify(input.judgementMarkerIntegrityIssues, null, 2),
        '',
        '## 本次主角物品与个人钱财复核焦点',
        input.playerEconomyWritebackReviewRequired
          ? [
              `这是第 ${input.playerEconomyWritebackReviewAttempt} 次独立复核。`,
              input.playerEconomyWritebackReviewAttempt === 2
                ? '上一次复核没有产生可接受的完整 statePatches；请从原始响应重新独立核对，不要沿用上一次遗漏。'
                : '',
              '结构完整性检查发现本回合可能涉及主角物品、个人钱财或公共资源，但现有写回可能缺项或越过玩家明确点名的物品范围。该信号本身不代表变化已经成立：请先根据玩家行动与最终 narrativeText 独立判断事实；若交易、收支、取得、消费、交出或一次性权益兑现已经成立，必须使用当前稳定 ID 补齐所有相关侧；若正文只是在提及、查看、核验、计划或未完成，则保持对应状态不变。所有未被玩家行动明确点名却遭破坏性修改的现存物品都必须从写回中移除；不得因类别或名称相似批量处理。',
            ].filter(Boolean).join('\n')
          : '无额外主角经济复核信号；仍按正文事实和 validator 诊断处理。',
        '',
        '## 本次私人产业产权复核焦点',
        privateAssetAcquisitionWritebackReviewRequired
          ? 'turnSummary 已提供完成的产权取得事实，但当前稳定私产账本和 statePatches 中至少有一项缺少相同 sourceRefId。请根据该结构化事实与最终 narrativeText 补齐合法 upsertPrivateAsset；规模必须保守并服从本地上限，不得另造每日收益、库存或钱粮。'
          : '没有待补的结构化产权取得事实；不得仅凭正文词语联想或玩家要求擅自新建私产。',
        '',
        '## 本次当前场景在场名单复核焦点',
        input.scenePresenceWritebackReviewRequired
          ? '原响应发生了地点切换，却没有提供可安全结算的最终场景名单。请仅依据原始最终正文和最后一条 locationChange 补齐 writeback.turnSummary.scenePresence；保留原始 statePatches 同序前缀，不得重写正文或猜测同城人物在场。'
          : '无需额外补全场景名单；保留原有结构化在场事实。',
        '',
        '## 原始回合响应',
        JSON.stringify(input.originalResponse, null, 2),
        '',
        '返回格式：',
        JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: input.originalResponse.narrativeText,
          suggestedActions: input.originalResponse.suggestedActions ?? [],
          ordinaryChecks: input.originalResponse.ordinaryChecks ?? [],
          statePatches: collectStatePatches(input.originalResponse),
          statePatch: null,
          writeback: normalizeWriteback(input.originalResponse.writeback),
        }, null, 2),
      ].join('\n'),
    },
  ];
}

function formatStateWritebackRuntimeSummary(runtimeState: RuntimeState): string {
  const playerInventory = (runtimeState.player.inventory ?? [])
    .map((item) => [
      `- itemId=${item.id}`,
      `name=${item.name}`,
      `quantity=${item.quantity}`,
      `category=${item.category ?? '未分类'}`,
      `keyItem=${item.keyItem === true ? 'true' : 'false'}`,
    ].join('；'))
    .join('\n');
  const factions = (runtimeState.factions ?? [])
    .slice(0, 24)
    .map((faction) => `- 势力：${faction.name}；id=${faction.factionId}；类型=${faction.type}；态度=${faction.stanceToPlayer}`)
    .join('\n');
  const troopEntries = runtimeState.troops ?? [];
  const currentTroops = troopEntries
    .filter(isCurrentTroopLedgerEntry)
    .slice(0, 24)
    .map((troop) => [
      `- 部队：${troop.name}`,
      `id=${troop.troopId}`,
      `factionId=${troop.factionId ?? '未写'}`,
      `leaderNpcId=${troop.leaderNpcId ?? '未写'}`,
      `deputyNpcIds=${troop.deputyNpcIds?.join(',') || '未写'}`,
      `strategistNpcId=${troop.strategistNpcId ?? '未写'}`,
      `relation=${troop.relationToPlayer}`,
      `size=${troop.size}`,
      `lifecycle=${troop.lifecycleStatus ?? 'active'}`,
    ].join('；'))
    .join('\n');
  const historicalTroops = troopEntries
    .filter((troop) => !isCurrentTroopLedgerEntry(troop))
    .slice(0, 24)
    .map((troop) => [
      `- 历史部队：${troop.name}`,
      `id=${troop.troopId}`,
      `lifecycle=${troop.lifecycleStatus ?? 'archived'}`,
      troop.mergedIntoTroopId ? `mergedInto=${troop.mergedIntoTroopId}` : '',
      troop.childTroopIds?.length ? `childTroopIds=${troop.childTroopIds.join(',')}` : '',
      `size=${troop.size}`,
    ].filter(Boolean).join('；'))
    .join('\n');
  const npcs = (runtimeState.npcs ?? [])
    .slice(0, 24)
    .map((npc) => `- NPC：${npc.name}；id=${npc.npcId}；身份=${npc.currentIdentity ?? npc.role}；在场=${isNpcPhysicallyPresent(runtimeState, npc) ? '是' : '否'}`)
    .join('\n');
  const privateAssets = (runtimeState.privateAssets ?? [])
    .map((asset) => [
      `- 私产：${asset.name}`,
      `id=${asset.privateAssetId}`,
      `type=${asset.type}`,
      `ownerScope=${asset.ownerScope}`,
      `status=${asset.status}`,
      `mu=${asset.mu ?? '未写'}`,
      `households=${asset.households ?? '未写'}`,
      `workers=${asset.workers ?? '未写'}`,
      `workshopScale=${asset.workshopScale ?? '未写'}`,
      `ranchCapacity=${asset.ranchCapacity ?? '未写'}`,
    ].join('；'))
    .join('\n');
  const privateAssetProjects = (runtimeState.privateAssetProjects ?? [])
    .map((project) => [
      `- 私产工程：${project.title}`,
      `projectId=${project.projectId}`,
      `assetId=${project.assetId}`,
      `status=${project.status}`,
      `expectedCompleteAt=${project.expectedCompleteAt ?? '未写'}`,
    ].join('；'))
    .join('\n');

  return [
    [
      `主角身份：id=${runtimeState.player.id}`,
      `currentIdentity=${runtimeState.player.currentIdentity ?? '未写'}`,
      `factionId=${runtimeState.player.factionId ?? '未写'}`,
      `factionName=${runtimeState.player.factionName ?? '未写'}`,
      `officeTitle=${runtimeState.player.officeTitle ?? '未写'}`,
      `militaryTitle=${runtimeState.player.militaryTitle ?? '未写'}`,
      `nobleTitle=${runtimeState.player.nobleTitle ?? '未写'}`,
      `identitySummary=${runtimeState.player.identitySummary ?? '未写'}`,
    ].join('；'),
    `主角个人钱财余额=${typeof runtimeState.player.personalMoney === 'number' && Number.isFinite(runtimeState.player.personalMoney) ? runtimeState.player.personalMoney : 0}`,
    '主角当前背包（写回前完整稳定 ID 真值）：',
    playerInventory || '- 暂无',
    `资源：钱=${runtimeState.resources?.money ?? '未记录'}；粮=${runtimeState.resources?.grain ?? '未记录'}；马=${runtimeState.resources?.horses ?? '未记录'}；军械=${runtimeState.resources?.arms ?? '未记录'}；可征召人手=${runtimeState.resources?.recruits ?? '未记录'}`,
    '已知势力：',
    factions || '- 暂无',
    '当前部队：',
    currentTroops || '- 暂无',
    '历史建制（不得计入当前兵力）：',
    historicalTroops || '- 暂无',
    '已知 NPC：',
    npcs || '- 暂无',
    '私人产业稳定账本：',
    privateAssets || '- 暂无',
    '私人产业工程稳定账本：',
    privateAssetProjects || '- 暂无',
  ].join('\n');
}

interface StateWritebackRepairMergeResult {
  response: NarratorResponse;
  patchCandidateAccepted: boolean;
}

function buildCorrespondenceParserSources(
  runtimeState: RuntimeState,
): NonNullable<ParseNarratorResponseOptions['correspondenceSources']> {
  return (runtimeState.correspondence ?? []).flatMap((entry) => {
    const npcId = entry.direction === 'outgoing'
      ? entry.recipient.kind === 'npc' ? entry.recipient.npcId : undefined
      : entry.sender.kind === 'npc' ? entry.sender.npcId : undefined;
    if (!npcId) return [];
    return [{
      letterId: entry.letterId,
      direction: entry.direction,
      npcId,
    }];
  });
}

function mergeStateWritebackRepairResponse(
  original: NarratorResponse,
  repaired: NarratorResponse,
  options: {
    worldBook: WorldBook;
    runtimeState: RuntimeState;
    statePatchDiagnostics: StatePatchValidationDiagnostic[];
    mapWritebackRepairDiagnostics: NarratorMapWritebackRepairDiagnostic[];
    judgementMarkerIntegrityIssues: JudgementMarkerIntegrityIssue[];
  },
): StateWritebackRepairMergeResult {
  const originalPatches = collectStatePatches(original);
  const repairedPatches = collectStatePatches(repaired);
  const locationRepairTargets = collectDiagnosedLocationRepairTargets(
    originalPatches,
    original.writeback,
    options.statePatchDiagnostics,
    options.mapWritebackRepairDiagnostics,
  );
  const candidateWriteback = mergeStateWritebackProtocol(
    original.writeback,
    repaired.writeback,
    locationRepairTargets,
  );
  const candidatePatches = options.statePatchDiagnostics.length > 0
    ? repairedPatches
    : preserveTimeAdvancePatches(originalPatches, repairedPatches);
  const hasNoPatchConflict = options.statePatchDiagnostics.length === 0
    && options.mapWritebackRepairDiagnostics.length === 0
    && originalPatches.length === 0
    && repairedPatches.length === 0;
  const patchCandidateAccepted = hasNoPatchConflict || (
    (repairedPatches.length > 0 || options.mapWritebackRepairDiagnostics.length > 0)
    && preservesOriginalTimeAdvanceSlots(originalPatches, candidatePatches)
    && isCompleteStatePatchRepair(originalPatches, candidatePatches, {
      ...options,
      writeback: candidateWriteback,
    })
    && (
      options.judgementMarkerIntegrityIssues.length === 0
      || findOrphanJudgementMarkers(original.narrativeText, candidatePatches).length === 0
    )
  );
  const nextPatches = patchCandidateAccepted ? candidatePatches : originalPatches;
  const allowInventoryScopeNarrativeCorrection =
    hasPlayerInventoryDestructiveScopeDiagnostic(options.statePatchDiagnostics);

  return {
    patchCandidateAccepted,
    response: {
      ...original,
      narrativeText: patchCandidateAccepted && allowInventoryScopeNarrativeCorrection
        ? repaired.narrativeText
        : original.narrativeText,
      statePatches: nextPatches.length > 0 ? nextPatches : undefined,
      statePatch: null,
      writeback: patchCandidateAccepted
        ? candidateWriteback
        : original.writeback,
    },
  };
}

function isCompleteStatePatchRepair(
  originalPatches: StatePatch[],
  repairedPatches: StatePatch[],
  options: {
    worldBook: WorldBook;
    runtimeState: RuntimeState;
    statePatchDiagnostics: StatePatchValidationDiagnostic[];
    mapWritebackRepairDiagnostics: NarratorMapWritebackRepairDiagnostic[];
    judgementMarkerIntegrityIssues: JudgementMarkerIntegrityIssue[];
    writeback?: NarratorWritebackProtocol;
  },
): boolean {
  if (options.statePatchDiagnostics.length === 0) {
    if (repairedPatches.length < originalPatches.length) return false;
    for (let index = 0; index < originalPatches.length; index += 1) {
      if (!areNormalizedStatePatchesEqual(originalPatches[index], repairedPatches[index])) {
        return false;
      }
    }
    if (!hasUniqueAppendedStatePatches(originalPatches, repairedPatches)) return false;
    const repairedTransaction = prepareNarratorStatePatchTransaction(
      repairedPatches,
      options.writeback,
      options.worldBook,
      options.runtimeState,
    );
    return (
      repairedTransaction.statePatches.length === 0
      || repairedTransaction.patchValidation?.valid === true
    );
  }
  if (repairedPatches.length < originalPatches.length) return false;
  if (
    repairedPatches.length > originalPatches.length
    && options.judgementMarkerIntegrityIssues.length === 0
  ) {
    return false;
  }
  if (!hasUniqueAppendedStatePatches(originalPatches, repairedPatches)) return false;

  const diagnosticByIndex = new Map(
    options.statePatchDiagnostics.map((diagnostic) => [diagnostic.patchIndex, diagnostic]),
  );
  if (!hasUnambiguousUnknownStatePatchIntents(originalPatches, options.statePatchDiagnostics)) {
    return false;
  }
  for (let index = 0; index < originalPatches.length; index += 1) {
    const diagnostic = diagnosticByIndex.get(index);
    if (diagnostic) {
      if (!matchesDiagnosedStatePatchSlotIntent(originalPatches[index], repairedPatches[index])) {
        return false;
      }
      continue;
    }
    if (!areNormalizedStatePatchesEqual(originalPatches[index], repairedPatches[index])) {
      return false;
    }
  }

  const repairedTransaction = prepareNarratorStatePatchTransaction(
    repairedPatches,
    options.writeback,
    options.worldBook,
    options.runtimeState,
  );
  if (repairedTransaction.patchValidation?.valid !== true) return false;

  const repairedIndexBySourceIndex = new Map(
    repairedTransaction.sourcePatchIndexes.map((sourcePatchIndex, transactionIndex) => [
      sourcePatchIndex,
      transactionIndex,
    ]),
  );
  return options.statePatchDiagnostics.every((diagnostic) => {
    const transactionIndex = repairedIndexBySourceIndex.get(diagnostic.patchIndex);
    return transactionIndex !== undefined
      && repairedTransaction.patchValidationResults[transactionIndex]?.valid === true;
  });
}

function hasUnambiguousUnknownStatePatchIntents(
  originalPatches: StatePatch[],
  diagnostics: StatePatchValidationDiagnostic[],
): boolean {
  const seenReasons = new Set<string>();
  for (const diagnostic of diagnostics) {
    const originalPatch = originalPatches[diagnostic.patchIndex];
    if (!originalPatch) return false;
    if (!hasUnknownStatePatchSlotIdentity(originalPatch)) continue;

    const reason = originalPatch.reason.trim();
    if (!reason || seenReasons.has(reason)) return false;
    seenReasons.add(reason);
  }
  return true;
}

function matchesDiagnosedStatePatchSlotIntent(
  originalPatch: StatePatch | undefined,
  repairedPatch: StatePatch | undefined,
): boolean {
  if (!originalPatch || !repairedPatch) return false;
  if (repairedPatch.reason.trim() !== originalPatch.reason.trim()) return false;

  const normalizedOriginal = normalizeNarratorStatePatch(originalPatch);
  if (!isAllowedPatchType(normalizedOriginal.type)) {
    return true;
  }
  if (hasUnknownStatePatchSlotIdentity(originalPatch)) {
    const normalizedRepaired = normalizeNarratorStatePatch(repairedPatch);
    const repairedCommand = extractLuanShiCommandFromPatch(normalizedRepaired);
    return normalizedRepaired.type === 'luanshiCommand'
      && isKnownLuanShiCommandAction(repairedCommand?.action);
  }
  if (normalizedOriginal.type === 'resourceChanged' || normalizedOriginal.type === 'relationshipChange') {
    return matchesRecoverableStatePatchBusinessIdentity(
      normalizedOriginal,
      normalizeNarratorStatePatch(repairedPatch),
    );
  }
  return getStatePatchSlotIdentity(originalPatch) === getStatePatchSlotIdentity(repairedPatch);
}

function collectDiagnosedLocationRepairTargets(
  originalPatches: StatePatch[],
  writeback: NarratorWritebackProtocol | undefined,
  diagnostics: StatePatchValidationDiagnostic[],
  mapDiagnostics: NarratorMapWritebackRepairDiagnostic[],
): { replaceLocationIds: ReadonlySet<string>; replaceRouteIds: ReadonlySet<string> } {
  const replaceLocationIds = new Set<string>();
  for (const diagnostic of diagnostics) {
    const patch = originalPatches[diagnostic.patchIndex];
    if (!patch) continue;
    const normalized = normalizeNarratorStatePatch(patch);
    if (normalized.type !== 'locationChange') continue;
    for (const field of ['toLocationId', 'toSceneId'] as const) {
      const value = normalized.payload?.[field];
      if (typeof value === 'string' && value.trim()) replaceLocationIds.add(value.trim());
    }
  }
  for (const diagnostic of mapDiagnostics) {
    const stableId = diagnostic.stableId?.trim();
    if (diagnostic.kind === 'location' && stableId) replaceLocationIds.add(stableId);
  }
  const replaceRouteIds = new Set(
    (writeback?.routeWriteSuggestions ?? [])
      .filter((route) => (
        replaceLocationIds.has(route.fromPlaceId.trim())
        || replaceLocationIds.has(route.toPlaceId.trim())
      ))
      .map((route) => route.routeId?.trim() ?? '')
      .filter(Boolean),
  );
  for (const diagnostic of mapDiagnostics) {
    const stableId = diagnostic.stableId?.trim();
    if (diagnostic.kind === 'route' && stableId) replaceRouteIds.add(stableId);
  }
  return { replaceLocationIds, replaceRouteIds };
}

function hasUnknownStatePatchSlotIdentity(patch: StatePatch): boolean {
  const normalizedPatch = normalizeNarratorStatePatch(patch);
  if (!isAllowedPatchType(normalizedPatch.type)) return true;
  if (normalizedPatch.type !== 'luanshiCommand') return false;
  const command = extractLuanShiCommandFromPatch(normalizedPatch);
  return !isKnownLuanShiCommandAction(command?.action);
}

function getStatePatchSlotIdentity(patch: StatePatch | undefined): string {
  if (!patch) return 'missing';
  const normalizedPatch = normalizeNarratorStatePatch(patch);
  const command = extractLuanShiCommandFromPatch(normalizedPatch);
  return command?.action
    ? `${normalizedPatch.type}:${command.action}`
    : normalizedPatch.type;
}

function areNormalizedStatePatchesEqual(
  left: StatePatch | undefined,
  right: StatePatch | undefined,
): boolean {
  if (!left || !right) return false;
  return getNormalizedStatePatchKey(left) === getNormalizedStatePatchKey(right);
}

function hasUniqueAppendedStatePatches(
  originalPatches: StatePatch[],
  repairedPatches: StatePatch[],
): boolean {
  const seenPatchKeys = new Set(originalPatches.map((patch) => getNormalizedStatePatchKey(patch)));
  for (let index = originalPatches.length; index < repairedPatches.length; index += 1) {
    const patchKey = getNormalizedStatePatchKey(repairedPatches[index]);
    if (seenPatchKeys.has(patchKey)) return false;
    seenPatchKeys.add(patchKey);
  }
  return true;
}

function getNormalizedStatePatchKey(patch: StatePatch): string {
  return JSON.stringify(toCanonicalJson(normalizeNarratorStatePatch(patch)));
}

function toCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toCanonicalJson(item));
  }
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = toCanonicalJson((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}

function preserveTimeAdvancePatches(originalPatches: StatePatch[], repairedPatches: StatePatch[]): StatePatch[] {
  if (repairedPatches.some((patch) => normalizeNarratorStatePatch(patch).type === 'timeAdvance')) {
    return repairedPatches;
  }

  const nextPatches = [...repairedPatches];
  originalPatches.forEach((patch, index) => {
    if (normalizeNarratorStatePatch(patch).type !== 'timeAdvance') return;
    nextPatches.splice(Math.min(index, nextPatches.length), 0, patch);
  });
  return nextPatches;
}

function preservesOriginalTimeAdvanceSlots(
  originalPatches: StatePatch[],
  candidatePatches: StatePatch[],
): boolean {
  const originalHasTimeAdvance = originalPatches.some(
    (patch) => normalizeNarratorStatePatch(patch).type === 'timeAdvance',
  );
  for (let index = 0; index < originalPatches.length; index += 1) {
    const originalPatch = originalPatches[index];
    const candidatePatch = candidatePatches[index];
    const originalIsTimeAdvance = normalizeNarratorStatePatch(originalPatch).type === 'timeAdvance';
    const candidateIsTimeAdvance = Boolean(candidatePatch)
      && normalizeNarratorStatePatch(candidatePatch).type === 'timeAdvance';

    if (originalIsTimeAdvance && !areNormalizedStatePatchesEqual(originalPatch, candidatePatch)) {
      return false;
    }
    if (!originalIsTimeAdvance && candidateIsTimeAdvance) {
      return false;
    }
  }
  if (originalHasTimeAdvance && candidatePatches.slice(originalPatches.length).some(
    (patch) => normalizeNarratorStatePatch(patch).type === 'timeAdvance',
  )) {
    return false;
  }
  return true;
}

function mergeStateWritebackProtocol(
  original: NarratorWritebackProtocol | undefined,
  repaired: NarratorWritebackProtocol | undefined,
  options: {
    replaceLocationIds?: ReadonlySet<string>;
    replaceRouteIds?: ReadonlySet<string>;
  } = {},
): NarratorWritebackProtocol {
  const base = normalizeWriteback(original);
  if (!hasMeaningfulWriteback(repaired)) {
    return base;
  }

  return mergeRepairWritebackProtocol(base, repaired, options);
}

async function requestNpcProfileComplianceRepair(input: {
  apiConfig: ApiConfigArchive;
  llmClient: LlmClient;
  runtimeState: RuntimeState;
  currentDate: string;
  playerInput: string;
  candidates: MissingNpcProfileCandidate[];
  originalResponse: NarratorResponse;
  requestBudget: TurnLlmRequestBudget;
}): Promise<{
  response: NarratorResponse;
  rawContent: string;
  usage?: LlmTokenUsage;
}> {
  const result = await input.llmClient.generate({
    config: input.apiConfig,
    messages: buildNpcProfileComplianceRepairMessages(input),
    temperature: 0,
    maxOutputTokens: input.apiConfig.maxOutputTokens,
    responseFormat: 'json_object',
    ...input.requestBudget,
  });
  input.requestBudget.signal?.throwIfAborted();

  return {
    response: parseNarratorResponse(result.content),
    rawContent: result.content,
    usage: result.usage,
  };
}

function buildNpcProfileComplianceRepairMessages(input: {
  runtimeState: RuntimeState;
  currentDate: string;
  playerInput: string;
  candidates: MissingNpcProfileCandidate[];
  originalResponse: NarratorResponse;
}): LlmMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是乱世风云录的 NPC 人物志合规修复器。',
        '只返回一个 JSON 对象，不要输出 Markdown 或解释。',
        '不得重写 narrativeText，不得改写 suggestedActions、ordinaryChecks、statePatches 或 statePatch。',
        '候选缺档人物不等于必须建档。先判断其是否已经具有长期承接价值；一次性斥候、流民、守门兵、村民、仆役、信使、临时敌兵即使有姓名、发话或参战，也应跳过。',
        '准入必须看本回合结束后的身份：若上述普通人物已经实际完成招募、收留、正式任命、长期托付或后续联络约定，就必须建档；不得因为其开场身份是斥候、流民等而跳过。尚未完成的打算、试探或可能性仍应跳过。',
        '只为通过长期准入的人物补 writeback.npcProfileSuggestions；没有任何候选通过时返回空数组。不要补地点、势力、任务、风声或纪事。',
        '不要硬编码历史结论；只能根据原回合正文、写回内容、候选证据、当前时间地点和已有 NPC 档案做保守补全。',
        '远场被提及或同一回合重复姓名本身不是长期准入证据，不得为了修复完整率虚构未来重要性。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `当前时间：${input.currentDate}`,
        `当前地点ID：${input.runtimeState.currentLocationId}`,
        `玩家：${input.runtimeState.player.name}（${input.runtimeState.player.roleType}）`,
        `玩家行动：${input.playerInput}`,
        '',
        '已有 NPC 档案，必须复用已有 npcId，不得重复建档：',
        formatExistingNpcSummary(input.runtimeState),
        '',
        '候选缺档人物：',
        formatNpcProfileRepairCandidates(input.candidates),
        '',
        '补档字段要求：',
        '- 每个新建 npcProfileSuggestions[] 必须包含 npcId/name/persistenceReason/persistenceEvidence/sex/age/birthDate/role/locationId/isPresent/isFocused/currentIdentity/summary/appearance/personality/motivation/relationToPlayer/contactLevel/recentAttitude/abilityScores/traits；birthDate 必须是公元YYYY年MM月DD日的完整日期，本地历法每月 30 天。',
        '- 候选给出的 npcId、name、persistenceReason、persistenceEvidence 均来自本回合结构化准入事实或原始档案候选；补档必须逐字复用，不得另造 ID、改名或降低准入理由。',
        '- JSON 字段类型是严格合同：sex 只能逐字写“男”“女”“其他”，不得写 male/female；age 必须是大于 0 的整数；isPresent/isFocused 必须是 true/false 布尔值；contactLevel 必须是大于等于 0 的有限数字（初次正式接触通常写 1—10），不得写 frequent/close 等文字。',
        '- persistenceReason 只能是 opening_cast、historical_figure、active_system_role、recurring_contact、player_committed_relationship、strategic_actor；persistenceEvidence 必须引用本回合已经成立的长期事实。单纯姓名、发言、传令、参战、一次会面、可能再出现都不合格。',
        '- 按回合结束状态裁定：已经完成招募、收留、正式任命、长期托付或明确后续联络的人物必须补档，即使其开场只是斥候、流民、村民或守门兵；只有准备、考虑、试探和未完成计划仍应跳过。',
        '- recurring_contact 只适用于已知是第二次独立出场，或本回合已经明确约定后续会面/联络/任职；player_committed_relationship 只适用于玩家明确招募、结交、收留、托付、立约或要求长期联络；strategic_actor 必须已有稳定官职、军职、势力决策权或长期战略对抗身份。',
        '- abilityScores 必须完整包含：武力、统率、智力、政治、魅力、机运；六项值都必须是有限数字，不得写文字等级。',
        '- traits 至少 1 条，每条包含非空字符串 id/label/description/source，可含 rarity。',
        '- 新建 NPC 只要任一属性超过 50，就必须同时写 uniqueArts。最低品级：51—59=white、60—69=green、70—79=blue、80—89=purple、90—94=orange、95及以上=red；武力/统率/智力/政治/魅力/机运分别对应 personalCombat/warfare/strategy/governance/social/survival。每个达到 80 的额外属性也要有达到自身最低品级的对应领域绝艺；统率或智力达到 70 时还必须覆盖相应 warfare/strategy 战争绝艺，两项都在 70—79 时只要求较高项。',
        '- uniqueArts 每项必须包含稳定 id/name/rarity/domain/level/description/effectSummary/source/acquisition；level 必须是 1—10 的整数，不得写 proficient/master 等文字；rarity 只能是 white/green/blue/purple/orange/red，domain 只能是 personalCombat/warfare/strategy/social/governance/survival/craft/other。acquisition 使用 {kind:"background",occurredAt:当前时间,sourceRefId:"npc-profile:<npcId>:background",summary:"由已经成立的身份、经历或档案事实确认该长期能力"}；不得把玩家主张或尚未发生的训练当来源，也不得生成只在本回合有效的一次性招式。',
        '- 年龄必须是数字；若原文没有精确年龄，按身份和年代做保守估计。',
        '- 无法确认其当前地点时，locationId 使用 "loc_unknown_remote"，并用 isPresent=false、summary/relationToPlayer 说明其为远场或听闻人物。',
        '- 重要 NPC 行装：若候选人是当前局势关键的上级、君主、重臣、将领、豪族首脑、使者、谈判对象或直接交锋者，且身份/场景足以推断其长期随身装备、官印符节、军令凭证、家族信物或随身文书，应在同一条 npcProfileSuggestions[].equipment / npcProfileSuggestions[].inventory 写入 1-3 件稳定行装。equipment 每项包含 id/slot/name/quality/description，slot 只能是 weapon/armor/mount/treasure；inventory 每项包含 id/name/quantity/category/description。不得硬编码具体名人专属宝物，不确定时写身份层级通用物件；普通远场传闻人物不要机械补行装。',
        '- 行装 quality 只能写 white/green/blue/purple/orange/red，对应普通/良好/精良/珍贵/传说/绝世。御赐、国宝、家传、军府制式等只是来源或身份标签，只能写在 name/description，不得作为 quality。',
        '',
        '返回格式：',
        JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: input.originalResponse.narrativeText,
          suggestedActions: [],
          statePatches: [],
          statePatch: null,
          writeback: {
            npcProfileSuggestions: [],
            npcMemorySuggestions: [],
            locationWriteSuggestions: [],
            routeWriteSuggestions: [],
            questChanges: [],
            debugNotes: [],
          },
        }, null, 2),
        '',
        '以下是第一次模型已经生成并解析后的回合响应。不得重写 narrativeText，只补缺失 NPC 人物志。',
        JSON.stringify(input.originalResponse, null, 2),
      ].join('\n'),
    },
  ];
}

function formatExistingNpcSummary(runtimeState: RuntimeState): string {
  const lines = (runtimeState.npcs ?? []).slice(0, 80).map((npc) => (
    `- ${npc.npcId}：${npc.name}；身份=${npc.currentIdentity ?? npc.role}；在场=${isNpcPhysicallyPresent(runtimeState, npc) ? '是' : '否'}`
  ));
  return lines.length > 0 ? lines.join('\n') : '- 当前暂无 NPC 档案。';
}

function formatNpcProfileRepairCandidates(candidates: MissingNpcProfileCandidate[]): string {
  return candidates.map((candidate) => [
    `- 稳定ID：${candidate.npcId}`,
    `  姓名：${candidate.name}`,
    `  准入理由：${candidate.persistenceReason}`,
    `  结构化准入已确认：${candidate.admissionConfirmed ? '是（必须建档）' : '否（允许合规复核）'}`,
    `  提及次数：${candidate.mentionCount}`,
    `  触发原因：${candidate.reasons.join('、')}`,
    `  证据：${candidate.evidence.join(' / ')}`,
  ].join('\n')).join('\n');
}

function mergeRequiredNpcProfileRepairResult(input: {
  original: NarratorResponse;
  repaired: {
    response: NarratorResponse;
    rawContent: string;
    usage?: LlmTokenUsage;
  };
  runtimeState: RuntimeState;
  candidates: MissingNpcProfileCandidate[];
}): {
  response: NarratorResponse;
  rawContent: string;
  usage?: LlmTokenUsage;
} {
  const merged = mergeNpcProfileRepairResponse(
    input.original,
    input.repaired.response,
    input.runtimeState,
    input.candidates,
  );
  if (merged.unresolvedConfirmed.length > 0) {
    const rejectionDetail = merged.rejectionDiagnostics.length > 0
      ? `；${merged.rejectionDiagnostics.join('；')}`
      : '；辅助模型没有返回能通过本地人物合同的对应档案';
    throw new NpcProfileRepairAcceptanceError(
      `结构化准入人物仍未建档：${merged.unresolvedConfirmed.map((candidate) => candidate.name).join('、')}${rejectionDetail}`,
      merged.response,
      input.repaired.usage,
    );
  }
  return {
    ...input.repaired,
    response: merged.response,
  };
}

interface NpcProfileRepairMergeResult {
  response: NarratorResponse;
  unresolvedConfirmed: MissingNpcProfileCandidate[];
  rejectionDiagnostics: string[];
}

function mergeNpcProfileRepairResponse(
  original: NarratorResponse,
  repaired: NarratorResponse,
  runtimeState: RuntimeState,
  candidates: MissingNpcProfileCandidate[],
): NpcProfileRepairMergeResult {
  const repairProfiles = repaired.writeback?.npcProfileSuggestions ?? [];
  const baseWriteback = normalizeWriteback(original.writeback);
  const mergeResult = mergeUniqueNpcProfiles(
    runtimeState,
    baseWriteback.npcProfileSuggestions ?? [],
    repairProfiles,
  );
  let response: NarratorResponse = {
    ...original,
    writeback: {
      ...baseWriteback,
      npcProfileSuggestions: mergeResult.profiles,
      debugNotes: [
        ...(baseWriteback.debugNotes ?? []),
        ...(mergeResult.addedNames.length > 0
          ? [`NPC建档合规修复补档：${mergeResult.addedNames.join('、')}`]
          : []),
        ...mergeResult.degradationDiagnostics.map((diagnostic) => (
          `NPC建档合规降级：${diagnostic}`
        )),
      ],
    },
  };

  if (repairProfiles.length === 0) {
    response = appendWritebackDebugNote(response, 'NPC建档合规修复未返回可用人物志');
  } else if (mergeResult.addedNames.length === 0 && mergeResult.rejectionDiagnostics.length === 0) {
    response = appendWritebackDebugNote(response, 'NPC建档合规修复返回的人物志已存在');
  }
  for (const diagnostic of mergeResult.rejectionDiagnostics) {
    response = appendWritebackDebugNote(response, `NPC建档合规修复拒绝：${diagnostic}`);
  }

  const acceptedState = applyAcceptedNpcProfilesForCompliance(
    runtimeState,
    mergeResult.profiles,
  );
  const unresolvedConfirmed = candidates.filter((candidate) => (
    candidate.admissionConfirmed
    && !(acceptedState.npcs ?? []).some((npc) => (
      npc.npcId === candidate.npcId || npc.name === candidate.name
    ))
  ));
  if (unresolvedConfirmed.length > 0) {
    response = appendWritebackDebugNote(
      response,
      `结构化人物准入补档未落库：${unresolvedConfirmed.map((candidate) => candidate.name).join('、')}`,
    );
  }

  return {
    response,
    unresolvedConfirmed,
    rejectionDiagnostics: mergeResult.rejectionDiagnostics,
  };
}

function mergeUniqueNpcProfiles(
  runtimeState: RuntimeState,
  originalProfiles: NarratorNpcProfileSuggestion[],
  repairProfiles: NarratorNpcProfileSuggestion[],
): {
  profiles: NarratorNpcProfileSuggestion[];
  addedNames: string[];
  degradationDiagnostics: string[];
  rejectionDiagnostics: string[];
} {
  let acceptedState = runtimeState;
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const profiles: NarratorNpcProfileSuggestion[] = [];
  const addedNames: string[] = [];
  const degradationDiagnostics: string[] = [];
  const rejectionDiagnostics: string[] = [];
  for (const profile of originalProfiles) {
    const result = tryApplyNpcProfileForCompliance(acceptedState, profile);
    if (!result.accepted || !result.acceptedProfile) continue;
    acceptedState = result.state;
    profiles.push(preserveNpcProfileReplayIdentity(profile, result.acceptedProfile));
    degradationDiagnostics.push(...result.diagnostics);
    seenIds.add(result.acceptedProfile.npcId);
    seenNames.add(result.acceptedProfile.name);
  }
  for (const profile of repairProfiles) {
    if (seenIds.has(profile.npcId) || seenNames.has(profile.name)) continue;
    const result = tryApplyNpcProfileForCompliance(acceptedState, profile);
    if (!result.accepted || !result.acceptedProfile) {
      rejectionDiagnostics.push(
        `${profile.name}(${profile.npcId})：${result.diagnostics.slice(0, 6).join('；') || '未通过本地人物合同'}`,
      );
      continue;
    }
    acceptedState = result.state;
    profiles.push(preserveNpcProfileReplayIdentity(profile, result.acceptedProfile));
    degradationDiagnostics.push(...result.diagnostics);
    seenIds.add(result.acceptedProfile.npcId);
    seenNames.add(result.acceptedProfile.name);
    addedNames.push(result.acceptedProfile.name);
  }
  return { profiles, addedNames, degradationDiagnostics, rejectionDiagnostics };
}

/**
 * 合规试应用会把旧人物的漂移 ID/别名归一为 canonical 身份；但最终正式应用仍需
 * 看见模型原始使用的别名，才能把同回合记忆、任务和事件里的引用一并重映射。
 * 因此保留已经过合同过滤的字段，只恢复本条建议的入口 ID 与入口姓名供别名表使用。
 */
function preserveNpcProfileReplayIdentity(
  incoming: NarratorNpcProfileSuggestion,
  accepted: NarratorNpcProfileSuggestion,
): NarratorNpcProfileSuggestion {
  const replayProfile: NarratorNpcProfileSuggestion = {
    ...accepted,
    npcId: incoming.npcId,
    name: incoming.name,
  };
  if (incoming.femaleProfile !== undefined) {
    replayProfile.femaleProfile = incoming.femaleProfile;
  }
  return replayProfile;
}

function mergeNpcUniqueArtComplianceLocally(input: {
  original: NarratorResponse;
  acceptedRuntimeState: RuntimeState;
  candidates: NpcUniqueArtComplianceCandidate[];
  currentDate: string;
}): {
  response: NarratorResponse;
  appliedNames: string[];
  rejectionNotes: string[];
} {
  const baseWriteback = normalizeWriteback(input.original.writeback);
  const nextProfiles = (baseWriteback.npcProfileSuggestions ?? []).map((profile) => ({ ...profile }));
  const nextPatches = collectStatePatches(input.original);
  const appliedNames: string[] = [];
  const rejectionNotes: string[] = [];

  for (const candidate of input.candidates) {
    const mergedArts = sanitizeUniqueArtsForCommand(completeNpcUniqueArtsLocally(
      candidate.npc,
      input.currentDate,
    ));
    const compliance = evaluateNpcUniqueArtCompliance({
      abilityScores: candidate.npc.abilityScores,
      uniqueArts: mergedArts,
    });
    if (!compliance.compliant) {
      rejectionNotes.push(`${candidate.name}本地补全后仍不完整：${compliance.reasons.join('、')}`);
      continue;
    }

    const command: Extract<LuanShiCommand, { action: 'updateCharacterUniqueArts' }> = {
      action: 'updateCharacterUniqueArts',
      characterType: 'npc',
      characterId: candidate.npcId,
      characterName: candidate.name,
      uniqueArts: mergedArts,
      summary: `按人物属性与既有档案本地补全 ${candidate.name} 的稳定绝艺`,
      source: 'local_npc_unique_art_policy_v1',
    };
    const validation = validateLuanShiCommand(input.acceptedRuntimeState, command);
    if (!validation.valid) {
      rejectionNotes.push(`${candidate.name}未通过绝艺合同：${validation.errors.join('、')}`);
      continue;
    }

    const profileIndex = nextProfiles.findIndex((profile) => profile.npcId === candidate.npcId);
    if (profileIndex >= 0) {
      nextProfiles[profileIndex] = {
        ...nextProfiles[profileIndex],
        uniqueArts: mergedArts,
      };
    } else {
      nextPatches.push({
        type: 'luanshiCommand',
        payload: { command },
        reason: `本地补全 ${candidate.name} 的稳定绝艺档案`,
      });
    }
    appliedNames.push(candidate.name);
  }

  if (appliedNames.length === 0) {
    return {
      response: appendWritebackDebugNote(
        input.original,
        `NPC绝艺本地补全未写入${rejectionNotes.length > 0 ? `：${rejectionNotes.join('；')}` : ''}`,
      ),
      appliedNames,
      rejectionNotes,
    };
  }

  return {
    response: {
      ...input.original,
      statePatches: nextPatches,
      statePatch: null,
      writeback: {
        ...baseWriteback,
        npcProfileSuggestions: nextProfiles,
        debugNotes: [
          ...(baseWriteback.debugNotes ?? []),
          `NPC稳定绝艺已本地补全：${appliedNames.join('、')}`,
          ...rejectionNotes.map((note) => `NPC绝艺候选未采用：${note}`),
        ],
      },
    },
    appliedNames,
    rejectionNotes,
  };
}

function sanitizeUniqueArtsForCommand(
  arts: ReturnType<typeof completeNpcUniqueArtsLocally>,
): ReturnType<typeof completeNpcUniqueArtsLocally> {
  return arts.map((art) => {
    const {
      bankedProgress: _bankedProgress,
      progressHistory: _progressHistory,
      ...safeArt
    } = art;
    return safeArt;
  });
}

function isCanonicalResourceWritebackDiagnostic(
  diagnostic: StatePatchValidationDiagnostic,
): boolean {
  return diagnostic.errors.some((error) => (
    error.includes('府库标准资源保留字段')
    || error.includes('府库标准资源保留键')
    || error.includes('summary 不能单独构成资源写回')
  ));
}

function capOptionalWritebackRequestBudget(
  budget: TurnLlmRequestBudget,
): TurnLlmRequestBudget {
  return {
    ...budget,
    timeoutMs: Math.min(budget.timeoutMs, OPTIONAL_WRITEBACK_PRIMARY_TIMEOUT_MS),
    retryCount: 0,
    retryDelayMs: 0,
  };
}

function appendWritebackDebugNote(response: NarratorResponse, note: string): NarratorResponse {
  const writeback = normalizeWriteback(response.writeback);
  return {
    ...response,
    writeback: {
      ...writeback,
      debugNotes: [...(writeback.debugNotes ?? []), note],
    },
  };
}

function normalizeWriteback(writeback: NarratorWritebackProtocol | undefined): NarratorWritebackProtocol {
  return {
    turnSummary: writeback?.turnSummary ?? null,
    protagonistProfile: writeback?.protagonistProfile ?? null,
    protagonistMemory: writeback?.protagonistMemory ?? null,
    npcProfileSuggestions: [...(writeback?.npcProfileSuggestions ?? [])],
    npcMemorySuggestions: [...(writeback?.npcMemorySuggestions ?? [])],
    factionRecentActionSuggestions: [...(writeback?.factionRecentActionSuggestions ?? [])],
    locationWriteSuggestions: [...(writeback?.locationWriteSuggestions ?? [])],
    routeWriteSuggestions: [...(writeback?.routeWriteSuggestions ?? [])],
    questChanges: [...(writeback?.questChanges ?? [])],
    signalChanges: [...(writeback?.signalChanges ?? [])],
    plotPlanSuggestions: [...(writeback?.plotPlanSuggestions ?? [])],
    worldEventUpdates: [...(writeback?.worldEventUpdates ?? [])],
    worldEventSummary: writeback?.worldEventSummary ?? null,
    playerRecoveryKind: writeback?.playerRecoveryKind,
    encounterTransitionDecision: writeback?.encounterTransitionDecision ?? null,
    encounterStartIntent: writeback?.encounterStartIntent ?? null,
    semanticProjections: [...(writeback?.semanticProjections ?? [])],
    debugNotes: [...(writeback?.debugNotes ?? [])],
  };
}

async function requestTimeAdvanceRepair(input: {
  apiConfig: ApiConfigArchive;
  llmClient: LlmClient;
  currentDate: string;
  playerInput: string;
  originalContent: string;
  requestBudget: TurnLlmRequestBudget;
}): Promise<{
  response: NarratorResponse;
  rawContent: string;
  usage?: LlmTokenUsage;
}> {
  const requestStartedAt = Date.now();
  const getRepairRequestBudget = (): TurnLlmRequestBudget => ({
    ...input.requestBudget,
    timeoutMs: Math.max(1, input.requestBudget.timeoutMs - (Date.now() - requestStartedAt)),
  });
  const generateRepair = () => input.llmClient.generate({
    config: input.apiConfig,
    messages: buildTimeAdvanceRepairMessages(input),
    temperature: 0,
    maxOutputTokens: input.apiConfig.maxOutputTokens,
    responseFormat: 'json_object',
    ...getRepairRequestBudget(),
  });
  let result: Awaited<ReturnType<typeof generateRepair>>;
  let emptyAttemptUsage: LlmTokenUsage | undefined;
  try {
    result = await generateRepair();
  } catch (error) {
    rethrowIfTurnCancelled(error, input.requestBudget.signal);
    if (!(error instanceof LlmEmptyContentError)) throw error;
    emptyAttemptUsage = mergeTokenUsage(emptyAttemptUsage, error.usage);

    try {
      result = await generateRepair();
    } catch (retryError) {
      rethrowIfTurnCancelled(retryError, input.requestBudget.signal);
      if (retryError instanceof LlmEmptyContentError) {
        emptyAttemptUsage = mergeTokenUsage(emptyAttemptUsage, retryError.usage);
        throw new TimeAdvanceRepairError(
          '时间推进结构化修复连续两次返回空内容，未能补齐必需的 timeAdvance；请重试或换用更稳定的模型。',
          emptyAttemptUsage,
        );
      }
      throw retryError;
    }
  }
  input.requestBudget.signal?.throwIfAborted();

  const usage = mergeTokenUsage(emptyAttemptUsage, result.usage);
  try {
    const response = parseNarratorResponse(result.content);
    const repairedTimeAdvancePatches = collectNormalizedTimeAdvancePatches(response);
    if (repairedTimeAdvancePatches.length !== 1 || !isValidTimeAdvancePatch(repairedTimeAdvancePatches[0])) {
      throw new Error('模型返回缺少有效 timeAdvance，且结构化修复失败；请重试或换用更遵守 JSON 协议的模型。');
    }

    return {
      response,
      rawContent: result.content,
      usage,
    };
  } catch (error) {
    throw new TimeAdvanceRepairError(getErrorMessage(error), usage, error);
  }
}

function buildTimeAdvanceRepairMessages(input: {
  currentDate: string;
  playerInput: string;
  originalContent: string;
}): LlmMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是乱世风云录的回合 JSON 修复器。',
        '只返回一个 JSON 对象，不要输出 Markdown 或解释。',
        '保留 narrativeText、suggestedActions、ordinaryChecks 和已有合法状态补丁。',
        '保留 writeback；如果原 JSON 没有 writeback，可以返回一个空的 writeback 结构。',
        '若原 JSON 缺少有效 timeAdvance，请根据玩家行动和正文补充一个合理的 timeAdvance 补丁。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `当前时间：${input.currentDate}`,
        `玩家行动：${input.playerInput}`,
        '',
        '以下是第一次模型返回的 JSON。请保留 narrativeText，不要重写正文；只修复结构化状态写回。',
        '要求：statePatches 中必须包含一个 type="timeAdvance" 的补丁，payload 必须至少包含 minutesAdvanced、hoursAdvanced、daysAdvanced 或 timeBlocksAdvanced 之一。',
        '短暂交谈、等待、观察通常用 minutesAdvanced；旅行、战斗、长时间行动再使用 hoursAdvanced 或 daysAdvanced。玩家明确选择长期训练、屯田、养伤、潜伏、赶造或等待时，可用 daysAdvanced 推进数十日至一年以内。',
        '字段必须在协议范围内：minutesAdvanced 1-4320、hoursAdvanced 1-72、daysAdvanced 1-365、timeBlocksAdvanced 1-36。超过三天优先使用 daysAdvanced，不要输出超限分钟数。',
        '本地游戏历法按每月 30 天、每年 12 个月折算；长期跳时正文日期与 daysAdvanced 必须按此简化历法保持一致。',
        '',
        input.originalContent,
      ].join('\n'),
    },
  ];
}

function hasExplicitTimeAdvancePatch(response: NarratorResponse): boolean {
  return collectNormalizedTimeAdvancePatches(response).some((patch) => isValidTimeAdvancePatch(patch));
}

function collectNormalizedTimeAdvancePatches(response: NarratorResponse): StatePatch[] {
  return collectStatePatches(response)
    .map((patch) => normalizeNarratorStatePatch(patch))
    .filter((patch) => patch.type === 'timeAdvance');
}

function isValidTimeAdvancePatch(patch: StatePatch): boolean {
  const ranges = [
    [patch.payload?.minutesAdvanced, 4320],
    [patch.payload?.hoursAdvanced, 72],
    [patch.payload?.daysAdvanced, 365],
    [patch.payload?.timeBlocksAdvanced, 36],
  ] as const;
  let hasExplicitAdvance = false;

  for (const [value, maximum] of ranges) {
    if (value === undefined) continue;
    hasExplicitAdvance = true;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > maximum) {
      return false;
    }
  }

  return hasExplicitAdvance;
}

function mergeTokenUsage(first?: LlmTokenUsage, second?: LlmTokenUsage): LlmTokenUsage | undefined {
  if (!first && !second) return undefined;
  return {
    promptTokens: mergeUsageField(first?.promptTokens, second?.promptTokens),
    completionTokens: mergeUsageField(first?.completionTokens, second?.completionTokens),
    totalTokens: mergeUsageField(first?.totalTokens, second?.totalTokens),
    cacheReadTokens: mergeUsageField(first?.cacheReadTokens, second?.cacheReadTokens),
    cacheWriteTokens: mergeUsageField(first?.cacheWriteTokens, second?.cacheWriteTokens),
    cacheMissTokens: mergeUsageField(first?.cacheMissTokens, second?.cacheMissTokens),
  };
}

function mergeUsageField(first?: number, second?: number): number | undefined {
  if (first === undefined && second === undefined) return undefined;
  return (first ?? 0) + (second ?? 0);
}

function summarizeNarrativeText(narrativeText: string): string {
  return narrativeText.slice(0, 200) + (narrativeText.length > 200 ? '...' : '');
}

/** 获取地点名称 */
function getLocationName(worldBook: WorldBook, runtimeState: RuntimeState): string {
  return buildCurrentLocationDisplayPath(worldBook, runtimeState);
}
