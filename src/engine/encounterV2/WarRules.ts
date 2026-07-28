import type {
  EncounterEnvironmentTag,
  EncounterSide,
  TroopSemanticProfile,
} from './EncounterContracts';
import type { WarTactic } from './WarTypes';

export interface NormalizedWarSupply {
  value: number;
  known: boolean;
  source: 'numeric' | 'duration' | 'status' | 'unknown';
}

export interface WarTacticCoefficients {
  offense: number;
  exposure: number;
  fatigueCost: number;
  supplyCost: number;
}

export const WAR_ROUND_LIMIT_DECISIVE_RATIO = 1.20 as const;

export function resolveWarRoundLimitOutcome(input: {
  playerEffectiveStrength: number;
  enemyEffectiveStrength: number;
}): 'player_victory' | 'enemy_victory' | 'draw' {
  const player = Math.max(0, input.playerEffectiveStrength);
  const enemy = Math.max(0, input.enemyEffectiveStrength);
  if (player >= enemy * WAR_ROUND_LIMIT_DECISIVE_RATIO && player > 0) return 'player_victory';
  if (enemy >= player * WAR_ROUND_LIMIT_DECISIVE_RATIO && enemy > 0) return 'enemy_victory';
  return 'draw';
}

export function clampWarValue(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeWarQuality(value: '低' | '中' | '高' | '精锐' | undefined): number {
  if (value === '低') return 85;
  if (value === '高') return 112;
  if (value === '精锐') return 125;
  return 100;
}

export function normalizeWarReadiness(value: '低' | '中' | '高' | undefined): number {
  if (value === '低') return 45;
  if (value === '高') return 90;
  return 70;
}

export function normalizeWarFatigue(value: '低' | '中' | '高' | '极高' | undefined): number {
  if (value === '中') return 35;
  if (value === '高') return 60;
  if (value === '极高') return 85;
  return 15;
}

const SUPPLY_STATUS_VALUES = new Map<string, number>([
  ['充足', 80],
  ['充裕', 80],
  ['充沛', 80],
  ['full', 80],
  ['adequate', 75],
  ['正常', 65],
  ['稳定', 65],
  ['stable', 65],
  ['良好', 70],
  ['尚可', 60],
  ['紧张', 40],
  ['不足', 30],
  ['口粮不足', 30],
  ['短缺', 25],
  ['low', 30],
  ['lost', 0],
  ['transferred', 0],
]);

const DURATION_SUPPLY_VALUES: Array<{ pattern: RegExp; value: number }> = [
  { pattern: /(?:七|7|seven)\s*(?:日|天|days?)/i, value: 90 },
  { pattern: /(?:五|5|five)\s*(?:日|天|days?)/i, value: 70 },
  { pattern: /(?:三|3|three)\s*(?:日|天|days?)/i, value: 50 },
  { pattern: /(?:两|二|2|two)\s*(?:日|天|days?)/i, value: 35 },
  { pattern: /(?:一|1|one)\s*(?:日|天|days?)/i, value: 20 },
];

export function normalizeWarSupply(value: string | number): NormalizedWarSupply {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { value: Math.round(clampWarValue(value, 0, 100)), known: true, source: 'numeric' };
  }
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    return {
      value: Math.round(clampWarValue(Number(normalized), 0, 100)),
      known: true,
      source: 'numeric',
    };
  }
  for (const entry of DURATION_SUPPLY_VALUES) {
    if (entry.pattern.test(normalized)) {
      return { value: entry.value, known: true, source: 'duration' };
    }
  }
  const statusValue = SUPPLY_STATUS_VALUES.get(normalized);
  if (statusValue !== undefined) {
    return { value: statusValue, known: true, source: 'status' };
  }
  return { value: 50, known: false, source: 'unknown' };
}

export interface WarCommanderScoreInput {
  leadership: number;
  intelligence: number;
  martial: number;
  charm: number;
  politics: number;
}

export function calculateWarCommanderScore(input: WarCommanderScoreInput): number {
  return Number((
    clampWarValue(input.leadership, 0, 100) * 0.50
    + clampWarValue(input.intelligence, 0, 100) * 0.20
    + clampWarValue(input.martial, 0, 100) * 0.15
    + clampWarValue(input.charm, 0, 100) * 0.10
    + clampWarValue(input.politics, 0, 100) * 0.05
  ).toFixed(2));
}

export function resolveWarTacticCoefficients(
  tactic: WarTactic,
  context: { environmentTags: EncounterEnvironmentTag[]; mobileShare: number },
): WarTacticCoefficients {
  if (tactic === 'all_out_assault') {
    return { offense: 1.30, exposure: 1.25, fatigueCost: 10, supplyCost: 8 };
  }
  if (tactic === 'hold_position') {
    return { offense: 0.75, exposure: 0.65, fatigueCost: 3, supplyCost: 3 };
  }
  if (tactic === 'flank') {
    const mobileShare = clampWarValue(context.mobileShare, 0, 1);
    const favorable = (context.environmentTags.includes('open') || context.environmentTags.includes('water'))
      && mobileShare >= 0.35;
    const unfavorable = (context.environmentTags.includes('fortified') || context.environmentTags.includes('difficult'))
      && mobileShare < 0.5;
    if (favorable) return { offense: 1.30, exposure: 0.85, fatigueCost: 8, supplyCost: 6 };
    if (unfavorable) return { offense: 0.75, exposure: 1.25, fatigueCost: 8, supplyCost: 6 };
    return { offense: 1.05, exposure: 1.00, fatigueCost: 8, supplyCost: 6 };
  }
  return { offense: 1.00, exposure: 1.00, fatigueCost: 5, supplyCost: 4 };
}

