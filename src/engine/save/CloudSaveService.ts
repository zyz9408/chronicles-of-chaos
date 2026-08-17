import type { SaveListItem } from '../types';
import {
  exportApiSettings,
  importApiSettings,
  type ApiSettingsArchive,
} from '../settings/ApiConfigManager';
import { exportSingleSave, importSaves, listSaves } from './SaveManager';
import { createPortableSaveZip, parsePortableSaveZip } from './SaveArchiveZip';

export interface CloudAccount {
  userId: string;
  discordId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CloudUsage {
  usedBytes: number;
  reservedBytes: number;
  limitBytes: number;
  slotCount: number;
  slotLimit: number;
}

export interface CloudLimits {
  globalBytes: number;
  userBytes: number;
  uploadBytes: number;
  slots: number;
  dailyUploads: number;
  userDailyUploads: number;
}

export interface CloudSessionState {
  configured: boolean;
  authConfigured: boolean;
  authenticated: boolean;
  account?: CloudAccount;
  usage?: CloudUsage;
  limits: CloudLimits;
}

export interface CloudSaveMetadata {
  label: string;
  playerName: string;
  currentDate: string;
  locationName: string;
  updatedAt: string;
  saveKind: 'auto' | 'manual';
  turnCount: number;
}

export interface CloudSaveItem {
  slotId: string;
  revision: number;
  sizeBytes: number;
  checksumSha256: string;
  createdAt: string;
  updatedAt: string;
  metadata: CloudSaveMetadata;
}

export interface CloudSaveListState {
  saves: CloudSaveItem[];
  usage: CloudUsage;
}

export interface CloudApiSettingsItem {
  revision: number;
  sizeBytes: number;
  checksumSha256: string;
  syncMode: Exclude<CloudApiSettingsSyncMode, 'none'>;
  createdAt: string;
  updatedAt: string;
}

interface EncryptedApiSettingsEnvelope {
  schema: 'coc.v2.encrypted-api-settings';
  version: 1;
  cipher: 'AES-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

export type CloudApiSettingsSyncMode = 'none' | 'routes_only' | 'encrypted_full';

export interface CloudSyncPreferences {
  autoSyncCurrentSave: boolean;
  apiSettingsSyncMode: CloudApiSettingsSyncMode;
}

const CLOUD_PREFERENCES_KEY = 'coc_v2_cloud_sync_preferences_v1';
const CLOUD_REVISION_KEY_PREFIX = 'coc_v2_cloud_revision_';
const API_SETTINGS_ENCRYPTION_ITERATIONS = 210_000;

export class CloudSaveApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'CloudSaveApiError';
  }
}

function getStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export function loadCloudSyncPreferences(storage?: Storage): CloudSyncPreferences {
  const target = getStorage(storage);
  if (!target) return { autoSyncCurrentSave: false, apiSettingsSyncMode: 'none' };
  try {
    const parsed = JSON.parse(target.getItem(CLOUD_PREFERENCES_KEY) ?? '{}') as Partial<CloudSyncPreferences>;
    const apiSettingsSyncMode = ['none', 'routes_only', 'encrypted_full'].includes(
      parsed.apiSettingsSyncMode ?? '',
    ) ? parsed.apiSettingsSyncMode as CloudApiSettingsSyncMode : 'none';
    return {
      autoSyncCurrentSave: parsed.autoSyncCurrentSave === true,
      apiSettingsSyncMode,
    };
  } catch {
    return { autoSyncCurrentSave: false, apiSettingsSyncMode: 'none' };
  }
}

export function saveCloudSyncPreferences(
  preferences: CloudSyncPreferences,
  storage?: Storage,
): CloudSyncPreferences {
  const normalized: CloudSyncPreferences = {
    autoSyncCurrentSave: preferences.autoSyncCurrentSave === true,
    apiSettingsSyncMode: ['none', 'routes_only', 'encrypted_full'].includes(
      preferences.apiSettingsSyncMode,
    ) ? preferences.apiSettingsSyncMode : 'none',
  };
  getStorage(storage)?.setItem(CLOUD_PREFERENCES_KEY, JSON.stringify(normalized));
  return normalized;
}

