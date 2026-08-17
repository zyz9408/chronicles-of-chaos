import { describe, expect, it } from 'vitest';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { BrowserLlmClient, type LlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import { parseNarratorResponse } from '../turn/NarratorResponseParser';
import { executeTurn } from '../turn/TurnOrchestrator';
import { advanceCorrespondenceState, createCorrespondenceDraft } from './CorrespondenceRuntime';
import { polishLetterDraft } from './LetterPolishService';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const WORKFLOW_REAL_API_ENABLED = TEST_ENV.COC_V2_CORRESPONDENCE_REAL_API === '1';
const POLISH_REAL_API_ENABLED = TEST_ENV.COC_V2_LETTER_POLISH_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`书信真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(prefix = 'COC_V2_TEST_API'): ApiConfigArchive {
  return {
    id: `api_real_correspondence_${prefix.toLowerCase()}`,
    name: prefix === 'COC_V2_LETTER_POLISH_TEST_API' ? '轻量书信润色真实 API' : '书信写回真实 API',
    provider: requireEnvironment(`${prefix}_PROVIDER`) as ApiProviderId,
    baseUrl: requireEnvironment(`${prefix}_BASE_URL`),
    apiKey: requireEnvironment(`${prefix}_KEY`),
    model: requireEnvironment(`${prefix}_MODEL`),
    temperature: 0,
    maxOutputTokens: prefix === 'COC_V2_LETTER_POLISH_TEST_API' ? 1_200 : 8_192,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
  };
}

function makeState(): RuntimeState {
  const state = ensureLuanShiState({
    engineVersion: '1.6.14',
    worldBookId: worldBook_ThreeKingdoms.manifest.id,
    worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
    worldBookSource: 'official',
    startDate: '公元184年03月01日 08:00（辰时）',
    currentDate: '公元184年03月01日 08:00（辰时）',
    currentTime: { year: 184, month: 3, day: 1, hour: 8, minute: 0 },
    currentLocationId: 'place_a',
    currentPlaceId: 'place_a',
    player: {
      id: 'player_correspondence_test', name: '林砚', roleType: '军中书吏',
      summary: '正在军营等候远方回信。', inventory: [], equipment: [], effects: [],
    },
    knownActors: [], knownFactions: [], relationships: [], knownRumors: [], activeQuests: [],
    playerResources: {}, worldStateDelta: {}, turnLog: [], localSituationNotes: [],
    resources: {
      money: 10, grain: 100, horses: 0, arms: 0, recruits: 0,
      weapons: [], documents: [], tokens: [], importantSupplies: [],
    },
    npcs: [{
      npcId: 'npc_caiyan_correspondence_test', name: '蔡琰', sex: '女', age: 10,
      role: '故交', locationId: 'place_b', isPresent: false, isFocused: true,
      summary: '暂居邻县，可调动家中少量存粮。', appearance: '素衣端庄。',
      personality: '谨慎守信', motivation: '照应故交并保全家人', relationToPlayer: '故交',
      contactLevel: 45, recentAttitude: '愿意相助', memories: [],
    }],
    routeEdges: [{
      routeId: 'route_ab', fromPlaceId: 'place_a', toPlaceId: 'place_b', name: '邻县驿道',
      status: '可通行', source: 'worldbook', knownLevel: '亲历', standardTravelMinutes: 1_440,
    }],
    locations: [
      { locationId: 'place_a', name: '汉水北岸大营', type: '军营', summary: '驻军营地。', knownLevel: '亲历', recentEvents: [] },
      { locationId: 'place_b', name: '邻县蔡宅', type: '宅院', summary: '蔡氏暂居处。', knownLevel: '亲历', recentEvents: [] },
    ],
  } as RuntimeState);
  state.correspondence = [{
    ...createCorrespondenceDraft({
      letterId: 'letter_player_request_grain',
      sender: { kind: 'player', playerId: state.player.id, name: state.player.name },
      recipient: { kind: 'npc', npcId: 'npc_caiyan_correspondence_test', name: '蔡琰' },
      subject: '借粮救急',
      body: '若家中方便，请于三月初四午时前送二百石粮草到汉水北岸大营；若不能，也请直言。',
      createdAt: state.currentDate,
      source: 'ui',
    }),
    status: 'deliveredPendingProcessing',
    deliveredAt: state.currentDate,
  }];
  return state;
}

function makeNarrativeFixtureClient(narrativeText: string): LlmClient {
  return {
    generate: async () => ({
      content: JSON.stringify({
        protocolVersion: 'lsfy.turn.v1',
        narrativeText,
        suggestedActions: [],
        statePatches: [{
          type: 'timeAdvance',
          payload: { minutesAdvanced: 30, reason: '处理书信或交割', category: 'administration' },
          reason: '事务耗时',
        }],
        statePatch: null,
        writeback: {
          npcProfileSuggestions: [], npcMemorySuggestions: [], locationWriteSuggestions: [],
          routeWriteSuggestions: [], questChanges: [], debugNotes: [],
        },
      }),
      provider: 'openai_compatible',
      model: 'deterministic-correspondence-fixture',
    }),
  };
}

describe.runIf(WORKFLOW_REAL_API_ENABLED)('书信与承诺状态写回真实 API 验收', () => {
  it('正文明确收到 NPC 回信时立即进入书信账本', async () => {
    const apiConfig = makeApiConfig();
    const realWritebackDelegate = new BrowserLlmClient();
    let rawWritebackContent = '';
    const realWritebackClient: LlmClient = {
      generate: async (request) => {
        const result = await realWritebackDelegate.generate(request);
        rawWritebackContent = result.content;
        return result;
      },
    };
    const accepted = await executeTurn(
      worldBook_ThreeKingdoms,
      makeState(),
      '查看驿卒刚刚送到手中的蔡琰回信。',
      {
        apiConfig,
        stateWritebackApiConfig: apiConfig,
        llmClient: makeNarrativeFixtureClient(
          '午后，驿卒把蔡琰亲笔回信交到你手中。你当场拆阅并收存了此信。'
            + '她在信中说明暂时无法调粮，本回合没有形成新的钱粮承诺。',
        ),
        stateWritebackLlmClient: realWritebackClient,
        deferMemorySummaryCompression: true,
      },
    );

    const reply = accepted.newRuntimeState.correspondence?.find(
      (entry) => entry.direction === 'incoming',
    );
    const diagnostics = JSON.stringify({
      rawContentExcerpt: rawWritebackContent.slice(0, 4_000),
      rawWriteback: rawWritebackContent ? parseNarratorResponse(rawWritebackContent).writeback : null,
      patchValidation: accepted.patchValidation,
      correspondence: accepted.newRuntimeState.correspondence,
    });
    expect(accepted.patchValidation, diagnostics).toMatchObject({ valid: true, errors: [] });
    expect(reply?.status, diagnostics).toBe('delivered');
  }, 360_000);

  it('从 NPC 回信立约，经双程送达，到期后只结算一次钱粮', async () => {
    const apiConfig = makeApiConfig();
    const realWritebackDelegate = new BrowserLlmClient();
    let rawWritebackContent = '';
    let requestContainsLetter = false;
    let requestContainsCorrespondenceContract = false;
    const realWritebackClient: LlmClient = {
      generate: async (request) => {
        const requestText = request.messages.map((message) => message.content).join('\n');
        requestContainsLetter = requestText.includes('letter_player_request_grain');
        requestContainsCorrespondenceContract = requestText.includes('correspondenceActions');
        const result = await realWritebackDelegate.generate(request);
        rawWritebackContent = result.content;
        return result;
      },
    };
    const accepted = await executeTurn(
      worldBook_ThreeKingdoms,
      makeState(),
      '等待驿卒带回蔡琰对借粮请求的正式答复。',
      {
        apiConfig,
        stateWritebackApiConfig: apiConfig,
        llmClient: makeNarrativeFixtureClient(
          '午后，驿卒带回蔡琰亲笔回信。信中明确答应调拨二百石粮草，'
            + '并约定公元184年03月04日12:00前送到汉水北岸大营。她已经写毕并寄出此信。',
        ),
        stateWritebackLlmClient: realWritebackClient,
        deferMemorySummaryCompression: true,
      },
    );

    expect(accepted.patchValidation).toMatchObject({ valid: true, errors: [] });
    const reply = accepted.newRuntimeState.correspondence?.find(
      (entry) => entry.direction === 'incoming',
    );
    const acceptanceDiagnostics = JSON.stringify({
      requestContainsLetter,
      requestContainsCorrespondenceContract,
      rawContentExcerpt: rawWritebackContent.slice(0, 4_000),
      rawWriteback: rawWritebackContent ? parseNarratorResponse(rawWritebackContent).writeback : null,
      turnSummary: accepted.writeback?.turnSummary,
      correspondence: accepted.newRuntimeState.correspondence,
      commitments: accepted.newRuntimeState.correspondenceCommitments,
      lastTurnSummary: accepted.newRuntimeState.turnLog[
        accepted.newRuntimeState.turnLog.length - 1
      ]?.statePatchSummary,
    });
    expect(reply?.status, acceptanceDiagnostics).toBe('inTransit');
    const commitment = accepted.newRuntimeState.correspondenceCommitments?.[0];
    expect(commitment).toMatchObject({
      status: 'preparing', targetLocationId: 'place_a',
      deliverables: [{ kind: 'resources', resources: { grain: 200 } }],
    });

    const replyDelivered = advanceCorrespondenceState(
      accepted.newRuntimeState,
      reply!.deliveryDueAt!,
    ).state;
    expect(replyDelivered.correspondence?.find((entry) => entry.letterId === reply!.letterId)?.status)
      .toBe('delivered');
    const due = advanceCorrespondenceState(replyDelivered, commitment!.expectedAt).state;
    expect(due.correspondenceCommitments?.[0].status).toBe('due');

    const fulfilled = await executeTurn(
      worldBook_ThreeKingdoms,
      due,
      '到约定时刻，亲自清点蔡琰答应送来的粮草。',
      {
        apiConfig,
        stateWritebackApiConfig: apiConfig,
        llmClient: makeNarrativeFixtureClient(
          '三月初四午时，蔡氏粮车抵达汉水北岸大营，约定的二百石粮草如数交割入府库。'
            + '这是书信承诺的全部履行，本回合没有其他粮草收入。',
        ),
        stateWritebackLlmClient: realWritebackClient,
        deferMemorySummaryCompression: true,
      },
    );
    expect(fulfilled.patchValidation).toMatchObject({ valid: true, errors: [] });
    const fulfillmentDiagnostics = JSON.stringify({
      rawContentExcerpt: rawWritebackContent.slice(0, 4_000),
      turnSummary: fulfilled.writeback?.turnSummary,
      commitments: fulfilled.newRuntimeState.correspondenceCommitments,
      grain: fulfilled.newRuntimeState.resources?.grain,
    });
    expect(fulfilled.newRuntimeState.resources?.grain, fulfillmentDiagnostics).toBe(300);
    expect(fulfilled.newRuntimeState.correspondenceCommitments?.[0].status).toBe('fulfilled');

    const replayed = advanceCorrespondenceState(
      fulfilled.newRuntimeState,
      fulfilled.newRuntimeState.currentDate,
    ).state;
    expect(replayed.resources?.grain).toBe(300);
  }, 360_000);
});

describe.runIf(POLISH_REAL_API_ENABLED)('书信轻量润色真实 API 验收', () => {
  it('使用独立轻量路由一次润色并保留日期、数量和地点', async () => {
    const config = makeApiConfig('COC_V2_LETTER_POLISH_TEST_API');
    const result = await polishLetterDraft({
      body: '请在八月十五日前把二百石粮食送到襄阳。若做不到请直接告诉我。',
      senderName: '林砚',
      recipientName: '蔡琰',
      currentDate: '公元184年08月01日 08:00（辰时）',
      eraSummary: '东汉末年，驿传仍可通行。',
    }, {
      resolveConfig: async () => config,
      llmClient: new BrowserLlmClient(),
    });

    expect(result.model).toBe(config.model);
    expect(result.body).toContain('八月十五');
    expect(result.body).toContain('二百石');
    expect(result.body).toContain('襄阳');
  }, 90_000);
});
