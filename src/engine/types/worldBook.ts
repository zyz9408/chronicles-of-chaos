// ============================================================
// Engine Core Types - WorldBook
// 通用世界书类型定义，不得包含任何具体世界书专有术语
// ============================================================

/** 世界书清单元数据 */
export interface WorldBookManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  language: string;
  genre: string;
  source: 'official' | 'custom';
  compatibleEngineVersion: string;
  description?: string;
}

/** 世界本体论 - 定义本世界中存在的概念类型 */
export interface WorldOntology {
  regionLevels: string[];       // 如 ["州", "郡", "县"]
  factionTypes: string[];       // 如 ["朝廷", "地方官府", "叛乱组织"]
  actorRoleTypes: string[];     // 如 ["君主", "将领", "文官", "在野"]
  socialClasses: string[];      // 如 ["士族", "寒门", "平民", "流民"]
  resourceTypes: string[];      // 如 ["粮食", "钱财", "兵力", "声望"]
  conflictTypes: string[];      // 如 ["战争", "政争", "匪患"]
  actionTypes: string[];        // 如 ["移动", "交谈", "交易", "战斗"]
  relationshipTypes: string[];  // 如 ["效忠", "敌对", "中立", "同盟"]
}

/** 时代锚点 - 表示世界历史气候，不强制剧情发生 */
export interface TimelineAnchor {
  id: string;
  label: string;
  approximateDate: string;
  summary: string;
  activeFactionHints: string[];
  regionalTensionHints: string[];
  suggestedThemes: string[];
}

/** 开局书签 */
export interface StartBookmark {
  id: string;
  label: string;
  startDate: string;
  relatedTimelineAnchorIds: string[];
  description: string;
  recommendedRegions: string[];
  recommendedOrigins: string[];
  situationSummary: string;
}

/** 开局危机模板 */
export interface OpeningCrisisTemplate {
  id: string;
  label: string;
  applicableBookmarkIds: string[];
  applicableRegionIds: string[];
  applicableOrigins: string[];
  crisisSummary: string;
  firstSceneHint: string;
  riskLevel: 'low' | 'medium' | 'high';
}

/** 开局人物选项 - 由世界书提供，避免把具体时代写死进引擎或 UI */
export interface OpeningCharacterOption {
  id: string;
  label: string;
  description?: string;
}

/** 开局能力预设 - 可隐藏部分属性，例如机运 */
export interface OpeningAbilityPreset {
  id: string;
  label: string;
  scores: Record<string, number>;
}

export interface OpeningCharacterOptions {
  birthOrigins: OpeningCharacterOption[];
  identities: OpeningCharacterOption[];
  abilityPresets: OpeningAbilityPreset[];
  traits?: CharacterTrait[];
  hiddenAbilityKeys?: string[];
}

/** Prompt 片段集合 */
export interface WorldBookPrompts {
  narrativeBaseline: string;
  forbiddenTopics: string[];
  outputFormat: string;
  toneGuide: string;
}

/** 校验规则 */
export interface ValidationRule {
  id: string;
  description: string;
  field: string;
  rule: string;
}

/** 完整世界书 */
export interface WorldBook {
  manifest: WorldBookManifest;
  ontology: WorldOntology;
  lore: string;
  mapSeed: MapNode[];
  openingLocationSeed?: MapNode[];
  routeSeed?: MapRouteEdgeV1[];
  factionsSeed: FactionSeed[];
  timelineAnchors: TimelineAnchor[];
  startBookmarks: StartBookmark[];
  openingCrisisTemplates: OpeningCrisisTemplate[];
  characterOptions?: OpeningCharacterOptions;
  prompts: WorldBookPrompts;
  validationRules: ValidationRule[];
}

// 前向声明，实际类型在同目录其他文件中
import type { MapNode, FactionSeed, MapRouteEdgeV1 } from './map';
import type { CharacterTrait } from './actor';
