import type {
  BondThreadEntry,
  CalendarEraEntry,
  CharacterEquipmentItem,
  CharacterReputation,
  CombatRecord,
  DomesticReportEntry,
  FactionLedgerEntry,
  FactionRecentActionEntry,
  ConflictRecord,
  HeroineThreadEntry,
  HoldingLedgerEntry,
  HoldingSiegeState,
  InventoryItem,
  LuanShiNpc,
  LuanShiNpcAdultPrivateProfile,
  LuanShiNpcFemaleProfile,
  LuanShiNpcRelationshipNetworkEntry,
  LuanShiNpcWombProfile,
  PrivateAssetEntry,
  PrivateAssetProjectEntry,
  RuntimeState,
  TroopLedgerEntry,
} from '../types';
import { claimsReservedSystemDomesticReportIdentity } from '../domesticReports';
import { normalizeConflictJudgement } from '../conflict/WarJudgementScore';
import { clampReputationScore } from '../character/reputation';
import { mergeStableCharacterUniqueArts } from '../character/NpcUniqueArtPolicy';
import { normalizeCharacterTraits } from '../character/CharacterTraitNormalization';
import { optionalSanitizedCombatReportField } from '../combat/combatReportText';
import { calculateInitialSiegeEnduranceTurns } from '../holdings/HoldingSiegeSupply';
import {
  mergeHoldingCivilAdministrationTransition,
  normalizeLegacyHoldingCivilAdministration,
} from '../holdings/HoldingCivilAdministration';
import {
  clampPrivateAssetToAbsoluteLimits,
  findExistingPrivateAssetByLedgerIdentity,
} from '../holdings/PrivateAssetPolicy';
import { equipInventoryItem, equipmentItemToInventoryItem, upsertInventoryItem } from '../character/playerLoadout';
import { cloneEquipmentItem, cloneInventoryItem } from '../character/loadoutProtocol';
import { v4 as uuidv4 } from '../turn/uuid';
import {
  deriveCurrentAgeFromBirthDate,
  ensureCompleteBirthDate,
  isAdultFemaleNpcAt,
} from '../time/npcAge';
import type { PregnancyModePreference } from '../settings/DisplaySettings';
import { recordPlayerPregnancyRisk, resolvePregnancy } from '../pregnancy/PregnancyLifecycle';
import { resolveNpcBackgroundActivityAgainstCurrentMatters } from './currentMatterLifecycle';
import {
  DEFAULT_TROOP_LEDGER_OPERATIONAL_FIELDS,
  ensureLuanShiState,
  findExistingHoldingByLedgerIdentity,
  resolveCanonicalHoldingId,
  type NormalizedLuanShiState,
} from './createInitialRuntimeState';
import type {
  BondThreadUpsertCommand,
  CalendarEraUpsertCommand,
  CharacterIdentityUpdateCommand,
  CharacterIdentityUpdateFields,
  CharacterReputationUpdateCommand,
  CharacterUniqueArtsUpdateCommand,
  CharacterUniqueArtProgressRecordCommand,
  CombatRecordUpsertCommand,
  ConflictRecordUpsertCommand,
  DomesticReportUpsertCommand,
  FactionLedgerUpsertCommand,
  FactionRecentActionRecordCommand,
  HeroineThreadUpsertCommand,
  HoldingLedgerUpsertCommand,
  HoldingSiegeUpdate,
  LuanShiCommand,
  NpcFemaleProfileUpdateCommand,
  NpcBackgroundActivityUpdateCommand,
  NpcLoadoutUpdateCommand,
  NpcPresenceUpdateCommand,
  NpcProfileUpsertCommand,
  NpcRelationshipUpdateCommand,
  PregnancyResolutionCommand,
  PregnancyRiskRecordCommand,
  PlayerLoadoutUpdateCommand,
  PrivateAssetProjectUpsertCommand,
  StartHeavyCavalryFormationCommand,
  PrivateAssetUpsertCommand,
  PlayerTraitsUpdateCommand,
  ResourceLedgerUpdateCommand,
  TroopLedgerUpsertCommand,
} from './luanshiCommands';
import {
  normalizeTurnEventVisibility,
  normalizeTroopFatigue,
  normalizeTroopQuality,
  normalizeTroopReadiness,
  normalizeTroopScore,
  normalizeTroopStrengthTrend,
  canonicalRelationshipStableKey,
  validateLuanShiCommand,
} from './luanshiCommands';
import { startHeavyCavalryFormation } from '../troops/HeavyCavalryFormation';
import { troopFatiguePercentFromBand } from '../troops/TroopFatigue';
import {
  applyUniqueArtProgressEvidence,
  buildUniqueArtProgressTurnKey,
  characterHasConsumedUniqueArtProgressSource,
  characterHasUniqueArtProgressEvent,
} from '../character/UniqueArtProgression';
import { findHeroineThreadByIdentity } from './HeroineThreadIdentity';
import { isCanonicalLedgerShadowResourceKey } from './resourceLedgerIdentity';
import {
  factionRecentActionKey,
  formatFactionRecentActionText,
  mergeFactionRecentActionRecords,
  parseFactionRecentActionText,
} from './factionRecentActionHistory';
import {
  isTerminalTroopLedgerEntry,
  replaceTerminalTroopReferenceIds,
} from './troopLifecycle';

const identityFieldNames = [
  'name',
  'courtesyName',
  'artName',
  'aliases',
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
  'personalEscortEntitlement',
] as const satisfies readonly (keyof CharacterIdentityUpdateFields)[];

const genericTroopTypeWords = new Set([
  '部队',
  '军队',
  '队伍',
  '人马',
  '兵马',
  '军马',
  '军伍',
  '士卒',
  '兵卒',
  '兵员',
  'other',
]);

type LoadoutOwner = {
  equipment?: CharacterEquipmentItem[];
  inventory?: InventoryItem[];
};

export interface ApplyLuanShiCommandOptions {
  openingInitialization?: boolean;
  pregnancyMode?: PregnancyModePreference;
}

export function applyLuanShiCommand(
  state: RuntimeState,
  command: LuanShiCommand,
  options: ApplyLuanShiCommandOptions = {},
): NormalizedLuanShiState {
  const normalized = ensureLuanShiState(state);
  command = mergeExistingHoldingLedgerCommand(normalized, command);
  const validation = validateLuanShiCommand(normalized, command);

  if (!validation.valid) {
    return normalized;
  }

  if (command.action === 'recordTurnEvent') {
    const presentNpcIds = command.presentNpcIds ?? [];
    const visibility = normalizeTurnEventVisibility(command.visibility) ?? command.visibility;
    return {
      ...normalized,
      turnEvents: [
        ...normalized.turnEvents,
        {
          eventId: command.eventId ?? uuidv4(),
          happenedAt: command.happenedAt ?? normalized.currentDate,
          locationId: command.locationId,
          summary: command.summary,
          presentNpcIds,
          involvedNpcIds: command.involvedNpcIds ?? presentNpcIds,
          visibility,
        },
      ],
    };
  }

  if (command.action === 'updateCharacterIdentity') {
    return applyCharacterIdentityUpdate(normalized, command);
  }

  if (command.action === 'updatePlayerLoadout') {
    return applyPlayerLoadoutUpdate(normalized, command, options);
  }

  if (command.action === 'updatePlayerTraits') {
    return applyPlayerTraitsUpdate(normalized, command);
  }

  if (command.action === 'updateCharacterUniqueArts') {
    return applyCharacterUniqueArtsUpdate(normalized, command);
  }

  if (command.action === 'recordCharacterUniqueArtProgress') {
    return applyCharacterUniqueArtProgressRecord(normalized, command);
  }

  if (command.action === 'updateResourceLedger') {
    return applyResourceLedgerUpdate(normalized, command);
  }

  if (command.action === 'upsertFactionLedger') {
    return applyFactionLedgerUpsert(normalized, command);
  }

  if (command.action === 'recordFactionRecentAction') {
    return applyFactionRecentActionRecord(normalized, command);
  }

  if (command.action === 'upsertTroopLedger') {
    return applyTroopLedgerUpsert(normalized, command);
  }

  if (command.action === 'startHeavyCavalryFormation') {
    return applyHeavyCavalryFormationStart(normalized, command);
  }

  if (command.action === 'upsertHoldingLedger') {
    return applyHoldingLedgerUpsert(normalized, command);
  }

  if (command.action === 'upsertDomesticReport') {
    return applyDomesticReportUpsert(normalized, command);
  }

  if (command.action === 'upsertPrivateAsset') {
    return applyPrivateAssetUpsert(normalized, command);
  }

  if (command.action === 'upsertPrivateAssetProject') {
    return applyPrivateAssetProjectUpsert(normalized, command);
  }

  if (command.action === 'upsertConflictRecord') {
    return applyConflictRecordUpsert(normalized, command);
  }

  if (command.action === 'upsertCombatRecord') {
    return applyCombatRecordUpsert(normalized, command);
  }

  if (command.action === 'upsertCalendarEra') {
    return applyCalendarEraUpsert(normalized, command);
  }

  if (command.action === 'upsertHeroineThread') {
    return applyHeroineThreadUpsert(normalized, command);
  }

  if (command.action === 'upsertBondThread') {
    return applyBondThreadUpsert(normalized, command);
  }

  if (command.action === 'updateCharacterReputation') {
    return applyCharacterReputationUpdate(normalized, command);
  }

  if (command.action === 'upsertNpcProfile') {
    return applyNpcProfileUpsert(normalized, command);
  }

  if (command.action === 'updateNpcRelationship') {
    return applyNpcRelationshipUpdate(normalized, command);
  }

  if (command.action === 'updateNpcPresence') {
    return applyNpcPresenceUpdate(normalized, command);
  }

  if (command.action === 'updateNpcBackgroundActivity') {
    return applyNpcBackgroundActivityUpdate(normalized, command);
  }

  if (command.action === 'updateNpcFemaleProfile') {
    return applyNpcFemaleProfileUpdate(normalized, command);
  }

  if (command.action === 'recordPregnancyRisk') {
    return recordPlayerPregnancyRisk(
      normalized,
      command as PregnancyRiskRecordCommand,
      options.pregnancyMode ?? 'standard',
    ) as NormalizedLuanShiState;
  }

  if (command.action === 'resolvePregnancy') {
    return resolvePregnancy(normalized, command as PregnancyResolutionCommand) as NormalizedLuanShiState;
  }

  if (command.action === 'updateNpcLoadout') {
    return applyNpcLoadoutUpdate(normalized, command);
  }

  return {
    ...normalized,
    npcs: normalized.npcs.map((npc) => {
      if (npc.npcId !== command.npcId) {
        return npc;
      }

      if (hasDuplicateNpcMemory(npc, command, normalized.currentDate)) {
        return npc;
      }

      return {
        ...npc,
        memories: [
          ...npc.memories,
          {
            memoryId: uuidv4(),
            eventId: command.eventId,
            source: command.source,
            content: command.value,
            createdAt: normalized.currentDate,
          },
        ],
      };
    }),
  };
}

function mergeExistingHoldingLedgerCommand(
  state: NormalizedLuanShiState,
  command: LuanShiCommand,
): LuanShiCommand {
  if (command.action !== 'upsertHoldingLedger') return command;

  const incoming = command as Partial<HoldingLedgerUpsertCommand> & { action: 'upsertHoldingLedger' };
  const holdingId = resolveRequiredString(incoming.holdingId, '');
  if (!holdingId) return command;

  const previous = findExistingHoldingByLedgerIdentity(state.holdings, {
    holdingId,
    name: resolveRequiredString(incoming.name, ''),
    type: incoming.type,
    locationId: typeof incoming.locationId === 'string' ? incoming.locationId : undefined,
  } as HoldingLedgerEntry);
  if (!previous) return command;
  const canonicalHoldingId = resolveCanonicalHoldingId(previous, {
    holdingId,
    type: incoming.type ?? previous.type,
    locationId: typeof incoming.locationId === 'string' ? incoming.locationId : previous.locationId,
  } as HoldingLedgerEntry);

  const previousForMerge = normalizeLegacyHoldingCivilAdministration(previous);
  const { controlEvidence: _previousControlEvidence, ...previousWithoutControlEvidence } = previousForMerge;
  const merged = {
    ...previousWithoutControlEvidence,
    ...incoming,
    action: 'upsertHoldingLedger',
    holdingId: canonicalHoldingId,
    name: resolveRequiredString(incoming.name, previous.name),
    summary: resolveRequiredString(incoming.summary, previous.summary),
    updatedAt: resolveRequiredString(incoming.updatedAt, previous.updatedAt),
  } as HoldingLedgerUpsertCommand;
  return mergeHoldingCivilAdministrationTransition(
    previous,
    incoming,
    merged as unknown as HoldingLedgerEntry,
  ) as HoldingLedgerUpsertCommand;
}

