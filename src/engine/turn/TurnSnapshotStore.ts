import type {
  TurnRollbackSnapshot,
  TurnRollbackSnapshotInput,
} from './TurnRollback';
import {
  cloneRollbackSnapshot,
  createTurnRollbackSnapshot,
} from './TurnRollback';
import {
  idbDelete,
  idbPut,
  withLocalTransaction,
} from '../storage/IndexedDbStore';
import {
  CURRENT_RUNTIME_STATE_MIGRATION_VERSION,
  assertRuntimeStateMigrationVersionSupported,
} from '../state/RuntimeStateMigration';
import { hasPersistenceValueChanged } from '../state/persistenceChange';

export interface StoredTurnSnapshot {
  id: string;
  saveId: string;
  turnNumber: number;
  snapshot: TurnRollbackSnapshotInput & { runtimeStateMigrationVersion?: number };
  createdAt: string;
  runtimeStateMigrationVersion?: number;
}

export interface LoadedTurnSnapshot extends Omit<StoredTurnSnapshot, 'snapshot'> {
  snapshot: TurnRollbackSnapshot;
}

export interface SaveTurnSnapshotInput {
  saveId: string;
  turnNumber: number;
  snapshot: TurnRollbackSnapshotInput;
  maxDepth: number;
}

export async function saveTurnSnapshot(input: SaveTurnSnapshotInput): Promise<void> {
  if (input.maxDepth <= 0) {
    await clearTurnSnapshotsForSave(input.saveId);
    return;
  }

  const snapshot = createTurnRollbackSnapshot(input.snapshot);
  await idbPut('turnSnapshots', {
    id: buildSnapshotId(input.saveId, input.turnNumber),
    saveId: input.saveId,
    turnNumber: input.turnNumber,
    snapshot,
    createdAt: snapshot.createdAt,
    runtimeStateMigrationVersion: snapshot.runtimeStateMigrationVersion,
  } satisfies StoredTurnSnapshot);

  await pruneTurnSnapshots(input.saveId, input.maxDepth);
}

export async function loadTurnSnapshot(saveId: string, turnNumber: number): Promise<LoadedTurnSnapshot | null> {
  return withLocalTransaction(
    ['turnSnapshots'],
    'readwrite',
    async ({ store, request }) => {
      const snapshots = store('turnSnapshots');
      const record = await request<StoredTurnSnapshot | undefined>(
        snapshots.get(buildSnapshotId(saveId, turnNumber)),
      );
      if (!record) return null;
      const migration = normalizeStoredSnapshot(record);
      if (migration.changed) await request(snapshots.put(migration.record));
      return cloneStoredSnapshot(migration.record);
    },
  );
}

export async function listTurnSnapshots(saveId: string): Promise<LoadedTurnSnapshot[]> {
  return withLocalTransaction(
    ['turnSnapshots'],
    'readwrite',
    async ({ store, request }) => {
      const snapshots = store('turnSnapshots');
      const records = await request<StoredTurnSnapshot[]>(snapshots.getAll());
      const migrations = records
        .filter((record) => record.saveId === saveId)
        .sort((a, b) => a.turnNumber - b.turnNumber)
        .map(normalizeStoredSnapshot);
      const writes = migrations
        .filter((migration) => migration.changed)
        .map((migration) => request(snapshots.put(migration.record)));
      await Promise.all(writes);
      return migrations.map((migration) => cloneStoredSnapshot(migration.record));
    },
  );
}

export async function deleteTurnSnapshotsAfter(saveId: string, turnNumber: number): Promise<void> {
  const records = await listTurnSnapshots(saveId);
  await Promise.all(
    records
      .filter((record) => record.turnNumber > turnNumber)
      .map((record) => idbDelete('turnSnapshots', record.id)),
  );
}

export async function clearTurnSnapshotsForSave(saveId: string): Promise<void> {
  const records = await listTurnSnapshots(saveId);
  await Promise.all(records.map((record) => idbDelete('turnSnapshots', record.id)));
}

async function pruneTurnSnapshots(saveId: string, maxDepth: number): Promise<void> {
  const records = await listTurnSnapshots(saveId);
  const extraCount = records.length - maxDepth;
  if (extraCount <= 0) return;

  await Promise.all(records.slice(0, extraCount).map((record) => idbDelete('turnSnapshots', record.id)));
}

function buildSnapshotId(saveId: string, turnNumber: number): string {
  return `${saveId}:${turnNumber}`;
}

function cloneStoredSnapshot(record: StoredTurnSnapshot): LoadedTurnSnapshot {
  return {
    ...record,
    snapshot: cloneRollbackSnapshot(record.snapshot as TurnRollbackSnapshot),
  };
}

function normalizeStoredSnapshot(
  record: StoredTurnSnapshot,
): { record: StoredTurnSnapshot; changed: boolean } {
  assertRuntimeStateMigrationVersionSupported(record.runtimeStateMigrationVersion);
  assertRuntimeStateMigrationVersionSupported(record.snapshot.runtimeStateMigrationVersion);
  if (record.runtimeStateMigrationVersion === CURRENT_RUNTIME_STATE_MIGRATION_VERSION
    && record.snapshot.runtimeStateMigrationVersion === CURRENT_RUNTIME_STATE_MIGRATION_VERSION) {
    return { record, changed: false };
  }

  const snapshot = createTurnRollbackSnapshot(record.snapshot);
  const migrated: StoredTurnSnapshot = {
    ...record,
    snapshot,
    runtimeStateMigrationVersion: snapshot.runtimeStateMigrationVersion,
  };
  return {
    record: migrated,
    changed: hasPersistenceValueChanged(record, migrated),
  };
}
