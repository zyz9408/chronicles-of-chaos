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
export const PORTABLE_SAVE_ZIP_VERSION = 1;

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

interface PortableSaveZipManifest {
  format: typeof PORTABLE_SAVE_ZIP_FORMAT;
  version: typeof PORTABLE_SAVE_ZIP_VERSION;
  schema: SaveArchive['schema'];
  archiveVersion: SaveArchive['version'];
  exportedAt: string;
  lastSaveId: string | null;
  saveCount: number;
  snapshotCount: number;
  saves: PortableSaveManifestEntry[];
  turnSnapshots: PortableSnapshotManifestEntry[];
  assetFolders: typeof ASSET_FOLDERS;
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
  const { zip } = await loadSaveArchiveCodec();
  return new Promise((resolve, reject) => {
    zip(entries, { level: 6 }, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

async function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  const { unzip } = await loadSaveArchiveCodec();
  return new Promise((resolve, reject) => {
    unzip(data, (error, entries) => {
      if (error) reject(error);
      else resolve(entries);
    });
  });
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

function parseManifest(value: unknown): PortableSaveZipManifest {
  if (!isRecord(value)
    || value.format !== PORTABLE_SAVE_ZIP_FORMAT
    || value.version !== PORTABLE_SAVE_ZIP_VERSION
    || value.schema !== 'coc.v2.saves'
    || (value.archiveVersion !== 1 && value.archiveVersion !== 2)
    || typeof value.exportedAt !== 'string'
    || (value.lastSaveId !== null && typeof value.lastSaveId !== 'string')
    || !Number.isInteger(value.saveCount)
    || !Number.isInteger(value.snapshotCount)
    || !Array.isArray(value.saves)
    || !value.saves.every(isManifestEntry)
    || !Array.isArray(value.turnSnapshots)
    || !value.turnSnapshots.every(isSnapshotManifestEntry)) {
    throw new Error('存档 ZIP 清单格式不正确。');
  }
  return value as unknown as PortableSaveZipManifest;
}

export async function createPortableSaveZip(archive: SaveArchive): Promise<Uint8Array> {
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
  };
  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  Object.values(ASSET_FOLDERS).forEach((folder) => {
    entries[`${folder}/.keep`] = new Uint8Array();
  });

  return zipAsync(entries);
}

export async function parsePortableSaveZip(data: Uint8Array): Promise<SaveArchive> {
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

  return {
    schema: 'coc.v2.saves',
    version: manifest.archiveVersion,
    exportedAt: manifest.exportedAt,
    lastSaveId: manifest.lastSaveId,
    saves,
    turnSnapshots,
  };
}

function isZipBytes(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b;
}

export async function readSaveArchiveFile(file: File): Promise<unknown> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isZipBytes(bytes)) return parsePortableSaveZip(bytes);
  const { strFromU8 } = await loadSaveArchiveCodec();
  return JSON.parse(strFromU8(bytes));
}
