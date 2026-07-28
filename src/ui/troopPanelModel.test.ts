import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { buildTroopPanelModel } from './troopPanelModel';

const baseRuntimeState = {
  factions: [
    {
      factionId: 'faction_han_court',
      name: '汉廷',
      type: '朝廷',
      summary: '名义上统御天下的汉室朝廷。',
      stanceToPlayer: '自势力相关',
      knownLevel: '亲历',
      recentActions: ['整顿北军残部'],
    },
    {
      factionId: 'faction_dongzhuo',
      name: '董卓军',
      type: '军阀集团',
      summary: '董卓麾下西凉军。',
      stanceToPlayer: '敌对',
      knownLevel: '听闻',
      recentActions: [],
    },
  ],
  npcs: [
    {
      npcId: 'npc_chen_da',
      name: '陈达',
    },
  ],
  locations: [
    {
      locationId: 'place_luoyang_gate',
      name: '洛阳宫门',
    },
    {
      locationId: 'place_east_gate',
      name: '东门营',
    },
  ],
  troops: [
    {
      troopId: 'troop_yueqi',
      name: '越骑营残部',
      size: 220,
      previousSize: 300,
      factionId: 'faction_han_court',
      previousFactionId: 'faction_dongzhuo',
      allegianceChangedAt: '公元189年09月02日 12:00（午时）',
      allegianceChangeReason: '假降暴露后举兵响应主角',
      troopType: '骑兵',
      specialDesignation: '越骑营',
      quality: '高',
      fatigue: '高',
      readiness: '低',
      lifecycleStatus: 'active',
      statusTags: ['减员', '整顿中'],
      leaderNpcId: 'npc_chen_da',
      locationId: 'place_luoyang_gate',
      lastKnownLocationId: 'place_luoyang_gate',
      lastKnownAt: '公元189年09月01日 09:00（巳时）',
      knownLevel: '亲历',
      certainty: 'confirmed',
      morale: 52,
      training: 55,
      supplies: '粮草两日',
      task: '整顿伤卒',
      relationToPlayer: '自势力相关',
      orderStatus: 'issued',
      orderIssuedAt: '189-09-01 10:00',
      orderSummary: 'Tell the camp to leave the palace gate and move to the east gate after the courier arrives.',
      destinationLocationId: 'place_east_gate',
      routeId: 'route_luoyang_gate_to_east_gate',
      movementStatus: 'waitingOrder',
      estimatedArrivalAt: '189-09-01 16:00',
      movementNotes: 'Courier has not returned; current position remains the last confirmed gate.',
      lastBattleId: 'battle_luoyang_breakout',
      strengthTrend: 'decreased',
      lastChangeReason: '伏击后减员约八十人',
      updatedAt: '公元189年09月01日 09:00（巳时）',
    },
  ],
  conflicts: [
    {
      conflictId: 'battle_luoyang_breakout',
      type: '伏击',
      title: '洛阳宫门伏击',
      summary: '越骑营残部在宫门外遭遇西凉兵伏击。',
      occurredAt: '公元189年09月01日 08:45（辰时）',
      outcome: '突围成功但减员严重。',
      scope: 'selfRelated',
      recordLevel: 'full',
      involvedTroopIds: ['troop_yueqi'],
    },
  ],
} as unknown as RuntimeState;

