import type { MapNode, RuntimeState, WorldBook } from '../engine/types';
import {
  buildCurrentMapProjection,
  buildRuntimeMapIndex,
  buildRuntimeRouteEdges,
} from '../engine/map/runtimeMap';
import { buildPlaceDisplayPath, isStandableMapNode } from '../engine/map/mapV1';
import { hasMapVisualAnchor, resolveMapVisualPoint, type MapVisualPointLocation } from './mapVisualAnchors';

export type MapVisualRelevance = 'current' | 'nearbyRoute' | 'core' | 'known' | 'dynamic';
export type MapVisualTier = 'far' | 'mid' | 'near' | 'detail';

export interface MapVisualPoint {
  id: string;
  name: string;
  level: string;
  summary: string;
  mapLayer: 'region' | 'place';
  x: number;
  y: number;
  isCurrent: boolean;
  anchored: boolean;
  geographicSkeleton: boolean;
  relevance: MapVisualRelevance;
  minTier: MapVisualTier;
  displayPath: string;
  knownControl?: string;
  knownRoutes: MapVisualPointRoute[];
  anchorId?: string;
}

export interface MapVisualPointRoute {
  routeId: string;
  name: string;
  toPlaceId: string;
  toPlaceName: string;
  knownLevel: string;
  routeKind?: string;
  status: string;
}

export interface MapVisualRoute {
  routeId: string;
  name: string;
  fromPlaceId: string;
  toPlaceId: string;
  from: MapVisualPoint;
  to: MapVisualPoint;
  routeKind?: string;
  status: string;
  knownLevel: string;
  riskLevel?: number;
}

export interface MapVisualArchivePoint {
  id: string;
  name: string;
  level: string;
  summary: string;
  parentId?: string;
}

export interface MapVisualModel {
  points: MapVisualPoint[];
  routes: MapVisualRoute[];
  currentPoint?: MapVisualPoint;
  unlocatedPlaces: MapVisualArchivePoint[];
}

const CORE_NATIONAL_PLACE_IDS = [
  'place_sili_luoyang',
  'place_sili_changan',
  'place_yuzhou_xuchang',
  'place_yingchuan_xuxian',
  'place_jizhou_yecheng',
  'place_jizhou_ye',
  'place_yangzhou_jianye',
  'place_yizhou_chengdu',
  'place_jingzhou_xiangyang',
  'place_yizhou_hanzhong',
  'place_yizhou_nanzheng',
  'place_nanyang_wan',
  'place_jingzhou_wan',
  'place_jingzhou_jiangling',
  'place_yangzhou_shouchun',
  'place_xuzhou_xiapi',
  'place_xuzhou_xiapi_city',
] as const;

const NATIONAL_IMPORTANT_PASS_IDS = new Set([
  'place_sili_hangu_pass',
  'place_sili_hulao_pass',
  'place_sili_sanguan_pass',
  'place_yizhou_yangping_pass',
  'place_yizhou_jiange_pass',
  'place_bingzhou_yanmen_pass',
]);

const REGIONAL_MAJOR_PASS_IDS = new Set([
  'place_sili_yique_pass',
  'place_sili_guangcheng_pass',
  'place_sili_huanyuan_pass',
  'place_yizhou_baoxie_road',
  'place_yanzhou_mountain_pass',
  'place_youzhou_fort',
]);

const GEOGRAPHIC_SKELETON_LEVELS = new Set([
  '城邑',
  '县城',
  '关隘',
  '谷口',
  '道口',
  '亭障',
  '港口',
  '渡口',
]);

