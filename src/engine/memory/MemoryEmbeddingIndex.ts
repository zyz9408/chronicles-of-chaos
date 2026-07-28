import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type {
  MemoryEmbeddingIndex,
  MemoryEmbeddingIndexItem,
  MemoryEmbeddingSourceType,
  MemoryEmbeddingVectorItem,
  RuntimeState,
} from '../types';
import { retrieveRelevantMemories, type MemoryRetrievalOptions, type MemoryRetrievalResult } from './MemoryRetrieval';

export interface MemoryEmbeddingVectorUpsert {
  item: MemoryEmbeddingIndexItem;
  embedding: number[];
  embeddedAt?: string;
  model?: string;
}

export interface MemoryEmbeddingVectorUpsertInput {
  worldBookId: string;
  embeddedAt: string;
  model?: string;
  updatedAt?: string;
  vectors: MemoryEmbeddingVectorUpsert[];
}

export function buildMemoryEmbeddingIndexItems(state: RuntimeState): MemoryEmbeddingIndexItem[] {
  const normalized = ensureLuanShiState(state);
  const archive = normalized.memoryArchive;
  const items: MemoryEmbeddingIndexItem[] = [];

  for (const memory of archive.recentTurnSummaries) {
    items.push(createIndexItem({
      sourceType: 'recentTurn',
      sourceId: memory.id,
      text: memory.brief,
      searchableText: [
        memory.brief,
        memory.playerInput,
        memory.playerActionSummary,
        memory.visibleConsequence,
        memory.importance,
      ],
      time: memory.createdAt,
      importance: memory.importance,
    }));
  }

  for (const summary of archive.midTermSummaries) {
    items.push(createIndexItem({
      sourceType: 'midTermSummary',
      sourceId: summary.summaryId,
      title: summary.title,
      text: `${summary.title}: ${summary.summary}`,
      searchableText: [summary.title, summary.summary, ...(summary.tags ?? [])],
      time: `${summary.fromCreatedAt}-${summary.toCreatedAt}`,
      relatedNpcIds: summary.relatedNpcIds,
      relatedLocationIds: summary.relatedLocationIds,
    }));
  }

  for (const summary of archive.longTermStorySummaries) {
    items.push(createIndexItem({
      sourceType: 'longTermStorySummary',
      sourceId: summary.summaryId,
      title: summary.title,
      text: `${summary.title}: ${summary.summary}`,
      searchableText: [summary.title, summary.summary, ...(summary.tags ?? [])],
      time: `${summary.fromCreatedAt}-${summary.toCreatedAt}`,
      relatedNpcIds: summary.relatedNpcIds,
      relatedLocationIds: summary.relatedLocationIds,
    }));
  }

  for (const fact of archive.longTermFacts) {
    items.push(createIndexItem({
      sourceType: 'longTermFact',
      sourceId: fact.factId,
      title: fact.category,
      text: fact.summary,
      searchableText: [fact.category, fact.summary, fact.importance, ...(fact.tags ?? [])],
      time: fact.createdAt,
      relatedNpcIds: fact.relatedNpcIds,
      relatedLocationIds: fact.relatedLocationIds,
      importance: fact.importance,
    }));
  }

  for (const summary of archive.npcInteractionSummaries) {
    items.push(createIndexItem({
      sourceType: 'npcInteractionSummary',
      sourceId: summary.npcId,
      title: summary.npcName,
      text: `${summary.npcName}: ${summary.summary}`,
      searchableText: [summary.npcName, summary.summary, ...(summary.tags ?? [])],
      time: summary.updatedAt,
      relatedNpcIds: [summary.npcId],
    }));
  }

  for (const summary of archive.npcMidTermSummaries) {
    items.push(createIndexItem({
      sourceType: 'npcMidTermSummary',
      sourceId: summary.summaryId,
      title: summary.npcName,
      text: `${summary.npcName}: ${summary.summary}`,
      searchableText: [summary.npcName, summary.summary, ...(summary.tags ?? [])],
      time: `${summary.fromCreatedAt}-${summary.toCreatedAt}`,
      relatedNpcIds: [summary.npcId],
    }));
  }

  for (const summary of archive.npcLongTermSummaries) {
    items.push(createIndexItem({
      sourceType: 'npcLongTermSummary',
      sourceId: summary.summaryId,
      title: summary.npcName,
      text: `${summary.npcName}: ${summary.summary}`,
      searchableText: [summary.npcName, summary.summary, ...(summary.tags ?? [])],
      time: `${summary.fromCreatedAt}-${summary.toCreatedAt}`,
      relatedNpcIds: [summary.npcId],
    }));
  }

  for (const summary of archive.locationMemorySummaries) {
    const title = summary.locationName ?? summary.locationId;
    items.push(createIndexItem({
      sourceType: 'locationMemorySummary',
      sourceId: summary.locationId,
      title,
      text: `${title}: ${summary.summary}`,
      searchableText: [summary.locationName, summary.locationId, summary.summary, ...(summary.tags ?? [])],
      time: summary.updatedAt,
      relatedLocationIds: [summary.locationId],
    }));
  }

  for (const npc of normalized.npcs) {
    for (const memory of npc.memories) {
      items.push(createIndexItem({
        sourceType: 'npcMemory',
        sourceId: memory.memoryId,
        title: npc.name,
        text: `${npc.name} - ${memory.source}: ${memory.content}`,
        searchableText: [npc.name, npc.commonAddress, npc.role, npc.relationToPlayer, memory.source, memory.content],
        time: memory.createdAt,
        relatedNpcIds: [npc.npcId],
        relatedLocationIds: npc.locationId ? [npc.locationId] : undefined,
      }));
    }
  }

  return dedupeIndexItems(items).filter((item) => item.text.trim().length > 0);
}

