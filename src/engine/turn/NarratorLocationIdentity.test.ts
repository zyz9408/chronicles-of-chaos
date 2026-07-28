import { describe, expect, it } from 'vitest';
import type { RuntimeState, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import {
  applyNarratorWriteback,
  prepareNarratorLocationWriteback,
  remapNarratorStatePatchLocationReferences,
} from './NarratorWritebackApplier';
import { parseNarratorResponse } from './NarratorResponseParser';
import type { NarratorWritebackProtocol } from './MockNarrator';

const worldBook: WorldBook = {
  manifest: {
    id: 'narrator-location-test', name: 'test', version: '1', author: 'test', language: 'zh-CN',
    genre: 'test', source: 'official', compatibleEngineVersion: '0.1.0',
  },
  ontology: {
    regionLevels: [], factionTypes: [], actorRoleTypes: [], socialClasses: [], resourceTypes: [],
    conflictTypes: [], actionTypes: [], relationshipTypes: [],
  },
  lore: '',
  mapSeed: [{
    id: 'region_root', name: '根区', level: 'region', mapLayer: 'region', summary: '',
    connectedRegionIds: [], controlHint: '', tensionHint: '', subLocations: [
      {
        id: 'place_xinye', name: '新野县', aliases: ['新野'], level: 'county', mapLayer: 'place',
        summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
      },
      {
        id: 'place_ferry', name: '渡口', level: 'ferry', mapLayer: 'place',
        summary: '', connectedRegionIds: [], controlHint: '', tensionHint: '',
      },
    ],
  }],
  factionsSeed: [], timelineAnchors: [], startBookmarks: [], openingCrisisTemplates: [],
  prompts: { narrativeBaseline: '', forbiddenTopics: [], outputFormat: '', toneGuide: '' },
  validationRules: [],
};

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0', worldBookId: worldBook.manifest.id, worldBookVersion: '1',
    worldBookSource: 'official', startDate: 'day 1', currentDate: 'day 1',
    player: {
      id: 'player', name: 'Player', roleType: 'traveler', summary: '',
      playerMemory: { summary: '', keyDeeds: [], recentTurns: [] },
    },
    currentLocationId: 'place_xinye', currentPlaceId: 'place_xinye', knownActors: [],
    knownFactions: [], relationships: [], knownRumors: [], activeQuests: [], playerResources: {},
    worldStateDelta: {}, turnLog: [], localSituationNotes: [],
    worldTrends: [{
      trendId: 'trend_existing', title: '旧纪事', severity: '低', summary: 'old', knownToPlayer: true,
      scope: 'regional', affectedFactionIds: ['faction_xinye_guard'],
      locationId: 'place_xinye', updatedAt: 'day 1',
    }],
  });
}

