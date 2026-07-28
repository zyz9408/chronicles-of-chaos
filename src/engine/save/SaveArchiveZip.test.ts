import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { RuntimeState, SaveData } from '../types';
import type { SaveArchive } from './SaveManager';
import {
  createPortableSaveZip,
  parsePortableSaveZip,
  PORTABLE_SAVE_ZIP_FORMAT,
} from './SaveArchiveZip';

function makeState(name: string, turnCount: number): RuntimeState {
  return {
    engineVersion: '0.1.0',
    worldBookId: 'test-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '公元184年03月01日',
    currentDate: '公元184年03月02日',
    player: { id: 'player', name, roleType: 'player', summary: '测试主角' },
    currentLocationId: 'test-place',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: Array.from({ length: turnCount }, (_, index) => ({
      turnNumber: index + 1,
      date: '公元184年03月02日',
      playerInput: `行动${index + 1}`,
      narrativeText: `正文${index + 1}`,
      statePatchSummary: '测试',
      timestamp: '2026-07-16T00:00:00.000Z',
    })),
    localSituationNotes: [],
  } as RuntimeState;
}

function makeSave(id: string, kind: 'manual' | 'auto', name: string): SaveData {
  const runtimeState = makeState(name, kind === 'manual' ? 2 : 3);
  return {
    id,
    label: `${name}存档`,
    saveKind: kind,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:01:00.000Z',
    engineVersion: '0.1.0',
    worldBookId: runtimeState.worldBookId,
    worldBookVersion: runtimeState.worldBookVersion,
    worldBookSource: runtimeState.worldBookSource,
    startDate: runtimeState.startDate,
    currentDate: runtimeState.currentDate,
    runtimeState,
  };
}

describe('SaveArchiveZip', () => {
  it('writes separate save files, rollback files, a manifest, and image placeholders', async () => {
    const manual = makeSave('manual-1', 'manual', '刘平');
    const auto = makeSave('auto-1', 'auto', '刘平');
    const archive: SaveArchive = {
      schema: 'coc.v2.saves',
      version: 2,
      exportedAt: '2026-07-16T00:02:00.000Z',
      lastSaveId: auto.id,
      saves: [manual, auto],
      turnSnapshots: [{
        id: 'auto-1:3',
        saveId: auto.id,
        turnNumber: 3,
        snapshot: {
          beforeState: makeState('刘平', 2),
          actionText: '继续行动',
          createdAt: '2026-07-16T00:01:30.000Z',
        },
        createdAt: '2026-07-16T00:01:30.000Z',
      }],
    };

    const bytes = await createPortableSaveZip(archive);
    const entries = unzipSync(bytes);
    const paths = Object.keys(entries);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));

    expect(manifest.format).toBe(PORTABLE_SAVE_ZIP_FORMAT);
    expect(paths.filter((path) => path.startsWith('saves/manual/'))).toHaveLength(1);
    expect(paths.filter((path) => path.startsWith('saves/auto/'))).toHaveLength(1);
    expect(paths.filter((path) => path.startsWith('rollback/'))).toHaveLength(1);
    expect(paths).toEqual(expect.arrayContaining([
      'assets/images/characters/.keep',
      'assets/images/locations/.keep',
      'assets/images/events/.keep',
      'assets/images/objects/.keep',
    ]));

    await expect(parsePortableSaveZip(bytes)).resolves.toEqual(archive);
  });
});
