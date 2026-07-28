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
    expect(getFunctionConfigPanel('npcProfile')?.routeTaskIds).toEqual(['npcCompletion']);
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

  it('hides unused or future routes instead of showing them in the crowded API page', () => {
    expect(getHiddenRouteTaskIds()).toEqual(['quickInteraction', 'worldEvolution', 'imagePrompt']);
    expect(FUNCTION_CONFIG_PANELS.flatMap((panel) => panel.routeTaskIds)).not.toContain('quickInteraction');
    expect(FUNCTION_CONFIG_PANELS.flatMap((panel) => panel.routeTaskIds)).not.toContain('worldEvolution');
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

  it('exposes adult intimacy style as a game setting', () => {
    const controls = getGameSettingsControls() as Array<{
      id: string;
      type: string;
      label: string;
      description: string;
      defaultValue?: string;
      options?: Array<{ value: string; label: string; description: string }>;
    }>;
    const control = controls.find((item) => item.id === 'adultIntimacyStyle');

    expect(control).toMatchObject({
      id: 'adultIntimacyStyle',
      type: 'select',
      label: '成人描写风格',
      defaultValue: 'relationshipImmersion',
    });
    expect(control?.description).toContain('只影响已通过门禁的成人内容');
    expect(control?.options?.map((option) => option.value)).toEqual(['relationshipImmersion', 'directRealism']);
    expect(control?.options?.map((option) => option.label)).toEqual(['关系沉浸', '直白写实']);
    expect(control?.options?.find((option) => option.value === 'relationshipImmersion')?.description)
      .toContain('具体部位和动作仍使用直白词汇，不使用委婉比喻');
    expect(control?.options?.find((option) => option.value === 'directRealism')?.description)
      .toContain('禁止用比喻或含蓄代称遮蔽具体部位和动作');
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
