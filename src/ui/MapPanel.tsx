import React from 'react';
import type { RuntimeState, WorldBook } from '../engine/types';
import { buildMapPanelModel, type MapPanelRouteSummary } from './mapPanelModel';
import { buildMapVisualModel, type MapVisualPoint } from './mapVisualModel';
import {
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  buildMapLabelLayout,
  buildMapViewportModel,
  getVisibleMapPoints,
  type MapLabelCluster,
} from './mapViewportModel';
import { MapHistoricalBaseLayer } from './MapHistoricalBaseLayer';
import { bindMapWheelZoom } from './mapWheelEvent';

interface MapPanelProps {
  worldBook: WorldBook;
  runtimeState: RuntimeState;
  onClose: () => void;
}

export const MapPanel: React.FC<MapPanelProps> = ({ worldBook, runtimeState, onClose }) => {
  const model = buildMapPanelModel(worldBook, runtimeState);
  const visual = buildMapVisualModel(worldBook, runtimeState);
  const [showArchive, setShowArchive] = React.useState(false);
  const [zoom, setZoom] = React.useState(0.9);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [selectedPointId, setSelectedPointId] = React.useState<string | undefined>(visual.currentPoint?.id);
  const mapStageRef = React.useRef<HTMLDivElement | null>(null);
  const mapSurfaceRef = React.useRef<HTMLDivElement | null>(null);
  const [mapSurfaceSize, setMapSurfaceSize] = React.useState({ width: 840, height: 528 });
  const dragRef = React.useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const viewport = React.useMemo(
    () => buildMapViewportModel({ zoom, panX: pan.x, panY: pan.y }),
    [pan.x, pan.y, zoom],
  );
  const visiblePoints = React.useMemo(() => getVisibleMapPoints(visual.points, viewport.zoom), [visual.points, viewport.zoom]);
  const visiblePointIds = React.useMemo(() => new Set(visiblePoints.map((point) => point.id)), [visiblePoints]);
  const visibleRoutes = React.useMemo(
    () => visual.routes.filter((route) => (
      visiblePointIds.has(route.fromPlaceId) && visiblePointIds.has(route.toPlaceId)
    )),
    [visiblePointIds, visual.routes],
  );
  const focusedPoint = visual.points.find((point) => point.id === selectedPointId)
    ?? visual.currentPoint
    ?? visual.points.find((point) => point.mapLayer === 'place');
  const labelLayout = React.useMemo(() => buildMapLabelLayout({
    points: visiblePoints,
    zoom: viewport.zoom,
    selectedPointId: focusedPoint?.id,
    focusPoint: focusedPoint ?? visual.currentPoint,
    viewportWidth: mapSurfaceSize.width,
    viewportHeight: mapSurfaceSize.height,
  }), [
    focusedPoint,
    mapSurfaceSize.height,
    mapSurfaceSize.width,
    viewport.zoom,
    visiblePoints,
    visual.currentPoint,
  ]);

  React.useEffect(() => {
    setSelectedPointId((current) => {
      if (current && visual.points.some((point) => point.id === current)) return current;
      return visual.currentPoint?.id;
    });
  }, [visual.currentPoint?.id, visual.points]);

  const adjustZoom = React.useCallback((delta: number) => {
    setZoom((value) => Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, Number((value + delta).toFixed(2)))));
  }, []);

  React.useEffect(() => {
    const stage = mapStageRef.current;
    if (!stage) return undefined;

    return bindMapWheelZoom(stage, (direction) => {
      adjustZoom(direction * 0.28);
    });
  }, [adjustZoom]);

  React.useEffect(() => {
    const surface = mapSurfaceRef.current;
    if (!surface) return undefined;

    const updateSize = () => {
      const rect = surface.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setMapSurfaceSize((current) => {
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        if (current.width === width && current.height === height) return current;
        return { width, height };
      });
    };

    updateSize();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateSize);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  const focusCurrentPoint = React.useCallback(() => {
    if (!visual.currentPoint) return;
    const focusedViewport = buildMapViewportModel({
      zoom: Math.max(4.2, zoom),
      focusPoint: visual.currentPoint,
    });
    setZoom(focusedViewport.zoom);
    setPan({ x: focusedViewport.panX, y: focusedViewport.panY });
    setSelectedPointId(visual.currentPoint.id);
  }, [visual.currentPoint, zoom]);

  const resetNationalView = React.useCallback(() => {
    setZoom(0.9);
    setPan({ x: 0, y: 0 });
    setSelectedPointId(visual.currentPoint?.id);
  }, [visual.currentPoint?.id]);

  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"]')) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  }, [pan.x, pan.y]);

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({
      x: drag.panX + ((event.clientX - drag.startX) / 8),
      y: drag.panY + ((event.clientY - drag.startY) / 8),
    });
  }, []);

  const handlePointerEnd = React.useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <div className="system-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="system-modal ui-system-workspace map-panel-modal"
        data-testid="map-panel"
        role="dialog"
        aria-modal="true"
        aria-label="局势地图"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="system-modal-head map-panel-head">
          <div>
            <span>局势地图</span>
            <small>天下形势</small>
          </div>
          <button type="button" className="system-modal-close" onClick={onClose}>关闭</button>
        </div>

        <div className="map-panel-body">
          <section className="map-panel-hero">
            <div>
              <span className="map-panel-eyebrow">当前位置</span>
              <h3>{model.displayPath}</h3>
            </div>
            <div className="map-panel-stat-strip" aria-label="地图账本规模">
              <span>区域 <strong>{model.counts.regions}</strong></span>
              <span>地点 <strong>{model.counts.places}</strong></span>
              <span>路线 <strong>{model.counts.routes}</strong></span>
            </div>
          </section>

          <section className="map-v2-layout">
            <div
              ref={mapStageRef}
              className="map-v2-national-stage"
              data-map-tier={viewport.tier}
              aria-label="全国视觉地图"
            >
              <div className="map-v2-toolbar" aria-label="地图缩放控制">
                <button type="button" onClick={() => adjustZoom(0.45)} aria-label="放大地图" title="放大地图">+</button>
                <button type="button" onClick={() => adjustZoom(-0.45)} aria-label="缩小地图" title="缩小地图">-</button>
                <button type="button" onClick={resetNationalView} aria-label="复位全国" title="复位全国">全国</button>
                <button type="button" onClick={focusCurrentPoint} aria-label="聚焦当前位置" title="聚焦当前位置">当前位置</button>
                <span className="map-v2-zoom-level">
                  {viewport.tier === 'far' ? '全国' : viewport.tier === 'mid' ? '区域' : viewport.tier === 'near' ? '近景' : '详图'}
                </span>
              </div>
              <div
                ref={mapSurfaceRef}
                className={`map-v2-map-surface ${dragRef.current ? 'dragging' : ''}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerEnd}
                onPointerCancel={handlePointerEnd}
              >
                <div className="map-v2-canvas" style={{ transform: viewport.transform }}>
                  <MapHistoricalBaseLayer />
                  <svg
                    className="map-v2-route-layer"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {visibleRoutes.map((route) => (
                      <line
                        key={route.routeId}
                        x1={route.from.x}
                        y1={route.from.y}
                        x2={route.to.x}
                        y2={route.to.y}
                        className={route.from.isCurrent || route.to.isCurrent ? 'active' : undefined}
                      />
                    ))}
                  </svg>
                  {visiblePoints.map((point) => (
                    <MapVisualMarker
                      key={point.id}
                      point={point}
                      selected={point.id === focusedPoint?.id}
                      showLabel={labelLayout.visibleLabelIds.has(point.id)}
                      cluster={labelLayout.clustersByAnchorId.get(point.id)}
                      zoom={viewport.zoom}
                      onSelect={setSelectedPointId}
                    />
                  ))}
                </div>
              </div>
            </div>

            <aside className="map-v2-side">
              <div
                className={`map-panel-card map-v2-focus-card ${focusedPoint?.isCurrent ? 'accent' : ''}`}
                data-testid="map-focus-card"
              >
                <div className="map-panel-card-title">
                  <span>{focusedPoint?.isCurrent ? '当前位置' : '地图焦点'}</span>
                  <small>{formatMapLevelLabel(focusedPoint?.level ?? model.currentPlaceLevel, '具体地点')}</small>
                </div>
                <strong>{formatMapEntityName(focusedPoint?.name ?? model.currentPlaceName, '未确认地点')}</strong>
                <p className="map-v2-focus-path">
                  {focusedPoint?.displayPath || model.displayPath || '地点层级尚未确认'}
                </p>
                <p>{focusedPoint?.summary || model.currentPlaceSummary}</p>
                {focusedPoint && (
                  <span className={`map-v2-focus-role ${focusedPoint.relevance}`}>
                    {getMapPointRoleLabel(focusedPoint)}
                  </span>
                )}
              </div>

              <div className="map-panel-card map-v2-scene-card">
                <div className="map-panel-card-title">
                  <span>当前场景</span>
                  <small>{formatMapLevelLabel(model.currentSceneLevel, '未指定')}</small>
                </div>
                <strong>{formatMapEntityName(model.currentSceneName, '未指定场景')}</strong>
                <p className="map-v2-scene-parent">位于 {formatMapEntityName(model.currentPlaceName, '未确认地点')}</p>
                <p>{model.currentSceneSummary ?? '当前地点还没有写入具体场景。'}</p>
              </div>

              <div className="map-panel-card map-v2-target-card">
                <div className="map-panel-card-title">
                  <span>可移动目标</span>
                  <small>{model.nearbyRoutes.length} 条</small>
                </div>
                {model.nearbyRoutes.length > 0 ? (
                  <div className="map-v2-route-chips">
                    {model.nearbyRoutes.slice(0, 6).map((route) => (
                      <button
                        key={route.routeId}
                        type="button"
                        className={focusedPoint?.id === route.toPlaceId ? 'selected' : undefined}
                        aria-pressed={focusedPoint?.id === route.toPlaceId}
                        onClick={() => {
                          if (visual.points.some((point) => point.id === route.toPlaceId)) {
                            setSelectedPointId(route.toPlaceId);
                          }
                        }}
                      >
                        <strong>{formatMapEntityName(route.toPlaceName, '未确认地点')}</strong>
                        <small>{route.toPath}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p>当前地点暂无已确认路线。</p>
                )}
              </div>

              <button
                type="button"
                className="map-panel-archive-toggle"
                onClick={() => setShowArchive((value) => !value)}
                aria-expanded={showArchive}
              >
                地图档案
              </button>
            </aside>
          </section>

          {showArchive && (
            <section className="map-panel-archive" aria-label="地图档案">
              <section className="map-panel-section">
                <div className="map-panel-section-title">
                  <span>地点档案</span>
                  <small>当前地点承接</small>
                </div>
                {model.locationMemorySummaries.length > 0 ? (
                  <div className="map-panel-memory-list">
                    {model.locationMemorySummaries.map((memory) => (
                      <div key={`${memory.locationId}-${memory.updatedAt}`} className="map-panel-memory">
                        <strong>{memory.locationName ?? model.currentPlaceName}</strong>
                        <small>{memory.updatedAt}</small>
                        <p>{memory.summary}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="map-panel-empty">当前地点暂无额外地点记忆。</p>
                )}
              </section>

              <section className="map-panel-section route-priority">
                <div className="map-panel-section-title">
                  <span>路线档案</span>
                  <small>具体地点之间</small>
                </div>

                {model.nearbyRoutes.length > 0 ? (
                  <div className="map-panel-list">
                    {model.nearbyRoutes.map((route) => (
                      <RouteRow key={route.routeId} route={route} label="路线" />
                    ))}
                  </div>
                ) : (
                  <p className="map-panel-empty strong">当前具体地点暂无已确认路线。</p>
                )}

                {model.legacyRoutes.length > 0 && (
                  <div className="map-panel-legacy">
                    <div className="map-panel-subtitle">
                      <span>旧档路线</span>
                      <small>旧存档兼容</small>
                    </div>
                    <div className="map-panel-list compact">
                      {model.legacyRoutes.map((route) => (
                        <RouteRow key={route.routeId} route={route} label={route.isCurrentPlaceRelated ? '附近' : '旧档'} />
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {visual.unlocatedPlaces.length > 0 && (
                <section className="map-panel-section">
                  <div className="map-panel-section-title">
                    <span>未定位地点</span>
                    <small>待后续剧情确认</small>
                  </div>
                  <div className="map-panel-scene-grid">
                    {visual.unlocatedPlaces.map((place) => (
                      <div key={place.id} className="map-panel-scene">
                        <strong>{place.name}</strong>
                        <span>{place.level}</span>
                        <p>{place.summary}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="map-panel-section">
                <div className="map-panel-section-title">
                  <span>地点内场景</span>
                  <small>场景移动不走路线</small>
                </div>
                {model.scenes.length === 0 ? (
                  <p className="map-panel-empty">当前具体地点暂无已登记场景。</p>
                ) : (
                  <div className="map-panel-scene-grid">
                    {model.scenes.map((scene) => (
                      <div key={scene.id} className="map-panel-scene">
                        <strong>{scene.name}</strong>
                        <span>{scene.level}</span>
                        <p>{scene.summary}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </section>
          )}
        </div>
      </section>
    </div>
  );
};

function MapVisualMarker({
  point,
  selected,
  showLabel,
  cluster,
  zoom,
  onSelect,
}: {
  point: MapVisualPoint;
  selected?: boolean;
  showLabel?: boolean;
  cluster?: MapLabelCluster;
  zoom: number;
  onSelect?: (id: string) => void;
}) {
  const tooltipId = `map-marker-tooltip-${point.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const routeText = point.knownRoutes.length > 0
    ? point.knownRoutes
        .slice(0, 3)
        .map((route) => `${route.toPlaceName}（${route.routeKind ?? route.name}）`)
        .join('、') + (point.knownRoutes.length > 3 ? `等 ${point.knownRoutes.length} 条` : '')
    : '尚未获知';
  const markerStyle = {
    left: `${point.x}%`,
    top: `${point.y}%`,
    '--map-label-size': `${Math.min(0.86, Math.max(0.07, 0.78 / zoom))}rem`,
    '--map-dot-size': `${Math.min(0.72, Math.max(0.06, (point.isCurrent ? 0.72 : 0.48) / zoom))}rem`,
    '--map-marker-gap': `${Math.min(0.35, Math.max(0.04, 0.35 / zoom))}rem`,
    '--map-inverse-zoom': `${1 / zoom}`,
    '--map-dot-halo': `${Math.min(0.22, Math.max(0.025, 0.18 / zoom))}rem`,
    '--map-dot-glow': `${Math.min(0.85, Math.max(0.08, 0.7 / zoom))}rem`,
  } as React.CSSProperties & Record<string, string>;

  return (
    <button
      type="button"
      className={`map-v2-marker ${point.isCurrent ? 'map-v2-current-marker' : ''} ${selected ? 'selected' : ''} ${showLabel ? '' : 'label-hidden'} ${point.mapLayer}`}
      data-map-relevance={point.relevance}
      data-cluster-count={cluster?.count ?? 0}
      style={markerStyle}
      onClick={() => onSelect?.(point.id)}
      aria-label={point.isCurrent ? `当前位置：${point.name}` : point.name}
      aria-describedby={tooltipId}
    >
      <span className="map-v2-marker-dot" />
      {showLabel && <strong>{point.name}</strong>}
      {cluster && (
        <span
          className="map-v2-cluster-count"
          title={`附近另有 ${cluster.count} 个地点：${cluster.hiddenPointNames.join('、')}`}
          aria-label={`附近另有 ${cluster.count} 个地点`}
        >
          +{cluster.count}
        </span>
      )}
      <span id={tooltipId} className="map-v2-marker-tooltip" role="tooltip">
        <b>{point.name}</b>
        <span className="map-v2-marker-tooltip-row"><i>类型</i><em>{formatMapLevelLabel(point.level, '具体地点')}</em></span>
        <span className="map-v2-marker-tooltip-row"><i>所属州郡</i><em>{point.displayPath || point.name}</em></span>
        <span className="map-v2-marker-tooltip-row"><i>路线</i><em>{routeText}</em></span>
        <span className="map-v2-marker-tooltip-row"><i>已知控制方</i><em>{point.knownControl ?? '尚未获知'}</em></span>
      </span>
    </button>
  );
}

function RouteRow({ route, label }: { route: MapPanelRouteSummary; label: string }) {
  return (
    <div className="map-panel-route" data-testid="map-panel-route">
      <div className="map-panel-route-grid">
        <div className="map-panel-route-primary">
          <div className="map-panel-route-main">
            <div>
              <strong>{route.name}</strong>
              <span>前往 {route.toPlaceName}</span>
            </div>
            <em>{label}</em>
          </div>
          <p>{route.toPath}</p>
          <div className="map-panel-route-meta">
            {route.routeKind && <span>{route.routeKind}</span>}
            <span>{cleanRouteText(route.status) ?? '状态未明'}</span>
            <span>{route.knownLevel}</span>
            {typeof route.riskLevel === 'number' && <span>风险 {route.riskLevel}</span>}
            {route.travelTimeText && <span>{route.travelTimeText}</span>}
            {!route.travelTimeText && typeof route.standardTravelMinutes === 'number' && (
              <span>约 {route.standardTravelMinutes} 分钟</span>
            )}
            {!route.travelTimeText && typeof route.standardTravelMinutes !== 'number' && <span>耗时未明</span>}
          </div>
          {route.notes && <p>{cleanRouteText(route.notes)}</p>}
        </div>

        <div className="map-panel-route-detail">
          <div className="map-panel-route-detail-block">
            <span>目的地简介</span>
            <p>{route.toPlaceSummary ?? '暂无目的地简介，后续可由世界书或剧情写回。'}</p>
          </div>
          <div className="map-panel-route-detail-block">
            <span>由此可往</span>
            {route.onwardRoutes.length > 0 ? (
              <div className="map-panel-onward-list">
                {route.onwardRoutes.map((onward) => (
                  <span
                    key={onward.routeId}
                    className="map-panel-onward-chip"
                    title={[
                      onward.routeKind,
                      cleanRouteText(onward.status),
                      onward.travelTimeText ?? (
                        typeof onward.standardTravelMinutes === 'number'
                          ? `约 ${onward.standardTravelMinutes} 分钟`
                          : undefined
                      ),
                    ].filter(Boolean).join(' · ')}
                  >
                    {onward.toPlaceName}
                  </span>
                ))}
              </div>
            ) : (
              <p>暂无已登记后续路线。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const MAP_LEVEL_LABELS: Record<string, string> = {
  world: '天下',
  realm: '天下',
  region: '区域',
  province: '州',
  state: '州',
  commandery: '郡',
  county: '县',
  city: '城邑',
  town: '城镇',
  village: '村落',
  place: '具体地点',
  location: '具体地点',
  scene: '场景',
  camp: '营地',
  military_camp: '军营',
  fort: '关塞',
  pass: '关隘',
  ferry: '渡口',
  port: '港口',
  dock: '船坞',
  estate: '宅邸',
  residence: '居所',
  manor: '庄园',
  building: '建筑',
  room: '室内场景',
};

function formatMapLevelLabel(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  const mapped = MAP_LEVEL_LABELS[normalized.toLowerCase().replace(/[-\s]+/g, '_')];
  if (mapped) return mapped;
  if (/^[\x00-\x7F]+$/.test(normalized)) return fallback;
  return normalized;
}

function formatMapEntityName(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  if (/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/i.test(normalized)) return fallback;
  return normalized;
}

function getMapPointRoleLabel(point: MapVisualPoint): string {
  if (point.isCurrent) return '当前位置';
  if (point.relevance === 'nearbyRoute') return '可移动目标';
  if (point.relevance === 'dynamic') return '剧情地点';
  if (point.relevance === 'core') return '重点城邑';
  if (point.mapLayer === 'region') return '区域';
  return '已知地点';
}

function cleanRouteText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value
    .replace(/，?耗时待确认/g, '')
    .replace(/标准耗时待 LLM 亲历或确认后结构化写回。?/g, '待亲历后补全细节。')
    .replace(/待 LLM 亲历或确认后结构化写回/g, '待亲历后补全细节')
    .replace(/LLM/g, '剧情')
    .trim();
  return text.length > 0 ? text : undefined;
}
