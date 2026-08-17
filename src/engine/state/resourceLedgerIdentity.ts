import type { ResourceLedger } from '../types';

export type CanonicalLedgerNumberField = 'money' | 'grain' | 'horses' | 'arms' | 'recruits';

const canonicalLedgerFieldByAlias = new Map<string, CanonicalLedgerNumberField>([
  ['money', 'money'],
  ['钱财', 'money'],
  ['grain', 'grain'],
  ['粮草', 'grain'],
  ['军粮', 'grain'],
  ['horses', 'horses'],
  ['马匹', 'horses'],
  ['arms', 'arms'],
  ['军械', 'arms'],
  ['recruits', 'recruits'],
  ['可征召人手', 'recruits'],
]);

export function resolveCanonicalLedgerNumberField(
  resourceKey: string,
): CanonicalLedgerNumberField | undefined {
  return canonicalLedgerFieldByAlias.get(resourceKey.trim().toLowerCase());
}

export function isCanonicalLedgerShadowResourceKey(resourceKey: string): boolean {
  return resolveCanonicalLedgerNumberField(resourceKey) !== undefined;
}

export function normalizeCanonicalLedgerResourceShadows(
  resources: ResourceLedger,
  playerResources: Record<string, number>,
): { resources: ResourceLedger; playerResources: Record<string, number> } {
  const nextResources: ResourceLedger = { ...resources };
  const nextPlayerResources: Record<string, number> = {};

  for (const [rawKey, value] of Object.entries(playerResources)) {
    const resourceKey = rawKey.trim();
    const canonicalField = resolveCanonicalLedgerNumberField(resourceKey);
    if (!canonicalField) {
      nextPlayerResources[resourceKey] = value;
      continue;
    }

    // 旧版个人钱财 shadow 只能删除，不能猜测为势力府库钱财。
    if (canonicalField === 'money') continue;
    if (!Number.isFinite(value) || value < 0) continue;
    nextResources[canonicalField] = Math.max(nextResources[canonicalField], value);
  }

  return {
    resources: nextResources,
    playerResources: nextPlayerResources,
  };
}
