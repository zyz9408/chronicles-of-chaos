import type {
  MemoryImportance,
  NpcAwarenessSourceType,
  NpcAwarenessReference,
  NpcMemorySource,
  PlotPlanEntry,
  Quest,
  Rumor,
  LuanShiNpc,
  LuanShiNpcFemaleProfile,
  RuntimeState,
  StatePatch,
  TurnEventRecord,
  WorldBook,
  WorldTrendEntry,
} from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import {
  applyPlayerExperience,
  isValidQuestCompletionExperienceReward,
  MAX_QUEST_COMPLETION_EXPERIENCE_REWARD,
  questCompletionExperienceReward,
} from '../character/progression';
import { deriveNpcCurrentAge, ensureCompleteBirthDate } from '../time/npcAge';
import { mergeStableNpcUniqueArts } from '../character/NpcUniqueArtPolicy';
import type { LuanShiCommand } from '../state/luanshiCommands';
import { normalizeTurnEventVisibility, validateLuanShiCommand } from '../state/luanshiCommands';
import { applyLuanShiCommand } from '../state/luanshiReducers';
import {
  applyLocationWriteSuggestionsSequentially,
  applyRouteWriteSuggestion,
  buildCurrentMapProjection,
  buildRuntimeMapIndex,
  buildRuntimeRouteEdges,
  canonicalizeLocationChangeSceneTargets,
} from '../map/runtimeMap';
import { isStandableMapNode } from '../map/mapV1';
import type { RuntimeLocationWriteDiagnostic } from '../types';
import type {
  NarratorPlotPlanSuggestion,
  NarratorNpcProfileSuggestion,
  NarratorQuestChangeSuggestion,
  NarratorSignalChangeSuggestion,
  NarratorWorldEventSummary,
  NarratorWorldEventUpdate,
  NarratorWritebackProtocol,
} from './MockNarrator';
import { normalizeLuanShiCommand, normalizeLuanShiCommandPatch } from './LuanShiCommandPatch';
import { NPC_PROFILE_EXPLICIT_IS_FOCUSED } from './NarratorResponseParser';
import { findReusableSignalBySemantic, mergeSignalChangeSuggestions } from './signalDedupe';
import { v4 as uuidv4 } from './uuid';
import {
  synchronizeCurrentMatterLifecycle,
  synchronizeNpcBackgroundActivitiesWithCurrentMatters,
} from '../state/currentMatterLifecycle';
import {
  evaluateWorldChronicleEligibility,
  resolveWorldChronicleStatus,
} from '../state/worldChroniclePolicy';
import { applyCorrespondenceWriteback } from '../correspondence';

const recentTurnMemoryLimit = 12;

export interface NarratorWritebackApplication {
  state: RuntimeState;
  appliedSummaries: string[];
  ignoredSummaries: string[];
  diagnostics: RuntimeLocationWriteDiagnostic[];
}

export interface NarratorWritebackApplyOptions {
  allowProtagonistProfileOverwrite?: boolean;
  preparedLocationWriteback?: NarratorLocationWritebackPreparation;
  /** 状态补丁应用前的基线，只用于核对到期承诺是否真的写入了资源/部队/物品。 */
  previousState?: RuntimeState;
}

export interface NarratorLocationWritebackPreparation {
  state: RuntimeState;
  writeback?: NarratorWritebackProtocol;
  aliasMap: ReadonlyMap<string, string>;
  appliedCount: number;
  appliedRouteCount: number;
  errors: string[];
  routeErrors: string[];
  diagnostics: RuntimeLocationWriteDiagnostic[];
  repairDiagnostics: NarratorMapWritebackRepairDiagnostic[];
}

export interface NarratorMapWritebackRepairDiagnostic {
  kind: 'location' | 'route';
  suggestionIndex: number;
  stableId?: string;
  errors: string[];
}

export interface NarratorLocationWritebackPrepareOptions {
  statePatches?: StatePatch[];
}

export function prepareNarratorLocationWriteback(
  state: RuntimeState,
  writeback: NarratorWritebackProtocol | undefined,
  worldBook: WorldBook | undefined,
  options: NarratorLocationWritebackPrepareOptions = {},
): NarratorLocationWritebackPreparation {
  if (!writeback || !worldBook) {
    return {
      state,
      writeback,
      aliasMap: new Map(),
      appliedCount: 0,
      appliedRouteCount: 0,
      errors: [],
      routeErrors: [],
      diagnostics: [],
      repairDiagnostics: [],
    };
  }

  const visitedLocationIds = collectVisitedLocationIds(options.statePatches ?? []);

  const batch = applyLocationWriteSuggestionsSequentially(
    worldBook,
    state,
    writeback.locationWriteSuggestions ?? [],
    visitedLocationIds,
  );
  const canonicalWriteback = remapNarratorWritebackLocationReferences(
    { ...writeback, locationWriteSuggestions: batch.suggestions },
    batch.aliasMap,
  );
  let preparedState = batch.state;
  let appliedRouteCount = 0;
  const routeErrors: string[] = [];
  const routeRepairDiagnostics: NarratorMapWritebackRepairDiagnostic[] = [];
  const silentlySkippedLocationIds = new Set(
    canonicalWriteback.locationWriteSuggestions
      .filter((suggestion) => (
        suggestion.permanence !== 'permanent'
        && !visitedLocationIds.has(suggestion.locationId?.trim() ?? '')
      ))
      .map((suggestion) => suggestion.locationId?.trim() ?? '')
      .filter(Boolean),
  );
  for (let index = 0; index < canonicalWriteback.routeWriteSuggestions.length; index += 1) {
    const suggestion = canonicalWriteback.routeWriteSuggestions[index];
    if (
      silentlySkippedLocationIds.has(suggestion.fromPlaceId)
      || silentlySkippedLocationIds.has(suggestion.toPlaceId)
    ) {
      continue;
    }
    const result = applyRouteWriteSuggestion(
      worldBook,
      preparedState,
      suggestion,
    );
    preparedState = result.state;
    if (result.applied) appliedRouteCount += 1;
    else {
      routeErrors.push(...result.errors.map((error) => `路线 #${index + 1} ${error}`));
      if (result.errors.length > 0) {
        routeRepairDiagnostics.push({
          kind: 'route',
          suggestionIndex: index,
          stableId: suggestion.routeId?.trim() || undefined,
          errors: [...result.errors],
        });
      }
    }
  }

  return {
    state: preparedState,
    writeback: canonicalWriteback,
    aliasMap: batch.aliasMap,
    appliedCount: batch.appliedCount,
    appliedRouteCount,
    errors: batch.errors,
    routeErrors,
    diagnostics: batch.diagnostics,
    repairDiagnostics: [
      ...batch.rejections.map((rejection) => ({
        kind: 'location' as const,
        suggestionIndex: rejection.suggestionIndex,
        stableId: rejection.stableId,
        errors: [...rejection.errors],
      })),
      ...routeRepairDiagnostics,
    ],
  };
}

function collectVisitedLocationIds(patches: StatePatch[]): Set<string> {
  const ids = new Set<string>();
  for (const sourcePatch of patches) {
    const patch = normalizeLuanShiCommandPatch(sourcePatch);
    if (patch.type !== 'locationChange') continue;
    for (const field of ['toLocationId', 'toSceneId'] as const) {
      const value = patch.payload?.[field];
      if (typeof value === 'string' && value.trim()) ids.add(value.trim());
    }
  }
  return ids;
}

export function ensureGeneratedStoryLocationReturnRoute(
  originState: RuntimeState,
  preparation: NarratorLocationWritebackPreparation,
  patches: StatePatch[],
  worldBook: WorldBook,
): NarratorLocationWritebackPreparation {
  if (!preparation.writeback || preparation.appliedCount === 0) return preparation;

  const canonicalPatches = canonicalizeLocationChangeSceneTargets(
    worldBook,
    preparation.state,
    patches,
  );
  const movement = [...canonicalPatches].reverse().find((patch) => patch.type === 'locationChange');
  const destinationPlaceId = movement && typeof movement.payload?.toLocationId === 'string'
    ? movement.payload.toLocationId.trim()
    : '';
  const originPlaceId = buildCurrentMapProjection(worldBook, originState).currentPlaceId;
  if (!originPlaceId || !destinationPlaceId || originPlaceId === destinationPlaceId) return preparation;

  const originalIndex = buildRuntimeMapIndex(worldBook, originState);
  const preparedIndex = buildRuntimeMapIndex(worldBook, preparation.state);
  const originPlace = preparedIndex.nodeById[originPlaceId];
  const destinationPlace = preparedIndex.nodeById[destinationPlaceId];
  if (!isStandableMapNode(originPlace) || !isStandableMapNode(destinationPlace)) return preparation;
  if (originalIndex.nodeById[destinationPlaceId]) return preparation;

  const hasRoute = buildRuntimeRouteEdges(worldBook, preparation.state).some((route) => (
    (route.fromPlaceId === originPlaceId && route.toPlaceId === destinationPlaceId)
    || (route.fromPlaceId === destinationPlaceId && route.toPlaceId === originPlaceId)
  ));
  if (hasRoute) return preparation;

  const sortedEndpointIds = [originPlaceId, destinationPlaceId].sort();
  const routeSuggestion = {
    routeId: `route_story:${sortedEndpointIds[0]}__${sortedEndpointIds[1]}`,
    fromPlaceId: originPlaceId,
    toPlaceId: destinationPlaceId,
    name: `${originPlace.name}—${destinationPlace.name}`,
    routeKind: '剧情行程',
    status: '可通行',
    source: 'system' as const,
    knownLevel: '亲历' as const,
    notes: '由本回合实际移动确认，用于离开后返回该剧情地点。',
  };
  const routeResult = applyRouteWriteSuggestion(worldBook, preparation.state, routeSuggestion);
  if (!routeResult.applied) {
    return {
      ...preparation,
      routeErrors: [
        ...preparation.routeErrors,
        ...routeResult.errors.map((error) => `自动返程路线 ${error}`),
      ],
    };
  }

  return {
    ...preparation,
    state: routeResult.state,
    writeback: {
      ...preparation.writeback,
      routeWriteSuggestions: [
        ...(preparation.writeback.routeWriteSuggestions ?? []),
        routeSuggestion,
      ],
    },
    appliedRouteCount: preparation.appliedRouteCount + 1,
  };
}

export function dropRejectedLocationDependencies(
  writeback: NarratorWritebackProtocol | undefined,
  rejectedLocationIds: ReadonlySet<string>,
): NarratorWritebackProtocol | undefined {
  if (!writeback || rejectedLocationIds.size === 0) return writeback;
  const rejected = new Set(
    [...rejectedLocationIds].map((id) => id.trim()).filter(Boolean),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const suggestion of writeback.locationWriteSuggestions ?? []) {
      const id = suggestion.locationId?.trim() ?? '';
      const parentId = suggestion.parentId?.trim() ?? '';
      if (id && parentId && rejected.has(parentId) && !rejected.has(id)) {
        rejected.add(id);
        changed = true;
      }
    }
  }
  return {
    ...writeback,
    locationWriteSuggestions: (writeback.locationWriteSuggestions ?? [])
      .filter((suggestion) => !rejected.has(suggestion.locationId?.trim() ?? '')),
    routeWriteSuggestions: (writeback.routeWriteSuggestions ?? [])
      .filter((suggestion) => (
        !rejected.has(suggestion.fromPlaceId.trim())
        && !rejected.has(suggestion.toPlaceId.trim())
      )),
  };
}

export function remapNarratorStatePatchLocationReferences(
  patches: StatePatch[],
  aliasMap: ReadonlyMap<string, string>,
): StatePatch[] {
  if (aliasMap.size === 0) return patches;
  return patches.map((sourcePatch) => {
    const patch = normalizeLuanShiCommandPatch(sourcePatch);
    if (patch.type === 'locationChange') {
      return remapStatePatchPayload(patch, aliasMap, ['toLocationId', 'toSceneId']);
    }
    if (patch.type === 'actorDiscovered') {
      return remapStatePatchPayload(patch, aliasMap, ['locationId']);
    }
    if (patch.type === 'questAdded') {
      return remapStatePatchPayload(
        patch,
        aliasMap,
        ['targetLocationId'],
        ['relatedLocationIds', 'affectedPlaceIds'],
      );
    }
    if (patch.type === 'questUpdated') {
      return remapStatePatchPayload(
        patch,
        aliasMap,
        [],
        ['relatedLocationIds', 'affectedPlaceIds'],
      );
    }
    if (patch.type === 'rumorAdded') {
      return remapStatePatchPayload(
        patch,
        aliasMap,
        ['relatedRegionId'],
        ['relatedLocationIds', 'affectedPlaceIds'],
      );
    }
    if (patch.type !== 'luanshiCommand') return patch;

    const command = patch.payload.command;
    if (!isRecord(command)) return patch;
    return {
      ...patch,
      payload: {
        ...patch.payload,
        command: remapCommandLocationReferences(command, aliasMap),
      },
    };
  });
}

