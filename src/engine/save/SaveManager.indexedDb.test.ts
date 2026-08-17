import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapNode, RuntimeState, SaveData, SaveListItem, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { CURRENT_RUNTIME_STATE_MIGRATION_VERSION } from '../state/RuntimeStateMigration';
import {
  idbGet,
  idbGetAll,
  idbGetMeta,
  idbPut,
  idbSetMeta,
  openLocalDatabase,
  resetLocalDatabaseForTests,
} from '../storage/IndexedDbStore';
import { TurnExecutionCancelledError } from '../turn/TurnExecutionContext';
import type { TurnRollbackSnapshotInput } from '../turn/TurnRollback';
import * as saveManager from './SaveManager';
import {
  clearAllSaves,
  createManualSave,
  continueLastSave,
  createSave,
  deleteSave,
  exportSaves,
  importSaves,
  listSaves,
  loadSave,
  pruneAutoSaves,
} from './SaveManager';
import {
  listTurnSnapshots,
  loadTurnSnapshot,
  saveTurnSnapshot,
  type StoredTurnSnapshot,
} from '../turn/TurnSnapshotStore';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { buildMapV1Index } from '../map/mapV1';
import { buildRuntimeMapIndex, getWorldBookMapRoots } from '../map/runtimeMap';
import { registerWorldBook } from '../worldbook';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import { executeTurn } from '../turn/TurnOrchestrator';
import { applyHoldingAnnualSettlementRuntime } from '../holdings/HoldingAnnualSettlementRuntime';
import type { PersonalCombatStartIntent } from '../encounterV2/EncounterContracts';

interface AtomicTurnCommitResult {
  save: SaveData;
  snapshotTurnNumbers: number[];
  autoSaveCreated?: SaveData;
}

function makeOfficialSeedDuplicateState(): RuntimeState {
  const state = makeState('未挂载UI主角');
  const index = buildMapV1Index(getWorldBookMapRoots(worldBook_ThreeKingdoms));
  const seed = index.nodeById.place_jingzhou_xinye;
  state.worldBookId = worldBook_ThreeKingdoms.manifest.id;
  state.worldBookVersion = worldBook_ThreeKingdoms.manifest.version;
  state.worldBookSource = 'official';
  state.currentLocationId = 'runtime_xinye_duplicate';
  state.currentPlaceId = 'runtime_xinye_duplicate';
  state.mapNodes = [{
    ...seed,
    id: 'runtime_xinye_duplicate',
    parentId: index.parentIdByNodeId[seed.id],
    subLocations: undefined,
  }];
  return state;
}

function makeSaveWithState(id: string, state: RuntimeState): SaveData {
  const save = makeSaveData(id, state.player.name);
  return {
    ...save,
    runtimeStateMigrationVersion: 3,
    worldBookId: state.worldBookId,
    worldBookVersion: state.worldBookVersion,
    worldBookSource: state.worldBookSource,
    runtimeState: state,
  };
}

type CommitSuccessfulTurn = (input: {
  saveId: string;
  runtimeState: RuntimeState;
  turnNumber: number;
  snapshot: TurnRollbackSnapshotInput;
  maxDepth: number;
  autoSave?: {
    intervalTurns: number;
    limit: number;
  };
  signal?: AbortSignal;
}) => Promise<AtomicTurnCommitResult | null>;

type CommitTurnRestore = (input: {
  saveId: string;
  runtimeState: RuntimeState;
  deleteSnapshotsAfterTurn: number;
  signal?: AbortSignal;
}) => Promise<AtomicTurnCommitResult | null>;

function getAtomicSaveApi<T extends 'commitSuccessfulTurn' | 'commitTurnRestore'>(name: T): (
  T extends 'commitSuccessfulTurn' ? CommitSuccessfulTurn : CommitTurnRestore
) {
  const api = (saveManager as typeof saveManager & Record<string, unknown>)[name];
  expect(api, `SaveManager should expose ${name}`).toBeTypeOf('function');
  return api as T extends 'commitSuccessfulTurn' ? CommitSuccessfulTurn : CommitTurnRestore;
}

async function holdPersistenceWriteLock(): Promise<{
  release: () => void;
  completed: Promise<void>;
}> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(['saves', 'turnSnapshots', 'meta'], 'readwrite');
  const store = transaction.objectStore('saves');
  let released = false;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const completed = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  const keepAlive = () => {
    const request = store.get('__persistence_test_lock__');
    request.onsuccess = () => {
      markStarted?.();
      markStarted = undefined;
      if (!released) keepAlive();
    };
  };
  keepAlive();
  await started;

  return {
    release: () => {
      released = true;
    },
    completed,
  };
}

function makeStateWithTurns(name: string, turnCount: number): RuntimeState {
  const state = makeState(name);
  return {
    ...state,
    turnLog: Array.from({ length: turnCount }, (_, index) => ({
      turnNumber: index + 1,
      date: state.currentDate,
      playerInput: `行动 ${index + 1}`,
      narrativeText: `正文 ${index + 1}`,
      statePatchSummary: '测试',
      timestamp: `2026-07-10T00:00:0${index}.000Z`,
    })),
  };
}

function makeState(name = '主角'): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '184年3月',
    currentDate: '184年3月',
    player: {
      id: 'player',
      name,
      roleType: '流民',
      summary: '流落乱世。',
    },
    currentLocationId: 'loc_test',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
  });
}

function makeSaveData(
  id: string,
  name: string,
  updatedAt = '2026-07-10T00:00:00.000Z',
): SaveData {
  const runtimeState = makeState(name);
  return {
    id,
    label: `${name}存档`,
    saveKind: 'auto',
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt,
    engineVersion: '0.1.0',
    runtimeStateMigrationVersion: CURRENT_RUNTIME_STATE_MIGRATION_VERSION,
    worldBookId: runtimeState.worldBookId,
    worldBookVersion: runtimeState.worldBookVersion,
    worldBookSource: runtimeState.worldBookSource,
    startBookmarkId: runtimeState.startBookmarkId,
    startDate: runtimeState.startDate,
    currentDate: runtimeState.currentDate,
    runtimeState,
  };
}

function makeStoredSnapshot(
  saveId: string,
  turnNumber: number,
  actionText = `行动 ${turnNumber}`,
): StoredTurnSnapshot {
  const createdAt = `2026-07-10T00:${String(turnNumber).padStart(2, '0')}:00.000Z`;
  return {
    id: `noncanonical-${saveId}-${turnNumber}`,
    saveId,
    turnNumber,
    snapshot: {
      beforeState: makeState(`${saveId}主角`),
      actionText,
      createdAt,
    },
    createdAt,
  };
}

async function readPersistenceFingerprint(): Promise<{
  saves: SaveData[];
  turnSnapshots: StoredTurnSnapshot[];
  lastSaveId: string | null;
  legacyMigration: boolean | null;
}> {
  return {
    saves: (await idbGetAll<SaveData>('saves')).sort((left, right) => left.id.localeCompare(right.id)),
    turnSnapshots: (await idbGetAll<StoredTurnSnapshot>('turnSnapshots'))
      .sort((left, right) => left.id.localeCompare(right.id)),
    lastSaveId: await idbGetMeta<string>('lastSaveId') ?? null,
    legacyMigration: await idbGetMeta<boolean>('legacySavesMigratedFromLocalStorage') ?? null,
  };
}

async function seedExistingArchiveState(): Promise<void> {
  const existing = await createSave(makeState('原库主角'), '原库存档');
  await saveTurnSnapshot({
    saveId: existing.id,
    turnNumber: 1,
    snapshot: {
      beforeState: makeState('原库主角'),
      actionText: '原库行动',
      createdAt: '2026-07-09T00:00:00.000Z',
    },
    maxDepth: 10,
  });
}

function installLegacyStorage(entries: Record<string, string>): void {
  const values = new Map(Object.entries(entries));
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  vi.stubGlobal('localStorage', storage);
}

async function injectNthPutFailure(
  nthPut: number,
  operation: () => Promise<void>,
): Promise<void> {
  const originalPut = IDBObjectStore.prototype.put;
  let putCount = 0;
  const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    putCount += 1;
    if (putCount === nthPut) throw new Error(`injected put failure ${nthPut}`);
    return key === undefined
      ? originalPut.call(this, value)
      : originalPut.call(this, value, key);
  });

  try {
    await operation();
  } finally {
    putSpy.mockRestore();
  }
}

