import { describe, expect, it } from 'vitest';
import type { Actor } from '../types';
import { projectEquippedItems } from './loadoutIdentity';
import { equipInventoryItem, removePlayerItem, unequipInventoryItem } from './playerLoadout';

function makePlayer(): Actor {
  return {
    id: 'player',
    name: '刘平',
    roleType: 'player',
    summary: '测试主角',
    inventory: [
      { id: 'item_supply_order', name: '粮草提取手令', quantity: 1, category: 'document' },
      { id: 'eq_sword', name: '军府佩剑', quantity: 1, category: 'equipment', equipSlot: 'weapon' },
    ],
    equipment: [{
      id: 'eq_sword',
      slot: 'weapon',
      name: '军府佩剑',
      quality: '精良',
      description: '军府制式佩剑。',
    }],
  };
}

describe('removePlayerItem', () => {
  it('移除完整背包堆叠且不改动其他物品', () => {
    const player = makePlayer();
    const next = removePlayerItem(player, 'item_supply_order');

    expect(next).not.toBe(player);
    expect(next.inventory).toEqual([
      expect.objectContaining({ id: 'eq_sword', quantity: 1 }),
    ]);
    expect(next.equipment).toEqual(player.equipment);
  });

  it('移除已装备物品时同步清理装备栏，避免幽灵装备', () => {
    const next = removePlayerItem(makePlayer(), 'eq_sword');

    expect(next.inventory).toEqual([
      expect.objectContaining({ id: 'item_supply_order' }),
    ]);
    expect(next.equipment).toEqual([]);
  });

  it('支持清理只存在于装备栏的旧存档物品', () => {
    const player = makePlayer();
    const equippedOnly: Actor = {
      ...player,
      inventory: player.inventory?.filter((item) => item.id !== 'eq_sword'),
    };

    expect(removePlayerItem(equippedOnly, 'eq_sword').equipment).toEqual([]);
  });

  it('找不到目标时保持原引用，避免伪保存', () => {
    const player = makePlayer();
    expect(removePlayerItem(player, 'item_missing')).toBe(player);
  });
});

describe('equipInventoryItem', () => {
  it('旧档隐藏的重复宝物不会占满三个可见槽位', () => {
    const duplicatedTreasure = {
      id: 'treasure_legacy_seal',
      slot: 'treasure' as const,
      name: '旧印信',
      quality: '珍贵',
      description: '旧档重复记录。',
    };
    const player: Actor = {
      ...makePlayer(),
      equipment: [
        duplicatedTreasure,
        { ...duplicatedTreasure },
        { ...duplicatedTreasure },
      ],
      inventory: [
        { id: duplicatedTreasure.id, name: duplicatedTreasure.name, quantity: 1, category: 'equipment', equipSlot: 'treasure' },
        { id: 'treasure_new_tally', name: '新虎符', quantity: 1, category: 'equipment', equipSlot: 'treasure' },
        { id: 'treasure_new_token', name: '新节钺', quantity: 1, category: 'equipment', equipSlot: 'treasure' },
      ],
    };

    const withSecondTreasure = equipInventoryItem(player, 'treasure_new_tally');
    const withThirdTreasure = equipInventoryItem(withSecondTreasure, 'treasure_new_token');

    expect(withSecondTreasure.equipment?.filter((item) => item.slot === 'treasure')).toHaveLength(2);
    expect(projectEquippedItems(withThirdTreasure.equipment ?? []).map((item) => item.name)).toEqual([
      '旧印信',
      '新虎符',
      '新节钺',
    ]);
  });
});

describe('unequipInventoryItem', () => {
  it('卸下装备时保留背包物品', () => {
    const player = makePlayer();
    const next = unequipInventoryItem(player, 'eq_sword', {
      slot: 'weapon',
      itemName: '军府佩剑',
    });

    expect(next.equipment).toEqual([]);
    expect(next.inventory).toEqual(player.inventory);
  });

  it('旧存档装备只存在于装备栏时会补回背包', () => {
    const player: Actor = {
      ...makePlayer(),
      inventory: makePlayer().inventory?.filter((item) => item.id !== 'eq_sword'),
    };
    const next = unequipInventoryItem(player, 'eq_sword', { slot: 'weapon' });

    expect(next.equipment).toEqual([]);
    expect(next.inventory).toContainEqual(expect.objectContaining({
      id: 'eq_sword',
      name: '军府佩剑',
      equipSlot: 'weapon',
    }));
  });

  it('能按宝物槽序号卸下指定宝物', () => {
    const treasures = [0, 1, 2].map((index) => ({
      id: `treasure_${index}`,
      slot: 'treasure' as const,
      name: `宝物${index + 1}`,
      quality: '珍贵',
      description: `第${index + 1}件宝物。`,
    }));
    const player: Actor = {
      ...makePlayer(),
      equipment: treasures,
      inventory: treasures.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: 1,
        category: 'equipment',
        equipSlot: 'treasure',
      })),
    };
    const next = unequipInventoryItem(player, 'treasure_1', {
      slot: 'treasure',
      treasureIndex: 1,
      itemName: '宝物2',
    });

    expect(next.equipment?.map((item) => item.id)).toEqual(['treasure_0', 'treasure_2']);
    expect(next.inventory).toHaveLength(3);
  });

  it('目标不在装备栏时保持原引用', () => {
    const player = makePlayer();
    expect(unequipInventoryItem(player, 'item_missing')).toBe(player);
  });
});
