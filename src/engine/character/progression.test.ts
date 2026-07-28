import { describe, expect, it } from 'vitest';
import type { Actor } from '../types';
import {
  allocatePlayerGrowthPoint,
  applyPlayerExperience,
  CORE_PLAYER_ATTRIBUTE_KEYS,
  experienceForNextLevel,
  PLAYER_ATTRIBUTE_POINTS_PER_LEVEL,
} from './progression';

const basePlayer: Actor = {
  id: 'player_1',
  name: '阿青',
  roleType: '寒门士子',
  summary: '初入乱世。',
  abilityScores: { 武力: 52, 统率: 51, 智力: 49, 政治: 45, 魅力: 50, 机运: 48 },
  level: 1,
  xp: 0,
  growthPoints: 0,
  vitals: { hp: 84, maxHp: 100, stamina: 37, maxStamina: 100 },
};

describe('progression', () => {
  it('uses level times 100 as the next level threshold', () => {
    expect(experienceForNextLevel(1)).toBe(100);
    expect(experienceForNextLevel(3)).toBe(300);
  });

  it('grants five allocatable attribute points per level without changing vitals', () => {
    const result = applyPlayerExperience(basePlayer, 260, '解开乡里粮案');

    expect(PLAYER_ATTRIBUTE_POINTS_PER_LEVEL).toBe(5);
    expect(result.player.level).toBe(2);
    expect(result.player.xp).toBe(160);
    expect(result.player.growthPoints).toBe(5);
    expect(result.player.vitals).toEqual(basePlayer.vitals);
    expect(result.levelsGained).toBe(1);
    expect(result.nextLevelXp).toBe(200);
    expect(result.summary).toBe('获得阅历 260（解开乡里粮案），提升至 Lv.2，成长点 +5。');
  });

  it('can gain multiple levels and grants five points for each level crossed', () => {
    const result = applyPlayerExperience({ ...basePlayer, level: 2, xp: 190, growthPoints: 1 }, 330, '守住县城');

    expect(result.player.level).toBe(4);
    expect(result.player.xp).toBe(20);
    expect(result.player.growthPoints).toBe(11);
    expect(result.player.vitals).toEqual(basePlayer.vitals);
    expect(result.levelsGained).toBe(2);
    expect(result.nextLevelXp).toBe(400);
  });

  it('allocates one growth point to a core ability without changing vitals', () => {
    const result = allocatePlayerGrowthPoint({ ...basePlayer, growthPoints: 2 }, '武力');

    expect(CORE_PLAYER_ATTRIBUTE_KEYS).toEqual(['武力', '统率', '智力', '政治', '魅力']);
    expect(result.applied).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.player.growthPoints).toBe(1);
    expect(result.player.abilityScores).toMatchObject({ 武力: 53, 统率: 51, 智力: 49, 政治: 45, 魅力: 50, 机运: 48 });
    expect(result.player.vitals).toEqual(basePlayer.vitals);
  });

  it('rejects allocation when no growth points remain', () => {
    const player = { ...basePlayer, growthPoints: 0 };
    const result = allocatePlayerGrowthPoint(player, '武力');

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no_growth_points');
    expect(result.player).toBe(player);
  });

  it('rejects allocation to hidden or non-core abilities', () => {
    const player = { ...basePlayer, growthPoints: 2 };
    const result = allocatePlayerGrowthPoint(player, '机运');

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('invalid_attribute');
    expect(result.player).toBe(player);
  });
});
