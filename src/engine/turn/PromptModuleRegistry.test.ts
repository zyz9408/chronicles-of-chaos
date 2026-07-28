import { describe, expect, it } from 'vitest';
import type { RuntimeState, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { buildPromptModules } from './PromptModuleRegistry';

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
    regionLevels: ['郡', '县'],
    factionTypes: ['朝廷', '地方豪强'],
    actorRoleTypes: ['流民', '士人'],
    socialClasses: ['流民', '士族'],
    resourceTypes: ['钱', '粮'],
    conflictTypes: ['战乱'],
    actionTypes: ['交谈'],
    relationshipTypes: ['陌生', '合作'],
  },
  lore: '这是一个测试乱世世界书。',
  mapSeed: [],
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
  });
}

describe('buildPromptModules', () => {
  it('构建基础 Prompt 模块并估算 token', () => {
    const modules = buildPromptModules({
      worldBook,
      runtimeState: makeState(),
      narrativeContext: '当前地点：市镇',
      stateWriterContext: 'currentLocationId: loc_market_town',
    });

    expect(modules.map((module) => module.id)).toEqual([
      'stable-prefix',
      'worldbook-core',
      'current-context',
      'state-writer',
    ]);
    expect(modules.every((module) => module.enabled)).toBe(true);
    expect(modules[0].reason).toContain('稳定');
    expect(modules[1].content).toContain('测试乱世世界书');
    expect(modules[2].content).toContain('当前地点：市镇');
    expect(modules[3].content).toContain('currentLocationId');
    expect(modules.every((module) => module.estimatedTokens > 0)).toBe(true);
  });
});
