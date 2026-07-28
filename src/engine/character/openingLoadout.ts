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
    summary: '初始行装待真开局 AI 根据世界书、时代书签、主角出身、当前身份、地点与开局额外要求生成并结构化写回。',
  };
}