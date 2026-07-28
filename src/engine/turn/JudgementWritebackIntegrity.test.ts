import { describe, expect, it } from 'vitest';
import type { RuntimeState, StatePatch } from '../types';
import {
  findOrphanJudgementMarkers,
  sanitizeDanglingConflictReferences,
} from './JudgementWritebackIntegrity';

describe('JudgementWritebackIntegrity', () => {
  it('detects battle and combat markers without matching structured records', () => {
    const issues = findOrphanJudgementMarkers(
      [
        '伏兵齐出。',
        '[[判定:battle:conflict_luomagu_ambush]]',
        '刘平纵马斩将。',
        '[[判定:combat:combat_luomagu_beheading]]',
      ].join('\n'),
      [{
        type: 'timeAdvance',
        payload: { minutesAdvanced: 30 },
        reason: '战斗持续半个时辰',
      }],
    );

    expect(issues.map((issue) => `${issue.kind}:${issue.recordId}`)).toEqual([
      'battle:conflict_luomagu_ambush',
      'combat:combat_luomagu_beheading',
    ]);
  });

  it('accepts markers once matching normalized command records exist', () => {
    const patches: StatePatch[] = [{
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertConflictRecord',
          conflictId: 'conflict_luomagu_ambush',
        },
      },
      reason: '记录伏击',
    } as StatePatch];

    expect(findOrphanJudgementMarkers(
      '[[判定:battle:conflict_luomagu_ambush]]',
      patches,
    )).toEqual([]);
  });

  it('removes chronicle conflict references that do not resolve to a stored conflict', () => {
    const result = sanitizeDanglingConflictReferences({
      conflicts: [{ conflictId: 'conflict_existing' }],
    } as RuntimeState, {
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      debugNotes: [],
      worldEventSummary: {
        eventId: 'event_luomagu',
        title: '落马谷之战',
        summary: '谷中伏击告捷。',
        sourceConflictIds: ['conflict_existing', 'conflict_missing'],
      },
      worldEventUpdates: [{
        eventId: 'event_old',
        sourceConflictIds: ['conflict_missing'],
      }],
    });

    expect(result.removedConflictIds).toEqual(['conflict_missing']);
    expect(result.writeback?.worldEventSummary?.sourceConflictIds).toEqual(['conflict_existing']);
    expect(result.writeback?.worldEventUpdates?.[0].sourceConflictIds).toBeUndefined();
  });
});
