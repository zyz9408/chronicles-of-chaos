import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { ensureLuanShiState } from '../engine/state/createInitialRuntimeState';
import {
  applyMemorySettingsPatch,
  buildMemorySettingsPanelModel,
  getEffectiveMemorySettingControls,
} from './memorySettingsPanelModel';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test',
    worldBookVersion: '1',
    worldBookSource: 'official',
    startDate: '公元189年01月01日',
    currentDate: '公元189年01月02日',
    player: { id: 'player', name: '刘达', roleType: '游侠' } as RuntimeState['player'],
    currentLocationId: 'loc_gate',
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

describe('memorySettingsPanelModel', () => {
  it('lists only memory settings that are active in the current V1 pipeline', () => {
    const fields = getEffectiveMemorySettingControls().map((control) => control.field);

    expect(fields).toContain('enableAutoMemorySummary');
    expect(fields).toContain('recentRawTurnLimit');
    expect(fields).toContain('recentTurnCompressThreshold');
    expect(fields).toContain('maxPromptMemoryTokens');
    expect(fields).toContain('npcRecentMemoryImportantLimit');
    expect(fields).toContain('vectorResultLimit');
    expect(fields).toContain('npcMemoryCompressThreshold');
    expect(fields).toContain('npcMemoryKeepAfterCompress');
    expect(fields).not.toContain('locationMemoryCompressThreshold');
    expect(fields).not.toContain('taskMemoryCompressThreshold');
  });

  it('builds an unavailable model when no running save is open', () => {
    const model = buildMemorySettingsPanelModel(null);

    expect(model.available).toBe(false);
    expect(model.emptyReason).toContain('进入存档');
  });

  it('uses the approved aggressive defaults for ten raw turns, NPC three-tier compression, and an 80k memory budget', () => {
    const model = buildMemorySettingsPanelModel(makeState());

    expect(model.settings).toMatchObject({
      recentRawTurnLimit: 10,
      recentTurnCompressThreshold: 20,
      npcRecentMemoryDefaultLimit: 8,
      npcRecentMemoryImportantLimit: 12,
      npcMemoryCompressThreshold: 20,
      npcMemoryKeepAfterCompress: 40,
      maxPromptMemoryTokens: 80000,
      recentStoryTokenBudget: 30000,
      npcMemoryTokenBudget: 20000,
      midTermTokenBudget: 8000,
      longTermFactTokenBudget: 8000,
      locationMemoryTokenBudget: 4000,
      retrievalTokenBudget: 10000,
    });
  });

  it('summarizes the current save memory archive and settings sections', () => {
    const state = makeState();
    state.memoryArchive!.recentTurnSummaries.push({
      id: 'recent_1',
      turnNumber: 1,
      createdAt: state.currentDate,
      brief: '主角抵达城门。',
      importance: 'medium',
    });

    const model = buildMemorySettingsPanelModel(state);

    expect(model.available).toBe(true);
    expect(model.archiveStats.recentTurnSummaries).toBe(1);
    expect(model.sections.map((section) => section.title)).toEqual([
      '自动压缩',
      '正文记忆投喂',
      'NPC 记忆投喂',
      '分层摘要与检索',
      'Token 预算',
    ]);
  });

  it('applies and normalizes memory settings without dropping existing memories', () => {
    const state = makeState();
    state.memoryArchive!.recentTurnSummaries.push({
      id: 'recent_1',
      turnNumber: 1,
      createdAt: state.currentDate,
      brief: '主角抵达城门。',
      importance: 'medium',
    });

    const next = applyMemorySettingsPatch(state, {
      enableAutoMemorySummary: false,
      recentRawTurnLimit: -5,
      recentTurnCompressThreshold: 10.8,
      recentTurnKeepAfterCompress: 30,
      maxPromptMemoryTokens: 300000,
    });

    expect(next.memoryArchive.recentTurnSummaries).toHaveLength(1);
    expect(next.memoryArchive.settings.enableAutoMemorySummary).toBe(false);
    expect(next.memoryArchive.settings.recentRawTurnLimit).toBe(0);
    expect(next.memoryArchive.settings.recentTurnCompressThreshold).toBe(10);
    expect(next.memoryArchive.settings.recentTurnKeepAfterCompress).toBe(10);
    expect(next.memoryArchive.settings.maxPromptMemoryTokens).toBe(200000);
  });
});
