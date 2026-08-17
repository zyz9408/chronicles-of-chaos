export const NARRATIVE_DISPLAY_REGEX_RULES_KEY = 'coc_v2_narrative_display_regex_rules_v1';
export const NARRATIVE_DISPLAY_REGEX_RULES_CHANGED_EVENT = 'coc:narrative-display-regex-rules-changed';
export const MAX_NARRATIVE_DISPLAY_REGEX_RULES = 20;
export const MAX_NARRATIVE_DISPLAY_REGEX_PATTERN_LENGTH = 256;
export const MAX_NARRATIVE_DISPLAY_REGEX_REPLACEMENT_LENGTH = 1_000;
export const MAX_NARRATIVE_DISPLAY_REGEX_INPUT_LENGTH = 100_000;

const ALLOWED_FLAGS = new Set(['g', 'i', 'm', 's', 'u']);
const MAX_REGEX_OUTPUT_LENGTH = 240_000;
let fallbackRuleSequence = 0;

type RegexRuleStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface NarrativeDisplayRegexRule {
  id: string;
  name: string;
  pattern: string;
  replacement: string;
  flags: string;
  enabled: boolean;
}

export interface NarrativeDisplayRegexValidation {
  valid: boolean;
  error?: string;
}

export interface NarrativeDisplayRegexApplyResult {
  text: string;
  appliedRuleIds: string[];
  skippedRules: Array<{ ruleId: string; error: string }>;
}

function getSettingsStorage(storage?: RegexRuleStorage): RegexRuleStorage | null {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function clampText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function createRuleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `display-regex-${crypto.randomUUID()}`;
  }
  fallbackRuleSequence += 1;
  return `display-regex-${Date.now().toString(36)}-${fallbackRuleSequence.toString(36)}`;
}

export function createNarrativeDisplayRegexRule(
  overrides: Partial<NarrativeDisplayRegexRule> = {},
): NarrativeDisplayRegexRule {
  return normalizeNarrativeDisplayRegexRule({
    id: createRuleId(),
    name: '新规则',
    pattern: '',
    replacement: '',
    flags: 'gu',
    enabled: false,
    ...overrides,
  });
}

export function normalizeNarrativeDisplayRegexRule(value: unknown): NarrativeDisplayRegexRule {
  const source = value && typeof value === 'object'
    ? value as Partial<NarrativeDisplayRegexRule>
    : {};
  return {
    id: clampText(source.id, 120).trim() || createRuleId(),
    name: clampText(source.name, 40).trim() || '未命名规则',
    pattern: clampText(source.pattern, MAX_NARRATIVE_DISPLAY_REGEX_PATTERN_LENGTH),
    replacement: clampText(source.replacement, MAX_NARRATIVE_DISPLAY_REGEX_REPLACEMENT_LENGTH),
    flags: clampText(source.flags, 8).trim(),
    enabled: source.enabled === true,
  };
}

function quantifierEndAt(pattern: string, index: number): number | undefined {
  const value = pattern[index];
  if (value === '*' || value === '+' || value === '?') return index;
  if (value !== '{') return undefined;
  const match = /^\{\d+(?:,\d*)?\}/u.exec(pattern.slice(index));
  return match ? index + match[0].length - 1 : undefined;
}

/**
 * Rejects the most common catastrophic-backtracking shapes without pretending
 * that JavaScript RegExp has a real execution timeout. The editor is intended
 * for display cleanup, so backreferences and nested/alternating repeated groups
 * are deliberately outside the accepted subset.
 */
function hasUnsafeRepetitionShape(pattern: string): boolean {
  const stack: Array<{ hasRepetition: boolean; hasAlternation: boolean }> = [];
  let escaped = false;
  let inCharacterClass = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const value = pattern[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (value === '\\') {
      escaped = true;
      continue;
    }
    if (value === '[' && !inCharacterClass) {
      inCharacterClass = true;
      continue;
    }
    if (value === ']' && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (inCharacterClass) continue;

    if (value === '(') {
      stack.push({ hasRepetition: false, hasAlternation: false });
      continue;
    }
    if (value === '|') {
      const frame = stack[stack.length - 1];
      if (frame) frame.hasAlternation = true;
      continue;
    }
    if (value === ')') {
      const frame = stack.pop();
      const quantifierEnd = quantifierEndAt(pattern, index + 1);
      if (frame && quantifierEnd !== undefined) {
        if (frame.hasRepetition || frame.hasAlternation) return true;
        const parent = stack[stack.length - 1];
        if (parent) parent.hasRepetition = true;
      }
      continue;
    }

    const quantifierEnd = quantifierEndAt(pattern, index);
    if (quantifierEnd === undefined) continue;
    const isGroupPrefix = value === '?' && pattern[index - 1] === '(';
    const isLazyModifier = value === '?' && ['*', '+', '?', '}'].includes(pattern[index - 1] ?? '');
    if (!isGroupPrefix && !isLazyModifier) {
      const frame = stack[stack.length - 1];
      if (frame) frame.hasRepetition = true;
    }
    index = quantifierEnd;
  }

  return false;
}

export function validateNarrativeDisplayRegexRule(
  rule: NarrativeDisplayRegexRule,
): NarrativeDisplayRegexValidation {
  if (!rule.pattern) return { valid: false, error: '查找表达式不能为空。' };
  if (rule.pattern.length > MAX_NARRATIVE_DISPLAY_REGEX_PATTERN_LENGTH) {
    return { valid: false, error: `查找表达式不能超过 ${MAX_NARRATIVE_DISPLAY_REGEX_PATTERN_LENGTH} 个字符。` };
  }
  if (rule.replacement.length > MAX_NARRATIVE_DISPLAY_REGEX_REPLACEMENT_LENGTH) {
    return { valid: false, error: `替换内容不能超过 ${MAX_NARRATIVE_DISPLAY_REGEX_REPLACEMENT_LENGTH} 个字符。` };
  }

  const seenFlags = new Set<string>();
  for (const flag of rule.flags) {
    if (!ALLOWED_FLAGS.has(flag)) return { valid: false, error: `不支持 flags “${flag}”，只允许 g、i、m、s、u。` };
    if (seenFlags.has(flag)) return { valid: false, error: `flags “${flag}”不能重复。` };
    seenFlags.add(flag);
  }

  if (/\\(?:[1-9]|k<)/u.test(rule.pattern)) {
    return { valid: false, error: '为避免页面卡顿，查找表达式不允许使用反向引用。' };
  }
  if (hasUnsafeRepetitionShape(rule.pattern)) {
    return { valid: false, error: '检测到嵌套或歧义重复结构，请简化表达式后再启用。' };
  }

  try {
    new RegExp(rule.pattern, rule.flags);
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? `正则语法错误：${error.message}` : '正则语法错误。',
    };
  }
  return { valid: true };
}

