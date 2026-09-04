export const AVG_IMAGE_PROFILE_DATABASE_NAME = 'coc_v2_image_generation_profiles';
export const AVG_IMAGE_PROFILE_CHANGED_EVENT = 'coc-v2-image-generation-profiles-changed';
export const AVG_IMAGE_SIZE_PRESETS = ['1024x1024', '1024x1536', '1536x1024'] as const;

export type AvgImageSize = typeof AVG_IMAGE_SIZE_PRESETS[number];
export interface AvgImageGenerationProfile {
  id: string;
  name: string;
  provider: 'openai-images-compatible';
  baseUrl: string;
  model: string;
  size: AvgImageSize;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
}
type CredentialRow = { profileId: string; credential: string };
type MetaRow = { key: 'defaultProfileId'; value: string };
const DB_VERSION = 1;

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('图片生成档案读取失败。'));
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('图片生成档案保存失败。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('图片生成档案保存已中止。'));
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('当前环境不支持 IndexedDB'));
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, DB_VERSION);
    opening.onupgradeneeded = () => {
      const database = opening.result;
      if (!database.objectStoreNames.contains('profiles')) database.createObjectStore('profiles', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('credentials')) database.createObjectStore('credentials', { keyPath: 'profileId' });
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'key' });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error('图片生成档案数据库打开失败。'));
  });
}

function emitChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AVG_IMAGE_PROFILE_CHANGED_EVENT));
}

function cleanText(value: string, min: number, max: number, label: string): string {
  const normalized = value.trim();
  if ([...normalized].length < min || [...normalized].length > max) throw new Error(`${label}长度必须在 ${min} 到 ${max} 个字符之间。`);
  return normalized;
}

export function normalizeAvgImageServiceBaseUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { throw new Error('图片服务地址格式不正确。'); }
  if (parsed.username || parsed.password) throw new Error('图片服务地址不能包含凭据。');
  if (parsed.search) throw new Error('图片服务地址不能包含查询参数。');
  if (parsed.hash) throw new Error('图片服务地址不能包含片段。');
  const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' && !localHttp) throw new Error('图片服务地址必须使用 HTTPS；仅 localhost 或 127.0.0.1 可使用 HTTP。');
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '') || '/';
  return parsed.toString().replace(/\/$/u, '');
}

export function createAvgImageGenerationProfile(): AvgImageGenerationProfile {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name: '图片生成档案', provider: 'openai-images-compatible', baseUrl: '', model: '', size: AVG_IMAGE_SIZE_PRESETS[0], timeoutMs: 60_000, createdAt: now, updatedAt: now };
}

export function validateAvgImageGenerationProfile(profile: AvgImageGenerationProfile, existing: readonly AvgImageGenerationProfile[] = []): AvgImageGenerationProfile {
  const id = profile.id.trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(id)) throw new Error('图片生成档案标识无效。');
  const name = cleanText(profile.name, 1, 40, '档案名称');
  const folded = name.normalize('NFKC').toLocaleLowerCase();
  if (existing.some((row) => row.id !== id && row.name.trim().normalize('NFKC').toLocaleLowerCase() === folded)) throw new Error('图片生成档案名称不能重复。');
  if (profile.provider !== 'openai-images-compatible') throw new Error('当前不支持该图片生成服务类型。');
  const timeoutMs = Math.floor(Number(profile.timeoutMs));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 300_000) throw new Error('超时时间必须在 10 到 300 秒之间。');
  if (!AVG_IMAGE_SIZE_PRESETS.includes(profile.size)) throw new Error('图片尺寸不在受支持的预设中。');
  const now = new Date().toISOString();
  const createdAt = Number.isFinite(Date.parse(profile.createdAt)) ? new Date(profile.createdAt).toISOString() : now;
  return { id, name, provider: profile.provider, baseUrl: normalizeAvgImageServiceBaseUrl(profile.baseUrl), model: cleanText(profile.model, 1, 120, '模型名称'), size: profile.size, timeoutMs, createdAt, updatedAt: now };
}

