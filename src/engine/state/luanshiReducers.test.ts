import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { applyLuanShiCommand } from './luanshiReducers';

const baseState: RuntimeState = {
  engineVersion: '0.1.0',
  worldBookId: 'test',
  worldBookVersion: '0.1.0',
  worldBookSource: 'official',
  startDate: '公元189年09月01日 12:00（午时）',
  currentDate: '公元189年09月01日 12:00（午时）',
  player: {
    id: 'player',
    name: '主角',
    roleType: 'player',
    summary: '测试角色',
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
  npcs: [
    {
      npcId: 'npc_guard',
      name: '陈达',
      sex: '男',
      age: 28,
      role: '北军屯长',
      locationId: 'place_test',
      isPresent: true,
      isFocused: true,
      currentIdentity: '副将',
      summary: '测试 NPC',
      appearance: '体格健壮。',
      personality: '直爽务实。',
      motivation: '护住部曲。',
      relationToPlayer: '同营。',
      contactLevel: 20,
      recentAttitude: '信任',
      abilityScores: {
        武力: 60,
        统率: 55,
        智力: 40,
        政治: 30,
        魅力: 45,
        机运: 35,
      },
      traits: [],
      effects: [],
      memories: [],
    },
  ],
};

describe('applyLuanShiCommand', () => {
  it('rejects an incomplete identity change and preserves the stable profile', () => {
    const state = {
      ...baseState,
      player: {
        ...baseState.player,
        currentIdentity: '别部司马',
        currentIdentityDescription: '统领一曲步卒的基层带兵武官。',
        identitySummary: '以别部司马身份统领一曲步卒。',
      },
    };

    const next = applyLuanShiCommand(state, {
      action: 'updateCharacterIdentity',
      characterId: 'player',
      currentIdentity: '讨寇校尉',
      militaryTitle: '讨寇校尉',
    } as any);

    expect(next.player.currentIdentity).toBe('别部司马');
    expect(next.player.currentIdentityDescription).toBe('统领一曲步卒的基层带兵武官。');
    expect(next.player.identitySummary).toBe('以别部司马身份统领一曲步卒。');
  });

  it('atomically applies a changed identity with its paired description and summary', () => {
    const state = {
      ...baseState,
      player: {
        ...baseState.player,
        currentIdentity: '别部司马',
        currentIdentityDescription: '统领一曲步卒的基层带兵武官。',
        identitySummary: '以别部司马身份统领一曲步卒。',
      },
    };

    const next = applyLuanShiCommand(state, {
      action: 'updateCharacterIdentity',
      characterId: 'player',
      currentIdentity: '讨寇校尉',
      currentIdentityDescription: '受州牧府正式加封，可独立统领数千兵马的校尉。',
      identitySummary: '受封讨寇校尉，奉命扼守云梦泽水路。',
      militaryTitle: '讨寇校尉',
      personalEscortEntitlement: {
        status: 'customary',
        bases: ['military_command'],
        updatedAt: '公元189年09月01日 12:00（午时）',
      },
    } as any);

    expect(next.player).toMatchObject({
      currentIdentity: '讨寇校尉',
      currentIdentityDescription: '受州牧府正式加封，可独立统领数千兵马的校尉。',
      identitySummary: '受封讨寇校尉，奉命扼守云梦泽水路。',
    });
  });

  it('clears stale escort entitlement on authority changes and atomically stores a replacement', () => {
    const state = {
      ...baseState,
      player: {
        ...baseState.player,
        militaryTitle: '军侯',
        personalEscortEntitlement: {
          status: 'customary' as const,
          bases: ['military_command' as const],
          updatedAt: baseState.currentDate,
        },
      },
    };
    const cleared = applyLuanShiCommand(state, {
      action: 'updateCharacterIdentity',
      characterId: 'player',
      currentIdentity: null,
      militaryTitle: null,
      personalEscortEntitlement: null,
    });
    expect(cleared.player.personalEscortEntitlement).toBeUndefined();

    const replacement = {
      status: 'customary' as const,
      bases: ['official_position' as const],
      updatedAt: '公元189年09月02日 08:00（辰时）',
    };
    const replaced = applyLuanShiCommand(state, {
      action: 'updateCharacterIdentity',
      characterId: 'player',
      currentIdentity: null,
      militaryTitle: null,
      officeTitle: '县令',
      personalEscortEntitlement: replacement,
    });
    expect(replaced.player.personalEscortEntitlement).toEqual(replacement);
    expect(replaced.player.personalEscortEntitlement).not.toBe(replacement);
    expect(replaced.player.personalEscortEntitlement?.bases).not.toBe(replacement.bases);
  });

  it('preserves dependent identity text when currentIdentity is written unchanged', () => {
    const state = {
      ...baseState,
      player: {
        ...baseState.player,
        currentIdentity: '讨寇校尉',
        currentIdentityDescription: '受州牧府正式加封的校尉。',
        identitySummary: '奉命扼守云梦泽水路。',
      },
    };

    const next = applyLuanShiCommand(state, {
      action: 'updateCharacterIdentity',
      characterId: 'player',
      currentIdentity: ' 讨寇校尉 ',
      factionName: '荆州官府',
      personalEscortEntitlement: {
        status: 'none',
        bases: [],
        updatedAt: '公元189年09月01日 12:00（午时）',
      },
    } as any);

    expect(next.player.currentIdentityDescription).toBe('受州牧府正式加封的校尉。');
    expect(next.player.identitySummary).toBe('奉命扼守云梦泽水路。');
  });

  it('keeps an NPC previous display name as an alias when a stable record is renamed', () => {
    const state = applyLuanShiCommand({
      ...baseState,
      npcs: baseState.npcs!.map((npc) => npc.npcId === 'npc_guard'
        ? { ...npc, name: '流民头领', aliases: ['陈头领'] }
        : npc),
    }, {
      action: 'updateCharacterIdentity',
      characterId: 'npc_guard',
      name: '张铁',
      currentIdentity: '白杨湾屯长',
      currentIdentityDescription: '受白杨湾乡民推举，负责统领本地守备。',
      identitySummary: '张铁现任白杨湾屯长。',
    } as any);

    expect(state.npcs.find((npc) => npc.npcId === 'npc_guard')).toMatchObject({
      name: '张铁',
      aliases: ['陈头领', '流民头领'],
    });
  });

  it('updates only NPC presence fields and preserves the existing profile', () => {
    const originalNpc = baseState.npcs![0];
    const state = applyLuanShiCommand(baseState, {
      action: 'updateNpcPresence',
      npcId: 'npc_guard',
      locationId: 'place_remote',
      isPresent: false,
      isFocused: false,
    } as any);
    const npc = state.npcs.find((entry) => entry.npcId === 'npc_guard');

    expect(npc).toMatchObject({
      npcId: 'npc_guard',
      locationId: 'place_remote',
      isPresent: false,
      isFocused: false,
      name: originalNpc.name,
      currentIdentity: originalNpc.currentIdentity,
      relationToPlayer: originalNpc.relationToPlayer,
    });
    expect(npc?.abilityScores).toEqual(originalNpc.abilityScores);
  });

  it('deep-clones nested NPC loadout fields from updateNpcLoadout changes', () => {
    const equipmentItem = {
      id: 'eq_guard_sabre',
      slot: 'weapon' as const,
      name: '守营刀',
      quality: 'blue',
      description: '陈达随身守营兵器。',
      condition: '锋刃完好',
      statBonuses: { 武力: 3 },
      promptHint: '守营近战时生效。',
      checkHooks: [{ scope: 'personalCombat.melee', modifier: 3, note: '守营刀顺手。' }],
      unlocks: ['拦截'],
      risks: ['不利远战'],
    };
    const inventoryItem = {
      id: 'item_guard_order',
      name: '守营令牌',
      quantity: 1,
      description: '用于调动守营士卒。',
      category: 'token',
      quality: 'green',
      equipSlot: 'treasure' as const,
      condition: '字迹清晰',
      statBonuses: { 交涉: 2 },
      promptHint: '调动守卒时生效。',
      checkHooks: [{ scope: 'ordinaryCheck.command', modifier: 2, note: '令牌有效。' }],
      unlocks: ['调动守卒'],
      risks: ['遗失追责'],
      keyItem: true,
      updatedAt: '公元189年09月01日 12:00（午时）',
    };
    const command = {
      action: 'updateNpcLoadout' as const,
      npcId: 'npc_guard',
      npcName: '陈达',
      equipmentChanges: [{ action: 'upsert' as const, item: equipmentItem }],
      inventoryChanges: [{ action: 'upsert' as const, item: inventoryItem }],
    };

    const state = applyLuanShiCommand(baseState, command);
    const npc = state.npcs.find((entry) => entry.npcId === 'npc_guard');

    expect(npc?.equipment?.[0]).toEqual(equipmentItem);
    expect(npc?.inventory?.[0]).toEqual(inventoryItem);
    expect(npc?.equipment?.[0].statBonuses).not.toBe(equipmentItem.statBonuses);
    expect(npc?.equipment?.[0].checkHooks).not.toBe(equipmentItem.checkHooks);
    expect(npc?.inventory?.[0].statBonuses).not.toBe(inventoryItem.statBonuses);
    expect(npc?.inventory?.[0].checkHooks).not.toBe(inventoryItem.checkHooks);

    equipmentItem.statBonuses.武力 = 99;
    equipmentItem.checkHooks[0].modifier = 99;
    equipmentItem.unlocks[0] = '被篡改';
    inventoryItem.statBonuses.交涉 = 99;
    inventoryItem.checkHooks[0].modifier = 99;
    inventoryItem.risks[0] = '被篡改';

    expect(npc?.equipment?.[0].statBonuses).toEqual({ 武力: 3 });
    expect(npc?.equipment?.[0].checkHooks?.[0].modifier).toBe(3);
    expect(npc?.equipment?.[0].unlocks).toEqual(['拦截']);
    expect(npc?.inventory?.[0].statBonuses).toEqual({ 交涉: 2 });
    expect(npc?.inventory?.[0].checkHooks?.[0].modifier).toBe(2);
    expect(npc?.inventory?.[0].risks).toEqual(['遗失追责']);
  });

  it('defaults missing presentNpcIds to an empty event participant list', () => {
    const state = applyLuanShiCommand(baseState, {
      action: 'recordTurnEvent',
      eventId: 'evt_no_present_npc',
      locationId: 'place_test',
      summary: '主角独自在营门前听见远处号角。',
      visibility: '在场可知',
    } as any);

    expect(state.turnEvents[state.turnEvents.length - 1]).toMatchObject({
      eventId: 'evt_no_present_npc',
      presentNpcIds: [],
      involvedNpcIds: [],
    });
  });

  it('does not append duplicate NPC memories from the same in-game timestamp', () => {
    const command = {
      action: 'pushNpcMemory' as const,
      npcId: 'npc_guard',
      npcName: '陈达',
      source: '亲历' as const,
      value: '见证了子元大哥用两车粮食彻底收服了军心。',
    };

    const once = applyLuanShiCommand(baseState, command);
    const twice = applyLuanShiCommand(once, command);

    expect(twice.npcs.find((npc) => npc.npcId === 'npc_guard')?.memories).toHaveLength(1);
  });

  it('does not append duplicate NPC memories from the same event and source even when wording changes', () => {
    const stateWithEvent = applyLuanShiCommand(baseState, {
      action: 'recordTurnEvent',
      eventId: 'event_supply_raid',
      locationId: 'place_test',
      summary: '陈达在场目睹主角夺回粮车。',
      presentNpcIds: ['npc_guard'],
      involvedNpcIds: ['npc_guard'],
      visibility: '在场可知',
    });
    const first = applyLuanShiCommand(stateWithEvent, {
      action: 'pushNpcMemory',
      npcId: 'npc_guard',
      npcName: '陈达',
      source: '亲历',
      eventId: 'event_supply_raid',
      value: '亲眼见子元夺回两车粮食，军心因此稍稳。',
    });
    const second = applyLuanShiCommand(first, {
      action: 'pushNpcMemory',
      npcId: 'npc_guard',
      npcName: '陈达',
      source: '亲历',
      eventId: 'event_supply_raid',
      value: '见证子元追回粮车，残部重新稳住阵脚。',
    });

    const memories = second.npcs.find((npc) => npc.npcId === 'npc_guard')?.memories ?? [];
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      eventId: 'event_supply_raid',
      content: '亲眼见子元夺回两车粮食，军心因此稍稳。',
    });
  });

  it('writes resource, faction, and troop ledger entries without disturbing NPC data', () => {
    const withResources = applyLuanShiCommand(baseState, {
      action: 'updateResourceLedger',
      previousMoneyGuan: 0,
      moneyDeltaGuan: 120,
      moneyGuan: 120,
      grain: 300,
      horses: 12,
      weapons: ['环首刀x20'],
      documents: ['军令一封'],
      tokens: ['北军符节'],
      importantSupplies: ['箭矢三箱'],
      playerResources: { 粮饷: 36, 军需券: 50 },
    } as any);
    const withFaction = applyLuanShiCommand(withResources, {
      action: 'upsertFactionLedger',
      factionId: 'faction_local_guard',
      name: '市镇守卒',
      type: '地方武装',
      summary: '维持市镇秩序的小股守卒。',
      stanceToPlayer: '观望',
      knownLevel: '亲历',
      recentActions: ['封锁北门'],
    } as any);
    const next = applyLuanShiCommand(withFaction, {
      action: 'upsertTroopLedger',
      troopId: 'troop_guard_1',
      name: '北门守卒',
      size: 80,
      previousSize: 100,
      factionId: 'faction_local_guard',
      troopType: '步卒',
      quality: '中',
      fatigue: '高',
      readiness: '低',
      lifecycleStatus: 'active',
      statusTags: ['断粮'],
      leaderNpcId: 'npc_guard',
      locationId: 'place_test',
      lastKnownLocationId: 'place_test',
      lastKnownAt: '乱世元年2月',
      knownLevel: '亲历',
      certainty: 'confirmed',
      morale: 45,
      training: 35,
      supplies: '口粮不足',
      task: '守住北门',
      relationToPlayer: '谨慎观望',
      strengthTrend: 'decreased',
      lastChangeReason: '北门遭袭',
      updatedAt: '乱世元年2月',
    } as any);

    expect(next.resources).toMatchObject({
      money: 120,
      grain: 300,
      horses: 12,
      weapons: ['环首刀x20'],
      documents: ['军令一封'],
      tokens: ['北军符节'],
      importantSupplies: ['箭矢三箱'],
    });
    expect(next.playerResources).toMatchObject({ 粮饷: 36, 军需券: 50 });
    expect(next.factions).toEqual([
      expect.objectContaining({
        factionId: 'faction_local_guard',
        name: '市镇守卒',
        recentActions: ['【亲历】封锁北门'],
      }),
    ]);
    expect(next.troops).toEqual([
      expect.objectContaining({
        troopId: 'troop_guard_1',
        name: '北门守卒',
        leaderNpcId: 'npc_guard',
        previousSize: 100,
        troopType: '步卒',
        lifecycleStatus: 'active',
        statusTags: ['断粮'],
        knownLevel: '亲历',
      }),
    ]);
    expect(next.npcs.find((npc) => npc.npcId === 'npc_guard')?.name).toBe('陈达');
  });

  it('does not persist generic troop words as troopType', () => {
    const state = applyLuanShiCommand(baseState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_generic_type',
      name: '颍川郡兵（刘平部）',
      size: 400,
      factionId: 'faction_han_court',
      troopType: '部队',
      morale: 75,
      training: 60,
      supplies: '正常',
      task: '日常操练与阳翟城防',
      relationToPlayer: 'direct_command',
    } as any);

    expect(state.troops.find((troop) => troop.troopId === 'troop_generic_type')?.troopType).toBeUndefined();
  });

  it('persists troop upkeep source for monthly settlement routing', () => {
    const state = applyLuanShiCommand(baseState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_superior_provision',
      name: '随军部曲',
      size: 300,
      factionId: 'faction_jingzhou_liubiao',
      troopType: '步卒',
      morale: 55,
      training: 60,
      supplies: 45,
      task: '听从主角整训',
      relationToPlayer: '你直接统领',
      leaderNpcId: 'player',
      upkeepSource: 'superior_provision',
    } as any);

    expect(state.troops.find((troop) => troop.troopId === 'troop_superior_provision')?.upkeepSource)
      .toBe('superior_provision');
  });

  it('fills operational defaults when creating a new troop with missing condition fields', () => {
    const created = applyLuanShiCommand(baseState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_new_minimal',
      name: '新募郡兵',
      size: 300,
      factionId: 'faction_regional_actor',
      troopType: '步卒',
      morale: 50,
      training: 60,
      supplies: 40,
      task: '城防巡守',
      relationToPlayer: 'self',
      leaderNpcId: 'player',
    } as any);

    expect(created.troops[0]).toEqual(expect.objectContaining({
      troopId: 'troop_new_minimal',
      quality: '中',
      readiness: '中',
      fatigue: '低',
      lifecycleStatus: 'active',
      knownLevel: '亲历',
      certainty: 'confirmed',
    }));

    const updated = applyLuanShiCommand(created, {
      action: 'upsertTroopLedger',
      troopId: 'troop_new_minimal',
      size: 280,
      previousSize: 300,
      task: '分出二十人巡哨',
    } as any);

    expect(updated.troops[0]).toEqual(expect.objectContaining({
      quality: '中',
      readiness: '中',
      fatigue: '低',
      lifecycleStatus: 'active',
      knownLevel: '亲历',
      certainty: 'confirmed',
      size: 280,
      previousSize: 300,
    }));
  });

  it('fills missing operational fields when updating an older partial troop entry', () => {
    const stateWithPartialTroop: RuntimeState = {
      ...baseState,
      troops: [
        {
          troopId: 'troop_old_partial',
          name: '旧档郡兵',
          size: 300,
          morale: 50,
          training: 60,
          supplies: 40,
          task: '城防巡守',
          relationToPlayer: '你直接统领',
          leaderNpcId: 'player',
        } as any,
      ],
    };

    const updated = applyLuanShiCommand(stateWithPartialTroop, {
      action: 'upsertTroopLedger',
      troopId: 'troop_old_partial',
      size: 280,
      previousSize: 300,
      task: '分出二十人巡哨',
    } as any);

    expect(updated.troops[0]).toEqual(expect.objectContaining({
      troopId: 'troop_old_partial',
      quality: '中',
      readiness: '中',
      fatigue: '低',
      lifecycleStatus: 'active',
      knownLevel: '亲历',
      certainty: 'confirmed',
      size: 280,
      previousSize: 300,
    }));
  });

  it('normalizes qualitative troop morale, training, and readiness aliases from model writeback', () => {
    const next = applyLuanShiCommand(baseState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_real_api_aliases',
      name: 'Real API aliases',
      size: 50,
      morale: '\u4f4e',
      training: '\u6781\u4f4e',
      supplies: 'two days',
      task: 'hold position',
      relationToPlayer: 'self',
      readiness: '\u5dee',
    } as any);

    expect(next.troops).toEqual([
      expect.objectContaining({
        troopId: 'troop_real_api_aliases',
        morale: 30,
        training: 15,
        readiness: '\u4f4e',
      }),
    ]);
  });

  it('normalizes model-written troop strength trend aliases without dropping the troop update', () => {
    const next = applyLuanShiCommand(baseState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_player_start',
      name: '襄阳左部营曲',
      size: 800,
      previousSize: 500,
      morale: 80,
      training: 75,
      supplies: 10,
      task: '阵列成型，面临断粮危机',
      relationToPlayer: 'self',
      strengthTrend: '大幅增强',
      lastChangeReason: '三个月严格隐秘的屯田训练成军',
    } as any);

    expect(next.troops).toHaveLength(1);
    expect(next.troops[0]).toEqual(expect.objectContaining({
      troopId: 'troop_player_start',
      size: 800,
      previousSize: 500,
      strengthTrend: 'increased',
    }));
  });

  it('keeps troop size stable when the same recruited batch is only being trained or folded in', () => {
    const stateWithCompletedRecruitment: RuntimeState = {
      ...baseState,
      troops: [
        {
          troopId: 'troop_player_start',
          name: '左部营曲',
          size: 1000,
          previousSize: 800,
          morale: 65,
          training: 40,
          supplies: 80,
          task: '两百新兵入营，待以老带新操练',
          relationToPlayer: 'self',
          strengthTrend: 'increased',
          lastChangeReason: '韩烈持手令完成两百青壮的招募并交由陈珩整编',
          statusTags: ['获准扩编', '新兵入营'],
        },
      ],
    };

    const next = applyLuanShiCommand(stateWithCompletedRecruitment, {
      action: 'upsertTroopLedger',
      troopId: 'troop_player_start',
      name: '左部营曲',
      size: 1200,
      previousSize: 1000,
      morale: 68,
      training: 45,
      supplies: 78,
      task: '两百新卒打散编入各屯，以老带新操练',
      relationToPlayer: 'self',
      strengthTrend: 'increased',
      lastChangeReason: '招募并编入两百名新卒，开始以老带新操练。',
    } as any);

    expect(next.troops[0]).toEqual(expect.objectContaining({
      troopId: 'troop_player_start',
      size: 1000,
      previousSize: 800,
      morale: 68,
      training: 45,
      supplies: 78,
      task: '两百新卒打散编入各屯，以老带新操练',
      strengthTrend: 'stable',
    }));
  });

  it('still allows troop size growth when a distinct fresh personnel source is written', () => {
    const stateWithCompletedRecruitment: RuntimeState = {
      ...baseState,
      troops: [
        {
          troopId: 'troop_player_start',
          name: '左部营曲',
          size: 1000,
          previousSize: 800,
          morale: 65,
          training: 40,
          supplies: 80,
          task: '两百新兵入营，待以老带新操练',
          relationToPlayer: 'self',
          strengthTrend: 'increased',
          lastChangeReason: '韩烈持手令完成两百青壮的招募并交由陈珩整编',
          statusTags: ['获准扩编', '新兵入营'],
        },
      ],
    };

    const next = applyLuanShiCommand(stateWithCompletedRecruitment, {
      action: 'upsertTroopLedger',
      troopId: 'troop_player_start',
      name: '左部营曲',
      size: 1200,
      previousSize: 1000,
      morale: 70,
      training: 45,
      supplies: 76,
      task: '另募两百郡卒入营，分屯训练',
      relationToPlayer: 'self',
      strengthTrend: 'increased',
      lastChangeReason: '刘表再次准许另募两百郡卒，韩烈已将新一批青壮带入大营。',
    } as any);

    expect(next.troops[0]).toEqual(expect.objectContaining({
      troopId: 'troop_player_start',
      size: 1200,
      previousSize: 1000,
      morale: 70,
      training: 45,
      supplies: 76,
      task: '另募两百郡卒入营，分屯训练',
    }));
  });

  it('normalizes numeric troop condition aliases without dropping the troop update', () => {
    const next = applyLuanShiCommand(baseState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_numeric_conditions',
      name: '数值状态别名部队',
      size: 120,
      morale: 50,
      training: 60,
      supplies: 40,
      task: '驻守城门',
      relationToPlayer: 'self',
      quality: 85,
      readiness: 30,
      fatigue: 15,
    } as any);

    expect(next.troops[0]).toEqual(expect.objectContaining({
      troopId: 'troop_numeric_conditions',
      quality: '精锐',
      readiness: '低',
      fatigue: '低',
      warFatiguePercent: 15,
      size: 120,
    }));
  });

  it('synchronizes ordinary-turn fatigue recovery with the exact War V2 value', () => {
    const stateWithStaleWarFatigue = {
      ...baseState,
      troops: [{
        troopId: 'troop_resting',
        name: '休整营曲',
        size: 120,
        morale: 50,
        training: 55,
        supplies: 70,
        task: '营中休整',
        relationToPlayer: 'self',
        quality: '中',
        readiness: '中',
        fatigue: '极高',
        warFatiguePercent: 85,
        lifecycleStatus: 'active',
        knownLevel: '亲历',
        certainty: 'confirmed',
      }],
    } as unknown as RuntimeState;

    const next = applyLuanShiCommand(stateWithStaleWarFatigue, {
      action: 'upsertTroopLedger',
      troopId: 'troop_resting',
      fatigue: '中',
      updatedAt: '公元189年09月02日 12:00（午时）',
    } as any);

    expect(next.troops?.[0]).toMatchObject({
      fatigue: '中',
      warFatiguePercent: 35,
    });
  });

  it('merges partial updates into an existing troop without creating a duplicate', () => {
    const created = applyLuanShiCommand(baseState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_guard_1',
      name: '北门守卒',
      size: 80,
      morale: 45,
      training: 35,
      supplies: '口粮不足',
      task: '守住北门',
      relationToPlayer: '谨慎观望',
      readiness: '中',
    } as any);

    const updated = applyLuanShiCommand(created, {
      action: 'upsertTroopLedger',
      troopId: 'troop_guard_1',
      size: 70,
      previousSize: 80,
      lastChangeReason: '分出十人斥候',
    } as any);

    expect(updated.troops).toHaveLength(1);
    expect(updated.troops[0]).toEqual(expect.objectContaining({
      troopId: 'troop_guard_1',
      name: '北门守卒',
      size: 70,
      previousSize: 80,
      morale: 45,
      training: 35,
      supplies: '口粮不足',
      task: '守住北门',
      relationToPlayer: '谨慎观望',
      readiness: '中',
      lastChangeReason: '分出十人斥候',
    }));
  });

  it('records remote orders and marching status without moving the troop until arrival is confirmed', () => {
    const created = applyLuanShiCommand(baseState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_ordered',
      name: 'Ordered Camp',
      size: 160,
      factionId: 'faction_player_band',
      locationId: 'place_camp_b',
      lastKnownLocationId: 'place_camp_b',
      lastKnownAt: '189-09-01 08:00',
      morale: 55,
      training: 50,
      supplies: 'three days',
      task: 'hold camp B',
      relationToPlayer: 'self-related',
    } as any);

    const ordered = applyLuanShiCommand(created, {
      action: 'upsertTroopLedger',
      troopId: 'troop_ordered',
      orderStatus: 'issued',
      orderIssuedAt: '189-09-01 09:00',
      orderSummary: 'March from camp B to camp C after the courier arrives.',
      destinationLocationId: 'place_camp_c',
      routeId: 'route_b_to_c',
      movementStatus: 'waitingOrder',
      estimatedArrivalAt: '189-09-01 18:00',
      movementNotes: 'Courier is still on the road; troop has not moved yet.',
      updatedAt: '189-09-01 09:00',
    } as any);

    expect(ordered.troops[0]).toEqual(expect.objectContaining({
      troopId: 'troop_ordered',
      locationId: 'place_camp_b',
      lastKnownLocationId: 'place_camp_b',
      orderStatus: 'issued',
      orderIssuedAt: '189-09-01 09:00',
      destinationLocationId: 'place_camp_c',
      movementStatus: 'waitingOrder',
      estimatedArrivalAt: '189-09-01 18:00',
    }));

    const arrived = applyLuanShiCommand(ordered, {
      action: 'upsertTroopLedger',
      troopId: 'troop_ordered',
      locationId: 'place_camp_c',
      lastKnownLocationId: 'place_camp_c',
      lastKnownAt: '189-09-01 18:20',
      orderStatus: 'delivered',
      orderDeliveredAt: '189-09-01 12:00',
      movementStatus: 'arrived',
      arrivedAt: '189-09-01 18:20',
      task: 'hold camp C',
      updatedAt: '189-09-01 18:20',
    } as any);

    expect(arrived.troops).toHaveLength(1);
    expect(arrived.troops[0]).toEqual(expect.objectContaining({
      troopId: 'troop_ordered',
      locationId: 'place_camp_c',
      lastKnownLocationId: 'place_camp_c',
      orderStatus: 'delivered',
      orderDeliveredAt: '189-09-01 12:00',
      movementStatus: 'arrived',
      arrivedAt: '189-09-01 18:20',
      task: 'hold camp C',
    }));
  });

  it('updates the same troop and records one battle archive without treating the battle as troop mutation', () => {
    const firstTroop = applyLuanShiCommand(baseState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_yueqi',
      name: '越骑营残部',
      size: 300,
      factionId: 'faction_player_band',
      troopType: '骑兵',
      quality: '高',
      fatigue: '中',
      readiness: '中',
      lifecycleStatus: 'active',
      leaderNpcId: 'npc_guard',
      locationId: 'place_test',
      morale: 60,
      training: 55,
      supplies: '粮草三日',
      task: '护送主角突围',
      relationToPlayer: '自势力相关',
      updatedAt: '公元189年09月01日 08:30（辰时）',
    } as any);

    const afterBattleRecord = applyLuanShiCommand(firstTroop, {
      action: 'upsertConflictRecord',
      conflictId: 'battle_luoyang_breakout',
      type: '伏击',
      title: '洛阳宫门伏击',
      summary: '越骑营残部在宫门外遭遇西凉兵伏击。',
      occurredAt: '公元189年09月01日 08:45（辰时）',
      outcome: '突围成功但减员严重。',
      scope: 'selfRelated',
      recordLevel: 'full',
      involvedTroopIds: ['troop_yueqi'],
      reportText: '宫门前火光乱晃，越骑营冲开伏兵，折损之后仍护着主角退入侧街。',
      troopEffects: ['troop_yueqi 减员约八十人'],
      updatedAt: '公元189年09月01日 08:45（辰时）',
    } as any);

    expect(afterBattleRecord.troops.find((troop) => troop.troopId === 'troop_yueqi')?.size).toBe(300);
    expect(afterBattleRecord.conflicts).toEqual([
      expect.objectContaining({
        conflictId: 'battle_luoyang_breakout',
        type: '伏击',
        recordLevel: 'full',
        reportText: expect.stringContaining('宫门前火光'),
      }),
    ]);

    const updatedTroop = applyLuanShiCommand(afterBattleRecord, {
      action: 'upsertTroopLedger',
      troopId: 'troop_yueqi',
      name: '越骑营残部',
      size: 220,
      previousSize: 300,
      factionId: 'faction_player_band',
      troopType: '骑兵',
      quality: '高',
      fatigue: '高',
      readiness: '低',
      lifecycleStatus: 'active',
      leaderNpcId: 'npc_guard',
      locationId: 'place_test',
      morale: 52,
      training: 55,
      supplies: '粮草两日',
      task: '整顿伤卒',
      relationToPlayer: '自势力相关',
      lastBattleId: 'battle_luoyang_breakout',
      strengthTrend: 'decreased',
      lastChangeReason: '伏击后减员约八十人',
      updatedAt: '公元189年09月01日 09:00（巳时）',
    } as any);

    expect(updatedTroop.troops).toHaveLength(1);
    expect(updatedTroop.troops[0]).toEqual(expect.objectContaining({
      troopId: 'troop_yueqi',
      size: 220,
      previousSize: 300,
      fatigue: '高',
      lastBattleId: 'battle_luoyang_breakout',
      lastChangeReason: '伏击后减员约八十人',
    }));

    const updatedBattle = applyLuanShiCommand(updatedTroop, {
      action: 'upsertConflictRecord',
      conflictId: 'battle_luoyang_breakout',
      type: '伏击',
      title: '洛阳宫门伏击',
      summary: '越骑营残部突围成功，后续确认减员八十人。',
      occurredAt: '公元189年09月01日 08:45（辰时）',
      outcome: '突围成功，部队减员。',
      scope: 'selfRelated',
      recordLevel: 'full',
      involvedTroopIds: ['troop_yueqi'],
      resultLevel: 'minorWin',
      judgement: {
        method: 'warJudgementV1',
        perspectiveSide: 'player',
        baselineAdvantage: 'clearDisadvantage',
        scoreBreakdown: {
          troopBase: -18,
          commander: 12,
          tactical: 8,
          turningPoint: 14,
          playerAction: 10,
          total: 26,
          notes: ['以少胜多来自伏击反打与主角调度，不是兵力压制。'],
        },
        commanderAssessment: '主角统率压住溃势。',
        tacticalAssessment: '宫门巷道削弱敌军数量优势。',
        underdogReason: '兵少但地形、士气和指挥形成局部突破。',
      },
      turningPoints: [
        {
          type: 'playerAction',
          side: 'player',
          summary: '主角亲自压阵，止住越骑营残部溃散。',
          impact: 'major',
          relatedTroopIds: ['troop_yueqi'],
          scoreModifier: 10,
        },
      ],
      resultTags: ['breakout', 'troopLoss'],
      reportText: '宫门前火光乱晃，越骑营冲开伏兵，折损之后仍护着主角退入侧街。',
      troopEffects: ['troop_yueqi size 300 -> 220'],
      updatedAt: '公元189年09月01日 09:00（巳时）',
    } as any);

    expect(updatedBattle.conflicts).toHaveLength(1);
    expect(updatedBattle.conflicts[0]).toEqual(expect.objectContaining({
      conflictId: 'battle_luoyang_breakout',
      summary: '越骑营残部突围成功，后续确认减员八十人。',
      resultLevel: 'minorWin',
      troopEffects: ['troop_yueqi size 300 -> 220'],
    }));
    expect(updatedBattle.conflicts[0].judgement).toEqual(expect.objectContaining({
      method: 'warJudgementV1',
      baselineAdvantage: 'clearDisadvantage',
      underdogReason: '兵少但地形、士气和指挥形成局部突破。',
    }));
    expect(updatedBattle.conflicts[0].judgement?.scoreBreakdown).toEqual(expect.objectContaining({
      commander: 12,
      total: 26,
    }));
    expect(updatedBattle.conflicts[0].turningPoints).toEqual([
      expect.objectContaining({
        type: 'playerAction',
        impact: 'major',
        relatedTroopIds: ['troop_yueqi'],
      }),
    ]);
    expect(updatedBattle.conflicts[0].resultTags).toEqual(['breakout', 'troopLoss']);
  });

  it('updates troop allegiance on the same stable troopId instead of creating a duplicate unit', () => {
    const first = applyLuanShiCommand(baseState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_false_surrender',
      name: 'False Surrender Camp',
      size: 180,
      factionId: 'faction_dongzhuo',
      troopType: 'mixed infantry',
      quality: '中',
      fatigue: '低',
      readiness: '中',
      lifecycleStatus: 'active',
      statusTags: ['false-surrender'],
      morale: 50,
      training: 45,
      supplies: 'three days',
      task: 'pretend to serve Dong Zhuo',
      relationToPlayer: 'hidden player force',
      updatedAt: '189-09-02 08:00',
    } as any);

    const changed = applyLuanShiCommand(first, {
      action: 'upsertTroopLedger',
      troopId: 'troop_false_surrender',
      name: 'False Surrender Camp',
      size: 180,
      previousSize: 180,
      factionId: 'faction_player_band',
      previousFactionId: 'faction_dongzhuo',
      allegianceChangedAt: '189-09-02 12:00',
      allegianceChangeReason: 'false surrender exposed and the camp rose in revolt',
      troopType: 'mixed infantry',
      quality: '中',
      fatigue: '中',
      readiness: '高',
      lifecycleStatus: 'active',
      statusTags: ['uprising', 'changed-allegiance'],
      morale: 68,
      training: 45,
      supplies: 'three days',
      task: 'hold the inner gate for the player',
      relationToPlayer: 'self-related',
      strengthTrend: 'stable',
      updatedAt: '189-09-02 12:00',
    } as any);

    expect(changed.troops).toHaveLength(1);
    expect(changed.troops[0]).toEqual(expect.objectContaining({
      troopId: 'troop_false_surrender',
      factionId: 'faction_player_band',
      previousFactionId: 'faction_dongzhuo',
      allegianceChangedAt: '189-09-02 12:00',
      allegianceChangeReason: 'false surrender exposed and the camp rose in revolt',
      statusTags: ['uprising', 'changed-allegiance'],
    }));
  });

  it('keeps split, merged, surrendered, and destroyed troop states on stable troop ids', () => {
    const parentCreated = applyLuanShiCommand(baseState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_parent',
      name: 'Parent Camp',
      size: 320,
      factionId: 'faction_player_band',
      morale: 58,
      training: 44,
      supplies: 'three days',
      task: 'hold the ford',
      relationToPlayer: 'self-related',
      lifecycleStatus: 'active',
      updatedAt: '189-09-02 08:00',
    } as any);

    const parentSplit = applyLuanShiCommand(parentCreated, {
      action: 'upsertTroopLedger',
      troopId: 'troop_parent',
      name: 'Parent Camp',
      size: 220,
      previousSize: 320,
      factionId: 'faction_player_band',
      morale: 54,
      training: 44,
      supplies: 'two days',
      task: 'hold the ford after detaching scouts',
      relationToPlayer: 'self-related',
      lifecycleStatus: 'split',
      childTroopIds: ['troop_detached_scouts'],
      strengthTrend: 'decreased',
      lastChangeReason: 'detached a scout troop',
      updatedAt: '189-09-02 10:00',
    } as any);

    const childCreated = applyLuanShiCommand(parentSplit, {
      action: 'upsertTroopLedger',
      troopId: 'troop_detached_scouts',
      name: 'Detached Scouts',
      size: 100,
      factionId: 'faction_player_band',
      morale: 56,
      training: 48,
      supplies: 'two days',
      task: 'screen the ford',
      relationToPlayer: 'self-related',
      lifecycleStatus: 'active',
      parentTroopId: 'troop_parent',
      updatedAt: '189-09-02 10:00',
    } as any);

    const childSurrendered = applyLuanShiCommand(childCreated, {
      action: 'upsertTroopLedger',
      troopId: 'troop_detached_scouts',
      name: 'Detached Scouts',
      size: 80,
      previousSize: 100,
      factionId: 'faction_player_band',
      morale: 42,
      training: 48,
      supplies: 'one day',
      task: 'absorbed after surrender',
      relationToPlayer: 'self-related',
      lifecycleStatus: 'surrendered',
      parentTroopId: 'troop_parent',
      mergedIntoTroopId: 'troop_parent',
      strengthTrend: 'decreased',
      lastChangeReason: 'surrendered and was absorbed into the parent camp',
      updatedAt: '189-09-02 12:00',
    } as any);

    const parentDestroyed = applyLuanShiCommand(childSurrendered, {
      action: 'upsertTroopLedger',
      troopId: 'troop_parent',
      name: 'Parent Camp',
      size: 0,
      previousSize: 220,
      factionId: 'faction_player_band',
      morale: 0,
      training: 44,
      supplies: 'lost',
      task: 'destroyed in battle',
      relationToPlayer: 'self-related',
      lifecycleStatus: 'destroyed',
      childTroopIds: ['troop_detached_scouts'],
      destroyedInBattleId: 'battle_ford_collapse',
      lastBattleId: 'battle_ford_collapse',
      strengthTrend: 'decreased',
      lastChangeReason: 'destroyed while covering the retreat',
      updatedAt: '189-09-02 14:00',
    } as any);

    const troopIds = parentDestroyed.troops.map((troop) => troop.troopId);
    expect(new Set(troopIds).size).toBe(troopIds.length);
    expect(parentDestroyed.troops).toHaveLength(2);
    expect(parentDestroyed.troops.find((troop) => troop.troopId === 'troop_parent')).toEqual(expect.objectContaining({
      size: 0,
      previousSize: 220,
      lifecycleStatus: 'destroyed',
      childTroopIds: ['troop_detached_scouts'],
      destroyedInBattleId: 'battle_ford_collapse',
      lastBattleId: 'battle_ford_collapse',
    }));
    expect(parentDestroyed.troops.find((troop) => troop.troopId === 'troop_detached_scouts')).toEqual(expect.objectContaining({
      size: 80,
      previousSize: 100,
      lifecycleStatus: 'surrendered',
      parentTroopId: 'troop_parent',
      mergedIntoTroopId: 'troop_parent',
    }));
  });

  it('retires terminal troop ids from current faction and garrison references without deleting history', () => {
    const referencedState = {
      ...baseState,
      factions: [
        {
          factionId: 'faction_player_band',
          name: 'Player force',
          type: '军府',
          summary: 'The player force undergoing a full regroup.',
          stanceToPlayer: '自势力',
          knownLevel: '亲历',
          recentActions: ['Reorganized the army.'],
          relatedTroopIds: [
            'troop_old_camp',
            'troop_new_camp',
            'troop_old_reserve',
            'troop_keep',
            'troop_old_camp',
          ],
        },
      ],
      holdings: [
        {
          holdingId: 'holding_player_camp',
          name: 'Player camp',
          type: 'camp',
          status: 'controlled',
          summary: 'The regrouping base.',
          scaleLevel: 1,
          agriculture: 0,
          commerce: 0,
          population: 10,
          publicOrder: 80,
          popularSupport: 70,
          defense: 60,
          recruitPotential: 30,
          armory: 50,
          horseSupply: 40,
          corruption: 0,
          garrisonTroopIds: ['troop_old_camp', 'troop_new_camp', 'troop_old_reserve', 'troop_keep'],
          updatedAt: '189-09-02 08:00',
        },
      ],
      troops: [
        {
          troopId: 'troop_old_camp',
          name: 'Old camp',
          size: 680,
          factionId: 'faction_player_band',
          lifecycleStatus: 'active',
          morale: 60,
          training: 55,
          supplies: 'five days',
          task: 'await regroup',
          relationToPlayer: 'self',
        },
        {
          troopId: 'troop_old_reserve',
          name: 'Old reserve',
          size: 380,
          factionId: 'faction_player_band',
          lifecycleStatus: 'active',
          morale: 50,
          training: 40,
          supplies: 'three days',
          task: 'await regroup',
          relationToPlayer: 'self',
        },
        {
          troopId: 'troop_new_camp',
          name: 'New main camp',
          size: 1560,
          factionId: 'faction_player_band',
          lifecycleStatus: 'active',
          morale: 65,
          training: 60,
          supplies: 'five days',
          task: 'train after regroup',
          relationToPlayer: 'self',
        },
        {
          troopId: 'troop_keep',
          name: 'Preserved naval camp',
          size: 800,
          factionId: 'faction_player_band',
          lifecycleStatus: 'active',
          morale: 70,
          training: 70,
          supplies: 'seven days',
          task: 'guard the river',
          relationToPlayer: 'self',
        },
      ],
      conflicts: [
        {
          conflictId: 'battle_old_camp',
          type: '野战',
          title: 'Old camp battle',
          summary: 'The old camp fought before the regroup.',
          occurredAt: '189-09-01 08:00',
          outcome: 'Victory',
          scope: 'selfRelated',
          recordLevel: 'full',
          involvedTroopIds: ['troop_old_camp'],
        },
      ],
    } as RuntimeState;

    const afterMerge = applyLuanShiCommand(referencedState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_old_camp',
      name: 'Old camp',
      size: 680,
      factionId: 'faction_player_band',
      lifecycleStatus: 'merged',
      mergedIntoTroopId: 'troop_new_camp',
      morale: 60,
      training: 55,
      supplies: 'transferred',
      task: 'historical formation after regroup',
      relationToPlayer: 'self',
      lastChangeReason: 'Merged into the new main camp.',
      updatedAt: '189-09-02 10:00',
    } as any);
    const afterDisband = applyLuanShiCommand(afterMerge, {
      action: 'upsertTroopLedger',
      troopId: 'troop_old_reserve',
      name: 'Old reserve',
      size: 380,
      factionId: 'faction_player_band',
      lifecycleStatus: 'disbanded',
      morale: 50,
      training: 40,
      supplies: 'transferred',
      task: 'historical formation after regroup',
      relationToPlayer: 'self',
      lastChangeReason: 'Disbanded during the regroup.',
      updatedAt: '189-09-02 10:00',
    } as any);

    expect(afterDisband.troops).toHaveLength(4);
    expect(afterDisband.troops.find((troop) => troop.troopId === 'troop_old_camp')).toMatchObject({
      lifecycleStatus: 'merged',
      mergedIntoTroopId: 'troop_new_camp',
    });
    expect(afterDisband.troops.find((troop) => troop.troopId === 'troop_old_reserve')).toMatchObject({
      lifecycleStatus: 'disbanded',
    });
    expect(afterDisband.factions[0].relatedTroopIds).toEqual(['troop_new_camp', 'troop_keep']);
    expect(afterDisband.holdings[0].garrisonTroopIds).toEqual(['troop_new_camp', 'troop_keep']);
    expect(afterDisband.conflicts[0].involvedTroopIds).toEqual(['troop_old_camp']);
  });

  it('archives a routed formation and removes it from current faction and garrison references', () => {
    const routedTroop = {
      troopId: 'troop_defeated_camp',
      name: '败退旧营',
      size: 260,
      factionId: 'faction_player_band',
      lifecycleStatus: 'active' as const,
      morale: 20,
      training: 45,
      supplies: 25,
      task: '战场整队',
      relationToPlayer: '你直接统领',
    };
    const state = {
      ...baseState,
      troops: [routedTroop],
      factions: [{
        factionId: 'faction_player_band',
        name: '主角军府',
        type: '军府',
        summary: '主角所属势力。',
        stanceToPlayer: 'self',
        knownLevel: '亲历',
        recentActions: [],
        relatedTroopIds: ['troop_defeated_camp'],
      }],
      holdings: [{
        holdingId: 'holding_main_camp',
        name: '中军营',
        type: 'camp',
        status: 'controlled',
        summary: '主角中军营。',
        scaleLevel: 1,
        agriculture: 0,
        commerce: 0,
        population: 10,
        publicOrder: 80,
        popularSupport: 70,
        defense: 60,
        recruitPotential: 20,
        armory: 50,
        horseSupply: 30,
        corruption: 0,
        garrisonTroopIds: ['troop_defeated_camp'],
        updatedAt: '189-09-02 08:00',
      }],
    } as RuntimeState;

    const archived = applyLuanShiCommand(state, {
      action: 'upsertTroopLedger',
      troopId: 'troop_defeated_camp',
      lifecycleStatus: 'routed',
      lastBattleId: 'battle_defeat',
      lastChangeReason: 'War V2 战败溃散',
    } as any);

    expect(archived.troops).toHaveLength(1);
    expect(archived.troops[0]).toMatchObject({
      troopId: 'troop_defeated_camp',
      lifecycleStatus: 'routed',
      lastBattleId: 'battle_defeat',
    });
    expect(archived.factions[0].relatedTroopIds).toEqual([]);
    expect(archived.holdings[0].garrisonTroopIds).toEqual([]);
  });

  it('maintains merge and split lineage from either side of stable troop-id relations', () => {
    const withSuccessor = applyLuanShiCommand(baseState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_reformed',
      name: 'Reformed camp',
      size: 600,
      morale: 70,
      training: 65,
      supplies: 'five days',
      task: 'hold camp',
      relationToPlayer: 'self',
      quality: '中',
      readiness: '中',
      fatigue: '低',
      lifecycleStatus: 'active',
      knownLevel: '亲历',
      certainty: 'confirmed',
    });
    const afterMerge = applyLuanShiCommand(withSuccessor, {
      action: 'upsertTroopLedger',
      troopId: 'troop_old_left',
      name: 'Old left camp',
      size: 300,
      morale: 60,
      training: 55,
      supplies: 'transferred',
      task: 'historical formation',
      relationToPlayer: 'self',
      quality: '中',
      readiness: '中',
      fatigue: '低',
      lifecycleStatus: 'merged',
      knownLevel: '亲历',
      certainty: 'confirmed',
      mergedIntoTroopId: 'troop_reformed',
    });
    const afterChild = applyLuanShiCommand(afterMerge, {
      action: 'upsertTroopLedger',
      troopId: 'troop_scout_child',
      name: 'Scout child',
      size: 80,
      morale: 65,
      training: 70,
      supplies: 'three days',
      task: 'scout',
      relationToPlayer: 'self',
      quality: '中',
      readiness: '高',
      fatigue: '低',
      lifecycleStatus: 'active',
      knownLevel: '亲历',
      certainty: 'confirmed',
      parentTroopId: 'troop_reformed',
    });

    expect(afterChild.troops.find((troop) => troop.troopId === 'troop_reformed')).toMatchObject({
      mergedFromTroopIds: ['troop_old_left'],
      childTroopIds: ['troop_scout_child'],
    });
  });

  it('preserves faction identity fields and updates the same stable factionId instead of duplicating aliases', () => {
    const first = applyLuanShiCommand(baseState, {
      action: 'upsertFactionLedger',
      factionId: 'faction_zhang_miao_chenliu',
      name: '张邈势力',
      type: '地方官僚军事集团',
      summary: '张邈以陈留太守身份掌握郡府、郡兵与地方募兵网络。',
      stanceToPlayer: '若主角有军力和名望，可能试探招揽。',
      knownLevel: '听闻',
      recentActions: ['在陈留招募兵马'],
      aliases: ['陈留郡府', '张邈部'],
      nominalAllegiance: '汉廷',
      legalIdentity: '陈留太守',
      actualController: '张邈',
      knownSphere: '陈留郡府、郡兵、地方豪族与募兵网络',
      corePersonNpcIds: ['npc_guard'],
      knownMemberNpcIds: ['npc_guard'],
      relatedTroopIds: ['troop_chenliu_recruits'],
      sourceNote: '商旅传闻',
      lastKnownAt: '公元189年09月01日 12:00（午时）',
      updatedAt: '公元189年09月01日 12:00（午时）',
    } as any);

    const second = applyLuanShiCommand(first, {
      action: 'upsertFactionLedger',
      factionId: 'faction_zhang_miao_chenliu',
      name: '张邈势力',
      type: '地方官僚军事集团',
      summary: '张邈名义仍属汉廷，实际以陈留为根基扩充兵力。',
      stanceToPlayer: '对有兵力的主角保持试探和拉拢。',
      knownLevel: '亲历',
      recentActions: ['派人探问主角营中兵马'],
      aliases: ['陈留郡府', '张邈部'],
      nominalAllegiance: '汉廷',
      legalIdentity: '陈留太守',
      actualController: '张邈',
      knownSphere: '陈留郡府、郡兵、募兵网络',
      corePersonNpcIds: ['npc_guard'],
      relatedTroopIds: ['troop_chenliu_recruits'],
      sourceNote: '使者当面试探',
      lastKnownAt: '公元189年09月01日 12:00（午时）',
      updatedAt: '公元189年09月01日 12:00（午时）',
    } as any);

    expect(second.factions).toHaveLength(1);
    expect(second.factions[0]).toMatchObject({
      factionId: 'faction_zhang_miao_chenliu',
      name: '张邈势力',
      nominalAllegiance: '汉廷',
      legalIdentity: '陈留太守',
      actualController: '张邈',
      knownSphere: '陈留郡府、郡兵、募兵网络',
      sourceNote: '使者当面试探',
    });
    expect(second.factions[0].recentActions).toEqual([
      '【听闻】在陈留招募兵马',
      '【亲历】派人探问主角营中兵马',
    ]);
    expect(second.factions[0].aliases).toEqual(['陈留郡府', '张邈部']);
    expect(second.factions[0].relatedTroopIds).toEqual(['troop_chenliu_recruits']);
  });

  it('records firsthand and rumored faction actions without replacing the faction profile', () => {
    const stateWithFaction = applyLuanShiCommand(baseState, {
      action: 'upsertFactionLedger',
      factionId: 'faction_player_command',
      name: '主角军府',
      type: '军府',
      summary: '主角任职并参与军务的现有势力。',
      stanceToPlayer: '自势力相关',
      knownLevel: '亲历',
      recentActions: ['完成营寨整编'],
    });

    const afterPlayerAction = applyLuanShiCommand(stateWithFaction, {
      action: 'recordFactionRecentAction',
      factionId: 'faction_player_command',
      summary: '主角代表军府向郡守交付军粮',
      knownLevel: '亲历',
      sourceNote: '主角当面交割',
    });
    const afterRumor = applyLuanShiCommand(afterPlayerAction, {
      action: 'recordFactionRecentAction',
      factionId: 'faction_player_command',
      summary: '军府另遣偏师驰援北门',
      knownLevel: '听闻',
      observedAt: '公元189年09月02日 08:00（辰时）',
      sourceNote: '斥候军报',
    });
    const afterDuplicate = applyLuanShiCommand(afterRumor, {
      action: 'recordFactionRecentAction',
      factionId: 'faction_player_command',
      summary: '军府另遣偏师驰援北门',
      knownLevel: '听闻',
    });

    expect(afterDuplicate.factions[0]).toMatchObject({
      factionId: 'faction_player_command',
      name: '主角军府',
      summary: '主角任职并参与军务的现有势力。',
      knownLevel: '亲历',
      sourceNote: '斥候军报',
      lastKnownAt: '公元189年09月02日 08:00（辰时）',
      updatedAt: baseState.currentDate,
      recentActions: [
        '【亲历】完成营寨整编',
        '【亲历】主角代表军府向郡守交付军粮',
        '【听闻】军府另遣偏师驰援北门',
      ],
    });
    expect(afterDuplicate.factions[0].recentActionRecords).toEqual([
      {
        summary: '完成营寨整编',
        knownLevel: '亲历',
        observedAt: baseState.currentDate,
      },
      {
        summary: '主角代表军府向郡守交付军粮',
        knownLevel: '亲历',
        observedAt: baseState.currentDate,
        sourceNote: '主角当面交割',
      },
      {
        summary: '军府另遣偏师驰援北门',
        knownLevel: '听闻',
        observedAt: '公元189年09月02日 08:00（辰时）',
        sourceNote: '斥候军报',
      },
    ]);
  });

  it('keeps up to two hundred recent unique faction actions for the full-history view', () => {
    let state = applyLuanShiCommand(baseState, {
      action: 'upsertFactionLedger',
      factionId: 'faction_recent_action_window',
      name: '州郡军府',
      type: '军府',
      summary: '测试近期动作窗口的现有势力。',
      stanceToPlayer: '中立',
      knownLevel: '听闻',
      recentActions: ['旧动作'],
    });

    for (let index = 1; index <= 201; index += 1) {
      state = applyLuanShiCommand(state, {
        action: 'recordFactionRecentAction',
        factionId: 'faction_recent_action_window',
        summary: `动作${index}`,
        knownLevel: '听闻',
      });
    }

    expect(state.factions[0].recentActions).toHaveLength(200);
    expect(state.factions[0].recentActionRecords).toHaveLength(200);
    expect(state.factions[0].recentActions[0]).toBe('【听闻】动作2');
    expect(state.factions[0].recentActions[state.factions[0].recentActions.length - 1])
      .toBe('【听闻】动作201');
  });

  it('upserts personal combat records separately from war conflict records', () => {
    const first = applyLuanShiCommand(baseState, {
      action: 'upsertCombatRecord',
      combatId: 'combat_gate_duel',
      kind: 'battlefieldDuel',
      title: 'Gate Duel',
      summary: 'The player defeated an enemy challenger before the gate.',
      occurredAt: '189-09-01 12:00',
      locationId: 'place_test',
      locationName: 'North Gate',
      participants: [
        { name: 'Player', side: 'player', participantId: 'player' },
        { name: 'Enemy Champion', side: 'enemy', npcId: 'npc_enemy_champion', reputationFame: 65 },
      ],
      playerInvolved: true,
      resultLevel: 'decisiveWin',
      outcomeTags: ['kill', 'forceRetreat'],
      outcome: 'The challenger died and nearby enemies hesitated.',
      significance: 'major',
      chronicleWorthy: true,
      relatedNpcIds: ['npc_enemy_champion'],
      judgement: {
        method: 'combatJudgementV1',
        perspectiveSide: 'player',
        scoreBreakdown: {
          personalBase: 28,
          equipment: 6,
          status: 2,
          environment: 4,
          combatMethod: 12,
          playerAction: 10,
          turningPoint: 18,
          total: 80,
          notes: ['The duel broke the enemy morale.'],
        },
        advantageBand: 'clearAdvantage',
        decisiveMoment: 'The player struck as the enemy overextended.',
      },
      briefText: 'A short but decisive duel at the gate changed the nearby fight.',
      reportText: '【旁白】North Gate dust rose under the hooves. The player shifted aside from the first spear thrust, let the enemy champion overextend, then cut back through the exposed guard. The nearby soldiers saw the challenger fall and the enemy line hesitated.',
      updatedAt: '189-09-01 12:00',
    } as any);

    const second = applyLuanShiCommand(first, {
      action: 'upsertCombatRecord',
      combatId: 'combat_gate_duel',
      kind: 'battlefieldDuel',
      title: 'Gate Duel',
      summary: 'The player defeated the enemy challenger and forced the enemy line to pause.',
      occurredAt: '189-09-01 12:00',
      participants: [
        { name: 'Player', side: 'player', participantId: 'player' },
        { name: 'Enemy Champion', side: 'enemy', npcId: 'npc_enemy_champion', reputationFame: 65 },
      ],
      playerInvolved: true,
      resultLevel: 'decisiveWin',
      outcome: 'The challenger died and the line wavered.',
      significance: 'major',
      chronicleWorthy: true,
      updatedAt: '189-09-01 12:05',
    } as any);

    expect(second.combatRecords).toHaveLength(1);
    expect(second.conflicts).toHaveLength(0);
    expect(second.combatRecords[0]).toEqual(expect.objectContaining({
      combatId: 'combat_gate_duel',
      summary: 'The player defeated the enemy challenger and forced the enemy line to pause.',
      resultLevel: 'decisiveWin',
      chronicleWorthy: true,
      reportText: 'North Gate dust rose under the hooves. The player shifted aside from the first spear thrust, let the enemy champion overextend, then cut back through the exposed guard. The nearby soldiers saw the challenger fall and the enemy line hesitated.',
    }));
    expect(second.combatRecords[0].reportText).not.toContain('【旁白】');
  });

  it('updates player and NPC reputation through stable character ids', () => {
    const playerUpdated = applyLuanShiCommand(baseState, {
      action: 'updateCharacterReputation',
      characterId: 'player',
      characterType: 'player',
      fameDelta: 4,
      moralityDelta: -1,
      tags: [{ label: 'gate-duelist', source: 'combat_gate_duel' }],
      summary: 'Known for winning a dangerous duel before the gate.',
      updatedAt: '189-09-01 12:00',
    } as any);

    expect(playerUpdated.player.reputation).toEqual(expect.objectContaining({
      fame: 4,
      morality: -1,
      summary: 'Known for winning a dangerous duel before the gate.',
    }));
    expect(playerUpdated.player.reputation?.tags).toEqual([{ label: 'gate-duelist', source: 'combat_gate_duel' }]);

    const npcUpdated = applyLuanShiCommand(playerUpdated, {
      action: 'updateCharacterReputation',
      characterId: 'npc_guard',
      characterType: 'npc',
      fameDelta: 2,
      tags: [{ label: 'steadfast-witness', source: 'combat_gate_duel' }],
      summary: 'Witnessed the gate duel and remained steady.',
      updatedAt: '189-09-01 12:00',
    } as any);

    const npc = npcUpdated.npcs.find((item) => item.npcId === 'npc_guard');
    expect(npc?.reputation).toEqual(expect.objectContaining({
      fame: 2,
      morality: 0,
      summary: 'Witnessed the gate duel and remained steady.',
    }));
    expect(npc?.reputation?.tags).toEqual([{ label: 'steadfast-witness', source: 'combat_gate_duel' }]);
  });

  it('keeps reputation on the signed long campaign range', () => {
    const infamous = applyLuanShiCommand({
      ...baseState,
      player: {
        ...baseState.player,
        reputation: {
          fame: -950,
          morality: -950,
          tags: [],
          summary: '',
        },
      },
    }, {
      action: 'updateCharacterReputation',
      characterId: 'player',
      characterType: 'player',
      fameDelta: -100,
      moralityDelta: -100,
    } as any);

    expect(infamous.player.reputation).toEqual(expect.objectContaining({
      fame: -1000,
      morality: -1000,
    }));

    const renowned = applyLuanShiCommand({
      ...baseState,
      player: {
        ...baseState.player,
        reputation: {
          fame: 950,
          morality: 950,
          tags: [],
          summary: '',
        },
      },
    }, {
      action: 'updateCharacterReputation',
      characterId: 'player',
      characterType: 'player',
      fameDelta: 100,
      moralityDelta: 100,
    } as any);

    expect(renowned.player.reputation).toEqual(expect.objectContaining({
      fame: 1000,
      morality: 1000,
    }));
  });

  it('upserts player holdings and domestic reports through stable ids', () => {
    const withHolding = applyLuanShiCommand(baseState, {
      action: 'upsertHoldingLedger',
      operation: 'create',
      holdingId: 'holding_yingchuan',
      name: 'Yangdi county seat',
      type: 'county',
      status: 'controlled',
      summary: 'A county seat under player administration.',
      civilAdministrationScope: 'territorial',
      factionId: 'faction_player',
      actualController: 'player faction',
      controlEvidence: {
        kind: 'formal_handover',
        occurredAt: '189-09-01',
        sourceRefId: 'turn_event_yingchuan_handover',
        summary: 'The county administration was formally handed over to the player faction.',
      },
      scaleLevel: 3,
      agriculture: 75,
      commerce: 60,
      population: 70,
      publicOrder: 66,
      popularSupport: 62,
      defense: 55,
      recruitPotential: 68,
      armory: 40,
      horseSupply: 20,
      corruption: 18,
      farmlandMu: 12000,
      registeredHouseholds: 1800,
      eliteControlledShare: 65,
      localEliteRelation: 35,
      garrisonTroopIds: ['troop_guard_1'],
      relatedNpcIds: ['npc_guard'],
      riskNotes: ['border pressure'],
      recentChanges: ['granary repaired'],
      siege: {
        status: 'encircled',
        supplyLine: 'cut',
        preparation: 'none',
      },
      updatedAt: '189-09-01',
    } as any);

    const updatedHolding = applyLuanShiCommand(withHolding, {
      action: 'upsertHoldingLedger',
      operation: 'update',
      holdingId: 'holding_yingchuan',
      name: 'Yangdi county seat',
      type: 'county',
      status: 'controlled',
      summary: 'A county seat with improved public order after repairs.',
      civilAdministrationScope: 'territorial',
      factionId: 'faction_player',
      actualController: 'player faction',
      scaleLevel: 3,
      agriculture: 75,
      commerce: 60,
      population: 70,
      publicOrder: 72,
      popularSupport: 64,
      defense: 55,
      recruitPotential: 68,
      armory: 40,
      horseSupply: 20,
      corruption: 18,
      farmlandMu: 12200,
      registeredHouseholds: 1840,
      eliteControlledShare: 62,
      localEliteRelation: 42,
      updatedAt: '189-09-02',
    } as any);

    expect(updatedHolding.holdings).toHaveLength(1);
    expect(updatedHolding.holdings[0]).toEqual(expect.objectContaining({
      holdingId: 'holding_yingchuan',
      summary: 'A county seat with improved public order after repairs.',
      publicOrder: 72,
      farmlandMu: 12200,
      registeredHouseholds: 1840,
      eliteControlledShare: 62,
      localEliteRelation: 42,
      siege: {
        status: 'encircled',
        supplyLine: 'cut',
        preparation: 'none',
        cutOffAtTurn: 1,
        initialEnduranceTurns: 15,
      },
      updatedAt: '189-09-02',
    }));
    expect(updatedHolding.holdings[0].localTreasury).toBeUndefined();
    expect(updatedHolding.holdings[0].localGranary).toBeUndefined();

    const convertedToMilitaryFacility = applyLuanShiCommand(updatedHolding, {
      action: 'upsertHoldingLedger',
      holdingId: 'holding_yingchuan',
      name: 'Yangdi county seat',
      type: 'camp',
      status: 'controlled',
      summary: 'The former civil ledger is now represented as a pure military facility for transition testing.',
      civilAdministrationScope: 'none',
      scaleLevel: 3,
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 0,
      popularSupport: 0,
      defense: 55,
      recruitPotential: 0,
      armory: 40,
      horseSupply: 20,
      updatedAt: '189-09-03',
    } as any);

    expect(convertedToMilitaryFacility.holdings[0]).toMatchObject({
      civilAdministrationScope: 'none',
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 0,
      popularSupport: 0,
      recruitPotential: 0,
    });
    expect(convertedToMilitaryFacility.holdings[0].farmlandMu).toBeUndefined();
    expect(convertedToMilitaryFacility.holdings[0].registeredHouseholds).toBeUndefined();
    expect(convertedToMilitaryFacility.holdings[0].eliteControlledShare).toBeUndefined();
    expect(convertedToMilitaryFacility.holdings[0].localEliteRelation).toBeUndefined();
    expect(convertedToMilitaryFacility.holdings[0].corruption).toBeUndefined();

    const withReport = applyLuanShiCommand(updatedHolding, {
      action: 'upsertDomesticReport',
      reportId: 'domestic_189',
      year: 189,
      settledAt: '189-09-01',
      title: 'Autumn accounts',
      summary: 'The annual settlement has been calculated locally.',
      income: { money: 100, grain: 2000, horses: 3, arms: 12, recruits: 80 },
      expenses: { money: 10, grain: 300, horses: 1, arms: 2, recruits: 0 },
      netChange: { money: 90, grain: 1700, horses: 2, arms: 10, recruits: 80 },
      holdingHighlights: [{ holdingId: 'holding_yingchuan', summary: 'Harvest was stable.' }],
      warnings: ['corruption rising'],
      readByPlayer: false,
    } as any);

    expect(withReport.domesticReports).toHaveLength(1);
    expect(withReport.domesticReports[0]).toEqual(expect.objectContaining({
      reportId: 'domestic_189',
      year: 189,
      source: 'llm',
      readByPlayer: false,
    }));
  });

  it.each([
    { reportId: 'system:holding-annual:189' },
    { reportId: ' SYSTEM:holding-annual:189 ' },
    { reportId: 'forged_report_189', source: 'system' },
    { reportId: 'forged_report_189', source: ' system ' },
    { reportId: 'forged_report_189', source: 'SyStEm' },
    { reportId: 'forged_report_189', kind: 'holdingAnnualSettlement' },
    { reportId: 'forged_report_189', kind: ' holdingAnnualSettlement ' },
    { reportId: 'forged_report_189', kind: 'HoldingAnnualSettlement' },
  ])('rejects direct reducer attempts to claim system domestic report identity: %o', (reservedFields) => {
    const result = applyLuanShiCommand(baseState, {
      action: 'upsertDomesticReport',
      year: 189,
      settledAt: '189-09-01',
      title: 'Forged system report',
      summary: 'This bypasses command validation.',
      income: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      readByPlayer: false,
      ...reservedFields,
    } as any);

    expect(result.domesticReports).toEqual([]);
  });

  it.each([
    { reportId: 'system:holding-monthly-upkeep:189-05' },
    { reportId: ' SYSTEM:holding-monthly-upkeep:189-05 ' },
    { reportId: 'forged_report_189_05', kind: 'holdingMonthlyUpkeep' },
    { reportId: 'forged_report_189_05', kind: ' holdingMonthlyUpkeep ' },
    { reportId: 'forged_report_189_05', kind: 'HoldingMonthlyUpkeep' },
  ])('rejects direct reducer attempts to claim monthly-upkeep system identity: %o', (reservedFields) => {
    const result = applyLuanShiCommand(baseState, {
      action: 'upsertDomesticReport',
      year: '189-05',
      settledAt: '189-05-01',
      title: 'Forged upkeep report',
      summary: 'This bypasses command validation.',
      income: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      readByPlayer: false,
      ...reservedFields,
    } as any);

    expect(result.domesticReports).toEqual([]);
  });

  it('stores project highlights without the optional assetId', () => {
    const result = applyLuanShiCommand(baseState, {
      action: 'upsertDomesticReport',
      reportId: 'model_project_report_189',
      year: 189,
      settledAt: '189-06-01',
      title: 'Project report',
      summary: 'A model-authored project update.',
      income: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      projectHighlights: [{ projectId: 'project_road', summary: 'Road work began.' }],
      readByPlayer: false,
    });

    expect(result.domesticReports).toEqual([
      expect.objectContaining({
        source: 'llm',
        projectHighlights: [{ projectId: 'project_road', summary: 'Road work began.' }],
      }),
    ]);
  });

  it('keeps legacy reports readable while normalizing legal model upserts to llm source', () => {
    const legacyReport = {
      reportId: 'domestic_188',
      year: 188,
      settledAt: '188-09-01',
      title: 'Legacy report',
      summary: 'Saved before source and kind existed.',
      income: { money: 1, grain: 2, horses: 0, arms: 0, recruits: 0 },
      expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 1, grain: 2, horses: 0, arms: 0, recruits: 0 },
      readByPlayer: true,
    };
    const stateWithLegacy = { ...baseState, domesticReports: [legacyReport] } as any;

    const result = applyLuanShiCommand(stateWithLegacy, {
      action: 'upsertDomesticReport',
      reportId: ' model_special_189 ',
      source: ' LLM ',
      kind: ' specialDomesticReport ',
      year: 189,
      settledAt: '189-06-01',
      title: 'Special report',
      summary: 'A legal model-authored report.',
      income: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      readByPlayer: false,
    } as any);

    expect(result.domesticReports[0]).toEqual(legacyReport);
    expect(result.domesticReports[0].source).toBeUndefined();
    expect(result.domesticReports[0].kind).toBeUndefined();
    expect(result.domesticReports[1]).toMatchObject({
      reportId: 'model_special_189',
      source: 'llm',
      kind: 'specialDomesticReport',
    });
  });

  it('preserves existing holding fields when a later update only changes current scores', () => {
    const withHolding = applyLuanShiCommand(baseState, {
      action: 'upsertHoldingLedger',
      operation: 'create',
      holdingId: 'holding_yingchuan',
      name: 'Yangdi county seat',
      type: 'county',
      status: 'controlled',
      summary: 'A county seat under player administration.',
      civilAdministrationScope: 'territorial',
      factionId: 'faction_player',
      actualController: 'player faction',
      controlEvidence: {
        kind: 'opening',
        occurredAt: '189-09-01',
        sourceRefId: 'opening_yingchuan_holding',
        summary: 'The opening state establishes the player faction as the county administrator.',
      },
      scaleLevel: 3,
      agriculture: 75,
      commerce: 60,
      population: 70,
      publicOrder: 66,
      popularSupport: 62,
      defense: 55,
      recruitPotential: 68,
      armory: 40,
      horseSupply: 20,
      corruption: 18,
      farmlandMu: 12000,
      registeredHouseholds: 1800,
      eliteControlledShare: 65,
      localEliteRelation: 35,
      localTreasury: 30,
      localGranary: 900,
      garrisonTroopIds: ['troop_guard_1'],
      relatedNpcIds: ['npc_guard'],
      riskNotes: ['border pressure'],
      recentChanges: ['granary repaired'],
      sourceNote: 'opening settlement',
      updatedAt: '189-09-01',
    } as any);

    const withLegacyHolding = {
      ...withHolding,
      holdings: withHolding.holdings.map((holding) => ({
        ...holding,
        localTreasury: 30,
        localGranary: 900,
      })),
    };

    const updated = applyLuanShiCommand(withLegacyHolding, {
      action: 'upsertHoldingLedger',
      operation: 'update',
      holdingId: 'holding_yingchuan',
      name: 'Yangdi county seat',
      type: 'county',
      status: 'controlled',
      summary: 'Public order improves after the player negotiates with local elders.',
      civilAdministrationScope: 'territorial',
      scaleLevel: 3,
      agriculture: 75,
      commerce: 60,
      population: 70,
      publicOrder: 74,
      popularSupport: 68,
      defense: 55,
      recruitPotential: 68,
      armory: 40,
      horseSupply: 20,
      corruption: 18,
      localEliteRelation: 48,
      updatedAt: '189-09-02',
    } as any);

    expect(updated.holdings).toHaveLength(1);
    expect(updated.holdings[0]).toEqual(expect.objectContaining({
      holdingId: 'holding_yingchuan',
      summary: 'Public order improves after the player negotiates with local elders.',
      publicOrder: 74,
      popularSupport: 68,
      farmlandMu: 12000,
      registeredHouseholds: 1800,
      eliteControlledShare: 65,
      localEliteRelation: 48,
      localTreasury: 30,
      localGranary: 900,
      garrisonTroopIds: ['troop_guard_1'],
      relatedNpcIds: ['npc_guard'],
      riskNotes: ['border pressure'],
      recentChanges: ['granary repaired'],
      sourceNote: 'opening settlement',
      updatedAt: '189-09-02',
    }));
  });

  it('upserts heroine and non-heroine bond threads through stable ids', () => {
    const withHeroine = applyLuanShiCommand(baseState, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_npc_guard',
      npcId: 'npc_guard',
      npcName: 'Lady Guard',
      status: 'active',
      stage: 'trust-forming',
      relationshipRole: 'confidante',
      summary: 'A private relationship thread formed during the retreat.',
      currentPull: 'She is waiting for a sign that the player will protect her people.',
      riskNotes: 'Exposure would draw political pressure.',
      promiseNotes: 'The player promised discreet aid.',
      recentProgress: 'The two shared a guarded conversation.',
      tags: ['court', 'trust'],
      milestones: [{
        milestoneId: 'heroine_m1',
        happenedAt: '189-09-01',
        summary: 'They reached a first understanding.',
      }],
      lastUpdatedAt: '189-09-01',
      source: 'test',
    } as any);

    const updatedHeroine = applyLuanShiCommand(withHeroine, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_npc_guard',
      npcId: 'npc_guard',
      npcName: 'Lady Guard',
      status: 'active',
      stage: 'trust-deepened',
      relationshipRole: 'confidante',
      summary: 'The relationship thread deepened after shared danger.',
      lastUpdatedAt: '189-09-02',
    } as any);

    expect(updatedHeroine.heroineThreads).toHaveLength(1);
    expect(updatedHeroine.heroineThreads[0]).toEqual(expect.objectContaining({
      heroineThreadId: 'heroine_npc_guard',
      stage: 'trust-deepened',
      summary: 'The relationship thread deepened after shared danger.',
      lastUpdatedAt: '189-09-02',
    }));

    const withBond = applyLuanShiCommand(updatedHeroine, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_gate_oath',
      targetNpcIds: ['npc_guard'],
      targetNames: ['Chen Guard'],
      bondType: 'sworn',
      status: 'active',
      summary: 'A non-romantic oath bond over the gate defense.',
      currentTension: 'Both sides expect loyalty under pressure.',
      promiseNotes: 'They promised to protect the same refugees.',
      conflictNotes: 'Failure would strain trust.',
      recentProgress: 'The oath became known among the troops.',
      tags: ['oath'],
      milestones: [{
        milestoneId: 'bond_m1',
        happenedAt: '189-09-01',
        summary: 'They exchanged an oath.',
      }],
      lastUpdatedAt: '189-09-01',
      source: 'test',
    } as any);

    expect(withBond.bondThreads).toHaveLength(1);
    expect(withBond.bondThreads[0]).toEqual(expect.objectContaining({
      bondThreadId: 'bond_gate_oath',
      bondType: 'sworn',
      summary: 'A non-romantic oath bond over the gate defense.',
    }));
    expect(withBond.heroineThreads).toHaveLength(1);

    const withScalarTargetName = applyLuanShiCommand(withBond, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_zhao_oath',
      targetNames: 'Zhao Wu',
      bondType: 'sworn',
      status: 'active',
      summary: 'A sworn-brotherhood style bond created during a street crisis.',
      lastUpdatedAt: '189-09-02',
    } as any);

    expect(withScalarTargetName.bondThreads).toContainEqual(expect.objectContaining({
      bondThreadId: 'bond_zhao_oath',
      targetNames: ['Zhao Wu'],
    }));
    expect(withScalarTargetName.bondThreads.find((entry) => entry.bondThreadId === 'bond_zhao_oath')?.targetNpcIds).toBeUndefined();
  });

  it('preserves omitted heroine fields, clears explicit nulls, canonicalizes names, and clones nested input', () => {
    const tags = ['court', 'trust'];
    const milestones = [{
      milestoneId: 'heroine_m1',
      happenedAt: '189-09-01',
      summary: 'They reached a first understanding.',
    }];
    const created = applyLuanShiCommand(baseState, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_npc_guard',
      npcId: 'npc_guard',
      npcName: 'Wrong Name',
      status: 'active',
      stage: 'trust-forming',
      relationshipRole: 'confidante',
      summary: 'A private relationship thread formed during the retreat.',
      currentPull: 'She is waiting for a sign.',
      riskNotes: 'Exposure would draw political pressure.',
      promiseNotes: 'The player promised discreet aid.',
      recentProgress: 'The two shared a guarded conversation.',
      tags,
      milestones,
      lastUpdatedAt: '189-09-01',
      source: 'test',
    });

    tags.push('mutated');
    milestones[0].summary = 'mutated';

    const updated = applyLuanShiCommand(created, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_npc_guard',
      stage: 'trust-deepened',
      riskNotes: null,
      tags: null,
      milestones: null,
      source: null,
    });

    const preservedUndefined = applyLuanShiCommand(created, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_npc_guard',
      tags: undefined,
      milestones: undefined,
    });

    expect(created.heroineThreads[0]).toMatchObject({
      npcName: '陈达',
      tags: ['court', 'trust'],
      milestones: [{ summary: 'They reached a first understanding.' }],
    });
    expect(preservedUndefined.heroineThreads[0]).toMatchObject({
      tags: ['court', 'trust'],
      milestones: [{ summary: 'They reached a first understanding.' }],
    });
    expect(updated.heroineThreads[0]).toEqual({
      heroineThreadId: 'heroine_npc_guard',
      npcId: 'npc_guard',
      npcName: '陈达',
      status: 'active',
      stage: 'trust-deepened',
      relationshipRole: 'confidante',
      summary: 'A private relationship thread formed during the retreat.',
      currentPull: 'She is waiting for a sign.',
      promiseNotes: 'The player promised discreet aid.',
      recentProgress: 'The two shared a guarded conversation.',
      lastUpdatedAt: '公元189年09月01日 12:00（午时）',
    });
  });

  it('preserves bond patches, validates canonical targets, deduplicates ids, and clones target arrays', () => {
    const targetNpcIds = ['npc_guard', 'npc_guard'];
    const targetNames = ['Wrong Name', 'Duplicate Wrong Name'];
    const tags = ['oath'];
    const milestones = [{
      milestoneId: 'bond_m1',
      happenedAt: '189-09-01',
      summary: 'They exchanged an oath.',
    }];
    const created = applyLuanShiCommand(baseState, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_gate_oath',
      targetNpcIds,
      targetNames,
      bondType: 'sworn',
      status: 'active',
      summary: 'A non-romantic oath bond over the gate defense.',
      currentTension: 'Both sides expect loyalty under pressure.',
      promiseNotes: 'They promised to protect the same refugees.',
      conflictNotes: 'Failure would strain trust.',
      recentProgress: 'The oath became known among the troops.',
      tags,
      milestones,
      lastUpdatedAt: '189-09-01',
      source: 'test',
    });

    targetNpcIds[0] = 'npc_missing';
    targetNames[0] = 'mutated';
    tags.push('mutated');
    milestones[0].summary = 'mutated';

    const updated = applyLuanShiCommand(created, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_gate_oath',
      summary: 'The oath bond deepened after another defense.',
      currentTension: null,
      targetNpcIds: undefined,
      targetNames: ['Forged Name'],
      tags: undefined,
      milestones: undefined,
    });

    expect(created.bondThreads[0]).toMatchObject({
      targetNpcIds: ['npc_guard'],
      targetNames: ['陈达'],
      tags: ['oath'],
      milestones: [{ summary: 'They exchanged an oath.' }],
    });
    expect(updated.bondThreads[0]).toEqual({
      bondThreadId: 'bond_gate_oath',
      targetNpcIds: ['npc_guard'],
      targetNames: ['陈达'],
      bondType: 'sworn',
      status: 'active',
      summary: 'The oath bond deepened after another defense.',
      promiseNotes: 'They promised to protect the same refugees.',
      conflictNotes: 'Failure would strain trust.',
      recentProgress: 'The oath became known among the troops.',
      tags: ['oath'],
      milestones: [{
        milestoneId: 'bond_m1',
        happenedAt: '189-09-01',
        summary: 'They exchanged an oath.',
      }],
      lastUpdatedAt: '公元189年09月01日 12:00（午时）',
      source: 'test',
    });

    const switchedToNameOnly = applyLuanShiCommand(updated, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_gate_oath',
      targetNpcIds: null,
      targetNames: ['Name-only Contact'],
      lastUpdatedAt: '189-09-03',
    });
    expect(switchedToNameOnly.bondThreads[0]).toMatchObject({
      targetNames: ['Name-only Contact'],
      lastUpdatedAt: '189-09-03',
    });
    expect(switchedToNameOnly.bondThreads[0].targetNpcIds).toBeUndefined();
  });

  it('uses currentDate for omitted relationship timestamps and rejects blank timestamps', () => {
    const withHeroine = applyLuanShiCommand(baseState, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_npc_guard',
      npcId: 'npc_guard',
      npcName: 'Wrong Name',
      status: 'active',
      stage: 'trust-forming',
      relationshipRole: 'confidante',
      summary: 'A private relationship thread.',
      lastUpdatedAt: '189-09-01',
    });
    const heroineUpdated = applyLuanShiCommand(withHeroine, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_npc_guard',
      summary: 'Updated without a timestamp.',
    });
    const withBond = applyLuanShiCommand(heroineUpdated, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_gate_oath',
      targetNpcIds: ['npc_guard'],
      targetNames: ['Wrong Name'],
      bondType: 'sworn',
      status: 'active',
      summary: 'A sworn bond.',
      lastUpdatedAt: '189-09-01',
    });
    const bondUpdated = applyLuanShiCommand(withBond, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_gate_oath',
      summary: 'Updated with a blank timestamp.',
      lastUpdatedAt: '   ',
    });

    expect(heroineUpdated.heroineThreads[0].lastUpdatedAt).toBe(baseState.currentDate);
    expect(bondUpdated.bondThreads[0].lastUpdatedAt).toBe('189-09-01');
    expect(bondUpdated.bondThreads[0].summary).toBe('A sworn bond.');
  });

  it('deep-clones omitted legacy relationship fields without normalizing their contents', () => {
    const heroineMilestone = {
      milestoneId: '  heroine_legacy_m1  ',
      happenedAt: '  189-09-01  ',
      summary: '  Keep the original heroine milestone text.  ',
      source: '  legacy import  ',
    };
    const bondMilestone = {
      milestoneId: '  bond_legacy_m1  ',
      happenedAt: '  189-09-02  ',
      summary: '  Keep the original bond milestone text.  ',
      source: '  legacy import  ',
    };
    const heroineTags = ['  court  ', ' trust '];
    const bondTags = ['  oath  ', ' old import '];
    const targetNames = ['  Legacy Contact  '];
    const heroineMilestones = [heroineMilestone];
    const bondMilestones = [bondMilestone];
    const state: RuntimeState = {
      ...baseState,
      heroineThreads: [{
        heroineThreadId: 'heroine_npc_guard',
        npcId: 'npc_guard',
        npcName: '陈达',
        status: 'active',
        stage: 'trust-forming',
        relationshipRole: 'confidante',
        summary: 'Legacy heroine summary.',
        tags: heroineTags,
        milestones: heroineMilestones,
        lastUpdatedAt: '189-09-01',
      }],
      bondThreads: [{
        bondThreadId: 'bond_legacy_contact',
        targetNames,
        bondType: 'ally',
        status: 'active',
        summary: 'Legacy bond summary.',
        tags: bondTags,
        milestones: bondMilestones,
        lastUpdatedAt: '189-09-02',
      }],
    };

    const heroineUpdated = applyLuanShiCommand(state, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_npc_guard',
      summary: 'Only the heroine summary changes.',
    });
    const bondUpdated = applyLuanShiCommand(state, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_legacy_contact',
      summary: 'Only the bond summary changes.',
    });

    expect(heroineUpdated.heroineThreads[0].milestones).toEqual([heroineMilestone]);
    expect(heroineUpdated.heroineThreads[0].milestones).not.toBe(heroineMilestones);
    expect(heroineUpdated.heroineThreads[0].milestones?.[0]).not.toBe(heroineMilestone);
    expect(heroineUpdated.heroineThreads[0].tags).toEqual(heroineTags);
    expect(heroineUpdated.heroineThreads[0].tags).not.toBe(heroineTags);

    expect(bondUpdated.bondThreads[0].milestones).toEqual([bondMilestone]);
    expect(bondUpdated.bondThreads[0].milestones).not.toBe(bondMilestones);
    expect(bondUpdated.bondThreads[0].milestones?.[0]).not.toBe(bondMilestone);
    expect(bondUpdated.bondThreads[0].tags).toEqual(bondTags);
    expect(bondUpdated.bondThreads[0].tags).not.toBe(bondTags);
    expect(bondUpdated.bondThreads[0].targetNames).toEqual(targetNames);
    expect(bondUpdated.bondThreads[0].targetNames).not.toBe(targetNames);
  });

  it('updates padded relationship stable ids in place and persists canonical ids', () => {
    const state: RuntimeState = {
      ...baseState,
      heroineThreads: [{
        heroineThreadId: ' heroine_npc_guard ',
        npcId: 'npc_guard',
        npcName: '陈达',
        status: 'active',
        stage: 'trust-forming',
        relationshipRole: 'confidante',
        summary: 'An existing heroine thread.',
        lastUpdatedAt: '189-09-01',
      }],
      bondThreads: [{
        bondThreadId: ' bond_npc_guard ',
        targetNpcIds: ['npc_guard'],
        targetNames: ['陈达'],
        bondType: 'ally',
        status: 'active',
        summary: 'An existing bond thread.',
        lastUpdatedAt: '189-09-01',
      }],
    };

    const heroineUpdated = applyLuanShiCommand(state, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_npc_guard',
      summary: 'Updated through the canonical heroine key.',
    });
    const bondUpdated = applyLuanShiCommand(state, {
      action: 'upsertBondThread',
      bondThreadId: ' bond_npc_guard ',
      summary: 'Updated through the canonical bond key.',
    });

    expect(heroineUpdated.heroineThreads).toHaveLength(1);
    expect(heroineUpdated.heroineThreads[0]).toMatchObject({
      heroineThreadId: 'heroine_npc_guard',
      summary: 'Updated through the canonical heroine key.',
    });
    expect(bondUpdated.bondThreads).toHaveLength(1);
    expect(bondUpdated.bondThreads[0]).toMatchObject({
      bondThreadId: 'bond_npc_guard',
      summary: 'Updated through the canonical bond key.',
    });
  });

  it('marks story-written calendar eras as runtime eras when source is omitted', () => {
    const updated = applyLuanShiCommand(baseState, {
      action: 'upsertCalendarEra',
      eraId: 'alt_jianwu',
      eraName: '建武',
      startYear: 194,
    });

    expect(updated.calendarEras).toContainEqual(expect.objectContaining({
      eraId: 'alt_jianwu',
      eraName: '建武',
      startYear: 194,
      source: 'runtime.story',
    }));
  });
});

