// ============================================================
// Engine - StatePatchApplier
// 将校验通过的 StatePatch 写入 RuntimeState
// ============================================================

import type {
  RuntimeState,
  StatePatch,
  Actor,
  Rumor,
  Quest,
  TurnDisplayMeta,
  TurnLogEntry,
  NpcAwarenessReference,
  NpcAwarenessSourceType,
  NpcPresenceUpdate,
} from '../types';
import type { LuanShiCommand } from '../state/luanshiCommands';
import { applyLuanShiCommand } from '../state/luanshiReducers';
import { v4 as uuidv4 } from './uuid';
import {
  advanceGameClock,
  advanceRuntimeClock,
  ensureGameClock,
  formatGameClock,
  type GameClockAdvance,
} from '../time/gameClock';
import {
  loadPregnancyModeFromStorage,
  type PregnancyModePreference,
} from '../settings/DisplaySettings';
import { advancePregnancyLifecycle } from '../pregnancy/PregnancyLifecycle';
import { settleDueHoldingGovernanceProjects } from '../holdings/HoldingGovernanceProjects';
import { settleDueHeavyCavalryFormationProjects } from '../troops/HeavyCavalryFormation';
import { extractLuanShiCommandFromPatch, normalizeLuanShiCommandPatch } from './LuanShiCommandPatch';
import { findReusableRumorBySemantic } from './signalDedupe';
import {
  applyPlayerExperience,
  isValidQuestCompletionExperienceReward,
  questCompletionExperienceReward,
} from '../character/progression';
import {
  synchronizeCurrentMatterLifecycle,
  synchronizeNpcBackgroundActivitiesWithCurrentMatters,
} from '../state/currentMatterLifecycle';
import {
  normalizeRelationshipChangePayload,
  normalizeResourceChangedPayload,
  normalizeStatePatchContract,
  normalizeStatePatchContractResult,
  resolveResourceChangedValue,
} from './StatePatchContract';

export interface ApplyPatchOptions {
  defaultTimeAdvance?: GameClockAdvance | null;
  openingInitialization?: boolean;
  pregnancyMode?: PregnancyModePreference;
}

export function createStatePatchDraft(state: RuntimeState): RuntimeState {
  return JSON.parse(JSON.stringify(state)) as RuntimeState;
}

export function applyPatchToDraft(
  draft: RuntimeState,
  patch: StatePatch,
  options: ApplyPatchOptions = {},
): boolean {
  return applySinglePatch(draft, patch, options);
}

/**
 * 应用 StatePatch 到 RuntimeState
 * 返回新的 RuntimeState（不可变更新）
 */
export function applyPatch(
  state: RuntimeState,
  patch: StatePatch,
  turnNumber: number,
  playerInput: string,
  narrativeText: string,
  displayMeta?: TurnDisplayMeta,
  options: ApplyPatchOptions = {},
): RuntimeState {
  return applyPatches(state, [patch], turnNumber, playerInput, narrativeText, displayMeta, options);
}

export function applyPatches(
  state: RuntimeState,
  patches: StatePatch[],
  turnNumber: number,
  playerInput: string,
  narrativeText: string,
  displayMeta?: TurnDisplayMeta,
  options: ApplyPatchOptions = {},
): RuntimeState {
  const normalizedPatches: StatePatch[] = [];
  let timeAdvanceCount = 0;
  const updatedNpcRelationshipIds = new Set<string>();
  for (const patch of patches) {
    const result = normalizeStatePatchContractResult(normalizeLuanShiCommandPatch(patch));
    if (!result.ok) return state;
    if (result.patch.type === 'timeAdvance' && ++timeAdvanceCount > 1) return state;
    const command = extractLuanShiCommandFromPatch(result.patch);
    if (command?.action === 'updateNpcRelationship') {
      const npcId = typeof command.npcId === 'string' ? command.npcId.trim() : '';
      if (npcId) {
        if (updatedNpcRelationshipIds.has(npcId)) return state;
        updatedNpcRelationshipIds.add(npcId);
      }
    }
    normalizedPatches.push(result.patch);
  }

  const newState = createStatePatchDraft(state);
  for (const patch of normalizedPatches) {
    if (!applyPatchToDraft(newState, patch, options)) return state;
  }

  return finalizeStatePatchDraft(
    newState,
    normalizedPatches,
    turnNumber,
    playerInput,
    narrativeText,
    displayMeta,
    options,
  );
}

