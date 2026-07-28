import { describe, expect, it, vi } from 'vitest';
import type { LlmGenerateRequest } from '../llm/LlmClient';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState, StatePatch, WorldBook } from '../types';
import { executeTurn } from './TurnOrchestrator';

const worldBook: WorldBook = {
  manifest: {
    id: 'state-patch-transaction-world',
    name: 'State Patch Transaction World',
    version: '0.1.0',
    author: 'test',
    language: 'zh-CN',
    genre: 'historical-chaos',
    source: 'official',
    compatibleEngineVersion: '0.1.0',
  },
  ontology: {
    regionLevels: [],
    factionTypes: [],
    actorRoleTypes: [],
    socialClasses: [],
    resourceTypes: [],
    conflictTypes: [],
    actionTypes: [],
    relationshipTypes: [],
  },
  lore: '',
  mapSeed: [
    {
      id: 'place_market',
      name: 'Market',
      level: 'place',
      mapLayer: 'place',
      summary: 'A test market.',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
      subLocations: [
        {
          id: 'scene_market_camp',
          name: 'Market Camp',
          level: 'scene',
          mapLayer: 'scene',
          summary: 'A camp scene inside the market place.',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
        },
      ],
    },
  ],
  factionsSeed: [],
  timelineAnchors: [],
  startBookmarks: [],
  openingCrisisTemplates: [],
  prompts: {
    narrativeBaseline: 'Use current facts.',
    forbiddenTopics: [],
    outputFormat: 'Return JSON.',
    toneGuide: 'Plain prose.',
  },
  validationRules: [],
};

const apiConfig: ApiConfigArchive = {
  id: 'api_state_patch_transaction',
  name: 'State patch transaction test API',
  provider: 'openai_compatible',
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const stateWritebackApiConfig: ApiConfigArchive = {
  ...apiConfig,
  id: 'api_state_patch_transaction_repair',
  name: 'State patch transaction repair API',
  model: 'repair-model',
};

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook.manifest.id,
    worldBookVersion: worldBook.manifest.version,
    worldBookSource: 'official',
    startDate: 'day 10',
    currentDate: 'day 10',
    player: {
      id: 'player',
      name: 'Player',
      roleType: 'owner',
      summary: 'A local property owner.',
    },
    currentLocationId: 'place_market',
    currentPlaceId: 'place_market',
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

function privateAssetPatch(): StatePatch {
  return {
    type: 'luanshiCommand',
    reason: 'The player acquires a workshop.',
    payload: {
      command: {
        action: 'upsertPrivateAsset',
        privateAssetId: 'asset_workshop',
        name: 'Market Workshop',
        type: 'workshop',
        ownerScope: 'personal',
        status: 'active',
        summary: 'A small workshop beside the market.',
        updatedAt: 'day 10',
      },
    },
  };
}

function privateAssetProjectPatch(overrides: Record<string, unknown> = {}): StatePatch {
  return {
    type: 'luanshiCommand',
    reason: 'The player starts expanding the workshop.',
    payload: {
      command: {
        action: 'upsertPrivateAssetProject',
        projectId: 'project_expand_workshop',
        assetId: 'asset_workshop',
        title: 'Expand the market workshop',
        type: 'expand_workshop',
        status: 'active',
        startedAt: 'day 10',
        updatedAt: 'day 10',
        ...overrides,
      },
    },
  };
}

function npcProfilePatch(npcId = 'npc_batch_lady', name = '沈兰'): StatePatch {
  return {
    type: 'luanshiCommand',
    reason: 'Create an adult NPC before relationship writeback.',
    payload: {
      command: {
        action: 'upsertNpcProfile',
        npcId,
        name,
        sex: '女',
        age: 28,
        role: 'Local notable',
        currentIdentity: 'Household representative',
        locationId: 'place_market',
        isPresent: true,
        isFocused: true,
        summary: 'A local notable drawn into the current crisis.',
        appearance: 'Dressed for travel.',
        personality: 'Careful and direct.',
        motivation: 'Protect her household.',
        relationToPlayer: 'A new ally.',
        contactLevel: 12,
        recentAttitude: 'Cautious trust',
        abilityScores: { 武力: 20, 统率: 30, 智力: 55, 政治: 50, 魅力: 60, 机运: 40 },
        traits: [{
          id: 'trait_household_guardian',
          label: 'Household Guardian',
          description: 'Acts carefully to protect her household.',
          source: 'event',
          rarity: 'white',
        }],
      },
    },
  };
}

function heroineThreadPatch(npcId: string, npcName = 'Non-canonical Name'): StatePatch {
  return {
    type: 'luanshiCommand',
    reason: 'Create a heroine thread for the established NPC.',
    payload: {
      command: {
        action: 'upsertHeroineThread',
        heroineThreadId: 'heroine_batch_lady',
        npcId,
        npcName,
        status: 'active',
        stage: 'trust-forming',
        relationshipRole: 'confidante',
        summary: 'A private line of trust begins during the crisis.',
      },
    },
  };
}

function bondThreadPatch(npcId: string, targetName = 'Non-canonical Name'): StatePatch {
  return {
    type: 'luanshiCommand',
    reason: 'Create a bond thread for the established NPC.',
    payload: {
      command: {
        action: 'upsertBondThread',
        bondThreadId: 'bond_batch_lady',
        targetNpcIds: [npcId],
        targetNames: [targetName],
        bondType: 'ally',
        status: 'active',
        summary: 'The two sides agree to mutual aid.',
      },
    },
  };
}

const timeAdvancePatch: StatePatch = {
  type: 'timeAdvance',
  reason: 'The arrangements take one hour.',
  payload: { hoursAdvanced: 1 },
};

function misnestedTimeAdvancePatch(reason: string, minutesAdvanced = 5): StatePatch {
  return {
    type: 'luanshiCommand',
    reason,
    payload: {
      command: {
        action: 'timeAdvance',
        minutesAdvanced,
      },
    },
  };
}

async function executeWithPatches(state: RuntimeState, narrativeText: string, statePatches: StatePatch[]) {
  const llmClient = {
    generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText,
        suggestedActions: [],
        statePatches,
        statePatch: null,
      }),
      provider: 'openai_compatible' as const,
      model: 'test-model',
    })),
  };

  return executeTurn(worldBook, state, 'Manage the workshop.', { apiConfig, llmClient });
}

async function executeWithRepair(
  originalPatches: StatePatch[],
  repairedPatches: StatePatch[],
  state: RuntimeState = makeState(),
) {
  const llmClient = {
    generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: 'The state writeback repair is reviewed.',
        suggestedActions: [],
        statePatches: originalPatches,
        statePatch: null,
      }),
      provider: 'openai_compatible' as const,
      model: 'test-model',
    })),
  };
  const stateWritebackLlmClient = {
    generate: vi.fn(async (_request: LlmGenerateRequest) => ({
      content: JSON.stringify({
        narrativeText: 'Repair output.',
        suggestedActions: [],
        statePatches: repairedPatches,
        statePatch: null,
      }),
      provider: 'openai_compatible' as const,
      model: 'repair-model',
    })),
  };

  const result = await executeTurn(worldBook, state, 'Apply the repaired batch.', {
    apiConfig,
    stateWritebackApiConfig,
    llmClient,
    stateWritebackLlmClient,
  });

  return { ...result, stateWritebackLlmClient };
}

