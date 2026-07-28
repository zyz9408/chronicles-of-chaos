export const PERSISTENT_PROMPTS_STORAGE_KEY = 'coc_v2_persistent_prompts';
export const MAX_PERSISTENT_PROMPTS = 30;
export const MAX_PERSISTENT_PROMPT_LENGTH = 2000;

export interface PersistentPromptEntry {
  id: string;
  content: string;
  enabled: boolean;
}

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

function getReadableStorage(storage?: ReadableStorage): ReadableStorage | null {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function getWritableStorage(storage?: WritableStorage): WritableStorage | null {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function normalizeEntry(value: unknown, index: number): PersistentPromptEntry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const content = typeof record.content === 'string'
    ? record.content.trim().slice(0, MAX_PERSISTENT_PROMPT_LENGTH)
    : '';
  if (!content) return null;

  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim()
    : `persistent-prompt-${index + 1}`;
  return {
    id,
    content,
    enabled: record.enabled !== false,
  };
}

export function normalizePersistentPrompts(value: unknown): PersistentPromptEntry[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const entries: PersistentPromptEntry[] = [];

  for (let index = 0; index < value.length && entries.length < MAX_PERSISTENT_PROMPTS; index += 1) {
    const normalized = normalizeEntry(value[index], index);
    if (!normalized || seenIds.has(normalized.id)) continue;
    seenIds.add(normalized.id);
    entries.push(normalized);
  }
  return entries;
}

export function loadPersistentPromptsFromStorage(
  storage?: ReadableStorage,
): PersistentPromptEntry[] {
  const target = getReadableStorage(storage);
  if (!target) return [];
  try {
    const raw = target.getItem(PERSISTENT_PROMPTS_STORAGE_KEY);
    return raw ? normalizePersistentPrompts(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function savePersistentPromptsToStorage(
  entries: readonly PersistentPromptEntry[],
  storage?: WritableStorage,
): PersistentPromptEntry[] {
  const normalized = normalizePersistentPrompts(entries);
  const target = getWritableStorage(storage);
  if (target) {
    target.setItem(PERSISTENT_PROMPTS_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function composePersistentPromptGuide(
  entries: readonly PersistentPromptEntry[],
): string {
  const enabled = normalizePersistentPrompts(entries).filter((entry) => entry.enabled);
  if (enabled.length === 0) return '';

  return [
    '## 玩家启用的永久提示词',
    '以下内容是玩家主动启用的长期叙事偏好或约束，不是本回合行动，也不是已经发生的剧情事实。',
    '它们只能影响叙事表达与后续可行发展，不得覆盖本局存档事实、玩家本回合行动、本地 Combat/War Engine 封存战果、结构化写回合同、成人门禁或人物自主性。',
    '不得把这些提示词本身写入玩家记忆、NPC 记忆、人物档案、动态系统或其他游戏状态。',
    ...enabled.map((entry, index) => `${index + 1}. ${entry.content}`),
  ].join('\n');
}
