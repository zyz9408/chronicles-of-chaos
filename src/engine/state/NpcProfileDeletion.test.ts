import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from './createInitialRuntimeState';
import { analyzeNpcProfileDeletion, deleteNpcProfileSafely } from './NpcProfileDeletion';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '1.2.13',
    worldBookId: 'npc-delete-test',
    worldBookVersion: '1.0.0',
    worldBookSource: 'official',
    startDate: '公元190年01月01日',
    currentDate: '公元190年01月02日',
    player: {
      id: 'player',
      name: '林砚',
      roleType: '游侠',
      summary: '正在乱世中行走。',
      uniqueArts: [{
        id: 'art_old_debt',
        name: '旧债',
        rarity: 'white',
        domain: 'social',
        level: 1,
        description: '与旧识有关的承接。',
        effectSummary: '保留旧事。',
        source: 'event',
        relatedNpcIds: ['npc_scout'],
      }],
    },
    currentLocationId: 'loc_camp',
    knownActors: [{
      id: 'npc_scout',
      name: '周安',
      roleType: '斥候',
      summary: '旧兼容角色索引。',
    }],
    knownFactions: [],
    relationships: [{
      id: 'rel_scout',
      actorId: 'player',
      targetId: 'npc_scout',
      targetType: 'actor',
      type: 'acquaintance',
      value: 2,
      description: '一面之缘。',
    }],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    npcs: [{
      npcId: 'npc_scout',
      name: '周安',
      sex: '男',
      age: 24,
      role: '临时斥候',
      locationId: 'loc_camp',
      isPresent: true,
      isFocused: false,
      currentIdentity: '临时斥候',
      summary: '只在本场递送过一次消息。',
      appearance: '短褐蒙尘。',
      personality: '谨慎。',
      motivation: '完成差事。',
      relationToPlayer: '一面之缘',
      contactLevel: 1,
      recentAttitude: '拘谨',
      abilityScores: { 武力: 42, 统率: 34, 智力: 48, 政治: 28, 魅力: 36, 机运: 45 },
      traits: [{ id: 'trait_scout', label: '识路', description: '认识近路。', source: 'event' }],
      memories: [],
    }, {
      npcId: 'npc_other',
      name: '陈衡',
      sex: '男',
      age: 31,
      role: '书吏',
      locationId: 'loc_camp',
      isPresent: true,
      isFocused: true,
      currentIdentity: '军中书吏',
      summary: '负责文书。',
      appearance: '青衫佩笔。',
      personality: '谨慎。',
      motivation: '整理军书。',
      relationToPlayer: '同营办事',
      contactLevel: 8,
      recentAttitude: '恭谨',
      abilityScores: { 武力: 30, 统率: 42, 智力: 62, 政治: 55, 魅力: 45, 机运: 40 },
      traits: [],
      uniqueArts: [{
        id: 'art_shared_history',
        name: '旧闻',
        rarity: 'white',
        domain: 'social',
        level: 1,
        description: '记得周安递信一事。',
        effectSummary: '保留旧闻。',
        source: 'event',
        relatedNpcIds: ['npc_scout'],
      }],
      memories: [],
    }],
    npcAwarenessIndex: [{
      awarenessId: 'aware_scout',
      npcId: 'npc_scout',
      name: '周安',
      sourceType: 'npcProfile',
      sourceIds: ['npc_scout'],
      contactLevel: 1,
      playerRelevance: [],
      knownToPlayer: true,
      archiveVisible: true,
      updatedAt: '公元190年01月02日',
    }],
    factions: [{
      factionId: 'faction_camp',
      name: '营中军府',
      type: '军府',
      summary: '驻军。',
      stanceToPlayer: '中立',
      knownLevel: '亲历',
      knownMemberNpcIds: ['npc_scout', 'npc_other'],
      recentActions: [],
    }],
    holdings: [{
      holdingId: 'holding_camp',
      name: '临时营地',
      type: 'camp',
      status: 'temporary',
      summary: '驻军营地。',
      civilAdministrationScope: 'none',
      scaleLevel: 1,
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 50,
      popularSupport: 50,
      defense: 40,
      recruitPotential: 10,
      armory: 20,
      horseSupply: 10,
      relatedNpcIds: ['npc_scout'],
      updatedAt: '公元190年01月02日',
    }],
    combatRecords: [{
      combatId: 'combat_old',
      kind: 'melee',
      title: '营外短斗',
      summary: '周安曾在场。',
      occurredAt: '公元190年01月01日',
      participants: [{ npcId: 'npc_scout', name: '周安', side: 'ally' }],
      playerInvolved: true,
      resultLevel: 'win',
      outcome: '敌人退去。',
      significance: 'minor',
      relatedNpcIds: ['npc_scout'],
    }],
  });
}