describe('StatePatch ordered transaction', () => {
  it('canonicalizes a known scene emitted as toLocationId before atomic validation', async () => {
    const result = await executeWithPatches(
      makeState(),
      'The player enters the camp inside the market.',
      [
        {
          type: 'locationChange',
          reason: 'Enter the market camp.',
          payload: { toLocationId: 'scene_market_camp' },
        },
        timeAdvancePatch,
      ],
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.statePatches?.[0]).toMatchObject({
      type: 'locationChange',
      payload: {
        toLocationId: 'place_market',
        toSceneId: 'scene_market_camp',
      },
    });
    expect(result.newRuntimeState.currentLocationId).toBe('place_market');
    expect(result.newRuntimeState.currentPlaceId).toBe('place_market');
    expect(result.newRuntimeState.currentSceneId).toBe('scene_market_camp');
  });

  it('allows a later patch to reference an entity created earlier in the same batch', async () => {
    const result = await executeWithPatches(
      makeState(),
      'The deed is signed and expansion work begins.',
      [privateAssetPatch(), privateAssetProjectPatch(), timeAdvancePatch],
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.privateAssets).toContainEqual(expect.objectContaining({
      privateAssetId: 'asset_workshop',
    }));
    expect(result.newRuntimeState.privateAssetProjects).toContainEqual(expect.objectContaining({
      projectId: 'project_expand_workshop',
      assetId: 'asset_workshop',
    }));
  });

  it('keeps a valid time advance when a player inventory candidate has no target item id', async () => {
    const initialState = makeState();
    const loadoutPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'No concrete backpack target was identified.',
      payload: {
        command: {
          action: 'updatePlayerLoadout',
          characterId: 'player',
          inventoryChanges: [{ action: 'remove', itemId: '', quantity: 1 }],
          summary: 'No concrete backpack change was committed.',
        },
      },
    };

    const result = await executeWithPatches(
      initialState,
      'The discussion ends and time passes without a concrete backpack change.',
      [loadoutPatch, timeAdvancePatch],
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.currentDate).not.toBe(initialState.currentDate);
  });

  it('normalizes a single important supply before validating the resource writeback batch', async () => {
    const initialState = makeState();
    const resourcePatch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'Three crates of arrows are entered into the supply ledger.',
      payload: {
        command: {
          action: 'updateResourceLedger',
          importantSupplies: '箭矢三箱',
          summary: 'The quartermaster confirms three crates of arrows.',
        } as any,
      },
    };

    const result = await executeWithPatches(
      initialState,
      'The arrows are counted and the arrangements take one hour.',
      [resourcePatch, timeAdvancePatch],
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.resources?.importantSupplies).toEqual(['箭矢三箱']);
    expect(result.newRuntimeState.currentDate).not.toBe(initialState.currentDate);
  });

  it('keeps a valid time advance when resourceChanged has no target resource key', async () => {
    const initialState = makeState();
    const result = await executeWithPatches(
      initialState,
      'The discussion ends without identifying a concrete generic resource key.',
      [
        {
          type: 'resourceChanged',
          reason: 'No concrete generic resource was identified.',
          payload: { resource: '   ', mode: 'delta', change: 5 },
        },
        timeAdvancePatch,
      ],
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.statePatches).toEqual([timeAdvancePatch]);
    expect(result.newRuntimeState.playerResources).toEqual({});
    expect(result.newRuntimeState.currentDate).not.toBe(initialState.currentDate);
  });

  it('quarantines an ambiguous resourceChanged patch without rolling back valid time', async () => {
    const initialState = {
      ...makeState(),
      playerResources: { grain: 10 },
    };
    const result = await executeWithPatches(
      initialState,
      'The quartermaster advances the hour but reports two conflicting grain values.',
      [
        {
          type: 'resourceChanged',
          reason: 'The model supplied both delta and absolute values.',
          payload: {
            resource: 'grain',
            mode: 'delta',
            change: -2,
            newValue: 8,
          } as any,
        },
        timeAdvancePatch,
      ],
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.patchValidation?.warnings.join('\n')).toContain('附属补丁被隔离');
    expect(result.statePatches).toEqual([timeAdvancePatch]);
    expect(result.newRuntimeState.playerResources).toEqual({ grain: 10 });
    expect(result.newRuntimeState.currentDate).not.toBe(initialState.currentDate);
  });

  it('does not ignore a blank resource candidate that also attempts a forbidden global write', async () => {
    const initialState = makeState();
    const result = await executeWithPatches(
      initialState,
      'The malformed candidate attempts a forbidden global write.',
      [
        {
          type: 'resourceChanged',
          reason: 'A forbidden write must remain visible.',
          payload: {
            resource: '',
            mode: 'delta',
            change: 5,
            wholeWorldState: { hidden: true },
          },
        },
        timeAdvancePatch,
      ],
    );

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('wholeWorldState');
    expect(result.newRuntimeState.currentDate).toBe(initialState.currentDate);
  });

  it('normalizes ordered troop status without rolling back the same-batch time advance', async () => {
    const initialState = makeState();
    const troopPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'The local guard receives its defensive order.',
      payload: {
        command: {
          action: 'upsertTroopLedger',
          troopId: 'troop_yingchuan_guard',
          name: '颍川守卒',
          size: 80,
          morale: 55,
          training: 45,
          supplies: 50,
          task: '整顿城防',
          relationToPlayer: '听从调遣',
          orderStatus: 'ordered',
          orderIssuedAt: '公元184年03月02日 11:00（午时）',
          orderSummary: '奉命整顿城防。',
        } as any,
      },
    };

    const result = await executeWithPatches(
      initialState,
      'The defensive order is issued and the arrangements take one hour.',
      [troopPatch, timeAdvancePatch],
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.troops).toContainEqual(expect.objectContaining({
      troopId: 'troop_yingchuan_guard',
      orderStatus: 'issued',
    }));
    expect(result.newRuntimeState.currentDate).not.toBe(initialState.currentDate);
  });

  it('allows same-batch relationship patches to reference a prior NPC profile and stores canonical names', async () => {
    const result = await executeWithPatches(
      makeState(),
      '沈兰在危局中与主角建立了两条不同层次的关系记录。',
      [
        npcProfilePatch(),
        heroineThreadPatch('npc_batch_lady'),
        bondThreadPatch('npc_batch_lady'),
        timeAdvancePatch,
      ],
    );

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.npcs).toContainEqual(expect.objectContaining({
      npcId: 'npc_batch_lady',
      name: '沈兰',
    }));
    expect(result.newRuntimeState.heroineThreads).toContainEqual(expect.objectContaining({
      heroineThreadId: 'heroine_batch_lady',
      npcId: 'npc_batch_lady',
      npcName: '沈兰',
    }));
    expect(result.newRuntimeState.bondThreads).toContainEqual(expect.objectContaining({
      bondThreadId: 'bond_batch_lady',
      targetNpcIds: ['npc_batch_lady'],
      targetNames: ['沈兰'],
    }));
  });

  it('rejects and rolls back a same-batch relationship with an unknown NPC id', async () => {
    const initialState = makeState();
    const result = await executeWithPatches(
      initialState,
      'The proposed relationship cannot be tied to a known person.',
      [npcProfilePatch(), heroineThreadPatch('npc_missing'), timeAdvancePatch],
    );

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('npc_missing');
    expect(result.newRuntimeState.npcs).toEqual(initialState.npcs);
    expect(result.newRuntimeState.heroineThreads).toEqual([]);
    expect(result.newRuntimeState.bondThreads).toEqual([]);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('状态变更校验失败');
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('npc_missing');
  });

  it('diagnoses a malformed legacy relationship collection and rolls back the whole batch without throwing', async () => {
    const initialState = {
      ...makeState(),
      heroineThreads: {} as any,
    };

    const result = await executeWithPatches(
      initialState,
      'A relationship update encounters an invalid legacy collection.',
      [privateAssetPatch(), npcProfilePatch(), heroineThreadPatch('npc_batch_lady'), timeAdvancePatch],
    );

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('heroineThreads');
    expect(result.newRuntimeState.privateAssets).toEqual([]);
    expect(result.newRuntimeState.npcs).toEqual(initialState.npcs);
    expect(result.newRuntimeState.heroineThreads).toEqual(initialState.heroineThreads);
    expect(result.newRuntimeState.currentDate).toBe(initialState.currentDate);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('heroineThreads');
  });

  it('diagnoses malformed legacy relationship nesting and rolls back the whole batch without throwing', async () => {
    const initialState = {
      ...makeState(),
      bondThreads: [{
        bondThreadId: 'bond_legacy_contact',
        targetNpcIds: 7 as any,
        targetNames: ['Legacy Contact'],
        bondType: 'ally' as const,
        status: 'active' as const,
        summary: 'A legacy bond record.',
        milestones: {} as any,
        lastUpdatedAt: 'day 9',
      }],
    };
    const relationshipPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'Update the legacy bond summary.',
      payload: {
        command: {
          action: 'upsertBondThread',
          bondThreadId: 'bond_legacy_contact',
          summary: 'Only the summary should change.',
        },
      },
    };

    const result = await executeWithPatches(
      initialState,
      'A relationship update encounters invalid legacy nesting.',
      [privateAssetPatch(), relationshipPatch, timeAdvancePatch],
    );

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('bondThreads[0].targetNpcIds');
    expect(result.patchValidation?.errors.join('\n')).toContain('bondThreads[0].milestones');
    expect(result.newRuntimeState.privateAssets).toEqual([]);
    expect(result.newRuntimeState.bondThreads).toEqual(initialState.bondThreads);
    expect(result.newRuntimeState.currentDate).toBe(initialState.currentDate);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('bondThreads[0]');
  });

  it('diagnoses malformed legacy relationship text before prompt projection can throw', async () => {
    const initialState = {
      ...makeState(),
      npcs: [{
        npcId: 'npc_legacy_lady',
        name: 'Legacy Lady',
        sex: '女' as const,
        age: 28,
        role: 'Local notable',
        currentIdentity: 'Household representative',
        locationId: 'place_market',
        isPresent: true,
        isFocused: true,
        summary: 'A known local notable.',
        appearance: 'Dressed for travel.',
        personality: 'Careful and direct.',
        motivation: 'Protect her household.',
        relationToPlayer: 'An ally.',
        contactLevel: 12,
        recentAttitude: 'Cautious trust',
        abilityScores: { 武力: 20, 统率: 30, 智力: 55, 政治: 50, 魅力: 60, 机运: 40 },
        traits: [],
        effects: [],
        memories: [],
      }],
      heroineThreads: [{
        heroineThreadId: 'heroine_legacy_lady',
        npcId: 'npc_legacy_lady',
        npcName: 'Legacy Lady',
        status: 'active' as const,
        stage: 'trust-forming',
        relationshipRole: 'confidante',
        summary: 'A legacy heroine record.',
        currentPull: 7 as any,
        lastUpdatedAt: 'day 9',
      }],
    };
    const relationshipPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'Update the legacy heroine summary.',
      payload: {
        command: {
          action: 'upsertHeroineThread',
          heroineThreadId: 'heroine_legacy_lady',
          summary: 'Only the summary should change.',
        },
      },
    };

    const result = await executeWithPatches(
      initialState,
      'A relationship update encounters invalid legacy text.',
      [privateAssetPatch(), relationshipPatch, timeAdvancePatch],
    );

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('heroineThreads[0].currentPull');
    expect(result.newRuntimeState.privateAssets).toEqual([]);
    expect(result.newRuntimeState.heroineThreads).toEqual(initialState.heroineThreads);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('currentPull');
  });

  it('rejects a heroine target patch when a sibling is malformed or the stable id is duplicated', async () => {
    const target = {
      heroineThreadId: 'heroine_batch_target',
      npcId: 'npc_batch_lady',
      npcName: '沈兰',
      status: 'active' as const,
      stage: 'trust-forming',
      relationshipRole: 'confidante',
      summary: 'The target heroine thread.',
      lastUpdatedAt: 'day 9',
    };
    const initialState = {
      ...makeState(),
      heroineThreads: [
        target,
        {
          ...target,
          heroineThreadId: 'heroine_bad_sibling',
          npcId: 'npc_missing_sibling',
          tags: 'not-an-array' as any,
        },
        { ...target },
      ],
    };
    const relationshipPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'Update only the target heroine summary.',
      payload: {
        command: {
          action: 'upsertHeroineThread',
          heroineThreadId: 'heroine_batch_target',
          summary: 'Only the target summary changes.',
        },
      },
    };

    const result = await executeWithPatches(initialState, 'The invalid heroine collection is rejected.', [
      privateAssetPatch(),
      npcProfilePatch(),
      relationshipPatch,
      timeAdvancePatch,
    ]);

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('heroineThreads[1].tags');
    expect(result.patchValidation?.errors.join('\n')).toContain('npc_missing_sibling');
    expect(result.patchValidation?.errors.join('\n')).toContain('heroineThreads[2].heroineThreadId');
    expect(result.patchValidation?.errors.join('\n').toLowerCase()).toContain('duplicate');
    expect(result.newRuntimeState.privateAssets).toEqual([]);
    expect(result.newRuntimeState.npcs).toEqual(initialState.npcs);
    expect(result.newRuntimeState.heroineThreads).toEqual(initialState.heroineThreads);
    expect(result.newRuntimeState.currentDate).toBe(initialState.currentDate);
  });

  it('rejects a bond target patch when a sibling is malformed or the stable id is duplicated', async () => {
    const target = {
      bondThreadId: 'bond_batch_target',
      targetNpcIds: ['npc_batch_lady'],
      targetNames: ['沈兰'],
      bondType: 'ally' as const,
      status: 'active' as const,
      summary: 'The target bond thread.',
      lastUpdatedAt: 'day 9',
    };
    const initialState = {
      ...makeState(),
      bondThreads: [
        target,
        {
          ...target,
          bondThreadId: 'bond_bad_sibling',
          targetNpcIds: ['npc_missing_sibling'],
          milestones: {} as any,
        },
        { ...target },
      ],
    };
    const relationshipPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'Update only the target bond summary.',
      payload: {
        command: {
          action: 'upsertBondThread',
          bondThreadId: 'bond_batch_target',
          summary: 'Only the target summary changes.',
        },
      },
    };

    const result = await executeWithPatches(initialState, 'The invalid bond collection is rejected.', [
      privateAssetPatch(),
      npcProfilePatch(),
      relationshipPatch,
      timeAdvancePatch,
    ]);

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('bondThreads[1].milestones');
    expect(result.patchValidation?.errors.join('\n')).toContain('npc_missing_sibling');
    expect(result.patchValidation?.errors.join('\n')).toContain('bondThreads[2].bondThreadId');
    expect(result.patchValidation?.errors.join('\n').toLowerCase()).toContain('duplicate');
    expect(result.newRuntimeState.privateAssets).toEqual([]);
    expect(result.newRuntimeState.npcs).toEqual(initialState.npcs);
    expect(result.newRuntimeState.bondThreads).toEqual(initialState.bondThreads);
    expect(result.newRuntimeState.currentDate).toBe(initialState.currentDate);
  });

  it('updates padded heroine and bond ids through canonical stable keys without adding records', async () => {
    const initialState = {
      ...makeState(),
      heroineThreads: [{
        heroineThreadId: ' heroine_batch_target ',
        npcId: 'npc_batch_lady',
        npcName: '沈兰',
        status: 'active' as const,
        stage: 'trust-forming',
        relationshipRole: 'confidante',
        summary: 'The existing heroine thread.',
        lastUpdatedAt: 'day 9',
      }],
      bondThreads: [{
        bondThreadId: ' bond_batch_target ',
        targetNpcIds: ['npc_batch_lady'],
        targetNames: ['沈兰'],
        bondType: 'ally' as const,
        status: 'active' as const,
        summary: 'The existing bond thread.',
        lastUpdatedAt: 'day 9',
      }],
    };
    const heroinePatch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'Update the padded heroine id.',
      payload: { command: {
        action: 'upsertHeroineThread',
        heroineThreadId: 'heroine_batch_target',
        summary: 'The heroine thread is updated.',
      } },
    };
    const bondPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'Update the padded bond id.',
      payload: { command: {
        action: 'upsertBondThread',
        bondThreadId: ' bond_batch_target ',
        summary: 'The bond thread is updated.',
      } },
    };

    const result = await executeWithPatches(initialState, 'Both relationship records are updated in place.', [
      npcProfilePatch(),
      heroinePatch,
      bondPatch,
      timeAdvancePatch,
    ]);

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.heroineThreads).toHaveLength(1);
    expect(result.newRuntimeState.heroineThreads?.[0]).toMatchObject({
      heroineThreadId: 'heroine_batch_target',
      summary: 'The heroine thread is updated.',
    });
    expect(result.newRuntimeState.bondThreads).toHaveLength(1);
    expect(result.newRuntimeState.bondThreads?.[0]).toMatchObject({
      bondThreadId: 'bond_batch_target',
      summary: 'The bond thread is updated.',
      targetNames: ['沈兰'],
    });
  });

  it('rolls back trim-equivalent duplicate heroine and bond stable ids', async () => {
    const heroineTarget = {
      heroineThreadId: 'heroine_trim_duplicate',
      npcId: 'npc_batch_lady',
      npcName: '沈兰',
      status: 'active' as const,
      stage: 'trust-forming',
      relationshipRole: 'confidante',
      summary: 'A heroine thread.',
      lastUpdatedAt: 'day 9',
    };
    const bondTarget = {
      bondThreadId: 'bond_trim_duplicate',
      targetNpcIds: ['npc_batch_lady'],
      targetNames: ['沈兰'],
      bondType: 'ally' as const,
      status: 'active' as const,
      summary: 'A bond thread.',
      lastUpdatedAt: 'day 9',
    };
    const initialState = {
      ...makeState(),
      heroineThreads: [heroineTarget, { ...heroineTarget, heroineThreadId: ' heroine_trim_duplicate ' }],
      bondThreads: [bondTarget, { ...bondTarget, bondThreadId: ' bond_trim_duplicate ' }],
    };
    const heroinePatch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'Attempt the duplicate heroine update.',
      payload: { command: {
        action: 'upsertHeroineThread',
        heroineThreadId: 'heroine_trim_duplicate',
        summary: 'This must roll back.',
      } },
    };
    const bondPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'Attempt the duplicate bond update.',
      payload: { command: {
        action: 'upsertBondThread',
        bondThreadId: 'bond_trim_duplicate',
        summary: 'This must roll back.',
      } },
    };

    const result = await executeWithPatches(initialState, 'Duplicate logical ids are rejected.', [
      privateAssetPatch(),
      npcProfilePatch(),
      heroinePatch,
      bondPatch,
      timeAdvancePatch,
    ]);

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('duplicate: heroine_trim_duplicate');
    expect(result.patchValidation?.errors.join('\n')).toContain('duplicate: bond_trim_duplicate');
    expect(result.newRuntimeState.privateAssets).toEqual([]);
    expect(result.newRuntimeState.npcs).toEqual(initialState.npcs);
    expect(result.newRuntimeState.heroineThreads).toEqual(initialState.heroineThreads);
    expect(result.newRuntimeState.bondThreads).toEqual(initialState.bondThreads);
    expect(result.newRuntimeState.currentDate).toBe(initialState.currentDate);
  });

  it('rolls back the whole batch on a hard failure while retaining narrative and complete diagnostics', async () => {
    const initialState = makeState();
    const narrativeText = 'The deed is discussed, but the expansion order is malformed.';
    const patches = [
      privateAssetPatch(),
      privateAssetProjectPatch({ type: 'unsupported_project', status: 'impossible' }),
      timeAdvancePatch,
    ];

    const result = await executeWithPatches(initialState, narrativeText, patches);

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors).toEqual(expect.arrayContaining([
      'upsertPrivateAssetProject.type is invalid: unsupported_project',
      'upsertPrivateAssetProject.status is invalid: impossible',
    ]));
    expect(result.patchValidation?.errors.join('\n')).not.toContain('does not reference an existing private asset');
    expect(result.statePatches).toHaveLength(3);

    expect(initialState.privateAssets).toEqual([]);
    expect(initialState.privateAssetProjects).toEqual([]);
    expect(result.newRuntimeState.privateAssets).toEqual([]);
    expect(result.newRuntimeState.privateAssetProjects).toEqual([]);
    expect(result.newRuntimeState.currentDate).toBe(initialState.currentDate);
    expect(result.newRuntimeState.lastStatePatch).toBe(initialState.lastStatePatch);

    expect(result.narrativeText).toBe(narrativeText);
    expect(result.newRuntimeState.turnLog).toHaveLength(1);
    expect(result.newRuntimeState.turnLog[0].fullNarrativeText).toBe(narrativeText);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('状态变更校验失败');
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('unsupported_project');
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('impossible');
  });

  it('keeps resource patches atomic when one contract payload is invalid', async () => {
    const initialState = {
      ...makeState(),
      playerResources: { grain: 10 },
    };
    const patches: StatePatch[] = [
      {
        type: 'resourceChanged',
        reason: 'valid grain delta',
        payload: { resource: 'grain', mode: 'delta', change: 5 },
      },
      {
        type: 'resourceChanged',
        reason: 'invalid grain delta',
        payload: { resource: 'grain', mode: 'delta', change: '1kg' },
      },
      timeAdvancePatch,
    ];

    const result = await executeWithPatches(initialState, 'The resource batch is reviewed.', patches);

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('finite number');
    expect(result.newRuntimeState.playerResources.grain).toBe(10);
    expect(result.newRuntimeState.currentDate).toBe(initialState.currentDate);
    expect(result.newRuntimeState.lastStatePatch).toBe(initialState.lastStatePatch);
    expect(result.newRuntimeState.turnLog).toHaveLength(1);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('状态变更校验失败');
  });

  it('treats a finite resource delta overflow as a hard transaction failure', async () => {
    const initialState = {
      ...makeState(),
      playerResources: { grain: Number.MAX_VALUE },
    };
    const result = await executeWithPatches(initialState, 'The overflow is rejected.', [
      timeAdvancePatch,
      {
        type: 'resourceChanged',
        reason: 'overflow grain delta',
        payload: { resource: 'grain', mode: 'delta', change: Number.MAX_VALUE },
      },
    ]);

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('finite');
    expect(result.newRuntimeState.playerResources.grain).toBe(Number.MAX_VALUE);
    expect(result.newRuntimeState.currentDate).toBe(initialState.currentDate);
    expect(result.newRuntimeState.lastStatePatch).toBe(initialState.lastStatePatch);
    expect(result.newRuntimeState.turnLog).toHaveLength(1);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('状态变更校验失败');
  });

  it('checks multiple same-resource deltas against the sequential transaction draft', async () => {
    const halfMax = Number.MAX_VALUE / 2;
    const initialState = {
      ...makeState(),
      playerResources: { grain: halfMax },
    };
    const result = await executeWithPatches(initialState, 'The ordered overflow is rejected.', [
      {
        type: 'resourceChanged',
        reason: 'first finite grain delta',
        payload: { resource: 'grain', mode: 'delta', change: halfMax },
      },
      {
        type: 'resourceChanged',
        reason: 'second overflowing grain delta',
        payload: { resource: 'grain', mode: 'delta', change: Number.MAX_VALUE },
      },
      timeAdvancePatch,
    ]);

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('finite');
    expect(result.newRuntimeState.playerResources.grain).toBe(halfMax);
    expect(result.newRuntimeState.currentDate).toBe(initialState.currentDate);
  });

  it('accepts a finite repair for an overflowing delta without changing resource identity or mode', async () => {
    const initialState = {
      ...makeState(),
      playerResources: { grain: Number.MAX_VALUE },
    };
    const originalPatches: StatePatch[] = [
      timeAdvancePatch,
      {
        type: 'resourceChanged',
        reason: 'adjust the grain by a finite delta',
        payload: { resource: 'grain', mode: 'delta', change: Number.MAX_VALUE },
      },
    ];
    const repairedPatches: StatePatch[] = [
      timeAdvancePatch,
      {
        type: 'resourceChanged',
        reason: 'adjust the grain by a finite delta',
        payload: { resource: 'grain', mode: 'delta', change: -Number.MAX_VALUE },
      },
    ];

    const result = await executeWithRepair(originalPatches, repairedPatches, initialState);

    expect(result.stateWritebackLlmClient.generate).toHaveBeenCalledOnce();
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.playerResources.grain).toBe(0);
    expect(result.statePatches?.[1].payload).toEqual({
      resource: 'grain',
      mode: 'delta',
      change: -Number.MAX_VALUE,
    });
  });

  it('validates forbidden raw resource fields before canonicalization and sends diagnostics to repair', async () => {
    const initialState = {
      ...makeState(),
      playerResources: { grain: 10 },
    };
    const originalPatches: StatePatch[] = [
      {
        type: 'resourceChanged',
        reason: 'Store one grain without granting office or world authority.',
        payload: {
          resource: 'grain',
          mode: 'delta',
          change: 1,
          officeTitle: 'field marshal',
          wholeWorldState: { injected: true },
        },
      },
      timeAdvancePatch,
    ];
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'The invalid writeback is diagnosed.',
          suggestedActions: [],
          statePatches: originalPatches,
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async (_request: LlmGenerateRequest) => ({
        content: JSON.stringify({
          narrativeText: 'The attempted repair remains invalid.',
          suggestedActions: [],
          statePatches: originalPatches,
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'repair-model',
      })),
    };

    const result = await executeTurn(worldBook, initialState, 'Store the grain.', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(stateWritebackLlmClient.generate).toHaveBeenCalledOnce();
    const repairPrompt = stateWritebackLlmClient.generate.mock.calls[0]?.[0].messages
      .map((message) => message.content)
      .join('\n');
    expect(repairPrompt).toContain('不允许通过 patch 直接修改 wholeWorldState');
    expect(repairPrompt).toContain('officeTitle');
    expect(result.patchValidation?.valid).toBe(false);
    expect(result.newRuntimeState.playerResources.grain).toBe(10);
    expect(result.newRuntimeState.currentDate).toBe(initialState.currentDate);
    expect(result.newRuntimeState.lastStatePatch).toBe(initialState.lastStatePatch);
    expect(result.newRuntimeState.turnLog[result.newRuntimeState.turnLog.length - 1]?.statePatchSummary)
      .toContain('状态变更校验失败');
  });

  it('sends every indexed validator failure and the complete batch to one writeback repair request', async () => {
    const narrativeText = 'The workshop deed is signed and its expansion order is reviewed.';
    const originalPatches: StatePatch[] = [
      privateAssetPatch(),
      {
        type: 'luanshiCommand',
        reason: 'An empty optional identity shell should be ignored.',
        payload: {
          command: {
            action: 'updateCharacterIdentity',
            characterId: 'player',
            characterType: 'player',
          },
        },
      },
      privateAssetProjectPatch({ type: 'unsupported_project', status: 'impossible' }),
      {
        type: 'unsupportedLegacyEvent' as StatePatch['type'],
        reason: 'An obsolete event patch was emitted.',
        payload: { summary: 'The workshop order was reviewed.' },
      },
      timeAdvancePatch,
    ];
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText,
          suggestedActions: [],
          statePatches: originalPatches,
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async (_request: LlmGenerateRequest) => ({
        content: JSON.stringify({
          narrativeText: 'This repair response must not replace the narrative.',
          suggestedActions: [],
          statePatches: [
            privateAssetPatch(),
            originalPatches[1],
            privateAssetProjectPatch(),
            {
              type: 'localSituationChanged',
              reason: 'An obsolete event patch was emitted.',
              payload: { notes: ['The workshop order was reviewed.'] },
            },
            timeAdvancePatch,
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'repair-model',
      })),
    };

    const repairState = {
      ...makeState(),
      troops: [
        {
          troopId: 'troop_current_main',
          name: 'Current Main Camp',
          size: 1560,
          lifecycleStatus: 'active',
          morale: 70,
          training: 60,
          supplies: 'five days',
          task: 'train after regroup',
          relationToPlayer: 'self',
        },
        {
          troopId: 'troop_retired_old',
          name: 'Retired Old Camp',
          size: 680,
          lifecycleStatus: 'merged',
          mergedIntoTroopId: 'troop_current_main',
          morale: 60,
          training: 55,
          supplies: 'transferred',
          task: 'historical formation',
          relationToPlayer: 'self',
        },
      ],
    } as RuntimeState;
    const result = await executeTurn(worldBook, repairState, 'Manage the workshop.', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(stateWritebackLlmClient.generate).toHaveBeenCalledOnce();
    const repairRequest = stateWritebackLlmClient.generate.mock.calls[0]?.[0];
    expect(repairRequest).toBeDefined();
    const repairPrompt = repairRequest!.messages.map((message) => message.content).join('\n');
    expect(repairPrompt).toContain('## StatePatch validator 逐条诊断');
    expect(repairPrompt).toContain('按原始 patchIndex 一一对应');
    expect(repairPrompt).toContain('不得增删、合并或重排槽位');
    expect(repairPrompt).toContain('"patchIndex": 2');
    expect(repairPrompt).toContain('"patchType": "luanshiCommand"');
    expect(repairPrompt).toContain('"commandAction": "upsertPrivateAssetProject"');
    expect(repairPrompt).toContain('upsertPrivateAssetProject.type is invalid: unsupported_project');
    expect(repairPrompt).toContain('upsertPrivateAssetProject.status is invalid: impossible');
    expect(repairPrompt).toContain('"patchIndex": 3');
    expect(repairPrompt).toContain('"patchType": "unsupportedLegacyEvent"');
    expect(repairPrompt).toContain('不允许的 patch 类型：unsupportedLegacyEvent');
    expect(repairPrompt).toContain('"reason": "An empty optional identity shell should be ignored."');
    expect(repairPrompt).toContain('"reason": "An obsolete event patch was emitted."');
    expect(repairPrompt).toContain('当前部队：\n- 部队：Current Main Camp');
    expect(repairPrompt).toContain('历史建制（不得计入当前兵力）：\n- 历史部队：Retired Old Camp');
    expect(repairPrompt).toContain('lifecycle=merged');
    expect(repairPrompt).toContain('mergedInto=troop_current_main');

    expect(result.narrativeText).toBe(narrativeText);
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.statePatches).toHaveLength(4);
    expect(result.newRuntimeState.privateAssets).toHaveLength(1);
    expect(result.newRuntimeState.privateAssetProjects).toHaveLength(1);
    expect(result.newRuntimeState.localSituationNotes).toContain('The workshop order was reviewed.');
  });

  it('rejects a repair response that silently omits a diagnosed source slot', async () => {
    const narrativeText = 'The workshop expansion order contains two malformed state writes.';
    const originalPatches: StatePatch[] = [
      privateAssetPatch(),
      privateAssetProjectPatch({ type: 'unsupported_project' }),
      {
        type: 'unsupportedLegacyEvent' as StatePatch['type'],
        reason: 'An obsolete event patch was emitted.',
        payload: { summary: 'The workshop order was reviewed.' },
      },
      timeAdvancePatch,
    ];
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({ narrativeText, suggestedActions: [], statePatches: originalPatches, statePatch: null }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async (_request: LlmGenerateRequest) => ({
        content: JSON.stringify({
          narrativeText: 'Repair output.',
          suggestedActions: [],
          statePatches: [privateAssetPatch(), privateAssetProjectPatch(), timeAdvancePatch],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'repair-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), 'Manage the workshop.', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(stateWritebackLlmClient.generate).toHaveBeenCalledOnce();
    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('unsupported_project');
    expect(result.patchValidation?.errors.join('\n')).toContain('unsupportedLegacyEvent');
    expect(result.statePatches).toHaveLength(4);
    expect(result.newRuntimeState.privateAssets).toEqual([]);
    expect(result.newRuntimeState.privateAssetProjects).toEqual([]);
    expect(result.newRuntimeState.turnLog[0].fullNarrativeText).toBe(narrativeText);
  });

  it('keeps an original timeAdvance in its transaction slot when repair omits it', async () => {
    const patchesBeforeRepair: StatePatch[] = [
      { type: 'localSituationChanged', payload: { notes: ['before time'] }, reason: 'First slot.' },
      timeAdvancePatch,
      { type: 'resourceChanged', payload: { resource: 'grain', mode: 'delta', change: 2 }, reason: 'Third slot.' },
    ];
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'The ordered batch is repaired.',
          suggestedActions: [],
          statePatches: patchesBeforeRepair,
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async (_request: LlmGenerateRequest) => ({
        content: JSON.stringify({
          narrativeText: 'Repair output.',
          suggestedActions: [],
          statePatches: [patchesBeforeRepair[0], patchesBeforeRepair[2]],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'repair-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), 'Apply the ordered batch.', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.statePatches?.map((patch) => patch.type)).toEqual([
      'localSituationChanged',
      'timeAdvance',
      'resourceChanged',
    ]);
  });

  it('rejects a repair candidate that actively moves an original timeAdvance to another slot', async () => {
    const originalPatches: StatePatch[] = [
      { type: 'localSituationChanged', payload: { notes: ['before time'] }, reason: 'First slot.' },
      timeAdvancePatch,
      { type: 'resourceChanged', payload: { resource: 'grain', mode: 'delta', change: 2 }, reason: 'Third slot.' },
    ];
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'The repair tries to reorder time.',
          suggestedActions: [],
          statePatches: originalPatches,
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async (_request: LlmGenerateRequest) => ({
        content: JSON.stringify({
          narrativeText: 'Repair output.',
          suggestedActions: [],
          statePatches: [originalPatches[1], originalPatches[0], originalPatches[2]],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'repair-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), 'Apply the ordered batch.', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.statePatches?.map((patch) => patch.type)).toEqual([
      'localSituationChanged',
      'timeAdvance',
      'resourceChanged',
    ]);
    expect(result.statePatches?.[1].reason).toBe(timeAdvancePatch.reason);
  });

  it('rejects a timeAdvance substitute in a business slot even when the original timeAdvance is duplicated intact', async () => {
    const originalPatches: StatePatch[] = [
      { type: 'localSituationChanged', payload: { notes: ['before time'] }, reason: 'First slot.' },
      timeAdvancePatch,
      { type: 'resourceChanged', payload: { resource: 'grain', mode: 'delta', change: 2 }, reason: 'Third slot.' },
    ];
    const repairedPatches: StatePatch[] = [
      { type: 'timeAdvance', payload: { minutesAdvanced: 5 }, reason: 'First slot.' },
      timeAdvancePatch,
      originalPatches[2],
    ];

    const result = await executeWithRepair(originalPatches, repairedPatches);

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.statePatches).toEqual(originalPatches);
    expect(result.newRuntimeState.localSituationNotes).toContain('before time');
  });

  it('rejects a repaired timeAdvance whose normalized content differs at the original slot', async () => {
    const originalPatches: StatePatch[] = [
      { type: 'localSituationChanged', payload: { notes: ['before time'] }, reason: 'First slot.' },
      timeAdvancePatch,
      { type: 'resourceChanged', payload: { resource: 'grain', mode: 'delta', change: 2 }, reason: 'Third slot.' },
    ];
    const repairedPatches: StatePatch[] = [
      originalPatches[0],
      { type: 'timeAdvance', payload: { hoursAdvanced: 9 }, reason: timeAdvancePatch.reason },
      originalPatches[2],
    ];

    const result = await executeWithRepair(originalPatches, repairedPatches);

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.statePatches).toEqual(originalPatches);
  });

  it('rejects appending a duplicate timeAdvance when the original batch already has one', async () => {
    const originalPatches: StatePatch[] = [
      { type: 'localSituationChanged', payload: { notes: ['before time'] }, reason: 'First slot.' },
      timeAdvancePatch,
      { type: 'resourceChanged', payload: { resource: 'grain', mode: 'delta', change: 2 }, reason: 'Third slot.' },
    ];

    const result = await executeWithRepair(originalPatches, [...originalPatches, timeAdvancePatch]);

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.statePatches).toEqual(originalPatches);
  });

  it('preserves the complete normalized raw prefix when a no-diagnostics repair omits a legal business patch', async () => {
    const originalPatches: StatePatch[] = [
      timeAdvancePatch,
      { type: 'resourceChanged', payload: { resource: 'grain', mode: 'delta', change: 7 }, reason: 'Store seven grain.' },
    ];

    const result = await executeWithRepair(originalPatches, [timeAdvancePatch]);

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.statePatches).toEqual(originalPatches);
    expect(result.newRuntimeState.playerResources.grain).toBe(7);
  });

  it('treats legacy and canonical resource payloads as the same raw slot during repair', async () => {
    const originalPatches: StatePatch[] = [
      timeAdvancePatch,
      { type: 'resourceChanged', payload: { resource: 'grain', change: '7' }, reason: 'Store seven grain.' },
    ];
    const repairedPatches: StatePatch[] = [
      timeAdvancePatch,
      {
        type: 'resourceChanged',
        payload: { resource: 'grain', mode: 'delta', change: 7 },
        reason: 'Store seven grain.',
      },
      {
        type: 'localSituationChanged',
        payload: { notes: ['The repaired response adds a unique legal note.'] },
        reason: 'Record the legal note.',
      },
    ];

    const result = await executeWithRepair(originalPatches, repairedPatches);

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.statePatches).toHaveLength(3);
    expect(result.statePatches?.[1].payload).toEqual({
      resource: 'grain',
      mode: 'delta',
      change: 7,
    });
    expect(result.newRuntimeState.playerResources.grain).toBe(7);
    expect(result.newRuntimeState.localSituationNotes).toContain('The repaired response adds a unique legal note.');
  });

  it('repairs a targetType-only relationship in place while preserving the complete patch sequence', async () => {
    const originalPatches: StatePatch[] = [
      timeAdvancePatch,
      {
        type: 'relationshipChange',
        payload: {
          actorId: 'actor_source',
          targetId: 'faction_target',
          targetType: 'faction',
          value: '25',
        },
        reason: 'Record the faction relationship.',
      },
      {
        type: 'resourceChanged',
        payload: { resource: 'grain', mode: 'delta', change: 4 },
        reason: 'Store four grain after the meeting.',
      },
    ];
    const repairedPatches: StatePatch[] = [
      timeAdvancePatch,
      {
        type: 'relationshipChange',
        payload: {
          actorId: 'actor_source',
          targetId: 'faction_target',
          targetKind: 'faction',
          value: 25,
        },
        reason: 'Record the faction relationship.',
      },
      originalPatches[2],
    ];

    const result = await executeWithRepair(originalPatches, repairedPatches);

    expect(result.stateWritebackLlmClient.generate).toHaveBeenCalledOnce();
    const repairPrompt = result.stateWritebackLlmClient.generate.mock.calls[0]?.[0].messages
      .map((message) => message.content)
      .join('\n');
    expect(repairPrompt).toContain('"patchIndex": 1');
    expect(repairPrompt).toContain('relationshipChange.targetKind 必须明确为 actor 或 faction');
    expect(result.patchValidation?.valid).toBe(true);
    expect(result.statePatches).toHaveLength(3);
    expect(result.statePatches?.[1].payload).toEqual({
      actorId: 'actor_source',
      targetId: 'faction_target',
      targetKind: 'faction',
      targetType: 'faction',
      value: 25,
    });
    expect(result.newRuntimeState.relationships).toContainEqual(expect.objectContaining({
      actorId: 'actor_source',
      targetId: 'faction_target',
      targetKind: 'faction',
      targetType: 'faction',
      value: 25,
    }));
    expect(result.newRuntimeState.playerResources.grain).toBe(4);
    expect(result.statePatches?.[0]).toEqual(timeAdvancePatch);
    expect(result.statePatches?.[2]).toEqual(originalPatches[2]);
  });

  it.each(['actor', 'faction'] as const)(
    'rejects a repair that chooses %s when the original relationship has no kind hint',
    async (chosenKind) => {
      const originalPatch: StatePatch = {
        type: 'relationshipChange',
        payload: {
          actorId: 'actor_source',
          targetId: 'target_unknown_kind',
          value: 'bad',
        },
        reason: 'Repair the relationship value without inventing target identity.',
      };
      const repairedPatch: StatePatch = {
        type: 'relationshipChange',
        payload: {
          actorId: 'actor_source',
          targetId: 'target_unknown_kind',
          targetKind: chosenKind,
          value: 25,
        },
        reason: originalPatch.reason,
      };

      const result = await executeWithRepair(
        [timeAdvancePatch, originalPatch],
        [timeAdvancePatch, repairedPatch],
      );

      expect(result.stateWritebackLlmClient.generate).toHaveBeenCalledOnce();
      expect(result.patchValidation?.valid).toBe(false);
      expect(result.statePatches).toEqual([timeAdvancePatch, originalPatch]);
      expect(result.newRuntimeState.relationships).toEqual([]);
      expect(result.newRuntimeState.currentDate).toBe(makeState().currentDate);
    },
  );

  it('repairs a malformed resource number without changing its inferred business identity', async () => {
    const originalPatches: StatePatch[] = [
      timeAdvancePatch,
      {
        type: 'resourceChanged',
        payload: { resource: 'grain', change: '1kg' },
        reason: 'Store one grain.',
      },
    ];
    const repairedPatches: StatePatch[] = [
      timeAdvancePatch,
      {
        type: 'resourceChanged',
        payload: { resource: 'grain', mode: 'delta', change: 1 },
        reason: 'Store one grain.',
      },
    ];

    const result = await executeWithRepair(originalPatches, repairedPatches);

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.playerResources.grain).toBe(1);
    expect(result.statePatches?.[0]).toEqual(timeAdvancePatch);
    expect(result.statePatches?.[1].payload).toEqual({
      resource: 'grain',
      mode: 'delta',
      change: 1,
    });
  });

  it.each([
    {
      label: 'relationship target',
      originalPatch: {
        type: 'relationshipChange',
        payload: {
          actorId: 'actor_source',
          targetId: 'faction_a',
          targetType: 'faction',
          value: 'bad',
        },
        reason: 'Record the faction relationship.',
      } as StatePatch,
      repairedPatch: {
        type: 'relationshipChange',
        payload: {
          actorId: 'actor_source',
          targetId: 'faction_b',
          targetKind: 'faction',
          value: 25,
        },
        reason: 'Record the faction relationship.',
      } as StatePatch,
    },
    {
      label: 'resource name',
      originalPatch: {
        type: 'resourceChanged',
        payload: { resource: 'grain', mode: 'delta', change: '1kg' },
        reason: 'Adjust the resource.',
      } as StatePatch,
      repairedPatch: {
        type: 'resourceChanged',
        payload: { resource: 'money', mode: 'delta', change: 1 },
        reason: 'Adjust the resource.',
      } as StatePatch,
    },
    {
      label: 'resource mode',
      originalPatch: {
        type: 'resourceChanged',
        payload: { resource: 'grain', mode: 'delta', change: '1kg' },
        reason: 'Adjust the resource.',
      } as StatePatch,
      repairedPatch: {
        type: 'resourceChanged',
        payload: { resource: 'grain', mode: 'absolute', newValue: 1 },
        reason: 'Adjust the resource.',
      } as StatePatch,
    },
  ])('rejects a diagnosed repair that changes the $label identity', async ({ originalPatch, repairedPatch }) => {
    const originalPatches = [timeAdvancePatch, originalPatch];
    const repairedPatches = [timeAdvancePatch, repairedPatch];

    const result = await executeWithRepair(originalPatches, repairedPatches);

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.statePatches).toEqual(originalPatches);
    expect(result.newRuntimeState.currentDate).toBe(makeState().currentDate);
    expect(result.newRuntimeState.relationships).toEqual([]);
    expect(result.newRuntimeState.playerResources).toEqual({});
  });

  it.each([
    {
      label: 'missing resource',
      originalPatch: {
        type: 'resourceChanged',
        payload: { mode: 'delta', change: '1kg' },
        reason: 'Repair the resource.',
      } as StatePatch,
      repairedPatch: {
        type: 'resourceChanged',
        payload: { resource: 'grain', mode: 'delta', change: 1 },
        reason: 'Repair the resource.',
      } as StatePatch,
    },
    {
      label: 'ambiguous resource mode',
      originalPatch: {
        type: 'resourceChanged',
        payload: { resource: 'grain', change: '1kg', newValue: '2kg' },
        reason: 'Repair the resource.',
      } as StatePatch,
      repairedPatch: {
        type: 'resourceChanged',
        payload: { resource: 'grain', mode: 'delta', change: 1 },
        reason: 'Repair the resource.',
      } as StatePatch,
    },
    {
      label: 'inconsistent faction alias',
      originalPatch: {
        type: 'relationshipChange',
        payload: {
          actorId: 'actor_source',
          targetId: 'faction_a',
          targetKind: 'faction',
          factionId: 'faction_b',
          value: 25,
        },
        reason: 'Repair the relationship.',
      } as StatePatch,
      repairedPatch: {
        type: 'relationshipChange',
        payload: {
          actorId: 'actor_source',
          targetId: 'faction_a',
          targetKind: 'faction',
          value: 25,
        },
        reason: 'Repair the relationship.',
      } as StatePatch,
    },
  ])('rejects automatic repair when the diagnosed $label identity is not recoverable', async ({
    originalPatch,
    repairedPatch,
  }) => {
    const originalPatches = [timeAdvancePatch, originalPatch];

    const result = await executeWithRepair(originalPatches, [timeAdvancePatch, repairedPatch]);

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.statePatches).toEqual(originalPatches);
    expect(result.newRuntimeState.currentDate).toBe(makeState().currentDate);
  });

  it('does not merge repaired quest or signal writeback when the patch candidate is rejected', async () => {
    const originalPatches: StatePatch[] = [
      timeAdvancePatch,
      { type: 'resourceChanged', payload: { resource: 'grain', mode: 'delta', change: 7 }, reason: 'Store seven grain.' },
    ];
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'The original state writes remain authoritative.',
          suggestedActions: [],
          statePatches: originalPatches,
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'Rejected repair output.',
          suggestedActions: [],
          statePatches: [],
          statePatch: null,
          writeback: {
            questChanges: [{
              action: 'add',
              questId: 'quest_rejected_repair',
              title: 'Rejected repair quest',
              summary: 'This writeback must not be applied.',
            }],
            signalChanges: [{
              action: 'add',
              rumorId: 'signal_rejected_repair',
              content: 'This rejected signal must not be applied.',
              source: 'rejected repair',
            }],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'repair-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), 'Keep the original state writes.', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(result.statePatches).toEqual(originalPatches);
    expect(result.newRuntimeState.playerResources.grain).toBe(7);
    expect(result.newRuntimeState.activeQuests.some((quest) => quest.id === 'quest_rejected_repair')).toBe(false);
    expect(result.newRuntimeState.knownRumors.some((rumor) => rumor.id === 'signal_rejected_repair')).toBe(false);
  });

  it('accepts a pure writeback repair when both patch arrays are empty', async () => {
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'A new matter is recorded after a short conversation.',
          suggestedActions: [],
          statePatches: [],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: 'Pure writeback repair.',
            suggestedActions: [],
            statePatches: [],
            statePatch: null,
            writeback: {
              questChanges: [{
                action: 'add',
                questId: 'quest_pure_writeback',
                title: 'Pure writeback quest',
                summary: 'Recorded without replacing any StatePatch.',
              }],
              signalChanges: [{
                action: 'add',
                rumorId: 'signal_pure_writeback',
                content: 'A pure writeback signal.',
                source: 'accepted repair',
              }],
            },
          }),
          provider: 'openai_compatible' as const,
          model: 'repair-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: 'Focused time repair.',
            suggestedActions: [],
            statePatches: [
              { type: 'timeAdvance', payload: { minutesAdvanced: 10 }, reason: 'The conversation takes ten minutes.' },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'repair-model',
        }),
    };

    const result = await executeTurn(worldBook, makeState(), 'Record the new matter.', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(stateWritebackLlmClient.generate).toHaveBeenCalledTimes(2);
    expect(result.newRuntimeState.activeQuests.some((quest) => quest.id === 'quest_pure_writeback')).toBe(true);
    expect(result.newRuntimeState.knownRumors.some((rumor) => rumor.id === 'signal_pure_writeback')).toBe(true);
  });

  it('rejects a no-diagnostics tail patch that duplicates an original prefix patch', async () => {
    const resourcePatch: StatePatch = {
      type: 'resourceChanged',
      payload: { resource: 'grain', mode: 'delta', change: 7 },
      reason: 'Store seven grain.',
    };
    const originalPatches = [timeAdvancePatch, resourcePatch];

    const result = await executeWithRepair(originalPatches, [...originalPatches, resourcePatch]);

    expect(result.statePatches).toEqual(originalPatches);
    expect(result.newRuntimeState.playerResources.grain).toBe(7);
  });

  it('rejects duplicate patches within a no-diagnostics appended tail', async () => {
    const resourcePatch: StatePatch = {
      type: 'resourceChanged',
      payload: { resource: 'grain', mode: 'delta', change: 3 },
      reason: 'Store three grain.',
    };
    const originalPatches = [timeAdvancePatch];

    const result = await executeWithRepair(originalPatches, [timeAdvancePatch, resourcePatch, resourcePatch]);

    expect(result.statePatches).toEqual(originalPatches);
    expect(result.newRuntimeState.playerResources.grain).toBeUndefined();
  });

  it('rejects two appended timeAdvance patches when the original batch has no time advance', async () => {
    const originalPatches: StatePatch[] = [
      { type: 'resourceChanged', payload: { resource: 'grain', mode: 'delta', change: 4 }, reason: 'Store four grain.' },
    ];
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'The grain is stored after a short wait.',
          suggestedActions: [],
          statePatches: originalPatches,
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: 'Repair output.',
            suggestedActions: [],
            statePatches: [
              originalPatches[0],
              { type: 'timeAdvance', payload: { minutesAdvanced: 10 }, reason: 'The first wait.' },
              { type: 'timeAdvance', payload: { minutesAdvanced: 15 }, reason: 'The duplicate wait.' },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'repair-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: 'Focused time repair.',
            suggestedActions: [],
            statePatches: [
              { type: 'timeAdvance', payload: { minutesAdvanced: 10 }, reason: 'The wait takes ten minutes.' },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'repair-model',
        }),
    };

    const result = await executeTurn(worldBook, makeState(), 'Store the grain.', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(stateWritebackLlmClient.generate).toHaveBeenCalledTimes(2);
    expect(result.patchValidation?.valid).toBe(true);
    expect(result.statePatches?.map((patch) => patch.type)).toEqual(['resourceChanged', 'timeAdvance']);
    expect(result.newRuntimeState.playerResources.grain).toBe(4);
  });

  it('recognizes a misnested timeAdvance before focused repair and does not apply time twice', async () => {
    const misnestedTimeAdvance: StatePatch = {
      type: 'luanshiCommand',
      reason: 'The conversation takes twenty minutes.',
      payload: {
        command: {
          action: 'timeAdvance',
          minutesAdvanced: 20,
        },
      },
    };
    const llmClient = {
      generate: vi.fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: 'The conversation ends after twenty minutes.',
            suggestedActions: [],
            statePatches: [misnestedTimeAdvance],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: 'Focused time repair.',
            suggestedActions: [],
            statePatches: [
              { type: 'timeAdvance', payload: { minutesAdvanced: 20 }, reason: 'Duplicate focused repair.' },
            ],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        }),
    };

    const result = await executeTurn(worldBook, makeState(), 'Talk for a while.', { apiConfig, llmClient });

    expect(llmClient.generate).toHaveBeenCalledOnce();
    expect(result.statePatches).toHaveLength(1);
    expect(result.statePatches?.[0].type).toBe('timeAdvance');
    expect(result.newRuntimeState.currentDate).toBe('公元1年01月01日 08:20（辰时）');
  });

  it('rolls back a direct batch containing more than one normalized timeAdvance', async () => {
    const initialState = makeState();
    const result = await executeWithPatches(initialState, 'Too many time writes were emitted.', [
      timeAdvancePatch,
      { type: 'timeAdvance', payload: { minutesAdvanced: 5 }, reason: 'A duplicate time write.' },
    ]);

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('timeAdvance');
    expect(result.newRuntimeState.currentDate).toBe(initialState.currentDate);
  });

  it.each([
    [
      'a direct and a misnested timeAdvance',
      [timeAdvancePatch, misnestedTimeAdvancePatch('A nested duplicate advances five minutes.')],
    ],
    [
      'two misnested timeAdvance patches',
      [
        misnestedTimeAdvancePatch('The first nested time write advances five minutes.'),
        misnestedTimeAdvancePatch('The second nested time write advances five minutes.'),
      ],
    ],
  ] as const)('rolls back %s after canonical counting', async (_label, patches) => {
    const initialState = makeState();

    const result = await executeWithPatches(initialState, 'Duplicate normalized time writes.', [...patches]);

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('timeAdvance');
    expect(result.newRuntimeState.currentDate).toBe(initialState.currentDate);
    expect(result.newRuntimeState.lastStatePatch).toBe(initialState.lastStatePatch);
    expect(result.newRuntimeState.turnLog).toHaveLength(1);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('状态变更校验失败');
  });

  it('diagnoses forbidden fields in a misnested command and accepts a clean slot-preserving repair', async () => {
    const rumorReason = 'Record the courier rumor without direct power writes.';
    const originalRumor = {
      type: 'luanshiCommand',
      reason: rumorReason,
      payload: {
        command: {
          action: 'rumorAdded',
          content: 'A courier claims the city gates will close tonight.',
          officeTitle: 'field marshal',
          wholeWorldState: { injected: true },
        },
      },
    } as unknown as StatePatch;
    const repairedRumor: StatePatch = {
      type: 'rumorAdded',
      reason: rumorReason,
      payload: {
        content: 'A courier claims the city gates will close tonight.',
        verified: false,
      },
    };

    const result = await executeWithRepair(
      [originalRumor, timeAdvancePatch],
      [repairedRumor, timeAdvancePatch],
    );

    expect(result.stateWritebackLlmClient.generate).toHaveBeenCalledOnce();
    const repairRequest = result.stateWritebackLlmClient.generate.mock.calls[0][0];
    expect(JSON.stringify(repairRequest.messages)).toContain('wholeWorldState');
    expect(JSON.stringify(repairRequest.messages)).toContain('officeTitle');
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.statePatches?.map((patch) => patch.type)).toEqual(['rumorAdded', 'timeAdvance']);
    expect(result.newRuntimeState.knownRumors).toHaveLength(1);
    expect(result.newRuntimeState.currentDate).toBe('公元1年01月01日 09:00（巳时）');
  });

  it('keeps lastStatePatch isolated from mutations to the returned statePatches array', async () => {
    const result = await executeWithPatches(makeState(), 'The workshop arrangements finish.', [timeAdvancePatch]);
    const returnedPatch = result.statePatches?.[0];
    const storedPatch = result.newRuntimeState.lastStatePatch;

    expect(returnedPatch).toBeDefined();
    expect(storedPatch).toEqual(returnedPatch);
    returnedPatch!.reason = 'Mutated after executeTurn returned.';
    (returnedPatch!.payload as { hoursAdvanced?: number }).hoursAdvanced = 99;

    expect(storedPatch?.reason).toBe(timeAdvancePatch.reason);
    expect(storedPatch?.payload).toEqual({ hoursAdvanced: 1 });
  });

  it('rejects legal replacements that are swapped between two diagnosed source slots', async () => {
    const originalPatches: StatePatch[] = [
      privateAssetPatch(),
      privateAssetProjectPatch({ type: 'unsupported_project' }),
      {
        type: 'unsupportedLegacyEvent' as StatePatch['type'],
        reason: 'Record the workshop review as a local situation.',
        payload: { summary: 'The workshop order was reviewed.' },
      },
      timeAdvancePatch,
    ];
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'Two malformed slots need distinct repairs.',
          suggestedActions: [],
          statePatches: originalPatches,
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async (_request: LlmGenerateRequest) => ({
        content: JSON.stringify({
          narrativeText: 'Repair output.',
          suggestedActions: [],
          statePatches: [
            privateAssetPatch(),
            {
              type: 'localSituationChanged',
              reason: 'Record the workshop review as a local situation.',
              payload: { notes: ['The workshop order was reviewed.'] },
            },
            privateAssetProjectPatch(),
            timeAdvancePatch,
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'repair-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), 'Manage the workshop.', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('unsupported_project');
    expect(result.patchValidation?.errors.join('\n')).toContain('unsupportedLegacyEvent');
    expect(result.newRuntimeState.privateAssets).toEqual([]);
    expect(result.newRuntimeState.privateAssetProjects).toEqual([]);
    expect(result.newRuntimeState.localSituationNotes).toEqual([]);
  });

  it('rejects automatic repair when two unknown diagnosed slots have the same intent anchor', async () => {
    const sharedReason = 'Repair the workshop record.';
    const originalPatches: StatePatch[] = [
      {
        type: 'unsupportedLocalRecord' as StatePatch['type'],
        reason: sharedReason,
        payload: { intent: 'record a local workshop situation' },
      },
      {
        type: 'unsupportedResourceRecord' as StatePatch['type'],
        reason: sharedReason,
        payload: { intent: 'record a grain increase' },
      },
      timeAdvancePatch,
    ];
    const repairedPatches: StatePatch[] = [
      { type: 'resourceChanged', reason: sharedReason, payload: { resource: 'grain', mode: 'delta', change: 3 } },
      { type: 'localSituationChanged', reason: sharedReason, payload: { notes: ['Workshop record repaired.'] } },
      timeAdvancePatch,
    ];

    const result = await executeWithRepair(originalPatches, repairedPatches);

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('unsupportedLocalRecord');
    expect(result.patchValidation?.errors.join('\n')).toContain('unsupportedResourceRecord');
    expect(result.statePatches).toEqual(originalPatches);
    expect(result.newRuntimeState.resources?.grain).toBe(0);
    expect(result.newRuntimeState.localSituationNotes).toEqual([]);
    expect(result.newRuntimeState.currentDate).toBe(makeState().currentDate);
  });

  it('rejects changing a legal non-diagnosed raw slot into a sanitizer no-op', async () => {
    const identityPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'Keep the identity update.',
      payload: {
        command: {
          action: 'updateCharacterIdentity',
          characterId: 'player',
          characterType: 'player',
          currentIdentity: 'Workshop owner',
        },
      },
    };
    const originalPatches: StatePatch[] = [
      identityPatch,
      {
        type: 'unsupportedLegacyEvent' as StatePatch['type'],
        reason: 'Repair the legacy event.',
        payload: { summary: 'The workshop was inspected.' },
      },
      timeAdvancePatch,
    ];
    const repairedPatches: StatePatch[] = [
      {
        type: 'luanshiCommand',
        reason: identityPatch.reason,
        payload: {
          command: {
            action: 'updateCharacterIdentity',
            characterId: 'player',
            characterType: 'player',
          },
        },
      },
      {
        type: 'localSituationChanged',
        reason: 'Repair the legacy event.',
        payload: { notes: ['The workshop was inspected.'] },
      },
      timeAdvancePatch,
    ];

    const result = await executeWithRepair(originalPatches, repairedPatches);

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.statePatches).toEqual(originalPatches);
    expect(result.newRuntimeState.player.currentIdentity).not.toBe('Workshop owner');
    expect(result.newRuntimeState.localSituationNotes).toEqual([]);
  });

  it('rejects changing an original sanitizer no-op raw slot into an effective write', async () => {
    const noOpIdentityPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'Keep the empty identity shell.',
      payload: {
        command: {
          action: 'updateCharacterIdentity',
          characterId: 'player',
          characterType: 'player',
        },
      },
    };
    const originalPatches: StatePatch[] = [
      noOpIdentityPatch,
      {
        type: 'unsupportedLegacyEvent' as StatePatch['type'],
        reason: 'Repair the legacy event.',
        payload: { summary: 'The workshop was inspected.' },
      },
      timeAdvancePatch,
    ];
    const repairedPatches: StatePatch[] = [
      {
        type: 'luanshiCommand',
        reason: noOpIdentityPatch.reason,
        payload: {
          command: {
            action: 'updateCharacterIdentity',
            characterId: 'player',
            characterType: 'player',
            currentIdentity: 'Injected workshop owner',
          },
        },
      },
      {
        type: 'localSituationChanged',
        reason: 'Repair the legacy event.',
        payload: { notes: ['The workshop was inspected.'] },
      },
      timeAdvancePatch,
    ];

    const result = await executeWithRepair(originalPatches, repairedPatches);

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.statePatches).toEqual(originalPatches.slice(1));
    expect(result.newRuntimeState.turnLog[0].displayMeta?.rawResponse).toContain(noOpIdentityPatch.reason);
    expect(result.newRuntimeState.player.currentIdentity).not.toBe('Injected workshop owner');
    expect(result.newRuntimeState.localSituationNotes).toEqual([]);
  });

  it('rolls back when a complete repair response still contains an illegal replacement', async () => {
    const narrativeText = 'The repair keeps an invalid project status.';
    const originalPatches = [
      privateAssetPatch(),
      privateAssetProjectPatch({ status: 'impossible' }),
      timeAdvancePatch,
    ];
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({ narrativeText, suggestedActions: [], statePatches: originalPatches, statePatch: null }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const stateWritebackLlmClient = {
      generate: vi.fn(async (_request: LlmGenerateRequest) => ({
        content: JSON.stringify({
          narrativeText: 'Repair output.',
          suggestedActions: [],
          statePatches: [
            privateAssetPatch(),
            privateAssetProjectPatch({ status: 'still_impossible' }),
            timeAdvancePatch,
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'repair-model',
      })),
    };

    const result = await executeTurn(worldBook, makeState(), 'Manage the workshop.', {
      apiConfig,
      stateWritebackApiConfig,
      llmClient,
      stateWritebackLlmClient,
    });

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.patchValidation?.errors.join('\n')).toContain('status is invalid: impossible');
    expect(result.patchValidation?.errors.join('\n')).not.toContain('still_impossible');
    expect(result.newRuntimeState.privateAssets).toEqual([]);
    expect(result.newRuntimeState.privateAssetProjects).toEqual([]);
    expect(result.newRuntimeState.turnLog[0].fullNarrativeText).toBe(narrativeText);
  });
});

describe('continuity domain isolation', () => {
  it('keeps time and unrelated facts when an invalid resource command survives repair', async () => {
    const result = await executeWithPatches(
      makeState(),
      'The hour passes while the quartermaster submits a malformed ledger update.',
      [
        {
          type: 'luanshiCommand',
          reason: 'Malformed optional resource ledger.',
          payload: {
            command: {
              action: 'updateResourceLedger',
              playerResources: { money: 'not-a-number' },
              summary: 'Invalid optional ledger entry.',
            },
          },
        } as any,
        {
          type: 'localSituationChanged',
          reason: 'Keep an unrelated local fact.',
          payload: { notes: ['The watch changed normally.'] },
        },
        timeAdvancePatch,
      ],
    );

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.patchValidation?.warnings.join('\n')).toContain('附属补丁被隔离');
    expect(result.newRuntimeState.currentDate).not.toBe(makeState().currentDate);
    expect(result.newRuntimeState.localSituationNotes).toEqual(['The watch changed normally.']);
    expect(result.newRuntimeState.turnLog[result.newRuntimeState.turnLog.length - 1]?.statePatchSummary)
      .toContain('附属补丁已按域隔离');
  });

  it('isolates an invented auxiliary command without stalling the valid time patch', async () => {
    const result = await executeWithPatches(
      makeState(),
      'The hour passes despite an invented auxiliary command.',
      [
        {
          type: 'luanshiCommand',
          reason: 'Invented legacy quest collection.',
          payload: { command: { action: 'questChanges', changes: [] } },
        } as any,
        timeAdvancePatch,
      ],
    );

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.currentDate).not.toBe(makeState().currentDate);
    expect(result.statePatches).toEqual([timeAdvancePatch]);
  });

  it('isolates the whole NPC memory domain when an absent NPC is given firsthand memory', async () => {
    const state = makeState();
    state.npcs = [
      {
        npcId: 'npc_absent_guard',
        name: '赵成',
        sex: '男',
        age: 31,
        role: '亲卫',
        isPresent: false,
        isFocused: false,
        summary: '正在外地办差。',
        appearance: '短衣佩刀',
        personality: '谨慎',
        motivation: '完成军令',
        relationToPlayer: '部属',
        contactLevel: 2,
        recentAttitude: '忠诚',
        abilityScores: {},
        traits: [],
        uniqueArts: [],
        equipment: [],
        inventory: [],
        memories: [],
        locationId: 'place_elsewhere',
      },
      {
        npcId: 'npc_present_guard',
        name: '张铁',
        sex: '男',
        age: 28,
        role: '队率',
        isPresent: true,
        isFocused: true,
        summary: '随侍在侧。',
        appearance: '粗布短褐',
        personality: '勇直',
        motivation: '护卫主公',
        relationToPlayer: '部属',
        contactLevel: 2,
        recentAttitude: '敬服',
        abilityScores: {},
        traits: [],
        uniqueArts: [],
        equipment: [],
        inventory: [],
        memories: [],
        locationId: 'place_market',
      },
    ];

    const result = await executeWithPatches(
      state,
      'The hour passes while one invalid firsthand memory is rejected.',
      [
        {
          type: 'luanshiCommand',
          reason: 'An absent NPC must not receive firsthand memory.',
          payload: {
            command: {
              action: 'pushNpcMemory',
              npcId: 'npc_absent_guard',
              npcName: '赵成',
              source: '亲历',
              value: '亲眼见证了当前商议。',
            },
          },
        },
        {
          type: 'luanshiCommand',
          reason: 'A valid memory in the same domain must remain atomic with its peer.',
          payload: {
            command: {
              action: 'pushNpcMemory',
              npcId: 'npc_present_guard',
              npcName: '张铁',
              source: '亲历',
              value: '亲眼见证了当前商议。',
            },
          },
        },
        {
          type: 'localSituationChanged',
          reason: 'Keep an unrelated local fact.',
          payload: { notes: ['The market watch changed normally.'] },
        },
        timeAdvancePatch,
      ],
    );

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.patchValidation?.warnings.join('\n')).toContain('附属补丁被隔离');
    expect(result.newRuntimeState.currentDate).not.toBe(state.currentDate);
    expect(result.newRuntimeState.localSituationNotes).toEqual(['The market watch changed normally.']);
    expect(result.newRuntimeState.npcs?.find((npc) => npc.npcId === 'npc_absent_guard')?.memories).toEqual([]);
    expect(result.newRuntimeState.npcs?.find((npc) => npc.npcId === 'npc_present_guard')?.memories).toEqual([]);
  });

  it('keeps time advancing when an NPC background activity is missing its stable activity ID', async () => {
    const state = makeState();
    state.npcs = [{
      npcId: 'npc_remote_clerk',
      name: '韩稷',
      sex: '男',
      age: 34,
      role: '军屯书吏',
      isPresent: false,
      isFocused: false,
      summary: '正在远场催办春耕。',
      appearance: '青布吏服',
      personality: '谨慎',
      motivation: '完成军屯差事',
      relationToPlayer: '部属',
      contactLevel: 2,
      recentAttitude: '敬谨',
      abilityScores: {},
      traits: [],
      uniqueArts: [],
      equipment: [],
      inventory: [],
      memories: [],
      locationId: 'holding_fancheng_tuntian_01',
    }];

    const result = await executeWithPatches(
      state,
      'The hour passes while a malformed remote activity is ignored.',
      [
        {
          type: 'luanshiCommand',
          reason: 'The model omitted the stable activity ID.',
          payload: {
            command: {
              action: 'updateNpcBackgroundActivity',
              npcId: 'npc_remote_clerk',
              activity: {
                summary: '继续催办春耕。',
                status: 'active',
              },
            },
          },
        } as any,
        timeAdvancePatch,
      ],
    );

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.patchValidation?.warnings.join('\n')).toContain('附属补丁被隔离');
    expect(result.newRuntimeState.currentDate).not.toBe(state.currentDate);
    expect(result.newRuntimeState.npcs?.[0]?.backgroundActivity).toBeUndefined();
  });

  it('isolates NPC presence and background activity together when locationId is empty', async () => {
    const state = makeState();
    state.npcs = [{
      npcId: 'npc_remote_clerk',
      name: '韩稷',
      sex: '男',
      age: 34,
      role: '军屯书吏',
      isPresent: false,
      isFocused: false,
      summary: '正在远场催办春耕。',
      appearance: '青布吏服',
      personality: '谨慎',
      motivation: '完成军屯差事',
      relationToPlayer: '部属',
      contactLevel: 2,
      recentAttitude: '敬谨',
      abilityScores: {},
      traits: [],
      uniqueArts: [],
      equipment: [],
      inventory: [],
      memories: [],
      locationId: 'holding_fancheng_tuntian_01',
    }];

    const result = await executeWithPatches(
      state,
      'The hour passes while an incomplete presence update is ignored.',
      [
        {
          type: 'luanshiCommand',
          reason: 'The model omitted the NPC location.',
          payload: {
            command: {
              action: 'updateNpcPresence',
              npcId: 'npc_remote_clerk',
              locationId: '',
              isPresent: true,
            },
          },
        },
        {
          type: 'luanshiCommand',
          reason: 'A background activity in the same domain must remain atomic.',
          payload: {
            command: {
              action: 'updateNpcBackgroundActivity',
              npcId: 'npc_remote_clerk',
              activity: {
                activityId: 'npc_activity_fancheng_spring',
                summary: '继续催办春耕。',
                status: 'active',
              },
            },
          },
        },
        timeAdvancePatch,
      ],
    );

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.patchValidation?.warnings.join('\n')).toContain('附属补丁被隔离');
    expect(result.newRuntimeState.currentDate).not.toBe(state.currentDate);
    expect(result.newRuntimeState.npcs?.[0]).toEqual(expect.objectContaining({
      locationId: 'holding_fancheng_tuntian_01',
      isPresent: false,
    }));
    expect(result.newRuntimeState.npcs?.[0]?.backgroundActivity).toBeUndefined();
  });
});

