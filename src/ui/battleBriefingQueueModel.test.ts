import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import {
  buildBattleBriefingCards,
  buildCombatBriefingCard,
  buildConflictBriefingCard,
  diffBattleBriefingCards,
} from './battleBriefingQueueModel';
import { readUiStyleSource } from './readUiStyleSource.test-helper';

const baseState = {
  conflicts: [
    {
      conflictId: 'battle_old',
      type: 'war',
      title: 'Old Battle',
      summary: 'Old self-related battle summary.',
      occurredAt: '189-09-01 08:00',
      outcome: 'Old outcome.',
      scope: 'selfRelated',
      recordLevel: 'full',
      locationName: 'Old Field',
      reportText: 'Old battle report.',
      resultTags: ['breakout'],
      updatedAt: '189-09-01 08:10',
    },
    {
      conflictId: 'battle_remote_brief',
      type: 'war',
      title: 'Remote Skirmish',
      summary: 'A distant clash the player only heard about.',
      occurredAt: '189-09-01 07:00',
      outcome: 'The distant side withdrew.',
      scope: 'other',
      recordLevel: 'brief',
      updatedAt: '189-09-01 07:10',
    },
  ],
  combatRecords: [
    {
      combatId: 'combat_old',
      kind: 'duel',
      title: 'Old Duel',
      summary: 'Old duel summary.',
      occurredAt: '189-09-01 08:30',
      locationName: 'Old Gate',
      participants: [{ name: 'Player', side: 'player', participantId: 'player' }],
      playerInvolved: true,
      resultLevel: 'win',
      outcome: 'The player won.',
      significance: 'notable',
      briefText: 'Old duel briefing.',
      reportText: 'Old duel report text with the whole exchange.',
      visualTags: ['gate'],
      updatedAt: '189-09-01 08:35',
    },
    {
      combatId: 'combat_minor_remote',
      kind: 'melee',
      title: 'Minor Remote Brawl',
      summary: 'Minor background fighting.',
      occurredAt: '189-09-01 08:20',
      participants: [{ name: 'Soldier', side: 'neutral' }],
      playerInvolved: false,
      resultLevel: 'stalemate',
      outcome: 'No meaningful result.',
      significance: 'minor',
      updatedAt: '189-09-01 08:25',
    },
  ],
} as unknown as RuntimeState;

