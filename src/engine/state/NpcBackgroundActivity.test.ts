import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { extractLuanShiCommandFromPatch } from '../turn/LuanShiCommandPatch';
import { ensureLuanShiState } from './createInitialRuntimeState';
import { validateLuanShiCommand } from './luanshiCommands';
import { applyLuanShiCommand } from './luanshiReducers';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '公元189年09月01日 08:00',
    currentDate: '公元189年09月10日 08:00',
    currentTime: { year: 189, month: 9, day: 10, hour: 8, minute: 0 },
    player: { id: 'player', name: '主角', roleType: '游侠', summary: '测试主角。' },
    currentLocationId: 'place_gate',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    npcs: [{
      npcId: 'npc_scout',
      name: '斥候',
      sex: '男',
      age: 26,
      role: '军中斥候',
      locationId: 'place_river',
      isPresent: false,
      isFocused: true,
      summary: '奉命侦察渡口。',
      appearance: '披短褐。',
      personality: '谨慎。',
      motivation: '查清敌情。',
      relationToPlayer: '受命于主角。',
      contactLevel: 30,
      recentAttitude: '专注执行军令',
      memories: [],
    }],
  });
}

describe('NPC background activity contract', () => {
  it('validates and applies one narrow background activity without rewriting the NPC profile', () => {
    const state = makeState();
    const command = {
      action: 'updateNpcBackgroundActivity',
      npcId: 'npc_scout',
      activity: {
        activityId: 'activity_scout_river',
        summary: '沿河侦察敌军渡口，不预断侦察结果。',
        status: 'active',
        locationId: 'place_river',
        startedAt: '公元189年09月10日 06:00',
        dueAt: '公元189年09月10日 10:00',
        sourceType: 'quest',
        sourceIds: ['quest_river_watch'],
        visibility: 'playerKnown',
      },
    } as const;

    expect(validateLuanShiCommand(state, command as any)).toEqual({ valid: true, errors: [], warnings: [] });

    const next = applyLuanShiCommand(state, command as any);
    expect(next.npcs.find((npc) => npc.npcId === 'npc_scout')).toMatchObject({
      name: '斥候',
      locationId: 'place_river',
      relationToPlayer: '受命于主角。',
      backgroundActivity: command.activity,
    });
  });

  it('clears a finished activity without changing presence or location', () => {
    const withActivity = applyLuanShiCommand(makeState(), {
      action: 'updateNpcBackgroundActivity',
      npcId: 'npc_scout',
      activity: {
        activityId: 'activity_scout_river',
        summary: '沿河侦察敌军渡口。',
        status: 'completed',
        dueAt: '公元189年09月10日 08:00',
        visibility: 'playerKnown',
      },
    } as any);

    const cleared = applyLuanShiCommand(withActivity, {
      action: 'updateNpcBackgroundActivity',
      npcId: 'npc_scout',
      activity: null,
    } as any);
    const npc = cleared.npcs.find((entry) => entry.npcId === 'npc_scout');

    expect(npc?.backgroundActivity).toBeUndefined();
    expect(npc).toMatchObject({ locationId: 'place_river', isPresent: false, isFocused: true });
  });

  it('preserves the activity when a complete profile refresh updates other NPC facts', () => {
    const withActivity = applyLuanShiCommand(makeState(), {
      action: 'updateNpcBackgroundActivity',
      npcId: 'npc_scout',
      activity: {
        activityId: 'activity_scout_river',
        summary: '沿河侦察敌军渡口。',
        status: 'active',
        dueAt: '公元189年09月10日 10:00',
      },
    } as any);
    const refreshed = applyLuanShiCommand(withActivity, {
      action: 'upsertNpcProfile',
      npcId: 'npc_scout',
      name: '斥候',
      sex: '男',
      age: 26,
      role: '军中斥候',
      locationId: 'place_river',
      isPresent: false,
      isFocused: true,
      currentIdentity: '前哨斥候',
      summary: '奉命侦察渡口。',
      appearance: '披短褐。',
      personality: '谨慎。',
      motivation: '查清敌情。',
      relationToPlayer: '受命于主角。',
      contactLevel: 30,
      recentAttitude: '专注执行军令',
      abilityScores: { 武力: 45, 统率: 38, 智力: 52, 政治: 25, 魅力: 31, 机运: 50 },
      traits: [{ id: 'trait_scout', label: '斥候', description: '熟悉侦察。', source: 'identity' }],
    } as any);

    expect(refreshed.npcs.find((npc) => npc.npcId === 'npc_scout')?.backgroundActivity).toMatchObject({
      activityId: 'activity_scout_river',
      status: 'active',
    });
  });

  it('rejects unknown NPCs and malformed activity facts', () => {
    const state = makeState();
    const result = validateLuanShiCommand(state, {
      action: 'updateNpcBackgroundActivity',
      npcId: 'npc_missing',
      activity: {
        activityId: '',
        summary: '',
        status: 'succeededAutomatically',
        sourceType: 'omniscientGuess',
        visibility: 'everyoneKnows',
      },
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('npc_missing');
    expect(result.errors.join('\n')).toContain('activityId');
    expect(result.errors.join('\n')).toContain('summary');
    expect(result.errors.join('\n')).toContain('status');
    expect(result.errors.join('\n')).toContain('sourceType');
    expect(result.errors.join('\n')).toContain('visibility');
  });

  it('keeps the narrow command when normalizing a StatePatch payload', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      reason: '斥候开始执行侦察任务',
      payload: {
        command: {
          action: 'updateNpcBackgroundActivity',
          npcId: 'npc_scout',
          activity: {
            activityId: 'activity_scout_river',
            summary: '沿河侦察敌军渡口。',
            status: 'active',
          },
        },
      },
    } as any);

    expect(command).toMatchObject({
      action: 'updateNpcBackgroundActivity',
      npcId: 'npc_scout',
      activity: { activityId: 'activity_scout_river', status: 'active' },
    });
  });

  it('does not allow a quest-linked background activity to outlive or reopen its terminal matter', () => {
    const state = {
      ...makeState(),
      activeQuests: [{
        id: 'quest_horse_feed_delivered',
        title: '战马精料危机',
        description: '蔡家筹运三船豆饼精料。',
        status: 'completed' as const,
        outcomeSummary: '三船精料已经到港入库。',
        archivedAt: '公元189年09月10日 08:00',
        createdAt: '公元189年09月09日 08:00',
        updatedAt: '公元189年09月10日 08:00',
      }],
    };
    const command = {
      action: 'updateNpcBackgroundActivity',
      npcId: 'npc_scout',
      activity: {
        activityId: 'activity_prepare_horse_feed',
        summary: '继续筹备已经送达的精料。',
        status: 'active',
        dueAt: '公元189年09月10日 10:00',
        sourceType: 'quest',
        sourceIds: ['quest_horse_feed_delivered'],
        visibility: 'playerKnown',
      },
    } as const;

    const first = applyLuanShiCommand(state, command as any);
    const repeated = applyLuanShiCommand(first, command as any);

    expect(first.npcs.find((npc) => npc.npcId === 'npc_scout')?.backgroundActivity).toMatchObject({
      activityId: 'activity_prepare_horse_feed',
      status: 'completed',
      lastEvaluatedAt: '公元189年09月10日 08:00',
    });
    expect(repeated.npcs.find((npc) => npc.npcId === 'npc_scout')?.backgroundActivity?.status).toBe('completed');
  });
});
