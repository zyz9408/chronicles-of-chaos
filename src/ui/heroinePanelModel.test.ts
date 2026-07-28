import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { buildHeroinePanelModel } from './heroinePanelModel';

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
      currentPull: '担忧主角卷入宫门风波。',
      riskNotes: '外戚与宦官交争会牵连二人。',
      promiseNotes: '主角承诺护她离开险地。',
      recentProgress: '通过密信再次确认彼此立场。',
      tags: ['宫闱', '信任'],
      milestones: [
        {
          milestoneId: 'm1',
          happenedAt: '公元189年09月01日 10:00（巳时）',
          summary: '第一次私下交换信物。',
          source: '正文',
        },
      ],
      lastUpdatedAt: '公元189年09月01日 12:00（午时）',
      source: '结构化写回',
    },
    {
      heroineThreadId: 'heroine_cai',
      npcId: 'npc_cai',
      npcName: '蔡氏',
      status: 'paused',
      stage: '旧识',
      relationshipRole: '旧日牵挂',
      summary: '旧年同游留下未了牵挂。',
      lastUpdatedAt: '公元189年08月29日 12:00（午时）',
    },
  ],
  bondThreads: [
    {
      bondThreadId: 'bond_sworn',
      targetNames: ['陈达'],
      bondType: 'sworn',
      status: 'active',
      summary: '共患难后约为兄弟。',
      lastUpdatedAt: '公元189年09月01日 12:00（午时）',
    },
  ],
} as unknown as RuntimeState;

describe('heroinePanelModel', () => {
  it('builds heroine roster from heroineThreads only', () => {
    const model = buildHeroinePanelModel(runtimeState, 'heroine_he');

    expect(model.rosterItems).toHaveLength(2);
    expect(model.rosterItems.map((item) => item.id)).toEqual(['heroine_he', 'heroine_cai']);
    expect(model.rosterItems.map((item) => item.name)).not.toContain('陈达');
    expect(model.selectedThread?.npcName).toBe('何氏');
    expect(model.selectedThread?.milestones?.[0]?.summary).toBe('第一次私下交换信物。');
  });

  it('falls back to the most recently active heroine thread', () => {
    const model = buildHeroinePanelModel(runtimeState, 'missing');

    expect(model.selectedThreadId).toBe('heroine_he');
    expect(model.selectedThread?.currentPull).toContain('宫门风波');
  });

  it('defensively presents one roster item per npcId for a loaded legacy state', () => {
    const duplicateState = {
      ...runtimeState,
      heroineThreads: [
        ...runtimeState.heroineThreads!,
        {
          ...runtimeState.heroineThreads![0],
          heroineThreadId: 'thread_heroine_he',
          stage: '死心相托',
          summary: '同一人物被旧写回误建的新线程。',
          lastUpdatedAt: '公元189年09月02日 12:00（午时）',
        },
      ],
    } as RuntimeState;
    const model = buildHeroinePanelModel(duplicateState, 'thread_heroine_he');

    expect(model.rosterItems).toHaveLength(2);
    expect(model.rosterItems.filter((item) => item.npcId === 'npc_he')).toHaveLength(1);
    expect(model.selectedThreadId).toBe('heroine_he');
    expect(model.selectedThread).toMatchObject({
      heroineThreadId: 'heroine_he',
      stage: '死心相托',
      summary: '同一人物被旧写回误建的新线程。',
    });
  });
});
