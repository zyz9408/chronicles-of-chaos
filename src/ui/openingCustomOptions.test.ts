import { describe, expect, it } from 'vitest';
import type { CharacterTrait } from '../engine/types';
import {
  createCustomOpeningOption,
  createCustomOpeningTrait,
  isCustomBirthOption,
  isCustomIdentityOption,
  isCustomOpeningTrait,
  loadCustomOpeningOptions,
  persistResolvedCustomOpeningTraitRarities,
  saveCustomOpeningOptions,
  traitRarityClassName,
  traitRarityLabel,
  updateCustomOpeningTrait,
} from './openingCustomOptions';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('openingCustomOptions', () => {
  it('persists custom birth origins and identities per world book', () => {
    const storage = new MemoryStorage();
    const birth = createCustomOpeningOption('birth', '边郡寒门', '世居边塞，家贫而识兵事。', 1000);
    const identity = createCustomOpeningOption('identity', '客军幕僚', '随军行走，替人筹划。', 2000);
    const trait = createCustomOpeningTrait('善辨形势', '能从人情与局势中辨认风险。', 3000);

    saveCustomOpeningOptions('threeKingdoms', {
      birthOrigins: [birth],
      identities: [identity],
      traits: [trait],
    }, storage);

    expect(loadCustomOpeningOptions('threeKingdoms', storage)).toEqual({
      birthOrigins: [birth],
      identities: [identity],
      traits: [trait],
    });
    expect(loadCustomOpeningOptions('song', storage)).toEqual({
      birthOrigins: [],
      identities: [],
      traits: [],
    });
  });

  it('ignores invalid storage payloads', () => {
    const storage = new MemoryStorage();
    storage.setItem('coc-v2:opening-custom-options:threeKingdoms', '{bad');

    expect(loadCustomOpeningOptions('threeKingdoms', storage)).toEqual({
      birthOrigins: [],
      identities: [],
      traits: [],
    });
  });

  it('detects custom option ids', () => {
    expect(isCustomBirthOption({ id: 'custom_birth_1' })).toBe(true);
    expect(isCustomBirthOption({ id: 'birth_local' })).toBe(false);
    expect(isCustomIdentityOption({ id: 'custom_identity_1' })).toBe(true);
    expect(isCustomIdentityOption({ id: 'identity_local' })).toBe(false);
    expect(isCustomOpeningTrait({ id: 'custom_trait_1', source: 'custom' })).toBe(true);
    expect(isCustomOpeningTrait({ id: 'custom_trait_1', source: 'opening' })).toBe(false);
  });

  it('updates a custom trait without changing its stable id or rarity', () => {
    const trait = {
      ...createCustomOpeningTrait('旧名', '旧描述', 3000),
      rarity: 'blue',
    } satisfies CharacterTrait;

    expect(updateCustomOpeningTrait(trait, '新名', '新描述')).toEqual({
      ...trait,
      label: '新名',
      description: '新描述',
      promptHint: '新描述',
    });
  });

  it('maps trait rarity to UI class and label', () => {
    const redTrait: CharacterTrait = {
      id: 'trait_red',
      label: '名士清望',
      description: '声望甚重。',
      source: 'opening',
      rarity: 'red',
    };
    const customTrait: CharacterTrait = {
      id: 'custom_trait_1',
      label: '自定义',
      description: '待开局判定。',
      source: 'custom',
    };

    expect(traitRarityClassName(redTrait)).toBe('trait-rarity-red');
    expect(traitRarityLabel(redTrait)).toBe('红');
    expect(traitRarityClassName(customTrait)).toBe('trait-rarity-pending');
    expect(traitRarityLabel(customTrait)).toBe('待判');
  });

  it('persists the first resolved custom rarity and keeps it stable across later openings', () => {
    const storage = new MemoryStorage();
    const trait = createCustomOpeningTrait('天命威仪', '具有强烈的霸主气场。', 3000);
    saveCustomOpeningOptions('threeKingdoms', {
      birthOrigins: [],
      identities: [],
      traits: [trait],
    }, storage);

    expect(persistResolvedCustomOpeningTraitRarities('threeKingdoms', [
      { ...trait, rarity: 'orange' },
    ], storage)).toBe(1);
    expect(persistResolvedCustomOpeningTraitRarities('threeKingdoms', [
      { ...trait, rarity: 'white' },
    ], storage)).toBe(0);
    expect(loadCustomOpeningOptions('threeKingdoms', storage).traits[0]?.rarity).toBe('orange');
  });

  it('normalizes the legacy gold trait tier to the unified red highest tier', () => {
    const storage = new MemoryStorage();
    const trait = createCustomOpeningTrait('旧版最高品级', '旧存档金色特质。', 3000);
    saveCustomOpeningOptions('threeKingdoms', {
      birthOrigins: [],
      identities: [],
      traits: [{ ...trait, rarity: 'gold' }],
    }, storage);

    expect(loadCustomOpeningOptions('threeKingdoms', storage).traits[0]?.rarity).toBe('red');
    persistResolvedCustomOpeningTraitRarities('threeKingdoms', [], storage);
    expect(loadCustomOpeningOptions('threeKingdoms', storage).traits[0]?.rarity).toBe('red');
  });
});
