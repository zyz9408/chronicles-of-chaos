import type {
  LocationMemorySummary,
  MapLayerKind,
  MapNode,
  MapRouteEdgeV1,
  RuntimeLocationWriteDiagnostic,
  RuntimeState,
  StatePatch,
  WorldBook,
} from '../types';
import {
  buildLocationCanonicalKeys,
  buildLocationCanonicalScopeKey,
  normalizeCanonicalToken,
} from '../identity/canonicalKeys';
import { buildMapV1Index, buildPlaceDisplayPath, isStandableMapNode, type MapV1Index, validateMapRouteEdge } from './mapV1';

export interface RuntimeMapProjectionRoute {
  routeId: string;
  name: string;
  routeKind?: string;
  status: string;
  knownLevel: MapRouteEdgeV1['knownLevel'];
  toPlaceId: string;
  toPlaceName: string;
  toPath: string;
  riskLevel?: number;
  standardTravelMinutes?: number;
  travelTimeText?: string;
  notes?: string;
  destinationScenes: MapNode[];
}

export interface RuntimeMapProjectionParentRegion {
  id: string;
  name: string;
  path: string;
}

export interface RuntimeMapProjection {
  currentPlaceId: string;
  currentSceneId?: string;
  currentPlace?: MapNode;
  currentScene?: MapNode;
  displayPath: string;
  currentHierarchy: MapNode[];
  availableParentRegions: RuntimeMapProjectionParentRegion[];
  scenes: MapNode[];
  nearbyRoutes: RuntimeMapProjectionRoute[];
  locationMemorySummaries: LocationMemorySummary[];
}

export interface RuntimeMapTraversalMetrics {
  collectNodeVisits: number;
}

export interface StructuredLocationWriteSuggestion {
  locationId?: string;
  name: string;
  aliases?: string[];
  kind: string;
  mapLayer?: MapLayerKind;
  parentId?: string;
  parentPath?: string;
  summary: string;
  permanence: 'permanent' | 'rumor' | 'temporary';
  connectedRegionIds?: string[];
  controlHint?: string;
  tensionHint?: string;
}

export interface StructuredRouteWriteSuggestion {
  routeId?: string;
  fromPlaceId: string;
  toPlaceId: string;
  name: string;
  routeKind?: string;
  status: string;
  source?: MapRouteEdgeV1['source'];
  knownLevel: MapRouteEdgeV1['knownLevel'];
  riskLevel?: number;
  standardTravelMinutes?: number;
  travelTimeText?: string;
  notes?: string;
}

export interface RuntimeMapWriteApplication {
  state: RuntimeState;
  applied: boolean;
  errors: string[];
  diagnostics: RuntimeLocationWriteDiagnostic[];
  incomingLocationId?: string;
  canonicalLocationId?: string;
}

export interface RuntimeLocationWriteBatchApplication {
  state: RuntimeState;
  suggestions: StructuredLocationWriteSuggestion[];
  aliasMap: ReadonlyMap<string, string>;
  appliedCount: number;
  errors: string[];
  diagnostics: RuntimeLocationWriteDiagnostic[];
}

export function getWorldBookMapRoots(worldBook: WorldBook): MapNode[] {
  const rootById = new Map<string, MapNode>();
  for (const node of worldBook.mapSeed) {
    rootById.set(node.id, node);
  }
  for (const node of worldBook.openingLocationSeed ?? []) {
    const existing = rootById.get(node.id);
    rootById.set(node.id, existing ? mergeMapNode(existing, node) : node);
  }
  return [...rootById.values()];
}

export function getWorldBookRouteSeed(worldBook: WorldBook): MapRouteEdgeV1[] {
  return worldBook.routeSeed ?? [];
}

export function buildRuntimeRouteEdges(worldBook: WorldBook, state: RuntimeState): MapRouteEdgeV1[] {
  const routesById = new Map<string, MapRouteEdgeV1>();
  for (const route of getWorldBookRouteSeed(worldBook)) {
    routesById.set(route.routeId, route);
  }
  for (const route of state.routeEdges ?? []) {
    const baseRoute = routesById.get(route.routeId);
    routesById.set(route.routeId, baseRoute ? { ...baseRoute, ...route } : route);
  }
  return [...routesById.values()];
}

export function buildRuntimeMapIndex(
  worldBook: WorldBook,
  state: RuntimeState,
  metrics?: RuntimeMapTraversalMetrics,
): MapV1Index {
  if (metrics) metrics.collectNodeVisits = 0;
  return buildMapV1Index(buildEffectiveRuntimeMapNodes(worldBook, state, metrics));
}

