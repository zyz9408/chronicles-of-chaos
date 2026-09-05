import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { freezeAvgSpeakerBindings } from './AvgSpeakerBinding';

function makeState(): RuntimeState {
  return {
    engineVersion: '1', worldBookId: 'threeKingdoms', worldBookVersion: '1', worldBookSource: 'official',
    startDate: '公元189年01月01日', currentDate: '公元189年01月01日', currentLocationId: 'loc',
    player: { id: 'player', name: '刘构', sex: '男', roleType: 'player', summary: '' },
    knownActors: [{ id: 'known_dianwei', name: '典韦', sex: '男', roleType: 'warrior', summary: '' }],
    npcs: [{
      npcId: 'npc_zhaoyun', name: '赵云', courtesyName: '子龙', sex: '男', age: 21, role: '将领',
      isPresent: true, isFocused: true, summary: '', appearance: '', personality: '', motivation: '',
      relationToPlayer: '', contactLevel: 1, recentAttitude: '', memories: [],
    }],
    knownFactions: [], relationships: [], knownRumors: [], activeQuests: [], playerResources: {},
    worldStateDelta: {}, turnLog: [], localSituationNotes: [],
  };
}

describe('freezeAvgSpeakerBindings', () => {
  it('binds stable player, NPC and known-actor identities without guessing generic speakers', () => {
    const result = freezeAvgSpeakerBindings([
      '【你】传令。',
      '【子龙】末将在。',
      '【典韦】领命。',
      '【士兵】敌军来了。',
    ].join('\n'), makeState());

    expect(result.bindings.map((binding) => [binding.label, binding.actorId, binding.status])).toEqual([
      ['你', 'player', 'frozen'],
      ['子龙', 'npc_zhaoyun', 'frozen'],
      ['典韦', 'known_dianwei', 'frozen'],
      ['士兵', undefined, 'unbound'],
    ]);
  });

  it('preserves a frozen identity when a later fact is omitted', () => {
    const result = freezeAvgSpeakerBindings('【赵云】末将在。', makeState(), [], [{
      segmentIndex: 0,
      label: '赵云',
      actorId: 'npc_zhaoyun',
      identityKind: 'npc',
      status: 'frozen',
      diagnosticCode: 'frozen-speaker',
    }]);
    expect(result.bindings[0]).toMatchObject({ status: 'frozen', actorId: 'npc_zhaoyun' });
  });

  it('does not trust a fact whose label and final segment disagree', () => {
    const result = freezeAvgSpeakerBindings('【陌生客】借一步说话。', makeState(), [{
      segmentIndex: 0,
      speakerActorId: 'npc_zhaoyun',
      speakerLabel: '赵云',
      identitySource: 'full_npc',
      sex: 'male',
    }]);
    expect(result.bindings[0]?.status).toBe('unbound');
    expect(result.bindings[0]?.actorId).toBeUndefined();
  });

  it('ignores incomplete legacy bindings without crashing or guessing an identity', () => {
    const result = freezeAvgSpeakerBindings('【陌生客】借一步说话。', makeState(), [{
      segmentIndex: 0, speakerActorId: 'npc_zhaoyun',
    } as never], [{
      segmentIndex: 0, status: 'frozen', actorId: 'npc_zhaoyun',
    } as never]);
    expect(result.bindings[0]).toMatchObject({ label: '陌生客', status: 'unbound' });
    expect(result.bindings[0].actorId).toBeUndefined();
  });
});
