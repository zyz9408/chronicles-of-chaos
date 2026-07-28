import type {
  LocationMemorySummary,
  LongTermStoryMemorySummary,
  LongTermMemoryFact,
  MemoryRecallTrace,
  MemoryProjectionSettings,
  MidTermMemorySummary,
  NpcInteractionSummary,
  PlayerDeed,
  RecentTurnMemoryEntry,
  RuntimeState,
  TurnLogEntry,
} from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { selectPromptContext, type NpcMemoryProjectionBlock } from '../state/selectPromptContext';
import { estimatePromptTokens as estimateSharedPromptTokens } from '../prompts/PromptTokenEstimator';
import {
  retrieveRelevantMemories,
  retrieveRelevantMemoriesForNpc,
  type MemoryRetrievalResult,
} from './MemoryRetrieval';
import {
  buildMemoryRecallProjection,
  memorySourceKey,
} from './MemoryRecallProjection';

export type MemoryContextLayer =
  | 'storyRecentRawTurns'
  | 'storyRecentSummaries'
  | 'storyMidTermSummaries'
  | 'storyLongTermSummaries'
  | 'playerKeyDeeds'
  | 'storyLongTermFacts'
  | 'npcInteractionSummaries'
  | 'locationMemorySummaries'
  | 'npcMemoryBlocks'
  | 'retrievedMemories';

export interface MemoryContextPackageBudgetReport {
  estimatedTokens: number;
  maxPromptMemoryTokens: number;
  layerTokenEstimates: Partial<Record<MemoryContextLayer, number>>;
  omittedCounts: Partial<Record<MemoryContextLayer, number>>;
}

export interface MemoryContextPackage {
  storyRecentRawTurns: TurnLogEntry[];
  storyRecentSummaries: RecentTurnMemoryEntry[];
  storyMidTermSummaries: MidTermMemorySummary[];
  storyLongTermSummaries: LongTermStoryMemorySummary[];
  playerKeyDeeds: PlayerDeed[];
  storyLongTermFacts: LongTermMemoryFact[];
  npcInteractionSummaries: NpcInteractionSummary[];
  locationMemorySummaries: LocationMemorySummary[];
  npcMemoryBlocks: NpcMemoryProjectionBlock[];
  retrievedMemories: MemoryRetrievalResult[];
  memoryRecall: MemoryRecallTrace;
  budget: MemoryContextPackageBudgetReport;
}

export interface BuildMemoryContextPackageOptions {
  retrievedMemories?: MemoryRetrievalResult[];
  settings?: Partial<MemoryProjectionSettings>;
}

interface TrimmedLayer<T> {
  items: T[];
  estimatedTokens: number;
  omittedCount: number;
}

interface EffectiveMemoryBudgets {
  maxPromptMemoryTokens: number;
  recentStoryTokenBudget: number;
  npcMemoryTokenBudget: number;
  midTermTokenBudget: number;
  longTermFactTokenBudget: number;
  locationMemoryTokenBudget: number;
  retrievalTokenBudget: number;
}

const PLAYER_KEY_DEED_PROMPT_LIMIT = 20;

