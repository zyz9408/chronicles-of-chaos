import type { CharacterTrait, CharacterTraitRarity, OpeningCharacterOption } from '../engine/types';

export type CustomOpeningOptionKind = 'birth' | 'identity';

export interface PersistedCustomOpeningOptions {
  birthOrigins: OpeningCharacterOption[];
  identities: OpeningCharacterOption[];
}

const STORAGE_KEY_PREFIX = 'coc-v2:opening-custom-options:';

const EMPTY_CUSTOM_OPTIONS: PersistedCustomOpeningOptions = {
  birthOrigins: [],
  identities: [],
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

const rarityLabels: Record<CharacterTraitRarity, string> = {
  white: '白',
  green: '绿',
  blue: '蓝',
  red: '红',
  gold: '金',
};

function normalizeRarity(rarity: CharacterTrait['rarity']): CharacterTraitRarity | null {
  if (rarity === 'white' || rarity === 'green' || rarity === 'blue' || rarity === 'red' || rarity === 'gold') {
    return rarity;
  }
  return null;
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
