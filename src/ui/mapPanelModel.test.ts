import { describe, expect, it } from 'vitest';
import type { RuntimeState, WorldBook } from '../engine/types';
import { buildMapPanelModel } from './mapPanelModel';

const worldBook: WorldBook = {
  manifest: {
    id: 'generic-world',
    name: 'Generic World',
    version: '0.1.0',
    author: 'test',
    language: 'zh-CN',
    genre: 'historical-chaos',
    source: 'official',
    compatibleEngineVersion: '0.1.0',
  },
  ontology: {
    regionLevels: [],
    factionTypes: [],
    actorRoleTypes: [],
    socialClasses: [],
    resourceTypes: [],
    conflictTypes: [],
    actionTypes: [],
    relationshipTypes: [],
  },
  lore: '',
  mapSeed: [
    {
      id: 'region_outer',
      name: 'Outer Region',
      level: 'region',
      mapLayer: 'region',
      summary: 'A broad container.',
      connectedRegionIds: [],
      controlHint: 'contested',
      tensionHint: 'tense',
      subLocations: [
        {
          id: 'region_north',
          name: 'North Commandery',
          level: 'commandery',
          mapLayer: 'region',
          summary: 'A second level container.',
          connectedRegionIds: [],
          controlHint: 'local office',
          tensionHint: 'watchful',
          subLocations: [
            {
              id: 'place_county',
              name: 'River County',
              level: 'county',
              mapLayer: 'place',
              summary: 'The current concrete place.',
              connectedRegionIds: [],
              controlHint: 'local office',
              tensionHint: 'busy',
              subLocations: [
                {
                  id: 'scene_market',
                  name: 'Market',
                  level: 'scene',
                  mapLayer: 'scene',
                  summary: 'A local scene.',
                  connectedRegionIds: [],
                  controlHint: 'commoners',
                  tensionHint: 'rumors',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  factionsSeed: [],
  timelineAnchors: [],
  startBookmarks: [],
  openingCrisisTemplates: [],
  prompts: {
    narrativeBaseline: '',
    forbiddenTopics: [],
    outputFormat: '',
    toneGuide: '',
  },
  validationRules: [],
};

const baseState: RuntimeState = {
  engineVersion: '0.1.0',
  worldBookId: 'generic-world',
  worldBookVersion: '0.1.0',
  worldBookSource: 'official',
  startDate: 'day 1',
  currentDate: 'day 1',
  player: {
    id: 'player',
    name: 'Player',
    roleType: 'traveler',
    summary: '',
  },
  currentLocationId: 'place_county',
  currentPlaceId: 'place_county',
  currentSceneId: 'scene_market',
  knownActors: [],
  knownFactions: [],
  relationships: [],
  knownRumors: [],
  activeQuests: [],
  playerResources: {},
  worldStateDelta: {},
  turnLog: [],
  localSituationNotes: [],
  mapNodes: [
    {
      id: 'place_watch_post',
      name: 'Watch Post',
      level: 'outpost',
      mapLayer: 'place',
      parentId: 'region_north',
      summary: 'A runtime place.',
      connectedRegionIds: [],
      controlHint: 'guards',
      tensionHint: 'guarded',
    },
    {
      id: 'place_next_village',
      name: 'Next Village',
      level: 'village',
      mapLayer: 'place',
      parentId: 'region_north',
      summary: 'A next stop beyond the watch post.',
      connectedRegionIds: [],
      controlHint: 'villagers',
      tensionHint: 'quiet',
    },
  ],
  routeEdges: [
    {
      routeId: 'route_county_watch',
      fromPlaceId: 'place_county',
      toPlaceId: 'place_watch_post',
      name: 'County Road',
      status: 'passable',
      source: 'llm',
      knownLevel: 'known' as never,
      standardTravelMinutes: 45,
      travelTimeText: 'about 45 minutes',
    },
    {
      routeId: 'route_watch_next',
      fromPlaceId: 'place_watch_post',
      toPlaceId: 'place_next_village',
      name: 'Ridge Track',
      status: 'passable',
      source: 'llm',
      knownLevel: 'known' as never,
    },
  ],
  routes: [
    {
      routeId: 'legacy_county_watch',
      fromLocationId: 'place_county',
      toLocationId: 'place_watch_post',
      name: 'Legacy Road',
      travelTime: 'half a day',
      riskLevel: 30,
      status: 'passable',
      source: 'known' as never,
    },
  ],
};

describe('map panel model', () => {
  it('builds a generic current map projection for the main UI', () => {
    const model = buildMapPanelModel(worldBook, {
      ...baseState,
      memoryArchive: {
        recentTurnSummaries: [],
        midTermSummaries: [],
        longTermFacts: [],
        npcInteractionSummaries: [],
        locationMemorySummaries: [
          {
            locationId: 'place_county',
            locationName: 'River County',
            summary: 'The market has become the usual place for river rumors.',
            updatedAt: 'day 3',
          },
          {
            locationId: 'place_watch_post',
            locationName: 'Watch Post',
            summary: 'Unrelated outpost memory.',
            updatedAt: 'day 3',
          },
        ],
        settings: {
          recentRawTurnLimit: 4,
          recentTurnLimit: 20,
          recentTurnCompressThreshold: 30,
          recentTurnKeepAfterCompress: 12,
          npcRecentMemoryDefaultLimit: 2,
          npcRecentMemoryImportantLimit: 5,
          focusedNpcRecentMemoryLimit: 6,
          npcMemoryCompressThreshold: 40,
          npcMemoryKeepAfterCompress: 12,
          locationMemoryCompressThreshold: 30,
          taskMemoryCompressThreshold: 30,
          midTermSummaryLimit: 3,
          longTermFactLimit: 8,
          vectorResultLimit: 6,
          maxPromptMemoryTokens: 30000,
          recentStoryTokenBudget: 8000,
          npcMemoryTokenBudget: 8000,
          midTermTokenBudget: 6000,
          longTermFactTokenBudget: 5000,
          locationMemoryTokenBudget: 3000,
          retrievalTokenBudget: 8000,
          enableAutoMemorySummary: true,
          preferDedicatedMemorySummaryApi: true,
        },
      },
    });

    expect(model.displayPath).toBe('Outer Region - North Commandery - River County - Market');
    expect(model.currentPlaceName).toBe('River County');
    expect(model.currentSceneName).toBe('Market');
    expect(model.scenes.map((scene) => scene.name)).toEqual(['Market']);
    expect(model.nearbyRoutes).toEqual([
      expect.objectContaining({
        routeId: 'route_county_watch',
        toPlaceId: 'place_watch_post',
        toPlaceName: 'Watch Post',
        sourceKind: 'mapV1',
        travelTimeText: 'about 45 minutes',
        toPlaceSummary: 'A runtime place.',
      }),
    ]);
    expect((model.nearbyRoutes[0] as any).onwardRoutes).toEqual([
      expect.objectContaining({
        routeId: 'route_watch_next',
        toPlaceName: 'Next Village',
      }),
    ]);
    expect(model.legacyRoutes).toEqual([
      expect.objectContaining({
        routeId: 'legacy_county_watch',
        toPlaceId: 'place_watch_post',
        toPlaceName: 'Watch Post',
        sourceKind: 'legacyLedger',
        travelTimeText: 'half a day',
      }),
    ]);
    expect(model.locationMemorySummaries).toEqual([
      {
        locationId: 'place_county',
        locationName: 'River County',
        summary: 'The market has become the usual place for river rumors.',
        updatedAt: 'day 3',
      },
    ]);
    expect(model.counts).toMatchObject({
      regions: 2,
      places: 3,
      scenes: 1,
      routes: 2,
      legacyRoutes: 1,
      dynamicPlaces: 2,
      dynamicScenes: 0,
    });
  });

  it('counts and displays worldbook route seeds before runtime route writebacks exist', () => {
    const worldBookWithRouteSeed: WorldBook = {
      ...worldBook,
      routeSeed: [
        {
          routeId: 'route_seed_county_gate',
          fromPlaceId: 'place_county',
          toPlaceId: 'place_watch_post',
          name: 'County Gate Road',
          routeKind: '官道',
          status: 'passable',
          source: 'worldbook',
          knownLevel: '听闻',
        },
        {
          routeId: 'route_seed_watch_next',
          fromPlaceId: 'place_watch_post',
          toPlaceId: 'place_next_village',
          name: 'Gate Beyond the Watch',
          routeKind: '小路',
          status: 'passable',
          source: 'worldbook',
          knownLevel: '听闻',
        },
      ],
    };
    const model = buildMapPanelModel(worldBookWithRouteSeed, {
      ...baseState,
      routeEdges: [],
      routes: [],
    });

    expect(model.nearbyRoutes).toEqual([
      expect.objectContaining({
        routeId: 'route_seed_county_gate',
        toPlaceId: 'place_watch_post',
        sourceKind: 'mapV1',
        toPlaceName: 'Watch Post',
        routeKind: '官道',
        toPlaceSummary: 'A runtime place.',
      }),
    ]);
    expect((model.nearbyRoutes[0] as any).onwardRoutes).toEqual([
      expect.objectContaining({
        routeId: 'route_seed_watch_next',
        toPlaceName: 'Next Village',
      }),
    ]);
    expect(model.counts.routes).toBe(2);
  });

  it('falls back gracefully before the current place enters Map V1', () => {
    const model = buildMapPanelModel(worldBook, {
      ...baseState,
      currentLocationId: 'unknown_place',
      currentPlaceId: 'unknown_place',
      currentSceneId: undefined,
      routes: [],
    });

    expect(model.displayPath).toBe('unknown_place');
    expect(model.currentPlaceName).toBe('unknown_place');
    expect(model.scenes).toEqual([]);
    expect(model.nearbyRoutes).toEqual([]);
    expect(model.legacyRoutes).toEqual([]);
  });

  it('uses the resolved current location when legacy currentPlaceId is stale', () => {
    const model = buildMapPanelModel(worldBook, {
      ...baseState,
      currentLocationId: 'place_watch_post',
      currentPlaceId: 'place_county',
      currentSceneId: undefined,
    });

    expect(model.displayPath).toBe('Outer Region - North Commandery - Watch Post');
    expect(model.currentPlaceName).toBe('Watch Post');
    expect(model.nearbyRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        routeId: 'route_county_watch',
        toPlaceId: 'place_county',
        toPlaceName: 'River County',
      }),
    ]));
    expect(model.legacyRoutes).toEqual([
      expect.objectContaining({
        routeId: 'legacy_county_watch',
        toPlaceId: 'place_county',
        toPlaceName: 'River County',
      }),
    ]);
  });
});
