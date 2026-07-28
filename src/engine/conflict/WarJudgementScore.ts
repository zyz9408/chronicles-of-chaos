import type {
  ConflictAdvantageBand,
  ConflictJudgement,
  ConflictScoreBreakdown,
} from '../types';

const scoreComponentFields = ['troopBase', 'commander', 'tactical', 'turningPoint', 'playerAction', 'uniqueArts'] as const;
const WAR_COMPONENT_LIMIT = 100;
const WAR_TOTAL_LIMIT = 250;

export interface WarCommanderScoreInput {
  leadership?: number;
  intelligence?: number;
  force?: number;
  politics?: number;
  charm?: number;
}

export interface WarSideScoreInput {
  troopSize?: number;
  morale?: number;
  training?: number;
  quality?: number;
  readiness?: number;
  commander?: WarCommanderScoreInput;
}

export interface WarJudgementScoreInput {
  own: WarSideScoreInput;
  enemy: WarSideScoreInput;
  tacticalModifier?: number;
  turningPointModifier?: number;
  playerActionModifier?: number;
  uniqueArtsModifier?: number;
  notes?: string[];
}

export function calculateWarJudgementScoreBreakdown(input: WarJudgementScoreInput): ConflictScoreBreakdown {
  const troopBase = clampScore(
    calculateTroopSizeScore(input.own.troopSize, input.enemy.troopSize)
      + calculateTroopQualityScore(input.own, input.enemy),
    50,
  );
  const commander = calculateCommanderScore(input.own.commander, input.enemy.commander);
  const tactical = clampScore(input.tacticalModifier ?? 0, 35);
  const turningPoint = clampScore(input.turningPointModifier ?? 0, 60);
  const playerAction = clampScore(input.playerActionModifier ?? 0, 45);
  const uniqueArts = clampScore(input.uniqueArtsModifier ?? 0, 35);
  const scoreBreakdown: ConflictScoreBreakdown = {
    troopBase,
    commander,
    tactical,
    turningPoint,
    playerAction,
    uniqueArts,
    notes: sanitizeNotes(input.notes),
  };
  const total = calculateWarJudgementTotal(scoreBreakdown);
  return total === undefined ? scoreBreakdown : { ...scoreBreakdown, total };
}

export function calculateWarJudgementTotal(scoreBreakdown?: ConflictScoreBreakdown): number | undefined {
  if (!scoreBreakdown) return undefined;

  let hasComponent = false;
  const total = scoreComponentFields.reduce((sum, field) => {
    const value = scoreBreakdown[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) return sum;
    hasComponent = true;
    return sum + value;
  }, 0);

  if (hasComponent) return total;
  return typeof scoreBreakdown.total === 'number' && Number.isFinite(scoreBreakdown.total)
    ? scoreBreakdown.total
    : undefined;
}

export function deriveConflictAdvantageBand(total: number): ConflictAdvantageBand {
  if (total >= 45) return 'overwhelmingAdvantage';
  if (total >= 25) return 'clearAdvantage';
  if (total >= 8) return 'slightAdvantage';
  if (total > -8) return 'even';
  if (total > -25) return 'slightDisadvantage';
  if (total > -45) return 'clearDisadvantage';
  return 'overwhelmingDisadvantage';
}

export function normalizeConflictJudgement(judgement: ConflictJudgement): ConflictJudgement {
  const normalizedScoreBreakdown = normalizeConflictScoreBreakdown(judgement.scoreBreakdown);
  const calculatedTotal = calculateWarJudgementTotal(normalizedScoreBreakdown);
  const rawBaselineAdvantage = (judgement as { baselineAdvantage?: unknown }).baselineAdvantage;
  const baselineAdvantage =
    typeof rawBaselineAdvantage === 'number' && Number.isFinite(rawBaselineAdvantage)
      ? deriveConflictAdvantageBand(rawBaselineAdvantage)
      : judgement.baselineAdvantage;
  return {
    ...judgement,
    ...(baselineAdvantage !== undefined
      ? { baselineAdvantage }
      : calculatedTotal !== undefined
        ? { baselineAdvantage: deriveConflictAdvantageBand(calculatedTotal) }
      : {}),
    ...(normalizedScoreBreakdown
      ? {
          scoreBreakdown: {
            ...normalizedScoreBreakdown,
            ...(calculatedTotal !== undefined ? { total: calculatedTotal } : {}),
          },
        }
      : {}),
  };
}

/**
 * LLM 战争评分是解释性元数据。对确定可恢复的数值漂移在本地收敛，
 * 但不吞掉非数值等结构错误，后者仍交给严格 validator 拒绝。
 */