export function findMemoryEmbeddingIndexDeltas(
  state: RuntimeState,
  existingIndex?: MemoryEmbeddingIndex,
): MemoryEmbeddingIndexItem[] {
  const items = buildMemoryEmbeddingIndexItems(state);
  const normalized = ensureLuanShiState(state);
  if (!existingIndex || existingIndex.worldBookId !== normalized.worldBookId) return items;

  const existingById = new Map(existingIndex.items.map((item) => [item.indexId, item]));
  return items.filter((item) => existingById.get(item.indexId)?.contentHash !== item.contentHash);
}

export function upsertMemoryEmbeddingVectors(
  existingIndex: MemoryEmbeddingIndex | undefined,
  input: MemoryEmbeddingVectorUpsertInput,
): MemoryEmbeddingIndex {
  const nextItemsById = new Map<string, MemoryEmbeddingVectorItem>();

  if (existingIndex?.worldBookId === input.worldBookId) {
    for (const item of existingIndex.items) {
      nextItemsById.set(item.indexId, item);
    }
  }

  for (const vector of input.vectors) {
    const embedding = sanitizeEmbedding(vector.embedding);
    if (embedding.length === 0) continue;

    nextItemsById.set(vector.item.indexId, {
      ...vector.item,
      embedding,
      embeddedAt: vector.embeddedAt ?? input.embeddedAt,
      model: vector.model ?? input.model,
    });
  }

  return {
    schema: 'coc.v2.memory-embedding-index',
    version: 1,
    worldBookId: input.worldBookId,
    updatedAt: input.updatedAt ?? input.embeddedAt,
    items: Array.from(nextItemsById.values()).sort((a, b) => a.indexId.localeCompare(b.indexId)),
  };
}

