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
import { parseNarratorResponse } from './NarratorResponseParser';
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
  ensureGeneratedStoryLocationReturnRoute,
  prepareNarratorLocationWriteback,
  remapNarratorStatePatchLocationReferences,
  tryApplyNpcProfileForCompliance,
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
import { buildTurnMessages } from './TurnPromptMessages';
import type { RuntimePromptTokenEstimate } from './PromptRuntimeTokenEstimate';
import { buildCurrentLocationDisplayPath, canonicalizeLocationChangeSceneTargets } from '../map/runtimeMap';
import { isNpcPhysicallyPresent } from '../state/npcPresence';
import {
  applyPlayerVitalsAfterTurn,
  isExplicitPlayerHealthRecoveryAction,
} from '../character/PlayerStaminaRuntime';
import {
  applyHoldingAnnualSettlementRuntime,
  applyHoldingSettlementTimelineRuntime,
  prepareHoldingAnnualSettlement,
} from '../holdings/HoldingAnnualSettlementRuntime';
import type { LuanShiCommand } from '../state/luanshiCommands';
import { detectMissingNpcProfileCandidates, type MissingNpcProfileCandidate } from './NpcProfileCompliance';
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
  SemanticProjection,
} from '../encounterV2/EncounterContracts';
import type { TavernManagementSettings } from '../prompts/TavernPresetStore';

export interface TurnExecutionOptions {
  apiConfig?: ApiConfigArchive | null;
  stateWritebackApiConfig?: ApiConfigArchive | null;
  npcCompletionApiConfig?: ApiConfigArchive | null;
  memorySummaryApiConfig?: ApiConfigArchive | null;
  memorySummaryApiTaskId?: 'memorySummary' | 'mainNarrative';
  embeddingApiConfig?: ApiConfigArchive | null;
  npcSimulationApiConfig?: ApiConfigArchive | null;
  npcSimulationMaxNpcCount?: number;
  persistentPromptGuide?: string;
  tavernSettings?: TavernManagementSettings;
  llmClient?: LlmClient;
  stateWritebackLlmClient?: LlmClient;
  npcCompletionLlmClient?: LlmClient;
  memorySummaryLlmClient?: LlmClient;
  embeddingClient?: EmbeddingClient;
  npcSimulationLlmClient?: LlmClient;
  narratorWritebackOptions?: NarratorWritebackApplyOptions;
  openingInitialization?: boolean;
  /**
   * UI 可先原子提交主回合，再把记忆压缩作为独立维护任务执行。
   * 默认保持旧调用方行为。
   */
  deferMemorySummaryCompression?: boolean;
  onContentDelta?: (delta: string) => void;
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
  memorySummary?: MemorySummaryExecutionResult;
  turnDisplayMeta: TurnDisplayMeta;
  statePatches?: StatePatch[];
  writeback?: NarratorWritebackProtocol;
  locationWritebackDiagnostics: RuntimeLocationWriteDiagnostic[];
  locationWritebackErrors: string[];
  routeWritebackErrors: string[];
  encounterStartIntent?: EncounterStartIntent;
  semanticProjections?: SemanticProjection[];
}

type TurnProcessingStageEmitter = (event: TurnProcessingStageEvent) => void;

const NPC_PROFILE_REPAIR_SKIPPED_AFTER_STATE_WRITEBACK_FAILURE_NOTE =
  'NPC建档合规修复跳过：同一后处理 API 的状态写回整理已失败';
