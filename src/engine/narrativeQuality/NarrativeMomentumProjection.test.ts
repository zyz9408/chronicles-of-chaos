import { describe, expect, it } from 'vitest';
import type {
  PlotPlanEntry,
  Quest,
  RemoteNpcPresenceBeat,
  Rumor,
  WorldTrendEntry,
} from '../types';
import { buildNarrativeMomentumProjection } from './NarrativeMomentumProjection';

const currentDate = '公元194年05月10日 10:00（巳时）';

function matter(overrides: Partial<Quest> = {}): Quest {
  return {
    id: 'quest_due',
    title: '守住粮道',
    description: '粮道将在午前遭袭。',
    status: 'active',
    priority: 'high',
    severity: 'critical',
    stakes: '粮道失守会迫使大营断粮。',
    deadlineAt: '公元194年05月10日 09:00（巳时）',
    createdAt: '公元194年05月09日 08:00（辰时）',
    updatedAt: '公元194年05月09日 20:00（戌时）',
    ...overrides,
  };
}

function plot(overrides: Partial<PlotPlanEntry> = {}): PlotPlanEntry {
  return {
    plotId: 'plot_envoy',
    title: '荆北使者抵达',
    horizon: '近期',
    status: '待触发',
    description: '使者携来要求主角表态的军令。',
    priority: '高',
    notBeforeAt: '公元194年05月09日 08:00（辰时）',
    lastAdvancedAt: '公元194年05月09日 18:00（酉时）',
    ...overrides,
  };
}

function remoteBeat(overrides: Partial<RemoteNpcPresenceBeat> = {}): RemoteNpcPresenceBeat {
  return {
    beatId: 'remote_awareness_xunyu',
    awarenessId: 'awareness_xunyu',
    npcId: 'npc_xunyu',
    name: '荀彧',
    beatType: 'letter',
    triggerReason: '旧约尚未回应',
    suggestedDelivery: '书信或可信使者',
    relevanceSummary: '与主角此前承诺直接相关',
    urgency: 'high',
    sourceIds: ['quest_old_oath'],
    ...overrides,
  };
}

function trend(overrides: Partial<WorldTrendEntry> = {}): WorldTrendEntry {
  return {
    trendId: 'trend_supply_front',
    title: '荆北军粮吃紧',
    severity: '高',
    summary: '前线军粮已经出现缺口。',
    knownToPlayer: true,
    status: 'active',
    scope: 'regional',
    progressSummary: '粮道仍受敌军威胁。',
    nextCheckAt: '公元194年05月10日 08:00（辰时）',
    lastAdvancedAt: '公元194年05月09日 12:00（午时）',
    updatedAt: '公元194年05月09日 12:00（午时）',
    ...overrides,
  };
}

function signal(overrides: Partial<Rumor> = {}): Rumor {
  return {
    id: 'signal_grain_spy',
    title: '粮仓内应名单',
    content: '名单真伪尚待核验。',
    source: '军中密报',
    status: 'investigating',
    signalType: 'report',
    confidence: 'medium',
    severity: 'major',
    expiresAt: '公元194年05月10日 09:30（巳时）',
    verified: false,
    createdAt: '公元194年05月09日 15:00（申时）',
    ...overrides,
  };
}

function buildInput(overrides: Partial<Parameters<typeof buildNarrativeMomentumProjection>[0]> = {}) {
  return {
    currentDate,
    currentMatters: [] as Quest[],
    plotPlans: [] as PlotPlanEntry[],
    remoteNpcBeats: [] as RemoteNpcPresenceBeat[],
    trends: [] as WorldTrendEntry[],
    signals: [] as Rumor[],
    ...overrides,
  };
}

