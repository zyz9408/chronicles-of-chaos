import { describe, expect, it, vi } from 'vitest';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import type { LlmClient } from '../llm/LlmClient';
import { finalizeCombatResult } from './CombatEngine';
import { simulateCombatWithLocalAi } from './CombatAi';
import {
  buildCombatNarrativeMessages,
  buildWarNarrativeMessages,
  generateCombatNarrative,
  generateWarNarrative,
} from './EncounterNarrative';
import {
  makeCombatIntent,
  makeCombatantSource,
  makeNpcCombatantSource,
} from './CombatTestFixtures';
import { createCombatEncounterSnapshot } from './CombatSnapshotAdapter';
import { createCombatEngineState } from './CombatEngine';
import { createSealedWarResult, executeWarRound, resolveWarDecision, resumeWarAfterAutoPause } from './WarEngine';
import { createWarEncounterSnapshot } from './WarSnapshotAdapter';
import { makeTroopProfile, makeWarCommander, makeWarIntent, makeWarTroop } from './WarTestFixtures';
import { createInitialWarState } from './WarEngine';
import type { WarEngineState } from './WarTypes';

function makeResult() {
  const snapshot = createCombatEncounterSnapshot({
    sessionId: 'session_narrative_test',
    intent: makeCombatIntent(),
    playerSources: [makeCombatantSource('player_liuping', { name: '刘平', abilityScores: { 武力: 95, 机运: 50 } })],
    enemySources: [makeNpcCombatantSource('npc_enemy_guard', { name: '西凉悍卒', abilityScores: { 武力: 35, 机运: 40 } })],
    projections: { profiles: [] },
    threatTier: 'standard',
    lootableItemIds: [],
    capturableEquipmentItemIds: [],
  });
  return finalizeCombatResult(
    simulateCombatWithLocalAi(createCombatEngineState(snapshot), { maxActions: 200 }),
    '2026-07-20T02:00:00.000Z',
    { playerActorId: 'player_liuping' },
  );
}

function makeWarResult() {
  const snapshot = createWarEncounterSnapshot({
    sessionId: 'session_war_narrative_test',
    intent: makeWarIntent(
      ['troop_player_infantry'],
      ['troop_enemy_cavalry'],
      { player: [4_000], enemy: [100] },
    ),
    playerTroops: [makeWarTroop('troop_player_infantry', { size: 4_000, morale: 90, training: 90 })],
    enemyTroops: [makeWarTroop('troop_enemy_cavalry', { size: 100, morale: 20, training: 30 })],
    playerCommander: makeWarCommander('player_liuping'),
    enemyCommander: makeWarCommander('npc_enemy_commander'),
    projections: {
      profiles: [
        makeTroopProfile('troop_player_infantry', 'infantry'),
        makeTroopProfile('troop_enemy_cavalry', 'cavalry'),
      ],
    },
  });
  let state: WarEngineState = createInitialWarState(snapshot);
  for (let guard = 0; guard < 80 && state.phase !== 'resolved'; guard += 1) {
    if (state.phase === 'awaiting_round') {
      state = executeWarRound(state, {
        player: { type: 'tactic', tactic: 'all_out_assault' },
        enemy: { type: 'tactic', tactic: 'steady_advance' },
      });
    } else if (state.phase === 'awaiting_decision' && state.pendingDecision) {
      state = resolveWarDecision(state, {
        choice: state.pendingDecision.kind === 'pursuit' ? 'pursue' : 'accept_surrender',
      });
    } else if (state.phase === 'auto_paused') {
      state = resumeWarAfterAutoPause(state);
    }
  }
  return createSealedWarResult(state, '2026-07-20T02:30:00.000Z');
}

const config: ApiConfigArchive = {
  id: 'api_test',
  name: '测试接口',
  provider: 'openai',
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'test-key',
  model: 'test-model',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
};

