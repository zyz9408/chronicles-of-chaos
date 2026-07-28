import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { buildNpcPanelModel, selectNpcPrivateRecords } from './npcPanelModel';
import { readUiStyleSource } from './readUiStyleSource.test-helper';

const baseState: RuntimeState = {
  engineVersion: '0.1.0',
  worldBookId: 'threeKingdoms',
  worldBookVersion: '0.1.0',
  worldBookSource: 'official',
  startDate: '公元189年09月01日 08:00（辰时）',
  currentDate: '公元189年09月01日 09:30（巳时）',
  player: {
    id: 'player',
    name: '刘良',
    roleType: 'player',
    summary: '主角',
  },
  currentLocationId: 'place_luoyang_city',
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
      courtesyName: '子平',
      aliases: ['陈老卒'],
      commonAddress: '陈伍长',
      sex: '男',
      age: 43,
      role: '北军老卒',
      factionName: '北军',
      isPresent: true,
      isFocused: true,
      currentIdentity: '伍长',
      militaryTitle: '伍长',
      identitySummary: '在洛阳北军营中服役多年。',
      summary: '沉默寡言的老卒。',
      appearance: '面有刀疤，衣甲旧而整洁。',
      personality: '谨慎老成，愿意照看新卒。',
      motivation: '想活着离开乱局。',
      relationToPlayer: '同营旧识，对主角略有照拂。',
      contactLevel: 38,
      recentAttitude: '谨慎但愿意说实话',
      abilityScores: {
        武力: 62,
        统率: 58,
        智力: 51,
        政治: 37,
        魅力: 45,
        机运: 40,
      },
      traits: [
        {
          id: 'trait_veteran',
          label: '军中老练',
          description: '熟悉营中规矩。',
          source: 'history',
        },
      ],
      uniqueArts: [
        {
          id: 'art_gate_guard',
          name: 'Gate Guarding',
          rarity: 'green',
          domain: 'personalCombat',
          level: 1,
          description: 'Good at holding a narrow gate.',
          effectSummary: 'Useful in defensive personal combat.',
          source: 'history',
        },
      ],
      effects: [],
      memories: [
        {
          memoryId: 'mem_1',
          source: '亲历',
          content: '见过刘良在营门前压住慌乱。',
          createdAt: '公元189年09月01日 09:30（巳时）',
        },
      ],
    },
  ],
};

