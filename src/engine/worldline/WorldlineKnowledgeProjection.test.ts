import { describe, expect, it } from 'vitest';
import type { RuntimeState, WorldlineKnowledgeBase, WorldlineKnowledgeCard, WorldlineStoryPack } from '../types';
import { buildWorldlineKnowledgeProjection } from './WorldlineKnowledgeProjection';

const knowledgeBase: WorldlineKnowledgeBase = {
  id: 'kb_test',
  worldBookId: 'wb_test',
  name: 'Test Knowledge Base',
  version: '0.1.0',
  description: 'test',
  cards: [
    {
      id: 'critical_luoyang',
      worldBookId: 'wb_test',
      kind: 'eraAnchor',
      title: '189 年洛阳乱局',
      summary: '董卓入京与废立风波是此阶段的大势惯性。',
      timeRange: { start: '公元189年', end: '公元190年' },
      importance: 'critical',
      strictness: 'light',
      relatedPlaceIds: ['loc_luoyang'],
      relatedTags: ['洛阳'],
      contradictionHint: '若本局已改变京师控制，以本局事实为准。',
    },
    {
      id: 'caocao_early',
      worldBookId: 'wb_test',
      kind: 'personTimeline',
      title: '曹操早期惯性',
      summary: '曹操此时尚未天然拥有后期全部班底。',
      timeRange: { start: '公元184年', end: '公元190年' },
      importance: 'major',
      strictness: 'default',
      relatedNpcNames: ['曹操'],
      contradictionHint: '不要默认夏侯惇、曹洪已经稳定成为曹操部下。',
    },
    {
      id: 'guandu_strict',
      worldBookId: 'wb_test',
      kind: 'event',
      title: '官渡不是早期固定结局',
      summary: '官渡对决属于更晚阶段的大势可能。',
      timeRange: { start: '公元199年', end: '公元200年' },
      importance: 'major',
      strictness: 'strict',
      relatedTags: ['官渡'],
      contradictionHint: '不得照搬乌巢等固定桥段。',
    },
  ],
};

const runtimeState = {
  worldBookId: 'wb_test',
  currentDate: '公元189年09月01日 08:00（辰时）',
  currentLocationId: 'loc_luoyang',
  npcs: [
    { npcId: 'npc_caocao', name: '曹操', isPresent: true, isFocused: false, memories: [] },
  ],
  activeQuests: [],
  knownRumors: [],
  worldTrends: [],
} as unknown as RuntimeState;

function makeKnowledgeBase(cards: WorldlineKnowledgeCard[]): WorldlineKnowledgeBase {
  return {
    id: 'kb_relevance_gate',
    worldBookId: 'wb_test',
    name: 'Relevance Gate Test Knowledge Base',
    version: '0.1.0',
    description: 'test',
    cards,
  };
}

function makeCard(overrides: Partial<WorldlineKnowledgeCard>): WorldlineKnowledgeCard {
  return {
    id: 'card_test',
    worldBookId: 'wb_test',
    kind: 'event',
    title: 'Test contextual card',
    summary: 'Test contextual summary.',
    timeRange: { start: '公元189年', end: '公元190年' },
    importance: 'normal',
    strictness: 'light',
    ...overrides,
  };
}

function makeProjectionState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    ...runtimeState,
    currentLocationId: 'loc_market',
    currentPlaceId: undefined,
    currentSceneId: undefined,
    npcs: [],
    activeQuests: [],
    knownRumors: [],
    worldTrends: [],
    turnEvents: [],
    factions: [],
    player: {
      ...runtimeState.player,
      factionId: undefined,
      factionName: undefined,
    },
    ...overrides,
  } as RuntimeState;
}

