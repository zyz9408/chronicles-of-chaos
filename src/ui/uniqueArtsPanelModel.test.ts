import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { buildUniqueArtsPanelModel } from './uniqueArtsPanelModel';
import { sidePanelButtons } from './GameScreen';

const runtimeState = {
  currentDate: '189-09-01 08:00',
  player: {
    id: 'player',
    name: 'Liu Gou',
    roleType: 'player',
    summary: 'Player',
    uniqueArts: [
      {
        id: 'art_cavalry_command',
        name: 'Cavalry Command',
        rarity: 'blue',
        domain: 'warfare',
        level: 2,
        maxLevel: 5,
        progress: 45,
        description: 'Commands mounted troops with steady timing.',
        effectSummary: 'Adds advantage when leading cavalry or responding to cavalry threats.',
        source: 'opening',
        acquisition: {
          kind: 'teaching',
          occurredAt: '189-08-01 08:00',
          sourceRefId: 'teaching:chen-da:cavalry',
          summary: 'Chen Da taught the player mounted command.',
          instructorNpcId: 'npc_guard',
        },
        bankedProgress: 6,
        progressHistory: [{
          eventId: 'event_art_use_1',
          source: 'actual_use',
          intensity: 'normal',
          occurredAt: '189-09-01 08:00',
          sourceRefId: 'turn:12:warfare',
          summary: 'Directed cavalry during the field action.',
          awardedProgress: 7,
          levelBefore: 2,
          progressBefore: 38,
          levelAfter: 2,
          progressAfter: 45,
          levelledUp: false,
          appliedTurnKey: 'turn:12',
        }],
        promptHint: 'Use in army judgement when cavalry command matters.',
        checkHooks: [{ scope: 'warfare.cavalry', modifier: 8, note: 'Cavalry command edge.' }],
      },
    ],
  },
  npcs: [
    {
      npcId: 'npc_guard',
      name: 'Chen Da',
      sex: 'male',
      age: 34,
      role: 'Guard',
      isPresent: true,
      isFocused: true,
      relationToPlayer: 'ally',
      contactLevel: 20,
      recentAttitude: 'loyal',
      memories: [],
      traits: [],
      effects: [],
      uniqueArts: [
        {
          id: 'art_gate_guard',
          name: 'Gate Guarding',
          rarity: 'green',
          domain: 'personalCombat',
          level: 1,
          description: 'Good at holding a narrow gate.',
          effectSummary: 'Useful in defensive personal combat.',
          source: 'event',
        },
      ],
    },
  ],
} as unknown as RuntimeState;

describe('buildUniqueArtsPanelModel', () => {
  it('collects player and NPC unique arts into a selectable roster', () => {
    const model = buildUniqueArtsPanelModel(runtimeState);

    expect(model.totalCount).toBe(2);
    expect(model.playerCount).toBe(1);
    expect(model.npcCount).toBe(1);
    expect(model.rosterItems.map((item) => item.name)).toEqual(['Cavalry Command', 'Gate Guarding']);
    expect(model.rosterGroups.map((group) => group.title)).toEqual(['主角绝艺', '人物绝艺']);
    expect(model.rosterGroups[0].items.map((item) => item.name)).toEqual(['Cavalry Command']);
    expect(model.rosterGroups[1].items.map((item) => item.name)).toEqual(['Gate Guarding']);
    expect(model.rosterItems[0]).toMatchObject({
      id: 'player:player:art_cavalry_command',
      characterType: 'player',
      characterName: 'Liu Gou',
      rarity: 'blue',
      domain: 'warfare',
      levelText: 'Lv.2 / 5',
    });
    expect(model.selectedArt).toMatchObject({
      id: 'player:player:art_cavalry_command',
      description: 'Commands mounted troops with steady timing.',
      effectSummary: 'Adds advantage when leading cavalry or responding to cavalry threats.',
      promptHint: 'Use in army judgement when cavalry command matters.',
      progressText: '45%',
      currentProgress: 45,
      progressPercent: 45,
      bankedProgress: 6,
      isMaxLevel: false,
      nextLevelText: '距离 Lv.3 还需 55 点',
      acquisitionLabel: '他人传授',
      acquisitionInstructorName: 'Chen Da',
    });
    expect(model.selectedArt?.progressHistory[0]).toMatchObject({
      sourceLabel: '实际运用',
      intensityLabel: '正常',
      awardedText: '+7',
      transitionText: 'Lv.2 · 45%',
    });
  });

  it('selects a requested NPC unique art when present', () => {
    const model = buildUniqueArtsPanelModel(runtimeState, 'npc:npc_guard:art_gate_guard');

    expect(model.selectedArt?.name).toBe('Gate Guarding');
    expect(model.selectedArt?.characterType).toBe('npc');
    expect(model.selectedArt?.characterName).toBe('Chen Da');
  });

  it('shows deterministic authored mechanics and their latest execution', () => {
    const state = structuredClone(runtimeState);
    const art = state.player.uniqueArts?.[0];
    if (!art) throw new Error('fixture art missing');
    art.name = '不灭回春';
    art.description = '每次使用必定恢复所有生命。';
    state.abilityRuleExecutions = [{
      executionId: 'execution_1',
      eventId: 'turn:1:art-use:art_cavalry_command',
      ruleId: 'art_cavalry_command:full-heal-on-use',
      sourceAbilityId: art.id,
      sourceAbilityName: art.name,
      trigger: 'on_unique_art_use',
      status: 'applied',
      summary: '不灭回春按玩家权威规则将生命恢复至上限',
      occurredAt: '189-09-01 08:00',
    }];

    const model = buildUniqueArtsPanelModel(state);

    expect(model.selectedArt?.mechanicsSummary).toContain('使用时生命恢复至上限');
    expect(model.selectedArt?.lastExecutionSummary).toContain('按玩家权威规则');
  });

  it('exposes the grouped roster through the user-facing unique-arts panel entry', () => {
    const model = buildUniqueArtsPanelModel(runtimeState);

    expect(sidePanelButtons.find((entry) => entry.panel === 'uniqueArts')).toMatchObject({
      label: '绝艺',
      tone: 'self',
    });
    expect(model.rosterGroups.map((group) => group.title)).toEqual(['主角绝艺', '人物绝艺']);
  });

  it('uses player-facing labels and does not expose writeback command names', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<span>持有者</span>');
    expect(source).toContain('<h4>触发与承接</h4>');
    expect(source).toContain('<h4>本地执行规则</h4>');
    expect(source).toContain('<h4>判定条件</h4>');
    expect(source).toContain('成长记录');
    expect(source).not.toContain('updateCharacterUniqueArts 写回');
    expect(source).not.toContain('<h4>判定钩子</h4>');
  });
});
