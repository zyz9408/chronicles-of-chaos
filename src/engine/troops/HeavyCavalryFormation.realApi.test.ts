import { describe, expect, it } from 'vitest';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import { executeTurn } from '../turn/TurnOrchestrator';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_HEAVY_CAVALRY_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`重骑组建真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_heavy_cavalry',
    name: '重骑组建真实 API 验收',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0,
    maxOutputTokens: 8_192,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
  };
}

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook_ThreeKingdoms.manifest.id,
    worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
    worldBookSource: 'official',
    startDate: '公元190年01月01日 08:00（辰时）',
    currentDate: '公元190年01月01日 08:00（辰时）',
    currentTime: { year: 190, month: 1, day: 1, hour: 8, minute: 0 },
    player: {
      id: 'player_heavy_cavalry_test',
      name: '刘兴',
      roleType: '军府将领',
      currentIdentity: '荆州军府偏将',
      factionId: 'faction_player',
      locationId: 'place_camp',
      summary: '实际控制北岸大营并负责本部整训。',
      abilityScores: { 武力: 72, 统率: 78, 智力: 62, 政治: 55, 魅力: 60, 机运: 50 },
    },
    currentLocationId: 'place_camp',
    knownActors: [],
    knownFactions: ['faction_player'],
    factions: [{
      factionId: 'faction_player',
      name: '荆州军府',
      type: '军阀集团',
      summary: '地方军府。',
      stanceToPlayer: '自势力',
      knownLevel: '亲历',
      recentActions: [],
    }],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    locations: [{
      locationId: 'place_camp',
      name: '北岸大营',
      type: '军营',
      summary: '具备马厩、军械库和稳定补给的军营。',
      knownLevel: '亲历',
      recentEvents: [],
    }],
    holdings: [{
      holdingId: 'holding_camp',
      name: '北岸大营',
      type: 'camp',
      status: 'controlled',
      summary: '玩家实际控制、具备基础马械能力的军营。',
      locationId: 'place_camp',
      factionId: 'faction_player',
      civilAdministrationScope: 'none',
      scaleLevel: 2,
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 0,
      popularSupport: 0,
      defense: 60,
      recruitPotential: 50,
      armory: 45,
      horseSupply: 45,
      updatedAt: '公元190年01月01日 08:00（辰时）',
    }],
    resources: {
      money: 10_000,
      grain: 10_000,
      horses: 100,
      arms: 100,
      recruits: 100,
      weapons: [],
      documents: [],
      tokens: [],
      importantSupplies: [],
    },
  });
}

describe.runIf(REAL_API_ENABLED)('重骑组建真实 API 验收', () => {
  it('模型提出项目命令，本地原子扣除资源且不立即生成精锐部队', async () => {
    const state = makeState();
    const result = await executeTurn(
      worldBook_ThreeKingdoms,
      state,
      '我正式下令在实际控制的北岸大营，从现有兵员、马匹、军械与钱粮中组建二十名重骑兵。现在只启动组建和训练项目，不得立即生成部队，更不得直接写成精锐。',
      {
        apiConfig: makeApiConfig(),
        llmClient: new BrowserLlmClient(),
        deferMemorySummaryCompression: true,
      },
    );

    const diagnostics = JSON.stringify({
      patchValidation: result.patchValidation,
      debugNotes: result.writeback?.debugNotes ?? [],
      projectCount: result.newRuntimeState.heavyCavalryFormationProjects?.length ?? 0,
      troopCount: result.newRuntimeState.troops?.length ?? 0,
    });
    expect(result.patchValidation, diagnostics).toBeTruthy();
    expect(result.patchValidation?.valid, diagnostics).toBe(true);
    expect(result.newRuntimeState.heavyCavalryFormationProjects, diagnostics).toHaveLength(1);
    expect(result.newRuntimeState.heavyCavalryFormationProjects?.[0], diagnostics).toMatchObject({
      requestedSize: 20,
      holdingId: 'holding_camp',
      status: 'active',
    });
    expect(result.newRuntimeState.troops ?? [], diagnostics).toHaveLength(0);
    expect(result.newRuntimeState.resources, diagnostics).toMatchObject({
      money: 9_840,
      grain: 9_880,
      horses: 77,
      arms: 60,
      recruits: 80,
    });
  }, 300_000);
});
