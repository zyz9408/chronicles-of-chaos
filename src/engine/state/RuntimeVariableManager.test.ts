import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from './createInitialRuntimeState';
import {
  RUNTIME_VARIABLE_SECTIONS,
  createRuntimeVariableDraft,
  getRuntimeVariableEditor,
  listRuntimeVariableEntities,
  previewRuntimeVariableEdit,
  type RuntimeVariableSection,
} from './RuntimeVariableManager';

function makeState(): RuntimeState {
  const state = ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'runtime-variable-world',
    worldBookVersion: '1.0.0',
    worldBookSource: 'official',
    startDate: '公元184年03月01日 08:00（辰时）',
    currentDate: '公元184年03月01日 08:00（辰时）',
    player: {
      id: 'player_1',
      name: '林砚',
      roleType: 'officer',
      summary: '测试角色',
      locationId: 'place_test',
      birthDate: '公元166年04月18日',
      abilityScores: { 武力: 70, 统率: 65, 智力: 55, 政治: 45, 魅力: 60 },
      vitals: { hp: 90, maxHp: 100, stamina: 80, maxStamina: 100 },
      personalMoney: 1000,
    },
    currentLocationId: 'place_test',
    currentPlaceId: 'place_test',
    knownActors: [{
      id: 'npc_1',
      name: '赵云',
      roleType: 'officer',
      summary: '常山义士',
      locationId: 'place_test',
    }],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    mapNodes: [{
      id: 'place_test',
      name: '真定城',
      level: 'settlement',
      mapLayer: 'place',
      summary: '测试地点',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
    }],
    npcs: [{
      npcId: 'npc_1',
      name: '赵云',
      sex: '男',
      age: 16,
      birthDate: '公元168年01月01日',
      role: '义士',
      currentIdentity: '常山义士',
      identitySummary: '常山义士',
      summary: '常山义士',
      appearance: '英武',
      personality: '沉稳',
      motivation: '保境安民',
      locationId: 'place_test',
      isPresent: true,
      isFocused: true,
      contactLevel: 20,
      relationToPlayer: '相识',
      recentAttitude: '友善',
      vitals: { hp: 100, maxHp: 100, stamina: 90, maxStamina: 100 },
      abilityScores: { 武力: 90, 统率: 80, 智力: 65, 政治: 45, 魅力: 70 },
      memories: [],
    }],
    holdings: [{
      holdingId: 'holding_test',
      name: '真定县城',
      type: 'city',
      status: 'controlled',
      summary: '受控城池',
      civilAdministrationScope: 'territorial',
      scaleLevel: 2,
      civilScaleLevel: 2,
      agriculture: 50,
      commerce: 45,
      population: 55,
      publicOrder: 60,
      popularSupport: 55,
      defense: 50,
      recruitPotential: 40,
      armory: 30,
      horseSupply: 20,
      corruption: 15,
      farmlandMu: 20_000,
      registeredHouseholds: 3_000,
      updatedAt: '公元184年03月01日 08:00（辰时）',
    }],
  });
  return state;
}

function draftFor(state: RuntimeState, section: RuntimeVariableSection, entityId?: string) {
  const editor = getRuntimeVariableEditor(state, section, entityId);
  if (!editor) throw new Error('missing editor');
  return createRuntimeVariableDraft(editor);
}

