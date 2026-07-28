import { jsonrepair } from 'jsonrepair';

export const TAVERN_SETTINGS_STORAGE_KEY = 'coc_v2_tavern_settings';
export const TAVERN_INJECTION_CHARACTER_LIMIT = 48_000;
export const MAX_TAVERN_PRESETS = 12;
export const MAX_TAVERN_IMPORT_CHARACTERS = 2_000_000;

export const TAVERN_RESERVED_RUNTIME_SLOTS = new Set([
  'chathistory',
  'worldinfobefore',
  'worldinfoafter',
  'chardescription',
  'charpersonality',
  'scenario',
  'personadescription',
  'dialogueexamples',
]);

export const DEFAULT_CUSTOM_COT_TEMPLATE = [
  '在输出最终 JSON 前先在模型内部完成自然的叙事规划：',
  '1. 核对当前本局事实、人物动机、时代约束、玩家明确行动和已封存的战斗或战争结果。',
  '2. 优先遵循已启用酒馆预设的创作方法与语言风格，让它在不触碰硬协议的范围内充分生效。',
  '3. 选择有戏剧张力但不替玩家作出新决定的发展，人物对白必须符合各自身份与个性。',
  '4. 检查正文、行动选项和结构化写回彼此一致。',
  '只输出协议要求的最终 JSON，不展示内部思考过程。',
].join('\n');

export type CreativeNarrativeScope = 'opening' | 'turn' | 'encounter';
export type TavernPresetScope = CreativeNarrativeScope | 'all';
export type TavernPresetMessageRole = 'system' | 'user' | 'assistant';
export type TavernAssistantHandling = 'disabled' | 'few_shot' | 'creative_rule';

export interface TavernPresetPrompt {
  identifier: string;
  name?: string;
  role: TavernPresetMessageRole;
  content: string;
  systemPrompt: boolean;
}

export interface TavernPresetOrderItem {
  identifier: string;
  enabled: boolean;
}

export interface TavernPresetOrder {
  characterId: number;
  order: TavernPresetOrderItem[];
}

export interface TavernPreset {
  prompts: TavernPresetPrompt[];
  promptOrder: TavernPresetOrder[];
}

export interface TavernPresetItemOverride {
  enabled?: boolean;
  contentOverride?: string;
  scope?: TavernPresetScope;
  assistantHandling?: TavernAssistantHandling;
}

export interface ManagedTavernPresetEntry {
  id: string;
  name: string;
  importedAt: string;
  sourceHash: string;
  selectedCharacterId: number;
  preset: TavernPreset;
  customization: {
    version: 1;
    itemOverrides: Record<string, TavernPresetItemOverride>;
  };
}

export interface CustomCotSettings {
  enabled: boolean;
  scope: TavernPresetScope;
  content: string;
  templateId: 'natural-planning' | 'custom';
}

export interface TavernManagementSettings {
  version: 1;
  enabled: boolean;
  activePresetId: string | null;
  entries: ManagedTavernPresetEntry[];
  customCot: CustomCotSettings;
}

export type TavernResolutionStatus =
  | 'included'
  | 'disabled'
  | 'out_of_scope'
  | 'reserved_runtime_slot'
  | 'missing_prompt'
  | 'empty_content'
  | 'assistant_incompatible'
  | 'over_budget';

export interface ResolvedTavernItem {
  slotKey: string;
  orderIndex: number;
  identifier: string;
  name: string;
  originalRole: TavernPresetMessageRole;
  role: TavernPresetMessageRole;
  content: string;
  scope: TavernPresetScope;
  assistantHandling: TavernAssistantHandling;
  status: TavernResolutionStatus;
  characters: number;
}

export interface ResolvedTavernPreset {
  entry: ManagedTavernPresetEntry | null;
  characterId: number | null;
  items: ResolvedTavernItem[];
  includedCharacters: number;
  characterLimit: number;
}

export interface TavernPresetImportResult {
  entry: ManagedTavernPresetEntry;
  repaired: boolean;
  exceedsInjectionBudget: boolean;
}

export interface TavernSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getDefaultStorage(): TavernSettingsStorage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) ? number : undefined;
}

function readBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function normalizeRole(value: unknown, systemPrompt: boolean): TavernPresetMessageRole {
  if (value === 'assistant' || value === 'user' || value === 'system') return value;
  return systemPrompt ? 'system' : 'user';
}

function normalizePrompt(value: unknown, index: number): TavernPresetPrompt | null {
  if (!isRecord(value)) return null;
  const identifier = readString(value.identifier).trim()
    || readString(value.id).trim()
    || `prompt-${index + 1}`;
  const content = readString(value.content);
  const systemPrompt = readBoolean(value.system_prompt, value.role === 'system');
  return {
    identifier,
    ...(readString(value.name).trim() ? { name: readString(value.name).trim() } : {}),
    role: normalizeRole(value.role, systemPrompt),
    content,
    systemPrompt,
  };
}

