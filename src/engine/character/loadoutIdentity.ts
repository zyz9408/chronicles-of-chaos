import type {
  CharacterEquipmentItem,
  EquipmentSlot,
  InventoryItem,
} from '../types';
import {
  cloneEquipmentItem,
  cloneInventoryItem,
  equipmentItemToInventoryItem,
} from './loadoutProtocol';

export interface NormalizedLoadoutCollections {
  equipment: CharacterEquipmentItem[];
  inventory: InventoryItem[];
}

interface LoadoutOwner {
  equipment?: CharacterEquipmentItem[];
  inventory?: InventoryItem[];
}

const NON_TREASURE_SLOTS: readonly EquipmentSlot[] = ['weapon', 'armor', 'mount'];

/**
 * Returns the equipment that can actually occupy the six runtime slots.
 *
 * This is a structural projection only: it never merges by display name. The
 * first weapon/armor/mount and the first three distinct treasure records win.
 */
export function projectEquippedItems(equipment: CharacterEquipmentItem[]): CharacterEquipmentItem[] {
  const occupiedSlots = new Set<EquipmentSlot>();
  const seenTreasureIdentities = new Set<string>();
  let treasureCount = 0;
  const projected: CharacterEquipmentItem[] = [];

  for (const item of equipment) {
    if (item.slot === 'treasure') {
      const identity = equipmentSemanticKey(item);
      if (treasureCount >= 3 || seenTreasureIdentities.has(identity)) continue;
      seenTreasureIdentities.add(identity);
      treasureCount += 1;
      projected.push(item);
      continue;
    }

    if (!NON_TREASURE_SLOTS.includes(item.slot) || occupiedSlots.has(item.slot)) continue;
    occupiedSlots.add(item.slot);
    projected.push(item);
  }

  return projected;
}

/**
 * Repairs legacy duplicate IDs and illegal slot overflow without using names as
 * an entity merge key. Stable IDs remain primary; name + slot only distinguish
 * records that already share an invalid duplicate ID.
 *
 * Extra equipment is preserved as carried inventory rather than discarded.
 */
export function normalizeLoadoutCollections(
  equipment: CharacterEquipmentItem[] | undefined,
  inventory: InventoryItem[] | undefined,
): NormalizedLoadoutCollections {
  const rawEquipment = (equipment ?? []).map(cloneEquipmentItem);
  const rawInventory = (inventory ?? []).map(cloneInventoryItem);
  const retainedEquipment: CharacterEquipmentItem[] = [];
  const displacedEquipment: CharacterEquipmentItem[] = [];
  const occupiedSlots = new Set<EquipmentSlot>();
  const seenEquipmentIdentities = new Set<string>();
  let treasureCount = 0;

  for (const item of rawEquipment) {
    const identity = equipmentSemanticKey(item);
    if (seenEquipmentIdentities.has(identity)) continue;
    seenEquipmentIdentities.add(identity);

    if (item.slot === 'treasure') {
      if (treasureCount >= 3) {
        displacedEquipment.push(item);
        continue;
      }
      treasureCount += 1;
      retainedEquipment.push(item);
      continue;
    }

    if (occupiedSlots.has(item.slot)) {
      displacedEquipment.push(item);
      continue;
    }
    occupiedSlots.add(item.slot);
    retainedEquipment.push(item);
  }

  const preferredKeyByBaseId = new Map<string, string>();
  for (const item of retainedEquipment) {
    const baseId = normalizeBaseId(item.id);
    if (!preferredKeyByBaseId.has(baseId)) {
      preferredKeyByBaseId.set(baseId, equipmentSemanticKey(item));
    }
  }
  for (const item of rawInventory) {
    const baseId = normalizeBaseId(item.id);
    if (!preferredKeyByBaseId.has(baseId)) {
      preferredKeyByBaseId.set(baseId, inventorySemanticKey(item));
    }
  }
  for (const item of displacedEquipment) {
    const baseId = normalizeBaseId(item.id);
    if (!preferredKeyByBaseId.has(baseId)) {
      preferredKeyByBaseId.set(baseId, equipmentSemanticKey(item));
    }
  }

  const resolvedIds = new Map<string, string>();
  const usedIds = new Set<string>();
  const resolveId = (baseIdValue: string, semanticKey: string): string => {
    const baseId = normalizeBaseId(baseIdValue);
    const mapKey = `${baseId}\u0000${semanticKey}`;
    const existing = resolvedIds.get(mapKey);
    if (existing) return existing;

    const preferredKey = preferredKeyByBaseId.get(baseId);
    let candidate = preferredKey === semanticKey && !usedIds.has(baseId)
      ? baseId
      : `${baseId}__recovered_${stableIdentityHash(semanticKey)}`;
    let suffix = 2;
    while (usedIds.has(candidate)) {
      candidate = `${baseId}__recovered_${stableIdentityHash(semanticKey)}_${suffix}`;
      suffix += 1;
    }
    resolvedIds.set(mapKey, candidate);
    usedIds.add(candidate);
    return candidate;
  };

  const normalizedEquipment = retainedEquipment.map((item) => ({
    ...cloneEquipmentItem(item),
    id: resolveId(item.id, equipmentSemanticKey(item)),
  }));

  const normalizedInventory: InventoryItem[] = [];
  const inventoryIndexByResolvedId = new Map<string, number>();
  for (const item of rawInventory) {
    const resolvedId = resolveId(item.id, inventorySemanticKey(item));
    const existingIndex = inventoryIndexByResolvedId.get(resolvedId);
    if (existingIndex !== undefined) {
      const existing = normalizedInventory[existingIndex];
      normalizedInventory[existingIndex] = {
        ...existing,
        quantity: Math.max(
          Math.max(1, Math.floor(existing.quantity)),
          Math.max(1, Math.floor(item.quantity)),
        ),
      };
      continue;
    }
    inventoryIndexByResolvedId.set(resolvedId, normalizedInventory.length);
    normalizedInventory.push({
      ...cloneInventoryItem(item),
      id: resolvedId,
      quantity: Math.max(1, Math.floor(item.quantity)),
    });
  }

  for (const item of displacedEquipment) {
    const carried = equipmentItemToInventoryItem(item);
    const resolvedId = resolveId(item.id, equipmentSemanticKey(item));
    if (inventoryIndexByResolvedId.has(resolvedId)) continue;
    inventoryIndexByResolvedId.set(resolvedId, normalizedInventory.length);
    normalizedInventory.push({ ...carried, id: resolvedId });
  }

  return {
    equipment: normalizedEquipment,
    inventory: normalizedInventory,
  };
}

export function normalizeLoadoutOwner<T extends LoadoutOwner>(owner: T): T {
  if (!owner.equipment && !owner.inventory) return owner;
  const normalized = normalizeLoadoutCollections(owner.equipment, owner.inventory);
  return {
    ...owner,
    equipment: normalized.equipment,
    inventory: normalized.inventory,
  };
}

function equipmentSemanticKey(item: CharacterEquipmentItem): string {
  return [
    normalizeBaseId(item.id),
    item.slot,
    item.name.trim(),
  ].join('\u0000');
}

function inventorySemanticKey(item: InventoryItem): string {
  return [
    normalizeBaseId(item.id),
    item.equipSlot ?? '',
    item.name.trim(),
  ].join('\u0000');
}

function normalizeBaseId(id: string): string {
  const normalized = typeof id === 'string' ? id.trim() : '';
  return normalized || 'item_recovered';
}

function stableIdentityHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
