import type { Quest, Rumor, RuntimeState, WorldTrendEntry } from '../engine/types';
import { formatKnownSourceLabel } from './gameTooltipText';
import { isOpenCurrentMatter } from '../engine/state/currentMatterLifecycle';
import {
  isWorldChronicleEligible,
  resolveWorldChronicleStatus,
} from '../engine/state/worldChroniclePolicy';

export type DynamicPanelTabKey = 'currentMatters' | 'signals' | 'chronicles' | 'undercurrents';
export type DynamicPanelStageKey = 'urgent' | 'developing' | 'verified' | 'history';

export interface DynamicPanelTab {
  key: DynamicPanelTabKey;
  label: string;
  count: number;
  enabled: boolean;
}

export interface DynamicPanelStageTab {
  key: DynamicPanelStageKey;
  label: string;
  count: number;
  enabled: boolean;
}

export interface CurrentMatterCard {
  id: string;
  title: string;
  description: string;
  status: Quest['status'];
  statusLabel: string;
  priorityLabel?: string;
  severityLabel?: string;
  source?: string;
  sourceLabel?: string;
  currentStep?: string;
  stakes?: string;
  deadlineAt?: string;
  outcomeSummary?: string;
  consequenceTags?: string[];
  affectedNpcIds?: string[];
  affectedFactionIds?: string[];
  affectedPlaceIds?: string[];
  affectedForceIds?: string[];
  affectedHoldingIds?: string[];
  followUpHooks?: string[];
  updatedAt: string;
}

export interface SignalCard {
  id: string;
  title: string;
  content: string;
  source: string;
  sourceLabel: string;
  signalType?: Rumor['signalType'];
  signalTypeLabel?: string;
  confidence?: Rumor['confidence'];
  confidenceLabel?: string;
  severityLabel?: string;
  potentialOutcomeSummary?: string;
  consequenceTags?: string[];
  affectedNpcIds?: string[];
  affectedFactionIds?: string[];
  affectedPlaceIds?: string[];
  affectedForceIds?: string[];
  affectedHoldingIds?: string[];
  followUpHooks?: string[];
  relatedLocationIds?: string[];
  threadId?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface ChronicleCard {
  id: string;
  title: string;
  summary: string;
  severity: WorldTrendEntry['severity'];
  severityLabel?: string;
  scope?: WorldTrendEntry['scope'];
  scopeLabel?: string;
  certainty?: WorldTrendEntry['certainty'];
  certaintyLabel?: string;
  visibility?: WorldTrendEntry['visibility'];
  visibilityLabel?: string;
  source?: string;
  sourceLabel?: string;
  locationId?: string;
  happenedAt?: string;
  learnedAt?: string;
  outcomeSummary?: string;
  consequenceTags?: string[];
  affectedNpcIds?: string[];
  affectedFactionIds?: string[];
  affectedPlaceIds?: string[];
  affectedForceIds?: string[];
  affectedHoldingIds?: string[];
  followUpHooks?: string[];
  sourceQuestIds?: string[];
  sourceSignalIds?: string[];
  sourceConflictIds?: string[];
  threadId?: string;
  updatedAt: string;
}

export interface UndercurrentCard {
  id: string;
  content: string;
}

export interface DynamicPanelStageItems {
  currentMatters: CurrentMatterCard[];
  signals: SignalCard[];
  chronicles: ChronicleCard[];
  undercurrents: UndercurrentCard[];
}

export interface DynamicPanelModel {
  stageTabs: DynamicPanelStageTab[];
  tabs: DynamicPanelTab[];
  itemsByStage: Record<DynamicPanelStageKey, DynamicPanelStageItems>;
  currentMatterCount: number;
  activeMatterCount: number;
  signalCount: number;
  chronicleCount: number;
  undercurrentCount: number;
}

const statusLabels: Partial<Record<Quest['status'], string>> = {
  active: '进行中',
  completed: '已完成',
  failed: '已失败',
  invalidated: '已失效',
  archived: '已归档',
};

const internalConsequenceTagLabels: Record<string, string> = {
  faction: '势力影响',
  force: '部队影响',
  holding: '领地影响',
  location: '地点变化',
  quest: '事项变化',
  resource: '资源变化',
  route: '路线变化',
  threat: '威胁变化',
};

function formatPlayerVisibleConsequenceTags(tags?: string[]): string[] | undefined {
  if (!tags?.length) return undefined;
  const formatted = tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => {
      const separatorIndex = tag.indexOf(':');
      if (separatorIndex <= 0) return tag;
      const namespace = tag.slice(0, separatorIndex).trim().toLocaleLowerCase();
      return internalConsequenceTagLabels[namespace] ?? '局势变化';
    });
  const unique = Array.from(new Set(formatted));
  return unique.length > 0 ? unique : undefined;
}

