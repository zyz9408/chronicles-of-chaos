import { describe, expect, it } from 'vitest';
import { narrativeTurnDisplayLabels } from './narrativeTurnDisplayLabels';

describe('narrativeTurnDisplayLabels', () => {
  it('keeps visible turn toolbar labels readable', () => {
    expect(narrativeTurnDisplayLabels).toEqual({
      sectionTitle: '剧情正文',
      promptTokens: '入',
      completionTokens: '出',
    });
  });
});
