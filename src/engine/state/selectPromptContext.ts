import type {
  BondThreadEntry,
  CombatRecord,
  FactionLedgerEntry,
  HeroineThreadEntry,
  HoldingLedgerEntry,
  LocationLedgerEntry,
  LuanShiNpc,
  LocationMemorySummary,
  LongTermStoryMemorySummary,
  LongTermMemoryFact,
  MemoryProjectionSettings,
  MemoryEmbeddingSourceType,
  MidTermMemorySummary,
  NpcInteractionSummary,
  NpcLongTermMemorySummary,
  NpcMidTermMemorySummary,
  NpcMemoryEntry,
  PlotPlanEntry,
  Quest,
  RecentTurnMemoryEntry,
  RemoteNpcPresenceBeat,
  ResourceLedger,
  Rumor,
  RuntimeState,
  SituationOverview,
  TroopLedgerEntry,
  TurnEventRecord,
  WorldlineStoryPack,
  WorldTrendEntry,
  WorldlineProjectionHint,
} from '../types';
import { isCurrentTroopLedgerEntry } from './troopLifecycle';
import { ensureLuanShiState, type NormalizedLuanShiState } from './createInitialRuntimeState';
import { filterProtagonistNpcClones } from './playerNpcBoundary';
import { isNpcPhysicallyPresent } from './npcPresence';
import { selectRemoteNpcPresenceBeats } from '../npc/RemoteNpcPresence';
import {
  getWorldlineKnowledgeBase,
  getWorldlineStoryPack,
} from '../worldline/WorldlineKnowledgeRegistry';
import { buildWorldlineKnowledgeProjection } from '../worldline/WorldlineKnowledgeProjection';
import {
  buildSituationProjection,
  SITUATION_PROJECTION_BUDGET,
  type SituationProjection,
} from './situationProjection';
import { isOpenCurrentMatter } from './currentMatterLifecycle';
import {
  buildContinuityMatterProjection,
  type ContinuityMatterProjection,
} from './continuityMatterProjection';
import {
  isWorldChronicleEligible,
  isWorldChronicleOngoing,
} from './worldChroniclePolicy';

export interface SelectedPromptContext {
  currentDate: string;
  player: RuntimeState['player'];
  playerName: string;
  playerRole: string;
  currentLocationId: string;
  currentLocation?: LocationLedgerEntry;
  presentNpcs: LuanShiNpc[];
  focusedNpcs: LuanShiNpc[];
  relevantNpcMemories: NpcMemoryEntry[];
  npcMemoryBlocks: NpcMemoryProjectionBlock[];
  recentTurnMemorySummaries: RecentTurnMemoryEntry[];
  relevantMidTermSummaries: MidTermMemorySummary[];
  storyLongTermSummaries: LongTermStoryMemorySummary[];
  relevantLongTermFacts: LongTermMemoryFact[];
  relevantNpcInteractionSummaries: NpcInteractionSummary[];
  relevantLocationMemorySummaries: LocationMemorySummary[];
  recentTurnEvents: TurnEventRecord[];
  activeQuests: Quest[];
  relevantCurrentQuests: Quest[];
  continuityMatterProjection: ContinuityMatterProjection;
  resolvedCurrentMatters: Quest[];
  relevantSignals: Rumor[];
  localSituationNotes: string[];
  resources: ResourceLedger;
  playerResources: Record<string, number>;
  relevantFactions: FactionLedgerEntry[];
  relevantTroops: TroopLedgerEntry[];
  relevantHoldings: HoldingLedgerEntry[];
  relevantCombatRecords: CombatRecord[];
  situationOverview: SituationOverview;
  relevantWorldTrends: WorldTrendEntry[];
  relevantPlotPlans: PlotPlanEntry[];
  remoteNpcPresenceBeats: RemoteNpcPresenceBeat[];
  worldlineKnowledgeHints: WorldlineProjectionHint[];
  situationProjection: SituationProjection;
  relationshipThreads: RelationshipThreadProjection;
}

export type NpcMemoryProjectionScope = 'present' | 'focused';
export type NpcMemoryProjectionImportance = 'important' | 'normal';

export interface NpcMemoryProjectionBlock {
  npcId: string;
  npcName: string;
  scope: NpcMemoryProjectionScope;
  importance: NpcMemoryProjectionImportance;
  memories: NpcMemoryEntry[];
  midTermSummaries: NpcMidTermMemorySummary[];
  longTermSummaries: NpcLongTermMemorySummary[];
  retrievedMemories: NpcMemoryProjectionRetrievedEntry[];
  totalMemoryCount: number;
  omittedMemoryCount: number;
}

export interface NpcMemoryProjectionRetrievedEntry {
  retrievalMode: 'local' | 'vector';
  sourceType: MemoryEmbeddingSourceType;
  sourceId: string;
  title?: string;
  text: string;
  time?: string;
  relatedNpcIds?: string[];
  relatedLocationIds?: string[];
  score: number;
  reason: string;
  recallStrength?: 'strong' | 'weak';
  contentMode?: 'original' | 'summary';
  sourceTurnNumber?: number;
  retrievalModes?: Array<'local' | 'vector'>;
}

export const RELATIONSHIP_THREAD_PROJECTION_LIMITS = {
  totalThreads: 6,
  pausedThreads: 1,
  milestonesPerThread: 2,
  tagsPerThread: 4,
  textBudgetChars: 1800,
} as const;

const projectableRelationshipStatuses = new Set(['active', 'paused']);
const projectableBondTypes = new Set([
  'sworn',
  'kinship',
  'mentor',
  'lordVassal',
  'ally',
  'debt',
  'rival',
  'enemy',
  'other',
]);

export interface RelationshipThreadProjection {
  heroineThreads: HeroineThreadEntry[];
  bondThreads: BondThreadEntry[];
  omittedHeroineThreadCount: number;
  omittedBondThreadCount: number;
}

type RelationshipThreadCandidate =
  | {
      kind: 'heroine';
      thread: HeroineThreadEntry;
      statusRank: number;
      updatedAt: string;
    }
  | {
      kind: 'bond';
      thread: BondThreadEntry;
      statusRank: number;
      updatedAt: string;
    };

interface LedgerRelevanceContext {
  npcIds: Set<string>;
  locationIds: Set<string>;
  factionIds: Set<string>;
  troopIds: Set<string>;
  holdingIds: Set<string>;
}

export interface SelectPromptContextOptions {
  queryTexts?: string[];
}

