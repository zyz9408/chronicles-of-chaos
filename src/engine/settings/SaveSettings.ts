export const AUTO_SAVE_LIMIT_KEY = 'coc_v2_auto_save_limit';
export const AUTO_SAVE_INTERVAL_TURNS_KEY = 'coc_v2_auto_save_interval_turns';

export const DEFAULT_AUTO_SAVE_LIMIT = 20;
export const MIN_AUTO_SAVE_LIMIT = 1;
export const MAX_AUTO_SAVE_LIMIT = 100;

export const DEFAULT_AUTO_SAVE_INTERVAL_TURNS = 1;
export const MIN_AUTO_SAVE_INTERVAL_TURNS = 1;
export const MAX_AUTO_SAVE_INTERVAL_TURNS = 50;

type SaveSettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(numeric)));
}

function getStorage(storage?: SaveSettingsStorage): SaveSettingsStorage | null {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function normalizeAutoSaveLimit(value: unknown): number {
  return normalizeInteger(
    value,
    DEFAULT_AUTO_SAVE_LIMIT,
    MIN_AUTO_SAVE_LIMIT,
    MAX_AUTO_SAVE_LIMIT,
  );
}

export function normalizeAutoSaveIntervalTurns(value: unknown): number {
  return normalizeInteger(
    value,
    DEFAULT_AUTO_SAVE_INTERVAL_TURNS,
    MIN_AUTO_SAVE_INTERVAL_TURNS,
    MAX_AUTO_SAVE_INTERVAL_TURNS,
  );
}

export function loadAutoSaveLimitFromStorage(storage?: SaveSettingsStorage): number {
  const target = getStorage(storage);
  if (!target) return DEFAULT_AUTO_SAVE_LIMIT;
  try {
    return normalizeAutoSaveLimit(target.getItem(AUTO_SAVE_LIMIT_KEY));
  } catch {
    return DEFAULT_AUTO_SAVE_LIMIT;
  }
}

export function saveAutoSaveLimitToStorage(
  value: unknown,
  storage?: SaveSettingsStorage,
): number {
  const normalized = normalizeAutoSaveLimit(value);
  const target = getStorage(storage);
  try {
    target?.setItem(AUTO_SAVE_LIMIT_KEY, String(normalized));
  } catch {
    // Save preferences are non-critical; keep the normalized in-memory value.
  }
  return normalized;
}

export function loadAutoSaveIntervalTurnsFromStorage(storage?: SaveSettingsStorage): number {
  const target = getStorage(storage);
  if (!target) return DEFAULT_AUTO_SAVE_INTERVAL_TURNS;
  try {
    return normalizeAutoSaveIntervalTurns(target.getItem(AUTO_SAVE_INTERVAL_TURNS_KEY));
  } catch {
    return DEFAULT_AUTO_SAVE_INTERVAL_TURNS;
  }
}

export function saveAutoSaveIntervalTurnsToStorage(
  value: unknown,
  storage?: SaveSettingsStorage,
): number {
  const normalized = normalizeAutoSaveIntervalTurns(value);
  const target = getStorage(storage);
  try {
    target?.setItem(AUTO_SAVE_INTERVAL_TURNS_KEY, String(normalized));
  } catch {
    // Save preferences are non-critical; keep the normalized in-memory value.
  }
  return normalized;
}
