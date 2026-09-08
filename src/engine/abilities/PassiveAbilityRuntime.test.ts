import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { settlePassiveAbilityRules } from './PassiveAbilityRuntime';
import { compileTraitAbilityMechanics, abilityMechanicsSummary } from './AbilityMechanics';
import { configureAbilityRule } from './AbilityRuleTemplates';
import { createCombatEncounterSnapshot } from '../encounterV2/CombatSnapshotAdapter';
import { makeCombatIntent, makeCombatantSource, bundle } from '../encounterV2/CombatTestFixtures';
import { calculateV22NormalAttackDamage } from '../encounterV2/CombatRules';
import { createCombatEngineState, executeCombatAction } from '../encounterV2/CombatEngine';
import { createInitialWarState, executeWarRound } from '../encounterV2/WarEngine';
import { createValidatedWarProjectionBundle, createWarEncounterSnapshot } from '../encounterV2/WarSnapshotAdapter';
import { makeWarIntent, makeWarCommander, makeWarTroop, makeTroopProfile } from '../encounterV2/WarTestFixtures';

const trait = { id: 'trait_fast_heal', label: '快速自愈', description: '继承了前世被实验时留下的治愈能力，当生命值不满时，每小时自动恢复满。', source: 'custom' };
function state(minute = 0): RuntimeState {
  return { currentDate: '公元184年03月02日', currentTime: { year: 184, month: 3, day: 2, hour: 7 + Math.floor(minute / 60), minute: minute % 60 }, player: { id: 'hero', vitals: { hp: 60, maxHp: 100, stamina: 98, maxStamina: 100 }, traits: [{ ...trait }], uniqueArts: [] }, turnLog: [{ turnNumber: 27, narrativeText: '恢复完美，但正文不能改变数值。', statePatchSummary: '' }] } as unknown as RuntimeState;
}
describe('authored passive rules and numeric contracts', () => {
  it('compiles the actual reported old-save trait and heals across split turns after a save reload', () => {
    expect(abilityMechanicsSummary(compileTraitAbilityMechanics(trait))).toContain('每累计 60 游戏分钟生命恢复至上限');
    let previous = state();
    for (const minute of [15, 30, 45, 60]) {
      const after = { ...structuredClone(previous), currentTime: state(minute).currentTime };
      const next = settlePassiveAbilityRules(after, previous);
      expect(next.player.vitals!.hp).toBe(minute < 60 ? 60 : 100);
      previous = JSON.parse(JSON.stringify(next));
    }
    expect(previous.abilityRuleExecutions).toHaveLength(1);
    expect(settlePassiveAbilityRules(previous, state(45))).toBe(previous);
    expect(settlePassiveAbilityRules(previous, previous)).toBe(previous);
  });
  it('does not heal on load, backdated time, newly acquired traits, failed turns or dead players', () => {
    const before = state();
    expect(settlePassiveAbilityRules(before, before)).toBe(before);
    expect(settlePassiveAbilityRules(before, state(60))).toBe(before);
    expect(settlePassiveAbilityRules(state(60), { ...before, player: { ...before.player, traits: [] } }).player.vitals!.hp).toBe(60);
    const dead = state(60); dead.player.vitals!.hp = 0;
    expect(settlePassiveAbilityRules(dead, before).player.vitals!.hp).toBe(0);
  });
  it('honors exact flat recovery and keeps configured skill numbers independent of rarity and level', () => {
    const before = state(); before.player.traits![0].mechanics = configureAbilityRule(trait.id, 'turn_hp', 35);
    const next = { ...structuredClone(before), currentTime: state(1).currentTime };
    expect(settlePassiveAbilityRules(next, before).player.vitals!.hp).toBe(95);
    const snapshot = createCombatEncounterSnapshot({ sessionId: 'test', intent: makeCombatIntent(['hero'], ['enemy']), playerSources: [makeCombatantSource('hero', { traits: [{ ...trait, mechanics: configureAbilityRule(trait.id, 'damage', 2) }] })], enemySources: [makeCombatantSource('enemy')], projections: bundle(), threatTier: 'standard', lootableItemIds: [], capturableEquipmentItemIds: [] });
    expect(snapshot.combatants[0].traitProfiles[0].effects[0]).toMatchObject({ operation: 'modify_damage_multiplier', value: 2 });
  });
  it('rejects numeric overflow and verifies a hand-calculated unarmored hit', () => {
    expect(() => configureAbilityRule('trait_rule', 'hourly_full_hp', 2, 0)).toThrow();
    expect(() => configureAbilityRule('trait_rule', 'damage', Infinity)).toThrow();
    expect(calculateV22NormalAttackDamage({ weaponBaseDamage: 5, attackerMartial: 100, defenderMartial: 40, flatDamage: 0, randomVariance: 0, critical: false, blocked: false, defenderWasDefending: false, armorTier: 0, multiplier: 1 })).toBe(71);
    expect(compileTraitAbilityMechanics({ ...trait, description: '每小时生命恢复满；伤害×2；命中+15' })?.rules).toHaveLength(3);
  });
  it('applies a configured damage multiplier to actual normal attacks, not just the tooltip', () => {
    const strike = (boost: boolean) => {
      const intent = { ...makeCombatIntent(['hero'], ['enemy']), seed: 'authored-damage-test' };
      const snapshot = createCombatEncounterSnapshot({ sessionId: 'test', intent, playerSources: [makeCombatantSource('hero', { abilityScores: { 武力: 100 }, traits: boost ? [{ ...trait, mechanics: configureAbilityRule(trait.id, 'damage', 2) }] : [] })], enemySources: [makeCombatantSource('enemy')], projections: bundle(), threatTier: 'standard', lootableItemIds: [], capturableEquipmentItemIds: [] });
      const initial = { ...createCombatEngineState(snapshot), phase: 'awaiting_action' as const, currentActorId: 'hero' };
      return Number(executeCombatAction(initial, { type: 'normal_attack', actorId: 'hero', targetId: 'enemy' }).actionLog[0].values?.damage);
    };
    expect(strike(false)).toBeGreaterThan(0);
    expect(strike(true)).toBeGreaterThanOrEqual(strike(false) * 2 - 1);
  });
  it('keeps an authored +100% war power rule at +100%, not the ordinary 30% trait cap', () => {
    const round = (boost: boolean) => {
      const snapshot = createWarEncounterSnapshot({ sessionId: 'war-authored', intent: makeWarIntent(['own'], ['foe']), playerTroops: [makeWarTroop('own')], enemyTroops: [makeWarTroop('foe')], playerCommander: makeWarCommander('player_liuping', { traits: boost ? [{ ...trait, mechanics: configureAbilityRule(trait.id, 'war', 100) }] : [], uniqueArts: [] }), enemyCommander: makeWarCommander('npc_enemy_commander', { traits: [], uniqueArts: [] }), projections: createValidatedWarProjectionBundle([makeTroopProfile('own'), makeTroopProfile('foe')]) });
      return executeWarRound(createInitialWarState(snapshot), { player: { type: 'tactic', tactic: 'steady_advance' }, enemy: { type: 'tactic', tactic: 'steady_advance' } }).actionLog[0].values;
    };
    expect(Number(round(true).playerEffective)).toBeCloseTo(Number(round(false).playerEffective) * 2, -1);
  });
});
