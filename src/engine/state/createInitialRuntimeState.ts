import type {
  CalendarEraEntry,
  FactionLedgerEntry,
  HoldingLedgerEntry,
  LuanShiRuntimeFields,
  MemoryArchive,
  MemorySummaryMaintenance,
  LongTermStoryMemorySummary,
  MemoryProjectionSettings,
  NpcLongTermMemorySummary,
  NpcMidTermMemorySummary,
  RuntimeState,
  TroopLedgerEntry,
  WorldlineRuntimeSettings,
} from '../types';
import { normalizeHeroineThreads } from './HeroineThreadIdentity';
import { normalizeBondThreads } from './BondThreadIdentity';
import {
  normalizeCurrentTroopReferenceIds,
  normalizeDuplicateTerminalTroopLineages,
} from './troopLifecycle';
import { normalizeFactionLedgerIdentities } from './factionLedgerIdentity';
import { normalizeHistoricalAnchorStates } from '../worldline/HistoricalAnchorApplicability';
import { normalizeLegacyHoldingCivilAdministration } from '../holdings/HoldingCivilAdministration';
import {
  normalizePrivateAssetLedgers,
  remapPrivateAssetId,
} from '../holdings/PrivateAssetPolicy';
import { normalizeEncounterDifficulty, normalizeGameDifficulty } from '../settings/GameDifficulty';
import { normalizeNarrativePerspective } from '../settings/NarrativePerspective';
import { normalizePlayerProgression } from '../character/progression';
import { normalizePlayerVitals } from '../character/PlayerVitals';
import { normalizeCanonicalLedgerResourceShadows } from './resourceLedgerIdentity';
import { normalizeFactionRecentActionHistory } from './factionRecentActionHistory';
import {
  normalizeCorrespondenceCommitments,
  normalizeCorrespondenceEntries,
} from '../correspondence';
import {
  resolveTroopFatiguePercent,
  troopFatigueBandFromPercent,
} from '../troops/TroopFatigue';

type NormalizedMemoryArchive = MemoryArchive & {
  schemaVersion: 2;
  longTermStorySummaries: LongTermStoryMemorySummary[];
  npcMidTermSummaries: NpcMidTermMemorySummary[];
  npcLongTermSummaries: NpcLongTermMemorySummary[];
};

export type NormalizedLuanShiState = RuntimeState & LuanShiRuntimeFields & { memoryArchive: NormalizedMemoryArchive };

export const DEFAULT_TROOP_LEDGER_OPERATIONAL_FIELDS: Pick<
  TroopLedgerEntry,
  'quality' | 'fatigue' | 'readiness' | 'lifecycleStatus' | 'knownLevel' | 'certainty'
> = {
  quality: '中',
  fatigue: '低',
  readiness: '中',
  lifecycleStatus: 'active',
  knownLevel: '亲历',
  certainty: 'confirmed',
};

const defaultResources = () => ({
  money: 0,
  grain: 0,
  horses: 0,
  arms: 0,
  recruits: 0,
  weapons: [],
  documents: [],
  tokens: [],
  importantSupplies: [],
});

function normalizeResources(resources?: RuntimeState['resources']): LuanShiRuntimeFields['resources'] {
  const defaults = defaultResources();
  if (!resources) return defaults;

  return {
    ...defaults,
    ...resources,
    weapons: resources.weapons ?? [],
    documents: resources.documents ?? [],
    tokens: resources.tokens ?? [],
    importantSupplies: resources.importantSupplies ?? [],
  };
}

const defaultCourt = () => ({
  rulerName: '未知君主',
  orderSummary: '当前官方秩序尚未写入。',
  legitimacyPressure: '未知',
  edicts: [],
  wantedNotices: [],
  keyOfficials: [],
});

const defaultSituationOverview = () => ({
  summary: '当前局势尚未写入。',
  currentPressure: [],
  immediateHooks: [],
});

