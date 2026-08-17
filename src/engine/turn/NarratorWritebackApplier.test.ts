import { describe, expect, it } from 'vitest';
import type { RuntimeState, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { shouldCreateRecentTurnSummaryTask } from '../memory/MemorySummaryProjection';
import type { NarratorNpcProfileSuggestion } from './MockNarrator';
import { applyNarratorWriteback, tryApplyNpcProfileForCompliance } from './NarratorWritebackApplier';
import { parseNarratorResponse } from './NarratorResponseParser';

const worldBook: WorldBook = {
  manifest: {
    id: 'writeback-world',
    name: 'Writeback World',
    version: '0.1.0',
    author: 'test',
    language: 'zh-CN',
    genre: 'historical-chaos',
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
      id: 'region_root',
      name: '根区',
      level: 'region',
      mapLayer: 'region',
      summary: '',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
      subLocations: [
        {
          id: 'place_a',
          name: '甲地',
          level: 'place',
          mapLayer: 'place',
          summary: '',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
        },
        {
          id: 'place_b',
          name: '乙地',
          level: 'place',
          mapLayer: 'place',
          summary: '',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
        },
      ],
    },
  ],
  factionsSeed: [],
  timelineAnchors: [],
  startBookmarks: [],
  openingCrisisTemplates: [],
  prompts: {
    narrativeBaseline: '',
    forbiddenTopics: [],
    outputFormat: '',
    toneGuide: '',
  },
  validationRules: [],
};

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'writeback-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: 'day 1',
    currentDate: 'day 1',
    player: {
      id: 'player',
      name: 'Player',
      roleType: 'traveler',
      summary: '',
    },
    currentLocationId: 'place_a',
    currentPlaceId: 'place_a',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [
      {
        turnNumber: 1,
        date: 'day 1',
        playerInput: 'look',
        narrativeText: 'looked',
        timestamp: '2026-01-01T00:00:00.000Z',
        statePatchSummary: 'none',
      },
    ],
    localSituationNotes: [],
  });
}

function makeNpcProfileSuggestion(
  overrides: Partial<NarratorNpcProfileSuggestion> = {},
): NarratorNpcProfileSuggestion {
  return {
    npcId: 'npc_shen_yue',
    name: '沈岳',
    persistenceReason: 'active_system_role',
    persistenceEvidence: '本回合已确认其担任河东军府校尉并奉军令持续参与营务。',
    courtesyName: '子衡',
    aliases: ['白袍校尉'],
    sex: '男',
    age: 28,
    role: '军中校尉',
    factionName: '河东军府',
    locationId: 'place_a',
    isPresent: true,
    isFocused: true,
    birthOrigin: '河东郡',
    currentIdentity: '河东军府校尉',
    summary: '奉军令前来议事的校尉。',
    appearance: '披甲束发。',
    personality: '沉着果断。',
    motivation: '守住军中阵线。',
    relationToPlayer: '初次共事',
    contactLevel: 8,
    recentAttitude: '审慎',
    abilityScores: { 武力: 78, 统率: 70, 智力: 55, 政治: 42, 魅力: 60, 机运: 50 },
    traits: [{ id: 'trait_field_officer', label: '阵前校尉', description: '熟悉军阵。', source: 'identity' }],
    ...overrides,
  };
}

function makeProtagonistBoundaryState(): RuntimeState {
  const state = makeState();
  return {
    ...state,
    player: {
      ...state.player,
      name: '刘峙',
      courtesyName: '临渊',
      sex: '男',
      age: 24,
      currentIdentity: '建威校尉',
      militaryTitle: '建威校尉',
      equipment: [
        {
          id: 'eq_player_bailian_sword',
          slot: 'weapon',
          name: '百炼环首剑',
          quality: '精良',
          description: '主角随身佩剑。',
        },
      ],
      inventory: [
        {
          id: 'item_player_jianwei_seal',
          name: '建威校尉印',
          quantity: 1,
          category: 'token',
          description: '代表主角军职的官印。',
        },
      ],
    },
  } as RuntimeState;
}

function makeProtagonistCloneSuggestion(): NarratorNpcProfileSuggestion {
  return makeNpcProfileSuggestion({
    npcId: 'npc_liuzhi',
    name: '刘峙',
    courtesyName: '临渊',
    age: 24,
    role: '建威校尉',
    currentIdentity: '建威校尉',
    militaryTitle: '建威校尉',
    summary: '错误地把主角本人建成 NPC。',
    relationToPlayer: '本人',
    abilityScores: { 武力: 72, 统率: 75, 智力: 78, 政治: 70, 魅力: 82, 机运: 65 },
    equipment: [
      {
        id: 'eq_clone_bailian_sword',
        slot: 'weapon',
        name: '百炼环首剑',
        quality: '精良',
        description: '主角随身佩剑被错误复制到 NPC。',
      },
    ],
    inventory: [
      {
        id: 'item_clone_jianwei_seal',
        name: '建威校尉印',
        quantity: 1,
        category: 'token',
        description: '主角官印被错误复制到 NPC。',
      },
    ],
  });
}

describe('NPC 人物志长期准入合同', () => {
  it('拒绝没有长期准入理由和事实证据的新人物档案', () => {
    const application = applyNarratorWriteback(makeState(), {
      protagonistMemory: null,
      npcProfileSuggestions: [makeNpcProfileSuggestion({
        npcId: 'npc_one_turn_scout',
        name: '周安',
        role: '临时斥候',
        currentIdentity: '递送一次军报的斥候',
        persistenceReason: undefined,
        persistenceEvidence: undefined,
      })],
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      worldEventSummary: null,
      debugNotes: [],
    }, worldBook);

    expect(application.state.npcs).toEqual([]);
    expect(application.ignoredSummaries.join('\n')).toContain('新建 NPC 必须提供合法 persistenceReason');
    expect(application.ignoredSummaries.join('\n')).toContain('新建 NPC 必须提供非空 persistenceEvidence');
  });

  it('已有 NPC 的正常完整档案更新不需要重复提交准入理由', () => {
    const archived = makeNpcProfileSuggestion();
    const initialState = {
      ...makeState(),
      npcs: [{ ...archived, memories: [] }],
    } as RuntimeState;
    const application = applyNarratorWriteback(initialState, {
      protagonistMemory: null,
      npcProfileSuggestions: [makeNpcProfileSuggestion({
        persistenceReason: undefined,
        persistenceEvidence: undefined,
        summary: '本回合确认其继续负责营中军务。',
      })],
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      worldEventSummary: null,
      debugNotes: [],
    }, worldBook);

    expect(application.state.npcs?.find((npc) => npc.npcId === archived.npcId)?.summary)
      .toBe('本回合确认其继续负责营中军务。');
    expect(application.ignoredSummaries).toEqual([]);
  });

  it('保留人物基础档案并隔离缺少 acquisition 的绝艺子结构', () => {
    const application = applyNarratorWriteback(makeState(), {
      protagonistMemory: null,
      npcProfileSuggestions: [makeNpcProfileSuggestion({
        npcId: 'npc_pei_shao_salvaged',
        name: '裴绍',
        persistenceReason: 'player_committed_relationship',
        persistenceEvidence: '本回合裴绍已经正式受命统领玩家部曲，形成持续军职。',
        role: '部曲将',
        currentIdentity: '玩家麾下部曲将',
        abilityScores: { 武力: 72, 统率: 76, 智力: 58, 政治: 48, 魅力: 55, 机运: 50 },
        uniqueArts: [{
          id: 'art_pei_shao_drill',
          name: '整军有法',
          rarity: 'blue',
          domain: 'warfare',
          level: 1,
          description: '善于约束新募部曲。',
          effectSummary: '整军时更易维持军纪。',
          source: '人物经历',
        } as any],
      })],
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      worldEventSummary: null,
      debugNotes: [],
    }, worldBook);

    const peiShao = application.state.npcs?.find((npc) => npc.npcId === 'npc_pei_shao_salvaged');
    expect(peiShao).toBeDefined();
    expect(peiShao?.uniqueArts).toBeUndefined();
    expect(application.ignoredSummaries.join('\n')).toContain(
      '裴绍 的绝艺子结构未通过合同，已保留人物基础档案',
    );
  });
});

describe('applyNarratorWriteback faction recent action support', () => {
  it('applies firsthand and heard suggestions through the strict faction action command', () => {
    const initialState = {
      ...makeState(),
      factions: [
        {
          factionId: 'faction_player_command',
          name: '主角军府',
          type: '军府',
          summary: '主角任职并参与军务的势力。',
          stanceToPlayer: '自势力相关',
          knownLevel: '亲历' as const,
          recentActions: ['整顿营寨'],
        },
        {
          factionId: 'faction_rebel_remnant',
          name: '黄巾余部',
          type: '叛乱组织',
          summary: '在郊外活动的黄巾余部。',
          stanceToPlayer: '敌对',
          knownLevel: '听闻' as const,
          recentActions: ['郊外出没'],
        },
      ],
    } as RuntimeState;
    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [],
        npcMemorySuggestions: [],
        factionRecentActionSuggestions: [
          {
            factionId: 'faction_player_command',
            summary: '主角代表军府完成军粮交割',
            knownLevel: '亲历',
          },
          {
            factionId: 'faction_rebel_remnant',
            summary: '黄巾余部烧毁东郊驿站',
            knownLevel: '听闻',
            sourceNote: '斥候军报',
          },
          {
            factionId: 'faction_rebel_remnant',
            summary: '黄巾余部烧毁东郊驿站',
            knownLevel: '听闻',
          },
          {
            factionId: 'faction_missing',
            summary: '不存在势力的动作',
            knownLevel: '推测',
          },
        ],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.factions?.find((faction) => faction.factionId === 'faction_player_command'))
      .toMatchObject({
        knownLevel: '亲历',
        recentActions: ['【亲历】整顿营寨', '【亲历】主角代表军府完成军粮交割'],
      });
    expect(application.state.factions?.find((faction) => faction.factionId === 'faction_rebel_remnant'))
      .toMatchObject({
        knownLevel: '听闻',
        sourceNote: '斥候军报',
        recentActions: ['【听闻】郊外出没', '【听闻】黄巾余部烧毁东郊驿站'],
      });
    expect(application.appliedSummaries).toContain('势力近期动作x2');
    expect(application.ignoredSummaries.join('\n')).toContain('faction_missing');
  });
});