describe('battleBriefingQueueModel', () => {
  it('builds briefing cards for full battle records and meaningful combat records', () => {
    const cards = buildBattleBriefingCards(baseState);

    expect(cards.map((card) => card.key)).toEqual(['battle:battle_old', 'combat:combat_old']);
    expect(cards[0]).toEqual(expect.objectContaining({
      kind: 'battle',
      recordId: 'battle_old',
      title: 'Old Battle',
      summary: 'Old battle report.',
      openPanel: 'battles',
      selectedId: 'battle_old',
      panelTab: 'selfRelated',
      visualTags: ['breakout'],
    }));
    expect(cards[1]).toEqual(expect.objectContaining({
      kind: 'combat',
      recordId: 'combat_old',
      title: 'Old Duel',
      summary: 'Old duel report text with the whole exchange.',
      openPanel: 'combats',
      selectedId: 'combat_old',
      panelTab: 'playerRelated',
      visualTags: ['gate'],
    }));
  });

  it('diffs only newly created briefing records', () => {
    const nextState = {
      ...baseState,
      conflicts: [
        ...(baseState.conflicts ?? []),
        {
          conflictId: 'battle_new',
          type: 'ambush',
          title: 'New Ambush',
          summary: 'The player force ambushed an enemy column.',
          occurredAt: '189-09-01 09:00',
          outcome: 'The enemy column broke.',
          scope: 'selfRelated',
          recordLevel: 'full',
          locationName: 'West Road',
          reportText: 'New battle briefing text.',
          updatedAt: '189-09-01 09:10',
        },
      ],
      combatRecords: [
        ...(baseState.combatRecords ?? []),
        {
          combatId: 'combat_new',
          kind: 'battlefieldDuel',
          title: 'New Gate Duel',
          summary: 'An allied champion cut down a famous officer.',
          occurredAt: '189-09-01 09:15',
          locationName: 'West Gate',
          participants: [
            { name: 'Allied Champion', side: 'ally', npcId: 'npc_ally' },
            { name: 'Famous Officer', side: 'enemy', npcId: 'npc_enemy', reputationFame: 70 },
          ],
          playerInvolved: false,
          resultLevel: 'decisiveWin',
          outcome: 'The famous officer was slain.',
          significance: 'major',
          chronicleWorthy: true,
          briefText: 'New combat briefing text.',
          reportText: 'New combat report text that describes the full exchange.',
          updatedAt: '189-09-01 09:20',
        },
      ],
    } as unknown as RuntimeState;

    const cards = diffBattleBriefingCards(baseState, nextState);

    expect(cards.map((card) => card.key)).toEqual(['battle:battle_new', 'combat:combat_new']);
    expect(cards[0].summary).toBe('New battle briefing text.');
    expect(cards[1].summary).toBe('New combat report text that describes the full exchange.');
  });

  it('builds the same visual briefing card from an archived combat record', () => {
    const combat = baseState.combatRecords![0];
    const card = buildCombatBriefingCard(combat);

    expect(card).toEqual(expect.objectContaining({
      key: 'combat:combat_old',
      kind: 'combat',
      recordId: 'combat_old',
      summary: 'Old duel report text with the whole exchange.',
      selectedId: 'combat_old',
      openPanel: 'combats',
      visualTags: ['gate'],
    }));
  });

  it('builds the same animated visual briefing card from an archived war record', () => {
    const conflict = baseState.conflicts![0];
    const card = buildConflictBriefingCard(conflict);

    expect(card).toEqual(expect.objectContaining({
      key: 'battle:battle_old',
      kind: 'battle',
      recordId: 'battle_old',
      summary: 'Old battle report.',
      selectedId: 'battle_old',
      openPanel: 'battles',
      visualTags: ['breakout'],
    }));
  });

  it('uses summary fallback but does not pop brief remote battle records or minor remote combats', () => {
    const state = {
      conflicts: [
        {
          conflictId: 'battle_full_without_report',
          type: 'war',
          title: 'Full Battle Without Report',
          summary: 'Fallback battle summary.',
          occurredAt: '189-09-01 10:00',
          outcome: 'Fallback outcome.',
          scope: 'selfRelated',
          recordLevel: 'full',
          updatedAt: '189-09-01 10:05',
        },
        {
          conflictId: 'battle_brief_other',
          type: 'war',
          title: 'Brief Other Battle',
          summary: 'Should stay in archives only.',
          occurredAt: '189-09-01 10:10',
          outcome: 'Other outcome.',
          scope: 'other',
          recordLevel: 'brief',
          updatedAt: '189-09-01 10:15',
        },
      ],
      combatRecords: [
        {
          combatId: 'combat_minor_remote',
          kind: 'melee',
          title: 'Minor Remote Fight',
          summary: 'Should stay in archives only.',
          occurredAt: '189-09-01 10:20',
          participants: [{ name: 'Soldier', side: 'neutral' }],
          playerInvolved: false,
          resultLevel: 'stalemate',
          outcome: 'Minor outcome.',
          significance: 'minor',
          updatedAt: '189-09-01 10:25',
        },
      ],
    } as unknown as RuntimeState;

    const cards = buildBattleBriefingCards(state);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual(expect.objectContaining({
      key: 'battle:battle_full_without_report',
      summary: 'Fallback battle summary.',
    }));
    expect(buildConflictBriefingCard(state.conflicts![1])).toEqual(expect.objectContaining({
      key: 'battle:battle_brief_other',
      summary: 'Should stay in archives only.',
    }));
  });

  it('ignores malformed briefing fields from live writeback instead of throwing after a successful turn', () => {
    const previousState = {
      conflicts: [],
      combatRecords: [],
    } as unknown as RuntimeState;
    const nextState = {
      conflicts: [
        {
          conflictId: 'battle_drifted',
          type: 'war',
          title: '',
          summary: '  Drifted battle summary.  ',
          occurredAt: '189-09-01 11:00',
          outcome: 'Battle outcome.',
          scope: 'selfRelated',
          recordLevel: 'full',
          resultTags: ['ambush', undefined, 7],
          decisiveFactors: [null, 'night'],
          updatedAt: 18909011105,
        },
        {
          conflictId: undefined,
          type: 'war',
          title: 'Missing ID Battle',
          summary: 'Should be skipped because the archive target is unstable.',
          occurredAt: '189-09-01 11:10',
          outcome: 'Skipped.',
          scope: 'selfRelated',
          recordLevel: 'full',
        },
      ],
      combatRecords: [
        {
          combatId: 'combat_drifted',
          kind: 'duel',
          title: '',
          summary: '  Drifted combat summary.  ',
          occurredAt: '189-09-01 11:20',
          participants: undefined,
          playerInvolved: true,
          resultLevel: 'win',
          outcome: 'Combat outcome.',
          significance: 'major',
          visualTags: ['gate', undefined],
          outcomeTags: [false, 'wounded'],
          updatedAt: null,
        },
      ],
    } as unknown as RuntimeState;

    const cards = diffBattleBriefingCards(previousState, nextState);

    expect(cards.map((card) => card.key)).toEqual(['battle:battle_drifted', 'combat:combat_drifted']);
    expect(cards[0]).toEqual(expect.objectContaining({
      title: '战事记录',
      summary: 'Drifted battle summary.',
      visualTags: ['ambush', 'night'],
    }));
    expect(cards[1]).toEqual(expect.objectContaining({
      title: '战斗记录',
      summary: 'Drifted combat summary.',
      panelTab: 'playerRelated',
      visualTags: ['gate', 'wounded'],
    }));
  });

  it('wires the post-turn briefing queue into GameScreen', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');
    const visualSource = readFileSync(new URL('./BattleBriefingVisual.tsx', import.meta.url), 'utf8');
    const css = await readUiStyleSource();

    expect(source).toContain('diffBattleBriefingCards');
    expect(source).toContain('setBattleBriefingQueue');
    expect(source).toContain('data-testid="battle-briefing-modal"');
    expect(source).toContain('openBattleBriefingArchive');
    expect(source).toContain('BattleBriefingVisual');
    expect(visualSource).toContain('resolveBattleBriefingVisualAssets');
    expect(visualSource).toContain('battle-briefing-visual-enemy');
    expect(visualSource).toContain('battle-briefing-visual-player');
    expect(visualSource).toContain('visualEffectStateClassNames');
    expect(visualSource).toContain('battle-briefing-has-effect--');
    expect(visualSource).toContain('battle-briefing-effect-layer');
    expect(source).toContain('battle-report-card');
    expect(source).toContain('battle-report-body');
    expect(source).toContain('battle-briefing-summary battle-report-body');
    expect(source).toContain('battle-report-meta');
    expect(css).toMatch(/\.system-modal-backdrop\s*\{[\s\S]*position:\s*fixed/);
    expect(css).toMatch(/\.battle-report-body\s*\{[\s\S]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.battle-briefing-modal\s*\{[\s\S]*width:\s*min\(1100px,\s*94vw\)/);
    expect(css).toMatch(/\.battle-briefing-visual\s*\{[\s\S]*aspect-ratio:\s*16\s*\/\s*9/);
    expect(css).toContain('.battle-briefing-effect.battle-briefing-effect--fire');
    expect(css).toContain('.battle-briefing-effect.battle-briefing-effect--arrows');
    expect(css).toContain('@keyframes battleWarSceneDrift');
    expect(css).toContain('@keyframes battleWarForceSurge');
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(source).toMatch(/activeSystemPanel\s*\?\s*null\s*:\s*battleBriefingQueue\[0\]/);
    expect(source).toMatch(/dismissBattleBriefing\(\);\s*window\.setTimeout\(\(\) => \{/);
  });
});