export function applyNarratorWriteback(
  state: RuntimeState,
  writeback?: NarratorWritebackProtocol,
  worldBook?: WorldBook,
  options: NarratorWritebackApplyOptions = {},
): NarratorWritebackApplication {
  if (!writeback) {
    return {
      state,
      appliedSummaries: [],
      ignoredSummaries: [],
      diagnostics: [],
    };
  }

  let nextState: RuntimeState = ensureLuanShiState(JSON.parse(JSON.stringify(state)));
  const appliedSummaries: string[] = [];
  const ignoredSummaries: string[] = [];

  const preparedByCaller = options.preparedLocationWriteback;
  const locationPreparation = preparedByCaller
    ?? prepareNarratorLocationWriteback(nextState, writeback, worldBook);
  if (!preparedByCaller) nextState = locationPreparation.state;
  writeback = locationPreparation.writeback ?? writeback;
  if (locationPreparation.appliedCount > 0) {
    appliedSummaries.push(`地图地点x${locationPreparation.appliedCount}`);
  }
  if (locationPreparation.appliedRouteCount > 0) {
    appliedSummaries.push(`路线x${locationPreparation.appliedRouteCount}`);
  }
  ignoredSummaries.push(...locationPreparation.errors.map((error) => {
    const diagnostic = locationPreparation.diagnostics.find((candidate) => error.includes(candidate.message));
    if (diagnostic?.code === 'location-canonical-ambiguous') {
      return '地点写回：地点身份存在歧义，相关建议未写入。';
    }
    if (diagnostic?.code === 'location-canonical-scope-conflict') {
      return '地点写回：地点身份范围冲突，相关建议未写入。';
    }
    return `地点写回：${error}`;
  }));
  ignoredSummaries.push(...locationPreparation.routeErrors.map((error) => `路线写回：${error}`));

  const profileApplication = applyNpcProfileSuggestionsSequentially(
    nextState,
    writeback.npcProfileSuggestions ?? [],
    ignoredSummaries,
    buildTrustedProfilePresenceLocations(nextState, writeback),
  );
  nextState = profileApplication.state;
  writeback = canonicalizeWritebackNpcReferences(nextState, writeback, profileApplication.aliasMap);
  if (profileApplication.appliedNpcProfiles > 0) {
    appliedSummaries.push(`NPC档案x${profileApplication.appliedNpcProfiles}`);
  }
  if (profileApplication.appliedFemaleProfiles > 0) {
    appliedSummaries.push(`女性档案x${profileApplication.appliedFemaleProfiles}`);
  }

  appliedSummaries.push(...applyTurnSummaryArchiveWriteback(nextState, writeback));

  const protagonistProfileApplied = applyProtagonistProfileWriteback(nextState, writeback, ignoredSummaries, options);
  nextState = protagonistProfileApplied.state;
  appliedSummaries.push(...protagonistProfileApplied.appliedSummaries);

  const protagonistApplied = applyProtagonistMemoryWriteback(nextState, writeback);
  appliedSummaries.push(...protagonistApplied);

  const dynamicApplied = applyDynamicWriteback(nextState, writeback, ignoredSummaries);
  appliedSummaries.push(...dynamicApplied);

  const correspondenceApplication = applyCorrespondenceWriteback(
    nextState,
    options.previousState ?? state,
    writeback.turnSummary,
  );
  nextState = correspondenceApplication.state;
  appliedSummaries.push(...correspondenceApplication.appliedSummaries);
  ignoredSummaries.push(...correspondenceApplication.ignoredSummaries);

  let appliedFactionRecentActions = 0;
  for (const suggestion of writeback.factionRecentActionSuggestions ?? []) {
    const summary = suggestion.summary.trim();
    const factionId = suggestion.factionId.trim();
    const formattedAction = `【${suggestion.knownLevel}】${summary}`;
    const faction = nextState.factions?.find((entry) => entry.factionId === factionId);
    if (faction?.recentActions.includes(formattedAction)) continue;

    const command: LuanShiCommand = {
      action: 'recordFactionRecentAction',
      factionId,
      summary,
      knownLevel: suggestion.knownLevel,
      observedAt: suggestion.observedAt,
      sourceNote: suggestion.sourceNote,
    };
    const result = applyValidatedCommand(nextState, command);
    nextState = result.state;
    if (result.applied) {
      appliedFactionRecentActions += 1;
    } else {
      ignoredSummaries.push(...result.errors.map((error) => `势力近期动作：${error}`));
    }
  }
  if (appliedFactionRecentActions > 0) {
    appliedSummaries.push(`势力近期动作x${appliedFactionRecentActions}`);
  }

  const worldEvent = writeback.worldEventSummary;
  if (worldEvent?.summary?.trim()) {
    const knownNpcIds = new Set((nextState.npcs ?? []).map((npc) => npc.npcId));
    const command: LuanShiCommand = {
      action: 'recordTurnEvent',
      locationId: worldEvent.locationId?.trim() || nextState.currentLocationId,
      summary: worldEvent.summary.trim(),
      presentNpcIds: filterKnownNpcIds(worldEvent.presentNpcIds ?? [], knownNpcIds),
      involvedNpcIds: filterKnownNpcIds(worldEvent.involvedNpcIds, knownNpcIds),
      visibility: parseEventVisibility(worldEvent.visibility),
    };
    const result = applyValidatedCommand(nextState, command);
    nextState = result.state;
    if (result.applied) {
      appliedSummaries.push('世界事件');
    } else {
      ignoredSummaries.push(...result.errors.map((error) => `世界事件：${error}`));
    }
    const chronicleResult = archiveWorldTrend(nextState, worldEvent);
    nextState = chronicleResult.state;
    if (chronicleResult.applied) {
      appliedSummaries.push('天下纪事');
    } else {
      ignoredSummaries.push(`纪事未收录：${chronicleResult.reasonZh}；客观事件仍保留在回合事件账本。`);
    }
  }

  let appliedNpcMemories = 0;
  for (const suggestion of writeback.npcMemorySuggestions ?? []) {
    if (!suggestion.content.trim()) continue;
    if (!suggestion.npcId || !suggestion.npcName) {
      ignoredSummaries.push('NPC记忆：缺少 npcId 或 npcName');
      continue;
    }

    const command: LuanShiCommand = {
      action: 'pushNpcMemory',
      npcId: suggestion.npcId,
      npcName: suggestion.npcName,
      source: suggestion.source as NpcMemorySource,
      eventId: suggestion.eventId,
      value: suggestion.content.trim(),
    };
    const result = applyValidatedCommand(nextState, command);
    nextState = result.state;
    if (result.applied) {
      appliedNpcMemories += 1;
    } else {
      ignoredSummaries.push(...result.errors.map((error) => `NPC记忆：${error}`));
    }
  }

  if (appliedNpcMemories > 0) {
    appliedSummaries.push(`NPC记忆x${appliedNpcMemories}`);
  }

  return {
    state: nextState,
    appliedSummaries,
    ignoredSummaries,
    diagnostics: locationPreparation.diagnostics,
  };
}

function remapNarratorWritebackLocationReferences(
  writeback: NarratorWritebackProtocol,
  aliasMap: ReadonlyMap<string, string>,
): NarratorWritebackProtocol {
  const protagonistMemory = writeback.protagonistMemory?.keyDeed
    ? {
        ...writeback.protagonistMemory,
        keyDeed: {
          ...writeback.protagonistMemory.keyDeed,
          locationId: remapLocationId(writeback.protagonistMemory.keyDeed.locationId, aliasMap),
        },
      }
    : writeback.protagonistMemory;
  return {
    ...writeback,
    protagonistMemory,
    npcProfileSuggestions: writeback.npcProfileSuggestions?.map((profile) => ({
      ...profile,
      locationId: remapLocationId(profile.locationId, aliasMap) ?? profile.locationId,
    })),
    locationWriteSuggestions: writeback.locationWriteSuggestions.map((suggestion) => ({
      ...suggestion,
      locationId: remapLocationId(suggestion.locationId, aliasMap),
      parentId: remapLocationId(suggestion.parentId, aliasMap),
      connectedRegionIds: remapLocationIds(suggestion.connectedRegionIds, aliasMap),
    })),
    routeWriteSuggestions: writeback.routeWriteSuggestions.map((route) => ({
      ...route,
      fromPlaceId: remapLocationId(route.fromPlaceId, aliasMap) ?? route.fromPlaceId,
      toPlaceId: remapLocationId(route.toPlaceId, aliasMap) ?? route.toPlaceId,
    })),
    questChanges: writeback.questChanges.map((quest) => ({
      ...quest,
      relatedLocationIds: remapLocationIds(quest.relatedLocationIds, aliasMap),
      affectedPlaceIds: remapLocationIds(quest.affectedPlaceIds, aliasMap),
    })),
    signalChanges: writeback.signalChanges?.map((signal) => ({
      ...signal,
      relatedLocationIds: remapLocationIds(signal.relatedLocationIds, aliasMap),
      affectedPlaceIds: remapLocationIds(signal.affectedPlaceIds, aliasMap),
    })),
    worldEventUpdates: writeback.worldEventUpdates?.map((event) => ({
      ...event,
      locationId: remapLocationId(event.locationId, aliasMap),
      affectedPlaceIds: remapLocationIds(event.affectedPlaceIds, aliasMap),
    })),
    worldEventSummary: writeback.worldEventSummary
      ? {
          ...writeback.worldEventSummary,
          locationId: remapLocationId(writeback.worldEventSummary.locationId, aliasMap),
          affectedPlaceIds: remapLocationIds(writeback.worldEventSummary.affectedPlaceIds, aliasMap),
        }
      : writeback.worldEventSummary,
  };
}

function remapStatePatchPayload(
  patch: StatePatch,
  aliasMap: ReadonlyMap<string, string>,
  singleKeys: string[],
  listKeys: string[] = [],
): StatePatch {
  const payload = { ...patch.payload };
  for (const key of singleKeys) {
    if (typeof payload[key] === 'string') payload[key] = aliasMap.get(payload[key]) ?? payload[key];
  }
  for (const key of listKeys) {
    if (Array.isArray(payload[key])) {
      payload[key] = [...new Set(payload[key].map((id) => typeof id === 'string' ? aliasMap.get(id) ?? id : id))];
    }
  }
  return { ...patch, payload };
}

function remapCommandLocationReferences(
  command: Record<string, unknown>,
  aliasMap: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const remapped = remapRecordLocationReferences(command, aliasMap);
  if (isRecord(remapped.activity)) {
    remapped.activity = remapRecordLocationReferences(remapped.activity, aliasMap);
  }
  return remapped;
}

