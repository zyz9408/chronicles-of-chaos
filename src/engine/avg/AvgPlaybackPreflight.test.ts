import { describe, expect, it, vi } from 'vitest';
import type { RuntimeState, TurnLogEntry } from '../types';
import type { AvgResourcePackManager } from './AvgResourcePackManager';
import type { IndexedDbAvgVisualOverrideRepository } from './AvgVisualOverrideRepository';
import { preflightAvgPlayback } from './AvgPlaybackPreflight';

const turn: TurnLogEntry = {
  turnNumber: 1, date: '', playerInput: '', narrativeText: '【关羽】在。', statePatchSummary: '', timestamp: '',
  avgVisualSnapshot: { schemaVersion: 1, runtimePlaceId: 'place', timeText: '', weatherText: '', presentActorIds: [] },
  avgPresentation: { sceneBinding: { sceneResourceId: 'avg:threeKingdoms:scene:test', source: 'registry-exact' }, speakerBindings: [] },
};
const state = { worldBookId: 'threeKingdoms', player: { id: 'player' }, knownActors: [], npcs: [], avgPresentation: { visualPartitionId: 'partition' } } as unknown as RuntimeState;

describe('AVG playback visual preflight', () => {
  it('keeps the full classic narrative when a required image is missing', async () => {
    const packs = { lookupActiveAsset: vi.fn().mockResolvedValue(undefined), lookupActiveResource: vi.fn().mockResolvedValue(undefined) } as unknown as AvgResourcePackManager;
    const overrides = { lookup: vi.fn().mockResolvedValue({ status: 'missing' }) } as unknown as IndexedDbAvgVisualOverrideRepository;
    await expect(preflightAvgPlayback(state, 'save', turn, 'hidden', { packs, overrides })).resolves.toEqual({ status: 'warning', missingResourceIds: ['avg:threeKingdoms:scene:test'] });
  });

  it('accepts a verified local override without reading a missing pack image', async () => {
    const packs = { lookupActiveAsset: vi.fn(), lookupActiveResource: vi.fn() } as unknown as AvgResourcePackManager;
    const overrides = { lookup: vi.fn().mockResolvedValue({ status: 'found', blob: new Blob(['image']) }) } as unknown as IndexedDbAvgVisualOverrideRepository;
    await expect(preflightAvgPlayback(state, 'save', turn, 'hidden', { packs, overrides })).resolves.toEqual({ status: 'ready', missingResourceIds: [] });
    expect(packs.lookupActiveAsset).not.toHaveBeenCalled();
  });
});
