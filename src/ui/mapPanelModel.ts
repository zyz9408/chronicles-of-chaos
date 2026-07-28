import type { LocationMemorySummary, MapNode, RuntimeState, WorldBook } from '../engine/types';
import { buildPlaceDisplayPath, isStandableMapNode, type MapV1Index } from '../engine/map/mapV1';
import { buildCurrentMapProjection, buildRuntimeMapIndex, buildRuntimeRouteEdges } from '../engine/map/runtimeMap';

export interface MapPanelNodeSummary {
  id: string;
  name: string;
  level: string;
  summary: string;
}

export interface MapPanelRouteSummary {
  routeId: string;
  name: string;
  routeKind?: string;
  status: string;
  knownLevel: string;
  toPlaceId: string;
  toPlaceName: string;
  toPath: string;
  sourceKind: 'mapV1' | 'legacyLedger';
  isCurrentPlaceRelated: boolean;
  toPlaceSummary?: string;
  onwardRoutes: MapPanelOnwardRouteSummary[];
  riskLevel?: number;
  standardTravelMinutes?: number;
  travelTimeText?: string;
  notes?: string;
}

export interface MapPanelOnwardRouteSummary {
  routeId: string;
  toPlaceId: string;
  toPlaceName: string;
  routeKind?: string;
  status: string;
  travelTimeText?: string;
  standardTravelMinutes?: number;
}

export interface MapPanelCounts {
  regions: number;
  places: number;
  scenes: number;
  routes: number;
  legacyRoutes: number;
  dynamicPlaces: number;
  dynamicScenes: number;
}

export interface MapPanelModel {
  displayPath: string;
  currentPlaceName: string;
  currentPlaceLevel: string;
  currentPlaceSummary: string;
  currentSceneName?: string;
  currentSceneLevel?: string;
  currentSceneSummary?: string;
  scenes: MapPanelNodeSummary[];
  nearbyRoutes: MapPanelRouteSummary[];
  legacyRoutes: MapPanelRouteSummary[];
  locationMemorySummaries: LocationMemorySummary[];
  counts: MapPanelCounts;
}

export function buildMapPanelModel(worldBook: WorldBook, state: RuntimeState): MapPanelModel {
  const projection = buildCurrentMapProjection(worldBook, state, {
    sceneLimit: 24,
    routeLimit: 24,
  });
  const index = buildRuntimeMapIndex(worldBook, state);
  const allMapRoutes = buildRuntimeRouteEdges(worldBook, state);
  const dynamicCounts = countDynamicNodes(state.mapNodes ?? []);
  const fallbackPlaceId = projection.currentPlaceId || state.currentPlaceId || state.currentLocationId;
  const mapRoutes = projection.nearbyRoutes.map((route) => {
    const toNode = index.nodeById[route.toPlaceId];

    return {
      routeId: route.routeId,
      name: route.name,
      routeKind: route.routeKind,
      status: route.status,
      knownLevel: route.knownLevel,
      toPlaceId: route.toPlaceId,
      toPlaceName: route.toPlaceName,
      toPath: route.toPath,
      sourceKind: 'mapV1' as const,
      isCurrentPlaceRelated: true,
      toPlaceSummary: isStandableMapNode(toNode) ? toNode.summary : undefined,
      onwardRoutes: buildOnwardRoutes(route.toPlaceId, fallbackPlaceId, allMapRoutes, index, route.routeId),
      riskLevel: route.riskLevel,
      standardTravelMinutes: route.standardTravelMinutes,
      travelTimeText: route.travelTimeText,
      notes: route.notes,
    };
  });
  const legacyRoutes = buildLegacyRouteSummaries(state, index, fallbackPlaceId);

  return {
    displayPath: projection.displayPath || fallbackPlaceId || '未确认',
    currentPlaceName: projection.currentPlace?.name ?? fallbackPlaceId ?? '未确认',
    currentPlaceLevel: projection.currentPlace?.level ?? '具体地点',
    currentPlaceSummary: projection.currentPlace?.summary ?? '当前具体地点尚未进入 Map V1 索引。',
    currentSceneName: projection.currentScene?.name,
    currentSceneLevel: projection.currentScene?.level,
    currentSceneSummary: projection.currentScene?.summary,
    scenes: projection.scenes.map(toNodeSummary),
    nearbyRoutes: mapRoutes,
    legacyRoutes,
    locationMemorySummaries: projection.locationMemorySummaries,
    counts: {
      regions: index.regions.length,
      places: index.places.length,
      scenes: index.scenes.length,
      routes: allMapRoutes.length,
      legacyRoutes: state.routes?.length ?? 0,
      dynamicPlaces: dynamicCounts.places,
      dynamicScenes: dynamicCounts.scenes,
    },
  };
}

