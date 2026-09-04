import { describe, expect, it } from 'vitest';
import type { Relationship, RuntimeState } from '../types';
import { ensureLuanShiState } from './createInitialRuntimeState';
import { makeWarTroop } from '../encounterV2/WarTestFixtures';
import {
  CURRENT_RUNTIME_STATE_MIGRATION_VERSION,
  normalizeRuntimeCharacterBirthDates,
  normalizeRuntimeStateForPersistence,
} from './RuntimeStateMigration';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'migration-test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: 'day 1',
    currentDate: 'day 1',
    player: {
      id: 'player',
      name: 'Player',
      roleType: 'traveler',
      summary: 'Migration test player.',
    },
    currentLocationId: 'place_test',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
  });
}

function relationship(overrides: Record<string, unknown> = {}) {
  return {
    id: 'relationship_legacy',
    actorId: 'actor_source',
    targetId: 'faction_target',
    targetType: 'faction',
    type: 'neutral',
    value: 10,
    description: 'Legacy relationship.',
    ...overrides,
  };
}

describe('RuntimeStateMigration relationship invariant', () => {
  it('uses the current migration version for narrative perspective compatibility', () => {
    expect(CURRENT_RUNTIME_STATE_MIGRATION_VERSION).toBe(20);
  });

  it('repairs legacy troop deployment capacity above the surviving troop size without provider work', () => {
    const state = makeState();
    state.troops = [makeWarTroop('troop_legacy_survivors', {
      size: 282,
      deployableSize: 300,
    })];

    const migrated = normalizeRuntimeStateForPersistence(state);

    expect(migrated.troops?.[0]).toMatchObject({
      troopId: 'troop_legacy_survivors',
      size: 282,
      deployableSize: 282,
    });
  });

  it('upgrades legacy authored prose into executable ability rules without an API call', () => {
    const state = makeState();
    state.player.traits = [{
      id: 'custom_trait_fast_learning',
      label: '悟性无双',
      description: '能够快速完美学习任何技能。',
      source: 'custom',
    }];
    state.player.uniqueArts = [{
      id: 'art_full_heal',
      name: '万象回春',
      rarity: 'red',
      domain: 'personalCombat',
      level: 1,
      description: '每次使用必定恢复所有生命。',
      effectSummary: '恢复所有生命。',
      source: 'opening',
    }];

    const migrated = normalizeRuntimeStateForPersistence(state);

    expect(migrated.player.traits?.[0].mechanics?.status).toBe('executable');
    expect(migrated.player.uniqueArts?.[0].mechanics?.rules[0]).toMatchObject({
      trigger: 'on_unique_art_use',
      effects: [expect.objectContaining({ type: 'restore_to_max', resource: 'hp' })],
    });
  });

  it('deterministically derives civil scale for legacy holdings without an API call', () => {
    const state = makeState();
    state.holdings = [{
      holdingId: 'holding_wancheng',
      name: '旧档领地名称',
      type: 'city',
      status: 'controlled',
      summary: '旧档中的宛城民政账本。',
      locationId: 'place_nanyang_wan',
      civilAdministrationScope: 'territorial',
      scaleLevel: 2,
      agriculture: 70,
      commerce: 72,
      population: 80,
      publicOrder: 60,
      popularSupport: 58,
      defense: 65,
      recruitPotential: 55,
      armory: 50,
      horseSupply: 25,
      corruption: 30,
      farmlandMu: 1_200_000,
      registeredHouseholds: 90_000,
      updatedAt: 'day 1',
    }];

    const migrated = normalizeRuntimeStateForPersistence(state);
    expect(migrated.holdings?.[0]).toMatchObject({
      holdingId: 'holding_wancheng',
      civilScaleLevel: 5,
      farmlandMu: 1_200_000,
      registeredHouseholds: 90_000,
    });
  });

  it('removes internal letter codes and body copies from legacy visible NPC records', () => {
    const state = makeState();
    state.npcs = [{
      npcId: 'npc_caiyan',
      name: '蔡琰',
      sex: '女',
      age: 20,
      role: '友人',
      isPresent: false,
      isFocused: true,
      summary: '与玩家保持书信往来。',
      appearance: '衣着素雅。',
      personality: '沉静。',
      motivation: '关心友人近况。',
      relationToPlayer: '友人',
      contactLevel: 4,
      recentAttitude: '关切',
      memories: [{
        memoryId: 'memory_correspondence:letter_old_1',
        eventId: 'letter_old_1',
        source: '亲历',
        content: '收到书信（letter_old_1）：请立刻调拨二百石粮草，这是不应复制的原文。',
        createdAt: 'day 1',
      }, {
        memoryId: 'memory_correspondence_sent:letter_old_2',
        eventId: 'letter_old_2',
        source: '亲历',
        content: '寄出书信（letter_old_2）：已将完整回信原文复制到记忆。',
        createdAt: 'day 1',
      }],
      presenceUpdates: [{
        id: 'correspondence:letter_old_2',
        createdAt: 'day 1',
        kind: 'letter',
        summary: '书信 letter_old_2',
        source: '书信 letter_old_2',
        readByPlayer: false,
      }],
    }];
    state.correspondence = [{
      letterId: 'letter_old_1',
      direction: 'outgoing',
      sender: { kind: 'player', playerId: 'player', name: 'Player' },
      recipient: { kind: 'npc', npcId: 'npc_caiyan', name: '蔡琰' },
      subject: '',
      body: '请立刻调拨二百石粮草，这是不应复制的原文。',
      summary: '请求蔡琰协助调拨二百石粮草',
      source: 'ui',
      channel: 'letter',
      status: 'delivered',
      createdAt: 'day 1',
      deliveredAt: 'day 1',
    }, {
      letterId: 'letter_old_2',
      direction: 'incoming',
      sender: { kind: 'npc', npcId: 'npc_caiyan', name: '蔡琰' },
      recipient: { kind: 'player', playerId: 'player', name: 'Player' },
      subject: '',
      body: '已将完整回信原文复制到记忆。',
      summary: '答复粮草已备妥，三日后启运',
      source: 'narrative',
      channel: 'letter',
      status: 'deliveredPendingProcessing',
      createdAt: 'day 1',
      deliveredAt: 'day 1',
    }];

    const migrated = normalizeRuntimeStateForPersistence(state);
    const npc = migrated.npcs?.[0];
    expect(npc?.memories[0]).toMatchObject({
      eventId: 'letter_old_1',
      content: '收到Player来信：请求蔡琰协助调拨二百石粮草',
    });
    expect(npc?.memories[1]).toMatchObject({
      eventId: 'letter_old_2',
      content: '已向Player寄出书信：答复粮草已备妥，三日后启运',
    });
    expect(npc?.presenceUpdates?.[0]).toMatchObject({
      id: 'correspondence:letter_old_2',
      summary: '答复粮草已备妥，三日后启运',
      source: '蔡琰来信',
    });
    const visibleText = [
      ...(npc?.memories.map((memory) => memory.content) ?? []),
      ...(npc?.presenceUpdates?.flatMap((update) => [update.summary, update.source]) ?? []),
    ].join(' ');
    expect(visibleText).not.toContain('letter_old_');
    expect(visibleText).not.toContain('这是不应复制的原文');
    expect(visibleText).not.toContain('完整回信原文复制到记忆');
  });

  it('migrates legacy character ages to stable complete birthdays without provider work', () => {
    const state = makeState();
    state.currentDate = '公元194年04月15日 09:00（巳时）';
    state.player = { ...state.player, age: 28 };
    state.npcs = [{
      npcId: 'npc_legacy_birth',
      name: '旧档人物',
      sex: '男',
      age: 33,
      ageKnownAtDate: '公元194年04月15日 09:00（巳时）',
      role: '军吏',
      isPresent: false,
      isFocused: false,
      summary: '旧档人物。',
      appearance: '衣着整洁。',
      personality: '谨慎。',
      motivation: '维持生计。',
      relationToPlayer: '旧识',
      contactLevel: 2,
      recentAttitude: '平静',
      memories: [],
    }];

    const first = normalizeRuntimeCharacterBirthDates(state);
    const second = normalizeRuntimeCharacterBirthDates(first);
    expect(first.player.birthDate).toMatch(/^公元\d+年\d{2}月\d{2}日$/);
    expect(first.npcs?.[0].birthDate).toMatch(/^公元\d+年\d{2}月\d{2}日$/);
    expect(first.npcs?.[0].ageKnownAtDate).toBeUndefined();
    expect(second).toEqual(first);
  });

  it('migrates ten thousand legacy NPC birthdays locally within a generous UI budget', () => {
    const state = makeState();
    state.currentDate = '公元194年04月15日 09:00（巳时）';
    const prototypeNpc = {
      name: '旧档人物', sex: '男' as const, age: 33, role: '军吏',
      isPresent: false, isFocused: false, summary: '旧档人物。', appearance: '衣着整洁。',
      personality: '谨慎。', motivation: '维持生计。', relationToPlayer: '旧识',
      contactLevel: 2, recentAttitude: '平静', memories: [],
    };
    state.npcs = Array.from({ length: 10_000 }, (_, index) => ({
      ...prototypeNpc,
      npcId: `npc_legacy_${index}`,
      ageKnownAtDate: state.currentDate,
    }));

    const startedAt = Date.now();
    const migrated = normalizeRuntimeCharacterBirthDates(state);
    const elapsedMs = Date.now() - startedAt;
    expect(migrated.npcs).toHaveLength(10_000);
    expect(migrated.npcs?.every((npc) => /^公元\d+年\d{2}月\d{2}日$/.test(npc.birthDate ?? ''))).toBe(true);
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it('repairs the Longzhong seasonal clock reset while preserving elapsed minutes', () => {
    const state = makeState();
    state.worldBookId = 'threeKingdoms';
    state.worldBookVersion = '0.1.0';
    state.startBookmarkId = 'bookmark_207_longzhong_plan';
    state.startDate = '207年冬';
    state.currentDate = '公元1年01月01日 09:15（巳时）';
    state.currentTime = { year: 1, month: 1, day: 1, hour: 9, minute: 15 };

    const migrated = normalizeRuntimeStateForPersistence(state);

    expect(migrated.startDate).toBe('公元207年10月01日 08:00（辰时）');
    expect(migrated.currentDate).toBe('公元207年10月01日 09:15（巳时）');
    expect(migrated.currentTime).toEqual({ year: 207, month: 10, day: 1, hour: 9, minute: 15 });
  });

  it('does not reinterpret an unrelated custom-world year-one clock', () => {
    const state = makeState();
    state.currentDate = '公元1年01月01日 09:15（巳时）';
    state.currentTime = { year: 1, month: 1, day: 1, hour: 9, minute: 15 };

    const migrated = normalizeRuntimeStateForPersistence(state);

    expect(migrated.currentDate).toBe('公元1年01月01日 09:15（巳时）');
    expect(migrated.currentTime).toEqual({ year: 1, month: 1, day: 1, hour: 9, minute: 15 });
  });

  it('persists a bounded projection once for legacy combat arts that lack one', () => {
    const state = makeState();
    state.player.uniqueArts = [{
      id: 'art_legacy_blade',
      name: '旧档刀势',
      rarity: 'purple',
      domain: 'personalCombat',
      level: 4,
      maxLevel: 10,
      progress: 20,
      description: '旧档中已有的个人战绝艺。',
      effectSummary: '提高个人战表现。',
      source: 'event',
    }];

    const first = normalizeRuntimeStateForPersistence(state);
    const second = normalizeRuntimeStateForPersistence(first);

    expect(first.encounterV2?.semanticProjections).toEqual([
      expect.objectContaining({
        sourceId: 'art_legacy_blade',
        sourceType: 'unique_art',
        status: 'executable',
        rulesetScopes: ['personal_combat'],
      }),
    ]);
    expect(second.encounterV2?.semanticProjections).toEqual(first.encounterV2?.semanticProjections);
  });

  it('self-heals duplicate persisted NPC traits and unique arts without provider work', () => {
    const state = makeState();
    state.npcs = [{
      npcId: 'npc_duplicate_profile',
      name: '重复人物',
      sex: '男',
      age: 30,
      role: '军吏',
      isPresent: false,
      isFocused: false,
      summary: '旧档人物。',
      appearance: '衣着整洁。',
      personality: '谨慎。',
      motivation: '维持生计。',
      relationToPlayer: '旧识',
      contactLevel: 2,
      recentAttitude: '平静',
      traits: [
        { id: 'trait_loyal', label: '至孝', description: '敬亲。', source: 'history', rarity: 'blue' },
        { id: 'trait_loyal_drifted', label: ' 至 孝 ', description: '敬奉亲长，始终不改。', source: 'event', rarity: 'orange' },
      ],
      uniqueArts: [
        {
          id: 'art_social', name: '人情折冲', rarity: 'blue', domain: 'social', level: 2,
          description: '善于交涉。', effectSummary: '交涉时发挥作用。', source: 'history',
        },
        {
          id: 'art_social_drifted', name: '人情 折冲', rarity: 'purple', domain: 'social', level: 3,
          description: '善于在复杂关系中交涉。', effectSummary: '交涉与关系经营时发挥作用。', source: 'event',
        },
      ],
      memories: [],
    }];

    const first = normalizeRuntimeStateForPersistence(state);
    const second = normalizeRuntimeStateForPersistence(first);

    expect(first.npcs?.[0].traits).toEqual([
      expect.objectContaining({ id: 'trait_loyal', label: '至孝', rarity: 'orange' }),
    ]);
    expect(first.npcs?.[0].uniqueArts).toEqual([
      expect.objectContaining({ id: 'art_social', name: '人情折冲', rarity: 'purple', level: 3 }),
    ]);
    expect(second.npcs?.[0].traits).toEqual(first.npcs?.[0].traits);
    expect(second.npcs?.[0].uniqueArts).toEqual(first.npcs?.[0].uniqueArts);
  });

  it('repairs legacy duplicate loadout IDs and duplicate NPC slots without losing distinct items', () => {
    const state = makeState();
    state.player = {
      ...state.player,
      equipment: [
        {
          id: 'eq_legacy_duplicate',
          slot: 'weapon',
          name: '方天画戟',
          quality: '传奇',
          description: '主武器。',
        },
        {
          id: 'eq_legacy_duplicate',
          slot: 'armor',
          name: '玄铁锁卫铠',
          quality: '名品',
          description: '护甲。',
        },
        {
          id: 'eq_legacy_duplicate',
          slot: 'mount',
          name: '朔风白翎',
          quality: '名品',
          description: '坐骑。',
        },
      ],
      inventory: [
        { id: 'eq_legacy_duplicate', name: '方天画戟', quantity: 1, category: 'equipment', equipSlot: 'weapon' },
        { id: 'eq_legacy_duplicate', name: '塞外神弓', quantity: 1, category: 'equipment', equipSlot: 'weapon' },
        { id: 'eq_legacy_duplicate', name: '玄铁锁卫铠', quantity: 1, category: 'equipment', equipSlot: 'armor' },
        { id: 'eq_legacy_duplicate', name: '朔风白翎', quantity: 1, category: 'equipment', equipSlot: 'mount' },
        { id: 'eq_legacy_duplicate', name: '陌刀', quantity: 1, category: 'equipment', equipSlot: 'weapon' },
      ],
    };
    state.npcs = [{
      npcId: 'npc_zhao_yun',
      name: '赵云',
      sex: '男',
      age: 28,
      role: '武将',
      locationId: 'place_test',
      isPresent: true,
      isFocused: true,
      summary: '常山赵子龙。',
      appearance: '银甲白袍。',
      personality: '沉着果敢。',
      motivation: '护民守义。',
      relationToPlayer: '友军',
      contactLevel: 5,
      recentAttitude: '郑重',
      abilityScores: { 武力: 96, 统率: 85, 智力: 75, 政治: 65, 魅力: 85, 机运: 70 },
      traits: [],
      memories: [],
      equipment: [
        {
          id: 'eq_zhao_yun_spear',
          slot: 'weapon',
          name: '龙胆亮银枪',
          quality: '传奇',
          description: '赵云所持长枪。',
        },
        {
          id: 'eq_zhao_yun_spear',
          slot: 'weapon',
          name: '龙胆亮银枪',
          quality: '传奇',
          description: '赵云所持长枪。',
        },
      ],
    }];

    const normalized = normalizeRuntimeStateForPersistence(state);
    const playerEquipmentIds = normalized.player.equipment?.map((item) => item.id) ?? [];
    const playerInventoryIds = normalized.player.inventory?.map((item) => item.id) ?? [];

    expect(new Set(playerEquipmentIds).size).toBe(3);
    expect(new Set(playerInventoryIds).size).toBe(5);
    expect(normalized.player.inventory).toHaveLength(5);
    for (const equipped of normalized.player.equipment ?? []) {
      expect(normalized.player.inventory).toContainEqual(expect.objectContaining({
        id: equipped.id,
        name: equipped.name,
        equipSlot: equipped.slot,
      }));
    }
    expect(normalized.npcs?.[0].equipment).toEqual([
      expect.objectContaining({
        id: 'eq_zhao_yun_spear',
        slot: 'weapon',
        name: '龙胆亮银枪',
      }),
    ]);
    expect(normalized.npcs?.[0].inventory ?? []).toEqual([]);
  });

  it('closes a persisted quest-linked NPC plan whose canonical matter is already terminal', () => {
    const state = makeState();
    state.activeQuests = [{
      id: 'quest_supplies_delivered',
      title: '兑现精料承诺',
      description: '把约定的精料送入营库。',
      status: 'completed',
      outcomeSummary: '约定物资已经交付并完成入库。',
      archivedAt: 'day 1',
      createdAt: 'day 0',
      updatedAt: 'day 1',
    }];
    state.npcs = [{
      npcId: 'npc_supplier',
      name: '供货人',
      sex: '男',
      age: 40,
      role: '豪族管事',
      locationId: 'place_test',
      isPresent: false,
      isFocused: true,
      summary: '负责履行旧供应承诺。',
      appearance: '衣着整洁。',
      personality: '谨慎。',
      motivation: '维护家族利益。',
      relationToPlayer: '合作',
      contactLevel: 3,
      recentAttitude: '恭谨',
      memories: [],
      backgroundActivity: {
        activityId: 'activity_prepare_supplies',
        summary: '继续筹备尚未交付的物资。',
        status: 'active',
        sourceType: 'quest',
        sourceIds: ['quest_supplies_delivered'],
        dueAt: 'day 1',
      },
    }];

    const normalized = normalizeRuntimeStateForPersistence(state);

    expect(normalized.npcs?.[0].backgroundActivity).toMatchObject({
      activityId: 'activity_prepare_supplies',
      status: 'completed',
      lastEvaluatedAt: 'day 1',
    });
  });

  it('normalizes a legacy targetType-only relationship to consistent canonical fields', () => {
    const state = makeState();
    const legacyRelationship: Relationship = {
      id: 'relationship_legacy',
      actorId: 'actor_source',
      targetId: 'faction_target',
      targetType: 'faction',
      type: 'neutral',
      value: 10,
      description: 'Legacy relationship.',
    };
    state.relationships = [legacyRelationship];

    const normalized = normalizeRuntimeStateForPersistence(state);

    expect(normalized.relationships).toEqual([
      expect.objectContaining({
        id: 'relationship_legacy',
        targetKind: 'faction',
        targetType: 'faction',
      }),
    ]);
  });

  it('recovers a recent structured firsthand NPC memory that the stale presence flag rejected', () => {
    const state = makeState();
    state.npcs = [{
      npcId: 'npc_zoushi',
      name: '邹氏',
      sex: '女',
      age: 32,
      role: '内宅女眷',
      locationId: 'place_test',
      isPresent: false,
      isFocused: true,
      summary: '测试人物。',
      appearance: '端庄。',
      personality: '谨慎。',
      motivation: '安身。',
      relationToPlayer: '亲近',
      contactLevel: 80,
      recentAttitude: '依恋',
      memories: [],
    }];
    state.turnLog = [{
      turnNumber: 251,
      date: '公元194年05月03日 15:00（申时）',
      playerInput: '与邹氏交谈',
      narrativeText: '邹氏在内宅应答。',
      fullNarrativeText: '【邹氏】\n“夫君回来了。”',
      statePatchSummary: '已忽略无效写回建议：NPC记忆：NPC 邹氏 当前不在场，不能写入亲历记忆。',
      timestamp: '2026-07-18T08:30:00.000Z',
      displayMeta: {
        rawResponse: JSON.stringify({
          narrativeText: '【邹氏】\n“夫君回来了。”',
          suggestedActions: [],
          writeback: {
            npcMemorySuggestions: [{
              npcId: 'npc_zoushi',
              npcName: '邹氏',
              source: '亲历',
              content: '邹氏在内宅亲自迎接主角。',
            }],
          },
        }),
      },
    }];

    const normalized = normalizeRuntimeStateForPersistence(state);

    expect(normalized.npcs?.[0].memories).toEqual([
      expect.objectContaining({
        source: '亲历',
        content: '邹氏在内宅亲自迎接主角。',
        createdAt: '公元194年05月03日 15:00（申时）',
      }),
    ]);
  });

  it('repairs a legacy player identity description from the paired structured writeback', () => {
    const state = makeState();
    state.player = {
      ...state.player,
      currentIdentity: '讨寇校尉',
      currentIdentityDescription: '统领一曲步卒的基层带兵武官。',
      identitySummary: '以别部司马身份统领一曲步卒。',
    };
    state.turnLog = [{
      turnNumber: 273,
      date: '公元194年05月05日 07:00（辰时）',
      playerInput: '询问州牧府回信',
      narrativeText: '州牧府正式加封主角为讨寇校尉。',
      statePatchSummary: 'luanshiCommand: 正式加封为讨寇校尉。',
      timestamp: '2026-07-20T12:00:00.000Z',
      displayMeta: {
        rawResponse: JSON.stringify({
          narrativeText: '州牧府正式加封主角为讨寇校尉。',
          suggestedActions: [],
          statePatches: [{
            type: 'luanshiCommand',
            payload: {
              command: {
                action: 'updateCharacterIdentity',
                characterId: 'player',
                currentIdentity: '讨寇校尉',
                militaryTitle: '讨寇校尉',
              },
            },
          }],
          writeback: {
            protagonistProfile: {
              currentIdentity: '讨寇校尉',
              currentIdentityDescription: '受州牧府正式加封，可独立统领数千兵马的校尉。',
              identitySummary: '受封讨寇校尉，奉命扼守云梦泽水路。',
            },
          },
        }),
      },
    }];

    const normalized = normalizeRuntimeStateForPersistence(state);

    expect(normalized.player.currentIdentityDescription)
      .toBe('受州牧府正式加封，可独立统领数千兵马的校尉。');
    expect(normalized.player.identitySummary).toBe('受封讨寇校尉，奉命扼守云梦泽水路。');
  });

  it('clears legacy dependent identity text when the latest structured promotion omitted replacements', () => {
    const state = makeState();
    state.player = {
      ...state.player,
      currentIdentity: '讨寇校尉',
      currentIdentityDescription: '统领一曲步卒的基层带兵武官。',
      identitySummary: '以别部司马身份统领一曲步卒。',
    };
    state.turnLog = [{
      turnNumber: 273,
      date: '公元194年05月05日 07:00（辰时）',
      playerInput: '询问州牧府回信',
      narrativeText: '州牧府正式加封主角为讨寇校尉。',
      statePatchSummary: 'luanshiCommand: 正式加封为讨寇校尉。',
      timestamp: '2026-07-20T12:00:00.000Z',
      displayMeta: {
        rawResponse: JSON.stringify({
          narrativeText: '州牧府正式加封主角为讨寇校尉。',
          suggestedActions: [],
          statePatches: [{
            type: 'luanshiCommand',
            payload: {
              command: {
                action: 'updateCharacterIdentity',
                characterId: 'player',
                currentIdentity: '讨寇校尉',
              },
            },
          }],
        }),
      },
    }];

    const normalized = normalizeRuntimeStateForPersistence(state);

    expect(normalized.player.currentIdentityDescription).toBeUndefined();
    expect(normalized.player.identitySummary).toBeUndefined();
  });

  it.each([
    relationship({ targetKind: 'actor', targetType: 'faction' }),
    relationship({ targetKind: 'invalid', targetType: 'faction' }),
    relationship({ targetKind: 'faction', targetType: 'invalid' }),
  ])('rejects conflicting or invalid persisted relationship kinds %#', (invalidRelationship) => {
    const state = makeState();
    state.relationships = [invalidRelationship as RuntimeState['relationships'][number]];

    expect(() => normalizeRuntimeStateForPersistence(state)).toThrow(/relationship|targetKind|targetType|关系/);
  });

  it.each([-101, 101])('rejects a persisted relationship value outside -100..100: %s', (value) => {
    const state = makeState();
    state.relationships = [relationship({ targetKind: 'faction', value }) as Relationship];

    expect(() => normalizeRuntimeStateForPersistence(state)).toThrow(/value|关系值|-100|100/);
  });

  it.each([-100, 100])('preserves an inclusive relationship boundary value: %s', (value) => {
    const state = makeState();
    state.relationships = [relationship({ targetKind: 'faction', value }) as Relationship];

    expect(normalizeRuntimeStateForPersistence(state).relationships[0].value).toBe(value);
  });
});
