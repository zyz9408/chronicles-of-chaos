import { describe, expect, it } from 'vitest';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { BrowserLlmClient, type LlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import { executeTurn } from './TurnOrchestrator';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_RESOURCE_LEDGER_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`府库资源写回真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_resource_ledger_writeback',
    name: '府库资源写回真实 API 验收',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0,
    maxOutputTokens: 8_000,
    createdAt: '2026-08-02T01:00:00.000Z',
    updatedAt: '2026-08-02T01:00:00.000Z',
  };
}

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook_ThreeKingdoms.manifest.id,
    worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
    worldBookSource: 'official',
    startDate: '公元189年09月01日 08:00（辰时）',
    currentDate: '公元189年09月04日 10:00（巳时）',
    currentTime: { year: 189, month: 9, day: 4, hour: 10, minute: 0 },
    player: {
      id: 'player_resource_ledger_test',
      name: '林砚',
      roleType: '军中书吏',
      summary: '奉命协助仓曹清点并接收已经获批的军粮。',
      inventory: [],
    },
    currentLocationId: 'loc_yingchuan_granary',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    resources: {
      money: 120,
      grain: 89,
      horses: 3,
      arms: 20,
      recruits: 40,
      weapons: [],
      documents: [],
      tokens: [],
      importantSupplies: [],
    },
    playerResources: { 粮饷: 36 },
    worldStateDelta: {},
    turnLog: [{
      turnNumber: 21,
      date: '公元189年09月04日 09:40（巳时）',
      timestamp: '2026-08-02T01:00:00.000Z',
      playerInput: '核对拨粮文书',
      narrativeText: '仓曹核完拨粮与军饷文书，确认二百石军粮和五十贯公款已经获批，粮车与钱箱也已抵达府库门前，等待正式交割。',
      statePatchSummary: '拨粮资格与数量已确认，尚未入库',
    }],
    localSituationNotes: ['二百石军粮和五十贯公款已经获批并运抵；原府库粮草为八十九石、钱财为一百二十贯，本回合可完成交割。'],
    npcs: [],
    locations: [{
      locationId: 'loc_yingchuan_granary',
      name: '颍川军府粮仓',
      type: '府库',
      summary: '军府清点并保管公用粮草的仓场。',
      knownLevel: '亲历',
      recentEvents: [],
    }],
  });
}

function makeCompletedDeliveryFixtureClient(): LlmClient {
  return {
    generate: async () => ({
      content: JSON.stringify({
        protocolVersion: 'lsfy.turn.v1',
        narrativeText: '仓曹逐项点清粮车与钱箱，二百石军粮和五十贯公款已经完成交割并全部收入军府府库。',
        suggestedActions: [],
        statePatches: [{
          type: 'timeAdvance',
          payload: { minutesAdvanced: 20, reason: '清点并交割府库资源', category: 'administration' },
          reason: '府库交割耗时',
        }],
        statePatch: null,
        writeback: {
          npcProfileSuggestions: [],
          npcMemorySuggestions: [],
          locationWriteSuggestions: [],
          routeWriteSuggestions: [],
          questChanges: [],
          debugNotes: [],
        },
      }),
      provider: 'openai_compatible',
      model: 'deterministic-delivery-fixture',
    }),
  };
}

describe.runIf(REAL_API_ENABLED)('府库标准资源唯一账本真实 API 验收', () => {
  it('writes accepted grain and public money in canonical shi/guan units instead of personal money units', async () => {
    const apiConfig = makeApiConfig();
    const llmClient = new BrowserLlmClient();
    const result = await executeTurn(
      worldBook_ThreeKingdoms,
      makeState(),
      '我与仓曹当面完成这二百石军粮和五十贯军饷的正式交割，命人全部收入军府粮仓与府库。'
        + '这是已经获批并运抵的公共资源，不是个人携带的钱粮；府库原有一百二十贯，交割后应为一百七十贯。',
      {
        apiConfig,
        stateWritebackApiConfig: apiConfig,
        llmClient,
        stateWritebackLlmClient: llmClient,
      },
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.resources?.money).toBe(170);
    expect(result.newRuntimeState.resources?.grain).toBe(289);
    expect(result.newRuntimeState.playerResources).not.toHaveProperty('粮草');
    expect(result.newRuntimeState.playerResources).not.toHaveProperty('grain');
    expect(result.newRuntimeState.player?.personalMoney ?? 0).toBe(0);
    expect(result.newRuntimeState.turnLog[result.newRuntimeState.turnLog.length - 1]?.statePatchSummary)
      .toContain('grain=289');
    expect(result.newRuntimeState.turnLog[result.newRuntimeState.turnLog.length - 1]?.statePatchSummary)
      .toContain('money=170贯, delta=+50贯');
  }, 300_000);

  it('状态写回主要 API 失败后切换真实备用 API并完成府库落账', async () => {
    const fallbackApiConfig = makeApiConfig();
    const primaryFailureClient: LlmClient = {
      generate: async () => {
        throw new Error('fixture primary state writeback outage');
      },
    };
    const result = await executeTurn(
      worldBook_ThreeKingdoms,
      makeState(),
      '我与仓曹完成二百石军粮和五十贯公款的正式交割，全部收入军府府库。',
      {
        apiConfig: fallbackApiConfig,
        stateWritebackApiConfig: {
          ...fallbackApiConfig,
          id: 'api_fixture_state_primary_failure',
          model: 'fixture-primary-failure',
        },
        stateWritebackFallbackApiConfig: fallbackApiConfig,
        llmClient: makeCompletedDeliveryFixtureClient(),
        stateWritebackLlmClient: primaryFailureClient,
        stateWritebackFallbackLlmClient: new BrowserLlmClient(),
      },
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.resources?.money).toBe(170);
    expect(result.newRuntimeState.resources?.grain).toBe(289);
    expect(result.writeback?.debugNotes).toContain(
      `状态写回主要 API 失败，已切换备用 API：${fallbackApiConfig.model}`,
    );
  }, 300_000);
});