function makeExpandedState(): RuntimeState {
  const state = makeState();
  return ensureLuanShiState({
    ...state,
    relationships: [{
      id: 'rel_1',
      actorId: 'player_1',
      targetId: 'npc_1',
      targetType: 'actor',
      type: '相识',
      value: 20,
      description: '并肩作战',
    }],
    player: {
      ...state.player,
      inventory: [{
        id: 'item_1',
        name: '长枪',
        quantity: 1,
        category: 'equipment',
        quality: 'blue',
        description: '精钢长枪',
        statBonuses: { 武力: 5 },
      }],
      uniqueArts: [{
        id: 'art_1',
        name: '破阵枪',
        rarity: 'purple',
        domain: 'personalCombat',
        level: 2,
        maxLevel: 10,
        progress: 25,
        description: '以枪破阵',
        effectSummary: '提高枪术威力',
        source: 'training',
        promptHint: '保持距离',
      }],
    },
    resources: {
      money: 100,
      grain: 200,
      horses: 10,
      arms: 20,
      recruits: 30,
      weapons: ['环首刀'],
      documents: ['调令'],
      tokens: ['兵符'],
      importantSupplies: ['药材'],
    },
    troops: [{
      troopId: 'troop_1',
      name: '常山部曲',
      size: 100,
      deployableSize: 90,
      troopType: '步卒',
      quality: '中',
      fatigue: '低',
      warFatiguePercent: 10,
      readiness: '中',
      lifecycleStatus: 'active',
      leaderNpcId: 'player_1',
      deputyNpcIds: ['npc_1'],
      locationId: 'place_test',
      morale: 70,
      training: 60,
      supplies: 100,
      task: '驻防',
      relationToPlayer: '玩家直辖',
      upkeepSource: 'player_resources',
      updatedAt: state.currentDate,
    }],
    privateAssets: [{
      privateAssetId: 'asset_1',
      name: '林氏田庄',
      type: 'estate',
      ownerScope: 'personal',
      status: 'active',
      summary: '小型田庄',
      locationId: 'place_test',
      mu: 100,
      households: 10,
      updatedAt: state.currentDate,
    }],
  });
}

