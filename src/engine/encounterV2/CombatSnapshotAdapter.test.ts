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
      combatDifficulty: 'easy',
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
    expect(snapshot.combatDifficulty).toBe('easy');
  });

  it('defaults missing or invalid combat difficulty to standard before freezing the snapshot', () => {
    const base = {
      sessionId: 'session_snapshot_difficulty_default',
      intent: makeCombatIntent(),
      playerSources: [makeCombatantSource('player_liuping')],
      enemySources: [makeNpcCombatantSource('npc_enemy_guard')],
      projections: bundle(),
      threatTier: 'minor' as const,
      lootableItemIds: [],
      capturableEquipmentItemIds: [],
    };
    expect(createCombatEncounterSnapshot(base).combatDifficulty).toBe('standard');
    expect(createCombatEncounterSnapshot({
      ...base,
      combatDifficulty: 'legacy' as never,
    }).combatDifficulty).toBe('standard');
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

  it('uses structured quality and domain fallbacks without interpreting legacy names or descriptions', () => {
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

    expect(snapshot.combatants[0].speed).toBe(105);
    expect(snapshot.combatants[0].weapon).toEqual({
      sourceId: 'weapon_name_only',
      qualityTier: 'red',
      baseDamage: 19,
      accuracyBonus: 8,
      armorPenetration: 8,
      weight: 'standard',
    });
    expect(snapshot.combatants[0].uniqueArtProfiles).toEqual([
      expect.objectContaining({
        sourceId: 'art_name_only',
        status: 'executable',
        rulesetScopes: ['personal_combat'],
      }),
    ]);
    expect(snapshot.combatants[0].traitProfiles).toEqual([]);
  });

  it('materializes executable weapon and armor projections to their quality baselines', () => {
    const projectionBundle = createValidatedCombatProjectionBundle([
      makeWeaponProfile('weapon_red', {
        qualityTier: 'red',
        weaponWeight: undefined,
        weaponBaseDamage: undefined,
        accuracyBonus: undefined,
        armorPenetration: undefined,
      }),
      makeArmorProfile('armor_orange', {
        qualityTier: 'orange',
        armorWeight: undefined,
        blockBonus: undefined,
        armorTier: undefined,
      }),
    ]);

    expect(projectionBundle.profiles).toEqual([
      expect.objectContaining({
        sourceId: 'weapon_red',
        weaponWeight: 'standard',
        weaponBaseDamage: 19,
        accuracyBonus: 8,
        armorPenetration: 8,
      }),
      expect.objectContaining({
        sourceId: 'armor_orange',
        armorWeight: 'medium',
        blockBonus: 8,
        armorTier: 5,
      }),
    ]);
  });

  it('keeps the equipped item internal quality authoritative over a mismatched projection tier', () => {
    const snapshot = createCombatEncounterSnapshot({
      sessionId: 'session_snapshot_quality_source',
      intent: makeCombatIntent(),
      playerSources: [makeCombatantSource('player_liuping', {
        equipment: [{
          id: 'weapon_quality_source',
          slot: 'weapon',
          name: '不参与品质判断的名称',
          quality: 'orange',
          description: '',
        }],
      })],
      enemySources: [makeNpcCombatantSource('npc_enemy_guard')],
      projections: bundle(makeWeaponProfile('weapon_quality_source', {
        qualityTier: 'red',
        weaponBaseDamage: 25,
        accuracyBonus: 12,
        armorPenetration: 12,
      })),
      threatTier: 'minor',
      lootableItemIds: [],
      capturableEquipmentItemIds: [],
    });

    expect(snapshot.combatants[0].weapon).toMatchObject({
      qualityTier: 'orange',
      baseDamage: 21,
      accuracyBonus: 10,
      armorPenetration: 9,
    });
  });

  it('uses canonical Chinese quality grades and legacy colour aliases for every equipped slot', () => {
    const snapshot = createCombatEncounterSnapshot({
      sessionId: 'session_snapshot_natural_quality',
      intent: makeCombatIntent(),
      playerSources: [makeCombatantSource('player_liuping', {
        equipment: [
          { id: 'natural_weapon', slot: 'weapon', name: '御赐长刀', quality: '传说', description: '御赐军器。' },
          { id: 'natural_armor', slot: 'armor', name: '国宝明光铠', quality: '传说级', description: '列入府库国宝。' },
          { id: 'natural_mount', slot: 'mount', name: '名驹', quality: '橙色', description: '' },
          { id: 'natural_treasure', slot: 'treasure', name: '绝世兵符', quality: '绝世', description: '' },
        ],
      })],
      enemySources: [makeNpcCombatantSource('npc_enemy_guard')],
      projections: bundle(),
      threatTier: 'minor',
      lootableItemIds: [],
      capturableEquipmentItemIds: [],
    });

    expect(snapshot.combatants[0].weapon).toMatchObject({
      qualityTier: 'orange', baseDamage: 16, accuracyBonus: 6, armorPenetration: 6,
    });
    expect(snapshot.combatants[0].armor).toMatchObject({
      qualityTier: 'orange', armorTier: 5, blockBonus: 8,
    });
    expect(snapshot.combatants[0].speed).toBe(135);
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

  it('keeps three distinct treasure slots and bounds their combined speed contribution', () => {
    const treasures = [1, 2, 3].map((index) => ({
      id: `treasure_${index}`,
      slot: 'treasure' as const,
      name: `宝物${index}`,
      quality: '绝世',
      description: '',
    }));
    const snapshot = createCombatEncounterSnapshot({
      sessionId: 'session_snapshot_three_treasures',
      intent: makeCombatIntent(),
      playerSources: [makeCombatantSource('player_liuping', { equipment: treasures })],
      enemySources: [makeNpcCombatantSource('npc_enemy_guard')],
      projections: bundle(...treasures.map((item) => makeWeaponProfile(item.id, {
        equipmentSlot: 'treasure',
        qualityTier: 'red',
        weaponWeight: undefined,
        speedModifier: 15,
      }))),
      threatTier: 'minor',
      lootableItemIds: [],
      capturableEquipmentItemIds: [],
    });

    expect(snapshot.combatants[0].equipmentItemIds).toEqual([
      'treasure_1',
      'treasure_2',
      'treasure_3',
    ]);
    expect(snapshot.combatants[0].equipmentProfiles.map((profile) => profile.sourceId)).toEqual([
      'treasure_1',
      'treasure_2',
      'treasure_3',
    ]);
    expect(snapshot.combatants[0].speed).toBe(140);
  });

  it('deduplicates identical legacy treasure rows and ignores overflow beyond three combat slots', () => {
    const duplicate = {
      id: 'treasure_legacy_duplicate',
      slot: 'treasure' as const,
      name: '旧档重复印信',
      quality: '传说',
      description: '',
    };
    const equipment = [
      duplicate,
      { ...duplicate },
      { ...duplicate, id: 'treasure_second', name: '虎符' },
      { ...duplicate, id: 'treasure_third', name: '节钺' },
      { ...duplicate, id: 'treasure_overflow', name: '多余宝物' },
    ];
    const snapshot = createCombatEncounterSnapshot({
      sessionId: 'session_snapshot_legacy_treasure_rows',
      intent: makeCombatIntent(),
      playerSources: [makeCombatantSource('player_liuping', { equipment })],
      enemySources: [makeNpcCombatantSource('npc_enemy_guard')],
      projections: bundle(),
      threatTier: 'minor',
      lootableItemIds: [],
      capturableEquipmentItemIds: [],
    });

    expect(snapshot.combatants[0].equipmentItemIds).toEqual([
      'treasure_legacy_duplicate',
      'treasure_second',
      'treasure_third',
    ]);
    expect(snapshot.combatants[0].speed).toBe(140);
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
