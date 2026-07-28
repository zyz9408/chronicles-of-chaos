import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { applyNarratorWriteback } from './NarratorWritebackApplier';
import { parseNarratorResponse } from './NarratorResponseParser';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0', worldBookId: 'test', worldBookVersion: '0.1.0', worldBookSource: 'official',
    startDate: '0189-09-01 08:00', currentDate: '0189-09-10 12:00',
    currentTime: { year: 189, month: 9, day: 10, hour: 12, minute: 0 },
    player: { id: 'player', name: 'Player', roleType: 'traveler', summary: 'Test.' },
    currentLocationId: 'place_gate', knownActors: [], knownFactions: [], relationships: [], knownRumors: [],
    activeQuests: [], playerResources: {}, worldStateDelta: {}, turnLog: [], localSituationNotes: [],
    worldTrends: [{
      trendId: 'trend_border_pressure', title: 'Border pressure', severity: '高',
      summary: 'Enemy scouts remain active.', knownToPlayer: true, status: 'active',
      scope: 'regional', sourceConflictIds: ['conflict_border'], happenedAt: '0189-09-10 08:00',
      updatedAt: '0189-09-10 08:00',
    }],
  });
}

describe('world evolution writeback fields', () => {
  it('parses and applies progress and review anchors on an existing world event', () => {
    const parsed = parseNarratorResponse(JSON.stringify({
      protocolVersion: 'coc.v2',
      narrativeText: '斥候带回了新的渡口动向。',
      statePatches: [],
      writeback: {
        npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [], questChanges: [],
        worldEventUpdates: [{
          eventId: 'trend_border_pressure',
          progressSummary: '敌军斥候已抵达北岸，但尚未渡河。',
          nextCheckAt: '0189-09-10 18:00',
          lastAdvancedAt: '0189-09-10 12:00',
        }],
        worldEventSummary: null,
        debugNotes: [],
      },
    }));

    expect(parsed.writeback?.worldEventUpdates?.[0]).toMatchObject({
      eventId: 'trend_border_pressure',
      progressSummary: '敌军斥候已抵达北岸，但尚未渡河。',
      nextCheckAt: '0189-09-10 18:00',
      lastAdvancedAt: '0189-09-10 12:00',
    });

    const applied = applyNarratorWriteback(makeState(), parsed.writeback);
    expect(applied.state.worldTrends?.[0]).toMatchObject({
      trendId: 'trend_border_pressure',
      status: 'active',
      progressSummary: '敌军斥候已抵达北岸，但尚未渡河。',
      nextCheckAt: '0189-09-10 18:00',
      lastAdvancedAt: '0189-09-10 12:00',
    });
  });
});
