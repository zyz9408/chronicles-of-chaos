import { describe, expect, it } from 'vitest';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import {
  BrowserLlmClient,
  type LlmClient,
  type LlmGenerateRequest,
  type LlmGenerateResult,
} from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState, StatePatch } from '../types';
import { parseNarratorResponse } from '../turn/NarratorResponseParser';
import { composePrompt } from '../turn/PromptComposer';
import { buildTurnMessages } from '../turn/TurnPromptMessages';
import { executeTurn } from '../turn/TurnOrchestrator';
import { stageCombatEncounter, stageCombatEncounterOffer } from './EncounterRuntimeIntegration';
import { prepareWarEncounterForPlay, stageWarEncounter } from './WarRuntimeIntegration';
import { makeWarTroop } from './WarTestFixtures';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_REAL_API_MATRIX === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`真实 API 场景矩阵缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_encounter_matrix',
    name: 'Encounter V2 真实 API 场景矩阵',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0.25,
    maxOutputTokens: 6_000,
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
  };
}

function makeWarReferenceRealApiClient(): {
  client: LlmClient;
  getRealApiCallCount: () => number;
  getRealApiResponseDiagnostics: () => unknown[];
  getDeterministicMainCount: () => number;
  getDeterministicTimeRepairCount: () => number;
} {
  const realClient = new BrowserLlmClient();
  const realApiResponseDiagnostics: unknown[] = [];
  let realApiCallCount = 0;
  let deterministicMainCount = 0;
  let deterministicTimeRepairCount = 0;

  return {
    client: {
      async generate(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
        const prompt = request.messages.map((message) => message.content).join('\n');
        const isEncounterReferenceRepair = prompt.includes(
          '你是乱世风云录的 Encounter V2 切入校正器。',
        );
        if (isEncounterReferenceRepair) {
          realApiCallCount += 1;
          const result = await realClient.generate(request);
          realApiResponseDiagnostics.push(summarizeWarReferenceRepairContent(result.content));
          return result;
        }
        const isTimeAdvanceRepair = prompt.includes('你是乱世风云录的回合 JSON 修复器。')
          && prompt.includes('若原 JSON 缺少有效 timeAdvance');
        if (isTimeAdvanceRepair) {
          deterministicTimeRepairCount += 1;
          return {
            content: JSON.stringify({
              protocolVersion: 'lsfy.turn.v1',
              narrativeText: '',
              suggestedActions: [],
              statePatches: [{
                type: 'timeAdvance',
                payload: {
                  minutesAdvanced: 30,
                  reason: '夺门与接战耗时',
                  category: 'battle',
                },
                reason: '战争切入专项测试的时间推进补全',
              }],
              statePatch: null,
            }),
            provider: request.config.provider,
            model: 'deterministic-time-repair',
          };
        }

        deterministicMainCount += 1;
        return {
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '荆州前锋撞开新野县城防御据点的外门，守军沿着甬道压来，双方已经短兵相接。'
              + '箭矢越过垛口落入队列，刀盾兵在门洞内顶住第一轮冲撞，战斗已无法由任何一方单方面撤回。'
              + '这一回合只确认开战前的兵力与据点，不提前叙述伤亡、胜负或控制权变化。',
            suggestedActions: [],
            statePatches: [{
              type: 'timeAdvance',
              payload: {
                minutesAdvanced: 30,
                reason: '前锋夺门并与守军接战',
                category: 'battle',
              },
              reason: '强行突入防御据点所需时间',
            }],
            statePatch: null,
            writeback: {
              encounterTransitionDecision: {
                mode: 'start',
                reason: '两军已经发生不可回避的实际交锋。',
              },
              encounterStartIntent: {
                contractVersion: 1,
                encounterId: 'war_real_api_map_only_xinye_fort',
                kind: 'war',
                rulesetVersion: 'war-v2.1.0',
                sourceTurnNumber: 1,
                locationId: 'place_jingzhou_xinye',
                reason: '前锋已经突入防御据点并与守军正式接战。',
                seed: 'war_real_api_map_only_xinye_fort_seed',
                createdAt: '2026-07-30T06:30:00.000Z',
                policy: {
                  lethality: 'standard',
                  allowRetreat: true,
                  allowSurrender: true,
                  allowCapture: true,
                  lootPolicy: 'none',
                },
                playerForce: {
                  troopIds: ['troop_player_infantry'],
                  commanderActorId: 'player_liuping',
                },
                enemyForce: {
                  troopIds: ['troop_xinye_fort_garrison'],
                },
                objective: 'capture_holding',
                targetHoldingId: 'holding_xinye_fort',
                environmentTags: ['fortified'],
              },
              semanticProjections: [],
            },
          }),
          provider: request.config.provider,
          model: 'deterministic-dangling-war-main',
        };
      },
    },
    getRealApiCallCount: () => realApiCallCount,
    getRealApiResponseDiagnostics: () => [...realApiResponseDiagnostics],
    getDeterministicMainCount: () => deterministicMainCount,
    getDeterministicTimeRepairCount: () => deterministicTimeRepairCount,
  };
}

function summarizeWarReferenceRepairContent(content: string): unknown {
  try {
    const parsed = JSON.parse(content) as {
      narrativeText?: unknown;
      statePatches?: Array<{
        type?: unknown;
        reason?: unknown;
        payload?: { command?: Record<string, unknown> };
      }>;
      statePatch?: unknown;
      writeback?: {
        encounterTransitionDecision?: unknown;
        encounterStartIntent?: unknown;
      };
    };
    return {
      narrativeText: parsed.narrativeText,
      statePatches: parsed.statePatches?.map((patch) => ({
        type: patch.type,
        reason: patch.reason,
        command: patch.payload?.command,
      })),
      statePatch: parsed.statePatch,
      encounterTransitionDecision: parsed.writeback?.encounterTransitionDecision,
      encounterStartIntent: parsed.writeback?.encounterStartIntent,
    };
  } catch {
    return { unparseableContentStart: content.slice(0, 800) };
  }
}

function makeBaseState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook_ThreeKingdoms.manifest.id,
    worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
    worldBookSource: 'official',
    startDate: '公元194年05月03日 02:00',
    currentDate: '公元194年05月03日 02:00',
    currentTime: { year: 194, month: 5, day: 3, hour: 2, minute: 0 },
    player: {
      id: 'player_liuping',
      name: '刘平',
      sex: '男',
      age: 24,
      roleType: '将领',
      currentIdentity: '荆州别部司马',
      level: 5,
      xp: 100,
      abilityScores: { 武力: 86, 统率: 82, 智力: 73, 政治: 55, 魅力: 68, 机运: 60 },
      vitals: { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 },
      traits: [{
        id: 'trait_calm_under_fire',
        label: '临危不乱',
        description: '身处险境仍能稳定判断与出手。',
        source: 'history',
      }],
      uniqueArts: [{
        id: 'art_seven_coiled_spear',
        name: '七探蛇盘枪',
        rarity: 'red',
        domain: 'personalCombat',
        level: 3,
        description: '枪势连绵，可在近身战中连续追击。',
        effectSummary: '连续攻击并压制围攻。',
        source: 'history',
      }],
      equipment: [{
        id: 'eq_tempered_spear',
        slot: 'weapon',
        name: '精锻长枪',
        quality: '精良',
        description: '枪杆坚韧、枪锋锐利的军用长枪。',
      }],
      inventory: [{
        id: 'item_trauma_powder',
        name: '金创药',
        quantity: 2,
        description: '战斗中可用于止血的外伤药。',
      }],
      personalMoney: 20,
      summary: '率军驻守新野的荆州将领。',
    },
    currentLocationId: 'place_jingzhou_xinye',
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
      locationId: 'place_jingzhou_xinye',
      name: '新野县城',
      type: '县城',
      summary: '荆州北境要地。',
      knownLevel: '亲历',
      recentEvents: [],
    }],
    npcs: [],
  });
}

function makeCombatState(): RuntimeState {
  const state = makeBaseState();
  state.npcs = [{
    npcId: 'npc_xiliang_raider',
    name: '西凉悍卒',
    sex: '男',
    age: 31,
    role: '敌军先锋',
    locationId: 'place_jingzhou_xinye',
    isPresent: true,
    isFocused: true,
    summary: '披重甲、持环首刀的西凉老卒。',
    appearance: '披札甲，持环首刀。',
    personality: '凶悍直接。',
    motivation: '突破刘平的拦截。',
    relationToPlayer: '敌对',
    contactLevel: 1,
    recentAttitude: '已经挥刀冲来',
    abilityScores: { 武力: 68, 统率: 45, 智力: 42, 政治: 30, 魅力: 35, 机运: 45 },
    vitals: { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 },
    traits: [],
    uniqueArts: [],
    equipment: [],
    inventory: [],
    memories: [],
  }];
  return state;
}

function makeWarState(): RuntimeState {
  const state = makeBaseState();
  state.npcs = [{
      npcId: 'npc_zhao_yun',
      name: '赵云',
      sex: '男',
      age: 27,
      role: '荆州军副将',
      locationId: 'place_jingzhou_xinye',
      isPresent: true,
      isFocused: true,
      summary: '随刘平统率荆州主力步兵营的副将。',
      appearance: '白袍银甲，手持长枪。',
      personality: '沉着果敢。',
      motivation: '协助刘平稳住战阵并击退西凉军。',
      relationToPlayer: '友善',
      contactLevel: 3,
      recentAttitude: '已经入列听令',
      abilityScores: { 武力: 94, 统率: 88, 智力: 76, 政治: 54, 魅力: 82, 机运: 70 },
      traits: [],
      uniqueArts: [{
        id: 'art_zhao_yun_dragon_formation',
        name: '龙胆破阵',
        rarity: 'purple',
        domain: 'warfare',
        level: 4,
        description: '率精锐突入敌阵后迅速重整队列，扰乱敌方阵脚。',
        effectSummary: '提高突击效率并削弱敌军士气。',
        source: 'history',
      }],
      equipment: [],
      inventory: [],
      memories: [],
    }, {
      npcId: 'npc_enemy_commander',
      name: '张济',
      sex: '男',
      age: 39,
      role: '西凉军主将',
      locationId: 'place_jingzhou_xinye',
      isPresent: true,
      isFocused: true,
      summary: '正在新野城外列阵的敌将。',
      appearance: '披铁甲，乘黑马。',
      personality: '强硬谨慎。',
      motivation: '击溃刘平军。',
      relationToPlayer: '敌对',
      contactLevel: 1,
      recentAttitude: '已经下令进军',
      abilityScores: { 武力: 72, 统率: 70, 智力: 58, 政治: 42, 魅力: 55, 机运: 48 },
      traits: [],
      uniqueArts: [],
      equipment: [],
      inventory: [],
      memories: [],
    }];
  state.troops = [
    makeWarTroop('troop_player_infantry', {
      name: '荆州主力步兵营',
      size: 1_500,
      morale: 78,
      training: 75,
      quality: '高',
      readiness: '高',
      supplies: 75,
      factionId: 'faction_player',
      locationId: 'place_jingzhou_xinye',
      deputyNpcIds: ['npc_zhao_yun'],
    }),
    makeWarTroop('troop_enemy_cavalry', {
      name: '西凉精锐骑兵',
      size: 1_200,
      morale: 76,
      training: 78,
      quality: '高',
      readiness: '高',
      supplies: 70,
      factionId: 'faction_enemy',
      locationId: 'place_jingzhou_xinye',
    }),
  ];
  state.factions = [{
    factionId: 'faction_player',
    name: '荆州官府',
    type: '官府',
    summary: '刘平效力的荆州势力。',
    stanceToPlayer: '拥护',
    knownLevel: '亲历',
    relatedTroopIds: ['troop_player_infantry'],
    recentActions: [],
  }, {
    factionId: 'faction_enemy',
    name: '西凉军',
    type: '军阀',
    summary: '正在进攻新野的敌军。',
    stanceToPlayer: '敌对',
    knownLevel: '亲历',
    relatedTroopIds: ['troop_enemy_cavalry'],
    recentActions: [],
  }];
  state.holdings = [{
    holdingId: 'holding_xinye',
    name: '新野县城',
    type: 'city',
    status: 'contested',
    summary: '双方正在争夺的新野县城。',
    locationId: 'place_jingzhou_xinye',
    factionId: 'faction_player',
    actualController: '荆州官府',
    scaleLevel: 2,
    agriculture: 40,
    commerce: 35,
    population: 40,
    publicOrder: 45,
    popularSupport: 50,
    defense: 55,
    recruitPotential: 40,
    armory: 45,
    horseSupply: 25,
    corruption: 20,
    siege: { status: 'encircled', supplyLine: 'strained', preparation: 'prepared' },
    garrisonTroopIds: ['troop_player_infantry'],
    updatedAt: '公元194年05月03日 02:00',
  }];
  return state;
}

function makeMapOnlyWarState(): RuntimeState {
  const state = makeWarState();
  state.troops = state.troops?.filter((troop) => troop.troopId === 'troop_player_infantry');
  state.holdings = [];
  state.player.summary = '率荆州主力步兵营强攻新野县城内尚未登记进领地账本的敌方坞堡。';
  return state;
}

function collectPatchTypes(response: ReturnType<typeof parseNarratorResponse>): string[] {
  const patches: StatePatch[] = [
    ...(response.statePatches ?? []),
    ...(response.statePatch ? [response.statePatch] : []),
  ];
  return patches.map((patch) => patch.type);
}

function diagnosticSummary(response: ReturnType<typeof parseNarratorResponse>) {
  return {
    narrativeChars: response.narrativeText.length,
    patchTypes: collectPatchTypes(response),
    transitionMode: response.writeback?.encounterTransitionDecision?.mode ?? null,
    intentKind: response.writeback?.encounterStartIntent?.kind ?? null,
    escortAvailability: response.writeback?.encounterStartIntent?.kind === 'personal_combat'
      ? response.writeback.encounterStartIntent.escortAvailability ?? null
      : null,
    playerParty: response.writeback?.encounterStartIntent?.kind === 'personal_combat'
      ? response.writeback.encounterStartIntent.playerParty.actorIds
      : [],
    scopedCombatants: response.writeback?.encounterStartIntent?.kind === 'personal_combat'
      ? response.writeback.encounterStartIntent.scopedCombatants ?? []
      : [],
    projectionKinds: (response.writeback?.semanticProjections ?? []).map((profile) => (
      `${profile.profileKind}:${profile.sourceId}:${profile.status}`
    )),
    debugNotes: response.writeback?.debugNotes ?? [],
  };
}

async function runLiveTurn(state: RuntimeState, playerInput: string) {
  const prompt = composePrompt(
    worldBook_ThreeKingdoms,
    undefined,
    [],
    undefined,
    state,
    playerInput,
  );
  const generated = await new BrowserLlmClient().generate({
    config: makeApiConfig(),
    messages: buildTurnMessages(
      prompt.systemPrompt,
      prompt.userPrompt,
      prompt.stateWriterContext,
      prompt.adultIntimacyFinalReminder,
      prompt.narrativeProseFinalReview,
      prompt.narrativeLengthFinalReminder,
    ),
    responseFormat: 'json_object',
    temperature: 0.25,
    maxOutputTokens: 6_000,
    timeoutMs: 240_000,
    retryCount: 2,
    retryDelayMs: 1_500,
  });
  return parseNarratorResponse(generated.content, {
    encounterIntentCreatedAt: prompt.timestamp,
    encounterIntentSourceTurnNumber: state.turnLog.length + 1,
  });
}

function appendCommittedTriggerTurn(
  state: RuntimeState,
  playerInput: string,
  narrativeText: string,
): RuntimeState {
  const committed = structuredClone(state);
  committed.turnLog.push({
    turnNumber: committed.turnLog.length + 1,
    date: committed.currentDate,
    playerInput,
    narrativeText,
    fullNarrativeText: narrativeText,
    statePatchSummary: '真实 API Encounter V2 触发测试',
    timestamp: '2026-07-20T12:00:00.000Z',
  });
  return committed;
}

describe('Encounter V2 live prompt contract', () => {
  it('projects the actual player ID and all stable Combat source IDs', () => {
    const prompt = composePrompt(
      worldBook_ThreeKingdoms,
      undefined,
      [],
      undefined,
      makeCombatState(),
      '我以七探蛇盘枪迎敌。',
    );

    expect(prompt.stateWriterContext).toContain('playerActorId: player_liuping');
    expect(prompt.stateWriterContext).toContain('sourceId: trait_calm_under_fire');
    expect(prompt.stateWriterContext).toContain('sourceId: art_seven_coiled_spear');
    expect(prompt.stateWriterContext).toContain('sourceId: eq_tempered_spear');
    expect(prompt.userPrompt).toContain('projectionVersion=1');
    expect(prompt.userPrompt).toContain('powerClass 固定档位');
    expect(prompt.userPrompt).toContain('profileKind":"troop');
  });

  it('projects stable War troop, commander and holding IDs', () => {
    const prompt = composePrompt(
      worldBook_ThreeKingdoms,
      undefined,
      [],
      undefined,
      makeWarState(),
      '我亲自指挥两军交战。',
    );

    expect(prompt.stateWriterContext).toContain('playerActorId: player_liuping');
    expect(prompt.stateWriterContext).toContain('actorId: npc_enemy_commander');
    expect(prompt.stateWriterContext).toContain('troopId: troop_player_infantry');
    expect(prompt.stateWriterContext).toContain('troopId: troop_enemy_cavalry');
    expect(prompt.stateWriterContext).toContain('holdingId: holding_xinye');
    expect(prompt.stateWriterContext).toContain('deputyActorIds: npc_zhao_yun');
    expect(prompt.stateWriterContext).toContain('actorId: npc_zhao_yun');
  });
});

describe.skipIf(!REAL_API_ENABLED)('Encounter V2 real API trigger and projection matrix', () => {
  it('starts a personal combat with stable IDs and locally executable source projections', async () => {
    const state = makeCombatState();
    const playerInput = '西凉悍卒已经挥刀扑到面前。我拔出精锻长枪，以七探蛇盘枪迎击，第一枪直刺他的胸甲。';
    const response = await runLiveTurn(
      state,
      playerInput,
    );
    const summary = diagnosticSummary(response);
    const intent = response.writeback?.encounterStartIntent;

    expect(intent, JSON.stringify(summary)).toBeTruthy();
    expect(response.writeback?.encounterTransitionDecision?.mode, JSON.stringify(summary)).toBe('start');
    expect(intent?.kind, JSON.stringify(summary)).toBe('personal_combat');
    if (!intent || intent.kind !== 'personal_combat') return;
    expect(intent.playerParty.actorIds).toEqual(['player_liuping']);
    expect(intent.enemyParty.actorIds).toEqual(['npc_xiliang_raider']);
    expect(collectPatchTypes(response)).not.toContain('upsertCombatRecord');
    expect(response.narrativeText).not.toMatch(/\[\[判定:combat:/);

    const projections = response.writeback?.semanticProjections ?? [];
    const sourceIds = new Set(projections.map((profile) => profile.sourceId));
    expect(sourceIds, JSON.stringify(summary)).toContain('art_seven_coiled_spear');
    expect(sourceIds, JSON.stringify(summary)).toContain('eq_tempered_spear');

    const staged = stageCombatEncounter(
      appendCommittedTriggerTurn(state, playerInput, response.narrativeText),
      {
      saveId: 'save_real_api_combat_matrix',
      intent,
      projections,
      createdAt: '2026-07-20T12:00:00.000Z',
      },
    );
    expect(staged.encounterV2?.active?.session.intent.encounterId).toBe(intent.encounterId);
  }, 300_000);

  it('offers a one-off contextual choice at an unresolved personal-combat boundary', async () => {
    const state = makeCombatState();
    const playerInput = '我横枪拦住西凉悍卒，喝令他放下兵刃。他也举刀对峙，但双方尚未出手，我仍可选择迎战或退开。';
    const response = await runLiveTurn(state, playerInput);
    const summary = diagnosticSummary(response);
    const intent = response.writeback?.encounterStartIntent;

    expect(response.writeback?.encounterTransitionDecision?.mode, JSON.stringify(summary)).toBe('offer');
    expect(intent?.kind, JSON.stringify(summary)).toBe('personal_combat');
    if (!intent || intent.kind !== 'personal_combat') return;
    expect(intent.enemyParty.actorIds).toEqual(['npc_xiliang_raider']);
    const offered = stageCombatEncounterOffer(
      appendCommittedTriggerTurn(state, playerInput, response.narrativeText),
      {
        saveId: 'save_real_api_combat_offer',
        intent,
        projections: response.writeback?.semanticProjections ?? [],
        createdAt: '2026-07-20T12:00:00.000Z',
      },
    );
    expect(offered.encounterV2?.active).toBeUndefined();
    expect(offered.encounterV2?.pendingOffer?.intent.encounterId).toBe(intent.encounterId);
  }, 300_000);

  it('starts obvious melee against anonymous enemies through encounter-scoped combatants', async () => {
    const state = makeBaseState();
    const playerInput = '我猛夹马腹撞入两名溃卒之间，长枪已经朝他们横扫过去；一名溃卒的长矛也已迎面刺来，第一击尚未判定命中。';
    const response = await runLiveTurn(state, playerInput);
    const summary = diagnosticSummary(response);
    const intent = response.writeback?.encounterStartIntent;

    expect(response.writeback?.encounterTransitionDecision?.mode, JSON.stringify(summary)).toBe('start');
    expect(intent?.kind, JSON.stringify(summary)).toBe('personal_combat');
    if (!intent || intent.kind !== 'personal_combat') return;
    expect(intent.scopedCombatants?.length, JSON.stringify(summary)).toBeGreaterThanOrEqual(1);
    const scopedIds = new Set((intent.scopedCombatants ?? []).map((combatant) => combatant.actorId));
    expect(intent.enemyParty.actorIds.every((actorId) => scopedIds.has(actorId)), JSON.stringify(summary)).toBe(true);
    expect(intent.scopedCombatants?.every((combatant) => (
      combatant.actorId.startsWith(`${intent.encounterId}:scoped:`)
    )), JSON.stringify(summary)).toBe(true);

    const staged = stageCombatEncounter(
      appendCommittedTriggerTurn(state, playerInput, response.narrativeText),
      {
        saveId: 'save_real_api_scoped_combat',
        intent,
        projections: response.writeback?.semanticProjections ?? [],
        createdAt: '2026-07-20T12:00:00.000Z',
      },
    );
    expect(staged.encounterV2?.active?.session.intent.encounterId).toBe(intent.encounterId);
  }, 300_000);

  it('derives two local escorts for a customary retinue in a normal public combat scene', async () => {
    const state = makeBaseState();
    state.player.personalEscortEntitlement = {
      status: 'customary',
      bases: ['military_command'],
      updatedAt: state.currentDate,
    };
    const playerInput = '我以别部司马身份带着日常随身护卫走在新野官道上，护卫没有被遣散，也没有与我失散。'
      + '三名未入人物志的拦路匪徒突然从林边冲出，刀矛已经朝我和身边护卫刺来，第一击尚未判定命中。';
    const response = await runLiveTurn(state, playerInput);
    const summary = diagnosticSummary(response);
    const intent = response.writeback?.encounterStartIntent;

    expect(response.writeback?.encounterTransitionDecision?.mode, JSON.stringify(summary)).toBe('start');
    expect(intent?.kind, JSON.stringify(summary)).toBe('personal_combat');
    if (!intent || intent.kind !== 'personal_combat') return;
    expect(intent.escortAvailability, JSON.stringify(summary)).toBe('normal');
    expect(intent.playerParty.actorIds, JSON.stringify(summary)).toEqual(['player_liuping']);
    expect(intent.scopedCombatants?.every((combatant) => combatant.systemRole === undefined), JSON.stringify(summary)).toBe(true);

    const staged = stageCombatEncounter(
      appendCommittedTriggerTurn(state, playerInput, response.narrativeText),
      {
        saveId: 'save_real_api_customary_escorts',
        intent,
        projections: response.writeback?.semanticProjections ?? [],
        createdAt: '2026-07-31T12:00:00.000Z',
      },
    );
    const stagedIntent = staged.encounterV2?.active?.session.intent;
    if (stagedIntent?.kind !== 'personal_combat') throw new Error('personal combat not staged');
    expect(stagedIntent.playerParty.actorIds, JSON.stringify(summary)).toEqual([
      'player_liuping',
      `${intent.encounterId}:scoped:player_guard_1`,
      `${intent.encounterId}:scoped:player_guard_2`,
    ]);
    expect(stagedIntent.scopedCombatants?.filter((combatant) => (
      combatant.systemRole === 'temporary_escort'
    ))).toHaveLength(2);
  }, 300_000);

  it('keeps a customary retinue out when the combat scene is explicitly solo', async () => {
    const state = makeBaseState();
    state.player.personalEscortEntitlement = {
      status: 'customary',
      bases: ['military_command'],
      updatedAt: state.currentDate,
    };
    const playerInput = '我事先明确命令所有护卫留在城外营地，独自潜入一座废宅地窖；暗门落锁后，我与任何随从都已完全隔绝。'
      + '三名未入人物志的刺客从地窖阴影中同时扑出，兵刃已经朝我刺来，第一击尚未判定命中。';
    const response = await runLiveTurn(state, playerInput);
    const summary = diagnosticSummary(response);
    const intent = response.writeback?.encounterStartIntent;

    expect(response.writeback?.encounterTransitionDecision?.mode, JSON.stringify(summary)).toBe('start');
    expect(intent?.kind, JSON.stringify(summary)).toBe('personal_combat');
    if (!intent || intent.kind !== 'personal_combat') return;
    expect(intent.escortAvailability, JSON.stringify(summary)).toBe('explicitly_solo');
    const staged = stageCombatEncounter(
      appendCommittedTriggerTurn(state, playerInput, response.narrativeText),
      {
        saveId: 'save_real_api_explicitly_solo',
        intent,
        projections: response.writeback?.semanticProjections ?? [],
        createdAt: '2026-07-31T12:00:00.000Z',
      },
    );
    expect(staged.encounterV2?.active?.session.intent).toMatchObject({
      playerParty: { actorIds: ['player_liuping'] },
    });
  }, 300_000);

  it('starts a directly commanded war with stable troop IDs and participating officer projections', async () => {
    const state = makeWarState();
    const playerInput = '我正在新野城外亲自指挥荆州主力步兵营。西凉精锐骑兵已经发起冲锋，我立即下令全军列阵迎战，双方正式交锋。';
    const response = await runLiveTurn(
      state,
      playerInput,
    );
    const summary = diagnosticSummary(response);
    const intent = response.writeback?.encounterStartIntent;

    expect(intent, JSON.stringify(summary)).toBeTruthy();
    expect(response.writeback?.encounterTransitionDecision?.mode, JSON.stringify(summary)).toBe('start');
    expect(intent?.kind, JSON.stringify(summary)).toBe('war');
    if (!intent || intent.kind !== 'war') return;
    expect(intent.playerForce.troopIds).toEqual(['troop_player_infantry']);
    expect(intent.enemyForce.troopIds).toEqual(['troop_enemy_cavalry']);
    expect(collectPatchTypes(response)).not.toContain('upsertConflictRecord');
    expect(response.narrativeText).not.toMatch(/\[\[判定:battle:/);

    const projections = response.writeback?.semanticProjections ?? [];
    const sourceIds = new Set(projections.map((profile) => profile.sourceId));
    expect(sourceIds, JSON.stringify(summary)).toContain('troop_player_infantry');
    expect(sourceIds, JSON.stringify(summary)).toContain('troop_enemy_cavalry');
    expect(sourceIds, JSON.stringify(summary)).toContain('art_zhao_yun_dragon_formation');

    const staged = stageWarEncounter(
      appendCommittedTriggerTurn(state, playerInput, response.narrativeText),
      {
      saveId: 'save_real_api_war_matrix',
      intent,
      projections,
      createdAt: '2026-07-20T12:00:00.000Z',
      },
    );
    expect(staged.encounterV2?.active?.session.intent.encounterId).toBe(intent.encounterId);
    const prepared = prepareWarEncounterForPlay(staged, {
      startedAt: '2026-07-20T12:01:00.000Z',
    });
    expect(prepared.snapshot.officers?.player).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorId: 'npc_zhao_yun',
        role: 'deputy',
        uniqueArtLabels: {
          art_zhao_yun_dragon_formation: '龙胆破阵',
        },
        uniqueArtProfiles: expect.arrayContaining([
          expect.objectContaining({
            sourceId: 'art_zhao_yun_dragon_formation',
            status: 'executable',
          }),
        ]),
      }),
    ]));
  }, 300_000);

  it('atomically declares a map-only target and unregistered garrison before staging war', async () => {
    const state = makeMapOnlyWarState();
    const apiClient = makeWarReferenceRealApiClient();
    let result: Awaited<ReturnType<typeof executeTurn>>;
    try {
      result = await executeTurn(
        worldBook_ThreeKingdoms,
        state,
        '我亲率 troop_player_infantry 冲入新野县城内的敌方坞堡。守堡军已经列阵迎击，'
        + '双方已经短兵相接并正式发生不可回避的军队交锋；这不是准备、试探或未来意图。'
        + '请按现有 Encounter V2 协议在本回合输出 mode=start、kind=war、objective=capture_holding，'
        + '目标是占领 locationId=place_jingzhou_xinye 这座地图中已经存在、但尚未登记进领地账本的县城防御据点。'
        + '敌方守军也尚未登记：请在同一响应中先用完整 upsertTroopLedger 与 upsertHoldingLedger 声明它们，'
        + '再让战争意图引用这些稳定 ID；只登记交战前既有事实，不得提前写伤亡、胜负、控制权变化或冲突结果。',
        {
          apiConfig: makeApiConfig(),
          llmClient: apiClient.client,
          deferMemorySummaryCompression: true,
        },
      );
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n`
        + `真实 API 修复响应结构：${JSON.stringify(apiClient.getRealApiResponseDiagnostics())}`,
      );
    }
    const intent = result.encounterStartIntent;
    const summary = {
      transitionMode: result.encounterTransitionDecision?.mode ?? null,
      intentKind: intent?.kind ?? null,
      patchValidation: result.patchValidation,
      troopIds: result.newRuntimeState.troops?.map((troop) => troop.troopId) ?? [],
      holdingIds: result.newRuntimeState.holdings?.map((holding) => holding.holdingId) ?? [],
      debugNotes: result.writeback?.debugNotes ?? [],
      narrativeTail: result.narrativeText.slice(-240),
      realApiCallCount: apiClient.getRealApiCallCount(),
      deterministicMainCount: apiClient.getDeterministicMainCount(),
      deterministicTimeRepairCount: apiClient.getDeterministicTimeRepairCount(),
    };

    expect(apiClient.getRealApiCallCount(), JSON.stringify(summary)).toBeGreaterThanOrEqual(1);
    expect(apiClient.getDeterministicMainCount(), JSON.stringify(summary)).toBe(2);
    expect(apiClient.getDeterministicTimeRepairCount(), JSON.stringify(summary)).toBe(0);
    expect(result.encounterTransitionDecision?.mode, JSON.stringify(summary)).toBe('start');
    expect(intent?.kind, JSON.stringify(summary)).toBe('war');
    if (!intent || intent.kind !== 'war') return;
    expect(intent.objective, JSON.stringify(summary)).toBe('capture_holding');
    expect(intent.playerForce.troopIds, JSON.stringify(summary)).toEqual(['troop_player_infantry']);
    expect(intent.enemyForce.troopIds.length, JSON.stringify(summary)).toBeGreaterThan(0);
    expect(intent.enemyForce.troopIds.every((troopId) => (
      result.newRuntimeState.troops?.some((troop) => troop.troopId === troopId)
    )), JSON.stringify(summary)).toBe(true);
    expect(result.newRuntimeState.holdings?.some((holding) => (
      holding.holdingId === intent.targetHoldingId
    )), JSON.stringify(summary)).toBe(true);

    const staged = stageWarEncounter(result.newRuntimeState, {
      saveId: 'save_real_api_map_only_war',
      intent,
      projections: result.semanticProjections ?? [],
      createdAt: '2026-07-30T06:30:00.000Z',
    });
    expect(staged.encounterV2?.active?.session.intent.encounterId).toBe(intent.encounterId);
  }, 600_000);
});