export function selectPromptContext(
  state: RuntimeState,
  options: SelectPromptContextOptions = {},
): SelectedPromptContext {
  const normalized = ensureLuanShiState(state);
  const projectableNpcs = filterProtagonistNpcClones(normalized, normalized.npcs);
  const projectionState: NormalizedLuanShiState = { ...normalized, npcs: projectableNpcs };
  const presentNpcs = projectableNpcs.filter((npc) => isNpcPhysicallyPresent(projectionState, npc));
  const focusedNpcs = projectableNpcs.filter(
    (npc) => npc.isFocused && !isNpcPhysicallyPresent(projectionState, npc),
  );
  const relevantNpcIds = new Set([
    ...presentNpcs.map((npc) => npc.npcId),
    ...focusedNpcs.map((npc) => npc.npcId),
  ]);
  const memoryArchive = projectionState.memoryArchive;
  const currentLocationId = projectionState.currentLocationId;
  const baseLedgerRelevance = buildLedgerRelevanceContext(projectionState, relevantNpcIds, currentLocationId);
  const relevantCurrentQuests = selectRelevantCurrentQuests(projectionState.activeQuests, relevantNpcIds, currentLocationId, baseLedgerRelevance);
  const continuityMatterProjection = buildContinuityMatterProjection(
    projectionState.activeQuests,
    projectionState.currentDate,
  );
  const continuityMatterIds = new Set(continuityMatterProjection.entries.map((entry) => entry.matterId));
  const continuityMatters = projectionState.activeQuests.filter((quest) => continuityMatterIds.has(quest.id));
  const resolvedCurrentMatters = selectResolvedCurrentMatters(
    projectionState.activeQuests,
    [...presentNpcs, ...focusedNpcs],
    relevantNpcIds,
    currentLocationId,
    baseLedgerRelevance,
  );
  const relevantSignals = selectRelevantSignals(projectionState.knownRumors, relevantNpcIds, currentLocationId, baseLedgerRelevance);
  const relevantWorldTrends = selectRelevantWorldTrends(projectionState.worldTrends, relevantNpcIds, currentLocationId, baseLedgerRelevance);
  const ledgerRelevance = extendLedgerRelevanceWithCurrentMatters(
    projectionState,
    baseLedgerRelevance,
    [...new Map([...relevantCurrentQuests, ...continuityMatters].map((quest) => [quest.id, quest])).values()],
    relevantSignals,
    relevantWorldTrends,
  );
  const relevantPlotPlans = selectRelevantPlotPlans(projectionState.plotPlan);
  const relevantFactions = selectRelevantFactions(projectionState.factions, presentNpcs, focusedNpcs, ledgerRelevance);
  const relevantTroops = selectRelevantTroops(
    projectionState.troops,
    relevantNpcIds,
    currentLocationId,
    ledgerRelevance,
    options.queryTexts,
  );
  const relevantHoldings = selectRelevantHoldings(projectionState.holdings, relevantNpcIds, currentLocationId, ledgerRelevance);
  const relevantCombatRecords = selectRelevantCombatRecords(
    projectionState.combatRecords,
    relevantNpcIds,
    currentLocationId,
    relevantCurrentQuests,
    relevantWorldTrends,
  );
  const remoteNpcPresenceBeats = selectRemoteNpcPresenceBeats(projectionState, {
    maxBeats: SITUATION_PROJECTION_BUDGET.remoteNpcBeats,
  });
  const worldlineSettings = projectionState.worldlineSettings;
  const worldlineStoryPacks = (worldlineSettings?.storyPackIds ?? [])
    .map((storyPackId) => getWorldlineStoryPack(storyPackId))
    .filter((storyPack): storyPack is WorldlineStoryPack => storyPack !== undefined);
  const worldlineKnowledgeProjection = buildWorldlineKnowledgeProjection({
    state: projectionState,
    knowledgeBase: getWorldlineKnowledgeBase(worldlineSettings?.knowledgeBaseId),
    storyPacks: worldlineStoryPacks,
    mode: worldlineSettings?.knowledgeMode ?? 'default',
    queryTexts: options.queryTexts,
  });
  const situationProjection = buildSituationProjection({
    currentMatters: relevantCurrentQuests,
    signals: relevantSignals,
    chronicles: relevantWorldTrends,
    plotPlans: relevantPlotPlans,
    remoteNpcBeats: remoteNpcPresenceBeats,
    worldlineHints: worldlineKnowledgeProjection.hints,
  });
  const relationshipThreads = selectRelationshipThreadProjection(projectionState, {
    presentNpcs,
    focusedNpcs,
    relevantCurrentQuests,
    relevantSignals,
    relevantWorldTrends,
    remoteNpcPresenceBeats,
  });

  return {
    currentDate: projectionState.currentDate,
    player: projectionState.player,
    playerName: projectionState.player.name,
    playerRole: projectionState.player.roleType,
    currentLocationId: projectionState.currentLocationId,
    currentLocation: projectionState.locations.find(
      (location) => location.locationId === projectionState.currentLocationId,
    ),
    presentNpcs,
    focusedNpcs,
    relevantNpcMemories: projectableNpcs
      .filter((npc) => relevantNpcIds.has(npc.npcId))
      .flatMap((npc) => npc.memories),
    npcMemoryBlocks: buildNpcMemoryProjectionBlocks(
      presentNpcs,
      focusedNpcs,
      memoryArchive.settings,
      memoryArchive.npcMidTermSummaries,
      memoryArchive.npcLongTermSummaries,
    ),
    recentTurnMemorySummaries: memoryArchive.recentTurnSummaries.slice(-memoryArchive.settings.recentTurnLimit),
    relevantMidTermSummaries: memoryArchive.midTermSummaries
      .filter((summary) => !summary.foldedIntoLongTermSummaryId)
      .filter((summary) => isMemorySummaryRelevant(summary.relatedNpcIds, summary.relatedLocationIds, relevantNpcIds, currentLocationId))
      .slice(-memoryArchive.settings.midTermSummaryLimit),
    storyLongTermSummaries: memoryArchive.longTermStorySummaries,
    relevantLongTermFacts: memoryArchive.longTermFacts
      .filter((fact) => isMemorySummaryRelevant(fact.relatedNpcIds, fact.relatedLocationIds, relevantNpcIds, currentLocationId))
      .slice(-memoryArchive.settings.longTermFactLimit),
    relevantNpcInteractionSummaries: memoryArchive.npcInteractionSummaries
      .filter((summary) => relevantNpcIds.has(summary.npcId))
      .filter((summary) => !memoryArchive.npcLongTermSummaries.some((item) => item.npcId === summary.npcId)),
    relevantLocationMemorySummaries: memoryArchive.locationMemorySummaries
      .filter((summary) => summary.locationId === currentLocationId),
    recentTurnEvents: projectionState.turnEvents.slice(-3),
    activeQuests: projectionState.activeQuests.filter(isOpenCurrentMatter),
    relevantCurrentQuests,
    continuityMatterProjection,
    resolvedCurrentMatters,
    relevantSignals,
    localSituationNotes: projectionState.localSituationNotes,
    resources: projectionState.resources,
    playerResources: projectionState.playerResources,
    relevantFactions,
    relevantTroops,
    relevantHoldings,
    relevantCombatRecords,
    situationOverview: projectionState.situationOverview,
    relevantWorldTrends,
    relevantPlotPlans,
    remoteNpcPresenceBeats,
    worldlineKnowledgeHints: worldlineKnowledgeProjection.hints,
    situationProjection,
    relationshipThreads,
  };
}