const defaultMemoryProjectionSettings = (): MemoryProjectionSettings => ({
  recentRawTurnLimit: 10,
  recentTurnLimit: 20,
  recentTurnCompressThreshold: 20,
  recentTurnKeepAfterCompress: 12,
  npcRecentMemoryDefaultLimit: 8,
  npcRecentMemoryImportantLimit: 12,
  focusedNpcRecentMemoryLimit: 2,
  npcMemoryCompressThreshold: 20,
  npcMemoryKeepAfterCompress: 40,
  locationMemoryCompressThreshold: 30,
  taskMemoryCompressThreshold: 30,
  midTermSummaryLimit: 4,
  longTermFactLimit: 8,
  vectorResultLimit: 6,
  maxPromptMemoryTokens: 80000,
  recentStoryTokenBudget: 30000,
  npcMemoryTokenBudget: 20000,
  midTermTokenBudget: 8000,
  longTermFactTokenBudget: 8000,
  locationMemoryTokenBudget: 4000,
  retrievalTokenBudget: 10000,
  enableAutoMemorySummary: true,
  preferDedicatedMemorySummaryApi: true,
});

const defaultMemoryArchive = (): NormalizedMemoryArchive => ({
  schemaVersion: 2,
  recentTurnSummaries: [],
  midTermSummaries: [],
  longTermStorySummaries: [],
  longTermFacts: [],
  npcInteractionSummaries: [],
  npcMidTermSummaries: [],
  npcLongTermSummaries: [],
  locationMemorySummaries: [],
  settings: defaultMemoryProjectionSettings(),
});

function normalizeMemoryArchive(archive?: MemoryArchive): NormalizedMemoryArchive {
  const defaults = defaultMemoryArchive();
  if (!archive) return defaults;

  return {
    schemaVersion: 2,
    recentTurnSummaries: archive.recentTurnSummaries ?? [],
    midTermSummaries: archive.midTermSummaries ?? [],
    longTermStorySummaries: archive.longTermStorySummaries ?? [],
    longTermFacts: archive.longTermFacts ?? [],
    npcInteractionSummaries: archive.npcInteractionSummaries ?? [],
    npcMidTermSummaries: archive.npcMidTermSummaries ?? [],
    npcLongTermSummaries: archive.npcLongTermSummaries ?? [],
    locationMemorySummaries: archive.locationMemorySummaries ?? [],
    settings: archive.schemaVersion === 2
      ? { ...defaults.settings, ...(archive.settings ?? {}) }
      : upgradeLegacyMemoryProjectionSettings(defaults.settings, archive.settings),
    memorySummaryMaintenance: normalizeMemorySummaryMaintenance(archive.memorySummaryMaintenance),
  };
}

function normalizeMemorySummaryMaintenance(
  maintenance?: MemorySummaryMaintenance,
): MemorySummaryMaintenance | undefined {
  if (
    !maintenance
    || maintenance.status !== 'pending'
    || typeof maintenance.queuedAt !== 'string'
    || !maintenance.queuedAt.trim()
    || !Number.isInteger(maintenance.triggerTurnNumber)
    || maintenance.triggerTurnNumber < 0
  ) {
    return undefined;
  }

  return {
    status: 'pending',
    queuedAt: maintenance.queuedAt,
    triggerTurnNumber: maintenance.triggerTurnNumber,
    ...(typeof maintenance.lastAttemptAt === 'string' && maintenance.lastAttemptAt.trim()
      ? { lastAttemptAt: maintenance.lastAttemptAt }
      : {}),
    ...(typeof maintenance.lastFailureReason === 'string' && maintenance.lastFailureReason.trim()
      ? { lastFailureReason: maintenance.lastFailureReason.trim().slice(0, 240) }
      : {}),
  };
}

function upgradeLegacyMemoryProjectionSettings(
  defaults: MemoryProjectionSettings,
  legacy?: MemoryProjectionSettings,
): MemoryProjectionSettings {
  const settings = { ...defaults, ...(legacy ?? {}) };
  const replacements: Array<[
    keyof MemoryProjectionSettings,
    MemoryProjectionSettings[keyof MemoryProjectionSettings],
    MemoryProjectionSettings[keyof MemoryProjectionSettings],
  ]> = [
    ['recentRawTurnLimit', 4, 10],
    ['recentTurnCompressThreshold', 30, 20],
    ['npcRecentMemoryDefaultLimit', 2, 8],
    ['npcRecentMemoryImportantLimit', 5, 12],
    ['npcMemoryCompressThreshold', 40, 20],
    ['npcMemoryKeepAfterCompress', 12, 40],
    ['midTermSummaryLimit', 3, 4],
    ['maxPromptMemoryTokens', 40000, 80000],
    ['recentStoryTokenBudget', 12000, 30000],
    ['npcMemoryTokenBudget', 12000, 20000],
    ['midTermTokenBudget', 6000, 8000],
    ['longTermFactTokenBudget', 5000, 8000],
    ['locationMemoryTokenBudget', 3000, 4000],
    ['retrievalTokenBudget', 8000, 10000],
  ];
  for (const [field, oldValue, newValue] of replacements) {
    if (legacy?.[field] === oldValue) settings[field] = newValue as never;
  }
  return settings;
}