export function getKnownCloudRevision(slotId: string, storage?: Storage): number | null {
  const raw = getStorage(storage)?.getItem(`${CLOUD_REVISION_KEY_PREFIX}${slotId}`);
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function rememberCloudRevision(slotId: string, revision: number, storage?: Storage): void {
  const target = getStorage(storage);
  if (!target) return;
  if (revision > 0) target.setItem(`${CLOUD_REVISION_KEY_PREFIX}${slotId}`, String(revision));
  else target.removeItem(`${CLOUD_REVISION_KEY_PREFIX}${slotId}`);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    throw new CloudSaveApiError(
      typeof body.message === 'string' ? body.message : `云存档请求失败（HTTP ${response.status}）。`,
      typeof body.code === 'string' ? body.code : 'cloud_request_failed',
      response.status,
      payload,
    );
  }
  return payload as T;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeBytesBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBytesBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytesToArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isApiSettingsArchive(value: unknown): value is ApiSettingsArchive {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const archive = value as Partial<ApiSettingsArchive>;
  return archive.schema === 'coc.v2.api-settings'
    && (archive.version === 1 || archive.version === 2)
    && Array.isArray(archive.configs)
    && archive.routes !== null
    && typeof archive.routes === 'object';
}

function withoutApiKeys(archive: ApiSettingsArchive): ApiSettingsArchive {
  return {
    ...archive,
    configs: archive.configs.map((config) => ({ ...config, apiKey: '' })),
  };
}

export function mergeRoutesOnlyArchiveWithLocalKeys(
  archive: ApiSettingsArchive,
  localArchive: ApiSettingsArchive,
): ApiSettingsArchive {
  const localById = new Map(localArchive.configs.map((config) => [config.id, config]));
  return {
    ...archive,
    configs: archive.configs.map((config) => ({
      ...config,
      apiKey: localById.get(config.id)?.apiKey ?? '',
    })),
  };
}

async function deriveApiSettingsKey(
  passphrase: string,
  salt: Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: bytesToArrayBuffer(salt),
      iterations: API_SETTINGS_ENCRYPTION_ITERATIONS,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

export async function encryptApiSettingsArchive(
  archive: ApiSettingsArchive,
  passphrase: string,
): Promise<EncryptedApiSettingsEnvelope> {
  if (passphrase.length < 8) throw new Error('加密口令至少需要 8 个字符。');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveApiSettingsKey(passphrase, salt, ['encrypt']);
  const plaintext = new TextEncoder().encode(JSON.stringify(archive));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bytesToArrayBuffer(iv) },
    key,
    bytesToArrayBuffer(plaintext),
  ));
  return {
    schema: 'coc.v2.encrypted-api-settings',
    version: 1,
    cipher: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: API_SETTINGS_ENCRYPTION_ITERATIONS,
    salt: encodeBytesBase64Url(salt),
    iv: encodeBytesBase64Url(iv),
    ciphertext: encodeBytesBase64Url(ciphertext),
  };
}

export async function decryptApiSettingsArchive(
  envelope: EncryptedApiSettingsEnvelope,
  passphrase: string,
): Promise<ApiSettingsArchive> {
  if (
    envelope?.schema !== 'coc.v2.encrypted-api-settings'
    || envelope.version !== 1
    || envelope.cipher !== 'AES-GCM'
    || envelope.kdf !== 'PBKDF2-SHA256'
    || envelope.iterations !== API_SETTINGS_ENCRYPTION_ITERATIONS
  ) {
    throw new Error('加密 API 配置格式不受支持。');
  }
  try {
    const salt = decodeBytesBase64Url(envelope.salt);
    const iv = decodeBytesBase64Url(envelope.iv);
    const ciphertext = decodeBytesBase64Url(envelope.ciphertext);
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length <= 16) throw new Error('invalid');
    const key = await deriveApiSettingsKey(passphrase, salt, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytesToArrayBuffer(iv) },
      key,
      bytesToArrayBuffer(ciphertext),
    );
    const archive = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    if (!isApiSettingsArchive(archive)) throw new Error('invalid');
    return archive;
  } catch {
    throw new Error('解密失败：口令不正确，或云端配置已经损坏。');
  }
}

