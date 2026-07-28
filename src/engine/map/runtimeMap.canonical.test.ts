import { describe, expect, it } from 'vitest';
import type { MapNode, RuntimeState, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import {
  applyLocationWriteSuggestion,
  applyLocationWriteSuggestionsSequentially,
  buildRuntimeMapIndex,
} from './runtimeMap';

const regionA: MapNode = {
  id: 'region_a',
  name: '甲郡',
  level: 'commandery',
  mapLayer: 'region',
  summary: '',
  connectedRegionIds: [],
  controlHint: '',
  tensionHint: '',
  subLocations: [
    {
      id: 'place_xinye_seed',
      name: '新野县',
      aliases: ['新野', 'XINYE'],
      level: 'county',
      mapLayer: 'place',
      summary: 'seed',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
    },
  ],
};

const regionB: MapNode = {
  ...regionA,
  id: 'region_b',
  name: '乙郡',
  subLocations: [],
};

const worldBook: WorldBook = {
  manifest: {
    id: 'canonical-map-test', name: 'test', version: '1', author: 'test', language: 'zh-CN',
    genre: 'test', source: 'official', compatibleEngineVersion: '0.1.0',
  },
  ontology: {
    regionLevels: [], factionTypes: [], actorRoleTypes: [], socialClasses: [], resourceTypes: [],
    conflictTypes: [], actionTypes: [], relationshipTypes: [],
  },
  lore: '',
  mapSeed: [regionA, regionB],
  factionsSeed: [],
  timelineAnchors: [],
  startBookmarks: [],
  openingCrisisTemplates: [],
  prompts: { narrativeBaseline: '', forbiddenTopics: [], outputFormat: '', toneGuide: '' },
  validationRules: [],
};

function makeState(mapNodes: MapNode[] = []): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook.manifest.id,
    worldBookVersion: '1',
    worldBookSource: 'official',
    startDate: 'day 1',
    currentDate: 'day 1',
    player: { id: 'player', name: 'Player', roleType: 'traveler', summary: '' },
    currentLocationId: 'place_xinye_seed',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    mapNodes,
  });
}

function write(overrides: Partial<Parameters<typeof applyLocationWriteSuggestion>[2]> = {}) {
  return {
    locationId: 'place_incoming',
    name: '  新野县  ',
    aliases: ['新野县'],
    kind: 'county',
    mapLayer: 'place' as const,
    parentId: 'region_a',
    summary: 'incoming',
    permanence: 'permanent' as const,
    ...overrides,
  };
}

