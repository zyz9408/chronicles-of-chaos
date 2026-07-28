export type OpeningAbilityScores = Record<string, number>;

export const OPENING_ABILITY_POINT_BUDGET = 30;
export const OPENING_ABILITY_MIN = 1;
export const OPENING_ABILITY_MAX = 99;

function normalizeScore(value: number | undefined, fallback = 50): number {
  const resolved = Number.isFinite(value) ? Math.round(value as number) : fallback;
  return Math.max(OPENING_ABILITY_MIN, Math.min(OPENING_ABILITY_MAX, resolved));
}

function uniqueKeys(keys: string[]): string[] {
  return [...new Set(keys)];
}

export function getOpeningAbilityPointsUsed(
  baseScores: OpeningAbilityScores,
  currentScores: OpeningAbilityScores,
  adjustableKeys: string[],
): number {
  return uniqueKeys(adjustableKeys).reduce((total, key) => {
    const base = normalizeScore(baseScores[key]);
    const current = normalizeScore(currentScores[key], base);
    return total + Math.max(0, current - base);
  }, 0);
}

export function getOpeningAbilityPointsRemaining(
  baseScores: OpeningAbilityScores,
  currentScores: OpeningAbilityScores,
  adjustableKeys: string[],
  budget = OPENING_ABILITY_POINT_BUDGET,
): number {
  return Math.max(0, Math.floor(budget) - getOpeningAbilityPointsUsed(baseScores, currentScores, adjustableKeys));
}

/**
 * 将开局五维收口到“所选预设/补全结果 + 固定可分配点数”。
 * adjustableKeys 之外的隐藏能力保持 currentScores 原值，不参与点数预算。
 */
export function normalizeOpeningAbilityAllocation(
  baseScores: OpeningAbilityScores,
  currentScores: OpeningAbilityScores,
  adjustableKeys: string[],
  budget = OPENING_ABILITY_POINT_BUDGET,
): OpeningAbilityScores {
  const normalized = { ...baseScores, ...currentScores };
  let remaining = Math.max(0, Math.floor(budget));

  for (const key of uniqueKeys(adjustableKeys)) {
    const base = normalizeScore(baseScores[key]);
    const requested = normalizeScore(currentScores[key], base);
    const allocated = Math.min(Math.max(0, requested - base), remaining, OPENING_ABILITY_MAX - base);
    normalized[key] = base + allocated;
    remaining -= allocated;
  }

  return normalized;
}

export function adjustOpeningAbilityAllocation(
  baseScores: OpeningAbilityScores,
  currentScores: OpeningAbilityScores,
  adjustableKeys: string[],
  key: string,
  delta: number,
  budget = OPENING_ABILITY_POINT_BUDGET,
): OpeningAbilityScores {
  if (!adjustableKeys.includes(key) || !Number.isFinite(delta) || delta === 0) {
    return currentScores;
  }

  const normalized = normalizeOpeningAbilityAllocation(baseScores, currentScores, adjustableKeys, budget);
  const base = normalizeScore(baseScores[key]);
  const current = normalizeScore(normalized[key], base);
  const requestedSteps = Math.max(1, Math.abs(Math.trunc(delta)));

  if (delta > 0) {
    const remaining = getOpeningAbilityPointsRemaining(baseScores, normalized, adjustableKeys, budget);
    const applied = Math.min(requestedSteps, remaining, OPENING_ABILITY_MAX - current);
    if (applied <= 0) return normalized;
    return { ...normalized, [key]: current + applied };
  }

  const applied = Math.min(requestedSteps, Math.max(0, current - base));
  if (applied <= 0) return normalized;
  return { ...normalized, [key]: current - applied };
}

export function canIncreaseOpeningAbility(
  baseScores: OpeningAbilityScores,
  currentScores: OpeningAbilityScores,
  adjustableKeys: string[],
  key: string,
  budget = OPENING_ABILITY_POINT_BUDGET,
): boolean {
  return adjustableKeys.includes(key)
    && normalizeScore(currentScores[key], normalizeScore(baseScores[key])) < OPENING_ABILITY_MAX
    && getOpeningAbilityPointsRemaining(baseScores, currentScores, adjustableKeys, budget) > 0;
}

export function canDecreaseOpeningAbility(
  baseScores: OpeningAbilityScores,
  currentScores: OpeningAbilityScores,
  adjustableKeys: string[],
  key: string,
): boolean {
  return adjustableKeys.includes(key)
    && normalizeScore(currentScores[key], normalizeScore(baseScores[key])) > normalizeScore(baseScores[key]);
}
