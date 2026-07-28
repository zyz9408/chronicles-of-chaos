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
  intelligence: number;
  martial: number;
  charm: number;
  politics: number;
  weightedScore: number;
  traitProfiles: TraitSemanticProfile[];
  uniqueArtProfiles: UniqueArtSemanticProfile[];
}

export interface WarForceSnapshot {
  troopId: string;
  name: string;
  side: EncounterSide;
  stableOrder: number;
  initialStrength: number;
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
  snapshotVersion: 1;
  snapshotHash: string;
  sessionId: string;
  intent: WarStartIntent;
  seed: string;
  objective: WarStartIntent['objective'];
  environmentTags: EncounterEnvironmentTag[];
  forces: WarForceSnapshot[];
  commanders: {
    player?: WarCommanderSnapshot;
    enemy?: WarCommanderSnapshot;
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