export async function getCloudApiSettings(): Promise<CloudApiSettingsItem | null> {
  const response = await fetch('/api/cloud/settings/api', {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  const payload = await parseJsonResponse<{ settings: CloudApiSettingsItem | null }>(response);
  return payload.settings;
}

export async function uploadCloudApiSettings(
  mode: Exclude<CloudApiSettingsSyncMode, 'none'>,
  passphrase = '',
): Promise<CloudApiSettingsItem> {
  const current = await getCloudApiSettings();
  const exported = await exportApiSettings();
  const payload = mode === 'routes_only'
    ? withoutApiKeys(exported)
    : await encryptApiSettingsArchive(exported, passphrase);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const checksum = await sha256Hex(bytes);
  const response = await fetch('/api/cloud/settings/api', {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'content-type': 'application/octet-stream',
      'x-coc-base-revision': String(current?.revision ?? 0),
      'x-coc-settings-mode': mode,
      'x-coc-settings-checksum': checksum,
    },
    body: bytesToArrayBuffer(bytes),
  });
  const result = await parseJsonResponse<{ settings: CloudApiSettingsItem }>(response);
  return result.settings;
}

export async function downloadCloudApiSettings(
  passphrase = '',
): Promise<CloudApiSettingsItem> {
  const metadata = await getCloudApiSettings();
  if (!metadata) throw new Error('云端没有 API 配置快照。');
  const response = await fetch('/api/cloud/settings/api?download=1', {
    credentials: 'include',
    headers: { accept: 'application/octet-stream' },
  });
  if (!response.ok) await parseJsonResponse(response);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (await sha256Hex(bytes) !== metadata.checksumSha256) {
    throw new Error('下载的 API 配置校验失败，未修改本机设置。');
  }
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  const archive = metadata.syncMode === 'encrypted_full'
    ? await decryptApiSettingsArchive(parsed as EncryptedApiSettingsEnvelope, passphrase)
    : parsed;
  if (!isApiSettingsArchive(archive)) throw new Error('云端 API 配置格式不正确。');
  const importArchive = metadata.syncMode === 'routes_only'
    ? mergeRoutesOnlyArchiveWithLocalKeys(archive, await exportApiSettings())
    : archive;
  await importApiSettings(importArchive, { mode: 'merge' });
  return metadata;
}

export async function deleteCloudApiSettings(): Promise<void> {
  const current = await getCloudApiSettings();
  if (!current) return;
  const response = await fetch('/api/cloud/settings/api', {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'x-coc-base-revision': String(current.revision) },
  });
  await parseJsonResponse(response);
}