function remapRecordLocationReferences(
  value: Record<string, unknown>,
  aliasMap: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const remapped = { ...value };
  for (const key of ['locationId', 'lastKnownLocationId', 'destinationLocationId']) {
    if (typeof remapped[key] === 'string') {
      remapped[key] = aliasMap.get(remapped[key]) ?? remapped[key];
    }
  }
  for (const key of ['relatedLocationIds', 'relatedPlaceIds', 'affectedPlaceIds']) {
    if (Array.isArray(remapped[key])) {
      remapped[key] = [...new Set(remapped[key].map((id) => (
        typeof id === 'string' ? aliasMap.get(id) ?? id : id
      )))];
    }
  }
  return remapped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

export function appendNarratorWritebackSummary(
  state: RuntimeState,
  application: Pick<NarratorWritebackApplication, 'appliedSummaries' | 'ignoredSummaries'>,
): void {
  const latestLog = state.turnLog[state.turnLog.length - 1];
  if (!latestLog) return;

  const additions: string[] = [];
  if (application.appliedSummaries.length > 0) {
    additions.push(`writeback：${application.appliedSummaries.join('、')}`);
  }
  if (application.ignoredSummaries.length > 0) {
    additions.push(`已忽略无效写回建议：${application.ignoredSummaries.join('；')}`);
  }
  if (additions.length === 0) return;

  latestLog.statePatchSummary = [
    latestLog.statePatchSummary,
    ...additions,
  ].join('；');
}

function applyTurnSummaryArchiveWriteback(
  state: RuntimeState,
  writeback: NarratorWritebackProtocol,
): string[] {
  const summary = writeback.turnSummary;
  if (!summary?.brief?.trim() || !state.memoryArchive) return [];

  const latestLog = state.turnLog[state.turnLog.length - 1];
  const turnNumber = latestLog?.turnNumber ?? state.turnLog.length;
  const entry = {
    id: uuidv4(),
    turnNumber,
    createdAt: state.currentDate,
    playerInput: latestLog?.playerInput,
    brief: summary.brief.trim(),
    playerActionSummary: summary.playerActionSummary?.trim() || undefined,
    visibleConsequence: summary.visibleConsequence?.trim() || undefined,
    importance: parseMemoryImportance(summary.memoryImportance),
  };

  const existingIndex = state.memoryArchive.recentTurnSummaries.findIndex(
    (memory) => memory.turnNumber === turnNumber,
  );
  if (existingIndex >= 0) {
    state.memoryArchive.recentTurnSummaries = state.memoryArchive.recentTurnSummaries.map(
      (memory, index) => (index === existingIndex ? { ...entry, id: memory.id } : memory),
    );
  } else {
    const archiveStorageLimit = getRecentTurnArchiveStorageLimit(state.memoryArchive.settings);
    state.memoryArchive.recentTurnSummaries = [
      ...state.memoryArchive.recentTurnSummaries,
      entry,
    ].slice(-archiveStorageLimit);
  }

  return ['近期剧情记忆'];
}

function getRecentTurnArchiveStorageLimit(settings: {
  recentTurnLimit: number;
  recentTurnCompressThreshold: number;
  recentTurnKeepAfterCompress: number;
}): number {
  return Math.max(
    settings.recentTurnLimit,
    settings.recentTurnCompressThreshold + settings.recentTurnKeepAfterCompress + 1,
  );
}

function applyProtagonistProfileWriteback(
  state: RuntimeState,
  writeback: NarratorWritebackProtocol,
  ignoredSummaries: string[],
  options: NarratorWritebackApplyOptions,
): { state: RuntimeState; appliedSummaries: string[] } {
  const profile = writeback.protagonistProfile;
  if (!profile || Object.keys(profile).length === 0) {
    return { state, appliedSummaries: [] };
  }

  const profileToApply = options.allowProtagonistProfileOverwrite
    ? profile
    : pickMissingProtagonistProfileFields(state, profile);
  if (Object.keys(profileToApply).length === 0) {
    ignoredSummaries.push('主角档案：普通回合忽略已有稳定档案字段的 protagonistProfile 改写');
    return { state, appliedSummaries: [] };
  }

  const command: LuanShiCommand = {
    action: 'updateCharacterIdentity',
    characterId: 'player',
    characterType: 'player',
    characterName: state.player.name,
    ...profileToApply,
  };
  const result = applyValidatedCommand(state, command);
  if (!result.applied) {
    ignoredSummaries.push(...result.errors.map((error) => `主角档案：${error}`));
    return { state: result.state, appliedSummaries: [] };
  }

  const identitySummary = typeof profileToApply.identitySummary === 'string' ? profileToApply.identitySummary.trim() : '';
  if (!identitySummary) {
    return { state: result.state, appliedSummaries: ['主角档案'] };
  }

  return {
    state: {
      ...result.state,
      player: {
        ...result.state.player,
        playerMemory: {
          summary: identitySummary,
          keyDeeds: [...(result.state.player.playerMemory?.keyDeeds ?? [])],
          recentTurns: [...(result.state.player.playerMemory?.recentTurns ?? [])],
        },
      },
    },
    appliedSummaries: ['主角档案'],
  };
}

function pickMissingProtagonistProfileFields(
  state: RuntimeState,
  profile: NonNullable<NarratorWritebackProtocol['protagonistProfile']>,
): NonNullable<NarratorWritebackProtocol['protagonistProfile']> {
  const player = state.player as unknown as Record<string, unknown>;
  const nextProfile: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(profile)) {
    if (value === undefined || value === null) continue;
    if (isMissingProtagonistProfileValue(player[field])) {
      nextProfile[field] = Array.isArray(value) ? [...value] : value;
    }
  }

  return nextProfile as NonNullable<NarratorWritebackProtocol['protagonistProfile']>;
}

function isMissingProtagonistProfileValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function applyProtagonistMemoryWriteback(
  state: RuntimeState,
  writeback: NarratorWritebackProtocol,
): string[] {
  const memory = writeback.protagonistMemory;
  if (!memory) return [];

  const applied: string[] = [];
  state.player.playerMemory = {
    summary: state.player.playerMemory?.summary ?? state.player.summary,
    keyDeeds: [...(state.player.playerMemory?.keyDeeds ?? [])],
    recentTurns: [...(state.player.playerMemory?.recentTurns ?? [])],
  };

  const recentTurnSummary = memory.recentTurnSummary?.trim();
  if (recentTurnSummary) {
    const duplicateRecentTurn = state.player.playerMemory.recentTurns.some(
      (item) => normalizeMemoryText(item) === normalizeMemoryText(recentTurnSummary),
    );
    if (!duplicateRecentTurn) {
      state.player.playerMemory.recentTurns = [
        ...state.player.playerMemory.recentTurns,
        recentTurnSummary,
      ].slice(-recentTurnMemoryLimit);
      applied.push('主角近期记忆');
    }
  }

  const keyDeed = memory.keyDeed;
  if (keyDeed?.summary?.trim()) {
    const nextKeyDeed = {
      id: buildPlayerKeyDeedId(
        state.currentDate,
        keyDeed.locationId?.trim() || state.currentLocationId,
        keyDeed.summary.trim(),
        keyDeed.impact?.trim(),
      ),
      date: state.currentDate,
      locationId: keyDeed.locationId?.trim() || state.currentLocationId,
      summary: keyDeed.summary.trim(),
      impact: keyDeed.impact?.trim() || undefined,
    };
    const duplicateKeyDeed = state.player.playerMemory.keyDeeds.some((deed) => (
      deed.date === nextKeyDeed.date
      && deed.locationId === nextKeyDeed.locationId
      && normalizeMemoryText(deed.summary) === normalizeMemoryText(nextKeyDeed.summary)
      && normalizeMemoryText(deed.impact ?? '') === normalizeMemoryText(nextKeyDeed.impact ?? '')
    ));
    if (!duplicateKeyDeed) {
      state.player.playerMemory.keyDeeds.push(nextKeyDeed);
      applied.push('主角关键事迹');
    }
  }

  return applied;
}

function applyDynamicWriteback(
  state: RuntimeState,
  writeback: NarratorWritebackProtocol,
  ignoredSummaries: string[],
): string[] {
  const applied: string[] = [];
  const questResult = applyQuestChanges(state, writeback.questChanges ?? [], ignoredSummaries);
  const appliedSignals = applySignalChanges(state, writeback.signalChanges ?? [], ignoredSummaries);
  const appliedPlots = applyPlotPlanSuggestions(state, writeback.plotPlanSuggestions ?? [], ignoredSummaries);
  const appliedWorldEventUpdates = applyWorldEventUpdates(state, writeback.worldEventUpdates ?? [], ignoredSummaries);
  if (appliedWorldEventUpdates > 0) applied.push(`纪事更新x${appliedWorldEventUpdates}`);

  if (questResult.applied > 0) applied.push(`当前事项x${questResult.applied}`);
  applied.push(...questResult.experienceSummaries);
  if (appliedSignals > 0) applied.push(`风声线索x${appliedSignals}`);
  if (appliedPlots > 0) applied.push(`剧情计划x${appliedPlots}`);
  return applied;
}

function applyQuestChanges(
  state: RuntimeState,
  changes: NarratorQuestChangeSuggestion[],
  ignoredSummaries: string[],
): { applied: number; experienceSummaries: string[] } {
  let applied = 0;
  const experienceSummaries: string[] = [];
  state.activeQuests ??= [];

  for (const change of changes) {
    const summary = change.summary?.trim();

    if (change.action === 'add') {
      if (change.experienceReward !== undefined) {
        ignoredSummaries.push('当前事项 experienceReward：新增事项不得同时发放完成阅历。');
      }
      if (!summary) continue;
      const questId = change.questId?.trim() || uuidv4();
      const existing = findQuestForChange(state.activeQuests, change, questId);
      if (existing) {
        applyQuestUpdateFields(existing, change, state.currentDate);
        existing.status = existing.status ?? 'active';
      } else {
        state.activeQuests.push(buildQuestFromChange(questId, change, state.currentDate));
      }
      applied += 1;
      continue;
    }

    const questId = change.questId?.trim();
    const existing = findQuestForChange(state.activeQuests, change, questId);
    if (!existing) {
      ignoredSummaries.push(`当前事项：找不到 questId=${questId ?? '(missing)'}`);
      continue;
    }

    const previousStatus = existing.status;
    const experienceRewardError = validateQuestExperienceReward(change, existing);
    if (experienceRewardError) {
      ignoredSummaries.push(`当前事项 experienceReward：${experienceRewardError}`);
    }

    applyQuestUpdateFields(existing, change, state.currentDate);
    if (change.action === 'complete') {
      existing.status = 'completed';
      const experienceReward = change.experienceReward === undefined
        ? questCompletionExperienceReward(state.player.level ?? 1, existing.severity)
        : change.experienceReward;
      if (
        !experienceRewardError
        && previousStatus !== 'completed'
        && previousStatus !== 'archived'
        && existing.completionExperienceAwarded === undefined
        && (
          change.experienceReward === undefined
          || isValidQuestCompletionExperienceReward(experienceReward)
        )
      ) {
        const experienceResult = applyPlayerExperience(state.player, experienceReward, existing.title);
        state.player = experienceResult.player;
        existing.completionExperienceAwarded = experienceReward;
        experienceSummaries.push(experienceResult.summary);
      }
    }
    if (change.action === 'fail') existing.status = 'failed';
    if (change.action === 'invalidate') existing.status = 'invalidated';
    if (change.action === 'archive') {
      existing.status = 'archived';
      existing.outcomeSummary = change.outcomeSummary?.trim() || summary || existing.outcomeSummary;
      existing.archiveReason = change.archiveReason?.trim() || undefined;
    }
    synchronizeCurrentMatterLifecycle(existing, state.currentDate);
    synchronizeNpcBackgroundActivitiesWithCurrentMatters(
      state.npcs,
      state.activeQuests,
      state.currentDate,
    );
    applied += 1;
  }

  return { applied, experienceSummaries };
}

function validateQuestExperienceReward(
  change: NarratorQuestChangeSuggestion,
  quest: Quest,
): string | undefined {
  if (change.experienceReward === undefined) return undefined;
  if (change.action !== 'complete') {
    return '仅 action=complete 的首次完成写回可提供奖励。';
  }
  if (!isValidQuestCompletionExperienceReward(change.experienceReward)) {
    return `必须是 1-${MAX_QUEST_COMPLETION_EXPERIENCE_REWARD} 的 finite integer。`;
  }
  if (
    quest.status === 'completed'
    || quest.status === 'archived'
    || quest.completionExperienceAwarded !== undefined
  ) {
    return '已完成或已归档事项不得重复发奖。';
  }
  return undefined;
}

function findQuestForChange(
  quests: Quest[],
  change: NarratorQuestChangeSuggestion,
  questId: string | undefined,
): Quest | undefined {
  const exact = questId ? quests.find((quest) => quest.id === questId) : undefined;
  if (exact) return exact;

  const threadId = change.threadId?.trim();
  if (threadId) {
    const sameThread = quests.find((quest) => {
      if (quest.threadId !== threadId) return false;
      return isReusableQuestForWriteback(quest);
    });
    if (sameThread) return sameThread;
  }

  const titleKey = normalizeQuestTitle(change.title);
  if (!titleKey) return undefined;

  return quests.find((quest) => {
    if (!isReusableQuestForWriteback(quest)) return false;
    return normalizeQuestTitle(quest.title) === titleKey;
  });
}

