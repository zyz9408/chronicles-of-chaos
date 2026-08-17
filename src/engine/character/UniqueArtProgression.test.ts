import { describe, expect, it } from 'vitest';
import type { CharacterUniqueArt, CharacterUniqueArtProgressEvidence } from '../types';
import {
  UNIQUE_ART_PROGRESS_AWARDS,
  applyUniqueArtProgressEvidence,
} from './UniqueArtProgression';

function makeArt(overrides: Partial<CharacterUniqueArt> = {}): CharacterUniqueArt {
  return {
    id: 'art_test',
    name: 'Test Art',
    rarity: 'blue',
    domain: 'strategy',
    level: 2,
    maxLevel: 10,
    progress: 0,
    description: 'Test description.',
    effectSummary: 'Test effect.',
    source: 'opening',
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<CharacterUniqueArtProgressEvidence> = {}): CharacterUniqueArtProgressEvidence {
  return {
    eventId: 'progress:event-1',
    source: 'actual_use',
    intensity: 'normal',
    occurredAt: '189-09-01 09:00',
    sourceRefId: 'turn-event:event-1',
    summary: 'The art was used in a material scene.',
    ...overrides,
  };
}

describe('UniqueArtProgression', () => {
  it('uses the closed local award table', () => {
    expect(UNIQUE_ART_PROGRESS_AWARDS).toEqual({
      actual_use: { minor: 4, normal: 7, major: 10 },
      autonomous_practice: { minor: 5, normal: 9, major: 13 },
      instruction_or_manual: { minor: 6, normal: 11, major: 16 },
      major_achievement: { minor: 8, normal: 14, major: 20 },
    });
  });

  it('levels locally at 100 and retains overflow', () => {
    const result = applyUniqueArtProgressEvidence(
      makeArt({ level: 2, progress: 94 }),
      makeEvidence({ source: 'instruction_or_manual', intensity: 'major' }),
      '7:189-09-01 09:00',
    );
    expect(result.art).toMatchObject({ level: 3, progress: 10, upgradedAt: '189-09-01 09:00' });
    expect(result.art.progressHistory?.[0]).toMatchObject({
      awardedProgress: 16,
      levelBefore: 2,
      levelAfter: 3,
      progressAfter: 10,
      levelledUp: true,
    });
  });

  it('allows at most one level in a turn and banks the later overflow', () => {
    const first = applyUniqueArtProgressEvidence(
      makeArt({ level: 2, progress: 95, bankedProgress: 90 }),
      makeEvidence({ eventId: 'progress:first', source: 'major_achievement', intensity: 'major' }),
      '7:189-09-01 09:00',
    ).art;
    const second = applyUniqueArtProgressEvidence(
      first,
      makeEvidence({ eventId: 'progress:second', sourceRefId: 'turn-event:second', source: 'major_achievement', intensity: 'major' }),
      '7:189-09-01 09:00',
    ).art;
    expect(first.level).toBe(3);
    expect(second.level).toBe(3);
    expect(second.progress).toBe(99);
    expect(second.bankedProgress).toBeGreaterThan(0);

    const nextTurn = applyUniqueArtProgressEvidence(
      second,
      makeEvidence({ eventId: 'progress:third', sourceRefId: 'turn-event:third', intensity: 'minor' }),
      '8:189-09-02 09:00',
    ).art;
    expect(nextTurn.level).toBe(4);
    expect(nextTurn.progress).toBeGreaterThanOrEqual(0);
  });

  it('does not grow past max level and remains event-idempotent', () => {
    const evidence = makeEvidence();
    const first = applyUniqueArtProgressEvidence(
      makeArt({ level: 10, maxLevel: 10, progress: 80 }),
      evidence,
      '7:189-09-01 09:00',
    );
    const replay = applyUniqueArtProgressEvidence(first.art, evidence, '7:189-09-01 09:00');
    expect(first.art).toMatchObject({ level: 10, progress: 0 });
    expect(first.art.progressHistory?.[0].awardedProgress).toBe(0);
    expect(replay.applied).toBe(false);
    expect(replay.art).toEqual(first.art);
  });
});