describe('buildNpcPanelModel', () => {
  it('builds a readable NPC panel model from runtime state writebacks', () => {
    const model = buildNpcPanelModel(baseState);

    expect(model.totalCount).toBe(1);
    expect(model.presentCount).toBe(1);
    expect(model.cards[0]).toMatchObject({
      id: 'npc_chen_heng',
      name: '陈衡',
      subtitle: '字子平 · 陈老卒 · 陈伍长',
      statusBadges: ['在场', '关注', '北军', '男 43岁'],
      relation: '同营旧识，对主角略有照拂。',
      contactLevel: 38,
    });
    expect(model.cards[0].identityRows).toContainEqual({
      label: '当前身份',
      value: '伍长',
      detail: undefined,
    });
    expect(model.cards[0].descriptionRows).toContainEqual({
      label: '性格',
      value: '谨慎老成，愿意照看新卒。',
    });
    expect(model.cards[0].memoryPreview).toEqual(['亲历｜公元189年09月01日 09:30（巳时）：见过刘良在营门前压住慌乱。']);
    expect(model.cards[0].traitLabels).toEqual(['军中老练']);
    expect(model.cards[0].uniqueArtLabels).toEqual(['Gate Guarding']);
    expect(model.cards[0].uniqueArtChips[0]).toMatchObject({
      label: 'Gate Guarding',
      rarity: 'green',
      levelText: 'Lv.1',
    });
    expect(model.cards[0].overviewRows).toEqual([
      expect.objectContaining({ label: '身份', value: '伍长' }),
      expect.objectContaining({ label: '关系', value: '谨慎但愿意说实话' }),
      { label: '行装', value: '未记录' },
      { label: '记忆', value: '1条' },
    ]);
    expect(model.cards[0].abilityRows).toEqual([
      { label: '武力', value: 62 },
      { label: '统率', value: 58 },
      { label: '智力', value: 51 },
      { label: '政治', value: 37 },
      { label: '魅力', value: 45 },
    ]);
    expect(model.cards[0].abilityRows.map((row) => row.label)).not.toContain('机运');
  });

  it('filters polluted protagonist self-clone NPCs while keeping same-name real NPCs', () => {
    const state: RuntimeState = {
      ...baseState,
      player: {
        ...baseState.player,
        name: '刘峙',
        courtesyName: '临渊',
        age: 24,
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
          age: 24,
          currentIdentity: '建威校尉',
          militaryTitle: '建威校尉',
          relationToPlayer: '本人',
          isPresent: true,
          isFocused: true,
          summary: 'PLAYER_CLONE_PANEL_SENTINEL',
          equipment: [
            {
              id: 'eq_clone_panel',
              slot: 'weapon',
              name: 'PLAYER_CLONE_PANEL_SWORD_SENTINEL',
              quality: '精良',
              description: '不应展示。',
            },
          ],
        },
        {
          ...baseState.npcs![0],
          npcId: 'npc_liuzhi_namesake',
          name: '刘峙',
          courtesyName: '伯山',
          age: 36,
          currentIdentity: '汝南逃难士人',
          relationToPlayer: '同名族人，正寻求投靠。',
          isPresent: false,
          isFocused: true,
          summary: 'NAMESAKE_PANEL_SENTINEL',
        },
      ],
    };

    const model = buildNpcPanelModel(state, { selectedNpcId: 'npc_liuzhi' });
    const serialized = JSON.stringify(model);

    expect(model.totalCount).toBe(2);
    expect(model.cards.map((card) => card.id)).not.toContain('npc_liuzhi');
    expect(model.cards.map((card) => card.id)).toContain('npc_liuzhi_namesake');
    expect(serialized).not.toContain('PLAYER_CLONE_PANEL_SENTINEL');
    expect(serialized).not.toContain('PLAYER_CLONE_PANEL_SWORD_SENTINEL');
    expect(serialized).toContain('NAMESAKE_PANEL_SENTINEL');
    expect(model.selectedCard?.id).not.toBe('npc_liuzhi');
  });

  it('shows NPC equipment and carried items in the archive model and search text', () => {
    const state: RuntimeState = {
      ...baseState,
      npcs: (baseState.npcs ?? []).map((npc) => ({
        ...npc,
        equipment: [
          {
            id: 'eq_chen_sabre',
            slot: 'weapon',
            name: '环首刀',
            quality: '军中旧制',
            description: '陈衡随身旧刀。',
            promptHint: '近战可用。',
          },
        ],
        inventory: [
          {
            id: 'item_gate_token',
            name: '营门木符',
            quantity: 1,
            category: 'token',
            description: '营门出入资格。',
            keyItem: true,
          },
        ],
      })),
    };

    const model = buildNpcPanelModel(state, { searchText: '营门木符' });

    expect(model.visibleCount).toBe(1);
    expect(model.cards[0].overviewRows).toContainEqual({ label: '行装', value: '1件装备 / 1类携物' });
    expect(model.cards[0].equipmentRows).toEqual([
      expect.objectContaining({ id: 'eq_chen_sabre', label: '武器', value: '环首刀', detail: expect.stringContaining('军中旧制') }),
    ]);
    expect(model.cards[0].inventoryRows).toEqual([
      expect.objectContaining({ id: 'item_gate_token', label: '令牌', value: '营门木符 x1', detail: expect.stringContaining('关键') }),
    ]);
  });

  it('filters invalid NPC inventory quantities after flooring and hides unknown category keys', () => {
    const state: RuntimeState = {
      ...baseState,
      npcs: (baseState.npcs ?? []).map((npc) => ({
        ...npc,
        inventory: [
          {
            id: 'item_zero',
            name: '空袋',
            quantity: 0,
            category: 'supply',
          },
          {
            id: 'item_nan',
            name: '坏数',
            quantity: Number.NaN,
            category: 'material',
          },
          {
            id: 'item_half',
            name: '半份军粮',
            quantity: 0.5,
            category: 'supply',
          },
          {
            id: 'item_secret_fragment',
            name: '密令残片',
            quantity: 2,
            category: 'quest_item',
            description: '不应泄漏工程分类名。',
          },
        ],
      })),
    };

    const model = buildNpcPanelModel(state);

    expect(model.cards[0].inventoryRows).toEqual([
      expect.objectContaining({ id: 'item_secret_fragment', label: '杂物', value: '密令残片 x2' }),
    ]);
    expect(JSON.stringify(model.cards[0].inventoryRows)).not.toContain('quest_item');
    expect(JSON.stringify(model.cards[0].inventoryRows)).not.toContain('空袋');
    expect(JSON.stringify(model.cards[0].inventoryRows)).not.toContain('坏数');
    expect(JSON.stringify(model.cards[0].inventoryRows)).not.toContain('半份军粮');
  });

  it('renders NPC equipment and carried items in GameScreen', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');

    expect(source).toContain('selectedNpcCard.overviewRows');
    expect(source).toContain('npc-detail-overview-grid');
    expect(source).toContain('selectedNpcCard.equipmentRows');
    expect(source).toContain('selectedNpcCard.inventoryRows');
    expect(source).toContain('row.id ?? `${selectedNpcCard.id}-equipment-${row.label}-${row.value}-${index}`');
    expect(source).toContain('row.id ?? `${selectedNpcCard.id}-inventory-${row.label}-${row.value}-${index}`');
    expect(source).toContain('<h4>装备</h4>');
    expect(source).toContain('<h4>携物</h4>');
  });

  it('renders legacy NPC memories without createdAt safely', () => {
    const legacyState = {
      ...baseState,
      npcs: (baseState.npcs ?? []).map((npc) => ({
        ...npc,
        memories: [
          {
            memoryId: 'mem_legacy',
            source: '听闻',
            content: '旧档案里只保留了内容和来源。',
          },
        ],
      })),
    } as RuntimeState;

    const model = buildNpcPanelModel(legacyState);

    expect(model.cards[0].memoryPreview).toEqual(['听闻：旧档案里只保留了内容和来源。']);
  });

  it('returns the full NPC memory list for local scrolling instead of cutting it to three rows', () => {
    const memoryState = {
      ...baseState,
      npcs: (baseState.npcs ?? []).map((npc) => ({
        ...npc,
        memories: Array.from({ length: 5 }, (_, index) => ({
          memoryId: `mem_${index + 1}`,
          source: '亲历' as const,
          content: `第${index + 1}条记忆`,
          createdAt: `公元189年09月01日 0${index + 1}:00`,
        })),
      })),
    } as RuntimeState;

    const model = buildNpcPanelModel(memoryState);

    expect(model.cards[0].memoryPreview).toHaveLength(5);
    expect(model.cards[0].memoryPreview[0]).toContain('第5条记忆');
    expect(model.cards[0].memoryPreview[4]).toContain('第1条记忆');
  });

  it('keeps NPC memory list locally scrollable in the archive UI styles', async () => {
    const css = await readUiStyleSource();
    const block = css.match(/\.npc-memory-list\s*\{(?<rules>[^}]+)\}/)?.groups?.rules ?? '';

    expect(block).toContain('max-height: 12rem');
    expect(block).toContain('overflow-y: auto');
  });

  it('keeps the private record viewport stable while supporting 10, 20, and all local records', async () => {
    const records = Array.from({ length: 24 }, (_, index) => ({
      id: `record-${index}`,
      date: `第${index + 1}回合`,
      description: `记录${index + 1}`,
    }));
    const css = await readUiStyleSource();
    const block = css.match(/\.npc-secret-record-scroll\s*\{(?<rules>[^}]+)\}/)?.groups?.rules ?? '';

    expect(selectNpcPrivateRecords(records, 10)).toHaveLength(10);
    expect(selectNpcPrivateRecords(records, 20)).toHaveLength(20);
    expect(selectNpcPrivateRecords(records, 'all')).toHaveLength(24);
    expect(block).toContain('block-size: clamp(12rem, 26vh, 16rem)');
    expect(block).toContain('overflow-y: auto');
    expect(block).toContain('scrollbar-gutter: stable');
  });

  it('returns an empty model when no NPC has been written back yet', () => {
    const model = buildNpcPanelModel({ ...baseState, npcs: [] });

    expect(model.totalCount).toBe(0);
    expect(model.cards).toEqual([]);
  });
  it('builds a selectable roster with presence and location grouping', () => {
    const model = buildNpcPanelModel(
      {
        ...baseState,
        locations: [
          {
            locationId: 'place_luoyang_city',
            name: '洛阳城',
            type: '城邑',
            summary: '东汉都城。',
            knownLevel: '亲历',
            recentEvents: [],
          },
          {
            locationId: 'place_hulao_pass',
            name: '虎牢关',
            type: '关隘',
            summary: '洛阳东门户。',
            knownLevel: '听闻',
            recentEvents: [],
          },
        ],
        npcs: [
          ...baseState.npcs!,
          {
            ...baseState.npcs![0],
            npcId: 'npc_dong_zhuo',
            name: '董卓',
            courtesyName: '仲颖',
            aliases: [],
            commonAddress: undefined,
            factionName: '凉州军',
            locationId: 'place_hulao_pass',
            isPresent: false,
            isFocused: true,
            currentIdentity: '凉州刺史 / 司空',
            role: '枭雄 / 权臣',
            relationToPlayer: '敌对/无视。',
            contactLevel: 0,
            recentAttitude: '冷漠',
          },
          {
            ...baseState.npcs![0],
            npcId: 'npc_guard',
            name: '营门小卒',
            courtesyName: undefined,
            aliases: [],
            commonAddress: undefined,
            factionName: '北军',
            isPresent: true,
            isFocused: false,
            currentIdentity: '守门士卒',
            role: '普通士卒',
            relationToPlayer: '初识。',
            contactLevel: 5,
            recentAttitude: '拘谨',
          },
        ],
      },
      {
        selectedNpcId: 'npc_dong_zhuo',
        groupByLocation: true,
        currentLocationLabel: '司隶 - 河南尹 - 洛阳城 - 北军营',
      },
    );

    expect(model.selectedCard?.id).toBe('npc_dong_zhuo');
    expect(model.rosterGroups.map((group) => group.title)).toEqual(['司隶 - 河南尹 - 洛阳城 - 北军营', '虎牢关']);
    expect(model.rosterGroups[0].items.map((item) => item.id)).toEqual(['npc_chen_heng', 'npc_guard']);
    expect(model.rosterGroups[0].items[0]).toMatchObject({
      name: '陈衡',
      presenceText: '在场',
      locationText: '司隶 - 河南尹 - 洛阳城 - 北军营',
    });
    expect(model.rosterGroups[1].items[0]).toMatchObject({
      name: '董卓',
      presenceText: '未在场',
      locationText: '虎牢关',
      isFocused: true,
    });
  });

  it('does not expose an unresolved internal location id in the NPC roster', () => {
    const model = buildNpcPanelModel({
      ...baseState,
      npcs: [{
        ...baseState.npcs![0],
        isPresent: false,
        locationId: 'location_yingchuan_xuchang',
      }],
    });

    expect(model.rosterGroups[0].items[0].locationText).toBe('未登记地点');
    expect(JSON.stringify(model.rosterGroups)).not.toContain('location_yingchuan_xuchang');
  });

  it('does not show a stale present tag when the NPC location is no longer current', () => {
    const model = buildNpcPanelModel({
      ...baseState,
      locations: [
        {
          locationId: 'place_hulao_pass',
          name: '虎牢关',
          type: '关隘',
          summary: '洛阳东门户。',
          knownLevel: '听闻',
          recentEvents: [],
        },
      ],
      npcs: [{
        ...baseState.npcs![0],
        locationId: 'place_hulao_pass',
        isPresent: true,
      }],
    }, { groupByLocation: true });

    expect(model.presentCount).toBe(0);
    expect(model.cards[0].isPresent).toBe(false);
    expect(model.cards[0].statusBadges).not.toContain('在场');
    expect(model.rosterGroups[0].title).toBe('虎牢关');
    expect(model.rosterGroups[0].items[0]).toMatchObject({
      presenceText: '未在场',
      locationText: '虎牢关',
    });
  });

  it('surfaces unread remote presence updates as optional roster hints', () => {
    const state = {
      ...baseState,
      npcs: [
        ...baseState.npcs!,
        {
          ...baseState.npcs![0],
          npcId: 'npc_zhang_miao',
          name: '张邈',
          isPresent: false,
          isFocused: false,
          locationId: 'place_luoyang_city',
          currentIdentity: '地方名士',
          role: '远场关系人物',
          relationToPlayer: '听闻主角在本地有名望。',
          contactLevel: 1,
          recentAttitude: '观望',
          presenceUpdates: [
            {
              id: 'presence_zhang_miao_1',
              createdAt: '公元189年09月01日',
              kind: 'letter',
              summary: '张邈托人打听主角是否愿意结交本地兵马。',
              source: '使者转述',
              certainty: 'reported',
              readByPlayer: false,
            },
          ],
        },
      ],
    } as RuntimeState;

    const model = buildNpcPanelModel(state, { presenceHintsEnabled: true });

    expect(model.rosterGroups[0].items[0]).toMatchObject({
      id: 'npc_zhang_miao',
      hasUnreadPresence: true,
    });
    expect(model.selectedCard?.id).toBe('npc_zhang_miao');
    expect(model.selectedCard?.presenceUpdates[0]).toMatchObject({
      summary: '张邈托人打听主角是否愿意结交本地兵马。',
      readByPlayer: false,
    });
  });

  it('does not expose unresolved internal location ids in the visible NPC roster', () => {
    const model = buildNpcPanelModel(
      {
        ...baseState,
        npcs: [
          {
            ...baseState.npcs![0],
            npcId: 'npc_chen_tai',
            name: '陈泰',
            isPresent: false,
            locationId: 'loc_yongzhou',
            currentIdentity: '魏国西线将领',
            role: '远场敌将',
          },
        ],
      },
      {
        groupByLocation: true,
      },
    );

    expect(model.rosterGroups[0].title).toBe('未登记地点');
    expect(model.rosterGroups[0].items[0]).toMatchObject({
      id: 'npc_chen_tai',
      locationText: '未登记地点',
    });
    expect(JSON.stringify(model)).not.toContain('loc_yongzhou');
  });

  it('uses setting-appropriate remote presence wording instead of modern online status', () => {
    const model = buildNpcPanelModel({
      ...baseState,
      npcs: [
        {
          ...baseState.npcs![0],
          npcId: 'npc_remote',
          name: '远场人物',
          isPresent: false,
          isFocused: false,
          locationId: 'place_remote_unknown',
          currentIdentity: '地方官',
          role: '远场人物',
        },
      ],
    }, { groupByLocation: true });

    expect(model.rosterGroups[0].items[0]).toMatchObject({
      presenceText: '未在场',
      locationText: '未登记地点',
    });
    expect(JSON.stringify(model.rosterGroups)).not.toContain('离线');
    expect(JSON.stringify(model.rosterGroups)).not.toContain('place_remote_unknown');
  });

  it('keeps presence update details when roster hints are disabled', () => {
    const state = {
      ...baseState,
      npcs: [
        ...baseState.npcs!,
        {
          ...baseState.npcs![0],
          npcId: 'npc_zhang_miao',
          name: '张邈',
          isPresent: false,
          isFocused: false,
          currentIdentity: '地方名士',
          role: '远场关系人物',
          relationToPlayer: '听闻主角在本地有名望。',
          contactLevel: 1,
          recentAttitude: '观望',
          presenceUpdates: [
            {
              id: 'presence_zhang_miao_1',
              createdAt: '公元189年09月01日',
              kind: 'letter',
              summary: '张邈托人打听主角是否愿意结交本地兵马。',
              source: '使者转述',
              certainty: 'reported',
              readByPlayer: false,
            },
          ],
        },
      ],
    } as RuntimeState;

    const model = buildNpcPanelModel(state, {
      presenceHintsEnabled: false,
      selectedNpcId: 'npc_zhang_miao',
    });

    expect(model.rosterGroups[0].items[0].id).toBe('npc_chen_heng');
    expect(model.rosterGroups[0].items.find((item) => item.id === 'npc_zhang_miao')?.hasUnreadPresence).toBe(false);
    expect(model.selectedCard?.presenceUpdates).toHaveLength(1);
  });

  it('keeps summary prose out of the compact private view while preserving private info', () => {
    const model = buildNpcPanelModel({
      ...baseState,
      npcs: [
        {
          ...baseState.npcs![0],
          npcId: 'npc_he_lady',
          name: '何氏',
          sex: '女',
          age: 22,
          femaleProfile: {
            relationshipNotes: '与主角保持礼节往来。',
            publicIntimacyNotes: '公开亲昵边界只停留在大众文学尺度。',
            appearanceExtension: '仪态端庄，衣饰合乎身份。',
            emotionalBoundary: '谨慎而有戒心。',
            adultPrivateProfile: {
              enabled: true,
              ageConfirmedAdult: true,
              summary: '成年女性私密档案摘要。',
              boundaryNotes: '只在成人内容启用且年满十八时使用。',
            },
          },
        } as any,
      ],
    });

    const card = model.selectedCard as any;
    expect(card?.statusBadges).not.toContain('未成年');
    expect(card?.femaleProfile?.rows.map((row: any) => row.label)).toContain('公开亲昵边界');
    expect(card?.femaleProfile?.adultPrivateRows.map((row: any) => row.label)).toEqual(['边界记录']);
    expect(card?.femaleProfile?.adultPrivateSections.map((section: any) => section.title)).toEqual(['私密信息']);
    expect(card?.femaleProfile?.adultPrivateAnchorRows).toEqual([]);
  });

  it('builds Alpha parity female profile sections for adult female NPCs', () => {
    const model = buildNpcPanelModel({
      ...baseState,
      npcs: [
        {
          ...baseState.npcs![0],
          npcId: 'npc_adult_woman',
          name: '某氏',
          sex: '女',
          age: 33,
          femaleProfile: {
            birthday: '八月初三',
            addressToPlayer: '刘郎君',
            appearanceDescription: '仪态端庄，容貌明艳。',
            bodyDescription: '身段丰润，举止稳重。',
            clothingStyle: '常穿素雅深衣，配饰克制。',
            personalityCore: '谨慎克制。',
            affectionProgressionCondition: '需长期守信。',
            relationshipProgressionCondition: '需兑现承诺。',
            relationshipNetwork: [
              { targetName: '主角', relationship: '危局中的盟友', notes: '仍在观察。' },
              { targetName: '家族', relationship: '需要保护的牵挂' },
            ],
            adultPrivateProfile: {
              enabled: true,
              ageConfirmedAdult: true,
              breastDescription: '常态身体特征记录。',
              vaginaDescription: '常态私密部位记录。',
              anusDescription: '常态隐私部位记录。',
              sexualPreferenceNotes: '偏好长期承诺后的亲密关系。',
              sensitiveSpotNotes: '主要敏感区域记录。',
              preferenceNotes: '稳定偏好信息。',
              boundaryNotes: '稳定边界信息。',
              sensitiveNotes: '稳定敏感信息。',
              relationshipRiskNotes: '长期关系风险信息。',
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
              updatedAt: '乱世元年2月',
              source: '亲历',
            },
          },
        } as any,
      ],
    });

    const card = model.selectedCard as any;
    expect(card?.femaleProfile?.sections.map((section: any) => section.title)).toEqual([
      '基础档案',
      '外貌与衣着',
      '关系承接',
    ]);
    expect(card?.femaleProfile?.sections.map((section: any) => section.kind)).toEqual([
      'basic',
      'appearanceAnchor',
      'relationship',
    ]);
    expect(card?.femaleProfile?.sections.flatMap((section: any) => section.rows.map((row: any) => row.label))).toContain('关系网变量');
    expect(card?.femaleProfile?.adultPrivateSections.map((section: any) => section.title)).toEqual([
      '私密部位锚点',
      '私密信息',
      '子宫档案',
    ]);
    expect(card?.femaleProfile?.adultPrivateSections.map((section: any) => section.kind)).toEqual([
      'privateAnchor',
      'preferences',
      'womb',
    ]);
    expect(card?.femaleProfile?.adultPrivateSections.map((section: any) => section.title)).not.toContain('私密档案元数据');
    expect(card?.femaleProfile?.adultPrivateBodyRows.map((row: any) => row.label)).toEqual([
      '胸部描述',
      '小穴描述',
      '屁穴描述',
    ]);
    expect(card?.femaleProfile?.adultPrivateAnchorRows.map((row: any) => row.label)).toEqual([
      '胸部描述',
      '小穴描述',
      '屁穴描述',
    ]);
    expect(card?.femaleProfile?.adultPrivateSections.find((section: any) => section.kind === 'privateAnchor')).toEqual({
      title: '私密部位锚点',
      rows: card?.femaleProfile?.adultPrivateAnchorRows,
      kind: 'privateAnchor',
    });
    expect(card?.femaleProfile?.adultPrivateAnchorRows.map((row: any) => row.label)).not.toContain('偏好记录');
    expect(card?.femaleProfile?.adultPrivateAnchorRows.map((row: any) => row.label)).not.toContain('边界记录');
    expect(card?.femaleProfile?.adultPrivateAnchorRows.map((row: any) => row.label)).not.toContain('敏感记录');
    expect(card?.femaleProfile?.adultPrivateAnchorRows.map((row: any) => row.label)).not.toContain('初夜描述');
    expect(card?.femaleProfile?.adultPrivatePreferenceRows.map((row: any) => row.label)).toEqual([
      '性癖',
      '敏感点',
      '偏好记录',
      '边界记录',
      '敏感记录',
      '关系风险',
    ]);
    expect(card?.femaleProfile?.adultPrivateSections.flatMap((section: any) => section.rows.map((row: any) => row.label))).not.toContain('内射记录');
    expect(card?.femaleProfile?.wombRecords).toEqual([
      expect.objectContaining({
        date: '乱世元年2月',
        description: '测试记录。',
        pregnancyCheckDate: '乱世元年3月',
      }),
    ]);
    expect(card?.femaleProfile?.adultPrivateSections.flatMap((section: any) => section.rows.map((row: any) => row.label))).toContain('初夜描述');
    expect(card?.femaleProfile?.adultPrivateSections.flatMap((section: any) => section.rows.map((row: any) => row.label))).not.toContain('来源');
  });

  it('shows structured pregnancy progress inside the existing womb section', () => {
    const model = buildNpcPanelModel({
      ...baseState,
      currentDate: '公元189年11月01日 08:00（辰时）',
      npcs: [{
        ...baseState.npcs![0],
        npcId: 'npc_pregnant_lady',
        name: '何氏',
        sex: '女',
        age: 24,
        ageKnownAtDate: '公元189年09月01日 08:00（辰时）',
        femaleProfile: {
          adultPrivateProfile: {
            enabled: true,
            ageConfirmedAdult: true,
            wombProfile: {
              status: '已确认怀孕',
              pregnancy: {
                pregnancyId: 'preg_panel_test',
                status: 'confirmed',
                cycleKey: 'cycle_panel_test',
                firstExposureAt: '公元189年09月01日 08:00（辰时）',
                checkAt: '公元189年09月24日 08:00（辰时）',
                exposureCount: 1,
                chanceBasisPoints: 1800,
                rollBasisPoints: 100,
                fatherCharacterIds: ['player'],
                paternityStatus: 'known',
                disclosure: 'private',
                conceptionAt: '公元189年09月01日 08:00（辰时）',
                confirmedAt: '公元189年10月16日 08:00（辰时）',
                estimatedDueAt: '公元190年06月01日 08:00（辰时）',
              },
            },
          },
        },
      } as any],
    });
    const wombRows = (model.selectedCard as any)?.femaleProfile?.adultPrivateSections
      .find((section: any) => section.kind === 'womb')?.rows;

    expect(wombRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '怀孕进程', value: '已确认怀孕' }),
      expect.objectContaining({ label: '孕期', value: '第3月' }),
      expect.objectContaining({ label: '预计分娩', value: '公元190年06月01日 08:00（辰时）' }),
      expect.objectContaining({ label: '父系记录', value: '主角' }),
      expect.objectContaining({ label: '知情范围', value: '私密' }),
    ]));
  });

  it('renders Alpha parity female profile sections in GameScreen', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');
    const disclosureOpeningTag = source.match(/<details\b[^>]*className="npc-card-section npc-female-profile-section npc-female-profile-disclosure"[^>]*>/)?.[0];
    const profileImmediatelyFollowsTraitsPattern = /<h4><span className="trait-help-label" title=\{TRAIT_RARITY_LEGEND_TITLE\}>特质<\/span>与状态<\/h4>(?:(?!<\/?section\b)[\s\S])*?<\/section>\s*\)\}\s*\{selectedNpcCard\.femaleProfile && \(\s*<details\b[^>]*className="npc-card-section npc-female-profile-section npc-female-profile-disclosure"/;
    const sourceWithInterveningSection = source.replace(
      '                          {selectedNpcCard.femaleProfile && (',
      `                          {true && (
                            <section className="intervening-section">
                              <span>中间区块</span>
                            </section>
                          )}

                          {selectedNpcCard.femaleProfile && (`,
    );

    expect(source).toContain('selectedNpcCard.femaleProfile.sections');
    expect(source).toContain('selectedNpcCard.femaleProfile.adultPrivateSections');
    expect(source).toContain('selectedNpcCard.femaleProfile.adultPrivateAnchorRows');
    expect(source).toContain('selectedNpcCard.femaleProfile.adultPrivatePreferenceRows');
    expect(source).toContain('selectedNpcCard.femaleProfile.adultPrivateRows.length > 0');
    expect(source).toContain('npc-female-profile-disclosure');
    expect(source).toContain('npc-female-profile-summary');
    expect(source).toContain('npc-female-profile-subsection');
    expect(source).toContain('香闺秘档');
    expect(source).toContain('npc-adult-private-profile-head');
    expect(source).toContain('npc-secret-body-card');
    expect(source).toContain('npc-secret-womb-card');
    expect(source).toContain('npc-private-record-limit');
    expect(source).toContain('内射记录显示数量');
    expect(source).toContain("value=\"all\"");
    expect(source).toContain('npc-secret-record-scroll');
    expect(source).toContain('section.kind');
    expect(source).toContain("!['privateAnchor', 'bodyParts', 'preferences', 'womb'].includes");
    expect(source).not.toContain('npc-detail-side-archive');
    expect(source).not.toContain('no-side-archive');
    expect(source).toMatch(profileImmediatelyFollowsTraitsPattern);
    expect(sourceWithInterveningSection).not.toBe(source);
    expect(sourceWithInterveningSection).not.toMatch(profileImmediatelyFollowsTraitsPattern);
    expect(disclosureOpeningTag).toBeDefined();
    expect(disclosureOpeningTag).not.toMatch(/\sopen(?:\s|=|>)/);
  });

  it('renders remote presence hints in GameScreen', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');

    expect(source).toContain('loadNpcPresenceHintsEnabledFromStorage');
    expect(source).toContain('handleNpcSelect');
    expect(source).toContain('hasUnreadPresence');
    expect(source).toContain('selectedNpcCard.presenceUpdates');
    expect(source).toContain('npc-presence-dot');
  });

  it('hides adult private female profile rows when the current NPC age is under 18', () => {
    const model = buildNpcPanelModel({
      ...baseState,
      npcs: [
        {
          ...baseState.npcs![0],
          npcId: 'npc_he_lady',
          name: '何氏',
          sex: '女',
          age: 17,
          femaleProfile: {
            relationshipNotes: '保持普通社交记录。',
            publicIntimacyNotes: '可以保留大众文学尺度的亲近张力。',
            adultPrivateProfile: {
              enabled: true,
              ageConfirmedAdult: true,
              summary: 'Should not be visible.',
              breastDescription: 'Should not be visible.',
              preferenceNotes: 'Should not be visible.',
            },
          },
        } as any,
      ],
    });

    const card = model.selectedCard as any;
    expect(card?.statusBadges).toContain('未成年');
    expect(card?.femaleProfile?.rows.map((row: any) => row.label)).toContain('公开亲昵边界');
    expect(card?.femaleProfile?.adultPrivateRows).toEqual([]);
    expect(card?.femaleProfile?.adultPrivateAnchorRows).toEqual([]);
    expect(card?.femaleProfile?.adultPrivateSections.map((section: any) => section.kind)).not.toContain('privateAnchor');
  });

  it('hides private anchor rows when the adult private profile is disabled', () => {
    const model = buildNpcPanelModel({
      ...baseState,
      npcs: [
        {
          ...baseState.npcs![0],
          npcId: 'npc_disabled_private_profile',
          name: '某氏',
          sex: '女',
          age: 22,
          femaleProfile: {
            relationshipNotes: '保留公开关系档案。',
            adultPrivateProfile: {
              enabled: false,
              ageConfirmedAdult: true,
              breastDescription: 'Should not be visible.',
              vaginaDescription: 'Should not be visible.',
              anusDescription: 'Should not be visible.',
              preferenceNotes: 'Should not be visible.',
            },
          },
        } as any,
      ],
    });

    const card = model.selectedCard as any;
    expect(card?.femaleProfile?.rows.map((row: any) => row.label)).toContain('关系记录');
    expect(card?.femaleProfile?.adultPrivateRows).toEqual([]);
    expect(card?.femaleProfile?.adultPrivateAnchorRows).toEqual([]);
    expect(card?.femaleProfile?.adultPrivateSections).toEqual([]);
  });

  it('hides private anchor rows when an adult NPC lacks adult age confirmation', () => {
    const model = buildNpcPanelModel({
      ...baseState,
      npcs: [
        {
          ...baseState.npcs![0],
          npcId: 'npc_unconfirmed_adult_private_profile',
          name: '某氏',
          sex: '女',
          age: 22,
          femaleProfile: {
            relationshipNotes: '保留公开关系档案。',
            adultPrivateProfile: {
              enabled: true,
              ageConfirmedAdult: false,
              breastDescription: 'Should not be visible.',
              vaginaDescription: 'Should not be visible.',
              anusDescription: 'Should not be visible.',
              preferenceNotes: 'Should not be visible.',
            },
          },
        } as any,
      ],
    });

    const card = model.selectedCard as any;
    expect(card?.statusBadges).not.toContain('未成年');
    expect(card?.femaleProfile?.adultPrivateAnchorRows).toEqual([]);
    expect(card?.femaleProfile?.adultPrivateRows).toEqual([]);
    expect(card?.femaleProfile?.adultPrivateSections).toEqual([]);
  });

  it('omits an empty private anchor section without folding other private information into it', () => {
    const model = buildNpcPanelModel({
      ...baseState,
      npcs: [
        {
          ...baseState.npcs![0],
          npcId: 'npc_empty_private_anchor',
          name: '某氏',
          sex: '女',
          age: 22,
          femaleProfile: {
            relationshipNotes: '保留公开关系档案。',
            adultPrivateProfile: {
              enabled: true,
              ageConfirmedAdult: true,
              preferenceNotes: '稳定偏好信息。',
              boundaryNotes: '稳定边界信息。',
              sensitiveNotes: '稳定敏感信息。',
              wombProfile: {
                status: '未受孕',
                inseminationRecords: [
                  { date: '乱世元年2月', description: '事件记录。' },
                ],
              },
              firstNightDescription: '关系事件记录。',
            },
          },
        } as any,
      ],
    });

    const card = model.selectedCard as any;
    const anchorSection = card?.femaleProfile?.adultPrivateSections.find((section: any) => section.kind === 'privateAnchor');
    expect(card?.femaleProfile?.adultPrivateAnchorRows).toEqual([]);
    expect(anchorSection).toBeUndefined();
    expect(card?.femaleProfile?.adultPrivateSections.map((section: any) => section.kind)).toEqual([
      'preferences',
      'womb',
    ]);
    expect(card?.femaleProfile?.adultPrivatePreferenceRows.map((row: any) => row.label)).toEqual([
      '偏好记录',
      '边界记录',
      '敏感记录',
    ]);
  });

  it.each([
    ['neutral', '中立'],
    ['hostile', '敌对'],
    ['submissive', '顺从'],
  ])('formats the internal relationship label %s for every player-facing NPC field', (value, label) => {
    const model = buildNpcPanelModel({
      ...baseState,
      npcs: [{
        ...baseState.npcs![0],
        relationToPlayer: value,
        recentAttitude: value,
      }],
    });
    const card = model.cards[0];

    expect(card.relation).toBe(label);
    expect(card.recentAttitude).toBe(label);
    expect(card.overviewRows).toContainEqual({ label: '关系', value: label, detail: label });
    expect(JSON.stringify({
      relation: card.relation,
      recentAttitude: card.recentAttitude,
      overviewRows: card.overviewRows,
    })).not.toContain(value);
  });

  it('uses the current game date to derive adult female profile visibility', () => {
    const model = buildNpcPanelModel({
      ...baseState,
      currentDate: '公元190年09月01日 09:30（巳时）',
      npcs: [
        {
          ...baseState.npcs![0],
          npcId: 'npc_he_lady',
          name: '何氏',
          sex: '女',
          age: 17,
          ageKnownAtDate: '公元189年09月01日 09:30（巳时）',
          femaleProfile: {
            relationshipNotes: '保持普通社交记录。',
            publicIntimacyNotes: '可以保留大众文学尺度的亲近张力。',
            adultPrivateProfile: {
              enabled: true,
              ageConfirmedAdult: true,
              summary: 'Now visible after derived age reaches 18.',
            },
          },
        } as any,
      ],
    });

    const card = model.selectedCard as any;
    expect(card?.statusBadges).not.toContain('未成年');
    expect(card?.statusBadges).toContain('女 18岁');
    expect(card?.femaleProfile?.adultPrivateRows).toEqual([]);
  });

  it('hides adult private female profile rows when the current NPC age is missing abnormal data', () => {
    const model = buildNpcPanelModel({
      ...baseState,
      npcs: [
        {
          ...baseState.npcs![0],
          npcId: 'npc_he_lady',
          name: '何氏',
          sex: '女',
          age: undefined as any,
          femaleProfile: {
            relationshipNotes: '保持普通社交记录。',
            publicIntimacyNotes: '可以保留大众文学尺度的亲近张力。',
            adultPrivateProfile: {
              enabled: true,
              ageConfirmedAdult: true,
              summary: 'Should not be visible.',
            },
          },
        } as any,
      ],
    });

    const card = model.selectedCard as any;
    expect(card?.femaleProfile?.rows.map((row: any) => row.label)).toContain('公开亲昵边界');
    expect(card?.femaleProfile?.adultPrivateRows).toEqual([]);
  });

  it('filters the roster by search text and focused state', () => {
    const model = buildNpcPanelModel(
      {
        ...baseState,
        npcs: [
          ...baseState.npcs!,
          {
            ...baseState.npcs![0],
            npcId: 'npc_lu_bu',
            name: '吕布',
            courtesyName: '奉先',
            aliases: ['飞将'],
            currentIdentity: '骑都尉',
            role: '猛将',
            isPresent: false,
            isFocused: true,
            contactLevel: 12,
          },
        ],
      },
      {
        searchText: '飞将',
        onlyFocused: true,
      },
    );

    expect(model.rosterGroups).toHaveLength(1);
    expect(model.rosterGroups[0].items.map((item) => item.name)).toEqual(['吕布']);
    expect(model.selectedCard?.name).toBe('吕布');
  });
});
