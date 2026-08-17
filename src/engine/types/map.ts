// ============================================================
// Engine Core Types - Map
// 通用地图类型，使用 Region/Settlement/Location 等通用概念
// ============================================================

export type MapLayerKind = 'region' | 'place' | 'scene';

export interface RuntimeLocationWriteDiagnostic {
  code: 'location-canonical-ambiguous'
    | 'location-canonical-scope-conflict'
    | 'location-kind-malformed'
    | 'location-parent-unresolved'
    | 'location-writeback-rolled-back';
  message: string;
  incomingLocationId: string;
  candidateIds: string[];
  suggestionIndex?: number;
}

/** 地图节点 - Map V1 中必须显式标记区域、具体地点或场景 */
export interface MapNode {
  id: string;
  name: string;
  aliases?: string[];
  level: string;             // 对应 Ontology 中的 regionLevels
  mapLayer?: MapLayerKind;   // region=区域容器，place=可站立具体地点，scene=地点内场景
  summary: string;
  connectedRegionIds: string[];
  controlHint: string;       // 控制势力提示
  tensionHint: string;       // 紧张程度提示
  subLocations?: MapNode[];  // 子地点
  parentId?: string;
  /** 运行时亲历地点的本局留存语义；世界书静态节点无需填写。 */
  runtimePersistence?: 'permanent' | 'visited-temporary';
  /** 首次由结构化移动确认的游戏内时间。 */
  discoveredAt?: string;
  /** 亲历地点即使后来关闭或废弃也保留节点，只改变可用状态。 */
  availability?: 'active' | 'closed' | 'destroyed' | 'abandoned';
}

/** Map V1 路线边 - 只允许连接具体地点层，不连接区域或场景 */
export interface MapRouteEdgeV1 {
  routeId: string;
  fromPlaceId: string;
  toPlaceId: string;
  name: string;
  routeKind?: string;
  status: string;
  source: 'worldbook' | 'llm' | 'player' | 'system';
  knownLevel: '亲历' | '听闻' | '推测';
  riskLevel?: number;
  standardTravelMinutes?: number;
  travelTimeText?: string;
  notes?: string;
}

/** 势力资料种子 - 兼容旧世界书；自定义开局不会自动写入当前势力账本 */
export interface FactionSeed {
  id: string;
  name: string;
  factionType: string;       // 对应 Ontology 中的 factionTypes
  summary: string;
  controlHints: string[];
  attitudeHints: string[];
}