function buildQuestFromChange(
  questId: string,
  change: NarratorQuestChangeSuggestion,
  currentDate: string,
): Quest {
  const summary = change.summary?.trim() ?? '';
  return {
    id: questId,
    title: change.title?.trim() || summary.slice(0, 30) || 'Current matter',
    description: summary,
    status: 'active',
    source: change.source?.trim() || undefined,
    currentStep: change.currentStep?.trim() || undefined,
    stakes: change.stakes?.trim() || undefined,
    deadlineAt: change.deadlineAt?.trim() || undefined,
    priority: change.priority,
    relatedNpcIds: cleanStringArray(change.relatedNpcIds),
    relatedLocationIds: cleanStringArray(change.relatedLocationIds),
    relatedFactionIds: cleanStringArray(change.relatedFactionIds),
    outcomeSummary: change.outcomeSummary?.trim() || undefined,
    consequenceTags: cleanStringArray(change.consequenceTags),
    affectedNpcIds: cleanStringArray(change.affectedNpcIds),
    affectedFactionIds: cleanStringArray(change.affectedFactionIds),
    affectedPlaceIds: cleanStringArray(change.affectedPlaceIds),
    affectedForceIds: cleanStringArray(change.affectedForceIds),
    affectedHoldingIds: cleanStringArray(change.affectedHoldingIds),
    followUpHooks: cleanStringArray(change.followUpHooks),
    severity: change.severity,
    threadId: change.threadId?.trim() || undefined,
    createdAt: currentDate,
    updatedAt: currentDate,
  };
}

function isReusableQuestForWriteback(quest: Quest): boolean {
  return quest.status === 'active' || quest.status === 'invalidated';
}

