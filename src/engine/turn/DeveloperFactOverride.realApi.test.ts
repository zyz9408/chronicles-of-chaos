import { describe, expect, it } from 'vitest';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import { executeDeveloperFactOverride } from './DeveloperFactOverride';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_DEVELOPER_OVERRIDE_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`开发者事实纠错真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_developer_override',
    name: '开发者事实纠错真实 API 验收',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0,
    maxOutputTokens: 8_000,
    createdAt: '2026-08-05T13:55:00.000Z',
    updatedAt: '2026-08-05T13:55:00.000Z',
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
      id: 'player_developer_override_test',
      name: '林砚',
      roleType: '军中书吏',
      summary: '测试开发者事实纠错，不推进剧情。',
      inventory: [],
    },
    currentLocationId: 'place_jingzhou_xinye',
    currentPlaceId: 'place_jingzhou_xinye',
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
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
  });
}

describe.runIf(REAL_API_ENABLED)('开发者事实纠错真实 API 验收', () => {
  it('translates an authoritative fact into one legal patch without narrative or time side effects', async () => {
    const state = makeState();
    const apiConfig = makeApiConfig();
    const result = await executeDeveloperFactOverride({
      worldBook: worldBook_ThreeKingdoms,
      runtimeState: state,
      fact: '府库粮草的准确总量应该是2000石，只修正这个数值。',
      llmClient: new BrowserLlmClient(),
      resolvePrimaryConfig: async () => apiConfig,
      resolveFallbackConfig: async () => null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.state.resources?.grain).toBe(2000);
    expect(result.state.resources?.money).toBe(120);
    expect(result.state.currentDate).toBe(state.currentDate);
    expect(result.state.currentTime).toEqual(state.currentTime);
    expect(result.state.turnLog).toHaveLength(0);
    expect(result.patches).toHaveLength(1);
  }, 300_000);

  it('accepts a large-city cadastral correction and promotes only its civil scale', async () => {
    const state = makeState();
    state.currentLocationId = 'place_nanyang_wan';
    state.currentPlaceId = 'place_nanyang_wan';
    state.holdings = [{
      holdingId: 'holding_wancheng_real_api',
      name: '宛城',
      type: 'city',
      status: 'controlled',
      summary: '玩家控制的南阳郡治。',
      locationId: 'place_nanyang_wan',
      civilAdministrationScope: 'territorial',
      civilScaleLevel: 2,
      scaleLevel: 2,
      agriculture: 70,
      commerce: 72,
      population: 80,
      publicOrder: 60,
      popularSupport: 58,
      defense: 65,
      recruitPotential: 55,
      armory: 50,
      horseSupply: 25,
      corruption: 30,
      farmlandMu: 60_000,
      registeredHouseholds: 5_000,
      updatedAt: '公元189年09月04日 10:00（巳时）',
    }];
    const apiConfig = makeApiConfig();
    const result = await executeDeveloperFactOverride({
      worldBook: worldBook_ThreeKingdoms,
      runtimeState: state,
      fact: '宛城账面田亩的准确值应该是1200000亩，编户的准确值应该是90000户；只纠正这两个账面值。',
      llmClient: new BrowserLlmClient(),
      resolvePrimaryConfig: async () => apiConfig,
      resolveFallbackConfig: async () => null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.holdings?.[0]).toMatchObject({
      holdingId: 'holding_wancheng_real_api',
      civilScaleLevel: 5,
      scaleLevel: 2,
      farmlandMu: 1_200_000,
      registeredHouseholds: 90_000,
    });
    expect(result.state.currentDate).toBe(state.currentDate);
    expect(result.state.currentTime).toEqual(state.currentTime);
  }, 300_000);
});
