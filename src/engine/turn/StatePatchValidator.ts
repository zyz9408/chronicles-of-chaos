// ============================================================
// Engine - StatePatchValidator
// 校验 StatePatch 是否在允许范围内
// ============================================================

import type { HoldingLedgerEntry, RuntimeState, StatePatch, PatchValidationResult, PatchType, WorldBook } from '../types';
import { buildMapV1Index, isStandableMapNode } from '../map/mapV1';
import { buildRuntimeMapIndex, getWorldBookMapRoots } from '../map/runtimeMap';
import {
  ensureLuanShiState,
  findExistingHoldingByLedgerIdentity,
  resolveCanonicalHoldingId,
} from '../state/createInitialRuntimeState';
import { validateLuanShiCommand, type HoldingLedgerUpsertCommand, type LuanShiCommand } from '../state/luanshiCommands';
import { extractLuanShiCommandFromPatch, normalizeLuanShiCommandPatch } from './LuanShiCommandPatch';
import {
  isValidQuestCompletionExperienceReward,
  MAX_QUEST_COMPLETION_EXPERIENCE_REWARD,
} from '../character/progression';
import {
  normalizeRelationshipChangePayload,
  normalizeResourceChangedPayload,
  normalizeStatePatchContract,
  resolveResourceChangedValue,
} from './StatePatchContract';
import {
  mergeHoldingCivilAdministrationTransition,
  normalizeLegacyHoldingCivilAdministration,
} from '../holdings/HoldingCivilAdministration';

const MAX_TIME_ADVANCE_DAYS = 365;

/** 第一阶段允许的 patch 类型白名单 */
const ALLOWED_PATCH_TYPES: PatchType[] = [
  'timeAdvance',
  'locationChange',
  'actorDiscovered',
  'relationshipChange',
  'rumorAdded',
  'npcAwarenessRegistered',
  'npcPresenceUpdated',
  'questAdded',
  'questUpdated',
  'resourceChanged',
  'localSituationChanged',
  'luanshiCommand',
];

export function isAllowedPatchType(type: string): type is PatchType {
  return ALLOWED_PATCH_TYPES.includes(type as PatchType);
}

const DIRECT_STRUCTURED_PRIVILEGE_KEYS = new Set([
  'officeTitle',
  'militaryTitle',
  'nobleTitle',
  'militaryPower',
  'armyControl',
  'troopControl',
  'troops',
  'cityControl',
  'territory',
  'fief',
  'landGrant',
  'directGrant',
  'grant',
  '官职',
  '官位',
  '兵权',
  '城池',
  '封地',
]);

const QUEST_STATUSES = new Set(['active', 'completed', 'failed', 'invalidated']);
const QUEST_PRIORITIES = new Set(['low', 'medium', 'high']);
const QUEST_SEVERITIES = new Set(['minor', 'moderate', 'major', 'critical']);
const RUMOR_SIGNAL_TYPES = new Set(['rumor', 'clue', 'report', 'omen']);
const RUMOR_CONFIDENCES = new Set(['low', 'medium', 'high']);
const NPC_AWARENESS_SOURCE_TYPES = new Set(['npcProfile', 'rumor', 'worldTrend', 'currentMatter', 'memory', 'playerMention', 'conflict']);
const NPC_PRESENCE_KINDS = new Set(['rumor', 'letter', 'envoy', 'sighting', 'publicEvent', 'absence']);
const CONTEXT_INDEPENDENT_LUANSHI_COMMANDS = new Set([
  'updateResourceLedger',
  'updateCharacterIdentity',
  'updatePlayerLoadout',
  'upsertFactionLedger',
  'upsertTroopLedger',
  'upsertConflictRecord',
  'upsertCombatRecord',
  'updateCharacterReputation',
  'upsertNpcProfile',
]);

/**
 * 校验 StatePatch
 */
