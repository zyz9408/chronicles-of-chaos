import type {
  PrivateAssetAcquisition,
  PrivateAssetEntry,
  PrivateAssetOwnerScope,
  PrivateAssetType,
} from '../types';

export type PrivateAssetScaleField =
  | 'mu'
  | 'households'
  | 'workers'
  | 'workshopScale'
  | 'ranchCapacity';

export type PrivateAssetScaleLimits = Readonly<Record<PrivateAssetScaleField, number>>;

type PrivateAssetIdentityCandidate = Pick<
  PrivateAssetEntry,
  | 'privateAssetId'
  | 'name'
  | 'type'
  | 'ownerScope'
  | 'locationId'
  | 'locationDescription'
  | 'managerNpcId'
  | 'sourceNote'
  | 'acquisition'
> & {
  aliases?: string[];
};

const INITIAL_LIMITS_BY_TYPE: Readonly<Record<PrivateAssetType, PrivateAssetScaleLimits>> = {
  estate: { mu: 600, households: 80, workers: 60, workshopScale: 2, ranchCapacity: 80 },
  farmland: { mu: 800, households: 100, workers: 50, workshopScale: 1, ranchCapacity: 40 },
  workshop: { mu: 80, households: 24, workers: 100, workshopScale: 3, ranchCapacity: 20 },
  ranch: { mu: 600, households: 60, workers: 50, workshopScale: 1, ranchCapacity: 180 },
  shop: { mu: 30, households: 15, workers: 30, workshopScale: 1, ranchCapacity: 10 },
  ferry: { mu: 50, households: 25, workers: 50, workshopScale: 1, ranchCapacity: 10 },
  mine: { mu: 300, households: 80, workers: 180, workshopScale: 2, ranchCapacity: 20 },
  other: { mu: 300, households: 60, workers: 80, workshopScale: 2, ranchCapacity: 80 },
};

const OWNER_SCOPE_LIMIT_MULTIPLIER: Readonly<Record<PrivateAssetOwnerScope, number>> = {
  personal: 1,
  household: 1.25,
  clan: 1.75,
  retainer: 1,
  faction: 2.5,
};

const ABSOLUTE_LIMIT_MULTIPLIER = 4;
const PROJECT_DELTA_LIMIT_MULTIPLIER = 0.5;
const PRIVATE_ASSET_ACQUISITION_KINDS = new Set<PrivateAssetAcquisition['kind']>([
  'opening',
  'purchase',
  'grant',
  'inheritance',
  'construction',
  'seizure',
  'transfer',
]);

export function getPrivateAssetInitialScaleLimits(
  type: PrivateAssetType,
  ownerScope: PrivateAssetOwnerScope,
): PrivateAssetScaleLimits {
  return scaleLimits(INITIAL_LIMITS_BY_TYPE[type], OWNER_SCOPE_LIMIT_MULTIPLIER[ownerScope]);
}

export function getPrivateAssetAbsoluteScaleLimits(
  type: PrivateAssetType,
  ownerScope: PrivateAssetOwnerScope,
): PrivateAssetScaleLimits {
  return scaleLimits(
    INITIAL_LIMITS_BY_TYPE[type],
    OWNER_SCOPE_LIMIT_MULTIPLIER[ownerScope] * ABSOLUTE_LIMIT_MULTIPLIER,
  );
}

export function getPrivateAssetProjectDeltaLimits(
  type: PrivateAssetType,
  ownerScope: PrivateAssetOwnerScope,
): PrivateAssetScaleLimits {
  const initial = getPrivateAssetInitialScaleLimits(type, ownerScope);
  return {
    mu: Math.max(1, Math.ceil(initial.mu * PROJECT_DELTA_LIMIT_MULTIPLIER)),
    households: Math.max(1, Math.ceil(initial.households * PROJECT_DELTA_LIMIT_MULTIPLIER)),
    workers: Math.max(1, Math.ceil(initial.workers * PROJECT_DELTA_LIMIT_MULTIPLIER)),
    workshopScale: 1,
    ranchCapacity: Math.max(1, Math.ceil(initial.ranchCapacity * PROJECT_DELTA_LIMIT_MULTIPLIER)),
  };
}