describe('troop location writeback consistency', () => {
  const existingTroopState: RuntimeState = {
    ...baseState,
    troops: [{
      troopId: 'troop_marching',
      name: '南门郡兵',
      size: 300,
      morale: 60,
      training: 55,
      supplies: 40,
      task: '向东门转移',
      relationToPlayer: 'self',
      locationId: 'place_south_camp',
      lastKnownLocationId: 'place_south_camp',
      lastKnownAt: '公元189年09月01日 10:00（巳时）',
      destinationLocationId: 'place_east_gate',
      movementStatus: 'marching',
      updatedAt: '公元189年09月01日 10:00（巳时）',
    }],
  };

  it('mirrors an explicit current position into last-known fields with a deterministic timestamp', () => {
    const stationaryState: RuntimeState = {
      ...existingTroopState,
      troops: [{
        ...existingTroopState.troops![0],
        movementStatus: 'none',
        destinationLocationId: undefined,
      }],
    };
    const next = applyLuanShiCommand(stationaryState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_marching',
      locationId: 'place_forward_camp',
      updatedAt: '公元189年09月01日 13:00（未时）',
    });

    expect(next.troops[0]).toEqual(expect.objectContaining({
      locationId: 'place_forward_camp',
      lastKnownLocationId: 'place_forward_camp',
      lastKnownAt: '公元189年09月01日 13:00（未时）',
      updatedAt: '公元189年09月01日 13:00（未时）',
    }));
  });

  it('moves an arrived troop to its stable destination and closes arrival timestamps', () => {
    const next = applyLuanShiCommand(existingTroopState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_marching',
      movementStatus: 'arrived',
    });

    expect(next.troops[0]).toEqual(expect.objectContaining({
      locationId: 'place_east_gate',
      lastKnownLocationId: 'place_east_gate',
      lastKnownAt: baseState.currentDate,
      destinationLocationId: 'place_east_gate',
      movementStatus: 'arrived',
      arrivedAt: baseState.currentDate,
      updatedAt: baseState.currentDate,
    }));
  });

  it('keeps position fields unchanged on unrelated updates while refreshing updatedAt', () => {
    const next = applyLuanShiCommand(existingTroopState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_marching',
      task: '原地待命',
    });

    expect(next.troops[0]).toEqual(expect.objectContaining({
      locationId: 'place_south_camp',
      lastKnownLocationId: 'place_south_camp',
      lastKnownAt: '公元189年09月01日 10:00（巳时）',
      updatedAt: baseState.currentDate,
    }));
  });

  it('clears stale route and timing fields when a different destination starts a new movement cycle', () => {
    const arrivedState: RuntimeState = {
      ...existingTroopState,
      troops: [{
        ...existingTroopState.troops![0],
        destinationLocationId: 'place_east_gate',
        routeId: 'route_south_to_east',
        movementStatus: 'arrived',
        orderStatus: 'delivered',
        orderIssuedAt: '公元189年09月01日 09:00（巳时）',
        orderDeliveredAt: '公元189年09月01日 09:20（巳时）',
        orderSummary: '前往东门',
        departedAt: '公元189年09月01日 10:10（巳时）',
        estimatedArrivalAt: '公元189年09月01日 11:30（午时）',
        arrivedAt: '公元189年09月01日 11:20（午时）',
        movementNotes: '上一趟已经抵达',
      }],
    };

    const next = applyLuanShiCommand(arrivedState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_marching',
      destinationLocationId: 'place_west_market',
      movementStatus: 'waitingOrder',
      orderStatus: 'issued',
    });

    expect(next.troops[0]).toEqual(expect.objectContaining({
      locationId: 'place_south_camp',
      lastKnownLocationId: 'place_south_camp',
      destinationLocationId: 'place_west_market',
      movementStatus: 'waitingOrder',
      orderStatus: 'issued',
    }));
    expect(next.troops[0]).not.toHaveProperty('routeId');
    expect(next.troops[0]).not.toHaveProperty('orderIssuedAt');
    expect(next.troops[0]).not.toHaveProperty('orderDeliveredAt');
    expect(next.troops[0]).not.toHaveProperty('orderSummary');
    expect(next.troops[0]).not.toHaveProperty('departedAt');
    expect(next.troops[0]).not.toHaveProperty('estimatedArrivalAt');
    expect(next.troops[0]).not.toHaveProperty('arrivedAt');
    expect(next.troops[0]).not.toHaveProperty('movementNotes');
  });

  it('preserves route and timing fields when a partial update keeps the same destination', () => {
    const sameRouteState: RuntimeState = {
      ...existingTroopState,
      troops: [{
        ...existingTroopState.troops![0],
        routeId: 'route_south_to_east',
        departedAt: '公元189年09月01日 10:10（巳时）',
        estimatedArrivalAt: '公元189年09月01日 11:30（午时）',
      }],
    };

    const next = applyLuanShiCommand(sameRouteState, {
      action: 'upsertTroopLedger',
      troopId: 'troop_marching',
      destinationLocationId: 'place_east_gate',
      movementStatus: 'marching',
      movementNotes: '仍在途中',
    });

    expect(next.troops[0]).toEqual(expect.objectContaining({
      destinationLocationId: 'place_east_gate',
      routeId: 'route_south_to_east',
      departedAt: '公元189年09月01日 10:10（巳时）',
      estimatedArrivalAt: '公元189年09月01日 11:30（午时）',
      movementStatus: 'marching',
      movementNotes: '仍在途中',
    }));
  });
});