const TACTIC_COUNTER = new Map<WarTactic, WarTactic>([
  ['all_out_assault', 'flank'],
  ['flank', 'hold_position'],
  ['hold_position', 'all_out_assault'],
]);

export function compareWarTactics(
  player: WarTactic | undefined,
  enemy: WarTactic | undefined,
): { playerModifier: number; enemyModifier: number; winner?: EncounterSide } {
  if (!player || !enemy || player === 'steady_advance' || enemy === 'steady_advance' || player === enemy) {
    return { playerModifier: 1, enemyModifier: 1 };
  }
  if (TACTIC_COUNTER.get(player) === enemy) {
    return { playerModifier: 1.15, enemyModifier: 0.85, winner: 'player' };
  }
  if (TACTIC_COUNTER.get(enemy) === player) {
    return { playerModifier: 0.85, enemyModifier: 1.15, winner: 'enemy' };
  }
  return { playerModifier: 1, enemyModifier: 1 };
}

const ENVIRONMENT_CLASS_FACTORS: Record<EncounterEnvironmentTag, Record<TroopSemanticProfile['primaryClass'], number>> = {
  open: { infantry: 1, cavalry: 1.15, ranged: 1.05, naval: 0.65, siege: 0.85, mixed: 1 },
  difficult: { infantry: 1.05, cavalry: 0.80, ranged: 1, naval: 0.65, siege: 0.80, mixed: 0.95 },
  fortified: { infantry: 0.90, cavalry: 0.75, ranged: 1.05, naval: 0.60, siege: 1.25, mixed: 1 },
  water: { infantry: 0.65, cavalry: 0.55, ranged: 0.80, naval: 1.30, siege: 0.70, mixed: 0.95 },
};

export function troopEnvironmentFactor(input: {
  primaryClass: TroopSemanticProfile['primaryClass'];
  tags: TroopSemanticProfile['tags'];
  environmentTags: EncounterEnvironmentTag[];
  enemyPrimaryClasses: TroopSemanticProfile['primaryClass'][];
  tactic: WarTactic;
}): number {
  let factor = 1;
  for (const environment of input.environmentTags) {
    factor *= ENVIRONMENT_CLASS_FACTORS[environment][input.primaryClass];
  }
  if (input.tags.includes('anti_cavalry') && input.enemyPrimaryClasses.includes('cavalry')) factor *= 1.10;
  if (input.tags.includes('mobile') && input.tactic === 'flank') factor *= 1.08;
  if (input.tags.includes('defensive') && input.tactic === 'hold_position') factor *= 1.08;
  if (input.tags.includes('assault') && input.tactic === 'all_out_assault') factor *= 1.08;
  if (input.tags.includes('heavy') && input.tactic === 'hold_position') factor *= 1.04;
  return Number(clampWarValue(factor, 0.5, 1.5).toFixed(4));
}

export function calculateWarEffectiveStrength(input: {
  strength: number;
  training: number;
  morale: number;
  quality: number;
  readiness: number;
  supply: number;
  fatigue: number;
  commanderScore: number;
  environmentFactor: number;
  tacticFactor: number;
  semanticModifierPercent: number;
}): number {
  if (input.strength <= 0) return 0;
  const trainingFactor = 0.5 + clampWarValue(input.training, 0, 100) / 200;
  const moraleValue = clampWarValue(input.morale, 0, 100);
  const moraleFactor = (0.5 + moraleValue / 200) * (moraleValue < 15 ? 0.8 : 1);
  const qualityFactor = clampWarValue(input.quality, 70, 130) / 100;
  const readinessFactor = 0.5 + clampWarValue(input.readiness, 0, 100) / 200;
  const supplyFactor = 0.5 + clampWarValue(input.supply, 0, 100) / 200;
  const fatigueFactor = clampWarValue(1 - clampWarValue(input.fatigue, 0, 100) / 150, 0.35, 1);
  const commanderFactor = 0.75 + clampWarValue(input.commanderScore, 0, 100) / 200;
  const semanticFactor = 1 + clampWarValue(input.semanticModifierPercent, -30, 30) / 100;
  return Math.max(0, input.strength
    * trainingFactor
    * moraleFactor
    * qualityFactor
    * readinessFactor
    * supplyFactor
    * fatigueFactor
    * commanderFactor
    * clampWarValue(input.environmentFactor, 0.5, 1.5)
    * clampWarValue(input.tacticFactor, 0.5, 1.6)
    * semanticFactor);
}

export function calculateWarCasualtyRate(input: {
  enemyEffectiveStrength: number;
  ownEffectiveStrength: number;
  enemyOffense: number;
  ownExposure: number;
  perturbation: number;
  semanticModifierPercent: number;
}): number {
  const ratio = Math.sqrt(Math.max(0, input.enemyEffectiveStrength) / Math.max(1, input.ownEffectiveStrength));
  const rate = 0.02
    * ratio
    * clampWarValue(input.enemyOffense, 0.5, 1.6)
    * clampWarValue(input.ownExposure, 0.5, 1.5)
    * clampWarValue(input.perturbation, 0.95, 1.05)
    * (1 + clampWarValue(input.semanticModifierPercent, -30, 30) / 100);
  return Number(clampWarValue(rate, 0.005, 0.08).toFixed(6));
}

export function calculateWarRetreatChance(input: {
  ownMobility: number;
  enemyMobility: number;
  ownMorale: number;
  enemyMorale: number;
  ownFatigue: number;
  ownCommanderScore: number;
  enemyCommanderScore: number;
}): number {
  const chance = 50
    + (input.ownMobility - input.enemyMobility) * 35
    + (input.ownMorale - input.enemyMorale) * 0.20
    - input.ownFatigue * 0.15
    + (input.ownCommanderScore - input.enemyCommanderScore) * 0.20;
  return Math.round(clampWarValue(chance, 20, 90));
}