export function validatePatch(
  patch: StatePatch,
  worldBook: WorldBook,
  knownQuestIds: string[],
  runtimeState?: RuntimeState,
): PatchValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Global restrictions inspect the raw payload so contract canonicalization cannot discard forbidden writes.
  validateRawPayloadGlobalRestrictions(patch, errors);
  const normalizedPatch = normalizeStatePatchContract(normalizeLuanShiCommandPatch(patch));

  // 1. patch 类型是否在白名单内
  if (!isAllowedPatchType(normalizedPatch.type)) {
    errors.push(`不允许的 patch 类型：${patch.type}。允许的类型：${ALLOWED_PATCH_TYPES.join(', ')}`);
    return { valid: false, errors, warnings };
  }

  // 2. 类型特定校验
  switch (normalizedPatch.type) {
    case 'locationChange':
      validateLocationChange(normalizedPatch, worldBook, runtimeState, errors, warnings);
      break;
    case 'resourceChanged':
      validateResourceChanged(normalizedPatch, runtimeState, errors, warnings);
      break;
    case 'relationshipChange':
      validateRelationshipChange(normalizedPatch, errors, warnings);
      break;
    case 'questUpdated':
      validateQuestUpdated(normalizedPatch, knownQuestIds, runtimeState, errors, warnings);
      break;
    case 'rumorAdded':
      validateRumorAdded(normalizedPatch, errors, warnings);
      break;
    case 'npcAwarenessRegistered':
      validateNpcAwarenessRegistered(normalizedPatch, errors);
      break;
    case 'npcPresenceUpdated':
      validateNpcPresenceUpdated(normalizedPatch, errors);
      break;
    case 'actorDiscovered':
      validateActorDiscovered(normalizedPatch, errors, warnings);
      break;
    case 'timeAdvance':
      validateTimeAdvance(normalizedPatch, errors, warnings);
      break;
    case 'questAdded':
      validateQuestAdded(normalizedPatch, errors);
      break;
    case 'localSituationChanged':
      // 这些类型相对安全，不需要额外校验
      break;
    case 'luanshiCommand':
      validateLuanShiCommandPatch(normalizedPatch, worldBook, runtimeState, errors, warnings);
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateRawPayloadGlobalRestrictions(
  patch: StatePatch,
  errors: string[],
): void {
  const semanticPayloads = collectRawSemanticPayloads(patch);
  if (semanticPayloads.some(({ payload }) => 'wholeWorldState' in payload)) {
    errors.push('不允许通过 patch 直接修改 wholeWorldState');
  }
  validateDirectStructuredPrivilegeWrite(patch, semanticPayloads, errors);
}

interface RawSemanticPayload {
  payload: Record<string, unknown>;
  allowsStructuredPrivilegeFields: boolean;
}

function collectRawSemanticPayloads(patch: StatePatch): RawSemanticPayload[] {
  if (!isPayloadRecord(patch.payload)) return [];
  if (patch.type !== 'luanshiCommand') {
    return [{ payload: patch.payload, allowsStructuredPrivilegeFields: false }];
  }

  const normalizedPatch = normalizeLuanShiCommandPatch(patch);
  const allowsStructuredPrivilegeFields = normalizedPatch.type === 'luanshiCommand';
  const payloads: RawSemanticPayload[] = [{
    payload: patch.payload,
    allowsStructuredPrivilegeFields,
  }];
  if (isPayloadRecord(patch.payload.command)) {
    payloads.push({
      payload: patch.payload.command,
      allowsStructuredPrivilegeFields,
    });
  }
  return payloads;
}

function validateQuestAdded(
  patch: StatePatch,
  errors: string[],
): void {
  if (typeof patch.payload?.title !== 'string' || patch.payload.title.trim().length === 0) {
    errors.push('questAdded 必须包含 title。');
  }
  validateQuestCommonFields(patch, errors);
}

function validateDirectStructuredPrivilegeWrite(
  patch: StatePatch,
  semanticPayloads: RawSemanticPayload[],
  errors: string[],
): void {
  const matchedKeys = new Set<string>();
  semanticPayloads.forEach(({ payload, allowsStructuredPrivilegeFields }) => {
    if (allowsStructuredPrivilegeFields) return;
    Object.keys(payload).forEach((key) => {
      if (DIRECT_STRUCTURED_PRIVILEGE_KEYS.has(key)) matchedKeys.add(key);
    });
  });
  if (matchedKeys.size === 0) return;

  errors.push(`结构化权力/地盘写入必须通过 luanshiCommand 或专用写回协议，不允许在 ${patch.type} payload 直接写入：${[...matchedKeys].join(', ')}`);
}

function isPayloadRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateLuanShiCommandPatch(
  patch: StatePatch,
  worldBook: WorldBook,
  runtimeState: RuntimeState | undefined,
  errors: string[],
  warnings: string[],
): void {
  const command = extractLuanShiCommandFromPatch(patch);
  if (!command || typeof command !== 'object') {
    errors.push('luanshiCommand 必须包含 command 对象');
    return;
  }

  const action = (command as { action?: unknown }).action;
  if (typeof action !== 'string' || action.trim().length === 0) {
    errors.push('luanshiCommand.command 必须包含 action');
    return;
  }

  if (!runtimeState && !CONTEXT_INDEPENDENT_LUANSHI_COMMANDS.has(action)) {
    return;
  }

  const validationState = ensureLuanShiState(runtimeState ?? ({} as RuntimeState));
  const runtimeBoundCommand = normalizeDeterministicRuntimeBoundCommand(
    validationState,
    command as LuanShiCommand,
  );
  const commandForValidation = mergeExistingHoldingLedgerCommand(validationState, runtimeBoundCommand);
  const result = validateLuanShiCommand(validationState, commandForValidation);
  errors.push(...result.errors);
  warnings.push(...result.warnings);
  validateTroopLocationReferences(worldBook, validationState, commandForValidation, errors);
}

function validateTroopLocationReferences(
  worldBook: WorldBook,
  state: ReturnType<typeof ensureLuanShiState>,
  command: LuanShiCommand,
  errors: string[],
): void {
  if (command.action !== 'upsertTroopLedger') return;

  const safeWorldBook: WorldBook = {
    ...worldBook,
    mapSeed: Array.isArray(worldBook.mapSeed) ? worldBook.mapSeed : [],
  };
  const knownLocationIds = new Set(Object.keys(buildRuntimeMapIndex(safeWorldBook, state).nodeById));
  for (const location of state.locations ?? []) {
    if (location.locationId?.trim()) knownLocationIds.add(location.locationId.trim());
  }
  for (const locationId of [state.currentLocationId, state.currentPlaceId, state.currentSceneId]) {
    if (locationId?.trim()) knownLocationIds.add(locationId.trim());
  }

  for (const field of ['locationId', 'lastKnownLocationId', 'destinationLocationId'] as const) {
    const locationId = command[field]?.trim();
    if (locationId && !knownLocationIds.has(locationId)) {
      errors.push(
        `upsertTroopLedger.${field} 引用了未登记地点 ${locationId}；请复用地图上下文中的稳定 ID，或在同批 locationWriteSuggestions 中先登记。`,
      );
    }
  }
}

function normalizeDeterministicRuntimeBoundCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: LuanShiCommand,
): LuanShiCommand {
  if (command.action === 'recordTurnEvent') {
    const knownNpcIds = new Set(state.npcs.map((npc) => npc.npcId));
    return {
      ...command,
      ...(Array.isArray(command.presentNpcIds)
        ? { presentNpcIds: command.presentNpcIds.filter((npcId) => knownNpcIds.has(npcId)) }
        : {}),
      ...(Array.isArray(command.involvedNpcIds)
        ? { involvedNpcIds: command.involvedNpcIds.filter((npcId) => knownNpcIds.has(npcId)) }
        : {}),
    };
  }

  if (command.action === 'updateCharacterUniqueArts' && command.characterType === 'player') {
    return {
      ...command,
      characterId: state.player.id,
      characterName: state.player.name,
    };
  }

  return command;
}

