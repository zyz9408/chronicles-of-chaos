import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from './createInitialRuntimeState';
import { validateLuanShiCommand } from './luanshiCommands';
import { applyLuanShiCommand } from './luanshiReducers';

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
        npcId: 'npc_chen_heng',
        name: '陈衡',
        sex: '男',
        age: 30,
        role: '游侠首领',
        locationId: 'loc_market_town',
        isPresent: true,
        isFocused: true,
        summary: '机警过人。',
        appearance: '目光锐利。',
        personality: '豪爽直接。',
        motivation: '寻找机会。',
        relationToPlayer: '初识。',
        contactLevel: 10,
        recentAttitude: '好奇',
        memories: [],
      },
      {
        npcId: 'npc_li_su',
        name: '李肃',
        sex: '男',
        age: 31,
        role: '地方士人',
        locationId: 'loc_capital',
        isPresent: false,
        isFocused: false,
        summary: '地方名士之后。',
        appearance: '仪表堂堂。',
        personality: '矜持自重。',
        motivation: '维持家声。',
        relationToPlayer: '未见。',
        contactLevel: 0,
        recentAttitude: '陌生',
        memories: [],
      },
    ],
  });
}

function makeUniqueArt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'art_border_scouting',
    name: 'Border Scouting',
    rarity: 'blue',
    domain: 'survival',
    level: 2,
    maxLevel: 10,
    progress: 35,
    description: 'Reads terrain, patrol habits, and hidden tracks in borderland marches.',
    effectSummary: 'Improves route reading, ambush avoidance, and pursuit checks.',
    source: 'opening',
    promptHint: 'Use as a long-term survival and scouting edge, not as an automatic success.',
    checkHooks: [
      {
        scope: 'travel.scouting',
        modifier: 8,
        note: 'Useful when judging routes, ambush traces, or pursuit direction.',
      },
    ],
    tags: ['scouting', 'march'],
    ...overrides,
  };
}

function makeNpcProfileUpsertCommand(overrides: Record<string, unknown> = {}) {
  return {
    action: 'upsertNpcProfile',
    npcId: 'npc_gate_guard',
    name: '门候',
    sex: '男',
    age: 36,
    role: '洛阳城门守军',
    currentIdentity: '城门门候',
    locationId: 'loc_market_town',
    isPresent: true,
    isFocused: true,
    summary: '守在城门处的老成军士。',
    appearance: '甲衣半旧，胡须粗硬，眼神警惕。',
    personality: '谨慎务实，不愿轻易惹祸。',
    motivation: '守住差事，避开城中清算。',
    relationToPlayer: '初次接触。',
    contactLevel: 8,
    recentAttitude: '戒备但愿意听令',
    abilityScores: { 武力: 55, 统率: 42, 智力: 45, 政治: 30, 魅力: 36, 机运: 48 },
    traits: [
      {
        id: 'trait_gate_guard_wary',
        label: '城门老卒',
        description: '熟悉城门盘查与兵卒暗语。',
        source: 'event',
      },
    ],
    ...overrides,
  };
}

