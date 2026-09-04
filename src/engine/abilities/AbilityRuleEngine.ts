import type {
  AbilityMechanics,
  AbilityRuleExecutionTrace,
  CharacterTrait,
  CharacterUniqueArt,
  RuntimeState,
} from '../types';
import type { UniqueArtSemanticProfile } from '../encounterV2/EncounterContracts';
import { normalizePlayerVitals } from '../character/PlayerVitals';
import {
  compileTraitAbilityMechanics,
  compileUniqueArtAbilityMechanics,
  validateAbilityMechanics,
} from './AbilityMechanics';

const TRACE_LIMIT = 50;

export interface LearningProgressPolicy {
  multiplier: number;
  minimumProgress: number;
  setToMaxLevel: boolean;
  sourceTraitIds: string[];
}

function executable(mechanics: AbilityMechanics | undefined): mechanics is AbilityMechanics {
  return validateAbilityMechanics(mechanics)
    && mechanics.status === 'executable'
    && mechanics.mode !== 'narrative_only'
    && (mechanics.mode !== 'authoritative' || mechanics.confirmedByPlayer);
}

export function resolveLearningProgressPolicy(traits: readonly CharacterTrait[] | undefined): LearningProgressPolicy {
  let multiplier = 1;
  let minimumProgress = 0;
  let setToMaxLevel = false;
  const sourceTraitIds = new Set<string>();
  for (const trait of traits ?? []) {
    const mechanics = compileTraitAbilityMechanics(trait);
    if (!executable(mechanics)) continue;
    for (const rule of [...mechanics.rules].sort((left, right) => left.priority - right.priority)) {
      if (rule.trigger === 'on_progress_award') {
        for (const effect of rule.effects) {
          if (effect.type === 'multiply_learning_progress') multiplier *= effect.multiplier;
          if (effect.type === 'set_minimum_learning_progress') minimumProgress = Math.max(minimumProgress, effect.value);
        }
        sourceTraitIds.add(trait.id);
      }
      if (rule.trigger === 'on_skill_acquired' && rule.effects.some((effect) => effect.type === 'set_skill_to_max_level')) {
        setToMaxLevel = true;
        sourceTraitIds.add(trait.id);
      }
    }
  }
  return { multiplier: Math.min(1000, multiplier), minimumProgress, setToMaxLevel, sourceTraitIds: [...sourceTraitIds] };
}

export function applyPlayerLearningRulesToNewArts(state: RuntimeState, previousState: RuntimeState): RuntimeState {
  const policy = resolveLearningProgressPolicy(state.player.traits);
  if (!policy.setToMaxLevel) return state;
  const previousIds = new Set((previousState.player.uniqueArts ?? []).map((art) => art.id));
  const newArts = (state.player.uniqueArts ?? []).filter((art) => !previousIds.has(art.id));
  if (newArts.length === 0) return state;
  const next = structuredClone(state);
  const changedNames: string[] = [];
  next.player.uniqueArts = (next.player.uniqueArts ?? []).map((art) => {
    if (previousIds.has(art.id)) return art;
    changedNames.push(art.name);
    const maximum = Math.max(1, Math.min(10, Math.floor(art.maxLevel ?? 10)));
    return { ...art, level: maximum, maxLevel: maximum, progress: 0, bankedProgress: undefined, upgradedAt: state.currentDate };
  });
  appendLatestSummary(next, `玩家权威天赋：${changedNames.join('、')}已完美掌握`);
  return next;
}

function appendLatestSummary(state: RuntimeState, summary: string): void {
  const latest = state.turnLog[state.turnLog.length - 1];
  if (latest) latest.statePatchSummary = [latest.statePatchSummary, summary].filter(Boolean).join('；');
}

