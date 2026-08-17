import { describe, expect, it } from 'vitest';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState, WorldBook } from '../types';
import { evaluateNpcUniqueArtCompliance } from '../character/NpcUniqueArtPolicy';
import { executeTurn } from './TurnOrchestrator';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_NPC_ART_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`NPC 绝艺真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_npc_unique_art',
    name: 'NPC 稳定绝艺真实 API 验收',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0,
    maxOutputTokens: 4_000,
    createdAt: '2026-07-30T10:00:00.000Z',
    updatedAt: '2026-07-30T10:00:00.000Z',
  };
}

const worldBook: WorldBook = {
  manifest: {
    id: 'npc-art-real-api-world',
    name: '三国绝艺验收',
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
  lore: '公元二世纪末的汉末乱世。人物能力与长期绝艺必须符合既有档案。',
  mapSeed: [{
    id: 'loc_cavalry_camp',
    name: '骑营',
    level: '军营',
    summary: '白马骑队驻扎的营地。',
    connectedRegionIds: [],
    controlHint: '友军',
    tensionHint: '备战',
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
      id: 'player_real_art_test',
      name: '刘平',
      roleType: '骑军校尉',
      summary: '与赵云共同整顿骑营。',
    },
    currentLocationId: 'loc_cavalry_camp',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    npcs: [{
      npcId: 'npc_zhaoyun_real_art_test',
      name: '赵云',
      sex: '男',
      age: 27,
      role: '骑将',
      currentIdentity: '白马骑将',
      locationId: 'loc_cavalry_camp',
      isPresent: true,
      isFocused: true,
      summary: '以勇武、骑战和忠毅闻名的骑将。',
      appearance: '白袍银甲，持枪而立。',
      personality: '沉毅果决，临阵冷静。',
      motivation: '护持百姓与同袍。',
      relationToPlayer: '并肩作战',
      contactLevel: 8,
      recentAttitude: '信任',
      abilityScores: { 武力: 96, 统率: 85, 智力: 75, 政治: 62, 魅力: 88, 机运: 66 },
      traits: [{
        id: 'trait_zhaoyun_loyal_brave',
        label: '忠勇',
        description: '临阵不退，重诺护民。',
        source: 'history',
        rarity: 'gold',
      }],
      memories: [],
    }],
    locations: [{
      locationId: 'loc_cavalry_camp',
      name: '骑营',
      type: '军营',
      summary: '白马骑队驻扎的营地。',
      knownLevel: '亲历',
      recentEvents: [],
    }],
  });
}

describe.runIf(REAL_API_ENABLED)('NPC 稳定绝艺真实 API 验收', () => {
  it('soft-completes the legacy Zhao Yun profile and persists a valid six-tier archive', async () => {
    const apiConfig = makeApiConfig();
    const mainClient = {
      generate: async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '赵云在骑营中检视枪骑阵列，随后与你核对今日操练安排。',
          suggestedActions: [],
          statePatches: [{
            type: 'timeAdvance',
            payload: { minutesAdvanced: 15, reason: '检视骑营', category: 'conversation' },
            reason: '骑营议事经过时间',
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
        provider: apiConfig.provider,
        model: 'deterministic-main-fixture',
      }),
    };

    const result = await executeTurn(worldBook, makeState(), '我与赵云一同检视骑营', {
      apiConfig,
      npcCompletionApiConfig: apiConfig,
      llmClient: mainClient,
      npcCompletionLlmClient: new BrowserLlmClient(),
    });
    const zhaoYun = result.newRuntimeState.npcs?.find(
      (npc) => npc.npcId === 'npc_zhaoyun_real_art_test',
    );
    expect(zhaoYun).toBeDefined();
    expect(evaluateNpcUniqueArtCompliance(zhaoYun!)).toMatchObject({
      compliant: true,
    });
    expect(zhaoYun?.uniqueArts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rarity: 'red',
        domain: 'personalCombat',
        acquisition: expect.objectContaining({
          kind: 'background',
          sourceRefId: 'npc-profile:npc_zhaoyun_real_art_test:background',
        }),
      }),
      expect.objectContaining({
        rarity: 'purple',
        domain: 'warfare',
        acquisition: expect.objectContaining({ kind: 'background' }),
      }),
      expect.objectContaining({
        rarity: 'purple',
        domain: 'social',
        acquisition: expect.objectContaining({ kind: 'background' }),
      }),
    ]));
    expect(result.writeback?.debugNotes).toContain('NPC稳定绝艺已本地补全：赵云');
  }, 180_000);
});
