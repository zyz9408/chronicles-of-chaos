import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnExecutionCancelledError } from '../turn/TurnExecutionContext';
import * as indexedDbStore from './IndexedDbStore';

type TransactionRunner = <T>(
  storeNames: readonly indexedDbStore.LocalStoreName[],
  mode: IDBTransactionMode,
  operation: (context: {
    store: (storeName: indexedDbStore.LocalStoreName) => IDBObjectStore;
    request: <R>(request: IDBRequest<R>) => Promise<R>;
  }) => Promise<T>,
  options?: { signal?: AbortSignal },
) => Promise<T>;

function getTransactionRunner(): TransactionRunner {
  const runner = (indexedDbStore as typeof indexedDbStore & {
    withLocalTransaction?: TransactionRunner;
  }).withLocalTransaction;
  expect(runner, 'IndexedDbStore should expose a multi-store transaction runner').toBeTypeOf('function');
  return runner!;
}

describe('IndexedDbStore multi-store transactions', () => {
  beforeEach(async () => {
    await indexedDbStore.resetLocalDatabaseForTests();
  });

  it('aborts all participating stores and preserves the typed cancellation reason', async () => {
    await indexedDbStore.idbPut('saves', { id: 'save-a', value: 'old-save' });
    await indexedDbStore.idbPut('turnSnapshots', { id: 'save-a:1', value: 'old-snapshot' });
    await indexedDbStore.idbSetMeta('lastSaveId', 'save-a');
    const controller = new AbortController();
    const cancellation = new TurnExecutionCancelledError();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const withLocalTransaction = getTransactionRunner();

    const transaction = withLocalTransaction(
      ['saves', 'turnSnapshots', 'meta'],
      'readwrite',
      async ({ store, request }) => {
        await Promise.all([
          request(store('saves').put({ id: 'save-a', value: 'new-save' })),
          request(store('turnSnapshots').put({ id: 'save-a:2', value: 'new-snapshot' })),
          request(store('meta').put({ key: 'lastSaveId', value: 'save-b' })),
        ]);
        controller.abort(cancellation);
      },
      { signal: controller.signal },
    );

    await expect(transaction).rejects.toBe(cancellation);
    expect(await indexedDbStore.idbGet('saves', 'save-a')).toEqual({ id: 'save-a', value: 'old-save' });
    expect(await indexedDbStore.idbGet('turnSnapshots', 'save-a:1')).toEqual({
      id: 'save-a:1',
      value: 'old-snapshot',
    });
    expect(await indexedDbStore.idbGet('turnSnapshots', 'save-a:2')).toBeUndefined();
    expect(await indexedDbStore.idbGetMeta('lastSaveId')).toBe('save-a');
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('rejects a default AbortController cancellation as AbortError without writing', async () => {
    const controller = new AbortController();
    controller.abort();
    const withLocalTransaction = getTransactionRunner();

    const transaction = withLocalTransaction(
      ['saves', 'meta'],
      'readwrite',
      async ({ store, request }) => {
        await request(store('saves').put({ id: 'save-a', value: 'unexpected' }));
      },
      { signal: controller.signal },
    );

    await expect(transaction).rejects.toMatchObject({ name: 'AbortError' });
    expect(await indexedDbStore.idbGet('saves', 'save-a')).toBeUndefined();
    expect(await indexedDbStore.idbGetMeta('lastSaveId')).toBeUndefined();
  });

  it('rejects a blocked schema upgrade instead of leaving opening and saves pending forever', async () => {
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('coc_v2_local_data', 1);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });

    try {
      await expect(indexedDbStore.openLocalDatabase()).rejects.toThrow('旧页面占用');
    } finally {
      blocker.close();
    }
  });
});
