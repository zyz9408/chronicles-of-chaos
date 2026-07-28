import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmGenerateRequest } from '../llm/LlmClient';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import { setApiTaskRouteAsync, upsertApiConfigAsync } from '../settings/ApiConfigManager';
import { savePromptOverride } from '../prompts/PromptOverrideStore';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { resetLocalDatabaseForTests } from '../storage/IndexedDbStore';
import type { RuntimeState } from '../types';
import {
  appendMemorySummaryExecutionSummary,
  buildMemorySummaryCompressionMessages,
  executeMemorySummaryCompression,
  executeMemorySummaryCompressionWithConfiguredApi,
  parseMemorySummaryResult,
  reapplyMemorySummaryExecutionResult,
  type MemorySummaryExecutionResult,
} from './MemorySummaryExecution';
import { buildRecentTurnMemorySummaryTask } from './MemorySummaryProjection';

const makeConfig = (overrides: Partial<ApiConfigArchive> = {}): ApiConfigArchive => ({
  id: overrides.id ?? 'api_memory',
  name: overrides.name ?? 'memory api',
  provider: 'openai_compatible',
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: overrides.model ?? 'memory-model',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function makeRecentTurn(index: number) {
  return {
    id: `recent_${index}`,
    turnNumber: index,
    createdAt: `day ${index}`,
    playerInput: `player action ${index}`,
    brief: `brief ${index} about escort promise at the gate`,
    importance: index % 5 === 0 ? 'high' as const : 'medium' as const,
  };
}

function makeState(recentCount = 35): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'memory-summary-execution-test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: 'day 1',
    currentDate: 'day 35',
    player: {
      id: 'player',
      name: 'Player',
      roleType: 'wanderer',
      summary: 'A protagonist used by memory summary tests.',
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
      playerInput: `player action ${index + 1}`,
      narrativeText: `short narrative ${index + 1}`,
      fullNarrativeText: `full narrative ${index + 1}`,
      statePatchSummary: 'none',
      timestamp: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    })),
    localSituationNotes: [],
    locations: [
      {
        locationId: 'loc_gate',
        name: 'Gate',
        type: '场所',
        summary: 'A guarded gate.',
        knownLevel: '亲历',
        recentEvents: [],
      },
    ],
    npcs: [
      {
        npcId: 'npc_guard',
        name: 'Gate Guard',
        sex: '男',
        age: 39,
        role: 'guard',
        locationId: 'loc_gate',
        isPresent: true,
        isFocused: true,
        summary: 'A cautious gate guard.',
        appearance: 'Old armor.',
        personality: 'Careful.',
        motivation: 'Avoid trouble.',
        relationToPlayer: 'Watches the protagonist.',
        contactLevel: 8,
        recentAttitude: 'wary',
        memories: [
          {
            memoryId: 'mem_guard_1',
            source: '亲历',
            content: 'The guard saw the protagonist ask about the escort promise.',
            createdAt: 'day 20',
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
        vectorResultLimit: 6,
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

function makeSummaryContent() {
  return JSON.stringify({
    midTermSummaries: [
      {
        summaryId: 'mid_gate_1',
        title: 'Gate escort arc',
        fromCreatedAt: 'day 1',
        toCreatedAt: 'day 23',
        summary: 'The protagonist repeatedly dealt with the guarded gate and the escort promise.',
        relatedNpcIds: ['npc_guard'],
        relatedLocationIds: ['loc_gate'],
        updatedAt: 'day 35',
      },
    ],
    longTermFacts: [
      {
        factId: 'fact_escort_promise',
        category: 'promise',
        createdAt: 'day 20',
        summary: 'The protagonist made a lasting escort promise.',
        importance: 'high',
        relatedNpcIds: ['npc_guard'],
        relatedLocationIds: ['loc_gate'],
      },
    ],
    npcInteractionSummaries: [
      {
        npcId: 'npc_guard',
        npcName: 'Gate Guard',
        summary: 'The guard knows the protagonist keeps asking about the escort promise.',
        fromCreatedAt: 'day 20',
        toCreatedAt: 'day 22',
        sourceMemoryIds: ['mem_guard_1'],
        updatedAt: 'day 35',
      },
    ],
    locationMemorySummaries: [
      {
        locationId: 'loc_gate',
        locationName: 'Gate',
        summary: 'The gate remains tense and risky for escorts.',
        updatedAt: 'day 35',
      },
    ],
  });
}

describe('MemorySummaryExecution', () => {
  beforeEach(async () => {
    await resetLocalDatabaseForTests();
    vi.unstubAllGlobals();
  });

  it('skips compression before the recent-turn threshold', async () => {
    const llmClient = {
      generate: vi.fn(),
    };

    const result = await executeMemorySummaryCompression(makeState(19), {
      apiConfig: makeConfig(),
      llmClient,
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('threshold not reached');
    expect(llmClient.generate).not.toHaveBeenCalled();
  });

  it('calls the summary model, applies layered summaries, prunes active recent summaries, and preserves full turn logs', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: makeSummaryContent(),
        provider: 'openai_compatible' as const,
        model: 'memory-model',
        usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
      })),
    };
    const state = makeState(35);

    const result = await executeMemorySummaryCompression(state, {
      apiConfig: makeConfig(),
      llmClient,
    });

    expect(result.status).toBe('applied');
    expect(llmClient.generate).toHaveBeenCalledOnce();
    const generateCalls = llmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    const request = generateCalls[0][0];
    expect(request.config.model).toBe('memory-model');
    expect(request.responseFormat).toBe('json_object');
    expect(request.messages.map((message) => message.content).join('\n')).toContain('短期记忆压缩为中期摘要');

    expect(result.newState.memoryArchive?.midTermSummaries[0].summary).toContain('guarded gate');
    expect(result.newState.memoryArchive?.longTermFacts[0].factId).toBe('fact_escort_promise');
    expect(result.newState.memoryArchive?.npcInteractionSummaries[0].npcId).toBe('npc_guard');
    expect(result.newState.memoryArchive?.locationMemorySummaries[0].locationId).toBe('loc_gate');
    expect(result.newState.memoryArchive?.recentTurnSummaries.map((item) => item.id)).toEqual(
      Array.from({ length: 15 }, (_, index) => `recent_${index + 21}`),
    );
    expect(result.newState.turnLog).toHaveLength(35);
    expect(result.usage?.totalTokens).toBe(140);
  });

  it('reapplies a completed background result without dropping turns or recent memories added while the API was running', async () => {
    const source = makeState(35);
    const result = await executeMemorySummaryCompression(source, {
      apiConfig: makeConfig(),
      llmClient: {
        generate: vi.fn(async () => ({
          content: makeSummaryContent(),
          provider: 'openai_compatible' as const,
          model: 'memory-model',
        })),
      },
    });
    const latest = makeState(37);

    const rebased = reapplyMemorySummaryExecutionResult(latest, result);

    expect(rebased.status).toBe('applied');
    expect(rebased.newState.turnLog).toHaveLength(37);
    expect(rebased.newState.memoryArchive?.recentTurnSummaries.map((item) => item.id)).toEqual(
      Array.from({ length: 17 }, (_, index) => `recent_${index + 21}`),
    );
    expect(rebased.newState.memoryArchive?.midTermSummaries[0].summary).toContain('guarded gate');
  });

  it('uses memory summary system and user prompt overrides', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    savePromptOverride('memory.summaryCompressionSystemPrompt', 'MEMORY_SYSTEM_SENTINEL', storage);
    savePromptOverride('memory.summaryCompressionUserPrompt', 'MEMORY_USER_SENTINEL {sourceRecentTurnSummaries}', storage);
    const llmClient = {
      generate: vi.fn(async () => ({
        content: makeSummaryContent(),
        provider: 'openai_compatible' as const,
        model: 'memory-model',
      })),
    };

    await executeMemorySummaryCompression(makeState(35), {
      apiConfig: makeConfig(),
      llmClient,
    });

    const generateCalls = llmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    const messages = generateCalls[0][0].messages;
    expect(messages[0].content).toContain('MEMORY_SYSTEM_SENTINEL');
    expect(messages[1].content).toContain('MEMORY_USER_SENTINEL');
    expect(messages[1].content).toContain('brief 1 about escort promise');
  });

  it('resolves the configured memory route and falls back to the main narrative API when memorySummary is unset', async () => {
    const mainConfig = await upsertApiConfigAsync(makeConfig({
      id: 'api_main',
      name: 'main api',
      model: 'main-model',
    }));
    await setApiTaskRouteAsync('mainNarrative', mainConfig.id);

    const llmClient = {
      generate: vi.fn(async () => ({
        content: makeSummaryContent(),
        provider: 'openai_compatible' as const,
        model: 'main-model',
      })),
    };

    const fallbackResult = await executeMemorySummaryCompressionWithConfiguredApi(makeState(35), {
      llmClient,
    });

    expect(fallbackResult.status).toBe('applied');
    const generateCalls = llmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    let request = generateCalls[0][0];
    expect(request.config.model).toBe('main-model');

    const memoryConfig = await upsertApiConfigAsync(makeConfig({
      id: 'api_memory',
      name: 'memory api',
      model: 'memory-model',
    }));
    await setApiTaskRouteAsync('memorySummary', memoryConfig.id);

    await executeMemorySummaryCompressionWithConfiguredApi(makeState(35), {
      llmClient,
    });

    request = generateCalls[1][0];
    expect(request.config.model).toBe('memory-model');
  });

  it('uses the main narrative API when the save disables the dedicated memory summary API', async () => {
    const mainConfig = await upsertApiConfigAsync(makeConfig({
      id: 'api_main',
      name: 'main api',
      model: 'main-model',
    }));
    const memoryConfig = await upsertApiConfigAsync(makeConfig({
      id: 'api_memory',
      name: 'memory api',
      model: 'memory-model',
    }));
    await setApiTaskRouteAsync('mainNarrative', mainConfig.id);
    await setApiTaskRouteAsync('memorySummary', memoryConfig.id);

    const llmClient = {
      generate: vi.fn(async () => ({
        content: makeSummaryContent(),
        provider: 'openai_compatible' as const,
        model: 'main-model',
      })),
    };
    const state = makeState(35);
    state.memoryArchive!.settings.preferDedicatedMemorySummaryApi = false;

    const result = await executeMemorySummaryCompressionWithConfiguredApi(state, {
      llmClient,
    });

    expect(result.status).toBe('applied');
    expect(result.apiTaskId).toBe('mainNarrative');
    const generateCalls = llmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    expect(generateCalls[0][0].config.model).toBe('main-model');
  });

  it('records whether compression used the dedicated memory API or the main API fallback', () => {
    const baseResult: MemorySummaryExecutionResult = {
      status: 'applied',
      newState: makeState(35),
      appliedSummaries: ['midTermSummaries'],
      ignoredSummaries: [],
      sourceRecentTurnCount: 24,
      keptRecentTurnCount: 12,
    };
    const fallbackState = makeState(35);
    const dedicatedState = makeState(35);

    appendMemorySummaryExecutionSummary(fallbackState, {
      ...baseResult,
      newState: fallbackState,
      apiTaskId: 'mainNarrative',
    });
    appendMemorySummaryExecutionSummary(dedicatedState, {
      ...baseResult,
      newState: dedicatedState,
      apiTaskId: 'memorySummary',
    });

    expect(fallbackState.turnLog[34].statePatchSummary).toContain('memorySummary[mainNarrative]');
    expect(dedicatedState.turnLog[34].statePatchSummary).toContain('memorySummary[memorySummary]');
  });

  it('parses fenced JSON summary responses and normalizes missing optional fields', () => {
    const parsed = parseMemorySummaryResult(
      [
        '```json',
        JSON.stringify({
          longTermFacts: [
            {
              factId: 'fact_1',
              category: 'invalid-category',
              createdAt: 'day 1',
              summary: 'Important fact.',
              importance: 'critical',
            },
          ],
          npcInteractionSummaries: [
            {
              npcId: 'npc_1',
              npcName: 'NPC One',
              summary: 'NPC summary.',
            },
          ],
        }),
        '```',
      ].join('\n'),
      'day 35',
    );

    expect(parsed.longTermFacts?.[0]).toMatchObject({
      factId: 'fact_1',
      category: 'other',
      importance: 'critical',
    });
    expect(parsed.npcInteractionSummaries?.[0]).toMatchObject({
      npcId: 'npc_1',
      updatedAt: 'day 35',
    });
  });

  it('appends non-overridable batch qualification and stable fact-id reuse rules to compression prompts', () => {
    const state = makeState(1);
    state.npcs![0].memories = Array.from({ length: 20 }, (_, index) => ({
      memoryId: `npc_prompt_${index + 1}`,
      source: '亲历',
      content: `NPC记忆${index + 1}`,
      createdAt: `day ${index + 1}`,
    }));
    const task = buildRecentTurnMemorySummaryTask(state);
    const messages = buildMemorySummaryCompressionMessages(task);
    const userPrompt = messages.find((message) => message.role === 'user')?.content ?? '';

    expect(userPrompt).toContain('playerRecentBatchQualified: false');
    expect(userPrompt).toContain('playerRecentBatchThreshold: 20');
    expect(userPrompt).toContain('longTermFacts=[]');
    expect(userPrompt).toContain('每个合格玩家批次只返回一条摘要');
    expect(userPrompt).toContain('来源 ID 和稳定摘要 ID 由本地覆盖');
    expect(userPrompt).toContain('复用已有 factId');
    expect(userPrompt).toContain('不得仅更换 factId 新增同义事实');
    expect(userPrompt).toContain('完成、失败、失效');
    expect(userPrompt).toContain('不得重新压缩成待办');
    expect(userPrompt).toContain('亲历、听闻、误会、推测');
    expect(userPrompt).toContain('NPC 相信的内容不得自动写成世界客观事实');
  });
});
