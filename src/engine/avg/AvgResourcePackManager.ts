import threeKingdomsRegistryJson from './ThreeKingdomsAvgRegistry.generated.json';

export const AVG_RESOURCE_PACK_FORMAT = 'chronicles-of-chaos-v2-avg-resource-pack';
export const AVG_RESOURCE_PACK_DATABASE = 'chronicles-of-chaos-v2-avg-resource-packs';
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
}

export interface AvgResourcePackProgress {
  phase: 'reading' | 'validating' | 'committing';
  archiveBytesRead: number;
  archiveByteLength: number;
  entriesRead: number;
}

type PackRow = InstalledAvgResourcePack & { packId: string; worldBookId: string; storagePackId?: string };
type AssetRow = { key: string; packId: string; assetId: string; path?: string; blob: Blob };
const stores = ['packs', 'assets', 'active'] as const;

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

async function openDatabase(name: string): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('当前浏览器不支持本地 AVG 资源包。');
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, 1);
    opening.onupgradeneeded = () => {
      const database = opening.result;
      if (!database.objectStoreNames.contains('packs')) database.createObjectStore('packs', { keyPath: 'packId' }).createIndex('worldBookId', 'worldBookId');
      if (!database.objectStoreNames.contains('assets')) database.createObjectStore('assets', { keyPath: 'key' }).createIndex('packId', 'packId');
      if (!database.objectStoreNames.contains('active')) database.createObjectStore('active', { keyPath: 'worldBookId' });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error('无法打开 AVG 资源包数据库。'));
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function createStoragePackId(): string {
  const suffix = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `__install__:${suffix}`;
}

function emitChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AVG_RESOURCE_PACK_CHANGED_EVENT));
}

const OPFS_DIRECTORY = 'chronicles-of-chaos-v2-avg-resource-packs';

async function openOpfsNamespace(namespace: string, create: boolean): Promise<FileSystemDirectoryHandle | undefined> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') return undefined;
  try {
    const root = await navigator.storage.getDirectory();
    const packs = await root.getDirectoryHandle(OPFS_DIRECTORY, { create });
    return await packs.getDirectoryHandle(encodeURIComponent(namespace), { create });
  } catch {
    return undefined;
  }
}

async function writeOpfsAsset(namespace: string, path: string, blob: Blob): Promise<void> {
  let directory = await openOpfsNamespace(namespace, true);
  if (!directory) throw new Error('浏览器文件存储暂时不可用。');
  const segments = path.split('/');
  const fileName = segments.pop();
  if (!fileName) throw new Error(`AVG 资源路径无效：${path}`);
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create: true });
  const file = await directory.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  try { await writable.write(blob); } finally { await writable.close(); }
}

async function readOpfsAsset(namespace: string, path: string): Promise<Blob | undefined> {
  let directory = await openOpfsNamespace(namespace, false);
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

async function removeOpfsNamespace(namespace: string): Promise<void> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') return;
  try {
    const root = await navigator.storage.getDirectory();
    const packs = await root.getDirectoryHandle(OPFS_DIRECTORY);
    await packs.removeEntry(encodeURIComponent(namespace), { recursive: true });
  } catch {
    // Missing namespaces are already clean.
  }
}

export class AvgResourcePackManager {
  constructor(private readonly databaseName = AVG_RESOURCE_PACK_DATABASE) {}

  private async withDatabase<T>(operation: (database: IDBDatabase) => Promise<T>): Promise<T> {
    const database = await openDatabase(this.databaseName);
    try { return await operation(database); } finally { database.close(); }
  }

  private async deleteStoredAssets(storagePackId: string, backend: InstalledAvgResourcePack['storageBackend'] = 'indexeddb'): Promise<void> {
    if (backend === 'opfs') {
      await removeOpfsNamespace(storagePackId);
      return;
    }
    await this.withDatabase(async (database) => {
      const transaction = database.transaction('assets', 'readwrite');
      const assets = transaction.objectStore('assets');
      const keys = await request<IDBValidKey[]>(assets.index('packId').getAllKeys(storagePackId));
      keys.forEach((key) => assets.delete(key));
      await transactionDone(transaction);
    });
  }