const priorityLabels: Record<NonNullable<Quest['priority']>, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

const severityLabels: Record<NonNullable<Quest['severity']>, string> = {
  minor: '轻',
  moderate: '中',
  major: '重',
  critical: '危急',
};

const signalTypeLabels: Record<NonNullable<Rumor['signalType']>, string> = {
  rumor: '传闻',
  clue: '线索',
  report: '情报',
  omen: '异动',
};

const confidenceLabels: Record<NonNullable<Rumor['confidence']>, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

const worldTrendSeverityLabels: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '危急',
  '低': '低',
  '中': '中',
  '高': '高',
  '危急': '危急',
};

const worldTrendScopeLabels: Record<string, string> = {
  local: '本地',
  regional: '区域',
  realm: '一国',
  world: '天下',
  personal: '个人',
  faction: '势力',
  military: '军事',
};

const certaintyLabels: Record<string, string> = {
  confirmed: '已确认',
  reported: '据报',
  rumor: '传闻',
  uncertain: '不明',
  low: '低',
  medium: '中',
  high: '高',
};

const visibilityLabels: Record<string, string> = {
  public: '公开',
  private: '私下',
  secret: '隐秘',
  hidden: '隐藏',
  known: '已知',
  unknown: '不明',
};

export function buildDynamicPanelModel(state: RuntimeState): DynamicPanelModel {
  const allCurrentMatters = state.activeQuests ?? [];
  const urgentCurrentMatters = allCurrentMatters
    .filter(isCurrentMatterUrgent)
    .map(buildCurrentMatterCard);
  const developingCurrentMatters = allCurrentMatters
    .filter((quest) => isCurrentMatterActive(quest) && !isCurrentMatterUrgent(quest))
    .map(buildCurrentMatterCard);
  const historicalCurrentMatters = allCurrentMatters
    .filter((quest) => !isCurrentMatterActive(quest))
    .map(buildCurrentMatterCard);
  const activeMatterCount = urgentCurrentMatters.length + developingCurrentMatters.length;

  const allSignals = state.knownRumors ?? [];
  const developingSignals = allSignals
    .filter(isSignalDevelopingInDynamicPanel)
    .map(buildSignalCard);
  const verifiedSignals = allSignals
    .filter(isSignalVerifiedInDynamicPanel)
    .map(buildSignalCard);
  const historicalSignals = allSignals
    .filter((signal) => !isSignalDevelopingInDynamicPanel(signal) && !isSignalVerifiedInDynamicPanel(signal))
    .map(buildSignalCard);

  const knownChronicles = (state.worldTrends ?? [])
    .filter((trend) => trend.knownToPlayer)
    .filter(isWorldChronicleEligible);
  const developingChronicles = knownChronicles
    .filter(isChronicleDevelopingInDynamicPanel)
    .map(buildChronicleCard);
  const verifiedChronicles = knownChronicles
    .filter(isChronicleVerifiedInDynamicPanel)
    .map(buildChronicleCard);
  const historicalChronicles = knownChronicles
    .filter((trend) => !isChronicleDevelopingInDynamicPanel(trend) && !isChronicleVerifiedInDynamicPanel(trend))
    .map(buildChronicleCard);

  const undercurrents = (state.localSituationNotes ?? [])
    .map((note) => note.trim())
    .filter(Boolean)
    .map((content, index) => ({ id: `undercurrent-${index}`, content }));

  const emptyStageItems = (): DynamicPanelStageItems => ({
    currentMatters: [],
    signals: [],
    chronicles: [],
    undercurrents: [],
  });
  const itemsByStage: Record<DynamicPanelStageKey, DynamicPanelStageItems> = {
    urgent: {
      ...emptyStageItems(),
      currentMatters: urgentCurrentMatters,
    },
    developing: {
      currentMatters: developingCurrentMatters,
      signals: developingSignals,
      chronicles: developingChronicles,
      undercurrents,
    },
    verified: {
      ...emptyStageItems(),
      signals: verifiedSignals,
      chronicles: verifiedChronicles,
    },
    history: {
      ...emptyStageItems(),
      currentMatters: historicalCurrentMatters,
      signals: historicalSignals,
      chronicles: historicalChronicles,
    },
  };

  const countStage = (stage: DynamicPanelStageKey) => {
    const items = itemsByStage[stage];
    return items.currentMatters.length + items.signals.length + items.chronicles.length + items.undercurrents.length;
  };

  return {
    stageTabs: [
      { key: 'urgent', label: '当前必须处理', count: countStage('urgent'), enabled: true },
      { key: 'developing', label: '正在发展', count: countStage('developing'), enabled: true },
      { key: 'verified', label: '已验证信息', count: countStage('verified'), enabled: true },
      { key: 'history', label: '历史记录', count: countStage('history'), enabled: true },
    ],
    tabs: [
      { key: 'currentMatters', label: '当前事项', count: allCurrentMatters.length, enabled: true },
      { key: 'signals', label: '风声线索', count: allSignals.length, enabled: allSignals.length > 0 },
      { key: 'chronicles', label: '纪事', count: knownChronicles.length, enabled: knownChronicles.length > 0 },
      { key: 'undercurrents', label: '暗流', count: undercurrents.length, enabled: undercurrents.length > 0 },
    ],
    itemsByStage,
    currentMatterCount: allCurrentMatters.length,
    activeMatterCount,
    signalCount: allSignals.length,
    chronicleCount: knownChronicles.length,
    undercurrentCount: undercurrents.length,
  };
}