function writeback(): NarratorWritebackProtocol {
  return {
    protagonistMemory: { keyDeed: { summary: '守住新野', locationId: 'incoming_xinye' } },
    npcProfileSuggestions: [{
      npcId: 'npc_1', name: '甲', sex: '男', age: 30, role: '守将', locationId: 'incoming_xinye',
      isPresent: true, isFocused: true, currentIdentity: '守将', summary: '守卫新野。', appearance: '披甲。',
      personality: '谨慎。', motivation: '守城。', relationToPlayer: '初识', contactLevel: 1, recentAttitude: '警惕',
      abilityScores: { 武力: 50, 统率: 50, 智力: 50, 政治: 50, 魅力: 50, 机运: 50 },
      traits: [{ id: 'trait_guard', label: '守城', description: '熟悉城防。', source: 'identity' }],
    }],
    npcMemorySuggestions: [],
    locationWriteSuggestions: [
      {
        locationId: 'incoming_xinye', name: '新野', aliases: ['新野县'], kind: 'county', mapLayer: 'place',
        parentId: 'region_root', summary: 'duplicate parent', permanence: 'permanent',
      },
      {
        locationId: 'incoming_yard', name: '后院', aliases: ['县衙后院'], kind: 'scene', mapLayer: 'scene',
        parentId: 'incoming_xinye', summary: 'child', permanence: 'permanent',
      },
    ],
    routeWriteSuggestions: [{
      routeId: 'route_new', fromPlaceId: 'incoming_xinye', toPlaceId: 'place_ferry', name: '新野渡口路',
      status: '可通行', knownLevel: '亲历',
    }],
    questChanges: [{
      action: 'add', questId: 'quest_1', title: '守城', summary: '守住城池',
      relatedLocationIds: ['incoming_xinye', 'incoming_yard'], affectedPlaceIds: ['incoming_xinye'],
    }],
    signalChanges: [{
      action: 'add', rumorId: 'rumor_1', content: '渡口有异动',
      relatedLocationIds: ['incoming_xinye'], affectedPlaceIds: ['incoming_yard'],
    }],
    worldEventUpdates: [{
      eventId: 'trend_existing', locationId: 'incoming_xinye', affectedPlaceIds: ['incoming_yard'],
    }],
    worldEventSummary: {
      eventId: 'trend_new', summary: '新野守住了', locationId: 'incoming_xinye',
      scope: 'regional', severity: 'high',
      affectedPlaceIds: ['incoming_xinye', 'incoming_yard'], involvedNpcIds: [],
    },
    debugNotes: [],
  };
}

