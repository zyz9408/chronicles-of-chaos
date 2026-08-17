import { describe, expect, it } from 'vitest';
import type { NarratorResponse } from './MockNarrator';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { detectNpcUniqueArtComplianceCandidates } from './NpcUniqueArtCompliance';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '公元194年',
    currentDate: '公元194年',
    player: { id: 'player', name: '主角', roleType: '游侠', summary: '测试。' },
    currentLocationId: 'loc_camp',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    npcs: [{
      npcId: 'npc_zhaoyun',
      name: '赵云',
      sex: '男',
      age: 27,
      role: '骑将',
      currentIdentity: '公孙瓒麾下骑将',
      locationId: 'loc_camp',
      isPresent: true,
      isFocused: true,
      summary: '以勇武和骑战闻名。',
      appearance: '白袍银甲。',
      personality: '沉毅。',
      motivation: '护持百姓。',
      relationToPlayer: '并肩作战',
      contactLevel: 8,
      recentAttitude: '信任',
      abilityScores: { 武力: 96, 统率: 85, 智力: 75, 政治: 62, 魅力: 88, 机运: 66 },
      traits: [{ id: 'trait_brave', label: '勇毅', description: '临阵不退。', source: 'history' }],
      memories: [],
    }],
    locations: [],
  });
}

function makeResponse(): NarratorResponse {
  return {
    protocolVersion: 'lsfy.turn.v1',
    narrativeText: '赵云提枪立于阵前。',
    suggestedActions: [],
    statePatches: [],
    statePatch: null,
    writeback: {
      npcProfileSuggestions: [],
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      debugNotes: [],
    },
  };
}

describe('NpcUniqueArtCompliance', () => {
  it('soft-detects a relevant legacy famous NPC without mutating the save', () => {
    const state = makeState();
    const before = JSON.stringify(state);
    const candidates = detectNpcUniqueArtComplianceCandidates({
      runtimeState: state,
      acceptedRuntimeState: state,
      response: makeResponse(),
      playerInput: '我请赵云一同出阵。',
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      npcId: 'npc_zhaoyun',
      name: '赵云',
      existedBeforeTurn: true,
      requirement: {
        highestAbilityName: '武力',
        highestScore: 96,
        minimumRarity: 'red',
      },
    });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('stops selecting the NPC after stable arts satisfy all exceptional domains', () => {
    const state = makeState();
    state.npcs![0].uniqueArts = [
      {
        id: 'art_zhaoyun_spear',
        name: '龙胆枪势',
        rarity: 'red',
        domain: 'personalCombat',
        level: 4,
        description: '以沉着迅疾的枪势破敌。',
        effectSummary: '强化个人战枪术。',
        source: 'history',
      },
      {
        id: 'art_zhaoyun_cavalry',
        name: '锐骑整军',
        rarity: 'purple',
        domain: 'warfare',
        level: 3,
        description: '统御精骑保持阵形。',
        effectSummary: '强化骑军统率。',
        source: 'history',
      },
      {
        id: 'art_zhaoyun_presence',
        name: '忠勇感召',
        rarity: 'purple',
        domain: 'social',
        level: 2,
        description: '以忠勇稳定身边军心。',
        effectSummary: '强化相关交涉与军心。',
        source: 'history',
      },
    ];
    const candidates = detectNpcUniqueArtComplianceCandidates({
      runtimeState: state,
      acceptedRuntimeState: state,
      response: makeResponse(),
      playerInput: '我请赵云一同出阵。',
    });
    expect(candidates).toEqual([]);
  });
});
