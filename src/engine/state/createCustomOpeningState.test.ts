import { describe, expect, it } from 'vitest';
import type { StartBookmark, WorldBook } from '../types';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { createCustomOpeningState } from './createCustomOpeningState';

const worldBook: WorldBook = {
  manifest: {
    id: 'test-world',
    name: '测试乱世',
    version: '0.1.0',
    author: 'test',
    language: 'zh-CN',
    genre: '乱世',
    source: 'custom',
    compatibleEngineVersion: '0.1.0',
  },
  ontology: {
    regionLevels: ['州', '郡', '县'],
    factionTypes: ['朝廷', '地方势力'],
    actorRoleTypes: ['在野', '小吏'],
    socialClasses: ['寒门', '流民'],
    resourceTypes: ['钱财', '粮食'],
    conflictTypes: ['战乱'],
    actionTypes: ['交谈', '移动'],
    relationshipTypes: ['往来'],
  },
  lore: '天下初乱，各地人心浮动。',
  mapSeed: [
    {
      id: 'loc_market_town',
      name: '市镇',
      level: '县',
      mapLayer: 'place',
      summary: '商旅与流民混杂的小城。',
      connectedRegionIds: [],
      controlHint: '地方官府名义控制',
      tensionHint: '流民聚集',
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

const bookmark: StartBookmark = {
  id: 'bookmark_chaos',
  label: '初乱',
  startDate: '189年9月',
  relatedTimelineAnchorIds: [],
  description: '地方秩序开始松动。',
  recommendedRegions: ['loc_market_town'],
  recommendedOrigins: ['寒门士子'],
  situationSummary: '官府虚弱，豪强自保。',
};

describe('createCustomOpeningState', () => {
  it('defaults worldline knowledge settings for new openings', () => {
    const state = createCustomOpeningState({
      worldBook,
      bookmark,
      playerName: '刘良',
      playerSex: '男',
      playerAge: 22,
      origin: '寒门士子',
      locationId: 'loc_market_town',
      situationSummary: '想在乱世中寻一条路。',
    } as any);

    expect(state.worldlineSettings).toEqual({
      knowledgeMode: 'default',
      knowledgeBaseId: undefined,
      storyPackIds: [],
    });
  });

  it('persists selected worldline knowledge settings from opening input', () => {
    const state = createCustomOpeningState({
      worldBook,
      bookmark,
      playerName: '刘良',
      playerSex: '男',
      playerAge: 22,
      origin: '寒门士子',
      locationId: 'loc_market_town',
      situationSummary: '想在乱世中寻一条路。',
      worldlineSettings: {
        knowledgeMode: 'strict',
        knowledgeBaseId: 'threeKingdoms.coreKnowledge.v1',
        storyPackIds: ['storypack_test'],
      },
    } as any);

    expect(state.worldlineSettings).toEqual({
      knowledgeMode: 'strict',
      knowledgeBaseId: 'threeKingdoms.coreKnowledge.v1',
      storyPackIds: ['storypack_test'],
    });
  });

  it('leaves faction ledger empty for the true opening LLM even if a worldbook still has legacy faction seeds', () => {
    const state = createCustomOpeningState({
      worldBook: {
        ...worldBook,
        factionsSeed: [
          {
            id: 'faction_static_example',
            name: '静态示例势力',
            factionType: '地方势力',
            summary: '这个种子只用于验证开局不预填当前势力。',
            controlHints: ['静态资料'],
            attitudeHints: ['不应进入开局账本'],
          },
        ],
      },
      bookmark,
      playerName: '刘良',
      playerSex: '男',
      playerAge: 22,
      origin: '寒门士子',
      locationId: 'loc_market_town',
      situationSummary: '想在乱世中寻一条路。',
    } as any);

    expect(state.knownFactions).toEqual([]);
    expect(state.factions).toEqual([]);
  });

  it('does not ship hard-coded current faction seeds in the Three Kingdoms worldbook', () => {
    expect(worldBook_ThreeKingdoms.factionsSeed).toEqual([]);
  });

  it('does not preseed Three Kingdoms factions for late Shu openings', () => {
    const bookmark255 = worldBook_ThreeKingdoms.startBookmarks.find(
      (item) => item.id === 'bookmark_255_taoxi_victory',
    );
    if (!bookmark255) throw new Error('Missing 255 Taoxi bookmark fixture.');

    const state = createCustomOpeningState({
      worldBook: worldBook_ThreeKingdoms,
      bookmark: bookmark255,
      playerName: '刘良',
      playerSex: '男',
      playerAge: 22,
      origin: '县中小吏',
      locationId: 'place_yizhou_chengdu',
      situationSummary: '洮西捷报传入成都。守成与主战都在等待下一步。',
    } as any);

    expect(state.knownFactions).toEqual([]);
    expect(state.factions).toEqual([]);
  });

  it('does not preseed Three Kingdoms factions for early Yingchuan openings either', () => {
    const bookmark184 = worldBook_ThreeKingdoms.startBookmarks.find(
      (item) => item.id === 'bookmark_184_yellow_turban',
    );
    if (!bookmark184) throw new Error('Missing 184 Yellow Turban bookmark fixture.');

    const state = createCustomOpeningState({
      worldBook: worldBook_ThreeKingdoms,
      bookmark: bookmark184,
      playerName: '刘良',
      playerSex: '男',
      playerAge: 22,
      origin: '县中小吏',
      locationId: 'loc_yingchuan',
      situationSummary: '颍川乡里太平道暗流渐起，郡府与豪族都在试探。',
    } as any);

    expect(state.knownFactions).toEqual([]);
    expect(state.factions).toEqual([]);
  });

  it('normalizes opening time and leaves initial loadout for true opening AI writeback', () => {
    const state = createCustomOpeningState({
      worldBook,
      bookmark,
      playerName: '刘良',
      courtesyName: '景行',
      playerSex: '男',
      playerAge: 22,
      origin: '宗室支脉',
      birthOrigin: '宗室支脉',
      currentIdentity: '朝中重臣',
      locationId: 'loc_market_town',
      situationSummary: '身在乱局边缘，等待第一步。',
    } as any);

    expect(state.startDate).toBe('公元189年09月01日 08:00（辰时）');
    expect(state.currentDate).toBe('公元189年09月01日 08:00（辰时）');
    expect(state.currentTime).toMatchObject({ year: 189, month: 9, day: 1, hour: 8, minute: 0 });
    expect(state.player.personalMoney).toBe(0);
    expect(state.player.equipment).toEqual([]);
    expect(state.player.inventory).toEqual([]);
    expect(state.holdings).toEqual([]);
    expect(state.privateAssets).toEqual([]);
    expect(state.resources.money).toBe(0);
    expect(state.playerResources).not.toHaveProperty('钱财');
    expect(state.worldStateDelta.openingLoadoutSummary).toContain('真开局 AI');
  });

  it('keeps explicit opening personal money out of faction and holding resource ledgers', () => {
    const state = createCustomOpeningState({
      worldBook,
      bookmark,
      playerName: '刘良',
      playerSex: '男',
      playerAge: 22,
      origin: '宗室支脉',
      birthOrigin: '宗室支脉',
      currentIdentity: '无领地的宗室游侠',
      locationId: 'loc_market_town',
      situationSummary: '身在乱局边缘，只有随身行装可用。',
      personalMoney: 5000,
    } as any);

    expect(state.player.personalMoney).toBe(5000);
    expect(state.worldStateDelta.openingPersonalMoney).toBe(5000);
    expect(state.resources.money).toBe(0);
    expect(state.playerResources).not.toHaveProperty('钱财');
    expect(state.holdings).toEqual([]);
  });

  it('derives modest opening reputation from birth origin, identity, and extra request', () => {
    const state = createCustomOpeningState({
      worldBook,
      bookmark,
      playerName: '刘良',
      playerSex: '男',
      playerAge: 22,
      origin: '宗室支脉',
      birthOrigin: '宗室支脉',
      currentIdentity: '朝中重臣',
      locationId: 'loc_market_town',
      situationSummary: '身在乱局边缘。',
      openingExtraRequest: '已有清名，曾赈济乡里，但不要一开局掌权。',
    } as any);

    expect(state.player.reputation).toEqual(expect.objectContaining({
      fame: 140,
      morality: 115,
    }));
    expect(state.player.reputation?.tags.map((tag) => tag.label)).toEqual([
      '出身声望',
      '身份名望',
      '清名善行',
    ]);
    expect(state.player.reputation?.summary).toContain('开局公论');
    expect(state.worldStateDelta.openingReputation).toBe(state.player.reputation);
  });

  it('keeps explicitly supplied opening reputation instead of deriving one', () => {
    const state = createCustomOpeningState({
      worldBook,
      bookmark,
      playerName: '刘良',
      playerSex: '男',
      playerAge: 22,
      origin: '宗室支脉',
      birthOrigin: '宗室支脉',
      currentIdentity: '朝中重臣',
      locationId: 'loc_market_town',
      situationSummary: '身在乱局边缘。',
      openingExtraRequest: '已有清名。',
      reputation: {
        fame: -300,
        morality: -200,
        tags: [{ label: '旧案牵连', source: 'opening' }],
        summary: '旧案让他一开局就背负恶评。',
      },
    } as any);

    expect(state.player.reputation).toEqual({
      fame: -300,
      morality: -200,
      tags: [{ label: '旧案牵连', source: 'opening' }],
      summary: '旧案让他一开局就背负恶评。',
    });
  });

  it('does not create local crisis quests, plot plans or pressure notes during custom opening', () => {
    const state = createCustomOpeningState({
      worldBook,
      bookmark,
      playerName: '刘良',
      playerSex: '男',
      playerAge: 22,
      origin: '寒门士子',
      birthOrigin: '寒门士子',
      currentIdentity: '在野士人',
      locationId: 'loc_market_town',
      situationSummary: '想在乱世中寻一条路。',
    } as any);

    expect((state as any).currentCrisisId).toBeUndefined();
    expect(state.activeQuests).toEqual([]);
    expect(state.plotPlan).toEqual([]);
    expect(state.situationOverview.currentPressure).toEqual([]);
    expect(state.situationOverview.immediateHooks).toEqual([]);
    expect(state.localSituationNotes.join('\n')).not.toContain('通用危机');
    expect(state.worldStateDelta).not.toHaveProperty('openingCrisisLabel');
  });

  it('uses opening location seed as prompt-facing opening anchors without requiring full map data', () => {
    const state = createCustomOpeningState({
      worldBook: {
        ...worldBook,
        openingLocationSeed: [
          {
            id: 'region_prompt_only',
            name: '提示州',
            level: '州',
            mapLayer: 'region',
            summary: '只用于开局 prompt 的州级锚点。',
            connectedRegionIds: [],
            controlHint: '地方势力',
            tensionHint: '中',
            subLocations: [
              {
                id: 'loc_prompt_commandery',
                name: '提示郡',
                level: '郡',
                mapLayer: 'region',
                summary: '只用于开局 prompt 的郡级锚点。',
                connectedRegionIds: [],
                controlHint: '郡府',
                tensionHint: '中',
                subLocations: [
                  {
                    id: 'loc_prompt_start',
                    name: '提示县城',
                    level: '县',
                    mapLayer: 'place',
                    summary: '这条地点不在 mapSeed 中，但应进入开局状态。',
                    connectedRegionIds: [],
                    controlHint: '县寺',
                    tensionHint: '低',
                    subLocations: [
                      {
                        id: 'scene_prompt_yamen',
                        name: '县衙',
                        level: '场景',
                        mapLayer: 'scene',
                        summary: '县中公事聚集之处。',
                        connectedRegionIds: [],
                        controlHint: '县寺',
                        tensionHint: '低',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      bookmark,
      playerName: '阿青',
      playerSex: '女',
      playerAge: 19,
      origin: '寒门士子',
      locationId: 'loc_prompt_start',
      sceneId: 'scene_prompt_yamen',
      sceneName: '县衙',
      locationPath: '提示州 / 提示郡 / 提示县城 / 县衙',
      situationSummary: '从提示县城开始。',
    } as any);

    expect(state.currentLocationId).toBe('loc_prompt_start');
    expect(state.currentPlaceId).toBe('loc_prompt_start');
    expect(state.currentSceneId).toBe('scene_prompt_yamen');
    expect(state.locations[0]).toMatchObject({
      locationId: 'loc_prompt_start',
      name: '提示县城',
      summary: '这条地点不在 mapSeed 中，但应进入开局状态。',
    });
    expect(state.worldStateDelta.openingPlaceId).toBe('loc_prompt_start');
    expect(state.worldStateDelta.openingSceneId).toBe('scene_prompt_yamen');
    expect(state.worldStateDelta.openingLocationPath).toBe('提示州 / 提示郡 / 提示县城 / 县衙');
  });
  it('keeps detailed opening trait context so custom trait rarity can be judged by true opening AI', () => {
    const state = createCustomOpeningState({
      worldBook,
      bookmark,
      playerName: 'Trait Tester',
      playerSex: '男',
      playerAge: 22,
      origin: 'custom origin',
      locationId: 'loc_market_town',
      situationSummary: 'A custom opening trait should be visible to true opening generation.',
      traits: [
        {
          id: 'custom_trait_night_reader',
          label: 'Night Reader',
          description: 'Reads unusual books outside official schools.',
          source: 'custom',
          promptHint: 'Let the opening AI judge this trait rarity from context.',
        },
      ],
    } as any);

    expect(state.worldStateDelta.openingTraits).toEqual(['Night Reader']);
    expect(state.worldStateDelta.openingTraitDetails).toEqual([
      expect.objectContaining({
        id: 'custom_trait_night_reader',
        label: 'Night Reader',
        description: 'Reads unusual books outside official schools.',
        source: 'custom',
        rarity: '待开局 LLM 判定',
        promptHint: 'Let the opening AI judge this trait rarity from context.',
      }),
    ]);
  });
});
