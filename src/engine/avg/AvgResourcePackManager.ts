import threeKingdomsRegistryJson from './ThreeKingdomsAvgRegistry.generated.json';

export const AVG_RESOURCE_PACK_FORMAT = 'chronicles-of-chaos-v2-avg-resource-pack';
export const AVG_RESOURCE_PACK_DATABASE = 'chronicles-of-chaos-v2-avg-resource-packs';
export const AVG_RESOURCE_PACK_DATABASE_VERSION = 1;
export const AVG_RESOURCE_PACK_CHANGED_EVENT = 'coc-v2:avg-external-pack-changed';
export const THREE_KINGDOMS_AVG_REGISTRY_MANIFEST_ID = 'avg:threeKingdoms:accepted-resources:portrait-922-scene-200:2026-08-24';
export const MAX_AVG_RESOURCE_ARCHIVE_BYTES = 3 * 1024 * 1024 * 1024;
export const MAX_AVG_RESOURCE_EXPANDED_BYTES = 4 * 1024 * 1024 * 1024;
export const MAX_AVG_RESOURCE_FILE_BYTES = 96 * 1024 * 1024;
export const MAX_AVG_RESOURCE_COUNT = 5000;

export interface AvgResourcePackAssetManifest {
  assetId: string;
  path: string;
  sha256: string;
  byteLength: number;
  mediaType: 'image/webp';
  width: number;
  height: number;
  kind: 'fixed-portrait' | 'generic-portrait' | 'scene';
  resourceId: string;
  variant?: string;
}

export interface AvgResourcePackManifest {
  /** Legacy draft field; the official 1.8.4 archive does not require it. */
  format?: typeof AVG_RESOURCE_PACK_FORMAT;
  schemaVersion: 1;
  packId: string;
  worldBookId: string;
  displayName: string;
  version: string;
  registryManifestId: string;
  assetCount: number;
  totalByteLength: number;
  assets: AvgResourcePackAssetManifest[];
}

export interface InstalledAvgResourcePack {
  manifest: AvgResourcePackManifest;
  installedAt: string;
  storageBackend: 'opfs' | 'indexeddb';
  /** Official v1.8.4 binary namespace. Older reconstructed builds used storagePackId instead. */
  storageNamespace?: string;
  archiveByteLength?: number;
  validationStatus?: 'valid';
}

export interface AvgResourcePackProgress {
  phase: 'reading' | 'validating' | 'committing';
  archiveBytesRead: number;
  archiveByteLength: number;
  entriesRead: number;
}

type OfficialPackRow = { packId: string; worldBookId: string; record: InstalledAvgResourcePack };
type OfficialSelectionRow = { worldBookId: string; packId?: string; updatedAt: string };
type OfficialAssetRow = { key: string; namespace: string; path: string; blob: Blob };
type LegacyPackRow = InstalledAvgResourcePack & { packId: string; worldBookId: string; storagePackId?: string };
type LegacyAssetRow = { key: string; packId: string; assetId: string; path?: string; blob: Blob };
type ResourceDatabaseSchema = 'official-v1' | 'reconstructed-v1';

const OFFICIAL_STORES = {
  packs: 'installed-packs',
  selections: 'selections',
  assets: 'resource-files',
  worldBookIndex: 'by-worldbook',
  namespaceIndex: 'by-namespace',
} as const;

const LEGACY_STORES = {
  packs: 'packs',
  selections: 'active',
  assets: 'assets',
  worldBookIndex: 'worldBookId',
  namespaceIndex: 'packId',
} as const;

