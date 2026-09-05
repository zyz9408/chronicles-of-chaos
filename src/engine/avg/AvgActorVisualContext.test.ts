import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { collectAvgCurrentActors, getAvgActorVisualContext, resolveAvgDialogueActor } from './AvgActorVisualContext';

const state = {
  worldBookId: 'threeKingdoms', currentDate: '公元184年03月01日',
  player: { id: 'player', name: '彭亮', sex: '男', age: 18, roleType: '流亡者' },
  knownActors: [{ id: 'guan-yu', name: '关羽', sex: '男', age: 25, roleType: '武将' }],
  npcs: [{ npcId: 'soldier', name: '差役甲', sex: '男', age: 30, role: '差役', isPresent: true, isFocused: false }],
  avgPresentation: { speakerActors: [{ actorId: 'avg-presentation:elder', labels: ['卖饼老翁'], profileSnapshot: { sex: 'male', ageBand: 'elderly', roleFamily: '商贩' } }] },
} as unknown as RuntimeState;

describe('AVG character generation targets', () => {
  it('keeps present NPCs selectable even with an empty visual snapshot', () => {
    expect(collectAvgCurrentActors(state, undefined, { presentActorIds: [] } as never).map((actor) => actor.actorId)).toContain('soldier');
  });
  it('creates stable local identities for unregistered speakers, not the player', () => {
    const before = JSON.stringify(state);
    const first = resolveAvgDialogueActor(state, '城头守卒', undefined, '襄阳城门')!;
    expect(first.name).toBe('城头守卒');
    expect(first.actorId).not.toBe('player');
    expect(first.portraitProfile).toMatchObject({ sex: 'male', ageBand: 'adult', roleFamily: '军士' });
    expect(resolveAvgDialogueActor(state, '城头守卒', undefined, '襄阳城门')?.actorId).toBe(first.actorId);
    expect(resolveAvgDialogueActor(state, '城头守卒', undefined, '洛阳城门')?.actorId).not.toBe(first.actorId);
    expect(resolveAvgDialogueActor(state, '守卒乙', undefined, '襄阳城门')?.actorId).not.toBe(first.actorId);
    expect(resolveAvgDialogueActor(state, '差役甲')?.actorId).toBe('soldier');
    expect(resolveAvgDialogueActor(state, '众人')).toBeUndefined();
    expect(resolveAvgDialogueActor({ ...state, npcs: [...state.npcs!, { ...state.npcs![0], npcId: 'second' }] }, '差役甲')).toBeUndefined();
    expect(resolveAvgDialogueActor(state, '少年守卒')?.prompt.safetyMode).toBe('non-adult-actor');
    expect(JSON.stringify(state)).toBe(before);
  });
  it('retains a supplied presentation identity even before the actor registry is populated', () => {
    const displayMeta = { presentationSpeakerFacts: [{ speakerActorId: 'avg-presentation:guard', speakerLabel: '城头守卒', sex: 'male', ageBand: 'adult', roleFamily: '军士' }] } as never;
    expect(getAvgActorVisualContext(state, 'avg-presentation:guard', displayMeta)?.name).toBe('城头守卒');
    expect(resolveAvgDialogueActor(state, '城头守卒', displayMeta)?.actorId).toBe('avg-presentation:guard');
  });
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
