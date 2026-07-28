import { describe, expect, it } from 'vitest';
import {
  evaluateWorldChronicleEligibility,
  resolveWorldChronicleStatus,
} from './worldChroniclePolicy';

describe('worldChroniclePolicy', () => {
  it('rejects local player actions even when they are important to the protagonist', () => {
    expect(evaluateWorldChronicleEligibility({
      scope: 'local',
      severity: 'high',
      status: 'active',
      happenedAt: 'day 10',
      affectedNpcIds: ['npc_recruit'],
      sourceQuestIds: ['quest_recruit'],
    }).eligible).toBe(false);

    expect(evaluateWorldChronicleEligibility({
      scope: 'local',
      severity: 'high',
      summary: 'A local action shaped the protagonist but not the wider world.',
      knownToPlayer: true,
      updatedAt: 'day 10',
    }).eligible).toBe(false);
  });

  it('accepts structured regional or realm impact but not unanchored regional summaries', () => {
    expect(evaluateWorldChronicleEligibility({
      scope: 'regional',
      severity: 'high',
      status: 'historical',
      happenedAt: 'day 10',
      affectedFactionIds: ['faction_a'],
      sourceConflictIds: ['conflict_a'],
    }).eligible).toBe(true);

    expect(evaluateWorldChronicleEligibility({
      scope: 'regional',
      severity: 'medium',
      status: 'active',
      happenedAt: 'day 10',
      affectedNpcIds: ['npc_a'],
    }).eligible).toBe(false);

    expect(evaluateWorldChronicleEligibility({
      scope: 'realm',
      severity: 'critical',
      status: 'historical',
      happenedAt: 'day 10',
    }).eligible).toBe(false);

    expect(evaluateWorldChronicleEligibility({
      scope: 'realm',
      severity: 'critical',
      status: 'historical',
      happenedAt: 'day 10',
      affectedFactionIds: ['faction_court'],
    }).eligible).toBe(true);
  });

  it('keeps preloaded world baselines but closes one-off runtime events without ongoing evidence', () => {
    const baseline = {
      summary: 'The opening world situation.',
      knownToPlayer: true,
      updatedAt: 'day 1',
    };
    expect(evaluateWorldChronicleEligibility(baseline).eligible).toBe(true);
    expect(resolveWorldChronicleStatus(baseline)).toBe('active');

    expect(resolveWorldChronicleStatus({
      scope: 'regional',
      severity: 'high',
      status: 'active',
      happenedAt: 'day 10',
      outcomeSummary: 'The battle ended.',
      sourceConflictIds: ['conflict_a'],
    })).toBe('historical');

    expect(resolveWorldChronicleStatus({
      scope: 'regional',
      severity: 'high',
      status: 'active',
      happenedAt: 'day 10',
      progressSummary: 'Both armies remain in contact.',
      nextCheckAt: 'day 11',
      sourceConflictIds: ['conflict_a'],
    })).toBe('active');
  });
});
