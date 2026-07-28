import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NPC_SIMULATION_SETTINGS,
  loadNpcSimulationSettings,
  saveNpcSimulationSettings,
} from './NpcSimulationSettings';

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

describe('NpcSimulationSettings', () => {
  it('loads conservative defaults for optional NPC dynamic simulation', () => {
    const storage = new MemoryStorage();

    expect(loadNpcSimulationSettings(storage)).toEqual(DEFAULT_NPC_SIMULATION_SETTINGS);
  });

  it('saves enabled state and clamps the maximum NPC batch size', () => {
    const storage = new MemoryStorage();

    expect(saveNpcSimulationSettings({ enabled: false, maxNpcCount: 99 }, storage)).toEqual({
      enabled: false,
      maxNpcCount: 12,
    });
    expect(loadNpcSimulationSettings(storage)).toEqual({
      enabled: false,
      maxNpcCount: 12,
    });
  });
});
