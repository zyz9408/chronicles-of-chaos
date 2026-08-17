// ============================================================
// Engine Core Types - Turn
// ============================================================

import type { DomesticReportResourceDelta } from './luanshi';
import type { MemoryRecallTrace } from './memory';
import type { RuntimeLocationWriteDiagnostic } from './map';

export interface TurnTokenUsageMeta {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheMissTokens?: number;
}

/** 建议行动 */
export interface SuggestedAction {
  label: string;
  description: string;
  actionType: string;
}

/** 回合生成消耗与可查看原文信息 */
export interface TurnNpcIntentSimulationMeta {
  status: 'completed' | 'skipped' | 'failed';
  reason?: string;
  targetNpcIds: string[];
  provider?: string;
  model?: string;
  usage?: TurnTokenUsageMeta;
  package?: {
    protocolVersion: 'coc.v2.npcIntent.v1';
    generatedAt: string;
    source: 'npcSimulation';
    intents: Array<{
      npcId: string;
      npcName: string;
      shouldAct: boolean;
      intent: string;
      trigger: string;
      perceptionBasis?: string;
      relationshipBasis?: string;
      emotionalState?: string;
      confidence?: number;
    }>;
  };
}

export interface TurnWorldEvolutionMeta {
  status: 'completed' | 'skipped' | 'failed';
  reason?: string;
  targetNpcIds: string[];
  appliedNpcIds: string[];
  provider?: string;
  model?: string;
  usage?: TurnTokenUsageMeta;
}

export interface TurnNarrativeLengthMeta {
  preference: 'compact' | 'standard' | 'rich' | 'long';
  label: string;
  minimumCharacters: number;
  maximumCharacters: number;
  retryMinimumCharacters?: number;
  actualCharacters: number;
  status: 'under_minimum' | 'within_target' | 'over_target';
  meetsMinimum: boolean;
  withinRetryTolerance?: boolean;
  retryEnabled?: boolean;
  regenerationAttempted?: boolean;
  firstAttemptCharacters?: number;
  regenerationResolved?: boolean;
}

export type TurnProcessingStage =
  | 'retrievingMemory'
  | 'simulatingNpcs'
  | 'generatingNarrative'
  | 'regeneratingNarrative'
  | 'repairingTimeAdvance'
  | 'repairingStateWriteback'
  | 'repairingNpcProfiles'
  | 'applyingState'
  | 'evolvingWorld'
  | 'compressingMemory'
  | 'saving';

export interface TurnProcessingStageEvent {
  stage: TurnProcessingStage;
  label: string;
  status: 'started' | 'finished' | 'failed' | 'skipped';
  /** 该次阶段尝试开始时间；旧存档可缺省。 */
  startedAt?: string;
  elapsedMs?: number;
  detail?: string;
  provider?: string;
  model?: string;
  /** 仅当供应商返回 usage 时记录；不支持缓存统计的接口保持缺省。 */
  usage?: TurnTokenUsageMeta;
}

export interface TurnPromptTokenLayerMeta {
  id: string;
  label: string;
  chars: number;
  estimatedTokens: number;
  lowerBound: number;
  upperBound: number;
}

export interface TurnPromptTokenEstimateMeta {
  total: {
    chars: number;
    estimatedTokens: number;
    lowerBound: number;
    upperBound: number;
  };
  layers: TurnPromptTokenLayerMeta[];
  contextBreakdown: TurnPromptTokenLayerMeta[];
}

export interface TurnHoldingAnnualSettlementMeta {
  status: 'applied';
  reportId: string;
  year: number | string;
  settledAt: string;
  income: DomesticReportResourceDelta;
  expenses: DomesticReportResourceDelta;
  netChange: DomesticReportResourceDelta;
  completedProjectIds: string[];
  affectedHoldingIds: string[];
  affectedPrivateAssetIds: string[];
}

export interface TurnJudgementDetail {
  label: string;
  value?: number;
  text?: string;
}

export interface TurnOrdinaryCheck {
  checkId: string;
  label: string;
  target?: string;
  ability?: string;
  difficulty?: number;
  total?: number;
  result: string;
  summary?: string;
  details?: TurnJudgementDetail[];
  tags?: string[];
}

export type TurnJudgementCardKind = 'ordinary' | 'battle' | 'combat';

export interface TurnJudgementCard {
  cardId: string;
  kind: TurnJudgementCardKind;
  eyebrow: string;
  title: string;
  target?: string;
  result?: string;
  summary?: string;
  difficulty?: number;
  total?: number;
  margin?: number;
  experienceAward?: number;
  details?: TurnJudgementDetail[];
  tags?: string[];
  panel?: {
    type: 'battles' | 'combats';
    selectedId: string;
    tab: string;
  };
}

export interface TurnDisplayMeta {
  title?: string;
  reasoningSummary?: string;
  rawResponse?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheMissTokens?: number;
  elapsedMs?: number;
  provider?: string;
  model?: string;
  npcIntentSimulation?: TurnNpcIntentSimulationMeta;
  worldEvolution?: TurnWorldEvolutionMeta;
  promptTokenEstimate?: TurnPromptTokenEstimateMeta;
  holdingAnnualSettlement?: TurnHoldingAnnualSettlementMeta;
  judgementCards?: TurnJudgementCard[];
  processingStages?: TurnProcessingStageEvent[];
  memoryRecall?: MemoryRecallTrace;
  narrativeLength?: TurnNarrativeLengthMeta;
  locationWriteback?: {
    errors: string[];
    routeErrors: string[];
    diagnostics: RuntimeLocationWriteDiagnostic[];
  };
}

/** 回合日志条目 */
export interface TurnLogEntry {
  turnNumber: number;
  date: string;
  playerInput: string;
  narrativeText: string;
  fullNarrativeText?: string;
  statePatchSummary: string;
  timestamp: string; // ISO datetime
  /** 当前回合完成后展示给玩家的下一步行动建议；旧存档可缺省。 */
  suggestedActions?: SuggestedAction[];
  displayMeta?: TurnDisplayMeta;
}

/** 行动类型（粗略识别用） */
export type ActionIntent =
  | 'move'
  | 'inquire'
  | 'interact'
  | 'rest'
  | 'trade'
  | 'explore'
  | 'combat'
  | 'other';