export function buildMapVisualModel(worldBook: WorldBook, state: RuntimeState): MapVisualModel {
  const index = buildRuntimeMapIndex(worldBook, state);
  const projection = buildCurrentMapProjection(worldBook, state, {
    sceneLimit: 0,
    routeLimit: 12,
    locationMemoryLimit: 0,
  });
  const currentPlaceId = projection.currentPlaceId || state.currentPlaceId || state.currentLocationId;
  const dynamicNodeIds = new Set((state.mapNodes ?? []).map((node) => node.id));
  const nearbyRouteTargetIds = new Set<string>();
  for (const route of projection.nearbyRoutes) {
    nearbyRouteTargetIds.add(route.toPlaceId);
  }
  const candidatePointIds = buildCandidatePointIds({
    currentPlaceId,
    nearbyRouteTargetIds,
    dynamicNodeIds,
    index,
  });
  const pointById = new Map<string, MapVisualPoint>();
  const unlocatedPlaces: MapVisualArchivePoint[] = [];

  for (const node of [...index.regions, ...index.places]) {
    if (!candidatePointIds.has(node.id)) {
      continue;
    }

    const geographicSkeleton = isGeographicSkeletonPlace(node);
    const location = resolveNodeLocation(node, index, {
      allowRegionalFallback: node.id === currentPlaceId
        || nearbyRouteTargetIds.has(node.id)
        || dynamicNodeIds.has(node.id),
    });
    if (!location) {
      if (dynamicNodeIds.has(node.id) && isStandableMapNode(node)) {
        unlocatedPlaces.push(toArchivePoint(node, index.parentIdByNodeId[node.id]));
      }
      continue;
    }

    const revealStrategicInfo = node.id === currentPlaceId
      || nearbyRouteTargetIds.has(node.id)
      || dynamicNodeIds.has(node.id);
    const point: MapVisualPoint = {
      id: node.id,
      name: node.name,
      level: node.level,
      summary: node.summary,
      mapLayer: node.mapLayer === 'region' ? 'region' : 'place',
      x: location.x,
      y: location.y,
      isCurrent: node.id === currentPlaceId,
      anchored: location.anchored,
      geographicSkeleton,
      relevance: getPointRelevance(node.id, currentPlaceId, nearbyRouteTargetIds, dynamicNodeIds),
      minTier: getPointMinTier(node, currentPlaceId, dynamicNodeIds, index),
      displayPath: isStandableMapNode(node) ? buildPlaceDisplayPath(index, node.id) : node.name,
      knownControl: revealStrategicInfo ? findNearestControlHint(node.id, index) : undefined,
      knownRoutes: [],
      anchorId: location.anchorId,
    };
    pointById.set(point.id, point);
  }

  const routes: MapVisualRoute[] = [];
  for (const route of buildRuntimeRouteEdges(worldBook, state)) {
    const from = pointById.get(route.fromPlaceId);
    const to = pointById.get(route.toPlaceId);
    if (!from || !to) continue;
    routes.push({
      routeId: route.routeId,
      name: route.name,
      fromPlaceId: route.fromPlaceId,
      toPlaceId: route.toPlaceId,
      from,
      to,
      routeKind: route.routeKind,
      status: route.status,
      knownLevel: route.knownLevel,
      riskLevel: route.riskLevel,
    });
    from.knownRoutes.push({
      routeId: route.routeId,
      name: route.name,
      toPlaceId: to.id,
      toPlaceName: to.name,
      knownLevel: route.knownLevel,
      routeKind: route.routeKind,
      status: route.status,
    });
    to.knownRoutes.push({
      routeId: route.routeId,
      name: route.name,
      toPlaceId: from.id,
      toPlaceName: from.name,
      knownLevel: route.knownLevel,
      routeKind: route.routeKind,
      status: route.status,
    });
  }

  const currentPoint = currentPlaceId ? pointById.get(currentPlaceId) : undefined;

  return {
    points: sortVisualPoints([...pointById.values()]),
    routes,
    currentPoint,
    unlocatedPlaces,
  };
}

function resolveNodeLocation(
  node: MapNode,
  index: ReturnType<typeof buildRuntimeMapIndex>,
  options: { allowRegionalFallback: boolean },
): MapVisualPointLocation | null {
  if (node.mapLayer !== 'region' && node.mapLayer !== 'place') return null;
  const directOrImmediate = resolveMapVisualPoint({
    id: node.id,
    parentId: node.parentId ?? index.parentIdByNodeId[node.id],
    mapLayer: node.mapLayer,
  });
  if (directOrImmediate) return directOrImmediate;

  const nearestAnchorId = findNearestAnchoredAncestorId(node.id, index);
  if (!nearestAnchorId || !options.allowRegionalFallback) return null;
  return resolveMapVisualPoint({
    id: node.id,
    parentId: nearestAnchorId,
    mapLayer: node.mapLayer,
    fallbackScope: 'regional',
  });
}

function toArchivePoint(node: MapNode, parentId?: string): MapVisualArchivePoint {
  return {
    id: node.id,
    name: node.name,
    level: node.level,
    summary: node.summary,
    parentId: node.parentId ?? parentId,
  };
}

interface CandidateInput {
  currentPlaceId?: string;
  nearbyRouteTargetIds: Set<string>;
  dynamicNodeIds: Set<string>;
  index: ReturnType<typeof buildRuntimeMapIndex>;
}

