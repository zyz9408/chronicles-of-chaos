import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmEmptyContentError, type LlmGenerateRequest } from '../llm/LlmClient';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import type { RuntimeState, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { savePromptOverride } from '../prompts/PromptOverrideStore';
import { saveNarrativeLengthToStorage } from '../settings/DisplaySettings';
import { generateTrueOpening } from './TrueOpeningGenerator';
import { buildNpcPanelModel } from '../../ui/npcPanelModel';
import { TurnExecutionCancelledError } from '../turn/TurnExecutionContext';

const worldBook: WorldBook = {
  manifest: {
    id: 'test-world',
    name: 'Test World',
    version: '0.1.0',
    author: 'test',
    language: 'zh-CN',
    genre: 'historical',
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
  lore: 'A late Han test world.',
  mapSeed: [
    {
      id: 'loc_yangdi',
      name: 'Yangdi County',
      level: 'county',
      summary: 'A county seat.',
      connectedRegionIds: [],
      controlHint: 'unknown',
      tensionHint: 'restless',
    },
  ],
  factionsSeed: [],
  timelineAnchors: [],
  startBookmarks: [],
  openingCrisisTemplates: [],
  prompts: {
    narrativeBaseline: 'Write grounded historical fiction.',
    forbiddenTopics: [],
    outputFormat: 'Return JSON.',
    toneGuide: 'restrained',
  },
  validationRules: [],
};

const apiConfig: ApiConfigArchive = {
  id: 'api_main',
  name: 'main API',
  provider: 'openai_compatible',
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '184-03',
    currentDate: '184-03',
    player: {
      id: 'player',
      name: 'A Yuan',
      roleType: 'wanderer',
      summary: 'A player seeking a path through chaos.',
    },
    currentLocationId: 'loc_yangdi',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {
      openingExtraRequest: 'Highest priority: begin with a broken bridge and refugees.',
    },
    turnLog: [],
    localSituationNotes: [],
    locations: [
      {
        locationId: 'loc_yangdi',
        name: 'Yangdi County',
        type: 'county',
        summary: 'A county seat.',
        knownLevel: '亲历',
        recentEvents: [],
      },
    ],
  });
}

