import type { RuntimeState } from '../types';
import type {
  EncounterStartIntent,
  PersonalCombatStartIntent,
  WarStartIntent,
} from './EncounterContracts';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * `player` is a long-standing reserved writeback alias in the main prompt.
 * Encounter V2 stores the actual runtime player ID, so normalize the alias once
 * at the structured boundary instead of letting snapshots contain two IDs for
 * the same actor.
 */
export function canonicalizeEncounterPlayerAlias<T extends EncounterStartIntent>(
  state: RuntimeState,
  input: T,
): T {
  if (state.player.id === 'player') return clone(input);
  const intent = clone(input);
  if (intent.kind === 'personal_combat') {
    const combat = intent as PersonalCombatStartIntent;
    combat.playerParty.actorIds = combat.playerParty.actorIds.map((actorId) => (
      actorId === 'player' ? state.player.id : actorId
    ));
  } else {
    const war = intent as WarStartIntent;
    if (war.playerForce.commanderActorId === 'player') {
      war.playerForce.commanderActorId = state.player.id;
    }
  }
  return intent;
}
