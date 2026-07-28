import { describe, expect, it } from 'vitest';
import {
  clampReputationScore,
  getFameTierLabel,
  getMoralityTierLabel,
} from './reputation';

describe('character reputation tiers', () => {
  it('maps fame to twenty signed tiers plus a neutral label', () => {
    expect(getFameTierLabel(-1000)).toBe('恶名昭著');
    expect(getFameTierLabel(-901)).toBe('恶名昭著');
    expect(getFameTierLabel(-900)).toBe('人人唾弃');
    expect(getFameTierLabel(-101)).toBe('小有恶名');
    expect(getFameTierLabel(-1)).toBe('略有恶名');
    expect(getFameTierLabel(0)).toBe('声名未显');
    expect(getFameTierLabel(1)).toBe('略有善名');
    expect(getFameTierLabel(100)).toBe('略有善名');
    expect(getFameTierLabel(101)).toBe('小有名声');
    expect(getFameTierLabel(901)).toBe('名满天下');
  });

  it('maps morality to twenty signed tiers plus a neutral label', () => {
    expect(getMoralityTierLabel(-1000)).toBe('大逆不道');
    expect(getMoralityTierLabel(-801)).toBe('人神共愤');
    expect(getMoralityTierLabel(-201)).toBe('德行有亏');
    expect(getMoralityTierLabel(-1)).toBe('略有失德');
    expect(getMoralityTierLabel(0)).toBe('德行未定');
    expect(getMoralityTierLabel(1)).toBe('略有德名');
    expect(getMoralityTierLabel(201)).toBe('行事有节');
    expect(getMoralityTierLabel(701)).toBe('德高望重');
    expect(getMoralityTierLabel(1000)).toBe('圣德昭然');
  });

  it('clamps final reputation scores to the long campaign range', () => {
    expect(clampReputationScore(-1200)).toBe(-1000);
    expect(clampReputationScore(-999.4)).toBe(-999);
    expect(clampReputationScore(999.6)).toBe(1000);
    expect(clampReputationScore(1200)).toBe(1000);
  });
});
