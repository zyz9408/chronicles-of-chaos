import { describe, expect, it } from 'vitest';
import type { ActionIntent } from '../types';
import { interpretAction } from './ActionInterpreter';

describe('interpretAction', () => {
  it.each([
    '请陈衡放箭射敌',
    '我挥刀迎敌',
    '我据门防守',
    '我向敌将单挑',
    '我趁夜刺杀敌酋',
    '我护着伤者突围',
    '我上前擒拿刺客',
    '我与追兵近身交锋',
    '我准备迎战来敌',
  ])('prioritizes combat intent for %s', (input) => {
    expect(interpretAction(input)).toBe('combat');
  });

  it.each<[string, ActionIntent]>([
    ['我询问陈衡应该如何杀敌', 'inquire'],
    ['我打听是否有人准备刺杀太守', 'inquire'],
    ['请陈衡讲讲怎样防守城门', 'interact'],
    ['我与陈衡讨论如何攻击敌人', 'interact'],
    ['我询问是否应该立即迎战', 'inquire'],
    ['我与陈衡讨论之后的防守安排', 'interact'],
    ['我询问陈衡，敌军出现后立即迎战是否妥当', 'inquire'],
    ['我询问陈衡：随后攻击敌人是否可行', 'inquire'],
    ['领取药品，说明此物可在非战斗时直接使用', 'other'],
  ])('keeps explicit discussion context out of combat for %s', (input, expected) => {
    expect(interpretAction(input)).toBe(expected);
  });

  it.each([
    '我与陈衡讨论片刻，随后攻击敌人',
    '询问完军情后立即迎战',
    '我询问敌人是否投降，然后攻击',
    '我询问完军情后立即迎战，无论敌人是否准备妥当',
    '我询问军情，随后攻击敌人，看看是否能突围',
  ])('uses the final action clause after an explicit sequence connector for %s', (input) => {
    expect(interpretAction(input)).toBe('combat');
  });

  it('keeps treatment requests in the non-combat intent path', () => {
    expect(interpretAction('请陈衡替伤者包扎止血')).toBe('interact');
  });

  it.each<[string, ActionIntent]>([
    ['我去渡口', 'move'],
    ['我打听城中消息', 'inquire'],
    ['我请陈衡交谈', 'interact'],
    ['我停下休息', 'rest'],
    ['我购买干粮', 'trade'],
    ['我与商贩杀价', 'trade'],
    ['我观察营门', 'explore'],
    ['我整理衣袖', 'other'],
  ])('preserves existing intent recognition for %s', (input, expected) => {
    expect(interpretAction(input)).toBe(expected);
  });
});
