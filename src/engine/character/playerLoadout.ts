import type { Actor, CharacterEquipmentItem, EquipmentSlot, InventoryItem } from '../types';
import { projectEquippedItems } from './loadoutIdentity';
import {
  cloneEquipmentItem,
  cloneInventoryItem,
  equipmentItemToInventoryItem,
} from './loadoutProtocol';

export { equipmentItemToInventoryItem } from './loadoutProtocol';

export interface EquipFromInventoryOptions {
  slot?: EquipmentSlot;
  treasureIndex?: number;
}

export interface UnequipInventoryItemOptions {
  slot?: EquipmentSlot;
  treasureIndex?: number;
  itemName?: string;
}

export function inventoryItemToEquipmentItem(item: InventoryItem, slot?: EquipmentSlot): CharacterEquipmentItem | null {
  const equipSlot = slot ?? item.equipSlot;
  if (!equipSlot) return null;
  return {
    id: item.id,
    slot: equipSlot,
    name: item.name,
    quality: item.quality?.trim() ? item.quality : '普通',
    description: item.description?.trim() ? item.description : item.name,
    ...(item.condition ? { condition: item.condition } : {}),
    ...(item.statBonuses ? { statBonuses: { ...item.statBonuses } } : {}),
    ...(item.promptHint ? { promptHint: item.promptHint } : {}),
    ...(item.checkHooks ? { checkHooks: item.checkHooks.map((hook) => ({ ...hook })) } : {}),
    ...(item.unlocks ? { unlocks: [...item.unlocks] } : {}),
    ...(item.risks ? { risks: [...item.risks] } : {}),
  };
}

export function upsertInventoryItem(inventory: InventoryItem[], item: InventoryItem): InventoryItem[] {
  const index = inventory.findIndex((existing) => existing.id === item.id);
  if (index < 0) return [...inventory.map(cloneInventoryItem), cloneInventoryItem(item)];
  return inventory.map((existing, existingIndex) =>
    existingIndex === index
      ? {
          ...cloneInventoryItem(existing),
          ...cloneInventoryItem(item),
          quantity: Math.max(1, Math.floor(item.quantity)),
        }
      : cloneInventoryItem(existing),
  );
}

function normalizeTreasureIndex(index: number | undefined, treasures: CharacterEquipmentItem[]): number {
  if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < 3) return index;
  const firstEmpty = [0, 1, 2].find((candidate) => !treasures[candidate]);
  return firstEmpty ?? 0;
}

export function equipInventoryItem(
  player: Actor,
  itemId: string,
  options: EquipFromInventoryOptions = {},
): Actor {
  const source = player.inventory?.find((item) => item.id === itemId);
  if (!source) return player;
  const nextEquipmentItem = inventoryItemToEquipmentItem(source, options.slot);
  if (!nextEquipmentItem) return player;

  // Manual equipment must use the same six-slot projection as the UI. Legacy
  // saves can contain hidden duplicate records that the panel correctly omits;
  // counting those raw records would make visible treasure slots look empty
  // while the equip action keeps replacing the first treasure.
  const currentEquipment = projectEquippedItems(player.equipment ?? []);
  let nextEquipment: CharacterEquipmentItem[];

  if (nextEquipmentItem.slot === 'treasure') {
    const nonTreasures = currentEquipment.filter((item) => item.slot !== 'treasure').map(cloneEquipmentItem);
    const treasures = currentEquipment.filter((item) => item.slot === 'treasure').slice(0, 3).map(cloneEquipmentItem);
    const targetIndex = normalizeTreasureIndex(options.treasureIndex, treasures);
    const nextTreasures = [0, 1, 2]
      .map((index) => (index === targetIndex ? nextEquipmentItem : treasures[index]))
      .filter((item): item is CharacterEquipmentItem => Boolean(item));
    nextEquipment = [...nonTreasures, ...nextTreasures];
  } else {
    nextEquipment = [
      ...currentEquipment.filter((item) => item.slot !== nextEquipmentItem.slot).map(cloneEquipmentItem),
      nextEquipmentItem,
    ];
  }

  return {
    ...player,
    equipment: nextEquipment,
    inventory: (player.inventory ?? []).map(cloneInventoryItem),
  };
}

/**
 * Clears one equipped item while retaining it in carried inventory.
 *
 * `treasureIndex` addresses one of the three projected treasure slots. The
 * optional name disambiguates legacy saves that reused one ID for different
 * equipment records. Equipment-only legacy records are restored to inventory
 * before the slot is cleared, so manual unequip never makes an item disappear.
 */
export function unequipInventoryItem(
  player: Actor,
  itemId: string,
  options: UnequipInventoryItemOptions = {},
): Actor {
  const normalizedItemId = itemId.trim();
  if (!normalizedItemId) return player;

  const currentEquipment = projectEquippedItems(player.equipment ?? []);
  let targetIndex = -1;

  if (
    options.slot === 'treasure'
    && typeof options.treasureIndex === 'number'
    && Number.isInteger(options.treasureIndex)
    && options.treasureIndex >= 0
    && options.treasureIndex < 3
  ) {
    const treasureIndexes = currentEquipment
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.slot === 'treasure');
    const indexedTarget = treasureIndexes[options.treasureIndex];
    if (
      indexedTarget
      && indexedTarget.item.id === normalizedItemId
      && (!options.itemName || indexedTarget.item.name === options.itemName)
    ) {
      targetIndex = indexedTarget.index;
    }
  }

  if (targetIndex < 0) {
    targetIndex = currentEquipment.findIndex((item) => (
      item.id === normalizedItemId
      && (!options.slot || item.slot === options.slot)
      && (!options.itemName || item.name === options.itemName)
    ));
  }
  if (targetIndex < 0) return player;

  const target = currentEquipment[targetIndex];
  const inventory = (player.inventory ?? []).map(cloneInventoryItem);
  const alreadyInInventory = inventory.some((item) => (
    item.id === target.id
    && item.name === target.name
    && (!item.equipSlot || item.equipSlot === target.slot)
  ));
  if (!alreadyInInventory) {
    inventory.push(equipmentItemToInventoryItem(target));
  }

  return {
    ...player,
    equipment: currentEquipment
      .filter((_item, index) => index !== targetIndex)
      .map(cloneEquipmentItem),
    inventory,
  };
}

/**
 * Removes one logical item from the player's loadout truth.
 *
 * The backpack and equipment panel may both reference the same stable item ID.
 * Manual removal therefore clears the whole inventory stack and every matching
 * equipment entry together, preventing an item from surviving as ghost gear.
 */
export function removePlayerItem(player: Actor, itemId: string): Actor {
  const normalizedItemId = itemId.trim();
  if (!normalizedItemId) return player;

  const inventory = player.inventory ?? [];
  const equipment = player.equipment ?? [];
  const hasInventoryItem = inventory.some((item) => item.id === normalizedItemId);
  const hasEquipmentItem = equipment.some((item) => item.id === normalizedItemId);
  if (!hasInventoryItem && !hasEquipmentItem) return player;

  return {
    ...player,
    inventory: inventory
      .filter((item) => item.id !== normalizedItemId)
      .map(cloneInventoryItem),
    equipment: equipment
      .filter((item) => item.id !== normalizedItemId)
      .map(cloneEquipmentItem),
  };
}