export function buildMemoryContextPackage(
  state: RuntimeState,
  query: string,
  options: BuildMemoryContextPackageOptions = {},
): MemoryContextPackage {
  const normalized = ensureLuanShiState(state);
  const settings: MemoryProjectionSettings = {
    ...normalized.memoryArchive.settings,
    ...(options.settings ?? {}),
  };
  const effectiveState = {
    ...normalized,
    memoryArchive: {
      ...normalized.memoryArchive,
      settings,
    },
  };
  const selected = selectPromptContext(effectiveState);
  const budgets = scaleBudgetsToMax(settings);
  const omittedCounts: Partial<Record<MemoryContextLayer, number>> = {};
  const layerTokenEstimates: Partial<Record<MemoryContextLayer, number>> = {};

  const rawTurns = trimMostRecentByTokenBudget(
    normalized.turnLog.slice(-Math.max(0, settings.recentRawTurnLimit)),
    budgets.recentStoryTokenBudget,
    formatRawTurnForBudget,
  );
  recordLayerBudget('storyRecentRawTurns', rawTurns, omittedCounts, layerTokenEstimates);

  const longTermStorySummaries = keepEntireLayer(
    selected.storyLongTermSummaries,
    formatLongTermStorySummaryForBudget,
  );
  recordLayerBudget('storyLongTermSummaries', longTermStorySummaries, omittedCounts, layerTokenEstimates);

  const longTermCoveredMidIds = new Set(
    longTermStorySummaries.items.flatMap((summary) => summary.sourceMidTermSummaryIds),
  );
  const midTermSummaries = trimMostRecentByTokenBudget(
    selected.relevantMidTermSummaries.filter((summary) => !longTermCoveredMidIds.has(summary.summaryId)),
    budgets.midTermTokenBudget,
    formatMidTermSummaryForBudget,
  );
  recordLayerBudget('storyMidTermSummaries', midTermSummaries, omittedCounts, layerTokenEstimates);

  const rawTurnNumbers = new Set(rawTurns.items.map((turn) => turn.turnNumber));
  const midTermCoveredRecentIds = new Set([
    ...midTermSummaries.items.flatMap((summary) => summary.sourceRecentTurnIds ?? []),
    ...normalized.memoryArchive.midTermSummaries
      .filter((summary) => longTermCoveredMidIds.has(summary.summaryId))
      .flatMap((summary) => summary.sourceRecentTurnIds ?? []),
  ]);
  const remainingRecentBudget = Math.max(0, budgets.recentStoryTokenBudget - rawTurns.estimatedTokens);
  const recentSummaries = trimMostRecentByTokenBudget(
    normalized.memoryArchive.recentTurnSummaries
      .filter((summary) => (
        !rawTurnNumbers.has(summary.turnNumber)
        && !midTermCoveredRecentIds.has(summary.id)
      ))
      .slice(-settings.recentTurnLimit),
    remainingRecentBudget,
    formatRecentTurnSummaryForBudget,
  );
  recordLayerBudget('storyRecentSummaries', recentSummaries, omittedCounts, layerTokenEstimates);

  const remainingLongTermAfterStories = Math.max(
    0,
    budgets.longTermFactTokenBudget - longTermStorySummaries.estimatedTokens,
  );
  const allPlayerKeyDeeds = normalized.player.playerMemory?.keyDeeds ?? [];
  const cappedPlayerKeyDeeds = allPlayerKeyDeeds.slice(-PLAYER_KEY_DEED_PROMPT_LIMIT);
  const playerKeyDeeds = trimMostRecentByTokenBudget(
    cappedPlayerKeyDeeds,
    remainingLongTermAfterStories,
    formatPlayerKeyDeedForBudget,
  );
  playerKeyDeeds.omittedCount += Math.max(0, allPlayerKeyDeeds.length - cappedPlayerKeyDeeds.length);
  recordLayerBudget('playerKeyDeeds', playerKeyDeeds, omittedCounts, layerTokenEstimates);

  const remainingLongTermBudget = Math.max(
    0,
    remainingLongTermAfterStories - playerKeyDeeds.estimatedTokens,
  );
  const longTermFacts = trimMostRecentByTokenBudget(
    selected.relevantLongTermFacts,
    remainingLongTermBudget,
    formatLongTermFactForBudget,
  );
  recordLayerBudget('storyLongTermFacts', longTermFacts, omittedCounts, layerTokenEstimates);

  const npcInteractionSummaries = trimMostRecentByTokenBudget(
    selected.relevantNpcInteractionSummaries,
    budgets.npcMemoryTokenBudget,
    formatNpcInteractionSummaryForBudget,
  );
  recordLayerBudget('npcInteractionSummaries', npcInteractionSummaries, omittedCounts, layerTokenEstimates);

  const locationMemorySummaries = trimMostRecentByTokenBudget(
    selected.relevantLocationMemorySummaries,
    budgets.locationMemoryTokenBudget,
    formatLocationMemorySummaryForBudget,
  );
  recordLayerBudget('locationMemorySummaries', locationMemorySummaries, omittedCounts, layerTokenEstimates);

  const remainingNpcBudget = Math.max(0, budgets.npcMemoryTokenBudget - npcInteractionSummaries.estimatedTokens);
  const retrievedSource = options.retrievedMemories
    ?? retrieveRelevantMemories(effectiveState, query, { limit: settings.vectorResultLimit });
  const ownedNpcMemoryBlocks = selected.npcMemoryBlocks.map(applyNpcMemoryLayerOwnership);
  const projectedSourceKeys = buildProjectedSourceKeys({
    state: normalized,
    rawTurns: rawTurns.items,
    recentSummaries: recentSummaries.items,
    midTermSummaries: midTermSummaries.items,
    longTermStorySummaries: longTermStorySummaries.items,
    longTermFacts: longTermFacts.items,
    npcInteractionSummaries: npcInteractionSummaries.items,
    locationMemorySummaries: locationMemorySummaries.items,
    npcMemoryBlocks: ownedNpcMemoryBlocks,
  });
  const enrichedNpcMemory = enrichNpcMemoryBlocks(
    effectiveState,
    ownedNpcMemoryBlocks,
    query,
    retrievedSource,
    projectedSourceKeys,
  );
  const npcMemoryBlocks = trimNpcMemoryBlocksByTokenBudget(
    enrichedNpcMemory.blocks,
    remainingNpcBudget,
  );
  const npcRecallBudgetOmitted = Math.max(
    0,
    enrichedNpcMemory.blocks.reduce((total, block) => total + block.retrievedMemories.length, 0)
      - npcMemoryBlocks.items.reduce((total, block) => total + block.retrievedMemories.length, 0),
  );
  recordLayerBudget('npcMemoryBlocks', npcMemoryBlocks, omittedCounts, layerTokenEstimates);

  const npcRetrievedIds = new Set(npcMemoryBlocks.items.flatMap((block) => (
    block.retrievedMemories.map((memory) => `${memory.sourceType}:${memory.sourceId}`)
  )));
  const recallProjection = buildMemoryRecallProjection(effectiveState, query, retrievedSource, {
    excludedSourceKeys: new Set([...projectedSourceKeys, ...npcRetrievedIds]),
    candidateLimit: 30,
  });
  const retrievedMemories = trimByTokenBudgetInOrder(
    recallProjection.retrievedMemories,
    budgets.retrievalTokenBudget,
    formatRetrievedMemoryForBudget,
  );
  recordLayerBudget('retrievedMemories', retrievedMemories, omittedCounts, layerTokenEstimates);
  omittedCounts.retrievedMemories = (omittedCounts.retrievedMemories ?? 0)
    + recallProjection.omittedCount
    + enrichedNpcMemory.omittedCount
    + npcRecallBudgetOmitted;
  const selectedRecallMemories = [
    ...npcMemoryBlocks.items.flatMap((block) => block.retrievedMemories),
    ...retrievedMemories.items,
  ];
  const memoryRecall = buildMemoryRecallTrace(
    query,
    recallProjection.candidateCount + enrichedNpcMemory.candidateCount,
    selectedRecallMemories,
    (omittedCounts.retrievedMemories ?? 0),
  );

  return {
    storyRecentRawTurns: rawTurns.items,
    storyRecentSummaries: recentSummaries.items,
    storyMidTermSummaries: midTermSummaries.items,
    storyLongTermSummaries: longTermStorySummaries.items,
    playerKeyDeeds: playerKeyDeeds.items,
    storyLongTermFacts: longTermFacts.items,
    npcInteractionSummaries: npcInteractionSummaries.items,
    locationMemorySummaries: locationMemorySummaries.items,
    npcMemoryBlocks: npcMemoryBlocks.items,
    retrievedMemories: retrievedMemories.items,
    memoryRecall,
    budget: {
      estimatedTokens: Object.values(layerTokenEstimates).reduce((total, value) => total + (value ?? 0), 0),
      maxPromptMemoryTokens: budgets.maxPromptMemoryTokens,
      layerTokenEstimates,
      omittedCounts,
    },
  };
}

