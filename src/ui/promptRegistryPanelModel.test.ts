import { describe, expect, it } from 'vitest';
import { getPromptRegistry } from '../engine/prompts/PromptRegistry';
import { savePromptOverride } from '../engine/prompts/PromptOverrideStore';
import {
  getEditLevelLabel,
  getPromptCategoryLabel,
  getPromptEntryDisplayModel,
  getPromptRegistryCategorySummaries,
  getPromptRegistryEntriesByCategory,
  getPromptRegistryGlobalActionLabels,
  getRiskLevelLabel,
  isPromptEntryEditable,
} from './promptRegistryPanelModel';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('promptRegistryPanelModel', () => {
  it('builds category summaries from getPromptRegistry data', () => {
    const summaries = getPromptRegistryCategorySummaries();
    const registry = getPromptRegistry();

    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries.reduce((total, summary) => total + summary.totalCount, 0)).toBe(registry.length);
    expect(summaries.find((summary) => summary.category === 'main.userProtocol')).toMatchObject({
      label: '主剧情 / 主回合协议',
      highCount: expect.any(Number),
      lockedCount: expect.any(Number),
    });
  });

  it('groups entries by category without duplicating registry data in the UI layer', () => {
    const entries = getPromptRegistryEntriesByCategory('femaleProfile.writeback');

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.category === 'femaleProfile.writeback')).toBe(true);
    expect(entries.some((entry) => entry.id === 'femaleProfile.writebackProtocol')).toBe(true);
  });

  it('maps category, risk, and edit levels to Chinese display labels', () => {
    expect(getPromptCategoryLabel('opening.trueOpening')).toBe('真开局');
    expect(getPromptCategoryLabel('femaleProfile.writeback')).toBe('女性档案写回');
    expect(getPromptCategoryLabel('main.narrativeStyle')).toBe('主剧情 / 正文文风');
    expect(getRiskLevelLabel('high')).toBe('高风险');
    expect(getEditLevelLabel('locked')).toBe('协议锁定');
  });

  it('builds user-facing display models with Chinese titles and readable content', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'worldbook.toneGuide');
    expect(entry).toBeTruthy();

    const model = getPromptEntryDisplayModel(entry!);

    expect(model.displayTitle).toBe('【叙事风格】三国乱世基调');
    expect(model.userDescription).toContain('文风');
    expect(model.contentText.trim()).not.toBe('');
    expect(model.contentViewType).toBe('fullText');
  });

  it('marks low and medium runtime prompts editable by default and keeps locked prompts read-only', () => {
    const registry = getPromptRegistry();
    const narrativeBaseline = registry.find((item) => item.id === 'worldbook.narrativeBaseline');
    const toneGuide = registry.find((item) => item.id === 'worldbook.toneGuide');
    const systemPrompt = registry.find((item) => item.id === 'main.systemPrompt');
    const lockedPrompt = registry.find((item) => item.id === 'main.userPrompt');

    expect(isPromptEntryEditable(narrativeBaseline!)).toBe(true);
    expect(isPromptEntryEditable(toneGuide!)).toBe(true);
    expect(isPromptEntryEditable(systemPrompt!)).toBe(true);
    expect(isPromptEntryEditable(lockedPrompt!)).toBe(false);
  });

  it('allows high-risk protocol prompts only when high-risk editing is enabled', () => {
    const lockedPrompt = getPromptRegistry().find((item) => item.id === 'main.userPrompt');
    expect(lockedPrompt).toBeTruthy();

    expect(isPromptEntryEditable(lockedPrompt!, { allowHighRiskEditing: false })).toBe(false);
    expect(isPromptEntryEditable(lockedPrompt!, { allowHighRiskEditing: true })).toBe(true);
  });

  it('keeps non-runtime metadata entries read-only even though they are low risk', () => {
    const settingsEntry = getPromptRegistry().find((item) => item.id === 'settings.apiTaskDescriptions');
    expect(settingsEntry).toBeTruthy();

    const model = getPromptEntryDisplayModel(settingsEntry!, { allowHighRiskEditing: true });

    expect(model.isEditable).toBe(false);
    expect(model.readonlyReason).toContain('非运行时');
  });

  it('shows the saved user toneGuide content in the display model', () => {
    const storage = new MemoryStorage();
    const entry = getPromptRegistry().find((item) => item.id === 'worldbook.toneGuide');
    expect(entry).toBeTruthy();

    savePromptOverride('worldbook.toneGuide', 'USER_TONE_GUIDE_PANEL_MODEL', storage);

    const model = getPromptEntryDisplayModel(entry!, { storage });

    expect(model.isEditable).toBe(true);
    expect(model.isCustomized).toBe(true);
    expect(model.contentText).toBe('USER_TONE_GUIDE_PANEL_MODEL');
  });

  it('shows customized high-risk entries as active but not editable while high-risk editing is closed', () => {
    const storage = new MemoryStorage();
    const entry = getPromptRegistry().find((item) => item.id === 'main.userPrompt');
    expect(entry).toBeTruthy();

    savePromptOverride('main.userPrompt', 'USER_HIGH_RISK_PROTOCOL_CONTENT', storage);

    const model = getPromptEntryDisplayModel(entry!, { storage, allowHighRiskEditing: false });

    expect(model.isCustomized).toBe(true);
    expect(model.isEditable).toBe(false);
    expect(model.contentText).toBe('USER_HIGH_RISK_PROTOCOL_CONTENT');
    expect(model.readonlyReason).toContain('高风险');
  });

  it('shows placeholders for dynamic prompt templates', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'main.userPrompt');
    expect(entry).toBeTruthy();

    const model = getPromptEntryDisplayModel(entry!);

    expect(model.contentText).toContain('{playerInput}');
    expect(model.contentText).toContain('{npcContext}');
    expect(model.contentNotes).toContain('协议锁定');
  });

  it('exposes global prompt override actions', () => {
    expect(getPromptRegistryGlobalActionLabels()).toEqual([
      '高风险项编辑',
      '恢复全部默认',
      '导入提示词',
      '导出提示词',
    ]);
  });

  it('shows adult intimacy prompt content previews in prompt management', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'nsfw.adultIntimacy.commonProtocol');
    expect(entry).toBeTruthy();

    const model = getPromptEntryDisplayModel(entry!);

    expect(getPromptCategoryLabel('nsfw.adultIntimacy' as any)).toBe('成人亲密描写');
    expect(model.displayTitle).toBe('【成人亲密】通用描写协议');
    expect(model.displayCategory).toBe('成人亲密描写');
    expect(model.userDescription).toContain('已通过门禁');
    expect(model.contentText).toContain('不要淡出、不要空泛跳过');
    expect(model.contentPreview).toContain('成人亲密场景');
    expect(model.isEditable).toBe(true);
  });

  it('shows narrative prose style guide as editable prompt content', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'main.narrativeProseStyleGuide');
    expect(entry).toBeTruthy();

    const model = getPromptEntryDisplayModel(entry!);

    expect(model.displayTitle).toBe('【正文文风】普通正文描写指南');
    expect(model.displayCategory).toBe('主剧情 / 正文文风');
    expect(model.userDescription).toContain('改善普通正文');
    expect(model.contentText).toContain('只选一至两种最适合当前因果的推进方式');
    expect(model.contentText).toContain('不是词语黑名单');
    expect(model.contentPreview).toContain('正文单薄');
    expect(model.isEditable).toBe(true);
  });

  it('shows the same-generation prose final review as editable prompt content', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'main.narrativeProseFinalReview');
    expect(entry).toBeTruthy();

    const model = getPromptEntryDisplayModel(entry!);

    expect(model.displayTitle).toBe('【正文文风】提交前静默终检');
    expect(model.displayCategory).toBe('主剧情 / 正文文风');
    expect(model.userDescription).toContain('不增加第二次正文 API');
    expect(model.contentText).toContain('同一次主正文生成');
    expect(model.contentText).toContain('近期正文回放');
    expect(model.isEditable).toBe(true);
  });

  it('shows relationship thread projection guide as editable prompt content', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'main.relationshipThreadProjectionGuide');
    expect(entry).toBeTruthy();

    const model = getPromptEntryDisplayModel(entry!);

    expect(model.displayTitle).toBe('【关系线承接】红颜/羁绊投喂纪律');
    expect(model.displayCategory).toBe('主剧情 / 正文文风');
    expect(model.userDescription).toContain('红颜');
    expect(model.contentText).toContain('已成立长期关系线');
    expect(model.contentPreview).toContain('不是待生成任务池');
    expect(model.isEditable).toBe(true);
  });
});
