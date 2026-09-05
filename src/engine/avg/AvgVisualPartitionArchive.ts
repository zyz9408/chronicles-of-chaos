import type {
  AvgImageMediaType,
  AvgVisualAsset,
  AvgVisualPartitionSnapshot,
} from './AvgVisualOverrideRepository';
import {
  assertValidPartitionSnapshot,
  validateAvgImage,
} from './AvgVisualOverrideRepository';

type ArchiveCodec = typeof import('fflate');

export const AVG_VISUAL_PARTITION_FORMAT = 'chronicles-of-chaos-v2-avg-visual-partition';
export const AVG_VISUAL_PARTITION_VERSION = 1;
export const MAX_AVG_VISUAL_PARTITION_BYTES = 384 * 1024 * 1024;
export const MAX_AVG_VISUAL_ARCHIVE_BYTES = 384 * 1024 * 1024;
export const MAX_AVG_VISUAL_ARCHIVE_ENTRIES = 1024;

export interface AvgVisualPartitionArchiveSummary {
  visualPartitionId: string;
  actorCount: number;
  sceneCount: number;
  outfitCount: number;
  outfitOverrideCount: number;
  assetCount: number;
  imageBytes: number;
}

export interface ExportedAvgVisualPartition {
  archiveBytes: Uint8Array;
  summary: AvgVisualPartitionArchiveSummary;
}

function extension(mediaType: AvgImageMediaType): 'png' | 'jpg' | 'webp' {
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/jpeg') return 'jpg';
  return 'webp';
}

function isSafeArchivePath(path: string): boolean {
  return path.length > 0
    && !path.startsWith('/')
    && !path.includes('\\')
    && !path.includes('\0')
    && !/(?:^|\/)\.\.?($|\/)/u.test(path)
    && !/^[a-zA-Z]:/u.test(path);
}

function summaryOf(snapshot: AvgVisualPartitionSnapshot): AvgVisualPartitionArchiveSummary {
  return {
    visualPartitionId: snapshot.visualPartitionId,
    actorCount: snapshot.records.filter((record) => record.kind === 'actor' && record.portraitScope !== 'adaptive-candidate').length,
    sceneCount: snapshot.records.filter((record) => record.kind === 'scene').length,
    outfitCount: snapshot.userOutfits.length,
    outfitOverrideCount: snapshot.outfitOverrides.length,
    assetCount: snapshot.assets.length,
    imageBytes: snapshot.assets.reduce((total, asset) => total + asset.byteSize, 0),
  };
}

