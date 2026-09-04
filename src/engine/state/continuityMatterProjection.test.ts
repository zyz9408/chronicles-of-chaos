import { describe, expect, it } from 'vitest';
import type { Quest } from '../types';
import {
  buildContinuityMatterProjection,
  CONTINUITY_MATTER_PROJECTION_LIMITS,
} from './continuityMatterProjection';

function matter(overrides: Partial<Quest> = {}): Quest {
  return {
    id: 'matter_supply',
    title: '按月供应北营军粮',
    description: '上级承担北营军需。',
    status: 'active',
    priority: 'medium',
    consequenceTags: ['continuity:external_supply'],
    createdAt: '公元194年05月01日 08:00',
    updatedAt: '公元194年05月02日 08:00',
    ...overrides,
  };
}

describe('buildContinuityMatterProjection', () => {
  it('projects tagged open matters independently of ordinary relevance', () => {
    const projection = buildContinuityMatterProjection([
      matter({
        giverId: 'npc_governor',
        relatedNpcIds: ['npc_quartermaster'],
        affectedNpcIds: ['npc_governor'],
        relatedFactionIds: ['faction_han'],
        affectedFactionIds: ['faction_han'],
        affectedForceIds: ['troop_north'],
        affectedHoldingIds: ['holding_granary'],
        targetLocationId: 'place_north_camp',
        relatedLocationIds: ['place_capital'],
        affectedPlaceIds: ['place_north_camp'],
      }),
      matter({ id: 'ordinary', consequenceTags: ['trade'], title: '普通事项' }),
      matter({ id: 'closed', status: 'completed', title: '已经完成' }),
    ], '公元194年05月03日 08:00');

    expect(projection.entries).toHaveLength(1);
    expect(projection.entries[0]).toMatchObject({
      matterId: 'matter_supply',
      linkedNpcIds: ['npc_governor', 'npc_quartermaster'],
      linkedFactionIds: ['faction_han'],
      linkedTroopIds: ['troop_north'],
      linkedHoldingIds: ['holding_granary'],
      linkedPlaceIds: ['place_capital', 'place_north_camp'],
    });
    expect(projection.text).toContain('持续事项常驻真值');
    expect(projection.text).toContain('troop:troop_north');
  });

  it('orders by priority and deadline state, then applies the fixed item budget', () => {
    const matters = Array.from({ length: 8 }, (_, index) => matter({
      id: `matter_${index}`,
      title: `事项${index}`,
      priority: index === 7 ? 'high' : 'low',
      deadlineAt: index === 6 ? '公元194年05月01日 08:00' : undefined,
      updatedAt: `公元194年05月0${Math.min(index + 1, 9)}日 08:00`,
    }));
    const projection = buildContinuityMatterProjection(matters, '公元194年05月03日 08:00');

    expect(projection.entries).toHaveLength(CONTINUITY_MATTER_PROJECTION_LIMITS.items);
    expect(projection.entries[0].matterId).toBe('matter_7');
    expect(projection.entries[1].matterId).toBe('matter_6');
    expect(projection.omittedCount).toBe(2);
    expect(projection.text).toContain('另有 2 条低优先级持续事项');
  });

  it('caps projected values to the recovered 160 character boundary', () => {
    const projection = buildContinuityMatterProjection([
      matter({ title: `标题${'很长'.repeat(100)}`, currentStep: `步骤${'继续'.repeat(100)}` }),
    ], '公元194年05月03日 08:00');

    expect(projection.entries[0].title.length).toBe(CONTINUITY_MATTER_PROJECTION_LIMITS.valueChars);
    expect(projection.entries[0].currentStep?.length).toBe(CONTINUITY_MATTER_PROJECTION_LIMITS.valueChars);
  });
});
