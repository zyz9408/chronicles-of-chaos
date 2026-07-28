import { describe, expect, it } from 'vitest';
import {
  MAX_PERSISTENT_PROMPT_LENGTH,
  PERSISTENT_PROMPTS_STORAGE_KEY,
  composePersistentPromptGuide,
  loadPersistentPromptsFromStorage,
  normalizePersistentPrompts,
  savePersistentPromptsToStorage,
} from './PersistentPromptStore';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('PersistentPromptStore', () => {
  it('normalizes malformed entries, duplicate IDs, and overlong content', () => {
    const entries = normalizePersistentPrompts([
      { id: 'style', content: '  多写人物反应  ', enabled: true },
      { id: 'style', content: '重复项', enabled: true },
      { content: 'x'.repeat(MAX_PERSISTENT_PROMPT_LENGTH + 20) },
      { content: '   ' },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ id: 'style', content: '多写人物反应', enabled: true });
    expect(entries[1]?.content).toHaveLength(MAX_PERSISTENT_PROMPT_LENGTH);
    expect(entries[1]?.enabled).toBe(true);
  });

  it('persists the shared prompt list', () => {
    const storage = new MemoryStorage();
    savePersistentPromptsToStorage([
      { id: 'one', content: '少用八股套话', enabled: false },
    ], storage);

    expect(storage.getItem(PERSISTENT_PROMPTS_STORAGE_KEY)).toContain('少用八股套话');
    expect(loadPersistentPromptsFromStorage(storage)).toEqual([
      { id: 'one', content: '少用八股套话', enabled: false },
    ]);
  });

  it('injects enabled prompts only and preserves the fact-layer boundary', () => {
    const guide = composePersistentPromptGuide([
      { id: 'one', content: '对话更有历史人物个性', enabled: true },
      { id: 'two', content: '强制我本回合前往许昌', enabled: false },
    ]);

    expect(guide).toContain('对话更有历史人物个性');
    expect(guide).not.toContain('强制我本回合前往许昌');
    expect(guide).toContain('不是本回合行动');
    expect(guide).toContain('不得覆盖本局存档事实');
    expect(guide).toContain('不得把这些提示词本身写入玩家记忆');
  });
});
