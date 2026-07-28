import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { ensureLuanShiState } from '../engine/state/createInitialRuntimeState';
import { applyLuanShiCommand } from '../engine/state/luanshiReducers';
import { buildHeroinePanelModel } from './heroinePanelModel';
import { sidePanelButtons } from './GameScreen';

describe('relationship panel integration', () => {
  it('exposes heroine and bond panels as separate user-facing system entries', () => {
    expect(sidePanelButtons.find((entry) => entry.panel === 'heroines')).toMatchObject({
      label: '红颜',
      tone: 'social',
    });
    expect(sidePanelButtons.find((entry) => entry.panel === 'bonds')).toMatchObject({
      label: '羁绊',
      tone: 'social',
    });
  });

  it('keeps female profile updates separate from heroine relationship-thread patches', () => {
    const state = ensureLuanShiState({
      engineVersion: '0.1.0',
      worldBookId: 'test',
      worldBookVersion: '0.1.0',
      worldBookSource: 'official',
      startDate: '公元189年09月01日',
      currentDate: '公元189年09月02日',
      player: { id: 'player', name: '主角', roleType: 'player', summary: '测试角色' },
      currentLocationId: 'place_test',
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
        npcId: 'npc_he',
        name: '何氏',
        sex: '女',
        age: 28,
        role: '士族女性',
        locationId: 'place_test',
        isPresent: true,
        isFocused: true,
        summary: '测试 NPC',
        appearance: '仪态端庄。',
        personality: '谨慎克制。',
        motivation: '保全家族。',
        relationToPlayer: '礼节往来。',
        contactLevel: 12,
        recentAttitude: '谨慎',
        memories: [],
        femaleProfile: { relationshipNotes: '长期档案原值。' },
      }],
      heroineThreads: [{
        heroineThreadId: 'heroine_he',
        npcId: 'npc_he',
        npcName: '何氏',
        status: 'active',
        stage: '信任初成',
        relationshipRole: '红颜知己',
        summary: '关系线原值。',
        lastUpdatedAt: '公元189年09月01日',
      }],
    } as RuntimeState);

    const profileUpdated = applyLuanShiCommand(state, {
      action: 'updateNpcFemaleProfile',
      npcId: 'npc_he',
      npcName: '何氏',
      relationshipNotes: '长期档案更新值。',
    });
    const heroineUpdated = applyLuanShiCommand(profileUpdated, {
      action: 'upsertHeroineThread',
      heroineThreadId: 'heroine_he',
      summary: '关系线更新值。',
    });
    const panel = buildHeroinePanelModel(heroineUpdated, 'heroine_he');

    expect(profileUpdated.heroineThreads[0].summary).toBe('关系线原值。');
    expect(heroineUpdated.npcs[0].femaleProfile?.relationshipNotes).toBe('长期档案更新值。');
    expect(panel.selectedThread?.summary).toBe('关系线更新值。');
  });
});
