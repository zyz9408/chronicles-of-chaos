import { describe, expect, it } from 'vitest';
import {
  FUNCTION_CONFIG_PANELS,
  getApiConfigRouteTaskIds,
  getFunctionConfigPanel,
  getInlineApiCancelState,
  getInlineApiSaveState,
  getHiddenRouteTaskIds,
  getGameSettingsControls,
  getSettingsNavItems,
} from './settingsPanelModel';

describe('settingsPanelModel', () => {
  it('keeps the API config page focused on the main narrative route', () => {
    expect(getApiConfigRouteTaskIds()).toEqual(['mainNarrative']);
  });

  it('puts common settings before AI configuration and advanced tools', () => {
    const navItems = getSettingsNavItems();

    expect(navItems.map((item) => item.label)).toEqual([
      '游戏设定',
      '阅读与动效',
      '存档管理',
      '变量管理',
      '数据管理',
      'API 配置',
      '功能配置',
      '酒馆预设与 CoT',
      '提示词管理',
      'Token 估算',
    ]);
    expect(navItems.map((item) => item.group)).toEqual([
      'common',
      'common',
      'common',
      'common',
      'common',
      'ai',
      'ai',
      'ai',
      'tools',
      'tools',
    ]);
    expect(navItems.find((item) => item.tab === 'promptRegistry')).toMatchObject({
      label: '提示词管理',
      disabled: false,
    });
    expect(navItems.find((item) => item.tab === 'save')).toMatchObject({
      label: '存档管理',
      disabled: false,
    });
    expect(navItems.find((item) => item.tab === 'variables')).toMatchObject({
      label: '变量管理',
      disabled: false,
    });
  });

  it('adds token estimate as a standalone settings entry directly after prompt registry', () => {
    const navItems = getSettingsNavItems();
    const promptRegistryIndex = navItems.findIndex((item) => item.tab === 'promptRegistry');
    const tokenEstimateIndex = navItems.findIndex((item) => item.tab === 'promptTokenEstimate');

    expect(promptRegistryIndex).toBeGreaterThanOrEqual(0);
    expect(tokenEstimateIndex).toBe(promptRegistryIndex + 1);
    expect(navItems[tokenEstimateIndex]).toMatchObject({
      label: 'Token 估算',
      disabled: false,
    });
  });

  it('moves feature-specific API routes into their own feature config panels', () => {
    expect(getFunctionConfigPanel('memory')?.routeTaskIds).toEqual(['memorySummary']);
    expect(getFunctionConfigPanel('vector')?.routeTaskIds).toEqual(['embedding']);
    expect(getFunctionConfigPanel('npcProfile')?.routeTaskIds).toEqual([
      'npcCompletion',
      'npcCompletionFallback',
    ]);
    expect(getFunctionConfigPanel('stateWriteback')?.routeTaskIds).toEqual([
      'stateWriteback',
      'stateWritebackFallback',
    ]);
  });

  it('describes memory config as story and protagonist memory, not NPC-only memory', () => {
    const memoryPanel = getFunctionConfigPanel('memory');

    expect(memoryPanel?.description).toContain('正文剧情');
    expect(memoryPanel?.description).toContain('主角经历');
    expect(memoryPanel?.description).toContain('NPC');
  });

  it('keeps NPC dynamic simulation separate from NPC profile generation', () => {
    const npcSimulation = getFunctionConfigPanel('npcSimulation');
    const npcProfile = getFunctionConfigPanel('npcProfile');

    expect(npcSimulation?.routeTaskIds).toEqual(['npcSimulation']);
    expect(npcSimulation?.status).toBe('active');
    expect(npcProfile?.routeTaskIds).not.toContain('npcSimulation');
  });

  it('exposes the active world evolution route and hides only unused routes', () => {
    expect(getHiddenRouteTaskIds()).toEqual(['quickInteraction', 'imagePrompt']);
    expect(FUNCTION_CONFIG_PANELS.flatMap((panel) => panel.routeTaskIds)).not.toContain('quickInteraction');
    expect(getFunctionConfigPanel('worldEvolution')?.routeTaskIds).toEqual(['worldEvolution']);
    expect(getFunctionConfigPanel('worldEvolution')?.description).toContain('独立于当前回合 NPC 反应模拟');
    expect(FUNCTION_CONFIG_PANELS.flatMap((panel) => panel.routeTaskIds)).not.toContain('imagePrompt');
  });

  it('closes the inline API editor after saving from a feature config page and shows a shared-management notice', () => {
    expect(getInlineApiSaveState()).toEqual({
      inlineApiEditorFor: null,
      notice: 'API 已保存在 API 配置中统一管理。',
    });
  });

  it('closes the inline API editor without a notice when the user cancels', () => {
    expect(getInlineApiCancelState()).toEqual({
      inlineApiEditorFor: null,
      notice: '',
    });
  });

  it('exposes the NPC archive activity hint toggle as a game setting', () => {
    expect(getGameSettingsControls()).toContainEqual({
      id: 'npcPresenceHints',
      type: 'toggle',
      label: '人物志近况提示',
      description: 'NPC 有新的远场近况时，在人物志列表显示红点并临时置顶；关闭后只隐藏提示，不删除近况记录。',
      defaultEnabled: true,
    });
  });

  it('exposes narrative length as a standard game setting', () => {
    const control = getGameSettingsControls().find((item) => item.id === 'narrativeLength') as
      | { defaultValue: string; description: string; options: Array<{ value: string; wordCountHint: string; description: string }> }
      | undefined;

    expect(control?.defaultValue).toBe('standard');
    expect(control?.options.map((option) => option.value)).toEqual(['compact', 'standard', 'rich', 'long']);
    expect(control?.description).toContain('目标字数');
    expect(control?.options.map((option) => option.wordCountHint)).toEqual([
      '约 300-600 字',
      '约 600-1000 字',
      '约 1000-1600 字',
      '约 1600-2400 字',
    ]);
    expect(control?.options.find((option) => option.value === 'standard')?.description).toContain('约 600-1000 字');
  });

  it('exposes narrative length retry as a separate enabled-by-default toggle', () => {
    expect(getGameSettingsControls()).toContainEqual({
      id: 'narrativeLengthRetry',
      type: 'toggle',
      label: '字数不足时自动重写',
      description: expect.stringContaining('目标下限的 90%'),
      defaultEnabled: true,
    });
  });

  it('exposes pregnancy and child continuation without adding a separate management system', () => {
    const controls = getGameSettingsControls() as Array<{
      id: string;
      type: string;
      label: string;
      description: string;
      defaultValue?: string;
      options?: Array<{ value: string; label: string; description: string }>;
    }>;
    const control = controls.find((item) => item.id === 'pregnancyMode');

    expect(control).toMatchObject({
      id: 'pregnancyMode',
      type: 'select',
      label: '怀孕与子嗣承接',
      defaultValue: 'standard',
    });
    expect(control?.options?.map((option) => option.value)).toEqual(['off', 'low', 'standard', 'high']);
    expect(control?.description).toContain('读档和重试不会重掷');
    expect(control?.options?.find((option) => option.value === 'off')?.description).toContain('既有孕期仍会');
  });
});
