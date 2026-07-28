import type {
  MapNode,
  Relationship,
  RelationshipTargetKind,
  RuntimeState,
  StatePatch,
  WorldBook,
} from '../types';
import {
  buildLocationCanonicalKeys,
  buildLocationCanonicalScopeKey,
} from '../identity/canonicalKeys';
import { getWorldBookMapRoots } from '../map/runtimeMap';
import { getWorldBook } from '../worldbook/WorldBookLoader';
import {
  ensureLuanShiState,
  findExistingHoldingByLedgerIdentity,
} from './createInitialRuntimeState';
import { recoverRejectedCurrentSceneNpcMemories } from './NpcMemoryWritebackRecovery';
import { parseNarratorResponse } from '../turn/NarratorResponseParser';
import { resolveNpcBackgroundActivityAgainstCurrentMatters } from './currentMatterLifecycle';

export const CURRENT_RUNTIME_STATE_VERSION = '0.1.0';
export const CURRENT_RUNTIME_STATE_MIGRATION_VERSION = 8;
const MAX_NESTED_MAP_HIERARCHY_DEPTH = 512;

export interface RuntimeStateMigrationDiagnostic {
  code: 'location-canonical-ambiguous'
    | 'location-seed-scope-conflict'
    | 'location-worldbook-unavailable'
    | 'location-parent-cycle'
    | 'location-hierarchy-flattened';
  message: string;
  locationIds?: string[];
}

export interface RuntimeStateMigrationResult {
  state: RuntimeState;
  complete: boolean;
  diagnostics: RuntimeStateMigrationDiagnostic[];
}

export interface RuntimeStateMigrationContext {
  worldBook?: WorldBook;
  metrics?: RuntimeStateMigrationMetrics;
}

export interface RuntimeStateMigrationMetrics {
  candidateKeyLookups: number;
  depthResolutions: number;
  flattenNodeVisits: number;
  parentEdgeTraversals: number;
  depthStackOperations: number;
  parentGraphNodeVisits: number;
  parentCycleBreaks: number;
  hierarchyNodeAttachments: number;
  flattenedHierarchyNodes: number;
}

export function migrateRuntimeStateForPersistence(
  state: RuntimeState,
  context: RuntimeStateMigrationContext = {},
): RuntimeStateMigrationResult {
  const worldBook = context.worldBook ?? getWorldBook(state.worldBookId);
  if (context.metrics) {
    context.metrics.candidateKeyLookups = 0;
    context.metrics.depthResolutions = 0;
    context.metrics.flattenNodeVisits = 0;
    context.metrics.parentEdgeTraversals = 0;
    context.metrics.depthStackOperations = 0;
    context.metrics.parentGraphNodeVisits = 0;
    context.metrics.parentCycleBreaks = 0;
    context.metrics.hierarchyNodeAttachments = 0;
    context.metrics.flattenedHierarchyNodes = 0;
  }
  const diagnostics: RuntimeStateMigrationDiagnostic[] = [];
  const seedDependentMigrationUnavailable = !worldBook;
  if (seedDependentMigrationUnavailable) {
    diagnostics.push({
      code: 'location-worldbook-unavailable',
      message: `无法解析世界书 ${state.worldBookId}，地点 seed 迁移尚未完成。`,
    });
  }
  return {
    state: normalizeRuntimeState(state, worldBook, diagnostics, context.metrics),
    complete: !seedDependentMigrationUnavailable,
    diagnostics,
  };
}

export function normalizeRuntimeStateForPersistence(state: RuntimeState): RuntimeState {
  return migrateRuntimeStateForPersistence(state).state;
}

