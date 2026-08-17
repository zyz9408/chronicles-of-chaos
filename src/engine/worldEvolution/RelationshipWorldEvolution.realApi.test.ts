import { describe, expect, it } from 'vitest';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState, WorldBook } from '../types';
import { executeRelationshipWorldEvolution } from './RelationshipWorldEvolution';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_WORLD_EVOLUTION_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`关系人物后台演化真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_relationship_world_evolution',
    name: '关系人物后台演化真实 API 验收',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0.2,
    maxOutputTokens: 4_096,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  };
}

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '1.4.2',
    worldBookId: 'threeKingdoms',
    worldBookVersion: '1',
    worldBookSource: 'official',
    startDate: '公元184年03月01日 08:00（辰时）',
    currentDate: '公元184年04月20日 08:00（辰时）',
    currentTime: { year: 184, month: 4, day: 20, hour: 8, minute: 0 },
    worldlineSettings: {
      knowledgeMode: 'default',
      knowledgeBaseId: 'threeKingdoms.coreKnowledge.v1',
      storyPackIds: [],
    },
    player: { id: 'player', name: '刘兴', roleType: '游侠', summary: '人在襄阳，与曹操异地保持旧识。' },
    currentLocationId: 'place_xiangyang',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    locations: [{
      locationId: 'place_yingchuan',
      name: '颍川',
      type: '郡治',
      summary: '士族与人才聚集之地。',
      knownLevel: '听闻',
      recentEvents: [],
    }],
    factions: [{
      factionId: 'faction_caocao',
      name: '曹操部',
      type: '军阀',
      summary: '正在乱局中聚拢力量。',
      stanceToPlayer: '中立',
      knownLevel: '听闻',
      recentActions: [],
    }],
    npcs: [{
      npcId: 'npc_caocao',
      name: '曹操',
      sex: '男',
      age: 30,
      role: '骑都尉',
      factionId: 'faction_caocao',
      factionName: '曹操部',
      locationId: 'place_yingchuan',
      isPresent: false,
      isFocused: false,
      summary: '正在形成自己的政治与军事班底。',
      appearance: '身形精悍。',
      personality: '果断多疑',
      motivation: '在乱局中建立可自保并成事的力量',
      relationToPlayer: '旧识',
      contactLevel: 4,
      recentAttitude: '重视',
      memories: [],
      backgroundActivity: {
        activityId: 'activity_recruit',
        summary: '在颍川招募青壮并延揽人才',
        status: 'active',
        locationId: 'place_yingchuan',
        dueAt: '公元184年04月20日 08:00（辰时）',
        visibility: 'playerKnown',
      },
    }],
    heroineThreads: [],
    bondThreads: [{
      bondThreadId: 'bond_caocao',
      targetNpcIds: ['npc_caocao'],
      targetNames: ['曹操'],
      bondType: 'ally',
      status: 'active',
      summary: '洛阳结识后保持联系。',
      lastUpdatedAt: '公元184年04月01日 08:00（辰时）',
    }],
  } as RuntimeState);
}

describe.runIf(REAL_API_ENABLED)('关系人物后台演化真实 API 验收', () => {
  it('将异地羁绊人物推进到一个可验证的新阶段', async () => {
    const before = makeState();
    const result = await executeRelationshipWorldEvolution(
      { manifest: { name: '乱世风云录·三国' } } as WorldBook,
      before,
      '我留在襄阳处理自己的事务。',
      {
        apiConfig: makeApiConfig(),
        llmClient: new BrowserLlmClient(),
        maxNpcCount: 1,
        timeoutMs: 60_000,
      },
    );

    expect(result.status, result.reason).toBe('completed');
    expect(result.targetNpcIds).toEqual(['npc_caocao']);
    expect(result.appliedNpcIds).toEqual(['npc_caocao']);
    const npc = result.state.npcs?.find((item) => item.npcId === 'npc_caocao');
    expect(npc?.backgroundActivity?.summary).toBeTruthy();
    expect(npc?.backgroundActivity?.dueAt).not.toBe(before.currentDate);
    expect(npc?.backgroundEvolutionMeta?.lastEvaluationId).toBeTruthy();
    expect(npc?.memories?.length).toBeGreaterThan(0);
  }, 90_000);
});
