export type LocalStoreName = 'saves' | 'saveSummaries' | 'apiConfigs' | 'meta' | 'turnSnapshots' | 'memoryEmbeddingIndexes';

export interface LocalTransactionContext {
  store(storeName: LocalStoreName): IDBObjectStore;
  request<T>(request: IDBRequest<T>): Promise<T>;
}

export interface LocalTransactionOptions {
  signal?: AbortSignal;
}

const DB_NAME = 'coc_v2_local_data';
const DB_VERSION = 4;

let databasePromise: Promise<IDBDatabase> | null = null;

export function openLocalDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = getIndexedDbFactory().open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('saves')) {
          db.createObjectStore('saves', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('saveSummaries')) {
          db.createObjectStore('saveSummaries', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('apiConfigs')) {
          db.createObjectStore('apiConfigs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('turnSnapshots')) {
          db.createObjectStore('turnSnapshots', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('memoryEmbeddingIndexes')) {
          db.createObjectStore('memoryEmbeddingIndexes', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'));
    });
  }

  return databasePromise;
}

export async function idbGet<T>(storeName: LocalStoreName, key: IDBValidKey): Promise<T | undefined> {
  return withStore(storeName, 'readonly', (store) => requestToPromise<T | undefined>(store.get(key)));
}

export async function idbGetAll<T>(storeName: LocalStoreName): Promise<T[]> {
  return withStore(storeName, 'readonly', (store) => requestToPromise<T[]>(store.getAll()));
}

export async function idbPut<T extends object>(storeName: LocalStoreName, value: T): Promise<void> {
  await withStore(storeName, 'readwrite', (store) => requestToPromise(store.put(value)));
}

export async function idbDelete(storeName: LocalStoreName, key: IDBValidKey): Promise<void> {
  await withStore(storeName, 'readwrite', (store) => requestToPromise(store.delete(key)));
}

export async function idbClear(storeName: LocalStoreName): Promise<void> {
  await withStore(storeName, 'readwrite', (store) => requestToPromise(store.clear()));
}

export async function idbGetMeta<T>(key: string): Promise<T | undefined> {
  const item = await idbGet<{ key: string; value: T }>('meta', key);
  return item?.value;
}

export async function idbSetMeta<T>(key: string, value: T): Promise<void> {
  await idbPut('meta', { key, value });
}

export async function idbDeleteMeta(key: string): Promise<void> {
  await idbDelete('meta', key);
}

export async function withLocalTransaction<T>(
  storeNames: readonly LocalStoreName[],
  mode: IDBTransactionMode,
  operation: (context: LocalTransactionContext) => Promise<T>,
  options: LocalTransactionOptions = {},
): Promise<T> {
  throwIfAborted(options.signal);
  const db = await openLocalDatabase();
  throwIfAborted(options.signal);

  const transaction = db.transaction([...storeNames], mode);
  let cancellationReason: unknown;
  const onAbort = () => {
    cancellationReason = getAbortReason(options.signal);
    abortTransaction(transaction);
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const completed = transactionComplete(transaction, () => cancellationReason);
  const context: LocalTransactionContext = {
    store: (storeName) => transaction.objectStore(storeName),
    request: requestToPromise,
  };

  try {
    const result = await operation(context);
    throwIfAborted(options.signal);
    await completed;
    return result;
  } catch (error) {
    abortTransaction(transaction);
    await completed.catch(() => undefined);
    if (options.signal?.aborted) throw getAbortReason(options.signal);
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export async function resetLocalDatabaseForTests(): Promise<void> {
  if (databasePromise) {
    const db = await databasePromise.catch(() => null);
    db?.close();
    databasePromise = null;
  }

  await new Promise<void>((resolve, reject) => {
    const request = getIndexedDbFactory().deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 重置失败'));
    request.onblocked = () => reject(new Error('IndexedDB 重置被阻塞'));
  });
}

async function withStore<T>(
  storeName: LocalStoreName,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);
  const done = transactionComplete(transaction);
  const result = await operation(store);
  await done;
  return result;
}

function requestToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
  });
}

function transactionComplete(
  transaction: IDBTransaction,
  getCancellationReason?: () => unknown,
): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
    transaction.onabort = () => reject(
      getCancellationReason?.()
      ?? transaction.error
      ?? new DOMException('The operation was aborted', 'AbortError'),
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw getAbortReason(signal);
}

function getAbortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function abortTransaction(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') throw error;
  }
}

function getIndexedDbFactory(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new Error('当前环境不支持 IndexedDB');
  }
  return indexedDB;
}