function normalizeRuntimeState(
  state: RuntimeState,
  worldBook: WorldBook | undefined,
  diagnostics: RuntimeStateMigrationDiagnostic[],
  metrics?: RuntimeStateMigrationMetrics,
): RuntimeState {
  assertRuntimeStateVersionSupported(state.engineVersion);
  const normalized = reconcilePlayerIdentityDependentFields(
    recoverRejectedCurrentSceneNpcMemories(ensureLuanShiState(cloneRuntimeState(state))),
  );
  const holdingIdMap = buildHoldingIdMap(state, normalized);
  const locationMigration = buildLocationMigration(normalized, worldBook, diagnostics, metrics);
  const locationIdMap = locationMigration.idMap;

  return {
    ...normalized,
    engineVersion: CURRENT_RUNTIME_STATE_VERSION,
    currentLocationId: remapLocationId(normalized.currentLocationId, locationIdMap),
    currentPlaceId: remapOptionalLocationId(normalized.currentPlaceId, locationIdMap),
    currentSceneId: remapOptionalLocationId(normalized.currentSceneId, locationIdMap),
    player: remapActorLocationReferences(normalized.player, locationIdMap),
    knownActors: normalized.knownActors.map((actor) => remapActorLocationReferences(actor, locationIdMap)),
    relationships: normalized.relationships.map(normalizePersistentRelationship),
    knownRumors: normalized.knownRumors.map((rumor) => ({
      ...rumor,
      relatedLocationIds: remapLocationIds(rumor.relatedLocationIds, locationIdMap),
      relatedRegionId: remapOptionalLocationId(rumor.relatedRegionId, locationIdMap),
      affectedPlaceIds: remapLocationIds(rumor.affectedPlaceIds, locationIdMap),
      affectedHoldingIds: remapHoldingIds(rumor.affectedHoldingIds, holdingIdMap),
    })),
    activeQuests: normalized.activeQuests.map((quest) => ({
      ...quest,
      targetLocationId: remapOptionalLocationId(quest.targetLocationId, locationIdMap),
      relatedLocationIds: remapLocationIds(quest.relatedLocationIds, locationIdMap),
      affectedPlaceIds: remapLocationIds(quest.affectedPlaceIds, locationIdMap),
      affectedHoldingIds: remapHoldingIds(quest.affectedHoldingIds, holdingIdMap),
    })),
    mapNodes: normalized.mapNodes ? locationMigration.mapNodes : undefined,
    routeEdges: normalized.routeEdges?.map((route) => ({
      ...route,
      fromPlaceId: remapLocationId(route.fromPlaceId, locationIdMap),
      toPlaceId: remapLocationId(route.toPlaceId, locationIdMap),
    })),
    npcs: normalized.npcs?.map((npc) => {
      const backgroundActivity = resolveNpcBackgroundActivityAgainstCurrentMatters(
        npc.backgroundActivity,
        normalized.activeQuests,
        normalized.currentDate,
      );
      return {
        ...npc,
        locationId: remapOptionalLocationId(npc.locationId, locationIdMap),
        ...(npc.backgroundActivity ? { backgroundActivity } : {}),
      };
    }),
    turnEvents: normalized.turnEvents?.map((event) => ({
      ...event,
      locationId: remapLocationId(event.locationId, locationIdMap),
    })),
    locations: remapLegacyLocations(normalized.locations, locationIdMap),
    routes: normalized.routes?.map((route) => ({
      ...route,
      fromLocationId: remapLocationId(route.fromLocationId, locationIdMap),
      toLocationId: remapLocationId(route.toLocationId, locationIdMap),
    })),
    holdings: normalized.holdings?.map((holding) => ({
      ...holding,
      locationId: remapOptionalLocationId(holding.locationId, locationIdMap),
    })),
    privateAssets: normalized.privateAssets?.map((asset) => ({
      ...asset,
      locationId: remapOptionalLocationId(asset.locationId, locationIdMap),
    })),
    troops: normalized.troops?.map((troop) => ({
      ...troop,
      locationId: remapOptionalLocationId(troop.locationId, locationIdMap),
      lastKnownLocationId: remapOptionalLocationId(troop.lastKnownLocationId, locationIdMap),
      destinationLocationId: remapOptionalLocationId(troop.destinationLocationId, locationIdMap),
    })),
    worldTrends: normalized.worldTrends?.map((trend) => ({
      ...trend,
      locationId: remapOptionalLocationId(trend.locationId, locationIdMap),
      relatedPlaceIds: remapLocationIds(trend.relatedPlaceIds, locationIdMap),
      affectedPlaceIds: remapLocationIds(trend.affectedPlaceIds, locationIdMap),
      affectedHoldingIds: remapHoldingIds(trend.affectedHoldingIds, holdingIdMap),
    })),
    conflicts: normalized.conflicts?.map((conflict) => ({
      ...conflict,
      locationId: remapOptionalLocationId(conflict.locationId, locationIdMap),
    })),
    combatRecords: normalized.combatRecords?.map((combat) => ({
      ...combat,
      locationId: remapOptionalLocationId(combat.locationId, locationIdMap),
    })),
    memoryArchive: normalized.memoryArchive
      ? {
          ...normalized.memoryArchive,
          midTermSummaries: normalized.memoryArchive.midTermSummaries.map((summary) => ({
            ...summary,
            relatedLocationIds: remapLocationIds(summary.relatedLocationIds, locationIdMap),
          })),
          longTermFacts: normalized.memoryArchive.longTermFacts.map((fact) => ({
            ...fact,
            relatedLocationIds: remapLocationIds(fact.relatedLocationIds, locationIdMap),
          })),
          locationMemorySummaries: normalized.memoryArchive.locationMemorySummaries.map((summary) => ({
            ...summary,
            locationId: remapLocationId(summary.locationId, locationIdMap),
          })),
        }
      : undefined,
    lastStatePatch: normalized.lastStatePatch
      ? remapPersistentStatePatchLocationReferences(normalized.lastStatePatch, locationIdMap)
      : undefined,
    domesticReports: normalized.domesticReports?.map((report) => ({
      ...report,
      holdingHighlights: report.holdingHighlights?.map((highlight) => ({
        ...highlight,
        holdingId: holdingIdMap.get(highlight.holdingId) ?? highlight.holdingId,
      })),
    })),
    turnLog: normalized.turnLog.map((entry) => ({
      ...entry,
      displayMeta: entry.displayMeta?.holdingAnnualSettlement
        ? {
            ...entry.displayMeta,
            holdingAnnualSettlement: {
              ...entry.displayMeta.holdingAnnualSettlement,
              affectedHoldingIds: remapHoldingIds(
                entry.displayMeta.holdingAnnualSettlement.affectedHoldingIds,
                holdingIdMap,
              ) ?? [],
            },
          }
        : entry.displayMeta,
    })),
  };
}

