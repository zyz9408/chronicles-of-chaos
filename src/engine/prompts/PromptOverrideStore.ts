export interface PromptOverride {
  promptId: string;
  content: string;
  updatedAt: string;
  version: number;
}

export interface PromptOverrideState {
  schema: 'coc.v2.prompt-overrides';
  version: 1;
  overrides: Record<string, PromptOverride>;
}

export interface PromptOverrideValidationResult {
  ok: boolean;
  normalizedContent?: string;
  error?: string;
}

export const PROMPT_OVERRIDE_STORAGE_KEY = 'coc-v2.promptOverrides.v1';
export const PROMPT_OVERRIDE_MAX_LENGTH = 12000;
export const PROMPT_OVERRIDE_MIN_LENGTH = 10;

const emptyState = (): PromptOverrideState => ({
  schema: 'coc.v2.prompt-overrides',
  version: 1,
  overrides: {},
});

const getStorage = (storage?: Storage): Storage | null => {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
};

export function readPromptOverrideState(storage?: Storage): PromptOverrideState {
  const target = getStorage(storage);
  if (!target) return emptyState();

  try {
    const parsed = JSON.parse(target.getItem(PROMPT_OVERRIDE_STORAGE_KEY) ?? 'null') as Partial<PromptOverrideState> | null;
    if (!parsed || parsed.schema !== 'coc.v2.prompt-overrides' || parsed.version !== 1 || !parsed.overrides) {
      return emptyState();
    }

    return {
      schema: 'coc.v2.prompt-overrides',
      version: 1,
      overrides: parsed.overrides,
    };
  } catch {
    return emptyState();
  }
}

export function writePromptOverrideState(state: PromptOverrideState, storage?: Storage): void {
  const target = getStorage(storage);
  if (!target) {
    throw new Error('Prompt override storage is unavailable.');
  }

  target.setItem(PROMPT_OVERRIDE_STORAGE_KEY, JSON.stringify(state));
}

export function isPromptOverrideEditable(promptId: string): boolean {
  return promptId.trim().length > 0;
}

export function validatePromptOverrideContent(content: string): PromptOverrideValidationResult {
  const normalizedContent = content.trim();

  if (!normalizedContent) {
    return { ok: false, error: '提示词内容不能为空。' };
  }

  if (normalizedContent.length < PROMPT_OVERRIDE_MIN_LENGTH) {
    return { ok: false, error: `提示词内容至少需要 ${PROMPT_OVERRIDE_MIN_LENGTH} 个字符。` };
  }

  if (normalizedContent.length > PROMPT_OVERRIDE_MAX_LENGTH) {
    return { ok: false, error: `提示词内容不能超过 ${PROMPT_OVERRIDE_MAX_LENGTH} 个字符。` };
  }

  return { ok: true, normalizedContent };
}

export function getPromptOverride(promptId: string, storage?: Storage): PromptOverride | null {
  return readPromptOverrideState(storage).overrides[promptId] ?? null;
}

export function savePromptOverride(promptId: string, content: string, storage?: Storage): PromptOverride {
  if (!isPromptOverrideEditable(promptId)) {
    throw new Error(`Prompt override is not editable: ${promptId}`);
  }

  const validation = validatePromptOverrideContent(content);
  if (!validation.ok || !validation.normalizedContent) {
    throw new Error(validation.error ?? '提示词内容无效。');
  }

  const state = readPromptOverrideState(storage);
  const previous = state.overrides[promptId];
  const next: PromptOverride = {
    promptId,
    content: validation.normalizedContent,
    updatedAt: new Date().toISOString(),
    version: previous ? previous.version + 1 : 1,
  };

  writePromptOverrideState({
    ...state,
    overrides: {
      ...state.overrides,
      [promptId]: next,
    },
  }, storage);

  return next;
}

export function deletePromptOverride(promptId: string, storage?: Storage): void {
  const state = readPromptOverrideState(storage);
  if (!state.overrides[promptId]) return;

  const nextOverrides = { ...state.overrides };
  delete nextOverrides[promptId];
  writePromptOverrideState({ ...state, overrides: nextOverrides }, storage);
}

export function listPromptOverrides(storage?: Storage): PromptOverride[] {
  return Object.values(readPromptOverrideState(storage).overrides)
    .sort((left, right) => left.promptId.localeCompare(right.promptId));
}

export function clearPromptOverrides(storage?: Storage): void {
  writePromptOverrideState(emptyState(), storage);
}

export function replacePromptOverrides(overrides: PromptOverride[], storage?: Storage): void {
  const nextOverrides: Record<string, PromptOverride> = {};

  for (const override of overrides) {
    nextOverrides[override.promptId] = override;
  }

  writePromptOverrideState({
    schema: 'coc.v2.prompt-overrides',
    version: 1,
    overrides: nextOverrides,
  }, storage);
}
