import type { AbilityMechanics, AbilityRule } from '../types';
import { buildMechanics, validateAbilityMechanics } from './AbilityMechanics';

export const ABILITY_RULE_TEMPLATES = [
  ['hourly_full_hp', '按游戏时间生命回满'], ['turn_hp', '每回合恢复生命'], ['turn_stamina', '每回合恢复体力'],
  ['use_full_hp', '每次主动施展生命回满'], ['damage', '被动伤害倍率'], ['accuracy', '被动命中加成'],
  ['block', '被动格挡加成'], ['speed', '被动行动速度加成'], ['war', '统领部队战力百分比加成'],
  ['learning', '学习进度倍率'], ['perfect_learning', '新学绝艺直接满级'],
] as const;
export type AbilityTemplate = typeof ABILITY_RULE_TEMPLATES[number][0];

export function configureAbilityRule(id: string, template: AbilityTemplate, value = 2, intervalMinutes = 60): AbilityMechanics {
  const rule: AbilityRule = { ruleId: `${id}:configured`, trigger: 'passive_modifier', scopes: ['personal_combat'], priority: 100, effects: [] };
  if (template === 'hourly_full_hp') Object.assign(rule, { trigger: 'on_time_elapsed', scopes: ['runtime_turn'], intervalMinutes, effects: [{ type: 'restore_to_max', resource: 'hp', target: 'self', allowRevive: false }] });
  else if (template === 'turn_hp' || template === 'turn_stamina') Object.assign(rule, { trigger: 'after_runtime_turn', scopes: ['runtime_turn', 'personal_combat'], effects: [{ type: 'restore_amount', resource: template === 'turn_hp' ? 'hp' : 'stamina', value, target: 'self' }] });
  else if (template === 'use_full_hp') Object.assign(rule, { trigger: 'on_unique_art_use', scopes: ['runtime_turn', 'personal_combat'], effects: [{ type: 'restore_to_max', resource: 'hp', target: 'self', allowRevive: false }] });
  else if (template === 'learning') Object.assign(rule, { trigger: 'on_progress_award', scopes: ['learning'], effects: [{ type: 'multiply_learning_progress', multiplier: value }] });
  else if (template === 'perfect_learning') Object.assign(rule, { trigger: 'on_skill_acquired', scopes: ['learning'], effects: [{ type: 'set_skill_to_max_level' }] });
  else {
    const metric = ({ damage: 'damageMultiplier', accuracy: 'accuracy', block: 'block', speed: 'speed', war: 'warPowerPercent' } as const)[template];
    rule.scopes = template === 'war' ? ['war'] : ['personal_combat'];
    rule.effects = [{ type: 'numeric_modifier', metric, value }];
  }
  const mechanics = buildMechanics(`玩家手动确认模板:${template}`, [rule]);
  if (!validateAbilityMechanics(mechanics)) throw new Error('数值超出支持范围：恢复 1～10000；伤害倍率 0～10；命中/格挡/速度 0～100；战争加成 0～280%；周期 1～43200 分钟。');
  return mechanics;
}
