import { describe, expect, it } from 'vitest';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import { executeTurn } from './TurnOrchestrator';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_HOLDING_CONTROL_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`领地控制事实门禁真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_holding_control_writeback',
    name: '领地控制事实门禁真实 API 验收',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0,
    maxOutputTokens: 8_000,
    createdAt: '2026-08-02T03:30:00.000Z',
    updatedAt: '2026-08-02T03:30:00.000Z',
  };
}

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook_ThreeKingdoms.manifest.id,
    worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
    worldBookSource: 'official',
    startDate: '公元189年09月01日 08:00（辰时）',
    currentDate: '公元189年09月04日 16:00（申时）',
    currentTime: { year: 189, month: 9, day: 4, hour: 16, minute: 0 },
    player: {
      id: 'player_holding_gate_test',
      name: '林砚',
      roleType: '郡兵什长',
      currentIdentity: '临时受命协防北城墙的郡兵什长',
      militaryTitle: '什长',
      summary: '只负责带领十名郡兵轮值一段城墙，没有城池、县邑、府库、民政或城防管领权。',
      inventory: [],
    },
    currentLocationId: 'loc_yangdi_north_wall',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    resources: {
      money: 0,
      grain: 0,
      horses: 0,
      arms: 0,
      recruits: 0,
      weapons: [],
      documents: [],
      tokens: [],
      importantSupplies: [],
    },
    playerResources: {},
    holdings: [],
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [
      '主角只是临时协防北城墙的基层什长；驻守、巡逻、站在城墙上都不代表接掌阳翟县或北城墙。',
      '本场没有正式移交、封授、攻占、建置、临时行政接管、领地争夺或控制权变化。',
    ],
    npcs: [],
    locations: [{
      locationId: 'loc_yangdi_north_wall',
      name: '阳翟北城墙',
      type: '城防设施',
      summary: '阳翟县城北侧的一段公共城防设施，由县中守军轮值。',
      knownLevel: '亲历',
      recentEvents: [],
    }],
  });
}

describe.runIf(REAL_API_ENABLED)('领地控制事实门禁真实 API 验收', () => {
  it('keeps holdings empty when the player merely completes a wall-garrison shift', async () => {
    const apiConfig = makeApiConfig();
    const llmClient = new BrowserLlmClient();
    const result = await executeTurn(
      worldBook_ThreeKingdoms,
      makeState(),
      '我带着本什的郡兵沿北城墙巡查到日落，核对垛口和火盆后与下一班守卒交接，随后下城休息。'
        + '这只是完成一次协防轮值，没有任何城池、城墙、府库或民政管领权的移交。',
      {
        apiConfig,
        stateWritebackApiConfig: apiConfig,
        llmClient,
        stateWritebackLlmClient: llmClient,
      },
    );

    expect(result.newRuntimeState.holdings ?? []).toEqual([]);
    expect(result.patchValidation?.errors ?? []).not.toEqual(expect.arrayContaining([
      expect.stringContaining('upsertHoldingLedger'),
    ]));
    expect(result.narrativeText.length).toBeGreaterThan(0);
  }, 300_000);
});
