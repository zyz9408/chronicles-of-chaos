import type {
  HoldingCivilAdministrationScope,
  HoldingLedgerEntry,
} from '../types';

export const HOLDING_CIVIL_ADMINISTRATION_SCOPES: HoldingCivilAdministrationScope[] = [
  'none',
  'households',
  'territorial',
  'mixed',
];

export const HOLDING_CIVIL_ADMINISTRATION_SCOPE_LABELS: Record<
  HoldingCivilAdministrationScope,
  string
> = {
  none: '无民政辖境',
  households: '仅辖民户',
  territorial: '完整辖境',
  mixed: '军民混合辖境',
};

const TERRITORIAL_LEGACY_TYPES = new Set<HoldingLedgerEntry['type']>([
  'county',
  'commandery',
  'village',
]);

const CIVIL_SCORE_FIELDS = [
  'agriculture',
  'commerce',
  'population',
  'publicOrder',
  'popularSupport',
  'recruitPotential',
] as const;

const LAND_REGISTER_FIELDS = ['farmlandMu'] as const;

const HOUSEHOLD_REGISTER_FIELDS = [
  'registeredHouseholds',
  'eliteControlledShare',
  'localEliteRelation',
] as const;

const CIVIL_ADMINISTRATION_FIELDS = [
  ...CIVIL_SCORE_FIELDS,
  ...LAND_REGISTER_FIELDS,
  ...HOUSEHOLD_REGISTER_FIELDS,
  'corruption',
] as const;

type HoldingCivilAdministrationInput = Partial<Pick<
  HoldingLedgerEntry,
  'civilAdministrationScope' | (typeof CIVIL_ADMINISTRATION_FIELDS)[number]
>>;

export function isHoldingCivilAdministrationScope(
  value: unknown,
): value is HoldingCivilAdministrationScope {
  return typeof value === 'string'
    && HOLDING_CIVIL_ADMINISTRATION_SCOPES.includes(value as HoldingCivilAdministrationScope);
}

/**
 * 旧档兼容只读取已经存在的结构字段，不读取名称、摘要或剧情文本：
 * - 稳定行政类型继续视为完整辖境；
 * - 模糊设施类型只有既存田亩/编户/豪强字段时才保守保留为 mixed/households；
 * - 普通军营、堡垒、关隘、港口等无民政结构时归为 none。
 */
export function resolveHoldingCivilAdministrationScope(
  holding: Pick<
    HoldingLedgerEntry,
    | 'type'
    | 'civilAdministrationScope'
    | 'farmlandMu'
    | 'registeredHouseholds'
    | 'eliteControlledShare'
    | 'localEliteRelation'
  >,
): HoldingCivilAdministrationScope {
  if (isHoldingCivilAdministrationScope(holding.civilAdministrationScope)) {
    return holding.civilAdministrationScope;
  }
  if (TERRITORIAL_LEGACY_TYPES.has(holding.type)) return 'territorial';

  const hasLandRegister = holding.farmlandMu !== undefined;
  const hasHouseholdRegister = (
    holding.registeredHouseholds !== undefined
    || holding.eliteControlledShare !== undefined
    || holding.localEliteRelation !== undefined
  );

  if (holding.type === 'city') {
    return hasLandRegister ? 'territorial' : 'households';
  }
  if (holding.type === 'estate') {
    if (hasLandRegister) return 'territorial';
    return hasHouseholdRegister ? 'households' : 'territorial';
  }
  if (hasLandRegister) return 'mixed';
  if (hasHouseholdRegister) return 'households';
  return 'none';
}

export function holdingHasHouseholdAdministration(
  holding: Parameters<typeof resolveHoldingCivilAdministrationScope>[0],
): boolean {
  return resolveHoldingCivilAdministrationScope(holding) !== 'none';
}

export function holdingHasLandAdministration(
  holding: Parameters<typeof resolveHoldingCivilAdministrationScope>[0],
): boolean {
  const scope = resolveHoldingCivilAdministrationScope(holding);
  return scope === 'territorial' || scope === 'mixed';
}