describe('RuntimeVariableManager', () => {
  it('exposes only controlled domain sections and no raw runtime JSON editor', () => {
    expect(RUNTIME_VARIABLE_SECTIONS.map((entry) => entry.id)).toEqual([
      'player', 'npc', 'inventory', 'uniqueArt', 'relationship', 'resources', 'troop', 'holding', 'privateAsset',
    ]);
    expect(getRuntimeVariableEditor(makeState(), 'player')?.fields.some((field) => field.key === 'id')).toBe(false);
    expect(getRuntimeVariableEditor(makeState(), 'player')?.fields.some((field) => field.key === 'turnLog')).toBe(false);
  });

  it('updates player facts without changing stable identity, time, or history', () => {
    const state = makeState();
    const draft = draftFor(state, 'player');
    draft.currentIdentity = '羽林郎';
    draft.hp = 95;
    draft.personalMoney = 1500;
    const result = previewRuntimeVariableEdit(state, 'player', undefined, draft);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result).toMatchObject({ ok: true });
    expect(result.state.player.id).toBe('player_1');
    expect(result.state.player.currentIdentity).toBe('羽林郎');
    expect(result.state.player.vitals?.hp).toBe(95);
    expect(result.state.player.personalMoney).toBe(1500);
    expect(result.state.currentDate).toBe(state.currentDate);
    expect(result.state.turnLog).toEqual([]);
  });

  it('rejects invalid vitals rather than silently clamping them', () => {
    const state = makeState();
    const draft = draftFor(state, 'player');
    draft.hp = 101;
    const result = previewRuntimeVariableEdit(state, 'player', undefined, draft);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors.join('\n')).toContain('生命');
  });

  it('updates an NPC and its known-actor projection together', () => {
    const state = makeState();
    const draft = draftFor(state, 'npc', 'npc_1');
    draft.currentIdentity = '常山骑都尉';
    draft.contactLevel = 35;
    const result = previewRuntimeVariableEdit(state, 'npc', 'npc_1', draft);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result).toMatchObject({ ok: true });
    expect(result.state.npcs?.[0].currentIdentity).toBe('常山骑都尉');
    expect(result.state.knownActors[0].currentIdentity).toBe('常山骑都尉');
    expect(result.state.npcs?.[0].contactLevel).toBe(35);
  });

  it('rejects holding values above the type and civil-scale capacity', () => {
    const state = makeState();
    const draft = draftFor(state, 'holding', 'holding_test');
    draft.farmlandMu = 999_999_999;
    const result = previewRuntimeVariableEdit(state, 'holding', 'holding_test', draft);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors.join('\n')).toContain('田亩');
  });

  it('lists existing entities but never invents a new record from free text', () => {
    const state = makeState();
    expect(listRuntimeVariableEntities(state, 'npc')).toEqual([
      expect.objectContaining({ id: 'npc_1', label: '赵云' }),
    ]);
    expect(getRuntimeVariableEditor(state, 'npc', 'npc_missing')).toBeNull();
  });

  it('preserves protected inventory and unique-art fields while editing controlled values', () => {
    const state = makeExpandedState();
    const inventoryDraft = draftFor(state, 'inventory', 'item_1');
    inventoryDraft.quantity = 2;
    inventoryDraft.quality = 'orange';
    const inventoryResult = previewRuntimeVariableEdit(state, 'inventory', 'item_1', inventoryDraft);
    if (!inventoryResult.ok) throw new Error(inventoryResult.errors.join('\n'));
    expect(inventoryResult.state.player.inventory?.[0]).toMatchObject({
      quantity: 2,
      quality: 'orange',
      statBonuses: { 武力: 5 },
    });

    const artEntityId = 'player::player_1::art_1';
    const artDraft = draftFor(inventoryResult.state, 'uniqueArt', artEntityId);
    artDraft.progress = 80;
    const artResult = previewRuntimeVariableEdit(inventoryResult.state, 'uniqueArt', artEntityId, artDraft);
    if (!artResult.ok) throw new Error(artResult.errors.join('\n'));
    expect(artResult.state.player.uniqueArts?.[0]).toMatchObject({
      progress: 80,
      domain: 'personalCombat',
      promptHint: '保持距离',
    });
  });

  it('updates public resources without losing document and token ledgers', () => {
    const state = makeExpandedState();
    const draft = draftFor(state, 'resources');
    draft.money = 500;
    const result = previewRuntimeVariableEdit(state, 'resources', undefined, draft);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.state.resources).toEqual({
      money: 500,
      grain: 200,
      horses: 10,
      arms: 20,
      recruits: 30,
      weapons: ['环首刀'],
      documents: ['调令'],
      tokens: ['兵符'],
      importantSupplies: ['药材'],
    });
  });

  it('allows one-step troop expansion but rejects duplicate officer roles', () => {
    const state = makeExpandedState();
    const draft = draftFor(state, 'troop', 'troop_1');
    draft.size = 200;
    draft.deployableSize = 180;
    const result = previewRuntimeVariableEdit(state, 'troop', 'troop_1', draft);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.state.troops?.[0]).toMatchObject({ size: 200, deployableSize: 180 });

    const duplicateDraft = draftFor(state, 'troop', 'troop_1');
    duplicateDraft.strategistNpcId = 'npc_1';
    const duplicateResult = previewRuntimeVariableEdit(state, 'troop', 'troop_1', duplicateDraft);
    expect(duplicateResult).toMatchObject({ ok: false });
    if (!duplicateResult.ok) expect(duplicateResult.errors.join('\n')).toContain('重复任职');
  });

  it('rejects unknown private-asset locations and values above the asset policy limit', () => {
    const state = makeExpandedState();
    const unknownLocationDraft = draftFor(state, 'privateAsset', 'asset_1');
    unknownLocationDraft.locationId = 'place_missing';
    const unknownLocationResult = previewRuntimeVariableEdit(state, 'privateAsset', 'asset_1', unknownLocationDraft);
    expect(unknownLocationResult).toMatchObject({ ok: false });
    if (!unknownLocationResult.ok) expect(unknownLocationResult.errors.join('\n')).toContain('已固化地点');

    const oversizedDraft = draftFor(state, 'privateAsset', 'asset_1');
    oversizedDraft.mu = 999_999_999;
    const oversizedResult = previewRuntimeVariableEdit(state, 'privateAsset', 'asset_1', oversizedDraft);
    expect(oversizedResult).toMatchObject({ ok: false });
    if (!oversizedResult.ok) expect(oversizedResult.errors.join('\n')).toContain('田亩');
  });
});