function hasCompletedUseOutcome(playerInput: string, narrativeText: string, art: CharacterUniqueArt): boolean {
  const intent = playerInput.normalize('NFKC');
  const narrative = narrativeText.normalize('NFKC');
  const identifiesArt = intent.includes(art.name)
    || intent.includes(art.id)
    || narrative.includes(art.name)
    || narrative.includes(art.id);
  if (!identifiesArt || !/使用|施展|发动|催动|运转|运使|使出|运功/u.test(narrative)) return false;
  const failedUse = /(?:未能|没能|无法|不能|并未|没有)(?:成功)?(?:使用|施展|发动|催动|运转|运使|使出|运功)/u.test(narrative)
    || /(?:使用|施展|发动|催动|运转|运使|使出|运功)(?:[^。！？]{0,16})(?:失败|未成|被打断|遭打断|中断|中止|取消)/u.test(narrative)
    || new RegExp(`${escapeRegExp(art.name)}(?:[^。！？]{0,16})(?:失败|未成|被打断|遭打断|中断|中止|取消)`, 'u').test(narrative);
  return !failedUse;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function settlePlayerAuthoredArtUse(
  state: RuntimeState,
  playerInput: string,
): RuntimeState {
  const latestNarrative = state.turnLog[state.turnLog.length - 1]?.narrativeText ?? '';
  const existingExecutions = state.abilityRuleExecutions ?? [];
  let next: RuntimeState | undefined;
  for (const art of state.player.uniqueArts ?? []) {
    if (!hasCompletedUseOutcome(playerInput, latestNarrative, art)) continue;
    const mechanics = compileUniqueArtAbilityMechanics(art);
    if (!executable(mechanics)) continue;
    for (const rule of mechanics.rules) {
      if (rule.trigger !== 'on_unique_art_use') continue;
      const eventId = `turn:${state.turnLog.length}:art-use:${art.id}`;
      if (existingExecutions.some((entry) => entry.eventId === eventId && entry.ruleId === rule.ruleId)) continue;
      const target = next ?? structuredClone(state);
      const vitals = normalizePlayerVitals(target.player.vitals);
      const before = { hp: vitals.hp, stamina: vitals.stamina };
      let hp = vitals.hp;
      let stamina = vitals.stamina;
      for (const effect of rule.effects) {
        if (effect.type !== 'restore_to_max') continue;
        if (effect.resource === 'hp' && (hp > 0 || effect.allowRevive)) hp = vitals.maxHp;
        if (effect.resource === 'stamina') stamina = vitals.maxStamina;
      }
      target.player.vitals = { ...vitals, hp, stamina };
      const after = { hp, stamina };
      const trace: AbilityRuleExecutionTrace = {
        executionId: `${eventId}:${rule.ruleId}`,
        eventId,
        ruleId: rule.ruleId,
        sourceAbilityId: art.id,
        sourceAbilityName: art.name,
        trigger: rule.trigger,
        status: hp !== before.hp || stamina !== before.stamina ? 'applied' : 'skipped',
        summary: hp !== before.hp || stamina !== before.stamina
          ? `${art.name}按玩家权威规则将${hp !== before.hp ? '生命' : '体力'}恢复至上限`
          : `${art.name}当前无需恢复或不允许复活`,
        before,
        after,
        occurredAt: target.currentDate,
      };
      target.abilityRuleExecutions = [...(target.abilityRuleExecutions ?? []), trace].slice(-TRACE_LIMIT);
      appendLatestSummary(target, trace.summary);
      next = target;
    }
  }
  return next ?? state;
}

export function augmentUniqueArtProjectionWithAuthoredRules(
  art: CharacterUniqueArt,
  profile: UniqueArtSemanticProfile,
): UniqueArtSemanticProfile {
  const mechanics = compileUniqueArtAbilityMechanics(art);
  if (!executable(mechanics) || !profile.rulesetScopes.includes('personal_combat')) return profile;
  const additions = mechanics.rules
    .filter((rule) => rule.trigger === 'on_unique_art_use' && rule.scopes.includes('personal_combat'))
    .flatMap((rule) => rule.effects.flatMap((effect) => effect.type === 'restore_to_max'
      ? [{ trigger: 'on_unique_art_use' as const, condition: 'always' as const, operation: effect.resource === 'hp' ? 'restore_hp_to_max' as const : 'restore_stamina_to_max' as const, target: 'self' as const, value: 0, priority: rule.priority }]
      : []));
  if (additions.length === 0) return profile;
  return {
    ...structuredClone(profile),
    purpose: profile.purpose === 'damage' ? 'mixed' : profile.purpose,
    effects: [...profile.effects.filter((effect) => !additions.some((addition) => addition.operation === effect.operation && addition.trigger === effect.trigger)), ...additions],
  };
}
