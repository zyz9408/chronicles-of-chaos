import { describe, expect, it } from 'vitest';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { createCustomOpeningState } from '../state/createCustomOpeningState';
import { deriveActorCurrentAge } from '../time/npcAge';
import { generateTrueOpening } from './TrueOpeningGenerator';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_BIRTHDATE_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`角色生日真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_character_birthdate',
    name: '角色生日真实 API 验收',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0.15,
    maxOutputTokens: 8_192,
    createdAt: '2026-08-03T09:00:00.000Z',
    updatedAt: '2026-08-03T09:00:00.000Z',
  };
}

describe.runIf(REAL_API_ENABLED)('角色生日真实 API 验收', () => {
  it('用真实主剧情模型完成开局且不改写玩家的完整生日', async () => {
    const bookmark = worldBook_ThreeKingdoms.startBookmarks.find(
      (item) => item.id === 'bookmark_184_yellow_turban',
    );
    if (!bookmark) throw new Error('缺少 184 黄巾初起开局书签。');

    const initialState = createCustomOpeningState({
      worldBook: worldBook_ThreeKingdoms,
      bookmark,
      playerName: '韩昭',
      courtesyName: '伯明',
      playerSex: '男',
      playerAge: 25,
      playerBirthMonth: 4,
      playerBirthDay: 18,
      origin: '寒门士子',
      birthOrigin: '颍川寒门士族',
      currentIdentity: '阳翟县中书佐',
      locationId: 'loc_yingchuan',
      situationSummary: '黄巾将起，县中案牍与乡里传言同时涌来。',
      appearance: '身形清瘦，穿洗旧深衣。',
      personality: '谨慎务实，重视可核验的事实。',
      openingExtraRequest: '从县寺清晨点卯开始，不额外授予主角官职、钱财、领地或绝艺。',
    });
    expect(initialState.player.birthDate).toBe('公元158年04月18日');

    const apiConfig = makeApiConfig();
    const result = await generateTrueOpening(worldBook_ThreeKingdoms, initialState, {
      apiConfig,
      llmClient: new BrowserLlmClient(),
    });

    expect(result.narrativeText.trim().length).toBeGreaterThan(100);
    expect(result.newRuntimeState.worldStateDelta.trueOpeningGenerated).toBe(true);
    expect(result.newRuntimeState.player.birthDate).toBe(initialState.player.birthDate);
    expect(deriveActorCurrentAge(
      result.newRuntimeState.player,
      result.newRuntimeState.currentDate,
    )).toBe(25);
    expect(result.turnDisplayMeta.model).toBe(apiConfig.model);
  }, 360_000);
});