function selectRelationshipThreadProjection(
  state: RuntimeState,
  context: {
    presentNpcs: LuanShiNpc[];
    focusedNpcs: LuanShiNpc[];
    relevantCurrentQuests: Quest[];
    relevantSignals: Rumor[];
    relevantWorldTrends: WorldTrendEntry[];
    remoteNpcPresenceBeats: RemoteNpcPresenceBeat[];
  },
): RelationshipThreadProjection {
  const relevance = buildRelationshipThreadRelevance(context);
  const heroineThreads = (Array.isArray(state.heroineThreads) ? state.heroineThreads : [])
    .filter(isProjectableHeroineThread);
  const bondThreads = (Array.isArray(state.bondThreads) ? state.bondThreads : [])
    .filter(isProjectableBondThread);
  const candidates: RelationshipThreadCandidate[] = [
    ...heroineThreads
      .filter((thread) => isHeroineThreadRelevant(thread, relevance))
      .map((thread) => ({
        kind: 'heroine' as const,
        thread,
        statusRank: relationshipThreadStatusRank(thread.status),
        updatedAt: thread.lastUpdatedAt,
      })),
    ...bondThreads
      .filter((thread) => isBondThreadRelevant(thread, relevance))
      .map((thread) => ({
        kind: 'bond' as const,
        thread,
        statusRank: relationshipThreadStatusRank(thread.status),
        updatedAt: thread.lastUpdatedAt,
      })),
  ].sort(compareRelationshipThreadCandidates);

  const selectedHeroineThreads: HeroineThreadEntry[] = [];
  const selectedBondThreads: BondThreadEntry[] = [];
  let selectedPausedThreads = 0;

  for (const candidate of candidates) {
    if (selectedHeroineThreads.length + selectedBondThreads.length >= RELATIONSHIP_THREAD_PROJECTION_LIMITS.totalThreads) {
      break;
    }

    if (candidate.thread.status === 'paused') {
      if (selectedPausedThreads >= RELATIONSHIP_THREAD_PROJECTION_LIMITS.pausedThreads) continue;
      selectedPausedThreads += 1;
    }

    if (candidate.kind === 'heroine') {
      selectedHeroineThreads.push(candidate.thread);
    } else {
      selectedBondThreads.push(candidate.thread);
    }
  }

  return {
    heroineThreads: selectedHeroineThreads,
    bondThreads: selectedBondThreads,
    omittedHeroineThreadCount: Math.max(0, heroineThreads.length - selectedHeroineThreads.length),
    omittedBondThreadCount: Math.max(0, bondThreads.length - selectedBondThreads.length),
  };
}

function buildRelationshipThreadRelevance(context: {
  presentNpcs: LuanShiNpc[];
  focusedNpcs: LuanShiNpc[];
  relevantCurrentQuests: Quest[];
  relevantSignals: Rumor[];
  relevantWorldTrends: WorldTrendEntry[];
  remoteNpcPresenceBeats: RemoteNpcPresenceBeat[];
}): { npcIds: Set<string>; npcNames: Set<string> } {
  const npcIds = new Set<string>();
  const npcNames = new Set<string>();

  for (const npc of [...context.presentNpcs, ...context.focusedNpcs]) {
    addOptionalValue(npcIds, npc.npcId);
    addOptionalValue(npcNames, npc.name);
  }

  for (const quest of context.relevantCurrentQuests) {
    for (const npcId of quest.relatedNpcIds ?? []) addOptionalValue(npcIds, npcId);
  }

  for (const signal of context.relevantSignals) {
    addOptionalValue(npcIds, signal.relatedActorId);
    for (const npcId of signal.affectedNpcIds ?? []) addOptionalValue(npcIds, npcId);
  }

  for (const trend of context.relevantWorldTrends) {
    for (const npcId of trend.relatedNpcIds ?? []) addOptionalValue(npcIds, npcId);
    for (const npcId of trend.affectedNpcIds ?? []) addOptionalValue(npcIds, npcId);
    for (const ref of trend.npcAwarenessRefs ?? []) {
      addOptionalValue(npcIds, ref.npcId);
      addOptionalValue(npcNames, ref.name);
    }
  }

  for (const beat of context.remoteNpcPresenceBeats) {
    addOptionalValue(npcIds, beat.npcId);
    addOptionalValue(npcNames, beat.name);
  }

  return { npcIds, npcNames };
}

function addOptionalValue(target: Set<string>, value: string | undefined): void {
  const normalized = value?.trim();
  if (normalized) target.add(normalized);
}

function isProjectableHeroineThread(thread: unknown): thread is HeroineThreadEntry {
  if (!isRelationshipThreadRecord(thread)) return false;
  return isNonEmptyProjectionString(thread.heroineThreadId)
    && isNonEmptyProjectionString(thread.npcId)
    && isNonEmptyProjectionString(thread.npcName)
    && typeof thread.status === 'string'
    && projectableRelationshipStatuses.has(thread.status)
    && isNonEmptyProjectionString(thread.stage)
    && isNonEmptyProjectionString(thread.relationshipRole)
    && isNonEmptyProjectionString(thread.summary)
    && isNonEmptyProjectionString(thread.lastUpdatedAt)
    && areProjectableOptionalStrings(thread, ['currentPull', 'riskNotes', 'promiseNotes', 'recentProgress'])
    && isProjectableStringArray(thread.tags, true)
    && isProjectableMilestoneArray(thread.milestones);
}

