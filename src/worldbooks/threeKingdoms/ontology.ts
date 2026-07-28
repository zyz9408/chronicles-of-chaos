import type { WorldOntology } from '../../engine/types';

/**
 * 三国世界本体论
 * 将三国专有术语映射到引擎通用概念
 */
export const threeKingdomsOntology: WorldOntology = {
  regionLevels: ['州', '郡', '县'],
  factionTypes: [
    '朝廷',
    '地方官府',
    '豪族宗族',
    '叛乱组织',
    '盗匪流寇',
    '军阀集团',
    '士人社群',
    '游侠组织',
    '宗族武装',
  ],
  actorRoleTypes: [
    '君主',
    '将领',
    '文官',
    '谋士',
    '在野士人',
    '豪强',
    '游侠',
    '平民',
    '流民',
    '黄巾信众',
    '小吏',
    '商贾',
  ],
  socialClasses: [
    '士族',
    '寒门',
    '豪强',
    '平民',
    '流民',
    '黄巾信众',
  ],
  resourceTypes: [
    '粮食',
    '钱财',
    '声望',
    '人力',
    '兵器',
    '马匹',
  ],
  conflictTypes: [
    '战争',
    '政争',
    '匪患',
    '宗族械斗',
    '民变',
    '暗杀',
  ],
  actionTypes: [
    '移动',
    '交谈',
    '交易',
    '战斗',
    '探索',
    '休息',
    '招募',
    '上书',
  ],
  relationshipTypes: [
    '效忠',
    '敌对',
    '中立',
    '同盟',
    '亲属',
    '师生',
    '恩义',
  ],
};