type PlayerIdentityDependentField = 'currentIdentityDescription' | 'identitySummary';

interface StructuredIdentityFieldResolution {
  found: boolean;
  value?: string;
}

/**
 * Version 7 repairs saves produced before identity updates were atomic. Those
 * saves can contain a new currentIdentity together with the previous title's
 * description/summary. Recovery only trusts the latest structured narrator
 * command (and its paired protagonistProfile); it never parses narrative prose.
 */
function reconcilePlayerIdentityDependentFields(state: RuntimeState): RuntimeState {
  const currentIdentity = normalizeIdentityText(state.player.currentIdentity);
  if (!currentIdentity) return state;

  const description = resolveLatestStructuredIdentityField(
    state,
    currentIdentity,
    'currentIdentityDescription',
  );
  const summary = resolveLatestStructuredIdentityField(state, currentIdentity, 'identitySummary');
  if (!description.found && !summary.found) return state;

  const player = { ...state.player };
  applyResolvedIdentityField(player, 'currentIdentityDescription', description);
  applyResolvedIdentityField(player, 'identitySummary', summary);
  return { ...state, player };
}

function resolveLatestStructuredIdentityField(
  state: RuntimeState,
  currentIdentity: string,
  field: PlayerIdentityDependentField,
): StructuredIdentityFieldResolution {
  for (let logIndex = state.turnLog.length - 1; logIndex >= 0; logIndex -= 1) {
    const rawResponse = state.turnLog[logIndex]?.displayMeta?.rawResponse;
    if (!rawResponse?.trim()) continue;

    const response = parseNarratorResponse(rawResponse);
    const patches = response.statePatches && response.statePatches.length > 0
      ? response.statePatches
      : response.statePatch
        ? [response.statePatch]
        : [];

    for (let patchIndex = patches.length - 1; patchIndex >= 0; patchIndex -= 1) {
      const patch = patches[patchIndex];
      if (patch.type !== 'luanshiCommand' || !isRecordValue(patch.payload)) continue;
      const command = patch.payload.command;
      if (!isRecordValue(command) || command.action !== 'updateCharacterIdentity') continue;
      if (!isPlayerIdentityCommand(command, state.player.id)) continue;

      const hasCurrentIdentity = hasOwnField(command, 'currentIdentity');
      if (!hasCurrentIdentity) {
        if (hasOwnField(command, field)) {
          return { found: true, value: normalizeIdentityText(command[field]) };
        }
        continue;
      }

      const commandIdentity = normalizeIdentityText(command.currentIdentity);
      if (commandIdentity !== currentIdentity) {
        // The stored raw-response window is incomplete or a newer source owns
        // the current identity. Do not guess from an older assignment.
        return { found: false };
      }

      if (hasOwnField(command, field)) {
        return { found: true, value: normalizeIdentityText(command[field]) };
      }

      const profile = response.writeback?.protagonistProfile;
      if (
        profile
        && normalizeIdentityText(profile.currentIdentity) === currentIdentity
        && hasOwnField(profile, field)
      ) {
        return { found: true, value: normalizeIdentityText(profile[field]) };
      }

      // A changed identity without a paired dependent field must not retain the
      // previous identity's text.
      return { found: true };
    }
  }

  return { found: false };
}

