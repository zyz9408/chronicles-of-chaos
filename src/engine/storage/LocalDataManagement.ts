import { clearPromptOverrides } from '../prompts/PromptOverrideStore';
import { PERSISTENT_PROMPTS_STORAGE_KEY } from '../prompts/PersistentPromptStore';
import { TAVERN_SETTINGS_STORAGE_KEY } from '../prompts/TavernPresetStore';
import { OPENING_CHARACTER_TEMPLATES_STORAGE_KEY } from '../opening/OpeningCharacterTemplateStore';
import { clearAllSaves } from '../save/SaveManager';
import { clearAllApiSettingsAsync } from '../settings/ApiConfigManager';
import {
  GAME_ADULT_INTIMACY_STYLE_KEY,
  GAME_MOTION_PREFERENCE_KEY,
  GAME_NARRATIVE_FONT_SIZE_KEY,
  GAME_NARRATIVE_LENGTH_KEY,
  GAME_NARRATIVE_LENGTH_RETRY_ENABLED_KEY,
  GAME_NARRATIVE_LINE_HEIGHT_KEY,
  GAME_PREGNANCY_MODE_KEY,
  GAME_RENDER_DEPTH_KEY,
  GAME_SNAPSHOT_DEPTH_KEY,
  NPC_PRESENCE_HINTS_ENABLED_KEY,
  RENDER_DEPTH_MIGRATION_FLAG,
  applyDisplayPreferencesToDocument,
} from '../settings/DisplaySettings';
import {
  AUTO_SAVE_INTERVAL_TURNS_KEY,
  AUTO_SAVE_LIMIT_KEY,
} from '../settings/SaveSettings';
import { idbClear } from './IndexedDbStore';

export type LocalDataClearScope =
  | 'saves'
  | 'cache'
  | 'preferences'
  | 'allExceptApi'
  | 'all';

type MutableStorage = Pick<Storage, 'length' | 'key' | 'removeItem' | 'setItem'>;

const PREFERENCE_KEYS = [
  GAME_RENDER_DEPTH_KEY,
  RENDER_DEPTH_MIGRATION_FLAG,
  GAME_SNAPSHOT_DEPTH_KEY,
  NPC_PRESENCE_HINTS_ENABLED_KEY,
  GAME_NARRATIVE_LENGTH_KEY,
  GAME_NARRATIVE_LENGTH_RETRY_ENABLED_KEY,
  GAME_ADULT_INTIMACY_STYLE_KEY,
  GAME_PREGNANCY_MODE_KEY,
  GAME_NARRATIVE_FONT_SIZE_KEY,
  GAME_NARRATIVE_LINE_HEIGHT_KEY,
  GAME_MOTION_PREFERENCE_KEY,
  AUTO_SAVE_LIMIT_KEY,
  AUTO_SAVE_INTERVAL_TURNS_KEY,
  'coc_v2_changelog_daily_view',
  'coc_v2_seen_release_note',
  'coc_v2_npc_simulation_settings',
  PERSISTENT_PROMPTS_STORAGE_KEY,
  TAVERN_SETTINGS_STORAGE_KEY,
  OPENING_CHARACTER_TEMPLATES_STORAGE_KEY,
] as const;

const OWNED_DYNAMIC_PREFIXES = [
  'coc-v2:opening-custom-options:',
] as const;

function getStorage(storage?: MutableStorage): MutableStorage | null {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function listPreferenceKeysToRemove(storage: Pick<Storage, 'length' | 'key'>): string[] {
  const keys = new Set<string>(PREFERENCE_KEYS);
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && OWNED_DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix))) keys.add(key);
  }
  return [...keys];
}

export function clearPreferenceData(storage?: MutableStorage): void {
  const target = getStorage(storage);
  if (!target) return;
  for (const key of listPreferenceKeysToRemove(target)) target.removeItem(key);
  clearPromptOverrides(target as Storage);
  applyDisplayPreferencesToDocument();
}

export async function clearCachedData(): Promise<void> {
  await idbClear('memoryEmbeddingIndexes');
}

export async function clearLocalData(
  scope: LocalDataClearScope,
  storage?: MutableStorage,
): Promise<void> {
  if (scope === 'saves') {
    await clearAllSaves();
    return;
  }
  if (scope === 'cache') {
    await clearCachedData();
    return;
  }
  if (scope === 'preferences') {
    clearPreferenceData(storage);
    return;
  }

  await clearAllSaves();
  await clearCachedData();
  clearPreferenceData(storage);
  if (scope === 'all') await clearAllApiSettingsAsync(storage as Storage | undefined);
}
