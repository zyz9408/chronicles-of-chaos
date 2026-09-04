import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { buildAvgSpeakerRepairTargets, materializeAvgSpeakerFacts, mergeAvgSpeakerRepairFacts } from './AvgSpeakerIdentity';

function state(): RuntimeState {
  return {
    player: { id: 'player', name: '刘备', roleType: '君主', sex: '男' },
    knownActors: [{ id: 'guan-yu', name: '关羽', roleType: '武将', sex: '男' }],
    npcs: [], turnLog: [], avgPresentation: {},
  } as unknown as RuntimeState;
}

describe('AVG display-only speaker identity repair', () => {
  it('batches only unresolved explicit named speakers', () => {
    const targets = buildAvgSpeakerRepairTargets(state(), '【关羽】在。\n【女掌柜阿月】客官慢走。\n【众人】遵命。', [{ segmentIndex: 0, speakerActorId: 'guan-yu', speakerLabel: '关羽', identitySource: 'known_actor', sex: 'male' }]);
    expect(targets).toEqual([{ segmentIndex: 1, speakerLabel: '女掌柜阿月', occurrence: 0 }]);
  });

  it('accepts only in-scope presentation-only repair facts and persists them outside world facts', () => {
    const source = state();
    const narrative = '【关羽】在。\n【女掌柜阿月】客官慢走。';
    const targets = buildAvgSpeakerRepairTargets(source, narrative, []);
    const facts = mergeAvgSpeakerRepairFacts(source, narrative, [], [
      { segmentIndex: 1, speakerActorId: 'avg-presentation:innkeeper-a-yue', speakerLabel: '女掌柜阿月', identitySource: 'presentation_only', sex: 'female', roleFamily: 'merchant' },
      { segmentIndex: 0, speakerActorId: 'avg-presentation:fake-guan-yu', speakerLabel: '关羽', identitySource: 'presentation_only', sex: 'male' },
    ], targets);
    expect(facts).toHaveLength(1);
    source.turnLog.push({ turnNumber: 1, date: '', playerInput: '', narrativeText: narrative, statePatchSummary: '', timestamp: '' });
    const persisted = materializeAvgSpeakerFacts(source, 1, facts);
    expect(persisted.avgPresentation?.speakerActors?.[0]).toMatchObject({ actorId: 'avg-presentation:innkeeper-a-yue', labels: ['女掌柜阿月'] });
    expect(persisted.npcs).toEqual([]);
  });
});