function normalizeOrderItem(value: unknown): TavernPresetOrderItem | null {
  if (!isRecord(value)) return null;
  const identifier = readString(value.identifier).trim() || readString(value.id).trim();
  if (!identifier) return null;
  return {
    identifier,
    enabled: readBoolean(value.enabled, true),
  };
}

function normalizeOrder(value: unknown, index: number): TavernPresetOrder | null {
  if (!isRecord(value)) return null;
  const rawOrder = Array.isArray(value.order)
    ? value.order
    : Array.isArray(value.prompts)
      ? value.prompts
      : [];
  const order = rawOrder
    .map(normalizeOrderItem)
    .filter((item): item is TavernPresetOrderItem => Boolean(item));
  if (order.length === 0) return null;
  return {
    characterId: readInteger(value.character_id)
      ?? readInteger(value.characterId)
      ?? 100_001 + index,
    order,
  };
}

function normalizeTavernPreset(value: unknown): TavernPreset | null {
  if (!isRecord(value) || !Array.isArray(value.prompts)) return null;
  const prompts = value.prompts
    .map(normalizePrompt)
    .filter((item): item is TavernPresetPrompt => Boolean(item));
  const rawOrders = Array.isArray(value.prompt_order)
    ? value.prompt_order
    : Array.isArray(value.promptOrder)
      ? value.promptOrder
      : [];
  let promptOrder = rawOrders
    .map(normalizeOrder)
    .filter((item): item is TavernPresetOrder => Boolean(item));
  if (prompts.length === 0) return null;
  if (promptOrder.length === 0) {
    promptOrder = [{
      characterId: 100_001,
      order: prompts.map((prompt) => ({ identifier: prompt.identifier, enabled: true })),
    }];
  }
  return { prompts, promptOrder };
}

function resolveTavernPresetOrder(
  preset: TavernPreset,
  selectedCharacterId?: number,
): TavernPresetOrder {
  return preset.promptOrder.find((item) => item.characterId === selectedCharacterId)
    ?? preset.promptOrder.find((item) => item.characterId === 100_001)
    ?? preset.promptOrder[0];
}

export function getSelectedTavernPresetOrder(
  entry: ManagedTavernPresetEntry,
): TavernPresetOrder {
  return resolveTavernPresetOrder(entry.preset, entry.selectedCharacterId);
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function calculateSourceHash(preset: TavernPreset): string {
  return hashText(JSON.stringify(preset));
}

function createPresetId(name: string, importedAt: string, sourceHash: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\.json$/i, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'preset';
  return `tavern-${slug}-${sourceHash.slice(-8)}-${Date.parse(importedAt) || Date.now()}`;
}

function normalizeScope(value: unknown): TavernPresetScope {
  if (value === 'opening' || value === 'turn' || value === 'encounter') return value;
  return 'all';
}

function normalizeAssistantHandling(value: unknown): TavernAssistantHandling {
  if (value === 'few_shot' || value === 'creative_rule') return value;
  return 'disabled';
}

function normalizeItemOverride(value: unknown): TavernPresetItemOverride {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(typeof value.contentOverride === 'string' ? { contentOverride: value.contentOverride } : {}),
    ...(value.scope ? { scope: normalizeScope(value.scope) } : {}),
    ...(value.assistantHandling
      ? { assistantHandling: normalizeAssistantHandling(value.assistantHandling) }
      : {}),
  };
}

function normalizeCustomization(value: unknown): ManagedTavernPresetEntry['customization'] {
  const rawCustomization = isRecord(value) ? value : {};
  const rawOverrides = isRecord(rawCustomization.itemOverrides)
    ? rawCustomization.itemOverrides
    : {};
  return {
    version: 1,
    itemOverrides: Object.fromEntries(
      Object.entries(rawOverrides).map(([key, override]) => [key, normalizeItemOverride(override)]),
    ),
  };
}

function normalizeEntry(value: unknown, index: number): ManagedTavernPresetEntry | null {
  if (!isRecord(value)) return null;
  const preset = normalizeTavernPreset(value.preset);
  if (!preset) return null;
  const name = readString(value.name).trim() || `酒馆预设 ${index + 1}`;
  const importedAt = readString(value.importedAt).trim() || new Date(0).toISOString();
  const sourceHash = readString(value.sourceHash).trim() || calculateSourceHash(preset);
  const selectedCharacterId = resolveTavernPresetOrder(
    preset,
    readInteger(value.selectedCharacterId),
  ).characterId;
  return {
    id: readString(value.id).trim() || createPresetId(name, importedAt, sourceHash),
    name,
    importedAt,
    sourceHash,
    selectedCharacterId,
    preset,
    customization: normalizeCustomization(value.customization),
  };
}