export function normalizeConflictScoreBreakdown(
  scoreBreakdown?: ConflictScoreBreakdown,
): ConflictScoreBreakdown | undefined {
  if (!scoreBreakdown) return undefined;

  const normalized: ConflictScoreBreakdown = { ...scoreBreakdown };
  const componentEntries = scoreComponentFields.flatMap((field) => {
    const value = scoreBreakdown[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) return [];
    const bounded = clampScore(value, WAR_COMPONENT_LIMIT);
    normalized[field] = bounded;
    return [{ field, value: bounded }];
  });

  if (componentEntries.length === 0) {
    if (typeof scoreBreakdown.total === 'number' && Number.isFinite(scoreBreakdown.total)) {
      normalized.total = clampScore(scoreBreakdown.total, WAR_TOTAL_LIMIT);
    }
    return normalized;
  }

  const rawTotal = componentEntries.reduce((sum, entry) => sum + entry.value, 0);
  if (Math.abs(rawTotal) <= WAR_TOTAL_LIMIT) {
    normalized.total = rawTotal;
    return normalized;
  }

  const targetTotal = Math.sign(rawTotal) * WAR_TOTAL_LIMIT;
  const scale = WAR_TOTAL_LIMIT / Math.abs(rawTotal);
  const scaledEntries = componentEntries.map((entry) => ({
    ...entry,
    value: Math.round(entry.value * scale),
  }));
  let scaledTotal = scaledEntries.reduce((sum, entry) => sum + entry.value, 0);
  let remaining = targetTotal - scaledTotal;

  for (const entry of [...scaledEntries].sort((left, right) => Math.abs(right.value) - Math.abs(left.value))) {
    if (remaining === 0) break;
    const adjustment = Math.sign(remaining);
    const adjusted = entry.value + adjustment;
    if (Math.abs(adjusted) > WAR_COMPONENT_LIMIT) continue;
    entry.value = adjusted;
    scaledTotal += adjustment;
    remaining -= adjustment;
  }

  for (const entry of scaledEntries) {
    normalized[entry.field] = entry.value;
  }
  normalized.total = scaledTotal;
  return normalized;
}

function calculateTroopSizeScore(ownSize?: number, enemySize?: number): number {
  if (!isPositiveNumber(ownSize) || !isPositiveNumber(enemySize)) return 0;
  const ratio = ownSize / enemySize;
  return clampScore(Math.round(Math.log2(ratio) * 12), 35);
}

function calculateTroopQualityScore(own: WarSideScoreInput, enemy: WarSideScoreInput): number {
  const ownQuality = averageKnownValues([own.morale, own.training, own.quality, own.readiness]);
  const enemyQuality = averageKnownValues([enemy.morale, enemy.training, enemy.quality, enemy.readiness]);
  if (ownQuality === undefined || enemyQuality === undefined) return 0;
  return clampScore(Math.round((ownQuality - enemyQuality) * 0.25), 25);
}

function calculateCommanderScore(own?: WarCommanderScoreInput, enemy?: WarCommanderScoreInput): number {
  const ownScore = calculateCommanderWeightedScore(own);
  const enemyScore = calculateCommanderWeightedScore(enemy);
  if (ownScore === undefined || enemyScore === undefined) return 0;
  return clampScore(Math.round((ownScore - enemyScore) * 0.6), 40);
}

function calculateCommanderWeightedScore(commander?: WarCommanderScoreInput): number | undefined {
  if (!commander) return undefined;
  const weighted = [
    weightedValue(commander.leadership, 0.5),
    weightedValue(commander.intelligence, 0.2),
    weightedValue(commander.force, 0.15),
    weightedValue(commander.charm, 0.1),
    weightedValue(commander.politics, 0.05),
  ];
  const valid = weighted.filter((value): value is number => value !== undefined);
  if (!valid.length) return undefined;
  return valid.reduce((sum, value) => sum + value, 0);
}

function weightedValue(value: number | undefined, weight: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value * weight;
}

function averageKnownValues(values: Array<number | undefined>): number | undefined {
  const valid = values.filter((value): value is number => Number.isFinite(value));
  if (!valid.length) return undefined;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function isPositiveNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clampScore(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-limit, Math.min(limit, Math.round(value)));
}

function sanitizeNotes(notes?: string[]): string[] | undefined {
  const cleaned = notes?.map((note) => note.trim()).filter(Boolean);
  return cleaned?.length ? cleaned : undefined;
}
