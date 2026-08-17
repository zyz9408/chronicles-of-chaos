import { describe, expect, it } from 'vitest';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { startHoldingGovernanceProject } from '../holdings/HoldingGovernanceProjects';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { tryCreateGameClockFromDateLabel } from '../time/gameClock';
import type { HoldingLedgerEntry, RuntimeState } from '../types';
import { executeTurn } from './TurnOrchestrator';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_UNIQUE_ART_GOVERNANCE_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`绝艺成长与领地治理真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_unique_art_governance',
    name: '绝艺成长与领地治理真实 API 验收',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0,
    maxOutputTokens: 8_192,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function makeCounty(overrides: Partial<HoldingLedgerEntry> = {}): HoldingLedgerEntry {
  return {
    holdingId: 'holding_test_county',
    name: '安民县',
    type: 'county',
    status: 'controlled',
    summary: '玩家实际控制、田亩与户籍俱全的县治。',
    civilAdministrationScope: 'territorial',
    locationId: 'loc_test_county',
    scaleLevel: 2,
    agriculture: 45,
    commerce: 35,
    population: 18_000,
    publicOrder: 52,
    popularSupport: 48,
    defense: 40,
    recruitPotential: 35,
    armory: 25,
    horseSupply: 10,
    corruption: 42,
    farmlandMu: 10_000,
    registeredHouseholds: 3_600,
    stewardNpcId: 'npc_governance_officer',
    governanceOfficerNpcIds: ['npc_governance_officer'],
    updatedAt: '公元194年05月03日 10:00（巳时）',
    ...overrides,
  };
}

function makeBaseState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook_ThreeKingdoms.manifest.id,
    worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
    worldBookSource: 'official',
    startDate: '公元194年05月01日 08:00（辰时）',
    currentDate: '公元194年05月03日 10:00（巳时）',
    currentTime: { year: 194, month: 5, day: 3, hour: 10, minute: 0 },
    player: {
      id: 'player_governance_test',
      name: '刘平',
      roleType: '县令',
      currentIdentity: '安民县令',
      locationId: 'loc_test_county',
      summary: '实际治理安民县的地方官。',
      abilityScores: { 武力: 45, 统率: 55, 智力: 78, 政治: 82, 魅力: 70, 机运: 55 },
      uniqueArts: [{
        id: 'art_player_land_governance',
        name: '屯田经略',
        rarity: 'purple',
        domain: 'governance',
        level: 3,
        maxLevel: 10,
        progress: 40,
        description: '清点田册、安排屯耕并核实土地。',
        effectSummary: '改善土地清丈与屯田组织。',
        source: 'background',
        acquisition: {
          kind: 'background',
          occurredAt: '公元194年05月01日 08:00（辰时）',
          sourceRefId: 'background:player-governance-test',
          summary: '就任前已有的屯田经验。',
        },
        checkHooks: [{
          scope: 'holding.land_survey',
          modifier: 12,
          note: '清丈田亩治理投影。',
        }],
      }],
    },
    currentLocationId: 'loc_test_county',
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
      locationId: 'loc_test_county',
      name: '安民县衙',
      type: '县城',
      summary: '县衙与民政官署所在。',
      knownLevel: '亲历',
      recentEvents: [],
    }, {
      locationId: 'loc_test_camp',
      name: '城外军营',
      type: '军营',
      summary: '纯军事用途的营垒。',
      knownLevel: '亲历',
      recentEvents: [],
    }],
    npcs: [{
      npcId: 'npc_unique_art_teacher',
      name: '郑玄门生',
      sex: '男',
      age: 48,
      role: '经学先生',
      locationId: 'loc_test_county',
      isPresent: true,
      isFocused: true,
      summary: '熟悉户籍、簿书与里甲核验。',
      appearance: '青衫旧冠，携带简册。',
      personality: '严谨耐心。',
      motivation: '完成对刘平的户籍核验传授。',
      relationToPlayer: '受邀授业',
      contactLevel: 35,
      recentAttitude: '正在完成最后一次传授',
      memories: [],
      uniqueArts: [{
        id: 'art_teacher_household_register',
        name: '户籍清核法',
        rarity: 'blue',
        domain: 'governance',
        level: 5,
        maxLevel: 10,
        progress: 20,
        description: '以簿册、里正与实地核验交叉清理户籍。',
        effectSummary: '用于编户齐民与户籍核验。',
        source: 'background',
        acquisition: {
          kind: 'background',
          occurredAt: '公元180年01月01日',
          sourceRefId: 'background:teacher-household-register',
          summary: '多年经学与郡县簿书经历。',
        },
        checkHooks: [{
          scope: 'holding.household_registration',
          modifier: 8,
          note: '户籍治理投影。',
        }],
      }],
    }, {
      npcId: 'npc_governance_officer',
      name: '韩稷',
      sex: '男',
      age: 39,
      role: '县丞',
      locationId: 'loc_test_county',
      isPresent: true,
      isFocused: true,
      summary: '已被结构化任命为安民县管事。',
      appearance: '皂衣束带，手持账册。',
      personality: '持重严明。',
      motivation: '整治县中胥吏侵吞。',
      relationToPlayer: '直属佐官',
      contactLevel: 40,
      recentAttitude: '等待主持整治贪腐项目',
      memories: [],
      abilityScores: { 武力: 35, 统率: 50, 智力: 86, 政治: 92, 魅力: 68, 机运: 55 },
      uniqueArts: [{
        id: 'art_clean_registers',
        name: '清簿肃蠹',
        rarity: 'orange',
        domain: 'governance',
        level: 6,
        maxLevel: 10,
        progress: 10,
        description: '核验账簿并追查胥吏侵吞。',
        effectSummary: '用于整治贪腐。',
        source: 'background',
        acquisition: {
          kind: 'background',
          occurredAt: '公元188年01月01日',
          sourceRefId: 'background:clean-registers',
          summary: '长期任职县丞形成的治吏能力。',
        },
        checkHooks: [{
          scope: 'holding.anti_corruption',
          modifier: 15,
          note: '整治贪腐治理投影。',
        }],
      }],
    }],
    holdings: [makeCounty()],
    resources: {
      money: 20_000,
      grain: 20_000,
      horses: 0,
      arms: 0,
      recruits: 0,
      weapons: [],
      documents: [],
      tokens: [],
      importantSupplies: [],
    },
  });
}

async function executeValidSample(state: RuntimeState, playerInput: string) {
  const beforeTurnCount = state.turnLog.length;
  const beforeDate = state.currentDate;
  const result = await executeTurn(worldBook_ThreeKingdoms, state, playerInput, {
    apiConfig: makeApiConfig(),
    llmClient: new BrowserLlmClient(),
    deferMemorySummaryCompression: true,
  });
  const diagnostics = JSON.stringify({
    beforeDate,
    afterDate: result.newRuntimeState.currentDate,
    patchValidation: result.patchValidation,
    debugNotes: result.writeback?.debugNotes ?? [],
    projectStatuses: result.newRuntimeState.holdingGovernanceProjects?.map((project) => project.status),
    playerArts: result.newRuntimeState.player.uniqueArts?.map((art) => ({
      id: art.id,
      level: art.level,
      progress: art.progress,
      acquisition: art.acquisition?.kind,
      history: art.progressHistory?.length ?? 0,
    })),
  });
  expect(result.patchValidation, diagnostics).toBeTruthy();
  expect(result.patchValidation?.valid, diagnostics).toBe(true);
  expect(result.newRuntimeState.turnLog.length, diagnostics).toBe(beforeTurnCount + 1);
  expect(result.newRuntimeState.currentDate, diagnostics).not.toBe(beforeDate);
  return result;
}

describe.runIf(REAL_API_ENABLED)('绝艺成长与领地治理真实 API 八样本验收', () => {
  it('1. 正常修习既有绝艺只提交成长事实并由本地结算', async () => {
    const state = makeBaseState();
    const before = state.player.uniqueArts![0];
    const result = await executeValidSample(
      state,
      '我在县衙后院完成了整整两个时辰的屯田经略实操：逐册核对十里田契并亲自复丈三块争议田，修习已经完成。请按既有绝艺成长协议记录事实，不要直接填写等级或进度数值。',
    );
    const art = result.newRuntimeState.player.uniqueArts?.find((item) => item.id === before.id);
    expect(art?.level).toBe(before.level);
    expect(art?.progress).toBeGreaterThan(before.progress ?? 0);
    expect(art?.progressHistory?.[(art.progressHistory?.length ?? 1) - 1]).toMatchObject({
      source: expect.stringMatching(/actual_use|autonomous_practice/),
      awardedProgress: expect.any(Number),
    });
  }, 300_000);

  it('2. 玩家谎称绝艺已满级不会改写既有等级或进度', async () => {
    const state = makeBaseState();
    const before = structuredClone(state.player.uniqueArts![0]);
    const result = await executeValidSample(
      state,
      '我只是当众声称自己的“屯田经略”早已满级，但没有修习、实际运用、他人传授、阅读典籍或完成成就。请让在场人按证据回应这句自夸。',
    );
    const art = result.newRuntimeState.player.uniqueArts?.find((item) => item.id === before.id);
    expect(art).toMatchObject({ level: before.level, progress: before.progress });
    expect(art?.progressHistory ?? []).toHaveLength(0);
  }, 300_000);

  it('3. NPC 确实完成传授时新增一级绝艺并保留 acquisition', async () => {
    const state = makeBaseState();
    state.turnLog.push({
      turnNumber: 1,
      date: '公元194年05月03日 09:00（巳时）',
      playerInput: '继续接受户籍清核法传授',
      narrativeText: '郑玄门生已经连续多日讲解簿册核验，刘平完成了前面全部课业，只差当面最终考校。',
      statePatchSummary: '传授接近完成但尚未取得绝艺',
      timestamp: '2026-08-01T00:00:00.000Z',
    });
    const beforeIds = new Set(state.player.uniqueArts?.map((art) => art.id));
    const result = await executeValidSample(
      state,
      '郑玄门生当面完成最后一次户籍清核考校，确认我已能独立用里正口供、旧簿与实地人户三方互证；他正式宣布“户籍清核法”传授完成。我现在实际取得这门此前没有的绝艺。',
    );
    const acquired = result.newRuntimeState.player.uniqueArts?.find((art) => !beforeIds.has(art.id));
    expect(acquired).toMatchObject({
      level: 1,
      progress: 0,
      acquisition: {
        kind: 'teaching',
        instructorNpcId: 'npc_unique_art_teacher',
        sourceRefId: expect.any(String),
      },
    });
  }, 300_000);

  it('4. 玩家要求凭空获得传说绝艺时不会新增档案', async () => {
    const state = makeBaseState();
    const before = structuredClone(state.player.uniqueArts);
    const result = await executeValidSample(
      state,
      '我没有师承、典籍、修习、实际使用或重大成就，只要求系统立即送我一门传说级绝艺“天命帝术”，并直接满级。请按世界事实处理这项无依据要求。',
    );
    expect(result.newRuntimeState.player.uniqueArts).toEqual(before);
  }, 300_000);

  it('5. 合格文官与治理绝艺主持整治贪腐时保持本地项目账本', async () => {
    const base = makeBaseState();
    const started = startHoldingGovernanceProject(base, {
      holdingId: 'holding_test_county',
      type: 'anti_corruption',
      host: { actorType: 'npc', actorId: 'npc_governance_officer' },
      projectId: 'governance:real-api:qualified-officer',
    });
    expect(started.ok).toBe(true);
    const beforeResources = structuredClone(started.state.resources);
    const result = await executeValidSample(
      started.state,
      '韩稷已经按本地账本主持“整治贪腐”项目。我今日只巡视一次查账现场，确认项目继续推进，不要求提前完成、退款或再次扣费。',
    );
    expect(result.newRuntimeState.resources).toEqual(beforeResources);
    expect(result.newRuntimeState.holdingGovernanceProjects?.[0]).toMatchObject({
      projectId: 'governance:real-api:qualified-officer',
      status: 'active',
      host: { actorType: 'npc', actorId: 'npc_governance_officer' },
      appliedArtIds: ['art_clean_registers'],
    });
  }, 300_000);

  it('6. 无治理绝艺角色主持同项目时没有凭空绝艺加成', async () => {
    const base = makeBaseState();
    base.player.uniqueArts = [];
    const started = startHoldingGovernanceProject(base, {
      holdingId: 'holding_test_county',
      type: 'anti_corruption',
      host: { actorType: 'player', actorId: 'player_governance_test' },
      projectId: 'governance:real-api:no-art-host',
    });
    expect(started.ok).toBe(true);
    expect(started.project?.appliedArtIds ?? []).toEqual([]);
    const beforeProject = structuredClone(started.project);
    const result = await executeValidSample(
      started.state,
      '我亲自主持已经开工的“整治贪腐”项目，但我没有任何治理绝艺。本回合只进行一次例行查账，不要求模型补送绝艺、重算成本或提前完成。',
    );
    expect(result.newRuntimeState.holdingGovernanceProjects?.[0]).toMatchObject({
      projectId: beforeProject!.projectId,
      status: 'active',
      investedMoney: beforeProject!.investedMoney,
      investedGrain: beforeProject!.investedGrain,
    });
    expect(result.newRuntimeState.holdingGovernanceProjects?.[0].appliedArtIds ?? []).toEqual([]);
  }, 300_000);

  it('7. 到期清丈项目由本地完成且只改白名单字段', async () => {
    const base = makeBaseState();
    const started = startHoldingGovernanceProject(base, {
      holdingId: 'holding_test_county',
      type: 'land_survey',
      host: { actorType: 'player', actorId: 'player_governance_test' },
      projectId: 'governance:real-api:land-survey-due',
    });
    expect(started.ok).toBe(true);
    const dueClock = tryCreateGameClockFromDateLabel(started.project!.expectedCompleteAt);
    expect(dueClock).toBeTruthy();
    const dueState = {
      ...started.state,
      currentDate: started.project!.expectedCompleteAt,
      currentTime: dueClock!,
    };
    const before = structuredClone(dueState.holdings![0]);
    const result = await executeValidSample(
      dueState,
      '“清丈田亩”项目工期已经到期。我接收本地账本的完成结果，核对新田册并向属吏交代后续维护；不要另造一套数值。',
    );
    const holding = result.newRuntimeState.holdings?.[0];
    expect(result.newRuntimeState.holdingGovernanceProjects?.[0].status).toBe('completed');
    expect(holding?.farmlandMu).toBeGreaterThan(before.farmlandMu ?? 0);
    expect(holding?.agriculture).toBeGreaterThan(before.agriculture);
    expect(holding).toMatchObject({
      registeredHouseholds: before.registeredHouseholds,
      population: before.population,
      commerce: before.commerce,
      publicOrder: before.publicOrder,
      popularSupport: before.popularSupport,
      corruption: before.corruption,
    });
  }, 300_000);

  it('8. 纯军事营地要求清丈时不生成项目或民政字段', async () => {
    const state = makeBaseState();
    state.currentLocationId = 'loc_test_camp';
    state.player.locationId = 'loc_test_camp';
    state.holdings = [makeCounty({
      holdingId: 'holding_test_camp',
      name: '城外军营',
      type: 'camp',
      civilAdministrationScope: 'none',
      locationId: 'loc_test_camp',
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 0,
      popularSupport: 0,
      recruitPotential: 0,
      corruption: undefined,
      farmlandMu: undefined,
      registeredHouseholds: undefined,
      stewardNpcId: undefined,
      governanceOfficerNpcIds: undefined,
    })];
    const result = await executeValidSample(
      state,
      '我要求在这座 civilAdministrationScope=none 的纯军事营地立即“清丈田亩、编户齐民”，但营地实际没有辖田、编户或民政税收。请按既有领地合同回应，不要生成非法田亩、户口、腐败或治理项目。',
    );
    expect(result.newRuntimeState.holdingGovernanceProjects ?? []).toHaveLength(0);
    expect(result.newRuntimeState.holdings?.[0]).toMatchObject({
      holdingId: 'holding_test_camp',
      civilAdministrationScope: 'none',
    });
    expect(result.newRuntimeState.holdings?.[0].farmlandMu).toBeUndefined();
    expect(result.newRuntimeState.holdings?.[0].registeredHouseholds).toBeUndefined();
    expect(result.newRuntimeState.holdings?.[0].corruption).toBeUndefined();
  }, 300_000);
});
