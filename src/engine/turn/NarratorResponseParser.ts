import type {
  CharacterUniqueArt,
  CorrespondenceCommitmentDeliverable,
  LuanShiNpcAdultPrivateProfile,
  LuanShiNpcFemaleProfile,
  LuanShiNpcRelationshipNetworkEntry,
  LuanShiNpcWombProfile,
  NpcAwarenessReference,
  NpcProfilePersistenceReason,
  StatePatch,
  SuggestedAction,
} from '../types';
import type {
  NarratorLocationWriteSuggestion,
  NarratorNpcMemorySuggestion,
  NarratorNpcProfileSuggestion,
  NarratorPlotPlanSuggestion,
  NarratorProtagonistMemoryWriteback,
  NarratorProtagonistProfileWriteback,
  NarratorQuestChangeSuggestion,
  NarratorRouteWriteSuggestion,
  NarratorResponse,
  NarratorSignalChangeSuggestion,
  NarratorTurnSummaryWriteback,
  NarratorWorldEventSummary,
  NarratorWorldEventUpdate,
  NarratorWritebackProtocol,
} from './MockNarrator';
import type { TurnJudgementDetail, TurnOrdinaryCheck } from '../types';
import { PERSONAL_ESCORT_ENTITLEMENT_BASES } from '../types';
import { preserveEquipmentCandidate, preserveInventoryCandidate } from '../character/loadoutProtocol';
import type {
  EncounterStartIntent,
  EncounterTransitionDecision,
  SemanticProjection,
} from '../encounterV2/EncounterContracts';
import {
  validateEncounterStartIntent,
  validateSemanticProjection,
} from '../encounterV2/EncounterContractValidation';
import { parsePlayerRecoveryKind } from '../character/PlayerRecoveryContracts';
import { normalizeCharacterTraits } from '../character/CharacterTraitNormalization';

export const NPC_PROFILE_EXPLICIT_IS_FOCUSED = Symbol('npcProfileExplicitIsFocused');

export interface ParseNarratorResponseOptions {
  /**
   * Encounter audit metadata is owned by the local turn pipeline. When supplied,
   * never trust the model to reproduce or reinterpret this wall-clock value.
   */
  encounterIntentCreatedAt?: string;
  /** Encounter source turn is likewise owned by the local atomic turn pipeline. */
  encounterIntentSourceTurnNumber?: number;
  /**
   * Stable local correspondence identities used only to normalize a reply whose
   * direction/NPC role was abbreviated by the model. The parser never infers a
   * correspondent from prose.
   */
  correspondenceSources?: ReadonlyArray<{
    letterId: string;
    direction: 'incoming' | 'outgoing';
    npcId: string;
  }>;
}

export function parseNarratorResponse(
  content: string,
  options: ParseNarratorResponseOptions = {},
): NarratorResponse {
  const trimmed = content.trim();
  const jsonText = extractJsonText(trimmed);

  if (!jsonText) {
    return plainTextResponse(trimmed);
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!isRecord(parsed) || typeof parsed.narrativeText !== 'string') {
      return plainTextResponse(trimmed);
    }

    const response: NarratorResponse = {
      protocolVersion: typeof parsed.protocolVersion === 'string' ? parsed.protocolVersion : undefined,
      narrativeText: sanitizeNarrativeText(parsed.narrativeText),
      suggestedActions: parseSuggestedActions(parsed.suggestedActions),
      ordinaryChecks: parseOrdinaryChecks(parsed.ordinaryChecks),
      statePatches: parseStatePatches(parsed.statePatches),
      statePatch: parseStatePatch(parsed.statePatch),
    };
    const writeback = parseWriteback(parsed.writeback, options);
    if (writeback) {
      response.writeback = writeback;
    }
    return response;
  } catch {
    return plainTextResponse(trimmed);
  }
}

function extractJsonText(content: string): string | null {
  const completeCandidate = content.trim();
  if (completeCandidate.startsWith('{') && completeCandidate.endsWith('}')) {
    return completeCandidate;
  }

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? content).trim();
  if (!candidate) return null;
  if (candidate.startsWith('{') && candidate.endsWith('}')) return candidate;

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

