import {
  avgPortraitProfileKey,
  isAvgPortraitMatchProfile,
  selectSimilarAvgPortraitCandidate,
  type AvgPortraitMatchProfile,
} from './AvgPortraitLibrary';

export const AVG_VISUAL_DATABASE_NAME = 'coc_v2_avg_visual_overrides';
export const AVG_VISUAL_DATABASE_VERSION = 2;
export const AVG_VISUAL_OVERRIDES_CHANGED_EVENT = 'coc-v2-avg-local-visual-overrides-changed';
export const MAX_AVG_IMAGE_BYTES = 32 * 1024 * 1024;

export type AvgImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp';
export type AvgSceneAnchorKind = 'frozen-scene-resource' | 'runtime-scene' | 'runtime-place';

interface AvgVisualOwnerBase {
  visualPartitionId: string;
  worldBookId: string;
}

export type AvgVisualTarget =
  | (AvgVisualOwnerBase & { kind: 'actor'; actorId: string })
  | (AvgVisualOwnerBase & { kind: 'scene'; anchor: { kind: AvgSceneAnchorKind; id: string } });

export interface ValidatedAvgImage {
  blob: Blob;
  mediaType: AvgImageMediaType;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
}

export interface AvgVisualAsset extends ValidatedAvgImage {
  assetId: string;
}

export interface AvgVisualOverrideRecord extends AvgVisualOwnerBase {
  key: string;
  kind: 'actor' | 'scene';
  actorId?: string;
  sceneAnchorKind?: AvgSceneAnchorKind;
  sceneAnchorId?: string;
  assetId: string;
  mediaType: AvgImageMediaType;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
  updatedAt: string;
  portraitScope?: 'actor-bound' | 'adaptive-candidate';
  sourceActorId?: string;
  portraitProfile?: AvgPortraitMatchProfile;
}

