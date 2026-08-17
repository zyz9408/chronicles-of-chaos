import { describe, expect, it, vi } from 'vitest';
import type { LlmGenerateRequest } from '../llm/LlmClient';
import type { RuntimeState, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import { executeTurn } from './TurnOrchestrator';

const worldBook: WorldBook = {
  manifest: {
    id: 'turn-location-test', name: 'test', version: '1', author: 'test', language: 'zh-CN',
    genre: 'test', source: 'official', compatibleEngineVersion: '0.1.0',
  },
  ontology: {
    regionLevels: [], factionTypes: [], actorRoleTypes: [], socialClasses: [], resourceTypes: [],
    conflictTypes: [], actionTypes: [], relationshipTypes: [],
  },
  lore: '',
  mapSeed: [{
    id: 'region_root', name: '根区', level: 'region', mapLayer: 'region', summary: '',
    connectedRegionIds: [], controlHint: '', tensionHint: '', subLocations: [{
      id: 'place_old', name: '新野县', aliases: ['新野'], level: 'county', mapLayer: 'place', summary: '',
      connectedRegionIds: [], controlHint: '', tensionHint: '',
    }, {
      id: 'place_new', name: '真定县', aliases: ['真定'], level: 'county', mapLayer: 'place', summary: '',
      connectedRegionIds: [], controlHint: '', tensionHint: '',
    }],
  }],
  factionsSeed: [], timelineAnchors: [], startBookmarks: [], openingCrisisTemplates: [],
  prompts: { narrativeBaseline: '', forbiddenTopics: [], outputFormat: '', toneGuide: '' },
  validationRules: [],
};

const apiConfig: ApiConfigArchive = {
  id: 'api', name: 'api', provider: 'openai_compatible', baseUrl: 'https://example.com/v1',
  apiKey: 'test', model: 'test', createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0', worldBookId: worldBook.manifest.id, worldBookVersion: '1',
    worldBookSource: 'official', startDate: 'day 1', currentDate: 'day 1',
    player: { id: 'player', name: 'Player', roleType: 'traveler', summary: '' },
    currentLocationId: 'place_old', currentPlaceId: 'place_old', knownActors: [], knownFactions: [],
    relationships: [], knownRumors: [], activeQuests: [], playerResources: {}, worldStateDelta: {},
    turnLog: [], localSituationNotes: [],
  });
}

function makeStateWithNpc(): RuntimeState {
  const state = makeState();
  state.npcs = [{
    npcId: 'npc_1', name: '蔡氏', sex: '女', age: 32, role: '同行者', locationId: 'place_old',
    isPresent: true, isFocused: true, summary: '与主角同行。', appearance: '衣着端整。',
    personality: '谨慎。', motivation: '照料同行事务。', relationToPlayer: '亲近', contactLevel: 20,
    recentAttitude: '信任', memories: [],
  }];
  return state;
}

function makeAmbiguousWorldBook(): WorldBook {
  return {
    ...worldBook,
    mapSeed: [{
      ...worldBook.mapSeed[0],
      subLocations: [
        ...(worldBook.mapSeed[0].subLocations ?? []),
        {
          id: 'place_duplicate', name: '新野别称', aliases: ['新野县'], level: 'county',
          mapLayer: 'place', summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
        },
      ],
    }],
  };
}

