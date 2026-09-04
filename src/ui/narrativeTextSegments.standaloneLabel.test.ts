import { describe, expect, it } from 'vitest';
import { parseNarrativeTextSegments } from './narrativeTextSegments';

describe('parseNarrativeTextSegments standalone labels', () => {
  it('assigns following lines to standalone bracket speaker labels', () => {
    const segments = parseNarrativeTextSegments([
      '\u3010Narrator\u3011',
      'Liu Gou did not remain at the camp gate.',
      '',
      '\u3010LiuGou\u3011',
      '"Polish the blades and tighten the armor straps."',
      '',
      '\u3010Narrator\u3011',
      'The order quieted the soldiers.',
    ].join('\n'));

    expect(segments).toEqual([
      { type: 'narration', text: 'Liu Gou did not remain at the camp gate.' },
      {
        type: 'dialogue',
        speaker: 'LiuGou',
        speakerSource: 'explicit',
        text: '"Polish the blades and tighten the armor straps."',
      },
      { type: 'narration', text: 'The order quieted the soldiers.' },
    ]);
  });
});
