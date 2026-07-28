import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { retrieveRelevantMemories } from './MemoryRetrieval';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'retrieval-test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: 'day 1',
    currentDate: 'day 40',
    player: {
      id: 'player',
      name: '主角',
      roleType: '旅人',
      summary: '正在测试记忆检索。',
    },
    currentLocationId: 'loc_gate',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [
      {
        id: 'quest_wounded',
        title: '护送伤者',
        description: '把受伤军士送出城门。',
        status: 'active',
        createdAt: 'day 12',
        updatedAt: 'day 20',
      },
    ],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    locations: [
      {
        locationId: 'loc_gate',
        name: '城门',
        type: '场所',
        summary: '城门戒严。',
        knownLevel: '亲历',
        recentEvents: [],
      },
    ],
    npcs: [
      {
        npcId: 'npc_chen_heng',
        name: '陈衡',
        sex: '男',
        age: 30,
        role: '游侠首领',
        locationId: 'loc_gate',
        isPresent: true,
        isFocused: true,
        summary: '机警过人。',
        appearance: '目光锐利。',
        personality: '豪爽直接。',
        motivation: '寻找机会。',
        relationToPlayer: '因救人一事关注主角。',
        contactLevel: 12,
        recentAttitude: '好奇',
        memories: [
          {
            memoryId: 'mem_chen_1',
            source: '亲历',
            content: '陈衡亲眼见到主角承诺护送伤者出城。',
            createdAt: 'day 18',
          },
        ],
      },
      {
        npcId: 'npc_far',
        name: '远方商人',
        sex: '男',
        age: 42,
        role: '商人',
        locationId: 'loc_far',
        isPresent: false,
        isFocused: false,
        summary: '远方商人。',
        appearance: '普通。',
        personality: '谨慎。',
        motivation: '经商。',
        relationToPlayer: '无关。',
        contactLevel: 0,
        recentAttitude: '陌生',
        memories: [
          {
            memoryId: 'mem_far_1',
            source: '听闻',
            content: '远方商人记得一桩和茶叶价格有关的旧事。',
            createdAt: 'day 10',
          },
        ],
      },
    ],
    memoryArchive: {
      recentTurnSummaries: [
        {
          id: 'recent_1',
          turnNumber: 18,
          createdAt: 'day 18',
          playerInput: '我答应护送伤者',
          brief: '主角答应护送伤者出城，陈衡在场。',
          importance: 'high',
        },
      ],
      midTermSummaries: [
        {
          summaryId: 'mid_gate',
          title: '城门戒严阶段',
          fromCreatedAt: 'day 10',
          toCreatedAt: 'day 25',
          summary: '主角在城门戒严期间多次打探消息，并卷入护送伤者的承诺。',
          relatedNpcIds: ['npc_chen_heng'],
          relatedLocationIds: ['loc_gate'],
          updatedAt: 'day 25',
        },
        {
          summaryId: 'mid_far',
          title: '远方茶路',
          fromCreatedAt: 'day 1',
          toCreatedAt: 'day 5',
          summary: '远方茶路价格波动，与当前行动无关。',
          relatedNpcIds: ['npc_far'],
          relatedLocationIds: ['loc_far'],
          updatedAt: 'day 5',
        },
      ],
      longTermFacts: [
        {
          factId: 'fact_promise',
          category: 'promise',
          createdAt: 'day 18',
          summary: '主角曾承诺护送伤者出城。',
          importance: 'high',
          relatedNpcIds: ['npc_chen_heng'],
          relatedLocationIds: ['loc_gate'],
        },
      ],
      npcInteractionSummaries: [
        {
          npcId: 'npc_chen_heng',
          npcName: '陈衡',
          summary: '陈衡因主角救人与护送承诺而开始关注主角。',
          updatedAt: 'day 25',
        },
      ],
      locationMemorySummaries: [
        {
          locationId: 'loc_gate',
          locationName: '城门',
          summary: '城门戒严期间，护送伤者出城风险很高。',
          updatedAt: 'day 25',
        },
      ],
      settings: {
        recentRawTurnLimit: 4,
        recentTurnLimit: 20,
        recentTurnCompressThreshold: 30,
        recentTurnKeepAfterCompress: 12,
        npcRecentMemoryDefaultLimit: 2,
        npcRecentMemoryImportantLimit: 5,
        focusedNpcRecentMemoryLimit: 2,
        npcMemoryCompressThreshold: 40,
        npcMemoryKeepAfterCompress: 12,
        locationMemoryCompressThreshold: 30,
        taskMemoryCompressThreshold: 30,
        midTermSummaryLimit: 3,
        longTermFactLimit: 8,
        vectorResultLimit: 4,
        maxPromptMemoryTokens: 40000,
        recentStoryTokenBudget: 12000,
        npcMemoryTokenBudget: 12000,
        midTermTokenBudget: 6000,
        longTermFactTokenBudget: 5000,
        locationMemoryTokenBudget: 3000,
        retrievalTokenBudget: 8000,
        enableAutoMemorySummary: true,
        preferDedicatedMemorySummaryApi: true,
      },
    },
  });
}

describe('retrieveRelevantMemories', () => {
  it('retrieves relevant local memories without embedding and excludes unrelated memories', () => {
    const results = retrieveRelevantMemories(makeState(), '我问陈衡，护送伤者出城的承诺还算不算数？');

    expect(results.map((result) => result.sourceId)).toContain('fact_promise');
    expect(results.map((result) => result.sourceId)).toContain('mid_gate');
    expect(results.map((result) => result.sourceId)).toContain('mem_chen_1');
    expect(results.map((result) => result.sourceId)).not.toContain('mid_far');
    expect(results.map((result) => result.sourceId)).not.toContain('mem_far_1');
    expect(results.length).toBeLessThanOrEqual(4);
    expect(results[0]).toMatchObject({
      retrievalMode: 'local',
      sourceType: expect.any(String),
      score: expect.any(Number),
    });
  });

  it('returns stable source metadata for prompt projection and future embedding replacement', () => {
    const results = retrieveRelevantMemories(makeState(), '城门戒严和护送伤者有什么风险？', { limit: 2 });

    expect(results).toHaveLength(2);
    expect(results[0].text.length).toBeGreaterThan(0);
    expect(results[0].reason).toContain('关键词');
    expect(results.every((result) => result.retrievalMode === 'local')).toBe(true);
  });

  it('does not use completed historical matters as current retrieval query expansion', () => {
    const state = makeState();
    state.activeQuests = [{
      ...state.activeQuests[0],
      title: '远方茶路',
      description: '追查茶叶价格波动。',
      status: 'completed',
      outcomeSummary: '茶路调查已经结束。',
    }];

    const results = retrieveRelevantMemories(state, '查看四周还有什么动静？');

    expect(results.map((result) => result.sourceId)).not.toContain('mid_far');
  });
});
