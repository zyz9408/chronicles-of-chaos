import { describe, expect, it } from 'vitest';
import { threeKingdomsPrompts } from './prompts';

describe('threeKingdomsPrompts', () => {
  it('documents local elite governance pressure as a worldbook baseline', () => {
    expect(threeKingdomsPrompts.narrativeBaseline).toContain('地方豪强');
    expect(threeKingdomsPrompts.narrativeBaseline).toContain('登记户口和清丈田亩');
    expect(threeKingdomsPrompts.narrativeBaseline).toContain('文书账册');
    expect(threeKingdomsPrompts.narrativeBaseline).toContain('部落豪帅');
  });

  it('builds period atmosphere from causal institutions instead of generic scenery', () => {
    expect(threeKingdomsPrompts.narrativeBaseline).toContain('环境只在影响人物判断、行动难度或局势结果时描写');
    expect(threeKingdomsPrompts.narrativeBaseline).toContain('官职、礼法、军令、交通、钱粮、人物取舍和实际后果');
    expect(threeKingdomsPrompts.narrativeBaseline).not.toContain('环境描写烘托时代氛围');
  });
});
