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
    expect(threeKingdomsPrompts.narrativeBaseline).toContain('环境需要帮助玩家理解空间、行动、阻力、风险或人物处境');
    expect(threeKingdomsPrompts.narrativeBaseline).toContain('官职、称谓、礼法、军令、器物、交通、钱粮、生活条件、人物取舍和实际后果');
    expect(threeKingdomsPrompts.narrativeBaseline).toContain('不强制古雅腔调');
    expect(threeKingdomsPrompts.narrativeBaseline).not.toContain('环境描写烘托时代氛围');
  });

  it('keeps copper money and physical gold as separate economic truths', () => {
    expect(threeKingdomsPrompts.narrativeBaseline).toContain('一千钱可显示为一贯');
    expect(threeKingdomsPrompts.narrativeBaseline).toContain('金不是铜钱余额的高位单位');
    expect(threeKingdomsPrompts.narrativeBaseline).toContain('金饼、马蹄金');
    expect(threeKingdomsPrompts.narrativeBaseline).toContain('不得自动折算成十贯');
  });
});
