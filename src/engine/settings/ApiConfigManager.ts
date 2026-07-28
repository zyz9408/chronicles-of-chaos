import { v4 as uuidv4 } from '../turn/uuid';
import {
  idbClear,
  idbDelete,
  idbDeleteMeta,
  idbGetAll,
  idbGetMeta,
  idbPut,
  idbSetMeta,
} from '../storage/IndexedDbStore';

export type ApiProviderId =
  | 'openai'
  | 'openai_compatible'
  | 'deepseek'
  | 'gemini'
  | 'anthropic'
  | 'qwen'
  | 'zhipu'
  | 'moonshot'
  | 'doubao'
  | 'xai'
  | 'groq'
  | 'mistral'
  | 'ollama'
  | 'lm_studio'
  | 'custom';

export interface ApiProviderOption {
  id: ApiProviderId;
  label: string;
  defaultBaseUrl: string;
  modelsEndpoint?: string;
}

export interface ApiConfigArchive {
  id: string;
  name: string;
  provider: ApiProviderId;
  baseUrl: string;
  apiKey: string;
  /** Default model kept for legacy callers and fully resolved runtime configs. */
  model: string;
  /** Models exposed by this endpoint. Legacy records are upgraded from `model`. */
  models?: string[];
  temperature?: number;
  maxOutputTokens?: number;
  createdAt: string;
  updatedAt: string;
}

type ApiConfigSaveInput = Omit<ApiConfigArchive, 'temperature' | 'maxOutputTokens'> & {
  temperature?: number | string;
  maxOutputTokens?: number | string;
};

export type ApiTaskId =
  | 'mainNarrative'
  | 'stateWriteback'
  | 'quickInteraction'
  | 'memorySummary'
  | 'embedding'
  | 'npcSimulation'
  | 'npcCompletion'
  | 'worldEvolution'
  | 'imagePrompt';