describe('troopPanelModel', () => {
  it('builds a roster and selected detail from known troop ledger entries', () => {
    const model = buildTroopPanelModel(baseRuntimeState, 'troop_yueqi');

    expect(model.rosterItems).toEqual([
      {
        troopId: 'troop_yueqi',
        name: '越骑营残部',
        subtitle: '骑兵 / 汉廷',
        sizeText: '220人',
        statusText: '活跃',
        relationToPlayer: '自势力相关',
      },
    ]);
    expect(model.selectedTroopId).toBe('troop_yueqi');
    expect(model.selectedTroop?.name).toBe('越骑营残部');
    expect(model.detailRows).toEqual(expect.arrayContaining([
      { label: '所属势力', value: '汉廷' },
      { label: '前归属势力', value: '董卓军' },
      { label: '归属变更时间', value: '公元189年09月02日 12:00（午时）' },
      { label: '归属变更原因', value: '假降暴露后举兵响应主角' },
      { label: '主将', value: '陈达' },
      { label: '兵种', value: '骑兵' },
      { label: '规模', value: '220人', detail: '上次记录 300人' },
      { label: '精锐度', value: '高' },
      { label: '疲劳', value: '高' },
      { label: '整备', value: '低' },
      { label: '状态', value: '活跃' },
      { label: '可信度', value: '已确认' },
      { label: '兵力变化', value: '减员' },
      { label: '消息时间', value: '公元189年09月01日 09:00（巳时）' },
      { label: '当前位置', value: '洛阳宫门' },
      { label: '军令状态', value: '已下令' },
      { label: '军令发出', value: '189-09-01 10:00' },
      {
        label: '军令内容',
        value: 'Tell the camp to leave the palace gate and move to the east gate after the courier arrives.',
      },
      { label: '目标地点', value: '东门营' },
      { label: '行军路线', value: '未登记路线' },
      { label: '行军状态', value: '待接令' },
      { label: '预计抵达', value: '189-09-01 16:00' },
      { label: '行军说明', value: 'Courier has not returned; current position remains the last confirmed gate.' },
    ]));
    expect(model.statusTags).toEqual(['减员', '整顿中']);
    expect(model.recentBattles.map((battle) => battle.conflictId)).toEqual(['battle_luoyang_breakout']);
    expect(model.intelNotice).toContain('已知情报');
  });

  it('groups selected troop detail rows by player-reading priority for compact layout', () => {
    const model = buildTroopPanelModel(baseRuntimeState, 'troop_yueqi');

    expect(model.detailSections.map((section) => section.title)).toEqual([
      '统属与任务',
      '战力与状态',
      '军令与行军',
      '情报与沿革',
    ]);
    expect(model.detailSections[0].rows).toEqual(expect.arrayContaining([
      { label: '所属势力', value: '汉廷' },
      { label: '主将', value: '陈达' },
      { label: '当前任务', value: '整顿伤卒' },
      { label: '对玩家关系', value: '自势力相关' },
    ]));
    expect(model.detailSections[1].rows).toEqual(expect.arrayContaining([
      { label: '兵种', value: '骑兵' },
      { label: '规模', value: '220人', detail: '上次记录 300人' },
      { label: '士气', value: '52' },
      { label: '训练', value: '55' },
    ]));
    expect(model.detailSections[2].rows).toEqual(expect.arrayContaining([
      { label: '当前位置', value: '洛阳宫门' },
      { label: '军令状态', value: '已下令' },
      { label: '目标地点', value: '东门营' },
      { label: '行军状态', value: '待接令' },
    ]));
    expect(model.detailSections[3].rows).toEqual(expect.arrayContaining([
      { label: '可信度', value: '已确认' },
      { label: '前归属势力', value: '董卓军' },
      { label: '最近战事', value: '洛阳宫门伏击' },
    ]));
    expect(model.detailSections[1].rows).toContainEqual({ label: '兵力变化', value: '减员' });
  });

  it('groups the left roster by faction and exposes troops for the selected faction', () => {
    const model = buildTroopPanelModel({
      ...baseRuntimeState,
      troops: [
        baseRuntimeState.troops![0],
        {
          ...baseRuntimeState.troops![0],
          troopId: 'troop_archers',
          name: '弓弩残卒',
          size: 80,
          troopType: '弓弩兵',
          updatedAt: '公元189年09月01日 10:00（巳时）',
          lastKnownAt: '公元189年09月01日 10:00（巳时）',
        },
        {
          ...baseRuntimeState.troops![0],
          troopId: 'troop_xiliang',
          name: '西凉前锋',
          size: 3000,
          factionId: 'faction_dongzhuo',
          previousFactionId: undefined,
          relationToPlayer: '敌对',
          knownLevel: '听闻',
          troopType: '骑步混合',
          updatedAt: '公元189年09月01日 08:30（辰时）',
          lastKnownAt: '公元189年09月01日 08:30（辰时）',
        },
      ],
    } as unknown as RuntimeState, 'troop_archers');

    expect(model.groupItems).toEqual([
      {
        groupId: 'faction:faction_han_court',
        factionId: 'faction_han_court',
        name: '汉廷',
        subtitle: '朝廷',
        troopCount: 2,
        totalSizeText: '300人',
        relationSummary: '自势力相关',
        statusSummary: '活跃',
        firstTroopId: 'troop_archers',
      },
      {
        groupId: 'faction:faction_dongzhuo',
        factionId: 'faction_dongzhuo',
        name: '董卓军',
        subtitle: '军阀集团',
        troopCount: 1,
        totalSizeText: '3000人',
        relationSummary: '敌对',
        statusSummary: '活跃',
        firstTroopId: 'troop_xiliang',
      },
    ]);
    expect(model.groupItems.map((group) => group.name)).not.toContain('越骑营残部');
    expect(model.groupItems.map((group) => group.name)).not.toContain('弓弩残卒');
    expect(model.selectedGroupId).toBe('faction:faction_han_court');
    expect(model.groupTroops.map((troop) => troop.troopId)).toEqual(['troop_archers', 'troop_yueqi']);
    expect(model.selectedTroopId).toBe('troop_archers');
  });

  it('falls back to the first troop when selected troop is missing', () => {
    const model = buildTroopPanelModel(baseRuntimeState, 'missing_troop');

    expect(model.selectedTroopId).toBe('troop_yueqi');
    expect(model.selectedTroop?.troopId).toBe('troop_yueqi');
  });

  it('keeps terminal troop records out of the current roster after a regroup', () => {
    const regroupedState = {
      ...baseRuntimeState,
      troops: [
        {
          ...baseRuntimeState.troops![0],
          troopId: 'troop_new_cavalry',
          name: '精锐骑兵营',
          size: 600,
          lifecycleStatus: 'active',
        },
        {
          ...baseRuntimeState.troops![0],
          troopId: 'troop_old_camp',
          name: '南大营溃兵',
          size: 380,
          lifecycleStatus: 'merged',
          mergedIntoTroopId: 'troop_new_cavalry',
        },
      ],
    } as unknown as RuntimeState;
    const model = buildTroopPanelModel(regroupedState, 'troop_old_camp');

    expect((regroupedState.troops ?? []).map((troop) => troop.troopId)).toContain('troop_old_camp');
    expect(model.rosterItems.map((troop) => troop.troopId)).toEqual(['troop_new_cavalry']);
    expect(model.selectedTroopId).toBe('troop_new_cavalry');
    expect(model.groupItems).toHaveLength(1);
    expect(model.groupItems[0]).toMatchObject({ troopCount: 1, totalSizeText: '600人' });
  });

  it('formats mixed troop type labels instead of exposing enum values', () => {
    const model = buildTroopPanelModel({
      ...baseRuntimeState,
      troops: [
        {
          ...baseRuntimeState.troops![0],
          troopId: 'troop_mixed',
          name: '北伐锐卒',
          troopType: 'mixed',
          relationToPlayer: 'self',
        },
      ],
    } as unknown as RuntimeState, 'troop_mixed');

    expect(model.rosterItems[0].subtitle).toContain('混编');
    expect(model.groupItems[0].relationSummary).toBe('己方');
    expect(model.detailRows).toContainEqual({ label: '兵种', value: '混编' });
  });

  it('localizes direct-command troop records without exposing enum or id text', () => {
    const model = buildTroopPanelModel({
      ...baseRuntimeState,
      player: {
        id: 'player',
        name: '刘平',
        roleType: '宗室子弟',
        summary: '颍川太守府中的宗室旁支。',
      },
      factions: [
        {
          factionId: 'faction_yingchuan_gov',
          name: '颍川郡府',
          type: 'local_government',
          summary: '颍川地方官府。',
          stanceToPlayer: 'neutral',
          knownLevel: '亲历',
          recentActions: [],
        },
      ],
      troops: [
        {
          troopId: 'troop_player_yangdi_guard',
          name: '阳翟南营郡兵',
          size: 200,
          factionId: 'faction_yingchuan_gov',
          troopType: 'infantry',
          leaderNpcId: 'player',
          locationId: 'place_luoyang_gate',
          knownLevel: '亲历',
          morale: 60,
          training: 62,
          supplies: 40,
          fatigue: '低',
          readiness: '中',
          task: '驻防阳翟南门与周边营地。',
          relationToPlayer: 'subordinate',
          sourceNote: '刘平目前直接统领的部队',
          statusTags: ['粮饷拖欠', '本地农家子弟'],
        },
      ],
    } as unknown as RuntimeState, 'troop_player_yangdi_guard');

    const exposedText = JSON.stringify([
      model.groupItems,
      model.rosterItems,
      model.detailRows,
    ]);

    expect(exposedText).not.toContain('local_government');
    expect(exposedText).not.toContain('subordinate');
    expect(exposedText).not.toContain('未登记人物');
    expect(exposedText).not.toContain('未单独登记');
    expect(model.groupItems[0]).toMatchObject({
      name: '颍川郡府',
      subtitle: '地方官府',
      relationSummary: '受你统领',
    });
    expect(model.rosterItems[0]).toMatchObject({
      subtitle: '步卒 / 颍川郡府',
      relationToPlayer: '受你统领',
    });
    expect(model.detailRows).toEqual(expect.arrayContaining([
      { label: '指挥关系', value: '你直接统领' },
      { label: '主将', value: '刘平（你）' },
      { label: '对玩家关系', value: '受你统领' },
    ]));
  });

  it('treats self-commanded unbound troops as player direct troops and does not promote deputies to commander', () => {
    const model = buildTroopPanelModel({
      ...baseRuntimeState,
      player: {
        id: 'player',
        name: '刘峙',
        factionName: '荆州牧刘表',
        roleType: '宗室军吏',
        summary: '刘表麾下别部司马。',
      },
      npcs: [
        {
          npcId: 'npc_wangrui',
          name: '王锐',
          role: '军中副将',
          currentIdentity: '别部军侯',
          relationToPlayer: '下属',
          identitySummary: '刘峙麾下副手，负责日常带兵。',
        },
      ],
      troops: [
        {
          troopId: 'troop_player_beiting',
          name: '别部司马营',
          size: 200,
          troopType: '步卒',
          quality: '中',
          morale: 45,
          training: 55,
          supplies: 15,
          task: '戍卫北亭',
          relationToPlayer: 'self',
          leaderNpcId: 'npc_wangrui',
          statusTags: ['缺粮暂缓', '疲敝'],
        },
      ],
    } as unknown as RuntimeState, 'troop_player_beiting');

    const visibleText = JSON.stringify([
      model.groupItems,
      model.rosterItems,
      model.detailRows,
      model.overviewRows,
    ]);

    expect(visibleText).not.toContain('未明归属');
    expect(visibleText).not.toContain('未绑定势力');
    expect(model.groupItems[0]).toMatchObject({
      name: '荆州牧刘表',
      subtitle: '主角直属部队',
      relationSummary: '己方',
    });
    expect(model.rosterItems[0]).toMatchObject({
      subtitle: '步卒 / 荆州牧刘表',
      relationToPlayer: '己方',
    });
    expect(model.detailRows).toEqual(expect.arrayContaining([
      { label: '所属势力', value: '荆州牧刘表' },
      { label: '指挥关系', value: '你直接统领' },
      { label: '主将', value: '刘峙（你）' },
      { label: '带兵副手', value: '王锐' },
    ]));
  });

  it('does not show missing faction-ledger placeholders for player-commanded troops with a factionId', () => {
    const model = buildTroopPanelModel({
      ...baseRuntimeState,
      player: {
        id: 'player',
        name: '刘峙',
        factionId: 'faction_regional_actor',
        factionName: '地方军府',
        roleType: '军吏',
        summary: '地方军府麾下军吏。',
      },
      factions: [],
      troops: [
        {
          troopId: 'troop_player_minimal',
          name: '军府直属曲',
          size: 300,
          factionId: 'faction_regional_actor',
          troopType: '步卒',
          quality: '中',
          morale: 50,
          training: 60,
          supplies: 40,
          task: '城防巡视',
          relationToPlayer: '你直接统领',
          leaderNpcId: 'player',
        },
      ],
    } as unknown as RuntimeState, 'troop_player_minimal');

    const visibleText = JSON.stringify([
      model.groupItems,
      model.rosterItems,
      model.detailRows,
    ]);

    expect(visibleText).not.toContain('未登记势力');
    expect(visibleText).not.toContain('势力档案待补');
    expect(model.groupItems[0]).toMatchObject({
      name: '地方军府',
      subtitle: '主角直属部队',
    });
    expect(model.detailRows).toEqual(expect.arrayContaining([
      { label: '所属势力', value: '地方军府' },
      { label: '主将', value: '刘峙（你）' },
    ]));
  });

  it('uses player-facing troop condition labels for quality and lifecycle status', () => {
    const model = buildTroopPanelModel(baseRuntimeState, 'troop_yueqi');

    expect(model.detailRows).toEqual(expect.arrayContaining([
      { label: '精锐度', value: '高' },
      { label: '状态', value: '活跃' },
    ]));
    expect(model.detailRows.find((row) => row.label === '生命周期')).toBeUndefined();
    expect(model.detailRows.find((row) => row.label === '军质')).toBeUndefined();
    expect(model.detailSections[1].rows).toEqual(expect.arrayContaining([
      { label: '精锐度', value: '高' },
      { label: '状态', value: '活跃' },
    ]));
  });

  it('builds compact overview, condition and visual rows for the selected troop', () => {
    const model = buildTroopPanelModel(baseRuntimeState, 'troop_yueqi');

    expect(model.overviewRows).toEqual([
      { label: '所属势力', value: '汉廷' },
      { label: '主将', value: '陈达' },
      { label: '番号', value: '越骑营' },
      { label: '当前任务', value: '整顿伤卒' },
      { label: '当前位置', value: '洛阳宫门' },
      { label: '对玩家关系', value: '自势力相关' },
    ]);
    expect(model.conditionRows).toEqual([
      { label: '兵种', value: '骑兵' },
      { label: '规模', value: '220人', detail: '上次记录 300人' },
      { label: '精锐度', value: '高' },
      { label: '士气', value: '52' },
      { label: '训练', value: '55' },
      { label: '补给', value: '粮草两日' },
      { label: '整备', value: '低' },
      { label: '疲劳', value: '高' },
      { label: '状态', value: '活跃' },
    ]);
    expect(model.visualProfile).toEqual({
      troopTypeText: '骑兵',
      sizeText: '220人',
      qualityText: '高',
      caption: '骑兵 · 220人 · 精锐度 高',
    });
  });

  it('keeps stable naval troop types available to the visual asset resolver', () => {
    const sourceTroop = baseRuntimeState.troops?.[0];
    if (!sourceTroop) throw new Error('expected the troop fixture to be present');
    const navalTroop = {
      ...sourceTroop,
      troopId: 'troop_naval_fixture',
      name: '锦帆水军',
      troopType: 'naval',
      size: 800,
      quality: '高',
    };
    const model = buildTroopPanelModel({
      ...baseRuntimeState,
      troops: [navalTroop],
    } as unknown as RuntimeState, navalTroop.troopId);

    expect(model.visualProfile).toEqual({
      troopTypeText: '水军',
      sizeText: '800人',
      qualityText: '高',
      caption: '水军 · 800人 · 精锐度 高',
    });
  });

  it('does not display generic troop words as a troop type', () => {
    const model = buildTroopPanelModel({
      ...baseRuntimeState,
      troops: [
        {
          troopId: 'troop_generic_type',
          name: '颍川郡兵（刘平部）',
          size: 400,
          factionId: 'faction_han_court',
          troopType: '部队',
          knownLevel: '亲历',
          morale: 75,
          training: 60,
          supplies: '正常',
          task: '日常操练与阳翟城防',
          relationToPlayer: 'direct_command',
        },
      ],
    } as unknown as RuntimeState, 'troop_generic_type');

    expect(model.rosterItems[0].subtitle).toBe('汉廷');
    expect(model.detailRows).not.toContainEqual({ label: '兵种', value: '部队' });
    expect(model.detailRows.find((row) => row.label === '兵种')).toBeUndefined();
  });

  it('does not expose unknown enum-like troop status fields', () => {
    const model = buildTroopPanelModel({
      ...baseRuntimeState,
      troops: [
        {
          ...baseRuntimeState.troops![0],
          troopId: 'troop_status_enum_leak',
          name: '边郡巡兵',
          troopType: 'ledger_temp_force',
          lifecycleStatus: 'pending_internal_review',
          strengthTrend: 'delta_unknown_flag',
          certainty: 'system_shadow_state',
          orderStatus: 'queued_for_dispatch',
          movementStatus: 'route_pending_debug',
          relationToPlayer: 'command_state_pending',
        },
      ],
    } as unknown as RuntimeState, 'troop_status_enum_leak');

    const visibleText = JSON.stringify([
      model.groupItems,
      model.rosterItems,
      model.detailRows,
    ]);

    expect(model.rosterItems[0]).toMatchObject({
      subtitle: '汉廷',
      statusText: '状态未明',
      relationToPlayer: '关系未明',
    });
    expect(model.detailRows).toEqual(expect.arrayContaining([
      { label: '状态', value: '状态未明' },
      { label: '可信度', value: '可信度未明' },
      { label: '军令状态', value: '军令未明' },
      { label: '行军状态', value: '行军未明' },
      { label: '对玩家关系', value: '关系未明' },
      { label: '兵力变化', value: '变化未明' },
    ]));
    expect(model.detailRows.find((row) => row.label === '兵种')).toBeUndefined();
    expect(visibleText).not.toContain('ledger_temp_force');
    expect(visibleText).not.toContain('pending_internal_review');
    expect(visibleText).not.toContain('delta_unknown_flag');
    expect(visibleText).not.toContain('system_shadow_state');
    expect(visibleText).not.toContain('queued_for_dispatch');
    expect(visibleText).not.toContain('route_pending_debug');
    expect(visibleText).not.toContain('command_state_pending');
  });

  it('resolves Map V1 troop positions and routes while preserving current versus last-known semantics', () => {
    const mapState = {
      ...baseRuntimeState,
      player: {
        id: 'player',
        name: '刘平',
        roleType: '军吏',
        summary: '测试主角。',
      },
      mapNodes: [
        {
          id: 'place_map_current',
          name: '南门大营',
          level: '县城',
          mapLayer: 'place',
          summary: '南门外的军营。',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
        },
        {
          id: 'place_map_stale',
          name: '旧驻地',
          level: '县城',
          mapLayer: 'place',
          summary: '此前驻地。',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
        },
      ],
      routeEdges: [{
        routeId: 'route_map_march',
        fromPlaceId: 'place_map_stale',
        toPlaceId: 'place_map_current',
        name: '南门军道',
        status: 'open',
        source: 'llm',
        knownLevel: '亲历',
      }],
      troops: [
        {
          ...baseRuntimeState.troops![0],
          troopId: 'troop_player_map',
          name: '主角亲兵',
          leaderNpcId: 'player',
          relationToPlayer: 'self',
          locationId: 'place_map_current',
          lastKnownLocationId: 'place_map_stale',
          routeId: 'route_map_march',
        },
        {
          ...baseRuntimeState.troops![0],
          troopId: 'troop_remote_map',
          name: '远场敌军',
          leaderNpcId: 'npc_enemy',
          relationToPlayer: '敌对',
          locationId: 'place_map_current',
          lastKnownLocationId: 'place_map_stale',
        },
        {
          ...baseRuntimeState.troops![0],
          troopId: 'troop_unknown_position',
          name: '去向未明部队',
          leaderNpcId: 'npc_enemy',
          relationToPlayer: '敌对',
          locationId: undefined,
          lastKnownLocationId: undefined,
        },
        {
          ...baseRuntimeState.troops![0],
          troopId: 'troop_dangling_position',
          name: '失联部队',
          leaderNpcId: 'npc_enemy',
          relationToPlayer: '敌对',
          locationId: 'loc_unknown_remote',
          lastKnownLocationId: undefined,
        },
      ],
    } as unknown as RuntimeState;

    const playerModel = buildTroopPanelModel(mapState, 'troop_player_map');
    expect(playerModel.detailRows).toEqual(expect.arrayContaining([
      { label: '当前位置', value: '南门大营' },
      { label: '行军路线', value: '南门军道' },
    ]));

    const remoteModel = buildTroopPanelModel(mapState, 'troop_remote_map');
    expect(remoteModel.detailRows).toContainEqual({ label: '最后已知位置', value: '旧驻地' });
    expect(remoteModel.detailRows.find((row) => row.label === '当前位置')).toBeUndefined();

    expect(buildTroopPanelModel(mapState, 'troop_unknown_position').detailRows)
      .toContainEqual({ label: '最后已知位置', value: '位置未确认' });
    expect(buildTroopPanelModel(mapState, 'troop_dangling_position').detailRows)
      .toContainEqual({ label: '最后已知位置', value: '未登记地点' });
  });
});