export function finalizeStatePatchDraft(
  draft: RuntimeState,
  patches: StatePatch[],
  turnNumber: number,
  playerInput: string,
  narrativeText: string,
  displayMeta?: TurnDisplayMeta,
  options: ApplyPatchOptions = {},
): RuntimeState {
  const newState = draft;

  if (!patches.some((patch) => patch.type === 'timeAdvance') && options.defaultTimeAdvance) {
    advanceRuntimeClock(newState, options.defaultTimeAdvance);
  }

  Object.assign(newState, advancePregnancyLifecycle(newState));
  Object.assign(newState, settleDueHoldingGovernanceProjects(newState));
  Object.assign(newState, settleDueHeavyCavalryFormationProjects(newState));

  // 添加回合日志
  const logEntry: TurnLogEntry = {
    turnNumber,
    date: newState.currentDate,
    playerInput,
    narrativeText: narrativeText.slice(0, 200) + (narrativeText.length > 200 ? '...' : ''),
    fullNarrativeText: narrativeText,
    statePatchSummary: patches.length > 0
      ? patches.map(summarizeAppliedPatch).join('；')
      : '无状态变更',
    timestamp: new Date().toISOString(),
    displayMeta,
  };
  newState.turnLog.push(logEntry);

  // 记录最近 patch
  const lastPatch = patches[patches.length - 1];
  newState.lastStatePatch = lastPatch
    ? JSON.parse(JSON.stringify(lastPatch)) as StatePatch
    : undefined;

  return newState;
}

function summarizeAppliedPatch(patch: StatePatch): string {
  const command = extractLuanShiCommandFromPatch(patch);
  if (command?.action === 'updateResourceLedger') {
    const details: string[] = [];
    if (typeof command.moneyGuan === 'number' && Number.isFinite(command.moneyGuan)) {
      const delta = typeof command.moneyDeltaGuan === 'number' && Number.isFinite(command.moneyDeltaGuan)
        ? `, delta=${command.moneyDeltaGuan >= 0 ? '+' : ''}${command.moneyDeltaGuan}贯`
        : '';
      details.push(`money=${command.moneyGuan}贯${delta}`);
    }
    for (const field of ['grain', 'horses', 'arms', 'recruits'] as const) {
      const value = command[field];
      if (typeof value === 'number' && Number.isFinite(value)) details.push(`${field}=${value}`);
    }
    for (const field of ['weapons', 'documents', 'tokens', 'importantSupplies'] as const) {
      const value = command[field];
      if (Array.isArray(value)) details.push(`${field}[${value.length}]`);
    }
    for (const [resourceKey, value] of Object.entries(command.playerResources ?? {})) {
      details.push(`playerResources.${resourceKey}=${value}`);
    }
    return `${patch.type}: updateResourceLedger[${details.join(', ')}] · ${patch.reason}`;
  }

  if (patch.type === 'resourceChanged') {
    const normalized = normalizeResourceChangedPayload(patch.payload);
    if (normalized.ok) {
      const payload = normalized.payload;
      const operation = payload.mode === 'absolute'
        ? `=${payload.newValue}`
        : payload.change >= 0
          ? `+=${payload.change}`
          : `-=${Math.abs(payload.change)}`;
      return `${patch.type}: playerResources.${payload.resource}${operation} · ${patch.reason}`;
    }
  }

  return `${patch.type}: ${patch.reason}`;
}

