import { describe, expect, it } from 'vitest';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import type { MemoryRetrievalResult } from './MemoryRetrieval';
import { buildMemoryRecallProjection } from './MemoryRecallProjection';

function makeState(): RuntimeState {
  const state = ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'memory-recall-v2-test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'custom',
    startDate: 'day 1',
    currentDate: 'day 12',
    player: { id: 'player', name: '刘平', roleType: 'wanderer', summary: '测试主角' },
    currentLocationId: 'loc_gate',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    localSituationNotes: [],
    locations: [{
      locationId: 'loc_gate',
      name: '北门',
      type: '场所',
      summary: '伤兵聚集的城门',
      knownLevel: '亲历',
      recentEvents: [],
    }],
    npcs: [],
    turnLog: [{
      turnNumber: 7,
      date: 'day 7',
      playerInput: '答应护送伤兵',
      narrativeText: '第七回合摘要正文',
      fullNarrativeText: '刘平在北门当众答应陈衡，亲自护送伤兵出城。这是需要保留的完整原文。',
      statePatchSummary: 'none',
      timestamp: '2026-07-17T00:00:00.000Z',
    }],
  });
  state.memoryArchive.recentTurnSummaries = [{
    id: 'recent_7',
    turnNumber: 7,
    createdAt: 'day 7',
    playerInput: '答应护送伤兵',
    brief: '刘平答应陈衡护送伤兵出城。',
    importance: 'high',
  }];
  state.memoryArchive.longTermFacts = Array.from({ length: 8 }, (_, index) => ({
    factId: `fact_${index + 1}`,
    category: 'promise' as const,
    createdAt: `day ${index + 1}`,
    summary: `北门护送约定线索${index + 1}`,
    importance: 'high' as const,
  }));
  return state;
}

function candidate(
  sourceType: MemoryRetrievalResult['sourceType'],
  sourceId: string,
  score: number,
  retrievalMode: MemoryRetrievalResult['retrievalMode'] = 'vector',
): MemoryRetrievalResult {
  return {
    retrievalMode,
    sourceType,
    sourceId,
    text: sourceType === 'recentTurn' ? '刘平答应陈衡护送伤兵出城。' : `召回内容 ${sourceId}`,
    score,
    reason: retrievalMode === 'vector' ? 'embedding cosine similarity' : '关键词匹配：护送',
  };
}

describe('MemoryRecallProjection', () => {
  it('merges vector and local candidates by stable source key and rejects vector-only noise', () => {
    const state = makeState();
    const result = buildMemoryRecallProjection(state, '继续履行北门护送约定', [
      candidate('recentTurn', 'recent_7', 0.72),
      candidate('longTermFact', 'fact_1', 0.12),
    ], {
      localCandidates: [
        candidate('recentTurn', 'recent_7', 12, 'local'),
        candidate('longTermFact', 'fact_2', 8, 'local'),
      ],
    });

    expect(result.candidateCount).toBe(2);
    expect(result.retrievedMemories.filter((item) => item.sourceId === 'recent_7')).toHaveLength(1);
    expect(result.retrievedMemories.map((item) => item.sourceId)).not.toContain('fact_1');
    expect(result.retrievedMemories.map((item) => item.sourceId)).toContain('fact_2');
  });

  it('hydrates strong one-turn recall from turnLog while weak recall keeps its summary', () => {
    const state = makeState();
    const result = buildMemoryRecallProjection(state, '陈衡与伤兵的护送约定', [
      candidate('recentTurn', 'recent_7', 0.91),
      candidate('longTermFact', 'fact_1', 0.34),
    ], { localCandidates: [] });

    const strong = result.retrievedMemories.find((item) => item.sourceId === 'recent_7');
    const weak = result.retrievedMemories.find((item) => item.sourceId === 'fact_1');

    expect(strong).toMatchObject({ recallStrength: 'strong', contentMode: 'original', sourceTurnNumber: 7 });
    expect(strong?.text).toContain('完整原文');
    expect(weak).toMatchObject({ recallStrength: 'weak', contentMode: 'summary' });
    expect(weak?.text).toBe('召回内容 fact_1');
  });

  it('caps strong and weak results and prevents one source type from monopolizing recall', () => {
    const state = makeState();
    const vectorCandidates = [
      ...Array.from({ length: 8 }, (_, index) => candidate('longTermFact', `fact_${index + 1}`, 0.95 - index * 0.02)),
      candidate('recentTurn', 'recent_7', 0.9),
      candidate('midTermSummary', 'mid_1', 0.88),
      candidate('locationMemorySummary', 'loc_gate', 0.32),
    ];
    const result = buildMemoryRecallProjection(state, '北门护送', vectorCandidates, { localCandidates: [] });

    expect(result.strongMemories.length).toBeLessThanOrEqual(4);
    expect(result.weakMemories.length).toBeLessThanOrEqual(6);
    expect(result.retrievedMemories.filter((item) => item.sourceType === 'longTermFact').length).toBeLessThanOrEqual(2);
    expect(result.retrievedMemories.some((item) => item.sourceType === 'recentTurn')).toBe(true);
    expect(result.retrievedMemories.some((item) => item.sourceType === 'midTermSummary')).toBe(true);
  });

  it('honors projected source exclusions before classifying recall', () => {
    const state = makeState();
    const result = buildMemoryRecallProjection(state, '北门护送', [
      candidate('recentTurn', 'recent_7', 0.9),
      candidate('longTermFact', 'fact_1', 0.8),
    ], {
      localCandidates: [],
      excludedSourceKeys: new Set(['recentTurn:recent_7']),
    });

    expect(result.retrievedMemories.map((item) => item.sourceId)).toEqual(['fact_1']);
  });
});
