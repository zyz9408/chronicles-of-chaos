import { describe, expect, it } from 'vitest';

import type { RuntimeState, WorldBook } from '../engine/types';
import { buildRuntimeMapIndex } from '../engine/map/runtimeMap';
import { worldBook_ThreeKingdoms } from '../worldbooks/threeKingdoms';
import { buildMapVisualModel } from './mapVisualModel';

const worldBook: WorldBook = {
  manifest: {
    id: 'test-three-kingdoms',
    name: '三国测试世界',
    version: '0.1.0',
    author: 'test',
    language: 'zh',
    genre: 'historical',
    source: 'official',
    compatibleEngineVersion: '0.1.0',
  },
  ontology: {
    regionLevels: ['州', '郡', '县', '城邑', '场景'],
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
      id: 'region_sili',
      name: '司隶',
      level: '州',
      mapLayer: 'region',
      summary: '京畿。',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
      subLocations: [
        {
          id: 'place_sili_luoyang',
          name: '洛阳城',
          level: '城邑',
          mapLayer: 'place',
          summary: '天下旧都。',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
          parentId: 'region_sili',
        },
        {
          id: 'loc_sili_henan',
          name: '河南尹',
          level: '尹',
          mapLayer: 'region',
          summary: '京畿核心区域。',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
          parentId: 'region_sili',
          subLocations: [
            {
              id: 'place_sili_hulao_pass',
              name: '虎牢关',
              level: '关隘',
              mapLayer: 'place',
              summary: '洛阳东面的险关。',
              connectedRegionIds: [],
              controlHint: '',
              tensionHint: '',
              parentId: 'loc_sili_henan',
            },
            {
              id: 'place_sili_luoyang_inn',
              name: '洛阳客舍',
              level: '客舍',
              mapLayer: 'place',
              summary: '商旅落脚处。',
              connectedRegionIds: [],
              controlHint: '',
              tensionHint: '',
              parentId: 'loc_sili_henan',
            },
          ],
        },
      ],
    },
    {
      id: 'region_jingzhou',
      name: '荆州',
      level: '州',
      mapLayer: 'region',
      summary: '荆楚要地。',
      connectedRegionIds: [],
      controlHint: '刘表治下',
      tensionHint: '',
      subLocations: [
        {
          id: 'place_jingzhou_xiangyang',
          name: '襄阳城',
          level: '城邑',
          mapLayer: 'place',
          summary: '荆州重镇。',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
          parentId: 'region_jingzhou',
          subLocations: [
            {
              id: 'scene_xiangyang_office',
              name: '官署',
              level: '场景',
              mapLayer: 'scene',
              summary: '政务所在。',
              connectedRegionIds: [],
              controlHint: '',
              tensionHint: '',
              parentId: 'place_jingzhou_xiangyang',
            },
          ],
        },
        {
          id: 'place_jingzhou_xinye',
          name: '新野县城',
          level: '城邑',
          mapLayer: 'place',
          summary: '汉水北岸小县。',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
          parentId: 'region_jingzhou',
        },
      ],
    },
    {
      id: 'region_yizhou',
      name: '益州',
      level: '州',
      mapLayer: 'region',
      summary: '西南重州。',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
      subLocations: [
        {
          id: 'place_yizhou_chengdu',
          name: '成都城',
          level: '城邑',
          mapLayer: 'place',
          summary: '益州治所。',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
          parentId: 'region_yizhou',
        },
      ],
    },
  ],
  routeSeed: [
    {
      routeId: 'route_xiangyang_xinye',
      fromPlaceId: 'place_jingzhou_xiangyang',
      toPlaceId: 'place_jingzhou_xinye',
      name: '襄阳至新野官道',
      routeKind: '官道',
      status: '可通行',
      source: 'worldbook',
      knownLevel: '亲历',
      riskLevel: 35,
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
  worldBookId: 'test-three-kingdoms',
  worldBookVersion: '0.1.0',
  worldBookSource: 'official',
  startDate: '公元194年04月01日 08:00（辰时）',
  currentDate: '公元194年04月01日 08:00（辰时）',
  player: {
    id: 'player',
    name: '刘时',
    roleType: '将领',
    summary: '',
  },
  currentLocationId: 'scene_xiangyang_office',
  currentPlaceId: 'place_jingzhou_xiangyang',
  currentSceneId: 'scene_xiangyang_office',
  knownActors: [],
  knownFactions: [],
  relationships: [],
  knownRumors: [],
  activeQuests: [],
  playerResources: {},
  worldStateDelta: {},
  turnLog: [],
  localSituationNotes: [],
};

describe('buildMapVisualModel', () => {
  it('marks current place and route targets on the visual map', () => {
    const model = buildMapVisualModel(worldBook, baseState);

    expect(model.currentPoint?.id).toBe('place_jingzhou_xiangyang');
    expect(model.currentPoint?.relevance).toBe('current');
    expect(model.currentPoint?.minTier).toBe('far');
    expect(model.points.map((point) => point.id)).toContain('place_jingzhou_xinye');
    expect(model.points.find((point) => point.id === 'place_jingzhou_xinye')).toMatchObject({
      relevance: 'nearbyRoute',
      minTier: 'mid',
    });
    expect(model.routes).toEqual([
      expect.objectContaining({
        routeId: 'route_xiangyang_xinye',
        fromPlaceId: 'place_jingzhou_xiangyang',
        toPlaceId: 'place_jingzhou_xinye',
      }),
    ]);
  });

  it('does not render internal scenes as strategic map points', () => {
    const model = buildMapVisualModel(worldBook, baseState);

    expect(model.points.some((point) => point.id === 'scene_xiangyang_office')).toBe(false);
  });

  it('keeps national core anchors available while still filtering by visual tier', () => {
    const model = buildMapVisualModel(worldBook, baseState);

    expect(model.points.map((point) => point.id)).toEqual(expect.arrayContaining([
      'place_jingzhou_xiangyang',
      'place_jingzhou_xinye',
      'place_sili_luoyang',
      'place_yizhou_chengdu',
      'region_jingzhou',
      'region_sili',
      'region_yizhou',
    ]));
    expect(model.points.find((point) => point.id === 'place_sili_luoyang')).toMatchObject({
      relevance: 'core',
      minTier: 'far',
    });
    expect(model.points.find((point) => point.id === 'region_sili')).toMatchObject({
      relevance: 'known',
      minTier: 'far',
    });
    expect(model.points.find((point) => point.id === 'region_yizhou')).toMatchObject({
      relevance: 'known',
      minTier: 'far',
    });
    expect(model.points.find((point) => point.id === 'region_jingzhou')).toMatchObject({
      relevance: 'known',
      minTier: 'far',
    });
  });

  it('projects static cities and passes through their nearest anchored region', () => {
    const model = buildMapVisualModel(worldBook, baseState);
    const hulao = model.points.find((point) => point.id === 'place_sili_hulao_pass');

    expect(hulao).toMatchObject({
      name: '虎牢关',
      level: '关隘',
      mapLayer: 'place',
      geographicSkeleton: true,
      minTier: 'mid',
      anchorId: 'region_sili',
    });
    expect(hulao?.x).toEqual(expect.any(Number));
    expect(hulao?.y).toEqual(expect.any(Number));
    expect(model.points.some((point) => point.id === 'place_sili_luoyang_inn')).toBe(false);
  });

  it('includes every static city, pass and major crossing from the Three Kingdoms map index', () => {
    const state: RuntimeState = {
      ...baseState,
      worldBookId: worldBook_ThreeKingdoms.manifest.id,
      worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
      currentLocationId: 'place_nanyang_xinye',
      currentPlaceId: 'place_nanyang_xinye',
      currentSceneId: undefined,
    };
    const geographicLevels = new Set(['城邑', '县城', '关隘', '谷口', '道口', '亭障', '港口', '渡口']);
    const expectedIds = buildRuntimeMapIndex(worldBook_ThreeKingdoms, state).places
      .filter((place) => geographicLevels.has(place.level))
      .map((place) => place.id);
    const actualIds = new Set(buildMapVisualModel(worldBook_ThreeKingdoms, state).points.map((point) => point.id));

    expect(expectedIds.length).toBeGreaterThan(80);
    expect(expectedIds.filter((id) => !actualIds.has(id))).toEqual([]);
  });

  it('assigns static geography to national, regional and local display tiers', () => {
    const state: RuntimeState = {
      ...baseState,
      worldBookId: worldBook_ThreeKingdoms.manifest.id,
      worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
      currentLocationId: 'place_nanyang_xinye',
      currentPlaceId: 'place_nanyang_xinye',
      currentSceneId: undefined,
    };
    const pointsById = new Map(
      buildMapVisualModel(worldBook_ThreeKingdoms, state).points.map((point) => [point.id, point]),
    );

    expect(pointsById.get('place_sili_hulao_pass')?.minTier).toBe('mid');
    expect(pointsById.get('place_yanzhou_puyang')?.minTier).toBe('mid');
    expect(pointsById.get('loc_yangzhou_jiujiang_seat')?.minTier).toBe('mid');
    expect(pointsById.get('place_sili_lantian')?.minTier).toBe('near');
    expect(pointsById.get('place_sili_dagu_pass')?.minTier).toBe('near');
  });

  it('builds hover geography without leaking unknown strategic control', () => {
    const model = buildMapVisualModel(worldBook, baseState);
    const hulao = model.points.find((point) => point.id === 'place_sili_hulao_pass');
    const xiangyang = model.points.find((point) => point.id === 'place_jingzhou_xiangyang');
    const xinye = model.points.find((point) => point.id === 'place_jingzhou_xinye');

    expect(hulao).toMatchObject({
      displayPath: '司隶 - 河南尹 - 虎牢关',
      knownControl: undefined,
      knownRoutes: [],
    });
    expect(xiangyang).toMatchObject({
      displayPath: '荆州 - 襄阳城',
      knownControl: '刘表治下',
      knownRoutes: [
        expect.objectContaining({
          name: '襄阳至新野官道',
          toPlaceName: '新野县城',
          knownLevel: '亲历',
        }),
      ],
    });
    expect(xinye?.knownControl).toBe('刘表治下');
  });

  it('keeps unanchored dynamic places in an archive list instead of guessing their map position', () => {
    const model = buildMapVisualModel(worldBook, {
      ...baseState,
      mapNodes: [
        {
          id: 'runtime_unknown_pass',
          name: '无名山口',
          level: '地点',
          mapLayer: 'place',
          summary: '尚未归入地图骨架。',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
        },
      ],
    });

    expect(model.unlocatedPlaces).toEqual([
      expect.objectContaining({
        id: 'runtime_unknown_pass',
        name: '无名山口',
      }),
    ]);
  });
});