function normalizeWorldlineSettings(settings?: WorldlineRuntimeSettings): WorldlineRuntimeSettings {
  return {
    knowledgeMode: settings?.knowledgeMode ?? 'default',
    knowledgeBaseId: settings?.knowledgeBaseId,
    storyPackIds: settings?.storyPackIds ?? [],
  };
}

function normalizeTroopLedgers(troops?: RuntimeState['troops']): TroopLedgerEntry[] {
  return normalizeDuplicateTerminalTroopLineages((troops ?? []).map((troop) => {
    const locationId = troop.locationId?.trim();
    const lastKnownLocationId = troop.lastKnownLocationId?.trim() || locationId;
    const fatigue = troop.fatigue ?? DEFAULT_TROOP_LEDGER_OPERATIONAL_FIELDS.fatigue;
    const warFatiguePercent = resolveTroopFatiguePercent({
      fatigue,
      warFatiguePercent: troop.warFatiguePercent,
    });
    return {
      ...troop,
      detailLevel: troop.detailLevel ?? 'operational',
      ...(locationId ? { locationId } : {}),
      ...(lastKnownLocationId ? { lastKnownLocationId } : {}),
      ...(!troop.lastKnownAt?.trim() && lastKnownLocationId && troop.updatedAt?.trim()
        ? { lastKnownAt: troop.updatedAt.trim() }
        : {}),
      quality: troop.quality ?? DEFAULT_TROOP_LEDGER_OPERATIONAL_FIELDS.quality,
      fatigue: troopFatigueBandFromPercent(warFatiguePercent),
      warFatiguePercent,
      readiness: troop.readiness ?? DEFAULT_TROOP_LEDGER_OPERATIONAL_FIELDS.readiness,
      lifecycleStatus: troop.lifecycleStatus ?? DEFAULT_TROOP_LEDGER_OPERATIONAL_FIELDS.lifecycleStatus,
      knownLevel: troop.knownLevel ?? DEFAULT_TROOP_LEDGER_OPERATIONAL_FIELDS.knownLevel,
      certainty: troop.certainty ?? DEFAULT_TROOP_LEDGER_OPERATIONAL_FIELDS.certainty,
    };
  }));
}

function normalizeFactionTroopReferences(
  factions: FactionLedgerEntry[],
  troops: TroopLedgerEntry[],
): FactionLedgerEntry[] {
  return factions.map((faction) => {
    const relatedTroopIds = normalizeCurrentTroopReferenceIds(faction.relatedTroopIds, troops);
    return relatedTroopIds === faction.relatedTroopIds
      ? faction
      : { ...faction, relatedTroopIds };
  });
}

function normalizeHoldingTroopReferences(
  holdings: HoldingLedgerEntry[],
  troops: TroopLedgerEntry[],
): HoldingLedgerEntry[] {
  return holdings.map((holding) => {
    const garrisonTroopIds = normalizeCurrentTroopReferenceIds(holding.garrisonTroopIds, troops);
    return garrisonTroopIds === holding.garrisonTroopIds
      ? holding
      : { ...holding, garrisonTroopIds };
  });
}

const locationBackedHoldingTypes = new Set<HoldingLedgerEntry['type']>([
  'county',
  'commandery',
  'city',
  'fort',
  'pass',
  'port',
  'village',
]);

export function isLocationBackedHolding(holding: Pick<HoldingLedgerEntry, 'type' | 'locationId'>): boolean {
  return typeof holding.locationId === 'string'
    && holding.locationId.trim().length > 0
    && locationBackedHoldingTypes.has(holding.type);
}