function applyResolvedIdentityField(
  player: RuntimeState['player'],
  field: PlayerIdentityDependentField,
  resolution: StructuredIdentityFieldResolution,
): void {
  if (!resolution.found) return;
  if (resolution.value) {
    player[field] = resolution.value;
  } else {
    delete player[field];
  }
}

function isPlayerIdentityCommand(command: Record<string, unknown>, playerId: string): boolean {
  const characterId = normalizeIdentityText(command.characterId);
  return command.characterType === 'player'
    || characterId === 'player'
    || characterId === playerId;
}

function normalizeIdentityText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwnField(value: object, field: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

interface LocatedMapNode {
  node: MapNode;
  parentId?: string;
  seed: boolean;
}

interface LocationMigration {
  idMap: ReadonlyMap<string, string>;
  mapNodes: MapNode[];
}

function buildLocationMigration(
  state: RuntimeState,
  worldBook: WorldBook | undefined,
  diagnostics: RuntimeStateMigrationDiagnostic[],
  metrics?: RuntimeStateMigrationMetrics,
): LocationMigration {
  const seedNodes = flattenMapNodes(worldBook ? getWorldBookMapRoots(worldBook) : [], true, metrics);
  const seedById = new Map(seedNodes.map((entry) => [entry.node.id, entry]));
  const runtimeNodes = flattenMapNodes(state.mapNodes ?? [], false, metrics);
  const runtimeById = new Map(runtimeNodes.map((entry) => [entry.node.id, entry]));
  const idMap = new Map<string, string>();
  const candidateById = new Map(seedNodes.map((entry) => [entry.node.id, entry]));
  const candidateIdsByKey = new Map<string, Set<string>>();
  for (const candidate of seedNodes) indexLocationMigrationCandidate(candidate, candidateIdsByKey);
  const outputById = new Map<string, MapNode>();
  const depthById = new Map<string, number>();

  const orderedRuntimeNodes = [...runtimeNodes].sort((left, right) => {
    const depthDifference = getRuntimeNodeDepth(left, runtimeById, depthById, metrics)
      - getRuntimeNodeDepth(right, runtimeById, depthById, metrics);
    return depthDifference || left.node.id.localeCompare(right.node.id);
  });

  for (const entry of orderedRuntimeNodes) {
    const parentId = remapOptionalParentId(entry.parentId, idMap);
    const adjustedNode: MapNode = {
      ...entry.node,
      parentId,
      subLocations: undefined,
    };
    const exactSeed = seedById.get(adjustedNode.id);
    if (exactSeed && !hasMatchingLocationScope(adjustedNode, parentId, exactSeed)) {
      idMap.set(entry.node.id, exactSeed.node.id);
      diagnostics.push({
        code: 'location-seed-scope-conflict',
        message: `运行地点 ${entry.node.id} 与世界书 seed 的 parentId、mapLayer 或 kind 冲突，已保留 seed。`,
        locationIds: [entry.node.id],
      });
      continue;
    }
    const matchingCandidates = findLocationMigrationCandidates(
      adjustedNode,
      parentId,
      candidateById,
      candidateIdsByKey,
      metrics,
    );
    const canonicalCandidate = exactSeed ?? (matchingCandidates.length === 1 ? matchingCandidates[0] : undefined);
    if (!exactSeed && matchingCandidates.length > 1) {
      diagnostics.push({
        code: 'location-canonical-ambiguous',
        message: `地点 ${entry.node.id} 同时精确命中多个 canonical 候选，已保留 incoming ID。`,
        locationIds: [
          entry.node.id,
          ...matchingCandidates.map((candidate) => candidate.node.id).sort((left, right) => left.localeCompare(right)),
        ],
      });
    }
    const canonicalId = canonicalCandidate?.node.id ?? adjustedNode.id;
    idMap.set(entry.node.id, canonicalId);

    if (canonicalCandidate) {
      const current = outputById.get(canonicalId);
      const mergedNode = mergeMigratedMapNode(
        current,
        adjustedNode,
        canonicalCandidate.node,
        canonicalCandidate.parentId,
      );
      outputById.set(
        canonicalId,
        mergedNode,
      );
      const updatedCandidate = { ...canonicalCandidate, node: mergedNode };
      candidateById.set(canonicalId, updatedCandidate);
      indexLocationMigrationCandidate(updatedCandidate, candidateIdsByKey);
      continue;
    }

    outputById.set(canonicalId, adjustedNode);
    const newCandidate = { node: adjustedNode, parentId, seed: false };
    candidateById.set(canonicalId, newCandidate);
    indexLocationMigrationCandidate(newCandidate, candidateIdsByKey);
  }

  const remappedFlatNodes = [...outputById.values()]
    .map((node) => ({
      ...node,
      parentId: remapOptionalParentId(node.parentId, idMap),
      connectedRegionIds: remapLocationIds(node.connectedRegionIds, idMap) ?? [],
      subLocations: undefined,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    idMap,
    mapNodes: buildSafeRuntimeMapHierarchy(remappedFlatNodes, diagnostics, metrics),
  };
}

function hasMatchingLocationScope(
  node: MapNode,
  parentId: string | undefined,
  candidate: LocatedMapNode,
): boolean {
  return buildLocationCanonicalScopeKey({
    parentId: parentId ?? '',
    mapLayer: node.mapLayer,
    kind: node.level,
  }) === buildLocationCanonicalScopeKey({
    parentId: candidate.parentId ?? '',
    mapLayer: candidate.node.mapLayer,
    kind: candidate.node.level,
  });
}

function flattenMapNodes(
  nodes: MapNode[],
  seed: boolean,
  metrics?: RuntimeStateMigrationMetrics,
): LocatedMapNode[] {
  const result: LocatedMapNode[] = [];
  const stack: Array<{ node: MapNode; inheritedParentId?: string }> = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    stack.push({ node: nodes[index] });
  }

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    if (metrics) metrics.flattenNodeVisits += 1;
    const parentId = current.node.parentId ?? current.inheritedParentId;
    result.push({ node: { ...current.node }, parentId, seed });
    const children = current.node.subLocations ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], inheritedParentId: current.node.id });
    }
  }
  return result;
}