describe('SaveManager IndexedDB persistence', () => {
  beforeEach(async () => {
    await resetLocalDatabaseForTests();
    registerWorldBook({
      ...worldBook_ThreeKingdoms,
      manifest: {
        ...worldBook_ThreeKingdoms.manifest,
        id: 'test-world',
        version: '0.1.0',
        source: 'official',
      },
      mapSeed: [],
      openingLocationSeed: [],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores saves in IndexedDB and restores them through import/export', async () => {
    const save = await createSave(makeState('阿青'), '阿青开局');

    expect((await listSaves())[0]).toMatchObject({ id: save.id, label: '阿青开局' });
    expect((await continueLastSave())?.id).toBe(save.id);

    const archive = await exportSaves();
    expect(archive).toMatchObject({
      schema: 'coc.v2.saves',
      version: 2,
      lastSaveId: save.id,
    });
    expect(archive.saves[0].runtimeState.player.name).toBe('阿青');

    await clearAllSaves();
    expect(await listSaves()).toEqual([]);

    await importSaves(archive);
    expect((await loadSave(save.id))?.runtimeState.player.name).toBe('阿青');
    expect((await continueLastSave())?.id).toBe(save.id);
  });

  it('keeps a lightweight summary index for the save list', async () => {
    const state = makeStateWithTurns('摘要索引主角', 7);
    const save = await createSave(state, '摘要索引测试');

    const [listed] = await listSaves();
    const [storedSummary] = await idbGetAll<SaveListItem>('saveSummaries');

    expect(listed).toMatchObject({
      id: save.id,
      label: '摘要索引测试',
      playerName: '摘要索引主角',
      turnCount: 7,
      currentDate: state.currentDate,
    });
    expect(storedSummary).toEqual(listed);
    expect(storedSummary).not.toHaveProperty('runtimeState');
  });

  it('rejects every save mutation entry point while a Combat V2 session is fighting', async () => {
    const normalState = makeState('战斗门禁主角');
    const existing = await createSave(normalState, '战前存档');
    const intent: PersonalCombatStartIntent = {
      contractVersion: 1,
      encounterId: 'combat_save_guard',
      kind: 'personal_combat',
      rulesetVersion: 'combat-v2.0.0',
      sourceTurnNumber: 0,
      locationId: 'loc_test',
      reason: '验证战斗中存档门禁',
      seed: 'combat_seed_guard',
      createdAt: '2026-07-20T00:00:00.000Z',
      policy: {
        lethality: 'standard',
        allowRetreat: true,
        allowSurrender: true,
        allowCapture: true,
        lootPolicy: 'none',
      },
      playerParty: { actorIds: ['player'] },
      enemyParty: { actorIds: ['npc_enemy'] },
      partySelection: 'locked',
    };
    const fightingState: RuntimeState = {
      ...normalState,
      encounterV2: {
        semanticProjections: [],
        appliedResultHashes: [],
        narratedResultHashes: [],
        active: {
          session: {
            sessionId: 'session:combat_save_guard',
            status: 'fighting',
            snapshotHash: 'snapshot_hash',
            createdAt: '2026-07-20T00:00:00.000Z',
            startedAt: '2026-07-20T00:00:01.000Z',
            intent,
          },
          checkpoint: {
            checkpointId: 'checkpoint:pre:combat_save_guard',
            checkpointKind: 'pre_encounter',
            saveId: existing.id,
            sessionId: 'session:combat_save_guard',
            encounterId: 'combat_save_guard',
            createdAt: '2026-07-20T00:00:00.000Z',
            intent,
            snapshotHash: 'snapshot_hash',
          },
        },
      },
    };
    const expected = /战斗进行中禁止存档/;
    const pendingState: RuntimeState = {
      ...fightingState,
      encounterV2: {
        ...fightingState.encounterV2!,
        active: {
          ...fightingState.encounterV2!.active!,
          session: {
            ...fightingState.encounterV2!.active!.session,
            status: 'pending',
            startedAt: undefined,
          },
        },
      },
    };

    await expect(saveManager.saveCurrentState(existing.id, pendingState)).resolves.not.toBeNull();
    expect((await loadSave(existing.id))?.runtimeState.encounterV2?.active?.session.status).toBe('pending');

    await expect(createSave(fightingState, '不应创建')).rejects.toThrow(expected);
    await expect(createManualSave(fightingState, '不应创建')).rejects.toThrow(expected);
    await expect(saveManager.saveCurrentState(existing.id, fightingState)).rejects.toThrow(expected);
    await expect(getAtomicSaveApi('commitSuccessfulTurn')({
      saveId: existing.id,
      runtimeState: fightingState,
      turnNumber: 1,
      snapshot: {
        beforeState: normalState,
        actionText: '进入战斗',
        createdAt: '2026-07-20T00:00:00.000Z',
      },
      maxDepth: 10,
    })).rejects.toThrow(expected);
    await expect(getAtomicSaveApi('commitTurnRestore')({
      saveId: existing.id,
      runtimeState: fightingState,
      deleteSnapshotsAfterTurn: 0,
    })).rejects.toThrow(expected);
    expect((await loadSave(existing.id))?.runtimeState.encounterV2?.active?.session.status).toBe('pending');
  });

  it('preserves the latest turn suggested actions across save export and import', async () => {
    const state = makeStateWithTurns('行动选项主角', 1);
    state.turnLog[0].suggestedActions = [{
      label: '整顿营门',
      description: '清点守军并重排值守。',
      actionType: 'other',
    }];
    const save = await createSave(state, '行动选项存档');

    const archive = await exportSaves();
    expect(archive.saves[0].runtimeState.turnLog[0].suggestedActions)
      .toEqual(state.turnLog[0].suggestedActions);

    await clearAllSaves();
    await importSaves(archive);

    expect((await loadSave(save.id))?.runtimeState.turnLog[0].suggestedActions)
      .toEqual(state.turnLog[0].suggestedActions);
  });

  it('uses the persisted runtime migration marker as the ordinary save load fast path', async () => {
    const save = makeSaveData('current-marker-save', '当前版本');
    save.runtimeState.memoryArchive = undefined;
    (save as SaveData & { runtimeStateMigrationVersion?: number }).runtimeStateMigrationVersion = CURRENT_RUNTIME_STATE_MIGRATION_VERSION;
    await idbPut('saves', save);

    const loaded = await loadSave(save.id);

    expect(loaded?.runtimeState.memoryArchive).toBeUndefined();
    expect((loaded as SaveData & { runtimeStateMigrationVersion?: number })?.runtimeStateMigrationVersion)
      .toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
  });

  it('loads and persists a repaired Longzhong clock from the previous migration version', async () => {
    const save = makeSaveData('longzhong-season-clock-save', '杨方源');
    save.runtimeStateMigrationVersion = CURRENT_RUNTIME_STATE_MIGRATION_VERSION - 1;
    save.worldBookId = 'threeKingdoms';
    save.worldBookVersion = worldBook_ThreeKingdoms.manifest.version;
    save.worldBookSource = 'official';
    save.startBookmarkId = 'bookmark_207_longzhong_plan';
    save.startDate = '207年冬';
    save.currentDate = '公元1年01月01日 09:15（巳时）';
    Object.assign(save.runtimeState, {
      worldBookId: 'threeKingdoms',
      worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
      worldBookSource: 'official',
      startBookmarkId: 'bookmark_207_longzhong_plan',
      startDate: '207年冬',
      currentDate: '公元1年01月01日 09:15（巳时）',
      currentTime: { year: 1, month: 1, day: 1, hour: 9, minute: 15 },
    });
    await idbPut('saves', save);

    const loaded = await loadSave(save.id);
    const persisted = await idbGet<SaveData>('saves', save.id);

    expect(loaded?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
    expect(loaded?.startDate).toBe('公元207年10月01日 08:00（辰时）');
    expect(loaded?.currentDate).toBe('公元207年10月01日 09:15（巳时）');
    expect(loaded?.runtimeState.currentTime).toEqual({
      year: 207,
      month: 10,
      day: 1,
      hour: 9,
      minute: 15,
    });
    expect(persisted?.currentDate).toBe(loaded?.currentDate);
    expect(persisted?.runtimeState.currentTime).toEqual(loaded?.runtimeState.currentTime);
  });

  it('migrates version 4 saves by collapsing differently named heroine threads for the same npcId', async () => {
    const save = makeSaveData('heroine-identity-v4-save', '红颜身份迁移');
    save.runtimeState.npcs = [{
      npcId: 'npc_zoushi',
      name: '邹氏',
      sex: '女',
      age: 32,
      role: '随军女眷',
      locationId: 'loc_test',
      isPresent: false,
      isFocused: true,
      summary: '随军同行。',
      appearance: '衣着素净。',
      personality: '谨慎。',
      motivation: '求得庇护。',
      relationToPlayer: '爱妾。',
      contactLevel: 80,
      recentAttitude: '依恋',
      memories: [],
    }];
    save.runtimeState.heroineThreads = [
      {
        heroineThreadId: 'bond_player_zoushi_conquest',
        npcId: 'npc_zoushi',
        npcName: '邹氏',
        status: 'active',
        stage: '随军宠妾',
        relationshipRole: '爱妾',
        summary: '既有关系线。',
        tags: ['随军'],
        lastUpdatedAt: '公元194年05月03日 08:00（辰时）',
      },
      {
        heroineThreadId: 'thread_heroine_zoushi',
        npcId: 'npc_zoushi',
        npcName: '错写姓名',
        status: 'active',
        stage: '死心相托',
        relationshipRole: '爱妾',
        summary: '本回合关系继续推进。',
        tags: ['托付'],
        lastUpdatedAt: '公元194年05月03日 17:00（酉时）',
      },
    ];
    save.runtimeStateMigrationVersion = 4;
    await idbPut('saves', save);

    const loaded = await loadSave(save.id);
    const persisted = await idbGet<SaveData>('saves', save.id);

    expect(loaded?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
    expect(loaded?.runtimeState.heroineThreads).toEqual([expect.objectContaining({
      heroineThreadId: 'bond_player_zoushi_conquest',
      npcId: 'npc_zoushi',
      npcName: '邹氏',
      stage: '死心相托',
      summary: '本回合关系继续推进。',
      tags: ['随军', '托付'],
    })]);
    expect(persisted?.runtimeState.heroineThreads).toEqual(loaded?.runtimeState.heroineThreads);
  });

  it('migrates version 5 saves by recovering recent firsthand NPC memories rejected by stale presence', async () => {
    const save = makeSaveData('npc-presence-memory-v5-save', '邹氏记忆迁移');
    save.runtimeStateMigrationVersion = 5;
    save.runtimeState.npcs = [{
      npcId: 'npc_zoushi', name: '邹氏', sex: '女', age: 32, role: '内宅女眷',
      locationId: 'loc_test', isPresent: false, isFocused: true,
      summary: '测试人物。', appearance: '端庄。', personality: '谨慎。', motivation: '安身。',
      relationToPlayer: '亲近', contactLevel: 80, recentAttitude: '依恋', memories: [],
    }];
    save.runtimeState.turnLog = [{
      turnNumber: 251,
      date: '公元194年05月03日 15:00（申时）',
      playerInput: '与邹氏交谈',
      narrativeText: '邹氏在内宅应答。',
      fullNarrativeText: '【邹氏】\n“夫君回来了。”',
      statePatchSummary: '已忽略无效写回建议：NPC记忆：NPC 邹氏 当前不在场，不能写入亲历记忆。',
      timestamp: '2026-07-18T08:30:00.000Z',
      displayMeta: {
        rawResponse: JSON.stringify({
          narrativeText: '【邹氏】\n“夫君回来了。”',
          suggestedActions: [],
          writeback: {
            npcMemorySuggestions: [{
              npcId: 'npc_zoushi', npcName: '邹氏', source: '亲历',
              content: '邹氏在内宅亲自迎接主角。',
            }],
          },
        }),
      },
    }];
    await idbPut('saves', save);

    const loaded = await loadSave(save.id);
    const persisted = await idbGet<SaveData>('saves', save.id);

    expect(loaded?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
    expect(loaded?.runtimeState.npcs?.[0].memories).toEqual([
      expect.objectContaining({
        source: '亲历',
        content: '邹氏在内宅亲自迎接主角。',
        createdAt: '公元194年05月03日 15:00（申时）',
      }),
    ]);
    expect(persisted?.runtimeState.npcs?.[0].memories).toEqual(loaded?.runtimeState.npcs?.[0].memories);
  });

  it('loads a reliable legacy annual report without applying the same settlement again', async () => {
    const state = makeState('旧账簿');
    state.currentDate = '189-09-15';
    state.currentTime = { year: 189, month: 9, day: 15, hour: 8, minute: 0 };
    state.resources = {
      money: 100,
      grain: 1000,
      horses: 20,
      arms: 10,
      recruits: 30,
      weapons: [],
      documents: [],
      tokens: [],
      importantSupplies: [],
    };
    state.privateAssets = [{
      privateAssetId: 'asset_legacy_save',
      name: '旧庄园',
      type: 'estate',
      ownerScope: 'personal',
      status: 'active',
      summary: '已在旧引擎完成年度入账。',
      locationDescription: '城外',
      workers: 5,
      workshopScale: 1,
      updatedAt: '189-09-01',
    }];
    state.domesticReports = [{
      reportId: 'domestic_189',
      year: 189,
      settledAt: '189-09-01 08:00',
      title: '189年内政收支',
      summary: '本年收入 钱财+6；军费与维持支出 无变化；最终净变 钱财+6。本年无到期私产工程。',
      income: { money: 6, grain: 0, horses: 0, arms: 0, recruits: 0 },
      expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 6, grain: 0, horses: 0, arms: 0, recruits: 0 },
      readByPlayer: true,
    }];
    const save = makeSaveWithState('legacy-annual-report-save', state);
    await idbPut('saves', save);

    const loaded = await loadSave(save.id);
    const result = applyHoldingAnnualSettlementRuntime(loaded!.runtimeState);

    expect(result.meta).toBeUndefined();
    expect(result.state.resources).toEqual(state.resources);
    expect(result.state.domesticReports).toEqual([
      expect.objectContaining({
        reportId: 'system:holding-annual:189',
        source: 'system',
        kind: 'holdingAnnualSettlement',
      }),
    ]);
  });

  it('migrates and conditionally rewrites a 5000-node parent chain through fake IndexedDB', async () => {
    const nodeCount = 5000;
    const state = makeState('Deep chain');
    state.currentLocationId = `save_deep_${String(nodeCount - 1).padStart(5, '0')}`;
    state.currentPlaceId = state.currentLocationId;
    state.mapNodes = Array.from({ length: nodeCount }, (_, index): MapNode => ({
      id: `save_deep_${String(index).padStart(5, '0')}`,
      name: `Save deep ${index}`,
      level: 'county',
      mapLayer: 'place',
      parentId: index === 0 ? undefined : `save_deep_${String(index - 1).padStart(5, '0')}`,
      summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
    })).reverse();
    const save = makeSaveWithState('deep-chain-indexeddb-save', state);
    await idbPut('saves', save);

    const loaded = await loadSave(save.id);
    const persisted = await idbGet<SaveData>('saves', save.id);

    expect(loaded?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
    expect(persisted?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
    expect(loaded?.runtimeState.currentLocationId).toBe(state.currentLocationId);
    const index = buildRuntimeMapIndex(worldBook_ThreeKingdoms, loaded?.runtimeState ?? state);
    expect(Object.keys(index.nodeById).filter((id) => id.startsWith('save_deep_'))).toHaveLength(nodeCount);
  });

  it('does not let a read-time migration overwrite a newer concurrent turn commit', async () => {
    const save = makeSaveData('read-migration-race-save', '迁移旧状态');
    save.runtimeStateMigrationVersion = 1;
    await idbPut('saves', save);
    const commitSuccessfulTurn = getAtomicSaveApi('commitSuccessfulTurn');
    const database = await openLocalDatabase();
    const prototype = Object.getPrototypeOf(
      database.transaction('saves', 'readonly').objectStore('saves'),
    );
    const originalGet = prototype.get;
    let concurrentCommit: Promise<AtomicTurnCommitResult | null> | undefined;
    let intercepted = false;
    const getSpy = vi.spyOn(prototype, 'get').mockImplementation(function (
      this: IDBObjectStore,
      ...args: unknown[]
    ) {
      const query = args[0] as IDBValidKey | IDBKeyRange;
      const request = originalGet.call(this, query) as IDBRequest;
      if (!intercepted && this.name === 'saves' && query === save.id) {
        intercepted = true;
        request.addEventListener('success', () => {
          concurrentCommit = commitSuccessfulTurn({
            saveId: save.id,
            runtimeState: makeStateWithTurns('并发提交的新状态', 1),
            turnNumber: 1,
            snapshot: {
              beforeState: save.runtimeState,
              actionText: '并发新行动',
              createdAt: '2026-07-12T01:00:00.000Z',
            },
            maxDepth: 10,
          });
        }, { once: true });
      }
      return request;
    });

    await loadSave(save.id);
    await concurrentCommit;
    getSpy.mockRestore();

    const finalSave = await idbGet<SaveData>('saves', save.id);
    expect(finalSave?.runtimeState.player.name).toBe('并发提交的新状态');
    expect(finalSave?.runtimeState.turnLog).toHaveLength(1);
  });

  it('resolves official worldbook seeds on ordinary load without StartScreen registry initialization', async () => {
    const save = makeSaveWithState('official-location-load', makeOfficialSeedDuplicateState());
    await idbPut('saves', save);

    const loaded = await loadSave(save.id);

    expect(loaded?.runtimeState.currentLocationId).toBe('place_jingzhou_xinye');
    expect(loaded?.runtimeState.currentPlaceId).toBe('place_jingzhou_xinye');
    expect(loaded?.runtimeState.mapNodes?.some((node) => node.id === 'runtime_xinye_duplicate')).toBe(false);
    expect(loaded?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
  });

  it('resolves official worldbook seeds during archive import without StartScreen registry initialization', async () => {
    const save = makeSaveWithState('official-location-import', makeOfficialSeedDuplicateState());

    await importSaves({
      schema: 'coc.v2.saves',
      version: 2,
      exportedAt: '2026-07-12T00:00:00.000Z',
      lastSaveId: save.id,
      saves: [save],
      turnSnapshots: [],
    }, { mode: 'replace' });

    const loaded = await loadSave(save.id);
    expect(loaded?.runtimeState.currentLocationId).toBe('place_jingzhou_xinye');
    expect(loaded?.runtimeState.mapNodes?.some((node) => node.id === 'runtime_xinye_duplicate')).toBe(false);
    expect(loaded?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
  });

  it('does not mark seed-dependent v6 complete when a custom worldbook definition is unavailable', async () => {
    const state = makeState('缺失世界书');
    state.worldBookId = 'missing-custom-location-worldbook';
    state.worldBookSource = 'custom';
    state.mapNodes = [{
      id: 'runtime_place', name: '无名县', level: 'county', mapLayer: 'place',
      summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
    }];
    const save = makeSaveWithState('missing-worldbook-save', state);
    await idbPut('saves', save);

    const loaded = await loadSave(save.id);

    expect(loaded?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION - 1);
    expect(loaded?.runtimeStateMigrationDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'location-worldbook-unavailable' }),
    ]));
  });

  it('keeps an empty-map v3 save retryable until its custom worldbook is registered', async () => {
    const state = makeState('延迟世界书空地图');
    state.worldBookId = 'delayed-empty-map-save-worldbook';
    state.worldBookSource = 'custom';
    state.mapNodes = [];
    const save = makeSaveWithState('delayed-empty-map-save', state);
    await idbPut('saves', save);

    const deferred = await loadSave(save.id);

    expect(deferred?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION - 1);
    expect(deferred?.runtimeStateMigrationDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'location-worldbook-unavailable' }),
    ]));

    registerWorldBook({
      ...worldBook_ThreeKingdoms,
      manifest: {
        ...worldBook_ThreeKingdoms.manifest,
        id: state.worldBookId,
        source: 'custom',
      },
      mapSeed: [],
      openingLocationSeed: [],
    });

    const completed = await loadSave(save.id);
    expect(completed?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
    expect(completed?.runtimeStateMigrationDiagnostics).toBeUndefined();
  });

  it('persists every normalized top-level worldbook summary when migration state is unchanged', async () => {
    const state = makeState('Summary normalization');
    state.worldBookId = 'missing-summary-normalization-worldbook';
    state.worldBookVersion = 'runtime-version';
    state.worldBookSource = 'custom';
    state.startBookmarkId = 'runtime-bookmark';
    state.startDate = 'runtime-start';
    state.mapNodes = [];
    const save = makeSaveWithState('summary-normalization-save', state);
    await idbPut('saves', save);
    const baseline = await loadSave(save.id);
    expect(baseline?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION - 1);

    const staleSummarySave: SaveData = {
      ...baseline!,
      worldBookId: 'stale-worldbook',
      worldBookVersion: 'stale-version',
      worldBookSource: 'official',
      startBookmarkId: 'stale-bookmark',
      startDate: 'stale-start',
    };
    await idbPut('saves', staleSummarySave);

    const loaded = await loadSave(save.id);
    const persisted = await idbGet<SaveData>('saves', save.id);
    const listed = (await listSaves()).find((item) => item.id === save.id);
    const expectedSummary = {
      worldBookId: state.worldBookId,
      worldBookVersion: state.worldBookVersion,
      worldBookSource: state.worldBookSource,
      startBookmarkId: state.startBookmarkId,
      startDate: state.startDate,
    };

    expect(loaded).toMatchObject(expectedSummary);
    expect(persisted).toMatchObject(expectedSummary);
    expect(listed).toMatchObject({
      worldBookId: state.worldBookId,
      startBookmarkId: state.startBookmarkId,
    });
    expect(persisted?.runtimeState).toEqual(staleSummarySave.runtimeState);
    expect(persisted?.runtimeStateMigrationVersion).toBe(staleSummarySave.runtimeStateMigrationVersion);
    expect(persisted?.runtimeStateMigrationDiagnostics)
      .toEqual(staleSummarySave.runtimeStateMigrationDiagnostics);
  });

  it('persists location ambiguity diagnostics at the save boundary', async () => {
    const ambiguousWorldBook: WorldBook = {
      ...worldBook_ThreeKingdoms,
      manifest: {
        ...worldBook_ThreeKingdoms.manifest,
        id: 'save-location-ambiguity-worldbook',
        source: 'custom',
      },
      mapSeed: [{
        id: 'region_test', name: '测试郡', level: 'commandery', mapLayer: 'region', summary: '',
        connectedRegionIds: [], controlHint: '', tensionHint: '', subLocations: [{
          id: 'place_candidate_a', name: '甲地', aliases: ['共同别名'], level: 'county', mapLayer: 'place',
          summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
        }, {
          id: 'place_candidate_b', name: '乙地', aliases: ['共同别名'], level: 'county', mapLayer: 'place',
          summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
        }],
      }],
    };
    registerWorldBook(ambiguousWorldBook);
    const state = makeState('歧义地点');
    state.worldBookId = ambiguousWorldBook.manifest.id;
    state.worldBookSource = 'custom';
    state.currentLocationId = 'place_ambiguous';
    state.mapNodes = [{
      id: 'place_ambiguous', name: '共同别名', level: 'county', mapLayer: 'place', parentId: 'region_test',
      summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
    }];
    const save = makeSaveWithState('ambiguous-location-save', state);
    await idbPut('saves', save);

    const loaded = await loadSave(save.id);

    expect(loaded?.runtimeState.currentLocationId).toBe('place_ambiguous');
    expect(loaded?.runtimeStateMigrationDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'location-canonical-ambiguous',
        locationIds: ['place_ambiguous', 'place_candidate_a', 'place_candidate_b'],
      }),
    ]));
  });

  it('migrates a version-1 legacy relationship on ordinary load and persists it only once', async () => {
    const save = makeSaveData('legacy-relationship-save', '旧关系存档');
    save.runtimeStateMigrationVersion = 1;
    save.runtimeState.relationships = [{
      id: 'relationship_legacy',
      actorId: 'actor_source',
      targetId: 'faction_target',
      targetType: 'faction',
      type: 'neutral',
      value: 10,
      description: 'Legacy relationship.',
    } as RuntimeState['relationships'][number]];
    await idbPut('saves', save);

    const loaded = await loadSave(save.id);

    expect(loaded?.runtimeState.relationships[0]).toMatchObject({
      targetKind: 'faction',
      targetType: 'faction',
    });
    const persisted = await idbGet<SaveData>('saves', save.id);
    expect(persisted?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
    expect(persisted?.runtimeState.relationships[0]).toMatchObject({
      targetKind: 'faction',
      targetType: 'faction',
    });

    const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put');
    await loadSave(save.id);
    expect(putSpy).not.toHaveBeenCalled();
    putSpy.mockRestore();
  });

  it('rejects an old ordinary save with an out-of-range relationship without rewriting it', async () => {
    const save = makeSaveData('old-save-invalid-relationship-value', '旧档越界关系');
    save.runtimeStateMigrationVersion = 2;
    save.runtimeState.relationships = [{
      id: 'relationship_old_save_out_of_range',
      actorId: 'actor_source',
      targetId: 'actor_target',
      targetKind: 'actor',
      targetType: 'actor',
      type: 'neutral',
      value: 101,
      description: 'Invalid old save relationship.',
    }];
    await idbPut('saves', save);

    await expect(loadSave(save.id)).rejects.toThrow(/value|关系值|-100|100/);
    expect(await idbGet<SaveData>('saves', save.id)).toEqual(save);
  });

  it('normalizes legacy relationships in both saves and imported rollback snapshots', async () => {
    const save = makeSaveData('legacy-relationship-archive', '旧关系归档');
    save.runtimeStateMigrationVersion = 1;
    save.runtimeState.relationships = [{
      id: 'relationship_save_legacy',
      actorId: 'actor_source',
      targetId: 'faction_target',
      targetType: 'faction',
      type: 'neutral',
      value: 10,
      description: 'Legacy save relationship.',
    } as RuntimeState['relationships'][number]];
    const snapshot = makeStoredSnapshot(save.id, 1, '旧关系行动');
    snapshot.snapshot.beforeState.relationships = [{
      id: 'relationship_snapshot_legacy',
      actorId: 'actor_source',
      targetId: 'actor_target',
      targetType: 'actor',
      type: 'neutral',
      value: 5,
      description: 'Legacy snapshot relationship.',
    } as RuntimeState['relationships'][number]];

    await importSaves({
      schema: 'coc.v2.saves',
      version: 2,
      exportedAt: '2026-07-12T00:00:00.000Z',
      lastSaveId: save.id,
      saves: [save],
      turnSnapshots: [snapshot],
    }, { mode: 'replace' });

    expect((await loadSave(save.id))?.runtimeState.relationships[0]).toMatchObject({
      targetKind: 'faction',
      targetType: 'faction',
    });
    const loadedSnapshot = await loadTurnSnapshot(save.id, 1);
    expect(loadedSnapshot?.snapshot.beforeState.relationships[0]).toMatchObject({
      targetKind: 'actor',
      targetType: 'actor',
    });
    expect(loadedSnapshot?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
  });

  it.each([
    { targetKind: 'actor', targetType: 'faction' },
    { targetKind: 'invalid', targetType: 'faction' },
  ])('rejects an imported relationship with invalid kind fields atomically %#', async (kindFields) => {
    await seedExistingArchiveState();
    const before = await readPersistenceFingerprint();
    const imported = makeSaveData('invalid-relationship-import', '非法关系导入');
    imported.runtimeState.relationships = [{
      id: 'relationship_invalid',
      actorId: 'actor_source',
      targetId: 'faction_target',
      type: 'neutral',
      value: 10,
      description: 'Invalid relationship.',
      ...kindFields,
    } as RuntimeState['relationships'][number]];

    await expect(importSaves({
      schema: 'coc.v2.saves',
      version: 2,
      exportedAt: '2026-07-12T00:00:00.000Z',
      lastSaveId: imported.id,
      saves: [imported],
      turnSnapshots: [],
    }, { mode: 'replace' })).rejects.toThrow();

    expect(await readPersistenceFingerprint()).toEqual(before);
  });

  it.each([
    { mode: 'replace' as const, value: 101 },
    { mode: 'merge' as const, value: -101 },
  ])('rejects $mode import with out-of-range relationship value atomically', async ({ mode, value }) => {
    await seedExistingArchiveState();
    const before = await readPersistenceFingerprint();
    const imported = makeSaveData(`invalid-relationship-value-${mode}`, '越界关系导入');
    imported.runtimeState.relationships = [{
      id: 'relationship_out_of_range',
      actorId: 'actor_source',
      targetId: 'actor_target',
      targetKind: 'actor',
      targetType: 'actor',
      type: 'neutral',
      value,
      description: 'Out-of-range relationship.',
    }];

    await expect(importSaves({
      schema: 'coc.v2.saves',
      version: 2,
      exportedAt: '2026-07-12T00:00:00.000Z',
      lastSaveId: imported.id,
      saves: [imported],
      turnSnapshots: [],
    }, { mode })).rejects.toThrow();

    expect(await readPersistenceFingerprint()).toEqual(before);
  });

  it('ignores a migration marker supplied by an imported archive and normalizes the runtime state', async () => {
    const save = makeSaveData('forged-marker-save', '伪造标记');
    save.runtimeState.memoryArchive = undefined;
    (save as SaveData & { runtimeStateMigrationVersion?: number }).runtimeStateMigrationVersion = 1;

    await importSaves({
      schema: 'coc.v2.saves',
      version: 2,
      exportedAt: '2026-07-10T00:00:00.000Z',
      lastSaveId: save.id,
      saves: [save],
      turnSnapshots: [],
    }, { mode: 'replace' });

    expect((await loadSave(save.id))?.runtimeState.memoryArchive).toBeDefined();
  });

  it('rejects imported saves and runtime states from a newer engine version', async () => {
    const save = makeSaveData('future-save', '未来版本');
    save.engineVersion = '9.0.0';
    save.runtimeState.engineVersion = '9.0.0';

    await expect(importSaves({
      schema: 'coc.v2.saves',
      version: 2,
      exportedAt: '2026-07-10T00:00:00.000Z',
      lastSaveId: save.id,
      saves: [save],
      turnSnapshots: [],
    }, { mode: 'replace' })).rejects.toThrow();
  });

  it('exports and imports recent turn snapshots with save archives', async () => {
    const save = await createSave(makeState('刘达'), '刘达开局');
    await saveTurnSnapshot({
      saveId: save.id,
      turnNumber: 1,
      snapshot: {
        beforeState: makeState('刘达'),
        actionText: '试探城门守军',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      maxDepth: 10,
    });

    const archive = await exportSaves();

    expect(archive.turnSnapshots?.[0]).toMatchObject({
      saveId: save.id,
      turnNumber: 1,
    });

    await clearAllSaves();
    expect(await loadTurnSnapshot(save.id, 1)).toBeNull();

    await importSaves(archive);

    expect((await loadTurnSnapshot(save.id, 1))?.snapshot.actionText).toBe('试探城门守军');
  });

  it('creates manual saves without replacing the current auto save', async () => {
    const autoSave = await createSave(makeState('刘达'), '刘达开局');
    const manualSave = await createManualSave(makeState('刘达'), '刘达手动存档');

    const saves = await listSaves();
    expect(saves).toHaveLength(2);
    expect(saves.find((save) => save.id === autoSave.id)?.saveKind).toBe('auto');
    expect(saves.find((save) => save.id === manualSave.id)?.saveKind).toBe('manual');
    expect((await continueLastSave())?.id).toBe(autoSave.id);
  });

  it('creates visible auto checkpoints only on the configured turn interval', async () => {
    const active = await createSave(makeStateWithTurns('轮转主角', 0), '当前进度');
    const manual = await createManualSave(makeStateWithTurns('轮转主角', 0), '手动留档');
    const commitSuccessfulTurn = getAtomicSaveApi('commitSuccessfulTurn');

    const first = await commitSuccessfulTurn({
      saveId: active.id,
      runtimeState: makeStateWithTurns('轮转主角', 1),
      turnNumber: 1,
      snapshot: {
        beforeState: makeStateWithTurns('轮转主角', 0),
        actionText: '第一回合',
        createdAt: '2026-07-16T00:01:00.000Z',
      },
      maxDepth: 10,
      autoSave: { intervalTurns: 2, limit: 3 },
    });
    expect(first?.autoSaveCreated).toBeUndefined();
    expect((await listSaves()).filter((save) => save.saveKind === 'auto')).toHaveLength(1);

    const second = await commitSuccessfulTurn({
      saveId: active.id,
      runtimeState: makeStateWithTurns('轮转主角', 2),
      turnNumber: 2,
      snapshot: {
        beforeState: makeStateWithTurns('轮转主角', 1),
        actionText: '第二回合',
        createdAt: '2026-07-16T00:02:00.000Z',
      },
      maxDepth: 10,
      autoSave: { intervalTurns: 2, limit: 3 },
    });
    expect(second?.autoSaveCreated?.label).toContain('第2回合自动存档');
    expect((await listSaves()).filter((save) => save.saveKind === 'auto')).toHaveLength(2);

    await pruneAutoSaves(1, active.id);
    const retained = await listSaves();
    expect(retained.filter((save) => save.saveKind === 'auto').map((save) => save.id)).toEqual([active.id]);
    expect(retained.find((save) => save.id === manual.id)?.saveKind).toBe('manual');
  });

  it('compacts old derived turn diagnostics but keeps complete narrative and recent diagnostics', async () => {
    const state = makeStateWithTurns('精简主角', 7);
    state.turnLog = state.turnLog.map((entry, index) => ({
      ...entry,
      fullNarrativeText: `完整正文 ${index + 1}`,
      displayMeta: {
        rawResponse: `大型原始响应 ${index + 1} ${'响应缓存'.repeat(1_000)}`,
        reasoningSummary: `推理摘要 ${index + 1} ${'诊断缓存'.repeat(500)}`,
        promptTokenEstimate: {
          total: { chars: 10, estimatedTokens: 3, lowerBound: 2, upperBound: 4 },
          layers: [],
          contextBreakdown: [],
        },
        processingStages: [],
        memoryRecall: {
          query: `第${index + 1}回合召回`,
          candidateCount: 1,
          omittedCount: 0,
          strong: [],
          weak: [],
        },
        npcIntentSimulation: {
          status: 'completed',
          targetNpcIds: ['npc_1'],
          package: {
            protocolVersion: 'coc.v2.npcIntent.v1',
            generatedAt: '2026-07-16T00:00:00.000Z',
            source: 'npcSimulation',
            intents: [],
          },
        },
      },
    }));

    const originalBytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
    const save = await createSave(state, '精简测试');
    const loaded = await loadSave(save.id);
    const oldest = loaded?.runtimeState.turnLog[0];
    const recent = loaded?.runtimeState.turnLog[6];

    expect(oldest?.fullNarrativeText).toBe('完整正文 1');
    expect(oldest?.displayMeta?.rawResponse).toBeUndefined();
    expect(oldest?.displayMeta?.reasoningSummary).toBeUndefined();
    expect(oldest?.displayMeta?.promptTokenEstimate).toBeUndefined();
    expect(oldest?.displayMeta?.memoryRecall).toBeUndefined();
    expect(oldest?.displayMeta?.npcIntentSimulation?.package).toBeUndefined();
    expect(recent?.displayMeta?.rawResponse).toContain('大型原始响应 7');
    expect(recent?.displayMeta?.memoryRecall?.query).toBe('第7回合召回');
    const compactedBytes = new TextEncoder().encode(JSON.stringify(loaded?.runtimeState)).byteLength;
    expect(compactedBytes).toBeLessThan(originalBytes * 0.85);
  });

  it('round-trips real TurnResult location warnings through atomic commit and save load', async () => {
    const mapIndex = buildMapV1Index(getWorldBookMapRoots(worldBook_ThreeKingdoms));
    const seedPlace = mapIndex.nodeById.place_jingzhou_xinye;
    const seedParentId = mapIndex.parentIdByNodeId[seedPlace.id];
    const beforeState = makeState('地图诊断主角');
    beforeState.worldBookId = worldBook_ThreeKingdoms.manifest.id;
    beforeState.worldBookVersion = worldBook_ThreeKingdoms.manifest.version;
    beforeState.worldBookSource = 'official';
    beforeState.currentLocationId = seedPlace.id;
    beforeState.currentPlaceId = seedPlace.id;
    const save = await createSave(beforeState, '地图诊断往返');
    const apiConfig: ApiConfigArchive = {
      id: 'turn-persistence-api', name: 'turn-persistence-api', provider: 'openai_compatible',
      baseUrl: 'https://example.com/v1', apiKey: 'test', model: 'test-model',
      createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
    };
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '地图记录存在冲突。',
        suggestedActions: [],
        statePatches: [{ type: 'timeAdvance', payload: { minutesAdvanced: 5 }, reason: '查验地图' }],
        writeback: {
          npcMemorySuggestions: [],
          locationWriteSuggestions: [{
            locationId: seedPlace.id,
            name: seedPlace.name,
            aliases: seedPlace.aliases ?? [],
            kind: 'COUNTY',
            mapLayer: seedPlace.mapLayer,
            parentId: seedParentId,
            summary: 'invalid scope representation',
            permanence: 'permanent',
          }],
          routeWriteSuggestions: [{
            routeId: 'route_scope_warning',
            fromPlaceId: seedParentId,
            toPlaceId: seedPlace.id,
            name: '非法区域路线',
            status: '未知',
            knownLevel: '推测',
          }],
          questChanges: [],
          debugNotes: [],
        },
      }),
      provider: 'openai_compatible' as const,
      model: 'test-model',
    })) };

    const turnResult = await executeTurn(
      worldBook_ThreeKingdoms,
      beforeState,
      '查验地图',
      { apiConfig, llmClient },
    );
    expect(turnResult.locationWritebackErrors).not.toEqual([]);
    expect(turnResult.routeWritebackErrors).not.toEqual([]);
    expect(turnResult.locationWritebackDiagnostics).toEqual([
      expect.objectContaining({ code: 'location-canonical-scope-conflict' }),
    ]);

    const commitSuccessfulTurn = getAtomicSaveApi('commitSuccessfulTurn');
    await commitSuccessfulTurn({
      saveId: save.id,
      runtimeState: turnResult.newRuntimeState,
      turnNumber: 1,
      snapshot: {
        beforeState,
        actionText: '查验地图',
        createdAt: '2026-07-12T00:01:00.000Z',
      },
      maxDepth: 10,
    });

    const loaded = await loadSave(save.id);
    const persistedTurnLog = loaded?.runtimeState.turnLog ?? [];
    const persistedWarnings = persistedTurnLog[persistedTurnLog.length - 1]?.displayMeta?.locationWriteback;
    expect(persistedWarnings).toEqual(turnResult.turnDisplayMeta.locationWriteback);
    expect(persistedWarnings).toEqual({
      errors: turnResult.locationWritebackErrors,
      routeErrors: turnResult.routeWritebackErrors,
      diagnostics: turnResult.locationWritebackDiagnostics,
    });
  });

  it('round-trips independent map writes when an invalid movement patch is rejected', async () => {
    const mapIndex = buildMapV1Index(getWorldBookMapRoots(worldBook_ThreeKingdoms));
    const seedPlace = mapIndex.nodeById.place_jingzhou_xinye;
    const seedParentId = mapIndex.parentIdByNodeId[seedPlace.id];
    const beforeState = makeState('地图回滚主角');
    beforeState.worldBookId = worldBook_ThreeKingdoms.manifest.id;
    beforeState.worldBookVersion = worldBook_ThreeKingdoms.manifest.version;
    beforeState.worldBookSource = 'official';
    beforeState.currentLocationId = seedPlace.id;
    beforeState.currentPlaceId = seedPlace.id;
    const save = await createSave(beforeState, '地图回滚往返');
    const apiConfig: ApiConfigArchive = {
      id: 'turn-rollback-api', name: 'turn-rollback-api', provider: 'openai_compatible',
      baseUrl: 'https://example.com/v1', apiKey: 'test', model: 'test-model',
      createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
    };
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '地图草案因状态补丁失败而撤销。',
        suggestedActions: [],
        statePatches: [
          { type: 'timeAdvance', payload: { minutesAdvanced: 5 }, reason: '移动耗时' },
          { type: 'locationChange', payload: { toLocationId: 'missing_place' }, reason: '无效移动' },
        ],
        writeback: {
          npcMemorySuggestions: [],
          locationWriteSuggestions: [{
            locationId: 'incoming_outpost', name: '新营地', kind: 'county', mapLayer: 'place',
            parentId: seedParentId, summary: 'prepared location', permanence: 'permanent',
          }],
          routeWriteSuggestions: [{
            routeId: 'route_prepared', fromPlaceId: seedPlace.id, toPlaceId: 'incoming_outpost',
            name: '营地小路', status: '可通行', knownLevel: '亲历',
          }],
          questChanges: [], debugNotes: [],
        },
      }),
      provider: 'openai_compatible' as const,
      model: 'test-model',
    })) };

    const turnResult = await executeTurn(
      worldBook_ThreeKingdoms,
      beforeState,
      '尝试移动',
      { apiConfig, llmClient },
    );
    expect(turnResult.patchValidation?.valid).toBe(false);
    expect(turnResult.locationWritebackDiagnostics).toEqual([]);
    expect(turnResult.newRuntimeState.currentLocationId).toBe(seedPlace.id);
    expect(turnResult.newRuntimeState.mapNodes?.some((node) => node.id === 'incoming_outpost')).toBe(true);
    expect(turnResult.newRuntimeState.routeEdges?.some((route) => route.routeId === 'route_prepared')).toBe(true);

    const commitSuccessfulTurn = getAtomicSaveApi('commitSuccessfulTurn');
    await commitSuccessfulTurn({
      saveId: save.id,
      runtimeState: turnResult.newRuntimeState,
      turnNumber: 1,
      snapshot: {
        beforeState,
        actionText: '尝试移动',
        createdAt: '2026-07-12T00:02:00.000Z',
      },
      maxDepth: 10,
    });

    const loaded = await loadSave(save.id);
    const persistedTurnLog = loaded?.runtimeState.turnLog ?? [];
    const persistedTurn = persistedTurnLog[persistedTurnLog.length - 1];
    expect(persistedTurn?.displayMeta?.locationWriteback)
      .toEqual(turnResult.turnDisplayMeta.locationWriteback);
    expect(persistedTurn?.displayMeta?.locationWriteback?.diagnostics).toEqual([]);
    expect(loaded?.runtimeState.currentLocationId).toBe(seedPlace.id);
    expect(loaded?.runtimeState.mapNodes?.some((node) => node.id === 'incoming_outpost')).toBe(true);
    expect(loaded?.runtimeState.routeEdges?.some((route) => route.routeId === 'route_prepared')).toBe(true);
  });

  it('loads and persists normalized old saves with duplicated location-backed holdings', async () => {
    const runtimeState: RuntimeState = {
      ...makeState('刘峙'),
      holdings: [
        {
          holdingId: 'place_jingzhou_xinye',
          name: '新野县',
          type: 'county',
          status: 'controlled',
          summary: '刘峙接管的新野县。',
          locationId: 'place_jingzhou_xinye',
          scaleLevel: 2,
          agriculture: 55,
          commerce: 40,
          population: 60,
          publicOrder: 50,
          popularSupport: 45,
          defense: 35,
          recruitPotential: 30,
          armory: 20,
          horseSupply: 10,
          corruption: 25,
          recentChanges: ['接管新野'],
          updatedAt: '194-08-19 10:00',
        },
        {
          holdingId: 'holding_xinye',
          name: '新野县',
          type: 'county',
          status: 'controlled',
          summary: '刘峙随后整顿的新野县。',
          locationId: 'place_jingzhou_xinye',
          scaleLevel: 2,
          agriculture: 58,
          commerce: 41,
          population: 61,
          publicOrder: 53,
          popularSupport: 47,
          defense: 36,
          recruitPotential: 31,
          armory: 21,
          horseSupply: 10,
          corruption: 23,
          recentChanges: ['整顿县政'],
          updatedAt: '194-08-20 08:00',
        },
      ],
    };
    const save: SaveData = {
      id: 'save_with_duplicate_xinye',
      label: '重复新野县旧档',
      saveKind: 'auto',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
      engineVersion: '0.1.0',
      worldBookId: runtimeState.worldBookId,
      worldBookVersion: runtimeState.worldBookVersion,
      worldBookSource: runtimeState.worldBookSource,
      startBookmarkId: runtimeState.startBookmarkId,
      startDate: runtimeState.startDate,
      currentDate: runtimeState.currentDate,
      runtimeState,
    };

    await importSaves({
      schema: 'coc.v2.saves',
      version: 2,
      exportedAt: '2026-07-07T00:00:00.000Z',
      lastSaveId: save.id,
      saves: [save],
      turnSnapshots: [],
    }, { mode: 'replace' });

    const loaded = await loadSave(save.id);

    expect(loaded?.runtimeState.holdings).toHaveLength(1);
    expect(loaded?.runtimeState.holdings?.[0]).toMatchObject({
      holdingId: 'place_jingzhou_xinye',
      name: '新野县',
      locationId: 'place_jingzhou_xinye',
      recentChanges: ['接管新野', '整顿县政'],
    });

    const exported = await exportSaves();
    expect(exported.saves[0].runtimeState.holdings).toHaveLength(1);
  });

  it('cancels a queued successful-turn commit without changing save, snapshots, or lastSaveId', async () => {
    const saveA = await createSave(makeStateWithTurns('甲档主角', 0), '甲档');
    await saveTurnSnapshot({
      saveId: saveA.id,
      turnNumber: 1,
      snapshot: {
        beforeState: makeStateWithTurns('甲档主角', 0),
        actionText: '旧行动',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
      maxDepth: 10,
    });
    const saveB = await createSave(makeStateWithTurns('乙档主角', 0), '乙档');
    const blocker = await holdPersistenceWriteLock();
    const controller = new AbortController();
    const cancellation = new TurnExecutionCancelledError();
    const commitSuccessfulTurn = getAtomicSaveApi('commitSuccessfulTurn');

    const pendingCommit = commitSuccessfulTurn({
      saveId: saveA.id,
      runtimeState: makeStateWithTurns('甲档主角', 1),
      turnNumber: 2,
      snapshot: {
        beforeState: makeStateWithTurns('甲档主角', 1),
        actionText: '迟到行动',
        createdAt: '2026-07-10T00:01:00.000Z',
      },
      maxDepth: 10,
      signal: controller.signal,
    });
    const commitCancellation = expect(pendingCommit).rejects.toBe(cancellation);
    await Promise.resolve();
    controller.abort(cancellation);
    blocker.release();
    await blocker.completed;

    await commitCancellation;
    expect((await loadSave(saveA.id))?.runtimeState.turnLog).toHaveLength(0);
    expect((await listTurnSnapshots(saveA.id)).map((snapshot) => snapshot.turnNumber)).toEqual([1]);
    expect((await continueLastSave())?.id).toBe(saveB.id);
  });

  it('cancels a queued rollback restore without deleting snapshots or changing the current pointer', async () => {
    const saveA = await createSave(makeStateWithTurns('甲档主角', 2), '甲档');
    for (const turnNumber of [1, 2]) {
      await saveTurnSnapshot({
        saveId: saveA.id,
        turnNumber,
        snapshot: {
          beforeState: makeStateWithTurns('甲档主角', turnNumber - 1),
          actionText: `行动 ${turnNumber}`,
          createdAt: `2026-07-10T00:0${turnNumber}:00.000Z`,
        },
        maxDepth: 10,
      });
    }
    const saveB = await createSave(makeStateWithTurns('乙档主角', 0), '乙档');
    const blocker = await holdPersistenceWriteLock();
    const controller = new AbortController();
    const cancellation = new TurnExecutionCancelledError();
    const commitTurnRestore = getAtomicSaveApi('commitTurnRestore');

    const pendingRestore = commitTurnRestore({
      saveId: saveA.id,
      runtimeState: makeStateWithTurns('甲档主角', 1),
      deleteSnapshotsAfterTurn: 1,
      signal: controller.signal,
    });
    const restoreCancellation = expect(pendingRestore).rejects.toBe(cancellation);
    await Promise.resolve();
    controller.abort(cancellation);
    blocker.release();
    await blocker.completed;

    await restoreCancellation;
    expect((await loadSave(saveA.id))?.runtimeState.turnLog).toHaveLength(2);
    expect((await listTurnSnapshots(saveA.id)).map((snapshot) => snapshot.turnNumber)).toEqual([1, 2]);
    expect((await continueLastSave())?.id).toBe(saveB.id);
  });

  it('cancels queued createSave without leaving an orphan save or changing lastSaveId', async () => {
    const saveA = await createSave(makeStateWithTurns('甲档主角', 0), '甲档');
    const blocker = await holdPersistenceWriteLock();
    const controller = new AbortController();
    const cancellation = new TurnExecutionCancelledError();
    const createSaveWithSignal = createSave as unknown as (
      state: RuntimeState,
      label: string,
      options: { signal?: AbortSignal },
    ) => Promise<SaveData>;

    const pendingCreate = createSaveWithSignal(
      makeStateWithTurns('取消的新档', 0),
      '取消的新档',
      { signal: controller.signal },
    );
    const createCancellation = expect(pendingCreate).rejects.toBe(cancellation);
    await Promise.resolve();
    controller.abort(cancellation);
    blocker.release();
    await blocker.completed;

    await createCancellation;
    expect((await listSaves()).map((save) => save.id)).toEqual([saveA.id]);
    expect((await continueLastSave())?.id).toBe(saveA.id);
  });

  describe('archive prevalidation', () => {
    it.each([
      {
        name: '第二条 save 的 runtime state 无法归一化',
        buildArchive: () => ({
          schema: 'coc.v2.saves',
          version: 2,
          exportedAt: '2026-07-10T00:00:00.000Z',
          lastSaveId: 'import-a',
          saves: [
            makeSaveData('import-a', '导入甲'),
            { ...makeSaveData('import-b', '导入乙'), runtimeState: null },
          ],
          turnSnapshots: [],
        }),
      },
      {
        name: 'save runtimeState 为空对象',
        buildArchive: () => ({
          schema: 'coc.v2.saves',
          version: 2,
          exportedAt: '2026-07-10T00:00:00.000Z',
          lastSaveId: 'empty-runtime',
          saves: [{ ...makeSaveData('empty-runtime', '空运行态'), runtimeState: {} }],
          turnSnapshots: [],
        }),
      },
      {
        name: 'save runtimeState 缺少 required array',
        buildArchive: () => {
          const save = makeSaveData('missing-array', '缺少数组');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: { ...save.runtimeState, knownActors: undefined },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save runtimeState player 缺少必需字符串',
        buildArchive: () => {
          const save = makeSaveData('invalid-player', '损坏玩家');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: {
                ...save.runtimeState,
                player: { ...save.runtimeState.player, summary: undefined },
              },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save runtimeState required record 为数组',
        buildArchive: () => {
          const save = makeSaveData('invalid-record', '损坏记录');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: { ...save.runtimeState, playerResources: [] },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save label 不是字符串',
        buildArchive: () => ({
          schema: 'coc.v2.saves',
          version: 2,
          exportedAt: '2026-07-10T00:00:00.000Z',
          lastSaveId: 'invalid-label',
          saves: [{ ...makeSaveData('invalid-label', '坏标签'), label: null }],
          turnSnapshots: [],
        }),
      },
      {
        name: 'save knownActors 包含空元素',
        buildArchive: () => {
          const save = makeSaveData('invalid-known-actor', '损坏人物数组');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: { ...save.runtimeState, knownActors: [null] },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save turnLog 包含空元素',
        buildArchive: () => {
          const save = makeSaveData('invalid-turn-log', '损坏回合日志');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: { ...save.runtimeState, turnLog: [null] },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save playerResources 包含非数值资源',
        buildArchive: () => {
          const save = makeSaveData('invalid-resources', '损坏资源');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: {
                ...save.runtimeState,
                playerResources: { money: 'not-a-number' },
              },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save 可选 npcs 使用错误容器',
        buildArchive: () => {
          const save = makeSaveData('invalid-optional-npcs', '损坏 NPC 容器');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: { ...save.runtimeState, npcs: {} },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save 可选 troops 包含空元素',
        buildArchive: () => {
          const save = makeSaveData('invalid-optional-troops', '损坏部队集合');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: { ...save.runtimeState, troops: [null] },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save 可选 court 使用数组容器',
        buildArchive: () => {
          const save = makeSaveData('invalid-optional-court', '损坏朝堂容器');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: { ...save.runtimeState, court: [] },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save player.traits 使用错误容器',
        buildArchive: () => {
          const save = makeSaveData('invalid-player-traits', '损坏角色特质容器');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: {
                ...save.runtimeState,
                player: { ...save.runtimeState.player, traits: {} },
              },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save resources.weapons 使用错误容器',
        buildArchive: () => {
          const save = makeSaveData('invalid-resource-weapons', '损坏军械容器');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: {
                ...save.runtimeState,
                resources: { ...save.runtimeState.resources, weapons: {} },
              },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save memoryArchive.recentTurnSummaries 使用错误容器',
        buildArchive: () => {
          const save = makeSaveData('invalid-memory-summaries', '损坏记忆容器');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: {
                ...save.runtimeState,
                memoryArchive: {
                  ...save.runtimeState.memoryArchive,
                  recentTurnSummaries: {},
                },
              },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save activeQuests.relatedLocationIds 使用错误容器',
        buildArchive: () => {
          const save = makeSaveData('invalid-quest-related-locations', '损坏事项引用容器');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: {
                ...save.runtimeState,
                activeQuests: [{
                  id: 'quest-bad-container',
                  title: '损坏事项',
                  description: '用于验证嵌套容器边界。',
                  status: 'active',
                  createdAt: '184年3月',
                  updatedAt: '184年3月',
                  relatedLocationIds: {},
                }],
              },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save knownRumors.affectedNpcIds 使用错误容器',
        buildArchive: () => {
          const save = makeSaveData('invalid-rumor-affected-npcs', '损坏风声引用容器');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: {
                ...save.runtimeState,
                knownRumors: [{
                  id: 'rumor-bad-container',
                  content: '损坏风声',
                  source: '测试',
                  verified: false,
                  createdAt: '184年3月',
                  affectedNpcIds: {},
                }],
              },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save holdings.recentChanges 使用错误容器',
        buildArchive: () => {
          const save = makeSaveData('invalid-holding-recent-changes', '损坏领地变化容器');
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: save.id,
            saves: [{
              ...save,
              runtimeState: {
                ...save.runtimeState,
                holdings: [{
                  holdingId: 'holding-bad-container',
                  name: '损坏领地',
                  type: 'county',
                  status: 'controlled',
                  summary: '用于验证嵌套容器边界。',
                  scaleLevel: 1,
                  agriculture: 0,
                  commerce: 0,
                  population: 0,
                  publicOrder: 0,
                  popularSupport: 0,
                  defense: 0,
                  recruitPotential: 0,
                  armory: 0,
                  horseSupply: 0,
                  corruption: 0,
                  recentChanges: {},
                  updatedAt: '184年3月',
                }],
              },
            }],
            turnSnapshots: [],
          };
        },
      },
      {
        name: 'save engineVersion 为空',
        buildArchive: () => ({
          schema: 'coc.v2.saves',
          version: 2,
          exportedAt: '2026-07-10T00:00:00.000Z',
          lastSaveId: 'empty-engine-version',
          saves: [{
            ...makeSaveData('empty-engine-version', '空引擎版本'),
            engineVersion: '',
          }],
          turnSnapshots: [],
        }),
      },
      {
        name: '快照引用 archive 外的 save',
        buildArchive: () => ({
          schema: 'coc.v2.saves',
          version: 2,
          exportedAt: '2026-07-10T00:00:00.000Z',
          lastSaveId: 'import-a',
          saves: [makeSaveData('import-a', '导入甲')],
          turnSnapshots: [makeStoredSnapshot('missing-save', 1)],
        }),
      },
      {
        name: 'save id 重复',
        buildArchive: () => ({
          schema: 'coc.v2.saves',
          version: 2,
          exportedAt: '2026-07-10T00:00:00.000Z',
          lastSaveId: 'duplicate-save',
          saves: [
            makeSaveData('duplicate-save', '导入甲'),
            makeSaveData('duplicate-save', '导入乙'),
          ],
          turnSnapshots: [],
        }),
      },
      {
        name: '同一 save 和 turnNumber 的快照重复',
        buildArchive: () => ({
          schema: 'coc.v2.saves',
          version: 2,
          exportedAt: '2026-07-10T00:00:00.000Z',
          lastSaveId: 'import-a',
          saves: [makeSaveData('import-a', '导入甲')],
          turnSnapshots: [
            makeStoredSnapshot('import-a', 1, '第一条'),
            makeStoredSnapshot('import-a', 1, '第二条'),
          ],
        }),
      },
      {
        name: 'lastSaveId 引用 archive 外的 save',
        buildArchive: () => ({
          schema: 'coc.v2.saves',
          version: 2,
          exportedAt: '2026-07-10T00:00:00.000Z',
          lastSaveId: 'missing-save',
          saves: [makeSaveData('import-a', '导入甲')],
          turnSnapshots: [],
        }),
      },
      {
        name: 'save id 为空',
        buildArchive: () => ({
          schema: 'coc.v2.saves',
          version: 2,
          exportedAt: '2026-07-10T00:00:00.000Z',
          lastSaveId: null,
          saves: [makeSaveData('   ', '空 id 导入')],
          turnSnapshots: [],
        }),
      },
      {
        name: 'save updatedAt 非法',
        buildArchive: () => ({
          schema: 'coc.v2.saves',
          version: 2,
          exportedAt: '2026-07-10T00:00:00.000Z',
          lastSaveId: 'invalid-date-save',
          saves: [makeSaveData('invalid-date-save', '非法日期', 'not-a-date')],
          turnSnapshots: [],
        }),
      },
      {
        name: 'v2 archive 缺少 turnSnapshots',
        buildArchive: () => ({
          schema: 'coc.v2.saves',
          version: 2,
          exportedAt: '2026-07-10T00:00:00.000Z',
          lastSaveId: 'import-a',
          saves: [makeSaveData('import-a', '导入甲')],
        }),
      },
      {
        name: '快照 turnNumber 非正整数',
        buildArchive: () => ({
          schema: 'coc.v2.saves',
          version: 2,
          exportedAt: '2026-07-10T00:00:00.000Z',
          lastSaveId: 'import-a',
          saves: [makeSaveData('import-a', '导入甲')],
          turnSnapshots: [{ ...makeStoredSnapshot('import-a', 1), turnNumber: 0 }],
        }),
      },
      {
        name: '快照 actionText 为空',
        buildArchive: () => {
          const snapshot = makeStoredSnapshot('import-a', 1);
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: 'import-a',
            saves: [makeSaveData('import-a', '导入甲')],
            turnSnapshots: [{
              ...snapshot,
              snapshot: { ...snapshot.snapshot, actionText: '  ' },
            }],
          };
        },
      },
      {
        name: '快照 createdAt 非法',
        buildArchive: () => {
          const snapshot = makeStoredSnapshot('import-a', 1);
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: 'import-a',
            saves: [makeSaveData('import-a', '导入甲')],
            turnSnapshots: [{
              ...snapshot,
              snapshot: { ...snapshot.snapshot, createdAt: 'not-a-date' },
            }],
          };
        },
      },
      {
        name: '快照 beforeState 无法归一化',
        buildArchive: () => {
          const snapshot = makeStoredSnapshot('import-a', 1);
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: 'import-a',
            saves: [makeSaveData('import-a', '导入甲')],
            turnSnapshots: [{
              ...snapshot,
              snapshot: { ...snapshot.snapshot, beforeState: null },
            }],
          };
        },
      },
      {
        name: '快照 beforeState 为空对象',
        buildArchive: () => {
          const snapshot = makeStoredSnapshot('import-a', 1);
          return {
            schema: 'coc.v2.saves',
            version: 2,
            exportedAt: '2026-07-10T00:00:00.000Z',
            lastSaveId: 'import-a',
            saves: [makeSaveData('import-a', '导入甲')],
            turnSnapshots: [{
              ...snapshot,
              snapshot: { ...snapshot.snapshot, beforeState: {} },
            }],
          };
        },
      },
    ])('在写入前拒绝$name并保持旧库不变', async ({ buildArchive }) => {
      await seedExistingArchiveState();
      const before = await readPersistenceFingerprint();

      await expect(importSaves(
        buildArchive() as unknown as Parameters<typeof importSaves>[0],
        { mode: 'replace' },
      )).rejects.toThrow();

      expect(await readPersistenceFingerprint()).toEqual(before);
    });
  });

  describe('atomic archive import', () => {
    it('round-trips self-generated saves with empty display text', async () => {
      const state = makeState('空摘要角色');
      state.player.summary = '';
      const save = await createSave(state, '');
      const archive = await exportSaves();

      await importSaves(archive, { mode: 'replace' });

      const loaded = await loadSave(save.id);
      expect(loaded?.label).toBe('');
      expect(loaded?.runtimeState.player.summary).toBe('');
    });

    it('round-trips dynamic numeric dictionaries whose keys match structural array fields', async () => {
      const state = makeState('动态字典角色');
      state.playerResources = { items: 1 };
      state.player.abilityScores = { tags: 2 };
      state.player.equipment = [{
        id: 'dynamic-bonus-weapon',
        slot: 'weapon',
        name: '测试兵器',
        quality: '普通',
        description: '验证动态数值键名。',
        statBonuses: { relatedNpcIds: 3 },
      }];
      const save = await createSave(state, '动态数值字典');
      const archive = await exportSaves();

      await importSaves(archive, { mode: 'replace' });

      const loaded = await loadSave(save.id);
      expect(loaded?.runtimeState.playerResources).toEqual({ items: 1 });
      expect(loaded?.runtimeState.player.abilityScores).toEqual({ tags: 2 });
      expect(loaded?.runtimeState.player.equipment?.[0].statBonuses).toEqual({ relatedNpcIds: 3 });
    });

    it('round-trips scalar fields whose names are arrays in other runtime contexts', async () => {
      const state = makeState('同名异义字段角色');
      state.routeEdges = [{
        routeId: 'route-string-notes-regression',
        fromPlaceId: 'place_route_start',
        toPlaceId: 'place_route_end',
        name: '测试路线',
        status: '可通行',
        source: 'system',
        knownLevel: '亲历',
        notes: '路线备注在地图合同中是文本，不是数组。',
      }];
      state.combatRecords = [{
        combatId: 'combat-scalar-field-regression',
        kind: 'duel',
        title: '校验同名字段',
        summary: '装备与绝艺在个人战判定中是分数，不是数组。',
        occurredAt: state.currentDate,
        participants: [{ name: state.player.name, side: 'player' }],
        playerInvolved: true,
        resultLevel: 'win',
        outcome: '获胜',
        significance: 'notable',
        judgement: {
          method: 'combatJudgementV1',
          scoreBreakdown: {
            equipment: 15,
            uniqueArts: 10,
            total: 25,
          },
        },
      }];
      state.heroineThreads = [{
        heroineThreadId: 'heroine-scalar-field-regression',
        npcId: 'npc-scalar-field-regression',
        npcName: '测试人物',
        status: 'active',
        stage: '相识',
        relationshipRole: '故交',
        summary: '风险说明在红颜线中是文本，不是数组。',
        riskNotes: '身份暴露可能牵动当地局势。',
        lastUpdatedAt: state.currentDate,
      }];
      state.npcs = [{
        npcId: 'npc-relationship-network-notes-regression',
        name: '测试关系人物',
        sex: '女',
        age: 24,
        role: '故交',
        isPresent: true,
        isFocused: true,
        summary: '验证关系网络备注。',
        appearance: '素衣。',
        personality: '沉静。',
        motivation: '守望故人。',
        relationToPlayer: '故交',
        contactLevel: 70,
        recentAttitude: '信任',
        memories: [],
        femaleProfile: {
          relationshipNetwork: [{
            targetName: state.player.name,
            relationship: '故交',
            notes: '关系网络备注在正式类型中是文本，不是数组。',
          }],
        },
      }];
      const save = await createSave(state, '同名异义字段');
      await saveTurnSnapshot({
        saveId: save.id,
        turnNumber: 1,
        snapshot: {
          beforeState: state,
          actionText: '验证同名异义字段',
          createdAt: '2026-07-17T00:00:00.000Z',
        },
        maxDepth: 10,
      });
      const archive = await exportSaves();

      await importSaves(archive, { mode: 'replace' });

      const loaded = await loadSave(save.id);
      expect(loaded?.runtimeState.routeEdges?.[0].notes)
        .toBe('路线备注在地图合同中是文本，不是数组。');
      expect(loaded?.runtimeState.combatRecords?.[0].judgement?.scoreBreakdown).toMatchObject({
        equipment: 15,
        uniqueArts: 10,
      });
      expect(loaded?.runtimeState.heroineThreads?.[0].riskNotes).toBe('身份暴露可能牵动当地局势。');
      expect(loaded?.runtimeState.npcs?.[0].femaleProfile?.relationshipNetwork?.[0].notes)
        .toBe('关系网络备注在正式类型中是文本，不是数组。');
      const [snapshot] = await listTurnSnapshots(save.id);
      expect(snapshot?.snapshot.beforeState.combatRecords?.[0].judgement?.scoreBreakdown?.equipment).toBe(15);
      expect(snapshot?.snapshot.beforeState.heroineThreads?.[0].riskNotes).toBe('身份暴露可能牵动当地局势。');
      expect(snapshot?.snapshot.beforeState.npcs?.[0].femaleProfile?.relationshipNetwork?.[0].notes)
        .toBe('关系网络备注在正式类型中是文本，不是数组。');
    });

    it('keeps array-only notes strict outside known text-note contexts', async () => {
      const save = makeSaveData('invalid-combat-notes', '损坏战斗备注');
      const archive = {
        schema: 'coc.v2.saves',
        version: 2,
        exportedAt: '2026-08-01T13:40:00.000Z',
        lastSaveId: save.id,
        saves: [{
          ...save,
          runtimeState: {
            ...save.runtimeState,
            combatRecords: [{
              combatId: 'combat-invalid-notes',
              kind: 'duel',
              title: '错误备注容器',
              summary: '用于确认路线备注兼容不会放宽战斗判定合同。',
              occurredAt: save.currentDate,
              participants: [{ name: '损坏战斗备注', side: 'player' }],
              playerInvolved: true,
              resultLevel: 'win',
              outcome: '获胜',
              significance: 'minor',
              judgement: {
                method: 'combatJudgementV1',
                scoreBreakdown: { notes: '本字段必须保持数组' },
              },
            }],
          },
        }],
        turnSnapshots: [],
      };

      await expect(importSaves(
        archive as unknown as Parameters<typeof importSaves>[0],
        { mode: 'replace' },
      )).rejects.toThrow('存档文件格式不正确');
      expect(await listSaves()).toHaveLength(0);
    });

    it('uses parsed timestamps consistently for listing, export order, and delete fallback', async () => {
      const older = makeSaveData('timezone-older-global', '时区较旧全局档', '2026-07-10T10:00:00+08:00');
      const newer = makeSaveData('timezone-newer-global', '时区较新全局档', '2026-07-10T03:00:00Z');
      await idbPut('saves', older);
      await idbPut('saves', newer);
      await idbSetMeta('legacySavesMigratedFromLocalStorage', true);
      await idbSetMeta('lastSaveId', older.id);

      expect((await listSaves()).map((save) => save.id)).toEqual([newer.id, older.id]);
      expect((await exportSaves()).saves.map((save) => save.id)).toEqual([newer.id, older.id]);

      await deleteSave(older.id);
      expect((await continueLastSave())?.id).toBe(newer.id);
    });

    it('points ordinary legacy migration only at a save that was actually normalized and stored', async () => {
      const invalidLegacy = {
        ...makeSaveData('invalid-legacy-first', '损坏首档'),
        runtimeState: {},
      };
      const validLegacy = makeSaveData('valid-legacy-second', '有效次档');
      installLegacyStorage({
        coc_v2_save_list: JSON.stringify([
          { id: invalidLegacy.id },
          { id: validLegacy.id },
        ]),
        [`coc_v2_save_${invalidLegacy.id}`]: JSON.stringify(invalidLegacy),
        [`coc_v2_save_${validLegacy.id}`]: JSON.stringify(validLegacy),
        coc_v2_last_save_id: invalidLegacy.id,
      });

      expect((await listSaves()).map((save) => save.id)).toEqual([validLegacy.id]);
      expect((await continueLastSave())?.id).toBe(validLegacy.id);
      expect(await idbGetMeta<string>('lastSaveId')).toBe(validLegacy.id);
    });

    it('leaves ordinary legacy migration without a pointer when every legacy save is invalid', async () => {
      const invalidLegacy = {
        ...makeSaveData('invalid-legacy-only', '唯一坏档'),
        runtimeState: {},
      };
      installLegacyStorage({
        coc_v2_save_list: JSON.stringify([{ id: invalidLegacy.id }]),
        [`coc_v2_save_${invalidLegacy.id}`]: JSON.stringify(invalidLegacy),
        coc_v2_last_save_id: invalidLegacy.id,
      });

      expect(await listSaves()).toEqual([]);
      expect(await continueLastSave()).toBeNull();
      expect(await idbGetMeta<string>('lastSaveId')).toBeUndefined();
    });

    it('does not mark legacy migration complete when IndexedDB persistence fails', async () => {
      const validLegacy = makeSaveData('legacy-write-retry', '等待重试的旧档');
      installLegacyStorage({
        coc_v2_save_list: JSON.stringify([{ id: validLegacy.id }]),
        [`coc_v2_save_${validLegacy.id}`]: JSON.stringify(validLegacy),
        coc_v2_last_save_id: validLegacy.id,
      });

      await expect(injectNthPutFailure(1, async () => {
        await listSaves();
      })).rejects.toThrow('injected put failure 1');
      expect(await idbGetAll<SaveData>('saves')).toEqual([]);
      expect(await idbGetMeta<boolean>('legacySavesMigratedFromLocalStorage')).toBeUndefined();

      expect((await listSaves()).map((save) => save.id)).toEqual([validLegacy.id]);
      expect(await idbGetMeta<boolean>('legacySavesMigratedFromLocalStorage')).toBe(true);
    });

    it('replaces all persistence stores with normalized saves, canonical snapshots, and pointer', async () => {
      await seedExistingArchiveState();
      const importedSave = makeSaveData('replace-a', '替换档');
      const importedSnapshot = makeStoredSnapshot(importedSave.id, 2, '替换行动');

      await importSaves({
        schema: 'coc.v2.saves',
        version: 2,
        exportedAt: '2026-07-10T00:00:00.000Z',
        lastSaveId: importedSave.id,
        saves: [importedSave],
        turnSnapshots: [importedSnapshot],
      }, { mode: 'replace' });

      const after = await readPersistenceFingerprint();
      expect(after.saves.map((save) => save.id)).toEqual([importedSave.id]);
      expect(after.turnSnapshots).toHaveLength(1);
      expect(after.turnSnapshots[0]).toMatchObject({
        id: `${importedSave.id}:2`,
        saveId: importedSave.id,
        turnNumber: 2,
        createdAt: importedSnapshot.snapshot.createdAt,
        snapshot: {
          actionText: '替换行动',
          createdAt: importedSnapshot.snapshot.createdAt,
        },
      });
      expect(after.turnSnapshots[0].snapshot.beforeState.npcs).toEqual([]);
      expect(after.lastSaveId).toBe(importedSave.id);
      expect(after.turnSnapshots.every((snapshot) => (
        after.saves.some((save) => save.id === snapshot.saveId)
      ))).toBe(true);
    });

    it('deletes lastSaveId when a replace archive explicitly has a null pointer', async () => {
      await seedExistingArchiveState();
      const importedSave = makeSaveData('replace-null-pointer', '无指针档');

      await importSaves({
        schema: 'coc.v2.saves',
        version: 2,
        exportedAt: '2026-07-10T00:00:00.000Z',
        lastSaveId: null,
        saves: [importedSave],
        turnSnapshots: [],
      }, { mode: 'replace' });

      expect((await readPersistenceFingerprint()).lastSaveId).toBeNull();
    });

    it('merges unrelated records while replacing snapshots for a colliding save', async () => {
      const collidingSave = await createSave(makeState('碰撞旧档'), '碰撞旧档');
      await saveTurnSnapshot({
        saveId: collidingSave.id,
        turnNumber: 1,
        snapshot: {
          beforeState: makeState('碰撞旧档'),
          actionText: '碰撞旧行动',
          createdAt: '2026-07-09T00:01:00.000Z',
        },
        maxDepth: 10,
      });
      const unrelatedSave = await createSave(makeState('无关档'), '无关档');
      await saveTurnSnapshot({
        saveId: unrelatedSave.id,
        turnNumber: 1,
        snapshot: {
          beforeState: makeState('无关档'),
          actionText: '无关行动',
          createdAt: '2026-07-09T00:02:00.000Z',
        },
        maxDepth: 10,
      });
      const before = await readPersistenceFingerprint();
      const unrelatedSaveBefore = before.saves.find((save) => save.id === unrelatedSave.id);
      const unrelatedSnapshotsBefore = before.turnSnapshots
        .filter((snapshot) => snapshot.saveId === unrelatedSave.id);
      const importedCollision = {
        ...makeSaveData(collidingSave.id, '碰撞新档', '2026-07-11T00:00:00.000Z'),
        createdAt: collidingSave.createdAt,
      };

      await importSaves({
        schema: 'coc.v2.saves',
        version: 2,
        exportedAt: '2026-07-11T00:00:00.000Z',
        lastSaveId: collidingSave.id,
        saves: [importedCollision],
        turnSnapshots: [makeStoredSnapshot(collidingSave.id, 3, '碰撞新行动')],
      });

      const after = await readPersistenceFingerprint();
      expect(after.saves.find((save) => save.id === unrelatedSave.id)).toEqual(unrelatedSaveBefore);
      expect(after.turnSnapshots.filter((snapshot) => snapshot.saveId === unrelatedSave.id))
        .toEqual(unrelatedSnapshotsBefore);
      expect(after.saves.find((save) => save.id === collidingSave.id)?.runtimeState.player.name)
        .toBe('碰撞新档');
      expect(after.turnSnapshots
        .filter((snapshot) => snapshot.saveId === collidingSave.id)
        .map((snapshot) => snapshot.turnNumber)).toEqual([3]);
      expect(after.lastSaveId).toBe(collidingSave.id);
    });

    it('aborts merge instead of overwriting a retained snapshot that owns an incoming canonical key', async () => {
      const retainedSave = makeSaveData('retained-save', '保留旧档');
      const importedSave = makeSaveData('incoming-save', '导入新档');
      await idbPut('saves', retainedSave);
      await idbPut('turnSnapshots', {
        ...makeStoredSnapshot(retainedSave.id, 7, '历史非规范快照'),
        id: `${importedSave.id}:1`,
      });
      await idbSetMeta('lastSaveId', retainedSave.id);
      await idbSetMeta('legacySavesMigratedFromLocalStorage', true);
      const before = await readPersistenceFingerprint();

      await expect(importSaves({
        schema: 'coc.v2.saves',
        version: 2,
        exportedAt: '2026-07-12T00:00:00.000Z',
        lastSaveId: importedSave.id,
        saves: [importedSave],
        turnSnapshots: [makeStoredSnapshot(importedSave.id, 1, '导入行动')],
      })).rejects.toThrow();

      expect(await readPersistenceFingerprint()).toEqual(before);
    });

    it('removes orphan snapshots during merge while preserving valid unrelated saves and snapshots', async () => {
      const deletedSave = await createSave(makeState('将删除档'), '将删除档');
      const preservedSave = await createSave(makeState('保留档'), '保留档');
      await saveTurnSnapshot({
        saveId: preservedSave.id,
        turnNumber: 1,
        snapshot: {
          beforeState: makeState('保留档'),
          actionText: '应保留的行动',
          createdAt: '2026-07-09T00:04:00.000Z',
        },
        maxDepth: 10,
      });
      await deleteSave(deletedSave.id);
      // Directly seed a historical orphan to keep archive-merge cleanup coverage;
      // current deleteSave now removes its own rollback chain atomically.
      await saveTurnSnapshot({
        saveId: deletedSave.id,
        turnNumber: 1,
        snapshot: {
          beforeState: makeState('将删除档'),
          actionText: '历史遗留的孤儿行动',
          createdAt: '2026-07-09T00:03:00.000Z',
        },
        maxDepth: 10,
      });
      const beforeMerge = await readPersistenceFingerprint();
      const preservedSaveBefore = beforeMerge.saves.find((save) => save.id === preservedSave.id);
      const preservedSnapshotsBefore = beforeMerge.turnSnapshots
        .filter((snapshot) => snapshot.saveId === preservedSave.id);
      expect(beforeMerge.turnSnapshots.some((snapshot) => snapshot.saveId === deletedSave.id)).toBe(true);

      await importSaves({
        schema: 'coc.v2.saves',
        version: 2,
        exportedAt: '2026-07-12T00:00:00.000Z',
        lastSaveId: null,
        saves: [],
        turnSnapshots: [],
      });

      const after = await readPersistenceFingerprint();
      const finalSaveIds = new Set(after.saves.map((save) => save.id));
      expect(after.turnSnapshots.every((snapshot) => finalSaveIds.has(snapshot.saveId))).toBe(true);
      expect(after.saves.find((save) => save.id === preservedSave.id)).toEqual(preservedSaveBefore);
      expect(after.turnSnapshots.filter((snapshot) => snapshot.saveId === preservedSave.id))
        .toEqual(preservedSnapshotsBefore);
      expect(after.lastSaveId).toBe(preservedSave.id);
    });

    it('preserves a still-valid existing pointer when a merge archive pointer is null', async () => {
      const currentSave = await createSave(makeState('当前档'), '当前档');
      const importedSave = makeSaveData('newer-import', '更新导入档', '2026-07-12T00:00:00.000Z');

      await importSaves({
        schema: 'coc.v2.saves',
        version: 2,
        exportedAt: '2026-07-12T00:00:00.000Z',
        lastSaveId: null,
        saves: [importedSave],
        turnSnapshots: [],
      });

      expect((await readPersistenceFingerprint()).lastSaveId).toBe(currentSave.id);
    });

    it('selects the stably newest final save when a null merge pointer cannot preserve the old pointer', async () => {
      const existingSave = makeSaveData('existing-oldest', '原档', '2026-07-10T00:00:00.000Z');
      await idbPut('saves', existingSave);
      await idbSetMeta('lastSaveId', 'missing-save');
      const olderImport = makeSaveData('import-older', '旧导入', '2026-07-11T00:00:00.000Z');
      const newerImport = makeSaveData('import-newer', '新导入', '2026-07-12T00:00:00.000Z');

      await importSaves({
        schema: 'coc.v2.saves',
        version: 2,
        exportedAt: '2026-07-12T00:00:00.000Z',
        lastSaveId: null,
        saves: [olderImport, newerImport],
        turnSnapshots: [],
      });

      expect((await readPersistenceFingerprint()).lastSaveId).toBe(newerImport.id);
    });

    it('selects the newest merge pointer by parsed time across timezone offsets', async () => {
      await idbSetMeta('lastSaveId', 'missing-save');
      const lexicallyLaterButOlder = makeSaveData(
        'timezone-older',
        '时区较旧档',
        '2026-07-10T10:00:00+08:00',
      );
      const lexicallyEarlierButNewer = makeSaveData(
        'timezone-newer',
        '时区较新档',
        '2026-07-10T03:00:00Z',
      );

      await importSaves({
        schema: 'coc.v2.saves',
        version: 2,
        exportedAt: '2026-07-12T00:00:00.000Z',
        lastSaveId: null,
        saves: [lexicallyLaterButOlder, lexicallyEarlierButNewer],
        turnSnapshots: [],
      });

      expect((await readPersistenceFingerprint()).lastSaveId).toBe(lexicallyEarlierButNewer.id);
    });

    it('breaks equal parsed updatedAt timestamps by save id ascending', async () => {
      await idbSetMeta('lastSaveId', 'missing-save');
      const lowerId = makeSaveData('a-time-tie', '时间平局甲', '2026-07-10T03:00:00Z');
      const higherId = makeSaveData('z-time-tie', '时间平局乙', '2026-07-10T11:00:00+08:00');

      await importSaves({
        schema: 'coc.v2.saves',
        version: 2,
        exportedAt: '2026-07-12T00:00:00.000Z',
        lastSaveId: null,
        saves: [higherId, lowerId],
        turnSnapshots: [],
      });

      expect((await readPersistenceFingerprint()).lastSaveId).toBe(lowerId.id);
    });

    it('imports a version 1 archive without snapshots', async () => {
      await seedExistingArchiveState();
      const importedSave = makeSaveData('legacy-v1', '旧版导入');

      await importSaves({
        schema: 'coc.v2.saves',
        version: 1,
        exportedAt: '2026-07-10T00:00:00.000Z',
        lastSaveId: importedSave.id,
        saves: [importedSave],
      }, { mode: 'replace' });

      const after = await readPersistenceFingerprint();
      expect(after.saves.map((save) => save.id)).toEqual([importedSave.id]);
      expect(after.turnSnapshots).toEqual([]);
      expect(after.lastSaveId).toBe(importedSave.id);
    });

    it('merges a version 1 archive without importing snapshots or replacing unrelated records', async () => {
      const existingSave = await createSave(makeState('无关旧档'), '无关旧档');
      await saveTurnSnapshot({
        saveId: existingSave.id,
        turnNumber: 1,
        snapshot: {
          beforeState: makeState('无关旧档'),
          actionText: '无关旧行动',
          createdAt: '2026-07-09T00:05:00.000Z',
        },
        maxDepth: 10,
      });
      const before = await readPersistenceFingerprint();
      const importedSave = makeSaveData('legacy-v1-merge', '旧版合并档');

      await importSaves({
        schema: 'coc.v2.saves',
        version: 1,
        exportedAt: '2026-07-10T00:00:00.000Z',
        lastSaveId: importedSave.id,
        saves: [importedSave],
      });

      const after = await readPersistenceFingerprint();
      expect(after.saves.find((save) => save.id === existingSave.id))
        .toEqual(before.saves.find((save) => save.id === existingSave.id));
      expect(after.saves.find((save) => save.id === importedSave.id)).toEqual(importedSave);
      expect(after.turnSnapshots).toEqual(before.turnSnapshots);
      expect(after.lastSaveId).toBe(importedSave.id);
    });

    it.each([
      { name: 'malformed JSON', legacyList: '{not-json' },
      { name: 'non-array JSON', legacyList: JSON.stringify({ id: 'not-an-array' }) },
    ])('ignores a $name legacy list without blocking a valid merge', async ({ legacyList }) => {
      installLegacyStorage({ coc_v2_save_list: legacyList });
      const importedSave = makeSaveData('archive-after-damaged-list', '合法导入档');

      await importSaves({
        schema: 'coc.v2.saves',
        version: 2,
        exportedAt: '2026-07-12T00:00:00.000Z',
        lastSaveId: importedSave.id,
        saves: [importedSave],
        turnSnapshots: [],
      });

      const after = await readPersistenceFingerprint();
      expect(after.saves).toEqual([importedSave]);
      expect(after.lastSaveId).toBe(importedSave.id);
    });

    it('skips damaged legacy save JSON and invalid save candidates while merging valid legacy data', async () => {
      const invalidLegacy = {
        ...makeSaveData('invalid-legacy', '损坏 legacy'),
        runtimeState: {},
      };
      const validLegacy = makeSaveData('valid-legacy', '有效 legacy');
      const archiveSave = makeSaveData('archive-with-legacy', '合法 archive');
      installLegacyStorage({
        coc_v2_save_list: JSON.stringify([
          { id: 'broken-json-legacy' },
          { id: invalidLegacy.id },
          { id: validLegacy.id },
        ]),
        'coc_v2_save_broken-json-legacy': '{not-json',
        [`coc_v2_save_${invalidLegacy.id}`]: JSON.stringify(invalidLegacy),
        [`coc_v2_save_${validLegacy.id}`]: JSON.stringify(validLegacy),
      });

      await importSaves({
        schema: 'coc.v2.saves',
        version: 2,
        exportedAt: '2026-07-12T00:00:00.000Z',
        lastSaveId: archiveSave.id,
        saves: [archiveSave],
        turnSnapshots: [],
      });

      const after = await readPersistenceFingerprint();
      expect(after.saves.map((save) => save.id).sort()).toEqual([
        archiveSave.id,
        validLegacy.id,
      ].sort());
      expect(after.saves.some((save) => save.id === invalidLegacy.id)).toBe(false);
      expect(after.lastSaveId).toBe(archiveSave.id);
    });

    it('treats a valid legacy save collision as a replacement and removes its old snapshots', async () => {
      const collisionId = 'legacy-idb-collision';
      const existingSave = makeSaveData(collisionId, 'IDB 旧档');
      const unrelatedSave = makeSaveData('legacy-unrelated', '无关 IDB 档');
      await idbPut('saves', existingSave);
      await idbPut('saves', unrelatedSave);
      await saveTurnSnapshot({
        saveId: existingSave.id,
        turnNumber: 1,
        snapshot: {
          beforeState: existingSave.runtimeState,
          actionText: '碰撞旧行动',
          createdAt: '2026-07-09T00:06:00.000Z',
        },
        maxDepth: 10,
      });
      await saveTurnSnapshot({
        saveId: unrelatedSave.id,
        turnNumber: 1,
        snapshot: {
          beforeState: unrelatedSave.runtimeState,
          actionText: '无关行动',
          createdAt: '2026-07-09T00:07:00.000Z',
        },
        maxDepth: 10,
      });
      const before = await readPersistenceFingerprint();
      const legacyReplacement = makeSaveData(collisionId, 'legacy 新档', '2026-07-12T00:00:00.000Z');
      installLegacyStorage({
        coc_v2_save_list: JSON.stringify([{ id: collisionId }]),
        [`coc_v2_save_${collisionId}`]: JSON.stringify(legacyReplacement),
        coc_v2_last_save_id: collisionId,
      });

      await importSaves({
        schema: 'coc.v2.saves',
        version: 2,
        exportedAt: '2026-07-12T00:00:00.000Z',
        lastSaveId: null,
        saves: [],
        turnSnapshots: [],
      });

      const after = await readPersistenceFingerprint();
      expect(after.saves.find((save) => save.id === collisionId)?.runtimeState.player.name)
        .toBe('legacy 新档');
      expect(after.turnSnapshots.filter((snapshot) => snapshot.saveId === collisionId)).toEqual([]);
      expect(after.saves.find((save) => save.id === unrelatedSave.id))
        .toEqual(before.saves.find((save) => save.id === unrelatedSave.id));
      expect(after.turnSnapshots.filter((snapshot) => snapshot.saveId === unrelatedSave.id))
        .toEqual(before.turnSnapshots.filter((snapshot) => snapshot.saveId === unrelatedSave.id));
      expect(after.lastSaveId).toBe(collisionId);
    });

    it.each([
      { mode: 'replace' as const, nthPut: 2 },
      { mode: 'replace' as const, nthPut: 5 },
      { mode: 'merge' as const, nthPut: 2 },
      { mode: 'merge' as const, nthPut: 5 },
    ])(
      'rolls back every store when put $nthPut fails during $mode',
      async ({ mode, nthPut }) => {
        await seedExistingArchiveState();
        const before = await readPersistenceFingerprint();
        const importedA = makeSaveData(`${mode}-a`, `${mode}导入甲`);
        const importedB = makeSaveData(`${mode}-b`, `${mode}导入乙`);

        await expect(injectNthPutFailure(nthPut, () => importSaves({
          schema: 'coc.v2.saves',
          version: 2,
          exportedAt: '2026-07-10T00:00:00.000Z',
          lastSaveId: importedB.id,
          saves: [importedA, importedB],
          turnSnapshots: [makeStoredSnapshot(importedA.id, 1)],
        }, { mode }))).rejects.toThrow(`injected put failure ${nthPut}`);

        expect(await readPersistenceFingerprint()).toEqual(before);
      },
    );

    it.each(['replace', 'merge'] as const)(
      'does not commit the legacy migration marker when the first import into an empty database fails during %s',
      async (mode) => {
        const before = await readPersistenceFingerprint();
        const importedA = makeSaveData(`${mode}-empty-a`, `${mode}空库甲`);
        const importedB = makeSaveData(`${mode}-empty-b`, `${mode}空库乙`);

        await expect(injectNthPutFailure(2, () => importSaves({
          schema: 'coc.v2.saves',
          version: 2,
          exportedAt: '2026-07-10T00:00:00.000Z',
          lastSaveId: importedB.id,
          saves: [importedA, importedB],
          turnSnapshots: [],
        }, { mode }))).rejects.toThrow('injected put failure 2');

        expect(await readPersistenceFingerprint()).toEqual(before);
      },
    );
  });
});