export function retrieveMemoriesFromEmbeddingIndex(
  state: RuntimeState,
  index: MemoryEmbeddingIndex | undefined,
  queryEmbedding: number[] | undefined,
  options: MemoryRetrievalOptions = {},
): MemoryRetrievalResult[] {
  const normalized = ensureLuanShiState(state);
  const query = sanitizeEmbedding(queryEmbedding ?? []);
  if (!index || index.worldBookId !== normalized.worldBookId || query.length === 0) return [];

  const limit = options.limit ?? normalized.memoryArchive.settings.vectorResultLimit;
  const currentItemsById = new Map(buildMemoryEmbeddingIndexItems(normalized).map((item) => [item.indexId, item]));
  const results: MemoryRetrievalResult[] = [];

  for (const item of index.items) {
    const currentItem = currentItemsById.get(item.indexId);
    if (!currentItem || currentItem.contentHash !== item.contentHash) continue;

    const score = cosineSimilarity(query, item.embedding);
    if (score <= 0) continue;

    results.push({
      retrievalMode: 'vector',
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      title: item.title,
      text: item.text,
      time: item.time,
      relatedNpcIds: item.relatedNpcIds,
      relatedLocationIds: item.relatedLocationIds,
      score,
      reason: 'embedding cosine similarity',
    });
  }

  return results
    .sort((a, b) => b.score - a.score || stableSourceOrder(a.sourceType) - stableSourceOrder(b.sourceType))
    .slice(0, limit);
}

export function retrieveMemoriesWithEmbeddingFallback(
  state: RuntimeState,
  query: string,
  index?: MemoryEmbeddingIndex,
  queryEmbedding?: number[],
  options: MemoryRetrievalOptions = {},
): MemoryRetrievalResult[] {
  const vectorResults = retrieveMemoriesFromEmbeddingIndex(state, index, queryEmbedding, options);
  if (vectorResults.length > 0) return vectorResults;
  return retrieveRelevantMemories(state, query, options);
}

function createIndexItem(input: {
  sourceType: MemoryEmbeddingSourceType;
  sourceId: string;
  title?: string;
  text: string;
  searchableText: Array<string | undefined>;
  time?: string;
  relatedNpcIds?: string[];
  relatedLocationIds?: string[];
  importance?: MemoryEmbeddingIndexItem['importance'];
}): MemoryEmbeddingIndexItem {
  const searchableText = normalizeText(input.searchableText.filter(Boolean).join(' '));
  const text = input.text.trim();
  const indexId = `${input.sourceType}:${input.sourceId}`;
  const contentHash = stableHash([
    input.sourceType,
    input.sourceId,
    input.title ?? '',
    text,
    searchableText,
    input.time ?? '',
    ...(input.relatedNpcIds ?? []),
    ...(input.relatedLocationIds ?? []),
  ].join('\u001f'));

  return {
    indexId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    title: input.title,
    text,
    searchableText,
    time: input.time,
    relatedNpcIds: unique(input.relatedNpcIds),
    relatedLocationIds: unique(input.relatedLocationIds),
    importance: input.importance,
    contentHash,
  };
}

function dedupeIndexItems(items: MemoryEmbeddingIndexItem[]): MemoryEmbeddingIndexItem[] {
  const byId = new Map<string, MemoryEmbeddingIndexItem>();
  for (const item of items) {
    byId.set(item.indexId, item);
  }
  return Array.from(byId.values());
}

function sanitizeEmbedding(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;

  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    aNorm += a[index] * a[index];
    bNorm += b[index] * b[index];
  }

  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function unique(values?: string[]): string[] | undefined {
  const result = Array.from(new Set((values ?? []).filter(Boolean)));
  return result.length > 0 ? result : undefined;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableSourceOrder(type: MemoryEmbeddingSourceType): number {
  const order: Record<MemoryEmbeddingSourceType, number> = {
    longTermFact: 0,
    longTermStorySummary: 1,
    npcLongTermSummary: 2,
    midTermSummary: 3,
    npcMidTermSummary: 4,
    npcInteractionSummary: 5,
    locationMemorySummary: 6,
    npcMemory: 7,
    recentTurn: 8,
  };
  return order[type];
}
