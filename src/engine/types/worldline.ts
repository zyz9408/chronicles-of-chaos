export type WorldlineKnowledgeMode = 'off' | 'light' | 'default' | 'strict';

export interface WorldlineRuntimeSettings {
  knowledgeMode: WorldlineKnowledgeMode;
  knowledgeBaseId?: string;
  storyPackIds?: string[];
}

export type WorldlineKnowledgeCardKind =
  | 'eraAnchor'
  | 'personTimeline'
  | 'faction'
  | 'place'
  | 'event'
  | 'customRule';

export type HistoricalAnchorTerminalDisposition = 'diverged' | 'realized' | 'expired';

export type HistoricalAnchorApplicabilityDisposition =
  | 'not_yet'
  | 'baseline_possible'
  | 'delayed_candidate'
  | 'transformed_candidate'
  | HistoricalAnchorTerminalDisposition;

export type HistoricalFactRef =
  | {
      kind: 'npcFaction';
      npcId: string;
      allowedFactionIds: string[];
    }
  | {
      kind: 'holdingController';
      holdingId: string;
      allowedControllerIds: string[];
    }
  | {
      kind: 'troopLifecycle';
      troopId: string;
      allowedStatuses: string[];
    }
  | {
      kind: 'worldTrendStatus';
      trendId: string;
      allowedStatuses: string[];
    }
  | {
      kind: 'questStatus';
      questId: string;
      allowedStatuses: string[];
    };

export interface HistoricalEventApplicability {
  historicalWindow: {
    earliest?: string;
    typical?: string;
    latest?: string;
    afterlifeUntil?: string;
  };
  hardPrerequisites?: HistoricalFactRef[];
  structuralPressure?: string;
  divergencePolicy: {
    mayDelay: boolean;
    mayTransform: boolean;
    suppressWhenContradicted: boolean;
  };
}

export interface HistoricalAnchorStateEntry {
  cardId: string;
  disposition: HistoricalAnchorTerminalDisposition;
  assessedAt: string;
  factRefs: string[];
  outcomeRef?: string;
  note?: string;
}

export interface WorldlineKnowledgeCard {
  id: string;
  /**
   * 多张资料卡共同描述同一重大历史节点时使用的稳定追踪 ID。
   * 终态账本仍兼容直接使用旧 card id。
   */
  historicalAnchorId?: string;
  worldBookId: string;
  kind: WorldlineKnowledgeCardKind;
  title: string;
  summary: string;
  timeRange?: {
    start?: string;
    end?: string;
  };
  relatedNpcNames?: string[];
  relatedFactionIds?: string[];
  relatedPlaceIds?: string[];
  relatedTags?: string[];
  importance: 'minor' | 'normal' | 'major' | 'critical';
  strictness: 'light' | 'default' | 'strict';
  contradictionHint?: string;
  sourceLabel?: string;
  historicalEvent?: HistoricalEventApplicability;
}

export interface WorldlineKnowledgeBase {
  id: string;
  worldBookId: string;
  name: string;
  version: string;
  description: string;
  cards: WorldlineKnowledgeCard[];
}

export type WorldlineStoryThreadKind =
  | 'structuralPressure'
  | 'domainSituation'
  | 'dramaMotif'
  | 'aftermath';

export type WorldlineStoryReusePolicy =
  | 'context_reusable'
  | 'motif_reusable'
  | 'save_single_use'
  | 'arc_singleton';

export interface WorldlineStorySourceRef {
  providerId: string;
  sourceType: 'storyThread';
  sourceId: string;
}

export interface WorldlineStoryThread {
  id: string;
  worldBookId: string;
  /**
   * Batch 0 之后的正式 StoryPack 使用这些结构化元数据。
   * 字段保持可选，以便旧测试夹具与外部小型剧情包继续读取；
   * 正式包由 StoryPack validator 强制要求完整。
   */
  kind?: WorldlineStoryThreadKind;
  domain?: string;
  subdomain?: string;
  motifId?: string;
  facet?: string;
  title: string;
  summary: string;
  entrySignals?: string[];
  escalationShapes?: string[];
  rolePerspectives?: string[];
  relatedNpcNames?: string[];
  relatedFactionIds?: string[];
  relatedPlaceIds?: string[];
  relatedTags?: string[];
  timeRange?: {
    start?: string;
    end?: string;
  };
  reusePolicy?: WorldlineStoryReusePolicy;
  cooldownTurns?: number;
  promptSafeVersion?: string;
  sourceRef?: WorldlineStorySourceRef;
  usageBoundary: string;
}

export interface WorldlineStoryPack {
  id: string;
  worldBookId: string;
  name: string;
  version: string;
  description: string;
  threads: WorldlineStoryThread[];
}

export interface WorldlineKnowledgeQuery {
  worldBookId: string;
  mode: WorldlineKnowledgeMode;
  currentDate?: string;
  currentLocationId?: string;
  presentNpcNames: string[];
  focusedNpcNames: string[];
  relatedFactionIds: string[];
  activeTags: string[];
}

export interface WorldlineProjectionHint {
  id: string;
  historicalAnchorId?: string;
  sourceRef?: WorldlineStorySourceRef;
  sourceType: 'knowledgeBase' | 'storyPack';
  title: string;
  text: string;
  importance: WorldlineKnowledgeCard['importance'];
  strictness: WorldlineKnowledgeCard['strictness'];
  reason: string;
  applicability?: HistoricalAnchorApplicabilityDisposition;
}
