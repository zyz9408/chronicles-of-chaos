import type {
  CharacterCheckHook,
  CharacterTrait,
  CharacterTraitRarity,
} from '../types';
import {
  CHARACTER_TRAIT_RARITIES,
  normalizeCharacterTraitRarity,
} from './TraitRarity';

const rarityRank = new Map<CharacterTraitRarity, number>(
  CHARACTER_TRAIT_RARITIES.map((rarity, index) => [rarity, index]),
);

function normalizeIdentity(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s\u3000]+/g, '');
}

function cloneCheckHooks(hooks: readonly CharacterCheckHook[] | undefined): CharacterCheckHook[] | undefined {
  if (!Array.isArray(hooks)) return undefined;
  const cloned = hooks
    .filter((hook): hook is CharacterCheckHook => Boolean(hook) && typeof hook === 'object')
    .map((hook) => ({ ...hook }));
  return cloned.length > 0 ? cloned : undefined;
}

function cloneTrait(trait: CharacterTrait): CharacterTrait {
  const label = typeof trait.label === 'string' ? trait.label.trim() : '';
  const checkHooks = cloneCheckHooks(trait.checkHooks);
  return {
    ...trait,
    id: typeof trait.id === 'string' && trait.id.trim()
      ? trait.id.trim()
      : `trait_${normalizeIdentity(label) || 'legacy'}`,
    label,
    description: typeof trait.description === 'string' && trait.description.trim()
      ? trait.description.trim()
      : label,
    source: typeof trait.source === 'string' && trait.source.trim()
      ? trait.source.trim()
      : 'legacy_migration',
    ...(typeof trait.promptHint === 'string' ? { promptHint: trait.promptHint.trim() } : {}),
    ...(checkHooks ? { checkHooks } : {}),
  };
}

function pickMoreCompleteText(existing: string | undefined, incoming: string | undefined): string | undefined {
  const left = existing?.trim();
  const right = incoming?.trim();
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function mergeCheckHooks(
  existing: readonly CharacterCheckHook[] | undefined,
  incoming: readonly CharacterCheckHook[] | undefined,
): CharacterCheckHook[] | undefined {
  const merged: CharacterCheckHook[] = [];
  const seen = new Set<string>();
  for (const hook of [...(existing ?? []), ...(incoming ?? [])]) {
    const key = `${normalizeIdentity(hook.scope)}|${normalizeIdentity(hook.note)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...hook });
  }
  return merged.length > 0 ? merged : undefined;
}

function pickStrongerRarity(
  existing: CharacterTrait['rarity'],
  incoming: CharacterTrait['rarity'],
): CharacterTrait['rarity'] {
  const left = normalizeCharacterTraitRarity(existing);
  const right = normalizeCharacterTraitRarity(incoming);
  if (!left) return right ?? existing ?? incoming;
  if (!right) return left;
  return (rarityRank.get(right) ?? -1) > (rarityRank.get(left) ?? -1) ? right : left;
}

function findDuplicateTraitIndex(
  traits: readonly CharacterTrait[],
  candidate: CharacterTrait,
): number {
  const candidateId = normalizeIdentity(candidate.id);
  if (candidateId) {
    const exactId = traits.findIndex((trait) => normalizeIdentity(trait.id) === candidateId);
    if (exactId >= 0) return exactId;
  }
  const candidateLabel = normalizeIdentity(candidate.label);
  if (!candidateLabel) return -1;
  return traits.findIndex((trait) => normalizeIdentity(trait.label) === candidateLabel);
}

function mergeDuplicateTraits(existing: CharacterTrait, incoming: CharacterTrait): CharacterTrait {
  const description = pickMoreCompleteText(existing.description, incoming.description) ?? '';
  const promptHint = pickMoreCompleteText(existing.promptHint, incoming.promptHint);
  const checkHooks = mergeCheckHooks(existing.checkHooks, incoming.checkHooks);
  const rarity = pickStrongerRarity(existing.rarity, incoming.rarity);
  return {
    ...cloneTrait(existing),
    description,
    source: normalizeIdentity(existing.source) ? existing.source.trim() : incoming.source.trim(),
    ...(rarity ? { rarity } : {}),
    ...(promptHint ? { promptHint } : {}),
    ...(checkHooks ? { checkHooks } : {}),
  };
}

/**
 * Character traits are stable structured profile data. Duplicate stable IDs or
 * duplicate normalized labels represent the same trait and must not accumulate
 * across provider writebacks or legacy save loads.
 */
export function normalizeCharacterTraits(
  traits: readonly CharacterTrait[] | undefined,
): CharacterTrait[] {
  const normalized: CharacterTrait[] = [];
  for (const sourceTrait of traits ?? []) {
    if (!sourceTrait || typeof sourceTrait !== 'object') continue;
    const trait = cloneTrait(sourceTrait);
    if (!trait.label) continue;
    const duplicateIndex = findDuplicateTraitIndex(normalized, trait);
    if (duplicateIndex >= 0) {
      normalized[duplicateIndex] = mergeDuplicateTraits(normalized[duplicateIndex], trait);
    } else {
      normalized.push(trait);
    }
  }
  return normalized;
}
