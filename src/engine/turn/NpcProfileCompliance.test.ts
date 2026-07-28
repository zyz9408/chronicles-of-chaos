import { describe, expect, it } from 'vitest';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import type { NarratorResponse } from './MockNarrator';
import { detectMissingNpcProfileCandidates } from './NpcProfileCompliance';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '公元255年01月01日',
    currentDate: '公元255年01月01日',
    currentLocationId: 'loc_frontier_camp',
    player: {
      id: 'player',
      name: '姜维',
      roleType: '蜀汉将领',
      summary: '正在前线统军。',
      playerMemory: {
        summary: '',
        keyDeeds: [],
        recentTurns: [],
      },
    },
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    locations: [],
    npcs: [
      {
        npcId: 'npc_chen_heng',
        name: '陈衡',
        sex: '男',
        age: 31,
        role: '军中书吏',
        locationId: 'loc_frontier_camp',
        isPresent: true,
        isFocused: false,
        summary: '负责军中文书的书吏。',
        appearance: '青衫佩笔。',
        personality: '谨慎。',
        motivation: '保全军中文书。',
        relationToPlayer: '同营办事',
        contactLevel: 2,
        recentAttitude: '恭谨',
        memories: [],
      },
    ],
  });
}

function makeResponse(narrativeText: string): NarratorResponse {
  return {
    protocolVersion: 'lsfy.turn.v1',
    narrativeText,
    suggestedActions: [],
    statePatches: [
      {
        type: 'timeAdvance',
        payload: { minutesAdvanced: 15, reason: '推进剧情', category: 'conversation' },
        reason: '推进剧情',
      },
    ],
    statePatch: null,
  };
}

function makeNpcProfile(overrides: Record<string, unknown> = {}) {
  return {
    npcId: 'npc_gu_heng',
    name: '顾衡',
    sex: '男',
    age: 29,
    role: '军中校尉',
    locationId: 'loc_frontier_camp',
    isPresent: true,
    isFocused: true,
    currentIdentity: '前线校尉',
    summary: '奉命入帐议事的校尉。',
    appearance: '披甲佩刀。',
    personality: '沉稳谨慎。',
    motivation: '守住营垒。',
    relationToPlayer: '同营任事',
    contactLevel: 5,
    recentAttitude: '恭谨',
    abilityScores: { 武力: 65, 统率: 72, 智力: 58, 政治: 42, 魅力: 45, 机运: 50 },
    traits: [{ id: 'trait_cautious_officer', label: '谨慎校尉', description: '行事稳健。', source: 'identity' }],
    ...overrides,
  };
}

