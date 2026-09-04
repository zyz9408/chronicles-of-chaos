import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeState, SaveData } from '../types';
import type { SaveArchive } from './SaveManager';
import { startHoldingGovernanceProject } from '../holdings/HoldingGovernanceProjects';
import {
  createPortableSaveZip,
  parsePortableSaveZip,
  parsePortableSaveZipBundle,
  PORTABLE_SAVE_ZIP_FORMAT,
  readSaveArchiveFile,
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('preserves unique-art progress evidence and holding-governance projects', async () => {
    const save = makeSave('manual-governance', 'manual', '刘平');
    save.runtimeState.player.uniqueArts = [{
      id: 'art_governance_test',
      name: '屯田经略',
      rarity: 'purple',
      domain: 'governance',
      level: 3,
      maxLevel: 10,
      progress: 45,
      bankedProgress: 6,
      description: '统筹屯田、田册与民户。',
      effectSummary: '用于结构化领地治理。',
      source: 'background',
      acquisition: {
        kind: 'background',
        occurredAt: '公元184年03月01日',
        sourceRefId: 'background:governance-test',
        summary: '开局前已有的屯田经验。',
      },
      progressHistory: [{
        eventId: 'progress:governance-test',
        source: 'actual_use',
        intensity: 'normal',
        occurredAt: '公元184年03月02日',
        sourceRefId: 'turn:2:governance-test',
        summary: '在屯田营中实际清点田册。',
        awardedProgress: 7,
        levelBefore: 3,
        progressBefore: 38,
        levelAfter: 3,
        progressAfter: 45,
        levelledUp: false,
        appliedTurnKey: '2:公元184年03月02日',
      }],
    }];
    save.runtimeState.holdings = [{
      holdingId: 'holding_governance_test',
      name: '樊城屯田营',
      type: 'camp',
      status: 'controlled',
      summary: '兼辖田亩民户的军屯。',
      civilAdministrationScope: 'mixed',
      scaleLevel: 1,
      agriculture: 30,
      commerce: 10,
      population: 1_000,
      publicOrder: 55,
      popularSupport: 50,
      defense: 45,
      recruitPotential: 20,
      armory: 25,
      horseSupply: 5,
      corruption: 20,
      farmlandMu: 2_500,
      registeredHouseholds: 300,
      updatedAt: save.runtimeState.currentDate,
    }];
    save.runtimeState.resources = {
      money: 2_000,
      grain: 2_000,
      horses: 0,
      arms: 0,
      recruits: 0,
      weapons: [],
      documents: [],
      tokens: [],
      importantSupplies: [],
    };
    const started = startHoldingGovernanceProject(save.runtimeState, {
      holdingId: 'holding_governance_test',
      type: 'land_survey',
      host: { actorType: 'player', actorId: 'player' },
      projectId: 'governance:portable-save-test',
    });
    expect(started.ok).toBe(true);
    save.runtimeState = started.state;

    const archive: SaveArchive = {
      schema: 'coc.v2.saves',
      version: 2,
      exportedAt: '2026-08-01T00:00:00.000Z',
      lastSaveId: save.id,
      saves: [save],
      turnSnapshots: [],
    };
    const parsed = await parsePortableSaveZip(await createPortableSaveZip(archive));

    expect(parsed.saves[0].runtimeState.player.uniqueArts?.[0]).toMatchObject({
      id: 'art_governance_test',
      progress: 45,
      bankedProgress: 6,
      acquisition: { sourceRefId: 'background:governance-test' },
      progressHistory: [expect.objectContaining({ eventId: 'progress:governance-test' })],
    });
    expect(parsed.saves[0].runtimeState.holdingGovernanceProjects?.[0]).toMatchObject({
      projectId: 'governance:portable-save-test',
      status: 'active',
      holdingId: 'holding_governance_test',
      host: { actorType: 'player', actorId: 'player' },
    });
  });

  it('archives only visual partitions referenced by saves and validates their outer summary', async () => {
    const save = makeSave('manual-avg', 'manual', '刘平');
    save.runtimeState.avgPresentation = { visualPartitionId: 'visual-partition-a', portraitBindings: [] };
    const archive: SaveArchive = {
      schema: 'coc.v2.saves', version: 2, exportedAt: '2026-08-24T00:00:00.000Z',
      lastSaveId: save.id, saves: [save], turnSnapshots: [],
    };
    const visual = {
      visualPartitionId: 'visual-partition-a',
      archiveBytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      actorCount: 1, sceneCount: 2, outfitCount: 3, outfitOverrideCount: 1, assetCount: 4, imageBytes: 128,
    };
    const bytes = await createPortableSaveZip(archive, { avgVisualPartitions: [visual] });
    const bundle = await parsePortableSaveZipBundle(bytes);

    expect(bundle.visualCapability).toBe('portable-v2');
    expect(bundle.avgVisualPartitions).toEqual([
      expect.objectContaining({ visualPartitionId: 'visual-partition-a', actorCount: 1, archiveBytes: visual.archiveBytes }),
    ]);
    await expect(createPortableSaveZip(archive, {
      avgVisualPartitions: [{ ...visual, visualPartitionId: 'unknown' }],
    })).rejects.toThrow('未知视觉分区');
  });

  it('reads a desktop ZIP through FileReader when mobile File.arrayBuffer is unavailable', async () => {
    const save = makeSave('mobile-file-reader', 'manual', '跨端角色');
    const archive: SaveArchive = {
      schema: 'coc.v2.saves',
      version: 2,
      exportedAt: '2026-08-02T00:00:00.000Z',
      lastSaveId: save.id,
      saves: [save],
      turnSnapshots: [],
    };
    const bytes = await createPortableSaveZip(archive);

    class CompatibleFileReader {
      result: string | ArrayBuffer | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;

      readAsArrayBuffer(): void {
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        this.result = buffer;
        this.onload?.();
      }
    }

    vi.stubGlobal('FileReader', CompatibleFileReader);
    const mobileFile = { arrayBuffer: undefined } as unknown as File;

    await expect(readSaveArchiveFile(mobileFile)).resolves.toEqual(archive);
  });
});
