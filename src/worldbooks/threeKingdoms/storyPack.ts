import type { WorldlineStoryPack } from '../../engine/types';
import { THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS } from './storyPackBatch1Content';
import { THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS } from './storyPackBatch2Content';
import { THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS } from './storyPackBatch3Content';
import { THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS } from './storyPackBatch4Content';
import { THREE_KINGDOMS_GENERIC_STORY_PACK_ID } from './storyPackConstants';

export { THREE_KINGDOMS_GENERIC_STORY_PACK_ID } from './storyPackConstants';

/**
 * Batch 1—4 共 1500 条通用素材。
 * 这些线程只提供候选压力和调查入口，不宣称剧情事实已经发生。
 */
export const threeKingdomsGenericStoryPack: WorldlineStoryPack = {
  id: THREE_KINGDOMS_GENERIC_STORY_PACK_ID,
  worldBookId: 'threeKingdoms',
  name: '三国通用情境与戏剧素材',
  version: '0.5.0',
  description: '覆盖三国军政民生日常，强化晚期世代交接、季节地域差异、非战争生活与结构化结果余波的通用剧情候选。',
  threads: [
    ...THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS,
    ...THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS,
    ...THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS,
    ...THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS,
  ],
};
