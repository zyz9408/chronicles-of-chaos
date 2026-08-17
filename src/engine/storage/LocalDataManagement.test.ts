import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { idbGetAll, idbPut, resetLocalDatabaseForTests } from './IndexedDbStore';
import {
  clearLocalData,
  clearPreferenceData,
  listPreferenceKeysToRemove,
} from './LocalDataManagement';

class MemoryStorage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('LocalDataManagement', () => {
  beforeEach(async () => {
    await resetLocalDatabaseForTests();
  });

  it('only selects owned preference and custom-opening keys', () => {
    const storage = new MemoryStorage();
    storage.setItem('coc_v2_render_depth', '20');
    storage.setItem('coc_v2_narrative_length_retry_enabled', '0');
    storage.setItem('coc_v2_changelog_daily_view', '{}');
    storage.setItem('coc_v2_tavern_settings', '{}');
    storage.setItem('coc_v2_persistent_prompts', '[]');
    storage.setItem('coc_v2_opening_character_templates', '[]');
    storage.setItem('coc-v2:opening-custom-options:threeKingdoms', '{}');
    storage.setItem('unrelated-app-token', 'keep');

    const keys = listPreferenceKeysToRemove(storage);
    expect(keys).toContain('coc_v2_render_depth');
    expect(keys).toContain('coc_v2_narrative_length_retry_enabled');
    expect(keys).toContain('coc_v2_changelog_daily_view');
    expect(keys).toContain('coc_v2_persistent_prompts');
    expect(keys).toContain('coc_v2_tavern_settings');
    expect(keys).toContain('coc_v2_opening_character_templates');
    expect(keys).toContain('coc-v2:opening-custom-options:threeKingdoms');
    expect(keys).not.toContain('unrelated-app-token');

    clearPreferenceData(storage);
    expect(storage.getItem('unrelated-app-token')).toBe('keep');
    expect(storage.getItem('coc_v2_render_depth')).toBeNull();
    expect(storage.getItem('coc_v2_narrative_length_retry_enabled')).toBeNull();
    expect(storage.getItem('coc_v2_persistent_prompts')).toBeNull();
    expect(storage.getItem('coc_v2_tavern_settings')).toBeNull();
    expect(storage.getItem('coc_v2_opening_character_templates')).toBeNull();
  });

  it('clears caches without touching API configurations', async () => {
    await idbPut('memoryEmbeddingIndexes', { id: 'world', vectors: [] });
    await idbPut('apiConfigs', { id: 'api', name: '保留接口' });

    await clearLocalData('cache');

    expect(await idbGetAll('memoryEmbeddingIndexes')).toEqual([]);
    expect(await idbGetAll('apiConfigs')).toEqual([{ id: 'api', name: '保留接口' }]);
  });

  it('supports a full reset that preserves API settings', async () => {
    const storage = new MemoryStorage();
    storage.setItem('coc_v2_render_depth', '18');
    await idbPut('saves', { id: 'save', label: '待清理存档' });
    await idbPut('saveSummaries', { id: 'save', label: '待清理摘要' });
    await idbPut('memoryEmbeddingIndexes', { id: 'world', vectors: [] });
    await idbPut('apiConfigs', { id: 'api', name: '保留接口' });

    await clearLocalData('allExceptApi', storage);

    expect(await idbGetAll('saves')).toEqual([]);
    expect(await idbGetAll('saveSummaries')).toEqual([]);
    expect(await idbGetAll('memoryEmbeddingIndexes')).toEqual([]);
    expect(await idbGetAll('apiConfigs')).toEqual([{ id: 'api', name: '保留接口' }]);
    expect(storage.getItem('coc_v2_render_depth')).toBeNull();
  });

  it('only clears API configurations in the explicitly destructive all-data scope', async () => {
    const storage = new MemoryStorage();
    await idbPut('apiConfigs', { id: 'api', name: '待清理接口' });

    await clearLocalData('all', storage);

    expect(await idbGetAll('apiConfigs')).toEqual([]);
  });
});
