import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../../engine/types';
import { buildWorldlineKnowledgeProjection } from '../../engine/worldline/WorldlineKnowledgeProjection';
import { threeKingdomsKnowledgeBase } from './knowledgeBase';
import {
  THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_4_NEW_CORRECTION_CARDS,
  THREE_KINGDOMS_ROMANCE_CORRECTION_CATALOG,
} from './knowledgeBaseBatch4RomanceCorrections';
import { THREE_KINGDOMS_MAJOR_EVENT_MANIFEST } from './knowledgeBaseMajorEventManifest';

function searchableText(cardId: string): string {
  const card = threeKingdomsKnowledgeBase.cards.find((candidate) => candidate.id === cardId);
  if (!card) return '';
  return [
    card.title,
    card.summary,
    card.contradictionHint ?? '',
    ...(card.relatedTags ?? []),
  ].join('\n');
}

describe('THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_4_ROMANCE_CORRECTIONS', () => {
  it('covers the approved 15-item finite correction catalog', () => {
    expect(THREE_KINGDOMS_ROMANCE_CORRECTION_CATALOG).toHaveLength(15);
    expect(THREE_KINGDOMS_ROMANCE_CORRECTION_CATALOG.map((entry) => entry.label)).toEqual([
      '桃园结义',
      '三英战吕布',
      '温酒斩华雄',
      '貂蝉与连环计',
      '三让徐州',
      '三顾茅庐',
      '草船借箭',
      '借东风',
      '华容道',
      '单刀赴会',
      '刮骨疗毒',
      '七擒孟获',
      '空城计',
      '六出祁山',
      '死诸葛走生仲达',
    ]);
  });

  it('reuses seven existing corrections and adds only eight non-event cards', () => {
    expect(THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_4_NEW_CORRECTION_CARDS).toHaveLength(8);
    for (const card of THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_4_NEW_CORRECTION_CARDS) {
      expect(card.kind, card.id).toBe('customRule');
      expect(card.historicalEvent, card.id).toBeUndefined();
      expect(card.importance, card.id).toBe('normal');
      expect(card.strictness, card.id).toBe('default');
      expect(card.contradictionHint, card.id).toContain('本局');
      expect(card.relatedTags, card.id).toEqual(expect.arrayContaining(['演义史实纠偏', '本局事实最高']));
      expect(card.summary.length, card.id).toBeLessThanOrEqual(240);
    }
  });

  it('maps every literary label to a unique production card with searchable aliases', () => {
    const productionIds = new Set(threeKingdomsKnowledgeBase.cards.map((card) => card.id));
    const labels = new Set<string>();

    for (const entry of THREE_KINGDOMS_ROMANCE_CORRECTION_CATALOG) {
      expect(labels.has(entry.label), entry.label).toBe(false);
      labels.add(entry.label);
      expect(entry.correctionCardIds.length, entry.label).toBeGreaterThan(0);

      for (const cardId of entry.correctionCardIds) {
        expect(productionIds.has(cardId), `${entry.label}:${cardId}`).toBe(true);
      }

      const mappedText = entry.correctionCardIds.map(searchableText).join('\n');
      expect(mappedText, entry.label).toContain(entry.label.split('与')[0]);
      expect(mappedText, entry.label).toMatch(/本局|实际|不得|不应/);
    }
  });

  it('adds common literary aliases to existing historical anchors without adding duplicate events', () => {
    const coalition = THREE_KINGDOMS_MAJOR_EVENT_MANIFEST
      .find((entry) => entry.id === 'tk3k_manifest_190_coalition');
    const redCliffs = THREE_KINGDOMS_MAJOR_EVENT_MANIFEST
      .find((entry) => entry.id === 'tk3k_manifest_208_chibi');
    const jingzhou = THREE_KINGDOMS_MAJOR_EVENT_MANIFEST
      .find((entry) => entry.id === 'tk3k_manifest_215_hefei_jingzhou');

    expect(coalition?.aliases).toEqual(expect.arrayContaining(['三英战吕布', '温酒斩华雄']));
    expect(redCliffs?.aliases).toEqual(expect.arrayContaining(['草船借箭', '借东风', '华容道']));
    expect(jingzhou?.aliases).toContain('单刀赴会');

    const newIds = new Set(THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_4_NEW_CORRECTION_CARDS.map((card) => card.id));
    expect(newIds.has('tk3k_208_chibi_approach')).toBe(false);
    expect(newIds.has('tk3k_215_jingzhou_partition')).toBe(false);
  });

  it('retrieves an explicitly mentioned correction without turning it into a historical event', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: {
        worldBookId: 'threeKingdoms',
        currentDate: '公元228年03月01日',
        currentLocationId: 'location_unknown',
        npcs: [],
        activeQuests: [],
        knownRumors: [],
        worldTrends: [],
        turnEvents: [{ summary: '空城计' }],
      } as unknown as RuntimeState,
      knowledgeBase: threeKingdomsKnowledgeBase,
      storyPacks: [],
      mode: 'default',
    });

    const correction = result.hints.find((hint) => hint.id === 'tk3k_romance_empty_fort_correction');
    expect(correction).toBeDefined();
    expect(correction?.text).toContain('不是 228 年必然发生');
    expect(correction?.applicability).toBeUndefined();
  });
});