function applySinglePatch(
  newState: RuntimeState,
  patch: StatePatch,
  options: ApplyPatchOptions,
): boolean {
  const normalizedPatch = normalizeStatePatchContract(normalizeLuanShiCommandPatch(patch));
  switch (normalizedPatch.type) {
    case 'timeAdvance': {
      advanceRuntimeClock(newState, normalizeTimeAdvancePayload(normalizedPatch.payload));
      break;
    }
    case 'locationChange': {
      const toLocationId = optionalPayloadString(normalizedPatch.payload.toLocationId);
      const toSceneId = optionalPayloadString(normalizedPatch.payload.toSceneId);
      if (toLocationId) {
        const previousPlaceId = newState.currentPlaceId ?? newState.currentLocationId;
        const previousSceneId = newState.currentSceneId;
        const changedScene = toLocationId !== previousPlaceId || toSceneId !== previousSceneId;
        if (changedScene && newState.npcs) {
          newState.npcs = newState.npcs.map((npc) => (
            npc.isPresent ? { ...npc, isPresent: false } : npc
          ));
        }
        newState.currentLocationId = toLocationId;
        newState.currentPlaceId = toLocationId;
        newState.currentSceneId = toSceneId;
      }
      break;
    }
    case 'actorDiscovered': {
      const actor: Actor = {
        id: (normalizedPatch.payload.actorId as string) ?? uuidv4(),
        name: normalizedPatch.payload.name as string,
        roleType: (normalizedPatch.payload.roleType as string) ?? '平民',
        factionId: normalizedPatch.payload.factionId as string | undefined,
        locationId: (normalizedPatch.payload.locationId as string) ?? newState.currentLocationId,
        socialClass: normalizedPatch.payload.socialClass as string | undefined,
        summary: (normalizedPatch.payload.summary as string) ?? '',
        relationshipWithPlayer: normalizedPatch.payload.relationshipWithPlayer as string | undefined,
      };

      // 避免重复添加
      if (!newState.knownActors.find((a) => a.id === actor.id)) {
        newState.knownActors.push(actor);
      }
      break;
    }
    case 'relationshipChange': {
      const result = normalizeRelationshipChangePayload(normalizedPatch.payload);
      if (!result.ok) break;
      const payload = result.payload;
      const existingRel = newState.relationships.find(
        (r) =>
          r.actorId === payload.actorId &&
          r.targetId === payload.targetId &&
          (r.targetKind ?? r.targetType) === payload.targetKind,
      );
      if (existingRel) {
        existingRel.targetKind = payload.targetKind;
        existingRel.targetType = payload.targetKind;
        existingRel.value = payload.value;
        existingRel.type = payload.type ?? existingRel.type;
        existingRel.description = payload.description ?? existingRel.description;
      } else {
        newState.relationships.push({
          id: uuidv4(),
          actorId: payload.actorId,
          targetId: payload.targetId,
          targetKind: payload.targetKind,
          targetType: payload.targetKind,
          type: payload.type ?? '中立',
          value: payload.value,
          description: payload.description ?? '',
        });
      }
      break;
    }
    case 'rumorAdded': {
      newState.knownRumors ??= [];
      const rumor: Rumor = {
        id: (normalizedPatch.payload.rumorId as string) ?? uuidv4(),
        title: optionalPayloadString(normalizedPatch.payload.title),
        content: normalizedPatch.payload.content as string,
        source: (normalizedPatch.payload.source as string) ?? '未知来源',
        signalType: parseRumorSignalType(normalizedPatch.payload.signalType),
        confidence: parseRumorConfidence(normalizedPatch.payload.confidence),
        potentialOutcomeSummary: optionalPayloadString(normalizedPatch.payload.potentialOutcomeSummary),
        consequenceTags: optionalPayloadStringArray(normalizedPatch.payload.consequenceTags),
        affectedNpcIds: optionalPayloadStringArray(normalizedPatch.payload.affectedNpcIds),
        affectedFactionIds: optionalPayloadStringArray(normalizedPatch.payload.affectedFactionIds),
        affectedPlaceIds: optionalPayloadStringArray(normalizedPatch.payload.affectedPlaceIds),
        affectedForceIds: optionalPayloadStringArray(normalizedPatch.payload.affectedForceIds),
        affectedHoldingIds: optionalPayloadStringArray(normalizedPatch.payload.affectedHoldingIds),
        followUpHooks: optionalPayloadStringArray(normalizedPatch.payload.followUpHooks),
        severity: parseQuestSeverity(normalizedPatch.payload.severity),
        relatedLocationIds: optionalPayloadStringArray(normalizedPatch.payload.relatedLocationIds),
        relatedRegionId: normalizedPatch.payload.relatedRegionId as string | undefined,
        relatedFactionId: normalizedPatch.payload.relatedFactionId as string | undefined,
        relatedActorId: normalizedPatch.payload.relatedActorId as string | undefined,
        npcAwarenessRefs: normalizeNpcAwarenessRefs(normalizedPatch.payload.npcAwarenessRefs),
        threadId: optionalPayloadString(normalizedPatch.payload.threadId),
        expiresAt: optionalPayloadString(normalizedPatch.payload.expiresAt),
        verified: false, // 强制为 false
        createdAt: newState.currentDate,
      };
      const existing = findRumorForPatch(newState.knownRumors, rumor);
      const appliedRumor = existing ?? rumor;
      if (existing) {
        mergeRumorPatch(existing, rumor);
      } else {
        newState.knownRumors.push(rumor);
      }
      for (const ref of appliedRumor.npcAwarenessRefs ?? []) {
        upsertNpcAwareness(newState, ref, {
          sourceType: 'rumor',
          sourceIds: [appliedRumor.id],
        });
      }
      break;
    }
    case 'npcAwarenessRegistered': {
      upsertNpcAwareness(
        newState,
        {
          name: String(normalizedPatch.payload.name ?? ''),
          npcId: optionalPayloadString(normalizedPatch.payload.npcId),
          sourceNote: optionalPayloadString(normalizedPatch.payload.sourceNote),
          contactLevel: optionalPayloadNumber(normalizedPatch.payload.contactLevel),
          historicalImportance: optionalPayloadNumber(normalizedPatch.payload.historicalImportance),
          playerRelevance: optionalPayloadStringArray(normalizedPatch.payload.playerRelevance),
          unresolvedHooks: optionalPayloadStringArray(normalizedPatch.payload.unresolvedHooks),
        },
        {
          sourceType: parseNpcAwarenessSourceType(normalizedPatch.payload.sourceType) ?? 'playerMention',
          sourceIds: normalizeSourceIds(normalizedPatch.payload),
          relationshipStrength: optionalPayloadNumber(normalizedPatch.payload.relationshipStrength),
          knownToPlayer: normalizedPatch.payload.knownToPlayer === false ? false : true,
          archiveVisible: normalizedPatch.payload.archiveVisible === true,
        },
      );
      break;
    }
    case 'npcPresenceUpdated': {
      appendNpcPresenceUpdate(newState, normalizedPatch.payload);
      break;
    }
    case 'questAdded': {
      const quest: Quest = {
        id: (normalizedPatch.payload.questId as string) ?? uuidv4(),
        title: normalizedPatch.payload.title as string,
        description: (normalizedPatch.payload.description as string) ?? '',
        status: 'active',
        giverId: normalizedPatch.payload.giverId as string | undefined,
        targetLocationId: normalizedPatch.payload.targetLocationId as string | undefined,
        source: optionalPayloadString(normalizedPatch.payload.source),
        currentStep: optionalPayloadString(normalizedPatch.payload.currentStep),
        stakes: optionalPayloadString(normalizedPatch.payload.stakes),
        deadlineAt: optionalPayloadString(normalizedPatch.payload.deadlineAt),
        priority: parseQuestPriority(normalizedPatch.payload.priority),
        relatedNpcIds: optionalPayloadStringArray(normalizedPatch.payload.relatedNpcIds),
        relatedLocationIds: optionalPayloadStringArray(normalizedPatch.payload.relatedLocationIds),
        relatedFactionIds: optionalPayloadStringArray(normalizedPatch.payload.relatedFactionIds),
        outcomeSummary: optionalPayloadString(normalizedPatch.payload.outcomeSummary),
        consequenceTags: optionalPayloadStringArray(normalizedPatch.payload.consequenceTags),
        affectedNpcIds: optionalPayloadStringArray(normalizedPatch.payload.affectedNpcIds),
        affectedFactionIds: optionalPayloadStringArray(normalizedPatch.payload.affectedFactionIds),
        affectedPlaceIds: optionalPayloadStringArray(normalizedPatch.payload.affectedPlaceIds),
        affectedForceIds: optionalPayloadStringArray(normalizedPatch.payload.affectedForceIds),
        affectedHoldingIds: optionalPayloadStringArray(normalizedPatch.payload.affectedHoldingIds),
        followUpHooks: optionalPayloadStringArray(normalizedPatch.payload.followUpHooks),
        severity: parseQuestSeverity(normalizedPatch.payload.severity),
        threadId: optionalPayloadString(normalizedPatch.payload.threadId),
        createdAt: newState.currentDate,
        updatedAt: newState.currentDate,
      };
      newState.activeQuests.push(quest);
      break;
    }
    case 'questUpdated': {
      const questId = normalizedPatch.payload.questId as string;
      const quest = newState.activeQuests.find((q) => q.id === questId);
      if (quest) {
        const previousStatus = quest.status;
        const status = parseQuestStatus(normalizedPatch.payload.status);
        if (status) quest.status = status;
        assignPayloadString(quest, 'title', normalizedPatch.payload.title);
        assignPayloadString(quest, 'description', normalizedPatch.payload.description);
        assignPayloadString(quest, 'source', normalizedPatch.payload.source);
        assignPayloadString(quest, 'currentStep', normalizedPatch.payload.currentStep);
        assignPayloadString(quest, 'stakes', normalizedPatch.payload.stakes);
        assignPayloadString(quest, 'deadlineAt', normalizedPatch.payload.deadlineAt);
        assignPayloadString(quest, 'threadId', normalizedPatch.payload.threadId);
        const priority = parseQuestPriority(normalizedPatch.payload.priority);
        if (priority) quest.priority = priority;
        const relatedNpcIds = optionalPayloadStringArray(normalizedPatch.payload.relatedNpcIds);
        if (relatedNpcIds) quest.relatedNpcIds = relatedNpcIds;
        const relatedLocationIds = optionalPayloadStringArray(normalizedPatch.payload.relatedLocationIds);
        if (relatedLocationIds) quest.relatedLocationIds = relatedLocationIds;
        const relatedFactionIds = optionalPayloadStringArray(normalizedPatch.payload.relatedFactionIds);
        if (relatedFactionIds) quest.relatedFactionIds = relatedFactionIds;
        assignPayloadString(quest, 'outcomeSummary', normalizedPatch.payload.outcomeSummary);
        assignPayloadStringArray(quest, 'consequenceTags', normalizedPatch.payload.consequenceTags);
        assignPayloadStringArray(quest, 'affectedNpcIds', normalizedPatch.payload.affectedNpcIds);
        assignPayloadStringArray(quest, 'affectedFactionIds', normalizedPatch.payload.affectedFactionIds);
        assignPayloadStringArray(quest, 'affectedPlaceIds', normalizedPatch.payload.affectedPlaceIds);
        assignPayloadStringArray(quest, 'affectedForceIds', normalizedPatch.payload.affectedForceIds);
        assignPayloadStringArray(quest, 'affectedHoldingIds', normalizedPatch.payload.affectedHoldingIds);
        assignPayloadStringArray(quest, 'followUpHooks', normalizedPatch.payload.followUpHooks);
        const severity = parseQuestSeverity(normalizedPatch.payload.severity);
        if (severity) quest.severity = severity;
        quest.updatedAt = newState.currentDate;
        if (status) {
          synchronizeCurrentMatterLifecycle(quest, newState.currentDate);
          synchronizeNpcBackgroundActivitiesWithCurrentMatters(
            newState.npcs,
            newState.activeQuests,
            newState.currentDate,
          );
        }
        const explicitExperienceReward = normalizedPatch.payload.experienceReward;
        const experienceReward: number | undefined = explicitExperienceReward === undefined
          ? questCompletionExperienceReward(newState.player.level ?? 1, quest.severity)
          : isValidQuestCompletionExperienceReward(explicitExperienceReward)
            ? explicitExperienceReward
            : undefined;
        if (
          status === 'completed'
          && previousStatus !== 'completed'
          && previousStatus !== 'archived'
          && quest.completionExperienceAwarded === undefined
          && experienceReward !== undefined
        ) {
          newState.player = applyPlayerExperience(newState.player, experienceReward, quest.title).player;
          quest.completionExperienceAwarded = experienceReward;
        }
      }
      break;
    }
    case 'resourceChanged': {
      const result = normalizeResourceChangedPayload(normalizedPatch.payload);
      if (!result.ok) return false;
      const payload = result.payload;
      const resolved = resolveResourceChangedValue(
        payload,
        newState.playerResources[payload.resource],
      );
      if (!resolved.ok) return false;
      newState.playerResources[payload.resource] = resolved.value;
      break;
    }
    case 'localSituationChanged': {
      const notes = normalizedPatch.payload.notes;
      if (Array.isArray(notes)) {
        newState.localSituationNotes = [
          ...newState.localSituationNotes,
          ...notes.filter((n): n is string => typeof n === 'string'),
        ];
      } else if (typeof notes === 'string') {
        newState.localSituationNotes.push(notes);
      }
      break;
    }
    case 'luanshiCommand': {
      const command = extractLuanShiCommandFromPatch(normalizedPatch);
      if (command && typeof command === 'object') {
        Object.assign(newState, applyLuanShiCommand(newState, command as LuanShiCommand, {
          openingInitialization: options.openingInitialization,
          pregnancyMode: options.pregnancyMode ?? loadPregnancyModeFromStorage(),
        }));
      }
      break;
    }
  }
  return true;
}

