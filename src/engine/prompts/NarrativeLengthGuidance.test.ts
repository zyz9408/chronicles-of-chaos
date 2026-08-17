import { describe, expect, it } from 'vitest';
import {
  buildNarrativeLengthFinalReminder,
  buildNarrativeLengthGuidance,
  buildNarrativeLengthRegenerationDirective,
  countNarrativeCharacters,
  evaluateNarrativeLength,
  getNarrativeLengthContract,
  shouldRegenerateNarrativeLength,
} from './NarrativeLengthGuidance';

describe('NarrativeLengthGuidance', () => {
  it('keeps every narrative length tier in one structured contract', () => {
    expect(getNarrativeLengthContract('compact')).toMatchObject({
      preference: 'compact',
      label: '精简',
      minimumCharacters: 300,
      maximumCharacters: 600,
      retryMinimumCharacters: 270,
      rangeText: '300-600 字',
    });
    expect(getNarrativeLengthContract('standard')).toMatchObject({
      minimumCharacters: 600,
      maximumCharacters: 1000,
      retryMinimumCharacters: 540,
    });
    expect(getNarrativeLengthContract('rich')).toMatchObject({
      minimumCharacters: 1000,
      maximumCharacters: 1600,
      retryMinimumCharacters: 900,
    });
    expect(getNarrativeLengthContract('long')).toMatchObject({
      minimumCharacters: 1600,
      maximumCharacters: 2400,
      retryMinimumCharacters: 1440,
    });
  });

  it('states a hard minimum and safe expansion rules in the final reminder', () => {
    const contract = getNarrativeLengthContract('rich');
    const guidance = buildNarrativeLengthGuidance(contract);
    const reminder = buildNarrativeLengthFinalReminder(contract);

    expect(guidance).toContain('最低 1000 个非空白字符');
    expect(reminder).toContain('narrativeText 仍必须不少于 1000 个非空白字符');
    expect(reminder).toContain('目标范围为 1000-1600 字');
    expect(reminder).toContain('不新增玩家决定');
    expect(reminder).toContain('不改变判定、胜负、时间、钱财、物品或其他写回事实');
    expect(reminder).toContain('禁止用背景复述');
  });

  it('evaluates only non-whitespace narrative characters without mutating the text', () => {
    const contract = getNarrativeLengthContract('rich');
    const shortText = `${'洛'.repeat(799)} \n 阳`;
    const targetText = '城'.repeat(1200);
    const longText = '军'.repeat(1700);

    expect(countNarrativeCharacters(shortText)).toBe(800);
    expect(evaluateNarrativeLength(shortText, contract)).toMatchObject({
      actualCharacters: 800,
      status: 'under_minimum',
      meetsMinimum: false,
    });
    expect(evaluateNarrativeLength(targetText, contract)).toMatchObject({
      actualCharacters: 1200,
      status: 'within_target',
      meetsMinimum: true,
    });
    expect(evaluateNarrativeLength(longText, contract)).toMatchObject({
      actualCharacters: 1700,
      status: 'over_target',
      meetsMinimum: true,
    });
  });

  it('regenerates rich and long tiers only below their 90% retry threshold when enabled', () => {
    const richEvaluation = evaluateNarrativeLength(
      '短'.repeat(800),
      getNarrativeLengthContract('rich'),
    );
    const toleratedRichEvaluation = evaluateNarrativeLength(
      '短'.repeat(950),
      getNarrativeLengthContract('rich'),
    );
    const standardEvaluation = evaluateNarrativeLength(
      '短'.repeat(500),
      getNarrativeLengthContract('standard'),
    );
    const directive = buildNarrativeLengthRegenerationDirective(richEvaluation);

    expect(shouldRegenerateNarrativeLength(richEvaluation)).toBe(true);
    expect(shouldRegenerateNarrativeLength(toleratedRichEvaluation)).toBe(false);
    expect(toleratedRichEvaluation).toMatchObject({
      meetsMinimum: false,
      withinRetryTolerance: true,
    });
    expect(shouldRegenerateNarrativeLength(standardEvaluation)).toBe(false);
    expect(shouldRegenerateNarrativeLength(richEvaluation, false)).toBe(false);
    expect(directive).toContain('上一份候选的 narrativeText 只有 800 个非空白字符');
    expect(directive).toContain('重写阈值 900 个');
    expect(directive).toContain('该候选已被整份丢弃');
    expect(directive).toContain('重新给出 narrativeText、suggestedActions、statePatches/statePatch');
    expect(directive).toContain('不得只补写正文片段');
    expect(directive).not.toContain('短短短');
  });
});
