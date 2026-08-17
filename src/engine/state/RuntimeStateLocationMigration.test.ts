import { describe, expect, it } from 'vitest';
import type { MapNode, RuntimeState, WorldBook } from '../types';
import { registerWorldBook } from '../worldbook';
import { buildRuntimeMapIndex } from '../map/runtimeMap';
import { ensureLuanShiState } from './createInitialRuntimeState';
import { hasPersistenceValueChanged } from './persistenceChange';
import {
  CURRENT_RUNTIME_STATE_MIGRATION_VERSION,
  normalizeRuntimeStateForPersistence,
} from './RuntimeStateMigration';
import * as runtimeStateMigration from './RuntimeStateMigration';

const seedPlace: MapNode = {
  id: 'place_seed', name: '新野县', aliases: ['新野'], level: 'county', mapLayer: 'place',
  summary: 'seed', connectedRegionIds: [], controlHint: '', tensionHint: '',
};

const worldBook: WorldBook = {
  manifest: {
    id: 'location-migration-test', name: 'test', version: '1', author: 'test', language: 'zh-CN',
    genre: 'test', source: 'custom', compatibleEngineVersion: '0.1.0',
  },
  ontology: {
    regionLevels: [], factionTypes: [], actorRoleTypes: [], socialClasses: [], resourceTypes: [],
    conflictTypes: [], actionTypes: [], relationshipTypes: [],
  },
  lore: '',
  mapSeed: [{
    id: 'region_a', name: '甲郡', level: 'commandery', mapLayer: 'region', summary: '',
    connectedRegionIds: [], controlHint: '', tensionHint: '', subLocations: [seedPlace],
  }, {
    id: 'region_b', name: '乙郡', level: 'commandery', mapLayer: 'region', summary: '',
    connectedRegionIds: [], controlHint: '', tensionHint: '',
  }],
  factionsSeed: [], timelineAnchors: [], startBookmarks: [], openingCrisisTemplates: [],
  prompts: { narrativeBaseline: '', forbiddenTopics: [], outputFormat: '', toneGuide: '' },
  validationRules: [],
};

function duplicateNode(id: string, parentId = 'region_a'): MapNode {
  return {
    id, name: '新野', aliases: ['新野县'], level: 'county', mapLayer: 'place', parentId,
    summary: id, connectedRegionIds: ['place_dynamic'], controlHint: '', tensionHint: '',
  };
}

function findMapNode(nodes: MapNode[] | undefined, id: string): MapNode | undefined {
  for (const node of nodes ?? []) {
    if (node.id === id) return node;
    const child = findMapNode(node.subLocations, id);
    if (child) return child;
  }
  return undefined;
}

function flattenTestMapNodes(nodes: MapNode[] | undefined): MapNode[] {
  const result: MapNode[] = [];
  const stack = [...(nodes ?? [])].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    result.push(node);
    const children = node.subLocations ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
  return result;
}

