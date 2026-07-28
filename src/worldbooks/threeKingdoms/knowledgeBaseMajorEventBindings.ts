import type {
  HistoricalEventApplicability,
  WorldlineKnowledgeCard,
} from '../../engine/types';
import {
  THREE_KINGDOMS_MAJOR_EVENT_MANIFEST,
  type ThreeKingdomsMajorEventManifestEntry,
} from './knowledgeBaseMajorEventManifest';

function isHistoricalAnchorCard(card: WorldlineKnowledgeCard): boolean {
  return card.kind === 'event' || card.kind === 'eraAnchor';
}

function mergeUnique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function buildHistoricalEvent(
  card: WorldlineKnowledgeCard,
  manifest: ThreeKingdomsMajorEventManifestEntry,
): HistoricalEventApplicability {
  return {
    historicalWindow: {
      ...manifest.historicalWindow,
      ...card.historicalEvent?.historicalWindow,
    },
    ...(card.historicalEvent?.hardPrerequisites
      ? { hardPrerequisites: card.historicalEvent.hardPrerequisites }
      : {}),
    ...(card.historicalEvent?.structuralPressure
      ? { structuralPressure: card.historicalEvent.structuralPressure }
      : {}),
    divergencePolicy: {
      ...manifest.divergencePolicy,
      ...card.historicalEvent?.divergencePolicy,
    },
  };
}

/**
 * 把 manifest 的稳定锚点、时间窗和检索别名绑定到每项历史骨架的主卡。
 *
 * manifest 中的 currentCardIds 也会列出人物/势力辅助卡；这里只选择第一张
 * event/eraAnchor 作为规范主卡，避免某场战役偏转后把人物生平卡一并屏蔽。
 */
export function bindThreeKingdomsMajorEventManifest(
  cards: WorldlineKnowledgeCard[],
): WorldlineKnowledgeCard[] {
  const cardById = new Map(cards.map((card) => [card.id, card] as const));
  const manifestByCanonicalCardId = new Map<string, ThreeKingdomsMajorEventManifestEntry>();

  for (const manifest of THREE_KINGDOMS_MAJOR_EVENT_MANIFEST) {
    const canonicalCard = manifest.currentCardIds
      .map((cardId) => cardById.get(cardId))
      .find((card): card is WorldlineKnowledgeCard => Boolean(card && isHistoricalAnchorCard(card)));
    if (!canonicalCard) {
      throw new Error(`Major event manifest has no event/eraAnchor card: ${manifest.id}`);
    }
    manifestByCanonicalCardId.set(canonicalCard.id, manifest);
  }

  return cards.map((card) => {
    const manifest = manifestByCanonicalCardId.get(card.id);
    if (!manifest) return card;

    return {
      ...card,
      historicalAnchorId: manifest.id,
      relatedTags: mergeUnique([
        ...(card.relatedTags ?? []),
        manifest.title,
        ...manifest.aliases,
      ]),
      historicalEvent: buildHistoricalEvent(card, manifest),
    };
  });
}