describe('Narrator location identity remapping', () => {
  it('parses location aliases without changing their text', () => {
    const parsed = parseNarratorResponse(JSON.stringify({
      narrativeText: 'test', suggestedActions: [], statePatches: [],
      writeback: { ...writeback(), locationWriteSuggestions: [writeback().locationWriteSuggestions[0]] },
    }));

    expect(parsed.writeback?.locationWriteSuggestions[0].aliases).toEqual(['新野县']);
  });

  it('remaps parent, route, and every persisted Narrator writeback location reference', () => {
    const result = applyNarratorWriteback(makeState(), writeback(), worldBook);
    const child = result.state.mapNodes?.find((node) => node.id === 'incoming_yard');

    expect(result.state.mapNodes?.filter((node) => node.id === 'incoming_xinye')).toHaveLength(0);
    expect(child?.parentId).toBe('place_xinye');
    expect(result.state.routeEdges?.[0]).toMatchObject({ fromPlaceId: 'place_xinye', toPlaceId: 'place_ferry' });
    expect(result.state.player.playerMemory?.keyDeeds[0].locationId).toBe('place_xinye');
    expect(result.ignoredSummaries).toEqual([]);
    expect(result.state.npcs?.[0].locationId).toBe('place_xinye');
    expect(result.state.activeQuests[0]).toMatchObject({
      relatedLocationIds: ['place_xinye', 'incoming_yard'], affectedPlaceIds: ['place_xinye'],
    });
    expect(result.state.knownRumors[0]).toMatchObject({
      relatedLocationIds: ['place_xinye'], affectedPlaceIds: ['incoming_yard'],
    });
    expect(result.state.worldTrends?.find((trend) => trend.trendId === 'trend_existing')).toMatchObject({
      locationId: 'place_xinye', affectedPlaceIds: ['incoming_yard'],
    });
    expect(result.state.worldTrends?.find((trend) => trend.trendId === 'trend_new')).toMatchObject({
      locationId: 'place_xinye', affectedPlaceIds: ['place_xinye', 'incoming_yard'],
    });
  });

  it('applies a prepared location and route batch exactly once during formal writeback', () => {
    const original = writeback();
    const prepared = prepareNarratorLocationWriteback(makeState(), original, worldBook);
    const tampered = {
      ...prepared.writeback!,
      locationWriteSuggestions: prepared.writeback!.locationWriteSuggestions.map((suggestion) => (
        suggestion.locationId === 'incoming_yard' ? { ...suggestion, summary: 'second pass' } : suggestion
      )),
      routeWriteSuggestions: prepared.writeback!.routeWriteSuggestions.map((route) => ({
        ...route,
        status: 'second pass',
      })),
    };

    expect(prepared.state.routeEdges?.[0].status).toBe('可通行');
    const result = applyNarratorWriteback(
      prepared.state,
      tampered,
      worldBook,
      { preparedLocationWriteback: prepared } as never,
    );

    expect(result.state.mapNodes?.find((node) => node.id === 'incoming_yard')?.summary).toBe('child');
    expect(result.state.routeEdges?.[0].status).toBe('可通行');
    expect(result.appliedSummaries.filter((summary) => summary.startsWith('地图地点'))).toHaveLength(1);
    expect(result.appliedSummaries.filter((summary) => summary.startsWith('路线'))).toHaveLength(1);
  });

  it('does not invent questUpdated.targetLocationId remapping that the applier does not consume', () => {
    const prepared = prepareNarratorLocationWriteback(makeState(), writeback(), worldBook);
    const [patch] = remapNarratorStatePatchLocationReferences([{
      type: 'questUpdated',
      payload: {
        questId: 'quest_1',
        targetLocationId: 'incoming_xinye',
        relatedLocationIds: ['incoming_xinye'],
        affectedPlaceIds: ['incoming_xinye'],
      },
      reason: 'update',
    }], prepared.aliasMap);

    expect(patch.payload.targetLocationId).toBe('incoming_xinye');
    expect(patch.payload.relatedLocationIds).toEqual(['place_xinye']);
    expect(patch.payload.affectedPlaceIds).toEqual(['place_xinye']);
  });

  it('normalizes nested luanshi commands before remapping every typed location reference', () => {
    const aliasMap = new Map([['incoming_xinye', 'place_xinye']]);
    const patches = remapNarratorStatePatchLocationReferences([{
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'updateNpcPresence',
          npcId: 'npc_1',
          locationId: 'incoming_xinye',
          isPresent: true,
        },
      },
      reason: '甲在新野当面出现',
    }, {
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertTroopLedger',
          troopId: 'troop_1',
          name: '新野守军',
          size: 100,
          locationId: 'incoming_xinye',
          lastKnownLocationId: 'incoming_xinye',
          destinationLocationId: 'incoming_xinye',
        },
      },
      reason: '更新部队位置',
    }], aliasMap);

    expect(patches[0]).toMatchObject({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'updateNpcPresence',
          locationId: 'place_xinye',
        },
      },
    });
    expect(patches[1]).toMatchObject({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertTroopLedger',
          locationId: 'place_xinye',
          lastKnownLocationId: 'place_xinye',
          destinationLocationId: 'place_xinye',
        },
      },
    });
  });

  it('carries machine-readable ambiguity diagnostics through preparation and formal writeback', () => {
    const state = makeState();
    state.mapNodes = [{
      id: 'place_xinye_duplicate', name: '新野别称', aliases: ['新野县'], level: 'county',
      mapLayer: 'place', parentId: 'region_root', summary: '', connectedRegionIds: [],
      controlHint: '', tensionHint: '',
    }];

    const prepared = prepareNarratorLocationWriteback(state, writeback(), worldBook);
    const application = applyNarratorWriteback(
      prepared.state,
      prepared.writeback,
      worldBook,
      { preparedLocationWriteback: prepared },
    );

    expect(prepared.errors.join('\n')).toMatch(/歧义|ambiguous/i);
    expect(prepared.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'location-canonical-ambiguous',
      incomingLocationId: 'incoming_xinye',
      candidateIds: ['place_xinye', 'place_xinye_duplicate'],
      suggestionIndex: 0,
    })]));
    expect(application.ignoredSummaries.join('\n')).toMatch(/歧义|ambiguous/i);
    expect(application.diagnostics).toEqual(prepared.diagnostics);
  });
});
