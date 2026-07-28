import type { MemoryImportance, RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { isOpenCurrentMatter } from '../state/currentMatterLifecycle';
import { isNpcPhysicallyPresent } from '../state/npcPresence';

export type MemoryRetrievalMode = 'local' | 'vector';
export type MemoryRetrievalSourceType =
  | 'recentTurn'
  | 'midTermSummary'
  | 'longTermStorySummary'
  | 'longTermFact'
  | 'npcInteractionSummary'
  | 'npcMidTermSummary'
  | 'npcLongTermSummary'
  | 'locationMemorySummary'
  | 'npcMemory';

export interface MemoryRetrievalResult {
  retrievalMode: MemoryRetrievalMode;
  sourceType: MemoryRetrievalSourceType;
  sourceId: string;
  title?: string;
  text: string;
  time?: string;
  relatedNpcIds?: string[];
  relatedLocationIds?: string[];
  score: number;
  reason: string;
  /** 召回 V2 在最终投影阶段写入；候选检索阶段可缺省。 */
  recallStrength?: 'strong' | 'weak';
  contentMode?: 'original' | 'summary';
  sourceTurnNumber?: number;
  retrievalModes?: MemoryRetrievalMode[];
}

export interface MemoryRetrievalOptions {
  limit?: number;
}

interface MemoryRetrievalCandidate extends Omit<MemoryRetrievalResult, 'retrievalMode' | 'score' | 'reason'> {
  searchText: string;
  importance?: MemoryImportance;
}

const importanceScore: Record<MemoryImportance, number> = {
  low: 0,
  medium: 1,
  high: 3,
  critical: 5,
};

export function retrieveRelevantMemories(
  state: RuntimeState,
  query: string,
  options: MemoryRetrievalOptions = {},
): MemoryRetrievalResult[] {
  const normalized = ensureLuanShiState(state);
  const tokens = buildSearchTokens(normalized, query);
  if (tokens.length === 0) return [];

  const limit = options.limit ?? normalized.memoryArchive.settings.vectorResultLimit;
  const currentNpcIds = new Set(
    normalized.npcs
      .filter((npc) => isNpcPhysicallyPresent(normalized, npc) || npc.isFocused)
      .map((npc) => npc.npcId),
  );
  const candidates = collectRetrievalCandidates(normalized);

  return candidates
    .map((candidate) => scoreCandidate(candidate, tokens, normalized.currentLocationId, currentNpcIds))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || stableSourceOrder(a.sourceType) - stableSourceOrder(b.sourceType))
    .slice(0, limit);
}

export function retrieveRelevantMemoriesForNpc(
  state: RuntimeState,
  query: string,
  npcId: string,
  options: MemoryRetrievalOptions = {},
): MemoryRetrievalResult[] {
  const normalized = ensureLuanShiState(state);
  const npc = normalized.npcs.find((item) => item.npcId === npcId);
  if (!npc) return [];
  const tokens = tokenize([
    query,
    npc.name,
    npc.commonAddress,
    npc.role,
    npc.relationToPlayer,
    npc.recentAttitude,
  ].filter(Boolean).join(' '));
  if (tokens.length === 0) return [];
  const limit = options.limit ?? normalized.memoryArchive.settings.vectorResultLimit;
  return collectRetrievalCandidates(normalized)
    .filter((candidate) => candidate.relatedNpcIds?.includes(npcId))
    .map((candidate) => scoreCandidate(candidate, tokens, normalized.currentLocationId, new Set([npcId])))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || stableSourceOrder(a.sourceType) - stableSourceOrder(b.sourceType))
    .slice(0, limit);
}

