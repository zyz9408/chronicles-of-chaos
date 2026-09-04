import { describe, expect, it } from 'vitest';
import type { LuanShiNpc, RuntimeState } from '../types';
import { selectNpcRecentActivity } from './NpcRecentActivity';

const npc = {
  npcId: 'npc_cao', name: '曹操', sex: '男', age: 30, role: '将领', isPresent: false, isFocused: false,
  summary: '', appearance: '', personality: '', motivation: '', relationToPlayer: '',
  contactLevel: 1, recentAttitude: '', memories: [],
  presenceUpdates: [{ id: 'news', createdAt: '公元184年04月03日 08:00', kind: 'rumor' as const, summary: '正在整编新军。', source: '来信', readByPlayer: false }],
  backgroundActivity: { activityId: 'activity', summary: '正在整编新军', status: 'active' as const, startedAt: '公元184年04月02日 08:00', visibility: 'public' as const },
} satisfies LuanShiNpc;

const state = {
  turnEvents: [{ eventId: 'event', happenedAt: '公元184年04月04日 08:00', locationId: 'place', summary: '曹操整军后亲自巡营', visibility: '公开' as const, presentNpcIds: ['npc_cao'], involvedNpcIds: [] }],
  heroineThreads: [],
  bondThreads: [{ bondThreadId: 'bond', targetNpcIds: ['npc_cao'], targetNames: ['曹操'], bondType: 'ally' as const, status: 'active' as const, summary: '', recentProgress: '正在整编新军！', milestones: [{ milestoneId: 'm1', happenedAt: '公元184年04月01日 08:00', summary: '首次互通军情' }], lastUpdatedAt: '公元184年04月03日 08:00' }],
} as unknown as RuntimeState;

describe('selectNpcRecentActivity', () => {
  it('merges, orders and punctuation-normalizes duplicate recent activity', () => {
    const entries = selectNpcRecentActivity(state, npc);
    expect(entries.map((entry) => entry.source)).toEqual(['turnEvent', 'relationship', 'relationship']);
    expect(entries.map((entry) => entry.summary)).toEqual(['曹操整军后亲自巡营', '正在整编新军！', '首次互通军情']);
    expect(entries[1].sourceLabel).toBe('羁绊进展');
  });

  it('applies the requested result limit', () => {
    expect(selectNpcRecentActivity(state, npc, 1)).toHaveLength(1);
  });
});
