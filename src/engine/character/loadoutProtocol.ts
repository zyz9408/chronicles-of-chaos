import type { CharacterEquipmentItem, EquipmentSlot, InventoryItem } from '../types';

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
  if (value.equipSlot !== undefined && !EQUIPMENT_SLOTS.includes(value.equipSlot as EquipmentSlot)) {
    errors.push(`${fieldName}.equipSlot 非法：${String(value.equipSlot)}`);
  }
  if (value.keyItem !== undefined && typeof value.keyItem !== 'boolean') {
    errors.push(`${fieldName}.keyItem 必须是布尔值。`);
  }
  validateOptionalLoadoutFields(value, fieldName, errors);
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
