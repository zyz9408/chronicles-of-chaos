import type { Actor, TurnOrdinaryCheck } from '../types';

export const PLAYER_GROWTH_POINT_SCHEDULE = [
  { fromLevel: 2, toLevel: 5, points: 5 },
  { fromLevel: 6, toLevel: 10, points: 4 },
  { fromLevel: 11, toLevel: 20, points: 3 },
  { fromLevel: 21, toLevel: 30, points: 2 },
  { fromLevel: 31, toLevel: null, points: 1 },
] as const;
export const MAX_QUEST_COMPLETION_EXPERIENCE_REWARD = 1_000;
export const CORE_PLAYER_ATTRIBUTE_KEYS = ['武力', '统率', '智力', '政治', '魅力'] as const;
export const QUEST_EXPERIENCE_PERCENT = {
  minor: 15,
  moderate: 30,
  major: 50,
  critical: 80,
} as const;

export type CorePlayerAttributeKey = typeof CORE_PLAYER_ATTRIBUTE_KEYS[number];
export type QuestExperienceTier = keyof typeof QUEST_EXPERIENCE_PERCENT;

export interface OrdinaryCheckExperienceAward {
  checkId: string;
  experienceAward: number;
  objectiveDifficulty: number;
}

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

function finiteFloorAtLeast(value: unknown, minimum: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.floor(value))
    : fallback;
}

export function experienceForNextLevel(level: number): number {
  return finiteFloorAtLeast(level, 1, 1) * 100;
}

export function growthPointsForReachedLevel(level: number): number {
  const normalizedLevel = finiteFloorAtLeast(level, 1, 1);
  if (normalizedLevel <= 1) return 0;
  const tier = PLAYER_GROWTH_POINT_SCHEDULE.find(({ fromLevel, toLevel }) => (
    normalizedLevel >= fromLevel && (toLevel == null || normalizedLevel <= toLevel)
  ));
  return tier?.points ?? 1;
}

export function experienceRewardFromPercent(level: number, percent: number): number {
  const normalizedLevel = finiteFloorAtLeast(level, 1, 1);
  const normalizedPercent = finiteFloorAtLeast(percent, 0, 0);
  return normalizedLevel * normalizedPercent;
}

export function questCompletionExperienceReward(
  level: number,
  tier: QuestExperienceTier | null | undefined,
): number {
  return experienceRewardFromPercent(level, QUEST_EXPERIENCE_PERCENT[tier ?? 'moderate']);
}

function ordinaryResultForMargin(margin: number): TurnOrdinaryCheck['result'] {
  if (margin >= 20) return '大成功';
  if (margin >= 5) return '成功';
  if (margin >= 0) return '勉强成功';
  if (margin <= -20) return '大失败';
  return '失败';
}

function ordinaryResultExperiencePercent(result: TurnOrdinaryCheck['result']): number {
  if (result === '大成功') return 12;
  if (result === '成功') return 10;
  if (result === '勉强成功') return 8;
  if (result === '大失败') return 8;
  return 6;
}

function objectiveDifficultyExperienceBonus(objectiveDifficulty: number): number {
  if (objectiveDifficulty >= 95) return 6;
  if (objectiveDifficulty >= 80) return 5;
  if (objectiveDifficulty >= 65) return 4;
  if (objectiveDifficulty >= 50) return 2;
  return 0;
}

export function calculateOrdinaryCheckExperienceAwards(
  level: number,
  checks: TurnOrdinaryCheck[] | null | undefined,
  difficultyOffset: number,
): OrdinaryCheckExperienceAward[] {
  const normalizedOffset = Number.isFinite(difficultyOffset) ? difficultyOffset : 0;
  const seenCheckIds = new Set<string>();
  const awards: OrdinaryCheckExperienceAward[] = [];

  for (const check of checks ?? []) {
    const checkId = check.checkId.trim();
    if (!checkId || seenCheckIds.has(checkId)) continue;
    seenCheckIds.add(checkId);
    if (
      typeof check.total !== 'number'
      || !Number.isFinite(check.total)
      || typeof check.difficulty !== 'number'
      || !Number.isFinite(check.difficulty)
    ) {
      continue;
    }
    const margin = check.total - check.difficulty;
    const expectedResult = ordinaryResultForMargin(margin);
    if (check.result.trim() !== expectedResult) continue;
    const objectiveDifficulty = Math.round(check.difficulty - normalizedOffset);
    const percent = ordinaryResultExperiencePercent(expectedResult)
      + objectiveDifficultyExperienceBonus(objectiveDifficulty);
    awards.push({
      checkId,
      experienceAward: experienceRewardFromPercent(level, percent),
      objectiveDifficulty,
    });
  }
  return awards;
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
  let level = finiteFloorAtLeast(player.level, 1, 1);
  let xp = finiteFloorAtLeast(player.xp, 0, 0);
  let growthPoints = finiteFloorAtLeast(player.growthPoints, 0, 0);
  let nextPlayer: Actor = {
    ...player,
    level,
    xp,
    growthPoints,
  };
  const remainingGain = finiteFloorAtLeast(gainedXp, 0, 0);
  let levelsGained = 0;
  let grantedPoints = 0;

  xp += remainingGain;
  while (xp >= experienceForNextLevel(level)) {
    xp -= experienceForNextLevel(level);
    level += 1;
    const pointsForLevel = growthPointsForReachedLevel(level);
    growthPoints += pointsForLevel;
    grantedPoints += pointsForLevel;
    levelsGained += 1;
  }

  nextPlayer = {
    ...nextPlayer,
    level,
    xp,
    growthPoints,
  };

  const reasonText = reason.trim() || '经历事件';
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

export function normalizePlayerProgression(player: Actor): Actor;
export function normalizePlayerProgression(player: Actor | undefined): Actor | undefined;
export function normalizePlayerProgression(player: Actor | undefined): Actor | undefined {
  if (!player) {
    return player;
  }
  return applyPlayerExperience(player, 0, '旧存档阅历归一').player;
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
