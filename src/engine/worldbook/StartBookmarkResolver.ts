// ============================================================
// Engine - StartBookmarkResolver
// 解析开局书签相关数据
// ============================================================

import type { WorldBook, StartBookmark, TimelineAnchor } from '../types';

/**
 * 获取世界书的所有开局书签
 */
export function listStartBookmarks(worldBook: WorldBook): StartBookmark[] {
  return worldBook.startBookmarks;
}

/**
 * 获取指定开局书签
 */
export function getStartBookmark(
  worldBook: WorldBook,
  bookmarkId: string,
): StartBookmark | undefined {
  return worldBook.startBookmarks.find((b) => b.id === bookmarkId);
}

/**
 * 获取开局书签关联的时代锚点
 */
export function getBookmarkTimelineAnchors(
  worldBook: WorldBook,
  bookmark: StartBookmark,
): TimelineAnchor[] {
  return bookmark.relatedTimelineAnchorIds
    .map((id) => worldBook.timelineAnchors.find((a) => a.id === id))
    .filter((a): a is TimelineAnchor => a !== undefined);
}
