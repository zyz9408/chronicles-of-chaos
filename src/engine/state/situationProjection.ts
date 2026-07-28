import type {
  PlotPlanEntry,
  Quest,
  RemoteNpcPresenceBeat,
  Rumor,
  WorldlineProjectionHint,
  WorldTrendEntry,
} from '../types';

export interface SituationProjectionSourceCounts {
  currentMatters: number;
  signals: number;
  chronicles: number;
  plotPlans: number;
  remoteNpcBeats: number;
  worldlineHints: number;
}

export type SituationProjectionSectionId =
  | 'currentMatters'
  | 'signals'
  | 'chronicles'
  | 'plotPlans'
  | 'remoteNpcBeats'
  | 'worldlineHints';

export type SituationProjectionCategoryCounts = Record<SituationProjectionSectionId, number>;

export interface SituationProjectionSection {
  id: SituationProjectionSectionId;
  label: string;
  sourceCount: number;
  projectedCount: number;
  omittedCount: number;
  truncatedCount: number;
  lines: string[];
  text: string;
}

export interface SituationProjection {
  text: string;
  lines: string[];
  sourceCounts: SituationProjectionSourceCounts;
  projectedCounts: SituationProjectionCategoryCounts;
  omittedCounts: SituationProjectionCategoryCounts;
  truncatedCounts: SituationProjectionCategoryCounts;
  sections: SituationProjectionSection[];
}

export interface SituationProjectionInput {
  currentMatters: Quest[];
  signals: Rumor[];
  chronicles: WorldTrendEntry[];
  plotPlans: PlotPlanEntry[];
  remoteNpcBeats: RemoteNpcPresenceBeat[];
  worldlineHints?: WorldlineProjectionHint[];
}

export const SITUATION_PROJECTION_BUDGET = {
  currentMatters: 4,
  signals: 4,
  chronicles: 3,
  plotPlans: 3,
  remoteNpcBeats: 3,
  // KnowledgeBase 与 StoryPack 已分别执行 2/4/6 门禁；此处只承接两路合并结果。
  worldlineHints: 12,
  maxLineChars: 360,
} as const;

export function buildSituationProjection(input: SituationProjectionInput): SituationProjection {
  const worldlineHints = input.worldlineHints ?? [];
  const sourceCounts: SituationProjectionSourceCounts = {
    currentMatters: input.currentMatters.length,
    signals: input.signals.length,
    chronicles: input.chronicles.length,
    plotPlans: input.plotPlans.length,
    remoteNpcBeats: input.remoteNpcBeats.length,
    worldlineHints: worldlineHints.length,
  };
  const sections = [
    buildProjectionSection(
      'currentMatters',
      'Current Matters / 当前事项',
      input.currentMatters,
      SITUATION_PROJECTION_BUDGET.currentMatters,
      'first',
      compactMatter,
    ),
    buildProjectionSection(
      'signals',
      'Signals / 风声线索',
      input.signals,
      SITUATION_PROJECTION_BUDGET.signals,
      'last',
      compactSignal,
    ),
    buildProjectionSection(
      'chronicles',
      'Chronicles / 纪事',
      input.chronicles,
      SITUATION_PROJECTION_BUDGET.chronicles,
      'last',
      compactChronicle,
    ),
    buildProjectionSection(
      'plotPlans',
      'Hidden Plot Plans / 隐藏剧情计划',
      input.plotPlans,
      SITUATION_PROJECTION_BUDGET.plotPlans,
      'last',
      compactPlotPlan,
    ),
    buildProjectionSection(
      'remoteNpcBeats',
      'Remote NPC Presence / 远场 NPC 存在感候选（未裁定建议）',
      input.remoteNpcBeats,
      SITUATION_PROJECTION_BUDGET.remoteNpcBeats,
      'first',
      compactRemoteNpcBeat,
    ),
    buildProjectionSection(
      'worldlineHints',
      'Worldline Knowledge / 世界线资料提示',
      worldlineHints,
      SITUATION_PROJECTION_BUDGET.worldlineHints,
      'first',
      compactWorldlineHint,
    ),
  ].filter((section) => section.projectedCount > 0);
  const lines = sections.flatMap((section) => section.lines);
  const projectedCounts = buildCounts(sections, 'projectedCount');
  const omittedCounts = buildCounts(sections, 'omittedCount');
  const truncatedCounts = buildCounts(sections, 'truncatedCount');

  if (lines.length === 0) {
    return {
      text: '',
      lines: [],
      sourceCounts,
      projectedCounts,
      omittedCounts,
      truncatedCounts,
      sections: [],
    };
  }

  return {
    text: [
      'Situation Projection / 局势投影:',
      '原则：这些是当前回合相关的局势重点；不会自动推进剧情，也不替代实体状态写回；候选项不是已发生事实。',
      ...lines,
    ].join('\n'),
    lines,
    sourceCounts,
    projectedCounts,
    omittedCounts,
    truncatedCounts,
    sections,
  };
}

function buildProjectionSection<T>(
  id: SituationProjectionSectionId,
  label: string,
  items: T[],
  limit: number,
  direction: 'first' | 'last',
  compact: (item: T) => string,
): SituationProjectionSection {
  const selected = direction === 'first' ? items.slice(0, limit) : items.slice(-limit);
  let truncatedCount = 0;
  const lines = selected.map((item) => {
    const raw = compact(item);
    const compacted = truncateProjectionLine(raw);
    if (compacted !== raw) truncatedCount += 1;
    return `- ${label}: ${compacted}`;
  });

  return {
    id,
    label,
    sourceCount: items.length,
    projectedCount: selected.length,
    omittedCount: Math.max(0, items.length - selected.length),
    truncatedCount,
    lines,
    text: lines.join('\n'),
  };
}

