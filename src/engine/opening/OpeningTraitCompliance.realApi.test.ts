import { describe, expect, it } from 'vitest';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import { reconcileOpeningTraitCompliance } from './OpeningTraitCompliance';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_OPENING_TRAIT_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`开局特质品级真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_opening_trait_compliance',
    name: '开局特质品级真实 API 验收',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0,
    maxOutputTokens: 1_024,
    createdAt: '2026-08-02T05:00:00.000Z',
    updatedAt: '2026-08-02T05:00:00.000Z',
  };
}

function makeState(): RuntimeState {
  const trait = {
    id: 'custom_trait_destined_presence',
    label: '天命威仪',
    description: '主角具有足以让常人本能跪伏、令豪杰感到霸主威压的超凡气场。',
    source: 'custom' as const,
    promptHint: '在他人感知主角气场、威望或统御资格时体现。',
  };
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook_ThreeKingdoms.manifest.id,
    worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
    worldBookSource: 'official',
    startDate: '公元184年03月01日 08:00（辰时）',
    currentDate: '公元184年03月01日 08:00（辰时）',
    currentTime: { year: 184, month: 3, day: 1, hour: 8, minute: 0 },
    player: {
      id: 'player_opening_trait_test',
      name: '徐煦',
      roleType: '地方豪族家主',
      currentIdentity: '颍川豪族家主',
      summary: '正试图在黄巾起事前组织乡里自保。',
      traits: [trait],
    },
    currentLocationId: 'sg_place_yuzhou_yingchuan_yangdi',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {
      openingTraitDetails: [{ ...trait, rarity: '待开局 LLM 判定' }],
    },
    turnLog: [],
    localSituationNotes: [],
    locations: [],
  });
}

describe.runIf(REAL_API_ENABLED)('开局特质品级真实 API 验收', () => {
  it('classifies an extreme custom trait on the shared six-tier scale and commits the same result', async () => {
    const state = makeState();
    const apiConfig = makeApiConfig();
    const result = await reconcileOpeningTraitCompliance({
      worldBook: worldBook_ThreeKingdoms,
      initialState: state,
      openingState: state,
      openingNarrativeText: '荀彧感到主角身上有天命所归的霸主威压，寻常僮仆已经本能跪伏；他仍以现实利害审视主角。',
      openingStatePatches: [],
      mainApiConfig: apiConfig,
      mainLlmClient: new BrowserLlmClient(),
    });

    expect(['orange', 'red']).toContain(result.state.player.traits?.[0]?.rarity);
    expect(result.state.worldStateDelta.openingTraitDetails).toMatchObject([
      {
        id: 'custom_trait_destined_presence',
        rarity: result.state.player.traits?.[0]?.rarity,
      },
    ]);
    expect(result.appliedPatches).toHaveLength(1);
    expect(result.notes.join('；')).toContain('开局特质品级已独立核验');
  }, 180_000);
});