function getRuntimeNodeDepth(
  entry: LocatedMapNode,
  runtimeById: ReadonlyMap<string, LocatedMapNode>,
  depthById: Map<string, number>,
  metrics?: RuntimeStateMigrationMetrics,
): number {
  const cached = depthById.get(entry.node.id);
  if (cached !== undefined) return cached;
  const path: LocatedMapNode[] = [];
  const pathIndexById = new Map<string, number>();
  let cursor = entry;

  while (true) {
    const cursorCached = depthById.get(cursor.node.id);
    if (cursorCached !== undefined) {
      resolveDepthPath(path, cursorCached, depthById, metrics);
      break;
    }

    const cycleStart = pathIndexById.get(cursor.node.id);
    if (cycleStart !== undefined) {
      for (let index = cycleStart; index < path.length; index += 1) {
        depthById.set(path[index].node.id, 0);
        if (metrics) metrics.depthStackOperations += 1;
      }
      resolveDepthPath(path.slice(0, cycleStart), 0, depthById, metrics);
      break;
    }

    pathIndexById.set(cursor.node.id, path.length);
    path.push(cursor);
    if (metrics) {
      metrics.depthResolutions += 1;
      metrics.depthStackOperations += 1;
    }

    const parentId = cursor.parentId?.trim();
    if (parentId && metrics) metrics.parentEdgeTraversals += 1;
    const parent = parentId ? runtimeById.get(parentId) : undefined;
    if (!parent) {
      const terminal = path.pop();
      if (terminal) {
        depthById.set(terminal.node.id, 0);
        if (metrics) metrics.depthStackOperations += 1;
      }
      resolveDepthPath(path, 0, depthById, metrics);
      break;
    }
    cursor = parent;
  }

  return depthById.get(entry.node.id) ?? 0;
}

function resolveDepthPath(
  path: LocatedMapNode[],
  baseDepth: number,
  depthById: Map<string, number>,
  metrics?: RuntimeStateMigrationMetrics,
): void {
  let depth = baseDepth;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    depth += 1;
    depthById.set(path[index].node.id, depth);
    if (metrics) metrics.depthStackOperations += 1;
  }
}

function findLocationMigrationCandidates(
  node: MapNode,
  parentId: string | undefined,
  candidateById: ReadonlyMap<string, LocatedMapNode>,
  candidateIdsByKey: ReadonlyMap<string, ReadonlySet<string>>,
  metrics?: RuntimeStateMigrationMetrics,
): LocatedMapNode[] {
  const keys = buildLocationCanonicalKeys({
    parentId: parentId ?? '',
    mapLayer: node.mapLayer,
    kind: node.level,
    name: node.name,
    aliases: node.aliases,
  });
  const matchesById = new Map<string, LocatedMapNode>();
  for (const key of keys) {
    if (metrics) metrics.candidateKeyLookups += 1;
    for (const candidateId of candidateIdsByKey.get(key) ?? []) {
      const candidate = candidateById.get(candidateId);
      if (candidate) matchesById.set(candidateId, candidate);
    }
  }
  return [...matchesById.values()];
}