describe('battle writeback continuity', () => {
  it('keeps a valid war record and time advance when an attached resource patch is invalid', async () => {
    const result = await executeWithPatches(
      makeState(),
      'The ambush succeeds and the prisoners are counted.',
      [
        {
          type: 'luanshiCommand',
          payload: {
            command: {
              action: 'upsertConflictRecord',
              conflictId: 'conflict_luomagu_ambush',
              type: '伏击',
              title: '落马谷伏击战',
              summary: '伏兵夹击敌军并控制谷口。',
              occurredAt: '189-09-01 午时',
              outcome: '伏击大胜，敌军溃散。',
              resultLevel: 'decisiveWin',
              judgement: {
                method: 'warJudgementV1',
                scoreBreakdown: {
                  troopBase: 85,
                  commander: 90,
                  tactical: 95,
                  turningPoint: 0,
                  playerAction: 20,
                  total: 290,
                },
              },
            },
          },
          reason: 'Record the Luomagu ambush.',
        },
        {
          type: 'luanshiCommand',
          payload: {
            command: {
              action: 'updateResourceLedger',
              playerResources: { money: 200000 },
              summary: 'Record captured funds using the wrong ledger.',
            },
          },
          reason: 'Count the captured funds.',
        },
        timeAdvancePatch,
      ],
    );

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.patchValidation?.warnings.join('\n')).toContain('附属补丁被隔离');
    expect(result.statePatches).toHaveLength(2);
    expect(result.newRuntimeState.conflicts).toContainEqual(expect.objectContaining({
      conflictId: 'conflict_luomagu_ambush',
      judgement: expect.objectContaining({
        scoreBreakdown: expect.objectContaining({ total: 250 }),
      }),
    }));
    expect(result.newRuntimeState.currentDate).not.toBe(makeState().currentDate);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('附属资源补丁已隔离');
  });

  it('uses the main model once to repair an orphan combat marker when no auxiliary writer is configured', async () => {
    const timePatch: StatePatch = {
      type: 'timeAdvance',
      payload: { minutesAdvanced: 30, reason: 'The pursuit lasts half an hour.' },
      reason: 'Advance through the pursuit.',
    };
    const combatPatch: StatePatch = {
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertCombatRecord',
          combatId: 'combat_luomagu_beheading',
          kind: 'battlefieldDuel',
          title: '落马谷阵前斩将',
          summary: '刘平在追击中击败敌军将领。',
          occurredAt: '189-09-01 午时',
          participants: [
            { name: '刘平', side: 'player' },
            { name: '敌军将领', side: 'enemy' },
          ],
          playerInvolved: true,
          resultLevel: 'decisiveWin',
          outcome: '敌军将领被击败，追兵士气大振。',
          significance: 'major',
        },
      },
      reason: 'Record the battlefield duel.',
    };
    const llmClient = {
      generate: vi.fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '刘平纵马冲阵。\n[[判定:combat:combat_luomagu_beheading]]\n敌将落马，追兵齐声呐喊。',
            suggestedActions: [],
            statePatches: [timePatch],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: 'Repair output.',
            suggestedActions: [],
            statePatches: [timePatch, combatPatch],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        }),
    };

    const result = await executeTurn(worldBook, makeState(), 'Charge and defeat the enemy commander.', {
      apiConfig,
      llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.combatRecords).toContainEqual(expect.objectContaining({
      combatId: 'combat_luomagu_beheading',
    }));
    expect(result.turnDisplayMeta.judgementCards).toContainEqual(expect.objectContaining({
      cardId: 'combat:combat_luomagu_beheading',
    }));
  });

  it('repairs diagnosed source slots before appending a missing judgement record', async () => {
    const initialState = {
      ...makeState(),
      playerResources: { grain: Number.MAX_VALUE },
    };
    const overflowingResourcePatch: StatePatch = {
      type: 'resourceChanged',
      reason: 'adjust the grain after the pursuit',
      payload: { resource: 'grain', mode: 'delta', change: Number.MAX_VALUE },
    };
    const repairedResourcePatch: StatePatch = {
      ...overflowingResourcePatch,
      payload: { resource: 'grain', mode: 'delta', change: -Number.MAX_VALUE },
    };
    const combatPatch: StatePatch = {
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertCombatRecord',
          combatId: 'combat_luomagu_combined_repair',
          kind: 'battlefieldDuel',
          title: '落马谷追击战',
          summary: '刘平在追击中击破敌军后卫。',
          occurredAt: '189-09-01 午时',
          participants: [
            { name: '刘平', side: 'player' },
            { name: '敌军后卫', side: 'enemy' },
          ],
          playerInvolved: true,
          resultLevel: 'win',
          outcome: '敌军后卫溃退。',
          significance: 'moderate',
        },
      },
      reason: 'Record the pursuit judgement.',
    };
    const llmClient = {
      generate: vi.fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: '刘平率军追击。\n[[判定:combat:combat_luomagu_combined_repair]]\n敌军后卫溃退。',
            suggestedActions: [],
            statePatches: [timeAdvancePatch, overflowingResourcePatch],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            narrativeText: 'Repair output.',
            suggestedActions: [],
            statePatches: [timeAdvancePatch, repairedResourcePatch, combatPatch],
            statePatch: null,
          }),
          provider: 'openai_compatible' as const,
          model: 'test-model',
        }),
    };

    const result = await executeTurn(worldBook, initialState, 'Pursue the routed enemy.', {
      apiConfig,
      llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(result.patchValidation?.valid).toBe(true);
    expect(result.statePatches).toHaveLength(3);
    expect(result.newRuntimeState.playerResources.grain).toBe(0);
    expect(result.newRuntimeState.combatRecords).toContainEqual(expect.objectContaining({
      combatId: 'combat_luomagu_combined_repair',
    }));
  });
});
