// ============================================================
// Engine - OpeningCrisisResolver
// 根据书签、地区、身份筛选开局危机
// ============================================================

import type { WorldBook, OpeningCrisisTemplate } from '../types';

/**
 * 筛选适用开局危机
 */
export function resolveOpeningCrises(
  worldBook: WorldBook,
  bookmarkId: string,
  regionId: string,
  origin: string,
): OpeningCrisisTemplate[] {
  const crises = worldBook.openingCrisisTemplates.filter((crisis) => {
    const bookmarkMatch =
      crisis.applicableBookmarkIds.length === 0 ||
      crisis.applicableBookmarkIds.includes(bookmarkId);

    const regionMatch =
      crisis.applicableRegionIds.length === 0 ||
      crisis.applicableRegionIds.includes(regionId);

    const originMatch =
      crisis.applicableOrigins.length === 0 ||
      crisis.applicableOrigins.includes(origin);

    return bookmarkMatch && regionMatch && originMatch;
  });

  return crises;
}

/**
 * 通用危机（当没有匹配危机时使用）
 */
export const genericCrisis: OpeningCrisisTemplate = {
  id: 'crisis_generic',
  label: '乱世之始',
  applicableBookmarkIds: [],
  applicableRegionIds: [],
  applicableOrigins: [],
  crisisSummary: '身处乱世之中，每一天都充满变数。你需要为自己找到前路。',
  firstSceneHint: '晨光初现，你站在门前，看着这个熟悉又陌生的世界。今天，又会发生什么？',
  riskLevel: 'medium',
};

/**
 * 获取危机模板
 */
export function getCrisisTemplate(
  worldBook: WorldBook,
  crisisId: string,
): OpeningCrisisTemplate | undefined {
  return worldBook.openingCrisisTemplates.find((c) => c.id === crisisId);
}

/**
 * 获取所有危机模板
 */
export function getAllCrisisTemplates(
  worldBook: WorldBook,
): OpeningCrisisTemplate[] {
  return worldBook.openingCrisisTemplates;
}
