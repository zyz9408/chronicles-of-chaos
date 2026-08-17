import { describe, expect, it } from 'vitest';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import { executeTurn } from '../turn/TurnOrchestrator';
import { mergeEncounterSemanticProjections } from './EncounterRuntimeIntegration';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_UNIQUE_ART_PROJECTION_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`绝艺稳定投影真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_unique_art_projection',
    name: '绝艺稳定投影真实 API 验收',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0,
    maxOutputTokens: 8_192,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  };
}

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook_ThreeKingdoms.manifest.id,
    worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
    worldBookSource: 'official',
    startDate: '公元194年05月03日 08:00（辰时）',
    currentDate: '公元194年05月03日 10:00（巳时）',
    currentTime: { year: 194, month: 5, day: 3, hour: 10, minute: 0 },
    player: {
      id: 'player_unique_art_projection',
      name: '刘平',
      roleType: '军中校尉',
      currentIdentity: '荆州军校尉',
      locationId: 'place_jingzhou_xinye',
      summary: '正在完成枪术传授的军中校尉。',
      abilityScores: { 武力: 78, 统率: 70, 智力: 62, 政治: 50, 魅力: 65, 机运: 55 },
      uniqueArts: [],
    },
    currentLocationId: 'place_jingzhou_xinye',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [{
      turnNumber: 1,
      date: '公元194年05月03日 09:00（巳时）',
      playerInput: '继续接受枪术传授',
      narrativeText: '韩师已经连续数日传授断流枪势，刘平完成了步法、发力和对练，只差最后考校。',
      statePatchSummary: '传授接近完成但尚未取得绝艺',
      timestamp: '2026-08-03T00:00:00.000Z',
    }],
    localSituationNotes: [],
    locations: [{
      locationId: 'place_jingzhou_xinye',
      name: '新野县城',
      type: '县城',
      summary: '荆州北境军镇。',
      knownLevel: '亲历',
      recentEvents: [],
    }],
    npcs: [{
      npcId: 'npc_spear_teacher',
      name: '韩师',
      sex: '男',
      age: 46,
      role: '军中枪术教习',
      locationId: 'place_jingzhou_xinye',
      isPresent: true,
      isFocused: true,
      summary: '正在完成断流枪势最后考校的教习。',
      appearance: '短须劲装，手持木枪。',
      personality: '严谨直接。',
      motivation: '完成最后考校并正式授艺。',
      relationToPlayer: '授业教习',
      contactLevel: 35,
      recentAttitude: '准备完成最后考校',
      traits: [],
      uniqueArts: [],
      equipment: [],
      inventory: [],
      memories: [],
    }],
  });
}

async function executeValidTurn(state: RuntimeState, playerInput: string) {
  const beforeTurnCount = state.turnLog.length;
  const result = await executeTurn(worldBook_ThreeKingdoms, state, playerInput, {
    apiConfig: makeApiConfig(),
    llmClient: new BrowserLlmClient(),
    deferMemorySummaryCompression: true,
  });
  const diagnostics = JSON.stringify({
    patchValidation: result.patchValidation,
    debugNotes: result.writeback?.debugNotes ?? [],
    arts: result.newRuntimeState.player.uniqueArts?.map((art) => ({
      id: art.id,
      domain: art.domain,
      level: art.level,
      acquisition: art.acquisition?.kind,
    })),
    projections: result.semanticProjections?.map((profile) => ({
      sourceId: profile.sourceId,
      profileKind: profile.profileKind,
      status: profile.status,
      rulesetScopes: profile.rulesetScopes,
    })),
  });
  expect(result.patchValidation, diagnostics).toBeTruthy();
  expect(result.patchValidation?.valid, diagnostics).toBe(true);
  expect(result.newRuntimeState.turnLog.length, diagnostics).toBe(beforeTurnCount + 1);
  return result;
}

describe.runIf(REAL_API_ENABLED)('绝艺稳定投影真实 API 跨回合验收', () => {
  it('为已有的每回合恢复绝艺返回可执行的被动投影', async () => {
    const state = makeState();
    state.player.vitals = { hp: 50, maxHp: 100, stamina: 70, maxStamina: 100 };
    state.player.uniqueArts = [{
      id: 'art_player_regeneration',
      name: '归元生息',
      rarity: 'purple',
      domain: 'survival',
      level: 1,
      maxLevel: 10,
      progress: 0,
      description: '以调息法稳定气血。',
      effectSummary: '每个成功推进时间的游戏回合后恢复 8 点生命，不会令濒死者复活。',
      source: 'training',
    }];

    const result = await executeValidTurn(
      state,
      '我依照已经学会的“归元生息”调息一刻钟。这项绝艺档案明确为每个游戏回合后恢复生命，请保持事实并补全其可执行投影。',
    );
    const projection = result.semanticProjections?.find(
      (profile) => profile.sourceId === 'art_player_regeneration',
    );
    const diagnostics = JSON.stringify(result.semanticProjections ?? []);

    expect(projection, diagnostics).toMatchObject({
      profileKind: 'ability',
      sourceType: 'unique_art',
      status: 'executable',
      activation: expect.stringMatching(/^(passive|hybrid)$/),
      rulesetScopes: expect.arrayContaining(['runtime_turn']),
      effects: expect.arrayContaining([
        expect.objectContaining({
          trigger: 'after_runtime_turn',
          operation: 'restore_hp',
          target: 'self',
        }),
      ]),
    });
  }, 600_000);

  it('同批建立新绝艺与投影，后续回合不再重生成或覆盖', async () => {
    const acquiredTurn = await executeValidTurn(
      makeState(),
      '韩师当面完成最后考校，确认我已掌握此前没有的个人战绝艺“断流枪势”，并正式宣布传授完成。请把这项已经成立的授艺事实写入档案。',
    );
    const acquiredArt = acquiredTurn.newRuntimeState.player.uniqueArts?.find(
      (art) => art.domain === 'personalCombat' && Boolean(art.acquisition),
    );
    const acquisitionDiagnostics = JSON.stringify({
      arts: acquiredTurn.newRuntimeState.player.uniqueArts,
      projections: acquiredTurn.semanticProjections,
    });
    expect(acquiredArt, acquisitionDiagnostics).toBeDefined();
    expect(acquiredArt?.acquisition, acquisitionDiagnostics).toMatchObject({
      kind: expect.stringMatching(/^(training|teaching)$/),
      instructorNpcId: 'npc_spear_teacher',
      sourceRefId: expect.any(String),
    });
    const providerProjection = acquiredTurn.semanticProjections?.find(
      (profile) => profile.sourceId === acquiredArt?.id,
    );
    expect(providerProjection, acquisitionDiagnostics).toMatchObject({
      profileKind: 'ability',
      sourceType: 'unique_art',
      status: 'executable',
      rulesetScopes: expect.arrayContaining(['personal_combat']),
    });

    const persisted = mergeEncounterSemanticProjections(
      acquiredTurn.newRuntimeState,
      acquiredTurn.semanticProjections ?? [],
    );
    const laterTurn = await executeValidTurn(
      persisted,
      '我收枪后与韩师在校场边歇息片刻，只谈明日军中点卯，不再学习、升级或使用绝艺。',
    );
    const afterLaterTurn = mergeEncounterSemanticProjections(
      laterTurn.newRuntimeState,
      laterTurn.semanticProjections ?? [],
    );
    const storedProjection = afterLaterTurn.encounterV2?.semanticProjections.find(
      (profile) => profile.sourceId === acquiredArt?.id,
    );

    expect(storedProjection).toEqual(providerProjection);
    expect(afterLaterTurn.player.uniqueArts?.find((art) => art.id === acquiredArt?.id)).toMatchObject({
      id: acquiredArt?.id,
      level: 1,
      progress: 0,
    });
  }, 600_000);
});
