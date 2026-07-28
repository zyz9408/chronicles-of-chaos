import { describe, expect, it } from 'vitest';
import type {
  PlotPlanEntry,
  Quest,
  RemoteNpcPresenceBeat,
  Rumor,
  WorldlineProjectionHint,
  WorldTrendEntry,
} from '../types';
import { buildSituationProjection, SITUATION_PROJECTION_BUDGET } from './situationProjection';

describe('situationProjection', () => {
  it('projects conflict source ids for chronicle lines', () => {
    const projection = buildSituationProjection({
      currentMatters: [],
      signals: [],
      chronicles: [
        {
          trendId: 'trend_battle_public',
          title: 'Public battle report',
          summary: 'A known battle became public news.',
          knownToPlayer: true,
          severity: 'high',
          sourceConflictIds: ['battle_public_1'],
          updatedAt: 'day 1',
        } as unknown as WorldTrendEntry,
      ],
      plotPlans: [],
      remoteNpcBeats: [],
    });

    expect(projection.text).toContain('trendId=trend_battle_public');
    expect(projection.text).toContain('sourceConflicts=battle_public_1');
  });

  it('applies shared item limits and truncates oversized dynamic context lines', () => {
    const longText = '局势内容'.repeat(SITUATION_PROJECTION_BUDGET.maxLineChars);
    const currentMatters = Array.from({ length: SITUATION_PROJECTION_BUDGET.currentMatters + 2 }, (_, index) => ({
      id: `quest_${index}`,
      title: `事项 ${index}`,
      description: longText,
      status: 'active',
      priority: 'high',
      currentStep: longText,
      stakes: longText,
      createdAt: '乱世元年2月',
      updatedAt: '乱世元年2月',
    })) as Quest[];
    const signals = [
      {
        id: 'signal_long',
        title: '过长风声',
        content: longText,
        source: '市井传闻',
        signalType: 'rumor',
        confidence: 'medium',
        verified: false,
        createdAt: '乱世元年2月',
      },
    ] as Rumor[];
    const chronicles = [
      {
        trendId: 'trend_long',
        title: '过长纪事',
        summary: longText,
        knownToPlayer: true,
        severity: '高',
        updatedAt: '乱世元年2月',
      },
    ] as WorldTrendEntry[];
    const plotPlans = [
      {
        plotId: 'plot_long',
        title: '过长暗线',
        horizon: '中期',
        status: '进行中',
        priority: '高',
        description: longText,
      },
    ] as PlotPlanEntry[];
    const remoteNpcBeats = [
      {
        beatId: 'beat_long',
        awarenessId: 'aware_long',
        name: '远方人物',
        beatType: 'letter',
        triggerReason: longText,
        suggestedDelivery: '书信',
        relevanceSummary: longText,
        urgency: 'medium',
        sourceIds: ['trend_long'],
      },
    ] as RemoteNpcPresenceBeat[];

    const projection = buildSituationProjection({
      currentMatters,
      signals,
      chronicles,
      plotPlans,
      remoteNpcBeats,
    });

    expect(projection.sourceCounts.currentMatters).toBe(SITUATION_PROJECTION_BUDGET.currentMatters + 2);
    expect(projection.projectedCounts.currentMatters).toBe(SITUATION_PROJECTION_BUDGET.currentMatters);
    expect(projection.omittedCounts.currentMatters).toBe(2);
    expect(projection.truncatedCounts.currentMatters).toBeGreaterThan(0);
    expect(projection.truncatedCounts.signals).toBe(1);
    expect(projection.truncatedCounts.chronicles).toBe(1);
    expect(projection.truncatedCounts.plotPlans).toBe(1);
    expect(projection.truncatedCounts.remoteNpcBeats).toBe(1);
    expect(projection.text).not.toContain(longText);
    expect(projection.text).toContain('截断');
    expect(projection.sections.map((section) => section.id)).toEqual([
      'currentMatters',
      'signals',
      'chronicles',
      'plotPlans',
      'remoteNpcBeats',
    ]);
    expect(projection.sections.find((section) => section.id === 'currentMatters')?.text).toContain('Current Matters');
  });

  it('includes stable ids for dynamic writeback updates', () => {
    const projection = buildSituationProjection({
      currentMatters: [
        {
          id: 'quest_rescue_grain',
          title: '夺回粮草',
          description: '处理粮草危机。',
          status: 'active',
          createdAt: '公元189年09月01日 10:00',
          updatedAt: '公元189年09月01日 10:00',
        } as Quest,
      ],
      signals: [
        {
          id: 'signal_xiliang_grain',
          title: '西凉军夺粮',
          content: '西凉军正在抢夺商贾粮草。',
          source: '商旅',
          status: 'open',
          verified: false,
          createdAt: '公元189年09月01日 10:00',
        } as Rumor,
      ],
      chronicles: [
        {
          trendId: 'trend_luoyang_shortage',
          title: '洛阳粮荒',
          summary: '洛阳城粮价上涨。',
          knownToPlayer: true,
          severity: '中',
          status: 'active',
          updatedAt: '公元189年09月01日 10:00',
        } as WorldTrendEntry,
      ],
      plotPlans: [],
      remoteNpcBeats: [],
    });

    expect(projection.text).toContain('questId=quest_rescue_grain');
    expect(projection.text).toContain('rumorId=signal_xiliang_grain');
    expect(projection.text).toContain('trendId=trend_luoyang_shortage');
  });

  it('keeps worldline knowledge hints in a separate projection section', () => {
    const projection = buildSituationProjection({
      currentMatters: [],
      signals: [],
      chronicles: [],
      plotPlans: [],
      remoteNpcBeats: [],
      worldlineHints: [
        {
          id: 'tk_caocao_early',
          historicalAnchorId: 'tk_manifest_caocao_early',
          sourceType: 'knowledgeBase',
          title: '曹操早期惯性',
          text: '曹操此时尚未天然拥有后期全部班底。边界：不要默认夏侯惇、曹洪已经稳定成为曹操部下。',
          importance: 'major',
          strictness: 'default',
          reason: 'npc=曹操',
        },
      ] as WorldlineProjectionHint[],
    });

    expect(projection.sourceCounts.worldlineHints).toBe(1);
    expect(projection.projectedCounts.worldlineHints).toBe(1);
    expect(projection.sections.map((section) => section.id)).toEqual(['worldlineHints']);
    expect(projection.text).toContain('Worldline Knowledge');
    expect(projection.text).toContain('hintId=tk_manifest_caocao_early');
    expect(projection.text).toContain('cardId=tk_caocao_early');
    expect(projection.text).toContain('不要默认夏侯惇');
  });
});