function normalizeQuestTitle(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[，。！？、：；,.!?:;"'“”‘’（）()[\]{}<>《》\-—_]/g, '')
    .toLowerCase();
}

function applyQuestUpdateFields(
  quest: Quest,
  change: NarratorQuestChangeSuggestion,
  currentDate: string,
): void {
  const summary = change.summary?.trim() ?? '';
  if (change.title?.trim()) quest.title = change.title.trim();
  if (summary && (change.action === 'update' || change.action === 'add')) quest.description = summary;
  if (
    change.action === 'complete'
    || change.action === 'fail'
    || change.action === 'invalidate'
    || change.action === 'archive'
  ) {
    const outcomeSummary = change.outcomeSummary?.trim() || summary;
    if (outcomeSummary) quest.outcomeSummary = outcomeSummary;
  } else if (change.outcomeSummary?.trim()) {
    quest.outcomeSummary = change.outcomeSummary.trim();
  }
  if (change.archiveReason?.trim()) quest.archiveReason = change.archiveReason.trim();
  assignQuestString(quest, 'source', change.source);
  assignQuestString(quest, 'currentStep', change.currentStep);
  assignQuestString(quest, 'stakes', change.stakes);
  assignQuestString(quest, 'deadlineAt', change.deadlineAt);
  if (change.priority) quest.priority = change.priority;
  if (change.severity) quest.severity = change.severity;
  assignQuestString(quest, 'threadId', change.threadId);
  assignQuestStringArray(quest, 'relatedNpcIds', change.relatedNpcIds);
  assignQuestStringArray(quest, 'relatedLocationIds', change.relatedLocationIds);
  assignQuestStringArray(quest, 'relatedFactionIds', change.relatedFactionIds);
  assignQuestStringArray(quest, 'consequenceTags', change.consequenceTags);
  assignQuestStringArray(quest, 'affectedNpcIds', change.affectedNpcIds);
  assignQuestStringArray(quest, 'affectedFactionIds', change.affectedFactionIds);
  assignQuestStringArray(quest, 'affectedPlaceIds', change.affectedPlaceIds);
  assignQuestStringArray(quest, 'affectedForceIds', change.affectedForceIds);
  assignQuestStringArray(quest, 'affectedHoldingIds', change.affectedHoldingIds);
  assignQuestStringArray(quest, 'followUpHooks', change.followUpHooks);
  quest.updatedAt = currentDate;
}

function applySignalChanges(
  state: RuntimeState,
  changes: NarratorSignalChangeSuggestion[],
  ignoredSummaries: string[],
): number {
  let applied = 0;
  state.knownRumors ??= [];

  for (const change of mergeSignalChangeSuggestions([], changes)) {
    const content = change.content?.trim();
    if (change.action === 'add' && !content) continue;

    const rumorId = change.rumorId?.trim() || (change.action === 'add' ? uuidv4() : '');
    const existing = findSignalForChange(state.knownRumors, change, rumorId);
    if (change.action !== 'add' && !existing) {
      ignoredSummaries.push(`signalChange missing rumorId=${rumorId || '(missing)'}`);
      continue;
    }

    const rumor = existing ?? buildSignalFromChange(rumorId, change, state.currentDate);
    applySignalUpdateFields(rumor, change, state.currentDate);
    if (!existing) {
      state.knownRumors.push(rumor);
    }
    for (const ref of rumor.npcAwarenessRefs ?? []) {
      upsertNpcAwarenessFromReference(state, ref, 'rumor', rumor.id);
    }
    applied += 1;
  }

  return applied;
}

function findSignalForChange(
  rumors: Rumor[],
  change: NarratorSignalChangeSuggestion,
  rumorId: string | undefined,
): Rumor | undefined {
  const exact = rumorId ? rumors.find((item) => item.id === rumorId) : undefined;
  if (exact) return exact;

  const threadId = change.threadId?.trim();
  if (threadId) {
    const sameThread = rumors.find((rumor) => {
      if (rumor.threadId !== threadId) return false;
      return rumor.status === undefined
        || rumor.status === 'open'
        || rumor.status === 'investigating'
        || rumor.status === 'verified';
    });
    if (sameThread) return sameThread;
  }

  return change.action === 'add' ? findReusableSignalBySemantic(rumors, change) : undefined;
}

function buildSignalFromChange(
  rumorId: string,
  change: NarratorSignalChangeSuggestion,
  currentDate: string,
): Rumor {
  const status = resolveSignalStatus(change);
  return {
    id: rumorId,
    title: change.title?.trim() || undefined,
    content: change.content?.trim() || '',
    source: change.source?.trim() || 'writeback',
    status,
    signalType: change.signalType,
    confidence: change.confidence,
    potentialOutcomeSummary: change.potentialOutcomeSummary?.trim() || undefined,
    consequenceTags: cleanStringArray(change.consequenceTags),
    affectedNpcIds: cleanStringArray(change.affectedNpcIds),
    affectedFactionIds: cleanStringArray(change.affectedFactionIds),
    affectedPlaceIds: cleanStringArray(change.affectedPlaceIds),
    affectedForceIds: cleanStringArray(change.affectedForceIds),
    affectedHoldingIds: cleanStringArray(change.affectedHoldingIds),
    followUpHooks: cleanStringArray(change.followUpHooks),
    severity: change.severity,
    relatedLocationIds: cleanStringArray(change.relatedLocationIds),
    npcAwarenessRefs: cleanNpcAwarenessRefs(change.npcAwarenessRefs),
    threadId: change.threadId?.trim() || undefined,
    expiresAt: change.expiresAt?.trim() || undefined,
    archiveReason: change.archiveReason?.trim() || undefined,
    convertedToQuestIds: cleanStringArray(change.convertedToQuestIds),
    convertedToWorldTrendIds: cleanStringArray(change.convertedToWorldTrendIds),
    verified: status === 'verified',
    createdAt: currentDate,
  };
}

function applySignalUpdateFields(
  rumor: Rumor,
  change: NarratorSignalChangeSuggestion,
  currentDate: string,
): void {
  const status = resolveSignalStatus(change, rumor);
  const content = change.content?.trim();
  if (change.title?.trim()) rumor.title = change.title.trim();
  if (content) rumor.content = content;
  if (change.source?.trim()) rumor.source = change.source.trim();
  if (status) rumor.status = status;
  if (change.signalType) rumor.signalType = change.signalType;
  if (change.confidence) rumor.confidence = change.confidence;
  if (change.severity) rumor.severity = change.severity;
  assignSignalString(rumor, 'potentialOutcomeSummary', change.potentialOutcomeSummary);
  assignSignalString(rumor, 'threadId', change.threadId);
  assignSignalString(rumor, 'expiresAt', change.expiresAt);
  assignSignalString(rumor, 'archiveReason', change.archiveReason);
  assignSignalStringArray(rumor, 'consequenceTags', change.consequenceTags);
  assignSignalStringArray(rumor, 'affectedNpcIds', change.affectedNpcIds);
  assignSignalStringArray(rumor, 'affectedFactionIds', change.affectedFactionIds);
  assignSignalStringArray(rumor, 'affectedPlaceIds', change.affectedPlaceIds);
  assignSignalStringArray(rumor, 'affectedForceIds', change.affectedForceIds);
  assignSignalStringArray(rumor, 'affectedHoldingIds', change.affectedHoldingIds);
  assignSignalStringArray(rumor, 'followUpHooks', change.followUpHooks);
  assignSignalStringArray(rumor, 'relatedLocationIds', change.relatedLocationIds);
  assignSignalStringArray(rumor, 'convertedToQuestIds', change.convertedToQuestIds);
  assignSignalStringArray(rumor, 'convertedToWorldTrendIds', change.convertedToWorldTrendIds);
  const npcAwarenessRefs = cleanNpcAwarenessRefs(change.npcAwarenessRefs);
  if (npcAwarenessRefs) rumor.npcAwarenessRefs = npcAwarenessRefs;
  rumor.verified = status === 'verified' ? true : status === 'false' ? false : rumor.verified;
  if (status === 'archived') {
    rumor.archivedAt = currentDate;
  }
}

function resolveSignalStatus(
  change: NarratorSignalChangeSuggestion,
  existing?: Rumor,
): Rumor['status'] {
  if (change.status) return change.status;
  if (change.action === 'verify') return 'verified';
  if (change.action === 'markFalse') return 'false';
  if (change.action === 'expire') return 'expired';
  if (change.action === 'convert') return 'converted';
  if (change.action === 'archive') return 'archived';
  return existing?.status ?? 'open';
}

function applyPlotPlanSuggestions(
  state: RuntimeState,
  suggestions: NarratorPlotPlanSuggestion[],
  ignoredSummaries: string[],
): number {
  let applied = 0;
  state.plotPlan ??= [];

  for (const suggestion of suggestions) {
    const summary = suggestion.summary?.trim();
    if (!summary) continue;
    const plotId = suggestion.plotId?.trim() || uuidv4();
    const existing = state.plotPlan.find((plot) => plot.plotId === plotId);

    if (!existing && (suggestion.action === 'complete' || suggestion.action === 'discard')) {
      ignoredSummaries.push(`剧情计划：找不到 plotId=${plotId}`);
      continue;
    }

    const nextEntry: PlotPlanEntry = {
      plotId,
      title: suggestion.title?.trim() || existing?.title || summary.slice(0, 30) || 'Plot plan',
      horizon: suggestion.horizon ?? existing?.horizon ?? ('近期' as PlotPlanEntry['horizon']),
      status: resolvePlotPlanStatus(suggestion, existing),
      description: summary,
      priority: suggestion.priority ?? existing?.priority ?? ('中' as PlotPlanEntry['priority']),
      notBeforeAt: suggestion.notBeforeAt?.trim() || existing?.notBeforeAt,
      lastAdvancedAt: suggestion.lastAdvancedAt?.trim() || existing?.lastAdvancedAt,
    };

    state.plotPlan = [
      ...state.plotPlan.filter((plot) => plot.plotId !== plotId),
      nextEntry,
    ];
    applied += 1;
  }

  return applied;
}

function resolvePlotPlanStatus(
  suggestion: NarratorPlotPlanSuggestion,
  existing?: PlotPlanEntry,
): PlotPlanEntry['status'] {
  if (suggestion.action === 'complete') return '已完成' as PlotPlanEntry['status'];
  if (suggestion.action === 'discard') return '废弃' as PlotPlanEntry['status'];
  return suggestion.status ?? existing?.status ?? ('进行中' as PlotPlanEntry['status']);
}

type QuestStringField = 'source' | 'currentStep' | 'stakes' | 'deadlineAt' | 'threadId';

type QuestStringArrayField =
  | 'relatedNpcIds'
  | 'relatedLocationIds'
  | 'relatedFactionIds'
  | 'consequenceTags'
  | 'affectedNpcIds'
  | 'affectedFactionIds'
  | 'affectedPlaceIds'
  | 'affectedForceIds'
  | 'affectedHoldingIds'
  | 'followUpHooks';

type SignalStringField = 'potentialOutcomeSummary' | 'threadId' | 'expiresAt' | 'archiveReason';

type SignalStringArrayField =
  | 'consequenceTags'
  | 'affectedNpcIds'
  | 'affectedFactionIds'
  | 'affectedPlaceIds'
  | 'affectedForceIds'
  | 'affectedHoldingIds'
  | 'followUpHooks'
  | 'relatedLocationIds'
  | 'convertedToQuestIds'
  | 'convertedToWorldTrendIds';

function assignQuestString(
  target: Quest,
  key: QuestStringField,
  value: string | undefined,
): void {
  const cleaned = value?.trim();
  if (cleaned) {
    target[key] = cleaned;
  }
}

function assignQuestStringArray(
  target: Quest,
  key: QuestStringArrayField,
  value: string[] | undefined,
): void {
  const cleaned = cleanStringArray(value);
  if (cleaned) {
    target[key] = cleaned;
  }
}

function assignSignalString(
  target: Rumor,
  key: SignalStringField,
  value: string | undefined,
): void {
  const cleaned = value?.trim();
  if (cleaned) {
    target[key] = cleaned;
  }
}

function assignSignalStringArray(
  target: Rumor,
  key: SignalStringArrayField,
  value: string[] | undefined,
): void {
  const cleaned = cleanStringArray(value);
  if (cleaned) {
    target[key] = cleaned;
  }
}

function applyWorldEventUpdates(
  state: RuntimeState,
  updates: NarratorWorldEventUpdate[],
  ignoredSummaries: string[],
): number {
  let applied = 0;
  state.worldTrends ??= [];

  for (const update of updates) {
    const eventId = update.eventId?.trim();
    if (!eventId) continue;
    const existing = state.worldTrends.find((trend) => trend.trendId === eventId);
    if (!existing) {
      ignoredSummaries.push(`worldEventUpdate missing eventId=${eventId}`);
      continue;
    }
    const candidate: WorldTrendEntry = { ...existing };
    applyWorldEventUpdateFields(candidate, update, state.currentDate);
    closeChronicleWhenOutcomeEndsUpdate(candidate, update);
    finalizeWorldChronicleLifecycle(candidate, state.currentDate, existing.archivedAt);
    const eligibility = evaluateWorldChronicleEligibility(candidate);
    if (!eligibility.eligible) {
      ignoredSummaries.push(`worldEventUpdate rejected eventId=${eventId}: ${eligibility.reasonZh}`);
      continue;
    }
    Object.assign(existing, candidate);
    for (const ref of candidate.npcAwarenessRefs ?? []) {
      upsertNpcAwarenessFromReference(state, ref, 'worldTrend', candidate.trendId);
    }
    applied += 1;
  }

  return applied;
}

function applyWorldEventUpdateFields(
  trend: WorldTrendEntry,
  update: NarratorWorldEventUpdate,
  currentDate: string,
): void {
  if (update.title?.trim()) trend.title = update.title.trim();
  if (update.summary?.trim()) trend.summary = update.summary.trim();
  if (update.status) trend.status = update.status;
  if (update.severity) trend.severity = parseWorldTrendSeverity(update.severity);
  if (update.scope) trend.scope = update.scope;
  if (update.certainty) trend.certainty = update.certainty;
  if (update.visibility?.trim()) trend.visibility = update.visibility.trim();
  if (update.locationId?.trim()) trend.locationId = update.locationId.trim();
  if (update.outcomeSummary?.trim()) trend.outcomeSummary = update.outcomeSummary.trim();
  if (update.progressSummary?.trim()) trend.progressSummary = update.progressSummary.trim();
  if (update.nextCheckAt?.trim()) trend.nextCheckAt = update.nextCheckAt.trim();
  if (update.lastAdvancedAt?.trim()) trend.lastAdvancedAt = update.lastAdvancedAt.trim();
  if (update.threadId?.trim()) trend.threadId = update.threadId.trim();
  if (update.archiveReason?.trim()) trend.archiveReason = update.archiveReason.trim();
  assignWorldTrendStringArray(trend, 'consequenceTags', update.consequenceTags);
  assignWorldTrendStringArray(trend, 'affectedNpcIds', update.affectedNpcIds);
  assignWorldTrendStringArray(trend, 'affectedFactionIds', update.affectedFactionIds);
  assignWorldTrendStringArray(trend, 'affectedPlaceIds', update.affectedPlaceIds);
  assignWorldTrendStringArray(trend, 'affectedForceIds', update.affectedForceIds);
  assignWorldTrendStringArray(trend, 'affectedHoldingIds', update.affectedHoldingIds);
  assignWorldTrendStringArray(trend, 'followUpHooks', update.followUpHooks);
  assignWorldTrendStringArray(trend, 'sourceQuestIds', update.sourceQuestIds);
  assignWorldTrendStringArray(trend, 'sourceSignalIds', update.sourceSignalIds);
  assignWorldTrendStringArray(trend, 'sourceConflictIds', update.sourceConflictIds);
  const npcAwarenessRefs = cleanNpcAwarenessRefs(update.npcAwarenessRefs);
  if (npcAwarenessRefs) trend.npcAwarenessRefs = npcAwarenessRefs;
  trend.updatedAt = currentDate;
}

function closeChronicleWhenOutcomeEndsUpdate(
  trend: WorldTrendEntry,
  update: NarratorWorldEventUpdate | NarratorWorldEventSummary,
): void {
  if (!update.outcomeSummary?.trim()) return;
  const explicitlyOngoing = update.status === 'active'
    || update.status === 'cooling'
    || Boolean(update.progressSummary?.trim())
    || Boolean(update.nextCheckAt?.trim())
    || Boolean(update.lastAdvancedAt?.trim());
  if (explicitlyOngoing) return;
  trend.status = 'historical';
  trend.progressSummary = undefined;
  trend.nextCheckAt = undefined;
  trend.lastAdvancedAt = undefined;
}

function finalizeWorldChronicleLifecycle(
  trend: WorldTrendEntry,
  currentDate: string,
  previousArchivedAt?: string,
): void {
  trend.status = resolveWorldChronicleStatus(trend);
  trend.archivedAt = trend.status === 'historical' || trend.status === 'corrected'
    ? previousArchivedAt ?? currentDate
    : undefined;
}

type WorldTrendStringArrayField =
  | 'consequenceTags'
  | 'affectedNpcIds'
  | 'affectedFactionIds'
  | 'affectedPlaceIds'
  | 'affectedForceIds'
  | 'affectedHoldingIds'
  | 'followUpHooks'
  | 'sourceQuestIds'
  | 'sourceSignalIds'
  | 'sourceConflictIds';

function assignWorldTrendStringArray(
  target: WorldTrendEntry,
  key: WorldTrendStringArrayField,
  value: string[] | undefined,
): void {
  const cleaned = cleanStringArray(value);
  if (cleaned) {
    target[key] = cleaned;
  }
}

function archiveWorldTrend(
  state: RuntimeState,
  worldEvent: NarratorWorldEventSummary,
): { state: RuntimeState; applied: boolean; reasonZh?: string } {
  const requestedTrendId = worldEvent.eventId?.trim();
  const threadId = worldEvent.threadId?.trim();
  const existing = findWorldTrendForEvent(state.worldTrends ?? [], requestedTrendId, threadId);
  const trendId = existing?.trendId ?? requestedTrendId ?? uuidv4();
  const summary = worldEvent.summary.trim();
  const requestedStatus = worldEvent.status ?? existing?.status;
  const locationId = worldEvent.locationId?.trim() || existing?.locationId || state.currentLocationId;
  const relatedNpcIds = cleanStringArray(worldEvent.involvedNpcIds) ?? existing?.relatedNpcIds;
  const affectedNpcIds = cleanStringArray(worldEvent.affectedNpcIds) ?? existing?.affectedNpcIds;
  const affectedFactionIds = cleanStringArray(worldEvent.affectedFactionIds) ?? existing?.affectedFactionIds;
  const affectedPlaceIds = cleanStringArray(worldEvent.affectedPlaceIds) ?? existing?.affectedPlaceIds;
  const affectedForceIds = cleanStringArray(worldEvent.affectedForceIds) ?? existing?.affectedForceIds;
  const affectedHoldingIds = cleanStringArray(worldEvent.affectedHoldingIds) ?? existing?.affectedHoldingIds;
  const consequenceTags = cleanStringArray(worldEvent.consequenceTags) ?? existing?.consequenceTags;
  const followUpHooks = cleanStringArray(worldEvent.followUpHooks) ?? existing?.followUpHooks;
  const sourceQuestIds = cleanStringArray(worldEvent.sourceQuestIds) ?? existing?.sourceQuestIds;
  const sourceSignalIds = cleanStringArray(worldEvent.sourceSignalIds) ?? existing?.sourceSignalIds;
  const sourceConflictIds = cleanStringArray(worldEvent.sourceConflictIds) ?? existing?.sourceConflictIds;
  const npcAwarenessRefs = cleanNpcAwarenessRefs(worldEvent.npcAwarenessRefs) ?? existing?.npcAwarenessRefs;
  const entry: WorldTrendEntry = {
    trendId,
    title: worldEvent.title?.trim() || existing?.title || summary.slice(0, 30) || 'World event',
    severity: worldEvent.severity ? parseWorldTrendSeverity(worldEvent.severity) : existing?.severity ?? parseWorldTrendSeverity(worldEvent.severity),
    summary,
    knownToPlayer: resolveWorldEventKnownToPlayer(worldEvent, existing),
    status: requestedStatus,
    happenedAt: worldEvent.happenedAt?.trim() || existing?.happenedAt || state.currentDate,
    learnedAt: existing?.learnedAt || state.currentDate,
    visibility: worldEvent.visibility?.trim() || existing?.visibility,
    scope: worldEvent.scope ?? existing?.scope,
    certainty: worldEvent.certainty ?? existing?.certainty,
    source: worldEvent.source?.trim() || existing?.source,
    locationId,
    relatedNpcIds,
    relatedFactionIds: existing?.relatedFactionIds,
    relatedPlaceIds: worldEvent.locationId?.trim() ? [worldEvent.locationId.trim()] : existing?.relatedPlaceIds,
    affectedNpcIds,
    affectedFactionIds,
    affectedPlaceIds,
    affectedForceIds,
    affectedHoldingIds,
    consequenceTags,
    outcomeSummary: worldEvent.outcomeSummary?.trim() || existing?.outcomeSummary,
    progressSummary: worldEvent.progressSummary?.trim() || existing?.progressSummary,
    nextCheckAt: worldEvent.nextCheckAt?.trim() || existing?.nextCheckAt,
    lastAdvancedAt: worldEvent.lastAdvancedAt?.trim() || existing?.lastAdvancedAt,
    followUpHooks,
    sourceQuestIds,
    sourceSignalIds,
    sourceConflictIds,
    npcAwarenessRefs,
    threadId: threadId || existing?.threadId,
    archiveReason: worldEvent.archiveReason?.trim() || existing?.archiveReason,
    archivedAt: existing?.archivedAt,
    updatedAt: state.currentDate,
  };

  closeChronicleWhenOutcomeEndsUpdate(entry, worldEvent);
  finalizeWorldChronicleLifecycle(entry, state.currentDate, existing?.archivedAt);
  const eligibility = evaluateWorldChronicleEligibility(entry);
  if (!eligibility.eligible) {
    return { state, applied: false, reasonZh: eligibility.reasonZh };
  }

  for (const ref of entry.npcAwarenessRefs ?? []) {
    upsertNpcAwarenessFromReference(state, ref, 'worldTrend', trendId);
  }

  const withoutExisting = (state.worldTrends ?? []).filter((trend) => trend.trendId !== trendId);
  return {
    state: {
      ...state,
      worldTrends: [...withoutExisting, entry],
    },
    applied: true,
  };
}

function findWorldTrendForEvent(
  trends: WorldTrendEntry[],
  trendId: string | undefined,
  threadId: string | undefined,
): WorldTrendEntry | undefined {
  const exact = trendId ? trends.find((trend) => trend.trendId === trendId) : undefined;
  if (exact) return exact;
  if (!threadId) return undefined;

  return trends.find((trend) => {
    if (trend.threadId !== threadId) return false;
    return trend.status !== 'historical';
  });
}

function cleanNpcAwarenessRefs(values: NpcAwarenessReference[] | undefined): NpcAwarenessReference[] | undefined {
  const cleaned = (values ?? []).reduce<NpcAwarenessReference[]>((acc, ref) => {
    const name = ref.name?.trim();
    if (!name) return acc;
    const cleanedRef: NpcAwarenessReference = { name };
    const npcId = ref.npcId?.trim();
    const sourceNote = ref.sourceNote?.trim();
    const playerRelevance = cleanStringArray(ref.playerRelevance);
    const unresolvedHooks = cleanStringArray(ref.unresolvedHooks);
    if (npcId) cleanedRef.npcId = npcId;
    if (sourceNote) cleanedRef.sourceNote = sourceNote;
    if (typeof ref.contactLevel === 'number') cleanedRef.contactLevel = ref.contactLevel;
    if (typeof ref.historicalImportance === 'number') cleanedRef.historicalImportance = ref.historicalImportance;
    if (playerRelevance) cleanedRef.playerRelevance = playerRelevance;
    if (unresolvedHooks) cleanedRef.unresolvedHooks = unresolvedHooks;
    acc.push(cleanedRef);
    return acc;
  }, []);
  return cleaned.length > 0 ? cleaned : undefined;
}

function upsertNpcAwarenessFromReference(
  state: RuntimeState,
  ref: NpcAwarenessReference,
  sourceType: NpcAwarenessSourceType,
  sourceId: string,
): void {
  state.npcAwarenessIndex ??= [];
  const existing = state.npcAwarenessIndex.find((entry) => {
    if (ref.npcId && entry.npcId === ref.npcId) return true;
    return !ref.npcId && entry.name === ref.name;
  });

  if (existing) {
    existing.npcId = existing.npcId ?? ref.npcId;
    existing.sourceType = sourceType;
    existing.sourceIds = uniqueStrings([...existing.sourceIds, sourceId]);
    existing.contactLevel = Math.max(existing.contactLevel, ref.contactLevel ?? 0);
    existing.historicalImportance = Math.max(existing.historicalImportance ?? 0, ref.historicalImportance ?? 0) || undefined;
    existing.playerRelevance = uniqueStrings([...existing.playerRelevance, ...(ref.playerRelevance ?? [])]);
    existing.unresolvedHooks = uniqueStrings([...(existing.unresolvedHooks ?? []), ...(ref.unresolvedHooks ?? [])]);
    existing.lastMentionedAt = state.currentDate;
    existing.knownToPlayer = true;
    existing.archiveVisible = false;
    existing.updatedAt = state.currentDate;
    return;
  }

  state.npcAwarenessIndex.push({
    awarenessId: ref.npcId ? `awareness_${ref.npcId}` : uuidv4(),
    npcId: ref.npcId,
    name: ref.name,
    sourceType,
    sourceIds: [sourceId],
    contactLevel: ref.contactLevel ?? 0,
    historicalImportance: ref.historicalImportance,
    playerRelevance: uniqueStrings(ref.playerRelevance ?? []),
    lastMentionedAt: state.currentDate,
    unresolvedHooks: uniqueStrings(ref.unresolvedHooks ?? []),
    knownToPlayer: true,
    archiveVisible: false,
    updatedAt: state.currentDate,
  });
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function cleanStringArray(values: string[] | undefined): string[] | undefined {
  const cleaned = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeMemoryText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildPlayerKeyDeedId(
  date: string,
  locationId: string | undefined,
  summary: string,
  impact: string | undefined,
): string {
  const normalized = [date, locationId ?? '', normalizeMemoryText(summary), normalizeMemoryText(impact ?? '')].join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `player_deed_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function filterKnownNpcIds(values: string[] | undefined, knownNpcIds: Set<string>): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value && knownNpcIds.has(value));
}

function resolveWorldEventKnownToPlayer(
  worldEvent: NarratorWorldEventSummary,
  existing?: WorldTrendEntry,
): boolean {
  if (typeof worldEvent.knownToPlayer === 'boolean') return worldEvent.knownToPlayer;
  if (!worldEvent.visibility?.trim() && typeof existing?.knownToPlayer === 'boolean') return existing.knownToPlayer;
  return worldEvent.visibility !== '私密' && worldEvent.visibility !== '绉佸瘑';
}

function parseWorldTrendSeverity(value: string | undefined): WorldTrendEntry['severity'] {
  const normalized = value?.trim();
  if (
    normalized === 'low'
    || normalized === 'medium'
    || normalized === 'high'
    || normalized === 'critical'
    || normalized === '低'
    || normalized === '中'
    || normalized === '高'
    || normalized === '极高'
  ) {
    return normalized as WorldTrendEntry['severity'];
  }
  return 'medium' as WorldTrendEntry['severity'];
}

function parseMemoryImportance(value: string | undefined): MemoryImportance {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'critical') {
    return value;
  }
  return 'medium';
}

function applyValidatedCommand(
  state: RuntimeState,
  command: LuanShiCommand,
): { state: RuntimeState; applied: boolean; errors: string[] } {
  const normalizedCommand = normalizeLuanShiCommand(command);
  const validation = validateLuanShiCommand(state, normalizedCommand);
  if (!validation.valid) {
    return {
      state,
      applied: false,
      errors: validation.errors,
    };
  }

  return {
    state: applyLuanShiCommand(state, normalizedCommand),
    applied: true,
    errors: [],
  };
}

interface NpcProfileBatchApplication {
  state: RuntimeState;
  aliasMap: Map<string, NpcIdentityAlias>;
  appliedNpcProfiles: number;
  appliedFemaleProfiles: number;
  acceptedNpcProfiles: NarratorNpcProfileSuggestion[];
}

export function applyAcceptedNpcProfilesForCompliance(
  initialState: RuntimeState,
  profiles: NarratorNpcProfileSuggestion[],
): RuntimeState {
  return applyNpcProfileSuggestionsSequentially(
    initialState,
    profiles.map(withoutFemaleProfile),
    [],
    new Map(),
    true,
  ).state;
}

export function tryApplyNpcProfileForCompliance(
  initialState: RuntimeState,
  profile: NarratorNpcProfileSuggestion,
): {
  state: RuntimeState;
  accepted: boolean;
  acceptedProfile?: NarratorNpcProfileSuggestion;
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const result = applyNpcProfileSuggestionsSequentially(
    initialState,
    [withoutFemaleProfile(profile)],
    diagnostics,
    new Map(),
    true,
  );
  return {
    state: result.state,
    accepted: result.appliedNpcProfiles === 1,
    acceptedProfile: result.acceptedNpcProfiles[0],
    diagnostics,
  };
}

function withoutFemaleProfile(profile: NarratorNpcProfileSuggestion): NarratorNpcProfileSuggestion {
  const { femaleProfile: _femaleProfile, ...identityProfile } = profile;
  return identityProfile;
}

function applyNpcProfileSuggestionsSequentially(
  initialState: RuntimeState,
  profiles: NarratorNpcProfileSuggestion[],
  ignoredSummaries: string[],
  trustedPresenceLocations: Map<string, string> = new Map(),
  allowOptionalFallback = false,
): NpcProfileBatchApplication {
  let state = initialState;
  const aliasMap = new Map<string, NpcIdentityAlias>();
  let appliedNpcProfiles = 0;
  let appliedFemaleProfiles = 0;
  const acceptedNpcProfiles: NarratorNpcProfileSuggestion[] = [];
  const pendingFemaleProfiles: Array<{
    npcId: string;
    npcName: string;
    femaleProfile: LuanShiNpcFemaleProfile;
  }> = [];

  for (const suggestion of profiles) {
    const incomingId = suggestion.npcId.trim();
    const resolvedIncomingId = mapNpcId(incomingId, aliasMap);
    const exactNpc = state.npcs?.find((npc) => npc.npcId === resolvedIncomingId);
    if (exactNpc && !hasCompatibleExactNpcIdentity(exactNpc, suggestion, state.currentDate)) {
      ignoredSummaries.push(
        `NPC档案：npcId 身份冲突：${incomingId} 已属于 ${exactNpc.name}，收到 ${suggestion.name}`,
      );
      continue;
    }
    const canonicalNpc = exactNpc ?? findSameKnownNpc(state, suggestion);
    const canonicalSuggestion = canonicalizeNpcProfileSuggestion(
      suggestion,
      canonicalNpc,
      canonicalNpc?.npcId ?? resolvedIncomingId,
      trustedPresenceLocations.get(incomingId)
        ?? trustedPresenceLocations.get(resolvedIncomingId)
        ?? (canonicalNpc ? trustedPresenceLocations.get(canonicalNpc.npcId) : undefined),
      state.currentDate,
      getCurrentLocationIds(state),
    );
    const { femaleProfile, ...npcSuggestion } = canonicalSuggestion;
    let profileApplication: NpcProfileOptionalFallbackApplication;
    if (allowOptionalFallback) {
      profileApplication = applyNpcProfileWithOptionalFallbacks(state, npcSuggestion);
    } else {
      const strictResult = applyValidatedCommand(state, {
        action: 'upsertNpcProfile',
        ...npcSuggestion,
      });
      profileApplication = (
        !strictResult.applied
        && npcSuggestion.uniqueArts !== undefined
        && strictResult.errors.length > 0
        && strictResult.errors.every((error) => error.startsWith('upsertNpcProfile.uniqueArts'))
      )
        ? applyNpcProfileWithOptionalFallbacks(state, npcSuggestion)
        : {
            result: strictResult,
            acceptedProfile: npcSuggestion,
            removedSections: [],
          };
    }
    const { result, acceptedProfile, removedSections } = profileApplication;
    state = result.state;

    if (!result.applied) {
      ignoredSummaries.push(...result.errors.map((error) => `NPC档案：${error}`));
      continue;
    }

    if (removedSections.length > 0) {
      ignoredSummaries.push(
        `NPC档案：${canonicalSuggestion.name} 的${removedSections.join('、')}未通过合同，已保留人物基础档案；可选扩展可在后续回合补全。`,
      );
    }

    appliedNpcProfiles += 1;
    acceptedNpcProfiles.push(acceptedProfile);
    const acceptedNpc = state.npcs?.find((npc) => npc.npcId === canonicalSuggestion.npcId);
    const trustedNames = acceptedNpc ? buildTrustedNpcNameSet(acceptedNpc) : new Set<string>();
    for (const alias of aliasMap.values()) {
      if (alias.canonicalNpcId !== canonicalSuggestion.npcId) continue;
      for (const name of trustedNames) alias.trustedNames.add(name);
    }
    if (incomingId && incomingId !== canonicalSuggestion.npcId) {
      aliasMap.set(incomingId, {
        canonicalNpcId: canonicalSuggestion.npcId,
        trustedNames,
      });
    }

    if (femaleProfile) {
      pendingFemaleProfiles.push({
        npcId: canonicalSuggestion.npcId,
        npcName: canonicalSuggestion.name,
        femaleProfile,
      });
    }
  }

  const canonicalNameReferences = buildCanonicalNpcNameReferenceMap(state);
  for (const pending of pendingFemaleProfiles) {
    const femaleProfile = canonicalizeFemaleProfileNameReferences(
      pending.femaleProfile,
      canonicalNameReferences,
    );
    const femaleProfileCommand: LuanShiCommand = {
      action: 'updateNpcFemaleProfile',
      npcId: pending.npcId,
      npcName: pending.npcName,
      ...femaleProfile,
    };
    const femaleProfileResult = applyValidatedCommand(state, femaleProfileCommand);
    state = femaleProfileResult.state;
    if (femaleProfileResult.applied) {
      appliedFemaleProfiles += 1;
    } else {
      ignoredSummaries.push(...femaleProfileResult.errors.map((error) => `女性档案：${error}`));
    }
  }

  return {
    state,
    aliasMap,
    appliedNpcProfiles,
    appliedFemaleProfiles,
    acceptedNpcProfiles,
  };
}

interface NpcProfileOptionalFallbackApplication {
  result: ReturnType<typeof applyValidatedCommand>;
  acceptedProfile: NarratorNpcProfileSuggestion;
  removedSections: string[];
}

/**
 * 长期人物准入不能被行装、绝艺等可选扩展的单点格式错误整体拖垮。
 * 这里只按严格校验返回的字段路径移除对应可选子结构，不修改姓名、身份、
 * 六维、特质等人物核心事实，也不从正文猜测缺失数据。
 */
function applyNpcProfileWithOptionalFallbacks(
  state: RuntimeState,
  profile: NarratorNpcProfileSuggestion,
): NpcProfileOptionalFallbackApplication {
  let acceptedProfile = profile;
  let result = applyValidatedCommand(state, {
    action: 'upsertNpcProfile',
    ...acceptedProfile,
  });
  if (result.applied || result.errors.length === 0) {
    return { result, acceptedProfile, removedSections: [] };
  }

  const removedSections: string[] = [];
  const invalid = (prefix: string) => result.errors.some((error) => error.startsWith(prefix));
  let changed = false;
  const fallbackProfile: NarratorNpcProfileSuggestion = { ...acceptedProfile };

  if (invalid('upsertNpcProfile.uniqueArts') && fallbackProfile.uniqueArts !== undefined) {
    delete fallbackProfile.uniqueArts;
    removedSections.push('绝艺子结构');
    changed = true;
  }
  if (invalid('upsertNpcProfile.effects') && fallbackProfile.effects !== undefined) {
    delete fallbackProfile.effects;
    removedSections.push('状态子结构');
    changed = true;
  }
  if (
    (invalid('upsertNpcProfile.equipment') || invalid('upsertNpcProfile.inventory'))
    && (fallbackProfile.equipment !== undefined || fallbackProfile.inventory !== undefined)
  ) {
    delete fallbackProfile.equipment;
    delete fallbackProfile.inventory;
    removedSections.push('行装子结构');
    changed = true;
  }
  if (invalid('upsertNpcProfile.vitals') && fallbackProfile.vitals !== undefined) {
    delete fallbackProfile.vitals;
    removedSections.push('生命体力子结构');
    changed = true;
  }
  if (
    (invalid('upsertNpcProfile.birthDate') || invalid('upsertNpcProfile.ageKnownAtDate'))
    && (fallbackProfile.birthDate !== undefined || fallbackProfile.ageKnownAtDate !== undefined)
  ) {
    delete fallbackProfile.birthDate;
    delete fallbackProfile.ageKnownAtDate;
    removedSections.push('可选出生日期扩展');
    changed = true;
  }
  if (
    result.errors.some((error) => /^upsertNpcProfile\.traits\[\d+\]\.checkHooks/.test(error))
    && Array.isArray(fallbackProfile.traits)
  ) {
    fallbackProfile.traits = fallbackProfile.traits.map((trait) => {
      const { checkHooks: _invalidCheckHooks, ...baseTrait } = trait;
      return baseTrait;
    });
    removedSections.push('特质判定钩子');
    changed = true;
  }

  if (!changed) {
    return { result, acceptedProfile, removedSections: [] };
  }

  const fallbackResult = applyValidatedCommand(state, {
    action: 'upsertNpcProfile',
    ...fallbackProfile,
  });
  if (!fallbackResult.applied) {
    return { result: fallbackResult, acceptedProfile, removedSections: [] };
  }

  acceptedProfile = fallbackProfile;
  result = fallbackResult;
  return { result, acceptedProfile, removedSections };
}

function buildCanonicalNpcNameReferenceMap(state: RuntimeState): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  for (const npc of state.npcs ?? []) {
    for (const name of buildTrustedNpcNameSet(npc)) {
      const canonicalNames = candidates.get(name) ?? new Set<string>();
      canonicalNames.add(npc.name);
      candidates.set(name, canonicalNames);
    }
  }
  return new Map(Array.from(candidates.entries()).flatMap(([name, canonicalNames]) => (
    canonicalNames.size === 1 ? [[name, Array.from(canonicalNames)[0]]] : []
  )));
}

function canonicalizeFemaleProfileNameReferences(
  profile: LuanShiNpcFemaleProfile,
  canonicalNames: Map<string, string>,
): LuanShiNpcFemaleProfile {
  const canonicalizeName = (name: string): string => (
    canonicalNames.get(normalizeIdentityText(name)) ?? name
  );
  return {
    ...profile,
    ...(profile.relationshipNetwork
      ? {
          relationshipNetwork: profile.relationshipNetwork.map((entry) => ({
            ...entry,
            targetName: canonicalizeName(entry.targetName),
          })),
        }
      : {}),
    ...(profile.adultPrivateProfile
      ? {
          adultPrivateProfile: {
            ...profile.adultPrivateProfile,
            ...(profile.adultPrivateProfile.firstNightPartner
              ? { firstNightPartner: canonicalizeName(profile.adultPrivateProfile.firstNightPartner) }
              : {}),
          },
        }
      : {}),
  };
}

function canonicalizeNpcProfileSuggestion(
  profile: NarratorNpcProfileSuggestion,
  canonicalNpc: LuanShiNpc | undefined,
  canonicalId: string,
  trustedPresenceLocation?: string,
  currentDate = '',
  currentLocationIds: Set<string> = new Set(),
): NarratorNpcProfileSuggestion & { isFocused: boolean } {
  if (!canonicalNpc) {
    const birthDate = ensureCompleteBirthDate({
      age: profile.age,
      birthDate: profile.birthDate,
      ageKnownAtDate: profile.ageKnownAtDate,
      currentDate,
      stableId: `npc:${canonicalId}`,
    });
    return {
      ...profile,
      npcId: canonicalId,
      birthDate,
      isFocused: profile.isFocused ?? profile.isPresent,
    };
  }

  const incomingName = profile.name.trim();
  const existingTrustedNames = buildTrustedNpcNameSet(canonicalNpc);
  const courtesyName = profile.courtesyName ?? canonicalNpc.courtesyName;
  const artName = profile.artName ?? canonicalNpc.artName;
  const principalNames = new Set([
    canonicalNpc.name,
    courtesyName,
    artName,
  ].map(normalizeIdentityText).filter(Boolean));
  const aliases: string[] = [];
  for (const alias of [
    ...(canonicalNpc.aliases ?? []),
    ...(profile.aliases ?? []),
    ...(incomingName && !existingTrustedNames.has(normalizeIdentityText(incomingName))
      ? [incomingName]
      : []),
  ]) {
    const normalizedAlias = normalizeIdentityText(alias);
    if (!normalizedAlias || principalNames.has(normalizedAlias)) continue;
    if (aliases.some((value) => normalizeIdentityText(value) === normalizedAlias)) continue;
    aliases.push(alias.trim());
  }

  const profileLocationId = profile.locationId?.trim();
  const birthDate = ensureCompleteBirthDate({
    age: canonicalNpc.age,
    birthDate: canonicalNpc.birthDate ?? profile.birthDate,
    ageKnownAtDate: canonicalNpc.ageKnownAtDate ?? profile.ageKnownAtDate,
    currentDate,
    stableId: `npc:${canonicalNpc.npcId}`,
  });
  const claimsUntrustedCurrentScenePresence = !trustedPresenceLocation
    && profile.isPresent === true
    && Boolean(profileLocationId && currentLocationIds.has(profileLocationId));

  return {
    ...profile,
    npcId: canonicalId,
    name: canonicalNpc.name,
    courtesyName,
    artName,
    commonAddress: profile.commonAddress ?? canonicalNpc.commonAddress,
    birthDate,
    aliases: aliases.length > 0 ? aliases : undefined,
    locationId: trustedPresenceLocation
      ?? (claimsUntrustedCurrentScenePresence ? canonicalNpc.locationId : profile.locationId)
      ?? canonicalNpc.locationId
      ?? profile.locationId,
    isPresent: trustedPresenceLocation
      ? true
      : claimsUntrustedCurrentScenePresence
        ? canonicalNpc.isPresent
        : profile.isPresent,
    isFocused: isNpcProfileFocusExplicit(profile) ? profile.isFocused : canonicalNpc.isFocused,
    factionId: profile.factionId ?? canonicalNpc.factionId,
    factionName: profile.factionName ?? canonicalNpc.factionName,
    birthOrigin: profile.birthOrigin ?? canonicalNpc.birthOrigin,
    birthOriginDescription: profile.birthOriginDescription ?? canonicalNpc.birthOriginDescription,
    currentIdentityDescription: profile.currentIdentityDescription ?? canonicalNpc.currentIdentityDescription,
    allegianceTarget: profile.allegianceTarget ?? canonicalNpc.allegianceTarget,
    officeTitle: profile.officeTitle ?? canonicalNpc.officeTitle,
    militaryTitle: profile.militaryTitle ?? canonicalNpc.militaryTitle,
    nobleTitle: profile.nobleTitle ?? canonicalNpc.nobleTitle,
    identitySummary: profile.identitySummary ?? canonicalNpc.identitySummary,
    abilityScores: Object.keys(profile.abilityScores).length > 0
      ? profile.abilityScores
      : canonicalNpc.abilityScores ?? profile.abilityScores,
    vitals: profile.vitals ?? canonicalNpc.vitals,
    traits: profile.traits.length > 0 ? profile.traits : canonicalNpc.traits ?? [],
    uniqueArts: mergeStableNpcUniqueArts(canonicalNpc.uniqueArts, profile.uniqueArts),
    effects: profile.effects && profile.effects.length > 0 ? profile.effects : canonicalNpc.effects,
    equipment: profile.equipment === undefined || (Array.isArray(profile.equipment) && profile.equipment.length === 0)
      ? canonicalNpc.equipment
      : profile.equipment,
    inventory: profile.inventory === undefined || (Array.isArray(profile.inventory) && profile.inventory.length === 0)
      ? canonicalNpc.inventory
      : profile.inventory,
  };
}

function getCurrentLocationIds(state: RuntimeState): Set<string> {
  return new Set(
    [state.currentLocationId, state.currentPlaceId, state.currentSceneId]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  );
}

function buildTrustedProfilePresenceLocations(
  state: RuntimeState,
  writeback: NarratorWritebackProtocol,
): Map<string, string> {
  const trustedLocations = new Map<string, string>();
  const currentLocationIds = getCurrentLocationIds(state);
  for (const event of state.turnEvents ?? []) {
    const eventLocationId = event.locationId?.trim();
    if (
      event.happenedAt !== state.currentDate
      || !eventLocationId
      || (currentLocationIds.size > 0 && !currentLocationIds.has(eventLocationId))
    ) {
      continue;
    }
    for (const npcId of event.presentNpcIds ?? []) {
      if (npcId.trim()) trustedLocations.set(npcId.trim(), eventLocationId);
    }
  }

  const event = writeback.worldEventSummary;
  const eventLocationId = event?.locationId?.trim();
  if (!eventLocationId || !event?.presentNpcIds?.length) return trustedLocations;

  if (currentLocationIds.size > 0 && !currentLocationIds.has(eventLocationId)) return trustedLocations;

  for (const npcId of event.presentNpcIds) {
    if (npcId.trim()) trustedLocations.set(npcId.trim(), eventLocationId);
  }
  return trustedLocations;
}

function isNpcProfileFocusExplicit(profile: NarratorNpcProfileSuggestion): boolean {
  const parsedMarker = (profile as NarratorNpcProfileSuggestion & {
    [NPC_PROFILE_EXPLICIT_IS_FOCUSED]?: boolean;
  })[NPC_PROFILE_EXPLICIT_IS_FOCUSED];
  return parsedMarker !== false;
}

function canonicalizeWritebackNpcReferences(
  state: RuntimeState,
  writeback: NarratorWritebackProtocol,
  aliasMap: Map<string, NpcIdentityAlias>,
): NarratorWritebackProtocol {
  const canonicalIdentities = buildCanonicalNpcIdentityIndex(state);

  return {
    ...writeback,
    npcMemorySuggestions: writeback.npcMemorySuggestions.map((memory) => {
      const reference = resolveCanonicalNamedNpcReference(
        memory.npcId,
        memory.npcName,
        aliasMap,
        canonicalIdentities,
      );
      return {
        ...memory,
        npcId: reference.npcId,
        npcName: reference.name,
      };
    }),
    questChanges: writeback.questChanges.map((change) => ({
      ...change,
      relatedNpcIds: mapNpcIdArray(change.relatedNpcIds, aliasMap),
      affectedNpcIds: mapNpcIdArray(change.affectedNpcIds, aliasMap),
    })),
    signalChanges: writeback.signalChanges?.map((change) => ({
      ...change,
      affectedNpcIds: mapNpcIdArray(change.affectedNpcIds, aliasMap),
      npcAwarenessRefs: mapNpcAwarenessRefs(change.npcAwarenessRefs, aliasMap, canonicalIdentities),
    })),
    worldEventUpdates: writeback.worldEventUpdates?.map((event) => ({
      ...event,
      affectedNpcIds: mapNpcIdArray(event.affectedNpcIds, aliasMap),
      npcAwarenessRefs: mapNpcAwarenessRefs(event.npcAwarenessRefs, aliasMap, canonicalIdentities),
    })),
    worldEventSummary: writeback.worldEventSummary
      ? {
          ...writeback.worldEventSummary,
          presentNpcIds: mapNpcIdArray(writeback.worldEventSummary.presentNpcIds, aliasMap),
          involvedNpcIds: mapNpcIdArray(writeback.worldEventSummary.involvedNpcIds, aliasMap),
          affectedNpcIds: mapNpcIdArray(writeback.worldEventSummary.affectedNpcIds, aliasMap),
          npcAwarenessRefs: mapNpcAwarenessRefs(
            writeback.worldEventSummary.npcAwarenessRefs,
            aliasMap,
            canonicalIdentities,
          ),
        }
      : writeback.worldEventSummary,
  };
}

interface CanonicalNpcIdentity {
  canonicalName: string;
  trustedNames: Set<string>;
}

interface NpcIdentityAlias {
  canonicalNpcId: string;
  trustedNames: Set<string>;
}

interface CanonicalNamedNpcReference {
  npcId: string | undefined;
  name: string | undefined;
  knownNpcId: boolean;
  trusted: boolean;
}

function buildCanonicalNpcIdentityIndex(state: RuntimeState): Map<string, CanonicalNpcIdentity> {
  return new Map((state.npcs ?? []).map((npc) => [
    npc.npcId,
    {
      canonicalName: npc.name,
      trustedNames: buildTrustedNpcNameSet(npc),
    },
  ]));
}

function buildTrustedNpcNameSet(npc: LuanShiNpc): Set<string> {
  return new Set([
    npc.name,
    npc.courtesyName,
    npc.artName,
    ...(npc.aliases ?? []),
  ].map(normalizeIdentityText).filter(Boolean));
}

function resolveCanonicalNamedNpcReference(
  npcId: string | undefined,
  name: string | undefined,
  aliasMap: Map<string, NpcIdentityAlias>,
  canonicalIdentities: Map<string, CanonicalNpcIdentity>,
): CanonicalNamedNpcReference {
  const incomingId = npcId?.trim();
  const mappedNpcId = mapOptionalNpcId(incomingId, aliasMap);
  const identity = mappedNpcId ? canonicalIdentities.get(mappedNpcId) : undefined;
  const normalizedName = normalizeIdentityText(name);
  const alias = incomingId ? aliasMap.get(incomingId) : undefined;
  const trusted = Boolean(identity && normalizedName && (
    alias ? alias.trustedNames.has(normalizedName) : identity.trustedNames.has(normalizedName)
  ));

  return {
    npcId: mappedNpcId,
    name: trusted ? identity?.canonicalName : name,
    knownNpcId: Boolean(identity),
    trusted,
  };
}

function findSameKnownNpc(
  state: RuntimeState,
  profile: NarratorNpcProfileSuggestion,
): LuanShiNpc | undefined {
  let bestMatch: LuanShiNpc | undefined;
  let bestScore = 0;
  let bestScoreIsAmbiguous = false;

  for (const npc of state.npcs ?? []) {
    const score = scoreNpcIdentityMatch(npc, profile, state.currentDate);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = npc;
      bestScoreIsAmbiguous = false;
    } else if (score > 0 && score === bestScore) {
      bestScoreIsAmbiguous = true;
    }
  }

  return bestScore > 0 && !bestScoreIsAmbiguous ? bestMatch : undefined;
}

function hasCompatibleExactNpcIdentity(
  npc: LuanShiNpc,
  profile: NarratorNpcProfileSuggestion,
  currentDate: string,
): boolean {
  if (hasConflictingIdentityEvidence(npc, profile, currentDate)) return false;
  const incomingPrimaryName = normalizeIdentityText(profile.name);
  return buildTrustedNpcNameSet(npc).has(incomingPrimaryName)
    || hasStrongStableBiographyMatch(npc, profile, currentDate);
}

function scoreNpcIdentityMatch(
  npc: LuanShiNpc,
  profile: NarratorNpcProfileSuggestion,
  currentDate: string,
): number {
  const existingName = normalizeIdentityText(npc.name);
  const incomingName = normalizeIdentityText(profile.name);
  if (!existingName || !incomingName) return 0;

  if (hasConflictingIdentityEvidence(npc, profile, currentDate, true)) return 0;

  const existingSecondaryNames = new Set([
    normalizeIdentityText(npc.courtesyName),
    normalizeIdentityText(npc.artName),
    ...(npc.aliases ?? []).map(normalizeIdentityText),
  ].filter(Boolean));
  const incomingSecondaryNames = new Set([
    normalizeIdentityText(profile.courtesyName),
    normalizeIdentityText(profile.artName),
    ...(profile.aliases ?? []).map(normalizeIdentityText),
  ].filter(Boolean));

  const samePrimaryName = existingName === incomingName;
  const secondaryOverlap = [...incomingSecondaryNames].some((name) => existingSecondaryNames.has(name));
  const primaryToSecondary = existingSecondaryNames.has(incomingName)
    || incomingSecondaryNames.has(existingName);

  if (secondaryOverlap || primaryToSecondary) return 4;
  if (samePrimaryName && hasStrongBiographicalOverlap(npc, profile)) return 3;
  if (samePrimaryName && hasMatchingJurisdictionalOfficeIdentity(npc, profile)) return 2;
  if (hasStrongStableBiographyMatch(npc, profile, currentDate)) return 1;
  return 0;
}

function hasMatchingJurisdictionalOfficeIdentity(
  npc: LuanShiNpc,
  profile: NarratorNpcProfileSuggestion,
): boolean {
  const name = normalizeIdentityText(npc.name);
  if (name.length < 4 || !/(?:太守|刺史|州牧|郡守|县令|县长|县尉|郡丞|县丞|主簿|功曹|督邮|从事|贼曹|仓曹)$/.test(name)) {
    return false;
  }
  const describesSameOffice = (value?: string | null): boolean => {
    const normalized = normalizeIdentityText(value);
    return normalized === name || normalized.includes(name);
  };
  return [npc.role, npc.currentIdentity, npc.officeTitle].some(describesSameOffice)
    && [profile.role, profile.currentIdentity, profile.officeTitle].some(describesSameOffice);
}

function hasStrongStableBiographyMatch(
  npc: LuanShiNpc,
  profile: NarratorNpcProfileSuggestion,
  currentDate: string,
): boolean {
  if (!hasBirthOriginOverlap(npc.birthOrigin, profile.birthOrigin)) return false;
  if (npc.sex !== profile.sex) return false;
  const currentAge = deriveNpcCurrentAge(npc, currentDate);
  if (currentAge === undefined || !Number.isFinite(profile.age) || Math.abs(currentAge - profile.age) > 2) return false;
  return hasStrongTextOverlap(npc.identitySummary, profile.identitySummary)
    || hasStrongTextOverlap(npc.birthOriginDescription, profile.birthOriginDescription);
}

function hasStrongTextOverlap(left?: string | null, right?: string | null): boolean {
  const normalizedLeft = normalizeIdentityText(left);
  const normalizedRight = normalizeIdentityText(right);
  if (normalizedLeft.length < 8 || normalizedRight.length < 8) return false;
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function hasConflictingIdentityEvidence(
  npc: LuanShiNpc,
  profile: NarratorNpcProfileSuggestion,
  currentDate: string,
  allowStableClusterAgeDrift = false,
): boolean {
  if (npc.sex && profile.sex && npc.sex !== profile.sex) return true;
  const currentAge = deriveNpcCurrentAge(npc, currentDate);
  if (
    currentAge !== undefined
    && Number.isFinite(profile.age)
    && Math.abs(currentAge - profile.age) > 5
    && !(allowStableClusterAgeDrift && hasStableIdentityClusterMatch(npc, profile))
  ) return true;
  if (npc.birthOrigin && profile.birthOrigin && !hasBirthOriginOverlap(npc.birthOrigin, profile.birthOrigin)) return true;
  return false;
}

function hasStableIdentityClusterMatch(
  npc: LuanShiNpc,
  profile: NarratorNpcProfileSuggestion,
): boolean {
  const sameName = normalizeIdentityText(npc.name) === normalizeIdentityText(profile.name);
  const sameSex = Boolean(npc.sex && profile.sex && npc.sex === profile.sex);
  const sameBirthOrigin = hasBirthOriginOverlap(npc.birthOrigin, profile.birthOrigin);
  const existingIdentity = normalizeIdentityText(npc.currentIdentity);
  const incomingIdentity = normalizeIdentityText(profile.currentIdentity);
  const sameCurrentIdentity = Boolean(existingIdentity && incomingIdentity && existingIdentity === incomingIdentity);
  return sameName && sameSex && sameBirthOrigin && sameCurrentIdentity;
}

function hasStrongBiographicalOverlap(
  npc: LuanShiNpc,
  profile: NarratorNpcProfileSuggestion,
): boolean {
  return hasBirthOriginOverlap(npc.birthOrigin, profile.birthOrigin);
}

function hasBirthOriginOverlap(left?: string | null, right?: string | null): boolean {
  const normalizeBirthOrigin = (value?: string | null) => normalizeIdentityText(value)
    .replace(/[人氏籍]$/, '')
    .replace(/[省州郡府县]$/g, '');
  const normalizedLeft = normalizeBirthOrigin(left);
  const normalizedRight = normalizeBirthOrigin(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function normalizeIdentityText(value?: string | null): string {
  return typeof value === 'string' ? value.replace(/\s+/g, '').trim() : '';
}

function mapNpcId(value: string, aliasMap: Map<string, NpcIdentityAlias>): string {
  let current = value.trim();
  const visited = new Set<string>();
  while (aliasMap.has(current) && !visited.has(current)) {
    visited.add(current);
    current = aliasMap.get(current)?.canonicalNpcId ?? current;
  }
  return current;
}

function mapOptionalNpcId(value: string | undefined, aliasMap: Map<string, NpcIdentityAlias>): string | undefined {
  if (!value) return value;
  return mapNpcId(value, aliasMap);
}

function mapNpcIdArray(values: string[] | undefined, aliasMap: Map<string, NpcIdentityAlias>): string[] | undefined {
  if (!values) return values;
  const next: string[] = [];
  for (const value of values) {
    const mapped = mapNpcId(value, aliasMap);
    if (mapped && !next.includes(mapped)) next.push(mapped);
  }
  return next;
}

function mapNpcAwarenessRefs(
  refs: NpcAwarenessReference[] | undefined,
  aliasMap: Map<string, NpcIdentityAlias>,
  canonicalIdentities: Map<string, CanonicalNpcIdentity>,
): NpcAwarenessReference[] | undefined {
  if (!refs) return refs;
  return refs.map((ref) => {
    const reference = resolveCanonicalNamedNpcReference(
      ref.npcId,
      ref.name,
      aliasMap,
      canonicalIdentities,
    );
    return {
      ...ref,
      npcId: reference.knownNpcId && !reference.trusted ? undefined : reference.npcId,
      name: reference.name ?? ref.name,
    };
  });
}

function parseEventVisibility(value: string | undefined): TurnEventRecord['visibility'] {
  return normalizeTurnEventVisibility(value) ?? '私密';
}
