const RENDER_LABEL_PATTERN = /(?:^|\n)\s*【[^】\n]{1,12}】\s*/g;
const SPEAKER_LABEL_PATTERN = /(?:^|\n)\s*(?:旁白|叙述|Narrator)\s*[:：]\s*/gi;

export function sanitizeCombatReportText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(RENDER_LABEL_PATTERN, (match) => (match.startsWith('\n') ? '\n' : ''))
    .replace(SPEAKER_LABEL_PATTERN, (match) => (match.startsWith('\n') ? '\n' : ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function optionalSanitizedCombatReportField<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  const cleaned = sanitizeCombatReportText(value);
  return cleaned ? { [key]: cleaned } as Partial<Record<K, string>> : {};
}