export function loadNarrativeDisplayRegexRules(
  storage?: RegexRuleStorage,
): NarrativeDisplayRegexRule[] {
  const target = getSettingsStorage(storage);
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(NARRATIVE_DISPLAY_REGEX_RULES_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const ids = new Set<string>();
    return parsed
      .slice(0, MAX_NARRATIVE_DISPLAY_REGEX_RULES)
      .map(normalizeNarrativeDisplayRegexRule)
      .map((rule) => {
        if (!ids.has(rule.id)) {
          ids.add(rule.id);
          return rule;
        }
        const nextRule = { ...rule, id: createRuleId() };
        ids.add(nextRule.id);
        return nextRule;
      });
  } catch {
    return [];
  }
}

export function saveNarrativeDisplayRegexRules(
  rules: NarrativeDisplayRegexRule[],
  storage?: RegexRuleStorage,
): NarrativeDisplayRegexRule[] {
  const normalized = rules
    .slice(0, MAX_NARRATIVE_DISPLAY_REGEX_RULES)
    .map(normalizeNarrativeDisplayRegexRule);
  const target = getSettingsStorage(storage);
  try {
    target?.setItem(NARRATIVE_DISPLAY_REGEX_RULES_KEY, JSON.stringify(normalized));
  } catch {
    // Display preferences are non-critical and must never interrupt the game.
  }
  if (!storage && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NARRATIVE_DISPLAY_REGEX_RULES_CHANGED_EVENT));
  }
  return normalized;
}

export function applyNarrativeDisplayRegexRulesWithReport(
  text: string,
  rules: NarrativeDisplayRegexRule[],
): NarrativeDisplayRegexApplyResult {
  if (!text || text.length > MAX_NARRATIVE_DISPLAY_REGEX_INPUT_LENGTH) {
    return {
      text,
      appliedRuleIds: [],
      skippedRules: text.length > MAX_NARRATIVE_DISPLAY_REGEX_INPUT_LENGTH
        ? [{ ruleId: 'input', error: '正文过长，已跳过显示正则。' }]
        : [],
    };
  }

  let output = text;
  const appliedRuleIds: string[] = [];
  const skippedRules: Array<{ ruleId: string; error: string }> = [];

  rules.slice(0, MAX_NARRATIVE_DISPLAY_REGEX_RULES).forEach((ruleValue) => {
    const rule = normalizeNarrativeDisplayRegexRule(ruleValue);
    if (!rule.enabled) return;
    const validation = validateNarrativeDisplayRegexRule(rule);
    if (!validation.valid) {
      skippedRules.push({ ruleId: rule.id, error: validation.error ?? '规则无效。' });
      return;
    }

    try {
      const nextOutput = output.replace(new RegExp(rule.pattern, rule.flags), rule.replacement);
      const allowedGrowth = Math.min(MAX_REGEX_OUTPUT_LENGTH, output.length * 4 + 20_000);
      if (nextOutput.length > allowedGrowth) {
        skippedRules.push({ ruleId: rule.id, error: '替换结果异常膨胀，已跳过该规则。' });
        return;
      }
      output = nextOutput;
      appliedRuleIds.push(rule.id);
    } catch (error) {
      skippedRules.push({
        ruleId: rule.id,
        error: error instanceof Error ? error.message : '执行替换失败。',
      });
    }
  });

  return { text: output, appliedRuleIds, skippedRules };
}

export function applyNarrativeDisplayRegexRules(
  text: string,
  rules: NarrativeDisplayRegexRule[] = loadNarrativeDisplayRegexRules(),
): string {
  return applyNarrativeDisplayRegexRulesWithReport(text, rules).text;
}