function buildLegacyRouteSummaries(
  state: RuntimeState,
  index: MapV1Index,
  currentPlaceId: string,
): MapPanelRouteSummary[] {
  const routes = state.routes ?? [];
  const relatedRoutes = routes.filter(
    (route) => route.fromLocationId === currentPlaceId || route.toLocationId === currentPlaceId,
  );
  const visibleRoutes = relatedRoutes.length > 0 ? relatedRoutes : routes;

  return visibleRoutes.slice(0, 20).map((route) => {
    const isFromCurrent = route.fromLocationId === currentPlaceId;
    const toLocationId = isFromCurrent ? route.toLocationId : route.fromLocationId;
    const toNode = index.nodeById[toLocationId];
    const toLocationName = toNode?.name ?? findRuntimeLocationName(state, toLocationId);

    return {
      routeId: route.routeId,
      name: route.name,
      status: route.status,
      knownLevel: route.source,
      toPlaceId: toLocationId,
      toPlaceName: toLocationName,
      toPath: isStandableMapNode(toNode)
        ? buildPlaceDisplayPath(index, toLocationId)
        : toLocationName,
      sourceKind: 'legacyLedger',
      isCurrentPlaceRelated: isFromCurrent || route.toLocationId === currentPlaceId,
      toPlaceSummary: isStandableMapNode(toNode) ? toNode.summary : undefined,
      onwardRoutes: [],
      riskLevel: route.riskLevel,
      travelTimeText: route.travelTime,
    };
  });
}

function buildOnwardRoutes(
  fromPlaceId: string,
  excludedPlaceId: string,
  allRoutes: ReturnType<typeof buildRuntimeRouteEdges>,
  index: MapV1Index,
  excludedRouteId?: string,
): MapPanelOnwardRouteSummary[] {
  const onwardRoutes: MapPanelOnwardRouteSummary[] = [];

  for (const route of allRoutes) {
    if (route.routeId === excludedRouteId) continue;
    if (route.fromPlaceId !== fromPlaceId && route.toPlaceId !== fromPlaceId) continue;

    const toPlaceId = route.fromPlaceId === fromPlaceId ? route.toPlaceId : route.fromPlaceId;
    if (toPlaceId === excludedPlaceId) continue;

    const toNode = index.nodeById[toPlaceId];
    if (!isStandableMapNode(toNode)) continue;

    onwardRoutes.push({
      routeId: route.routeId,
      toPlaceId,
      toPlaceName: toNode.name,
      routeKind: route.routeKind,
      status: route.status,
      travelTimeText: route.travelTimeText,
      standardTravelMinutes: route.standardTravelMinutes,
    });
  }

  return onwardRoutes.slice(0, 6);
}

function findRuntimeLocationName(state: RuntimeState, locationId: string): string {
  return state.locations?.find((location) => location.locationId === locationId)?.name ?? locationId;
}

function toNodeSummary(node: MapNode): MapPanelNodeSummary {
  return {
    id: node.id,
    name: node.name,
    level: node.level,
    summary: node.summary,
  };
}

function countDynamicNodes(nodes: MapNode[]): Pick<MapPanelCounts, 'dynamicPlaces' | 'dynamicScenes'> & {
  places: number;
  scenes: number;
} {
  const counts = { places: 0, scenes: 0 };
  const visit = (node: MapNode) => {
    if (node.mapLayer === 'place') counts.places += 1;
    if (node.mapLayer === 'scene') counts.scenes += 1;
    for (const child of node.subLocations ?? []) {
      visit(child);
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  return {
    ...counts,
    dynamicPlaces: counts.places,
    dynamicScenes: counts.scenes,
  };
}