export function buildCurrentMapProjection(
  worldBook: WorldBook,
  state: RuntimeState,
  options: {
    sceneLimit?: number;
    routeLimit?: number;
    destinationSceneLimit?: number;
    locationMemoryLimit?: number;
  } = {},
): RuntimeMapProjection {
  const index = buildRuntimeMapIndex(worldBook, state);
  const cursor = resolveCurrentMapCursor(index, state);
  const currentPlaceId = cursor.currentPlaceId;
  const currentSceneId = cursor.currentSceneId;
  const currentPlace = index.nodeById[currentPlaceId];
  const currentScene = currentSceneId ? index.nodeById[currentSceneId] : undefined;
  const sceneLimit = options.sceneLimit ?? 8;
  const routeLimit = options.routeLimit ?? 8;
  const destinationSceneLimit = options.destinationSceneLimit ?? 8;
  const locationMemoryLimit = options.locationMemoryLimit ?? 3;
  const currentHierarchy = collectMapNodeHierarchy(index, currentPlaceId);

  const scenes = index.scenes
    .filter((scene) => index.parentIdByNodeId[scene.id] === currentPlaceId)
    .slice(0, sceneLimit);

  const nearbyRoutes = buildRuntimeRouteEdges(worldBook, state)
    .filter((route) => route.fromPlaceId === currentPlaceId || route.toPlaceId === currentPlaceId)
    .map((route): RuntimeMapProjectionRoute | null => {
      const toPlaceId = route.fromPlaceId === currentPlaceId ? route.toPlaceId : route.fromPlaceId;
      const toPlace = index.nodeById[toPlaceId];
      if (!isStandableMapNode(toPlace)) return null;
      return {
        routeId: route.routeId,
        name: route.name,
        routeKind: route.routeKind,
        status: route.status,
        knownLevel: route.knownLevel,
        toPlaceId,
        toPlaceName: toPlace.name,
        toPath: buildPlaceDisplayPath(index, toPlaceId),
        riskLevel: route.riskLevel,
        standardTravelMinutes: route.standardTravelMinutes,
        travelTimeText: route.travelTimeText,
        notes: route.notes,
        destinationScenes: index.scenes
          .filter((scene) => index.parentIdByNodeId[scene.id] === toPlaceId)
          .slice(0, destinationSceneLimit),
      };
    })
    .filter((route): route is RuntimeMapProjectionRoute => route !== null)
    .slice(0, routeLimit);
  const availableParentRegionIds = new Set<string>();
  for (const node of currentHierarchy) {
    if (node.mapLayer === 'region') availableParentRegionIds.add(node.id);
  }
  for (const route of nearbyRoutes) {
    for (const node of collectMapNodeHierarchy(index, route.toPlaceId)) {
      if (node.mapLayer === 'region') availableParentRegionIds.add(node.id);
    }
  }
  const availableParentRegions = [...availableParentRegionIds]
    .map((id): RuntimeMapProjectionParentRegion | null => {
      const node = index.nodeById[id];
      if (!node) return null;
      return {
        id,
        name: node.name,
        path: buildMapNodeDisplayPath(index, id),
      };
    })
    .filter((region): region is RuntimeMapProjectionParentRegion => region !== null);
  const currentLocationIds = new Set(
    [
      currentPlaceId,
      state.currentLocationId,
      state.currentPlaceId,
      state.currentSceneId,
      currentSceneId,
    ].filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const locationMemorySummaries = (state.memoryArchive?.locationMemorySummaries ?? [])
    .filter((summary) => currentLocationIds.has(summary.locationId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, locationMemoryLimit);

  return {
    currentPlaceId,
    currentSceneId,
    currentPlace,
    currentScene,
    displayPath: isStandableMapNode(currentPlace)
      ? buildPlaceDisplayPath(index, currentPlaceId, currentSceneId)
      : '',
    currentHierarchy,
    availableParentRegions,
    scenes,
    nearbyRoutes,
    locationMemorySummaries,
  };
}

function collectMapNodeHierarchy(index: MapV1Index, nodeId: string): MapNode[] {
  const hierarchy: MapNode[] = [];
  const visited = new Set<string>();
  let cursor: string | undefined = nodeId;

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const node = index.nodeById[cursor];
    if (!node) break;
    hierarchy.unshift(node);
    cursor = index.parentIdByNodeId[cursor];
  }

  return hierarchy;
}

function buildMapNodeDisplayPath(index: MapV1Index, nodeId: string): string {
  return collectMapNodeHierarchy(index, nodeId)
    .map((node) => node.name)
    .join(' - ');
}

/**
 * Builds the human-readable location label used by status surfaces.
 * Stable IDs remain the runtime contract; this function resolves them through
 * Map V1 and only falls back to the legacy location ledger for old saves.
 */
export function buildCurrentLocationDisplayPath(
  worldBook: WorldBook,
  state: RuntimeState,
): string {
  const currentLocationId = state.currentLocationId?.trim();
  const index = buildRuntimeMapIndex(worldBook, state);
  const currentLocationNode = currentLocationId ? index.nodeById[currentLocationId] : undefined;

  if (currentLocationId && !currentLocationNode) {
    const legacyLocation = state.locations?.find((location) => location.locationId === currentLocationId);
    const legacyName = legacyLocation?.name.trim();
    if (legacyName) return legacyName;
  }

  const projection = buildCurrentMapProjection(worldBook, state);
  if (projection.displayPath) {
    const explicitSceneId = state.currentSceneId?.trim();
    if (explicitSceneId && !projection.currentSceneId && !index.nodeById[explicitSceneId]) {
      const legacyScene = state.locations?.find((location) => location.locationId === explicitSceneId);
      const legacySceneName = legacyScene?.name.trim();
      if (legacySceneName) return `${projection.displayPath} - ${legacySceneName}`;
    }
    return projection.displayPath;
  }

  const legacySceneId = state.currentSceneId?.trim();
  const legacyScene = legacySceneId
    ? state.locations?.find((location) => location.locationId === legacySceneId)
    : undefined;
  return legacyScene?.name.trim()
    || currentLocationId
    || state.currentPlaceId?.trim()
    || legacySceneId
    || '未确认';
}

/**
 * Repairs one narrow narrator mistake without weakening location validation:
 * a known scene written into toLocationId is split into its confirmed parent
 * place and toSceneId. Ambiguous or conflicting targets stay untouched so the
 * validator can reject them normally.
 */
export function canonicalizeLocationChangeSceneTargets(
  worldBook: WorldBook,
  state: RuntimeState,
  patches: StatePatch[],
): StatePatch[] {
  const index = buildRuntimeMapIndex(worldBook, state);

  return patches.map((patch) => {
    if (patch.type !== 'locationChange') return patch;

    const toLocationId = typeof patch.payload?.toLocationId === 'string'
      ? patch.payload.toLocationId.trim()
      : '';
    if (!toLocationId) return patch;

    const scene = index.nodeById[toLocationId];
    if (scene?.mapLayer !== 'scene') return patch;

    const parentId = index.parentIdByNodeId[scene.id];
    if (!parentId || !isStandableMapNode(index.nodeById[parentId])) return patch;

    const explicitSceneId = typeof patch.payload.toSceneId === 'string'
      ? patch.payload.toSceneId.trim()
      : '';
    if (explicitSceneId && explicitSceneId !== scene.id) return patch;

    return {
      ...patch,
      payload: {
        ...patch.payload,
        toLocationId: parentId,
        toSceneId: scene.id,
      },
    };
  });
}

function resolveCurrentMapCursor(
  index: MapV1Index,
  state: RuntimeState,
): Pick<RuntimeMapProjection, 'currentPlaceId' | 'currentSceneId'> {
  const locationId = state.currentLocationId?.trim();
  const placeId = state.currentPlaceId?.trim();
  const sceneId = state.currentSceneId?.trim();
  const locationNode = locationId ? index.nodeById[locationId] : undefined;
  const placeNode = placeId ? index.nodeById[placeId] : undefined;

  if (isStandableMapNode(locationNode)) {
    return {
      currentPlaceId: locationId ?? '',
      currentSceneId: resolveSceneIdForPlace(index, sceneId, locationId),
    };
  }

  if (locationNode?.mapLayer === 'scene') {
    const parentId = index.parentIdByNodeId[locationNode.id];
    if (parentId && isStandableMapNode(index.nodeById[parentId])) {
      return {
        currentPlaceId: parentId,
        currentSceneId: locationNode.id,
      };
    }
  }

  if (isStandableMapNode(placeNode)) {
    return {
      currentPlaceId: placeId ?? '',
      currentSceneId: resolveSceneIdForPlace(index, sceneId, placeId),
    };
  }

  return {
    currentPlaceId: placeId || locationId || '',
    currentSceneId: undefined,
  };
}

function resolveSceneIdForPlace(
  index: MapV1Index,
  sceneId: string | undefined,
  placeId: string | undefined,
): string | undefined {
  if (!sceneId || !placeId) return undefined;
  const scene = index.nodeById[sceneId];
  if (scene?.mapLayer !== 'scene') return undefined;
  return index.parentIdByNodeId[scene.id] === placeId ? scene.id : undefined;
}

export function applyLocationWriteSuggestion(
  worldBook: WorldBook,
  state: RuntimeState,
  suggestion: StructuredLocationWriteSuggestion,
): RuntimeMapWriteApplication {
  if (suggestion.permanence !== 'permanent') {
    return {
      state,
      applied: false,
      errors: ['仅永久地点会写入 Map V1；临时地点与风闻地点暂不沉淀为路线节点。'],
      diagnostics: [],
    };
  }

  if (suggestion.kind !== suggestion.kind.trim()) {
    const incomingLocationId = suggestion.locationId?.trim() ?? '';
    const message = '地点 kind 前后不得包含空白字符。';
    return {
      state,
      applied: false,
      errors: [message],
      diagnostics: [{
        code: 'location-kind-malformed',
        message,
        incomingLocationId,
        candidateIds: [],
      }],
      incomingLocationId,
    };
  }

  suggestion = preserveRuntimeOnlyLocationIdentityScope(worldBook, state, suggestion);
  suggestion = resolveLocationSuggestionParent(worldBook, state, suggestion);

  const exactIdScopeConflict = findExactLocationIdScopeConflict(worldBook, state, suggestion);
  if (exactIdScopeConflict) {
    return {
      state,
      applied: false,
      errors: [exactIdScopeConflict.message],
      diagnostics: [{
        code: 'location-canonical-scope-conflict',
        message: exactIdScopeConflict.message,
        incomingLocationId: exactIdScopeConflict.incomingLocationId,
        candidateIds: [exactIdScopeConflict.candidateId],
      }],
      incomingLocationId: suggestion.locationId?.trim(),
    };
  }

  const errors = validateLocationWriteSuggestion(worldBook, state, suggestion);
  if (errors.length > 0) {
    const parentId = suggestion.parentId?.trim() ?? '';
    const parentMissing = Boolean(parentId)
      && !buildRuntimeMapIndex(worldBook, state).nodeById[parentId];
    const diagnostics: RuntimeLocationWriteDiagnostic[] = parentMissing
      ? [{
          code: 'location-parent-unresolved',
          message: `地点父级无法确认：${parentId}${suggestion.parentPath?.trim() ? `（parentPath=${suggestion.parentPath.trim()}）` : ''}`,
          incomingLocationId: suggestion.locationId?.trim() ?? '',
          candidateIds: collectRelevantParentCandidates(worldBook, state, suggestion)
            .map((candidate) => candidate.id),
        }]
      : [];
    return { state, applied: false, errors, diagnostics };
  }

  const incomingLocationId = suggestion.locationId?.trim() ?? '';
  const match = resolveCanonicalLocationMatch(worldBook, state, suggestion);
  if (match.ambiguousCandidateIds.length > 0) {
    const message = `地点 canonical 身份歧义：${incomingLocationId} 同时匹配 ${match.ambiguousCandidateIds.join('、')}`;
    return {
      state,
      applied: false,
      errors: [message],
      diagnostics: [{
        code: 'location-canonical-ambiguous',
        message,
        incomingLocationId,
        candidateIds: match.ambiguousCandidateIds,
      }],
      incomingLocationId,
    };
  }

  const canonicalLocationId = match.canonicalNode?.id ?? incomingLocationId;
  const nextState = cloneRuntimeState(state);
  const canonicalName = match.canonicalNode?.name ?? suggestion.name.trim();
  const canonicalParentId = match.canonicalNode
    ? findMapNodeParentId(worldBook, state, match.canonicalNode.id)
    : suggestion.parentId?.trim();
  const node: MapNode = {
    id: canonicalLocationId,
    name: canonicalName,
    aliases: mergeLocationAliases(match.canonicalNode, suggestion, canonicalName),
    level: match.canonicalNode?.level ?? suggestion.kind.trim(),
    mapLayer: match.canonicalNode?.mapLayer ?? suggestion.mapLayer,
    summary: suggestion.summary.trim(),
    connectedRegionIds: suggestion.connectedRegionIds ?? [],
    controlHint: suggestion.controlHint?.trim() || '由结构化写回确认',
    tensionHint: suggestion.tensionHint?.trim() || '待后续回合更新',
    parentId: canonicalParentId,
  };

  nextState.mapNodes = upsertMapNodeById(nextState.mapNodes ?? [], node);
  return {
    state: nextState,
    applied: true,
    errors: [],
    diagnostics: [],
    incomingLocationId,
    canonicalLocationId,
  };
}

function preserveRuntimeOnlyLocationIdentityScope(
  worldBook: WorldBook,
  state: RuntimeState,
  suggestion: StructuredLocationWriteSuggestion,
): StructuredLocationWriteSuggestion {
  const incomingId = suggestion.locationId?.trim();
  if (!incomingId) return suggestion;
  const seedIndex = buildMapV1Index(getWorldBookMapRoots(worldBook));
  if (seedIndex.nodeById[incomingId]) return suggestion;

  const runtimeEntry = collectMapNodes(state.mapNodes ?? [])
    .find((entry) => entry.node.id === incomingId);
  if (!runtimeEntry) return suggestion;
  const existingIdentityTokens = new Set(
    [runtimeEntry.node.name, ...(runtimeEntry.node.aliases ?? [])]
      .map(normalizeCanonicalToken)
      .filter(Boolean),
  );
  const repeatsSameIdentity = [suggestion.name, ...(suggestion.aliases ?? [])]
    .map(normalizeCanonicalToken)
    .some((token) => token && existingIdentityTokens.has(token));
  if (!repeatsSameIdentity) return suggestion;

  return {
    ...suggestion,
    name: runtimeEntry.node.name,
    kind: runtimeEntry.node.level,
    mapLayer: runtimeEntry.node.mapLayer,
    parentId: runtimeEntry.parentId,
  };
}

function resolveLocationSuggestionParent(
  worldBook: WorldBook,
  state: RuntimeState,
  suggestion: StructuredLocationWriteSuggestion,
): StructuredLocationWriteSuggestion {
  const parentId = suggestion.parentId?.trim() ?? '';
  const index = buildRuntimeMapIndex(worldBook, state);
  if (parentId && index.nodeById[parentId]) {
    return { ...suggestion, parentId };
  }

  const allCandidates = collectExpectedParentCandidates(index, suggestion);
  const parentPathSegments = normalizeParentPathSegments(suggestion.parentPath, suggestion.name);
  if (parentPathSegments.length > 0) {
    const pathMatches = allCandidates.filter((candidate) => {
      const candidateSegments = collectMapNodeHierarchy(index, candidate.id)
        .map((node) => normalizeCanonicalToken(node.name));
      return pathSegmentsEndWith(candidateSegments, parentPathSegments);
    });
    if (pathMatches.length === 1) {
      return { ...suggestion, parentId: pathMatches[0].id };
    }
  }

  const parentIdTokens = normalizeStableIdHintTokens(parentId);
  if (parentIdTokens.length > 0) {
    const relevantCandidates = collectRelevantParentCandidates(worldBook, state, suggestion);
    const relevantMatches = matchParentIdHint(parentIdTokens, relevantCandidates);
    if (relevantMatches.length === 1) {
      return { ...suggestion, parentId: relevantMatches[0].id };
    }
    const allMatches = matchParentIdHint(parentIdTokens, allCandidates);
    if (allMatches.length === 1) {
      return { ...suggestion, parentId: allMatches[0].id };
    }
  }

  return { ...suggestion, parentId: parentId || suggestion.parentId };
}

function collectExpectedParentCandidates(
  index: MapV1Index,
  suggestion: StructuredLocationWriteSuggestion,
): MapNode[] {
  if (suggestion.mapLayer === 'scene') return index.places;
  return index.regions;
}

function collectRelevantParentCandidates(
  worldBook: WorldBook,
  state: RuntimeState,
  suggestion: StructuredLocationWriteSuggestion,
): MapNode[] {
  const index = buildRuntimeMapIndex(worldBook, state);
  const projection = buildCurrentMapProjection(worldBook, state, {
    routeLimit: Number.POSITIVE_INFINITY,
  });
  const relevantIds = suggestion.mapLayer === 'scene'
    ? [projection.currentPlaceId, ...projection.nearbyRoutes.map((route) => route.toPlaceId)]
    : projection.availableParentRegions.map((region) => region.id);
  const relevant = relevantIds
    .map((id) => index.nodeById[id])
    .filter((node): node is MapNode => Boolean(node));
  return relevant.length > 0
    ? [...new Map(relevant.map((node) => [node.id, node])).values()]
    : collectExpectedParentCandidates(index, suggestion);
}

function normalizeParentPathSegments(parentPath: string | undefined, locationName: string): string[] {
  const segments = (parentPath ?? '')
    .split(/\s*(?:\/|>|\||—|–|-|→)\s*/u)
    .map(normalizeCanonicalToken)
    .filter(Boolean);
  if (segments.length > 0 && segments[segments.length - 1] === normalizeCanonicalToken(locationName)) {
    segments.pop();
  }
  return segments;
}

function pathSegmentsEndWith(candidate: string[], suffix: string[]): boolean {
  if (suffix.length > candidate.length) return false;
  const offset = candidate.length - suffix.length;
  return suffix.every((segment, index) => candidate[offset + index] === segment);
}

function normalizeStableIdHintTokens(id: string): string[] {
  return id
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token && !['region', 'loc', 'place', 'scene'].includes(token));
}