function findRumorForPatch(rumors: Rumor[], rumor: Rumor): Rumor | undefined {
  const exact = rumors.find((item) => item.id === rumor.id);
  if (exact) return exact;

  const threadId = rumor.threadId?.trim();
  if (threadId) {
    const sameThread = rumors.find((item) => {
      if (item.threadId !== threadId) return false;
      return item.status === undefined
        || item.status === 'open'
        || item.status === 'investigating'
        || item.status === 'verified';
    });
    if (sameThread) return sameThread;
  }

  return findReusableRumorBySemantic(rumors, rumor);
}

function mergeRumorPatch(target: Rumor, incoming: Rumor): void {
  const existingId = target.id;
  const existingCreatedAt = target.createdAt;
  for (const [key, value] of Object.entries(incoming)) {
    if (key === 'id' || key === 'createdAt') continue;
    if (value !== undefined && value !== null) {
      (target as unknown as Record<string, unknown>)[key] = value;
    }
  }
  target.id = existingId;
  target.createdAt = existingCreatedAt ?? incoming.createdAt;
}

function optionalPayloadString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalPayloadStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
  return items.length > 0 ? items : undefined;
}

function optionalPayloadNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeNpcAwarenessRefs(value: unknown): NpcAwarenessReference[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs = value.reduce<NpcAwarenessReference[]>((acc, item) => {
    if (!item || typeof item !== 'object') return acc;
    const payload = item as Record<string, unknown>;
    const name = optionalPayloadString(payload.name);
    if (!name) return acc;
    const ref: NpcAwarenessReference = { name };
    const npcId = optionalPayloadString(payload.npcId);
    const sourceNote = optionalPayloadString(payload.sourceNote);
    const contactLevel = optionalPayloadNumber(payload.contactLevel);
    const historicalImportance = optionalPayloadNumber(payload.historicalImportance);
    const playerRelevance = optionalPayloadStringArray(payload.playerRelevance);
    const unresolvedHooks = optionalPayloadStringArray(payload.unresolvedHooks);
    if (npcId) ref.npcId = npcId;
    if (sourceNote) ref.sourceNote = sourceNote;
    if (typeof contactLevel === 'number') ref.contactLevel = contactLevel;
    if (typeof historicalImportance === 'number') ref.historicalImportance = historicalImportance;
    if (playerRelevance) ref.playerRelevance = playerRelevance;
    if (unresolvedHooks) ref.unresolvedHooks = unresolvedHooks;
    acc.push(ref);
    return acc;
  }, []);
  return refs.length > 0 ? refs : undefined;
}

