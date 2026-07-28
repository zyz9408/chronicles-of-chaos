import { describe, expect, it } from 'vitest';
import {
  PROMPT_OVERRIDE_STORAGE_KEY,
  clearPromptOverrides,
  deletePromptOverride,
  getPromptOverride,
  listPromptOverrides,
  savePromptOverride,
  validatePromptOverrideContent,
} from './PromptOverrideStore';

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

describe('PromptOverrideStore', () => {
  it('persists, reads, lists, and deletes prompt overrides without storing defaults', () => {
    const storage = new MemoryStorage();

    expect(getPromptOverride('worldbook.toneGuide', storage)).toBeNull();

    const saved = savePromptOverride('worldbook.toneGuide', '  custom tone guide content  ', storage);
    const highRiskSaved = savePromptOverride('main.userPrompt', 'custom high risk protocol content', storage);

    expect(saved.promptId).toBe('worldbook.toneGuide');
    expect(saved.content).toBe('custom tone guide content');
    expect(saved.version).toBe(1);
    expect(highRiskSaved.promptId).toBe('main.userPrompt');
    expect(highRiskSaved.version).toBe(1);
    expect(getPromptOverride('worldbook.toneGuide', storage)?.content).toBe('custom tone guide content');
    expect(getPromptOverride('main.userPrompt', storage)?.content).toBe('custom high risk protocol content');
    expect(listPromptOverrides(storage).map((override) => override.promptId).sort()).toEqual([
      'main.userPrompt',
      'worldbook.toneGuide',
    ]);
    expect(storage.getItem(PROMPT_OVERRIDE_STORAGE_KEY)).toContain('worldbook.toneGuide');
    expect(storage.getItem(PROMPT_OVERRIDE_STORAGE_KEY)).not.toContain('threeKingdomsPrompts.toneGuide');

    deletePromptOverride('worldbook.toneGuide', storage);

    expect(getPromptOverride('worldbook.toneGuide', storage)).toBeNull();
    expect(getPromptOverride('main.userPrompt', storage)?.content).toBe('custom high risk protocol content');
  });

  it('clears all prompt overrides', () => {
    const storage = new MemoryStorage();

    savePromptOverride('worldbook.toneGuide', 'custom tone guide content', storage);
    savePromptOverride('main.userPrompt', 'custom high risk protocol content', storage);

    clearPromptOverrides(storage);

    expect(listPromptOverrides(storage)).toEqual([]);
    expect(getPromptOverride('worldbook.toneGuide', storage)).toBeNull();
    expect(getPromptOverride('main.userPrompt', storage)).toBeNull();
  });

  it('rejects empty, too short, and too long prompt overrides', () => {
    const storage = new MemoryStorage();

    expect(validatePromptOverrideContent('     ').ok).toBe(false);
    expect(validatePromptOverrideContent('short').ok).toBe(false);
    expect(validatePromptOverrideContent('x'.repeat(12001)).ok).toBe(false);
    expect(() => savePromptOverride('worldbook.toneGuide', 'short', storage)).toThrow();
  });
});