function applyResourceLedgerUpdate(
  state: NormalizedLuanShiState,
  command: ResourceLedgerUpdateCommand,
): NormalizedLuanShiState {
  const playerResources = omitReservedPlayerResourceKeys({
    ...state.playerResources,
    ...Object.fromEntries(
      Object.entries(command.playerResources ?? {})
        .filter(([key]) => !isCanonicalLedgerShadowResourceKey(key))
        .map(([key, value]) => [key.trim(), value]),
    ),
  });

  return {
    ...state,
    resources: {
      ...state.resources,
      ...(command.moneyGuan !== undefined ? { money: command.moneyGuan } : {}),
      ...(command.grain !== undefined ? { grain: command.grain } : {}),
      ...(command.horses !== undefined ? { horses: command.horses } : {}),
      ...(command.arms !== undefined ? { arms: command.arms } : {}),
      ...(command.recruits !== undefined ? { recruits: command.recruits } : {}),
      ...(command.weapons !== undefined ? { weapons: cleanStringList(command.weapons) } : {}),
      ...(command.documents !== undefined ? { documents: cleanStringList(command.documents) } : {}),
      ...(command.tokens !== undefined ? { tokens: cleanStringList(command.tokens) } : {}),
      ...(command.importantSupplies !== undefined ? { importantSupplies: cleanStringList(command.importantSupplies) } : {}),
    },
    playerResources,
  };
}

function applyFactionLedgerUpsert(
  state: NormalizedLuanShiState,
  command: FactionLedgerUpsertCommand,
): NormalizedLuanShiState {
  const previousEntry = state.factions.find((faction) => faction.factionId === command.factionId.trim());
  const actionObservedAt = command.lastKnownAt?.trim()
    || command.updatedAt?.trim()
    || state.currentDate;
  const incomingActionRecords = command.recentActions.flatMap((action) => {
    const record = parseFactionRecentActionText(action, command.knownLevel);
    if (!record) return [];
    return [{
      ...record,
      observedAt: actionObservedAt,
      ...(command.sourceNote?.trim() ? { sourceNote: command.sourceNote.trim() } : {}),
    }];
  });
  const recentActionRecords = mergeFactionRecentActionRecords(
    previousEntry?.recentActionRecords ?? [],
    incomingActionRecords,
  );
  const nextEntry: FactionLedgerEntry = {
    factionId: command.factionId.trim(),
    name: command.name.trim(),
    ...(command.aliases && command.aliases.length > 0 ? { aliases: cleanStringList(command.aliases) } : {}),
    type: command.type.trim(),
    summary: command.summary.trim(),
    stanceToPlayer: command.stanceToPlayer.trim(),
    knownLevel: command.knownLevel,
    ...optionalStringField('nominalAllegiance', command.nominalAllegiance),
    ...optionalStringField('legalIdentity', command.legalIdentity),
    ...optionalStringField('actualController', command.actualController),
    ...optionalStringField('knownSphere', command.knownSphere),
    ...(command.corePersonNpcIds && command.corePersonNpcIds.length > 0 ? { corePersonNpcIds: cleanStringList(command.corePersonNpcIds) } : {}),
    ...(command.knownMemberNpcIds && command.knownMemberNpcIds.length > 0 ? { knownMemberNpcIds: cleanStringList(command.knownMemberNpcIds) } : {}),
    ...(command.relatedTroopIds && command.relatedTroopIds.length > 0 ? { relatedTroopIds: cleanStringList(command.relatedTroopIds) } : {}),
    ...optionalStringField('sourceNote', command.sourceNote),
    ...optionalStringField('lastKnownAt', command.lastKnownAt),
    ...optionalStringField('updatedAt', command.updatedAt),
    recentActions: recentActionRecords.map(formatFactionRecentActionText),
    recentActionRecords,
  };
  const exists = state.factions.some((faction) => faction.factionId === nextEntry.factionId);

  return {
    ...state,
    factions: exists
      ? state.factions.map((faction) => (faction.factionId === nextEntry.factionId ? nextEntry : faction))
      : [...state.factions, nextEntry],
  };
}

function applyFactionRecentActionRecord(
  state: NormalizedLuanShiState,
  command: FactionRecentActionRecordCommand,
): NormalizedLuanShiState {
  const factionId = command.factionId.trim();
  const observedAt = command.observedAt?.trim() || state.currentDate;
  const sourceNote = command.sourceNote?.trim();
  const incomingRecord: FactionRecentActionEntry = {
    summary: command.summary.trim(),
    knownLevel: command.knownLevel,
    observedAt,
    ...(sourceNote ? { sourceNote } : {}),
  };

  return {
    ...state,
    factions: state.factions.map((faction) => {
      if (faction.factionId !== factionId) return faction;
      if (faction.recentActionRecords?.some(
        (record) => factionRecentActionKey(record) === factionRecentActionKey(incomingRecord),
      )) return faction;
      const recentActionRecords = mergeFactionRecentActionRecords(
        faction.recentActionRecords ?? [],
        [incomingRecord],
      );

      return {
        ...faction,
        recentActions: recentActionRecords.map(formatFactionRecentActionText),
        recentActionRecords,
        lastKnownAt: observedAt,
        updatedAt: state.currentDate,
        ...(sourceNote ? { sourceNote } : {}),
      };
    }),
  };
}

function applyTroopLedgerUpsert(
  state: NormalizedLuanShiState,
  command: TroopLedgerUpsertCommand,
): NormalizedLuanShiState {
  const troopId = command.troopId.trim();
  const previousEntry = state.troops.find((troop) => troop.troopId === troopId);
  const detailLevel = command.detailLevel ?? previousEntry?.detailLevel ?? 'operational';
  const detailDefaults = detailLevel === 'intelligence'
    ? {
        ...DEFAULT_TROOP_LEDGER_OPERATIONAL_FIELDS,
        lifecycleStatus: 'unknown' as const,
        knownLevel: '听闻' as const,
        certainty: 'reported' as const,
      }
    : DEFAULT_TROOP_LEDGER_OPERATIONAL_FIELDS;
  const sizeResolution = resolveTroopLedgerSize(previousEntry, command);
  const explicitLocationId = command.locationId?.trim();
  const explicitLastKnownLocationId = command.lastKnownLocationId?.trim();
  const explicitDestinationLocationId = command.destinationLocationId?.trim();
  const destinationLocationId = explicitDestinationLocationId ?? previousEntry?.destinationLocationId;
  const destinationChanged = explicitDestinationLocationId !== undefined
    && explicitDestinationLocationId !== previousEntry?.destinationLocationId;
  const resolvedLocationId = explicitLocationId
    ?? (command.movementStatus === 'arrived' ? destinationLocationId : undefined);
  const resolvedLastKnownLocationId = explicitLastKnownLocationId ?? resolvedLocationId;
  const locationObservedAt = command.lastKnownAt?.trim()
    ?? command.arrivedAt?.trim()
    ?? command.updatedAt?.trim()
    ?? state.currentDate;
  const updatedAt = resolveCommandUpdatedAt(command.updatedAt, state.currentDate);
  const previousChangeHistory = previousEntry?.changeHistory ?? [];
  const incomingChangeEvent = command.changeEvent
    ? {
        eventId: command.changeEvent.eventId.trim(),
        kind: command.changeEvent.kind,
        occurredAt: command.changeEvent.occurredAt.trim(),
        summary: command.changeEvent.summary.trim(),
        ...(command.changeEvent.sourceNote?.trim() ? { sourceNote: command.changeEvent.sourceNote.trim() } : {}),
      }
    : undefined;
  const changeHistory = incomingChangeEvent
    && !previousChangeHistory.some((event) => event.eventId === incomingChangeEvent.eventId)
    ? [...previousChangeHistory, incomingChangeEvent].slice(-40)
    : previousChangeHistory;
  const normalizedFatigue = normalizeTroopFatigue(command.fatigue);
  const nextEntry: TroopLedgerEntry = {
    ...detailDefaults,
    ...(previousEntry ?? {}),
    troopId,
    name: command.name !== undefined ? command.name.trim() : previousEntry?.name ?? '',
    ...(command.aliases && command.aliases.length > 0 ? { aliases: cleanStringList(command.aliases) } : {}),
    detailLevel,
    size: sizeResolution.size,
    ...(command.strengthEstimate ? {
      strengthEstimate: {
        min: command.strengthEstimate.min,
        max: command.strengthEstimate.max,
        ...(command.strengthEstimate.asOf?.trim() ? { asOf: command.strengthEstimate.asOf.trim() } : {}),
        ...(command.strengthEstimate.basis?.trim() ? { basis: command.strengthEstimate.basis.trim() } : {}),
      },
    } : {}),
    ...(sizeResolution.previousSize !== undefined ? { previousSize: sizeResolution.previousSize } : {}),
    ...optionalStringField('factionId', command.factionId),
    ...optionalStringField('previousFactionId', command.previousFactionId),
    ...optionalStringField('allegianceChangedAt', command.allegianceChangedAt),
    ...optionalStringField('allegianceChangeReason', command.allegianceChangeReason),
    ...optionalStringField('troopType', normalizeTroopType(command.troopType)),
    ...optionalEnumField('logisticsClass', command.logisticsClass),
    ...(command.acquisitionEvidence ? { acquisitionEvidence: { ...command.acquisitionEvidence } } : {}),
    ...optionalStringField('specialDesignation', command.specialDesignation),
    ...optionalEnumField('quality', normalizeTroopQuality(command.quality)),
    ...optionalEnumField('fatigue', normalizedFatigue),
    ...(normalizedFatigue ? { warFatiguePercent: troopFatiguePercentFromBand(normalizedFatigue) } : {}),
    ...optionalEnumField('readiness', normalizeTroopReadiness(command.readiness)),
    ...optionalEnumField('lifecycleStatus', command.lifecycleStatus),
    ...(command.statusTags && command.statusTags.length > 0 ? { statusTags: cleanStringList(command.statusTags) } : {}),
    ...(command.leaderNpcId ? { leaderNpcId: command.leaderNpcId.trim() } : {}),
    ...(command.deputyNpcIds ? { deputyNpcIds: cleanStringList(command.deputyNpcIds).slice(0, 2) } : {}),
    ...(command.strategistNpcId ? { strategistNpcId: command.strategistNpcId.trim() } : {}),
    ...(resolvedLocationId ? { locationId: resolvedLocationId } : {}),
    ...(resolvedLastKnownLocationId ? { lastKnownLocationId: resolvedLastKnownLocationId } : {}),
    ...((resolvedLocationId || explicitLastKnownLocationId) ? { lastKnownAt: locationObservedAt } : {}),
    ...optionalEnumField('knownLevel', command.knownLevel),
    ...optionalEnumField('certainty', command.certainty),
    ...optionalEnumField('orderStatus', command.orderStatus),
    ...optionalStringField('orderIssuedAt', command.orderIssuedAt),
    ...optionalStringField('orderDeliveredAt', command.orderDeliveredAt),
    ...optionalStringField('orderSummary', command.orderSummary),
    ...optionalStringField('destinationLocationId', command.destinationLocationId),
    ...optionalStringField('routeId', command.routeId),
    ...optionalEnumField('movementStatus', command.movementStatus),
    ...optionalStringField('departedAt', command.departedAt),
    ...optionalStringField('estimatedArrivalAt', command.estimatedArrivalAt),
    ...(command.movementStatus === 'arrived'
      ? { arrivedAt: command.arrivedAt?.trim() || state.currentDate }
      : optionalStringField('arrivedAt', command.arrivedAt)),
    ...optionalStringField('movementNotes', command.movementNotes),
    morale: command.morale !== undefined ? normalizeTroopScore(command.morale) ?? previousEntry?.morale ?? 0 : previousEntry?.morale ?? 0,
    training: command.training !== undefined ? normalizeTroopScore(command.training) ?? previousEntry?.training ?? 0 : previousEntry?.training ?? 0,
    supplies: command.supplies !== undefined ? normalizeTroopSupplies(command.supplies) : previousEntry?.supplies ?? '',
    ...optionalEnumField('upkeepSource', command.upkeepSource),
    task: command.task !== undefined ? command.task.trim() : previousEntry?.task ?? (detailLevel === 'intelligence' ? '动向未明' : ''),
    relationToPlayer: command.relationToPlayer !== undefined ? command.relationToPlayer.trim() : previousEntry?.relationToPlayer ?? '',
    ...optionalStringField('operationalParentForceId', command.operationalParentForceId),
    ...optionalStringField('parentTroopId', command.parentTroopId),
    ...(command.childTroopIds && command.childTroopIds.length > 0 ? { childTroopIds: cleanStringList(command.childTroopIds) } : {}),
    ...(command.mergedFromTroopIds && command.mergedFromTroopIds.length > 0
      ? { mergedFromTroopIds: cleanStringList(command.mergedFromTroopIds) }
      : {}),
    ...optionalStringField('mergedIntoTroopId', command.mergedIntoTroopId),
    ...optionalStringField('destroyedInBattleId', command.destroyedInBattleId),
    ...optionalStringField('lastBattleId', command.lastBattleId),
    ...optionalEnumField('strengthTrend', sizeResolution.strengthTrend ?? normalizeTroopStrengthTrend(command.strengthTrend)),
    ...optionalStringField('sourceNote', sizeResolution.sourceNote ?? command.sourceNote),
    ...optionalStringField('lastChangeReason', sizeResolution.lastChangeReason ?? command.lastChangeReason),
    ...(changeHistory.length > 0 ? { changeHistory } : {}),
    updatedAt,
  };
  if (nextEntry.troopType && isGenericTroopType(nextEntry.troopType)) {
    delete nextEntry.troopType;
  }
  if (destinationChanged) {
    if (command.routeId === undefined) delete nextEntry.routeId;
    if (command.orderStatus === undefined) delete nextEntry.orderStatus;
    if (command.orderIssuedAt === undefined) delete nextEntry.orderIssuedAt;
    if (command.orderDeliveredAt === undefined) delete nextEntry.orderDeliveredAt;
    if (command.orderSummary === undefined) delete nextEntry.orderSummary;
    if (command.movementStatus === undefined) delete nextEntry.movementStatus;
    if (command.departedAt === undefined) delete nextEntry.departedAt;
    if (command.estimatedArrivalAt === undefined) delete nextEntry.estimatedArrivalAt;
    if (command.movementStatus !== 'arrived' && command.arrivedAt === undefined) delete nextEntry.arrivedAt;
    if (command.movementNotes === undefined) delete nextEntry.movementNotes;
  }

  const terminal = isTerminalTroopLedgerEntry(nextEntry);
  let nextTroops = previousEntry
    ? state.troops.map((troop) => (troop.troopId === nextEntry.troopId ? nextEntry : troop))
    : [...state.troops, nextEntry];

  // 谱系由稳定 ID 的正向关系反向补齐，避免依赖模型在同一批命令中重复填写两端。
  const inferredMergedFromIds = nextTroops
    .filter((troop) => troop.troopId !== troopId && troop.mergedIntoTroopId === troopId)
    .map((troop) => troop.troopId);
  const inferredChildIds = nextTroops
    .filter((troop) => troop.troopId !== troopId && troop.parentTroopId === troopId)
    .map((troop) => troop.troopId);
  if (inferredMergedFromIds.length > 0 || inferredChildIds.length > 0) {
    nextTroops = nextTroops.map((troop) => troop.troopId !== troopId ? troop : {
      ...troop,
      ...(inferredMergedFromIds.length > 0
        ? { mergedFromTroopIds: mergeStableIdLists(troop.mergedFromTroopIds, inferredMergedFromIds) }
        : {}),
      ...(inferredChildIds.length > 0
        ? { childTroopIds: mergeStableIdLists(troop.childTroopIds, inferredChildIds) }
        : {}),
    });
  }
  if (nextEntry.mergedIntoTroopId || nextEntry.parentTroopId) {
    nextTroops = nextTroops.map((troop) => {
      if (troop.troopId === nextEntry.mergedIntoTroopId) {
        return {
          ...troop,
          mergedFromTroopIds: mergeStableIdLists(troop.mergedFromTroopIds, [troopId]),
        };
      }
      if (troop.troopId === nextEntry.parentTroopId) {
        return {
          ...troop,
          childTroopIds: mergeStableIdLists(troop.childTroopIds, [troopId]),
        };
      }
      return troop;
    });
  }

  return {
    ...state,
    troops: nextTroops,
    factions: terminal
      ? state.factions.map((faction) => {
          const relatedTroopIds = replaceTerminalTroopReferenceIds(faction.relatedTroopIds, nextEntry);
          return relatedTroopIds === faction.relatedTroopIds
            ? faction
            : { ...faction, relatedTroopIds };
        })
      : state.factions,
    holdings: terminal
      ? state.holdings.map((holding) => {
          const garrisonTroopIds = replaceTerminalTroopReferenceIds(holding.garrisonTroopIds, nextEntry);
          return garrisonTroopIds === holding.garrisonTroopIds
            ? holding
            : { ...holding, garrisonTroopIds };
        })
      : state.holdings,
  };
}