describe('TurnOrchestrator location identity boundary', () => {
  it('materializes the final structured scene roster after a location transition', async () => {
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '你与蔡氏一同抵达真定县舍。',
        suggestedActions: [],
        statePatches: [
          { type: 'timeAdvance', payload: { minutesAdvanced: 30 }, reason: '同行赶路' },
          { type: 'locationChange', payload: { toLocationId: 'place_new' }, reason: '抵达真定' },
        ],
        writeback: {
          turnSummary: {
            brief: '你与蔡氏同行抵达真定。',
            scenePresence: {
              locationId: 'place_old',
              presentNpcIds: [' npc_1 ', 'npc_1'],
            },
          },
          npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [],
          questChanges: [], debugNotes: [],
        },
      }),
      provider: 'openai_compatible' as const,
      model: 'test',
    })) };

    const result = await executeTurn(worldBook, makeStateWithNpc(), '与蔡氏同行去真定', {
      apiConfig,
      llmClient,
    });

    expect(llmClient.generate).toHaveBeenCalledTimes(1);
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.statePatches).toContainEqual(expect.objectContaining({
      type: 'luanshiCommand',
      payload: { command: {
        action: 'updateNpcPresence', npcId: 'npc_1', locationId: 'place_new', isPresent: true,
      } },
    }));
    expect(result.newRuntimeState.npcs?.[0]).toMatchObject({
      npcId: 'npc_1', locationId: 'place_new', isPresent: true,
    });
  });

  it('borrows the existing State Writer to repair a missing final scene roster', async () => {
    const mainResponse = {
      narrativeText: '你与蔡氏一同抵达真定县舍。',
      suggestedActions: [],
      statePatches: [
        { type: 'timeAdvance', payload: { minutesAdvanced: 30 }, reason: '同行赶路' },
        { type: 'locationChange', payload: { toLocationId: 'place_new' }, reason: '抵达真定' },
      ],
      writeback: {
        turnSummary: { brief: '你与蔡氏同行抵达真定。' },
        npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [],
        questChanges: [], debugNotes: [],
      },
    };
    const repairedResponse = {
      ...mainResponse,
      writeback: {
        ...mainResponse.writeback,
        turnSummary: {
          ...mainResponse.writeback.turnSummary,
          scenePresence: { locationId: 'place_new', presentNpcIds: ['npc_1'] },
        },
      },
    };
    const llmClient = { generate: vi.fn()
      .mockResolvedValueOnce({
        content: JSON.stringify(mainResponse), provider: 'openai_compatible' as const, model: 'test',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify(repairedResponse), provider: 'openai_compatible' as const, model: 'test',
      }) };

    const result = await executeTurn(worldBook, makeStateWithNpc(), '与蔡氏同行去真定', {
      apiConfig,
      llmClient,
    });
    const calls = llmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    const repairPrompt = (calls[1]?.[0]?.messages ?? []).map((message) => message.content).join('\n');

    expect(llmClient.generate).toHaveBeenCalledTimes(2);
    expect(repairPrompt).toContain('## 本次当前场景在场名单复核焦点');
    expect(repairPrompt).toContain('writeback.turnSummary.scenePresence');
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.npcs?.[0]).toMatchObject({
      npcId: 'npc_1', locationId: 'place_new', isPresent: true,
    });
  });

  it('remaps same-batch canonical aliases inside nested NPC presence commands before validation', async () => {
    const state = makeState();
    state.npcs = [{
      npcId: 'npc_1', name: '甲', sex: '男', age: 30, role: '守将', locationId: 'place_old',
      isPresent: false, isFocused: true, summary: '守卫新野。', appearance: '披甲。',
      personality: '谨慎。', motivation: '守城。', relationToPlayer: '初识', contactLevel: 1,
      recentAttitude: '警惕', memories: [],
    }];
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '甲来到新野县衙前。', suggestedActions: [],
        statePatches: [{
          type: 'timeAdvance', payload: { minutesAdvanced: 5 }, reason: '会面耗时',
        }, {
          type: 'luanshiCommand',
          payload: { command: {
            action: 'updateNpcPresence',
            npcId: 'npc_1',
            locationId: 'incoming_xinye',
            isPresent: true,
          } },
          reason: '甲在新野当面出现',
        }],
        writeback: {
          npcMemorySuggestions: [],
          locationWriteSuggestions: [{
            locationId: 'incoming_xinye', name: '新野县', kind: 'county', mapLayer: 'place',
            parentId: 'region_root', summary: '复用既有地点。', permanence: 'permanent',
          }],
          routeWriteSuggestions: [], questChanges: [], debugNotes: [],
        },
      }),
      provider: 'openai_compatible' as const,
      model: 'test',
    })) };

    const result = await executeTurn(worldBook, state, '与甲会面', { apiConfig, llmClient });

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.statePatches?.[1]).toMatchObject({
      type: 'luanshiCommand',
      payload: { command: { action: 'updateNpcPresence', locationId: 'place_old' } },
    });
    expect(result.newRuntimeState.npcs?.[0]).toMatchObject({
      npcId: 'npc_1', locationId: 'place_old', isPresent: true,
    });
  });

  it('makes same-batch new locations visible and remaps reused IDs before statePatch transaction', async () => {
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '抵达新野后院。', suggestedActions: [],
        statePatches: [
          { type: 'timeAdvance', payload: { minutesAdvanced: 10 }, reason: '移动耗时' },
          { type: 'locationChange', payload: { toLocationId: 'incoming_xinye', toSceneId: 'incoming_yard' }, reason: '移动' },
          { type: 'actorDiscovered', payload: { actorId: 'actor_1', name: '门吏', locationId: 'incoming_yard' }, reason: '相遇' },
          {
            type: 'questAdded',
            payload: {
              questId: 'quest_patch', title: '探查后院', targetLocationId: 'incoming_yard',
              relatedLocationIds: ['incoming_xinye'], affectedPlaceIds: ['incoming_yard'],
            },
            reason: '接下任务',
          },
        ],
        writeback: {
          npcMemorySuggestions: [],
          locationWriteSuggestions: [
            {
              locationId: 'incoming_xinye', name: '新野县', kind: 'county', mapLayer: 'place',
              parentId: 'region_root', summary: 'new place', permanence: 'permanent',
            },
            {
              locationId: 'incoming_yard', name: '后院', kind: 'scene', mapLayer: 'scene',
              parentId: 'incoming_xinye', summary: 'new scene', permanence: 'permanent',
            },
          ],
          routeWriteSuggestions: [], questChanges: [], debugNotes: [],
        },
      }),
      provider: 'openai_compatible' as const,
      model: 'test',
    })) };

    const result = await executeTurn(worldBook, makeState(), '去后院', { apiConfig, llmClient });

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.statePatches?.[1].payload).toMatchObject({
      toLocationId: 'place_old', toSceneId: 'incoming_yard',
    });
    expect(result.newRuntimeState.currentPlaceId).toBe('place_old');
    expect(result.newRuntimeState.currentSceneId).toBe('incoming_yard');
    expect(result.newRuntimeState.knownActors[0].locationId).toBe('incoming_yard');
    expect(result.newRuntimeState.activeQuests[0]).toMatchObject({
      targetLocationId: 'incoming_yard', relatedLocationIds: ['place_old'], affectedPlaceIds: ['incoming_yard'],
    });
  });

  it('does not send a false missing-location validator error to the auxiliary State Writer for a same-turn new place', async () => {
    const response = {
      narrativeText: '你抵达新营地。',
      suggestedActions: [],
      statePatches: [
        { type: 'timeAdvance', payload: { minutesAdvanced: 30 }, reason: '赶路' },
        { type: 'locationChange', payload: { toLocationId: 'place_new_camp' }, reason: '抵达新营地' },
      ],
      writeback: {
        npcMemorySuggestions: [],
        locationWriteSuggestions: [{
          locationId: 'place_new_camp', name: '新营地', kind: 'camp', mapLayer: 'place',
          parentId: 'region_root', summary: '新发现的永久营地。', permanence: 'permanent',
        }],
        routeWriteSuggestions: [], questChanges: [], debugNotes: [],
      },
    };
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify(response), provider: 'openai_compatible' as const, model: 'test',
    })) };
    const stateWritebackLlmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify(response), provider: 'openai_compatible' as const, model: 'writer',
    })) };

    const result = await executeTurn(worldBook, makeState(), '前往新营地', {
      apiConfig,
      llmClient,
      stateWritebackApiConfig: { ...apiConfig, id: 'writer', model: 'writer' },
      stateWritebackLlmClient,
    });
    const repairCalls = stateWritebackLlmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    const repairPrompt = (repairCalls[0]?.[0]?.messages ?? [])
      .map((message) => message.content)
      .join('\n');

    expect(repairPrompt).toContain('## StatePatch validator 逐条诊断\n[]');
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.currentPlaceId).toBe('place_new_camp');
  });

  it('persists and enters a same-turn cross-region story place when the parent ID drifts but parentPath is canonical', async () => {
    const crossRegionWorldBook: WorldBook = {
      ...worldBook,
      mapSeed: [
        {
          ...worldBook.mapSeed[0],
          id: 'region_jingzhou',
          name: '荆州',
          subLocations: [{
            id: 'loc_jingzhou_nanjun', name: '南郡', level: 'commandery', mapLayer: 'region',
            summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
            subLocations: [{
              id: 'place_xiangyang', name: '襄阳城', level: 'city', mapLayer: 'place',
              summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
            }],
          }, {
            id: 'loc_jingzhou_nanyang', name: '南阳郡', level: 'commandery', mapLayer: 'region',
            summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
            subLocations: [{
              id: 'place_xinye', name: '新野县城', level: 'county', mapLayer: 'place',
              summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
            }],
          }],
        },
      ],
      routeSeed: [{
        routeId: 'route_xiangyang_xinye', fromPlaceId: 'place_xiangyang', toPlaceId: 'place_xinye',
        name: '襄阳—新野官道', status: '可通行', source: 'worldbook', knownLevel: '亲历',
      }],
    };
    const state: RuntimeState = {
      ...makeState(),
      worldBookId: crossRegionWorldBook.manifest.id,
      currentLocationId: 'place_xiangyang',
      currentPlaceId: 'place_xiangyang',
    };
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '骑兵抵达丹水河谷并在密林中埋伏。', suggestedActions: [],
        statePatches: [
          { type: 'timeAdvance', payload: { minutesAdvanced: 240 }, reason: '隐蔽行军' },
          { type: 'locationChange', payload: { toLocationId: 'place_nanyang_danshui_valley' }, reason: '抵达丹水河谷' },
        ],
        writeback: {
          npcMemorySuggestions: [],
          locationWriteSuggestions: [{
            locationId: 'place_nanyang_danshui_valley', name: '丹水河谷', kind: '河谷', mapLayer: 'place',
            parentId: 'region_nanyang', parentPath: '荆州 - 南阳郡',
            summary: '穰城以北、丹水沿岸的河谷。', permanence: 'permanent',
          }],
          routeWriteSuggestions: [{
            routeId: 'route_xiangyang_danshui', fromPlaceId: 'place_xiangyang',
            toPlaceId: 'place_nanyang_danshui_valley', name: '襄阳—丹水行军路',
            routeKind: '行军路', status: '可通行', knownLevel: '亲历',
          }],
          questChanges: [], debugNotes: [],
        },
      }),
      provider: 'openai_compatible' as const,
      model: 'test',
    })) };

    const result = await executeTurn(crossRegionWorldBook, state, '隐蔽行军前往张济大营埋伏好', {
      apiConfig,
      llmClient,
    });

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.locationWritebackErrors).toEqual([]);
    expect(result.routeWritebackErrors).toEqual([]);
    expect(result.newRuntimeState.currentPlaceId).toBe('place_nanyang_danshui_valley');
    expect(result.newRuntimeState.mapNodes).toContainEqual(expect.objectContaining({
      id: 'place_nanyang_danshui_valley',
      parentId: 'loc_jingzhou_nanyang',
    }));
    expect(result.newRuntimeState.routeEdges).toContainEqual(expect.objectContaining({
      routeId: 'route_xiangyang_danshui',
      toPlaceId: 'place_nanyang_danshui_valley',
    }));
  });

  it('exposes same-batch structured location ambiguity diagnostics to the turn caller', async () => {
    const ambiguousWorldBook = makeAmbiguousWorldBook();
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '确认地点时发现记录冲突。', suggestedActions: [],
        statePatches: [{ type: 'timeAdvance', payload: { minutesAdvanced: 5 }, reason: '查验地图' }],
        writeback: {
          npcMemorySuggestions: [],
          locationWriteSuggestions: [{
            locationId: 'incoming_xinye', name: '新野县', kind: 'county', mapLayer: 'place',
            parentId: 'region_root', summary: 'ambiguous', permanence: 'permanent',
          }],
          routeWriteSuggestions: [], questChanges: [], debugNotes: [],
        },
      }),
      provider: 'openai_compatible' as const,
      model: 'test',
    })) };

    const result = await executeTurn(ambiguousWorldBook, makeState(), '查验新野记录', { apiConfig, llmClient });

    expect(result.locationWritebackDiagnostics).toEqual([expect.objectContaining({
      code: 'location-canonical-ambiguous',
      message: expect.stringMatching(/地点 canonical 身份歧义/),
      incomingLocationId: 'incoming_xinye',
      candidateIds: ['place_duplicate', 'place_old'],
      suggestionIndex: 0,
    })]);
    expect(result.newRuntimeState.mapNodes?.some((node) => node.id === 'incoming_xinye')).toBe(false);
  });

  it('silently ignores unvisited temporary places while retaining unrelated route errors', async () => {
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '地图记录未能确认。', suggestedActions: [],
        statePatches: [{ type: 'timeAdvance', payload: { minutesAdvanced: 5 }, reason: '查验地图' }],
        writeback: {
          npcMemorySuggestions: [],
          locationWriteSuggestions: [{
            locationId: 'temporary_place', name: '临时营地', kind: 'camp', mapLayer: 'place',
            parentId: 'region_root', summary: 'temporary', permanence: 'temporary',
          }],
          routeWriteSuggestions: [{
            routeId: 'route_bad', fromPlaceId: 'region_root', toPlaceId: 'place_old',
            name: '错误区域路线', status: '未知', knownLevel: '推测',
          }],
          questChanges: [], debugNotes: [],
        },
      }),
      provider: 'openai_compatible' as const,
      model: 'test',
    })) };

    const result = await executeTurn(worldBook, makeState(), '查验地图', { apiConfig, llmClient });
    const latestTurn = result.newRuntimeState.turnLog[result.newRuntimeState.turnLog.length - 1];
    const summary = latestTurn?.statePatchSummary ?? '';

    expect(result.locationWritebackErrors).toEqual([]);
    expect(result.routeWritebackErrors).toEqual([
      expect.stringContaining('fromPlaceId 必须连接具体地点层'),
    ]);
    expect(result.turnDisplayMeta.locationWriteback).toMatchObject({
      errors: result.locationWritebackErrors,
      routeErrors: result.routeWritebackErrors,
    });
    expect(latestTurn?.displayMeta?.locationWriteback)
      .toEqual(result.turnDisplayMeta.locationWriteback);
    expect(summary).not.toContain('地点写回');
    expect(summary).toContain('路线写回');
  });

  it('persists a temporary place and scene after the same turn actually visits them', async () => {
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '你追着火光进入林间临时哨棚。', suggestedActions: [],
        statePatches: [
          { type: 'timeAdvance', payload: { minutesAdvanced: 20 }, reason: '穿林而行' },
          {
            type: 'locationChange',
            payload: { toLocationId: 'place_forest_watch', toSceneId: 'scene_forest_shed' },
            reason: '亲身抵达哨棚',
          },
        ],
        writeback: {
          npcMemorySuggestions: [],
          locationWriteSuggestions: [{
            locationId: 'place_forest_watch', name: '林间哨点', kind: 'outpost', mapLayer: 'place',
            parentId: 'region_root', summary: '林中临时搭起的哨点。', permanence: 'temporary',
          }, {
            locationId: 'scene_forest_shed', name: '哨棚', kind: 'scene', mapLayer: 'scene',
            parentId: 'place_forest_watch', summary: '已亲身进入的木棚。', permanence: 'temporary',
          }],
          routeWriteSuggestions: [{
            routeId: 'route_old_forest_watch', fromPlaceId: 'place_old', toPlaceId: 'place_forest_watch',
            name: '林间小径', status: '可通行', knownLevel: '亲历',
          }],
          questChanges: [], debugNotes: [],
        },
      }),
      provider: 'openai_compatible' as const,
      model: 'test',
    })) };

    const result = await executeTurn(worldBook, makeState(), '追踪火光进入哨棚', { apiConfig, llmClient });

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.currentPlaceId).toBe('place_forest_watch');
    expect(result.newRuntimeState.currentSceneId).toBe('scene_forest_shed');
    expect(result.newRuntimeState.mapNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'place_forest_watch',
        runtimePersistence: 'visited-temporary',
        availability: 'active',
      }),
      expect.objectContaining({
        id: 'scene_forest_shed',
        runtimePersistence: 'visited-temporary',
        availability: 'active',
      }),
    ]));
    expect(result.newRuntimeState.routeEdges).toContainEqual(expect.objectContaining({
      routeId: 'route_old_forest_watch',
      toPlaceId: 'place_forest_watch',
    }));
    expect(result.locationWritebackErrors).toEqual([]);
    expect(result.routeWritebackErrors).toEqual([]);
  });

  it('keeps valid movement and map writes when an unrelated hard-failure patch is rejected', async () => {
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '你抵达河畔屯点，但物资记录有冲突。', suggestedActions: [],
        statePatches: [
          { type: 'timeAdvance', payload: { minutesAdvanced: 30 }, reason: '赶路' },
          { type: 'locationChange', payload: { toLocationId: 'place_river_post' }, reason: '抵达屯点' },
          { type: 'unsupportedLegacyEvent', payload: { value: 1 }, reason: '不受支持的旧事件' },
        ],
        writeback: {
          npcMemorySuggestions: [],
          locationWriteSuggestions: [{
            locationId: 'place_river_post', name: '河畔屯点', kind: 'outpost', mapLayer: 'place',
            parentId: 'region_root', summary: '已亲身抵达的河畔屯点。', permanence: 'permanent',
          }],
          routeWriteSuggestions: [{
            routeId: 'route_old_river_post', fromPlaceId: 'place_old', toPlaceId: 'place_river_post',
            name: '河畔道路', status: '可通行', knownLevel: '亲历',
          }],
          questChanges: [], debugNotes: [],
        },
      }),
      provider: 'openai_compatible' as const,
      model: 'test',
    })) };

    const result = await executeTurn(worldBook, makeState(), '前往河畔屯点', { apiConfig, llmClient });

    expect(result.patchValidation).toMatchObject({ valid: false });
    expect(result.newRuntimeState.currentPlaceId).toBe('place_river_post');
    expect(result.newRuntimeState.mapNodes).toContainEqual(expect.objectContaining({ id: 'place_river_post' }));
    expect(result.newRuntimeState.routeEdges).toContainEqual(expect.objectContaining({ routeId: 'route_old_river_post' }));
    expect(result.locationWritebackErrors).toEqual([]);
    expect(result.routeWritebackErrors).toEqual([]);
    expect(result.stateWritebackWarnings.join('\n')).toContain('unsupportedLegacyEvent');
  });

  it('lets the State Writer replace rejected fields on the same stable location id', async () => {
    const originalResponse = {
      narrativeText: '你抵达河畔哨所。',
      suggestedActions: [],
      statePatches: [
        { type: 'timeAdvance', payload: { minutesAdvanced: 15 }, reason: '赶路' },
        { type: 'locationChange', payload: { toLocationId: 'place_repair_target' }, reason: '抵达河畔哨所' },
      ],
      writeback: {
        npcMemorySuggestions: [],
        locationWriteSuggestions: [{
          locationId: 'place_repair_target', name: '河畔哨所', kind: 'scene', mapLayer: 'scene',
          parentId: 'missing_parent', summary: '首份响应的错误地点结构。', permanence: 'permanent',
        }],
        routeWriteSuggestions: [], questChanges: [], debugNotes: [],
      },
    };
    const repairedResponse = {
      ...originalResponse,
      writeback: {
        ...originalResponse.writeback,
        locationWriteSuggestions: [{
          locationId: 'place_repair_target', name: '河畔哨所', kind: 'outpost', mapLayer: 'place',
          parentId: 'region_root', summary: '修复后的可站立地点。', permanence: 'permanent',
        }],
      },
    };
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify(originalResponse),
      provider: 'openai_compatible' as const,
      model: 'main',
    })) };
    const stateWritebackLlmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify(repairedResponse),
      provider: 'openai_compatible' as const,
      model: 'writer',
    })) };

    const result = await executeTurn(worldBook, makeState(), '前往河畔哨所', {
      apiConfig,
      llmClient,
      stateWritebackApiConfig: { ...apiConfig, id: 'writer', model: 'writer' },
      stateWritebackLlmClient,
    });
    const writerCalls = stateWritebackLlmClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    const repairPrompt = (writerCalls[0]?.[0]?.messages ?? []).map((message) => message.content).join('\n');

    expect(writerCalls).toHaveLength(1);
    expect(repairPrompt).toContain('place_repair_target');
    expect(repairPrompt).toContain('地图写回逐条诊断');
    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.currentPlaceId).toBe('place_repair_target');
    expect(result.newRuntimeState.mapNodes).toContainEqual(expect.objectContaining({
      id: 'place_repair_target',
      mapLayer: 'place',
      parentId: 'region_root',
    }));
    expect(result.locationWritebackErrors).toEqual([]);
  });

  it('does not roll back a same-turn location change when a private asset omits its technical timestamp', async () => {
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '你离开市集，抵达城外果园别院。', suggestedActions: [],
        statePatches: [
          { type: 'timeAdvance', payload: { minutesAdvanced: 45 }, reason: '出城赴约' },
          {
            type: 'locationChange',
            payload: { toLocationId: 'place_orchard_estate', toSceneId: 'scene_orchard_bedroom' },
            reason: '抵达果园别院',
          },
          {
            type: 'luanshiCommand',
            payload: { command: {
              action: 'upsertPrivateAsset',
              operation: 'create',
              privateAssetId: 'asset_orchard_estate',
              name: '果园别院',
              type: 'estate',
              ownerScope: 'personal',
              status: 'active',
              summary: '城外果林环绕的私人别院。',
              locationId: 'place_orchard_estate',
              acquisition: {
                kind: 'grant',
                occurredAt: '公元189年09月01日',
                sourceRefId: 'turn:orchard-estate-confirmed',
                summary: '本回合确认玩家获得果园别院。',
              },
              updatedAt: '',
            } },
            reason: '确认私人别院',
          },
        ],
        writeback: {
          npcMemorySuggestions: [],
          locationWriteSuggestions: [
            {
              locationId: 'place_orchard_estate', name: '果园别院', kind: 'estate', mapLayer: 'place',
              parentId: 'region_root', summary: '城外果林中的私人别院。', permanence: 'permanent',
            },
            {
              locationId: 'scene_orchard_bedroom', name: '主卧', kind: 'scene', mapLayer: 'scene',
              parentId: 'place_orchard_estate', summary: '别院内室。', permanence: 'permanent',
            },
          ],
          routeWriteSuggestions: [], questChanges: [], debugNotes: [],
        },
      }),
      provider: 'openai_compatible' as const,
      model: 'test',
    })) };

    const result = await executeTurn(worldBook, makeState(), '前往果园别院', { apiConfig, llmClient });
    const latestTurn = result.newRuntimeState.turnLog[result.newRuntimeState.turnLog.length - 1];

    expect(result.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(result.newRuntimeState.currentPlaceId).toBe('place_orchard_estate');
    expect(result.newRuntimeState.currentSceneId).toBe('scene_orchard_bedroom');
    expect(result.newRuntimeState.privateAssets).toContainEqual(expect.objectContaining({
      privateAssetId: 'asset_orchard_estate',
      locationId: 'place_orchard_estate',
      updatedAt: result.newRuntimeState.currentDate,
    }));
    expect(result.locationWritebackErrors).toEqual([]);
    expect(latestTurn?.statePatchSummary).not.toMatch(/地图写回(?:回滚|警告)/);
    expect(result.newRuntimeState.routeEdges).toContainEqual(expect.objectContaining({
      fromPlaceId: 'place_old',
      toPlaceId: 'place_orchard_estate',
      source: 'system',
      knownLevel: '亲历',
    }));
  });

  it('persists a generated story scene and re-enters it later with the same stable ids', async () => {
    const emptyWriteback = {
      npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [],
      questChanges: [], debugNotes: [],
    };
    const firstClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '你首次抵达果园别院主卧。', suggestedActions: [],
        statePatches: [
          { type: 'timeAdvance', payload: { minutesAdvanced: 30 }, reason: '首次前往别院' },
          {
            type: 'locationChange',
            payload: { toLocationId: 'place_orchard_estate', toSceneId: 'scene_orchard_bedroom' },
            reason: '抵达别院主卧',
          },
        ],
        writeback: {
          ...emptyWriteback,
          locationWriteSuggestions: [
            {
              locationId: 'place_orchard_estate', name: '果园别院', kind: 'estate', mapLayer: 'place',
              parentId: 'region_root', summary: '城外果林中的私人别院。', permanence: 'permanent',
            },
            {
              locationId: 'scene_orchard_bedroom', name: '主卧', kind: 'scene', mapLayer: 'scene',
              parentId: 'place_orchard_estate', summary: '别院内室。', permanence: 'permanent',
            },
          ],
        },
      }),
      provider: 'openai_compatible' as const,
      model: 'test',
    })) };
    const first = await executeTurn(worldBook, makeState(), '首次前往果园别院', {
      apiConfig,
      llmClient: firstClient,
    });

    const leaveClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '你离开别院返回新野县。', suggestedActions: [],
        statePatches: [
          { type: 'timeAdvance', payload: { minutesAdvanced: 30 }, reason: '返回县城' },
          { type: 'locationChange', payload: { toLocationId: 'place_old' }, reason: '返回县城' },
        ],
        writeback: emptyWriteback,
      }),
      provider: 'openai_compatible' as const,
      model: 'test',
    })) };
    const left = await executeTurn(worldBook, first.newRuntimeState, '返回新野县', {
      apiConfig,
      llmClient: leaveClient,
    });

    const reenterClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '你沿旧路再次进入果园别院主卧。', suggestedActions: [],
        statePatches: [
          { type: 'timeAdvance', payload: { minutesAdvanced: 30 }, reason: '再次前往别院' },
          {
            type: 'locationChange',
            payload: { toLocationId: 'place_orchard_estate', toSceneId: 'scene_orchard_bedroom' },
            reason: '再次进入别院主卧',
          },
        ],
        writeback: emptyWriteback,
      }),
      provider: 'openai_compatible' as const,
      model: 'test',
    })) };
    const reentered = await executeTurn(worldBook, left.newRuntimeState, '再次前往果园别院主卧', {
      apiConfig,
      llmClient: reenterClient,
    });
    const reentryCalls = reenterClient.generate.mock.calls as unknown as Array<[LlmGenerateRequest]>;
    const reentryPrompt = (reentryCalls[0]?.[0]?.messages ?? [])
      .map((message) => message.content)
      .join('\n');

    expect(first.patchValidation?.valid).toBe(true);
    expect(left.newRuntimeState.currentPlaceId).toBe('place_old');
    expect(reentryPrompt).toContain('toPlaceId: place_orchard_estate');
    expect(reentryPrompt).toContain('sceneId: scene_orchard_bedroom; name: 主卧');
    expect(reentered.patchValidation).toMatchObject({ valid: true, errors: [] });
    expect(reentered.newRuntimeState.currentPlaceId).toBe('place_orchard_estate');
    expect(reentered.newRuntimeState.currentSceneId).toBe('scene_orchard_bedroom');
    expect(reentered.newRuntimeState.mapNodes?.filter((node) => node.id === 'place_orchard_estate')).toHaveLength(1);
    expect(reentered.newRuntimeState.mapNodes?.filter((node) => node.id === 'scene_orchard_bedroom')).toHaveLength(1);
    expect(reentered.newRuntimeState.routeEdges?.filter((route) => (
      [route.fromPlaceId, route.toPlaceId].includes('place_old')
      && [route.fromPlaceId, route.toPlaceId].includes('place_orchard_estate')
    ))).toHaveLength(1);
    expect(reentered.locationWritebackErrors).toEqual([]);
  });

  it('rolls back only the new location dependency group when its movement patch fails', async () => {
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '地图草案已经生成，但移动状态无效。', suggestedActions: [],
        statePatches: [
          { type: 'timeAdvance', payload: { minutesAdvanced: 5 }, reason: '移动耗时' },
          {
            type: 'locationChange',
            payload: { toLocationId: 'incoming_outpost', toSceneId: 'missing_scene' },
            reason: '无效移动',
          },
        ],
        writeback: {
          npcMemorySuggestions: [],
          locationWriteSuggestions: [{
            locationId: 'incoming_outpost', name: '新营地', kind: 'county', mapLayer: 'place',
            parentId: 'region_root', summary: 'prepared location', permanence: 'permanent',
          }],
          routeWriteSuggestions: [{
            routeId: 'route_prepared', fromPlaceId: 'place_old', toPlaceId: 'incoming_outpost',
            name: '营地小路', status: '可通行', knownLevel: '亲历',
          }],
          questChanges: [], debugNotes: [],
        },
      }),
      provider: 'openai_compatible' as const,
      model: 'test',
    })) };

    const result = await executeTurn(worldBook, makeState(), '前往新营地', { apiConfig, llmClient });
    const latestTurn = result.newRuntimeState.turnLog[result.newRuntimeState.turnLog.length - 1];

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.newRuntimeState.mapNodes?.some((node) => node.id === 'incoming_outpost')).toBe(false);
    expect(result.newRuntimeState.routeEdges?.some((route) => route.routeId === 'route_prepared')).toBe(false);
    expect(result.locationWritebackErrors).toEqual([
      expect.stringMatching(/移动补丁.*未通过.*回滚/),
    ]);
    expect(result.locationWritebackDiagnostics).toEqual([expect.objectContaining({
      code: 'location-writeback-rolled-back',
      message: expect.stringMatching(/移动补丁.*未通过.*回滚/),
      incomingLocationId: 'incoming_outpost',
      candidateIds: [],
    })]);
    expect(result.turnDisplayMeta.locationWriteback).toEqual({
      errors: result.locationWritebackErrors,
      routeErrors: result.routeWritebackErrors,
      diagnostics: result.locationWritebackDiagnostics,
    });
    expect(latestTurn?.displayMeta?.locationWriteback).toEqual(result.turnDisplayMeta.locationWriteback);
    expect(latestTurn?.statePatchSummary).toContain('地图写回回滚');
    expect(latestTurn?.statePatchSummary).not.toContain('incoming_outpost');
    expect(latestTurn?.statePatchSummary).not.toContain('route_prepared');
  });

  it('retains ambiguity diagnostics and a safe turn warning when StatePatch validation fails', async () => {
    const ambiguousWorldBook = makeAmbiguousWorldBook();
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '地点记录冲突，移动未被确认。', suggestedActions: [],
        statePatches: [
          { type: 'timeAdvance', payload: { minutesAdvanced: 5 }, reason: '查验地图' },
          { type: 'locationChange', payload: { toLocationId: 'incoming_xinye' }, reason: '尝试移动' },
        ],
        writeback: {
          npcMemorySuggestions: [],
          locationWriteSuggestions: [{
            locationId: 'incoming_xinye', name: '新野县', kind: 'county', mapLayer: 'place',
            parentId: 'region_root', summary: 'ambiguous', permanence: 'permanent',
          }],
          routeWriteSuggestions: [], questChanges: [], debugNotes: [],
        },
      }),
      provider: 'openai_compatible' as const,
      model: 'test',
    })) };

    const result = await executeTurn(ambiguousWorldBook, makeState(), '前往新野', { apiConfig, llmClient });
    const latestTurn = result.newRuntimeState.turnLog[result.newRuntimeState.turnLog.length - 1];
    const summary = latestTurn?.statePatchSummary ?? '';

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.locationWritebackErrors.join('\n')).toMatch(/歧义|ambiguous/i);
    expect(result.locationWritebackDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'location-canonical-ambiguous',
        message: expect.stringMatching(/incoming_xinye.*place_duplicate.*place_old/),
      }),
      expect.objectContaining({
        code: 'location-writeback-rolled-back',
        incomingLocationId: 'incoming_xinye',
      }),
    ]));
    expect(result.turnDisplayMeta.locationWriteback?.diagnostics)
      .toEqual(result.locationWritebackDiagnostics);
    expect(latestTurn?.displayMeta?.locationWriteback?.diagnostics)
      .toEqual(result.locationWritebackDiagnostics);
    expect(summary).toContain('地图写回回滚');
    expect(summary).not.toContain('place_duplicate');
    expect(summary).not.toContain('place_old');
  });
});
