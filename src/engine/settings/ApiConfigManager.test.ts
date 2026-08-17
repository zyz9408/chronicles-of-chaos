import { describe, expect, it } from 'vitest';
import {
  API_MAX_OUTPUT_TOKEN_PRESETS,
  API_TASKS,
  API_PROVIDER_OPTIONS,
  DEFAULT_API_MAX_OUTPUT_TOKENS,
  createApiConfigDraft,
  getApiConfigModels,
  getApiMaxOutputTokenGuidance,
  getApiMaxOutputTokenPresetId,
  getApiTaskRoutes,
  listApiConfigs,
  maskApiKey,
  prepareApiConfigForSave,
  resolveApiConfigForTask,
  setApiTaskRoute,
  upsertApiConfig,
} from './ApiConfigManager';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length() {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('ApiConfigManager', () => {
  it('offers 8K, 32K, and 64K output presets while keeping new profiles at 8K', () => {
    expect(API_MAX_OUTPUT_TOKEN_PRESETS.map((preset) => preset.value)).toEqual([
      8_192,
      32_768,
      65_536,
    ]);
    expect(DEFAULT_API_MAX_OUTPUT_TOKENS).toBe(8_192);
    expect(createApiConfigDraft().maxOutputTokens).toBe(8_192);
    expect(getApiMaxOutputTokenPresetId(8_192)).toBe('8k');
    expect(getApiMaxOutputTokenPresetId(32_768)).toBe('32k');
    expect(getApiMaxOutputTokenPresetId(65_536)).toBe('64k');
    expect(getApiMaxOutputTokenPresetId(12_000)).toBe('custom');
  });

  it('explains that higher output caps require model and proxy support', () => {
    expect(getApiMaxOutputTokenGuidance(8_192)).toMatchObject({
      tone: 'default',
      message: expect.stringContaining('通常足够'),
    });
    expect(getApiMaxOutputTokenGuidance(32_768).message).toContain('模型和代理');
    expect(getApiMaxOutputTokenGuidance(65_536).message).toContain('不兼容');
    expect(getApiMaxOutputTokenGuidance(12_000).message).toContain('12000');
    expect(getApiMaxOutputTokenGuidance(48_000).message).toContain('48000');
    expect(getApiMaxOutputTokenGuidance(100_000)).toMatchObject({
      tone: 'warning',
      message: expect.stringContaining('超过 64K'),
    });
  });

  it('covers mainstream API provider types used by LLM games', () => {
    const providerIds = API_PROVIDER_OPTIONS.map((provider) => provider.id);

    expect(providerIds).toEqual(
      expect.arrayContaining([
        'openai',
        'openai_compatible',
        'deepseek',
        'gemini',
        'anthropic',
        'qwen',
        'zhipu',
        'zhipu_coding',
        'minimax',
        'minimax_international',
        'moonshot',
        'doubao',
        'xai',
        'groq',
        'mistral',
        'ollama',
        'lm_studio',
        'custom',
      ]),
    );
  });

  it('uses distinct official presets for GLM Coding Plan and MiniMax regions', () => {
    expect(createApiConfigDraft('zhipu')).toMatchObject({
      provider: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    });
    expect(createApiConfigDraft('zhipu_coding')).toMatchObject({
      provider: 'zhipu_coding',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    });
    expect(createApiConfigDraft('minimax')).toMatchObject({
      provider: 'minimax',
      baseUrl: 'https://api.minimaxi.com/v1',
    });
    expect(createApiConfigDraft('minimax_international')).toMatchObject({
      provider: 'minimax_international',
      baseUrl: 'https://api.minimax.io/v1',
    });
  });

  it('saves API config archives and resolves task routes with fallback', () => {
    const storage = new MemoryStorage();
    const draft = createApiConfigDraft('openai_compatible');
    const saved = upsertApiConfig(
      {
        ...draft,
        name: 'ggchan',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
        model: 'gemini-3-flash-preview',
        maxOutputTokens: 8192,
      },
      storage,
    );

    expect(listApiConfigs(storage)).toHaveLength(1);
    expect(maskApiKey(saved.apiKey)).toBe('sk-***wxyz');

    expect(getApiTaskRoutes(storage).mainNarrative).toBeNull();
    expect(resolveApiConfigForTask('memorySummary', storage)?.id).toBe(saved.id);
    expect(resolveApiConfigForTask('embedding', storage)?.id).toBe(saved.id);

    setApiTaskRoute('mainNarrative', saved.id, storage);
    expect(getApiTaskRoutes(storage).mainNarrative).toEqual({
      configId: saved.id,
      model: 'gemini-3-flash-preview',
    });
    expect(resolveApiConfigForTask('mainNarrative', storage)?.name).toBe('ggchan');
  });

  it('exposes embedding as a dedicated API task route', () => {
    const storage = new MemoryStorage();
    const embeddingTask = API_TASKS.find((task) => task.id === 'embedding');
    const draft = createApiConfigDraft('openai_compatible');
    const saved = upsertApiConfig(
      {
        ...draft,
        name: 'embedding api',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
        model: 'text-embedding-test',
      },
      storage,
    );

    expect(embeddingTask).toBeTruthy();
    expect(getApiTaskRoutes(storage).embedding).toBeNull();

    setApiTaskRoute('embedding', saved.id, storage);

    expect(getApiTaskRoutes(storage).embedding).toEqual({
      configId: saved.id,
      model: 'text-embedding-test',
    });
    expect(resolveApiConfigForTask('embedding', storage)?.model).toBe('text-embedding-test');
  });

  it('exposes NPC dynamic simulation as a dedicated API task route', () => {
    const storage = new MemoryStorage();
    const npcSimulationTask = API_TASKS.find((task) => task.id === 'npcSimulation');
    const draft = createApiConfigDraft('openai_compatible');
    const saved = upsertApiConfig(
      {
        ...draft,
        name: 'npc simulation api',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
        model: 'fast-npc-model',
      },
      storage,
    );

    expect(npcSimulationTask).toMatchObject({
      label: 'NPC动态模拟',
    });
    expect(getApiTaskRoutes(storage).npcSimulation).toBeNull();

    setApiTaskRoute('npcSimulation', saved.id, storage);

    expect(getApiTaskRoutes(storage).npcSimulation).toEqual({
      configId: saved.id,
      model: 'fast-npc-model',
    });
    expect(resolveApiConfigForTask('npcSimulation', storage)?.model).toBe('fast-npc-model');
  });

  it('exposes state writeback as an optional API task route with main route fallback', () => {
    const storage = new MemoryStorage();
    const stateWritebackTask = API_TASKS.find((task) => task.id === 'stateWriteback');
    const mainDraft = createApiConfigDraft('openai_compatible');
    const main = upsertApiConfig(
      {
        ...mainDraft,
        name: 'main narrative api',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
        model: 'main-model',
      },
      storage,
    );
    const writebackDraft = createApiConfigDraft('openai_compatible');
    const writeback = upsertApiConfig(
      {
        ...writebackDraft,
        name: 'state writeback api',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
        model: 'writeback-model',
      },
      storage,
    );

    expect(stateWritebackTask).toMatchObject({
      label: '状态写回主要 API',
    });
    expect(API_TASKS.find((task) => task.id === 'stateWritebackFallback')).toMatchObject({
      label: '状态写回备用 API',
    });
    setApiTaskRoute('mainNarrative', main.id, storage);
    expect(getApiTaskRoutes(storage).stateWriteback).toBeNull();
    expect(resolveApiConfigForTask('stateWriteback', storage)?.model).toBe('main-model');

    setApiTaskRoute('stateWriteback', writeback.id, storage);

    expect(getApiTaskRoutes(storage).stateWriteback).toEqual({
      configId: writeback.id,
      model: 'writeback-model',
    });
    expect(resolveApiConfigForTask('stateWriteback', storage)?.model).toBe('writeback-model');
  });

  it('normalizes optional model temperature before saving API config archives', () => {
    const storage = new MemoryStorage();
    const draft = createApiConfigDraft('openai_compatible');

    expect(draft.temperature).toBeUndefined();

    const blankTemperature = prepareApiConfigForSave({
      ...draft,
      name: 'creative narrator',
      baseUrl: ' https://example.com/v1 ',
      apiKey: ' sk-abcdefghijklmnopqrstuvwxyz ',
      model: ' gemini-3-pro ',
      temperature: '',
    });

    expect(blankTemperature).toMatchObject({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
      model: 'gemini-3-pro',
      temperature: undefined,
    });

    upsertApiConfig(
      {
        ...draft,
        name: 'creative narrator',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
        model: 'gemini-3-pro',
        temperature: 0.65,
      },
      storage,
    );

    expect(listApiConfigs(storage)[0].temperature).toBe(0.65);
    expect(resolveApiConfigForTask('mainNarrative', storage)?.temperature).toBe(0.65);
  });

  it('stores custom output caps as positive integers without changing valid presets', () => {
    const draft = createApiConfigDraft('openai_compatible');
    expect(prepareApiConfigForSave({
      ...draft,
      maxOutputTokens: '32768',
    }).maxOutputTokens).toBe(32_768);
    expect(prepareApiConfigForSave({
      ...draft,
      maxOutputTokens: 12_345.9,
    }).maxOutputTokens).toBe(12_345);
    expect(prepareApiConfigForSave({
      ...draft,
      maxOutputTokens: -1,
    }).maxOutputTokens).toBeUndefined();
  });

  it('stores one API profile with multiple models and resolves a different model for each task route', () => {
    const storage = new MemoryStorage();
    const draft = createApiConfigDraft('openai_compatible');
    const saved = upsertApiConfig(
      {
        ...draft,
        name: 'shared endpoint',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
        model: 'narrative-model',
        models: ['narrative-model', 'fast-model', 'embedding-model'],
      },
      storage,
    );

    setApiTaskRoute('mainNarrative', { configId: saved.id, model: 'narrative-model' }, storage);
    setApiTaskRoute('memorySummary', { configId: saved.id, model: 'fast-model' }, storage);
    setApiTaskRoute('embedding', { configId: saved.id, model: 'embedding-model' }, storage);

    expect(listApiConfigs(storage)).toHaveLength(1);
    expect(getApiConfigModels(saved)).toEqual(['narrative-model', 'fast-model', 'embedding-model']);
    expect(getApiTaskRoutes(storage)).toMatchObject({
      mainNarrative: { configId: saved.id, model: 'narrative-model' },
      memorySummary: { configId: saved.id, model: 'fast-model' },
      embedding: { configId: saved.id, model: 'embedding-model' },
    });
    expect(resolveApiConfigForTask('mainNarrative', storage)?.model).toBe('narrative-model');
    expect(resolveApiConfigForTask('memorySummary', storage)?.model).toBe('fast-model');
    expect(resolveApiConfigForTask('embedding', storage)?.model).toBe('embedding-model');
  });

  it('upgrades legacy single-model profiles and string task routes without losing their model', () => {
    const storage = new MemoryStorage();
    storage.setItem('coc_v2_api_configs', JSON.stringify([
      {
        id: 'api_legacy',
        name: 'legacy endpoint',
        provider: 'openai_compatible',
        baseUrl: 'https://legacy.example.com/v1',
        apiKey: 'sk-legacy',
        model: 'legacy-model',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]));
    storage.setItem('coc_v2_api_task_routes', JSON.stringify({
      mainNarrative: 'api_legacy',
      memorySummary: 'api_legacy',
    }));

    const [profile] = listApiConfigs(storage);
    expect(getApiConfigModels(profile)).toEqual(['legacy-model']);
    expect(getApiTaskRoutes(storage).mainNarrative).toEqual({
      configId: 'api_legacy',
      model: 'legacy-model',
    });
    expect(resolveApiConfigForTask('memorySummary', storage)?.model).toBe('legacy-model');
  });

  it('falls back to the first available model when a routed model is removed from its profile', () => {
    const storage = new MemoryStorage();
    const saved = upsertApiConfig({
      ...createApiConfigDraft('openai_compatible'),
      name: 'shared endpoint',
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      model: 'narrative-model',
      models: ['narrative-model', 'fast-model'],
    }, storage);
    setApiTaskRoute('memorySummary', { configId: saved.id, model: 'fast-model' }, storage);

    upsertApiConfig({
      ...saved,
      model: 'narrative-model',
      models: ['narrative-model'],
    }, storage);

    expect(getApiTaskRoutes(storage).memorySummary).toEqual({
      configId: saved.id,
      model: 'narrative-model',
    });
    expect(resolveApiConfigForTask('memorySummary', storage)?.model).toBe('narrative-model');
  });
});
