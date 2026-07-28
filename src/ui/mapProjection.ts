export interface MapGeoPoint {
  lon: number;
  lat: number;
}

export interface MapProjectedPoint {
  x: number;
  y: number;
}

export interface MapGeoBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export const EAST_HAN_MERCATOR_BOUNDS: MapGeoBounds = {
  minLon: 70.683,
  minLat: 14.957,
  maxLon: 145.687,
  maxLat: 58.043,
};

export function projectLonLatToMapPercent(
  point: MapGeoPoint,
  bounds: MapGeoBounds = EAST_HAN_MERCATOR_BOUNDS,
): MapProjectedPoint {
  const x = ((point.lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * 100;
  const minMercatorY = mercatorY(bounds.minLat);
  const maxMercatorY = mercatorY(bounds.maxLat);
  const y = ((maxMercatorY - mercatorY(point.lat)) / (maxMercatorY - minMercatorY)) * 100;

  return {
    x: clampPercent(x),
    y: clampPercent(y),
  };
}

export function projectGeoPath(points: MapGeoPoint[], close = false): string {
  if (points.length === 0) return '';
  return points
    .map((point, index) => {
      const projected = projectLonLatToMapPercent(point);
      return `${index === 0 ? 'M' : 'L'}${format(projected.x)} ${format(projected.y)}`;
    })
    .join(' ')
    .concat(close ? ' Z' : '');
}

function mercatorY(lat: number): number {
  const radians = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(3))));
}

function format(value: number): string {
  return Number(value.toFixed(2)).toString();
}