function requireText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label}不能为空。`);
  return text;
}

function parseManifest(value: unknown): AvgResourcePackManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('资源包 manifest.json 格式不正确。');
  const raw = value as Record<string, unknown>;
  if (raw.format !== undefined && raw.format !== AVG_RESOURCE_PACK_FORMAT) throw new Error('资源包格式不受支持。');
  if (raw.schemaVersion !== 1) throw new Error('资源包版本不受支持。');
  const assets = Array.isArray(raw.assets) ? raw.assets.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('资源包图片清单格式不正确。');
    const asset = item as Record<string, unknown>;
    const path = requireText(asset.path, '图片路径');
    const sha256 = requireText(asset.sha256, '图片摘要').toUpperCase();
    if (!/^assets\/[A-Za-z0-9._/-]+\.webp$/u.test(path) || path.includes('..') || path.includes('\\')) throw new Error(`资源包包含不安全路径：${path}`);
    if (!/^[A-F0-9]{64}$/u.test(sha256)) throw new Error(`图片摘要格式不正确：${path}`);
    if (!Number.isSafeInteger(asset.byteLength) || Number(asset.byteLength) <= 0) throw new Error(`图片大小不正确：${path}`);
    if (!Number.isSafeInteger(asset.width) || Number(asset.width) <= 0) throw new Error(`图片宽度不正确：${path}`);
    if (!Number.isSafeInteger(asset.height) || Number(asset.height) <= 0) throw new Error(`图片高度不正确：${path}`);
    if (asset.mediaType !== 'image/webp') throw new Error(`图片格式必须为 WebP：${path}`);
    if (!['fixed-portrait', 'generic-portrait', 'scene'].includes(String(asset.kind))) throw new Error(`图片资源类型不正确：${path}`);
    return {
      assetId: requireText(asset.assetId, '资源 ID'),
      path,
      sha256,
      byteLength: Number(asset.byteLength),
      mediaType: 'image/webp' as const,
      width: Number(asset.width),
      height: Number(asset.height),
      kind: asset.kind as AvgResourcePackAssetManifest['kind'],
      resourceId: requireText(asset.resourceId, '资源集合 ID'),
      ...(typeof asset.variant === 'string' && asset.variant.trim() ? { variant: asset.variant.trim() } : {}),
    };
  }) : [];
  if (!assets.length || assets.length > MAX_AVG_RESOURCE_COUNT) throw new Error('资源包图片数量不正确。');
  const paths = new Set(assets.map((asset) => asset.path));
  const ids = new Set(assets.map((asset) => asset.assetId));
  if (paths.size !== assets.length || ids.size !== assets.length) throw new Error('资源包包含重复图片路径或资源 ID。');
  const totalByteLength = assets.reduce((total, asset) => total + asset.byteLength, 0);
  if (raw.assetCount !== assets.length || raw.totalByteLength !== totalByteLength) throw new Error('资源包清单统计与图片列表不一致。');
  return {
    ...(raw.format === AVG_RESOURCE_PACK_FORMAT ? { format: AVG_RESOURCE_PACK_FORMAT } : {}),
    schemaVersion: 1,
    packId: requireText(raw.packId, '资源包 ID'),
    worldBookId: requireText(raw.worldBookId, '世界书 ID'),
    displayName: requireText(raw.displayName, '资源包名称'),
    version: requireText(raw.version, '资源包版本'),
    registryManifestId: requireText(raw.registryManifestId, '资源清单版本'),
    assetCount: assets.length,
    totalByteLength,
    assets,
  };
}

function readWebpSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  const uint24 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  const uint32 = (offset: number) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  if (bytes.byteLength < 30 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WEBP' || uint32(4) + 8 !== bytes.byteLength) return undefined;
  const chunk = text(12, 4);
  if (chunk === 'VP8X') return { width: uint24(24) + 1, height: uint24(27) + 1 };
  if (chunk === 'VP8L' && bytes[20] === 47) return {
    width: 1 + (bytes[21] | ((bytes[22] & 63) << 8)),
    height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 15) << 10)),
  };
  if (chunk === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) return {
    width: (bytes[26] | (bytes[27] << 8)) & 16383,
    height: (bytes[28] | (bytes[29] << 8)) & 16383,
  };
  return undefined;
}

function assertSupportedRegistry(manifest: AvgResourcePackManifest): void {
  if (manifest.worldBookId !== 'threeKingdoms') return;
  if (manifest.registryManifestId !== THREE_KINGDOMS_AVG_REGISTRY_MANIFEST_ID) {
    throw new Error('资源清单版本与当前游戏不一致。');
  }
  const trustedAssets = threeKingdomsRegistryJson.assets as AvgResourcePackAssetManifest[];
  const declaredById = new Map(manifest.assets.map((asset) => [asset.assetId, asset]));
  const trustedById = new Map(trustedAssets.map((asset) => [asset.assetId, asset]));
  if (manifest.assetCount !== trustedAssets.length) {
    throw new Error('三国 AVG 资源清单不完整，必须与内置 1122 项清单一致。');
  }
  for (const expected of trustedAssets) {
    const actual = declaredById.get(expected.assetId);
    if (!actual) throw new Error(`三国 AVG 资源清单缺少资源：${expected.assetId}`);
    if (actual.path !== expected.path
      || actual.mediaType !== expected.mediaType
      || actual.byteLength !== expected.byteLength
      || actual.width !== expected.width
      || actual.height !== expected.height
      || actual.sha256 !== expected.sha256
      || actual.kind !== expected.kind
      || actual.resourceId !== expected.resourceId
      || (actual.variant ?? '') !== (expected.variant ?? '')) {
      throw new Error(`三国 AVG 资源声明与内置清单不匹配：${expected.assetId}`);
    }
  }
  const unexpected = manifest.assets.find((asset) => !trustedById.has(asset.assetId));
  if (unexpected) {
    throw new Error(`三国 AVG 资源清单包含未登记资源：${unexpected.assetId}`);
  }
  const trustedTotal = trustedAssets.reduce((total, asset) => total + asset.byteLength, 0);
  if (manifest.totalByteLength !== trustedTotal) {
    throw new Error('三国 AVG 资源包总字节数与内置清单不一致。');
  }
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('AVG 资源包数据库事务失败。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('AVG 资源包数据库事务已取消。'));
  });
}

async function runTransaction<T>(
  database: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const transaction = database.transaction(stores, mode);
  // Attach completion handlers before awaiting any request. Otherwise a very fast
  // readonly transaction can finish before transactionDone starts listening.
  const done = transactionDone(transaction);
  try {
    const result = await operation(transaction);
    await done;
    return result;
  } catch (error) {
    try { transaction.abort(); } catch { /* The transaction may already be settled. */ }
    await done.catch(() => undefined);
    throw error;
  }
}

function hasStores(database: IDBDatabase, names: readonly string[]): boolean {
  return names.every((name) => database.objectStoreNames.contains(name));
}

function detectDatabaseSchema(database: IDBDatabase): ResourceDatabaseSchema {
  if (hasStores(database, [OFFICIAL_STORES.packs, OFFICIAL_STORES.selections, OFFICIAL_STORES.assets])) {
    return 'official-v1';
  }
  if (hasStores(database, [LEGACY_STORES.packs, LEGACY_STORES.selections, LEGACY_STORES.assets])) {
    return 'reconstructed-v1';
  }
  throw new Error('AVG 资源数据库结构不完整；请重新载入页面后再试。');
}

async function openDatabase(name: string): Promise<{ database: IDBDatabase; schema: ResourceDatabaseSchema }> {
  if (typeof indexedDB === 'undefined') throw new Error('当前浏览器不支持本地 AVG 资源包。');
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, AVG_RESOURCE_PACK_DATABASE_VERSION);
    opening.onupgradeneeded = () => {
      const database = opening.result;
      const transaction = opening.transaction;
      const packs = database.objectStoreNames.contains(OFFICIAL_STORES.packs)
        ? transaction?.objectStore(OFFICIAL_STORES.packs)
        : database.createObjectStore(OFFICIAL_STORES.packs, { keyPath: 'packId' });
      if (packs && !packs.indexNames.contains(OFFICIAL_STORES.worldBookIndex)) {
        packs.createIndex(OFFICIAL_STORES.worldBookIndex, 'worldBookId');
      }
      if (!database.objectStoreNames.contains(OFFICIAL_STORES.selections)) {
        database.createObjectStore(OFFICIAL_STORES.selections, { keyPath: 'worldBookId' });
      }
      const assets = database.objectStoreNames.contains(OFFICIAL_STORES.assets)
        ? transaction?.objectStore(OFFICIAL_STORES.assets)
        : database.createObjectStore(OFFICIAL_STORES.assets, { keyPath: 'key' });
      if (assets && !assets.indexNames.contains(OFFICIAL_STORES.namespaceIndex)) {
        assets.createIndex(OFFICIAL_STORES.namespaceIndex, 'namespace');
      }
    };
    opening.onsuccess = () => {
      try {
        resolve({ database: opening.result, schema: detectDatabaseSchema(opening.result) });
      } catch (error) {
        opening.result.close();
        reject(error);
      }
    };
    opening.onerror = () => reject(opening.error ?? new Error('无法打开 AVG 资源包数据库。'));
    opening.onblocked = () => reject(new Error('AVG 资源数据库正被其他页面占用，请关闭旧页面后重试。'));
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function createStorageNamespace(): string {
  const suffix = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `cocv2-avg-${suffix}`;
}

function emitChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AVG_RESOURCE_PACK_CHANGED_EVENT));
}

const OPFS_DIRECTORY = 'chronicles-of-chaos-v2-avg-resource-packs';

function assertSafeNamespace(namespace: string): void {
  if (!/^[a-zA-Z0-9._-]{1,180}$/u.test(namespace)) throw new Error('AVG 资源命名空间不安全。');
}

async function openOpfsNamespace(
  namespace: string,
  create: boolean,
  schema: ResourceDatabaseSchema = 'official-v1',
): Promise<FileSystemDirectoryHandle | undefined> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') return undefined;
  try {
    if (schema === 'official-v1') assertSafeNamespace(namespace);
    const root = await navigator.storage.getDirectory();
    const packs = await root.getDirectoryHandle(OPFS_DIRECTORY, { create });
    return await packs.getDirectoryHandle(schema === 'official-v1' ? namespace : encodeURIComponent(namespace), { create });
  } catch {
    return undefined;
  }
}

async function writeOpfsAsset(namespace: string, path: string, blob: Blob, schema: ResourceDatabaseSchema): Promise<void> {
  let directory = await openOpfsNamespace(namespace, true, schema);
  if (!directory) throw new Error('浏览器文件存储暂时不可用。');
  const segments = path.split('/');
  const fileName = segments.pop();
  if (!fileName) throw new Error(`AVG 资源路径无效：${path}`);
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create: true });
  const file = await directory.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  try { await writable.write(blob); } finally { await writable.close(); }
}

async function readOpfsAsset(namespace: string, path: string, schema: ResourceDatabaseSchema): Promise<Blob | undefined> {
  let directory = await openOpfsNamespace(namespace, false, schema);
  if (!directory) return undefined;
  const segments = path.split('/');
  const fileName = segments.pop();
  if (!fileName) return undefined;
  try {
    for (const segment of segments) directory = await directory.getDirectoryHandle(segment);
    return await (await directory.getFileHandle(fileName)).getFile();
  } catch {
    return undefined;
  }
}

async function removeOpfsNamespace(namespace: string, schema: ResourceDatabaseSchema): Promise<void> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') return;
  try {
    const root = await navigator.storage.getDirectory();
    const packs = await root.getDirectoryHandle(OPFS_DIRECTORY);
    await packs.removeEntry(schema === 'official-v1' ? namespace : encodeURIComponent(namespace), { recursive: true });
  } catch {
    // Missing namespaces are already clean.
  }
}

export class AvgResourcePackManager {
  constructor(private readonly databaseName = AVG_RESOURCE_PACK_DATABASE) {}

  private async withDatabase<T>(
    operation: (database: IDBDatabase, schema: ResourceDatabaseSchema) => Promise<T>,
  ): Promise<T> {
    const opened = await openDatabase(this.databaseName);
    try { return await operation(opened.database, opened.schema); } finally { opened.database.close(); }
  }

  private async currentSchema(): Promise<ResourceDatabaseSchema> {
    return this.withDatabase(async (_database, schema) => schema);
  }

  private async deleteStoredAssets(
    namespace: string,
    backend: InstalledAvgResourcePack['storageBackend'] = 'indexeddb',
    schema: ResourceDatabaseSchema,
  ): Promise<void> {
    if (backend === 'opfs') {
      await removeOpfsNamespace(namespace, schema);
      return;
    }
    await this.withDatabase(async (database, activeSchema) => {
      const storeName = activeSchema === 'official-v1' ? OFFICIAL_STORES.assets : LEGACY_STORES.assets;
      const indexName = activeSchema === 'official-v1' ? OFFICIAL_STORES.namespaceIndex : LEGACY_STORES.namespaceIndex;
      await runTransaction(database, storeName, 'readwrite', async (transaction) => {
        const assets = transaction.objectStore(storeName);
        const keys = await request<IDBValidKey[]>(assets.index(indexName).getAllKeys(namespace));
        keys.forEach((key) => assets.delete(key));
      });
    });
  }

  private async storeTemporaryAsset(
    namespace: string,
    path: string,
    blob: Blob,
    backend: InstalledAvgResourcePack['storageBackend'],
    schema: ResourceDatabaseSchema,
  ): Promise<void> {
    if (backend === 'opfs') {
      await writeOpfsAsset(namespace, path, blob, schema);
      return;
    }
    await this.withDatabase(async (database, activeSchema) => {
      const storeName = activeSchema === 'official-v1' ? OFFICIAL_STORES.assets : LEGACY_STORES.assets;
      await runTransaction(database, storeName, 'readwrite', async (transaction) => {
        if (activeSchema === 'official-v1') {
          transaction.objectStore(storeName).put({
            key: `${namespace}:${path}`,
            namespace,
            path,
            blob,
          } satisfies OfficialAssetRow);
        } else {
          transaction.objectStore(storeName).put({
            key: `${namespace}|${path}`,
            packId: namespace,
            assetId: path,
            path,
            blob,
          } satisfies LegacyAssetRow);
        }
      });
    });
  }

  private async readTemporaryAsset(
    namespace: string,
    path: string,
    backend: InstalledAvgResourcePack['storageBackend'],
    schema: ResourceDatabaseSchema,
    legacyAssetId?: string,
  ): Promise<Blob | undefined> {
    if (backend === 'opfs') return readOpfsAsset(namespace, path, schema);
    return this.withDatabase(async (database, activeSchema) => {
      const storeName = activeSchema === 'official-v1' ? OFFICIAL_STORES.assets : LEGACY_STORES.assets;
      return runTransaction(database, storeName, 'readonly', async (transaction) => {
        const store = transaction.objectStore(storeName);
        const primaryKey = activeSchema === 'official-v1' ? `${namespace}:${path}` : `${namespace}|${path}`;
        let row = await request<OfficialAssetRow | LegacyAssetRow | undefined>(store.get(primaryKey));
        if (!row && activeSchema === 'reconstructed-v1' && legacyAssetId) {
          row = await request<LegacyAssetRow | undefined>(store.get(`${namespace}|${legacyAssetId}`));
        }
        return row?.blob;
      });
    });
  }

  async install(file: Blob, options: { archiveLabel?: string; onProgress?: (progress: AvgResourcePackProgress) => void } = {}): Promise<InstalledAvgResourcePack> {
    if (file.size <= 0 || file.size > MAX_AVG_RESOURCE_ARCHIVE_BYTES) throw new Error('资源包 ZIP 大小不正确或超过 3 GiB。');
    options.onProgress?.({ phase: 'reading', archiveBytesRead: 0, archiveByteLength: file.size, entriesRead: 0 });
    const schema = await this.currentSchema();
    const storageNamespace = createStorageNamespace();
    const storageBackend: InstalledAvgResourcePack['storageBackend'] = await openOpfsNamespace(storageNamespace, true, schema)
      ? 'opfs'
      : 'indexeddb';
    let archiveBytesRead = 0;
    let expandedBytes = 0;
    let entriesRead = 0;
    let manifestBytes: Uint8Array | undefined;
    const entryNames = new Set<string>();
    try {
      const { AsyncUnzipInflate, Unzip, UnzipInflate, strFromU8 } = await import('fflate');
      const pendingEntries: Promise<void>[] = [];
      const unzip = new Unzip((entry) => {
        if (entry.name.endsWith('/')) {
          entry.ondata = (error) => { if (error) throw error; };
          entry.start();
          return;
        }
        entriesRead += 1;
        if (entriesRead > MAX_AVG_RESOURCE_COUNT + 1) throw new Error('资源包文件数量超过 5000 项上限。');
        if (entryNames.has(entry.name)) throw new Error(`资源包包含重复路径：${entry.name}`);
        entryNames.add(entry.name);
        if (entry.originalSize !== undefined && entry.originalSize > MAX_AVG_RESOURCE_FILE_BYTES) {
          throw new Error(`资源包单个文件超过 96 MiB：${entry.name}`);
        }
        const chunks: Uint8Array[] = [];
        let entryBytes = 0;
        let resolveEntry!: () => void;
        let rejectEntry!: (reason: unknown) => void;
        pendingEntries.push(new Promise<void>((resolve, reject) => { resolveEntry = resolve; rejectEntry = reject; }));
        entry.ondata = (error, chunk, final) => {
          if (error) { rejectEntry(error); return; }
          entryBytes += chunk.byteLength;
          expandedBytes += chunk.byteLength;
          if (entryBytes > MAX_AVG_RESOURCE_FILE_BYTES) { rejectEntry(new Error(`资源包单个文件超过 96 MiB：${entry.name}`)); return; }
          if (expandedBytes > MAX_AVG_RESOURCE_EXPANDED_BYTES) { rejectEntry(new Error('资源包解压后超过 4 GiB。')); return; }
          chunks.push(chunk);
          if (!final) return;
          const blob = new Blob(chunks, { type: entry.name === 'manifest.json' ? 'application/json' : 'image/webp' });
          void (async () => {
            if (entry.name === 'manifest.json') {
              manifestBytes = new Uint8Array(await blob.arrayBuffer());
            } else if (/^assets\/[A-Za-z0-9._/-]+\.webp$/u.test(entry.name) && !entry.name.includes('..')) {
              await this.storeTemporaryAsset(storageNamespace, entry.name, blob, storageBackend, schema);
            }
          })().then(resolveEntry, rejectEntry);
        };
        entry.start();
      });
      unzip.register(UnzipInflate);
      unzip.register(AsyncUnzipInflate);
      const reader = file.stream().getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        archiveBytesRead += value.byteLength;
        unzip.push(value, false);
        options.onProgress?.({ phase: 'reading', archiveBytesRead, archiveByteLength: file.size, entriesRead });
      }
      unzip.push(new Uint8Array(), true);
      await Promise.all(pendingEntries);
      if (!manifestBytes) throw new Error('资源包 ZIP 缺少 manifest.json。');
      const manifest = parseManifest(JSON.parse(strFromU8(manifestBytes)));
      assertSupportedRegistry(manifest);
      const allowedPaths = new Set(['manifest.json', ...manifest.assets.map((asset) => asset.path)]);
      const extra = [...entryNames].find((path) => !allowedPaths.has(path));
      if (extra) throw new Error(`资源包包含未登记文件：${extra}`);
      for (const [index, asset] of manifest.assets.entries()) {
        const blob = await this.readTemporaryAsset(storageNamespace, asset.path, storageBackend, schema);
        if (!blob || blob.size !== asset.byteLength) throw new Error(`资源包图片缺失或大小不符：${asset.path}`);
        const entry = new Uint8Array(await blob.arrayBuffer());
        const dimensions = readWebpSize(entry);
        if (!dimensions) throw new Error(`图片并非完整有效的 WebP：${asset.path}`);
        if (dimensions.width !== asset.width || dimensions.height !== asset.height) throw new Error(`图片尺寸不符：${asset.path}`);
        if (await sha256(entry) !== asset.sha256) throw new Error(`图片校验失败：${asset.path}`);
        options.onProgress?.({ phase: 'validating', archiveBytesRead, archiveByteLength: file.size, entriesRead: index + 1 });
      }
      options.onProgress?.({ phase: 'committing', archiveBytesRead, archiveByteLength: file.size, entriesRead: manifest.assets.length });
      const installedAt = new Date().toISOString();
      const installed: InstalledAvgResourcePack = {
        manifest,
        installedAt,
        storageBackend,
        storageNamespace,
        archiveByteLength: file.size,
        validationStatus: 'valid',
      };
      let replacedStorageNamespace: string | undefined;
      let replacedStorageBackend: InstalledAvgResourcePack['storageBackend'] = 'indexeddb';
      await this.withDatabase(async (database, activeSchema) => {
        const packStoreName = activeSchema === 'official-v1' ? OFFICIAL_STORES.packs : LEGACY_STORES.packs;
        const selectionStoreName = activeSchema === 'official-v1' ? OFFICIAL_STORES.selections : LEGACY_STORES.selections;
        await runTransaction(database, [packStoreName, selectionStoreName], 'readwrite', async (transaction) => {
          const packs = transaction.objectStore(packStoreName);
          if (activeSchema === 'official-v1') {
            const previous = await request<OfficialPackRow | undefined>(packs.get(manifest.packId));
            const selectionStore = transaction.objectStore(selectionStoreName);
            const selection = await request<OfficialSelectionRow | undefined>(selectionStore.get(manifest.worldBookId));
            replacedStorageNamespace = previous?.record.storageNamespace;
            replacedStorageBackend = previous?.record.storageBackend ?? 'indexeddb';
            packs.put({ packId: manifest.packId, worldBookId: manifest.worldBookId, record: installed } satisfies OfficialPackRow);
            selectionStore.put({
              worldBookId: manifest.worldBookId,
              packId: !selection?.packId || selection.packId === manifest.packId ? manifest.packId : selection.packId,
              updatedAt: installedAt,
            } satisfies OfficialSelectionRow);
          } else {
            const previous = await request<LegacyPackRow | undefined>(packs.get(manifest.packId));
            replacedStorageNamespace = previous?.storagePackId ?? previous?.packId;
            replacedStorageBackend = previous?.storageBackend ?? 'indexeddb';
            packs.put({
              ...installed,
              packId: manifest.packId,
              worldBookId: manifest.worldBookId,
              storagePackId: storageNamespace,
            } satisfies LegacyPackRow);
            transaction.objectStore(selectionStoreName).put({ worldBookId: manifest.worldBookId, packId: manifest.packId });
          }
        });
      });
      if (replacedStorageNamespace && replacedStorageNamespace !== storageNamespace) {
        await this.deleteStoredAssets(replacedStorageNamespace, replacedStorageBackend, schema);
      }
      emitChanged();
      return installed;
    } catch (error) {
      await this.deleteStoredAssets(storageNamespace, storageBackend, schema).catch(() => undefined);
      throw error;
    }
  }

  async list(worldBookId: string): Promise<InstalledAvgResourcePack[]> {
    return this.withDatabase(async (database, schema) => {
      const storeName = schema === 'official-v1' ? OFFICIAL_STORES.packs : LEGACY_STORES.packs;
      const indexName = schema === 'official-v1' ? OFFICIAL_STORES.worldBookIndex : LEGACY_STORES.worldBookIndex;
      return runTransaction(database, storeName, 'readonly', async (transaction) => {
        const rows = await request<Array<OfficialPackRow | LegacyPackRow>>(transaction.objectStore(storeName).index(indexName).getAll(worldBookId));
        return schema === 'official-v1'
          ? (rows as OfficialPackRow[]).map((row) => row.record)
          : (rows as LegacyPackRow[]).map(({ manifest, installedAt, storageBackend }) => ({ manifest, installedAt, storageBackend }));
      });
    });
  }

  async getActive(worldBookId: string): Promise<InstalledAvgResourcePack | undefined> {
    const details = await this.getActiveDetails(worldBookId);
    return details?.record;
  }

  private async getActiveDetails(worldBookId: string): Promise<{
    record: InstalledAvgResourcePack;
    namespace: string;
    schema: ResourceDatabaseSchema;
  } | undefined> {
    return this.withDatabase(async (database, schema) => {
      const packStoreName = schema === 'official-v1' ? OFFICIAL_STORES.packs : LEGACY_STORES.packs;
      const selectionStoreName = schema === 'official-v1' ? OFFICIAL_STORES.selections : LEGACY_STORES.selections;
      return runTransaction(database, [selectionStoreName, packStoreName], 'readonly', async (transaction) => {
        const active = await request<{ worldBookId: string; packId?: string } | undefined>(transaction.objectStore(selectionStoreName).get(worldBookId));
        const row = active?.packId
          ? await request<OfficialPackRow | LegacyPackRow | undefined>(transaction.objectStore(packStoreName).get(active.packId))
          : undefined;
        if (!row) return undefined;
        if (schema === 'official-v1') {
          const record = (row as OfficialPackRow).record;
          if (record.manifest.worldBookId !== worldBookId || record.validationStatus !== 'valid' || !record.storageNamespace) return undefined;
          return { record, namespace: record.storageNamespace, schema };
        }
        const legacy = row as LegacyPackRow;
        if (legacy.worldBookId !== worldBookId) return undefined;
        return {
          record: { manifest: legacy.manifest, installedAt: legacy.installedAt, storageBackend: legacy.storageBackend },
          namespace: legacy.storagePackId ?? legacy.packId,
          schema,
        };
      });
    });
  }

  async select(worldBookId: string, packId: string): Promise<void> {
    await this.withDatabase(async (database, schema) => {
      const packStoreName = schema === 'official-v1' ? OFFICIAL_STORES.packs : LEGACY_STORES.packs;
      const selectionStoreName = schema === 'official-v1' ? OFFICIAL_STORES.selections : LEGACY_STORES.selections;
      await runTransaction(database, [packStoreName, selectionStoreName], 'readwrite', async (transaction) => {
        const row = await request<OfficialPackRow | LegacyPackRow | undefined>(transaction.objectStore(packStoreName).get(packId));
        const valid = schema === 'official-v1'
          ? Boolean(row && (row as OfficialPackRow).worldBookId === worldBookId && (row as OfficialPackRow).record.validationStatus === 'valid')
          : Boolean(row && (row as LegacyPackRow).worldBookId === worldBookId);
        if (!valid) throw new Error('所选 AVG 资源包不存在、世界不匹配或未通过校验。');
        transaction.objectStore(selectionStoreName).put({ worldBookId, packId, updatedAt: new Date().toISOString() });
      });
    });
    emitChanged();
  }

  async uninstall(packId: string): Promise<void> {
    let removedStorage: { namespace: string; backend: InstalledAvgResourcePack['storageBackend']; schema: ResourceDatabaseSchema } | undefined;
    await this.withDatabase(async (database, schema) => {
      const packStoreName = schema === 'official-v1' ? OFFICIAL_STORES.packs : LEGACY_STORES.packs;
      const selectionStoreName = schema === 'official-v1' ? OFFICIAL_STORES.selections : LEGACY_STORES.selections;
      await runTransaction(database, [packStoreName, selectionStoreName], 'readwrite', async (transaction) => {
        const packs = transaction.objectStore(packStoreName);
        const row = await request<OfficialPackRow | LegacyPackRow | undefined>(packs.get(packId));
        if (!row) return;
        const record = schema === 'official-v1' ? (row as OfficialPackRow).record : row as LegacyPackRow;
        const worldBookId = schema === 'official-v1' ? (row as OfficialPackRow).worldBookId : (row as LegacyPackRow).worldBookId;
        const namespace = schema === 'official-v1' ? record.storageNamespace : (record as LegacyPackRow).storagePackId ?? packId;
        if (namespace) removedStorage = { namespace, backend: record.storageBackend ?? 'indexeddb', schema };
        packs.delete(packId);
        const activeStore = transaction.objectStore(selectionStoreName);
        const active = await request<OfficialSelectionRow | undefined>(activeStore.get(worldBookId));
        if (active?.packId === packId) {
          if (schema === 'official-v1') activeStore.put({ ...active, packId: undefined, updatedAt: new Date().toISOString() });
          else activeStore.delete(worldBookId);
        }
      });
    });
    if (removedStorage) await this.deleteStoredAssets(removedStorage.namespace, removedStorage.backend, removedStorage.schema);
    emitChanged();
  }

  async lookupActiveAsset(worldBookId: string, assetId: string): Promise<Blob | undefined> {
    const active = await this.getActiveDetails(worldBookId);
    const manifestAsset = active?.record.manifest.assets.find((asset) => asset.assetId === assetId);
    if (!active || !manifestAsset) return undefined;
    return this.readTemporaryAsset(
      active.namespace,
      manifestAsset.path,
      active.record.storageBackend,
      active.schema,
      assetId,
    );
  }

  async lookupActiveResource(
    worldBookId: string,
    kind: AvgResourcePackAssetManifest['kind'],
    resourceId: string,
    preferredVariant?: string,
  ): Promise<Blob | undefined> {
    const active = await this.getActive(worldBookId);
    const candidates = active?.manifest.assets.filter((asset) => asset.kind === kind && asset.resourceId === resourceId) ?? [];
    const selected = candidates.find((asset) => asset.variant === preferredVariant)
      ?? candidates.find((asset) => asset.variant === 'default')
      ?? candidates[0];
    return selected ? this.lookupActiveAsset(worldBookId, selected.assetId) : undefined;
  }

  async lookupActivePortrait(
    worldBookId: string,
    actorId: string,
    sex?: string,
  ): Promise<Blob | undefined> {
    const active = await this.getActive(worldBookId);
    if (!active) return undefined;
    const fixed = active.manifest.assets.find((asset) => (
      asset.kind === 'fixed-portrait'
      && (asset.resourceId.endsWith(`:${actorId}`) || asset.resourceId.includes(actorId))
    ));
    if (fixed) return this.lookupActiveAsset(worldBookId, fixed.assetId);

    const normalizedSex = sex?.toLowerCase();
    const marker = normalizedSex === '女' || normalizedSex === 'female'
      ? '_female_'
      : normalizedSex === '男' || normalizedSex === 'male'
        ? '_male_'
        : '';
    const resources = [...new Set(active.manifest.assets
      .filter((asset) => asset.kind === 'generic-portrait' && (!marker || asset.resourceId.includes(marker)))
      .map((asset) => asset.resourceId))].sort();
    if (resources.length === 0) return undefined;
    let hash = 2166136261;
    for (const character of actorId) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    const resourceId = resources[(hash >>> 0) % resources.length];
    return this.lookupActiveResource(worldBookId, 'generic-portrait', resourceId, 'default');
  }
}

export async function resetAvgResourcePackDatabaseForTests(name = AVG_RESOURCE_PACK_DATABASE): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const deletion = indexedDB.deleteDatabase(name);
    deletion.onsuccess = () => resolve(); deletion.onerror = () => reject(deletion.error); deletion.onblocked = () => reject(new Error('数据库被占用。'));
  });
}
