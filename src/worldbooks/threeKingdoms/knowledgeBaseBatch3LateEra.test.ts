import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../../engine/types';
import { evaluateHistoricalAnchorApplicability } from '../../engine/worldline/HistoricalAnchorApplicability';
import { threeKingdomsKnowledgeBase } from './knowledgeBase';
import {
  THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_CARDS,
  THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_ENDINGS,
  THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_MAJOR_EVENTS,
  THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_SYSTEM_SOCIAL,
} from './knowledgeBaseBatch3LateEra';
import { THREE_KINGDOMS_MAJOR_EVENT_MANIFEST } from './knowledgeBaseMajorEventManifest';

function minimalState(currentDate: string): RuntimeState {
  return {
    worldBookId: 'threeKingdoms',
    currentDate,
    currentLocationId: 'region_yangzhou',
    npcs: [],
    activeQuests: [],
    knownRumors: [],
    worldTrends: [],
  } as unknown as RuntimeState;
}

describe('THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3', () => {
  it('closes the 16 late manifest gaps with strict major event cards', () => {
    expect(THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_MAJOR_EVENTS).toHaveLength(16);
    for (const card of THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_MAJOR_EVENTS) {
      expect(card.kind).toBe('event');
      expect(card.importance).toBe('major');
      expect(card.strictness).toBe('strict');
      expect(card.summary.length, card.id).toBeLessThanOrEqual(240);
      expect(card.contradictionHint, card.id).toContain('本局');
      expect(card.historicalEvent?.structuralPressure?.trim(), card.id).not.toBe('');
      expect(card.historicalEvent?.divergencePolicy.suppressWhenContradicted, card.id).toBe(true);
    }
  });

  it('adds the approved 10-16 system/social cards plus late人物势力终局', () => {
    expect(THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_SYSTEM_SOCIAL.length)
      .toBeGreaterThanOrEqual(10);
    expect(THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_SYSTEM_SOCIAL.length)
      .toBeLessThanOrEqual(16);
    expect(THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_ENDINGS.length)
      .toBeGreaterThanOrEqual(6);

    for (const card of [
      ...THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_SYSTEM_SOCIAL,
      ...THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_ENDINGS,
    ]) {
      expect(card.summary.length, card.id).toBeLessThanOrEqual(240);
      expect(card.contradictionHint, card.id).toContain('本局');
      expect(card.relatedTags?.length, card.id).toBeGreaterThan(0);
    }
  });

  it('registers all 35 cards in production without duplicate ids', () => {
    expect(THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_CARDS).toHaveLength(35);
    const batchIds = THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_CARDS.map((card) => card.id);
    expect(new Set(batchIds).size).toBe(batchIds.length);

    const productionIds = new Set(threeKingdomsKnowledgeBase.cards.map((card) => card.id));
    for (const cardId of batchIds) {
      expect(productionIds.has(cardId), cardId).toBe(true);
    }
  });

  it('inherits aliases, windows, and divergence policy from every late manifest entry', () => {
    for (const card of THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_MAJOR_EVENTS) {
      const manifest = THREE_KINGDOMS_MAJOR_EVENT_MANIFEST
        .find((entry) => entry.currentCardIds.includes(card.id));
      expect(manifest, card.id).toBeDefined();
      expect(card.historicalEvent?.historicalWindow).toEqual(manifest?.historicalWindow);
      expect(card.historicalEvent?.divergencePolicy).toEqual(manifest?.divergencePolicy);
      expect(card.relatedTags).toEqual(expect.arrayContaining(manifest?.aliases ?? []));
    }
  });

  it('gates the 280 ending before and after its fixed historical window', () => {
    const wuFall = THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_MAJOR_EVENTS
      .find((card) => card.id === 'tk3k_280_wu_fall');
    expect(wuFall).toBeDefined();
    expect(evaluateHistoricalAnchorApplicability(wuFall!, minimalState('公元279年01月01日')))
      .toMatchObject({ disposition: 'not_yet', eligible: false });
    expect(evaluateHistoricalAnchorApplicability(wuFall!, minimalState('公元280年01月01日')))
      .toMatchObject({ disposition: 'baseline_possible', eligible: true });
    expect(evaluateHistoricalAnchorApplicability(wuFall!, minimalState('公元281年01月01日')))
      .toMatchObject({ disposition: 'expired', eligible: false });
  });
});
