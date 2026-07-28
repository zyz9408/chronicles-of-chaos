import { formatCurrency } from '../engine/character/currency';
import type { Actor, CharacterEquipmentItem, EquipmentSlot, InventoryItem } from '../engine/types';
import { formatEquipmentQualityLabel } from './gameTooltipText';

export type BackpackCategoryKey = 'all' | 'equipment' | 'document' | 'supply' | 'misc';
export type BackpackQualityTone = 'white' | 'green' | 'blue' | 'red' | 'gold';

export interface BackpackCategory {
  key: BackpackCategoryKey;
  label: string;
  count: number;
}

export interface BackpackSummaryRow {
  label: string;
  value: string;
}

export interface BackpackEquipmentSlotModel {
  slot: EquipmentSlot;
  label: string;
  item?: CharacterEquipmentItem;
  treasureIndex?: number;
}

export interface BackpackItemModel {
  id: string;
  name: string;
  quantity: number;
  description?: string;
  iconLabel: string;
  detailTitle: string;
  categoryKey: BackpackCategoryKey;
  categoryLabel: string;
  qualityLabel?: string;
  qualityTone: BackpackQualityTone;
  isKeyItem: boolean;
  canEquip: boolean;
  equipSlot?: EquipmentSlot;
  isEquipped: boolean;
  equippedSlotLabel?: string;
}

export interface BackpackPanelModel {
  moneyText: string;
  summaryRows: BackpackSummaryRow[];
  equipmentSlots: BackpackEquipmentSlotModel[];
  categories: BackpackCategory[];
  items: BackpackItemModel[];
  getItemsByCategory: (categoryKey: BackpackCategoryKey) => BackpackItemModel[];
  getEquipCandidates: (slot: EquipmentSlot) => BackpackItemModel[];
}

const categoryLabels: Record<BackpackCategoryKey, string> = {
  all: '全部',
  equipment: '装备',
  document: '凭证',
  supply: '补给',
  misc: '杂物',
};

const slotLabels: Record<EquipmentSlot, string> = {
  weapon: '武器',
  armor: '防具',
  mount: '坐骑',
  treasure: '宝物',
};

export function buildBackpackPanelModel(player: Actor): BackpackPanelModel {
  const equipmentSlots = buildBackpackEquipmentSlots(player.equipment ?? []);
  const equippedById = new Map((player.equipment ?? []).map((item) => [item.id, item]));
  const inventoryIds = new Set((player.inventory ?? []).map((item) => item.id));
  const inventoryItems = (player.inventory ?? []).map((item) => buildBackpackItemModel(item, equippedById.get(item.id)));
  const equippedOnlyItems = (player.equipment ?? [])
    .filter((item) => !inventoryIds.has(item.id))
    .map((item) => buildBackpackItemModel(equipmentItemToInventoryItem(item), item));
  const items = [...inventoryItems, ...equippedOnlyItems];
  const categories = (Object.keys(categoryLabels) as BackpackCategoryKey[]).map((key) => ({
    key,
    label: categoryLabels[key],
    count: key === 'all' ? items.length : items.filter((item) => item.categoryKey === key).length,
  }));
  const equippedCount = equipmentSlots.filter((slot) => Boolean(slot.item)).length;
  const keyItemCount = inventoryItems.filter((item) => item.isKeyItem).length;
  const moneyText = formatCurrency(player.personalMoney ?? 0);

  return {
    moneyText,
    summaryRows: [
      { label: '钱财', value: moneyText },
      { label: '已装备', value: `${equippedCount}/${equipmentSlots.length}` },
      { label: '背包物品', value: `${inventoryItems.length}类` },
      { label: '关键物品', value: `${keyItemCount}件` },
    ],
    equipmentSlots,
    categories,
    items,
    getItemsByCategory: (categoryKey) =>
      categoryKey === 'all' ? items : items.filter((item) => item.categoryKey === categoryKey),
    getEquipCandidates: (slot) => items.filter((item) => item.canEquip && item.equipSlot === slot && !item.isEquipped),
  };
}

