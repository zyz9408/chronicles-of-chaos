export const GAME_RENDER_DEPTH_KEY = 'coc_v2_render_depth';
export const RENDER_DEPTH_MIGRATION_FLAG = 'coc_v2_render_depth_migrated_v1';
export const DEFAULT_RENDER_DEPTH = 30;
export const MIN_RENDER_DEPTH = 1;
export const MAX_RENDER_DEPTH = 100;
export const GAME_SNAPSHOT_DEPTH_KEY = 'coc_v2_snapshot_depth';
export const DEFAULT_SNAPSHOT_DEPTH = 10;
export const MIN_SNAPSHOT_DEPTH = 0;
export const MAX_SNAPSHOT_DEPTH = 50;
export const NPC_PRESENCE_HINTS_ENABLED_KEY = 'coc_v2_npc_presence_hints_enabled';
export const GAME_NARRATIVE_LENGTH_KEY = 'coc_v2_narrative_length';
export const NARRATIVE_LENGTH_OPTIONS = ['compact', 'standard', 'rich', 'long'] as const;
export type NarrativeLengthPreference = (typeof NARRATIVE_LENGTH_OPTIONS)[number];
export const DEFAULT_NARRATIVE_LENGTH: NarrativeLengthPreference = 'standard';
export const GAME_ADULT_INTIMACY_STYLE_KEY = 'coc_v2_adult_intimacy_style';
export const ADULT_INTIMACY_STYLE_OPTIONS = ['relationshipImmersion', 'directRealism'] as const;
export type AdultIntimacyStylePreference = (typeof ADULT_INTIMACY_STYLE_OPTIONS)[number];
export const DEFAULT_ADULT_INTIMACY_STYLE: AdultIntimacyStylePreference = 'relationshipImmersion';
export const GAME_PREGNANCY_MODE_KEY = 'coc_v2_pregnancy_mode';
export const PREGNANCY_MODE_OPTIONS = ['off', 'low', 'standard', 'high'] as const;
export type PregnancyModePreference = (typeof PREGNANCY_MODE_OPTIONS)[number];
export const DEFAULT_PREGNANCY_MODE: PregnancyModePreference = 'standard';
export const GAME_NARRATIVE_FONT_SIZE_KEY = 'coc_v2_narrative_font_size';
export const DEFAULT_NARRATIVE_FONT_SIZE = 16;
export const MIN_NARRATIVE_FONT_SIZE = 14;
export const MAX_NARRATIVE_FONT_SIZE = 24;
export const GAME_NARRATIVE_LINE_HEIGHT_KEY = 'coc_v2_narrative_line_height';
export const DEFAULT_NARRATIVE_LINE_HEIGHT = 1.85;
export const MIN_NARRATIVE_LINE_HEIGHT = 1.5;
export const MAX_NARRATIVE_LINE_HEIGHT = 2.2;
export const NARRATIVE_LINE_HEIGHT_STEP = 0.05;
export const GAME_MOTION_PREFERENCE_KEY = 'coc_v2_motion_preference';
export const MOTION_PREFERENCE_OPTIONS = ['system', 'reduced'] as const;
export type MotionPreference = (typeof MOTION_PREFERENCE_OPTIONS)[number];
export const DEFAULT_MOTION_PREFERENCE: MotionPreference = 'system';

type RenderDepthStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function normalizeRenderDepth(value: unknown): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return DEFAULT_RENDER_DEPTH;
  return Math.max(MIN_RENDER_DEPTH, Math.min(MAX_RENDER_DEPTH, Math.floor(numeric)));
}

export function loadRenderDepthFromStorage(storage: RenderDepthStorage = localStorage): number {
  try {
    const raw = storage.getItem(GAME_RENDER_DEPTH_KEY);
    const hasMigrated = storage.getItem(RENDER_DEPTH_MIGRATION_FLAG);

    if (!hasMigrated && raw === '1') {
      storage.setItem(GAME_RENDER_DEPTH_KEY, String(DEFAULT_RENDER_DEPTH));
      storage.setItem(RENDER_DEPTH_MIGRATION_FLAG, '1');
      return DEFAULT_RENDER_DEPTH;
    }

    if (!hasMigrated) {
      storage.setItem(RENDER_DEPTH_MIGRATION_FLAG, '1');
    }

    return normalizeRenderDepth(raw);
  } catch {
    return DEFAULT_RENDER_DEPTH;
  }
}

export function saveRenderDepthToStorage(value: unknown, storage: RenderDepthStorage = localStorage): number {
  const normalized = normalizeRenderDepth(value);
  try {
    storage.setItem(GAME_RENDER_DEPTH_KEY, String(normalized));
  } catch {
    // Display preferences are non-critical.
  }
  return normalized;
}

