import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { buildFactionPanelModel } from './factionPanelModel';

const baseRuntimeState = {
  factions: [
    {
      factionId: 'faction_han_court',
      name: '汉廷',
      type: '朝廷',
      summary: '大汉朝廷，名义上统治天下。',
      stanceToPlayer: '名义从属',
      knownLevel: '听闻',
      recentActions: ['政令不出洛阳'],
    },
    {
      factionId: 'faction_yingchuan_clans',
      name: '颍川豪族',
      type: '豪族宗族',
      summary: '颍川荀氏、陈氏、钟氏等地方大族。',
      stanceToPlayer: '观望',
      knownLevel: '亲历',
      recentActions: ['暗中自保'],
      aliases: ['颍川士族'],
      nominalAllegiance: 'faction_han_court',
      legalIdentity: '地方豪族',
      actualController: 'npc_xun_shi',
      knownSphere: '颍川郡内士人、庄园与门生故吏网络',
      corePersonNpcIds: ['npc_xun_shi'],
      knownMemberNpcIds: ['npc_chen_shi'],
      relatedTroopIds: ['troop_clan_guards'],
      sourceNote: '士人闲谈',
      lastKnownAt: '公元189年09月01日 12:00（午时）',
      updatedAt: '公元189年09月01日 12:00（午时）',
    },
  ],
  npcs: [
    { npcId: 'npc_xun_shi', name: '荀氏族老' },
    { npcId: 'npc_chen_shi', name: '陈氏族人' },
  ],
  troops: [
    {
      troopId: 'troop_clan_guards',
      name: '宗族部曲',
      size: 120,
      morale: 60,
      training: 50,
      supplies: '尚可',
      task: '护庄',
      relationToPlayer: '观望',
      factionId: 'faction_yingchuan_clans',
    },
  ],
  holdings: [
    {
      holdingId: 'holding_yingchuan_manor',
      name: '颍川庄园',
      type: 'estate',
      status: 'contested',
      summary: '士族坞堡与庄园。',
      factionId: 'faction_yingchuan_clans',
      scaleLevel: 2,
      agriculture: 55,
      commerce: 35,
      population: 48,
      publicOrder: 42,
      popularSupport: 38,
      defense: 50,
      recruitPotential: 30,
      armory: 20,
      horseSupply: 10,
      corruption: 15,
      updatedAt: '公元189年09月01日 12:00（午时）',
    },
  ],
  activeQuests: [
    {
      id: 'quest_clan_escort',
      title: '护送族老',
      description: '护送颍川族老离开险地。',
      status: 'active',
      relatedFactionIds: ['faction_yingchuan_clans'],
      createdAt: '公元189年09月01日 12:00（午时）',
      updatedAt: '公元189年09月01日 12:00（午时）',
    },
  ],
  knownRumors: [
    {
      id: 'rumor_clan_forts',
      title: '颍川豪族暗结坞堡',
      content: '有人说颍川豪族正暗中联络坞堡。',
      source: '酒肆',
      relatedFactionId: 'faction_yingchuan_clans',
      verified: false,
      createdAt: '公元189年09月01日 12:00（午时）',
    },
  ],
  worldTrends: [
    {
      trendId: 'trend_gentry_self_preservation',
      title: '士族自保',
      severity: '中',
      summary: '颍川豪族开始暗中联络坞堡。',
      knownToPlayer: true,
      relatedFactionIds: ['faction_yingchuan_clans'],
      updatedAt: '公元189年09月01日 12:00（午时）',
    },
  ],
  resources: {
    money: 3,
    grain: 200,
    horses: 8,
    weapons: ['环首刀'],
    documents: ['北军符验'],
    tokens: [],
    importantSupplies: [],
  },
} as unknown as RuntimeState;

