import {
  PROMPT_OVERRIDE_MAX_LENGTH,
  type PromptOverride,
  getPromptOverride,
  listPromptOverrides,
  replacePromptOverrides,
  validatePromptOverrideContent,
} from './PromptOverrideStore';
import {
  getPromptRegistry,
  isRuntimeOverridePromptEntry,
  type PromptEditLevel,
  type PromptRegistryCategory,
  type PromptRiskLevel,
} from './PromptRegistry';

export const PROMPT_OVERRIDES_EXPORT_TYPE = 'coc-v2-prompt-overrides';
export const PROMPT_OVERRIDES_EXPORT_VERSION = 1;

export interface PromptOverridesExportPayload {
  type: typeof PROMPT_OVERRIDES_EXPORT_TYPE;
  version: typeof PROMPT_OVERRIDES_EXPORT_VERSION;
  exportedAt: string;
  overrides: PromptOverride[];
  prompts: PromptExportedEntry[];
}

export interface PromptExportedEntry {
  promptId: string;
  category: PromptRegistryCategory;
  title: string;
  riskLevel: PromptRiskLevel;
  editLevel: PromptEditLevel;
  protocolBound: boolean;
  source: 'default' | 'override';
  content: string;
  updatedAt?: string;
}

export interface PromptImportSkip {
  promptId: string;
  reason: string;
}

export interface PromptImportResult {
  ok: boolean;
  importedCount: number;
  skipped: PromptImportSkip[];
  hasHighRiskOverrides: boolean;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function buildPromptOverridesExport(storage?: Storage): PromptOverridesExportPayload {
  const overrides = listPromptOverrides(storage);
  return {
    type: PROMPT_OVERRIDES_EXPORT_TYPE,
    version: PROMPT_OVERRIDES_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    overrides,
    prompts: buildPromptExportEntries(storage),
  };
}

export function makePromptOverridesExportFilename(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `coc-v2-prompts-${stamp}.json`;
}

export function importPromptOverridesFromJson(jsonText: string, storage?: Storage): PromptImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      ok: false,
      importedCount: 0,
      skipped: [],
      hasHighRiskOverrides: false,
      error: '无法解析提示词导入 JSON。',
    };
  }

  if (!isRecord(parsed) || parsed.type !== PROMPT_OVERRIDES_EXPORT_TYPE) {
    return {
      ok: false,
      importedCount: 0,
      skipped: [],
      hasHighRiskOverrides: false,
      error: '导入文件类型不是 coc-v2-prompt-overrides。',
    };
  }

  if (parsed.version !== PROMPT_OVERRIDES_EXPORT_VERSION) {
    return {
      ok: false,
      importedCount: 0,
      skipped: [],
      hasHighRiskOverrides: false,
      error: '导入文件版本不受支持。',
    };
  }

  if (!Array.isArray(parsed.overrides) && !Array.isArray(parsed.prompts)) {
    return {
      ok: false,
      importedCount: 0,
      skipped: [],
      hasHighRiskOverrides: false,
      error: '导入文件缺少 prompts 或 overrides 数组。',
    };
  }

  const registryById = new Map(getPromptRegistry().map((entry) => [entry.id, entry]));
  const imported: PromptOverride[] = [];
  const skipped: PromptImportSkip[] = [];
  let hasHighRiskOverrides = false;
  const incomingItems: unknown[] = Array.isArray(parsed.prompts)
    ? parsed.prompts
    : Array.isArray(parsed.overrides) ? parsed.overrides : [];

  for (const item of incomingItems) {
    const promptId = isRecord(item) && typeof item.promptId === 'string' ? item.promptId : '';
    const content = isRecord(item) && typeof item.content === 'string' ? item.content : '';

    if (!promptId) {
      skipped.push({ promptId: '(missing)', reason: 'missing promptId' });
      continue;
    }

    const entry = registryById.get(promptId);
    if (!entry) {
      skipped.push({ promptId, reason: 'unknown promptId' });
      continue;
    }

    if (!isRuntimeOverridePromptEntry(entry)) {
      skipped.push({ promptId, reason: 'prompt is not runtime-editable' });
      continue;
    }

    const validation = validatePromptOverrideContent(content);
    if (!validation.ok || !validation.normalizedContent) {
      skipped.push({ promptId, reason: validation.error ?? `content must be 1-${PROMPT_OVERRIDE_MAX_LENGTH} chars` });
      continue;
    }

    if (Array.isArray(parsed.prompts) && content === getDefaultPromptContent(entry)) {
      continue;
    }

    if (entry.riskLevel === 'high' || entry.editLevel === 'locked' || entry.protocolBound) {
      hasHighRiskOverrides = true;
    }

    imported.push({
      promptId,
      content: validation.normalizedContent,
      updatedAt: isRecord(item) && typeof item.updatedAt === 'string'
        ? item.updatedAt
        : new Date().toISOString(),
      version: isRecord(item) && typeof item.version === 'number' && Number.isFinite(item.version)
        ? item.version
        : 1,
    });
  }

  replacePromptOverrides(imported, storage);

  return {
    ok: true,
    importedCount: imported.length,
    skipped,
    hasHighRiskOverrides,
  };
}

function buildPromptExportEntries(storage?: Storage): PromptExportedEntry[] {
  return getPromptRegistry()
    .filter(isRuntimeOverridePromptEntry)
    .map((entry) => {
      const override = getPromptOverride(entry.id, storage);
      return {
        promptId: entry.id,
        category: entry.category,
        title: entry.displayTitleZh ?? entry.title,
        riskLevel: entry.riskLevel,
        editLevel: entry.editLevel,
        protocolBound: entry.protocolBound,
        source: override ? 'override' : 'default',
        content: override?.content ?? getDefaultPromptContent(entry),
        ...(override?.updatedAt ? { updatedAt: override.updatedAt } : {}),
      };
    });
}

function getDefaultPromptContent(entry: ReturnType<typeof getPromptRegistry>[number]): string {
  return entry.defaultContent
    ?? entry.defaultContentTemplate
    ?? entry.defaultContentPreview
    ?? '';
}