export function cloudLoginUrl(returnTo = '/'): string {
  return `/api/cloud/auth/discord/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function startDiscordCloudLogin(returnTo = '/'): void {
  if (typeof window !== 'undefined') window.location.assign(cloudLoginUrl(returnTo));
}

export async function getCloudSession(): Promise<CloudSessionState> {
  const response = await fetch('/api/cloud/auth/session', {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  const payload = await parseJsonResponse<CloudSessionState & { ok: boolean }>(response);
  return payload;
}

export async function logoutCloudSession(): Promise<void> {
  const response = await fetch('/api/cloud/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  await parseJsonResponse(response);
}

export async function listCloudSaves(): Promise<CloudSaveListState> {
  const response = await fetch('/api/cloud/saves', {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  const payload = await parseJsonResponse<{ saves: CloudSaveItem[]; usage: CloudUsage }>(response);
  return { saves: payload.saves, usage: payload.usage };
}

function metadataFromSave(save: SaveListItem): CloudSaveMetadata {
  return {
    label: save.label,
    playerName: save.playerName,
    currentDate: save.currentDate,
    locationName: save.locationName,
    updatedAt: save.updatedAt,
    saveKind: save.saveKind === 'manual' ? 'manual' : 'auto',
    turnCount: save.turnCount,
  };
}

export async function uploadLocalSave(
  save: SaveListItem,
  baseRevision: number,
): Promise<CloudSaveItem> {
  const archive = await exportSingleSave(save.id, 3);
  if (!archive) throw new Error('本地存档不存在。');
  const zipBytes = await createPortableSaveZip(archive);
  const checksum = await sha256Hex(zipBytes);
  const metadata = metadataFromSave(save);
  const body = zipBytes.buffer.slice(
    zipBytes.byteOffset,
    zipBytes.byteOffset + zipBytes.byteLength,
  ) as ArrayBuffer;
  const response = await fetch(`/api/cloud/saves/${encodeURIComponent(save.id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'content-type': 'application/zip',
      'x-coc-base-revision': String(baseRevision),
      'x-coc-save-checksum': checksum,
      'x-coc-save-metadata': encodeBase64Url(JSON.stringify(metadata)),
    },
    body,
  });
  const payload = await parseJsonResponse<{ save: CloudSaveItem }>(response);
  rememberCloudRevision(save.id, payload.save.revision);
  return payload.save;
}

export async function downloadCloudSave(save: CloudSaveItem): Promise<void> {
  const response = await fetch(`/api/cloud/saves/${encodeURIComponent(save.slotId)}`, {
    credentials: 'include',
    headers: { accept: 'application/zip' },
  });
  if (!response.ok) await parseJsonResponse(response);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const expectedChecksum = response.headers.get('x-coc-save-checksum') ?? save.checksumSha256;
  if (await sha256Hex(bytes) !== expectedChecksum) {
    throw new CloudSaveApiError('下载的云存档校验失败，未写入本机。', 'checksum_mismatch', 500);
  }
  const archive = await parsePortableSaveZip(bytes);
  if (archive.saves.length !== 1 || archive.saves[0]?.id !== save.slotId) {
    throw new CloudSaveApiError('云存档内容与槽位不匹配，未写入本机。', 'slot_mismatch', 500);
  }
  await importSaves(archive, { mode: 'merge' });
  rememberCloudRevision(save.slotId, save.revision);
}

export async function deleteCloudSave(save: CloudSaveItem): Promise<void> {
  const response = await fetch(`/api/cloud/saves/${encodeURIComponent(save.slotId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'x-coc-base-revision': String(save.revision) },
  });
  await parseJsonResponse(response);
  rememberCloudRevision(save.slotId, 0);
}

export async function deleteAllCloudSaves(): Promise<void> {
  const response = await fetch('/api/cloud/saves', {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'x-coc-delete-all': 'yes' },
  });
  await parseJsonResponse(response);
}

export async function syncCurrentSave(saveId: string): Promise<CloudSaveItem> {
  const local = (await listSaves()).find((save) => save.id === saveId);
  if (!local) throw new Error('当前本地存档不存在。');
  const remote = (await listCloudSaves()).saves.find((save) => save.slotId === saveId);
  const knownRevision = getKnownCloudRevision(saveId);
  if (remote && knownRevision !== remote.revision) {
    throw new CloudSaveApiError(
      '云端版本来自另一设备，请先下载或在存档界面确认后再覆盖。',
      'cloud_save_conflict',
      409,
    );
  }
  return uploadLocalSave(local, remote?.revision ?? 0);
}
