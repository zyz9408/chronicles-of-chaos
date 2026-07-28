import { describe, expect, it } from 'vitest';
import type { Actor } from '../types';
import { removePlayerItem } from './playerLoadout';

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
