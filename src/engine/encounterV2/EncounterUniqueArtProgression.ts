import { applyLuanShiCommand } from '../state/luanshiReducers';
import type { CharacterUniqueArtProgressRecordCommand } from '../state/luanshiCommands';
import type { CharacterUniqueArt, RuntimeState } from '../types';
import type {
  EncounterOutcome,
  SealedEncounterResult,
  UnsealedCombatResult,
  UnsealedWarResult,
} from './EncounterContracts';
import type { CombatEncounterSnapshot } from './CombatTypes';
import type { WarEncounterSnapshot } from './WarTypes';

interface UniqueArtOwner {
  characterType: 'player' | 'npc';
  characterId: string;
  characterName: string;
  art: CharacterUniqueArt;
}

function findRuntimeUniqueArtOwner(
  state: RuntimeState,
  actorId: string,
  artId: string,
): UniqueArtOwner | undefined {
  if (actorId === state.player.id) {
    const art = state.player.uniqueArts?.find((candidate) => candidate.id === artId);
    return art ? {
      characterType: 'player',
      characterId: state.player.id,
      characterName: state.player.name,
      art,
    } : undefined;
  }
  const npc = state.npcs?.find((candidate) => candidate.npcId === actorId);
  const art = npc?.uniqueArts?.find((candidate) => candidate.id === artId);
  return npc && art ? {
    characterType: 'npc',
    characterId: npc.npcId,
    characterName: npc.name,
    art,
  } : undefined;
}

function artCanProgress(art: CharacterUniqueArt): boolean {
  return art.level < (art.maxLevel ?? 10);
}

function applyActualUseProgress(
  state: RuntimeState,
  owner: UniqueArtOwner,
  input: {
    eventId: string;
    intensity: 'normal' | 'major';
    occurredAt: string;
    sourceRefId: string;
    summary: string;
  },
): RuntimeState {
  if (!artCanProgress(owner.art)) return state;
  const command: CharacterUniqueArtProgressRecordCommand = {
    action: 'recordCharacterUniqueArtProgress',
    characterType: owner.characterType,
    characterId: owner.characterId,
    characterName: owner.characterName,
    artId: owner.art.id,
    eventId: input.eventId,
    source: 'actual_use',
    intensity: input.intensity,
    occurredAt: input.occurredAt,
    sourceRefId: input.sourceRefId,
    summary: input.summary,
  };
  return applyLuanShiCommand(state, command);
}

export function applyCombatUniqueArtProgress(
  inputState: RuntimeState,
  snapshot: CombatEncounterSnapshot,
  result: SealedEncounterResult<UnsealedCombatResult>,
  occurredAt: string,
): RuntimeState {
  const useCounts = new Map<string, { actorId: string; artId: string; count: number }>();
  for (const entry of result.actionLog) {
    if (entry.actionType !== 'unique_art') continue;
    const artId = typeof entry.values.artId === 'string' ? entry.values.artId.trim() : '';
    if (!artId) continue;
    const key = `${entry.actorId}\u0000${artId}`;
    const existing = useCounts.get(key);
    useCounts.set(key, {
      actorId: entry.actorId,
      artId,
      count: (existing?.count ?? 0) + 1,
    });
  }

  let state = inputState;
  for (const usage of useCounts.values()) {
    if (!snapshot.combatants.some((combatant) => combatant.actorId === usage.actorId)) continue;
    const owner = findRuntimeUniqueArtOwner(state, usage.actorId, usage.artId);
    if (!owner) continue;
    state = applyActualUseProgress(state, owner, {
      eventId: `combat:${result.resultHash}:unique-art:${usage.actorId}:${usage.artId}`,
      intensity: usage.count >= 2 ? 'major' : 'normal',
      occurredAt,
      sourceRefId: `combat:${result.encounterId}`,
      summary: `${owner.characterName}在个人战中实际施展“${owner.art.name}”${usage.count}次。`,
    });
  }
  return state;
}

function warArtOwnerActorId(
  snapshot: WarEncounterSnapshot,
  side: 'player' | 'enemy',
  artId: string,
): string | undefined {
  const sources = [
    ...(snapshot.commanders[side] ? [snapshot.commanders[side]!] : []),
    ...(snapshot.officers?.[side] ?? []),
  ];
  return sources.find((source) => (
    source.uniqueArtProfiles.some((profile) => profile.sourceId === artId)
  ))?.actorId;
}

function sideWon(side: 'player' | 'enemy', outcome: EncounterOutcome): boolean {
  return side === 'player'
    ? outcome === 'player_victory' || outcome === 'enemy_retreat'
    : outcome === 'enemy_victory' || outcome === 'player_retreat';
}

export function applyWarUniqueArtProgress(
  inputState: RuntimeState,
  snapshot: WarEncounterSnapshot,
  result: SealedEncounterResult<UnsealedWarResult>,
  occurredAt: string,
): RuntimeState {
  const usedArts = new Map<string, { side: 'player' | 'enemy'; artId: string }>();
  for (const entry of result.actionLog) {
    if (entry.actionType !== 'war_round') continue;
    for (const [side, value] of [
      ['player', entry.values.playerOrder],
      ['enemy', entry.values.enemyOrder],
    ] as const) {
      if (typeof value !== 'string' || !value.startsWith('war_art:')) continue;
      const artId = value.slice('war_art:'.length).trim();
      if (artId) usedArts.set(`${side}\u0000${artId}`, { side, artId });
    }
  }

  let state = inputState;
  for (const usage of usedArts.values()) {
    const actorId = warArtOwnerActorId(snapshot, usage.side, usage.artId);
    if (!actorId) continue;
    const owner = findRuntimeUniqueArtOwner(state, actorId, usage.artId);
    if (!owner) continue;
    state = applyActualUseProgress(state, owner, {
      eventId: `war:${result.resultHash}:unique-art:${actorId}:${usage.artId}`,
      intensity: sideWon(usage.side, result.outcome) ? 'major' : 'normal',
      occurredAt,
      sourceRefId: `war:${result.encounterId}`,
      summary: `${owner.characterName}在战争中实际施展“${owner.art.name}”。`,
    });
  }
  return state;
}