function collectRetrievalCandidates(state: ReturnType<typeof ensureLuanShiState>): MemoryRetrievalCandidate[] {
  const archive = state.memoryArchive;

  return [
    ...archive.recentTurnSummaries.map((memory): MemoryRetrievalCandidate => ({
      sourceType: 'recentTurn',
      sourceId: memory.id,
      text: memory.brief,
      time: memory.createdAt,
      importance: memory.importance,
      searchText: [memory.brief, memory.playerInput, memory.playerActionSummary, memory.visibleConsequence].filter(Boolean).join(' '),
    })),
    ...archive.midTermSummaries.map((summary): MemoryRetrievalCandidate => ({
      sourceType: 'midTermSummary',
      sourceId: summary.summaryId,
      title: summary.title,
      text: `${summary.title}：${summary.summary}`,
      time: `${summary.fromCreatedAt}-${summary.toCreatedAt}`,
      relatedNpcIds: summary.relatedNpcIds,
      relatedLocationIds: summary.relatedLocationIds,
      searchText: [summary.title, summary.summary, ...(summary.tags ?? [])].join(' '),
    })),
    ...archive.longTermStorySummaries.map((summary): MemoryRetrievalCandidate => ({
      sourceType: 'longTermStorySummary',
      sourceId: summary.summaryId,
      title: summary.title,
      text: `${summary.title}：${summary.summary}`,
      time: `${summary.fromCreatedAt}-${summary.toCreatedAt}`,
      relatedNpcIds: summary.relatedNpcIds,
      relatedLocationIds: summary.relatedLocationIds,
      searchText: [summary.title, summary.summary, ...(summary.tags ?? [])].join(' '),
    })),
    ...archive.longTermFacts.map((fact): MemoryRetrievalCandidate => ({
      sourceType: 'longTermFact',
      sourceId: fact.factId,
      title: fact.category,
      text: fact.summary,
      time: fact.createdAt,
      importance: fact.importance,
      relatedNpcIds: fact.relatedNpcIds,
      relatedLocationIds: fact.relatedLocationIds,
      searchText: [fact.category, fact.summary, ...(fact.tags ?? [])].join(' '),
    })),
    ...archive.npcInteractionSummaries.map((summary): MemoryRetrievalCandidate => ({
      sourceType: 'npcInteractionSummary',
      sourceId: summary.npcId,
      title: summary.npcName,
      text: `${summary.npcName}：${summary.summary}`,
      time: summary.updatedAt,
      relatedNpcIds: [summary.npcId],
      searchText: [summary.npcName, summary.summary, ...(summary.tags ?? [])].join(' '),
    })),
    ...archive.npcMidTermSummaries.map((summary): MemoryRetrievalCandidate => ({
      sourceType: 'npcMidTermSummary',
      sourceId: summary.summaryId,
      title: summary.npcName,
      text: `${summary.npcName}：${summary.summary}`,
      time: `${summary.fromCreatedAt}-${summary.toCreatedAt}`,
      relatedNpcIds: [summary.npcId],
      searchText: [summary.npcName, summary.summary, ...(summary.tags ?? [])].join(' '),
    })),
    ...archive.npcLongTermSummaries.map((summary): MemoryRetrievalCandidate => ({
      sourceType: 'npcLongTermSummary',
      sourceId: summary.summaryId,
      title: summary.npcName,
      text: `${summary.npcName}：${summary.summary}`,
      time: `${summary.fromCreatedAt}-${summary.toCreatedAt}`,
      relatedNpcIds: [summary.npcId],
      searchText: [summary.npcName, summary.summary, ...(summary.tags ?? [])].join(' '),
    })),
    ...archive.locationMemorySummaries.map((summary): MemoryRetrievalCandidate => ({
      sourceType: 'locationMemorySummary',
      sourceId: summary.locationId,
      title: summary.locationName ?? summary.locationId,
      text: `${summary.locationName ?? summary.locationId}：${summary.summary}`,
      time: summary.updatedAt,
      relatedLocationIds: [summary.locationId],
      searchText: [summary.locationName, summary.locationId, summary.summary, ...(summary.tags ?? [])].filter(Boolean).join(' '),
    })),
    ...state.npcs.flatMap((npc) =>
      npc.memories.map((memory): MemoryRetrievalCandidate => ({
        sourceType: 'npcMemory',
        sourceId: memory.memoryId,
        title: npc.name,
        text: `${npc.name}｜${memory.source}：${memory.content}`,
        time: memory.createdAt,
        relatedNpcIds: [npc.npcId],
        relatedLocationIds: npc.locationId ? [npc.locationId] : undefined,
        searchText: [npc.name, npc.role, npc.relationToPlayer, memory.source, memory.content].join(' '),
      })),
    ),
  ];
}

