import { describe, expect, it } from 'vitest';
import type { MemoryArchive, RuntimeState } from '../engine/types';
import { sidePanelButtons } from './GameScreen';
import {
  buildMemoryRecallDiagnosticModel,
  buildPlayerMemoryTabs,
  resolveInitialMemoryTabKey,
} from './MemoryPanel';
import { buildPlayerProfilePanelModel } from './playerProfilePanelModel';

describe('memory panel integration', () => {
  it('places the independent 回忆 entry at the very bottom of the right-side system menu', () => {
    expect(sidePanelButtons[sidePanelButtons.length - 1]).toMatchObject({
      panel: 'memories',
      label: '回忆',
      tone: 'self',
    });
  });

  it('includes retained long-term life summaries in the memory view model', () => {
    const player = {
      id: 'player',
      name: '刘平',
      roleType: '游侠',
      summary: '测试主角',
    } as RuntimeState['player'];
    const archive = {
      recentTurnSummaries: [],
      midTermSummaries: [],
      longTermStorySummaries: [{
        summaryId: 'life_1',
        title: '荆州早年',
        fromCreatedAt: '公元189年',
        toCreatedAt: '公元191年',
        summary: '刘平在荆州建立了最初的人脉与承诺。',
        sourceMidTermSummaryIds: Array.from({ length: 10 }, (_, index) => `mid_${index + 1}`),
        updatedAt: '公元191年',
      }],
      longTermFacts: [],
      npcInteractionSummaries: [],
      npcMidTermSummaries: [],
      npcLongTermSummaries: [],
      locationMemorySummaries: [],
      settings: {} as MemoryArchive['settings'],
    } satisfies MemoryArchive;

    const model = buildPlayerProfilePanelModel(player, archive);
    expect(model.memorySections.find((section) => section.title === '长期生平')?.rows[0])
      .toMatchObject({ label: '荆州早年', value: '刘平在荆州建立了最初的人脉与承诺。' });
  });

  it('groups player memories into short, mid and long tabs with row counts', () => {
    const tabs = buildPlayerMemoryTabs([
      { title: '过往概括', rows: [{ label: '履历摘要', value: '旧事概括' }] },
      { title: '近期记忆', rows: [{ label: '近期', value: '刚刚发生的事' }] },
      {
        title: '每回合摘要',
        rows: [
          { label: '回合2', value: '第二回合' },
          { label: '回合1', value: '第一回合' },
        ],
      },
      { title: '关键事迹', rows: [{ label: '公元184年', value: '救下乡民' }] },
      { title: '中期摘要', rows: [{ label: '初到颍川', value: '立足阳翟' }] },
      { title: '长期生平', rows: [{ label: '颍川早年', value: '建立人脉' }] },
      { title: '长期事实', rows: [{ label: '承诺｜重要', value: '照看伤者' }] },
    ]);

    expect(tabs.map(({ key, label, rowCount }) => ({ key, label, rowCount }))).toEqual([
      { key: 'short', label: '短期记忆', rowCount: 3 },
      { key: 'mid', label: '中期记忆', rowCount: 1 },
      { key: 'long', label: '长期记忆', rowCount: 4 },
    ]);
    expect(tabs[0].sections.map((section) => section.title)).toEqual(['近期记忆', '每回合摘要']);
    expect(tabs[1].sections.map((section) => section.title)).toEqual(['中期摘要']);
    expect(tabs[2].sections.map((section) => section.title)).toEqual(['过往概括', '长期生平', '关键事迹', '长期事实']);
  });

  it('opens the first non-empty memory layer instead of showing a blank tab', () => {
    const tabs = buildPlayerMemoryTabs([
      { title: '长期事实', rows: [{ label: '身份｜关键', value: '刘氏宗亲' }] },
    ]);

    expect(resolveInitialMemoryTabKey(tabs)).toBe('long');
  });

  it('builds an optional current-turn recall diagnostic without changing the three memory tabs', () => {
    expect(buildMemoryRecallDiagnosticModel()).toBeNull();

    const diagnostic = buildMemoryRecallDiagnosticModel({
      query: '继续履行北门护送约定',
      candidateCount: 8,
      omittedCount: 5,
      strong: [{
        strength: 'strong',
        sourceType: 'recentTurn',
        sourceId: 'recent_7',
        text: '第七回合完整原文',
        score: 0.91,
        reason: '关键词与向量共同命中',
        contentMode: 'original',
        sourceTurnNumber: 7,
      }],
      weak: [{
        strength: 'weak',
        sourceType: 'longTermFact',
        sourceId: 'fact_1',
        text: '护送约定仍有效',
        score: 0.34,
        reason: '场景关联',
        contentMode: 'summary',
      }],
    });

    expect(diagnostic).toMatchObject({ candidateCount: 8, omittedCount: 5 });
    expect(diagnostic?.strong[0]).toMatchObject({ contentMode: 'original', sourceTurnNumber: 7 });
    expect(diagnostic?.weak[0]).toMatchObject({ contentMode: 'summary' });
  });
});
