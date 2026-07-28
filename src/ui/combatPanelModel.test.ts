import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import {
  buildCombatPanelModel,
  formatCombatKind,
  formatCombatResult,
  formatCombatSignificance,
} from './combatPanelModel';

const baseRuntimeState = {
  combatRecords: [
    {
      combatId: 'combat_gate_duel',
      kind: 'battlefieldDuel',
      title: 'Gate Duel',
      summary: 'The player defeated an enemy challenger before the gate.',
      occurredAt: '189-09-01 12:00',
      locationName: 'North Gate',
      participants: [
        { name: 'Player', side: 'player', participantId: 'player' },
        { name: 'Enemy Champion', side: 'enemy', npcId: 'npc_enemy_champion', reputationFame: 65 },
      ],
      playerInvolved: true,
      resultLevel: 'decisiveWin',
      outcome: 'The challenger died and the line wavered.',
      significance: 'major',
      chronicleWorthy: true,
      briefText: 'A short but decisive duel at the gate changed the nearby fight.',
      updatedAt: '189-09-01 12:05',
    },
    {
      combatId: 'combat_remote_assassination',
      kind: 'assassination',
      title: 'Remote Assassination',
      summary: 'A distant officer was killed in camp.',
      occurredAt: '189-09-01 10:00',
      participants: [
        { name: 'Unknown Assassin', side: 'neutral' },
        { name: 'Distant Officer', side: 'enemy', npcId: 'npc_distant_officer' },
      ],
      playerInvolved: false,
      resultLevel: 'win',
      outcome: 'The officer died.',
      significance: 'notable',
      updatedAt: '189-09-01 10:05',
    },
    {
      combatId: 'combat_minor_brawl',
      kind: 'melee',
      title: 'Camp Brawl',
      summary: 'Two soldiers fought in camp.',
      occurredAt: '189-09-01 09:00',
      participants: [
        { name: 'Soldier A', side: 'neutral' },
        { name: 'Soldier B', side: 'neutral' },
      ],
      playerInvolved: false,
      resultLevel: 'stalemate',
      outcome: 'Both were separated.',
      significance: 'minor',
      updatedAt: '189-09-01 09:05',
    },
  ],
} as unknown as RuntimeState;

describe('combatPanelModel', () => {
  it('groups player-related combat apart from notable and other personal fights', () => {
    const model = buildCombatPanelModel(baseRuntimeState, 'playerRelated', 'combat_gate_duel');

    expect(model.tabs).toEqual([
      { key: 'playerRelated', label: '亲历/相关', count: 1 },
      { key: 'notable', label: '值得记录', count: 1 },
      { key: 'other', label: '其他', count: 1 },
    ]);
    expect(model.listItems).toEqual([{
      combatId: 'combat_gate_duel',
      title: 'Gate Duel',
      occurredAt: '189-09-01 12:00',
      resultText: '大胜',
      importanceText: '重大',
    }]);
    expect(model.selectedCombat?.briefText).toContain('decisive duel');
  });

  it('falls back to the first item in the active combat tab', () => {
    const model = buildCombatPanelModel(baseRuntimeState, 'notable', 'missing_combat');

    expect(model.selectedCombatId).toBe('combat_remote_assassination');
    expect(model.listItems[0]).toMatchObject({
      occurredAt: '189-09-01 10:00',
      importanceText: '值得记录',
    });
  });

  it('renders the combat entry and panel separately from battle records in GameScreen', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');

    // panels are now generated from a config array; verify presence in the config
    expect(source).toContain("panel: 'combats'");
    expect(source).toContain('data-testid="combat-panel"');
    expect(source).toContain('archive-record-list');
    expect(source).toContain('openCombatReport');
    expect(source).toContain('combat-report-detail');
    expect(source).toContain('buildCombatBriefingCard');
    expect(source).toContain('activeCombatArchiveBriefing');
    expect(source).toContain('activeCombatReport.reportText');
    expect(source).toContain('sanitizeCombatReportText');
    expect(source).toContain('<BattleBriefingVisual');
    expect(source).toContain('label="个人战记录"');
    expect(source).toContain('setActiveSystemPanel(');
    expect(source).toContain('buildCombatPanelModel');
  });

  it('does not expose enum-like personal combat values in archive list rows', () => {
    const model = buildCombatPanelModel({
      combatRecords: [
        {
          ...baseRuntimeState.combatRecords![0],
          combatId: 'combat_enum_leak',
          kind: 'solo_trial',
          resultLevel: 'clean_success',
          significance: 'story_flag',
        },
      ],
    } as unknown as RuntimeState, 'playerRelated', 'combat_enum_leak');

    const visibleText = JSON.stringify(model.listItems);

    expect(model.listItems[0]).toMatchObject({
      resultText: '结果未明',
      importanceText: '重要度未明',
    });
    expect(visibleText).not.toContain('solo_trial');
    expect(visibleText).not.toContain('clean_success');
    expect(visibleText).not.toContain('story_flag');
    expect(visibleText).not.toContain('A short but decisive duel at the gate changed the nearby fight.');
    expect(visibleText).not.toContain('The challenger died and the line wavered.');
  });

  it('uses safe personal combat labels for report detail rows in GameScreen', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');

    expect(formatCombatKind('solo_trial')).toBe('其他');
    expect(formatCombatResult('clean_success')).toBe('结果未明');
    expect(formatCombatSignificance('story_flag')).toBe('重要度未明');
    expect(source).toContain("['类型', formatCombatKind(combat.kind)]");
    expect(source).toContain("['结果等级', formatCombatResult(combat.resultLevel)]");
    expect(source).toContain("['重要度', formatCombatSignificance(combat.significance)]");
  });
});
