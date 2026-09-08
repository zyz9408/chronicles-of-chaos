import React, { useState } from 'react';
import './AbilityRulesPanel.css';
import type { RuntimeState, AbilityMechanics } from '../engine/types';
import { ABILITY_RULE_TEMPLATES, configureAbilityRule, type AbilityTemplate } from '../engine/abilities/AbilityRuleTemplates';
import { abilityMechanicsSummary, compileTraitAbilityMechanics, compileUniqueArtAbilityMechanics } from '../engine/abilities/AbilityMechanics';

export function AbilityRulesPanel({ state, disabled, onApply }: { state: RuntimeState; disabled: boolean; onApply: (id: string, kind: 'trait' | 'art', mechanics: AbilityMechanics) => Promise<void> }): React.ReactElement {
  const [selected, setSelected] = useState(''); const [template, setTemplate] = useState<AbilityTemplate>('hourly_full_hp');
  const [value, setValue] = useState(2); const [interval, setInterval] = useState(60); const [error, setError] = useState('');
  const abilities = [...(state.player.traits ?? []).map(item => ({ id: item.id, name: item.label, kind: 'trait' as const, mechanics: compileTraitAbilityMechanics(item) })), ...(state.player.uniqueArts ?? []).map(item => ({ id: item.id, name: item.name, kind: 'art' as const, mechanics: compileUniqueArtAbilityMechanics(item) }))];
  const current = abilities.find(item => `${item.kind}:${item.id}` === selected) ?? abilities[0];
  return <details className="player-profile-section ability-rules-panel" data-testid="ability-rules-panel">
    <summary>特质与绝艺数值规则 · 未绑定权威规则 {abilities.filter(item => !abilityMechanicsSummary(item.mechanics)).length} 项</summary>
    <p>文字描述不等于数值效果。已识别规则会直接结算；无法识别的设定请绑定下方规则，不会默默宣称已生效。绑定会替换该项原有权威规则，不修改描述；已封存战斗继续原规则。</p>
    <p>周期按游戏累计时间计算，不在读档时追补历史治疗。战斗中命中最高 99%，最终行动速度最高 220，被动伤害倍率合计最高 ×10；战争战力加成最高 280%。复杂条件、任意属性或新的世界机制仍需扩展引擎，不能只靠文字保证。</p>
    {abilities.map(item => <p key={`${item.kind}:${item.id}`}><strong>{item.name}</strong>：{abilityMechanicsSummary(item.mechanics) ?? '未绑定本地权威规则；标准投影/判定钩子是否有效需查看详情。自定义效果需确认绑定。'}</p>)}
    {current && <fieldset disabled={disabled}>
      <label>设置对象<select aria-label="数值规则对象" value={`${current.kind}:${current.id}`} onChange={event => setSelected(event.target.value)}>{abilities.map(item => <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>{item.name}（{item.kind === 'trait' ? '特质' : '绝艺'}）</option>)}</select></label>
      <label>执行规则<select aria-label="执行规则模板" value={template} onChange={event => setTemplate(event.target.value as AbilityTemplate)}>{ABILITY_RULE_TEMPLATES.filter(([id]) => current.kind === 'art' || id !== 'use_full_hp').map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {template === 'hourly_full_hp' ? <label>游戏分钟<input aria-label="规则周期分钟" type="number" min={1} max={43200} value={interval} onChange={event => setInterval(Number(event.target.value))} /></label>
        : !['use_full_hp', 'perfect_learning'].includes(template) && <label>数值<input aria-label="规则数值" type="number" min={['turn_hp', 'turn_stamina'].includes(template) ? 1 : 0} step={['turn_hp', 'turn_stamina'].includes(template) ? 1 : 0.1} value={value} onChange={event => setValue(Number(event.target.value))} /></label>}
      <button type="button" className="nav-btn" onClick={() => { try { if (current.kind === 'trait' && template === 'use_full_hp') throw new Error('特质不能使用主动施展规则。'); const mechanics = configureAbilityRule(current.id, template, value, interval); setError(''); void onApply(current.id, current.kind, mechanics).catch(reason => setError(String(reason))); } catch (reason) { setError(reason instanceof Error ? reason.message : '规则无效'); } }}>确认绑定数值规则</button>
    </fieldset>}
    {error && <p role="alert">{error}</p>}
    <p>最近实际结算：</p>{(state.abilityRuleExecutions ?? []).slice(-5).reverse().map(trace => <p key={trace.executionId}>{trace.occurredAt} · {trace.summary}</p>)}
  </details>;
}
