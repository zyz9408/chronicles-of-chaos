import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { MemoryRetrievalResult } from './MemoryRetrieval';
import {
  buildMemoryContextPackage,
  formatMemoryContextPackageForPrompt,
} from './MemoryContextPackage';

function makeTurnLogEntry(turnNumber: number, narrativeText: string) {
  return {
    turnNumber,
    date: `day ${turnNumber}`,
    playerInput: `player input ${turnNumber}`,
    narrativeText,
    fullNarrativeText: `${narrativeText} full detail`,
    statePatchSummary: 'none',
    timestamp: `2026-01-${String(turnNumber).padStart(2, '0')}T00:00:00.000Z`,
  };
}

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'memory-context-package-test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: 'day 1',
    currentDate: 'day 40',
    player: {
      id: 'player',
      name: 'Liu Da',
      roleType: 'wanderer',
      summary: 'A protagonist used for memory context tests.',
    },
    currentLocationId: 'loc_gate',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [
      makeTurnLogEntry(1, 'Old scene that should be outside the raw recent window.'),
      makeTurnLogEntry(2, 'The protagonist promised Chen Heng to escort the wounded.'),
      makeTurnLogEntry(3, 'Chen Heng watched the protagonist avoid a reckless clash.'),
      makeTurnLogEntry(4, 'The gate became tense after patrols doubled.'),
      makeTurnLogEntry(5, 'The protagonist returned to ask about the escort route.'),
    ],
    localSituationNotes: [],
    locations: [
      {
        locationId: 'loc_gate',
        name: 'Gate',
        type: '场所',
        summary: 'A guarded town gate.',
        knownLevel: '亲历',
        recentEvents: [],
      },
    ],
    npcs: [
      {
        npcId: 'npc_chen',
        name: 'Chen Heng',
        sex: '男',
        age: 30,
        role: 'ranger leader',
        locationId: 'loc_gate',
        isPresent: true,
        isFocused: true,
        summary: 'A cautious local ranger.',
        appearance: 'Sharp eyes.',
        personality: 'Direct but cautious.',
        motivation: 'Protect the wounded.',
        relationToPlayer: 'Trusts the protagonist because of the escort promise.',
        contactLevel: 18,
        recentAttitude: 'watchful trust',
        memories: [
          {
            memoryId: 'mem_chen_1',
            source: '亲历',
            content: 'Chen saw the protagonist promise to escort the wounded.',
            createdAt: 'day 18',
          },
          {
            memoryId: 'mem_chen_2',
            source: '亲历',
            content: 'Chen saw the protagonist avoid a needless fight at the gate.',
            createdAt: 'day 19',
          },
        ],
      },
    ],
    memoryArchive: {
      recentTurnSummaries: [
        {
          id: 'recent_escort',
          turnNumber: 18,
          createdAt: 'day 18',
          playerInput: 'I promise to escort the wounded.',
          brief: 'The protagonist promised to escort the wounded out through the gate.',
          visibleConsequence: 'Chen Heng began to trust the protagonist.',
          importance: 'high',
        },
      ],
      midTermSummaries: [
        {
          summaryId: 'mid_gate',
          title: 'Gate pressure',
          fromCreatedAt: 'day 10',
          toCreatedAt: 'day 25',
          summary: 'The gate was under pressure while the escort promise became the central thread.',
          relatedNpcIds: ['npc_chen'],
          relatedLocationIds: ['loc_gate'],
          updatedAt: 'day 25',
        },
      ],
      longTermFacts: [
        {
          factId: 'fact_escort_promise',
          category: 'promise',
          createdAt: 'day 18',
          summary: 'The protagonist promised Chen Heng to escort the wounded.',
          importance: 'high',
          relatedNpcIds: ['npc_chen'],
          relatedLocationIds: ['loc_gate'],
        },
      ],
      npcInteractionSummaries: [
        {
          npcId: 'npc_chen',
          npcName: 'Chen Heng',
          summary: 'Chen Heng trusts the protagonist because of the escort promise.',
          updatedAt: 'day 25',
        },
      ],
      locationMemorySummaries: [
        {
          locationId: 'loc_gate',
          locationName: 'Gate',
          summary: 'The gate remains risky for escorting wounded people.',
          updatedAt: 'day 25',
        },
      ],
      settings: {
        recentRawTurnLimit: 3,
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

describe('MemoryContextPackage', () => {
  it('builds one bounded package for raw story turns, summaries, NPC memory, location memory, and retrieval', () => {
    const packageResult = buildMemoryContextPackage(makeState(), 'ask Chen about the escort promise');

    expect(packageResult.storyRecentRawTurns.map((turn) => turn.turnNumber)).toEqual([3, 4, 5]);
    expect(packageResult.storyRecentRawTurns[0].narrativeText).toContain('avoid a reckless clash');
    expect(packageResult.storyRecentSummaries.map((memory) => memory.id)).toEqual(['recent_escort']);
    expect(packageResult.storyMidTermSummaries.map((summary) => summary.summaryId)).toEqual(['mid_gate']);
    expect(packageResult.storyLongTermFacts.map((fact) => fact.factId)).toEqual(['fact_escort_promise']);
    expect(packageResult.npcInteractionSummaries.map((summary) => summary.npcId)).toEqual(['npc_chen']);
    expect(packageResult.locationMemorySummaries.map((summary) => summary.locationId)).toEqual(['loc_gate']);
    expect(packageResult.npcMemoryBlocks[0]).toMatchObject({
      npcId: 'npc_chen',
      totalMemoryCount: 2,
    });
    expect(packageResult.npcMemoryBlocks[0].retrievedMemories.map((memory) => memory.sourceId))
      .not.toContain('fact_escort_promise');
    expect(packageResult.budget.estimatedTokens).toBeGreaterThan(0);
  });

  it('keeps local story memory while trimming retrieval results by retrieval token budget', () => {
    const retrievedMemories: MemoryRetrievalResult[] = Array.from({ length: 8 }, (_, index) => ({
      retrievalMode: 'vector',
      sourceType: 'longTermFact',
      sourceId: `vector_${index + 1}`,
      text: `Retrieved vector memory ${index + 1}. `.repeat(40),
      score: 1 - index * 0.01,
      reason: 'test vector score',
    }));

    const packageResult = buildMemoryContextPackage(makeState(), 'escort promise', {
      retrievedMemories,
      settings: {
        retrievalTokenBudget: 50,
      },
    });

    expect(packageResult.storyRecentRawTurns).toHaveLength(3);
    expect(packageResult.storyRecentSummaries).toHaveLength(1);
    expect(packageResult.retrievedMemories.length).toBeLessThan(retrievedMemories.length);
    expect(packageResult.budget.omittedCounts.retrievedMemories).toBeGreaterThan(0);
  });

  it('does not exceed the hard memory token budget for an oversized recent raw turn', () => {
    const state = makeState();
    const oversizedState = {
      ...state,
      turnLog: [
        ...state.turnLog,
        makeTurnLogEntry(6, 'Oversized raw narrative. '.repeat(200)),
      ],
    } as RuntimeState;

    const packageResult = buildMemoryContextPackage(oversizedState, 'escort promise', {
      settings: {
        recentRawTurnLimit: 1,
        maxPromptMemoryTokens: 20,
        recentStoryTokenBudget: 20,
        npcMemoryTokenBudget: 0,
        midTermTokenBudget: 0,
        longTermFactTokenBudget: 0,
        locationMemoryTokenBudget: 0,
        retrievalTokenBudget: 0,
      },
    });

    expect(packageResult.budget.estimatedTokens).toBeLessThanOrEqual(20);
    expect(packageResult.storyRecentRawTurns).toHaveLength(0);
    expect(packageResult.budget.omittedCounts.storyRecentRawTurns).toBe(1);
  });

  it('formats the package as prompt memory layers without dropping recent raw narrative context', () => {
    const packageResult = buildMemoryContextPackage(makeState(), 'escort promise');
    const sections = formatMemoryContextPackageForPrompt(packageResult);
    const text = sections.join('\n');

    expect(text).toContain('近期正文回放：');
    expect(text).toContain('用途：仅用于确认已经发生的事实、人物称呼、行动结果与未解决后果，不是写作范文。');
    expect(text).toContain('<recent_narrative_reference>');
    expect(text).toContain('不要复用其中的起手、动作载体、句法、修辞或收束方式');
    expect(text).toContain('第5回合｜day 5｜The protagonist returned to ask about the escort route.');
    expect(text).toContain('近期剧情记忆：');
    expect(text).toContain('中期剧情摘要：');
    expect(text).toContain('长期档案记忆：');
    expect(text).toContain('NPC长期互动摘要：');
    expect(text).toContain('地点记忆摘要：');
    expect(text).not.toContain('检索到的相关旧记忆：');
  });

  it('projects at most twenty recent player key deeds inside the shared long-term memory budget', () => {
    const state = makeState();
    state.player.playerMemory = {
      summary: '玩家长期履历。',
      recentTurns: [],
      keyDeeds: Array.from({ length: 25 }, (_, index) => ({
        id: `deed_${index + 1}`,
        date: `day ${index + 1}`,
        locationId: 'loc_gate',
        summary: `关键事迹${index + 1}`,
        impact: `长期影响${index + 1}`,
      })),
    };

    const packageResult = buildMemoryContextPackage(state, 'review player history');
    const text = formatMemoryContextPackageForPrompt(packageResult).join('\n');

    expect(packageResult.playerKeyDeeds.map((deed) => deed.id))
      .toEqual(Array.from({ length: 20 }, (_, index) => `deed_${index + 6}`));
    expect(packageResult.budget.layerTokenEstimates.playerKeyDeeds).toBeGreaterThan(0);
    expect(packageResult.budget.omittedCounts.playerKeyDeeds).toBe(5);
    expect(text).toContain('玩家关键事迹：');
    expect(text).toContain('关键事迹25');
    expect(text).not.toContain('关键事迹5（');
  });

  it('feeds all long-term memories plus bounded mid-term, recent, and scoped retrieval for a present important NPC', () => {
    const state = makeState();
    state.memoryArchive!.longTermStorySummaries = Array.from({ length: 2 }, (_, index) => ({
      summaryId: `story_long_${index + 1}`,
      title: `Life chapter ${index + 1}`,
      fromCreatedAt: `day ${index * 100 + 1}`,
      toCreatedAt: `day ${(index + 1) * 100}`,
      summary: `Long player life summary ${index + 1}`,
      sourceMidTermSummaryIds: [`story_mid_${index + 1}`],
      updatedAt: `day ${(index + 1) * 100}`,
    }));
    state.memoryArchive!.npcMidTermSummaries = Array.from({ length: 6 }, (_, index) => ({
      summaryId: `npc_mid_${index + 1}`,
      npcId: 'npc_chen',
      npcName: 'Chen Heng',
      summary: `NPC mid memory ${index + 1}`,
      fromCreatedAt: `day ${index * 20 + 1}`,
      toCreatedAt: `day ${(index + 1) * 20}`,
      sourceMemoryIds: [`npc_raw_${index + 1}`],
      updatedAt: `day ${(index + 1) * 20}`,
    }));
    state.memoryArchive!.npcLongTermSummaries = Array.from({ length: 3 }, (_, index) => ({
      summaryId: `npc_long_${index + 1}`,
      npcId: 'npc_chen',
      npcName: 'Chen Heng',
      summary: `NPC long memory ${index + 1}`,
      fromCreatedAt: `day ${index * 200 + 1}`,
      toCreatedAt: `day ${(index + 1) * 200}`,
      sourceMidTermSummaryIds: [`npc_mid_${index + 1}`],
      updatedAt: `day ${(index + 1) * 200}`,
    }));

    const packageResult = buildMemoryContextPackage(state, 'ask Chen about the escort promise');
    const npcBlock = packageResult.npcMemoryBlocks[0];

    expect(packageResult.storyLongTermSummaries).toHaveLength(2);
    expect(npcBlock.longTermSummaries).toHaveLength(3);
    expect(npcBlock.midTermSummaries.map((summary) => summary.summaryId))
      .toEqual(['npc_mid_4', 'npc_mid_5', 'npc_mid_6']);
    expect(npcBlock.memories).toHaveLength(2);
    expect(npcBlock.retrievedMemories.length).toBeLessThanOrEqual(5);
    expect(formatMemoryContextPackageForPrompt(packageResult).join('\n')).toContain('NPC分层记忆：');
  });

  it('assigns each covered player memory to one prompt layer and excludes projected sources from recall', () => {
    const state = makeState();
    state.memoryArchive!.recentTurnSummaries.push(
      {
        id: 'recent_raw_turn_4',
        turnNumber: 4,
        createdAt: 'day 4',
        brief: 'This summary duplicates raw turn four.',
        importance: 'medium',
      },
      {
        id: 'recent_covered_by_mid',
        turnNumber: 2,
        createdAt: 'day 2',
        brief: 'This summary was folded into a mid-term chapter.',
        importance: 'medium',
      },
      {
        id: 'recent_covered_by_long',
        turnNumber: 1,
        createdAt: 'day 1',
        brief: 'This summary was folded through mid-term into long-term memory.',
        importance: 'medium',
      },
    );
    state.memoryArchive!.midTermSummaries.push(
      {
        summaryId: 'mid_active_owner',
        title: 'Active chapter',
        fromCreatedAt: 'day 1',
        toCreatedAt: 'day 3',
        summary: 'Owns the older recent summary.',
        sourceRecentTurnIds: ['recent_covered_by_mid'],
        updatedAt: 'day 3',
      },
      {
        summaryId: 'mid_covered_by_long',
        title: 'Folded chapter',
        fromCreatedAt: 'day 1',
        toCreatedAt: 'day 20',
        summary: 'This mid-term summary is already in long-term memory.',
        sourceRecentTurnIds: ['recent_covered_by_long'],
        updatedAt: 'day 20',
      },
    );
    state.memoryArchive!.longTermStorySummaries = [{
      summaryId: 'long_owner',
      title: 'Long chapter',
      fromCreatedAt: 'day 1',
      toCreatedAt: 'day 20',
      summary: 'Owns the folded mid-term chapter.',
      sourceMidTermSummaryIds: ['mid_covered_by_long'],
      updatedAt: 'day 20',
    }];
    const projectedDuplicates: MemoryRetrievalResult[] = [
      {
        retrievalMode: 'vector',
        sourceType: 'recentTurn',
        sourceId: 'recent_raw_turn_4',
        text: 'duplicate raw summary',
        score: 0.9,
        reason: 'test',
      },
      {
        retrievalMode: 'vector',
        sourceType: 'midTermSummary',
        sourceId: 'mid_active_owner',
        text: 'duplicate mid owner',
        score: 0.9,
        reason: 'test',
      },
      {
        retrievalMode: 'vector',
        sourceType: 'longTermFact',
        sourceId: 'fact_escort_promise',
        text: 'duplicate baseline fact',
        score: 0.9,
        reason: 'test',
      },
    ];

    const packageResult = buildMemoryContextPackage(state, 'escort promise', {
      retrievedMemories: projectedDuplicates,
    });

    expect(packageResult.storyRecentSummaries.map((item) => item.id)).not.toContain('recent_raw_turn_4');
    expect(packageResult.storyRecentSummaries.map((item) => item.id)).not.toContain('recent_covered_by_mid');
    expect(packageResult.storyRecentSummaries.map((item) => item.id)).not.toContain('recent_covered_by_long');
    expect(packageResult.storyMidTermSummaries.map((item) => item.summaryId)).toContain('mid_active_owner');
    expect(packageResult.storyMidTermSummaries.map((item) => item.summaryId)).not.toContain('mid_covered_by_long');
    expect(packageResult.storyLongTermSummaries.map((item) => item.summaryId)).toEqual(['long_owner']);
    expect(packageResult.retrievedMemories).toHaveLength(0);
  });

  it('projects NPC long, mid, and raw memories without feeding covered descendants twice', () => {
    const state = makeState();
    state.memoryArchive!.npcMidTermSummaries = [
      {
        summaryId: 'npc_mid_folded',
        npcId: 'npc_chen',
        npcName: 'Chen Heng',
        summary: 'Folded NPC chapter.',
        fromCreatedAt: 'day 1',
        toCreatedAt: 'day 10',
        sourceMemoryIds: ['mem_chen_1'],
        updatedAt: 'day 10',
      },
      {
        summaryId: 'npc_mid_active',
        npcId: 'npc_chen',
        npcName: 'Chen Heng',
        summary: 'Active NPC chapter.',
        fromCreatedAt: 'day 11',
        toCreatedAt: 'day 20',
        sourceMemoryIds: ['mem_chen_2'],
        updatedAt: 'day 20',
      },
    ];
    state.memoryArchive!.npcLongTermSummaries = [{
      summaryId: 'npc_long_owner',
      npcId: 'npc_chen',
      npcName: 'Chen Heng',
      summary: 'Long NPC memory.',
      fromCreatedAt: 'day 1',
      toCreatedAt: 'day 10',
      sourceMidTermSummaryIds: ['npc_mid_folded'],
      updatedAt: 'day 20',
    }];

    const packageResult = buildMemoryContextPackage(state, 'ask Chen about the escort', {
      retrievedMemories: [{
        retrievalMode: 'vector',
        sourceType: 'npcMemory',
        sourceId: 'mem_chen_1',
        text: 'Covered raw NPC memory.',
        relatedNpcIds: ['npc_chen'],
        score: 0.9,
        reason: 'test',
      }],
    });
    const block = packageResult.npcMemoryBlocks[0];

    expect(block.longTermSummaries.map((item) => item.summaryId)).toEqual(['npc_long_owner']);
    expect(block.midTermSummaries.map((item) => item.summaryId)).toEqual(['npc_mid_active']);
    expect(block.memories).toHaveLength(0);
    expect(block.retrievedMemories.map((item) => item.sourceId)).not.toContain('mem_chen_1');
    expect(packageResult.retrievedMemories.map((item) => item.sourceId)).not.toContain('mem_chen_1');
  });

  it('uses the shared CJK-aware estimator for memory budgets', () => {
    const state = makeState();
    state.turnLog = [makeTurnLogEntry(6, '汉'.repeat(100))];

    const packageResult = buildMemoryContextPackage(state, '测试', {
      settings: {
        recentRawTurnLimit: 1,
        maxPromptMemoryTokens: 30,
        recentStoryTokenBudget: 30,
        npcMemoryTokenBudget: 0,
        midTermTokenBudget: 0,
        longTermFactTokenBudget: 0,
        locationMemoryTokenBudget: 0,
        retrievalTokenBudget: 0,
      },
    });

    expect(packageResult.storyRecentRawTurns).toHaveLength(0);
    expect(packageResult.budget.omittedCounts.storyRecentRawTurns).toBe(1);
  });
});