export function resolveCanonicalHoldingId(
  current: Pick<HoldingLedgerEntry, 'holdingId' | 'type' | 'locationId'>,
  incoming: Pick<HoldingLedgerEntry, 'holdingId' | 'type' | 'locationId'>,
): string {
  const currentId = current.holdingId.trim();
  const incomingId = incoming.holdingId.trim();
  const currentLocationId = current.locationId?.trim();
  const incomingLocationId = incoming.locationId?.trim();

  if (currentLocationId && currentId === currentLocationId) return currentId;
  if (incomingLocationId && incomingId === incomingLocationId) return incomingId;
  return currentId || incomingId;
}

export function findExistingHoldingByLedgerIdentity(
  holdings: HoldingLedgerEntry[],
  incoming: Pick<HoldingLedgerEntry, 'holdingId' | 'name' | 'type' | 'locationId'>,
): HoldingLedgerEntry | undefined {
  const incomingId = incoming.holdingId.trim();
  const byId = holdings.find((holding) => holding.holdingId === incomingId);
  if (byId) return byId;

  const locationId = incoming.locationId?.trim();
  if (locationId && isLocationBackedHolding(incoming)) {
    const byLocation = holdings.find((holding) => (
      holding.locationId?.trim() === locationId
      && isLocationBackedHolding(holding)
      && holding.type === incoming.type
    ));
    if (byLocation) return byLocation;
  }

  if (!locationBackedHoldingTypes.has(incoming.type)) return undefined;
  const incomingName = normalizeHoldingIdentityText(incoming.name);
  if (!incomingName) return undefined;
  return holdings.find((holding) => {
    if (holding.type !== incoming.type || !locationBackedHoldingTypes.has(holding.type)) return false;
    if (normalizeHoldingIdentityText(holding.name) !== incomingName) return false;
    const currentLocationId = holding.locationId?.trim();
    return !currentLocationId || !locationId || currentLocationId === locationId;
  });
}

function normalizeHoldingIdentityText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').trim().toLocaleLowerCase();
}

function normalizeHoldingLedgers(holdings?: RuntimeState['holdings']): HoldingLedgerEntry[] {
  const normalized: HoldingLedgerEntry[] = [];

  for (const rawHolding of holdings ?? []) {
    const holding = normalizeLegacyHoldingCivilAdministration(rawHolding);
    const existing = findExistingHoldingByLedgerIdentity(normalized, holding);
    if (!existing) {
      normalized.push(holding);
      continue;
    }

    const holdingId = resolveCanonicalHoldingId(existing, holding);
    const merged = normalizeLegacyHoldingCivilAdministration({
      ...existing,
      ...holding,
      holdingId,
      aliases: mergeStringLists(existing.aliases, holding.aliases),
      garrisonTroopIds: mergeStringLists(existing.garrisonTroopIds, holding.garrisonTroopIds),
      relatedNpcIds: mergeStringLists(existing.relatedNpcIds, holding.relatedNpcIds),
      riskNotes: mergeStringLists(existing.riskNotes, holding.riskNotes),
      recentChanges: mergeStringLists(existing.recentChanges, holding.recentChanges),
    });

    const index = normalized.indexOf(existing);
    normalized[index] = merged;
  }

  return normalized;
}

function mergeStringLists(
  a: string[] | undefined,
  b: string[] | undefined,
): string[] | undefined {
  const merged = [...(a ?? []), ...(b ?? [])]
    .map((item) => item.trim())
    .filter(Boolean);
  if (merged.length === 0) return undefined;
  return [...new Set(merged)];
}

function defaultCalendarErasForWorldBook(worldBookId: string): CalendarEraEntry[] {
  if (worldBookId !== 'threeKingdoms') return [];
  return [
    {
      eraId: 'han_zhongping',
      eraName: '中平',
      startYear: 184,
      startMonth: 1,
      startDay: 1,
      rulerName: '汉灵帝',
      source: 'threeKingdoms.defaultEra',
    },
    {
      eraId: 'han_chuping',
      eraName: '初平',
      startYear: 190,
      startMonth: 1,
      startDay: 1,
      rulerName: '汉献帝',
      source: 'threeKingdoms.defaultEra',
    },
    {
      eraId: 'han_xingping',
      eraName: '兴平',
      startYear: 194,
      startMonth: 1,
      startDay: 1,
      rulerName: '汉献帝',
      source: 'threeKingdoms.defaultEra',
    },
    {
      eraId: 'han_jianan',
      eraName: '建安',
      startYear: 196,
      startMonth: 1,
      startDay: 1,
      rulerName: '汉献帝',
      source: 'threeKingdoms.defaultEra',
    },
    {
      eraId: 'han_yankang',
      eraName: '延康',
      startYear: 220,
      startMonth: 3,
      startDay: 1,
      rulerName: '汉献帝',
      source: 'threeKingdoms.defaultEra',
    },
    {
      eraId: 'wei_huangchu',
      eraName: '黄初',
      startYear: 220,
      startMonth: 12,
      startDay: 1,
      rulerName: '魏文帝',
      source: 'threeKingdoms.defaultEra',
    },
  ];
}

