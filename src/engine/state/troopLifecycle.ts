import type { TroopLedgerEntry } from '../types';

type TroopLifecycleStatus = NonNullable<TroopLedgerEntry['lifecycleStatus']>;

const TERMINAL_TROOP_LIFECYCLE_STATUSES = new Set<TroopLifecycleStatus>([
  'merged',
  'split',
  'destroyed',
  'surrendered',
  'disbanded',
  'archived',
]);

export function isCurrentTroopLedgerEntry(
  troop: Pick<TroopLedgerEntry, 'lifecycleStatus'>,
): boolean {
  return !TERMINAL_TROOP_LIFECYCLE_STATUSES.has(troop.lifecycleStatus ?? 'active');
}

export function isTerminalTroopLedgerEntry(
  troop: Pick<TroopLedgerEntry, 'lifecycleStatus'>,
): boolean {
  return !isCurrentTroopLedgerEntry(troop);
}

export function resolveTerminalTroopSuccessorIds(
  troop: Pick<TroopLedgerEntry, 'troopId' | 'lifecycleStatus' | 'mergedIntoTroopId' | 'childTroopIds'>,
): string[] {
  if (!isTerminalTroopLedgerEntry(troop)) return [];

  let candidates: string[] = [];
  if (troop.lifecycleStatus === 'split') {
    candidates = troop.childTroopIds ?? [];
  } else if (
    (troop.lifecycleStatus === 'merged' || troop.lifecycleStatus === 'surrendered')
    && troop.mergedIntoTroopId
  ) {
    candidates = [troop.mergedIntoTroopId];
  }

  return Array.from(new Set(
    candidates
      .map((troopId) => troopId.trim())
      .filter((troopId) => troopId.length > 0 && troopId !== troop.troopId),
  ));
}

export function replaceTerminalTroopReferenceIds(
  troopIds: string[] | undefined,
  troop: Pick<TroopLedgerEntry, 'troopId' | 'lifecycleStatus' | 'mergedIntoTroopId' | 'childTroopIds'>,
): string[] | undefined {
  if (!troopIds || !isTerminalTroopLedgerEntry(troop)) return troopIds;

  const retiredTroopId = troop.troopId.trim();
  if (!troopIds.some((troopId) => troopId.trim() === retiredTroopId)) return troopIds;

  const successorIds = resolveTerminalTroopSuccessorIds(troop);
  const nextIds: string[] = [];
  const seen = new Set<string>();

  const append = (troopId: string) => {
    const normalizedTroopId = troopId.trim();
    if (!normalizedTroopId || seen.has(normalizedTroopId)) return;
    seen.add(normalizedTroopId);
    nextIds.push(normalizedTroopId);
  };

  for (const troopId of troopIds) {
    if (troopId.trim() === retiredTroopId) {
      successorIds.forEach(append);
    } else {
      append(troopId);
    }
  }

  return nextIds;
}

export function normalizeCurrentTroopReferenceIds(
  troopIds: string[] | undefined,
  troops: Array<Pick<TroopLedgerEntry, 'troopId' | 'lifecycleStatus' | 'mergedIntoTroopId' | 'childTroopIds'>>,
): string[] | undefined {
  if (!troopIds) return troopIds;

  const troopById = new Map(
    troops
      .map((troop) => [troop.troopId.trim(), troop] as const)
      .filter(([troopId]) => troopId.length > 0),
  );
  const nextIds: string[] = [];
  const appended = new Set<string>();

  const append = (troopId: string) => {
    if (!troopId || appended.has(troopId)) return;
    appended.add(troopId);
    nextIds.push(troopId);
  };

  const resolve = (troopId: string, visiting: Set<string>) => {
    const normalizedTroopId = troopId.trim();
    if (!normalizedTroopId || visiting.has(normalizedTroopId)) return;

    const troop = troopById.get(normalizedTroopId);
    if (!troop || isCurrentTroopLedgerEntry(troop)) {
      append(normalizedTroopId);
      return;
    }

    const nextVisiting = new Set(visiting);
    nextVisiting.add(normalizedTroopId);
    for (const successorId of resolveTerminalTroopSuccessorIds(troop)) {
      resolve(successorId, nextVisiting);
    }
  };

  for (const troopId of troopIds) resolve(troopId, new Set());

  return nextIds.length === troopIds.length
    && nextIds.every((troopId, index) => troopId === troopIds[index])
    ? troopIds
    : nextIds;
}

export function normalizeDuplicateTerminalTroopLineages(
  troops: TroopLedgerEntry[],
): TroopLedgerEntry[] {
  const duplicateToCanonical = new Map<string, string>();
  const groups = new Map<string, TroopLedgerEntry[]>();

  for (const troop of troops) {
    const signature = terminalLineageSignature(troop);
    if (!signature) continue;
    const group = groups.get(signature) ?? [];
    group.push(troop);
    groups.set(signature, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const candidateIds = new Set(group.map((troop) => troop.troopId));
    const claimedParentIds = new Set(
      troops
        .filter((troop) => troop.parentTroopId && candidateIds.has(troop.parentTroopId))
        .map((troop) => troop.parentTroopId!),
    );
    const canonical = claimedParentIds.size === 1
      ? group.find((troop) => claimedParentIds.has(troop.troopId)) ?? group[0]
      : group[0];
    for (const duplicate of group) {
      if (duplicate.troopId !== canonical.troopId) {
        duplicateToCanonical.set(duplicate.troopId, canonical.troopId);
      }
    }
  }

  if (duplicateToCanonical.size === 0) return troops;

  const remapId = (troopId: string | undefined): string | undefined => {
    if (!troopId) return troopId;
    return duplicateToCanonical.get(troopId) ?? troopId;
  };
  const remapIds = (troopIds: string[] | undefined): string[] | undefined => {
    if (!troopIds) return troopIds;
    return Array.from(new Set(troopIds.map((troopId) => remapId(troopId)!).filter(Boolean)));
  };

  return troops
    .filter((troop) => !duplicateToCanonical.has(troop.troopId))
    .map((troop) => ({
      ...troop,
      parentTroopId: remapId(troop.parentTroopId),
      childTroopIds: remapIds(troop.childTroopIds),
      mergedIntoTroopId: remapId(troop.mergedIntoTroopId),
      mergedFromTroopIds: remapIds(troop.mergedFromTroopIds),
    }));
}

function terminalLineageSignature(troop: TroopLedgerEntry): string | undefined {
  const relatedIds = troop.lifecycleStatus === 'split'
    ? troop.childTroopIds
    : troop.lifecycleStatus === 'merged'
      ? troop.mergedFromTroopIds
      : undefined;
  const normalizedIds = Array.from(new Set(
    (relatedIds ?? []).map((troopId) => troopId.trim()).filter(Boolean),
  )).sort();
  return normalizedIds.length > 0
    ? `${troop.lifecycleStatus}:${normalizedIds.join('|')}`
    : undefined;
}