export async function createAvgVisualPartitionArchive(
  snapshot: AvgVisualPartitionSnapshot,
): Promise<ExportedAvgVisualPartition | null> {
  assertValidPartitionSnapshot(snapshot);
  if (snapshot.records.length === 0
    && snapshot.userOutfits.length === 0
    && snapshot.outfitSelections.length === 0
    && snapshot.outfitOverrides.length === 0) return null;
  if (snapshot.assets.length > MAX_AVG_VISUAL_ARCHIVE_ENTRIES - 2) throw new Error('视觉分区图片数量超过上限。');
  const { strToU8, zipSync } = await import('fflate');
  const entries: Record<string, Uint8Array> = {};
  const assets = [...snapshot.assets].sort((a, b) => a.assetId.localeCompare(b.assetId));
  const assetManifest = assets.map((asset, index) => {
    const path = `blobs/${String(index + 1).padStart(4, '0')}.${extension(asset.mediaType)}`;
    return {
      assetId: asset.assetId,
      path,
      mediaType: asset.mediaType,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      sha256: asset.sha256,
    };
  });
  for (let index = 0; index < assets.length; index += 1) {
    entries[assetManifest[index].path] = new Uint8Array(await assets[index].blob.arrayBuffer());
  }
  entries['snapshot.json'] = strToU8(JSON.stringify({
    schemaVersion: 1,
    visualPartitionId: snapshot.visualPartitionId,
    records: snapshot.records,
    userOutfits: snapshot.userOutfits,
    outfitSelections: snapshot.outfitSelections,
    outfitOverrides: snapshot.outfitOverrides,
  }, null, 2));
  const summary = summaryOf(snapshot);
  entries['manifest.json'] = strToU8(JSON.stringify({
    format: AVG_VISUAL_PARTITION_FORMAT,
    version: AVG_VISUAL_PARTITION_VERSION,
    snapshotPath: 'snapshot.json',
    recordCount: snapshot.records.length,
    selectionCount: snapshot.outfitSelections.length,
    assets: assetManifest,
    ...summary,
  }, null, 2));
  const archiveBytes = zipSync(entries, { level: 6 });
  if (archiveBytes.byteLength > MAX_AVG_VISUAL_ARCHIVE_BYTES) throw new Error('视觉分区归档超过 384 MiB。');
  return { archiveBytes, summary };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(bytes: Uint8Array | undefined, label: string, strFromU8: ArchiveCodec['strFromU8']): Record<string, unknown> {
  if (!bytes) throw new Error(`${label}缺失。`);
  try {
    const parsed = JSON.parse(strFromU8(bytes));
    if (!record(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label}不是有效 JSON。`);
  }
}

function assertCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label}格式不正确。`);
  return Number(value);
}

export async function parseAvgVisualPartitionArchive(
  archiveBytes: Uint8Array,
  options: {
    expectedVisualPartitionId?: string;
    expectedSummary?: AvgVisualPartitionArchiveSummary;
    decodeDimensions?: (blob: Blob) => Promise<{ width: number; height: number }>;
  } = {},
): Promise<AvgVisualPartitionSnapshot> {
  if (!(archiveBytes instanceof Uint8Array) || archiveBytes.byteLength === 0) throw new Error('视觉分区归档不能为空。');
  if (archiveBytes.byteLength > MAX_AVG_VISUAL_ARCHIVE_BYTES) throw new Error('视觉分区归档超过 384 MiB。');
  const { strFromU8, unzipSync } = await import('fflate');
  const entries = unzipSync(archiveBytes, {
    filter: ({ name, originalSize }) => {
      if (!isSafeArchivePath(name)) throw new Error('视觉分区包含非法文件路径。');
      if (originalSize > MAX_AVG_VISUAL_PARTITION_BYTES) throw new Error('视觉分区文件解压后过大。');
      return true;
    },
  });
  if (Object.keys(entries).length > MAX_AVG_VISUAL_ARCHIVE_ENTRIES) throw new Error('视觉分区文件数量超过上限。');
  const manifest = parseJson(entries['manifest.json'], '视觉分区清单', strFromU8);
  if (manifest.format !== AVG_VISUAL_PARTITION_FORMAT
    || manifest.version !== AVG_VISUAL_PARTITION_VERSION
    || manifest.snapshotPath !== 'snapshot.json'
    || typeof manifest.visualPartitionId !== 'string'
    || !Array.isArray(manifest.assets)) throw new Error('视觉分区清单格式不正确。');
  const visualPartitionId = manifest.visualPartitionId.trim();
  if (!visualPartitionId || (options.expectedVisualPartitionId && visualPartitionId !== options.expectedVisualPartitionId)) {
    throw new Error('视觉分区归档与外层清单不匹配。');
  }
  const snapshotJson = parseJson(entries['snapshot.json'], '视觉分区快照', strFromU8);
  if (snapshotJson.schemaVersion !== 1
    || snapshotJson.visualPartitionId !== visualPartitionId
    || !Array.isArray(snapshotJson.records)
    || !Array.isArray(snapshotJson.userOutfits)
    || !Array.isArray(snapshotJson.outfitSelections)
    || !Array.isArray(snapshotJson.outfitOverrides)) throw new Error('视觉分区快照格式不正确。');

  const allowedPaths = new Set(['manifest.json', 'snapshot.json']);
  const assetIds = new Set<string>();
  const assetPaths = new Set<string>();
  const assets: AvgVisualAsset[] = [];
  for (const raw of manifest.assets) {
    if (!record(raw)
      || typeof raw.assetId !== 'string'
      || typeof raw.path !== 'string'
      || !['image/png', 'image/jpeg', 'image/webp'].includes(String(raw.mediaType))
      || typeof raw.sha256 !== 'string') throw new Error('视觉分区清单格式不正确。');
    const mediaType = raw.mediaType as AvgImageMediaType;
    if (assetIds.has(raw.assetId) || assetPaths.has(raw.path)
      || !/^blobs\/\d{4}\.(?:png|jpg|webp)$/u.test(raw.path)
      || raw.path.split('.').pop() !== extension(mediaType)) throw new Error('视觉分区包含非法或重复图片路径。');
    assetIds.add(raw.assetId);
    assetPaths.add(raw.path);
    allowedPaths.add(raw.path);
    const bytes = entries[raw.path];
    if (!bytes) throw new Error('视觉分区存在缺失图片。');
    const validated = await validateAvgImage(new Blob([bytes], { type: mediaType }), { decodeDimensions: options.decodeDimensions });
    if (raw.assetId !== `local-avg-sha256:${validated.sha256}`
      || raw.sha256 !== validated.sha256
      || assertCount(raw.byteSize, '图片字节') !== validated.byteSize
      || assertCount(raw.width, '图片宽度') !== validated.width
      || assertCount(raw.height, '图片高度') !== validated.height) throw new Error('视觉分区图片校验失败。');
    assets.push({ assetId: raw.assetId, ...validated });
  }
  if (Object.keys(entries).some((path) => !allowedPaths.has(path))) throw new Error('视觉分区包含清单之外的额外文件。');
  const snapshot: AvgVisualPartitionSnapshot = {
    visualPartitionId,
    records: snapshotJson.records as AvgVisualPartitionSnapshot['records'],
    userOutfits: snapshotJson.userOutfits as AvgVisualPartitionSnapshot['userOutfits'],
    outfitSelections: snapshotJson.outfitSelections as AvgVisualPartitionSnapshot['outfitSelections'],
    outfitOverrides: snapshotJson.outfitOverrides as AvgVisualPartitionSnapshot['outfitOverrides'],
    assets,
    actorCount: 0,
    sceneCount: 0,
    outfitCount: 0,
    outfitOverrideCount: 0,
    totalBytes: 0,
    missingAssetCount: 0,
  };
  assertValidPartitionSnapshot(snapshot);
  const summary = summaryOf(snapshot);
  Object.assign(snapshot, {
    actorCount: summary.actorCount,
    sceneCount: summary.sceneCount,
    outfitCount: summary.outfitCount,
    outfitOverrideCount: summary.outfitOverrideCount,
    totalBytes: summary.imageBytes,
  });
  const expected = options.expectedSummary;
  for (const [key, value] of Object.entries(summary)) {
    if (manifest[key] !== value || (expected && expected[key as keyof AvgVisualPartitionArchiveSummary] !== value)) {
      throw new Error('视觉分区清单数量或字节不一致。');
    }
  }
  if (assertCount(manifest.recordCount, '覆盖数量') !== snapshot.records.length
    || assertCount(manifest.selectionCount, '选择数量') !== snapshot.outfitSelections.length) {
    throw new Error('视觉分区清单数量或字节不一致。');
  }
  return snapshot;
}