function matchParentIdHint(tokens: string[], candidates: MapNode[]): MapNode[] {
  return candidates.filter((candidate) => {
    const candidateTokens = normalizeStableIdHintTokens(candidate.id);
    return tokens.every((token) => candidateTokens.includes(token));
  });
}

function findExactLocationIdScopeConflict(
  worldBook: WorldBook,
  state: RuntimeState,
  suggestion: StructuredLocationWriteSuggestion,
): { message: string; incomingLocationId: string; candidateId: string } | undefined {
  const incomingId = suggestion.locationId?.trim();
  if (!incomingId) return undefined;
  const exact = collectMapNodes([...getWorldBookMapRoots(worldBook), ...(state.mapNodes ?? [])])
    .find((candidate) => candidate.node.id === incomingId);
  if (!exact) return undefined;

  const incomingScope = buildLocationCanonicalScopeKey({
    parentId: suggestion.parentId?.trim() ?? '',
    mapLayer: suggestion.mapLayer,
    kind: suggestion.kind,
  });
  const canonicalScope = buildLocationCanonicalScopeKey({
    parentId: exact.parentId ?? '',
    mapLayer: exact.node.mapLayer,
    kind: exact.node.level,
  });
  if (incomingScope === canonicalScope) return undefined;
  return {
    message: `地点 canonical 身份范围冲突：${incomingId} 不得改变 parentId、mapLayer 或 kind。`,
    incomingLocationId: incomingId,
    candidateId: exact.node.id,
  };
}

