import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { buildDynamicPanelModel } from './dynamicPanelModel';
import { readUiStyleSource } from './readUiStyleSource.test-helper';

function makeState(): RuntimeState {
  return {
    engineVersion: '0.1.0',
    worldBookId: 'test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '乱世元年2月',
    currentDate: '乱世元年2月',
    player: {
      id: 'player',
      name: '主角',
      roleType: '流民',
      summary: '流落市镇。',
    },
    currentLocationId: 'loc_market_town',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [
      {
        id: 'quest_rescue',
        title: '护送伤者离开市镇',
        description: '陈衡托主角把伤者送到安全处。',
        status: 'active',
        source: '陈衡所托',
        currentStep: '寻找北门小路。',
        stakes: '拖延太久会被追兵堵住。',
        deadlineAt: '乱世元年2月夜前',
        priority: 'high',
        outcomeSummary: '救援承诺已经让本地巡兵开始封锁北门。',
        consequenceTags: ['巡兵注意', '路线变化'],
        affectedNpcIds: ['npc_chen_heng'],
        affectedFactionIds: ['faction_local_patrol'],
        affectedPlaceIds: ['loc_market_town'],
        affectedForceIds: ['force_patrol_unit'],
        affectedHoldingIds: ['holding_market_gate'],
        followUpHooks: ['陈衡可能提供另一条路'],
        severity: 'moderate',
        relatedNpcIds: ['npc_chen_heng'],
        relatedLocationIds: ['loc_market_town'],
        createdAt: '乱世元年2月',
        updatedAt: '乱世元年2月',
      },
      {
        id: 'quest_done',
        title: '完成旧事',
        description: '已经处理完。',
        status: 'completed',
        createdAt: '乱世元年1月',
        updatedAt: '乱世元年2月',
      },
    ],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
  };
}