function applyHeavyCavalryFormationStart(
  state: NormalizedLuanShiState,
  command: StartHeavyCavalryFormationCommand,
): NormalizedLuanShiState {
  const result = startHeavyCavalryFormation(state, command);
  return result.ok ? ensureLuanShiState(result.state) : state;
}

function mergeStableIdLists(existing: string[] | undefined, incoming: string[]): string[] {
  return Array.from(new Set(cleanStringList([...(existing ?? []), ...incoming])));
}

function resolveTroopLedgerSize(
  previousEntry: TroopLedgerEntry | undefined,
  command: TroopLedgerUpsertCommand,
): {
  size: number;
  previousSize?: number;
  strengthTrend?: TroopLedgerEntry['strengthTrend'];
  sourceNote?: string;
  lastChangeReason?: string;
} {
  const requestedSize = command.size ?? previousEntry?.size ?? 0;
  if (
    !previousEntry
    || command.size === undefined
    || command.size <= previousEntry.size
    || !isLikelyRepeatedRecruitBatch(previousEntry, command)
  ) {
    return {
      size: requestedSize,
      ...(command.previousSize !== undefined ? { previousSize: command.previousSize } : {}),
    };
  }

  return {
    size: previousEntry.size,
    ...(previousEntry.previousSize !== undefined ? { previousSize: previousEntry.previousSize } : {}),
    strengthTrend: 'stable',
    sourceNote: command.sourceNote,
    lastChangeReason: command.lastChangeReason?.trim()
      ? `维持兵力 ${previousEntry.size} 人；${command.lastChangeReason.trim()}`
      : previousEntry.lastChangeReason,
  };
}

function isLikelyRepeatedRecruitBatch(
  previousEntry: TroopLedgerEntry,
  command: TroopLedgerUpsertCommand,
): boolean {
  const previousText = collectTroopPersonnelText(previousEntry);
  const commandText = collectTroopPersonnelText(command);
  if (!previousText || !commandText) return false;
  if (!hasCompletedRecruitmentBatch(previousText)) return false;
  if (!rementionsKnownRecruitBatch(commandText)) return false;
  return !hasDistinctFreshPersonnelSource(commandText);
}

function collectTroopPersonnelText(entry: {
  task?: string;
  sourceNote?: string;
  lastChangeReason?: string;
  statusTags?: string[];
}): string {
  return [
    entry.task,
    entry.sourceNote,
    entry.lastChangeReason,
    ...(entry.statusTags ?? []),
  ]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('；');
}

function hasCompletedRecruitmentBatch(text: string): boolean {
  return /(?:完成|已|已经|正式).{0,12}(?:招募|入营|编入|整编)/.test(text)
    || /(?:新兵|新卒|青壮).{0,8}(?:入营|编入|整编)/.test(text)
    || /(?:入营|编入|整编).{0,8}(?:新兵|新卒|青壮)/.test(text);
}

function rementionsKnownRecruitBatch(text: string): boolean {
  return /(?:新兵|新卒|兵卒|青壮).{0,12}(?:入营|编入|操练|训练|立规矩|磨合|以老带新)/.test(text)
    || /(?:入营|编入|操练|训练|立规矩|磨合|以老带新).{0,12}(?:新兵|新卒|兵卒|青壮)/.test(text)
    || /(?:一|二|三|四|五|六|七|八|九|十|百|千|两|\d+).{0,6}(?:新兵|新卒|兵卒|青壮)/.test(text);
}

function hasDistinctFreshPersonnelSource(text: string): boolean {
  return /(?:再次|再度|另|又|第二批|新一批|增拨|增派|调拨|拨给|拨来|转隶|收编|招降|俘虏|降卒|投降|归队|合并|并入|另募|再募|续募|新募|新调|追加|补入|补拨|获准.{0,8}扩编|奉命.{0,8}扩编|州府.{0,8}拨|主公.{0,8}准许)/.test(text);
}

function applyHoldingLedgerUpsert(
  state: NormalizedLuanShiState,
  command: HoldingLedgerUpsertCommand,
): NormalizedLuanShiState {
  const holdingId = resolveRequiredString(command.holdingId, '');
  const previousEntry = findExistingHoldingByLedgerIdentity(state.holdings, command);
  const canonicalHoldingId = previousEntry
    ? resolveCanonicalHoldingId(previousEntry, command)
    : holdingId;
  const mergedEntry: HoldingLedgerEntry = {
    ...(previousEntry ?? {}),
    holdingId: canonicalHoldingId,
    name: resolveRequiredString(command.name, previousEntry?.name ?? ''),
    ...(command.aliases && command.aliases.length > 0 ? { aliases: cleanStringList(command.aliases) } : {}),
    type: command.type ?? previousEntry?.type,
    status: command.status ?? previousEntry?.status,
    summary: resolveRequiredString(command.summary, previousEntry?.summary ?? ''),
    ...optionalStringField('locationId', command.locationId),
    ...optionalStringField('factionId', command.factionId),
    ...optionalStringField('nominalAllegiance', command.nominalAllegiance),
    ...optionalStringField('actualController', command.actualController),
    ...(command.controlEvidence !== undefined
      ? {
          controlEvidence: {
            kind: command.controlEvidence.kind,
            occurredAt: command.controlEvidence.occurredAt.trim(),
            sourceRefId: command.controlEvidence.sourceRefId.trim(),
            summary: command.controlEvidence.summary.trim(),
          },
        }
      : {}),
    ...optionalStringField('stewardNpcId', command.stewardNpcId),
    ...(command.governanceOfficerNpcIds !== undefined
      ? { governanceOfficerNpcIds: cleanStringList(command.governanceOfficerNpcIds) }
      : {}),
    civilAdministrationScope: command.civilAdministrationScope ?? previousEntry?.civilAdministrationScope,
    civilScaleLevel: command.civilScaleLevel ?? previousEntry?.civilScaleLevel,
    scaleLevel: command.scaleLevel ?? previousEntry?.scaleLevel,
    agriculture: command.agriculture ?? previousEntry?.agriculture,
    commerce: command.commerce ?? previousEntry?.commerce,
    population: command.population ?? previousEntry?.population,
    publicOrder: command.publicOrder ?? previousEntry?.publicOrder,
    popularSupport: command.popularSupport ?? previousEntry?.popularSupport,
    defense: command.defense ?? previousEntry?.defense,
    recruitPotential: command.recruitPotential ?? previousEntry?.recruitPotential,
    armory: command.armory ?? previousEntry?.armory,
    horseSupply: command.horseSupply ?? previousEntry?.horseSupply,
    corruption: command.corruption ?? previousEntry?.corruption,
    ...(command.farmlandMu !== undefined ? { farmlandMu: command.farmlandMu } : {}),
    ...(command.registeredHouseholds !== undefined ? { registeredHouseholds: command.registeredHouseholds } : {}),
    ...(command.eliteControlledShare !== undefined ? { eliteControlledShare: command.eliteControlledShare } : {}),
    ...(command.localEliteRelation !== undefined ? { localEliteRelation: command.localEliteRelation } : {}),
    ...(command.garrisonTroopIds && command.garrisonTroopIds.length > 0 ? { garrisonTroopIds: cleanStringList(command.garrisonTroopIds) } : {}),
    ...(command.relatedNpcIds && command.relatedNpcIds.length > 0 ? { relatedNpcIds: cleanStringList(command.relatedNpcIds) } : {}),
    ...(command.riskNotes && command.riskNotes.length > 0 ? { riskNotes: cleanStringList(command.riskNotes) } : {}),
    ...(command.recentChanges && command.recentChanges.length > 0 ? { recentChanges: cleanStringList(command.recentChanges) } : {}),
    ...optionalStringField('sourceNote', command.sourceNote),
    updatedAt: resolveRequiredString(command.updatedAt, previousEntry?.updatedAt ?? state.currentDate),
  };
  const nextEntry = normalizeLegacyHoldingCivilAdministration(mergedEntry);
  if (command.siege !== undefined) {
    const nextSiege = resolveHoldingSiegeState(
      previousEntry?.siege,
      command.siege,
      nextEntry,
      state.turnLog.length + 1,
    );
    if (nextSiege) {
      nextEntry.siege = nextSiege;
    } else {
      delete nextEntry.siege;
    }
  }

  return {
    ...state,
    holdings: previousEntry
      ? state.holdings.map((holding) => (holding.holdingId === previousEntry.holdingId ? nextEntry : holding))
      : [...state.holdings, nextEntry],
  };
}

