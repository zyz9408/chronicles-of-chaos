import { useState } from 'react';
import { mapVisualManifest } from '../generated/panelVisuals/mapVisualManifest';
import { MAP_GEO_LAND_PATHS, MAP_GEO_RIVER_PATHS } from './mapGeoBaseData';
import { projectGeoPath, type MapGeoPoint } from './mapProjection';

interface HistoricalMapFeature {
  id: string;
  points: MapGeoPoint[];
  close?: boolean;
}

const MOUNTAINS: HistoricalMapFeature[] = [
  {
    id: 'qinling',
    points: [
      { lon: 105.2, lat: 33.9 },
      { lon: 107.4, lat: 33.6 },
      { lon: 109.2, lat: 33.8 },
      { lon: 111.4, lat: 33.6 },
      { lon: 113.2, lat: 33.4 },
    ],
  },
  {
    id: 'taihang',
    points: [
      { lon: 112.0, lat: 40.1 },
      { lon: 113.0, lat: 38.7 },
      { lon: 113.5, lat: 37.2 },
      { lon: 113.2, lat: 35.8 },
    ],
  },
  {
    id: 'bashan',
    points: [
      { lon: 102.4, lat: 32.0 },
      { lon: 105.0, lat: 31.8 },
      { lon: 107.4, lat: 31.9 },
      { lon: 109.8, lat: 31.5 },
    ],
  },
  {
    id: 'daba',
    points: [
      { lon: 106.4, lat: 32.0 },
      { lon: 108.0, lat: 31.9 },
      { lon: 109.6, lat: 32.4 },
      { lon: 111.0, lat: 31.9 },
    ],
  },
  {
    id: 'nanling',
    points: [
      { lon: 108.0, lat: 25.6 },
      { lon: 111.0, lat: 25.1 },
      { lon: 114.2, lat: 25.0 },
      { lon: 117.0, lat: 25.2 },
    ],
  },
  {
    id: 'hengduan',
    points: [
      { lon: 98.3, lat: 33.4 },
      { lon: 99.1, lat: 31.8 },
      { lon: 99.4, lat: 30.2 },
      { lon: 99.2, lat: 28.4 },
      { lon: 98.7, lat: 26.8 },
    ],
  },
  {
    id: 'wuyi',
    points: [
      { lon: 116.2, lat: 28.7 },
      { lon: 117.1, lat: 27.6 },
      { lon: 117.9, lat: 26.5 },
      { lon: 118.6, lat: 25.6 },
    ],
  },
  {
    id: 'dabie',
    points: [
      { lon: 114.1, lat: 31.7 },
      { lon: 115.4, lat: 31.3 },
      { lon: 116.7, lat: 31.0 },
      { lon: 117.6, lat: 31.2 },
    ],
  },
  {
    id: 'yinshan',
    points: [
      { lon: 106.4, lat: 41.3 },
      { lon: 109.2, lat: 41.5 },
      { lon: 112.1, lat: 41.2 },
      { lon: 115.4, lat: 41.0 },
    ],
  },
];