function sanitizeNarrativeText(value: string): string {
  const text = value;
  const leakStarts = [
    text.search(/```json\b[\s\S]*?(?:"statePatches"\s*:|"writeback"\s*:)/i),
    text.search(/\{[\s\S]*?(?:"statePatches"\s*:|"writeback"\s*:)[\s\S]*$/i),
    text.search(/(?:^|\r?\n)\s*"(?:statePatches|writeback)"\s*:/i),
  ].filter((index) => index >= 0);
  if (leakStarts.length === 0) return value;

  const cleanNarrative = text.slice(0, Math.min(...leakStarts)).trim();
  return cleanNarrative || '模型没有返回可展示的正文。';
}

function parseSuggestedActions(value: unknown): SuggestedAction[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): SuggestedAction | null => {
      if (!isRecord(item) || typeof item.label !== 'string') return null;
      return {
        label: item.label,
        description: typeof item.description === 'string' ? item.description : '',
        actionType: typeof item.actionType === 'string' ? item.actionType : 'other',
      };
    })
    .filter((item): item is SuggestedAction => item !== null);
}

function parseOrdinaryChecks(value: unknown): TurnOrdinaryCheck[] | undefined {
  const checks = parseArray(value, parseOrdinaryCheck);
  return checks.length > 0 ? checks : undefined;
}

function parseOrdinaryCheck(value: unknown): TurnOrdinaryCheck | null {
  if (
    !isRecord(value)
    || typeof value.checkId !== 'string'
    || typeof value.label !== 'string'
    || typeof value.result !== 'string'
  ) {
    return null;
  }

  const check: TurnOrdinaryCheck = {
    checkId: value.checkId.trim(),
    label: value.label.trim(),
    result: value.result.trim(),
  };
  if (!check.checkId || !check.label || !check.result) return null;

  const target = parseNullableString(value.target);
  if (target !== undefined && target !== null) check.target = target;

  const ability = parseNullableString(value.ability);
  if (ability !== undefined && ability !== null) check.ability = ability;

  const difficulty = parseOptionalNumber(value.difficulty);
  if (difficulty !== undefined) check.difficulty = difficulty;

  const total = parseOptionalNumber(value.total);
  if (total !== undefined) check.total = total;

  const summary = parseNullableString(value.summary);
  if (summary !== undefined && summary !== null) check.summary = summary;

  const details = parseArray(value.details, parseJudgementDetail);
  if (details.length > 0) check.details = details;

  const tags = parseStringArray(value.tags).map((tag) => tag.trim()).filter(Boolean);
  if (tags.length > 0) check.tags = tags;

  return check;
}

function parseJudgementDetail(value: unknown): TurnJudgementDetail | null {
  if (!isRecord(value) || typeof value.label !== 'string') return null;
  const detail: TurnJudgementDetail = {
    label: value.label.trim(),
  };
  if (!detail.label) return null;

  const numericValue = parseOptionalNumber(value.value);
  if (numericValue !== undefined) detail.value = numericValue;

  const text = parseNullableString(value.text);
  if (text !== undefined && text !== null) detail.text = text;

  if (detail.value === undefined && !detail.text) return null;
  return detail;
}

function parseStatePatch(value: unknown): StatePatch | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;

  return {
    type: value.type as StatePatch['type'],
    payload: isRecord(value.payload) ? value.payload : {},
    reason: typeof value.reason === 'string' ? value.reason : 'LLM 生成状态变更',
  };
}

function parseStatePatches(value: unknown): StatePatch[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const patches = value
    .map(parseStatePatch)
    .filter((patch): patch is StatePatch => patch !== null);

  return patches.length > 0 ? patches : undefined;
}

function parseWriteback(
  value: unknown,
  options: ParseNarratorResponseOptions,
): NarratorWritebackProtocol | undefined {
  if (!isRecord(value)) return undefined;

  const encounterIntent = parseEncounterStartIntent(
    value.encounterStartIntent,
    options.encounterIntentCreatedAt,
    options.encounterIntentSourceTurnNumber,
  );
  const encounterTransition = parseEncounterTransitionDecision(
    value.encounterTransitionDecision,
    encounterIntent.value,
  );
  const semanticProjections = parseSemanticProjections(value.semanticProjections);

  return {
    turnSummary: parseTurnSummary(value.turnSummary, options),
    protagonistProfile: parseProtagonistProfile(value.protagonistProfile),
    protagonistMemory: parseProtagonistMemory(value.protagonistMemory),
    npcProfileSuggestions: parseArray(value.npcProfileSuggestions, parseNpcProfileSuggestion),
    npcMemorySuggestions: parseArray(value.npcMemorySuggestions, parseNpcMemorySuggestion),
    factionRecentActionSuggestions: parseArray(
      value.factionRecentActionSuggestions,
      parseFactionRecentActionSuggestion,
    ),
    locationWriteSuggestions: parseArray(value.locationWriteSuggestions, parseLocationWriteSuggestion),
    routeWriteSuggestions: parseArray(value.routeWriteSuggestions, parseRouteWriteSuggestion),
    questChanges: parseArray(value.questChanges, parseQuestChangeSuggestion),
    signalChanges: parseArray(value.signalChanges, parseSignalChangeSuggestion),
    plotPlanSuggestions: parseArray(value.plotPlanSuggestions, parsePlotPlanSuggestion),
    worldEventUpdates: parseArray(value.worldEventUpdates, parseWorldEventUpdate),
    worldEventSummary: parseWorldEventSummary(value.worldEventSummary),
    playerRecoveryKind: parsePlayerRecoveryKind(value.playerRecoveryKind),
    encounterTransitionDecision: encounterTransition.value,
    encounterStartIntent: encounterTransition.acceptIntent ? encounterIntent.value : null,
    semanticProjections: semanticProjections.values,
    debugNotes: [
      ...parseStringArray(value.debugNotes),
      ...encounterIntent.diagnostics,
      ...encounterTransition.diagnostics,
      ...semanticProjections.diagnostics,
    ],
  };
}

function parseEncounterTransitionDecision(
  value: unknown,
  intent: EncounterStartIntent | null,
): {
  value: EncounterTransitionDecision | null | undefined;
  acceptIntent: boolean;
  diagnostics: string[];
} {
  if (value === null || value === undefined) {
    if (intent) {
      return {
        value: { mode: 'start', reason: intent.reason },
        acceptIntent: true,
        diagnostics: ['Encounter V2 未声明切入决定，已按合法开战意图兼容为 start。'],
      };
    }
    return { value: undefined, acceptIntent: false, diagnostics: [] };
  }
  if (
    !isRecord(value)
    || !['none', 'offer', 'start'].includes(String(value.mode))
    || typeof value.reason !== 'string'
    || value.reason.trim().length === 0
  ) {
    return {
      value: undefined,
      acceptIntent: false,
      diagnostics: ['Encounter V2 切入决定被本地拒绝：mode/reason 不符合结构化合同。'],
    };
  }

  const decision: EncounterTransitionDecision = {
    mode: value.mode as EncounterTransitionDecision['mode'],
    reason: value.reason.trim(),
  };
  if (decision.mode === 'none') {
    return {
      value: decision,
      acceptIntent: false,
      diagnostics: intent
        ? ['Encounter V2 切入决定为 none，已拒绝同时返回的开战意图。']
        : [],
    };
  }
  if (!intent) {
    return {
      value: decision,
      acceptIntent: false,
      diagnostics: [`Encounter V2 切入决定为 ${decision.mode}，但缺少合法 encounterStartIntent。`],
    };
  }
  if (decision.mode === 'offer' && intent.kind !== 'personal_combat') {
    return {
      value: decision,
      acceptIntent: false,
      diagnostics: ['Encounter V2 的 offer 只允许用于 personal_combat。'],
    };
  }
  return { value: decision, acceptIntent: true, diagnostics: [] };
}

function parseFactionRecentActionSuggestion(
  value: unknown,
): NonNullable<NarratorWritebackProtocol['factionRecentActionSuggestions']>[number] | null {
  if (
    !isRecord(value)
    || typeof value.factionId !== 'string'
    || typeof value.summary !== 'string'
    || !['亲历', '听闻', '推测'].includes(String(value.knownLevel))
  ) {
    return null;
  }

  return {
    factionId: value.factionId,
    summary: value.summary,
    knownLevel: value.knownLevel as '亲历' | '听闻' | '推测',
    observedAt: typeof value.observedAt === 'string' ? value.observedAt : undefined,
    sourceNote: typeof value.sourceNote === 'string' ? value.sourceNote : undefined,
  };
}

function parseEncounterStartIntent(
  value: unknown,
  localCreatedAt?: string,
  localSourceTurnNumber?: number,
): {
  value: EncounterStartIntent | null;
  diagnostics: string[];
} {
  if (value === null || value === undefined) return { value: null, diagnostics: [] };
  const candidate = isRecord(value)
    ? JSON.parse(JSON.stringify(value)) as Record<string, unknown>
    : value;
  const diagnostics: string[] = [];
  if (
    isRecord(candidate)
    && typeof localCreatedAt === 'string'
    && !Number.isNaN(Date.parse(localCreatedAt))
    && candidate.createdAt !== localCreatedAt
  ) {
    candidate.createdAt = localCreatedAt;
    diagnostics.push('Encounter V2 createdAt 已由本地回合时间规范化。');
  }
  if (
    isRecord(candidate)
    && typeof localSourceTurnNumber === 'number'
    && Number.isSafeInteger(localSourceTurnNumber)
    && localSourceTurnNumber >= 0
    && candidate.sourceTurnNumber !== localSourceTurnNumber
  ) {
    candidate.sourceTurnNumber = localSourceTurnNumber;
    diagnostics.push('Encounter V2 sourceTurnNumber 已由本地回合序号规范化。');
  }
  if (isRecord(candidate) && candidate.kind === 'personal_combat') {
    const playerParty = isRecord(candidate.playerParty) && Array.isArray(candidate.playerParty.actorIds)
      ? new Set(candidate.playerParty.actorIds.filter((actorId): actorId is string => typeof actorId === 'string'))
      : new Set<string>();
    const modelDeclaredFriendlyScopedCombatant = Array.isArray(candidate.scopedCombatants)
      && candidate.scopedCombatants.some((combatant) => (
        isRecord(combatant)
        && (
          combatant.systemRole !== undefined
          || (typeof combatant.actorId === 'string' && playerParty.has(combatant.actorId))
        )
      ));
    if (modelDeclaredFriendlyScopedCombatant) {
      return {
        value: null,
        diagnostics: [
          ...diagnostics,
          'Encounter V2 触发被本地拒绝：模型不得声明本地临时护卫或其他我方临时参战者。',
        ],
      };
    }
  }
  const validation = validateEncounterStartIntent(candidate);
  if (!validation.valid) {
    return {
      value: null,
      diagnostics: [
        ...diagnostics,
        `Encounter V2 触发被本地拒绝：${validation.errors.join('；')}`,
      ],
    };
  }
  return {
    value: candidate as EncounterStartIntent,
    diagnostics,
  };
}

function parseSemanticProjections(value: unknown): {
  values: SemanticProjection[];
  diagnostics: string[];
} {
  if (value === null || value === undefined) return { values: [], diagnostics: [] };
  if (!Array.isArray(value)) {
    return { values: [], diagnostics: ['Encounter V2 能力投影被本地拒绝：semanticProjections 必须是数组。'] };
  }
  const values: SemanticProjection[] = [];
  const diagnostics: string[] = [];
  value.forEach((candidate, index) => {
    const normalized = normalizeSemanticProjectionWireAliases(candidate);
    const validation = validateSemanticProjection(normalized.value);
    if (validation.valid) {
      values.push(JSON.parse(JSON.stringify(normalized.value)) as SemanticProjection);
      if (normalized.diagnostic) diagnostics.push(normalized.diagnostic);
      return;
    }
    const sourceId = isRecord(candidate) && typeof candidate.sourceId === 'string'
      ? candidate.sourceId
      : `index=${index}`;
    diagnostics.push(`Encounter V2 能力投影 ${sourceId} 被本地拒绝：${validation.errors.join('；')}`);
  });
  return { values, diagnostics };
}

function normalizeSemanticProjectionWireAliases(candidate: unknown): {
  value: unknown;
  diagnostic?: string;
} {
  if (
    !isRecord(candidate)
    || candidate.profileKind !== 'ability'
    || candidate.sourceType !== 'unique_art'
    || typeof candidate.targetMode !== 'string'
  ) {
    return { value: candidate };
  }
  const sourceId = typeof candidate.sourceId === 'string' ? candidate.sourceId : 'unknown';
  const diagnostics: string[] = [];
  const normalized = { ...candidate };
  const alias = candidate.targetMode.trim();
  const normalizedTargetMode = alias === 'enemy_force'
    ? 'all_enemies'
    : alias === 'ally_force'
      ? 'all_allies'
      : undefined;
  if (normalizedTargetMode) {
    normalized.targetMode = normalizedTargetMode;
    diagnostics.push(
      `Encounter V2 能力投影 ${sourceId} 已将 targetMode 结构别名 ${alias} 规范化为 ${normalizedTargetMode}。`,
    );
  }
  if (
    candidate.allowAutoUse === true
    && (candidate.powerClass === 'heavy' || candidate.powerClass === 'ultimate')
  ) {
    normalized.allowAutoUse = false;
    diagnostics.push(
      `Encounter V2 能力投影 ${sourceId} 已将 ${candidate.powerClass} 绝艺的冲突字段 allowAutoUse 规范化为 false。`,
    );
  }
  if (diagnostics.length === 0) return { value: candidate };
  return {
    value: normalized,
    diagnostic: diagnostics.join(' '),
  };
}

function parseTurnSummary(
  value: unknown,
  options: ParseNarratorResponseOptions,
): NarratorTurnSummaryWriteback | null {
  if (!isRecord(value)) return null;

  const privateAssetAcquisitions = parseArray(
    value.privateAssetAcquisitions,
    parsePrivateAssetAcquisitionFact,
  );
  const identityChanges = parseArray(
    value.identityChanges,
    parseIdentityChangeFact,
  );
  const npcAdmissions = parseArray(
    value.npcAdmissions,
    parseNpcAdmissionFact,
  );
  const relationshipAdmissions = parseArray(
    value.relationshipAdmissions,
    parseRelationshipAdmissionFact,
  );
  const correspondenceActions = Array.isArray(value.correspondenceActions)
    ? value.correspondenceActions
      .map((item) => parseCorrespondenceActionFact(item, options))
      .filter((item): item is NonNullable<NarratorTurnSummaryWriteback['correspondenceActions']>[number] => (
        item !== null
      ))
    : [];
  const commitmentResolutions = parseArray(
    value.commitmentResolutions,
    parseCommitmentResolutionFact,
  );
  const scenePresence = parseScenePresenceSnapshot(value.scenePresence);

  const brief = parseOptionalTrimmedString(value.brief)
    ?? correspondenceActions[0]?.summary
    ?? correspondenceActions[0]?.body
    ?? commitmentResolutions[0]?.summary;
  if (!brief) return null;

  return {
    brief: brief.slice(0, 300),
    playerActionSummary: typeof value.playerActionSummary === 'string' ? value.playerActionSummary : undefined,
    visibleConsequence: typeof value.visibleConsequence === 'string' ? value.visibleConsequence : undefined,
    memoryImportance: parseMemoryImportance(value.memoryImportance),
    scenePresence,
    privateAssetAcquisitions: privateAssetAcquisitions.length > 0
      ? privateAssetAcquisitions
      : undefined,
    identityChanges: identityChanges.length > 0 ? identityChanges : undefined,
    npcAdmissions: npcAdmissions.length > 0 ? npcAdmissions : undefined,
    relationshipAdmissions: relationshipAdmissions.length > 0
      ? relationshipAdmissions
      : undefined,
    correspondenceActions: correspondenceActions.length > 0
      ? correspondenceActions
      : undefined,
    commitmentResolutions: commitmentResolutions.length > 0
      ? commitmentResolutions
      : undefined,
  };
}

function parseScenePresenceSnapshot(
  value: unknown,
): NarratorTurnSummaryWriteback['scenePresence'] {
  if (!isRecord(value)) return undefined;
  const locationId = parseOptionalTrimmedString(value.locationId);
  if (!locationId || !Array.isArray(value.presentNpcIds)) return undefined;
  const presentNpcIds = [...new Set(
    value.presentNpcIds
      .map(parseOptionalTrimmedString)
      .filter((npcId): npcId is string => Boolean(npcId)),
  )];
  return { locationId, presentNpcIds };
}

function parseNpcAdmissionFact(
  value: unknown,
): NonNullable<NarratorTurnSummaryWriteback['npcAdmissions']>[number] | null {
  if (!isRecord(value)) return null;
  const sourceRefId = parseOptionalTrimmedString(value.sourceRefId);
  const npcId = parseOptionalTrimmedString(value.npcId);
  const name = parseOptionalTrimmedString(value.name);
  const persistenceEvidence = parseOptionalTrimmedString(value.persistenceEvidence);
  const summary = parseOptionalTrimmedString(value.summary);
  const persistenceReasons: readonly NpcProfilePersistenceReason[] = [
    'opening_cast',
    'historical_figure',
    'active_system_role',
    'recurring_contact',
    'player_committed_relationship',
    'strategic_actor',
  ];
  if (
    !sourceRefId
    || !npcId
    || !name
    || !persistenceEvidence
    || !summary
    || !persistenceReasons.includes(value.persistenceReason as NpcProfilePersistenceReason)
  ) return null;
  return {
    sourceRefId,
    npcId,
    name,
    persistenceReason: value.persistenceReason as NpcProfilePersistenceReason,
    persistenceEvidence,
    summary,
  };
}

function parseCorrespondenceActionFact(
  value: unknown,
  options: ParseNarratorResponseOptions,
): NonNullable<NarratorTurnSummaryWriteback['correspondenceActions']>[number] | null {
  if (
    !isRecord(value)
    || !['send', 'reply', 'acknowledge', 'noReply'].includes(String(value.action))
  ) return null;
  const action = value.action as NonNullable<
    NarratorTurnSummaryWriteback['correspondenceActions']
  >[number]['action'];
  const sourceLetterId = parseOptionalTrimmedString(value.sourceLetterId);
  const sourceLetterSummary = parseOptionalTrimmedString(value.sourceLetterSummary);
  const source = sourceLetterId
    ? options.correspondenceSources?.find((entry) => entry.letterId === sourceLetterId)
    : undefined;
  const inferredReplyDirection = action === 'reply' && source
    ? source.direction === 'outgoing' ? 'npc_to_player' : 'player_to_npc'
    : undefined;
  const explicitDirection = value.direction === 'player_to_npc' || value.direction === 'npc_to_player'
    ? value.direction
    : undefined;
  if (explicitDirection && inferredReplyDirection && explicitDirection !== inferredReplyDirection) return null;
  const direction = explicitDirection ?? inferredReplyDirection;
  const deliveryState = value.deliveryState === 'received' ? 'received' : 'sent';
  const letterId = parseOptionalTrimmedString(value.letterId);
  const sourceRefId = parseOptionalTrimmedString(value.sourceRefId)
    ?? (sourceLetterId || letterId
      ? `correspondence:${action}:${sourceLetterId ?? letterId}`
      : undefined);
  if (!sourceRefId) return null;
  if (action === 'acknowledge' || action === 'noReply') {
    return sourceLetterId
      ? {
          sourceRefId,
          action,
          sourceLetterId,
          ...(sourceLetterSummary ? { sourceLetterSummary } : {}),
        }
      : null;
  }

  const body = parseOptionalTrimmedString(value.body);
  if (!direction || !letterId || !body) return null;
  const npcIdAlias = parseOptionalTrimmedString(value.npcId);
  const senderNpcId = parseOptionalTrimmedString(value.senderNpcId)
    ?? (direction === 'npc_to_player' ? npcIdAlias ?? source?.npcId : undefined);
  const recipientNpcId = parseOptionalTrimmedString(value.recipientNpcId)
    ?? (direction === 'player_to_npc' ? npcIdAlias ?? source?.npcId : undefined);
  if (direction === 'player_to_npc' && !recipientNpcId) return null;
  if (direction === 'npc_to_player' && !senderNpcId) return null;
  const summary = parseOptionalTrimmedString(value.summary);
  const commitments = Array.isArray(value.commitments)
    ? value.commitments
      .map((item, index) => parseCorrespondenceCommitmentFact(item, {
        fallbackId: `${sourceRefId}:commitment:${index + 1}`,
        fallbackSummary: summary ?? body,
        fallbackTargetLocationId: parseOptionalTrimmedString(value.targetLocationId),
      }))
      .filter((item): item is NonNullable<
        NonNullable<NarratorTurnSummaryWriteback['correspondenceActions']>[number]['commitments']
      >[number] => item !== null)
    : [];
  const relatedCommitmentIds = Array.isArray(value.relatedCommitmentIds)
    ? [...new Set(value.relatedCommitmentIds
      .map(parseOptionalTrimmedString)
      .filter((item): item is string => Boolean(item)))]
    : [];
  if (commitments.length > 0 && direction !== 'npc_to_player') return null;
  return {
    sourceRefId,
    action,
    letterId,
    direction,
    deliveryState,
    ...(senderNpcId ? { senderNpcId } : {}),
    ...(recipientNpcId ? { recipientNpcId } : {}),
    subject: parseOptionalTrimmedString(value.subject) ?? '无题',
    body,
    ...(summary ? { summary } : {}),
    ...(parseOptionalTrimmedString(value.replyToLetterId)
      ? { replyToLetterId: parseOptionalTrimmedString(value.replyToLetterId) }
      : {}),
    channel: value.channel === 'envoy' ? 'envoy' : 'letter',
    ...(parseOptionalTrimmedString(value.originLocationId)
      ? { originLocationId: parseOptionalTrimmedString(value.originLocationId) }
      : {}),
    ...(parseOptionalTrimmedString(value.targetLocationId)
      ? { targetLocationId: parseOptionalTrimmedString(value.targetLocationId) }
      : {}),
    ...(relatedCommitmentIds.length > 0 ? { relatedCommitmentIds } : {}),
    ...(sourceLetterId ? { sourceLetterId } : {}),
    ...(sourceLetterSummary ? { sourceLetterSummary } : {}),
    ...(commitments.length > 0 ? { commitments } : {}),
  };
}

function parseCorrespondenceCommitmentFact(
  value: unknown,
  fallback: {
    fallbackId: string;
    fallbackSummary: string;
    fallbackTargetLocationId?: string;
  },
): NonNullable<
  NonNullable<NarratorTurnSummaryWriteback['correspondenceActions']>[number]['commitments']
>[number] | null {
  if (
    !isRecord(value)
    || !parseOptionalTrimmedString(value.expectedAt)
  ) return null;
  const commitmentId = parseOptionalTrimmedString(value.commitmentId) ?? fallback.fallbackId;
  const summary = parseOptionalTrimmedString(value.summary) ?? fallback.fallbackSummary;
  const targetLocationId = parseOptionalTrimmedString(value.targetLocationId)
    ?? fallback.fallbackTargetLocationId;
  if (!targetLocationId) return null;
  const deliverables = parseCorrespondenceCommitmentDeliverables(value.deliverables);
  if (deliverables.length === 0) return null;
  const conditions = parseStringArray(value.conditions).map((item) => item.trim()).filter(Boolean);
  return {
    commitmentId,
    summary,
    targetLocationId,
    expectedAt: parseOptionalTrimmedString(value.expectedAt)!,
    ...(parseOptionalTrimmedString(value.originLocationId)
      ? { originLocationId: parseOptionalTrimmedString(value.originLocationId) }
      : {}),
    deliverables,
    ...(conditions.length > 0 ? { conditions } : {}),
  };
}

function parseCorrespondenceCommitmentDeliverables(
  value: unknown,
): CorrespondenceCommitmentDeliverable[] {
  if (Array.isArray(value)) {
    return value
      .map(parseCorrespondenceCommitmentDeliverable)
      .filter((item): item is CorrespondenceCommitmentDeliverable => item !== null);
  }
  if (!isRecord(value)) return [];
  if (typeof value.kind === 'string') {
    const parsed = parseCorrespondenceCommitmentDeliverable(value);
    return parsed ? [parsed] : [];
  }

  const normalized: unknown[] = [];
  if (isRecord(value.resources)) normalized.push({ kind: 'resources', resources: value.resources });
  if (isRecord(value.visit)) normalized.push({ kind: 'visit', ...value.visit });
  if (isRecord(value.troop)) normalized.push({ kind: 'troop', ...value.troop });
  if (isRecord(value.items)) normalized.push({ kind: 'items', ...value.items });
  if (isRecord(value.intel)) normalized.push({ kind: 'intel', ...value.intel });
  if (isRecord(value.other)) normalized.push({ kind: 'other', ...value.other });
  return normalized
    .map(parseCorrespondenceCommitmentDeliverable)
    .filter((item): item is CorrespondenceCommitmentDeliverable => item !== null);
}

function parseCorrespondenceCommitmentDeliverable(
  value: unknown,
): CorrespondenceCommitmentDeliverable | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'visit') {
    const npcId = parseOptionalTrimmedString(value.npcId);
    if (!npcId) return null;
    return {
      kind: 'visit',
      npcId,
      ...(parseOptionalTrimmedString(value.entourageSummary)
        ? { entourageSummary: parseOptionalTrimmedString(value.entourageSummary) }
        : {}),
    };
  }
  if (value.kind === 'troop') {
    const troopIds = parseStringArray(value.troopIds).map((item) => item.trim()).filter(Boolean);
    if (troopIds.length === 0) return null;
    return {
      kind: 'troop',
      troopIds,
      ...(typeof value.expectedCount === 'number' && Number.isFinite(value.expectedCount) && value.expectedCount > 0
        ? { expectedCount: Math.floor(value.expectedCount) }
        : {}),
      ...(parseOptionalTrimmedString(value.compositionSummary)
        ? { compositionSummary: parseOptionalTrimmedString(value.compositionSummary) }
        : {}),
    };
  }
  if (value.kind === 'resources' && isRecord(value.resources)) {
    const resources: Record<string, number> = {};
    for (const field of ['playerMoneyQian', 'moneyGuan', 'grain', 'horses', 'arms', 'recruits'] as const) {
      const amount = value.resources[field];
      if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
        resources[field] = amount;
      }
    }
    if (Object.keys(resources).length === 0) return null;
    return { kind: 'resources', resources } as CorrespondenceCommitmentDeliverable;
  }
  if (value.kind === 'items') {
    const itemIds = parseStringArray(value.itemIds).map((item) => item.trim()).filter(Boolean);
    if (itemIds.length === 0) return null;
    return {
      kind: 'items',
      itemIds,
      ...(parseOptionalTrimmedString(value.itemSummary)
        ? { itemSummary: parseOptionalTrimmedString(value.itemSummary) }
        : {}),
    };
  }
  if (value.kind === 'intel' || value.kind === 'other') {
    const summary = parseOptionalTrimmedString(value.summary);
    return summary ? { kind: value.kind, summary } : null;
  }
  return null;
}

function parseCommitmentResolutionFact(
  value: unknown,
): NonNullable<NarratorTurnSummaryWriteback['commitmentResolutions']>[number] | null {
  const statusValue = isRecord(value) && [
    'fulfilled', 'partial', 'delayed', 'failed', 'cancelled',
  ].includes(String(value.status))
    ? value.status
    : isRecord(value) && [
      'fulfilled', 'partial', 'delayed', 'failed', 'cancelled',
    ].includes(String(value.resolution))
      ? value.resolution
      : undefined;
  if (
    !isRecord(value)
    || !parseOptionalTrimmedString(value.commitmentId)
    || !parseOptionalTrimmedString(value.summary)
    || !statusValue
  ) return null;
  const commitmentId = parseOptionalTrimmedString(value.commitmentId)!;
  const sourceRefId = parseOptionalTrimmedString(value.sourceRefId)
    ?? `commitment-resolution:${commitmentId}:${String(statusValue)}`;
  const nextExpectedAt = parseOptionalTrimmedString(value.nextExpectedAt);
  if ((statusValue === 'delayed' || statusValue === 'partial') && !nextExpectedAt) return null;
  const deliveredDeliverables = parseCorrespondenceCommitmentDeliverables(
    value.deliveredDeliverables,
  );
  if (statusValue === 'partial' && deliveredDeliverables.length === 0) return null;
  const appliedOperationIds = parseStringArray(value.appliedOperationIds)
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    sourceRefId,
    commitmentId,
    status: statusValue as NonNullable<
      NarratorTurnSummaryWriteback['commitmentResolutions']
    >[number]['status'],
    summary: parseOptionalTrimmedString(value.summary)!,
    ...(nextExpectedAt ? { nextExpectedAt } : {}),
    ...(deliveredDeliverables.length > 0 ? { deliveredDeliverables } : {}),
    ...(appliedOperationIds.length > 0 ? { appliedOperationIds } : {}),
  };
}

function parseRelationshipAdmissionFact(
  value: unknown,
): NonNullable<NarratorTurnSummaryWriteback['relationshipAdmissions']>[number] | null {
  if (
    !isRecord(value)
    || typeof value.sourceRefId !== 'string'
    || value.sourceRefId.trim().length === 0
    || typeof value.summary !== 'string'
    || value.summary.trim().length === 0
  ) return null;

  const sourceRefId = value.sourceRefId.trim();
  const summary = value.summary.trim();
  const source = parseOptionalTrimmedString(value.source);
  if (value.relationshipKind === 'heroine') {
    if (
      typeof value.npcId !== 'string'
      || value.npcId.trim().length === 0
      || typeof value.stage !== 'string'
      || value.stage.trim().length === 0
      || typeof value.relationshipRole !== 'string'
      || value.relationshipRole.trim().length === 0
    ) return null;
    const currentPull = parseOptionalTrimmedString(value.currentPull);
    const riskNotes = parseOptionalTrimmedString(value.riskNotes);
    const promiseNotes = parseOptionalTrimmedString(value.promiseNotes);
    return {
      relationshipKind: 'heroine',
      sourceRefId,
      npcId: value.npcId.trim(),
      stage: value.stage.trim(),
      relationshipRole: value.relationshipRole.trim(),
      summary,
      ...(currentPull ? { currentPull } : {}),
      ...(riskNotes ? { riskNotes } : {}),
      ...(promiseNotes ? { promiseNotes } : {}),
      ...(source ? { source } : {}),
    };
  }

  if (value.relationshipKind !== 'bond') return null;
  const targetNames = parseStringArray(value.targetNames);
  const targetNpcIds = parseStringArray(value.targetNpcIds);
  const bondTypes = ['sworn', 'kinship', 'mentor', 'lordVassal', 'ally', 'debt', 'rival', 'enemy', 'other'] as const;
  if (targetNames.length === 0 || !bondTypes.includes(value.bondType as (typeof bondTypes)[number])) return null;
  const currentTension = parseOptionalTrimmedString(value.currentTension);
  const promiseNotes = parseOptionalTrimmedString(value.promiseNotes);
  const conflictNotes = parseOptionalTrimmedString(value.conflictNotes);
  return {
    relationshipKind: 'bond',
    sourceRefId,
    targetNames,
    ...(targetNpcIds.length > 0 ? { targetNpcIds } : {}),
    bondType: value.bondType as (typeof bondTypes)[number],
    summary,
    ...(currentTension ? { currentTension } : {}),
    ...(promiseNotes ? { promiseNotes } : {}),
    ...(conflictNotes ? { conflictNotes } : {}),
    ...(source ? { source } : {}),
  };
}

function parsePrivateAssetAcquisitionFact(
  value: unknown,
): NonNullable<NarratorTurnSummaryWriteback['privateAssetAcquisitions']>[number] | null {
  if (
    !isRecord(value)
    || typeof value.sourceRefId !== 'string'
    || value.sourceRefId.trim().length === 0
    || typeof value.assetName !== 'string'
    || value.assetName.trim().length === 0
    || typeof value.summary !== 'string'
    || value.summary.trim().length === 0
    || !['purchase', 'grant', 'inheritance', 'construction', 'seizure', 'transfer'].includes(
      String(value.kind),
    )
  ) {
    return null;
  }

  const fact: NonNullable<NarratorTurnSummaryWriteback['privateAssetAcquisitions']>[number] = {
    sourceRefId: value.sourceRefId.trim(),
    assetName: value.assetName.trim(),
    kind: value.kind as NonNullable<
      NarratorTurnSummaryWriteback['privateAssetAcquisitions']
    >[number]['kind'],
    summary: value.summary.trim(),
  };
  const optionalValues = {
    privateAssetId: parseOptionalTrimmedString(value.privateAssetId),
    type: parsePrivateAssetType(value.type),
    ownerScope: parsePrivateAssetOwnerScope(value.ownerScope),
    status: parsePrivateAssetStatus(value.status),
    locationId: parseOptionalTrimmedString(value.locationId),
    locationDescription: parseOptionalTrimmedString(value.locationDescription),
    managerNpcId: parseOptionalTrimmedString(value.managerNpcId),
    mu: parseOptionalNonNegativeFiniteNumber(value.mu),
    households: parseOptionalNonNegativeFiniteNumber(value.households),
    workers: parseOptionalNonNegativeFiniteNumber(value.workers),
    workshopScale: parsePrivateAssetWorkshopScale(value.workshopScale),
    ranchCapacity: parseOptionalNonNegativeFiniteNumber(value.ranchCapacity),
    costMoney: parseOptionalNonNegativeFiniteNumber(value.costMoney),
    costGrain: parseOptionalNonNegativeFiniteNumber(value.costGrain),
  };
  for (const [field, parsed] of Object.entries(optionalValues)) {
    if (parsed !== undefined) (fact as unknown as Record<string, unknown>)[field] = parsed;
  }
  return fact;
}

function parseIdentityChangeFact(
  value: unknown,
): NonNullable<NarratorTurnSummaryWriteback['identityChanges']>[number] | null {
  if (
    !isRecord(value)
    || typeof value.sourceRefId !== 'string'
    || value.sourceRefId.trim().length === 0
    || (value.characterType !== 'player' && value.characterType !== 'npc')
    || typeof value.characterId !== 'string'
    || value.characterId.trim().length === 0
    || typeof value.currentIdentity !== 'string'
    || value.currentIdentity.trim().length === 0
    || typeof value.currentIdentityDescription !== 'string'
    || value.currentIdentityDescription.trim().length === 0
    || typeof value.identitySummary !== 'string'
    || value.identitySummary.trim().length === 0
    || typeof value.summary !== 'string'
    || value.summary.trim().length === 0
  ) return null;

  const fact: NonNullable<NarratorTurnSummaryWriteback['identityChanges']>[number] = {
    sourceRefId: value.sourceRefId.trim(),
    characterType: value.characterType,
    characterId: value.characterId.trim(),
    currentIdentity: value.currentIdentity.trim(),
    currentIdentityDescription: value.currentIdentityDescription.trim(),
    identitySummary: value.identitySummary.trim(),
    summary: value.summary.trim(),
  };
  for (const field of [
    'factionId',
    'factionName',
    'allegianceTarget',
    'officeTitle',
    'militaryTitle',
    'nobleTitle',
  ] as const) {
    const parsed = parseNullableTrimmedString(value[field]);
    if (parsed !== undefined) fact[field] = parsed;
  }

  const escort = parseIdentityFactEscortEntitlement(value.personalEscortEntitlement);
  if (value.characterType === 'player') {
    if (!escort) return null;
    fact.personalEscortEntitlement = escort;
  }
  return fact;
}

function parseIdentityFactEscortEntitlement(
  value: unknown,
): NonNullable<
  NonNullable<NarratorTurnSummaryWriteback['identityChanges']>[number]['personalEscortEntitlement']
> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status !== 'none' && value.status !== 'customary') return undefined;
  if (!Array.isArray(value.bases) || value.bases.some((basis) => typeof basis !== 'string')) return undefined;
  const bases = parseStringArray(value.bases);
  if (
    bases.some((basis) => !PERSONAL_ESCORT_ENTITLEMENT_BASES.includes(
      basis as (typeof PERSONAL_ESCORT_ENTITLEMENT_BASES)[number],
    ))
    || new Set(bases).size !== bases.length
    || (value.status === 'none' && bases.length !== 0)
    || (value.status === 'customary' && bases.length === 0)
  ) return undefined;
  return {
    status: value.status,
    bases: bases as NonNullable<
      NonNullable<NarratorTurnSummaryWriteback['identityChanges']>[number]['personalEscortEntitlement']
    >['bases'],
  };
}

function parsePrivateAssetType(
  value: unknown,
): NonNullable<NarratorTurnSummaryWriteback['privateAssetAcquisitions']>[number]['type'] {
  return ['estate', 'farmland', 'workshop', 'ranch', 'shop', 'ferry', 'mine', 'other'].includes(String(value))
    ? value as NonNullable<NarratorTurnSummaryWriteback['privateAssetAcquisitions']>[number]['type']
    : undefined;
}

function parsePrivateAssetOwnerScope(
  value: unknown,
): NonNullable<NarratorTurnSummaryWriteback['privateAssetAcquisitions']>[number]['ownerScope'] {
  return ['personal', 'clan', 'household', 'retainer', 'faction'].includes(String(value))
    ? value as NonNullable<NarratorTurnSummaryWriteback['privateAssetAcquisitions']>[number]['ownerScope']
    : undefined;
}

function parsePrivateAssetStatus(
  value: unknown,
): NonNullable<NarratorTurnSummaryWriteback['privateAssetAcquisitions']>[number]['status'] {
  return ['active', 'damaged', 'occupied', 'disputed', 'archived'].includes(String(value))
    ? value as NonNullable<NarratorTurnSummaryWriteback['privateAssetAcquisitions']>[number]['status']
    : undefined;
}

function parsePrivateAssetWorkshopScale(
  value: unknown,
): NonNullable<NarratorTurnSummaryWriteback['privateAssetAcquisitions']>[number]['workshopScale'] {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5
    ? value as 1 | 2 | 3 | 4 | 5
    : undefined;
}

function parseOptionalTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseNullableTrimmedString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return parseOptionalTrimmedString(value);
}

function parseOptionalNonNegativeFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

const protagonistProfileTextFields = [
  'name',
  'courtesyName',
  'artName',
  'commonAddress',
  'birthOrigin',
  'birthOriginDescription',
  'currentIdentity',
  'currentIdentityDescription',
  'factionId',
  'factionName',
  'allegianceTarget',
  'officeTitle',
  'militaryTitle',
  'nobleTitle',
  'identitySummary',
  'appearance',
  'personality',
] as const satisfies readonly (keyof NarratorProtagonistProfileWriteback)[];

function parseProtagonistProfile(value: unknown): NarratorProtagonistProfileWriteback | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return null;

  const profile: NarratorProtagonistProfileWriteback = {};
  for (const field of protagonistProfileTextFields) {
    const parsed = parseNullableString(value[field]);
    if (parsed !== undefined) {
      profile[field] = parsed as never;
    }
  }

  if (value.aliases === null) {
    profile.aliases = null;
  } else if (Array.isArray(value.aliases)) {
    profile.aliases = parseStringArray(value.aliases);
  }

  const personalEscortEntitlement = parsePersonalEscortEntitlement(value.personalEscortEntitlement);
  if (personalEscortEntitlement) {
    profile.personalEscortEntitlement = personalEscortEntitlement;
  }

  return Object.keys(profile).length > 0 ? profile : null;
}

function parsePersonalEscortEntitlement(
  value: unknown,
): NonNullable<NarratorProtagonistProfileWriteback['personalEscortEntitlement']> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status !== 'none' && value.status !== 'customary') return undefined;
  if (!Array.isArray(value.bases) || value.bases.some((basis) => typeof basis !== 'string')) return undefined;
  const bases = parseStringArray(value.bases);
  if (
    bases.some((basis) => !PERSONAL_ESCORT_ENTITLEMENT_BASES.includes(
      basis as (typeof PERSONAL_ESCORT_ENTITLEMENT_BASES)[number],
    ))
    || new Set(bases).size !== bases.length
    || (value.status === 'none' && bases.length !== 0)
    || (value.status === 'customary' && bases.length === 0)
  ) return undefined;
  if (typeof value.updatedAt !== 'string' || !value.updatedAt.trim()) return undefined;
  return {
    status: value.status,
    bases: bases as NonNullable<
      NarratorProtagonistProfileWriteback['personalEscortEntitlement']
    >['bases'],
    updatedAt: value.updatedAt.trim(),
  };
}

function parseProtagonistMemory(value: unknown): NarratorProtagonistMemoryWriteback | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return null;

  const memory: NarratorProtagonistMemoryWriteback = {};
  if (typeof value.recentTurnSummary === 'string') {
    memory.recentTurnSummary = value.recentTurnSummary;
  }

  if (isRecord(value.keyDeed) && typeof value.keyDeed.summary === 'string') {
    memory.keyDeed = {
      summary: value.keyDeed.summary,
      impact: typeof value.keyDeed.impact === 'string' ? value.keyDeed.impact : undefined,
      locationId: typeof value.keyDeed.locationId === 'string' ? value.keyDeed.locationId : undefined,
    };
  }

  return Object.keys(memory).length > 0 ? memory : null;
}

function parseNpcProfileSuggestion(value: unknown): NarratorNpcProfileSuggestion | null {
  if (
    !isRecord(value)
    || typeof value.npcId !== 'string'
    || typeof value.name !== 'string'
    || typeof value.sex !== 'string'
    || typeof value.age !== 'number'
    || typeof value.role !== 'string'
    || typeof value.locationId !== 'string'
    || typeof value.isPresent !== 'boolean'
    || typeof value.currentIdentity !== 'string'
    || typeof value.summary !== 'string'
    || typeof value.appearance !== 'string'
    || typeof value.personality !== 'string'
    || typeof value.motivation !== 'string'
    || typeof value.relationToPlayer !== 'string'
    || typeof value.contactLevel !== 'number'
    || typeof value.recentAttitude !== 'string'
  ) {
    return null;
  }

  const profile: NarratorNpcProfileSuggestion = {
    npcId: value.npcId,
    name: value.name,
    persistenceReason: typeof value.persistenceReason === 'string'
      ? value.persistenceReason as NpcProfilePersistenceReason
      : undefined,
    persistenceEvidence: typeof value.persistenceEvidence === 'string'
      ? value.persistenceEvidence
      : undefined,
    courtesyName: parseNullableString(value.courtesyName),
    artName: parseNullableString(value.artName),
    aliases: Array.isArray(value.aliases) ? parseStringArray(value.aliases) : undefined,
    commonAddress: parseNullableString(value.commonAddress),
    sex: value.sex as NarratorNpcProfileSuggestion['sex'],
    age: value.age,
    birthDate: parseNullableString(value.birthDate),
    ageKnownAtDate: parseNullableString(value.ageKnownAtDate),
    role: value.role,
    factionId: parseNullableString(value.factionId),
    factionName: parseNullableString(value.factionName),
    locationId: value.locationId,
    isPresent: value.isPresent,
    isFocused: typeof value.isFocused === 'boolean' ? value.isFocused : value.isPresent,
    birthOrigin: parseNullableString(value.birthOrigin),
    birthOriginDescription: parseNullableString(value.birthOriginDescription),
    currentIdentity: value.currentIdentity,
    currentIdentityDescription: parseNullableString(value.currentIdentityDescription),
    allegianceTarget: parseNullableString(value.allegianceTarget),
    officeTitle: parseNullableString(value.officeTitle),
    militaryTitle: parseNullableString(value.militaryTitle),
    nobleTitle: parseNullableString(value.nobleTitle),
    identitySummary: parseNullableString(value.identitySummary),
    summary: value.summary,
    appearance: value.appearance,
    personality: value.personality,
    motivation: value.motivation,
    relationToPlayer: value.relationToPlayer,
    contactLevel: value.contactLevel,
    recentAttitude: value.recentAttitude,
    abilityScores: parseNumberRecord(value.abilityScores),
    vitals: parseCharacterVitals(value.vitals),
    traits: parseCharacterTraits(value.traits),
    uniqueArts: parseCharacterUniqueArts(value.uniqueArts),
    effects: parseCharacterEffects(value.effects),
    equipment: preserveEquipmentCandidate(value.equipment),
    inventory: preserveInventoryCandidate(value.inventory),
    femaleProfile: parseNpcFemaleProfile(value.femaleProfile),
  };
  Object.defineProperty(profile, NPC_PROFILE_EXPLICIT_IS_FOCUSED, {
    value: typeof value.isFocused === 'boolean',
    enumerable: true,
  });
  return profile;
}

const femaleProfileTextFields = [
  'birthday',
  'addressToPlayer',
  'relationshipNotes',
  'publicIntimacyNotes',
  'appearanceDescription',
  'bodyDescription',
  'clothingStyle',
  'appearanceExtension',
  'personalityCore',
  'affectionProgressionCondition',
  'relationshipProgressionCondition',
  'emotionalBoundary',
  'updatedAt',
  'source',
] as const satisfies readonly (keyof LuanShiNpcFemaleProfile)[];

const adultPrivateProfileTextFields = [
  'summary',
  'breastDescription',
  'vaginaDescription',
  'anusDescription',
  'sexualPreferenceNotes',
  'sensitiveSpotNotes',
  'preferenceNotes',
  'boundaryNotes',
  'sensitiveNotes',
  'relationshipRiskNotes',
  'firstNightPartner',
  'firstNightTime',
  'firstNightDescription',
  'updatedAt',
  'source',
] as const satisfies readonly (keyof LuanShiNpcAdultPrivateProfile)[];

function parseNpcFemaleProfile(value: unknown): LuanShiNpcFemaleProfile | undefined {
  if (!isRecord(value)) return undefined;

  const profile: LuanShiNpcFemaleProfile = {};
  for (const field of femaleProfileTextFields) {
    assignOptionalString(profile, field, value[field]);
  }

  const relationshipNetwork = parseArray(value.relationshipNetwork, parseRelationshipNetworkEntry);
  if (relationshipNetwork.length > 0) {
    profile.relationshipNetwork = relationshipNetwork;
  }

  const adultPrivateProfile = parseAdultPrivateProfile(value.adultPrivateProfile);
  if (adultPrivateProfile) {
    profile.adultPrivateProfile = adultPrivateProfile;
  }

  return Object.keys(profile).length > 0 ? profile : undefined;
}

function parseRelationshipNetworkEntry(value: unknown): LuanShiNpcRelationshipNetworkEntry | null {
  if (!isRecord(value) || typeof value.targetName !== 'string' || typeof value.relationship !== 'string') {
    return null;
  }

  return {
    targetName: value.targetName,
    relationship: value.relationship,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
  };
}

function parseAdultPrivateProfile(value: unknown): LuanShiNpcAdultPrivateProfile | undefined {
  if (!isRecord(value)) return undefined;

  const profile: LuanShiNpcAdultPrivateProfile = {};
  for (const field of adultPrivateProfileTextFields) {
    assignOptionalString(profile, field, value[field]);
  }

  if (typeof value.enabled === 'boolean') profile.enabled = value.enabled;
  if (typeof value.ageConfirmedAdult === 'boolean') profile.ageConfirmedAdult = value.ageConfirmedAdult;
  if (typeof value.virgin === 'boolean') profile.virgin = value.virgin;

  const wombProfile = parseWombProfile(value.wombProfile);
  if (wombProfile) profile.wombProfile = wombProfile;

  return Object.keys(profile).length > 0 ? profile : undefined;
}

function parseWombProfile(value: unknown): LuanShiNpcWombProfile | undefined {
  if (!isRecord(value)) return undefined;

  const wombProfile: LuanShiNpcWombProfile = {};
  if (typeof value.status === 'string') wombProfile.status = value.status;
  if (typeof value.cervixStatus === 'string') wombProfile.cervixStatus = value.cervixStatus;

  const records = parseArray(value.inseminationRecords, (item) => {
    if (!isRecord(item) || typeof item.date !== 'string' || typeof item.description !== 'string') {
      return null;
    }

    return {
      date: item.date,
      description: item.description,
      pregnancyCheckDate: typeof item.pregnancyCheckDate === 'string' ? item.pregnancyCheckDate : undefined,
    };
  });
  if (records.length > 0) {
    wombProfile.inseminationRecords = records;
  }

  return Object.keys(wombProfile).length > 0 ? wombProfile : undefined;
}

function assignOptionalString<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: unknown,
): void {
  if (typeof value === 'string') {
    target[key] = value as T[K];
  }
}

function parseNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function parseNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
  );
}

function parseCharacterVitals(value: unknown): NarratorNpcProfileSuggestion['vitals'] {
  if (!isRecord(value)) return undefined;
  const hp = parseOptionalNumber(value.hp);
  const maxHp = parseOptionalNumber(value.maxHp);
  const stamina = parseOptionalNumber(value.stamina);
  const maxStamina = parseOptionalNumber(value.maxStamina);
  if (hp === undefined || maxHp === undefined || stamina === undefined || maxStamina === undefined) {
    return undefined;
  }
  return { hp, maxHp, stamina, maxStamina };
}

function parseCharacterTraits(value: unknown): NarratorNpcProfileSuggestion['traits'] {
  return normalizeCharacterTraits(parseArray(value, parseCharacterTrait));
}

function parseCharacterTrait(value: unknown): NarratorNpcProfileSuggestion['traits'][number] | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string' || typeof value.description !== 'string') {
    return null;
  }

  return {
    id: value.id,
    label: value.label,
    description: value.description,
    source: typeof value.source === 'string' ? value.source : '',
    rarity: typeof value.rarity === 'string' ? value.rarity : undefined,
    promptHint: typeof value.promptHint === 'string' ? value.promptHint : undefined,
    checkHooks: parseCheckHooks(value.checkHooks),
  };
}

function parseCharacterUniqueArts(value: unknown): NarratorNpcProfileSuggestion['uniqueArts'] {
  if (!Array.isArray(value)) return undefined;
  return parseArray(value, (item) => {
    if (
      !isRecord(item)
      || typeof item.id !== 'string'
      || typeof item.name !== 'string'
      || typeof item.rarity !== 'string'
      || typeof item.domain !== 'string'
      || typeof item.level !== 'number'
      || typeof item.description !== 'string'
      || typeof item.effectSummary !== 'string'
      || typeof item.source !== 'string'
    ) {
      return null;
    }

    return {
      id: item.id,
      name: item.name,
      rarity: item.rarity as NonNullable<NarratorNpcProfileSuggestion['uniqueArts']>[number]['rarity'],
      domain: item.domain as NonNullable<NarratorNpcProfileSuggestion['uniqueArts']>[number]['domain'],
      level: item.level,
      maxLevel: parseOptionalNumber(item.maxLevel),
      progress: parseOptionalNumber(item.progress),
      description: item.description,
      effectSummary: item.effectSummary,
      source: item.source,
      acquisition: parseCharacterUniqueArtAcquisition(item.acquisition),
      acquiredAt: typeof item.acquiredAt === 'string' ? item.acquiredAt : undefined,
      upgradedAt: typeof item.upgradedAt === 'string' ? item.upgradedAt : undefined,
      promptHint: typeof item.promptHint === 'string' ? item.promptHint : undefined,
      checkHooks: parseCheckHooks(item.checkHooks),
      tags: parseStringArray(item.tags),
    };
  });
}

function parseCharacterUniqueArtAcquisition(
  value: unknown,
): CharacterUniqueArt['acquisition'] | undefined {
  if (
    !isRecord(value)
    || typeof value.kind !== 'string'
    || typeof value.occurredAt !== 'string'
    || typeof value.sourceRefId !== 'string'
    || typeof value.summary !== 'string'
  ) {
    return undefined;
  }
  return {
    kind: value.kind as NonNullable<CharacterUniqueArt['acquisition']>['kind'],
    occurredAt: value.occurredAt,
    sourceRefId: value.sourceRefId,
    summary: value.summary,
    instructorNpcId: typeof value.instructorNpcId === 'string' ? value.instructorNpcId : undefined,
    sourceItemId: typeof value.sourceItemId === 'string' ? value.sourceItemId : undefined,
  };
}

function parseCharacterEffects(value: unknown): NarratorNpcProfileSuggestion['effects'] {
  if (!Array.isArray(value)) return undefined;
  return parseArray(value, (item) => {
    if (
      !isRecord(item)
      || typeof item.id !== 'string'
      || typeof item.label !== 'string'
      || typeof item.type !== 'string'
      || typeof item.duration !== 'string'
      || typeof item.description !== 'string'
      || typeof item.source !== 'string'
    ) {
      return null;
    }

    return {
      id: item.id,
      label: item.label,
      type: item.type as NonNullable<NarratorNpcProfileSuggestion['effects']>[number]['type'],
      duration: item.duration as NonNullable<NarratorNpcProfileSuggestion['effects']>[number]['duration'],
      description: item.description,
      source: item.source,
      promptHint: typeof item.promptHint === 'string' ? item.promptHint : undefined,
      checkHooks: parseCheckHooks(item.checkHooks),
    };
  });
}

function parseCheckHooks(value: unknown): NarratorNpcProfileSuggestion['traits'][number]['checkHooks'] {
  if (!Array.isArray(value)) return undefined;
  return parseArray(value, (item) => {
    if (!isRecord(item) || typeof item.scope !== 'string' || typeof item.note !== 'string') {
      return null;
    }
    return {
      scope: item.scope,
      modifier: parseOptionalNumber(item.modifier),
      note: item.note,
    };
  });
}
function parseNpcMemorySuggestion(value: unknown): NarratorNpcMemorySuggestion | null {
  if (!isRecord(value) || typeof value.content !== 'string' || typeof value.source !== 'string') {
    return null;
  }

  return {
    npcId: typeof value.npcId === 'string' ? value.npcId : undefined,
    npcName: typeof value.npcName === 'string' ? value.npcName : undefined,
    source: value.source,
    content: value.content,
    eventId: typeof value.eventId === 'string' ? value.eventId : undefined,
  };
}

function parseLocationWriteSuggestion(value: unknown): NarratorLocationWriteSuggestion | null {
  if (
    !isRecord(value)
    || typeof value.name !== 'string'
    || typeof value.kind !== 'string'
    || typeof value.summary !== 'string'
  ) {
    return null;
  }

  return {
    locationId: typeof value.locationId === 'string' ? value.locationId : undefined,
    name: value.name,
    aliases: parseStringArray(value.aliases),
    kind: value.kind,
    mapLayer: parseMapLayer(value.mapLayer),
    parentId: typeof value.parentId === 'string' ? value.parentId : undefined,
    parentPath: typeof value.parentPath === 'string' ? value.parentPath : undefined,
    summary: value.summary,
    permanence: parsePermanence(value.permanence),
    connectedRegionIds: parseStringArray(value.connectedRegionIds),
    controlHint: typeof value.controlHint === 'string' ? value.controlHint : undefined,
    tensionHint: typeof value.tensionHint === 'string' ? value.tensionHint : undefined,
  };
}

function parseRouteWriteSuggestion(value: unknown): NarratorRouteWriteSuggestion | null {
  if (
    !isRecord(value)
    || typeof value.fromPlaceId !== 'string'
    || typeof value.toPlaceId !== 'string'
    || typeof value.name !== 'string'
    || typeof value.status !== 'string'
  ) {
    return null;
  }

  return {
    routeId: typeof value.routeId === 'string' ? value.routeId : undefined,
    fromPlaceId: value.fromPlaceId,
    toPlaceId: value.toPlaceId,
    name: value.name,
    routeKind: typeof value.routeKind === 'string' ? value.routeKind : undefined,
    status: value.status,
    source: parseRouteSource(value.source),
    knownLevel: parseKnownLevel(value.knownLevel),
    riskLevel: parseOptionalNumber(value.riskLevel),
    standardTravelMinutes: parseOptionalNumber(value.standardTravelMinutes),
    travelTimeText: typeof value.travelTimeText === 'string' ? value.travelTimeText : undefined,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
  };
}

function parseQuestChangeSuggestion(value: unknown): NarratorQuestChangeSuggestion | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = parseQuestAction(value.action);
  const summary = typeof value.summary === 'string' ? value.summary : undefined;
  if (action === 'add' && !summary) {
    return null;
  }
  if (action !== 'add' && typeof value.questId !== 'string' && typeof value.threadId !== 'string') {
    return null;
  }

  return {
    action,
    questId: typeof value.questId === 'string' ? value.questId : undefined,
    title: typeof value.title === 'string' ? value.title : undefined,
    summary,
    currentStep: typeof value.currentStep === 'string' ? value.currentStep : undefined,
    stakes: typeof value.stakes === 'string' ? value.stakes : undefined,
    deadlineAt: typeof value.deadlineAt === 'string' ? value.deadlineAt : undefined,
    source: typeof value.source === 'string' ? value.source : undefined,
    priority: parseQuestPriority(value.priority),
    relatedNpcIds: parseStringArray(value.relatedNpcIds),
    relatedLocationIds: parseStringArray(value.relatedLocationIds),
    relatedFactionIds: parseStringArray(value.relatedFactionIds),
    outcomeSummary: typeof value.outcomeSummary === 'string' ? value.outcomeSummary : undefined,
    consequenceTags: parseStringArray(value.consequenceTags),
    affectedNpcIds: parseStringArray(value.affectedNpcIds),
    affectedFactionIds: parseStringArray(value.affectedFactionIds),
    affectedPlaceIds: parseStringArray(value.affectedPlaceIds),
    affectedForceIds: parseStringArray(value.affectedForceIds),
    affectedHoldingIds: parseStringArray(value.affectedHoldingIds),
    followUpHooks: parseStringArray(value.followUpHooks),
    severity: parseConsequenceSeverity(value.severity),
    threadId: typeof value.threadId === 'string' ? value.threadId : undefined,
    archiveReason: typeof value.archiveReason === 'string' ? value.archiveReason : undefined,
    experienceReward: parseOptionalNumber(value.experienceReward),
  };
}

function parseSignalChangeSuggestion(value: unknown): NarratorSignalChangeSuggestion | null {
  if (!isRecord(value)) {
    return null;
  }
  const action = parseSignalAction(value.action);
  if (action === 'add' && typeof value.content !== 'string') return null;
  if (action !== 'add' && typeof value.rumorId !== 'string') return null;

  return {
    action,
    rumorId: typeof value.rumorId === 'string' ? value.rumorId : undefined,
    title: typeof value.title === 'string' ? value.title : undefined,
    content: typeof value.content === 'string' ? value.content : undefined,
    source: typeof value.source === 'string' ? value.source : undefined,
    status: parseSignalStatus(value.status),
    signalType: parseSignalType(value.signalType),
    confidence: parseSignalConfidence(value.confidence),
    potentialOutcomeSummary: typeof value.potentialOutcomeSummary === 'string' ? value.potentialOutcomeSummary : undefined,
    consequenceTags: parseStringArray(value.consequenceTags),
    affectedNpcIds: parseStringArray(value.affectedNpcIds),
    affectedFactionIds: parseStringArray(value.affectedFactionIds),
    affectedPlaceIds: parseStringArray(value.affectedPlaceIds),
    affectedForceIds: parseStringArray(value.affectedForceIds),
    affectedHoldingIds: parseStringArray(value.affectedHoldingIds),
    followUpHooks: parseStringArray(value.followUpHooks),
    severity: parseConsequenceSeverity(value.severity),
    relatedLocationIds: parseStringArray(value.relatedLocationIds),
    threadId: typeof value.threadId === 'string' ? value.threadId : undefined,
    expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : undefined,
    npcAwarenessRefs: parseNpcAwarenessRefs(value.npcAwarenessRefs),
    archiveReason: typeof value.archiveReason === 'string' ? value.archiveReason : undefined,
    convertedToQuestIds: parseStringArray(value.convertedToQuestIds),
    convertedToWorldTrendIds: parseStringArray(value.convertedToWorldTrendIds),
  };
}

function parsePlotPlanSuggestion(value: unknown): NarratorPlotPlanSuggestion | null {
  if (!isRecord(value) || typeof value.summary !== 'string') {
    return null;
  }

  return {
    action: parsePlotPlanAction(value.action),
    plotId: typeof value.plotId === 'string' ? value.plotId : undefined,
    title: typeof value.title === 'string' ? value.title : undefined,
    horizon: parsePlotHorizon(value.horizon),
    status: parsePlotStatus(value.status),
    priority: parsePlotPriority(value.priority),
    summary: value.summary,
    notBeforeAt: typeof value.notBeforeAt === 'string' ? value.notBeforeAt : undefined,
    lastAdvancedAt: typeof value.lastAdvancedAt === 'string' ? value.lastAdvancedAt : undefined,
  };
}

function parseWorldEventSummary(value: unknown): NarratorWorldEventSummary | null {
  if (!isRecord(value) || typeof value.summary !== 'string') {
    return null;
  }

  return {
    eventId: typeof value.eventId === 'string' ? value.eventId : undefined,
    title: typeof value.title === 'string' ? value.title : undefined,
    summary: value.summary,
    status: parseWorldTrendStatus(value.status),
    visibility: typeof value.visibility === 'string' ? value.visibility : undefined,
    scope: parseWorldEventScope(value.scope),
    certainty: parseWorldEventCertainty(value.certainty),
    severity: typeof value.severity === 'string' ? value.severity : undefined,
    locationId: typeof value.locationId === 'string' ? value.locationId : undefined,
    presentNpcIds: parseStringArray(value.presentNpcIds),
    involvedNpcIds: parseStringArray(value.involvedNpcIds),
    affectedNpcIds: parseStringArray(value.affectedNpcIds),
    affectedFactionIds: parseStringArray(value.affectedFactionIds),
    affectedPlaceIds: parseStringArray(value.affectedPlaceIds),
    affectedForceIds: parseStringArray(value.affectedForceIds),
    affectedHoldingIds: parseStringArray(value.affectedHoldingIds),
    consequenceTags: parseStringArray(value.consequenceTags),
    outcomeSummary: typeof value.outcomeSummary === 'string' ? value.outcomeSummary : undefined,
    progressSummary: typeof value.progressSummary === 'string' ? value.progressSummary : undefined,
    nextCheckAt: typeof value.nextCheckAt === 'string' ? value.nextCheckAt : undefined,
    lastAdvancedAt: typeof value.lastAdvancedAt === 'string' ? value.lastAdvancedAt : undefined,
    followUpHooks: parseStringArray(value.followUpHooks),
    sourceQuestIds: parseStringArray(value.sourceQuestIds),
    sourceSignalIds: parseStringArray(value.sourceSignalIds),
    sourceConflictIds: parseStringArray(value.sourceConflictIds),
    npcAwarenessRefs: parseNpcAwarenessRefs(value.npcAwarenessRefs),
    threadId: typeof value.threadId === 'string' ? value.threadId : undefined,
    happenedAt: typeof value.happenedAt === 'string' ? value.happenedAt : undefined,
    knownToPlayer: typeof value.knownToPlayer === 'boolean' ? value.knownToPlayer : undefined,
    source: typeof value.source === 'string' ? value.source : undefined,
    archiveReason: typeof value.archiveReason === 'string' ? value.archiveReason : undefined,
  };
}

function parseWorldEventUpdate(value: unknown): NarratorWorldEventUpdate | null {
  if (!isRecord(value) || typeof value.eventId !== 'string') {
    return null;
  }

  return {
    eventId: value.eventId,
    title: typeof value.title === 'string' ? value.title : undefined,
    summary: typeof value.summary === 'string' ? value.summary : undefined,
    status: parseWorldTrendStatus(value.status),
    severity: typeof value.severity === 'string' ? value.severity : undefined,
    scope: parseWorldEventScope(value.scope),
    certainty: parseWorldEventCertainty(value.certainty),
    visibility: typeof value.visibility === 'string' ? value.visibility : undefined,
    locationId: typeof value.locationId === 'string' ? value.locationId : undefined,
    outcomeSummary: typeof value.outcomeSummary === 'string' ? value.outcomeSummary : undefined,
    progressSummary: typeof value.progressSummary === 'string' ? value.progressSummary : undefined,
    nextCheckAt: typeof value.nextCheckAt === 'string' ? value.nextCheckAt : undefined,
    lastAdvancedAt: typeof value.lastAdvancedAt === 'string' ? value.lastAdvancedAt : undefined,
    consequenceTags: parseStringArray(value.consequenceTags),
    affectedNpcIds: parseStringArray(value.affectedNpcIds),
    affectedFactionIds: parseStringArray(value.affectedFactionIds),
    affectedPlaceIds: parseStringArray(value.affectedPlaceIds),
    affectedForceIds: parseStringArray(value.affectedForceIds),
    affectedHoldingIds: parseStringArray(value.affectedHoldingIds),
    followUpHooks: parseStringArray(value.followUpHooks),
    sourceQuestIds: parseStringArray(value.sourceQuestIds),
    sourceSignalIds: parseStringArray(value.sourceSignalIds),
    sourceConflictIds: parseStringArray(value.sourceConflictIds),
    npcAwarenessRefs: parseNpcAwarenessRefs(value.npcAwarenessRefs),
    threadId: typeof value.threadId === 'string' ? value.threadId : undefined,
    archiveReason: typeof value.archiveReason === 'string' ? value.archiveReason : undefined,
  };
}

function parseNpcAwarenessRefs(value: unknown): NpcAwarenessReference[] | undefined {
  const refs = parseArray(value, (item): NpcAwarenessReference | null => {
    if (!isRecord(item) || typeof item.name !== 'string') return null;
    const playerRelevance = parseStringArray(item.playerRelevance);
    const unresolvedHooks = parseStringArray(item.unresolvedHooks);
    return {
      name: item.name,
      npcId: typeof item.npcId === 'string' ? item.npcId : undefined,
      sourceNote: typeof item.sourceNote === 'string' ? item.sourceNote : undefined,
      contactLevel: parseOptionalNumber(item.contactLevel),
      historicalImportance: parseOptionalNumber(item.historicalImportance),
      playerRelevance: playerRelevance.length > 0 ? playerRelevance : undefined,
      unresolvedHooks: unresolvedHooks.length > 0 ? unresolvedHooks : undefined,
    };
  });
  return refs.length > 0 ? refs : undefined;
}

function parseWorldEventScope(value: unknown): NarratorWorldEventSummary['scope'] {
  if (value === 'local' || value === 'regional' || value === 'realm' || value === 'world') return value;
  return undefined;
}

function parseWorldEventCertainty(value: unknown): NarratorWorldEventSummary['certainty'] {
  if (value === 'confirmed' || value === 'reported' || value === 'rumor' || value === 'uncertain') return value;
  return undefined;
}

function parseArray<T>(value: unknown, parser: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parser)
    .filter((item): item is T => item !== null);
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function parsePermanence(value: unknown): NarratorLocationWriteSuggestion['permanence'] {
  if (value === 'rumor' || value === 'temporary') return value;
  return 'permanent';
}

function parseMapLayer(value: unknown): NarratorLocationWriteSuggestion['mapLayer'] {
  if (value === 'region' || value === 'place' || value === 'scene') return value;
  return undefined;
}

function parseRouteSource(value: unknown): NarratorRouteWriteSuggestion['source'] {
  if (value === 'worldbook' || value === 'llm' || value === 'player' || value === 'system') return value;
  return undefined;
}

function parseKnownLevel(value: unknown): NarratorRouteWriteSuggestion['knownLevel'] {
  if (value === '亲历' || value === '听闻' || value === '推测') return value;
  return '推测';
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function parseQuestAction(value: unknown): NarratorQuestChangeSuggestion['action'] {
  if (
    value === 'add'
    || value === 'complete'
    || value === 'fail'
    || value === 'invalidate'
    || value === 'archive'
  ) return value;
  return 'update';
}

function parseQuestPriority(value: unknown): NarratorQuestChangeSuggestion['priority'] {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return undefined;
}

function parseConsequenceSeverity(value: unknown): NarratorQuestChangeSuggestion['severity'] {
  if (value === 'minor' || value === 'moderate' || value === 'major' || value === 'critical') return value;
  return undefined;
}

function parseSignalType(value: unknown): NarratorSignalChangeSuggestion['signalType'] {
  if (value === 'rumor' || value === 'clue' || value === 'report' || value === 'omen') return value;
  return undefined;
}

function parseSignalConfidence(value: unknown): NarratorSignalChangeSuggestion['confidence'] {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return undefined;
}

function parseSignalAction(value: unknown): NarratorSignalChangeSuggestion['action'] {
  if (
    value === 'add'
    || value === 'update'
    || value === 'verify'
    || value === 'markFalse'
    || value === 'expire'
    || value === 'convert'
    || value === 'archive'
  ) return value;
  return 'add';
}

function parseSignalStatus(value: unknown): NarratorSignalChangeSuggestion['status'] {
  if (
    value === 'open'
    || value === 'investigating'
    || value === 'verified'
    || value === 'false'
    || value === 'expired'
    || value === 'converted'
    || value === 'archived'
  ) return value;
  return undefined;
}

function parseWorldTrendStatus(value: unknown): NarratorWorldEventSummary['status'] {
  if (value === 'active' || value === 'cooling' || value === 'historical' || value === 'corrected') return value;
  return undefined;
}

function parsePlotPlanAction(value: unknown): NarratorPlotPlanSuggestion['action'] {
  if (value === 'add' || value === 'complete' || value === 'discard') return value;
  return 'update';
}

function parsePlotHorizon(value: unknown): NarratorPlotPlanSuggestion['horizon'] {
  if (value === '近期' || value === '中期' || value === '后期') return value;
  return undefined;
}

function parsePlotStatus(value: unknown): NarratorPlotPlanSuggestion['status'] {
  if (value === '待触发' || value === '进行中' || value === '已完成' || value === '废弃') return value;
  return undefined;
}

function parsePlotPriority(value: unknown): NarratorPlotPlanSuggestion['priority'] {
  if (value === '低' || value === '中' || value === '高') return value;
  return undefined;
}

function parseMemoryImportance(value: unknown): NarratorTurnSummaryWriteback['memoryImportance'] {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return undefined;
}

function plainTextResponse(content: string): NarratorResponse {
  return {
    narrativeText: sanitizeNarrativeText(content) || '模型没有返回正文。',
    suggestedActions: [],
    statePatches: undefined,
    statePatch: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
