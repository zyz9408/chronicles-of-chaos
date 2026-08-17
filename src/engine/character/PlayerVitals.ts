import type { CharacterVitals } from '../types';

export const DEFAULT_PLAYER_VITALS: Readonly<CharacterVitals> = Object.freeze({
  hp: 100,
  maxHp: 100,
  stamina: 100,
  maxStamina: 100,
});

export function normalizePlayerVitals(vitals: Partial<CharacterVitals> | undefined): CharacterVitals {
  const maxHp = normalizeMaximum(vitals?.maxHp, DEFAULT_PLAYER_VITALS.maxHp);
  const maxStamina = normalizeMaximum(vitals?.maxStamina, DEFAULT_PLAYER_VITALS.maxStamina);
  return {
    hp: normalizeCurrent(vitals?.hp, maxHp),
    maxHp,
    stamina: normalizeCurrent(vitals?.stamina, maxStamina),
    maxStamina,
  };
}

function normalizeMaximum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : fallback;
}

function normalizeCurrent(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return maximum;
  return Math.max(0, Math.min(maximum, Math.round(value)));
}
