import type { RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import {
  retrieveRelevantMemories,
  type MemoryRetrievalMode,
  type MemoryRetrievalResult,
} from './MemoryRetrieval';

export interface MemoryRecallProjectionOptions {
  localCandidates?: MemoryRetrievalResult[];
  excludedSourceKeys?: Set<string>;
  candidateLimit?: number;
  maxStrong?: number;
  maxWeak?: number;
  maxPerSourceType?: number;
  minimumVectorScore?: number;
}

export interface MemoryRecallProjectionResult {
  candidateCount: number;
  omittedCount: number;
  strongMemories: MemoryRetrievalResult[];
  weakMemories: MemoryRetrievalResult[];
  retrievedMemories: MemoryRetrievalResult[];
}

interface FusedMemoryCandidate {
  memory: MemoryRetrievalResult;
  normalizedScore: number;
  modes: Set<MemoryRetrievalMode>;
  reasons: string[];
}

const DEFAULT_CANDIDATE_LIMIT = 30;
const DEFAULT_MAX_STRONG = 4;
const DEFAULT_MAX_WEAK = 6;
const DEFAULT_MAX_PER_SOURCE_TYPE = 2;
const DEFAULT_MINIMUM_VECTOR_SCORE = 0.25;
const STRONG_RECALL_THRESHOLD = 0.58;
const WEAK_RECALL_THRESHOLD = 0.25;

export function buildMemoryRecallProjection(
  state: RuntimeState,
  query: string,
  remoteCandidates: MemoryRetrievalResult[],
  options: MemoryRecallProjectionOptions = {},
): MemoryRecallProjectionResult {
  const normalized = ensureLuanShiState(state);
  const candidateLimit = Math.max(1, options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT);
  const maxStrong = Math.max(0, options.maxStrong ?? DEFAULT_MAX_STRONG);
  const maxWeak = Math.max(0, options.maxWeak ?? DEFAULT_MAX_WEAK);
  const maxPerSourceType = Math.max(1, options.maxPerSourceType ?? DEFAULT_MAX_PER_SOURCE_TYPE);
  const minimumVectorScore = Math.max(0, options.minimumVectorScore ?? DEFAULT_MINIMUM_VECTOR_SCORE);
  const excludedSourceKeys = options.excludedSourceKeys ?? new Set<string>();
  const localCandidates = options.localCandidates
    ?? retrieveRelevantMemories(normalized, query, { limit: Math.min(24, candidateLimit) });

  const fusedBySource = new Map<string, FusedMemoryCandidate>();
  for (const candidate of [...remoteCandidates, ...localCandidates]) {
    const sourceKey = memorySourceKey(candidate);
    if (excludedSourceKeys.has(sourceKey)) continue;
    if (candidate.retrievalMode === 'vector' && candidate.score < minimumVectorScore) continue;

    const normalizedScore = normalizeRetrievalScore(candidate);
    if (normalizedScore < WEAK_RECALL_THRESHOLD) continue;
    const existing = fusedBySource.get(sourceKey);
    if (!existing) {
      fusedBySource.set(sourceKey, {
        memory: candidate,
        normalizedScore,
        modes: new Set([candidate.retrievalMode]),
        reasons: candidate.reason ? [candidate.reason] : [],
      });
      continue;
    }

    existing.normalizedScore = Math.min(
      1,
      Math.max(existing.normalizedScore, normalizedScore)
        + (existing.modes.has(candidate.retrievalMode) ? 0 : 0.12),
    );
    existing.modes.add(candidate.retrievalMode);
    if (candidate.reason && !existing.reasons.includes(candidate.reason)) existing.reasons.push(candidate.reason);
    if (preferCandidateContent(candidate, existing.memory)) existing.memory = candidate;
  }

  const candidates = Array.from(fusedBySource.values())
    .sort(compareFusedCandidates)
    .slice(0, candidateLimit);
  const strongMemories: MemoryRetrievalResult[] = [];
  const weakMemories: MemoryRetrievalResult[] = [];
  const selectedSourceCounts = new Map<MemoryRetrievalResult['sourceType'], number>();

  for (const candidate of candidates) {
    const sourceCount = selectedSourceCounts.get(candidate.memory.sourceType) ?? 0;
    if (sourceCount >= maxPerSourceType) continue;

    const canBeStrong = candidate.normalizedScore >= STRONG_RECALL_THRESHOLD
      && strongMemories.length < maxStrong;
    const canBeWeak = weakMemories.length < maxWeak;
    if (!canBeStrong && !canBeWeak) continue;

    const recallStrength = canBeStrong ? 'strong' : 'weak';
    const projected = projectRecallContent(normalized, candidate, recallStrength);
    if (recallStrength === 'strong') strongMemories.push(projected);
    else weakMemories.push(projected);
    selectedSourceCounts.set(candidate.memory.sourceType, sourceCount + 1);
  }

  const retrievedMemories = [...strongMemories, ...weakMemories];
  return {
    candidateCount: candidates.length,
    omittedCount: Math.max(0, candidates.length - retrievedMemories.length),
    strongMemories,
    weakMemories,
    retrievedMemories,
  };
}

export function memorySourceKey(memory: Pick<MemoryRetrievalResult, 'sourceType' | 'sourceId'>): string {
  return `${memory.sourceType}:${memory.sourceId}`;
}

function normalizeRetrievalScore(memory: MemoryRetrievalResult): number {
  if (memory.retrievalMode === 'vector') return Math.max(0, Math.min(1, memory.score));
  return Math.max(0, Math.min(1, memory.score / 12));
}

function preferCandidateContent(
  candidate: MemoryRetrievalResult,
  existing: MemoryRetrievalResult,
): boolean {
  if (candidate.retrievalMode !== existing.retrievalMode) return candidate.retrievalMode === 'local';
  return candidate.text.length > existing.text.length;
}

function compareFusedCandidates(left: FusedMemoryCandidate, right: FusedMemoryCandidate): number {
  return right.normalizedScore - left.normalizedScore
    || stableSourceOrder(left.memory.sourceType) - stableSourceOrder(right.memory.sourceType)
    || left.memory.sourceId.localeCompare(right.memory.sourceId);
}

function projectRecallContent(
  state: ReturnType<typeof ensureLuanShiState>,
  candidate: FusedMemoryCandidate,
  recallStrength: 'strong' | 'weak',
): MemoryRetrievalResult {
  const base: MemoryRetrievalResult = {
    ...candidate.memory,
    score: candidate.normalizedScore,
    reason: candidate.reasons.join('；') || candidate.memory.reason,
    recallStrength,
    contentMode: 'summary',
    retrievalModes: Array.from(candidate.modes).sort(),
  };
  if (recallStrength !== 'strong' || base.sourceType !== 'recentTurn') return base;

  const recentSummary = state.memoryArchive.recentTurnSummaries
    .find((summary) => summary.id === base.sourceId);
  if (!recentSummary) return base;
  const sourceTurn = state.turnLog.find((turn) => turn.turnNumber === recentSummary.turnNumber);
  if (!sourceTurn) return base;
  const narrative = (sourceTurn.fullNarrativeText ?? sourceTurn.narrativeText).trim();
  if (!narrative) return base;

  return {
    ...base,
    text: [
      `第${sourceTurn.turnNumber}回合玩家行动：${sourceTurn.playerInput}`,
      `第${sourceTurn.turnNumber}回合原始正文：${narrative}`,
    ].join('\n'),
    time: sourceTurn.date,
    contentMode: 'original',
    sourceTurnNumber: sourceTurn.turnNumber,
  };
}

function stableSourceOrder(type: MemoryRetrievalResult['sourceType']): number {
  const order: Record<MemoryRetrievalResult['sourceType'], number> = {
    recentTurn: 0,
    npcMemory: 1,
    midTermSummary: 2,
    npcMidTermSummary: 3,
    longTermStorySummary: 4,
    npcLongTermSummary: 5,
    longTermFact: 6,
    npcInteractionSummary: 7,
    locationMemorySummary: 8,
  };
  return order[type];
}
