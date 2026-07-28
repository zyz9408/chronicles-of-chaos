import {
  BrowserLlmClient,
  type EmbeddingClient,
  type LlmTimeoutErrorFactory,
  type LlmTokenUsage,
} from '../llm/LlmClient';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import type { MemoryEmbeddingIndex, RuntimeState } from '../types';
import { retrieveMemoriesWithEmbeddingFallback } from './MemoryEmbeddingIndex';
import { type MemoryRetrievalOptions, type MemoryRetrievalResult } from './MemoryRetrieval';
import {
  refreshMemoryEmbeddingIndex,
  type MemoryEmbeddingRefreshResult,
} from './MemoryEmbeddingIndexRefresh';
import { isHardTurnBudgetExceededError } from '../turn/TurnLlmBudget';

export type MemoryVectorRetrievalStatus = 'vector' | 'localFallback' | 'failedFallback';

export interface MemoryVectorRetrievalOptions extends MemoryRetrievalOptions {
  apiConfig?: ApiConfigArchive | null;
  embeddingClient?: EmbeddingClient;
  existingIndex?: MemoryEmbeddingIndex;
  now?: string;
  batchSize?: number;
  persist?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  timeoutErrorFactory?: LlmTimeoutErrorFactory;
}

export interface MemoryVectorRetrievalResult {
  status: MemoryVectorRetrievalStatus;
  reason?: string;
  retrievedMemories: MemoryRetrievalResult[];
  refresh: MemoryEmbeddingRefreshResult;
  usage?: LlmTokenUsage;
}

export async function prepareMemoryVectorRetrieval(
  state: RuntimeState,
  query: string,
  options: MemoryVectorRetrievalOptions = {},
): Promise<MemoryVectorRetrievalResult> {
  try {
    const embeddingClient = options.embeddingClient ?? new BrowserLlmClient();
    const refresh = await refreshMemoryEmbeddingIndex(state, {
      apiConfig: options.apiConfig ?? null,
      embeddingClient,
      existingIndex: options.existingIndex,
      now: options.now,
      batchSize: options.batchSize,
      persist: options.persist,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      timeoutErrorFactory: options.timeoutErrorFactory,
    });

    if (!options.apiConfig) {
      return {
        status: 'localFallback',
        reason: refresh.reason ?? 'embedding api not configured',
        refresh,
        retrievedMemories: retrieveMemoriesWithEmbeddingFallback(state, query, refresh.index, undefined, {
          limit: options.limit,
        }),
        usage: refresh.usage,
      };
    }

    const queryEmbedding = await embedQuery(embeddingClient, options.apiConfig, query, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      timeoutErrorFactory: options.timeoutErrorFactory,
    });
    const retrievedMemories = retrieveMemoriesWithEmbeddingFallback(state, query, refresh.index, queryEmbedding.embeddings[0], {
      limit: options.limit,
    });
    const hasVectorResults = retrievedMemories.some((memory) => memory.retrievalMode === 'vector');

    return {
      status: hasVectorResults ? 'vector' : 'localFallback',
      reason: hasVectorResults ? undefined : 'embedding query returned no matching indexed memories',
      refresh,
      retrievedMemories,
      usage: mergeUsage(refresh.usage, queryEmbedding.usage),
    };
  } catch (error) {
    rethrowIfMemoryVectorRetrievalCancelled(error, options.signal);
    return {
      status: 'failedFallback',
      reason: error instanceof Error ? error.message : 'unknown memory vector retrieval failure',
      refresh: {
        status: 'skipped',
        reason: 'memory vector retrieval failed',
        totalItemCount: 0,
        deltaItemCount: 0,
        embeddedItemCount: 0,
        retainedItemCount: 0,
      },
      retrievedMemories: retrieveMemoriesWithEmbeddingFallback(state, query, undefined, undefined, {
        limit: options.limit,
      }),
    };
  }
}

async function embedQuery(
  embeddingClient: EmbeddingClient,
  apiConfig: ApiConfigArchive,
  query: string,
  options: Pick<MemoryVectorRetrievalOptions, 'signal' | 'timeoutMs' | 'timeoutErrorFactory'> = {},
): Promise<{ embeddings: number[][]; usage?: LlmTokenUsage }> {
  const response = await embeddingClient.embed({
    config: apiConfig,
    input: [query],
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    timeoutErrorFactory: options.timeoutErrorFactory,
  });

  if (response.embeddings.length !== 1) {
    throw new Error('Embedding API response count does not match requested query count');
  }

  return {
    embeddings: response.embeddings,
    usage: response.usage,
  };
}

function rethrowIfMemoryVectorRetrievalCancelled(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? error;
  if (error instanceof DOMException && error.name === 'AbortError') throw error;
  if (isHardTurnBudgetExceededError(error)) throw error;
}

function mergeUsage(left: LlmTokenUsage | undefined, right: LlmTokenUsage | undefined): LlmTokenUsage | undefined {
  if (!left) return right;
  if (!right) return left;

  return {
    promptTokens: addOptional(left.promptTokens, right.promptTokens),
    completionTokens: addOptional(left.completionTokens, right.completionTokens),
    totalTokens: addOptional(left.totalTokens, right.totalTokens),
  };
}

function addOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) return undefined;
  return (left ?? 0) + (right ?? 0);
}
