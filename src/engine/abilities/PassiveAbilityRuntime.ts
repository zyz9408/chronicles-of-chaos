import type { AbilityRule, RuntimeState } from '../types';
import { tryCreateGameClockFromDateLabel } from '../time/gameClock';
import { normalizePlayerVitals } from '../character/PlayerVitals';
import { compileTraitAbilityMechanics, compileUniqueArtAbilityMechanics, validateAbilityMechanics } from './AbilityMechanics';

function minutes(state: RuntimeState): number | undefined {
  const clock = state.currentTime ?? tryCreateGameClockFromDateLabel(state.currentDate);
  return clock ? (((clock.year * 12 + clock.month - 1) * 30 + clock.day - 1) * 24 + clock.hour) * 60 + clock.minute : undefined;
}

export function applyRecoveryEffects(state: RuntimeState, effects: AbilityRule['effects'], count = 1): void {
  const vitals = normalizePlayerVitals(state.player.vitals);
  for (const effect of effects) {
    if (effect.type !== 'restore_amount' && effect.type !== 'restore_to_max') continue;
    if (vitals.hp <= 0 && !(effect.type === 'restore_to_max' && effect.allowRevive)) continue;
    const maximum = effect.resource === 'hp' ? vitals.maxHp : vitals.maxStamina;
    const value = effect.type === 'restore_to_max' ? maximum : Math.round((effect.percent ? maximum * effect.value / 100 : effect.value) * count);
    vitals[effect.resource] = effect.type === 'restore_to_max' ? maximum : Math.min(maximum, vitals[effect.resource] + value);
  }
  state.player = { ...state.player, vitals };
}

/** Game time, not wall-clock time. No load-time healing or historical replay. */
export function settlePassiveAbilityRules(state: RuntimeState, previous: RuntimeState): RuntimeState {
  const before = minutes(previous); const after = minutes(state);
  if (before === undefined || after === undefined || after <= before) return state;
  const sources = [
    ...(state.player.traits ?? []).map(trait => ({ id: trait.id, name: trait.label, mechanics: compileTraitAbilityMechanics(trait), existed: previous.player.traits?.some(old => old.id === trait.id) })),
    ...(state.player.uniqueArts ?? []).map(art => ({ id: art.id, name: art.name, mechanics: compileUniqueArtAbilityMechanics(art), existed: previous.player.uniqueArts?.some(old => old.id === art.id) })),
  ];
  let next: RuntimeState | undefined;
  for (const source of sources) {
    const mechanics = source.mechanics;
    if (!validateAbilityMechanics(mechanics) || mechanics.status !== 'executable' || mechanics.mode === 'narrative_only') continue;
    for (const rule of mechanics.rules.filter(rule => rule.scopes.includes('runtime_turn') && ['on_time_elapsed', 'after_runtime_turn'].includes(rule.trigger))) {
      const key = `${source.id}:${rule.ruleId}`;
      const stored = (next ?? state).abilityRuleTimers?.[key];
      if (stored?.lastProcessedMinute === after && stored.checksum === mechanics.checksum) continue;
      const valid = stored?.checksum === mechanics.checksum && Number.isFinite(stored.lastProcessedMinute) && stored.lastProcessedMinute <= before
        && Number.isFinite(stored.remainderMinutes) && stored.remainderMinutes >= 0 && stored.remainderMinutes < (rule.intervalMinutes ?? 1);
      const elapsed = source.existed ? after - before : 0;
      const accumulated = (valid ? stored!.remainderMinutes : 0) + elapsed;
      const count = rule.trigger === 'on_time_elapsed' ? Math.floor(accumulated / rule.intervalMinutes!) : Number(elapsed > 0);
      const target = next ?? structuredClone(state);
      target.abilityRuleTimers = { ...target.abilityRuleTimers, [key]: { checksum: mechanics.checksum, lastProcessedMinute: after, remainderMinutes: rule.trigger === 'on_time_elapsed' ? accumulated % rule.intervalMinutes! : 0 } };
      next = target;
      if (!count) continue;
      const oldVitals = normalizePlayerVitals(target.player.vitals);
      applyRecoveryEffects(target, rule.effects, count);
      const newVitals = target.player.vitals!;
      const hp = newVitals.hp - oldVitals.hp; const stamina = newVitals.stamina - oldVitals.stamina;
      const summary = `${source.name}：${hp || stamina ? `生命 +${hp}，体力 +${stamina}` : '规则已检查，无需恢复或不允许复活'}`;
      const eventId = `passive:${before}:${after}:${target.turnLog.length}`;
      target.abilityRuleExecutions = [...(target.abilityRuleExecutions ?? []), { executionId: `${eventId}:${key}`, eventId, ruleId: rule.ruleId, sourceAbilityId: source.id, sourceAbilityName: source.name, trigger: rule.trigger, status: hp || stamina ? 'applied' as const : 'skipped' as const, summary, before: { hp: oldVitals.hp, stamina: oldVitals.stamina }, after: { hp: newVitals.hp, stamina: newVitals.stamina }, occurredAt: state.currentDate }].slice(-50);
      const latest = target.turnLog[target.turnLog.length - 1];
      if (latest && (hp || stamina)) latest.statePatchSummary = [latest.statePatchSummary, summary].filter(Boolean).join('；');
    }
  }
  return next ?? state;
}