export function normalizeSnapshotDepth(value: unknown): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return DEFAULT_SNAPSHOT_DEPTH;
  return Math.max(MIN_SNAPSHOT_DEPTH, Math.min(MAX_SNAPSHOT_DEPTH, Math.floor(numeric)));
}

export function loadSnapshotDepthFromStorage(storage: RenderDepthStorage = localStorage): number {
  try {
    return normalizeSnapshotDepth(storage.getItem(GAME_SNAPSHOT_DEPTH_KEY));
  } catch {
    return DEFAULT_SNAPSHOT_DEPTH;
  }
}

export function saveSnapshotDepthToStorage(value: unknown, storage: RenderDepthStorage = localStorage): number {
  const normalized = normalizeSnapshotDepth(value);
  try {
    storage.setItem(GAME_SNAPSHOT_DEPTH_KEY, String(normalized));
  } catch {
    // Game preferences are non-critical.
  }
  return normalized;
}

export function loadNpcPresenceHintsEnabledFromStorage(storage: RenderDepthStorage = localStorage): boolean {
  try {
    const raw = storage.getItem(NPC_PRESENCE_HINTS_ENABLED_KEY);
    if (raw === '0' || raw === 'false') return false;
    return true;
  } catch {
    return true;
  }
}

export function saveNpcPresenceHintsEnabledToStorage(
  enabled: boolean,
  storage: RenderDepthStorage = localStorage,
): boolean {
  try {
    storage.setItem(NPC_PRESENCE_HINTS_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // Game preferences are non-critical.
  }
  return enabled;
}

export function normalizeNarrativeLength(value: unknown): NarrativeLengthPreference {
  return typeof value === 'string' && NARRATIVE_LENGTH_OPTIONS.includes(value as NarrativeLengthPreference)
    ? (value as NarrativeLengthPreference)
    : DEFAULT_NARRATIVE_LENGTH;
}

export function loadNarrativeLengthFromStorage(
  storage?: RenderDepthStorage,
): NarrativeLengthPreference {
  const target = getDisplaySettingsStorage(storage);
  if (!target) return DEFAULT_NARRATIVE_LENGTH;

  try {
    return normalizeNarrativeLength(target.getItem(GAME_NARRATIVE_LENGTH_KEY));
  } catch {
    return DEFAULT_NARRATIVE_LENGTH;
  }
}

export function saveNarrativeLengthToStorage(
  value: unknown,
  storage?: RenderDepthStorage,
): NarrativeLengthPreference {
  const normalized = normalizeNarrativeLength(value);
  const target = getDisplaySettingsStorage(storage);
  if (!target) return normalized;

  try {
    target.setItem(GAME_NARRATIVE_LENGTH_KEY, normalized);
  } catch {
    // Game preferences are non-critical.
  }
  return normalized;
}

function getDisplaySettingsStorage(storage?: RenderDepthStorage): RenderDepthStorage | null {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function normalizeAdultIntimacyStyle(value: unknown): AdultIntimacyStylePreference {
  return typeof value === 'string' && ADULT_INTIMACY_STYLE_OPTIONS.includes(value as AdultIntimacyStylePreference)
    ? (value as AdultIntimacyStylePreference)
    : DEFAULT_ADULT_INTIMACY_STYLE;
}

export function loadAdultIntimacyStyleFromStorage(
  storage?: RenderDepthStorage,
): AdultIntimacyStylePreference {
  const target = getDisplaySettingsStorage(storage);
  if (!target) return DEFAULT_ADULT_INTIMACY_STYLE;

  try {
    return normalizeAdultIntimacyStyle(target.getItem(GAME_ADULT_INTIMACY_STYLE_KEY));
  } catch {
    return DEFAULT_ADULT_INTIMACY_STYLE;
  }
}

export function saveAdultIntimacyStyleToStorage(
  value: unknown,
  storage?: RenderDepthStorage,
): AdultIntimacyStylePreference {
  const normalized = normalizeAdultIntimacyStyle(value);
  const target = getDisplaySettingsStorage(storage);
  if (!target) return normalized;

  try {
    target.setItem(GAME_ADULT_INTIMACY_STYLE_KEY, normalized);
  } catch {
    // Game preferences are non-critical.
  }
  return normalized;
}

export function normalizeNarrativeFontSize(value: unknown): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return DEFAULT_NARRATIVE_FONT_SIZE;
  return Math.max(MIN_NARRATIVE_FONT_SIZE, Math.min(MAX_NARRATIVE_FONT_SIZE, Math.round(numeric)));
}

export function loadNarrativeFontSizeFromStorage(storage?: RenderDepthStorage): number {
  const target = getDisplaySettingsStorage(storage);
  if (!target) return DEFAULT_NARRATIVE_FONT_SIZE;
  try {
    return normalizeNarrativeFontSize(target.getItem(GAME_NARRATIVE_FONT_SIZE_KEY));
  } catch {
    return DEFAULT_NARRATIVE_FONT_SIZE;
  }
}

export function saveNarrativeFontSizeToStorage(value: unknown, storage?: RenderDepthStorage): number {
  const normalized = normalizeNarrativeFontSize(value);
  const target = getDisplaySettingsStorage(storage);
  try {
    target?.setItem(GAME_NARRATIVE_FONT_SIZE_KEY, String(normalized));
  } catch {
    // Reading preferences are non-critical.
  }
  applyDisplayPreferencesToDocument();
  return normalized;
}

export function normalizeNarrativeLineHeight(value: unknown): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return DEFAULT_NARRATIVE_LINE_HEIGHT;
  const clamped = Math.max(MIN_NARRATIVE_LINE_HEIGHT, Math.min(MAX_NARRATIVE_LINE_HEIGHT, numeric));
  return Number((Math.round(clamped / NARRATIVE_LINE_HEIGHT_STEP) * NARRATIVE_LINE_HEIGHT_STEP).toFixed(2));
}

