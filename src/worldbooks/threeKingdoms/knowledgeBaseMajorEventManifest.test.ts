import { describe, expect, it } from 'vitest';
import { threeKingdomsKnowledgeBase } from './knowledgeBase';
import { THREE_KINGDOMS_MAJOR_EVENT_MANIFEST } from './knowledgeBaseMajorEventManifest';

function yearOf(value?: string): number | undefined {
  const match = value?.match(/(\d{3})年/);
  return match ? Number(match[1]) : undefined;
}

describe('THREE_KINGDOMS_MAJOR_EVENT_MANIFEST', () => {
  it('uses stable unique ids and honest coverage links', () => {
    const ids = THREE_KINGDOMS_MAJOR_EVENT_MANIFEST.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const entry of THREE_KINGDOMS_MAJOR_EVENT_MANIFEST) {
      expect(entry.aliases.length).toBeGreaterThan(0);
      expect(entry.note.trim()).not.toBe('');
      expect(entry.historicalWindow.typical).toMatch(/公元\d{3}年/);
      if (entry.coverageStatus === 'covered') {
        expect(entry.currentCardIds.length, entry.id).toBeGreaterThan(0);
      }
      if (entry.coverageStatus === 'missing') {
        expect(entry.currentCardIds, entry.id).toEqual([]);
      }
    }
  });

  it('covers the complete 184-280 planning range and every construction era band', () => {
    const years = THREE_KINGDOMS_MAJOR_EVENT_MANIFEST
      .map((entry) => yearOf(entry.historicalWindow.typical))
      .filter((year): year is number => year !== undefined);

    expect(Math.min(...years)).toBe(184);
    expect(Math.max(...years)).toBe(280);

    const bands = [
      [184, 191],
      [192, 207],
      [208, 222],
      [223, 249],
      [250, 280],
    ];
    for (const [start, end] of bands) {
      expect(
        years.some((year) => year >= start && year <= end),
        `${start}-${end}`,
      ).toBe(true);
    }
  });

  it('closes every manifest event from 184 through the 280 boundary', () => {
    expect(THREE_KINGDOMS_MAJOR_EVENT_MANIFEST.length).toBeGreaterThan(50);
    expect(
      THREE_KINGDOMS_MAJOR_EVENT_MANIFEST.every(
        (entry) => entry.coverageStatus === 'covered',
      ),
    ).toBe(true);
    expect(
      THREE_KINGDOMS_MAJOR_EVENT_MANIFEST
        .filter((entry) => entry.coverageStatus === 'missing'),
    ).toEqual([]);
    expect(
      THREE_KINGDOMS_MAJOR_EVENT_MANIFEST
        .find((entry) => entry.title === '晋灭吴')?.currentCardIds,
    ).toContain('tk3k_280_wu_fall');
  });

  it('only marks manifest coverage when every referenced card really exists', () => {
    const cardIds = new Set(threeKingdomsKnowledgeBase.cards.map((card) => card.id));
    for (const entry of THREE_KINGDOMS_MAJOR_EVENT_MANIFEST) {
      for (const cardId of entry.currentCardIds) {
        expect(cardIds.has(cardId), `${entry.id} -> ${cardId}`).toBe(true);
      }
    }
  });
});
