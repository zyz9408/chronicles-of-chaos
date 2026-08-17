import { describe, expect, it } from 'vitest';

import {
  MAP_LOCAL_FOCUS_ZOOM,
  MAP_MAX_ZOOM,
  buildMapLabelLayout,
  buildMapViewportModel,
  getVisibleMapPoints,
  shouldShowMapPointLabel,
  stepMapZoom,
} from './mapViewportModel';
import type { MapVisualPoint } from './mapVisualModel';

const points: MapVisualPoint[] = [
  {
    id: 'place_sili_luoyang',
    name: '洛阳',
    level: '城邑',
    summary: '',
    mapLayer: 'place',
    x: 45,
    y: 41,
    isCurrent: false,
    anchored: true,
    geographicSkeleton: true,
    relevance: 'core',
    minTier: 'far',
    displayPath: '司隶 / 河南尹 / 洛阳',
    knownRoutes: [],
  },
  {
    id: 'region_jingzhou',
    name: '荆州',
    level: '州',
    summary: '',
    mapLayer: 'region',
    x: 47,
    y: 64,
    isCurrent: false,
    anchored: true,
    geographicSkeleton: false,
    relevance: 'known',
    minTier: 'far',
    displayPath: '荆州',
    knownRoutes: [],
  },
  {
    id: 'place_jingzhou_jiangling',
    name: '江陵城',
    level: '城邑',
    summary: '',
    mapLayer: 'place',
    x: 56,
    y: 63,
    isCurrent: false,
    anchored: true,
    geographicSkeleton: true,
    relevance: 'known',
    minTier: 'mid',
    displayPath: '荆州 / 南郡 / 江陵城',
    knownRoutes: [],
  },
  {
    id: 'place_sili_hulao_pass',
    name: '虎牢关',
    level: '关隘',
    summary: '',
    mapLayer: 'place',
    x: 50,
    y: 42,
    isCurrent: false,
    anchored: true,
    geographicSkeleton: true,
    relevance: 'known',
    minTier: 'far',
    displayPath: '司隶 / 河南尹 / 虎牢关',
    knownRoutes: [],
  },
  {
    id: 'place_sili_lantian',
    name: '蓝田县城',
    level: '县城',
    summary: '',
    mapLayer: 'place',
    x: 39,
    y: 45,
    isCurrent: false,
    anchored: true,
    geographicSkeleton: true,
    relevance: 'known',
    minTier: 'near',
    displayPath: '司隶 / 京兆尹 / 蓝田县城',
    knownRoutes: [],
  },
  {
    id: 'runtime_xinye_camp',
    name: '新野营地',
    level: '地点',
    summary: '',
    mapLayer: 'place',
    x: 52,
    y: 55,
    isCurrent: false,
    anchored: false,
    geographicSkeleton: false,
    relevance: 'dynamic',
    minTier: 'near',
    displayPath: '荆州 / 南阳郡 / 新野营地',
    knownRoutes: [],
  },
];
const runtimeCampPoint = points.find((point) => point.id === 'runtime_xinye_camp')!;

