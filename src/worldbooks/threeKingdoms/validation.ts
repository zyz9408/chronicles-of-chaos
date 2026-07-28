import type { ValidationRule } from '../../engine/types';

/**
 * 三国世界书校验规则
 */
export const threeKingdomsValidationRules: ValidationRule[] = [
  {
    id: 'rule_no_supernatural',
    description: '禁止超自然力量内容',
    field: 'narrativeText',
    rule: '不得包含修仙、功法、内力、法宝、法术等玄幻元素',
  },
  {
    id: 'rule_no_modern',
    description: '禁止现代内容',
    field: 'narrativeText',
    rule: '不得包含现代通讯、交通工具、金融体系、国家机器等',
  },
  {
    id: 'rule_no_free_title',
    description: '禁止随意授官',
    field: 'statePatch',
    rule: 'patch 不得包含授予官职、兵权、城池的操作',
  },
  {
    id: 'rule_no_free_follow',
    description: '禁止名将无条件追随',
    field: 'statePatch',
    rule: 'actorDiscovered 不得将历史名将设为追随玩家',
  },
  {
    id: 'rule_rumor_not_fact',
    description: '传闻不是事实',
    field: 'statePatch.rumorAdded',
    rule: 'rumorAdded 的 verified 字段必须为 false',
  },
  {
    id: 'rule_geography_valid',
    description: '地点必须存在于地图中',
    field: 'statePatch.locationChange',
    rule: 'locationChange 的目标地点必须存在于 mapSeed 或 runtime delta 中',
  },
];
