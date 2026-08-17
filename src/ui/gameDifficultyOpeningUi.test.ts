import { describe, expect, it } from 'vitest';
import startScreenSource from './StartScreen.tsx?raw';
import settingsSource from './ApiSettingsPanel.tsx?raw';

describe('current-save difficulty UI wiring', () => {
  it('places five difficulty cards on opening step six and persists the selection into opening state', () => {
    expect(startScreenSource).toContain('step === 6');
    expect(startScreenSource).toContain('选择本局难度');
    expect(startScreenSource).toContain('gameDifficultyProfiles.map');
    expect(startScreenSource).toContain('gameDifficulty,');
    expect(startScreenSource).toContain('combatDifficultyProfiles.map');
    expect(startScreenSource).toContain('warDifficultyProfiles.map');
    expect(startScreenSource).toContain('combatDifficulty,');
    expect(startScreenSource).toContain('warDifficulty,');
    expect(startScreenSource).toContain('本局难度：');
    expect(startScreenSource).toContain('个人战斗难度：');
    expect(startScreenSource).toContain('战争难度：');
  });

  it('updates only the active runtime state and current save from game settings', () => {
    expect(settingsSource).toContain('applyGameDifficultyToRuntimeState(runtimeState, nextDifficulty)');
    expect(settingsSource).toContain("applyCombatDifficultyToRuntimeState(runtimeState, nextDifficulty)");
    expect(settingsSource).toContain("applyWarDifficultyToRuntimeState(runtimeState, nextDifficulty)");
    expect(settingsSource).toContain('persistState(saveId, nextState)');
    expect(settingsSource).toContain("if (!saved) throw new Error('当前存档不存在或已被移除')");
    expect(settingsSource).not.toContain('saveGameDifficultyToStorage');
    expect(settingsSource).not.toContain('localStorage.setItem');
  });
});