export function createDefaultTavernManagementSettings(): TavernManagementSettings {
  return {
    version: 1,
    enabled: false,
    activePresetId: null,
    entries: [],
    customCot: {
      enabled: false,
      scope: 'all',
      content: '',
      templateId: 'natural-planning',
    },
  };
}

export function normalizeTavernManagementSettings(value: unknown): TavernManagementSettings {
  const defaults = createDefaultTavernManagementSettings();
  if (!isRecord(value)) return defaults;
  const entries = (Array.isArray(value.entries) ? value.entries : [])
    .map(normalizeEntry)
    .filter((entry): entry is ManagedTavernPresetEntry => Boolean(entry))
    .slice(0, MAX_TAVERN_PRESETS);
  const requestedId = readString(value.activePresetId).trim();
  const activePresetId = entries.some((entry) => entry.id === requestedId)
    ? requestedId
    : entries[0]?.id ?? null;
  const customCot = isRecord(value.customCot) ? value.customCot : {};
  return {
    version: 1,
    enabled: value.enabled === true && entries.length > 0,
    activePresetId,
    entries,
    customCot: {
      enabled: customCot.enabled === true,
      scope: normalizeScope(customCot.scope),
      content: readString(customCot.content),
      templateId: customCot.templateId === 'custom' ? 'custom' : 'natural-planning',
    },
  };
}

export function loadTavernManagementSettings(
  storage: TavernSettingsStorage | null = getDefaultStorage(),
): TavernManagementSettings {
  if (!storage) return createDefaultTavernManagementSettings();
  try {
    return normalizeTavernManagementSettings(
      JSON.parse(storage.getItem(TAVERN_SETTINGS_STORAGE_KEY) ?? 'null'),
    );
  } catch {
    return createDefaultTavernManagementSettings();
  }
}

