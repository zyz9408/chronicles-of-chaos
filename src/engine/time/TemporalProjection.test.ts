import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { buildTemporalProjection } from './TemporalProjection';

function makeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '0189-09-01 08:00',
    currentDate: '0189-09-10 08:00',
    currentTime: { year: 189, month: 9, day: 10, hour: 8, minute: 0 },
    player: {
      id: 'player',
      name: 'Player',
      roleType: 'traveler',
      summary: 'A test player.',
    },
    currentLocationId: 'place_gate',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    ...overrides,
  });
}

describe('buildTemporalProjection', () => {
  it('marks overdue quests and stale signals for LLM adjudication without mutating state', () => {
    const state = makeState({
      activeQuests: [
        {
          id: 'quest_gate_warning',
          title: 'Warn the gate guard',
          description: 'Warn the gate guard before dawn.',
          status: 'active',
          deadlineAt: '0189-09-09 08:00',
          createdAt: '0189-09-08 08:00',
          updatedAt: '0189-09-08 08:00',
        },
      ],
      knownRumors: [
        {
          id: 'signal_bridge_watch',
          title: 'Bridge watch',
          content: 'Travelers say strangers are watching the bridge.',
          source: 'traveler',
          expiresAt: '0189-09-09 20:00',
          verified: false,
          createdAt: '0189-09-08 08:00',
        },
      ],
    });

    const projection = buildTemporalProjection(state);

    expect(projection.text).toContain('quest_gate_warning');
    expect(projection.text).toContain('deadline reached');
    expect(projection.text).toContain('needs adjudication');
    expect(projection.text).toContain('signal_bridge_watch');
    expect(projection.text).toContain('possibly stale');
    expect(projection.text).toContain('verify before using');
    expect(state.activeQuests[0].status).toBe('active');
    expect(state.knownRumors[0].verified).toBe(false);
  });

  it('keeps future plot plans as foreshadowing only before notBeforeAt', () => {
    const state = makeState({
      plotPlan: [
        {
          plotId: 'plot_late_decree',
          title: 'Late decree pressure',
          horizon: '中期' as any,
          status: '进行中' as any,
          description: 'Court pressure will mature later.',
          priority: '高' as any,
          notBeforeAt: '0189-09-20 08:00',
        },
      ],
    } as Partial<RuntimeState>);

    const projection = buildTemporalProjection(state);

    expect(projection.text).toContain('plot_late_decree');
    expect(projection.text).toContain('not before');
    expect(projection.text).toContain('foreshadow only');
  });

  it.each(['已完成', '废弃'] as const)(
    'does not project closed plot plans with status %s',
    (status) => {
      const state = makeState({
        plotPlan: [
          {
            plotId: `plot_closed_${status}`,
            title: 'Closed plot plan',
            horizon: '中期',
            status,
            description: 'This plan must no longer enter temporal projection.',
            priority: '高',
            notBeforeAt: '0189-09-20 08:00',
          },
        ],
      });

      const projection = buildTemporalProjection(state);

      expect(projection.lines).toEqual([]);
      expect(projection.text).toBe('');
    },
  );

  it('keeps happenedAt and learnedAt distinct for delayed world chronicles', () => {
    const state = makeState({
      worldTrends: [
        {
          trendId: 'trend_delayed_news',
          title: 'Delayed capital decree',
          severity: 'high' as any,
          summary: 'A capital decree reached the player late.',
          knownToPlayer: true,
          status: 'historical',
          scope: 'realm',
          affectedFactionIds: ['faction_court'],
          happenedAt: '0189-09-01 08:00',
          learnedAt: '0189-09-10 08:00',
          updatedAt: '0189-09-10 08:00',
        },
      ],
    });

    const projection = buildTemporalProjection(state);

    expect(projection.text).toContain('trend_delayed_news');
    expect(projection.text).toContain('happenedAt=0189-09-01 08:00');
    expect(projection.text).toContain('learnedAt=0189-09-10 08:00');
  });
});
