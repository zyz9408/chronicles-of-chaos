import type {
  EncounterEnvironmentTag,
  EncounterSide,
  TroopSemanticProfile,
} from './EncounterContracts';
import type { WarTactic } from './WarTypes';
import {
  troopFatigueCombatMultiplier,
  troopFatiguePercentFromBand,
  troopFatigueRetreatPenaltyPoints,
} from '../troops/TroopFatigue';

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

export interface WarTroopCompositionComponent {
  primaryClass: Exclude<TroopSemanticProfile['primaryClass'], 'mixed'> | 'mixed';
  sharePercent: number;
  tags: TroopSemanticProfile['tags'];
}

type WarTroopProfileLike = Pick<TroopSemanticProfile, 'primaryClass' | 'tags' | 'composition'>;

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

export function warMoraleFactor(morale: number): number {
  const value = clampWarValue(morale, 0, 100);
  if (value >= 80) return 1.05 + (value - 80) * 0.0025;
  if (value >= 60) return 0.95 + (value - 60) * 0.005;
  if (value >= 40) return 0.80 + (value - 40) * 0.0075;
  if (value >= 20) return 0.60 + (value - 20) * 0.01;
  return 0.35 + value * 0.0125;
}

function legacyWarMoraleFactor(morale: number): number {
  const value = clampWarValue(morale, 0, 100);
  return (0.5 + value / 200) * (value < 15 ? 0.8 : 1);
}

export function warMoraleCasualtyExposure(morale: number): number {
  const value = clampWarValue(morale, 0, 100);
  if (value >= 80) return 0.95;
  if (value >= 60) return 1;
  if (value >= 40) return 1.08;
  if (value >= 20) return 1.22;
  return 1.45;
}