export function formatMemoryContextPackageForPrompt(
  memoryPackage: MemoryContextPackage,
  options: { includeNpcMemoryBlocks?: boolean } = {},
): string[] {
  const parts: string[] = [];

  if (memoryPackage.storyRecentRawTurns.length > 0) {
    parts.push([
      '近期正文回放：',
      '用途：仅用于确认已经发生的事实、人物称呼、行动结果与未解决后果，不是写作范文。',
      '写法隔离：先提取事实再重新组织本回合正文；不要复用其中的起手、动作载体、句法、修辞或收束方式，也不要把引用块原句搬进新正文。',
      '<recent_narrative_reference>',
      ...memoryPackage.storyRecentRawTurns.map((turn) =>
        `- 第${turn.turnNumber}回合｜${turn.date}｜${turn.fullNarrativeText ?? turn.narrativeText}`,
      ),
      '</recent_narrative_reference>',
    ].join('\n'));
  }

  if (memoryPackage.storyRecentSummaries.length > 0) {
    parts.push([
      '近期剧情记忆：',
      ...memoryPackage.storyRecentSummaries.map((memory) => {
        const consequence = memory.visibleConsequence ? `（可见后果：${memory.visibleConsequence}）` : '';
        return `- ${memory.createdAt}｜${memory.brief}${consequence}`;
      }),
    ].join('\n'));
  }

  if (memoryPackage.storyMidTermSummaries.length > 0) {
    parts.push([
      '中期剧情摘要：',
      ...memoryPackage.storyMidTermSummaries.map((summary) =>
        `- ${summary.title}（${summary.fromCreatedAt}-${summary.toCreatedAt}）：${summary.summary}`,
      ),
    ].join('\n'));
  }

  if (memoryPackage.storyLongTermSummaries.length > 0) {
    parts.push([
      '长期生平摘要：',
      ...memoryPackage.storyLongTermSummaries.map((summary) =>
        `- ${summary.title}（${summary.fromCreatedAt}-${summary.toCreatedAt}）：${summary.summary}`,
      ),
    ].join('\n'));
  }

  if (memoryPackage.playerKeyDeeds.length > 0) {
    parts.push([
      '玩家关键事迹：',
      ...memoryPackage.playerKeyDeeds.map((deed) => {
        const impact = deed.impact ? `（影响：${deed.impact}）` : '';
        return `- ${deed.date}：${deed.summary}${impact}`;
      }),
    ].join('\n'));
  }

  if (memoryPackage.storyLongTermFacts.length > 0) {
    parts.push([
      '长期档案记忆：',
      ...memoryPackage.storyLongTermFacts.map((fact) =>
        `- ${fact.category}｜${fact.importance}：${fact.summary}`,
      ),
    ].join('\n'));
  }

  if (memoryPackage.npcInteractionSummaries.length > 0) {
    parts.push([
      'NPC长期互动摘要：',
      ...memoryPackage.npcInteractionSummaries.map((summary) => `- ${summary.npcName}：${summary.summary}`),
    ].join('\n'));
  }

  if (memoryPackage.locationMemorySummaries.length > 0) {
    parts.push([
      '地点记忆摘要：',
      ...memoryPackage.locationMemorySummaries.map((summary) =>
        `- ${summary.locationName ?? summary.locationId}：${summary.summary}`,
      ),
    ].join('\n'));
  }

  if ((options.includeNpcMemoryBlocks ?? true) && memoryPackage.npcMemoryBlocks.length > 0) {
    parts.push(formatNpcMemoryBlocksForPrompt(memoryPackage.npcMemoryBlocks));
  }

  if (memoryPackage.retrievedMemories.length > 0) {
    parts.push([
      '检索到的相关旧记忆：',
      ...memoryPackage.retrievedMemories.map((result) => {
        const strength = result.recallStrength === 'strong' ? '强召回' : '弱召回';
        const mode = result.contentMode === 'original' ? '原文' : '摘要';
        return `- ${strength}｜${mode}｜${formatRetrievedMemorySource(result)}｜${result.time ?? '时间缺失'}｜${result.text}`;
      }),
    ].join('\n'));
  }

  return parts;
}

