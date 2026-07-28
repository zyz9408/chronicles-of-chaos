export type MemoryImportance = 'low' | 'medium' | 'high' | 'critical';

export type MemoryEmbeddingSourceType =
  | 'recentTurn'
  | 'midTermSummary'
  | 'longTermStorySummary'
  | 'longTermFact'
  | 'npcInteractionSummary'
  | 'npcMidTermSummary'
  | 'npcLongTermSummary'
  | 'locationMemorySummary'
  | 'npcMemory';

export interface RecentTurnMemoryEntry {
  id: string;
  turnNumber: number;
  createdAt: string;
  playerInput?: string;
  brief: string;
  playerActionSummary?: string;
  visibleConsequence?: string;
  importance: MemoryImportance;
}

export interface MidTermMemorySummary {
  summaryId: string;
  title: string;
  fromCreatedAt: string;
  toCreatedAt: string;
  summary: string;
  relatedNpcIds?: string[];
  relatedLocationIds?: string[];
  tags?: string[];
  sourceRecentTurnIds?: string[];
  foldedIntoLongTermSummaryId?: string;
  updatedAt: string;
}

export interface LongTermStoryMemorySummary {
  summaryId: string;
  title: string;
  fromCreatedAt: string;
  toCreatedAt: string;
  summary: string;
  sourceMidTermSummaryIds: string[];
  relatedNpcIds?: string[];
  relatedLocationIds?: string[];
  tags?: string[];
  updatedAt: string;
}

export interface LongTermMemoryFact {
  factId: string;
  category: 'identity' | 'promise' | 'enmity' | 'relationship' | 'world' | 'location' | 'consequence' | 'other';
  createdAt: string;
  updatedAt?: string;
  summary: string;
  importance: MemoryImportance;
  relatedNpcIds?: string[];
  relatedLocationIds?: string[];
  sourceTurnNumbers?: number[];
  tags?: string[];
}

export interface NpcInteractionSummary {
  npcId: string;
  npcName: string;
  summary: string;
  fromCreatedAt?: string;
  toCreatedAt?: string;
  sourceMemoryIds?: string[];
  tags?: string[];
  updatedAt: string;
}

export interface NpcMidTermMemorySummary {
  summaryId: string;
  npcId: string;
  npcName: string;
  summary: string;
  fromCreatedAt: string;
  toCreatedAt: string;
  sourceMemoryIds: string[];
  foldedIntoLongTermSummaryId?: string;
  tags?: string[];
  updatedAt: string;
}

export interface NpcLongTermMemorySummary {
  summaryId: string;
  npcId: string;
  npcName: string;
  summary: string;
  fromCreatedAt: string;
  toCreatedAt: string;
  sourceMidTermSummaryIds: string[];
  tags?: string[];
  updatedAt: string;
}

export interface LocationMemorySummary {
  locationId: string;
  locationName?: string;
  summary: string;
  recentEventIds?: string[];
  tags?: string[];
  updatedAt: string;
}

export interface MemoryProjectionSettings {
  recentRawTurnLimit: number;
  recentTurnLimit: number;
  recentTurnCompressThreshold: number;
  recentTurnKeepAfterCompress: number;
  npcRecentMemoryDefaultLimit: number;
  npcRecentMemoryImportantLimit: number;
  focusedNpcRecentMemoryLimit: number;
  npcMemoryCompressThreshold: number;
  npcMemoryKeepAfterCompress: number;
  locationMemoryCompressThreshold: number;
  taskMemoryCompressThreshold: number;
  midTermSummaryLimit: number;
  longTermFactLimit: number;
  vectorResultLimit: number;
  maxPromptMemoryTokens: number;
  recentStoryTokenBudget: number;
  npcMemoryTokenBudget: number;
  midTermTokenBudget: number;
  longTermFactTokenBudget: number;
  locationMemoryTokenBudget: number;
  retrievalTokenBudget: number;
  enableAutoMemorySummary: boolean;
  preferDedicatedMemorySummaryApi: boolean;
}

export interface MemorySummaryMaintenance {
  status: 'pending';
  queuedAt: string;
  triggerTurnNumber: number;
  lastAttemptAt?: string;
  lastFailureReason?: string;
}

export interface MemoryArchive {
  schemaVersion?: 2;
  recentTurnSummaries: RecentTurnMemoryEntry[];
  midTermSummaries: MidTermMemorySummary[];
  /** 新分层字段保持可选，以便旧存档和旧测试夹具无损迁移。 */
  longTermStorySummaries?: LongTermStoryMemorySummary[];
  longTermFacts: LongTermMemoryFact[];
  npcInteractionSummaries: NpcInteractionSummary[];
  npcMidTermSummaries?: NpcMidTermMemorySummary[];
  npcLongTermSummaries?: NpcLongTermMemorySummary[];
  locationMemorySummaries: LocationMemorySummary[];
  settings: MemoryProjectionSettings;
  /**
   * 记忆整理属于可恢复的辅助维护任务。该字段保持可选，
   * 以便旧存档无迁移读取，并确保失败不会影响主回合提交。
   */
  memorySummaryMaintenance?: MemorySummaryMaintenance;
}

export interface MemoryEmbeddingIndexItem {
  indexId: string;
  sourceType: MemoryEmbeddingSourceType;
  sourceId: string;
  title?: string;
  text: string;
  searchableText: string;
  time?: string;
  relatedNpcIds?: string[];
  relatedLocationIds?: string[];
  importance?: MemoryImportance;
  contentHash: string;
}

export interface MemoryEmbeddingVectorItem extends MemoryEmbeddingIndexItem {
  embedding: number[];
  embeddedAt: string;
  model?: string;
}

export interface MemoryEmbeddingIndex {
  schema: 'coc.v2.memory-embedding-index';
  version: 1;
  worldBookId: string;
  updatedAt: string;
  items: MemoryEmbeddingVectorItem[];
}

export interface MemoryRecallTraceEntry {
  strength: 'strong' | 'weak';
  sourceType: MemoryEmbeddingSourceType;
  sourceId: string;
  title?: string;
  text: string;
  time?: string;
  score: number;
  reason: string;
  contentMode: 'original' | 'summary';
  truncated?: boolean;
  sourceTurnNumber?: number;
  retrievalModes?: Array<'local' | 'vector'>;
}

export interface MemoryRecallTrace {
  query: string;
  candidateCount: number;
  omittedCount: number;
  strong: MemoryRecallTraceEntry[];
  weak: MemoryRecallTraceEntry[];
}