describe('applyNarratorWriteback Map V1 support', () => {
  it('does not let a full profile refresh overwrite an existing NPC relationship truth', () => {
    const existing = makeNpcProfileSuggestion({
      relationToPlayer: '生死之交，彼此承担过重大风险。',
      contactLevel: 44,
      recentAttitude: '充分信任',
    });
    const initialState = {
      ...makeState(),
      npcs: [{ ...existing, memories: [] }],
    } as RuntimeState;
    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          relationToPlayer: '初识',
          contactLevel: 3,
          recentAttitude: '陌生',
          summary: '本回合只补充人物简介。',
        })],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.find((npc) => npc.npcId === existing.npcId)).toMatchObject({
      relationToPlayer: '生死之交，彼此承担过重大风险。',
      contactLevel: 44,
      recentAttitude: '充分信任',
      summary: '本回合只补充人物简介。',
    });
  });

  it('does not let a routine profile refresh move an existing NPC into the player scene', () => {
    const initialState = {
      ...makeState(),
      npcs: [makeNpcProfileSuggestion({
        npcId: 'npc_ganning',
        name: '甘宁',
        locationId: 'place_b',
        isPresent: false,
        memories: [],
      } as any)],
    } as RuntimeState;
    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          npcId: 'npc_ganning',
          name: '甘宁',
          locationId: 'place_a',
          isPresent: true,
          summary: '继续在军营整训水军。',
        })],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.find((item) => item.npcId === 'npc_ganning')).toMatchObject({
      locationId: 'place_b',
      isPresent: false,
      summary: '继续在军营整训水军。',
    });
  });

  it('uses a same-turn structured event roster to persist presence and accept firsthand memory', () => {
    const initialState = {
      ...makeState(),
      npcs: [{
        ...makeNpcProfileSuggestion({
          npcId: 'npc_zoushi',
          name: '邹氏',
          locationId: 'place_a',
          isPresent: false,
        }),
        memories: [],
      }],
      turnEvents: [{
        eventId: 'event_private_scene',
        happenedAt: 'day 1',
        locationId: 'place_a',
        summary: '邹氏在内宅当面应答。',
        presentNpcIds: ['npc_zoushi'],
        involvedNpcIds: ['npc_zoushi'],
        visibility: '私密' as const,
      }],
    } as RuntimeState;
    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          npcId: 'npc_zoushi',
          name: '邹氏',
          locationId: 'place_a',
          isPresent: true,
          summary: '正在内宅与主角交谈。',
        })],
        npcMemorySuggestions: [{
          npcId: 'npc_zoushi',
          npcName: '邹氏',
          source: '亲历',
          content: '在内宅当面听见主角的安排。',
        }],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.find((item) => item.npcId === 'npc_zoushi')).toMatchObject({
      isPresent: true,
      locationId: 'place_a',
      memories: [expect.objectContaining({ source: '亲历', content: '在内宅当面听见主角的安排。' })],
    });
    expect(application.appliedSummaries).toContain('NPC记忆x1');
    expect(application.ignoredSummaries).toEqual([]);
  });

  it('keeps valid same-batch NPC profiles while rejecting protagonist self-clone suggestions', () => {
    const application = applyNarratorWriteback(makeProtagonistBoundaryState(), {
      protagonistMemory: null,
      npcProfileSuggestions: [
        makeNpcProfileSuggestion({
          npcId: 'npc_weijun',
          name: '魏钧',
          role: '流民壮士',
          currentIdentity: '颍川流民壮士',
          summary: '在流民中颇有勇力。',
          relationToPlayer: '被主角招揽的流民壮士',
        }),
        makeProtagonistCloneSuggestion(),
      ],
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      signalChanges: [],
      plotPlanSuggestions: [],
      worldEventUpdates: [],
      debugNotes: [],
    }, worldBook);

    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_weijun')).toBe(true);
    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_liuzhi')).toBe(false);
    expect(application.appliedSummaries).toContain('NPC档案x1');
    expect(application.ignoredSummaries.join('\n')).toContain('不得把主角本人创建或更新为 NPC 档案');
  });

  it('does not accept protagonist self-clone NPC profile repairs for compliance', () => {
    const result = tryApplyNpcProfileForCompliance(
      makeProtagonistBoundaryState(),
      makeProtagonistCloneSuggestion(),
    );

    expect(result.accepted).toBe(false);
    expect(result.state.npcs?.some((npc) => npc.npcId === 'npc_liuzhi')).toBe(false);
  });

  it('keeps a mandatory NPC base profile when optional arts or loadout structures are invalid', () => {
    const profile = makeNpcProfileSuggestion({
      npcId: 'npc_weiyan_admission',
      name: '魏延',
      role: '左垒先锋将',
      currentIdentity: '主角正式任命的左垒先锋将',
      persistenceReason: 'player_committed_relationship',
      persistenceEvidence: '本回合魏延已经接受招募并被正式任命为左垒先锋将。',
      summary: '魏延已接受招募，开始承担左垒先锋军务。',
      relationToPlayer: '受主角正式任命的先锋将',
      uniqueArts: [{
        id: 'art_weiyan_invalid',
        name: '长刀破阵',
        rarity: 'orange',
        domain: 'personalCombat',
        level: 4,
        description: '以长刀冲阵。',
        effectSummary: '强化破阵能力。',
        source: '人物经历',
      } as any],
      equipment: [{
        id: 'eq_weiyan_invalid',
        slot: 'weapon',
        name: '御赐长刀',
        quality: '御赐' as any,
        description: '身份来源误写成了装备品级。',
      }],
    });

    const result = tryApplyNpcProfileForCompliance(makeState(), profile);

    expect(result.accepted).toBe(true);
    expect(result.acceptedProfile).toMatchObject({
      npcId: 'npc_weiyan_admission',
      name: '魏延',
    });
    expect(result.acceptedProfile?.uniqueArts).toBeUndefined();
    expect(result.acceptedProfile?.equipment).toBeUndefined();
    expect(result.state.npcs?.find((npc) => npc.npcId === 'npc_weiyan_admission')).toMatchObject({
      name: '魏延',
      currentIdentity: '主角正式任命的左垒先锋将',
    });
    expect(result.diagnostics.join('\n')).toContain('已保留人物基础档案');
    expect(result.diagnostics.join('\n')).toContain('绝艺子结构');
    expect(result.diagnostics.join('\n')).toContain('行装子结构');
  });

  it('still accepts same-name NPC profile suggestions when identity evidence is distinct', () => {
    const application = applyNarratorWriteback(makeProtagonistBoundaryState(), {
      protagonistMemory: null,
      npcProfileSuggestions: [
        makeNpcProfileSuggestion({
          npcId: 'npc_liuzhi_namesake',
          name: '刘峙',
          courtesyName: '伯山',
          age: 36,
          role: '同名宗族旁支',
          currentIdentity: '汝南逃难士人',
          summary: '与主角同名的宗族旁支，另有明确履历。',
          relationToPlayer: '同名族人，正寻求投靠。',
        }),
      ],
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      signalChanges: [],
      plotPlanSuggestions: [],
      worldEventUpdates: [],
      debugNotes: [],
    }, worldBook);

    expect(application.ignoredSummaries).toEqual([]);
    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_liuzhi_namesake')).toMatchObject({
      name: '刘峙',
      courtesyName: '伯山',
      currentIdentity: '汝南逃难士人',
    });
  });

  it('preserves and deep-clones full NPC loadout fields through profile validation and reduction', () => {
    const equipment = {
      id: 'eq_profile_sabre',
      slot: 'weapon' as const,
      name: '校尉环首刀',
      quality: 'blue',
      description: '随身佩刀。',
      condition: '完好',
      statBonuses: { 武力: 4 },
      promptHint: '近身格斗时生效。',
      checkHooks: [{ scope: 'personalCombat.melee', modifier: 4, note: '佩刀顺手。' }],
      unlocks: ['近身拦截'],
      risks: ['狭窄处受限'],
    };
    const inventory = {
      id: 'item_profile_token',
      name: '军府符牌',
      quantity: 1,
      description: '验明军府身份。',
      category: 'token',
      quality: 'green',
      equipSlot: 'treasure' as const,
      condition: '完好',
      statBonuses: { 交涉: 3 },
      promptHint: '验明身份时生效。',
      checkHooks: [{ scope: 'ordinaryCheck.identity', modifier: 3, note: '符牌可信。' }],
      unlocks: ['进入军府'],
      risks: ['遗失会被追责'],
      keyItem: true,
      updatedAt: 'day 1',
    };
    const profile = makeNpcProfileSuggestion({ equipment: [equipment], inventory: [inventory] });

    const application = applyNarratorWriteback(makeState(), {
      protagonistMemory: null,
      npcProfileSuggestions: [profile],
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      debugNotes: [],
    }, worldBook);
    const stored = application.state.npcs?.find((npc) => npc.npcId === profile.npcId);

    expect(application.ignoredSummaries).toEqual([]);
    expect(stored?.equipment?.[0]).toEqual(equipment);
    expect(stored?.inventory?.[0]).toEqual(inventory);
    expect(stored?.equipment?.[0]).not.toBe(equipment);
    expect(stored?.equipment?.[0].statBonuses).not.toBe(equipment.statBonuses);
    expect(stored?.equipment?.[0].checkHooks).not.toBe(equipment.checkHooks);
    expect(stored?.inventory?.[0]).not.toBe(inventory);
    expect(stored?.inventory?.[0].statBonuses).not.toBe(inventory.statBonuses);
    expect(stored?.inventory?.[0].checkHooks).not.toBe(inventory.checkHooks);

    equipment.statBonuses.武力 = 99;
    equipment.checkHooks[0].modifier = 99;
    equipment.unlocks[0] = '被篡改';
    inventory.statBonuses.交涉 = 99;
    inventory.checkHooks[0].modifier = 99;
    inventory.risks[0] = '被篡改';

    expect(stored?.equipment?.[0].statBonuses).toEqual({ 武力: 4 });
    expect(stored?.equipment?.[0].checkHooks?.[0].modifier).toBe(4);
    expect(stored?.equipment?.[0].unlocks).toEqual(['近身拦截']);
    expect(stored?.inventory?.[0].statBonuses).toEqual({ 交涉: 3 });
    expect(stored?.inventory?.[0].checkHooks?.[0].modifier).toBe(3);
    expect(stored?.inventory?.[0].risks).toEqual(['遗失会被追责']);
  });

  it('reports invalid parsed NPC loadout fields instead of accepting a cleaned profile', () => {
    const invalidProfile = makeNpcProfileSuggestion({
      npcId: 'npc_invalid_loadout',
      equipment: [{
        id: 'eq_invalid', slot: 'ring' as any, name: '错误装备', quality: '未知', description: '错误样本。',
        statBonuses: { 武力: 'bad' as any },
        checkHooks: [{ scope: 'combat', modifier: Number.POSITIVE_INFINITY, note: '非法。' }],
      }],
      inventory: [{ id: 'item_invalid', name: '错误物品', quantity: Number.POSITIVE_INFINITY }],
    });
    const parsed = parseNarratorResponse(JSON.stringify({
      narrativeText: '非法行装候选。',
      writeback: { npcProfileSuggestions: [invalidProfile] },
    }).replace(/null/g, '1e400'));

    const application = applyNarratorWriteback(makeState(), parsed.writeback, worldBook);

    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_invalid_loadout')).toBe(false);
    expect(application.ignoredSummaries.join('\n')).toContain('upsertNpcProfile.equipment[0].slot 非法');
    expect(application.ignoredSummaries.join('\n')).toContain('upsertNpcProfile.equipment[0].statBonuses');
    expect(application.ignoredSummaries.join('\n')).toContain('upsertNpcProfile.inventory[0].quantity');
  });

  it('reports a non-array loadout candidate when updating an existing NPC', () => {
    const existingProfile = makeNpcProfileSuggestion({
      equipment: [{
        id: 'eq_existing', slot: 'weapon', name: '旧佩刀', quality: '普通', description: '既有合法装备。',
      }],
    });
    const state = {
      ...makeState(),
      npcs: [{ ...existingProfile, memories: [] }],
    } as RuntimeState;
    const incoming = {
      ...makeNpcProfileSuggestion(),
      equipment: { id: 'not_an_array' },
    };
    const parsed = parseNarratorResponse(JSON.stringify({
      narrativeText: '返回了错误装备容器。',
      writeback: { npcProfileSuggestions: [incoming] },
    }));

    const application = applyNarratorWriteback(state, parsed.writeback, worldBook);

    expect(application.ignoredSummaries.join('\n')).toContain('upsertNpcProfile.equipment 必须是装备数组');
    expect(application.state.npcs?.[0].equipment?.[0].id).toBe('eq_existing');
  });

  it('stores turnSummary in layered recent story memory while keeping the full turn log untouched', () => {
    const state = makeState();
    const application = applyNarratorWriteback(
      state,
      {
        turnSummary: {
          brief: '主角在甲地向门候问出戒严消息。',
          playerActionSummary: '主角低声询问城门戒严缘由。',
          visibleConsequence: '门候提醒主角不要久留。',
          memoryImportance: 'high',
        },
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.turnLog[0].narrativeText).toBe('looked');
    expect(application.state.memoryArchive?.recentTurnSummaries).toHaveLength(1);
    expect(application.state.memoryArchive?.recentTurnSummaries[0]).toMatchObject({
      turnNumber: 1,
      createdAt: 'day 1',
      playerInput: 'look',
      brief: '主角在甲地向门候问出戒严消息。',
      playerActionSummary: '主角低声询问城门戒严缘由。',
      visibleConsequence: '门候提醒主角不要久留。',
      importance: 'high',
    });
    expect(application.appliedSummaries).toContain('近期剧情记忆');
  });

  it('upserts one recent story memory per turn when the same writeback is applied again', () => {
    const writeback = {
      turnSummary: {
        brief: '主角在甲地确认城门戒严。',
        playerActionSummary: '主角追问守卒，确认封门缘由。',
        visibleConsequence: '守卒暗示城中将有变故。',
        memoryImportance: 'medium' as const,
      },
      protagonistMemory: null,
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      worldEventSummary: null,
      debugNotes: [],
    };

    const first = applyNarratorWriteback(makeState(), writeback, worldBook);
    const firstEntryId = first.state.memoryArchive?.recentTurnSummaries[0]?.id;
    const second = applyNarratorWriteback(first.state, writeback, worldBook);

    expect(second.state.memoryArchive?.recentTurnSummaries).toHaveLength(1);
    expect(second.state.memoryArchive?.recentTurnSummaries[0]).toMatchObject({
      id: firstEntryId,
      turnNumber: 1,
      brief: '主角在甲地确认城门戒严。',
    });
  });

  it('keeps archived recent summaries above the compression threshold', () => {
    const state = makeState();
    state.currentDate = 'day 4';
    state.turnLog = Array.from({ length: 4 }, (_, index) => ({
      turnNumber: index + 1,
      date: `day ${index + 1}`,
      playerInput: `action ${index + 1}`,
      narrativeText: `narrative ${index + 1}`,
      timestamp: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      statePatchSummary: 'none',
    }));
    state.memoryArchive!.settings = {
      ...state.memoryArchive!.settings,
      recentTurnLimit: 2,
      recentTurnCompressThreshold: 3,
      recentTurnKeepAfterCompress: 1,
    };
    state.memoryArchive!.recentTurnSummaries = Array.from({ length: 3 }, (_, index) => ({
      id: `recent_${index + 1}`,
      turnNumber: index + 1,
      createdAt: `day ${index + 1}`,
      playerInput: `action ${index + 1}`,
      brief: `brief ${index + 1}`,
      importance: 'medium' as const,
    }));

    const application = applyNarratorWriteback(
      state,
      {
        turnSummary: {
          brief: '主角在第四日确认城门戒严仍未解除。',
          playerActionSummary: '主角再次询问守卒。',
          visibleConsequence: '守卒提醒主角不要久留。',
          memoryImportance: 'medium',
        },
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.memoryArchive?.recentTurnSummaries).toHaveLength(4);
    expect(shouldCreateRecentTurnSummaryTask(application.state)).toBe(true);
  });

  it('does not duplicate protagonist recent memory or key deeds when a writeback is replayed', () => {
    const writeback = {
      turnSummary: null,
      protagonistMemory: {
        recentTurnSummary: '确认身份：以北军军侯身份卷入洛阳乱局。',
        keyDeed: {
          summary: '在洛阳宫门外稳住北军残部。',
          impact: '北军旧卒开始听从主角号令。',
          locationId: 'place_a',
        },
      },
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      worldEventSummary: null,
      debugNotes: [],
    };

    const first = applyNarratorWriteback(makeState(), writeback, worldBook);
    const second = applyNarratorWriteback(first.state, writeback, worldBook);

    expect(second.state.player.playerMemory?.recentTurns).toEqual([
      '确认身份：以北军军侯身份卷入洛阳乱局。',
    ]);
    expect(second.state.player.playerMemory?.keyDeeds).toHaveLength(1);
    expect(second.state.player.playerMemory?.keyDeeds[0]).toMatchObject({
      id: expect.stringMatching(/^player_deed_[0-9a-f]{8}$/),
      date: 'day 1',
      locationId: 'place_a',
      summary: '在洛阳宫门外稳住北军残部。',
      impact: '北军旧卒开始听从主角号令。',
    });
  });

  it('applies protagonistProfile writeback to the player archive without parsing memory text', () => {
    const state = {
      ...makeState(),
      player: {
        ...makeState().player,
        birthOrigin: '宗室支脉',
        currentIdentity: '军中将校',
        summary: '旧的概念身份。',
      },
    };

    const application = applyNarratorWriteback(
      state,
      {
        protagonistProfile: {
          birthOrigin: '汉室远支',
          birthOriginDescription: '宗室名分尚在，但远离权力中枢。',
          currentIdentity: '北军军侯',
          currentIdentityDescription: '统带北军一部的低阶军官，正被洛阳乱局卷入。',
          militaryTitle: '北军军侯',
          appearance: '年少而清瘦，甲衣尚新，眉眼里有压不住的警觉。',
          personality: '谨慎敏锐，重承诺，也知道乱局里不能轻信人。',
          identitySummary: '汉室远支出身的北军军侯。',
          personalEscortEntitlement: {
            status: 'customary',
            bases: ['military_command'],
            updatedAt: 'day 1',
          },
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
      } as any,
      worldBook,
      { allowProtagonistProfileOverwrite: true },
    );

    expect(application.state.player).toMatchObject({
      birthOrigin: '汉室远支',
      currentIdentity: '北军军侯',
      militaryTitle: '北军军侯',
      appearance: '年少而清瘦，甲衣尚新，眉眼里有压不住的警觉。',
      personality: '谨慎敏锐，重承诺，也知道乱局里不能轻信人。',
      identitySummary: '汉室远支出身的北军军侯。',
    });
    expect(application.state.player.playerMemory?.summary).toBe('汉室远支出身的北军军侯。');
    expect(application.state.player.playerMemory?.recentTurns).toContain('确定身份：以汉室远支之身，担任北军军侯。');
    expect(application.appliedSummaries).toContain('主角档案');
  });

  it('does not overwrite stable player origin and identity from ordinary protagonistProfile writeback', () => {
    const baseState = makeState();
    const state = {
      ...baseState,
      player: {
        ...baseState.player,
        birthOrigin: 'stable origin',
        birthOriginDescription: 'stable origin description',
        currentIdentity: 'stable identity',
        currentIdentityDescription: 'stable identity description',
        militaryTitle: 'stable military title',
        appearance: 'stable appearance',
        personality: 'stable personality',
        identitySummary: 'stable identity summary',
        playerMemory: {
          summary: 'stable memory summary',
          keyDeeds: [],
          recentTurns: [],
        },
      },
    };

    const application = applyNarratorWriteback(
      state,
      {
        protagonistProfile: {
          birthOrigin: 'drifted origin',
          birthOriginDescription: 'drifted origin description',
          currentIdentity: 'drifted identity',
          currentIdentityDescription: 'drifted identity description',
          militaryTitle: 'drifted military title',
          appearance: 'drifted appearance',
          personality: 'drifted personality',
          identitySummary: 'drifted identity summary',
        },
        protagonistMemory: {
          recentTurnSummary: 'ordinary turn memory',
        },
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.state.player).toMatchObject({
      birthOrigin: 'stable origin',
      birthOriginDescription: 'stable origin description',
      currentIdentity: 'stable identity',
      currentIdentityDescription: 'stable identity description',
      militaryTitle: 'stable military title',
      appearance: 'stable appearance',
      personality: 'stable personality',
      identitySummary: 'stable identity summary',
    });
    expect(application.state.player.playerMemory?.summary).toBe('stable memory summary');
    expect(application.state.player.playerMemory?.recentTurns).toContain('ordinary turn memory');
    expect(application.appliedSummaries).not.toContain('涓昏妗ｆ');
  });

  it('applies structured permanent map nodes and concrete-place routes', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [
          {
            locationId: 'place_camp',
            name: '临时营地',
            kind: 'camp',
            mapLayer: 'place',
            parentId: 'region_root',
            summary: 'A camp that has become a stable place.',
            permanence: 'permanent',
          },
        ],
        routeWriteSuggestions: [
          {
            routeId: 'route_a_camp',
            fromPlaceId: 'place_a',
            toPlaceId: 'place_camp',
            name: '甲地到营地小路',
            routeKind: '小路',
            status: '可通行但危险',
            source: 'llm',
            knownLevel: '亲历',
            riskLevel: 45,
            standardTravelMinutes: 120,
          },
        ],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.mapNodes?.some((node) => node.id === 'place_camp')).toBe(true);
    expect(application.state.routeEdges?.some((route) => route.routeId === 'route_a_camp')).toBe(true);
    expect(application.state.routeEdges?.find((route) => route.routeId === 'route_a_camp')?.routeKind).toBe('小路');
    expect(application.appliedSummaries).toContain('地图地点x1');
    expect(application.appliedSummaries).toContain('路线x1');
  });

  it('archives worldEventSummary into worldTrends without mutating linked entities', () => {
    const initialState = makeState();
    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: {
          eventId: 'trend_gate_lockdown',
          title: 'Capital gate lockdown',
          summary: 'The capital gates are locked down after a palace order.',
          visibility: '公开',
          scope: 'regional',
          certainty: 'confirmed',
          severity: 'high',
          locationId: 'place_a',
          presentNpcIds: [],
          affectedNpcIds: ['npc_courier'],
          affectedFactionIds: ['faction_guard'],
          affectedPlaceIds: ['place_a'],
          affectedForceIds: ['force_gate_guard'],
          affectedHoldingIds: ['holding_gate'],
          consequenceTags: ['gate-lockdown'],
          outcomeSummary: 'Travel through the gate now requires official permission.',
          followUpHooks: ['find who signed the order'],
          sourceQuestIds: ['quest_gate'],
          sourceSignalIds: ['signal_gate'],
          sourceConflictIds: ['battle_gate'],
          npcAwarenessRefs: [
            { name: 'Cao Cao', contactLevel: 0, playerRelevance: ['world-event'] },
          ],
          threadId: 'thread_gate_lockdown',
          happenedAt: 'day 1 morning',
          knownToPlayer: true,
          source: 'courier report',
        },
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.state.turnEvents).toHaveLength(1);
    expect(application.state.worldTrends).toHaveLength(1);
    expect(application.state.worldTrends![0]).toMatchObject({
      trendId: 'trend_gate_lockdown',
      title: 'Capital gate lockdown',
      summary: 'The capital gates are locked down after a palace order.',
      knownToPlayer: true,
      severity: 'high',
      locationId: 'place_a',
      affectedNpcIds: ['npc_courier'],
      affectedFactionIds: ['faction_guard'],
      affectedPlaceIds: ['place_a'],
      affectedForceIds: ['force_gate_guard'],
      affectedHoldingIds: ['holding_gate'],
      consequenceTags: ['gate-lockdown'],
      outcomeSummary: 'Travel through the gate now requires official permission.',
      followUpHooks: ['find who signed the order'],
      sourceQuestIds: ['quest_gate'],
      sourceSignalIds: ['signal_gate'],
      sourceConflictIds: ['battle_gate'],
      npcAwarenessRefs: [{ name: 'Cao Cao', contactLevel: 0, playerRelevance: ['world-event'] }],
      threadId: 'thread_gate_lockdown',
      happenedAt: 'day 1 morning',
      learnedAt: 'day 1',
      source: 'courier report',
    });
    expect(application.state.npcAwarenessIndex?.[0]).toMatchObject({
      name: 'Cao Cao',
      sourceType: 'worldTrend',
      sourceIds: ['trend_gate_lockdown'],
      archiveVisible: false,
    });
    expect(application.state.npcs).toEqual([]);
    expect(application.state.locations).toEqual(initialState.locations);
    expect(application.appliedSummaries).toContain('天下纪事');
  });

  it('keeps a local protagonist event in the turn ledger without promoting it into a world chronicle', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: {
          eventId: 'event_recruit_local_retainer',
          title: 'Recruit a local retainer',
          summary: 'The player recruited one capable retainer.',
          status: 'active',
          visibility: '私密',
          scope: 'local',
          certainty: 'confirmed',
          severity: 'high',
          locationId: 'place_a',
          presentNpcIds: [],
          affectedNpcIds: ['npc_retainer'],
          sourceQuestIds: ['quest_recruit_retainer'],
        },
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.state.turnEvents).toHaveLength(1);
    expect(application.state.worldTrends).toHaveLength(0);
    expect(application.appliedSummaries).not.toContain('天下纪事');
    expect(application.ignoredSummaries.join('\n')).toContain('纪事未收录');
  });

  it('marks completed current matters as terminal history in the same writeback', () => {
    const state = {
      ...makeState(),
      activeQuests: [{
        id: 'quest_recruit_strategist',
        title: 'Recruit the strategist',
        description: 'Find and recruit the strategist.',
        status: 'active',
        createdAt: 'day 1',
        updatedAt: 'day 1',
      }],
    } as RuntimeState;
    const application = applyNarratorWriteback(state, {
      protagonistMemory: null,
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [{
        action: 'complete',
        questId: 'quest_recruit_strategist',
        summary: 'The strategist formally joined.',
        outcomeSummary: 'The strategist became the chief adviser.',
      }],
      worldEventSummary: null,
      debugNotes: [],
    }, worldBook);

    expect(application.state.activeQuests[0]).toMatchObject({
      status: 'completed',
      archivedAt: 'day 1',
      outcomeSummary: 'The strategist became the chief adviser.',
    });
  });

  it('normalizes worldEventSummary visibility aliases before writing turn events', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: {
          eventId: 'trend_gate_watch',
          title: 'Gate watch',
          summary: 'The player witnesses guards tightening the palace gate watch.',
          visibility: 'in_presence',
          scope: 'local',
          certainty: 'confirmed',
          severity: 'medium',
          locationId: 'place_a',
          presentNpcIds: [],
          threadId: 'thread_gate_watch',
          knownToPlayer: true,
          source: 'direct observation',
        },
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.ignoredSummaries.join('\n')).toContain('纪事未收录');
    expect(application.state.turnEvents).toHaveLength(1);
    expect(application.state.turnEvents?.[0]).toMatchObject({
      visibility: '在场可知',
    });
  });

  it('applies questChanges and signalChanges into current matters and signals without mutating linked entities', () => {
    const initialState = makeState();
    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [
          {
            action: 'add',
            questId: 'quest_guard_bridge',
            title: 'Guard the bridge',
            summary: 'The player agreed to hold the bridge until dawn.',
            currentStep: 'Reach the bridge before nightfall.',
            stakes: 'If ignored, the pursuers may cross freely.',
            deadlineAt: 'day 2 dawn',
            priority: 'high',
            consequenceTags: ['bridge-control'],
            affectedPlaceIds: ['place_a'],
            followUpHooks: ['decide who commands the bridge guard'],
            severity: 'major',
            threadId: 'thread_bridge',
          },
        ],
        signalChanges: [
          {
            action: 'add',
            rumorId: 'signal_bridge_spies',
            title: 'Spies near the bridge',
            content: 'Travelers report strangers watching the bridge road.',
            source: 'roadside traveler',
            signalType: 'report',
            confidence: 'medium',
            potentialOutcomeSummary: 'The bridge may be targeted tonight.',
            consequenceTags: ['ambush-risk'],
            affectedPlaceIds: ['place_a'],
            followUpHooks: ['question the travelers'],
            severity: 'moderate',
            threadId: 'thread_bridge',
          },
        ],
        worldEventSummary: null,
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.state.activeQuests).toHaveLength(1);
    expect(application.state.activeQuests[0]).toMatchObject({
      id: 'quest_guard_bridge',
      title: 'Guard the bridge',
      description: 'The player agreed to hold the bridge until dawn.',
      status: 'active',
      currentStep: 'Reach the bridge before nightfall.',
      stakes: 'If ignored, the pursuers may cross freely.',
      deadlineAt: 'day 2 dawn',
      priority: 'high',
      consequenceTags: ['bridge-control'],
      affectedPlaceIds: ['place_a'],
      followUpHooks: ['decide who commands the bridge guard'],
      severity: 'major',
      threadId: 'thread_bridge',
      createdAt: 'day 1',
      updatedAt: 'day 1',
    });
    expect(application.state.knownRumors).toHaveLength(1);
    expect(application.state.knownRumors[0]).toMatchObject({
      id: 'signal_bridge_spies',
      title: 'Spies near the bridge',
      content: 'Travelers report strangers watching the bridge road.',
      source: 'roadside traveler',
      signalType: 'report',
      confidence: 'medium',
      potentialOutcomeSummary: 'The bridge may be targeted tonight.',
      consequenceTags: ['ambush-risk'],
      affectedPlaceIds: ['place_a'],
      followUpHooks: ['question the travelers'],
      severity: 'moderate',
      threadId: 'thread_bridge',
      verified: false,
      createdAt: 'day 1',
    });
    expect(application.state.npcs).toEqual(initialState.npcs);
    expect(application.state.locations).toEqual(initialState.locations);
    expect(application.appliedSummaries).toContain('当前事项x1');
    expect(application.appliedSummaries).toContain('风声线索x1');
  });

  it('awards bounded quest experience only on the first completed writeback', () => {
    const initialState = {
      ...makeState(),
      player: {
        ...makeState().player,
        level: 1,
        xp: 80,
        growthPoints: 1,
      },
      activeQuests: [{
        id: 'quest_rewarded_bridge',
        title: '守住石桥',
        description: '守桥直到援军抵达。',
        status: 'active',
        createdAt: 'day 1',
        updatedAt: 'day 1',
      }],
    } as any;
    const writeback = {
      protagonistMemory: null,
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [{
        action: 'complete',
        questId: 'quest_rewarded_bridge',
        outcomeSummary: '援军抵达，石桥守住。',
        experienceReward: 30,
      }],
      worldEventSummary: null,
      debugNotes: [],
    } as any;

    const completed = applyNarratorWriteback(initialState, writeback, worldBook);

    expect(completed.state.activeQuests[0].status).toBe('completed');
    expect(completed.state.activeQuests[0].completionExperienceAwarded).toBe(30);
    expect(completed.state.player).toMatchObject({ level: 2, xp: 10, growthPoints: 6 });
    expect(completed.appliedSummaries.join('\n')).toContain('获得阅历 30');

    const reopenedState = {
      ...completed.state,
      activeQuests: completed.state.activeQuests.map((quest) => ({ ...quest, status: 'active' as const })),
    };
    const repeated = applyNarratorWriteback(reopenedState, writeback, worldBook);

    expect(repeated.state.player).toMatchObject({ level: 2, xp: 10, growthPoints: 6 });
    expect(repeated.ignoredSummaries.join('\n')).toContain('重复');
  });

  it('derives quest experience from severity when the model omits the legacy reward field', () => {
    const initialState = {
      ...makeState(),
      player: {
        ...makeState().player,
        level: 2,
        xp: 0,
        growthPoints: 0,
      },
      activeQuests: [{
        id: 'quest_major_relief',
        title: '解围乡寨',
        description: '击退围寨流寇并安置乡民。',
        severity: 'major',
        status: 'active',
        createdAt: 'day 1',
        updatedAt: 'day 1',
      }],
    } as any;

    const completed = applyNarratorWriteback(initialState, {
      protagonistMemory: null,
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [{
        action: 'complete',
        questId: 'quest_major_relief',
        outcomeSummary: '流寇退去，乡民得到安置。',
      }],
      worldEventSummary: null,
      debugNotes: [],
    } as any, worldBook);

    expect(completed.state.activeQuests[0].completionExperienceAwarded).toBe(100);
    expect(completed.state.player).toMatchObject({ level: 2, xp: 100, growthPoints: 0 });
    expect(completed.appliedSummaries.join('\n')).toContain('获得阅历 100');
  });

  it.each([
    ['update', 20],
    ['archive', 20],
    ['complete', -1],
    ['complete', 1001],
  ])('rejects quest experience on invalid lifecycle or amount: %s / %s', (action, experienceReward) => {
    const initialState = {
      ...makeState(),
      player: { ...makeState().player, level: 1, xp: 0, growthPoints: 0 },
      activeQuests: [{
        id: 'quest_invalid_reward',
        title: '无效奖励测试',
        description: '用于校验奖励门禁。',
        status: 'active',
        createdAt: 'day 1',
        updatedAt: 'day 1',
      }],
    } as any;

    const application = applyNarratorWriteback(initialState, {
      protagonistMemory: null,
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [{
        action,
        questId: 'quest_invalid_reward',
        experienceReward,
        archiveReason: action === 'archive' ? '事项归档。' : undefined,
      }],
      worldEventSummary: null,
      debugNotes: [],
    } as any, worldBook);

    expect(application.state.player).toMatchObject({ level: 1, xp: 0, growthPoints: 0 });
    expect(application.ignoredSummaries.join('\n')).toContain('experienceReward');
  });

  it('applies lifecycle updates and archives old dynamic entries without deleting history', () => {
    const initialState = {
      ...makeState(),
      activeQuests: [
        {
          id: 'quest_old_lead',
          title: 'Old lead',
          description: 'Follow an old lead.',
          status: 'active',
          currentStep: 'Ask at the old ferry.',
          createdAt: 'day 1',
          updatedAt: 'day 1',
        },
      ],
      knownRumors: [
        {
          id: 'signal_chenliu_letter',
          title: 'Chenliu letter',
          content: 'A letter may arrive from Chenliu.',
          source: 'merchant',
          status: 'open',
          confidence: 'medium',
          verified: false,
          createdAt: 'day 1',
        },
        {
          id: 'signal_stale_patrol',
          title: 'Stale patrol',
          content: 'A patrol was seen near the ford.',
          source: 'traveler',
          status: 'open',
          verified: false,
          createdAt: 'day 1',
        },
      ],
      worldTrends: [
        {
          trendId: 'trend_chenliu_muster',
          title: 'Chenliu muster',
          severity: 'high',
          summary: 'Chenliu forces are gathering.',
          knownToPlayer: true,
          status: 'active',
          scope: 'regional',
          affectedFactionIds: ['faction_chenliu'],
          progressSummary: 'Chenliu forces remain in assembly.',
          nextCheckAt: 'day 2',
          happenedAt: 'day 1',
          updatedAt: 'day 1',
        },
      ],
    } as any;

    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [
          {
            action: 'archive',
            questId: 'quest_old_lead',
            summary: 'The old ferry lead is no longer current.',
            archiveReason: 'The player chose a different route.',
          },
        ],
        signalChanges: [
          {
            action: 'verify',
            rumorId: 'signal_chenliu_letter',
            content: 'A letter has arrived from Chenliu.',
            confidence: 'high',
            convertedToQuestIds: ['quest_visit_chenliu'],
          },
          {
            action: 'archive',
            rumorId: 'signal_stale_patrol',
            archiveReason: 'The patrol report is stale.',
          },
        ],
        worldEventUpdates: [
          {
            eventId: 'trend_chenliu_muster',
            status: 'historical',
            summary: 'The Chenliu muster is now background context.',
            archiveReason: 'Its immediate pressure has passed.',
          },
        ],
        worldEventSummary: null,
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.state.activeQuests).toHaveLength(1);
    expect(application.state.activeQuests[0]).toMatchObject({
      id: 'quest_old_lead',
      status: 'archived',
      outcomeSummary: 'The old ferry lead is no longer current.',
      archiveReason: 'The player chose a different route.',
      archivedAt: 'day 1',
      updatedAt: 'day 1',
    });
    expect(application.state.knownRumors).toHaveLength(2);
    expect(application.state.knownRumors.find((signal) => signal.id === 'signal_chenliu_letter')).toMatchObject({
      status: 'verified',
      confidence: 'high',
      verified: true,
      content: 'A letter has arrived from Chenliu.',
      convertedToQuestIds: ['quest_visit_chenliu'],
    });
    expect(application.state.knownRumors.find((signal) => signal.id === 'signal_stale_patrol')).toMatchObject({
      status: 'archived',
      archiveReason: 'The patrol report is stale.',
      archivedAt: 'day 1',
    });
    expect(application.state.worldTrends?.[0]).toMatchObject({
      trendId: 'trend_chenliu_muster',
      status: 'historical',
      summary: 'The Chenliu muster is now background context.',
      archiveReason: 'Its immediate pressure has passed.',
      archivedAt: 'day 1',
      updatedAt: 'day 1',
    });
  });

  it('archives current matters without requiring a repeated summary', () => {
    const initialState = {
      ...makeState(),
      activeQuests: [
        {
          id: 'quest_stale_supply',
          title: 'Stale supply lead',
          description: 'Check whether the old supply lead is still useful.',
          status: 'active',
          currentStep: 'Ask the quartermaster.',
          createdAt: 'day 1',
          updatedAt: 'day 1',
          threadId: 'thread_supply',
        },
      ],
    } as any;

    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [
          {
            action: 'archive',
            questId: 'quest_stale_supply',
            outcomeSummary: 'The lead is obsolete after the player secured another route.',
            archiveReason: 'Resolved by a later choice.',
          },
        ],
        worldEventSummary: null,
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.state.activeQuests).toHaveLength(1);
    expect(application.state.activeQuests[0]).toMatchObject({
      id: 'quest_stale_supply',
      status: 'archived',
      outcomeSummary: 'The lead is obsolete after the player secured another route.',
      archiveReason: 'Resolved by a later choice.',
      archivedAt: 'day 1',
      updatedAt: 'day 1',
    });
    expect(application.appliedSummaries).toContain('当前事项x1');
  });

  it('reuses an existing current matter when an add writeback keeps threadId but drifts questId', () => {
    const initialState = {
      ...makeState(),
      activeQuests: [
        {
          id: 'quest_supply_original',
          title: 'Supply chance',
          description: 'A chance to recover grain.',
          status: 'active',
          currentStep: 'Scout the market.',
          createdAt: 'day 1',
          updatedAt: 'day 1',
          threadId: 'thread_supply',
        },
      ],
    } as any;

    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [
          {
            action: 'add',
            questId: 'quest_supply_drifted',
            title: 'Supply chance updated',
            summary: 'The same supply thread now points to a safer granary route.',
            currentStep: 'Choose whether to approach the granary.',
            threadId: 'thread_supply',
          },
        ],
        worldEventSummary: null,
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.state.activeQuests).toHaveLength(1);
    expect(application.state.activeQuests[0]).toMatchObject({
      id: 'quest_supply_original',
      title: 'Supply chance updated',
      description: 'The same supply thread now points to a safer granary route.',
      currentStep: 'Choose whether to approach the granary.',
      status: 'active',
      threadId: 'thread_supply',
      updatedAt: 'day 1',
    });
  });

  it('reuses an active current matter when an add writeback keeps title but drifts id and omits threadId', () => {
    const initialState = {
      ...makeState(),
      activeQuests: [
        {
          id: 'quest_establish_foundation',
          title: 'Establish foothold',
          description: 'Find a durable opening in the turmoil.',
          status: 'active',
          currentStep: 'Decide where to stand.',
          createdAt: 'day 1',
          updatedAt: 'day 1',
        },
      ],
    } as any;

    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [
          {
            action: 'add',
            questId: '5062fbd5-deed-421f-bd91-a9a48f67b289',
            title: 'Establish foothold',
            summary: 'The same foothold matter now points toward a safer patron.',
            currentStep: 'Choose whether to approach the patron.',
          },
        ],
        worldEventSummary: null,
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.state.activeQuests).toHaveLength(1);
    expect(application.state.activeQuests[0]).toMatchObject({
      id: 'quest_establish_foundation',
      title: 'Establish foothold',
      description: 'The same foothold matter now points toward a safer patron.',
      currentStep: 'Choose whether to approach the patron.',
      status: 'active',
      updatedAt: 'day 1',
    });
  });

  it('reuses an existing signal when an add writeback keeps threadId but drifts rumorId', () => {
    const initialState = {
      ...makeState(),
      knownRumors: [
        {
          id: 'signal_supply_original',
          title: 'Supply rumor',
          content: 'People whisper about exposed grain carts.',
          source: 'traveler',
          status: 'open',
          confidence: 'medium',
          verified: false,
          createdAt: 'day 1',
          threadId: 'thread_supply',
        },
      ],
    } as any;

    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        signalChanges: [
          {
            action: 'add',
            rumorId: 'signal_supply_drifted',
            title: 'Supply rumor updated',
            content: 'The same rumor now points to the east granary.',
            source: 'scout',
            confidence: 'high',
            threadId: 'thread_supply',
          },
        ],
        worldEventSummary: null,
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.state.knownRumors).toHaveLength(1);
    expect(application.state.knownRumors[0]).toMatchObject({
      id: 'signal_supply_original',
      title: 'Supply rumor updated',
      content: 'The same rumor now points to the east granary.',
      source: 'scout',
      confidence: 'high',
      status: 'open',
      threadId: 'thread_supply',
    });
  });

  it('deduplicates same signal add writebacks even when only one carries a stable rumorId', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        signalChanges: [
          {
            action: 'add',
            title: '南阳客商私卖铁料',
            content: '襄阳城西客舍住着几个南阳来的私商，手里压着一批生熟铁锭，急需粮食，但不敢冒险将铁料运出城外。',
            source: '韩烈派出的心腹',
            signalType: 'clue',
            confidence: 'high',
            potentialOutcomeSummary: '若能成功交易并安全运出，左曲将获得打造兵器的关键原料。',
          },
          {
            action: 'add',
            rumorId: 'rumor_nanyang_iron_trade',
            title: '南阳客商私卖铁料',
            content: '襄阳城西客舍住着几个南阳来的私商，手里压着一批生熟铁锭，急需粮食，但不敢冒险将铁料运出城外。',
            source: '韩烈派出的心腹',
            status: 'open',
            signalType: 'clue',
            confidence: 'high',
            potentialOutcomeSummary: '若能成功交易并安全运出，左曲将获得打造兵器的关键原料。',
          },
        ],
        worldEventSummary: null,
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.state.knownRumors).toHaveLength(1);
    expect(application.state.knownRumors[0]).toMatchObject({
      title: '南阳客商私卖铁料',
      content: '襄阳城西客舍住着几个南阳来的私商，手里压着一批生熟铁锭，急需粮食，但不敢冒险将铁料运出城外。',
      source: '韩烈派出的心腹',
      signalType: 'clue',
      confidence: 'high',
      potentialOutcomeSummary: '若能成功交易并安全运出，左曲将获得打造兵器的关键原料。',
      status: 'open',
    });
  });

  it('reuses the unique active signal with the same display title when content and rumorId drift', () => {
    const initialState = {
      ...makeState(),
      knownRumors: [
        {
          id: 'rumor_bocai_camp_weakness',
          title: '长社黄巾大营破绽',
          content: '旧报称大营西侧夜间换防迟缓。',
          source: '先前斥候',
          status: 'open',
          signalType: 'clue',
          verified: false,
          createdAt: 'day 1',
        },
      ],
    } as any;

    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        signalChanges: [
          {
            action: 'add',
            rumorId: '2822320c-fcc7-4e86-89af-6af2d622ea3c',
            title: '长社黄巾大营破绽',
            content: '新报确认营后粮车入口守备松动，可继续核查。',
            source: '新到探马',
            signalType: 'clue',
            confidence: 'high',
          },
        ],
        worldEventSummary: null,
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.state.knownRumors).toHaveLength(1);
    expect(application.state.knownRumors[0]).toMatchObject({
      id: 'rumor_bocai_camp_weakness',
      title: '长社黄巾大营破绽',
      content: '新报确认营后粮车入口守备松动，可继续核查。',
      source: '新到探马',
      confidence: 'high',
    });
  });

  it('keeps same-title signals separate when both explicitly belong to different places', () => {
    const initialState = {
      ...makeState(),
      knownRumors: [
        {
          id: 'signal_north_gate_weakness',
          title: '城门守备破绽',
          content: '北门换防迟缓。',
          source: '北门探子',
          status: 'open',
          signalType: 'clue',
          affectedPlaceIds: ['loc_north_gate'],
          verified: false,
          createdAt: 'day 1',
        },
      ],
    } as any;

    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        signalChanges: [
          {
            action: 'add',
            rumorId: 'signal_south_gate_weakness',
            title: '城门守备破绽',
            content: '南门守军缺少弓弩。',
            source: '南门探子',
            signalType: 'clue',
            affectedPlaceIds: ['loc_south_gate'],
          },
        ],
        worldEventSummary: null,
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.state.knownRumors).toHaveLength(2);
    expect(application.state.knownRumors.map((signal) => signal.id)).toEqual([
      'signal_north_gate_weakness',
      'signal_south_gate_weakness',
    ]);
  });

  it('reuses an existing chronicle when worldEventSummary keeps threadId but drifts eventId', () => {
    const initialState = {
      ...makeState(),
      worldTrends: [
        {
          trendId: 'trend_supply_original',
          title: 'Supply raid',
          severity: 'high',
          summary: 'A supply raid is underway.',
          knownToPlayer: true,
          status: 'active',
          scope: 'regional',
          relatedFactionIds: ['faction_supply_allies'],
          sourceConflictIds: ['conflict_supply'],
          progressSummary: 'The raiders and defenders remain engaged.',
          nextCheckAt: 'day 2',
          happenedAt: 'day 1 morning',
          learnedAt: 'day 1 morning',
          updatedAt: 'day 1 morning',
          threadId: 'thread_supply',
        },
      ],
    } as any;

    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: {
          eventId: 'trend_supply_drifted',
          title: 'Supply raid updated',
          summary: 'The same supply raid is now confirmed near the east granary.',
          visibility: '公开',
          scope: 'regional',
          certainty: 'confirmed',
          severity: 'critical',
          locationId: 'place_a',
          threadId: 'thread_supply',
          knownToPlayer: true,
          source: 'field report',
          sourceConflictIds: ['conflict_supply'],
        },
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.state.worldTrends).toHaveLength(1);
    expect(application.state.worldTrends![0]).toMatchObject({
      trendId: 'trend_supply_original',
      title: 'Supply raid updated',
      summary: 'The same supply raid is now confirmed near the east granary.',
      severity: 'critical',
      status: 'active',
      happenedAt: 'day 1 morning',
      learnedAt: 'day 1 morning',
      locationId: 'place_a',
      relatedFactionIds: ['faction_supply_allies'],
      threadId: 'thread_supply',
      updatedAt: 'day 1',
    });
  });

  it('archives an ongoing chronicle when an update records a terminal outcome without continuation anchors', () => {
    const initialState = {
      ...makeState(),
      worldTrends: [{
        trendId: 'trend_regional_blockade',
        title: 'Regional blockade',
        severity: '高',
        summary: 'The blockade remains in force.',
        knownToPlayer: true,
        status: 'active',
        scope: 'regional',
        affectedFactionIds: ['faction_guard'],
        progressSummary: 'Both sides are still enforcing the blockade.',
        nextCheckAt: 'day 2',
        happenedAt: 'day 1',
        updatedAt: 'day 1',
      }],
    } as RuntimeState;

    const application = applyNarratorWriteback(initialState, {
      protagonistMemory: null,
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      worldEventUpdates: [{
        eventId: 'trend_regional_blockade',
        summary: 'The blockade has ended.',
        outcomeSummary: 'Traffic has resumed.',
      }],
      worldEventSummary: null,
      debugNotes: [],
    }, worldBook);

    expect(application.state.worldTrends?.[0]).toMatchObject({
      status: 'historical',
      archivedAt: 'day 1',
      outcomeSummary: 'Traffic has resumed.',
    });
    expect(application.state.worldTrends?.[0].progressSummary).toBeUndefined();
    expect(application.state.worldTrends?.[0].nextCheckAt).toBeUndefined();
  });

  it('rejects a worldEventUpdate that downgrades a chronicle into local player activity', () => {
    const initialState = {
      ...makeState(),
      worldTrends: [{
        trendId: 'trend_regional_order',
        title: 'Regional order',
        severity: '高',
        summary: 'A regional order affects the guard faction.',
        knownToPlayer: true,
        status: 'historical',
        scope: 'regional',
        affectedFactionIds: ['faction_guard'],
        happenedAt: 'day 1',
        updatedAt: 'day 1',
      }],
    } as RuntimeState;

    const application = applyNarratorWriteback(initialState, {
      protagonistMemory: null,
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      worldEventUpdates: [{
        eventId: 'trend_regional_order',
        scope: 'local',
        summary: 'The player held a private training session.',
      }],
      worldEventSummary: null,
      debugNotes: [],
    }, worldBook);

    expect(application.state.worldTrends?.[0]).toMatchObject({
      scope: 'regional',
      summary: 'A regional order affects the guard faction.',
    });
    expect(application.ignoredSummaries.join('\n')).toContain('worldEventUpdate rejected');
  });

  it('applies plotPlanSuggestions as hidden plot plan state', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        plotPlanSuggestions: [
          {
            action: 'add',
            plotId: 'plot_bridge_pressure',
            title: 'Bridge pressure builds',
            horizon: '近期',
            status: '进行中',
            priority: '高',
            summary: 'Hostile scouts are probing the bridge before a larger move.',
          },
        ],
        worldEventSummary: null,
        debugNotes: [],
      } as any,
      worldBook,
    );

    const plotPlan = application.state.plotPlan ?? [];
    expect(plotPlan).toHaveLength(1);
    expect(plotPlan[0]).toMatchObject({
      plotId: 'plot_bridge_pressure',
      title: 'Bridge pressure builds',
      horizon: '近期',
      status: '进行中',
      priority: '高',
      description: 'Hostile scouts are probing the bridge before a larger move.',
    });
    expect(application.appliedSummaries).toContain('剧情计划x1');
  });

  it('preserves plot plan timing fields from writeback suggestions', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        plotPlanSuggestions: [
          {
            action: 'add',
            plotId: 'plot_delayed_pressure',
            title: 'Delayed pressure',
            horizon: '中期',
            status: '进行中',
            priority: '高',
            summary: 'The pressure exists, but cannot resolve yet.',
            notBeforeAt: '0189-09-20 08:00',
            lastAdvancedAt: '0189-09-10 08:00',
          },
        ],
        worldEventSummary: null,
        debugNotes: [],
      } as any,
      worldBook,
    );

    expect(application.state.plotPlan?.[0]).toMatchObject({
      plotId: 'plot_delayed_pressure',
      notBeforeAt: '0189-09-20 08:00',
      lastAdvancedAt: '0189-09-10 08:00',
    });
  });

  it('applies NPC profile suggestions before NPC memories in the same writeback', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: null,
        npcProfileSuggestions: [
           {
             npcId: 'npc_gate_captain',
             name: '门候',
             persistenceReason: 'active_system_role',
             persistenceEvidence: '本回合已确认其长期负责洛阳城门盘查。',
            sex: '男',
            age: 39,
            role: '城门军吏',
            factionName: '洛阳守军',
            locationId: 'place_a',
            isPresent: true,
            isFocused: true,
            currentIdentity: '城门门候',
            summary: '负责城门盘查的中下层军吏。',
            appearance: '甲衣旧而整齐。',
            personality: '谨慎怕事，但懂规矩。',
            motivation: '想保住差事。',
            relationToPlayer: '初见，对主角保持戒心。',
            contactLevel: 8,
            recentAttitude: '戒备',
            abilityScores: { 武力: 55, 统率: 42, 智力: 45, 政治: 30, 魅力: 36, 机运: 48 },
            traits: [
              {
                id: 'trait_gate_routine',
                label: '熟悉城门规矩',
                description: '知道城门盘查、口令和守军换防的习惯。',
                source: 'identity',
                promptHint: '城门盘问、通行规矩、守军消息上更可靠。',
                checkHooks: [{ scope: '城门交涉', modifier: 6, note: '熟悉城门规矩。' }],
              },
            ],
          },
        ],
        npcMemorySuggestions: [
          {
            npcId: 'npc_gate_captain',
            npcName: '门候',
            source: '亲历',
            content: '主角在城门处向他追问戒严缘由。',
          },
        ],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    const npc = application.state.npcs?.find((item) => item.npcId === 'npc_gate_captain');
    expect(npc).toMatchObject({
      name: '门候',
      currentIdentity: '城门门候',
      abilityScores: { 武力: 55, 机运: 48 },
    });
    expect(npc?.traits?.[0]).toMatchObject({ label: '熟悉城门规矩' });
    expect(npc?.memories).toHaveLength(1);
    expect(npc?.memories[0].content).toContain('追问戒严缘由');
    expect(application.appliedSummaries).toContain('NPC档案x1');
    expect(application.appliedSummaries).toContain('NPC记忆x1');
  });

  it('canonicalizes a drifted NPC profile id when a heard-about NPC later appears in person', () => {
    const initialState = {
      ...makeState(),
      npcs: [
        {
          npcId: 'npc_wei_yan',
          name: '魏延',
          courtesyName: '文长',
          sex: '男',
          age: 24,
          role: '屯长',
          factionId: 'faction_jingzhou_liubiao',
          factionName: '荆州州府',
          locationId: 'place_a',
          isPresent: false,
          isFocused: false,
          birthOrigin: '荆州南阳郡义阳县',
          currentIdentity: '襄阳城东大营屯长',
          summary: '听闻中怀才不遇的义阳军官。',
          appearance: '身形高大，眉眼凌厉。',
          personality: '高傲不肯逢迎。',
          motivation: '想得明主赏识。',
          relationToPlayer: '尚未接触',
          contactLevel: 0,
          recentAttitude: '未知',
          abilityScores: { 武力: 82, 统率: 72, 智力: 55, 政治: 35, 魅力: 58, 机运: 48 },
          traits: [{ id: 'trait_proud_warrior', label: '傲骨武人', description: '不肯逢迎。', source: 'hearsay' }],
          memories: [],
        },
      ],
      activeQuests: [
        {
          id: 'quest_recruit_weiyan',
          title: '招揽魏延',
          description: '前往城东营盘接触魏延。',
          status: 'active',
          currentStep: '与魏延见面。',
          createdAt: 'day 1',
          updatedAt: 'day 1',
          relatedNpcIds: ['npc_wei_yan'],
        },
      ],
      relationships: [{
        id: 'relationship_player_weiyan',
        actorId: 'player',
        targetId: 'npc_wei_yan',
        targetKind: 'actor',
        targetType: 'actor',
        type: '听闻',
        value: 5,
        description: '主角此前只听闻其名。',
      }],
      npcAwarenessIndex: [{
        awarenessId: 'awareness_npc_wei_yan',
        npcId: 'npc_wei_yan',
        name: '魏延',
        sourceType: 'rumor',
        sourceIds: ['rumor_weiyan'],
        contactLevel: 0,
        playerRelevance: ['可招揽武将'],
        knownToPlayer: true,
        archiveVisible: true,
      }],
    } as any;

    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [
          {
            npcId: 'npc_wei_yan_present',
            name: '魏延',
            courtesyName: null,
            sex: '男',
            age: 26,
            role: '左曲武将',
            factionId: 'faction_player_force',
            factionName: '左曲',
            locationId: 'place_b',
            isPresent: true,
            isFocused: true,
            birthOrigin: '义阳人',
            currentIdentity: '投效主角的左曲武将',
            summary: '亲自见面后投效主角的义阳猛将。',
            appearance: '身长八尺，目光锐利。',
            personality: '骄傲刚烈，重视知遇之恩。',
            motivation: '追随赏识自己的主公建功。',
            relationToPlayer: '被主角折服，愿意投效。',
            contactLevel: 35,
            recentAttitude: '敬服',
            abilityScores: { 武力: 86, 统率: 76, 智力: 58, 政治: 38, 魅力: 62, 机运: 52 },
            traits: [{ id: 'trait_proud_warrior', label: '傲骨武人', description: '骄傲刚烈。', source: 'event' }],
          },
        ],
        npcMemorySuggestions: [
          {
            npcId: 'npc_wei_yan_present',
            npcName: '魏延',
            source: '亲历',
            content: '主角亲自到城东营盘见他，并折服其心。',
          },
        ],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [
          {
            action: 'update',
            questId: 'quest_recruit_weiyan',
            currentStep: '安置魏延入左曲任事。',
            relatedNpcIds: ['npc_wei_yan_present'],
          },
        ],
        worldEventSummary: {
          title: '魏延投效',
          summary: '主角在城东营盘见到魏延并使其投效。',
          visibility: '在场可知',
          locationId: 'place_a',
          presentNpcIds: ['npc_wei_yan_present'],
          involvedNpcIds: ['npc_wei_yan_present'],
        },
        debugNotes: [],
      } as any,
      worldBook,
    );

    const npcs = application.state.npcs ?? [];
    expect(npcs.filter((npc) => npc.name === '魏延')).toHaveLength(1);
    const npc = npcs.find((item) => item.npcId === 'npc_wei_yan');
    expect(npc).toMatchObject({
      name: '魏延',
      courtesyName: '文长',
      isPresent: true,
      currentIdentity: '投效主角的左曲武将',
    });
    expect(npc?.memories).toHaveLength(1);
    expect(npc?.memories[0].content).toContain('城东营盘见他');
    expect(application.state.activeQuests[0].relatedNpcIds).toEqual(['npc_wei_yan']);
    expect(application.state.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: 'npc_wei_yan', value: 5 }),
    ]));
    expect(application.state.npcAwarenessIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({ npcId: 'npc_wei_yan', sourceIds: ['rumor_weiyan'] }),
    ]));
    expect(application.state.turnEvents?.[0]).toMatchObject({
      presentNpcIds: ['npc_wei_yan'],
      involvedNpcIds: ['npc_wei_yan'],
    });
  });

  it('reuses a successful same-batch profile identity and remaps every writeback reference', () => {
    const initialState = {
      ...makeState(),
      worldTrends: [{
        trendId: 'event_vanguard_orders',
        title: '待下达的前锋军令',
        severity: '中',
        summary: '前锋军令尚未落定。',
        knownToPlayer: true,
        status: 'active',
        scope: 'regional',
        sourceConflictIds: ['conflict_vanguard'],
        progressSummary: '全军仍在执行前锋部署。',
        nextCheckAt: 'day 2',
        happenedAt: 'day 1',
        learnedAt: 'day 1',
        updatedAt: 'day 1',
      }],
    } as RuntimeState;
    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [
          makeNpcProfileSuggestion(),
          makeNpcProfileSuggestion({
            npcId: 'npc_zi_heng_duplicate',
            name: '子衡',
            courtesyName: null,
            aliases: ['沈岳'],
            role: '前锋将领',
            factionName: '新军',
            locationId: 'place_b',
            currentIdentity: '新军前锋将领',
            summary: '受命转任前锋。',
          }),
        ],
        npcMemorySuggestions: [{
          npcId: 'npc_zi_heng_duplicate',
          npcName: '沈岳',
          source: '亲历',
          content: '主角与他当面议定前锋部署。',
        }],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [{
          action: 'add',
          questId: 'quest_vanguard',
          title: '整顿前锋',
          summary: '与前锋将领确认部署。',
          relatedNpcIds: ['npc_zi_heng_duplicate'],
          affectedNpcIds: ['npc_zi_heng_duplicate'],
        }],
        signalChanges: [{
          action: 'add',
          rumorId: 'signal_vanguard',
          content: '前锋已经换将。',
          affectedNpcIds: ['npc_zi_heng_duplicate'],
          npcAwarenessRefs: [{ name: '沈岳', npcId: 'npc_zi_heng_duplicate' }],
        }],
        worldEventUpdates: [{
          eventId: 'event_vanguard_orders',
          summary: '前锋军令已经下达。',
          affectedNpcIds: ['npc_zi_heng_duplicate'],
          npcAwarenessRefs: [{ name: '沈岳', npcId: 'npc_zi_heng_duplicate' }],
        }],
        worldEventSummary: {
          eventId: 'event_vanguard_meeting',
          summary: '主角与前锋将领议定部署。',
          title: '前锋部署生效',
          scope: 'regional',
          severity: 'high',
          status: 'historical',
          sourceConflictIds: ['conflict_vanguard'],
          locationId: 'place_a',
          presentNpcIds: ['npc_zi_heng_duplicate'],
          involvedNpcIds: ['npc_zi_heng_duplicate'],
          affectedNpcIds: ['npc_zi_heng_duplicate'],
          npcAwarenessRefs: [{ name: '沈岳', npcId: 'npc_zi_heng_duplicate' }],
        },
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.filter((npc) => npc.npcId === 'npc_shen_yue')).toHaveLength(1);
    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_zi_heng_duplicate')).toBe(false);
    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_shen_yue')?.memories).toHaveLength(1);
    expect(application.state.activeQuests.find((quest) => quest.id === 'quest_vanguard')).toMatchObject({
      relatedNpcIds: ['npc_shen_yue'],
      affectedNpcIds: ['npc_shen_yue'],
    });
    expect(application.state.knownRumors.find((rumor) => rumor.id === 'signal_vanguard')).toMatchObject({
      affectedNpcIds: ['npc_shen_yue'],
      npcAwarenessRefs: [{ name: '沈岳', npcId: 'npc_shen_yue' }],
    });
    expect(application.state.worldTrends?.find((event) => event.trendId === 'event_vanguard_orders')).toMatchObject({
      affectedNpcIds: ['npc_shen_yue'],
      npcAwarenessRefs: [{ name: '沈岳', npcId: 'npc_shen_yue' }],
    });
    expect(application.state.worldTrends?.find((event) => event.trendId === 'event_vanguard_meeting')).toMatchObject({
      relatedNpcIds: ['npc_shen_yue'],
      affectedNpcIds: ['npc_shen_yue'],
      npcAwarenessRefs: [{ name: '沈岳', npcId: 'npc_shen_yue' }],
    });
    expect(application.state.turnEvents?.find((event) => event.summary.includes('议定部署'))).toMatchObject({
      presentNpcIds: ['npc_shen_yue'],
      involvedNpcIds: ['npc_shen_yue'],
    });
    expect(application.state.npcAwarenessIndex?.some((entry) => entry.npcId === 'npc_zi_heng_duplicate')).toBe(false);
  });

  it('rejects an exact npcId collision with a different identity name', () => {
    const archivedProfile = makeNpcProfileSuggestion({ npcId: 'npc_shen_yue', name: '沈岳' });
    const application = applyNarratorWriteback(
      { ...makeState(), npcs: [{ ...archivedProfile, memories: [] }] } as RuntimeState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          npcId: 'npc_shen_yue',
          name: '李四',
          courtesyName: null,
          aliases: ['沈岳'],
          role: '陌生商人',
          currentIdentity: '过路商人',
          summary: '与沈岳无关的另一人。',
        })],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_shen_yue')).toMatchObject({
      name: '沈岳',
      role: archivedProfile.role,
      currentIdentity: archivedProfile.currentIdentity,
    });
    expect(application.ignoredSummaries.join('\n')).toContain('npcId 身份冲突');
  });

  it('rejects an exact npcId update when stable identity evidence conflicts despite the same name', () => {
    const archivedProfile = makeNpcProfileSuggestion({
      npcId: 'npc_shen_yue', name: '沈岳', sex: '男', birthOrigin: '河东郡',
    });
    const application = applyNarratorWriteback(
      { ...makeState(), npcs: [{ ...archivedProfile, memories: [] }] } as RuntimeState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          npcId: 'npc_shen_yue', name: '沈岳', sex: '女', birthOrigin: '吴郡',
        })],
        npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [], questChanges: [],
        worldEventSummary: null, debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_shen_yue')).toMatchObject({
      name: '沈岳', sex: '男', birthOrigin: '河东郡',
    });
    expect(application.ignoredSummaries.join('\n')).toContain('npcId 身份冲突');
  });

  it('accepts an exact npcId update and converts the legacy age anchor to a stable birthday', () => {
    const archivedProfile = makeNpcProfileSuggestion({
      npcId: 'npc_wei_yan', name: '魏延', courtesyName: '文长', age: 24, birthOrigin: '义阳郡',
    });
    const currentDate = '公元195年06月01日 08:00（辰时）';
    const application = applyNarratorWriteback(
      {
        ...makeState(),
        currentDate,
        npcs: [{ ...archivedProfile, ageKnownAtDate: '公元189年06月01日', memories: [] }],
      } as RuntimeState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          ...archivedProfile,
          npcId: 'npc_wei_yan',
          age: 30,
          role: '前锋将领',
          currentIdentity: '新军前锋将领',
        })],
        npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [], questChanges: [],
        worldEventSummary: null, debugNotes: [],
      },
      worldBook,
    );

    const stored = application.state.npcs?.find((npc) => npc.npcId === 'npc_wei_yan');
    expect(stored).toMatchObject({ name: '魏延', age: 30, role: '前锋将领' });
    expect(stored?.birthDate).toMatch(/^公元\d+年\d{2}月\d{2}日$/);
    expect(stored?.ageKnownAtDate).toBeUndefined();
    expect(application.ignoredSummaries.join('\n')).not.toContain('npcId 身份冲突');
  });

  it('fills a missing new-NPC birthday locally and keeps it immutable on later writeback', () => {
    const currentDate = '公元189年09月01日 08:00（辰时）';
    const first = applyNarratorWriteback(
      { ...makeState(), currentDate } as RuntimeState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({ birthDate: undefined })],
        npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [], questChanges: [],
        worldEventSummary: null, debugNotes: [],
      },
      worldBook,
    );
    const firstBirthDate = first.state.npcs?.find((npc) => npc.npcId === 'npc_shen_yue')?.birthDate;
    expect(firstBirthDate).toMatch(/^公元\d+年\d{2}月\d{2}日$/);

    const second = applyNarratorWriteback(
      first.state,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({ birthDate: '公元100年01月01日' })],
        npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [], questChanges: [],
        worldEventSummary: null, debugNotes: [],
      },
      worldBook,
    );
    expect(second.state.npcs?.find((npc) => npc.npcId === 'npc_shen_yue')?.birthDate).toBe(firstBirthDate);
  });

  it('reuses a drifted npcId when anchored age growth matches the current campaign date', () => {
    const archivedProfile = makeNpcProfileSuggestion({
      npcId: 'npc_wei_yan', name: '魏延', courtesyName: '文长', age: 24, birthOrigin: '义阳郡',
    });
    const application = applyNarratorWriteback(
      {
        ...makeState(),
        currentDate: '公元195年06月01日 08:00（辰时）',
        npcs: [{ ...archivedProfile, ageKnownAtDate: '公元189年06月01日', memories: [] }],
      } as RuntimeState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          ...archivedProfile,
          npcId: 'npc_wen_chang_drift',
          name: '文长',
          courtesyName: null,
          aliases: ['魏延'],
          age: 30,
          role: '前锋将领',
        })],
        npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [], questChanges: [],
        worldEventSummary: null, debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.filter((npc) => npc.npcId === 'npc_wei_yan')).toHaveLength(1);
    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_wen_chang_drift')).toBe(false);
    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_wei_yan')).toMatchObject({ age: 30, role: '前锋将领' });
  });

  it('uses birthDate to compare an archived NPC with an incoming current age', () => {
    const archivedProfile = makeNpcProfileSuggestion({
      npcId: 'npc_birth_anchored', name: '顾衡', courtesyName: '子平', age: 24, birthOrigin: '河东郡',
    });
    const application = applyNarratorWriteback(
      {
        ...makeState(),
        currentDate: '公元195年08月01日 08:00（辰时）',
        npcs: [{ ...archivedProfile, birthDate: '公元165年03月01日', memories: [] }],
      } as RuntimeState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          ...archivedProfile,
          age: 30,
          role: '行军参赞',
        })],
        npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [], questChanges: [],
        worldEventSummary: null, debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_birth_anchored')).toMatchObject({
      age: 30, birthDate: '公元165年03月01日', role: '行军参赞',
    });
  });

  it('still rejects an obvious age conflict at the same anchor or without a usable age anchor', () => {
    const anchored = makeNpcProfileSuggestion({ npcId: 'npc_anchored_conflict', name: '陆峥', age: 24 });
    const unanchored = makeNpcProfileSuggestion({ npcId: 'npc_unanchored_conflict', name: '沈策', age: 24 });
    const initialState = {
      ...makeState(),
      currentDate: '公元195年06月01日 08:00（辰时）',
      npcs: [
        { ...anchored, ageKnownAtDate: '公元195年06月01日', memories: [] },
        { ...unanchored, memories: [] },
      ],
    } as RuntimeState;
    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [
          makeNpcProfileSuggestion({ ...anchored, age: 40, role: '错误更新' }),
          makeNpcProfileSuggestion({ ...unanchored, age: 30, role: '错误更新' }),
        ],
        npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [], questChanges: [],
        worldEventSummary: null, debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_anchored_conflict')?.role).toBe(anchored.role);
    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_unanchored_conflict')?.role).toBe(unanchored.role);
    expect(application.ignoredSummaries.filter((summary) => summary.includes('npcId 身份冲突'))).toHaveLength(2);
  });

  it('rejects a later same-batch profile that reuses an incoming id for a different person', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: null,
        npcProfileSuggestions: [
          makeNpcProfileSuggestion({ npcId: 'npc_batch_collision', name: '沈岳' }),
          makeNpcProfileSuggestion({
            npcId: 'npc_batch_collision',
            name: '李四',
            courtesyName: null,
            aliases: [],
            role: '陌生商人',
            currentIdentity: '过路商人',
            summary: '与首条建议无关的另一人。',
          }),
        ],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.filter((npc) => npc.npcId === 'npc_batch_collision')).toHaveLength(1);
    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_batch_collision')).toMatchObject({
      name: '沈岳',
      role: '军中校尉',
    });
    expect(application.ignoredSummaries.join('\n')).toContain('npcId 身份冲突');
  });

  it('requires a trusted identity name even when a successful profile created an id alias', () => {
    const archivedProfile = makeNpcProfileSuggestion({
      npcId: 'npc_shen_yue',
      name: '沈岳',
      courtesyName: '子衡',
      artName: '守拙',
      aliases: ['白袍校尉'],
    });
    const application = applyNarratorWriteback(
      { ...makeState(), npcs: [{ ...archivedProfile, memories: [] }] } as RuntimeState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          ...archivedProfile,
          npcId: 'npc_zi_heng_drift',
          name: '子衡',
          courtesyName: null,
          aliases: ['沈岳'],
        })],
        npcMemorySuggestions: [
          { npcId: 'npc_zi_heng_drift', npcName: '李四', source: '亲历', content: '错误姓名记忆。' },
          { npcId: 'npc_zi_heng_drift', npcName: '', source: '亲历', content: '空姓名记忆。' },
          { npcId: 'npc_zi_heng_drift', npcName: '【子衡】', source: '亲历', content: '结构标签不是档案姓名。' },
          { npcId: 'npc_zi_heng_drift', npcName: '守拙', source: '亲历', content: '合法号名记忆。' },
        ],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        signalChanges: [{
          action: 'add',
          rumorId: 'signal_alias_name_credentials',
          content: '不同姓名凭证的 awareness。',
          npcAwarenessRefs: [
            { name: '李四', npcId: 'npc_zi_heng_drift' },
            { name: '', npcId: 'npc_zi_heng_drift' },
            { name: '子衡将军', npcId: 'npc_zi_heng_drift' },
            { name: '白袍校尉', npcId: 'npc_zi_heng_drift' },
          ],
        }],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_shen_yue')?.memories)
      .toEqual([expect.objectContaining({ content: '合法号名记忆。' })]);
    expect(application.ignoredSummaries.filter((summary) => summary.includes('NPC记忆'))).toHaveLength(3);
    expect(application.state.knownRumors.find((rumor) => rumor.id === 'signal_alias_name_credentials')?.npcAwarenessRefs)
      .toEqual([
        { name: '李四' },
        { name: '子衡将军' },
        { name: '沈岳', npcId: 'npc_shen_yue' },
      ]);
  });

  it('preserves omitted canonical profile facts and archives while applying explicit new facts', () => {
    const archivedProfile = makeNpcProfileSuggestion({
      npcId: 'npc_wei_yan',
      name: '魏延',
      courtesyName: '文长',
      aliases: ['魏将军'],
      birthOrigin: '义阳郡',
      birthOriginDescription: '义阳军户出身，早年投身行伍。',
      factionId: 'faction_old',
      factionName: '旧部',
      identitySummary: '义阳出身的旧部先锋。',
      isPresent: false,
      isFocused: true,
      traits: [{ id: 'trait_old', label: '旧部先锋', description: '久经战阵。', source: 'history' }],
      uniqueArts: [{
        id: 'art_old', name: '破阵', rarity: 'blue', domain: 'warfare', level: 2,
        description: '善破军阵。', effectSummary: '冲阵时更果决。', source: 'history',
      }],
      effects: [{
        id: 'effect_old', label: '旧伤', type: 'debuff', duration: 'long',
        description: '阴雨时隐痛。', source: 'history',
      }],
      equipment: [{
        id: 'eq_old_spear', slot: 'weapon', name: '旧长矛', quality: '精良', description: '多年随身兵器。',
      }],
      inventory: [{ id: 'item_old_token', name: '旧军符', quantity: 1, category: 'token' }],
      femaleProfile: {
        relationshipNotes: '既有女性档案不应被基础档案更新影响。',
      },
    });
    const incoming = {
      ...makeNpcProfileSuggestion({
        ...archivedProfile,
        npcId: 'npc_wen_chang_drift',
        name: '文长',
        courtesyName: null,
        aliases: [],
        factionName: '新军',
        role: '新军先锋',
        locationId: 'place_b',
        isPresent: false,
        currentIdentity: '新军先锋将领',
        summary: '本回合明确转任新军先锋。',
        traits: [],
        uniqueArts: [],
        inventory: [],
      }),
      identitySummary: null,
    } as Record<string, unknown>;
    delete incoming.birthOrigin;
    delete incoming.birthOriginDescription;
    delete incoming.factionId;
    delete incoming.isFocused;
    delete incoming.effects;
    delete incoming.equipment;
    delete incoming.femaleProfile;
    const parsed = parseNarratorResponse(JSON.stringify({
      narrativeText: '魏延转任先锋。',
      suggestedActions: [],
      statePatches: [],
      writeback: {
        npcProfileSuggestions: [incoming],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        debugNotes: [],
      },
    }));
    const initialState = {
      ...makeState(),
      npcs: [{
        ...archivedProfile,
        memories: [{ memoryId: 'memory_old', source: '亲历', content: '旧日共同守城。', createdAt: 'day 0' }],
      }],
      relationships: [{
        id: 'relationship_player_weiyan', actorId: 'player', targetId: 'npc_wei_yan',
        targetKind: 'actor', targetType: 'actor', type: '同袍', value: 30, description: '旧日同袍。',
      }],
      npcAwarenessIndex: [{
        awarenessId: 'awareness_weiyan', npcId: 'npc_wei_yan', name: '魏延', sourceType: 'npcProfile',
        sourceIds: ['npc_wei_yan'], contactLevel: 30, playerRelevance: ['旧部'], knownToPlayer: true,
        archiveVisible: true, updatedAt: 'day 0',
      }],
    } as RuntimeState;

    const application = applyNarratorWriteback(initialState, parsed.writeback, worldBook);
    const npc = application.state.npcs?.find((item) => item.npcId === 'npc_wei_yan');

    expect(npc).toMatchObject({
      name: '魏延', courtesyName: '文长', aliases: ['魏将军'], birthOrigin: '义阳郡',
      birthOriginDescription: '义阳军户出身，早年投身行伍。', factionId: 'faction_old', factionName: '新军',
      identitySummary: '义阳出身的旧部先锋。', isFocused: true, role: '新军先锋', locationId: 'place_b',
      currentIdentity: '新军先锋将领', traits: archivedProfile.traits, uniqueArts: archivedProfile.uniqueArts,
      effects: archivedProfile.effects, equipment: archivedProfile.equipment, inventory: archivedProfile.inventory,
      femaleProfile: archivedProfile.femaleProfile,
    });
    expect(npc?.memories).toHaveLength(1);
    expect(application.state.relationships).toEqual(initialState.relationships);
    expect(application.state.npcAwarenessIndex).toEqual(initialState.npcAwarenessIndex);
    expect(application.state.npcs?.some((item) => item.npcId === 'npc_wen_chang_drift')).toBe(false);
  });

  it('rejects an unrelated name for a known NPC id without a successful profile alias', () => {
    const archivedProfile = makeNpcProfileSuggestion({
      npcId: 'npc_shen_yue',
      name: '沈岳',
      courtesyName: '子衡',
      aliases: ['白袍校尉'],
    });
    const initialState = {
      ...makeState(),
      npcs: [{ ...archivedProfile, memories: [] }],
    } as RuntimeState;

    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [],
        npcMemorySuggestions: [{
          npcId: 'npc_shen_yue',
          npcName: '李四',
          source: '亲历',
          content: '错误地把李四的经历写给沈岳。',
        }],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        signalChanges: [{
          action: 'add',
          rumorId: 'signal_wrong_identity',
          content: '李四已经听闻此事。',
          affectedNpcIds: [],
          npcAwarenessRefs: [{ name: '李四', npcId: 'npc_shen_yue' }],
        }],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_shen_yue')?.memories).toEqual([]);
    expect(application.ignoredSummaries.join('\n')).toContain('npcName 与 npcId 不匹配');
    expect(application.state.knownRumors.find((rumor) => rumor.id === 'signal_wrong_identity')?.npcAwarenessRefs)
      .toEqual([{ name: '李四' }]);
    expect(application.state.npcAwarenessIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '李四' }),
    ]));
    expect(application.state.npcAwarenessIndex?.find((entry) => entry.name === '李四')?.npcId).toBeUndefined();
  });

  it('accepts a trusted courtesy name for a known NPC id without a profile suggestion', () => {
    const archivedProfile = makeNpcProfileSuggestion({
      npcId: 'npc_shen_yue',
      name: '沈岳',
      courtesyName: '子衡',
      aliases: ['白袍校尉'],
    });
    const application = applyNarratorWriteback(
      {
        ...makeState(),
        npcs: [{ ...archivedProfile, memories: [] }],
      } as RuntimeState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [],
        npcMemorySuggestions: [{
          npcId: 'npc_shen_yue',
          npcName: '子衡',
          source: '亲历',
          content: '子衡当面说明了部署。',
        }],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        signalChanges: [{
          action: 'add',
          rumorId: 'signal_trusted_courtesy_name',
          content: '子衡已经听闻部署。',
          affectedNpcIds: ['npc_shen_yue'],
          npcAwarenessRefs: [{ name: '子衡', npcId: 'npc_shen_yue' }],
        }],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_shen_yue')?.memories).toHaveLength(1);
    expect(application.state.knownRumors.find((rumor) => rumor.id === 'signal_trusted_courtesy_name'))
      .toMatchObject({ npcAwarenessRefs: [{ name: '沈岳', npcId: 'npc_shen_yue' }] });
  });

  it('synchronizes drifted ids and alias names for memories, awareness refs, and female profiles', () => {
    const archivedProfile = makeNpcProfileSuggestion({
      npcId: 'npc_shen_lan',
      name: '沈岚',
      courtesyName: '清和',
      aliases: ['兰娘'],
      sex: '女',
    });
    const initialState = {
      ...makeState(),
      npcs: [{ ...archivedProfile, memories: [] }],
    } as RuntimeState;

    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          ...archivedProfile,
          npcId: 'npc_qing_he_drift',
          name: '清和',
          courtesyName: null,
          aliases: ['沈岚'],
          femaleProfile: {
            appearanceDescription: '眉目沉静，衣着利落。',
            relationshipNotes: '本回合与主角首次正式共事。',
          },
        })],
        npcMemorySuggestions: [{
          npcId: 'npc_qing_he_drift',
          npcName: '清和',
          source: '亲历',
          content: '她与主角当面核对军粮账册。',
        }],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        signalChanges: [{
          action: 'add',
          rumorId: 'signal_grain_ledger',
          content: '军粮账册已经复核。',
          affectedNpcIds: ['npc_qing_he_drift'],
          npcAwarenessRefs: [{ name: '清和', npcId: 'npc_qing_he_drift' }],
        }],
        worldEventSummary: {
          eventId: 'event_grain_ledger',
          summary: '主角与清和复核军粮账册。',
          title: '区域军粮复核完成',
          scope: 'regional',
          severity: 'high',
          status: 'historical',
          affectedFactionIds: ['faction_army'],
          affectedHoldingIds: ['holding_granary'],
          locationId: 'place_a',
          presentNpcIds: ['npc_qing_he_drift'],
          involvedNpcIds: ['npc_qing_he_drift'],
          npcAwarenessRefs: [{ name: '清和', npcId: 'npc_qing_he_drift' }],
        },
        debugNotes: [],
      },
      worldBook,
    );

    const canonicalNpc = application.state.npcs?.find((npc) => npc.npcId === 'npc_shen_lan');
    expect(application.state.npcs?.filter((npc) => npc.npcId === 'npc_shen_lan')).toHaveLength(1);
    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_qing_he_drift')).toBe(false);
    expect(canonicalNpc?.memories).toHaveLength(1);
    expect(canonicalNpc?.femaleProfile).toMatchObject({
      appearanceDescription: '眉目沉静，衣着利落。',
    });
    expect(application.state.knownRumors.find((rumor) => rumor.id === 'signal_grain_ledger')).toMatchObject({
      affectedNpcIds: ['npc_shen_lan'],
      npcAwarenessRefs: [{ name: '沈岚', npcId: 'npc_shen_lan' }],
    });
    expect(application.state.worldTrends?.find((event) => event.trendId === 'event_grain_ledger')).toMatchObject({
      relatedNpcIds: ['npc_shen_lan'],
      npcAwarenessRefs: [{ name: '沈岚', npcId: 'npc_shen_lan' }],
    });
    expect(application.state.npcAwarenessIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '沈岚', npcId: 'npc_shen_lan' }),
    ]));
    expect(JSON.stringify(application.state)).not.toContain('npc_qing_he_drift');
  });

  it('canonicalizes female profile name references against later accepted same-batch NPC identities', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: null,
        npcProfileSuggestions: [
          makeNpcProfileSuggestion({
            npcId: 'npc_shen_lan',
            name: '沈岚',
            courtesyName: '清和',
            artName: null,
            aliases: ['兰娘'],
            sex: '女',
            age: 25,
            femaleProfile: {
              relationshipNetwork: [
                { targetName: '子衡', relationship: '同袍' },
                { targetName: '陌生人', relationship: '仅听闻' },
                { targetName: '无效别名', relationship: '身份未确认' },
              ],
              adultPrivateProfile: {
                enabled: true,
                ageConfirmedAdult: true,
                firstNightPartner: '白袍校尉',
              },
            },
          }),
          makeNpcProfileSuggestion({
            npcId: 'npc_shen_yue_new',
            name: '沈岳',
            courtesyName: '子衡',
            aliases: ['白袍校尉'],
          }),
          makeNpcProfileSuggestion({
            npcId: 'npc_invalid_lu_an',
            name: '陆安',
            courtesyName: '无效别名',
            aliases: [],
            age: 0,
          }),
        ],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    const femaleProfile = application.state.npcs?.find((npc) => npc.npcId === 'npc_shen_lan')?.femaleProfile;
    expect(femaleProfile?.relationshipNetwork).toEqual([
      { targetName: '沈岳', relationship: '同袍' },
      { targetName: '陌生人', relationship: '仅听闻' },
      { targetName: '无效别名', relationship: '身份未确认' },
    ]);
    expect(femaleProfile?.adultPrivateProfile?.firstNightPartner).toBe('沈岳');
    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_invalid_lu_an')).toBe(false);
  });

  it('matches a renamed profile from multiple strong birth and stable biography signals', () => {
    const archivedProfile = makeNpcProfileSuggestion({
      npcId: 'npc_gu_heng_archive',
      name: '顾衡',
      courtesyName: null,
      aliases: null,
      age: 34,
      birthOrigin: '河东安邑县',
      birthOriginDescription: '安邑顾氏旁支，自幼随父辈习武从军。',
      identitySummary: '安邑顾氏旁支，自幼随父辈习武从军。',
    });
    const initialState = {
      ...makeState(),
      npcs: [{ ...archivedProfile, memories: [] }],
    } as RuntimeState;

    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          npcId: 'npc_yan_chuan_drift',
          name: '严川',
          courtesyName: null,
          aliases: null,
          age: 35,
          birthOrigin: '安邑人',
          birthOriginDescription: '安邑顾氏旁支，自幼随父辈习武从军。',
          identitySummary: '安邑顾氏旁支，自幼随父辈习武从军。',
          role: '行军参赞',
          factionName: '新军',
          locationId: 'place_b',
          currentIdentity: '新军行军参赞',
        })],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.filter((npc) => npc.npcId === 'npc_gu_heng_archive')).toHaveLength(1);
    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_yan_chuan_drift')).toBe(false);
  });

  it('does not merge a near-biographical profile without the same stable life evidence', () => {
    const archivedProfile = makeNpcProfileSuggestion({
      npcId: 'npc_gu_heng_archive',
      name: '顾衡',
      courtesyName: null,
      aliases: null,
      age: 34,
      birthOrigin: '河东安邑县',
      birthOriginDescription: '安邑顾氏旁支，自幼随父辈习武从军。',
      identitySummary: '安邑顾氏旁支，自幼随父辈习武从军。',
    });
    const application = applyNarratorWriteback(
      { ...makeState(), npcs: [{ ...archivedProfile, memories: [] }] } as RuntimeState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          npcId: 'npc_yan_chuan_distinct',
          name: '严川',
          courtesyName: null,
          aliases: null,
          age: 35,
          birthOrigin: '安邑人',
          birthOriginDescription: '安邑寒门子弟，成年后才投军。',
          identitySummary: '安邑寒门子弟，成年后才投军。',
        })],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_gu_heng_archive')).toBe(true);
    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_yan_chuan_distinct')).toBe(true);
  });

  it('rejects an ambiguous no-name identity match when multiple candidates have equal strong evidence', () => {
    const sharedEvidence = {
      courtesyName: null,
      aliases: null,
      age: 34,
      birthOrigin: '河东安邑县',
      birthOriginDescription: '安邑军户出身，自幼随父辈习武从军。',
      identitySummary: '安邑军户出身，自幼随父辈习武从军。',
    };
    const first = makeNpcProfileSuggestion({ ...sharedEvidence, npcId: 'npc_candidate_one', name: '顾衡' });
    const second = makeNpcProfileSuggestion({ ...sharedEvidence, npcId: 'npc_candidate_two', name: '陆峥' });
    const application = applyNarratorWriteback(
      { ...makeState(), npcs: [{ ...first, memories: [] }, { ...second, memories: [] }] } as RuntimeState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          ...sharedEvidence,
          npcId: 'npc_ambiguous_new',
          name: '严川',
          age: 35,
          birthOrigin: '安邑人',
        })],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_ambiguous_new')).toBe(true);
    expect(application.state.npcs?.filter((npc) => ['npc_candidate_one', 'npc_candidate_two'].includes(npc.npcId))).toHaveLength(2);
  });

  it('keeps the first valid profile canonical when a later same-identity profile is invalid', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: null,
        npcProfileSuggestions: [
          makeNpcProfileSuggestion({ npcId: 'npc_valid_first' }),
          makeNpcProfileSuggestion({ npcId: 'npc_invalid_second', name: '子衡', courtesyName: null, aliases: ['沈岳'], age: 0 }),
        ],
        npcMemorySuggestions: [{
          npcId: 'npc_valid_first',
          npcName: '沈岳',
          source: '亲历',
          content: '主角与他确认了军令。',
        }],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: {
          summary: '一份引用第二条无效人物编号的军报。',
          locationId: 'place_a',
          presentNpcIds: ['npc_invalid_second'],
          involvedNpcIds: ['npc_invalid_second'],
        },
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_valid_first')?.memories).toHaveLength(1);
    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_invalid_second')).toBe(false);
    expect(application.state.turnEvents?.[0]).toMatchObject({ presentNpcIds: [], involvedNpcIds: [] });
    expect(application.ignoredSummaries.join('\n')).toContain('NPC档案');
  });

  it('does not publish aliases or remap references from an invalid profile suggestion', () => {
    const initialState = {
      ...makeState(),
      npcs: [makeNpcProfileSuggestion({ npcId: 'npc_shen_yue', isPresent: false, memories: [] } as any)],
    } as RuntimeState;
    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          npcId: 'npc_invalid_drift',
          age: 0,
        })],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: {
          summary: '一份使用无效人物编号的军报。',
          locationId: 'place_a',
          presentNpcIds: ['npc_invalid_drift'],
          involvedNpcIds: ['npc_invalid_drift'],
        },
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.ignoredSummaries.join('\n')).toContain('NPC档案');
    expect(application.state.turnEvents?.[0]).toMatchObject({ presentNpcIds: [], involvedNpcIds: [] });
  });

  it('lets a valid later profile succeed after an invalid same-batch identity suggestion', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: null,
        npcProfileSuggestions: [
          makeNpcProfileSuggestion({ npcId: 'npc_invalid_first', traits: [] }),
          makeNpcProfileSuggestion({ npcId: 'npc_valid_later', name: '子衡', courtesyName: null, aliases: ['沈岳'] }),
        ],
        npcMemorySuggestions: [{
          npcId: 'npc_valid_later',
          npcName: '子衡',
          source: '亲历',
          content: '主角确认了他的身份。',
        }],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_invalid_first')).toBe(false);
    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_valid_later')?.memories).toHaveLength(1);
    expect(application.ignoredSummaries.join('\n')).toContain('NPC档案');
  });

  it('does not merge different NPCs by name alone', () => {
    const initialState = {
      ...makeState(),
      npcs: [
        {
          npcId: 'npc_zhang_san_old',
          name: '张三',
          sex: '男',
          age: 31,
          role: '村民',
          locationId: 'place_a',
          isPresent: false,
          isFocused: false,
          currentIdentity: '甲地村民',
          summary: '旧日听闻的村民。',
          appearance: '衣着朴素。',
          personality: '沉默。',
          motivation: '守住家业。',
          relationToPlayer: '听闻',
          contactLevel: 0,
          recentAttitude: '未知',
          abilityScores: { 武力: 20, 统率: 15, 智力: 25, 政治: 10, 魅力: 20, 机运: 30 },
          traits: [{ id: 'trait_villager', label: '乡民', description: '普通乡民。', source: 'hearsay' }],
          memories: [],
        },
      ],
    } as any;

    const application = applyNarratorWriteback(
      initialState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [
           {
             npcId: 'npc_zhang_san_soldier',
             name: '张三',
             persistenceReason: 'active_system_role',
             persistenceEvidence: '本回合已确认其成为乙地守军的长期在册军士。',
            sex: '男',
            age: 24,
            role: '军士',
            factionName: '乙地守军',
            locationId: 'place_b',
            isPresent: true,
            isFocused: false,
            currentIdentity: '乙地守军军士',
            summary: '新遇见的守军军士。',
            appearance: '披甲持矛。',
            personality: '直率。',
            motivation: '完成巡防。',
            relationToPlayer: '初见',
            contactLevel: 2,
            recentAttitude: '戒备',
            abilityScores: { 武力: 45, 统率: 30, 智力: 28, 政治: 12, 魅力: 24, 机运: 30 },
            traits: [{ id: 'trait_guard', label: '守卒', description: '守军士卒。', source: 'identity' }],
          },
        ],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      } as any,
      worldBook,
    );

    const npcs = application.state.npcs ?? [];
    expect(npcs.filter((npc) => npc.name === '张三')).toHaveLength(2);
    expect(npcs.some((npc) => npc.npcId === 'npc_zhang_san_old')).toBe(true);
    expect(npcs.some((npc) => npc.npcId === 'npc_zhang_san_soldier')).toBe(true);
  });

  it('reuses the stable NPC id when age drifts but name, sex, origin and current identity all match', () => {
    const existing = makeNpcProfileSuggestion({
      npcId: 'npc_refugee_leader_01',
      name: '张铁',
      sex: '男',
      age: 28,
      birthOrigin: '江夏打铁匠之子',
      currentIdentity: '别营什长',
      identitySummary: '由流民头目在白杨湾战后升任别营什长。',
    });
    const application = applyNarratorWriteback(
      { ...makeState(), npcs: [{ ...existing, memories: [] }] } as RuntimeState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          npcId: 'npc_zhang_tie_01',
          name: '张铁',
          sex: '男',
          age: 22,
          birthOrigin: '江夏打铁匠之子',
          currentIdentity: '别营什长',
          identitySummary: '江夏流民出身，战后被提拔为别营什长。',
        })],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.filter((npc) => npc.name === '张铁')).toHaveLength(1);
    expect(application.state.npcs?.[0]?.npcId).toBe('npc_refugee_leader_01');
  });

  it('reuses a unique jurisdictional office placeholder instead of creating a second title-only NPC', () => {
    const existingPrefect = makeNpcProfileSuggestion({
      npcId: 'npc_yingchuan_prefect',
      name: '颍川太守',
      courtesyName: null,
      aliases: null,
      birthOrigin: null,
      birthOriginDescription: null,
      identitySummary: null,
      role: '颍川太守',
      currentIdentity: '颍川太守',
      locationId: 'loc_yangdi_county_office',
    });
    const application = applyNarratorWriteback(
      { ...makeState(), npcs: [{ ...existingPrefect, memories: [] }] } as RuntimeState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          npcId: 'npc_yingchuan_taishou',
          name: '颍川太守',
          courtesyName: null,
          aliases: null,
          birthOrigin: null,
          birthOriginDescription: null,
          identitySummary: null,
          role: '颍川太守',
          currentIdentity: '颍川太守',
          locationId: 'loc_yangdi_county',
        })],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.filter((npc) => npc.name === '颍川太守')).toHaveLength(1);
    expect(application.state.npcs?.find((npc) => npc.npcId === 'npc_yingchuan_prefect')).toMatchObject({
      locationId: 'loc_yangdi_county',
    });
    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_yingchuan_taishou')).toBe(false);
  });

  it('does not merge same-name NPCs of similar age without positive secondary identity evidence', () => {
    const archivedProfile = makeNpcProfileSuggestion({
      npcId: 'npc_zhang_san_archive',
      name: '张三',
      courtesyName: null,
      aliases: null,
      age: 31,
      birthOrigin: null,
      birthOriginDescription: null,
      identitySummary: null,
    });
    const application = applyNarratorWriteback(
      { ...makeState(), npcs: [{ ...archivedProfile, memories: [] }] } as RuntimeState,
      {
        protagonistMemory: null,
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          npcId: 'npc_zhang_san_new',
          name: '张三',
          courtesyName: null,
          aliases: null,
          age: 32,
          birthOrigin: null,
          birthOriginDescription: null,
          identitySummary: null,
          role: '新到军士',
          currentIdentity: '新到军士',
        })],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.filter((npc) => npc.name === '张三')).toHaveLength(2);
    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_zhang_san_new')).toBe(true);
  });

  it('normalizes blank NPC trait sources before applying profile suggestions and memories', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: null,
        npcProfileSuggestions: [
           {
             npcId: 'npc_chenwu',
             name: '陈伍',
             persistenceReason: 'player_committed_relationship',
             persistenceEvidence: '正文确认其已追随主角两年并继续作为忠实下属任事。',
            sex: '男',
            age: 32,
            role: '副将/亲兵',
            locationId: 'place_a',
            isPresent: true,
            isFocused: true,
            currentIdentity: '襄阳北营军侯',
            summary: '追随主角两年的荆州老卒，为人忠厚实诚。',
            appearance: '满面风霜，手背有旧刀疤。',
            personality: '本分、忠诚。',
            motivation: '保住手下弟兄的命和饭碗。',
            relationToPlayer: '忠实下属',
            contactLevel: 3,
            recentAttitude: '信赖且担忧现状',
            abilityScores: { 武力: 65, 统率: 58, 智力: 45, 政治: 30, 魅力: 50, 机运: 40 },
            traits: [
              {
                id: 'trait_veteran_soldier',
                label: '老卒本分',
                description: '吃苦耐劳，熟悉基层军务。',
                source: '',
                rarity: 'white',
              },
            ],
          },
        ],
        npcMemorySuggestions: [
          {
            npcId: 'npc_chenwu',
            npcName: '陈伍',
            source: '亲历',
            content: '向主角汇报粮饷被克扣，并随主角前往浅滩。',
          },
        ],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    const npc = application.state.npcs?.find((item) => item.npcId === 'npc_chenwu');
    expect(npc).toMatchObject({
      name: '陈伍',
      currentIdentity: '襄阳北营军侯',
      traits: [{ id: 'trait_veteran_soldier', source: 'writeback' }],
    });
    expect(npc?.memories?.[0]?.content).toContain('粮饷被克扣');
    expect(application.appliedSummaries).toContain('NPC档案x1');
    expect(application.appliedSummaries).toContain('NPC记忆x1');
    expect(application.ignoredSummaries.join('\n')).not.toContain('traits[0].source');
  });

  it('applies nested femaleProfile from NPC profile suggestions after creating the NPC', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: null,
        npcProfileSuggestions: [
           {
             npcId: 'npc_adult_woman',
             name: '某氏',
             persistenceReason: 'strategic_actor',
             persistenceEvidence: '本回合确认其代表地方贵族势力处理亲族危局，具有长期关系承接。',
            sex: '女',
            age: 33,
            role: '重要女性 NPC',
            factionName: '地方势力',
            locationId: 'place_a',
            isPresent: true,
            isFocused: true,
            currentIdentity: '地方贵族女性',
            summary: '在危局中出现的成年女性角色。',
            appearance: '衣饰庄重。',
            personality: '谨慎克制。',
            motivation: '保全亲族。',
            relationToPlayer: '初见，保持观察。',
            contactLevel: 5,
            recentAttitude: '谨慎',
            abilityScores: { 武力: 20, 统率: 25, 智力: 55, 政治: 50, 魅力: 70, 机运: 45 },
            traits: [{ id: 'trait_cautious', label: '谨慎', description: '处事谨慎。', source: 'identity' }],
            femaleProfile: {
              birthday: '八月初三',
              addressToPlayer: '郎君',
              appearanceDescription: '仪态端庄。',
              bodyDescription: '体态丰腴。',
              clothingStyle: '常着素雅深衣。',
              personalityCore: '谨慎克制。',
              affectionProgressionCondition: '长期守信。',
              relationshipProgressionCondition: '危机中兑现承诺。',
              relationshipNetwork: [{ targetName: '主角', relationship: '危局中的盟友', notes: '仍在观察。' }],
              adultPrivateProfile: {
                enabled: true,
                summary: '成年女性私密档案摘要。',
                breastDescription: '长期稳定正文字段一。',
                vaginaDescription: '长期稳定正文字段二。',
                anusDescription: '长期稳定正文字段三。',
                sexualPreferenceNotes: '长期偏好记录。',
                sensitiveSpotNotes: '长期敏感点记录。',
                wombProfile: {
                  status: '未受孕',
                  cervixStatus: '紧闭',
                  inseminationRecords: [{ date: '公元189年09月01日', description: '长期档案记录。', pregnancyCheckDate: '公元189年10月01日' }],
                },
                virgin: false,
                firstNightPartner: '主角',
                firstNightTime: '公元189年09月01日',
                firstNightDescription: '长期档案记录。',
              },
            },
          } as any,
        ],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    const npc = application.state.npcs?.find((item) => item.npcId === 'npc_adult_woman');
    expect(npc?.femaleProfile?.birthday).toBe('八月初三');
    expect(npc?.femaleProfile?.relationshipNetwork?.[0]).toMatchObject({ targetName: '主角', relationship: '危局中的盟友' });
    expect(npc?.femaleProfile?.adultPrivateProfile?.summary).toBe('成年女性私密档案摘要。');
    expect(npc?.femaleProfile?.adultPrivateProfile?.breastDescription).toBe('长期稳定正文字段一。');
    expect(npc?.femaleProfile?.adultPrivateProfile?.vaginaDescription).toBe('长期稳定正文字段二。');
    expect(npc?.femaleProfile?.adultPrivateProfile?.anusDescription).toBe('长期稳定正文字段三。');
    expect(npc?.femaleProfile?.adultPrivateProfile?.sexualPreferenceNotes).toBe('长期偏好记录。');
    expect(npc?.femaleProfile?.adultPrivateProfile?.sensitiveSpotNotes).toBe('长期敏感点记录。');
    expect(npc?.femaleProfile?.adultPrivateProfile?.wombProfile?.inseminationRecords?.[0]?.pregnancyCheckDate).toBe('公元189年10月01日');
    expect(npc?.femaleProfile?.adultPrivateProfile?.virgin).toBe(false);
    expect(npc?.femaleProfile?.adultPrivateProfile?.firstNightPartner).toBe('主角');
    expect(npc?.femaleProfile?.adultPrivateProfile?.firstNightTime).toBe('公元189年09月01日');
    expect(npc?.femaleProfile?.adultPrivateProfile?.firstNightDescription).toBe('长期档案记录。');
    expect(application.appliedSummaries).toContain('NPC档案x1');
    expect(application.appliedSummaries).toContain('女性档案x1');
  });

  it('ignores invalid NPC profile suggestions without creating partial NPCs', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: null,
        npcProfileSuggestions: [
          {
            npcId: 'npc_incomplete',
            name: '无名军士',
            sex: '男',
            age: 28,
            role: '军士',
            locationId: 'place_a',
            isPresent: true,
            isFocused: false,
            currentIdentity: '守军军士',
            summary: '一个军士。',
            appearance: '沉默。',
            personality: '谨慎。',
            motivation: '自保。',
            relationToPlayer: '初见。',
            contactLevel: 1,
            recentAttitude: '戒备',
            abilityScores: { 武力: 45, 统率: 30, 智力: 35, 政治: 20, 魅力: 25 },
            traits: [
              { id: 'trait_guard', label: '守门', description: '守门军士。', source: 'identity' },
            ],
          } as any,
        ],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.npcs?.some((npc) => npc.npcId === 'npc_incomplete') ?? false).toBe(false);
    expect(application.ignoredSummaries.join('\n')).toContain('NPC档案');
    expect(application.ignoredSummaries.join('\n')).toContain('机运');
  });

  it('ignores malformed map writebacks without breaking other writebacks', () => {
    const application = applyNarratorWriteback(
      makeState(),
      {
        protagonistMemory: {
          recentTurnSummary: 'The player noticed a rumor.',
        },
        npcMemorySuggestions: [],
        locationWriteSuggestions: [
          {
            locationId: 'scene_orphan',
            name: '孤立场景',
            kind: 'scene',
            mapLayer: 'scene',
            parentId: 'region_root',
            summary: 'This should be rejected because a scene needs a place parent.',
            permanence: 'permanent',
          },
        ],
        routeWriteSuggestions: [
          {
            routeId: 'route_bad',
            fromPlaceId: 'region_root',
            toPlaceId: 'place_b',
            name: '错误路线',
            status: '不可用',
            source: 'llm',
            knownLevel: '亲历',
          },
        ],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
      worldBook,
    );

    expect(application.state.player.playerMemory?.recentTurns).toEqual(['The player noticed a rumor.']);
    expect(application.state.mapNodes?.some((node) => node.id === 'scene_orphan')).toBe(false);
    expect(application.state.routeEdges?.some((route) => route.routeId === 'route_bad')).toBe(false);
    expect(application.ignoredSummaries.join('\n')).toContain('地点写回');
    expect(application.ignoredSummaries.join('\n')).toContain('路线写回');
  });
});
