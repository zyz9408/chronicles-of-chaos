// ============================================================
// Engine - WorldBookLoader
// 负责加载和管理世界书
// ============================================================

import type { WorldBook, WorldBookManifest } from '../types';
import {
  threeKingdomsGenericStoryPack,
  threeKingdomsKnowledgeBase,
  worldBook_ThreeKingdoms,
} from '../../worldbooks/threeKingdoms';
import {
  registerWorldlineKnowledgeBase,
  registerWorldlineStoryPack,
} from '../worldline/WorldlineKnowledgeRegistry';

/** 已注册的世界书注册表 */
const worldBookRegistry: Map<string, WorldBook> = new Map();
const officialWorldBooks: ReadonlyMap<string, WorldBook> = new Map([
  [worldBook_ThreeKingdoms.manifest.id, worldBook_ThreeKingdoms],
]);

function getAvailableWorldBooks(): WorldBook[] {
  const available = new Map(worldBookRegistry);
  for (const [id, worldBook] of officialWorldBooks) available.set(id, worldBook);
  return [...available.values()];
}

/** 初始化：注册官方世界书 */
export function initWorldBookRegistry(): void {
  registerWorldBook(worldBook_ThreeKingdoms);
  registerWorldlineKnowledgeBase(threeKingdomsKnowledgeBase);
  registerWorldlineStoryPack(threeKingdomsGenericStoryPack);
}

/** 注册一个世界书 */
export function registerWorldBook(worldBook: WorldBook): void {
  const official = officialWorldBooks.get(worldBook.manifest.id);
  if (official) {
    if (official === worldBook) return;
    throw new Error(`世界书 ID 与官方定义冲突：${worldBook.manifest.id}`);
  }
  worldBookRegistry.set(worldBook.manifest.id, worldBook);
}

/** 获取所有已注册世界书的清单 */
export function listWorldBooks(): WorldBookManifest[] {
  return getAvailableWorldBooks().map((wb) => wb.manifest);
}

/** 获取指定世界书 */
export function getWorldBook(id: string): WorldBook | undefined {
  return officialWorldBooks.get(id) ?? worldBookRegistry.get(id);
}

/** 获取官方世界书列表 */
export function listOfficialWorldBooks(): WorldBookManifest[] {
  return getAvailableWorldBooks()
    .filter((wb) => wb.manifest.source === 'official')
    .map((wb) => wb.manifest);
}

/** 获取自定义世界书列表 */
export function listCustomWorldBooks(): WorldBookManifest[] {
  return getAvailableWorldBooks()
    .filter((wb) => wb.manifest.source === 'custom')
    .map((wb) => wb.manifest);
}
