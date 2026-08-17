// ============================================================
// Engine Core Types - RuntimeState
// ============================================================

import type { Actor, Rumor, Quest, Relationship } from './actor';
import type {
  CalendarEraEntry,
  BondThreadEntry,
  CorrespondenceCommitment,
  CorrespondenceEntry,
  ConflictRecord,
  CombatRecord,
  CourtLedger,
  DomesticReportEntry,
  FactionLedgerEntry,
  HeroineThreadEntry,
  HoldingLedgerEntry,
  HoldingGovernanceProjectEntry,
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
  HeavyCavalryFormationProjectEntry,
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

export type GameDifficultyLevel = 'story' | 'easy' | 'standard' | 'hard' | 'brutal';
export type NarrativePerspective = 'first_person' | 'second_person' | 'third_person';

export interface PassiveUniqueArtTurnSettlement {
  /** Deterministic previous-clock -> current-clock key used to prevent double settlement. */
  turnKey: string;
  artIds: string[];
  hpRecovered: number;
  staminaRecovered: number;
}

/** 运行时状态 - 所有游戏世界当前状态的单一数据源 */
export interface RuntimeState {
  engineVersion: string;
  worldBookId: string;
  worldBookVersion: string;
  worldBookSource: 'official' | 'custom';
  /** 本存档难度；旧存档缺省时按 standard 归一。 */
  gameDifficulty?: GameDifficultyLevel;
  /** 本存档个人战难度；只作用于之后新建立的 Combat V2 快照。 */
  combatDifficulty?: GameDifficultyLevel;
  /** 本存档战争难度；只作用于之后新建立的 War V2 快照。 */
  warDifficulty?: GameDifficultyLevel;
  /** 本存档正文叙事人称；旧存档缺省时按 second_person 归一。 */
  narrativePerspective?: NarrativePerspective;
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
  holdingGovernanceProjects?: HoldingGovernanceProjectEntry[];
  privateAssets?: PrivateAssetEntry[];
  privateAssetProjects?: PrivateAssetProjectEntry[];
  domesticReports?: DomesticReportEntry[];
  factions?: FactionLedgerEntry[];
  troops?: TroopLedgerEntry[];
  heavyCavalryFormationProjects?: HeavyCavalryFormationProjectEntry[];
  court?: CourtLedger;
  situationOverview?: SituationOverview;
  plotPlan?: PlotPlanEntry[];
  worldTrends?: WorldTrendEntry[];
  conflicts?: ConflictRecord[];
  combatRecords?: CombatRecord[];
  npcAwarenessIndex?: NpcAwarenessEntry[];
  heroineThreads?: HeroineThreadEntry[];
  bondThreads?: BondThreadEntry[];
  /** 玩家与 NPC 的双向书信账本；全文只在此保存。 */
  correspondence?: CorrespondenceEntry[];
  /** 由已送达书信明确成立、等待本地到期结算的承诺。 */
  correspondenceCommitments?: CorrespondenceCommitment[];
  /** Combat / War V2 persistence boundary. Never contains a live mid-combat engine state. */
  encounterV2?: EncounterRuntimeLedger;
  /** Latest normal-turn passive unique-art settlement. Older saves may omit it. */
  passiveUniqueArtTurnSettlement?: PassiveUniqueArtTurnSettlement;
}