describe('detectMissingNpcProfileCandidates', () => {
  it('detects repeated important named people that are absent from the NPC archive', () => {
    const response = makeResponse(
      '王经遣使入营，称已知军中虚实。片刻后，王经又令部曲压近营门，营中诸将都明白此人已经成了眼前局势的关键。',
    );

    const candidates = detectMissingNpcProfileCandidates({
      runtimeState: makeState(),
      response,
    });

    expect(candidates.map((candidate) => candidate.name)).toContain('王经');
    expect(candidates.find((candidate) => candidate.name === '王经')?.mentionCount).toBeGreaterThanOrEqual(2);
  });

  it('does not flag the player, existing NPCs, places, factions, or offices as missing profiles', () => {
    const response = makeResponse(
      '姜维令陈衡整理军书。太平道信徒在颍川郡府外传言，朝廷命郡兵搜查，蜀汉军府也有风声。',
    );

    const candidates = detectMissingNpcProfileCandidates({
      runtimeState: makeState(),
      response,
    });

    expect(candidates.map((candidate) => candidate.name)).toEqual([]);
  });

  it('treats an NPC memory suggestion for an unknown name as a profile gap', () => {
    const response: NarratorResponse = {
      ...makeResponse('管事来报，说刘禅已经听闻军中争议。'),
      writeback: {
        npcProfileSuggestions: [],
        npcMemorySuggestions: [
          {
            npcName: '刘禅',
            source: '听闻',
            content: '刘禅听闻军中争议，却尚未有明确旨意。',
          },
        ],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        debugNotes: [],
      },
    };

    const candidates = detectMissingNpcProfileCandidates({
      runtimeState: makeState(),
      response,
    });

    expect(candidates.map((candidate) => candidate.name)).toContain('刘禅');
  });

  it('detects current structured speaker labels and legacy colon speaker labels', () => {
    const response = makeResponse('【顾衡】营门已经封锁。\n沈策：末将已点齐巡卒。');

    const candidates = detectMissingNpcProfileCandidates({
      runtimeState: makeState(),
      response,
    });

    expect(candidates.map((candidate) => candidate.name)).toEqual(expect.arrayContaining(['顾衡', '沈策']));
  });

  it('does not treat ordinary brackets or book-title marks as speaker labels', () => {
    const response = makeResponse('军报旁注写着[顾衡]，案头另有《沈策传》，二者都只是文书内容。');

    const candidates = detectMissingNpcProfileCandidates({
      runtimeState: makeState(),
      response,
    });

    expect(candidates.map((candidate) => candidate.name)).not.toEqual(expect.arrayContaining(['顾衡', '沈策']));
  });

  it('does not treat legacy speaker-like text inside Chinese or English quotes as dialogue labels', () => {
    const response = makeResponse([
      '书吏展开旧牍，其中写道：“',
      '沈策：此处只是文书抄录，并非当面发言。',
      '”随后又翻到英文引号标记的一页："',
      '顾衡: this is an archival note, not live dialogue.',
      '"',
    ].join('\n'));

    const candidates = detectMissingNpcProfileCandidates({
      runtimeState: makeState(),
      response,
    });

    expect(candidates.map((candidate) => candidate.name)).not.toEqual(expect.arrayContaining(['沈策', '顾衡']));
  });

  it('ignores non-NPC structured labels while preserving a real paragraph-start legacy speaker', () => {
    const response = makeResponse('【旁白】营门外雨声渐密。\n【动作】众人一同回头。\n沈策：末将已经点齐巡卒。');

    const candidates = detectMissingNpcProfileCandidates({
      runtimeState: makeState(),
      response,
    });

    expect(candidates.map((candidate) => candidate.name)).toContain('沈策');
    expect(candidates.map((candidate) => candidate.name)).not.toEqual(expect.arrayContaining(['旁白', '动作']));
  });

  it('detects legacy and structured speakers after sentence punctuation boundaries', () => {
    const response = makeResponse('风停了。顾衡：静候。雨也止了！【沈策】巡卒已经归队。');

    const candidates = detectMissingNpcProfileCandidates({ runtimeState: makeState(), response });

    expect(candidates.map((candidate) => candidate.name)).toEqual(expect.arrayContaining(['顾衡', '沈策']));
  });

  it('keeps quoted sentence-boundary labels and inline non-NPC labels out of NPC candidates', () => {
    const response = makeResponse([
      '文书写着“风停了。顾衡：静候。”这只是旧令。',
      '书记又抄下"雨停了。【沈策】巡卒归队。"作为范例。',
      '风停了。【旁白】营门安静下来。雨止了。【动作】众人收伞。',
      '风停了，陆安静候在阶下。',
    ].join('\n'));

    const candidates = detectMissingNpcProfileCandidates({ runtimeState: makeState(), response });

    expect(candidates.map((candidate) => candidate.name)).not.toEqual(
      expect.arrayContaining(['顾衡', '沈策', '旁白', '动作', '陆安']),
    );
  });

  it('resets an unclosed quote at an independent paragraph before parsing later speakers', () => {
    const response = makeResponse([
      '军报残页写道：“风停了。顾衡：静候。',
      '',
      '风停了。沈策：末将已经点齐巡卒。',
      '',
      '另一页写着「雨停了。【陆安】只是抄录。」',
      '',
      '【赵宁】末将前来复命。',
    ].join('\n'));

    const candidates = detectMissingNpcProfileCandidates({ runtimeState: makeState(), response });

    expect(candidates.map((candidate) => candidate.name)).toEqual(expect.arrayContaining(['沈策', '赵宁']));
    expect(candidates.map((candidate) => candidate.name)).not.toEqual(expect.arrayContaining(['顾衡', '陆安']));
  });

  it('does not let an invalid profile suggestion suppress profile completion', () => {
    const response: NarratorResponse = {
      ...makeResponse('【顾衡】营门已经封锁。'),
      writeback: {
        npcProfileSuggestions: [makeNpcProfile({ age: 0 }) as any],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        debugNotes: [],
      },
    };

    const candidates = detectMissingNpcProfileCandidates({
      runtimeState: makeState(),
      response,
    });

    expect(candidates.map((candidate) => candidate.name)).toContain('顾衡');
  });

  it('only lets valid upsert patches suppress profile completion', () => {
    const validResponse: NarratorResponse = {
      ...makeResponse('【顾衡】营门已经封锁。'),
      statePatches: [{
        type: 'luanshiCommand',
        payload: { command: { action: 'upsertNpcProfile', ...makeNpcProfile() } },
        reason: '建立人物档案',
      }],
    };
    const invalidResponse: NarratorResponse = {
      ...validResponse,
      statePatches: [{
        type: 'luanshiCommand',
        payload: { command: { action: 'upsertNpcProfile', ...makeNpcProfile({ traits: [] }) } },
        reason: '建立人物档案',
      }],
    };
    const acceptedRuntimeState = makeState();
    acceptedRuntimeState.npcs?.push({ ...makeNpcProfile(), memories: [] } as any);

    expect(detectMissingNpcProfileCandidates({ runtimeState: makeState(), acceptedRuntimeState, response: validResponse }))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ name: '顾衡' })]));
    expect(detectMissingNpcProfileCandidates({ runtimeState: makeState(), response: invalidResponse }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: '顾衡' })]));
  });

  it('does not accept a valid profile patch when another patch makes the batch fail', () => {
    const response: NarratorResponse = {
      ...makeResponse('【顾衡】营门已经封锁。'),
      statePatches: [
        {
          type: 'luanshiCommand',
          payload: { command: { action: 'upsertNpcProfile', ...makeNpcProfile() } },
          reason: '建立人物档案',
        },
        {
          type: 'luanshiCommand',
          payload: {
            command: {
              action: 'upsertNpcProfile',
              ...makeNpcProfile({ npcId: 'npc_shen_ce', name: '沈策', traits: [] }),
            },
          },
          reason: '无效人物档案导致整批失败',
        },
      ],
    };

    expect(detectMissingNpcProfileCandidates({ runtimeState: makeState(), response }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: '顾衡' })]));
  });
});