function normalizeSourceIds(payload: Record<string, unknown>): string[] {
  const sourceIds = optionalPayloadStringArray(payload.sourceIds);
  const sourceId = optionalPayloadString(payload.sourceId);
  return uniqueStrings([...(sourceIds ?? []), ...(sourceId ? [sourceId] : [])]);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)));
}

function upsertNpcAwareness(
  state: RuntimeState,
  ref: NpcAwarenessReference,
  options: {
    sourceType: NpcAwarenessSourceType;
    sourceIds: string[];
    relationshipStrength?: number;
    knownToPlayer?: boolean;
    archiveVisible?: boolean;
  },
): void {
  const name = ref.name.trim();
  if (!name) return;

  state.npcAwarenessIndex ??= [];
  const existing = state.npcAwarenessIndex.find((entry) => {
    if (ref.npcId && entry.npcId === ref.npcId) return true;
    return !ref.npcId && entry.name === name;
  });

  if (existing) {
    existing.npcId = existing.npcId ?? ref.npcId;
    existing.sourceType = options.sourceType;
    existing.sourceIds = uniqueStrings([...existing.sourceIds, ...options.sourceIds]);
    existing.contactLevel = Math.max(existing.contactLevel, ref.contactLevel ?? 0);
    existing.relationshipStrength = options.relationshipStrength ?? existing.relationshipStrength;
    existing.historicalImportance = Math.max(existing.historicalImportance ?? 0, ref.historicalImportance ?? 0) || undefined;
    existing.playerRelevance = uniqueStrings([...existing.playerRelevance, ...(ref.playerRelevance ?? [])]);
    existing.unresolvedHooks = uniqueStrings([...(existing.unresolvedHooks ?? []), ...(ref.unresolvedHooks ?? [])]);
    existing.knownToPlayer = options.knownToPlayer ?? existing.knownToPlayer;
    existing.archiveVisible = options.archiveVisible ?? existing.archiveVisible;
    existing.lastMentionedAt = state.currentDate;
    existing.updatedAt = state.currentDate;
    return;
  }

  state.npcAwarenessIndex.push({
    awarenessId: ref.npcId ? `awareness_${ref.npcId}` : uuidv4(),
    npcId: ref.npcId,
    name,
    sourceType: options.sourceType,
    sourceIds: uniqueStrings(options.sourceIds),
    contactLevel: ref.contactLevel ?? 0,
    relationshipStrength: options.relationshipStrength,
    historicalImportance: ref.historicalImportance,
    playerRelevance: uniqueStrings(ref.playerRelevance ?? []),
    lastMentionedAt: state.currentDate,
    unresolvedHooks: uniqueStrings(ref.unresolvedHooks ?? []),
    knownToPlayer: options.knownToPlayer ?? true,
    archiveVisible: options.archiveVisible ?? false,
    updatedAt: state.currentDate,
  });
}