describe('runtime map canonical location identity', () => {
  it('indexes a 5000-node nested runtime chain iteratively', () => {
    const nodeCount = 5000;
    let nested: MapNode | undefined;
    for (let index = nodeCount - 1; index >= 0; index -= 1) {
      nested = {
        id: `runtime_deep_${String(index).padStart(5, '0')}`,
        name: `Runtime deep ${index}`,
        level: 'county',
        mapLayer: 'place',
        summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
        subLocations: nested ? [nested] : undefined,
      };
    }

    let index: ReturnType<typeof buildRuntimeMapIndex> | undefined;
    const metrics = { collectNodeVisits: 0 };
    const buildIndexWithMetrics = buildRuntimeMapIndex as unknown as (
      targetWorldBook: WorldBook,
      state: RuntimeState,
      traversalMetrics: typeof metrics,
    ) => ReturnType<typeof buildRuntimeMapIndex>;
    expect(() => {
      index = buildIndexWithMetrics(worldBook, makeState(nested ? [nested] : []), metrics);
    }).not.toThrow();
    expect(Object.keys(index?.nodeById ?? {}).filter((id) => id.startsWith('runtime_deep_')))
      .toHaveLength(nodeCount);
    expect(metrics.collectNodeVisits).toBeGreaterThanOrEqual(nodeCount);
    expect(metrics.collectNodeVisits).toBeLessThanOrEqual(nodeCount + 10);
  });

  it('reuses a unique same-parent seed by normalized name and publishes its canonical ID', () => {
    const result = applyLocationWriteSuggestion(worldBook, makeState(), write());

    expect(result.applied).toBe(true);
    expect(result.canonicalLocationId).toBe('place_xinye_seed');
    expect(result.state.mapNodes).toEqual([
      expect.objectContaining({ id: 'place_xinye_seed', name: '新野县' }),
    ]);
  });

  it('reuses a unique alias match', () => {
    const result = applyLocationWriteSuggestion(worldBook, makeState(), write({ name: 'ｘｉｎｙｅ', aliases: [] }));
    expect(result.canonicalLocationId).toBe('place_xinye_seed');
  });

  it('does not merge same names across parent, layer, or kind boundaries', () => {
    const differentParent = applyLocationWriteSuggestion(worldBook, makeState(), write({ parentId: 'region_b' }));
    const differentKind = applyLocationWriteSuggestion(worldBook, makeState(), write({ kind: 'city' }));
    const differentLayer = applyLocationWriteSuggestion(worldBook, makeState(), write({
      locationId: 'scene_incoming',
      name: '新野县',
      kind: 'county',
      mapLayer: 'scene',
      parentId: 'place_xinye_seed',
    }));

    expect(differentParent.canonicalLocationId).toBe('place_incoming');
    expect(differentKind.canonicalLocationId).toBe('place_incoming');
    expect(differentLayer.canonicalLocationId).toBe('scene_incoming');
  });

  it('rejects an ambiguous semantic match without publishing a mapping', () => {
    const duplicate: MapNode = {
      id: 'place_xinye_duplicate',
      name: '新野别称',
      aliases: ['新野县'],
      level: 'county',
      mapLayer: 'place',
      parentId: 'region_a',
      summary: '',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
    };

    const result = applyLocationWriteSuggestion(worldBook, makeState([duplicate]), write());

    expect(result.applied).toBe(false);
    expect(result.canonicalLocationId).toBeUndefined();
    expect(result.errors.join('\n')).toMatch(/歧义|ambiguous/i);
    expect(result.diagnostics).toEqual([{
      code: 'location-canonical-ambiguous',
      incomingLocationId: 'place_incoming',
      candidateIds: ['place_xinye_duplicate', 'place_xinye_seed'],
      message: expect.stringMatching(/歧义|ambiguous/i),
    }]);
    expect(result.state).toEqual(makeState([duplicate]));
  });

  it('adds a zero-based suggestion index to structured ambiguity diagnostics for a batch', () => {
    const duplicate: MapNode = {
      id: 'place_xinye_duplicate', name: '新野别称', aliases: ['新野县'], level: 'county',
      mapLayer: 'place', parentId: 'region_a', summary: '', connectedRegionIds: [],
      controlHint: '', tensionHint: '',
    };

    const result = applyLocationWriteSuggestionsSequentially(worldBook, makeState([duplicate]), [write()]);

    expect(result.aliasMap.size).toBe(0);
    expect(result.errors.join('\n')).toMatch(/歧义|ambiguous/i);
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: 'location-canonical-ambiguous',
      incomingLocationId: 'place_incoming',
      candidateIds: ['place_xinye_duplicate', 'place_xinye_seed'],
      suggestionIndex: 0,
    })]);
  });

  it.each([
    { parentId: 'region_b', mapLayer: 'place' as const, kind: 'county' },
    { parentId: 'region_a', mapLayer: 'scene' as const, kind: 'county' },
    { parentId: 'region_a', mapLayer: 'place' as const, kind: 'city' },
    { parentId: 'region_a', mapLayer: 'place' as const, kind: 'COUNTY' },
  ])('rejects an exact seed ID whose canonical scope changes: %#', (scope) => {
    const result = applyLocationWriteSuggestion(worldBook, makeState(), write({
      locationId: 'place_xinye_seed',
      ...scope,
    }));

    expect(result.applied).toBe(false);
    expect(result.canonicalLocationId).toBeUndefined();
    expect(result.errors.join('\n')).toMatch(/scope|parent|mapLayer|kind|身份范围/i);
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: 'location-canonical-scope-conflict',
      incomingLocationId: 'place_xinye_seed',
      candidateIds: ['place_xinye_seed'],
    })]);
    expect(result.state.mapNodes).toEqual([]);
  });

  it('keeps a same-name runtime-only location on its persisted identity when repeated metadata drifts', () => {
    const runtimeLocation: MapNode = {
      id: 'place_nanyang_luomagu',
      name: '落马谷',
      level: '险地',
      mapLayer: 'place',
      parentId: 'place_xinye_seed',
      summary: '旧档已经确认的伏击地点。',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
    };

    const result = applyLocationWriteSuggestion(worldBook, makeState([runtimeLocation]), write({
      locationId: 'place_nanyang_luomagu',
      name: '落马谷',
      kind: '据点',
      mapLayer: 'place',
      parentId: 'region_a',
      summary: '本回合再次到达落马谷。',
    }));

    expect(result.applied).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.canonicalLocationId).toBe('place_nanyang_luomagu');
    expect(result.state.mapNodes).toEqual([
      expect.objectContaining({
        id: 'place_nanyang_luomagu',
        name: '落马谷',
        level: '险地',
        mapLayer: 'place',
        parentId: 'place_xinye_seed',
        summary: '本回合再次到达落马谷。',
      }),
    ]);
  });

  it('resolves an unknown new-place parent from a unique canonical parentPath', () => {
    const result = applyLocationWriteSuggestion(worldBook, makeState(), write({
      locationId: 'place_danshui_valley',
      name: '丹水河谷',
      kind: '河谷',
      parentId: 'region_nanyang_typo',
      parentPath: '甲郡',
      summary: '丹水沿岸的河谷。',
    }));

    expect(result.applied).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.state.mapNodes).toEqual([
      expect.objectContaining({
        id: 'place_danshui_valley',
        parentId: 'region_a',
      }),
    ]);
  });

  it('reports unresolved parent candidates as a structured diagnostic', () => {
    const result = applyLocationWriteSuggestion(worldBook, makeState(), write({
      locationId: 'place_danshui_valley',
      name: '丹水河谷',
      kind: '河谷',
      parentId: 'region_unknown',
      parentPath: '未知州 - 未知郡',
    }));

    expect(result.applied).toBe(false);
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: 'location-parent-unresolved',
      incomingLocationId: 'place_danshui_valley',
      candidateIds: ['region_a'],
    })]);
  });

  it('accepts a trimmed parent identifier but preserves the exact seed scope representation', () => {
    const result = applyLocationWriteSuggestion(worldBook, makeState(), write({
      locationId: 'place_xinye_seed',
      parentId: ' region_a ',
      kind: 'county',
      mapLayer: 'place',
    }));

    expect(result.applied).toBe(true);
    expect(result.state.mapNodes).toEqual([
      expect.objectContaining({
        id: 'place_xinye_seed',
        parentId: 'region_a',
        level: 'county',
        mapLayer: 'place',
      }),
    ]);
  });

  it('rejects kind with surrounding whitespace without persisting a normalized level', () => {
    const state = makeState();
    const result = applyLocationWriteSuggestion(worldBook, state, write({
      locationId: 'place_malformed_kind',
      name: '白水村',
      kind: ' county ',
      parentId: 'region_a',
    }));

    expect(result.applied).toBe(false);
    expect(result.state).toBe(state);
    expect(result.errors.join('\n')).toMatch(/kind.*空白|whitespace/i);
    expect(result.diagnostics).toEqual([{
      code: 'location-kind-malformed',
      message: expect.stringMatching(/kind.*空白|whitespace/i),
      incomingLocationId: 'place_malformed_kind',
      candidateIds: [],
    }]);
  });

  it('trims a same-batch child parent ID before resolving the canonical parent alias', () => {
    const result = applyLocationWriteSuggestionsSequentially(worldBook, makeState(), [
      write({ locationId: 'incoming_xinye' }),
      write({
        locationId: 'incoming_yard',
        name: '县衙后院',
        aliases: [],
        kind: 'yard',
        mapLayer: 'scene',
        parentId: ' incoming_xinye ',
      }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.aliasMap.get('incoming_xinye')).toBe('place_xinye_seed');
    expect(result.state.mapNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'incoming_yard',
        parentId: 'place_xinye_seed',
      }),
    ]));
  });

  it('merges a learned seed overlay once and reuses its alias on the next turn', () => {
    const firstTurn = applyLocationWriteSuggestion(worldBook, makeState(), write({
      locationId: 'place_xinye_seed',
      aliases: ['新野旧城'],
      summary: '第一回合更新的地点摘要',
    }));
    const firstTurnIndex = buildRuntimeMapIndex(worldBook, firstTurn.state);

    expect(firstTurn.applied).toBe(true);
    expect(firstTurnIndex.places.filter((node) => node.id === 'place_xinye_seed')).toHaveLength(1);
    expect(firstTurnIndex.nodeById.place_xinye_seed).toMatchObject({
      parentId: 'region_a',
      level: 'county',
      mapLayer: 'place',
      summary: '第一回合更新的地点摘要',
      aliases: expect.arrayContaining(['新野旧城']),
    });

    const secondTurn = applyLocationWriteSuggestion(worldBook, firstTurn.state, write({
      locationId: 'incoming_second_turn',
      name: '新野旧城',
      aliases: [],
      summary: '第二回合再次确认',
    }));

    expect(secondTurn.applied).toBe(true);
    expect(secondTurn.canonicalLocationId).toBe('place_xinye_seed');
    expect(secondTurn.state.mapNodes?.some((node) => node.id === 'incoming_second_turn')).toBe(false);
  });

  it('keeps seed scope authoritative when building an effective index from a conflicting overlay', () => {
    const conflictingOverlay: MapNode = {
      id: 'place_xinye_seed', name: '运行时新野', aliases: ['运行别名'], level: 'city',
      mapLayer: 'scene', parentId: 'region_b', summary: 'runtime update', connectedRegionIds: [],
      controlHint: 'runtime control', tensionHint: 'runtime tension',
    };

    const index = buildRuntimeMapIndex(worldBook, makeState([conflictingOverlay]));

    expect(index.places.filter((node) => node.id === 'place_xinye_seed')).toHaveLength(1);
    expect(index.scenes.filter((node) => node.id === 'place_xinye_seed')).toHaveLength(0);
    expect(index.nodeById.place_xinye_seed).toMatchObject({
      parentId: 'region_a',
      level: 'county',
      mapLayer: 'place',
      aliases: expect.arrayContaining(['运行别名']),
      summary: 'runtime update',
    });
  });
});
