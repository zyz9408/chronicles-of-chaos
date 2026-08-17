import type {
  HoldingCivilAdministrationScope,
  HoldingCivilScaleLevel,
  HoldingGovernanceProjectEffects,
  HoldingLedgerEntry,
  HoldingType,
} from '../types';

export type CanonicalHoldingType = Exclude<HoldingType, 'commandery'>;

export const CANONICAL_HOLDING_TYPES: readonly CanonicalHoldingType[] = [
  'county',
  'city',
  'fort',
  'pass',
  'camp',
  'estate',
  'port',
  'village',
  'other',
];

/** 旧经济公式的参考田亩，不再作为硬上限。 */
export const HOLDING_SCALE_BASE_FARMLAND_MU: Record<HoldingCivilScaleLevel, number> = {
  1: 1_500,
  2: 4_500,
  3: 12_000,
  4: 30_000,
  5: 70_000,
};

/** 旧经济公式的参考编户，不再作为硬上限。 */
export const HOLDING_SCALE_BASE_HOUSEHOLDS: Record<HoldingCivilScaleLevel, number> = {
  1: 250,
  2: 700,
  3: 1_800,
  4: 4_200,
  5: 10_000,
};

/** 完整辖境下各民政规模的绝对容量。 */
export const HOLDING_CIVIL_SCALE_MAX_FARMLAND_MU: Record<HoldingCivilScaleLevel, number> = {
  1: 15_000,
  2: 60_000,
  3: 200_000,
  4: 600_000,
  5: 1_500_000,
};

export const HOLDING_CIVIL_SCALE_MAX_HOUSEHOLDS: Record<HoldingCivilScaleLevel, number> = {
  1: 1_500,
  2: 5_000,
  3: 18_000,
  4: 50_000,
  5: 120_000,
};

export const HOLDING_CIVIL_SCALE_LABELS: Record<HoldingCivilScaleLevel, string> = {
  1: '小型聚落',
  2: '乡邑辖境',
  3: '县域辖境',
  4: '大县重城',
  5: '区域大城',
};

const TYPE_MAX_SCALE: Record<HoldingType, HoldingLedgerEntry['scaleLevel']> = {
  county: 4,
  commandery: 5,
  city: 5,
  fort: 4,
  pass: 4,
  camp: 4,
  estate: 3,
  port: 4,
  village: 2,
  other: 3,
};

const TYPE_MAX_CIVIL_SCALE: Record<HoldingType, HoldingCivilScaleLevel> = {
  county: 4,
  commandery: 5,
  city: 5,
  fort: 4,
  pass: 4,
  camp: 4,
  estate: 3,
  port: 4,
  village: 2,
  other: 3,
};

const TYPE_CAPACITY_MULTIPLIERS: Record<HoldingType, { farmland: number; households: number }> = {
  county: { farmland: 0.8, households: 0.8 },
  commandery: { farmland: 1, households: 1 },
  city: { farmland: 1, households: 1 },
  fort: { farmland: 0.2, households: 0.2 },
  pass: { farmland: 0.15, households: 0.2 },
  camp: { farmland: 0.3, households: 0.3 },
  estate: { farmland: 0.45, households: 0.35 },
  port: { farmland: 0, households: 0.75 },
  village: { farmland: 0.35, households: 0.3 },
  other: { farmland: 0.5, households: 0.5 },
};

const SCOPE_CAPACITY_MULTIPLIERS: Record<
  HoldingCivilAdministrationScope,
  { farmland: number; households: number }
> = {
  none: { farmland: 0, households: 0 },
  households: { farmland: 0, households: 1 },
  territorial: { farmland: 1, households: 1 },
  mixed: { farmland: 0.5, households: 0.5 },
};

/**
 * 只按稳定地点 ID 识别历史大城，避免用“宛城/洛阳”等名称关键词误判临时地点。
 * 这里表示城池及其直接民政辖境，不等同于把整个郡国塞进一座城。
 */
const STABLE_LOCATION_CIVIL_SCALE: Readonly<Record<string, HoldingCivilScaleLevel>> = {
  place_sili_luoyang: 5,
  place_sili_changan: 5,
  place_nanyang_wan: 5,
  place_jingzhou_wan: 5,
  place_jizhou_ye: 4,
  place_jingzhou_xiangyang: 4,
  place_yizhou_chengdu: 4,
  place_nanyang_xinye: 3,
  place_jingzhou_xinye: 3,
};

