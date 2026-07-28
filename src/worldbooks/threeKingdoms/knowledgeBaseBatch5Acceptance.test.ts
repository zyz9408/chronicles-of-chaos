import { describe, expect, it } from 'vitest';
import type {
  RuntimeState,
  WorldlineKnowledgeBase,
  WorldlineKnowledgeCard,
} from '../../engine/types';
import { buildWorldlineKnowledgeProjection } from '../../engine/worldline/WorldlineKnowledgeProjection';
import { threeKingdomsKnowledgeBase } from './knowledgeBase';
import { THREE_KINGDOMS_MAJOR_EVENT_MANIFEST } from './knowledgeBaseMajorEventManifest';

interface DivergedTimelineScenario {
  label: string;
  currentDate: string;
  targets: Array<{
    cardId: string;
    query: string;
  }>;
}

const DIVERGED_TIMELINE_SCENARIOS: DivergedTimelineScenario[] = [
  {
    label: '董卓在192年后仍存活',
    currentDate: '公元194年01月01日',
    targets: [{ cardId: 'tk3k_192_dongzhuo_death', query: '吕布刺董卓' }],
  },
  {
    label: '刘备没有接掌徐州',
    currentDate: '公元196年01月01日',
    targets: [{ cardId: 'tk3k_194_xuzhou_succession', query: '三让徐州' }],
  },
  {
    label: '袁术没有称帝',
    currentDate: '公元199年01月01日',
    targets: [{ cardId: 'tk3k_197_yuanshu_emperor', query: '袁术僭号' }],
  },
  {
    label: '赤壁结局被改写',
    currentDate: '公元210年01月01日',
    targets: [{ cardId: 'tk3k_208_chibi_approach', query: '赤壁之战' }],
  },
  {
    label: '关羽未失荆州',
    currentDate: '公元221年01月01日',
    targets: [{ cardId: 'tk3k_219_fancheng_jingzhou_chain', query: '败走麦城' }],
  },
  {
    label: '诸葛亮未按史实北伐',
    currentDate: '公元235年01月01日',
    targets: [
      { cardId: 'tk3k_228_first_northern_expedition', query: '初出祁山' },
      { cardId: 'tk3k_228_chencang', query: '第二次北伐' },
      { cardId: 'tk3k_229_wudu_yinping', query: '第三次北伐' },
      { cardId: 'tk3k_231_qishan_stalemate', query: '祁山之战' },
      { cardId: 'tk3k_234_wuzhangyuan', query: '第五次北伐' },
    ],
  },
  {
    label: '蜀汉在263年后仍存在',
    currentDate: '公元265年01月01日',
    targets: [{ cardId: 'tk3k_263_shuhan_fall', query: '蜀汉灭亡' }],
  },
];

const cardById = new Map(
  threeKingdomsKnowledgeBase.cards.map((card) => [card.id, card] as const),
);

function requireCard(cardId: string): WorldlineKnowledgeCard {
  const card = cardById.get(cardId);
  if (!card) throw new Error(`Missing acceptance card: ${cardId}`);
  return card;
}

function trackingIdOf(card: WorldlineKnowledgeCard): string {
  return card.historicalAnchorId ?? card.id;
}

