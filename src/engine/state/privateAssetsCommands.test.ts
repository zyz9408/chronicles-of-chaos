import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from './createInitialRuntimeState';
import type { LuanShiCommand } from './luanshiCommands';
import { validateLuanShiCommand } from './luanshiCommands';
import { applyLuanShiCommand } from './luanshiReducers';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '189-09-01',
    currentDate: '189-09-01',
    player: {
      id: 'player',
      name: 'Player',
      roleType: 'player',
      summary: 'Test player',
    },
    currentLocationId: 'place_test',
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
  });
}

describe('private asset commands', () => {
  it('accepts and writes private assets with stable ids', () => {
    const command = {
      action: 'upsertPrivateAsset',
      privateAssetId: 'asset_li_estate',
      name: 'Li clan estate',
      type: 'estate',
      ownerScope: 'personal',
      status: 'active',
      summary: 'A private manor outside the county seat.',
      locationDescription: 'outside Yingchuan',
      mu: 120,
      households: 18,
      workers: 12,
      workshopScale: 1,
      ranchCapacity: 20,
      riskNotes: ['bandit pressure'],
      recentChanges: ['new tenant fields opened'],
      updatedAt: '189-09-01',
    } satisfies LuanShiCommand;

    expect(validateLuanShiCommand(makeState(), command).valid).toBe(true);

    const next = applyLuanShiCommand(makeState(), command);

    expect(next.privateAssets).toEqual([
      expect.objectContaining({
        privateAssetId: 'asset_li_estate',
        name: 'Li clan estate',
        mu: 120,
        households: 18,
      }),
    ]);
  });

  it('uses the current game time when private-asset technical timestamps are blank', () => {
    const assetCommand = {
      action: 'upsertPrivateAsset',
      privateAssetId: 'asset_orchard_estate',
      name: 'Orchard Estate',
      type: 'estate',
      ownerScope: 'personal',
      status: 'active',
      summary: 'A private orchard estate outside the city.',
      updatedAt: '',
    } as unknown as LuanShiCommand;

    expect(validateLuanShiCommand(makeState(), assetCommand).valid).toBe(true);
    const stateWithAsset = applyLuanShiCommand(makeState(), assetCommand);
    expect(stateWithAsset.privateAssets[0]?.updatedAt).toBe(makeState().currentDate);

    const projectCommand = {
      action: 'upsertPrivateAssetProject',
      projectId: 'project_repair_orchard_estate',
      assetId: 'asset_orchard_estate',
      title: 'Repair the orchard estate',
      type: 'repair',
      status: 'active',
      startedAt: '189-08-20',
      updatedAt: '',
    } as unknown as LuanShiCommand;

    expect(validateLuanShiCommand(stateWithAsset, projectCommand).valid).toBe(true);
    const stateWithProject = applyLuanShiCommand(stateWithAsset, projectCommand);
    expect(stateWithProject.privateAssetProjects[0]?.updatedAt).toBe(stateWithAsset.currentDate);
  });

  it('accepts and writes private asset expansion projects', () => {
    const state = applyLuanShiCommand(makeState(), {
      action: 'upsertPrivateAsset',
      privateAssetId: 'asset_li_estate',
      name: 'Li clan estate',
      type: 'estate',
      ownerScope: 'personal',
      status: 'active',
      summary: 'A private manor outside the county seat.',
      updatedAt: '189-09-01',
    } as any);
    const command = {
      action: 'upsertPrivateAssetProject',
      projectId: 'project_expand_estate',
      assetId: 'asset_li_estate',
      title: 'Expand estate fields',
      type: 'expand_farmland',
      status: 'active',
      startedAt: '189-03-01',
      expectedCompleteAt: '189-08-01',
      investedMoney: 12,
      investedGrain: 80,
      targetDelta: { mu: 40, households: 6 },
      progressNotes: ['tenants have begun clearing fields'],
      updatedAt: '189-03-01',
    } satisfies LuanShiCommand;

    expect(validateLuanShiCommand(state, command).valid).toBe(true);

    const next = applyLuanShiCommand(state, command);

    expect(next.privateAssetProjects).toEqual([
      expect.objectContaining({
        projectId: 'project_expand_estate',
        assetId: 'asset_li_estate',
        targetDelta: { mu: 40, households: 6 },
      }),
    ]);
  });

  it('rejects malformed private asset and project fields', () => {
    const badAsset = validateLuanShiCommand(makeState(), {
      action: 'upsertPrivateAsset',
      privateAssetId: '',
      name: '',
      type: 'castle',
      ownerScope: 'realm',
      status: 'unknown',
      summary: '',
      mu: -1,
      workshopScale: 9,
      riskNotes: 'not-array',
      updatedAt: '',
    } as any);

    expect(badAsset.valid).toBe(false);
    expect(badAsset.errors.join('\n')).toContain('privateAssetId');
    expect(badAsset.errors.join('\n')).toContain('type');
    expect(badAsset.errors.join('\n')).toContain('ownerScope');
    expect(badAsset.errors.join('\n')).toContain('status');
    expect(badAsset.errors.join('\n')).toContain('workshopScale');

    const badProject = validateLuanShiCommand(makeState(), {
      action: 'upsertPrivateAssetProject',
      projectId: '',
      assetId: '',
      title: '',
      type: 'build_castle',
      status: 'running',
      startedAt: '',
      investedMoney: -1,
      targetDelta: { mu: 'many' },
      updatedAt: '',
    } as any);

    expect(badProject.valid).toBe(false);
    expect(badProject.errors.join('\n')).toContain('projectId');
    expect(badProject.errors.join('\n')).toContain('assetId');
    expect(badProject.errors.join('\n')).toContain('type');
    expect(badProject.errors.join('\n')).toContain('status');
    expect(badProject.errors.join('\n')).toContain('targetDelta');
  });

  it('accepts domestic reports with private asset and project highlights', () => {
    const command = {
      action: 'upsertDomesticReport',
      reportId: 'domestic_private_189',
      year: 189,
      settledAt: '189-09-01',
      title: 'Private estate settlement',
      summary: 'The estate harvest entered the household stores.',
      income: { money: 8, grain: 240, horses: 0, arms: 0, recruits: 0 },
      expenses: { money: 2, grain: 20, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 6, grain: 220, horses: 0, arms: 0, recruits: 0 },
      privateAssetHighlights: [
        { privateAssetId: 'asset_li_estate', summary: 'Tenant fields yielded steady grain.' },
      ],
      projectHighlights: [
        {
          projectId: 'project_expand_estate',
          assetId: 'asset_li_estate',
          summary: 'New fields were opened before the autumn levy.',
        },
      ],
      warnings: [],
      readByPlayer: false,
    } satisfies LuanShiCommand;

    expect(validateLuanShiCommand(makeState(), command).valid).toBe(true);

    const next = applyLuanShiCommand(makeState(), command);

    expect(next.domesticReports[0]).toEqual(expect.objectContaining({
      reportId: 'domestic_private_189',
      privateAssetHighlights: [
        { privateAssetId: 'asset_li_estate', summary: 'Tenant fields yielded steady grain.' },
      ],
      projectHighlights: [
        {
          projectId: 'project_expand_estate',
          assetId: 'asset_li_estate',
          summary: 'New fields were opened before the autumn levy.',
        },
      ],
    }));
  });

  it('rejects malformed private asset and project report highlights', () => {
    const result = validateLuanShiCommand(makeState(), {
      action: 'upsertDomesticReport',
      reportId: 'domestic_private_189',
      year: 189,
      settledAt: '189-09-01',
      title: 'Private estate settlement',
      summary: 'Bad highlight payload.',
      income: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      netChange: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
      privateAssetHighlights: [{ privateAssetId: '', summary: '' }],
      projectHighlights: [{ projectId: '', assetId: '', summary: '' }],
      warnings: [],
      readByPlayer: false,
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('privateAssetHighlights');
    expect(result.errors.join('\n')).toContain('projectHighlights');
  });
});
