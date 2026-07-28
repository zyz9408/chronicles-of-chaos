// ============================================================
// Engine Core Types - Faction (运行时)
// 注意：FactionSeed 在 map.ts 中定义，用于世界书数据
// ============================================================

/** 运行时势力 */
export interface Faction {
  id: string;
  name: string;
  factionType: string;
  summary: string;
  leaderId?: string;
  controlledRegionIds: string[];
  attitude: string;
}