const TERRAIN_TEXTURES: HistoricalMapFeature[] = [
  {
    id: 'bashu-hills-a',
    points: [
      { lon: 102.0, lat: 30.8 },
      { lon: 103.0, lat: 31.0 },
      { lon: 104.1, lat: 30.8 },
      { lon: 105.0, lat: 31.1 },
    ],
  },
  {
    id: 'bashu-hills-b',
    points: [
      { lon: 103.2, lat: 29.2 },
      { lon: 104.4, lat: 29.5 },
      { lon: 105.3, lat: 29.3 },
    ],
  },
  {
    id: 'hanzhong-hills',
    points: [
      { lon: 105.6, lat: 33.2 },
      { lon: 106.7, lat: 33.5 },
      { lon: 108.0, lat: 33.3 },
    ],
  },
  {
    id: 'jingbei-hills',
    points: [
      { lon: 110.8, lat: 31.0 },
      { lon: 112.2, lat: 30.9 },
      { lon: 113.4, lat: 31.1 },
      { lon: 114.8, lat: 30.9 },
    ],
  },
  {
    id: 'jingnan-hills',
    points: [
      { lon: 110.2, lat: 27.8 },
      { lon: 111.7, lat: 27.5 },
      { lon: 113.2, lat: 27.8 },
    ],
  },
  {
    id: 'jiangdong-hills-a',
    points: [
      { lon: 117.0, lat: 29.8 },
      { lon: 118.3, lat: 29.4 },
      { lon: 119.8, lat: 29.5 },
      { lon: 121.0, lat: 29.1 },
    ],
  },
  {
    id: 'jiangdong-hills-b',
    points: [
      { lon: 118.4, lat: 27.4 },
      { lon: 119.4, lat: 27.1 },
      { lon: 120.3, lat: 27.5 },
    ],
  },
  {
    id: 'lingnan-hills',
    points: [
      { lon: 109.0, lat: 24.0 },
      { lon: 111.2, lat: 23.7 },
      { lon: 113.2, lat: 23.9 },
      { lon: 115.0, lat: 23.6 },
    ],
  },
  {
    id: 'hebei-hills',
    points: [
      { lon: 113.8, lat: 38.4 },
      { lon: 115.0, lat: 38.1 },
      { lon: 116.4, lat: 38.3 },
    ],
  },
  {
    id: 'liangzhou-hills',
    points: [
      { lon: 97.8, lat: 38.5 },
      { lon: 99.0, lat: 38.8 },
      { lon: 100.4, lat: 38.6 },
    ],
  },
];

export function MapHistoricalBaseLayer() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const mapAsset = mapVisualManifest['three-kingdoms-map-v2-full-domain-base.png'];
  const retryToken = attempt > 0 ? `?retry=${attempt}` : '';

  return (
    <div className="map-historical-base" data-visual-state={state} data-testid="map-historical-base-layer">
      <picture className="map-v2-base-map-picture" aria-hidden="true">
        <source media="(max-width: 760px)" srcSet={`${mapAsset.mobile.url}${retryToken}`} />
        <img
          key={attempt}
          className="map-v2-base-map-art"
          src={`${mapAsset.display.url}${retryToken}`}
          width={mapAsset.display.width}
          height={mapAsset.display.height}
          decoding="async"
          alt=""
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
        />
      </picture>

      <svg
        className="map-historical-base-layer"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect className="map-historical-sea" x="0" y="0" width="100" height="100" />

        <g className="map-historical-real-land-layer" data-testid="map-real-land-layer">
          {MAP_GEO_LAND_PATHS.map((path, index) => (
            <path key={`land-${index}`} d={path} />
          ))}
        </g>

        <g className="map-historical-real-river-layer" data-testid="map-real-river-layer">
          {MAP_GEO_RIVER_PATHS.map((path, index) => (
            <path key={`river-${index}`} d={path} />
          ))}
        </g>

        <g className="map-historical-terrain-layer">
          {TERRAIN_TEXTURES.map((feature) => (
            <path key={feature.id} d={projectGeoPath(feature.points)} />
          ))}
        </g>

        <g className="map-historical-mountain-layer">
          {MOUNTAINS.map((feature) => (
            <path key={feature.id} d={projectGeoPath(feature.points)} />
          ))}
        </g>
      </svg>

      {state !== 'ready' && (
        <div className={`map-base-visual-state map-base-visual-state--${state}`} role={state === 'error' ? 'alert' : 'status'}>
          <span>{state === 'error' ? '地图底图载入失败，已切换矢量底图。' : '正在载入地图底图…'}</span>
          {state === 'error' && (
            <button
              type="button"
              onClick={() => {
                setState('loading');
                setAttempt((value) => value + 1);
              }}
            >
              重试载入
            </button>
          )}
        </div>
      )}
    </div>
  );
}
