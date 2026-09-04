import type { CharacterTrait, CharacterTraitRarity, OpeningCharacterOption } from '../engine/types';
import { normalizeCharacterTraitRarity } from '../engine/character/TraitRarity';
import { compileTraitAbilityMechanics } from '../engine/abilities/AbilityMechanics';

export type CustomOpeningOptionKind = 'birth' | 'identity';

export interface PersistedCustomOpeningOptions {
  birthOrigins: OpeningCharacterOption[];
  identities: OpeningCharacterOption[];
  traits: CharacterTrait[];
}

const STORAGE_KEY_PREFIX = 'coc-v2:opening-custom-options:';

const EMPTY_CUSTOM_OPTIONS: PersistedCustomOpeningOptions = {
  birthOrigins: [],
  identities: [],
  traits: [],
};

export function openingCustomOptionsStorageKey(worldBookId: string): string {
  return `${STORAGE_KEY_PREFIX}${worldBookId}`;
}

function isOption(value: unknown): value is OpeningCharacterOption {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.label === 'string'
    && (record.description === undefined || typeof record.description === 'string');
}

function normalizeCustomTrait(value: unknown): CharacterTrait | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string'
    || !record.id.startsWith('custom_trait_')
    || typeof record.label !== 'string'
    || typeof record.description !== 'string'
  ) {
    return null;
  }

  const rarity = normalizeCharacterTraitRarity(record.rarity);
  const trait: CharacterTrait = {
    id: record.id,
    label: record.label,
    description: record.description,
    source: 'custom',
    ...(rarity ? { rarity } : {}),
    ...(typeof record.promptHint === 'string' ? { promptHint: record.promptHint } : {}),
  };
  const mechanics = compileTraitAbilityMechanics(trait);
  return mechanics ? { ...trait, mechanics } : trait;
}

export function normalizeCustomOpeningOptions(raw: unknown): PersistedCustomOpeningOptions {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CUSTOM_OPTIONS };
  const record = raw as Record<string, unknown>;

  return {
    birthOrigins: Array.isArray(record.birthOrigins)
      ? record.birthOrigins.filter(isOption)
      : [],
    identities: Array.isArray(record.identities)
      ? record.identities.filter(isOption)
      : [],
    traits: Array.isArray(record.traits)
      ? record.traits
        .map(normalizeCustomTrait)
        .filter((trait): trait is CharacterTrait => trait !== null)
      : [],
  };
}

export function loadCustomOpeningOptions(
  worldBookId: string,
  storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): PersistedCustomOpeningOptions {
  if (!storage) return { ...EMPTY_CUSTOM_OPTIONS };
  const payload = storage.getItem(openingCustomOptionsStorageKey(worldBookId));
  if (!payload) return { ...EMPTY_CUSTOM_OPTIONS };

  try {
    return normalizeCustomOpeningOptions(JSON.parse(payload));
  } catch {
    return { ...EMPTY_CUSTOM_OPTIONS };
  }
}

export function saveCustomOpeningOptions(
  worldBookId: string,
  options: PersistedCustomOpeningOptions,
  storage: Pick<Storage, 'setItem'> | null | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): void {
  if (!storage) return;
  storage.setItem(openingCustomOptionsStorageKey(worldBookId), JSON.stringify(normalizeCustomOpeningOptions(options)));
}

/**
 * Freezes the first successful LLM rarity decision for custom opening traits.
 * Existing resolved rarities remain authoritative until the player deletes the trait.
 */
