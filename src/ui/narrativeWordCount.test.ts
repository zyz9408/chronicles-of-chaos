import { describe, expect, it } from 'vitest';
import { countNarrativeCharacters, formatNarrativeWordCountLabel } from './narrativeWordCount';

describe('narrativeWordCount', () => {
  it('counts non-whitespace narrative characters', () => {
    expect(countNarrativeCharacters('洛阳 风起\n兵至。')).toBe(7);
  });

  it('formats a compact narrative count label', () => {
    expect(formatNarrativeWordCountLabel('洛阳 风起\n兵至。')).toBe('正文约 7 字');
    expect(formatNarrativeWordCountLabel('')).toBe('正文约 0 字');
  });
});
