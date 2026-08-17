import type { GameDifficultyLevel, RuntimeState } from '../types/runtimeState';

export interface GameDifficultyProfile {
  id: GameDifficultyLevel;
  label: string;
  /** Added to the objective difficulty value Y for ordinary checks. */
  difficultyOffset: number;
  summary: string;
}

export type EncounterDifficultyKind = 'combat' | 'war';

export interface EncounterDifficultyProfile {
  id: GameDifficultyLevel;
  label: string;
  /** Multiplies the player's side effective power without mutating canonical stats. */
  playerPowerMultiplier: number;
  summary: string;
}

export const gameDifficultyProfiles: readonly GameDifficultyProfile[] = [
  {
    id: 'story',
    label: '剧情',
    difficultyOffset: -10,
    summary: '降低普通判定难度，优先保障剧情推进，但仍保留失败及其后果。',
  },
  {
    id: 'easy',
    label: '轻松',
    difficultyOffset: -5,
    summary: '小幅降低普通判定难度，适合更顺畅的长期游玩。',
  },
  {
    id: 'standard',
    label: '标准',
    difficultyOffset: 0,
    summary: '不额外修正难度值，完整体现能力、客观难度与现场因素。',
  },
  {
    id: 'hard',
    label: '困难',
    difficultyOffset: 5,
    summary: '小幅提高普通判定难度，冒险行动更依赖能力与准备。',
  },
  {
    id: 'brutal',
    label: '严酷',
    difficultyOffset: 10,
    summary: '明显提高普通判定难度，失败和高代价更常见，但不会取消成功机会。',
  },
] as const;

export const combatDifficultyProfiles: readonly EncounterDifficultyProfile[] = [
  { id: 'story', label: '剧情', playerPowerMultiplier: 2, summary: '显著提高我方伤害并降低承伤，优先保障剧情推进，仍保留失败与死亡风险。' },
  { id: 'easy', label: '轻松', playerPowerMultiplier: 1.5, summary: '提高我方伤害并降低承伤，适合希望更顺畅推进的个人战。' },
  { id: 'standard', label: '标准', playerPowerMultiplier: 1, summary: '不额外修正攻防，按能力、装备、绝艺与现场状态结算。' },
  { id: 'hard', label: '困难', playerPowerMultiplier: 0.8, summary: '降低我方攻防优势，更依赖装备、绝艺和战术选择。' },
  { id: 'brutal', label: '严酷', playerPowerMultiplier: 0.5, summary: '显著提高个人战压力，但不会改变角色与装备的底层真值。' },
] as const;

export const warDifficultyProfiles: readonly EncounterDifficultyProfile[] = [
  { id: 'story', label: '剧情', playerPowerMultiplier: 2, summary: '显著提高我方有效战力，优先保障战争剧情推进并降低溃败压力。' },
  { id: 'easy', label: '轻松', playerPowerMultiplier: 1.5, summary: '提高我方有效战力，同时仍保留兵种、地形、士气与后勤影响。' },
  { id: 'standard', label: '标准', playerPowerMultiplier: 1, summary: '不额外修正战力，完整采用战争规则与双方真实状态。' },
  { id: 'hard', label: '困难', playerPowerMultiplier: 0.8, summary: '降低我方有效战力，更依赖统率、士气、克制与准备。' },
  { id: 'brutal', label: '严酷', playerPowerMultiplier: 0.5, summary: '显著提高战争压力，但不会篡改部队规模、兵种或资源账本。' },
] as const;

export function getGameDifficultyProfile(
  difficulty: GameDifficultyLevel | string | null | undefined,
): GameDifficultyProfile {
  return gameDifficultyProfiles.find((profile) => profile.id === difficulty)
    ?? gameDifficultyProfiles[2];
}

export function normalizeGameDifficulty(
  difficulty: GameDifficultyLevel | string | null | undefined,
): GameDifficultyLevel {
  return getGameDifficultyProfile(difficulty).id;
}

export function getEncounterDifficultyProfile(
  kind: EncounterDifficultyKind,
  difficulty: GameDifficultyLevel | string | null | undefined,
): EncounterDifficultyProfile {
  const profiles = kind === 'combat' ? combatDifficultyProfiles : warDifficultyProfiles;
  return profiles.find((profile) => profile.id === difficulty) ?? profiles[2];
}

export function normalizeEncounterDifficulty(
  kind: EncounterDifficultyKind,
  difficulty: GameDifficultyLevel | string | null | undefined,
): GameDifficultyLevel {
  return getEncounterDifficultyProfile(kind, difficulty).id;
}

export function formatGameDifficultyForPrompt(
  difficulty: GameDifficultyLevel | string | null | undefined,
): string {
  const profile = getGameDifficultyProfile(difficulty);
  const signedOffset = profile.difficultyOffset >= 0
    ? `+${profile.difficultyOffset}`
    : String(profile.difficultyOffset);
  return `${profile.id}/${profile.label}/Y${signedOffset}`;
}

export function applyGameDifficultyToRuntimeState(
  state: RuntimeState,
  difficulty: GameDifficultyLevel | string | null | undefined,
): RuntimeState {
  return {
    ...state,
    gameDifficulty: normalizeGameDifficulty(difficulty),
  };
}

export function applyCombatDifficultyToRuntimeState(
  state: RuntimeState,
  difficulty: GameDifficultyLevel | string | null | undefined,
): RuntimeState {
  return {
    ...state,
    combatDifficulty: normalizeEncounterDifficulty('combat', difficulty),
  };
}

export function applyWarDifficultyToRuntimeState(
  state: RuntimeState,
  difficulty: GameDifficultyLevel | string | null | undefined,
): RuntimeState {
  return {
    ...state,
    warDifficulty: normalizeEncounterDifficulty('war', difficulty),
  };
}
