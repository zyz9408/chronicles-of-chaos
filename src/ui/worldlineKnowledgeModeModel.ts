import type { WorldlineKnowledgeMode, WorldlineRuntimeSettings } from '../engine/types';

export interface WorldlineKnowledgeModeOption {
  mode: WorldlineKnowledgeMode;
  label: string;
  shortDescription: string;
  description: string;
}

const WORLDLINE_KNOWLEDGE_MODE_OPTIONS: WorldlineKnowledgeModeOption[] = [
  {
    mode: 'off',
    label: '关闭',
    shortDescription: '不投喂资料库',
    description: '不投喂史实资料库或剧情包，主要依靠世界书、当前剧情与本局状态推进。',
  },
  {
    mode: 'light',
    label: '轻微',
    shortDescription: '只防明显错漏',
    description: '只投喂少量关键锚点，用来避免明显时代、人物、地点或设定错误。',
  },
  {
    mode: 'default',
    label: '默认',
    shortDescription: '少量相关资料',
    description: '投喂与当前时间、地点、人物、势力和动态系统相关的少量资料，兼顾纠偏与 Token 成本。',
  },
  {
    mode: 'strict',
    label: '严谨',
    shortDescription: '更强纠偏参考',
    description: '投喂更多纠偏资料，更贴合史实、原著或设定惯性，但仍以本局事实和玩家行动为最高优先级。',
  },
];

export function getWorldlineKnowledgeModeOptions(): WorldlineKnowledgeModeOption[] {
  return WORLDLINE_KNOWLEDGE_MODE_OPTIONS;
}

export function getDefaultWorldlineKnowledgeMode(): WorldlineKnowledgeMode {
  return 'default';
}

export function getDefaultWorldlineKnowledgeBaseId(worldBookId: string | null | undefined): string | undefined {
  if (worldBookId === 'threeKingdoms') {
    return 'threeKingdoms.coreKnowledge.v1';
  }
  return undefined;
}

export function getDefaultWorldlineStoryPackIds(
  worldBookId: string | null | undefined,
): string[] {
  if (worldBookId === 'threeKingdoms') {
    return ['threeKingdoms.genericStory.v1'];
  }
  return [];
}

export function createOpeningWorldlineSettings(
  worldBookId: string | null | undefined,
  knowledgeMode: WorldlineKnowledgeMode,
): WorldlineRuntimeSettings {
  return {
    knowledgeMode,
    knowledgeBaseId: getDefaultWorldlineKnowledgeBaseId(worldBookId),
    storyPackIds: getDefaultWorldlineStoryPackIds(worldBookId),
  };
}
