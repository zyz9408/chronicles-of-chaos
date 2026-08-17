import type { RuntimeState } from '../types';
import {
  CURRENT_RUNTIME_STATE_MIGRATION_VERSION,
  assertRuntimeStateMigrationVersionSupported,
  assertRuntimeStateVersionSupported,
  migrateRuntimeStateForPersistence,
  type RuntimeStateMigrationDiagnostic,
} from '../state/RuntimeStateMigration';
import { normalizeNarrativePerspective } from '../settings/NarrativePerspective';

declare const normalizedTurnRollbackSnapshot: unique symbol;

export interface TurnRollbackSnapshotInput {
  beforeState: RuntimeState;
  actionText: string;
  createdAt: string;
}

export interface TurnRollbackSnapshot extends TurnRollbackSnapshotInput {
  runtimeStateMigrationVersion: number;
  runtimeStateMigrationDiagnostics?: RuntimeStateMigrationDiagnostic[];
  readonly [normalizedTurnRollbackSnapshot]: true;
}

export interface RestoredTurnRollback {
  state: RuntimeState;
  actionText: string;
}

export function createTurnRollbackSnapshot(input: TurnRollbackSnapshotInput): TurnRollbackSnapshot {
  const migration = migrateRuntimeStateForPersistence(cloneState(input.beforeState));
  return {
    beforeState: migration.state,
    actionText: input.actionText,
    createdAt: input.createdAt,
    runtimeStateMigrationVersion: migration.complete
      ? CURRENT_RUNTIME_STATE_MIGRATION_VERSION
      : CURRENT_RUNTIME_STATE_MIGRATION_VERSION - 1,
    runtimeStateMigrationDiagnostics: migration.diagnostics.length > 0
      ? migration.diagnostics
      : undefined,
  } as TurnRollbackSnapshot;
}

export function restoreTurnRollbackSnapshot(
  snapshot: TurnRollbackSnapshot,
  currentState: RuntimeState,
): RestoredTurnRollback {
  const normalizedSnapshot = cloneRollbackSnapshot(snapshot);
  return {
    state: {
      ...cloneState(normalizedSnapshot.beforeState),
      narrativePerspective: normalizeNarrativePerspective(currentState.narrativePerspective),
    },
    actionText: normalizedSnapshot.actionText,
  };
}

export function cloneRollbackSnapshot(snapshot: TurnRollbackSnapshot): TurnRollbackSnapshot {
  assertRuntimeStateMigrationVersionSupported(snapshot.runtimeStateMigrationVersion);
  assertRuntimeStateVersionSupported(snapshot.beforeState.engineVersion);
  if (snapshot.runtimeStateMigrationVersion !== CURRENT_RUNTIME_STATE_MIGRATION_VERSION) {
    return createTurnRollbackSnapshot(snapshot);
  }
  return {
    beforeState: cloneState(snapshot.beforeState),
    actionText: snapshot.actionText,
    createdAt: snapshot.createdAt,
    runtimeStateMigrationVersion: snapshot.runtimeStateMigrationVersion,
    runtimeStateMigrationDiagnostics: snapshot.runtimeStateMigrationDiagnostics
      ? snapshot.runtimeStateMigrationDiagnostics.map((diagnostic) => ({
          ...diagnostic,
          locationIds: diagnostic.locationIds ? [...diagnostic.locationIds] : undefined,
        }))
      : undefined,
  } as TurnRollbackSnapshot;
}

export function cloneState(state: RuntimeState): RuntimeState {
  return JSON.parse(JSON.stringify(state)) as RuntimeState;
}
