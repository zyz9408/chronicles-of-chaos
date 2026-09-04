import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { materializeAvgPresentation } from './AvgPresentationMaterializer';

describe('AVG presentation materialization', () => {
  it('freezes a portrait binding and committed scene snapshot idempotently', () => {
    const state = ensureLuanShiState({ engineVersion: '1.8.4', worldBookId: 'threeKingdoms', worldBookVersion: '1', worldBookSource: 'official', startDate: '公元184年03月01日', currentDate: '公元184年03月02日', currentLocationId: 'loc_luoyang', currentPlaceId: 'place_luoyang_palace', player: { id: 'player', name: '刘达', roleType: '游侠' }, knownActors: [{ id: 'historical_guan_yu', name: '关羽', roleType: '武将', sex: '男' }], activeQuests: [], knownRumors: [], localSituationNotes: [], worldStateDelta: {}, turnLog: [{ turnNumber: 1, date: '公元184年03月02日', playerInput: '见关羽', narrativeText: '【关羽】「幸会。」', statePatchSummary: '', timestamp: '2026-01-01T00:00:00.000Z', displayMeta: { presentationSpeakerFacts: [{ segmentIndex: 0, speakerActorId: 'historical_guan_yu', speakerLabel: '关羽', identitySource: 'known_actor', sex: 'male' }] } }] } as unknown as RuntimeState);
    const first = materializeAvgPresentation(state, { saveId: 'save-a', turnNumber: 1, playerPortraitMode: 'hidden' });
    expect(first.changed).toBe(true); expect(first.materializedActorIds).toEqual(['historical_guan_yu']);
    expect(first.state.avgPresentation?.portraitBindings).toHaveLength(1);
    expect(first.state.turnLog[0].avgVisualSnapshot).toMatchObject({ runtimePlaceId: 'place_luoyang_palace', presentActorIds: ['player'] });
    expect(materializeAvgPresentation(first.state, { saveId: 'save-a', turnNumber: 1, playerPortraitMode: 'hidden' }).changed).toBe(false);
  });
});
