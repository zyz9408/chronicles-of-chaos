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
const REAL_API_ENABLED = TEST_ENV.COC_V2_CURRENCY_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`钱货语义真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_currency_semantics',
    name: '个人铜钱与黄金独立语义真实 API 验收',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0,
    maxOutputTokens: 6_000,
    createdAt: '2026-07-30T21:50:00.000Z',
    updatedAt: '2026-07-30T21:50:00.000Z',
  };
}

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook_ThreeKingdoms.manifest.id,
    worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
    worldBookSource: 'official',
    startDate: '公元189年09月01日 08:00（辰时）',
    currentDate: '公元189年09月03日 10:00（巳时）',
    currentTime: { year: 189, month: 9, day: 3, hour: 10, minute: 0 },
    player: {
      id: 'player_currency_test',
      name: '林砚',
      roleType: '军中书吏',
      summary: '奉命协助清点军功赏赐。',
      personalMoney: 23_045,
      inventory: [],
    },
    currentLocationId: 'loc_yingchuan_office',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [{
      turnNumber: 1,
      date: '公元189年09月03日 09:30（巳时）',
      timestamp: '公元189年09月03日 09:30（巳时）',
      playerInput: '核对功簿与赏赐名单',
      narrativeText: '功曹核验功簿后，确认应按前令发给林砚一枚封缄金饼。',
      statePatchSummary: '赏赐资格已经确认，实物尚未交付',
    }],
    localSituationNotes: ['一枚封缄金饼已经列入赏赐名单，尚未称重、验色或兑换。'],
    npcs: [{
      npcId: 'npc_yingchuan_merit_officer',
      name: '郡府功曹',
      sex: '男',
      age: 44,
      role: '郡府功曹',
      summary: '负责核验并发放已经确认的军功赏赐。',
      appearance: '身着整洁官服，手持赏赐簿册。',
      personality: '谨慎守序。',
      motivation: '按已经核验的功簿完成赏赐发放。',
      relationToPlayer: '公事往来',
      contactLevel: 10,
      recentAttitude: '照章办理',
      locationId: 'loc_yingchuan_office',
      isPresent: true,
      isFocused: true,
      memories: [],
    }],
    locations: [{
      locationId: 'loc_yingchuan_office',
      name: '官署',
      type: '县',
      summary: '颍川郡守衙门所在。',
      knownLevel: '亲历',
      recentEvents: [],
    }],
  });
}

describe.runIf(REAL_API_ENABLED)('个人铜钱与黄金独立语义真实 API 验收', () => {
  it('records one unexchanged gold cake as an item without changing copper money', async () => {
    const before = makeState();
    const result = await executeTurn(
      worldBook_ThreeKingdoms,
      before,
      '我从功曹手中接过前令已经确认的一枚封缄金饼，当面收进包袱。'
        + '本回合没有称重、验色、买卖或兑换，原有铜钱余额不变。',
      {
        apiConfig: makeApiConfig(),
        llmClient: new BrowserLlmClient(),
      },
    );

    expect(result.newRuntimeState.player.personalMoney).toBe(23_045);
    const goldItems = (result.newRuntimeState.player.inventory ?? [])
      .filter((item) => /金饼|黄金|马蹄金/.test(item.name));
    expect(goldItems).toHaveLength(1);
    expect(goldItems[0]).toMatchObject({
      quantity: 1,
      category: 'material',
    });
  }, 180_000);
});