export interface HoldingCapacityLimits {
  maxScaleLevel: HoldingLedgerEntry['scaleLevel'];
  maxCivilScaleLevel: HoldingCivilScaleLevel;
  civilScaleLevel: HoldingCivilScaleLevel;
  maxFarmlandMu: number;
  maxRegisteredHouseholds: number;
  maxScore: 100;
}

export type HoldingCapacityTarget = Pick<HoldingLedgerEntry, 'type' | 'scaleLevel'> & Partial<Pick<
  HoldingLedgerEntry,
  | 'holdingId'
  | 'locationId'
  | 'civilAdministrationScope'
  | 'civilScaleLevel'
  | 'farmlandMu'
  | 'registeredHouseholds'
>>;

export function getHoldingTypeMaxScale(type: HoldingType): HoldingLedgerEntry['scaleLevel'] {
  return TYPE_MAX_SCALE[type] ?? TYPE_MAX_SCALE.other;
}

export function getHoldingTypeMaxCivilScale(type: HoldingType): HoldingCivilScaleLevel {
  return TYPE_MAX_CIVIL_SCALE[type] ?? TYPE_MAX_CIVIL_SCALE.other;
}

export function resolveStableLocationCivilScaleLevel(locationId?: string): HoldingCivilScaleLevel | undefined {
  return locationId ? STABLE_LOCATION_CIVIL_SCALE[locationId] : undefined;
}

/**
 * 旧档迁移专用：优先保留显式值和稳定地点档案，再根据既有账面数据提升到能容纳它的最小等级。
 * 不调用模型，也不读取领地名称或叙事文本。
 */
export function resolveHoldingCivilScaleLevel(
  holding: HoldingCapacityTarget,
  resolvedScope?: HoldingCivilAdministrationScope,
): HoldingCivilScaleLevel {
  const maxLevel = getHoldingTypeMaxCivilScale(holding.type);
  const explicit = normalizeCivilScaleLevel(holding.civilScaleLevel);
  if (explicit !== undefined) return Math.min(explicit, maxLevel) as HoldingCivilScaleLevel;

  const stableProfile = resolveStableLocationCivilScaleLevel(holding.locationId);
  const physicalFallback = Math.min(holding.scaleLevel, maxLevel) as HoldingCivilScaleLevel;
  const baseline = Math.max(stableProfile ?? 1, physicalFallback) as HoldingCivilScaleLevel;
  return getMinimumHoldingCivilScaleLevelForValues(
    holding,
    resolvedScope,
    baseline,
  ) ?? maxLevel;
}

export function getMinimumHoldingCivilScaleLevelForValues(
  holding: HoldingCapacityTarget,
  resolvedScope?: HoldingCivilAdministrationScope,
  minimum: HoldingCivilScaleLevel = 1,
): HoldingCivilScaleLevel | undefined {
  const scope = resolvedScope ?? holding.civilAdministrationScope ?? 'none';
  const maxLevel = getHoldingTypeMaxCivilScale(holding.type);
  for (let raw = Math.max(1, minimum); raw <= maxLevel; raw += 1) {
    const level = raw as HoldingCivilScaleLevel;
    const limits = calculateLimitsAtCivilScale(holding.type, scope, level);
    if (
      (holding.farmlandMu === undefined || holding.farmlandMu <= limits.maxFarmlandMu)
      && (
        holding.registeredHouseholds === undefined
        || holding.registeredHouseholds <= limits.maxRegisteredHouseholds
      )
    ) return level;
  }
  return undefined;
}

export function getHoldingCapacityLimits(
  holding: HoldingCapacityTarget,
  resolvedScope?: HoldingCivilAdministrationScope,
): HoldingCapacityLimits {
  const scope = resolvedScope ?? holding.civilAdministrationScope ?? 'none';
  const maxScaleLevel = getHoldingTypeMaxScale(holding.type);
  const maxCivilScaleLevel = getHoldingTypeMaxCivilScale(holding.type);
  const stableProfile = resolveStableLocationCivilScaleLevel(holding.locationId);
  const requestedCivilScale = normalizeCivilScaleLevel(holding.civilScaleLevel)
    ?? stableProfile
    ?? Math.min(holding.scaleLevel, maxCivilScaleLevel) as HoldingCivilScaleLevel;
  const civilScaleLevel = Math.min(requestedCivilScale, maxCivilScaleLevel) as HoldingCivilScaleLevel;
  return {
    maxScaleLevel,
    maxCivilScaleLevel,
    civilScaleLevel,
    ...calculateLimitsAtCivilScale(holding.type, scope, civilScaleLevel),
    maxScore: 100,
  };
}

