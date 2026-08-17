import type {
  NarratorFactionRecentActionSuggestion,
  NarratorLocationWriteSuggestion,
  NarratorNpcMemorySuggestion,
  NarratorPlotPlanSuggestion,
  NarratorQuestChangeSuggestion,
  NarratorRouteWriteSuggestion,
  NarratorWorldEventSummary,
  NarratorWritebackProtocol,
} from './MockNarrator';
import { mergeSignalChangeSuggestions } from './signalDedupe';

interface RepairIdentity<T extends object> {
  stableId: (value: T) => string | undefined;
  semanticKey: (value: T) => string;
  compatible?: (base: T, next: T) => boolean;
}

const questConflictFields: ReadonlyArray<keyof NarratorQuestChangeSuggestion> = [
  'currentStep',
  'stakes',
  'deadlineAt',
  'source',
  'outcomeSummary',
  'consequenceTags',
  'followUpHooks',
  'relatedNpcIds',
  'relatedLocationIds',
  'relatedFactionIds',
  'affectedNpcIds',
  'affectedFactionIds',
  'affectedPlaceIds',
  'affectedForceIds',
  'affectedHoldingIds',
  'threadId',
  'archiveReason',
];

const plotConflictFields: ReadonlyArray<keyof NarratorPlotPlanSuggestion> = [
  'horizon',
  'status',
  'notBeforeAt',
  'lastAdvancedAt',
];

export function mergeRepairWritebackProtocol(
  original: NarratorWritebackProtocol | undefined,
  repaired: NarratorWritebackProtocol | undefined,
  options: {
    replaceLocationIds?: ReadonlySet<string>;
    replaceRouteIds?: ReadonlySet<string>;
  } = {},
): NarratorWritebackProtocol {
  const base = normalizeWriteback(original);
  const next = normalizeWriteback(repaired);

  return {
    turnSummary: mergeOptionalRecord(base.turnSummary, next.turnSummary),
    protagonistProfile: mergeOptionalRecord(base.protagonistProfile, next.protagonistProfile),
    protagonistMemory: mergeOptionalRecord(base.protagonistMemory, next.protagonistMemory),
    npcProfileSuggestions: mergeRepairItems(
      base.npcProfileSuggestions ?? [],
      next.npcProfileSuggestions ?? [],
      {
        stableId: (profile) => normalizeStableId(profile.npcId),
        semanticKey: (profile) => canonicalStructuralKey(profile),
      },
    ),
    npcMemorySuggestions: mergeRepairItems(
      base.npcMemorySuggestions,
      next.npcMemorySuggestions,
      {
        stableId: getNpcMemoryStableId,
        semanticKey: getNpcMemorySemanticKey,
      },
    ),
    locationWriteSuggestions: mergeRepairItems(
      base.locationWriteSuggestions,
      next.locationWriteSuggestions,
      {
        stableId: (location) => normalizeStableId(location.locationId),
        semanticKey: getLocationSemanticKey,
      },
      options.replaceLocationIds,
    ),
    routeWriteSuggestions: mergeRepairItems(
      base.routeWriteSuggestions,
      next.routeWriteSuggestions,
      {
        stableId: (route) => normalizeStableId(route.routeId),
        semanticKey: getRouteSemanticKey,
      },
      options.replaceRouteIds,
    ),
    questChanges: mergeRepairItems(
      base.questChanges,
      next.questChanges,
      {
        stableId: (quest) => normalizeStableId(quest.questId),
        semanticKey: getQuestSemanticKey,
        compatible: (left, right) => !hasFieldConflict(left, right, questConflictFields),
      },
    ),
    signalChanges: mergeSignalChangeSuggestions(base.signalChanges ?? [], next.signalChanges ?? []),
    plotPlanSuggestions: mergeRepairItems(
      base.plotPlanSuggestions ?? [],
      next.plotPlanSuggestions ?? [],
      {
        stableId: (plot) => normalizeStableId(plot.plotId),
        semanticKey: getPlotSemanticKey,
        compatible: (left, right) => !hasFieldConflict(left, right, plotConflictFields),
      },
    ),
    worldEventUpdates: mergeRepairItems(
      base.worldEventUpdates ?? [],
      next.worldEventUpdates ?? [],
      {
        stableId: (event) => normalizeStableId(event.eventId),
        semanticKey: (event) => canonicalStructuralKey(event),
      },
    ),
    worldEventSummary: mergeWorldEventSummary(base.worldEventSummary, next.worldEventSummary),
    // Recovery semantics are owned by the main narrator. Auxiliary repair may
    // not reinterpret or replace whether the player actually rested.
    playerRecoveryKind: base.playerRecoveryKind,
    // Only the main narrator may start a rules encounter. Auxiliary repair may
    // enrich semantic projections, but must never invent or replace authority.
    encounterTransitionDecision: base.encounterTransitionDecision ?? null,
    encounterStartIntent: base.encounterStartIntent ?? null,
    semanticProjections: mergeRepairItems(
      base.semanticProjections ?? [],
      next.semanticProjections ?? [],
      {
        stableId: (projection) => normalizeStableId(projection.sourceId),
        semanticKey: (projection) => canonicalStructuralKey(projection),
      },
    ),
    factionRecentActionSuggestions: mergeRepairItems(
      base.factionRecentActionSuggestions ?? [],
      next.factionRecentActionSuggestions ?? [],
      {
        stableId: () => undefined,
        semanticKey: getFactionRecentActionSemanticKey,
      },
    ),
    debugNotes: mergeDebugNotes(base.debugNotes, next.debugNotes),
  };
}

