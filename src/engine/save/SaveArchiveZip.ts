import type { SaveData } from '../types';
import type { StoredTurnSnapshot } from '../turn/TurnSnapshotStore';
import type { SaveArchive } from './SaveManager';

type SaveArchiveCodec = typeof import('fflate');

let saveArchiveCodecPromise: Promise<SaveArchiveCodec> | undefined;

function loadSaveArchiveCodec(): Promise<SaveArchiveCodec> {
  saveArchiveCodecPromise ??= import('fflate');
  return saveArchiveCodecPromise;
}

export const PORTABLE_SAVE_ZIP_FORMAT = 'chronicles-of-chaos-v2-save-archive';
export const PORTABLE_SAVE_ZIP_VERSION = 2;

const ASSET_FOLDERS = {
  characters: 'assets/images/characters',
  locations: 'assets/images/locations',
  events: 'assets/images/events',
  objects: 'assets/images/objects',
} as const;

interface PortableSaveManifestEntry {
  path: string;
  saveId: string;
  saveKind: 'manual' | 'auto';
  label: string;
  playerName: string;
  currentDate: string;
  turnCount: number;
}

interface PortableSnapshotManifestEntry {
  path: string;
  snapshotId: string;
  saveId: string;
  turnNumber: number;
}

export interface PortableAvgVisualPartition {
  visualPartitionId: string;
  archiveBytes: Uint8Array;
  actorCount: number;
  sceneCount: number;
  outfitCount: number;
  outfitOverrideCount: number;
  assetCount: number;
  imageBytes: number;
}

interface PortableAvgVisualPartitionManifestEntry extends Omit<PortableAvgVisualPartition, 'archiveBytes'> {
  path: string;
  archiveBytes: number;
}

export interface PortableSaveZipBundle {
  archive: SaveArchive;
  visualCapability: 'portable-v2' | 'none';
  avgVisualPartitions: Array<PortableAvgVisualPartition & { path: string }>;
}

interface PortableSaveZipManifest {
  format: typeof PORTABLE_SAVE_ZIP_FORMAT;
  version: 1 | typeof PORTABLE_SAVE_ZIP_VERSION;
  schema: SaveArchive['schema'];
  archiveVersion: SaveArchive['version'];
  exportedAt: string;
  lastSaveId: string | null;
  saveCount: number;
  snapshotCount: number;
  saves: PortableSaveManifestEntry[];
  turnSnapshots: PortableSnapshotManifestEntry[];
  assetFolders: typeof ASSET_FOLDERS;
  avgVisualPartitions?: PortableAvgVisualPartitionManifestEntry[];
}

function safeFileSegment(value: string, fallback: string): string {
  const printable = Array.from(value.normalize('NFKC'), (character) => (
    character.charCodeAt(0) < 32 ? '-' : character
  )).join('');
  const cleaned = printable
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[.\s]+$/g, '')
    .trim();
  return cleaned || fallback;
}

function savePath(save: SaveData, index: number): string {
  const kind = save.saveKind === 'manual' ? 'manual' : 'auto';
  const order = String(index + 1).padStart(4, '0');
  const playerName = safeFileSegment(save.runtimeState.player.name, 'unknown-player');
  const turnCount = save.runtimeState.turnLog.length;
  return `saves/${kind}/${order}-${playerName}-turn-${turnCount}.json`;
}

function snapshotPath(snapshot: StoredTurnSnapshot, index: number): string {
  const order = String(index + 1).padStart(4, '0');
  const saveId = safeFileSegment(snapshot.saveId, 'unknown-save');
  return `rollback/${saveId}/${order}-turn-${snapshot.turnNumber}.json`;
}