export function applyLocationWriteSuggestionsSequentially(
  worldBook: WorldBook,
  state: RuntimeState,
  suggestions: StructuredLocationWriteSuggestion[],
): RuntimeLocationWriteBatchApplication {
  let nextState = state;
  let appliedCount = 0;
  const aliasMap = new Map<string, string>();
  const errors: string[] = [];
  const diagnostics: RuntimeLocationWriteDiagnostic[] = [];
  const canonicalSuggestions: StructuredLocationWriteSuggestion[] = [];

  for (let index = 0; index < suggestions.length; index += 1) {
    const suggestion = suggestions[index];
    const remappedSuggestion: StructuredLocationWriteSuggestion = {
      ...suggestion,
      parentId: remapLocationId(suggestion.parentId?.trim(), aliasMap),
      connectedRegionIds: remapLocationIds(suggestion.connectedRegionIds, aliasMap),
    };
    const result = applyLocationWriteSuggestion(worldBook, nextState, remappedSuggestion);
    nextState = result.state;
    if (result.applied && result.incomingLocationId && result.canonicalLocationId) {
      aliasMap.set(result.incomingLocationId, result.canonicalLocationId);
      appliedCount += 1;
      canonicalSuggestions.push({
        ...remappedSuggestion,
        locationId: result.canonicalLocationId,
      });
    } else {
      canonicalSuggestions.push(remappedSuggestion);
      errors.push(...result.errors.map((error) => `#${index + 1} ${error}`));
      diagnostics.push(...result.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        candidateIds: [...diagnostic.candidateIds],
        suggestionIndex: index,
      })));
    }
  }

  return {
    state: nextState,
    suggestions: canonicalSuggestions,
    aliasMap,
    appliedCount,
    errors,
    diagnostics,
  };
}

