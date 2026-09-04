import { describe, expect, it } from 'vitest';
import {
  calculateWarCasualtyRate,
  calculateWarCommanderFactor,
  calculateWarV24CommanderFactor,
  calculateWarCommanderScore,
  calculateWarEffectiveStrength,
  compareWarTactics,
  normalizeWarFatigue,
  normalizeWarQuality,
  normalizeWarReadiness,
  normalizeWarSupply,
  calculateWarShockMoralePenalty,
  calculateWarIntelligenceTacticFactor,
  calculateWarMartialPressureFactor,
  resolveWarEngagedStrengths,
  resolveWarTacticCoefficients,
  resolveWarRoundLimitOutcome,
  troopEnvironmentFactor,
  troopMatchupFactor,
  warMoraleCasualtyExposure,
  warMoraleFactor,
} from './WarRules';

describe('WarRules', () => {
  type MatchupProfile = Parameters<typeof troopMatchupFactor>[0]['attacker'];
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

  it('applies the War V2.5 leadership curve with a 20 percent neutral-baseline contraction', () => {
    expect(calculateWarCommanderFactor({ commanderPresent: false })).toBe(0.56);
    expect(calculateWarCommanderFactor({ commanderPresent: true, leadershipKnown: false })).toBe(0.68);
    expect(calculateWarCommanderFactor({ commanderPresent: true, leadershipKnown: true, leadership: 50 })).toBe(1);
    expect(calculateWarCommanderFactor({ commanderPresent: true, leadershipKnown: true, leadership: 70 })).toBe(1.56);
    expect(calculateWarCommanderFactor({ commanderPresent: true, leadershipKnown: true, leadership: 80 })).toBe(1.92);
    expect(calculateWarCommanderFactor({ commanderPresent: true, leadershipKnown: true, leadership: 90 })).toBe(2.4);
    expect(calculateWarCommanderFactor({ commanderPresent: true, leadershipKnown: true, leadership: 100 })).toBe(3.08);
    expect(calculateWarCommanderFactor({ commanderPresent: true, leadershipKnown: true, leadership: 90 }) - 1)
      .toBeCloseTo((calculateWarV24CommanderFactor({
        commanderPresent: true,
        leadershipKnown: true,
        leadership: 90,
      }) - 1) * 0.8, 6);
    expect(calculateWarV24CommanderFactor({
      commanderPresent: true,
      leadershipKnown: true,
      leadership: 90,
    })).toBe(2.75);
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

  it('gives War V2.6 intelligence bounded tactical leverage', () => {
    expect(calculateWarIntelligenceTacticFactor({
      ownIntelligence: 70, enemyIntelligence: 50, tactic: 'flank',
    })).toBe(1.08);
    expect(calculateWarIntelligenceTacticFactor({
      ownIntelligence: 90, enemyIntelligence: 50, tactic: 'steady_advance',
    })).toBe(1.08);
    expect(calculateWarIntelligenceTacticFactor({
      ownIntelligence: 100, enemyIntelligence: 0, tactic: 'all_out_assault',
    })).toBe(1.16);
  });

  it('gives War V2.6 martial pressure only to aggressive orders', () => {
    expect(calculateWarMartialPressureFactor({
      ownMartial: 90, enemyMartial: 50, tactic: 'all_out_assault',
    })).toBe(1.10);
    expect(calculateWarMartialPressureFactor({
      ownMartial: 90, enemyMartial: 50, tactic: 'flank',
    })).toBe(1.10);
    expect(calculateWarMartialPressureFactor({
      ownMartial: 90, enemyMartial: 50, tactic: 'hold_position',
    })).toBe(1);
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

  it('lets legendary command overcome four-to-one uncommanded numbers without erasing organized resistance', () => {
    const base = {
      training: 60,
      morale: 60,
      quality: 100,
      readiness: 70,
      supply: 70,
      fatigue: 15,
      commanderScore: 50,
      environmentFactor: 1,
      tacticFactor: 1,
      semanticModifierPercent: 0,
    };
    for (let index = 0; index < 1_000; index += 1) {
      const low = calculateWarEffectiveStrength({
        ...base,
        strength: 200,
        commanderFactor: calculateWarCommanderFactor({
          commanderPresent: true,
          leadershipKnown: true,
          leadership: 50,
        }),
      });
      const high = calculateWarEffectiveStrength({
        ...base,
        strength: 200,
        commanderFactor: calculateWarCommanderFactor({
          commanderPresent: true,
          leadershipKnown: true,
          leadership: 90,
        }),
      });
      expect(high).toBeGreaterThan(low);
    }
    const eliteCommanded200 = calculateWarEffectiveStrength({
      ...base,
      strength: 200,
      commanderFactor: calculateWarCommanderFactor({
        commanderPresent: true,
        leadershipKnown: true,
        leadership: 90,
      }),
    });
    const uncommanded800 = calculateWarEffectiveStrength({
      ...base,
      strength: 800,
      commanderFactor: calculateWarCommanderFactor({ commanderPresent: false }),
    });
    const ordinarilyCommanded800 = calculateWarEffectiveStrength({
      ...base,
      strength: 800,
      commanderFactor: calculateWarCommanderFactor({
        commanderPresent: true,
        leadershipKnown: true,
        leadership: 50,
      }),
    });
    expect(eliteCommanded200).toBeGreaterThan(uncommanded800);
    expect(eliteCommanded200).toBeLessThan(ordinarilyCommanded800);
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

  it('makes morale a nonlinear combat resource instead of a cosmetic label', () => {
    expect(warMoraleFactor(90)).toBeGreaterThan(warMoraleFactor(60));
    expect(warMoraleFactor(60)).toBeGreaterThan(warMoraleFactor(30));
    expect(warMoraleFactor(30)).toBeGreaterThan(warMoraleFactor(10));
    expect(warMoraleCasualtyExposure(10)).toBeGreaterThan(warMoraleCasualtyExposure(60));
  });

  it('gives explicit strong counters enough weight to matter before raw troop count', () => {
    const heavyCavalry: MatchupProfile = { primaryClass: 'cavalry', tags: ['heavy', 'mobile', 'assault'] };
    const looseArchers: MatchupProfile = { primaryClass: 'ranged', tags: [] };
    const antiCavalry: MatchupProfile = { primaryClass: 'infantry', tags: ['anti_cavalry', 'defensive'] };
    const cavalryIntoArchers = troopMatchupFactor({
      attacker: heavyCavalry,
      defender: looseArchers,
      environmentTags: ['open'],
      attackerTactic: 'all_out_assault',
      defenderTactic: 'steady_advance',
    });
    const cavalryIntoPreparedSpears = troopMatchupFactor({
      attacker: heavyCavalry,
      defender: antiCavalry,
      environmentTags: ['open'],
      attackerTactic: 'all_out_assault',
      defenderTactic: 'hold_position',
    });
    const preparedSpearsIntoCavalry = troopMatchupFactor({
      attacker: antiCavalry,
      defender: heavyCavalry,
      environmentTags: ['open'],
      attackerTactic: 'hold_position',
      defenderTactic: 'all_out_assault',
    });

    expect(cavalryIntoArchers).toBe(2.2);
    expect(cavalryIntoPreparedSpears).toBeLessThan(0.7);
    expect(preparedSpearsIntoCavalry).toBeGreaterThanOrEqual(1.7);
  });

  it('weights mixed troop composition instead of collapsing it to a single guessed class', () => {
    const mixed: MatchupProfile = {
      primaryClass: 'mixed',
      tags: [],
      composition: [
        { primaryClass: 'cavalry', sharePercent: 40, tags: ['heavy', 'mobile'] },
        { primaryClass: 'infantry', sharePercent: 60, tags: ['anti_cavalry'] },
      ],
    };
    const ranged: MatchupProfile = { primaryClass: 'ranged', tags: [] };
    const factor = troopMatchupFactor({
      attacker: mixed,
      defender: ranged,
      environmentTags: ['open'],
      attackerTactic: 'steady_advance',
      defenderTactic: 'steady_advance',
    });

    expect(factor).toBeGreaterThan(1.15);
    expect(factor).toBeLessThan(2.2);
  });

  it('compresses extreme numerical superiority into the troops that can actually engage', () => {
    const ordinary = resolveWarEngagedStrengths({
      playerRawStrength: 10_000,
      enemyRawStrength: 1_000,
      playerCoordination: 50,
      enemyCoordination: 50,
    });
    const coordinated = resolveWarEngagedStrengths({
      playerRawStrength: 10_000,
      enemyRawStrength: 1_000,
      playerCoordination: 90,
      enemyCoordination: 50,
    });

    expect(ordinary.player / ordinary.enemy).toBeLessThan(4);
    expect(coordinated.player).toBeGreaterThan(ordinary.player);
  });

  it('lets elite heavy cavalry shock loose low-quality troops but not prepared anti-cavalry', () => {
    const base = {
      attacker: { primaryClass: 'cavalry', tags: ['heavy', 'mobile', 'assault'] } as MatchupProfile,
      environmentTags: ['open' as const],
      attackerTactic: 'all_out_assault' as const,
      attackerMorale: 90,
      attackerTraining: 95,
      attackerReadiness: 90,
      attackerSupply: 90,
      defenderTraining: 20,
      defenderQuality: 85,
    };
    const loosePenalty = calculateWarShockMoralePenalty({
      ...base,
      defender: { primaryClass: 'ranged', tags: [] },
      defenderTactic: 'steady_advance',
    });
    const preparedPenalty = calculateWarShockMoralePenalty({
      ...base,
      defender: { primaryClass: 'infantry', tags: ['anti_cavalry', 'defensive'] },
      defenderTactic: 'hold_position',
    });

    expect(loosePenalty).toBe(30);
    expect(preparedPenalty).toBeLessThanOrEqual(5);
  });
});
