// ============================================================
// Engine - SaveManager
// IndexedDB 存档系统
// ============================================================

import type { SaveData, SaveKind, SaveListItem, RuntimeState, TurnDisplayMeta } from '../types';
import {
  CURRENT_RUNTIME_STATE_MIGRATION_VERSION,
  CURRENT_RUNTIME_STATE_VERSION,
  assertRuntimeStateMigrationVersionSupported,
  assertRuntimeStateVersionSupported,
  migrateRuntimeStateForPersistence,
  type RuntimeStateMigrationResult,
} from '../state/RuntimeStateMigration';
import { hasPersistenceValueChanged } from '../state/persistenceChange';
import {
  idbClear,
  idbDeleteMeta,
  idbGetAll,
  idbGetMeta,
  idbSetMeta,
  withLocalTransaction,
} from '../storage/IndexedDbStore';
import { v4 as uuidv4 } from '../turn/uuid';
import type { StoredTurnSnapshot } from '../turn/TurnSnapshotStore';
import { listTurnSnapshots } from '../turn/TurnSnapshotStore';
import {
  createTurnRollbackSnapshot,
  type TurnRollbackSnapshotInput,
} from '../turn/TurnRollback';
import { assertEncounterPersistenceAllowed } from '../encounterV2/EncounterRuntimeIntegration';

const SAVE_KEY_PREFIX = 'coc_v2_save_';
const SAVE_LIST_KEY = 'coc_v2_save_list';
const LAST_SAVE_KEY = 'coc_v2_last_save_id';
const LAST_SAVE_META_KEY = 'lastSaveId';
const LEGACY_MIGRATION_META_KEY = 'legacySavesMigratedFromLocalStorage';
const SAVE_SUMMARY_INDEX_META_KEY = 'saveSummaryIndexReadyV1';
const DEVELOPER_OVERRIDE_CHECKPOINT_META_PREFIX = 'developerOverrideCheckpoint:';
const RUNTIME_VARIABLE_CHECKPOINT_META_PREFIX = 'runtimeVariableCheckpoint:';
const PERSISTED_FULL_TURN_DIAGNOSTIC_LIMIT = 5;

export interface SaveArchive {
  schema: 'coc.v2.saves';
  version: 1 | 2;
  exportedAt: string;
  lastSaveId: string | null;
  saves: SaveData[];
  turnSnapshots?: StoredTurnSnapshot[];
}

export interface ImportSavesOptions {
  mode?: 'merge' | 'replace';
}

export interface SaveMutationOptions {
  signal?: AbortSignal;
}

export interface AtomicTurnCommitResult {
  save: SaveData;
  snapshotTurnNumbers: number[];
  autoSaveCreated?: SaveData;
}

interface PreparedSaveArchive {
  version: 1 | 2;
  lastSaveId: string | null;
  saves: SaveData[];
  turnSnapshots: StoredTurnSnapshot[];
}

export interface CommitSuccessfulTurnInput extends SaveMutationOptions {
  saveId: string;
  runtimeState: RuntimeState;
  turnNumber: number;
  snapshot: TurnRollbackSnapshotInput;
  maxDepth: number;
  autoSave?: {
    intervalTurns: number;
    limit: number;
  };
}

export interface CommitTurnRestoreInput extends SaveMutationOptions {
  saveId: string;
  runtimeState: RuntimeState;
  deleteSnapshotsAfterTurn: number;
}

export interface DeveloperOverrideCheckpoint {
  version: 1;
  saveId: string;
  commandText: string;
  createdAt: string;
  committedStateFingerprint: string;
  runtimeState: RuntimeState;
}

export interface CommitDeveloperOverrideInput extends SaveMutationOptions {
  saveId: string;
  previousRuntimeState: RuntimeState;
  runtimeState: RuntimeState;
  commandText: string;
}

export interface CommitDeveloperOverrideResult {
  save: SaveData;
  checkpoint: DeveloperOverrideCheckpoint;
}

export interface RuntimeVariableCheckpoint {
  version: 1;
  saveId: string;
  summary: string;
  createdAt: string;
  committedStateFingerprint: string;
  runtimeState: RuntimeState;
}

export interface CommitRuntimeVariableEditInput extends SaveMutationOptions {
  saveId: string;
  previousRuntimeState: RuntimeState;
  runtimeState: RuntimeState;
  summary: string;
}

export interface CommitRuntimeVariableEditResult {
  save: SaveData;
  checkpoint: RuntimeVariableCheckpoint;
}

/**
 * 新建存档
 */
export async function createSave(
  runtimeState: RuntimeState,
  label?: string,
  options: SaveMutationOptions = {},
): Promise<SaveData> {
  assertEncounterPersistenceAllowed(runtimeState);
  await ensureLegacySavesMigrated();
  throwIfSignalAborted(options.signal);

  const save = buildSave(runtimeState, label, 'auto');
  await withLocalTransaction(
    ['saves', 'saveSummaries', 'meta'],
    'readwrite',
    async ({ store, request }) => {
      await Promise.all([
        request(store('saves').put(normalizeSaveData(save))),
        request(store('saveSummaries').put(toSaveListItem(save))),
        request(store('meta').put({ key: LAST_SAVE_META_KEY, value: save.id })),
      ]);
    },
    options,
  );

  return save;
}

/**
 * 新建手动存档（不改变继续最近存档指针）
 */
export async function createManualSave(
  runtimeState: RuntimeState,
  label?: string,
): Promise<SaveData> {
  assertEncounterPersistenceAllowed(runtimeState);
  await ensureLegacySavesMigrated();

  const save = buildSave(runtimeState, label, 'manual');

  await saveToIndexedDb(save);

  return save;
}

/**
 * 保存当前状态（覆盖现有存档）
 */
export async function saveCurrentState(
  saveId: string,
  runtimeState: RuntimeState,
  options: SaveMutationOptions = {},
): Promise<SaveData | null> {
  assertEncounterPersistenceAllowed(runtimeState);
  await ensureLegacySavesMigrated();
  throwIfSignalAborted(options.signal);

  return withLocalTransaction(
    ['saves', 'saveSummaries', 'meta'],
    'readwrite',
    async ({ store, request }) => {
      const existing = await request<SaveData | undefined>(store('saves').get(saveId));
      if (!existing) return null;

      const next = buildUpdatedSave(existing, runtimeState);
      await Promise.all([
        request(store('saves').put(next)),
        request(store('saveSummaries').put(toSaveListItem(next))),
        request(store('meta').put({ key: LAST_SAVE_META_KEY, value: next.id })),
      ]);
      return next;
    },
    options,
  );
}

