import type {
  PlotPlanEntry,
  Quest,
  RemoteNpcPresenceBeat,
  Rumor,
  WorldTrendEntry,
} from '../types';
import {
  tryCreateGameClockFromDateLabel,
  type GameClock,
} from '../time/gameClock';

export type NarrativeMomentumSourceType = 'matter' | 'plotPlan' | 'remoteBeat' | 'trend' | 'signal';
export type NarrativeMomentumUrgency = 'low' | 'medium' | 'high';

export interface NarrativeMomentumCue {
  sourceType: NarrativeMomentumSourceType;
  sourceId: string;
  title: string;
  reason: string;
  urgency: NarrativeMomentumUrgency;
  allowedDelivery: string[];
  playerDecisionBoundary: string;
}

export interface NarrativeMomentumProjectionInput {
  currentDate: string;
  currentTime?: GameClock;
  currentMatters: Quest[];
  plotPlans: PlotPlanEntry[];
  remoteNpcBeats: RemoteNpcPresenceBeat[];
  trends: WorldTrendEntry[];
  signals: Rumor[];
}

export interface NarrativeMomentumProjection {
  cue: NarrativeMomentumCue | undefined;
  text: string;
  candidateCount: number;
}

interface RankedMomentumCandidate {
  cue: NarrativeMomentumCue;
  score: number;
  sourceOrder: number;
}

const MINUTES_PER_DAY = 24 * 60;
const DAYS_PER_MONTH = 30;
const MONTHS_PER_YEAR = 12;
const PLOT_ADVANCE_COOLDOWN_MINUTES = 12 * 60;
const PLAYER_DECISION_BOUNDARY = '不得替玩家接受任务、结盟、宣战、婚配、处分人物或消耗关键资源';

const matterSeverityScore: Record<NonNullable<Quest['severity']>, number> = {
  minor: 0,
  moderate: 8,
  major: 16,
  critical: 24,
};

const trendSeverityScore: Record<WorldTrendEntry['severity'], number> = {
  低: 0,
  中: 4,
  高: 8,
  极高: 12,
};

const signalSeverityScore: Record<NonNullable<Rumor['severity']>, number> = {
  minor: 0,
  moderate: 3,
  major: 6,
  critical: 9,
};

function toTimelineMinutes(clock: GameClock): number {
  return (
    (((clock.year * MONTHS_PER_YEAR + (clock.month - 1)) * DAYS_PER_MONTH + (clock.day - 1))
      * MINUTES_PER_DAY)
    + clock.hour * 60
    + clock.minute
  );
}

function parseTimelineMinutes(dateLabel?: string): number | undefined {
  if (!dateLabel?.trim()) return undefined;
  const clock = tryCreateGameClockFromDateLabel(dateLabel);
  return clock ? toTimelineMinutes(clock) : undefined;
}

function hasReached(currentMinutes: number, dateLabel?: string): boolean {
  const targetMinutes = parseTimelineMinutes(dateLabel);
  return targetMinutes !== undefined && targetMinutes <= currentMinutes;
}

function elapsedMinutes(currentMinutes: number, dateLabel?: string): number | undefined {
  const targetMinutes = parseTimelineMinutes(dateLabel);
  return targetMinutes === undefined ? undefined : currentMinutes - targetMinutes;
}

function compact(value: string | undefined, fallback: string, limit = 180): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() || fallback;
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function buildMatterCandidates(matters: Quest[], currentMinutes: number): RankedMomentumCandidate[] {
  return matters.flatMap((matter): RankedMomentumCandidate[] => {
    if (matter.status !== 'active') return [];

    const deadlineReached = hasReached(currentMinutes, matter.deadlineAt);
    const highRisk = matter.priority === 'high'
      || matter.severity === 'major'
      || matter.severity === 'critical';
    if (!deadlineReached && !highRisk) return [];

    const severityScore = matter.severity ? matterSeverityScore[matter.severity] : 0;
    const priorityScore = matter.priority === 'high' ? 8 : matter.priority === 'medium' ? 4 : 0;
    const reason = deadlineReached
      ? `事项期限已到；现有风险：${compact(matter.stakes, matter.description)}`
      : `事项风险较高；现有风险：${compact(matter.stakes, matter.description)}`;

    return [{
      score: 500 + (deadlineReached ? 40 : 0) + severityScore + priorityScore,
      sourceOrder: 0,
      cue: {
        sourceType: 'matter',
        sourceId: matter.id,
        title: compact(matter.title, '未命名事项', 80),
        reason,
        urgency: 'high',
        allowedDelivery: ['相关人物催办', '命令或军报', '期限后果', '现场可见风险'],
        playerDecisionBoundary: PLAYER_DECISION_BOUNDARY,
      },
    }];
  });
}

function buildRemoteBeatCandidates(
  beats: RemoteNpcPresenceBeat[],
  currentMinutes: number,
): RankedMomentumCandidate[] {
  return beats.flatMap((beat): RankedMomentumCandidate[] => {
    if (beat.urgency !== 'high') return [];
    if (beat.expiresAt && hasReached(currentMinutes, beat.expiresAt)) return [];

    return [{
      score: 400,
      sourceOrder: 1,
      cue: {
        sourceType: 'remoteBeat',
        sourceId: beat.beatId,
        title: compact(`${beat.name}的远场动向`, '远场人物动向', 80),
        reason: compact(`${beat.triggerReason}；${beat.relevanceSummary}`, beat.triggerReason),
        urgency: 'high',
        allowedDelivery: [compact(beat.suggestedDelivery, '可信渠道', 60)],
        playerDecisionBoundary: PLAYER_DECISION_BOUNDARY,
      },
    }];
  });
}

