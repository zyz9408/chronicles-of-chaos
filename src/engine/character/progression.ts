import type { Actor } from '../types';

export const PLAYER_ATTRIBUTE_POINTS_PER_LEVEL = 5;
export const MAX_QUEST_COMPLETION_EXPERIENCE_REWARD = 1_000;
export const CORE_PLAYER_ATTRIBUTE_KEYS = ['武力', '统率', '智力', '政治', '魅力'] as const;

export type CorePlayerAttributeKey = typeof CORE_PLAYER_ATTRIBUTE_KEYS[number];

export interface ApplyPlayerExperienceResult {
  player: Actor;
  levelsGained: number;
  nextLevelXp: number;
  summary: string;
}

export interface AllocatePlayerGrowthPointResult {
  player: Actor;
  applied: boolean;
  reason?: 'no_growth_points' | 'invalid_attribute';
}

export function experienceForNextLevel(level: number): number {
  return Math.max(1, Math.floor(level)) * 100;
}

export function isValidQuestCompletionExperienceReward(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value > 0
    && value <= MAX_QUEST_COMPLETION_EXPERIENCE_REWARD;
}

export function isCorePlayerAttributeKey(value: string): value is CorePlayerAttributeKey {
  return (CORE_PLAYER_ATTRIBUTE_KEYS as readonly string[]).includes(value);
}

export function applyPlayerExperience(player: Actor, gainedXp: number, reason: string): ApplyPlayerExperienceResult {
  let level = Math.max(1, Math.floor(player.level ?? 1));
  let xp = Math.max(0, Math.floor(player.xp ?? 0));
  let growthPoints = Math.max(0, Math.floor(player.growthPoints ?? 0));
  let nextPlayer: Actor = {
    ...player,
    level,
    xp,
    growthPoints,
  };
  const remainingGain = Math.max(0, Math.floor(gainedXp));
  let levelsGained = 0;

  xp += remainingGain;
  while (xp >= experienceForNextLevel(level)) {
    xp -= experienceForNextLevel(level);
    level += 1;
    growthPoints += PLAYER_ATTRIBUTE_POINTS_PER_LEVEL;
    levelsGained += 1;
  }

  nextPlayer = {
    ...nextPlayer,
    level,
    xp,
    growthPoints,
  };

  const reasonText = reason.trim() || '经历事件';
  const grantedPoints = levelsGained * PLAYER_ATTRIBUTE_POINTS_PER_LEVEL;
  const summary = levelsGained > 0
    ? `获得阅历 ${remainingGain}（${reasonText}），提升至 Lv.${nextPlayer.level}，成长点 +${grantedPoints}。`
    : `获得阅历 ${remainingGain}（${reasonText}）。`;

  return {
    player: nextPlayer,
    levelsGained,
    nextLevelXp: experienceForNextLevel(nextPlayer.level ?? 1),
    summary,
  };
}

export function allocatePlayerGrowthPoint(player: Actor, abilityKey: string): AllocatePlayerGrowthPointResult {
  const growthPoints = Math.max(0, Math.floor(player.growthPoints ?? 0));
  if (growthPoints <= 0) {
    return { player, applied: false, reason: 'no_growth_points' };
  }
  if (!isCorePlayerAttributeKey(abilityKey)) {
    return { player, applied: false, reason: 'invalid_attribute' };
  }

  const currentScore = Math.max(0, Math.floor(player.abilityScores?.[abilityKey] ?? 0));
  return {
    player: {
      ...player,
      growthPoints: growthPoints - 1,
      abilityScores: {
        ...(player.abilityScores ?? {}),
        [abilityKey]: currentScore + 1,
      },
    },
    applied: true,
  };
}
