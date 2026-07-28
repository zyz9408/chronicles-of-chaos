import { describe, expect, it } from 'vitest';
import type { CharacterTrait } from '../engine/types';
import {
  createCustomOpeningOption,
  isCustomBirthOption,
  isCustomIdentityOption,
  loadCustomOpeningOptions,
  saveCustomOpeningOptions,
  traitRarityClassName,
  traitRarityLabel,
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

    saveCustomOpeningOptions('threeKingdoms', { birthOrigins: [birth], identities: [identity] }, storage);

    expect(loadCustomOpeningOptions('threeKingdoms', storage)).toEqual({
      birthOrigins: [birth],
      identities: [identity],
    });
    expect(loadCustomOpeningOptions('song', storage)).toEqual({
      birthOrigins: [],
      identities: [],
    });
  });

  it('ignores invalid storage payloads', () => {
    const storage = new MemoryStorage();
    storage.setItem('coc-v2:opening-custom-options:threeKingdoms', '{bad');

    expect(loadCustomOpeningOptions('threeKingdoms', storage)).toEqual({
      birthOrigins: [],
      identities: [],
    });
  });

  it('detects custom option ids', () => {
    expect(isCustomBirthOption({ id: 'custom_birth_1' })).toBe(true);
    expect(isCustomBirthOption({ id: 'birth_local' })).toBe(false);
    expect(isCustomIdentityOption({ id: 'custom_identity_1' })).toBe(true);
    expect(isCustomIdentityOption({ id: 'identity_local' })).toBe(false);
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
});