function buildBackpackEquipmentSlots(equipment: CharacterEquipmentItem[]): BackpackEquipmentSlotModel[] {
  const treasures = equipment.filter((item) => item.slot === 'treasure').slice(0, 3);
  return [
    { slot: 'weapon', label: slotLabels.weapon, item: equipment.find((item) => item.slot === 'weapon') },
    { slot: 'armor', label: slotLabels.armor, item: equipment.find((item) => item.slot === 'armor') },
    { slot: 'mount', label: slotLabels.mount, item: equipment.find((item) => item.slot === 'mount') },
    { slot: 'treasure', label: '宝物一', item: treasures[0], treasureIndex: 0 },
    { slot: 'treasure', label: '宝物二', item: treasures[1], treasureIndex: 1 },
    { slot: 'treasure', label: '宝物三', item: treasures[2], treasureIndex: 2 },
  ];
}

function buildBackpackItemModel(item: InventoryItem, equippedItem?: CharacterEquipmentItem): BackpackItemModel {
  const categoryKey = resolveCategoryKey(item);
  const categoryLabel = categoryLabels[categoryKey];
  const equippedSlotLabel = equippedItem
    ? equippedItem.slot === 'treasure'
      ? '宝物'
      : slotLabels[equippedItem.slot]
    : undefined;
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    description: item.description,
    iconLabel: resolveIconLabel(item, categoryKey),
    detailTitle: buildDetailTitle(item, categoryLabel),
    categoryKey,
    categoryLabel,
    qualityLabel: formatEquipmentQualityLabel(item.quality) || undefined,
    qualityTone: resolveQualityTone(item.quality),
    isKeyItem: Boolean(item.keyItem),
    canEquip: Boolean(item.equipSlot),
    equipSlot: item.equipSlot,
    isEquipped: Boolean(equippedItem),
    equippedSlotLabel,
  };
}

function equipmentItemToInventoryItem(item: CharacterEquipmentItem): InventoryItem {
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

function resolveCategoryKey(item: InventoryItem): BackpackCategoryKey {
  if (item.equipSlot || item.category === 'equipment') return 'equipment';
  if (item.category === 'document' || item.category === 'token') return 'document';
  if (item.category === 'consumable' || item.category === 'supply' || item.category === 'material') return 'supply';
  return 'misc';
}

function resolveIconLabel(item: InventoryItem, categoryKey: BackpackCategoryKey): string {
  if (item.equipSlot === 'weapon') return '刃';
  if (item.equipSlot === 'armor') return '甲';
  if (item.equipSlot === 'mount') return '马';
  if (item.equipSlot === 'treasure') return '佩';
  if (categoryKey === 'document') return '令';
  if (categoryKey === 'supply') {
    return /药|丹|散|膏|丸/.test(`${item.name}${item.description ?? ''}`) ? '药' : '粮';
  }
  return '物';
}

function buildDetailTitle(item: InventoryItem, categoryLabel: string): string {
  const nameLine = `${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ''}`;
  return [
    nameLine,
    formatEquipmentQualityLabel(item.quality) || categoryLabel,
    item.description,
  ].filter((line): line is string => Boolean(line?.trim())).join('\n');
}

function resolveQualityTone(quality?: string): BackpackQualityTone {
  if (!quality) return 'white';
  const normalized = quality.trim().toLocaleLowerCase();
  if (normalized === 'white' || normalized === 'green' || normalized === 'blue' || normalized === 'red' || normalized === 'gold') {
    return normalized;
  }
  if (/传奇|传说|无双|御赐|国宝|神器|神兵/.test(quality)) return 'gold';
  if (/名品|绝品|稀世|珍品|军府|信物|家传|宝/.test(quality)) return 'red';
  if (/精良|精造|上品|百炼|名匠/.test(quality)) return 'blue';
  if (/良|制式|普通/.test(quality)) return 'green';
  if (/破|劣|残/.test(quality)) return 'white';
  return 'white';
}
