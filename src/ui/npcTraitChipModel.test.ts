import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { buildNpcPanelModel } from './npcPanelModel';

const stateWithNpcTraits: RuntimeState = {
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
      npcId: 'npc_dong_zhuo',
      name: '董卓',
      sex: '男',
      age: 50,
      role: '枭雄 / 权臣',
      factionName: '凉州军',
      isPresent: false,
      isFocused: true,
      currentIdentity: '凉州刺史 / 司空',
      relationToPlayer: '敌对/无视',
      contactLevel: 0,
      recentAttitude: '冷漠',
      summary: '董卓入京掌权，威压朝野。',
      appearance: '体躯魁梧，神色阴鸷。',
      personality: '残忍多疑，贪权好杀。',
      motivation: '控制朝政，立威自保。',
      traits: [
        {
          id: 'trait_cruel_tyrant',
          label: '凶残暴虐',
          description: '以威刑和屠戮压服部属与朝臣。',
          promptHint: '遇到权力冲突、恐吓、处决和乱政时，应作为强叙事权重。',
          source: 'history',
          rarity: 'red',
        },
        {
          id: 'trait_liangzhou_army',
          label: '凉州军威',
          description: '麾下边军悍卒，军势压迫感强。',
          source: 'history',
        },
      ],
      effects: [],
      memories: [],
    },
  ],
};

describe('NPC trait chips', () => {
  it('keeps trait descriptions and rarity for NPC archive hover display', () => {
    const card = buildNpcPanelModel(stateWithNpcTraits).cards[0];

    expect(card.traitChips[0]).toMatchObject({
      label: '凶残暴虐',
      rarity: 'red',
      source: 'history',
    });
    expect(card.traitChips[0].title).toContain('等级：红');
    expect(card.traitChips[0].title).toContain('叙事作用');
    expect(card.traitChips[1]).toMatchObject({
      label: '凉州军威',
      rarity: 'white',
      source: 'history',
    });
    expect(card.traitChips[1].title).toContain('等级：白');
  });
});