export function normalizeLegacyHoldingCivilAdministration(
  holding: HoldingLedgerEntry,
): HoldingLedgerEntry {
  const scope = resolveHoldingCivilAdministrationScope(holding);
  const normalized: HoldingLedgerEntry = {
    ...holding,
    civilAdministrationScope: scope,
  };

  if (scope === 'none') {
    for (const field of CIVIL_SCORE_FIELDS) normalized[field] = 0;
    for (const field of [...LAND_REGISTER_FIELDS, ...HOUSEHOLD_REGISTER_FIELDS]) {
      delete normalized[field];
    }
    delete normalized.corruption;
  } else if (scope === 'households') {
    normalized.agriculture = 0;
    for (const field of LAND_REGISTER_FIELDS) delete normalized[field];
    normalized.corruption ??= 0;
  } else {
    normalized.corruption ??= 0;
  }

  return normalized;
}

export function mergeHoldingCivilAdministrationTransition(
  previous: HoldingLedgerEntry,
  incoming: HoldingCivilAdministrationInput,
  merged: HoldingLedgerEntry,
): HoldingLedgerEntry {
  const normalizedPrevious = normalizeLegacyHoldingCivilAdministration(previous);
  const nextScope = isHoldingCivilAdministrationScope(incoming.civilAdministrationScope)
    ? incoming.civilAdministrationScope
    : normalizedPrevious.civilAdministrationScope;
  const normalized = normalizeLegacyHoldingCivilAdministration({
    ...merged,
    civilAdministrationScope: nextScope,
  });

  for (const field of CIVIL_ADMINISTRATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(incoming, field)) {
      Object.assign(normalized, { [field]: incoming[field] });
    }
  }
  return normalized;
}

export function validateHoldingCivilAdministrationFields(
  holding: Pick<
    HoldingLedgerEntry,
    | 'civilAdministrationScope'
    | 'agriculture'
    | 'commerce'
    | 'population'
    | 'publicOrder'
    | 'popularSupport'
    | 'recruitPotential'
    | 'corruption'
    | 'farmlandMu'
    | 'registeredHouseholds'
    | 'eliteControlledShare'
    | 'localEliteRelation'
  >,
): string[] {
  if (!isHoldingCivilAdministrationScope(holding.civilAdministrationScope)) {
    return ['upsertHoldingLedger.civilAdministrationScope 必须是 none/households/territorial/mixed。'];
  }

  const errors: string[] = [];
  if (holding.civilAdministrationScope === 'none') {
    for (const field of CIVIL_SCORE_FIELDS) {
      if (holding[field] !== 0) {
        errors.push(`upsertHoldingLedger.${field} 在 civilAdministrationScope=none 时必须为 0。`);
      }
    }
    for (const field of [...LAND_REGISTER_FIELDS, ...HOUSEHOLD_REGISTER_FIELDS]) {
      if (holding[field] !== undefined) {
        errors.push(`upsertHoldingLedger.${field} 不适用于 civilAdministrationScope=none。`);
      }
    }
    if (holding.corruption !== undefined) {
      errors.push('upsertHoldingLedger.corruption 不适用于 civilAdministrationScope=none。');
    }
  } else {
    if (
      typeof holding.corruption !== 'number'
      || !Number.isFinite(holding.corruption)
      || holding.corruption < 0
      || holding.corruption > 100
    ) {
      errors.push('upsertHoldingLedger.corruption 在存在民政收益辖境时必须是 0-100 的数字。');
    }
    if (holding.civilAdministrationScope === 'households') {
      if (holding.agriculture !== 0) {
        errors.push('upsertHoldingLedger.agriculture 在 civilAdministrationScope=households 时必须为 0。');
      }
      if (holding.farmlandMu !== undefined) {
        errors.push('upsertHoldingLedger.farmlandMu 不适用于 civilAdministrationScope=households。');
      }
    }
  }
  return errors;
}
