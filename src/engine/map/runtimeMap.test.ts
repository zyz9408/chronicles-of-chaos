import { describe, expect, it } from 'vitest';
import type { RuntimeState, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import {
  applyLocationWriteSuggestion,
  applyRouteWriteSuggestion,
  buildCurrentMapProjection,
  buildCurrentLocationDisplayPath,
  buildRuntimeMapIndex,
  canonicalizeLocationChangeSceneTargets,
} from './runtimeMap';

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
      name: '外域',
      level: 'region',
      mapLayer: 'region',
      summary: 'A broad region container.',
      connectedRegionIds: [],
      controlHint: 'unknown',
      tensionHint: 'distant',
      subLocations: [
        {
          id: 'region_commandery',
          name: '边郡',
          level: 'commandery',
          mapLayer: 'region',
          summary: 'A smaller region container.',
          connectedRegionIds: [],
          controlHint: 'contested',
          tensionHint: 'tense',
          subLocations: [
            {
              id: 'place_county',
              name: '县城',
              level: 'county',
              mapLayer: 'place',
              summary: 'A concrete place where the player can stand.',
              connectedRegionIds: [],
              controlHint: 'local office',
              tensionHint: 'watchful',
              subLocations: [
                {
                  id: 'scene_market',
                  name: '市集',
                  level: 'scene',
                  mapLayer: 'scene',
                  summary: 'A scene inside the place.',
                  connectedRegionIds: [],
                  controlHint: 'commoners',
                  tensionHint: 'rumors',
                },
              ],
            },
            {
              id: 'place_ferry',
              name: '渡口',
              level: 'ferry',
              mapLayer: 'place',
              summary: 'Another concrete place.',
              connectedRegionIds: [],
              controlHint: 'boatmen',
              tensionHint: 'open road',
            },
            {
              id: 'place_new_post',
              name: '新哨',
              level: 'outpost',
              mapLayer: 'place',
              summary: 'A newly reached concrete place.',
              connectedRegionIds: [],
              controlHint: 'newly held',
              tensionHint: 'uncertain',
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

function makeState(): RuntimeState {
  return ensureLuanShiState({
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
    routeEdges: [
      {
        routeId: 'route_county_ferry',
        fromPlaceId: 'place_county',
        toPlaceId: 'place_ferry',
        name: '县城到渡口官道',
        status: '可通行',
        source: 'worldbook',
        knownLevel: '亲历',
        standardTravelMinutes: 90,
        travelTimeText: '约一个半时辰',
      },
    ],
  });
}

describe('runtime Map V1 helpers', () => {
  it('projects only the current place, scene, local scenes, and nearby routes', () => {
    const projection = buildCurrentMapProjection(worldBook, makeState());

    expect(projection.currentPlaceId).toBe('place_county');
    expect(projection.currentSceneId).toBe('scene_market');
    expect(projection.displayPath).toBe('外域 - 边郡 - 县城 - 市集');
    expect(projection.scenes.map((scene) => scene.id)).toEqual(['scene_market']);
    expect(projection.nearbyRoutes).toEqual([
      expect.objectContaining({
        routeId: 'route_county_ferry',
        toPlaceId: 'place_ferry',
        toPlaceName: '渡口',
        travelTimeText: '约一个半时辰',
      }),
    ]);
  });

  it('projects canonical hierarchy ids and scenes under reachable destination places', () => {
    const state: RuntimeState = {
      ...makeState(),
      mapNodes: [{
        id: 'scene_ferry_boathouse',
        name: '渡口船屋',
        level: 'scene',
        mapLayer: 'scene',
        parentId: 'place_ferry',
        summary: '曾经进入过的渡口船屋。',
        connectedRegionIds: [],
        controlHint: '船户看守',
        tensionHint: '平静',
      }],
    };

    const projection = buildCurrentMapProjection(worldBook, state);

    expect(projection.currentHierarchy.map((node) => node.id)).toEqual([
      'region_outer',
      'region_commandery',
      'place_county',
    ]);
    expect(projection.nearbyRoutes[0]?.destinationScenes.map((scene) => scene.id))
      .toEqual(['scene_ferry_boathouse']);
  });

  it('formats the complete region, subregion, place, and scene path for status displays', () => {
    expect(buildCurrentLocationDisplayPath(worldBook, makeState()))
      .toBe('外域 - 边郡 - 县城 - 市集');
  });

  it('uses a dynamically written scene name instead of exposing its raw location id', () => {
    const state: RuntimeState = {
      ...makeState(),
      currentLocationId: 'location_luomagu',
      currentPlaceId: 'place_new_post',
      currentSceneId: 'location_luomagu',
      mapNodes: [{
        id: 'location_luomagu',
        name: '落马谷',
        level: '山谷场景',
        mapLayer: 'scene',
        parentId: 'place_new_post',
        summary: '新哨外围可设伏的山谷。',
        connectedRegionIds: [],
        controlHint: '无人控制',
        tensionHint: '高',
      }],
    };

    expect(buildCurrentLocationDisplayPath(worldBook, state))
      .toBe('外域 - 边郡 - 新哨 - 落马谷');
  });

  it('falls back to the legacy location ledger name when an old id is not in Map V1', () => {
    const state: RuntimeState = {
      ...makeState(),
      currentLocationId: 'location_luomagu',
      currentPlaceId: undefined,
      currentSceneId: undefined,
      locations: [{
        locationId: 'location_luomagu',
        name: '落马谷',
        type: '山谷',
        summary: '旧存档地点。',
        knownLevel: '亲历',
        recentEvents: [],
      }],
    };

    expect(buildCurrentLocationDisplayPath(worldBook, state)).toBe('落马谷');
  });

  it('canonicalizes an unambiguous scene target into its parent place plus scene id', () => {
    const patches = canonicalizeLocationChangeSceneTargets(worldBook, makeState(), [{
      type: 'locationChange',
      reason: '进入市集',
      payload: { toLocationId: 'scene_market' },
    }]);

    expect(patches).toEqual([{
      type: 'locationChange',
      reason: '进入市集',
      payload: {
        toLocationId: 'place_county',
        toSceneId: 'scene_market',
      },
    }]);
  });

  it('does not guess when a scene target conflicts with an explicit different scene id', () => {
    const patch = {
      type: 'locationChange' as const,
      reason: '冲突目标',
      payload: {
        toLocationId: 'scene_market',
        toSceneId: 'scene_other',
      },
    };

    expect(canonicalizeLocationChangeSceneTargets(worldBook, makeState(), [patch]))
      .toEqual([patch]);
  });

  it('prefers currentLocationId when legacy currentPlaceId is stale after movement', () => {
    const state: RuntimeState = {
      ...makeState(),
      currentLocationId: 'place_new_post',
      currentPlaceId: 'place_county',
      currentSceneId: undefined,
    };

    const projection = buildCurrentMapProjection(worldBook, state);

    expect(projection.currentPlaceId).toBe('place_new_post');
    expect(projection.displayPath).toBe('外域 - 边郡 - 新哨');
  });

  it('treats a scene currentLocationId as the current scene under its parent place', () => {
    const state: RuntimeState = {
      ...makeState(),
      currentLocationId: 'scene_market',
      currentPlaceId: 'place_county',
      currentSceneId: undefined,
    };

    const projection = buildCurrentMapProjection(worldBook, state);

    expect(projection.currentPlaceId).toBe('place_county');
    expect(projection.currentSceneId).toBe('scene_market');
    expect(projection.displayPath).toBe('外域 - 边郡 - 县城 - 市集');
  });

  it('projects worldbook route seeds before any runtime route writeback exists', () => {
    const worldBookWithRouteSeed: WorldBook = {
      ...worldBook,
      routeSeed: [
        {
          routeId: 'route_seed_county_ferry',
          fromPlaceId: 'place_county',
          toPlaceId: 'place_ferry',
          name: '县城渡口官道',
          routeKind: '官道',
          status: '可通行',
          source: 'worldbook',
          knownLevel: '听闻',
          riskLevel: 20,
          notes: '世界书开局路线骨架，耗时待亲历后写回。',
        },
      ],
    };
    const state = {
      ...makeState(),
      routeEdges: [],
    };

    const projection = buildCurrentMapProjection(worldBookWithRouteSeed, state);

    expect(projection.nearbyRoutes).toEqual([
      expect.objectContaining({
        routeId: 'route_seed_county_ferry',
        routeKind: '官道',
        toPlaceId: 'place_ferry',
        travelTimeText: undefined,
      }),
    ]);
  });

  it('keeps map seed children when opening location seed uses the same root region', () => {
    const mixedWorldBook: WorldBook = {
      ...worldBook,
      mapSeed: [
        {
          id: 'region_shared',
          name: 'Shared Region',
          level: 'region',
          mapLayer: 'region',
          summary: 'Base map region.',
          connectedRegionIds: [],
          controlHint: 'base',
          tensionHint: 'base',
          subLocations: [
            {
              id: 'place_base',
              name: 'Base Place',
              level: 'place',
              mapLayer: 'place',
              summary: 'A concrete place from the base map seed.',
              connectedRegionIds: [],
              controlHint: 'base',
              tensionHint: 'base',
            },
          ],
        },
      ],
      openingLocationSeed: [
        {
          id: 'region_shared',
          name: 'Shared Region',
          level: 'region',
          mapLayer: 'region',
          summary: 'Opening region overlay.',
          connectedRegionIds: [],
          controlHint: 'opening',
          tensionHint: 'opening',
          subLocations: [
            {
              id: 'place_opening',
              name: 'Opening Place',
              level: 'place',
              mapLayer: 'place',
              summary: 'A concrete place from opening location seed.',
              connectedRegionIds: [],
              controlHint: 'opening',
              tensionHint: 'opening',
            },
          ],
        },
      ],
      routeSeed: [
        {
          routeId: 'route_base_opening',
          fromPlaceId: 'place_base',
          toPlaceId: 'place_opening',
          name: 'Base to opening road',
          status: 'open',
          source: 'worldbook',
          knownLevel: '听闻',
        },
      ],
    };
    const state: RuntimeState = {
      ...makeState(),
      currentLocationId: 'place_base',
      currentPlaceId: 'place_base',
      currentSceneId: undefined,
      routeEdges: [],
    };

    const projection = buildCurrentMapProjection(mixedWorldBook, state);

    expect(projection.currentPlace?.id).toBe('place_base');
    expect(projection.displayPath).toBe('Shared Region - Base Place');
    expect(projection.nearbyRoutes).toEqual([
      expect.objectContaining({
        routeId: 'route_base_opening',
        toPlaceId: 'place_opening',
      }),
    ]);
  });

  it('lets runtime route writebacks enrich a worldbook seed route with observed travel time', () => {
    const worldBookWithRouteSeed: WorldBook = {
      ...worldBook,
      routeSeed: [
        {
          routeId: 'route_seed_county_ferry',
          fromPlaceId: 'place_county',
          toPlaceId: 'place_ferry',
          name: '县城渡口官道',
          routeKind: '官道',
          status: '可通行',
          source: 'worldbook',
          knownLevel: '听闻',
        },
      ],
    };
    const state: RuntimeState = {
      ...makeState(),
      routeEdges: [
        {
          routeId: 'route_seed_county_ferry',
          fromPlaceId: 'place_county',
          toPlaceId: 'place_ferry',
          name: '县城渡口官道',
          routeKind: '官道',
          status: '雨后泥泞但可通行',
          source: 'llm',
          knownLevel: '亲历',
          standardTravelMinutes: 95,
          travelTimeText: '约一个半时辰',
        },
      ],
    };

    const projection = buildCurrentMapProjection(worldBookWithRouteSeed, state);

    expect(projection.nearbyRoutes).toEqual([
      expect.objectContaining({
        routeId: 'route_seed_county_ferry',
        status: '雨后泥泞但可通行',
        knownLevel: '亲历',
        standardTravelMinutes: 95,
        travelTimeText: '约一个半时辰',
      }),
    ]);
  });

  it('accepts permanent structured place and scene writebacks with explicit IDs', () => {
    let state = makeState();

    const placeResult = applyLocationWriteSuggestion(worldBook, state, {
      locationId: 'place_watch_post',
      name: '哨所',
      kind: 'outpost',
      mapLayer: 'place',
      parentId: 'region_commandery',
      summary: 'A newly confirmed outpost.',
      permanence: 'permanent',
    });
    state = placeResult.state;

    const sceneResult = applyLocationWriteSuggestion(worldBook, state, {
      locationId: 'scene_watch_yard',
      name: '哨所院内',
      kind: 'scene',
      mapLayer: 'scene',
      parentId: 'place_watch_post',
      summary: 'A scene inside the new outpost.',
      permanence: 'permanent',
    });

    const index = buildRuntimeMapIndex(worldBook, sceneResult.state);
    expect(placeResult.applied).toBe(true);
    expect(sceneResult.applied).toBe(true);
    expect(index.nodeById.place_watch_post?.mapLayer).toBe('place');
    expect(index.nodeById.scene_watch_yard?.mapLayer).toBe('scene');
    expect(index.parentIdByNodeId.scene_watch_yard).toBe('place_watch_post');
  });

  it('rejects route writebacks that do not connect concrete places', () => {
    const state = makeState();

    const valid = applyRouteWriteSuggestion(worldBook, state, {
      routeId: 'route_county_ferry_new',
      fromPlaceId: 'place_county',
      toPlaceId: 'place_ferry',
      name: '复核路线',
      status: '可通行',
      source: 'llm',
      knownLevel: '亲历',
      standardTravelMinutes: 80,
    });
    const invalid = applyRouteWriteSuggestion(worldBook, state, {
      routeId: 'route_bad_scene',
      fromPlaceId: 'scene_market',
      toPlaceId: 'place_ferry',
      name: '错误路线',
      status: '不可用',
      source: 'llm',
      knownLevel: '亲历',
    });

    expect(valid.applied).toBe(true);
    expect(valid.state.routeEdges?.some((route) => route.routeId === 'route_county_ferry_new')).toBe(true);
    expect(invalid.applied).toBe(false);
    expect(invalid.errors.join('\n')).toContain('具体地点');
  });
});