function normalizeCalendarEras(state: RuntimeState): CalendarEraEntry[] {
  const normalized = (state.calendarEras ?? [])
    .map(normalizeCalendarEra)
    .filter((era): era is CalendarEraEntry => Boolean(era));

  const defaultEras = defaultCalendarErasForWorldBook(state.worldBookId);
  const defaultSourceByEraId = new Map(defaultEras.map((era) => [era.eraId, era.source]));
  const normalizedWithSources = normalized.map((era) => {
    const defaultSource = defaultSourceByEraId.get(era.eraId);
    if (era.source || !defaultSource) {
      return era;
    }
    return { ...era, source: defaultSource };
  });
  const eras = defaultEras.length > 0
    ? [...defaultEras, ...normalizedWithSources]
    : normalizedWithSources;
  return dedupeAndSortCalendarEras(eras);
}

function normalizeCalendarEra(value: CalendarEraEntry | undefined | null): CalendarEraEntry | undefined {
  if (!value || typeof value.eraId !== 'string' || typeof value.eraName !== 'string') return undefined;
  const eraId = value.eraId.trim();
  const eraName = value.eraName.trim();
  if (!eraId || !eraName || !Number.isFinite(value.startYear) || value.startYear <= 0) return undefined;

  return {
    eraId,
    eraName,
    startYear: Math.max(1, Math.floor(value.startYear)),
    ...(value.startMonth !== undefined ? { startMonth: clampCalendarInt(value.startMonth, 1, 12) } : {}),
    ...(value.startDay !== undefined ? { startDay: clampCalendarInt(value.startDay, 1, 30) } : {}),
    ...(typeof value.rulerName === 'string' && value.rulerName.trim() ? { rulerName: value.rulerName.trim() } : {}),
    ...(typeof value.source === 'string' && value.source.trim() ? { source: value.source.trim() } : {}),
    ...(typeof value.note === 'string' && value.note.trim() ? { note: value.note.trim() } : {}),
  };
}

function dedupeAndSortCalendarEras(eras: CalendarEraEntry[]): CalendarEraEntry[] {
  const byId = new Map<string, CalendarEraEntry>();
  for (const era of eras) {
    byId.set(era.eraId, era);
  }
  return [...byId.values()].sort(compareCalendarEra);
}

function compareCalendarEra(a: CalendarEraEntry, b: CalendarEraEntry): number {
  return (a.startYear - b.startYear)
    || ((a.startMonth ?? 1) - (b.startMonth ?? 1))
    || ((a.startDay ?? 1) - (b.startDay ?? 1));
}

function clampCalendarInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function ensureLuanShiState(state: RuntimeState): NormalizedLuanShiState {
  state = normalizeFactionLedgerIdentities(state).state;
  const normalizedResourceState = normalizeCanonicalLedgerResourceShadows(
    normalizeResources(state.resources),
    state.playerResources ?? {},
  );
  const troops = normalizeTroopLedgers(state.troops);
  const holdings = normalizeHoldingTroopReferences(normalizeHoldingLedgers(state.holdings), troops);
  const privateAssetNormalization = normalizePrivateAssetLedgers(state.privateAssets);
  const privateAssets = privateAssetNormalization.assets;
  const privateAssetProjects = (state.privateAssetProjects ?? []).map((project) => ({
    ...project,
    assetId: remapPrivateAssetId(project.assetId, privateAssetNormalization.idMap),
  }));
  const domesticReports = (state.domesticReports ?? []).map((report) => ({
    ...report,
    ...(report.privateAssetHighlights
      ? {
          privateAssetHighlights: dedupeByKey(
            report.privateAssetHighlights.map((highlight) => ({
              ...highlight,
              privateAssetId: remapPrivateAssetId(
                highlight.privateAssetId,
                privateAssetNormalization.idMap,
              ),
            })),
            (highlight) => highlight.privateAssetId,
          ),
        }
      : {}),
    ...(report.projectHighlights
      ? {
          projectHighlights: report.projectHighlights.map((highlight) => ({
            ...highlight,
            ...(highlight.assetId
              ? {
                  assetId: remapPrivateAssetId(
                    highlight.assetId,
                    privateAssetNormalization.idMap,
                  ),
                }
              : {}),
          })),
        }
      : {}),
  }));
  const factions = normalizeFactionTroopReferences(state.factions ?? [], troops)
    .map(normalizeFactionRecentActionHistory);
  const normalizedPlayer = normalizePlayerProgression(state.player);
  return {
    ...state,
    player: normalizedPlayer
      ? {
          ...normalizedPlayer,
          vitals: normalizePlayerVitals(normalizedPlayer.vitals),
        }
      : normalizedPlayer,
    gameDifficulty: normalizeGameDifficulty(state.gameDifficulty),
    combatDifficulty: normalizeEncounterDifficulty('combat', state.combatDifficulty),
    warDifficulty: normalizeEncounterDifficulty('war', state.warDifficulty),
    narrativePerspective: normalizeNarrativePerspective(state.narrativePerspective),
    worldlineSettings: normalizeWorldlineSettings(state.worldlineSettings),
    worldlineAnchorStates: normalizeHistoricalAnchorStates(
      state.worldlineAnchorStates,
      state.worldTrends,
      state.currentDate,
    ),
    calendarEras: normalizeCalendarEras(state),
    npcs: state.npcs ?? [],
    turnEvents: state.turnEvents ?? [],
    locations: state.locations ?? [],
    routes: state.routes ?? [],
    mapNodes: state.mapNodes ?? [],
    routeEdges: state.routeEdges ?? [],
    resources: normalizedResourceState.resources,
    playerResources: normalizedResourceState.playerResources,
    holdings,
    holdingGovernanceProjects: (state.holdingGovernanceProjects ?? []).map((project) => ({
      ...project,
      host: { ...project.host },
      ...(project.assistant ? { assistant: { ...project.assistant } } : {}),
      baseline: { ...project.baseline },
      expectedEffects: Object.fromEntries(
        Object.entries(project.expectedEffects ?? {}).map(([field, range]) => [field, { ...range }]),
      ),
      modifiers: { ...project.modifiers },
      ...(project.appliedArtIds ? { appliedArtIds: [...project.appliedArtIds] } : {}),
      ...(project.result ? {
        result: {
          ...project.result,
          deltas: { ...project.result.deltas },
        },
      } : {}),
    })),
    privateAssets,
    privateAssetProjects,
    domesticReports,
    factions,
    troops,
    heavyCavalryFormationProjects: (state.heavyCavalryFormationProjects ?? []).map((project) => ({ ...project })),
    court: state.court ?? defaultCourt(),
    situationOverview: state.situationOverview ?? defaultSituationOverview(),
    plotPlan: state.plotPlan ?? [],
    worldTrends: state.worldTrends ?? [],
    conflicts: state.conflicts ?? [],
    combatRecords: state.combatRecords ?? [],
    npcAwarenessIndex: state.npcAwarenessIndex ?? [],
    heroineThreads: Array.isArray(state.heroineThreads)
      ? normalizeHeroineThreads(state.heroineThreads, state.npcs ?? [])
      : state.heroineThreads ?? [],
    bondThreads: Array.isArray(state.bondThreads)
      ? normalizeBondThreads(state.bondThreads, state.npcs ?? [])
      : state.bondThreads ?? [],
    correspondence: normalizeCorrespondenceEntries(state.correspondence),
    correspondenceCommitments: normalizeCorrespondenceCommitments(state.correspondenceCommitments),
    memoryArchive: normalizeMemoryArchive(state.memoryArchive),
  };
}

function dedupeByKey<T>(values: T[], getKey: (value: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const value of values) byKey.set(getKey(value), value);
  return [...byKey.values()];
}