const NPC_PROFILE_REPAIR_SKIPPED_AFTER_STATE_WRITEBACK_FAILURE_DETAIL =
  'same post-turn api already failed during state writeback repair';

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
  emit({ stage, label, status: 'started', ...meta });
  try {
    const result = await task();
    emit({ stage, label, status: 'finished', elapsedMs: Date.now() - startedAt, ...meta });
    return result;
  } catch (error) {
    emit({
      stage,
      label,
      status: 'failed',
      elapsedMs: Date.now() - startedAt,
      detail: getErrorMessage(error),
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

function isSameApiConfig(a: ApiConfigArchive | null | undefined, b: ApiConfigArchive | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
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
  const turnLlmBudget = createTurnLlmBudget(options.signal);
  const processingStageRecorder = createTurnProcessingStageRecorder(options.onStageChange);
  const emitProcessingStage = processingStageRecorder.emit;

  // 1. 粗略识别行动类型
  const actionIntent = interpretAction(playerInput);
  const playerHp = runtimeState.player.vitals?.hp;
  if (
    Number.isFinite(playerHp)
    && (playerHp as number) <= 0
    && !isExplicitPlayerHealthRecoveryAction(playerInput)
  ) {
    throw new Error('玩家当前生命为 0，无法继续普通行动。请先选择疗伤、治疗或静养。');
  }

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
  emitProcessingStage({
    stage: 'simulatingNpcs',
    label: '模拟相关 NPC',
    status: 'started',
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
    elapsedMs: Date.now() - npcIntentSimulationStartedAt,
    detail: npcIntentSimulation.reason,
    provider: npcIntentSimulation.provider ?? options.npcSimulationApiConfig?.provider,
    model: npcIntentSimulation.model ?? options.npcSimulationApiConfig?.model,
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

  let locationPreparation = prepareNarratorLocationWriteback(
    runtimeState,
    narratorResponse.writeback,
    worldBook,
  );
  const remappedStatePatches = remapNarratorStatePatchLocationReferences(
    collectStatePatches(narratorResponse),
    locationPreparation.aliasMap,
  );
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
  const statePatchTransaction = prepareStatePatchTransaction(
    canonicalStatePatches,
    worldBook,
    runtimeState,
    { openingInitialization: options.openingInitialization },
    locationPreparation.state,
  );
  const {
    statePatches,
    statePatchDraft,
    patchValidation,
    invalidPatchNotes,
    quarantinedPatchNotes,
    quarantineMode,
  } = statePatchTransaction;
  const statePatchTransactionFailed = statePatches.length > 0 && patchValidation?.valid === false;
  const locationWritebackRolledBack = statePatchTransactionFailed
    && (locationPreparation.appliedCount > 0 || locationPreparation.appliedRouteCount > 0);
  const locationWritebackRollbackMessage =
    '因状态补丁校验失败，本回合已准备的地点与路线写回已回滚。';
  const locationWritebackErrors = [
    ...locationPreparation.errors,
    ...(locationWritebackRolledBack ? [locationWritebackRollbackMessage] : []),
  ];
  const locationWritebackDiagnostics: RuntimeLocationWriteDiagnostic[] = [
    ...locationPreparation.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      candidateIds: [...diagnostic.candidateIds],
    })),
    ...(locationWritebackRolledBack
      ? [{
          code: 'location-writeback-rolled-back' as const,
          message: locationWritebackRollbackMessage,
          incomingLocationId: '',
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
    rawResponse: generation.rawContent,
    reasoningSummary: buildPublicReasoningSummary(generation.mode, generation.provider, generation.model),
    provider: generation.provider,
    model: generation.model,
    npcIntentSimulation,
    promptTokenEstimate: promptContext.runtimeTokenEstimate,
    processingStages: processingStageRecorder.events,
    memoryRecall: memoryContextPackage.memoryRecall,
  });
  turnDisplayMeta.locationWriteback = {
    errors: locationWritebackErrors,
    routeErrors: [...locationPreparation.routeErrors],
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
      // 有 patch 但校验失败时，保留正文和校验信息，不写入状态变更。
      const copiedState = JSON.parse(JSON.stringify(runtimeState)) as RuntimeState;
      copiedState.turnLog.push({
        turnNumber,
        date: copiedState.currentDate,
        playerInput,
        narrativeText: summarizeNarrativeText(narratorResponse.narrativeText),
        fullNarrativeText: narratorResponse.narrativeText,
        statePatchSummary: `状态变更校验失败：${invalidPatchNotes.join('；') || '未知原因'}`,
        timestamp: new Date().toISOString(),
        displayMeta: turnDisplayMeta,
      });
      copiedState.lastPatchValidation = patchValidation ?? undefined;
      return copiedState;
    },
  );

  if (statePatchTransactionFailed) {
    if (locationWritebackRolledBack) {
      appendLocationWritebackRollbackSummary(newState);
    } else {
      appendLocationWritebackWarningSummary(newState, locationPreparation);
    }
  } else {
    appendQuarantinedPeripheralSummary(newState, quarantinedPatchNotes, quarantineMode);
  }
  appendEncounterTriggerQuarantineSummary(newState, encounterPatchGuard.removedCount);
  let memorySummary: MemorySummaryExecutionResult | undefined;
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
    }).state;
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
    ...buildOrdinaryJudgementCards(narratorResponse.ordinaryChecks),
    ...buildBattleJudgementCards(runtimeState, newState),
  ];
  if (judgementCards.length > 0) {
    turnDisplayMeta.judgementCards = judgementCards;
  }
  turnDisplayMeta.processingStages = processingStageRecorder.events;
  syncLatestTurnSuggestedActions(newState, narratorResponse.suggestedActions);
  syncLatestTurnDisplayMeta(newState, turnDisplayMeta);
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
    memorySummary,
    turnDisplayMeta,
    writeback: narratorResponse.writeback,
    locationWritebackDiagnostics,
    locationWritebackErrors,
    routeWritebackErrors: locationPreparation.routeErrors,
    encounterStartIntent,
    semanticProjections,
  };
}