function isCurrentMatterActive(quest: Quest): boolean {
  return isOpenCurrentMatter(quest);
}

function isCurrentMatterUrgent(quest: Quest): boolean {
  if (!isCurrentMatterActive(quest)) return false;
  return quest.priority === 'high'
    || quest.severity === 'major'
    || quest.severity === 'critical'
    || Boolean(quest.deadlineAt?.trim());
}

function isSignalDevelopingInDynamicPanel(signal: Rumor): boolean {
  const status = signal.status ?? 'open';
  return status === 'open' || status === 'investigating';
}

function isSignalVerifiedInDynamicPanel(signal: Rumor): boolean {
  return signal.verified === true || signal.status === 'verified';
}

function isChronicleDevelopingInDynamicPanel(trend: WorldTrendEntry): boolean {
  const status = resolveWorldChronicleStatus(trend);
  return status === 'active'
    && trend.certainty !== 'confirmed';
}

function isChronicleVerifiedInDynamicPanel(trend: WorldTrendEntry): boolean {
  const status = resolveWorldChronicleStatus(trend);
  return (status === 'active' || status === 'cooling')
    && (status === 'cooling' || trend.certainty === 'confirmed');
}

function buildCurrentMatterCard(quest: Quest): CurrentMatterCard {
  return {
    id: quest.id,
    title: quest.title,
    description: quest.description,
    status: quest.status,
    statusLabel: statusLabels[quest.status] ?? quest.status,
    priorityLabel: quest.priority ? priorityLabels[quest.priority] : undefined,
    severityLabel: quest.severity ? severityLabels[quest.severity] : undefined,
    source: quest.source,
    sourceLabel: quest.source ? formatKnownSourceLabel(quest.source) : undefined,
    currentStep: quest.currentStep,
    stakes: quest.stakes,
    deadlineAt: quest.deadlineAt,
    outcomeSummary: quest.outcomeSummary,
    consequenceTags: formatPlayerVisibleConsequenceTags(quest.consequenceTags),
    affectedNpcIds: quest.affectedNpcIds,
    affectedFactionIds: quest.affectedFactionIds,
    affectedPlaceIds: quest.affectedPlaceIds,
    affectedForceIds: quest.affectedForceIds,
    affectedHoldingIds: quest.affectedHoldingIds,
    followUpHooks: quest.followUpHooks,
    updatedAt: quest.updatedAt,
  };
}

