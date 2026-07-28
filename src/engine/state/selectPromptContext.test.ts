import { describe, expect, it } from 'vitest';
import type {
  RuntimeState,
  WorldlineKnowledgeBase,
  WorldlineStoryPack,
} from '../types';
import {
  clearWorldlineKnowledgeRegistryForTest,
  registerWorldlineKnowledgeBase,
  registerWorldlineStoryPack,
} from '../worldline/WorldlineKnowledgeRegistry';
import { ensureLuanShiState } from './createInitialRuntimeState';
import { selectPromptContext } from './selectPromptContext';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-chaos-world',
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
        title: '护送伤者',
        description: '把伤者送到安全处。',
        status: 'active',
        createdAt: '乱世元年2月',
        updatedAt: '乱世元年2月',
      },
    ],
    playerResources: { 钱: 30 },
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: ['市镇门前聚集了流民。'],
    locations: [
      {
        locationId: 'loc_market_town',
        name: '市镇',
        type: '聚落',
        summary: '道路交汇处的小市镇。',
        knownLevel: '亲历',
        recentEvents: ['流民增多'],
      },
    ],
    npcs: [
      {
        npcId: 'npc_chen_heng',
        name: '陈衡',
        sex: '男',
        age: 30,
        role: '游侠首领',
        locationId: 'loc_market_town',
        isPresent: true,
        isFocused: false,
        summary: '机警过人。',
        appearance: '目光锐利。',
        personality: '豪爽直接。',
        motivation: '寻找机会。',
        relationToPlayer: '刚刚见过主角救人。',
        contactLevel: 12,
        recentAttitude: '好奇',
        memories: [
          {
            memoryId: 'mem_chen_1',
            eventId: 'evt_recent_3',
            source: '亲历',
            content: '陈衡亲眼见到主角救下伤者。',
            createdAt: '乱世元年2月',
          },
        ],
      },
      {
        npcId: 'npc_li_su',
        name: '李肃',
        sex: '男',
        age: 31,
        role: '地方士人',
        locationId: 'loc_capital',
        isPresent: false,
        isFocused: true,
        summary: '地方名士之后。',
        appearance: '仪表堂堂。',
        personality: '矜持自重。',
        motivation: '维持家声。',
        relationToPlayer: '虽不在场，但与当前承诺有关。',
        contactLevel: 5,
        recentAttitude: '观望',
        memories: [
          {
            memoryId: 'mem_li_1',
            source: '听闻',
            content: '李肃听说主角正在护送伤者。',
            createdAt: '乱世元年2月',
          },
        ],
      },
      {
        npcId: 'npc_far',
        name: '远处人物',
        sex: '男',
        age: 40,
        role: '远方商人',
        locationId: 'loc_far',
        isPresent: false,
        isFocused: false,
        summary: '与当前回合无关。',
        appearance: '普通。',
        personality: '谨慎。',
        motivation: '经商。',
        relationToPlayer: '无交集。',
        contactLevel: 0,
        recentAttitude: '陌生',
        memories: [
          {
            memoryId: 'mem_far_1',
            source: '听闻',
            content: '这条远方记忆不应进入当前 prompt。',
            createdAt: '乱世元年2月',
          },
        ],
      },
    ],
    turnEvents: [
      {
        eventId: 'evt_old',
        happenedAt: '乱世元年1月',
        locationId: 'loc_old',
        summary: '很久以前的旧事。',
        presentNpcIds: [],
        involvedNpcIds: [],
        visibility: '公开',
      },
      {
        eventId: 'evt_recent_1',
        happenedAt: '乱世元年2月',
        locationId: 'loc_market_town',
        summary: '市镇门口起了争执。',
        presentNpcIds: [],
        involvedNpcIds: [],
        visibility: '公开',
      },
      {
        eventId: 'evt_recent_2',
        happenedAt: '乱世元年2月',
        locationId: 'loc_market_town',
        summary: '伤者倒在路边。',
        presentNpcIds: [],
        involvedNpcIds: [],
        visibility: '在场可知',
      },
      {
        eventId: 'evt_recent_3',
        happenedAt: '乱世元年2月',
        locationId: 'loc_market_town',
        summary: '主角救下伤者。',
        presentNpcIds: ['npc_chen_heng'],
        involvedNpcIds: ['npc_chen_heng'],
        visibility: '在场可知',
      },
    ],
  });
}