export function avgImageGenerationEndpoint(profile: AvgImageGenerationProfile): string {
  return `${normalizeAvgImageServiceBaseUrl(profile.baseUrl)}/images/generations`;
}

export function describeAvgImageCredential(value?: string): string {
  return value?.trim() ? '已保存（内容已隐藏）' : '未保存';
}

export class IndexedDbAvgImageGenerationProfileRepository {
  constructor(private readonly databaseName = AVG_IMAGE_PROFILE_DATABASE_NAME) {}

  private async transact<T>(stores: string | string[], mode: IDBTransactionMode, operation: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await openDatabase(this.databaseName);
    const tx = db.transaction(stores, mode);
    const completion = done(tx);
    try { const result = await operation(tx); await completion; return result; }
    finally { db.close(); }
  }

  async listProfiles(): Promise<AvgImageGenerationProfile[]> {
    return this.transact('profiles', 'readonly', async (tx) => (await req<AvgImageGenerationProfile[]>(tx.objectStore('profiles').getAll()))
      .map((row) => ({ ...row })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)));
  }

  async saveProfile(input: AvgImageGenerationProfile, credential?: string): Promise<AvgImageGenerationProfile> {
    const profiles = await this.listProfiles();
    const profile = validateAvgImageGenerationProfile({ ...input, createdAt: profiles.find((row) => row.id === input.id)?.createdAt ?? input.createdAt }, profiles);
    await this.transact(['profiles', 'credentials', 'meta'], 'readwrite', async (tx) => {
      await req(tx.objectStore('profiles').put(profile));
      if (credential !== undefined) {
        const value = credential.trim();
        if (value) await req(tx.objectStore('credentials').put({ profileId: profile.id, credential: value } satisfies CredentialRow));
        else await req(tx.objectStore('credentials').delete(profile.id));
      }
      const meta = tx.objectStore('meta');
      if (!(await req<MetaRow | undefined>(meta.get('defaultProfileId')))?.value) await req(meta.put({ key: 'defaultProfileId', value: profile.id } satisfies MetaRow));
    });
    emitChanged();
    return { ...profile };
  }

  async getCredential(profileId: string): Promise<string | undefined> {
    return this.transact('credentials', 'readonly', async (tx) => (await req<CredentialRow | undefined>(tx.objectStore('credentials').get(profileId)))?.credential);
  }

  async getDefaultProfile(): Promise<AvgImageGenerationProfile | undefined> {
    const profiles = await this.listProfiles();
    if (!profiles.length) return undefined;
    const id = await this.transact('meta', 'readonly', async (tx) => (await req<MetaRow | undefined>(tx.objectStore('meta').get('defaultProfileId')))?.value);
    return profiles.find((profile) => profile.id === id) ?? profiles[0];
  }

  async setDefaultProfile(profileId?: string): Promise<void> {
    if (profileId && !(await this.listProfiles()).some((profile) => profile.id === profileId)) throw new Error('默认图片生成档案不存在。');
    await this.transact('meta', 'readwrite', async (tx) => {
      if (profileId) await req(tx.objectStore('meta').put({ key: 'defaultProfileId', value: profileId } satisfies MetaRow));
      else await req(tx.objectStore('meta').delete('defaultProfileId'));
    });
    emitChanged();
  }

  async deleteProfile(profileId: string): Promise<void> {
    const remaining = (await this.listProfiles()).filter((profile) => profile.id !== profileId);
    await this.transact(['profiles', 'credentials', 'meta'], 'readwrite', async (tx) => {
      await req(tx.objectStore('profiles').delete(profileId));
      await req(tx.objectStore('credentials').delete(profileId));
      const meta = tx.objectStore('meta');
      if ((await req<MetaRow | undefined>(meta.get('defaultProfileId')))?.value === profileId) {
        if (remaining[0]) await req(meta.put({ key: 'defaultProfileId', value: remaining[0].id } satisfies MetaRow));
        else await req(meta.delete('defaultProfileId'));
      }
    });
    emitChanged();
  }
}
