import { describe, expect, it } from 'vitest';
import {
  appendSuggestedActionToInput,
  summarizeSuggestedAction,
} from './suggestedActionInput';

describe('appendSuggestedActionToInput', () => {
  it('uses the full description when the input is empty', () => {
    expect(
      appendSuggestedActionToInput('', {
        label: '巡查营门',
        description: '亲自巡查营门，查看守卒精神和粮械短缺情况。',
      }),
    ).toBe('亲自巡查营门，查看守卒精神和粮械短缺情况。');
  });

  it('appends full descriptions instead of replacing existing input', () => {
    const first = appendSuggestedActionToInput('', {
      label: '安抚士卒',
      description: '集合麾下士卒，安抚军心并询问粮饷拖欠的真实情况。',
    });

    expect(
      appendSuggestedActionToInput(first, {
        label: '清点军械',
        description: '再清点军械、甲胄和干粮，确认还能支撑几日操练。',
      }),
    ).toBe('集合麾下士卒，安抚军心并询问粮饷拖欠的真实情况；再清点军械、甲胄和干粮，确认还能支撑几日操练。');
  });

  it('falls back to the short label when the description is blank', () => {
    expect(
      appendSuggestedActionToInput('先召集亲兵', {
        label: '询问斥候',
        description: '   ',
      }),
    ).toBe('先召集亲兵；询问斥候');
  });

  it('uses a compact first clause while preserving the full action for input', () => {
    const action = {
      label: '召集亲兵商议今夜如何绕开营门守卫并逐一分派任务，暗中前往江边',
      description: '召集亲兵商议今夜如何绕开营门守卫，暗中前往江边查看敌军舟船。',
    };

    expect(summarizeSuggestedAction(action)).toBe('召集亲兵商议今夜如何绕开营门守卫…');
    expect(appendSuggestedActionToInput('', action)).toBe(action.description);
  });

  it('falls back to the description when the label is empty', () => {
    expect(summarizeSuggestedAction({
      label: ' ',
      description: '先去粮仓，核对账目。',
    })).toBe('先去粮仓 · 核对账目');
  });
});
