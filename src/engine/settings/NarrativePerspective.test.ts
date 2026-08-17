import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import {
  applyNarrativePerspectiveToRuntimeState,
  formatNarrativePerspectiveForPrompt,
  getNarrativePerspectiveProfile,
  normalizeNarrativePerspective,
} from './NarrativePerspective';

describe('NarrativePerspective', () => {
  it('keeps second person as the compatibility default', () => {
    expect(normalizeNarrativePerspective(undefined)).toBe('second_person');
    expect(normalizeNarrativePerspective('invalid')).toBe('second_person');
    expect(getNarrativePerspectiveProfile(undefined).marker).toBe('你 · 默认');
  });

  it('builds a first-person contract without weakening player control', () => {
    const guide = formatNarrativePerspectiveForPrompt('first_person', {
      playerName: '林砚',
      playerSex: '男',
    });

    expect(guide).toContain('正文叙事人称：第一人称');
    expect(guide).toContain('统一使用“我”');
    expect(guide).toContain('绝不授权补写玩家未输入的对白、心理决定');
    expect(guide).toContain('不得使用 `【我】`');
  });

  it('uses only the player name and an unambiguous sex pronoun in third person', () => {
    const guide = formatNarrativePerspectiveForPrompt('third_person', {
      playerName: '林砚',
      playerSex: '男',
    });

    expect(guide).toContain('姓名“林砚”');
    expect(guide).toContain('才可使用“他”');
    expect(guide).toContain('不得用主角表字');
    expect(guide).not.toContain('子衡');
    expect(guide).toContain('不得改用“我”或“你”');
  });

  it('does not invent a third-person pronoun for other or unknown sex values', () => {
    const guide = formatNarrativePerspectiveForPrompt('third_person', {
      playerName: '阿迟',
      playerSex: '其他',
    });

    expect(guide).toContain('不得擅自为主角指定“他”或“她”');
    expect(guide).toContain('仍使用姓名“阿迟”');
  });

  it('updates a runtime state immutably', () => {
    const state = {
      narrativePerspective: 'second_person',
    } as RuntimeState;
    const updated = applyNarrativePerspectiveToRuntimeState(state, 'third_person');

    expect(updated).not.toBe(state);
    expect(updated.narrativePerspective).toBe('third_person');
    expect(state.narrativePerspective).toBe('second_person');
  });
});
