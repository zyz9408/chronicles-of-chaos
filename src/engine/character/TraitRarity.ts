import type { CharacterTraitRarity } from '../types';

export const CHARACTER_TRAIT_RARITIES = [
  'white',
  'green',
  'blue',
  'purple',
  'orange',
  'red',
] as const satisfies readonly CharacterTraitRarity[];

const characterTraitRaritySet = new Set<string>(CHARACTER_TRAIT_RARITIES);

/**
 * Normalizes persisted and model-provided trait rarity values.
 * `gold` is the legacy highest tier and therefore maps to the unified red tier.
 */
export function normalizeCharacterTraitRarity(value: unknown): CharacterTraitRarity | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === 'gold') return 'red';
  return characterTraitRaritySet.has(normalized)
    ? normalized as CharacterTraitRarity
    : null;
}

export function isCharacterTraitRarity(value: unknown): value is CharacterTraitRarity {
  return typeof value === 'string' && characterTraitRaritySet.has(value.trim().toLocaleLowerCase());
}
