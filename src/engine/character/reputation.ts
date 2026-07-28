const REPUTATION_SCORE_MIN = -1000;
const REPUTATION_SCORE_MAX = 1000;

const FAME_NEGATIVE_TIERS = [
  '略有恶名',
  '小有恶名',
  '恶名渐起',
  '恶评四起',
  '名声败坏',
  '众人侧目',
  '恶名远播',
  '声名狼藉',
  '人人唾弃',
  '恶名昭著',
] as const;

const FAME_POSITIVE_TIERS = [
  '略有善名',
  '小有名声',
  '颇有声望',
  '名声渐隆',
  '美名渐播',
  '远近称道',
  '声望卓著',
  '美名远扬',
  '万众敬仰',
  '名满天下',
] as const;

const MORALITY_NEGATIVE_TIERS = [
  '略有失德',
  '小有恶行',
  '德行有亏',
  '行止失范',
  '品行败坏',
  '众议其非',
  '恶行昭彰',
  '德望尽丧',
  '人神共愤',
  '大逆不道',
] as const;

const MORALITY_POSITIVE_TIERS = [
  '略有德名',
  '小有善行',
  '行事有节',
  '德行渐显',
  '仁义可称',
  '众人敬服',
  '德望渐隆',
  '德高望重',
  '仁德远播',
  '圣德昭然',
] as const;

export function clampReputationScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(REPUTATION_SCORE_MIN, Math.min(REPUTATION_SCORE_MAX, Math.round(value)));
}

export function getFameTierLabel(value: number): string {
  return getSignedTierLabel(value, '声名未显', FAME_NEGATIVE_TIERS, FAME_POSITIVE_TIERS);
}

export function getMoralityTierLabel(value: number): string {
  return getSignedTierLabel(value, '德行未定', MORALITY_NEGATIVE_TIERS, MORALITY_POSITIVE_TIERS);
}

function getSignedTierLabel(
  value: number,
  neutralLabel: string,
  negativeTiers: readonly string[],
  positiveTiers: readonly string[],
): string {
  const score = clampReputationScore(value);
  if (score === 0) return neutralLabel;

  const index = Math.min(9, Math.max(0, Math.ceil(Math.abs(score) / 100) - 1));
  return score < 0 ? negativeTiers[index] : positiveTiers[index];
}
