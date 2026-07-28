import { describe, expect, it } from 'vitest';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import {
  buildMemoryEmbeddingIndexItems,
  findMemoryEmbeddingIndexDeltas,
  retrieveMemoriesFromEmbeddingIndex,
  retrieveMemoriesWithEmbeddingFallback,
  upsertMemoryEmbeddingVectors,
} from './MemoryEmbeddingIndex';

function makeState(): RuntimeState {
  const state = ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'embedding-test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'custom',
    startDate: 'day 1',
    currentDate: 'day 30',
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
    locations: [
      {
        locationId: 'loc_gate',
        name: 'North Gate',
        type: 'place',
        summary: 'A guarded gate where wounded travelers gather.',
        knownLevel: '亲历',
        recentEvents: [],
      },
      {
        locationId: 'loc_market',
        name: 'Market',
        type: 'place',
        summary: 'A noisy market.',
        knownLevel: '亲历',
        recentEvents: [],
      },
    ],
    npcs: [
      {
        npcId: 'npc_sentinel',
        name: 'Sentinel',
        sex: '男',
        age: 36,
        role: 'gate guard',
        locationId: 'loc_gate',
        isPresent: true,
        isFocused: true,
        summary: 'A tired guard.',
        appearance: 'Dusty armor.',
        personality: 'Careful.',
        motivation: 'Keep the gate safe.',
        relationToPlayer: 'Saw the player carry a wounded messenger.',
        contactLevel: 10,
        recentAttitude: 'watchful',
        memories: [
          {
            memoryId: 'mem_guard_1',
            source: '亲历',
            content: 'The Sentinel watched the player promise to escort a wounded messenger through the North Gate.',
            createdAt: 'day 20',
          },
        ],
      },
      {
        npcId: 'npc_merchant',
        name: 'Merchant',
        sex: '男',
        age: 44,
        role: 'trader',
        locationId: 'loc_market',
        isPresent: false,
        isFocused: false,
        summary: 'A market trader.',
        appearance: 'Plain robe.',
        personality: 'Pragmatic.',
        motivation: 'Sell tea.',
        relationToPlayer: 'Distant acquaintance.',
        contactLevel: 1,
        recentAttitude: 'neutral',
        memories: [
          {
            memoryId: 'mem_market_1',
            source: '听闻',
            content: 'The Merchant remembered a tea price dispute in the market.',
            createdAt: 'day 12',
          },
        ],
      },
    ],
  });

  state.memoryArchive.recentTurnSummaries = [
    {
      id: 'recent_gate',
      turnNumber: 20,
      createdAt: 'day 20',
      playerInput: 'I promise to escort the wounded messenger.',
      brief: 'The player promised to escort a wounded messenger through the North Gate.',
      importance: 'high',
    },
  ];
  state.memoryArchive.midTermSummaries = [
    {
      summaryId: 'mid_gate',
      title: 'Gate escort arc',
      fromCreatedAt: 'day 10',
      toCreatedAt: 'day 25',
      summary: 'The player became involved in a dangerous escort near the North Gate.',
      relatedNpcIds: ['npc_sentinel'],
      relatedLocationIds: ['loc_gate'],
      tags: ['escort', 'wounded'],
      updatedAt: 'day 25',
    },
  ];
  state.memoryArchive.longTermFacts = [
    {
      factId: 'fact_promise',
      category: 'promise',
      createdAt: 'day 20',
      summary: 'The player made a lasting promise to protect a wounded messenger.',
      importance: 'critical',
      relatedNpcIds: ['npc_sentinel'],
      relatedLocationIds: ['loc_gate'],
      tags: ['promise', 'escort'],
    },
  ];
  state.memoryArchive.npcInteractionSummaries = [
    {
      npcId: 'npc_sentinel',
      npcName: 'Sentinel',
      summary: 'The Sentinel trusts the player slightly more after the escort promise.',
      updatedAt: 'day 25',
      tags: ['trust'],
    },
  ];
  state.memoryArchive.locationMemorySummaries = [
    {
      locationId: 'loc_gate',
      locationName: 'North Gate',
      summary: 'The North Gate remains dangerous for wounded travelers.',
      updatedAt: 'day 25',
      tags: ['danger'],
    },
  ];

  return state;
}

describe('MemoryEmbeddingIndex', () => {
  it('builds stable embedding index items from layered memory sources and NPC memories', () => {
    const items = buildMemoryEmbeddingIndexItems(makeState());

    expect(items.map((item) => item.indexId)).toEqual(
      expect.arrayContaining([
        'recentTurn:recent_gate',
        'midTermSummary:mid_gate',
        'longTermFact:fact_promise',
        'npcInteractionSummary:npc_sentinel',
        'locationMemorySummary:loc_gate',
        'npcMemory:mem_guard_1',
      ]),
    );

    const fact = items.find((item) => item.indexId === 'longTermFact:fact_promise');
    expect(fact).toMatchObject({
      sourceType: 'longTermFact',
      sourceId: 'fact_promise',
      relatedNpcIds: ['npc_sentinel'],
      relatedLocationIds: ['loc_gate'],
    });
    expect(fact?.text).toContain('lasting promise');
    expect(fact?.contentHash).toMatch(/^[a-f0-9]{8}$/);
  });

  it('detects new or changed memory items before embedding refresh', () => {
    const state = makeState();
    const items = buildMemoryEmbeddingIndexItems(state);
    const existing = upsertMemoryEmbeddingVectors(undefined, {
      worldBookId: state.worldBookId,
      embeddedAt: 'day 26',
      model: 'test-embedding',
      vectors: items
        .filter((item) => item.indexId !== 'recentTurn:recent_gate')
        .map((item) => ({
          item: item.indexId === 'longTermFact:fact_promise'
            ? { ...item, contentHash: '00000000' }
            : item,
          embedding: [1, 0, 0],
        })),
    });

    const deltas = findMemoryEmbeddingIndexDeltas(state, existing);

    expect(deltas.map((item) => item.indexId)).toEqual(
      expect.arrayContaining(['recentTurn:recent_gate', 'longTermFact:fact_promise']),
    );
    expect(deltas.map((item) => item.indexId)).not.toContain('midTermSummary:mid_gate');
  });

  it('retrieves relevant memories from an embedding index by cosine similarity', () => {
    const state = makeState();
    const items = buildMemoryEmbeddingIndexItems(state);
    const promise = items.find((item) => item.indexId === 'longTermFact:fact_promise');
    const market = items.find((item) => item.indexId === 'npcMemory:mem_market_1');
    expect(promise).toBeTruthy();
    expect(market).toBeTruthy();

    const index = upsertMemoryEmbeddingVectors(undefined, {
      worldBookId: state.worldBookId,
      embeddedAt: 'day 26',
      model: 'test-embedding',
      vectors: [
        { item: promise!, embedding: [1, 0, 0] },
        { item: market!, embedding: [0, 1, 0] },
      ],
    });

    const results = retrieveMemoriesFromEmbeddingIndex(state, index, [0.9, 0.1, 0], { limit: 1 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      retrievalMode: 'vector',
      sourceType: 'longTermFact',
      sourceId: 'fact_promise',
      reason: 'embedding cosine similarity',
    });
    expect(results[0].score).toBeGreaterThan(0.9);
  });

  it('falls back to local retrieval when no query embedding or index is available', () => {
    const results = retrieveMemoriesWithEmbeddingFallback(
      makeState(),
      'escort wounded messenger through the gate',
      undefined,
      undefined,
      { limit: 5 },
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.retrievalMode === 'local')).toBe(true);
    expect(results.map((result) => result.sourceId)).toContain('fact_promise');
  });
});