describe('validateLuanShiCommand', () => {
  it('validates narrow NPC presence updates without requiring a full profile rewrite', () => {
    const state = makeState();

    expect(validateLuanShiCommand(state, {
      action: 'updateNpcPresence',
      npcId: 'npc_chen_heng',
      locationId: 'loc_capital',
      isPresent: false,
      isFocused: true,
    } as any)).toEqual({ valid: true, errors: [], warnings: [] });

    const missingNpc = validateLuanShiCommand(state, {
      action: 'updateNpcPresence',
      npcId: 'npc_missing',
      locationId: 'loc_capital',
      isPresent: false,
    } as any);
    expect(missingNpc.valid).toBe(false);
    expect(missingNpc.errors.join('\n')).toContain('npc_missing');
  });

  it('为三国世界书默认补入中平年号锚点', () => {
    const state = ensureLuanShiState({
      ...makeState(),
      worldBookId: 'threeKingdoms',
      calendarEras: undefined,
    } as any);

    expect(state.calendarEras[0]).toMatchObject({
      eraId: 'han_zhongping',
      eraName: '中平',
      startYear: 184,
    });
  });

  it('允许结构化写回新年号并按开始时间保存', () => {
    const state = makeState();
    const command = {
      action: 'upsertCalendarEra',
      eraId: 'era_yuanfeng',
      eraName: '元丰',
      startYear: 196,
      startMonth: 1,
      startDay: 1,
      rulerName: '刘构',
      source: '称帝改元',
    } as any;

    const result = validateLuanShiCommand(state, command);
    expect(result.valid).toBe(true);

    const next = applyLuanShiCommand(state, command);
    expect(next.calendarEras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eraId: 'era_yuanfeng',
          eraName: '元丰',
          startYear: 196,
          startMonth: 1,
          startDay: 1,
        }),
      ]),
    );
  });

  it('拒绝缺少稳定字段的年号写回', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertCalendarEra',
      eraId: '',
      eraName: '',
      startYear: 0,
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('eraId');
    expect(result.errors.join('\n')).toContain('eraName');
    expect(result.errors.join('\n')).toContain('startYear');
  });

  it('允许无在场 NPC 的回合事件省略 presentNpcIds', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'recordTurnEvent',
      eventId: 'evt_no_present_npc',
      locationId: 'loc_market_town',
      summary: '主角独自在市集外观察风声。',
      visibility: '在场可知',
    } as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('允许模型使用 in_presence 作为回合事件可见性别名', () => {
    const state = makeState();
    const command = {
      action: 'recordTurnEvent',
      eventId: 'evt_alias_visibility',
      locationId: 'loc_market_town',
      summary: '主角在宫门前目睹军士调动。',
      visibility: 'in_presence',
    } as any;

    const result = validateLuanShiCommand(state, command);
    const next = applyLuanShiCommand(state, command);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(next.turnEvents[0]).toMatchObject({
      eventId: 'evt_alias_visibility',
      visibility: '在场可知',
    });
  });

  it('拒绝非数组的回合事件在场 NPC 字段', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'recordTurnEvent',
      eventId: 'evt_bad_present_npc',
      locationId: 'loc_market_town',
      summary: '模型错误地把在场 NPC 写成字符串。',
      presentNpcIds: 'npc_chen_heng',
      visibility: '在场可知',
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('presentNpcIds 数组');
  });

  it('允许给在场 NPC 写入亲历记忆', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'pushNpcMemory',
      npcId: 'npc_chen_heng',
      npcName: '陈衡',
      source: '亲历',
      value: '陈衡亲眼见到主角在市集门前解围。',
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('允许给事件在场 NPC 写入带 eventId 的亲历记忆', () => {
    const state = applyLuanShiCommand(makeState(), {
      action: 'recordTurnEvent',
      eventId: 'evt_market_rescue',
      locationId: 'loc_market_town',
      summary: '陈衡在场目睹主角救人。',
      presentNpcIds: ['npc_chen_heng'],
      involvedNpcIds: ['npc_chen_heng'],
      visibility: '在场可知',
    });

    const result = validateLuanShiCommand(state, {
      action: 'pushNpcMemory',
      npcId: 'npc_chen_heng',
      npcName: '陈衡',
      source: '亲历',
      eventId: 'evt_market_rescue',
      value: '陈衡亲眼见到主角救下伤者。',
    });

    expect(result.valid).toBe(true);
  });

  it('拒绝给事件未在场 NPC 写入带 eventId 的亲历记忆', () => {
    const base = ensureLuanShiState(makeState());
    const stateWithLiSuPresent = {
      ...base,
      npcs: base.npcs.map((npc) =>
        npc.npcId === 'npc_li_su' ? { ...npc, isPresent: true } : npc,
      ),
    };
    const state = applyLuanShiCommand(stateWithLiSuPresent, {
      action: 'recordTurnEvent',
      eventId: 'evt_market_rescue',
      locationId: 'loc_market_town',
      summary: '陈衡在场目睹主角救人。',
      presentNpcIds: ['npc_chen_heng'],
      involvedNpcIds: ['npc_chen_heng'],
      visibility: '在场可知',
    });

    const result = validateLuanShiCommand(state, {
      action: 'pushNpcMemory',
      npcId: 'npc_li_su',
      npcName: '李肃',
      source: '亲历',
      eventId: 'evt_market_rescue',
      value: '李肃被错误写入亲历记忆。',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('evt_market_rescue');
  });

  it('拒绝 npcId 和 npcName 不匹配的记忆写入', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'pushNpcMemory',
      npcId: 'npc_chen_heng',
      npcName: '李肃',
      source: '亲历',
      value: '错误地把李肃记忆写给陈衡。',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('npcName');
  });

  it('拒绝给不在场 NPC 写入亲历记忆', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'pushNpcMemory',
      npcId: 'npc_li_su',
      npcName: '李肃',
      source: '亲历',
      value: '李肃亲眼见到主角在市镇行动。',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('不在场');
  });

  it('拒绝仅凭最新结构化场景后的正文发言标签写入亲历记忆', () => {
    const transitionRawResponse = JSON.stringify({
      narrativeText: '主角抵达水寨内宅。',
      suggestedActions: [],
      statePatches: [{
        type: 'locationChange',
        reason: '抵达水寨内宅',
        payload: { toLocationId: 'loc_market_town' },
      }],
    });
    const base = makeState();
    const state: RuntimeState = {
      ...base,
      turnLog: [
        {
          turnNumber: 249,
          date: '公元194年05月03日 13:30（未时）',
          playerInput: '前往水寨内宅',
          narrativeText: '主角抵达水寨内宅。',
          statePatchSummary: 'locationChange: 抵达水寨内宅',
          timestamp: '2026-07-18T08:00:00.000Z',
          displayMeta: { rawResponse: transitionRawResponse },
        },
        {
          turnNumber: 251,
          date: '公元194年05月03日 15:00（申时）',
          playerInput: '与李肃交谈',
          narrativeText: '李肃当面应答。',
          fullNarrativeText: '【李肃】\n“此事我亲眼所见。”',
          statePatchSummary: '无状态变更',
          timestamp: '2026-07-18T08:30:00.000Z',
        },
      ],
      npcs: base.npcs!.map((npc) => npc.npcId === 'npc_li_su'
        ? { ...npc, locationId: 'loc_market_town', isPresent: false }
        : npc),
    };

    const result = validateLuanShiCommand(state, {
      action: 'pushNpcMemory',
      npcId: 'npc_li_su',
      npcName: '李肃',
      source: '亲历',
      value: '李肃在水寨内宅当面听见主角的安排。',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('不在场');
  });

  it('允许给同回合结构化事件在场名单中的 NPC 写入亲历记忆', () => {
    const base = makeState();
    const state: RuntimeState = {
      ...base,
      currentPlaceId: 'loc_market_town',
      turnEvents: [{
        eventId: 'event_li_su_present',
        happenedAt: base.currentDate,
        locationId: 'loc_market_town',
        summary: '李肃在市镇当面听见主角的安排。',
        presentNpcIds: ['npc_li_su'],
        involvedNpcIds: ['npc_li_su'],
        visibility: '在场可知',
      }],
      npcs: base.npcs!.map((npc) => npc.npcId === 'npc_li_su'
        ? { ...npc, locationId: 'loc_market_town', isPresent: false }
        : npc),
    };

    const result = validateLuanShiCommand(state, {
      action: 'pushNpcMemory',
      npcId: 'npc_li_su',
      npcName: '李肃',
      source: '亲历',
      value: '李肃在市镇当面听见主角的安排。',
    });

    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('允许给不在场 NPC 写入听闻记忆', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'pushNpcMemory',
      npcId: 'npc_li_su',
      npcName: '李肃',
      source: '听闻',
      value: '李肃从州城来客口中听闻市镇有异动。',
    });

    expect(result.valid).toBe(true);
  });

  it('把 NPC 记忆写入指定 npcId 的 memories 中', () => {
    const state = applyLuanShiCommand(makeState(), {
      action: 'recordTurnEvent',
      eventId: 'evt_test',
      locationId: 'loc_market_town',
      summary: '陈衡在场目睹主角救下伤者。',
      presentNpcIds: ['npc_chen_heng'],
      involvedNpcIds: ['npc_chen_heng'],
      visibility: '在场可知',
    });
    const next = applyLuanShiCommand(state, {
      action: 'pushNpcMemory',
      npcId: 'npc_chen_heng',
      npcName: '陈衡',
      source: '亲历',
      eventId: 'evt_test',
      value: '陈衡亲眼见到主角救下伤者。',
    });

    const chenHeng = next.npcs.find((npc) => npc.npcId === 'npc_chen_heng');
    const liSu = next.npcs.find((npc) => npc.npcId === 'npc_li_su');

    expect(chenHeng?.memories).toHaveLength(1);
    expect(chenHeng?.memories[0]).toMatchObject({
      eventId: 'evt_test',
      source: '亲历',
      content: '陈衡亲眼见到主角救下伤者。',
      createdAt: '乱世元年2月',
    });
    expect(liSu?.memories).toEqual([]);
  });

  it('命令非法时不改变原状态', () => {
    const state = makeState();
    const next = applyLuanShiCommand(state, {
      action: 'pushNpcMemory',
      npcId: 'npc_li_su',
      npcName: '李肃',
      source: '亲历',
      value: '李肃不在场却被写入亲历记忆。',
    });

    expect(next).toEqual(state);
  });

  it('允许记录包含在场 NPC 的回合事件', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'recordTurnEvent',
      eventId: 'evt_market_rescue',
      locationId: 'loc_market_town',
      summary: '主角在市镇门前救下伤者，陈衡在场目睹。',
      presentNpcIds: ['npc_chen_heng'],
      involvedNpcIds: ['npc_chen_heng'],
      visibility: '在场可知',
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('拒绝记录引用未知 NPC 的回合事件', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'recordTurnEvent',
      eventId: 'evt_bad',
      locationId: 'loc_market_town',
      summary: '事件错误地引用了不存在的人物。',
      presentNpcIds: ['npc_missing'],
      involvedNpcIds: [],
      visibility: '在场可知',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('npc_missing');
  });

  it('把回合事件追加到 turnEvents 中', () => {
    const state = makeState();
    const next = applyLuanShiCommand(state, {
      action: 'recordTurnEvent',
      eventId: 'evt_market_rescue',
      locationId: 'loc_market_town',
      summary: '主角在市镇门前救下伤者，陈衡在场目睹。',
      presentNpcIds: ['npc_chen_heng'],
      involvedNpcIds: ['npc_chen_heng'],
      visibility: '在场可知',
    });

    expect(next.turnEvents).toHaveLength(1);
    expect(next.turnEvents[0]).toMatchObject({
      eventId: 'evt_market_rescue',
      happenedAt: '乱世元年2月',
      locationId: 'loc_market_town',
      summary: '主角在市镇门前救下伤者，陈衡在场目睹。',
      presentNpcIds: ['npc_chen_heng'],
      involvedNpcIds: ['npc_chen_heng'],
      visibility: '在场可知',
    });
  });
  it('允许结构化写回主角身份档案', () => {
    const next = applyLuanShiCommand(makeState(), {
      action: 'updateCharacterIdentity',
      characterId: 'player',
      characterName: '主角',
      commonAddress: '刘军侯',
      factionName: '汉廷北军',
      allegianceTarget: '何进旧部',
      currentIdentity: '军中下级将校',
      currentIdentityDescription: '统带百余残兵的基层军官，名义上仍属洛阳北军残部。',
      militaryTitle: '军侯',
      identitySummary: '主角由泛称军中将校被细化为洛阳乱局中的北军军侯。',
    } as any);

    expect(next.player.commonAddress).toBe('刘军侯');
    expect(next.player.factionName).toBe('汉廷北军');
    expect(next.player.allegianceTarget).toBe('何进旧部');
    expect(next.player.currentIdentity).toBe('军中下级将校');
    expect(next.player.currentIdentityDescription).toContain('基层军官');
    expect(next.player.militaryTitle).toBe('军侯');
    expect(next.player.identitySummary).toContain('北军军侯');
  });

  it('允许 characterType=player 的身份写回省略 characterId', () => {
    const command = {
      action: 'updateCharacterIdentity',
      characterType: 'player',
      characterName: '主角',
      currentIdentity: '北军别部司马',
      militaryTitle: '别部司马',
    } as any;

    const validation = validateLuanShiCommand(makeState(), command);
    expect(validation.valid).toBe(true);

    const next = applyLuanShiCommand(makeState(), command);
    expect(next.player.currentIdentity).toBe('北军别部司马');
    expect(next.player.militaryTitle).toBe('别部司马');
  });

  it('允许结构化写回 NPC 身份档案并保留人物归属', () => {
    const next = applyLuanShiCommand(makeState(), {
      action: 'updateCharacterIdentity',
      characterId: 'npc_chen_heng',
      characterName: '陈衡',
      courtesyName: '伯衡',
      aliases: ['市井豪侠'],
      commonAddress: '陈首领',
      birthOrigin: '郡县土族旁支',
      currentIdentity: '游侠首领',
      factionName: '市镇游侠',
      allegianceTarget: '自身',
      identitySummary: '陈衡是市镇一带游侠的首领，暂未正式投靠任何势力。',
    } as any);

    const chenHeng = next.npcs.find((npc) => npc.npcId === 'npc_chen_heng');
    const liSu = next.npcs.find((npc) => npc.npcId === 'npc_li_su');

    expect(chenHeng).toMatchObject({
      courtesyName: '伯衡',
      commonAddress: '陈首领',
      birthOrigin: '郡县土族旁支',
      currentIdentity: '游侠首领',
      factionName: '市镇游侠',
      allegianceTarget: '自身',
    });
    expect(chenHeng?.aliases).toEqual(['市井豪侠']);
    expect(liSu?.commonAddress).toBeUndefined();
  });

  it('拒绝人物身份写回目标姓名不匹配', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updateCharacterIdentity',
      characterId: 'npc_chen_heng',
      characterName: '李肃',
      currentIdentity: '游侠首领',
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('characterName');
  });

  it('拒绝没有任何身份字段的人物身份写回', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updateCharacterIdentity',
      characterId: 'player',
      characterName: '主角',
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('身份字段');
  });
  it('允许结构化写回主角初始行装', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      personalMoney: 380,
      equipment: [
        {
          id: 'eq_court_sword',
          slot: 'weapon',
          name: '佩剑',
          quality: '精良',
          description: '朝中官员随身佩剑，重礼制与威慑。',
        },
      ],
      inventory: [{ id: 'item_seal_bag', name: '符传囊', quantity: 1, description: '出入官署时可用。' }],
      summary: '按朝中重臣身份生成的官员行装。',
    } as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('允许个人钱财 delta 收支，并拒绝绝对值混用和透支', () => {
    const state = ensureLuanShiState({
      ...makeState(),
      player: {
        ...makeState().player,
        personalMoney: 100,
      },
    });

    expect(validateLuanShiCommand(state, {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      personalMoneyDelta: -40,
    } as any).valid).toBe(true);
    expect(validateLuanShiCommand(state, {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      personalMoneyDelta: 25,
    } as any).valid).toBe(true);

    const mixed = validateLuanShiCommand(state, {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      personalMoney: 60,
      personalMoneyDelta: -40,
    } as any);
    const underflow = validateLuanShiCommand(state, {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      personalMoneyDelta: -101,
    } as any);

    expect(mixed.valid).toBe(false);
    expect(mixed.errors.join('\n')).toContain('不能同时');
    expect(underflow.valid).toBe(false);
    expect(underflow.errors.join('\n')).toContain('余额不足');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    '拒绝非 finite 的个人钱财 delta：%s',
    (personalMoneyDelta) => {
      const result = validateLuanShiCommand(makeState(), {
        action: 'updatePlayerLoadout',
        characterId: 'player',
        personalMoneyDelta,
      } as any);

      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('personalMoneyDelta');
    },
  );

  it('允许 LLM 写入自由品级和可装备背包物品', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      equipment: [
        {
          id: 'eq_imperial_blade',
          slot: 'weapon',
          name: '御赐环首刀',
          quality: '御赐军制',
          description: '刀身有官造铭文，适合军中身份展示。',
        },
      ],
      inventory: [
        {
          id: 'eq_spare_bow',
          name: '备用角弓',
          quantity: 1,
          category: 'equipment',
          equipSlot: 'weapon',
          quality: '军中精造',
          description: '可在需要远射时替换当前武器。',
        },
      ],
    } as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('允许结构化局部更新 NPC 装备和携物', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updateNpcLoadout',
      npcId: 'npc_chen_heng',
      npcName: '陈衡',
      equipmentChanges: [
        {
          action: 'upsert',
          item: {
            id: 'eq_chen_heng_sabre',
            slot: 'weapon',
            name: '环首刀',
            quality: '军中旧制',
            description: '陈衡随身携带的旧刀，近身格斗时可靠。',
            promptHint: '陈衡参与近战或威慑判定时，可作为小幅优势。',
            checkHooks: [{ scope: 'personalCombat.melee', modifier: 6, note: '旧刀顺手。' }],
          },
        },
      ],
      inventoryChanges: [
        {
          action: 'upsert',
          item: {
            id: 'item_chen_heng_pass',
            name: '营门木符',
            quantity: 1,
            category: 'token',
            description: '可证明陈衡有营门出入资格。',
            keyItem: true,
          },
        },
      ],
      summary: '陈衡的刀与营门木符进入人物志行装。',
      updatedAt: '公元189年09月01日 09:30（巳时）',
      source: '亲历',
    } as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('拒绝写入不存在 NPC 的行装', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updateNpcLoadout',
      npcId: 'npc_missing',
      npcName: '不存在的人',
      inventoryChanges: [
        { action: 'upsert', item: { id: 'item_missing', name: '无主物', quantity: 1 } },
      ],
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('updateNpcLoadout.npcId 未匹配已有 NPC');
  });

  it('拒绝 NPC 携物中的错误可选字段类型', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updateNpcLoadout',
      npcId: 'npc_chen_heng',
      npcName: '陈衡',
      inventory: [{
        id: 'item_bad_optional_fields',
        name: '错误物品',
        quantity: 1,
        description: 42,
        keyItem: 'yes',
      }],
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('updateNpcLoadout.inventory[0].description 必须是字符串');
    expect(result.errors.join('\n')).toContain('updateNpcLoadout.inventory[0].keyItem 必须是布尔值');
  });

  it('报告 NPC 行装局部 upsert 的完整 item 错误路径', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updateNpcLoadout',
      npcId: 'npc_chen_heng',
      npcName: '陈衡',
      equipmentChanges: [{
        action: 'upsert',
        item: {
          id: 'eq_bad_description',
          slot: 'weapon',
          name: '坏装备',
          quality: '旧物',
          description: 42,
        },
      }],
      inventoryChanges: [{
        action: 'upsert',
        item: {
          id: 'item_bad_description',
          name: '坏携物',
          quantity: 1,
          description: 42,
        },
      }],
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('updateNpcLoadout.equipmentChanges[0].item.description 不能为空。');
    expect(result.errors).toContain('updateNpcLoadout.inventoryChanges[0].item.description 必须是字符串。');
  });

  it('保留玩家行装局部 upsert 的完整 item 错误路径', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      equipmentChanges: [{
        action: 'upsert',
        item: {
          id: 'eq_bad_description',
          slot: 'weapon',
          name: '坏装备',
          quality: '旧物',
          description: 42,
        },
      }],
      inventoryChanges: [{
        action: 'upsert',
        item: {
          id: 'item_bad_description',
          name: '坏携物',
          quantity: 1,
          description: 42,
        },
      }],
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('updatePlayerLoadout.equipmentChanges[0].item.description 不能为空。');
    expect(result.errors).toContain('updatePlayerLoadout.inventoryChanges[0].item.description 必须是字符串。');
  });

  it('拒绝 NPC 行装使用玩家专属的从背包装备动作', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updateNpcLoadout',
      npcId: 'npc_chen_heng',
      npcName: '陈衡',
      equipmentChanges: [{ action: 'equipFromInventory', itemId: 'eq_hidden_sword', slot: 'weapon' }],
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('updateNpcLoadout.equipmentChanges[0].action 非法');
  });

  it('把 NPC 行装局部写回人物志且不覆盖 NPC 其他字段', () => {
    const next = applyLuanShiCommand(makeState(), {
      action: 'updateNpcLoadout',
      npcId: 'npc_chen_heng',
      npcName: '陈衡',
      equipmentChanges: [
        {
          action: 'upsert',
          item: {
            id: 'eq_chen_heng_sabre',
            slot: 'weapon',
            name: '环首刀',
            quality: '军中旧制',
            description: '陈衡随身携带的旧刀。',
          },
        },
      ],
      inventoryChanges: [
        {
          action: 'upsert',
          item: { id: 'item_chen_heng_pass', name: '营门木符', quantity: 1, category: 'token', keyItem: true },
        },
      ],
      summary: '陈衡行装补全。',
    } as any);

    const npc = next.npcs.find((entry) => entry.npcId === 'npc_chen_heng');
    expect(npc).toMatchObject({
      name: '陈衡',
      relationToPlayer: '初识。',
    });
    expect(npc?.equipment).toEqual([expect.objectContaining({ id: 'eq_chen_heng_sabre', slot: 'weapon' })]);
    expect(npc?.inventory).toEqual([expect.objectContaining({ id: 'item_chen_heng_pass', quantity: 1 })]);
  });

  it('NPC 行装写回会按校验语义修剪 npcId 后匹配目标', () => {
    const command = {
      action: 'updateNpcLoadout',
      npcId: ' npc_chen_heng ',
      npcName: '陈衡',
      inventoryChanges: [
        {
          action: 'upsert',
          item: { id: 'item_chen_heng_pass', name: '营门木符', quantity: 1, category: 'token', keyItem: true },
        },
      ],
      summary: '陈衡收下木符。',
    } as any;

    expect(validateLuanShiCommand(makeState(), command).valid).toBe(true);

    const next = applyLuanShiCommand(makeState(), command);
    const npc = next.npcs.find((entry) => entry.npcId === 'npc_chen_heng');

    expect(npc?.inventory).toEqual([expect.objectContaining({ id: 'item_chen_heng_pass', quantity: 1 })]);
  });

  it('NPC 丢失物品时只扣对应数量并保留其他携物', () => {
    const base = ensureLuanShiState(makeState());
    const state = ensureLuanShiState({
      ...base,
      npcs: base.npcs.map((npc) => npc.npcId === 'npc_chen_heng'
        ? {
            ...npc,
            inventory: [
              { id: 'item_arrow', name: '羽箭', quantity: 12, category: 'supply' },
              { id: 'item_pass', name: '营门木符', quantity: 1, category: 'token', keyItem: true },
            ],
          }
        : npc),
    });

    const next = applyLuanShiCommand(state, {
      action: 'updateNpcLoadout',
      npcId: 'npc_chen_heng',
      npcName: '陈衡',
      inventoryChanges: [
        { action: 'remove', itemId: 'item_arrow', quantity: 5 },
        { action: 'remove', itemId: 'item_pass' },
      ],
      summary: '陈衡消耗羽箭并交出木符。',
    } as any);

    const npc = next.npcs.find((entry) => entry.npcId === 'npc_chen_heng');
    expect(npc?.inventory).toEqual([expect.objectContaining({ id: 'item_arrow', quantity: 7 })]);
  });

  it('NPC 卸下装备时装备移入该 NPC 携物', () => {
    const base = ensureLuanShiState(makeState());
    const state = ensureLuanShiState({
      ...base,
      npcs: base.npcs.map((npc) => npc.npcId === 'npc_chen_heng'
        ? {
            ...npc,
            equipment: [
              { id: 'eq_sabre', slot: 'weapon', name: '环首刀', quality: '军中旧制', description: '陈衡旧刀。' },
            ],
            inventory: [{ id: 'item_dry_food', name: '干粮', quantity: 2, category: 'supply' }],
          }
        : npc),
    });

    const next = applyLuanShiCommand(state, {
      action: 'updateNpcLoadout',
      npcId: 'npc_chen_heng',
      npcName: '陈衡',
      equipmentChanges: [{ action: 'unequip', equipmentId: 'eq_sabre' }],
      summary: '陈衡将刀收起。',
    } as any);

    const npc = next.npcs.find((entry) => entry.npcId === 'npc_chen_heng');
    expect(npc?.equipment).toEqual([]);
    expect(npc?.inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'item_dry_food', quantity: 2 }),
      expect.objectContaining({ id: 'eq_sabre', quantity: 1, equipSlot: 'weapon' }),
    ]));
  });

  it('把主角行装写入 player 与世界增量', () => {
    const next = applyLuanShiCommand(makeState(), {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      personalMoney: 380,
      equipment: [
        {
          id: 'eq_court_sword',
          slot: 'weapon',
          name: '佩剑',
          quality: '精良',
          description: '朝中官员随身佩剑，重礼制与威慑。',
        },
      ],
      inventory: [{ id: 'item_seal_bag', name: '符传囊', quantity: 1, description: '出入官署时可用。' }],
      summary: '按朝中重臣身份生成的官员行装。',
    } as any, { openingInitialization: true });

    expect(next.player.personalMoney).toBe(380);
    expect(next.player.equipment?.[0]).toMatchObject({ name: '佩剑', slot: 'weapon' });
    expect(next.player.inventory?.[0]).toMatchObject({ name: '符传囊', quantity: 1 });
    expect(next.playerResources).not.toHaveProperty('钱财');
    expect(next.resources.money).toBe(0);
    expect(next.worldStateDelta.openingLoadoutSummary).toBe('按朝中重臣身份生成的官员行装。');
  });

  it('不会把主角个人钱财镜像成势力或领地资源', () => {
    const next = applyLuanShiCommand(makeState(), {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      personalMoney: 5000,
      summary: '开局随身积蓄，不是府库或势力账本。',
    } as any, { openingInitialization: true });

    expect(next.player.personalMoney).toBe(5000);
    expect(next.resources.money).toBe(0);
    expect(next.playerResources).not.toHaveProperty('钱财');
    expect(next.worldStateDelta.openingPersonalMoney).toBe(5000);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    '真开局可替换非 finite openingPersonalMoney: %s',
    (openingPersonalMoney) => {
      const base = ensureLuanShiState({
        ...makeState(),
        worldStateDelta: {
          ...makeState().worldStateDelta,
          openingPersonalMoney,
        },
      });

      const next = applyLuanShiCommand(base, {
        action: 'updatePlayerLoadout',
        characterId: 'player',
        personalMoney: 100,
      } as any, { openingInitialization: true });

      expect(next.player.personalMoney).toBe(100);
      expect(next.worldStateDelta.openingPersonalMoney).toBe(100);
    },
  );

  it('普通购买更新个人钱财但保留开局钱财元数据', () => {
    const base = ensureLuanShiState({
      ...makeState(),
      player: {
        ...makeState().player,
        personalMoney: 100,
      },
      worldStateDelta: {
        ...makeState().worldStateDelta,
        openingPersonalMoney: 100,
      },
      turnLog: [{ turnNumber: 1 }] as RuntimeState['turnLog'],
    });

    const next = applyLuanShiCommand(base, {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      personalMoneyDelta: -50,
      summary: '购买物资花费五十。',
    } as any);

    expect(next.player.personalMoney).toBe(50);
    expect(next.playerResources).not.toHaveProperty('钱财');
    expect(next.playerResources).not.toHaveProperty('money');
    expect(next.resources.money).toBe(0);
    expect(next.worldStateDelta.openingPersonalMoney).toBe(100);
  });

  it('普通领取个人钱财只增加 player.personalMoney', () => {
    const base = ensureLuanShiState({
      ...makeState(),
      player: {
        ...makeState().player,
        personalMoney: 100,
      },
    });

    const next = applyLuanShiCommand(base, {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      personalMoneyDelta: 30,
      summary: '领取个人酬金三十。',
    } as any);

    expect(next.player.personalMoney).toBe(130);
    expect(next.playerResources).not.toHaveProperty('钱财');
    expect(next.playerResources).not.toHaveProperty('money');
    expect(next.resources.money).toBe(0);
  });

  it('正常税收和粮饷仍通过资源账本写入', () => {
    const base = makeState();
    const next = applyLuanShiCommand(base, {
      action: 'updateResourceLedger',
      money: 7200,
      grain: 18000,
      arms: 350,
      playerResources: {
        粮饷: 2400,
      },
      summary: '九月结算后，实际征收到钱粮军械。',
    });

    expect(next.resources).toMatchObject({
      money: 7200,
      grain: 18000,
      arms: 350,
    });
    expect(next.playerResources).toMatchObject({
      粮饷: 2400,
    });
    expect(next.player.personalMoney).toBe(base.player.personalMoney);
    expect(next.worldStateDelta.openingPersonalMoney).toBe(base.worldStateDelta.openingPersonalMoney);
  });

  it('资源账本更新会清理旧存档中的个人钱财 shadow', () => {
    const base = ensureLuanShiState({
      ...makeState(),
      playerResources: {
        钱财: 36,
        money: 44,
        粮草: 50,
      },
    });
    const next = applyLuanShiCommand(base, {
      action: 'updateResourceLedger',
      playerResources: {
        粮饷: 240,
      },
      summary: '只更新非个人资源账本。',
    });

    expect(next.playerResources).toEqual({
      粮草: 50,
      粮饷: 240,
    });
    expect(next.player.personalMoney).toBe(base.player.personalMoney);
    expect(next.resources).toEqual(base.resources);
  });

  it('用局部装备变更从背包装备物品且不覆盖其他物品', () => {
    const state = ensureLuanShiState({
      ...makeState(),
      player: {
        ...makeState().player,
        equipment: [
          {
            id: 'eq_old_sword',
            slot: 'weapon',
            name: '旧短刀',
            quality: '普通',
            description: '旧制短刀。',
          },
        ],
        inventory: [
          {
            id: 'eq_old_sword',
            name: '旧短刀',
            quantity: 1,
            category: 'equipment',
            equipSlot: 'weapon',
            quality: '普通',
            description: '旧制短刀。',
          },
          {
            id: 'eq_court_sword',
            name: '佩剑',
            quantity: 1,
            category: 'equipment',
            equipSlot: 'weapon',
            quality: '御赐军制',
            description: '朝中官员随身佩剑。',
          },
          { id: 'item_dry_food', name: '干粮', quantity: 3, description: '三日口粮。' },
        ],
      },
    });

    const command = {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      equipmentChanges: [{ action: 'equipFromInventory', itemId: 'eq_court_sword', slot: 'weapon' }],
    } as any;

    expect(validateLuanShiCommand(state, command).valid).toBe(true);

    const next = applyLuanShiCommand(state, command);

    expect(next.player.equipment?.find((item) => item.slot === 'weapon')).toMatchObject({
      id: 'eq_court_sword',
      name: '佩剑',
      quality: '御赐军制',
    });
    expect(next.player.inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'item_dry_food', quantity: 3 }),
      expect.objectContaining({ id: 'eq_old_sword', quantity: 1, equipSlot: 'weapon' }),
      expect.objectContaining({ id: 'eq_court_sword', quantity: 1, equipSlot: 'weapon' }),
    ]));
  });

  it('宝物局部换装只替换指定槽位并保留另外两件宝物', () => {
    const state = ensureLuanShiState({
      ...makeState(),
      player: {
        ...makeState().player,
        equipment: [
          { id: 'tr_1', slot: 'treasure', name: '北军符牌', quality: '普通', description: '营中符牌。' },
          { id: 'tr_2', slot: 'treasure', name: '旧兵书', quality: '残卷', description: '残缺兵书。' },
          { id: 'tr_3', slot: 'treasure', name: '家传玉佩', quality: '家传', description: '旧玉佩。' },
        ],
        inventory: [
          {
            id: 'tr_2',
            name: '旧兵书',
            quantity: 1,
            category: 'equipment',
            equipSlot: 'treasure',
            quality: '残卷',
            description: '残缺兵书。',
          },
          {
            id: 'tr_new',
            name: '军侯印信',
            quantity: 1,
            category: 'equipment',
            equipSlot: 'treasure',
            quality: '军府信物',
            description: '可证明军侯身份的印信。',
          },
          { id: 'item_dry_food', name: '干粮', quantity: 3, description: '三日口粮。' },
        ],
      },
    });

    const next = applyLuanShiCommand(state, {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      equipmentChanges: [{ action: 'equipFromInventory', itemId: 'tr_new', slot: 'treasure', treasureIndex: 1 }],
    } as any);

    expect(next.player.equipment?.filter((item) => item.slot === 'treasure').map((item) => item.id)).toEqual([
      'tr_1',
      'tr_new',
      'tr_3',
    ]);
    expect(next.player.inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'tr_2', equipSlot: 'treasure', quantity: 1 }),
      expect.objectContaining({ id: 'tr_new', equipSlot: 'treasure', quantity: 1 }),
      expect.objectContaining({ id: 'item_dry_food', quantity: 3 }),
    ]));
  });

  it('拒绝空的主角行装写回', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updatePlayerLoadout',
      characterId: 'player',
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('行装');
  });
  it('允许 LLM 结构化新增带六维和特质的 NPC 档案', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertNpcProfile',
      npcId: 'npc_gate_guard',
      name: '门候',
      courtesyName: '',
      artName: '',
      aliases: ['守门军士'],
      commonAddress: '门候',
      sex: '男',
      age: 36,
      role: '洛阳城门守军',
      currentIdentity: '城门门候',
      currentIdentityDescription: '在洛阳城门值守的基层军官。',
      locationId: 'loc_market_town',
      isPresent: true,
      isFocused: true,
      summary: '守在城门处的老成军士。',
      appearance: '甲衣半旧，胡须粗硬，眼神警惕。',
      personality: '谨慎务实，不愿轻易惹祸。',
      motivation: '守住差事，避开城中清算。',
      relationToPlayer: '初次接触，因主角军中身份略有顾忌。',
      contactLevel: 8,
      recentAttitude: '戒备但愿意听令',
      abilityScores: { 武力: 55, 统率: 42, 智力: 45, 政治: 30, 魅力: 36, 机运: 48 },
      traits: [
        {
          id: 'trait_gate_guard_wary',
          label: '城门老卒',
          description: '熟悉城门盘查与兵卒暗语。',
          source: 'event',
          promptHint: '城门盘查、辨认军令和观察可疑行人时更稳。',
          checkHooks: [{ scope: '城门盘查', modifier: 8, note: '熟悉守门规矩。' }],
        },
      ],
      effects: [],
      equipment: [],
      inventory: [],
    } as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('只允许按当前库存中的稳定 itemId 消耗或移除物品', () => {
    const state = ensureLuanShiState({
      ...makeState(),
      player: {
        ...makeState().player,
        inventory: [{
          id: 'item_supply_order',
          name: '粮草提取手令',
          quantity: 1,
          category: 'document',
          description: '提取粮草时交回。',
        }],
      },
    });

    const validCommand = {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      inventoryChanges: [{ action: 'remove', itemId: 'item_supply_order', quantity: 1 }],
    } as any;
    const missingItem = validateLuanShiCommand(state, {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      inventoryChanges: [{ action: 'setQuantity', itemId: 'item_hallucinated', quantity: 0 }],
    } as any);
    const excessiveQuantity = validateLuanShiCommand(state, {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      inventoryChanges: [{ action: 'remove', itemId: 'item_supply_order', quantity: 2 }],
    } as any);

    expect(validateLuanShiCommand(state, validCommand)).toEqual({ valid: true, errors: [], warnings: [] });
    expect(applyLuanShiCommand(state, validCommand).player.inventory).toEqual([]);
    expect(missingItem.valid).toBe(false);
    expect(missingItem.errors.join('\n')).toContain('item_hallucinated');
    expect(missingItem.errors.join('\n')).toContain('当前库存');
    expect(excessiveQuantity.valid).toBe(false);
    expect(excessiveQuantity.errors.join('\n')).toContain('现有数量 1');
  });

  it('允许同一批先新增再移除，并以完整 inventory 作为局部变更基线', () => {
    const state = makeState();
    const result = validateLuanShiCommand(state, {
      action: 'updatePlayerLoadout',
      characterId: 'player',
      inventory: [{
        id: 'item_temporary_token',
        name: '临时凭证',
        quantity: 1,
        category: 'token',
      }],
      inventoryChanges: [{ action: 'setQuantity', itemId: 'item_temporary_token', quantity: 0 }],
    } as any);

    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('拒绝把主角本人作为 NPC 档案写入', () => {
    const baseState = makeState();
    const state = {
      ...baseState,
      player: {
        ...baseState.player,
        name: '刘峙',
        courtesyName: '临渊',
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
            description: '主角官印。',
          },
        ],
      },
    } as RuntimeState;

    const result = validateLuanShiCommand(state, makeNpcProfileUpsertCommand({
      npcId: 'npc_liuzhi',
      name: '刘峙',
      courtesyName: '临渊',
      age: 24,
      role: '建威校尉',
      currentIdentity: '建威校尉',
      militaryTitle: '建威校尉',
      relationToPlayer: '本人',
      equipment: [
        {
          id: 'eq_clone_bailian_sword',
          slot: 'weapon',
          name: '百炼环首剑',
          quality: '精良',
          description: '主角佩剑。',
        },
      ],
      inventory: [
        {
          id: 'item_clone_jianwei_seal',
          name: '建威校尉印',
          quantity: 1,
          category: 'token',
          description: '主角官印。',
        },
      ],
    }) as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('不得把主角本人创建或更新为 NPC 档案');
  });

  it('允许同名但身份证据明确不同的 NPC 档案写入', () => {
    const baseState = makeState();
    const state = {
      ...baseState,
      player: {
        ...baseState.player,
        name: '刘峙',
        courtesyName: '临渊',
        currentIdentity: '建威校尉',
      },
    } as RuntimeState;

    const result = validateLuanShiCommand(state, makeNpcProfileUpsertCommand({
      npcId: 'npc_liuzhi_namesake',
      name: '刘峙',
      courtesyName: '伯山',
      age: 36,
      role: '同名宗族旁支',
      currentIdentity: '汝南逃难士人',
      relationToPlayer: '同名族人，正寻求投靠。',
      summary: '与主角同名的宗族旁支，另有明确履历。',
    }) as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('把新增 NPC 档案写入 npcs 并保留六维、特质和空记忆', () => {
    const next = applyLuanShiCommand(makeState(), {
      action: 'upsertNpcProfile',
      npcId: 'npc_gate_guard',
      name: '门候',
      sex: '男',
      age: 36,
      role: '洛阳城门守军',
      currentIdentity: '城门门候',
      locationId: 'loc_market_town',
      isPresent: true,
      isFocused: true,
      summary: '守在城门处的老成军士。',
      appearance: '甲衣半旧，胡须粗硬，眼神警惕。',
      personality: '谨慎务实，不愿轻易惹祸。',
      motivation: '守住差事，避开城中清算。',
      relationToPlayer: '初次接触，因主角军中身份略有顾忌。',
      contactLevel: 8,
      recentAttitude: '戒备但愿意听令',
      abilityScores: { 武力: 55, 统率: 42, 智力: 45, 政治: 30, 魅力: 36, 机运: 48 },
      traits: [
        {
          id: 'trait_gate_guard_wary',
          label: '城门老卒',
          description: '熟悉城门盘查与兵卒暗语。',
          source: 'event',
          promptHint: '城门盘查、辨认军令和观察可疑行人时更稳。',
        },
      ],
    } as any);

    const gateGuard = next.npcs.find((npc) => npc.npcId === 'npc_gate_guard');

    expect(gateGuard).toMatchObject({
      name: '门候',
      currentIdentity: '城门门候',
      abilityScores: { 武力: 55, 统率: 42, 智力: 45, 政治: 30, 魅力: 36, 机运: 48 },
    });
    expect(gateGuard?.traits?.[0]).toMatchObject({ label: '城门老卒' });
    expect(gateGuard?.memories).toEqual([]);
  });

  it('拒绝缺失 age 的 NPC 档案写回', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertNpcProfile',
      npcId: 'npc_gate_guard',
      name: '门候',
      sex: '男',
      role: '洛阳城门守军',
      currentIdentity: '城门门候',
      locationId: 'loc_market_town',
      isPresent: true,
      isFocused: true,
      summary: '守在城门处的老成军士。',
      appearance: '甲衣半旧，胡须粗硬，眼神警惕。',
      personality: '谨慎务实，不愿轻易惹祸。',
      motivation: '守住差事，避开城中清算。',
      relationToPlayer: '初次接触，因主角军中身份略有顾忌。',
      contactLevel: 8,
      recentAttitude: '戒备但愿意听令',
      abilityScores: { 武力: 55, 统率: 42, 智力: 45, 政治: 30, 魅力: 36, 机运: 48 },
      traits: [
        {
          id: 'trait_gate_guard_wary',
          label: '城门老卒',
          description: '熟悉城门盘查与兵卒暗语。',
          source: 'event',
        },
      ],
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('upsertNpcProfile.age 必须是大于 0 的整数。');
  });

  it('records the game date that anchors an upserted NPC age', () => {
    const next = applyLuanShiCommand(
      {
        ...makeState(),
        currentDate: '公元189年09月01日 08:00（辰时）',
      },
      {
        action: 'upsertNpcProfile',
        npcId: 'npc_gate_guard',
        name: '门候',
        sex: '男',
        age: 36,
        role: '洛阳城门守军',
        currentIdentity: '城门门候',
        locationId: 'loc_market_town',
        isPresent: true,
        isFocused: true,
        summary: '守在城门处的老成军士。',
        appearance: '甲衣半旧，胡须粗硬，眼神警惕。',
        personality: '谨慎务实，不愿轻易惹祸。',
        motivation: '守住差事，避开城中清算。',
        relationToPlayer: '初次接触，因主角军中身份略有顾忌。',
        contactLevel: 8,
        recentAttitude: '戒备但愿意听令',
        abilityScores: { 武力: 55, 统率: 42, 智力: 45, 政治: 30, 魅力: 36, 机运: 48 },
        traits: [
          {
            id: 'trait_gate_guard_wary',
            label: '城门老卒',
            description: '熟悉城门盘查与兵卒暗语。',
            source: 'event',
          },
        ],
      } as any,
    );

    const gateGuard = next.npcs.find((npc) => npc.npcId === 'npc_gate_guard') as any;
    expect(gateGuard?.ageKnownAtDate).toBe('公元189年09月01日 08:00（辰时）');
  });

  it('更新已有 NPC 档案时保留原有记忆', () => {
    const remembered = applyLuanShiCommand(makeState(), {
      action: 'pushNpcMemory',
      npcId: 'npc_chen_heng',
      npcName: '陈衡',
      source: '亲历',
      value: '陈衡亲眼见到主角镇住市集混乱。',
    });

    const next = applyLuanShiCommand(remembered, {
      action: 'upsertNpcProfile',
      npcId: 'npc_chen_heng',
      name: '陈衡',
      sex: '男',
      age: 31,
      role: '游侠首领',
      currentIdentity: '市镇游侠首领',
      locationId: 'loc_market_town',
      isPresent: true,
      isFocused: true,
      summary: '市镇一带游侠的首领。',
      appearance: '目光锐利，腰间佩短刃。',
      personality: '豪爽直接，但也会审时度势。',
      motivation: '借乱世为自己和部众寻出路。',
      relationToPlayer: '见过主角压住混乱，开始留意。',
      contactLevel: 18,
      recentAttitude: '试探中带着几分认可',
      abilityScores: { 武力: 68, 统率: 52, 智力: 55, 政治: 35, 魅力: 61, 机运: 54 },
      traits: [
        {
          id: 'trait_local_brave',
          label: '市井豪侠',
          description: '熟悉地方人情与游侠门路。',
          source: 'event',
          promptHint: '市井交涉、拉拢游侠、处理地方纷争时更活络。',
        },
      ],
    } as any);

    const chenHeng = next.npcs.find((npc) => npc.npcId === 'npc_chen_heng');

    expect(chenHeng?.currentIdentity).toBe('市镇游侠首领');
    expect(chenHeng?.abilityScores?.武力).toBe(68);
    expect(chenHeng?.memories).toHaveLength(1);
    expect(chenHeng?.memories[0].content).toContain('镇住市集混乱');
  });

  it('拒绝缺少完整六维的 NPC 建档写回', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertNpcProfile',
      npcId: 'npc_incomplete',
      name: '缺项人物',
      sex: '男',
      age: 20,
      role: '路人',
      currentIdentity: '路人',
      locationId: 'loc_market_town',
      isPresent: true,
      isFocused: false,
      summary: '缺少六维。',
      appearance: '普通。',
      personality: '普通。',
      motivation: '普通。',
      relationToPlayer: '陌生。',
      contactLevel: 0,
      recentAttitude: '陌生',
      abilityScores: { 武力: 50, 统率: 50, 智力: 50, 政治: 50, 魅力: 50 },
      traits: [{ id: 'trait_plain', label: '寻常人', description: '没有明显特长。', source: 'event' }],
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('机运');
  });
  it('allows opening writeback to store player appearance and personality as stable profile anchors', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updateCharacterIdentity',
      characterId: 'player',
      characterName: '主角',
      appearance: 'Lean officer with dust-stained armor and watchful eyes.',
      personality: 'Cautious, observant, and unwilling to abandon subordinates.',
    } as any);

    expect(result.valid).toBe(true);

    const next = applyLuanShiCommand(makeState(), {
      action: 'updateCharacterIdentity',
      characterId: 'player',
      characterName: '主角',
      appearance: 'Lean officer with dust-stained armor and watchful eyes.',
      personality: 'Cautious, observant, and unwilling to abandon subordinates.',
    } as any);

    expect(next.player.appearance).toBe('Lean officer with dust-stained armor and watchful eyes.');
    expect(next.player.personality).toBe('Cautious, observant, and unwilling to abandon subordinates.');
  });

  it('allows true opening to write back judged player trait rarity', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updatePlayerTraits',
      characterId: 'player',
      characterName: '主角',
      traits: [
        {
          id: 'trait_custom_night_reader',
          label: 'Night Reader',
          description: 'Often reads military notes at night and catches hidden details.',
          source: 'custom',
          rarity: 'blue',
          promptHint: 'Use this as a stronger clue-reading and quiet-observation trait, not as a direct stat bonus.',
          checkHooks: [{ scope: 'reading hidden intent', modifier: 8, note: 'Good at noticing small textual clues.' }],
        },
      ],
      summary: 'Opening AI judged the custom trait as blue.',
    } as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('writes judged player traits into player archive and opening context', () => {
    const next = applyLuanShiCommand(makeState(), {
      action: 'updatePlayerTraits',
      characterId: 'player',
      traits: [
        {
          id: 'trait_custom_night_reader',
          label: 'Night Reader',
          description: 'Often reads military notes at night and catches hidden details.',
          source: 'custom',
          rarity: 'blue',
          promptHint: 'Use this as a stronger clue-reading and quiet-observation trait, not as a direct stat bonus.',
        },
      ],
      summary: 'Opening AI judged the custom trait as blue.',
    } as any);

    expect(next.player.traits?.[0]).toMatchObject({
      id: 'trait_custom_night_reader',
      label: 'Night Reader',
      rarity: 'blue',
    });
    expect(next.worldStateDelta.openingTraits).toEqual(['Night Reader']);
    expect(next.worldStateDelta.openingTraitDetails).toEqual([
      expect.objectContaining({
        id: 'trait_custom_night_reader',
        label: 'Night Reader',
        rarity: 'blue',
        source: 'custom',
      }),
    ]);
    expect(next.worldStateDelta.openingTraitsSummary).toBe('Opening AI judged the custom trait as blue.');
  });

  it('rejects unresolved player trait rarity writeback placeholders', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updatePlayerTraits',
      characterId: 'player',
      traits: [
        {
          id: 'trait_custom_pending',
          label: 'Pending Trait',
          description: 'A trait still waiting for opening AI judgment.',
          source: 'custom',
          rarity: '待开局 LLM 判定',
        },
      ],
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('rarity');
  });

  it('allows opening to write back player unique arts', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updateCharacterUniqueArts',
      characterType: 'player',
      characterId: 'player',
      characterName: makeState().player.name,
      uniqueArts: [makeUniqueArt()],
      summary: 'Opening AI judged one long-term art.',
      updatedAt: 'opening-date',
      source: 'opening',
    } as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('writes player unique arts into player archive and opening context', () => {
    const next = applyLuanShiCommand(makeState(), {
      action: 'updateCharacterUniqueArts',
      characterType: 'player',
      characterId: 'player',
      uniqueArts: [makeUniqueArt()],
      summary: 'Opening AI judged one long-term art.',
      updatedAt: 'opening-date',
      source: 'opening',
    } as any);

    expect(next.player.uniqueArts?.[0]).toMatchObject({
      id: 'art_border_scouting',
      name: 'Border Scouting',
      rarity: 'blue',
      domain: 'survival',
      level: 2,
      progress: 35,
    });
    expect(next.worldStateDelta.openingUniqueArts).toEqual(['Border Scouting']);
    expect(next.worldStateDelta.openingUniqueArtDetails).toEqual([
      expect.objectContaining({
        id: 'art_border_scouting',
        name: 'Border Scouting',
        rarity: 'blue',
        domain: 'survival',
      }),
    ]);
    expect(next.worldStateDelta.openingUniqueArtsSummary).toBe('Opening AI judged one long-term art.');
  });

  it('allows NPC profile upsert to include unique arts', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertNpcProfile',
      npcId: 'npc_lady_tan',
      name: 'Lady Tan',
      sex: '女',
      age: 26,
      role: 'Strategist',
      currentIdentity: 'Retainer strategist',
      locationId: 'loc_market_town',
      isPresent: true,
      isFocused: false,
      summary: 'A cautious strategist travelling with the convoy.',
      appearance: 'Plain cloak and sharp eyes.',
      personality: 'Measured and patient.',
      motivation: 'Keep the convoy alive.',
      relationToPlayer: 'Ally of convenience.',
      contactLevel: 3,
      recentAttitude: 'Testing trust.',
      abilityScores: {
        武力: 20,
        统率: 55,
        智力: 78,
        政治: 62,
        魅力: 50,
        机运: 45,
      },
      traits: [
        {
          id: 'trait_calm_planner',
          label: 'Calm Planner',
          description: 'Keeps order under pressure.',
          source: 'opening',
          rarity: 'green',
        },
      ],
      uniqueArts: [makeUniqueArt({ id: 'art_supply_routes', name: 'Supply Routes', domain: 'strategy' })],
    } as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('writes and preserves NPC unique arts through profile updates', () => {
    const baseCommand = {
      action: 'upsertNpcProfile',
      npcId: 'npc_lady_tan',
      name: 'Lady Tan',
      sex: '女',
      age: 26,
      role: 'Strategist',
      currentIdentity: 'Retainer strategist',
      locationId: 'loc_market_town',
      isPresent: true,
      isFocused: false,
      summary: 'A cautious strategist travelling with the convoy.',
      appearance: 'Plain cloak and sharp eyes.',
      personality: 'Measured and patient.',
      motivation: 'Keep the convoy alive.',
      relationToPlayer: 'Ally of convenience.',
      contactLevel: 3,
      recentAttitude: 'Testing trust.',
      abilityScores: {
        武力: 20,
        统率: 55,
        智力: 78,
        政治: 62,
        魅力: 50,
        机运: 45,
      },
      traits: [
        {
          id: 'trait_calm_planner',
          label: 'Calm Planner',
          description: 'Keeps order under pressure.',
          source: 'opening',
          rarity: 'green',
        },
      ],
    } as const;
    const created = applyLuanShiCommand(makeState(), {
      ...baseCommand,
      uniqueArts: [makeUniqueArt({ id: 'art_supply_routes', name: 'Supply Routes', domain: 'strategy' })],
    } as any);
    const updated = applyLuanShiCommand(created, {
      ...baseCommand,
      recentAttitude: 'Trusting but cautious.',
    } as any);

    expect(updated.npcs.find((npc) => npc.npcId === 'npc_lady_tan')?.uniqueArts?.[0]).toMatchObject({
      id: 'art_supply_routes',
      name: 'Supply Routes',
      domain: 'strategy',
    });
  });

  it('allows targeted NPC unique art upgrades by stable npcId', () => {
    const next = applyLuanShiCommand(makeState(), {
      action: 'updateCharacterUniqueArts',
      characterType: 'npc',
      characterId: 'npc_chen_heng',
      uniqueArts: [makeUniqueArt({ id: 'art_street_ambush', name: 'Street Ambush', level: 3, progress: 70 })],
      summary: 'Chen Heng learned from the ambush.',
    } as any);

    expect(next.npcs.find((npc) => npc.npcId === 'npc_chen_heng')?.uniqueArts?.[0]).toMatchObject({
      id: 'art_street_ambush',
      level: 3,
      progress: 70,
    });
  });

  it('rejects invalid unique art writeback fields', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updateCharacterUniqueArts',
      characterType: 'player',
      uniqueArts: [
        makeUniqueArt({
          rarity: 'legendary',
          domain: 'spell',
          level: 11,
          progress: 120,
          checkHooks: [{ scope: 'combat', modifier: 80, note: 'Too large.' }],
        }),
      ],
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('rarity');
    expect(result.errors.join('\n')).toContain('domain');
    expect(result.errors.join('\n')).toContain('level');
    expect(result.errors.join('\n')).toContain('progress');
    expect(result.errors.join('\n')).toContain('modifier');
  });

  it('rejects NPC profile upsert when age is zero', () => {
    const state = makeState();
    const result = validateLuanShiCommand(state, {
      action: 'upsertNpcProfile',
      npcId: 'npc_age_zero',
      name: 'Age Zero',
      sex: state.npcs?.[0]?.sex ?? '男',
      age: 0,
      role: 'Test',
      currentIdentity: 'Test identity',
      locationId: 'loc_market_town',
      isPresent: true,
      isFocused: false,
      summary: 'Test summary.',
      appearance: 'Test appearance.',
      personality: 'Test personality.',
      motivation: 'Test motivation.',
      relationToPlayer: 'Test relation.',
      contactLevel: 0,
      recentAttitude: 'Test attitude.',
      abilityScores: {
        '姝﹀姏': 50,
        '缁熺巼': 50,
        '鏅哄姏': 50,
        '鏀挎不': 50,
        '榄呭姏': 50,
        '鏈鸿繍': 50,
      },
      traits: [
        {
          id: 'trait_age_test',
          label: 'Test trait',
          description: 'Test trait description.',
          source: 'test',
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('age');
  });

  it('rejects NPC profile upsert when age is missing', () => {
    const state = makeState();
    const result = validateLuanShiCommand(state, {
      action: 'upsertNpcProfile',
      npcId: 'npc_missing_age',
      name: 'Missing Age',
      sex: '女',
      role: 'Test',
      currentIdentity: 'Test identity',
      locationId: 'loc_market_town',
      isPresent: true,
      isFocused: false,
      summary: 'Test summary.',
      appearance: 'Test appearance.',
      personality: 'Test personality.',
      motivation: 'Test motivation.',
      relationToPlayer: 'Test relation.',
      contactLevel: 1,
      recentAttitude: 'Test attitude.',
      abilityScores: {
        武力: 10,
        统率: 10,
        智力: 10,
        政治: 10,
        魅力: 10,
        机运: 10,
      },
      traits: [
        {
          id: 'trait_missing_age_test',
          label: 'Test trait',
          description: 'Test trait description.',
          source: 'test',
        },
      ],
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('age');
  });

  it('accepts adult female profile writeback for an adult female NPC', () => {
    const result = validateLuanShiCommand(makeStateWithFemaleNpc(22), {
      action: 'updateNpcFemaleProfile',
      npcId: 'npc_he_lady',
      npcName: '何氏',
      relationshipNotes: '与主角保持礼节往来。',
      publicIntimacyNotes: '公开亲昵边界只停留在大众文学尺度。',
      appearanceExtension: '仪态端庄，衣饰合乎身份。',
      emotionalBoundary: '谨慎而有戒心。',
      adultPrivateProfile: {
        enabled: true,
        summary: '成年女性私密档案摘要。',
        boundaryNotes: '只在成人内容启用且年满十八时使用。',
      },
      source: 'test',
    } as any);

    expect(result.valid).toBe(true);
  });

  it('keeps underage female profile writeback valid but strips adult private data', () => {
    const state = makeStateWithFemaleNpc(17);
    const result = validateLuanShiCommand(state, {
      action: 'updateNpcFemaleProfile',
      npcId: 'npc_he_lady',
      npcName: '何氏',
      relationshipNotes: '保持普通社交记录。',
      publicIntimacyNotes: '可以保留大众文学尺度的亲近张力。',
      adultPrivateProfile: {
        enabled: true,
        summary: 'Should not be stored.',
      },
      source: 'test',
    } as any);

    expect(result.valid).toBe(true);

    const next = applyLuanShiCommand(state, {
      action: 'updateNpcFemaleProfile',
      npcId: 'npc_he_lady',
      npcName: '何氏',
      relationshipNotes: '保持普通社交记录。',
      publicIntimacyNotes: '可以保留大众文学尺度的亲近张力。',
      adultPrivateProfile: {
        enabled: true,
        summary: 'Should not be stored.',
      },
      source: 'test',
    } as any);
    const npc = next.npcs.find((item) => item.npcId === 'npc_he_lady') as any;
    expect(npc?.femaleProfile?.relationshipNotes).toBe('保持普通社交记录。');
    expect(npc?.femaleProfile?.adultPrivateProfile).toBeUndefined();
  });

  it('uses derived current age before stripping adult female private data', () => {
    const state = ensureLuanShiState({
      ...makeState(),
      currentDate: '公元190年09月01日 08:00（辰时）',
      npcs: [
        {
          ...makeState().npcs![0],
          npcId: 'npc_derived_adult',
          name: '某氏',
          sex: '女',
          age: 17,
          ageKnownAtDate: '公元189年09月01日 08:00（辰时）',
          memories: [],
        } as any,
      ],
    });

    const next = applyLuanShiCommand(state, {
      action: 'updateNpcFemaleProfile',
      npcId: 'npc_derived_adult',
      npcName: '某氏',
      relationshipNotes: '跨年后的成年档案记录。',
      adultPrivateProfile: {
        enabled: true,
        summary: 'Derived adult private profile should be stored.',
      },
      source: 'test',
    } as any);

    const npc = next.npcs.find((item) => item.npcId === 'npc_derived_adult') as any;
    expect(npc?.femaleProfile?.adultPrivateProfile?.summary).toBe('Derived adult private profile should be stored.');
    expect(npc?.femaleProfile?.adultPrivateProfile?.ageConfirmedAdult).toBe(true);
  });

  it('ignores underage adult private writeback without deleting existing private archive data', () => {
    const state = ensureLuanShiState({
      ...makeState(),
      currentDate: '公元189年09月01日 08:00（辰时）',
      npcs: [
        {
          ...makeState().npcs![0],
          npcId: 'npc_existing_private',
          name: '某氏',
          sex: '女',
          age: 17,
          femaleProfile: {
            relationshipNotes: '已有公开关系记录。',
            adultPrivateProfile: {
              enabled: true,
              ageConfirmedAdult: true,
              summary: 'Existing private archive should be preserved but hidden.',
            },
          },
          memories: [],
        } as any,
      ],
    });

    const next = applyLuanShiCommand(state, {
      action: 'updateNpcFemaleProfile',
      npcId: 'npc_existing_private',
      npcName: '某氏',
      relationshipNotes: '未成年阶段只更新公开记录。',
      adultPrivateProfile: {
        enabled: true,
        summary: 'Incoming underage private data should be ignored.',
      },
      source: 'test',
    } as any);

    const npc = next.npcs.find((item) => item.npcId === 'npc_existing_private') as any;
    expect(npc?.femaleProfile?.relationshipNotes).toBe('未成年阶段只更新公开记录。');
    expect(npc?.femaleProfile?.adultPrivateProfile?.summary).toBe('Existing private archive should be preserved but hidden.');
  });

  it('writes adult female profile data into the NPC archive', () => {
    const next = applyLuanShiCommand(makeStateWithFemaleNpc(22), {
      action: 'updateNpcFemaleProfile',
      npcId: 'npc_he_lady',
      npcName: '何氏',
      relationshipNotes: '与主角保持礼节往来。',
      publicIntimacyNotes: '公开亲昵边界只停留在大众文学尺度。',
      adultPrivateProfile: {
        enabled: true,
        summary: '成年女性私密档案摘要。',
        boundaryNotes: '只在成人内容启用且年满十八时使用。',
      },
      source: 'test',
    } as any);

    const npc = next.npcs.find((item) => item.npcId === 'npc_he_lady') as any;
    expect(npc?.femaleProfile?.relationshipNotes).toBe('与主角保持礼节往来。');
    expect(npc?.femaleProfile?.adultPrivateProfile?.ageConfirmedAdult).toBe(true);
  });

  it('supports Alpha female profile fields and writes them without losing structure', () => {
    const command = {
      action: 'updateNpcFemaleProfile',
      npcId: 'npc_he_lady',
      npcName: '何氏',
      birthday: '八月初三',
      addressToPlayer: '刘郎君',
      relationshipNotes: '与主角保持礼节往来。',
      publicIntimacyNotes: '公开亲昵边界只停留在大众文学尺度。',
      appearanceDescription: '仪态端庄，容貌明艳。',
      bodyDescription: '身段丰润，举止稳重。',
      clothingStyle: '常穿素雅深衣，配饰克制。',
      personalityCore: '谨慎克制，但危局中会依赖可信之人。',
      affectionProgressionCondition: '需长期守信并保护其亲族。',
      relationshipProgressionCondition: '需在重大危机中兑现承诺。',
      relationshipNetwork: [
        { targetName: '主角', relationship: '危局中的盟友', notes: '仍在观察其长期可靠性。' },
        { targetName: '家族', relationship: '需要保护的牵挂' },
      ],
      emotionalBoundary: '需要确认安全感后才会进一步信任。',
      adultPrivateProfile: {
        enabled: true,
        summary: '成年女性私密档案摘要。',
        breastDescription: '常态身体特征记录。',
        vaginaDescription: '常态私密部位记录。',
        anusDescription: '常态隐私部位记录。',
        sexualPreferenceNotes: '偏好长期承诺后的亲密关系。',
        sensitiveSpotNotes: '主要敏感区域记录。',
        preferenceNotes: '偏好可靠且守信的人。',
        boundaryNotes: '边界以安全感与关系承诺为前提。',
        sensitiveNotes: '对出身和亲族安危敏感。',
        relationshipRiskNotes: '关系风险来自外部权力结构。',
        wombProfile: {
          status: '未受孕',
          cervixStatus: '紧闭',
          inseminationRecords: [
            { date: '乱世元年2月', description: '测试记录。', pregnancyCheckDate: '乱世元年3月' },
          ],
        },
        virgin: false,
        firstNightPartner: '主角',
        firstNightTime: '乱世元年2月',
        firstNightDescription: '长期关系节点记录。',
      },
      source: 'alpha parity test',
    } as any;

    const result = validateLuanShiCommand(makeStateWithFemaleNpc(22), command);
    expect(result.valid).toBe(true);

    const next = applyLuanShiCommand(makeStateWithFemaleNpc(22), command);
    const npc = next.npcs.find((item) => item.npcId === 'npc_he_lady') as any;

    expect(npc?.femaleProfile?.birthday).toBe('八月初三');
    expect(npc?.femaleProfile?.relationshipNetwork).toHaveLength(2);
    expect(npc?.femaleProfile?.relationshipNetwork?.[0]).toMatchObject({ targetName: '主角', relationship: '危局中的盟友' });
    expect(npc?.femaleProfile?.adultPrivateProfile?.breastDescription).toBe('常态身体特征记录。');
    expect(npc?.femaleProfile?.adultPrivateProfile?.wombProfile?.status).toBe('未受孕');
    expect(npc?.femaleProfile?.adultPrivateProfile?.wombProfile?.inseminationRecords?.[0]?.pregnancyCheckDate).toBe('乱世元年3月');
    expect(npc?.femaleProfile?.adultPrivateProfile?.virgin).toBe(false);
  });

  it('rejects malformed Alpha female profile structures', () => {
    const result = validateLuanShiCommand(makeStateWithFemaleNpc(22), {
      action: 'updateNpcFemaleProfile',
      npcId: 'npc_he_lady',
      npcName: '何氏',
      relationshipNetwork: [{ targetName: '', relationship: '盟友' }],
      adultPrivateProfile: {
        enabled: true,
        wombProfile: {
          status: '未受孕',
          cervixStatus: '紧闭',
          inseminationRecords: [{ date: '', description: '缺少日期。' }],
        },
      },
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('relationshipNetwork');
    expect(result.errors.join('\n')).toContain('wombProfile.inseminationRecords');
  });

  it('validates and applies pregnancy risk only through the adult-gated narrow command', () => {
    const command = {
      action: 'recordPregnancyRisk',
      npcId: 'npc_he_lady',
      npcName: '何氏',
      riskType: 'unprotected',
      summary: '正文已明确发生未避孕的有效行为。',
    } as const;

    expect(validateLuanShiCommand(makeStateWithFemaleNpc(22), command).valid).toBe(true);
    expect(validateLuanShiCommand(makeStateWithFemaleNpc(17), command).valid).toBe(false);

    const next = applyLuanShiCommand(makeStateWithFemaleNpc(22), command);
    expect(next.npcs.find((npc) => npc.npcId === 'npc_he_lady')
      ?.femaleProfile?.adultPrivateProfile?.wombProfile?.pregnancy).toMatchObject({
        status: 'pendingCheck',
        fatherCharacterIds: ['player'],
      });
  });

  it('rejects direct overwrites of engine-managed pregnancy truth through female profile updates', () => {
    const result = validateLuanShiCommand(makeStateWithFemaleNpc(22), {
      action: 'updateNpcFemaleProfile',
      npcId: 'npc_he_lady',
      npcName: '何氏',
      adultPrivateProfile: {
        wombProfile: {
          pregnancy: {
            pregnancyId: 'forged',
            status: 'confirmed',
          },
        },
      },
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('pregnancy is engine-managed');

    const queuedResult = validateLuanShiCommand(makeStateWithFemaleNpc(22), {
      action: 'updateNpcFemaleProfile',
      npcId: 'npc_he_lady',
      npcName: '何氏',
      adultPrivateProfile: {
        wombProfile: {
          pendingPregnancyChecks: [{
            pregnancyId: 'forged-queued-check',
            status: 'pendingCheck',
          }],
        },
      },
    } as any);

    expect(queuedResult.valid).toBe(false);
    expect(queuedResult.errors.join('\n')).toContain('pendingPregnancyChecks is engine-managed');
  });

  it('preserves existing female profile when upserting an NPC profile', () => {
    const state = makeStateWithFemaleNpc(22);
    const next = applyLuanShiCommand({
      ...state,
      npcs: state.npcs?.map((npc) => npc.npcId === 'npc_he_lady'
        ? {
            ...npc,
            femaleProfile: {
              relationshipNotes: '与主角保持礼节往来。',
              publicIntimacyNotes: '公开亲昵边界只停留在大众文学尺度。',
              adultPrivateProfile: {
                enabled: true,
                ageConfirmedAdult: true,
                summary: '成年女性私密档案摘要。',
              },
            },
          }
        : npc),
    }, {
      action: 'upsertNpcProfile',
      npcId: 'npc_he_lady',
      name: '何氏',
      sex: '女',
      age: 23,
      role: '士族女性',
      locationId: 'loc_market_town',
      isPresent: true,
      isFocused: true,
      currentIdentity: '士族女性',
      summary: '士族女性，与当前局势有所牵连。',
      appearance: '仪态端庄。',
      personality: '谨慎克制。',
      motivation: '保全家族。',
      relationToPlayer: '礼节往来。',
      contactLevel: 13,
      recentAttitude: '谨慎',
      abilityScores: {
        武力: 20,
        统率: 35,
        智力: 62,
        政治: 58,
        魅力: 72,
        机运: 45,
      },
      traits: [
        {
          id: 'trait_gentry_discipline',
          label: '士族礼法',
          description: '熟悉士族礼法与家族规矩。',
          source: 'test',
        },
      ],
    });

    const npc = next.npcs.find((item) => item.npcId === 'npc_he_lady') as any;
    expect(npc?.femaleProfile?.relationshipNotes).toBe('与主角保持礼节往来。');
    expect(npc?.femaleProfile?.adultPrivateProfile?.summary).toBe('成年女性私密档案摘要。');
  });

  it.each(['钱财', 'money'])('rejects personal-money shadow key %s in the resource ledger', (resourceKey) => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'updateResourceLedger',
      playerResources: {
        [resourceKey]: 36,
        粮草: 50,
      },
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('updatePlayerLoadout.personalMoneyDelta');
  });

  it('validates resource, faction, and troop ledger commands', () => {
    expect(validateLuanShiCommand(makeState(), {
      action: 'updateResourceLedger',
      money: 120,
      grain: 300,
      horses: 12,
      weapons: ['环首刀x20'],
      documents: ['军令一封'],
      tokens: ['北军符节'],
      importantSupplies: ['箭矢三箱'],
      playerResources: { 粮饷: 36, 粮草: 50 },
    } as any).valid).toBe(true);

    expect(validateLuanShiCommand(makeState(), {
      action: 'upsertFactionLedger',
      factionId: 'faction_local_guard',
      name: '市镇守卒',
      type: '地方武装',
      summary: '维持市镇秩序的小股守卒。',
      stanceToPlayer: '观望',
      knownLevel: '亲历',
      recentActions: ['封锁北门'],
      aliases: ['北门守军旧部'],
      nominalAllegiance: '汉廷',
      legalIdentity: '郡县守备',
      actualController: '陈衡',
      knownSphere: '北门、市镇守卒与附近巡防',
      corePersonNpcIds: ['npc_chen_heng'],
      knownMemberNpcIds: ['npc_li_su'],
      relatedTroopIds: ['troop_guard_1'],
      sourceNote: '亲眼见到守卒听从陈衡调遣。',
      lastKnownAt: '乱世元年2月',
      updatedAt: '乱世元年2月',
    } as any).valid).toBe(true);

    expect(validateLuanShiCommand(makeState(), {
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
      statusTags: ['断粮', '守门'],
      leaderNpcId: 'npc_chen_heng',
      locationId: 'loc_market_town',
      lastKnownLocationId: 'loc_market_town',
      lastKnownAt: '乱世元年2月',
      knownLevel: '亲历',
      certainty: 'confirmed',
      morale: 45,
      training: 35,
      supplies: '口粮不足',
      task: '守住北门',
      relationToPlayer: '谨慎观望',
      previousFactionId: 'faction_dongzhuo',
      allegianceChangedAt: 'luanshi-year-2-month-2',
      allegianceChangeReason: 'false surrender followed by uprising',
      lastBattleId: 'battle_north_gate',
      strengthTrend: 'decreased',
      lastChangeReason: '遭遇伏击减员',
      updatedAt: '乱世元年2月',
    } as any).valid).toBe(true);

    expect(validateLuanShiCommand(makeState(), {
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
    } as any).valid).toBe(true);

    expect(validateLuanShiCommand(makeState(), {
      action: 'upsertTroopLedger',
      troopId: 'troop_real_api_trend_aliases',
      name: '趋势别名部队',
      size: 800,
      previousSize: 500,
      morale: 80,
      training: 75,
      supplies: 10,
      task: '阵列成型，面临断粮危机',
      relationToPlayer: 'self',
      strengthTrend: '大幅增强',
    } as any).valid).toBe(true);

    expect(validateLuanShiCommand(makeState(), {
      action: 'upsertTroopLedger',
      troopId: 'troop_real_api_numeric_condition_aliases',
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
    } as any).valid).toBe(true);

    expect(validateLuanShiCommand(makeState(), {
      action: 'upsertTroopLedger',
      troopId: 'troop_superior_supply',
      name: '拨付军粮部曲',
      size: 120,
      morale: 55,
      training: 45,
      supplies: 50,
      task: '随军听用',
      relationToPlayer: '你直接统领',
      upkeepSource: 'superior_provision',
    } as any).valid).toBe(true);

    expect(validateLuanShiCommand(makeState(), {
      action: 'upsertTroopLedger',
      troopId: 'troop_bad_supply_source',
      name: '坏来源部曲',
      size: 120,
      morale: 55,
      training: 45,
      supplies: 50,
      task: '随军听用',
      relationToPlayer: '你直接统领',
      upkeepSource: '上级拨付',
    } as any).valid).toBe(false);

    const stateWithTroop = applyLuanShiCommand(makeState(), {
      action: 'upsertTroopLedger',
      troopId: 'troop_guard_1',
      name: '北门守卒',
      size: 80,
      morale: 45,
      training: 35,
      supplies: '口粮不足',
      task: '守住北门',
      relationToPlayer: '谨慎观望',
    } as any);

    expect(validateLuanShiCommand(stateWithTroop, {
      action: 'upsertTroopLedger',
      troopId: 'troop_guard_1',
      size: 70,
    } as any).valid).toBe(true);

    const invalidDestroyedTroop = validateLuanShiCommand(stateWithTroop, {
      action: 'upsertTroopLedger',
      troopId: 'troop_guard_1',
      lifecycleStatus: 'destroyed',
    } as any);
    expect(invalidDestroyedTroop.valid).toBe(false);
    expect(invalidDestroyedTroop.errors.join('\n')).toContain('size=0');
    expect(invalidDestroyedTroop.errors.join('\n')).toContain('destroyedInBattleId');

    expect(validateLuanShiCommand(stateWithTroop, {
      action: 'upsertTroopLedger',
      troopId: 'troop_guard_1',
      size: 0,
      lifecycleStatus: 'destroyed',
      destroyedInBattleId: 'battle_north_gate',
    } as any).valid).toBe(true);

    const invalidSplitTroop = validateLuanShiCommand(stateWithTroop, {
      action: 'upsertTroopLedger',
      troopId: 'troop_guard_1',
      lifecycleStatus: 'split',
      childTroopIds: ['troop_guard_left'],
    } as any);
    expect(invalidSplitTroop.valid).toBe(false);
    expect(invalidSplitTroop.errors.join('\n')).toContain('至少两个 childTroopIds');

    const invalidMergedTroop = validateLuanShiCommand(stateWithTroop, {
      action: 'upsertTroopLedger',
      troopId: 'troop_guard_1',
      lifecycleStatus: 'merged',
    } as any);
    expect(invalidMergedTroop.valid).toBe(false);
    expect(invalidMergedTroop.errors.join('\n')).toContain('mergedIntoTroopId');

    expect(validateLuanShiCommand(stateWithTroop, {
      action: 'upsertTroopLedger',
      troopId: 'troop_guard_1',
      orderStatus: 'issued',
      orderIssuedAt: '189-09-01 12:00',
      orderDeliveredAt: '189-09-01 14:00',
      orderSummary: 'Move from the north camp to the east gate after receiving the seal order.',
      destinationLocationId: 'place_east_gate',
      routeId: 'route_north_to_east_gate',
      movementStatus: 'marching',
      departedAt: '189-09-01 14:30',
      estimatedArrivalAt: '189-09-01 18:30',
      movementNotes: 'The order is not instant; current location stays at the last confirmed camp.',
    } as any).valid).toBe(true);

    const badMovementResult = validateLuanShiCommand(stateWithTroop, {
      action: 'upsertTroopLedger',
      troopId: 'troop_guard_1',
      orderStatus: 'teleported',
      movementStatus: 'instant',
    } as any);
    expect(badMovementResult.valid).toBe(false);
    expect(badMovementResult.errors.join('\n')).toContain('orderStatus');
    expect(badMovementResult.errors.join('\n')).toContain('movementStatus');

    expect(validateLuanShiCommand(makeState(), {
      action: 'upsertConflictRecord',
      conflictId: 'battle_north_gate',
      type: '伏击',
      title: '北门夜袭',
      summary: '北门守卒在夜间遭遇伏击。',
      occurredAt: '乱世元年2月',
      outcome: '守卒溃退，减员二十余人。',
      scope: 'selfRelated',
      recordLevel: 'full',
      locationId: 'loc_market_town',
      locationName: '北门',
      sides: ['北门守卒', '流民盗匪'],
      commanderNpcIds: ['npc_chen_heng'],
      involvedTroopIds: ['troop_guard_1'],
      involvedFactionIds: ['faction_local_guard'],
      result: '溃退',
      winnerSide: '流民盗匪',
      loserSide: '北门守卒',
      decisiveFactors: ['夜色掩护', '守卒缺粮'],
      reportText: '夜色压住北门火光，伏兵从巷口逼近，守卒仓促退入门楼。',
      troopEffects: ['troop_guard_1 减员约二十人'],
      factionEffects: ['市镇守卒威望受挫'],
      relatedQuestIds: ['quest_hold_gate'],
      imageKey: 'ambush_night',
      updatedAt: '乱世元年2月',
    } as any).valid).toBe(true);

    expect(validateLuanShiCommand(makeState(), {
      action: 'upsertConflictRecord',
      conflictId: 'standoff_palace_gate',
      type: '对峙',
      title: '宫门对峙',
      summary: '两军在宫门外互相逼视，尚未真正交锋。',
      occurredAt: '乱世元年2月',
      outcome: '局势僵持，双方都在等待下一道军令。',
    } as any).valid).toBe(true);

    const missingSummaryConflict = {
      action: 'upsertConflictRecord',
      conflictId: 'standoff_without_summary',
      type: '对峙',
      title: '营门对峙',
      occurredAt: '乱世元年2月',
      outcome: '双方各自收束部曲，冲突暂未爆发。',
    } as any;
    expect(validateLuanShiCommand(makeState(), missingSummaryConflict).valid).toBe(true);
    const stateWithConflict = applyLuanShiCommand(makeState(), missingSummaryConflict);
    expect(stateWithConflict.conflicts.find((conflict) => conflict.conflictId === 'standoff_without_summary')?.summary).toBe('双方各自收束部曲，冲突暂未爆发。');
  });

  it('accepts numeric war judgement advantage scores and stores the derived band', () => {
    const command = {
      action: 'upsertConflictRecord',
      conflictId: 'battle_numeric_advantage',
      type: '战争',
      title: '数值优势战例',
      summary: '测试模型把优势分直接写成数值时的兼容。',
      occurredAt: '公元189年09月01日 12:00',
      outcome: '己方大占上风。',
      judgement: {
        method: 'warJudgementV1',
        baselineAdvantage: 60,
      },
    } as any;

    const validation = validateLuanShiCommand(makeState(), command);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    const next = applyLuanShiCommand(makeState(), command);
    expect(next.conflicts.find((conflict) => conflict.conflictId === 'battle_numeric_advantage')?.judgement?.baselineAdvantage).toBe('overwhelmingAdvantage');
  });

  it('rejects malformed war judgement fields on conflict records', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertConflictRecord',
      conflictId: 'battle_bad_judgement',
      type: '战争',
      title: '坏判定',
      summary: '测试坏判定字段。',
      occurredAt: '公元189年09月01日 12:00',
      outcome: '结果未定。',
      resultLevel: 'crushingVictory',
      judgement: {
        method: 'freeform',
        baselineAdvantage: 'absolute',
        scoreBreakdown: {
          troopBase: 999,
          commander: 'high',
          notes: ['兵力压制'],
        },
      },
      turningPoints: [
        {
          type: 'heroMoment',
          summary: '',
          impact: 'huge',
          scoreModifier: 999,
        },
      ],
      resultTags: [''],
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('resultLevel');
    expect(result.errors.join('\n')).toContain('judgement.method');
    expect(result.errors.join('\n')).toContain('baselineAdvantage');
    expect(result.errors.join('\n')).toContain('scoreBreakdown.troopBase');
    expect(result.errors.join('\n')).toContain('turningPoints[0].type');
    expect(result.errors.join('\n')).toContain('turningPoints[0].summary');
    expect(result.errors.join('\n')).toContain('turningPoints[0].impact');
    expect(result.errors.join('\n')).toContain('resultTags');
  });

  it('accepts personal combat records and character reputation updates', () => {
    const state = makeState();

    expect(validateLuanShiCommand(state, {
      action: 'upsertCombatRecord',
      combatId: 'combat_gate_duel',
      kind: 'battlefieldDuel',
      title: 'Gate Duel',
      summary: 'The player cut down the enemy challenger before the gate.',
      occurredAt: '189-09-01 12:00',
      locationId: 'loc_market_town',
      locationName: 'North Gate',
      participants: [
        { name: 'Player', side: 'player', participantId: 'player' },
        { name: 'Enemy Champion', side: 'enemy', npcId: 'npc_enemy_champion', reputationFame: 65 },
      ],
      playerInvolved: true,
      resultLevel: 'decisiveWin',
      outcomeTags: ['kill', 'forceRetreat'],
      outcome: 'The enemy champion died and the enemy line faltered.',
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
          notes: ['Command duel broke the opposing morale.'],
        },
        advantageBand: 'clearAdvantage',
        underdogReason: 'The enemy relied on numbers, not the duel field.',
        decisiveMoment: 'The player seized the opening after the enemy overextended.',
      },
      briefText: 'The duel ended quickly at the north gate, turning the nearby skirmish.',
      reportText: 'North Gate dust rose under the hooves. The player shifted aside from the first spear thrust, let the enemy champion overextend, then cut back through the exposed guard. The nearby soldiers saw the challenger fall and the enemy line hesitated.',
      imageKey: 'battlefield_duel_gate',
      visualTags: ['gate', 'duel', 'spear'],
      reputationEffects: ['player fame +4 for defeating a known fighter'],
      updatedAt: '189-09-01 12:00',
    } as any).valid).toBe(true);

    expect(validateLuanShiCommand(state, {
      action: 'updateCharacterReputation',
      characterId: 'npc_chen_heng',
      characterType: 'npc',
      fameDelta: 3,
      moralityDelta: 1,
      tags: [{ label: 'gate-duelist', source: 'combat_gate_duel' }],
      summary: 'Known for holding the north gate under pressure.',
      updatedAt: '189-09-01 12:00',
    } as any).valid).toBe(true);
  });

  it('rejects malformed personal combat records and reputation updates', () => {
    const combatResult = validateLuanShiCommand(makeState(), {
      action: 'upsertCombatRecord',
      combatId: '',
      kind: 'armyBattle',
      title: '',
      summary: '',
      occurredAt: '',
      participants: [
        { name: '', side: 'player' },
        { name: 'Stranger', side: 'thirdSide' },
      ],
      playerInvolved: 'yes',
      resultLevel: 'totalVictory',
      outcomeTags: [''],
      outcome: '',
      significance: 'worldChanging',
      judgement: {
        method: 'warJudgementV1',
        advantageBand: 'absolute',
        scoreBreakdown: {
          personalBase: 999,
          total: 'high',
          notes: [''],
        },
      },
    } as any);

    expect(combatResult.valid).toBe(false);
    expect(combatResult.errors.join('\n')).toContain('upsertCombatRecord.combatId');
    expect(combatResult.errors.join('\n')).toContain('kind');
    expect(combatResult.errors.join('\n')).toContain('participants[0].name');
    expect(combatResult.errors.join('\n')).toContain('participants[1].side');
    expect(combatResult.errors.join('\n')).toContain('resultLevel');
    expect(combatResult.errors.join('\n')).toContain('judgement.method');
    expect(combatResult.errors.join('\n')).toContain('scoreBreakdown.personalBase');

    const reputationResult = validateLuanShiCommand(makeState(), {
      action: 'updateCharacterReputation',
      characterId: 'missing_npc',
      characterType: 'npc',
      fameDelta: 999,
      moralityDelta: 'high',
      tags: [{ label: '', source: 'combat' }],
    } as any);

    expect(reputationResult.valid).toBe(false);
    expect(reputationResult.errors.join('\n')).toContain('characterId');
    expect(reputationResult.errors.join('\n')).toContain('fameDelta');
    expect(reputationResult.errors.join('\n')).toContain('moralityDelta');
    expect(reputationResult.errors.join('\n')).toContain('tags');
  });

  it('rejects malformed resource, faction, and troop ledger commands', () => {
    const resourceResult = validateLuanShiCommand(makeState(), {
      action: 'updateResourceLedger',
      grain: -1,
      weapons: [''],
      playerResources: {
        notes: '粮秣来自临时征收',
      },
    } as any);
    expect(resourceResult.valid).toBe(false);
    expect(resourceResult.errors.join('\n')).toContain('updateResourceLedger.grain');
    expect(resourceResult.errors.join('\n')).toContain('weapons');
    expect(resourceResult.errors.join('\n')).toContain('playerResources.notes');

    const factionResult = validateLuanShiCommand(makeState(), {
      action: 'upsertFactionLedger',
      factionId: '',
      name: '无名势力',
      type: '地方',
      summary: '缺少 ID。',
      stanceToPlayer: '观望',
      knownLevel: '全知',
      recentActions: [],
    } as any);
    expect(factionResult.valid).toBe(false);
    expect(factionResult.errors.join('\n')).toContain('factionId');
    expect(factionResult.errors.join('\n')).toContain('knownLevel');

    const factionOptionalResult = validateLuanShiCommand(makeState(), {
      action: 'upsertFactionLedger',
      factionId: 'faction_bad_optional',
      name: '坏势力',
      type: '地方',
      summary: '测试坏可选字段。',
      stanceToPlayer: '观望',
      knownLevel: '听闻',
      recentActions: ['观望'],
      aliases: [''],
      nominalAllegiance: '',
      corePersonNpcIds: ['npc_chen_heng', ''],
      relatedTroopIds: 'troop_guard_1',
    } as any);
    expect(factionOptionalResult.valid).toBe(false);
    expect(factionOptionalResult.errors.join('\n')).toContain('aliases');
    expect(factionOptionalResult.errors.join('\n')).toContain('nominalAllegiance');
    expect(factionOptionalResult.errors.join('\n')).toContain('corePersonNpcIds');
    expect(factionOptionalResult.errors.join('\n')).toContain('relatedTroopIds');

    const troopResult = validateLuanShiCommand(makeState(), {
      action: 'upsertTroopLedger',
      troopId: 'troop_bad',
      name: '坏数据部队',
      size: 20,
      morale: 120,
      training: -3,
      supplies: '未知',
      task: '测试',
      relationToPlayer: '无',
    } as any);
    expect(troopResult.valid).toBe(false);
    expect(troopResult.errors.join('\n')).toContain('morale');
    expect(troopResult.errors.join('\n')).toContain('training');

    const newTroopPartialResult = validateLuanShiCommand(makeState(), {
      action: 'upsertTroopLedger',
      troopId: 'troop_new_partial',
      size: 30,
    } as any);
    expect(newTroopPartialResult.valid).toBe(false);
    expect(newTroopPartialResult.errors.join('\n')).toContain('name');
    expect(newTroopPartialResult.errors.join('\n')).toContain('morale');

    const troopOptionalResult = validateLuanShiCommand(makeState(), {
      action: 'upsertTroopLedger',
      troopId: 'troop_bad_optional',
      name: '坏可选字段部队',
      size: 20,
      previousSize: -1,
      morale: 40,
      training: 40,
      supplies: '未知',
      task: '测试',
      relationToPlayer: '无',
      statusTags: [''],
      previousFactionId: '',
      allegianceChangedAt: '',
      allegianceChangeReason: '',
      quality: '神兵',
      fatigue: '极低',
      readiness: '必胜',
      lifecycleStatus: '隐身',
      knownLevel: '全知',
      certainty: '玄学',
      strengthTrend: '暴涨',
    } as any);
    expect(troopOptionalResult.valid).toBe(false);
    expect(troopOptionalResult.errors.join('\n')).toContain('previousSize');
    expect(troopOptionalResult.errors.join('\n')).toContain('statusTags');
    expect(troopOptionalResult.errors.join('\n')).toContain('previousFactionId');
    expect(troopOptionalResult.errors.join('\n')).toContain('allegianceChangedAt');
    expect(troopOptionalResult.errors.join('\n')).toContain('allegianceChangeReason');
    expect(troopOptionalResult.errors.join('\n')).toContain('quality');
    expect(troopOptionalResult.errors.join('\n')).toContain('lifecycleStatus');
    expect(troopOptionalResult.errors.join('\n')).toContain('knownLevel');

    const conflictResult = validateLuanShiCommand(makeState(), {
      action: 'upsertConflictRecord',
      conflictId: '',
      type: '招降',
      title: '坏战事',
      summary: '',
      occurredAt: '乱世元年2月',
      outcome: '测试',
      scope: 'allSeeing',
      recordLevel: 'verbose',
      involvedTroopIds: ['troop_guard_1', ''],
    } as any);
    expect(conflictResult.valid).toBe(false);
    expect(conflictResult.errors.join('\n')).toContain('conflictId');
    expect(conflictResult.errors.join('\n')).toContain('summary');
    expect(conflictResult.errors.join('\n')).toContain('type');
    expect(conflictResult.errors.join('\n')).toContain('scope');
    expect(conflictResult.errors.join('\n')).toContain('recordLevel');
    expect(conflictResult.errors.join('\n')).toContain('involvedTroopIds');
  });

  it('rejects abstract placeholder faction ledger writebacks but accepts concrete political actors', () => {
    for (const command of [
      {
        action: 'upsertFactionLedger',
        factionId: 'faction_warlord_proto',
        name: '未来军阀集团',
        type: '军阀集团',
        summary: '各地方长官和将领暗中积蓄力量。',
        stanceToPlayer: '观望天下大势',
        knownLevel: '听闻',
        recentActions: ['兵马自重'],
      },
      {
        action: 'upsertFactionLedger',
        factionId: 'faction_scholars_network',
        name: '在野士人网络',
        type: '在野士人网络',
        summary: '各地士人通过清议联络。',
        stanceToPlayer: '关心天下安危',
        knownLevel: '听闻',
        recentActions: ['清议时局'],
      },
      {
        action: 'upsertFactionLedger',
        factionId: 'faction_bandits',
        name: '各路盗匪',
        type: '盗匪流寇',
        summary: '各地盗匪流窜。',
        stanceToPlayer: '劫掠商旅和村庄',
        knownLevel: '听闻',
        recentActions: ['沿途滋扰'],
      },
    ] as any[]) {
      const result = validateLuanShiCommand(makeState(), command);
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('抽象占位势力');
    }

    const concreteResult = validateLuanShiCommand(makeState(), {
      action: 'upsertFactionLedger',
      factionId: 'faction_chenliu_zhangmiao',
      name: '陈留张邈势力',
      type: '地方官府',
      summary: '张邈以陈留太守身份掌握郡府和当地兵马。',
      stanceToPlayer: '观望但可结交',
      knownLevel: '听闻',
      nominalAllegiance: '汉廷',
      actualController: '张邈',
      knownSphere: '陈留一带',
      recentActions: ['整顿郡兵'],
    } as any);

    expect(concreteResult.valid).toBe(true);
    expect(concreteResult.errors).toEqual([]);
  });

  it('rejects a troop intelligence source-confidence contradiction', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertTroopLedger',
      troopId: 'troop_inferred_but_confirmed',
      name: '传闻中的偏师',
      size: 20,
      morale: 50,
      training: 40,
      supplies: '一般',
      task: '去向不明',
      relationToPlayer: '敌对',
      knownLevel: '推测',
      certainty: 'confirmed',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('knownLevel=推测');
    expect(result.errors.join('\n')).toContain('certainty=confirmed');
  });

  it('rejects unnormalized English faction type enums in faction ledger writebacks', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertFactionLedger',
      factionId: 'faction_unknown_type',
      name: '边郡军府',
      type: 'unmapped_faction_kind',
      summary: '模型错误地写入了工程枚举类型。',
      stanceToPlayer: '观望',
      knownLevel: '听闻',
      recentActions: ['观望局势'],
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('upsertFactionLedger.type');
    expect(result.errors.join('\n')).toContain('中文势力类型');
  });

  it('accepts a structured holding ledger writeback with stable ids and numeric stats', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertHoldingLedger',
      holdingId: 'holding_yingchuan',
      name: 'Yingchuan commandery',
      type: 'commandery',
      status: 'controlled',
      summary: 'Player-controlled commandery used for holding tests.',
      civilAdministrationScope: 'territorial',
      scaleLevel: 3,
      agriculture: 75,
      commerce: 60,
      population: 70,
      publicOrder: 65,
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
      actualController: 'player faction',
      garrisonTroopIds: ['troop_guard_1'],
      relatedNpcIds: ['npc_chen_heng'],
      riskNotes: ['border pressure'],
      recentChanges: ['repaired granary'],
      siege: {
        status: 'encircled',
        supplyLine: 'cut',
        preparation: 'prepared',
      },
      updatedAt: '189-09-01',
    } as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('requires an explicit civil administration scope for new holding writebacks', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertHoldingLedger',
      holdingId: 'holding_scope_missing',
      name: '未声明民政范围的军营',
      type: 'camp',
      status: 'controlled',
      summary: '不得靠名称或类型猜测民政账本。',
      scaleLevel: 1,
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 0,
      popularSupport: 0,
      defense: 50,
      recruitPotential: 0,
      armory: 50,
      horseSupply: 20,
      corruption: 10,
      updatedAt: '189-09-01',
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('civilAdministrationScope');
  });

  it('rejects cadastral and civil scores on a non-civil military facility', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertHoldingLedger',
      holdingId: 'holding_plain_pass',
      name: '边关',
      type: 'pass',
      status: 'controlled',
      summary: '纯军事关隘。',
      civilAdministrationScope: 'none',
      scaleLevel: 1,
      agriculture: 20,
      commerce: 10,
      population: 10,
      publicOrder: 10,
      popularSupport: 10,
      defense: 80,
      recruitPotential: 10,
      armory: 50,
      horseSupply: 20,
      corruption: 10,
      farmlandMu: 1000,
      registeredHouseholds: 120,
      updatedAt: '189-09-01',
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('civilAdministrationScope=none');
    expect(result.errors.join('\n')).toContain('farmlandMu');
    expect(result.errors.join('\n')).toContain('registeredHouseholds');
    expect(result.errors.join('\n')).toContain('corruption');
  });

  it('accepts a non-revenue military facility only when corruption is omitted', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertHoldingLedger',
      holdingId: 'holding_plain_camp',
      name: '前锋营',
      type: 'camp',
      status: 'controlled',
      summary: '仅承担驻防和军需周转。',
      civilAdministrationScope: 'none',
      scaleLevel: 1,
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 0,
      popularSupport: 0,
      defense: 70,
      recruitPotential: 0,
      armory: 45,
      horseSupply: 20,
      updatedAt: '189-09-01',
    } as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('requires corruption for a holding with a civil revenue scope', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertHoldingLedger',
      holdingId: 'holding_tax_town',
      name: '临江港镇',
      type: 'port',
      status: 'controlled',
      summary: '管理港镇民户与商税。',
      civilAdministrationScope: 'households',
      scaleLevel: 2,
      agriculture: 0,
      commerce: 60,
      population: 50,
      publicOrder: 55,
      popularSupport: 50,
      defense: 40,
      recruitPotential: 25,
      armory: 15,
      horseSupply: 5,
      updatedAt: '189-09-01',
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('corruption');
  });

  it('accepts household-only port data without farmland or agriculture', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertHoldingLedger',
      holdingId: 'holding_port_town',
      name: '临江港镇',
      type: 'port',
      status: 'controlled',
      summary: '港区同时管理居民编户，但没有农业辖境。',
      civilAdministrationScope: 'households',
      scaleLevel: 2,
      agriculture: 0,
      commerce: 70,
      population: 45,
      publicOrder: 55,
      popularSupport: 50,
      defense: 45,
      recruitPotential: 30,
      armory: 20,
      horseSupply: 5,
      corruption: 15,
      registeredHouseholds: 420,
      eliteControlledShare: 25,
      localEliteRelation: 10,
      updatedAt: '189-09-01',
    } as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects unknown siege fact enums before they can enter a holding', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertHoldingLedger',
      holdingId: 'holding_bad_siege',
      name: 'Bad siege holding',
      type: 'camp',
      status: 'temporary',
      summary: 'Malformed siege facts.',
      civilAdministrationScope: 'none',
      scaleLevel: 1,
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 0,
      popularSupport: 0,
      defense: 40,
      recruitPotential: 0,
      armory: 30,
      horseSupply: 10,
      siege: {
        status: 'under_attack',
        supplyLine: 'unknown',
        preparation: 'huge_granary',
      },
      updatedAt: '189-09-01',
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('upsertHoldingLedger.siege.status');
    expect(result.errors.join('\n')).toContain('upsertHoldingLedger.siege.supplyLine');
    expect(result.errors.join('\n')).toContain('upsertHoldingLedger.siege.preparation');
  });

  it('rejects malformed local elite holding economy fields', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertHoldingLedger',
      holdingId: 'holding_bad_elite',
      name: 'Bad elite holding',
      type: 'commandery',
      status: 'controlled',
      summary: 'Malformed local elite fields.',
      civilAdministrationScope: 'territorial',
      scaleLevel: 3,
      agriculture: 50,
      commerce: 50,
      population: 50,
      publicOrder: 50,
      popularSupport: 50,
      defense: 50,
      recruitPotential: 50,
      armory: 50,
      horseSupply: 50,
      corruption: 50,
      farmlandMu: -1,
      registeredHouseholds: -10,
      eliteControlledShare: 120,
      localEliteRelation: 150,
      updatedAt: '189-09-01',
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('farmlandMu');
    expect(result.errors.join('\n')).toContain('registeredHouseholds');
    expect(result.errors.join('\n')).toContain('eliteControlledShare');
    expect(result.errors.join('\n')).toContain('localEliteRelation');
  });

  it('rejects malformed holding stats and display labels used as logic keys', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertHoldingLedger',
      holdingId: 'holding_bad',
      name: 'Bad holding',
      type: '郡县',
      status: '掌控中',
      summary: 'Malformed holding.',
      civilAdministrationScope: 'territorial',
      scaleLevel: 9,
      agriculture: 101,
      commerce: -1,
      population: 50,
      publicOrder: 50,
      popularSupport: 50,
      defense: 50,
      recruitPotential: 50,
      armory: 50,
      horseSupply: 50,
      corruption: 50,
      riskNotes: 'not array',
      updatedAt: '189-09-01',
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('type');
    expect(result.errors.join('\n')).toContain('status');
    expect(result.errors.join('\n')).toContain('scaleLevel');
    expect(result.errors.join('\n')).toContain('agriculture');
    expect(result.errors.join('\n')).toContain('commerce');
    expect(result.errors.join('\n')).toContain('riskNotes');
  });

  it('accepts legacy-shaped model domestic reports outside the reserved namespace', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertDomesticReport',
      reportId: 'domestic_189',
      year: 189,
      settledAt: '189-09-01',
      title: 'Autumn accounts',
      summary: 'The year-end domestic report is ready for the player to review.',
      income: { money: 100, grain: 2000, horses: 3, arms: 10, recruits: 80 },
      expenses: { money: 10, grain: 300, horses: 1, arms: 2, recruits: 0 },
      netChange: { money: 90, grain: 1700, horses: 2, arms: 8, recruits: 80 },
      holdingHighlights: [{ holdingId: 'holding_yingchuan', summary: 'Harvest was stable.' }],
      warnings: ['corruption rising'],
      readByPlayer: false,
    } as any);

    expect(result.valid).toBe(true);
  });

  it.each([
    { reportId: 'system:holding-annual:189' },
    { reportId: ' SYSTEM:holding-annual:189 ' },
    { reportId: 'model_report_189', source: 'system' },
    { reportId: 'model_report_189', source: ' system ' },
    { reportId: 'model_report_189', source: 'SyStEm' },
    { reportId: 'model_report_189', kind: 'holdingAnnualSettlement' },
    { reportId: 'model_report_189', kind: ' holdingAnnualSettlement ' },
    { reportId: 'model_report_189', kind: 'HoldingAnnualSettlement' },
  ])('rejects model domestic reports that claim the reserved system namespace: %o', (reservedFields) => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertDomesticReport',
      year: 189,
      settledAt: '189-09-01',
      title: 'Model report',
      summary: 'A model-authored special domestic report.',
      income: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      readByPlayer: false,
      ...reservedFields,
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('reserved for local system reports');
  });

  it.each([
    { reportId: 'system:holding-monthly-upkeep:189-05' },
    { reportId: ' SYSTEM:holding-monthly-upkeep:189-05 ' },
    { reportId: 'model_report_189_05', kind: 'holdingMonthlyUpkeep' },
    { reportId: 'model_report_189_05', kind: ' holdingMonthlyUpkeep ' },
    { reportId: 'model_report_189_05', kind: 'HoldingMonthlyUpkeep' },
  ])('rejects model reports that claim monthly-upkeep system identity: %o', (reservedFields) => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertDomesticReport',
      year: '189-05',
      settledAt: '189-05-01',
      title: 'Forged monthly upkeep',
      summary: 'The model must not write local upkeep reports.',
      income: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      readByPlayer: false,
      ...reservedFields,
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('reserved for local system reports');
  });

  it('accepts project highlights without optional assetId and rejects a provided blank assetId', () => {
    const baseCommand = {
      action: 'upsertDomesticReport',
      reportId: 'model_project_report_189',
      year: 189,
      settledAt: '189-06-01',
      title: 'Project report',
      summary: 'A model-authored project update.',
      income: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      readByPlayer: false,
    } as const;

    const withoutAssetId = validateLuanShiCommand(makeState(), {
      ...baseCommand,
      projectHighlights: [{ projectId: 'project_road', summary: 'Road work began.' }],
    } as any);
    const blankAssetId = validateLuanShiCommand(makeState(), {
      ...baseCommand,
      projectHighlights: [{ projectId: 'project_road', assetId: ' ', summary: 'Road work began.' }],
    } as any);

    expect(withoutAssetId.valid).toBe(true);
    expect(withoutAssetId.errors).toEqual([]);
    expect(blankAssetId.valid).toBe(false);
    expect(blankAssetId.errors.join('\n')).toContain('projectHighlights[0].assetId');
  });

  it('accepts heroine and non-heroine bond relationship writebacks', () => {
    const heroineResult = validateLuanShiCommand(makeStateWithFemaleNpc(28), {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_npc_he_lady',
      npcId: 'npc_he_lady',
      npcName: 'Lady He',
      status: 'active',
      stage: 'trust-forming',
      relationshipRole: 'confidante',
      summary: 'A growing private relationship thread with court risk.',
      currentPull: 'She is waiting for a reliable sign of protection.',
      riskNotes: 'Court exposure would endanger both sides.',
      promiseNotes: 'The player promised discreet protection.',
      recentProgress: 'A guarded conversation deepened trust.',
      tags: ['court', 'confidante'],
      milestones: [{
        milestoneId: 'milestone_first_trust',
        happenedAt: '189-09-01',
        summary: 'They reached a first private understanding.',
        source: 'test',
      }],
      lastUpdatedAt: '189-09-01',
      source: 'test',
    } as any);

    expect(heroineResult.valid).toBe(true);
    expect(heroineResult.errors).toEqual([]);

    const bondResult = validateLuanShiCommand(makeState(), {
      action: 'upsertBondThread',
      bondThreadId: 'bond_oath_chen',
      targetNpcIds: ['npc_chen_heng'],
      targetNames: ['Chen Heng'],
      bondType: 'sworn',
      status: 'active',
      summary: 'A sworn-brotherhood style bond with battlefield obligations.',
      currentTension: 'Both sides expect each other to hold the gate.',
      promiseNotes: 'They agreed to protect the same refugees.',
      conflictNotes: 'A failed defense would strain the bond.',
      recentProgress: 'The bond became public after shared danger.',
      tags: ['oath'],
      milestones: [{
        milestoneId: 'milestone_gate_oath',
        happenedAt: '189-09-01',
        summary: 'They exchanged an oath before the retreat.',
      }],
      lastUpdatedAt: '189-09-01',
      source: 'test',
    } as any);

    expect(bondResult.valid).toBe(true);
    expect(bondResult.errors).toEqual([]);

    const scalarTargetNamesResult = validateLuanShiCommand(makeState(), {
      action: 'upsertBondThread',
      bondThreadId: 'bond_oath_zhao',
      targetNames: 'Zhao Wu',
      bondType: 'sworn',
      status: 'active',
      summary: 'A sworn-brotherhood style bond created during a street crisis.',
      lastUpdatedAt: '189-09-01',
    } as any);

    expect(scalarTargetNamesResult.valid).toBe(true);
    expect(scalarTargetNamesResult.errors).toEqual([]);
  });

  it('rejects heroine relationship writeback for existing underage NPCs', () => {
    const result = validateLuanShiCommand(makeStateWithFemaleNpc(17), {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_npc_he_lady',
      npcId: 'npc_he_lady',
      npcName: 'Lady He',
      status: 'active',
      stage: 'trust-forming',
      relationshipRole: 'confidante',
      summary: 'This should be rejected by the adult gate.',
      lastUpdatedAt: '189-09-01',
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('adult');
  });

  it('rejects malformed generic bond writebacks and keeps heroine out of bond types', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertBondThread',
      bondThreadId: '',
      targetNames: [],
      bondType: 'heroine',
      status: 'ongoing',
      summary: '',
      lastUpdatedAt: '',
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('bondThreadId');
    expect(result.errors.join('\n')).toContain('targetNames');
    expect(result.errors.join('\n')).toContain('bondType');
    expect(result.errors.join('\n')).toContain('status');
    expect(result.errors.join('\n')).toContain('summary');
    expect(result.errors.join('\n')).toContain('lastUpdatedAt');
  });

  it('requires complete relationship records on create but accepts partial patches for existing stable ids', () => {
    const state = {
      ...makeStateWithFemaleNpc(28),
      heroineThreads: [{
        heroineThreadId: 'heroine_npc_he_lady',
        npcId: 'npc_he_lady',
        npcName: '何氏',
        status: 'active' as const,
        stage: 'trust-forming',
        relationshipRole: 'confidante',
        summary: 'A private relationship thread.',
        riskNotes: 'Court exposure remains dangerous.',
        tags: ['court'],
        milestones: [{
          milestoneId: 'heroine_m1',
          happenedAt: '189-09-01',
          summary: 'They reached a first understanding.',
        }],
        lastUpdatedAt: '189-09-01',
      }],
      bondThreads: [{
        bondThreadId: 'bond_oath_chen',
        targetNpcIds: ['npc_chen_heng'],
        targetNames: ['陈衡'],
        bondType: 'sworn' as const,
        status: 'active' as const,
        summary: 'A sworn bond.',
        promiseNotes: 'They promised mutual aid.',
        lastUpdatedAt: '189-09-01',
      }],
    };

    const heroinePatch = validateLuanShiCommand(state, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_npc_he_lady',
      stage: 'trust-deepened',
      riskNotes: null,
      tags: null,
      milestones: null,
    });
    const bondPatch = validateLuanShiCommand(state, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_oath_chen',
      summary: 'The sworn bond deepened.',
      promiseNotes: null,
      targetNpcIds: null,
    });

    expect(heroinePatch.valid).toBe(true);
    expect(heroinePatch.errors).toEqual([]);
    expect(bondPatch.valid).toBe(true);
    expect(bondPatch.errors).toEqual([]);

    expect(validateLuanShiCommand(makeStateWithFemaleNpc(28), {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_incomplete',
      stage: 'trust-forming',
    } as any).valid).toBe(false);
    expect(validateLuanShiCommand(makeState(), {
      action: 'upsertBondThread',
      bondThreadId: 'bond_incomplete',
      summary: 'Missing required relationship fields.',
    } as any).valid).toBe(false);
  });

  it('validates final bond targets and reserves null for switching to valid name-only mode', () => {
    const state = {
      ...makeState(),
      bondThreads: [{
        bondThreadId: 'bond_oath_chen',
        targetNpcIds: ['npc_chen_heng'],
        targetNames: ['陈衡'],
        bondType: 'sworn' as const,
        status: 'active' as const,
        summary: 'A sworn bond.',
        lastUpdatedAt: '189-09-01',
      }],
    };
    const danglingState = {
      ...state,
      bondThreads: [{
        ...state.bondThreads[0],
        targetNpcIds: ['npc_missing'],
        targetNames: ['Invented Name'],
      }],
    };

    expect(validateLuanShiCommand(state, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_oath_chen',
      targetNames: ['Forged Name'],
    }).valid).toBe(true);

    const danglingPatch = validateLuanShiCommand(danglingState, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_oath_chen',
      summary: 'Only the summary changed.',
    });
    expect(danglingPatch.valid).toBe(false);
    expect(danglingPatch.errors.join('\n')).toContain('npc_missing');

    const danglingUndefinedPatch = validateLuanShiCommand(danglingState, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_oath_chen',
      targetNpcIds: undefined,
      targetNames: ['Forged Name'],
    });
    expect(danglingUndefinedPatch.valid).toBe(false);
    expect(danglingUndefinedPatch.errors.join('\n')).toContain('npc_missing');

    expect(validateLuanShiCommand(state, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_oath_chen',
      targetNpcIds: null,
      targetNames: ['Name-only Contact'],
    }).valid).toBe(true);
  });

  it('uses system-managed relationship timestamps and rejects explicit null', () => {
    const state = {
      ...makeStateWithFemaleNpc(28),
      heroineThreads: [{
        heroineThreadId: 'heroine_npc_he_lady',
        npcId: 'npc_he_lady',
        npcName: '何氏',
        status: 'active' as const,
        stage: 'trust-forming',
        relationshipRole: 'confidante',
        summary: 'A private relationship thread.',
        lastUpdatedAt: '189-09-01',
      }],
      bondThreads: [{
        bondThreadId: 'bond_oath_chen',
        targetNpcIds: ['npc_chen_heng'],
        targetNames: ['陈衡'],
        bondType: 'sworn' as const,
        status: 'active' as const,
        summary: 'A sworn bond.',
        lastUpdatedAt: '189-09-01',
      }],
    };

    const heroineBlank = validateLuanShiCommand(state, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_npc_he_lady',
      summary: 'Updated with a blank managed timestamp.',
      lastUpdatedAt: '   ',
    });
    const bondBlank = validateLuanShiCommand(state, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_oath_chen',
      summary: 'Updated with a blank managed timestamp.',
      lastUpdatedAt: '',
    });
    expect(heroineBlank.valid).toBe(false);
    expect(heroineBlank.errors.join('\n')).toContain('lastUpdatedAt');
    expect(bondBlank.valid).toBe(false);
    expect(bondBlank.errors.join('\n')).toContain('lastUpdatedAt');

    const heroineNull = validateLuanShiCommand(state, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_npc_he_lady',
      lastUpdatedAt: null,
    } as any);
    const bondNull = validateLuanShiCommand(state, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_oath_chen',
      lastUpdatedAt: null,
    } as any);
    expect(heroineNull.valid).toBe(false);
    expect(heroineNull.errors.join('\n')).toContain('lastUpdatedAt');
    expect(bondNull.valid).toBe(false);
    expect(bondNull.errors.join('\n')).toContain('lastUpdatedAt');
  });

  it('rejects dangling heroine and bond NPC references', () => {
    const missingHeroineNpc = validateLuanShiCommand(makeState(), {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_missing',
      npcId: 'npc_missing',
      npcName: 'Invented Name',
      status: 'active',
      stage: 'trust-forming',
      relationshipRole: 'confidante',
      summary: 'This relationship must not be persisted.',
    });
    const missingBondNpc = validateLuanShiCommand(makeState(), {
      action: 'upsertBondThread',
      bondThreadId: 'bond_missing',
      targetNpcIds: ['npc_chen_heng', 'npc_missing'],
      targetNames: ['Wrong Name', 'Invented Name'],
      bondType: 'sworn',
      status: 'active',
      summary: 'This bond must not retain a dangling target.',
    });

    expect(missingHeroineNpc.valid).toBe(false);
    expect(missingHeroineNpc.errors.join('\n')).toContain('npc_missing');
    expect(missingBondNpc.valid).toBe(false);
    expect(missingBondNpc.errors.join('\n')).toContain('npc_missing');
  });

  it('rejects malformed legacy relationship collections and nested fields without throwing', () => {
    const validHeroine = {
      heroineThreadId: 'heroine_npc_he_lady',
      npcId: 'npc_he_lady',
      npcName: '何氏',
      status: 'active' as const,
      stage: 'trust-forming',
      relationshipRole: 'confidante',
      summary: 'A private relationship thread.',
      lastUpdatedAt: '189-09-01',
    };
    const validBond = {
      bondThreadId: 'bond_oath_chen',
      targetNames: ['陈衡'],
      bondType: 'sworn' as const,
      status: 'active' as const,
      summary: 'A sworn bond.',
      lastUpdatedAt: '189-09-01',
    };
    const cases = [
      {
        state: { ...makeStateWithFemaleNpc(28), heroineThreads: {} as any },
        command: {
          action: 'upsertHeroineThread' as const,
          heroineThreadId: 'heroine_npc_he_lady',
          summary: 'A safe partial update.',
        },
        diagnostic: 'heroineThreads',
      },
      {
        state: { ...makeStateWithFemaleNpc(28), heroineThreads: [null] as any },
        command: {
          action: 'upsertHeroineThread' as const,
          heroineThreadId: 'heroine_npc_he_lady',
          summary: 'A safe partial update.',
        },
        diagnostic: 'heroineThreads[0]',
      },
      {
        state: {
          ...makeStateWithFemaleNpc(28),
          heroineThreads: [{ ...validHeroine, milestones: {} as any }],
        },
        command: {
          action: 'upsertHeroineThread' as const,
          heroineThreadId: 'heroine_npc_he_lady',
          summary: 'A safe partial update.',
        },
        diagnostic: 'heroineThreads[0].milestones',
      },
      {
        state: {
          ...makeState(),
          bondThreads: [{ ...validBond, targetNpcIds: 7 as any }],
        },
        command: {
          action: 'upsertBondThread' as const,
          bondThreadId: 'bond_oath_chen',
          summary: 'A safe partial update.',
        },
        diagnostic: 'bondThreads[0].targetNpcIds',
      },
    ];

    for (const testCase of cases) {
      const validation = validateLuanShiCommand(testCase.state, testCase.command);
      expect(validation.valid).toBe(false);
      expect(validation.errors.join('\n')).toContain(testCase.diagnostic);
    }
  });

  it('validates every persisted heroine record and rejects duplicate heroine thread ids', () => {
    const state = makeStateWithFemaleNpc(28);
    const target = {
      heroineThreadId: 'heroine_target',
      npcId: 'npc_he_lady',
      npcName: '何氏',
      status: 'active' as const,
      stage: 'trust-forming',
      relationshipRole: 'confidante',
      summary: 'The target heroine thread.',
      lastUpdatedAt: '189-09-01',
    };
    const validation = validateLuanShiCommand({
      ...state,
      heroineThreads: [
        target,
        {
          ...target,
          heroineThreadId: 'heroine_broken_sibling',
          npcId: 'npc_missing_sibling',
          tags: 'not-an-array' as any,
          milestones: [{}] as any,
        },
        { ...target },
      ],
    }, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_target',
      summary: 'Only the target summary changes.',
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.join('\n')).toContain('heroineThreads[1].tags');
    expect(validation.errors.join('\n')).toContain('heroineThreads[1].milestones[0]');
    expect(validation.errors.join('\n')).toContain('npc_missing_sibling');
    expect(validation.errors.join('\n')).toContain('heroineThreads[2].heroineThreadId');
    expect(validation.errors.join('\n').toLowerCase()).toContain('duplicate');
  });

  it('validates every persisted bond record and rejects duplicate bond thread ids', () => {
    const state = makeState();
    const target = {
      bondThreadId: 'bond_target',
      targetNpcIds: ['npc_chen_heng'],
      targetNames: ['陈衡'],
      bondType: 'ally' as const,
      status: 'active' as const,
      summary: 'The target bond thread.',
      lastUpdatedAt: '189-09-01',
    };
    const validation = validateLuanShiCommand({
      ...state,
      bondThreads: [
        target,
        {
          ...target,
          bondThreadId: 'bond_broken_sibling',
          targetNpcIds: ['npc_missing_sibling'],
          bondType: 'invalid' as any,
          milestones: {} as any,
        },
        { ...target },
      ],
    }, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_target',
      summary: 'Only the target summary changes.',
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.join('\n')).toContain('bondThreads[1].bondType');
    expect(validation.errors.join('\n')).toContain('bondThreads[1].milestones');
    expect(validation.errors.join('\n')).toContain('npc_missing_sibling');
    expect(validation.errors.join('\n')).toContain('bondThreads[2].bondThreadId');
    expect(validation.errors.join('\n').toLowerCase()).toContain('duplicate');
  });

  it('uses trimmed canonical stable keys for relationship lookup and duplicate detection', () => {
    const heroineTarget = {
      heroineThreadId: ' heroine_canonical ',
      npcId: 'npc_he_lady',
      npcName: '何氏',
      status: 'active' as const,
      stage: 'trust-forming',
      relationshipRole: 'confidante',
      summary: 'An existing heroine thread.',
      lastUpdatedAt: '189-09-01',
    };
    const bondTarget = {
      bondThreadId: ' bond_canonical ',
      targetNpcIds: ['npc_chen_heng'],
      targetNames: ['陈衡'],
      bondType: 'ally' as const,
      status: 'active' as const,
      summary: 'An existing bond thread.',
      lastUpdatedAt: '189-09-01',
    };

    expect(validateLuanShiCommand({
      ...makeStateWithFemaleNpc(28),
      heroineThreads: [heroineTarget],
    }, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_canonical',
      summary: 'Matched by the canonical key.',
    }).valid).toBe(true);
    expect(validateLuanShiCommand({
      ...makeState(),
      bondThreads: [bondTarget],
    }, {
      action: 'upsertBondThread',
      bondThreadId: ' bond_canonical ',
      summary: 'Matched by the canonical key.',
    }).valid).toBe(true);

    const heroineDuplicate = validateLuanShiCommand({
      ...makeStateWithFemaleNpc(28),
      heroineThreads: [heroineTarget, { ...heroineTarget, heroineThreadId: 'heroine_canonical' }],
    }, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_canonical',
      summary: 'Must not update duplicate logical ids.',
    });
    const bondDuplicate = validateLuanShiCommand({
      ...makeState(),
      bondThreads: [bondTarget, { ...bondTarget, bondThreadId: 'bond_canonical' }],
    }, {
      action: 'upsertBondThread',
      bondThreadId: 'bond_canonical',
      summary: 'Must not update duplicate logical ids.',
    });

    expect(heroineDuplicate.valid).toBe(false);
    expect(heroineDuplicate.errors.join('\n')).toContain('duplicate: heroine_canonical');
    expect(bondDuplicate.valid).toBe(false);
    expect(bondDuplicate.errors.join('\n')).toContain('duplicate: bond_canonical');
  });

  it('treats a new heroine thread id for the same npcId as an update to the canonical thread', () => {
    const state = {
      ...makeStateWithFemaleNpc(28),
      currentDate: '公元194年05月03日 17:00（酉时）',
      heroineThreads: [{
        heroineThreadId: 'bond_player_he_conquest',
        npcId: 'npc_he_lady',
        npcName: '何氏',
        status: 'active' as const,
        stage: '随军宠妾',
        relationshipRole: '爱妾',
        summary: '既有关系线。',
        tags: ['随军'],
        lastUpdatedAt: '公元194年05月03日 08:00（辰时）',
      }],
    };
    const command = {
      action: 'upsertHeroineThread' as const,
      heroineThreadId: 'thread_heroine_he',
      npcId: 'npc_he_lady',
      stage: '死心相托',
      summary: '关系在本回合继续推进。',
      tags: ['随军', '托付'],
    };

    expect(validateLuanShiCommand(state, command)).toMatchObject({ valid: true, errors: [] });
    const next = applyLuanShiCommand(state, command);
    expect(next.heroineThreads).toHaveLength(1);
    expect(next.heroineThreads[0]).toMatchObject({
      heroineThreadId: 'bond_player_he_conquest',
      npcId: 'npc_he_lady',
      stage: '死心相托',
      summary: '关系在本回合继续推进。',
      tags: ['随军', '托付'],
      lastUpdatedAt: '公元194年05月03日 17:00（酉时）',
    });
  });

  it('rejects redirecting an existing heroine thread id to a different npcId', () => {
    const base = makeStateWithFemaleNpc(28);
    const other = { ...base.npcs!.find((npc) => npc.npcId === 'npc_he_lady')!, npcId: 'npc_other_lady' };
    const state = {
      ...base,
      npcs: [...base.npcs!, other],
      heroineThreads: [{
        heroineThreadId: 'heroine_he',
        npcId: 'npc_he_lady',
        npcName: '何氏',
        status: 'active' as const,
        stage: '信任初成',
        relationshipRole: '红颜知己',
        summary: '既有关系线。',
        lastUpdatedAt: '公元189年09月01日 12:00（午时）',
      }],
    };
    const validation = validateLuanShiCommand(state, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_he',
      npcId: 'npc_other_lady',
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.join('\n')).toContain('cannot change npcId');
  });
});