describe('mapViewportModel', () => {
  it('maps zoom values to far, mid, near and detail visual tiers', () => {
    expect(buildMapViewportModel({ zoom: 0.7 }).tier).toBe('far');
    expect(buildMapViewportModel({ zoom: 1.35 }).tier).toBe('mid');
    expect(buildMapViewportModel({ zoom: 2.4 }).tier).toBe('near');
    expect(buildMapViewportModel({ zoom: 4.8 }).tier).toBe('detail');
  });

  it('tiers both geographic markers and labels instead of drawing every static point nationally', () => {
    expect(getVisibleMapPoints(points, 0.85).map((point) => point.id)).toEqual([
      'place_sili_luoyang',
      'region_jingzhou',
      'place_sili_hulao_pass',
    ]);
    expect(getVisibleMapPoints(points, 1.4).map((point) => point.id)).toEqual([
      'place_sili_luoyang',
      'region_jingzhou',
      'place_jingzhou_jiangling',
      'place_sili_hulao_pass',
    ]);
    expect(getVisibleMapPoints(points, 2.2).map((point) => point.id)).toEqual([
      'place_sili_luoyang',
      'region_jingzhou',
      'place_jingzhou_jiangling',
      'place_sili_hulao_pass',
      'place_sili_lantian',
      'runtime_xinye_camp',
    ]);
  });

  it('can focus the viewport on the current map point', () => {
    const viewport = buildMapViewportModel({
      zoom: 1.6,
      focusPoint: {
        ...runtimeCampPoint,
        isCurrent: true,
        relevance: 'current',
        minTier: 'far',
      },
    });

    expect(viewport.panX).toBeCloseTo(-3.2, 1);
    expect(viewport.panY).toBeCloseTo(-8, 1);
    expect(viewport.transform).toContain('scale(1.6)');
  });

  it('allows deep local zoom and wider pan for detailed map inspection', () => {
    const viewport = buildMapViewportModel({
      zoom: 9.2,
      focusPoint: {
        ...runtimeCampPoint,
        x: 82,
        y: 76,
        isCurrent: true,
        relevance: 'current',
        minTier: 'far',
      },
    });

    expect(viewport.zoom).toBe(9.2);
    expect(viewport.tier).toBe('detail');
    expect(viewport.panX).toBeLessThan(-250);
    expect(viewport.panY).toBeLessThan(-200);
  });

  it('supports a 24x inspection ceiling and progressively larger detail steps', () => {
    expect(MAP_LOCAL_FOCUS_ZOOM).toBe(12);
    expect(MAP_MAX_ZOOM).toBe(24);
    expect(buildMapViewportModel({ zoom: 99 }).zoom).toBe(24);
    expect(stepMapZoom(0.9, 1)).toBe(1.35);
    expect(stepMapZoom(12, 1)).toBe(14.16);
    expect(stepMapZoom(24, 1)).toBe(24);
    expect(stepMapZoom(0.65, -1)).toBe(0.65);
  });

  it('shows state and core labels on the national view while keeping local labels tiered', () => {
    const currentPoint: MapVisualPoint = {
      ...runtimeCampPoint,
      isCurrent: true,
      relevance: 'current',
      minTier: 'far',
    };

    expect(shouldShowMapPointLabel(points[0], 0.85)).toBe(true);
    expect(shouldShowMapPointLabel(points[1], 0.85)).toBe(true);
    expect(shouldShowMapPointLabel(points[4], 0.85)).toBe(false);
    expect(shouldShowMapPointLabel(currentPoint, 0.85)).toBe(true);
    expect(shouldShowMapPointLabel(points[1], 0.85, true)).toBe(true);
  });

  it('shows static city and pass names after zooming into the geographic skeleton', () => {
    expect(shouldShowMapPointLabel(points[2], 2.2)).toBe(true);
    expect(shouldShowMapPointLabel(points[2], 2.2, false, {
      ...runtimeCampPoint,
      x: 55,
      y: 58,
    })).toBe(true);
    expect(shouldShowMapPointLabel(points[2], 2.2, false, {
      ...runtimeCampPoint,
      x: 80,
      y: 80,
    })).toBe(false);
  });

  it('hides nearby-route labels that would collide with the focused point in mid view', () => {
    const currentPoint: MapVisualPoint = {
      ...points[0],
      x: 53,
      y: 61,
      isCurrent: true,
      relevance: 'current',
      minTier: 'far',
    };
    const closeRoutePoint: MapVisualPoint = {
      ...runtimeCampPoint,
      id: 'place_jingzhou_xinye',
      name: '新野县城',
      x: 53.4,
      y: 58.8,
      relevance: 'nearbyRoute',
      minTier: 'mid',
    };
    const distantRoutePoint: MapVisualPoint = {
      ...runtimeCampPoint,
      id: 'place_yuzhou_xuchang',
      name: '许县',
      x: 64,
      y: 47,
      relevance: 'nearbyRoute',
      minTier: 'mid',
    };

    expect(shouldShowMapPointLabel(closeRoutePoint, 1.2, false, currentPoint)).toBe(false);
    expect(shouldShowMapPointLabel(distantRoutePoint, 1.2, false, currentPoint)).toBe(true);
  });

  it('does not show every label in deep zoom when labels would crowd the focused place', () => {
    const currentPoint: MapVisualPoint = {
      ...runtimeCampPoint,
      isCurrent: true,
      relevance: 'current',
      minTier: 'far',
    };
    const closeRoutePoint: MapVisualPoint = {
      ...runtimeCampPoint,
      id: 'place_jingzhou_xinye',
      name: '新野县城',
      x: 53.1,
      y: 55.4,
      relevance: 'nearbyRoute',
      minTier: 'mid',
    };
    const usefulRoutePoint: MapVisualPoint = {
      ...runtimeCampPoint,
      id: 'place_jingzhou_jiangling',
      name: '江陵城',
      x: 58.5,
      y: 61.5,
      relevance: 'nearbyRoute',
      minTier: 'mid',
    };
    const farCorePoint: MapVisualPoint = {
      ...points[0],
      x: 28,
      y: 38,
    };

    expect(shouldShowMapPointLabel(currentPoint, 5.2, false, currentPoint)).toBe(true);
    expect(shouldShowMapPointLabel(closeRoutePoint, 5.2, false, currentPoint)).toBe(false);
    expect(shouldShowMapPointLabel(usefulRoutePoint, 5.2, false, currentPoint)).toBe(true);
    expect(shouldShowMapPointLabel(farCorePoint, 5.2, false, currentPoint)).toBe(false);
  });

  it('resolves labels globally by current, route target, story focus and ordinary priority', () => {
    const currentPoint: MapVisualPoint = {
      ...runtimeCampPoint,
      id: 'current_camp',
      name: '当前营地',
      x: 50,
      y: 50,
      isCurrent: true,
      relevance: 'current',
      minTier: 'far',
    };
    const routeTarget: MapVisualPoint = {
      ...runtimeCampPoint,
      id: 'route_target',
      name: '路线目标',
      x: 54,
      y: 50,
      relevance: 'nearbyRoute',
      minTier: 'far',
    };
    const storyFocus: MapVisualPoint = {
      ...runtimeCampPoint,
      id: 'story_focus',
      name: '剧情地点',
      x: 70,
      y: 50,
      relevance: 'dynamic',
      minTier: 'near',
    };
    const ordinaryPoint: MapVisualPoint = {
      ...points[4],
      id: 'ordinary_place',
      name: '普通地点',
      x: 73,
      y: 50,
      relevance: 'known',
      minTier: 'near',
    };

    const layout = buildMapLabelLayout({
      points: [ordinaryPoint, storyFocus, routeTarget, currentPoint],
      zoom: 2.2,
      focusPoint: currentPoint,
      viewportWidth: 720,
      viewportHeight: 420,
    });

    expect(layout.visibleLabelIds.has(currentPoint.id)).toBe(true);
    expect(layout.visibleLabelIds.has(routeTarget.id)).toBe(false);
    expect(layout.visibleLabelIds.has(storyFocus.id)).toBe(true);
    expect(layout.visibleLabelIds.has(ordinaryPoint.id)).toBe(false);
    expect(layout.clustersByAnchorId.get(currentPoint.id)?.hiddenPointIds).toContain(routeTarget.id);
    expect(layout.clustersByAnchorId.get(storyFocus.id)?.hiddenPointIds).toContain(ordinaryPoint.id);
  });

  it('keeps nearby-route targets visible nationally even when their normal tier is local', () => {
    const routeTarget: MapVisualPoint = {
      ...runtimeCampPoint,
      relevance: 'nearbyRoute',
      minTier: 'near',
    };

    expect(getVisibleMapPoints([routeTarget], 0.9)).toEqual([routeTarget]);
  });

  it('uses a denser collision budget on desktop than on a narrow mobile map', () => {
    const spread = [0, 1, 2, 3].map((offset) => ({
      ...points[0],
      id: `city_${offset}`,
      name: `城邑${offset}`,
      x: 42 + (offset * 5),
      y: 45,
    }));

    const desktop = buildMapLabelLayout({
      points: spread,
      zoom: 0.9,
      viewportWidth: 1100,
      viewportHeight: 540,
    });
    const mobile = buildMapLabelLayout({
      points: spread,
      zoom: 0.9,
      viewportWidth: 340,
      viewportHeight: 320,
    });

    expect(desktop.visibleLabelIds.size).toBeGreaterThan(mobile.visibleLabelIds.size);
    expect([...mobile.clustersByAnchorId.values()].some((cluster) => cluster.count > 0)).toBe(true);
  });

  it('dissolves nearby label clusters when the player reaches deep local zoom', () => {
    const currentPoint: MapVisualPoint = {
      ...runtimeCampPoint,
      id: 'current_local_point',
      name: '汉水大营',
      x: 50,
      y: 50,
      isCurrent: true,
      relevance: 'current',
    };
    const nearbyPoint: MapVisualPoint = {
      ...runtimeCampPoint,
      id: 'nearby_local_point',
      name: '北岸渡口',
      x: 50.65,
      y: 50,
      relevance: 'nearbyRoute',
    };

    const formerCeiling = buildMapLabelLayout({
      points: [currentPoint, nearbyPoint],
      zoom: 9.5,
      viewportWidth: 840,
      viewportHeight: 528,
    });
    const deepZoom = buildMapLabelLayout({
      points: [currentPoint, nearbyPoint],
      zoom: 24,
      viewportWidth: 840,
      viewportHeight: 528,
    });

    expect(formerCeiling.clustersByAnchorId.get(currentPoint.id)?.hiddenPointIds).toContain(nearbyPoint.id);
    expect(deepZoom.visibleLabelIds).toEqual(new Set([currentPoint.id, nearbyPoint.id]));
    expect(deepZoom.clustersByAnchorId.size).toBe(0);
  });
});
