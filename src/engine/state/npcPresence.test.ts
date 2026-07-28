import { describe, expect, it } from 'vitest';
import type { LuanShiNpc, RuntimeState } from '../types';
import { isNpcPhysicallyPresent } from './npcPresence';

const npc = {
  npcId: 'npc_test',
  name: 'Test NPC',
  locationId: 'place_current',
  isPresent: true,
} as LuanShiNpc;

function makeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    currentLocationId: 'place_current',
    ...overrides,
  } as RuntimeState;
}

describe('isNpcPhysicallyPresent', () => {
  it('requires the writer-controlled present flag', () => {
    expect(isNpcPhysicallyPresent(makeState(), { ...npc, isPresent: false })).toBe(false);
  });

  it('rejects a stale present flag when the known location is elsewhere', () => {
    expect(isNpcPhysicallyPresent(makeState(), { ...npc, locationId: 'place_remote' })).toBe(false);
  });

  it('uses currentLocationId as the canonical place and ignores a stale legacy currentPlaceId', () => {
    expect(isNpcPhysicallyPresent(
      makeState({ currentLocationId: 'place_new', currentPlaceId: 'place_current' }),
      npc,
    )).toBe(false);
    expect(isNpcPhysicallyPresent(
      makeState({ currentLocationId: 'place_new', currentPlaceId: 'place_current' }),
      { ...npc, locationId: 'place_new' },
    )).toBe(true);
  });

  it('accepts the explicit current scene and its parent place', () => {
    expect(isNpcPhysicallyPresent(
      makeState({ currentLocationId: 'place_current', currentPlaceId: 'place_current', currentSceneId: 'scene_gate' }),
      { ...npc, locationId: 'scene_gate' },
    )).toBe(true);
    expect(isNpcPhysicallyPresent(
      makeState({ currentLocationId: 'scene_gate', currentPlaceId: 'place_current', currentSceneId: 'scene_gate' }),
      npc,
    )).toBe(true);
  });

  it('preserves legacy present semantics when the NPC has no location', () => {
    expect(isNpcPhysicallyPresent(makeState(), { ...npc, locationId: undefined })).toBe(true);
  });

  it('rebuilds the current scene roster from the latest structured location transition', () => {
    const rawResponse = JSON.stringify({
      narrativeText: '主角离开军营，抵达别院。',
      suggestedActions: [],
      statePatches: [
        {
          type: 'locationChange',
          reason: '抵达十里亭别院',
          payload: { toLocationId: 'place_shiliting' },
        },
        {
          type: 'luanshiCommand',
          reason: '张虎随行并在外围警戒',
          payload: {
            command: {
              action: 'updateNpcPresence',
              npcId: 'npc_zhanghu',
              locationId: 'place_shiliting',
              isPresent: true,
            },
          },
        },
        {
          type: 'luanshiCommand',
          reason: '甘宁留在汉水大营马厩',
          payload: {
            command: {
              action: 'updateNpcPresence',
              npcId: 'npc_ganning',
              locationId: 'place_hanshui_camp',
              isPresent: false,
            },
          },
        },
      ],
      writeback: {
        npcProfileSuggestions: [
          {
            npcId: 'npc_ganning',
            name: '甘宁',
            locationId: 'place_shiliting',
            isPresent: true,
          },
        ],
      },
    });
    const state = makeState({
      currentLocationId: 'place_shiliting',
      currentPlaceId: 'place_shiliting',
      turnLog: [{
        turnNumber: 224,
        date: '公元194年05月01日 18:30',
        playerInput: '离营前往十里亭别院',
        narrativeText: '张虎随行，甘宁留营。',
        statePatchSummary: 'locationChange: 抵达十里亭别院',
        timestamp: '2026-07-17T04:30:00.000Z',
        displayMeta: { rawResponse },
      }],
    });

    expect(isNpcPhysicallyPresent(state, {
      ...npc,
      npcId: 'npc_zhanghu',
      name: '张虎',
      locationId: 'place_shiliting',
      isPresent: true,
    })).toBe(true);
    expect(isNpcPhysicallyPresent(state, {
      ...npc,
      npcId: 'npc_ganning',
      name: '甘宁',
      locationId: 'place_shiliting',
      isPresent: true,
    })).toBe(false);
    expect(isNpcPhysicallyPresent(state, {
      ...npc,
      npcId: 'npc_weiyan',
      name: '魏延',
      locationId: 'place_shiliting',
      isPresent: true,
    })).toBe(false);
  });

  it('does not treat a dialogue speaker tag as physical presence after a structured transition', () => {
    const transitionRawResponse = JSON.stringify({
      narrativeText: '主角抵达水寨内宅。',
      suggestedActions: [],
      statePatches: [{
        type: 'locationChange',
        reason: '抵达水寨内宅',
        payload: { toLocationId: 'place_inner_residence' },
      }],
    });
    const state = makeState({
      currentLocationId: 'place_inner_residence',
      currentPlaceId: 'place_inner_residence',
      turnLog: [
        {
          turnNumber: 249,
          date: '公元194年05月03日 13:30（未时）',
          playerInput: '前往水寨内宅',
          narrativeText: '主角抵达水寨内宅。',
          statePatchSummary: 'locationChange: 抵达水寨内宅',
          timestamp: '2026-07-18T08:00:00.000Z',
          displayMeta: { rawResponse: transitionRawResponse },
        },
        {
          turnNumber: 251,
          date: '公元194年05月03日 15:00（申时）',
          playerInput: '与邹氏交谈',
          narrativeText: '邹氏在内宅应答。',
          fullNarrativeText: '【邹氏】\n“夫君回来了。”',
          statePatchSummary: '无状态变更',
          timestamp: '2026-07-18T08:30:00.000Z',
        },
      ],
    });

    expect(isNpcPhysicallyPresent(state, {
      ...npc,
      npcId: 'npc_zoushi',
      name: '邹氏',
      locationId: 'place_inner_residence',
      isPresent: false,
    })).toBe(false);
    expect(isNpcPhysicallyPresent(state, {
      ...npc,
      npcId: 'npc_remote',
      name: '甘宁',
      locationId: 'place_inner_residence',
      isPresent: true,
    })).toBe(false);
  });

  it('uses the current turn event roster when older transition diagnostics were compacted', () => {
    const state = makeState({
      currentDate: '公元194年05月03日 17:30（酉时）',
      currentLocationId: 'place_bailuzhou',
      currentPlaceId: 'place_bailuzhou',
      currentSceneId: 'scene_bailuzhou_mansion',
      turnEvents: [{
        eventId: 'event_turn_255_private',
        happenedAt: '公元194年05月03日 17:30（酉时）',
        locationId: 'scene_bailuzhou_mansion',
        summary: '邹氏在内宅当面与主角交谈。',
        presentNpcIds: ['npc_zoushi'],
        involvedNpcIds: ['npc_zoushi'],
        visibility: '私密',
      }],
      turnLog: [{
        turnNumber: 255,
        date: '公元194年05月03日 17:30（酉时）',
        playerInput: '与邹氏交谈',
        narrativeText: '邹氏在内宅当面应答。',
        fullNarrativeText: '【邹氏】\n“妾身就在这里。”',
        statePatchSummary: '较早的场景切换原始诊断已按存档瘦身策略裁掉。',
        timestamp: '2026-07-18T09:00:00.000Z',
      }],
    });

    expect(isNpcPhysicallyPresent(state, {
      ...npc,
      npcId: 'npc_zoushi',
      name: '邹氏',
      locationId: 'place_bailuzhou',
      isPresent: false,
    })).toBe(true);
    expect(isNpcPhysicallyPresent(state, {
      ...npc,
      npcId: 'npc_remote',
      name: '甘宁',
      locationId: 'place_bailuzhou',
      isPresent: false,
    })).toBe(false);
  });
});