export async function commitSuccessfulTurn(
  input: CommitSuccessfulTurnInput,
): Promise<AtomicTurnCommitResult | null> {
  assertEncounterPersistenceAllowed(input.runtimeState);
  return withLocalTransaction(
    ['saves', 'saveSummaries', 'turnSnapshots', 'meta'],
    'readwrite',
    async ({ store, request }) => {
      const saves = store('saves');
      const saveSummaries = store('saveSummaries');
      const snapshots = store('turnSnapshots');
      const meta = store('meta');
      const [existing, allSaves, allSnapshots] = await Promise.all([
        request<SaveData | undefined>(saves.get(input.saveId)),
        request<SaveData[]>(saves.getAll()),
        request<StoredTurnSnapshot[]>(snapshots.getAll()),
      ]);
      if (!existing) return null;

      const nextSave = buildUpdatedSave(existing, input.runtimeState);
      const currentSnapshots = allSnapshots.filter((snapshot) => snapshot.saveId === input.saveId);
      const nextSnapshot = buildStoredTurnSnapshot(input);
      const candidates = [
        ...currentSnapshots.filter((snapshot) => snapshot.id !== nextSnapshot.id),
        nextSnapshot,
      ].sort((left, right) => left.turnNumber - right.turnNumber);
      const retainedSnapshots = input.maxDepth > 0 ? candidates.slice(-input.maxDepth) : [];
      const retainedIds = new Set(retainedSnapshots.map((snapshot) => snapshot.id));
      const snapshotWrites: Array<Promise<unknown>> = currentSnapshots
        .filter((snapshot) => !retainedIds.has(snapshot.id))
        .map((snapshot) => request(snapshots.delete(snapshot.id)));
      if (retainedIds.has(nextSnapshot.id)) {
        snapshotWrites.push(request(snapshots.put(nextSnapshot)));
      }

      const intervalTurns = normalizePositiveInteger(input.autoSave?.intervalTurns, 1);
      const autoSaveLimit = normalizePositiveInteger(input.autoSave?.limit, 20);
      const shouldCreateAutoSave = Boolean(input.autoSave)
        && input.turnNumber > 0
        && input.turnNumber % intervalTurns === 0
        && (nextSave.saveKind !== 'auto' || autoSaveLimit > 1);
      const autoSaveCreated = shouldCreateAutoSave
        ? buildSave(
            input.runtimeState,
            `${input.runtimeState.player.name || '未命名角色'} - 第${input.turnNumber}回合自动存档`,
            'auto',
          )
        : undefined;
      const autoSaveCandidates = [
        ...allSaves.filter((save) => save.id !== nextSave.id),
        nextSave,
        ...(autoSaveCreated ? [autoSaveCreated] : []),
      ].filter((save) => (save.saveKind ?? 'auto') === 'auto');
      const retainedAutoSaveIds = selectRetainedAutoSaveIds(
        autoSaveCandidates,
        autoSaveLimit,
        nextSave.saveKind === 'auto' ? nextSave.id : undefined,
        autoSaveCreated?.id,
      );
      const expiredAutoSaveIds = new Set(autoSaveCandidates
        .filter((save) => !retainedAutoSaveIds.has(save.id))
        .map((save) => save.id));
      const retainedAutoSave = autoSaveCreated && retainedAutoSaveIds.has(autoSaveCreated.id)
        ? autoSaveCreated
        : undefined;

      await Promise.all([
        ...snapshotWrites,
        ...allSnapshots
          .filter((snapshot) => expiredAutoSaveIds.has(snapshot.saveId))
          .map((snapshot) => request(snapshots.delete(snapshot.id))),
        ...[...expiredAutoSaveIds].map((saveId) => request(saves.delete(saveId))),
        ...[...expiredAutoSaveIds].map((saveId) => request(saveSummaries.delete(saveId))),
        request(saves.put(nextSave)),
        request(saveSummaries.put(toSaveListItem(nextSave))),
        ...(retainedAutoSave ? [request(saves.put(retainedAutoSave))] : []),
        ...(retainedAutoSave ? [request(saveSummaries.put(toSaveListItem(retainedAutoSave)))] : []),
        request(meta.put({ key: LAST_SAVE_META_KEY, value: nextSave.id })),
      ]);
      return {
        save: nextSave,
        snapshotTurnNumbers: retainedSnapshots.map((snapshot) => snapshot.turnNumber),
        autoSaveCreated: retainedAutoSave,
      };
    },
    input,
  );
}

export async function commitTurnRestore(
  input: CommitTurnRestoreInput,
): Promise<AtomicTurnCommitResult | null> {
  assertEncounterPersistenceAllowed(input.runtimeState);
  return withLocalTransaction(
    ['saves', 'saveSummaries', 'turnSnapshots', 'meta'],
    'readwrite',
    async ({ store, request }) => {
      const saves = store('saves');
      const saveSummaries = store('saveSummaries');
      const snapshots = store('turnSnapshots');
      const meta = store('meta');
      const [existing, allSnapshots] = await Promise.all([
        request<SaveData | undefined>(saves.get(input.saveId)),
        request<StoredTurnSnapshot[]>(snapshots.getAll()),
      ]);
      if (!existing) return null;

      const nextSave = buildUpdatedSave(existing, input.runtimeState);
      const currentSnapshots = allSnapshots.filter((snapshot) => snapshot.saveId === input.saveId);
      const retainedSnapshots = currentSnapshots
        .filter((snapshot) => snapshot.turnNumber <= input.deleteSnapshotsAfterTurn)
        .sort((left, right) => left.turnNumber - right.turnNumber);
      await Promise.all([
        ...currentSnapshots
          .filter((snapshot) => snapshot.turnNumber > input.deleteSnapshotsAfterTurn)
          .map((snapshot) => request(snapshots.delete(snapshot.id))),
        request(saves.put(nextSave)),
        request(saveSummaries.put(toSaveListItem(nextSave))),
        request(meta.put({ key: LAST_SAVE_META_KEY, value: nextSave.id })),
      ]);
      return {
        save: nextSave,
        snapshotTurnNumbers: retainedSnapshots.map((snapshot) => snapshot.turnNumber),
      };
    },
    input,
  );
}

/**
 * 原子保存开发者事实纠错及其纠错前检查点。该检查点不属于正常回合快照，
 * 不会改变回合数，也不会挤占玩家设置的重ROLL深度。
 */
export async function commitDeveloperOverride(
  input: CommitDeveloperOverrideInput,
): Promise<CommitDeveloperOverrideResult | null> {
  assertEncounterPersistenceAllowed(input.previousRuntimeState);
  assertEncounterPersistenceAllowed(input.runtimeState);
  await ensureLegacySavesMigrated();
  throwIfSignalAborted(input.signal);

  return withLocalTransaction(
    ['saves', 'saveSummaries', 'meta'],
    'readwrite',
    async ({ store, request }) => {
      const existing = await request<SaveData | undefined>(store('saves').get(input.saveId));
      if (!existing) return null;

      const next = buildUpdatedSave(existing, input.runtimeState);
      const checkpoint: DeveloperOverrideCheckpoint = {
        version: 1,
        saveId: input.saveId,
        commandText: input.commandText,
        createdAt: new Date().toISOString(),
        committedStateFingerprint: fingerprintRuntimeState(next.runtimeState),
        runtimeState: compactRuntimeStateForPersistence(input.previousRuntimeState),
      };
      await Promise.all([
        request(store('saves').put(next)),
        request(store('saveSummaries').put(toSaveListItem(next))),
        request(store('meta').put({ key: LAST_SAVE_META_KEY, value: next.id })),
        request(store('meta').put({
          key: developerOverrideCheckpointMetaKey(input.saveId),
          value: checkpoint,
        })),
      ]);
      return { save: next, checkpoint };
    },
    input,
  );
}

export async function hasRestorableDeveloperOverrideCheckpoint(saveId: string): Promise<boolean> {
  await ensureLegacySavesMigrated();
  return withLocalTransaction(
    ['saves', 'meta'],
    'readonly',
    async ({ store, request }) => {
      const [save, checkpointItem] = await Promise.all([
        request<SaveData | undefined>(store('saves').get(saveId)),
        request<{ key: string; value: DeveloperOverrideCheckpoint } | undefined>(
          store('meta').get(developerOverrideCheckpointMetaKey(saveId)),
        ),
      ]);
      return Boolean(
        save
        && checkpointItem?.value?.version === 1
        && checkpointItem.value.saveId === saveId
        && checkpointItem.value.committedStateFingerprint === fingerprintRuntimeState(save.runtimeState),
      );
    },
  );
}

export async function restoreDeveloperOverrideCheckpoint(
  saveId: string,
  options: SaveMutationOptions = {},
): Promise<SaveData | null> {
  await ensureLegacySavesMigrated();
  throwIfSignalAborted(options.signal);
  return withLocalTransaction(
    ['saves', 'saveSummaries', 'meta'],
    'readwrite',
    async ({ store, request }) => {
      const key = developerOverrideCheckpointMetaKey(saveId);
      const [existing, checkpointItem] = await Promise.all([
        request<SaveData | undefined>(store('saves').get(saveId)),
        request<{ key: string; value: DeveloperOverrideCheckpoint } | undefined>(store('meta').get(key)),
      ]);
      const checkpoint = checkpointItem?.value;
      if (!existing || !checkpoint || checkpoint.version !== 1 || checkpoint.saveId !== saveId) return null;
      if (checkpoint.committedStateFingerprint !== fingerprintRuntimeState(existing.runtimeState)) return null;

      const restored = buildUpdatedSave(existing, checkpoint.runtimeState);
      await Promise.all([
        request(store('saves').put(restored)),
        request(store('saveSummaries').put(toSaveListItem(restored))),
        request(store('meta').put({ key: LAST_SAVE_META_KEY, value: restored.id })),
        request(store('meta').delete(key)),
      ]);
      return restored;
    },
    options,
  );
}

/**
 * 原子保存一次受控变量修改及其修改前检查点。变量管理与 /dev 事实纠错各自
 * 维护独立撤销点，互不覆盖，也不占用正常回合的重ROLL快照深度。
 */
