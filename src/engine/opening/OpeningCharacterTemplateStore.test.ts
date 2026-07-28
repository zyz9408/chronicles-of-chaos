import { describe, expect, it } from 'vitest';
import type { OpeningCharacterTemplateProfile } from './OpeningCharacterTemplateStore';
import {
  OPENING_CHARACTER_TEMPLATES_STORAGE_KEY,
  deleteOpeningCharacterTemplate,
  loadOpeningCharacterTemplates,
  normalizeOpeningCharacterTemplate,
  saveOpeningCharacterTemplate,
} from './OpeningCharacterTemplateStore';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const profile: OpeningCharacterTemplateProfile = {
  playerMode: 'original',
  playerName: '刘平',
  historicalName: '',
  courtesyName: '玄德',
  sex: '男',
  age: 24,
  appearance: '身形挺拔',
  personality: '沉着果决',
  customNotes: '熟悉荆襄水路',
  abilityPresetId: 'custom',
  abilityBaseScores: { 武力: 60, 统率: 60, 机运: 50 },
  abilityScores: { 武力: 68, 统率: 72, 机运: 50 },
  birthOrigin: { id: 'han_clan', label: '汉室宗亲', description: '宗室旁支' },
  identity: { id: 'captain', label: '军中校尉' },
  traits: [{
    id: 'calm',
    label: '临危不乱',
    description: '危局中保持判断',
    source: 'opening',
  }],
};

describe('OpeningCharacterTemplateStore', () => {
  it('persists only reusable character data and restores it after reload', () => {
    const storage = new MemoryStorage();
    saveOpeningCharacterTemplate({
      label: '荆襄武官',
      worldBookId: 'threeKingdoms',
      profile,
    }, storage, new Date('2026-07-26T01:00:00.000Z'));

    const loaded = loadOpeningCharacterTemplates(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      label: '荆襄武官',
      worldBookId: 'threeKingdoms',
      profile: {
        playerName: '刘平',
        courtesyName: '玄德',
        abilityScores: { 武力: 68, 统率: 72, 机运: 50 },
        birthOrigin: { label: '汉室宗亲' },
        identity: { label: '军中校尉' },
      },
    });
    expect(storage.getItem(OPENING_CHARACTER_TEMPLATES_STORAGE_KEY)).not.toContain('selectedBookmarkId');
    expect(storage.getItem(OPENING_CHARACTER_TEMPLATES_STORAGE_KEY)).not.toContain('selectedLocationId');
    expect(storage.getItem(OPENING_CHARACTER_TEMPLATES_STORAGE_KEY)).not.toContain('playerExtraRequest');
  });

  it('updates an existing template without changing its creation time and can delete it', () => {
    const storage = new MemoryStorage();
    let templates = saveOpeningCharacterTemplate({
      label: '初稿',
      worldBookId: 'threeKingdoms',
      profile,
    }, storage, new Date('2026-07-26T01:00:00.000Z'));
    const original = templates[0];

    templates = saveOpeningCharacterTemplate({
      id: original.id,
      label: '修订稿',
      worldBookId: 'threeKingdoms',
      profile: { ...profile, age: 25 },
    }, storage, new Date('2026-07-26T02:00:00.000Z'));

    expect(templates).toHaveLength(1);
    expect(templates[0].createdAt).toBe('2026-07-26T01:00:00.000Z');
    expect(templates[0].updatedAt).toBe('2026-07-26T02:00:00.000Z');
    expect(templates[0].label).toBe('修订稿');

    expect(deleteOpeningCharacterTemplate(original.id, storage)).toEqual([]);
  });

  it('repairs malformed imported local data instead of trusting arbitrary values', () => {
    const normalized = normalizeOpeningCharacterTemplate({
      id: ' template ',
      label: ' 超限值 ',
      worldBookId: 'threeKingdoms',
      createdAt: '2026-07-26T01:00:00.000Z',
      updatedAt: '2026-07-26T01:00:00.000Z',
      profile: {
        ...profile,
        sex: 'unknown',
        age: 999,
        abilityScores: { 武力: 180, 统率: -12, bad: 'x' },
        traits: [...profile.traits, null, {}, ...profile.traits, ...profile.traits],
      },
    });

    expect(normalized?.id).toBe('template');
    expect(normalized?.profile.sex).toBe('男');
    expect(normalized?.profile.age).toBe(120);
    expect(normalized?.profile.abilityScores).toEqual({ 武力: 99, 统率: 1 });
    expect(normalized?.profile.traits).toHaveLength(3);
  });
});
