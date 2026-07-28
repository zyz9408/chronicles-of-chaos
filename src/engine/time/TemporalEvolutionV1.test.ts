import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { buildTemporalProjection } from './TemporalProjection';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '0189-09-01 08:00',
    currentDate: '0189-09-10 12:00',
    currentTime: { year: 189, month: 9, day: 10, hour: 12, minute: 0 },
    player: { id: 'player', name: 'Player', roleType: 'traveler', summary: 'Test player.' },
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
    plotPlan: [{
      plotId: 'plot_decree_due',
      title: 'The decree may now arrive',
      horizon: '近期',
      status: '待触发',
      description: 'The earliest trigger time has arrived.',
      priority: '高',
      notBeforeAt: '0189-09-10 11:00',
    }],
    worldTrends: [{
      trendId: 'trend_border_pressure',
      title: 'Border pressure',
      severity: 'high',
      summary: 'Enemy scouts remain active.',
      progressSummary: 'Scouts reached the river crossing.',
      nextCheckAt: '0189-09-10 10:30',
      lastAdvancedAt: '0189-09-10 08:00',
      knownToPlayer: true,
      status: 'active',
      scope: 'regional',
      sourceConflictIds: ['conflict_border'],
      happenedAt: '0189-09-10 08:00',
      updatedAt: '0189-09-10 08:00',
    } as any],
    npcs: [
      {
        npcId: 'npc_due', name: 'Due Scout', sex: '男', age: 28, role: 'scout',
        locationId: 'place_river', isPresent: false, isFocused: false,
        summary: 'Scout.', appearance: 'Plain.', personality: 'Careful.', motivation: 'Observe.',
        relationToPlayer: 'Subordinate.', contactLevel: 20, recentAttitude: 'Focused', memories: [],
        backgroundActivity: {
          activityId: 'activity_due_scout', summary: 'Watch the river crossing.', status: 'active',
          locationId: 'place_river', dueAt: '0189-09-10 11:00', visibility: 'hidden',
        },
      },
      {
        npcId: 'npc_future', name: 'Future Envoy', sex: '男', age: 35, role: 'envoy',
        locationId: 'place_capital', isPresent: false, isFocused: false,
        summary: 'Envoy.', appearance: 'Formal.', personality: 'Patient.', motivation: 'Deliver.',
        relationToPlayer: 'Unknown.', contactLevel: 0, recentAttitude: 'Unknown', memories: [],
        backgroundActivity: {
          activityId: 'activity_future_envoy', summary: 'Wait for the next dispatch.', status: 'planned',
          dueAt: '0189-09-12 08:00', visibility: 'hidden',
        },
      },
      {
        npcId: 'npc_stale_reentry', name: 'Returning Officer', sex: '男', age: 40, role: 'officer',
        locationId: 'place_gate', isPresent: true, isFocused: false,
        summary: 'Officer.', appearance: 'Armored.', personality: 'Direct.', motivation: 'Report.',
        relationToPlayer: 'Ally.', contactLevel: 40, recentAttitude: 'Urgent', memories: [],
        backgroundActivity: {
          activityId: 'activity_old_patrol', summary: 'Patrol the remote ridge.', status: 'active',
          locationId: 'place_remote_ridge', dueAt: '0189-09-11 08:00', visibility: 'playerKnown',
        },
      },
    ] as any,
  });
}

describe('Temporal evolution V1 projection', () => {
  it('projects due candidates and re-entry conflicts without mutating facts', () => {
    const state = makeState();
    const projection = buildTemporalProjection(state);

    expect(projection.text).toContain('activity_due_scout');
    expect(projection.text).toContain('review due');
    expect(projection.text).not.toContain('activity_future_envoy');
    expect(projection.text).toContain('npc_stale_reentry');
    expect(projection.text).toContain('re-entry refresh required');
    expect(projection.text).toContain('trend_border_pressure');
    expect(projection.text).toContain('world event review due');
    expect(projection.text).toContain('plot_decree_due');
    expect(projection.text).toContain('eligible for evaluation');
    expect(projection.text).toContain('do not auto-complete');

    expect((state.npcs?.[0] as any).backgroundActivity.status).toBe('active');
    expect((state.worldTrends?.[0] as any).status).toBe('active');
    expect(state.plotPlan?.[0].status).toBe('待触发');
  });
});
