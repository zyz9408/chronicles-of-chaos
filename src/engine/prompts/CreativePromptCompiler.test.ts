import { describe, expect, it } from 'vitest';
import { compileCreativePromptMessages } from './CreativePromptCompiler';
import {
  createDefaultTavernManagementSettings,
  getTavernSlotKey,
  importTavernPreset,
} from './TavernPresetStore';

const fixture = JSON.stringify({
  prompts: [
    { identifier: 'style', name: '酒馆主文风', role: 'system', content: '使用鲜明、强烈的文风标记。' },
    { identifier: 'user-example', role: 'user', content: '示例问题' },
    { identifier: 'assistant-example', role: 'assistant', content: '示例回答' },
  ],
  prompt_order: [{
    character_id: 100001,
    order: [
      { identifier: 'style', enabled: true },
      { identifier: 'user-example', enabled: true },
      { identifier: 'assistant-example', enabled: true },
    ],
  }],
});

describe('CreativePromptCompiler', () => {
  it('places the enabled tavern style after the core system contract and keeps runtime context last', () => {
    const entry = importTavernPreset(fixture, '高优先级预设.json').entry;
    entry.customization.itemOverrides[getTavernSlotKey(2, 'assistant-example')] = {
      assistantHandling: 'few_shot',
    };
    const settings = {
      ...createDefaultTavernManagementSettings(),
      enabled: true,
      activePresetId: entry.id,
      entries: [entry],
      customCot: {
        enabled: true,
        scope: 'all' as const,
        templateId: 'custom' as const,
        content: '先规划人物动机。',
      },
    };
    const compiled = compileCreativePromptMessages({
      systemPrompt: '硬协议：只返回合法 JSON。',
      runtimeUserMessage: '当前本局事实与玩家行动。',
      scope: 'turn',
      settings,
    });
    expect(compiled.messages.map((item) => item.role)).toEqual([
      'system',
      'system',
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(compiled.messages[0].content).toContain('只返回合法 JSON');
    expect(compiled.messages[2].content).toContain('以下酒馆预设是本次正文的主要创作');
    expect(compiled.messages[2].content).toContain('强烈的文风标记');
    expect(compiled.messages[compiled.messages.length - 1]?.content).toBe('当前本局事实与玩家行动。');
  });

  it('does not inject out-of-scope CoT or a disabled preset', () => {
    const settings = {
      ...createDefaultTavernManagementSettings(),
      customCot: {
        enabled: true,
        scope: 'opening' as const,
        templateId: 'custom' as const,
        content: '只用于开局。',
      },
    };
    const compiled = compileCreativePromptMessages({
      systemPrompt: '系统',
      runtimeUserMessage: '回合',
      scope: 'turn',
      settings,
    });
    expect(compiled.customCotIncluded).toBe(false);
    expect(compiled.messages).toEqual([
      { role: 'system', content: '系统' },
      { role: 'user', content: '回合' },
    ]);
  });
});
