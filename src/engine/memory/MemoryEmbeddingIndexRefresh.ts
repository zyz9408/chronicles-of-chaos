import {
  BrowserLlmClient,
  type EmbeddingClient,
  type LlmTimeoutErrorFactory,
  type LlmTokenUsage,
} from '../llm/LlmClient';
import {
  resolveExplicitApiConfigForTaskAsync,
  type ApiConfigArchive,
} from '../settings/ApiConfigManager';
import type { MemoryEmbeddingIndex, MemoryEmbeddingIndexItem, RuntimeState } from '../types';
import {
  buildMemoryEmbeddingIndexItems,
  findMemoryEmbeddingIndexDeltas,
  upsertMemoryEmbeddingVectors,
} from './MemoryEmbeddingIndex';
import { loadMemoryEmbeddingIndex, saveMemoryEmbeddingIndex } from './MemoryEmbeddingIndexStore';

export type MemoryEmbeddingRefreshStatus = 'refreshed' | 'upToDate' | 'skipped';

export interface MemoryEmbeddingRefreshOptions {
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

export interface MemoryEmbeddingRefreshResult {
  status: MemoryEmbeddingRefreshStatus;
  reason?: string;
  totalItemCount: number;
  deltaItemCount: number;
  embeddedItemCount: number;
  retainedItemCount: number;
  index?: MemoryEmbeddingIndex;
  usage?: LlmTokenUsage;
}

export type ConfiguredMemoryEmbeddingRefreshOptions = Omit<MemoryEmbeddingRefreshOptions, 'apiConfig'>;

export async function refreshMemoryEmbeddingIndexWithConfiguredApi(
  state: RuntimeState,
  options: ConfiguredMemoryEmbeddingRefreshOptions = {},
): Promise<MemoryEmbeddingRefreshResult> {
  return refreshMemoryEmbeddingIndex(state, {
    ...options,
    apiConfig: await getConfiguredEmbeddingApiConfig(),
  });
}

export async function getConfiguredEmbeddingApiConfig(): Promise<ApiConfigArchive | null> {
  return resolveExplicitApiConfigForTaskAsync('embedding');
}

export async function refreshMemoryEmbeddingIndex(
  state: RuntimeState,
  options: MemoryEmbeddingRefreshOptions = {},
): Promise<MemoryEmbeddingRefreshResult> {
  const allItems = buildMemoryEmbeddingIndexItems(state);
  const existingIndex = options.existingIndex ?? await loadMemoryEmbeddingIndex(state.worldBookId);
  const deltaItems = findMemoryEmbeddingIndexDeltas(state, existingIndex);

  if (!options.apiConfig) {
    return {
      status: 'skipped',
      reason: 'embedding api not configured',
      totalItemCount: allItems.length,
      deltaItemCount: deltaItems.length,
      embeddedItemCount: 0,
      retainedItemCount: allItems.length - deltaItems.length,
      index: existingIndex,
    };
  }

  if (deltaItems.length === 0) {
    return {
      status: 'upToDate',
      totalItemCount: allItems.length,
      deltaItemCount: 0,
      embeddedItemCount: 0,
      retainedItemCount: allItems.length,
      index: existingIndex,
    };
  }

  const embeddingClient = options.embeddingClient ?? new BrowserLlmClient();
  const embeddedAt = options.now ?? new Date().toISOString();
  const batchSize = Math.max(1, options.batchSize ?? 32);
  const vectors: Array<{ item: MemoryEmbeddingIndexItem; embedding: number[]; model?: string }> = [];
  let usage: LlmTokenUsage | undefined;

  for (let start = 0; start < deltaItems.length; start += batchSize) {
    const batch = deltaItems.slice(start, start + batchSize);
    const response = await embeddingClient.embed({
      config: options.apiConfig,
      input: batch.map((item) => item.searchableText || item.text),
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      timeoutErrorFactory: options.timeoutErrorFactory,
    });

    if (response.embeddings.length !== batch.length) {
      throw new Error('Embedding API response count does not match requested memory item count');
    }

    usage = mergeUsage(usage, response.usage);
    for (let index = 0; index < batch.length; index += 1) {
      vectors.push({
        item: batch[index],
        embedding: response.embeddings[index],
        model: response.model,
      });
    }
  }

  const mergedIndex = upsertMemoryEmbeddingVectors(existingIndex, {
    worldBookId: state.worldBookId,
    embeddedAt,
    updatedAt: embeddedAt,
    model: options.apiConfig.model,
    vectors,
  });
  const currentIndex = pruneStaleIndexItems(mergedIndex, allItems);

  if (options.persist !== false) {
    await saveMemoryEmbeddingIndex(currentIndex);
  }

  return {
    status: 'refreshed',
    totalItemCount: allItems.length,
    deltaItemCount: deltaItems.length,
    embeddedItemCount: vectors.length,
    retainedItemCount: allItems.length - deltaItems.length,
    index: currentIndex,
    usage,
  };
}

function pruneStaleIndexItems(
  index: MemoryEmbeddingIndex,
  currentItems: MemoryEmbeddingIndexItem[],
): MemoryEmbeddingIndex {
  const currentIds = new Set(currentItems.map((item) => item.indexId));
  return {
    ...index,
    items: index.items.filter((item) => currentIds.has(item.indexId)),
  };
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
