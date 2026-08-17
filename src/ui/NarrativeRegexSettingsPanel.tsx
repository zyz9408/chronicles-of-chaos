import { useMemo, useState } from 'react';
import {
  MAX_NARRATIVE_DISPLAY_REGEX_RULES,
  applyNarrativeDisplayRegexRulesWithReport,
  createNarrativeDisplayRegexRule,
  loadNarrativeDisplayRegexRules,
  saveNarrativeDisplayRegexRules,
  validateNarrativeDisplayRegexRule,
  type NarrativeDisplayRegexRule,
} from '../engine/settings/NarrativeDisplayRegex';

const DEFAULT_PREVIEW_TEXT = '旁白：风从江面掠过营旗。\n【斥候】「将军，前方发现敌军。」';

function moveRule(
  rules: NarrativeDisplayRegexRule[],
  index: number,
  offset: -1 | 1,
): NarrativeDisplayRegexRule[] {
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= rules.length) return rules;
  const nextRules = [...rules];
  [nextRules[index], nextRules[targetIndex]] = [nextRules[targetIndex], nextRules[index]];
  return nextRules;
}

export function NarrativeRegexSettingsPanel() {
  const [rules, setRules] = useState(loadNarrativeDisplayRegexRules);
  const [previewText, setPreviewText] = useState(DEFAULT_PREVIEW_TEXT);

  const preview = useMemo(
    () => applyNarrativeDisplayRegexRulesWithReport(previewText, rules),
    [previewText, rules],
  );

  const persistRules = (nextRules: NarrativeDisplayRegexRule[]) => {
    setRules(saveNarrativeDisplayRegexRules(nextRules));
  };

  const updateRule = (ruleId: string, patch: Partial<NarrativeDisplayRegexRule>) => {
    const nextRules = rules.map((rule) => {
      if (rule.id !== ruleId) return rule;
      const nextRule = { ...rule, ...patch };
      if ((patch.pattern !== undefined || patch.flags !== undefined) && nextRule.enabled) {
        const validation = validateNarrativeDisplayRegexRule(nextRule);
        if (!validation.valid) nextRule.enabled = false;
      }
      return nextRule;
    });
    persistRules(nextRules);
  };

  return (
    <section className="narrative-regex-settings" data-testid="narrative-regex-settings">
      <div className="narrative-regex-head">
        <div>
          <h3>显示正则替换</h3>
          <p>
            规则只修改本机屏幕上的正文副本。存档原文、AI 上下文、记忆、判定、战斗识别和状态写回均不会改变。
          </p>
        </div>
        <div className="narrative-regex-head-actions">
          <button
            type="button"
            className="nav-btn"
            disabled={!rules.some((rule) => rule.enabled)}
            onClick={() => persistRules(rules.map((rule) => ({ ...rule, enabled: false })))}
          >
            禁用全部
          </button>
          <button
            type="button"
            className="nav-btn primary"
            disabled={rules.length >= MAX_NARRATIVE_DISPLAY_REGEX_RULES}
            onClick={() => persistRules([...rules, createNarrativeDisplayRegexRule()])}
          >
            添加规则
          </button>
        </div>
      </div>

      <p className="narrative-regex-limit">
        按列表顺序执行，最多 {MAX_NARRATIVE_DISPLAY_REGEX_RULES} 条。支持替换引用 $1、$2；flags 只允许 g、i、m、s、u。
      </p>

      {rules.length === 0 ? (
        <div className="narrative-regex-empty">尚未添加显示正则，游戏将直接显示存档中的原始正文。</div>
      ) : (
        <div className="narrative-regex-rule-list">
          {rules.map((rule, index) => {
            const validation = validateNarrativeDisplayRegexRule(rule);
            return (
              <article
                key={rule.id}
                className={`narrative-regex-rule ${rule.enabled && validation.valid ? 'is-enabled' : ''}`}
              >
                <div className="narrative-regex-rule-head">
                  <label className="gs-checkbox-control">
                    <input
                      type="checkbox"
                      aria-label={`启用正则 ${rule.name}`}
                      checked={rule.enabled}
                      disabled={!validation.valid}
                      onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })}
                    />
                    <span>{rule.enabled ? '已启用' : '未启用'}</span>
                  </label>
                  <div className="narrative-regex-order-actions">
                    <button
                      type="button"
                      className="nav-btn"
                      aria-label={`上移正则 ${rule.name}`}
                      disabled={index === 0}
                      onClick={() => persistRules(moveRule(rules, index, -1))}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      className="nav-btn"
                      aria-label={`下移正则 ${rule.name}`}
                      disabled={index === rules.length - 1}
                      onClick={() => persistRules(moveRule(rules, index, 1))}
                    >
                      下移
                    </button>
                    <button
                      type="button"
                      className="nav-btn danger"
                      aria-label={`删除正则 ${rule.name}`}
                      onClick={() => persistRules(rules.filter((item) => item.id !== rule.id))}
                    >
                      删除
                    </button>
                  </div>
                </div>

                <div className="narrative-regex-fields">
                  <label>
                    <span>规则名称</span>
                    <input
                      aria-label={`规则名称 ${index + 1}`}
                      type="text"
                      maxLength={40}
                      value={rule.name}
                      onChange={(event) => updateRule(rule.id, { name: event.target.value })}
                    />
                  </label>
                  <label className="narrative-regex-flags-field">
                    <span>flags</span>
                    <input
                      aria-label={`正则 flags ${rule.name}`}
                      type="text"
                      maxLength={5}
                      value={rule.flags}
                      placeholder="gu"
                      spellCheck={false}
                      onChange={(event) => updateRule(rule.id, { flags: event.target.value })}
                    />
                  </label>
                  <label className="narrative-regex-pattern-field">
                    <span>查找表达式</span>
                    <textarea
                      aria-label={`查找表达式 ${rule.name}`}
                      maxLength={256}
                      rows={2}
                      value={rule.pattern}
                      placeholder="例如：\\n{3,}"
                      spellCheck={false}
                      onChange={(event) => updateRule(rule.id, { pattern: event.target.value })}
                    />
                  </label>
                  <label className="narrative-regex-replacement-field">
                    <span>替换内容</span>
                    <textarea
                      aria-label={`替换内容 ${rule.name}`}
                      maxLength={1_000}
                      rows={2}
                      value={rule.replacement}
                      placeholder="留空表示从显示文本中移除"
                      spellCheck={false}
                      onChange={(event) => updateRule(rule.id, { replacement: event.target.value })}
                    />
                  </label>
                </div>
                <p className={`narrative-regex-validation ${validation.valid ? 'is-valid' : 'is-error'}`} role="status">
                  {validation.valid ? '规则有效，可以启用。' : validation.error}
                </p>
              </article>
            );
          })}
        </div>
      )}

      <div className="narrative-regex-preview">
        <label>
          <span>预览原文</span>
          <textarea
            aria-label="正则预览原文"
            rows={5}
            value={previewText}
            onChange={(event) => setPreviewText(event.target.value)}
          />
        </label>
        <div>
          <span>显示结果</span>
          <pre data-testid="narrative-regex-preview-result">{preview.text}</pre>
          <small>
            已应用 {preview.appliedRuleIds.length} 条；跳过 {preview.skippedRules.length} 条。
          </small>
        </div>
      </div>
    </section>
  );
}
