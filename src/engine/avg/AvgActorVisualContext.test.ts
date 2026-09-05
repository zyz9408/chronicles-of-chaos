import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { collectAvgCurrentActors, getAvgActorVisualContext } from './AvgActorVisualContext';

const state = {
  worldBookId: 'threeKingdoms', currentDate: '公元184年03月01日',
  player: { id: 'player', name: '彭亮', sex: '男', age: 18, roleType: '流亡者' },
  knownActors: [{ id: 'guan-yu', name: '关羽', sex: '男', age: 25, roleType: '武将' }],
  npcs: [{ npcId: 'soldier', name: '差役甲', sex: '男', age: 30, role: '差役', isPresent: true, isFocused: false }],
  avgPresentation: { speakerActors: [{ actorId: 'avg-presentation:elder', labels: ['卖饼老翁'], profileSnapshot: { sex: 'male', ageBand: 'elderly', roleFamily: '商贩' } }] },
} as unknown as RuntimeState;

describe('AVG character generation targets', () => {
  it('protects the player, historical figures and focused characters from generic reuse', () => {
    expect(getAvgActorVisualContext(state, 'player')?.dedicated).toBe(true);
    expect(getAvgActorVisualContext(state, 'guan-yu')?.dedicated).toBe(true);
    expect(getAvgActorVisualContext(state, 'soldier')?.dedicated).toBe(false);
    expect(getAvgActorVisualContext({ ...state, npcs: [{ ...state.npcs![0], isFocused: true }] }, 'soldier')?.dedicated).toBe(true);
  });
  it('supports narration and presentation-only actors using saved facts', () => {
    expect(collectAvgCurrentActors(state).map((actor) => actor.actorId)).toEqual(['soldier', 'player']);
    const elder = getAvgActorVisualContext(state, 'avg-presentation:elder');
    expect(elder?.portraitProfile).toMatchObject({ sex: 'male', ageBand: 'elderly', roleFamily: '商贩' });
    expect(elder?.prompt.draft).toContain('男性');
    expect(elder?.prompt.draft).toContain('年长');
    expect(getAvgActorVisualContext(state, 'unknown')).toBeUndefined();
  });
});
