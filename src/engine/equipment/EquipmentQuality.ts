import type { ItemQualityTier } from '../encounterV2/EncounterContracts';

export const INTERNAL_EQUIPMENT_QUALITY_TIERS = new Set<ItemQualityTier>([
  'white',
  'green',
  'blue',
  'purple',
  'orange',
  'red',
]);

/**
 * Converts only canonical grades and unambiguous legacy colour labels into
 * the single internal tier used by writeback, backpack and combat. Provenance
 * labels such as "御赐" or "国宝" intentionally do not imply a grade.
 */
export function normalizeEquipmentQualityTier(value: unknown): ItemQualityTier | undefined {
  if (typeof value !== 'string') return undefined;
  const quality = value.trim();
  if (!quality) return undefined;
  const normalized = quality.toLocaleLowerCase();
  if (INTERNAL_EQUIPMENT_QUALITY_TIERS.has(normalized as ItemQualityTier)) {
    return normalized as ItemQualityTier;
  }
  const aliases: Record<string, ItemQualityTier> = {
    普通: 'white',
    普通级: 'white',
    白: 'white',
    白色: 'white',
    良好: 'green',
    良好级: 'green',
    绿: 'green',
    绿色: 'green',
    精良: 'blue',
    精良级: 'blue',
    蓝: 'blue',
    蓝色: 'blue',
    珍贵: 'purple',
    珍贵级: 'purple',
    紫: 'purple',
    紫色: 'purple',
    传说: 'orange',
    传说级: 'orange',
    橙: 'orange',
    橙色: 'orange',
    金: 'orange',
    金色: 'orange',
    gold: 'orange',
    绝世: 'red',
    绝世级: 'red',
    红: 'red',
    红色: 'red',
  };
  return aliases[normalized];
}