function mergeExistingHoldingLedgerCommand(
  state: ReturnType<typeof ensureLuanShiState>,
  command: LuanShiCommand,
): LuanShiCommand {
  if (command.action !== 'upsertHoldingLedger') return command;

  const incoming = command as Partial<HoldingLedgerUpsertCommand> & { action: 'upsertHoldingLedger' };
  const holdingId = typeof incoming.holdingId === 'string' ? incoming.holdingId.trim() : '';
  if (!holdingId) return command;

  const previous = findExistingHoldingByLedgerIdentity(state.holdings, {
    holdingId,
    name: resolveValidationText(incoming.name, ''),
    type: incoming.type,
    locationId: typeof incoming.locationId === 'string' ? incoming.locationId : undefined,
  } as HoldingLedgerUpsertCommand);
  if (!previous) return command;
  const canonicalHoldingId = resolveCanonicalHoldingId(previous, {
    holdingId,
    type: incoming.type ?? previous.type,
    locationId: typeof incoming.locationId === 'string' ? incoming.locationId : previous.locationId,
  } as HoldingLedgerUpsertCommand);

  const merged = {
    ...normalizeLegacyHoldingCivilAdministration(previous),
    ...incoming,
    action: 'upsertHoldingLedger',
    holdingId: canonicalHoldingId,
    name: resolveValidationText(incoming.name, previous.name),
    summary: resolveValidationText(incoming.summary, previous.summary),
    updatedAt: resolveValidationText(incoming.updatedAt, previous.updatedAt),
  } as HoldingLedgerUpsertCommand;
  return mergeHoldingCivilAdministrationTransition(
    previous,
    incoming,
    merged as unknown as HoldingLedgerEntry,
  ) as HoldingLedgerUpsertCommand;
}

