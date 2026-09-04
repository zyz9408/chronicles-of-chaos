import { describe, expect, it } from 'vitest';
import type { CharacterTrait, CharacterUniqueArt } from '../types';
import {
  abilityMechanicsSummary,
  compileTraitAbilityMechanics,
  compileUniqueArtAbilityMechanics,
  validateAbilityMechanics,
} from './AbilityMechanics';

describe('AbilityMechanics compiler', () => {
  it('compiles an explicit full-heal-on-use promise into an authoritative rule', () => {
    const art: CharacterUniqueArt = {
      id: 'art_full_heal', name: '万象回春', rarity: 'red', domain: 'personalCombat', level: 1,
      description: '医道绝学。', effectSummary: '每次使用必定恢复所有生命。', source: 'opening',
    };
    const mechanics = compileUniqueArtAbilityMechanics(art);
    expect(mechanics).toMatchObject({ schemaVersion: 2, mode: 'authoritative', status: 'executable', confirmedByPlayer: true });
    expect(mechanics?.rules[0]).toMatchObject({ trigger: 'on_unique_art_use', effects: [{ type: 'restore_to_max', resource: 'hp' }] });
    expect(abilityMechanicsSummary(mechanics)).toContain('生命恢复至上限');
    if (!mechanics) throw new Error('mechanics missing');
    const unconfirmed = { ...mechanics, confirmedByPlayer: false };
    expect(validateAbilityMechanics(unconfirmed)).toBe(false);
    mechanics.rules[0].effects = [{ type: 'restore_to_max', resource: 'stamina', target: 'self' }];
    expect(validateAbilityMechanics(mechanics)).toBe(false);
  });

  it('compiles perfect rapid learning into progress and acquisition rules', () => {
    const trait: CharacterTrait = {
      id: 'custom_trait_perfect_learning', label: '天生圣人',
      description: '能够快速完美学习并掌握任何技能。', source: 'custom',
    };
    const mechanics = compileTraitAbilityMechanics(trait);
    expect(mechanics?.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: 'on_progress_award' }),
      expect.objectContaining({ trigger: 'on_skill_acquired', effects: [{ type: 'set_skill_to_max_level' }] }),
    ]));
    expect(abilityMechanicsSummary(mechanics)).toContain('学习进度 ×5');
    expect(abilityMechanicsSummary(mechanics)).toContain('最高等级');
  });

  it('does not invent mechanics for ambiguous prose', () => {
    expect(compileTraitAbilityMechanics({ id: 'trait_clever', label: '聪慧', description: '善于思考。', source: 'custom' })).toBeUndefined();
  });
});
