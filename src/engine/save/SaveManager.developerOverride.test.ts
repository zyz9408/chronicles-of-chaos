import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { resetLocalDatabaseForTests } from '../storage/IndexedDbStore';
import type { RuntimeState } from '../types';
import {
  commitDeveloperOverride,
  createSave,
  hasRestorableDeveloperOverrideCheckpoint,
  loadSave,
  restoreDeveloperOverrideCheckpoint,
  saveCurrentState,
} from './SaveManager';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'developer-checkpoint-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '公元184年03月01日',
    currentDate: '公元184年03月01日',
    player: { id: 'player_1', name: '林砚', roleType: 'officer', summary: '测试角色' },
    currentLocationId: 'place_test',
    currentPlaceId: 'place_test',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
  });
}

describe('developer override checkpoints', () => {
  beforeEach(async () => {
    await resetLocalDatabaseForTests();
  });

  it('atomically saves the corrected state and restores the pre-command state without changing turns', async () => {
    const before = makeState();
    const created = await createSave(before, 'developer checkpoint');
    const after = structuredClone(before);
    after.resources!.grain = 2000;

    const committed = await commitDeveloperOverride({
      saveId: created.id,
      previousRuntimeState: before,
      runtimeState: after,
      commandText: '/dev 府库粮草应该是2000石',
    });
    expect(committed?.save.runtimeState.resources?.grain).toBe(2000);
    expect(committed?.save.runtimeState.turnLog).toHaveLength(0);
    expect(await hasRestorableDeveloperOverrideCheckpoint(created.id)).toBe(true);

    const restored = await restoreDeveloperOverrideCheckpoint(created.id);
    expect(restored?.runtimeState.resources?.grain).toBe(before.resources?.grain);
    expect(restored?.runtimeState.currentDate).toBe(before.currentDate);
    expect(restored?.runtimeState.turnLog).toHaveLength(0);
    expect(await hasRestorableDeveloperOverrideCheckpoint(created.id)).toBe(false);
  });

  it('refuses a stale checkpoint after any later save', async () => {
    const before = makeState();
    const created = await createSave(before, 'stale developer checkpoint');
    const corrected = structuredClone(before);
    corrected.resources!.grain = 2000;
    await commitDeveloperOverride({
      saveId: created.id,
      previousRuntimeState: before,
      runtimeState: corrected,
      commandText: '/dev 府库粮草应该是2000石',
    });

    const later = structuredClone(corrected);
    later.resources!.horses = 3;
    await saveCurrentState(created.id, later);
    expect(await hasRestorableDeveloperOverrideCheckpoint(created.id)).toBe(false);
    expect(await restoreDeveloperOverrideCheckpoint(created.id)).toBeNull();
    expect((await loadSave(created.id))?.runtimeState.resources?.horses).toBe(3);
  });
});
