import { describe, expect, it } from 'vitest';
import {
  calculateWarJudgementScoreBreakdown,
  calculateWarJudgementTotal,
  deriveConflictAdvantageBand,
  normalizeConflictJudgement,
  normalizeConflictScoreBreakdown,
} from './WarJudgementScore';

describe('WarJudgementScore', () => {
  it('calculates a local total from war judgement score components', () => {
    expect(calculateWarJudgementTotal({
      troopBase: -18,
      commander: 12,
      tactical: 8,
      turningPoint: 14,
      playerAction: 10,
      uniqueArts: 6,
    })).toBe(32);
  });

  it('derives an advantage band from the local score total', () => {
    expect(deriveConflictAdvantageBand(46)).toBe('overwhelmingAdvantage');
    expect(deriveConflictAdvantageBand(26)).toBe('clearAdvantage');
    expect(deriveConflictAdvantageBand(8)).toBe('slightAdvantage');
    expect(deriveConflictAdvantageBand(0)).toBe('even');
    expect(deriveConflictAdvantageBand(-8)).toBe('slightDisadvantage');
    expect(deriveConflictAdvantageBand(-26)).toBe('clearDisadvantage');
    expect(deriveConflictAdvantageBand(-46)).toBe('overwhelmingDisadvantage');
  });

  it('normalizes missing total and baseline advantage without overriding explicit values', () => {
    const normalized = normalizeConflictJudgement({
      method: 'warJudgementV1',
      scoreBreakdown: {
        troopBase: -18,
        commander: 12,
        tactical: 8,
        turningPoint: 14,
        playerAction: 10,
      },
    });

    expect(normalized.scoreBreakdown?.total).toBe(26);
    expect(normalized.baselineAdvantage).toBe('clearAdvantage');

    const explicit = normalizeConflictJudgement({
      method: 'warJudgementV1',
      baselineAdvantage: 'clearDisadvantage',
      scoreBreakdown: {
        troopBase: 10,
        total: 10,
      },
    });

    expect(explicit.baselineAdvantage).toBe('clearDisadvantage');
    expect(explicit.scoreBreakdown?.total).toBe(10);
  });

  it('calculates a reference war score from troop size, troop quality and commander ability', () => {
    const breakdown = calculateWarJudgementScoreBreakdown({
      own: {
        troopSize: 800,
        morale: 62,
        training: 58,
        quality: 55,
        readiness: 60,
        commander: { leadership: 78, intelligence: 55, force: 48, politics: 45, charm: 52 },
      },
      enemy: {
        troopSize: 1200,
        morale: 44,
        training: 35,
        quality: 40,
        readiness: 42,
        commander: { leadership: 48, intelligence: 42, force: 51, politics: 38, charm: 35 },
      },
      tacticalModifier: 8,
      turningPointModifier: 18,
      playerActionModifier: 10,
    });

    expect(breakdown.troopBase).toBeGreaterThanOrEqual(-10);
    expect(breakdown.commander).toBeGreaterThan(10);
    expect(breakdown.tactical).toBe(8);
    expect(breakdown.turningPoint).toBe(18);
    expect(breakdown.playerAction).toBe(10);
    expect(breakdown.total).toBe(calculateWarJudgementTotal(breakdown));
  });

  it('proportionally contracts the real Luomagu 290-point writeback to the 250-point contract', () => {
    const normalized = normalizeConflictScoreBreakdown({
      troopBase: 85,
      commander: 90,
      tactical: 95,
      turningPoint: 0,
      playerAction: 20,
      uniqueArts: 0,
      total: 290,
    });

    expect(normalized).toMatchObject({
      troopBase: 73,
      commander: 78,
      tactical: 82,
      turningPoint: 0,
      playerAction: 17,
      uniqueArts: 0,
      total: 250,
    });
    expect(calculateWarJudgementTotal(normalized)).toBe(250);
  });

  it('bounds individual LLM score drift before recomputing the total', () => {
    expect(normalizeConflictScoreBreakdown({ troopBase: 150, commander: -140, total: 999 })).toEqual({
      troopBase: 100,
      commander: -100,
      total: 0,
    });
  });

  it('weights commander leadership more heavily than personal force in army conflict', () => {
    const leadershipEdge = calculateWarJudgementScoreBreakdown({
      own: { commander: { leadership: 80, intelligence: 50, force: 50, politics: 50, charm: 50 } },
      enemy: { commander: { leadership: 50, intelligence: 50, force: 50, politics: 50, charm: 50 } },
    });
    const forceEdge = calculateWarJudgementScoreBreakdown({
      own: { commander: { leadership: 50, intelligence: 50, force: 80, politics: 50, charm: 50 } },
      enemy: { commander: { leadership: 50, intelligence: 50, force: 50, politics: 50, charm: 50 } },
    });

    expect(leadershipEdge.commander).toBeGreaterThan(forceEdge.commander ?? 0);
    expect(forceEdge.commander).toBeGreaterThan(0);
  });

  it('adds clamped unique art modifiers to army conflict scoring', () => {
    const boosted = calculateWarJudgementScoreBreakdown({
      own: {},
      enemy: {},
      uniqueArtsModifier: 18,
    });
    const clamped = calculateWarJudgementScoreBreakdown({
      own: {},
      enemy: {},
      uniqueArtsModifier: 80,
    });

    expect(boosted.uniqueArts).toBe(18);
    expect(boosted.total).toBe(18);
    expect(clamped.uniqueArts).toBe(35);
    expect(clamped.total).toBe(35);
  });
});