function resolveHoldingSiegeState(
  previous: HoldingSiegeState | undefined,
  update: HoldingSiegeUpdate,
  holding: Pick<HoldingLedgerEntry, 'type' | 'scaleLevel'>,
  currentTurn: number,
): HoldingSiegeState | undefined {
  if (update.status === 'none') return undefined;
  if (!update.supplyLine || !update.preparation) return previous;

  const continuesCutoff = previous?.supplyLine === 'cut' && update.supplyLine === 'cut';
  const preparation = continuesCutoff ? previous.preparation : update.preparation;
  if (update.supplyLine !== 'cut') {
    return {
      status: update.status,
      supplyLine: update.supplyLine,
      preparation,
    };
  }

  return {
    status: update.status,
    supplyLine: 'cut',
    preparation,
    cutOffAtTurn: continuesCutoff ? previous.cutOffAtTurn ?? currentTurn : currentTurn,
    initialEnduranceTurns: continuesCutoff
      ? previous.initialEnduranceTurns ?? calculateInitialSiegeEnduranceTurns(holding, preparation)
      : calculateInitialSiegeEnduranceTurns(holding, preparation),
  };
}

function applyDomesticReportUpsert(
  state: NormalizedLuanShiState,
  command: DomesticReportUpsertCommand,
): NormalizedLuanShiState {
  if (claimsReservedSystemDomesticReportIdentity(command)) return state;

  const nextEntry: DomesticReportEntry = {
    reportId: command.reportId.trim(),
    source: 'llm',
    ...(typeof command.kind === 'string' && command.kind.trim() ? { kind: command.kind.trim() } : {}),
    year: command.year,
    settledAt: command.settledAt.trim(),
    title: command.title.trim(),
    summary: command.summary.trim(),
    income: cloneDomesticReportDelta(command.income),
    expenses: cloneDomesticReportDelta(command.expenses),
    netChange: cloneDomesticReportDelta(command.netChange),
    ...(command.holdingHighlights && command.holdingHighlights.length > 0
      ? {
          holdingHighlights: command.holdingHighlights.map((highlight) => ({
            holdingId: highlight.holdingId.trim(),
            summary: highlight.summary.trim(),
          })),
        }
      : {}),
    ...(command.privateAssetHighlights && command.privateAssetHighlights.length > 0
      ? {
          privateAssetHighlights: command.privateAssetHighlights.map((highlight) => ({
            privateAssetId: highlight.privateAssetId.trim(),
            summary: highlight.summary.trim(),
          })),
        }
      : {}),
    ...(command.projectHighlights && command.projectHighlights.length > 0
      ? {
          projectHighlights: command.projectHighlights.map((highlight) => ({
            projectId: highlight.projectId.trim(),
            ...(highlight.assetId ? { assetId: highlight.assetId.trim() } : {}),
            summary: highlight.summary.trim(),
          })),
        }
      : {}),
    ...(command.warnings && command.warnings.length > 0 ? { warnings: cleanStringList(command.warnings) } : {}),
    readByPlayer: command.readByPlayer,
  };
  const exists = state.domesticReports.some((report) => report.reportId === nextEntry.reportId);

  return {
    ...state,
    domesticReports: exists
      ? state.domesticReports.map((report) => (report.reportId === nextEntry.reportId ? nextEntry : report))
      : [...state.domesticReports, nextEntry],
  };
}

function applyPrivateAssetUpsert(
  state: NormalizedLuanShiState,
  command: PrivateAssetUpsertCommand,
): NormalizedLuanShiState {
  const previous = command.operation === 'update'
    ? findExistingPrivateAssetByLedgerIdentity(state.privateAssets, command)
    : undefined;
  const name = command.name.trim();
  const aliases = cleanStringList([
    ...(previous?.aliases ?? []),
    ...(previous && previous.name !== name ? [previous.name] : []),
  ]).filter((alias) => alias !== name);
  const nextEntry: PrivateAssetEntry = clampPrivateAssetToAbsoluteLimits({
    ...(previous ?? {}),
    privateAssetId: command.privateAssetId.trim(),
    name,
    ...(aliases.length > 0 ? { aliases } : {}),
    type: command.type,
    ownerScope: command.ownerScope,
    status: command.status,
    summary: command.summary.trim(),
    ...optionalStringField('locationId', command.locationId),
    ...optionalStringField('locationDescription', command.locationDescription),
    ...optionalStringField('managerNpcId', command.managerNpcId),
    ...(command.mu !== undefined ? { mu: command.mu } : {}),
    ...(command.households !== undefined ? { households: command.households } : {}),
    ...(command.workers !== undefined ? { workers: command.workers } : {}),
    ...(command.workshopScale !== undefined ? { workshopScale: command.workshopScale } : {}),
    ...(command.ranchCapacity !== undefined ? { ranchCapacity: command.ranchCapacity } : {}),
    ...(command.conditionNotes && command.conditionNotes.length > 0 ? { conditionNotes: cleanStringList(command.conditionNotes) } : {}),
    ...(command.riskNotes && command.riskNotes.length > 0 ? { riskNotes: cleanStringList(command.riskNotes) } : {}),
    ...(command.recentChanges && command.recentChanges.length > 0 ? { recentChanges: cleanStringList(command.recentChanges) } : {}),
    ...optionalStringField('sourceNote', command.sourceNote),
    ...(command.acquisition ? { acquisition: command.acquisition } : {}),
    updatedAt: resolveCommandUpdatedAt(command.updatedAt, state.currentDate),
  });
  const exists = state.privateAssets.some((asset) => asset.privateAssetId === nextEntry.privateAssetId);

  return {
    ...state,
    privateAssets: exists
      ? state.privateAssets.map((asset) => (asset.privateAssetId === nextEntry.privateAssetId ? nextEntry : asset))
      : [...state.privateAssets, nextEntry],
  };
}

function applyPrivateAssetProjectUpsert(
  state: NormalizedLuanShiState,
  command: PrivateAssetProjectUpsertCommand,
): NormalizedLuanShiState {
  const existingEntry = state.privateAssetProjects.find((project) => project.projectId === command.projectId.trim());
  const nextEntry: PrivateAssetProjectEntry = {
    projectId: command.projectId.trim(),
    assetId: command.assetId.trim(),
    title: command.title.trim(),
    type: command.type,
    status: command.status,
    startedAt: command.startedAt.trim(),
    ...optionalStringField('expectedCompleteAt', command.expectedCompleteAt),
    ...(command.investedMoney !== undefined ? { investedMoney: command.investedMoney } : {}),
    ...(command.investedGrain !== undefined ? { investedGrain: command.investedGrain } : {}),
    ...(command.targetDelta ? { targetDelta: { ...command.targetDelta } } : {}),
    ...(command.riskNotes && command.riskNotes.length > 0 ? { riskNotes: cleanStringList(command.riskNotes) } : {}),
    ...(command.progressNotes && command.progressNotes.length > 0 ? { progressNotes: cleanStringList(command.progressNotes) } : {}),
    ...(existingEntry?.host ? { host: { ...existingEntry.host } } : {}),
    ...(existingEntry?.assistant ? { assistant: { ...existingEntry.assistant } } : {}),
    ...(existingEntry?.risk ? { risk: existingEntry.risk } : {}),
    ...(existingEntry?.modifiers ? { modifiers: { ...existingEntry.modifiers } } : {}),
    ...(existingEntry?.appliedArtIds ? { appliedArtIds: [...existingEntry.appliedArtIds] } : {}),
    ...(existingEntry?.cancelledAt ? { cancelledAt: existingEntry.cancelledAt } : {}),
    updatedAt: resolveCommandUpdatedAt(command.updatedAt, state.currentDate),
  };
  const exists = Boolean(existingEntry);

  return {
    ...state,
    privateAssetProjects: exists
      ? state.privateAssetProjects.map((project) => (project.projectId === nextEntry.projectId ? nextEntry : project))
      : [...state.privateAssetProjects, nextEntry],
  };
}

function cloneDomesticReportDelta(
  delta: DomesticReportEntry['income'],
): DomesticReportEntry['income'] {
  return {
    money: delta.money,
    grain: delta.grain,
    horses: delta.horses,
    arms: delta.arms,
    recruits: delta.recruits,
  };
}

function normalizeTroopSupplies(value: TroopLedgerEntry['supplies']): TroopLedgerEntry['supplies'] {
  return typeof value === 'number' ? value : value.trim();
}

function normalizeTroopType(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || isGenericTroopType(trimmed)) return undefined;
  return trimmed;
}

function isGenericTroopType(value: string): boolean {
  return genericTroopTypeWords.has(value.trim());
}

