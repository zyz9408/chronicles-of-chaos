import { describe, expect, it, vi } from 'vitest';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import type { RuntimeState, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { TurnExecutionCancelledError } from '../turn/TurnExecutionContext';
import {
  executeNpcIntentSimulation,
  parseNpcIntentSimulationResponse,
  selectNpcIntentSimulationTargets,
} from './NpcIntentSimulation';

const worldBook: WorldBook = {
  manifest: {
    id: 'test-world',
    name: '测试世界',
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
  lore: '测试世界书。',
  mapSeed: [],
  factionsSeed: [],
  timelineAnchors: [],
  startBookmarks: [],
  openingCrisisTemplates: [],
  characterOptions: {
    birthOrigins: [],
    identities: [],
    abilityPresets: [],
    hiddenAbilityKeys: [],
  },
  prompts: {
    narrativeBaseline: '保持乱世叙事。',
    forbiddenTopics: [],
    outputFormat: '输出 JSON。',
    toneGuide: '沉稳。',
  },
  validationRules: [],
};

const apiConfig: ApiConfigArchive = {
  id: 'api_npc_sim',
  name: 'NPC 模拟 API',
  provider: 'openai_compatible',
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: 'fast-npc-model',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '乱世元年2月',
    currentDate: '乱世元年2月',
    player: {
      id: 'player',
      name: '主角',
      roleType: '流民',
      summary: '流落市镇。',
    },
    currentLocationId: 'loc_gate',
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
        npcId: 'npc_guard',
        name: '门候',
        sex: '男',
        age: 34,
        role: '守门军士',
        locationId: 'loc_gate',
        isPresent: true,
        isFocused: false,
        summary: '守在城门前的军士。',
        appearance: '甲衣旧而整齐。',
        personality: '谨慎，重规矩。',
        motivation: '守住关口，避免惹祸。',
        relationToPlayer: '初识',
        contactLevel: 1,
        recentAttitude: '警惕',
        memories: [
          {
            memoryId: 'mem_guard_1',
            source: '亲历',
            content: '门候刚刚看见主角在城门外停步。',
            createdAt: '乱世元年2月',
          },
        ],
      },
      {
        npcId: 'npc_advisor',
        name: '谋士',
        sex: '男',
        age: 42,
        role: '幕僚',
        locationId: 'loc_inner',
        isPresent: false,
        isFocused: true,
        summary: '被当前局势牵动的幕僚。',
        appearance: '青衫。',
        personality: '克制多疑。',
        motivation: '判断主角是否可用。',
        relationToPlayer: '听闻其名',
        contactLevel: 2,
        recentAttitude: '观察',
        memories: [],
      },
      {
        npcId: 'npc_absent',
        name: '远行商人',
        sex: '男',
        age: 29,
        role: '商人',
        locationId: 'loc_far',
        isPresent: false,
        isFocused: false,
        summary: '远行在外。',
        appearance: '普通。',
        personality: '谨慎。',
        motivation: '经商。',
        relationToPlayer: '无交集',
        contactLevel: 0,
        recentAttitude: '未知',
        memories: [],
      },
    ],
  });
}