async function zipAsync(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  const { zip, zipSync } = await loadSaveArchiveCodec();
  const zipSynchronously = () => zipSync(entries, { level: 6 });
  if (typeof Worker !== 'function') return zipSynchronously();

  try {
    return await new Promise((resolve, reject) => {
      zip(entries, { level: 6 }, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });
  } catch (asyncError) {
    try {
      return zipSynchronously();
    } catch {
      throw asyncError;
    }
  }
}

async function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  const { unzip, unzipSync } = await loadSaveArchiveCodec();
  const unzipSynchronously = () => unzipSync(data);
  if (typeof Worker !== 'function') return unzipSynchronously();

  try {
    return await new Promise((resolve, reject) => {
      unzip(data, (error, entries) => {
        if (error) reject(error);
        else resolve(entries);
      });
    });
  } catch (asyncError) {
    try {
      return unzipSynchronously();
    } catch {
      throw asyncError;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isManifestEntry(value: unknown): value is PortableSaveManifestEntry {
  return isRecord(value)
    && typeof value.path === 'string'
    && typeof value.saveId === 'string'
    && (value.saveKind === 'manual' || value.saveKind === 'auto');
}

function isSnapshotManifestEntry(value: unknown): value is PortableSnapshotManifestEntry {
  return isRecord(value)
    && typeof value.path === 'string'
    && typeof value.snapshotId === 'string'
    && typeof value.saveId === 'string'
    && Number.isInteger(value.turnNumber);
}

function isNonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isAvgVisualPartitionEntry(value: unknown): value is PortableAvgVisualPartitionManifestEntry {
  return isRecord(value)
    && typeof value.visualPartitionId === 'string'
    && value.visualPartitionId.trim().length > 0
    && typeof value.path === 'string'
    && isNonNegativeInteger(value.archiveBytes)
    && isNonNegativeInteger(value.actorCount)
    && isNonNegativeInteger(value.sceneCount)
    && isNonNegativeInteger(value.outfitCount)
    && isNonNegativeInteger(value.outfitOverrideCount)
    && isNonNegativeInteger(value.assetCount)
    && isNonNegativeInteger(value.imageBytes);
}

function parseManifest(value: unknown): PortableSaveZipManifest {
  if (!isRecord(value)
    || value.format !== PORTABLE_SAVE_ZIP_FORMAT
    || (value.version !== 1 && value.version !== PORTABLE_SAVE_ZIP_VERSION)
    || value.schema !== 'coc.v2.saves'
    || (value.archiveVersion !== 1 && value.archiveVersion !== 2)
    || typeof value.exportedAt !== 'string'
    || (value.lastSaveId !== null && typeof value.lastSaveId !== 'string')
    || !Number.isInteger(value.saveCount)
    || !Number.isInteger(value.snapshotCount)
    || !Array.isArray(value.saves)
    || !value.saves.every(isManifestEntry)
    || !Array.isArray(value.turnSnapshots)
    || !value.turnSnapshots.every(isSnapshotManifestEntry)
    || (value.version === PORTABLE_SAVE_ZIP_VERSION
      && (!Array.isArray(value.avgVisualPartitions) || !value.avgVisualPartitions.every(isAvgVisualPartitionEntry)))
    || (value.version === 1 && value.avgVisualPartitions !== undefined)) {
    throw new Error('存档 ZIP 清单格式不正确。');
  }
  return value as unknown as PortableSaveZipManifest;
}

function collectArchiveVisualPartitionIds(archive: SaveArchive): string[] {
  return [...new Set(archive.saves.flatMap((save) => {
    const direct = save.runtimeState.avgPresentation?.visualPartitionId?.trim();
    if (direct) return [direct];
    const legacy = [...new Set((save.runtimeState.avgPresentation?.portraitBindings ?? [])
      .map((binding) => binding.saveId?.trim()).filter(Boolean))];
    return legacy.length === 1 ? legacy : [];
  }))].sort();
}

export async function createPortableSaveZip(
  archive: SaveArchive,
  options: { avgVisualPartitions?: PortableAvgVisualPartition[] } = {},
): Promise<Uint8Array> {
  const { strToU8 } = await loadSaveArchiveCodec();
  const entries: Record<string, Uint8Array> = {};
  const saves: PortableSaveManifestEntry[] = archive.saves.map((save, index) => {
    const path = savePath(save, index);
    entries[path] = strToU8(JSON.stringify(save, null, 2));
    return {
      path,
      saveId: save.id,
      saveKind: save.saveKind === 'manual' ? 'manual' : 'auto',
      label: save.label,
      playerName: save.runtimeState.player.name,
      currentDate: save.currentDate,
      turnCount: save.runtimeState.turnLog.length,
    };
  });

  const turnSnapshots: PortableSnapshotManifestEntry[] = (archive.turnSnapshots ?? [])
    .map((snapshot, index) => {
      const path = snapshotPath(snapshot, index);
      entries[path] = strToU8(JSON.stringify(snapshot, null, 2));
      return {
        path,
        snapshotId: snapshot.id,
        saveId: snapshot.saveId,
        turnNumber: snapshot.turnNumber,
      };
    });

  const referencedPartitions = new Set(collectArchiveVisualPartitionIds(archive));
  const seenPartitionIds = new Set<string>();
  const seenVisualPaths = new Set<string>();
  const avgVisualPartitions: PortableAvgVisualPartitionManifestEntry[] = [];
  for (const [index, partition] of (options.avgVisualPartitions ?? []).entries()) {
    const visualPartitionId = partition.visualPartitionId.trim();
    if (!visualPartitionId || !referencedPartitions.has(visualPartitionId)) throw new Error('存档 ZIP 包含未知视觉分区。');
    if (seenPartitionIds.has(visualPartitionId)) throw new Error('存档 ZIP 包含重复视觉分区。');
    if (!(partition.archiveBytes instanceof Uint8Array) || partition.archiveBytes.byteLength === 0) {
      throw new Error('视觉分区归档不能为空。');
    }
    const path = `avg-visuals/${String(index + 1).padStart(4, '0')}-${safeFileSegment(visualPartitionId, 'visual')}.zip`;
    if (seenVisualPaths.has(path)) throw new Error('存档 ZIP 包含重复视觉路径。');
    seenPartitionIds.add(visualPartitionId);
    seenVisualPaths.add(path);
    entries[path] = partition.archiveBytes;
    avgVisualPartitions.push({
      visualPartitionId,
      path,
      archiveBytes: partition.archiveBytes.byteLength,
      actorCount: partition.actorCount,
      sceneCount: partition.sceneCount,
      outfitCount: partition.outfitCount,
      outfitOverrideCount: partition.outfitOverrideCount,
      assetCount: partition.assetCount,
      imageBytes: partition.imageBytes,
    });
  }

  const manifest: PortableSaveZipManifest = {
    format: PORTABLE_SAVE_ZIP_FORMAT,
    version: PORTABLE_SAVE_ZIP_VERSION,
    schema: archive.schema,
    archiveVersion: archive.version,
    exportedAt: archive.exportedAt,
    lastSaveId: archive.lastSaveId,
    saveCount: saves.length,
    snapshotCount: turnSnapshots.length,
    saves,
    turnSnapshots,
    assetFolders: ASSET_FOLDERS,
    avgVisualPartitions,
  };
  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  Object.values(ASSET_FOLDERS).forEach((folder) => {
    entries[`${folder}/.keep`] = new Uint8Array();
  });

  return zipAsync(entries);
}

export async function parsePortableSaveZipBundle(data: Uint8Array): Promise<PortableSaveZipBundle> {
  const { strFromU8 } = await loadSaveArchiveCodec();
  const entries = await unzipAsync(data);
  const manifestBytes = entries['manifest.json'];
  if (!manifestBytes) throw new Error('存档 ZIP 缺少 manifest.json。');
  const manifest = parseManifest(JSON.parse(strFromU8(manifestBytes)));
  if (manifest.saveCount !== manifest.saves.length
    || manifest.snapshotCount !== manifest.turnSnapshots.length) {
    throw new Error('存档 ZIP 清单数量不一致。');
  }

  const paths = new Set<string>();
  const saveIds = new Set<string>();
  const saves = manifest.saves.map((summary) => {
    if (paths.has(summary.path)
      || !summary.path.startsWith('saves/')
      || !summary.path.endsWith('.json')) {
      throw new Error('存档 ZIP 包含非法存档路径。');
    }
    paths.add(summary.path);
    const bytes = entries[summary.path];
    if (!bytes) throw new Error(`存档 ZIP 缺少存档文件：${summary.path}`);
    const save = JSON.parse(strFromU8(bytes)) as SaveData;
    if (save.id !== summary.saveId || saveIds.has(save.id)) {
      throw new Error('存档 ZIP 包含不匹配或重复的存档 ID。');
    }
    saveIds.add(save.id);
    return save;
  });

  const snapshotIds = new Set<string>();
  const turnSnapshots = manifest.turnSnapshots.map((summary) => {
    if (paths.has(summary.path)
      || !summary.path.startsWith('rollback/')
      || !summary.path.endsWith('.json')) {
      throw new Error('存档 ZIP 包含非法回溯路径。');
    }
    paths.add(summary.path);
    const bytes = entries[summary.path];
    if (!bytes) throw new Error(`存档 ZIP 缺少回溯文件：${summary.path}`);
    const snapshot = JSON.parse(strFromU8(bytes)) as StoredTurnSnapshot;
    if (snapshot.id !== summary.snapshotId
      || snapshot.saveId !== summary.saveId
      || snapshot.turnNumber !== summary.turnNumber
      || snapshotIds.has(snapshot.id)) {
      throw new Error('存档 ZIP 包含不匹配或重复的回溯快照。');
    }
    snapshotIds.add(snapshot.id);
    return snapshot;
  });

  const referencedPartitions = new Set(collectArchiveVisualPartitionIds({
    schema: 'coc.v2.saves',
    version: manifest.archiveVersion,
    exportedAt: manifest.exportedAt,
    lastSaveId: manifest.lastSaveId,
    saves,
    turnSnapshots,
  }));
  const visualIds = new Set<string>();
  const visualPaths = new Set<string>();
  const avgVisualPartitions = (manifest.avgVisualPartitions ?? []).map((summary) => {
    if (!referencedPartitions.has(summary.visualPartitionId)) throw new Error('存档 ZIP 包含未知视觉分区。');
    if (visualIds.has(summary.visualPartitionId)) throw new Error('存档 ZIP 包含重复视觉分区。');
    if (visualPaths.has(summary.path)
      || !/^avg-visuals\/\d{4}-[^/]+\.zip$/u.test(summary.path)
      || summary.path.includes('..')
      || summary.path.includes('\\')) throw new Error('存档 ZIP 包含非法或重复视觉路径。');
    const archiveBytes = entries[summary.path];
    if (!archiveBytes) throw new Error('存档 ZIP 缺少视觉分区文件。');
    if (archiveBytes.byteLength !== summary.archiveBytes) throw new Error('存档 ZIP 视觉分区字节数量不一致。');
    visualIds.add(summary.visualPartitionId);
    visualPaths.add(summary.path);
    return {
      ...summary,
      archiveBytes,
    };
  });

  const allowedPaths = new Set([
    'manifest.json',
    ...paths,
    ...Object.values(ASSET_FOLDERS).map((folder) => `${folder}/.keep`),
    ...visualPaths,
  ]);
  if (Object.keys(entries).some((path) => !allowedPaths.has(path))) {
    throw new Error('存档 ZIP 包含清单之外的额外文件。');
  }

  return {
    archive: {
      schema: 'coc.v2.saves',
      version: manifest.archiveVersion,
      exportedAt: manifest.exportedAt,
      lastSaveId: manifest.lastSaveId,
      saves,
      turnSnapshots,
    },
    visualCapability: manifest.version === PORTABLE_SAVE_ZIP_VERSION ? 'portable-v2' : 'none',
    avgVisualPartitions,
  };
}

export async function parsePortableSaveZip(data: Uint8Array): Promise<SaveArchive> {
  return (await parsePortableSaveZipBundle(data)).archive;
}

function isZipBytes(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b;
}

function readFileWithFileReader(file: File): Promise<ArrayBuffer> {
  if (typeof FileReader !== 'function') {
    return Promise.reject(new Error('当前浏览器无法读取所选存档文件。'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('所选存档文件没有返回可读取的数据。'));
    };
    reader.onerror = () => reject(new Error('所选存档文件读取失败，请确认文件已完整下载。'));
    reader.onabort = () => reject(new Error('存档文件读取已取消。'));
    reader.readAsArrayBuffer(file);
  });
}

async function readSaveArchiveBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    try {
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return new Uint8Array(await readFileWithFileReader(file));
    }
  }

  return new Uint8Array(await readFileWithFileReader(file));
}

export async function readSaveArchiveFile(file: File): Promise<unknown> {
  const bytes = await readSaveArchiveBytes(file);
  if (isZipBytes(bytes)) return parsePortableSaveZip(bytes);
  const { strFromU8 } = await loadSaveArchiveCodec();
  return JSON.parse(strFromU8(bytes));
}

export async function readPortableSaveZipBundle(file: File): Promise<PortableSaveZipBundle | null> {
  const bytes = await readSaveArchiveBytes(file);
  return isZipBytes(bytes) ? parsePortableSaveZipBundle(bytes) : null;
}

export async function readSaveArchiveBundleFile(file: File): Promise<PortableSaveZipBundle> {
  const bytes = await readSaveArchiveBytes(file);
  if (isZipBytes(bytes)) return parsePortableSaveZipBundle(bytes);
  const { strFromU8 } = await loadSaveArchiveCodec();
  return {
    archive: JSON.parse(strFromU8(bytes)) as SaveArchive,
    visualCapability: 'none',
    avgVisualPartitions: [],
  };
}