export function clampPrivateAssetToAbsoluteLimits(asset: PrivateAssetEntry): PrivateAssetEntry {
  const limits = getPrivateAssetAbsoluteScaleLimits(asset.type, asset.ownerScope);
  return {
    ...asset,
    ...(asset.mu === undefined
      ? {}
      : Number.isFinite(asset.mu)
        ? { mu: clampInteger(asset.mu, limits.mu) }
        : { mu: undefined }),
    ...(asset.households === undefined
      ? {}
      : Number.isFinite(asset.households)
        ? { households: clampInteger(asset.households, limits.households) }
        : { households: undefined }),
    ...(asset.workers === undefined
      ? {}
      : Number.isFinite(asset.workers)
        ? { workers: clampInteger(asset.workers, limits.workers) }
        : { workers: undefined }),
    ...(asset.workshopScale === undefined
      ? {}
      : Number.isFinite(asset.workshopScale) && asset.workshopScale > 0
        ? {
            workshopScale: clampInteger(
              asset.workshopScale,
              limits.workshopScale,
            ) as 1 | 2 | 3 | 4 | 5,
          }
        : { workshopScale: undefined }),
    ...(asset.ranchCapacity === undefined
      ? {}
      : Number.isFinite(asset.ranchCapacity)
        ? { ranchCapacity: clampInteger(asset.ranchCapacity, limits.ranchCapacity) }
        : { ranchCapacity: undefined }),
  };
}

export function findExistingPrivateAssetByLedgerIdentity<T extends PrivateAssetIdentityCandidate>(
  assets: T[],
  incoming: PrivateAssetIdentityCandidate,
): T | undefined {
  const incomingId = safeTrim(incoming.privateAssetId);
  const byId = assets.find((asset) => safeTrim(asset.privateAssetId) === incomingId);
  if (byId) return byId;

  return assets.find((asset) => isSamePrivateAssetIdentity(asset, incoming));
}

export function findPotentialPrivateAssetDuplicate<T extends PrivateAssetIdentityCandidate>(
  assets: T[],
  incoming: PrivateAssetIdentityCandidate,
): T | undefined {
  const exact = findExistingPrivateAssetByLedgerIdentity(assets, incoming);
  if (exact) return exact;

  return assets.find((asset) => {
    if (asset.type !== incoming.type || asset.ownerScope !== incoming.ownerScope) return false;
    const currentLocationId = safeTrim(asset.locationId);
    const incomingLocationId = safeTrim(incoming.locationId);
    if (currentLocationId && incomingLocationId && currentLocationId !== incomingLocationId) return false;

    const similarity = privateAssetNameSimilarity(asset, incoming);
    return similarity >= 0.65;
  });
}

export function normalizePrivateAssetLedgers(assets?: PrivateAssetEntry[]): {
  assets: PrivateAssetEntry[];
  idMap: ReadonlyMap<string, string>;
} {
  const normalized: PrivateAssetEntry[] = [];
  const idMap = new Map<string, string>();

  for (const rawAsset of assets ?? []) {
    const asset = clampPrivateAssetToAbsoluteLimits(normalizePrivateAssetStrings(rawAsset));
    const existing = findExistingPrivateAssetByLedgerIdentity(normalized, asset);
    if (!existing) {
      normalized.push(asset);
      continue;
    }

    const canonicalId = existing.privateAssetId;
    if (asset.privateAssetId !== canonicalId) idMap.set(asset.privateAssetId, canonicalId);
    const names = uniqueStrings([
      existing.name,
      ...(existing.aliases ?? []),
      asset.name,
      ...(asset.aliases ?? []),
    ]);
    const merged = clampPrivateAssetToAbsoluteLimits({
      ...existing,
      ...asset,
      privateAssetId: canonicalId,
      aliases: names.filter((name) => name !== asset.name),
      conditionNotes: mergeOptionalStringLists(existing.conditionNotes, asset.conditionNotes),
      riskNotes: mergeOptionalStringLists(existing.riskNotes, asset.riskNotes),
      recentChanges: mergeOptionalStringLists(existing.recentChanges, asset.recentChanges),
      acquisition: existing.acquisition ?? asset.acquisition,
    });
    normalized[normalized.indexOf(existing)] = merged;
  }

  return { assets: normalized, idMap };
}

export function remapPrivateAssetId(
  id: string,
  idMap: ReadonlyMap<string, string>,
): string {
  return idMap.get(id) ?? id;
}

function isSamePrivateAssetIdentity(
  current: PrivateAssetIdentityCandidate,
  incoming: PrivateAssetIdentityCandidate,
): boolean {
  if (current.type !== incoming.type || current.ownerScope !== incoming.ownerScope) return false;

  const currentAcquisitionRef = safeTrim(current.acquisition?.sourceRefId);
  const incomingAcquisitionRef = safeTrim(incoming.acquisition?.sourceRefId);
  if (currentAcquisitionRef && incomingAcquisitionRef) {
    if (currentAcquisitionRef === incomingAcquisitionRef) return true;
  }

  const currentLocationId = safeTrim(current.locationId);
  const incomingLocationId = safeTrim(incoming.locationId);
  if (currentLocationId && incomingLocationId && currentLocationId !== incomingLocationId) return false;

  const nameSimilarity = privateAssetNameSimilarity(current, incoming);
  if (currentLocationId && incomingLocationId && nameSimilarity >= 0.55) return true;

  const sameManager = Boolean(
    safeTrim(current.managerNpcId)
    && safeTrim(current.managerNpcId) === safeTrim(incoming.managerNpcId),
  );
  const sameSource = Boolean(
    safeTrim(current.sourceNote)
    && normalizePrivateAssetIdentityText(safeTrim(current.sourceNote))
      === normalizePrivateAssetIdentityText(safeTrim(incoming.sourceNote)),
  );
  const locationDescriptionSimilarity = bigramOverlapCoefficient(
    normalizePrivateAssetIdentityText(current.locationDescription ?? ''),
    normalizePrivateAssetIdentityText(incoming.locationDescription ?? ''),
  );
  const sameLocationDescription = locationDescriptionSimilarity >= 0.7;

  return nameSimilarity >= 0.65 && (sameManager || sameSource || sameLocationDescription);
}

