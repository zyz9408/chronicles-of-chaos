import { describe, expect, it } from 'vitest';
import { getPromptOverride, savePromptOverride } from './PromptOverrideStore';
import { getPromptRegistry, isRuntimeOverridePromptEntry } from './PromptRegistry';
import {
  PROMPT_OVERRIDES_EXPORT_TYPE,
  buildPromptOverridesExport,
  importPromptOverridesFromJson,
} from './PromptImportExport';

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

describe('PromptImportExport', () => {
  it('exports current runtime prompt contents even when there are no overrides', () => {
    const storage = new MemoryStorage();

    const exported = buildPromptOverridesExport(storage);
    const runtimePromptIds = getPromptRegistry()
      .filter(isRuntimeOverridePromptEntry)
      .map((entry) => entry.id)
      .sort();
    const exportedPromptIds = exported.prompts.map((prompt) => prompt.promptId).sort();
    const json = JSON.stringify(exported);

    expect(exportedPromptIds).toEqual(runtimePromptIds);
    expect(exported.prompts.find((prompt) => prompt.promptId === 'worldbook.toneGuide')?.content.trim()).not.toBe('');
    expect(json.length).toBeGreaterThan(1000);
    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('sk-');
  });

  it('exports prompt overrides and no API keys, API configs, or save data', () => {
    const storage = new MemoryStorage();
    savePromptOverride('worldbook.toneGuide', 'custom tone guide content', storage);

    const exported = buildPromptOverridesExport(storage);
    const json = JSON.stringify(exported);

    expect(exported).toMatchObject({
      type: PROMPT_OVERRIDES_EXPORT_TYPE,
      version: 1,
      overrides: [
        {
          promptId: 'worldbook.toneGuide',
          content: 'custom tone guide content',
        },
      ],
    });
    expect(exported.prompts.find((prompt) => prompt.promptId === 'worldbook.toneGuide')).toMatchObject({
      promptId: 'worldbook.toneGuide',
      content: 'custom tone guide content',
      source: 'override',
    });
    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('sk-');
    expect(json).not.toContain('threeKingdomsPrompts');
  });

  it('imports valid JSON by replacing all existing overrides', () => {
    const storage = new MemoryStorage();
    savePromptOverride('worldbook.toneGuide', 'old tone guide content', storage);

    const result = importPromptOverridesFromJson(JSON.stringify({
      type: PROMPT_OVERRIDES_EXPORT_TYPE,
      version: 1,
      overrides: [
        { promptId: 'main.userPrompt', content: 'custom imported user protocol content' },
      ],
    }), storage);

    expect(result.importedCount).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(result.hasHighRiskOverrides).toBe(true);
    expect(getPromptOverride('worldbook.toneGuide', storage)).toBeNull();
    expect(getPromptOverride('main.userPrompt', storage)?.content).toBe('custom imported user protocol content');
  });

  it('skips unknown promptIds and reports them without failing the whole import', () => {
    const storage = new MemoryStorage();

    const result = importPromptOverridesFromJson(JSON.stringify({
      type: PROMPT_OVERRIDES_EXPORT_TYPE,
      version: 1,
      overrides: [
        { promptId: 'unknown.prompt', content: 'unknown content that should be skipped' },
        { promptId: 'worldbook.toneGuide', content: 'valid imported tone guide content' },
      ],
    }), storage);

    expect(result.importedCount).toBe(1);
    expect(result.skipped).toEqual([
      { promptId: 'unknown.prompt', reason: 'unknown promptId' },
    ]);
    expect(getPromptOverride('worldbook.toneGuide', storage)?.content).toBe('valid imported tone guide content');
  });

  it('imports full prompt exports as overrides only when content differs from the local default', () => {
    const sourceStorage = new MemoryStorage();
    savePromptOverride('worldbook.toneGuide', 'custom exported tone guide content', sourceStorage);
    const exported = buildPromptOverridesExport(sourceStorage);
    const targetStorage = new MemoryStorage();

    const result = importPromptOverridesFromJson(JSON.stringify(exported), targetStorage);

    expect(result.ok).toBe(true);
    expect(result.importedCount).toBe(1);
    expect(result.hasHighRiskOverrides).toBe(false);
    expect(getPromptOverride('worldbook.toneGuide', targetStorage)?.content).toBe('custom exported tone guide content');
    expect(getPromptOverride('worldbook.narrativeBaseline', targetStorage)).toBeNull();
  });

  it('does not destroy existing overrides when importing invalid JSON', () => {
    const storage = new MemoryStorage();
    savePromptOverride('worldbook.toneGuide', 'existing tone guide content', storage);

    const result = importPromptOverridesFromJson('{ invalid json', storage);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('无法解析');
    expect(getPromptOverride('worldbook.toneGuide', storage)?.content).toBe('existing tone guide content');
  });
});
