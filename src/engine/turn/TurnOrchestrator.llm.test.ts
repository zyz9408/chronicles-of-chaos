import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LlmEmptyContentError,
  type LlmEmbeddingRequest,
  type LlmGenerateRequest,
} from '../llm/LlmClient';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import type { RuntimeState, StatePatch, TurnProcessingStageEvent, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { executeTurn, prepareNpcComplianceAcceptedRuntimeState } from './TurnOrchestrator';
import { buildNpcPanelModel } from '../../ui/npcPanelModel';
import { TurnExecutionCancelledError } from './TurnExecutionContext';
import { TURN_LLM_BUDGET_DEFAULTS } from './TurnLlmBudget';
import type { NarratorNpcProfileSuggestion, NarratorWritebackProtocol } from './MockNarrator';
import { stageWarEncounter } from '../encounterV2/WarRuntimeIntegration';
import { makeWarTroop } from '../encounterV2/WarTestFixtures';
import type { WarStartIntent } from '../encounterV2/EncounterContracts';

const worldBook: WorldBook = {
  manifest: {
    id: 'test-chaos-world',
    name: '测试乱世',
    version: '0.1.0',
    author: 'test',
    language: 'zh-CN',
    genre: '乱世',
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
  lore: '',
  mapSeed: [
    {
      id: 'loc_market_town',
      name: '市镇',
      level: '聚落',
      summary: '道路交汇处的小市镇。',
      connectedRegionIds: [],
      controlHint: '未知',
      tensionHint: '不安',
    },
  ],
  factionsSeed: [],
  timelineAnchors: [],
  startBookmarks: [],
  openingCrisisTemplates: [],
  prompts: {
    narrativeBaseline: '保持乱世叙事。',
    forbiddenTopics: [],
    outputFormat: '必须输出 JSON。',
    toneGuide: '沉稳。',
  },
  validationRules: [],
};

const apiConfig: ApiConfigArchive = {
  id: 'api_main',
  name: '主剧情 API',
  provider: 'openai_compatible',
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const embeddingApiConfig: ApiConfigArchive = {
  ...apiConfig,
  id: 'api_embedding',
  name: '向量嵌入 API',
  model: 'text-embedding-test',
};

const npcSimulationApiConfig: ApiConfigArchive = {
  ...apiConfig,
  id: 'api_npc_simulation',
  name: 'NPC 动态模拟 API',
  model: 'fast-npc-model',
};

const REQUEST_TIMEOUT_WALL_CLOCK_TOLERANCE_MS = 1_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

function expectRequestTimeoutAtConfiguredCap(
  timeoutMs: number | undefined,
  configuredCapMs: number,
): void {
  expect(timeoutMs).toBeTypeOf('number');
  const actualTimeoutMs = timeoutMs ?? 0;
  expect(actualTimeoutMs).toBeGreaterThan(configuredCapMs - REQUEST_TIMEOUT_WALL_CLOCK_TOLERANCE_MS);
  expect(actualTimeoutMs).toBeLessThanOrEqual(configuredCapMs);
}

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-chaos-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '乱世元年2月',
    currentDate: '乱世元年2月',
    player: {
      id: 'player',
      name: '主角',
      roleType: '流民',
      summary: '流落市镇。',
      playerMemory: {
        summary: '主角仍在寻找立足之处。',
        keyDeeds: [],
        recentTurns: [],
      },
    },
    currentLocationId: 'loc_market_town',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    npcs: [
      {
        npcId: 'npc_gate_guard',
        name: '门候',
        sex: '男',
        age: 34,
        role: '守门军士',
        locationId: 'loc_market_town',
        isPresent: true,
        isFocused: false,
        summary: '守在市镇门前的军士。',
        appearance: '甲衣旧而整齐。',
        personality: '谨慎，重规矩。',
        motivation: '守住关口，避免惹祸。',
        relationToPlayer: '初识',
        contactLevel: 1,
        recentAttitude: '警惕',
        memories: [],
      },
      {
        npcId: 'npc_absent_scholar',
        name: '远行书生',
        sex: '男',
        age: 27,
        role: '书生',
        locationId: 'loc_market_town',
        isPresent: false,
        isFocused: false,
        summary: '暂不在场的书生。',
        appearance: '青衫布履。',
        personality: '好奇。',
        motivation: '寻找消息。',
        relationToPlayer: '听闻其名',
        contactLevel: 0,
        recentAttitude: '未知',
        memories: [],
      },
    ],
    locations: [
      {
        locationId: 'loc_market_town',
        name: '市镇',
        type: '聚落',
        summary: '道路交汇处的小市镇。',
        knownLevel: '亲历',
        recentEvents: [],
      },
    ],
  });
}

function makeDynamicWarState(): RuntimeState {
  const state = makeState();
  state.troops = [
    makeWarTroop('troop_player_vanguard', {
      name: '主角前锋营',
      size: 900,
      morale: 72,
      training: 68,
      quality: '高',
      readiness: '高',
      supplies: 70,
      factionId: 'faction_player',
      locationId: 'loc_market_town',
    }),
  ];
  return state;
}

function makeDynamicWarIntent(): WarStartIntent {
  return {
    contractVersion: 1,
    encounterId: 'war_market_fort_assault',
    kind: 'war',
    rulesetVersion: 'war-v2.0.0',
    sourceTurnNumber: 1,
    locationId: 'loc_market_town',
    reason: '前锋营已经冲入市镇坞堡，与守军正式交锋。',
    seed: 'war_seed_market_fort_assault',
    createdAt: '2026-07-30T06:00:00.000Z',
    policy: {
      lethality: 'standard',
      allowRetreat: true,
      allowSurrender: true,
      allowCapture: true,
      lootPolicy: 'none',
    },
    playerForce: {
      troopIds: ['troop_player_vanguard'],
      commanderActorId: 'player',
    },
    enemyForce: {
      troopIds: ['troop_market_fort_garrison'],
    },
    objective: 'capture_holding',
    targetHoldingId: 'holding_market_fort',
    environmentTags: ['fortified'],
  };
}

function makeDynamicWarDeclarationPatches(): StatePatch[] {
  return [
    {
      type: 'luanshiCommand',
      reason: '登记已经在坞堡门前实际参战的守军',
      payload: {
        command: {
          action: 'upsertTroopLedger',
          troopId: 'troop_market_fort_garrison',
          name: '市镇坞堡守军',
          size: 700,
          morale: 66,
          training: 58,
          supplies: 65,
          task: '守卫市镇坞堡',
          relationToPlayer: '敌对',
          factionId: 'faction_enemy',
          troopType: '步卒',
          quality: '中',
          fatigue: '低',
          readiness: '高',
          lifecycleStatus: 'active',
          knownLevel: '亲历',
          certainty: 'confirmed',
          locationId: 'loc_market_town',
          lastKnownLocationId: 'loc_market_town',
          lastKnownAt: '乱世元年2月',
          updatedAt: '乱世元年2月',
        },
      },
    },
    {
      type: 'luanshiCommand',
      reason: '登记已经与玩家形成直接争夺关系的坞堡',
      payload: {
        command: {
          action: 'upsertHoldingLedger',
          operation: 'create',
          holdingId: 'holding_market_fort',
          name: '市镇坞堡',
          type: 'fort',
          status: 'contested',
          summary: '玩家前锋营正在强攻的市镇防御坞堡。',
          controlEvidence: {
            kind: 'war_target',
            occurredAt: '乱世元年2月',
            sourceRefId: 'war_dynamic_gate',
            summary: '坞堡已成为双方正在直接争夺的本场战争目标。',
          },
          civilAdministrationScope: 'none',
          scaleLevel: 1,
          agriculture: 0,
          commerce: 0,
          population: 0,
          publicOrder: 0,
          popularSupport: 0,
          defense: 70,
          recruitPotential: 0,
          armory: 55,
          horseSupply: 10,
          locationId: 'loc_market_town',
          factionId: 'faction_enemy',
          actualController: '市镇守军',
          garrisonTroopIds: ['troop_market_fort_garrison'],
          recentChanges: ['玩家前锋营已经冲入外门，争夺正式开始。'],
          updatedAt: '乱世元年2月',
        },
      },
    },
  ];
}

function makeComplianceNpcProfile(): NarratorNpcProfileSuggestion {
  return {
    npcId: 'npc_gu_heng_compliance',
    name: '顾衡',
    persistenceReason: 'active_system_role',
    persistenceEvidence: '本回合确认顾衡长期担任市镇守军校尉并持续处置营门军务。',
    sex: '男',
    age: 31,
    role: '军中校尉',
    locationId: 'loc_market_town',
    isPresent: true,
    isFocused: true,
    currentIdentity: '市镇守军校尉',
    summary: '奉命到场处置营门事务的校尉。',
    appearance: '披甲佩刀，神情沉静。',
    personality: '谨慎果断。',
    motivation: '维持营门秩序。',
    relationToPlayer: '初次共事',
    contactLevel: 5,
    recentAttitude: '审慎',
    abilityScores: { 武力: 65, 统率: 70, 智力: 58, 政治: 45, 魅力: 48, 机运: 50 },
    traits: [{ id: 'trait_camp_officer', label: '营门校尉', description: '熟悉营门军务。', source: 'identity' }],
    uniqueArts: [{
      id: 'art_camp_command',
      name: '营门节制',
      rarity: 'blue',
      domain: 'warfare',
      level: 2,
      description: '熟悉营门轮值、警戒与小队调度。',
      effectSummary: '在营防与小规模统率场景中提供稳定能力锚点。',
      source: 'identity',
      acquisition: {
        kind: 'background',
        occurredAt: '乱世元年2月',
        sourceRefId: 'npc-profile:npc_gu_heng_compliance:background',
        summary: '长期担任营门校尉的身份与经历已经确立该能力。',
      },
    }],
  };
}

function makeRejectedWangJingProfile(npcId: string): NarratorNpcProfileSuggestion {
  return {
    npcId,
    name: '王经',
    persistenceReason: 'strategic_actor',
    persistenceEvidence: '本回合确认王经以曹魏前线将领身份持续调动部曲并向玩家军营施压。',
    sex: '男',
    age: 0,
    role: '魏军将领',
    factionName: '曹魏',
    locationId: 'loc_market_town',
    isPresent: false,
    isFocused: true,
    currentIdentity: '曹魏方面的前线将领',
    summary: '王经以使者和部曲压迫军营，是当前局势中的长期战略人物。',
    appearance: '未直接照面，只知其军府威严。',
    personality: '谨慎而强硬。',
    motivation: '压迫军营，掌握主动。',
    relationToPlayer: '敌对远场将领',
    contactLevel: 1,
    recentAttitude: '试探施压',
    abilityScores: { 武力: 66, 统率: 74, 智力: 62, 政治: 55, 魅力: 52, 机运: 50 },
    traits: [{ id: 'trait_wang_jing_pressure', label: '持重施压', description: '习惯以军势逼迫对手。', source: 'identity' }],
  };
}

function makeComplianceTurnResponse(statePatches: StatePatch[]) {
  return {
    protocolVersion: 'lsfy.turn.v1',
    narrativeText: '【顾衡】营门事务已经处置完毕。',
    suggestedActions: [],
    statePatches,
    statePatch: null,
    writeback: {
      npcProfileSuggestions: [makeComplianceNpcProfile()],
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      debugNotes: [],
    },
  };
}

function makeComplianceRepairClient() {
  return {
    generate: vi.fn(async () => ({
      content: JSON.stringify(makeComplianceTurnResponse([])),
      provider: 'openai_compatible' as const,
      model: 'npc-completion-model',
    })),
  };
}