export function loadNarrativeLineHeightFromStorage(storage?: RenderDepthStorage): number {
  const target = getDisplaySettingsStorage(storage);
  if (!target) return DEFAULT_NARRATIVE_LINE_HEIGHT;
  try {
    return normalizeNarrativeLineHeight(target.getItem(GAME_NARRATIVE_LINE_HEIGHT_KEY));
  } catch {
    return DEFAULT_NARRATIVE_LINE_HEIGHT;
  }
}

export function saveNarrativeLineHeightToStorage(value: unknown, storage?: RenderDepthStorage): number {
  const normalized = normalizeNarrativeLineHeight(value);
  const target = getDisplaySettingsStorage(storage);
  try {
    target?.setItem(GAME_NARRATIVE_LINE_HEIGHT_KEY, String(normalized));
  } catch {
    // Reading preferences are non-critical.
  }
  applyDisplayPreferencesToDocument();
  return normalized;
}

export function normalizeMotionPreference(value: unknown): MotionPreference {
  return typeof value === 'string' && MOTION_PREFERENCE_OPTIONS.includes(value as MotionPreference)
    ? value as MotionPreference
    : DEFAULT_MOTION_PREFERENCE;
}

export function loadMotionPreferenceFromStorage(storage?: RenderDepthStorage): MotionPreference {
  const target = getDisplaySettingsStorage(storage);
  if (!target) return DEFAULT_MOTION_PREFERENCE;
  try {
    return normalizeMotionPreference(target.getItem(GAME_MOTION_PREFERENCE_KEY));
  } catch {
    return DEFAULT_MOTION_PREFERENCE;
  }
}

export function saveMotionPreferenceToStorage(value: unknown, storage?: RenderDepthStorage): MotionPreference {
  const normalized = normalizeMotionPreference(value);
  const target = getDisplaySettingsStorage(storage);
  try {
    target?.setItem(GAME_MOTION_PREFERENCE_KEY, normalized);
  } catch {
    // Motion preferences are non-critical.
  }
  applyDisplayPreferencesToDocument();
  return normalized;
}

export function applyDisplayPreferencesToDocument(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--narrative-font-size', `${loadNarrativeFontSizeFromStorage()}px`);
  root.style.setProperty('--narrative-line-height', String(loadNarrativeLineHeightFromStorage()));
  root.dataset.cocMotion = loadMotionPreferenceFromStorage();
}

export function normalizePregnancyMode(value: unknown): PregnancyModePreference {
  return typeof value === 'string' && PREGNANCY_MODE_OPTIONS.includes(value as PregnancyModePreference)
    ? (value as PregnancyModePreference)
    : DEFAULT_PREGNANCY_MODE;
}

export function loadPregnancyModeFromStorage(
  storage?: RenderDepthStorage,
): PregnancyModePreference {
  const target = getDisplaySettingsStorage(storage);
  if (!target) return DEFAULT_PREGNANCY_MODE;

  try {
    return normalizePregnancyMode(target.getItem(GAME_PREGNANCY_MODE_KEY));
  } catch {
    return DEFAULT_PREGNANCY_MODE;
  }
}

export function savePregnancyModeToStorage(
  value: unknown,
  storage?: RenderDepthStorage,
): PregnancyModePreference {
  const normalized = normalizePregnancyMode(value);
  const target = getDisplaySettingsStorage(storage);
  if (!target) return normalized;

  try {
    target.setItem(GAME_PREGNANCY_MODE_KEY, normalized);
  } catch {
    // Game preferences are non-critical. Each created opportunity persists its resolved chance in the save.
  }
  return normalized;
}
