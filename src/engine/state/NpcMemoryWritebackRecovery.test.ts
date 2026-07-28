import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from './createInitialRuntimeState';
import { recoverRejectedCurrentSceneNpcMemories } from './NpcMemoryWritebackRecovery';

function makeState(): RuntimeState {
  const rawResponse = JSON.stringify({
    narrativeText: '【邹氏】\n“夫君回来了。”',
    suggestedActions: [],
    writeback: {
      npcMemorySuggestions: [
        {
          npcId: 'npc_zoushi',
          npcName: '邹氏',
          source: '亲历',
          content: '邹氏在水寨内宅亲自迎接主角。',
        },
        {
          npcId: 'npc_ganning',
          npcName: '甘宁',
          source: '亲历',
          content: '甘宁远在营外却被错误写成亲历。',
        },
      ],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      debugNotes: [],
    },
  });
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-chaos-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '公元194年05月03日 13:30（未时）',
    currentDate: '公元194年05月03日 15:00（申时）',
    player: { id: 'player', name: '刘平', roleType: '将领', summary: '测试主角。' },
    currentLocationId: 'place_inner_residence',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    localSituationNotes: [],
    npcs: [
      {
        npcId: 'npc_zoushi', name: '邹氏', sex: '女', age: 32, role: '内宅女眷',
        locationId: 'place_inner_residence', isPresent: false, isFocused: true,
        summary: '测试人物。', appearance: '端庄。', personality: '谨慎。', motivation: '安身。',
        relationToPlayer: '亲近', contactLevel: 80, recentAttitude: '依恋', memories: [],
      },
      {
        npcId: 'npc_ganning', name: '甘宁', sex: '男', age: 27, role: '将领',
        locationId: 'place_camp', isPresent: false, isFocused: true,
        summary: '测试人物。', appearance: '精悍。', personality: '豪爽。', motivation: '建功。',
        relationToPlayer: '效忠', contactLevel: 70, recentAttitude: '振奋', memories: [],
      },
    ],
    turnLog: [{
      turnNumber: 251,
      date: '公元194年05月03日 15:00（申时）',
      playerInput: '与邹氏交谈',
      narrativeText: '邹氏在内宅应答。',
      fullNarrativeText: '【邹氏】\n“夫君回来了。”',
      statePatchSummary: [
        'writeback：近期剧情记忆',
        '已忽略无效写回建议：NPC记忆：NPC 邹氏 当前不在场，不能写入亲历记忆。',
        'NPC记忆：NPC 甘宁 当前不在场，不能写入亲历记忆。',
      ].join('；'),
      timestamp: '2026-07-18T08:30:00.000Z',
      displayMeta: { rawResponse },
    }],
  });
}

describe('recoverRejectedCurrentSceneNpcMemories', () => {
  it('recovers only a structured firsthand suggestion for an explicitly tagged speaker', () => {
    const recovered = recoverRejectedCurrentSceneNpcMemories(makeState());

    expect(recovered.npcs?.find((npc) => npc.npcId === 'npc_zoushi')?.memories).toEqual([
      expect.objectContaining({
        source: '亲历',
        content: '邹氏在水寨内宅亲自迎接主角。',
        createdAt: '公元194年05月03日 15:00（申时）',
      }),
    ]);
    expect(recovered.npcs?.find((npc) => npc.npcId === 'npc_ganning')?.memories).toEqual([]);
  });

  it('is idempotent and does not duplicate an already recovered memory', () => {
    const once = recoverRejectedCurrentSceneNpcMemories(makeState());
    const twice = recoverRejectedCurrentSceneNpcMemories(once);

    expect(twice.npcs?.find((npc) => npc.npcId === 'npc_zoushi')?.memories).toHaveLength(1);
  });

  it('does not recover without the exact historical rejection marker', () => {
    const state = makeState();
    state.turnLog[0].statePatchSummary = 'writeback：近期剧情记忆';

    expect(recoverRejectedCurrentSceneNpcMemories(state)).toBe(state);
  });
});
