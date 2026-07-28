import type { MapLayerKind, MapNode, MapRouteEdgeV1 } from '../types';

export interface MapV1Index {
  nodeById: Record<string, MapNode>;
  parentIdByNodeId: Record<string, string | undefined>;
  regions: MapNode[];
  places: MapNode[];
  scenes: MapNode[];
}

export interface MapValidationResult {
  valid: boolean;
  errors: string[];
}

export function buildMapV1Index(nodes: MapNode[]): MapV1Index {
  const index: MapV1Index = {
    nodeById: {},
    parentIdByNodeId: {},
    regions: [],
    places: [],
    scenes: [],
  };

  for (const node of nodes) {
    visitMapNode(node, undefined, index);
  }

  return index;
}

export function isStandableMapNode(node: MapNode | undefined): boolean {
  return getMapLayer(node) === 'place';
}

export function buildPlaceDisplayPath(
  index: MapV1Index,
  placeId: string,
  sceneId?: string,
): string {
  const place = index.nodeById[placeId];
  if (!isStandableMapNode(place)) {
    return '';
  }

  const path = collectAncestorNames(index, placeId);
  const scene = sceneId ? index.nodeById[sceneId] : undefined;
  if (scene && getMapLayer(scene) === 'scene' && index.parentIdByNodeId[scene.id] === placeId) {
    path.push(scene.name);
  }

  return path.join(' - ');
}

export function validateMapRouteEdge(
  index: MapV1Index,
  route: MapRouteEdgeV1,
): MapValidationResult {
  const errors: string[] = [];
  validateRouteEndpoint(index, route.fromPlaceId, 'fromPlaceId', errors);
  validateRouteEndpoint(index, route.toPlaceId, 'toPlaceId', errors);

  if (route.fromPlaceId === route.toPlaceId) {
    errors.push('路线两端不能是同一个具体地点。');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function visitMapNode(
  node: MapNode,
  parentId: string | undefined,
  index: MapV1Index,
): void {
  index.nodeById[node.id] = node;
  index.parentIdByNodeId[node.id] = node.parentId ?? parentId;

  const layer = getMapLayer(node);
  if (layer === 'region') {
    index.regions.push(node);
  } else if (layer === 'place') {
    index.places.push(node);
  } else if (layer === 'scene') {
    index.scenes.push(node);
  }

  for (const child of node.subLocations ?? []) {
    visitMapNode(child, node.id, index);
  }
}

function collectAncestorNames(index: MapV1Index, nodeId: string): string[] {
  const names: string[] = [];
  let cursor: string | undefined = nodeId;

  while (cursor) {
    const node = index.nodeById[cursor];
    if (!node) break;
    names.unshift(node.name);
    cursor = index.parentIdByNodeId[cursor];
  }

  return names;
}

function validateRouteEndpoint(
  index: MapV1Index,
  nodeId: string,
  field: 'fromPlaceId' | 'toPlaceId',
  errors: string[],
): void {
  const node = index.nodeById[nodeId];
  if (!node) {
    errors.push(`${field} 不存在：${nodeId}`);
    return;
  }

  if (!isStandableMapNode(node)) {
    errors.push(`${field} 必须连接具体地点层，不能连接区域或场景：${node.name}`);
  }
}

function getMapLayer(node: MapNode | undefined): MapLayerKind | undefined {
  return node?.mapLayer;
}