function buildCounts(
  sections: SituationProjectionSection[],
  key: 'projectedCount' | 'omittedCount' | 'truncatedCount',
): SituationProjectionCategoryCounts {
  const counts: SituationProjectionCategoryCounts = {
    currentMatters: 0,
    signals: 0,
    chronicles: 0,
    plotPlans: 0,
    remoteNpcBeats: 0,
    worldlineHints: 0,
  };

  for (const section of sections) {
    counts[section.id] = section[key];
  }

  return counts;
}

function truncateProjectionLine(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= SITUATION_PROJECTION_BUDGET.maxLineChars) return normalized;
  return `${normalized.slice(0, SITUATION_PROJECTION_BUDGET.maxLineChars)}...（截断）`;
}

function compactMatter(matter: Quest): string {
  return joinParts([
    `questId=${matter.id}`,
    matter.title,
    `status=${matter.status}`,
    matter.priority ? `priority=${matter.priority}` : '',
    matter.currentStep ? `step=${matter.currentStep}` : '',
    matter.stakes ? `stakes=${matter.stakes}` : '',
    matter.deadlineAt ? `deadline=${matter.deadlineAt}` : '',
    matter.outcomeSummary ? `outcome=${matter.outcomeSummary}` : '',
    matter.consequenceTags?.length ? `tags=${matter.consequenceTags.join('/')}` : '',
    matter.followUpHooks?.length ? `hooks=${matter.followUpHooks.join('/')}` : '',
  ]);
}

function compactSignal(signal: Rumor): string {
  const title = signal.title?.trim() || signal.content;
  return joinParts([
    `rumorId=${signal.id}`,
    title,
    signal.status ? `status=${signal.status}` : '',
    signal.confidence ? `confidence=${signal.confidence}` : '',
    signal.source ? `source=${signal.source}` : '',
    signal.potentialOutcomeSummary ? `potentialOutcome=${signal.potentialOutcomeSummary}` : '',
    signal.consequenceTags?.length ? `tags=${signal.consequenceTags.join('/')}` : '',
    signal.expiresAt ? `expires=${signal.expiresAt}` : '',
    title !== signal.content ? `content=${signal.content}` : '',
  ]);
}

function compactChronicle(chronicle: WorldTrendEntry): string {
  return joinParts([
    `trendId=${chronicle.trendId}`,
    chronicle.title,
    chronicle.status ? `status=${chronicle.status}` : '',
    chronicle.severity ? `severity=${chronicle.severity}` : '',
    chronicle.certainty ? `certainty=${chronicle.certainty}` : '',
    chronicle.happenedAt ? `happenedAt=${chronicle.happenedAt}` : '',
    chronicle.outcomeSummary ? `outcome=${chronicle.outcomeSummary}` : '',
    chronicle.progressSummary ? `progress=${chronicle.progressSummary}` : '',
    chronicle.nextCheckAt ? `nextCheckAt=${chronicle.nextCheckAt}` : '',
    chronicle.lastAdvancedAt ? `lastAdvancedAt=${chronicle.lastAdvancedAt}` : '',
    chronicle.consequenceTags?.length ? `tags=${chronicle.consequenceTags.join('/')}` : '',
    chronicle.sourceConflictIds?.length ? `sourceConflicts=${chronicle.sourceConflictIds.join('/')}` : '',
    chronicle.title !== chronicle.summary ? `summary=${chronicle.summary}` : '',
  ]);
}

function compactPlotPlan(plan: PlotPlanEntry): string {
  return joinParts([
    plan.title,
    `plotId=${plan.plotId}`,
    `horizon=${plan.horizon}`,
    `status=${plan.status}`,
    `priority=${plan.priority}`,
    plan.notBeforeAt ? `notBeforeAt=${plan.notBeforeAt}` : '',
    plan.lastAdvancedAt ? `lastAdvancedAt=${plan.lastAdvancedAt}` : '',
    `summary=${plan.description}`,
  ]);
}

function compactRemoteNpcBeat(beat: RemoteNpcPresenceBeat): string {
  return joinParts([
    beat.name,
    `type=${beat.beatType}`,
    `urgency=${beat.urgency}`,
    beat.triggerReason ? `reason=${beat.triggerReason}` : '',
    beat.suggestedDelivery ? `delivery=${beat.suggestedDelivery}` : '',
    beat.relevanceSummary ? `relevance=${beat.relevanceSummary}` : '',
  ]);
}

function compactWorldlineHint(hint: WorldlineProjectionHint): string {
  return joinParts([
    `hintId=${hint.historicalAnchorId ?? hint.id}`,
    ...(hint.historicalAnchorId ? [`cardId=${hint.id}`] : []),
    ...(hint.sourceRef
      ? [`sourceRef=${hint.sourceRef.providerId}/${hint.sourceRef.sourceType}/${hint.sourceRef.sourceId}`]
      : []),
    hint.title,
    `source=${hint.sourceType}`,
    `importance=${hint.importance}`,
    `strictness=${hint.strictness}`,
    hint.reason ? `reason=${hint.reason}` : '',
    hint.text,
  ]);
}

function joinParts(parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(' | ');
}
