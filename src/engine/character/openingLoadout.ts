import type { CharacterEquipmentItem, InventoryItem } from '../types';

export interface OpeningLoadout {
  personalMoney: number;
  equipment: CharacterEquipmentItem[];
  inventory: InventoryItem[];
  summary: string;
}

export function createPendingOpeningLoadout(): OpeningLoadout {
  return {
    personalMoney: 0,
    equipment: [],
    inventory: [],
    summary: '初始行装将根据时代背景、主角出身、当前身份、地点与开局额外要求，随开场剧情一并确定。',
  };
}