function applyConflictRecordUpsert(
  state: NormalizedLuanShiState,
  command: ConflictRecordUpsertCommand,
): NormalizedLuanShiState {
  const nextEntry: ConflictRecord = {
    conflictId: command.conflictId.trim(),
    type: command.type,
    title: command.title.trim(),
    summary: command.summary?.trim() || command.outcome.trim(),
    occurredAt: command.occurredAt.trim(),
    outcome: command.outcome.trim(),
    ...optionalEnumField('scope', command.scope),
    ...optionalEnumField('recordLevel', command.recordLevel),
    ...optionalStringField('locationId', command.locationId),
    ...optionalStringField('locationName', command.locationName),
    ...(command.sides && command.sides.length > 0 ? { sides: cleanStringList(command.sides) } : {}),
    ...(command.commanderNpcIds && command.commanderNpcIds.length > 0 ? { commanderNpcIds: cleanStringList(command.commanderNpcIds) } : {}),
    ...(command.involvedTroopIds && command.involvedTroopIds.length > 0 ? { involvedTroopIds: cleanStringList(command.involvedTroopIds) } : {}),
    ...(command.involvedFactionIds && command.involvedFactionIds.length > 0 ? { involvedFactionIds: cleanStringList(command.involvedFactionIds) } : {}),
    ...(command.involvedNpcIds && command.involvedNpcIds.length > 0 ? { involvedNpcIds: cleanStringList(command.involvedNpcIds) } : {}),
    ...optionalStringField('result', command.result),
    ...optionalEnumField('resultLevel', command.resultLevel),
    ...optionalStringField('winnerSide', command.winnerSide),
    ...optionalStringField('loserSide', command.loserSide),
    ...(command.judgement ? { judgement: cloneConflictJudgement(command.judgement) } : {}),
    ...(command.turningPoints && command.turningPoints.length > 0 ? { turningPoints: command.turningPoints.map(cloneConflictTurningPoint) } : {}),
    ...(command.resultTags && command.resultTags.length > 0 ? { resultTags: cleanStringList(command.resultTags) } : {}),
    ...(command.decisiveFactors && command.decisiveFactors.length > 0 ? { decisiveFactors: cleanStringList(command.decisiveFactors) } : {}),
    ...optionalStringField('reportText', command.reportText),
    ...(command.troopEffects && command.troopEffects.length > 0 ? { troopEffects: cleanStringList(command.troopEffects) } : {}),
    ...(command.factionEffects && command.factionEffects.length > 0 ? { factionEffects: cleanStringList(command.factionEffects) } : {}),
    ...(command.placeEffects && command.placeEffects.length > 0 ? { placeEffects: cleanStringList(command.placeEffects) } : {}),
    ...(command.relatedQuestIds && command.relatedQuestIds.length > 0 ? { relatedQuestIds: cleanStringList(command.relatedQuestIds) } : {}),
    ...(command.relatedTrendIds && command.relatedTrendIds.length > 0 ? { relatedTrendIds: cleanStringList(command.relatedTrendIds) } : {}),
    ...optionalStringField('imageKey', command.imageKey),
    ...optionalStringField('updatedAt', command.updatedAt),
  };
  const exists = state.conflicts.some((conflict) => conflict.conflictId === nextEntry.conflictId);

  return {
    ...state,
    conflicts: exists
      ? state.conflicts.map((conflict) => (conflict.conflictId === nextEntry.conflictId ? nextEntry : conflict))
      : [...state.conflicts, nextEntry],
  };
}

function applyCombatRecordUpsert(
  state: NormalizedLuanShiState,
  command: CombatRecordUpsertCommand,
): NormalizedLuanShiState {
  const previousEntry = state.combatRecords.find((combat) => combat.combatId === command.combatId.trim());
  const nextEntry: CombatRecord = {
    ...(previousEntry?.reportText ? { reportText: previousEntry.reportText } : {}),
    combatId: command.combatId.trim(),
    kind: command.kind,
    title: command.title.trim(),
    summary: command.summary.trim(),
    occurredAt: command.occurredAt.trim(),
    ...optionalStringField('locationId', command.locationId),
    ...optionalStringField('locationName', command.locationName),
    participants: command.participants.map((participant) => ({
      ...participant,
      ...(participant.participantId ? { participantId: participant.participantId.trim() } : {}),
      ...(participant.npcId ? { npcId: participant.npcId.trim() } : {}),
      name: participant.name.trim(),
      side: participant.side,
      ...(participant.role ? { role: participant.role.trim() } : {}),
      ...(participant.reputationFame !== undefined ? { reputationFame: participant.reputationFame } : {}),
      ...(participant.outcome ? { outcome: participant.outcome.trim() } : {}),
    })),
    playerInvolved: command.playerInvolved,
    resultLevel: command.resultLevel,
    ...(command.outcomeTags && command.outcomeTags.length > 0 ? { outcomeTags: [...command.outcomeTags] } : {}),
    outcome: command.outcome.trim(),
    significance: command.significance,
    ...(command.chronicleWorthy !== undefined ? { chronicleWorthy: command.chronicleWorthy } : {}),
    ...(command.relatedNpcIds && command.relatedNpcIds.length > 0 ? { relatedNpcIds: cleanStringList(command.relatedNpcIds) } : {}),
    ...(command.relatedConflictIds && command.relatedConflictIds.length > 0 ? { relatedConflictIds: cleanStringList(command.relatedConflictIds) } : {}),
    ...(command.relatedQuestIds && command.relatedQuestIds.length > 0 ? { relatedQuestIds: cleanStringList(command.relatedQuestIds) } : {}),
    ...(command.relatedTrendIds && command.relatedTrendIds.length > 0 ? { relatedTrendIds: cleanStringList(command.relatedTrendIds) } : {}),
    ...(command.judgement ? { judgement: cloneCombatJudgement(command.judgement) } : {}),
    ...optionalSanitizedCombatReportField('briefText', command.briefText),
    ...optionalSanitizedCombatReportField('reportText', command.reportText),
    ...optionalStringField('imageKey', command.imageKey),
    ...(command.visualTags && command.visualTags.length > 0 ? { visualTags: cleanStringList(command.visualTags) } : {}),
    ...(command.reputationEffects && command.reputationEffects.length > 0 ? { reputationEffects: cleanStringList(command.reputationEffects) } : {}),
    ...optionalStringField('updatedAt', command.updatedAt),
  };
  const exists = state.combatRecords.some((combat) => combat.combatId === nextEntry.combatId);

  return {
    ...state,
    combatRecords: exists
      ? state.combatRecords.map((combat) => (combat.combatId === nextEntry.combatId ? nextEntry : combat))
      : [...state.combatRecords, nextEntry],
  };
}

function applyCalendarEraUpsert(
  state: NormalizedLuanShiState,
  command: CalendarEraUpsertCommand,
): NormalizedLuanShiState {
  const entry: CalendarEraEntry = {
    eraId: command.eraId.trim(),
    eraName: command.eraName.trim(),
    startYear: Math.max(1, Math.floor(command.startYear)),
    ...(command.startMonth !== undefined ? { startMonth: clampCalendarInt(command.startMonth, 1, 12) } : {}),
    ...(command.startDay !== undefined ? { startDay: clampCalendarInt(command.startDay, 1, 30) } : {}),
    ...optionalStringField('rulerName', command.rulerName),
    source: command.source?.trim() || 'runtime.story',
    ...optionalStringField('note', command.note),
  };
  const nextEras = [
    ...state.calendarEras.filter((era) => era.eraId !== entry.eraId),
    entry,
  ].sort(compareCalendarEra);

  return {
    ...state,
    calendarEras: nextEras,
  };
}

function compareCalendarEra(a: CalendarEraEntry, b: CalendarEraEntry): number {
  return (a.startYear - b.startYear)
    || ((a.startMonth ?? 1) - (b.startMonth ?? 1))
    || ((a.startDay ?? 1) - (b.startDay ?? 1));
}

function clampCalendarInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function applyHeroineThreadUpsert(
  state: NormalizedLuanShiState,
  command: HeroineThreadUpsertCommand,
): NormalizedLuanShiState {
  const heroineThreadId = canonicalRelationshipStableKey(command.heroineThreadId);
  const existing = findHeroineThreadByIdentity(
    state.heroineThreads,
    heroineThreadId,
    command.npcId,
  );
  const canonicalHeroineThreadId = existing
    ? canonicalRelationshipStableKey(existing.heroineThreadId)
    : heroineThreadId;
  const nextEntry: HeroineThreadEntry = existing
    ? cloneHeroineThreadEntry(existing)
    : {
        heroineThreadId: canonicalHeroineThreadId,
        npcId: command.npcId!.trim(),
        npcName: command.npcName!.trim(),
        status: command.status!,
        stage: command.stage!.trim(),
        relationshipRole: command.relationshipRole!.trim(),
        summary: command.summary!.trim(),
        lastUpdatedAt: resolveCommandUpdatedAt(command.lastUpdatedAt, state.currentDate),
      };

  nextEntry.heroineThreadId = canonicalHeroineThreadId;
  if (command.npcId !== undefined) nextEntry.npcId = command.npcId.trim();
  if (command.status !== undefined) nextEntry.status = command.status;
  if (command.stage !== undefined) nextEntry.stage = command.stage.trim();
  if (command.relationshipRole !== undefined) nextEntry.relationshipRole = command.relationshipRole.trim();
  if (command.summary !== undefined) nextEntry.summary = command.summary.trim();
  nextEntry.lastUpdatedAt = resolveCommandUpdatedAt(command.lastUpdatedAt, state.currentDate);
  for (const field of ['currentPull', 'riskNotes', 'promiseNotes', 'recentProgress', 'source'] as const) {
    applyOptionalTextField(nextEntry as unknown as Record<string, unknown>, field, command[field]);
  }
  if (hasOwnField(command, 'tags') && command.tags !== undefined) {
    if (!command.tags || command.tags.length === 0) delete nextEntry.tags;
    else nextEntry.tags = cleanStringList(command.tags);
  }
  if (hasOwnField(command, 'milestones') && command.milestones !== undefined) {
    if (!command.milestones || command.milestones.length === 0) delete nextEntry.milestones;
    else nextEntry.milestones = command.milestones.map(cloneHeroineThreadMilestone);
  }

  const canonicalNpc = state.npcs.find((npc) => npc.npcId === nextEntry.npcId);
  if (canonicalNpc) nextEntry.npcName = canonicalNpc.name;

  return {
    ...state,
    heroineThreads: existing
      ? state.heroineThreads.map((entry) => (
          canonicalRelationshipStableKey(entry.heroineThreadId) === canonicalHeroineThreadId ? nextEntry : entry
        ))
      : [...state.heroineThreads, nextEntry],
  };
}

function applyBondThreadUpsert(
  state: NormalizedLuanShiState,
  command: BondThreadUpsertCommand,
): NormalizedLuanShiState {
  const bondThreadId = canonicalRelationshipStableKey(command.bondThreadId);
  const existing = state.bondThreads.find(
    (entry) => canonicalRelationshipStableKey(entry.bondThreadId) === bondThreadId,
  );
  const nextEntry: BondThreadEntry = existing
    ? cloneBondThreadEntry(existing)
    : {
        bondThreadId,
        targetNames: cleanUniqueStringList(command.targetNames!),
        bondType: command.bondType!,
        status: command.status!,
        summary: command.summary!.trim(),
        lastUpdatedAt: resolveCommandUpdatedAt(command.lastUpdatedAt, state.currentDate),
      };

  nextEntry.bondThreadId = bondThreadId;
  if (command.targetNames !== undefined) nextEntry.targetNames = cleanUniqueStringList(command.targetNames);
  if (command.bondType !== undefined) nextEntry.bondType = command.bondType;
  if (command.status !== undefined) nextEntry.status = command.status;
  if (command.summary !== undefined) nextEntry.summary = command.summary.trim();
  nextEntry.lastUpdatedAt = resolveCommandUpdatedAt(command.lastUpdatedAt, state.currentDate);
  for (const field of ['currentTension', 'promiseNotes', 'conflictNotes', 'recentProgress', 'source'] as const) {
    applyOptionalTextField(nextEntry as unknown as Record<string, unknown>, field, command[field]);
  }
  if (hasOwnField(command, 'targetNpcIds') && command.targetNpcIds !== undefined) {
    const targetNpcIds = command.targetNpcIds ? cleanUniqueStringList(command.targetNpcIds) : [];
    if (targetNpcIds.length === 0) {
      delete nextEntry.targetNpcIds;
    } else {
      nextEntry.targetNpcIds = targetNpcIds;
      nextEntry.targetNames = targetNpcIds.map((targetNpcId) => state.npcs.find((npc) => npc.npcId === targetNpcId)!.name);
    }
  }
  if (nextEntry.targetNpcIds?.length) {
    nextEntry.targetNames = nextEntry.targetNpcIds.map((targetNpcId) => state.npcs.find((npc) => npc.npcId === targetNpcId)!.name);
  }
  if (hasOwnField(command, 'tags') && command.tags !== undefined) {
    if (!command.tags || command.tags.length === 0) delete nextEntry.tags;
    else nextEntry.tags = cleanStringList(command.tags);
  }
  if (hasOwnField(command, 'milestones') && command.milestones !== undefined) {
    if (!command.milestones || command.milestones.length === 0) delete nextEntry.milestones;
    else nextEntry.milestones = command.milestones.map(cloneBondThreadMilestone);
  }

  return {
    ...state,
    bondThreads: existing
      ? state.bondThreads.map((entry) => (
          canonicalRelationshipStableKey(entry.bondThreadId) === bondThreadId ? nextEntry : entry
        ))
      : [...state.bondThreads, nextEntry],
  };
}