function makeLegacyState(): RuntimeState {
  const state = ensureLuanShiState({
    engineVersion: '0.1.0', worldBookId: worldBook.manifest.id, worldBookVersion: '1',
    worldBookSource: 'custom', startDate: 'day 1', currentDate: 'day 1',
    player: {
      id: 'player', name: 'Player', roleType: 'traveler', summary: '', locationId: 'place_dynamic',
      playerMemory: {
        summary: '', recentTurns: [],
        keyDeeds: [{ id: 'deed', date: 'day 1', summary: 'deed', locationId: 'place_dynamic' }],
      },
    },
    currentLocationId: 'place_dynamic', currentPlaceId: 'place_dynamic', currentSceneId: 'scene_child',
    knownActors: [{ id: 'actor', name: 'Actor', roleType: 'npc', summary: '', locationId: 'place_dynamic' }],
    knownFactions: [], relationships: [],
    knownRumors: [{
      id: 'rumor', content: 'rumor', source: 'source', verified: false, createdAt: 'day 1',
      relatedLocationIds: ['place_dynamic'], affectedPlaceIds: ['place_dynamic'],
    }],
    activeQuests: [{
      id: 'quest', title: 'quest', description: '', status: 'active', createdAt: 'day 1', updatedAt: 'day 1',
      targetLocationId: 'place_dynamic', relatedLocationIds: ['place_dynamic'], affectedPlaceIds: ['place_dynamic'],
    }],
    playerResources: {}, worldStateDelta: {}, turnLog: [], localSituationNotes: [],
    mapNodes: [
      duplicateNode('place_dynamic'),
      {
        id: 'scene_child', name: '县衙后院', level: 'scene', mapLayer: 'scene', parentId: 'place_dynamic',
        summary: '', connectedRegionIds: ['place_dynamic'], controlHint: '', tensionHint: '',
      },
      duplicateNode('place_other_parent', 'region_b'),
    ],
    routeEdges: [{
      routeId: 'edge', fromPlaceId: 'place_dynamic', toPlaceId: 'place_other_parent', name: 'road',
      status: 'open', source: 'llm', knownLevel: '亲历',
    }],
    npcs: [{
      npcId: 'npc', name: 'Npc', sex: '男', age: 30, role: 'npc', locationId: 'place_dynamic',
      isPresent: true, isFocused: false, summary: '', appearance: '', personality: '', motivation: '',
      relationToPlayer: '', contactLevel: 1, recentAttitude: '', memories: [],
    }],
    turnEvents: [{
      eventId: 'event', happenedAt: 'day 1', locationId: 'place_dynamic', summary: '',
      presentNpcIds: [], involvedNpcIds: [], visibility: '公开',
    }],
    locations: [{
      locationId: 'place_dynamic', name: '新野', type: 'county', summary: '', knownLevel: '亲历', recentEvents: [],
    }],
    routes: [{
      routeId: 'legacy_route', fromLocationId: 'place_dynamic', toLocationId: 'place_other_parent',
      name: 'road', travelTime: '', riskLevel: 0, status: '', source: '亲历',
    }],
    holdings: [{
      holdingId: 'holding', name: 'holding', type: 'county', status: 'controlled', summary: '',
      locationId: 'place_dynamic', scaleLevel: 1, agriculture: 0, commerce: 0, population: 0,
      publicOrder: 0, popularSupport: 0, defense: 0, recruitPotential: 0, armory: 0,
      horseSupply: 0, corruption: 0, updatedAt: 'day 1',
    }],
    privateAssets: [{
      privateAssetId: 'asset', name: 'asset', type: 'estate', ownerScope: 'personal', status: 'active',
      summary: '', locationId: 'place_dynamic', updatedAt: 'day 1',
    }],
    troops: [{
      troopId: 'troop', name: 'troop', size: 10, locationId: 'place_dynamic',
      lastKnownLocationId: 'place_dynamic', destinationLocationId: 'place_dynamic', morale: 1, training: 1,
      supplies: 1, task: '', relationToPlayer: '',
    }],
    worldTrends: [{
      trendId: 'trend', title: 'trend', severity: '低', summary: '', knownToPlayer: true,
      locationId: 'place_dynamic', relatedPlaceIds: ['place_dynamic'], affectedPlaceIds: ['place_dynamic'],
      updatedAt: 'day 1',
    }],
    conflicts: [{
      conflictId: 'conflict', type: '其他', title: 'conflict', summary: '', occurredAt: 'day 1',
      outcome: '', locationId: 'place_dynamic',
    }],
    combatRecords: [{
      combatId: 'combat', kind: 'other', title: 'combat', summary: '', occurredAt: 'day 1',
      locationId: 'place_dynamic', participants: [], playerInvolved: true, resultLevel: 'win',
      outcome: '', significance: 'minor',
    }],
    memoryArchive: {
      recentTurnSummaries: [],
      midTermSummaries: [{
        summaryId: 'mid', title: '', fromCreatedAt: '', toCreatedAt: '', summary: '',
        relatedLocationIds: ['place_dynamic'], updatedAt: 'day 1',
      }],
      longTermFacts: [{
        factId: 'long', category: 'location', createdAt: 'day 1', summary: '', importance: 'high',
        relatedLocationIds: ['place_dynamic'],
      }],
      npcInteractionSummaries: [],
      locationMemorySummaries: [{ locationId: 'place_dynamic', summary: '', updatedAt: 'day 1' }],
      settings: {
        recentRawTurnLimit: 1, recentTurnLimit: 1, recentTurnCompressThreshold: 1,
        recentTurnKeepAfterCompress: 1, npcRecentMemoryDefaultLimit: 1, npcRecentMemoryImportantLimit: 1,
        focusedNpcRecentMemoryLimit: 1, npcMemoryCompressThreshold: 1, npcMemoryKeepAfterCompress: 1,
        locationMemoryCompressThreshold: 1, taskMemoryCompressThreshold: 1, midTermSummaryLimit: 1,
        longTermFactLimit: 1, vectorResultLimit: 1, maxPromptMemoryTokens: 1, recentStoryTokenBudget: 1,
        npcMemoryTokenBudget: 1, midTermTokenBudget: 1, longTermFactTokenBudget: 1,
        locationMemoryTokenBudget: 1, retrievalTokenBudget: 1, enableAutoMemorySummary: false,
        preferDedicatedMemorySummaryApi: false,
      },
    },
    lastStatePatch: {
      type: 'luanshiCommand',
      payload: {
        action: 'upsertTroopLedger', troopId: 'troop', locationId: 'place_dynamic',
        lastKnownLocationId: 'place_dynamic', destinationLocationId: 'place_dynamic',
      },
      reason: 'legacy',
    },
  });
  return state;
}