export async function commitRuntimeVariableEdit(
  input: CommitRuntimeVariableEditInput,
): Promise<CommitRuntimeVariableEditResult | null> {
  assertEncounterPersistenceAllowed(input.previousRuntimeState);
  assertEncounterPersistenceAllowed(input.runtimeState);
  await ensureLegacySavesMigrated();
  throwIfSignalAborted(input.signal);

  return withLocalTransaction(
    ['saves', 'saveSummaries', 'meta'],
    'readwrite',
    async ({ store, request }) => {
      const existing = await request<SaveData | undefined>(store('saves').get(input.saveId));
      if (!existing) return null;

      const next = buildUpdatedSave(existing, input.runtimeState);
      const checkpoint: RuntimeVariableCheckpoint = {
        version: 1,
        saveId: input.saveId,
        summary: input.summary,
        createdAt: new Date().toISOString(),
        committedStateFingerprint: fingerprintRuntimeState(next.runtimeState),
        runtimeState: compactRuntimeStateForPersistence(input.previousRuntimeState),
      };
      await Promise.all([
        request(store('saves').put(next)),
        request(store('saveSummaries').put(toSaveListItem(next))),
        request(store('meta').put({ key: LAST_SAVE_META_KEY, value: next.id })),
        request(store('meta').put({
          key: runtimeVariableCheckpointMetaKey(input.saveId),
          value: checkpoint,
        })),
      ]);
      return { save: next, checkpoint };
    },
    input,
  );
}

export async function hasRestorableRuntimeVariableCheckpoint(saveId: string): Promise<boolean> {
  await ensureLegacySavesMigrated();
  return withLocalTransaction(
    ['saves', 'meta'],
    'readonly',
    async ({ store, request }) => {
      const [save, checkpointItem] = await Promise.all([
        request<SaveData | undefined>(store('saves').get(saveId)),
        request<{ key: string; value: RuntimeVariableCheckpoint } | undefined>(
          store('meta').get(runtimeVariableCheckpointMetaKey(saveId)),
        ),
      ]);
      return Boolean(
        save
        && checkpointItem?.value?.version === 1
        && checkpointItem.value.saveId === saveId
        && checkpointItem.value.committedStateFingerprint === fingerprintRuntimeState(save.runtimeState),
      );
    },
  );
}

export async function restoreRuntimeVariableCheckpoint(
  saveId: string,
  options: SaveMutationOptions = {},
): Promise<SaveData | null> {
  await ensureLegacySavesMigrated();
  throwIfSignalAborted(options.signal);
  return withLocalTransaction(
    ['saves', 'saveSummaries', 'meta'],
    'readwrite',
    async ({ store, request }) => {
      const key = runtimeVariableCheckpointMetaKey(saveId);
      const [existing, checkpointItem] = await Promise.all([
        request<SaveData | undefined>(store('saves').get(saveId)),
        request<{ key: string; value: RuntimeVariableCheckpoint } | undefined>(store('meta').get(key)),
      ]);
      const checkpoint = checkpointItem?.value;
      if (!existing || !checkpoint || checkpoint.version !== 1 || checkpoint.saveId !== saveId) return null;
      if (checkpoint.committedStateFingerprint !== fingerprintRuntimeState(existing.runtimeState)) return null;

      const restored = buildUpdatedSave(existing, checkpoint.runtimeState);
      await Promise.all([
        request(store('saves').put(restored)),
        request(store('saveSummaries').put(toSaveListItem(restored))),
        request(store('meta').put({ key: LAST_SAVE_META_KEY, value: restored.id })),
        request(store('meta').delete(key)),
      ]);
      return restored;
    },
    options,
  );
}

/**
 * 加载指定存档
 */
export async function loadSave(saveId: string): Promise<SaveData | null> {
  await ensureLegacySavesMigrated();
  return loadSaveById(saveId);
}

/**
 * 继续最近存档
 */
export async function continueLastSave(): Promise<SaveData | null> {
  await ensureLegacySavesMigrated();

  const lastSaveId = await idbGetMeta<string>(LAST_SAVE_META_KEY);
  if (!lastSaveId) return null;

  return loadSaveById(lastSaveId);
}

/**
 * 获取所有存档列表
 */
export async function listSaves(): Promise<SaveListItem[]> {
  await ensureLegacySavesMigrated();
  await ensureSaveSummaryIndexReady();
  return (await idbGetAll<SaveListItem>('saveSummaries')).sort(compareUpdatedSaveIdentity);
}

/**
 * 删除存档
 */
export async function deleteSave(saveId: string): Promise<void> {
  await ensureLegacySavesMigrated();
  await withLocalTransaction(
    ['saves', 'saveSummaries', 'turnSnapshots', 'meta'],
    'readwrite',
    async ({ store, request }) => {
      const saves = store('saves');
      const saveSummaries = store('saveSummaries');
      const snapshots = store('turnSnapshots');
      const meta = store('meta');
      const [allSaves, allSnapshots, lastSaveMeta] = await Promise.all([
        request<SaveData[]>(saves.getAll()),
        request<StoredTurnSnapshot[]>(snapshots.getAll()),
        request<{ key: string; value: string } | undefined>(meta.get(LAST_SAVE_META_KEY)),
      ]);
      await Promise.all([
        request(saves.delete(saveId)),
        request(saveSummaries.delete(saveId)),
        ...allSnapshots
          .filter((snapshot) => snapshot.saveId === saveId)
          .map((snapshot) => request(snapshots.delete(snapshot.id))),
      ]);
      if (lastSaveMeta?.value === saveId) {
        const nextId = selectStableNewestSaveId(allSaves.filter((save) => save.id !== saveId));
        await writeLastSaveId(meta, request, nextId);
      }
    },
  );
}

export async function pruneAutoSaves(limit: number, protectedSaveId?: string): Promise<void> {
  await ensureLegacySavesMigrated();
  const normalizedLimit = normalizePositiveInteger(limit, 20);
  await withLocalTransaction(
    ['saves', 'saveSummaries', 'turnSnapshots', 'meta'],
    'readwrite',
    async ({ store, request }) => {
      const saves = store('saves');
      const saveSummaries = store('saveSummaries');
      const snapshots = store('turnSnapshots');
      const meta = store('meta');
      const [allSaves, allSnapshots, lastSaveMeta] = await Promise.all([
        request<SaveData[]>(saves.getAll()),
        request<StoredTurnSnapshot[]>(snapshots.getAll()),
        request<{ key: string; value: string } | undefined>(meta.get(LAST_SAVE_META_KEY)),
      ]);
      const autoSaves = allSaves.filter((save) => (save.saveKind ?? 'auto') === 'auto');
      const retainedIds = selectRetainedAutoSaveIds(
        autoSaves,
        normalizedLimit,
        protectedSaveId ?? lastSaveMeta?.value,
      );
      const expiredIds = new Set(autoSaves
        .filter((save) => !retainedIds.has(save.id))
        .map((save) => save.id));
      await Promise.all([
        ...[...expiredIds].map((saveId) => request(saves.delete(saveId))),
        ...[...expiredIds].map((saveId) => request(saveSummaries.delete(saveId))),
        ...allSnapshots
          .filter((snapshot) => expiredIds.has(snapshot.saveId))
          .map((snapshot) => request(snapshots.delete(snapshot.id))),
      ]);
      if (lastSaveMeta?.value && expiredIds.has(lastSaveMeta.value)) {
        const remaining = allSaves.filter((save) => !expiredIds.has(save.id));
        await writeLastSaveId(meta, request, selectStableNewestSaveId(remaining));
      }
    },
  );
}

/**
 * 清除所有存档
 */
export async function clearAllSaves(): Promise<void> {
  await ensureLegacySavesMigrated();
  await idbClear('saves');
  await idbClear('saveSummaries');
  await idbClear('turnSnapshots');
  await idbDeleteMeta(LAST_SAVE_META_KEY);
  await idbSetMeta(SAVE_SUMMARY_INDEX_META_KEY, true);
}

/** 检查是否有存档 */
export async function hasAnySave(): Promise<boolean> {
  return (await listSaves()).length > 0;
}

export async function exportSaves(): Promise<SaveArchive> {
  await ensureLegacySavesMigrated();
  const storedSaves = await idbGetAll<SaveData>('saves');
  const saves = (await Promise.all(storedSaves.map((save) => loadSaveById(save.id))))
    .filter((save): save is SaveData => Boolean(save))
    .sort(compareUpdatedSaveIdentity);
  const saveIds = new Set(saves.map((save) => save.id));
  const turnSnapshots = (await Promise.all(
    [...saveIds].map((saveId) => listTurnSnapshots(saveId)),
  )).flat()
    .sort((a, b) => a.saveId.localeCompare(b.saveId) || a.turnNumber - b.turnNumber);
  return {
    schema: 'coc.v2.saves',
    version: 2,
    exportedAt: new Date().toISOString(),
    lastSaveId: await idbGetMeta<string>(LAST_SAVE_META_KEY) ?? null,
    saves,
    turnSnapshots,
  };
}

