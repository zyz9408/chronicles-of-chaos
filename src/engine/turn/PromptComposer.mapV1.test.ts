import { describe, expect, it } from 'vitest';
import type { RuntimeState, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { composePrompt } from './PromptComposer';

const canonicalLocationProtocolClauses = [
  'locationWriteSuggestions must include locationId, name, aliases, kind, mapLayer, parentId, summary, permanence; aliases are optional exact identity tokens.',
  'canonical key = parentId + mapLayer + kind/level + normalized name/aliases.',
  'Normalize name/aliases with NFKC, trim, collapse whitespace, and lowercase only; do not remove suffixes such as 县/郡/城.',
  'Exact locationId reuse is allowed only when parentId + mapLayer + kind/level scope matches.',
  'Worldbook seed identity is authoritative; incoming writeback must not change a seed parentId, mapLayer, or kind/level.',
  'If multiple canonical candidates match, do not guess or publish an alias mapping; return a structured diagnostic.',
] as const;

const worldBook: WorldBook = {
  manifest: {
    id: 'map-v1-prompt-world',
    name: 'Map V1 Prompt World',
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
      id: 'region_a',
      name: '区域A',
      level: 'region',
      mapLayer: 'region',
      summary: '',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
      subLocations: [
        {
          id: 'place_a',
          name: '甲城',
          level: 'place',
          mapLayer: 'place',
          summary: '当前具体地点。',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
          subLocations: [
            {
              id: 'scene_a_market',
              name: '市集',
              level: 'scene',
              mapLayer: 'scene',
              summary: '当前场景。',
              connectedRegionIds: [],
              controlHint: '',
              tensionHint: '',
            },
          ],
        },
      ],
    },
    {
      id: 'region_b',
      name: '区域B',
      level: 'region',
      mapLayer: 'region',
      summary: '',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
      subLocations: [{
        id: 'place_b',
        name: '乙渡',
        level: 'place',
        mapLayer: 'place',
        summary: '相邻具体地点。',
        connectedRegionIds: [],
        controlHint: '',
        tensionHint: '',
      }],
    },
  ],
  factionsSeed: [],
  timelineAnchors: [],
  startBookmarks: [],
  openingCrisisTemplates: [],
  prompts: {
    narrativeBaseline: 'Use the active worldbook only.',
    forbiddenTopics: [],
    outputFormat: 'Return JSON.',
    toneGuide: 'Ground the scene.',
  },
  validationRules: [],
};

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'map-v1-prompt-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: 'day 1',
    currentDate: 'day 1',
    player: {
      id: 'player',
      name: 'Player',
      roleType: 'traveler',
      summary: '',
    },
    currentLocationId: 'place_a',
    currentPlaceId: 'place_a',
    currentSceneId: 'scene_a_market',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    routeEdges: [
      {
        routeId: 'route_a_b',
        fromPlaceId: 'place_a',
        toPlaceId: 'place_b',
        name: '甲乙旧道',
        status: '可通行',
        source: 'worldbook',
        knownLevel: '亲历',
        standardTravelMinutes: 90,
      },
    ],
  });
}

