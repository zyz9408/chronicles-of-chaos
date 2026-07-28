import { describe, expect, it } from 'vitest';
import {
  AUTO_SAVE_INTERVAL_TURNS_KEY,
  AUTO_SAVE_LIMIT_KEY,
  DEFAULT_AUTO_SAVE_INTERVAL_TURNS,
  DEFAULT_AUTO_SAVE_LIMIT,
  loadAutoSaveIntervalTurnsFromStorage,
  loadAutoSaveLimitFromStorage,
  normalizeAutoSaveIntervalTurns,
  normalizeAutoSaveLimit,
  saveAutoSaveIntervalTurnsToStorage,
  saveAutoSaveLimitToStorage,
} from './SaveSettings';

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe('SaveSettings', () => {
  it('uses COPV2-compatible defaults and clamps invalid values', () => {
    expect(normalizeAutoSaveLimit(undefined)).toBe(DEFAULT_AUTO_SAVE_LIMIT);
    expect(normalizeAutoSaveLimit(0)).toBe(1);
    expect(normalizeAutoSaveLimit(999)).toBe(100);
    expect(normalizeAutoSaveIntervalTurns(undefined)).toBe(DEFAULT_AUTO_SAVE_INTERVAL_TURNS);
    expect(normalizeAutoSaveIntervalTurns(0)).toBe(1);
    expect(normalizeAutoSaveIntervalTurns(999)).toBe(50);
  });

  it('round-trips both preferences through storage', () => {
    const storage = createStorage();

    expect(saveAutoSaveLimitToStorage('12', storage)).toBe(12);
    expect(saveAutoSaveIntervalTurnsToStorage('3', storage)).toBe(3);
    expect(storage.values.get(AUTO_SAVE_LIMIT_KEY)).toBe('12');
    expect(storage.values.get(AUTO_SAVE_INTERVAL_TURNS_KEY)).toBe('3');
    expect(loadAutoSaveLimitFromStorage(storage)).toBe(12);
    expect(loadAutoSaveIntervalTurnsFromStorage(storage)).toBe(3);
  });
});