describe('buildDynamicPanelModel', () => {
  it('builds current matter cards from active quests', () => {
    const model = buildDynamicPanelModel(makeState());

    expect(model.currentMatterCount).toBe(2);
    expect(model.activeMatterCount).toBe(1);
    expect(model.itemsByStage.urgent.currentMatters[0]).toMatchObject({
      id: 'quest_rescue',
      title: '护送伤者离开市镇',
      statusLabel: '进行中',
      priorityLabel: '高',
      outcomeSummary: '救援承诺已经让本地巡兵开始封锁北门。',
      consequenceTags: ['巡兵注意', '路线变化'],
      affectedNpcIds: ['npc_chen_heng'],
      affectedFactionIds: ['faction_local_patrol'],
      affectedPlaceIds: ['loc_market_town'],
      affectedForceIds: ['force_patrol_unit'],
      affectedHoldingIds: ['holding_market_gate'],
      followUpHooks: ['陈衡可能提供另一条路'],
      severityLabel: '中',
      source: '陈衡所托',
      currentStep: '寻找北门小路。',
      stakes: '拖延太久会被追兵堵住。',
      deadlineAt: '乱世元年2月夜前',
    });
  });

  it('replaces internal consequence tag identifiers with player-facing labels', () => {
    const state = makeState();
    state.activeQuests[0].consequenceTags = [
      'faction:fancheng_zhao_deterred',
      'resource:population_secured',
      '需要复核',
    ];
    state.knownRumors = [{
      id: 'signal_flank',
      title: '侧翼异动',
      content: '斥候发现侧翼有异动。',
      source: '斥候回报',
      consequenceTags: ['threat:flank_exposed', 'faction:xiangyang_rebels'],
      verified: true,
      createdAt: '乱世元年2月',
    }];

    const model = buildDynamicPanelModel(state);

    expect(model.itemsByStage.urgent.currentMatters[0].consequenceTags).toEqual([
      '势力影响',
      '资源变化',
      '需要复核',
    ]);
    expect(model.itemsByStage.verified.signals[0].consequenceTags).toEqual([
      '威胁变化',
      '势力影响',
    ]);
  });

  it('keeps the dynamic panel shell ready for later signal and chronicle tabs', () => {
    const model = buildDynamicPanelModel(makeState());

    expect(model.tabs.map((tab) => tab.label)).toEqual(['当前事项', '风声线索', '纪事', '暗流']);
    expect(model.tabs[0]).toMatchObject({ key: 'currentMatters', enabled: true });
    expect(model.tabs[1]).toMatchObject({ key: 'signals', enabled: false });
    expect(model.tabs[2]).toMatchObject({ key: 'chronicles', enabled: false });
    expect(model.tabs[3]).toMatchObject({ key: 'undercurrents', enabled: false });
  });

  it('sorts situation facts into the four player-facing scan stages without mixing responsibilities', () => {
    const state = {
      ...makeState(),
      activeQuests: [
        ...(makeState().activeQuests ?? []),
        {
          id: 'quest_archived',
          title: '旧事项',
          description: '已经归档的事项。',
          status: 'archived',
          createdAt: 'day 1',
          updatedAt: 'day 2',
          archivedAt: 'day 2',
        },
      ],
      knownRumors: [
        {
          id: 'signal_open',
          title: '可追查风声',
          content: '仍可追查。',
          source: '市井',
          status: 'open',
          verified: false,
          createdAt: 'day 1',
        },
        {
          id: 'signal_verified',
          title: '已核实风声',
          content: '已经由斥候核实。',
          source: '斥候',
          status: 'verified',
          verified: true,
          createdAt: 'day 1',
        },
        {
          id: 'signal_expired',
          title: '过期风声',
          content: '已经过期。',
          source: '市井',
          status: 'expired',
          verified: false,
          createdAt: 'day 1',
        },
      ],
      worldTrends: [
        {
          trendId: 'trend_active',
          title: '仍在发酵的纪事',
          summary: '局势仍在发酵。',
          knownToPlayer: true,
          severity: '高',
          status: 'active',
          scope: 'regional',
          affectedFactionIds: ['faction_a'],
          progressSummary: '两方仍在调兵。',
          nextCheckAt: 'day 2',
          happenedAt: 'day 1',
          updatedAt: 'day 1',
        },
        {
          trendId: 'trend_confirmed',
          title: '已经确认的纪事',
          summary: '消息来源和结果均已核准。',
          knownToPlayer: true,
          severity: '高',
          certainty: 'confirmed',
          status: 'cooling',
          scope: 'regional',
          sourceConflictIds: ['conflict_a'],
          progressSummary: '战后秩序仍在恢复。',
          nextCheckAt: 'day 3',
          happenedAt: 'day 1',
          updatedAt: 'day 2',
        },
        {
          trendId: 'trend_history',
          title: '已归档纪事',
          summary: '已经沉淀为历史记录。',
          knownToPlayer: true,
          severity: '高',
          status: 'historical',
          scope: 'realm',
          affectedFactionIds: ['faction_court'],
          outcomeSummary: '事件已经结束。',
          happenedAt: 'day 1',
          updatedAt: 'day 2',
        },
      ],
      localSituationNotes: ['市镇外仍有不明人马窥探。'],
    } as RuntimeState;

    const model = buildDynamicPanelModel(state);

    expect(model.stageTabs).toEqual([
      { key: 'urgent', label: '当前必须处理', count: 1, enabled: true },
      { key: 'developing', label: '正在发展', count: 3, enabled: true },
      { key: 'verified', label: '已验证信息', count: 2, enabled: true },
      { key: 'history', label: '历史记录', count: 4, enabled: true },
    ]);
    expect(model.itemsByStage.urgent.currentMatters.map((matter) => matter.id)).toEqual(['quest_rescue']);
    expect(model.itemsByStage.developing.signals.map((signal) => signal.id)).toEqual(['signal_open']);
    expect(model.itemsByStage.developing.chronicles.map((chronicle) => chronicle.id)).toEqual(['trend_active']);
    expect(model.itemsByStage.developing.undercurrents.map((item) => item.content)).toEqual(['市镇外仍有不明人马窥探。']);
    expect(model.itemsByStage.verified.signals.map((signal) => signal.id)).toEqual(['signal_verified']);
    expect(model.itemsByStage.verified.chronicles.map((chronicle) => chronicle.id)).toEqual(['trend_confirmed']);
    expect(model.itemsByStage.history.currentMatters.map((matter) => matter.id)).toEqual(['quest_done', 'quest_archived']);
    expect(model.itemsByStage.history.signals.map((signal) => signal.id)).toEqual(['signal_expired']);
    expect(model.itemsByStage.history.chronicles.map((chronicle) => chronicle.id)).toEqual(['trend_history']);
  });

  it('uses situation wording in the GameScreen dynamic panel labels', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');

    expect(source).toContain('局势');
    expect(source).toContain('纪事');
    expect(source).not.toContain('天下动态');
    expect(source).not.toContain('天下纪事');
  });

  it('renders the situation panel as a stable categorized workspace with four scan stages', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');
    const css = await readUiStyleSource();

    expect(source).toContain('activeDynamicStage');
    expect(source).toContain('activeDynamicTab');
    expect(source).toContain('dynamic-panel-layout');
    expect(source).toContain('dynamic-sidebar');
    expect(source).toContain('dynamic-stage-tabs');
    expect(source).toContain('暗流');
    expect(css).toContain('.dynamic-panel-modal');
    expect(css).toContain('width: min(1280px, 94vw)');
    expect(css).toContain('height: min(820px, 86vh)');
  });

  it('builds signal cards from known rumors with consequence anchors', () => {
    const state = {
      ...makeState(),
      knownRumors: [
        {
          id: 'signal_north_gate',
          title: 'North gate closure',
          content: 'Patrols may close the north gate before nightfall.',
          source: 'market caravan',
          signalType: 'rumor',
          confidence: 'medium',
          potentialOutcomeSummary: 'If true, the escort route through the north gate becomes dangerous.',
          consequenceTags: ['route-risk', 'patrol-movement'],
          affectedNpcIds: ['npc_chen_heng'],
          affectedFactionIds: ['faction_local_patrol'],
          affectedPlaceIds: ['loc_market_town'],
          affectedForceIds: ['force_patrol_unit'],
          affectedHoldingIds: ['holding_market_gate'],
          followUpHooks: ['verify north gate guards'],
          severity: 'moderate',
          relatedLocationIds: ['loc_market_town'],
          threadId: 'thread_market_rescue',
          expiresAt: 'before nightfall',
          verified: false,
          createdAt: 'chaos year 1 month 2',
        },
      ],
    } as RuntimeState;

    const model = buildDynamicPanelModel(state) as any;

    expect(model.signalCount).toBe(1);
    expect(model.tabs[1]).toMatchObject({ key: 'signals', enabled: true, count: 1 });
    expect(model.itemsByStage.developing.signals[0]).toMatchObject({
      id: 'signal_north_gate',
      title: 'North gate closure',
      signalTypeLabel: '传闻',
      confidenceLabel: '中',
      potentialOutcomeSummary: 'If true, the escort route through the north gate becomes dangerous.',
      consequenceTags: ['route-risk', 'patrol-movement'],
      affectedNpcIds: ['npc_chen_heng'],
      affectedFactionIds: ['faction_local_patrol'],
      affectedPlaceIds: ['loc_market_town'],
      affectedForceIds: ['force_patrol_unit'],
      affectedHoldingIds: ['holding_market_gate'],
      followUpHooks: ['verify north gate guards'],
      severityLabel: '中',
      expiresAt: 'before nightfall',
    });
  });

  it('builds chronicle cards from known world trends with consequence anchors', () => {
    const state = {
      ...makeState(),
      worldTrends: [
        {
          trendId: 'trend_gate_lockdown',
          title: 'Capital gate lockdown',
          severity: 'high',
          summary: 'The capital gates are locked down after a palace order.',
          knownToPlayer: true,
          scope: 'regional',
          certainty: 'confirmed',
          status: 'cooling',
          visibility: '公开',
          locationId: 'loc_market_town',
          affectedNpcIds: ['npc_courier'],
          affectedFactionIds: ['faction_guard'],
          affectedPlaceIds: ['loc_market_town'],
          affectedForceIds: ['force_gate_guard'],
          affectedHoldingIds: ['holding_gate'],
          consequenceTags: ['gate-lockdown'],
          outcomeSummary: 'Travel through the gate now requires official permission.',
          progressSummary: 'Gate restrictions remain in force.',
          nextCheckAt: 'day 2',
          followUpHooks: ['find who signed the order'],
          sourceQuestIds: ['quest_gate'],
          sourceSignalIds: ['signal_gate'],
          sourceConflictIds: ['battle_gate'],
          threadId: 'thread_gate_lockdown',
          happenedAt: 'day 1 morning',
          learnedAt: 'day 1',
          updatedAt: 'day 1',
          source: 'courier report',
        },
      ],
    } as any as RuntimeState;

    const model = buildDynamicPanelModel(state) as any;

    expect(model.chronicleCount).toBe(1);
    expect(model.tabs[2]).toMatchObject({ key: 'chronicles', enabled: true, count: 1 });
    expect(model.itemsByStage.verified.chronicles[0]).toMatchObject({
      id: 'trend_gate_lockdown',
      title: 'Capital gate lockdown',
      summary: 'The capital gates are locked down after a palace order.',
      outcomeSummary: 'Travel through the gate now requires official permission.',
      consequenceTags: ['gate-lockdown'],
      affectedNpcIds: ['npc_courier'],
      affectedFactionIds: ['faction_guard'],
      affectedPlaceIds: ['loc_market_town'],
      affectedForceIds: ['force_gate_guard'],
      affectedHoldingIds: ['holding_gate'],
      followUpHooks: ['find who signed the order'],
      sourceQuestIds: ['quest_gate'],
      sourceSignalIds: ['signal_gate'],
      sourceConflictIds: ['battle_gate'],
      happenedAt: 'day 1 morning',
      learnedAt: 'day 1',
      source: 'courier report',
    });
  });

  it('hides legacy local activity from chronicles and derives completed one-off events into history', () => {
    const state = {
      ...makeState(),
      worldTrends: [
        {
          trendId: 'event_local_training',
          title: 'Local training',
          severity: '中',
          summary: 'The player drilled a squad.',
          knownToPlayer: true,
          status: 'active',
          scope: 'local',
          happenedAt: 'day 2',
          updatedAt: 'day 2',
        },
        {
          trendId: 'event_regional_battle',
          title: 'Regional battle',
          severity: '高',
          summary: 'Two armies fought for the river crossing.',
          knownToPlayer: true,
          status: 'active',
          scope: 'regional',
          certainty: 'confirmed',
          sourceConflictIds: ['conflict_river'],
          outcomeSummary: 'The attacking army seized the crossing.',
          happenedAt: 'day 2',
          updatedAt: 'day 2',
        },
      ],
    } as RuntimeState;

    const model = buildDynamicPanelModel(state);

    expect(model.chronicleCount).toBe(1);
    expect(model.itemsByStage.history.chronicles.map((chronicle) => chronicle.id)).toEqual([
      'event_regional_battle',
    ]);
  });
});
