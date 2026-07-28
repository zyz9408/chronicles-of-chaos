import { describe, expect, it } from 'vitest';
import {
  createCombatEncounterSnapshot,
  createValidatedCombatProjectionBundle,
} from './CombatSnapshotAdapter';
import {
  bundle,
  makeArmorProfile,
  makeCombatIntent,
  makeCombatantSource,
  makeDamageArtProfile,
  makeHealingItemProfile,
  makeNpcCombatantSource,
  makeTraitProfile,
  makeWeaponProfile,
} from './CombatTestFixtures';

describe('CombatSnapshotAdapter', () => {
  it('creates a validated and deeply frozen projection bundle before combat starts', () => {
    const projectionBundle = createValidatedCombatProjectionBundle([
      makeTraitProfile('trait_frozen'),
      makeDamageArtProfile('art_frozen'),
    ]);

    expect(Object.isFrozen(projectionBundle)).toBe(true);
    expect(Object.isFrozen(projectionBundle.profiles)).toBe(true);
    expect(Object.isFrozen(projectionBundle.profiles[0])).toBe(true);
  });

  it('freezes Actor and LuanShiNpc-shaped sources in intent order without changing IDs', () => {
    const intent = makeCombatIntent(['player', 'ally'], ['enemy']);
    const snapshot = createCombatEncounterSnapshot({
      sessionId: 'session_snapshot_001',
      intent,
      playerSources: [makeCombatantSource('ally'), makeCombatantSource('player')],
      enemySources: [makeNpcCombatantSource('enemy')],
      projections: bundle(),
      threatTier: 'standard',
      lootableItemIds: [],
      capturableEquipmentItemIds: [],
    });

    expect(snapshot.combatants.map(({ actorId, side, stableOrder }) => ({ actorId, side, stableOrder }))).toEqual([
      { actorId: 'player', side: 'player', stableOrder: 0 },
      { actorId: 'ally', side: 'player', stableOrder: 1 },
      { actorId: 'enemy', side: 'enemy', stableOrder: 2 },
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.combatants)).toBe(true);
    expect(snapshot.snapshotHash).toMatch(/^fnv1a64:/);
  });

  it('uses only validated projections whose stable source IDs exist on that combatant', () => {
    const player = makeCombatantSource('player', {
      traits: [{ id: 'trait_real', label: '临危不乱', description: '', source: 'opening' }],
      uniqueArts: [{
        id: 'art_real', name: '七探蛇盘枪', rarity: 'blue', domain: 'personalCombat', level: 1,
        description: '', effectSummary: '', source: 'opening',
      }],
      equipment: [{ id: 'weapon_real', slot: 'weapon', name: '无名枪', quality: 'blue', description: '' }],
      inventory: [{ id: 'medicine_real', name: '药', quantity: 2 }],
    });
    const snapshot = createCombatEncounterSnapshot({
      sessionId: 'session_snapshot_002',
      intent: makeCombatIntent(['player'], ['enemy']),
      playerSources: [player],
      enemySources: [makeNpcCombatantSource('enemy')],
      projections: bundle(
        makeTraitProfile('trait_real'),
        makeTraitProfile('trait_same_name_but_missing', 99),
        makeDamageArtProfile('art_real'),
        makeWeaponProfile('weapon_real'),
        makeHealingItemProfile('medicine_real'),
      ),
      threatTier: 'minor',
      lootableItemIds: [],
      capturableEquipmentItemIds: [],
    });

    const frozenPlayer = snapshot.combatants[0];
    expect(frozenPlayer.traitProfiles.map((profile) => profile.sourceId)).toEqual(['trait_real']);
    expect(frozenPlayer.uniqueArtProfiles.map((profile) => profile.sourceId)).toEqual(['art_real']);
    expect(frozenPlayer.itemProfiles.map((profile) => profile.sourceId)).toEqual(['medicine_real']);
    expect(frozenPlayer.weapon.sourceId).toBe('weapon_real');
  });

  it('does not infer combat rules from evocative names or free text when projection is absent', () => {
    const source = makeCombatantSource('player', {
      traits: [{ id: 'trait_name_only', label: '神速无双', description: '速度天下第一', source: 'event' }],
      uniqueArts: [{
        id: 'art_name_only', name: '一击必杀', rarity: 'red', domain: 'personalCombat', level: 9,
        description: '必定命中并秒杀', effectSummary: '无视防御', source: 'event',
      }],
      equipment: [{
        id: 'weapon_name_only', slot: 'weapon', name: '开天神斧', quality: 'red',
        description: '毁天灭地', statBonuses: { 武力: 999 },
      }],
    });
    const snapshot = createCombatEncounterSnapshot({
      sessionId: 'session_snapshot_003',
      intent: makeCombatIntent(['player'], ['npc_enemy_guard']),
      playerSources: [source],
      enemySources: [makeNpcCombatantSource('npc_enemy_guard')],
      projections: bundle(),
      threatTier: 'minor',
      lootableItemIds: [],
      capturableEquipmentItemIds: [],
    });

    expect(snapshot.combatants[0].speed).toBe(110);
    expect(snapshot.combatants[0].weapon).toMatchObject({ sourceId: null, baseDamage: 5, weight: 'unarmed' });
    expect(snapshot.combatants[0].uniqueArtProfiles).toEqual([]);
    expect(snapshot.combatants[0].traitProfiles).toEqual([]);
  });

  it('derives speed from projected weapon, armor, mount and treasure then clamps it to 60—160', () => {
    const equipment = [
      { id: 'weapon', slot: 'weapon' as const, name: '', quality: '', description: '' },
      { id: 'armor', slot: 'armor' as const, name: '', quality: '', description: '' },
      { id: 'mount', slot: 'mount' as const, name: '', quality: '', description: '' },
      { id: 'treasure', slot: 'treasure' as const, name: '', quality: '', description: '' },
    ];
    const snapshot = createCombatEncounterSnapshot({
      sessionId: 'session_snapshot_004',
      intent: makeCombatIntent(),
      playerSources: [makeCombatantSource('player_liuping', { equipment })],
      enemySources: [makeNpcCombatantSource('npc_enemy_guard')],
      projections: bundle(
        makeWeaponProfile('weapon', { weaponWeight: 'heavy', speedModifier: -15 }),
        makeArmorProfile('armor', { armorWeight: 'heavy', speedModifier: -10 }),
        makeWeaponProfile('mount', {
          equipmentSlot: 'mount', qualityTier: 'red', weaponWeight: undefined, speedModifier: 25,
        }),
        makeWeaponProfile('treasure', {
          equipmentSlot: 'treasure', qualityTier: 'red', weaponWeight: undefined, speedModifier: 15,
        }),
      ),
      threatTier: 'minor',
      lootableItemIds: [],
      capturableEquipmentItemIds: [],
    });

    expect(snapshot.combatants[0].speed).toBe(120);
  });

  it('rejects missing participants, invalid projections and loot IDs absent from the frozen enemy snapshot', () => {
    expect(() => createCombatEncounterSnapshot({
      sessionId: 'session_snapshot_bad_1',
      intent: makeCombatIntent(),
      playerSources: [],
      enemySources: [makeNpcCombatantSource('npc_enemy_guard')],
      projections: bundle(),
      threatTier: 'minor',
      lootableItemIds: [],
      capturableEquipmentItemIds: [],
    })).toThrow('player_liuping');

    expect(() => createCombatEncounterSnapshot({
      sessionId: 'session_snapshot_bad_2',
      intent: makeCombatIntent(),
      playerSources: [makeCombatantSource('player_liuping')],
      enemySources: [makeNpcCombatantSource('npc_enemy_guard')],
      projections: bundle(makeWeaponProfile('weapon_bad', { weaponBaseDamage: 999 })),
      threatTier: 'minor',
      lootableItemIds: [],
      capturableEquipmentItemIds: [],
    })).toThrow('投影');

    expect(() => createCombatEncounterSnapshot({
      sessionId: 'session_snapshot_bad_3',
      intent: makeCombatIntent(),
      playerSources: [makeCombatantSource('player_liuping')],
      enemySources: [makeNpcCombatantSource('npc_enemy_guard')],
      projections: bundle(),
      threatTier: 'minor',
      lootableItemIds: ['invented_loot'],
      capturableEquipmentItemIds: [],
    })).toThrow('invented_loot');
  });
});
