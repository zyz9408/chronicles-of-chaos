import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetLocalDatabaseForTests } from '../storage/IndexedDbStore';
import {
  createApiConfigDraft,
  exportApiSettings,
  getApiTaskRoutesAsync,
  importApiSettings,
  listApiConfigsAsync,
  resolveApiConfigForTaskAsync,
  setApiTaskRouteAsync,
  upsertApiConfigAsync,
} from './ApiConfigManager';

describe('ApiConfigManager IndexedDB persistence', () => {
  beforeEach(async () => {
    await resetLocalDatabaseForTests();
  });

  it('stores API settings in IndexedDB and restores configs plus task routes', async () => {
    const draft = createApiConfigDraft('openai_compatible');
    const saved = await upsertApiConfigAsync({
      ...draft,
      name: '主剧情接口',
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      models: ['test-model', 'fast-model', 'embedding-model'],
    });
    await setApiTaskRouteAsync('mainNarrative', { configId: saved.id, model: 'test-model' });
    await setApiTaskRouteAsync('embedding', { configId: saved.id, model: 'embedding-model' });

    expect(await listApiConfigsAsync()).toHaveLength(1);
    expect((await resolveApiConfigForTaskAsync('npcCompletion'))?.id).toBe(saved.id);
    expect((await resolveApiConfigForTaskAsync('embedding'))?.id).toBe(saved.id);

    const archive = await exportApiSettings();
    expect(archive).toMatchObject({
      schema: 'coc.v2.api-settings',
      version: 2,
    });
    expect(archive.configs[0]).toMatchObject({ name: '主剧情接口', apiKey: 'sk-test' });
    expect(archive.routes.mainNarrative).toEqual({ configId: saved.id, model: 'test-model' });
    expect(archive.routes.embedding).toEqual({ configId: saved.id, model: 'embedding-model' });

    await importApiSettings(
      { ...archive, configs: [], routes: { ...archive.routes, mainNarrative: null, embedding: null } },
      { mode: 'replace' },
    );
    expect(await listApiConfigsAsync()).toEqual([]);
    expect((await getApiTaskRoutesAsync()).mainNarrative).toBeNull();
    expect((await getApiTaskRoutesAsync()).embedding).toBeNull();

    await importApiSettings(archive, { mode: 'replace' });
    expect((await resolveApiConfigForTaskAsync('mainNarrative'))?.model).toBe('test-model');
    expect((await resolveApiConfigForTaskAsync('embedding'))?.model).toBe('embedding-model');
    expect((await getApiTaskRoutesAsync()).mainNarrative).toEqual({ configId: saved.id, model: 'test-model' });
    expect((await getApiTaskRoutesAsync()).embedding).toEqual({ configId: saved.id, model: 'embedding-model' });
  });

  it('imports version 1 API settings and upgrades single-model profiles plus string routes', async () => {
    await importApiSettings({
      schema: 'coc.v2.api-settings',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      configs: [{
        id: 'api_legacy',
        name: 'legacy endpoint',
        provider: 'openai_compatible',
        baseUrl: 'https://legacy.example.com/v1',
        apiKey: 'sk-legacy',
        model: 'legacy-model',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      routes: {
        mainNarrative: 'api_legacy',
        memorySummary: 'api_legacy',
      },
    }, { mode: 'replace' });

    expect((await listApiConfigsAsync())[0].models).toEqual(['legacy-model']);
    expect((await getApiTaskRoutesAsync()).memorySummary).toEqual({
      configId: 'api_legacy',
      model: 'legacy-model',
    });
    expect((await resolveApiConfigForTaskAsync('memorySummary'))?.model).toBe('legacy-model');
  });
});