function scoreCandidate(
  candidate: MemoryRetrievalCandidate,
  tokens: string[],
  currentLocationId: string,
  currentNpcIds: Set<string>,
): MemoryRetrievalResult {
  const normalizedSearchText = normalizeSearchText(candidate.searchText);
  const matchedTokens = tokens.filter((token) => normalizedSearchText.includes(token));
  const npcBoost = candidate.relatedNpcIds?.some((npcId) => currentNpcIds.has(npcId)) ? 2 : 0;
  const locationBoost = candidate.relatedLocationIds?.includes(currentLocationId) ? 2 : 0;
  const importanceBoost = candidate.importance ? importanceScore[candidate.importance] : 0;
  const score = matchedTokens.length > 0
    ? matchedTokens.length * 4 + npcBoost + locationBoost + importanceBoost
    : 0;

  return {
    retrievalMode: 'local',
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    title: candidate.title,
    text: candidate.text,
    time: candidate.time,
    relatedNpcIds: candidate.relatedNpcIds,
    relatedLocationIds: candidate.relatedLocationIds,
    score,
    reason: matchedTokens.length > 0
      ? `关键词匹配：${matchedTokens.join('、')}`
      : '当前场景关联',
  };
}

function buildSearchTokens(state: ReturnType<typeof ensureLuanShiState>, query: string): string[] {
  const currentNpcNameTokens = new Set(
    state.npcs
      .filter((npc) => isNpcPhysicallyPresent(state, npc) || npc.isFocused)
      .flatMap((npc) => tokenize([npc.name, npc.commonAddress].filter(Boolean).join(' '))),
  );
  const queryTokens = tokenize(query).filter((token) => !currentNpcNameTokens.has(token));
  const location = state.locations.find((item) => item.locationId === state.currentLocationId);
  const locationTokens = [location?.name, location?.summary, state.currentLocationId];
  const questTokens = state.activeQuests
    .filter(isOpenCurrentMatter)
    .flatMap((quest) => [quest.title, quest.description]);

  return uniqueTokens([
    ...queryTokens,
    ...tokenize(locationTokens.filter(Boolean).join(' ')),
    ...tokenize(questTokens.filter(Boolean).join(' ')),
  ]);
}

function tokenize(value: string): string[] {
  const normalized = normalizeSearchText(value);
  const latinTokens = normalized.match(/[a-z0-9_]{2,}/g) ?? [];
  const cjkTokens = normalized
    .split(/[^一-龥]+/u)
    .filter((token) => token.length >= 2)
    .flatMap((token) => {
      const chunks = [token];
      for (let size = 2; size <= Math.min(4, token.length); size += 1) {
        for (let index = 0; index <= token.length - size; index += 1) {
          chunks.push(token.slice(index, index + size));
        }
      }
      return chunks;
    });

  return uniqueTokens([...latinTokens, ...cjkTokens])
    .filter((token) => !isWeakToken(token))
    .slice(0, 80);
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function uniqueTokens(tokens: string[]): string[] {
  return Array.from(new Set(tokens.map((token) => token.trim()).filter(Boolean)));
}

function isWeakToken(token: string): boolean {
  return token.length < 2 || ['主角', '当前', '一个', '这个', '那个', '什么', '怎么', '还有', '是否'].includes(token);
}

function stableSourceOrder(type: MemoryRetrievalSourceType): number {
  const order: Record<MemoryRetrievalSourceType, number> = {
    longTermFact: 0,
    longTermStorySummary: 1,
    npcLongTermSummary: 2,
    midTermSummary: 3,
    npcMidTermSummary: 4,
    npcInteractionSummary: 5,
    locationMemorySummary: 6,
    npcMemory: 7,
    recentTurn: 8,
  };
  return order[type];
}
