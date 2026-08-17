import { describe, expect, it } from 'vitest';
import type { Actor } from '../types';
import {
  allocatePlayerGrowthPoint,
  applyPlayerExperience,
  calculateOrdinaryCheckExperienceAwards,
  CORE_PLAYER_ATTRIBUTE_KEYS,
  experienceForNextLevel,
  growthPointsForReachedLevel,
  normalizePlayerProgression,
  PLAYER_GROWTH_POINT_SCHEDULE,
  questCompletionExperienceReward,
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

  it('keeps five allocatable attribute points for early levels without changing vitals', () => {
    const result = applyPlayerExperience(basePlayer, 260, '解开乡里粮案');

    expect(PLAYER_GROWTH_POINT_SCHEDULE[0]).toEqual({ fromLevel: 2, toLevel: 5, points: 5 });
    expect(result.player.level).toBe(2);
    expect(result.player.xp).toBe(160);
    expect(result.player.growthPoints).toBe(5);
    expect(result.player.vitals).toEqual(basePlayer.vitals);
    expect(result.levelsGained).toBe(1);
    expect(result.nextLevelXp).toBe(200);
    expect(result.summary).toBe('获得阅历 260（解开乡里粮案），提升至 Lv.2，成长点 +5。');
  });

  it('can gain multiple early levels and grants the applicable points for every level crossed', () => {
    const result = applyPlayerExperience({ ...basePlayer, level: 2, xp: 190, growthPoints: 1 }, 330, '守住县城');

    expect(result.player.level).toBe(4);
    expect(result.player.xp).toBe(20);
    expect(result.player.growthPoints).toBe(11);
    expect(result.player.vitals).toEqual(basePlayer.vitals);
    expect(result.levelsGained).toBe(2);
    expect(result.nextLevelXp).toBe(400);
  });

  it('reduces growth-point rewards as the reached level rises', () => {
    expect([
      growthPointsForReachedLevel(1),
      growthPointsForReachedLevel(2),
      growthPointsForReachedLevel(5),
      growthPointsForReachedLevel(6),
      growthPointsForReachedLevel(10),
      growthPointsForReachedLevel(11),
      growthPointsForReachedLevel(20),
      growthPointsForReachedLevel(21),
      growthPointsForReachedLevel(30),
      growthPointsForReachedLevel(31),
      growthPointsForReachedLevel(99),
    ]).toEqual([0, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1]);
  });

  it('totals each crossed reward tier instead of multiplying by one fixed value', () => {
    const result = applyPlayerExperience({ ...basePlayer, level: 4, xp: 390, growthPoints: 1 }, 1_110, '连续平定郡县');

    expect(result.player).toMatchObject({ level: 7, xp: 0, growthPoints: 14 });
    expect(result.levelsGained).toBe(3);
    expect(result.summary).toBe('获得阅历 1110（连续平定郡县），提升至 Lv.7，成长点 +13。');
  });

  it('awards one point after level 30 without clawing back existing unspent points', () => {
    const result = applyPlayerExperience({ ...basePlayer, level: 30, xp: 2_990, growthPoints: 99 }, 10, '治理州郡');

    expect(result.player).toMatchObject({ level: 31, xp: 0, growthPoints: 100 });
    expect(result.summary).toBe('获得阅历 10（治理州郡），提升至 Lv.31，成长点 +1。');
  });

  it('scales quest completion rewards with the current level and structured severity', () => {
    expect(questCompletionExperienceReward(1, 'minor')).toBe(15);
    expect(questCompletionExperienceReward(3, 'moderate')).toBe(90);
    expect(questCompletionExperienceReward(3, 'major')).toBe(150);
    expect(questCompletionExperienceReward(3, 'critical')).toBe(240);
    expect(questCompletionExperienceReward(3, undefined)).toBe(90);
  });

  it('awards every contract-valid ordinary check without using the selected difficulty as a multiplier', () => {
    const hardAwards = calculateOrdinaryCheckExperienceAwards(2, [
      { checkId: 'check_success', label: '说服守门军士', total: 70, difficulty: 55, result: '成功' },
      { checkId: 'check_failure', label: '追踪斥候', total: 40, difficulty: 70, result: '大失败' },
    ], 5);
    const storyAwards = calculateOrdinaryCheckExperienceAwards(2, [
      { checkId: 'check_success', label: '说服守门军士', total: 60, difficulty: 45, result: '成功' },
      { checkId: 'check_failure', label: '追踪斥候', total: 30, difficulty: 60, result: '大失败' },
    ], -5);

    expect(hardAwards).toEqual([
      { checkId: 'check_success', experienceAward: 24, objectiveDifficulty: 50 },
      { checkId: 'check_failure', experienceAward: 24, objectiveDifficulty: 65 },
    ]);
    expect(storyAwards).toEqual(hardAwards);
  });

  it.each([
    ['大成功', 70, 14],
    ['成功', 55, 12],
    ['勉强成功', 50, 10],
    ['失败', 49, 8],
    ['大失败', 30, 10],
  ] as const)('awards ordinary check experience for %s', (result, total, expectedAward) => {
    expect(calculateOrdinaryCheckExperienceAwards(1, [{
      checkId: `check_${result}`,
      label: '普通行动',
      total,
      difficulty: 50,
      result,
    }], 0)).toEqual([{
      checkId: `check_${result}`,
      experienceAward: expectedAward,
      objectiveDifficulty: 50,
    }]);
  });

  it('deduplicates ordinary check IDs and rejects incomplete or internally inconsistent checks', () => {
    expect(calculateOrdinaryCheckExperienceAwards(1, [
      { checkId: 'check_1', label: '第一次', total: 60, difficulty: 50, result: '成功' },
      { checkId: 'check_1', label: '重复', total: 80, difficulty: 50, result: '大成功' },
      { checkId: 'check_2', label: '结果不一致', total: 40, difficulty: 50, result: '成功' },
      { checkId: 'check_3', label: '缺少数值', result: '失败' },
    ], 0)).toEqual([
      { checkId: 'check_1', experienceAward: 12, objectiveDifficulty: 50 },
    ]);
  });

  it('normalizes finite legacy overflow into levels and growth points without discarding xp', () => {
    expect(normalizePlayerProgression({
      ...basePlayer,
      level: 1,
      xp: 350,
      growthPoints: undefined,
    })).toMatchObject({
      level: 3,
      xp: 50,
      growthPoints: 10,
    });
  });

  it('contains non-finite legacy progression values instead of looping forever', () => {
    expect(normalizePlayerProgression({
      ...basePlayer,
      level: Number.NaN,
      xp: Number.POSITIVE_INFINITY,
      growthPoints: Number.NaN,
    })).toMatchObject({
      level: 1,
      xp: 0,
      growthPoints: 0,
    });
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