export function getHoldingGovernanceFieldUpperLimit(
  holding: HoldingCapacityTarget,
  field: keyof HoldingGovernanceProjectEffects,
  resolvedScope?: HoldingCivilAdministrationScope,
): number {
  const limits = getHoldingCapacityLimits(holding, resolvedScope);
  if (field === 'farmlandMu') return limits.maxFarmlandMu;
  if (field === 'registeredHouseholds') return limits.maxRegisteredHouseholds;
  return limits.maxScore;
}

export function validateHoldingCapacityUpdate(
  incoming: HoldingCapacityTarget,
  previous?: HoldingLedgerEntry,
  resolvedScope?: HoldingCivilAdministrationScope,
): string[] {
  const errors: string[] = [];
  const effective: HoldingCapacityTarget = {
    ...incoming,
    locationId: incoming.locationId ?? previous?.locationId,
    civilScaleLevel: incoming.civilScaleLevel ?? previous?.civilScaleLevel,
  };
  const limits = getHoldingCapacityLimits(effective, resolvedScope);
  if (incoming.type === 'commandery' && previous?.type !== 'commandery') {
    errors.push('upsertHoldingLedger.type=commandery 是区域层级，不能新建为具体领地；郡治请使用 city。');
  }
  if (
    incoming.scaleLevel > limits.maxScaleLevel
    && (previous === undefined || incoming.scaleLevel > previous.scaleLevel)
  ) {
    errors.push(`upsertHoldingLedger.scaleLevel 超过 ${incoming.type} 的最高规模 ${limits.maxScaleLevel}。`);
  }
  if (
    incoming.civilScaleLevel !== undefined
    && !isHoldingCivilScaleLevel(incoming.civilScaleLevel)
  ) {
    errors.push('upsertHoldingLedger.civilScaleLevel 必须是 1、2、3、4 或 5。');
  } else if (
    incoming.civilScaleLevel !== undefined
    && incoming.civilScaleLevel > limits.maxCivilScaleLevel
    && (previous === undefined || incoming.civilScaleLevel > (previous.civilScaleLevel ?? 0))
  ) {
    errors.push(
      `upsertHoldingLedger.civilScaleLevel 超过 ${incoming.type} 的最高民政规模 ${limits.maxCivilScaleLevel}。`,
    );
  }
  validateAbsoluteCapacityField(
    'farmlandMu',
    incoming.farmlandMu,
    previous?.farmlandMu,
    limits.maxFarmlandMu,
    errors,
  );
  validateAbsoluteCapacityField(
    'registeredHouseholds',
    incoming.registeredHouseholds,
    previous?.registeredHouseholds,
    limits.maxRegisteredHouseholds,
    errors,
  );
  return errors;
}

function calculateLimitsAtCivilScale(
  type: HoldingType,
  scope: HoldingCivilAdministrationScope,
  level: HoldingCivilScaleLevel,
): Pick<HoldingCapacityLimits, 'maxFarmlandMu' | 'maxRegisteredHouseholds'> {
  const typeMultiplier = TYPE_CAPACITY_MULTIPLIERS[type] ?? TYPE_CAPACITY_MULTIPLIERS.other;
  const scopeMultiplier = SCOPE_CAPACITY_MULTIPLIERS[scope];
  return {
    maxFarmlandMu: Math.round(
      HOLDING_CIVIL_SCALE_MAX_FARMLAND_MU[level]
      * typeMultiplier.farmland
      * scopeMultiplier.farmland,
    ),
    maxRegisteredHouseholds: Math.round(
      HOLDING_CIVIL_SCALE_MAX_HOUSEHOLDS[level]
      * typeMultiplier.households
      * scopeMultiplier.households,
    ),
  };
}

function normalizeCivilScaleLevel(value: unknown): HoldingCivilScaleLevel | undefined {
  return isHoldingCivilScaleLevel(value) ? value : undefined;
}

function isHoldingCivilScaleLevel(value: unknown): value is HoldingCivilScaleLevel {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function validateAbsoluteCapacityField(
  field: 'farmlandMu' | 'registeredHouseholds',
  incoming: number | undefined,
  previous: number | undefined,
  limit: number,
  errors: string[],
): void {
  if (incoming === undefined || incoming <= limit) return;
  if (previous !== undefined && previous > limit && incoming <= previous) return;
  errors.push(`upsertHoldingLedger.${field}=${incoming} 超过当前类型、范围与民政规模允许的上限 ${limit}。`);
}
