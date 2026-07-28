import { getPromptOverride } from './PromptOverrideStore';

export function resolvePromptContent(promptId: string, defaultContent: string, storage?: Storage): string {
  return getPromptOverride(promptId, storage)?.content ?? defaultContent;
}

export function renderPromptTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{([A-Za-z0-9_.]+)\}/g, (match, key: string) => {
    if (!(key in values)) return match;
    const value = values[key];
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  });
}

export function resolvePromptTemplate(
  promptId: string,
  defaultTemplate: string,
  values: Record<string, unknown>,
  storage?: Storage,
): string {
  return renderPromptTemplate(resolvePromptContent(promptId, defaultTemplate, storage), values);
}
