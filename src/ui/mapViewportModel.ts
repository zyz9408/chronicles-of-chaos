import type { MapVisualPoint, MapVisualTier } from './mapVisualModel';

export interface MapViewportInput {
  zoom: number;
  panX?: number;
  panY?: number;
  focusPoint?: MapVisualPoint;
}

export interface MapViewportModel {
  zoom: number;
  tier: MapVisualTier;
  panX: number;
  panY: number;
  transform: string;
}

export interface MapLabelLayoutInput {
  points: MapVisualPoint[];
  zoom: number;
  selectedPointId?: string;
  focusPoint?: MapVisualPoint;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface MapLabelCluster {
  anchorPointId: string;
  count: number;
  hiddenPointIds: string[];
  hiddenPointNames: string[];
}

export interface MapLabelLayout {
  visibleLabelIds: Set<string>;
  clustersByAnchorId: Map<string, MapLabelCluster>;
}

export const MAP_MIN_ZOOM = 0.65;
export const MAP_LOCAL_FOCUS_ZOOM = 12;
export const MAP_MAX_ZOOM = 24;

const tierRank: Record<MapVisualTier, number> = {
  far: 0,
  mid: 1,
  near: 2,
  detail: 3,
};

export function buildMapViewportModel(input: MapViewportInput): MapViewportModel {
  const zoom = clampNumber(input.zoom, MAP_MIN_ZOOM, MAP_MAX_ZOOM);
  const focusedPan = input.focusPoint
    ? {
        panX: (50 - input.focusPoint.x) * zoom,
        panY: (50 - input.focusPoint.y) * zoom,
      }
    : undefined;
  const panLimit = getPanLimit(zoom);
  const panX = clampNumber(focusedPan?.panX ?? input.panX ?? 0, -panLimit, panLimit);
  const panY = clampNumber(focusedPan?.panY ?? input.panY ?? 0, -panLimit, panLimit);

  return {
    zoom,
    tier: getMapVisualTier(zoom),
    panX,
    panY,
    transform: `translate(${panX.toFixed(2)}%, ${panY.toFixed(2)}%) scale(${trimNumber(zoom)})`,
  };
}

export function getVisibleMapPoints(
  points: MapVisualPoint[],
  zoom: number,
): MapVisualPoint[] {
  const currentTier = getMapVisualTier(zoom);
  return points.filter((point) => (
    point.isCurrent
    || point.relevance === 'nearbyRoute'
    || tierRank[point.minTier] <= tierRank[currentTier]
  ));
}

/**
 * Resolves the labels as one layout instead of letting every marker decide in
 * isolation. The returned clusters remain presentation-only: map identities,
 * routes and runtime writeback are not changed.
 */
export function buildMapLabelLayout(input: MapLabelLayoutInput): MapLabelLayout {
  const zoom = clampNumber(input.zoom, MAP_MIN_ZOOM, MAP_MAX_ZOOM);
  const viewportWidth = Math.max(280, input.viewportWidth ?? 840);
  const viewportHeight = Math.max(220, input.viewportHeight ?? 528);
  const candidates = input.points
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => isMapLabelLayoutCandidate(point, zoom, input.selectedPointId))
    .sort((left, right) => {
      const priorityDelta = getMapLabelPriority(right.point, input.selectedPointId)
        - getMapLabelPriority(left.point, input.selectedPointId);
      return priorityDelta || left.index - right.index;
    });
  const accepted: Array<{ point: MapVisualPoint; rect: MapLabelRect }> = [];
  const visibleLabelIds = new Set<string>();
  const clustersByAnchorId = new Map<string, MapLabelCluster>();

  for (const candidate of candidates) {
    const rect = estimateMapLabelRect(candidate.point, zoom, viewportWidth, viewportHeight);
    const collision = accepted.find((acceptedLabel) => mapLabelRectsOverlap(rect, acceptedLabel.rect));
    if (!collision) {
      accepted.push({ point: candidate.point, rect });
      visibleLabelIds.add(candidate.point.id);
      continue;
    }

    const existingCluster = clustersByAnchorId.get(collision.point.id);
    if (existingCluster) {
      existingCluster.count += 1;
      existingCluster.hiddenPointIds.push(candidate.point.id);
      existingCluster.hiddenPointNames.push(candidate.point.name);
    } else {
      clustersByAnchorId.set(collision.point.id, {
        anchorPointId: collision.point.id,
        count: 1,
        hiddenPointIds: [candidate.point.id],
        hiddenPointNames: [candidate.point.name],
      });
    }
  }

  return { visibleLabelIds, clustersByAnchorId };
}