describe('Combat V2 result-only narrative', () => {
  it('builds a read-only prompt that treats the sealed result as the only combat authority', () => {
    const result = makeResult();
    const messages = buildCombatNarrativeMessages({
      result,
      encounterReason: '汉水大营遭遇战',
      locationLabel: '荆州 - 南郡 - 襄阳城 - 汉水大营',
      participantNames: { player_liuping: '刘平', npc_enemy_guard: '西凉悍卒' },
      playerName: '刘平',
      playerSex: '男',
      narrativePerspective: 'third_person',
      recentNarratives: ['上一回合敌军突入营门。'],
      persistentPromptGuide: '## 玩家启用的永久提示词\n1. 战斗描写保持简练。',
    });
    const prompt = messages.map((message) => message.content).join('\n');

    expect(prompt).toContain(result.resultHash);
    expect(prompt).toContain('唯一事实源');
    expect(prompt).toContain('不得修改胜负');
    expect(prompt).toContain('只返回 JSON');
    expect(prompt).toContain('战斗描写保持简练');
    expect(prompt).toContain('本局正文叙事人称：第三人称');
    expect(prompt).toContain('姓名“刘平”');
    expect(prompt).toContain('不得用主角表字');
  });

  it('uses a generous timeout and retries without ever asking the model to recalculate combat', async () => {
    const result = makeResult();
    const generate = vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '【旁白】刀枪声渐止，胜负已定。',
        suggestedActions: [{ label: '清点伤员', description: '处理战后事务。', actionType: 'rest' }],
      }),
      provider: 'openai' as const,
      model: 'test-model',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    }));
    const client: LlmClient = { generate };

    const generated = await generateCombatNarrative({
      config,
      client,
      prompt: {
        result,
        encounterReason: '汉水大营遭遇战',
        locationLabel: '汉水大营',
        participantNames: { player_liuping: '刘平', npc_enemy_guard: '西凉悍卒' },
        recentNarratives: [],
      },
    });

    expect(generated.narrativeText).toContain('胜负已定');
    expect(generated.suggestedActions).toHaveLength(1);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 180_000,
      retryCount: 2,
      responseFormat: 'json_object',
    }));
  });
});

describe('War V2 result-only narrative', () => {
  it('exposes the sealed objective, casualties and action order without granting write authority', () => {
    const result = makeWarResult();
    const messages = buildWarNarrativeMessages({
      result,
      encounterReason: '枯林坡大战',
      locationLabel: '荆州 - 南阳郡 - 枯林坡',
      forceNames: {
        troop_player_infantry: '主力步兵营',
        troop_enemy_cavalry: '西凉骑兵',
      },
      commanderNames: { player_liuping: '刘平', npc_enemy_commander: '张绣' },
      playerName: '刘平',
      playerSex: '男',
      narrativePerspective: 'first_person',
      recentNarratives: ['两军在枯林坡列阵。'],
      persistentPromptGuide: '## 玩家启用的永久提示词\n1. 战争描写避免机械复述数值。',
    });
    const prompt = messages.map((message) => message.content).join('\n');
    expect(prompt).toContain(result.resultHash);
    expect(prompt).toContain(result.objective);
    expect(prompt).toContain('不得修改胜负');
    expect(prompt).toContain('不得输出 statePatches');
    expect(prompt).toContain('战争描写避免机械复述数值');
    expect(prompt).toContain('本局正文叙事人称：第一人称');
    expect(prompt).toContain('统一使用“我”');
  });

  it('uses the same generous retry budget for slow public endpoints', async () => {
    const result = makeWarResult();
    const generate = vi.fn(async () => ({
      content: JSON.stringify({
        narrativeText: '【旁白】战旗穿过尘烟，敌军阵线终于崩解。',
        suggestedActions: [{ label: '收拢各营', actionType: 'command' }],
      }),
      provider: 'openai' as const,
      model: 'test-model',
    }));
    const generated = await generateWarNarrative({
      config,
      client: { generate },
      prompt: {
        result,
        encounterReason: '枯林坡大战',
        locationLabel: '枯林坡',
        forceNames: {
          troop_player_infantry: '主力步兵营',
          troop_enemy_cavalry: '西凉骑兵',
        },
        commanderNames: { player_liuping: '刘平', npc_enemy_commander: '张绣' },
        recentNarratives: [],
      },
    });
    expect(generated.narrativeText).toContain('阵线终于崩解');
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 180_000,
      retryCount: 2,
      responseFormat: 'json_object',
    }));
  });
});
