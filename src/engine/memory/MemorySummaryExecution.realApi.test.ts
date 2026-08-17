import { describe, expect, it } from 'vitest';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import { executeMemorySummaryCompression } from './MemorySummaryExecution';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_MEMORY_SUMMARY_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`记忆压缩真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_memory_summary',
    name: '记忆压缩真实 API',
    provider: requireEnvironment('COC_V2_MEMORY_SUMMARY_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_MEMORY_SUMMARY_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_MEMORY_SUMMARY_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_MEMORY_SUMMARY_TEST_API_MODEL'),
    temperature: 0,
    maxOutputTokens: 4_096,
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  };
}

function makeState(recentCount: number, npcMemoryCount: number): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '1.7.4',
    worldBookId: 'memory-summary-real-api-test',
    worldBookVersion: '1.0.0',
    worldBookSource: 'official',
    startDate: '公元184年03月01日 08:00（辰时）',
    currentDate: '公元184年03月04日 08:00（辰时）',
    currentLocationId: 'loc_camp',
    player: {
      id: 'player_memory_real_api',
      name: '林砚',
      roleType: '军中书吏',
      summary: '在汉水北岸大营处理军粮与巡夜事务。',
    },
    knownActors: [], knownFactions: [], relationships: [], knownRumors: [], activeQuests: [],
    playerResources: {}, worldStateDelta: {}, localSituationNotes: [],
    turnLog: Array.from({ length: recentCount }, (_, index) => ({
      turnNumber: index + 1,
      date: `公元184年03月0${index + 1}日 08:00（辰时）`,
      playerInput: index % 2 === 0 ? '巡查营门并核对军粮。' : '与门候确认夜间口令。',
      narrativeText: index % 2 === 0
        ? '林砚巡查营门，核对粮车封签，发现账目与实物相符。'
        : '门候向林砚复述夜间口令，双方确认没有异常人员进出。',
      fullNarrativeText: index % 2 === 0
        ? '林砚巡查汉水北岸大营营门，逐车核对粮草封签；账目与实物相符，未发现短缺。'
        : '门候向林砚复述当夜口令与换岗时刻，双方确认没有异常人员进出营地。',
      statePatchSummary: '营门与军粮巡查完成，无资源变化。',
      timestamp: `2026-08-07T00:0${index}:00.000Z`,
    })),
    locations: [{
      locationId: 'loc_camp', name: '汉水北岸大营', type: '军营',
      summary: '朝廷军队驻扎的临时营地。', knownLevel: '亲历', recentEvents: [],
    }],
    npcs: [{
      npcId: 'npc_gate_guard_real_api', name: '门候陈七', sex: '男', age: 37,
      role: '营门门候', locationId: 'loc_camp', isPresent: true, isFocused: true,
      summary: '负责营门轮值与口令核验。', appearance: '披旧札甲。', personality: '谨慎守规矩。',
      motivation: '保证营门不出差错。', relationToPlayer: '服从林砚的巡查安排。',
      contactLevel: 18, recentAttitude: '认真配合',
      memories: Array.from({ length: npcMemoryCount }, (_, index) => ({
        memoryId: `npc_real_memory_${index + 1}`,
        source: index === 3 ? '听闻' : '亲历',
        content: index === 3
          ? '门候听同袍说营外可能有黄巾斥候，但尚未亲眼确认。'
          : `门候第${index + 1}次与林砚核对营门口令，过程没有异常。`,
        createdAt: `公元184年03月0${index + 1}日 08:00（辰时）`,
      })),
    }],
    memoryArchive: {
      recentTurnSummaries: Array.from({ length: recentCount }, (_, index) => ({
        id: `recent_real_${index + 1}`,
        turnNumber: index + 1,
        createdAt: `公元184年03月0${index + 1}日 08:00（辰时）`,
        playerInput: index % 2 === 0 ? '巡查营门并核对军粮。' : '与门候确认夜间口令。',
        brief: index % 2 === 0 ? '军粮巡查无误。' : '营门口令核验无误。',
        importance: index === 0 ? 'high' : 'medium',
      })),
      midTermSummaries: [], longTermStorySummaries: [], longTermFacts: [],
      npcInteractionSummaries: [], npcMidTermSummaries: [], npcLongTermSummaries: [],
      locationMemorySummaries: [],
      settings: {
        recentRawTurnLimit: 4, recentTurnLimit: 8, recentTurnCompressThreshold: 4,
        recentTurnKeepAfterCompress: 2, npcRecentMemoryDefaultLimit: 4,
        npcRecentMemoryImportantLimit: 6, focusedNpcRecentMemoryLimit: 4,
        npcMemoryCompressThreshold: 4, npcMemoryKeepAfterCompress: 2,
        locationMemoryCompressThreshold: 30, taskMemoryCompressThreshold: 30,
        midTermSummaryLimit: 4, longTermFactLimit: 8, vectorResultLimit: 6,
        maxPromptMemoryTokens: 20_000, recentStoryTokenBudget: 8_000,
        npcMemoryTokenBudget: 6_000, midTermTokenBudget: 3_000,
        longTermFactTokenBudget: 3_000, locationMemoryTokenBudget: 2_000,
        retrievalTokenBudget: 4_000, enableAutoMemorySummary: true,
        preferDedicatedMemorySummaryApi: true,
      },
    },
  } as RuntimeState);
}

describe.runIf(REAL_API_ENABLED)('记忆压缩分层阈值真实 API 验收', () => {
  it('只有玩家短期达到阈值时只生成玩家中期层', async () => {
    const state = makeState(4, 3);
    const startedAt = Date.now();
    const result = await executeMemorySummaryCompression(state, {
      apiConfig: makeApiConfig(),
      llmClient: new BrowserLlmClient(),
      timeoutMs: 120_000,
    }, 'memorySummary');

    const diagnostics = JSON.stringify({
      status: result.status, reason: result.reason, activeScopes: result.activeScopes,
      appliedSummaries: result.appliedSummaries, ignoredSummaries: result.ignoredSummaries,
      rawContent: result.rawContent,
    });
    expect(result.status, diagnostics).toBe('applied');
    expect(result.activeScopes).toEqual(['playerRecentToMid']);
    expect(result.newState.memoryArchive?.midTermSummaries).toHaveLength(1);
    expect(result.newState.memoryArchive?.longTermStorySummaries).toHaveLength(0);
    expect(result.newState.memoryArchive?.npcMidTermSummaries).toHaveLength(0);
    expect(result.newState.memoryArchive?.npcLongTermSummaries).toHaveLength(0);
    expect(result.newState.memoryArchive?.recentTurnSummaries).toHaveLength(2);
    expect(result.newState.turnLog).toHaveLength(4);
    console.info(JSON.stringify({
      case: 'playerRecentToMid', elapsedMs: Date.now() - startedAt,
      provider: result.provider, model: result.model, usage: result.usage,
    }));
  }, 150_000);

  it('只有 NPC 原始记忆达到阈值时只生成 NPC 中期层', async () => {
    const state = makeState(3, 4);
    const startedAt = Date.now();
    const result = await executeMemorySummaryCompression(state, {
      apiConfig: makeApiConfig(),
      llmClient: new BrowserLlmClient(),
      timeoutMs: 120_000,
    }, 'memorySummary');

    const diagnostics = JSON.stringify({
      status: result.status, reason: result.reason, activeScopes: result.activeScopes,
      appliedSummaries: result.appliedSummaries, ignoredSummaries: result.ignoredSummaries,
      rawContent: result.rawContent,
    });
    expect(result.status, diagnostics).toBe('applied');
    expect(result.activeScopes).toEqual(['npcRawToMid']);
    expect(result.newState.memoryArchive?.midTermSummaries).toHaveLength(0);
    expect(result.newState.memoryArchive?.longTermStorySummaries).toHaveLength(0);
    expect(result.newState.memoryArchive?.npcMidTermSummaries).toHaveLength(1);
    expect(result.newState.memoryArchive?.npcLongTermSummaries).toHaveLength(0);
    expect(result.newState.memoryArchive?.recentTurnSummaries).toHaveLength(3);
    expect(result.newState.npcs?.[0].memories).toHaveLength(2);
    console.info(JSON.stringify({
      case: 'npcRawToMid', elapsedMs: Date.now() - startedAt,
      provider: result.provider, model: result.model, usage: result.usage,
    }));
  }, 150_000);
});