function mergeRepairItems<T extends object>(
  base: T[],
  next: T[],
  identity: RepairIdentity<T>,
  replaceStableIds: ReadonlySet<string> | undefined = undefined,
): T[] {
  const merged = base.map((item) => cloneDefined(item));
  const idIndex = new Map<string, number>();
  const semanticIndexes = new Map<string, number[]>();

  for (let index = 0; index < merged.length; index += 1) {
    indexRepairItem(merged[index], index, identity, idIndex, semanticIndexes);
  }

  for (const candidate of next) {
    const stableId = identity.stableId(candidate);
    let duplicateIndex = stableId ? idIndex.get(stableId) : undefined;
    const semanticKey = identity.semanticKey(candidate);

    if (duplicateIndex === undefined) {
      const candidates = semanticIndexes.get(semanticKey) ?? [];
      const compatibleIndexes = candidates.filter((index) => {
        const existing = merged[index];
        const existingId = identity.stableId(existing);
        if (stableId && existingId && stableId !== existingId) return false;
        return identity.compatible?.(existing, candidate) ?? true;
      });
      const candidateIds = new Set(
        compatibleIndexes
          .map((index) => identity.stableId(merged[index]))
          .filter((id): id is string => Boolean(id)),
      );
      if (stableId || candidateIds.size <= 1) {
        duplicateIndex = compatibleIndexes[0];
      }
    }

    if (duplicateIndex !== undefined) {
      merged[duplicateIndex] = stableId && replaceStableIds?.has(stableId)
        ? cloneDefined(candidate)
        : mergePreservingOriginal(merged[duplicateIndex], candidate);
      indexRepairItem(merged[duplicateIndex], duplicateIndex, identity, idIndex, semanticIndexes);
      continue;
    }

    const index = merged.length;
    const addition = cloneDefined(candidate);
    merged.push(addition);
    indexRepairItem(addition, index, identity, idIndex, semanticIndexes);
  }

  return merged;
}

function indexRepairItem<T extends object>(
  value: T,
  index: number,
  identity: RepairIdentity<T>,
  idIndex: Map<string, number>,
  semanticIndexes: Map<string, number[]>,
): void {
  const stableId = identity.stableId(value);
  if (stableId && !idIndex.has(stableId)) idIndex.set(stableId, index);

  const semanticKey = identity.semanticKey(value);
  const indexes = semanticIndexes.get(semanticKey) ?? [];
  if (!indexes.includes(index)) indexes.push(index);
  semanticIndexes.set(semanticKey, indexes);
}

function getFactionRecentActionSemanticKey(value: NarratorFactionRecentActionSuggestion): string {
  return canonicalStructuralKey({
    factionId: value.factionId.trim(),
    summary: value.summary.trim(),
    knownLevel: value.knownLevel,
  });
}

