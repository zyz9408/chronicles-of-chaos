export function countNarrativeCharacters(text: string): number {
  return text.replace(/\s+/g, '').length;
}

export function formatNarrativeWordCountLabel(text: string): string {
  return `正文约 ${countNarrativeCharacters(text)} 字`;
}