function buildSignalCard(signal: Rumor): SignalCard {
  return {
    id: signal.id,
    title: signal.title ?? signal.content,
    content: signal.content,
    source: signal.source,
    sourceLabel: formatKnownSourceLabel(signal.source),
    signalType: signal.signalType,
    signalTypeLabel: signal.signalType ? signalTypeLabels[signal.signalType] : undefined,
    confidence: signal.confidence,
    confidenceLabel: signal.confidence ? confidenceLabels[signal.confidence] : undefined,
    severityLabel: signal.severity ? severityLabels[signal.severity] : undefined,
    potentialOutcomeSummary: signal.potentialOutcomeSummary,
    consequenceTags: formatPlayerVisibleConsequenceTags(signal.consequenceTags),
    affectedNpcIds: signal.affectedNpcIds,
    affectedFactionIds: signal.affectedFactionIds,
    affectedPlaceIds: signal.affectedPlaceIds,
    affectedForceIds: signal.affectedForceIds,
    affectedHoldingIds: signal.affectedHoldingIds,
    followUpHooks: signal.followUpHooks,
    relatedLocationIds: signal.relatedLocationIds,
    threadId: signal.threadId,
    expiresAt: signal.expiresAt,
    createdAt: signal.createdAt,
  };
}

function buildChronicleCard(trend: WorldTrendEntry): ChronicleCard {
  return {
    id: trend.trendId,
    title: trend.title,
    summary: trend.summary,
    severity: trend.severity,
    severityLabel: worldTrendSeverityLabels[String(trend.severity)] ?? String(trend.severity),
    scope: trend.scope,
    scopeLabel: trend.scope ? worldTrendScopeLabels[String(trend.scope)] ?? String(trend.scope) : undefined,
    certainty: trend.certainty,
    certaintyLabel: trend.certainty ? certaintyLabels[String(trend.certainty)] ?? String(trend.certainty) : undefined,
    visibility: trend.visibility,
    visibilityLabel: trend.visibility ? visibilityLabels[String(trend.visibility)] ?? String(trend.visibility) : undefined,
    source: trend.source,
    sourceLabel: trend.source ? formatKnownSourceLabel(trend.source) : undefined,
    locationId: trend.locationId,
    happenedAt: trend.happenedAt,
    learnedAt: trend.learnedAt,
    outcomeSummary: trend.outcomeSummary,
    consequenceTags: formatPlayerVisibleConsequenceTags(trend.consequenceTags),
    affectedNpcIds: trend.affectedNpcIds,
    affectedFactionIds: trend.affectedFactionIds,
    affectedPlaceIds: trend.affectedPlaceIds,
    affectedForceIds: trend.affectedForceIds,
    affectedHoldingIds: trend.affectedHoldingIds,
    followUpHooks: trend.followUpHooks,
    sourceQuestIds: trend.sourceQuestIds,
    sourceSignalIds: trend.sourceSignalIds,
    sourceConflictIds: trend.sourceConflictIds,
    threadId: trend.threadId,
    updatedAt: trend.updatedAt,
  };
}
