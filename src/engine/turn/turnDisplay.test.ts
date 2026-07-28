import { describe, expect, it } from 'vitest';
import { buildTurnDisplayMeta, formatElapsedTime, formatTokenCount, getTurnDisplayTitle } from './turnDisplay';

describe('turnDisplay', () => {
  it('formats token counts and elapsed time for the turn header', () => {
    expect(formatTokenCount(34072)).toBe('34,072');
    expect(formatTokenCount(undefined)).toBe('0');
    expect(formatElapsedTime(32000)).toBe('32s');
    expect(formatElapsedTime(90000)).toBe('1m 30s');
  });

  it('builds a stable display meta object from generation information', () => {
    const meta = buildTurnDisplayMeta({
      turnNumber: 1,
      elapsedMs: 55120,
      promptTokens: 12000,
      completionTokens: 3444,
      rawResponse: '{"narrativeText":"开局正文"}',
      reasoningSummary: '模型已完成公开摘要。',
      model: 'deepseek-v4-pro',
      provider: 'deepseek',
      memoryRecall: {
        query: '回想旧约',
        candidateCount: 1,
        omittedCount: 0,
        strong: [],
        weak: [],
      },
    });

    expect(meta.title).toBe('第 1 回合');
    expect(meta.elapsedMs).toBe(55120);
    expect(meta.promptTokens).toBe(12000);
    expect(meta.completionTokens).toBe(3444);
    expect(meta.totalTokens).toBe(15444);
    expect(meta.rawResponse).toContain('开局正文');
    expect(meta.reasoningSummary).toContain('公开摘要');
    expect(meta.memoryRecall).toMatchObject({ query: '回想旧约', candidateCount: 1 });
  });

  it('uses an explicit title before falling back to the turn number', () => {
    expect(getTurnDisplayTitle({ turnNumber: 1, displayMeta: { title: '开场剧情' } })).toBe('开场剧情');
    expect(getTurnDisplayTitle({ turnNumber: 3 })).toBe('第 3 回合');
  });
});