function isProjectableBondThread(thread: unknown): thread is BondThreadEntry {
  if (!isRelationshipThreadRecord(thread)) return false;
  return isNonEmptyProjectionString(thread.bondThreadId)
    && isProjectableNonEmptyStringArray(thread.targetNpcIds, true)
    && isProjectableNonEmptyStringArray(thread.targetNames, false)
    && typeof thread.bondType === 'string'
    && projectableBondTypes.has(thread.bondType)
    && typeof thread.status === 'string'
    && projectableRelationshipStatuses.has(thread.status)
    && isNonEmptyProjectionString(thread.summary)
    && isNonEmptyProjectionString(thread.lastUpdatedAt)
    && areProjectableOptionalStrings(thread, ['currentTension', 'promiseNotes', 'conflictNotes', 'recentProgress'])
    && isProjectableStringArray(thread.tags, true)
    && isProjectableMilestoneArray(thread.milestones);
}

function isRelationshipThreadRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isProjectableStringArray(value: unknown, optional: boolean): boolean {
  if (value === undefined && optional) return true;
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isProjectableNonEmptyStringArray(value: unknown, optional: boolean): boolean {
  if (value === undefined && optional) return true;
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyProjectionString);
}

function isNonEmptyProjectionString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function areProjectableOptionalStrings(record: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => record[field] === undefined || typeof record[field] === 'string');
}

function isProjectableMilestoneArray(value: unknown): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) && value.every((item) => (
    isRelationshipThreadRecord(item)
    && typeof item.happenedAt === 'string'
    && typeof item.summary === 'string'
  ));
}

function isHeroineThreadRelevant(
  thread: HeroineThreadEntry,
  relevance: { npcIds: Set<string>; npcNames: Set<string> },
): boolean {
  return relevance.npcIds.has(thread.npcId) || relevance.npcNames.has(thread.npcName);
}

function isBondThreadRelevant(
  thread: BondThreadEntry,
  relevance: { npcIds: Set<string>; npcNames: Set<string> },
): boolean {
  return Boolean(
    thread.targetNpcIds?.some((npcId) => relevance.npcIds.has(npcId))
    || thread.targetNames.some((name) => relevance.npcNames.has(name)),
  );
}

function relationshipThreadStatusRank(status: HeroineThreadEntry['status'] | BondThreadEntry['status']): number {
  if (status === 'active') return 0;
  if (status === 'paused') return 1;
  return 2;
}

function compareRelationshipThreadCandidates(
  a: RelationshipThreadCandidate,
  b: RelationshipThreadCandidate,
): number {
  if (a.statusRank !== b.statusRank) return a.statusRank - b.statusRank;
  return b.updatedAt.localeCompare(a.updatedAt);
}

function buildLedgerRelevanceContext(
  state: NormalizedLuanShiState,
  relevantNpcIds: Set<string>,
  currentLocationId: string,
): LedgerRelevanceContext {
  const context: LedgerRelevanceContext = {
    npcIds: new Set(relevantNpcIds),
    locationIds: new Set([currentLocationId]),
    factionIds: new Set(),
    troopIds: new Set(),
    holdingIds: new Set(),
  };

  for (const npc of state.npcs) {
    if (relevantNpcIds.has(npc.npcId) && npc.factionId) {
      context.factionIds.add(npc.factionId);
    }
  }

  return closeLedgerRelevanceContext(state, context);
}

function extendLedgerRelevanceWithCurrentMatters(
  state: NormalizedLuanShiState,
  baseContext: LedgerRelevanceContext,
  quests: Quest[],
  signals: Rumor[],
  trends: WorldTrendEntry[],
): LedgerRelevanceContext {
  const context = cloneLedgerRelevanceContext(baseContext);
  for (const quest of quests) addQuestLedgerLinks(context, quest);
  for (const signal of signals) addSignalLedgerLinks(context, signal);
  for (const trend of trends) addWorldTrendLedgerLinks(context, trend);
  return closeLedgerRelevanceContext(state, context);
}

function cloneLedgerRelevanceContext(context: LedgerRelevanceContext): LedgerRelevanceContext {
  return {
    npcIds: new Set(context.npcIds),
    locationIds: new Set(context.locationIds),
    factionIds: new Set(context.factionIds),
    troopIds: new Set(context.troopIds),
    holdingIds: new Set(context.holdingIds),
  };
}

function closeLedgerRelevanceContext(state: NormalizedLuanShiState, context: LedgerRelevanceContext): LedgerRelevanceContext {
  for (const troop of state.troops) {
    if (!isCurrentTroopLedgerEntry(troop)) context.troopIds.delete(troop.troopId);
  }

  for (let guard = 0; guard < 4; guard += 1) {
    let changed = false;

    for (const holding of state.holdings) {
      if (!isHoldingProjectable(holding)) continue;
      if (!isHoldingLinkedToContext(holding, context)) continue;
      changed = addLedgerValue(context.holdingIds, holding.holdingId) || changed;
      changed = addOptionalLedgerValue(context.factionIds, holding.factionId) || changed;
      changed = addCurrentTroopLedgerValues(context.troopIds, holding.garrisonTroopIds, state.troops) || changed;
    }

    for (const troop of state.troops) {
      if (!isCurrentTroopLedgerEntry(troop)) continue;
      if (!isTroopLinkedToContext(troop, context)) continue;
      changed = addLedgerValue(context.troopIds, troop.troopId) || changed;
      changed = addOptionalLedgerValue(context.factionIds, troop.factionId) || changed;
      changed = addOptionalLedgerValue(context.factionIds, troop.previousFactionId) || changed;
    }

    for (const faction of state.factions) {
      if (!isFactionLinkedToContext(faction, context)) continue;
      changed = addLedgerValue(context.factionIds, faction.factionId) || changed;
      changed = addCurrentTroopLedgerValues(context.troopIds, faction.relatedTroopIds, state.troops) || changed;
    }

    if (!changed) break;
  }

  return context;
}

function addQuestLedgerLinks(context: LedgerRelevanceContext, quest: Quest): void {
  addOptionalLedgerValue(context.locationIds, quest.targetLocationId);
  addLedgerValues(context.locationIds, quest.relatedLocationIds);
  addLedgerValues(context.locationIds, quest.affectedPlaceIds);
  addLedgerValues(context.factionIds, quest.relatedFactionIds);
  addLedgerValues(context.factionIds, quest.affectedFactionIds);
  addLedgerValues(context.troopIds, quest.affectedForceIds);
  addLedgerValues(context.holdingIds, quest.affectedHoldingIds);
}