function privateAssetNameSimilarity(
  current: Pick<PrivateAssetIdentityCandidate, 'name' | 'aliases'>,
  incoming: Pick<PrivateAssetIdentityCandidate, 'name' | 'aliases'>,
): number {
  const currentNames = [current.name, ...(current.aliases ?? [])]
    .map(normalizePrivateAssetIdentityText)
    .filter(Boolean);
  const incomingNames = [incoming.name, ...(incoming.aliases ?? [])]
    .map(normalizePrivateAssetIdentityText)
    .filter(Boolean);
  return Math.max(
    0,
    ...currentNames.flatMap((left) => incomingNames.map((right) => bigramOverlapCoefficient(left, right))),
  );
}

function normalizePrivateAssetIdentityText(value: string): string {
  return safeTrim(value)
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim()
    .toLocaleLowerCase();
}

function bigramOverlapCoefficient(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftParts = toBigrams(left);
  const rightParts = toBigrams(right);
  if (leftParts.size === 0 || rightParts.size === 0) return 0;
  let intersection = 0;
  for (const part of leftParts) {
    if (rightParts.has(part)) intersection += 1;
  }
  return intersection / Math.min(leftParts.size, rightParts.size);
}

function toBigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function normalizePrivateAssetStrings(asset: PrivateAssetEntry): PrivateAssetEntry {
  const name = safeTrim(asset.name);
  const aliases = uniqueStrings(Array.isArray(asset.aliases) ? asset.aliases : [])
    .filter((alias) => alias !== name);
  const acquisition = normalizePrivateAssetAcquisition(asset.acquisition);
  return {
    ...asset,
    privateAssetId: safeTrim(asset.privateAssetId),
    name,
    ...(aliases.length > 0 ? { aliases } : { aliases: undefined }),
    ...(safeTrim(asset.locationId) ? { locationId: safeTrim(asset.locationId) } : { locationId: undefined }),
    ...(safeTrim(asset.locationDescription)
      ? { locationDescription: safeTrim(asset.locationDescription) }
      : { locationDescription: undefined }),
    ...(safeTrim(asset.managerNpcId)
      ? { managerNpcId: safeTrim(asset.managerNpcId) }
      : { managerNpcId: undefined }),
    summary: safeTrim(asset.summary),
    ...(safeTrim(asset.sourceNote) ? { sourceNote: safeTrim(asset.sourceNote) } : { sourceNote: undefined }),
    ...(acquisition ? { acquisition } : { acquisition: undefined }),
  };
}

function normalizePrivateAssetAcquisition(
  value: PrivateAssetEntry['acquisition'] | undefined,
): PrivateAssetAcquisition | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (!PRIVATE_ASSET_ACQUISITION_KINDS.has(value.kind)) return undefined;
  const occurredAt = safeTrim(value.occurredAt);
  const sourceRefId = safeTrim(value.sourceRefId);
  const summary = safeTrim(value.summary);
  if (!occurredAt || !sourceRefId || !summary) return undefined;
  return {
    kind: value.kind,
    occurredAt,
    sourceRefId,
    summary,
    ...(Number.isFinite(value.costMoney) && value.costMoney! >= 0 ? { costMoney: value.costMoney } : {}),
    ...(Number.isFinite(value.costGrain) && value.costGrain! >= 0 ? { costGrain: value.costGrain } : {}),
  };
}

function scaleLimits(
  base: PrivateAssetScaleLimits,
  multiplier: number,
): PrivateAssetScaleLimits {
  return {
    mu: Math.ceil(base.mu * multiplier),
    households: Math.ceil(base.households * multiplier),
    workers: Math.ceil(base.workers * multiplier),
    workshopScale: Math.min(5, Math.ceil(base.workshopScale * multiplier)),
    ranchCapacity: Math.ceil(base.ranchCapacity * multiplier),
  };
}

function clampInteger(value: number, limit: number): number {
  return Math.max(0, Math.min(limit, Math.round(value)));
}

function mergeOptionalStringLists(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  const merged = uniqueStrings([...(left ?? []), ...(right ?? [])]);
  return merged.length > 0 ? merged : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string').map(safeTrim).filter(Boolean))];
}

function safeTrim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
