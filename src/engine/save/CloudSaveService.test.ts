import { describe, expect, it } from 'vitest';
import {
  decryptApiSettingsArchive,
  encryptApiSettingsArchive,
  getKnownCloudRevision,
  loadCloudSyncPreferences,
  mergeRoutesOnlyArchiveWithLocalKeys,
  saveCloudSyncPreferences,
} from './CloudSaveService';
import type { ApiSettingsArchive } from '../settings/ApiConfigManager';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('CloudSaveService preferences', () => {
  it('keeps cloud sync opt-in and API settings excluded by default', () => {
    const storage = memoryStorage();
    expect(loadCloudSyncPreferences(storage)).toEqual({
      autoSyncCurrentSave: false,
      apiSettingsSyncMode: 'none',
    });

    saveCloudSyncPreferences({
      autoSyncCurrentSave: true,
      apiSettingsSyncMode: 'routes_only',
    }, storage);
    expect(loadCloudSyncPreferences(storage)).toEqual({
      autoSyncCurrentSave: true,
      apiSettingsSyncMode: 'routes_only',
    });
    expect(getKnownCloudRevision('never-uploaded', storage)).toBeNull();
  });

  it('encrypts full API settings in the browser and rejects a wrong passphrase', async () => {
    const archive: ApiSettingsArchive = {
      schema: 'coc.v2.api-settings',
      version: 2,
      exportedAt: '2026-08-02T00:00:00.000Z',
      configs: [{
        id: 'api_main',
        name: 'main',
        provider: 'openai_compatible',
        baseUrl: 'https://example.com/v1',
        apiKey: 'secret-api-key',
        model: 'example-model',
        models: ['example-model'],
        createdAt: '2026-08-02T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
      }],
      routes: {
        mainNarrative: { configId: 'api_main', model: 'example-model' },
      },
    };

    const encrypted = await encryptApiSettingsArchive(archive, 'long-enough-passphrase');
    expect(JSON.stringify(encrypted)).not.toContain('secret-api-key');
    await expect(decryptApiSettingsArchive(encrypted, 'long-enough-passphrase'))
      .resolves.toEqual(archive);
    await expect(decryptApiSettingsArchive(encrypted, 'wrong-passphrase'))
      .rejects.toThrow('解密失败');
  });

  it('restores routes-only settings without erasing an existing local API key', () => {
    const local: ApiSettingsArchive = {
      schema: 'coc.v2.api-settings',
      version: 2,
      exportedAt: '2026-08-02T00:00:00.000Z',
      configs: [{
        id: 'api_main',
        name: 'local',
        provider: 'openai_compatible',
        baseUrl: 'https://local.example/v1',
        apiKey: 'keep-this-local-key',
        model: 'local-model',
        models: ['local-model'],
        createdAt: '2026-08-02T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
      }],
      routes: {},
    };
    const cloud: ApiSettingsArchive = {
      ...local,
      configs: [{
        ...local.configs[0],
        name: 'cloud route',
        baseUrl: 'https://cloud.example/v1',
        apiKey: '',
        model: 'cloud-model',
        models: ['cloud-model'],
      }],
      routes: { mainNarrative: { configId: 'api_main', model: 'cloud-model' } },
    };

    const merged = mergeRoutesOnlyArchiveWithLocalKeys(cloud, local);
    expect(merged.configs[0].apiKey).toBe('keep-this-local-key');
    expect(merged.configs[0].baseUrl).toBe('https://cloud.example/v1');
    expect(merged.routes.mainNarrative).toEqual({
      configId: 'api_main',
      model: 'cloud-model',
    });
  });
});