function resolveValidationText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function validateLocationChange(
  patch: StatePatch,
  worldBook: WorldBook,
  runtimeState: RuntimeState | undefined,
  errors: string[],
  _warnings: string[],
): void {
  const toLocationId = patch.payload?.toLocationId as string | undefined;
  if (!toLocationId) {
    errors.push('locationChange 必须包含 toLocationId');
    return;
  }

  const index = runtimeState
    ? buildRuntimeMapIndex(worldBook, runtimeState)
    : buildMapV1Index(getWorldBookMapRoots(worldBook));
  const target = index.nodeById[toLocationId];
  if (!target) {
    errors.push(`locationChange.toLocationId target does not exist in current map: ${toLocationId}`);
    return;
  }

  if (!isStandableMapNode(target)) {
    errors.push(`locationChange.toLocationId must be a concrete place ID, not a region or scene: ${toLocationId}`);
  }

  const toSceneId = patch.payload?.toSceneId as string | undefined;
  if (!toSceneId) return;

  const scene = index.nodeById[toSceneId];
  if (!scene) {
    errors.push(`locationChange.toSceneId scene does not exist in current map: ${toSceneId}`);
    return;
  }

  if (scene.mapLayer !== 'scene') {
    errors.push(`locationChange.toSceneId must reference a scene: ${toSceneId}`);
  }

  if (index.parentIdByNodeId[toSceneId] !== toLocationId) {
    errors.push(`locationChange.toSceneId must be a scene under toLocationId: ${toSceneId}`);
  }
}

function validateResourceChanged(
  patch: StatePatch,
  runtimeState: RuntimeState | undefined,
  errors: string[],
  _warnings: string[],
): void {
  const result = normalizeResourceChangedPayload(patch.payload);
  if (!result.ok) {
    errors.push(result.error);
    return;
  }

  const resolved = resolveResourceChangedValue(
    result.payload,
    runtimeState?.playerResources[result.payload.resource],
  );
  if (!resolved.ok) errors.push(resolved.error);
}

function validateRelationshipChange(
  patch: StatePatch,
  errors: string[],
  _warnings: string[],
): void {
  const result = normalizeRelationshipChangePayload(patch.payload);
  if (!result.ok) errors.push(result.error);
}

function validateQuestUpdated(
  patch: StatePatch,
  knownQuestIds: string[],
  runtimeState: RuntimeState | undefined,
  errors: string[],
  _warnings: string[],
): void {
  const questId = patch.payload?.questId as string | undefined;
  if (!questId) {
    errors.push('questUpdated 必须引用 questId');
    return;
  }

  if (!knownQuestIds.includes(questId)) {
    errors.push(`questUpdated 引用的 questId "${questId}" 不在已知任务列表中`);
  }

  const experienceReward = patch.payload?.experienceReward;
  if (experienceReward !== undefined) {
    if (patch.payload?.status !== 'completed') {
      errors.push('questUpdated.experienceReward 仅可用于 status=completed 的首次完成写回。');
    }
    if (!isValidQuestCompletionExperienceReward(experienceReward)) {
      errors.push(
        `questUpdated.experienceReward 必须是 1-${MAX_QUEST_COMPLETION_EXPERIENCE_REWARD} 的 finite integer。`,
      );
    }
    const quest = runtimeState?.activeQuests.find((entry) => entry.id === questId);
    if (!runtimeState) {
      errors.push('questUpdated.experienceReward 需要当前状态以确认首次完成。');
    } else if (!quest) {
      errors.push(`questUpdated.experienceReward 找不到 questId "${questId}" 的当前事项。`);
    } else if (
      quest.status === 'completed'
      || quest.status === 'archived'
      || quest.completionExperienceAwarded !== undefined
    ) {
      errors.push('questUpdated.experienceReward 不得对已完成或已归档事项重复发奖。');
    }
  }

  validateQuestCommonFields(patch, errors);
}

