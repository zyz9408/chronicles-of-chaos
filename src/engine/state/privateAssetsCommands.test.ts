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
      operation: 'create',
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
      acquisition: {
        kind: 'opening',
        occurredAt: '189-09-01',
        sourceRefId: 'opening:test-player',
        summary: 'Opening profile establishes the manor.',
      },
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
      operation: 'create',
      privateAssetId: 'asset_orchard_estate',
      name: 'Orchard Estate',
      type: 'estate',
      ownerScope: 'personal',
      status: 'active',
      summary: 'A private orchard estate outside the city.',
      acquisition: {
        kind: 'opening',
        occurredAt: '189-09-01',
        sourceRefId: 'opening:orchard-estate',
        summary: 'Opening profile establishes the orchard estate.',
      },
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
      operation: 'create',
      privateAssetId: 'asset_li_estate',
      name: 'Li clan estate',
      type: 'estate',
      ownerScope: 'personal',
      status: 'active',
      summary: 'A private manor outside the county seat.',
      acquisition: {
        kind: 'opening',
        occurredAt: '189-09-01',
        sourceRefId: 'opening:li-estate',
        summary: 'Opening profile establishes the manor.',
      },
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

  it('rejects unsupported self-claimed wealth, direct scale growth, and ambiguous duplicate creation', () => {
    const acquisition = {
      kind: 'opening' as const,
      occurredAt: '189-09-01',
      sourceRefId: 'opening:lin-estate',
      summary: 'Opening profile establishes a modest clan estate.',
    };
    const exaggerated = validateLuanShiCommand(makeState(), {
      action: 'upsertPrivateAsset',
      operation: 'create',
      privateAssetId: 'asset_lin_estate',
      name: '阳翟林氏坞堡',
      type: 'estate',
      ownerScope: 'personal',
      status: 'active',
      summary: 'A private estate outside Yangdi.',
      locationId: 'place_yangdi',
      mu: 10_000,
      households: 2_000,
      acquisition,
    });
    expect(exaggerated.valid).toBe(false);
    expect(exaggerated.errors.join('\n')).toContain('initial limit');

    const missingAcquisition = validateLuanShiCommand(makeState(), {
      action: 'upsertPrivateAsset',
      operation: 'create',
      privateAssetId: 'asset_without_source',
      name: '无来源庄园',
      type: 'estate',
      ownerScope: 'personal',
      status: 'active',
      summary: 'The player merely claims this estate.',
    } as LuanShiCommand);
    expect(missingAcquisition.errors.join('\n')).toContain('acquisition is required');

    const stateWithAsset = applyLuanShiCommand(makeState(), {
      action: 'upsertPrivateAsset',
      operation: 'create',
      privateAssetId: 'asset_lin_estate',
      name: '林氏坞堡',
      type: 'estate',
      ownerScope: 'clan',
      status: 'active',
      summary: '阳翟林氏旁支的私产。',
      locationId: 'place_yangdi',
      mu: 120,
      households: 18,
      acquisition,
    });

    const directGrowth = validateLuanShiCommand(stateWithAsset, {
      action: 'upsertPrivateAsset',
      operation: 'update',
      privateAssetId: 'asset_lin_estate',
      name: '林氏坞堡',
      type: 'estate',
      ownerScope: 'clan',
      status: 'active',
      summary: 'The same estate is now described as larger.',
      locationId: 'place_yangdi',
      mu: 900,
      households: 18,
    });
    expect(directGrowth.errors.join('\n')).toContain('cannot increase directly');

    const duplicate = validateLuanShiCommand(stateWithAsset, {
      action: 'upsertPrivateAsset',
      operation: 'create',
      privateAssetId: 'asset_lin_clan_manor_new',
      name: '阳翟林氏宗族庄园（坞堡）',
      type: 'estate',
      ownerScope: 'clan',
      status: 'active',
      summary: 'The same Lin clan compound under a new name.',
      locationId: 'place_yangdi',
      acquisition: {
        ...acquisition,
        sourceRefId: 'turn:invented-second-source',
      },
    });
    expect(duplicate.valid).toBe(false);
    expect(duplicate.errors.join('\n')).toContain('reuse that privateAssetId');

    const distinctLocation = validateLuanShiCommand(stateWithAsset, {
      action: 'upsertPrivateAsset',
      operation: 'create',
      privateAssetId: 'asset_lin_xuchang_estate',
      name: '许昌林氏坞堡',
      type: 'estate',
      ownerScope: 'clan',
      status: 'active',
      summary: 'A separately acquired Lin estate at Xuchang.',
      locationId: 'place_xuchang',
      acquisition: {
        kind: 'purchase',
        occurredAt: '189-09-02',
        sourceRefId: 'turn:xuchang-estate-purchase',
        summary: 'The clan purchases a distinct estate at Xuchang.',
        costMoney: 80,
      },
    });
    expect(distinctLocation.valid).toBe(true);
  });

  it('requires time and investment for bounded scale-growth projects', () => {
    const state = applyLuanShiCommand(makeState(), {
      action: 'upsertPrivateAsset',
      operation: 'create',
      privateAssetId: 'asset_project_estate',
      name: 'Project Estate',
      type: 'estate',
      ownerScope: 'personal',
      status: 'active',
      summary: 'A modest estate.',
      mu: 120,
      acquisition: {
        kind: 'opening',
        occurredAt: '189-09-01',
        sourceRefId: 'opening:project-estate',
        summary: 'Opening profile establishes the estate.',
      },
    });
    const invalid = validateLuanShiCommand(state, {
      action: 'upsertPrivateAssetProject',
      projectId: 'project_impossible_growth',
      assetId: 'asset_project_estate',
      title: 'Instant vast expansion',
      type: 'expand_farmland',
      status: 'active',
      startedAt: '189-09-01',
      targetDelta: { mu: 5_000 },
    });

    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join('\n')).toContain('per-project limit');
    expect(invalid.errors.join('\n')).toContain('expectedCompleteAt is required');
    expect(invalid.errors.join('\n')).toContain('requires investedMoney or investedGrain');
  });

  it('conservatively merges strong legacy duplicates and remaps dependent references', () => {
    const normalized = ensureLuanShiState({
      ...makeState(),
      privateAssets: [
        {
          privateAssetId: 'asset_lin_fort',
          name: '林氏坞堡',
          type: 'estate',
          ownerScope: 'clan',
          status: 'active',
          summary: '阳翟林氏旁支的基业。',
          locationId: 'place_yangdi',
          mu: 120,
          updatedAt: '189-08-01',
        },
        {
          privateAssetId: 'asset_lin_manor_drifted',
          name: '阳翟林氏宗族庄园（坞堡）',
          type: 'estate',
          ownerScope: 'clan',
          status: 'active',
          summary: '位于阳翟的同一处林氏坞堡。',
          locationId: 'place_yangdi',
          households: 18,
          updatedAt: '189-09-01',
        },
      ],
      privateAssetProjects: [{
        projectId: 'project_lin_fields',
        assetId: 'asset_lin_manor_drifted',
        title: '林氏庄园增修水渠',
        type: 'irrigation',
        status: 'active',
        startedAt: '189-08-01',
        updatedAt: '189-08-01',
      }],
      domesticReports: [{
        reportId: 'report_lin_estate',
        year: 189,
        settledAt: '189-09-01',
        title: '林氏私产报告',
        summary: '同一私产的报告。',
        income: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
        expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
        netChange: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
        privateAssetHighlights: [
          { privateAssetId: 'asset_lin_fort', summary: '旧称。' },
          { privateAssetId: 'asset_lin_manor_drifted', summary: '新称。' },
        ],
        projectHighlights: [{
          projectId: 'project_lin_fields',
          assetId: 'asset_lin_manor_drifted',
          summary: '工程继续。',
        }],
        readByPlayer: false,
      }],
    });

    expect(normalized.privateAssets).toHaveLength(1);
    expect(normalized.privateAssets[0]).toMatchObject({
      privateAssetId: 'asset_lin_fort',
      name: '阳翟林氏宗族庄园（坞堡）',
      aliases: expect.arrayContaining(['林氏坞堡']),
      mu: 120,
      households: 18,
    });
    expect(normalized.privateAssetProjects[0]?.assetId).toBe('asset_lin_fort');
    expect(normalized.domesticReports[0]?.privateAssetHighlights).toEqual([
      { privateAssetId: 'asset_lin_fort', summary: '新称。' },
    ]);
    expect(normalized.domesticReports[0]?.projectHighlights?.[0]?.assetId).toBe('asset_lin_fort');
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
