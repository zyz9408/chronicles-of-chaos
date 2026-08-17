import { describe, expect, it } from 'vitest';
import { BrowserLlmClient, type LlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { deriveNpcCurrentAge, normalizeCompleteBirthDate } from '../time/npcAge';
import type { RuntimeState, WorldBook } from '../types';
import { executeTurn } from './TurnOrchestrator';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_NPC_ADMISSION_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`NPC 人物志准入真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_npc_profile_admission',
    name: 'NPC 人物志准入真实 API 验收',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0,
    maxOutputTokens: 6_000,
    createdAt: '2026-07-31T03:00:00.000Z',
    updatedAt: '2026-07-31T03:00:00.000Z',
  };
}

const worldBook: WorldBook = {
  manifest: {
    id: 'npc-profile-admission-real-api-world',
    name: '三国人物志准入验收',
    version: '1.0.0',
    author: 'test',
    language: 'zh-CN',
    genre: '历史乱世',
    source: 'official',
    compatibleEngineVersion: '0.1.0',
  },
  ontology: {
    regionLevels: [],
    factionTypes: [],
    actorRoleTypes: [],
    socialClasses: [],
    resourceTypes: [],
    conflictTypes: [],
    actionTypes: [],
    relationshipTypes: [],
  },
  lore: '公元二世纪末的汉末乱世。人物志只收录能够长期承接剧情或系统职责的人物。',
  mapSeed: [{
    id: 'loc_forward_camp',
    name: '前锋营',
    level: '军营',
    summary: '军中斥候往返报信的营地。',
    connectedRegionIds: [],
    controlHint: '友军',
    tensionHint: '戒备',
  }],
  factionsSeed: [],
  timelineAnchors: [],
  startBookmarks: [],
  openingCrisisTemplates: [],
  prompts: {
    narrativeBaseline: '保持历史乱世语境。',
    forbiddenTopics: [],
    outputFormat: '必须输出 JSON。',
    toneGuide: '沉稳。',
  },
  validationRules: [],
};

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook.manifest.id,
    worldBookVersion: worldBook.manifest.version,
    worldBookSource: 'official',
    startDate: '公元194年05月03日 10:00',
    currentDate: '公元194年05月03日 10:00',
    currentTime: { year: 194, month: 5, day: 3, hour: 10, minute: 0 },
    player: {
      id: 'player_npc_admission_test',
      name: '林砚',
      roleType: '前锋校尉',
      summary: '正在前锋营整顿军情。',
    },
    currentLocationId: 'loc_forward_camp',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    npcs: [],
    locations: [{
      locationId: 'loc_forward_camp',
      name: '前锋营',
      type: '军营',
      summary: '军中斥候往返报信的营地。',
      knownLevel: '亲历',
      recentEvents: [],
    }],
  });
}

function makeFixtureClient(narrativeText: string, npcProfileSuggestions: unknown[] = []): LlmClient {
  return {
    generate: async () => ({
      content: JSON.stringify({
        protocolVersion: 'lsfy.turn.v1',
        narrativeText,
        suggestedActions: [],
        statePatches: [{
          type: 'timeAdvance',
          payload: { minutesAdvanced: 10, reason: '营中交谈', category: 'conversation' },
          reason: '军情交谈经过时间',
        }],
        statePatch: null,
        writeback: {
          npcProfileSuggestions,
          npcMemorySuggestions: [],
          locationWriteSuggestions: [],
          routeWriteSuggestions: [],
          questChanges: [],
          debugNotes: [],
        },
      }),
      provider: 'openai_compatible',
      model: 'deterministic-main-fixture',
    }),
  };
}

describe.runIf(REAL_API_ENABLED)('NPC 人物志准入真实 API 验收', () => {
  it('不把仅完成一次报信便离场的有名斥候写入人物志', async () => {
    const apiConfig = makeApiConfig();
    const result = await executeTurn(
      worldBook,
      makeState(),
      '听完斥候周安的一次军情报告，发给他赏钱让他自行离营，不约定后续联络，也不授予任何长期职责。',
      {
        apiConfig,
        npcCompletionApiConfig: apiConfig,
        llmClient: makeFixtureClient(
          '【周安】北坡没有发现敌军旗号。周安交回临时斥候腰牌，领了赏钱后独自离开前锋营；'
          + '林砚没有招募、任命、结交或约定与他再次联络。',
        ),
        npcCompletionLlmClient: new BrowserLlmClient(),
      },
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.writeback?.npcProfileSuggestions ?? []).toHaveLength(0);
    expect(result.newRuntimeState.npcs ?? []).toHaveLength(0);
  }, 180_000);

  it('把玩家已经任命为长期军职的斥候写入人物志并留下准入依据', async () => {
    const apiConfig = makeApiConfig();
    const result = await executeTurn(
      worldBook,
      makeState(),
      '我当场任命周安为前锋营长期斥候队正，命他今后每日直接向我报送军情，并让他领取固定腰牌留营任职。',
      {
        apiConfig,
        npcCompletionApiConfig: apiConfig,
        llmClient: makeFixtureClient(
          '【周安】属下领命。周安接过固定腰牌，在军吏簿上登记为前锋营斥候队正，'
          + '自今日起留营统领斥候，并约定每日入帐前直接向林砚报送军情。',
          [{
            npcId: 'npc_zhou_an_real_admission',
            name: '周安',
            persistenceReason: 'active_system_role',
            persistenceEvidence: '本回合已经正式受命为前锋营长期斥候队正并留营任职。',
            sex: '男',
            age: 0,
            role: '前锋营斥候队正',
            locationId: 'loc_forward_camp',
            isPresent: true,
            isFocused: true,
            currentIdentity: '前锋营长期斥候队正',
            summary: '周安已经受命长期统领前锋营斥候。',
            appearance: '穿窄袖军衣，腰悬固定斥候腰牌。',
            personality: '谨慎敏锐。',
            motivation: '统领斥候并每日报送军情。',
            relationToPlayer: '新任斥候队正',
            contactLevel: 5,
            recentAttitude: '恭谨领命',
            abilityScores: { 武力: 55, 统率: 62, 智力: 68, 政治: 40, 魅力: 48, 机运: 60 },
            traits: [{
              id: 'trait_zhou_an_cautious_scout',
              label: '谨慎斥候',
              description: '侦察时谨慎核验军情。',
              source: '本回合正式任命',
            }],
          }],
        ),
        npcCompletionLlmClient: new BrowserLlmClient(),
      },
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    const profile = result.writeback?.npcProfileSuggestions?.find((entry) => entry.name === '周安');
    expect(profile, JSON.stringify({
      profileNames: result.writeback?.npcProfileSuggestions?.map((entry) => entry.name) ?? [],
      debugNotes: result.writeback?.debugNotes ?? [],
    })).toBeDefined();
    expect(profile?.persistenceReason).toMatch(
      /^(active_system_role|recurring_contact|player_committed_relationship)$/,
    );
    expect(profile?.persistenceEvidence?.trim()).not.toBe('');
    const persistedNpc = result.newRuntimeState.npcs?.find((npc) => npc.name === '周安');
    expect(persistedNpc).toBeDefined();
    expect(normalizeCompleteBirthDate(persistedNpc?.birthDate)).toBe(persistedNpc?.birthDate);
    expect(deriveNpcCurrentAge(persistedNpc!, result.newRuntimeState.currentDate)).toBe(persistedNpc?.age);
  }, 240_000);

  it('人物补全主要 API 失败后切换真实备用 API，且不重跑主剧情', async () => {
    const fallbackApiConfig = makeApiConfig();
    const mainClient = makeFixtureClient(
      '【裴绍】末将领命。裴绍当众接过军令，在军吏簿上登记为前锋营长期部曲将，'
      + '自今日起留营统领新编部曲并每日向林砚报送军情。',
      [{
        npcId: 'npc_pei_shao_fallback_real',
        name: '裴绍',
        persistenceReason: 'active_system_role',
        persistenceEvidence: '本回合已经正式受命为前锋营长期部曲将并留营任职。',
        sex: '男',
        age: 0,
        role: '前锋营部曲将',
        locationId: 'loc_forward_camp',
        isPresent: true,
        isFocused: true,
        currentIdentity: '前锋营长期部曲将',
        summary: '裴绍已经受命统领新编部曲。',
        appearance: '披札甲，佩环首刀。',
        personality: '谨慎守令。',
        motivation: '统领部曲完成军令。',
        relationToPlayer: '新任部曲将',
        contactLevel: 5,
        recentAttitude: '恭谨领命',
        abilityScores: { 武力: 68, 统率: 72, 智力: 55, 政治: 45, 魅力: 52, 机运: 48 },
        traits: [{
          id: 'trait_pei_shao_disciplined',
          label: '谨慎守令',
          description: '受命后按军令整顿部曲。',
          source: '本回合正式任命',
        }],
      }],
    );
    const primaryFailureClient: LlmClient = {
      generate: async () => {
        throw new Error('fixture primary NPC completion outage');
      },
    };
    const result = await executeTurn(
      worldBook,
      makeState(),
      '我正式任命裴绍为长期部曲将，命他留营统领新编部曲并每日向我报送军情。',
      {
        apiConfig: fallbackApiConfig,
        npcCompletionApiConfig: {
          ...fallbackApiConfig,
          id: 'api_fixture_npc_primary_failure',
          model: 'fixture-primary-failure',
        },
        npcCompletionFallbackApiConfig: fallbackApiConfig,
        llmClient: mainClient,
        npcCompletionLlmClient: primaryFailureClient,
        npcCompletionFallbackLlmClient: new BrowserLlmClient(),
      },
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    const persistedNpc = result.newRuntimeState.npcs?.find((npc) => npc.name === '裴绍');
    expect(persistedNpc, JSON.stringify({
      profileNames: result.writeback?.npcProfileSuggestions?.map((entry) => entry.name) ?? [],
      runtimeNpcNames: result.newRuntimeState.npcs?.map((entry) => entry.name) ?? [],
      debugNotes: result.writeback?.debugNotes ?? [],
    })).toBeDefined();
    expect(normalizeCompleteBirthDate(persistedNpc?.birthDate)).toBe(persistedNpc?.birthDate);
    expect(deriveNpcCurrentAge(persistedNpc!, result.newRuntimeState.currentDate)).toBe(persistedNpc?.age);
    expect(result.writeback?.debugNotes).toContain(
      `NPC建档主要 API 未完成，已切换备用 API：${fallbackApiConfig.model}`,
    );
  }, 240_000);
});