function indexLocationMigrationCandidate(
  candidate: LocatedMapNode,
  candidateIdsByKey: Map<string, Set<string>>,
): void {
  const keys = buildLocationCanonicalKeys({
    parentId: candidate.parentId ?? '',
    mapLayer: candidate.node.mapLayer,
    kind: candidate.node.level,
    name: candidate.node.name,
    aliases: candidate.node.aliases,
  });
  for (const key of keys) {
    const candidateIds = candidateIdsByKey.get(key) ?? new Set<string>();
    candidateIds.add(candidate.node.id);
    candidateIdsByKey.set(key, candidateIds);
  }
}

function mergeMigratedMapNode(
  current: MapNode | undefined,
  incoming: MapNode,
  canonical: MapNode,
  parentId: string | undefined,
): MapNode {
  const base = current ?? incoming;
  const canonicalName = canonical.name;
  const aliases = mergeUniqueStrings([
    ...(current?.aliases ?? []),
    ...(canonical.aliases ?? []),
    incoming.name,
    ...(incoming.aliases ?? []),
  ]).filter((alias) => alias !== canonicalName);
  return {
    ...base,
    id: canonical.id,
    name: canonicalName,
    aliases: aliases.length > 0 ? aliases : undefined,
    level: canonical.level,
    mapLayer: canonical.mapLayer,
    parentId,
    connectedRegionIds: mergeUniqueStrings([
      ...(current?.connectedRegionIds ?? []),
      ...incoming.connectedRegionIds,
    ]),
    subLocations: undefined,
  };
}

function buildSafeRuntimeMapHierarchy(
  nodes: MapNode[],
  diagnostics: RuntimeStateMigrationDiagnostic[],
  metrics?: RuntimeStateMigrationMetrics,
): MapNode[] {
  const byId = new Map<string, MapNode>(
    nodes.map((node) => [node.id, { ...node, subLocations: undefined } as MapNode]),
  );
  breakRuntimeMapParentCycles(byId, diagnostics, metrics);
  const depthSummary = measureRuntimeMapParentDepth(byId, metrics);
  if (depthSummary.maxDepth > MAX_NESTED_MAP_HIERARCHY_DEPTH) {
    if (metrics) metrics.flattenedHierarchyNodes = byId.size;
    diagnostics.push({
      code: 'location-hierarchy-flattened',
      message: `地点父链深度 ${depthSummary.maxDepth} 超过安全上限，已保留 parentId 并使用扁平结构持久化。`,
      locationIds: [depthSummary.rootId, depthSummary.deepestId]
        .filter((id, index, values): id is string => Boolean(id) && values.indexOf(id) === index),
    });
    return [...byId.values()];
  }

  const roots: MapNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId && node.parentId !== node.id ? byId.get(node.parentId) : undefined;
    if (!parent) {
      roots.push(node);
      continue;
    }
    parent.subLocations = [...(parent.subLocations ?? []), node];
    if (metrics) metrics.hierarchyNodeAttachments += 1;
  }
  return roots;
}

function breakRuntimeMapParentCycles(
  byId: Map<string, MapNode>,
  diagnostics: RuntimeStateMigrationDiagnostic[],
  metrics?: RuntimeStateMigrationMetrics,
): void {
  const resolved = new Set<string>();
  for (const startId of byId.keys()) {
    if (resolved.has(startId)) continue;
    const path: string[] = [];
    const pathIndexById = new Map<string, number>();
    let cursorId: string | undefined = startId;

    while (cursorId && byId.has(cursorId) && !resolved.has(cursorId)) {
      const cycleStart = pathIndexById.get(cursorId);
      if (cycleStart !== undefined) {
        const cycleIds = path.slice(cycleStart).sort((left, right) => left.localeCompare(right));
        const stableRootId = cycleIds[0];
        const stableRoot = byId.get(stableRootId);
        if (stableRoot) byId.set(stableRootId, { ...stableRoot, parentId: undefined });
        if (metrics) metrics.parentCycleBreaks += 1;
        diagnostics.push({
          code: 'location-parent-cycle',
          message: `地点父级关系存在环，已将 ${stableRootId} 确定性断为根节点。`,
          locationIds: cycleIds,
        });
        break;
      }

      pathIndexById.set(cursorId, path.length);
      path.push(cursorId);
      if (metrics) metrics.parentGraphNodeVisits += 1;
      cursorId = byId.get(cursorId)?.parentId?.trim();
    }

    for (const id of path) resolved.add(id);
  }
}