function appendNpcPresenceUpdate(state: RuntimeState, payload: Record<string, unknown>): void {
  const npcId = optionalPayloadString(payload.npcId);
  const npc = npcId ? state.npcs?.find((item) => item.npcId === npcId) : undefined;
  const summary = optionalPayloadString(payload.summary);
  const source = optionalPayloadString(payload.source);
  const kind = parseNpcPresenceKind(payload.kind);
  if (!npc || !summary || !kind) return;

  const update: NpcPresenceUpdate = {
    id: optionalPayloadString(payload.updateId) ?? uuidv4(),
    createdAt: optionalPayloadString(payload.createdAt) ?? state.currentDate,
    kind,
    summary,
    source: source ?? 'unknown',
    certainty: parsePresenceCertainty(payload.certainty),
    relatedWorldTrendIds: optionalPayloadStringArray(payload.relatedWorldTrendIds),
    relatedRumorIds: optionalPayloadStringArray(payload.relatedRumorIds),
    relatedConflictIds: optionalPayloadStringArray(payload.relatedConflictIds),
    readByPlayer: payload.readByPlayer === true,
  };

  npc.presenceUpdates ??= [];
  const index = npc.presenceUpdates.findIndex((item) => item.id === update.id);
  if (index >= 0) {
    npc.presenceUpdates[index] = update;
  } else {
    npc.presenceUpdates.push(update);
  }
  state.npcAwarenessIndex ??= [];
  let awareness = state.npcAwarenessIndex.find((item) => item.npcId === npc.npcId);
  if (!awareness) {
    awareness = {
      awarenessId: `awareness_${npc.npcId}`,
      npcId: npc.npcId,
      name: npc.name,
      sourceType: 'npcProfile',
      sourceIds: [npc.npcId],
      contactLevel: npc.contactLevel,
      playerRelevance: ['presenceUpdate'],
      knownToPlayer: true,
      archiveVisible: true,
      updatedAt: state.currentDate,
    };
    state.npcAwarenessIndex.push(awareness);
  }
  awareness.lastPresenceBeatAt = update.createdAt;
  awareness.cooldownUntil = formatGameClock(advanceGameClock(ensureGameClock(state), { daysAdvanced: 7 }));
  awareness.updatedAt = state.currentDate;
}