function enrichNpcMemoryBlocks(
  state: RuntimeState,
  blocks: NpcMemoryProjectionBlock[],
  query: string,
  retrievedSource: MemoryRetrievalResult[],
  projectedSourceKeys: Set<string>,
): { blocks: NpcMemoryProjectionBlock[]; candidateCount: number; omittedCount: number } {
  let candidateCount = 0;
  let omittedCount = 0;
  const enrichedBlocks = blocks.map((block) => {
    const limit = block.importance === 'important' ? 5 : 3;
    const directIds = new Set([
      ...block.memories.map((memory) => `npcMemory:${memory.memoryId}`),
      ...block.midTermSummaries.map((summary) => `npcMidTermSummary:${summary.summaryId}`),
      ...block.longTermSummaries.map((summary) => `npcLongTermSummary:${summary.summaryId}`),
    ]);
    const excludedSourceKeys = new Set([...projectedSourceKeys, ...directIds]);
    const vectorOrShared = retrievedSource.filter((memory) => (
      memory.relatedNpcIds?.includes(block.npcId)
      && !excludedSourceKeys.has(memorySourceKey(memory))
    ));
    const localScoped = retrieveRelevantMemoriesForNpc(state, query, block.npcId, { limit: limit * 3 })
      .filter((memory) => !excludedSourceKeys.has(memorySourceKey(memory)));
    const recall = buildMemoryRecallProjection(state, query, vectorOrShared, {
      localCandidates: localScoped,
      excludedSourceKeys,
      candidateLimit: Math.max(limit * 3, 6),
      maxStrong: block.importance === 'important' ? 2 : 1,
      maxWeak: block.importance === 'important' ? 3 : 2,
      maxPerSourceType: 2,
    });
    candidateCount += recall.candidateCount;
    omittedCount += recall.omittedCount;
    return { ...block, retrievedMemories: recall.retrievedMemories.slice(0, limit) };
  });
  return { blocks: enrichedBlocks, candidateCount, omittedCount };
}