/**
 * Build a portable archive for one local slot only.
 * Cloud sync uses this boundary so it never uploads unrelated saves,
 * generated visual assets, API settings, or embedding indexes.
 */
export async function exportSingleSave(
  saveId: string,
  maxSnapshotCount = 3,
): Promise<SaveArchive | null> {
  await ensureLegacySavesMigrated();
  const save = await loadSaveById(saveId);
  if (!save) return null;
  const snapshotLimit = Number.isSafeInteger(maxSnapshotCount)
    ? Math.max(0, Math.min(10, maxSnapshotCount))
    : 3;
  const turnSnapshots = (await listTurnSnapshots(saveId))
    .sort((left, right) => left.turnNumber - right.turnNumber)
    .slice(-snapshotLimit);
  return {
    schema: 'coc.v2.saves',
    version: 2,
    exportedAt: new Date().toISOString(),
    lastSaveId: save.id,
    saves: [save],
    turnSnapshots,
  };
}

export async function importSaves(
  archive: unknown,
  options: ImportSavesOptions = {},
): Promise<void> {
  const prepared = prepareSaveArchive(archive);
  const mode = options.mode ?? 'merge';

  await withLocalTransaction(
    ['saves', 'saveSummaries', 'turnSnapshots', 'meta'],
    'readwrite',
    async ({ store, request }) => {
      const saves = store('saves');
      const saveSummaries = store('saveSummaries');
      const snapshots = store('turnSnapshots');
      const meta = store('meta');

      if (mode === 'replace') {
        await Promise.all([
          request(saves.clear()),
          request(saveSummaries.clear()),
          request(snapshots.clear()),
        ]);
        for (const save of prepared.saves) {
          await request(saves.put(save));
          await request(saveSummaries.put(toSaveListItem(save)));
        }
        for (const snapshot of prepared.turnSnapshots) await request(snapshots.put(snapshot));
        await writeLastSaveId(meta, request, prepared.lastSaveId);
        await request(meta.put({ key: LEGACY_MIGRATION_META_KEY, value: true }));
        await request(meta.put({ key: SAVE_SUMMARY_INDEX_META_KEY, value: true }));
        return;
      }

      const [existingSaves, existingSnapshots, lastSaveMeta, migrationMeta] = await Promise.all([
        request<SaveData[]>(saves.getAll()),
        request<StoredTurnSnapshot[]>(snapshots.getAll()),
        request<{ key: string; value: string } | undefined>(meta.get(LAST_SAVE_META_KEY)),
        request<{ key: string; value: boolean } | undefined>(meta.get(LEGACY_MIGRATION_META_KEY)),
      ]);
      const legacy = migrationMeta?.value ? null : prepareLegacySavesForImport();
      const finalSaves = new Map(existingSaves.map((save) => [save.id, save]));
      for (const save of legacy?.saves ?? []) finalSaves.set(save.id, save);
      for (const save of prepared.saves) finalSaves.set(save.id, save);

      const replacedIds = new Set([
        ...(legacy?.saves ?? []),
        ...prepared.saves,
      ].map((save) => save.id));
      const incomingSnapshotIds = new Set(prepared.turnSnapshots.map((snapshot) => snapshot.id));
      for (const snapshot of existingSnapshots) {
        const willBeRemoved = replacedIds.has(snapshot.saveId) || !finalSaves.has(snapshot.saveId);
        if (!willBeRemoved && incomingSnapshotIds.has(snapshot.id)) throw invalidArchiveError();
      }
      for (const snapshot of existingSnapshots) {
        if (replacedIds.has(snapshot.saveId) || !finalSaves.has(snapshot.saveId)) {
          await request(snapshots.delete(snapshot.id));
        }
      }
      for (const save of legacy?.saves ?? []) await request(saves.put(save));
      for (const save of prepared.saves) await request(saves.put(save));
      await request(saveSummaries.clear());
      for (const save of finalSaves.values()) {
        await request(saveSummaries.put(toSaveListItem(save)));
      }
      for (const snapshot of prepared.turnSnapshots) await request(snapshots.put(snapshot));

      const previousPointer = resolvePreviousImportPointer(
        lastSaveMeta?.value,
        legacy?.lastSaveId ?? null,
        finalSaves,
      );
      const nextPointer = prepared.lastSaveId
        ?? previousPointer
        ?? selectStableNewestSaveId(finalSaves.values());
      await writeLastSaveId(meta, request, nextPointer);
      await request(meta.put({ key: LEGACY_MIGRATION_META_KEY, value: true }));
      await request(meta.put({ key: SAVE_SUMMARY_INDEX_META_KEY, value: true }));
    },
  );
}

// ===== 内部函数 =====

function prepareSaveArchive(archive: unknown): PreparedSaveArchive {
  if (!isRecord(archive)
    || archive.schema !== 'coc.v2.saves'
    || (archive.version !== 1 && archive.version !== 2)
    || !isValidDateTime(archive.exportedAt)
    || !Array.isArray(archive.saves)
    || !Object.prototype.hasOwnProperty.call(archive, 'lastSaveId')
    || (archive.lastSaveId !== null && !isNonBlankString(archive.lastSaveId))
    || (archive.version === 2 && !Array.isArray(archive.turnSnapshots))
    || (archive.version === 1
      && archive.turnSnapshots !== undefined
      && !Array.isArray(archive.turnSnapshots))) {
    throw invalidArchiveError();
  }

  const saves: SaveData[] = [];
  const saveIds = new Set<string>();
  for (const candidate of archive.saves) {
    const normalized = normalizeSaveCandidate(candidate);
    if (saveIds.has(normalized.id)) throw invalidArchiveError();
    saves.push(normalized);
    saveIds.add(normalized.id);
  }

  if (archive.lastSaveId !== null && !saveIds.has(archive.lastSaveId)) {
    throw invalidArchiveError();
  }

  const turnSnapshots: StoredTurnSnapshot[] = [];
  const snapshotIds = new Set<string>();
  const snapshotCandidates = archive.version === 2 ? archive.turnSnapshots as unknown[] : [];
  for (const candidate of snapshotCandidates) {
    const normalized = normalizeImportedSnapshot(candidate, saveIds);
    if (snapshotIds.has(normalized.id)) throw invalidArchiveError();
    snapshotIds.add(normalized.id);
    turnSnapshots.push(normalized);
  }

  return {
    version: archive.version,
    lastSaveId: archive.lastSaveId,
    saves,
    turnSnapshots,
  };
}

function normalizeImportedSnapshot(
  candidate: unknown,
  saveIds: ReadonlySet<string>,
): StoredTurnSnapshot {
  if (!isRecord(candidate)
    || !isNonBlankString(candidate.saveId)
    || !saveIds.has(candidate.saveId)
    || !Number.isInteger(candidate.turnNumber)
    || (candidate.turnNumber as number) <= 0
    || !isValidDateTime(candidate.createdAt)
    || !isRecord(candidate.snapshot)
    || !isNonBlankString(candidate.snapshot.actionText)
    || !isValidDateTime(candidate.snapshot.createdAt)) {
    throw invalidArchiveError();
  }

  const beforeStateMigration = normalizeRuntimeStateCandidate(candidate.snapshot.beforeState);

  const saveId = candidate.saveId;
  const turnNumber = candidate.turnNumber as number;
  const createdAt = candidate.snapshot.createdAt;
  const snapshot = createTurnRollbackSnapshot({
    beforeState: compactRuntimeStateForPersistence(beforeStateMigration.state),
    actionText: candidate.snapshot.actionText,
    createdAt,
  });
  return {
    id: `${saveId}:${turnNumber}`,
    saveId,
    turnNumber,
    snapshot,
    createdAt,
    runtimeStateMigrationVersion: snapshot.runtimeStateMigrationVersion,
  };
}