describe('factionPanelModel', () => {
  it('builds a roster and selected detail from known factions', () => {
    const model = buildFactionPanelModel(baseRuntimeState, 'faction_yingchuan_clans');

    expect(model.rosterItems).toEqual([
      {
        factionId: 'faction_han_court',
        name: '汉廷',
        type: '朝廷',
        stanceToPlayer: '名义从属',
        knownLevel: '听闻',
      },
      {
        factionId: 'faction_yingchuan_clans',
        name: '颍川豪族',
        type: '豪族宗族',
        stanceToPlayer: '观望',
        knownLevel: '亲历',
      },
    ]);
    expect(model.selectedFaction?.name).toBe('颍川豪族');
    expect(model.selectedFaction?.recentActions).toEqual(['暗中自保']);
    expect(model.selectedFaction?.nominalAllegiance).toBe('faction_han_court');
    expect(model.selectedFaction?.legalIdentity).toBe('地方豪族');
    expect(model.selectedFaction?.knownSphere).toBe('颍川郡内士人、庄园与门生故吏网络');
    expect(model.selectedFaction?.corePersonNpcIds).toEqual(['npc_xun_shi']);
    expect(model.selectedFaction?.relatedTroopIds).toEqual(['troop_clan_guards']);
    expect(model.detailRows).toEqual(expect.arrayContaining([
      { label: '类型', value: '豪族宗族' },
      { label: '别名', value: '颍川士族' },
      { label: '名义归属', value: '汉廷' },
      { label: '实际主事', value: '荀氏族老' },
      { label: '已知势力范围', value: '颍川郡内士人、庄园与门生故吏网络' },
    ]));
    expect(model.corePeople).toEqual(['荀氏族老']);
    expect(model.knownMembers).toEqual(['陈氏族人']);
    expect(model.relatedTroops).toEqual(['宗族部曲']);
    expect(model.relatedHoldings).toEqual(['颍川庄园（争夺中）']);
    expect(model.relatedMatters).toEqual(['护送族老']);
    expect(model.relatedSignals).toEqual(['颍川豪族暗结坞堡']);
    expect(model.relatedChronicles).toEqual(['士族自保：颍川豪族开始暗中联络坞堡。']);
    expect(model.recentActions).toEqual(['暗中自保']);
  });

  it('exposes compact summary and grouped detail rows for faction layout', () => {
    const model = buildFactionPanelModel(baseRuntimeState, 'faction_yingchuan_clans');

    expect(model.briefingRows).toEqual([
      { key: 'stance', label: '对玩家立场', value: '观望' },
      { key: 'controller', label: '实际主事', value: '荀氏族老' },
      { key: 'sphere', label: '已知范围', value: '颍川郡内士人、庄园与门生故吏网络' },
      { key: 'recentAction', label: '近期动作', value: '暗中自保' },
      { key: 'intelTime', label: '情报时间', value: '公元189年09月01日 12:00（午时）' },
      { key: 'risk', label: '风险提示', value: '存在变数，持续观察', tone: 'warning' },
    ]);
    expect(model.summaryRows).toEqual([
      { label: '类型', value: '豪族宗族' },
      { label: '对玩家态度', value: '观望' },
      { label: '已知势力范围', value: '颍川郡内士人、庄园与门生故吏网络' },
      { label: '情报来源', value: '士人闲谈' },
    ]);
    expect(model.detailSections.map((section) => section.title)).toEqual([
      '身份与主事',
      '情报时间',
    ]);
    expect(model.detailSections[0].rows).toEqual(expect.arrayContaining([
      { label: '别名', value: '颍川士族' },
      { label: '名义归属', value: '汉廷' },
      { label: '合法身份', value: '地方豪族' },
      { label: '实际主事', value: '荀氏族老' },
    ]));
    expect(model.detailSections[1].rows).toEqual(expect.arrayContaining([
      { label: '消息时间', value: '公元189年09月01日 12:00（午时）' },
      { label: '更新于', value: '公元189年09月01日 12:00（午时）' },
    ]));
  });

  it('falls back to the first faction and keeps resources out of the faction panel model', () => {
    const model = buildFactionPanelModel(baseRuntimeState, 'missing_faction');

    expect(model.selectedFactionId).toBe('faction_han_court');
    expect(model.selectedFaction?.name).toBe('汉廷');
    expect(model).not.toHaveProperty('resourceRows');
  });

  it('formats common faction type enums for player-facing text', () => {
    const model = buildFactionPanelModel({
      ...baseRuntimeState,
      factions: [
        {
          ...baseRuntimeState.factions![0],
          factionId: 'faction_shuhan',
          name: '蜀汉',
          type: 'regime',
        },
      ],
    } as unknown as RuntimeState, 'faction_shuhan');

    expect(model.rosterItems[0].type).toBe('政权');
    expect(model.detailRows).toContainEqual({ label: '类型', value: '政权' });
  });

  it('formats legacy warlord faction type aliases without showing an unclassified faction', () => {
    const model = buildFactionPanelModel({
      ...baseRuntimeState,
      factions: [
        {
          ...baseRuntimeState.factions![0],
          factionId: 'faction_jingzhou_liubiao',
          name: '荆州牧刘表',
          type: 'warlord',
        },
      ],
    } as unknown as RuntimeState, 'faction_jingzhou_liubiao');

    expect(model.rosterItems[0].type).toBe('军阀集团');
    expect(model.detailRows).toContainEqual({ label: '类型', value: '军阀集团' });
    expect(JSON.stringify(model)).not.toContain('未分类势力');
  });

  it('does not expose unknown enum-like faction fields in visible rows', () => {
    const model = buildFactionPanelModel({
      ...baseRuntimeState,
      factions: [
        {
          ...baseRuntimeState.factions![0],
          factionId: 'faction_unknown_enum',
          name: '边郡军府',
          type: 'unmapped_faction_kind',
          stanceToPlayer: 'subordinate_command',
          nominalAllegiance: 'faction_missing_parent',
          actualController: 'npc_missing_steward',
        },
      ],
      holdings: [
        {
          ...baseRuntimeState.holdings![0],
          name: '边郡仓城',
          factionId: 'faction_unknown_enum',
          status: 'ledger_pending',
        },
      ],
    } as unknown as RuntimeState, 'faction_unknown_enum');

    const visibleText = JSON.stringify([
      model.rosterItems,
      model.detailRows,
      model.relatedHoldings,
    ]);

    expect(model.rosterItems[0]).toMatchObject({
      type: '势力类型待核',
      stanceToPlayer: '态度未明',
    });
    expect(model.detailRows).toEqual(expect.arrayContaining([
      { label: '名义归属', value: '未登记势力' },
      { label: '实际主事', value: '未登记人物' },
    ]));
    expect(model.relatedHoldings).toEqual(['边郡仓城（状态未明）']);
    expect(visibleText).not.toContain('unmapped_faction_kind');
    expect(visibleText).not.toContain('subordinate_command');
    expect(visibleText).not.toContain('ledger_pending');
  });

  it('does not expose terminal historical troops through current faction relations', () => {
    const state = {
      ...baseRuntimeState,
      factions: baseRuntimeState.factions!.map((faction) => (
        faction.factionId === 'faction_yingchuan_clans'
          ? { ...faction, relatedTroopIds: ['troop_old_guard', 'troop_clan_guards'] }
          : faction
      )),
      troops: [
        ...(baseRuntimeState.troops ?? []),
        {
          troopId: 'troop_old_guard',
          name: '旧宗族部曲',
          size: 120,
          morale: 60,
          training: 50,
          supplies: '尚可',
          task: '历史建制',
          relationToPlayer: '观望',
          lifecycleStatus: 'merged',
          mergedIntoTroopId: 'troop_clan_guards',
        },
      ],
    } as unknown as RuntimeState;

    const model = buildFactionPanelModel(state, 'faction_yingchuan_clans');

    expect(model.selectedFaction?.relatedTroopIds).toEqual(['troop_clan_guards']);
    expect(model.relatedTroops).toEqual(['宗族部曲']);
    expect(JSON.stringify(model)).not.toContain('旧宗族部曲');
  });

  it('derives current related troops from authoritative troop factionId when faction links are omitted', () => {
    const state = {
      ...baseRuntimeState,
      factions: baseRuntimeState.factions!.map((faction) => (
        faction.factionId === 'faction_yingchuan_clans'
          ? { ...faction, relatedTroopIds: [] }
          : faction
      )),
      troops: (baseRuntimeState.troops ?? []).map((troop) => (
        troop.troopId === 'troop_clan_guards'
          ? { ...troop, factionId: 'faction_yingchuan_clans' }
          : troop
      )),
    } as RuntimeState;

    const model = buildFactionPanelModel(state, 'faction_yingchuan_clans');

    expect(model.selectedFaction?.relatedTroopIds).toEqual(['troop_clan_guards']);
    expect(model.relatedTroops).toEqual(['宗族部曲']);
  });

  it('does not present completed matters as current faction matters', () => {
    const state = {
      ...baseRuntimeState,
      activeQuests: [
        ...baseRuntimeState.activeQuests!,
        {
          ...baseRuntimeState.activeQuests![0],
          id: 'quest_completed_escort',
          title: '已经完成的旧护送',
          status: 'completed',
        },
      ],
    } as unknown as RuntimeState;

    const model = buildFactionPanelModel(state, 'faction_yingchuan_clans');

    expect(model.relatedMatters).toEqual(['护送族老']);
    expect(model.relatedMatters).not.toContain('已经完成的旧护送');
  });
});
