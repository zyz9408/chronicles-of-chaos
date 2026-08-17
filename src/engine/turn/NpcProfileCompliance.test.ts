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
    player: { id: 'player', name: '姜维', roleType: '蜀汉将领', summary: '正在前线统军。' },
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
    npcs: [],
  });
}

function makeResponse(overrides: Partial<NarratorResponse> = {}): NarratorResponse {
  return {
    protocolVersion: 'lsfy.turn.v1',
    narrativeText: '【顾衡】营门已经封锁。王经又命部曲压近营门。',
    suggestedActions: [],
    statePatches: [{
      type: 'timeAdvance',
      payload: { minutesAdvanced: 15, reason: '推进剧情', category: 'conversation' },
      reason: '推进剧情',
    }],
    statePatch: null,
    ...overrides,
  };
}

function makeNpcProfile(overrides: Record<string, unknown> = {}) {
  return {
    npcId: 'npc_gu_heng',
    name: '顾衡',
    persistenceReason: 'active_system_role',
    persistenceEvidence: '已确认其担任前线校尉并持续负责营垒军务。',
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
  it('does not turn named speakers, repeated mentions, or unknown NPC memories into archive repair calls', () => {
    const response = makeResponse({
      writeback: {
        npcProfileSuggestions: [],
        npcMemorySuggestions: [{ npcName: '王经', source: '听闻', content: '王经再次压近营门。' }],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        debugNotes: [],
      },
    });

    expect(detectMissingNpcProfileCandidates({ runtimeState: makeState(), response })).toEqual([]);
  });

  it('repairs only an explicitly submitted long-term profile that was not accepted locally', () => {
    const response = makeResponse({
      writeback: {
        npcProfileSuggestions: [makeNpcProfile({ age: 0 }) as any],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        debugNotes: [],
      },
    });

    expect(detectMissingNpcProfileCandidates({ runtimeState: makeState(), response }))
      .toEqual([expect.objectContaining({
        name: '顾衡',
        reasons: ['人物志建议未通过本地合同'],
      })]);
  });

  it('does not repair a profile without explicit long-term persistence evidence', () => {
    const response = makeResponse({
      writeback: {
        npcProfileSuggestions: [makeNpcProfile({
          persistenceReason: undefined,
          persistenceEvidence: undefined,
        }) as any],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        debugNotes: [],
      },
    });

    expect(detectMissingNpcProfileCandidates({ runtimeState: makeState(), response })).toEqual([]);
  });

  it('uses a structured long-term admission when the main response omitted the full profile', () => {
    const response = makeResponse({
      writeback: {
        turnSummary: {
          brief: '顾衡正式受命长期负责前线营垒。',
          npcAdmissions: [{
            sourceRefId: 'npc-admission-turn-1-gu-heng',
            npcId: 'npc_gu_heng',
            name: '顾衡',
            persistenceReason: 'active_system_role',
            persistenceEvidence: '顾衡已经正式受命长期负责前线营垒。',
            summary: '顾衡成为有稳定职责的营垒校尉。',
          }],
        },
        npcProfileSuggestions: [],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        debugNotes: [],
      },
    });

    expect(detectMissingNpcProfileCandidates({ runtimeState: makeState(), response })).toEqual([{
      npcId: 'npc_gu_heng',
      name: '顾衡',
      persistenceReason: 'active_system_role',
      admissionConfirmed: true,
      mentionCount: 1,
      reasons: ['结构化人物准入事实尚未形成有效人物志'],
      evidence: ['顾衡已经正式受命长期负责前线营垒。', '顾衡成为有稳定职责的营垒校尉。'],
    }]);
  });

  it('does not retry an explicit profile after it already entered the accepted runtime state', () => {
    const response = makeResponse({
      writeback: {
        npcProfileSuggestions: [makeNpcProfile() as any],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        debugNotes: [],
      },
    });
    const acceptedState = makeState();
    acceptedState.npcs?.push({ ...makeNpcProfile(), memories: [] } as any);

    expect(detectMissingNpcProfileCandidates({
      runtimeState: makeState(),
      acceptedRuntimeState: acceptedState,
      response,
    })).toEqual([]);
  });
});