export interface AvgUserOutfit extends AvgVisualOwnerBase {
  key: string;
  actorKey: string;
  actorId: string;
  outfitId: string;
  name: string;
  normalizedName: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AvgOutfitSelection extends AvgVisualOwnerBase {
  key: string;
  actorId: string;
  outfitId: string;
  updatedAt: string;
}

export interface AvgOutfitOverride extends AvgVisualOwnerBase {
  key: string;
  actorId: string;
  outfitId: string;
  assetId: string;
  mediaType: AvgImageMediaType;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
  updatedAt: string;
}

export interface AvgVisualPartitionSnapshot {
  visualPartitionId: string;
  actorCount: number;
  sceneCount: number;
  outfitCount: number;
  outfitOverrideCount: number;
  totalBytes: number;
  missingAssetCount: number;
  records: AvgVisualOverrideRecord[];
  userOutfits: AvgUserOutfit[];
  outfitSelections: AvgOutfitSelection[];
  outfitOverrides: AvgOutfitOverride[];
  assets: AvgVisualAsset[];
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空。`);
  return normalized;
}

function joinKey(parts: string[]): string {
  return parts.map(encodeURIComponent).join('|');
}

export function createAvgActorTarget(
  visualPartitionId: string,
  worldBookId: string,
  actorId: string,
): Extract<AvgVisualTarget, { kind: 'actor' }> {
  return {
    kind: 'actor',
    visualPartitionId: required(visualPartitionId, '视觉分区'),
    worldBookId: required(worldBookId, '世界书'),
    actorId: required(actorId, '人物'),
  };
}

export function createAvgSceneTarget(
  visualPartitionId: string,
  worldBookId: string,
  anchor: { kind: AvgSceneAnchorKind; id: string },
): AvgVisualTarget {
  return {
    kind: 'scene',
    visualPartitionId: required(visualPartitionId, '视觉分区'),
    worldBookId: required(worldBookId, '世界书'),
    anchor: { ...anchor, id: required(anchor.id, '场景锚点') },
  };
}

export function avgVisualTargetKey(target: AvgVisualTarget): string {
  return target.kind === 'actor'
    ? joinKey(['actor', target.visualPartitionId, target.worldBookId, target.actorId])
    : joinKey(['scene', target.visualPartitionId, target.worldBookId, target.anchor.kind, target.anchor.id]);
}

function actorKey(owner: AvgVisualOwnerBase & { actorId: string }): string {
  return joinKey(['outfit-actor', owner.visualPartitionId, owner.worldBookId, owner.actorId]);
}

function outfitKey(owner: AvgVisualOwnerBase & { actorId: string }, outfitId: string): string {
  return joinKey(['outfit', owner.visualPartitionId, owner.worldBookId, owner.actorId, outfitId]);
}

function outfitOverrideKey(owner: AvgVisualOwnerBase & { actorId: string }, outfitId: string): string {
  return joinKey(['outfit-override', owner.visualPartitionId, owner.worldBookId, owner.actorId, outfitId]);
}

function detectMediaType(bytes: Uint8Array): AvgImageMediaType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return undefined;
}

async function decodeImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }
  throw new Error('image decoder unavailable');
}

export async function validateAvgImage(
  blob: Blob,
  options: { decodeDimensions?: (blob: Blob) => Promise<{ width: number; height: number }> } = {},
): Promise<ValidatedAvgImage> {
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error('图片文件不能为空。');
  if (blob.size > MAX_AVG_IMAGE_BYTES) throw new Error('图片文件不能超过 32 MiB。');
  const mediaType = blob.type.trim().toLowerCase() as AvgImageMediaType;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) {
    throw new Error('仅支持 PNG、JPEG 或 WebP 图片。');
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (detectMediaType(bytes) !== mediaType) throw new Error('文件内容与图片格式不一致。');
  let dimensions: { width: number; height: number };
  try {
    dimensions = await (options.decodeDimensions ?? decodeImageDimensions)(blob);
  } catch {
    throw new Error('图片无法解码，请换用有效的 PNG、JPEG 或 WebP 文件。');
  }
  const width = Math.floor(dimensions.width);
  const height = Math.floor(dimensions.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('图片尺寸无效。');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { blob, mediaType, byteSize: blob.size, width, height, sha256 };
}

function makeOverride(target: AvgVisualTarget, image: ValidatedAvgImage): AvgVisualOverrideRecord {
  return {
    key: avgVisualTargetKey(target),
    kind: target.kind,
    visualPartitionId: target.visualPartitionId,
    worldBookId: target.worldBookId,
    ...(target.kind === 'actor'
      ? { actorId: target.actorId }
      : { sceneAnchorKind: target.anchor.kind, sceneAnchorId: target.anchor.id }),
    assetId: `local-avg-sha256:${image.sha256}`,
    mediaType: image.mediaType,
    byteSize: image.byteSize,
    width: image.width,
    height: image.height,
    sha256: image.sha256,
    updatedAt: new Date().toISOString(),
  };
}

function makeAdaptivePortraitRecord(
  target: Extract<AvgVisualTarget, { kind: 'actor' }>,
  image: ValidatedAvgImage,
  portraitProfile: AvgPortraitMatchProfile,
): AvgVisualOverrideRecord {
  return {
    ...makeOverride(target, image),
    key: joinKey([
      'portrait-candidate',
      target.visualPartitionId,
      target.worldBookId,
      target.actorId,
      avgPortraitProfileKey(portraitProfile),
      image.sha256,
    ]),
    portraitScope: 'adaptive-candidate',
    sourceActorId: target.actorId,
    portraitProfile,
  };
}

function makeAsset(record: { assetId: string } & ValidatedAvgImage): AvgVisualAsset {
  return { assetId: record.assetId, blob: record.blob, mediaType: record.mediaType, byteSize: record.byteSize, width: record.width, height: record.height, sha256: record.sha256 };
}

function assetMatches(record: AvgVisualOverrideRecord | AvgOutfitOverride, asset?: AvgVisualAsset): boolean {
  return Boolean(asset
    && asset.assetId === record.assetId
    && asset.mediaType === record.mediaType
    && asset.byteSize === record.byteSize
    && asset.width === record.width
    && asset.height === record.height
    && asset.sha256 === record.sha256
    && asset.blob.size === record.byteSize
    && asset.blob.type.toLowerCase() === record.mediaType);
}

function emitChanged(partitionIds: string[]): void {
  if (typeof window === 'undefined') return;
  const ids = [...new Set(partitionIds.map((id) => id.trim()).filter(Boolean))].sort();
  if (ids.length) window.dispatchEvent(new CustomEvent(AVG_VISUAL_OVERRIDES_CHANGED_EVENT, {
    detail: { visualPartitionId: ids[0], visualPartitionIds: ids },
  }));
}

type StoreName = 'assets' | 'overrides' | 'userOutfits' | 'outfitSelections' | 'outfitOverrides';
const STORE_NAMES: StoreName[] = ['assets', 'overrides', 'userOutfits', 'outfitSelections', 'outfitOverrides'];

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('本地 AVG 视觉覆盖写入失败。'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('本地 AVG 视觉覆盖事务已取消。'));
    transaction.onerror = () => reject(transaction.error ?? new Error('本地 AVG 视觉覆盖事务失败。'));
  });
}

function openDatabase(name = AVG_VISUAL_DATABASE_NAME): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('当前浏览器不支持本地 AVG 视觉覆盖。'));
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, AVG_VISUAL_DATABASE_VERSION);
    opening.onupgradeneeded = () => {
      const database = opening.result;
      if (!database.objectStoreNames.contains('assets')) database.createObjectStore('assets', { keyPath: 'assetId' });
      if (!database.objectStoreNames.contains('overrides')) {
        const store = database.createObjectStore('overrides', { keyPath: 'key' });
        store.createIndex('visualPartitionId', 'visualPartitionId', { unique: false });
        store.createIndex('assetId', 'assetId', { unique: false });
      }
      if (!database.objectStoreNames.contains('userOutfits')) {
        const store = database.createObjectStore('userOutfits', { keyPath: 'key' });
        store.createIndex('visualPartitionId', 'visualPartitionId', { unique: false });
        store.createIndex('actorKey', 'actorKey', { unique: false });
      }
      if (!database.objectStoreNames.contains('outfitSelections')) {
        database.createObjectStore('outfitSelections', { keyPath: 'key' })
          .createIndex('visualPartitionId', 'visualPartitionId', { unique: false });
      }
      if (!database.objectStoreNames.contains('outfitOverrides')) {
        const store = database.createObjectStore('outfitOverrides', { keyPath: 'key' });
        store.createIndex('visualPartitionId', 'visualPartitionId', { unique: false });
        store.createIndex('assetId', 'assetId', { unique: false });
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error('无法打开本地 AVG 视觉覆盖数据库。'));
    opening.onblocked = () => reject(new Error('本地 AVG 视觉覆盖数据库正被占用。'));
  });
}

export async function resetAvgVisualDatabaseForTests(name = AVG_VISUAL_DATABASE_NAME): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const deletion = indexedDB.deleteDatabase(name);
    deletion.onsuccess = () => resolve();
    deletion.onerror = () => reject(deletion.error ?? new Error('本地 AVG 视觉覆盖数据库重置失败。'));
    deletion.onblocked = () => reject(new Error('本地 AVG 视觉覆盖数据库重置被阻塞。'));
  });
}

export class IndexedDbAvgVisualOverrideRepository {
  constructor(private readonly databaseName = AVG_VISUAL_DATABASE_NAME) {}

  private async run<T>(stores: StoreName[], mode: IDBTransactionMode, operation: (transaction: IDBTransaction) => Promise<T>): Promise<T> {
    const database = await openDatabase(this.databaseName);
    const transaction = database.transaction(stores, mode);
    const done = transactionDone(transaction);
    try {
      const result = await operation(transaction);
      await done;
      return result;
    } catch (error) {
      try { transaction.abort(); } catch { /* already settled */ }
      await done.catch(() => undefined);
      throw error;
    } finally {
      database.close();
    }
  }

  async lookup(target: AvgVisualTarget, options: { actorProfile?: AvgPortraitMatchProfile; rememberMatch?: boolean } = {}): Promise<
    | { status: 'missing' }
    | { status: 'asset-missing'; record: AvgVisualOverrideRecord }
    | { status: 'found'; record: AvgVisualOverrideRecord; blob: Blob }
  > {
    return this.run(['overrides', 'assets', 'outfitSelections', 'outfitOverrides'], options.rememberMatch ? 'readwrite' : 'readonly', async (transaction) => {
      if (target.kind === 'actor') {
        const selection = await request<AvgOutfitSelection | undefined>(
          transaction.objectStore('outfitSelections').get(actorKey(target)),
        );
        if (selection) {
          const outfitOverride = await request<AvgOutfitOverride | undefined>(
            transaction.objectStore('outfitOverrides').get(outfitOverrideKey(target, selection.outfitId)),
          );
          if (outfitOverride) {
            const asset = await request<AvgVisualAsset | undefined>(transaction.objectStore('assets').get(outfitOverride.assetId));
            if (assetMatches(outfitOverride, asset)) {
              return {
                status: 'found',
                record: {
                  ...outfitOverride,
                  kind: 'actor',
                  key: avgVisualTargetKey(target),
                },
                blob: asset!.blob,
              };
            }
          }
        }
      }
      const overrides = transaction.objectStore('overrides');
      const record = await request<AvgVisualOverrideRecord | undefined>(overrides.get(avgVisualTargetKey(target)));
      if (record) {
        const asset = await request<AvgVisualAsset | undefined>(transaction.objectStore('assets').get(record.assetId));
        return assetMatches(record, asset)
          ? { status: 'found', record, blob: asset!.blob }
          : { status: 'asset-missing', record };
      }
      if (target.kind === 'actor' && options.actorProfile) {
        const rows = await request<AvgVisualOverrideRecord[]>(overrides.index('visualPartitionId').getAll(target.visualPartitionId));
        const candidates = rows.filter((row) => row.worldBookId === target.worldBookId && row.portraitScope === 'adaptive-candidate');
        while (candidates.length) {
          const candidate = selectSimilarAvgPortraitCandidate(options.actorProfile, target.actorId, candidates);
          if (!candidate) break;
          const asset = await request<AvgVisualAsset | undefined>(transaction.objectStore('assets').get(candidate.assetId));
          if (assetMatches(candidate, asset)) {
            const matched: AvgVisualOverrideRecord = {
              ...candidate, key: avgVisualTargetKey(target), actorId: target.actorId,
              portraitScope: 'actor-bound', updatedAt: new Date().toISOString(),
            };
            if (options.rememberMatch) await request(overrides.put(matched));
            return { status: 'found', record: matched, blob: asset!.blob };
          }
          candidates.splice(candidates.indexOf(candidate), 1);
        }
      }
      return { status: 'missing' };
    });
  }

  async replace(target: AvgVisualTarget, image: ValidatedAvgImage): Promise<AvgVisualOverrideRecord> {
    const record = makeOverride(target, image);
    await this.run(STORE_NAMES, 'readwrite', async (transaction) => {
      const overrideStore = transaction.objectStore('overrides');
      const previous = await request<AvgVisualOverrideRecord | undefined>(overrideStore.get(record.key));
      await request(transaction.objectStore('assets').put(makeAsset({ ...image, assetId: record.assetId })));
      await request(overrideStore.put(record));
      if (previous?.assetId && previous.assetId !== record.assetId) await this.deleteAssetIfOrphaned(transaction, previous.assetId);
    });
    emitChanged([record.visualPartitionId]);
    return { ...record };
  }

  async saveGeneratedActorPortrait(
    target: Extract<AvgVisualTarget, { kind: 'actor' }>,
    image: ValidatedAvgImage,
    options: { portraitProfile?: AvgPortraitMatchProfile; registerAdaptiveCandidate: boolean },
  ): Promise<{ bound: AvgVisualOverrideRecord; adaptiveCandidate?: AvgVisualOverrideRecord }> {
    if (options.portraitProfile && !isAvgPortraitMatchProfile(options.portraitProfile)) throw new Error('人物画像格式不正确。');
    const bound: AvgVisualOverrideRecord = {
      ...makeOverride(target, image),
      portraitScope: 'actor-bound',
      sourceActorId: target.actorId,
      ...(options.portraitProfile ? { portraitProfile: options.portraitProfile } : {}),
    };
    const adaptiveCandidate = options.registerAdaptiveCandidate && options.portraitProfile
      ? makeAdaptivePortraitRecord(target, image, options.portraitProfile)
      : undefined;
    await this.run(STORE_NAMES, 'readwrite', async (transaction) => {
      const overrideStore = transaction.objectStore('overrides');
      const rows = await request<AvgVisualOverrideRecord[]>(overrideStore.index('visualPartitionId').getAll(target.visualPartitionId));
      const previousBound = await request<AvgVisualOverrideRecord | undefined>(overrideStore.get(bound.key));
      const previousCandidates = rows.filter((row) => (
        row.worldBookId === target.worldBookId
        && row.portraitScope === 'adaptive-candidate'
        && row.sourceActorId === target.actorId
      ));
      const staleAssetIds = new Set([
        previousBound?.assetId,
        ...previousCandidates.map((row) => row.assetId),
      ].filter((assetId): assetId is string => Boolean(assetId) && assetId !== bound.assetId));

      await request(transaction.objectStore('assets').put(makeAsset({ ...image, assetId: bound.assetId })));
      await request(overrideStore.put(bound));
      await request(transaction.objectStore('outfitSelections').delete(actorKey(target)));
      for (const candidate of previousCandidates) {
        if (candidate.key !== adaptiveCandidate?.key) await request(overrideStore.delete(candidate.key));
      }
      if (adaptiveCandidate) await request(overrideStore.put(adaptiveCandidate));
      for (const assetId of staleAssetIds) await this.deleteAssetIfOrphaned(transaction, assetId);
    });
    emitChanged([target.visualPartitionId]);
    return { bound: { ...bound }, ...(adaptiveCandidate ? { adaptiveCandidate: { ...adaptiveCandidate } } : {}) };
  }

  async remove(target: AvgVisualTarget): Promise<boolean> {
    let removed = false;
    await this.run(STORE_NAMES, 'readwrite', async (transaction) => {
      const store = transaction.objectStore('overrides');
      const record = await request<AvgVisualOverrideRecord | undefined>(store.get(avgVisualTargetKey(target)));
      const adaptiveRows = target.kind === 'actor'
        ? (await request<AvgVisualOverrideRecord[]>(store.index('visualPartitionId').getAll(target.visualPartitionId)))
          .filter((row) => row.worldBookId === target.worldBookId
            && row.portraitScope === 'adaptive-candidate'
            && row.sourceActorId === target.actorId)
        : [];
      if (!record && adaptiveRows.length === 0) return;
      if (record) await request(store.delete(record.key));
      for (const row of adaptiveRows) await request(store.delete(row.key));
      for (const assetId of new Set([record?.assetId, ...adaptiveRows.map((row) => row.assetId)])) {
        await this.deleteAssetIfOrphaned(transaction, assetId);
      }
      removed = true;
    });
    if (removed) emitChanged([target.visualPartitionId]);
    return removed;
  }

  async listUserOutfits(owner: AvgVisualOwnerBase & { actorId: string }): Promise<AvgUserOutfit[]> {
    return this.run(['userOutfits'], 'readonly', async (transaction) => {
      const rows = await request<AvgUserOutfit[]>(transaction.objectStore('userOutfits').index('actorKey').getAll(actorKey(owner)));
      return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name, 'zh-CN'));
    });
  }

  async createUserOutfit(owner: AvgVisualOwnerBase & { actorId: string }, input: { name: string; note?: string }): Promise<AvgUserOutfit> {
    const name = required(input.name, '造型名称');
    if ([...name].length > 40) throw new Error('造型名称不能超过 40 个字符。');
    const note = input.note?.trim();
    if (note && [...note].length > 240) throw new Error('造型备注不能超过 240 个字符。');
    const existing = await this.listUserOutfits(owner);
    const normalizedName = name.normalize('NFKC').toLocaleLowerCase();
    if (existing.some((outfit) => outfit.normalizedName === normalizedName)) throw new Error('同一人物不能创建重名造型。');
    const now = new Date().toISOString();
    const outfitId = `local-outfit:${crypto.randomUUID()}`;
    const row: AvgUserOutfit = {
      ...owner,
      key: outfitKey(owner, outfitId),
      actorKey: actorKey(owner),
      outfitId,
      name,
      normalizedName,
      ...(note ? { note } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await this.run(['userOutfits'], 'readwrite', async (transaction) => { await request(transaction.objectStore('userOutfits').put(row)); });
    emitChanged([owner.visualPartitionId]);
    return row;
  }

  async selectUserOutfit(owner: AvgVisualOwnerBase & { actorId: string }, outfitId: string): Promise<void> {
    const key = outfitKey(owner, required(outfitId, '造型'));
    await this.run(['userOutfits', 'outfitSelections'], 'readwrite', async (transaction) => {
      if (!await request(transaction.objectStore('userOutfits').get(key))) throw new Error('人物造型不存在。');
      const row: AvgOutfitSelection = { ...owner, actorId: owner.actorId, key: actorKey(owner), outfitId, updatedAt: new Date().toISOString() };
      await request(transaction.objectStore('outfitSelections').put(row));
    });
    emitChanged([owner.visualPartitionId]);
  }

  async getSelectedUserOutfit(owner: AvgVisualOwnerBase & { actorId: string }): Promise<AvgUserOutfit | undefined> {
    return this.run(['userOutfits', 'outfitSelections'], 'readonly', async (transaction) => {
      const selection = await request<AvgOutfitSelection | undefined>(transaction.objectStore('outfitSelections').get(actorKey(owner)));
      return selection
        ? request<AvgUserOutfit | undefined>(transaction.objectStore('userOutfits').get(outfitKey(owner, selection.outfitId)))
        : undefined;
    });
  }

  async clearUserOutfitSelection(owner: AvgVisualOwnerBase & { actorId: string }): Promise<void> {
    await this.run(['outfitSelections'], 'readwrite', async (transaction) => {
      await request(transaction.objectStore('outfitSelections').delete(actorKey(owner)));
    });
    emitChanged([owner.visualPartitionId]);
  }

  async deleteUserOutfit(owner: AvgVisualOwnerBase & { actorId: string }, outfitId: string): Promise<boolean> {
    const key = outfitKey(owner, required(outfitId, '造型'));
    let removed = false;
    await this.run(STORE_NAMES, 'readwrite', async (transaction) => {
      const outfits = transaction.objectStore('userOutfits');
      const existing = await request<AvgUserOutfit | undefined>(outfits.get(key));
      if (!existing) return;
      const selectionStore = transaction.objectStore('outfitSelections');
      const selection = await request<AvgOutfitSelection | undefined>(selectionStore.get(actorKey(owner)));
      if (selection?.outfitId === outfitId) await request(selectionStore.delete(actorKey(owner)));
      const overrideStore = transaction.objectStore('outfitOverrides');
      const override = await request<AvgOutfitOverride | undefined>(overrideStore.get(outfitOverrideKey(owner, outfitId)));
      if (override) await request(overrideStore.delete(override.key));
      await request(outfits.delete(key));
      if (override?.assetId) await this.deleteAssetIfOrphaned(transaction, override.assetId);
      removed = true;
    });
    if (removed) emitChanged([owner.visualPartitionId]);
    return removed;
  }

  async replaceOutfitImage(owner: AvgVisualOwnerBase & { actorId: string }, outfitId: string, image: ValidatedAvgImage): Promise<AvgOutfitOverride> {
    const key = outfitKey(owner, required(outfitId, '造型'));
    const assetId = `local-avg-sha256:${image.sha256}`;
    const row: AvgOutfitOverride = {
      ...owner,
      actorId: owner.actorId,
      outfitId,
      key: outfitOverrideKey(owner, outfitId),
      assetId,
      mediaType: image.mediaType,
      byteSize: image.byteSize,
      width: image.width,
      height: image.height,
      sha256: image.sha256,
      updatedAt: new Date().toISOString(),
    };
    await this.run(STORE_NAMES, 'readwrite', async (transaction) => {
      if (!await request(transaction.objectStore('userOutfits').get(key))) throw new Error('人物造型不存在。');
      const old = await request<AvgOutfitOverride | undefined>(transaction.objectStore('outfitOverrides').get(row.key));
      await request(transaction.objectStore('assets').put(makeAsset({ ...image, assetId })));
      await request(transaction.objectStore('outfitOverrides').put(row));
      if (old?.assetId && old.assetId !== assetId) await this.deleteAssetIfOrphaned(transaction, old.assetId);
    });
    emitChanged([owner.visualPartitionId]);
    return row;
  }

  async removeOutfitImage(owner: AvgVisualOwnerBase & { actorId: string }, outfitId: string): Promise<boolean> {
    const key = outfitOverrideKey(owner, required(outfitId, '造型'));
    let removed = false;
    await this.run(STORE_NAMES, 'readwrite', async (transaction) => {
      const store = transaction.objectStore('outfitOverrides');
      const existing = await request<AvgOutfitOverride | undefined>(store.get(key));
      if (!existing) return;
      await request(store.delete(key));
      await this.deleteAssetIfOrphaned(transaction, existing.assetId);
      removed = true;
    });
    if (removed) emitChanged([owner.visualPartitionId]);
    return removed;
  }

  async exportPartition(visualPartitionId: string): Promise<AvgVisualPartitionSnapshot> {
    const partitionId = required(visualPartitionId, '视觉分区');
    return this.run(STORE_NAMES, 'readonly', async (transaction) => {
      const records = await request<AvgVisualOverrideRecord[]>(transaction.objectStore('overrides').index('visualPartitionId').getAll(partitionId));
      const userOutfits = await request<AvgUserOutfit[]>(transaction.objectStore('userOutfits').index('visualPartitionId').getAll(partitionId));
      const outfitSelections = await request<AvgOutfitSelection[]>(transaction.objectStore('outfitSelections').index('visualPartitionId').getAll(partitionId));
      const outfitOverrides = await request<AvgOutfitOverride[]>(transaction.objectStore('outfitOverrides').index('visualPartitionId').getAll(partitionId));
      const assetIds = [...new Set([...records, ...outfitOverrides].map((row) => row.assetId))];
      const assets = (await Promise.all(assetIds.map((id) => request<AvgVisualAsset | undefined>(transaction.objectStore('assets').get(id)))))
        .filter((asset): asset is AvgVisualAsset => Boolean(asset));
      return {
        visualPartitionId: partitionId,
        actorCount: records.filter((row) => row.kind === 'actor' && row.portraitScope !== 'adaptive-candidate').length,
        sceneCount: records.filter((row) => row.kind === 'scene').length,
        outfitCount: userOutfits.length,
        outfitOverrideCount: outfitOverrides.length,
        totalBytes: assets.reduce((total, asset) => total + asset.byteSize, 0),
        missingAssetCount: assetIds.length - assets.length,
        records,
        userOutfits,
        outfitSelections,
        outfitOverrides,
        assets,
      };
    });
  }

  async replacePartitions(snapshots: AvgVisualPartitionSnapshot[]): Promise<void> {
    const partitionIds = new Set(snapshots.map((snapshot) => required(snapshot.visualPartitionId, '视觉分区')));
    if (partitionIds.size !== snapshots.length) throw new Error('视觉分区包含重复记录。');
    snapshots.forEach(assertValidPartitionSnapshot);
    await this.run(STORE_NAMES, 'readwrite', async (transaction) => {
      for (const storeName of STORE_NAMES.filter((name) => name !== 'assets')) {
        const store = transaction.objectStore(storeName);
        const rows = await request<Array<{ key: string; visualPartitionId: string }>>(store.getAll());
        for (const row of rows) if (partitionIds.has(row.visualPartitionId)) await request(store.delete(row.key));
      }
      for (const snapshot of snapshots) {
        for (const asset of snapshot.assets) await request(transaction.objectStore('assets').put(asset));
        for (const row of snapshot.records) await request(transaction.objectStore('overrides').put(row));
        for (const row of snapshot.userOutfits) await request(transaction.objectStore('userOutfits').put(row));
        for (const row of snapshot.outfitSelections) await request(transaction.objectStore('outfitSelections').put(row));
        for (const row of snapshot.outfitOverrides) await request(transaction.objectStore('outfitOverrides').put(row));
      }
      const assets = await request<AvgVisualAsset[]>(transaction.objectStore('assets').getAll());
      for (const asset of assets) await this.deleteAssetIfOrphaned(transaction, asset.assetId);
    });
    emitChanged([...partitionIds]);
  }

  async deletePartitions(partitionIds: readonly string[]): Promise<void> {
    const ids = new Set(partitionIds.map((id) => required(id, '视觉分区')));
    await this.run(STORE_NAMES, 'readwrite', async (transaction) => {
      for (const storeName of STORE_NAMES.filter((name) => name !== 'assets')) {
        const store = transaction.objectStore(storeName);
        const rows = await request<Array<{ key: string; visualPartitionId: string }>>(store.getAll());
        for (const row of rows) if (ids.has(row.visualPartitionId)) await request(store.delete(row.key));
      }
      const assets = await request<AvgVisualAsset[]>(transaction.objectStore('assets').getAll());
      for (const asset of assets) await this.deleteAssetIfOrphaned(transaction, asset.assetId);
    });
    emitChanged([...ids]);
  }

  async clear(): Promise<void> {
    await this.run(STORE_NAMES, 'readwrite', async (transaction) => {
      for (const name of STORE_NAMES) await request(transaction.objectStore(name).clear());
    });
  }

  private async deleteAssetIfOrphaned(transaction: IDBTransaction, assetId?: string): Promise<void> {
    if (!assetId) return;
    const overrideReferences = await request<IDBValidKey[]>(transaction.objectStore('overrides').index('assetId').getAllKeys(assetId));
    const outfitReferences = await request<IDBValidKey[]>(transaction.objectStore('outfitOverrides').index('assetId').getAllKeys(assetId));
    if (overrideReferences.length === 0 && outfitReferences.length === 0) await request(transaction.objectStore('assets').delete(assetId));
  }
}

export function assertValidPartitionSnapshot(snapshot: AvgVisualPartitionSnapshot): void {
  const partitionId = required(snapshot.visualPartitionId, '视觉分区');
  const assets = new Map(snapshot.assets.map((asset) => [asset.assetId, asset]));
  if (assets.size !== snapshot.assets.length) throw new Error('视觉分区包含重复图片记录。');
  const allImageRows = [...snapshot.records, ...snapshot.outfitOverrides];
  for (const row of allImageRows) {
    if (row.visualPartitionId !== partitionId) throw new Error('视觉覆盖记录归属不一致。');
    if (!assetMatches(row, assets.get(row.assetId))) throw new Error('视觉分区图片引用元数据不一致。');
  }
  for (const row of snapshot.records) {
    if (row.kind === 'actor') {
      if (!row.actorId) throw new Error('人物视觉覆盖缺少人物标识。');
      if (row.portraitScope === 'adaptive-candidate') {
        if (!row.sourceActorId || row.sourceActorId !== row.actorId || !isAvgPortraitMatchProfile(row.portraitProfile)) {
          throw new Error('相似人物候选图缺少有效结构化画像。');
        }
        const expected = makeAdaptivePortraitRecord({ kind: 'actor', visualPartitionId: row.visualPartitionId, worldBookId: row.worldBookId, actorId: row.actorId }, {
          blob: assets.get(row.assetId)!.blob,
          mediaType: row.mediaType,
          byteSize: row.byteSize,
          width: row.width,
          height: row.height,
          sha256: row.sha256,
        }, row.portraitProfile);
        if (row.key !== expected.key) throw new Error('相似人物候选图内部 key 不正确。');
      } else if (row.key !== avgVisualTargetKey(createAvgActorTarget(row.visualPartitionId, row.worldBookId, row.actorId))) {
        throw new Error('人物视觉覆盖内部 key 不正确。');
      }
    } else if (!row.sceneAnchorKind || !row.sceneAnchorId || row.key !== avgVisualTargetKey(createAvgSceneTarget(
      row.visualPartitionId,
      row.worldBookId,
      { kind: row.sceneAnchorKind, id: row.sceneAnchorId },
    ))) {
      throw new Error('场景视觉覆盖内部 key 不正确。');
    }
  }
  const referenced = new Set(allImageRows.map((row) => row.assetId));
  if (referenced.size !== assets.size || [...referenced].some((id) => !assets.has(id))) {
    throw new Error('视觉分区图片引用闭包不完整。');
  }
  for (const outfit of snapshot.userOutfits) {
    if (outfit.visualPartitionId !== partitionId || outfit.key !== outfitKey(outfit, outfit.outfitId) || outfit.actorKey !== actorKey(outfit)) {
      throw new Error('人物造型内部 key 不正确。');
    }
  }
  const outfits = new Set(snapshot.userOutfits.map((outfit) => outfit.key));
  for (const selection of snapshot.outfitSelections) {
    if (selection.visualPartitionId !== partitionId || selection.key !== actorKey(selection) || !outfits.has(outfitKey(selection, selection.outfitId))) {
      throw new Error('造型选择引用了不存在的造型。');
    }
  }
  for (const override of snapshot.outfitOverrides) {
    if (override.key !== outfitOverrideKey(override, override.outfitId) || !outfits.has(outfitKey(override, override.outfitId))) {
      throw new Error('造型专属图引用了不存在的造型。');
    }
  }
}
