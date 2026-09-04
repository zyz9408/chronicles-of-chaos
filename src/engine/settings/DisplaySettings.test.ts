import { describe, expect, it } from 'vitest';
import {
  GAME_RENDER_DEPTH_KEY,
  RENDER_DEPTH_MIGRATION_FLAG,
  GAME_SNAPSHOT_DEPTH_KEY,
  loadRenderDepthFromStorage,
  loadSnapshotDepthFromStorage,
  normalizeRenderDepth,
  normalizeSnapshotDepth,
  saveRenderDepthToStorage,
  saveSnapshotDepthToStorage,
  loadNpcPresenceHintsEnabledFromStorage,
  saveNpcPresenceHintsEnabledToStorage,
  NPC_PRESENCE_HINTS_ENABLED_KEY,
  DEFAULT_NARRATIVE_LENGTH,
  GAME_NARRATIVE_LENGTH_KEY,
  GAME_NARRATIVE_LENGTH_RETRY_ENABLED_KEY,
  loadNarrativeLengthFromStorage,
  loadNarrativeLengthRetryEnabledFromStorage,
  normalizeNarrativeLength,
  saveNarrativeLengthToStorage,
  saveNarrativeLengthRetryEnabledToStorage,
  DEFAULT_ADULT_INTIMACY_STYLE,
  GAME_ADULT_INTIMACY_STYLE_KEY,
  loadAdultIntimacyStyleFromStorage,
  normalizeAdultIntimacyStyle,
  saveAdultIntimacyStyleToStorage,
  DEFAULT_PREGNANCY_MODE,
  GAME_PREGNANCY_MODE_KEY,
  loadPregnancyModeFromStorage,
  normalizePregnancyMode,
  savePregnancyModeToStorage,
  DEFAULT_MOTION_PREFERENCE,
  DEFAULT_COLOR_THEME,
  GAME_COLOR_THEME_KEY,
  GAME_MOTION_PREFERENCE_KEY,
  GAME_NARRATIVE_FONT_SIZE_KEY,
  GAME_NARRATIVE_LINE_HEIGHT_KEY,
  loadMotionPreferenceFromStorage,
  loadColorThemeFromStorage,
  loadNarrativeFontSizeFromStorage,
  loadNarrativeLineHeightFromStorage,
  normalizeMotionPreference,
  normalizeColorTheme,
  normalizeNarrativeFontSize,
  normalizeNarrativeLineHeight,
  saveMotionPreferenceToStorage,
  saveColorThemeToStorage,
  saveNarrativeFontSizeToStorage,
  saveNarrativeLineHeightToStorage,
  DEFAULT_NARRATIVE_PRESENTATION,
  DEFAULT_AVG_PLAYER_PORTRAIT_MODE,
  GAME_NARRATIVE_PRESENTATION_KEY,
  GAME_AVG_PLAYER_PORTRAIT_MODE_KEY,
  loadNarrativePresentationFromStorage,
  loadAvgPlayerPortraitModeFromStorage,
  normalizeNarrativePresentation,
  normalizeAvgPlayerPortraitMode,
  saveNarrativePresentationToStorage,
  saveAvgPlayerPortraitModeToStorage,
} from './DisplaySettings';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('DisplaySettings', () => {
  it('normalizes and persists the v1.8.0 AVG presentation preferences', () => {
    const storage = new MemoryStorage();

    expect(normalizeNarrativePresentation('invalid')).toBe(DEFAULT_NARRATIVE_PRESENTATION);
    expect(loadNarrativePresentationFromStorage(storage)).toBe('auto');
    expect(saveNarrativePresentationToStorage('avg', storage)).toBe('avg');
    expect(storage.getItem(GAME_NARRATIVE_PRESENTATION_KEY)).toBe('avg');

    expect(normalizeAvgPlayerPortraitMode('invalid')).toBe(DEFAULT_AVG_PLAYER_PORTRAIT_MODE);
    expect(loadAvgPlayerPortraitModeFromStorage(storage)).toBe('hidden');
    expect(saveAvgPlayerPortraitModeToStorage('show', storage)).toBe('show');
    expect(storage.getItem(GAME_AVG_PLAYER_PORTRAIT_MODE_KEY)).toBe('show');
  });

  it('defaults invalid render depth to 30', () => {
    expect(normalizeRenderDepth(undefined)).toBe(30);
    expect(normalizeRenderDepth('not-a-number')).toBe(30);
  });

  it('clamps render depth between 1 and 100', () => {
    expect(normalizeRenderDepth(0)).toBe(1);
    expect(normalizeRenderDepth(101)).toBe(100);
    expect(normalizeRenderDepth(30.8)).toBe(30);
  });

  it('migrates the old default depth of 1 to 30 once', () => {
    const storage = new MemoryStorage();
    storage.setItem(GAME_RENDER_DEPTH_KEY, '1');

    expect(loadRenderDepthFromStorage(storage)).toBe(30);
    expect(storage.getItem(GAME_RENDER_DEPTH_KEY)).toBe('30');
    expect(storage.getItem(RENDER_DEPTH_MIGRATION_FLAG)).toBe('1');
  });

  it('saves normalized values', () => {
    const storage = new MemoryStorage();

    expect(saveRenderDepthToStorage('42.9', storage)).toBe(42);
    expect(storage.getItem(GAME_RENDER_DEPTH_KEY)).toBe('42');
  });

  it('defaults invalid snapshot depth to 10', () => {
    expect(normalizeSnapshotDepth(undefined)).toBe(10);
    expect(normalizeSnapshotDepth('not-a-number')).toBe(10);
  });

  it('clamps snapshot depth between 0 and 50', () => {
    expect(normalizeSnapshotDepth(-1)).toBe(0);
    expect(normalizeSnapshotDepth(51)).toBe(50);
    expect(normalizeSnapshotDepth(12.9)).toBe(12);
  });

  it('loads and saves snapshot depth settings', () => {
    const storage = new MemoryStorage();

    expect(loadSnapshotDepthFromStorage(storage)).toBe(10);
    expect(saveSnapshotDepthToStorage('18.5', storage)).toBe(18);
    expect(storage.getItem(GAME_SNAPSHOT_DEPTH_KEY)).toBe('18');
    expect(loadSnapshotDepthFromStorage(storage)).toBe(18);
  });

  it('defaults NPC presence hints to enabled and persists disabled state', () => {
    const storage = new MemoryStorage();

    expect(loadNpcPresenceHintsEnabledFromStorage(storage)).toBe(true);

    expect(saveNpcPresenceHintsEnabledToStorage(false, storage)).toBe(false);
    expect(storage.getItem(NPC_PRESENCE_HINTS_ENABLED_KEY)).toBe('0');
    expect(loadNpcPresenceHintsEnabledFromStorage(storage)).toBe(false);

    expect(saveNpcPresenceHintsEnabledToStorage(true, storage)).toBe(true);
    expect(storage.getItem(NPC_PRESENCE_HINTS_ENABLED_KEY)).toBe('1');
    expect(loadNpcPresenceHintsEnabledFromStorage(storage)).toBe(true);
  });

  it('defaults narrative length to standard and rejects unknown values', () => {
    expect(DEFAULT_NARRATIVE_LENGTH).toBe('standard');
    expect(normalizeNarrativeLength(undefined)).toBe('standard');
    expect(normalizeNarrativeLength('very-long')).toBe('standard');
  });

  it('loads and saves narrative length settings', () => {
    const storage = new MemoryStorage();

    expect(loadNarrativeLengthFromStorage(storage)).toBe('standard');
    expect(saveNarrativeLengthToStorage('rich', storage)).toBe('rich');
    expect(storage.getItem(GAME_NARRATIVE_LENGTH_KEY)).toBe('rich');
    expect(loadNarrativeLengthFromStorage(storage)).toBe('rich');
  });

  it('loads the default narrative length when browser storage is unavailable', () => {
    expect(loadNarrativeLengthFromStorage()).toBe('standard');
  });

  it('defaults narrative length retry to enabled and persists the player choice', () => {
    const storage = new MemoryStorage();

    expect(loadNarrativeLengthRetryEnabledFromStorage(storage)).toBe(true);
    expect(saveNarrativeLengthRetryEnabledToStorage(false, storage)).toBe(false);
    expect(storage.getItem(GAME_NARRATIVE_LENGTH_RETRY_ENABLED_KEY)).toBe('0');
    expect(loadNarrativeLengthRetryEnabledFromStorage(storage)).toBe(false);
    expect(saveNarrativeLengthRetryEnabledToStorage(true, storage)).toBe(true);
    expect(loadNarrativeLengthRetryEnabledFromStorage(storage)).toBe(true);
  });

  it('uses one adaptive adult intimacy style and rejects unknown values', () => {
    expect(DEFAULT_ADULT_INTIMACY_STYLE).toBe('adaptive');
    expect(normalizeAdultIntimacyStyle(undefined)).toBe('adaptive');
    expect(normalizeAdultIntimacyStyle('skip-intimacy')).toBe('adaptive');
  });

  it('migrates legacy adult intimacy style settings to the adaptive style', () => {
    const storage = new MemoryStorage();

    storage.setItem(GAME_ADULT_INTIMACY_STYLE_KEY, 'directRealism');
    expect(loadAdultIntimacyStyleFromStorage(storage)).toBe('adaptive');
    expect(storage.getItem(GAME_ADULT_INTIMACY_STYLE_KEY)).toBe('adaptive');
    expect(saveAdultIntimacyStyleToStorage('relationshipImmersion', storage)).toBe('adaptive');
    expect(loadAdultIntimacyStyleFromStorage(storage)).toBe('adaptive');
  });

  it('defaults pregnancy mode to standard and persists all four modes', () => {
    const storage = new MemoryStorage();

    expect(DEFAULT_PREGNANCY_MODE).toBe('standard');
    expect(normalizePregnancyMode('unknown')).toBe('standard');
    expect(loadPregnancyModeFromStorage(storage)).toBe('standard');
    expect(savePregnancyModeToStorage('off', storage)).toBe('off');
    expect(storage.getItem(GAME_PREGNANCY_MODE_KEY)).toBe('off');
    expect(savePregnancyModeToStorage('high', storage)).toBe('high');
    expect(loadPregnancyModeFromStorage(storage)).toBe('high');
  });

  it('clamps and persists narrative reading dimensions', () => {
    const storage = new MemoryStorage();

    expect(normalizeNarrativeFontSize(8)).toBe(14);
    expect(normalizeNarrativeFontSize(99)).toBe(24);
    expect(saveNarrativeFontSizeToStorage(19, storage)).toBe(19);
    expect(storage.getItem(GAME_NARRATIVE_FONT_SIZE_KEY)).toBe('19');
    expect(loadNarrativeFontSizeFromStorage(storage)).toBe(19);

    expect(normalizeNarrativeLineHeight(1)).toBe(1.5);
    expect(normalizeNarrativeLineHeight(3)).toBe(2.2);
    expect(saveNarrativeLineHeightToStorage(1.94, storage)).toBe(1.95);
    expect(storage.getItem(GAME_NARRATIVE_LINE_HEIGHT_KEY)).toBe('1.95');
    expect(loadNarrativeLineHeightFromStorage(storage)).toBe(1.95);
  });

  it('defaults motion to system and persists reduced motion', () => {
    const storage = new MemoryStorage();

    expect(DEFAULT_MOTION_PREFERENCE).toBe('system');
    expect(normalizeMotionPreference('fast')).toBe('system');
    expect(saveMotionPreferenceToStorage('reduced', storage)).toBe('reduced');
    expect(storage.getItem(GAME_MOTION_PREFERENCE_KEY)).toBe('reduced');
    expect(loadMotionPreferenceFromStorage(storage)).toBe('reduced');
  });

  it('keeps dark as the default theme and persists an explicit light choice', () => {
    const storage = new MemoryStorage();

    expect(DEFAULT_COLOR_THEME).toBe('dark');
    expect(normalizeColorTheme(undefined)).toBe('dark');
    expect(normalizeColorTheme('inverted')).toBe('dark');
    expect(loadColorThemeFromStorage(storage)).toBe('dark');
    expect(saveColorThemeToStorage('light', storage)).toBe('light');
    expect(storage.getItem(GAME_COLOR_THEME_KEY)).toBe('light');
    expect(loadColorThemeFromStorage(storage)).toBe('light');
  });
});