function buildCandidatePointIds(input: CandidateInput): Set<string> {
  const ids = new Set<string>();
  if (input.currentPlaceId) {
    ids.add(input.currentPlaceId);
    const currentRegionId = findAncestorRegionId(input.currentPlaceId, input.index);
    if (currentRegionId) ids.add(currentRegionId);
  }

  for (const targetId of input.nearbyRouteTargetIds) {
    ids.add(targetId);
    const targetRegionId = findAncestorRegionId(targetId, input.index);
    if (targetRegionId) ids.add(targetRegionId);
  }

  for (const id of CORE_NATIONAL_PLACE_IDS) {
    if (input.index.nodeById[id] && hasMapVisualAnchor(id)) ids.add(id);
  }

  for (const node of input.index.regions) {
    if (hasMapVisualAnchor(node.id)) ids.add(node.id);
  }

  for (const node of input.index.places) {
    if (hasMapVisualAnchor(node.id) || isGeographicSkeletonPlace(node)) ids.add(node.id);
  }

  for (const id of input.dynamicNodeIds) {
    ids.add(id);
  }

  return ids;
}

function findNearestAnchoredAncestorId(
  nodeId: string,
  index: ReturnType<typeof buildRuntimeMapIndex>,
): string | undefined {
  let currentId = index.parentIdByNodeId[nodeId] ?? index.nodeById[nodeId]?.parentId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    if (hasMapVisualAnchor(currentId)) return currentId;
    const current = index.nodeById[currentId];
    currentId = index.parentIdByNodeId[currentId] ?? current?.parentId;
  }
  return undefined;
}

function isGeographicSkeletonPlace(node: MapNode): boolean {
  return node.mapLayer === 'place' && GEOGRAPHIC_SKELETON_LEVELS.has(node.level);
}

function findAncestorRegionId(nodeId: string, index: ReturnType<typeof buildRuntimeMapIndex>): string | undefined {
  let currentId: string | undefined = nodeId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node: MapNode | undefined = index.nodeById[currentId];
    if (node?.mapLayer === 'region') return node.id;
    currentId = index.parentIdByNodeId[currentId] ?? node?.parentId;
  }
  return undefined;
}

function getPointRelevance(
  id: string,
  currentPlaceId: string | undefined,
  nearbyRouteTargetIds: Set<string>,
  dynamicNodeIds: Set<string>,
): MapVisualRelevance {
  if (id === currentPlaceId) return 'current';
  if (nearbyRouteTargetIds.has(id)) return 'nearbyRoute';
  if (dynamicNodeIds.has(id)) return 'dynamic';
  if ((CORE_NATIONAL_PLACE_IDS as readonly string[]).includes(id)) return 'core';
  return 'known';
}

function getPointMinTier(
  node: MapNode,
  currentPlaceId: string | undefined,
  dynamicNodeIds: Set<string>,
  index: ReturnType<typeof buildRuntimeMapIndex>,
): MapVisualTier {
  if (node.id === currentPlaceId) return 'far';
  if ((CORE_NATIONAL_PLACE_IDS as readonly string[]).includes(node.id)) return 'far';
  if (NATIONAL_IMPORTANT_PASS_IDS.has(node.id)) return 'mid';
  if (node.mapLayer === 'region') {
    return index.parentIdByNodeId[node.id] || node.parentId ? 'mid' : 'far';
  }
  if (isCommanderySeat(node) || node.level === '城邑') return 'mid';
  if (REGIONAL_MAJOR_PASS_IDS.has(node.id)) return 'mid';
  if (dynamicNodeIds.has(node.id)) return 'near';
  return 'near';
}

function isCommanderySeat(node: MapNode): boolean {
  return node.id.endsWith('_seat') || /(?:郡|国|尹|属国)治/.test(node.summary);
}

function findNearestControlHint(
  nodeId: string,
  index: ReturnType<typeof buildRuntimeMapIndex>,
): string | undefined {
  let currentId: string | undefined = nodeId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node: MapNode | undefined = index.nodeById[currentId];
    const controlHint = node?.controlHint?.trim();
    if (controlHint) return controlHint;
    currentId = index.parentIdByNodeId[currentId] ?? node?.parentId;
  }
  return undefined;
}

function sortVisualPoints(points: MapVisualPoint[]): MapVisualPoint[] {
  const relevanceRank: Record<MapVisualRelevance, number> = {
    current: 0,
    nearbyRoute: 1,
    core: 2,
    known: 3,
    dynamic: 4,
  };
  return points.sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
    if (left.relevance !== right.relevance) return relevanceRank[left.relevance] - relevanceRank[right.relevance];
    if (left.mapLayer !== right.mapLayer) return left.mapLayer === 'place' ? -1 : 1;
    return left.name.localeCompare(right.name, 'zh-Hans-CN');
  });
}
