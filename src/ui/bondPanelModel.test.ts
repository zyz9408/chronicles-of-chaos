import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { buildBondPanelModel } from './bondPanelModel';

const runtimeState = {
  heroineThreads: [
    {
      heroineThreadId: 'heroine_he',
      npcId: 'npc_he',
      npcName: '何氏',
      status: 'active',
      stage: '信任初成',
      relationshipRole: '红颜知己',
      summary: '在洛阳乱局中与主角建立私下信任。',
      lastUpdatedAt: '公元189年09月01日 12:00（午时）',
    },
  ],
  bondThreads: [
    {
      bondThreadId: 'bond_chen',
      targetNpcIds: ['npc_chen'],
      targetNames: ['陈达'],
      bondType: 'sworn',
      status: 'active',
      summary: '共患难后约为兄弟。',
      currentTension: '陈达希望主角尽快救出旧部。',
      promiseNotes: '主角许诺分粮安置。',
      recentProgress: '并肩夺粮后信任加深。',
      tags: ['结义', '旧部'],
      milestones: [
        {
          milestoneId: 'm1',
          happenedAt: '公元189年09月01日 11:00（午时）',
          summary: '共同夺回粮车。',
        },
      ],
      lastUpdatedAt: '公元189年09月01日 12:00（午时）',
    },
    {
      bondThreadId: 'bond_yuan',
      targetNames: ['袁绍'],
      bondType: 'rival',
      status: 'paused',
      summary: '宫门旧事留下政治猜忌。',
      conflictNotes: '袁氏门生怀疑主角另有依附。',
      lastUpdatedAt: '公元189年08月29日 10:00（巳时）',
    },
  ],
} as unknown as RuntimeState;

describe('bondPanelModel', () => {
  it('builds a non-heroine bond roster from bondThreads only', () => {
    const model = buildBondPanelModel(runtimeState, 'bond_chen');

    expect(model.rosterItems).toHaveLength(2);
    expect(model.rosterItems.map((item) => item.id)).toEqual(['bond_chen', 'bond_yuan']);
    expect(model.rosterItems.map((item) => item.title)).not.toContain('何氏');
    expect(model.selectedThread?.bondType).toBe('sworn');
    expect(model.selectedThread?.milestones?.[0]?.summary).toBe('共同夺回粮车。');
  });

  it('falls back to the most recent active bond thread', () => {
    const model = buildBondPanelModel(runtimeState, undefined);

    expect(model.selectedThreadId).toBe('bond_chen');
    expect(model.selectedThread?.summary).toContain('约为兄弟');
  });
});