function makeState(
  currentDate: string,
  query?: string,
  divergedTrackingIds: string[] = [],
): RuntimeState {
  return {
    engineVersion: '0.1.0',
    worldBookId: 'threeKingdoms',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: currentDate,
    currentDate,
    player: {
      id: 'player_batch5',
      name: '验收主角',
      roleType: '游侠',
      summary: 'KnowledgeBase Batch 5 验收主角',
    },
    currentLocationId: 'loc_batch5_unrelated',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: query
      ? [{
          id: 'quest_batch5_reference',
          title: `查阅：${query}`,
          description: `核对已经改变的世界线与“${query}”历史参照。`,
          status: 'active',
          priority: 'high',
          consequenceTags: [query],
          createdAt: currentDate,
          updatedAt: currentDate,
        }]
      : [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    npcs: [],
    holdings: [],
    troops: [],
    worldTrends: [],
    factions: [],
    turnEvents: [],
    worldlineAnchorStates: divergedTrackingIds.map((trackingId) => ({
      cardId: trackingId,
      disposition: 'diverged',
      assessedAt: currentDate,
      factRefs: [`acceptance:${trackingId}`],
      note: 'Batch 5 架空世界线验收。',
    })),
  } as RuntimeState;
}

function oneCardKnowledgeBase(card: WorldlineKnowledgeCard): WorldlineKnowledgeBase {
  return {
    id: `kb_batch5_${card.id}`,
    worldBookId: 'threeKingdoms',
    name: 'Batch 5 retrieval fixture',
    version: '0.5.0',
    description: '只隔离检验生产卡的正式名与别名检索。',
    cards: [card],
  };
}

describe('KnowledgeBase Batch 5 acceptance', () => {
  it('binds every manifest row to exactly one canonical event anchor with complete aliases', () => {
    const anchorCards = threeKingdomsKnowledgeBase.cards
      .filter((card) => Boolean(card.historicalAnchorId));
    expect(anchorCards).toHaveLength(THREE_KINGDOMS_MAJOR_EVENT_MANIFEST.length);
    expect(new Set(anchorCards.map((card) => card.historicalAnchorId)).size)
      .toBe(THREE_KINGDOMS_MAJOR_EVENT_MANIFEST.length);

    for (const manifest of THREE_KINGDOMS_MAJOR_EVENT_MANIFEST) {
      const boundCards = anchorCards
        .filter((card) => card.historicalAnchorId === manifest.id);
      expect(boundCards, manifest.id).toHaveLength(1);

      const [card] = boundCards;
      expect(['event', 'eraAnchor'], manifest.id).toContain(card.kind);
      expect(card.historicalEvent, manifest.id).toBeDefined();
      expect(card.historicalEvent?.historicalWindow, manifest.id)
        .toMatchObject(manifest.historicalWindow);
      expect(card.relatedTags, manifest.id)
        .toEqual(expect.arrayContaining([manifest.title, ...manifest.aliases]));
    }
  });

  it('retrieves every official name and common alias through its canonical production card', () => {
    for (const manifest of THREE_KINGDOMS_MAJOR_EVENT_MANIFEST) {
      const card = threeKingdomsKnowledgeBase.cards
        .find((candidate) => candidate.historicalAnchorId === manifest.id);
      expect(card, manifest.id).toBeDefined();
      if (!card) continue;
      const currentDate = manifest.historicalWindow.typical;
      expect(currentDate, manifest.id).toBeDefined();
      if (!currentDate) continue;

      for (const query of [manifest.title, ...manifest.aliases]) {
        const result = buildWorldlineKnowledgeProjection({
          state: makeState(currentDate, query),
          knowledgeBase: oneCardKnowledgeBase(card),
          storyPacks: [],
          mode: 'strict',
        });
        expect(
          result.hints.map((hint) => hint.id),
          `${manifest.id} <- ${query}`,
        ).toContain(card.id);
      }
    }
  });

  it.each(DIVERGED_TIMELINE_SCENARIOS)(
    'keeps $label out of future candidates but allows explicit historical reference with a hard no-reenactment boundary',
    (scenario) => {
      const cards = scenario.targets.map((target) => requireCard(target.cardId));
      const trackingIds = [...new Set(cards.map(trackingIdOf))];

      const silentProjection = buildWorldlineKnowledgeProjection({
        state: makeState(scenario.currentDate, undefined, trackingIds),
        knowledgeBase: threeKingdomsKnowledgeBase,
        storyPacks: [],
        mode: 'strict',
      });
      expect(
        silentProjection.hints
          .filter((hint) => trackingIds.includes(hint.historicalAnchorId ?? hint.id)),
        scenario.label,
      ).toEqual([]);

      for (const target of scenario.targets) {
        const card = requireCard(target.cardId);
        const explicitState = makeState(scenario.currentDate, target.query, trackingIds);
        const result = buildWorldlineKnowledgeProjection({
          state: explicitState,
          knowledgeBase: oneCardKnowledgeBase(card),
          storyPacks: [],
          mode: 'strict',
        });
        expect(result.hints, `${scenario.label} -> ${card.id}`).toHaveLength(1);
        expect(result.hints[0]).toMatchObject({
          id: card.id,
          applicability: 'diverged',
        });
        expect(result.hints[0]?.text).toContain('本局已确认偏转');
        expect(result.hints[0]?.text).toContain('不得按原史实发生');
        expect(result.hints[0]?.reason).toContain('ledger=diverged');

        const productionResult = buildWorldlineKnowledgeProjection({
          state: explicitState,
          knowledgeBase: threeKingdomsKnowledgeBase,
          storyPacks: [],
          mode: 'strict',
        });
        expect(
          productionResult.hints.find((hint) => hint.id === card.id),
          `${scenario.label} production retrieval -> ${card.id}`,
        ).toMatchObject({
          applicability: 'diverged',
        });
      }
    },
  );
});