describe('buildNarrativeMomentumProjection', () => {
  it('selects one overdue high-risk matter ahead of all lower-priority sources', () => {
    const projection = buildNarrativeMomentumProjection(buildInput({
      currentMatters: [matter()],
      remoteNpcBeats: [remoteBeat()],
      plotPlans: [plot()],
      trends: [trend()],
      signals: [signal()],
    }));

    expect(projection.cue).toMatchObject({
      sourceType: 'matter',
      sourceId: 'quest_due',
      urgency: 'high',
    });
    expect(projection.candidateCount).toBe(5);
    expect(projection.text).toContain('本回合最多只处理这一个主要压力源');
    expect(projection.text).toContain('候选，不是已发生事实');
    expect(projection.text).toContain('不得替玩家接受任务、结盟、宣战、婚配、处分人物或消耗关键资源');
  });

  it('uses stable deterministic ordering between matters with the same deadline class', () => {
    const projection = buildNarrativeMomentumProjection(buildInput({
      currentMatters: [
        matter({ id: 'quest_minor', title: '次要催办', severity: 'minor' }),
        matter({ id: 'quest_critical', title: '严重催办', severity: 'critical' }),
      ],
    }));

    expect(projection.cue?.sourceId).toBe('quest_critical');
  });

  it('selects a high-urgency remote beat when no matter outranks it', () => {
    const projection = buildNarrativeMomentumProjection(buildInput({
      remoteNpcBeats: [remoteBeat()],
      plotPlans: [plot()],
    }));

    expect(projection.cue).toMatchObject({
      sourceType: 'remoteBeat',
      sourceId: 'remote_awareness_xunyu',
      allowedDelivery: ['书信或可信使者'],
    });
  });

  it('requires a high-priority plot to reach notBeforeAt and remain unadvanced for twelve hours', () => {
    const eligible = buildNarrativeMomentumProjection(buildInput({ plotPlans: [plot()] }));
    const cooling = buildNarrativeMomentumProjection(buildInput({
      plotPlans: [plot({ lastAdvancedAt: '公元194年05月10日 08:00（辰时）' })],
    }));
    const future = buildNarrativeMomentumProjection(buildInput({
      plotPlans: [plot({ notBeforeAt: '公元194年05月11日 08:00（辰时）' })],
    }));

    expect(eligible.cue?.sourceType).toBe('plotPlan');
    expect(cooling.cue).toBeUndefined();
    expect(future.cue).toBeUndefined();
  });

  it('only treats due ongoing trends and due unverified signals as lower-priority review pressure', () => {
    const dueTrend = buildNarrativeMomentumProjection(buildInput({ trends: [trend()] }));
    const futureTrend = buildNarrativeMomentumProjection(buildInput({
      trends: [trend({ nextCheckAt: '公元194年05月11日 08:00（辰时）' })],
    }));
    const dueSignal = buildNarrativeMomentumProjection(buildInput({ signals: [signal()] }));
    const verifiedSignal = buildNarrativeMomentumProjection(buildInput({
      signals: [signal({ status: 'verified', verified: true })],
    }));

    expect(dueTrend.cue).toMatchObject({ sourceType: 'trend', sourceId: 'trend_supply_front' });
    expect(futureTrend.cue).toBeUndefined();
    expect(dueSignal.cue).toMatchObject({ sourceType: 'signal', sourceId: 'signal_grain_spy' });
    expect(verifiedSignal.cue).toBeUndefined();
  });

  it('returns an empty projection for completed, future, cooling, expired, or otherwise invalid candidates', () => {
    const projection = buildNarrativeMomentumProjection(buildInput({
      currentMatters: [matter({ status: 'completed' })],
      remoteNpcBeats: [remoteBeat({ expiresAt: '公元194年05月10日 08:00（辰时）' })],
      plotPlans: [plot({ status: '已完成' })],
      trends: [trend({ trendId: 'trend_cooling', status: 'cooling' }), trend({ status: 'historical' })],
      signals: [signal({ status: 'archived' })],
    }));

    expect(projection).toEqual({ cue: undefined, text: '', candidateCount: 0 });
  });
});