function validateQuestCommonFields(
  patch: StatePatch,
  errors: string[],
): void {
  const status = patch.payload?.status;
  if (status !== undefined && !QUEST_STATUSES.has(String(status))) {
    errors.push('quest status 必须是 active/completed/failed/invalidated。');
  }

  const priority = patch.payload?.priority;
  if (priority !== undefined && !QUEST_PRIORITIES.has(String(priority))) {
    errors.push('quest priority 必须是 low/medium/high。');
  }

  const severity = patch.payload?.severity;
  if (severity !== undefined && !QUEST_SEVERITIES.has(String(severity))) {
    errors.push('quest severity 必须是 minor/moderate/major/critical。');
  }

  for (const key of [
    'relatedNpcIds',
    'relatedLocationIds',
    'relatedFactionIds',
    'consequenceTags',
    'affectedNpcIds',
    'affectedFactionIds',
    'affectedPlaceIds',
    'affectedForceIds',
    'affectedHoldingIds',
    'followUpHooks',
  ] as const) {
    const value = patch.payload?.[key];
    if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0))) {
      errors.push(`quest.${key} 必须是非空字符串数组。`);
    }
  }
}

function validateRumorAdded(
  patch: StatePatch,
  errors: string[],
  _warnings: string[],
): void {
  if (!isPayloadRecord(patch.payload)) {
    errors.push('rumorAdded.payload 必须是对象');
    return;
  }

  const payload = patch.payload;
  const verified = payload.verified;
  if (verified === true || verified === 'true') {
    errors.push('rumorAdded 必须标记为 rumor/unverified，不得自动变成 fact');
  }

  if (!payload.content) {
    errors.push('rumorAdded 必须包含传闻内容');
  }

  const signalType = payload.signalType;
  if (signalType !== undefined && !RUMOR_SIGNAL_TYPES.has(String(signalType))) {
    errors.push('rumor signalType 必须是 rumor/clue/report/omen。');
  }

  const confidence = payload.confidence;
  if (confidence !== undefined && !RUMOR_CONFIDENCES.has(String(confidence))) {
    errors.push('rumor confidence 必须是 low/medium/high。');
  }

  const severity = payload.severity;
  if (severity !== undefined && !QUEST_SEVERITIES.has(String(severity))) {
    errors.push('rumor severity 必须是 minor/moderate/major/critical。');
  }

  for (const key of [
    'relatedLocationIds',
    'consequenceTags',
    'affectedNpcIds',
    'affectedFactionIds',
    'affectedPlaceIds',
    'affectedForceIds',
    'affectedHoldingIds',
    'followUpHooks',
  ] as const) {
    const value = payload[key];
    if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0))) {
      errors.push(`rumor.${key} 必须是非空字符串数组。`);
    }
  }

  validateNpcAwarenessRefs(payload.npcAwarenessRefs, 'rumor.npcAwarenessRefs', errors);
}

function validateNpcAwarenessRegistered(
  patch: StatePatch,
  errors: string[],
): void {
  if (typeof patch.payload?.name !== 'string' || patch.payload.name.trim().length === 0) {
    errors.push('npcAwarenessRegistered 必须包含 name。');
  }

  if (!NPC_AWARENESS_SOURCE_TYPES.has(String(patch.payload?.sourceType))) {
    errors.push('npcAwarenessRegistered sourceType 必须是有效来源类型。');
  }

  const sourceId = patch.payload?.sourceId;
  const sourceIds = patch.payload?.sourceIds;
  const hasSourceId = typeof sourceId === 'string' && sourceId.trim().length > 0;
  const hasSourceIds = Array.isArray(sourceIds)
    && sourceIds.some((item) => typeof item === 'string' && item.trim().length > 0);
  if (!hasSourceId && !hasSourceIds) {
    errors.push('npcAwarenessRegistered 必须包含 sourceId 或 sourceIds。');
  }

  validateOptionalNumber(patch.payload?.contactLevel, 'npcAwarenessRegistered contactLevel', errors);
  validateOptionalNumber(patch.payload?.relationshipStrength, 'npcAwarenessRegistered relationshipStrength', errors);
  validateOptionalNumber(patch.payload?.historicalImportance, 'npcAwarenessRegistered historicalImportance', errors);
  validateOptionalStringArray(patch.payload?.playerRelevance, 'npcAwarenessRegistered.playerRelevance', errors);
  validateOptionalStringArray(patch.payload?.unresolvedHooks, 'npcAwarenessRegistered.unresolvedHooks', errors);
}