export function saveTavernManagementSettings(
  settings: TavernManagementSettings,
  storage: TavernSettingsStorage | null = getDefaultStorage(),
): TavernManagementSettings {
  const normalized = normalizeTavernManagementSettings(settings);
  storage?.setItem(TAVERN_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearTavernManagementSettings(
  storage: TavernSettingsStorage | null = getDefaultStorage(),
): void {
  storage?.removeItem(TAVERN_SETTINGS_STORAGE_KEY);
}

export function importTavernPreset(
  rawJson: string,
  fileName: string,
  importedAt = new Date().toISOString(),
): TavernPresetImportResult {
  if (rawJson.length > MAX_TAVERN_IMPORT_CHARACTERS) {
    throw new Error('预设文件过大，最多允许 2,000,000 个字符。');
  }
  let parsed: unknown;
  let repaired = false;
  try {
    parsed = JSON.parse(rawJson.replace(/^\uFEFF/, ''));
  } catch {
    try {
      parsed = JSON.parse(jsonrepair(rawJson));
      repaired = true;
    } catch {
      throw new Error('文件不是有效 JSON。');
    }
  }
  const source = isRecord(parsed) && isRecord(parsed.entry) && isRecord(parsed.entry.preset)
    ? parsed.entry.preset
    : isRecord(parsed) && isRecord(parsed.data)
      ? parsed.data
      : parsed;
  const preset = normalizeTavernPreset(source);
  if (!preset) {
    throw new Error('未找到 prompts 与 prompt_order；请选择 SillyTavern 聊天补全预设 JSON。');
  }
  const sourceName = isRecord(parsed) && isRecord(parsed.entry)
    ? readString(parsed.entry.name).trim()
    : isRecord(source)
      ? readString(source.name).trim()
      : '';
  const name = sourceName || fileName.replace(/\.json$/i, '').trim() || '未命名酒馆预设';
  const sourceHash = calculateSourceHash(preset);
  const wrappedEntry = isRecord(parsed) && isRecord(parsed.entry)
    ? parsed.entry
    : null;
  const entry: ManagedTavernPresetEntry = {
    id: createPresetId(name, importedAt, sourceHash),
    name,
    importedAt,
    sourceHash,
    selectedCharacterId: resolveTavernPresetOrder(
      preset,
      wrappedEntry ? readInteger(wrappedEntry.selectedCharacterId) : undefined,
    ).characterId,
    preset,
    customization: normalizeCustomization(wrappedEntry?.customization),
  };
  const resolved = resolveEffectiveTavernPreset(
    {
      ...createDefaultTavernManagementSettings(),
      enabled: true,
      activePresetId: entry.id,
      entries: [entry],
    },
    { scope: 'turn' },
  );
  return {
    entry,
    repaired,
    exceedsInjectionBudget: resolved.items.some((item) => item.status === 'over_budget'),
  };
}

export function getActiveTavernPreset(
  settings: TavernManagementSettings,
): ManagedTavernPresetEntry | null {
  return settings.entries.find((entry) => entry.id === settings.activePresetId)
    ?? settings.entries[0]
    ?? null;
}

function replaceTavernMacros(content: string, playerName: string): string {
  const user = playerName.trim() || '玩家';
  return content
    .replace(/\{\{\s*(?:user|user_name)\s*\}\}/gi, user)
    .replace(/<user>/gi, user)
    .replace(/\{\{\s*(?:char|char_name)\s*\}\}/gi, '叙事系统')
    .replace(/<(?:char|charname|bot)>/gi, '叙事系统');
}

function scopeMatches(itemScope: TavernPresetScope, requestScope: CreativeNarrativeScope): boolean {
  return itemScope === 'all' || itemScope === requestScope;
}

function looksLikeChainOfThought(content: string): boolean {
  return /<(?:think|thinking|analysis)>|思维链|chain[- ]of[- ]thought|逐步思考|内部思考/i.test(content);
}

export function getTavernSlotKey(orderIndex: number, identifier: string): string {
  return `${orderIndex}:${identifier}`;
}

export function resolveEffectiveTavernPreset(
  settings: TavernManagementSettings | undefined,
  options: { scope: CreativeNarrativeScope; playerName?: string },
): ResolvedTavernPreset {
  const entry = settings?.enabled ? getActiveTavernPreset(settings) : null;
  if (!entry) {
    return {
      entry: null,
      characterId: null,
      items: [],
      includedCharacters: 0,
      characterLimit: TAVERN_INJECTION_CHARACTER_LIMIT,
    };
  }
  const order = resolveTavernPresetOrder(entry.preset, entry.selectedCharacterId);
  const promptMap = new Map(entry.preset.prompts.map((prompt) => [prompt.identifier, prompt]));
  const items: ResolvedTavernItem[] = [];
  let usedCharacters = 0;

  for (let orderIndex = 0; orderIndex < order.order.length; orderIndex += 1) {
    const slot = order.order[orderIndex];
    const slotKey = getTavernSlotKey(orderIndex, slot.identifier);
    const override = entry.customization.itemOverrides[slotKey] ?? {};
    const prompt = promptMap.get(slot.identifier);
    const originalRole = prompt?.role ?? 'system';
    const assistantHandling = originalRole === 'assistant'
      ? normalizeAssistantHandling(override.assistantHandling)
      : 'disabled';
    const scope = normalizeScope(override.scope);
    const content = replaceTavernMacros(
      override.contentOverride ?? prompt?.content ?? '',
      options.playerName ?? '',
    ).trim();
    let role: TavernPresetMessageRole = originalRole;
    let status: TavernResolutionStatus = 'included';

    if ((override.enabled ?? slot.enabled) === false) {
      status = 'disabled';
    } else if (!scopeMatches(scope, options.scope)) {
      status = 'out_of_scope';
    } else if (TAVERN_RESERVED_RUNTIME_SLOTS.has(slot.identifier.toLowerCase())) {
      status = 'reserved_runtime_slot';
    } else if (!prompt) {
      status = 'missing_prompt';
    } else if (!content) {
      status = 'empty_content';
    } else if (originalRole === 'assistant') {
      if (assistantHandling === 'creative_rule') {
        role = 'system';
      } else if (assistantHandling === 'few_shot') {
        const previous = items[items.length - 1];
        if (
          !previous
          || previous.status !== 'included'
          || previous.role !== 'user'
          || looksLikeChainOfThought(content)
        ) {
          status = 'assistant_incompatible';
        }
      } else {
        status = 'assistant_incompatible';
      }
    }
    if (status === 'included' && usedCharacters + content.length > TAVERN_INJECTION_CHARACTER_LIMIT) {
      status = 'over_budget';
    }
    if (status === 'included') usedCharacters += content.length;
    items.push({
      slotKey,
      orderIndex,
      identifier: slot.identifier,
      name: prompt?.name || slot.identifier,
      originalRole,
      role,
      content,
      scope,
      assistantHandling,
      status,
      characters: content.length,
    });
  }
  return {
    entry,
    characterId: order.characterId,
    items,
    includedCharacters: usedCharacters,
    characterLimit: TAVERN_INJECTION_CHARACTER_LIMIT,
  };
}

export function exportManagedTavernPreset(entry: ManagedTavernPresetEntry): unknown {
  return {
    format: 'chronicles-of-chaos-v2-tavern-preset',
    version: 1,
    exportedAt: new Date().toISOString(),
    entry,
  };
}
