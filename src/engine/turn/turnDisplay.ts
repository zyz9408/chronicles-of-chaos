import type { TurnDisplayMeta, TurnLogEntry, TurnNpcIntentSimulationMeta } from '../types';

export interface BuildTurnDisplayMetaInput {
  turnNumber: number;
  title?: string;
  rawResponse?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheMissTokens?: number;
  elapsedMs?: number;
  provider?: string;
  model?: string;
  npcIntentSimulation?: TurnNpcIntentSimulationMeta;
  promptTokenEstimate?: TurnDisplayMeta['promptTokenEstimate'];
  processingStages?: TurnDisplayMeta['processingStages'];
  memoryRecall?: TurnDisplayMeta['memoryRecall'];
  narrativeLength?: TurnDisplayMeta['narrativeLength'];
  presentationSpeakerFacts?: TurnDisplayMeta['presentationSpeakerFacts'];
}

export function formatTokenCount(value?: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(value ?? 0)));
}

export function formatElapsedTime(elapsedMs?: number): string {
  const safeMs = Math.max(0, Math.floor(elapsedMs ?? 0));
  if (safeMs < 1000) return `${safeMs}ms`;

  const totalSeconds = Math.floor(safeMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function getPromptCacheHitRate(input: {
  provider?: string;
  promptTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheMissTokens?: number;
}): number | undefined {
  const cacheReadTokens = normalizeOptionalCount(input.cacheReadTokens);
  if (cacheReadTokens === undefined) return undefined;

  const cacheMissTokens = normalizeOptionalCount(input.cacheMissTokens);
  if (cacheMissTokens !== undefined) {
    const measuredTotal = cacheReadTokens + cacheMissTokens;
    return measuredTotal > 0 ? cacheReadTokens / measuredTotal : 0;
  }

  const promptTokens = normalizeOptionalCount(input.promptTokens);
  const cacheWriteTokens = normalizeOptionalCount(input.cacheWriteTokens) ?? 0;
  const totalInputTokens = input.provider === 'anthropic'
    ? cacheReadTokens + cacheWriteTokens + (promptTokens ?? 0)
    : promptTokens;
  return totalInputTokens && totalInputTokens > 0 ? cacheReadTokens / totalInputTokens : 0;
}

export function getTurnDisplayTitle(log: Pick<TurnLogEntry, 'turnNumber' | 'displayMeta'>): string {
  return log.displayMeta?.title?.trim() || `第 ${log.turnNumber} 回合`;
}

export function buildTurnDisplayMeta(input: BuildTurnDisplayMetaInput): TurnDisplayMeta {
  const promptTokens = normalizeOptionalCount(input.promptTokens);
  const completionTokens = normalizeOptionalCount(input.completionTokens);
  const totalTokens = normalizeOptionalCount(
    input.totalTokens ?? (
      promptTokens !== undefined || completionTokens !== undefined
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : undefined
    ),
  );

  return {
    title: input.title?.trim() || `第 ${input.turnNumber} 回合`,
    rawResponse: input.rawResponse,
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens: normalizeOptionalCount(input.cacheReadTokens),
    cacheWriteTokens: normalizeOptionalCount(input.cacheWriteTokens),
    cacheMissTokens: normalizeOptionalCount(input.cacheMissTokens),
    elapsedMs: normalizeOptionalCount(input.elapsedMs),
    provider: input.provider,
    model: input.model,
    npcIntentSimulation: input.npcIntentSimulation,
    promptTokenEstimate: input.promptTokenEstimate,
    processingStages: input.processingStages,
    memoryRecall: input.memoryRecall,
    narrativeLength: input.narrativeLength,
    presentationSpeakerFacts: input.presentationSpeakerFacts,
  };
}

function normalizeOptionalCount(value?: number): number | undefined {
  if (value === undefined || Number.isNaN(value)) return undefined;
  return Math.max(0, Math.floor(value));
}
