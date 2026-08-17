import type {
  LocationMemorySummary,
  LongTermStoryMemorySummary,
  LongTermMemoryFact,
  MemoryProjectionSettings,
  MidTermMemorySummary,
  NpcInteractionSummary,
  NpcLongTermMemorySummary,
  NpcMidTermMemorySummary,
  NpcMemoryEntry,
  RecentTurnMemoryEntry,
  RuntimeState,
  TurnLogEntry,
} from '../types';
import type { ApiTaskId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';

export type MemorySummaryTaskKind = 'recentTurnCompression';

export type MemorySummaryCompressionScope =
  | 'playerRecentToMid'
  | 'playerMidToLong'
  | 'npcRawToMid'
  | 'npcMidToLong';

export interface MemorySummaryNpcMemoryBlock {
  npcId: string;
  npcName: string;
  relationToPlayer: string;
  recentAttitude: string;
  memories: NpcMemoryEntry[];
}

export interface MemorySummaryNpcMidTermBlock {
  npcId: string;
  npcName: string;
  summaries: NpcMidTermMemorySummary[];
}

export interface MemorySummaryTokenBudgetHint {
  maxPromptMemoryTokens: number;
  recentStoryTokenBudget: number;
  npcMemoryTokenBudget: number;
  midTermTokenBudget: number;
  longTermFactTokenBudget: number;
  locationMemoryTokenBudget: number;
  retrievalTokenBudget: number;
}

export interface MemorySummaryTaskInput {
  kind: MemorySummaryTaskKind;
  activeScopes: MemorySummaryCompressionScope[];
  apiTaskId: ApiTaskId;
  fallbackApiTaskId: ApiTaskId;
  createdAt: string;
  currentLocationId: string;
  recentTurnCompressThreshold: number;
  npcMemoryCompressThreshold: number;
  sourceRecentTurnSummaries: RecentTurnMemoryEntry[];
  keptRecentTurnIds: string[];
  sourceTurnLogs: TurnLogEntry[];
  sourceMidTermSummaries: MidTermMemorySummary[];
  relatedNpcMemoryBlocks: MemorySummaryNpcMemoryBlock[];
  sourceNpcMidTermBlocks: MemorySummaryNpcMidTermBlock[];
  existingMidTermSummaries: MidTermMemorySummary[];
  existingLongTermStorySummaries: LongTermStoryMemorySummary[];
  existingLongTermFacts: LongTermMemoryFact[];
  existingNpcInteractionSummaries: NpcInteractionSummary[];
  existingNpcMidTermSummaries: NpcMidTermMemorySummary[];
  existingNpcLongTermSummaries: NpcLongTermMemorySummary[];
  existingLocationMemorySummaries: LocationMemorySummary[];
  tokenBudgetHint: MemorySummaryTokenBudgetHint;
}

export interface MemorySummaryResult {
  midTermSummaries?: MidTermMemorySummary[];
  longTermStorySummaries?: LongTermStoryMemorySummary[];
  longTermFacts?: LongTermMemoryFact[];
  npcInteractionSummaries?: NpcInteractionSummary[];
  npcMidTermSummaries?: NpcMidTermMemorySummary[];
  npcLongTermSummaries?: NpcLongTermMemorySummary[];
  locationMemorySummaries?: LocationMemorySummary[];
  notes?: string[];
}

export interface MemorySummaryApplication {
  state: RuntimeState;
  appliedSummaries: string[];
  ignoredSummaries: string[];
  appliedStoryRecentCompression: boolean;
}

const MID_TERM_TO_LONG_TERM_BATCH_SIZE = 10;
const MAX_NPC_COMPRESSION_BATCHES_PER_TURN = 3;

export function shouldCreateRecentTurnSummaryTask(state: RuntimeState): boolean {
  return buildRecentTurnMemorySummaryTask(state).activeScopes.length > 0;
}

export function buildRecentTurnMemorySummaryTask(state: RuntimeState): MemorySummaryTaskInput {
  const normalized = ensureLuanShiState(state);
  const archive = normalized.memoryArchive;
  const enabled = archive.settings.enableAutoMemorySummary;
  const coveredRecentIds = new Set(archive.midTermSummaries.flatMap((summary) => summary.sourceRecentTurnIds ?? []));
  const uncoveredRecentTurnSummaries = archive.recentTurnSummaries
    .filter((summary) => !coveredRecentIds.has(summary.id));
  const sourceRecentTurnSummaries = enabled
    && uncoveredRecentTurnSummaries.length >= archive.settings.recentTurnCompressThreshold
    ? uncoveredRecentTurnSummaries.slice(0, archive.settings.recentTurnCompressThreshold)
    : [];
  const sourceTurnNumbers = new Set(sourceRecentTurnSummaries.map((summary) => summary.turnNumber));
  const keptRecentTurnIds = sourceRecentTurnSummaries.length > 0
    ? archive.recentTurnSummaries
      .slice(Math.max(0, archive.recentTurnSummaries.length - archive.settings.recentTurnKeepAfterCompress))
      .map((summary) => summary.id)
    : [];
  const unfoldedMidTermSummaries = archive.midTermSummaries
    .filter((summary) => !summary.foldedIntoLongTermSummaryId);
  const sourceMidTermSummaries = enabled
    && unfoldedMidTermSummaries.length >= MID_TERM_TO_LONG_TERM_BATCH_SIZE
    ? unfoldedMidTermSummaries.slice(0, MID_TERM_TO_LONG_TERM_BATCH_SIZE)
    : [];
  const coveredNpcMemoryIds = new Set(archive.npcMidTermSummaries.flatMap((summary) => summary.sourceMemoryIds));
  const relatedNpcMemoryBlocks = enabled ? normalized.npcs
    .map((npc): MemorySummaryNpcMemoryBlock => ({
      npcId: npc.npcId,
      npcName: npc.name,
      relationToPlayer: npc.relationToPlayer,
      recentAttitude: npc.recentAttitude,
      memories: npc.memories
        .filter((memory) => !coveredNpcMemoryIds.has(memory.memoryId))
        .slice(0, archive.settings.npcMemoryCompressThreshold),
    }))
    .filter((block) => block.memories.length >= archive.settings.npcMemoryCompressThreshold)
    .slice(0, MAX_NPC_COMPRESSION_BATCHES_PER_TURN) : [];
  const sourceNpcMidTermBlocks = enabled ? Array.from(new Set(
    archive.npcMidTermSummaries
      .filter((summary) => !summary.foldedIntoLongTermSummaryId)
      .map((summary) => summary.npcId),
  ))
    .map((npcId): MemorySummaryNpcMidTermBlock | undefined => {
      const summaries = archive.npcMidTermSummaries
        .filter((summary) => summary.npcId === npcId && !summary.foldedIntoLongTermSummaryId)
        .slice(0, MID_TERM_TO_LONG_TERM_BATCH_SIZE);
      if (summaries.length < MID_TERM_TO_LONG_TERM_BATCH_SIZE) return undefined;
      return { npcId, npcName: summaries[0].npcName, summaries };
    })
    .filter((block): block is MemorySummaryNpcMidTermBlock => Boolean(block))
    .slice(0, MAX_NPC_COMPRESSION_BATCHES_PER_TURN) : [];
  const activeScopes: MemorySummaryCompressionScope[] = [];
  if (sourceRecentTurnSummaries.length > 0) activeScopes.push('playerRecentToMid');
  if (sourceMidTermSummaries.length > 0) activeScopes.push('playerMidToLong');
  if (relatedNpcMemoryBlocks.length > 0) activeScopes.push('npcRawToMid');
  if (sourceNpcMidTermBlocks.length > 0) activeScopes.push('npcMidToLong');

  const hasPlayerScope = activeScopes.includes('playerRecentToMid')
    || activeScopes.includes('playerMidToLong');
  const relevantNpcIds = new Set([
    ...relatedNpcMemoryBlocks.map((block) => block.npcId),
    ...sourceNpcMidTermBlocks.map((block) => block.npcId),
  ]);
  const relevantLocationIds = new Set([normalized.currentLocationId]);

  return {
    kind: 'recentTurnCompression',
    activeScopes,
    apiTaskId: 'memorySummary',
    fallbackApiTaskId: 'mainNarrative',
    createdAt: normalized.currentDate,
    currentLocationId: normalized.currentLocationId,
    recentTurnCompressThreshold: archive.settings.recentTurnCompressThreshold,
    npcMemoryCompressThreshold: archive.settings.npcMemoryCompressThreshold,
    sourceRecentTurnSummaries,
    keptRecentTurnIds,
    sourceTurnLogs: normalized.turnLog.filter((turn) => sourceTurnNumbers.has(turn.turnNumber)),
    sourceMidTermSummaries,
    relatedNpcMemoryBlocks,
    sourceNpcMidTermBlocks,
    existingMidTermSummaries: activeScopes.includes('playerRecentToMid')
      ? archive.midTermSummaries.slice(-archive.settings.midTermSummaryLimit)
      : [],
    existingLongTermStorySummaries: hasPlayerScope
      ? archive.longTermStorySummaries.slice(-3)
      : [],
    existingLongTermFacts: hasPlayerScope
      ? archive.longTermFacts.slice(-archive.settings.longTermFactLimit)
      : [],
    existingNpcInteractionSummaries: activeScopes.includes('playerRecentToMid')
      ? archive.npcInteractionSummaries.slice(-8)
      : archive.npcInteractionSummaries.filter((summary) => relevantNpcIds.has(summary.npcId)),
    existingNpcMidTermSummaries: archive.npcMidTermSummaries
      .filter((summary) => relevantNpcIds.has(summary.npcId)),
    existingNpcLongTermSummaries: archive.npcLongTermSummaries
      .filter((summary) => relevantNpcIds.has(summary.npcId)),
    existingLocationMemorySummaries: activeScopes.includes('playerRecentToMid')
      ? archive.locationMemorySummaries.filter((summary) => relevantLocationIds.has(summary.locationId))
      : [],
    tokenBudgetHint: buildTokenBudgetHint(archive.settings),
  };
}

export function applyMemorySummaryResult(
  state: RuntimeState,
  result: MemorySummaryResult,
  task?: MemorySummaryTaskInput,
): MemorySummaryApplication {
  const normalized = ensureLuanShiState(JSON.parse(JSON.stringify(state)) as RuntimeState);
  const archive = normalized.memoryArchive;
  const appliedSummaries: string[] = [];
  const ignoredSummaries: string[] = [];
  const hasQualifiedPlayerRecentBatch = !task
    || task.activeScopes.includes('playerRecentToMid');
  const hasQualifiedPlayerMidBatch = !task
    || task.activeScopes.includes('playerMidToLong');
  const hasQualifiedNpcRawBatch = !task
    || task.activeScopes.includes('npcRawToMid');
  const hasQualifiedStoryContext = hasQualifiedPlayerRecentBatch || hasQualifiedPlayerMidBatch;

  const midTermInput = task && !hasQualifiedPlayerRecentBatch
    ? rejectUnexpectedEntries(
      result.midTermSummaries ?? [],
      ignoredSummaries,
      `玩家近期输入不足${task.recentTurnCompressThreshold}条，忽略中期摘要`,
    )
    : (result.midTermSummaries ?? []);
  const validMidTermSummaries = filterValidMidTermSummaries(midTermInput, ignoredSummaries);
  const midTermSummaries = limitTaskBatchEntries(
    validMidTermSummaries,
    task,
    ignoredSummaries,
    '玩家中期摘要',
  ).map((summary) => {
    if (!task) return summary;
    const sourceRecentTurnIds = task.sourceRecentTurnSummaries.map((item) => item.id);
    return {
      ...summary,
      summaryId: buildMemoryBatchId('player_mid', sourceRecentTurnIds),
      sourceRecentTurnIds,
    };
  });
  if (midTermSummaries.length > 0) {
    archive.midTermSummaries = upsertByKey(archive.midTermSummaries, midTermSummaries, (summary) => summary.summaryId);
    appliedSummaries.push(`中期剧情摘要x${midTermSummaries.length}`);
  }

  const longTermStoryInput = task && !hasQualifiedPlayerMidBatch
    ? rejectUnexpectedEntries(result.longTermStorySummaries ?? [], ignoredSummaries, '玩家中期输入不足十条，忽略长期摘要')
    : (result.longTermStorySummaries ?? []);
  const validLongTermStorySummaries = filterValidLongTermStorySummaries(
    longTermStoryInput,
    ignoredSummaries,
  );
  const longTermStorySummaries = limitTaskBatchEntries(
    validLongTermStorySummaries,
    task,
    ignoredSummaries,
    '玩家长期摘要',
  ).map((summary) => {
    if (!task) return summary;
    const sourceMidTermSummaryIds = task.sourceMidTermSummaries.map((item) => item.summaryId);
    return {
      ...summary,
      summaryId: buildMemoryBatchId('player_long', sourceMidTermSummaryIds),
      sourceMidTermSummaryIds,
    };
  });
  if (longTermStorySummaries.length > 0) {
    archive.longTermStorySummaries = upsertByKey(
      archive.longTermStorySummaries,
      longTermStorySummaries,
      (summary) => summary.summaryId,
    );
    const foldedByMidId = new Map(longTermStorySummaries.flatMap((summary) => (
      summary.sourceMidTermSummaryIds.map((midId) => [midId, summary.summaryId] as const)
    )));
    archive.midTermSummaries = archive.midTermSummaries.map((summary) => ({
      ...summary,
      foldedIntoLongTermSummaryId: foldedByMidId.get(summary.summaryId) ?? summary.foldedIntoLongTermSummaryId,
    }));
    appliedSummaries.push(`长期剧情摘要x${longTermStorySummaries.length}`);
  }

  const longTermFactInput = task && !hasQualifiedPlayerRecentBatch && !hasQualifiedPlayerMidBatch
    ? rejectUnexpectedEntries(result.longTermFacts ?? [], ignoredSummaries, '没有合格玩家批次，忽略玩家长期事实')
    : (result.longTermFacts ?? []);
  const longTermFacts = filterValidLongTermFacts(longTermFactInput, ignoredSummaries);
  if (longTermFacts.length > 0) {
    archive.longTermFacts = upsertByKey(archive.longTermFacts, longTermFacts, (fact) => fact.factId);
    appliedSummaries.push(`长期档案记忆x${longTermFacts.length}`);
  }

  const npcInteractionInput = task && !hasQualifiedPlayerRecentBatch && !hasQualifiedNpcRawBatch
    ? rejectUnexpectedEntries(result.npcInteractionSummaries ?? [], ignoredSummaries, '没有合格近期或 NPC 原始记忆批次，忽略 NPC 互动摘要')
    : (result.npcInteractionSummaries ?? []);
  const npcSummaries = filterValidNpcInteractionSummaries(npcInteractionInput, ignoredSummaries);
  if (npcSummaries.length > 0) {
    archive.npcInteractionSummaries = upsertByKey(archive.npcInteractionSummaries, npcSummaries, (summary) => summary.npcId);
    appliedSummaries.push(`NPC互动摘要x${npcSummaries.length}`);
  }

  const validNpcMidTermSummaries = filterValidNpcMidTermSummaries(
    result.npcMidTermSummaries ?? [],
    ignoredSummaries,
  ).filter((summary) => {
    const allowed = !task || task.relatedNpcMemoryBlocks.some((block) => block.npcId === summary.npcId);
    if (!allowed) ignoredSummaries.push(`NPC中期记忆：${summary.npcId} 没有满足阈值的原始记忆块`);
    return allowed;
  });
  const npcMidTermSummaries = selectSingleNpcBatchEntry(
    validNpcMidTermSummaries,
    task,
    ignoredSummaries,
    'NPC中期记忆',
  ).map((summary) => {
    const sourceBlock = task?.relatedNpcMemoryBlocks.find((block) => block.npcId === summary.npcId);
    if (!task || !sourceBlock) return summary;
    const sourceMemoryIds = sourceBlock.memories.map((memory) => memory.memoryId);
    return {
      ...summary,
      summaryId: buildMemoryBatchId('npc_mid', sourceMemoryIds, summary.npcId),
      sourceMemoryIds,
    };
  });
  if (npcMidTermSummaries.length > 0) {
    archive.npcMidTermSummaries = upsertByKey(
      archive.npcMidTermSummaries,
      npcMidTermSummaries,
      (summary) => summary.summaryId,
    );
    pruneCompressedNpcRawMemories(normalized, npcMidTermSummaries, archive.settings.npcMemoryKeepAfterCompress);
    appliedSummaries.push(`NPC中期记忆x${npcMidTermSummaries.length}`);
  }

  const validNpcLongTermSummaries = filterValidNpcLongTermSummaries(
    result.npcLongTermSummaries ?? [],
    ignoredSummaries,
  ).filter((summary) => {
    const allowed = !task || task.sourceNpcMidTermBlocks.some((block) => block.npcId === summary.npcId);
    if (!allowed) ignoredSummaries.push(`NPC长期记忆：${summary.npcId} 没有满足十条的中期记忆块`);
    return allowed;
  });
  const npcLongTermSummaries = selectSingleNpcBatchEntry(
    validNpcLongTermSummaries,
    task,
    ignoredSummaries,
    'NPC长期记忆',
  ).map((summary) => {
    const sourceBlock = task?.sourceNpcMidTermBlocks.find((block) => block.npcId === summary.npcId);
    if (!task || !sourceBlock) return summary;
    const sourceMidTermSummaryIds = sourceBlock.summaries.map((item) => item.summaryId);
    return {
      ...summary,
      summaryId: buildMemoryBatchId('npc_long', sourceMidTermSummaryIds, summary.npcId),
      sourceMidTermSummaryIds,
    };
  });
  if (npcLongTermSummaries.length > 0) {
    archive.npcLongTermSummaries = upsertByKey(
      archive.npcLongTermSummaries,
      npcLongTermSummaries,
      (summary) => summary.summaryId,
    );
    const foldedByMidId = new Map(npcLongTermSummaries.flatMap((summary) => (
      summary.sourceMidTermSummaryIds.map((midId) => [midId, summary.summaryId] as const)
    )));
    archive.npcMidTermSummaries = archive.npcMidTermSummaries.map((summary) => ({
      ...summary,
      foldedIntoLongTermSummaryId: foldedByMidId.get(summary.summaryId) ?? summary.foldedIntoLongTermSummaryId,
    }));
    appliedSummaries.push(`NPC长期记忆x${npcLongTermSummaries.length}`);
  }

  const locationInput = task && !hasQualifiedStoryContext
    ? rejectUnexpectedEntries(result.locationMemorySummaries ?? [], ignoredSummaries, '没有合格玩家记忆批次，忽略地点记忆摘要')
    : (result.locationMemorySummaries ?? []);
  const locationSummaries = filterValidLocationMemorySummaries(locationInput, ignoredSummaries);
  if (locationSummaries.length > 0) {
    archive.locationMemorySummaries = upsertByKey(archive.locationMemorySummaries, locationSummaries, (summary) => summary.locationId);
    appliedSummaries.push(`地点记忆摘要x${locationSummaries.length}`);
  }

  return {
    state: normalized,
    appliedSummaries,
    ignoredSummaries,
    appliedStoryRecentCompression: midTermSummaries.length > 0,
  };
}

function rejectUnexpectedEntries<T>(entries: T[], ignoredSummaries: string[], reason: string): T[] {
  if (entries.length > 0) ignoredSummaries.push(`${reason}x${entries.length}`);
  return [];
}

function limitTaskBatchEntries<T>(
  entries: T[],
  task: MemorySummaryTaskInput | undefined,
  ignoredSummaries: string[],
  label: string,
): T[] {
  if (!task || entries.length <= 1) return entries;
  ignoredSummaries.push(`${label}：同一批次额外输出已忽略x${entries.length - 1}`);
  return entries.slice(0, 1);
}

function selectSingleNpcBatchEntry<T extends { npcId: string }>(
  entries: T[],
  task: MemorySummaryTaskInput | undefined,
  ignoredSummaries: string[],
  label: string,
): T[] {
  if (!task) return entries;
  const seenNpcIds = new Set<string>();
  const selected: T[] = [];
  let ignoredCount = 0;
  for (const entry of entries) {
    if (seenNpcIds.has(entry.npcId)) {
      ignoredCount += 1;
      continue;
    }
    seenNpcIds.add(entry.npcId);
    selected.push(entry);
  }
  if (ignoredCount > 0) ignoredSummaries.push(`${label}：同一 NPC 同一批次额外输出已忽略x${ignoredCount}`);
  return selected;
}

function buildMemoryBatchId(prefix: string, sourceIds: string[], subjectId?: string): string {
  const subject = subjectId ? normalizeStableIdPart(subjectId) : '';
  const subjectPart = subject ? `_${subject}` : '';
  return `${prefix}${subjectPart}_${stableHash([...sourceIds].sort().join('|'))}`;
}

function normalizeStableIdPart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || stableHash(value);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function pruneCompressedNpcRawMemories(
  state: ReturnType<typeof ensureLuanShiState>,
  summaries: NpcMidTermMemorySummary[],
  keepLimit: number,
): void {
  const coveredByNpc = new Map<string, Set<string>>();
  for (const summary of summaries) {
    const covered = coveredByNpc.get(summary.npcId) ?? new Set<string>();
    for (const memoryId of summary.sourceMemoryIds) covered.add(memoryId);
    coveredByNpc.set(summary.npcId, covered);
  }

  for (const npc of state.npcs) {
    const covered = coveredByNpc.get(npc.npcId);
    if (!covered || npc.memories.length <= keepLimit) continue;
    let removableCount = npc.memories.length - keepLimit;
    npc.memories = npc.memories.filter((memory) => {
      if (removableCount > 0 && covered.has(memory.memoryId)) {
        removableCount -= 1;
        return false;
      }
      return true;
    });
  }
}

function buildTokenBudgetHint(settings: MemoryProjectionSettings): MemorySummaryTokenBudgetHint {
  return {
    maxPromptMemoryTokens: settings.maxPromptMemoryTokens,
    recentStoryTokenBudget: settings.recentStoryTokenBudget,
    npcMemoryTokenBudget: settings.npcMemoryTokenBudget,
    midTermTokenBudget: settings.midTermTokenBudget,
    longTermFactTokenBudget: settings.longTermFactTokenBudget,
    locationMemoryTokenBudget: settings.locationMemoryTokenBudget,
    retrievalTokenBudget: settings.retrievalTokenBudget,
  };
}

function upsertByKey<T>(existing: T[], incoming: T[], getKey: (item: T) => string): T[] {
  const incomingKeys = new Set(incoming.map(getKey));
  return [
    ...existing.filter((item) => !incomingKeys.has(getKey(item))),
    ...incoming,
  ];
}

function filterValidMidTermSummaries(
  summaries: MidTermMemorySummary[],
  ignoredSummaries: string[],
): MidTermMemorySummary[] {
  return summaries.filter((summary) => {
    const valid = summary.summaryId?.trim() && summary.title?.trim() && summary.summary?.trim();
    if (!valid) ignoredSummaries.push('中期剧情摘要：缺少 summaryId/title/summary');
    return Boolean(valid);
  });
}

function filterValidLongTermStorySummaries(
  summaries: LongTermStoryMemorySummary[],
  ignoredSummaries: string[],
): LongTermStoryMemorySummary[] {
  return summaries.filter((summary) => {
    const valid = summary.summaryId?.trim()
      && summary.title?.trim()
      && summary.summary?.trim()
      && Array.isArray(summary.sourceMidTermSummaryIds);
    if (!valid) ignoredSummaries.push('长期剧情摘要：缺少 summaryId/title/summary/sourceMidTermSummaryIds');
    return Boolean(valid);
  });
}

function filterValidLongTermFacts(
  facts: LongTermMemoryFact[],
  ignoredSummaries: string[],
): LongTermMemoryFact[] {
  return facts.filter((fact) => {
    const valid = fact.factId?.trim() && fact.category?.trim() && fact.summary?.trim();
    if (!valid) ignoredSummaries.push('长期档案记忆：缺少 factId/category/summary');
    return Boolean(valid);
  });
}

function filterValidNpcInteractionSummaries(
  summaries: NpcInteractionSummary[],
  ignoredSummaries: string[],
): NpcInteractionSummary[] {
  return summaries.filter((summary) => {
    const valid = summary.npcId?.trim() && summary.npcName?.trim() && summary.summary?.trim();
    if (!valid) ignoredSummaries.push('NPC互动摘要：缺少 npcId/npcName/summary');
    return Boolean(valid);
  });
}

function filterValidNpcMidTermSummaries(
  summaries: NpcMidTermMemorySummary[],
  ignoredSummaries: string[],
): NpcMidTermMemorySummary[] {
  return summaries.filter((summary) => {
    const valid = summary.summaryId?.trim()
      && summary.npcId?.trim()
      && summary.npcName?.trim()
      && summary.summary?.trim()
      && Array.isArray(summary.sourceMemoryIds);
    if (!valid) ignoredSummaries.push('NPC中期记忆：缺少 summaryId/npcId/npcName/summary/sourceMemoryIds');
    return Boolean(valid);
  });
}

function filterValidNpcLongTermSummaries(
  summaries: NpcLongTermMemorySummary[],
  ignoredSummaries: string[],
): NpcLongTermMemorySummary[] {
  return summaries.filter((summary) => {
    const valid = summary.summaryId?.trim()
      && summary.npcId?.trim()
      && summary.npcName?.trim()
      && summary.summary?.trim()
      && Array.isArray(summary.sourceMidTermSummaryIds);
    if (!valid) ignoredSummaries.push('NPC长期记忆：缺少 summaryId/npcId/npcName/summary/sourceMidTermSummaryIds');
    return Boolean(valid);
  });
}

function filterValidLocationMemorySummaries(
  summaries: LocationMemorySummary[],
  ignoredSummaries: string[],
): LocationMemorySummary[] {
  return summaries.filter((summary) => {
    const valid = summary.locationId?.trim() && summary.summary?.trim();
    if (!valid) ignoredSummaries.push('地点记忆摘要：缺少 locationId/summary');
    return Boolean(valid);
  });
}