export function applyRouteWriteSuggestion(
  worldBook: WorldBook,
  state: RuntimeState,
  suggestion: StructuredRouteWriteSuggestion,
): RuntimeMapWriteApplication {
  const routeId = suggestion.routeId?.trim();
  const errors: string[] = [];
  if (!routeId) errors.push('routeId 不能为空。');

  const route: MapRouteEdgeV1 = {
    routeId: routeId ?? '',
    fromPlaceId: suggestion.fromPlaceId,
    toPlaceId: suggestion.toPlaceId,
    name: suggestion.name,
    routeKind: suggestion.routeKind?.trim() || undefined,
    status: suggestion.status,
    source: parseRouteSource(suggestion.source),
    knownLevel: suggestion.knownLevel,
    riskLevel: normalizeOptionalNumber(suggestion.riskLevel),
    standardTravelMinutes: normalizeOptionalNumber(suggestion.standardTravelMinutes),
    travelTimeText: suggestion.travelTimeText?.trim() || undefined,
    notes: suggestion.notes?.trim() || undefined,
  };

  const validation = validateMapRouteEdge(buildRuntimeMapIndex(worldBook, state), route);
  errors.push(...validation.errors);

  if (errors.length > 0) {
    return { state, applied: false, errors, diagnostics: [] };
  }

  const nextState = cloneRuntimeState(state);
  nextState.routeEdges = upsertByRouteId(nextState.routeEdges ?? [], route);
  return { state: nextState, applied: true, errors: [], diagnostics: [] };
}