describe('RuntimeState location migration', () => {
  it('exposes a structured migration result API for completion and diagnostics', () => {
    expect((runtimeStateMigration as Record<string, unknown>).migrateRuntimeStateForPersistence)
      .toBeTypeOf('function');
  });

  it('uses the registered worldbook seed as canonical and remaps every typed persisted reference', () => {
    registerWorldBook(worldBook);
    const input = makeLegacyState();
    const snapshot = structuredClone(input);

    const migrated = normalizeRuntimeStateForPersistence(input);

    expect(CURRENT_RUNTIME_STATE_MIGRATION_VERSION).toBe(20);
    expect(input).toEqual(snapshot);
    expect(migrated.currentLocationId).toBe('place_seed');
    expect(migrated.currentPlaceId).toBe('place_seed');
    expect(migrated.currentSceneId).toBe('scene_child');
    expect(migrated.player.locationId).toBe('place_seed');
    expect(migrated.player.playerMemory?.keyDeeds[0].locationId).toBe('place_seed');
    expect(migrated.knownActors[0].locationId).toBe('place_seed');
    expect(migrated.npcs?.[0].locationId).toBe('place_seed');
    expect(migrated.turnEvents?.[0].locationId).toBe('place_seed');
    expect(migrated.locations?.[0].locationId).toBe('place_seed');
    expect(migrated.routes?.[0].fromLocationId).toBe('place_seed');
    expect(migrated.routeEdges?.[0].fromPlaceId).toBe('place_seed');
    expect(migrated.holdings?.[0].locationId).toBe('place_seed');
    expect(migrated.privateAssets?.[0].locationId).toBe('place_seed');
    expect(migrated.troops?.[0]).toMatchObject({
      locationId: 'place_seed', lastKnownLocationId: 'place_seed', destinationLocationId: 'place_seed',
    });
    expect(migrated.activeQuests[0]).toMatchObject({
      targetLocationId: 'place_seed', relatedLocationIds: ['place_seed'], affectedPlaceIds: ['place_seed'],
    });
    expect(migrated.knownRumors[0]).toMatchObject({
      relatedLocationIds: ['place_seed'], affectedPlaceIds: ['place_seed'],
    });
    expect(migrated.worldTrends?.[0]).toMatchObject({
      locationId: 'place_seed', relatedPlaceIds: ['place_seed'], affectedPlaceIds: ['place_seed'],
    });
    expect(migrated.conflicts?.[0].locationId).toBe('place_seed');
    expect(migrated.combatRecords?.[0].locationId).toBe('place_seed');
    expect(migrated.memoryArchive?.midTermSummaries[0].relatedLocationIds).toEqual(['place_seed']);
    expect(migrated.memoryArchive?.longTermFacts[0].relatedLocationIds).toEqual(['place_seed']);
    expect(migrated.memoryArchive?.locationMemorySummaries[0].locationId).toBe('place_seed');
    expect(migrated.lastStatePatch?.payload).toMatchObject({
      locationId: 'place_seed', lastKnownLocationId: 'place_seed', destinationLocationId: 'place_seed',
    });
    expect(migrated.mapNodes?.some((node) => node.id === 'place_dynamic')).toBe(false);
    expect(findMapNode(migrated.mapNodes, 'scene_child')?.parentId).toBe('place_seed');
    expect(findMapNode(migrated.mapNodes, 'scene_child')?.connectedRegionIds).toEqual(['place_seed']);
    expect(findMapNode(migrated.mapNodes, 'place_other_parent')).toBeDefined();
    expect(normalizeRuntimeStateForPersistence(migrated)).toEqual(migrated);
  });

  it('chooses the lexicographically stable runtime ID and never merges same names under different parents', () => {
    const input = makeLegacyState();
    input.worldBookId = 'unregistered-world';
    input.mapNodes = [
      duplicateNode('runtime_z'),
      duplicateNode('runtime_a'),
      duplicateNode('runtime_other_parent', 'region_b'),
    ];
    input.currentLocationId = 'runtime_z';

    const migrated = normalizeRuntimeStateForPersistence(input);

    expect(migrated.currentLocationId).toBe('runtime_a');
    expect(migrated.mapNodes?.map((node) => node.id).sort()).toEqual(['runtime_a', 'runtime_other_parent']);
  });

  it('keeps the seed authoritative when a runtime node steals its exact ID with a conflicting scope', () => {
    registerWorldBook(worldBook);
    const input = makeLegacyState();
    input.currentLocationId = 'place_seed';
    input.currentPlaceId = 'place_seed';
    input.mapNodes = [{
      ...duplicateNode('place_seed', 'region_b'),
      name: '伪新野',
      aliases: [],
      summary: 'must not overlay seed',
      subLocations: [{
        id: 'scene_under_conflict', name: '后院', level: 'scene', mapLayer: 'scene',
        summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
      }],
    }];

    const result = runtimeStateMigration.migrateRuntimeStateForPersistence(input);

    expect(result.complete).toBe(true);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'location-seed-scope-conflict',
        locationIds: ['place_seed'],
      }),
    ]));
    expect(result.state.currentLocationId).toBe('place_seed');
    expect(result.state.mapNodes?.some((node) => node.id === 'place_seed')).toBe(false);
    expect(findMapNode(result.state.mapNodes, 'scene_under_conflict')?.parentId).toBe('place_seed');
  });

  it('preserves the seed scope representation when an exact-ID runtime parent only differs by identifier whitespace', () => {
    registerWorldBook(worldBook);
    const input = makeLegacyState();
    input.mapNodes = [{
      ...duplicateNode('place_seed', ' region_a '),
      summary: 'runtime overlay',
    }];

    const result = runtimeStateMigration.migrateRuntimeStateForPersistence(input);
    const migratedSeedOverlay = findMapNode(result.state.mapNodes, 'place_seed');

    expect(result.complete).toBe(true);
    expect(migratedSeedOverlay).toMatchObject({
      parentId: 'region_a',
      level: 'county',
      mapLayer: 'place',
    });
  });

  it.each([
    { level: 'COUNTY', mapLayer: 'place' as const },
    { level: 'county', mapLayer: 'scene' as const },
  ])('rejects an exact seed ID whose strict level or mapLayer representation conflicts: %#', (scope) => {
    registerWorldBook(worldBook);
    const input = makeLegacyState();
    input.currentLocationId = 'place_seed';
    input.currentPlaceId = 'place_seed';
    input.mapNodes = [{
      ...duplicateNode('place_seed'),
      ...scope,
      summary: 'must not overlay seed scope',
    }];

    const result = runtimeStateMigration.migrateRuntimeStateForPersistence(input);

    expect(result.complete).toBe(true);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'location-seed-scope-conflict',
        locationIds: ['place_seed'],
      }),
    ]));
    expect(findMapNode(result.state.mapNodes, 'place_seed')).toBeUndefined();
    expect(result.state.currentLocationId).toBe('place_seed');
  });

  it('preserves an ambiguous incoming node without publishing a mapping and returns visible diagnostics', () => {
    const ambiguousWorldBook: WorldBook = {
      ...worldBook,
      manifest: { ...worldBook.manifest, id: 'ambiguous-location-migration-test' },
      mapSeed: [{
        id: 'region_a', name: '甲郡', level: 'commandery', mapLayer: 'region', summary: '',
        connectedRegionIds: [], controlHint: '', tensionHint: '', subLocations: [
          { ...seedPlace, id: 'place_candidate_a', name: '甲地', aliases: ['共同别名'] },
          { ...seedPlace, id: 'place_candidate_b', name: '乙地', aliases: ['共同别名'] },
        ],
      }],
    };
    registerWorldBook(ambiguousWorldBook);
    const input = makeLegacyState();
    input.worldBookId = ambiguousWorldBook.manifest.id;
    input.currentLocationId = 'place_ambiguous';
    input.currentPlaceId = 'place_ambiguous';
    input.mapNodes = [{
      ...duplicateNode('place_ambiguous'),
      name: '共同别名',
      aliases: [],
    }];

    const result = runtimeStateMigration.migrateRuntimeStateForPersistence(input);

    expect(result.state.currentLocationId).toBe('place_ambiguous');
    expect(findMapNode(result.state.mapNodes, 'place_ambiguous')).toBeDefined();
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'location-canonical-ambiguous',
        locationIds: ['place_ambiguous', 'place_candidate_a', 'place_candidate_b'],
      }),
    ]));
  });

  it('defers seed-dependent v4 completion when runtime map nodes exist but the worldbook is unavailable', () => {
    const input = makeLegacyState();
    input.worldBookId = 'missing-custom-worldbook';
    input.worldBookSource = 'custom';

    const result = runtimeStateMigration.migrateRuntimeStateForPersistence(input);

    expect(result.complete).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'location-worldbook-unavailable' }),
    ]));
  });

  it('trims a child parent ID before remapping a same-migration canonical parent alias', () => {
    registerWorldBook(worldBook);
    const input = makeLegacyState();
    input.mapNodes = [
      duplicateNode('incoming_xinye'),
      {
        id: 'scene_child', name: '县衙后院', level: 'yard', mapLayer: 'scene',
        parentId: ' incoming_xinye ', summary: '', connectedRegionIds: [],
        controlHint: '', tensionHint: '',
      },
    ];

    const result = runtimeStateMigration.migrateRuntimeStateForPersistence(input);

    expect(result.complete).toBe(true);
    expect(findMapNode(result.state.mapNodes, 'scene_child')?.parentId).toBe('place_seed');
    expect(findMapNode(result.state.mapNodes, 'incoming_xinye')).toBeUndefined();
  });

  it('defers an empty-map v3 migration until its worldbook becomes available', () => {
    const input = makeLegacyState();
    input.worldBookId = 'delayed-empty-map-worldbook';
    input.worldBookSource = 'custom';
    input.mapNodes = [];
    const delayedWorldBook: WorldBook = {
      ...worldBook,
      manifest: {
        ...worldBook.manifest,
        id: input.worldBookId,
        source: 'custom',
      },
    };

    const deferred = runtimeStateMigration.migrateRuntimeStateForPersistence(input);
    const retried = runtimeStateMigration.migrateRuntimeStateForPersistence(
      deferred.state,
      { worldBook: delayedWorldBook },
    );

    expect(deferred.complete).toBe(false);
    expect(deferred.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'location-worldbook-unavailable' }),
    ]));
    expect(retried.complete).toBe(true);
    expect(retried.diagnostics).toEqual([]);
  });

  it('uses indexed canonical lookups and cached parent depths for 2000 runtime nodes', () => {
    const input = makeLegacyState();
    const nodeCount = 2000;
    input.mapNodes = Array.from({ length: nodeCount }, (_, index): MapNode => ({
      id: `runtime_scale_${String(index).padStart(4, '0')}`,
      name: `规模地点 ${index}`,
      aliases: [`规模别名 ${index}`],
      level: 'county',
      mapLayer: 'place',
      parentId: 'region_a',
      summary: '',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
    }));
    const metrics = {
      candidateKeyLookups: 0,
      depthResolutions: 0,
      flattenNodeVisits: 0,
      parentEdgeTraversals: 0,
      depthStackOperations: 0,
      parentGraphNodeVisits: 0,
      parentCycleBreaks: 0,
      hierarchyNodeAttachments: 0,
      flattenedHierarchyNodes: 0,
    };

    const result = runtimeStateMigration.migrateRuntimeStateForPersistence(
      input,
      { worldBook, metrics },
    );

    expect(result.complete).toBe(true);
    expect(result.state.mapNodes).toHaveLength(nodeCount);
    expect(metrics.candidateKeyLookups).toBeGreaterThan(0);
    expect(metrics.candidateKeyLookups).toBeLessThanOrEqual(nodeCount * 3);
    expect(metrics.depthResolutions).toBeGreaterThan(0);
    expect(metrics.depthResolutions).toBeLessThanOrEqual(nodeCount);
  });

  it('resolves a reverse-ordered 5000-node parent chain with linear stack operations', () => {
    const input = makeLegacyState();
    const nodeCount = 5000;
    input.mapNodes = Array.from({ length: nodeCount }, (_, index): MapNode => ({
      id: `chain_${String(index).padStart(5, '0')}`,
      name: `链地点 ${index}`,
      level: 'county',
      mapLayer: 'place',
      parentId: index === 0 ? 'region_a' : `chain_${String(index - 1).padStart(5, '0')}`,
      summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
    })).reverse();
    const metrics = {
      candidateKeyLookups: 0,
      depthResolutions: 0,
      flattenNodeVisits: 0,
      parentEdgeTraversals: 0,
      depthStackOperations: 0,
      parentGraphNodeVisits: 0,
      parentCycleBreaks: 0,
      hierarchyNodeAttachments: 0,
      flattenedHierarchyNodes: 0,
    };
    let result: ReturnType<typeof runtimeStateMigration.migrateRuntimeStateForPersistence> | undefined;

    expect(() => {
      result = runtimeStateMigration.migrateRuntimeStateForPersistence(
        input,
        { worldBook, metrics },
      );
    }).not.toThrow();

    expect(result?.complete).toBe(true);
    expect(metrics.flattenNodeVisits).toBeGreaterThanOrEqual(nodeCount);
    expect(metrics.flattenNodeVisits).toBeLessThanOrEqual(nodeCount + 10);
    expect(metrics.parentEdgeTraversals).toBeGreaterThanOrEqual(nodeCount - 1);
    expect(metrics.parentEdgeTraversals).toBeLessThanOrEqual(nodeCount);
    expect(metrics.depthStackOperations).toBeGreaterThan(0);
    expect(metrics.depthStackOperations).toBeLessThanOrEqual(nodeCount * 2);
  });

  it('passes a 5000-node migrated parent chain through changed detection and runtime indexing', () => {
    const input = makeLegacyState();
    const nodeCount = 5000;
    input.currentLocationId = `downstream_${String(nodeCount - 1).padStart(5, '0')}`;
    input.currentPlaceId = input.currentLocationId;
    input.currentSceneId = undefined;
    input.mapNodes = Array.from({ length: nodeCount }, (_, index): MapNode => ({
      id: `downstream_${String(index).padStart(5, '0')}`,
      name: `Downstream ${index}`,
      level: 'county',
      mapLayer: 'place',
      parentId: index === 0 ? 'region_a' : `downstream_${String(index - 1).padStart(5, '0')}`,
      summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
    })).reverse();

    const migrated = runtimeStateMigration.migrateRuntimeStateForPersistence(input, { worldBook });

    expect(migrated.state.mapNodes).toHaveLength(nodeCount);
    expect(migrated.state.mapNodes?.every((node) => node.subLocations === undefined)).toBe(true);
    expect(migrated.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'location-hierarchy-flattened',
      locationIds: ['downstream_00000', `downstream_${String(nodeCount - 1).padStart(5, '0')}`],
    })]));
    expect(() => hasPersistenceValueChanged(input, migrated.state)).not.toThrow();
    expect(hasPersistenceValueChanged(input, migrated.state)).toBe(true);
    expect(() => buildRuntimeMapIndex(worldBook, migrated.state)).not.toThrow();
    const index = buildRuntimeMapIndex(worldBook, migrated.state);
    expect(Object.keys(index.nodeById).filter((id) => id.startsWith('downstream_'))).toHaveLength(nodeCount);
    expect(index.nodeById[input.currentLocationId]).toBeDefined();
  });

  it('breaks a two-node parent cycle deterministically and preserves every node and reference', () => {
    const input = makeLegacyState();
    input.currentLocationId = 'cycle_b';
    input.currentPlaceId = 'cycle_b';
    input.currentSceneId = undefined;
    input.mapNodes = [{
      id: 'cycle_b', name: 'Cycle B', level: 'county', mapLayer: 'place', parentId: 'cycle_a',
      summary: '', connectedRegionIds: ['cycle_a'], controlHint: '', tensionHint: '',
    }, {
      id: 'cycle_a', name: 'Cycle A', level: 'county', mapLayer: 'place', parentId: 'cycle_b',
      summary: '', connectedRegionIds: ['cycle_b'], controlHint: '', tensionHint: '',
    }];
    const metrics = {
      candidateKeyLookups: 0,
      depthResolutions: 0,
      flattenNodeVisits: 0,
      parentEdgeTraversals: 0,
      depthStackOperations: 0,
      parentGraphNodeVisits: 0,
      parentCycleBreaks: 0,
      hierarchyNodeAttachments: 0,
      flattenedHierarchyNodes: 0,
    };

    const migrated = runtimeStateMigration.migrateRuntimeStateForPersistence(input, { worldBook, metrics });
    const flattened = flattenTestMapNodes(migrated.state.mapNodes);
    const cycleA = flattened.find((node) => node.id === 'cycle_a');
    const cycleB = flattened.find((node) => node.id === 'cycle_b');

    expect(flattened.map((node) => node.id).sort()).toEqual(['cycle_a', 'cycle_b']);
    expect(cycleA?.parentId).toBeUndefined();
    expect(cycleB?.parentId).toBe('cycle_a');
    expect(migrated.state.currentLocationId).toBe('cycle_b');
    expect(migrated.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'location-parent-cycle',
      locationIds: ['cycle_a', 'cycle_b'],
    })]));
    expect((metrics as typeof metrics & { parentCycleBreaks?: number }).parentCycleBreaks).toBe(1);

    const repeated = runtimeStateMigration.migrateRuntimeStateForPersistence(migrated.state, { worldBook });
    expect(repeated.state).toEqual(migrated.state);
  });

  it('preserves a prefix chain entering a parent cycle after breaking the stable cycle root', () => {
    const input = makeLegacyState();
    input.currentLocationId = 'prefix_leaf';
    input.currentPlaceId = 'prefix_leaf';
    input.currentSceneId = undefined;
    input.mapNodes = [{
      id: 'prefix_leaf', name: 'Prefix leaf', level: 'county', mapLayer: 'place', parentId: 'prefix_mid',
      summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
    }, {
      id: 'prefix_mid', name: 'Prefix mid', level: 'county', mapLayer: 'place', parentId: 'cycle_b',
      summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
    }, {
      id: 'cycle_b', name: 'Cycle B', level: 'county', mapLayer: 'place', parentId: 'cycle_a',
      summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
    }, {
      id: 'cycle_a', name: 'Cycle A', level: 'county', mapLayer: 'place', parentId: 'cycle_b',
      summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
    }];

    const migrated = runtimeStateMigration.migrateRuntimeStateForPersistence(input, { worldBook });
    const flattened = flattenTestMapNodes(migrated.state.mapNodes);
    const byId = new Map(flattened.map((node) => [node.id, node]));

    expect(flattened).toHaveLength(4);
    expect(byId.get('cycle_a')?.parentId).toBeUndefined();
    expect(byId.get('cycle_b')?.parentId).toBe('cycle_a');
    expect(byId.get('prefix_mid')?.parentId).toBe('cycle_b');
    expect(byId.get('prefix_leaf')?.parentId).toBe('prefix_mid');
    expect(migrated.state.currentLocationId).toBe('prefix_leaf');
    expect(buildRuntimeMapIndex(worldBook, migrated.state).nodeById.prefix_leaf).toBeDefined();
    expect(migrated.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'location-parent-cycle',
      locationIds: ['cycle_a', 'cycle_b'],
    })]));
  });

  it('flattens a nested 2000-node location tree iteratively with one visit per node', () => {
    const input = makeLegacyState();
    const nodeCount = 2000;
    let nested: MapNode | undefined;
    for (let index = nodeCount - 1; index >= 0; index -= 1) {
      nested = {
        id: `nested_${String(index).padStart(4, '0')}`,
        name: `嵌套地点 ${index}`,
        level: index === 0 ? 'commandery' : 'county',
        mapLayer: index === 0 ? 'region' : 'place',
        summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
        subLocations: nested ? [nested] : undefined,
      };
    }
    input.mapNodes = nested ? [nested] : [];
    const metrics = {
      candidateKeyLookups: 0,
      depthResolutions: 0,
      flattenNodeVisits: 0,
      parentEdgeTraversals: 0,
      depthStackOperations: 0,
      parentGraphNodeVisits: 0,
      parentCycleBreaks: 0,
      hierarchyNodeAttachments: 0,
      flattenedHierarchyNodes: 0,
    };
    let result: ReturnType<typeof runtimeStateMigration.migrateRuntimeStateForPersistence> | undefined;

    expect(() => {
      result = runtimeStateMigration.migrateRuntimeStateForPersistence(
        input,
        { worldBook, metrics },
      );
    }).not.toThrow();

    expect(result?.complete).toBe(true);
    expect(metrics.flattenNodeVisits).toBeGreaterThanOrEqual(nodeCount);
    expect(metrics.flattenNodeVisits).toBeLessThanOrEqual(nodeCount + 10);
    expect(metrics.depthStackOperations).toBeGreaterThan(0);
    expect(metrics.depthStackOperations).toBeLessThanOrEqual(nodeCount * 2);
  });
});
