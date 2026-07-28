import { describe, expect, it } from 'vitest';
import {
  TAVERN_SETTINGS_STORAGE_KEY,
  clearTavernManagementSettings,
  createDefaultTavernManagementSettings,
  exportManagedTavernPreset,
  getTavernSlotKey,
  importTavernPreset,
  loadTavernManagementSettings,
  resolveEffectiveTavernPreset,
  saveTavernManagementSettings,
  type TavernSettingsStorage,
} from './TavernPresetStore';

function makeStorage(): TavernSettingsStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const fixture = JSON.stringify({
  temperature: 1.1,
  api_key: 'must-not-be-imported',
  prompts: [
    { identifier: 'style', name: '主文风', role: 'system', content: '采用凌厉、凝练的叙事。' },
    { identifier: 'worldInfoBefore', role: 'system', content: '不得重复注入的世界信息。' },
    { identifier: 'example-user', role: 'user', content: '{{user}}拔剑。' },
    { identifier: 'example-assistant', role: 'assistant', content: '兵刃出鞘，寒光照面。' },
  ],
  prompt_order: [{
    character_id: 100001,
    order: [
      { identifier: 'style', enabled: true },
      { identifier: 'worldInfoBefore', enabled: true },
      { identifier: 'example-user', enabled: true },
      { identifier: 'example-assistant', enabled: true },
    ],
  }],
});

describe('TavernPresetStore', () => {
  it('imports only prompt content and preserves role/order without connection settings', () => {
    const imported = importTavernPreset(fixture, '测试预设.json', '2026-07-25T12:00:00.000Z');
    expect(imported.repaired).toBe(false);
    expect(imported.entry.name).toBe('测试预设');
    expect(imported.entry.preset.prompts.map((item) => item.role)).toEqual([
      'system',
      'system',
      'user',
      'assistant',
    ]);
    expect(JSON.stringify(imported.entry)).not.toContain('must-not-be-imported');
    expect(JSON.stringify(imported.entry)).not.toContain('temperature');
  });

  it('repairs common malformed JSON', () => {
    const imported = importTavernPreset(fixture.replace(/}\s*$/, '},'), '修复测试.json');
    expect(imported.repaired).toBe(true);
    expect(imported.entry.preset.prompts).toHaveLength(4);
  });

  it('reserves runtime slots and requires explicit assistant handling', () => {
    const entry = importTavernPreset(fixture, '测试预设.json').entry;
    const settings = {
      ...createDefaultTavernManagementSettings(),
      enabled: true,
      activePresetId: entry.id,
      entries: [entry],
    };
    const initial = resolveEffectiveTavernPreset(settings, { scope: 'turn', playerName: '刘平' });
    expect(initial.items[0].status).toBe('included');
    expect(initial.items[1].status).toBe('reserved_runtime_slot');
    expect(initial.items[2].content).toContain('刘平');
    expect(initial.items[3].status).toBe('assistant_incompatible');

    entry.customization.itemOverrides[getTavernSlotKey(3, 'example-assistant')] = {
      assistantHandling: 'few_shot',
    };
    const enabled = resolveEffectiveTavernPreset(settings, { scope: 'turn', playerName: '刘平' });
    expect(enabled.items[3]).toMatchObject({ status: 'included', role: 'assistant' });
  });

  it('stores normalized settings independently from saves and can clear them', () => {
    const storage = makeStorage();
    const entry = importTavernPreset(fixture, '测试预设.json').entry;
    saveTavernManagementSettings({
      ...createDefaultTavernManagementSettings(),
      enabled: true,
      activePresetId: entry.id,
      entries: [entry],
      customCot: {
        enabled: true,
        scope: 'encounter',
        templateId: 'custom',
        content: '先核对封存战果。',
      },
    }, storage);
    expect(storage.getItem(TAVERN_SETTINGS_STORAGE_KEY)).toContain('先核对封存战果');
    expect(loadTavernManagementSettings(storage)).toMatchObject({
      enabled: true,
      customCot: { enabled: true, scope: 'encounter' },
    });
    clearTavernManagementSettings(storage);
    expect(loadTavernManagementSettings(storage)).toEqual(createDefaultTavernManagementSettings());
  });

  it('preserves local item editing and the selected order when an exported preset is imported again', () => {
    const entry = importTavernPreset(JSON.stringify({
      ...JSON.parse(fixture),
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'style', enabled: true },
            { identifier: 'example-user', enabled: true },
          ],
        },
        {
          character_id: 200002,
          order: [
            { identifier: 'example-user', enabled: true },
            { identifier: 'example-assistant', enabled: true },
          ],
        },
      ],
    }), '往返预设.json').entry;
    entry.selectedCharacterId = 200002;
    entry.customization.itemOverrides[getTavernSlotKey(0, 'example-user')] = {
      enabled: false,
      contentOverride: '本地改写后的示例问题。',
      scope: 'encounter',
    };
    entry.customization.itemOverrides[getTavernSlotKey(1, 'example-assistant')] = {
      assistantHandling: 'creative_rule',
    };

    const roundTripped = importTavernPreset(
      JSON.stringify(exportManagedTavernPreset(entry)),
      '往返预设-COC-V2.json',
    ).entry;

    expect(roundTripped.selectedCharacterId).toBe(200002);
    expect(roundTripped.customization).toEqual(entry.customization);
  });
});