function cloneHeroineThreadEntry(entry: HeroineThreadEntry): HeroineThreadEntry {
  return {
    ...entry,
    ...(entry.tags ? { tags: [...entry.tags] } : {}),
    ...(entry.milestones ? { milestones: entry.milestones.map(cloneExistingRelationshipMilestone) } : {}),
  };
}

function cloneBondThreadEntry(entry: BondThreadEntry): BondThreadEntry {
  return {
    ...entry,
    targetNames: [...entry.targetNames],
    ...(entry.targetNpcIds ? { targetNpcIds: [...entry.targetNpcIds] } : {}),
    ...(entry.tags ? { tags: [...entry.tags] } : {}),
    ...(entry.milestones ? { milestones: entry.milestones.map(cloneExistingRelationshipMilestone) } : {}),
  };
}

function cloneExistingRelationshipMilestone<T extends object>(milestone: T): T {
  return { ...milestone };
}

function cloneHeroineThreadMilestone(
  milestone: NonNullable<HeroineThreadEntry['milestones']>[number],
): NonNullable<HeroineThreadEntry['milestones']>[number] {
  return {
    milestoneId: milestone.milestoneId.trim(),
    happenedAt: milestone.happenedAt.trim(),
    summary: milestone.summary.trim(),
    ...optionalStringField('source', milestone.source),
  };
}

function cloneBondThreadMilestone(
  milestone: NonNullable<BondThreadEntry['milestones']>[number],
): NonNullable<BondThreadEntry['milestones']>[number] {
  return {
    milestoneId: milestone.milestoneId.trim(),
    happenedAt: milestone.happenedAt.trim(),
    summary: milestone.summary.trim(),
    ...optionalStringField('source', milestone.source),
  };
}

function cloneCombatJudgement(judgement: NonNullable<CombatRecord['judgement']>): NonNullable<CombatRecord['judgement']> {
  return {
    ...judgement,
    ...(judgement.scoreBreakdown
      ? {
          scoreBreakdown: {
            ...judgement.scoreBreakdown,
            ...(judgement.scoreBreakdown.notes ? { notes: cleanStringList(judgement.scoreBreakdown.notes) } : {}),
          },
        }
      : {}),
  };
}

function applyCharacterReputationUpdate(
  state: NormalizedLuanShiState,
  command: CharacterReputationUpdateCommand,
): NormalizedLuanShiState {
  const isPlayerTarget = command.characterType === 'player'
    || command.characterId === 'player'
    || command.characterId === state.player.id;

  if (isPlayerTarget) {
    return {
      ...state,
      player: {
        ...state.player,
        reputation: mergeCharacterReputation(state.player.reputation, command),
      },
    };
  }

  return {
    ...state,
    npcs: state.npcs.map((npc) => (
      npc.npcId === command.characterId
        ? {
            ...npc,
            reputation: mergeCharacterReputation(npc.reputation, command),
          }
        : npc
    )),
  };
}

function mergeCharacterReputation(
  existing: CharacterReputation | undefined,
  command: CharacterReputationUpdateCommand,
): CharacterReputation {
  const nextTags = [...(existing?.tags ?? [])];
  for (const tag of command.tags ?? []) {
    if (!nextTags.some((item) => item.label === tag.label && item.source === tag.source)) {
      nextTags.push({ ...tag });
    }
  }

  return {
    morality: clampReputationScore((existing?.morality ?? 0) + (command.moralityDelta ?? 0)),
    fame: clampReputationScore((existing?.fame ?? 0) + (command.fameDelta ?? 0)),
    tags: nextTags,
    summary: command.summary?.trim() || existing?.summary || '',
  };
}

function cloneConflictJudgement(
  judgement: NonNullable<ConflictRecord['judgement']>,
): NonNullable<ConflictRecord['judgement']> {
  const normalized = normalizeConflictJudgement(judgement);
  return {
    ...normalized,
    ...(normalized.scoreBreakdown
      ? {
          scoreBreakdown: {
            ...normalized.scoreBreakdown,
            ...(normalized.scoreBreakdown.notes ? { notes: cleanStringList(normalized.scoreBreakdown.notes) } : {}),
          },
        }
      : {}),
  };
}

function cloneConflictTurningPoint(
  point: NonNullable<ConflictRecord['turningPoints']>[number],
): NonNullable<ConflictRecord['turningPoints']>[number] {
  return {
    ...point,
    summary: point.summary.trim(),
    ...(point.side ? { side: point.side.trim() } : {}),
    ...(point.relatedNpcIds && point.relatedNpcIds.length > 0 ? { relatedNpcIds: cleanStringList(point.relatedNpcIds) } : {}),
    ...(point.relatedTroopIds && point.relatedTroopIds.length > 0 ? { relatedTroopIds: cleanStringList(point.relatedTroopIds) } : {}),
  };
}

function cleanStringList(values: readonly string[] | string): string[] {
  const list = typeof values === 'string' ? [values] : values;
  return list.map((value) => value.trim()).filter(Boolean);
}

function cleanUniqueStringList(values: readonly string[] | string): string[] {
  return [...new Set(cleanStringList(values))];
}