export function resolveWarTroopComposition(profile: WarTroopProfileLike): WarTroopCompositionComponent[] {
  if (profile.composition && profile.composition.length >= 2) {
    return profile.composition.map((component) => ({
      primaryClass: component.primaryClass,
      sharePercent: component.sharePercent,
      tags: [...new Set([...profile.tags, ...(component.tags ?? [])])],
    }));
  }
  return [{
    primaryClass: profile.primaryClass,
    sharePercent: 100,
    tags: [...profile.tags],
  }];
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
  return troopFatiguePercentFromBand(value);
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

export function calculateWarCommanderFactor(input: {
  commanderPresent: boolean;
  leadership?: number;
  leadershipKnown?: boolean;
}): number {
  if (!input.commanderPresent) return 0.56;
  if (!input.leadershipKnown) return 0.68;
  const leadership = clampWarValue(input.leadership ?? 0, 0, 100);
  const anchors = [
    { leadership: 0, factor: 0.56 },
    { leadership: 40, factor: 0.80 },
    { leadership: 50, factor: 1.00 },
    { leadership: 60, factor: 1.24 },
    { leadership: 70, factor: 1.56 },
    { leadership: 80, factor: 1.92 },
    { leadership: 90, factor: 2.40 },
    { leadership: 95, factor: 2.72 },
    { leadership: 100, factor: 3.08 },
  ] as const;
  const upperIndex = anchors.findIndex((anchor) => leadership <= anchor.leadership);
  if (upperIndex <= 0) return anchors[0].factor;
  const lower = anchors[upperIndex - 1];
  const upper = anchors[upperIndex];
  const progress = (leadership - lower.leadership) / (upper.leadership - lower.leadership);
  return Number((lower.factor + (upper.factor - lower.factor) * progress).toFixed(3));
}

/**
 * Frozen War V2.4 commander curve. Existing active encounters keep this
 * calculation so a balance update cannot change a sealed checkpoint.
 */
export function calculateWarV24CommanderFactor(input: {
  commanderPresent: boolean;
  leadership?: number;
  leadershipKnown?: boolean;
}): number {
  if (!input.commanderPresent) return 0.45;
  if (!input.leadershipKnown) return 0.60;
  const leadership = clampWarValue(input.leadership ?? 0, 0, 100);
  const anchors = [
    { leadership: 0, factor: 0.45 },
    { leadership: 40, factor: 0.75 },
    { leadership: 50, factor: 1.00 },
    { leadership: 60, factor: 1.30 },
    { leadership: 70, factor: 1.70 },
    { leadership: 80, factor: 2.15 },
    { leadership: 90, factor: 2.75 },
    { leadership: 95, factor: 3.15 },
    { leadership: 100, factor: 3.60 },
  ] as const;
  const upperIndex = anchors.findIndex((anchor) => leadership <= anchor.leadership);
  if (upperIndex <= 0) return anchors[0].factor;
  const lower = anchors[upperIndex - 1];
  const upper = anchors[upperIndex];
  const progress = (leadership - lower.leadership) / (upper.leadership - lower.leadership);
  return Number((lower.factor + (upper.factor - lower.factor) * progress).toFixed(3));
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

/** War V2.6: intelligence improves deliberate tactics without becoming raw troop damage. */
export function calculateWarIntelligenceTacticFactor(input: {
  ownIntelligence: number;
  enemyIntelligence: number;
  tactic: WarTactic;
}): number {
  const coefficient = input.tactic === 'steady_advance' ? 0.002 : 0.004;
  return Number(clampWarValue(
    1 + (input.ownIntelligence - input.enemyIntelligence) * coefficient,
    input.tactic === 'steady_advance' ? 0.92 : 0.84,
    input.tactic === 'steady_advance' ? 1.08 : 1.16,
  ).toFixed(3));
}

/** War V2.6: martial ability adds bounded pressure only to aggressive orders. */
export function calculateWarMartialPressureFactor(input: {
  ownMartial: number;
  enemyMartial: number;
  tactic: WarTactic;
}): number {
  if (!['all_out_assault', 'flank'].includes(input.tactic)) return 1;
  return Number(clampWarValue(
    1 + (input.ownMartial - input.enemyMartial) * 0.0025,
    0.90,
    1.10,
  ).toFixed(3));
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

function componentMatchupFactor(input: {
  attacker: WarTroopCompositionComponent;
  defender: WarTroopCompositionComponent;
  environmentTags: EncounterEnvironmentTag[];
  attackerTactic: WarTactic;
  defenderTactic: WarTactic;
}): number {
  const attackerClass = input.attacker.primaryClass;
  const defenderClass = input.defender.primaryClass;
  let factor = 1;
  if (attackerClass === 'cavalry') {
    if (defenderClass === 'infantry') factor = 1.35;
    else if (defenderClass === 'ranged') factor = 1.85;
    else if (defenderClass === 'siege') factor = 1.55;
    else if (defenderClass === 'naval') factor = 0.65;
  } else if (attackerClass === 'infantry') {
    if (defenderClass === 'cavalry') factor = 0.80;
    else if (defenderClass === 'ranged') factor = 1.15;
    else if (defenderClass === 'siege') factor = 1.20;
  } else if (attackerClass === 'ranged') {
    if (defenderClass === 'infantry') factor = 1.20;
    else if (defenderClass === 'cavalry') factor = 0.70;
    else if (defenderClass === 'siege') factor = 1.10;
  } else if (attackerClass === 'siege') {
    factor = input.environmentTags.includes('fortified') ? 1.75 : 0.60;
  } else if (attackerClass === 'naval') {
    factor = input.environmentTags.includes('water') ? 1.65 : 0.55;
  }

  const attacksCavalry = defenderClass === 'cavalry';
  if (input.attacker.tags.includes('anti_cavalry') && attacksCavalry) {
    factor = Math.max(factor, input.attackerTactic === 'hold_position' ? 2.20 : 1.85);
  }
  if (attackerClass === 'cavalry' && input.defender.tags.includes('anti_cavalry')) factor *= 0.42;
  if (attackerClass === 'cavalry'
    && input.attacker.tags.includes('heavy')
    && input.environmentTags.includes('open')
    && (defenderClass === 'infantry' || defenderClass === 'ranged' || defenderClass === 'siege')) {
    factor *= 1.25;
  }
  if (input.defender.tags.includes('heavy')) factor *= 0.80;
  if (input.defender.tags.includes('defensive') && input.defenderTactic === 'hold_position') factor *= 0.82;
  if ((input.environmentTags.includes('fortified') || input.environmentTags.includes('difficult'))
    && input.attackerTactic === 'flank'
    && input.defenderTactic === 'hold_position') {
    factor *= 0.62;
  }
  return clampWarValue(factor, 0.40, 2.20);
}

export function troopMatchupFactor(input: {
  attacker: WarTroopProfileLike;
  defender: WarTroopProfileLike;
  environmentTags: EncounterEnvironmentTag[];
  attackerTactic: WarTactic;
  defenderTactic: WarTactic;
}): number {
  const attackers = resolveWarTroopComposition(input.attacker);
  const defenders = resolveWarTroopComposition(input.defender);
  let factor = 0;
  for (const attacker of attackers) {
    for (const defender of defenders) {
      factor += componentMatchupFactor({
        attacker,
        defender,
        environmentTags: input.environmentTags,
        attackerTactic: input.attackerTactic,
        defenderTactic: input.defenderTactic,
      }) * (attacker.sharePercent / 100) * (defender.sharePercent / 100);
    }
  }
  return Number(clampWarValue(factor, 0.40, 2.20).toFixed(4));
}

export function calculateWarShockMoralePenalty(input: {
  attacker: WarTroopProfileLike;
  defender: WarTroopProfileLike;
  environmentTags: EncounterEnvironmentTag[];
  attackerTactic: WarTactic;
  defenderTactic: WarTactic;
  attackerMorale: number;
  attackerTraining: number;
  attackerReadiness: number;
  attackerSupply: number;
  defenderTraining: number;
  defenderQuality: number;
}): number {
  if (!input.environmentTags.includes('open')) return 0;
  if (!['all_out_assault', 'flank'].includes(input.attackerTactic)) return 0;
  if (input.attackerMorale < 40 || input.attackerReadiness < 45 || input.attackerSupply < 25) return 0;
  const attackers = resolveWarTroopComposition(input.attacker);
  const defenders = resolveWarTroopComposition(input.defender);
  const heavyCavalryShare = attackers.reduce((sum, component) => (
    component.primaryClass === 'cavalry' && component.tags.includes('heavy')
      ? sum + component.sharePercent / 100
      : sum
  ), 0);
  if (heavyCavalryShare < 0.35) return 0;
  const vulnerableShare = defenders.reduce((sum, component) => {
    if (component.tags.includes('anti_cavalry')) return sum;
    if (component.primaryClass === 'ranged' || component.primaryClass === 'siege') {
      return sum + component.sharePercent / 100;
    }
    if (component.primaryClass === 'infantry' || component.primaryClass === 'mixed') {
      return sum + component.sharePercent / 200;
    }
    return sum;
  }, 0);
  const antiCavalryShare = defenders.reduce((sum, component) => (
    component.tags.includes('anti_cavalry') ? sum + component.sharePercent / 100 : sum
  ), 0);
  let penalty = 8
    + heavyCavalryShare * 12
    + vulnerableShare * 8
    + Math.max(0, input.attackerTraining - input.defenderTraining) * 0.18
    + Math.max(0, 100 - input.defenderQuality) * 0.12;
  penalty *= 1 - antiCavalryShare * 0.80;
  if (input.defenderTactic === 'hold_position') penalty *= 0.75;
  return Math.round(clampWarValue(penalty, 0, 30));
}

function compressWarNumericalAdvantage(own: number, enemy: number, coordination: number): number {
  if (own <= enemy || enemy <= 0) return own;
  const ratio = own / enemy;
  const coordinationScale = 0.65 + clampWarValue(coordination, 0, 100) / 225;
  const engagedRatio = Math.min(ratio, 1 + Math.log(ratio) * coordinationScale);
  return enemy * engagedRatio;
}

export function resolveWarEngagedStrengths(input: {
  playerRawStrength: number;
  enemyRawStrength: number;
  playerCoordination: number;
  enemyCoordination: number;
}): { player: number; enemy: number } {
  return {
    player: compressWarNumericalAdvantage(
      Math.max(0, input.playerRawStrength),
      Math.max(0, input.enemyRawStrength),
      input.playerCoordination,
    ),
    enemy: compressWarNumericalAdvantage(
      Math.max(0, input.enemyRawStrength),
      Math.max(0, input.playerRawStrength),
      input.enemyCoordination,
    ),
  };
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
  commanderFactor?: number;
  environmentFactor: number;
  matchupFactor?: number;
  moraleModel?: 'legacy' | 'v22';
  tacticFactor: number;
  semanticModifierPercent: number;
}): number {
  if (input.strength <= 0) return 0;
  const trainingFactor = 0.5 + clampWarValue(input.training, 0, 100) / 200;
  const moraleFactor = input.moraleModel === 'legacy'
    ? legacyWarMoraleFactor(input.morale)
    : warMoraleFactor(input.morale);
  const qualityFactor = clampWarValue(input.quality, 70, 130) / 100;
  const readinessFactor = 0.5 + clampWarValue(input.readiness, 0, 100) / 200;
  const supplyFactor = 0.5 + clampWarValue(input.supply, 0, 100) / 200;
  const fatigueFactor = troopFatigueCombatMultiplier(input.fatigue);
  const commanderFactor = input.commanderFactor
    ?? 0.75 + clampWarValue(input.commanderScore, 0, 100) / 200;
  const semanticFactor = 1 + clampWarValue(input.semanticModifierPercent, -80, 280) / 100;
  return Math.max(0, input.strength
    * trainingFactor
    * moraleFactor
    * qualityFactor
    * readinessFactor
    * supplyFactor
    * fatigueFactor
    * commanderFactor
    * clampWarValue(input.environmentFactor, 0.5, 1.5)
    * clampWarValue(input.matchupFactor ?? 1, 0.4, 2.2)
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
  commanderModifierPercent?: number;
}): number {
  const ratio = Math.sqrt(Math.max(0, input.enemyEffectiveStrength) / Math.max(1, input.ownEffectiveStrength));
  const rate = 0.02
    * ratio
    * clampWarValue(input.enemyOffense, 0.5, 1.6)
    * clampWarValue(input.ownExposure, 0.5, 1.5)
    * clampWarValue(input.perturbation, 0.95, 1.05)
    * (1 + clampWarValue(input.semanticModifierPercent, -80, 280) / 100)
    * (1 + clampWarValue(input.commanderModifierPercent ?? 0, -35, 35) / 100);
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
    - troopFatigueRetreatPenaltyPoints(input.ownFatigue)
    + (input.ownCommanderScore - input.enemyCommanderScore) * 0.20;
  return Math.round(clampWarValue(chance, 20, 90));
}
