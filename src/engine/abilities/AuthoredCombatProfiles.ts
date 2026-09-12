import type { CharacterTrait, CharacterUniqueArt } from '../types';
import type { SemanticEffect, SemanticProjection, UniqueArtSemanticProfile } from '../encounterV2/EncounterContracts';
import { createCompatibilityPersonalCombatArtProjection } from '../encounterV2/UniqueArtProjectionRuntime';
import { canonicalStringify } from '../encounterV2/EncounterDeterminism';
import { compileTraitAbilityMechanics, compileUniqueArtAbilityMechanics, validateAbilityMechanics } from './AbilityMechanics';

export function installAuthoredCombatProfiles(profiles: Map<string, SemanticProjection>, sources: Array<{ traits?: CharacterTrait[]; uniqueArts?: CharacterUniqueArt[]; vitals?: { maxHp?: number; maxStamina?: number } }>): void {
  for (const source of sources) for (const ability of [...(source.traits ?? []), ...(source.uniqueArts ?? [])]) {
    const art = 'effectSummary' in ability;
    const mechanics = art ? compileUniqueArtAbilityMechanics(ability) : compileTraitAbilityMechanics(ability);
    if (!validateAbilityMechanics(mechanics) || mechanics.status !== 'executable' || mechanics.mode === 'narrative_only') continue;
    const effects: SemanticEffect[] = [];
    const scopes = new Set<'personal_combat' | 'war'>();
    for (const rule of mechanics.rules) {
      for (const effect of rule.effects) {
        const common = { condition: 'always' as const, priority: rule.priority, stackingGroup: `authored:${ability.id}` };
        if (effect.type === 'numeric_modifier' && rule.trigger === 'passive_modifier') {
          const war = effect.metric === 'warPowerPercent';
          if (!rule.scopes.includes(war ? 'war' : 'personal_combat')) continue;
          scopes.add(war ? 'war' : 'personal_combat');
          const operations = { damageMultiplier: 'modify_damage_multiplier', accuracy: 'modify_accuracy', block: 'modify_block', speed: 'modify_speed', warPowerPercent: 'modify_effective_strength' } as const;
          effects.push({ ...common, trigger: war ? 'before_war_resolution' : effect.metric === 'speed' ? 'battle_start' : 'before_attack', operation: operations[effect.metric], target: war ? 'own_force' : 'self', value: effect.value });
        }
        if (rule.scopes.includes('personal_combat') && ['on_unique_art_use', 'after_runtime_turn'].includes(rule.trigger) && (effect.type === 'restore_amount' || effect.type === 'restore_to_max')) {
          scopes.add('personal_combat');
          const maximum = effect.resource === 'hp' ? source.vitals?.maxHp : source.vitals?.maxStamina;
          const value = effect.type === 'restore_amount' ? effect.percent
            ? Math.round(effect.value * (Number.isFinite(maximum) ? Math.max(1, Math.min(100000, maximum!)) : 100) / 100)
            : effect.value : 0;
          effects.push({ ...common, trigger: rule.trigger === 'on_unique_art_use' ? 'on_unique_art_use' : 'round_start', operation: effect.type === 'restore_to_max' ? effect.resource === 'hp' ? 'restore_hp_to_max' : 'restore_stamina_to_max' : effect.resource === 'hp' ? 'restore_hp' : 'restore_stamina', target: 'self', value });
        }
      }
    }
    if (!effects.length) { profiles.delete(ability.id); continue; }
    const active = mechanics.rules.some(rule => rule.trigger === 'on_unique_art_use');
    const passive = effects.some(effect => effect.trigger !== 'on_unique_art_use');
    if (art) {
      const previous = profiles.get(ability.id);
      const base = previous?.profileKind === 'ability' && previous.sourceType === 'unique_art' ? previous : createCompatibilityPersonalCombatArtProjection(ability);
      const synthetic = canonicalStringify(base) === canonicalStringify(createCompatibilityPersonalCombatArtProjection(ability));
      const preserveAttack = Boolean(previous) && !synthetic && active && !mechanics.compiledFrom.startsWith('玩家手动确认模板:') && (base.purpose === 'damage' || base.purpose === 'mixed');
      const profile: UniqueArtSemanticProfile = { ...base, status: 'executable', activation: active ? passive ? 'hybrid' : 'active' : 'passive', rulesetScopes: [...new Set([...scopes, ...(preserveAttack ? base.rulesetScopes : [])])], targetMode: preserveAttack ? base.targetMode : 'self', purpose: preserveAttack ? 'mixed' : 'healing', staminaCost: preserveAttack ? base.staminaCost : 0, effects: preserveAttack ? [...base.effects.filter(old => !effects.some(effect => effect.trigger === old.trigger && effect.operation === old.operation)), ...effects] : effects, allowAutoUse: active };
      profiles.set(ability.id, profile);
    } else profiles.set(ability.id, { profileKind: 'ability', projectionVersion: 1, sourceType: 'trait', sourceId: ability.id, status: 'executable', activation: 'passive', rulesetScopes: [...scopes], effects });
  }
}
