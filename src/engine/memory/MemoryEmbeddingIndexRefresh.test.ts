import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmEmbeddingRequest } from '../llm/LlmClient';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import { setApiTaskRouteAsync, upsertApiConfigAsync } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { resetLocalDatabaseForTests } from '../storage/IndexedDbStore';
import type { RuntimeState } from '../types';
import { buildMemoryEmbeddingIndexItems, upsertMemoryEmbeddingVectors } from './MemoryEmbeddingIndex';
import { loadMemoryEmbeddingIndex, saveMemoryEmbeddingIndex } from './MemoryEmbeddingIndexStore';
import {
  refreshMemoryEmbeddingIndex,
  refreshMemoryEmbeddingIndexWithConfiguredApi,
} from './MemoryEmbeddingIndexRefresh';

const makeConfig = (overrides: Partial<ApiConfigArchive> = {}): ApiConfigArchive => ({
  id: overrides.id ?? 'api_embedding',
  name: overrides.name ?? 'embedding api',
  provider: 'openai_compatible',
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: overrides.model ?? 'text-embedding-test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function makeState(): RuntimeState {
  const state = ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'embedding-refresh-test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'custom',
    startDate: 'day 1',
    currentDate: 'day 31',
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

  state.memoryArchive.recentTurnSummaries = [
    {
      id: 'recent_gate',
      turnNumber: 20,
      createdAt: 'day 20',
      brief: 'The player promised to escort a wounded messenger.',
      importance: 'high',
    },
  ];
  state.memoryArchive.longTermFacts = [
    {
      factId: 'fact_promise',
      category: 'promise',
      createdAt: 'day 20',
      summary: 'The player made a lasting promise to protect the messenger.',
      importance: 'critical',
      tags: ['promise'],
    },
  ];

  return state;
}

describe('refreshMemoryEmbeddingIndex', () => {
  beforeEach(async () => {
    await resetLocalDatabaseForTests();
  });

  it('embeds only new or changed memory items and persists the merged index', async () => {
    const state = makeState();
    const [recentItem] = buildMemoryEmbeddingIndexItems(state);
    const existingIndex = upsertMemoryEmbeddingVectors(undefined, {
      worldBookId: state.worldBookId,
      embeddedAt: 'day 30',
      model: 'text-embedding-test',
      vectors: [{ item: recentItem, embedding: [1, 0, 0] }],
    });
    await saveMemoryEmbeddingIndex(existingIndex);

    const embeddingClient = {
      embed: vi.fn(async () => ({
        embeddings: [[0, 1, 0]],
        provider: 'openai_compatible' as const,
        model: 'text-embedding-test',
        usage: { promptTokens: 8, totalTokens: 8 },
        raw: {},
      })),
    };

    const result = await refreshMemoryEmbeddingIndex(state, {
      apiConfig: makeConfig(),
      embeddingClient,
      now: 'day 31',
    });

    expect(result).toMatchObject({
      status: 'refreshed',
      embeddedItemCount: 1,
      retainedItemCount: 1,
      totalItemCount: 2,
    });
    expect(embeddingClient.embed).toHaveBeenCalledTimes(1);
    const embedCalls = embeddingClient.embed.mock.calls as unknown as Array<[LlmEmbeddingRequest]>;
    const embedInput = embedCalls[0][0].input;
    expect(embedInput).toHaveLength(1);
    expect(embedInput[0]).toContain('lasting promise');

    const stored = await loadMemoryEmbeddingIndex(state.worldBookId);
    expect(stored?.items).toHaveLength(2);
    expect(stored?.items.find((item) => item.indexId === 'recentTurn:recent_gate')?.embedding).toEqual([1, 0, 0]);
    expect(stored?.items.find((item) => item.indexId === 'longTermFact:fact_promise')).toMatchObject({
      embedding: [0, 1, 0],
      embeddedAt: 'day 31',
    });
  });

  it('skips refresh when no dedicated embedding API config is available', async () => {
    const embeddingClient = {
      embed: vi.fn(),
    };

    const result = await refreshMemoryEmbeddingIndex(makeState(), {
      apiConfig: null,
      embeddingClient,
      now: 'day 31',
    });

    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'embedding api not configured',
      embeddedItemCount: 0,
    });
    expect(embeddingClient.embed).not.toHaveBeenCalled();
    expect(await loadMemoryEmbeddingIndex('embedding-refresh-test')).toBeUndefined();
  });

  it('uses only the configured embedding route and does not fall back to the main narrative API', async () => {
    const mainConfig = await upsertApiConfigAsync(makeConfig({
      id: 'api_main',
      name: 'main api',
      model: 'main-model',
    }));
    await setApiTaskRouteAsync('mainNarrative', mainConfig.id);

    const embeddingClient = {
      embed: vi.fn(async () => ({
        embeddings: [[0, 1, 0], [1, 0, 0]],
        provider: 'openai_compatible' as const,
        model: 'embedding-model',
        raw: {},
      })),
    };

    const skipped = await refreshMemoryEmbeddingIndexWithConfiguredApi(makeState(), {
      embeddingClient,
      now: 'day 31',
    });

    expect(skipped.status).toBe('skipped');
    expect(embeddingClient.embed).not.toHaveBeenCalled();

    const embeddingConfig = await upsertApiConfigAsync(makeConfig({
      id: 'api_embedding',
      name: 'embedding api',
      model: 'embedding-model',
    }));
    await setApiTaskRouteAsync('embedding', embeddingConfig.id);

    const refreshed = await refreshMemoryEmbeddingIndexWithConfiguredApi(makeState(), {
      embeddingClient,
      now: 'day 31',
    });

    expect(refreshed.status).toBe('refreshed');
    expect(embeddingClient.embed).toHaveBeenCalledTimes(1);
    const embedCalls = embeddingClient.embed.mock.calls as unknown as Array<[LlmEmbeddingRequest]>;
    expect(embedCalls[0][0].config.model).toBe('embedding-model');
  });

  it('passes cancellation signal and timeout to batch embedding requests', async () => {
    const controller = new AbortController();
    const embeddingClient = {
      embed: vi.fn(async () => ({
        embeddings: [[0, 1, 0], [1, 0, 0]],
        provider: 'openai_compatible' as const,
        model: 'text-embedding-test',
        raw: {},
      })),
    };

    await refreshMemoryEmbeddingIndex(makeState(), {
      apiConfig: makeConfig(),
      embeddingClient,
      now: 'day 31',
      signal: controller.signal,
      timeoutMs: 45_000,
    });

    const embedCalls = embeddingClient.embed.mock.calls as unknown as Array<[LlmEmbeddingRequest]>;
    expect(embedCalls[0][0].signal).toBe(controller.signal);
    expect(embedCalls[0][0].timeoutMs).toBe(45_000);
  });

  it('rethrows external embedding cancellation instead of converting it to a refresh failure', async () => {
    const controller = new AbortController();
    const cancellation = new Error('embedding refresh cancelled');
    const embeddingClient = {
      embed: vi.fn(async () => {
        controller.abort(cancellation);
        throw cancellation;
      }),
    };

    await expect(refreshMemoryEmbeddingIndex(makeState(), {
      apiConfig: makeConfig(),
      embeddingClient,
      now: 'day 31',
      signal: controller.signal,
      timeoutMs: 45_000,
    })).rejects.toBe(cancellation);
  });
});
