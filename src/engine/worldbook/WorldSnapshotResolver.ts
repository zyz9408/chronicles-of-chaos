// ============================================================
// Engine - WorldSnapshotResolver
// 根据当前时间和世界书解析世界快照（当前该是什么局势）
// ============================================================

import type { WorldBook, TimelineAnchor } from '../types';
import { getWorldBookMapRoots } from '../map/runtimeMap';

/**
 * 获取当前日期相关的时代锚点
 */
export function resolveCurrentTimelineAnchors(
  worldBook: WorldBook,
  currentDate: string,
): TimelineAnchor[] {
  return worldBook.timelineAnchors.filter((anchor) => {
    // 简单的日期匹配：提取年份比较
    const anchorYear = extractYear(anchor.approximateDate);
    const currentYear = extractYear(currentDate);
    if (anchorYear === null || currentYear === null) return false;
    // 返回当前年份 ± 2 年内的锚点
    return Math.abs(anchorYear - currentYear) <= 2;
  });
}

/**
 * 获取指定时代锚点
 */
export function resolveTimelineAnchorById(
  worldBook: WorldBook,
  anchorId: string,
): TimelineAnchor | undefined {
  return worldBook.timelineAnchors.find((a) => a.id === anchorId);
}

/**
 * 获取当前世界快照摘要
 */
export function generateWorldSnapshot(
  worldBook: WorldBook,
  currentDate: string,
  currentLocationId: string,
): {
  timelineAnchors: TimelineAnchor[];
  currentRegionSummary: string;
  worldSummary: string;
} {
  const timelineAnchors = resolveCurrentTimelineAnchors(worldBook, currentDate);

  const locationNode = findMapNode(worldBook, currentLocationId);
  const currentRegionSummary = locationNode?.summary ?? '未知地点';

  const anchorSummaries = timelineAnchors
    .map((a) => `【${a.label}】${a.summary}`)
    .join('\n');

  const worldSummary = `
当前时代背景：
${anchorSummaries || '暂无特定时代锚点信息。'}

当前所在：${currentRegionSummary}
`.trim();

  return { timelineAnchors, currentRegionSummary, worldSummary };
}

/** 在地图种子中查找节点 */
function findMapNode(
  worldBook: WorldBook,
  nodeId: string,
  nodes?: typeof worldBook.mapSeed,
): typeof worldBook.mapSeed[number] | undefined {
  const searchNodes = nodes ?? getWorldBookMapRoots(worldBook);
  for (const node of searchNodes) {
    if (node.id === nodeId) return node;
    if (node.subLocations) {
      const found = findMapNode(worldBook, nodeId, node.subLocations);
      if (found) return found;
    }
  }
  return undefined;
}

/** 获取所有地图节点 ID（扁平化） */
export function getAllMapNodeIds(worldBook: WorldBook): string[] {
  const ids: string[] = [];
  function collect(nodes: typeof worldBook.mapSeed) {
    for (const node of nodes) {
      ids.push(node.id);
      if (node.subLocations) collect(node.subLocations);
    }
  }
  collect(getWorldBookMapRoots(worldBook));
  return ids;
}

/** 检查节点 ID 是否存在于世界书地图中 */
export function isMapNodeValid(worldBook: WorldBook, nodeId: string): boolean {
  return getAllMapNodeIds(worldBook).includes(nodeId);
}

/** 从日期字符串中提取年份 */
function extractYear(dateStr: string): number | null {
  const match = dateStr.match(/(\d+)/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}
