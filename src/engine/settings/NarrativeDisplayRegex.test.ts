import { describe, expect, it } from 'vitest';
import {
  MAX_NARRATIVE_DISPLAY_REGEX_INPUT_LENGTH,
  NARRATIVE_DISPLAY_REGEX_RULES_KEY,
  applyNarrativeDisplayRegexRulesWithReport,
  createNarrativeDisplayRegexRule,
  loadNarrativeDisplayRegexRules,
  saveNarrativeDisplayRegexRules,
  validateNarrativeDisplayRegexRule,
} from './NarrativeDisplayRegex';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('NarrativeDisplayRegex', () => {
  it('persists only local display rules and restores their order', () => {
    const storage = new MemoryStorage();
    const rules = [
      createNarrativeDisplayRegexRule({ id: 'first', name: '第一条', pattern: '敌军', replacement: '来敌', enabled: true }),
      createNarrativeDisplayRegexRule({ id: 'second', name: '第二条', pattern: '来敌', replacement: '敌骑', enabled: true }),
    ];

    expect(saveNarrativeDisplayRegexRules(rules, storage).map((rule) => rule.id)).toEqual(['first', 'second']);
    expect(loadNarrativeDisplayRegexRules(storage).map((rule) => rule.id)).toEqual(['first', 'second']);
    expect(storage.getItem(NARRATIVE_DISPLAY_REGEX_RULES_KEY)).toContain('第一条');
  });

  it('applies enabled rules in order without changing the source string', () => {
    const source = '敌军已经抵达，敌军正在列阵。';
    const rules = [
      createNarrativeDisplayRegexRule({ id: 'one', pattern: '敌军', replacement: '来敌', flags: 'gu', enabled: true }),
      createNarrativeDisplayRegexRule({ id: 'two', pattern: '来敌', replacement: '敌骑', flags: 'gu', enabled: true }),
    ];

    const result = applyNarrativeDisplayRegexRulesWithReport(source, rules);

    expect(result.text).toBe('敌骑已经抵达，敌骑正在列阵。');
    expect(result.appliedRuleIds).toEqual(['one', 'two']);
    expect(source).toBe('敌军已经抵达，敌军正在列阵。');
  });

  it('supports capture substitutions while rejecting invalid flags and syntax', () => {
    const captureRule = createNarrativeDisplayRegexRule({
      id: 'capture',
      pattern: '【([^】]+)】',
      replacement: '$1：',
      flags: 'gu',
      enabled: true,
    });
    expect(applyNarrativeDisplayRegexRulesWithReport('【赵云】请战', [captureRule]).text).toBe('赵云：请战');

    expect(validateNarrativeDisplayRegexRule({ ...captureRule, flags: 'gx' })).toMatchObject({ valid: false });
    expect(validateNarrativeDisplayRegexRule({ ...captureRule, pattern: '(' })).toMatchObject({ valid: false });
  });

  it('rejects backreferences and nested ambiguous repetition before execution', () => {
    const baseRule = createNarrativeDisplayRegexRule({ pattern: 'a', enabled: true });

    expect(validateNarrativeDisplayRegexRule({ ...baseRule, pattern: '(a+)+$' })).toMatchObject({
      valid: false,
      error: expect.stringContaining('重复结构'),
    });
    expect(validateNarrativeDisplayRegexRule({ ...baseRule, pattern: '(a)\\1' })).toMatchObject({
      valid: false,
      error: expect.stringContaining('反向引用'),
    });
  });

  it('skips invalid enabled rules and preserves the displayed source on failure', () => {
    const invalidRule = createNarrativeDisplayRegexRule({
      id: 'invalid',
      pattern: '(a+)+$',
      replacement: '',
      enabled: true,
    });

    const result = applyNarrativeDisplayRegexRulesWithReport('aaaaaaaa!', [invalidRule]);

    expect(result.text).toBe('aaaaaaaa!');
    expect(result.appliedRuleIds).toEqual([]);
    expect(result.skippedRules).toHaveLength(1);
  });

  it('skips all display rules when a narrative exceeds the guarded input size', () => {
    const source = 'a'.repeat(MAX_NARRATIVE_DISPLAY_REGEX_INPUT_LENGTH + 1);
    const rule = createNarrativeDisplayRegexRule({ pattern: 'a', replacement: 'b', enabled: true });

    const result = applyNarrativeDisplayRegexRulesWithReport(source, [rule]);

    expect(result.text).toBe(source);
    expect(result.appliedRuleIds).toEqual([]);
    expect(result.skippedRules[0]?.ruleId).toBe('input');
  });

  it('drops a replacement that expands the display text beyond the output guard', () => {
    const source = 'a'.repeat(100);
    const rule = createNarrativeDisplayRegexRule({
      id: 'growth',
      pattern: 'a',
      replacement: 'x'.repeat(1_000),
      flags: 'gu',
      enabled: true,
    });

    const result = applyNarrativeDisplayRegexRulesWithReport(source, [rule]);

    expect(result.text).toBe(source);
    expect(result.skippedRules[0]?.error).toContain('异常膨胀');
  });
});