function buildPlotPlanCandidates(plans: PlotPlanEntry[], currentMinutes: number): RankedMomentumCandidate[] {
  return plans.flatMap((plan): RankedMomentumCandidate[] => {
    if (plan.status === '已完成' || plan.status === '废弃' || plan.priority !== '高') return [];
    if (!hasReached(currentMinutes, plan.notBeforeAt)) return [];
    const sinceAdvance = elapsedMinutes(currentMinutes, plan.lastAdvancedAt);
    if (sinceAdvance !== undefined && sinceAdvance < PLOT_ADVANCE_COOLDOWN_MINUTES) return [];

    return [{
      score: 300,
      sourceOrder: 2,
      cue: {
        sourceType: 'plotPlan',
        sourceId: plan.plotId,
        title: compact(plan.title, '未命名剧情计划', 80),
        reason: `高优先级计划已到可推进时间；现有计划：${compact(plan.description, plan.title)}`,
        urgency: 'medium',
        allowedDelivery: ['来访', '命令或报告', '书信', '传闻', '现场可见后果'],
        playerDecisionBoundary: PLAYER_DECISION_BOUNDARY,
      },
    }];
  });
}

function buildTrendCandidates(trends: WorldTrendEntry[], currentMinutes: number): RankedMomentumCandidate[] {
  return trends.flatMap((trend): RankedMomentumCandidate[] => {
    if (!trend.knownToPlayer || (trend.status !== undefined && trend.status !== 'active')) return [];
    if (!hasReached(currentMinutes, trend.nextCheckAt)) return [];

    return [{
      score: 200 + trendSeverityScore[trend.severity],
      sourceOrder: 3,
      cue: {
        sourceType: 'trend',
        sourceId: trend.trendId,
        title: compact(trend.title, '未命名趋势', 80),
        reason: `已知趋势到达复核时间；现有进展：${compact(trend.progressSummary, trend.summary)}`,
        urgency: trend.severity === '极高' || trend.severity === '高' ? 'high' : 'medium',
        allowedDelivery: ['报告', '传闻', '现场可见后果'],
        playerDecisionBoundary: PLAYER_DECISION_BOUNDARY,
      },
    }];
  });
}

function buildSignalCandidates(signals: Rumor[], currentMinutes: number): RankedMomentumCandidate[] {
  return signals.flatMap((signal): RankedMomentumCandidate[] => {
    const status = signal.status ?? 'open';
    if (signal.verified || (status !== 'open' && status !== 'investigating')) return [];
    if (!hasReached(currentMinutes, signal.expiresAt)) return [];

    const severityScore = signal.severity ? signalSeverityScore[signal.severity] : 0;
    return [{
      score: 100 + severityScore,
      sourceOrder: 4,
      cue: {
        sourceType: 'signal',
        sourceId: signal.id,
        title: compact(signal.title, '未命名线索', 80),
        reason: `未核验线索已到时效复核点；只能表现核验压力，不得把内容写成确认事实：${compact(signal.content, '内容待核验')}`,
        urgency: signal.severity === 'critical' || signal.severity === 'major' ? 'medium' : 'low',
        allowedDelivery: ['调查回报', '可信传闻', '现场核验机会'],
        playerDecisionBoundary: PLAYER_DECISION_BOUNDARY,
      },
    }];
  });
}

function formatProjection(cue: NarrativeMomentumCue): string {
  return [
    'Narrative Momentum / 本回合主要压力（只读候选，不是已发生事实）:',
    `- sourceType=${cue.sourceType} | sourceId=${cue.sourceId} | title=${cue.title} | urgency=${cue.urgency}`,
    `- reason=${cue.reason}`,
    `- allowedDelivery=${cue.allowedDelivery.join('、')}`,
    '- 执行：本回合最多只处理这一个主要压力源；可以推进、复杂化、暂缓或压缩例行过程，但结果必须由正文与结构化写回共同成立。',
    `- 玩家决定边界：${cue.playerDecisionBoundary}；不得把候选直接当作已发生事实，也不得用全知视角代演远场人物。`,
  ].join('\n');
}

/**
 * 从既有动态系统中只读选择一个主要压力源。
 * 本函数不生成剧情事实、不修改状态，也不承诺候选一定会在本回合发生。
 */
export function buildNarrativeMomentumProjection(
  input: NarrativeMomentumProjectionInput,
): NarrativeMomentumProjection {
  const currentClock = input.currentTime ?? tryCreateGameClockFromDateLabel(input.currentDate);
  if (!currentClock) return { cue: undefined, text: '', candidateCount: 0 };
  const currentMinutes = toTimelineMinutes(currentClock);

  const candidates = [
    ...buildMatterCandidates(input.currentMatters, currentMinutes),
    ...buildRemoteBeatCandidates(input.remoteNpcBeats, currentMinutes),
    ...buildPlotPlanCandidates(input.plotPlans, currentMinutes),
    ...buildTrendCandidates(input.trends, currentMinutes),
    ...buildSignalCandidates(input.signals, currentMinutes),
  ].sort((left, right) => (
    right.score - left.score
    || left.sourceOrder - right.sourceOrder
    || left.cue.sourceId.localeCompare(right.cue.sourceId)
  ));

  const cue = candidates[0]?.cue;
  return cue
    ? { cue, text: formatProjection(cue), candidateCount: candidates.length }
    : { cue: undefined, text: '', candidateCount: 0 };
}
