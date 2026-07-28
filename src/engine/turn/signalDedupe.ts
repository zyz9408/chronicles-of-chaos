import type { Rumor } from '../types';
import type { NarratorSignalChangeSuggestion } from './MockNarrator';

type SignalTextLike = {
  action?: NarratorSignalChangeSuggestion['action'];
  title?: string;
  content?: string;
  source?: string;
  potentialOutcomeSummary?: string;
  relatedLocationIds?: string[];
  affectedPlaceIds?: string[];
  affectedNpcIds?: string[];
  affectedFactionIds?: string[];
  affectedForceIds?: string[];
  affectedHoldingIds?: string[];
  consequenceTags?: string[];
  signalType?: NarratorSignalChangeSuggestion['signalType'];
  threadId?: string;
  relatedRegionId?: string;
  relatedFactionId?: string;
  relatedActorId?: string;
  expiresAt?: string;
};

const signalMergeArrayFields = [
  'consequenceTags',
  'affectedNpcIds',
  'affectedFactionIds',
  'affectedPlaceIds',
  'affectedForceIds',
  'affectedHoldingIds',
  'followUpHooks',
  'relatedLocationIds',
  'convertedToQuestIds',
  'convertedToWorldTrendIds',
] as const;

export function mergeSignalChangeSuggestions(
  base: NarratorSignalChangeSuggestion[],
  next: NarratorSignalChangeSuggestion[],
): NarratorSignalChangeSuggestion[] {
  const merged = base.map((change) => cloneSignalChange(change));
  const idIndex = new Map<string, number>();
  const semanticIndexes = new Map<string, number[]>();

  for (let index = 0; index < merged.length; index += 1) {
    indexSignalChange(merged[index], index, idIndex, semanticIndexes);
  }

  for (const change of next) {
    const id = normalizeSignalId(change.rumorId);
    const semanticKey = getSignalSemanticCoreKey(change, true);
    let duplicateIndex = id ? idIndex.get(id) : undefined;

    if (duplicateIndex === undefined && semanticKey) {
      const compatibleIndexes = (semanticIndexes.get(semanticKey) ?? []).filter((index) => {
        const existing = merged[index];
        const existingId = normalizeSignalId(existing.rumorId);
        if (id && existingId && id !== existingId) return false;
        return areSignalSemanticsCompatible(existing, change);
      });
      const candidateIds = new Set(
        compatibleIndexes
          .map((index) => normalizeSignalId(merged[index].rumorId))
          .filter((candidateId): candidateId is string => Boolean(candidateId)),
      );
      if (id || candidateIds.size <= 1) {
        duplicateIndex = compatibleIndexes[0];
      }
    }

    if (duplicateIndex !== undefined) {
      merged[duplicateIndex] = mergeSignalChange(merged[duplicateIndex], change);
      indexSignalChange(merged[duplicateIndex], duplicateIndex, idIndex, semanticIndexes);
      continue;
    }

    const index = merged.length;
    const addition = cloneSignalChange(change);
    merged.push(addition);
    indexSignalChange(addition, index, idIndex, semanticIndexes);
  }

  return merged;
}

export function findReusableSignalBySemantic(
  rumors: Rumor[],
  change: NarratorSignalChangeSuggestion,
): Rumor | undefined {
  const semanticKey = getSignalSemanticCoreKey(change, false);
  const exactSemantic = semanticKey
    ? rumors.find((rumor) => (
      isReusableSignal(rumor)
      && getSignalSemanticCoreKey(rumor, false) === semanticKey
      && areSignalSemanticsCompatible(rumor, change)
    ))
    : undefined;
  return exactSemantic ?? findUniqueReusableSignalByDisplayTitle(rumors, change);
}

export function findReusableRumorBySemantic(rumors: Rumor[], rumor: Rumor): Rumor | undefined {
  const semanticKey = getSignalSemanticCoreKey(rumor, false);
  const exactSemantic = semanticKey
    ? rumors.find((existing) => (
      isReusableSignal(existing)
      && getSignalSemanticCoreKey(existing, false) === semanticKey
      && areSignalSemanticsCompatible(existing, rumor)
    ))
    : undefined;
  return exactSemantic ?? findUniqueReusableSignalByDisplayTitle(rumors, rumor);
}