function applyNpcMemoryLayerOwnership(block: NpcMemoryProjectionBlock): NpcMemoryProjectionBlock {
  const longTermCoveredMidIds = new Set(
    block.longTermSummaries.flatMap((summary) => summary.sourceMidTermSummaryIds),
  );
  const midTermSummaries = block.midTermSummaries
    .filter((summary) => !longTermCoveredMidIds.has(summary.summaryId));
  const midTermCoveredMemoryIds = new Set(
    block.midTermSummaries.flatMap((summary) => summary.sourceMemoryIds),
  );
  const memories = block.memories
    .filter((memory) => !midTermCoveredMemoryIds.has(memory.memoryId));
  return {
    ...block,
    memories,
    midTermSummaries,
    omittedMemoryCount: block.omittedMemoryCount + (block.memories.length - memories.length),
  };
}

function buildProjectedSourceKeys(input: {
  state: RuntimeState;
  rawTurns: TurnLogEntry[];
  recentSummaries: RecentTurnMemoryEntry[];
  midTermSummaries: MidTermMemorySummary[];
  longTermStorySummaries: LongTermStoryMemorySummary[];
  longTermFacts: LongTermMemoryFact[];
  npcInteractionSummaries: NpcInteractionSummary[];
  locationMemorySummaries: LocationMemorySummary[];
  npcMemoryBlocks: NpcMemoryProjectionBlock[];
}): Set<string> {
  const keys = new Set<string>();
  const rawTurnNumbers = new Set(input.rawTurns.map((turn) => turn.turnNumber));
  for (const summary of input.state.memoryArchive?.recentTurnSummaries ?? []) {
    if (rawTurnNumbers.has(summary.turnNumber)) keys.add(`recentTurn:${summary.id}`);
  }
  for (const summary of input.recentSummaries) keys.add(`recentTurn:${summary.id}`);
  for (const summary of input.midTermSummaries) {
    keys.add(`midTermSummary:${summary.summaryId}`);
    for (const sourceId of summary.sourceRecentTurnIds ?? []) keys.add(`recentTurn:${sourceId}`);
  }
  for (const summary of input.longTermStorySummaries) {
    keys.add(`longTermStorySummary:${summary.summaryId}`);
    for (const sourceId of summary.sourceMidTermSummaryIds) {
      keys.add(`midTermSummary:${sourceId}`);
      const coveredMidTerm = input.state.memoryArchive?.midTermSummaries
        .find((item) => item.summaryId === sourceId);
      for (const recentId of coveredMidTerm?.sourceRecentTurnIds ?? []) keys.add(`recentTurn:${recentId}`);
    }
  }
  for (const fact of input.longTermFacts) keys.add(`longTermFact:${fact.factId}`);
  for (const summary of input.npcInteractionSummaries) keys.add(`npcInteractionSummary:${summary.npcId}`);
  for (const summary of input.locationMemorySummaries) keys.add(`locationMemorySummary:${summary.locationId}`);
  for (const block of input.npcMemoryBlocks) {
    for (const summary of block.longTermSummaries) {
      keys.add(`npcLongTermSummary:${summary.summaryId}`);
      for (const sourceId of summary.sourceMidTermSummaryIds) {
        keys.add(`npcMidTermSummary:${sourceId}`);
        const coveredMidTerm = input.state.memoryArchive?.npcMidTermSummaries
          ?.find((item) => item.summaryId === sourceId);
        for (const memoryId of coveredMidTerm?.sourceMemoryIds ?? []) keys.add(`npcMemory:${memoryId}`);
      }
    }
    for (const summary of block.midTermSummaries) {
      keys.add(`npcMidTermSummary:${summary.summaryId}`);
      for (const sourceId of summary.sourceMemoryIds) keys.add(`npcMemory:${sourceId}`);
    }
    for (const memory of block.memories) keys.add(`npcMemory:${memory.memoryId}`);
  }
  return keys;
}

