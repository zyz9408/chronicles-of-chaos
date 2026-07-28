import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { buildBattlePanelModel, formatConflictResultLevel, formatConflictType } from './battlePanelModel';

const baseRuntimeState = {
  conflicts: [
    {
      conflictId: 'battle_self_breakout',
      type: '伏击',
      title: '洛阳宫门伏击',
      summary: '越骑营残部在宫门外遭遇西凉兵伏击。',
      occurredAt: '公元189年09月01日 08:45（辰时）',
      outcome: '突围成功但减员严重。',
      scope: 'selfRelated',
      recordLevel: 'full',
      locationName: '洛阳宫门',
      sides: ['越骑营残部', '西凉兵'],
      commanderNpcIds: ['npc_commander'],
      involvedTroopIds: ['troop_yueqi'],
      involvedFactionIds: ['faction_han', 'faction_liang'],
      involvedNpcIds: ['npc_commander', 'npc_guard'],
      resultLevel: 'minorWin',
      winnerSide: '越骑营残部',
      loserSide: '西凉兵',
      judgement: {
        method: 'warJudgementV1',
        baselineAdvantage: 'slightDisadvantage',
        commanderAssessment: '主帅临阵稳住队列。',
        tacticalAssessment: '借宫门侧街避开伏兵正面。',
        scoreBreakdown: {
          troopBase: 12,
          commander: 18,
          tactical: 14,
          turningPoint: 8,
          total: 52,
          notes: ['伏兵先手', '侧街地形'],
        },
      },
      turningPoints: [
        {
          type: 'terrainBreakthrough',
          side: '越骑营残部',
          summary: '残部转入侧街，避开正面封堵。',
          impact: 'major',
          relatedTroopIds: ['troop_yueqi'],
          scoreModifier: 8,
        },
      ],
      reportText: '宫门前火光乱晃，越骑营冲开伏兵，折损之后仍护着主角退入侧街。',
      troopEffects: ['troop_yueqi 减员约八十人'],
    },
    {
      conflictId: 'battle_remote_mengjin',
      type: '战争',
      title: '孟津对峙',
      summary: '董卓部与洛阳旧军在孟津附近短暂交锋。',
      occurredAt: '公元189年09月',
      outcome: '董卓部控制渡口。',
      scope: 'other',
      recordLevel: 'brief',
      involvedFactionIds: ['faction_dong_zhuo'],
    },
  ],
} as unknown as RuntimeState;

describe('battlePanelModel', () => {
  it('groups self-related battle reports apart from other war records', () => {
    const model = buildBattlePanelModel(baseRuntimeState, 'selfRelated', 'battle_self_breakout');

    expect(model.tabs).toEqual([
      { key: 'selfRelated', label: '自势力相关', count: 1 },
      { key: 'other', label: '其他', count: 1 },
    ]);
    expect(model.listItems).toEqual([{
      conflictId: 'battle_self_breakout',
      title: '洛阳宫门伏击',
      occurredAt: '公元189年09月01日 08:45（辰时）',
      resultText: '小胜',
      importanceText: '重要战报',
    }]);
    expect(model.selectedConflict?.reportText).toContain('宫门前火光');
  });

  it('falls back to the first item in the active tab and keeps brief records brief', () => {
    const model = buildBattlePanelModel(baseRuntimeState, 'other', 'missing_battle');

    expect(model.selectedConflictId).toBe('battle_remote_mengjin');
    expect(model.selectedConflict?.recordLevel).toBe('brief');
    expect(model.selectedConflict?.reportText).toBeUndefined();
    expect(model.listItems[0]).toMatchObject({
      occurredAt: '公元189年09月',
      importanceText: '简略记录',
    });
  });

  it('renders battle archive entries separately from report details in GameScreen', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');

    expect(source).toContain("panel: 'battles'");
    expect(source).toContain('data-testid="battle-panel"');
    expect(source).toContain('archive-record-list');
    expect(source).toContain('openBattleReport');
    expect(source).toContain('battle-report-detail');
    expect(source).toContain('战局转折');
    expect(source).toContain('战争判定');
    expect(source).toContain('formatConflictScoreBreakdown');
    expect(source).toContain('buildConflictBriefingCard');
    expect(source).toContain('activeBattleArchiveBriefing');
    expect(source).toContain('<BattleBriefingVisual');
    expect(source).toContain('testId="battle-report-visual"');
    expect(source).toContain('buildBattlePanelModel');
  });

  it('does not expose enum-like conflict type or result values in archive list rows', () => {
    const model = buildBattlePanelModel({
      conflicts: [
        {
          ...baseRuntimeState.conflicts![0],
          conflictId: 'battle_enum_leak',
          type: 'strategic_probe_alpha',
          resultLevel: 'crushing_win',
        },
      ],
    } as unknown as RuntimeState, 'selfRelated', 'battle_enum_leak');

    const visibleText = JSON.stringify(model.listItems);

    expect(model.listItems[0]).toMatchObject({ resultText: '结果未明' });
    expect(visibleText).not.toContain('strategic_probe_alpha');
    expect(visibleText).not.toContain('crushing_win');
    expect(visibleText).not.toContain('越骑营残部在宫门外遭遇西凉兵伏击。');
    expect(visibleText).not.toContain('越骑营残部 对 西凉兵');
  });

  it('uses safe battle labels for report detail rows in GameScreen', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');

    expect(formatConflictType('strategic_probe_alpha')).toBe('战事');
    expect(formatConflictResultLevel('crushing_win')).toBe('结果未明');
    expect(source).toContain("['类型', formatConflictType(battle.type)]");
    expect(source).toContain("['结果', formatConflictResultLevel(battle.resultLevel) ?? battle.result]");
  });
});