function getNpcMemoryStableId(memory: NarratorNpcMemorySuggestion): string | undefined {
  const eventId = normalizeStableId(memory.eventId);
  const npcId = normalizeStableId(memory.npcId);
  const npcName = normalizeText(memory.npcName);
  if (!eventId || (!npcId && !npcName)) return undefined;
  const npcIdentity = npcId ? encodePart('npcId', npcId) : encodePart('npcName', npcName);
  return encodeParts('npcMemoryEvent', [npcIdentity, eventId]);
}

function getNpcMemorySemanticKey(memory: NarratorNpcMemorySuggestion): string {
  const npcId = normalizeStableId(memory.npcId);
  const npcName = normalizeText(memory.npcName);
  const source = normalizeText(memory.source);
  const content = normalizeText(memory.content);
  if ((!npcId && !npcName) || !source || !content) return canonicalStructuralKey(memory);
  const npcIdentity = npcId ? encodePart('npcId', npcId) : encodePart('npcName', npcName);
  return encodeParts('npcMemory', [npcIdentity, source, content]);
}

function getLocationSemanticKey(location: NarratorLocationWriteSuggestion): string {
  const name = normalizeText(location.name);
  const parentId = normalizeStableId(location.parentId);
  const parentPath = normalizeText(location.parentPath);
  const parent = parentId
    ? encodePart('parentId', parentId)
    : encodePart('parentPath', parentPath);
  const layer = normalizeText(location.mapLayer);
  const kind = normalizeText(location.kind);
  if (!name || !kind || (!parentId && !parentPath)) return canonicalStructuralKey(location);
  return encodeParts('location', [parent, layer, kind, name]);
}

function getRouteSemanticKey(route: NarratorRouteWriteSuggestion): string {
  const from = normalizeStableId(route.fromPlaceId);
  const to = normalizeStableId(route.toPlaceId);
  const kind = normalizeText(route.routeKind);
  const name = normalizeText(route.name);
  if (!from || !to || !kind || !name) return canonicalStructuralKey(route);
  return encodeParts('route', [from, to, kind, name]);
}

function getQuestSemanticKey(quest: NarratorQuestChangeSuggestion): string {
  const action = normalizeText(quest.action);
  const title = normalizeText(quest.title);
  if (!action || !title) return canonicalStructuralKey(quest);
  return encodeParts('quest', [action, title]);
}

function getPlotSemanticKey(plot: NarratorPlotPlanSuggestion): string {
  const action = normalizeText(plot.action);
  const title = normalizeText(plot.title);
  if (!action || !title) return canonicalStructuralKey(plot);
  return encodeParts('plot', [action, title]);
}

function mergeDebugNotes(base: string[], next: string[]): string[] {
  const merged = [...base];
  const seen = new Set(base.map(normalizeText));
  for (const note of next) {
    const key = normalizeText(note);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(note);
  }
  return merged;
}

function mergeWorldEventSummary(
  base: NarratorWorldEventSummary | null | undefined,
  next: NarratorWorldEventSummary | null | undefined,
): NarratorWorldEventSummary | null {
  if (!base) return next ? cloneDefined(next) : null;
  if (!next) return cloneDefined(base);
  const baseId = normalizeStableId(base.eventId);
  const nextId = normalizeStableId(next.eventId);
  if (baseId && nextId && baseId !== nextId) return cloneDefined(base);
  return mergePreservingOriginal(base, next);
}

function mergeOptionalRecord<T extends object>(
  base: T | null | undefined,
  next: T | null | undefined,
): T | null {
  if (!base) return next ? cloneDefined(next) : null;
  if (!next) return cloneDefined(base);
  return mergePreservingOriginal(base, next);
}

function mergePreservingOriginal<T>(base: T, next: T): T {
  if (Array.isArray(base) && Array.isArray(next)) {
    return mergeSemanticArrays(base, next) as T;
  }
  if (!isPlainObject(base) || !isPlainObject(next)) {
    return cloneDefined(base);
  }

  const result: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
  for (const key of keys) {
    const baseValue = base[key];
    const nextValue = next[key];
    if (baseValue === undefined || baseValue === null) {
      if (nextValue !== undefined && nextValue !== null) result[key] = cloneDefined(nextValue);
      continue;
    }
    if (Array.isArray(baseValue) && Array.isArray(nextValue)) {
      result[key] = mergeSemanticArrays(baseValue, nextValue, key);
      continue;
    }
    if (isPlainObject(baseValue) && isPlainObject(nextValue)) {
      result[key] = mergePreservingOriginal(baseValue, nextValue);
      continue;
    }
    result[key] = cloneDefined(baseValue);
  }
  return result as T;
}