function makeStateWithFemaleNpc(age: number): RuntimeState {
  const state = ensureLuanShiState(makeState());
  const template = state.npcs[0];
  return {
    ...state,
    npcs: [
      ...state.npcs,
      {
        ...template,
        npcId: 'npc_he_lady',
        name: '何氏',
        sex: '女',
        age,
        role: '士族女性',
        isPresent: true,
        isFocused: true,
        summary: '士族女性，与当前局势有所牵连。',
        appearance: '仪态端庄。',
        personality: '谨慎克制。',
        motivation: '保全家族。',
        relationToPlayer: '礼节往来。',
        contactLevel: 12,
        recentAttitude: '谨慎',
        memories: [],
      },
    ],
  };
}

describe('troop movement location validation', () => {
  const stateWithMarchingTroop = applyLuanShiCommand(makeState(), {
    action: 'upsertTroopLedger',
    troopId: 'troop_marching_contract',
    name: '行军郡兵',
    size: 300,
    morale: 60,
    training: 55,
    supplies: 40,
    task: '向东门行军',
    relationToPlayer: 'self',
    locationId: 'place_south_camp',
    lastKnownLocationId: 'place_south_camp',
    destinationLocationId: 'place_east_gate',
    movementStatus: 'marching',
  } as any);

  it('rejects conflicting current and last-known positions in one writeback', () => {
    const result = validateLuanShiCommand(stateWithMarchingTroop, {
      action: 'upsertTroopLedger',
      troopId: 'troop_marching_contract',
      locationId: 'place_east_gate',
      lastKnownLocationId: 'place_south_camp',
      movementStatus: 'arrived',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('locationId 与 lastKnownLocationId');
  });

  it('rejects teleporting a troop while it is still marching', () => {
    const result = validateLuanShiCommand(stateWithMarchingTroop, {
      action: 'upsertTroopLedger',
      troopId: 'troop_marching_contract',
      locationId: 'place_east_gate',
      movementStatus: 'marching',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('行军未抵达');
  });

  it('accepts arrival at the existing destination and rejects a mismatched arrival target', () => {
    expect(validateLuanShiCommand(stateWithMarchingTroop, {
      action: 'upsertTroopLedger',
      troopId: 'troop_marching_contract',
      movementStatus: 'arrived',
    }).valid).toBe(true);

    const mismatch = validateLuanShiCommand(stateWithMarchingTroop, {
      action: 'upsertTroopLedger',
      troopId: 'troop_marching_contract',
      locationId: 'place_wrong_gate',
      movementStatus: 'arrived',
    });
    expect(mismatch.valid).toBe(false);
    expect(mismatch.errors.join('\n')).toContain('必须与目标地点一致');
  });

  it('requires a stable arrival location when no destination exists', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertTroopLedger',
      troopId: 'troop_arrival_without_target',
      name: '无目标援军',
      size: 100,
      morale: 50,
      training: 40,
      supplies: 30,
      task: '抵达待命',
      relationToPlayer: '友军',
      movementStatus: 'arrived',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('必须提供 locationId');
  });
});
