// ============================================================
// Engine Core Types - RuntimeState
// ============================================================

import type { Actor, Rumor, Quest, Relationship } from './actor';
import type {
  CalendarEraEntry,
  BondThreadEntry,
  ConflictRecord,
  CombatRecord,
  CourtLedger,
  DomesticReportEntry,
  FactionLedgerEntry,
  HeroineThreadEntry,
  HoldingLedgerEntry,
  LocationLedgerEntry,
  LuanShiNpc,
  NpcAwarenessEntry,
  PlotPlanEntry,
  PrivateAssetEntry,
  PrivateAssetProjectEntry,
  ResourceLedger,
  RouteLedgerEntry,
  SituationOverview,
  TroopLedgerEntry,
  TurnEventRecord,
  WorldTrendEntry,
} from './luanshi';
import type { StatePatch } from './statePatch';
import type { TurnLogEntry } from './turn';
import type { MemoryArchive } from './memory';
import type { GameClock } from '../time/gameClock';
import type { MapNode, MapRouteEdgeV1 } from './map';
import type { HistoricalAnchorStateEntry, WorldlineRuntimeSettings } from './worldline';
import type { EncounterRuntimeLedger } from '../encounterV2/EncounterContracts';

/** 运行时状态 - 所有游戏世界当前状态的单一数据源 */
export interface RuntimeState {
  engineVersion: string;
  worldBookId: string;
  worldBookVersion: string;
  worldBookSource: 'official' | 'custom';
  worldlineSettings?: WorldlineRuntimeSettings;
  /** 已被本局结构化事实确认的历史锚点终态；KnowledgeBase 本身始终只读。 */
  worldlineAnchorStates?: HistoricalAnchorStateEntry[];
  startBookmarkId?: string;
  startDate: string;
  currentDate: string;
  currentTime?: GameClock;
  calendarEras?: CalendarEraEntry[];
  player: Actor;
  currentLocationId: string;
  /** 当前具体地点，路线只连接这一层；兼容期等同 currentLocationId。 */
  currentPlaceId?: string;
  /** 当前具体地点内部的场景，例如县衙、市集、客舍。 */
  currentSceneId?: string;
  knownActors: Actor[];
  knownFactions: string[];       // faction IDs
  relationships: Relationship[];
  knownRumors: Rumor[];
  activeQuests: Quest[];
  playerResources: Record<string, number>;
  worldStateDelta: Record<string, unknown>;
  turnLog: TurnLogEntry[];
  memoryArchive?: MemoryArchive;
  lastStatePatch?: StatePatch;
  lastPatchValidation?: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
  currentCrisisId?: string;
  localSituationNotes: string[];
  npcs?: LuanShiNpc[];
  turnEvents?: TurnEventRecord[];
  locations?: LocationLedgerEntry[];
  routes?: RouteLedgerEntry[];
  /** Map V1 运行时新增地点。世界书种子不复制进来，只保存 LLM/玩家确认后的增量节点。 */
  mapNodes?: MapNode[];
  /** Map V1 运行时路线。路线只连接具体地点层，不连接区域或场景。 */
  routeEdges?: MapRouteEdgeV1[];
  resources?: ResourceLedger;
  holdings?: HoldingLedgerEntry[];
  privateAssets?: PrivateAssetEntry[];
  privateAssetProjects?: PrivateAssetProjectEntry[];
  domesticReports?: DomesticReportEntry[];
  factions?: FactionLedgerEntry[];
  troops?: TroopLedgerEntry[];
  court?: CourtLedger;
  situationOverview?: SituationOverview;
  plotPlan?: PlotPlanEntry[];
  worldTrends?: WorldTrendEntry[];
  conflicts?: ConflictRecord[];
  combatRecords?: CombatRecord[];
  npcAwarenessIndex?: NpcAwarenessEntry[];
  heroineThreads?: HeroineThreadEntry[];
  bondThreads?: BondThreadEntry[];
  /** Combat / War V2 persistence boundary. Never contains a live mid-combat engine state. */
  encounterV2?: EncounterRuntimeLedger;
}
