import type { MapLayerKind } from '../engine/types';
import { projectLonLatToMapPercent } from './mapProjection';

export interface MapVisualAnchorInput {
  id: string;
  parentId?: string;
  mapLayer?: MapLayerKind;
  fallbackScope?: 'local' | 'regional';
}

export interface MapVisualPointLocation {
  x: number;
  y: number;
  anchored: boolean;
  anchorId?: string;
}

export interface MapVisualAnchor {
  id: string;
  lon: number;
  lat: number;
  x: number;
  y: number;
  mapLayer: 'region' | 'place';
}

const ANCHORS: Record<string, { lon: number; lat: number }> = {
  region_youzhou: { lon: 117.2, lat: 40.4 },
  region_jizhou: { lon: 115.5, lat: 38.3 },
  region_bingzhou: { lon: 112.3, lat: 38.4 },
  region_liangzhou: { lon: 103.8, lat: 36.0 },
  region_sili: { lon: 111.0, lat: 34.8 },
  region_yanzhou: { lon: 116.0, lat: 35.4 },
  region_xuzhou: { lon: 118.4, lat: 34.5 },
  region_yuzhou: { lon: 113.8, lat: 33.8 },
  region_jingzhou: { lon: 112.4, lat: 30.8 },
  region_yangzhou: { lon: 119.1, lat: 30.3 },
  region_yizhou: { lon: 104.1, lat: 30.7 },
  region_qingzhou: { lon: 118.3, lat: 36.4 },
  region_jiaozhou: { lon: 108.3, lat: 22.8 },
  region_western_regions: { lon: 82.8, lat: 40.5 },
  region_steppe: { lon: 108.0, lat: 44.5 },
  region_korean_peninsula: { lon: 126.8, lat: 37.8 },
  region_wa: { lon: 130.6, lat: 33.4 },

  place_sili_luoyang: { lon: 112.45, lat: 34.62 },
  place_sili_changan: { lon: 108.94, lat: 34.34 },
  place_sili_mengjin: { lon: 112.44, lat: 34.83 },
  place_sili_yique_pass: { lon: 112.47, lat: 34.53 },
  place_sili_hulao_pass: { lon: 113.20, lat: 34.85 },
  place_sili_hangu_pass: { lon: 112.06, lat: 34.73 },
  place_sili_xiaopingjin: { lon: 112.54, lat: 34.90 },
  place_sili_dagu_pass: { lon: 112.78, lat: 34.48 },
  place_sili_guangcheng_pass: { lon: 112.83, lat: 34.20 },
  place_sili_huanyuan_pass: { lon: 112.93, lat: 34.52 },
  place_sili_xuanmen_pass: { lon: 113.12, lat: 34.78 },
  place_sili_baling: { lon: 109.10, lat: 34.30 },
  place_sili_lantian: { lon: 109.32, lat: 34.15 },
  place_sili_ziwu_north_mouth: { lon: 108.89, lat: 33.97 },
  loc_sili_youfengfu_seat: { lon: 108.49, lat: 34.30 },
  place_sili_chencang: { lon: 107.15, lat: 34.36 },
  place_sili_sanguan_pass: { lon: 106.95, lat: 34.21 },
  place_sili_wuzhangyuan: { lon: 107.64, lat: 34.27 },
  place_sili_huai: { lon: 113.15, lat: 35.10 },
  place_sili_wen: { lon: 113.08, lat: 34.94 },
  place_sili_heyang_ferry: { lon: 112.58, lat: 34.91 },
  place_yingchuan_yangdi: { lon: 113.47, lat: 34.16 },
  place_yingchuan_changshe: { lon: 113.77, lat: 34.22 },
  place_yuzhou_xuchang: { lon: 113.85, lat: 34.02 },
  place_yingchuan_xuxian: { lon: 113.85, lat: 34.02 },
  place_jizhou_yecheng: { lon: 114.4, lat: 36.3 },
  place_jizhou_ye: { lon: 114.4, lat: 36.3 },
  place_yangzhou_jianye: { lon: 118.79, lat: 32.06 },
  place_yizhou_chengdu: { lon: 104.06, lat: 30.67 },
  place_jingzhou_xiangyang: { lon: 112.14, lat: 32.04 },
  place_yizhou_hanzhong: { lon: 107.03, lat: 33.07 },
  place_yizhou_nanzheng: { lon: 107.03, lat: 33.07 },
  place_nanyang_wan: { lon: 112.53, lat: 32.99 },
  place_jingzhou_wan: { lon: 112.53, lat: 32.99 },
  place_jingzhou_xinye: { lon: 112.36, lat: 32.52 },
  place_nanyang_xinye: { lon: 112.36, lat: 32.52 },
  place_jingzhou_jiangling: { lon: 112.42, lat: 30.04 },
  place_yangzhou_shouchun: { lon: 116.79, lat: 32.57 },
  loc_yangzhou_jiujiang_seat: { lon: 116.79, lat: 32.57 },
  place_xuzhou_xiapi: { lon: 118.34, lat: 34.37 },
  place_xuzhou_xiapi_city: { lon: 118.34, lat: 34.37 },
};

export function resolveMapVisualPoint(input: MapVisualAnchorInput): MapVisualPointLocation | null {
  const direct = ANCHORS[input.id];
  if (direct) {
    const projected = projectLonLatToMapPercent(direct);
    return {
      ...projected,
      anchored: true,
      anchorId: input.id,
    };
  }

  const parentId = input.parentId?.trim();
  if (!parentId) return null;

  const parent = ANCHORS[parentId];
  if (!parent) return null;

  const offset = input.fallbackScope === 'regional'
    ? getRegionalOffset(input.id)
    : getDeterministicOffset(input.id);
  const projectedParent = projectLonLatToMapPercent(parent);
  return {
    x: clampPercent(projectedParent.x + offset.x),
    y: clampPercent(projectedParent.y + offset.y),
    anchored: false,
    anchorId: parentId,
  };
}

export function hasMapVisualAnchor(id: string): boolean {
  return Boolean(ANCHORS[id]);
}

export function listMapVisualAnchors(): MapVisualAnchor[] {
  return Object.entries(ANCHORS).map(([id, point]) => {
    const projected = projectLonLatToMapPercent(point);
    return {
      id,
      lon: point.lon,
      lat: point.lat,
      x: projected.x,
      y: projected.y,
      mapLayer: id.startsWith('region_') ? 'region' : 'place',
    };
  });
}

function getDeterministicOffset(id: string): { x: number; y: number } {
  const hash = hashString(id);

  const x = ((hash % 13) - 6) * 0.18;
  const y = (((hash >>> 4) % 13) - 6) * 0.18;
  return { x, y };
}

function getRegionalOffset(id: string): { x: number; y: number } {
  const hash = hashString(id);
  const angle = ((hash % 360) * Math.PI) / 180;
  const radius = 1.8 + (((hash >>> 9) % 100) / 100) * 4.8;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius * 0.72,
  };
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function clampPercent(value: number): number {
  return Math.max(4, Math.min(96, Number(value.toFixed(2))));
}
