import type { CharacterEquipmentItem, EquipmentSlot, InventoryItem } from '../types';
import { normalizeEquipmentQualityTier } from '../equipment/EquipmentQuality';

export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ['weapon', 'armor', 'mount', 'treasure'];

// The narrator boundary must retain invalid candidates so command validation can report them.
export function preserveEquipmentCandidate(value: unknown): CharacterEquipmentItem[] | undefined {
  return value === undefined ? undefined : value as CharacterEquipmentItem[];
}

export function preserveInventoryCandidate(value: unknown): InventoryItem[] | undefined {
  return value === undefined ? undefined : value as InventoryItem[];
}

export function cloneEquipmentItem(item: CharacterEquipmentItem): CharacterEquipmentItem {
  return {
    ...item,
    ...(item.statBonuses ? { statBonuses: { ...item.statBonuses } } : {}),
    ...(item.checkHooks ? { checkHooks: item.checkHooks.map((hook) => ({ ...hook })) } : {}),
    ...(item.unlocks ? { unlocks: [...item.unlocks] } : {}),
    ...(item.risks ? { risks: [...item.risks] } : {}),
  };
}

export function cloneInventoryItem(item: InventoryItem): InventoryItem {
  return {
    ...item,
    ...(item.statBonuses ? { statBonuses: { ...item.statBonuses } } : {}),
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

export function validateEquipmentItem(
  value: unknown,
  index: number,
  errors: string[],
  fieldPrefix = 'updatePlayerLoadout.equipment',
): void {
  validateEquipmentItemAtPath(value, `${fieldPrefix}[${index}]`, errors);
}

export function validateEquipmentItemAtPath(value: unknown, fieldName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${fieldName} 必须是对象。`);
    return;
  }

  validateRequiredString(value.id, `${fieldName}.id`, errors);
  validateRequiredString(value.name, `${fieldName}.name`, errors);
  validateRequiredString(value.description, `${fieldName}.description`, errors);
  if (!EQUIPMENT_SLOTS.includes(value.slot as EquipmentSlot)) {
    errors.push(`${fieldName}.slot 非法：${String(value.slot)}`);
  }
  validateRequiredString(value.quality, `${fieldName}.quality`, errors);
  if (typeof value.quality === 'string' && !normalizeEquipmentQualityTier(value.quality)) {
    errors.push(`${fieldName}.quality 必须是 white/green/blue/purple/orange/red（普通/良好/精良/珍贵/传说/绝世），不得使用御赐、国宝、家传等来源标签。`);
  }
  validateOptionalLoadoutFields(value, fieldName, errors);
}

export function validateInventoryItem(
  value: unknown,
  index: number,
  errors: string[],
  fieldPrefix = 'updatePlayerLoadout.inventory',
): void {
  validateInventoryItemAtPath(value, `${fieldPrefix}[${index}]`, errors);
}

export function validateInventoryItemAtPath(value: unknown, fieldName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${fieldName} 必须是对象。`);
    return;
  }

  validateRequiredString(value.id, `${fieldName}.id`, errors);
  validateRequiredString(value.name, `${fieldName}.name`, errors);
  if (typeof value.quantity !== 'number' || !Number.isFinite(value.quantity) || value.quantity <= 0) {
    errors.push(`${fieldName}.quantity 必须是大于 0 的数字。`);
  }
  validateOptionalString(value.description, `${fieldName}.description`, errors);
  validateOptionalString(value.category, `${fieldName}.category`, errors);
  validateOptionalString(value.quality, `${fieldName}.quality`, errors);
  if (value.quality !== undefined && typeof value.quality === 'string' && !normalizeEquipmentQualityTier(value.quality)) {
    errors.push(`${fieldName}.quality 必须是 white/green/blue/purple/orange/red（普通/良好/精良/珍贵/传说/绝世），不得使用御赐、国宝、家传等来源标签。`);
  }
  if (value.equipSlot !== undefined && !EQUIPMENT_SLOTS.includes(value.equipSlot as EquipmentSlot)) {
    errors.push(`${fieldName}.equipSlot 非法：${String(value.equipSlot)}`);
  }
  if (value.keyItem !== undefined && typeof value.keyItem !== 'boolean') {
    errors.push(`${fieldName}.keyItem 必须是布尔值。`);
  }
  validateOptionalLoadoutFields(value, fieldName, errors);
}

