import type { FactionSeed } from '../../engine/types';

/**
 * 三国当前势力不由世界书静态种子预填。
 *
 * 真开局 LLM 应根据开局时间、玩家身份、玩家地点、start bookmark、
 * KnowledgeBase / StoryPack、地图资料和本局事实，使用 upsertFactionLedger
 * 写回玩家当下应知、应接触、可长期承接的势力账本。
 */
export const threeKingdomsFactionsSeed: FactionSeed[] = [];