function assignPayloadString<T, K extends keyof T>(
  target: T,
  key: K,
  value: unknown,
): void {
  const next = optionalPayloadString(value);
  if (next) {
    (target as Record<string, unknown>)[String(key)] = next;
  }
}

function assignPayloadStringArray<T, K extends keyof T>(
  target: T,
  key: K,
  value: unknown,
): void {
  const next = optionalPayloadStringArray(value);
  if (next) {
    (target as Record<string, unknown>)[String(key)] = next;
  }
}

function parseQuestPriority(value: unknown): Quest['priority'] | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function parseQuestSeverity(value: unknown): Quest['severity'] | undefined {
  return value === 'minor' || value === 'moderate' || value === 'major' || value === 'critical'
    ? value
    : undefined;
}

function parseRumorSignalType(value: unknown): Rumor['signalType'] | undefined {
  return value === 'rumor' || value === 'clue' || value === 'report' || value === 'omen'
    ? value
    : undefined;
}

function parseRumorConfidence(value: unknown): Rumor['confidence'] | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function parseNpcAwarenessSourceType(value: unknown): NpcAwarenessSourceType | undefined {
  return value === 'npcProfile'
    || value === 'rumor'
    || value === 'worldTrend'
    || value === 'currentMatter'
    || value === 'memory'
    || value === 'playerMention'
    || value === 'conflict'
    ? value
    : undefined;
}