describe('generateTrueOpening', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes openingPersonalMoney once from the true-opening loadout writeback', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'The true opening establishes the player loadout.',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: 'opening setup', category: 'opening' },
              reason: 'The opening takes fifteen minutes.',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'updatePlayerLoadout',
                  characterId: 'player',
                  personalMoney: 100,
                  equipment: [],
                  inventory: [],
                  summary: 'Initial personal loadout.',
                },
              },
              reason: 'Initialize the opening loadout.',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const state = makeState();
    delete state.worldStateDelta.openingPersonalMoney;

    const result = await generateTrueOpening(worldBook, state, { apiConfig, llmClient });

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.player.personalMoney).toBe(100);
    expect(result.newRuntimeState.worldStateDelta.openingPersonalMoney).toBe(100);
  });

  it('uses the main narrative API and records the opening as a reviewable turn', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    saveNarrativeLengthToStorage('long', storage);

    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'The first true opening scene.',
          suggestedActions: [{ label: 'Look around', description: 'Read the situation.', actionType: 'explore' }],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: 'true opening setup', category: 'opening' },
              reason: 'true opening scene consumes a short opening interval',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
        usage: { promptTokens: 123, completionTokens: 45, totalTokens: 168 },
      })),
    };

    const result = await generateTrueOpening(worldBook, makeState(), { apiConfig, llmClient });
    const logEntry = result.newRuntimeState.turnLog[0];

    expect(llmClient.generate).toHaveBeenCalledOnce();
    const promptText = JSON.stringify((llmClient.generate.mock.calls[0] as unknown[])[0]);
    expect(promptText).toContain('updatePlayerLoadout');
    expect(promptText).toContain('updatePlayerTraits');
    expect(promptText).toContain('updateCharacterIdentity');
    expect(promptText).toContain('Opening faction ledger protocol');
    expect(promptText).toContain('upsertFactionLedger');
    expect(promptText).toContain('actualController');
    expect(promptText).toContain('knownSphere');
    expect(promptText).toContain('recentActions 不得省略');
    expect(promptText).toContain('type 必须使用中文势力类型');
    expect(promptText).toContain('不得输出 warlord');
    expect(promptText).toContain('不得输出 clan/local_government/government');
    expect(promptText).toContain('stanceToPlayer 必须写简短关系文本');
    expect(promptText).toContain('upsertTroopLedger');
    expect(promptText).toContain('relationToPlayer 必须写简短关系文本');
    expect(promptText).toContain('不得写数字评分');
    expect(promptText).toContain('玩家亲自统领');
    expect(promptText).toContain('leaderNpcId 写 player');
    expect(promptText).toContain('副将、军侯、带兵副手');
    expect(promptText).toContain('新建部队必须包含 quality、readiness、fatigue、lifecycleStatus');
    expect(promptText).toContain('KnowledgeBase');
    expect(promptText).toContain('model knowledge');
    expect(promptText).toContain('开局时间');
    expect(promptText).toContain('玩家身份');
    expect(promptText).toContain('玩家地点');
    expect(promptText).toContain('不得由静态种子预填');
    expect(promptText).toContain('不要生成天下所有势力');
    expect(promptText).toContain('真开局势力账本不得为空');
    expect(promptText).toContain('主角当前归属/直接接触势力');
    expect(promptText).toContain('即使其不在场，也应建立简要人物志');
    expect(promptText).toContain('traits[].source 不得省略或写空字符串');
    expect(promptText).not.toContain('worldBook.factionsSeed 只是稳定 factionId');
    expect(promptText).toContain('protagonistProfile');
    expect(promptText).toContain('concretize conceptual birthOrigin/currentIdentity');
    expect(promptText).toContain('appearance/personality');
    expect(promptText).toContain('稳定身份事实不得只写入记忆');
    expect(promptText).toContain('必须同步 updateCharacterIdentity');
    expect(promptText).toContain('narrativeText 显示格式');
    expect(promptText).toContain('【旁白】');
    expect(promptText).toContain('【角色名】');
    expect(promptText).toContain('当前主角姓名');
    expect(promptText).toContain('不要使用 `【你】`');
    expect(promptText).toContain('临时出现的军士、门吏、仆从、路人等人物');
    expect(promptText).toContain('不要把直接台词塞进 `【旁白】` 段');
    expect(promptText).not.toContain('或 `【你】` 开头');
    expect(promptText).toContain('## 正文篇幅要求');
    expect(promptText).toContain('当前设置：长篇');
    expect(promptText).toContain('1600-2400 字');
    expect(promptText).toContain('updateNpcFemaleProfile');
    expect(promptText).toContain('npcProfileSuggestions');
    expect(promptText).toContain('femaleProfile');
    expect(promptText).toContain('relationshipNetwork');
    expect(promptText).toContain('adultPrivateProfile.breastDescription');
    expect(promptText).toContain('adultPrivateProfile.vaginaDescription');
    expect(promptText).toContain('adultPrivateProfile.anusDescription');
    expect(promptText).toContain('adultPrivateProfile.sexualPreferenceNotes');
    expect(promptText).toContain('adultPrivateProfile.sensitiveSpotNotes');
    expect(promptText).toContain('wombProfile');
    expect(promptText).toContain('virgin');
    expect(promptText).toContain('firstNightPartner');
    expect(promptText).toContain('firstNightTime');
    expect(promptText).toContain('firstNightDescription');
    expect(promptText).toContain('身体字段是长期私密锚点和未来文生图锚点');
    expect(promptText).toContain('偏好、边界、敏感、风险、子宫和初夜字段是长期信息');
    expect(promptText).toContain('不得写成正文小作文');
    expect(promptText).not.toContain('长期稳定正文档案');
    expect(promptText).toContain('后续正文与文生图锚点');
    expect(promptText).toContain('完整稳定锚点');
    expect(promptText).toContain('不得只用 summary 替代');
    expect(promptText).toContain('未知 / 不详 / 待补充 / 略 / 普通 / 正常');
    expect(promptText).toContain('同一个 npcId');
    expect(promptText).toContain('已有 NPC 必须复用上下文提供的 npcId');
    expect(promptText).toContain('不得生成漂移 ID');
    expect(promptText).toContain('openingTraitDetails');
    expect(promptText).toContain('updateCharacterUniqueArts');
    expect(promptText).toContain('openingUniqueArts');
    expect(promptText).toContain('personalCombat');
    expect(promptText).toContain('white/green/blue/red/gold');
    expect(promptText).toContain('初始行装');
    expect(promptText).toContain('出身身份');
    expect(promptText).toContain('开局领地与私人产业边界');
    expect(promptText).toContain('没有实际控制、临时控制或争夺的具体领地时，不得输出 upsertHoldingLedger');
    expect(promptText).toContain('私人庄园、田产、工坊、马场、铺面等使用 upsertPrivateAsset');
    expect(promptText).toContain('明确拥有私人产业时，必须使用 upsertPrivateAsset 写回');
    expect(promptText).toContain('明确掌管具体领地时，必须使用 upsertHoldingLedger 写回');
    expect(promptText).toContain('不得只写进正文、记忆或摘要');
    expect(promptText).toContain('不得输出 localTreasury/localGranary');
    expect(promptText).toContain('只写 siege 的事实枚举');
    expect(promptText).toContain('可支撑回合由本地计算');
    expect(logEntry.playerInput).toContain('true opening');
    expect(logEntry.displayMeta?.title).toBe('开场剧情');
    expect(logEntry.displayMeta?.promptTokens).toBe(123);
    expect(logEntry.displayMeta?.completionTokens).toBe(45);
    expect(logEntry.narrativeText).toContain('first true opening');
    expect(result.newRuntimeState.worldStateDelta.trueOpeningGenerated).toBe(true);
  });

  it('feeds opening reputation into the true opening prompt and requires narrative carryover', async () => {
    const state = makeState();
    state.player.reputation = {
      fame: 140,
      morality: 115,
      tags: [{ label: '出身声望', source: 'opening' }],
      summary: '开局公论：名声140（小有名声），德行115（小有善行）；由出身声望派生。',
    };
    state.worldStateDelta.openingReputation = state.player.reputation;

    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'The first true opening scene.',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: 'true opening setup', category: 'opening' },
              reason: 'true opening scene consumes a short opening interval',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    await generateTrueOpening(worldBook, state, { apiConfig, llmClient });

    const promptText = JSON.stringify((llmClient.generate.mock.calls[0] as unknown[])[0]);
    expect(promptText).toContain('德行：115（小有善行）');
    expect(promptText).toContain('名声：140（小有名声）');
    expect(promptText).toContain('开局公论：名声140（小有名声），德行115（小有善行）');
    expect(promptText).toContain('开局声名与德行承接');
    expect(promptText).toContain('旁人称呼、第一印象、信任或戒备');
    expect(promptText).toContain('若真开局正文实际确立新的公开评价');
    expect(promptText).toContain('updateCharacterReputation');
  });

  it('applies structured protagonistProfile returned by the true opening LLM', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '刘构在洛阳北军营中听见西凉兵动掠，意识到自己不能再只是宗室远支。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: 'true opening setup', category: 'opening' },
              reason: 'true opening scene consumes a short opening interval',
            },
          ],
          statePatch: null,
          writeback: {
            protagonistProfile: {
              birthOrigin: '汉室远支',
              birthOriginDescription: '宗室名分尚在，但远离权力中枢。',
              currentIdentity: '北军军侯',
              currentIdentityDescription: '统带北军一部的低阶军官，正被洛阳乱局卷入。',
              militaryTitle: '北军军侯',
              appearance: '年少而清瘦，甲衣尚新，眉眼里有压不住的警觉。',
              personality: '谨慎敏锐，重承诺，也知道乱局里不能轻信人。',
              identitySummary: '汉室远支出身的北军军侯。',
            },
            protagonistMemory: {
              recentTurnSummary: '确定身份：以汉室远支之身，担任北军军侯。',
            },
            npcMemorySuggestions: [],
            locationWriteSuggestions: [],
            routeWriteSuggestions: [],
            questChanges: [],
            worldEventSummary: null,
            debugNotes: [],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await generateTrueOpening(worldBook, makeState(), { apiConfig, llmClient });

    expect(result.newRuntimeState.player).toMatchObject({
      birthOrigin: '汉室远支',
      currentIdentity: '北军军侯',
      militaryTitle: '北军军侯',
      appearance: '年少而清瘦，甲衣尚新，眉眼里有压不住的警觉。',
      personality: '谨慎敏锐，重承诺，也知道乱局里不能轻信人。',
      identitySummary: '汉室远支出身的北军军侯。',
    });
    expect(result.newRuntimeState.player.playerMemory?.recentTurns).toContain('确定身份：以汉室远支之身，担任北军军侯。');
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('主角档案');
  });

  it('requires an API config instead of silently falling back to the debug opening', async () => {
    await expect(
      generateTrueOpening(worldBook, makeState(), {
        apiConfig: null,
        llmClient: { generate: vi.fn() },
      }),
    ).rejects.toThrow('真开局需要先配置主剧情 API');
  });

  it('rejects a late main result before true-opening compliance or state commit', async () => {
    const controller = new AbortController();
    const cancellation = new TurnExecutionCancelledError();
    const llmClient = {
      generate: vi.fn(async () => {
        controller.abort(cancellation);
        return {
          content: JSON.stringify({
            narrativeText: 'This opening arrived after the save session changed.',
            suggestedActions: [],
            statePatches: [{
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: 'late opening', category: 'opening' },
              reason: 'late opening result',
            }],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        };
      }),
    };

    await expect(generateTrueOpening(worldBook, makeState(), {
      apiConfig,
      llmClient,
      signal: controller.signal,
    })).rejects.toBe(cancellation);
    expect(llmClient.generate).toHaveBeenCalledOnce();
  });

  it('uses opening prompt overrides in the true opening input', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    savePromptOverride('opening.trueOpeningPrompt', 'OPENING_PROMPT_SENTINEL {openingExtraRequest}', storage);
    savePromptOverride('opening.extraRequestPriority', 'EXTRA_REQUEST_SENTINEL {openingExtraRequest}', storage);
    savePromptOverride('opening.reputationProtocol', 'REPUTATION_OPENING_SENTINEL', storage);
    savePromptOverride('opening.factionLedgerProtocol', 'FACTION_LEDGER_OPENING_SENTINEL', storage);
    savePromptOverride('opening.uniqueArtsProtocol', 'UNIQUE_ARTS_OPENING_SENTINEL', storage);
    savePromptOverride('opening.loadoutProtocol', 'LOADOUT_SENTINEL', storage);
    savePromptOverride('opening.holdingAssetProtocol', 'HOLDING_ASSET_SENTINEL', storage);
    savePromptOverride('opening.femaleNpcProfileProtocol', 'FEMALE_OPENING_SENTINEL', storage);

    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'The first true opening scene.',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 15, reason: 'true opening setup', category: 'opening' },
              reason: 'true opening scene consumes a short opening interval',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    await generateTrueOpening(worldBook, makeState(), { apiConfig, llmClient });

    const promptText = JSON.stringify((llmClient.generate.mock.calls[0] as unknown[])[0]);
    expect(promptText).toContain('OPENING_PROMPT_SENTINEL');
    expect(promptText).toContain('Highest priority: begin with a broken bridge and refugees.');
    expect(promptText).toContain('EXTRA_REQUEST_SENTINEL');
    expect(promptText).toContain('REPUTATION_OPENING_SENTINEL');
    expect(promptText).toContain('FACTION_LEDGER_OPENING_SENTINEL');
    expect(promptText).toContain('UNIQUE_ARTS_OPENING_SENTINEL');
    expect(promptText).toContain('LOADOUT_SENTINEL');
    expect(promptText).toContain('HOLDING_ASSET_SENTINEL');
    expect(promptText).toContain('FEMALE_OPENING_SENTINEL');
    expect(promptText).toContain('npcProfileSuggestions[].equipment');
    expect(promptText).toContain('npcProfileSuggestions[].inventory');
    expect(promptText).toContain('开局重要 NPC 行装');
  });

  it('preserves opening NPC profile writeback when timeAdvance repair is needed', async () => {
    const firstResponse = {
      narrativeText: 'A named woman appears in the opening scene.',
      suggestedActions: [{ label: 'Speak to her', description: 'Confirm her situation.', actionType: 'social' }],
      statePatches: [],
      statePatch: null,
      writeback: {
        npcProfileSuggestions: [
          {
            npcId: 'npc_opening_woman',
            name: 'Opening Woman',
            sex: '女',
            age: 33,
            role: 'opening important NPC',
            factionName: 'local faction',
            locationId: 'loc_yangdi',
            isPresent: true,
            isFocused: true,
            currentIdentity: 'local notable',
            summary: 'A key woman generated by opening requirements.',
            appearance: 'Composed and visibly important.',
            personality: 'Careful but decisive.',
            motivation: 'Protect her household in the opening crisis.',
            relationToPlayer: 'Newly met but central to the opening situation.',
            contactLevel: 6,
            recentAttitude: 'watchful',
            abilityScores: { 武力: 18, 统率: 25, 智力: 58, 政治: 61, 魅力: 72, 机运: 49 },
            traits: [
              {
                id: 'trait_opening_anchor',
                label: 'Opening Anchor',
                description: 'Anchors the opening scene and later NPC continuity.',
                source: 'opening',
                rarity: 'blue',
              },
            ],
            femaleProfile: {
              birthday: '156',
              addressToPlayer: 'stranger',
              appearanceDescription: 'Stable visual anchor for later prose and image prompts.',
              bodyDescription: 'Stable body anchor for later prose and image prompts.',
              clothingStyle: 'Stable clothing anchor for later prose and image prompts.',
              personalityCore: 'Careful but decisive under pressure.',
              relationshipNetwork: [
                { targetName: 'Player', relationship: 'opening contact', notes: 'Generated in the true opening.' },
              ],
              adultPrivateProfile: {
                enabled: true,
                ageConfirmedAdult: true,
                summary: 'Adult private profile summary.',
                preferenceNotes: 'Long-term preference note.',
                boundaryNotes: 'Long-term boundary note.',
              },
            },
          },
        ],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
    };
    const repairResponse = {
      narrativeText: firstResponse.narrativeText,
      suggestedActions: firstResponse.suggestedActions,
      statePatches: [
        {
          type: 'timeAdvance',
          payload: { minutesAdvanced: 15, reason: 'true opening repair', category: 'opening' },
          reason: 'Repair missing opening time advance.',
        },
      ],
      statePatch: null,
    };
    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify(firstResponse),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(repairResponse),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        }),
    };

    const result = await generateTrueOpening(worldBook, makeState(), { apiConfig, llmClient });
    const openingNpc = result.newRuntimeState.npcs?.find((npc) => npc.npcId === 'npc_opening_woman');
    const npcPanel = buildNpcPanelModel(result.newRuntimeState, { selectedNpcId: 'npc_opening_woman' });

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(openingNpc).toMatchObject({
      name: 'Opening Woman',
      age: 33,
      isPresent: true,
      currentIdentity: 'local notable',
    });
    expect(openingNpc?.femaleProfile?.appearanceDescription).toContain('Stable visual anchor');
    expect(openingNpc?.femaleProfile?.adultPrivateProfile?.preferenceNotes).toBe('Long-term preference note.');
    expect(npcPanel.selectedCard?.id).toBe('npc_opening_woman');
    expect(npcPanel.selectedCard?.femaleProfile?.sections.map((section) => section.kind)).toContain('appearanceAnchor');
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('NPC档案x1');
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('女性档案x1');
  });

  it('removes an opening holding ledger when the initial setup explicitly has no territory', async () => {
    const state = makeState();
    state.player.currentIdentity = '游侠';
    state.worldStateDelta.openingExtraRequest = '明确无领地、无城池、无官方领地，只是携剑入乱世。';

    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '阿元在破桥旁醒来，身边只有行囊与流民，没有任何属县或官署可依。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 10, reason: 'true opening setup', category: 'opening' },
              reason: 'true opening scene consumes a short opening interval',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'upsertHoldingLedger',
                  holdingId: 'holding_bad_default',
                  name: '错误默认领地',
                  type: 'county',
                  status: 'controlled',
                  summary: '模型误把无领地开局写成了控制县邑。',
                  civilAdministrationScope: 'territorial',
                  scaleLevel: 2,
                  agriculture: 45,
                  commerce: 30,
                  population: 40,
                  publicOrder: 35,
                  popularSupport: 35,
                  defense: 25,
                  recruitPotential: 20,
                  armory: 15,
                  horseSupply: 5,
                  corruption: 50,
                  localTreasury: 3000,
                  updatedAt: '184-03',
                },
              },
              reason: 'invalid default holding',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await generateTrueOpening(worldBook, state, { apiConfig, llmClient });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(result.newRuntimeState.holdings ?? []).toHaveLength(0);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('移除不符合“无领地”开局的领地账本x1');
  });

  it('keeps an opening holding but strips local treasury and granary without handover evidence', async () => {
    const state = makeState();
    state.player.currentIdentity = '阳翟县令';
    state.player.officeTitle = '阳翟县令';
    state.worldStateDelta.openingExtraRequest = '主角刚刚到任阳翟县令，尚未完成账册交接。';

    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '阿元接过县印，在堂上听吏员报到；今日只是到任，县中诸事尚待亲自清查。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 20, reason: 'true opening setup', category: 'opening' },
              reason: 'true opening scene consumes a short opening interval',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'upsertHoldingLedger',
                  holdingId: 'holding_yangdi_county',
                  name: '阳翟县',
                  type: 'county',
                  status: 'controlled',
                  summary: '主角以县令身份刚刚接掌阳翟县，实际治理状况尚待清查。',
                  civilAdministrationScope: 'territorial',
                  scaleLevel: 2,
                  agriculture: 48,
                  commerce: 36,
                  population: 44,
                  publicOrder: 38,
                  popularSupport: 36,
                  defense: 26,
                  recruitPotential: 22,
                  armory: 18,
                  horseSupply: 8,
                  corruption: 52,
                  localTreasury: 5000,
                  localGranary: 9000,
                  sourceNote: '开局到任推定',
                  updatedAt: '184-03',
                },
              },
              reason: 'opening holding',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await generateTrueOpening(worldBook, state, { apiConfig, llmClient });
    const holding = result.newRuntimeState.holdings?.[0];

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(holding).toMatchObject({
      holdingId: 'holding_yangdi_county',
      name: '阳翟县',
    });
    expect(holding?.localTreasury).toBeUndefined();
    expect(holding?.localGranary).toBeUndefined();
  });

  it('strips exact local treasury and granary even when the opening prose contains a handover ledger', async () => {
    const state = makeState();
    state.player.currentIdentity = '阳翟县令';
    state.player.officeTitle = '阳翟县令';
    state.worldStateDelta.openingExtraRequest = '主角已到任阳翟县令，县中完成府库与粮仓交接。';

    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '主簿递上府库交接清册，县库现钱五千贯，官仓余粮九千石，阿元验过印押后接掌阳翟县政。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 20, reason: 'true opening setup', category: 'opening' },
              reason: 'true opening scene consumes a short opening interval',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'upsertHoldingLedger',
                  holdingId: 'holding_yangdi_county',
                  name: '阳翟县',
                  type: 'county',
                  status: 'controlled',
                  summary: '主角以县令身份接掌阳翟县，主簿已交出府库与官仓清册。',
                  civilAdministrationScope: 'territorial',
                  scaleLevel: 2,
                  agriculture: 48,
                  commerce: 36,
                  population: 44,
                  publicOrder: 38,
                  popularSupport: 36,
                  defense: 26,
                  recruitPotential: 22,
                  armory: 18,
                  horseSupply: 8,
                  corruption: 52,
                  localTreasury: 5000,
                  localGranary: 9000,
                  sourceNote: '府库交接清册明确列数',
                  updatedAt: '184-03',
                },
              },
              reason: 'opening holding with ledger handover',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await generateTrueOpening(worldBook, state, { apiConfig, llmClient });
    const holding = result.newRuntimeState.holdings?.[0];

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(holding).toMatchObject({
      holdingId: 'holding_yangdi_county',
      name: '阳翟县',
    });
    expect(holding?.localTreasury).toBeUndefined();
    expect(holding?.localGranary).toBeUndefined();
  });

  it('routes a local-elite donation away from deprecated local treasury storage', async () => {
    const state = makeState();
    state.player.currentIdentity = '阳翟县令';
    state.player.officeTitle = '阳翟县令';
    state.worldStateDelta.openingExtraRequest = '主角已接掌阳翟县，正与地方豪族议定助饷。';

    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: '阳翟豪族为求自保，当堂捐赠军饷五千贯给县中守备，准备补发县兵月饷。',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 20, reason: 'true opening setup', category: 'opening' },
              reason: 'true opening scene consumes a short opening interval',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'upsertHoldingLedger',
                  holdingId: 'holding_yangdi_county',
                  name: '阳翟县',
                  type: 'county',
                  status: 'controlled',
                  summary: '主角以县令身份接掌阳翟县，地方豪族捐赠军饷入县中守备账。',
                  civilAdministrationScope: 'territorial',
                  scaleLevel: 2,
                  agriculture: 48,
                  commerce: 36,
                  population: 44,
                  publicOrder: 38,
                  popularSupport: 40,
                  defense: 30,
                  recruitPotential: 24,
                  armory: 18,
                  horseSupply: 8,
                  corruption: 48,
                  localTreasury: 5000,
                  sourceNote: '地方豪族捐赠军饷五千贯',
                  updatedAt: '184-03',
                },
              },
              reason: 'local elite military funds donation',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await generateTrueOpening(worldBook, state, { apiConfig, llmClient });
    const holding = result.newRuntimeState.holdings?.[0];

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(holding).toMatchObject({
      holdingId: 'holding_yangdi_county',
    });
    expect(holding?.localTreasury).toBeUndefined();
  });

  it('does not repair a military command and camp into a holding ledger without territorial control', async () => {
    const state = makeState();
    state.player.currentIdentity = '巴郡郡兵军侯';
    state.player.militaryTitle = '郡兵军侯';
    state.worldStateDelta.openingExtraRequest = '主角只是军中下级将校，统领一小部郡兵。';
    const openingNarrative = '刘平奉命守江州城外军营，统领两百郡兵。营中库房只存刀枪弓弩，今日清点军械与斥候名册。';

    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: openingNarrative,
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 20, reason: 'true opening setup', category: 'opening' },
              reason: 'true opening scene consumes a short opening interval',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await generateTrueOpening(worldBook, state, { apiConfig, llmClient });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(result.newRuntimeState.holdings ?? []).toHaveLength(0);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).not.toContain('开局账本合规修复');
  });

  it('removes a military-only camp holding and default treasury from the true opening result', async () => {
    const state = makeState();
    state.player.currentIdentity = '巴郡郡兵军侯';
    state.player.militaryTitle = '郡兵军侯';
    const openingNarrative = '刘平在江州城外郡兵营点卯，统领两百郡兵，库房里只见刀枪弓弩与防潮油布。';

    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: openingNarrative,
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 20, reason: 'true opening setup', category: 'opening' },
              reason: 'true opening scene consumes a short opening interval',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'upsertHoldingLedger',
                  holdingId: 'holding_jiangzhou_camp_liuping',
                  name: '江州郡兵营（刘平部）',
                  type: 'camp',
                  status: 'controlled',
                  summary: '刘平以军侯身份统领两百郡兵驻扎于此。',
                  civilAdministrationScope: 'none',
                  scaleLevel: 1,
                  agriculture: 0,
                  commerce: 0,
                  population: 0,
                  publicOrder: 0,
                  popularSupport: 0,
                  defense: 45,
                  recruitPotential: 0,
                  armory: 40,
                  horseSupply: 5,
                  localTreasury: 5000,
                  updatedAt: '184-03',
                },
              },
              reason: '模型误把部队驻地写成领地',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await generateTrueOpening(worldBook, state, { apiConfig, llmClient });

    expect(result.newRuntimeState.holdings ?? []).toHaveLength(0);
    expect(result.newRuntimeState.resources?.money).toBe(0);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('移除仅表示军职或部队驻地的领地账本x1');
  });

  it('does not treat another person official title or governance cue in the opening narrative as player holding evidence', async () => {
    const state = makeState();
    state.player.currentIdentity = '荆州别部司马';
    state.player.militaryTitle = '别部司马';
    const openingNarrative = '刘峙在襄阳城外营中整兵，听伊籍说荆州牧刘表仍实际掌管荆州军政。刘峙只是军中别部司马，仍受州府粮草掣肘。';

    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: openingNarrative,
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 20, reason: 'true opening setup', category: 'opening' },
              reason: 'true opening scene consumes a short opening interval',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await generateTrueOpening(worldBook, state, { apiConfig, llmClient });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(result.newRuntimeState.holdings ?? []).toHaveLength(0);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).not.toContain('开局账本合规修复');
  });

  it('keeps the successful opening when optional ledger repair returns typed empty content', async () => {
    const state = makeState();
    state.player.birthOrigin = '地方寒族';
    state.player.currentIdentity = '无官职的家族庄园主事';
    state.worldStateDelta.openingExtraRequest = '主角拥有一处家族祖传庄园、数十亩田产和佃户，但没有官府领地。';
    const openingNarrative = '祖传庄园在县南坡地，田产虽薄，仍有佃户守着私仓。阿元知道这只是家业，不是官府领地。';

    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: openingNarrative,
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 10, reason: 'true opening setup', category: 'opening' },
                reason: 'true opening scene consumes a short opening interval',
              },
              {
                type: 'luanshiCommand',
                payload: {
                  command: {
                    action: 'updatePlayerLoadout',
                    characterId: 'player',
                    personalMoney: 77,
                    equipment: [],
                    inventory: [],
                    summary: '开局随身钱财已落定。',
                  },
                },
                reason: 'initialize opening loadout',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
        })
        .mockRejectedValueOnce(new LlmEmptyContentError(
          'API 返回缺少正文内容',
          { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        )),
    };

    const result = await generateTrueOpening(worldBook, state, { apiConfig, llmClient });

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(result.narrativeText).toBe(openingNarrative);
    expect(result.newRuntimeState.player.personalMoney).toBe(77);
    expect(result.newRuntimeState.worldStateDelta.openingPersonalMoney).toBe(77);
    expect(result.newRuntimeState.privateAssets ?? []).toHaveLength(0);
    expect(result.newRuntimeState.turnLog[0].narrativeText).toBe(openingNarrative);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('开局账本合规修复空响应，已保留开场');
    expect(result.turnDisplayMeta.reasoningSummary).toContain('开局账本合规修复空响应，已保留开场');
    expect(result.turnDisplayMeta.promptTokens).toBe(130);
    expect(result.turnDisplayMeta.completionTokens).toBe(60);
    expect(result.turnDisplayMeta.totalTokens).toBe(190);
  });

  it('propagates cancellation instead of downgrading an empty optional ledger repair after abort', async () => {
    const state = makeState();
    state.player.birthOrigin = '地方寒族';
    state.player.currentIdentity = '无官职的家族庄园主事';
    state.worldStateDelta.openingExtraRequest = '主角拥有一处家族祖传庄园、数十亩田产和佃户，但没有官府领地。';
    const openingNarrative = '祖传庄园在县南坡地，田产虽薄，仍有佃户守着私仓。阿元知道这只是家业，不是官府领地。';
    const controller = new AbortController();
    const cancellation = new TurnExecutionCancelledError();

    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: openingNarrative,
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 10, reason: 'true opening setup', category: 'opening' },
                reason: 'true opening scene consumes a short opening interval',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockImplementationOnce(async () => {
          controller.abort(cancellation);
          throw new LlmEmptyContentError('API 返回缺少正文内容', { promptTokens: 30, totalTokens: 30 });
        }),
    };

    await expect(generateTrueOpening(worldBook, state, {
      apiConfig,
      llmClient,
      signal: controller.signal,
    })).rejects.toBe(cancellation);
    expect(llmClient.generate).toHaveBeenCalledTimes(2);
  });

  it('repairs a missing private asset ledger when the opening establishes family property', async () => {
    const state = makeState();
    state.player.birthOrigin = '地方寒族';
    state.player.currentIdentity = '无官职的家族庄园主事';
    state.worldStateDelta.openingExtraRequest = '主角拥有一处家族祖传庄园、数十亩田产和佃户，但没有官府领地。';
    const openingNarrative = '祖传庄园在县南坡地，田产虽薄，仍有佃户守着私仓。阿元知道这只是家业，不是官府领地。';

    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: openingNarrative,
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 10, reason: 'true opening setup', category: 'opening' },
                reason: 'true opening scene consumes a short opening interval',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: openingNarrative,
            suggestedActions: [],
            statePatches: [
              {
                type: 'luanshiCommand',
                action: 'upsertPrivateAsset',
                payload: {
                  privateAssetId: 'asset_family_estate',
                  name: '县南祖传庄园',
                  type: 'estate',
                  ownerScope: 'household',
                  status: 'active',
                  summary: '主角家中承袭的小型庄园和田产，有佃户与私仓，但不是官府领地。',
                  locationId: 'loc_yangdi',
                  mu: 60,
                  households: 8,
                  conditionNotes: ['田产薄弱', '依赖佃户维持'],
                  sourceNote: '开局正文明确家族私产',
                  updatedAt: '184-03',
                },
                reason: '补写开局私产账本',
              },
            ],
            statePatch: null,
            writeback: { debugNotes: [] },
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
          usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        }),
    };

    const controller = new AbortController();
    const result = await generateTrueOpening(worldBook, state, {
      apiConfig,
      llmClient,
      signal: controller.signal,
    });
    const repairPrompt = JSON.stringify((llmClient.generate.mock.calls[1] as unknown[])[0]);
    const requests = llmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(requests.every(([request]) => request.signal === controller.signal)).toBe(true);
    expect(repairPrompt).toContain('开局领地/私产账本合规修复器');
    expect(repairPrompt).toContain('upsertPrivateAsset');
    expect(repairPrompt).toContain('updatedAt 是引擎管理的技术时间戳');
    expect(repairPrompt).toContain('不得输出 narrativeText');
    expect(result.newRuntimeState.privateAssets ?? []).toHaveLength(1);
    expect(result.newRuntimeState.privateAssets?.[0]).toMatchObject({
      privateAssetId: 'asset_family_estate',
      name: '县南祖传庄园',
      ownerScope: 'household',
    });
    expect(result.newRuntimeState.holdings ?? []).toHaveLength(0);
    expect(result.newRuntimeState.turnLog).toHaveLength(1);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('开局账本合规修复：补写私产x1');
    expect(result.turnDisplayMeta.promptTokens).toBe(130);
    expect(result.turnDisplayMeta.completionTokens).toBe(60);
    expect(result.turnDisplayMeta.totalTokens).toBe(190);
  });

  it('repairs a missing holding ledger when the opening establishes real local control', async () => {
    const state = makeState();
    state.player.currentIdentity = '阳翟县令';
    state.player.officeTitle = '阳翟县令';
    state.worldStateDelta.openingExtraRequest = '主角已受命为阳翟县令，实际掌管县城，但尚未查点府库。';
    const openingNarrative = '县令印绶压在案上，阿元坐入阳翟县衙，吏员等他发第一道文书。';

    const llmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: openingNarrative,
            suggestedActions: [],
            statePatches: [
              {
                type: 'timeAdvance',
                payload: { minutesAdvanced: 20, reason: 'true opening setup', category: 'opening' },
                reason: 'true opening scene consumes a short opening interval',
              },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            protocolVersion: 'lsfy.turn.v1',
            narrativeText: openingNarrative,
            suggestedActions: [],
            statePatches: [
              {
                type: 'luanshiCommand',
                payload: {
                  command: {
                    action: 'upsertHoldingLedger',
                    holdingId: 'holding_yangdi_county',
                    name: '阳翟县',
                    type: 'county',
                    status: 'active',
                    summary: '主角以县令身份实际掌管阳翟县，但府库粮仓尚未完成查点。',
                    civilAdministrationScope: 'territorial',
                    locationId: 'loc_yangdi',
                    scaleLevel: 2,
                    agriculture: 48,
                    commerce: 36,
                    population: 44,
                    publicOrder: 38,
                    popularSupport: 36,
                    defense: 26,
                    recruitPotential: 22,
                    armory: 18,
                    horseSupply: 8,
                    corruption: 52,
                    sourceNote: '开局身份与正文明确掌管县衙',
                    updatedAt: '184-03',
                  },
                },
                reason: '补写开局领地账本',
              },
            ],
            statePatch: null,
            writeback: { debugNotes: [] },
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        }),
    };

    const result = await generateTrueOpening(worldBook, state, { apiConfig, llmClient });
    const holding = result.newRuntimeState.holdings?.[0];

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(holding).toMatchObject({
      holdingId: 'holding_yangdi_county',
      name: '阳翟县',
      status: 'controlled',
    });
    expect(holding?.localTreasury).toBeUndefined();
    expect(holding?.localGranary).toBeUndefined();
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('开局账本合规修复：补写领地x1');
  });
});
