import { describe, expect, it } from 'vitest';
import type { CharacterTrait, CharacterUniqueArt, RuntimeState } from '../types';
import { applyUniqueArtProgressEvidence } from '../character/UniqueArtProgression';
import { compileTraitAbilityMechanics, compileUniqueArtAbilityMechanics } from './AbilityMechanics';
import {
  applyPlayerLearningRulesToNewArts,
  resolveLearningProgressPolicy,
  settlePlayerAuthoredArtUse,
} from './AbilityRuleEngine';

function art(overrides: Partial<CharacterUniqueArt> = {}): CharacterUniqueArt {
  const base: CharacterUniqueArt = {
    id: 'art_full_heal', name: '万象回春', rarity: 'red', domain: 'personalCombat', level: 1, maxLevel: 10,
    description: '医道绝学。', effectSummary: '每次使用必定恢复所有生命。', source: 'opening', progress: 0,
  };
  return { ...base, mechanics: compileUniqueArtAbilityMechanics(base), ...overrides };
}

function trait(): CharacterTrait {
  const base: CharacterTrait = { id: 'custom_trait_perfect_learning', label: '天生圣人', description: '快速完美学习任何技能。', source: 'custom' };
  return { ...base, mechanics: compileTraitAbilityMechanics(base) };
}

function state(arts: CharacterUniqueArt[] = [art()]): RuntimeState {
  return {
    engineVersion: '0.1.0', worldBookId: 'threeKingdoms', worldBookVersion: '1', worldBookSource: 'official',
    startDate: '公元184年03月01日', currentDate: '公元184年03月02日', currentLocationId: 'loc',
    player: { id: 'player_1', name: '刘平', roleType: '游侠', summary: '', vitals: { hp: 3, maxHp: 100, stamina: 50, maxStamina: 100 }, traits: [trait()], uniqueArts: arts },
    knownActors: [], knownFactions: [], relationships: [], knownRumors: [], activeQuests: [], playerResources: {}, worldStateDelta: {}, localSituationNotes: [],
    turnLog: [{ turnNumber: 1, date: '公元184年03月02日', playerInput: '施展万象回春', narrativeText: '刘平施展万象回春。', statePatchSummary: '', timestamp: '2026-01-01' }],
  };
}

describe('AbilityRuleEngine', () => {
  it('restores all current maximum hp and records an idempotent trace', () => {
    const first = settlePlayerAuthoredArtUse(state(), '我施展万象回春');
    expect(first.player.vitals).toMatchObject({ hp: 100, maxHp: 100 });
    expect(first.abilityRuleExecutions).toHaveLength(1);
    const replay = settlePlayerAuthoredArtUse(first, '我施展万象回春');
    expect(replay.abilityRuleExecutions).toHaveLength(1);
  });

  it('does not trigger an on-use rule when the final narrative says the use failed', () => {
    const input = state();
    const latest = input.turnLog[input.turnLog.length - 1];
    latest.narrativeText = '刘平伤势太重，未能施展万象回春。';

    const result = settlePlayerAuthoredArtUse(input, '我施展万象回春');

    expect(result.player.vitals).toMatchObject({ hp: 3, maxHp: 100 });
    expect(result.abilityRuleExecutions).toBeUndefined();
  });

  it('does not trigger an on-use rule when the named art was interrupted', () => {
    const input = state();
    const latest = input.turnLog[input.turnLog.length - 1];
    latest.narrativeText = '刘平正要施展万象回春，却在成招前被打断。';

    const result = settlePlayerAuthoredArtUse(input, '我施展万象回春');

    expect(result.player.vitals).toMatchObject({ hp: 3, maxHp: 100 });
    expect(result.abilityRuleExecutions).toBeUndefined();
  });

  it('turns perfect learning into a deterministic maximum-level progress settlement', () => {
    const policy = resolveLearningProgressPolicy([trait()]);
    const result = applyUniqueArtProgressEvidence(art({ effectSummary: '普通招式。', mechanics: undefined }), {
      eventId: 'event-1', source: 'instruction_or_manual', intensity: 'minor', occurredAt: '公元184年03月02日', sourceRefId: 'manual-1', summary: '完成研习。',
    }, '1:date', policy);
    expect(result.art).toMatchObject({ level: 10, progress: 0 });
    expect(result.art.progressHistory?.[0].awardedProgress).toBe(900);
  });

  it('raises newly acquired arts to their declared maximum without changing old arts', () => {
    const oldArt = art({ id: 'art_old', name: '旧艺', effectSummary: '普通招式。', mechanics: undefined, level: 2 });
    const newArt = art({ id: 'art_new', name: '新艺', effectSummary: '普通招式。', mechanics: undefined, level: 1, maxLevel: 7 });
    const previous = state([oldArt]);
    const current = state([oldArt, newArt]);
    const result = applyPlayerLearningRulesToNewArts(current, previous);
    expect(result.player.uniqueArts?.find((entry) => entry.id === 'art_old')?.level).toBe(2);
    expect(result.player.uniqueArts?.find((entry) => entry.id === 'art_new')).toMatchObject({ level: 7, progress: 0 });
  });
});