function appendLocationWritebackRollbackSummary(state: RuntimeState): void {
  const latest = state.turnLog[state.turnLog.length - 1];
  if (!latest) return;
  latest.statePatchSummary = [
    latest.statePatchSummary,
    '地图写回回滚：因状态补丁校验失败，本回合已准备的地点与路线未写入',
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
    label: '压缩近期记忆',
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
      label: '压缩近期记忆',
      status: result.status === 'skipped' ? 'skipped' : result.status === 'failed' ? 'failed' : 'finished',
      elapsedMs: Date.now() - stageStartedAt,
      detail: result.reason,
      provider: apiConfig?.provider,
      model: apiConfig?.model,
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
      label: '压缩近期记忆',
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

const PLAYER_MONEY_WRITEBACK_REVIEW_PATTERN =
  /购买|买下|出售|卖出|支付|付给|付出|花费|耗费|酬劳|赏钱|收款|进账|领取军饷|个人军饷|存入|取出|提款|存款|退钱|退款/;
const PLAYER_INVENTORY_WRITEBACK_REVIEW_PATTERN =
  /获得|取得|领取|收下|购买|买下|捡到|缴获|入手|出售|卖出|卖给|消耗|使用|服用|吃下|喝下|交出|交给|交回|收回|赠予|赠送|送出|遗失|丢失|损毁|毁坏|过期|兑付|兑现|提取/;
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
  playerInput: string,
  response: NarratorResponse,
): boolean {
  const text = `${playerInput}\n${response.narrativeText}`;
  const commands = collectStatePatches(response)
    .map((patch) => extractLuanShiCommandFromPatch(patch))
    .filter((command): command is LuanShiCommand => Boolean(command));
  const playerLoadoutCommands = commands.filter((command): command is Extract<LuanShiCommand, { action: 'updatePlayerLoadout' }> => (
    command.action === 'updatePlayerLoadout'
  ));
  const hasMoneyWriteback = playerLoadoutCommands.some((command) => (
    command.personalMoney !== undefined || command.personalMoneyDelta !== undefined
  ));
  if (PLAYER_MONEY_WRITEBACK_REVIEW_PATTERN.test(text) && !hasMoneyWriteback) {
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

  const namedExistingItems = (runtimeState.player.inventory ?? []).filter((item) => (
    item.name.trim().length > 0 && text.includes(item.name)
  ));
  if (namedExistingItems.some((item) => !touchedInventoryIds.has(item.id))) {
    return true;
  }

  const acquisitionWithoutExistingItem =
    /获得|取得|领取|收下|买下|捡到|缴获|入手/.test(text)
    && namedExistingItems.length === 0;
  return acquisitionWithoutExistingItem && !hasAnyInventoryWriteback;
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
    || (writeback.locationWriteSuggestions?.length ?? 0) > 0
    || (writeback.routeWriteSuggestions?.length ?? 0) > 0
    || (writeback.questChanges?.length ?? 0) > 0
    || (writeback.signalChanges?.length ?? 0) > 0
    || (writeback.plotPlanSuggestions?.length ?? 0) > 0
    || (writeback.worldEventUpdates?.length ?? 0) > 0
    || writeback.worldEventSummary
    || writeback.encounterStartIntent
    || (writeback.semanticProjections?.length ?? 0) > 0
    || (writeback.debugNotes?.length ?? 0) > 0
  );
}

interface StatePatchTransactionPreparation {
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

function prepareStatePatchTransaction(
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

  for (let sourcePatchIndex = 0; sourcePatchIndex < canonicalPatches.length; sourcePatchIndex += 1) {
    const rawPatch = canonicalPatches[sourcePatchIndex];
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
  );
  const canonicalPatches = remapNarratorStatePatchLocationReferences(
    patches,
    locationPreparation.aliasMap,
  );
  return prepareStatePatchTransaction(
    canonicalPatches,
    worldBook,
    runtimeState,
    {},
    locationPreparation.state,
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
  const transaction = prepareStatePatchTransaction(
    input.patches,
    input.worldBook,
    input.runtimeState,
    input.applyOptions,
  );
  const preparedBaseState = transaction.statePatches.length === 0
    ? input.runtimeState
    : transaction.patchValidation?.valid === true
      ? transaction.statePatchDraft
      : undefined;
  if (!preparedBaseState) return undefined;
  return applyAcceptedNpcProfilesForCompliance(
    preparedBaseState,
    input.writeback?.npcProfileSuggestions ?? [],
  );
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
}> {
  const { apiConfig, llmClient } = input.options;

  if (apiConfig && !llmClient) {
    throw new Error('已配置 API，但当前回合缺少 LLM 客户端');
  }

  if (apiConfig && llmClient) {
    const mainNarrativeRequestBudget = input.turnLlmBudget.getMainNarrativeRequestBudget();
    const result = await runProcessingStage(
      input.emitProcessingStage,
      'generatingNarrative',
      '生成正文',
      { provider: apiConfig.provider, model: apiConfig.model },
      () => llmClient.generate({
        config: apiConfig,
        messages: buildTurnMessages(
          input.systemPrompt,
          input.userPrompt,
          input.stateWriterContext,
          input.adultIntimacyFinalReminder,
          input.narrativeProseFinalReview,
          {
            scope: input.options.openingInitialization ? 'opening' : 'turn',
            playerName: input.runtimeState.player.name,
            settings: input.options.tavernSettings,
          },
        ),
        temperature: apiConfig.temperature,
        maxOutputTokens: apiConfig.maxOutputTokens,
        responseFormat: 'json_object',
        onContentDelta: input.options.onContentDelta,
        ...mainNarrativeRequestBudget,
      }),
    );
    input.options.signal?.throwIfAborted();
    const postNarrativeBudget = input.turnLlmBudget.startPostNarrativeBudget();

    let response = parseNarratorResponse(result.content, {
      encounterIntentCreatedAt: input.encounterIntentCreatedAt,
    });
    let rawContent = result.content;
    let usage = result.usage;
    let stateWritebackRepairFailedApiConfig: ApiConfigArchive | null = null;
    let stateWritebackRepairSucceeded = false;
    const judgementMarkerIntegrityIssues = findOrphanJudgementMarkers(
      response.narrativeText,
      collectStatePatches(response),
    );
    const playerInventoryScopeDiagnostics = buildPlayerInventoryDestructiveScopeDiagnostics(
      input.runtimeState,
      input.fallbackContext.playerInput,
      response,
    );
    const playerEconomyWritebackReviewRequired = playerInventoryScopeDiagnostics.length > 0
      || requiresPlayerEconomyWritebackReview(
        input.runtimeState,
        input.fallbackContext.playerInput,
        response,
      );
    const configuredStateWritebackApiConfig = input.options.stateWritebackApiConfig;
    const stateWritebackApiConfig = configuredStateWritebackApiConfig
      ?? (
        judgementMarkerIntegrityIssues.length > 0 || playerEconomyWritebackReviewRequired
          ? apiConfig
          : null
      );

    if (stateWritebackApiConfig) {
      const stateWritebackLlmClient = configuredStateWritebackApiConfig
        ? (input.options.stateWritebackLlmClient ?? llmClient)
        : llmClient;
      const statePatchDiagnostics = [
        ...buildStatePatchValidationDiagnostics(
          prepareNarratorStatePatchTransaction(
            collectStatePatches(response),
            response.writeback,
            input.worldBook,
            input.runtimeState,
          ),
        ),
        ...playerInventoryScopeDiagnostics,
      ];
      try {
        const repaired = await runProcessingStage(
          input.emitProcessingStage,
          'repairingStateWriteback',
          judgementMarkerIntegrityIssues.length > 0
            ? '补全判定写回'
            : playerEconomyWritebackReviewRequired
              ? '核对物品与个人钱财写回'
              : '整理状态写回',
          {
            provider: stateWritebackApiConfig.provider,
            model: stateWritebackApiConfig.model,
          },
          () => requestStateWritebackRepair({
            apiConfig: stateWritebackApiConfig,
            llmClient: stateWritebackLlmClient,
            runtimeState: input.runtimeState,
            currentDate: input.currentDate,
            playerInput: input.fallbackContext.playerInput,
            stateWriterContext: input.stateWriterContext,
            encounterIntentCreatedAt: input.encounterIntentCreatedAt,
            originalResponse: response,
            statePatchDiagnostics,
            judgementMarkerIntegrityIssues,
            playerEconomyWritebackReviewRequired,
            playerEconomyWritebackReviewAttempt: 1,
            requestBudget: postNarrativeBudget.getChildRequestBudget(),
          }),
        );
        const repairSourceResponse = response;
        let repairMerge = mergeStateWritebackRepairResponse(repairSourceResponse, repaired.response, {
          worldBook: input.worldBook,
          runtimeState: input.runtimeState,
          statePatchDiagnostics,
          judgementMarkerIntegrityIssues,
        });
        usage = mergeTokenUsage(usage, repaired.usage);
        const economyReviewStillRequired = playerEconomyWritebackReviewRequired
          && (
            buildPlayerInventoryDestructiveScopeDiagnostics(
              input.runtimeState,
              input.fallbackContext.playerInput,
              repairMerge.response,
            ).length > 0
            || requiresPlayerEconomyWritebackReview(
              input.runtimeState,
              input.fallbackContext.playerInput,
              repairMerge.response,
            )
          );
        if (economyReviewStillRequired) {
          const secondReview = await runProcessingStage(
            input.emitProcessingStage,
            'repairingStateWriteback',
            '再次核对物品与个人钱财写回',
            {
              provider: stateWritebackApiConfig.provider,
              model: stateWritebackApiConfig.model,
            },
            () => requestStateWritebackRepair({
              apiConfig: stateWritebackApiConfig,
              llmClient: stateWritebackLlmClient,
              runtimeState: input.runtimeState,
              currentDate: input.currentDate,
              playerInput: input.fallbackContext.playerInput,
              stateWriterContext: input.stateWriterContext,
              encounterIntentCreatedAt: input.encounterIntentCreatedAt,
              originalResponse: repairSourceResponse,
              statePatchDiagnostics,
              judgementMarkerIntegrityIssues,
              playerEconomyWritebackReviewRequired,
              playerEconomyWritebackReviewAttempt: 2,
              requestBudget: postNarrativeBudget.getChildRequestBudget(),
            }),
          );
          repairMerge = mergeStateWritebackRepairResponse(repairSourceResponse, secondReview.response, {
            worldBook: input.worldBook,
            runtimeState: input.runtimeState,
            statePatchDiagnostics,
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
        if (judgementMarkerIntegrityIssues.length > 0 && !repairMerge.patchCandidateAccepted) {
          response = appendWritebackDebugNote(response, '判定标记缺少对应战事/个人战记录，自动补全结果未通过校验。');
        }
        if (playerEconomyWritebackReviewRequired && !repairMerge.patchCandidateAccepted) {
          response = appendWritebackDebugNote(response, '物品与个人钱财写回复核结果未通过校验，已保留主回合原始写回。');
        }
      } catch (error) {
        rethrowIfTurnCancelled(error, input.options.signal);
        if (error instanceof PlayerInventoryScopeReviewError) throw error;
        stateWritebackRepairFailedApiConfig = stateWritebackApiConfig;
        response = appendWritebackDebugNote(
          response,
          `状态写回整理失败：${getErrorMessage(error)}`,
        );
        if (
          (
            statePatchDiagnostics.length > 0
            || judgementMarkerIntegrityIssues.length > 0
            || playerEconomyWritebackReviewRequired
          )
          && !isSameApiConfig(stateWritebackApiConfig, apiConfig)
        ) {
          try {
            const fallbackRepair = await runProcessingStage(
              input.emitProcessingStage,
              'repairingStateWriteback',
              playerEconomyWritebackReviewRequired
                ? '核对物品与个人钱财写回（备用）'
                : '整理状态写回（备用）',
              { provider: apiConfig.provider, model: apiConfig.model },
              () => requestStateWritebackRepair({
                apiConfig,
                llmClient,
                runtimeState: input.runtimeState,
                currentDate: input.currentDate,
                playerInput: input.fallbackContext.playerInput,
                stateWriterContext: input.stateWriterContext,
                encounterIntentCreatedAt: input.encounterIntentCreatedAt,
                originalResponse: response,
                statePatchDiagnostics,
                judgementMarkerIntegrityIssues,
                playerEconomyWritebackReviewRequired,
                playerEconomyWritebackReviewAttempt: 1,
                requestBudget: postNarrativeBudget.getChildRequestBudget(),
              }),
            );
            const fallbackMerge = mergeStateWritebackRepairResponse(response, fallbackRepair.response, {
              worldBook: input.worldBook,
              runtimeState: input.runtimeState,
              statePatchDiagnostics,
              judgementMarkerIntegrityIssues,
            });
            response = fallbackMerge.response;
            rawContent = JSON.stringify(response, null, 2);
            usage = mergeTokenUsage(usage, fallbackRepair.usage);
            stateWritebackRepairSucceeded = true;
          } catch (fallbackError) {
            rethrowIfTurnCancelled(fallbackError, input.options.signal);
            response = appendWritebackDebugNote(
              response,
              `主剧情 API 备用状态写回整理失败：${getErrorMessage(fallbackError)}`,
            );
          }
        }
      }
    }

    if (!hasExplicitTimeAdvancePatch(response)) {
      const stateWritebackApiConfig = input.options.stateWritebackApiConfig;
      const useStateWritebackApi = Boolean(stateWritebackApiConfig && stateWritebackRepairSucceeded);
      const primaryRepairApiConfig = useStateWritebackApi ? stateWritebackApiConfig! : apiConfig;
      const primaryRepairLlmClient = useStateWritebackApi
        ? (input.options.stateWritebackLlmClient ?? llmClient)
        : llmClient;
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
      if (isSameApiConfig(stateWritebackRepairFailedApiConfig, npcProfileRepairApiConfig)) {
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
      } else {
        try {
          const repaired = await runProcessingStage(
            input.emitProcessingStage,
            'repairingNpcProfiles',
            '补全 NPC 人物志',
            {
              provider: npcProfileRepairApiConfig.provider,
              model: npcProfileRepairApiConfig.model,
            },
            () => requestNpcProfileComplianceRepair({
              apiConfig: npcProfileRepairApiConfig,
              llmClient: npcProfileRepairLlmClient,
              runtimeState: input.runtimeState,
              currentDate: input.currentDate,
              playerInput: input.fallbackContext.playerInput,
              candidates: missingNpcProfileCandidates,
              originalResponse: response,
              requestBudget: postNarrativeBudget.getChildRequestBudget(),
            }),
          );
          response = mergeNpcProfileRepairResponse(response, repaired.response, input.runtimeState);
          rawContent = JSON.stringify(response, null, 2);
          usage = mergeTokenUsage(usage, repaired.usage);
        } catch (error) {
          rethrowIfTurnCancelled(error, input.options.signal);
          response = appendWritebackDebugNote(
            response,
            `NPC建档合规修复失败：${getErrorMessage(error)}`,
          );
        }
      }
    }

    return {
      response,
      mode: 'llm',
      provider: result.provider,
      model: result.model,
      usage,
      rawContent,
      postNarrativeBudget,
    };
  }

  const mockResponse = generateMockNarrative(input.fallbackContext);
  return {
    response: mockResponse,
    mode: 'mock',
    rawContent: JSON.stringify(mockResponse, null, 2),
  };
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
  judgementMarkerIntegrityIssues: JudgementMarkerIntegrityIssue[];
  playerEconomyWritebackReviewRequired: boolean;
  playerEconomyWritebackReviewAttempt: 1 | 2;
  requestBudget: TurnLlmRequestBudget;
}): Promise<{
  response: NarratorResponse;
  rawContent: string;
  usage?: LlmTokenUsage;
}> {
  const result = await input.llmClient.generate({
    config: input.apiConfig,
    messages: buildStateWritebackRepairMessages(input),
    temperature: 0,
    maxOutputTokens: input.apiConfig.maxOutputTokens,
    responseFormat: 'json_object',
    ...input.requestBudget,
  });
  input.requestBudget.signal?.throwIfAborted();

  return {
    response: parseNarratorResponse(result.content, {
      encounterIntentCreatedAt: input.encounterIntentCreatedAt,
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
  judgementMarkerIntegrityIssues: JudgementMarkerIntegrityIssue[];
  playerEconomyWritebackReviewRequired: boolean;
  playerEconomyWritebackReviewAttempt: 1 | 2;
}): LlmMessage[] {
  const allowInventoryScopeNarrativeCorrection =
    hasPlayerInventoryDestructiveScopeDiagnostic(input.statePatchDiagnostics);
  return [
    {
      role: 'system',
      content: [
        '你是乱世风云录的状态写回整理器。',
        '只返回一个 JSON 对象，不要输出 Markdown 或解释。',
        allowInventoryScopeNarrativeCorrection
          ? '本次存在“主角物品破坏范围越界”诊断：suggestedActions、ordinaryChecks 仍不得重写；narrativeText 只允许最小删除或改正“玩家未操作的其他物品已核销、交出、消耗、遗失或损毁”这类越界事实，其余正文必须保持原意与顺序。'
          : '不得重写 narrativeText、suggestedActions、ordinaryChecks；这些字段由主回合正文决定。',
        '你的任务只是在不新增剧情事实的前提下，整理 statePatches/statePatch 和 writeback。',
        '所有状态修改仍会经过严格 validator；不要输出 setState、path、value 之类任意变量写入。',
        '不确定的事实不要写入；不得制造未知势力、未知部队、占位主将或工程枚举。',
        '部队 knownLevel 表示证据来源层级（亲历/听闻/推测），certainty 表示可信度（confirmed/reported/rumor/uncertain），不得机械同步；可靠军报可为听闻+confirmed，失联通常只降低 certainty，推测+confirmed 不得组合。',
        '若正文已经明确某个钱粮、势力、部队、人物、任务、风声或纪事发生变化，应补成现有协议允许的结构化写回。',
        '必须逐项核对玩家行动、最终 narrativeText、主角个人钱财余额和完整背包真值：个人收支已成立却缺少 personalMoneyDelta、物品实际获得却缺少 upsert、物品消耗/交出/遗失/损毁/过期或一次性凭证权益兑现却缺少 remove/setQuantity 时，应在尾部补齐对应 updatePlayerLoadout。',
        '仅在正文中提到、看见、出示、核验或回忆既有物品不等于再次获得；不得为此追加 upsert。更新同一种既有物品必须逐字复用当前背包 itemId，不得另造 ID；upsert.quantity 是变化后的绝对总数。',
        '购买、出售或以个人钱财换取/交出物品已经成立时，钱财与物品两侧必须成对写回；势力粮草、军械等公共资源仍写 updateResourceLedger，不得混入个人钱财。',
        '单一物品操作不得扩散到其他稳定 ID：不能因同属手令、凭证、文书、药品、名称相似或此前曾被提及，就批量消耗、核销、交出或移除其他物品。若原响应破坏性修改了玩家行动未明确点名的现存物品，必须从同一 updatePlayerLoadout 槽位移除这些额外变更；本回合确需操作多个现存物品时，玩家行动必须逐项明确点名。',
        '状态写入上下文中的 openCurrentMatterLifecycleLedger 是全量未结事项：逐项审阅，只有本回合事实明确完成、失败或失效时才复用 questId 写 complete/fail/invalidate；不得只看前四条，也不得按标题关键词、存续时长或期限机械结案。',
        'complete/fail/invalidate 是当前事项终态并由本地同回合归入历史；archive 只用于无成功/失败结论但已不再牵连玩家的旧事项。',
        'worldEventSummary 只允许区域以上大势：scope 必须为 regional/realm/world，并有冲突或势力/部队/领地/跨地点宏观锚点；local 和主角个人重要行动不得补成纪事。一次性结束事件写 historical，active/cooling 必须有 progressSummary 和复核/推进时间锚点。',
        'statePatches 必须保留已有的合法 timeAdvance；若原响应缺少有效 timeAdvance，应根据玩家行动与正文补充合理的时间推进。',
        '若提供 StatePatch validator 逐条诊断，必须在一次响应中处理全部失败项，并返回修正后的完整有序 statePatches。',
        '若提供判定标记一致性诊断，必须按标记中的稳定 ID 在 statePatches 尾部补充对应 upsertConflictRecord 或 upsertCombatRecord；只能使用正文已明确发生的事实，不得改写或删除 narrativeText 中的判定标记。',
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
        '## 状态写入上下文',
        input.stateWriterContext,
        '',
        '## 已知状态摘要',
        formatStateWritebackRuntimeSummary(input.runtimeState),
        '',
        '## StatePatch validator 逐条诊断',
        JSON.stringify(input.statePatchDiagnostics, null, 2),
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

  return [
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
  ].join('\n');
}

interface StateWritebackRepairMergeResult {
  response: NarratorResponse;
  patchCandidateAccepted: boolean;
}

function mergeStateWritebackRepairResponse(
  original: NarratorResponse,
  repaired: NarratorResponse,
  options: {
    worldBook: WorldBook;
    runtimeState: RuntimeState;
    statePatchDiagnostics: StatePatchValidationDiagnostic[];
    judgementMarkerIntegrityIssues: JudgementMarkerIntegrityIssue[];
  },
): StateWritebackRepairMergeResult {
  const originalPatches = collectStatePatches(original);
  const repairedPatches = collectStatePatches(repaired);
  const candidateWriteback = mergeStateWritebackProtocol(original.writeback, repaired.writeback);
  const candidatePatches = options.statePatchDiagnostics.length > 0
    ? repairedPatches
    : preserveTimeAdvancePatches(originalPatches, repairedPatches);
  const hasNoPatchConflict = options.statePatchDiagnostics.length === 0
    && originalPatches.length === 0
    && repairedPatches.length === 0;
  const patchCandidateAccepted = hasNoPatchConflict || (
    repairedPatches.length > 0
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
    return repairedTransaction.statePatches.length === 0
      || repairedTransaction.patchValidation?.valid === true;
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
): NarratorWritebackProtocol {
  const base = normalizeWriteback(original);
  if (!hasMeaningfulWriteback(repaired)) {
    return base;
  }

  return mergeRepairWritebackProtocol(base, repaired);
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
        '只补 writeback.npcProfileSuggestions 中缺失的人物志；不要补地点、势力、任务、风声或纪事。',
        '不要硬编码历史结论；只能根据原回合正文、写回内容、候选证据、当前时间地点和已有 NPC 档案做保守补全。',
        '若候选人未直接在场，可以建立 isPresent=false 的远场/听闻档案，但必须给稳定 npcId 和可承接的 summary。',
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
        '- 每个 npcProfileSuggestions[] 必须包含 npcId/name/sex/age/role/locationId/isPresent/isFocused/currentIdentity/summary/appearance/personality/motivation/relationToPlayer/contactLevel/recentAttitude/abilityScores/traits。',
        '- abilityScores 必须完整包含：武力、统率、智力、政治、魅力、机运。',
        '- traits 至少 1 条，每条包含 id/label/description/source，可含 rarity。',
        '- 年龄必须是数字；若原文没有精确年龄，按身份和年代做保守估计。',
        '- 无法确认其当前地点时，locationId 使用 "loc_unknown_remote"，并用 isPresent=false、summary/relationToPlayer 说明其为远场或听闻人物。',
        '- 重要 NPC 行装：若候选人是当前局势关键的上级、君主、重臣、将领、豪族首脑、使者、谈判对象或直接交锋者，且身份/场景足以推断其长期随身装备、官印符节、军令凭证、家族信物或随身文书，应在同一条 npcProfileSuggestions[].equipment / npcProfileSuggestions[].inventory 写入 1-3 件稳定行装。equipment 每项包含 id/slot/name/quality/description，slot 只能是 weapon/armor/mount/treasure；inventory 每项包含 id/name/quantity/category/description。不得硬编码具体名人专属宝物，不确定时写身份层级通用物件；普通远场传闻人物不要机械补行装。',
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
    `- 姓名：${candidate.name}`,
    `  提及次数：${candidate.mentionCount}`,
    `  触发原因：${candidate.reasons.join('、')}`,
    `  证据：${candidate.evidence.join(' / ')}`,
  ].join('\n')).join('\n');
}

function mergeNpcProfileRepairResponse(
  original: NarratorResponse,
  repaired: NarratorResponse,
  runtimeState: RuntimeState,
): NarratorResponse {
  const repairProfiles = repaired.writeback?.npcProfileSuggestions ?? [];
  if (repairProfiles.length === 0) {
    return appendWritebackDebugNote(original, 'NPC建档合规修复未返回可用人物志');
  }

  const baseWriteback = normalizeWriteback(original.writeback);
  const mergedProfiles = mergeUniqueNpcProfiles(
    runtimeState,
    baseWriteback.npcProfileSuggestions ?? [],
    repairProfiles,
  );
  const addedCount = mergedProfiles.length - (baseWriteback.npcProfileSuggestions?.length ?? 0);
  if (addedCount <= 0) {
    return appendWritebackDebugNote(original, 'NPC建档合规修复返回的人物志已存在');
  }

  const addedNames = mergedProfiles.slice(-addedCount).map((profile) => profile.name).join('、');
  return {
    ...original,
    writeback: {
      ...baseWriteback,
      npcProfileSuggestions: mergedProfiles,
      debugNotes: [
        ...(baseWriteback.debugNotes ?? []),
        `NPC建档合规修复补档：${addedNames}`,
      ],
    },
  };
}

function mergeUniqueNpcProfiles(
  runtimeState: RuntimeState,
  originalProfiles: NarratorNpcProfileSuggestion[],
  repairProfiles: NarratorNpcProfileSuggestion[],
): NarratorNpcProfileSuggestion[] {
  let acceptedState = runtimeState;
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const profile of originalProfiles) {
    const result = tryApplyNpcProfileForCompliance(acceptedState, profile);
    if (!result.accepted) continue;
    acceptedState = result.state;
    seenIds.add(profile.npcId);
    seenNames.add(profile.name);
  }
  const additions = repairProfiles.filter((profile) => {
    if (seenIds.has(profile.npcId) || seenNames.has(profile.name)) return false;
    const result = tryApplyNpcProfileForCompliance(acceptedState, profile);
    if (!result.accepted) return false;
    acceptedState = result.state;
    seenIds.add(profile.npcId);
    seenNames.add(profile.name);
    return true;
  });
  return [...originalProfiles, ...additions];
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
    locationWriteSuggestions: [...(writeback?.locationWriteSuggestions ?? [])],
    routeWriteSuggestions: [...(writeback?.routeWriteSuggestions ?? [])],
    questChanges: [...(writeback?.questChanges ?? [])],
    signalChanges: [...(writeback?.signalChanges ?? [])],
    plotPlanSuggestions: [...(writeback?.plotPlanSuggestions ?? [])],
    worldEventUpdates: [...(writeback?.worldEventUpdates ?? [])],
    worldEventSummary: writeback?.worldEventSummary ?? null,
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
  };
}

function mergeUsageField(first?: number, second?: number): number | undefined {
  if (first === undefined && second === undefined) return undefined;
  return (first ?? 0) + (second ?? 0);
}

function buildPublicReasoningSummary(
  mode: 'llm' | 'mock',
  provider?: string,
  model?: string,
): string {
  if (mode === 'mock') {
    return '本回合使用本地模拟叙事生成，未调用外部模型；这里只记录公开摘要，不展示隐藏推理链。';
  }

  return [
    `本回合由${model ? ` ${model}` : '已配置模型'}生成。`,
    provider ? `接口类型：${provider}。` : '',
    '此处展示公开思路摘要与生成记录，不展示模型隐藏推理链。',
  ].join('');
}

function summarizeNarrativeText(narrativeText: string): string {
  return narrativeText.slice(0, 200) + (narrativeText.length > 200 ? '...' : '');
}

/** 获取地点名称 */
function getLocationName(worldBook: WorldBook, runtimeState: RuntimeState): string {
  return buildCurrentLocationDisplayPath(worldBook, runtimeState);
}