export function shouldShowMapPointLabel(
  point: MapVisualPoint,
  zoom: number,
  selected = false,
  focusPoint?: MapVisualPoint,
): boolean {
  if (point.isCurrent || selected) return true;

  const currentTier = getMapVisualTier(zoom);
  if (currentTier === 'detail') {
    if (point.geographicSkeleton && point.mapLayer === 'place') {
      if (!focusPoint) return true;
      const distance = getPointDistance(point, focusPoint);
      return distance <= 3.8;
    }
    if (point.mapLayer !== 'place' || !focusPoint) return false;
    const distance = getPointDistance(point, focusPoint);
    if (distance <= 3.2) return false;
    if (distance <= 11 && (point.relevance === 'nearbyRoute' || point.relevance === 'dynamic')) return true;
    if (distance <= 8 && point.relevance === 'core') return true;
    return false;
  }

  if (currentTier === 'near') {
    if (point.mapLayer !== 'place') return false;
    if (point.geographicSkeleton) {
      return !focusPoint || getPointDistance(point, focusPoint) <= 10;
    }
    if (point.relevance === 'nearbyRoute' || point.relevance === 'dynamic') {
      if (focusPoint && getPointDistance(point, focusPoint) <= 4.2) return false;
      return true;
    }
    if (point.relevance === 'core') {
      return !focusPoint || getPointDistance(point, focusPoint) > 6.5;
    }
    return false;
  }

  if (currentTier === 'mid') {
    if (point.relevance === 'nearbyRoute' && focusPoint && getPointDistance(point, focusPoint) <= 4.5) {
      return false;
    }
    return point.mapLayer === 'place' && (
      point.relevance === 'core'
      || point.relevance === 'nearbyRoute'
      || (point.geographicSkeleton && (point.level === '城邑' || point.level === '关隘'))
    );
  }

  return point.minTier === 'far';
}

export function getMapVisualTier(zoom: number): MapVisualTier {
  if (zoom >= 4.2) return 'detail';
  if (zoom >= 2.05) return 'near';
  if (zoom >= 1.15) return 'mid';
  return 'far';
}

export function stepMapZoom(
  currentZoom: number,
  direction: number,
  inputMode: 'button' | 'wheel' = 'button',
): number {
  const current = clampNumber(currentZoom, MAP_MIN_ZOOM, MAP_MAX_ZOOM);
  if (!Number.isFinite(direction) || direction === 0) return current;

  const sign = direction > 0 ? 1 : -1;
  const step = current < 4.2
    ? (inputMode === 'wheel' ? 0.28 : 0.45)
    : inputMode === 'wheel'
      ? Math.max(0.42, current * 0.08)
      : Math.max(0.8, current * 0.18);

  return Number(clampNumber(current + (sign * step), MAP_MIN_ZOOM, MAP_MAX_ZOOM).toFixed(2));
}

function getPanLimit(zoom: number): number {
  return Math.max(80, zoom * 62);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function trimNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function getPointDistance(a: MapVisualPoint, b: MapVisualPoint): number {
  const deltaX = a.x - b.x;
  const deltaY = a.y - b.y;
  return Math.sqrt((deltaX * deltaX) + (deltaY * deltaY));
}

interface MapLabelRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function getMapLabelPriority(point: MapVisualPoint, selectedPointId?: string): number {
  if (point.isCurrent) return 500;
  if (point.id === selectedPointId) return 450;
  if (point.relevance === 'nearbyRoute') return 400;
  if (point.relevance === 'dynamic') return 300;
  if (point.relevance === 'core') return 240;
  if (point.mapLayer === 'region') return 220;
  if (point.geographicSkeleton) return 180;
  return 100;
}

function isMapLabelLayoutCandidate(
  point: MapVisualPoint,
  zoom: number,
  selectedPointId?: string,
): boolean {
  if (point.isCurrent || point.id === selectedPointId || point.relevance === 'nearbyRoute') return true;

  const tier = getMapVisualTier(zoom);
  if (tier === 'far') {
    return point.mapLayer === 'region' || point.relevance === 'core';
  }
  if (tier === 'mid') {
    return point.mapLayer === 'region'
      || point.relevance === 'core'
      || point.geographicSkeleton;
  }
  if (tier === 'near') {
    return point.mapLayer === 'place'
      && (point.geographicSkeleton || point.relevance === 'dynamic' || point.relevance === 'core');
  }
  return point.mapLayer === 'place';
}

function estimateMapLabelRect(
  point: MapVisualPoint,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
): MapLabelRect {
  const characterCount = Math.max(1, Array.from(point.name.trim()).length);
  const labelWidth = Math.min(152, (characterCount * 15.5) + 8);
  const labelHeight = 25;
  const markerX = (point.x / 100) * viewportWidth * zoom;
  const markerY = (point.y / 100) * viewportHeight * zoom;
  const labelLeft = markerX - 6.4 + 12;

  return {
    left: labelLeft - 4,
    right: labelLeft + labelWidth + 4,
    top: markerY - (labelHeight / 2) - 4,
    bottom: markerY + (labelHeight / 2) + 4,
  };
}

function mapLabelRectsOverlap(left: MapLabelRect, right: MapLabelRect): boolean {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}