function hasOwnField(value: object, field: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function optionalEnumField<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Partial<Record<Key, Value>> {
  return value !== undefined ? { [key]: value } as Partial<Record<Key, Value>> : {};
}

function normalizeMemoryContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasDuplicateNpcMemory(
  npc: LuanShiNpc,
  command: Extract<LuanShiCommand, { action: 'pushNpcMemory' }>,
  createdAt: string,
): boolean {
  const nextEventId = command.eventId?.trim();
  if (nextEventId) {
    return npc.memories.some((memory) => (
      memory.eventId === nextEventId
      && memory.source === command.source
    ));
  }

  const nextContent = normalizeMemoryContent(command.value);
  return npc.memories.some((memory) => (
    memory.createdAt === createdAt
    && memory.source === command.source
    && normalizeMemoryContent(memory.content) === nextContent
  ));
}

function applyNpcProfileUpsert(
  state: NormalizedLuanShiState,
  command: NpcProfileUpsertCommand,
): NormalizedLuanShiState {
  const existing = state.npcs.find((npc) => npc.npcId === command.npcId);
  const birthDate = ensureCompleteBirthDate({
    age: existing?.age ?? command.age,
    birthDate: existing?.birthDate ?? command.birthDate,
    ageKnownAtDate: existing?.ageKnownAtDate ?? command.ageKnownAtDate,
    currentDate: state.currentDate,
    stableId: `npc:${command.npcId.trim()}`,
  });
  const currentAge = deriveCurrentAgeFromBirthDate(birthDate, state.currentDate) ?? command.age;
  const nextNpc: LuanShiNpc = {
    npcId: command.npcId.trim(),
    name: command.name.trim(),
    ...optionalStringField('courtesyName', command.courtesyName),
    ...optionalStringField('artName', command.artName),
    ...(command.aliases && command.aliases.length > 0 ? { aliases: command.aliases.map((alias) => alias.trim()).filter(Boolean) } : {}),
    ...optionalStringField('commonAddress', command.commonAddress),
    sex: command.sex,
    age: currentAge,
    ...optionalStringField('birthDate', birthDate),
    role: command.role.trim(),
    ...optionalStringField('factionId', command.factionId),
    ...optionalStringField('factionName', command.factionName),
    locationId: command.locationId.trim(),
    isPresent: command.isPresent,
    isFocused: command.isFocused,
    ...optionalStringField('birthOrigin', command.birthOrigin),
    ...optionalStringField('birthOriginDescription', command.birthOriginDescription),
    currentIdentity: command.currentIdentity.trim(),
    ...optionalStringField('currentIdentityDescription', command.currentIdentityDescription),
    ...optionalStringField('allegianceTarget', command.allegianceTarget),
    ...optionalStringField('officeTitle', command.officeTitle),
    ...optionalStringField('militaryTitle', command.militaryTitle),
    ...optionalStringField('nobleTitle', command.nobleTitle),
    ...optionalStringField('identitySummary', command.identitySummary),
    summary: command.summary.trim(),
    appearance: command.appearance.trim(),
    personality: command.personality.trim(),
    motivation: command.motivation.trim(),
    relationToPlayer: existing?.relationToPlayer ?? command.relationToPlayer.trim(),
    contactLevel: existing?.contactLevel ?? command.contactLevel,
    recentAttitude: existing?.recentAttitude ?? command.recentAttitude.trim(),
    abilityScores: { ...command.abilityScores },
    ...(command.vitals ? { vitals: { ...command.vitals } } : existing?.vitals ? { vitals: { ...existing.vitals } } : {}),
    traits: normalizeCharacterTraits(command.traits),
    ...((command.uniqueArts || existing?.uniqueArts)
      ? { uniqueArts: mergeStableCharacterUniqueArts(existing?.uniqueArts, command.uniqueArts) }
      : {}),
    ...(command.effects
      ? { effects: command.effects.map((effect) => ({
          ...effect,
          ...(effect.checkHooks ? { checkHooks: effect.checkHooks.map((hook) => ({ ...hook })) } : {}),
        })) }
      : existing?.effects ? { effects: existing.effects.map((effect) => ({ ...effect })) } : {}),
    ...(command.equipment
      ? { equipment: command.equipment.map(cloneEquipmentItem) }
      : existing?.equipment ? { equipment: existing.equipment.map(cloneEquipmentItem) } : {}),
    ...(command.inventory
      ? { inventory: command.inventory.map(cloneInventoryItem) }
      : existing?.inventory ? { inventory: existing.inventory.map(cloneInventoryItem) } : {}),
    ...(existing?.reputation ? { reputation: { ...existing.reputation, tags: existing.reputation.tags.map((tag) => ({ ...tag })) } } : {}),
    ...(existing?.femaleProfile ? { femaleProfile: cloneFemaleProfile(existing.femaleProfile) } : {}),
    ...(existing?.backgroundActivity
      ? { backgroundActivity: cloneNpcBackgroundActivity(existing.backgroundActivity) }
      : {}),
    ...(existing?.presenceUpdates
      ? { presenceUpdates: existing.presenceUpdates.map((update) => ({ ...update })) }
      : {}),
    memories: existing?.memories ? [...existing.memories] : [],
  };

  return {
    ...state,
    npcs: existing
      ? state.npcs.map((npc) => (npc.npcId === command.npcId ? nextNpc : npc))
      : [...state.npcs, nextNpc],
  };
}

function applyNpcRelationshipUpdate(
  state: NormalizedLuanShiState,
  command: NpcRelationshipUpdateCommand,
): NormalizedLuanShiState {
  const npcId = command.npcId.trim();
  const existing = state.npcs.find((npc) => npc.npcId === npcId);
  if (!existing) return state;

  const nextContactLevel = Math.min(100, Math.max(0, existing.contactLevel + command.contactDelta));
  return {
    ...state,
    npcs: state.npcs.map((npc) => npc.npcId === npcId
      ? {
          ...npc,
          contactLevel: nextContactLevel,
          ...(command.relationToPlayer !== undefined
            ? { relationToPlayer: command.relationToPlayer.trim() }
            : {}),
          ...(command.recentAttitude !== undefined
            ? { recentAttitude: command.recentAttitude.trim() }
            : {}),
        }
      : npc),
    npcAwarenessIndex: state.npcAwarenessIndex.map((entry) => entry.npcId === npcId
      ? {
          ...entry,
          contactLevel: nextContactLevel,
          updatedAt: state.currentDate,
        }
      : entry),
  };
}

function applyNpcPresenceUpdate(
  state: NormalizedLuanShiState,
  command: NpcPresenceUpdateCommand,
): NormalizedLuanShiState {
  return {
    ...state,
    npcs: state.npcs.map((npc) => npc.npcId === command.npcId
      ? {
          ...npc,
          locationId: command.locationId.trim(),
          isPresent: command.isPresent,
          ...(command.isFocused !== undefined ? { isFocused: command.isFocused } : {}),
        }
      : npc),
  };
}

function applyNpcBackgroundActivityUpdate(
  state: NormalizedLuanShiState,
  command: NpcBackgroundActivityUpdateCommand,
): NormalizedLuanShiState {
  return {
    ...state,
    npcs: state.npcs.map((npc) => npc.npcId === command.npcId
      ? {
          ...npc,
          backgroundActivity: command.activity
            ? resolveNpcBackgroundActivityAgainstCurrentMatters(
                cloneNpcBackgroundActivity(command.activity),
                state.activeQuests,
                state.currentDate,
              )
            : undefined,
        }
      : npc),
  };
}

function cloneNpcBackgroundActivity(
  activity: NonNullable<LuanShiNpc['backgroundActivity']>,
): NonNullable<LuanShiNpc['backgroundActivity']> {
  return {
    ...activity,
    ...(activity.sourceIds ? { sourceIds: [...activity.sourceIds] } : {}),
  };
}

function optionalStringField<K extends string>(key: K, value?: string | null): Partial<Record<K, string>> {
  if (typeof value !== 'string') return {};
  const trimmed = value.trim();
  return trimmed ? { [key]: trimmed } as Partial<Record<K, string>> : {};
}

function resolveRequiredString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function resolveCommandUpdatedAt(value: string | null | undefined, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function cloneRelationshipNetwork(
  network: LuanShiNpcRelationshipNetworkEntry[] | undefined,
): LuanShiNpcRelationshipNetworkEntry[] | undefined {
  return network?.map((entry) => ({ ...entry }));
}

function cloneWombProfile(profile: LuanShiNpcWombProfile | undefined): LuanShiNpcWombProfile | undefined {
  if (!profile) return undefined;
  return {
    ...profile,
    ...(profile.inseminationRecords
      ? { inseminationRecords: profile.inseminationRecords.map((record) => ({ ...record })) }
      : {}),
    ...(profile.pregnancy
      ? {
          pregnancy: {
            ...profile.pregnancy,
            fatherCharacterIds: [...profile.pregnancy.fatherCharacterIds],
            ...(profile.pregnancy.riskEventKeys ? { riskEventKeys: [...profile.pregnancy.riskEventKeys] } : {}),
          },
        }
      : {}),
    ...(profile.pendingPregnancyChecks
      ? {
          pendingPregnancyChecks: profile.pendingPregnancyChecks.map((pregnancy) => ({
            ...pregnancy,
            fatherCharacterIds: [...pregnancy.fatherCharacterIds],
            ...(pregnancy.riskEventKeys ? { riskEventKeys: [...pregnancy.riskEventKeys] } : {}),
          })),
        }
      : {}),
    ...(profile.lastPregnancyCheck ? { lastPregnancyCheck: { ...profile.lastPregnancyCheck } } : {}),
    ...(profile.pregnancyHistory
      ? { pregnancyHistory: profile.pregnancyHistory.map((entry) => ({ ...entry })) }
      : {}),
  };
}

function cloneAdultPrivateProfile(profile: LuanShiNpcAdultPrivateProfile): LuanShiNpcAdultPrivateProfile {
  return {
    ...profile,
    ...(profile.wombProfile ? { wombProfile: cloneWombProfile(profile.wombProfile) } : {}),
  };
}

function cloneFemaleProfile(profile: LuanShiNpcFemaleProfile): LuanShiNpcFemaleProfile {
  return {
    ...profile,
    ...(profile.relationshipNetwork ? { relationshipNetwork: cloneRelationshipNetwork(profile.relationshipNetwork) } : {}),
    ...(profile.adultPrivateProfile ? { adultPrivateProfile: cloneAdultPrivateProfile(profile.adultPrivateProfile) } : {}),
  };
}

function applyOptionalTextField(
  target: Record<string, unknown>,
  key: string,
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null || value.trim().length === 0) {
    delete target[key];
    return;
  }
  target[key] = value.trim();
}

function mergeAdultPrivateProfile(
  existing: LuanShiNpcAdultPrivateProfile | undefined,
  incoming: LuanShiNpcAdultPrivateProfile,
  ageConfirmedAdult: boolean,
): LuanShiNpcAdultPrivateProfile {
  const next: Record<string, unknown> = existing ? { ...existing } : {};

  for (const field of [
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
  ] as const) {
    applyOptionalTextField(next, field, incoming[field]);
  }

  if (incoming.enabled !== undefined) {
    next.enabled = incoming.enabled;
  }
  if (incoming.virgin !== undefined) {
    next.virgin = incoming.virgin;
  }
  if (incoming.wombProfile !== undefined) {
    const existingWombProfile = cloneWombProfile(existing?.wombProfile);
    const incomingWombProfile = cloneWombProfile(incoming.wombProfile);
    next.wombProfile = {
      ...existingWombProfile,
      ...incomingWombProfile,
      ...(existingWombProfile?.pregnancy ? { pregnancy: existingWombProfile.pregnancy } : {}),
      ...(existingWombProfile?.pendingPregnancyChecks
        ? { pendingPregnancyChecks: existingWombProfile.pendingPregnancyChecks }
        : {}),
      ...(existingWombProfile?.lastPregnancyCheck ? { lastPregnancyCheck: existingWombProfile.lastPregnancyCheck } : {}),
      ...(existingWombProfile?.pregnancyHistory ? { pregnancyHistory: existingWombProfile.pregnancyHistory } : {}),
    };
  }
  next.ageConfirmedAdult = ageConfirmedAdult;

  return next as LuanShiNpcAdultPrivateProfile;
}

function applyNpcFemaleProfileUpdate(
  state: NormalizedLuanShiState,
  command: NpcFemaleProfileUpdateCommand,
): NormalizedLuanShiState {
  return {
    ...state,
    npcs: state.npcs.map((npc) => {
      if (npc.npcId !== command.npcId) {
        return npc;
      }

      const nextProfile: Record<string, unknown> = npc.femaleProfile ? { ...cloneFemaleProfile(npc.femaleProfile) } : {};
      for (const field of [
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
        'source',
      ] as const) {
        applyOptionalTextField(nextProfile, field, command[field]);
      }

      if (Object.prototype.hasOwnProperty.call(command, 'relationshipNetwork')) {
        if (!command.relationshipNetwork || command.relationshipNetwork.length === 0) {
          delete nextProfile.relationshipNetwork;
        } else {
          nextProfile.relationshipNetwork = cloneRelationshipNetwork(command.relationshipNetwork);
        }
      }

      nextProfile.updatedAt = typeof command.updatedAt === 'string' && command.updatedAt.trim()
        ? command.updatedAt.trim()
        : state.currentDate;

      if (Object.prototype.hasOwnProperty.call(command, 'adultPrivateProfile')) {
        const npcForAgeGate = {
          ...npc,
          femaleProfile: nextProfile as LuanShiNpcFemaleProfile,
        };
        if (!command.adultPrivateProfile) {
          delete nextProfile.adultPrivateProfile;
        } else if (isAdultFemaleNpcAt(npcForAgeGate, state.currentDate)) {
          nextProfile.adultPrivateProfile = mergeAdultPrivateProfile(
            npc.femaleProfile?.adultPrivateProfile,
            command.adultPrivateProfile,
            true,
          );
        }
      }

      return {
        ...npc,
        femaleProfile: nextProfile as LuanShiNpcFemaleProfile,
      };
    }),
  };
}

function applyPlayerLoadoutUpdate(
  state: NormalizedLuanShiState,
  command: PlayerLoadoutUpdateCommand,
  options: ApplyLuanShiCommandOptions,
): NormalizedLuanShiState {
  const hasAbsoluteMoney = typeof command.personalMoney === 'number' && Number.isFinite(command.personalMoney);
  const hasMoneyDelta = typeof command.personalMoneyDelta === 'number' && Number.isFinite(command.personalMoneyDelta);
  const hasMoney = hasAbsoluteMoney || hasMoneyDelta;
  const currentMoney = typeof state.player.personalMoney === 'number' && Number.isFinite(state.player.personalMoney)
    ? state.player.personalMoney
    : 0;
  const personalMoney = hasAbsoluteMoney
    ? Math.max(0, Math.floor(command.personalMoney ?? 0))
    : hasMoneyDelta
      ? Math.max(0, Math.floor(currentMoney + (command.personalMoneyDelta ?? 0)))
      : state.player.personalMoney;
  const basePlayer = {
    ...state.player,
    ...(hasMoney ? { personalMoney } : {}),
    ...(command.equipment ? { equipment: command.equipment.map(cloneEquipmentItem) } : {}),
    ...(command.inventory ? { inventory: command.inventory.map(cloneInventoryItem) } : {}),
  };
  const inventoryPatchedPlayer = applyInventoryChanges(basePlayer, command.inventoryChanges);
  const player = applyEquipmentChanges(inventoryPatchedPlayer, command.equipmentChanges);
  const isOpeningInitialization = options.openingInitialization === true;
  const openingPersonalMoney = state.worldStateDelta.openingPersonalMoney;
  const shouldInitializeOpeningMoney = isOpeningInitialization
    && hasAbsoluteMoney
    && (typeof openingPersonalMoney !== 'number' || !Number.isFinite(openingPersonalMoney));
  const nextWorldStateDelta = {
    ...state.worldStateDelta,
    ...(isOpeningInitialization && command.equipment
      ? { openingEquipment: command.equipment.map((item) => item.name) }
      : {}),
    ...(isOpeningInitialization && command.inventory
      ? { openingInventory: command.inventory.map((item) => `${item.name}x${item.quantity}`) }
      : {}),
    ...(shouldInitializeOpeningMoney ? { openingPersonalMoney: personalMoney } : {}),
    ...(isOpeningInitialization && command.summary ? { openingLoadoutSummary: command.summary } : {}),
  };

  return {
    ...state,
    player,
    playerResources: hasMoney
      ? omitReservedPlayerResourceKeys(state.playerResources)
      : state.playerResources,
    resources: state.resources,
    worldStateDelta: nextWorldStateDelta,
  };
}

function applyNpcLoadoutUpdate(
  state: NormalizedLuanShiState,
  command: NpcLoadoutUpdateCommand,
): NormalizedLuanShiState {
  const targetNpcId = command.npcId.trim();
  return {
    ...state,
    npcs: state.npcs.map((npc) => {
      if (npc.npcId !== targetNpcId) {
        return npc;
      }

      const baseNpc = {
        ...npc,
        ...(command.equipment ? { equipment: command.equipment.map(cloneEquipmentItem) } : {}),
        ...(command.inventory ? { inventory: command.inventory.map(cloneInventoryItem) } : {}),
      };
      const inventoryPatchedNpc = applyInventoryChanges(baseNpc, command.inventoryChanges);
      return applyDirectEquipmentChanges(inventoryPatchedNpc, command.equipmentChanges);
    }),
  };
}

function omitReservedPlayerResourceKeys(resources: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(resources).filter(([key]) => !isCanonicalLedgerShadowResourceKey(key)),
  );
}

function applyInventoryChanges<T extends LoadoutOwner>(
  owner: T,
  changes: PlayerLoadoutUpdateCommand['inventoryChanges'] | NpcLoadoutUpdateCommand['inventoryChanges'],
): T {
  if (!changes || changes.length === 0) return owner;
  let inventory = (owner.inventory ?? []).map(cloneInventoryItem);
  for (const change of changes) {
    if (change.action === 'upsert') {
      inventory = upsertInventoryItem(inventory, normalizeInventoryQuantity(change.item));
      continue;
    }
    if (change.action === 'remove') {
      inventory = removeInventoryQuantity(inventory, change.itemId.trim(), change.quantity ?? 1);
      continue;
    }
    if (change.action === 'setQuantity') {
      inventory = setInventoryQuantity(inventory, change.itemId.trim(), change.quantity);
    }
  }
  return { ...owner, inventory };
}

function applyEquipmentChanges(
  player: NormalizedLuanShiState['player'],
  changes: PlayerLoadoutUpdateCommand['equipmentChanges'],
): NormalizedLuanShiState['player'] {
  if (!changes || changes.length === 0) return player;
  let nextPlayer = player;
  for (const change of changes) {
    if (change.action === 'equipFromInventory') {
      nextPlayer = equipInventoryItem(nextPlayer, change.itemId, {
        slot: change.slot,
        treasureIndex: change.treasureIndex,
      }) as NormalizedLuanShiState['player'];
      continue;
    }
    nextPlayer = applyDirectEquipmentChanges(nextPlayer, [change]);
  }
  return nextPlayer;
}