describe('NPC 人物志安全删除', () => {
  it('删除无实时绑定的误收录人物并清理派生索引，但保留历史战报', () => {
    const state = makeState();
    const result = deleteNpcProfileSafely(state, 'npc_scout');

    expect(result.deleted).toBe(true);
    expect(result.analysis.canDelete).toBe(true);
    expect(result.state.npcs?.map((npc) => npc.npcId)).toEqual(['npc_other']);
    expect(result.state.knownActors).toEqual([]);
    expect(result.state.relationships).toEqual([]);
    expect(result.state.npcAwarenessIndex).toEqual([]);
    expect(result.state.factions?.[0].knownMemberNpcIds).toEqual(['npc_other']);
    expect(result.state.holdings?.[0].relatedNpcIds).toEqual([]);
    expect(result.state.player.uniqueArts?.[0].relatedNpcIds).toEqual([]);
    expect(result.state.npcs?.[0].uniqueArts?.[0].relatedNpcIds).toEqual([]);
    expect(result.state.combatRecords?.[0].participants[0]).toMatchObject({
      npcId: 'npc_scout',
      name: '周安',
    });
    expect(state.npcs?.some((npc) => npc.npcId === 'npc_scout')).toBe(true);
  });

  it('阻止删除仍被实时系统引用的人物，并列出稳定引用来源', () => {
    const state = makeState();
    state.troops = [{
      troopId: 'troop_one',
      name: '斥候队',
      size: 20,
      lifecycleStatus: 'active',
      leaderNpcId: 'npc_scout',
      morale: 50,
      training: 40,
      supplies: 30,
      task: '侦察营外',
      relationToPlayer: '受玩家指挥',
    }];
    state.holdings![0].stewardNpcId = 'npc_scout';
    state.privateAssets = [{
      privateAssetId: 'asset_one',
      name: '小院',
      type: 'estate',
      ownerScope: 'personal',
      status: 'active',
      summary: '落脚处。',
      managerNpcId: 'npc_scout',
      updatedAt: state.currentDate,
    }];
    state.factions![0].corePersonNpcIds = ['npc_scout'];
    state.activeQuests = [{
      id: 'quest_one',
      title: '追查军报',
      description: '查明消息来源。',
      status: 'active',
      relatedNpcIds: ['npc_scout'],
      createdAt: state.currentDate,
      updatedAt: state.currentDate,
    }];
    state.heroineThreads = [{
      heroineThreadId: 'heroine_one',
      npcId: 'npc_scout',
      npcName: '周安',
      status: 'paused',
      stage: '旧识',
      relationshipRole: '旧识',
      summary: '暂停中的关系。',
      lastUpdatedAt: state.currentDate,
    }];
    state.bondThreads = [{
      bondThreadId: 'bond_one',
      targetNpcIds: ['npc_scout'],
      targetNames: ['周安'],
      bondType: 'debt',
      status: 'active',
      summary: '尚未偿还的人情。',
      lastUpdatedAt: state.currentDate,
    }];
    state.npcs!.push({
      ...state.npcs![1],
      npcId: 'npc_child',
      name: '周童',
      parentLinks: { motherNpcId: 'npc_scout' },
    });
    state.encounterV2 = {
      semanticProjections: [],
      pendingOffer: {
        offerId: 'offer_one',
        createdAt: '2026-07-31T00:00:00.000Z',
        intent: {
          contractVersion: 1,
          encounterId: 'encounter_one',
          kind: 'personal_combat',
          rulesetVersion: 'combat-v2.0.0',
          sourceTurnNumber: 1,
          locationId: 'loc_camp',
          reason: '营外遭遇',
          seed: 'seed_one',
          createdAt: '2026-07-31T00:00:00.000Z',
          policy: {
            lethality: 'standard',
            allowRetreat: true,
            allowSurrender: true,
            allowCapture: true,
            lootPolicy: 'actual_items_only',
          },
          playerParty: { actorIds: ['player'] },
          enemyParty: { actorIds: ['npc_scout'] },
          partySelection: 'locked',
        },
      },
      appliedResultHashes: [],
      narratedResultHashes: [],
    };

    const analysis = analyzeNpcProfileDeletion(state, 'npc_scout');
    const result = deleteNpcProfileSafely(state, 'npc_scout');

    expect(analysis.canDelete).toBe(false);
    expect(analysis.blockers.map((blocker) => blocker.kind)).toEqual(expect.arrayContaining([
      'troop_assignment',
      'holding_steward',
      'private_asset_manager',
      'faction_core',
      'active_quest',
      'heroine_thread',
      'bond_thread',
      'family_link',
      'active_encounter',
    ]));
    expect(result.deleted).toBe(false);
    expect(result.state).toBe(state);
  });

  it('怀孕记录仍将人物列为可能父亲时阻止删除', () => {
    const state = makeState();
    state.npcs = [
      ...(state.npcs ?? []),
      {
        npcId: 'npc_mother',
        name: '阿兰',
        sex: '女',
        age: 26,
        role: '村民',
        summary: '村中女子。',
        appearance: '布衣。',
        personality: '谨慎。',
        motivation: '平安生活。',
        relationToPlayer: '相识',
        contactLevel: 2,
        recentAttitude: '平静',
        isPresent: false,
        isFocused: false,
        femaleProfile: {
          adultPrivateProfile: {
            wombProfile: {
              pregnancy: {
                pregnancyId: 'pregnancy_test',
                status: 'pendingCheck',
                cycleKey: '194-05',
                firstExposureAt: '公元194年05月01日',
                checkAt: '公元194年05月20日',
                exposureCount: 1,
                chanceBasisPoints: 1000,
                rollBasisPoints: 500,
                fatherCharacterIds: ['npc_scout'],
                paternityStatus: 'known',
                disclosure: 'private',
              },
            },
          },
        },
        memories: [],
      },
    ];

    const analysis = analyzeNpcProfileDeletion(state, 'npc_scout');

    expect(analysis.canDelete).toBe(false);
    expect(analysis.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'family_link' }),
    ]));
  });

  it('不存在的人物不会产生删除写回', () => {
    const state = makeState();
    const result = deleteNpcProfileSafely(state, 'npc_missing');

    expect(result.deleted).toBe(false);
    expect(result.analysis).toMatchObject({
      exists: false,
      canDelete: false,
      npcId: 'npc_missing',
    });
    expect(result.state).toBe(state);
  });
});
