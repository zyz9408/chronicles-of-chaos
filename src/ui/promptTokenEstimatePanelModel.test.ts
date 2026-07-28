import { describe, expect, it } from 'vitest';
import { getPromptRegistry } from '../engine/prompts/PromptRegistry';
import { savePromptOverride } from '../engine/prompts/PromptOverrideStore';
import {
  getPromptTokenEstimatePanelModel,
  getPromptTokenEstimateRows,
} from './promptTokenEstimatePanelModel';

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

describe('promptTokenEstimatePanelModel', () => {
  it('uses default prompt content when no override exists', () => {
    const rows = getPromptTokenEstimateRows();
    const entry = getPromptRegistry().find((item) => item.id === 'worldbook.toneGuide');
    const row = rows.find((item) => item.promptId === 'worldbook.toneGuide');

    expect(entry?.defaultContent).toBeTruthy();
    expect(row).toMatchObject({
      promptId: 'worldbook.toneGuide',
      isCustomized: false,
      chars: Array.from(entry?.defaultContent ?? '').length,
    });
    expect(row?.estimatedTokens).toBeGreaterThan(0);
  });

  it('uses override content when a prompt is customized', () => {
    const storage = new MemoryStorage();
    const overrideText = 'OVERRIDE_TOKEN_ESTIMATE_CONTENT_乱世提示词估算';
    savePromptOverride('worldbook.toneGuide', overrideText, storage);

    const rows = getPromptTokenEstimateRows({ storage });
    const row = rows.find((item) => item.promptId === 'worldbook.toneGuide');

    expect(row).toMatchObject({
      promptId: 'worldbook.toneGuide',
      isCustomized: true,
      chars: Array.from(overrideText).length,
    });
  });

  it('builds category and total token statistics from effective rows', () => {
    const storage = new MemoryStorage();
    savePromptOverride('main.userPrompt', 'CUSTOM_HIGH_RISK_PROTOCOL_TOKEN_ESTIMATE_CONTENT', storage);

    const model = getPromptTokenEstimatePanelModel({ storage });
    const rowTokenTotal = model.rows.reduce((total, row) => total + row.estimatedTokens, 0);
    const categoryTokenTotal = model.categorySummaries.reduce((total, summary) => total + summary.estimatedTokens, 0);

    expect(model.effectiveTotals.estimatedTokens).toBe(rowTokenTotal);
    expect(categoryTokenTotal).toBe(rowTokenTotal);
    expect(model.customizedCount).toBe(1);
    expect(model.highRiskCustomizedCount).toBe(1);
    expect(model.categorySummaries.length).toBeGreaterThan(0);
  });

  it('marks high risk and locked prompt entries', () => {
    const rows = getPromptTokenEstimateRows();
    const mainUserPrompt = rows.find((item) => item.promptId === 'main.userPrompt');

    expect(mainUserPrompt).toMatchObject({
      riskLevel: 'high',
      editLevel: 'locked',
      isHighRisk: true,
      isLocked: true,
    });
  });
});
