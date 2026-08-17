import type {
  EncounterActionLogEntry,
  EncounterEnvironmentTag,
  EncounterOutcome,
  EncounterSide,
  SemanticProjection,
  TraitSemanticProfile,
  TroopSemanticProfile,
  UniqueArtSemanticProfile,
  WarStartIntent,
} from './EncounterContracts';
import type { EncounterRandomSnapshot } from './EncounterDeterminism';
import type { CharacterTrait, CharacterUniqueArt } from '../types/actor';
import type { TroopLedgerEntry } from '../types/luanshi';
import type { GameDifficultyLevel } from '../types/runtimeState';

export const WAR_TACTICS = [
  'steady_advance',
  'all_out_assault',
  'hold_position',
  'flank',
] as const;

export type WarTactic = typeof WAR_TACTICS[number];

export interface WarCommanderSource {
  id?: string;
  npcId?: string;
  name: string;
  abilityScores?: Record<string, number>;
  traits?: CharacterTrait[];
  uniqueArts?: CharacterUniqueArt[];
}

export interface WarProjectionBundle {
  profiles: SemanticProjection[];
}

export interface WarCommanderSnapshot {
  actorId: string;
  name: string;
  leadership: number;
  leadershipKnown?: boolean;
  intelligence: number;
  martial: number;
  charm: number;
  politics: number;
  weightedScore: number;
  traitProfiles: TraitSemanticProfile[];
  uniqueArtProfiles: UniqueArtSemanticProfile[];
  uniqueArtLabels?: Record<string, string>;
}

export type WarOfficerRole = 'troop_leader' | 'deputy' | 'strategist';

export interface WarOfficerSource {
  source: WarCommanderSource;
  role: WarOfficerRole;
  troopIds: string[];
}

export interface WarOfficerSnapshot extends WarCommanderSnapshot {
  role: WarOfficerRole;
  troopIds: string[];
}

export interface WarForceSnapshot {
  troopId: string;
  name: string;
  side: EncounterSide;
  stableOrder: number;
  /** 原建制可战规模；局部投入结算时不得被参战分队剩余人数直接覆盖。 */
  sourceStrength?: number;
  initialStrength: number;
  commitmentKind?: 'full' | 'detachment';
  morale: number;
  training: number;
  quality: number;
  readiness: number;
  supply: number;
  supplyKnown: boolean;
  supplySource: 'numeric' | 'duration' | 'status' | 'unknown';
  fatigue: number;
  sourceLifecycleStatus: 'active' | 'unknown';
  primaryClass: TroopSemanticProfile['primaryClass'];
  tags: TroopSemanticProfile['tags'];
  troopProfile?: TroopSemanticProfile;
}

export interface WarEncounterSnapshot {
  snapshotVersion: 1 | 2 | 3;
  snapshotHash: string;
  sessionId: string;
  intent: WarStartIntent;
  seed: string;
  playerLevel: number;
  /** Frozen per-save war difficulty. Legacy snapshots default to standard. */
  warDifficulty?: GameDifficultyLevel;
  objective: WarStartIntent['objective'];
  environmentTags: EncounterEnvironmentTag[];
  forces: WarForceSnapshot[];
  commanders: {
    player?: WarCommanderSnapshot;
    enemy?: WarCommanderSnapshot;
  };
  /** War V2.1：仅包含实际参战建制关联的随军人员；旧 V2.0 快照缺省。 */
  officers?: {
    player: WarOfficerSnapshot[];
    enemy: WarOfficerSnapshot[];
  };
  /** War V2.3 的会战背景只提供受限支援/压力，不进入玩家直接操作部队。 */
  theaterContext?: {
    commandScope: NonNullable<WarStartIntent['participation']>['commandScope'];
    mission: NonNullable<WarStartIntent['participation']>['mission'];
    alliedMainForceIds: string[];
    enemyMainForceIds: string[];
    alliedEstimatedStrength: number;
    enemyEstimatedStrength: number;
    playerSupportFactor: number;
    enemySupportFactor: number;
    superiorCommanderActorId?: string;
  };
}

export type WarTroopSource = TroopLedgerEntry;

export type WarForceLifecycleStatus = 'active' | 'routed' | 'surrendered' | 'destroyed';

export interface WarRuntimeForce {
  troopId: string;
  side: EncounterSide;
  stableOrder: number;
  initialStrength: number;
  remainingStrength: number;
  casualties: number;
  capturedCount: number;
  morale: number;
  supply: number;
  fatigue: number;
  lifecycleStatus: WarForceLifecycleStatus;
  statuses: string[];
}

export type WarRoundOrder =
  | { type: 'tactic'; tactic: WarTactic }
  | { type: 'war_art'; artId: string };

export interface WarRoundOrders {
  player: WarRoundOrder;
  enemy: WarRoundOrder;
}

export type WarPendingDecision =
  | {
      kind: 'pursuit';
      decidingSide: EncounterSide;
      fleeingSide: EncounterSide;
    }
  | {
      kind: 'surrender_offer';
      decidingSide: EncounterSide;
      offeringSide: EncounterSide;
    };

export type WarDecision =
  | { choice: 'pursue' }
  | { choice: 'stop_pursuit' }
  | { choice: 'accept_surrender' }
  | { choice: 'reject_surrender' };

export type WarExitReason =
  | 'objective_achieved'
  | 'force_routed'
  | 'force_destroyed'
  | 'retreat'
  | 'surrender'
  | 'round_limit';

export type WarAutoPauseReason =
  | 'low_morale'
  | 'low_supply'
  | 'force_routed'
  | 'decision_required'
  | 'fatal_risk'
  | 'round_limit';

export interface WarPursuitState {
  status: 'not_available' | 'pending' | 'declined' | 'resolved';
  pursuingSide?: EncounterSide;
  fleeingSide?: EncounterSide;
  extraCasualties: number;
  extraCaptured: number;
}

export interface WarEngineState {
  snapshot: WarEncounterSnapshot;
  phase: 'awaiting_round' | 'awaiting_decision' | 'auto_paused' | 'resolved';
  round: number;
  forces: WarRuntimeForce[];
  usedWarArt: Partial<Record<EncounterSide, string>>;
  effectUsage: Record<string, number>;
  randomState: EncounterRandomSnapshot;
  actionLog: EncounterActionLogEntry[];
  pendingDecision?: WarPendingDecision;
  outcome?: EncounterOutcome;
  objectiveAchieved: boolean;
  exitReason?: WarExitReason;
  pursuit: WarPursuitState;
  autoPauseReason?: WarAutoPauseReason;
}
