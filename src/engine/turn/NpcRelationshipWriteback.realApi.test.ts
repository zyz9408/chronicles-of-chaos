import { describe, expect, it } from 'vitest';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import { extractLuanShiCommandFromPatch } from './LuanShiCommandPatch';
import { executeTurn } from './TurnOrchestrator';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_NPC_RELATIONSHIP_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`NPC 往来度真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_npc_relationship_writeback',
    name: 'NPC 往来度结构化成长真实 API 验收',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0,
    maxOutputTokens: 6_000,
    createdAt: '2026-07-31T00:30:00.000Z',
    updatedAt: '2026-07-31T00:30:00.000Z',
  };
}

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook_ThreeKingdoms.manifest.id,
    worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
    worldBookSource: 'official',
    startDate: '公元189年09月01日 08:00（辰时）',
    currentDate: '公元189年09月06日 19:00（戌时）',
    currentTime: { year: 189, month: 9, day: 6, hour: 19, minute: 0 },
    player: {
      id: 'player_relationship_test',
      name: '林砚',
      roleType: '军中书吏',
      summary: '与陈衡共同查验一封牵涉军粮去向的密信。',
    },
    currentLocationId: 'loc_yingchuan_posthouse',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [{
      turnNumber: 1,
      date: '公元189年09月06日 18:30（酉时）',
      timestamp: '公元189年09月06日 18:30（酉时）',
      playerInput: '与陈衡约在驿馆核对密信。',
      narrativeText: '林砚与陈衡已经分别查清密信的两处印记，约定入夜后当面交换结果。',
      statePatchSummary: '约定会面，尚未交换密信。',
    }],
    localSituationNotes: [],
    npcs: [{
      npcId: 'npc_chen_heng_relationship_test',
      name: '陈衡',
      sex: '男',
      age: 31,
      role: '郡府书佐',
      summary: '谨慎查验军粮文书的郡府书佐。',
      appearance: '青色吏服，随身带着封缄文书。',
      personality: '谨慎，重视证据。',
      motivation: '查清被人篡改的军粮文书。',
      relationToPlayer: '谨慎合作，尚未完全互信。',
      contactLevel: 7,
      recentAttitude: '愿意交换有限线索',
      locationId: 'loc_yingchuan_posthouse',
      isPresent: true,
      isFocused: true,
      memories: [],
    }],
    locations: [{
      locationId: 'loc_yingchuan_posthouse',
      name: '颍川驿馆',
      type: '驿馆',
      summary: '郡府往来文书与差役暂歇之处。',
      knownLevel: '亲历',
      recentEvents: [],
    }],
  });
}

function relationshipCommands(result: Awaited<ReturnType<typeof executeTurn>>) {
  return (result.statePatches ?? [])
    .map((patch) => extractLuanShiCommandFromPatch(patch))
    .filter((command) => command?.action === 'updateNpcRelationship');
}

describe.runIf(REAL_API_ENABLED)('NPC 往来度结构化成长真实 API 验收', () => {
  const client = new BrowserLlmClient();
  let lastRequestStartedAt = 0;

  async function execute(input: string) {
    const waitMs = Math.max(0, 12_500 - (Date.now() - lastRequestStartedAt));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastRequestStartedAt = Date.now();
    return executeTurn(worldBook_ThreeKingdoms, makeState(), input, {
      apiConfig: makeApiConfig(),
      llmClient: client,
    });
  }

  it('writes one positive increment after a completed direct relationship advance', async () => {
    const result = await execute(
      '我与陈衡在驿馆内当面核对完两份密信，并把唯一原件交给他保管。'
        + '陈衡也交出自己冒险取得的军粮簿副本，我们约定共同承担追查此案的风险。'
        + '这次会面和交换在本回合实际完成。',
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    const commands = relationshipCommands(result);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      action: 'updateNpcRelationship',
      npcId: 'npc_chen_heng_relationship_test',
    });
    if (commands[0]?.action !== 'updateNpcRelationship') {
      throw new Error('真实 API 未返回 NPC 往来度命令。');
    }
    expect(commands[0].contactDelta).toBeGreaterThanOrEqual(1);
    expect(commands[0].contactDelta).toBeLessThanOrEqual(10);
    expect(result.newRuntimeState.npcs?.find(
      (npc) => npc.npcId === 'npc_chen_heng_relationship_test',
    )?.contactLevel).toBe(7 + commands[0].contactDelta);
  }, 180_000);

  it('does not increase contact for a remote mention without direct interaction', async () => {
    const result = await execute(
      '我独自在县衙翻阅陈衡昨日留下的旧信，只回忆我们先前约定的会面。'
        + '陈衡本人远在城外，本回合没有见面、通信、托人传话或共同经历。',
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(relationshipCommands(result)).toHaveLength(0);
    expect(result.newRuntimeState.npcs?.find(
      (npc) => npc.npcId === 'npc_chen_heng_relationship_test',
    )?.contactLevel).toBe(7);
  }, 180_000);
});
