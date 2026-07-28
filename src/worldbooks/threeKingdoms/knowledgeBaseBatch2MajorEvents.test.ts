import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../../engine/types';
import { evaluateHistoricalAnchorApplicability } from '../../engine/worldline/HistoricalAnchorApplicability';
import { threeKingdomsKnowledgeBase } from './knowledgeBase';
import { THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_2_MAJOR_EVENTS } from './knowledgeBaseBatch2MajorEvents';
import { THREE_KINGDOMS_MAJOR_EVENT_MANIFEST } from './knowledgeBaseMajorEventManifest';

function minimalState(currentDate: string): RuntimeState {
  return {
    worldBookId: 'threeKingdoms',
    currentDate,
    currentLocationId: 'region_xuzhou',
    npcs: [],
    activeQuests: [],
    knownRumors: [],
    worldTrends: [],
  } as unknown as RuntimeState;
}

describe('THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_2_MAJOR_EVENTS', () => {
  it('stays inside the approved 24-32 card batch and uses event/major cards', () => {
    expect(THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_2_MAJOR_EVENTS.length).toBeGreaterThanOrEqual(24);
    expect(THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_2_MAJOR_EVENTS.length).toBeLessThanOrEqual(32);

    for (const card of THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_2_MAJOR_EVENTS) {
      expect(card.kind).toBe('event');
      expect(card.importance).toBe('major');
      expect(card.strictness).toBe('strict');
      expect(card.summary.length, card.id).toBeLessThanOrEqual(240);
      expect(card.contradictionHint, card.id).toContain('本局');
      expect(card.historicalEvent?.structuralPressure?.trim(), card.id).not.toBe('');
      expect(card.historicalEvent?.divergencePolicy.suppressWhenContradicted, card.id).toBe(true);
    }
  });

  it('registers every batch card in the production KnowledgeBase', () => {
    const productionIds = new Set(threeKingdomsKnowledgeBase.cards.map((card) => card.id));
    for (const card of THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_2_MAJOR_EVENTS) {
      expect(productionIds.has(card.id), card.id).toBe(true);
    }
  });

  it('inherits aliases, time windows, and divergence policies from the manifest', () => {
    for (const card of THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_2_MAJOR_EVENTS) {
      const manifest = THREE_KINGDOMS_MAJOR_EVENT_MANIFEST
        .find((entry) => entry.currentCardIds.includes(card.id));
      expect(manifest, card.id).toBeDefined();
      expect(card.historicalEvent?.historicalWindow).toEqual(manifest?.historicalWindow);
      expect(card.historicalEvent?.divergencePolicy).toEqual(manifest?.divergencePolicy);
      expect(card.relatedTags).toEqual(expect.arrayContaining(manifest?.aliases ?? []));
    }
  });

  it('does not surface a concrete event before its earliest year or after its latest year', () => {
    const xuzhou = THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_2_MAJOR_EVENTS
      .find((card) => card.id === 'tk3k_193_xuzhou_campaign');
    expect(xuzhou).toBeDefined();
    expect(evaluateHistoricalAnchorApplicability(xuzhou!, minimalState('公元190年01月01日'))).toMatchObject({
      disposition: 'not_yet',
      eligible: false,
    });
    expect(evaluateHistoricalAnchorApplicability(xuzhou!, minimalState('公元193年01月01日'))).toMatchObject({
      disposition: 'baseline_possible',
      eligible: true,
    });
    expect(evaluateHistoricalAnchorApplicability(xuzhou!, minimalState('公元195年01月01日'))).toMatchObject({
      disposition: 'expired',
      eligible: false,
    });
  });
});