function invalidArchiveError(): Error {
  return new Error('存档文件格式不正确');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isValidDateTime(value: unknown): value is string {
  return isNonBlankString(value) && Number.isFinite(Date.parse(value));
}

const REQUIRED_RUNTIME_RECORD_FIELDS = [
  'worldStateDelta',
] as const;

const OPTIONAL_RUNTIME_ARRAY_FIELDS = [
  'calendarEras',
  'npcs',
  'turnEvents',
  'locations',
  'routes',
  'mapNodes',
  'routeEdges',
  'holdings',
  'privateAssets',
  'privateAssetProjects',
  'domesticReports',
  'factions',
  'troops',
  'plotPlan',
  'worldTrends',
  'conflicts',
  'combatRecords',
  'npcAwarenessIndex',
  'heroineThreads',
  'bondThreads',
  'correspondence',
  'correspondenceCommitments',
  'abilityRuleExecutions',
] as const;

const OPTIONAL_RUNTIME_RECORD_FIELDS = [
  'currentTime',
  'worldlineSettings',
  'memoryArchive',
  'lastStatePatch',
  'lastPatchValidation',
  'resources',
  'court',
  'situationOverview',
] as const;

const OPTIONAL_RUNTIME_STRING_FIELDS = [
  'startBookmarkId',
  'currentPlaceId',
  'currentSceneId',
  'currentCrisisId',
] as const;

// This name-only recursion guard must contain only fields that are arrays in every
// runtime context. Ambiguous names are validated by their owning structures instead
// (for example player.equipment is an array, while scoreBreakdown.equipment is a number).
const RUNTIME_ARRAY_FIELD_NAMES = new Set([
  'activeQuests',
  'activeTags',
  'affectedFactionIds',
  'affectedForceIds',
  'affectedHoldingIds',
  'affectedNpcIds',
  'affectedPlaceIds',
  'affectedPrivateAssetIds',
  'aliases',
  'attitudeHints',
  'bondThreads',
  'correspondence',
  'correspondenceCommitments',
  'calendarEras',
  'cards',
  'checkHooks',
  'childTroopIds',
  'combatRecords',
  'commanderNpcIds',
  'completedProjectIds',
  'conditions',
  'conditionNotes',
  'conflicts',
  'connectedRegionIds',
  'consequenceTags',
  'contextBreakdown',
  'controlHints',
  'convertedToQuestIds',
  'convertedToWorldTrendIds',
  'corePersonNpcIds',
  'currentPressure',
  'decisiveFactors',
  'details',
  'deliverables',
  'documents',
  'domesticReports',
  'edicts',
  'effects',
  'embedding',
  'errors',
  'factionEffects',
  'factions',
  'fatherCharacterIds',
  'focusedNpcNames',
  'followUpHooks',
  'garrisonTroopIds',
  'heroineThreads',
  'holdingHighlights',
  'holdings',
  'immediateHooks',
  'importantSupplies',
  'inseminationRecords',
  'intents',
  'inventory',
  'involvedFactionIds',
  'involvedNpcIds',
  'involvedTroopIds',
  'items',
  'itemIds',
  'judgementCards',
  'keyDeeds',
  'keyOfficials',
  'knownActors',
  'knownFactions',
  'knownMemberNpcIds',
  'knownRumors',
  'layers',
  'localSituationNotes',
  'locationMemorySummaries',
  'locations',
  'longTermStorySummaries',
  'longTermFacts',
  'mapNodes',
  'memories',
  'midTermSummaries',
  'milestones',
  'notes',
  'npcAwarenessIndex',
  'npcAwarenessRefs',
  'npcInteractionSummaries',
  'npcLongTermSummaries',
  'npcMidTermSummaries',
  'npcs',
  'outcomeTags',
  'participants',
  'placeEffects',
  'playerRelevance',
  'plotPlan',
  'pregnancyHistory',
  'presenceUpdates',
  'presentNpcIds',
  'presentNpcNames',
  'privateAssetHighlights',
  'privateAssetProjects',
  'privateAssets',
  'processingStages',
  'progressNotes',
  'projectHighlights',
  'recentActionRecords',
  'recentActions',
  'recentChanges',
  'recentEventIds',
  'recentEvents',
  'recentTurns',
  'recentTurnSummaries',
  'relatedConflictIds',
  'relatedCommitmentIds',
  'relatedFactionIds',
  'relatedLocationIds',
  'relatedNpcIds',
  'relatedNpcNames',
  'relatedPlaceIds',
  'relatedQuestIds',
  'relatedRumorIds',
  'relatedTags',
  'relatedTrendIds',
  'relatedTroopIds',
  'relatedWorldTrendIds',
  'relationshipNetwork',
  'relationships',
  'reputationEffects',
  'resultTags',
  'riskEventKeys',
  'risks',
  'routeEdges',
  'routes',
  'sides',
  'sourceConflictIds',
  'sourceIds',
  'appliedOperationIds',
  'sourceMemoryIds',
  'sourceMidTermSummaryIds',
  'sourceRecentTurnIds',
  'sourceQuestIds',
  'sourceSignalIds',
  'sourceTurnNumbers',
  'statusTags',
  'storyPackIds',
  'subLocations',
  'tags',
  'targetNames',
  'targetNpcIds',
  'threads',
  'tokens',
  'traits',
  'troopEffects',
  'troops',
  'troopIds',
  'turnEvents',
  'turningPoints',
  'turnLog',
  'unlocks',
  'unresolvedHooks',
  'visualTags',
  'wantedNotices',
  'warnings',
  'weapons',
  'worldTrends',
]);

const RUNTIME_RECURSION_SKIP_FIELDS = new Set([
  'worldStateDelta',
  'payload',
  'playerResources',
  'abilityScores',
  'statBonuses',
]);

function hasValidKnownArrayContainers(value: unknown, ownerArrayField?: string): boolean {
  if (Array.isArray(value)) {
    return value.every((item) => hasValidKnownArrayContainers(item, ownerArrayField));
  }
  if (!isRecord(value)) return true;

  for (const [field, child] of Object.entries(value)) {
    const isKnownTextNote = field === 'notes'
      && (ownerArrayField === 'routeEdges' || ownerArrayField === 'relationshipNetwork')
      && isString(child);
    if (RUNTIME_ARRAY_FIELD_NAMES.has(field)
      && child !== undefined
      && !Array.isArray(child)
      && !isKnownTextNote) {
      return false;
    }
    if (!RUNTIME_RECURSION_SKIP_FIELDS.has(field)
      && !hasValidKnownArrayContainers(child, Array.isArray(child) ? field : undefined)) {
      return false;
    }
  }
  return true;
}

function hasValidOptionalArray(
  value: unknown,
  itemValidator: (item: unknown) => boolean,
): boolean {
  return value === undefined || (Array.isArray(value) && value.every(itemValidator));
}

function hasValidActorDetailContainers(value: unknown): boolean {
  return isRecord(value)
    && hasValidOptionalArray(value.checkHooks, isRecord)
    && hasValidOptionalArray(value.tags, isString)
    && hasValidOptionalArray(value.relatedNpcIds, isString)
    && hasValidOptionalArray(value.relatedFactionIds, isString)
    && hasValidOptionalArray(value.unlocks, isString)
    && hasValidOptionalArray(value.risks, isString)
    && (value.statBonuses === undefined || isFiniteNumberRecord(value.statBonuses));
}

function hasValidActorContainers(value: Record<string, unknown>): boolean {
  return hasValidOptionalArray(value.aliases, isString)
    && hasValidOptionalArray(value.traits, hasValidActorDetailContainers)
    && hasValidOptionalArray(value.uniqueArts, hasValidActorDetailContainers)
    && hasValidOptionalArray(value.effects, hasValidActorDetailContainers)
    && hasValidOptionalArray(value.equipment, hasValidActorDetailContainers)
    && hasValidOptionalArray(value.inventory, hasValidActorDetailContainers)
    && (value.abilityScores === undefined || isFiniteNumberRecord(value.abilityScores))
    && (value.vitals === undefined || isRecord(value.vitals))
    && (value.reputation === undefined || (
      isRecord(value.reputation)
      && hasValidOptionalArray(value.reputation.tags, isRecord)
    ))
    && (value.playerMemory === undefined || (
      isRecord(value.playerMemory)
      && hasValidOptionalArray(value.playerMemory.keyDeeds, isRecord)
      && hasValidOptionalArray(value.playerMemory.recentTurns, isString)
    ))
    && (value.factionAssetAccess === undefined || isRecord(value.factionAssetAccess));
}

function isActorCandidate(value: unknown): boolean {
  return isRecord(value)
    && isNonBlankString(value.id)
    && isString(value.name)
    && isString(value.roleType)
    && isString(value.summary)
    && hasValidActorContainers(value);
}

function isRelationshipCandidate(value: unknown): boolean {
  if (!isRecord(value)
    || !isNonBlankString(value.id)
  ) return false;
  const hasTargetKind = Object.prototype.hasOwnProperty.call(value, 'targetKind');
  const hasTargetType = Object.prototype.hasOwnProperty.call(value, 'targetType');
  const targetKind = value.targetKind === 'actor' || value.targetKind === 'faction'
    ? value.targetKind
    : undefined;
  const targetType = value.targetType === 'actor' || value.targetType === 'faction'
    ? value.targetType
    : undefined;
  return isNonBlankString(value.actorId)
    && isNonBlankString(value.targetId)
    && (!hasTargetKind || Boolean(targetKind))
    && (!hasTargetType || Boolean(targetType))
    && Boolean(targetKind || targetType)
    && (!targetKind || !targetType || targetKind === targetType)
    && isString(value.type)
    && typeof value.value === 'number'
    && Number.isFinite(value.value)
    && value.value >= -100
    && value.value <= 100
    && isString(value.description);
}

function isRumorCandidate(value: unknown): boolean {
  return isRecord(value)
    && isNonBlankString(value.id)
    && isString(value.content)
    && isString(value.source)
    && typeof value.verified === 'boolean'
    && isString(value.createdAt);
}

function isQuestCandidate(value: unknown): boolean {
  return isRecord(value)
    && isNonBlankString(value.id)
    && isString(value.title)
    && isString(value.description)
    && ['active', 'completed', 'failed', 'invalidated', 'archived'].includes(String(value.status))
    && isString(value.createdAt)
    && isString(value.updatedAt);
}

function isTurnLogCandidate(value: unknown): boolean {
  return isRecord(value)
    && Number.isInteger(value.turnNumber)
    && isString(value.date)
    && isString(value.playerInput)
    && isString(value.narrativeText)
    && isString(value.statePatchSummary)
    && isString(value.timestamp)
    && hasValidOptionalArray(value.suggestedActions, isSuggestedActionCandidate);
}

function isSuggestedActionCandidate(value: unknown): boolean {
  return isRecord(value)
    && isNonBlankString(value.label)
    && isString(value.description)
    && isNonBlankString(value.actionType);
}

function isFiniteNumberRecord(value: unknown): boolean {
  return isRecord(value)
    && Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function isResourceLedgerCandidate(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const numericFields = ['money', 'grain', 'horses', 'arms', 'recruits'] as const;
  const stringArrayFields = ['weapons', 'documents', 'tokens', 'importantSupplies'] as const;
  return numericFields.every((field) => (
    value[field] === undefined
    || (typeof value[field] === 'number' && Number.isFinite(value[field]))
  )) && stringArrayFields.every((field) => hasValidOptionalArray(value[field], isString));
}

function isMemoryArchiveCandidate(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const entryFields = [
    'recentTurnSummaries',
    'midTermSummaries',
    'longTermStorySummaries',
    'longTermFacts',
    'npcInteractionSummaries',
    'npcMidTermSummaries',
    'npcLongTermSummaries',
    'locationMemorySummaries',
  ] as const;
  return entryFields.every((field) => hasValidOptionalArray(value[field], isRecord))
    && (value.settings === undefined || isRecord(value.settings))
    && (
      value.memorySummaryMaintenance === undefined
      || (
        isRecord(value.memorySummaryMaintenance)
        && value.memorySummaryMaintenance.status === 'pending'
        && isString(value.memorySummaryMaintenance.queuedAt)
        && typeof value.memorySummaryMaintenance.triggerTurnNumber === 'number'
        && Number.isInteger(value.memorySummaryMaintenance.triggerTurnNumber)
        && value.memorySummaryMaintenance.triggerTurnNumber >= 0
        && (
          value.memorySummaryMaintenance.lastAttemptAt === undefined
          || isString(value.memorySummaryMaintenance.lastAttemptAt)
        )
        && (
          value.memorySummaryMaintenance.lastFailureReason === undefined
          || isString(value.memorySummaryMaintenance.lastFailureReason)
        )
      )
    );
}

function isWorldlineSettingsCandidate(value: unknown): boolean {
  return isRecord(value)
    && hasValidOptionalArray(value.storyPackIds, isString);
}

function isPatchValidationCandidate(value: unknown): boolean {
  return isRecord(value)
    && (value.valid === undefined || typeof value.valid === 'boolean')
    && hasValidOptionalArray(value.errors, isString)
    && hasValidOptionalArray(value.warnings, isString);
}

function isCourtLedgerCandidate(value: unknown): boolean {
  return isRecord(value)
    && hasValidOptionalArray(value.edicts, isString)
    && hasValidOptionalArray(value.wantedNotices, isString)
    && hasValidOptionalArray(value.keyOfficials, isString);
}

function isSituationOverviewCandidate(value: unknown): boolean {
  return isRecord(value)
    && hasValidOptionalArray(value.currentPressure, isString)
    && hasValidOptionalArray(value.immediateHooks, isString);
}

function isGameClockCandidate(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['year', 'month', 'day', 'hour', 'minute'].every((field) => (
    value[field] === undefined
    || (typeof value[field] === 'number' && Number.isFinite(value[field]))
  ));
}

function hasValidRuntimeCollections(candidate: Record<string, unknown>): boolean {
  return Array.isArray(candidate.knownActors)
    && candidate.knownActors.every(isActorCandidate)
    && Array.isArray(candidate.knownFactions)
    && candidate.knownFactions.every(isString)
    && Array.isArray(candidate.relationships)
    && candidate.relationships.every(isRelationshipCandidate)
    && Array.isArray(candidate.knownRumors)
    && candidate.knownRumors.every(isRumorCandidate)
    && Array.isArray(candidate.activeQuests)
    && candidate.activeQuests.every(isQuestCandidate)
    && Array.isArray(candidate.turnLog)
    && candidate.turnLog.every(isTurnLogCandidate)
    && Array.isArray(candidate.localSituationNotes)
    && candidate.localSituationNotes.every(isString)
    && isFiniteNumberRecord(candidate.playerResources);
}

function hasValidOptionalRuntimeContainers(candidate: Record<string, unknown>): boolean {
  return OPTIONAL_RUNTIME_ARRAY_FIELDS.every((field) => (
    candidate[field] === undefined
    || (Array.isArray(candidate[field]) && candidate[field].every(isRecord))
  ))
    && OPTIONAL_RUNTIME_RECORD_FIELDS.every((field) => (
      candidate[field] === undefined || isRecord(candidate[field])
    ))
    && OPTIONAL_RUNTIME_STRING_FIELDS.every((field) => (
      candidate[field] === undefined || isString(candidate[field])
    ))
    && (candidate.currentTime === undefined || isGameClockCandidate(candidate.currentTime))
    && (candidate.worldlineSettings === undefined
      || isWorldlineSettingsCandidate(candidate.worldlineSettings))
    && (candidate.memoryArchive === undefined || isMemoryArchiveCandidate(candidate.memoryArchive))
    && (candidate.lastStatePatch === undefined || (
      isRecord(candidate.lastStatePatch)
      && isRecord(candidate.lastStatePatch.payload)
    ))
    && (candidate.lastPatchValidation === undefined
      || isPatchValidationCandidate(candidate.lastPatchValidation))
    && (candidate.resources === undefined || isResourceLedgerCandidate(candidate.resources))
    && (candidate.court === undefined || isCourtLedgerCandidate(candidate.court))
    && (candidate.situationOverview === undefined
      || isSituationOverviewCandidate(candidate.situationOverview));
}

function normalizeRuntimeStateCandidate(candidate: unknown): RuntimeStateMigrationResult {
  if (!isRecord(candidate)
    || !isNonBlankString(candidate.engineVersion)
    || !isNonBlankString(candidate.worldBookId)
    || !isNonBlankString(candidate.worldBookVersion)
    || (candidate.worldBookSource !== 'official' && candidate.worldBookSource !== 'custom')
    || !isNonBlankString(candidate.startDate)
    || !isNonBlankString(candidate.currentDate)
    || !isActorCandidate(candidate.player)
    || !isNonBlankString(candidate.currentLocationId)
    || !hasValidRuntimeCollections(candidate)
    || !hasValidOptionalRuntimeContainers(candidate)
    || !hasValidKnownArrayContainers(candidate)
    || !REQUIRED_RUNTIME_RECORD_FIELDS.every((field) => isRecord(candidate[field]))) {
    throw invalidArchiveError();
  }

  try {
    return migrateRuntimeStateForPersistence(candidate as unknown as RuntimeState);
  } catch {
    throw invalidArchiveError();
  }
}

function normalizeSaveCandidate(candidate: unknown): SaveData {
  if (!isRecord(candidate)
    || !isNonBlankString(candidate.id)
    || !isString(candidate.label)
    || !isValidDateTime(candidate.createdAt)
    || !isValidDateTime(candidate.updatedAt)
    || !isNonBlankString(candidate.engineVersion)
    || (candidate.saveKind !== undefined
      && candidate.saveKind !== 'auto'
      && candidate.saveKind !== 'manual')) {
    throw invalidArchiveError();
  }

  try {
    assertRuntimeStateVersionSupported(candidate.engineVersion);
  } catch {
    throw invalidArchiveError();
  }
  const migration = normalizeRuntimeStateCandidate(candidate.runtimeState);
  return buildNormalizedSaveData({
    ...candidate,
    runtimeStateMigrationVersion: undefined,
    runtimeState: migration.state,
  } as unknown as SaveData, migration.state, migration);
}

function prepareLegacySavesForImport(): { saves: SaveData[]; lastSaveId: string | null } {
  const legacyList = readLegacySaveList();
  const saves: SaveData[] = [];
  for (const item of legacyList) {
    const candidate = readLegacySave(item.id);
    if (candidate === null) continue;
    try {
      saves.push(normalizeSaveCandidate(candidate));
    } catch {
      // Invalid legacy records are ignored; the validated archive still imports atomically.
    }
  }
  const saveIds = new Set(saves.map((save) => save.id));
  const storedLastSaveId = getStorage()?.getItem(LAST_SAVE_KEY) ?? null;
  const lastSaveId = storedLastSaveId && saveIds.has(storedLastSaveId)
    ? storedLastSaveId
    : legacyList.find((item) => saveIds.has(item.id))?.id ?? null;
  return { saves, lastSaveId };
}

function resolvePreviousImportPointer(
  existingLastSaveId: string | undefined,
  legacyLastSaveId: string | null,
  finalSaves: ReadonlyMap<string, SaveData>,
): string | null {
  if (existingLastSaveId && finalSaves.has(existingLastSaveId)) return existingLastSaveId;
  if (legacyLastSaveId && finalSaves.has(legacyLastSaveId)) return legacyLastSaveId;
  return null;
}

function selectStableNewestSaveId(saves: Iterable<SaveData>): string | null {
  return [...saves]
    .sort(compareUpdatedSaveIdentity)[0]?.id ?? null;
}

function compareUpdatedSaveIdentity(
  left: Pick<SaveData, 'id' | 'updatedAt'>,
  right: Pick<SaveData, 'id' | 'updatedAt'>,
): number {
  const leftTime = Date.parse(left.updatedAt);
  const rightTime = Date.parse(right.updatedAt);
  const normalizedLeftTime = Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY;
  const normalizedRightTime = Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY;
  return normalizedRightTime - normalizedLeftTime || left.id.localeCompare(right.id);
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback;
}

function selectRetainedAutoSaveIds(
  autoSaves: SaveData[],
  limit: number,
  protectedSaveId?: string,
  preferredSaveId?: string,
): Set<string> {
  const retained = new Set<string>();
  const normalizedLimit = normalizePositiveInteger(limit, 20);
  if (protectedSaveId && autoSaves.some((save) => save.id === protectedSaveId)) {
    retained.add(protectedSaveId);
  }
  if (retained.size < normalizedLimit
    && preferredSaveId
    && autoSaves.some((save) => save.id === preferredSaveId)) {
    retained.add(preferredSaveId);
  }
  for (const save of [...autoSaves].sort(compareUpdatedSaveIdentity)) {
    if (retained.size >= normalizedLimit) break;
    retained.add(save.id);
  }
  return retained;
}

async function writeLastSaveId(
  meta: IDBObjectStore,
  request: <T>(request: IDBRequest<T>) => Promise<T>,
  saveId: string | null,
): Promise<void> {
  if (saveId === null) {
    await request(meta.delete(LAST_SAVE_META_KEY));
    return;
  }
  await request(meta.put({ key: LAST_SAVE_META_KEY, value: saveId }));
}

async function saveToIndexedDb(save: SaveData): Promise<void> {
  const normalized = normalizeSaveData(save);
  await withLocalTransaction(
    ['saves', 'saveSummaries'],
    'readwrite',
    async ({ store, request }) => {
      await Promise.all([
        request(store('saves').put(normalized)),
        request(store('saveSummaries').put(toSaveListItem(normalized))),
      ]);
    },
  );
}

async function loadSaveById(saveId: string): Promise<SaveData | null> {
  return withLocalTransaction(
    ['saves', 'saveSummaries'],
    'readwrite',
    async ({ store, request }) => {
      const saves = store('saves');
      const saveSummaries = store('saveSummaries');
      const save = await request<SaveData | undefined>(saves.get(saveId)) ?? null;
      if (!save) return null;

      const normalized = normalizeSaveData(save);
      if (shouldPersistNormalizedSave(save, normalized)) {
        await Promise.all([
          request(saves.put(normalized)),
          request(saveSummaries.put(toSaveListItem(normalized))),
        ]);
      }
      return normalized;
    },
  );
}

function toSaveListItem(save: SaveData): SaveListItem {
  const currentLocation = save.runtimeState.locations?.find(
    (location) => location.locationId === save.runtimeState.currentLocationId,
  );
  return {
    id: save.id,
    label: save.label,
    saveKind: save.saveKind ?? 'auto',
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
    worldBookId: save.worldBookId,
    startBookmarkId: save.startBookmarkId,
    currentDate: save.currentDate,
    playerName: save.runtimeState.player.name || '未命名角色',
    locationName: currentLocation?.name ?? '',
    turnCount: save.runtimeState.turnLog?.length ?? 0,
  };
}

async function ensureSaveSummaryIndexReady(): Promise<void> {
  if (await idbGetMeta<boolean>(SAVE_SUMMARY_INDEX_META_KEY)) return;

  await withLocalTransaction(
    ['saves', 'saveSummaries', 'meta'],
    'readwrite',
    async ({ store, request }) => {
      const saves = await request<SaveData[]>(store('saves').getAll());
      const summaries = store('saveSummaries');
      await request(summaries.clear());
      for (const save of saves) {
        const normalized = normalizeSaveData(save);
        await request(summaries.put(toSaveListItem(normalized)));
      }
      await request(store('meta').put({ key: SAVE_SUMMARY_INDEX_META_KEY, value: true }));
    },
  );
}

function buildSave(runtimeState: RuntimeState, label: string | undefined, saveKind: SaveKind): SaveData {
  const now = new Date().toISOString();
  const id = uuidv4();
  const migration = migrateRuntimeStateForPersistence(runtimeState);
  const normalizedState = compactRuntimeStateForPersistence(migration.state);
  normalizedState.avgPresentation = {
    ...normalizedState.avgPresentation,
    visualPartitionId: normalizedState.avgPresentation?.visualPartitionId?.trim() || id,
    portraitBindings: normalizedState.avgPresentation?.portraitBindings ?? [],
  };
  return {
    id,
    label: label ?? `存档 ${new Date().toLocaleString('zh-CN')}`,
    saveKind,
    createdAt: now,
    updatedAt: now,
    engineVersion: CURRENT_RUNTIME_STATE_VERSION,
    runtimeStateMigrationVersion: getPersistedMigrationVersion(migration),
    runtimeStateMigrationDiagnostics: getPersistedMigrationDiagnostics(migration),
    worldBookId: normalizedState.worldBookId,
    worldBookVersion: normalizedState.worldBookVersion,
    worldBookSource: normalizedState.worldBookSource,
    startBookmarkId: normalizedState.startBookmarkId,
    startDate: normalizedState.startDate,
    currentDate: normalizedState.currentDate,
    runtimeState: normalizedState,
  };
}

function buildUpdatedSave(existing: SaveData, runtimeState: RuntimeState): SaveData {
  const migration = migrateRuntimeStateForPersistence(runtimeState);
  const normalizedState = compactRuntimeStateForPersistence(migration.state);
  normalizedState.avgPresentation = {
    ...normalizedState.avgPresentation,
    visualPartitionId: normalizedState.avgPresentation?.visualPartitionId?.trim() || existing.id,
    portraitBindings: normalizedState.avgPresentation?.portraitBindings ?? [],
  };
  return buildNormalizedSaveData({
    ...existing,
    engineVersion: CURRENT_RUNTIME_STATE_VERSION,
    runtimeStateMigrationVersion: getPersistedMigrationVersion(migration),
    runtimeState: normalizedState,
    currentDate: normalizedState.currentDate,
    updatedAt: new Date().toISOString(),
  }, normalizedState, migration);
}

function buildStoredTurnSnapshot(input: CommitSuccessfulTurnInput): StoredTurnSnapshot {
  const snapshot = createTurnRollbackSnapshot({
    ...input.snapshot,
    beforeState: compactRuntimeStateForPersistence(input.snapshot.beforeState),
  });
  return {
    id: `${input.saveId}:${input.turnNumber}`,
    saveId: input.saveId,
    turnNumber: input.turnNumber,
    snapshot,
    createdAt: snapshot.createdAt,
    runtimeStateMigrationVersion: snapshot.runtimeStateMigrationVersion,
  };
}

function normalizeSaveData(save: SaveData): SaveData {
  assertRuntimeStateMigrationVersionSupported(save.runtimeStateMigrationVersion);
  assertRuntimeStateVersionSupported(save.engineVersion);
  assertRuntimeStateVersionSupported(save.runtimeState.engineVersion);
  if (save.runtimeStateMigrationVersion === CURRENT_RUNTIME_STATE_MIGRATION_VERSION) {
    const compactedState = compactRuntimeStateForPersistence(save.runtimeState);
    return compactedState === save.runtimeState
      ? save
      : { ...save, runtimeState: compactedState };
  }
  const migration = migrateRuntimeStateForPersistence(save.runtimeState);
  return buildNormalizedSaveData(save, migration.state, migration);
}

function buildNormalizedSaveData(
  save: SaveData,
  runtimeState: RuntimeState,
  migration: RuntimeStateMigrationResult = {
    state: runtimeState,
    complete: true,
    diagnostics: [],
  },
): SaveData {
  const compactedState = compactRuntimeStateForPersistence(runtimeState);
  return {
    ...save,
    engineVersion: CURRENT_RUNTIME_STATE_VERSION,
    runtimeStateMigrationVersion: getPersistedMigrationVersion(migration),
    runtimeStateMigrationDiagnostics: getPersistedMigrationDiagnostics(migration),
    worldBookId: compactedState.worldBookId,
    worldBookVersion: compactedState.worldBookVersion,
    worldBookSource: compactedState.worldBookSource,
    startBookmarkId: compactedState.startBookmarkId,
    startDate: compactedState.startDate,
    currentDate: compactedState.currentDate,
    runtimeState: compactedState,
  };
}

function compactTurnDisplayMeta(displayMeta: TurnDisplayMeta): TurnDisplayMeta {
  const {
    rawResponse: _rawResponse,
    reasoningSummary: _reasoningSummary,
    promptTokenEstimate: _promptTokenEstimate,
    processingStages: _processingStages,
    memoryRecall: _memoryRecall,
    npcIntentSimulation,
    ...retained
  } = displayMeta;
  const compactedNpcIntentSimulation = npcIntentSimulation
    ? (() => {
        const { package: _package, ...summary } = npcIntentSimulation;
        return summary;
      })()
    : undefined;
  const changed = displayMeta.rawResponse !== undefined
    || displayMeta.reasoningSummary !== undefined
    || displayMeta.promptTokenEstimate !== undefined
    || displayMeta.processingStages !== undefined
    || displayMeta.memoryRecall !== undefined
    || npcIntentSimulation?.package !== undefined;
  if (!changed) return displayMeta;
  return {
    ...retained,
    ...(compactedNpcIntentSimulation
      ? { npcIntentSimulation: compactedNpcIntentSimulation }
      : {}),
  };
}

/**
 * Keeps gameplay facts and complete narrative text while trimming old, derived
 * diagnostics that can otherwise duplicate large model responses in every save
 * and rollback snapshot. The newest turns retain full diagnostics for support.
 */
export function compactRuntimeStateForPersistence(runtimeState: RuntimeState): RuntimeState {
  const compactBeforeIndex = Math.max(
    0,
    runtimeState.turnLog.length - PERSISTED_FULL_TURN_DIAGNOSTIC_LIMIT,
  );
  let changed = false;
  const turnLog = runtimeState.turnLog.map((entry, index) => {
    if (index >= compactBeforeIndex || !entry.displayMeta) return entry;
    const displayMeta = compactTurnDisplayMeta(entry.displayMeta);
    if (displayMeta === entry.displayMeta) return entry;
    changed = true;
    return { ...entry, displayMeta };
  });
  return changed ? { ...runtimeState, turnLog } : runtimeState;
}

function developerOverrideCheckpointMetaKey(saveId: string): string {
  return `${DEVELOPER_OVERRIDE_CHECKPOINT_META_PREFIX}${saveId}`;
}

function runtimeVariableCheckpointMetaKey(saveId: string): string {
  return `${RUNTIME_VARIABLE_CHECKPOINT_META_PREFIX}${saveId}`;
}

function fingerprintRuntimeState(runtimeState: RuntimeState): string {
  const serialized = JSON.stringify(compactRuntimeStateForPersistence(runtimeState));
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${serialized.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function shouldPersistNormalizedSave(previous: SaveData, normalized: SaveData): boolean {
  if (previous === normalized) return false;
  return previous.runtimeStateMigrationVersion !== normalized.runtimeStateMigrationVersion
    || previous.engineVersion !== normalized.engineVersion
    || previous.worldBookId !== normalized.worldBookId
    || previous.worldBookVersion !== normalized.worldBookVersion
    || previous.worldBookSource !== normalized.worldBookSource
    || previous.startBookmarkId !== normalized.startBookmarkId
    || previous.startDate !== normalized.startDate
    || previous.currentDate !== normalized.currentDate
    || hasPersistenceValueChanged(
      previous.runtimeStateMigrationDiagnostics,
      normalized.runtimeStateMigrationDiagnostics,
    )
    || hasPersistenceValueChanged(previous.runtimeState, normalized.runtimeState);
}

function getPersistedMigrationVersion(migration: RuntimeStateMigrationResult): number {
  return migration.complete
    ? CURRENT_RUNTIME_STATE_MIGRATION_VERSION
    : CURRENT_RUNTIME_STATE_MIGRATION_VERSION - 1;
}

function getPersistedMigrationDiagnostics(
  migration: RuntimeStateMigrationResult,
): RuntimeStateMigrationResult['diagnostics'] | undefined {
  return migration.diagnostics.length > 0 ? migration.diagnostics : undefined;
}

async function setLastSaveId(saveId: string): Promise<void> {
  await idbSetMeta(LAST_SAVE_META_KEY, saveId);
}

async function ensureLegacySavesMigrated(): Promise<void> {
  if (await idbGetMeta<boolean>(LEGACY_MIGRATION_META_KEY)) return;

  const legacyList = readLegacySaveList();
  const migratedSaveIds: string[] = [];
  for (const item of legacyList) {
    const candidate = readLegacySave(item.id);
    if (candidate === null) continue;
    let save: SaveData;
    try {
      save = normalizeSaveCandidate(candidate);
    } catch {
      // Malformed legacy records are skipped; persistence failures must abort and retry later.
      continue;
    }
    await saveToIndexedDb(save);
    migratedSaveIds.push(save.id);
  }

  const existingLastSaveId = await idbGetMeta<string>(LAST_SAVE_META_KEY) ?? null;
  const legacyLastSaveId = getStorage()?.getItem(LAST_SAVE_KEY) ?? null;
  const saves = await idbGetAll<SaveData>('saves');
  const saveIds = new Set(saves.map((save) => save.id));
  const nextLastSaveId = [existingLastSaveId, legacyLastSaveId, ...migratedSaveIds]
    .find((saveId): saveId is string => Boolean(saveId && saveIds.has(saveId)))
    ?? selectStableNewestSaveId(saves);
  if (nextLastSaveId) {
    await setLastSaveId(nextLastSaveId);
  } else {
    await idbDeleteMeta(LAST_SAVE_META_KEY);
  }

  await idbSetMeta(LEGACY_MIGRATION_META_KEY, true);
}

function readLegacySaveList(): Array<Pick<SaveListItem, 'id'>> {
  const storage = getStorage();
  if (!storage) return [];

  try {
    const listJson = storage.getItem(SAVE_LIST_KEY);
    if (!listJson) return [];
    const parsed: unknown = JSON.parse(listJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Pick<SaveListItem, 'id'> => (
      isRecord(item) && isNonBlankString(item.id)
    ));
  } catch {
    return [];
  }
}

function readLegacySave(saveId: string): unknown | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const json = storage.getItem(SAVE_KEY_PREFIX + saveId);
    if (!json) return null;
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

function getStorage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function throwIfSignalAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
  }
}