function measureRuntimeMapParentDepth(
  byId: ReadonlyMap<string, MapNode>,
  metrics?: RuntimeStateMigrationMetrics,
): { maxDepth: number; deepestId?: string; rootId?: string } {
  const depthById = new Map<string, number>();
  const rootById = new Map<string, string>();
  let maxDepth = 0;
  let deepestId: string | undefined;

  for (const startId of byId.keys()) {
    if (depthById.has(startId)) continue;
    const path: string[] = [];
    let cursorId: string | undefined = startId;
    while (cursorId && byId.has(cursorId) && !depthById.has(cursorId)) {
      path.push(cursorId);
      if (metrics) metrics.parentGraphNodeVisits += 1;
      cursorId = byId.get(cursorId)?.parentId?.trim();
    }

    let depth = cursorId ? (depthById.get(cursorId) ?? -1) : -1;
    let rootId = cursorId ? rootById.get(cursorId) : undefined;
    for (let index = path.length - 1; index >= 0; index -= 1) {
      const id = path[index];
      depth += 1;
      rootId ??= id;
      depthById.set(id, depth);
      rootById.set(id, rootId);
      if (depth > maxDepth || (depth === maxDepth && (!deepestId || id.localeCompare(deepestId) < 0))) {
        maxDepth = depth;
        deepestId = id;
      }
    }
  }

  return {
    maxDepth,
    deepestId,
    rootId: deepestId ? rootById.get(deepestId) : undefined,
  };
}

function remapActorLocationReferences(
  actor: RuntimeState['player'],
  idMap: ReadonlyMap<string, string>,
): RuntimeState['player'] {
  return {
    ...actor,
    locationId: remapOptionalLocationId(actor.locationId, idMap),
    playerMemory: actor.playerMemory
      ? {
          ...actor.playerMemory,
          keyDeeds: actor.playerMemory.keyDeeds.map((deed) => ({
            ...deed,
            locationId: remapOptionalLocationId(deed.locationId, idMap),
          })),
        }
      : undefined,
  };
}

function remapLegacyLocations(
  locations: RuntimeState['locations'],
  idMap: ReadonlyMap<string, string>,
): RuntimeState['locations'] {
  if (!locations) return undefined;
  const byId = new Map<string, NonNullable<RuntimeState['locations']>[number]>();
  for (const location of locations) {
    const locationId = remapLocationId(location.locationId, idMap);
    const existing = byId.get(locationId);
    byId.set(locationId, existing
      ? {
          ...existing,
          recentEvents: mergeUniqueStrings([...existing.recentEvents, ...location.recentEvents]),
        }
      : { ...location, locationId });
  }
  return [...byId.values()];
}

function remapPersistentStatePatchLocationReferences(
  patch: StatePatch,
  idMap: ReadonlyMap<string, string>,
): StatePatch {
  if (patch.type === 'locationChange') {
    return remapStatePatchPayload(patch, idMap, ['toLocationId', 'toSceneId']);
  }
  if (patch.type === 'actorDiscovered') {
    return remapStatePatchPayload(patch, idMap, ['locationId']);
  }
  if (patch.type === 'questAdded') {
    return remapStatePatchPayload(patch, idMap, ['targetLocationId'], ['relatedLocationIds', 'affectedPlaceIds']);
  }
  if (patch.type === 'questUpdated') {
    return remapStatePatchPayload(patch, idMap, [], ['relatedLocationIds', 'affectedPlaceIds']);
  }
  if (patch.type === 'rumorAdded') {
    return remapStatePatchPayload(patch, idMap, ['relatedRegionId'], ['relatedLocationIds', 'affectedPlaceIds']);
  }
  if (patch.type !== 'luanshiCommand') return patch;
  const action = patch.payload.action;
  if (action === 'upsertTroopLedger') {
    return remapStatePatchPayload(
      patch,
      idMap,
      ['locationId', 'lastKnownLocationId', 'destinationLocationId'],
    );
  }
  if (action === 'recordTurnEvent' || action === 'upsertNpcProfile'
    || action === 'upsertHoldingLedger' || action === 'upsertPrivateAsset'
    || action === 'upsertConflictRecord' || action === 'upsertCombatRecord') {
    return remapStatePatchPayload(patch, idMap, ['locationId']);
  }
  return patch;
}