function validateLocationWriteSuggestion(
  worldBook: WorldBook,
  state: RuntimeState,
  suggestion: StructuredLocationWriteSuggestion,
): string[] {
  const errors: string[] = [];
  const locationId = suggestion.locationId?.trim();
  const parentId = suggestion.parentId?.trim();
  const mapLayer = suggestion.mapLayer;
  if (!locationId) errors.push('locationId 不能为空。');
  if (!suggestion.name.trim()) errors.push('name 不能为空。');
  if (!suggestion.kind.trim()) errors.push('kind 不能为空。');
  if (!suggestion.summary.trim()) errors.push('summary 不能为空。');
  if (!parentId) errors.push('parentId 不能为空。');
  if (mapLayer !== 'place' && mapLayer !== 'scene') {
    errors.push('mapLayer 必须是 place 或 scene；区域层暂不由回合写回自动创建。');
  }

  if (errors.length > 0) return errors;

  const index = buildRuntimeMapIndex(worldBook, state);
  const parent = index.nodeById[parentId ?? ''];
  if (!parent) {
    errors.push(`parentId 不存在：${parentId}`);
    return errors;
  }

  if (mapLayer === 'scene' && !isStandableMapNode(parent)) {
    errors.push('场景必须挂在具体地点层之下，不能直接挂在区域或其他场景之下。');
  }
  if (mapLayer === 'place' && parent.mapLayer === 'scene') {
    errors.push('具体地点不能挂在场景之下。');
  }

  return errors;
}

