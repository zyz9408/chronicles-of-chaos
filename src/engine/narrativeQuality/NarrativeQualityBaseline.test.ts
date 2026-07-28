import { describe, expect, it } from 'vitest';
import {
  NARRATIVE_QUALITY_BASELINE_CASES,
  NARRATIVE_QUALITY_DIMENSIONS,
  NARRATIVE_QUALITY_PASSIVE_TURN_SEQUENCE,
  NARRATIVE_QUALITY_PRE_CHANGE_BASELINE,
  NARRATIVE_QUALITY_SUPPLY_CASES,
  validateNarrativeQualityBaseline,
} from './NarrativeQualityBaseline';

describe('NarrativeQualityBaseline', () => {
  it('keeps the fixed evaluation matrix complete and internally consistent', () => {
    expect(validateNarrativeQualityBaseline()).toEqual([]);
    expect(NARRATIVE_QUALITY_BASELINE_CASES).toHaveLength(8);
    expect(new Set(NARRATIVE_QUALITY_BASELINE_CASES.map((entry) => entry.npc.name)).size).toBe(8);
    expect(NARRATIVE_QUALITY_PASSIVE_TURN_SEQUENCE.actions).toHaveLength(10);
    expect(NARRATIVE_QUALITY_SUPPLY_CASES.map((entry) => entry.id)).toEqual([
      'sufficient',
      'mixedProvision',
      'shortage',
    ]);
  });

  it('records exactly one pre-change score for each quality dimension', () => {
    expect(NARRATIVE_QUALITY_PRE_CHANGE_BASELINE.map((entry) => entry.id)).toEqual(
      NARRATIVE_QUALITY_DIMENSIONS,
    );
    expect(NARRATIVE_QUALITY_PRE_CHANGE_BASELINE.every(
      (entry) => entry.score >= 0 && entry.score <= 2,
    )).toBe(true);
  });

  it('anchors every case to structured facts and explicit agency boundaries', () => {
    for (const entry of NARRATIVE_QUALITY_BASELINE_CASES) {
      expect(entry.structuredSourceIds.length).toBeGreaterThan(0);
      expect(entry.npc.stableFactAnchors.length).toBeGreaterThanOrEqual(2);
      expect(entry.mustPreserve.length).toBeGreaterThan(0);
      expect(entry.mustNotInvent.length).toBeGreaterThan(0);
      expect(entry.recentNarrativePatternRisks.length).toBeGreaterThan(0);
    }
  });
});