function remapStatePatchPayload(
  patch: StatePatch,
  idMap: ReadonlyMap<string, string>,
  singleKeys: string[],
  listKeys: string[] = [],
): StatePatch {
  const payload = { ...patch.payload };
  for (const key of singleKeys) {
    if (typeof payload[key] === 'string') payload[key] = remapLocationId(payload[key], idMap);
  }
  for (const key of listKeys) {
    if (Array.isArray(payload[key])) {
      payload[key] = remapLocationIds(payload[key].filter((id): id is string => typeof id === 'string'), idMap);
    }
  }
  return { ...patch, payload };
}

function remapLocationId(id: string, idMap: ReadonlyMap<string, string>): string {
  return idMap.get(id) ?? id;
}

function remapOptionalLocationId(
  id: string | undefined,
  idMap: ReadonlyMap<string, string>,
): string | undefined {
  return id === undefined ? undefined : remapLocationId(id, idMap);
}

function remapOptionalParentId(
  id: string | undefined,
  idMap: ReadonlyMap<string, string>,
): string | undefined {
  return id === undefined ? undefined : remapLocationId(id.trim(), idMap);
}

function remapLocationIds(
  ids: string[] | undefined,
  idMap: ReadonlyMap<string, string>,
): string[] | undefined {
  if (!ids) return undefined;
  return mergeUniqueStrings(ids.map((id) => remapLocationId(id, idMap)));
}

function mergeUniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function cloneRuntimeState(state: RuntimeState): RuntimeState {
  return JSON.parse(JSON.stringify(state)) as RuntimeState;
}

function normalizePersistentRelationship(relationship: Relationship): Relationship {
  const candidate = relationship as Relationship & {
    targetKind?: unknown;
    targetType?: unknown;
  };
  const targetKind = parseRelationshipTargetKind(candidate.targetKind, 'targetKind');
  const targetType = parseRelationshipTargetKind(candidate.targetType, 'targetType');
  if (targetKind && targetType && targetKind !== targetType) {
    throw new Error(`关系 ${relationship.id} 的 targetKind 与 targetType 冲突`);
  }

  const canonicalKind = targetKind ?? targetType;
  if (!canonicalKind) {
    throw new Error(`关系 ${relationship.id} 缺少有效 targetKind/targetType`);
  }
  if (!Number.isFinite(relationship.value) || relationship.value < -100 || relationship.value > 100) {
    throw new Error(`关系 ${relationship.id} 的 value 必须是 -100 到 100 的 finite number`);
  }
  return {
    ...relationship,
    targetKind: canonicalKind,
    targetType: canonicalKind,
  };
}

function parseRelationshipTargetKind(
  value: unknown,
  field: 'targetKind' | 'targetType',
): RelationshipTargetKind | undefined {
  if (value === undefined) return undefined;
  if (value === 'actor' || value === 'faction') return value;
  throw new Error(`关系 ${field} 必须是 actor 或 faction`);
}

export function assertRuntimeStateVersionSupported(version: string): void {
  if (compareNumericVersions(version, CURRENT_RUNTIME_STATE_VERSION) > 0) {
    throw new Error(`不支持由更新引擎版本 ${version} 写入的运行状态`);
  }
}

export function assertRuntimeStateMigrationVersionSupported(version: number | undefined): void {
  if (version === undefined) return;
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`无效的运行状态迁移版本：${String(version)}`);
  }
  if (version > CURRENT_RUNTIME_STATE_MIGRATION_VERSION) {
    throw new Error(`不支持未来的运行状态迁移版本：${version}`);
  }
}

function compareNumericVersions(left: string, right: string): number {
  const leftParts = parseNumericVersion(left);
  const rightParts = parseNumericVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseNumericVersion(version: string): number[] {
  if (!/^\d+(?:\.\d+)*$/.test(version)) {
    throw new Error(`无法识别运行状态引擎版本：${version}`);
  }
  return version.split('.').map(Number);
}

function buildHoldingIdMap(
  original: RuntimeState,
  normalized: RuntimeState,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const normalizedHoldings = normalized.holdings ?? [];

  for (const holding of original.holdings ?? []) {
    const canonical = findExistingHoldingByLedgerIdentity(normalizedHoldings, holding);
    if (canonical && canonical.holdingId !== holding.holdingId) {
      result.set(holding.holdingId, canonical.holdingId);
    }
  }

  return result;
}

function remapHoldingIds(
  ids: string[] | undefined,
  holdingIdMap: ReadonlyMap<string, string>,
): string[] | undefined {
  if (!ids) return undefined;
  return [...new Set(ids.map((id) => holdingIdMap.get(id) ?? id))];
}