function mergeMapNode(base: MapNode, overlay: MapNode): MapNode {
  return {
    ...base,
    ...overlay,
    connectedRegionIds: mergeUniqueStrings(base.connectedRegionIds, overlay.connectedRegionIds),
    aliases: mergeUniqueStrings(base.aliases, overlay.aliases),
    subLocations: mergeMapNodeChildren(base.subLocations, overlay.subLocations),
  };
}

function mergeMapNodeChildren(
  baseChildren: MapNode[] | undefined,
  overlayChildren: MapNode[] | undefined,
): MapNode[] | undefined {
  if (!baseChildren?.length) return overlayChildren;
  if (!overlayChildren?.length) return baseChildren;

  const childById = new Map<string, MapNode>();
  for (const child of baseChildren) {
    childById.set(child.id, child);
  }
  for (const child of overlayChildren) {
    const existing = childById.get(child.id);
    childById.set(child.id, existing ? mergeMapNode(existing, child) : child);
  }
  return [...childById.values()];
}

function mergeUniqueStrings(left: string[] | undefined, right: string[] | undefined): string[] {
  return Array.from(new Set([...(left ?? []), ...(right ?? [])]));
}

function upsertMapNodeById(nodes: MapNode[], node: MapNode): MapNode[] {
  const replaced = replaceMapNodeById(nodes, node);
  return replaced.found ? replaced.nodes : [...nodes, node];
}

function replaceMapNodeById(
  nodes: MapNode[],
  node: MapNode,
): { nodes: MapNode[]; found: boolean } {
  let found = false;
  const next = nodes.map((item) => {
    if (item.id === node.id) {
      found = true;
      return { ...item, ...node, subLocations: item.subLocations };
    }
    if (!item.subLocations?.length) return item;
    const childResult = replaceMapNodeById(item.subLocations, node);
    if (!childResult.found) return item;
    found = true;
    return { ...item, subLocations: childResult.nodes };
  });
  return { nodes: next, found };
}

function resolveCanonicalLocationMatch(
  worldBook: WorldBook,
  state: RuntimeState,
  suggestion: StructuredLocationWriteSuggestion,
): { canonicalNode?: MapNode; ambiguousCandidateIds: string[] } {
  const incomingId = suggestion.locationId?.trim();
  const index = buildRuntimeMapIndex(worldBook, state);
  const candidatesById = new Map(Object.entries(index.nodeById));

  if (incomingId && candidatesById.has(incomingId)) {
    return { canonicalNode: candidatesById.get(incomingId), ambiguousCandidateIds: [] };
  }

  const incomingKeys = new Set(buildLocationCanonicalKeys({
    parentId: suggestion.parentId?.trim() ?? '',
    mapLayer: suggestion.mapLayer,
    kind: suggestion.kind,
    name: suggestion.name,
    aliases: suggestion.aliases,
  }));
  const matches = [...candidatesById.values()].filter((candidate) => {
    const parentId = index.parentIdByNodeId[candidate.id];
    return buildLocationCanonicalKeys({
      parentId: parentId ?? '',
      mapLayer: candidate.mapLayer,
      kind: candidate.level,
      name: candidate.name,
      aliases: candidate.aliases,
    }).some((key) => incomingKeys.has(key));
  });

  if (matches.length === 1) return { canonicalNode: matches[0], ambiguousCandidateIds: [] };
  if (matches.length > 1) {
    return { ambiguousCandidateIds: matches.map((candidate) => candidate.id).sort() };
  }
  return { ambiguousCandidateIds: [] };
}