describe('selectPromptContext', () => {
  it('选择当前地点、在场/关注 NPC、相关记忆和近期事件', () => {
    const slice = selectPromptContext(makeState());

    expect(slice.currentLocation?.name).toBe('市镇');
    expect(slice.presentNpcs.map((npc) => npc.name)).toEqual(['陈衡']);
    expect(slice.focusedNpcs.map((npc) => npc.name)).toEqual(['李肃']);
    expect(slice.relevantNpcMemories.map((memory) => memory.content)).toEqual([
      '陈衡亲眼见到主角救下伤者。',
      '李肃听说主角正在护送伤者。',
    ]);
    expect(slice.recentTurnEvents.map((event) => event.eventId)).toEqual([
      'evt_recent_1',
      'evt_recent_2',
      'evt_recent_3',
    ]);
    expect(slice.activeQuests.map((quest) => quest.title)).toEqual(['护送伤者']);
    expect(slice.localSituationNotes).toEqual(['市镇门前聚集了流民。']);
    expect(slice.resources.money).toBe(0);
    expect(slice.playerResources).toEqual({ 钱: 30 });
  });

  it('treats a location-mismatched stale present flag as focused rather than present', () => {
    const state = makeState();
    const staleNpc = state.npcs!.find((npc) => npc.npcId === 'npc_li_su')!;
    staleNpc.isPresent = true;

    const slice = selectPromptContext(state);

    expect(slice.presentNpcs.map((npc) => npc.npcId)).not.toContain('npc_li_su');
    expect(slice.focusedNpcs.map((npc) => npc.npcId)).toContain('npc_li_su');
  });

  it('selects only current relevant matters for prompt projection', () => {
    const state = {
      ...makeState(),
      activeQuests: [
        {
          id: 'quest_local',
          title: '护送伤者',
          description: '把伤者送出市镇。',
          status: 'active',
          currentStep: '寻找北门小路。',
          relatedLocationIds: ['loc_market_town'],
          priority: 'medium',
          createdAt: '乱世元年2月',
          updatedAt: '乱世元年2月',
        },
        {
          id: 'quest_npc',
          title: '向陈衡回报',
          description: '陈衡在场，适合当面确认。',
          status: 'active',
          relatedNpcIds: ['npc_chen_heng'],
          priority: 'medium',
          createdAt: '乱世元年2月',
          updatedAt: '乱世元年2月',
        },
        {
          id: 'quest_high',
          title: '天亮前离城',
          description: '即将过期的高风险事项。',
          status: 'active',
          priority: 'high',
          deadlineAt: '乱世元年2月天亮前',
          createdAt: '乱世元年2月',
          updatedAt: '乱世元年2月',
        },
        {
          id: 'quest_far',
          title: '远方旧事',
          description: '暂时不相关。',
          status: 'active',
          relatedLocationIds: ['loc_far'],
          priority: 'low',
          createdAt: '乱世元年2月',
          updatedAt: '乱世元年2月',
        },
      ],
    } as RuntimeState;

    const slice = selectPromptContext(state);

    expect(slice.relevantCurrentQuests.map((quest) => quest.title)).toEqual([
      '护送伤者',
      '向陈衡回报',
      '天亮前离城',
    ]);
  });

  it('按 NPC 分块生成限量记忆投影，保留完整本地记忆但只选择近期相关部分', () => {
    const state = makeState();
    const projectedState = {
      ...state,
      npcs: (state.npcs ?? []).map((npc) =>
        npc.npcId === 'npc_chen_heng'
          ? {
              ...npc,
              isFocused: true,
              memories: [
                { memoryId: 'mem_chen_1', source: '亲历', content: '陈衡第1条旧记忆。', createdAt: '乱世元年2月01日' },
                { memoryId: 'mem_chen_2', source: '亲历', content: '陈衡第2条近期记忆。', createdAt: '乱世元年2月02日' },
                { memoryId: 'mem_chen_3', source: '亲历', content: '陈衡第3条近期记忆。', createdAt: '乱世元年2月03日' },
                { memoryId: 'mem_chen_4', source: '亲历', content: '陈衡第4条近期记忆。', createdAt: '乱世元年2月04日' },
                { memoryId: 'mem_chen_5', source: '亲历', content: '陈衡第5条近期记忆。', createdAt: '乱世元年2月05日' },
                { memoryId: 'mem_chen_6', source: '亲历', content: '陈衡第6条最新记忆。', createdAt: '乱世元年2月06日' },
              ],
            }
          : npc,
      ),
    } as RuntimeState;

    const slice = selectPromptContext(projectedState);
    const memoryBlocks = (slice as any).npcMemoryBlocks;

    expect(memoryBlocks).toHaveLength(2);
    expect(memoryBlocks[0]).toMatchObject({
      npcId: 'npc_chen_heng',
      npcName: '陈衡',
      scope: 'present',
      importance: 'important',
      totalMemoryCount: 6,
      omittedMemoryCount: 0,
    });
    expect(memoryBlocks[0].memories.map((memory: { content: string }) => memory.content)).toEqual([
      '陈衡第1条旧记忆。',
      '陈衡第2条近期记忆。',
      '陈衡第3条近期记忆。',
      '陈衡第4条近期记忆。',
      '陈衡第5条近期记忆。',
      '陈衡第6条最新记忆。',
    ]);
    expect(memoryBlocks[1]).toMatchObject({
      npcId: 'npc_li_su',
      npcName: '李肃',
      scope: 'focused',
      importance: 'important',
      totalMemoryCount: 1,
      omittedMemoryCount: 0,
    });
  });

  it('selects only relevant signals for prompt projection', () => {
    const state = {
      ...makeState(),
      knownRumors: [
        {
          id: 'signal_local',
          title: 'North gate closure',
          content: 'Patrols may close the north gate before nightfall.',
          source: 'market caravan',
          signalType: 'rumor',
          confidence: 'medium',
          potentialOutcomeSummary: 'The escort route may become unsafe.',
          severity: 'moderate',
          relatedLocationIds: ['loc_market_town'],
          verified: false,
          createdAt: 'chaos year 1 month 2',
        },
        {
          id: 'signal_npc',
          content: 'Someone is asking about Chen Heng.',
          source: 'street runner',
          signalType: 'clue',
          confidence: 'low',
          affectedNpcIds: ['npc_chen_heng'],
          verified: false,
          createdAt: 'chaos year 1 month 2',
        },
        {
          id: 'signal_major',
          content: 'A remote army movement may soon affect the whole region.',
          source: 'relay report',
          signalType: 'report',
          confidence: 'high',
          severity: 'major',
          relatedLocationIds: ['loc_far'],
          verified: false,
          createdAt: 'chaos year 1 month 2',
        },
        {
          id: 'signal_far_low',
          content: 'A distant tea road rumor should not enter this prompt.',
          source: 'far trader',
          signalType: 'rumor',
          confidence: 'low',
          relatedLocationIds: ['loc_far'],
          severity: 'minor',
          verified: false,
          createdAt: 'chaos year 1 month 2',
        },
      ],
    } as RuntimeState;

    const slice = selectPromptContext(state) as any;

    expect(slice.relevantSignals.map((signal: { id: string }) => signal.id)).toEqual([
      'signal_local',
      'signal_npc',
      'signal_major',
    ]);
  });

  it('selects only relevant known world chronicles for prompt projection', () => {
    const state = {
      ...makeState(),
      worldTrends: [
        {
          trendId: 'trend_local',
          title: 'Local gate lockdown',
          severity: 'medium',
          summary: 'The market town gate is under lockdown.',
          knownToPlayer: true,
          locationId: 'loc_market_town',
          updatedAt: 'chaos year 1 month 2',
        },
        {
          trendId: 'trend_private',
          title: 'Hidden court order',
          severity: 'critical',
          summary: 'A hidden order should not be projected before the player can know it.',
          knownToPlayer: false,
          updatedAt: 'chaos year 1 month 2',
        },
        {
          trendId: 'trend_npc',
          title: 'Chen Heng implicated',
          severity: 'low',
          summary: 'Chen Heng was named in a patrol report.',
          knownToPlayer: true,
          relatedNpcIds: ['npc_chen_heng'],
          updatedAt: 'chaos year 1 month 2',
        },
        {
          trendId: 'trend_realm',
          title: 'Regional army movement',
          severity: 'high',
          summary: 'A remote army movement may affect the whole region.',
          knownToPlayer: true,
          scope: 'realm',
          affectedFactionIds: ['faction_regional_army'],
          progressSummary: 'The regional army remains on the move.',
          nextCheckAt: 'chaos year 1 month 3',
          updatedAt: 'chaos year 1 month 2',
        },
        {
          trendId: 'trend_far_low',
          title: 'Distant tea road toll',
          severity: 'low',
          summary: 'A low-impact faraway toll should not enter this prompt.',
          knownToPlayer: true,
          locationId: 'loc_far',
          updatedAt: 'chaos year 1 month 2',
        },
      ],
    } as any as RuntimeState;

    const slice = selectPromptContext(state) as any;

    expect(slice.relevantWorldTrends.map((trend: { trendId: string }) => trend.trendId)).toEqual([
      'trend_local',
      'trend_npc',
      'trend_realm',
    ]);
  });

  it('excludes archived lifecycle entries from the default situation projection', () => {
    const state = {
      ...makeState(),
      activeQuests: [
        {
          id: 'quest_active',
          title: 'Active matter',
          description: 'Still needs attention.',
          status: 'active',
          priority: 'high',
          createdAt: 'chaos year 1 month 2',
          updatedAt: 'chaos year 1 month 2',
        },
        {
          id: 'quest_archived',
          title: 'Archived matter',
          description: 'Already backgrounded.',
          status: 'archived',
          priority: 'high',
          createdAt: 'chaos year 1 month 1',
          updatedAt: 'chaos year 1 month 2',
        },
      ],
      knownRumors: [
        {
          id: 'signal_open',
          content: 'The open signal still matters.',
          source: 'runner',
          status: 'open',
          severity: 'major',
          verified: false,
          createdAt: 'chaos year 1 month 2',
        },
        {
          id: 'signal_archived',
          content: 'The archived signal should not be projected by default.',
          source: 'runner',
          status: 'archived',
          severity: 'major',
          verified: false,
          createdAt: 'chaos year 1 month 1',
        },
      ],
      worldTrends: [
        {
          trendId: 'trend_active',
          title: 'Active trend',
          severity: 'high',
          summary: 'Still shaping the current situation.',
          knownToPlayer: true,
          status: 'active',
          scope: 'regional',
          affectedFactionIds: ['faction_guard'],
          progressSummary: 'The lockdown remains in force.',
          nextCheckAt: 'chaos year 1 month 3',
          happenedAt: 'chaos year 1 month 2',
          updatedAt: 'chaos year 1 month 2',
        },
        {
          trendId: 'trend_historical',
          title: 'Historical trend',
          severity: 'high',
          summary: 'Important history, but not default current context.',
          knownToPlayer: true,
          status: 'historical',
          updatedAt: 'chaos year 1 month 1',
        },
      ],
    } as any as RuntimeState;

    const slice = selectPromptContext(state) as any;

    expect(slice.relevantCurrentQuests.map((quest: { id: string }) => quest.id)).toEqual(['quest_active']);
    expect(slice.resolvedCurrentMatters.map((quest: { id: string }) => quest.id)).toEqual(['quest_archived']);
    expect(slice.relevantSignals.map((signal: { id: string }) => signal.id)).toEqual(['signal_open']);
    expect(slice.relevantWorldTrends.map((trend: { trendId: string }) => trend.trendId)).toEqual(['trend_active']);
  });

  it('projects a completed matter linked to a present NPC without pulling unrelated terminal history', () => {
    const state = {
      ...makeState(),
      activeQuests: [
        {
          id: 'quest_horse_feed_delivered',
          title: '战马精料危机',
          description: '蔡家筹运三船豆饼精料。',
          status: 'completed',
          relatedNpcIds: ['npc_chen_heng'],
          outcomeSummary: '三船精料已经到港入库，骑兵补给恢复充足。',
          archivedAt: '乱世元年1月20日',
          createdAt: '乱世元年1月10日',
          updatedAt: '乱世元年1月20日',
        },
        {
          id: 'quest_unrelated_terminal',
          title: '远方旧案',
          description: '与当前人物和地点均无关。',
          status: 'completed',
          relatedNpcIds: ['npc_far_away'],
          relatedLocationIds: ['loc_far_away'],
          outcomeSummary: '旧案已经了结。',
          archivedAt: '乱世元年1月21日',
          createdAt: '乱世元年1月11日',
          updatedAt: '乱世元年1月21日',
        },
      ],
    } as any as RuntimeState;

    const slice = selectPromptContext(state);

    expect(slice.resolvedCurrentMatters.map((quest) => quest.id)).toEqual(['quest_horse_feed_delivered']);
  });

  it('builds a compact situation projection from relevant dynamic systems without losing raw selections', () => {
    const state = {
      ...makeState(),
      activeQuests: [
        {
          id: 'quest_active',
          title: 'Escort the wounded',
          description: 'Move the wounded out of the market town.',
          status: 'active',
          currentStep: 'Find the north gate path.',
          priority: 'high',
          createdAt: 'chaos year 1 month 2',
          updatedAt: 'chaos year 1 month 2',
        },
      ],
      knownRumors: [
        {
          id: 'signal_gate',
          title: 'North gate closure',
          content: 'Patrols may close the north gate before nightfall.',
          source: 'market caravan',
          status: 'open',
          confidence: 'medium',
          severity: 'major',
          verified: false,
          createdAt: 'chaos year 1 month 2',
        },
      ],
      worldTrends: [
        {
          trendId: 'trend_lockdown',
          title: 'Capital gate lockdown',
          severity: 'high',
          summary: 'The capital gates are locked down after a palace order.',
          knownToPlayer: true,
          status: 'active',
          scope: 'regional',
          sourceConflictIds: ['conflict_gate'],
          progressSummary: 'The gate remains closed.',
          nextCheckAt: 'chaos year 1 month 3',
          happenedAt: 'chaos year 1 month 2',
          updatedAt: 'chaos year 1 month 2',
        },
      ],
      plotPlan: [
        {
          plotId: 'plot_delayed_pressure',
          title: 'Delayed pressure',
          horizon: '中期',
          status: '进行中',
          priority: '高',
          description: 'A hidden pressure exists but should not resolve yet.',
          notBeforeAt: '0189-09-20 08:00',
        },
      ],
      npcAwarenessIndex: [
        {
          awarenessId: 'aware_remote',
          name: 'Remote ally',
          sourceType: 'rumor',
          sourceIds: ['signal_gate'],
          contactLevel: 2,
          playerRelevance: ['old promise'],
          unresolvedHooks: ['may send a letter'],
          knownToPlayer: true,
          archiveVisible: false,
          updatedAt: 'chaos year 1 month 2',
        },
      ],
    } as any as RuntimeState;

    const slice = selectPromptContext(state) as any;

    expect(slice.relevantCurrentQuests).toHaveLength(1);
    expect(slice.relevantSignals).toHaveLength(1);
    expect(slice.relevantWorldTrends).toHaveLength(1);
    expect(slice.situationProjection.sourceCounts).toMatchObject({
      currentMatters: 1,
      signals: 1,
      chronicles: 1,
      plotPlans: 1,
      remoteNpcBeats: 1,
    });
    expect(slice.situationProjection.text).toContain('Situation Projection');
    expect(slice.situationProjection.text).toContain('Escort the wounded');
    expect(slice.situationProjection.text).toContain('North gate closure');
    expect(slice.situationProjection.text).toContain('Capital gate lockdown');
    expect(slice.situationProjection.text).toContain('Delayed pressure');
    expect(slice.situationProjection.text).toContain('Remote ally');
  });

  it('projects only chronicle-eligible world impact and excludes local protagonist actions', () => {
    const state = {
      ...makeState(),
      worldTrends: [
        {
          trendId: 'event_local_recruitment',
          title: 'Local recruitment',
          severity: '高',
          summary: 'The player recruited one retainer.',
          knownToPlayer: true,
          status: 'active',
          scope: 'local',
          happenedAt: 'day 2',
          affectedNpcIds: ['npc_retainer'],
          updatedAt: 'day 2',
        },
        {
          trendId: 'event_realm_mutiny',
          title: 'Realm mutiny',
          severity: '极高',
          summary: 'A realm-level mutiny changed the balance of power.',
          knownToPlayer: true,
          status: 'active',
          scope: 'realm',
          affectedFactionIds: ['faction_rebel_court'],
          progressSummary: 'The rebel court still controls the capital.',
          nextCheckAt: 'day 4',
          happenedAt: 'day 2',
          updatedAt: 'day 2',
        },
      ],
    } as RuntimeState;

    const slice = selectPromptContext(state);

    expect(slice.relevantWorldTrends.map((trend) => trend.trendId)).toEqual(['event_realm_mutiny']);
  });

  it('selects remote NPC presence beats as advisory context only', () => {
    const state = {
      ...makeState(),
      npcAwarenessIndex: [
        {
          awarenessId: 'aware_zhang_miao',
          name: 'Zhang Miao',
          sourceType: 'rumor',
          sourceIds: ['rumor_recruit'],
          contactLevel: 0,
          playerRelevance: ['same-location'],
          unresolvedHooks: ['may recruit capable locals'],
          knownToPlayer: true,
          archiveVisible: false,
          updatedAt: 'chaos year 1 month 2',
        },
      ],
    } as RuntimeState;

    const slice = selectPromptContext(state) as any;

    expect(slice.remoteNpcPresenceBeats).toHaveLength(1);
    expect(slice.remoteNpcPresenceBeats[0]).toMatchObject({
      name: 'Zhang Miao',
      beatType: 'invitation',
    });
  });

  it('projects registered worldline knowledge according to runtime settings', () => {
    clearWorldlineKnowledgeRegistryForTest();
    const knowledgeBase: WorldlineKnowledgeBase = {
      id: 'kb_prompt_context_test',
      worldBookId: 'test-chaos-world',
      name: 'Prompt Context Test Knowledge',
      version: '0.1.0',
      description: 'test',
      cards: [
        {
          id: 'kb_luoyang_anchor',
          worldBookId: 'test-chaos-world',
          kind: 'eraAnchor',
          title: '洛阳局势惯性',
          summary: '京师乱局会影响地方消息与人物判断。',
          relatedPlaceIds: ['loc_market_town'],
          importance: 'critical',
          strictness: 'light',
          contradictionHint: '若玩家已经改变地方局势，以本局事实为准。',
        },
      ],
    };
    registerWorldlineKnowledgeBase(knowledgeBase);

    const slice = selectPromptContext({
      ...makeState(),
      worldlineSettings: {
        knowledgeMode: 'default',
        knowledgeBaseId: 'kb_prompt_context_test',
        storyPackIds: [],
      },
    } as RuntimeState);

    expect(slice.situationProjection.sourceCounts.worldlineHints).toBe(1);
    expect(slice.situationProjection.text).toContain('Worldline Knowledge');
    expect(slice.situationProjection.text).toContain('hintId=kb_luoyang_anchor');
    expect(slice.situationProjection.text).toContain('本局事实');
    clearWorldlineKnowledgeRegistryForTest();
  });

  it('lets the current player input trigger a registered StoryPack signal through the prompt selector', () => {
    clearWorldlineKnowledgeRegistryForTest();
    const storyPack: WorldlineStoryPack = {
      id: 'story_prompt_context_test',
      worldBookId: 'test-chaos-world',
      name: 'Prompt Context Test StoryPack',
      version: '0.1.0',
      description: 'test',
      threads: [
        {
          id: 'story_prompt_context_test.domain_situation.logistics.warehousing.ledger_mismatch.ledger_resources',
          worldBookId: 'test-chaos-world',
          kind: 'domainSituation',
          domain: 'logistics',
          subdomain: 'warehousing',
          motifId: 'ledger_mismatch',
          facet: 'ledger_resources',
          title: '仓册与实粮不符',
          summary: '账目与实粮出现差异，需要核对可验证数目。',
          entrySignals: ['核对仓册'],
          escalationShapes: ['限期复核'],
          rolePerspectives: ['official'],
          reusePolicy: 'context_reusable',
          cooldownTurns: 10,
          promptSafeVersion: '1.0.0',
          sourceRef: {
            providerId: 'story_prompt_context_test',
            sourceType: 'storyThread',
            sourceId: 'story_prompt_context_test.domain_situation.logistics.warehousing.ledger_mismatch.ledger_resources',
          },
          usageBoundary: '不得虚构粮草数值或宣告已经发生的损失。',
        },
      ],
    };
    registerWorldlineStoryPack(storyPack);

    const slice = selectPromptContext({
      ...makeState(),
      worldlineSettings: {
        knowledgeMode: 'default',
        storyPackIds: [storyPack.id],
      },
    } as RuntimeState, {
      queryTexts: ['去粮仓核对仓册'],
    });

    expect(slice.situationProjection.sourceCounts.worldlineHints).toBe(1);
    expect(slice.situationProjection.text).toContain('sourceRef=story_prompt_context_test');
    expect(slice.situationProjection.text).toContain('仓册与实粮不符');
    clearWorldlineKnowledgeRegistryForTest();
  });

  it('does not let unrelated high-importance contextual worldline knowledge increase prompt counts', () => {
    clearWorldlineKnowledgeRegistryForTest();
    registerWorldlineKnowledgeBase({
      id: 'kb_prompt_context_relevance_gate_test',
      worldBookId: 'test-chaos-world',
      name: 'Prompt Context Relevance Gate Test Knowledge',
      version: '0.1.0',
      description: 'test',
      cards: [
        {
          id: 'kb_unrelated_critical_contextual',
          worldBookId: 'test-chaos-world',
          kind: 'event',
          title: '远方高重要资料',
          summary: '这条资料时代允许但没有当前人物、地点、势力、事件或标签命中。',
          importance: 'critical',
          strictness: 'light',
          relatedPlaceIds: ['loc_far'],
          relatedFactionIds: ['faction_far'],
          relatedTags: ['远方高重要资料'],
        },
      ],
    });

    const slice = selectPromptContext({
      ...makeState(),
      worldlineSettings: {
        knowledgeMode: 'default',
        knowledgeBaseId: 'kb_prompt_context_relevance_gate_test',
        storyPackIds: [],
      },
    } as RuntimeState);

    expect(slice.situationProjection.sourceCounts.worldlineHints).toBe(0);
    expect(slice.situationProjection.text).not.toContain('kb_unrelated_critical_contextual');
    expect(slice.situationProjection.text).not.toContain('远方高重要资料');
    clearWorldlineKnowledgeRegistryForTest();
  });

  it('does not project worldline knowledge when runtime mode is off', () => {
    clearWorldlineKnowledgeRegistryForTest();
    registerWorldlineKnowledgeBase({
      id: 'kb_prompt_context_off_test',
      worldBookId: 'test-chaos-world',
      name: 'Prompt Context Off Test Knowledge',
      version: '0.1.0',
      description: 'test',
      cards: [
        {
          id: 'kb_hidden_anchor',
          worldBookId: 'test-chaos-world',
          kind: 'eraAnchor',
          title: '关闭时不应出现',
          summary: '这条资料不应进入 prompt。',
          importance: 'critical',
          strictness: 'light',
        },
      ],
    });

    const slice = selectPromptContext({
      ...makeState(),
      worldlineSettings: {
        knowledgeMode: 'off',
        knowledgeBaseId: 'kb_prompt_context_off_test',
        storyPackIds: [],
      },
    } as RuntimeState);

    expect(slice.situationProjection.sourceCounts.worldlineHints).toBe(0);
    expect(slice.situationProjection.text).not.toContain('关闭时不应出现');
    clearWorldlineKnowledgeRegistryForTest();
  });

  it('selects compact relevant faction and troop ledgers for prompt projection', () => {
    const slice = selectPromptContext({
      ...makeState(),
      factions: [
        {
          factionId: 'faction_local_guard',
          name: '市镇守卒',
          type: '地方武装',
          summary: '维持市镇秩序的小股守卒。',
          stanceToPlayer: '观望',
          knownLevel: '亲历',
          recentActions: ['封锁北门'],
        },
        {
          factionId: 'faction_far',
          name: '远方商帮',
          type: '商帮',
          summary: '远方商路势力。',
          stanceToPlayer: '无交集',
          knownLevel: '听闻',
          recentActions: ['远方茶路涨价'],
        },
      ],
      troops: [
        {
          troopId: 'troop_local',
          name: '北门守卒',
          size: 80,
          leaderNpcId: 'npc_chen_heng',
          locationId: 'loc_market_town',
          morale: 45,
          training: 35,
          supplies: '口粮不足',
          task: '守住北门',
          relationToPlayer: '谨慎观望',
        },
        {
          troopId: 'troop_last_known_here',
          name: '西门旧卒',
          size: 30,
          locationId: 'loc_far',
          lastKnownLocationId: 'loc_market_town',
          lastKnownAt: '乱世元年2月',
          morale: 50,
          training: 40,
          supplies: '不明',
          task: '上次听闻仍在西门',
          relationToPlayer: '无交集',
        },
        {
          troopId: 'troop_archived',
          name: '已归档旧部',
          size: 20,
          locationId: 'loc_market_town',
          morale: 50,
          training: 40,
          supplies: '不明',
          task: '旧情报',
          relationToPlayer: '自势力相关',
          lifecycleStatus: 'archived',
        },
        ...(['merged', 'split', 'destroyed', 'surrendered', 'disbanded'] as const).map((lifecycleStatus) => ({
          troopId: `troop_${lifecycleStatus}`,
          name: `终态旧部-${lifecycleStatus}`,
          size: 20,
          locationId: 'loc_market_town',
          morale: 50,
          training: 40,
          supplies: '不再计入当前兵力',
          task: '历史建制',
          relationToPlayer: '自势力相关',
          lifecycleStatus,
        })),
        {
          troopId: 'troop_far',
          name: '远方护商队',
          size: 40,
          locationId: 'loc_far',
          morale: 60,
          training: 50,
          supplies: '充足',
          task: '护送商货',
          relationToPlayer: '无交集',
        },
      ],
    } as RuntimeState);

    expect(slice.relevantFactions.map((faction) => faction.factionId)).toEqual(['faction_local_guard']);
    expect(slice.relevantTroops.map((troop) => troop.troopId)).toEqual(['troop_local', 'troop_last_known_here']);
  });

  it('uses faction, force, and holding-only dynamic links to select relevant ledgers', () => {
    const slice = selectPromptContext({
      ...makeState(),
      activeQuests: [
        {
          id: 'quest_bridge_holding',
          title: '守住桥头庄',
          description: '桥头庄是本回合唯一明确的领地牵连。',
          status: 'active',
          priority: 'low',
          affectedHoldingIds: ['holding_bridge'],
          createdAt: '乱世元年2月',
          updatedAt: '乱世元年2月',
        },
      ],
      knownRumors: [
        {
          id: 'signal_bridge_troop',
          content: '桥头守卒被人暗中调动。',
          source: '脚夫',
          signalType: 'report',
          severity: 'minor',
          affectedForceIds: ['troop_bridge_guard'],
          verified: false,
          createdAt: '乱世元年2月',
        },
      ],
      worldTrends: [
        {
          trendId: 'trend_bridge_faction',
          title: '桥头庄归属生变',
          severity: '低',
          summary: '桥头庄背后的地方守备开始动摇。',
          knownToPlayer: true,
          relatedFactionIds: ['faction_bridge_guard'],
          updatedAt: '乱世元年2月',
        },
      ],
      factions: [
        {
          factionId: 'faction_bridge_guard',
          name: '桥头守备',
          type: '地方守备',
          summary: '掌握桥头庄的一支地方守备。',
          stanceToPlayer: '观望',
          knownLevel: '听闻',
          recentActions: ['调动桥头守卒'],
        },
        {
          factionId: 'faction_far_unlinked',
          name: '远方商帮',
          type: '商帮',
          summary: '远方商路势力。',
          stanceToPlayer: '无交集',
          knownLevel: '听闻',
          recentActions: ['涨价'],
        },
      ],
      troops: [
        {
          troopId: 'troop_bridge_guard',
          name: '桥头守卒',
          size: 60,
          factionId: 'faction_bridge_guard',
          locationId: 'loc_far',
          morale: 48,
          training: 42,
          supplies: '紧张',
          task: '守住桥头庄',
          relationToPlayer: '无交集',
        },
      ],
      holdings: [
        {
          holdingId: 'holding_bridge',
          name: '桥头庄',
          type: 'estate',
          status: 'controlled',
          summary: '桥头庄控制着渡口粮道。',
          locationId: 'loc_far',
          factionId: 'faction_bridge_guard',
          stewardNpcId: 'npc_chen_heng',
          garrisonTroopIds: ['troop_bridge_guard'],
          scaleLevel: 1,
          agriculture: 38,
          commerce: 24,
          population: 30,
          publicOrder: 44,
          popularSupport: 41,
          defense: 35,
          recruitPotential: 21,
          armory: 9,
          horseSupply: 2,
          corruption: 28,
          updatedAt: '乱世元年2月',
        },
      ],
    } as RuntimeState) as any;

    expect(slice.relevantCurrentQuests.map((quest: { id: string }) => quest.id)).toContain('quest_bridge_holding');
    expect(slice.relevantSignals.map((signal: { id: string }) => signal.id)).toContain('signal_bridge_troop');
    expect(slice.relevantWorldTrends.map((trend: { trendId: string }) => trend.trendId)).toContain('trend_bridge_faction');
    expect(slice.relevantFactions.map((faction: { factionId: string }) => faction.factionId)).toContain('faction_bridge_guard');
    expect(slice.relevantTroops.map((troop: { troopId: string }) => troop.troopId)).toContain('troop_bridge_guard');
    expect(slice.relevantHoldings.map((holding: { holdingId: string }) => holding.holdingId)).toContain('holding_bridge');
  });

  it('selects compact active relationship threads for prompt projection', () => {
    const state = makeState();
    const slice = selectPromptContext({
      ...state,
      npcs: [
        ...(state.npcs ?? []),
        {
          npcId: 'npc_lady_he',
          name: '何氏',
          sex: '女',
          age: 22,
          role: '宫中女眷',
          locationId: 'loc_market_town',
          isPresent: true,
          isFocused: false,
          summary: '与主角有私下互信。',
          appearance: '衣着素雅。',
          personality: '谨慎克制。',
          motivation: '保全家人。',
          relationToPlayer: '已有私下互信。',
          contactLevel: 25,
          recentAttitude: '试探',
          memories: [],
        },
      ],
      heroineThreads: [
        {
          heroineThreadId: 'heroine_lady_he',
          npcId: 'npc_lady_he',
          npcName: '何氏',
          status: 'active',
          stage: '互信成形',
          relationshipRole: '宫廷盟友',
          summary: '她与主角已有私下互信。',
          currentPull: '等待主角履行保护承诺。',
          riskNotes: '宫廷耳目会放大风险。',
          promiseNotes: '主角承诺护住她的家人。',
          recentProgress: '上一回合两人确认暗号。',
          tags: ['宫廷', '互信'],
          milestones: [{ milestoneId: 'm1', happenedAt: '乱世元年2月', summary: '第一次交换暗号' }],
          lastUpdatedAt: '乱世元年2月03日',
        },
        {
          heroineThreadId: 'heroine_paused_remote',
          npcId: 'npc_remote_paused',
          npcName: '远方红颜',
          status: 'paused',
          stage: '暂别',
          relationshipRole: '远方旧识',
          summary: '远方旧识仍未重逢。',
          lastUpdatedAt: '乱世元年2月04日',
        },
        {
          heroineThreadId: 'heroine_archived',
          npcId: 'npc_archived_heroine',
          npcName: '旧线红颜',
          status: 'archived',
          stage: '旧线',
          relationshipRole: '旧线',
          summary: '不应投喂。',
          lastUpdatedAt: '乱世元年2月05日',
        },
        {
          heroineThreadId: 'heroine_resolved',
          npcId: 'npc_resolved_heroine',
          npcName: '已解决红颜',
          status: 'resolved',
          stage: '已解决',
          relationshipRole: '旧线',
          summary: '不应投喂。',
          lastUpdatedAt: '乱世元年2月06日',
        },
      ],
      bondThreads: [
        {
          bondThreadId: 'bond_gate_oath',
          targetNpcIds: ['npc_chen_heng'],
          targetNames: ['陈衡'],
          bondType: 'sworn',
          status: 'active',
          summary: '城门危机中形成的结义承诺。',
          currentTension: '双方都期待彼此守住难民。',
          promiseNotes: '共同护送伤者。',
          conflictNotes: '若弃守会损害信任。',
          recentProgress: '誓约被部下知晓。',
          tags: ['结义', '守城'],
          milestones: [{ milestoneId: 'bm1', happenedAt: '乱世元年2月', summary: '城门前立誓' }],
          lastUpdatedAt: '乱世元年2月03日',
        },
        {
          bondThreadId: 'bond_name_fallback',
          targetNames: ['李肃'],
          bondType: 'ally',
          status: 'active',
          summary: '通过姓名匹配 focused NPC 的旧盟约。',
          lastUpdatedAt: '乱世元年2月02日',
        },
        {
          bondThreadId: 'bond_paused_remote',
          targetNames: ['远方盟友'],
          bondType: 'ally',
          status: 'paused',
          summary: '远方盟友暂别。',
          lastUpdatedAt: '乱世元年2月04日',
        },
        {
          bondThreadId: 'bond_archived',
          targetNpcIds: ['npc_chen_heng'],
          targetNames: ['陈衡'],
          bondType: 'ally',
          status: 'archived',
          summary: '不应投喂。',
          lastUpdatedAt: '乱世元年2月05日',
        },
      ],
    } as RuntimeState);

    expect(slice.relationshipThreads.heroineThreads.map((thread) => thread.heroineThreadId)).toContain(
      'heroine_lady_he',
    );
    expect(slice.relationshipThreads.bondThreads.map((thread) => thread.bondThreadId)).toEqual(
      expect.arrayContaining(['bond_gate_oath', 'bond_name_fallback']),
    );

    const selectedIds = [
      ...slice.relationshipThreads.heroineThreads.map((thread) => thread.heroineThreadId),
      ...slice.relationshipThreads.bondThreads.map((thread) => thread.bondThreadId),
    ];
    expect(selectedIds).not.toContain('heroine_archived');
    expect(selectedIds).not.toContain('heroine_resolved');
    expect(selectedIds).not.toContain('bond_archived');

    const pausedCount = [
      ...slice.relationshipThreads.heroineThreads,
      ...slice.relationshipThreads.bondThreads,
    ].filter((thread) => thread.status === 'paused').length;
    expect(pausedCount).toBeLessThanOrEqual(1);
    expect(
      slice.relationshipThreads.omittedHeroineThreadCount + slice.relationshipThreads.omittedBondThreadCount,
    ).toBeGreaterThan(0);
  });

  it('filters semantically invalid legacy relationship records from prompt projection', () => {
    const validHeroine = {
      heroineThreadId: 'heroine_valid_projection',
      npcId: 'npc_chen_heng',
      npcName: '陈衡',
      status: 'active' as const,
      stage: '互信成形',
      relationshipRole: '盟友',
      summary: '一条合法的投影记录。',
      lastUpdatedAt: '乱世元年2月03日',
    };
    const validBond = {
      bondThreadId: 'bond_valid_projection',
      targetNpcIds: ['npc_chen_heng'],
      targetNames: ['陈衡'],
      bondType: 'ally' as const,
      status: 'active' as const,
      summary: '一条合法的羁绊投影记录。',
      lastUpdatedAt: '乱世元年2月03日',
    };
    const slice = selectPromptContext({
      ...makeState(),
      heroineThreads: [
        validHeroine,
        { ...validHeroine, heroineThreadId: 'heroine_bad_status', status: 'unknown' as any },
        { ...validHeroine, heroineThreadId: '   ', stage: '   ', summary: '' },
      ],
      bondThreads: [
        validBond,
        { ...validBond, bondThreadId: 'bond_bad_status', status: 'unknown' as any },
        { ...validBond, bondThreadId: 'bond_bad_type', bondType: 'romance' as any },
        { ...validBond, bondThreadId: '   ', targetNames: ['   '], summary: '' },
      ],
    } as RuntimeState);

    expect(slice.relationshipThreads.heroineThreads.map((thread) => thread.heroineThreadId)).toEqual([
      'heroine_valid_projection',
    ]);
    expect(slice.relationshipThreads.bondThreads.map((thread) => thread.bondThreadId)).toEqual([
      'bond_valid_projection',
    ]);
  });

  it('removes terminal troop ids from faction and holding prompt projections while retaining successor ids', () => {
    const slice = selectPromptContext({
      ...makeState(),
      factions: [{
        factionId: 'faction_player',
        name: '主角军',
        type: '军府',
        summary: '主角直属军府。',
        stanceToPlayer: 'self',
        knownLevel: '亲历',
        recentActions: ['完成整编'],
        relatedTroopIds: ['troop_old_camp', 'troop_new_camp'],
      }],
      troops: [
        {
          troopId: 'troop_old_camp', name: '旧步兵营', size: 300, morale: 50, training: 50,
          supplies: 50, task: '历史建制', relationToPlayer: '你直接统领', lifecycleStatus: 'merged',
          mergedIntoTroopId: 'troop_new_camp', locationId: 'loc_market_town',
        },
        {
          troopId: 'troop_new_camp', name: '新主力营', size: 500, morale: 70, training: 70,
          supplies: 70, task: '整编待命', relationToPlayer: '你直接统领', lifecycleStatus: 'active',
          factionId: 'faction_player', locationId: 'loc_market_town',
        },
      ],
      holdings: [{
        holdingId: 'holding_main_camp', name: '中军营', type: 'camp', status: 'controlled', summary: '主角营地。',
        locationId: 'loc_market_town', factionId: 'faction_player', scaleLevel: 1,
        agriculture: 0, commerce: 0, population: 10, publicOrder: 80, popularSupport: 70,
        defense: 60, recruitPotential: 20, armory: 50, horseSupply: 30, corruption: 0,
        garrisonTroopIds: ['troop_old_camp', 'troop_new_camp'], updatedAt: '乱世元年2月',
      }],
    } as RuntimeState);

    expect(slice.relevantTroops.map((troop) => troop.troopId)).toEqual(['troop_new_camp']);
    expect(slice.relevantFactions[0]?.relatedTroopIds).toEqual(['troop_new_camp']);
    expect(slice.relevantHoldings[0]?.garrisonTroopIds).toEqual(['troop_new_camp']);
  });

  it('keeps a directly named troop inside the five-entry detailed projection', () => {
    const troops = Array.from({ length: 6 }, (_, index) => ({
      troopId: `troop_projection_${index + 1}`,
      name: index === 0 ? '北亭旧部' : `常备营第${index + 1}部`,
      aliases: index === 0 ? ['玄甲前锋'] : undefined,
      size: 100 + index,
      morale: 50,
      training: 50,
      supplies: 50,
      task: '远场待命',
      relationToPlayer: '友军',
      lifecycleStatus: 'active' as const,
      updatedAt: `乱世元年2月0${index + 1}日`,
    }));

    const slice = selectPromptContext({
      ...makeState(),
      troops,
    } as RuntimeState, {
      queryTexts: ['我要召见玄甲前锋，核对其当前位置。'],
    });

    expect(slice.relevantTroops).toHaveLength(5);
    expect(slice.relevantTroops[0]?.troopId).toBe('troop_projection_1');
    expect(slice.relevantTroops.map((troop) => troop.troopId)).toContain('troop_projection_1');
  });
});
