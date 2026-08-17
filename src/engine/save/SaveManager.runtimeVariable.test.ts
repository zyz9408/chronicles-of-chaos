import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { resetLocalDatabaseForTests } from '../storage/IndexedDbStore';
import type { RuntimeState } from '../types';
import {
  commitRuntimeVariableEdit,
  createSave,
  hasRestorableRuntimeVariableCheckpoint,
  loadSave,
  restoreRuntimeVariableCheckpoint,
  saveCurrentState,
} from './SaveManager';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'runtime-variable-checkpoint-world',
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

describe('runtime variable checkpoints', () => {
  beforeEach(async () => {
    await resetLocalDatabaseForTests();
  });

  it('atomically saves and restores a variable edit without adding a turn snapshot', async () => {
    const before = makeState();
    const created = await createSave(before, 'runtime variable checkpoint');
    const after = structuredClone(before);
    after.resources!.grain = 2000;

    const committed = await commitRuntimeVariableEdit({
      saveId: created.id,
      previousRuntimeState: before,
      runtimeState: after,
      summary: '府库 · 粮草 1000 → 2000',
    });
    expect(committed?.save.runtimeState.resources?.grain).toBe(2000);
    expect(committed?.save.runtimeState.turnLog).toHaveLength(0);
    expect(await hasRestorableRuntimeVariableCheckpoint(created.id)).toBe(true);

    const restored = await restoreRuntimeVariableCheckpoint(created.id);
    expect(restored?.runtimeState.resources?.grain).toBe(before.resources?.grain);
    expect(restored?.runtimeState.currentDate).toBe(before.currentDate);
    expect(restored?.runtimeState.turnLog).toHaveLength(0);
    expect(await hasRestorableRuntimeVariableCheckpoint(created.id)).toBe(false);
  });

  it('refuses stale undo after any later state save', async () => {
    const before = makeState();
    const created = await createSave(before, 'stale runtime variable checkpoint');
    const edited = structuredClone(before);
    edited.resources!.grain = 2000;
    await commitRuntimeVariableEdit({
      saveId: created.id,
      previousRuntimeState: before,
      runtimeState: edited,
      summary: '府库粮草修正',
    });

    const later = structuredClone(edited);
    later.resources!.horses = 3;
    await saveCurrentState(created.id, later);
    expect(await hasRestorableRuntimeVariableCheckpoint(created.id)).toBe(false);
    expect(await restoreRuntimeVariableCheckpoint(created.id)).toBeNull();
    expect((await loadSave(created.id))?.runtimeState.resources?.horses).toBe(3);
  });
});