function collectMapNodes(
  roots: MapNode[],
  inheritedParentId?: string,
  metrics?: RuntimeMapTraversalMetrics,
): Array<{ node: MapNode; parentId?: string }> {
  const result: Array<{ node: MapNode; parentId?: string }> = [];
  const stack: Array<{ node: MapNode; inheritedParentId?: string }> = [];
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    stack.push({ node: roots[index], inheritedParentId });
  }

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    if (metrics) metrics.collectNodeVisits += 1;
    const parentId = current.node.parentId ?? current.inheritedParentId;
    result.push({ node: current.node, parentId });
    const children = current.node.subLocations ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], inheritedParentId: current.node.id });
    }
  }
  return result;
}

function findMapNodeParentId(worldBook: WorldBook, state: RuntimeState, id: string): string | undefined {
  return buildRuntimeMapIndex(worldBook, state).parentIdByNodeId[id];
}

function buildEffectiveRuntimeMapNodes(
  worldBook: WorldBook,
  state: RuntimeState,
  metrics?: RuntimeMapTraversalMetrics,
): MapNode[] {
  const seedEntries = collectMapNodes(getWorldBookMapRoots(worldBook), undefined, metrics);
  const seedIds = new Set(seedEntries.map((entry) => entry.node.id));
  const runtimeById = new Map<string, { node: MapNode; parentId?: string }>();
  for (const entry of collectMapNodes(state.mapNodes ?? [], undefined, metrics)) {
    runtimeById.set(entry.node.id, entry);
  }

  const effectiveSeedNodes = seedEntries.map((seedEntry) => {
    const runtimeEntry = runtimeById.get(seedEntry.node.id);
    if (!runtimeEntry) return flattenEffectiveMapNode(seedEntry.node, seedEntry.parentId);
    return mergeSeedRuntimeOverlay(seedEntry.node, runtimeEntry.node, seedEntry.parentId);
  });
  const runtimeOnlyNodes = [...runtimeById.values()]
    .filter((entry) => !seedIds.has(entry.node.id))
    .map((entry) => flattenEffectiveMapNode(entry.node, entry.parentId));
  return [...effectiveSeedNodes, ...runtimeOnlyNodes];
}

function flattenEffectiveMapNode(node: MapNode, parentId: string | undefined): MapNode {
  return {
    ...node,
    parentId,
    subLocations: undefined,
  };
}

function mergeSeedRuntimeOverlay(
  seed: MapNode,
  runtime: MapNode,
  seedParentId: string | undefined,
): MapNode {
  return {
    ...seed,
    ...runtime,
    id: seed.id,
    name: seed.name,
    aliases: mergeUniqueStrings(seed.aliases, runtime.aliases),
    level: seed.level,
    mapLayer: seed.mapLayer,
    parentId: seedParentId,
    connectedRegionIds: mergeUniqueStrings(seed.connectedRegionIds, runtime.connectedRegionIds),
    subLocations: undefined,
  };
}

function mergeLocationAliases(
  canonicalNode: MapNode | undefined,
  suggestion: StructuredLocationWriteSuggestion,
  canonicalName: string,
): string[] | undefined {
  const canonicalToken = normalizeCanonicalToken(canonicalName);
  const aliases = [...(canonicalNode?.aliases ?? []), suggestion.name, ...(suggestion.aliases ?? [])]
    .map((alias) => alias.trim())
    .filter((alias) => alias && normalizeCanonicalToken(alias) !== canonicalToken);
  const unique = [...new Map(aliases.map((alias) => [normalizeCanonicalToken(alias), alias])).values()];
  return unique.length > 0 ? unique : undefined;
}

function remapLocationId(
  id: string | undefined,
  aliasMap: ReadonlyMap<string, string>,
): string | undefined {
  if (id === undefined) return undefined;
  return aliasMap.get(id) ?? id;
}

function remapLocationIds(
  ids: string[] | undefined,
  aliasMap: ReadonlyMap<string, string>,
): string[] | undefined {
  if (!ids) return undefined;
  return [...new Set(ids.map((id) => aliasMap.get(id) ?? id))];
}

function upsertByRouteId(routes: MapRouteEdgeV1[], route: MapRouteEdgeV1): MapRouteEdgeV1[] {
  const index = routes.findIndex((item) => item.routeId === route.routeId);
  if (index < 0) return [...routes, route];
  const next = [...routes];
  next[index] = route;
  return next;
}

function parseRouteSource(value: MapRouteEdgeV1['source'] | undefined): MapRouteEdgeV1['source'] {
  if (value === 'worldbook' || value === 'player' || value === 'system') return value;
  return 'llm';
}

function normalizeOptionalNumber(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function cloneRuntimeState(state: RuntimeState): RuntimeState {
  return JSON.parse(JSON.stringify(state)) as RuntimeState;
}
