import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { selectNpcIntentSimulationTargets } from './NpcIntentSimulation';
import { selectRelationshipWorldEvolutionCandidates } from '../worldEvolution/RelationshipWorldEvolution';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0', worldBookId: 'test', worldBookVersion: '0.1.0', worldBookSource: 'official',
    startDate: '0189-09-01 08:00', currentDate: '0189-09-10 12:00',
    currentTime: { year: 189, month: 9, day: 10, hour: 12, minute: 0 },
    player: { id: 'player', name: 'Player', roleType: 'traveler', summary: 'Test.' },
    currentLocationId: 'place_gate', knownActors: [], knownFactions: [], relationships: [], knownRumors: [],
    activeQuests: [], playerResources: {}, worldStateDelta: {}, turnLog: [], localSituationNotes: [],
    npcs: [{
      npcId: 'npc_due', name: '远场斥候', sex: '男', age: 28, role: '斥候', locationId: 'place_river',
      isPresent: false, isFocused: false, summary: '正在远场侦察。', appearance: '短褐。', personality: '谨慎。',
      motivation: '查清渡口。', relationToPlayer: '受命于玩家。', contactLevel: 20, recentAttitude: '专注', memories: [],
      backgroundActivity: {
        activityId: 'activity_due_scout', summary: '侦察河道。', status: 'active', locationId: 'place_river',
        dueAt: '0189-09-10 11:00', visibility: 'playerKnown',
      },
    }] as any,
    bondThreads: [{
      bondThreadId: 'bond_scout',
      targetNpcIds: ['npc_due'],
      targetNames: ['远场斥候'],
      bondType: 'ally',
      status: 'active',
      summary: '受命外出的可靠斥候。',
      lastUpdatedAt: '0189-09-09 08:00',
    }],
  });
}

describe('NPC background activity execution boundary', () => {
  it('routes a due offstage relationship NPC only to world evolution', () => {
    const state = makeState();
    const targets = selectNpcIntentSimulationTargets(state, '我在城门等待消息', { maxNpcCount: 5 });
    const evolutionTargets = selectRelationshipWorldEvolutionCandidates(state, '我在城门等待消息', 3);

    expect(targets).toEqual([]);
    expect(evolutionTargets).toHaveLength(1);
    expect(evolutionTargets[0]).toMatchObject({
      npcId: 'npc_due',
      trigger: 'due',
      backgroundActivity: {
        activityId: 'activity_due_scout',
        status: 'active',
        dueAt: '0189-09-10 11:00',
      },
    });
  });

  it('does not send a completed-matter background activity back into foreground NPC simulation', () => {
    const state = makeState();
    state.activeQuests = [{
      id: 'quest_river_watch',
      title: '侦察河道',
      description: '查清渡口敌情。',
      status: 'completed',
      outcomeSummary: '斥候已经回报渡口敌情。',
      archivedAt: '0189-09-10 11:00',
      createdAt: '0189-09-09 08:00',
      updatedAt: '0189-09-10 11:00',
    }];
    state.npcs![0].backgroundActivity = {
      ...state.npcs![0].backgroundActivity!,
      sourceType: 'quest',
      sourceIds: ['quest_river_watch'],
    };

    expect(selectNpcIntentSimulationTargets(state, '我在城门等待消息', { maxNpcCount: 5 })).toEqual([]);
  });
});