describe('NpcIntentSimulation', () => {
  it('selects present and focused NPCs, caps the batch, and excludes unrelated absent NPCs', () => {
    const targets = selectNpcIntentSimulationTargets(makeState(), '我看向门候，询问能否入城', { maxNpcCount: 2 });

    expect(targets.map((target) => target.npcId)).toEqual(['npc_guard', 'npc_advisor']);
    expect(targets.map((target) => target.npcId)).not.toContain('npc_absent');
  });

  it('does not simulate an unrelated NPC whose stale present flag conflicts with its location', () => {
    const state = makeState();
    const staleNpc = state.npcs!.find((npc) => npc.npcId === 'npc_guard')!;
    staleNpc.locationId = 'loc_far';
    staleNpc.isPresent = true;

    const targets = selectNpcIntentSimulationTargets(state, '我整理自己的行囊', { maxNpcCount: 5 });

    expect(targets.map((target) => target.npcId)).not.toContain('npc_guard');
  });

  it('excludes polluted protagonist self-clone NPCs while keeping real focused NPCs', () => {
    const baseState = makeState();
    const state = {
      ...baseState,
      player: {
        ...baseState.player,
        name: '刘峙',
        courtesyName: '临渊',
        currentIdentity: '建威校尉',
        militaryTitle: '建威校尉',
      },
      npcs: [
        ...(baseState.npcs ?? []),
        {
          ...baseState.npcs![0],
          npcId: 'npc_liuzhi',
          name: '刘峙',
          courtesyName: '临渊',
          currentIdentity: '建威校尉',
          militaryTitle: '建威校尉',
          relationToPlayer: '本人',
          isPresent: true,
          isFocused: true,
        },
        {
          ...baseState.npcs![0],
          npcId: 'npc_liuzhi_namesake',
          name: '刘峙',
          courtesyName: '伯山',
          currentIdentity: '汝南逃难士人',
          relationToPlayer: '同名族人，正寻求投靠。',
          isPresent: false,
          isFocused: true,
        },
      ],
    } as RuntimeState;

    const targets = selectNpcIntentSimulationTargets(state, '我让刘峙与谋士一同上前', { maxNpcCount: 10 });

    expect(targets.map((target) => target.npcId)).not.toContain('npc_liuzhi');
    expect(targets.map((target) => target.npcId)).toEqual(
      expect.arrayContaining(['npc_guard', 'npc_advisor', 'npc_liuzhi_namesake']),
    );
  });

  it('parses only allowed NPC intent entries and strips non-advisory writeback fields', () => {
    const targets = selectNpcIntentSimulationTargets(makeState(), '我看向门候', { maxNpcCount: 5 });
    const parsed = parseNpcIntentSimulationResponse(JSON.stringify({
      protocolVersion: 'coc.v2.npcIntent.v1',
      intents: [
        {
          npcId: 'npc_guard',
          npcName: '门候',
          shouldAct: true,
          intent: '抬手拦住主角，要求说明来意。',
          trigger: '看见主角试图靠近城门时触发',
          perceptionBasis: '门候在场，能看见主角靠近。',
          relationshipBasis: '初识且职责要求盘问。',
          emotionalState: '谨慎警惕',
          confidence: 0.82,
        },
        {
          npcId: 'npc_unknown',
          npcName: '未知人物',
          shouldAct: true,
          intent: '不应进入结果。',
          trigger: '未知',
        },
      ],
      statePatches: [
        { type: 'timeAdvance', payload: { minutesAdvanced: 15 } },
      ],
    }), targets);

    expect(parsed.intents).toHaveLength(1);
    expect(parsed.intents[0]).toMatchObject({
      npcId: 'npc_guard',
      shouldAct: true,
      intent: '抬手拦住主角，要求说明来意。',
    });
    expect(parsed).not.toHaveProperty('statePatches');
  });

  it('calls the NPC simulation model once for a batch of target NPCs', async () => {
    const llmClient = {
      generate: vi.fn(async (request) => {
        const promptText = request.messages.map((message: { content: string }) => message.content).join('\n');
        expect(promptText).toContain('未裁定 NPC 意图建议');
        expect(promptText).toContain('npc_guard');
        expect(promptText).toContain('npc_advisor');
        expect(promptText).not.toContain('npc_absent');
        return {
          content: JSON.stringify({
            protocolVersion: 'coc.v2.npcIntent.v1',
            intents: [
              {
                npcId: 'npc_guard',
                npcName: '门候',
                shouldAct: true,
                intent: '抬手拦路，要求主角说明来意。',
                trigger: '看见主角靠近城门时触发',
                perceptionBasis: '在场目睹。',
                relationshipBasis: '初识。',
                emotionalState: '警惕',
                confidence: 0.8,
              },
            ],
          }),
          provider: 'openai_compatible' as const,
          model: 'fast-npc-model',
        };
      }),
    };

    const result = await executeNpcIntentSimulation(worldBook, makeState(), '我靠近城门', {
      apiConfig,
      llmClient,
      maxNpcCount: 5,
    });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(result.status).toBe('completed');
    expect(result.package?.intents[0].npcId).toBe('npc_guard');
    expect(result.targetNpcIds).toEqual(['npc_guard', 'npc_advisor']);
  });

  it('projects terminal quest continuity and closes a stale linked background plan before simulation', async () => {
    const state = makeState();
    state.activeQuests = [{
      id: 'quest_supplies_delivered',
      title: '兑现精料承诺',
      description: '把约定的精料送入营库。',
      status: 'completed',
      relatedNpcIds: ['npc_guard'],
      outcomeSummary: '约定物资已经交付并完成入库。',
      archivedAt: '乱世元年2月',
      createdAt: '乱世元年1月',
      updatedAt: '乱世元年2月',
    }];
    state.npcs!.find((npc) => npc.npcId === 'npc_guard')!.backgroundActivity = {
      activityId: 'activity_prepare_supplies',
      summary: '继续筹备尚未交付的精料',
      status: 'active',
      sourceType: 'quest',
      sourceIds: ['quest_supplies_delivered'],
      dueAt: '乱世元年2月',
    };
    let promptText = '';
    const llmClient = {
      generate: vi.fn(async (request) => {
        promptText = request.messages.map((message: { content: string }) => message.content).join('\n');
        return {
          content: JSON.stringify({
            protocolVersion: 'coc.v2.npcIntent.v1',
            intents: [],
          }),
          provider: 'openai_compatible' as const,
          model: 'fast-npc-model',
        };
      }),
    };

    await executeNpcIntentSimulation(worldBook, state, '我在城门前停步', {
      apiConfig,
      llmClient,
      maxNpcCount: 5,
    });

    expect(promptText).toContain('已结事项连续性强制约束');
    expect(promptText).toContain('约定物资已经交付并完成入库');
    expect(promptText).toContain('"status": "completed"');
    expect(promptText).toContain('不得因旧记忆或旧 backgroundActivity');
  });

  it('passes cancellation signal and timeout to the NPC simulation request', async () => {
    const controller = new AbortController();
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          protocolVersion: 'coc.v2.npcIntent.v1',
          intents: [],
        }),
        provider: 'openai_compatible' as const,
        model: 'fast-npc-model',
      })),
    };

    await executeNpcIntentSimulation(worldBook, makeState(), '我靠近城门', {
      apiConfig,
      llmClient,
      maxNpcCount: 5,
      signal: controller.signal,
      timeoutMs: 45_000,
    });

    const calls = llmClient.generate.mock.calls as unknown as Array<[{
      signal?: AbortSignal;
      timeoutMs?: number;
    }]>;
    expect(calls[0][0].signal).toBe(controller.signal);
    expect(calls[0][0].timeoutMs).toBe(45_000);
  });

  it('rethrows typed turn cancellation instead of converting it to a failed simulation', async () => {
    const controller = new AbortController();
    const cancellation = new TurnExecutionCancelledError();
    const llmClient = {
      generate: vi.fn(async () => {
        controller.abort(cancellation);
        throw cancellation;
      }),
    };

    await expect(executeNpcIntentSimulation(worldBook, makeState(), '我靠近城门', {
      apiConfig,
      llmClient,
      maxNpcCount: 5,
      signal: controller.signal,
      timeoutMs: 45_000,
    })).rejects.toBe(cancellation);
  });

  it('rethrows AbortError instead of converting it to a failed simulation', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    const llmClient = {
      generate: vi.fn(async () => {
        throw abortError;
      }),
    };

    await expect(executeNpcIntentSimulation(worldBook, makeState(), '我靠近城门', {
      apiConfig,
      llmClient,
      maxNpcCount: 5,
      timeoutMs: 45_000,
    })).rejects.toBe(abortError);
  });

  it('keeps ordinary model failure as an optional failed simulation', async () => {
    const llmClient = {
      generate: vi.fn(async () => {
        throw new Error('ordinary npc model failure');
      }),
    };

    const result = await executeNpcIntentSimulation(worldBook, makeState(), '我靠近城门', {
      apiConfig,
      llmClient,
      maxNpcCount: 5,
      timeoutMs: 45_000,
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('ordinary npc model failure');
  });

  it('skips without calling a model when no explicit NPC simulation API is configured', async () => {
    const llmClient = {
      generate: vi.fn(),
    };

    const result = await executeNpcIntentSimulation(worldBook, makeState(), '我靠近城门', {
      apiConfig: null,
      llmClient,
    });

    expect(llmClient.generate).not.toHaveBeenCalled();
    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('not configured');
  });
});
