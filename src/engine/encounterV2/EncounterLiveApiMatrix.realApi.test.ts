import { describe, expect, it } from 'vitest';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState, StatePatch } from '../types';
import { parseNarratorResponse } from '../turn/NarratorResponseParser';
import { composePrompt } from '../turn/PromptComposer';
import { buildTurnMessages } from '../turn/TurnPromptMessages';
import { stageCombatEncounter } from './EncounterRuntimeIntegration';
import { stageWarEncounter } from './WarRuntimeIntegration';
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
    intentKind: response.writeback?.encounterStartIntent?.kind ?? null,
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

  it('starts a directly commanded war with stable troop IDs and both troop projections', async () => {
    const state = makeWarState();
    const playerInput = '我正在新野城外亲自指挥荆州主力步兵营。西凉精锐骑兵已经发起冲锋，我立即下令全军列阵迎战，双方正式交锋。';
    const response = await runLiveTurn(
      state,
      playerInput,
    );
    const summary = diagnosticSummary(response);
    const intent = response.writeback?.encounterStartIntent;

    expect(intent, JSON.stringify(summary)).toBeTruthy();
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
  }, 300_000);
});
