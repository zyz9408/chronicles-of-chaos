import { describe, expect, it } from 'vitest';
import type { RuntimeState, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { executeTurn } from './TurnOrchestrator';

const worldBook: WorldBook = {
  manifest: {
    id: 'test-chaos-world',
    name: '测试乱世',
    version: '0.1.0',
    author: 'test',
    language: 'zh-CN',
    genre: '乱世',
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
      id: 'loc_market_town',
      name: '市镇',
      level: '聚落',
      summary: '道路交汇处的小市镇。',
      connectedRegionIds: [],
      controlHint: '未知',
      tensionHint: '不安',
    },
  ],
  factionsSeed: [],
  timelineAnchors: [],
  startBookmarks: [],
  openingCrisisTemplates: [],
  prompts: {
    narrativeBaseline: '保持乱世叙事。',
    forbiddenTopics: [],
    outputFormat: '输出正文。',
    toneGuide: '沉稳。',
  },
  validationRules: [],
};

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-chaos-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '乱世元年2月',
    currentDate: '乱世元年2月',
    player: {
      id: 'player',
      name: '主角',
      roleType: '流民',
      summary: '流落市镇。',
    },
    currentLocationId: 'loc_market_town',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    locations: [
      {
        locationId: 'loc_market_town',
        name: '市镇',
        type: '聚落',
        summary: '道路交汇处的小市镇。',
        knownLevel: '亲历',
        recentEvents: [],
      },
    ],
    npcs: [
      {
        npcId: 'npc_chen_heng',
        name: '陈衡',
        sex: '男',
        age: 30,
        role: '游侠首领',
        locationId: 'loc_market_town',
        isPresent: true,
        isFocused: false,
        summary: '机警过人。',
        appearance: '目光锐利。',
        personality: '豪爽直接。',
        motivation: '寻找机会。',
        relationToPlayer: '刚刚见过主角救人。',
        contactLevel: 12,
        recentAttitude: '好奇',
        memories: [],
      },
    ],
  });
}

describe('executeTurn prompt contexts', () => {
  it('返回叙事上下文和状态写入上下文', async () => {
    const result = await executeTurn(worldBook, makeState(), '我观察陈衡');

    expect(result.narrativeContext).toContain('在场人物：陈衡');
    expect(result.stateWriterContext).toContain('npcId: npc_chen_heng');
    expect(result.promptContext).toContain('当前所在：道路交汇处的小市镇。');
    expect(result.promptModules.map((module) => module.id)).toContain('current-context');
    expect(result.promptEstimatedTokens).toBeGreaterThan(0);
  });

  it('uses the interpreted combat intent in the real prompt composition path', async () => {
    const state = makeState();
    const enrichedState = {
      ...state,
      npcs: (state.npcs ?? []).map((npc) => npc.npcId === 'npc_chen_heng'
        ? {
            ...npc,
            equipment: [{
              id: 'eq_orchestrator_mixed_hooks',
              slot: 'weapon' as const,
              name: '随身短弓',
              quality: '旧物',
              description: '陈衡随身使用的短弓。',
              checkHooks: [
                { scope: 'ordinaryCheck.hunting', modifier: 2, note: 'ORCHESTRATOR_ORDINARY_HOOK' },
                { scope: 'personalCombat.ranged', modifier: 5, note: 'ORCHESTRATOR_COMBAT_HOOK' },
              ],
            }],
          }
        : npc),
    } as RuntimeState;

    const result = await executeTurn(worldBook, enrichedState, '请陈衡放箭射敌');

    expect(result.stateWriterContext).toContain('ORCHESTRATOR_COMBAT_HOOK');
    expect(result.stateWriterContext).not.toContain('ORCHESTRATOR_ORDINARY_HOOK');
  });

  it.each([
    '我询问是否应该立即迎战',
    '我询问陈衡，敌军出现后立即迎战是否妥当',
    '我询问陈衡：随后攻击敌人是否可行',
  ])('keeps misleading question wording on the ordinary MockNarrator and prompt scope path for %s', async (playerInput) => {
    const state = makeState();
    const enrichedState = {
      ...state,
      npcs: (state.npcs ?? []).map((npc) => npc.npcId === 'npc_chen_heng'
        ? {
            ...npc,
            equipment: [{
              id: 'eq_orchestrator_discussion_hooks',
              slot: 'weapon' as const,
              name: '议事短弓',
              quality: '旧物',
              description: '用于讨论守备与实际交战。',
              checkHooks: [
                { scope: 'ordinaryCheck.discussion', modifier: 2, note: 'ORCHESTRATOR_DISCUSSION_HOOK' },
                { scope: 'personalCombat.ranged', modifier: 5, note: 'ORCHESTRATOR_MISLEADING_COMBAT_HOOK' },
              ],
            }],
          }
        : npc),
    } as RuntimeState;

    const result = await executeTurn(worldBook, enrichedState, playerInput);

    expect(result.actionIntent).toBe('inquire');
    expect(result.narrativeText).not.toContain('狭路相逢');
    expect(result.stateWriterContext).toContain('ORCHESTRATOR_DISCUSSION_HOOK');
    expect(result.stateWriterContext).not.toContain('ORCHESTRATOR_MISLEADING_COMBAT_HOOK');
  });

  it.each([
    ['我询问陈衡应该如何杀敌', 'inquire', false],
    ['我打听是否有人准备刺杀太守', 'inquire', false],
    ['请陈衡讲讲怎样防守城门', 'interact', false],
    ['请陈衡放箭射敌', 'combat', true],
    ['询问完军情后立即迎战', 'combat', true],
    ['我询问完军情后立即迎战，无论敌人是否准备妥当', 'combat', true],
    ['我询问军情，随后攻击敌人，看看是否能突围', 'combat', true],
  ] as const)('keeps MockNarrator on the correct branch for %s', async (playerInput, expectedIntent, expectsCombat) => {
    const result = await executeTurn(worldBook, makeState(), playerInput);

    expect(result.actionIntent).toBe(expectedIntent);
    expect(result.narrativeText.includes('狭路相逢')).toBe(expectsCombat);
  });

  it('applies local stamina consumption and recovery on the committed turn path', async () => {
    const state = makeState();
    state.player.vitals = { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 };

    const fought = await executeTurn(worldBook, state, '我拔刀迎战敌人');
    expect(fought.newRuntimeState.player.vitals?.stamina).toBe(90);
    expect(fought.newRuntimeState.turnLog[fought.newRuntimeState.turnLog.length - 1]?.statePatchSummary).toContain('体力 100→90（战斗消耗）');

    const rested = await executeTurn(worldBook, fought.newRuntimeState, '休息一夜');
    expect(rested.newRuntimeState.player.vitals?.stamina).toBe(100);
    expect(rested.newRuntimeState.turnLog[rested.newRuntimeState.turnLog.length - 1]?.statePatchSummary).toContain('体力 90→100（休息恢复）');
  });
});