function applyDirectEquipmentChanges<T extends LoadoutOwner>(
  owner: T,
  changes: NpcLoadoutUpdateCommand['equipmentChanges'],
): T {
  if (!changes || changes.length === 0) return owner;
  let nextOwner = owner;
  for (const change of changes) {
    if (change.action === 'upsert') {
      nextOwner = upsertEquipmentItem(nextOwner, change.item, change.treasureIndex);
      continue;
    }
    if (change.action === 'remove') {
      nextOwner = {
        ...nextOwner,
        equipment: (nextOwner.equipment ?? []).filter((item) => item.id !== change.equipmentId),
      };
      continue;
    }
    if (change.action === 'unequip') {
      const equipment = nextOwner.equipment ?? [];
      const removed = equipment.find((item) => item.id === change.equipmentId);
      nextOwner = {
        ...nextOwner,
        equipment: equipment.filter((item) => item.id !== change.equipmentId),
        inventory: removed
          ? upsertInventoryItem(nextOwner.inventory ?? [], equipmentItemToInventoryItem(removed))
          : nextOwner.inventory,
      };
    }
  }
  return nextOwner;
}

function normalizeInventoryQuantity(item: InventoryItem): InventoryItem {
  return { ...cloneInventoryItem(item), quantity: Math.max(1, Math.floor(item.quantity)) };
}

function removeInventoryQuantity(inventory: InventoryItem[], itemId: string, quantity: number): InventoryItem[] {
  const removeQuantity = Math.max(1, Math.floor(quantity));
  return inventory.flatMap((item) => {
    if (item.id !== itemId) return [cloneInventoryItem(item)];
    const nextQuantity = Math.floor(item.quantity) - removeQuantity;
    return nextQuantity > 0 ? [{ ...cloneInventoryItem(item), quantity: nextQuantity }] : [];
  });
}

function setInventoryQuantity(inventory: InventoryItem[], itemId: string, quantity: number): InventoryItem[] {
  const nextQuantity = Math.max(0, Math.floor(quantity));
  if (nextQuantity <= 0) return inventory.filter((item) => item.id !== itemId).map(cloneInventoryItem);
  return inventory.map((item) => (
    item.id === itemId
      ? { ...cloneInventoryItem(item), quantity: nextQuantity }
      : cloneInventoryItem(item)
  ));
}

function upsertEquipmentItem<T extends LoadoutOwner>(
  owner: T,
  item: CharacterEquipmentItem,
  treasureIndex?: number,
): T {
  const equipment = (owner.equipment ?? []).map(cloneEquipmentItem);
  if (item.slot !== 'treasure') {
    return {
      ...owner,
      equipment: [...equipment.filter((existing) => existing.slot !== item.slot), cloneEquipmentItem(item)],
    };
  }

  const nonTreasures = equipment.filter((existing) => existing.slot !== 'treasure');
  const treasures = equipment.filter((existing) => existing.slot === 'treasure').slice(0, 3);
  const targetIndex =
    typeof treasureIndex === 'number' && Number.isInteger(treasureIndex) && treasureIndex >= 0 && treasureIndex < 3
      ? treasureIndex
      : ([0, 1, 2].find((index) => !treasures[index]) ?? 0);
  const nextTreasures = [0, 1, 2]
    .map((index) => (index === targetIndex ? cloneEquipmentItem(item) : treasures[index]))
    .filter((existing): existing is CharacterEquipmentItem => Boolean(existing));
  return { ...owner, equipment: [...nonTreasures, ...nextTreasures] };
}

function clonePlayerTrait(trait: PlayerTraitsUpdateCommand['traits'][number]): PlayerTraitsUpdateCommand['traits'][number] {
  return {
    ...trait,
    ...(trait.checkHooks ? { checkHooks: trait.checkHooks.map((hook) => ({ ...hook })) } : {}),
  };
}

function applyPlayerTraitsUpdate(
  state: NormalizedLuanShiState,
  command: PlayerTraitsUpdateCommand,
): NormalizedLuanShiState {
  const traits = normalizeCharacterTraits(command.traits).map(clonePlayerTrait);
  const openingTraitDetails = traits.map((trait) => ({
    id: trait.id,
    label: trait.label,
    description: trait.description,
    source: trait.source,
    rarity: trait.rarity,
    promptHint: trait.promptHint,
    checkHooks: trait.checkHooks ? trait.checkHooks.map((hook) => ({ ...hook })) : undefined,
  }));

  return {
    ...state,
    player: {
      ...state.player,
      traits,
    },
    worldStateDelta: {
      ...state.worldStateDelta,
      openingTraits: traits.map((trait) => trait.label),
      openingTraitDetails,
      ...(command.summary ? { openingTraitsSummary: command.summary } : {}),
    },
  };
}

function applyCharacterUniqueArtsUpdate(
  state: NormalizedLuanShiState,
  command: CharacterUniqueArtsUpdateCommand,
): NormalizedLuanShiState {
  if (command.characterType === 'player') {
    const uniqueArts = mergeStableCharacterUniqueArts(state.player.uniqueArts, command.uniqueArts);
    const openingUniqueArtDetails = uniqueArts.map((art) => ({
      id: art.id,
      name: art.name,
      rarity: art.rarity,
      domain: art.domain,
      level: art.level,
      maxLevel: art.maxLevel,
      progress: art.progress,
      description: art.description,
      effectSummary: art.effectSummary,
      source: art.source,
      acquisition: art.acquisition ? { ...art.acquisition } : undefined,
      acquiredAt: art.acquiredAt,
      upgradedAt: art.upgradedAt,
      promptHint: art.promptHint,
      checkHooks: art.checkHooks ? art.checkHooks.map((hook) => ({ ...hook })) : undefined,
    }));

    return {
      ...state,
      player: {
        ...state.player,
        uniqueArts,
      },
      worldStateDelta: {
        ...state.worldStateDelta,
        openingUniqueArts: uniqueArts.map((art) => art.name),
        openingUniqueArtDetails,
        ...(command.summary ? { openingUniqueArtsSummary: command.summary } : {}),
      },
    };
  }

  const targetId = command.characterId?.trim();
  const targetName = command.characterName?.trim();

  return {
    ...state,
    npcs: state.npcs.map((npc) => {
      const matches = targetId ? npc.npcId === targetId : npc.name === targetName;
      return matches
        ? { ...npc, uniqueArts: mergeStableCharacterUniqueArts(npc.uniqueArts, command.uniqueArts) }
        : npc;
    }),
  };
}

function applyCharacterUniqueArtProgressRecord(
  state: NormalizedLuanShiState,
  command: CharacterUniqueArtProgressRecordCommand,
): NormalizedLuanShiState {
  const turnKey = buildUniqueArtProgressTurnKey(state.turnLog.length, state.currentDate);
  const applyToArts = (sourceArts: readonly import('../types').CharacterUniqueArt[] | undefined) => {
    const arts = mergeStableCharacterUniqueArts(sourceArts, []);
    if (
      characterHasUniqueArtProgressEvent(arts, command.eventId)
      || characterHasConsumedUniqueArtProgressSource(arts, command)
    ) {
      return { arts, applied: false };
    }
    const artIndex = arts.findIndex((art) => art.id === command.artId.trim());
    if (artIndex < 0) return { arts, applied: false };
    const result = applyUniqueArtProgressEvidence(arts[artIndex], command, turnKey);
    if (!result.applied) return { arts, applied: false };
    arts[artIndex] = result.art;
    return { arts, applied: true };
  };

  if (command.characterType === 'player') {
    const result = applyToArts(state.player.uniqueArts);
    if (!result.applied) return state;
    return {
      ...state,
      player: { ...state.player, uniqueArts: result.arts },
      worldStateDelta: {
        ...state.worldStateDelta,
        openingUniqueArts: result.arts.map((art) => art.name),
        openingUniqueArtDetails: result.arts.map(cloneUniqueArtForWorldState),
      },
    };
  }

  const targetId = command.characterId?.trim();
  const targetName = command.characterName?.trim();
  let applied = false;
  const npcs = state.npcs.map((npc) => {
    const matches = targetId ? npc.npcId === targetId : npc.name === targetName;
    if (!matches) return npc;
    const result = applyToArts(npc.uniqueArts);
    if (!result.applied) return npc;
    applied = true;
    return { ...npc, uniqueArts: result.arts };
  });
  return applied ? { ...state, npcs } : state;
}

function cloneUniqueArtForWorldState(art: import('../types').CharacterUniqueArt): Record<string, unknown> {
  return {
    ...art,
    ...(art.acquisition ? { acquisition: { ...art.acquisition } } : {}),
    ...(art.checkHooks ? { checkHooks: art.checkHooks.map((hook) => ({ ...hook })) } : {}),
    ...(art.progressHistory ? { progressHistory: art.progressHistory.map((entry) => ({ ...entry })) } : {}),
  };
}

function applyCharacterIdentityUpdate(
  state: NormalizedLuanShiState,
  command: CharacterIdentityUpdateCommand,
): NormalizedLuanShiState {
  const isPlayerTarget = command.characterType === 'player'
    || command.characterId === 'player'
    || command.characterId === state.player.id;

  if (isPlayerTarget) {
    return {
      ...state,
      player: applyIdentityFields(state.player, command),
    };
  }

  return {
    ...state,
    npcs: state.npcs.map((npc) => {
      if (npc.npcId !== command.characterId) {
        return npc;
      }
      const updatedNpc = applyIdentityFields(npc, command);
      const previousName = normalizeIdentityComparisonValue(npc.name);
      const nextName = normalizeIdentityComparisonValue(command.name);
      if (!previousName || !nextName || previousName === nextName) return updatedNpc;
      return {
        ...updatedNpc,
        aliases: cleanStringList([
          ...(updatedNpc.aliases ?? []),
          previousName,
        ]),
      };
    }),
  };
}

function applyIdentityFields<T extends object>(target: T, command: CharacterIdentityUpdateFields): T {
  const next: Record<string, unknown> = { ...(target as Record<string, unknown>) };

  const authorityIdentityFields: Array<keyof CharacterIdentityUpdateFields> = [
    'currentIdentity',
    'factionId',
    'factionName',
    'officeTitle',
    'militaryTitle',
    'nobleTitle',
  ];
  const updatesAuthorityIdentity = authorityIdentityFields.some((field) => (
    Object.prototype.hasOwnProperty.call(command, field)
    && normalizeIdentityComparisonValue(next[field]) !== normalizeIdentityComparisonValue(command[field])
  ));
  if (updatesAuthorityIdentity && !Object.prototype.hasOwnProperty.call(command, 'personalEscortEntitlement')) {
    delete next.personalEscortEntitlement;
  }

  const updatesCurrentIdentity = Object.prototype.hasOwnProperty.call(command, 'currentIdentity');
  if (updatesCurrentIdentity) {
    const previousIdentity = normalizeIdentityComparisonValue(next.currentIdentity);
    const nextIdentity = normalizeIdentityComparisonValue(command.currentIdentity);
    const identityChanged = previousIdentity !== nextIdentity;

    if (identityChanged && !Object.prototype.hasOwnProperty.call(command, 'currentIdentityDescription')) {
      delete next.currentIdentityDescription;
    }
    if (identityChanged && !Object.prototype.hasOwnProperty.call(command, 'identitySummary')) {
      delete next.identitySummary;
    }
  }

  for (const field of identityFieldNames) {
    if (!Object.prototype.hasOwnProperty.call(command, field)) {
      continue;
    }

    const value = command[field];
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      delete next[field];
      continue;
    }

    if (field === 'personalEscortEntitlement') {
      const entitlement = value as NonNullable<CharacterIdentityUpdateFields['personalEscortEntitlement']>;
      next[field] = { ...entitlement, bases: [...entitlement.bases] };
    } else {
      next[field] = Array.isArray(value) ? [...value] : value;
    }
  }

  return next as unknown as T;
}

function normalizeIdentityComparisonValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
