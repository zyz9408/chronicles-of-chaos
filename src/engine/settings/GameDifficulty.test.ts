import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import {
  applyCombatDifficultyToRuntimeState,
  applyGameDifficultyToRuntimeState,
  applyWarDifficultyToRuntimeState,
  combatDifficultyProfiles,
  formatGameDifficultyForPrompt,
  gameDifficultyProfiles,
  getGameDifficultyProfile,
  normalizeGameDifficulty,
  warDifficultyProfiles,
} from './GameDifficulty';

function state(): RuntimeState {
  return {
    engineVersion: '0.1.0',
    worldBookId: 'test',
    worldBookVersion: '1',
    worldBookSource: 'official',
    startDate: '公元189年01月01日',
    currentDate: '公元189年01月01日',
    player: {
      id: 'player',
      name: '刘平',
      roleType: '游侠',
      summary: '测试角色',
    },
    currentLocationId: 'loc_test',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
  };
}

describe('GameDifficulty', () => {
  it('defines the five agreed X/Y difficulty offsets and falls back to standard', () => {
    expect(gameDifficultyProfiles.map(({ id, difficultyOffset }) => ({
      id,
      difficultyOffset,
    }))).toEqual([
      { id: 'story', difficultyOffset: -10 },
      { id: 'easy', difficultyOffset: -5 },
      { id: 'standard', difficultyOffset: 0 },
      { id: 'hard', difficultyOffset: 5 },
      { id: 'brutal', difficultyOffset: 10 },
    ]);
    expect(normalizeGameDifficulty(undefined)).toBe('standard');
    expect(normalizeGameDifficulty('unknown')).toBe('standard');
    expect(getGameDifficultyProfile('standard').label).toBe('标准');
    expect(formatGameDifficultyForPrompt('story')).toBe('story/剧情/Y-10');
    expect(formatGameDifficultyForPrompt('hard')).toBe('hard/困难/Y+5');
  });

  it('defines five independent combat and war pressure profiles', () => {
    expect(combatDifficultyProfiles.map(({ id, playerPowerMultiplier }) => [id, playerPowerMultiplier]))
      .toEqual([
        ['story', 2],
        ['easy', 1.5],
        ['standard', 1],
        ['hard', 0.8],
        ['brutal', 0.5],
      ]);
    expect(warDifficultyProfiles.map(({ id, playerPowerMultiplier }) => [id, playerPowerMultiplier]))
      .toEqual(combatDifficultyProfiles.map(({ id, playerPowerMultiplier }) => [id, playerPowerMultiplier]));
  });

  it('changes only the supplied runtime state instead of creating a global preference', () => {
    const firstSave = state();
    const secondSave = state();
    const changed = applyGameDifficultyToRuntimeState(firstSave, 'brutal');

    expect(changed).not.toBe(firstSave);
    expect(changed.gameDifficulty).toBe('brutal');
    expect(firstSave.gameDifficulty).toBeUndefined();
    expect(secondSave.gameDifficulty).toBeUndefined();
  });

  it('changes combat and war difficulty independently on the supplied save', () => {
    const original = state();
    const combatChanged = applyCombatDifficultyToRuntimeState(original, 'easy');
    const warChanged = applyWarDifficultyToRuntimeState(combatChanged, 'brutal');

    expect(warChanged).toMatchObject({ combatDifficulty: 'easy', warDifficulty: 'brutal' });
    expect(warChanged.gameDifficulty).toBeUndefined();
    expect(original.combatDifficulty).toBeUndefined();
    expect(original.warDifficulty).toBeUndefined();
  });
});
