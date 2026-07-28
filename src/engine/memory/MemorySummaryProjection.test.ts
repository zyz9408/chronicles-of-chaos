import { describe, expect, it } from 'vitest';
import type { RecentTurnMemoryEntry, RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import {
  applyMemorySummaryResult,
  buildRecentTurnMemorySummaryTask,
  shouldCreateRecentTurnSummaryTask,
} from './MemorySummaryProjection';

function makeRecentTurn(index: number): RecentTurnMemoryEntry {
  return {
    id: `recent_${index}`,
    turnNumber: index,
    createdAt: `day ${index}`,
    playerInput: `action ${index}`,
    brief: `brief ${index}`,
    importance: index % 5 === 0 ? 'high' : 'medium',
  };
}

function makeState(recentCount = 35): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'memory-test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: 'day 1',
    currentDate: 'day 35',
    player: {
      id: 'player',
      name: '主角',
      roleType: '旅人',
      summary: '正在测试记忆系统。',
    },
    currentLocationId: 'loc_gate',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: Array.from({ length: recentCount }, (_, index) => ({
      turnNumber: index + 1,
      date: `day ${index + 1}`,
      playerInput: `action ${index + 1}`,
      narrativeText: `short narrative ${index + 1}`,
      fullNarrativeText: `full narrative ${index + 1}`,
      statePatchSummary: 'none',
      timestamp: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    })),
    localSituationNotes: [],
    locations: [
      {
        locationId: 'loc_gate',
        name: '城门',
        type: '场所',
        summary: '城门人来人往。',
        knownLevel: '亲历',
        recentEvents: [],
      },
    ],
    npcs: [
      {
        npcId: 'npc_gate_guard',
        name: '门候',
        sex: '男',
        age: 39,
        role: '城门军吏',
        locationId: 'loc_gate',
        isPresent: true,
        isFocused: true,
        summary: '负责盘查。',
        appearance: '甲衣陈旧。',
        personality: '谨慎。',
        motivation: '保住差事。',
        relationToPlayer: '对主角有所戒备。',
        contactLevel: 8,
        recentAttitude: '戒备',
        memories: [
          {
            memoryId: 'mem_guard_1',
            source: '亲历',
            content: '门候见过主角打探戒严消息。',
            createdAt: 'day 20',
          },
          {
            memoryId: 'mem_guard_2',
            source: '亲历',
            content: '门候记得主角没有硬闯城门。',
            createdAt: 'day 21',
          },
        ],
      },
    ],
    memoryArchive: {
      recentTurnSummaries: Array.from({ length: recentCount }, (_, index) => makeRecentTurn(index + 1)),
      midTermSummaries: [],
      longTermFacts: [],
      npcInteractionSummaries: [],
      locationMemorySummaries: [],
      settings: {
        recentRawTurnLimit: 10,
        recentTurnLimit: 20,
        recentTurnCompressThreshold: 20,
        recentTurnKeepAfterCompress: 12,
        npcRecentMemoryDefaultLimit: 8,
        npcRecentMemoryImportantLimit: 12,
        focusedNpcRecentMemoryLimit: 2,
        npcMemoryCompressThreshold: 20,
        npcMemoryKeepAfterCompress: 40,
        locationMemoryCompressThreshold: 30,
        taskMemoryCompressThreshold: 30,
        midTermSummaryLimit: 4,
        longTermFactLimit: 8,
        vectorResultLimit: 6,
        maxPromptMemoryTokens: 80000,
        recentStoryTokenBudget: 30000,
        npcMemoryTokenBudget: 20000,
        midTermTokenBudget: 8000,
        longTermFactTokenBudget: 8000,
        locationMemoryTokenBudget: 4000,
        retrievalTokenBudget: 10000,
        enableAutoMemorySummary: true,
        preferDedicatedMemorySummaryApi: true,
      },
    },
  });
}

