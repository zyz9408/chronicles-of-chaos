import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from './createInitialRuntimeState';

function makeLegacyState(): RuntimeState {
  return {
    engineVersion: '0.1.0',
    worldBookId: 'test-chaos-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '乱世元年2月',
    currentDate: '乱世元年2月',
    player: {
      id: 'player',
      name: '无名氏',
      roleType: '流民',
      summary: '流落市镇的无名之人。',
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
  };
}

describe('ensureLuanShiState', () => {
  it('为旧运行时状态补齐乱世账本默认值', () => {
    const state = ensureLuanShiState(makeLegacyState());

    expect(state.gameDifficulty).toBe('standard');
    expect(state.combatDifficulty).toBe('standard');
    expect(state.warDifficulty).toBe('standard');
    expect(state.player.vitals).toEqual({
      hp: 100,
      maxHp: 100,
      stamina: 100,
      maxStamina: 100,
    });
    expect(state.npcs).toEqual([]);
    expect(state.turnEvents).toEqual([]);
    expect(state.locations).toEqual([]);
    expect(state.routes).toEqual([]);
    expect(state.resources.money).toBe(0);
    expect(state.resources.grain).toBe(0);
    expect(state.factions).toEqual([]);
    expect(state.troops).toEqual([]);
    expect(state.court.rulerName).toBe('未知君主');
    expect(state.plotPlan).toEqual([]);
    expect(state.worldTrends).toEqual([]);
    expect(state.conflicts).toEqual([]);
    expect(state.npcAwarenessIndex).toEqual([]);
    expect(state.memoryArchive).toMatchObject({
      recentTurnSummaries: [],
      midTermSummaries: [],
      longTermStorySummaries: [],
      longTermFacts: [],
      npcInteractionSummaries: [],
      npcMidTermSummaries: [],
      npcLongTermSummaries: [],
      locationMemorySummaries: [],
      settings: {
        recentTurnLimit: 20,
        npcRecentMemoryDefaultLimit: 8,
        npcRecentMemoryImportantLimit: 12,
        focusedNpcRecentMemoryLimit: 2,
        midTermSummaryLimit: 4,
        longTermFactLimit: 8,
        vectorResultLimit: 6,
        recentTurnCompressThreshold: 20,
        recentTurnKeepAfterCompress: 12,
        npcMemoryCompressThreshold: 20,
        npcMemoryKeepAfterCompress: 40,
        locationMemoryCompressThreshold: 30,
        taskMemoryCompressThreshold: 30,
        maxPromptMemoryTokens: 80000,
        recentStoryTokenBudget: 30000,
        npcMemoryTokenBudget: 20000,
        midTermTokenBudget: 8000,
        longTermFactTokenBudget: 8000,
        locationMemoryTokenBudget: 4000,
        retrievalTokenBudget: 10000,
        enableAutoMemorySummary: true,
        preferDedicatedMemorySummaryApi: true,
      },
    });
  });

  it('把旧势力动作迁移为逐条记录且不伪造早期动作时间', () => {
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      factions: [{
        factionId: 'faction_legacy_history',
        name: '旧军府',
        type: '军府',
        summary: '旧存档中的势力。',
        stanceToPlayer: '中立',
        knownLevel: '听闻',
        sourceNote: '斥候军报',
        lastKnownAt: '公元189年09月02日 08:00（辰时）',
        recentActions: ['整顿营防', '【亲历】接收军粮'],
      }],
    });

    expect(state.factions[0].recentActionRecords).toEqual([
      { summary: '整顿营防', knownLevel: '听闻' },
      {
        summary: '接收军粮',
        knownLevel: '亲历',
        observedAt: '公元189年09月02日 08:00（辰时）',
        sourceNote: '斥候军报',
      },
    ]);
  });

  it('把旧档误写的府库标准资源 shadow 合并回唯一账本并移除别名', () => {
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      resources: {
        money: 20,
        grain: 89,
        horses: 1,
        arms: 2,
        recruits: 3,
        weapons: [],
        documents: [],
        tokens: [],
        importantSupplies: [],
      },
      playerResources: {
        粮草: 289,
        grain: 200,
        马匹: 4,
        粮饷: 36,
        钱财: 999,
      },
    });

    expect(state.resources).toMatchObject({
      money: 20,
      grain: 289,
      horses: 4,
    });
    expect(state.playerResources).toEqual({ 粮饷: 36 });
  });

  it('保留旧档已有伤势与疲劳并补齐不完整生命体力字段', () => {
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      player: {
        ...makeLegacyState().player,
        vitals: {
          hp: 27,
          maxHp: 120,
          stamina: Number.NaN,
          maxStamina: 80,
        },
      },
    });

    expect(state.player.vitals).toEqual({
      hp: 27,
      maxHp: 120,
      stamina: 80,
      maxStamina: 80,
    });
  });

  it('保留合法本局难度并把未知难度兼容归一为标准', () => {
    expect(ensureLuanShiState({ ...makeLegacyState(), gameDifficulty: 'brutal' }).gameDifficulty)
      .toBe('brutal');
    expect(ensureLuanShiState({
      ...makeLegacyState(),
      gameDifficulty: 'legacy' as RuntimeState['gameDifficulty'],
    }).gameDifficulty).toBe('standard');
    const encounterDifficulties = ensureLuanShiState({
      ...makeLegacyState(),
      combatDifficulty: 'easy',
      warDifficulty: 'legacy' as RuntimeState['warDifficulty'],
    });
    expect(encounterDifficulties.combatDifficulty).toBe('easy');
    expect(encounterDifficulties.warDifficulty).toBe('standard');
  });

  it('合并同名同类型势力并把运行时引用重定向到最早稳定 ID', () => {
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      factions: [
        {
          factionId: 'faction_liu_biao',
          name: '荆州牧府',
          type: '地方官府',
          summary: '荆州州府。',
          stanceToPlayer: '中立',
          knownLevel: '听闻',
          recentActions: ['整顿州郡'],
        },
        {
          factionId: 'faction_jingzhou_liubiao',
          name: '荆州牧府',
          type: '地方官府',
          summary: '刘表控制的荆州州府。',
          stanceToPlayer: '略有善意',
          knownLevel: '亲历',
          relatedTroopIds: ['troop_hanshui_relief'],
          recentActions: ['调集水军'],
        },
      ],
      troops: [{
        troopId: 'troop_hanshui_relief',
        name: '汉水援军',
        size: 3000,
        factionId: 'faction_jingzhou_liubiao',
        morale: 60,
        training: 60,
        supplies: 60,
        task: '封锁汉水',
        relationToPlayer: '友军',
      }],
      worldTrends: [{
        trendId: 'trend_hanshui_blockade',
        title: '汉水封锁',
        severity: '高',
        summary: '州府水军封锁汉水。',
        knownToPlayer: true,
        affectedFactionIds: ['faction_jingzhou_liubiao'],
        updatedAt: '乱世元年2月',
      }],
    });

    expect(state.factions).toHaveLength(1);
    expect(state.factions[0]).toMatchObject({
      factionId: 'faction_liu_biao',
      name: '荆州牧府',
      knownLevel: '亲历',
      relatedTroopIds: ['troop_hanshui_relief'],
      recentActions: ['【亲历】整顿州郡', '【亲历】调集水军'],
    });
    expect(state.troops[0].factionId).toBe('faction_liu_biao');
    expect(state.worldTrends[0].affectedFactionIds).toEqual(['faction_liu_biao']);
  });

  it('按子部队真实 parentTroopId 去除重复的终态分裂父账本', () => {
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      troops: [
        {
          troopId: 'troop_vanguard',
          name: '别部锐士',
          size: 25,
          lifecycleStatus: 'split',
          childTroopIds: ['troop_vanguard_left', 'troop_vanguard_right'],
          morale: 50,
          training: 60,
          supplies: 50,
          task: '旧建制归档',
          relationToPlayer: '直属',
        },
        {
          troopId: 'troop_reformed_legacy',
          name: '别部锐士（旧账）',
          size: 25,
          lifecycleStatus: 'split',
          childTroopIds: ['troop_vanguard_right', 'troop_vanguard_left'],
          morale: 50,
          training: 60,
          supplies: 50,
          task: '旧建制归档',
          relationToPlayer: '直属',
        },
        {
          troopId: 'troop_vanguard_left',
          name: '锐士左部',
          size: 13,
          parentTroopId: 'troop_vanguard',
          morale: 60,
          training: 65,
          supplies: 50,
          task: '整训',
          relationToPlayer: '直属',
        },
        {
          troopId: 'troop_vanguard_right',
          name: '锐士右部',
          size: 12,
          parentTroopId: 'troop_vanguard',
          morale: 60,
          training: 65,
          supplies: 50,
          task: '整训',
          relationToPlayer: '直属',
        },
      ],
    });

    expect(state.troops.map((troop) => troop.troopId)).toEqual([
      'troop_vanguard',
      'troop_vanguard_left',
      'troop_vanguard_right',
    ]);
    expect(state.troops.filter((troop) => troop.lifecycleStatus === 'split')).toHaveLength(1);
    expect(state.troops.find((troop) => troop.troopId === 'troop_vanguard')?.childTroopIds).toEqual([
      'troop_vanguard_left',
      'troop_vanguard_right',
    ]);
  });

  it('为旧部队账本补齐精确疲劳并修复旧档档位与精确值不一致', () => {
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      troops: [
        {
          troopId: 'troop_legacy_partial',
          name: '旧档郡兵',
          size: 300,
          morale: 50,
          training: 60,
          supplies: 40,
          task: '城防巡守',
          relationToPlayer: '你直接统领',
          leaderNpcId: 'player',
        } as any,
        {
          troopId: 'troop_legacy_elite',
          name: '旧档精兵',
          size: 120,
          morale: 80,
          training: 85,
          supplies: 70,
          task: '护卫主将',
          relationToPlayer: '你直接统领',
          quality: '精锐',
          readiness: '高',
          fatigue: '中',
          warFatiguePercent: 85,
          lifecycleStatus: 'active',
          knownLevel: '亲历',
          certainty: 'confirmed',
        },
      ],
    });

    expect(state.troops[0]).toEqual(expect.objectContaining({
      quality: '中',
      readiness: '中',
      fatigue: '低',
      warFatiguePercent: 15,
      lifecycleStatus: 'active',
      knownLevel: '亲历',
      certainty: 'confirmed',
    }));
    expect(state.troops[1]).toEqual(expect.objectContaining({
      quality: '精锐',
      readiness: '高',
      fatigue: '中',
      warFatiguePercent: 35,
    }));
  });

  it('读取旧档时保留终态部队历史并收口势力与驻军的当前引用', () => {
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      troops: [
        {
          troopId: 'troop_old_merged', name: '旧合并营', size: 300, morale: 50, training: 50,
          supplies: 50, task: '历史建制', relationToPlayer: '你直接统领', lifecycleStatus: 'merged',
          mergedIntoTroopId: 'troop_new_main',
        },
        {
          troopId: 'troop_old_split', name: '旧拆分营', size: 200, morale: 50, training: 50,
          supplies: 50, task: '历史建制', relationToPlayer: '你直接统领', lifecycleStatus: 'split',
          childTroopIds: ['troop_new_vanguard', 'troop_new_main'],
        },
        {
          troopId: 'troop_old_disbanded', name: '旧解散营', size: 100, morale: 50, training: 50,
          supplies: 50, task: '历史建制', relationToPlayer: '你直接统领', lifecycleStatus: 'disbanded',
        },
        {
          troopId: 'troop_new_main', name: '新主力营', size: 500, morale: 70, training: 70,
          supplies: 70, task: '整编待命', relationToPlayer: '你直接统领', lifecycleStatus: 'active',
        },
        {
          troopId: 'troop_new_vanguard', name: '新前锋营', size: 100, morale: 70, training: 70,
          supplies: 70, task: '整编待命', relationToPlayer: '你直接统领', lifecycleStatus: 'active',
        },
        {
          troopId: 'troop_keep', name: '保留旧部', size: 80, morale: 70, training: 70,
          supplies: 70, task: '保持建制', relationToPlayer: '你直接统领', lifecycleStatus: 'active',
        },
      ],
      factions: [{
        factionId: 'faction_player', name: '主角军', type: '军府', summary: '主角势力。',
        stanceToPlayer: 'self', knownLevel: '亲历', recentActions: ['完成整编'],
        relatedTroopIds: ['troop_old_merged', 'troop_keep', 'troop_old_split', 'troop_old_disbanded'],
      }],
      holdings: [{
        holdingId: 'holding_main_camp', name: '中军营', type: 'camp', status: 'controlled', summary: '主角营地。',
        scaleLevel: 1, agriculture: 0, commerce: 0, population: 10, publicOrder: 80, popularSupport: 70,
        defense: 60, recruitPotential: 20, armory: 50, horseSupply: 30, corruption: 0,
        garrisonTroopIds: ['troop_old_disbanded', 'troop_old_merged', 'troop_new_main', 'troop_old_split'],
        updatedAt: '乱世元年2月',
      }],
    } as RuntimeState);

    expect(state.troops.map((troop) => troop.troopId)).toEqual(expect.arrayContaining([
      'troop_old_merged',
      'troop_old_split',
      'troop_old_disbanded',
    ]));
    expect(state.factions[0].relatedTroopIds).toEqual([
      'troop_new_main',
      'troop_keep',
      'troop_new_vanguard',
    ]);
    expect(state.holdings[0].garrisonTroopIds).toEqual([
      'troop_new_main',
      'troop_new_vanguard',
    ]);
    expect(state.holdings[0]).toMatchObject({
      civilAdministrationScope: 'none',
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 0,
      popularSupport: 0,
      recruitPotential: 0,
    });
    expect(state.holdings[0].corruption).toBeUndefined();
  });

  it('按地点归并旧存档中同一地点领地的重复条目', () => {
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      holdings: [
        {
          holdingId: 'place_jingzhou_xinye',
          name: '新野县',
          type: 'county',
          status: 'controlled',
          summary: '主角已接管的新野县。',
          locationId: 'place_jingzhou_xinye',
          scaleLevel: 2,
          agriculture: 52,
          commerce: 40,
          population: 45,
          publicOrder: 38,
          popularSupport: 42,
          defense: 46,
          recruitPotential: 34,
          armory: 20,
          horseSupply: 8,
          corruption: 45,
          localTreasury: 120,
          localGranary: 800,
          updatedAt: '公元194年08月19日 13:00（未时）',
        },
        {
          holdingId: 'holding_xinye',
          name: '新野县',
          type: 'county',
          status: 'controlled',
          summary: '新野县初步安定，主角开始整顿县署与粮仓。',
          locationId: 'place_jingzhou_xinye',
          scaleLevel: 2,
          agriculture: 54,
          commerce: 41,
          population: 46,
          publicOrder: 45,
          popularSupport: 48,
          defense: 48,
          recruitPotential: 36,
          armory: 22,
          horseSupply: 8,
          corruption: 41,
          recentChanges: ['县署清册已重新核对。'],
          updatedAt: '公元194年08月19日 15:00（申时）',
        },
      ],
    });

    expect(state.holdings).toHaveLength(1);
    expect(state.holdings[0]).toEqual(expect.objectContaining({
      holdingId: 'place_jingzhou_xinye',
      locationId: 'place_jingzhou_xinye',
      name: '新野县',
      publicOrder: 45,
      localTreasury: 120,
      localGranary: 800,
      recentChanges: ['县署清册已重新核对。'],
    }));
  });

  it('按同名同类型归并缺失地点 ID 的旧领地并补齐新地点 ID', () => {
    const baseHolding = {
      type: 'county' as const,
      status: 'controlled' as const,
      scaleLevel: 2 as const,
      agriculture: 50,
      commerce: 40,
      population: 45,
      publicOrder: 40,
      popularSupport: 45,
      defense: 50,
      recruitPotential: 35,
      armory: 20,
      horseSupply: 5,
      corruption: 30,
    };
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      holdings: [
        {
          ...baseHolding,
          holdingId: 'holding_yangdi',
          name: '阳翟县城',
          summary: '旧账本尚未记录地点 ID。',
          updatedAt: '公元184年03月01日 13:00（未时）',
        },
        {
          ...baseHolding,
          holdingId: 'holding_yangdi_county',
          name: '阳翟县城',
          locationId: 'loc_yangdi_county',
          summary: '新写回补齐了地点 ID。',
          updatedAt: '公元184年03月01日 14:00（未时）',
        },
      ],
    });

    expect(state.holdings).toHaveLength(1);
    expect(state.holdings[0]).toMatchObject({
      holdingId: 'holding_yangdi',
      name: '阳翟县城',
      type: 'county',
      locationId: 'loc_yangdi_county',
      summary: '新写回补齐了地点 ID。',
    });
  });

  it('保留同名同类型但指向两个明确地点的领地', () => {
    const makeHolding = (holdingId: string, locationId: string) => ({
      holdingId,
      name: '北关营寨',
      type: 'fort' as const,
      status: 'controlled' as const,
      summary: locationId,
      locationId,
      scaleLevel: 1 as const,
      agriculture: 0,
      commerce: 0,
      population: 10,
      publicOrder: 50,
      popularSupport: 50,
      defense: 60,
      recruitPotential: 10,
      armory: 20,
      horseSupply: 5,
      corruption: 10,
      updatedAt: '公元184年03月01日 13:00（未时）',
    });
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      holdings: [
        makeHolding('holding_north_gate_a', 'loc_north_gate_a'),
        makeHolding('holding_north_gate_b', 'loc_north_gate_b'),
      ],
    });

    expect(state.holdings).toHaveLength(2);
  });

  it('不覆盖已有乱世账本内容', () => {
    const legacy = makeLegacyState();
    const state = ensureLuanShiState({
      ...legacy,
      npcs: [
        {
          npcId: 'npc_chen_heng',
          name: '陈衡',
          sex: '男',
          age: 30,
          role: '游侠首领',
          locationId: 'loc_capital',
          isPresent: true,
          isFocused: true,
          summary: '机警过人，善观时局。',
          appearance: '身量不高，目光锐利。',
          personality: '豪爽直接，善试探。',
          motivation: '寻找机会立足乱世。',
          relationToPlayer: '初识，正在试探主角。',
          contactLevel: 10,
          recentAttitude: '好奇',
          memories: [],
        },
      ],
      npcAwarenessIndex: [
        {
          awarenessId: 'aware_zhang_miao',
          name: 'Zhang Miao',
          sourceType: 'rumor',
          sourceIds: ['rumor_recruit'],
          contactLevel: 0,
          playerRelevance: ['same-location'],
          knownToPlayer: true,
          archiveVisible: false,
          updatedAt: 'day 1',
        },
      ],
      memoryArchive: {
        recentTurnSummaries: [
          {
            id: 'recent_1',
            turnNumber: 1,
            createdAt: '乱世元年2月',
            brief: '主角在市镇救下伤者。',
            importance: 'medium',
          },
        ],
        midTermSummaries: [],
        longTermFacts: [],
        npcInteractionSummaries: [],
        locationMemorySummaries: [],
        memorySummaryMaintenance: {
          status: 'pending',
          queuedAt: '2026-07-27T00:00:00.000Z',
          triggerTurnNumber: 1,
          lastFailureReason: '记忆压缩 API 请求超时，请更换可用 API 或稍后重试。',
        },
        settings: {
          recentTurnLimit: 12,
          npcRecentMemoryDefaultLimit: 1,
          npcRecentMemoryImportantLimit: 4,
          focusedNpcRecentMemoryLimit: 1,
          midTermSummaryLimit: 2,
          longTermFactLimit: 5,
          vectorResultLimit: 4,
        },
      } as any,
    });

    expect(state.npcs).toHaveLength(1);
    expect(state.npcs[0].name).toBe('陈衡');
    expect(state.memoryArchive.recentTurnSummaries[0].brief).toBe('主角在市镇救下伤者。');
    expect(state.npcAwarenessIndex).toHaveLength(1);
    expect(state.npcAwarenessIndex[0].name).toBe('Zhang Miao');
    expect(state.memoryArchive.settings.recentTurnLimit).toBe(12);
    expect(state.memoryArchive.memorySummaryMaintenance?.status).toBe('pending');
  });

  it('省略不存在的记忆摘要维护字段，保持规范化状态可直接 JSON 序列化', () => {
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      memoryArchive: {
        recentTurnSummaries: [],
        midTermSummaries: [],
        longTermFacts: [],
        npcInteractionSummaries: [],
        locationMemorySummaries: [],
        settings: {},
      } as any,
    });

    expect(Object.prototype.hasOwnProperty.call(
      state.memoryArchive,
      'memorySummaryMaintenance',
    )).toBe(false);
  });

  it('按 npcId 合并旧档中重复的红颜线并保留不同人物的同名关系', () => {
    const makeHeroine = (
      heroineThreadId: string,
      npcId: string,
      lastUpdatedAt: string,
      overrides: Record<string, unknown> = {},
    ) => ({
      heroineThreadId,
      npcId,
      npcName: '邹氏',
      status: 'active' as const,
      stage: '初识',
      relationshipRole: '红颜',
      summary: '旧摘要',
      lastUpdatedAt,
      ...overrides,
    });
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      npcs: [
        { npcId: 'npc_zoushi', name: '邹氏' },
        { npcId: 'npc_other_zou', name: '邹氏' },
      ] as any,
      heroineThreads: [
        makeHeroine('bond_player_zoushi_conquest', 'npc_zoushi', '公元194年05月03日 05:00（卯时）', {
          tags: ['庇护'],
          milestones: [{ milestoneId: 'zou_m1', happenedAt: '公元194年05月03日 05:00（卯时）', summary: '建立关系。' }],
        }),
        makeHeroine('ht_zoushi', 'npc_zoushi', '公元194年05月03日 08:00（辰时）', {
          stage: '随军宠妾',
          summary: '随军前往云梦泽。',
          tags: ['随军'],
          milestones: [{ milestoneId: 'zou_m2', happenedAt: '公元194年05月03日 08:00（辰时）', summary: '随军启程。' }],
        }),
        makeHeroine('heroine_other_zou', 'npc_other_zou', '公元194年05月03日 09:00（巳时）'),
      ],
    } as RuntimeState);

    expect(state.heroineThreads).toHaveLength(2);
    expect(state.heroineThreads[0]).toMatchObject({
      heroineThreadId: 'bond_player_zoushi_conquest',
      npcId: 'npc_zoushi',
      npcName: '邹氏',
      stage: '随军宠妾',
      summary: '随军前往云梦泽。',
      lastUpdatedAt: '公元194年05月03日 08:00（辰时）',
      tags: ['庇护', '随军'],
    });
    expect(state.heroineThreads[0].milestones?.map((item) => item.milestoneId)).toEqual(['zou_m1', 'zou_m2']);
    expect(state.heroineThreads[1].npcId).toBe('npc_other_zou');
  });

  it('不会让同 npcId 的畸形旧记录覆盖合法红颜线', () => {
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      heroineThreads: [
        {
          heroineThreadId: 'heroine_valid',
          npcId: 'npc_zoushi',
          npcName: '邹氏',
          status: 'active',
          stage: '互信成形',
          relationshipRole: '红颜',
          summary: '合法记录。',
          lastUpdatedAt: '公元194年05月03日 08:00（辰时）',
        },
        {
          heroineThreadId: 'heroine_invalid',
          npcId: 'npc_zoushi',
          npcName: '邹氏',
          status: 'unknown',
          stage: '错误阶段',
          relationshipRole: '红颜',
          summary: '不应覆盖合法记录。',
          lastUpdatedAt: '公元194年05月03日 09:00（巳时）',
        },
      ],
    } as RuntimeState);

    expect(state.heroineThreads).toHaveLength(2);
    expect(state.heroineThreads[0]).toMatchObject({
      heroineThreadId: 'heroine_valid',
      status: 'active',
      summary: '合法记录。',
    });
  });

  it('从已确认的区域以上纪事归一历史锚点终态账本', () => {
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      currentDate: '公元220年01月01日',
      worldTrends: [{
        trendId: 'trend_wei_founded',
        title: '曹魏建立',
        severity: '极高',
        summary: '本局已经确认新的政权格局。',
        knownToPlayer: true,
        status: 'historical',
        scope: 'realm',
        certainty: 'confirmed',
        consequenceTags: ['worldline:realized:tk3k_220_caopi_usurp'],
        updatedAt: '公元220年01月01日',
      }],
    });

    expect(state.worldlineAnchorStates).toEqual([{
      cardId: 'tk3k_220_caopi_usurp',
      disposition: 'realized',
      assessedAt: '公元220年01月01日',
      factRefs: ['worldTrend:trend_wei_founded'],
      outcomeRef: 'worldTrend:trend_wei_founded',
      note: '由天下纪事“曹魏建立”确认。',
    }]);
  });

  it('从旧档明确 locationId 补齐最后已知位置，但不覆盖已有不同情报位置', () => {
    const state = ensureLuanShiState({
      ...makeLegacyState(),
      troops: [
        {
          troopId: 'troop_legacy_position',
          name: '旧档郡兵',
          size: 300,
          morale: 50,
          training: 60,
          supplies: 40,
          task: '驻守南门',
          relationToPlayer: 'self',
          locationId: ' place_south_camp ',
          updatedAt: '公元189年09月01日 12:00（午时）',
        },
        {
          troopId: 'troop_existing_intel',
          name: '远场敌军',
          size: 500,
          morale: 50,
          training: 60,
          supplies: 40,
          task: '动向不明',
          relationToPlayer: '敌对',
          locationId: 'place_current_report',
          lastKnownLocationId: 'place_older_sighting',
          lastKnownAt: '公元189年08月30日 12:00（午时）',
        },
      ],
    });

    expect(state.troops[0]).toEqual(expect.objectContaining({
      locationId: 'place_south_camp',
      lastKnownLocationId: 'place_south_camp',
      lastKnownAt: '公元189年09月01日 12:00（午时）',
    }));
    expect(state.troops[1]).toEqual(expect.objectContaining({
      locationId: 'place_current_report',
      lastKnownLocationId: 'place_older_sighting',
      lastKnownAt: '公元189年08月30日 12:00（午时）',
    }));
  });

  it('兼容没有绝艺成长账本与领地治理项目字段的旧存档', () => {
    const legacy = makeLegacyState();
    legacy.player.uniqueArts = [{
      id: 'art_legacy_strategy',
      name: '旧策',
      rarity: 'blue',
      domain: 'strategy',
      level: 2,
      description: '旧存档中的既有绝艺。',
      effectSummary: '用于谋略。',
      source: 'legacy-save',
    }];
    delete (legacy as Partial<RuntimeState>).holdingGovernanceProjects;

    const state = ensureLuanShiState(legacy);

    expect(state.player.uniqueArts?.[0]).toMatchObject({
      id: 'art_legacy_strategy',
      level: 2,
    });
    expect(state.player.uniqueArts?.[0].progressHistory).toBeUndefined();
    expect(state.holdingGovernanceProjects).toEqual([]);
  });
});
