export interface SuggestedActionInputSource {
  label: string;
  description?: string;
}

export const SUGGESTED_ACTION_SUMMARY_MAX_LENGTH = 16;

export function summarizeSuggestedAction(action: SuggestedActionInputSource): string {
  const source = (action.label.trim() || action.description?.trim() || '')
    .replace(/\s+/g, ' ')
    .replace(/^[“”"'「」『』]+|[“”"'「」『』]+$/g, '')
    .trim();
  if (!source) return '查看行动';

  const clauses = source
    .split(/[，。；：！？,.!?;]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  let summary = clauses[0] ?? source;

  if ([...summary].length < 6 && clauses[1]) {
    summary = `${summary} · ${clauses[1]}`;
  }

  const characters = [...summary];
  if (characters.length <= SUGGESTED_ACTION_SUMMARY_MAX_LENGTH) return summary;
  return `${characters.slice(0, SUGGESTED_ACTION_SUMMARY_MAX_LENGTH).join('')}…`;
}

export function appendSuggestedActionToInput(
  currentInput: string,
  action: SuggestedActionInputSource,
): string {
  const nextAction = (action.description?.trim() || action.label.trim());
  const existing = currentInput.trim().replace(/[；;。.!！?？]+$/u, '');

  if (!nextAction) return existing;
  if (!existing) return nextAction;

  return `${existing}；${nextAction}`;
}