function findUniqueReusableSignalByDisplayTitle(
  rumors: Rumor[],
  incoming: SignalTextLike,
): Rumor | undefined {
  const title = normalizeSignalText(incoming.title);
  if (!title) return undefined;

  const candidates = rumors.filter((existing) => (
    isReusableSignal(existing)
    && normalizeSignalText(existing.title) === title
    && areSignalIdentityScopesCompatible(existing, incoming)
  ));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function areSignalIdentityScopesCompatible(base: SignalTextLike, next: SignalTextLike): boolean {
  return !hasSignalScalarIdentityConflict(base.threadId, next.threadId)
    && !hasSignalScalarIdentityConflict(base.signalType, next.signalType)
    && !hasSignalScalarIdentityConflict(base.relatedRegionId, next.relatedRegionId)
    && !hasSignalScalarIdentityConflict(base.relatedFactionId, next.relatedFactionId)
    && !hasSignalScalarIdentityConflict(base.relatedActorId, next.relatedActorId)
    && !hasSignalIdScopeConflict(base.relatedLocationIds, next.relatedLocationIds)
    && !hasSignalIdScopeConflict(base.affectedPlaceIds, next.affectedPlaceIds)
    && !hasSignalIdScopeConflict(base.affectedNpcIds, next.affectedNpcIds)
    && !hasSignalIdScopeConflict(base.affectedFactionIds, next.affectedFactionIds)
    && !hasSignalIdScopeConflict(base.affectedForceIds, next.affectedForceIds)
    && !hasSignalIdScopeConflict(base.affectedHoldingIds, next.affectedHoldingIds);
}

function hasSignalScalarIdentityConflict(base: string | undefined, next: string | undefined): boolean {
  const baseKey = normalizeSignalStableId(base);
  const nextKey = normalizeSignalStableId(next);
  return Boolean(baseKey && nextKey && baseKey !== nextKey);
}

function hasSignalIdScopeConflict(base: string[] | undefined, next: string[] | undefined): boolean {
  const baseKeys = new Set((base ?? []).map(normalizeSignalStableId).filter(Boolean));
  const nextKeys = new Set((next ?? []).map(normalizeSignalStableId).filter(Boolean));
  if (baseKeys.size === 0 || nextKeys.size === 0) return false;
  return !Array.from(baseKeys).some((value) => nextKeys.has(value));
}

function indexSignalChange(
  change: NarratorSignalChangeSuggestion,
  index: number,
  idIndex: Map<string, number>,
  semanticIndexes: Map<string, number[]>,
): void {
  const id = normalizeSignalId(change.rumorId);
  if (id && !idIndex.has(id)) idIndex.set(id, index);
  const semanticKey = getSignalSemanticCoreKey(change, true);
  if (!semanticKey) return;
  const indexes = semanticIndexes.get(semanticKey) ?? [];
  if (!indexes.includes(index)) indexes.push(index);
  semanticIndexes.set(semanticKey, indexes);
}

function mergeSignalChange(
  base: NarratorSignalChangeSuggestion,
  next: NarratorSignalChangeSuggestion,
): NarratorSignalChangeSuggestion {
  const merged = cloneSignalChange(base);
  const mergedRecord = merged as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    if (
      value !== undefined
      && value !== null
      && (mergedRecord[key] === undefined || mergedRecord[key] === null)
    ) {
      mergedRecord[key] = value;
    }
  }

  for (const key of signalMergeArrayFields) {
    const normalizeValue = isSignalIdArrayField(key) ? normalizeSignalStableId : normalizeSignalText;
    const values = mergeSignalStringArrays(base[key], next[key], normalizeValue);
    if (values) {
      mergedRecord[key] = values;
    }
  }

  return merged;
}

function mergeSignalStringArrays(
  base: string[] | undefined,
  next: string[] | undefined,
  normalizeValue: (value: string | undefined) => string,
): string[] | undefined {
  const values = (base ?? []).map((value) => value.trim()).filter(Boolean);
  const seen = new Set(values.map(normalizeValue));
  for (const value of next ?? []) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeValue(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(trimmed);
  }
  return values.length > 0 ? values : undefined;
}

function getSignalSemanticCoreKey(
  value: SignalTextLike,
  includeAction: boolean,
): string | undefined {
  const action = includeAction ? normalizeSignalText(value.action) : '';
  const title = normalizeSignalText(value.title);
  const content = normalizeSignalText(value.content);
  if (!title && !content) return undefined;
  return encodeSignalParts([action, title, content]);
}

function areSignalSemanticsCompatible(base: SignalTextLike, next: SignalTextLike): boolean {
  return !hasSignalFieldConflict(base.source, next.source)
    && !hasSignalFieldConflict(base.potentialOutcomeSummary, next.potentialOutcomeSummary)
    && !hasSignalFieldConflict(base.relatedLocationIds, next.relatedLocationIds, true)
    && !hasSignalFieldConflict(base.affectedPlaceIds, next.affectedPlaceIds, true)
    && !hasSignalFieldConflict(base.consequenceTags, next.consequenceTags)
    && !hasSignalFieldConflict(base.signalType, next.signalType)
    && !hasSignalFieldConflict(base.expiresAt, next.expiresAt);
}

function hasSignalFieldConflict(
  base: string | string[] | undefined,
  next: string | string[] | undefined,
  stableIdArray = false,
): boolean {
  const baseKey = normalizeSignalField(base, stableIdArray);
  const nextKey = normalizeSignalField(next, stableIdArray);
  return baseKey !== undefined && nextKey !== undefined && baseKey !== nextKey;
}

function normalizeSignalField(value: string | string[] | undefined, stableIdArray: boolean): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    const normalizeValue = stableIdArray ? normalizeSignalStableId : normalizeSignalText;
    const normalized = Array.from(new Set(value.map(normalizeValue).filter(Boolean))).sort();
    return normalized.length > 0 ? encodeSignalParts(normalized) : undefined;
  }
  const normalized = normalizeSignalText(value);
  return normalized || undefined;
}

function isSignalIdArrayField(field: typeof signalMergeArrayFields[number]): boolean {
  return field !== 'consequenceTags' && field !== 'followUpHooks';
}

function normalizeSignalStableId(value: string | undefined): string {
  return value?.trim() ?? '';
}

function cloneSignalChange(change: NarratorSignalChangeSuggestion): NarratorSignalChangeSuggestion {
  const cloned = { ...change };
  for (const key of signalMergeArrayFields) {
    if (change[key]) {
      (cloned as Record<string, unknown>)[key] = [...change[key]!];
    }
  }
  return cloned;
}

function isReusableSignal(rumor: Rumor): boolean {
  return rumor.status === undefined
    || rumor.status === 'open'
    || rumor.status === 'investigating'
    || rumor.status === 'verified';
}

function normalizeSignalId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeSignalText(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[，。！？、：；,.!?:;"'“”‘’（）()[\]{}<>《》\-—_]/g, '')
    .toLowerCase();
}

function encodeSignalParts(values: string[]): string {
  return values.map((value) => `${value.length}:${value}`).join('');
}
