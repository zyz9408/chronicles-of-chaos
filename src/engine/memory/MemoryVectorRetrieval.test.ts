import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { LlmEmbeddingRequest } from '../llm/LlmClient';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import { prepareMemoryVectorRetrieval } from './MemoryVectorRetrieval';

const embeddingApiConfig: ApiConfigArchive = {
  id: 'api_embedding',
  name: 'embedding api',
  provider: 'openai_compatible',
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: 'text-embedding-test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeState(): RuntimeState {
  const state = ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'vector-retrieval-test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'custom',
    startDate: 'day 1',
    currentDate: 'day 20',
    player: {
      id: 'player',
      name: 'Player',
      roleType: 'wanderer',
      summary: 'A test player.',
    },
    currentLocationId: 'loc_gate',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    locations: [],
    npcs: [],
  });

  state.memoryArchive.longTermFacts = [
    {
      factId: 'fact_silver_oath',
      category: 'promise',
      createdAt: 'day 10',
      summary: 'The silver river oath remains binding after the rescue.',
      importance: 'critical',
      tags: ['oath'],
    },
    {
      factId: 'fact_market_price',
      category: 'world',
      createdAt: 'day 8',
      summary: 'A market tea price dispute ended without lasting danger.',
      importance: 'low',
      tags: ['market'],
    },
  ];
  state.memoryArchive.settings.vectorResultLimit = 3;

  return state;
}

describe('prepareMemoryVectorRetrieval', () => {
  it('refreshes the embedding index, embeds the query, and returns vector matches when an embedding API is configured', async () => {
    const embeddingClient = {
      embed: vi.fn(async (request: LlmEmbeddingRequest) => ({
        embeddings: request.input.map((text) => {
          if (text.includes('silver river oath') || text.includes('disguised falcon')) return [1, 0, 0];
          return [0, 1, 0];
        }),
        provider: 'openai_compatible' as const,
        model: request.config.model,
        usage: { promptTokens: request.input.length, totalTokens: request.input.length },
      })),
    };

    const result = await prepareMemoryVectorRetrieval(makeState(), 'disguised falcon thread', {
      apiConfig: embeddingApiConfig,
      embeddingClient,
      persist: false,
      now: 'day 21',
    });

    expect(result.status).toBe('vector');
    expect(result.refresh.status).toBe('refreshed');
    expect(result.retrievedMemories[0]).toMatchObject({
      retrievalMode: 'vector',
      sourceType: 'longTermFact',
      sourceId: 'fact_silver_oath',
    });
    expect(embeddingClient.embed).toHaveBeenCalledTimes(2);
    const calls = embeddingClient.embed.mock.calls as unknown as Array<[LlmEmbeddingRequest]>;
    expect(calls[0][0].input).toHaveLength(2);
    expect(calls[1][0].input).toEqual(['disguised falcon thread']);
  });

  it('passes cancellation signal and timeout to refresh and query embedding requests', async () => {
    const controller = new AbortController();
    const embeddingClient = {
      embed: vi.fn(async (request: LlmEmbeddingRequest) => ({
        embeddings: request.input.map((text) => {
          if (text.includes('silver river oath') || text.includes('disguised falcon')) return [1, 0, 0];
          return [0, 1, 0];
        }),
        provider: 'openai_compatible' as const,
        model: request.config.model,
      })),
    };

    await prepareMemoryVectorRetrieval(makeState(), 'disguised falcon thread', {
      apiConfig: embeddingApiConfig,
      embeddingClient,
      persist: false,
      now: 'day 21',
      signal: controller.signal,
      timeoutMs: 45_000,
    });

    const calls = embeddingClient.embed.mock.calls as unknown as Array<[LlmEmbeddingRequest]>;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].signal).toBe(controller.signal);
    expect(calls[0][0].timeoutMs).toBe(45_000);
    expect(calls[1][0].signal).toBe(controller.signal);
    expect(calls[1][0].timeoutMs).toBe(45_000);
  });

  it('rethrows external embedding cancellation instead of falling back locally', async () => {
    const controller = new AbortController();
    const cancellation = new Error('memory retrieval cancelled');
    const embeddingClient = {
      embed: vi.fn(async () => {
        controller.abort(cancellation);
        throw cancellation;
      }),
    };

    await expect(prepareMemoryVectorRetrieval(makeState(), 'silver river oath', {
      apiConfig: embeddingApiConfig,
      embeddingClient,
      persist: false,
      signal: controller.signal,
      timeoutMs: 45_000,
    })).rejects.toBe(cancellation);
  });

  it('does not call the embedding client and uses local retrieval when no embedding API is configured', async () => {
    const embeddingClient = {
      embed: vi.fn(),
    };

    const result = await prepareMemoryVectorRetrieval(makeState(), 'silver river oath', {
      apiConfig: null,
      embeddingClient,
      persist: false,
    });

    expect(result.status).toBe('localFallback');
    expect(result.refresh.status).toBe('skipped');
    expect(result.retrievedMemories.map((memory) => memory.sourceId)).toContain('fact_silver_oath');
    expect(result.retrievedMemories.every((memory) => memory.retrievalMode === 'local')).toBe(true);
    expect(embeddingClient.embed).not.toHaveBeenCalled();
  });
});