function addSignalLedgerLinks(context: LedgerRelevanceContext, signal: Rumor): void {
  addOptionalLedgerValue(context.locationIds, signal.relatedRegionId);
  addLedgerValues(context.locationIds, signal.relatedLocationIds);
  addLedgerValues(context.locationIds, signal.affectedPlaceIds);
  addOptionalLedgerValue(context.factionIds, signal.relatedFactionId);
  addLedgerValues(context.factionIds, signal.affectedFactionIds);
  addLedgerValues(context.troopIds, signal.affectedForceIds);
  addLedgerValues(context.holdingIds, signal.affectedHoldingIds);
}

function addWorldTrendLedgerLinks(context: LedgerRelevanceContext, trend: WorldTrendEntry): void {
  addOptionalLedgerValue(context.locationIds, trend.locationId);
  addLedgerValues(context.locationIds, trend.relatedPlaceIds);
  addLedgerValues(context.locationIds, trend.affectedPlaceIds);
  addLedgerValues(context.factionIds, trend.relatedFactionIds);
  addLedgerValues(context.factionIds, trend.affectedFactionIds);
  addLedgerValues(context.troopIds, trend.affectedForceIds);
  addLedgerValues(context.holdingIds, trend.affectedHoldingIds);
}

function addLedgerValue(target: Set<string>, value: string): boolean {
  if (target.has(value)) return false;
  target.add(value);
  return true;
}

function addOptionalLedgerValue(target: Set<string>, value: string | undefined): boolean {
  if (!value) return false;
  return addLedgerValue(target, value);
}

function addLedgerValues(target: Set<string>, values: string[] | undefined): boolean {
  let changed = false;
  for (const value of values ?? []) {
    changed = addLedgerValue(target, value) || changed;
  }
  return changed;
}

function addCurrentTroopLedgerValues(
  target: Set<string>,
  values: string[] | undefined,
  troops: TroopLedgerEntry[],
): boolean {
  const terminalTroopIds = new Set(
    troops.filter((troop) => !isCurrentTroopLedgerEntry(troop)).map((troop) => troop.troopId),
  );
  return addLedgerValues(target, values?.filter((troopId) => !terminalTroopIds.has(troopId)));
}

function intersectsSet(values: string[] | undefined, target: Set<string>): boolean {
  return values?.some((value) => target.has(value)) ?? false;
}

function isHoldingProjectable(holding: HoldingLedgerEntry): boolean {
  return holding.status !== 'archived' && holding.status !== 'lost';
}

function isHoldingLinkedToContext(holding: HoldingLedgerEntry, context: LedgerRelevanceContext): boolean {
  return context.holdingIds.has(holding.holdingId)
    || (holding.locationId ? context.locationIds.has(holding.locationId) : false)
    || (holding.factionId ? context.factionIds.has(holding.factionId) : false)
    || (holding.stewardNpcId ? context.npcIds.has(holding.stewardNpcId) : false)
    || intersectsSet(holding.relatedNpcIds, context.npcIds)
    || intersectsSet(holding.garrisonTroopIds, context.troopIds);
}

function isTroopLinkedToContext(troop: TroopLedgerEntry, context: LedgerRelevanceContext): boolean {
  return context.troopIds.has(troop.troopId)
    || (troop.locationId ? context.locationIds.has(troop.locationId) : false)
    || (troop.lastKnownLocationId ? context.locationIds.has(troop.lastKnownLocationId) : false)
    || (troop.leaderNpcId ? context.npcIds.has(troop.leaderNpcId) : false);
}

function isFactionLinkedToContext(faction: FactionLedgerEntry, context: LedgerRelevanceContext): boolean {
  return context.factionIds.has(faction.factionId)
    || intersectsSet(faction.corePersonNpcIds, context.npcIds)
    || intersectsSet(faction.knownMemberNpcIds, context.npcIds)
    || intersectsSet(faction.relatedTroopIds, context.troopIds);
}

