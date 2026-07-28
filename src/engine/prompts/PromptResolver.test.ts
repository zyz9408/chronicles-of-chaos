import { describe, expect, it } from 'vitest';
import { clearPromptOverrides, deletePromptOverride, savePromptOverride } from './PromptOverrideStore';
import { resolvePromptContent } from './PromptResolver';

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

describe('PromptResolver', () => {
  it('returns default content when no override exists', () => {
    const storage = new MemoryStorage();

    expect(resolvePromptContent('worldbook.toneGuide', 'default tone guide', storage)).toBe('default tone guide');
  });

  it('returns the user override after saving and falls back after deletion', () => {
    const storage = new MemoryStorage();

    savePromptOverride('worldbook.toneGuide', 'custom tone guide content', storage);

    expect(resolvePromptContent('worldbook.toneGuide', 'default tone guide', storage)).toBe('custom tone guide content');

    deletePromptOverride('worldbook.toneGuide', storage);

    expect(resolvePromptContent('worldbook.toneGuide', 'default tone guide', storage)).toBe('default tone guide');
  });

  it('returns high-risk overrides and falls back after clearing all overrides', () => {
    const storage = new MemoryStorage();

    savePromptOverride('main.userPrompt', 'custom high risk protocol content', storage);

    expect(resolvePromptContent('main.userPrompt', 'default protocol', storage)).toBe('custom high risk protocol content');

    clearPromptOverrides(storage);

    expect(resolvePromptContent('main.userPrompt', 'default protocol', storage)).toBe('default protocol');
  });
});
