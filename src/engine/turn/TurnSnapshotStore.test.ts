import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { CURRENT_RUNTIME_STATE_MIGRATION_VERSION } from '../state/RuntimeStateMigration';
import { buildMapV1Index } from '../map/mapV1';
import { getWorldBookMapRoots } from '../map/runtimeMap';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { registerWorldBook } from '../worldbook';
import {
  idbGet,
  idbPut,
  openLocalDatabase,
  resetLocalDatabaseForTests,
} from '../storage/IndexedDbStore';
import {
  deleteTurnSnapshotsAfter,
  listTurnSnapshots,
  loadTurnSnapshot,
  saveTurnSnapshot,
  type StoredTurnSnapshot,
} from './TurnSnapshotStore';

function makeState(turnCount: number): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '公元189年09月01日 08:00（辰时）',
    currentDate: '公元189年09月01日 08:00（辰时）',
    player: {
      id: 'player',
      name: '刘达',
      roleType: '宗室支脉',
      summary: '测试主角',
    },
    currentLocationId: 'loc_luoyang',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: Array.from({ length: turnCount }, (_, index) => ({
      turnNumber: index + 1,
      date: '公元189年09月01日 08:00（辰时）',
      playerInput: `第${index + 1}轮行动`,
      narrativeText: `第${index + 1}轮正文`,
      statePatchSummary: '无状态变更',
      timestamp: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`,
    })),
    localSituationNotes: [],
    locations: [],
  });
}

function makeHistoricalState(): RuntimeState {
  const state = makeState(0);
  return {
    ...state,
    engineVersion: '0.0.9',
    memoryArchive: undefined,
    troops: [{
      troopId: 'troop_legacy',
      name: '旧档郡兵',
      troopType: '步卒',
      size: 300,
      morale: 50,
      training: 60,
      supplies: 40,
      task: '巡守新野',
      relationToPlayer: '你直接统领',
    } as any],
    holdings: [
      {
        holdingId: 'place_jingzhou_xinye',
        name: '新野县',
        type: 'county',
        status: 'controlled',
        summary: '主角已经接管新野。',
        locationId: 'place_jingzhou_xinye',
        scaleLevel: 2,
        agriculture: 50,
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
        summary: '主角随后整顿新野县署。',
        locationId: 'place_jingzhou_xinye',
        scaleLevel: 2,
        agriculture: 55,
        commerce: 42,
        population: 61,
        publicOrder: 53,
        popularSupport: 48,
        defense: 36,
        recruitPotential: 32,
        armory: 21,
        horseSupply: 10,
        corruption: 22,
        recentChanges: ['整顿县署'],
        updatedAt: '194-08-20 08:00',
      },
    ],
    activeQuests: [{
      id: 'quest_xinye_defense',
      title: '整顿新野城防',
      description: '清点城防并安置守军。',
      status: 'active',
      affectedHoldingIds: ['holding_xinye'],
      createdAt: '194-08-19 10:00',
      updatedAt: '194-08-20 08:00',
    }],
    knownRumors: [{
      id: 'rumor_xinye',
      title: '新野整顿',
      content: '县署已经开始整顿。',
      source: '城中传闻',
      affectedHoldingIds: ['holding_xinye'],
      createdAt: '194-08-20 08:00',
    } as any],
    worldTrends: [{
      trendId: 'trend_xinye',
      title: '新野易手',
      summary: '新野控制权发生变化。',
      affectedHoldingIds: ['holding_xinye'],
      updatedAt: '194-08-20 08:00',
    } as any],
    domesticReports: [{
      reportId: 'report_xinye',
      title: '新野内政',
      summary: '县署账册正在清点。',
      holdingHighlights: [{ holdingId: 'holding_xinye', summary: '完成初步清点' }],
      createdAt: '194-08-20 08:00',
    } as any],
    turnLog: [{
      turnNumber: 1,
      date: '194-08-20 08:00',
      playerInput: '整顿县署',
      narrativeText: '新野县署开始整顿。',
      statePatchSummary: '整顿新野',
      timestamp: '2026-01-01T00:00:00.000Z',
      displayMeta: {
        holdingAnnualSettlement: {
          affectedHoldingIds: ['holding_xinye'],
        },
      },
    } as any],
  };
}

function makeOfficialSeedDuplicateState(): RuntimeState {
  const state = makeState(0);
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

describe('TurnSnapshotStore', () => {
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

  it('keeps only the latest snapshots within the configured depth', async () => {
    for (let turnNumber = 1; turnNumber <= 12; turnNumber += 1) {
      await saveTurnSnapshot({
        saveId: 'save-a',
        turnNumber,
        snapshot: {
          beforeState: makeState(turnNumber - 1),
          actionText: `行动 ${turnNumber}`,
          createdAt: `2026-01-01T00:00:${String(turnNumber).padStart(2, '0')}.000Z`,
        },
        maxDepth: 10,
      });
    }

    const snapshots = await listTurnSnapshots('save-a');

    expect(snapshots.map((item) => item.turnNumber)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(await loadTurnSnapshot('save-a', 2)).toBeNull();
    expect((await loadTurnSnapshot('save-a', 12))?.snapshot.actionText).toBe('行动 12');
  });

  it('deletes snapshots after the rerolled turn', async () => {
    for (let turnNumber = 1; turnNumber <= 5; turnNumber += 1) {
      await saveTurnSnapshot({
        saveId: 'save-a',
        turnNumber,
        snapshot: {
          beforeState: makeState(turnNumber - 1),
          actionText: `行动 ${turnNumber}`,
          createdAt: `2026-01-01T00:00:${String(turnNumber).padStart(2, '0')}.000Z`,
        },
        maxDepth: 10,
      });
    }

    await deleteTurnSnapshotsAfter('save-a', 3);

    expect((await listTurnSnapshots('save-a')).map((item) => item.turnNumber)).toEqual([1, 2, 3]);
    expect(await loadTurnSnapshot('save-a', 4)).toBeNull();
  });

  it('migrates an old snapshot on read and persists the normalized record once', async () => {
    const historicalState = makeHistoricalState();
    historicalState.relationships = [{
      id: 'relationship_snapshot_legacy',
      actorId: 'actor_source',
      targetId: 'faction_target',
      targetType: 'faction',
      type: 'neutral',
      value: 10,
      description: 'Legacy snapshot relationship.',
    } as RuntimeState['relationships'][number]];
    await idbPut('turnSnapshots', {
      id: 'save-old:3',
      saveId: 'save-old',
      turnNumber: 3,
      snapshot: {
        beforeState: historicalState,
        actionText: '整顿新野城防',
        createdAt: '2026-01-01T00:00:03.000Z',
      },
      createdAt: '2026-01-01T00:00:03.000Z',
    });

    const loaded = await loadTurnSnapshot('save-old', 3);

    expect(loaded?.snapshot.beforeState.engineVersion).toBe('0.1.0');
    expect(loaded?.snapshot.beforeState.memoryArchive).toBeDefined();
    expect(loaded?.snapshot.beforeState.troops?.[0]).toMatchObject({
      quality: '中',
      fatigue: '低',
      readiness: '中',
      lifecycleStatus: 'active',
    });
    expect(loaded?.snapshot.beforeState.holdings).toHaveLength(1);
    expect(loaded?.snapshot.beforeState.holdings?.[0]).toMatchObject({
      holdingId: 'place_jingzhou_xinye',
      recentChanges: ['接管新野', '整顿县署'],
    });
    expect(loaded?.snapshot.beforeState.activeQuests[0].affectedHoldingIds)
      .toEqual(['place_jingzhou_xinye']);
    expect(loaded?.snapshot.beforeState.knownRumors[0].affectedHoldingIds)
      .toEqual(['place_jingzhou_xinye']);
    expect(loaded?.snapshot.beforeState.worldTrends?.[0].affectedHoldingIds)
      .toEqual(['place_jingzhou_xinye']);
    expect(loaded?.snapshot.beforeState.domesticReports?.[0].holdingHighlights?.[0].holdingId)
      .toBe('place_jingzhou_xinye');
    expect(loaded?.snapshot.beforeState.turnLog[0].displayMeta?.holdingAnnualSettlement?.affectedHoldingIds)
      .toEqual(['place_jingzhou_xinye']);
    expect(loaded?.snapshot.beforeState.relationships[0]).toMatchObject({
      targetKind: 'faction',
      targetType: 'faction',
    });

    const persisted = await idbGet<any>('turnSnapshots', 'save-old:3');
    expect(persisted?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
    expect(persisted?.snapshot.beforeState).toEqual(loaded?.snapshot.beforeState);

    const database = await openLocalDatabase();
    const prototype = Object.getPrototypeOf(
      database.transaction('turnSnapshots', 'readonly').objectStore('turnSnapshots'),
    );
    const putSpy = vi.spyOn(prototype, 'put');
    await loadTurnSnapshot('save-old', 3);
    expect(putSpy).not.toHaveBeenCalled();
    putSpy.mockRestore();
  });

  it('resolves official seed locations on snapshot read without StartScreen registry initialization', async () => {
    await idbPut('turnSnapshots', {
      id: 'save-official-seed:1',
      saveId: 'save-official-seed',
      turnNumber: 1,
      snapshot: {
        beforeState: makeOfficialSeedDuplicateState(),
        actionText: '读取旧快照',
        createdAt: '2026-01-01T00:00:01.000Z',
        runtimeStateMigrationVersion: 3,
      },
      createdAt: '2026-01-01T00:00:01.000Z',
      runtimeStateMigrationVersion: 3,
    });

    const loaded = await loadTurnSnapshot('save-official-seed', 1);

    expect(loaded?.snapshot.beforeState.currentLocationId).toBe('place_jingzhou_xinye');
    expect(loaded?.snapshot.beforeState.mapNodes?.some((node) => node.id === 'runtime_xinye_duplicate'))
      .toBe(false);
    expect(loaded?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
    expect(loaded?.snapshot.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
  });

  it('does not rewrite an unchanged unresolved migration snapshot on repeated load or list', async () => {
    const unresolved = makeState(0);
    unresolved.worldBookId = 'snapshot-unresolved-custom-worldbook';
    unresolved.worldBookSource = 'custom';
    unresolved.mapNodes = [];
    await saveTurnSnapshot({
      saveId: 'save-unresolved-v3',
      turnNumber: 1,
      snapshot: {
        beforeState: unresolved,
        actionText: '等待世界书加载',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
      maxDepth: 10,
    });
    const database = await openLocalDatabase();
    const prototype = Object.getPrototypeOf(
      database.transaction('turnSnapshots', 'readonly').objectStore('turnSnapshots'),
    );
    const putSpy = vi.spyOn(prototype, 'put');

    const firstLoad = await loadTurnSnapshot('save-unresolved-v3', 1);
    const secondLoad = await loadTurnSnapshot('save-unresolved-v3', 1);
    await listTurnSnapshots('save-unresolved-v3');
    await listTurnSnapshots('save-unresolved-v3');

    expect(firstLoad?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION - 1);
    expect(secondLoad?.runtimeStateMigrationVersion).toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION - 1);
    expect(putSpy).not.toHaveBeenCalled();
    putSpy.mockRestore();
  });

  it('does not let read-time snapshot migration overwrite a newer concurrent snapshot commit', async () => {
    const oldState = makeHistoricalState();
    await idbPut('turnSnapshots', {
      id: 'save-snapshot-race:1',
      saveId: 'save-snapshot-race',
      turnNumber: 1,
      snapshot: {
        beforeState: oldState,
        actionText: '旧快照行动',
        createdAt: '2026-01-01T00:00:01.000Z',
        runtimeStateMigrationVersion: 1,
      },
      createdAt: '2026-01-01T00:00:01.000Z',
      runtimeStateMigrationVersion: 1,
    });
    const database = await openLocalDatabase();
    const prototype = Object.getPrototypeOf(
      database.transaction('turnSnapshots', 'readonly').objectStore('turnSnapshots'),
    );
    const originalGet = prototype.get;
    let concurrentCommit: Promise<void> | undefined;
    let intercepted = false;
    const getSpy = vi.spyOn(prototype, 'get').mockImplementation(function (
      this: IDBObjectStore,
      ...args: unknown[]
    ) {
      const query = args[0] as IDBValidKey | IDBKeyRange;
      const request = originalGet.call(this, query) as IDBRequest;
      if (!intercepted && this.name === 'turnSnapshots' && query === 'save-snapshot-race:1') {
        intercepted = true;
        request.addEventListener('success', () => {
          const newState = makeState(1);
          newState.player.name = '并发提交的新快照';
          concurrentCommit = saveTurnSnapshot({
            saveId: 'save-snapshot-race',
            turnNumber: 1,
            snapshot: {
              beforeState: newState,
              actionText: '并发快照行动',
              createdAt: '2026-01-01T01:00:01.000Z',
            },
            maxDepth: 10,
          });
        }, { once: true });
      }
      return request;
    });

    await loadTurnSnapshot('save-snapshot-race', 1);
    await concurrentCommit;
    getSpy.mockRestore();

    const finalSnapshot = await idbGet<StoredTurnSnapshot>('turnSnapshots', 'save-snapshot-race:1');
    expect(finalSnapshot?.snapshot.beforeState.player.name).toBe('并发提交的新快照');
    expect(finalSnapshot?.snapshot.actionText).toBe('并发快照行动');
  });

  it('migrates historical records returned by the snapshot list', async () => {
    const historicalState = makeHistoricalState();
    await idbPut('turnSnapshots', {
      id: 'save-list-old:1',
      saveId: 'save-list-old',
      turnNumber: 1,
      snapshot: {
        beforeState: historicalState,
        actionText: '查看旧档',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
      createdAt: '2026-01-01T00:00:01.000Z',
    });

    const [listed] = await listTurnSnapshots('save-list-old');

    expect(listed.snapshot.beforeState.engineVersion).toBe('0.1.0');
    expect(listed.snapshot.beforeState.holdings).toHaveLength(1);
    expect((await idbGet<any>('turnSnapshots', listed.id))?.runtimeStateMigrationVersion)
      .toBe(CURRENT_RUNTIME_STATE_MIGRATION_VERSION);
  });

  it('rejects an old snapshot with an out-of-range relationship before persisting migration', async () => {
    const historicalState = makeHistoricalState();
    historicalState.relationships = [{
      id: 'relationship_snapshot_out_of_range',
      actorId: 'actor_source',
      targetId: 'actor_target',
      targetType: 'actor',
      type: 'neutral',
      value: 101,
      description: 'Invalid historical relationship.',
    }];
    const stored = {
      id: 'save-invalid-value:1',
      saveId: 'save-invalid-value',
      turnNumber: 1,
      snapshot: {
        beforeState: historicalState,
        actionText: '读取非法旧快照',
        createdAt: '2026-01-01T00:00:01.000Z',
        runtimeStateMigrationVersion: 1,
      },
      createdAt: '2026-01-01T00:00:01.000Z',
      runtimeStateMigrationVersion: 1,
    };
    await idbPut('turnSnapshots', stored);

    await expect(loadTurnSnapshot('save-invalid-value', 1)).rejects.toThrow(/value|关系值|-100|100/);
    expect(await idbGet<any>('turnSnapshots', stored.id)).toEqual(stored);
  });

  it('only clones a snapshot whose persisted migration markers are current', async () => {
    const state = makeState(0);
    state.memoryArchive = undefined;
    await idbPut('turnSnapshots', {
      id: 'save-current:1',
      saveId: 'save-current',
      turnNumber: 1,
      snapshot: {
        beforeState: state,
        actionText: '读取当前快照',
        createdAt: '2026-01-01T00:00:01.000Z',
        runtimeStateMigrationVersion: CURRENT_RUNTIME_STATE_MIGRATION_VERSION,
      },
      createdAt: '2026-01-01T00:00:01.000Z',
      runtimeStateMigrationVersion: CURRENT_RUNTIME_STATE_MIGRATION_VERSION,
    });

    const loaded = await loadTurnSnapshot('save-current', 1);

    expect(loaded?.snapshot.beforeState).toEqual(state);
    expect(loaded?.snapshot.beforeState.memoryArchive).toBeUndefined();
  });

  it('rejects a snapshot written by a newer runtime migration version', async () => {
    await idbPut('turnSnapshots', {
      id: 'save-future:1',
      saveId: 'save-future',
      turnNumber: 1,
      snapshot: {
        beforeState: makeState(0),
        actionText: '未来快照',
        createdAt: '2026-01-01T00:00:01.000Z',
        runtimeStateMigrationVersion: CURRENT_RUNTIME_STATE_MIGRATION_VERSION + 1,
      },
      createdAt: '2026-01-01T00:00:01.000Z',
      runtimeStateMigrationVersion: CURRENT_RUNTIME_STATE_MIGRATION_VERSION + 1,
    });

    await expect(loadTurnSnapshot('save-future', 1))
      .rejects.toThrow(/newer|未来|不支持/);
  });

  it('rejects a current-marker snapshot whose runtime state comes from a newer engine', async () => {
    const futureState = makeState(0);
    futureState.engineVersion = '9.0.0';
    await idbPut('turnSnapshots', {
      id: 'save-future-engine:1',
      saveId: 'save-future-engine',
      turnNumber: 1,
      snapshot: {
        beforeState: futureState,
        actionText: '未来引擎快照',
        createdAt: '2026-01-01T00:00:01.000Z',
        runtimeStateMigrationVersion: CURRENT_RUNTIME_STATE_MIGRATION_VERSION,
      },
      createdAt: '2026-01-01T00:00:01.000Z',
      runtimeStateMigrationVersion: CURRENT_RUNTIME_STATE_MIGRATION_VERSION,
    });

    await expect(loadTurnSnapshot('save-future-engine', 1))
      .rejects.toThrow(/更新引擎版本|不支持/);
  });
});
