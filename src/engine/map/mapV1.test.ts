import { describe, expect, it } from 'vitest';
import type { MapNode, MapRouteEdgeV1 } from '../types';
import {
  buildMapV1Index,
  buildPlaceDisplayPath,
  isStandableMapNode,
  validateMapRouteEdge,
} from './mapV1';

const mapSeed: MapNode[] = [
  {
    id: 'region_east',
    name: '东境',
    level: '路',
    mapLayer: 'region',
    summary: '上层区域容器。',
    connectedRegionIds: [],
    controlHint: '多方争夺',
    tensionHint: '不安',
    subLocations: [
      {
        id: 'region_qinghe',
        name: '清河府',
        level: '府',
        mapLayer: 'region',
        summary: '次级区域容器。',
        connectedRegionIds: [],
        controlHint: '地方官府',
        tensionHint: '戒备',
        subLocations: [
          {
            id: 'place_qinghe_county',
            name: '清河县城',
            level: '县城',
            mapLayer: 'place',
            summary: '玩家可以实际抵达和停留的具体地点。',
            connectedRegionIds: [],
            controlHint: '地方官府',
            tensionHint: '城门戒严',
            subLocations: [
              {
                id: 'scene_market',
                name: '市集',
                level: '场景',
                mapLayer: 'scene',
                summary: '县城内的场景，不作为路线端点。',
                connectedRegionIds: [],
                controlHint: '商贩与行人',
                tensionHint: '流言很多',
              },
            ],
          },
          {
            id: 'place_river_ferry',
            name: '清河渡口',
            level: '渡口',
            mapLayer: 'place',
            summary: '河边渡口，是路线节点。',
            connectedRegionIds: [],
            controlHint: '船户',
            tensionHint: '可通行',
          },
        ],
      },
    ],
  },
];

describe('Map V1 architecture helpers', () => {
  it('indexes regions, places, and scenes without era-specific assumptions', () => {
    const index = buildMapV1Index(mapSeed);

    expect(index.regions.map((node) => node.id)).toEqual(['region_east', 'region_qinghe']);
    expect(index.places.map((node) => node.id)).toEqual(['place_qinghe_county', 'place_river_ferry']);
    expect(index.scenes.map((node) => node.id)).toEqual(['scene_market']);
    expect(isStandableMapNode(index.nodeById.region_east)).toBe(false);
    expect(isStandableMapNode(index.nodeById.place_qinghe_county)).toBe(true);
    expect(isStandableMapNode(index.nodeById.scene_market)).toBe(false);
    expect(buildPlaceDisplayPath(index, 'place_qinghe_county', 'scene_market')).toBe('东境 - 清河府 - 清河县城 - 市集');
  });

  it('allows routes only between concrete places, not regions or scenes', () => {
    const index = buildMapV1Index(mapSeed);
    const validRoute: MapRouteEdgeV1 = {
      routeId: 'route_county_ferry',
      fromPlaceId: 'place_qinghe_county',
      toPlaceId: 'place_river_ferry',
      name: '清河官道',
      status: '可通行',
      source: 'worldbook',
      knownLevel: '亲历',
    };
    const regionRoute: MapRouteEdgeV1 = {
      ...validRoute,
      routeId: 'route_bad_region',
      fromPlaceId: 'region_qinghe',
    };
    const sceneRoute: MapRouteEdgeV1 = {
      ...validRoute,
      routeId: 'route_bad_scene',
      toPlaceId: 'scene_market',
    };

    expect(validateMapRouteEdge(index, validRoute)).toEqual({ valid: true, errors: [] });
    expect(validateMapRouteEdge(index, regionRoute).errors[0]).toContain('具体地点');
    expect(validateMapRouteEdge(index, sceneRoute).errors[0]).toContain('具体地点');
  });
});
