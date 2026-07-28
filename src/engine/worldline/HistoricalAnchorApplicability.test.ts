import { describe, expect, it } from 'vitest';
import type { RuntimeState, WorldlineKnowledgeCard } from '../types';
import {
  evaluateHistoricalAnchorApplicability,
  normalizeHistoricalAnchorStates,
} from './HistoricalAnchorApplicability';

function makeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    engineVersion: '0.1.0',
    worldBookId: 'wb_test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '公元197年01月01日',
    currentDate: '公元197年01月01日',
    player: {
      id: 'player',
      name: '测试者',
      roleType: '游侠',
      summary: '测试主角',
    },
    currentLocationId: 'loc_test',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    npcs: [],
    holdings: [],
    troops: [],
    worldTrends: [],
    ...overrides,
  };
}

function makeCard(overrides: Partial<WorldlineKnowledgeCard> = {}): WorldlineKnowledgeCard {
  return {
    id: 'tk_event_test',
    worldBookId: 'wb_test',
    kind: 'event',
    title: '测试史实事件',
    summary: '测试摘要',
    importance: 'major',
    strictness: 'default',
    historicalEvent: {
      historicalWindow: {
        earliest: '公元197年',
        typical: '公元197年',
        latest: '公元199年',
        afterlifeUntil: '公元205年',
      },
      structuralPressure: '原有权力矛盾仍可能以本局形式出现。',
      divergencePolicy: {
        mayDelay: true,
        mayTransform: true,
        suppressWhenContradicted: true,
      },
    },
    ...overrides,
  };
}

describe('HistoricalAnchorApplicability', () => {
  it('classifies normal, delayed and expired windows without making the event happen', () => {
    expect(evaluateHistoricalAnchorApplicability(makeCard(), makeState())?.disposition)
      .toBe('baseline_possible');
    expect(evaluateHistoricalAnchorApplicability(
      makeCard(),
      makeState({ currentDate: '公元198年06月01日' }),
    )?.disposition).toBe('delayed_candidate');

    const expired = evaluateHistoricalAnchorApplicability(
      makeCard(),
      makeState({ currentDate: '公元200年01月01日' }),
    );
    expect(expired).toMatchObject({ disposition: 'expired', eligible: false });
  });

  it('turns a contradicted hard prerequisite into a transformed candidate only when policy allows it', () => {
    const card = makeCard({
      historicalEvent: {
        ...makeCard().historicalEvent!,
        hardPrerequisites: [{
          kind: 'holdingController',
          holdingId: 'holding_xuzhou',
          allowedControllerIds: ['faction_taoqian'],
        }],
      },
    });
    const state = makeState({
      holdings: [{
        holdingId: 'holding_xuzhou',
        name: '徐州',
        type: 'commandery',
        status: 'controlled',
        summary: '本局已由另一势力控制。',
        actualController: 'faction_player',
        scaleLevel: 3,
        agriculture: 50,
        commerce: 50,
        population: 50,
        publicOrder: 50,
        popularSupport: 50,
        defense: 50,
        recruitPotential: 50,
        armory: 50,
        horseSupply: 50,
        corruption: 0,
        updatedAt: '公元197年01月01日',
      }],
    });

    expect(evaluateHistoricalAnchorApplicability(card, state)).toMatchObject({
      disposition: 'transformed_candidate',
      eligible: true,
    });

    const fixedCard = makeCard({
      historicalEvent: {
        ...card.historicalEvent!,
        divergencePolicy: {
          mayDelay: false,
          mayTransform: false,
          suppressWhenContradicted: true,
        },
      },
    });
    expect(evaluateHistoricalAnchorApplicability(fixedCard, state)).toMatchObject({
      disposition: 'diverged',
      eligible: false,
    });
  });

  it('treats the terminal ledger as authoritative over calendar eligibility', () => {
    const result = evaluateHistoricalAnchorApplicability(
      makeCard(),
      makeState({
        worldlineAnchorStates: [{
          cardId: 'tk_event_test',
          disposition: 'realized',
          assessedAt: '公元196年12月01日',
          factRefs: ['worldTrend:trend_test'],
          outcomeRef: 'worldTrend:trend_test',
        }],
      }),
    );

    expect(result).toMatchObject({
      disposition: 'realized',
      eligible: false,
    });
  });

  it('accepts a canonical historical anchor id while preserving legacy card-id terminal entries', () => {
    const canonicalCard = makeCard({
      id: 'tk_event_source_card',
      historicalAnchorId: 'tk_manifest_event',
    });
    const canonical = evaluateHistoricalAnchorApplicability(
      canonicalCard,
      makeState({
        worldlineAnchorStates: [{
          cardId: 'tk_manifest_event',
          disposition: 'diverged',
          assessedAt: '公元197年01月01日',
          factRefs: ['worldTrend:trend_diverged'],
        }],
      }),
    );
    expect(canonical).toMatchObject({ disposition: 'diverged', eligible: false });

    const legacy = evaluateHistoricalAnchorApplicability(
      canonicalCard,
      makeState({
        worldlineAnchorStates: [{
          cardId: 'tk_event_source_card',
          disposition: 'realized',
          assessedAt: '公元197年01月01日',
          factRefs: ['worldTrend:trend_realized'],
        }],
      }),
    );
    expect(legacy).toMatchObject({ disposition: 'realized', eligible: false });
  });

  it('derives terminal states only from confirmed regional-or-higher chronicles with explicit tags', () => {
    const normalized = normalizeHistoricalAnchorStates(
      undefined,
      [
        {
          trendId: 'trend_confirmed',
          title: '本局等价结果已经成立',
          severity: '高',
          summary: '区域格局已经改变。',
          knownToPlayer: true,
          status: 'historical',
          scope: 'regional',
          certainty: 'confirmed',
          consequenceTags: ['worldline:realized:tk_event_test'],
          updatedAt: '公元198年01月01日',
        },
        {
          trendId: 'trend_rumor',
          title: '未经证实的传闻',
          severity: '中',
          summary: '只是传闻。',
          knownToPlayer: true,
          scope: 'realm',
          certainty: 'rumor',
          consequenceTags: ['worldline:diverged:tk_should_not_write'],
          updatedAt: '公元198年01月01日',
        },
        {
          trendId: 'trend_local',
          title: '地方琐事',
          severity: '低',
          summary: '只影响本地。',
          knownToPlayer: true,
          scope: 'local',
          certainty: 'confirmed',
          consequenceTags: ['worldline:realized:tk_local_should_not_write'],
          updatedAt: '公元198年01月01日',
        },
      ],
      '公元198年01月01日',
    );

    expect(normalized).toEqual([{
      cardId: 'tk_event_test',
      disposition: 'realized',
      assessedAt: '公元198年01月01日',
      factRefs: ['worldTrend:trend_confirmed'],
      outcomeRef: 'worldTrend:trend_confirmed',
      note: '由天下纪事“本局等价结果已经成立”确认。',
    }]);
  });
});