describe('buildWorldlineKnowledgeProjection', () => {
  it('returns no hints when mode is off', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: runtimeState,
      knowledgeBase,
      storyPacks: [],
      mode: 'off',
    });

    expect(result.hints).toEqual([]);
    expect(result.text).toBe('');
  });

  it.each(['light', 'default', 'strict'] as const)(
    'excludes in-period critical contextual cards without concrete relevance in %s mode',
    (mode) => {
      const result = buildWorldlineKnowledgeProjection({
        state: makeProjectionState(),
        knowledgeBase: makeKnowledgeBase([
          makeCard({
            id: 'critical_unrelated_contextual',
            title: 'Unrelated critical context',
            importance: 'critical',
            strictness: 'light',
            relatedNpcNames: ['无关名人'],
            relatedPlaceIds: ['loc_far'],
            relatedFactionIds: ['faction_far'],
            relatedTags: ['无关标签'],
          }),
        ]),
        storyPacks: [],
        mode,
      });

      expect(result.hints.map((hint) => hint.id)).not.toContain('critical_unrelated_contextual');
      expect(result.hints).toHaveLength(0);
    },
  );

  it('allows current-year era baseline cards without contextual NPC/place/faction/tag hits', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: makeProjectionState({
        currentDate: '公元189年09月01日 08:00（辰时）',
      }),
      knowledgeBase: makeKnowledgeBase([
        makeCard({
          id: 'era_baseline_189',
          kind: 'eraAnchor',
          title: '189 年大势基线',
          summary: '当前年份的大势基线可作为时代背景进入。',
          timeRange: { start: '公元189年', end: '公元190年' },
          relatedPlaceIds: ['loc_far'],
          relatedTags: ['远方背景'],
          importance: 'minor',
          strictness: 'light',
        }),
      ]),
      storyPacks: [],
      mode: 'default',
    });

    expect(result.hints.map((hint) => hint.id)).toEqual(['era_baseline_189']);
    expect(result.hints[0].reason).toContain('role=eraBaseline');
  });

  it('uses importance only to sort already relevant contextual cards', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: makeProjectionState({ currentLocationId: 'loc_relevant' }),
      knowledgeBase: makeKnowledgeBase([
        makeCard({
          id: 'critical_unrelated',
          title: 'Unrelated critical card',
          importance: 'critical',
          strictness: 'light',
          relatedPlaceIds: ['loc_far'],
        }),
        makeCard({
          id: 'minor_relevant_place',
          title: 'Minor relevant place card',
          importance: 'minor',
          strictness: 'light',
          relatedPlaceIds: ['loc_relevant'],
        }),
      ]),
      storyPacks: [],
      mode: 'default',
    });

    expect(result.hints.map((hint) => hint.id)).toEqual(['minor_relevant_place']);
  });

  it('projects contextual cards when a present NPC name matches relatedNpcNames', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: makeProjectionState({
        npcs: [
          { npcId: 'npc_caocao', name: '曹操', isPresent: true, isFocused: false, memories: [] },
        ],
      } as unknown as Partial<RuntimeState>),
      knowledgeBase: makeKnowledgeBase([
        makeCard({
          id: 'npc_caocao_context',
          title: '曹操相关惯性',
          relatedNpcNames: ['曹操'],
        }),
      ]),
      storyPacks: [],
      mode: 'default',
    });

    expect(result.hints.map((hint) => hint.id)).toEqual(['npc_caocao_context']);
    expect(result.hints[0].reason).toContain('npc=曹操');
  });

  it('projects contextual cards when the current place id matches relatedPlaceIds', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: makeProjectionState({
        currentLocationId: 'region_yuzhou',
        currentPlaceId: 'loc_yingchuan',
      }),
      knowledgeBase: makeKnowledgeBase([
        makeCard({
          id: 'place_yingchuan_context',
          title: '颍川局势',
          relatedPlaceIds: ['loc_yingchuan'],
        }),
      ]),
      storyPacks: [],
      mode: 'default',
    });

    expect(result.hints.map((hint) => hint.id)).toEqual(['place_yingchuan_context']);
    expect(result.hints[0].reason).toContain('place=loc_yingchuan');
  });

  it('projects contextual cards when player, NPC, or current matters link a related faction id', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: makeProjectionState({
        player: {
          ...runtimeState.player,
          factionId: 'faction_han_court',
          factionName: '汉廷',
        },
        activeQuests: [
          {
            id: 'quest_han_court',
            title: '汉廷诏令',
            description: '辨认真伪。',
            status: 'active',
            priority: 'medium',
            relatedFactionIds: ['faction_han_court'],
            createdAt: '公元189年',
            updatedAt: '公元189年',
          },
        ],
      } as unknown as Partial<RuntimeState>),
      knowledgeBase: makeKnowledgeBase([
        makeCard({
          id: 'faction_han_court_context',
          title: '汉廷相关惯性',
          relatedFactionIds: ['faction_han_court'],
        }),
      ]),
      storyPacks: [],
      mode: 'default',
    });

    expect(result.hints.map((hint) => hint.id)).toEqual(['faction_han_court_context']);
    expect(result.hints[0].reason).toContain('faction=faction_han_court');
  });

  it('projects contextual cards by exact consequence tag or explicit title reference', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: makeProjectionState({
        activeQuests: [
          {
            id: 'quest_tagged',
            title: '核对官渡是不是当前事实',
            description: '有人提到官渡不是当前事实。',
            status: 'active',
            priority: 'medium',
            consequenceTags: ['官渡纠偏'],
            createdAt: '公元189年',
            updatedAt: '公元189年',
          },
        ],
      } as unknown as Partial<RuntimeState>),
      knowledgeBase: makeKnowledgeBase([
        makeCard({
          id: 'tagged_minor_context',
          title: '官渡不是当前事实',
          importance: 'minor',
          strictness: 'light',
          relatedTags: ['官渡纠偏'],
        }),
      ]),
      storyPacks: [],
      mode: 'default',
    });

    expect(result.hints.map((hint) => hint.id)).toEqual(['tagged_minor_context']);
    expect(result.hints[0].reason).toContain('tag=官渡纠偏');
  });

  it('does not let broad tag text inside long summaries admit unrelated future cards', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: makeProjectionState({
        currentDate: '公元207年冬',
        currentLocationId: 'region_jingzhou',
        worldTrends: [
          {
            trendId: 'trend_jingzhou_context',
            title: '荆州局势',
            severity: '高',
            summary: '荆州局势复杂，相关传闻很多，但没有提到关羽后期留守。',
            knownToPlayer: true,
            updatedAt: '公元207年冬',
          },
        ],
      } as unknown as Partial<RuntimeState>),
      knowledgeBase: makeKnowledgeBase([
        makeCard({
          id: 'future_jingzhou_guard',
          title: '关羽 214-219 荆州守将',
          summary: '关羽后期留守荆州。',
          timeRange: { start: '公元214年', end: '公元219年' },
          relatedTags: ['荆州'],
          importance: 'critical',
          strictness: 'light',
        }),
      ]),
      storyPacks: [],
      mode: 'strict',
    });

    expect(result.hints.map((hint) => hint.id)).not.toContain('future_jingzhou_guard');
    expect(result.hints).toHaveLength(0);
  });

  it('requires story pack threads to satisfy contextual relevance instead of passing on base score', () => {
    const storyPack: WorldlineStoryPack = {
      id: 'storypack_context_gate',
      worldBookId: 'wb_test',
      name: 'Context Gate Story Pack',
      version: '0.1.0',
      description: 'test',
      threads: [
        {
          id: 'thread_unrelated_normal_score',
          worldBookId: 'wb_test',
          title: 'Unrelated thread',
          summary: 'This thread has no contextual match.',
          relatedNpcNames: ['远方人物'],
          relatedPlaceIds: ['loc_far'],
          relatedFactionIds: ['faction_far'],
          relatedTags: ['远方线程'],
          usageBoundary: 'Only use when relevant.',
        },
      ],
    };

    const result = buildWorldlineKnowledgeProjection({
      state: makeProjectionState(),
      storyPacks: [storyPack],
      mode: 'default',
    });

    expect(result.hints.map((hint) => hint.id)).not.toContain('thread_unrelated_normal_score');
    expect(result.hints).toHaveLength(0);
  });

  it('projects relevant story pack threads even when no knowledge base is configured', () => {
    const storyPack: WorldlineStoryPack = {
      id: 'storypack_luoyang',
      worldBookId: 'wb_test',
      name: 'Luoyang Story Pack',
      version: '0.1.0',
      description: 'test',
      threads: [
        {
          id: 'thread_luoyang_power_vacuum',
          worldBookId: 'wb_test',
          title: '洛阳权力真空',
          summary: '京师权力真空会让小人物更容易被卷入门阀、军伍和宫禁传闻。',
          relatedPlaceIds: ['loc_luoyang'],
          relatedTags: ['洛阳'],
          usageBoundary: '只能作为当前局势牵引，不得强行锁死后续政局。',
        },
      ],
    };

    const result = buildWorldlineKnowledgeProjection({
      state: runtimeState,
      storyPacks: [storyPack],
      mode: 'default',
    });

    expect(result.hints).toHaveLength(1);
    expect(result.hints[0]).toMatchObject({
      id: 'thread_luoyang_power_vacuum',
      sourceType: 'storyPack',
      sourceRef: {
        providerId: 'storypack_luoyang',
        sourceType: 'storyThread',
        sourceId: 'thread_luoyang_power_vacuum',
      },
    });
    expect(result.text).toContain('只能作为当前局势牵引');
  });

  it('uses the current player action as a concrete StoryPack entry signal', () => {
    const storyPack: WorldlineStoryPack = {
      id: 'storypack_query_signal',
      worldBookId: 'wb_test',
      name: 'Query Signal Story Pack',
      version: '0.1.0',
      description: 'test',
      threads: [
        {
          id: 'thread_grain_ledger',
          worldBookId: 'wb_test',
          title: '仓册与实粮',
          summary: '仓册与实粮出现需要核验的差异。',
          entrySignals: ['核对仓册'],
          usageBoundary: '不得虚构账本数值或偷盗结论。',
        },
      ],
    };

    const withoutInput = buildWorldlineKnowledgeProjection({
      state: makeProjectionState(),
      storyPacks: [storyPack],
      mode: 'default',
    });
    const withInput = buildWorldlineKnowledgeProjection({
      state: makeProjectionState(),
      storyPacks: [storyPack],
      mode: 'default',
      queryTexts: ['去粮仓核对仓册'],
    });

    expect(withoutInput.hints).toEqual([]);
    expect(withInput.hints.map((hint) => hint.id)).toEqual(['thread_grain_ledger']);
    expect(withInput.hints[0].reason).toContain('entrySignalRef=核对仓册');
  });

  it('lets only one facet of the same StoryPack motif consume a projection slot', () => {
    const storyPack: WorldlineStoryPack = {
      id: 'storypack_motif_diversity',
      worldBookId: 'wb_test',
      name: 'Motif Diversity Story Pack',
      version: '0.1.0',
      description: 'test',
      threads: [
        {
          id: 'thread_ledger_visible',
          worldBookId: 'wb_test',
          domain: 'logistics',
          motifId: 'ledger_mismatch',
          facet: 'visible_order',
          title: '账面差异',
          summary: '仓册与实粮出现需要核验的差异。',
          entrySignals: ['核对仓册'],
          usageBoundary: '不得虚构账本数值或偷盗结论。',
        },
        {
          id: 'thread_ledger_hidden',
          worldBookId: 'wb_test',
          domain: 'logistics',
          motifId: 'ledger_mismatch',
          facet: 'hidden_interest',
          title: '差异背后的利害',
          summary: '仓册差异背后可能牵连交接责任。',
          entrySignals: ['核对仓册'],
          usageBoundary: '不得虚构账本数值或偷盗结论。',
        },
        {
          id: 'thread_seal_damage',
          worldBookId: 'wb_test',
          domain: 'logistics',
          motifId: 'seal_damage',
          facet: 'visible_order',
          title: '封识破损',
          summary: '仓门封识破损，需要另行核验交接。',
          entrySignals: ['核对仓册'],
          usageBoundary: '不得直接判定责任人。',
        },
      ],
    };

    const result = buildWorldlineKnowledgeProjection({
      state: makeProjectionState(),
      storyPacks: [storyPack],
      mode: 'default',
      queryTexts: ['去粮仓核对仓册'],
    });

    expect(result.hints.map((hint) => hint.id)).toEqual([
      'thread_ledger_hidden',
      'thread_seal_damage',
    ]);
  });

  it('does not let a generic continue action admit unrelated StoryPack material', () => {
    const storyPack: WorldlineStoryPack = {
      id: 'storypack_generic_continue',
      worldBookId: 'wb_test',
      name: 'Generic Continue Story Pack',
      version: '0.1.0',
      description: 'test',
      threads: [
        {
          id: 'thread_specific_transport',
          worldBookId: 'wb_test',
          title: '季节断运',
          summary: '道路和水位变化造成运输压力。',
          entrySignals: ['检查粮道'],
          relatedTags: ['季节断运'],
          usageBoundary: '只提供运输压力。',
        },
      ],
    };

    const result = buildWorldlineKnowledgeProjection({
      state: makeProjectionState(),
      storyPacks: [storyPack],
      mode: 'default',
      queryTexts: ['继续'],
    });

    expect(result.hints).toEqual([]);
  });

  it('keeps independent KnowledgeBase and StoryPack limits instead of sharing one quota', () => {
    const cards = Array.from({ length: 8 }, (_, index) => makeCard({
      id: `relevant_card_${index}`,
      title: `Relevant card ${index}`,
      relatedPlaceIds: ['loc_relevant'],
      strictness: 'light',
    }));
    const storyPack: WorldlineStoryPack = {
      id: 'storypack_independent_budget',
      worldBookId: 'wb_test',
      name: 'Independent Budget Story Pack',
      version: '0.1.0',
      description: 'test',
      threads: Array.from({ length: 8 }, (_, index) => ({
        id: `relevant_thread_${index}`,
        worldBookId: 'wb_test',
        title: `Relevant thread ${index}`,
        summary: `Relevant summary ${index}`,
        relatedPlaceIds: ['loc_relevant'],
        usageBoundary: 'Only use when relevant.',
      })),
    };

    const result = buildWorldlineKnowledgeProjection({
      state: makeProjectionState({ currentLocationId: 'loc_relevant' }),
      knowledgeBase: makeKnowledgeBase(cards),
      storyPacks: [storyPack],
      mode: 'strict',
    });

    expect(result.hints.filter((hint) => hint.sourceType === 'knowledgeBase')).toHaveLength(6);
    expect(result.hints.filter((hint) => hint.sourceType === 'storyPack')).toHaveLength(6);
    expect(result.hints).toHaveLength(12);
  });

  it('enforces the StoryPack character budget after relevance ranking', () => {
    const storyPack: WorldlineStoryPack = {
      id: 'storypack_character_budget',
      worldBookId: 'wb_test',
      name: 'Character Budget Story Pack',
      version: '0.1.0',
      description: 'test',
      threads: Array.from({ length: 2 }, (_, index) => ({
        id: `long_thread_${index}`,
        worldBookId: 'wb_test',
        title: `Long thread ${index}`,
        summary: `粮${'草'.repeat(2250)}`,
        relatedPlaceIds: ['loc_relevant'],
        usageBoundary: 'Only use when relevant.',
      })),
    };

    const result = buildWorldlineKnowledgeProjection({
      state: makeProjectionState({ currentLocationId: 'loc_relevant' }),
      storyPacks: [storyPack],
      mode: 'light',
    });

    expect(result.hints.filter((hint) => hint.sourceType === 'storyPack')).toHaveLength(1);
  });

  it('keeps only light-compatible major anchors in light mode', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: runtimeState,
      knowledgeBase,
      storyPacks: [],
      mode: 'light',
    });

    expect(result.hints.map((hint) => hint.id)).toEqual(['critical_luoyang']);
  });

  it('selects relevant default cards by present npc', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: runtimeState,
      knowledgeBase,
      storyPacks: [],
      mode: 'default',
    });

    expect(result.hints.map((hint) => hint.id)).toContain('critical_luoyang');
    expect(result.hints.map((hint) => hint.id)).toContain('caocao_early');
    expect(result.hints.map((hint) => hint.id)).not.toContain('guandu_strict');
  });

  it('does not include out-of-period strict cards only because strict mode is enabled', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: runtimeState,
      knowledgeBase,
      storyPacks: [],
      mode: 'strict',
    });

    expect(result.hints.map((hint) => hint.id)).not.toContain('guandu_strict');
  });

  it('does not use broad tag mentions inside long situation summaries to bypass card time ranges', () => {
    const broadTagKnowledgeBase: WorldlineKnowledgeBase = {
      id: 'kb_broad_tag',
      worldBookId: 'wb_test',
      name: 'Broad Tag Test Knowledge Base',
      version: '0.1.0',
      description: 'test',
      cards: [
        {
          id: 'current_longzhong',
          worldBookId: 'wb_test',
          kind: 'event',
          title: '207 年隆中对',
          summary: '刘备与诸葛亮在荆州阶段讨论战略蓝图。',
          timeRange: { start: '公元207年', end: '公元207年' },
          relatedPlaceIds: ['region_jingzhou'],
          relatedTags: ['隆中对', '荆州'],
          importance: 'critical',
          strictness: 'light',
        },
        {
          id: 'future_jingzhou_guard',
          worldBookId: 'wb_test',
          kind: 'personTimeline',
          title: '关羽 214-219 荆州守将',
          summary: '关羽后期留守荆州，不应在 207 年因宽标签误入当前提示。',
          timeRange: { start: '公元214年', end: '公元219年' },
          relatedPlaceIds: ['region_jingzhou'],
          relatedTags: ['荆州'],
          importance: 'critical',
          strictness: 'light',
        },
      ],
    };

    const result = buildWorldlineKnowledgeProjection({
      state: {
        ...runtimeState,
        worldBookId: 'wb_test',
        currentDate: '公元207年冬',
        currentLocationId: 'region_jingzhou',
        npcs: [],
        worldTrends: [
          {
            trendId: 'trend_longzhong',
            title: '207 隆中对',
            summary: '荆州仍在刘表治下，刘备寄人篱下，隆中对刚刚展开。',
            knownToPlayer: true,
            updatedAt: '公元207年冬',
          },
        ],
      } as unknown as RuntimeState,
      knowledgeBase: broadTagKnowledgeBase,
      storyPacks: [],
      mode: 'default',
    });

    expect(result.hints.map((hint) => hint.id)).toContain('current_longzhong');
    expect(result.hints.map((hint) => hint.id)).not.toContain('future_jingzhou_guard');
  });

  it('allows an out-of-period strict card when the current situation explicitly references it', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: {
        ...runtimeState,
        activeQuests: [
          {
            id: 'quest_guandu_discussion',
            title: '有人提起官渡',
            description: '玩家正在询问官渡与乌巢的传闻真假。',
            status: 'active',
            priority: 'medium',
            visibility: 'visible',
            currentStep: '辨别传闻',
            stakes: '避免把后期桥段误作当前事',
            relatedNpcIds: [],
            relatedPlaceIds: [],
            consequenceTags: ['官渡', '乌巢'],
            createdAt: runtimeState.currentDate,
            updatedAt: runtimeState.currentDate,
          },
        ],
      } as unknown as RuntimeState,
      knowledgeBase,
      storyPacks: [],
      mode: 'strict',
    });

    expect(result.hints.map((hint) => hint.id)).toContain('guandu_strict');
    expect(result.text).toContain('不得照搬乌巢');
  });
  it('prioritizes explicitly referenced correction cards over generic high-score anchors', () => {
    const crowdedKnowledgeBase: WorldlineKnowledgeBase = {
      id: 'kb_crowded',
      worldBookId: 'wb_test',
      name: 'Crowded Test Knowledge Base',
      version: '0.1.0',
      description: 'test',
      cards: [
        ...Array.from({ length: 6 }, (_, index) => ({
          id: `generic_anchor_${index + 1}`,
          worldBookId: 'wb_test',
          kind: 'eraAnchor' as const,
          title: `Generic current anchor ${index + 1}`,
          summary: `Generic current anchor ${index + 1}.`,
          timeRange: { start: 'AD 189', end: 'AD 190' },
          relatedPlaceIds: ['loc_luoyang'],
          importance: 'critical' as const,
          strictness: 'light' as const,
        })),
        {
          id: 'guandu_future_correction',
          worldBookId: 'wb_test',
          kind: 'event',
          title: 'Guandu is not a current fact',
          summary: 'Guandu belongs to a later possible situation and should only correct explicit references.',
          timeRange: { start: 'AD 199', end: 'AD 200' },
          relatedTags: ['guandu', 'wuchao'],
          importance: 'major',
          strictness: 'strict',
        },
      ],
    };

    const result = buildWorldlineKnowledgeProjection({
      state: {
        ...runtimeState,
        currentDate: 'AD 189-09-01 08:00',
        activeQuests: [
          {
            id: 'quest_guandu_claim',
            title: 'Verify Guandu claim',
            description: 'Someone claims Guandu and Wuchao already happened.',
            status: 'active',
            priority: 'high',
            consequenceTags: ['guandu', 'wuchao'],
            createdAt: 'AD 189-09-01 08:00',
            updatedAt: 'AD 189-09-01 08:00',
          },
        ],
      } as unknown as RuntimeState,
      knowledgeBase: crowdedKnowledgeBase,
      storyPacks: [],
      mode: 'strict',
    });

    expect(result.hints.map((hint) => hint.id)).toContain('guandu_future_correction');
  });

  it('reserves a bounded slot for a present historical NPC instead of filling the limit with generic anchors', () => {
    const crowdedKnowledgeBase = makeKnowledgeBase([
      ...Array.from({ length: 5 }, (_, index) => makeCard({
        id: `generic_place_anchor_${index + 1}`,
        kind: 'eraAnchor',
        title: `Generic place anchor ${index + 1}`,
        relatedPlaceIds: ['loc_market'],
        importance: 'critical',
        strictness: 'light',
      })),
      makeCard({
        id: 'present_historical_npc_anchor',
        kind: 'personTimeline',
        title: '曹操当前阶段人物锚点',
        relatedNpcNames: ['袁绍', '曹操'],
        importance: 'normal',
        strictness: 'light',
      }),
    ]);

    const result = buildWorldlineKnowledgeProjection({
      state: makeProjectionState({
        npcs: [
          { npcId: 'npc_caocao', name: '曹操', isPresent: true, isFocused: false, memories: [] },
        ],
        activeQuests: [
          {
            id: 'quest_yuanshao_report',
            title: '袁绍来信',
            description: '袁绍的使者正在等候答复。',
            status: 'active',
            priority: 'normal',
            createdAt: '公元189年09月01日 08:00（辰时）',
            updatedAt: '公元189年09月01日 08:00（辰时）',
          },
        ],
      } as unknown as Partial<RuntimeState>),
      knowledgeBase: crowdedKnowledgeBase,
      storyPacks: [],
      mode: 'default',
    });

    expect(result.hints).toHaveLength(4);
    expect(result.hints.map((hint) => hint.id)).toContain('present_historical_npc_anchor');
  });

  it('projects a delayed historical candidate with an explicit non-railroad boundary', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: makeProjectionState({
        currentDate: '公元198年01月01日',
        activeQuests: [{
          id: 'quest_yuanshu',
          title: '袁术与仲氏名号',
          description: '使者正在核实袁术近况。',
          status: 'active',
          priority: 'high',
          consequenceTags: ['袁术'],
          createdAt: '公元198年01月01日',
          updatedAt: '公元198年01月01日',
        }],
      }),
      knowledgeBase: makeKnowledgeBase([makeCard({
        id: 'tk_event_yuanshu',
        title: '袁术称帝',
        relatedTags: ['袁术'],
        historicalEvent: {
          historicalWindow: {
            earliest: '公元197年',
            typical: '公元197年',
            latest: '公元199年',
          },
          structuralPressure: '名号、合法性与联盟关系仍承受压力。',
          divergencePolicy: {
            mayDelay: true,
            mayTransform: true,
            suppressWhenContradicted: true,
          },
        },
      })]),
      storyPacks: [],
      mode: 'default',
    });

    expect(result.hints).toHaveLength(1);
    expect(result.hints[0]).toMatchObject({
      id: 'tk_event_yuanshu',
      applicability: 'delayed_candidate',
    });
    expect(result.hints[0]?.text).toContain('不代表必然');
    expect(result.hints[0]?.text).toContain('仍存结构压力');
    expect(result.hints[0]?.reason).toContain('applicability=delayed_candidate');
  });

  it('suppresses a realized historical event unless the current state explicitly refers to it as history', () => {
    const card = makeCard({
      id: 'tk_event_realized',
      title: '已经发生的历史事件',
      relatedTags: ['历史事件'],
      historicalEvent: {
        historicalWindow: {
          earliest: '公元189年',
          typical: '公元189年',
          latest: '公元191年',
        },
        divergencePolicy: {
          mayDelay: true,
          mayTransform: false,
          suppressWhenContradicted: true,
        },
      },
    });
    const realizedState = makeProjectionState({
      worldTrends: [{
        trendId: 'trend_realized',
        title: '历史事件已经成为本局事实',
        severity: '高',
        summary: '区域结果已经确认。',
        knownToPlayer: true,
        status: 'historical',
        scope: 'regional',
        certainty: 'confirmed',
        consequenceTags: ['worldline:realized:tk_event_realized'],
        updatedAt: '公元189年01月01日',
      }],
    });

    expect(buildWorldlineKnowledgeProjection({
      state: realizedState,
      knowledgeBase: makeKnowledgeBase([card]),
      storyPacks: [],
      mode: 'default',
    }).hints).toEqual([]);

    const explicitReference = buildWorldlineKnowledgeProjection({
      state: {
        ...realizedState,
        activeQuests: [{
          id: 'quest_history',
          title: '查阅已经发生的历史事件',
          description: '只核对旧档。',
          status: 'active',
          priority: 'high',
          consequenceTags: ['历史事件'],
          createdAt: '公元190年01月01日',
          updatedAt: '公元190年01月01日',
        }],
      },
      knowledgeBase: makeKnowledgeBase([card]),
      storyPacks: [],
      mode: 'default',
    });

    expect(explicitReference.hints[0]).toMatchObject({
      id: 'tk_event_realized',
      applicability: 'realized',
    });
    expect(explicitReference.hints[0]?.text).toContain('不得重演');
  });
});