function buildMemoryRecallTrace(
  query: string,
  candidateCount: number,
  memories: MemoryRetrievalResult[],
  omittedCount: number,
): MemoryRecallTrace {
  const seen = new Set<string>();
  const entries = memories.filter((memory) => {
    const key = memorySourceKey(memory);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((memory) => ({
    strength: memory.recallStrength ?? 'weak',
    sourceType: memory.sourceType,
    sourceId: memory.sourceId,
    title: memory.title,
    text: truncateRecallTraceText(memory.text).text,
    time: memory.time,
    score: memory.score,
    reason: memory.reason,
    contentMode: memory.contentMode ?? 'summary',
    truncated: truncateRecallTraceText(memory.text).truncated,
    sourceTurnNumber: memory.sourceTurnNumber,
    retrievalModes: memory.retrievalModes,
  }));
  return {
    query,
    candidateCount,
    omittedCount,
    strong: entries.filter((entry) => entry.strength === 'strong'),
    weak: entries.filter((entry) => entry.strength === 'weak'),
  };
}

function truncateRecallTraceText(text: string): { text: string; truncated: boolean } {
  const normalized = text.trim();
  const limit = 1200;
  if (normalized.length <= limit) return { text: normalized, truncated: false };
  return { text: `${normalized.slice(0, limit)}……`, truncated: true };
}

function keepEntireLayer<T>(items: T[], formatItem: (item: T) => string): TrimmedLayer<T> {
  return {
    items: [...items],
    estimatedTokens: items.reduce((total, item) => total + estimatePromptTokens(formatItem(item)), 0),
    omittedCount: 0,
  };
}

function recordLayerBudget<T>(
  layer: MemoryContextLayer,
  trimmed: TrimmedLayer<T>,
  omittedCounts: Partial<Record<MemoryContextLayer, number>>,
  layerTokenEstimates: Partial<Record<MemoryContextLayer, number>>,
): void {
  omittedCounts[layer] = trimmed.omittedCount;
  layerTokenEstimates[layer] = trimmed.estimatedTokens;
}

function scaleBudgetsToMax(settings: MemoryProjectionSettings): EffectiveMemoryBudgets {
  const rawBudgets = {
    recentStoryTokenBudget: Math.max(0, settings.recentStoryTokenBudget),
    npcMemoryTokenBudget: Math.max(0, settings.npcMemoryTokenBudget),
    midTermTokenBudget: Math.max(0, settings.midTermTokenBudget),
    longTermFactTokenBudget: Math.max(0, settings.longTermFactTokenBudget),
    locationMemoryTokenBudget: Math.max(0, settings.locationMemoryTokenBudget),
    retrievalTokenBudget: Math.max(0, settings.retrievalTokenBudget),
  };
  const maxPromptMemoryTokens = Math.max(0, settings.maxPromptMemoryTokens);
  const totalLayerBudget = Object.values(rawBudgets).reduce((total, value) => total + value, 0);
  const scale = totalLayerBudget > maxPromptMemoryTokens && maxPromptMemoryTokens > 0
    ? maxPromptMemoryTokens / totalLayerBudget
    : 1;

  return {
    maxPromptMemoryTokens,
    recentStoryTokenBudget: Math.floor(rawBudgets.recentStoryTokenBudget * scale),
    npcMemoryTokenBudget: Math.floor(rawBudgets.npcMemoryTokenBudget * scale),
    midTermTokenBudget: Math.floor(rawBudgets.midTermTokenBudget * scale),
    longTermFactTokenBudget: Math.floor(rawBudgets.longTermFactTokenBudget * scale),
    locationMemoryTokenBudget: Math.floor(rawBudgets.locationMemoryTokenBudget * scale),
    retrievalTokenBudget: Math.floor(rawBudgets.retrievalTokenBudget * scale),
  };
}

function trimMostRecentByTokenBudget<T>(
  items: T[],
  tokenBudget: number,
  formatItem: (item: T) => string,
): TrimmedLayer<T> {
  if (items.length === 0) return { items: [], estimatedTokens: 0, omittedCount: 0 };
  if (tokenBudget <= 0) return { items: [], estimatedTokens: 0, omittedCount: items.length };

  const selected: T[] = [];
  let estimatedTokens = 0;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const itemTokens = estimatePromptTokens(formatItem(item));
    if (estimatedTokens + itemTokens <= tokenBudget) {
      selected.unshift(item);
      estimatedTokens += itemTokens;
    }
  }

  return {
    items: selected,
    estimatedTokens,
    omittedCount: items.length - selected.length,
  };
}

function trimByTokenBudgetInOrder<T>(
  items: T[],
  tokenBudget: number,
  formatItem: (item: T) => string,
): TrimmedLayer<T> {
  if (items.length === 0) return { items: [], estimatedTokens: 0, omittedCount: 0 };
  if (tokenBudget <= 0) return { items: [], estimatedTokens: 0, omittedCount: items.length };

  const selected: T[] = [];
  let estimatedTokens = 0;

  for (const item of items) {
    const itemTokens = estimatePromptTokens(formatItem(item));
    if (estimatedTokens + itemTokens <= tokenBudget) {
      selected.push(item);
      estimatedTokens += itemTokens;
    }
  }

  return {
    items: selected,
    estimatedTokens,
    omittedCount: items.length - selected.length,
  };
}

function trimNpcMemoryBlocksByTokenBudget(
  blocks: NpcMemoryProjectionBlock[],
  tokenBudget: number,
): TrimmedLayer<NpcMemoryProjectionBlock> {
  if (blocks.length === 0) return { items: [], estimatedTokens: 0, omittedCount: 0 };
  if (tokenBudget <= 0) return { items: [], estimatedTokens: 0, omittedCount: blocks.length };

  const selected: NpcMemoryProjectionBlock[] = [];
  let estimatedTokens = 0;
  let omittedCount = 0;

  for (const block of blocks) {
    const blockHeaderTokens = estimatePromptTokens(block.npcName);
    const summaryLayerTokens = [
      ...block.longTermSummaries.map((summary) => summary.summary),
      ...block.midTermSummaries.map((summary) => summary.summary),
    ].reduce((total, text) => total + estimatePromptTokens(text), 0);
    const remainingForRetrieved = Math.max(
      0,
      tokenBudget - estimatedTokens - blockHeaderTokens - summaryLayerTokens,
    );
    const trimmedRetrieved = trimByTokenBudgetInOrder(
      block.retrievedMemories,
      remainingForRetrieved,
      formatRetrievedMemoryForBudget,
    );
    const remainingForBlock = Math.max(
      0,
      remainingForRetrieved - trimmedRetrieved.estimatedTokens,
    );

    const trimmedMemories = trimMostRecentByTokenBudget(
      block.memories,
      remainingForBlock,
      (memory) => `${memory.createdAt} ${memory.source} ${memory.content}`,
    );

    if (
      trimmedMemories.items.length === 0
      && block.longTermSummaries.length === 0
      && block.midTermSummaries.length === 0
      && trimmedRetrieved.items.length === 0
    ) {
      omittedCount += 1;
      continue;
    }

    selected.push({
      ...block,
      memories: trimmedMemories.items,
      retrievedMemories: trimmedRetrieved.items,
      omittedMemoryCount: block.omittedMemoryCount + trimmedMemories.omittedCount,
    });
    estimatedTokens += trimmedMemories.estimatedTokens
      + trimmedRetrieved.estimatedTokens
      + blockHeaderTokens
      + summaryLayerTokens;
  }

  return {
    items: selected,
    estimatedTokens,
    omittedCount,
  };
}

function estimatePromptTokens(text: string): number {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 0;
  return estimateSharedPromptTokens(normalized).estimatedTokens;
}

function formatRawTurnForBudget(turn: TurnLogEntry): string {
  return `${turn.turnNumber} ${turn.date} ${turn.playerInput} ${turn.fullNarrativeText ?? turn.narrativeText}`;
}

function formatRecentTurnSummaryForBudget(memory: RecentTurnMemoryEntry): string {
  return [memory.createdAt, memory.brief, memory.playerActionSummary, memory.visibleConsequence].filter(Boolean).join(' ');
}

function formatMidTermSummaryForBudget(summary: MidTermMemorySummary): string {
  return `${summary.title} ${summary.fromCreatedAt} ${summary.toCreatedAt} ${summary.summary}`;
}

function formatLongTermStorySummaryForBudget(summary: LongTermStoryMemorySummary): string {
  return `${summary.title} ${summary.fromCreatedAt} ${summary.toCreatedAt} ${summary.summary}`;
}

function formatPlayerKeyDeedForBudget(deed: PlayerDeed): string {
  return `${deed.date} ${deed.summary} ${deed.impact ?? ''}`;
}

function formatLongTermFactForBudget(fact: LongTermMemoryFact): string {
  return `${fact.category} ${fact.importance} ${fact.createdAt} ${fact.summary}`;
}

function formatNpcInteractionSummaryForBudget(summary: NpcInteractionSummary): string {
  return `${summary.npcName} ${summary.fromCreatedAt ?? ''} ${summary.toCreatedAt ?? ''} ${summary.summary}`;
}

function formatLocationMemorySummaryForBudget(summary: LocationMemorySummary): string {
  return `${summary.locationName ?? summary.locationId} ${summary.summary}`;
}

function formatRetrievedMemoryForBudget(result: MemoryRetrievalResult): string {
  return `${formatRetrievedMemorySource(result)} ${result.time ?? ''} ${result.text}`;
}

function formatRetrievedMemorySource(result: MemoryRetrievalResult): string {
  if (result.sourceType === 'longTermFact' && result.title) return result.title;
  return result.sourceType;
}

function formatNpcMemoryBlocksForPrompt(blocks: NpcMemoryProjectionBlock[]): string {
  const lines = ['NPC分层记忆：'];
  for (const block of blocks) {
    const scopeText = block.scope === 'present' ? '在场' : '离场关注';
    lines.push(`- ${block.npcName}（${scopeText}/${block.importance === 'important' ? '重要' : '普通'}）`);
    for (const summary of block.longTermSummaries) {
      lines.push(`  - 长期｜${summary.fromCreatedAt}-${summary.toCreatedAt}：${summary.summary}`);
    }
    for (const summary of block.midTermSummaries) {
      lines.push(`  - 中期｜${summary.fromCreatedAt}-${summary.toCreatedAt}：${summary.summary}`);
    }
    for (const memory of block.memories) {
      lines.push(`  - 近期｜${memory.createdAt}｜${memory.source}：${memory.content}`);
    }
    for (const memory of block.retrievedMemories) {
      const strength = memory.recallStrength === 'strong' ? '强召回' : '弱召回';
      const mode = memory.contentMode === 'original' ? '原文' : '摘要';
      lines.push(`  - 定向${strength}｜${mode}｜${memory.time ?? '时间缺失'}：${memory.text}`);
    }
    if (block.omittedMemoryCount > 0) {
      lines.push(`  - 另有 ${block.omittedMemoryCount} 条较早原始记忆未直接投喂。`);
    }
  }
  return lines.join('\n');
}
