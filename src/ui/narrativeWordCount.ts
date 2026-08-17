import { countNarrativeCharacters } from '../engine/prompts/NarrativeLengthGuidance';

export { countNarrativeCharacters };

export function formatNarrativeWordCountLabel(text: string): string {
  return `正文约 ${countNarrativeCharacters(text)} 字`;
}
