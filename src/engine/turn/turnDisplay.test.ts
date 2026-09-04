import { describe, expect, it } from 'vitest';
import {
  buildTurnDisplayMeta,
  formatElapsedTime,
  formatTokenCount,
  getPromptCacheHitRate,
  getTurnDisplayTitle,
} from './turnDisplay';

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
      model: 'deepseek-v4-pro',
      provider: 'deepseek',
      narrativeLength: {
        preference: 'rich',
        label: '丰富',
        minimumCharacters: 1000,
        maximumCharacters: 1600,
        actualCharacters: 1120,
        status: 'within_target',
        meetsMinimum: true,
      },
      memoryRecall: {
        query: '回想旧约',
        candidateCount: 1,
        omittedCount: 0,
        strong: [],
        weak: [],
      },
      presentationSpeakerFacts: [{
        segmentIndex: 1,
        speakerActorId: 'npc_guan_yu',
        speakerLabel: '关羽',
        identitySource: 'full_npc',
        sex: 'male',
      }],
    });

    expect(meta.title).toBe('第 1 回合');
    expect(meta.elapsedMs).toBe(55120);
    expect(meta.promptTokens).toBe(12000);
    expect(meta.completionTokens).toBe(3444);
    expect(meta.totalTokens).toBe(15444);
    expect(meta.rawResponse).toContain('开局正文');
    expect(meta.reasoningSummary).toBeUndefined();
    expect(meta.memoryRecall).toMatchObject({ query: '回想旧约', candidateCount: 1 });
    expect(meta.narrativeLength).toMatchObject({
      preference: 'rich',
      actualCharacters: 1120,
      meetsMinimum: true,
    });
    expect(meta.presentationSpeakerFacts).toEqual([
      expect.objectContaining({ segmentIndex: 1, speakerActorId: 'npc_guan_yu' }),
    ]);
  });

  it('uses an explicit title before falling back to the turn number', () => {
    expect(getTurnDisplayTitle({ turnNumber: 1, displayMeta: { title: '开场剧情' } })).toBe('开场剧情');
    expect(getTurnDisplayTitle({ turnNumber: 3 })).toBe('第 3 回合');
  });

  it('calculates cache hit rate from provider-specific usage accounting', () => {
    expect(getPromptCacheHitRate({
      provider: 'deepseek',
      promptTokens: 1000,
      cacheReadTokens: 900,
      cacheMissTokens: 100,
    })).toBe(0.9);
    expect(getPromptCacheHitRate({
      provider: 'anthropic',
      promptTokens: 100,
      cacheReadTokens: 800,
      cacheWriteTokens: 100,
    })).toBe(0.8);
    expect(getPromptCacheHitRate({ promptTokens: 1000 })).toBeUndefined();
  });
});