export function persistResolvedCustomOpeningTraitRarities(
  worldBookId: string,
  resolvedTraits: CharacterTrait[],
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): number {
  if (!storage) return 0;
  const options = loadCustomOpeningOptions(worldBookId, storage);
  const resolvedRarityById = new Map(
    resolvedTraits
      .map((trait) => [trait.id, normalizeCharacterTraitRarity(trait.rarity)] as const)
      .filter((entry): entry is readonly [string, CharacterTraitRarity] => entry[1] !== null),
  );
  let persistedCount = 0;
  const traits = options.traits.map((trait) => {
    const existingRarity = normalizeCharacterTraitRarity(trait.rarity);
    if (existingRarity) {
      return existingRarity === trait.rarity ? trait : { ...trait, rarity: existingRarity };
    }
    const resolvedRarity = resolvedRarityById.get(trait.id);
    if (!resolvedRarity) return trait;
    persistedCount += 1;
    return { ...trait, rarity: resolvedRarity };
  });
  if (persistedCount > 0 || traits.some((trait, index) => trait !== options.traits[index])) {
    saveCustomOpeningOptions(worldBookId, { ...options, traits }, storage);
  }
  return persistedCount;
}

export function createCustomOpeningOption(
  kind: CustomOpeningOptionKind,
  label: string,
  description: string,
  now: number = Date.now(),
): OpeningCharacterOption {
  const prefix = kind === 'birth' ? 'custom_birth' : 'custom_identity';
  const fallbackDescription = kind === 'birth' ? '玩家自定义出身。' : '玩家自定义身份。';

  return {
    id: `${prefix}_${now}`,
    label: label.trim(),
    description: description.trim() || fallbackDescription,
  };
}

export function isCustomBirthOption(option: Pick<OpeningCharacterOption, 'id'>): boolean {
  return option.id.startsWith('custom_birth_');
}

export function isCustomIdentityOption(option: Pick<OpeningCharacterOption, 'id'>): boolean {
  return option.id.startsWith('custom_identity_');
}

const fallbackCustomTraitDescription = '玩家自定义开局特质。';
const fallbackCustomTraitPromptHint = '由 LLM 根据玩家自定义特质在合适场景中体现。';

export function createCustomOpeningTrait(
  label: string,
  description: string,
  now: number = Date.now(),
): CharacterTrait {
  const normalizedDescription = description.trim();
  const trait: CharacterTrait = {
    id: `custom_trait_${now}`,
    label: label.trim(),
    description: normalizedDescription || fallbackCustomTraitDescription,
    source: 'custom',
    promptHint: normalizedDescription || fallbackCustomTraitPromptHint,
  };
  const mechanics = compileTraitAbilityMechanics(trait);
  return mechanics ? { ...trait, mechanics } : trait;
}

export function updateCustomOpeningTrait(
  trait: CharacterTrait,
  label: string,
  description: string,
): CharacterTrait {
  const normalizedDescription = description.trim();
  const updated: CharacterTrait = {
    ...trait,
    label: label.trim(),
    description: normalizedDescription || fallbackCustomTraitDescription,
    source: 'custom',
    promptHint: normalizedDescription || fallbackCustomTraitPromptHint,
  };
  const mechanics = compileTraitAbilityMechanics({ ...updated, mechanics: undefined });
  const { mechanics: _staleMechanics, ...withoutMechanics } = updated;
  return mechanics ? { ...withoutMechanics, mechanics } : withoutMechanics;
}

export function isCustomOpeningTrait(trait: Pick<CharacterTrait, 'id' | 'source'>): boolean {
  return trait.id.startsWith('custom_trait_') && trait.source === 'custom';
}

const rarityLabels: Record<CharacterTraitRarity, string> = {
  white: '白',
  green: '绿',
  blue: '蓝',
  purple: '紫',
  orange: '橙',
  red: '红',
};

function normalizeRarity(rarity: CharacterTrait['rarity']): CharacterTraitRarity | null {
  return normalizeCharacterTraitRarity(rarity);
}

export function traitRarityClassName(trait: Pick<CharacterTrait, 'rarity' | 'source'>): string {
  const rarity = normalizeRarity(trait.rarity);
  if (!rarity) return trait.source === 'custom' ? 'trait-rarity-pending' : 'trait-rarity-white';
  return `trait-rarity-${rarity}`;
}

export function traitRarityLabel(trait: Pick<CharacterTrait, 'rarity' | 'source'>): string {
  const rarity = normalizeRarity(trait.rarity);
  if (!rarity) return trait.source === 'custom' ? '待判' : rarityLabels.white;
  return rarityLabels[rarity];
}
