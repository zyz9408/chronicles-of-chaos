import type {
  CharacterUniqueArt,
  PassiveUniqueArtTurnSettlement,
  RuntimeState,
} from '../types';
import { tryCreateGameClockFromDateLabel, type GameClock } from '../time/gameClock';
import { normalizeUniqueArtRarity } from './NpcUniqueArtPolicy';
import type { SemanticEffect, UniqueArtSemanticProfile } from '../encounterV2/EncounterContracts';
import { materializeLevelledUniqueArtProjection } from '../encounterV2/UniqueArtProjectionRuntime';
import { normalizePlayerVitals } from './PlayerVitals';

const RECOVERY_LIMIT_BY_RARITY = Object.freeze({
  white: 2,
  green: 4,
  blue: 6,
  purple: 8,
  orange: 12,
  red: 16,
} as const);

const MAX_RECOVERY_PER_STAT_PER_TURN = 25;

export interface PassiveUniqueArtTurnResult {
  state: RuntimeState;
  settlement?: PassiveUniqueArtTurnSettlement;
}

/**
 * Settles structured passive unique-art effects after one successfully time-advanced
 * narrative turn. The runtime never infers mechanics from an art name or prose.
 */
export function settlePassiveUniqueArtsAfterRuntimeTurn(
  state: RuntimeState,
  previousState: RuntimeState,
): PassiveUniqueArtTurnResult {
  const before = resolveClock(previousState);
  const after = resolveClock(state);
  if (!before || !after || toAbsoluteMinutes(after) <= toAbsoluteMinutes(before)) return { state };

  const turnKey = `${clockKey(before)}>${clockKey(after)}#${state.turnLog.length}`;
  if (state.passiveUniqueArtTurnSettlement?.turnKey === turnKey) return { state };

  const arts = new Map((state.player.uniqueArts ?? []).map((art) => [art.id, art]));
  const profiles = (state.encounterV2?.semanticProjections ?? [])
    .filter(isRuntimePassiveUniqueArt)
    .map((profile) => ({ profile, art: arts.get(profile.sourceId) }))
    .filter((entry): entry is { profile: UniqueArtSemanticProfile; art: CharacterUniqueArt } => Boolean(entry.art));
  if (profiles.length === 0) return { state };

  const vitals = normalizePlayerVitals(state.player.vitals);
  let hp = Math.round(vitals.hp);
  let stamina = Math.round(vitals.stamina);
  let hpRecovered = 0;
  let staminaRecovered = 0;
  const appliedArtIds = new Set<string>();

  for (const { profile, art } of profiles) {
    const materialized = materializeLevelledUniqueArtProjection(art, profile, 'runtime_turn');
    const effectLimit = RECOVERY_LIMIT_BY_RARITY[normalizeUniqueArtRarity(art.rarity)];
    for (const effect of [...materialized.effects].sort((left, right) => left.priority - right.priority)) {
      if (!isSupportedRuntimeRecovery(effect) || !conditionMatches(effect, hp, vitals.maxHp, stamina, vitals.maxStamina)) {
        continue;
      }
      const requested = Math.min(effectLimit, Math.max(0, Math.round(effect.value)));
      if (requested <= 0) continue;
      if (effect.operation === 'restore_hp') {
        if (hp <= 0 || hpRecovered >= MAX_RECOVERY_PER_STAT_PER_TURN) continue;
        const next = Math.min(vitals.maxHp, hp + requested, hp + MAX_RECOVERY_PER_STAT_PER_TURN - hpRecovered);
        const recovered = next - hp;
        if (recovered > 0) {
          hp = next;
          hpRecovered += recovered;
          appliedArtIds.add(art.id);
        }
      } else {
        if (staminaRecovered >= MAX_RECOVERY_PER_STAT_PER_TURN) continue;
        const next = Math.min(
          vitals.maxStamina,
          stamina + requested,
          stamina + MAX_RECOVERY_PER_STAT_PER_TURN - staminaRecovered,
        );
        const recovered = next - stamina;
        if (recovered > 0) {
          stamina = next;
          staminaRecovered += recovered;
          appliedArtIds.add(art.id);
        }
      }
    }
  }

  const settlement: PassiveUniqueArtTurnSettlement = {
    turnKey,
    artIds: [...appliedArtIds],
    hpRecovered,
    staminaRecovered,
  };
  const nextState: RuntimeState = {
    ...state,
    player: hpRecovered > 0 || staminaRecovered > 0
      ? {
          ...state.player,
          vitals: {
            ...vitals,
            hp,
            stamina,
          },
        }
      : state.player,
    passiveUniqueArtTurnSettlement: settlement,
    turnLog: appendSettlementSummary(state.turnLog, settlement, arts),
  };
  return { state: nextState, settlement };
}

function isRuntimePassiveUniqueArt(profile: unknown): profile is UniqueArtSemanticProfile {
  if (!profile || typeof profile !== 'object') return false;
  const candidate = profile as UniqueArtSemanticProfile;
  return candidate.profileKind === 'ability'
    && candidate.sourceType === 'unique_art'
    && candidate.status === 'executable'
    && (candidate.activation === 'passive' || candidate.activation === 'hybrid')
    && candidate.rulesetScopes.includes('runtime_turn');
}

function isSupportedRuntimeRecovery(effect: SemanticEffect): boolean {
  return effect.trigger === 'after_runtime_turn'
    && effect.target === 'self'
    && (effect.operation === 'restore_hp' || effect.operation === 'restore_stamina')
    && Number.isFinite(effect.value)
    && effect.value > 0;
}

function conditionMatches(
  effect: SemanticEffect,
  hp: number,
  maxHp: number,
  stamina: number,
  maxStamina: number,
): boolean {
  if (effect.condition === 'always') return true;
  if (effect.condition === 'self_hp_below_30') return maxHp > 0 && hp / maxHp < 0.3;
  if (effect.condition === 'self_stamina_below_30') return maxStamina > 0 && stamina / maxStamina < 0.3;
  return false;
}

function resolveClock(state: RuntimeState): GameClock | undefined {
  return state.currentTime ?? tryCreateGameClockFromDateLabel(state.currentDate);
}

function toAbsoluteMinutes(clock: GameClock): number {
  return (((((clock.year * 12) + (clock.month - 1)) * 30 + (clock.day - 1)) * 24 + clock.hour) * 60)
    + clock.minute;
}

function clockKey(clock: GameClock): string {
  return `${clock.year}-${clock.month}-${clock.day}T${clock.hour}:${clock.minute}`;
}

function appendSettlementSummary(
  turnLog: RuntimeState['turnLog'],
  settlement: PassiveUniqueArtTurnSettlement,
  arts: ReadonlyMap<string, CharacterUniqueArt>,
): RuntimeState['turnLog'] {
  if (turnLog.length === 0 || (settlement.hpRecovered <= 0 && settlement.staminaRecovered <= 0)) return turnLog;
  const names = settlement.artIds.map((id) => arts.get(id)?.name ?? id).join('、');
  const values = [
    settlement.hpRecovered > 0 ? `生命 +${settlement.hpRecovered}` : undefined,
    settlement.staminaRecovered > 0 ? `体力 +${settlement.staminaRecovered}` : undefined,
  ].filter(Boolean).join('，');
  const summary = `被动绝艺 ${names}：${values}`;
  const lastIndex = turnLog.length - 1;
  return turnLog.map((entry, index) => index === lastIndex
    ? { ...entry, statePatchSummary: [entry.statePatchSummary, summary].filter(Boolean).join('；') }
    : entry);
}