function parseNpcPresenceKind(value: unknown): NpcPresenceUpdate['kind'] | undefined {
  return value === 'rumor'
    || value === 'letter'
    || value === 'envoy'
    || value === 'sighting'
    || value === 'publicEvent'
    || value === 'absence'
    ? value
    : undefined;
}

function parsePresenceCertainty(value: unknown): NpcPresenceUpdate['certainty'] | undefined {
  return value === 'confirmed' || value === 'reported' || value === 'rumor' || value === 'uncertain'
    ? value
    : undefined;
}

function parseQuestStatus(value: unknown): Quest['status'] | undefined {
  return value === 'active' || value === 'completed' || value === 'failed' || value === 'invalidated'
    ? value
    : undefined;
}

function normalizeTimeAdvancePayload(payload: Record<string, unknown>): GameClockAdvance {
  const advance: GameClockAdvance = {};
  if (typeof payload.minutesAdvanced === 'number') advance.minutesAdvanced = payload.minutesAdvanced;
  if (typeof payload.hoursAdvanced === 'number') advance.hoursAdvanced = payload.hoursAdvanced;
  if (typeof payload.daysAdvanced === 'number') advance.daysAdvanced = payload.daysAdvanced;
  if (typeof payload.timeBlocksAdvanced === 'number') advance.timeBlocksAdvanced = payload.timeBlocksAdvanced;

  const hasExplicitAdvance =
    advance.minutesAdvanced !== undefined
    || advance.hoursAdvanced !== undefined
    || advance.daysAdvanced !== undefined
    || advance.timeBlocksAdvanced !== undefined;

  return hasExplicitAdvance ? advance : { minutesAdvanced: 0 };
}