function validateNpcPresenceUpdated(
  patch: StatePatch,
  errors: string[],
): void {
  if (typeof patch.payload?.npcId !== 'string' || patch.payload.npcId.trim().length === 0) {
    errors.push('npcPresenceUpdated 必须包含 npcId。');
  }

  if (!NPC_PRESENCE_KINDS.has(String(patch.payload?.kind))) {
    errors.push('npcPresenceUpdated kind 必须是有效近况类型。');
  }

  if (typeof patch.payload?.summary !== 'string' || patch.payload.summary.trim().length === 0) {
    errors.push('npcPresenceUpdated 必须包含 summary。');
  }

  validateOptionalStringArray(patch.payload?.relatedWorldTrendIds, 'npcPresenceUpdated.relatedWorldTrendIds', errors);
  validateOptionalStringArray(patch.payload?.relatedRumorIds, 'npcPresenceUpdated.relatedRumorIds', errors);
  validateOptionalStringArray(patch.payload?.relatedConflictIds, 'npcPresenceUpdated.relatedConflictIds', errors);
}

function validateNpcAwarenessRefs(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${label} 必须是数组。`);
    return;
  }

  value.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`${label}[${index}] 必须是对象。`);
      return;
    }
    const ref = item as Record<string, unknown>;
    if (typeof ref.name !== 'string' || ref.name.trim().length === 0) {
      errors.push(`${label}[${index}].name 必须是非空字符串。`);
    }
    if (ref.npcId !== undefined && (typeof ref.npcId !== 'string' || ref.npcId.trim().length === 0)) {
      errors.push(`${label}[${index}].npcId 必须是非空字符串。`);
    }
    validateOptionalNumber(ref.contactLevel, `${label}[${index}].contactLevel`, errors);
    validateOptionalNumber(ref.historicalImportance, `${label}[${index}].historicalImportance`, errors);
    validateOptionalStringArray(ref.playerRelevance, `${label}[${index}].playerRelevance`, errors);
    validateOptionalStringArray(ref.unresolvedHooks, `${label}[${index}].unresolvedHooks`, errors);
  });
}

function validateOptionalNumber(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
    errors.push(`${label} 必须是数字。`);
  }
}

function validateOptionalStringArray(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0))) {
    errors.push(`${label} 必须是非空字符串数组。`);
  }
}

function validateActorDiscovered(
  patch: StatePatch,
  errors: string[],
  _warnings: string[],
): void {
  if (!patch.payload?.name) {
    errors.push('actorDiscovered 必须包含人物名称');
  }
}

function validateTimeAdvance(
  patch: StatePatch,
  errors: string[],
  _warnings: string[],
): void {
  const hasExplicitAdvance =
    patch.payload?.minutesAdvanced !== undefined
    || patch.payload?.hoursAdvanced !== undefined
    || patch.payload?.daysAdvanced !== undefined
    || patch.payload?.timeBlocksAdvanced !== undefined;

  if (!hasExplicitAdvance) {
    errors.push('timeAdvance 必须包含明确的经过时间字段：minutesAdvanced、hoursAdvanced、daysAdvanced 或 timeBlocksAdvanced');
  }

  const days = patch.payload?.daysAdvanced;
  if (days !== undefined && (typeof days !== 'number' || days <= 0 || days > MAX_TIME_ADVANCE_DAYS)) {
    errors.push(`timeAdvance 的 daysAdvanced 必须在 1 到 ${MAX_TIME_ADVANCE_DAYS} 之间`);
  }

  const hours = patch.payload?.hoursAdvanced;
  if (hours !== undefined && (typeof hours !== 'number' || hours <= 0 || hours > 72)) {
    errors.push('timeAdvance 的 hoursAdvanced 必须在 1 到 72 之间');
  }

  const minutes = patch.payload?.minutesAdvanced;
  if (minutes !== undefined && (typeof minutes !== 'number' || minutes <= 0 || minutes > 4320)) {
    errors.push('timeAdvance 的 minutesAdvanced 必须在 1 到 4320 之间');
  }

  const timeBlocks = patch.payload?.timeBlocksAdvanced;
  if (timeBlocks !== undefined && (typeof timeBlocks !== 'number' || timeBlocks <= 0 || timeBlocks > 36)) {
    errors.push('timeAdvance 的 timeBlocksAdvanced 必须在 1 到 36 之间');
  }
}