function selectRelevantFactions(
  factions: FactionLedgerEntry[],
  presentNpcs: LuanShiNpc[],
  focusedNpcs: LuanShiNpc[],
  ledgerRelevance: LedgerRelevanceContext,
): FactionLedgerEntry[] {
  const linkedFactionIds = new Set(
    [...presentNpcs, ...focusedNpcs]
      .map((npc) => npc.factionId)
      .filter((factionId): factionId is string => Boolean(factionId)),
  );
  const linkedFactionNames = new Set(
    [...presentNpcs, ...focusedNpcs]
      .map((npc) => npc.factionName)
      .filter((factionName): factionName is string => Boolean(factionName)),
  );

  return factions
    .map((faction) => ({ faction, score: scoreFactionRelevance(faction, linkedFactionIds, linkedFactionNames, ledgerRelevance) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || compareUpdatedAtDesc(a.faction.updatedAt, b.faction.updatedAt))
    .slice(0, 5)
    .map((candidate) => candidate.faction);
}

function selectRelevantTroops(
  troops: TroopLedgerEntry[],
  relevantNpcIds: Set<string>,
  currentLocationId: string,
  ledgerRelevance: LedgerRelevanceContext,
  queryTexts: string[] = [],
): TroopLedgerEntry[] {
  const normalizedQuery = queryTexts.join('\n').toLocaleLowerCase('zh-Hans-CN');
  return troops
    .filter(isCurrentTroopLedgerEntry)
    .map((troop) => ({
      troop,
      score: scoreTroopRelevance(troop, relevantNpcIds, currentLocationId, ledgerRelevance)
        + (troopMatchesQuery(troop, normalizedQuery) ? 200 : 0),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || compareUpdatedAtDesc(a.troop.updatedAt, b.troop.updatedAt))
    .slice(0, 5)
    .map((candidate) => candidate.troop);
}

function troopMatchesQuery(troop: TroopLedgerEntry, normalizedQuery: string): boolean {
  if (!normalizedQuery) return false;
  return [
    troop.troopId,
    troop.name,
    troop.specialDesignation,
    ...(troop.aliases ?? []),
  ].some((value) => {
    const normalized = value?.trim().toLocaleLowerCase('zh-Hans-CN');
    return Boolean(normalized && normalizedQuery.includes(normalized));
  });
}

function selectRelevantHoldings(
  holdings: HoldingLedgerEntry[],
  relevantNpcIds: Set<string>,
  currentLocationId: string,
  ledgerRelevance: LedgerRelevanceContext,
): HoldingLedgerEntry[] {
  return holdings
    .filter(isHoldingProjectable)
    .map((holding) => ({ holding, score: scoreHoldingRelevance(holding, relevantNpcIds, currentLocationId, ledgerRelevance) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || compareUpdatedAtDesc(a.holding.updatedAt, b.holding.updatedAt))
    .slice(0, 6)
    .map((candidate) => candidate.holding);
}

function scoreFactionRelevance(
  faction: FactionLedgerEntry,
  linkedFactionIds: Set<string>,
  linkedFactionNames: Set<string>,
  ledgerRelevance: LedgerRelevanceContext,
): number {
  let score = 0;
  if (ledgerRelevance.factionIds.has(faction.factionId)) score += 100;
  if (linkedFactionIds.has(faction.factionId)) score += 60;
  if (linkedFactionNames.has(faction.name)) score += 40;
  if (faction.knownLevel === '亲历') score += 30;
  if (intersectsSet(faction.corePersonNpcIds, ledgerRelevance.npcIds)) score += 30;
  if (intersectsSet(faction.knownMemberNpcIds, ledgerRelevance.npcIds)) score += 20;
  if (intersectsSet(faction.relatedTroopIds, ledgerRelevance.troopIds)) score += 20;
  return score;
}

function scoreTroopRelevance(
  troop: TroopLedgerEntry,
  relevantNpcIds: Set<string>,
  currentLocationId: string,
  ledgerRelevance: LedgerRelevanceContext,
): number {
  let score = 0;
  if (ledgerRelevance.troopIds.has(troop.troopId)) score += 100;
  if (troop.locationId === currentLocationId) score += 60;
  if (troop.lastKnownLocationId === currentLocationId) score += 50;
  if (troop.leaderNpcId && relevantNpcIds.has(troop.leaderNpcId)) score += 50;
  if (troop.relationToPlayer.trim() !== '无交集') score += 20;
  return score;
}

function scoreHoldingRelevance(
  holding: HoldingLedgerEntry,
  relevantNpcIds: Set<string>,
  currentLocationId: string,
  ledgerRelevance: LedgerRelevanceContext,
): number {
  let score = 0;
  if (ledgerRelevance.holdingIds.has(holding.holdingId)) score += 100;
  if (holding.locationId === currentLocationId) score += 60;
  if (holding.stewardNpcId && relevantNpcIds.has(holding.stewardNpcId)) score += 50;
  if (intersectsSet(holding.relatedNpcIds, relevantNpcIds)) score += 40;
  if (holding.factionId && ledgerRelevance.factionIds.has(holding.factionId)) score += 30;
  if (intersectsSet(holding.garrisonTroopIds, ledgerRelevance.troopIds)) score += 30;
  if (holding.status === 'contested' || holding.status === 'temporary') score += 10;
  return score;
}

function compareUpdatedAtDesc(left: string | undefined, right: string | undefined): number {
  return (right ?? '').localeCompare(left ?? '');
}

function selectRelevantPlotPlans(plotPlan: PlotPlanEntry[]): PlotPlanEntry[] {
  return plotPlan
    .filter((plan) => plan.status !== '已完成' && plan.status !== '废弃')
    .slice(-SITUATION_PROJECTION_BUDGET.plotPlans);
}

function selectRelevantCurrentQuests(
  quests: Quest[],
  relevantNpcIds: Set<string>,
  currentLocationId: string,
  ledgerRelevance: LedgerRelevanceContext,
): Quest[] {
  return quests
    .filter(isOpenCurrentMatter)
    .filter((quest) => isQuestRelevantToCurrentContext(quest, relevantNpcIds, currentLocationId, ledgerRelevance))
    .slice(0, SITUATION_PROJECTION_BUDGET.currentMatters);
}

const RESOLVED_CURRENT_MATTER_PROJECTION_LIMIT = 8;

function selectResolvedCurrentMatters(
  quests: Quest[],
  relevantNpcs: LuanShiNpc[],
  relevantNpcIds: Set<string>,
  currentLocationId: string,
  ledgerRelevance: LedgerRelevanceContext,
): Quest[] {
  const linkedBackgroundQuestIds = new Set(
    relevantNpcs
      .filter((npc) => npc.backgroundActivity?.sourceType === 'quest')
      .flatMap((npc) => npc.backgroundActivity?.sourceIds ?? []),
  );

  return quests
    .filter((quest) => !isOpenCurrentMatter(quest))
    .filter((quest) => (
      linkedBackgroundQuestIds.has(quest.id)
      || isTerminalQuestRelevantToCurrentContext(
        quest,
        relevantNpcIds,
        currentLocationId,
        ledgerRelevance,
      )
    ))
    .slice(-RESOLVED_CURRENT_MATTER_PROJECTION_LIMIT);
}

function isTerminalQuestRelevantToCurrentContext(
  quest: Quest,
  relevantNpcIds: Set<string>,
  currentLocationId: string,
  ledgerRelevance: LedgerRelevanceContext,
): boolean {
  if (quest.giverId && relevantNpcIds.has(quest.giverId)) return true;
  if (quest.targetLocationId === currentLocationId) return true;
  if (quest.relatedLocationIds?.includes(currentLocationId)) return true;
  if (quest.affectedPlaceIds?.includes(currentLocationId)) return true;
  if (quest.relatedNpcIds?.some((npcId) => relevantNpcIds.has(npcId))) return true;
  if (quest.affectedNpcIds?.some((npcId) => relevantNpcIds.has(npcId))) return true;
  if (intersectsSet(quest.relatedFactionIds, ledgerRelevance.factionIds)) return true;
  if (intersectsSet(quest.affectedFactionIds, ledgerRelevance.factionIds)) return true;
  if (intersectsSet(quest.affectedForceIds, ledgerRelevance.troopIds)) return true;
  if (intersectsSet(quest.affectedHoldingIds, ledgerRelevance.holdingIds)) return true;

  return !quest.giverId && !hasExplicitQuestContextLinks(quest);
}

function isQuestRelevantToCurrentContext(
  quest: Quest,
  relevantNpcIds: Set<string>,
  currentLocationId: string,
  ledgerRelevance: LedgerRelevanceContext,
): boolean {
  if (quest.priority === 'high') return true;
  if (quest.deadlineAt) return true;
  if (quest.targetLocationId === currentLocationId) return true;
  if (quest.relatedLocationIds?.includes(currentLocationId)) return true;
  if (quest.affectedPlaceIds?.includes(currentLocationId)) return true;
  if (quest.relatedNpcIds?.some((npcId) => relevantNpcIds.has(npcId))) return true;
  if (quest.affectedNpcIds?.some((npcId) => relevantNpcIds.has(npcId))) return true;
  if (intersectsSet(quest.relatedFactionIds, ledgerRelevance.factionIds)) return true;
  if (intersectsSet(quest.affectedFactionIds, ledgerRelevance.factionIds)) return true;
  if (intersectsSet(quest.affectedForceIds, ledgerRelevance.troopIds)) return true;
  if (intersectsSet(quest.affectedHoldingIds, ledgerRelevance.holdingIds)) return true;

  return !hasExplicitQuestContextLinks(quest);
}

function hasExplicitQuestContextLinks(quest: Quest): boolean {
  return Boolean(
    quest.targetLocationId
    || (quest.relatedLocationIds && quest.relatedLocationIds.length > 0)
    || (quest.relatedNpcIds && quest.relatedNpcIds.length > 0)
    || (quest.relatedFactionIds && quest.relatedFactionIds.length > 0)
    || (quest.affectedNpcIds && quest.affectedNpcIds.length > 0)
    || (quest.affectedFactionIds && quest.affectedFactionIds.length > 0)
    || (quest.affectedPlaceIds && quest.affectedPlaceIds.length > 0)
    || (quest.affectedForceIds && quest.affectedForceIds.length > 0)
    || (quest.affectedHoldingIds && quest.affectedHoldingIds.length > 0),
  );
}

function selectRelevantSignals(
  signals: Rumor[],
  relevantNpcIds: Set<string>,
  currentLocationId: string,
  ledgerRelevance: LedgerRelevanceContext,
): Rumor[] {
  return signals
    .filter(isSignalProjectable)
    .filter((signal) => isSignalRelevantToCurrentContext(signal, relevantNpcIds, currentLocationId, ledgerRelevance))
    .slice(-SITUATION_PROJECTION_BUDGET.signals);
}

function isSignalProjectable(signal: Rumor): boolean {
  const status = signal.status ?? 'open';
  return status !== 'false' && status !== 'expired' && status !== 'converted' && status !== 'archived';
}

function isSignalRelevantToCurrentContext(
  signal: Rumor,
  relevantNpcIds: Set<string>,
  currentLocationId: string,
  ledgerRelevance: LedgerRelevanceContext,
): boolean {
  if (signal.severity === 'major' || signal.severity === 'critical') return true;
  if (signal.relatedRegionId === currentLocationId) return true;
  if (signal.relatedLocationIds?.includes(currentLocationId)) return true;
  if (signal.affectedPlaceIds?.includes(currentLocationId)) return true;
  if (signal.relatedActorId && relevantNpcIds.has(signal.relatedActorId)) return true;
  if (signal.affectedNpcIds?.some((npcId) => relevantNpcIds.has(npcId))) return true;
  if (signal.relatedFactionId && ledgerRelevance.factionIds.has(signal.relatedFactionId)) return true;
  if (intersectsSet(signal.affectedFactionIds, ledgerRelevance.factionIds)) return true;
  if (intersectsSet(signal.affectedForceIds, ledgerRelevance.troopIds)) return true;
  if (intersectsSet(signal.affectedHoldingIds, ledgerRelevance.holdingIds)) return true;

  const hasExplicitLinks = Boolean(
    signal.relatedRegionId
    || signal.relatedFactionId
    || signal.relatedActorId
    || (signal.relatedLocationIds && signal.relatedLocationIds.length > 0)
    || (signal.affectedNpcIds && signal.affectedNpcIds.length > 0)
    || (signal.affectedFactionIds && signal.affectedFactionIds.length > 0)
    || (signal.affectedPlaceIds && signal.affectedPlaceIds.length > 0)
    || (signal.affectedForceIds && signal.affectedForceIds.length > 0)
    || (signal.affectedHoldingIds && signal.affectedHoldingIds.length > 0),
  );
  return !hasExplicitLinks;
}

function selectRelevantWorldTrends(
  trends: WorldTrendEntry[],
  relevantNpcIds: Set<string>,
  currentLocationId: string,
  ledgerRelevance: LedgerRelevanceContext,
): WorldTrendEntry[] {
  return trends
    .filter((trend) => trend.knownToPlayer)
    .filter(isWorldChronicleEligible)
    .filter(isWorldTrendProjectable)
    .filter((trend) => isWorldTrendRelevantToCurrentContext(trend, relevantNpcIds, currentLocationId, ledgerRelevance))
    .slice(-SITUATION_PROJECTION_BUDGET.chronicles);
}

function isWorldTrendProjectable(trend: WorldTrendEntry): boolean {
  return isWorldChronicleOngoing(trend);
}

function isWorldTrendRelevantToCurrentContext(
  trend: WorldTrendEntry,
  relevantNpcIds: Set<string>,
  currentLocationId: string,
  ledgerRelevance: LedgerRelevanceContext,
): boolean {
  if (isMajorWorldTrend(trend)) return true;
  if (trend.locationId === currentLocationId) return true;
  if (trend.relatedPlaceIds?.includes(currentLocationId)) return true;
  if (trend.affectedPlaceIds?.includes(currentLocationId)) return true;
  if (trend.relatedNpcIds?.some((npcId) => relevantNpcIds.has(npcId))) return true;
  if (trend.affectedNpcIds?.some((npcId) => relevantNpcIds.has(npcId))) return true;
  if (intersectsSet(trend.relatedFactionIds, ledgerRelevance.factionIds)) return true;
  if (intersectsSet(trend.affectedFactionIds, ledgerRelevance.factionIds)) return true;
  if (intersectsSet(trend.affectedForceIds, ledgerRelevance.troopIds)) return true;
  if (intersectsSet(trend.affectedHoldingIds, ledgerRelevance.holdingIds)) return true;

  const hasExplicitLinks = Boolean(
    trend.locationId
    || (trend.relatedNpcIds && trend.relatedNpcIds.length > 0)
    || (trend.relatedFactionIds && trend.relatedFactionIds.length > 0)
    || (trend.relatedPlaceIds && trend.relatedPlaceIds.length > 0)
    || (trend.affectedNpcIds && trend.affectedNpcIds.length > 0)
    || (trend.affectedFactionIds && trend.affectedFactionIds.length > 0)
    || (trend.affectedPlaceIds && trend.affectedPlaceIds.length > 0)
    || (trend.affectedForceIds && trend.affectedForceIds.length > 0)
    || (trend.affectedHoldingIds && trend.affectedHoldingIds.length > 0),
  );
  return !hasExplicitLinks;
}

function selectRelevantCombatRecords(
  combatRecords: CombatRecord[],
  relevantNpcIds: Set<string>,
  currentLocationId: string,
  relevantCurrentQuests: Quest[],
  relevantWorldTrends: WorldTrendEntry[],
): CombatRecord[] {
  const questIds = new Set(relevantCurrentQuests.map((quest) => quest.id));
  const trendIds = new Set(relevantWorldTrends.map((trend) => trend.trendId));
  return combatRecords
    .map((combat) => ({ combat, score: scoreCombatRecordRelevance(combat, relevantNpcIds, currentLocationId, questIds, trendIds) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => (
      b.score - a.score
      || compareUpdatedAtDesc(a.combat.updatedAt ?? a.combat.occurredAt, b.combat.updatedAt ?? b.combat.occurredAt)
    ))
    .slice(0, 3)
    .map((candidate) => candidate.combat);
}

function scoreCombatRecordRelevance(
  combat: CombatRecord,
  relevantNpcIds: Set<string>,
  currentLocationId: string,
  questIds: Set<string>,
  trendIds: Set<string>,
): number {
  let score = 0;
  if (combat.locationId === currentLocationId) score += 70;
  if (combat.playerInvolved) score += 60;
  if (intersectsSet(combat.relatedNpcIds, relevantNpcIds)) score += 50;
  if (combat.participants.some((participant) => participant.npcId && relevantNpcIds.has(participant.npcId))) score += 50;
  if (intersectsSet(combat.relatedQuestIds, questIds)) score += 45;
  if (intersectsSet(combat.relatedTrendIds, trendIds)) score += 35;
  if (combat.chronicleWorthy) score += 15;
  if (combat.significance === 'legendary') score += 25;
  if (combat.significance === 'major') score += 20;
  if (combat.significance === 'notable') score += 10;
  return score;
}

function isMajorWorldTrend(trend: WorldTrendEntry): boolean {
  return ['high', 'critical', '高', '极高', '楂?', '鏋侀珮'].includes(String(trend.severity));
}

function isMemorySummaryRelevant(
  relatedNpcIds: string[] | undefined,
  relatedLocationIds: string[] | undefined,
  relevantNpcIds: Set<string>,
  currentLocationId: string,
): boolean {
  const hasNpcLink = relatedNpcIds?.some((npcId) => relevantNpcIds.has(npcId)) ?? false;
  const hasLocationLink = relatedLocationIds?.includes(currentLocationId) ?? false;
  const isGlobal = (!relatedNpcIds || relatedNpcIds.length === 0) && (!relatedLocationIds || relatedLocationIds.length === 0);
  return hasNpcLink || hasLocationLink || isGlobal;
}

function buildNpcMemoryProjectionBlocks(
  presentNpcs: LuanShiNpc[],
  focusedNpcs: LuanShiNpc[],
  settings: MemoryProjectionSettings,
  npcMidTermSummaries: NpcMidTermMemorySummary[],
  npcLongTermSummaries: NpcLongTermMemorySummary[],
): NpcMemoryProjectionBlock[] {
  return [
    ...presentNpcs.map((npc) => buildNpcMemoryProjectionBlock(
      npc,
      'present',
      settings,
      npcMidTermSummaries,
      npcLongTermSummaries,
    )),
    ...focusedNpcs.map((npc) => buildNpcMemoryProjectionBlock(
      npc,
      'focused',
      settings,
      npcMidTermSummaries,
      npcLongTermSummaries,
    )),
  ].filter((block): block is NpcMemoryProjectionBlock => block !== undefined);
}

function buildNpcMemoryProjectionBlock(
  npc: LuanShiNpc,
  scope: NpcMemoryProjectionScope,
  settings: MemoryProjectionSettings,
  npcMidTermSummaries: NpcMidTermMemorySummary[],
  npcLongTermSummaries: NpcLongTermMemorySummary[],
): NpcMemoryProjectionBlock | undefined {
  const memories = npc.memories ?? [];
  const importance: NpcMemoryProjectionImportance = npc.isFocused ? 'important' : 'normal';
  const limit = getNpcMemoryProjectionLimit(scope, importance, settings);
  const midTermLimit = importance === 'important' ? 4 : 2;
  const selectedLongTermSummaries = npcLongTermSummaries
    .filter((summary) => summary.npcId === npc.npcId);
  const longTermCoveredMidIds = new Set(
    selectedLongTermSummaries.flatMap((summary) => summary.sourceMidTermSummaryIds),
  );
  const selectedMidTermSummaries = npcMidTermSummaries
    .filter((summary) => summary.npcId === npc.npcId)
    .filter((summary) => !longTermCoveredMidIds.has(summary.summaryId))
    .slice(-midTermLimit);
  const projectedMidIds = new Set([
    ...longTermCoveredMidIds,
    ...selectedMidTermSummaries.map((summary) => summary.summaryId),
  ]);
  const coveredMemoryIds = new Set(
    npcMidTermSummaries
      .filter((summary) => summary.npcId === npc.npcId && projectedMidIds.has(summary.summaryId))
      .flatMap((summary) => summary.sourceMemoryIds),
  );
  const ownedMemories = memories.filter((memory) => !coveredMemoryIds.has(memory.memoryId));
  const selectedOwnedMemories = ownedMemories.slice(Math.max(0, ownedMemories.length - limit));
  if (selectedOwnedMemories.length === 0 && selectedMidTermSummaries.length === 0 && selectedLongTermSummaries.length === 0) {
    return undefined;
  }

  return {
    npcId: npc.npcId,
    npcName: npc.name,
    scope,
    importance,
    memories: selectedOwnedMemories,
    midTermSummaries: selectedMidTermSummaries,
    longTermSummaries: selectedLongTermSummaries,
    retrievedMemories: [],
    totalMemoryCount: memories.length,
    omittedMemoryCount: memories.length - selectedOwnedMemories.length,
  };
}

function getNpcMemoryProjectionLimit(
  scope: NpcMemoryProjectionScope,
  importance: NpcMemoryProjectionImportance,
  settings: MemoryProjectionSettings,
): number {
  if (scope === 'present' && importance === 'important') {
    return settings.npcRecentMemoryImportantLimit;
  }

  if (scope === 'present') {
    return settings.npcRecentMemoryDefaultLimit;
  }

  return settings.focusedNpcRecentMemoryLimit;
}