describe('MemorySummaryProjection', () => {
  it('only suggests a recent-turn summary task after the configurable threshold', () => {
    expect(shouldCreateRecentTurnSummaryTask(makeState(19))).toBe(false);
    expect(shouldCreateRecentTurnSummaryTask(makeState(20))).toBe(true);

    const disabled = makeState(35);
    disabled.memoryArchive!.settings.enableAutoMemorySummary = false;

    expect(shouldCreateRecentTurnSummaryTask(disabled)).toBe(false);
  });

  it('builds a recent-turn summary task for the dedicated memorySummary route with main API fallback', () => {
    const task = buildRecentTurnMemorySummaryTask(makeState(35));

    expect(task).toMatchObject({
      kind: 'recentTurnCompression',
      apiTaskId: 'memorySummary',
      fallbackApiTaskId: 'mainNarrative',
      createdAt: 'day 35',
      currentLocationId: 'loc_gate',
    });
    expect(task.sourceRecentTurnSummaries).toHaveLength(20);
    expect(task.sourceRecentTurnSummaries[0].id).toBe('recent_1');
    expect(task.sourceRecentTurnSummaries[19].id).toBe('recent_20');
    expect(task.keptRecentTurnIds).toEqual(Array.from({ length: 12 }, (_, index) => `recent_${index + 24}`));
    expect(task.sourceTurnLogs.map((turn) => turn.turnNumber)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(task.relatedNpcMemoryBlocks).toHaveLength(0);
    expect(task.tokenBudgetHint).toMatchObject({
      maxPromptMemoryTokens: 80000,
      recentStoryTokenBudget: 30000,
      midTermTokenBudget: 8000,
    });
  });

  it('applies summary results into layered archives without deleting original memories', () => {
    const state = makeState(35);
    const application = applyMemorySummaryResult(state, {
      midTermSummaries: [
        {
          summaryId: 'mid_gate_1',
          title: '城门试探阶段',
          fromCreatedAt: 'day 1',
          toCreatedAt: 'day 23',
          summary: '主角多次在城门附近打探戒严消息。',
          relatedNpcIds: ['npc_gate_guard'],
          relatedLocationIds: ['loc_gate'],
          updatedAt: 'day 35',
        },
      ],
      longTermFacts: [
        {
          factId: 'fact_gate_promise',
          category: 'promise',
          createdAt: 'day 18',
          summary: '主角曾承诺不会强闯城门。',
          importance: 'high',
          relatedNpcIds: ['npc_gate_guard'],
          relatedLocationIds: ['loc_gate'],
        },
      ],
      npcInteractionSummaries: [
        {
          npcId: 'npc_gate_guard',
          npcName: '门候',
          summary: '门候认为主角谨慎但一直关注戒严。',
          fromCreatedAt: 'day 20',
          toCreatedAt: 'day 21',
          sourceMemoryIds: ['mem_guard_1', 'mem_guard_2'],
          updatedAt: 'day 35',
        },
      ],
      locationMemorySummaries: [
        {
          locationId: 'loc_gate',
          locationName: '城门',
          summary: '城门长期戒严，门候对盘查格外谨慎。',
          updatedAt: 'day 35',
        },
      ],
    });

    expect(application.state.memoryArchive?.midTermSummaries[0].summary).toContain('城门附近打探戒严');
    expect(application.state.memoryArchive?.longTermFacts[0].summary).toContain('不会强闯城门');
    expect(application.state.memoryArchive?.npcInteractionSummaries[0].summary).toContain('门候认为主角谨慎');
    expect(application.state.memoryArchive?.locationMemorySummaries[0].summary).toContain('城门长期戒严');
    expect(application.state.memoryArchive?.recentTurnSummaries).toHaveLength(35);
    expect(application.state.turnLog).toHaveLength(35);
    expect(application.state.npcs?.[0].memories).toHaveLength(2);
    expect(application.appliedSummaries).toEqual(['中期剧情摘要x1', '长期档案记忆x1', 'NPC互动摘要x1', '地点记忆摘要x1']);
  });

  it('upserts summary result entries by stable ids', () => {
    const state = makeState(35);
    state.memoryArchive!.midTermSummaries = [
      {
        summaryId: 'mid_gate_1',
        title: '旧标题',
        fromCreatedAt: 'day 1',
        toCreatedAt: 'day 10',
        summary: '旧摘要。',
        updatedAt: 'day 10',
      },
    ];

    const application = applyMemorySummaryResult(state, {
      midTermSummaries: [
        {
          summaryId: 'mid_gate_1',
          title: '新标题',
          fromCreatedAt: 'day 1',
          toCreatedAt: 'day 23',
          summary: '更新后的摘要。',
          updatedAt: 'day 35',
        },
      ],
    });

    expect(application.state.memoryArchive?.midTermSummaries).toHaveLength(1);
    expect(application.state.memoryArchive?.midTermSummaries[0]).toMatchObject({
      title: '新标题',
      summary: '更新后的摘要。',
    });
  });

  it('compresses each 20 uncovered NPC raw memories into one mid-term entry and retains the latest 40 raw memories', () => {
    const state = makeState(0);
    state.npcs![0].memories = Array.from({ length: 60 }, (_, index) => ({
      memoryId: `npc_raw_${index + 1}`,
      source: '亲历',
      content: `第${index + 1}条原始记忆`,
      createdAt: `day ${index + 1}`,
    }));

    expect(shouldCreateRecentTurnSummaryTask(state)).toBe(true);
    const task = buildRecentTurnMemorySummaryTask(state);
    expect(task.relatedNpcMemoryBlocks).toHaveLength(1);
    expect(task.relatedNpcMemoryBlocks[0].memories.map((memory) => memory.memoryId))
      .toEqual(Array.from({ length: 20 }, (_, index) => `npc_raw_${index + 1}`));

    const application = applyMemorySummaryResult(state, {
      npcMidTermSummaries: [{
        summaryId: 'npc_mid_1',
        npcId: 'npc_gate_guard',
        npcName: '门候',
        summary: '门候记得主角在一段时期内反复打探消息。',
        fromCreatedAt: 'day 1',
        toCreatedAt: 'day 20',
        sourceMemoryIds: [],
        updatedAt: 'day 60',
      }],
    }, task);

    expect(application.state.memoryArchive?.npcMidTermSummaries?.[0].sourceMemoryIds).toHaveLength(20);
    expect(application.state.memoryArchive?.npcMidTermSummaries?.[0].summaryId).toMatch(/^npc_mid_npc_gate_guard_/);
    expect(application.state.npcs?.[0].memories).toHaveLength(40);
    expect(application.state.npcs?.[0].memories[0].memoryId).toBe('npc_raw_21');
  });

  it('does not compress a partial player batch or create player facts during an NPC-only compression task', () => {
    const state = makeState(1);
    state.npcs![0].memories = Array.from({ length: 20 }, (_, index) => ({
      memoryId: `npc_only_${index + 1}`,
      source: '亲历',
      content: `NPC待压缩记忆${index + 1}`,
      createdAt: `day ${index + 1}`,
    }));
    const task = buildRecentTurnMemorySummaryTask(state);

    expect(task.sourceRecentTurnSummaries).toHaveLength(1);
    expect(task.relatedNpcMemoryBlocks[0].memories).toHaveLength(20);

    const application = applyMemorySummaryResult(state, {
      midTermSummaries: [{
        summaryId: 'hallucinated_player_mid',
        title: '不应落库的单回合中期',
        fromCreatedAt: 'day 1',
        toCreatedAt: 'day 1',
        summary: '模型错误地把单回合压缩成中期。',
        sourceRecentTurnIds: ['recent_1'],
        updatedAt: 'day 1',
      }],
      longTermFacts: [{
        factId: 'hallucinated_player_fact',
        category: 'other',
        createdAt: 'day 1',
        summary: 'NPC-only 任务不应顺带写玩家长期事实。',
        importance: 'medium',
        sourceTurnNumbers: [1],
      }],
      npcMidTermSummaries: [{
        summaryId: 'model_npc_mid_partial_sources',
        npcId: 'npc_gate_guard',
        npcName: '门候',
        summary: '门候的一段中期记忆。',
        fromCreatedAt: 'day 1',
        toCreatedAt: 'day 20',
        sourceMemoryIds: ['npc_only_1', 'npc_only_2'],
        updatedAt: 'day 20',
      }],
    }, task);

    expect(application.state.memoryArchive?.midTermSummaries).toHaveLength(0);
    expect(application.state.memoryArchive?.longTermFacts).toHaveLength(0);
    expect(application.state.memoryArchive?.npcMidTermSummaries).toHaveLength(1);
    expect(application.state.memoryArchive?.npcMidTermSummaries?.[0].sourceMemoryIds)
      .toEqual(Array.from({ length: 20 }, (_, index) => `npc_only_${index + 1}`));
    expect(application.ignoredSummaries).toEqual(expect.arrayContaining([
      expect.stringContaining('玩家近期输入不足20条'),
      expect.stringContaining('没有合格玩家批次'),
    ]));
  });

  it('accepts exactly one player mid-term summary and owns its batch id and complete sources locally', () => {
    const state = makeState(20);
    const task = buildRecentTurnMemorySummaryTask(state);
    const application = applyMemorySummaryResult(state, {
      midTermSummaries: [
        {
          summaryId: 'model_player_mid_1',
          title: '第一阶段',
          fromCreatedAt: 'day 1',
          toCreatedAt: 'day 20',
          summary: '二十回合形成了一个完整阶段。',
          sourceRecentTurnIds: ['recent_1'],
          updatedAt: 'day 20',
        },
        {
          summaryId: 'model_player_mid_2',
          title: '模型多写的第二阶段',
          fromCreatedAt: 'day 1',
          toCreatedAt: 'day 20',
          summary: '同一批次不得生成第二条。',
          sourceRecentTurnIds: ['recent_2'],
          updatedAt: 'day 20',
        },
      ],
    }, task);

    expect(application.state.memoryArchive?.midTermSummaries).toHaveLength(1);
    expect(application.state.memoryArchive?.midTermSummaries[0].summaryId).toMatch(/^player_mid_/);
    expect(application.state.memoryArchive?.midTermSummaries[0].sourceRecentTurnIds)
      .toEqual(Array.from({ length: 20 }, (_, index) => `recent_${index + 1}`));
    expect(application.ignoredSummaries).toContain('玩家中期摘要：同一批次额外输出已忽略x1');

    const replay = applyMemorySummaryResult(application.state, {
      midTermSummaries: [{
        summaryId: 'another_model_id',
        title: '第一阶段复核',
        fromCreatedAt: 'day 1',
        toCreatedAt: 'day 20',
        summary: '同一批次重放只更新同一条。',
        sourceRecentTurnIds: ['recent_20'],
        updatedAt: 'day 20',
      }],
    }, task);
    expect(replay.state.memoryArchive?.midTermSummaries).toHaveLength(1);
    expect(replay.state.memoryArchive?.midTermSummaries[0].summary).toBe('同一批次重放只更新同一条。');
  });

  it('retains every NPC mid-term entry locally and folds each 10-entry batch into one long-term entry', () => {
    const state = makeState(0);
    state.memoryArchive!.npcMidTermSummaries = Array.from({ length: 10 }, (_, index) => ({
      summaryId: `npc_mid_${index + 1}`,
      npcId: 'npc_gate_guard',
      npcName: '门候',
      summary: `NPC中期记忆${index + 1}`,
      fromCreatedAt: `day ${index * 20 + 1}`,
      toCreatedAt: `day ${(index + 1) * 20}`,
      sourceMemoryIds: [`covered_${index + 1}`],
      updatedAt: `day ${(index + 1) * 20}`,
    }));

    const task = buildRecentTurnMemorySummaryTask(state);
    expect(task.sourceNpcMidTermBlocks[0].summaries).toHaveLength(10);
    const application = applyMemorySummaryResult(state, {
      npcLongTermSummaries: [{
        summaryId: 'npc_long_1',
        npcId: 'npc_gate_guard',
        npcName: '门候',
        summary: '门候与主角长期形成了谨慎但可承接的互动关系。',
        fromCreatedAt: 'day 1',
        toCreatedAt: 'day 200',
        sourceMidTermSummaryIds: [],
        updatedAt: 'day 200',
      }],
    }, task);

    expect(application.state.memoryArchive?.npcMidTermSummaries).toHaveLength(10);
    const longTermId = application.state.memoryArchive?.npcLongTermSummaries?.[0].summaryId;
    expect(longTermId).toMatch(/^npc_long_npc_gate_guard_/);
    expect(application.state.memoryArchive?.npcMidTermSummaries?.every(
      (summary) => summary.foldedIntoLongTermSummaryId === longTermId,
    )).toBe(true);
    expect(application.state.memoryArchive?.npcLongTermSummaries?.[0].sourceMidTermSummaryIds).toHaveLength(10);
  });

  it('folds each 10 player mid-term summaries into a retained long-term life summary', () => {
    const state = makeState(0);
    state.memoryArchive!.midTermSummaries = Array.from({ length: 10 }, (_, index) => ({
      summaryId: `player_mid_${index + 1}`,
      title: `阶段${index + 1}`,
      fromCreatedAt: `day ${index * 20 + 1}`,
      toCreatedAt: `day ${(index + 1) * 20}`,
      summary: `玩家中期摘要${index + 1}`,
      updatedAt: `day ${(index + 1) * 20}`,
    }));

    const task = buildRecentTurnMemorySummaryTask(state);
    expect(task.sourceMidTermSummaries).toHaveLength(10);
    const application = applyMemorySummaryResult(state, {
      longTermStorySummaries: [{
        summaryId: 'player_long_1',
        title: '早期生平',
        fromCreatedAt: 'day 1',
        toCreatedAt: 'day 200',
        summary: '玩家在早期形成了稳定的人际关系与长期目标。',
        sourceMidTermSummaryIds: [],
        updatedAt: 'day 200',
      }],
    }, task);

    expect(application.state.memoryArchive?.midTermSummaries).toHaveLength(10);
    const longTermId = application.state.memoryArchive?.longTermStorySummaries?.[0].summaryId;
    expect(longTermId).toMatch(/^player_long_/);
    expect(application.state.memoryArchive?.midTermSummaries.every(
      (summary) => summary.foldedIntoLongTermSummaryId === longTermId,
    )).toBe(true);
    expect(application.state.memoryArchive?.longTermStorySummaries?.[0].sourceMidTermSummaryIds).toHaveLength(10);
  });

  it('accepts exactly one player long-term summary and replaces model sources with the ten local mid-term ids', () => {
    const state = makeState(0);
    state.memoryArchive!.midTermSummaries = Array.from({ length: 10 }, (_, index) => ({
      summaryId: `local_mid_${index + 1}`,
      title: `阶段${index + 1}`,
      fromCreatedAt: `day ${index * 20 + 1}`,
      toCreatedAt: `day ${(index + 1) * 20}`,
      summary: `中期摘要${index + 1}`,
      updatedAt: `day ${(index + 1) * 20}`,
    }));
    const task = buildRecentTurnMemorySummaryTask(state);
    const application = applyMemorySummaryResult(state, {
      longTermStorySummaries: [
        {
          summaryId: 'model_long_1',
          title: '长期阶段',
          fromCreatedAt: 'day 1',
          toCreatedAt: 'day 200',
          summary: '十条中期压缩后的长期生平。',
          sourceMidTermSummaryIds: ['local_mid_1'],
          updatedAt: 'day 200',
        },
        {
          summaryId: 'model_long_2',
          title: '额外长期阶段',
          fromCreatedAt: 'day 1',
          toCreatedAt: 'day 200',
          summary: '同一批次的额外输出。',
          sourceMidTermSummaryIds: ['local_mid_2'],
          updatedAt: 'day 200',
        },
      ],
    }, task);

    expect(application.state.memoryArchive?.longTermStorySummaries).toHaveLength(1);
    expect(application.state.memoryArchive?.longTermStorySummaries?.[0].sourceMidTermSummaryIds)
      .toEqual(Array.from({ length: 10 }, (_, index) => `local_mid_${index + 1}`));
    expect(application.ignoredSummaries).toContain('玩家长期摘要：同一批次额外输出已忽略x1');
  });
});
