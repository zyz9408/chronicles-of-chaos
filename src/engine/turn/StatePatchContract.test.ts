import { describe, expect, it } from 'vitest';
import type { StatePatch } from '../types';
import { matchesRecoverableStatePatchBusinessIdentity } from './StatePatchContract';

function relationshipPatch(payload: Record<string, unknown>): StatePatch {
  return {
    type: 'relationshipChange',
    payload,
    reason: 'Repair one relationship slot.',
  };
}

describe('recoverable relationshipChange business identity', () => {
  it.each(['actor', 'faction'] as const)(
    'does not let repair choose %s when the original patch has no kind hint',
    (chosenKind) => {
      const original = relationshipPatch({
        actorId: 'actor_source',
        targetId: 'target_unknown_kind',
        value: 'bad',
      });
      const repaired = relationshipPatch({
        actorId: 'actor_source',
        targetId: 'target_unknown_kind',
        targetKind: chosenKind,
        value: 10,
      });

      expect(matchesRecoverableStatePatchBusinessIdentity(original, repaired)).toBe(false);
    },
  );

  it.each([
    {
      label: 'targetKind',
      original: { actorId: 'actor_source', targetId: 'actor_target', targetKind: 'actor', value: 'bad' },
      repaired: { actorId: 'actor_source', targetId: 'actor_target', targetKind: 'actor', value: 10 },
    },
    {
      label: 'targetType',
      original: { actorId: 'actor_source', targetId: 'faction_target', targetType: 'faction', value: 'bad' },
      repaired: { actorId: 'actor_source', targetId: 'faction_target', targetKind: 'faction', value: 10 },
    },
    {
      label: 'matching factionId',
      original: {
        actorId: 'actor_source',
        targetId: 'faction_target',
        factionId: 'faction_target',
        value: 'bad',
      },
      repaired: { actorId: 'actor_source', targetId: 'faction_target', targetKind: 'faction', value: 10 },
    },
  ])('accepts a repair that preserves an unambiguous $label hint', ({ original, repaired }) => {
    expect(matchesRecoverableStatePatchBusinessIdentity(
      relationshipPatch(original),
      relationshipPatch(repaired),
    )).toBe(true);
  });
});