function mergeSemanticArrays<T>(base: T[], next: T[], fieldName?: string): T[] {
  const merged = base.map((value) => cloneDefined(value));
  const seen = new Set(base.map((value) => canonicalStructuralKey(value, fieldName)));
  for (const value of next) {
    const key = canonicalStructuralKey(value, fieldName);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(cloneDefined(value));
  }
  return merged;
}

function hasFieldConflict<T extends object>(
  base: T,
  next: T,
  fields: ReadonlyArray<keyof T>,
): boolean {
  return fields.some((field) => {
    const fieldName = String(field);
    const baseValue = meaningfulCanonicalValue(base[field], fieldName);
    const nextValue = meaningfulCanonicalValue(next[field], fieldName);
    return baseValue !== undefined && nextValue !== undefined && baseValue !== nextValue;
  });
}

function meaningfulCanonicalValue(value: unknown, fieldName?: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  if (Array.isArray(value) && value.length === 0) return undefined;
  if (isPlainObject(value) && Object.keys(value).length === 0) return undefined;
  return canonicalStructuralKey(value, fieldName);
}

function canonicalStructuralKey(value: unknown, fieldName?: string): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'string') {
    return isStableIdField(fieldName)
      ? encodePart('id', value.trim())
      : encodePart('text', normalizeText(value));
  }
  if (typeof value === 'number') return encodePart('number', Number.isNaN(value) ? 'NaN' : String(value));
  if (typeof value === 'boolean') return value ? 'boolean:1' : 'boolean:0';
  if (Array.isArray(value)) {
    const values = Array.from(new Set(value.map((entry) => canonicalStructuralKey(entry, fieldName)))).sort();
    return encodeParts('set', values);
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined && entry !== null)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => encodeParts('field', [key, canonicalStructuralKey(entry, key)]));
    return encodeParts('object', entries);
  }
  return encodePart(typeof value, String(value));
}

function isStableIdField(fieldName: string | undefined): boolean {
  return fieldName === 'id' || Boolean(fieldName?.endsWith('Id') || fieldName?.endsWith('Ids'));
}

function cloneDefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneDefined(entry)) as T;
  }
  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = cloneDefined(entry);
  }
  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStableId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeText(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s，。！？、：；,.!?:;"'“”‘’（）()[\]{}<>《》\-—_\/\\]+/g, '');
}

function encodePart(label: string, value: string): string {
  return `${label.length}:${label}${value.length}:${value}`;
}

function encodeParts(label: string, values: string[]): string {
  return encodePart(label, values.map((value) => encodePart('value', value)).join(''));
}

function normalizeWriteback(writeback: NarratorWritebackProtocol | undefined): NarratorWritebackProtocol {
  return {
    turnSummary: writeback?.turnSummary ?? null,
    protagonistProfile: writeback?.protagonistProfile ?? null,
    protagonistMemory: writeback?.protagonistMemory ?? null,
    npcProfileSuggestions: [...(writeback?.npcProfileSuggestions ?? [])],
    npcMemorySuggestions: [...(writeback?.npcMemorySuggestions ?? [])],
    factionRecentActionSuggestions: [...(writeback?.factionRecentActionSuggestions ?? [])],
    locationWriteSuggestions: [...(writeback?.locationWriteSuggestions ?? [])],
    routeWriteSuggestions: [...(writeback?.routeWriteSuggestions ?? [])],
    questChanges: [...(writeback?.questChanges ?? [])],
    signalChanges: [...(writeback?.signalChanges ?? [])],
    plotPlanSuggestions: [...(writeback?.plotPlanSuggestions ?? [])],
    worldEventUpdates: [...(writeback?.worldEventUpdates ?? [])],
    worldEventSummary: writeback?.worldEventSummary ?? null,
    playerRecoveryKind: writeback?.playerRecoveryKind,
    encounterTransitionDecision: writeback?.encounterTransitionDecision ?? null,
    encounterStartIntent: writeback?.encounterStartIntent ?? null,
    semanticProjections: [...(writeback?.semanticProjections ?? [])],
    debugNotes: [...(writeback?.debugNotes ?? [])],
  };
}