describe('composePrompt Map V1 projection', () => {
  it('projects the current concrete place, scene, nearby routes, and route writeback protocol', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我去渡口');

    expect(prompt.narrativeContext).toContain('当前位置路径');
    expect(prompt.narrativeContext).toContain('区域A - 甲城 - 市集');
    expect(prompt.narrativeContext).toContain('附近路线');
    expect(prompt.narrativeContext).toContain('甲乙旧道');
    expect(prompt.stateWriterContext).toContain('currentPlaceId: place_a');
    expect(prompt.stateWriterContext).toContain('currentSceneId: scene_a_market');
    expect(prompt.stateWriterContext).toContain('currentLocationHierarchy:');
    expect(prompt.stateWriterContext).toContain('nodeId: region_a; mapLayer: region');
    expect(prompt.stateWriterContext).toContain('availableParentRegions:');
    expect(prompt.stateWriterContext).toContain('nodeId: region_b; path: 区域B');
    expect(prompt.stateWriterContext).toContain('localScenes:');
    expect(prompt.stateWriterContext).toContain('sceneId: scene_a_market');
    expect(prompt.stateWriterContext).toContain('knownNearbyRoutes:');
    expect(prompt.stateWriterContext).toContain('routeWriteSuggestions');
    expect(prompt.userPrompt).toContain('locationChange.toLocationId must be a concrete place ID');
    expect(prompt.stateWriterContext).toContain('地点移动必须使用顶层 statePatch.type=locationChange');
    expect(prompt.stateWriterContext).toContain('不得把 updateLocation/locationChange 写入 payload.command.action');
    expect(prompt.stateWriterContext).toContain('本回合新生成的永久剧情地点');
    expect(prompt.stateWriterContext).toContain('availableParentRegions 中真实存在的 nodeId');
    expect(prompt.stateWriterContext).toContain('locationWriteSuggestions 中完全相同的稳定 ID');
    expect(prompt.stateWriterContext).toContain('离开后再次进入');
    expect(prompt.stateWriterContext).toContain('不得为同一地点另造 ID');
    expect(prompt.userPrompt).toContain('toSceneId');
    expect(prompt.userPrompt).toContain('routeWriteSuggestions');
    expect(prompt.systemPrompt).not.toContain('三国');
    expect(prompt.userPrompt).not.toContain('三国');
  });

  it('generates the complete shared canonical location contract in main prompt and state writer context', () => {
    const { userPrompt, stateWriterContext } = composePrompt(
      worldBook,
      undefined,
      [],
      undefined,
      makeState(),
      '确认新野县衙的位置',
    );

    for (const clause of canonicalLocationProtocolClauses) {
      expect(userPrompt).toContain(clause);
      expect(stateWriterContext).toContain(clause);
    }
  });

  it('projects worldbook route seeds into prompt context with unknown travel time', () => {
    const worldBookWithRouteSeed: WorldBook = {
      ...worldBook,
      routeSeed: [
        {
          routeId: 'route_seed_a_b',
          fromPlaceId: 'place_a',
          toPlaceId: 'place_b',
          name: '甲乙渡口道',
          routeKind: '水路',
          status: '可通行',
          source: 'worldbook',
          knownLevel: '听闻',
        },
      ],
    };
    const prompt = composePrompt(
      worldBookWithRouteSeed,
      undefined,
      [],
      undefined,
      {
        ...makeState(),
        routeEdges: [],
      },
      '我去渡口',
    );

    expect(prompt.narrativeContext).toContain('附近路线');
    expect(prompt.narrativeContext).toContain('甲乙渡口道');
    expect(prompt.narrativeContext).toContain('水路');
    expect(prompt.stateWriterContext).toContain('travelTime: unknown');
    expect(prompt.userPrompt).toContain('routeKind');
  });

  it('projects scenes under a reachable destination so a known story scene can be re-entered directly', () => {
    const prompt = composePrompt(
      worldBook,
      undefined,
      [],
      undefined,
      {
        ...makeState(),
        mapNodes: [{
          id: 'scene_b_boathouse',
          name: '乙渡船屋',
          level: 'scene',
          mapLayer: 'scene',
          parentId: 'place_b',
          summary: '已经到访过的船屋。',
          connectedRegionIds: [],
          controlHint: '船户看守',
          tensionHint: '平静',
        }],
      },
      '我再次前往乙渡船屋',
    );

    expect(prompt.stateWriterContext).toContain('destinationScenes:');
    expect(prompt.stateWriterContext).toContain('sceneId: scene_b_boathouse; name: 乙渡船屋');
    expect(prompt.stateWriterContext).toContain('所选 knownNearbyRoutes 下 destinationScenes.sceneId');
  });

  it('does not hide older reusable story scenes from the state writer when a destination has more than eight scenes', () => {
    const prompt = composePrompt(
      worldBook,
      undefined,
      [],
      undefined,
      {
        ...makeState(),
        mapNodes: Array.from({ length: 10 }, (_, index) => ({
          id: `scene_b_story_${index + 1}`,
          name: `乙渡剧情场景${index + 1}`,
          level: 'scene',
          mapLayer: 'scene' as const,
          parentId: 'place_b',
          summary: `已经到访过的乙渡剧情场景${index + 1}。`,
          connectedRegionIds: [],
          controlHint: '剧情写回确认',
          tensionHint: '待后续更新',
        })),
      },
      '我再次前往乙渡剧情场景10',
    );

    expect(prompt.stateWriterContext).toContain('sceneId: scene_b_story_1; name: 乙渡剧情场景1');
    expect(prompt.stateWriterContext).toContain('sceneId: scene_b_story_10; name: 乙渡剧情场景10');
  });
});