export function validateEquipmentCollection(
  value: unknown[],
  fieldPrefix: string,
  errors: string[],
): void {
  const seenIds = new Map<string, number>();
  const slotCounts = new Map<EquipmentSlot, number>();

  value.forEach((item, index) => {
    if (!isRecord(item)) return;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (id) {
      const firstIndex = seenIds.get(id);
      if (firstIndex !== undefined) {
        errors.push(`${fieldPrefix}[${index}].id 与 ${fieldPrefix}[${firstIndex}].id 重复：${id}`);
      } else {
        seenIds.set(id, index);
      }
    }

    if (!EQUIPMENT_SLOTS.includes(item.slot as EquipmentSlot)) return;
    const slot = item.slot as EquipmentSlot;
    slotCounts.set(slot, (slotCounts.get(slot) ?? 0) + 1);
  });

  for (const slot of EQUIPMENT_SLOTS) {
    const count = slotCounts.get(slot) ?? 0;
    const limit = slot === 'treasure' ? 3 : 1;
    if (count > limit) {
      errors.push(`${fieldPrefix} 的 ${slot} 槽位最多只能有 ${limit} 件装备，收到 ${count} 件。`);
    }
  }
}

export function validateInventoryCollection(
  value: unknown[],
  fieldPrefix: string,
  errors: string[],
): void {
  const seenIds = new Map<string, number>();
  value.forEach((item, index) => {
    if (!isRecord(item)) return;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id) return;
    const firstIndex = seenIds.get(id);
    if (firstIndex !== undefined) {
      errors.push(`${fieldPrefix}[${index}].id 与 ${fieldPrefix}[${firstIndex}].id 重复：${id}`);
    } else {
      seenIds.set(id, index);
    }
  });
}

export function validateLinkedLoadoutIdentities(
  equipment: unknown[],
  inventory: unknown[],
  equipmentPrefix: string,
  inventoryPrefix: string,
  errors: string[],
): void {
  const equipmentById = new Map<string, Record<string, unknown>>();
  for (const item of equipment) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (id && !equipmentById.has(id)) equipmentById.set(id, item);
  }

  inventory.forEach((item, index) => {
    if (!isRecord(item)) return;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const equipped = id ? equipmentById.get(id) : undefined;
    if (!equipped) return;

    const equipmentName = typeof equipped.name === 'string' ? equipped.name.trim() : '';
    const inventoryName = typeof item.name === 'string' ? item.name.trim() : '';
    const equipmentSlot = EQUIPMENT_SLOTS.includes(equipped.slot as EquipmentSlot)
      ? equipped.slot as EquipmentSlot
      : undefined;
    const inventorySlot = EQUIPMENT_SLOTS.includes(item.equipSlot as EquipmentSlot)
      ? item.equipSlot as EquipmentSlot
      : undefined;
    if (
      (equipmentName && inventoryName && equipmentName !== inventoryName)
      || (equipmentSlot && inventorySlot && equipmentSlot !== inventorySlot)
    ) {
      errors.push(
        `${inventoryPrefix}[${index}].id 与 ${equipmentPrefix} 复用了稳定 ID ${id}，但名称或装备槽不一致。`,
      );
    }
  });
}

export function validateCheckHooks(value: unknown, fieldName: string, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${fieldName} 必须是数组。`);
    return;
  }

  value.forEach((hook, index) => {
    const hookField = `${fieldName}[${index}]`;
    if (!isRecord(hook)) {
      errors.push(`${hookField} 必须是对象。`);
      return;
    }
    validateRequiredString(hook.scope, `${hookField}.scope`, errors);
    validateRequiredString(hook.note, `${hookField}.note`, errors);
    if (hook.modifier !== undefined && (typeof hook.modifier !== 'number' || !Number.isFinite(hook.modifier))) {
      errors.push(`${hookField}.modifier 必须是数字。`);
    }
  });
}

function validateOptionalLoadoutFields(value: Record<string, unknown>, fieldName: string, errors: string[]): void {
  validateOptionalString(value.condition, `${fieldName}.condition`, errors);
  validateOptionalString(value.promptHint, `${fieldName}.promptHint`, errors);
  validateOptionalString(value.updatedAt, `${fieldName}.updatedAt`, errors);

  if (value.statBonuses !== undefined) {
    if (!isRecord(value.statBonuses)) {
      errors.push(`${fieldName}.statBonuses 必须是对象。`);
    } else {
      Object.entries(value.statBonuses).forEach(([key, bonus]) => {
        if (!key.trim() || typeof bonus !== 'number' || !Number.isFinite(bonus)) {
          errors.push(`${fieldName}.statBonuses 必须是数字加成表。`);
        }
      });
    }
  }

  validateCheckHooks(value.checkHooks, `${fieldName}.checkHooks`, errors);
  validateStringList(value.unlocks, `${fieldName}.unlocks`, errors);
  validateStringList(value.risks, `${fieldName}.risks`, errors);
}

function validateRequiredString(value: unknown, fieldName: string, errors: string[]): void {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${fieldName} 不能为空。`);
  }
}

function validateOptionalString(value: unknown, fieldName: string, errors: string[]): void {
  if (value !== undefined && typeof value !== 'string') {
    errors.push(`${fieldName} 必须是字符串。`);
  }
}

function validateStringList(value: unknown, fieldName: string, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${fieldName} 必须是字符串数组。`);
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      errors.push(`${fieldName}[${index}] 必须是非空字符串。`);
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