describe('executeTurn LLM integration', () => {
  it('lets the main narrator resolve a zero-hp attempt and preserves vitals when no recovery completed', async () => {
    const state = makeState();
    state.player.vitals = { hp: 0, maxHp: 100, stamina: 80, maxStamina: 100 };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '你试图起身赶路，伤势却让双腿无法支撑，只能重新伏在榻上；这次尝试没有形成实际行程，也没有完成休整。',
          suggestedActions: [],
          statePatches: [{
            type: 'timeAdvance',
            payload: { minutesAdvanced: 10, reason: '尝试起身但未能成行', category: 'other' },
            reason: '无效行动仍经过少量时间',
          }],
          statePatch: null,
          writeback: {
            playerRecoveryKind: 'none',
            encounterTransitionDecision: { mode: 'none', reason: '没有发生战斗边界' },
            encounterStartIntent: null,
            npcMemorySuggestions: [],
            locationWriteSuggestions: [],
            routeWriteSuggestions: [],
            questChanges: [],
            debugNotes: [],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, state, '我继续赶路', {
      apiConfig,
      llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalled();
    expect(result.newRuntimeState.player.vitals).toMatchObject({ hp: 0, stamina: 80 });
    expect(
      result.newRuntimeState.turnLog[result.newRuntimeState.turnLog.length - 1]?.statePatchSummary,
    ).toContain('生命为 0');
  });

  it('calls the configured LLM client for main narrative turns', async () => {
    const controller = new AbortController();
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'AI真正生成的正文。\n[[判定:check_observe]]\n你看清了街面的异常。',
          suggestedActions: [{ label: '继续观察', description: '留意街面变化', actionType: 'explore' }],
          ordinaryChecks: [{
            checkId: 'check_observe',
            label: '观察街面',
            total: 60,
            difficulty: 50,
            result: '成功',
            summary: '你看清了街面的异常。',
          }],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '观察街面', category: 'observation' },
              reason: '观察周围花费了一刻钟',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), '我观察周围', {
      apiConfig,
      llmClient,
      signal: controller.signal,
    });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    const generateCalls = llmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    expect(generateCalls[0][0]).toMatchObject({
      config: apiConfig,
      responseFormat: 'json_object',
      signal: controller.signal,
      timeoutMs: TURN_LLM_BUDGET_DEFAULTS.mainNarrativeRequestMs,
    });
    const sentMessages = generateCalls[0][0].messages
      .map((message) => message.content)
      .join('\n');
    expect(sentMessages).toContain('protocolVersion');
    expect(sentMessages).toContain('lsfy.turn.v1');
    expect(sentMessages).toContain('turnSummary');
    expect(sentMessages).toContain('plotPlanSuggestions');
    expect(sentMessages).toContain('## 正文篇幅提交前检查');
    expect(sentMessages).toContain('narrativeText 仍必须不少于 600 个非空白字符');
    expect(sentMessages.indexOf('## 正文篇幅提交前检查'))
      .toBeGreaterThan(sentMessages.indexOf('## 正文提交前静默终检'));
    expect(result.generationMode).toBe('llm');
    expect(result.runtimeTokenEstimate.total.estimatedTokens).toBe(result.promptEstimatedTokens);
    expect(result.runtimeTokenEstimate.layers.map((layer) => layer.id)).toContain('stateWriterContext');
    expect(result.turnDisplayMeta.promptTokenEstimate?.contextBreakdown.map((layer) => layer.id)).toContain('situationProjection');
    expect(result.newRuntimeState.turnLog[0].displayMeta?.promptTokenEstimate?.layers.map((layer) => layer.id)).toContain('userPrompt');
    expect(result.narrativeText).toContain('AI真正生成的正文。');
    expect(result.suggestedActions[0].label).toBe('继续观察');
    expect(result.newRuntimeState.turnLog[0].narrativeText).toContain('AI真正生成');
    expect(result.turnDisplayMeta.narrativeLength).toMatchObject({
      preference: 'standard',
      minimumCharacters: 600,
      status: 'under_minimum',
      meetsMinimum: false,
    });
    expect(result.newRuntimeState.turnLog[0].displayMeta?.narrativeLength)
      .toEqual(result.turnDisplayMeta.narrativeLength);
    expect(result.newRuntimeState.player).toMatchObject({ level: 1, xp: 12, growthPoints: 0 });
    expect(result.turnDisplayMeta.judgementCards?.[0]).toMatchObject({
      cardId: 'ordinary:check_observe',
      experienceAward: 12,
    });
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('获得阅历 12');
    expect((result.newRuntimeState.turnLog[0] as typeof result.newRuntimeState.turnLog[0] & {
      suggestedActions?: Array<{ label: string; description: string; actionType: string }>;
    }).suggestedActions).toEqual(result.suggestedActions);
  });

  it('keeps only one writeback schema in the final main LLM user message', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'AI真正生成的正文。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '观察街面', category: 'observation' },
              reason: '观察周围花费了一刻钟',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    await executeTurn(worldBook, makeState(), '我观察周围', { apiConfig, llmClient });

    const generateCalls = llmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    const userMessage = generateCalls[0][0].messages.find((message) => message.role === 'user')?.content ?? '';
    const writebackSchemaMarkers = userMessage.match(/writeback 结构/g) ?? [];

    expect(userMessage).toContain('## 状态写入上下文');
    expect(userMessage).toContain('## 状态补丁协议');
    expect(writebackSchemaMarkers).toHaveLength(1);
    expect(userMessage).not.toContain('????');
  });

  it('injects vector-retrieved memories into the main narrative prompt when an embedding API is configured', async () => {
    const controller = new AbortController();
    const state = makeState();
    state.npcs = (state.npcs ?? []).map((npc) =>
      npc.npcId === 'npc_absent_scholar'
        ? {
            ...npc,
            memories: [
              {
                memoryId: 'mem_vector_only',
                source: '听闻',
                content: 'VECTOR_TURN_RETRIEVAL_SENTINEL: the hidden oath still shapes the next choice.',
                createdAt: 'day 10',
              },
            ],
          }
        : npc,
    );
    const embeddingClient = {
      embed: vi.fn(async (request: LlmEmbeddingRequest) => ({
        embeddings: request.input.map((text) => {
          const normalized = text.toLowerCase();
          if (normalized.includes('vector_turn_retrieval_sentinel') || normalized.includes('disguised falcon')) {
            return [1, 0, 0];
          }
          return [0, 1, 0];
        }),
        provider: 'openai_compatible' as const,
        model: request.config.model,
      })),
    };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'AI真正生成的正文。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '向量检索测试', category: 'test' },
              reason: '测试回合自然推进时间',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, state, 'disguised falcon thread', {
      apiConfig,
      embeddingApiConfig,
      llmClient,
      embeddingClient,
      signal: controller.signal,
    });

    const generateCalls = llmClient.generate.mock.calls as unknown as Array<[{ messages: Array<{ content: string }> }]>;
    const sentMessages = generateCalls[0][0].messages
      .map((message) => message.content)
      .join('\n');
    expect(embeddingClient.embed).toHaveBeenCalledTimes(2);
    const embeddingCalls = embeddingClient.embed.mock.calls as unknown as Array<[LlmEmbeddingRequest]>;
    expect(embeddingCalls[0][0].signal).toBe(controller.signal);
    expectRequestTimeoutAtConfiguredCap(
      embeddingCalls[0][0].timeoutMs,
      TURN_LLM_BUDGET_DEFAULTS.singleAuxiliaryRequestMs,
    );
    expect(embeddingCalls[1][0].signal).toBe(controller.signal);
    expectRequestTimeoutAtConfiguredCap(
      embeddingCalls[1][0].timeoutMs,
      TURN_LLM_BUDGET_DEFAULTS.singleAuxiliaryRequestMs,
    );
    expect(result.memoryVectorRetrieval?.refresh).toMatchObject({
      status: 'refreshed',
    });
    expect(result.memoryVectorRetrieval?.refresh.index?.items.map((item) => item.indexId))
      .toContain('npcMemory:mem_vector_only');
    expect(result.memoryVectorRetrieval?.refresh.index?.items.find((item) => item.indexId === 'npcMemory:mem_vector_only')?.embedding)
      .toEqual([1, 0, 0]);
    expect(result.memoryVectorRetrieval?.retrievedMemories.map((memory) => `${memory.retrievalMode}:${memory.sourceId}`))
      .toContain('vector:mem_vector_only');
    expect(result.memoryVectorRetrieval?.status).toBe('vector');
    expect(sentMessages).toContain('VECTOR_TURN_RETRIEVAL_SENTINEL');
    expect(result.memoryContextPackage.retrievedMemories.map((memory) => `${memory.retrievalMode}:${memory.sourceId}`))
      .toContain('vector:mem_vector_only');
    expect(result.memoryContextPackage.budget.layerTokenEstimates.retrievedMemories).toBeGreaterThan(0);
    expect([
      ...(result.turnDisplayMeta.memoryRecall?.strong ?? []),
      ...(result.turnDisplayMeta.memoryRecall?.weak ?? []),
    ].map((memory) => memory.sourceId)).toContain('mem_vector_only');
    expect(result.newRuntimeState.turnLog[result.newRuntimeState.turnLog.length - 1]?.displayMeta?.memoryRecall)
      .toEqual(result.turnDisplayMeta.memoryRecall);
  });

  it('runs NPC dynamic simulation once and injects the advisory intent package into the main prompt', async () => {
    const controller = new AbortController();
    const npcSimulationLlmClient = {
      generate: vi.fn(async (request: LlmGenerateRequest) => {
        const promptText = request.messages.map((message) => message.content).join('\n');
        expect(promptText).toContain('未裁定 NPC 意图建议');
        expect(promptText).toContain('npc_gate_guard');
        expect(promptText).not.toContain('npc_absent_scholar');
        return {
          content: JSON.stringify({
            protocolVersion: 'coc.v2.npcIntent.v1',
            intents: [
              {
                npcId: 'npc_gate_guard',
                npcName: '门候',
                shouldAct: true,
                intent: '门候抬手拦住主角，要求说明来意。',
                trigger: '看见主角靠近城门时触发',
                perceptionBasis: '门候在场，能看见主角动作。',
                relationshipBasis: '初识且职责要求盘问。',
                emotionalState: '谨慎警惕',
                confidence: 0.82,
              },
            ],
          }),
          provider: 'openai_compatible' as const,
          model: 'fast-npc-model',
        };
      }),
    };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'AI真正生成的正文。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: 'NPC 动态模拟测试', category: 'test' },
              reason: '测试回合自然推进时间',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), '我靠近城门，试探门候', {
      apiConfig,
      npcSimulationApiConfig,
      llmClient,
      npcSimulationLlmClient,
      signal: controller.signal,
    });

    expect(npcSimulationLlmClient.generate).toHaveBeenCalledOnce();
    expect(llmClient.generate).toHaveBeenCalledOnce();
    const npcSimulationCalls = npcSimulationLlmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    expect(npcSimulationCalls[0][0].signal).toBe(controller.signal);
    expectRequestTimeoutAtConfiguredCap(
      npcSimulationCalls[0][0].timeoutMs,
      TURN_LLM_BUDGET_DEFAULTS.singleAuxiliaryRequestMs,
    );
    const mainGenerateCalls = llmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    const sentMessages = mainGenerateCalls[0][0].messages
      .map((message) => message.content)
      .join('\n');
    expect(sentMessages).toContain('未裁定 NPC 意图建议');
    expect(sentMessages).toContain('门候抬手拦住主角');
    expect(sentMessages).toContain('这不是已发生事实');
    expect(result.npcIntentSimulation?.status).toBe('completed');
    expect(result.npcIntentSimulation?.package?.intents[0].npcId).toBe('npc_gate_guard');
    expect(result.turnDisplayMeta.npcIntentSimulation).toMatchObject({
      status: 'completed',
      targetNpcIds: ['npc_gate_guard'],
      provider: 'openai_compatible',
      model: 'fast-npc-model',
    });
    expect(result.newRuntimeState.turnLog[0].displayMeta?.npcIntentSimulation?.package?.intents[0]).toMatchObject({
      npcId: 'npc_gate_guard',
      intent: '门候抬手拦住主角，要求说明来意。',
    });
  });

  it('uses the local mock narrator only when no API config is available', async () => {
    const result = await executeTurn(worldBook, makeState(), '我观察周围');

    expect(result.generationMode).toBe('mock');
    expect(result.narrativeText.length).toBeGreaterThan(0);
    expect(result.newRuntimeState.turnLog).toHaveLength(1);
  });

  it('charges a mock purchase against normal opening personalMoney without creating a resource shadow balance', async () => {
    const state = {
      ...makeState(),
      player: {
        ...makeState().player,
        personalMoney: 100,
      },
      worldStateDelta: {
        ...makeState().worldStateDelta,
        openingPersonalMoney: 100,
      },
      turnLog: [],
    };

    const result = await executeTurn(worldBook, state, '我在市集购买物资');

    expect(result.generationMode).toBe('mock');
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.statePatches).toEqual([
      expect.objectContaining({
        type: 'luanshiCommand',
        payload: {
          command: expect.objectContaining({
            action: 'updatePlayerLoadout',
            characterId: 'player',
            personalMoneyDelta: -50,
          }),
        },
      }),
    ]);
    expect(result.newRuntimeState.player.personalMoney).toBe(50);
    expect(result.newRuntimeState.worldStateDelta.openingPersonalMoney).toBe(100);
    expect(result.newRuntimeState.playerResources).not.toHaveProperty('钱财');
    expect(result.newRuntimeState.lastStatePatch?.type).toBe('luanshiCommand');
    expect(result.newRuntimeState.turnLog).toHaveLength(1);
  });

  it('keeps the full generated narrative in the turn log for raw review and reload', async () => {
    const longNarrative = `OPENING-${'long narrative text '.repeat(40)}`;
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: longNarrative,
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '开局叙事推进', category: 'opening' },
              reason: '开局叙事自然推进了一刻钟',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), 'opening test', { apiConfig, llmClient });
    const logEntry = result.newRuntimeState.turnLog[0] as { narrativeText: string; fullNarrativeText?: string };

    expect(logEntry.fullNarrativeText).toBe(longNarrative);
    expect(logEntry.narrativeText.length).toBeLessThan(longNarrative.length);
  });

  it('forwards streaming deltas to the configured LLM client', async () => {
    const onContentDelta = vi.fn();
    const llmClient = {
      generate: vi.fn(async (request) => {
        request.onContentDelta?.('streamed chunk');
        return {
          content: JSON.stringify({
            narrativeText: 'final text',
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 15, reason: 'streaming test', category: 'test' },
                reason: 'streaming test time advance',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        };
      }),
    };

    await executeTurn(worldBook, makeState(), 'streaming test', { apiConfig, llmClient, onContentDelta });

    expect(onContentDelta).toHaveBeenCalledWith('streamed chunk');
  });

  it('discards an under-length rich response and regenerates one complete response before writeback', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === 'coc_v2_narrative_length' ? 'rich' : null,
      setItem: () => undefined,
    });
    const firstNarrative = '短'.repeat(800);
    const regeneratedNarrative = '长'.repeat(1200);
    const buildResponse = (narrativeText: string) => JSON.stringify({
      narrativeText,
      suggestedActions: [],
      statePatches: [{
        type: 'timeAdvance',
        payload: { minutesAdvanced: 15, reason: '篇幅重生成测试', category: 'test' },
        reason: '测试回合自然推进时间',
      }],
      statePatch: null,
    });
    const onContentDelta = vi.fn();
    const onContentReset = vi.fn();
    const llmClient = {
      generate: vi.fn()
        .mockImplementationOnce(async (request: LlmGenerateRequest) => {
          request.onContentDelta?.('FIRST_STREAM_SENTINEL');
          return {
            content: buildResponse(firstNarrative),
            provider: 'openai_compatible' as const,
            model: 'test-model',
            usage: {
              promptTokens: 100,
              completionTokens: 80,
              totalTokens: 180,
              cacheReadTokens: 70,
              cacheMissTokens: 30,
            },
          };
        })
        .mockImplementationOnce(async (request: LlmGenerateRequest) => {
          request.onContentDelta?.('SECOND_STREAM_SENTINEL');
          return {
            content: buildResponse(regeneratedNarrative),
            provider: 'openai_compatible' as const,
            model: 'test-model',
            usage: {
              promptTokens: 110,
              completionTokens: 120,
              totalTokens: 230,
              cacheReadTokens: 90,
              cacheMissTokens: 20,
            },
          };
        }),
    };

    const result = await executeTurn(worldBook, makeState(), '我与杜平详谈粮簿', {
      apiConfig,
      llmClient,
      onContentDelta,
      onContentReset,
    });

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(onContentDelta.mock.calls).toEqual([
      ['FIRST_STREAM_SENTINEL'],
      ['SECOND_STREAM_SENTINEL'],
    ]);
    expect(onContentReset).toHaveBeenCalledOnce();
    const generateCalls = llmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    const regenerationPrompt = generateCalls[1][0].messages
      .map((message) => message.content)
      .join('\n');
    expect(regenerationPrompt).toContain('正文篇幅不合格：整份响应重生成');
    expect(regenerationPrompt).toContain('上一份候选的 narrativeText 只有 800 个非空白字符');
    expect(regenerationPrompt).toContain('正文和写回均未生效');
    expect(regenerationPrompt).not.toContain(firstNarrative);
    expect(result.narrativeText).toBe(regeneratedNarrative);
    expect(result.newRuntimeState.currentDate).toBe('公元1年01月01日 08:15（辰时）');
    expect(result.turnDisplayMeta.narrativeLength).toMatchObject({
      preference: 'rich',
      actualCharacters: 1200,
      meetsMinimum: true,
      regenerationAttempted: true,
      firstAttemptCharacters: 800,
      regenerationResolved: true,
    });
    expect(result.turnDisplayMeta.processingStages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'generatingNarrative',
        status: 'finished',
        usage: expect.objectContaining({ cacheReadTokens: 70, cacheMissTokens: 30 }),
      }),
      expect.objectContaining({
        stage: 'regeneratingNarrative',
        status: 'finished',
        usage: expect.objectContaining({ cacheReadTokens: 90, cacheMissTokens: 20 }),
      }),
    ]));
    expect(result.turnDisplayMeta.promptTokens).toBe(210);
    expect(result.turnDisplayMeta.completionTokens).toBe(200);
    expect(result.turnDisplayMeta.totalTokens).toBe(410);
    expect(result.turnDisplayMeta.rawResponse).not.toContain(firstNarrative);
  });

  it.each([
    { label: 'retry disabled', retryValue: '0', characters: 800, withinRetryTolerance: false },
    { label: 'within 10% tolerance', retryValue: null, characters: 950, withinRetryTolerance: true },
  ])('keeps the first response when $label while preserving the rich target', async ({
    retryValue,
    characters,
    withinRetryTolerance,
  }) => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => {
        if (key === 'coc_v2_narrative_length') return 'rich';
        if (key === 'coc_v2_narrative_length_retry_enabled') return retryValue;
        return null;
      },
      setItem: () => undefined,
    });
    const narrativeText = '容'.repeat(characters);
    const llmClient = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          narrativeText,
          suggestedActions: [],
          statePatches: [{
            type: 'timeAdvance',
            payload: { minutesAdvanced: 15, reason: '篇幅宽容测试', category: 'test' },
            reason: '测试回合自然推进时间',
          }],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      }),
    };

    const result = await executeTurn(worldBook, makeState(), '我与杜平继续核对粮簿', {
      apiConfig,
      llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(result.narrativeText).toBe(narrativeText);
    expect(result.turnDisplayMeta.narrativeLength).toMatchObject({
      preference: 'rich',
      minimumCharacters: 1000,
      retryMinimumCharacters: 900,
      actualCharacters: characters,
      meetsMinimum: false,
      withinRetryTolerance,
      retryEnabled: retryValue !== '0',
    });
    expect(result.turnDisplayMeta.narrativeLength?.regenerationAttempted).toBeUndefined();
  });

  it('rejects the turn before state writeback when rich regeneration is still under length', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === 'coc_v2_narrative_length' ? 'rich' : null,
      setItem: () => undefined,
    });
    const buildResponse = (narrativeText: string) => JSON.stringify({
      narrativeText,
      suggestedActions: [],
      statePatches: [{
        type: 'timeAdvance',
        payload: { minutesAdvanced: 15, reason: '篇幅拒绝测试', category: 'test' },
        reason: '测试回合自然推进时间',
      }],
      statePatch: null,
    });
    const onContentReset = vi.fn();
    const llmClient = {
      generate: vi.fn()
        .mockResolvedValueOnce({
          content: buildResponse('短'.repeat(800)),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: buildResponse('仍'.repeat(850)),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        }),
    };

    await expect(executeTurn(worldBook, makeState(), '我与杜平详谈粮簿', {
      apiConfig,
      llmClient,
      onContentReset,
    })).rejects.toThrow(/连续两次低于“丰富”档重写阈值.*本回合未写入/);

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(onContentReset).toHaveBeenCalledOnce();
  });

  it('repairs LLM responses that omit the required timeAdvance patch', async () => {
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '你与守门军士交谈，等了片刻才得到回应。',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '你与守门军士交谈，等了片刻才得到回应。',
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 15, reason: '与守门军士交谈等待', category: 'conversation' },
                reason: '玩家交谈与等待消耗时间',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        }),
    };
    const state = {
      ...makeState(),
      startDate: '公元189年09月01日 08:00（辰时）',
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: {
        year: 189,
        month: 9,
        day: 1,
        hour: 8,
        minute: 0,
      },
    };

    const result = await executeTurn(worldBook, state, '我向守门军士打听城中动静', { apiConfig, llmClient });

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    const repairRequest = llmClient.generate.mock.calls[1]?.[0] as LlmGenerateRequest;
    expectRequestTimeoutAtConfiguredCap(
      repairRequest.timeoutMs,
      TURN_LLM_BUDGET_DEFAULTS.singleAuxiliaryRequestMs,
    );
    expect(JSON.stringify(repairRequest.messages)).toContain('timeAdvance');
    expect(JSON.stringify(repairRequest.messages)).toContain('保留 narrativeText');
    expect(JSON.stringify(repairRequest.messages)).toContain('长期训练、屯田、养伤、潜伏、赶造或等待');
    expect(JSON.stringify(repairRequest.messages)).toContain('数十日至一年以内');
    expect(JSON.stringify(repairRequest.messages)).toContain('每月 30 天、每年 12 个月');
    expect(result.newRuntimeState.currentDate).toBe('公元189年09月01日 08:15（辰时）');
    expect(result.newRuntimeState.currentTime).toEqual({
      year: 189,
      month: 9,
      day: 1,
      hour: 8,
      minute: 15,
    });
    expect(result.newRuntimeState.turnLog[0].date).toBe('公元189年09月01日 08:15（辰时）');
    expect(result.turnDisplayMeta.promptTokens).toBe(130);
    expect(result.turnDisplayMeta.completionTokens).toBe(70);
    expect(result.turnDisplayMeta.totalTokens).toBe(200);
  });

  it('repairs an out-of-range timeAdvance before patch validation', async () => {
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '你依照既定章程处理整月事务，并在下月朔日核对军需账册。',
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 43200, reason: '处理整月事务', category: 'monthly-runtime' },
                reason: '推进至下月朔日',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '你依照既定章程处理整月事务，并在下月朔日核对军需账册。',
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { daysAdvanced: 30, reason: '处理整月事务', category: 'monthly-runtime' },
                reason: '推进至下月朔日',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        }),
    };
    const state = {
      ...makeState(),
      startDate: '公元189年09月01日 08:00（辰时）',
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: {
        year: 189,
        month: 9,
        day: 1,
        hour: 8,
        minute: 0,
      },
    };

    const result = await executeTurn(worldBook, state, '处理事务直到下月第一日清晨', { apiConfig, llmClient });

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    const repairRequest = llmClient.generate.mock.calls[1]?.[0] as LlmGenerateRequest;
    expect(JSON.stringify(repairRequest.messages)).toContain('minutesAdvanced 1-4320');
    expect(JSON.stringify(repairRequest.messages)).toContain('daysAdvanced 1-365');
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.statePatches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'timeAdvance',
        payload: expect.objectContaining({ daysAdvanced: 30 }),
      }),
    ]));
    expect(result.newRuntimeState.currentDate).toBe('公元189年10月01日 08:00（辰时）');
  });

  it('retries one empty focused time repair response without replacing the streamed narrative', async () => {
    const mainNarrative = '你与守门军士交谈，等了片刻才得到回应。';
    const onContentDelta = vi.fn();
    const llmClient = {
      generate: vi
        .fn()
        .mockImplementationOnce(async (request: LlmGenerateRequest) => {
          request.onContentDelta?.(mainNarrative);
          return {
            content: JSON.stringify({
              narrativeText: mainNarrative,
              suggestedActions: [],
              statePatches: [],
              statePatch: null,
            }),
            provider: 'openai_compatible' as const,
            model: 'test-model',
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          };
        })
        .mockRejectedValueOnce(new LlmEmptyContentError(
          'API 返回缺少正文内容',
          { promptTokens: 20, completionTokens: 0, totalTokens: 20 },
        ))
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '这段修复正文不应覆盖已流式显示的主叙事。',
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 15, reason: '与守门军士交谈等待', category: 'conversation' },
                reason: '玩家交谈与等待消耗时间',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 30, completionTokens: 10, totalTokens: 40 },
        }),
    };

    const result = await executeTurn(worldBook, makeState(), '我向守门军士打听城中动静', {
      apiConfig,
      llmClient,
      onContentDelta,
    });

    expect(onContentDelta).toHaveBeenCalledTimes(1);
    expect(onContentDelta.mock.calls).toEqual([[mainNarrative]]);
    expect(llmClient.generate).toHaveBeenCalledTimes(3);
    const generateCalls = llmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    expect(generateCalls[0][0].onContentDelta).toBe(onContentDelta);
    expect(generateCalls[1][0].onContentDelta).toBeUndefined();
    expect(generateCalls[2][0].onContentDelta).toBeUndefined();
    expect(result.narrativeText).toBe(mainNarrative);
    expect(result.newRuntimeState.currentDate).toBe('公元1年01月01日 08:15（辰时）');
    expect(result.turnDisplayMeta.promptTokens).toBe(150);
    expect(result.turnDisplayMeta.completionTokens).toBe(60);
    expect(result.turnDisplayMeta.totalTokens).toBe(210);
  });

  it('fails with focused time repair context after two empty responses', async () => {
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '主叙事已经生成，但缺少时间推进。',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockRejectedValueOnce(new LlmEmptyContentError('API 返回缺少正文内容'))
        .mockRejectedValueOnce(new LlmEmptyContentError('API 返回缺少正文内容')),
    };

    const rejection = await executeTurn(worldBook, makeState(), '我继续等待', {
      apiConfig,
      llmClient,
    }).then(() => null, (error) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain('时间推进结构化修复连续两次返回空内容');
    expect((rejection as Error).message).not.toContain('缺少正文内容');
    expect(llmClient.generate).toHaveBeenCalledTimes(3);
  });

  it('does not retry a focused time repair response with valid JSON but no valid timeAdvance', async () => {
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '主叙事缺少时间推进。',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '修复响应仍未提供时间推进。',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '不应发起第三次调用。',
            suggestedActions: [],
            statePatches: [{
              type: 'timeAdvance',
              payload: { minutesAdvanced: 10, reason: '备用', category: 'waiting' },
              reason: '不应使用的修复',
            }],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        }),
    };

    await expect(executeTurn(worldBook, makeState(), '我继续等待', {
      apiConfig,
      llmClient,
    })).rejects.toThrow('模型返回缺少有效 timeAdvance，且结构化修复失败');

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
  });

  it('does not retry an untyped error that reuses the empty-content message', async () => {
    const untypedError = new Error('API 返回缺少正文内容');
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '主叙事缺少时间推进。',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockRejectedValueOnce(untypedError)
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '不应使用第三次调用。',
            suggestedActions: [],
            statePatches: [{
              type: 'timeAdvance',
              payload: { minutesAdvanced: 10, reason: '备用', category: 'waiting' },
              reason: '不应使用的修复',
            }],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        }),
    };

    const rejection = await executeTurn(worldBook, makeState(), '我继续等待', {
      apiConfig,
      llmClient,
    }).then(() => null, (error) => error);

    expect(rejection).toBe(untypedError);
    expect(llmClient.generate).toHaveBeenCalledTimes(2);
  });

  it('lets the dedicated state writeback API recover a missing timeAdvance before focused repair', async () => {
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_state_writeback_time_repair',
      name: '状态写回 API',
      model: 'deepseek-v4-flash',
    };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '你与守门军士交谈，等了片刻才得到回应。',
          suggestedActions: [],
          statePatches: [],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async (request: LlmGenerateRequest) => {
        expect(request.config.id).toBe(stateWritebackApiConfig.id);
        expect(request.messages).toHaveLength(2);
        const [systemMessage, runtimeUserMessage] = request.messages;
        expect(systemMessage?.role).toBe('system');
        expect(systemMessage?.content).not.toContain('## 稳定状态写回规则');
        expect(systemMessage?.content).not.toContain('allowedLuanShiCommands:');
        expect(systemMessage?.content).toContain('不得重写 narrativeText');
        expect(runtimeUserMessage?.role).toBe('user');
        expect(runtimeUserMessage?.content).toContain('## 状态写入上下文');
        expect(runtimeUserMessage?.content).not.toContain('## 状态写入上下文（本回合运行态）');
        expect(runtimeUserMessage?.content).toContain('公元189年09月01日 08:00（辰时）');
        expect(runtimeUserMessage?.content).not.toContain('## 稳定状态写回规则');
        expect(runtimeUserMessage?.content).toContain('allowedLuanShiCommands:');
        const promptText = request.messages.map((message) => message.content).join('\n');
        expect(promptText).toContain('状态写回整理器');
        expect(promptText).toContain('timeAdvance');
        expect(promptText).toContain('knownLevel 表示证据来源层级');
        expect(promptText).toContain('失联通常只降低 certainty');
        expect(promptText).toContain('推测+confirmed 不得组合');
        return {
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '这段正文不应覆盖主叙事。',
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 15, reason: '与守门军士交谈等待', category: 'conversation' },
                reason: '玩家交谈与等待消耗时间',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'writeback-model',
          usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        };
      }),
    };
    const state = {
      ...makeState(),
      startDate: '公元189年09月01日 08:00（辰时）',
      currentDate: '公元189年09月01日 08:00（辰时）',
      player: {
        ...makeState().player,
        personalMoney: 235,
        inventory: [{
          id: 'item_iron_bank_credential',
          name: '铁金库凭证',
          quantity: 1,
          category: 'document',
          keyItem: true,
        }],
      },
      currentTime: {
        year: 189,
        month: 9,
        day: 1,
        hour: 8,
        minute: 0,
      },
    };

    const result = await executeTurn(worldBook, state, '我向守门军士打听城中动静', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(stateWritebackLlmClient.generate).toHaveBeenCalledOnce();
    const stateWritebackPrompt = stateWritebackLlmClient.generate.mock.calls[0]?.[0].messages
      .map((message) => message.content)
      .join('\n');
    expect(stateWritebackPrompt).toContain('个人钱财余额=235');
    expect(stateWritebackPrompt).toContain('itemId=item_iron_bank_credential');
    expect(stateWritebackPrompt).toContain('name=铁金库凭证');
    expect(result.narrativeText).toBe('你与守门军士交谈，等了片刻才得到回应。');
    expect(result.newRuntimeState.currentDate).toBe('公元189年09月01日 08:15（辰时）');
    expect(result.turnDisplayMeta.totalTokens).toBe(200);
  });

  it('canonicalizes a narrator-created duplicate inventory ID back to the unique existing stable item', async () => {
    const initialState = {
      ...makeState(),
      player: {
        ...makeState().player,
        inventory: [{
          id: 'item_iron_bank_credential',
          name: '铁金库凭证',
          quantity: 1,
          category: 'document',
          keyItem: true,
          description: '用于证明持有人在铁金库的兑付权利。',
        }],
      },
    } as RuntimeState;
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '铁金库凭证被重新提起，但本回合没有取得第二份凭证。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'luanshiCommand',
              reason: '正文提到铁金库凭证',
              payload: {
                command: {
                  action: 'updatePlayerLoadout',
                  characterId: 'player',
                  inventoryChanges: [{
                    action: 'upsert',
                    item: {
                      id: 'item_iron_bank_credential_duplicate',
                      name: '铁金库凭证',
                      quantity: 1,
                      category: 'document',
                      keyItem: true,
                      description: '用于证明持有人在铁金库的兑付权利。',
                    },
                  }],
                },
              },
            },
            {
              type: 'timeAdvance',
              reason: '短暂交谈',
              payload: { minutesAdvanced: 5, category: 'conversation' },
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, initialState, '我继续听对方说明', {
      apiConfig,
      llmClient,
    });

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.player.inventory).toHaveLength(1);
    expect(result.newRuntimeState.player.inventory?.[0]).toMatchObject({
      id: 'item_iron_bank_credential',
      name: '铁金库凭证',
      quantity: 1,
    });
    const loadoutCommand = (result.statePatches?.[0].payload as {
      command?: { inventoryChanges?: Array<{ item?: { id?: string } }> };
    }).command;
    expect(loadoutCommand?.inventoryChanges?.[0]?.item?.id).toBe('item_iron_bank_credential');
  });

  it('automatically asks the LLM to append both ration receipt and one-time order removal when the main writeback omits them', async () => {
    const initialState = {
      ...makeState(),
      resources: {
        ...makeState().resources,
        grain: 100,
      },
      player: {
        ...makeState().player,
        inventory: [{
          id: 'item_supply_order',
          name: '粮草提取手令',
          quantity: 1,
          category: 'document',
          keyItem: true,
          description: '提取粮草时由库吏收回。',
        }],
      },
    } as RuntimeState;
    const timeAdvancePatch: StatePatch = {
      type: 'timeAdvance',
      reason: '清点并领取粮草',
      payload: { minutesAdvanced: 30, category: 'logistics' },
    };
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '库吏验过手令，交付四百石粮草，并把这张一次性手令收回归档。',
            suggestedActions: [],
            statePatches: [timeAdvancePatch],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockImplementationOnce(async (request: LlmGenerateRequest) => {
          const prompt = request.messages.map((message) => message.content).join('\n');
          expect(prompt).toContain('itemId: item_supply_order');
          expect(prompt).toContain('一次性凭证权益兑现却缺少 remove/setQuantity');
          expect(prompt).toContain('核对玩家行动、最终 narrativeText');
          expect(request.retryCount).toBe(0);
          expect(request.retryDelayMs).toBe(0);
          return {
            content: JSON.stringify({
              protocolVersion: 'lsfy.turn.v1',
              narrativeText: '不得覆盖主叙事。',
              suggestedActions: [],
              statePatches: [
                timeAdvancePatch,
                {
                  type: 'luanshiCommand',
                  reason: '领取四百石粮草',
                  payload: {
                    command: {
                      action: 'updateResourceLedger',
                      grain: 500,
                      summary: '粮仓交付四百石，现有粮草五百石。',
                    },
                  },
                },
                {
                  type: 'luanshiCommand',
                  reason: '一次性粮草提取手令已被库吏收回',
                  payload: {
                    command: {
                      action: 'updatePlayerLoadout',
                      characterId: 'player',
                      inventoryChanges: [{
                        action: 'remove',
                        itemId: 'item_supply_order',
                        quantity: 1,
                      }],
                    },
                  },
                },
              ],
              statePatch: null,
            }),
            provider: 'openai_compatible' as const,
            model: 'test-model',
          };
        }),
    };

    const result = await executeTurn(worldBook, initialState, '我持主公手令去粮仓领取粮草', {
      apiConfig,
      llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.resources?.grain).toBe(500);
    expect(result.newRuntimeState.player.inventory).toEqual([]);
  });

  it('repairs a completed sale whose inventory removal omitted the stable itemId', async () => {
    const initialState = {
      ...makeState(),
      player: {
        ...makeState().player,
        personalMoney: 503,
        inventory: [{
          id: 'item_old_copper_lamp',
          name: '甲字号旧铜灯',
          quantity: 1,
          category: 'misc',
          description: '可出售的个人杂物。',
        }],
      },
    } as RuntimeState;
    const timeAdvancePatch: StatePatch = {
      type: 'timeAdvance',
      reason: '完成旧货交易',
      payload: { minutesAdvanced: 10, category: 'trade' },
    };
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '旧货商收走甲字号旧铜灯，并当场付给你十一钱。',
            suggestedActions: [],
            statePatches: [
              timeAdvancePatch,
              {
                type: 'luanshiCommand',
                reason: '出售旧铜灯',
                payload: {
                  command: {
                    action: 'updatePlayerLoadout',
                    characterId: 'player',
                    personalMoneyDelta: 11,
                    inventoryChanges: [{ action: 'remove', quantity: 1 }],
                  },
                },
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockImplementationOnce(async (request: LlmGenerateRequest) => {
          const prompt = request.messages.map((message) => message.content).join('\n');
          expect(prompt).toContain('updatePlayerLoadout.inventoryChanges[0].itemId 不能为空');
          expect(prompt).toContain('itemId: item_old_copper_lamp');
          return {
            content: JSON.stringify({
              protocolVersion: 'lsfy.turn.v1',
              narrativeText: '不得覆盖主叙事。',
              suggestedActions: [],
              statePatches: [
                timeAdvancePatch,
                {
                  type: 'luanshiCommand',
                  reason: '出售旧铜灯',
                  payload: {
                    command: {
                      action: 'updatePlayerLoadout',
                      characterId: 'player',
                      personalMoneyDelta: 11,
                      inventoryChanges: [{
                        action: 'remove',
                        itemId: 'item_old_copper_lamp',
                        quantity: 1,
                      }],
                    },
                  },
                },
              ],
              statePatch: null,
            }),
            provider: 'openai_compatible' as const,
            model: 'test-model',
          };
        }),
    };

    const result = await executeTurn(worldBook, initialState, '我把甲字号旧铜灯卖给旧货商，收取十一钱', {
      apiConfig,
      llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.player.personalMoney).toBe(514);
    expect(result.newRuntimeState.player.inventory).toEqual([]);
  });

  it('runs one independent second LLM review only when the first economy repair candidate is rejected', async () => {
    const initialState = {
      ...makeState(),
      player: {
        ...makeState().player,
        personalMoney: 556,
        inventory: [{
          id: 'item_sewing_kit',
          name: '丁字号针线包',
          quantity: 1,
          category: 'misc',
        }],
      },
    } as RuntimeState;
    const timeAdvancePatch: StatePatch = {
      type: 'timeAdvance',
      reason: '交付针线包',
      payload: { minutesAdvanced: 5, category: 'conversation' },
    };
    const originalResponse = {
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: '裁缝收下丁字号针线包，没有回赠其他物品。',
      suggestedActions: [],
      statePatches: [timeAdvancePatch],
      statePatch: null,
    };
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify(originalResponse),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockImplementationOnce(async (request: LlmGenerateRequest) => {
          const prompt = request.messages.map((message) => message.content).join('\n');
          expect(prompt).toContain('这是第 1 次独立复核');
          return {
            content: JSON.stringify({
              ...originalResponse,
              statePatches: [
                timeAdvancePatch,
                {
                  type: 'luanshiCommand',
                  reason: '裁缝已收下针线包，但首份候选缺少稳定物品 ID',
                  payload: {
                    command: {
                      action: 'updatePlayerLoadout',
                      characterId: 'player',
                      inventoryChanges: [{ action: 'remove', quantity: 1 }],
                    },
                  },
                },
              ],
            }),
            provider: 'openai_compatible' as const,
            model: 'test-model',
          };
        })
        .mockImplementationOnce(async (request: LlmGenerateRequest) => {
          const prompt = request.messages.map((message) => message.content).join('\n');
          expect(prompt).toContain('这是第 2 次独立复核');
          expect(prompt).toContain('上一次复核没有产生可接受的完整 statePatches');
          return {
            content: JSON.stringify({
              ...originalResponse,
              statePatches: [
                timeAdvancePatch,
                {
                  type: 'luanshiCommand',
                  reason: '裁缝已收下针线包',
                  payload: {
                    command: {
                      action: 'updatePlayerLoadout',
                      characterId: 'player',
                      inventoryChanges: [{
                        action: 'remove',
                        itemId: 'item_sewing_kit',
                        quantity: 1,
                      }],
                    },
                  },
                },
              ],
            }),
            provider: 'openai_compatible' as const,
            model: 'test-model',
          };
        }),
    };

    const result = await executeTurn(worldBook, initialState, '我把丁字号针线包交给裁缝，他只收下而不回赠物品', {
      apiConfig,
      llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledTimes(3);
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.player.personalMoney).toBe(556);
    expect(result.newRuntimeState.player.inventory).toEqual([]);
  });

  it('does not mistake stamina expenditure or weapon motion for a player economy writeback gap', async () => {
    const initialState = {
      ...makeState(),
      player: {
        ...makeState().player,
        personalMoney: 556,
        inventory: [{
          id: 'item_ring_pommel_saber',
          name: '环首长刀',
          quantity: 1,
          category: 'equipment',
        }],
      },
    } as RuntimeState;
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: [
            '你把环首长刀横在膝上，继续监督操练。',
            '老卒刺出长矛后迅速收回，阵列逐渐齐整。',
            '众人不必白白耗费体力去荒野受冻。',
          ].join(''),
          suggestedActions: [],
          statePatches: [{
            type: 'timeAdvance',
            reason: '完成阵型操练',
            payload: { minutesAdvanced: 30, category: 'training' },
          }],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, initialState, '继续监督防守阵型演练', {
      apiConfig,
      llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledTimes(1);
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.player.personalMoney).toBe(556);
    expect(result.newRuntimeState.player.inventory).toEqual(initialState.player.inventory);
  });

  it('lets the configured state writer perform one general review without keyword-triggered economy retries', async () => {
    const initialState = {
      ...makeState(),
      player: {
        ...makeState().player,
        personalMoney: 556,
        inventory: [{
          id: 'item_ring_pommel_saber',
          name: '环首长刀',
          quantity: 1,
          category: 'equipment',
        }],
      },
    } as RuntimeState;
    const timeAdvancePatch: StatePatch = {
      type: 'timeAdvance',
      reason: '完成阵型操练',
      payload: { minutesAdvanced: 30, category: 'training' },
    };
    const response = {
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: '你把环首长刀横在膝上。老卒刺出长矛后迅速收回，众人不必白白耗费体力。',
      suggestedActions: [],
      statePatches: [timeAdvancePatch],
      statePatch: null,
    };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify(response),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const processingLabels: string[] = [];

    const result = await executeTurn(worldBook, initialState, '继续监督防守阵型演练', {
      apiConfig,
      llmClient,
      stateWritebackApiConfig: {
        ...apiConfig,
        id: 'api_state_writer_no_economy_retry',
        name: '状态写回 API',
        model: 'writeback-model',
      },
      onStageChange: (event) => {
        if (event.status === 'started') processingLabels.push(event.label);
      },
    });

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(processingLabels).toContain('整理状态写回');
    expect(processingLabels).not.toContain('核对物品与个人钱财写回');
    expect(processingLabels).not.toContain('再次核对物品与个人钱财写回');
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
  });

  it('asks the LLM to narrow a single-item redemption that over-removes other credentials', async () => {
    const initialState = {
      ...makeState(),
      resources: {
        ...makeState().resources,
        grain: 500,
      },
      player: {
        ...makeState().player,
        inventory: [
          {
            id: 'item_grain_order',
            name: '戊字号粮草提取手令',
            quantity: 1,
            category: 'document',
          },
          {
            id: 'item_bank_credential_a',
            name: '甲字号铁金库凭证',
            quantity: 1,
            category: 'document',
          },
          {
            id: 'item_bank_credential_b',
            name: '乙字号铁金库凭证',
            quantity: 1,
            category: 'document',
          },
        ],
      },
    } as RuntimeState;
    const timeAdvancePatch: StatePatch = {
      type: 'timeAdvance',
      reason: '粮仓交割',
      payload: { minutesAdvanced: 20, category: 'logistics' },
    };
    const overbroadLoadoutPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: '戊字号粮草手令完成核销',
      payload: {
        command: {
          action: 'updatePlayerLoadout',
          characterId: 'player',
          inventoryChanges: [
            { action: 'remove', itemId: 'item_grain_order', quantity: 1 },
            { action: 'remove', itemId: 'item_bank_credential_a', quantity: 1 },
            { action: 'remove', itemId: 'item_bank_credential_b', quantity: 1 },
          ],
        },
      },
    };
    const resourcePatch: StatePatch = {
      type: 'luanshiCommand',
      reason: '一百石粮草入账',
      payload: {
        command: {
          action: 'updateResourceLedger',
          grain: 600,
          summary: '公共粮草增至六百石。',
        },
      },
    };
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '库吏收回戊字号粮草提取手令，并交付一百石粮草；铁金库凭证仍由你保管。',
            suggestedActions: [],
            statePatches: [timeAdvancePatch, overbroadLoadoutPatch, resourcePatch],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockImplementationOnce(async (request: LlmGenerateRequest) => {
          const prompt = request.messages.map((message) => message.content).join('\n');
          expect(prompt).toContain('破坏性修改了未点名物品');
          expect(prompt).toContain('item_bank_credential_a（甲字号铁金库凭证）');
          expect(prompt).toContain('不得因类别或名称相似批量处理');
          expect(prompt).toContain('未被玩家行动明确点名');
          return {
            content: JSON.stringify({
              protocolVersion: 'lsfy.turn.v1',
              narrativeText: '库吏只收回戊字号粮草提取手令，并交付一百石粮草；甲、乙两张铁金库凭证仍由你保管。',
              suggestedActions: [],
              statePatches: [
                timeAdvancePatch,
                {
                  ...overbroadLoadoutPatch,
                  payload: {
                    command: {
                      action: 'updatePlayerLoadout',
                      characterId: 'player',
                      inventoryChanges: [
                        { action: 'remove', itemId: 'item_grain_order', quantity: 1 },
                      ],
                    },
                  },
                },
                resourcePatch,
              ],
              statePatch: null,
            }),
            provider: 'openai_compatible' as const,
            model: 'test-model',
          };
        }),
    };

    const result = await executeTurn(worldBook, initialState, '我只用戊字号粮草提取手令领取一百石粮草', {
      apiConfig,
      llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.narrativeText).toContain('铁金库凭证仍由你保管');
    expect(result.newRuntimeState.resources?.grain).toBe(600);
    expect(result.newRuntimeState.player.inventory).toEqual([
      expect.objectContaining({ id: 'item_bank_credential_a', quantity: 1 }),
      expect.objectContaining({ id: 'item_bank_credential_b', quantity: 1 }),
    ]);
  });

  it('applies a completed personal purchase to both personal money and inventory in one narrator transaction', async () => {
    const initialState = {
      ...makeState(),
      player: {
        ...makeState().player,
        personalMoney: 100,
        inventory: [],
      },
    } as RuntimeState;
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '你付出四十钱，买下一包金疮药。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'luanshiCommand',
              reason: '个人购买金疮药',
              payload: {
                command: {
                  action: 'updatePlayerLoadout',
                  characterId: 'player',
                  personalMoneyDelta: -40,
                  inventoryChanges: [{
                    action: 'upsert',
                    item: {
                      id: 'item_wound_medicine',
                      name: '金疮药',
                      quantity: 1,
                      category: 'consumable',
                    },
                  }],
                },
              },
            },
            {
              type: 'timeAdvance',
              reason: '市集交易',
              payload: { minutesAdvanced: 10, category: 'trade' },
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, initialState, '我花四十钱买一包金疮药', {
      apiConfig,
      llmClient,
    });

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.player.personalMoney).toBe(60);
    expect(result.newRuntimeState.player.inventory).toEqual([
      expect.objectContaining({
        id: 'item_wound_medicine',
        name: '金疮药',
        quantity: 1,
      }),
    ]);
    expect(result.newRuntimeState.playerResources).not.toHaveProperty('钱财');
    expect(result.newRuntimeState.playerResources).not.toHaveProperty('money');
  });

  it('uses the dedicated state writeback API again when general writeback repair still omits timeAdvance', async () => {
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_state_writeback_focused_time_repair',
      name: '状态写回 API',
      model: 'writeback-model',
    };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '你在门前等候，直到守门军士传回消息。',
          suggestedActions: [],
          statePatches: [],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '不覆盖正文。',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'writeback-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '仍不覆盖正文。',
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 20, reason: '等候回报', category: 'waiting' },
                reason: '在门前等候消息耗时',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'writeback-model',
        }),
    };

    const result = await executeTurn(worldBook, makeState(), '我在门前等候回报', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(stateWritebackLlmClient.generate).toHaveBeenCalledTimes(2);
    const focusedRepairRequest = stateWritebackLlmClient.generate.mock.calls[1]?.[0] as LlmGenerateRequest;
    expect(focusedRepairRequest.config.id).toBe(stateWritebackApiConfig.id);
    expect(focusedRepairRequest.messages.map((message) => message.content).join('\n')).toContain('回合 JSON 修复器');
    expect(result.narrativeText).toBe('你在门前等候，直到守门军士传回消息。');
    expect(result.newRuntimeState.currentDate).toBe('公元1年01月01日 08:20（辰时）');
  });

  it('falls back to the main API for focused time repair when state writeback repair fails', async () => {
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_state_writeback_failed_time_repair',
      name: '状态写回 API',
      model: 'writeback-model',
    };
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '你在门前等候，直到守门军士传回消息。',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '这段正文不应覆盖主叙事。',
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 20, reason: '等候回报', category: 'waiting' },
                reason: '在门前等候消息耗时',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        }),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async () => {
        throw new Error('writeback api unavailable');
      }),
    };

    const result = await executeTurn(worldBook, makeState(), '我在门前等候回报', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(stateWritebackLlmClient.generate).toHaveBeenCalledOnce();
    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    const focusedRepairRequest = llmClient.generate.mock.calls[1]?.[0] as LlmGenerateRequest;
    expect(focusedRepairRequest.config.id).toBe(apiConfig.id);
    expect(result.narrativeText).toBe('你在门前等候，直到守门军士传回消息。');
    expect(result.newRuntimeState.currentDate).toBe('公元1年01月01日 08:20（辰时）');
    expect(result.writeback?.debugNotes).toContain('状态写回整理失败：writeback api unavailable');
  });

  it('falls back to the main API after two empty dedicated focused repairs and accounts for all usage', async () => {
    const mainNarrative = '你在门前等候，直到守门军士传回消息。';
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_state_writeback_empty_time_repair',
      name: '状态写回 API',
      model: 'writeback-model',
    };
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: mainNarrative,
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '这段备用修复正文不应覆盖主叙事。',
            suggestedActions: [],
            statePatches: [{
              type: 'timeAdvance',
              payload: { minutesAdvanced: 20, reason: '等候回报', category: 'waiting' },
              reason: '在门前等候消息耗时',
            }],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        }),
    };
    const stateWritebackLlmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '状态整理正文不应覆盖主叙事。',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'writeback-model',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        })
        .mockRejectedValueOnce(new LlmEmptyContentError(
          'API 返回缺少正文内容',
          { promptTokens: 4, completionTokens: 1, totalTokens: 5 },
        ))
        .mockRejectedValueOnce(new LlmEmptyContentError(
          'API 返回缺少正文内容',
          { promptTokens: 6, completionTokens: 2, totalTokens: 8 },
        )),
    };

    const result = await executeTurn(worldBook, makeState(), '我在门前等候回报', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(stateWritebackLlmClient.generate).toHaveBeenCalledTimes(3);
    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(result.narrativeText).toBe(mainNarrative);
    expect(result.writeback?.debugNotes).toEqual(expect.arrayContaining([
      expect.stringContaining('状态写回 API 未能补齐时间推进，已回退主剧情 API：时间推进结构化修复连续两次返回空内容'),
    ]));
    expect(result.newRuntimeState.currentDate).toBe('公元1年01月01日 08:20（辰时）');
    expect(result.turnDisplayMeta.promptTokens).toBe(150);
    expect(result.turnDisplayMeta.completionTokens).toBe(78);
    expect(result.turnDisplayMeta.totalTokens).toBe(228);
  });

  it('accounts for dedicated focused usage when an empty response is followed by a protocol failure before main fallback', async () => {
    const mainNarrative = '你在门前等候，直到守门军士传回消息。';
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_state_writeback_invalid_time_repair',
      name: '状态写回 API',
      model: 'writeback-model',
    };
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: mainNarrative,
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '这段备用修复正文不应覆盖主叙事。',
            suggestedActions: [],
            statePatches: [{
              type: 'timeAdvance',
              payload: { minutesAdvanced: 20, reason: '等候回报', category: 'waiting' },
              reason: '在门前等候消息耗时',
            }],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        }),
    };
    const stateWritebackLlmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '状态整理正文不应覆盖主叙事。',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'writeback-model',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        })
        .mockRejectedValueOnce(new LlmEmptyContentError(
          'API 返回缺少正文内容',
          { promptTokens: 7, completionTokens: 1, totalTokens: 8 },
        ))
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '非空修复响应仍缺少合法时间推进。',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'writeback-model',
          usage: { promptTokens: 9, completionTokens: 3, totalTokens: 12 },
        }),
    };

    const result = await executeTurn(worldBook, makeState(), '我在门前等候回报', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(stateWritebackLlmClient.generate).toHaveBeenCalledTimes(3);
    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(result.narrativeText).toBe(mainNarrative);
    expect(result.writeback?.debugNotes).toEqual(expect.arrayContaining([
      expect.stringContaining('状态写回 API 未能补齐时间推进，已回退主剧情 API：模型返回缺少有效 timeAdvance，且结构化修复失败'),
    ]));
    expect(result.newRuntimeState.currentDate).toBe('公元1年01月01日 08:20（辰时）');
    expect(result.turnDisplayMeta.promptTokens).toBe(156);
    expect(result.turnDisplayMeta.completionTokens).toBe(79);
    expect(result.turnDisplayMeta.totalTokens).toBe(235);
  });

  it('accounts for a dedicated focused protocol failure without a preceding empty response before main fallback', async () => {
    const mainNarrative = '你在门前等候，直到守门军士传回消息。';
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_state_writeback_direct_invalid_time_repair',
      name: '状态写回 API',
      model: 'writeback-model',
    };
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: mainNarrative,
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '这段备用修复正文不应覆盖主叙事。',
            suggestedActions: [],
            statePatches: [{
              type: 'timeAdvance',
              payload: { minutesAdvanced: 20, reason: '等候回报', category: 'waiting' },
              reason: '在门前等候消息耗时',
            }],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        }),
    };
    const stateWritebackLlmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '状态整理正文不应覆盖主叙事。',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'writeback-model',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '非空修复响应仍缺少合法时间推进。',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'writeback-model',
          usage: { promptTokens: 9, completionTokens: 3, totalTokens: 12 },
        }),
    };

    const result = await executeTurn(worldBook, makeState(), '我在门前等候回报', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(stateWritebackLlmClient.generate).toHaveBeenCalledTimes(2);
    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(result.narrativeText).toBe(mainNarrative);
    expect(result.writeback?.debugNotes).toEqual(expect.arrayContaining([
      expect.stringContaining('状态写回 API 未能补齐时间推进，已回退主剧情 API：模型返回缺少有效 timeAdvance，且结构化修复失败'),
    ]));
    expect(result.newRuntimeState.currentDate).toBe('公元1年01月01日 08:20（辰时）');
    expect(result.turnDisplayMeta.promptTokens).toBe(149);
    expect(result.turnDisplayMeta.completionTokens).toBe(78);
    expect(result.turnDisplayMeta.totalTokens).toBe(227);
  });

  it('uses an optional state writeback API to repair structured patches while preserving the narrative', async () => {
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_state_writeback',
      name: '状态写回 API',
      model: 'writeback-model',
    };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '你清点库房后，确认有十五贯钱可用于短期周转。',
          suggestedActions: [{ label: '登记账册', description: '把钱记入账册', actionType: 'other' }],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 10, reason: '清点库房', category: 'inspection' },
              reason: '清点库房耗时',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async (request: LlmGenerateRequest) => {
        expect(request.messages).toHaveLength(2);
        expect(request.messages[0]?.content).toContain('不得重写 narrativeText');
        expect(request.messages[1]?.content).not.toContain('## 稳定状态写回规则');
        const promptText = request.messages.map((message) => message.content).join('\n');
        expect(promptText).toContain('状态写回整理器');
        expect(promptText).toContain('清点库房后');
        expect(promptText).toContain('状态写入上下文');
        expect(promptText).toContain('部队 size 是当前已入账兵力绝对值');
        expect(promptText).toContain('不得把同一批已入账新卒重复加到 size');
        expect(request.retryCount).toBe(0);
        expect(request.retryDelayMs).toBe(0);
        return {
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '这段正文不应覆盖主叙事。',
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 10, reason: '清点库房', category: 'inspection' },
                reason: '清点库房耗时',
              },
              {
                type: 'luanshiCommand',
                payload: {
                  command: {
                    action: 'updateResourceLedger',
                    previousMoneyGuan: 0,
                    moneyDeltaGuan: 15,
                    moneyGuan: 15,
                    summary: '库房清点后确认可用钱财十五贯。',
                  },
                },
                reason: '登记库房钱财。',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'writeback-model',
          usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        };
      }),
    };

    const result = await executeTurn(worldBook, makeState(), '我清点库房钱财', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(stateWritebackLlmClient.generate).toHaveBeenCalledOnce();
    expect(result.narrativeText).toBe('你清点库房后，确认有十五贯钱可用于短期周转。');
    expect(result.suggestedActions[0].label).toBe('登记账册');
    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.resources?.money).toBe(15);
    expect(result.turnDisplayMeta.totalTokens).toBe(200);
  });

  it('borrows the main API to close a structured private-asset acquisition gap', async () => {
    const sourceRefId = 'asset-acquisition-turn-1-lin-manor';
    const narrativeText = '曹家交出契书与账册，坞堡、田亩和佃农自此正式归入林氏名下。';
    const mainResponse = {
      protocolVersion: 'lsfy.turn.v1',
      narrativeText,
      suggestedActions: [],
      statePatches: [
        {
          type: 'timeAdvance',
          payload: { minutesAdvanced: 30, reason: '交割产业契书', category: 'conversation' },
          reason: '产权交割耗时',
        },
      ],
      statePatch: null,
      writeback: {
        turnSummary: {
          brief: '曹家坞堡正式转入林氏名下。',
          privateAssetAcquisitions: [
            {
              sourceRefId,
              assetName: '林氏南皋坞堡',
              kind: 'transfer',
              summary: '曹家当面交付契书与账册，产权正式转入主角名下。',
            },
          ],
        },
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        debugNotes: [],
      },
    };
    const repairedResponse = {
      ...mainResponse,
      statePatches: [
        ...mainResponse.statePatches,
        {
          type: 'luanshiCommand',
          payload: {
            command: {
              action: 'upsertPrivateAsset',
              operation: 'create',
              privateAssetId: 'private_asset_lin_nangao_manor',
              name: '林氏南皋坞堡',
              type: 'estate',
              ownerScope: 'personal',
              status: 'active',
              summary: '有坞墙、田亩与佃户的庄园产业。',
              locationId: 'loc_market_town',
              mu: 100,
              households: 20,
              acquisition: {
                kind: 'transfer',
                occurredAt: '公元1年01月01日 08:00（辰时）',
                sourceRefId,
                summary: '曹家当面交付契书与账册，产权正式转入主角名下。',
              },
            },
          },
          reason: '补齐本回合已经完成的私人产业产权转移。',
        },
      ],
    };
    const llmClient = {
      generate: vi.fn(async (request: LlmGenerateRequest) => {
        if (llmClient.generate.mock.calls.length === 1) {
          return {
            content: JSON.stringify(mainResponse),
            provider: 'openai_compatible' as const,
            model: 'test-model',
          };
        }
        const promptText = request.messages.map((message) => message.content).join('\n');
        expect(promptText).toContain('本次私人产业产权复核焦点');
        expect(promptText).toContain(sourceRefId);
        expect(promptText).toContain('不得把谈判、看契书、代管');
        return {
          content: JSON.stringify(repairedResponse),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        };
      }),
    };

    const result = await executeTurn(worldBook, makeState(), '我接受曹家产业的正式交割', {
      apiConfig,
      llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(result.narrativeText).toBe(narrativeText);
    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.privateAssets).toEqual([
      expect.objectContaining({
        privateAssetId: 'private_asset_lin_nangao_manor',
        name: '林氏南皋坞堡',
        mu: 100,
        households: 20,
        acquisition: expect.objectContaining({ sourceRefId }),
      }),
    ]);
  });

  it('does not run a second review when the structured acquisition already has its asset patch', async () => {
    const sourceRefId = 'asset-acquisition-turn-1-existing-patch';
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '契书交割完成，城南田庄正式归入主角名下。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 20, reason: '交割田庄', category: 'conversation' },
              reason: '产权交割耗时',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'upsertPrivateAsset',
                  operation: 'create',
                  privateAssetId: 'private_asset_south_farmland',
                  name: '城南田庄',
                  type: 'farmland',
                  ownerScope: 'personal',
                  status: 'active',
                  summary: '刚完成契书交割的小型田庄。',
                  mu: 60,
                  households: 8,
                  acquisition: {
                    kind: 'transfer',
                    occurredAt: '公元1年01月01日 08:00（辰时）',
                    sourceRefId,
                    summary: '原主完成契书交割，田庄正式归入主角名下。',
                  },
                },
              },
              reason: '登记已完成的田庄产权转移。',
            },
          ],
          statePatch: null,
          writeback: {
            turnSummary: {
              brief: '城南田庄正式归入主角名下。',
              privateAssetAcquisitions: [{
                sourceRefId,
                assetName: '城南田庄',
                kind: 'transfer',
                summary: '原主完成契书交割，田庄正式归入主角名下。',
              }],
            },
            npcMemorySuggestions: [],
            locationWriteSuggestions: [],
            routeWriteSuggestions: [],
            questChanges: [],
            debugNotes: [],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), '我完成田庄交割', {
      apiConfig,
      llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.privateAssets).toEqual([
      expect.objectContaining({
        privateAssetId: 'private_asset_south_farmland',
        acquisition: expect.objectContaining({ sourceRefId }),
      }),
    ]);
  });

  it('deduplicates signal writebacks merged from the main response and state writeback repair', async () => {
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_state_writeback',
      name: '状态写回 API',
      model: 'writeback-model',
    };
    const signalContent = '襄阳城西客舍住着几个南阳来的私商，手里压着一批生熟铁锭，急需粮食，但不敢冒险将铁料运出城外。';
    const signalOutcome = '若能成功交易并安全运出，左曲将获得打造兵器的关键原料。';
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '韩烈回报南阳客商私卖铁料一事，正等你决断。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '听取密报', category: 'conversation' },
              reason: '听取密报耗时',
            },
          ],
          statePatch: null,
          writeback: {
            signalChanges: [
              {
                action: 'add',
                title: '南阳客商私卖铁料',
                content: signalContent,
                source: '韩烈派出的心腹',
                signalType: 'clue',
                confidence: 'high',
                potentialOutcomeSummary: signalOutcome,
              },
            ],
            debugNotes: [],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '这段正文不应覆盖主叙事。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '听取密报', category: 'conversation' },
              reason: '听取密报耗时',
            },
          ],
          statePatch: null,
          writeback: {
            signalChanges: [
              {
                action: 'add',
                rumorId: 'rumor_nanyang_iron_trade',
                title: '南阳客商私卖铁料',
                content: signalContent,
                source: '韩烈派出的心腹',
                status: 'open',
                signalType: 'clue',
                confidence: 'high',
                potentialOutcomeSummary: signalOutcome,
              },
            ],
            debugNotes: [],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'writeback-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), '我听韩烈汇报城中铁料消息', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(result.writeback?.signalChanges).toHaveLength(1);
    expect(result.writeback?.signalChanges?.[0]).toMatchObject({
      rumorId: 'rumor_nanyang_iron_trade',
      title: '南阳客商私卖铁料',
      content: signalContent,
      source: '韩烈派出的心腹',
      status: 'open',
    });
    expect(result.newRuntimeState.knownRumors).toHaveLength(1);
    expect(result.newRuntimeState.knownRumors[0]).toMatchObject({
      id: 'rumor_nanyang_iron_trade',
      title: '南阳客商私卖铁料',
      content: signalContent,
      source: '韩烈派出的心腹',
      potentialOutcomeSummary: signalOutcome,
    });
  });

  it('uses type-specific repair identities while preserving original writeback facts', async () => {
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_type_semantic_writeback',
      model: 'writeback-model',
    };
    const timeAdvancePatch = {
      type: 'timeAdvance',
      payload: { minutesAdvanced: 10, reason: '核对写回', category: 'inspection' },
      reason: '核对写回耗时',
    };
    const npcProfile = makeComplianceNpcProfile();
    const mainResponse = {
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: '主响应保留自己的正文与合法事实。',
      suggestedActions: [],
      statePatches: [timeAdvancePatch],
      statePatch: null,
      writeback: {
        turnSummary: { brief: '原始回合摘要' },
        protagonistMemory: { recentTurnSummary: '原始主角记忆' },
        npcProfileSuggestions: [npcProfile],
        npcMemorySuggestions: [{
          eventId: 'event_memory_gate',
          npcId: 'npc_gate_guard',
          npcName: '门候',
          source: '亲历',
          content: '原始合法记忆内容。',
        }],
        locationWriteSuggestions: [{
          name: 'East Ford',
          aliases: ['Old Ford', 'River Ford'],
          kind: 'crossing',
          mapLayer: 'place',
          parentId: 'region_root',
          summary: 'The original ford summary.',
          permanence: 'permanent',
        }],
        routeWriteSuggestions: [
          {
            fromPlaceId: 'loc_market_town',
            toPlaceId: 'place_east_ford',
            name: 'East Road',
            routeKind: 'road',
            status: 'open',
            knownLevel: '亲历',
          },
          {
            fromPlaceId: 'loc_market_town',
            toPlaceId: 'place_north_ford',
            name: 'East Road',
            routeKind: 'road',
            status: 'open',
            knownLevel: '传闻',
          },
        ],
        questChanges: [{
          action: 'add',
          title: 'Find the missing scouts',
          summary: 'Find the patrol before dusk.',
          deadlineAt: 'day 11',
          outcomeSummary: 'The patrol can return safely.',
          affectedNpcIds: ['npc_gate_guard', 'npc_absent_scholar'],
        }],
        signalChanges: [
          {
            action: 'add',
            rumorId: 'signal_gate_alarm',
            title: 'Gate alarm',
            content: 'The east bell rang once.',
            source: 'gate watch',
          },
          {
            action: 'add',
            title: 'Unidentified gate report',
            content: 'A runner reached the east gate.',
            source: 'gate watch',
          },
        ],
        plotPlanSuggestions: [{
          action: 'add',
          title: 'Hidden ford raid',
          summary: 'Raiders study the ford.',
          notBeforeAt: 'day 11',
        }],
        worldEventUpdates: [{
          eventId: 'event_gate_alarm',
          summary: 'The original chronicle summary.',
        }],
        worldEventSummary: {
          eventId: 'event_gate_report',
          summary: 'The original world-event summary.',
        },
        debugNotes: ['Original note.'],
      },
    };
    const repairResponse = {
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: 'repair 正文不得覆盖。',
      suggestedActions: [],
      statePatches: [timeAdvancePatch],
      statePatch: null,
      writeback: {
        turnSummary: { visibleConsequence: 'repair 只补可见后果', brief: '不得覆盖原摘要' },
        protagonistMemory: { keyDeed: { summary: 'repair 补充关键行为' }, recentTurnSummary: '不得覆盖原记忆' },
        npcProfileSuggestions: [{
          ...npcProfile,
          aliases: ['Gate Officer'],
          age: 44,
          npcId: ` ${npcProfile.npcId} `,
        }],
        npcMemorySuggestions: [{
          content: 'repair 不得覆盖原始合法记忆。',
          source: '亲历',
          npcName: '门候',
          npcId: 'npc_gate_guard',
          eventId: ' event_memory_gate ',
        }],
        locationWriteSuggestions: [{
          permanence: 'permanent',
          summary: 'Repair must not replace the ford summary.',
          parentId: 'region_root',
          mapLayer: 'place',
          kind: ' crossing ',
          aliases: ['River Ford', 'Old Ford'],
          name: ' east ford! ',
          tensionHint: 'repair may fill this missing field',
        }],
        routeWriteSuggestions: [{
          knownLevel: '亲历',
          status: 'closed',
          routeKind: ' road ',
          name: ' east road! ',
          toPlaceId: 'place_east_ford',
          fromPlaceId: 'loc_market_town',
          notes: 'repair may fill this missing field',
        }],
        questChanges: [
          {
            affectedNpcIds: ['npc_absent_scholar', 'npc_gate_guard'],
            outcomeSummary: ' the patrol can return safely! ',
            deadlineAt: 'day 11',
            summary: 'Repair must not replace the original quest summary.',
            title: ' find the missing scouts! ',
            action: 'add',
            priority: 'high',
          },
          {
            action: 'add',
            title: 'Find the missing scouts',
            summary: 'A later deadline is a distinct proposal.',
            deadlineAt: 'day 12',
            outcomeSummary: 'The patrol can return safely.',
            affectedNpcIds: ['npc_gate_guard', 'npc_absent_scholar'],
          },
        ],
        signalChanges: [
          {
            action: 'archive',
            rumorId: ' signal_gate_alarm ',
            title: 'Gate alarm',
            content: 'The east bell rang once.',
            source: 'gate watch',
            confidence: 'high',
          },
        ],
        plotPlanSuggestions: [
          {
            notBeforeAt: 'day 11',
            summary: ' raiders study the ford! ',
            title: ' hidden ford raid! ',
            action: 'add',
            priority: '高',
          },
          {
            action: 'add',
            title: 'Hidden ford raid',
            summary: 'Raiders study the ford.',
            notBeforeAt: 'day 12',
          },
        ],
        worldEventUpdates: [{
          severity: 'high',
          summary: 'Repair must not replace the chronicle summary.',
          eventId: ' event_gate_alarm ',
        }],
        worldEventSummary: {
          severity: 'high',
          summary: 'Repair must not replace the world-event summary.',
          eventId: 'event_gate_report',
        },
        debugNotes: [' original note! '],
      },
    };
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify(mainResponse),
      provider: 'openai_compatible' as const,
      model: 'main-model',
    })) };
    const stateWritebackLlmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify(repairResponse),
      provider: 'openai_compatible' as const,
      model: 'writeback-model',
    })) };

    const result = await executeTurn(worldBook, makeState(), '核对本回合写回', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(result.writeback?.turnSummary).toEqual({
      brief: '原始回合摘要',
      visibleConsequence: 'repair 只补可见后果',
    });
    expect(result.writeback?.protagonistMemory).toEqual({
      recentTurnSummary: '原始主角记忆',
      keyDeed: { summary: 'repair 补充关键行为' },
    });
    expect(result.writeback?.npcProfileSuggestions).toEqual([
      expect.objectContaining({ npcId: npcProfile.npcId, age: 31, aliases: ['Gate Officer'] }),
    ]);
    expect(result.writeback?.npcMemorySuggestions).toEqual([
      expect.objectContaining({ eventId: 'event_memory_gate', content: '原始合法记忆内容。' }),
    ]);
    expect(result.writeback?.locationWriteSuggestions).toEqual([
      expect.objectContaining({
        name: 'East Ford',
        summary: 'The original ford summary.',
        tensionHint: 'repair may fill this missing field',
      }),
    ]);
    expect(result.writeback?.routeWriteSuggestions).toHaveLength(2);
    expect(result.writeback?.routeWriteSuggestions[0]).toMatchObject({
      toPlaceId: 'place_east_ford',
      status: 'open',
      notes: 'repair may fill this missing field',
    });
    expect(result.writeback?.questChanges).toHaveLength(2);
    expect(result.writeback?.questChanges[0]).toMatchObject({
      action: 'add',
      summary: 'Find the patrol before dusk.',
      priority: 'high',
    });
    expect(result.writeback?.signalChanges).toHaveLength(2);
    expect(result.writeback?.signalChanges?.[0]).toMatchObject({ action: 'add', confidence: 'high' });
    expect(result.writeback?.plotPlanSuggestions).toHaveLength(2);
    expect(result.writeback?.plotPlanSuggestions?.[0]).toMatchObject({
      summary: 'Raiders study the ford.',
      priority: '高',
    });
    expect(result.writeback?.worldEventUpdates).toEqual([
      expect.objectContaining({
        eventId: 'event_gate_alarm',
        summary: 'The original chronicle summary.',
        severity: 'high',
      }),
    ]);
    expect(result.writeback?.worldEventSummary).toMatchObject({
      eventId: 'event_gate_report',
      summary: 'The original world-event summary.',
      severity: 'high',
    });
    expect(result.writeback?.debugNotes).toEqual(['Original note.']);
  });

  it('falls back to the main response when the optional state writeback API fails', async () => {
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_state_writeback',
      name: '状态写回 API',
      model: 'writeback-model',
    };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '你在门前等了片刻，门候终于回话。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '等待回话', category: 'conversation' },
              reason: '等待耗时',
            },
          ],
          statePatch: null,
          writeback: {
            turnSummary: { brief: '主角在门前等待门候回话。' },
            npcMemorySuggestions: [],
            locationWriteSuggestions: [],
            routeWriteSuggestions: [],
            questChanges: [],
            debugNotes: [],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async () => {
        throw new Error('writeback api unavailable');
      }),
    };
    const stageEvents: Array<{ stage: string; status: string; detail?: string }> = [];

    const result = await executeTurn(worldBook, makeState(), '我等待门候回话', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
      onStageChange: (event) => stageEvents.push(event),
    });

    expect(result.generationMode).toBe('llm');
    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.turnLog).toHaveLength(1);
    expect(result.writeback?.debugNotes).toContain('状态写回整理失败：writeback api unavailable');
    expect(stageEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'generatingNarrative', status: 'started' }),
        expect.objectContaining({ stage: 'generatingNarrative', status: 'finished' }),
        expect.objectContaining({ stage: 'repairingStateWriteback', status: 'started' }),
        expect.objectContaining({
          stage: 'repairingStateWriteback',
          status: 'failed',
          detail: 'writeback api unavailable',
        }),
      ]),
    );
    expect(result.turnDisplayMeta.processingStages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'repairingStateWriteback', status: 'failed' }),
      ]),
    );
  });

  it('accepts a reason-anchored known command repair for an unknown luanshi action', async () => {
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_unknown_command_repair',
      name: '状态写回 API',
      model: 'writeback-model',
    };
    const timeAdvancePatch = {
      type: 'timeAdvance',
      payload: { minutesAdvanced: 15, reason: '核对军报', category: 'inspection' },
      reason: '核对军报耗时',
    };
    const invalidCommandPatch = {
      type: 'luanshiCommand',
      payload: { command: { action: 'update', summary: '军报已经核对。' } },
      reason: '记录本回合军报事件',
    };
    const repairedCommandPatch = {
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'recordTurnEvent',
          eventId: 'event_repaired_dispatch',
          locationId: 'loc_market_town',
          summary: '主角核对军报并记入本回合事件。',
          presentNpcIds: [],
          involvedNpcIds: [],
          visibility: '在场可知',
        },
      },
      reason: invalidCommandPatch.reason,
    };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '你核对军报后，将此事记入案牍。',
          suggestedActions: [],
          statePatches: [timeAdvancePatch, invalidCommandPatch],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async (request: LlmGenerateRequest) => {
        expect(request.retryCount).toBe(0);
        expect(request.retryDelayMs).toBe(0);
        return {
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '不得覆盖主叙事。',
            suggestedActions: [],
            statePatches: [timeAdvancePatch, repairedCommandPatch],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'writeback-model',
        };
      }),
    };

    const result = await executeTurn(worldBook, makeState(), '我核对军报', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(stateWritebackLlmClient.generate).toHaveBeenCalledOnce();
    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.currentDate).toBe('公元1年01月01日 08:15（辰时）');
    expect(result.newRuntimeState.turnEvents).toEqual([
      expect.objectContaining({ eventId: 'event_repaired_dispatch' }),
    ]);
  });

  it('repairs canonical grain aliases and deprecated money-unit writebacks before applying the turn', async () => {
    const baseState = ensureLuanShiState(makeState());
    const initialState = ensureLuanShiState({
      ...baseState,
      resources: {
        ...baseState.resources,
        money: 10000,
        grain: 89,
      },
    });
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_grain_ledger_repair',
      name: '状态写回 API',
      model: 'writeback-model',
    };
    const timeAdvancePatch: StatePatch = {
      type: 'timeAdvance',
      payload: { minutesAdvanced: 20, reason: '清点缴获粮草', category: 'logistics' },
      reason: '清点并接收粮草耗时',
    };
    const invalidResourcePatch = {
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'updateResourceLedger',
          money: 10050000,
          playerResources: { 粮草: 289 },
          summary: '错误地把五十贯换算成五万钱；原粮草八十九石，加上新获二百石。',
        },
      },
      reason: '接收五十贯和二百石粮食后的府库总量',
    } as StatePatch;
    const repairedResourcePatch: StatePatch = {
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'updateResourceLedger',
          previousMoneyGuan: 10000,
          moneyDeltaGuan: 50,
          moneyGuan: 10050,
          grain: 289,
          summary: '原府库一万贯，收入五十贯后为一万零五十贯；原粮草八十九石，加上新获二百石。',
        },
      },
      reason: invalidResourcePatch.reason,
    };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '你接收五十贯公款和二百石粮食，命人清点后送入府库。',
          suggestedActions: [],
          statePatches: [timeAdvancePatch],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '不得覆盖主叙事。',
            suggestedActions: [],
            statePatches: [timeAdvancePatch, invalidResourcePatch],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'writeback-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '仍不得覆盖主叙事。',
            suggestedActions: [],
            statePatches: [timeAdvancePatch, repairedResourcePatch],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'writeback-model',
        }),
    };

    const result = await executeTurn(worldBook, initialState, '接收这五十贯公款和二百石粮食并送入府库', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(stateWritebackLlmClient.generate).toHaveBeenCalledTimes(2);
    const repairRequest = stateWritebackLlmClient.generate.mock.calls[1]?.[0] as LlmGenerateRequest;
    const repairPrompt = repairRequest.messages.map((message) => message.content).join('\n');
    expect(repairPrompt).toContain('updateResourceLedger.grain');
    expect(repairPrompt).toContain('updateResourceLedger.money 已废弃');
    expect(repairPrompt).toContain('moneyGuan');
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.resources?.money).toBe(10050);
    expect(result.newRuntimeState.resources?.grain).toBe(289);
    expect(result.newRuntimeState.playerResources).not.toHaveProperty('粮草');
    expect(result.newRuntimeState.playerResources).not.toHaveProperty('grain');
    expect(result.newRuntimeState.turnLog[result.newRuntimeState.turnLog.length - 1]?.statePatchSummary)
      .toContain('money=10050贯, delta=+50贯');
    expect(result.newRuntimeState.turnLog[result.newRuntimeState.turnLog.length - 1]?.statePatchSummary)
      .toContain('grain=289');
  });

  it('falls back to the routed main model when the same API profile id points at a different writeback model', async () => {
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: apiConfig.id,
      name: '状态写回 API',
      model: 'writeback-model',
    };
    const timeAdvancePatch = {
      type: 'timeAdvance',
      payload: { minutesAdvanced: 15, reason: '核对军报', category: 'inspection' },
      reason: '核对军报耗时',
    };
    const invalidCommandPatch = {
      type: 'luanshiCommand',
      payload: { command: { action: 'update', summary: '军报已经核对。' } },
      reason: '记录本回合军报事件',
    };
    const repairedCommandPatch = {
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'recordTurnEvent',
          eventId: 'event_main_fallback_dispatch',
          locationId: 'loc_market_town',
          summary: '主角核对军报并记入本回合事件。',
          presentNpcIds: [],
          involvedNpcIds: [],
          visibility: '在场可知',
        },
      },
      reason: invalidCommandPatch.reason,
    };
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '你核对军报后，将此事记入案牍。',
            suggestedActions: [],
            statePatches: [timeAdvancePatch, invalidCommandPatch],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '不得覆盖主叙事。',
            suggestedActions: [],
            statePatches: [timeAdvancePatch, repairedCommandPatch],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        }),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async () => {
        throw new Error('writeback api unavailable');
      }),
    };

    const result = await executeTurn(worldBook, makeState(), '我核对军报', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(stateWritebackLlmClient.generate).toHaveBeenCalledOnce();
    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    const fallbackRequest = llmClient.generate.mock.calls[1]?.[0] as LlmGenerateRequest;
    expect(fallbackRequest.config.id).toBe(apiConfig.id);
    expect(fallbackRequest.messages.map((message) => message.content).join('\n')).toContain('状态写回整理器');
    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.currentDate).toBe('公元1年01月01日 08:15（辰时）');
    expect(result.newRuntimeState.turnEvents).toEqual([
      expect.objectContaining({ eventId: 'event_main_fallback_dispatch' }),
    ]);
  });

  it('retries one empty state writeback response before falling back and exposes both attempts', async () => {
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_empty_writeback_retry',
      name: '状态写回 API',
      model: 'writeback-model',
    };
    const timeAdvancePatch = {
      type: 'timeAdvance',
      payload: { minutesAdvanced: 15, reason: '核对军报', category: 'inspection' },
      reason: '核对军报耗时',
    };
    const invalidCommandPatch = {
      type: 'luanshiCommand',
      payload: { command: { action: 'update', summary: '军报已经核对。' } },
      reason: '记录本回合军报事件',
    };
    const repairedCommandPatch = {
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'recordTurnEvent',
          eventId: 'event_empty_retry_dispatch',
          locationId: 'loc_market_town',
          summary: '主角核对军报并记入本回合事件。',
          presentNpcIds: [],
          involvedNpcIds: [],
          visibility: '在场可知',
        },
      },
      reason: invalidCommandPatch.reason,
    };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '你核对军报后，将此事记入案牍。',
          suggestedActions: [],
          statePatches: [timeAdvancePatch, invalidCommandPatch],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi
        .fn()
        .mockRejectedValueOnce(new LlmEmptyContentError('API 返回缺少正文内容', {
          promptTokens: 100,
          completionTokens: 0,
          totalTokens: 100,
        }))
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '不得覆盖主叙事。',
            suggestedActions: [],
            statePatches: [timeAdvancePatch, repairedCommandPatch],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'writeback-model',
          usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
        }),
    };
    const stageEvents: TurnProcessingStageEvent[] = [];

    const result = await executeTurn(worldBook, makeState(), '我核对军报', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
      onStageChange: (event) => stageEvents.push(event),
    });

    expect(stateWritebackLlmClient.generate).toHaveBeenCalledTimes(2);
    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.turnEvents).toEqual([
      expect.objectContaining({ eventId: 'event_empty_retry_dispatch' }),
    ]);
    expect(stageEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: '整理状态写回',
        status: 'failed',
        detail: 'API 返回缺少正文内容',
      }),
      expect.objectContaining({
        label: '整理状态写回（空输出重试）',
        status: 'finished',
      }),
    ]));
    expect(result.turnDisplayMeta.totalTokens).toBe(260);
  });

  it('does not swallow typed session cancellation in the optional state writeback fallback', async () => {
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_state_writeback_cancelled',
      name: '状态写回 API',
      model: 'writeback-model',
    };
    const controller = new AbortController();
    const cancellation = new TurnExecutionCancelledError();
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '主剧情已返回，但会话即将切换。',
          suggestedActions: [],
          statePatches: [{
            type: 'timeAdvance',
            payload: { minutesAdvanced: 15, reason: '等待', category: 'conversation' },
            reason: '等待耗时',
          }],
          statePatch: null,
          writeback: {},
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async () => {
        controller.abort(cancellation);
        throw cancellation;
      }),
    };

    await expect(executeTurn(worldBook, makeState(), '我等待', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
      signal: controller.signal,
    })).rejects.toBe(cancellation);
  });

  it('does not swallow a default AbortError from state writeback repair', async () => {
    const controller = new AbortController();
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_state_abort_error',
      model: 'state-abort-model',
    };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '主剧情已经返回。',
          suggestedActions: [],
          statePatches: [{
            type: 'timeAdvance',
            payload: { minutesAdvanced: 10, reason: '等待', category: 'waiting' },
            reason: '等待耗时',
          }],
          statePatch: null,
          writeback: {},
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async () => {
        controller.abort();
        throw controller.signal.reason;
      }),
    };

    const rejection = await executeTurn(worldBook, makeState(), '我等待', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
      signal: controller.signal,
    }).then(() => null, (error) => error);

    expect(rejection).toBe(controller.signal.reason);
    expect((rejection as DOMException).name).toBe('AbortError');
  });

  it('does not fall back to the main API after a default AbortError in focused time repair', async () => {
    const controller = new AbortController();
    const stateWritebackApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_time_abort_error',
      model: 'time-abort-model',
    };
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '主剧情缺少时间推进。',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
            writeback: {},
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '备用请求不应发生。',
            suggestedActions: [],
            statePatches: [{
              type: 'timeAdvance',
              payload: { minutesAdvanced: 10, reason: '备用', category: 'waiting' },
              reason: '备用时间修复',
            }],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        }),
    };
    const stateWritebackLlmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '状态整理仍缺少时间推进。',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
            writeback: {},
          }),
          provider: 'openai_compatible' as const,
          model: 'time-abort-model',
        })
        .mockImplementationOnce(async () => {
          controller.abort();
          throw controller.signal.reason;
        }),
    };

    const rejection = await executeTurn(worldBook, makeState(), '我继续等待', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
      signal: controller.signal,
    }).then(() => null, (error) => error);

    expect(rejection).toBe(controller.signal.reason);
    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(stateWritebackLlmClient.generate).toHaveBeenCalledTimes(2);
  });

  it('does not swallow a default AbortError from NPC profile repair', async () => {
    const controller = new AbortController();
    const npcCompletionApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_npc_abort_error',
      model: 'npc-abort-model',
    };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '王经遣使入营，片刻后王经又令部曲压近营门，牵动当前局势。',
          suggestedActions: [],
          statePatches: [{
            type: 'timeAdvance',
            payload: { minutesAdvanced: 15, reason: '使者往来', category: 'conversation' },
            reason: '使者往来耗时',
          }],
          statePatch: null,
          writeback: { npcProfileSuggestions: [makeRejectedWangJingProfile('npc_wang_jing_abort')] },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const npcCompletionLlmClient = {
      generate: vi.fn(async () => {
        controller.abort();
        throw controller.signal.reason;
      }),
    };

    const rejection = await executeTurn(worldBook, makeState(), '我观察王经使者', {
      apiConfig,
      npcCompletionApiConfig,
      llmClient,
      npcCompletionLlmClient,
      signal: controller.signal,
    }).then(() => null, (error) => error);

    expect(rejection).toBe(controller.signal.reason);
    expect(npcCompletionLlmClient.generate).toHaveBeenCalledOnce();
  });

  it('does not swallow a default AbortError from post-turn memory compression', async () => {
    const controller = new AbortController();
    const baseState = makeState();
    const compressionState = {
      ...baseState,
      turnLog: Array.from({ length: 35 }, (_, index) => ({
        turnNumber: index + 1,
        date: `day ${index + 1}`,
        playerInput: `player action ${index + 1}`,
        narrativeText: `short narrative ${index + 1}`,
        fullNarrativeText: `full narrative ${index + 1}`,
        statePatchSummary: 'none',
        timestamp: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      })),
      memoryArchive: {
        ...baseState.memoryArchive!,
        recentTurnSummaries: Array.from({ length: 35 }, (_, index) => ({
          id: `recent_abort_${index + 1}`,
          turnNumber: index + 1,
          createdAt: `day ${index + 1}`,
          brief: `brief ${index + 1}`,
          importance: 'medium' as const,
        })),
      },
    } as RuntimeState;
    const memorySummaryApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_memory_abort_error',
      model: 'memory-abort-model',
    };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '主回合完成。',
          suggestedActions: [],
          statePatches: [{
            type: 'timeAdvance',
            payload: { minutesAdvanced: 15, reason: '交谈', category: 'conversation' },
            reason: '交谈耗时',
          }],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const memorySummaryLlmClient = {
      generate: vi.fn(async (request: LlmGenerateRequest) => {
        controller.abort();
        throw controller.signal.reason ?? request.signal?.reason;
      }),
    };

    const rejection = await executeTurn(worldBook, compressionState, '我继续交谈', {
      apiConfig,
      memorySummaryApiConfig,
      llmClient,
      memorySummaryLlmClient,
      signal: controller.signal,
    }).then(() => null, (error) => error);

    expect(rejection).toBe(controller.signal.reason);
    expect(memorySummaryLlmClient.generate).toHaveBeenCalledOnce();
    const memoryRequest = memorySummaryLlmClient.generate.mock.calls[0]?.[0] as LlmGenerateRequest;
    expect(memoryRequest.signal).toBe(controller.signal);
    expectRequestTimeoutAtConfiguredCap(
      memoryRequest.timeoutMs,
      TURN_LLM_BUDGET_DEFAULTS.singleAuxiliaryRequestMs,
    );
  });

  it('accepts valid writeback when every raw patch is filtered from the prepared transaction', async () => {
    const emptyOptionalPatch: StatePatch = {
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'updateCharacterIdentity',
          characterId: 'player',
          characterName: '主角',
          characterType: 'player',
        },
      },
      reason: '没有可选身份字段的空操作',
    };
    const writeback: NarratorWritebackProtocol = makeComplianceTurnResponse([]).writeback;
    writeback.questChanges = [{
      action: 'add',
      questId: 'quest_must_not_run_during_compliance',
      title: '合规模拟不得执行任务写回',
      summary: '这里只应验证成功接纳的 NPC 身份。',
    }];
    const acceptedState = prepareNpcComplianceAcceptedRuntimeState({
      patches: [emptyOptionalPatch],
      worldBook,
      runtimeState: makeState(),
      writeback,
    });

    expect(acceptedState?.npcs?.some((npc) => npc.npcId === 'npc_gu_heng_compliance')).toBe(true);
    expect(acceptedState?.activeQuests).toEqual([]);
  });

  it('accepts valid writeback on a normally prepared valid patch batch', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify(makeComplianceTurnResponse([{
          type: 'timeAdvance',
          payload: { minutesAdvanced: 15, reason: '营门禀报', category: 'conversation' },
          reason: '营门禀报耗时',
        }])),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const npcCompletionLlmClient = makeComplianceRepairClient();

    const result = await executeTurn(worldBook, makeState(), '我听顾衡禀报营门事务', {
      apiConfig,
      llmClient,
      npcCompletionApiConfig: { ...apiConfig, id: 'npc-compliance-api', model: 'npc-completion-model' },
      npcCompletionLlmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(npcCompletionLlmClient.generate).not.toHaveBeenCalled();
    expect(result.newRuntimeState.lastPatchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.npcs?.some((npc) => npc.npcId === 'npc_gu_heng_compliance')).toBe(true);
  });

  it('keeps writeback unaccepted when one prepared patch makes the whole batch fail', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify(makeComplianceTurnResponse([
          {
            type: 'timeAdvance',
            payload: { minutesAdvanced: 15, reason: '第一次推进', category: 'conversation' },
            reason: '第一次推进',
          },
          {
            type: 'timeAdvance',
            payload: { minutesAdvanced: 10, reason: '重复推进', category: 'conversation' },
            reason: '同一批次重复推进',
          },
        ])),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const npcCompletionLlmClient = makeComplianceRepairClient();
    const initialState = makeState();

    const result = await executeTurn(worldBook, initialState, '我听顾衡禀报营门事务', {
      apiConfig,
      llmClient,
      npcCompletionApiConfig: { ...apiConfig, id: 'npc-compliance-api', model: 'npc-completion-model' },
      npcCompletionLlmClient,
    });

    expect(npcCompletionLlmClient.generate).toHaveBeenCalledOnce();
    expect(result.newRuntimeState.currentDate).toBe(initialState.currentDate);
    expect(result.newRuntimeState.lastPatchValidation?.valid).toBe(false);
    expect(result.newRuntimeState.npcs?.some((npc) => npc.npcId === 'npc_gu_heng_compliance')).toBe(false);
  });

  it('lets a valid compliance repair replace an invalid original profile with the same identity', async () => {
    const originalResponse = makeComplianceTurnResponse([{
      type: 'timeAdvance',
      payload: { minutesAdvanced: 15, reason: '营门禀报', category: 'conversation' },
      reason: '营门禀报耗时',
    }]);
    originalResponse.writeback.npcProfileSuggestions = [{
      ...makeComplianceNpcProfile(),
      age: 0,
    }];
    const repairResponse = makeComplianceTurnResponse([]);
    repairResponse.writeback.npcProfileSuggestions = [makeComplianceNpcProfile()];
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify(originalResponse),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const npcCompletionLlmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify(repairResponse),
        provider: 'openai_compatible' as const,
        model: 'npc-completion-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), '我听顾衡禀报营门事务', {
      apiConfig,
      llmClient,
      npcCompletionApiConfig: { ...apiConfig, id: 'npc-compliance-api', model: 'npc-completion-model' },
      npcCompletionLlmClient,
    });

    expect(npcCompletionLlmClient.generate).toHaveBeenCalledOnce();
    expect(result.newRuntimeState.npcs?.filter((npc) => npc.npcId === 'npc_gu_heng_compliance')).toHaveLength(1);
    expect(result.newRuntimeState.npcs?.find((npc) => npc.npcId === 'npc_gu_heng_compliance')).toMatchObject({
      name: '顾衡',
      age: 31,
    });
  });

  it('repairs an explicitly submitted long-term NPC profile that failed the local contract', async () => {
    const mainNarrative = '王经遣使入营，称已知营中虚实。片刻后，王经又令部曲压近营门，营中诸将都明白此人已经牵动眼前局势。';
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: mainNarrative,
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 15, reason: '敌将使者往来', category: 'conversation' },
                reason: '敌将使者往来耗时',
              },
            ],
            statePatch: null,
            writeback: {
              turnSummary: { brief: '王经遣使压迫军营。' },
              npcProfileSuggestions: [makeRejectedWangJingProfile('npc_wang_jing')],
              npcMemorySuggestions: [],
              locationWriteSuggestions: [],
              routeWriteSuggestions: [],
              questChanges: [],
              debugNotes: [],
            },
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 100, completionTokens: 80, totalTokens: 180 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: mainNarrative,
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
            writeback: {
              npcProfileSuggestions: [
                {
                  npcId: 'npc_wang_jing',
                  name: '王经',
                  persistenceReason: 'strategic_actor',
                  persistenceEvidence: '本回合确认王经以曹魏前线将领身份持续调动部曲并向玩家军营施压。',
                  sex: '男',
                  age: 46,
                  role: '魏军将领',
                  factionName: '曹魏',
                  locationId: 'loc_market_town',
                  isPresent: false,
                  isFocused: true,
                  currentIdentity: '曹魏方面的前线将领',
                  currentIdentityDescription: '以使者和部曲向玩家所在军营施压的远场敌将。',
                  militaryTitle: '将领',
                  identitySummary: '牵动当前前线局势的曹魏将领。',
                  summary: '王经在本回合以使者和部曲压迫军营，是玩家当前局势中的关键远场人物。',
                  appearance: '未直接照面，只从使者军容和号令风格中显出军府威严。',
                  personality: '谨慎而强硬，擅用军势逼迫对手露出破绽。',
                  motivation: '压迫蜀汉军营，掌握主动。',
                  relationToPlayer: '敌对远场将领',
                  contactLevel: 1,
                  recentAttitude: '试探施压',
                  abilityScores: { 武力: 66, 统率: 74, 智力: 62, 政治: 55, 魅力: 52, 机运: 50 },
                  traits: [
                    {
                      id: 'trait_wang_jing_pressure',
                      label: '持重施压',
                      description: '习惯以军势和使者压迫对手，先探虚实再推进。',
                      source: 'NPC建档合规修复',
                      rarity: 'white',
                    },
                  ],
                  uniqueArts: [{
                    id: 'art_wang_jing_command',
                    name: '持重督阵',
                    rarity: 'blue',
                    domain: 'warfare',
                    level: 2,
                    description: '以谨慎军令维持前线阵势。',
                    effectSummary: '在统率与军势施压场景中提供稳定能力锚点。',
                    source: 'identity',
                    acquisition: {
                      kind: 'background',
                      occurredAt: '乱世元年2月',
                      sourceRefId: 'npc-profile:npc_wang_jing:background',
                      summary: '其前线将领身份与持续督阵事实已经确立该能力。',
                    },
                  }],
                  equipment: [
                    {
                      id: 'eq_wang_jing_sword',
                      slot: 'weapon',
                      name: '魏军佩剑',
                      quality: '精良',
                      description: '前线将领常佩的军府佩剑，象征将领身份。',
                    },
                  ],
                  inventory: [
                    {
                      id: 'item_wang_jing_command_token',
                      name: '军令符牌',
                      quantity: 1,
                      category: 'token',
                      description: '用于传递前线号令的符牌。',
                    },
                  ],
                },
              ],
              npcMemorySuggestions: [],
              locationWriteSuggestions: [],
              routeWriteSuggestions: [],
              questChanges: [],
              debugNotes: [],
            },
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 40, completionTokens: 60, totalTokens: 100 },
        }),
    };

    const result = await executeTurn(worldBook, makeState(), '我查看敌使带来的军情', { apiConfig, llmClient });

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    const repairRequest = llmClient.generate.mock.calls[1]?.[0] as LlmGenerateRequest;
    const repairPrompt = repairRequest.messages.map((message) => message.content).join('\n');
    expect(repairPrompt).toContain('NPC 人物志合规修复器');
    expect(repairPrompt).toContain('王经');
    expect(repairPrompt).toContain('不得重写 narrativeText');
    expect(repairPrompt).toContain('npcProfileSuggestions[].equipment');
    expect(repairPrompt).toContain('npcProfileSuggestions[].inventory');
    expect(repairPrompt).toContain('重要 NPC 行装');
    expect(repairPrompt).toContain('sex 只能逐字写“男”“女”“其他”');
    expect(repairPrompt).toContain('contactLevel 必须是大于等于 0 的有限数字');
    expect(repairPrompt).toContain('level 必须是 1—10 的整数');
    const npcs = result.newRuntimeState.npcs ?? [];
    expect(npcs.map((npc) => npc.name)).toContain('王经');
    expect(npcs.find((npc) => npc.name === '王经')).toMatchObject({
      npcId: 'npc_wang_jing',
      isFocused: true,
      relationToPlayer: '敌对远场将领',
      equipment: [{ name: '魏军佩剑' }],
      inventory: [{ name: '军令符牌' }],
    });
    expect(result.turnDisplayMeta.promptTokens).toBe(140);
    expect(result.turnDisplayMeta.completionTokens).toBe(140);
    expect(result.turnDisplayMeta.totalTokens).toBe(280);
  });

  it('uses the configured NPC completion API for missing NPC profile compliance repair', async () => {
    const npcCompletionApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_npc_completion',
      name: 'NPC 建档 API',
      model: 'npc-completion-model',
    };
    const mainNarrative = '王经遣使入营，称已知营中虚实。片刻后，王经又令部曲压近营门，营中诸将都明白此人已经牵动眼前局势。';
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: mainNarrative,
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '敌将使者往来', category: 'conversation' },
              reason: '敌将使者往来耗时',
            },
          ],
          statePatch: null,
          writeback: {
            turnSummary: { brief: '王经遣使压迫军营。' },
            npcProfileSuggestions: [makeRejectedWangJingProfile('npc_wang_jing_route')],
            npcMemorySuggestions: [],
            locationWriteSuggestions: [],
            routeWriteSuggestions: [],
            questChanges: [],
            debugNotes: [],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
        usage: { promptTokens: 100, completionTokens: 80, totalTokens: 180 },
      })),
    };
    const npcCompletionLlmClient = {
      generate: vi.fn(async (request: LlmGenerateRequest) => {
        const promptText = request.messages.map((message) => message.content).join('\n');
        expect(request.config.model).toBe('npc-completion-model');
        expect(promptText).toContain('NPC 人物志合规修复器');
        expect(promptText).toContain('王经');
        return {
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: mainNarrative,
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
            writeback: {
              npcProfileSuggestions: [
                {
                  npcId: 'npc_wang_jing_route',
                  name: '王经',
                  persistenceReason: 'strategic_actor',
                  persistenceEvidence: '本回合确认王经以曹魏前线将领身份持续调动部曲并向玩家军营施压。',
                  sex: '男',
                  age: 46,
                  role: '魏军将领',
                  factionName: '曹魏',
                  locationId: 'loc_market_town',
                  isPresent: false,
                  isFocused: true,
                  currentIdentity: '曹魏方面的前线将领',
                  summary: '王经在本回合以使者和部曲压迫军营，是玩家当前局势中的关键远场人物。',
                  appearance: '未直接照面，只从使者军容和号令风格中显出军府威严。',
                  personality: '谨慎而强硬，擅用军势逼迫对手露出破绽。',
                  motivation: '压迫军营，掌握主动。',
                  relationToPlayer: '敌对远场将领',
                  contactLevel: 1,
                  recentAttitude: '试探施压',
                  abilityScores: { 武力: 66, 统率: 74, 智力: 62, 政治: 55, 魅力: 52, 机运: 50 },
                  traits: [
                    {
                      id: 'trait_wang_jing_pressure',
                      label: '持重施压',
                      description: '习惯以军势和使者压迫对手，先探虚实再推进。',
                      source: 'NPC建档合规修复',
                      rarity: 'white',
                    },
                  ],
                  uniqueArts: [{
                    id: 'art_wang_jing_route_command',
                    name: '持重督阵',
                    rarity: 'blue',
                    domain: 'warfare',
                    level: 2,
                    description: '以谨慎军令维持前线阵势。',
                    effectSummary: '在统率与军势施压场景中提供稳定能力锚点。',
                    source: 'identity',
                    acquisition: {
                      kind: 'background',
                      occurredAt: '乱世元年2月',
                      sourceRefId: 'npc-profile:npc_wang_jing_route:background',
                      summary: '其前线将领身份与持续督阵事实已经确立该能力。',
                    },
                  }],
                },
              ],
              npcMemorySuggestions: [],
              locationWriteSuggestions: [],
              routeWriteSuggestions: [],
              questChanges: [],
              debugNotes: [],
            },
          }),
          provider: 'openai_compatible' as const,
          model: 'npc-completion-model',
          usage: { promptTokens: 40, completionTokens: 60, totalTokens: 100 },
        };
      }),
    };

    const result = await executeTurn(worldBook, makeState(), '我观察王经使者动向', {
      apiConfig,
      npcCompletionApiConfig,
      llmClient,
      npcCompletionLlmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(npcCompletionLlmClient.generate).toHaveBeenCalledOnce();
    expect(result.writeback?.debugNotes).toContain('NPC建档合规修复补档：王经');
    expect(result.turnDisplayMeta.processingStages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'repairingNpcProfiles',
          status: 'finished',
          model: 'npc-completion-model',
        }),
      ]),
    );
  });

  it('soft-completes a relevant legacy NPC unique-art archive once and keeps it on later turns', async () => {
    const state = makeState();
    state.npcs!.push({
      npcId: 'npc_zhaoyun_legacy',
      name: '赵云',
      sex: '男',
      age: 27,
      role: '骑将',
      currentIdentity: '白马骑将',
      locationId: 'loc_market_town',
      isPresent: true,
      isFocused: true,
      summary: '以勇武、骑战和忠毅闻名。',
      appearance: '白袍银甲，持枪而立。',
      personality: '沉毅果决。',
      motivation: '护持百姓与同袍。',
      relationToPlayer: '并肩作战',
      contactLevel: 8,
      recentAttitude: '信任',
      abilityScores: { 武力: 96, 统率: 85, 智力: 75, 政治: 62, 魅力: 88, 机运: 66 },
      traits: [{ id: 'trait_zhaoyun_brave', label: '忠勇', description: '临阵不退。', source: 'history' }],
      memories: [],
    });
    const mainResponse = {
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: '赵云提枪在营门前检视骑队，随后向你颔首。',
      suggestedActions: [],
      statePatches: [{
        type: 'timeAdvance',
        payload: { minutesAdvanced: 10, reason: '检视骑队', category: 'conversation' },
        reason: '营门交谈经过时间',
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
    };
    const firstClient = {
      generate: vi.fn()
        .mockResolvedValueOnce({
          content: JSON.stringify(mainResponse),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        }),
    };

    const first = await executeTurn(worldBook, state, '我请赵云检视骑队', {
      apiConfig,
      llmClient: firstClient,
    });
    expect(firstClient.generate).toHaveBeenCalledOnce();
    expect(first.writeback?.debugNotes).toContain('NPC稳定绝艺已本地补全：赵云');
    expect(first.newRuntimeState.npcs?.find((npc) => npc.npcId === 'npc_zhaoyun_legacy')?.uniqueArts)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ rarity: 'red', domain: 'personalCombat' }),
        expect.objectContaining({ rarity: 'purple', domain: 'warfare' }),
        expect.objectContaining({ rarity: 'purple', domain: 'social' }),
      ]));
    expect(first.turnDisplayMeta.processingStages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'repairingNpcProfiles',
          label: '本地补全 NPC 稳定绝艺',
          status: 'finished',
          provider: 'local',
          model: 'npc-unique-art-policy-v1',
          detail: '已写入：赵云',
        }),
      ]),
    );

    const secondClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify(mainResponse),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const second = await executeTurn(worldBook, first.newRuntimeState, '我与赵云继续商议骑队布置', {
      apiConfig,
      llmClient: secondClient,
    });
    expect(secondClient.generate).toHaveBeenCalledOnce();
    expect(second.newRuntimeState.npcs?.find((npc) => npc.npcId === 'npc_zhaoyun_legacy')?.uniqueArts)
      .toEqual(first.newRuntimeState.npcs?.find((npc) => npc.npcId === 'npc_zhaoyun_legacy')?.uniqueArts);
  });

  it('uses bounded timeouts for optional post-turn writeback and NPC repair requests', async () => {
    const controller = new AbortController();
    const npcCompletionApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_npc_completion',
      name: 'NPC 建档 API',
      model: 'npc-completion-model',
    };
    const mainNarrative = '王经遣使入营，片刻后王经又令部曲压近营门，牵动当前局势。';
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: mainNarrative,
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '敌将使者往来', category: 'conversation' },
              reason: '敌将使者往来耗时',
            },
          ],
          statePatch: null,
          writeback: {
            turnSummary: { brief: '王经遣使压迫军营。' },
            npcProfileSuggestions: [makeRejectedWangJingProfile('npc_wang_jing_timeout')],
            npcMemorySuggestions: [],
            locationWriteSuggestions: [],
            routeWriteSuggestions: [],
            questChanges: [],
            debugNotes: [],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
        usage: { promptTokens: 100, completionTokens: 80, totalTokens: 180 },
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: mainNarrative,
          suggestedActions: [],
          statePatches: [],
          statePatch: null,
          writeback: {
            npcProfileSuggestions: [makeRejectedWangJingProfile('npc_wang_jing_timeout')],
            npcMemorySuggestions: [],
            locationWriteSuggestions: [],
            routeWriteSuggestions: [],
            questChanges: [],
            debugNotes: [],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'state-writeback-model',
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      })),
    };
    const npcCompletionLlmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: mainNarrative,
          suggestedActions: [],
          statePatches: [],
          statePatch: null,
          writeback: {
            npcProfileSuggestions: [
              {
                npcId: 'npc_wang_jing_timeout',
                name: '王经',
                sex: '男',
                age: 46,
                role: '魏军将领',
                locationId: 'loc_market_town',
                isPresent: false,
                isFocused: true,
                currentIdentity: '曹魏方面的前线将领',
                summary: '王经在本回合以使者和部曲压迫军营。',
                appearance: '未直接照面。',
                personality: '谨慎强硬。',
                motivation: '压迫军营，掌握主动。',
                relationToPlayer: '敌对远场将领',
                contactLevel: 1,
                recentAttitude: '试探施压',
                abilityScores: { 武力: 66, 统率: 74, 智力: 62, 政治: 55, 魅力: 52, 机运: 50 },
                traits: [
                  {
                    id: 'trait_wang_jing_pressure_timeout',
                    label: '持重施压',
                    description: '习惯以军势和使者压迫对手。',
                    source: 'NPC建档合规修复',
                    rarity: 'white',
                  },
                ],
              },
            ],
            npcMemorySuggestions: [],
            locationWriteSuggestions: [],
            routeWriteSuggestions: [],
            questChanges: [],
            debugNotes: [],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'npc-completion-model',
        usage: { promptTokens: 40, completionTokens: 60, totalTokens: 100 },
      })),
    };

    await executeTurn(worldBook, makeState(), '我观察王经使者动向', {
      apiConfig,
      stateWritebackApiConfig: apiConfig,
      npcCompletionApiConfig,
      llmClient,
      stateWritebackLlmClient,
      npcCompletionLlmClient,
      signal: controller.signal,
    });

    const mainCalls = llmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    const stateWritebackCalls = stateWritebackLlmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    const npcCompletionCalls = npcCompletionLlmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    expect(mainCalls[0]?.[0].signal).toBe(controller.signal);
    expectRequestTimeoutAtConfiguredCap(
      mainCalls[0]?.[0].timeoutMs,
      TURN_LLM_BUDGET_DEFAULTS.mainNarrativeRequestMs,
    );
    expect(stateWritebackCalls[0]?.[0].signal).toBe(controller.signal);
    expect(npcCompletionCalls[0]?.[0].signal).toBe(controller.signal);
    expectRequestTimeoutAtConfiguredCap(
      stateWritebackCalls[0]?.[0].timeoutMs,
      120_000,
    );
    expectRequestTimeoutAtConfiguredCap(npcCompletionCalls[0]?.[0].timeoutMs, 120_000);
    expect(npcCompletionCalls[0]?.[0].retryCount).toBe(0);
  });

  it('skips NPC profile repair when the same optional API already failed during state writeback repair', async () => {
    const mainNarrative = '王经遣使入营，片刻后王经又令部曲压近营门，牵动当前局势。';
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: mainNarrative,
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '敌将使者往来', category: 'conversation' },
              reason: '敌将使者往来耗时',
            },
          ],
          statePatch: null,
          writeback: {
            turnSummary: { brief: '王经遣使压迫军营。' },
            npcProfileSuggestions: [makeRejectedWangJingProfile('npc_wang_jing_skip')],
            npcMemorySuggestions: [],
            locationWriteSuggestions: [],
            routeWriteSuggestions: [],
            questChanges: [],
            debugNotes: [],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
        usage: { promptTokens: 100, completionTokens: 80, totalTokens: 180 },
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async () => {
        throw new Error('API 请求失败（502）');
      }),
    };
    const npcCompletionLlmClient = {
      generate: vi.fn(async () => {
        throw new Error('should not call npc repair after same-api state writeback failure');
      }),
    };
    const stageEvents: Array<{ stage: string; status: string; detail?: string }> = [];

    const result = await executeTurn(worldBook, makeState(), '我观察王经使者动向', {
      apiConfig,
      stateWritebackApiConfig: apiConfig,
      npcCompletionApiConfig: apiConfig,
      llmClient,
      stateWritebackLlmClient,
      npcCompletionLlmClient,
      onStageChange: (event) => stageEvents.push(event),
    });

    expect(npcCompletionLlmClient.generate).not.toHaveBeenCalled();
    expect(result.writeback?.debugNotes).toContain('NPC建档合规修复跳过：同一后处理 API 的状态写回整理已失败');
    expect(stageEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'repairingNpcProfiles',
          status: 'skipped',
          detail: 'same post-turn api already failed during state writeback repair',
        }),
      ]),
    );
  });

  it('switches to the configured state writeback fallback without regenerating the main narrative', async () => {
    const primaryConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_state_primary_failure',
      model: 'state-primary-model',
    };
    const fallbackConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_state_fallback_success',
      model: 'state-fallback-model',
    };
    const timeAdvancePatch: StatePatch = {
      type: 'timeAdvance',
      payload: { minutesAdvanced: 15, reason: '核对军报', category: 'inspection' },
      reason: '核对军报耗时',
    };
    const eventPatch: StatePatch = {
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'recordTurnEvent',
          eventId: 'event_state_fallback_dispatch',
          locationId: 'loc_market_town',
          summary: '主角核对军报并记入案牍。',
          presentNpcIds: [],
          involvedNpcIds: [],
          visibility: '在场可知',
        },
      },
      reason: '记录本回合军报事件',
    };
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '你核对军报后，将此事记入案牍。',
          suggestedActions: [],
          statePatches: [timeAdvancePatch],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const primaryClient = {
      generate: vi.fn(async (request: LlmGenerateRequest) => {
        expect(request.timeoutMs).toBeLessThanOrEqual(120_000);
        expect(request.retryCount).toBe(0);
        throw new Error('primary state writeback unavailable');
      }),
    };
    const fallbackClient = {
      generate: vi.fn(async (request: LlmGenerateRequest) => {
        expect(request.config.model).toBe('state-fallback-model');
        expect(request.timeoutMs).toBeLessThanOrEqual(120_000);
        expect(request.retryCount).toBe(0);
        return {
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '',
            suggestedActions: [],
            statePatches: [timeAdvancePatch, eventPatch],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'state-fallback-model',
        };
      }),
    };

    const result = await executeTurn(worldBook, makeState(), '我核对军报', {
      apiConfig,
      stateWritebackApiConfig: primaryConfig,
      stateWritebackFallbackApiConfig: fallbackConfig,
      llmClient,
      stateWritebackLlmClient: primaryClient,
      stateWritebackFallbackLlmClient: fallbackClient,
    });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(primaryClient.generate).toHaveBeenCalledOnce();
    expect(fallbackClient.generate).toHaveBeenCalledOnce();
    expect(result.newRuntimeState.turnEvents).toEqual([
      expect.objectContaining({ eventId: 'event_state_fallback_dispatch' }),
    ]);
    expect(result.writeback?.debugNotes).toContain(
      '状态写回主要 API 失败，已切换备用 API：state-fallback-model',
    );
  });

  it('switches to the configured NPC completion fallback after the primary repair fails', async () => {
    const primaryConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_npc_primary_failure',
      model: 'npc-primary-model',
    };
    const fallbackConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_npc_fallback_success',
      model: 'npc-fallback-model',
    };
    const mainNarrative = '王经遣使入营，继而调集部曲逼近营门，已成为持续牵动局势的前线将领。';
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: mainNarrative,
          suggestedActions: [],
          statePatches: [{
            type: 'timeAdvance',
            payload: { minutesAdvanced: 15, reason: '敌将使者往来', category: 'conversation' },
            reason: '敌将使者往来耗时',
          }],
          statePatch: null,
          writeback: {
            npcProfileSuggestions: [makeRejectedWangJingProfile('npc_wang_jing_fallback')],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const primaryClient = {
      generate: vi.fn(async (request: LlmGenerateRequest) => {
        expect(request.timeoutMs).toBeLessThanOrEqual(120_000);
        expect(request.retryCount).toBe(0);
        throw new Error('primary NPC completion unavailable');
      }),
    };
    const fallbackClient = {
      generate: vi.fn(async (request: LlmGenerateRequest) => {
        expect(request.config.model).toBe('npc-fallback-model');
        expect(request.timeoutMs).toBeLessThanOrEqual(120_000);
        expect(request.retryCount).toBe(0);
        return {
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: mainNarrative,
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
            writeback: {
              npcProfileSuggestions: [{
                ...makeRejectedWangJingProfile('npc_wang_jing_fallback'),
                age: 46,
              }],
            },
          }),
          provider: 'openai_compatible' as const,
          model: 'npc-fallback-model',
        };
      }),
    };

    const result = await executeTurn(worldBook, makeState(), '我观察王经使者动向', {
      apiConfig,
      npcCompletionApiConfig: primaryConfig,
      npcCompletionFallbackApiConfig: fallbackConfig,
      llmClient,
      npcCompletionLlmClient: primaryClient,
      npcCompletionFallbackLlmClient: fallbackClient,
    });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(primaryClient.generate).toHaveBeenCalledOnce();
    expect(fallbackClient.generate).toHaveBeenCalledOnce();
    expect(result.newRuntimeState.npcs).toEqual(expect.arrayContaining([
      expect.objectContaining({ npcId: 'npc_wang_jing_fallback', name: '王经', age: 46 }),
    ]));
    expect(result.writeback?.debugNotes).toContain(
      'NPC建档主要 API 未完成，已切换备用 API：npc-fallback-model',
    );
  });

  it('archives a confirmed recruited NPC before applying relationship and troop dependencies when fallback loadout is invalid', async () => {
    const primaryConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_npc_weiyan_primary_failure',
      model: 'npc-primary-model',
    };
    const fallbackConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_npc_weiyan_fallback_success',
      model: 'npc-fallback-model',
    };
    const mainNarrative = '魏延接受招募，你当众任命他为左垒先锋将，并命军吏把他登记为新编先锋队主将。';
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: mainNarrative,
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 20, reason: '完成招募任命', category: 'administration' },
              reason: '招募和军中登记耗时',
            },
            {
              type: 'luanshiCommand',
              reason: '记录魏延已经接受招募后的关系变化',
              payload: {
                command: {
                  action: 'updateNpcRelationship',
                  npcId: 'npc_tk_weiyan',
                  contactDelta: 8,
                  relationToPlayer: '受主角正式任命的先锋将',
                  recentAttitude: '愿以军功证明自身',
                  summary: '魏延接受招募并领受先锋军职。',
                },
              },
            },
            {
              type: 'luanshiCommand',
              reason: '登记由魏延统领的新编先锋队',
              payload: {
                command: {
                  action: 'upsertTroopLedger',
                  troopId: 'troop_weiyan_vanguard',
                  name: '魏延先锋队',
                  size: 120,
                  morale: 68,
                  training: 62,
                  supplies: 60,
                  task: '担任左垒前锋',
                  relationToPlayer: '主角直接统属',
                  troopType: '步卒',
                  leaderNpcId: 'npc_tk_weiyan',
                  quality: '中',
                  fatigue: '低',
                  readiness: '中',
                  lifecycleStatus: 'active',
                  knownLevel: '亲历',
                  certainty: 'confirmed',
                  locationId: 'loc_market_town',
                  lastKnownLocationId: 'loc_market_town',
                  lastKnownAt: '乱世元年2月',
                  updatedAt: '乱世元年2月',
                },
              },
            },
          ],
          statePatch: null,
          writeback: {
            turnSummary: {
              brief: '魏延接受招募并被正式任命为左垒先锋将。',
              npcAdmissions: [{
                sourceRefId: 'npc-admission-weiyan-recruited',
                npcId: 'npc_tk_weiyan',
                name: '魏延',
                persistenceReason: 'player_committed_relationship',
                persistenceEvidence: '魏延已经接受招募并被正式任命为左垒先锋将。',
                summary: '魏延加入主角麾下，开始承担长期军职。',
              }],
            },
            npcProfileSuggestions: [],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const primaryClient = {
      generate: vi.fn(async () => {
        throw new Error('primary NPC completion unavailable');
      }),
    };
    const fallbackClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: mainNarrative,
          suggestedActions: [],
          statePatches: [],
          statePatch: null,
          writeback: {
            npcProfileSuggestions: [{
              npcId: 'npc_tk_weiyan',
              name: '魏延',
              persistenceReason: 'player_committed_relationship',
              persistenceEvidence: '魏延已经接受招募并被正式任命为左垒先锋将。',
              sex: '男',
              age: 31,
              role: '左垒先锋将',
              locationId: 'loc_market_town',
              isPresent: true,
              isFocused: true,
              currentIdentity: '主角麾下左垒先锋将',
              summary: '魏延接受招募并开始统领左垒先锋。',
              appearance: '身形雄健，佩一柄长刀。',
              personality: '桀骜果决，渴望凭军功立身。',
              motivation: '以战功证明自身并取得军中地位。',
              relationToPlayer: '受主角正式任命的先锋将',
              contactLevel: 8,
              recentAttitude: '愿以军功证明自身',
              abilityScores: { 武力: 94, 统率: 88, 智力: 70, 政治: 52, 魅力: 66, 机运: 61 },
              traits: [{
                id: 'trait_weiyan_bold',
                label: '勇烈敢战',
                description: '临阵敢于突入敌阵。',
                source: '本回合正式招募与历史身份',
              }],
              uniqueArts: [{
                id: 'art_weiyan_invalid_acquisition',
                name: '长刀破阵',
                rarity: 'orange',
                domain: 'personalCombat',
                level: 4,
                description: '挥长刀冲击敌阵。',
                effectSummary: '强化近战破阵。',
                source: '人物经历',
              }],
              equipment: [{
                id: 'eq_weiyan_invalid_quality',
                slot: 'weapon',
                name: '御赐长刀',
                quality: '御赐',
                description: '把来源标签误写成了品级。',
              }],
            }],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'npc-fallback-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), '我正式招募魏延为先锋将', {
      apiConfig,
      npcCompletionApiConfig: primaryConfig,
      npcCompletionFallbackApiConfig: fallbackConfig,
      llmClient,
      npcCompletionLlmClient: primaryClient,
      npcCompletionFallbackLlmClient: fallbackClient,
    });

    expect(primaryClient.generate).toHaveBeenCalledOnce();
    expect(fallbackClient.generate).toHaveBeenCalledOnce();
    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.npcs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        npcId: 'npc_tk_weiyan',
        name: '魏延',
        relationToPlayer: '受主角正式任命的先锋将',
      }),
    ]));
    expect(result.newRuntimeState.troops).toEqual(expect.arrayContaining([
      expect.objectContaining({
        troopId: 'troop_weiyan_vanguard',
        leaderNpcId: 'npc_tk_weiyan',
      }),
    ]));
    expect(result.writeback?.debugNotes?.join('\n')).toContain('NPC建档合规降级');
    expect(result.writeback?.debugNotes?.join('\n')).toContain('已保留人物基础档案');
    expect(result.writeback?.debugNotes).toContain(
      'NPC建档主要 API 未完成，已切换备用 API：npc-fallback-model',
    );
  });

  it('treats a valid empty NPC completion response as success without calling the fallback', async () => {
    const primaryConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_npc_primary_empty_success',
      model: 'npc-primary-empty-model',
    };
    const fallbackConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_npc_fallback_must_not_run',
      model: 'npc-fallback-unused-model',
    };
    const mainNarrative = '一个只来传一次口信的陌生斥候报完军情便离营，不再承担后续职责。';
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: mainNarrative,
          suggestedActions: [],
          statePatches: [{
            type: 'timeAdvance',
            payload: { minutesAdvanced: 5, reason: '听取临时军报', category: 'conversation' },
            reason: '听取军报耗时',
          }],
          statePatch: null,
          writeback: {
            npcProfileSuggestions: [{
              ...makeRejectedWangJingProfile('npc_one_turn_scout_empty'),
              name: '临时斥候',
              role: '一次性斥候',
              currentIdentity: '传递一次军报的陌生斥候',
            }],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const primaryClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: mainNarrative,
          suggestedActions: [],
          statePatches: [],
          statePatch: null,
          writeback: { npcProfileSuggestions: [] },
        }),
        provider: 'openai_compatible' as const,
        model: 'npc-primary-empty-model',
      })),
    };
    const fallbackClient = {
      generate: vi.fn(async () => {
        throw new Error('valid empty profile decision must not trigger fallback');
      }),
    };

    const result = await executeTurn(worldBook, makeState(), '我听取斥候口信', {
      apiConfig,
      npcCompletionApiConfig: primaryConfig,
      npcCompletionFallbackApiConfig: fallbackConfig,
      llmClient,
      npcCompletionLlmClient: primaryClient,
      npcCompletionFallbackLlmClient: fallbackClient,
    });

    expect(primaryClient.generate).toHaveBeenCalledOnce();
    expect(fallbackClient.generate).not.toHaveBeenCalled();
    expect(result.newRuntimeState.npcs?.some((npc) => npc.npcId === 'npc_one_turn_scout_empty')).toBe(false);
    expect(result.writeback?.debugNotes).toContain('NPC建档合规修复未返回可用人物志');
  });

  it('accepts a same-turn NPC profile before assigning that NPC as a troop officer', async () => {
    const peiShaoProfile = {
      ...makeRejectedWangJingProfile('npc_pei_shao_same_turn'),
      name: '裴绍',
      age: 33,
      role: '部曲将',
      factionName: '主角部曲',
      currentIdentity: '主角麾下部曲将',
      persistenceReason: 'player_committed_relationship',
      persistenceEvidence: '本回合主角已经正式任命裴绍统领新编部曲，形成持续军职。',
      summary: '裴绍受命统领新编部曲，后续继续承担军务。',
      relationToPlayer: '受主角任命的部曲将',
      abilityScores: { 武力: 72, 统率: 76, 智力: 58, 政治: 48, 魅力: 55, 机运: 50 },
      uniqueArts: [{
        id: 'art_pei_shao_missing_acquisition',
        name: '整军有法',
        rarity: 'blue',
        domain: 'warfare',
        level: 1,
        description: '善于约束新募部曲。',
        effectSummary: '整军时更易维持军纪。',
        source: '人物经历',
      }],
    } as NarratorNpcProfileSuggestion;
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '你当众任命裴绍统领新编部曲，军吏随即将任命与部队名册一并登记。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '任命并登记部曲', category: 'administration' },
              reason: '军中任命和登记耗时',
            },
            {
              type: 'luanshiCommand',
              reason: '登记本回合已正式组建并由裴绍统领的部曲',
              payload: {
                command: {
                  action: 'upsertTroopLedger',
                  troopId: 'troop_pei_shao_same_turn',
                  name: '裴绍部曲',
                  size: 180,
                  morale: 62,
                  training: 55,
                  supplies: 60,
                  task: '随主角驻守市镇',
                  relationToPlayer: '主角直接统属',
                  troopType: '步卒',
                  leaderNpcId: 'npc_pei_shao_same_turn',
                  quality: '中',
                  fatigue: '低',
                  readiness: '中',
                  lifecycleStatus: 'active',
                  knownLevel: '亲历',
                  certainty: 'confirmed',
                  locationId: 'loc_market_town',
                  lastKnownLocationId: 'loc_market_town',
                  lastKnownAt: '乱世元年2月',
                  updatedAt: '乱世元年2月',
                },
              },
            },
          ],
          statePatch: null,
          writeback: { npcProfileSuggestions: [peiShaoProfile] },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), '我任命裴绍统领新编部曲', {
      apiConfig,
      llmClient,
    });

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.npcs).toEqual(expect.arrayContaining([
      expect.objectContaining({ npcId: 'npc_pei_shao_same_turn', name: '裴绍' }),
    ]));
    expect(result.newRuntimeState.troops).toEqual(expect.arrayContaining([
      expect.objectContaining({
        troopId: 'troop_pei_shao_same_turn',
        leaderNpcId: 'npc_pei_shao_same_turn',
      }),
    ]));
    expect(result.writeback?.debugNotes).toEqual(expect.arrayContaining([
      expect.stringContaining('NPC稳定绝艺已本地补全：裴绍'),
    ]));
  });

  it('applies timeAdvance from multi-patch LLM responses alongside other state writes', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '你在城门前等待盘查，半个时辰后才得入城。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 30, reason: '等待盘查', category: 'conversation' },
              reason: '城门盘查耗费时间',
            },
            {
              type: 'localSituationChanged',
              payload: { notes: ['城门盘查趋严'] },
              reason: '玩家观察到城门戒备变化',
            },
          ],
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const state = {
      ...makeState(),
      startDate: '公元189年09月01日 08:00（辰时）',
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: {
        year: 189,
        month: 9,
        day: 1,
        hour: 8,
        minute: 0,
      },
    };

    const result = await executeTurn(worldBook, state, '我等待城门盘查', { apiConfig, llmClient });

    expect(result.newRuntimeState.currentDate).toBe('公元189年09月01日 08:30（辰时）');
    expect(result.newRuntimeState.localSituationNotes).toContain('城门盘查趋严');
    expect(result.newRuntimeState.turnLog).toHaveLength(1);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('timeAdvance');
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('localSituationChanged');
  });

  it('rolls back valid timeAdvance when the same batch contains an unsupported patch type', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '你在营门前与老卒周旋，约莫一个半时辰后才等来通报。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 90, reason: '营门等待与交涉', category: 'waiting' },
              reason: '玩家在营门等待通报，时间自然推进。',
            },
            {
              type: 'unsupportedLegacyEvent',
              payload: {
                locationId: 'loc_market_town',
                summary: '玩家在营门等待通报。',
                presentNpcIds: [],
                visibility: '公开',
              },
              reason: '模型误用了未知旧式事件写入类型。',
            },
          ],
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const state = {
      ...makeState(),
      startDate: '公元189年09月01日 08:00（辰时）',
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: {
        year: 189,
        month: 9,
        day: 1,
        hour: 8,
        minute: 0,
      },
    };

    const result = await executeTurn(worldBook, state, '我在营门前等待通报', { apiConfig, llmClient });

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.newRuntimeState.currentDate).toBe('公元189年09月01日 08:00（辰时）');
    expect(result.newRuntimeState.turnLog[0].date).toBe('公元189年09月01日 08:00（辰时）');
    expect(result.newRuntimeState.turnLog[0].fullNarrativeText).toBe('你在营门前与老卒周旋，约莫一个半时辰后才等来通报。');
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('状态变更校验失败');
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('unsupportedLegacyEvent');
  });

  it('ignores empty optional luanshiCommand shells from LLM state patches', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '你在营门前重新确认身份，军中照旧放行。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '营门通行', category: 'conversation' },
              reason: '营门通行耗时',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'updateCharacterIdentity',
                  characterId: 'player',
                  characterType: 'player',
                },
              },
              reason: '模型误输出了空身份更新壳。',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'updatePlayerLoadout',
                  characterId: 'player',
                },
              },
              reason: '模型误输出了空行装更新壳。',
            },
          ],
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const state = {
      ...makeState(),
      startDate: '公元189年09月01日 08:00（辰时）',
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: {
        year: 189,
        month: 9,
        day: 1,
        hour: 8,
        minute: 0,
      },
    };

    const result = await executeTurn(worldBook, state, '我向营门军士出示身份', { apiConfig, llmClient });

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.patchValidation?.errors).toEqual([]);
    expect(result.statePatches).toHaveLength(1);
    expect(result.statePatches?.[0].type).toBe('timeAdvance');
    expect(result.newRuntimeState.currentDate).toBe('公元189年09月01日 08:15（辰时）');
  });

  it('filters unknown NPC ids from LLM recordTurnEvent luanshiCommand patches before validation', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '门候在场听见你的问话，旁人只是远远张望。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '问话', category: 'conversation' },
              reason: '问话耗时',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'recordTurnEvent',
                  locationId: 'loc_market_town',
                  summary: '主角在营门前向门候问话。',
                  presentNpcIds: ['npc_gate_guard', 'npc_model_temp_guard'],
                  involvedNpcIds: ['npc_gate_guard', 'npc_unknown_bystander'],
                  visibility: 'in_presence',
                },
              },
              reason: '记录本回合在场事件。',
            },
          ],
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const state = {
      ...makeState(),
      startDate: '公元189年09月01日 08:00（辰时）',
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: {
        year: 189,
        month: 9,
        day: 1,
        hour: 8,
        minute: 0,
      },
    };

    const result = await executeTurn(worldBook, state, '我向门候问话', { apiConfig, llmClient });

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.patchValidation?.errors).toEqual([]);
    expect(result.newRuntimeState.turnEvents).toHaveLength(1);
    expect(result.newRuntimeState.turnEvents?.[0].presentNpcIds).toEqual(['npc_gate_guard']);
    expect(result.newRuntimeState.turnEvents?.[0].involvedNpcIds).toEqual(['npc_gate_guard']);
    expect(result.newRuntimeState.turnEvents?.[0].visibility).toBe('在场可知');
  });

  it('defaults missing recordTurnEvent presentNpcIds to an empty list before validation', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '你独自在营门前整理听来的消息。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '整理消息', category: 'reflection' },
              reason: '整理消息耗时',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'recordTurnEvent',
                  locationId: 'loc_market_town',
                  summary: '主角独自在营门前整理消息。',
                  visibility: 'private',
                },
              },
              reason: '记录没有 NPC 在场的回合事件。',
            },
          ],
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), '我独自整理消息', { apiConfig, llmClient });

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.patchValidation?.errors).toEqual([]);
    expect(result.newRuntimeState.turnEvents).toHaveLength(1);
    expect(result.newRuntimeState.turnEvents?.[0].presentNpcIds).toEqual([]);
    expect(result.newRuntimeState.turnEvents?.[0].involvedNpcIds).toEqual([]);
  });

  it('canonicalizes player unique art writeback IDs before command validation', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '你在营门前凭旧日军旅经验稳住了心神。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '整队', category: 'inspection' },
              reason: '整队耗时',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'updateCharacterUniqueArts',
                  characterType: 'player',
                  characterId: 'player_liu_gou',
                  characterName: '刘构',
                  uniqueArts: [
                    {
                      id: 'art_gate_discipline',
                      name: '营门整肃',
                      rarity: 'green',
                      domain: 'warfare',
                      level: 1,
                      maxLevel: 10,
                      progress: 0,
                      description: '在兵荒马乱中维持小股军士秩序的本事。',
                      effectSummary: '有助于临场整队、约束散兵和稳住军心。',
                      source: 'turn',
                      acquisition: {
                        kind: 'achievement',
                        occurredAt: '公元189年09月01日 08:15（辰时）',
                        sourceRefId: 'turn:gate-discipline-confirmed',
                        summary: '本回合实际完成营门整肃，确认该长期能力。',
                      },
                    },
                  ],
                  summary: '本回合确认主角的军旅整队本事。',
                  updatedAt: '公元189年09月01日 08:15（辰时）',
                  source: 'turn',
                },
              },
              reason: '更新主角绝艺。',
            },
          ],
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), '我整顿营门军士', { apiConfig, llmClient });

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.patchValidation?.errors).toEqual([]);
    expect(result.newRuntimeState.player.uniqueArts?.[0]).toMatchObject({
      id: 'art_gate_discipline',
      name: '营门整肃',
    });
  });

  it('applies NPC unique arts from profile writeback suggestions', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '老斥候在营外听风辨蹄，提前察觉远处有骑队绕行。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 20, reason: '斥候探查', category: 'inspection' },
              reason: '斥候探查耗时',
            },
          ],
          statePatch: null,
          writeback: {
            npcProfileSuggestions: [
              {
                npcId: 'npc_old_scout',
                name: '老斥候',
                persistenceReason: 'active_system_role',
                persistenceEvidence: '本回合确认其作为随军斥候持续为主角承担营外侦察职责。',
                sex: '男',
                age: 52,
                role: '随军斥候',
                factionName: '颍川郡府',
                locationId: 'loc_market_town',
                isPresent: true,
                isFocused: true,
                currentIdentity: '随军老斥候',
                summary: '久历行伍的老斥候，本回合协助主角探查营外动静。',
                appearance: '衣甲旧而利落，耳目极灵。',
                personality: '沉默谨慎，遇事先看风向。',
                motivation: '保住同袍性命。',
                relationToPlayer: '听命于主角，正在建立信任。',
                contactLevel: 12,
                recentAttitude: '谨慎服从',
                abilityScores: { 武力: 58, 统率: 40, 智力: 63, 政治: 20, 魅力: 34, 机运: 55 },
                traits: [
                  {
                    id: 'trait_old_scout',
                    label: '老于行伍',
                    description: '熟悉军中巡哨和伏击征兆。',
                    source: 'identity',
                    rarity: 'green',
                  },
                ],
                uniqueArts: [
                  {
                    id: 'art_listen_hoof',
                    name: '听蹄辨远',
                    rarity: 'blue',
                    domain: 'survival',
                    level: 2,
                    maxLevel: 5,
                    progress: 30,
                    description: '能凭马蹄、车辙和风声辨别远近动静。',
                    effectSummary: '侦察、伏击预警和夜间行军时更易先察敌踪。',
                    source: 'background',
                    acquisition: {
                      kind: 'background',
                      occurredAt: '公元184年03月01日',
                      sourceRefId: 'npc-profile:npc_old_scout:background',
                      summary: '多年行伍与斥候经历形成的稳定听辨能力，本回合首次归档。',
                    },
                    promptHint: '侦察、伏击预警或夜行时体现其听辨经验。',
                    checkHooks: [{ scope: '侦察', modifier: 6, note: '凭声辨敌踪。' }],
                    tags: ['斥候', '预警'],
                  },
                ],
              },
            ],
            npcMemorySuggestions: [],
            locationWriteSuggestions: [],
            routeWriteSuggestions: [],
            questChanges: [],
            debugNotes: [],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), '让老斥候去营外听探动静', { apiConfig, llmClient });

    expect(result.newRuntimeState.npcs?.find((npc) => npc.npcId === 'npc_old_scout')?.uniqueArts?.[0]).toMatchObject({
      id: 'art_listen_hoof',
      name: '听蹄辨远',
      domain: 'survival',
      level: 2,
    });
  });

  it('returns parsed writeback protocol data for diagnostics and later state writers', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '你在门前问出一条消息。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '询问门吏', category: 'conversation' },
              reason: '短暂交谈耗时',
            },
          ],
          writeback: {
            protagonistMemory: {
              recentTurnSummary: '主角向门吏问出城中戒严消息。',
            },
            npcMemorySuggestions: [
              {
                npcId: 'npc_gate_guard',
                npcName: '门吏',
                source: '亲历',
                content: '主角追问戒严缘由。',
              },
            ],
            locationWriteSuggestions: [],
            questChanges: [
              {
                action: 'update',
                questId: 'quest_opening_thread',
                summary: '城中戒严成为新线索。',
              },
            ],
            worldEventSummary: {
              summary: '城中戒严消息被主角确认。',
              visibility: '私密',
              locationId: 'loc_market_town',
              presentNpcIds: [],
            },
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), '我询问门吏', { apiConfig, llmClient });

    expect(result.writeback?.protagonistMemory?.recentTurnSummary).toContain('城中戒严');
    expect(result.writeback?.npcMemorySuggestions[0]).toMatchObject({
      npcId: 'npc_gate_guard',
      npcName: '门吏',
    });
    expect(result.writeback?.questChanges[0]).toMatchObject({
      action: 'update',
      questId: 'quest_opening_thread',
    });
    expect(result.writeback?.worldEventSummary?.summary).toContain('戒严');
  });

  it('applies valid narrator writeback into protagonist memory, NPC memory, and turn events', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '你向门候问起城中戒严，门候压低声音提醒你不要久留。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: '询问门候', category: 'conversation' },
              reason: '短暂交谈耗时',
            },
          ],
          statePatch: null,
          writeback: {
            protagonistMemory: {
              recentTurnSummary: '主角向门候询问城中戒严，并得到不要久留的提醒。',
              keyDeed: {
                summary: '主角主动打探戒严缘由。',
                impact: '门候知道主角对城中局势有兴趣。',
              },
            },
            npcMemorySuggestions: [
              {
                npcId: 'npc_gate_guard',
                npcName: '门候',
                source: '亲历',
                content: '主角向他打探城中戒严缘由。',
              },
            ],
            worldEventSummary: {
              summary: '主角在市镇门前向门候询问戒严消息。',
              visibility: '在场可知',
              locationId: 'loc_market_town',
              presentNpcIds: ['npc_gate_guard'],
              involvedNpcIds: ['npc_gate_guard'],
            },
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), '我向门候打听城中戒严的缘由', { apiConfig, llmClient });
    const playerMemory = result.newRuntimeState.player.playerMemory;
    const gateGuard = result.newRuntimeState.npcs?.find((npc) => npc.npcId === 'npc_gate_guard');

    expect(playerMemory?.recentTurns).toContain('主角向门候询问城中戒严，并得到不要久留的提醒。');
    expect(playerMemory?.keyDeeds[0]).toMatchObject({
      summary: '主角主动打探戒严缘由。',
      impact: '门候知道主角对城中局势有兴趣。',
      locationId: 'loc_market_town',
    });
    expect(gateGuard?.memories[0]).toMatchObject({
      source: '亲历',
      content: '主角向他打探城中戒严缘由。',
    });
    expect(result.newRuntimeState.turnEvents?.[0]).toMatchObject({
      locationId: 'loc_market_town',
      summary: '主角在市镇门前向门候询问戒严消息。',
      presentNpcIds: ['npc_gate_guard'],
      visibility: '在场可知',
    });
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('writeback');
  });

  it('applies new adult female NPC profile suggestions into the archive during normal turns', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '一名重要女性 NPC 在本回合正式进入局面。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 20, reason: '交谈与建档', category: 'conversation' },
              reason: '本回合交谈推进了时间',
            },
          ],
          statePatch: null,
          writeback: {
            npcProfileSuggestions: [
              {
                npcId: 'npc_turn_woman',
                name: '某氏',
                persistenceReason: 'strategic_actor',
                persistenceEvidence: '本回合确认她是能够持续影响地方家族关系与后续局势的关键人物。',
                sex: '女',
                age: 33,
                role: '本回合重要女性 NPC',
                factionName: '地方势力',
                locationId: 'loc_market_town',
                isPresent: true,
                isFocused: true,
                currentIdentity: '地方士族女性',
                summary: '本回合因剧情需要正式建档的成年女性角色。',
                appearance: '衣饰端整，气度沉稳。',
                personality: '谨慎克制，但能在危局中作决定。',
                motivation: '保护家人与自身处境。',
                relationToPlayer: '初见，正观察主角是否可信。',
                contactLevel: 5,
                recentAttitude: '谨慎',
                abilityScores: { 武力: 18, 统率: 24, 智力: 58, 政治: 62, 魅力: 71, 机运: 46 },
                traits: [
                  {
                    id: 'trait_turn_anchor',
                    label: '局中关键人',
                    description: '她的处境会影响后续地方局势与人物关系。',
                    source: 'event',
                    rarity: 'blue',
                  },
                ],
                femaleProfile: {
                  birthday: '八月初三',
                  addressToPlayer: '郎君',
                  appearanceDescription: '稳定外貌锚点，用于后续正文和文生图。',
                  bodyDescription: '稳定身材锚点，用于后续正文和文生图。',
                  clothingStyle: '稳定衣着锚点，用于后续正文和文生图。',
                  personalityCore: '谨慎克制，但在压力下仍能判断利害。',
                  affectionProgressionCondition: '需要长期守信与实际保护。',
                  relationshipProgressionCondition: '需要兑现承诺并承担代价。',
                  relationshipNetwork: [
                    { targetName: '主角', relationship: '危局中的观察对象', notes: '尚未完全信任。' },
                    { targetName: '家族', relationship: '必须保护的牵挂' },
                  ],
                  adultPrivateProfile: {
                    enabled: true,
                    ageConfirmedAdult: true,
                    summary: '成年女性长期私密档案摘要。',
                    breastDescription: '胸部形态的长期稳定身体锚点。',
                    vaginaDescription: '小穴形态的长期稳定身体锚点。',
                    anusDescription: '屁穴形态的长期稳定身体锚点。',
                    preferenceNotes: '长期偏好记录。',
                    boundaryNotes: '长期边界记录。',
                    relationshipRiskNotes: '关系暴露会带来现实风险。',
                  },
                },
              },
            ],
            npcMemorySuggestions: [],
            locationWriteSuggestions: [],
            routeWriteSuggestions: [],
            questChanges: [],
            worldEventSummary: null,
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), '我与新出现的女性 NPC 交谈', { apiConfig, llmClient });
    const npc = result.newRuntimeState.npcs?.find((item) => item.npcId === 'npc_turn_woman');
    const panel = buildNpcPanelModel(result.newRuntimeState, { selectedNpcId: 'npc_turn_woman' });

    expect(npc).toMatchObject({
      name: '某氏',
      age: 33,
      isPresent: true,
      currentIdentity: '地方士族女性',
    });
    expect(npc?.femaleProfile?.appearanceDescription).toContain('稳定外貌锚点');
    expect(npc?.femaleProfile?.relationshipNetwork).toHaveLength(2);
    expect(npc?.femaleProfile?.adultPrivateProfile?.relationshipRiskNotes).toContain('现实风险');
    expect(panel.selectedCard?.id).toBe('npc_turn_woman');
    expect(panel.selectedCard?.femaleProfile?.sections.map((section) => section.kind)).toContain('appearanceAnchor');
    expect(panel.selectedCard?.femaleProfile?.adultPrivateSections.map((section) => section.kind)).toContain('privateAnchor');
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('NPC档案x1');
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('女性档案x1');
  });

  it('ignores invalid writeback NPC memories instead of bypassing command validation', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '你在门前低声问话，消息并未传到远行书生耳中。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 10, reason: '低声问话', category: 'conversation' },
              reason: '低声交谈耗时',
            },
          ],
          statePatch: null,
          writeback: {
            protagonistMemory: {
              recentTurnSummary: '主角在门前低声打探消息。',
            },
            npcMemorySuggestions: [
              {
                npcId: 'npc_absent_scholar',
                npcName: '远行书生',
                source: '亲历',
                content: '主角在门前打探消息。',
              },
            ],
            worldEventSummary: {
              summary: '主角在门前低声打探消息。',
              visibility: '私密',
              locationId: 'loc_market_town',
              presentNpcIds: [],
              involvedNpcIds: [],
            },
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), '我低声打探消息', { apiConfig, llmClient });
    const absentScholar = result.newRuntimeState.npcs?.find((npc) => npc.npcId === 'npc_absent_scholar');

    expect(absentScholar?.memories).toHaveLength(0);
    expect(result.newRuntimeState.player.playerMemory?.recentTurns).toContain('主角在门前低声打探消息。');
    expect(result.newRuntimeState.turnEvents?.[0]?.summary).toBe('主角在门前低声打探消息。');
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('已忽略无效写回建议');
  });

  it('runs memory summary compression after a turn when recent memory exceeds the threshold', async () => {
    const state = makeState();
    const compressionState = {
      ...state,
      turnLog: Array.from({ length: 35 }, (_, index) => ({
        turnNumber: index + 1,
        date: `day ${index + 1}`,
        playerInput: `player action ${index + 1}`,
        narrativeText: `short narrative ${index + 1}`,
        fullNarrativeText: `full narrative ${index + 1}`,
        statePatchSummary: 'none',
        timestamp: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      })),
      memoryArchive: {
        ...state.memoryArchive!,
        recentTurnSummaries: Array.from({ length: 35 }, (_, index) => ({
          id: `recent_${index + 1}`,
          turnNumber: index + 1,
          createdAt: `day ${index + 1}`,
          brief: `brief ${index + 1}`,
          importance: 'medium' as const,
        })),
      },
    } as RuntimeState;
    const memorySummaryApiConfig: ApiConfigArchive = {
      ...apiConfig,
      id: 'api_memory',
      name: '记忆摘要 API',
      model: 'memory-model',
    };
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '你与门候交谈后离开城门。',
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 15, reason: '交谈', category: 'conversation' },
                reason: '交谈耗时',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            midTermSummaries: [
              {
                summaryId: 'mid_gate_after_turn',
                title: '城门阶段摘要',
                fromCreatedAt: 'day 1',
                toCreatedAt: 'day 24',
                summary: '主角在城门附近连续打探消息并形成阶段性线索。',
                relatedNpcIds: ['npc_gate_guard'],
                relatedLocationIds: ['loc_market_town'],
                updatedAt: 'day 35',
              },
            ],
            longTermFacts: [
              {
                factId: 'fact_gate_thread',
                category: 'consequence',
                createdAt: 'day 35',
                summary: '城门戒严线索成为后续长期承接事实。',
                importance: 'high',
                relatedLocationIds: ['loc_market_town'],
              },
            ],
            npcInteractionSummaries: [
              {
                npcId: 'npc_gate_guard',
                npcName: '门候',
                summary: '门候记得主角多次打探城门戒严。',
                updatedAt: 'day 35',
              },
            ],
            locationMemorySummaries: [
              {
                locationId: 'loc_market_town',
                locationName: '市镇',
                summary: '市镇城门长期处于戒严压力下。',
                updatedAt: 'day 35',
              },
            ],
          }),
          provider: 'openai_compatible' as const,
          model: 'memory-model',
        }),
    };

    const result = await executeTurn(worldBook, compressionState, '我继续向门候打听', {
      apiConfig,
      memorySummaryApiConfig,
      llmClient,
      memorySummaryLlmClient: llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    const memoryRequest = llmClient.generate.mock.calls[1]?.[0] as LlmGenerateRequest;
    expect(memoryRequest.config?.model).toBe('memory-model');
    expectRequestTimeoutAtConfiguredCap(
      memoryRequest.timeoutMs,
      TURN_LLM_BUDGET_DEFAULTS.singleAuxiliaryRequestMs,
    );
    expect(result.memorySummary?.status).toBe('applied');
    expect(result.newRuntimeState.memoryArchive?.midTermSummaries[0].summary).toContain('阶段性线索');
    expect(result.newRuntimeState.memoryArchive?.longTermFacts[0].factId).toBe('fact_gate_thread');
    expect(result.newRuntimeState.memoryArchive?.npcInteractionSummaries[0].npcId).toBe('npc_gate_guard');
    expect(result.newRuntimeState.memoryArchive?.locationMemorySummaries[0].locationId).toBe('loc_market_town');
    expect(result.newRuntimeState.memoryArchive?.recentTurnSummaries).toHaveLength(15);
    expect(result.newRuntimeState.turnLog).toHaveLength(36);
    expect(result.newRuntimeState.turnLog[35].statePatchSummary).toContain('memorySummary');

    const deferredMemoryClient = { generate: vi.fn() };
    const deferredNarrativeClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '你与门候交谈后离开城门。',
          suggestedActions: [],
          statePatches: [{
            type: 'timeAdvance',
            payload: { minutesAdvanced: 15, reason: '交谈', category: 'conversation' },
            reason: '交谈耗时',
          }],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const deferred = await executeTurn(worldBook, compressionState, '我稍后自行整理记忆', {
      apiConfig,
      memorySummaryApiConfig,
      llmClient: deferredNarrativeClient,
      memorySummaryLlmClient: deferredMemoryClient,
      deferMemorySummaryCompression: true,
    });

    expect(deferredMemoryClient.generate).not.toHaveBeenCalled();
    expect(deferred.memorySummary).toBeUndefined();
    expect(deferred.newRuntimeState.memoryArchive?.recentTurnSummaries.length).toBeGreaterThanOrEqual(35);
  });

  it('commits the generated turn and records a soft memory failure when post-narrative maintenance time is exhausted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const state = makeState();
      const compressionState = {
        ...state,
        turnLog: Array.from({ length: 35 }, (_, index) => ({
          turnNumber: index + 1,
          date: `day ${index + 1}`,
          playerInput: `player action ${index + 1}`,
          narrativeText: `short narrative ${index + 1}`,
          fullNarrativeText: `full narrative ${index + 1}`,
          statePatchSummary: 'none',
          timestamp: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        })),
        memoryArchive: {
          ...state.memoryArchive!,
          recentTurnSummaries: Array.from({ length: 35 }, (_, index) => ({
            id: `recent_budget_${index + 1}`,
            turnNumber: index + 1,
            createdAt: `day ${index + 1}`,
            brief: `brief ${index + 1}`,
            importance: 'medium' as const,
          })),
        },
      } as RuntimeState;
      const memorySummaryApiConfig: ApiConfigArchive = {
        ...apiConfig,
        id: 'api_memory_post_budget',
        name: '记忆摘要 API',
        model: 'memory-model',
      };
      const turnResponse = {
        protocolVersion: 'lsfy.turn.v1',
        narrativeText: '你与门候交谈后离开城门。',
        suggestedActions: [],
        statePatches: [
          {
            type: 'timeAdvance',
            payload: { minutesAdvanced: 15, reason: '交谈', category: 'conversation' },
            reason: '交谈耗时',
          },
        ],
        statePatch: null,
        writeback: {
          npcProfileSuggestions: [],
          npcMemorySuggestions: [],
          locationWriteSuggestions: [],
          routeWriteSuggestions: [],
          questChanges: [],
          debugNotes: [],
        },
      };
      const llmClient = {
        generate: vi.fn(async () => ({
          content: JSON.stringify(turnResponse),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })),
      };
      const stateWritebackLlmClient = {
        generate: vi.fn(async () => {
          vi.setSystemTime(481_000);
          return {
            content: JSON.stringify(turnResponse),
            provider: 'openai_compatible' as const,
            model: 'test-model',
          };
        }),
      };
      const memorySummaryLlmClient = {
        generate: vi.fn(async () => ({
          content: JSON.stringify({ midTermSummaries: [], longTermFacts: [] }),
          provider: 'openai_compatible' as const,
          model: 'memory-model',
        })),
      };

      const result = await executeTurn(worldBook, compressionState, '我继续向门候打听', {
        apiConfig,
        stateWritebackApiConfig: apiConfig,
        memorySummaryApiConfig,
        llmClient,
        stateWritebackLlmClient,
        memorySummaryLlmClient,
      });

      expect(result.narrativeText).toBe('你与门候交谈后离开城门。');
      expect(result.newRuntimeState.turnLog).toHaveLength(36);
      expect(result.memorySummary?.status).toBe('failed');
      expect(result.memorySummary?.reason).toContain('postNarrative');
      expect(memorySummaryLlmClient.generate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies due September holding settlement locally after the main turn', async () => {
    const settlementState = {
      ...makeState(),
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      calendarEras: [
        {
          eraId: 'han_zhongping',
          eraName: '中平',
          startYear: 184,
          startMonth: 1,
          startDay: 1,
        },
      ],
      resources: {
        money: 100,
        grain: 1000,
        horses: 20,
        arms: 10,
        recruits: 30,
        weapons: [],
        documents: [],
        tokens: [],
        importantSupplies: [],
      },
      holdings: [
        {
          holdingId: 'holding_yingchuan',
          name: '颍川郡',
          type: 'commandery',
          status: 'controlled',
          summary: '主角控制的郡县，用于年度结算。',
          scaleLevel: 3,
          agriculture: 80,
          commerce: 60,
          population: 70,
          publicOrder: 65,
          popularSupport: 60,
          defense: 55,
          recruitPotential: 70,
          armory: 45,
          horseSupply: 30,
          corruption: 20,
          localTreasury: 40,
          localGranary: 1200,
          updatedAt: '189-08-30',
        },
      ],
      privateAssets: [
        {
          privateAssetId: 'asset_liu_estate',
          name: '刘氏庄园',
          type: 'estate',
          ownerScope: 'personal',
          status: 'active',
          summary: '主角家族的庄园。',
          locationDescription: '颍川城外',
          mu: 120,
          households: 18,
          workers: 12,
          workshopScale: 1,
          ranchCapacity: 20,
          updatedAt: '189-08-30',
        },
      ],
      privateAssetProjects: [
        {
          projectId: 'project_expand_estate',
          assetId: 'asset_liu_estate',
          title: '扩建刘氏庄园田亩',
          type: 'expand_farmland',
          status: 'active',
          startedAt: '189-03-01',
          expectedCompleteAt: '189-08-01',
          investedMoney: 12,
          investedGrain: 80,
          targetDelta: { mu: 40, households: 6 },
          updatedAt: '189-03-01',
        },
      ],
      troops: [
        {
          troopId: 'troop_player_cavalry',
          name: '玩家骑兵',
          size: 100,
          factionId: 'faction_player',
          troopType: '骑兵',
          quality: '高',
          lifecycleStatus: 'active',
          morale: 70,
          training: 65,
          supplies: 'stable',
          task: '驻守',
          relationToPlayer: 'self',
        },
      ],
      domesticReports: [],
    } satisfies RuntimeState;
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '秋税将至，郡府吏员递上账簿，你先按下不表，仍去校阅营中军士。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 30, reason: '校阅军士', category: 'inspection' },
              reason: '校阅耗时半个时辰',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, settlementState, '我先校阅军士', {
      apiConfig,
      llmClient,
    });

    const calls = llmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    const request = calls[0][0];
    const promptText = request.messages.map((message) => message.content).join('\n');
    const latestTurnLog = result.newRuntimeState.turnLog[result.newRuntimeState.turnLog.length - 1];
    expect(promptText).toContain('年度结算待处理');
    expect(promptText).toContain('system:holding-annual:189');
    expect(result.newRuntimeState.domesticReports).toContainEqual(expect.objectContaining({
      reportId: 'system:holding-annual:189',
      year: 189,
      source: 'system',
      kind: 'holdingAnnualSettlement',
    }));
    expect(result.newRuntimeState.privateAssetProjects?.[0].status).toBe('completed');
    expect(result.newRuntimeState.privateAssets?.[0].mu).toBe(160);
    expect(result.newRuntimeState.holdings?.[0].corruption).toBe(23);
    expect(result.newRuntimeState.resources?.grain).not.toBe(1000);
    expect(latestTurnLog?.statePatchSummary).toContain('年度结算[system:holding-annual:189]');
    expect(result.turnDisplayMeta.holdingAnnualSettlement?.status).toBe('applied');
    expect(latestTurnLog?.displayMeta?.holdingAnnualSettlement?.status).toBe('applied');
  });

  it('normalizes duplicate canonical annual reports through the real turn pipeline', async () => {
    const canonicalReport = {
      reportId: 'system:holding-annual:189',
      source: 'system' as const,
      kind: 'holdingAnnualSettlement',
      year: 189,
      settledAt: '189-09-01 08:00',
      title: '189年内政收支',
      summary: 'Canonical imported settlement.',
      income: { money: 6, grain: 0, horses: 0, arms: 0, recruits: 0 },
      expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 6, grain: 0, horses: 0, arms: 0, recruits: 0 },
      readByPlayer: true,
    };
    const exactDuplicate = structuredClone(canonicalReport);
    const divergentDuplicate = {
      ...canonicalReport,
      title: 'Imported divergent annual report',
      summary: 'Preserve this divergent content.',
    };
    const state = {
      ...makeState(),
      currentDate: '189-09-15',
      currentTime: { year: 189, month: 9, day: 15, hour: 8, minute: 0 },
      resources: {
        money: 100,
        grain: 1000,
        horses: 20,
        arms: 10,
        recruits: 30,
        weapons: [],
        documents: [],
        tokens: [],
        importantSupplies: [],
      },
      domesticReports: [canonicalReport, exactDuplicate, divergentDuplicate],
    } satisfies RuntimeState;
    const makeClient = () => ({
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '你核对已经结清的旧账。',
          suggestedActions: [],
          statePatches: [{
            type: 'timeAdvance',
            payload: { minutesAdvanced: 5, reason: '核对旧账' },
            reason: '核对耗时',
          }],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    });

    const first = await executeTurn(worldBook, state, '核对旧账', { apiConfig, llmClient: makeClient() });
    const second = await executeTurn(worldBook, first.newRuntimeState, '再次核对', {
      apiConfig,
      llmClient: makeClient(),
    });
    const firstIds = (first.newRuntimeState.domesticReports ?? []).map((report) => report.reportId);

    expect(first.turnDisplayMeta.holdingAnnualSettlement).toBeUndefined();
    expect(first.newRuntimeState.domesticReports).toEqual([
      canonicalReport,
      {
        ...divergentDuplicate,
        reportId: 'legacy-conflict:system:holding-annual:189:year-189:1',
      },
    ]);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    expect(second.newRuntimeState.domesticReports).toEqual(first.newRuntimeState.domesticReports);
  });

  it('matches a 360-day jump to twelve monthly turns in settlement order and outcomes', async () => {
    const initialState = {
      ...makeState(),
      startDate: '189-01-01',
      currentDate: '189-01-01',
      currentTime: { year: 189, month: 1, day: 1, hour: 8, minute: 0 },
      resources: {
        money: 0,
        grain: 0,
        horses: 0,
        arms: 0,
        recruits: 0,
        weapons: [],
        documents: [],
        tokens: [],
        importantSupplies: [],
      },
      holdings: [{
        holdingId: 'holding_long_jump',
        name: 'Long-jump commandery',
        type: 'commandery' as const,
        status: 'controlled' as const,
        summary: 'A holding whose autumn income must not fund earlier upkeep.',
        scaleLevel: 3 as const,
        agriculture: 80,
        commerce: 60,
        population: 70,
        publicOrder: 65,
        popularSupport: 60,
        defense: 55,
        recruitPotential: 70,
        armory: 45,
        horseSupply: 30,
        corruption: 20,
        localTreasury: 40,
        localGranary: 1200,
        updatedAt: '189-01-01',
      }],
      troops: [{
        troopId: 'troop_long_jump',
        name: 'Long-jump infantry',
        size: 100,
        factionId: 'faction_player',
        troopType: '步卒',
        quality: '中',
        lifecycleStatus: 'active' as const,
        morale: 70,
        training: 65,
        supplies: 80,
        task: '驻守',
        relationToPlayer: 'self',
        upkeepSource: 'player_resources' as const,
      }],
      privateAssets: [],
      privateAssetProjects: [],
      domesticReports: [],
    } satisfies RuntimeState;
    const advance = async (state: RuntimeState, daysAdvanced: number): Promise<RuntimeState> => {
      const llmClient = {
        generate: vi.fn(async () => ({
          content: JSON.stringify({
            narrativeText: `时间推进${daysAdvanced}日。`,
            suggestedActions: [],
            statePatches: [{
              type: 'timeAdvance',
              payload: { daysAdvanced, reason: '长期等待', category: 'waiting' },
              reason: '等待时间推进',
            }],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })),
      };
      const result = await executeTurn(worldBook, state, `等待${daysAdvanced}日`, { apiConfig, llmClient });
      expect(result.patchValidation?.valid).toBe(true);
      return result.newRuntimeState;
    };

    const longJump = await advance(initialState, 360);
    let monthly: RuntimeState = initialState;
    for (let index = 0; index < 12; index += 1) {
      monthly = await advance(monthly, 30);
    }

    expect(longJump.currentTime).toEqual(monthly.currentTime);
    expect(longJump.resources).toEqual(monthly.resources);
    expect(longJump.troops).toEqual(monthly.troops);
    expect(longJump.domesticReports).toEqual(monthly.domesticReports);
  });

  it('does not trigger September holding settlement when only troop upkeep exists', async () => {
    const troopOnlyState = {
      ...makeState(),
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      resources: {
        money: 100,
        grain: 1000,
        horses: 20,
        arms: 10,
        recruits: 30,
        weapons: [],
        documents: [],
        tokens: [],
        importantSupplies: [],
      },
      holdings: [],
      privateAssets: [],
      privateAssetProjects: [],
      troops: [
        {
          troopId: 'troop_player_cavalry',
          name: '玩家骑兵',
          size: 100,
          factionId: 'faction_player',
          troopType: '骑兵',
          quality: '高',
          lifecycleStatus: 'active',
          morale: 70,
          training: 65,
          supplies: 'stable',
          task: '驻守',
          relationToPlayer: 'self',
        },
      ],
      domesticReports: [],
    } satisfies RuntimeState;
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '你只是清点营中军士，并未处理领地收支。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 30, reason: '清点军士', category: 'inspection' },
              reason: '清点耗时半个时辰',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, troopOnlyState, '我清点军士', {
      apiConfig,
      llmClient,
    });

    const calls = llmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    const promptText = calls[0][0].messages.map((message) => message.content).join('\n');
    const latestTurnLog = result.newRuntimeState.turnLog[result.newRuntimeState.turnLog.length - 1];
    expect(promptText).not.toContain('年度结算待处理');
    expect(promptText).not.toContain('system:holding-annual:189');
    expect(result.newRuntimeState.domesticReports?.map((report) => report.reportId)).not.toContain('system:holding-annual:189');
    expect(result.turnDisplayMeta.holdingAnnualSettlement).toBeUndefined();
    expect(latestTurnLog?.statePatchSummary).not.toContain('年度结算[system:holding-annual:189]');
  });

  it('downgrades terminal troop war references to narrative without another API call', async () => {
    const state = makeDynamicWarState();
    state.troops = [
      ...(state.troops ?? []),
      makeWarTroop('troop_yangzhai_garrison', {
        name: '颍川阳翟守军',
        size: 240,
        morale: 0,
        lifecycleStatus: 'routed',
        factionId: 'faction_enemy',
        locationId: 'loc_market_town',
      }),
    ];
    const intent: WarStartIntent = {
      ...makeDynamicWarIntent(),
      encounterId: 'war_routed_yangzhai_pursuit',
      reason: '玩家正在追查已经溃散的阳翟守军。',
      enemyForce: { troopIds: ['troop_yangzhai_garrison'] },
      objective: 'defeat_enemy',
      targetHoldingId: undefined,
    };
    const llmClient = {
      generate: vi.fn().mockResolvedValueOnce({
        content: JSON.stringify({
          protocolVersion: 'lsfy.turn.v1',
          narrativeText: '阳翟守军已经失去建制，残兵沿街巷四散。你的人马收拢阵形，准备继续追查残部去向。',
          suggestedActions: [{
            label: '收拢俘虏',
            description: '盘问残兵并收缴兵器。',
            actionType: 'other',
          }],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 20, reason: '追查溃兵', category: 'battle' },
              reason: '追击与收拢耗时',
            },
            {
              type: 'luanshiCommand',
              reason: '错误预写战争结果',
              payload: {
                command: {
                  action: 'upsertConflictRecord',
                  conflictId: 'conflict_should_be_quarantined',
                },
              },
            },
          ],
          statePatch: null,
          writeback: {
            playerRecoveryKind: 'none',
            encounterTransitionDecision: { mode: 'start', reason: '追击已经发生。' },
            encounterStartIntent: intent,
            semanticProjections: [],
            debugNotes: [],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      }),
    };

    const result = await executeTurn(worldBook, state, '追击已经溃散的阳翟守军', {
      apiConfig,
      llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(result.narrativeText).toContain('残兵沿街巷四散');
    expect(result.suggestedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '收拢俘虏' }),
    ]));
    expect(result.encounterTransitionDecision).toMatchObject({ mode: 'none' });
    expect(result.encounterStartIntent).toBeUndefined();
    expect(result.statePatches).toHaveLength(1);
    expect(result.statePatches?.[0]?.type).toBe('timeAdvance');
    expect(result.newRuntimeState.conflicts ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ conflictId: 'conflict_should_be_quarantined' }),
    ]));
    expect(result.newRuntimeState.troops?.find((troop) => troop.troopId === 'troop_yangzhai_garrison')?.lifecycleStatus)
      .toBe('routed');
    expect(result.newRuntimeState.turnLog).toHaveLength(1);
    expect(result.writeback?.debugNotes?.join('\n')).toContain('code=encounter_transition_downgraded_terminal_troop');
    expect(result.writeback?.debugNotes?.join('\n')).toContain('troop_yangzhai_garrison');
    expect(result.writeback?.debugNotes?.join('\n')).toContain('已隔离 1 条触发回合战争结果写回');
    expect(result.turnDisplayMeta.processingStages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'repairingStateWriteback',
        label: '按剧情承接战争切入',
        status: 'finished',
        detail: expect.stringContaining('encounter_transition_downgraded_terminal_troop'),
      }),
    ]));
  });

  it('repairs map-only war targets by atomically declaring the missing troop and holding before staging', async () => {
    const state = makeDynamicWarState();
    const intent = makeDynamicWarIntent();
    const incompleteRepairPatches = makeDynamicWarDeclarationPatches();
    const incompleteHoldingCommand = incompleteRepairPatches[1]?.payload?.command as
      | Record<string, unknown>
      | undefined;
    if (incompleteHoldingCommand) incompleteHoldingCommand.updatedAt = '';
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '前锋营已经撞开坞堡外门，守军列阵迎击，双方的第一轮冲撞即将由战争引擎裁定。',
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 30, reason: '突进至坞堡外门', category: 'battle' },
                reason: '强行军与夺门耗时',
              },
              {
                type: 'luanshiCommand',
                reason: '首份响应尝试登记守军但缺少必需字段',
                payload: {
                  command: {
                    action: 'upsertTroopLedger',
                    troopId: 'troop_market_fort_garrison',
                    name: '市镇坞堡守军',
                  },
                },
              },
            ],
            statePatch: null,
            writeback: {
              encounterTransitionDecision: { mode: 'start', reason: '两军已经正式交锋。' },
              encounterStartIntent: intent,
              semanticProjections: [],
            },
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '',
            suggestedActions: [],
            statePatches: incompleteRepairPatches,
            statePatch: null,
            writeback: {
              encounterTransitionDecision: { mode: 'start', reason: '两军已经正式交锋。' },
              encounterStartIntent: intent,
            },
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '',
            suggestedActions: [],
            statePatches: makeDynamicWarDeclarationPatches(),
            statePatch: null,
            writeback: {
              encounterTransitionDecision: { mode: 'start', reason: '两军已经正式交锋。' },
              encounterStartIntent: intent,
            },
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        }),
    };

    const result = await executeTurn(worldBook, state, '率前锋营夺取市镇坞堡', {
      apiConfig,
      llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledTimes(3);
    const repairRequest = llmClient.generate.mock.calls[1]?.[0] as LlmGenerateRequest;
    const repairPrompt = repairRequest.messages.map((message) => message.content).join('\n');
    const retryRequest = llmClient.generate.mock.calls[2]?.[0] as LlmGenerateRequest;
    const retryPrompt = retryRequest.messages.map((message) => message.content).join('\n');
    expect(repairPrompt).toContain('troop_market_fort_garrison');
    expect(repairPrompt).toContain('holding_market_fort');
    expect(repairPrompt).toContain('upsertTroopLedger / upsertHoldingLedger');
    expect(repairPrompt).toContain('locationId=loc_market_town');
    expect(repairPrompt).toContain('声明无效，必须用完整声明替换');
    expect(retryPrompt).toContain('updatedAt cannot be empty');
    expect(result.newRuntimeState.troops?.map((troop) => troop.troopId))
      .toContain('troop_market_fort_garrison');
    expect(result.newRuntimeState.holdings?.map((holding) => holding.holdingId))
      .toContain('holding_market_fort');
    expect(result.newRuntimeState.turnLog).toHaveLength(1);
    expect(result.writeback?.debugNotes?.join('\n')).toContain('替换 1 条无效战争实体声明');
    expect(result.writeback?.debugNotes?.join('\n')).toContain('写入 2 条完整战争实体声明');

    const stagedIntent = result.encounterStartIntent;
    expect(stagedIntent?.kind).toBe('war');
    if (!stagedIntent || stagedIntent.kind !== 'war') throw new Error('expected repaired war intent');
    const staged = stageWarEncounter(result.newRuntimeState, {
      saveId: 'save_dynamic_war_atomic_declaration',
      intent: stagedIntent,
      projections: result.semanticProjections ?? [],
      createdAt: '2026-07-30T06:01:00.000Z',
    });
    expect(staged.encounterV2?.active?.session.intent.encounterId)
      .toBe('war_market_fort_assault');
  });

  it('refuses to save a war turn when narrow repair leaves dangling troop or holding references', async () => {
    const state = makeDynamicWarState();
    const intent = makeDynamicWarIntent();
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '前锋营已经冲入坞堡，守军迎面压来，战争即将进入本地裁定。',
            suggestedActions: [],
            statePatches: [{
              type: 'timeAdvance',
              payload: { minutesAdvanced: 30, reason: '夺门', category: 'battle' },
              reason: '夺门耗时',
            }],
            statePatch: null,
            writeback: {
              encounterTransitionDecision: { mode: 'start', reason: '两军已经正式交锋。' },
              encounterStartIntent: intent,
            },
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
            writeback: {
              encounterTransitionDecision: { mode: 'start', reason: '两军已经正式交锋。' },
              encounterStartIntent: intent,
            },
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: '',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
            writeback: {
              encounterTransitionDecision: { mode: 'start', reason: '两军已经正式交锋。' },
              encounterStartIntent: intent,
            },
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        }),
    };

    await expect(executeTurn(worldBook, state, '率前锋营夺取市镇坞堡', {
      apiConfig,
      llmClient,
    })).rejects.toThrow('本回合未写入');
    expect(llmClient.generate).toHaveBeenCalledTimes(3);
    expect(state.turnLog).toHaveLength(0);
  });

  it('preserves the memory summary route label when the caller supplies a fallback main API config', async () => {
    const state = makeState();
    const compressionState = {
      ...state,
      turnLog: Array.from({ length: 35 }, (_, index) => ({
        turnNumber: index + 1,
        date: `day ${index + 1}`,
        playerInput: `player action ${index + 1}`,
        narrativeText: `short narrative ${index + 1}`,
        fullNarrativeText: `full narrative ${index + 1}`,
        statePatchSummary: 'none',
        timestamp: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      })),
      memoryArchive: {
        ...state.memoryArchive!,
        recentTurnSummaries: Array.from({ length: 35 }, (_, index) => ({
          id: `recent_${index + 1}`,
          turnNumber: index + 1,
          createdAt: `day ${index + 1}`,
          brief: `brief ${index + 1}`,
          importance: 'medium' as const,
        })),
      },
    } as RuntimeState;
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '你与门候交谈后离开城门。',
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 15, reason: '交谈', category: 'conversation' },
                reason: '交谈耗时',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'main-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            midTermSummaries: [
              {
                summaryId: 'mid_main_fallback',
                title: '主 API 回退摘要',
                fromCreatedAt: 'day 1',
                toCreatedAt: 'day 24',
                summary: '主 API 在未配置专用摘要模型时完成记忆压缩。',
                updatedAt: 'day 35',
              },
            ],
          }),
          provider: 'openai_compatible' as const,
          model: 'main-model',
        }),
    };

    const result = await executeTurn(worldBook, compressionState, '我继续向门候打听', {
      apiConfig,
      memorySummaryApiConfig: apiConfig,
      memorySummaryApiTaskId: 'mainNarrative',
      llmClient,
      memorySummaryLlmClient: llmClient,
    });

    expect(result.memorySummary?.apiTaskId).toBe('mainNarrative');
    expect(result.newRuntimeState.turnLog[35].statePatchSummary).toContain('memorySummary[mainNarrative]');
  });
});