export interface ApiTaskRoute {
  configId: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export type ApiTaskRouteInput = ApiTaskRoute | string | null;
export type ApiTaskRoutes = Record<ApiTaskId, ApiTaskRoute | null>;
export type ApiTaskRoutesArchive = Partial<Record<ApiTaskId, ApiTaskRouteInput>>;

const API_CONFIGS_KEY = 'coc_v2_api_configs';
const API_ROUTES_KEY = 'coc_v2_api_task_routes';
const API_ROUTES_META_KEY = 'apiTaskRoutes';
const API_LEGACY_MIGRATION_META_KEY = 'legacyApiSettingsMigratedFromLocalStorage';

export interface ApiSettingsArchive {
  schema: 'coc.v2.api-settings';
  version: 1 | 2;
  exportedAt: string;
  configs: ApiConfigArchive[];
  routes: ApiTaskRoutesArchive;
}

export interface ImportApiSettingsOptions {
  mode?: 'merge' | 'replace';
}

export const API_PROVIDER_OPTIONS: ApiProviderOption[] = [
  { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'openai_compatible', label: 'OpenAI兼容', defaultBaseUrl: '' },
  { id: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1' },
  { id: 'gemini', label: 'Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'anthropic', label: 'Anthropic Claude', defaultBaseUrl: 'https://api.anthropic.com/v1' },
  { id: 'qwen', label: '通义千问/Qwen', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'zhipu', label: '智谱 GLM', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'moonshot', label: 'Moonshot/Kimi', defaultBaseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'doubao', label: '豆包/火山方舟', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'xai', label: 'xAI Grok', defaultBaseUrl: 'https://api.x.ai/v1' },
  { id: 'groq', label: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', label: 'Mistral', defaultBaseUrl: 'https://api.mistral.ai/v1' },
  { id: 'ollama', label: 'Ollama 本地', defaultBaseUrl: 'http://localhost:11434/v1' },
  { id: 'lm_studio', label: 'LM Studio 本地', defaultBaseUrl: 'http://localhost:1234/v1' },
  { id: 'custom', label: '自定义接口', defaultBaseUrl: '' },
];

export const API_TASKS: Array<{ id: ApiTaskId; label: string; description: string; required?: boolean }> = [
  { id: 'mainNarrative', label: '主剧情', description: '主剧情回合，使用强模型保证叙事质量。', required: true },
  { id: 'stateWriteback', label: '状态写回', description: '整理主回合返回的状态补丁和写回结构；未选择时跳过独立整理，使用主回合原始写回。' },
  { id: 'quickInteraction', label: '快速互动', description: '闲聊、短文本反馈、轻量补全。' },
  { id: 'memorySummary', label: '记忆压缩/摘要', description: '近期记忆压缩、中期摘要、长期事实与 NPC/地点记忆总结。' },
  { id: 'embedding', label: '向量嵌入', description: '记忆向量化与语义检索索引。' },
  { id: 'npcSimulation', label: 'NPC动态模拟', description: '本回合相关 NPC 心态预处理与反应建议。' },
  { id: 'npcCompletion', label: '开局/NPC建档', description: '开局历史人物补全、NPC 基础档案生成。' },
  { id: 'worldEvolution', label: '世界演化', description: '后台局势演化、剧情计划维护。' },
  { id: 'imagePrompt', label: '文生图提示词', description: '后续图片生成前的画面提示词整理。' },
];

const defaultRoutes = (): ApiTaskRoutes => ({
  mainNarrative: null,
  stateWriteback: null,
  quickInteraction: null,
  memorySummary: null,
  embedding: null,
  npcSimulation: null,
  npcCompletion: null,
  worldEvolution: null,
  imagePrompt: null,
});

const getStorage = (storage?: Storage): Storage | null => {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
};

export function createApiConfigDraft(provider: ApiProviderId = 'openai_compatible'): ApiConfigArchive {
  const providerOption = API_PROVIDER_OPTIONS.find((option) => option.id === provider) ?? API_PROVIDER_OPTIONS[1];
  const now = new Date().toISOString();

  return {
    id: uuidv4(),
    name: `${providerOption.label} 配置`,
    provider: providerOption.id,
    baseUrl: providerOption.defaultBaseUrl,
    apiKey: '',
    model: '',
    models: [],
    maxOutputTokens: 8192,
    createdAt: now,
    updatedAt: now,
  };
}

const optionalNumber = (value: number | string | undefined): number | undefined => {
  if (value === undefined || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const normalizeModelNames = (values: readonly string[]): string[] => Array.from(new Set(
  values.map((value) => value.trim()).filter(Boolean),
));

export function getApiConfigModels(config: Pick<ApiConfigArchive, 'model' | 'models'>): string[] {
  const configured = normalizeModelNames(config.models ?? []);
  if (configured.length > 0) return configured;

  const legacyModel = config.model.trim();
  return legacyModel ? [legacyModel] : [];
}

function normalizeStoredApiConfig(config: ApiConfigArchive): ApiConfigArchive {
  const models = getApiConfigModels(config);
  return {
    ...config,
    name: config.name.trim() || '未命名配置',
    baseUrl: config.baseUrl.trim(),
    apiKey: config.apiKey.trim(),
    model: models[0] ?? '',
    models,
    temperature: optionalNumber(config.temperature),
    maxOutputTokens: optionalNumber(config.maxOutputTokens),
  };
}

export function prepareApiConfigForSave(config: ApiConfigSaveInput): ApiConfigArchive {
  const configuredModels = normalizeModelNames(config.models ?? []);
  const models = configuredModels.length > 0
    ? configuredModels
    : normalizeModelNames(config.model ? [config.model] : []);
  return {
    ...config,
    name: config.name.trim() || '未命名配置',
    baseUrl: config.baseUrl.trim(),
    apiKey: config.apiKey.trim(),
    model: models[0] ?? '',
    models,
    temperature: optionalNumber(config.temperature),
    maxOutputTokens: optionalNumber(config.maxOutputTokens),
  };
}

export function listApiConfigs(storage?: Storage): ApiConfigArchive[] {
  const target = getStorage(storage);
  if (!target) return [];

  try {
    const raw = JSON.parse(target.getItem(API_CONFIGS_KEY) ?? '[]') as ApiConfigArchive[];
    const normalized = Array.isArray(raw) ? raw.map(normalizeStoredApiConfig) : [];
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      target.setItem(API_CONFIGS_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return [];
  }
}

export function upsertApiConfig(config: ApiConfigArchive, storage?: Storage): ApiConfigArchive {
  const target = getStorage(storage);
  if (!target) return config;

  const existing = listApiConfigs(target);
  const now = new Date().toISOString();
  const previous = existing.find((item) => item.id === config.id);
  const next = normalizeStoredApiConfig({
    ...config,
    createdAt: previous?.createdAt ?? config.createdAt ?? now,
    updatedAt: now,
  });
  const list = [next, ...existing.filter((item) => item.id !== config.id)];
  target.setItem(API_CONFIGS_KEY, JSON.stringify(list));
  return next;
}

export function deleteApiConfig(configId: string, storage?: Storage): void {
  const target = getStorage(storage);
  if (!target) return;

  target.setItem(API_CONFIGS_KEY, JSON.stringify(listApiConfigs(target).filter((item) => item.id !== configId)));
  const routes = getApiTaskRoutes(target);
  for (const task of API_TASKS) {
    if (routes[task.id]?.configId === configId) {
      routes[task.id] = null;
    }
  }
  target.setItem(API_ROUTES_KEY, JSON.stringify(routes));
}

function normalizeApiTaskRoute(
  value: ApiTaskRouteInput | undefined,
  configs: ApiConfigArchive[],
): ApiTaskRoute | null {
  if (!value) return null;

  const configId = typeof value === 'string' ? value : value.configId;
  const config = configs.find((item) => item.id === configId);
  if (!config) return null;

  const availableModels = getApiConfigModels(config);
  const requestedModel = typeof value === 'string' ? '' : value.model.trim();
  const model = requestedModel && availableModels.includes(requestedModel)
    ? requestedModel
    : availableModels[0] ?? '';

  return {
    configId,
    model,
    temperature: typeof value === 'string' ? undefined : optionalNumber(value.temperature),
    maxOutputTokens: typeof value === 'string' ? undefined : optionalNumber(value.maxOutputTokens),
  };
}

function normalizeApiTaskRoutes(
  routes: ApiTaskRoutesArchive | undefined,
  configs: ApiConfigArchive[],
): ApiTaskRoutes {
  const normalized = defaultRoutes();
  for (const task of API_TASKS) {
    normalized[task.id] = normalizeApiTaskRoute(routes?.[task.id], configs);
  }
  return normalized;
}

export function getApiTaskRoutes(storage?: Storage): ApiTaskRoutes {
  const target = getStorage(storage);
  if (!target) return defaultRoutes();

  try {
    const raw = JSON.parse(target.getItem(API_ROUTES_KEY) ?? '{}') as ApiTaskRoutesArchive;
    const normalized = normalizeApiTaskRoutes(raw, listApiConfigs(target));
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      target.setItem(API_ROUTES_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return defaultRoutes();
  }
}

export function setApiTaskRoute(taskId: ApiTaskId, route: ApiTaskRouteInput, storage?: Storage): void {
  const target = getStorage(storage);
  if (!target) return;

  const routes = getApiTaskRoutes(target);
  routes[taskId] = normalizeApiTaskRoute(route, listApiConfigs(target));
  target.setItem(API_ROUTES_KEY, JSON.stringify(routes));
}

function materializeResolvedApiConfig(
  config: ApiConfigArchive,
  route?: ApiTaskRoute | null,
): ApiConfigArchive {
  const normalized = normalizeStoredApiConfig(config);
  return {
    ...normalized,
    model: route?.model || normalized.model,
    temperature: route?.temperature ?? normalized.temperature,
    maxOutputTokens: route?.maxOutputTokens ?? normalized.maxOutputTokens,
  };
}

export function resolveApiConfigForTask(taskId: ApiTaskId, storage?: Storage): ApiConfigArchive | null {
  const configs = listApiConfigs(storage);
  const routes = getApiTaskRoutes(storage);
  const route = routes[taskId];
  const routed = route ? configs.find((config) => config.id === route.configId) : null;
  if (routed) return materializeResolvedApiConfig(routed, route);

  const mainRoute = routes.mainNarrative;
  const main = mainRoute ? configs.find((config) => config.id === mainRoute.configId) : null;
  if (main) return materializeResolvedApiConfig(main, mainRoute);
  return configs[0] ? materializeResolvedApiConfig(configs[0]) : null;
}

export async function listApiConfigsAsync(): Promise<ApiConfigArchive[]> {
  await ensureLegacyApiSettingsMigrated();
  const raw = await idbGetAll<ApiConfigArchive>('apiConfigs');
  const normalized = raw.map(normalizeStoredApiConfig);
  await Promise.all(normalized.map(async (config, index) => {
    if (JSON.stringify(config) !== JSON.stringify(raw[index])) {
      await idbPut('apiConfigs', config);
    }
  }));
  return normalized.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function clearAllApiSettingsAsync(storage?: Storage): Promise<void> {
  await idbClear('apiConfigs');
  await idbDeleteMeta(API_ROUTES_META_KEY);
  const target = getStorage(storage);
  try {
    target?.removeItem(API_CONFIGS_KEY);
    target?.removeItem(API_ROUTES_KEY);
  } catch {
    // Legacy localStorage cleanup is best-effort.
  }
  await idbSetMeta(API_LEGACY_MIGRATION_META_KEY, true);
}

export async function upsertApiConfigAsync(config: ApiConfigArchive): Promise<ApiConfigArchive> {
  await ensureLegacyApiSettingsMigrated();

  const existing = await listApiConfigsAsync();
  const now = new Date().toISOString();
  const previous = existing.find((item) => item.id === config.id);
  const next = normalizeStoredApiConfig({
    ...config,
    createdAt: previous?.createdAt ?? config.createdAt ?? now,
    updatedAt: now,
  });
  await idbPut('apiConfigs', next);
  return next;
}

export async function deleteApiConfigAsync(configId: string): Promise<void> {
  await ensureLegacyApiSettingsMigrated();
  await idbDelete('apiConfigs', configId);

  const routes = await getApiTaskRoutesAsync();
  for (const task of API_TASKS) {
    if (routes[task.id]?.configId === configId) {
      routes[task.id] = null;
    }
  }
  await idbSetMeta(API_ROUTES_META_KEY, routes);
}

export async function getApiTaskRoutesAsync(): Promise<ApiTaskRoutes> {
  await ensureLegacyApiSettingsMigrated();
  const raw = (await idbGetMeta<ApiTaskRoutesArchive>(API_ROUTES_META_KEY)) ?? {};
  const normalized = normalizeApiTaskRoutes(raw, await listApiConfigsAsync());
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    await idbSetMeta(API_ROUTES_META_KEY, normalized);
  }
  return normalized;
}

export async function setApiTaskRouteAsync(taskId: ApiTaskId, route: ApiTaskRouteInput): Promise<void> {
  await ensureLegacyApiSettingsMigrated();

  const routes = await getApiTaskRoutesAsync();
  routes[taskId] = normalizeApiTaskRoute(route, await listApiConfigsAsync());
  await idbSetMeta(API_ROUTES_META_KEY, routes);
}

export async function resolveApiConfigForTaskAsync(taskId: ApiTaskId): Promise<ApiConfigArchive | null> {
  const configs = await listApiConfigsAsync();
  const routes = await getApiTaskRoutesAsync();
  const route = routes[taskId];
  const routed = route ? configs.find((config) => config.id === route.configId) : null;
  if (routed) return materializeResolvedApiConfig(routed, route);

  const mainRoute = routes.mainNarrative;
  const main = mainRoute ? configs.find((config) => config.id === mainRoute.configId) : null;
  if (main) return materializeResolvedApiConfig(main, mainRoute);
  return configs[0] ? materializeResolvedApiConfig(configs[0]) : null;
}

export async function resolveExplicitApiConfigForTaskAsync(taskId: ApiTaskId): Promise<ApiConfigArchive | null> {
  const configs = await listApiConfigsAsync();
  const routes = await getApiTaskRoutesAsync();
  const route = routes[taskId];
  if (!route) return null;
  const config = configs.find((item) => item.id === route.configId);
  return config ? materializeResolvedApiConfig(config, route) : null;
}

export async function exportApiSettings(): Promise<ApiSettingsArchive> {
  await ensureLegacyApiSettingsMigrated();
  return {
    schema: 'coc.v2.api-settings',
    version: 2,
    exportedAt: new Date().toISOString(),
    configs: await listApiConfigsAsync(),
    routes: await getApiTaskRoutesAsync(),
  };
}

export async function importApiSettings(
  archive: ApiSettingsArchive,
  options: ImportApiSettingsOptions = {},
): Promise<void> {
  if (
    archive.schema !== 'coc.v2.api-settings'
    || (archive.version !== 1 && archive.version !== 2)
    || !Array.isArray(archive.configs)
  ) {
    throw new Error('API 设置文件格式不正确');
  }

  await ensureLegacyApiSettingsMigrated();

  if (options.mode === 'replace') {
    await idbClear('apiConfigs');
  }

  for (const config of archive.configs) {
    await idbPut('apiConfigs', normalizeStoredApiConfig(config));
  }
  const allConfigs = (await idbGetAll<ApiConfigArchive>('apiConfigs')).map(normalizeStoredApiConfig);
  await idbSetMeta(API_ROUTES_META_KEY, normalizeApiTaskRoutes(archive.routes, allConfigs));
  await idbSetMeta(API_LEGACY_MIGRATION_META_KEY, true);
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey) return '未填写';
  if (apiKey.length <= 8) return `${apiKey.slice(0, 2)}***`;
  return `${apiKey.slice(0, 3)}***${apiKey.slice(-4)}`;
}

export function getProviderLabel(providerId: ApiProviderId): string {
  return API_PROVIDER_OPTIONS.find((provider) => provider.id === providerId)?.label ?? providerId;
}

async function ensureLegacyApiSettingsMigrated(): Promise<void> {
  if (await idbGetMeta<boolean>(API_LEGACY_MIGRATION_META_KEY)) return;

  for (const config of listApiConfigs()) {
    await idbPut('apiConfigs', normalizeStoredApiConfig(config));
  }
  await idbSetMeta(API_ROUTES_META_KEY, getApiTaskRoutes());
  await idbSetMeta(API_LEGACY_MIGRATION_META_KEY, true);
}
