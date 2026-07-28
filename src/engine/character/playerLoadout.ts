import type { Actor, CharacterEquipmentItem, EquipmentSlot, InventoryItem } from '../types';
import { cloneEquipmentItem, cloneInventoryItem } from './loadoutProtocol';

export interface EquipFromInventoryOptions {
  slot?: EquipmentSlot;
  treasureIndex?: number;
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

export function equipmentItemToInventoryItem(item: CharacterEquipmentItem): InventoryItem {
  return {
    id: item.id,
    name: item.name,
    quantity: 1,
    category: 'equipment',
    equipSlot: item.slot,
    quality: item.quality,
    description: item.description,
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

  const currentEquipment = player.equipment ?? [];
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
