import { expect, type Page, test } from '@playwright/test';
import {
  E2E_DATABASE_NAME,
  E2E_DATABASE_VERSION,
  seedMainNarrativeApi,
} from './e2eStorage';

const MAIN_API_URL = 'https://example.test/v1/chat/completions';
const SAVE_B_ID = 'e2e-save-b';
const IMPORTED_SAVE_ID = 'e2e-imported-save';
const LATE_NARRATIVE = 'A档迟到正文，不得进入其他会话。';

interface PersistenceFingerprint {
  saves: Array<Record<string, unknown>>;
  turnSnapshots: Array<Record<string, unknown>>;
  lastSaveId: string | null;
}

async function installLateResponseStream(page: Page) {
  let notifyRequestStarted: (() => void) | undefined;
  const requestStarted = new Promise<void>((resolve) => {
    notifyRequestStarted = resolve;
  });
  let releaseResponse: (() => void) | undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let notifyResponseDelivered: (() => void) | undefined;
  const responseDelivered = new Promise<void>((resolve) => {
    notifyResponseDelivered = resolve;
  });
  await page.exposeFunction('__cocLateTurnRequestStarted', () => notifyRequestStarted?.());
  await page.exposeFunction('__cocWaitForLateTurnResponse', () => responseGate);
  await page.exposeFunction('__cocLateTurnResponseDelivered', () => notifyResponseDelivered?.());

  const responseContent = JSON.stringify({
    protocolVersion: 'lsfy.turn.v1',
    narrativeText: LATE_NARRATIVE,
    suggestedActions: [],
    statePatches: [{
      type: 'timeAdvance',
      payload: { minutesAdvanced: 15, reason: '迟到回合', category: 'test' },
      reason: '测试迟到回合隔离',
    }],
    statePatch: null,
    writeback: {},
  });
  const streamPayload = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: responseContent } }] })}`,
    '',
    'data: [DONE]',
    '',
    '',
  ].join('\n');

  await page.addInitScript(
    ({ apiUrl, payload }) => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const requestUrl = typeof input === 'string'
          ? input
          : input instanceof Request
            ? input.url
            : input.href;
        if (requestUrl !== apiUrl) return nativeFetch(input, init);

        const hooks = window as unknown as {
          __cocLateTurnRequestStarted: () => Promise<void>;
          __cocWaitForLateTurnResponse: () => Promise<void>;
          __cocLateTurnResponseDelivered: () => Promise<void>;
        };
        await hooks.__cocLateTurnRequestStarted();
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        (window as unknown as { __cocLateTurnSignal?: AbortSignal }).__cocLateTurnSignal = signal ?? undefined;
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({
          start(controller) {
            void hooks.__cocWaitForLateTurnResponse().then(async () => {
              try {
                controller.enqueue(encoder.encode(payload));
                controller.close();
              } catch {
                // The request owner may cancel its reader while this source still completes late.
              }
              await hooks.__cocLateTurnResponseDelivered();
            });
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };
    },
    { apiUrl: MAIN_API_URL, payload: streamPayload },
  );

  return {
    requestStarted,
    responseDelivered,
    isRequestSignalAborted: () => page.evaluate(
      () => (window as unknown as { __cocLateTurnSignal?: AbortSignal }).__cocLateTurnSignal?.aborted ?? false,
    ),
    releaseResponse: () => releaseResponse?.(),
  };
}

async function installDelayedSaveRead(page: Page) {
  let notifyReadStarted: (() => void) | undefined;
  const readStarted = new Promise<void>((resolve) => {
    notifyReadStarted = resolve;
  });
  let releaseRead: (() => void) | undefined;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let notifyReadDelivered: (() => void) | undefined;
  const readDelivered = new Promise<void>((resolve) => {
    notifyReadDelivered = resolve;
  });

  await page.exposeFunction('__cocDelayedSaveReadStarted', () => notifyReadStarted?.());
  await page.exposeFunction('__cocWaitForDelayedSaveRead', () => readGate);
  await page.exposeFunction('__cocDelayedSaveReadDelivered', () => notifyReadDelivered?.());
  await page.addInitScript(() => {
    const abortState = window as unknown as {
      __cocAbortCallCount?: number;
      __cocOriginalAbort?: AbortController['abort'];
    };
    if (!abortState.__cocOriginalAbort) {
      abortState.__cocOriginalAbort = AbortController.prototype.abort;
      AbortController.prototype.abort = function trackedAbort(reason?: unknown) {
        abortState.__cocAbortCallCount = (abortState.__cocAbortCallCount ?? 0) + 1;
        return abortState.__cocOriginalAbort!.call(this, reason);
      };
    }
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function delayedGet(query: IDBValidKey) {
      const state = window as unknown as {
        __cocDelayNextSaveReadId?: string;
        __cocCompletedSaveReadCounts?: Record<string, number>;
      };
      const nativeRequest = originalGet.call(this, query);
      if (this.name === 'saves') {
        nativeRequest.addEventListener('success', () => {
          const counts = state.__cocCompletedSaveReadCounts ?? {};
          const key = String(query);
          counts[key] = (counts[key] ?? 0) + 1;
          state.__cocCompletedSaveReadCounts = counts;
        });
      }
      const targetId = state.__cocDelayNextSaveReadId;
      if (this.name !== 'saves' || String(query) !== targetId) {
        return nativeRequest;
      }

      delete state.__cocDelayNextSaveReadId;
      const delayedRequest = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
      } as unknown as IDBRequest;
      nativeRequest.onsuccess = async () => {
        const hooks = window as unknown as {
          __cocDelayedSaveReadStarted: () => Promise<void>;
          __cocWaitForDelayedSaveRead: () => Promise<void>;
          __cocDelayedSaveReadDelivered: () => Promise<void>;
        };
        await hooks.__cocDelayedSaveReadStarted();
        await hooks.__cocWaitForDelayedSaveRead();
        Object.defineProperty(delayedRequest, 'result', { configurable: true, value: nativeRequest.result });
        delayedRequest.onsuccess?.call(delayedRequest, new Event('success') as unknown as Event);
        await hooks.__cocDelayedSaveReadDelivered();
      };
      nativeRequest.onerror = () => {
        Object.defineProperty(delayedRequest, 'error', { configurable: true, value: nativeRequest.error });
        delayedRequest.onerror?.call(delayedRequest, new Event('error') as unknown as Event);
      };
      return delayedRequest;
    };
  });

  return {
    readStarted,
    readDelivered,
    completedReadCount: (saveId: string) => page.evaluate(
      (id) => (window as unknown as { __cocCompletedSaveReadCounts?: Record<string, number> })
        .__cocCompletedSaveReadCounts?.[id] ?? 0,
      saveId,
    ),
    abortCallCount: () => page.evaluate(
      () => (window as unknown as { __cocAbortCallCount?: number }).__cocAbortCallCount ?? 0,
    ),
    releaseRead: () => releaseRead?.(),
  };
}

async function holdPersistenceWriteTransaction(page: Page) {
  await page.evaluate(
    async ({ databaseName, databaseVersion }) => {
      const state = window as unknown as {
        __cocPersistenceBlocker?: {
          released: boolean;
          completed: Promise<void>;
        };
        __cocAtomicPersistenceTransactionStarted?: boolean;
        __cocOriginalIdbTransaction?: IDBDatabase['transaction'];
        __cocCreatingPersistenceBlocker?: boolean;
      };
      if (!state.__cocOriginalIdbTransaction) {
        state.__cocOriginalIdbTransaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function trackedTransaction(storeNames, mode, options) {
          const names = typeof storeNames === 'string' ? [storeNames] : Array.from(storeNames);
          if (
            !state.__cocCreatingPersistenceBlocker
            && mode === 'readwrite'
            && ['saves', 'turnSnapshots', 'meta'].every((name) => names.includes(name))
          ) {
            state.__cocAtomicPersistenceTransactionStarted = true;
          }
          return state.__cocOriginalIdbTransaction!.call(this, storeNames, mode, options);
        };
      }
      state.__cocAtomicPersistenceTransactionStarted = false;

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      state.__cocCreatingPersistenceBlocker = true;
      const transaction = db.transaction(['saves', 'turnSnapshots', 'meta'], 'readwrite');
      state.__cocCreatingPersistenceBlocker = false;
      const store = transaction.objectStore('saves');
      let markStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const completed = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      state.__cocPersistenceBlocker = { released: false, completed };

      const keepAlive = () => {
        const request = store.get('__coc_persistence_write_blocker__');
        request.onsuccess = () => {
          markStarted?.();
          markStarted = undefined;
          if (!state.__cocPersistenceBlocker?.released) keepAlive();
        };
      };
      keepAlive();
      await started;
    },
    { databaseName: E2E_DATABASE_NAME, databaseVersion: E2E_DATABASE_VERSION },
  );

  return {
    atomicCommitStarted: () => page.evaluate(
      () => (window as unknown as { __cocAtomicPersistenceTransactionStarted?: boolean })
        .__cocAtomicPersistenceTransactionStarted ?? false,
    ),
    release: () => page.evaluate(async () => {
      const blocker = (window as unknown as {
        __cocPersistenceBlocker?: { released: boolean; completed: Promise<void> };
      }).__cocPersistenceBlocker;
      if (!blocker) throw new Error('Persistence blocker was not installed');
      blocker.released = true;
      await blocker.completed;
    }),
  };
}

async function enterDebugGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: '新的征程' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: /宗室支脉/ }).click();
  await page.getByRole('button', { name: /在野士人/ }).click();
  await page.evaluate(() => (window as unknown as { __cocDebugStart: () => Promise<void> }).__cocDebugStart());
  await expect(page.locator('.game-frame')).toBeVisible();
}

async function cloneCurrentSaveAsB(page: Page): Promise<string> {
  return page.evaluate(
    async ({ databaseName, databaseVersion, saveBId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const saves = await new Promise<Array<Record<string, any>>>((resolve, reject) => {
        const tx = db.transaction('saves', 'readonly');
        const request = tx.objectStore('saves').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const saveA = saves[0];
      if (!saveA) throw new Error('Expected debug save A to exist');
      const saveB = structuredClone(saveA);
      saveB.id = saveBId;
      saveB.label = 'B档主角 - 隔离测试';
      saveB.createdAt = '2026-07-10T09:00:00.000Z';
      saveB.updatedAt = '2026-07-10T09:00:00.000Z';
      saveB.runtimeState.player.name = 'B档主角';

      const currentLocation = saveB.runtimeState.locations?.find(
        (location: Record<string, any>) => location.locationId === saveB.runtimeState.currentLocationId,
      );
      const saveBSummary = {
        id: saveB.id,
        label: saveB.label,
        saveKind: saveB.saveKind ?? 'auto',
        createdAt: saveB.createdAt,
        updatedAt: saveB.updatedAt,
        worldBookId: saveB.worldBookId,
        startBookmarkId: saveB.startBookmarkId,
        currentDate: saveB.currentDate,
        playerName: saveB.runtimeState.player.name || '未命名角色',
        locationName: currentLocation?.name ?? '',
        turnCount: saveB.runtimeState.turnLog?.length ?? 0,
      };

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['saves', 'saveSummaries'], 'readwrite');
        tx.objectStore('saves').put(saveB);
        tx.objectStore('saveSummaries').put(saveBSummary);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return String(saveA.id);
    },
    {
      databaseName: E2E_DATABASE_NAME,
      databaseVersion: E2E_DATABASE_VERSION,
      saveBId: SAVE_B_ID,
    },
  );
}

async function readPersistenceFingerprint(
  page: Page,
  saveIds: string[],
): Promise<PersistenceFingerprint> {
  return page.evaluate(
    async ({ databaseName, databaseVersion, ids }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const readAll = <T>(storeName: string) => new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const readOne = <T>(storeName: string, key: IDBValidKey) => new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [allSaves, allSnapshots, lastSaveMeta] = await Promise.all([
        readAll<Record<string, unknown>>('saves'),
        readAll<Record<string, unknown>>('turnSnapshots'),
        readOne<{ key: string; value: string }>('meta', 'lastSaveId'),
      ]);
      db.close();
      const selectedIds = new Set(ids);
      return {
        saves: allSaves
          .filter((save) => selectedIds.has(String(save.id)))
          .sort((left, right) => String(left.id).localeCompare(String(right.id))),
        turnSnapshots: allSnapshots
          .filter((snapshot) => selectedIds.has(String(snapshot.saveId)))
          .sort((left, right) => String(left.id).localeCompare(String(right.id))),
        lastSaveId: lastSaveMeta?.value ?? null,
      };
    },
    { databaseName: E2E_DATABASE_NAME, databaseVersion: E2E_DATABASE_VERSION, ids: saveIds },
  );
}

async function buildImportArchive(page: Page, sourceSaveId: string): Promise<string> {
  return page.evaluate(
    async ({ databaseName, databaseVersion, importedSaveId, saveId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const sourceSave = await new Promise<Record<string, any>>((resolve, reject) => {
        const tx = db.transaction('saves', 'readonly');
        const request = tx.objectStore('saves').get(saveId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      if (!sourceSave) throw new Error('Expected source save for import archive');
      const importedSave = structuredClone(sourceSave);
      importedSave.id = importedSaveId;
      importedSave.label = '导入存档主角 - 隔离测试';
      importedSave.runtimeState.player.name = '导入存档主角';
      importedSave.createdAt = '2026-07-10T09:30:00.000Z';
      importedSave.updatedAt = '2026-07-10T09:30:00.000Z';
      return JSON.stringify({
        schema: 'coc.v2.saves',
        version: 2,
        exportedAt: '2026-07-10T09:30:00.000Z',
        lastSaveId: importedSaveId,
        saves: [importedSave],
        turnSnapshots: [],
      });
    },
    {
      databaseName: E2E_DATABASE_NAME,
      databaseVersion: E2E_DATABASE_VERSION,
      importedSaveId: IMPORTED_SAVE_ID,
      saveId: sourceSaveId,
    },
  );
}

async function submitControlledAction(page: Page): Promise<void> {
  await page.locator('.input-row textarea').fill('A档发起一个会迟到的行动');
  await page.getByRole('button', { name: '执行行动' }).click();
}

test('a late result from save A cannot change save B UI or either stored save', async ({ page }) => {
  const stream = await installLateResponseStream(page);
  await seedMainNarrativeApi(page);
  await enterDebugGame(page);
  const saveAId = await cloneCurrentSaveAsB(page);

  await submitControlledAction(page);
  await stream.requestStarted;
  await page.getByTestId('game-load-progress').click();
  await page.locator('.save-item').filter({ hasText: 'B档主角' }).click();

  await expect(page.getByTestId('player-profile-entry')).toContainText('B档主角');
  await expect(page.getByText('回合：0')).toBeVisible();
  expect(await stream.isRequestSignalAborted()).toBe(true);
  const persistenceBeforeLateResult = await readPersistenceFingerprint(page, [saveAId, SAVE_B_ID]);
  stream.releaseResponse();
  await stream.responseDelivered;

  await expect(page.getByText(LATE_NARRATIVE)).toHaveCount(0);
  await expect(page.getByText('回合：0')).toBeVisible();
  await expect.poll(() => readPersistenceFingerprint(page, [saveAId, SAVE_B_ID]))
    .toEqual(persistenceBeforeLateResult);
});

test('returning home prevents a late result from reopening or saving the old game', async ({ page }) => {
  const stream = await installLateResponseStream(page);
  await seedMainNarrativeApi(page);
  await enterDebugGame(page);
  const saveAId = await cloneCurrentSaveAsB(page);

  await submitControlledAction(page);
  await stream.requestStarted;
  await page.getByRole('button', { name: '返回' }).click();
  await expect(page.getByRole('button', { name: '新的征程' })).toBeVisible();
  expect(await stream.isRequestSignalAborted()).toBe(true);
  const persistenceBeforeLateResult = await readPersistenceFingerprint(page, [saveAId]);
  stream.releaseResponse();
  await stream.responseDelivered;

  await expect(page.locator('.game-frame')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新的征程' })).toBeVisible();
  await expect.poll(() => readPersistenceFingerprint(page, [saveAId]))
    .toEqual(persistenceBeforeLateResult);
});

test('import cancels the current turn with an explicit notice and rejects its late result', async ({ page }) => {
  const stream = await installLateResponseStream(page);
  await seedMainNarrativeApi(page);
  await enterDebugGame(page);
  const saveAId = await cloneCurrentSaveAsB(page);
  const archive = await buildImportArchive(page, saveAId);

  await submitControlledAction(page);
  await stream.requestStarted;
  await page.getByTestId('game-load-progress').click();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入存档' }).click();
  const fileChooser = await fileChooserPromise;
  await expect(page.getByText('当前回合已取消，正在导入存档。')).toBeVisible();
  await fileChooser.setFiles({
    name: 'turn-session-isolation-import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(archive),
  });
  await expect(page.getByText(/存档已导入并合并/)).toBeVisible();

  expect(await stream.isRequestSignalAborted()).toBe(true);
  const persistenceBeforeLateResult = await readPersistenceFingerprint(page, [saveAId, IMPORTED_SAVE_ID]);
  stream.releaseResponse();
  await stream.responseDelivered;

  await expect(page.getByText(LATE_NARRATIVE)).toHaveCount(0);
  await expect(page.getByText('回合：0')).toBeVisible();
  await expect.poll(() => readPersistenceFingerprint(page, [saveAId, IMPORTED_SAVE_ID]))
    .toEqual(persistenceBeforeLateResult);
});

test('closing the standalone load page invalidates a pending save read before it can reopen the game', async ({ page }) => {
  const delayedRead = await installDelayedSaveRead(page);
  await seedMainNarrativeApi(page);
  await enterDebugGame(page);
  const saveAId = await cloneCurrentSaveAsB(page);

  await page.getByRole('button', { name: '返回' }).click();
  await page.getByRole('button', { name: '兵戈再起' }).click();
  await expect(page.locator('.save-item').filter({ hasText: '无名氏' })).toBeVisible();
  await page.evaluate((saveId) => {
    (window as unknown as { __cocDelayNextSaveReadId?: string }).__cocDelayNextSaveReadId = saveId;
  }, saveAId);
  await page.locator('.save-item').filter({ hasText: '无名氏' }).click();
  await delayedRead.readStarted;

  await page.locator('.save-modal-close').click();
  await expect(page.getByRole('button', { name: '新的征程' })).toBeVisible();
  delayedRead.releaseRead();
  await delayedRead.readDelivered;

  await expect(page.locator('.game-frame')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新的征程' })).toBeVisible();
});

test('closing an in-game load modal invalidates its pending save read without switching saves', async ({ page }) => {
  const delayedRead = await installDelayedSaveRead(page);
  await seedMainNarrativeApi(page);
  await enterDebugGame(page);
  const saveAId = await cloneCurrentSaveAsB(page);
  const persistenceBeforeLoad = await readPersistenceFingerprint(page, [saveAId, SAVE_B_ID]);

  await page.locator('.input-row textarea').fill('关闭空闲读档窗口后应保留');
  await page.getByTestId('game-load-progress').click();
  await expect(page.locator('.save-item').filter({ hasText: 'B档主角' })).toBeVisible();
  await page.locator('.save-modal-close').click();
  await expect(page.locator('.input-row textarea')).toHaveValue('关闭空闲读档窗口后应保留');

  await page.getByTestId('game-load-progress').click();
  const saveBItem = page.locator('.save-item').filter({ hasText: 'B档主角' });
  await expect(saveBItem).toBeVisible();
  await saveBItem.evaluate((element, saveId) => {
    element.addEventListener('click', () => {
      (window as unknown as { __cocDelayNextSaveReadId?: string }).__cocDelayNextSaveReadId = saveId;
    }, { capture: true, once: true });
  }, SAVE_B_ID);
  await saveBItem.click();
  await delayedRead.readStarted;

  const abortsAfterLoadStarted = await delayedRead.abortCallCount();
  await page.locator('.save-modal-close').click();
  await expect.poll(delayedRead.abortCallCount).toBeGreaterThan(abortsAfterLoadStarted);
  await expect(page.getByTestId('player-profile-entry')).toContainText('无名氏');
  delayedRead.releaseRead();
  await delayedRead.readDelivered;

  await expect(page.getByTestId('player-profile-entry')).toContainText('无名氏');
  await expect(page.getByTestId('player-profile-entry')).not.toContainText('B档主角');
  await expect.poll(() => readPersistenceFingerprint(page, [saveAId, SAVE_B_ID]))
    .toEqual(persistenceBeforeLoad);
});

test('cancelling a turn queued behind an IndexedDB write lock leaves all persistence stores unchanged', async ({ page }) => {
  const stream = await installLateResponseStream(page);
  await seedMainNarrativeApi(page);
  await enterDebugGame(page);
  const saveAId = await cloneCurrentSaveAsB(page);

  await page.getByTestId('game-load-progress').click();
  await expect(page.locator('.save-item').filter({ hasText: 'B档主角' })).toBeVisible();
  await page.locator('.save-modal-close').click();
  const persistenceBeforeTurn = await readPersistenceFingerprint(page, [saveAId, SAVE_B_ID]);

  await submitControlledAction(page);
  await stream.requestStarted;
  const blocker = await holdPersistenceWriteTransaction(page);
  stream.releaseResponse();
  await stream.responseDelivered;
  await expect.poll(blocker.atomicCommitStarted).toBe(true);

  await page.getByTestId('game-load-progress').click();
  await page.locator('.save-item').filter({ hasText: 'B档主角' }).click();
  await blocker.release();

  await expect(page.getByTestId('player-profile-entry')).toContainText('B档主角');
  await expect(page.getByText('回合：0')).toBeVisible();
  await expect.poll(() => readPersistenceFingerprint(page, [saveAId, SAVE_B_ID]))
    .toEqual(persistenceBeforeTurn);
});

test('a normal single-save turn autosaves its full state and survives a reload', async ({ page }) => {
  const stream = await installLateResponseStream(page);
  await seedMainNarrativeApi(page);
  await enterDebugGame(page);
  const saveAId = (await readPersistenceFingerprint(page, [])).lastSaveId;
  expect(saveAId).not.toBeNull();

  await submitControlledAction(page);
  await stream.requestStarted;
  stream.releaseResponse();
  await stream.responseDelivered;
  await expect(page.getByText('回合：1')).toBeVisible();
  await expect(page.locator('.message-box')).toHaveCount(0);

  const persistenceAfterAutosave = await readPersistenceFingerprint(page, [saveAId!]);
  expect(persistenceAfterAutosave.lastSaveId).toBe(saveAId);
  expect(persistenceAfterAutosave.saves).toHaveLength(1);
  expect(persistenceAfterAutosave.turnSnapshots).toHaveLength(1);
  expect((persistenceAfterAutosave.saves[0].runtimeState as { turnLog: unknown[] }).turnLog).toHaveLength(1);

  await page.reload();
  await page.getByRole('button', { name: '兵戈再起' }).click();
  await page.getByRole('button', { name: '读取最近存档' }).click();
  await expect(page.locator('.game-frame')).toBeVisible();
  await expect(page.getByText('回合：1')).toBeVisible();
  await expect(page.getByText(LATE_NARRATIVE)).toBeVisible();
  await expect.poll(() => readPersistenceFingerprint(page, [saveAId!]))
    .toEqual(persistenceAfterAutosave);
});
