import { describe, expect, it } from 'vitest';
import {
  calculateWarCasualtyRate,
  calculateWarCommanderScore,
  calculateWarEffectiveStrength,
  compareWarTactics,
  normalizeWarFatigue,
  normalizeWarQuality,
  normalizeWarReadiness,
  normalizeWarSupply,
  resolveWarTacticCoefficients,
  resolveWarRoundLimitOutcome,
  troopEnvironmentFactor,
} from './WarRules';

describe('WarRules', () => {
  it('normalizes structured troop fields without reading troop names or prose', () => {
    expect(normalizeWarQuality('精锐')).toBe(125);
    expect(normalizeWarQuality(undefined)).toBe(100);
    expect(normalizeWarReadiness('高')).toBe(90);
    expect(normalizeWarFatigue('极高')).toBe(85);
    expect(normalizeWarSupply(140)).toEqual({ value: 100, known: true, source: 'numeric' });
    expect(normalizeWarSupply('粮草两日')).toEqual({ value: 35, known: true, source: 'duration' });
    expect(normalizeWarSupply('口粮不足')).toEqual({ value: 30, known: true, source: 'status' });
    expect(normalizeWarSupply('不明')).toEqual({ value: 50, known: false, source: 'unknown' });
  });

  it('uses the approved commander weights with leadership dominant', () => {
    const leadership = calculateWarCommanderScore({
      leadership: 80, intelligence: 50, martial: 50, charm: 50, politics: 50,
    });
    const martial = calculateWarCommanderScore({
      leadership: 50, intelligence: 50, martial: 80, charm: 50, politics: 50,
    });

    expect(leadership).toBe(65);
    expect(martial).toBe(54.5);
    expect(leadership).toBeGreaterThan(martial);
  });

  it('locks the four tactic coefficients and rock-paper-scissors relation', () => {
    expect(resolveWarTacticCoefficients('steady_advance', { environmentTags: ['open'], mobileShare: 0 })).toEqual({
      offense: 1,
      exposure: 1,
      fatigueCost: 5,
      supplyCost: 4,
    });
    expect(resolveWarTacticCoefficients('all_out_assault', { environmentTags: ['open'], mobileShare: 0 })).toEqual({
      offense: 1.3,
      exposure: 1.25,
      fatigueCost: 10,
      supplyCost: 8,
    });
    expect(resolveWarTacticCoefficients('hold_position', { environmentTags: ['open'], mobileShare: 0 })).toEqual({
      offense: 0.75,
      exposure: 0.65,
      fatigueCost: 3,
      supplyCost: 3,
    });
    expect(resolveWarTacticCoefficients('flank', { environmentTags: ['open'], mobileShare: 0.6 })).toMatchObject({
      offense: 1.3,
      exposure: 0.85,
    });
    expect(resolveWarTacticCoefficients('flank', { environmentTags: ['fortified'], mobileShare: 0.1 })).toMatchObject({
      offense: 0.75,
      exposure: 1.25,
    });

    expect(compareWarTactics('all_out_assault', 'flank')).toEqual({ playerModifier: 1.15, enemyModifier: 0.85, winner: 'player' });
    expect(compareWarTactics('flank', 'hold_position')).toEqual({ playerModifier: 1.15, enemyModifier: 0.85, winner: 'player' });
    expect(compareWarTactics('hold_position', 'all_out_assault')).toEqual({ playerModifier: 1.15, enemyModifier: 0.85, winner: 'player' });
    expect(compareWarTactics('steady_advance', 'all_out_assault')).toEqual({ playerModifier: 1, enemyModifier: 1 });
  });

  it('gives naval forces the water edge and cavalry the open-field edge from explicit profiles', () => {
    const navalOnWater = troopEnvironmentFactor({
      primaryClass: 'naval', tags: [], environmentTags: ['water'], enemyPrimaryClasses: ['infantry'], tactic: 'steady_advance',
    });
    const cavalryOnWater = troopEnvironmentFactor({
      primaryClass: 'cavalry', tags: [], environmentTags: ['water'], enemyPrimaryClasses: ['naval'], tactic: 'steady_advance',
    });
    const cavalryOnOpen = troopEnvironmentFactor({
      primaryClass: 'cavalry', tags: ['mobile'], environmentTags: ['open'], enemyPrimaryClasses: ['infantry'], tactic: 'flank',
    });
    const infantryOnOpen = troopEnvironmentFactor({
      primaryClass: 'infantry', tags: [], environmentTags: ['open'], enemyPrimaryClasses: ['cavalry'], tactic: 'flank',
    });

    expect(navalOnWater).toBeGreaterThan(cavalryOnWater);
    expect(cavalryOnOpen).toBeGreaterThan(infantryOnOpen);
  });

  it('clamps effective strength inputs and per-round casualties to 0.5%-8%', () => {
    const effective = calculateWarEffectiveStrength({
      strength: 1_000,
      training: 100,
      morale: 100,
      quality: 125,
      readiness: 100,
      supply: 100,
      fatigue: 0,
      commanderScore: 100,
      environmentFactor: 1.5,
      tacticFactor: 1.3,
      semanticModifierPercent: 30,
    });
    expect(Number.isFinite(effective)).toBe(true);
    expect(effective).toBeGreaterThan(1_000);

    expect(calculateWarCasualtyRate({
      enemyEffectiveStrength: 1,
      ownEffectiveStrength: 100_000,
      enemyOffense: 0.75,
      ownExposure: 0.65,
      perturbation: 0.95,
      semanticModifierPercent: -30,
    })).toBe(0.005);
    expect(calculateWarCasualtyRate({
      enemyEffectiveStrength: 100_000,
      ownEffectiveStrength: 1,
      enemyOffense: 1.3,
      ownExposure: 1.25,
      perturbation: 1.05,
      semanticModifierPercent: 30,
    })).toBe(0.08);
  });

  it('settles only a clear 20 percent round-limit advantage', () => {
    expect(resolveWarRoundLimitOutcome({
      playerEffectiveStrength: 119,
      enemyEffectiveStrength: 100,
    })).toBe('draw');
    expect(resolveWarRoundLimitOutcome({
      playerEffectiveStrength: 120,
      enemyEffectiveStrength: 100,
    })).toBe('player_victory');
    expect(resolveWarRoundLimitOutcome({
      playerEffectiveStrength: 100,
      enemyEffectiveStrength: 120,
    })).toBe('enemy_victory');
  });
});