  private async storeTemporaryAsset(
    storagePackId: string,
    path: string,
    blob: Blob,
    backend: InstalledAvgResourcePack['storageBackend'],
  ): Promise<void> {
    if (backend === 'opfs') {
      await writeOpfsAsset(storagePackId, path, blob);
      return;
    }
    await this.withDatabase(async (database) => {
      const transaction = database.transaction('assets', 'readwrite');
      transaction.objectStore('assets').put({
        key: `${storagePackId}|${path}`,
        packId: storagePackId,
        assetId: path,
        path,
        blob,
      } satisfies AssetRow);
      await transactionDone(transaction);
    });
  }

  private async readTemporaryAsset(
    storagePackId: string,
    path: string,
    backend: InstalledAvgResourcePack['storageBackend'],
  ): Promise<Blob | undefined> {
    if (backend === 'opfs') return readOpfsAsset(storagePackId, path);
    return this.withDatabase(async (database) => {
      const transaction = database.transaction('assets', 'readonly');
      const row = await request<AssetRow | undefined>(transaction.objectStore('assets').get(`${storagePackId}|${path}`));
      await transactionDone(transaction);
      return row?.blob;
    });
  }

  async install(file: Blob, options: { archiveLabel?: string; onProgress?: (progress: AvgResourcePackProgress) => void } = {}): Promise<InstalledAvgResourcePack> {
    if (file.size <= 0 || file.size > MAX_AVG_RESOURCE_ARCHIVE_BYTES) throw new Error('资源包 ZIP 大小不正确或超过 3 GiB。');
    options.onProgress?.({ phase: 'reading', archiveBytesRead: 0, archiveByteLength: file.size, entriesRead: 0 });
    const storagePackId = createStoragePackId();
    const storageBackend: InstalledAvgResourcePack['storageBackend'] = await openOpfsNamespace(storagePackId, true)
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
              await this.storeTemporaryAsset(storagePackId, entry.name, blob, storageBackend);
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
        const blob = await this.readTemporaryAsset(storagePackId, asset.path, storageBackend);
        if (!blob || blob.size !== asset.byteLength) throw new Error(`资源包图片缺失或大小不符：${asset.path}`);
        const entry = new Uint8Array(await blob.arrayBuffer());
        const dimensions = readWebpSize(entry);
        if (!dimensions) throw new Error(`图片并非完整有效的 WebP：${asset.path}`);
        if (dimensions.width !== asset.width || dimensions.height !== asset.height) throw new Error(`图片尺寸不符：${asset.path}`);
        if (await sha256(entry) !== asset.sha256) throw new Error(`图片校验失败：${asset.path}`);
        options.onProgress?.({ phase: 'validating', archiveBytesRead, archiveByteLength: file.size, entriesRead: index + 1 });
      }
      options.onProgress?.({ phase: 'committing', archiveBytesRead, archiveByteLength: file.size, entriesRead: manifest.assets.length });
      const installed: InstalledAvgResourcePack = { manifest, installedAt: new Date().toISOString(), storageBackend };
      let replacedStoragePackId: string | undefined;
      let replacedStorageBackend: InstalledAvgResourcePack['storageBackend'] = 'indexeddb';
      await this.withDatabase(async (database) => {
        const transaction = database.transaction(['packs', 'active'], 'readwrite');
        const packs = transaction.objectStore('packs');
        const previous = await request<PackRow | undefined>(packs.get(manifest.packId));
        replacedStoragePackId = previous?.storagePackId ?? previous?.packId;
        replacedStorageBackend = previous?.storageBackend ?? 'indexeddb';
        packs.put({ ...installed, packId: manifest.packId, worldBookId: manifest.worldBookId, storagePackId } satisfies PackRow);
        transaction.objectStore('active').put({ worldBookId: manifest.worldBookId, packId: manifest.packId });
        await transactionDone(transaction);
      });
      if (replacedStoragePackId && replacedStoragePackId !== storagePackId) {
        await this.deleteStoredAssets(replacedStoragePackId, replacedStorageBackend);
      }
      emitChanged();
      return installed;
    } catch (error) {
      await this.deleteStoredAssets(storagePackId, storageBackend).catch(() => undefined);
      throw error;
    }
  }

  async list(worldBookId: string): Promise<InstalledAvgResourcePack[]> {
    return this.withDatabase(async (database) => {
      const transaction = database.transaction('packs', 'readonly');
      const rows = await request<PackRow[]>(transaction.objectStore('packs').index('worldBookId').getAll(worldBookId));
      await transactionDone(transaction);
      return rows.map(({ manifest, installedAt, storageBackend }) => ({ manifest, installedAt, storageBackend }));
    });
  }

  async getActive(worldBookId: string): Promise<InstalledAvgResourcePack | undefined> {
    return this.withDatabase(async (database) => {
      const transaction = database.transaction(['active', 'packs'], 'readonly');
      const active = await request<{ worldBookId: string; packId: string } | undefined>(transaction.objectStore('active').get(worldBookId));
      const row = active ? await request<PackRow | undefined>(transaction.objectStore('packs').get(active.packId)) : undefined;
      await transactionDone(transaction);
      return row ? { manifest: row.manifest, installedAt: row.installedAt, storageBackend: row.storageBackend } : undefined;
    });
  }

  async select(worldBookId: string, packId: string): Promise<void> {
    await this.withDatabase(async (database) => {
      const transaction = database.transaction(['packs', 'active'], 'readwrite');
      const row = await request<PackRow | undefined>(transaction.objectStore('packs').get(packId));
      if (!row || row.worldBookId !== worldBookId) { transaction.abort(); throw new Error('所选资源包不存在。'); }
      transaction.objectStore('active').put({ worldBookId, packId });
      await transactionDone(transaction);
    });
    emitChanged();
  }

  async uninstall(packId: string): Promise<void> {
    let removedStorage: { namespace: string; backend: InstalledAvgResourcePack['storageBackend'] } | undefined;
    await this.withDatabase(async (database) => {
      const transaction = database.transaction([...stores], 'readwrite');
      const packs = transaction.objectStore('packs');
      const row = await request<PackRow | undefined>(packs.get(packId));
      if (!row) { await transactionDone(transaction); return; }
      const namespace = row.storagePackId ?? packId;
      const backend = row.storageBackend ?? 'indexeddb';
      removedStorage = { namespace, backend };
      if (backend === 'indexeddb') {
        const assets = transaction.objectStore('assets');
        const keys = await request<IDBValidKey[]>(assets.index('packId').getAllKeys(namespace));
        keys.forEach((key) => assets.delete(key));
      }
      packs.delete(packId);
      const activeStore = transaction.objectStore('active');
      const active = await request<{ worldBookId: string; packId: string } | undefined>(activeStore.get(row.worldBookId));
      if (active?.packId === packId) activeStore.delete(row.worldBookId);
      await transactionDone(transaction);
    });
    if (removedStorage?.backend === 'opfs') await removeOpfsNamespace(removedStorage.namespace);
    emitChanged();
  }

  async lookupActiveAsset(worldBookId: string, assetId: string): Promise<Blob | undefined> {
    return this.withDatabase(async (database) => {
      const transaction = database.transaction(['active', 'assets', 'packs'], 'readonly');
      const active = await request<{ worldBookId: string; packId: string } | undefined>(transaction.objectStore('active').get(worldBookId));
      const pack = active
        ? await request<PackRow | undefined>(transaction.objectStore('packs').get(active.packId))
        : undefined;
      const manifestAsset = pack?.manifest.assets.find((asset) => asset.assetId === assetId);
      const storagePackId = pack?.storagePackId ?? active?.packId;
      const key = storagePackId && manifestAsset && pack?.storagePackId
        ? `${storagePackId}|${manifestAsset.path}`
        : storagePackId ? `${storagePackId}|${assetId}` : undefined;
      const row = pack?.storageBackend !== 'opfs' && key
        ? await request<AssetRow | undefined>(transaction.objectStore('assets').get(key))
        : undefined;
      await transactionDone(transaction);
      if (row?.blob) return row.blob;
      return pack?.storageBackend === 'opfs' && storagePackId && manifestAsset
        ? readOpfsAsset(storagePackId, manifestAsset.path)
        : undefined;
    });
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
