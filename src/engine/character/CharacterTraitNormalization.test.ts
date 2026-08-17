import { describe, expect, it } from 'vitest';
import { normalizeCharacterTraits } from './CharacterTraitNormalization';

describe('normalizeCharacterTraits', () => {
  it('deduplicates stable IDs and normalized labels while preserving the strongest complete record', () => {
    const normalized = normalizeCharacterTraits([
      {
        id: 'trait_genius',
        label: '鬼才',
        description: '善于临机判断。',
        source: 'history',
        rarity: 'blue',
        checkHooks: [{ scope: 'strategy', modifier: 5, note: '谋划' }],
      },
      {
        id: 'trait_genius_drifted',
        label: ' 鬼 才 ',
        description: '善于在复杂局势中临机判断并迅速找到破局之法。',
        source: 'event',
        rarity: 'orange',
        promptHint: '涉及筹谋时体现其敏锐判断。',
        checkHooks: [
          { scope: 'strategy', modifier: 5, note: '谋划' },
          { scope: 'social', modifier: 2, note: '识人' },
        ],
      },
      {
        id: 'trait_genius',
        label: '不应改名',
        description: '短描述。',
        source: 'custom',
        rarity: 'green',
      },
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      id: 'trait_genius',
      label: '鬼才',
      rarity: 'orange',
      source: 'history',
      description: '善于在复杂局势中临机判断并迅速找到破局之法。',
      promptHint: '涉及筹谋时体现其敏锐判断。',
    });
    expect(normalized[0].checkHooks).toHaveLength(2);
  });

  it('keeps genuinely different trait labels separate', () => {
    expect(normalizeCharacterTraits([
      { id: 'trait_loyal', label: '至孝', description: '敬亲。', source: 'history' },
      { id: 'trait_genius', label: '鬼才', description: '善谋。', source: 'history' },
    ])).toHaveLength(2);
  });

  it('repairs legacy traits that omitted stable metadata instead of blocking save migration', () => {
    const normalized = normalizeCharacterTraits([
      { label: '鬼才', rarity: 'purple' },
      { id: '', label: ' 鬼 才 ', rarity: 'orange' },
      null,
    ] as unknown as Parameters<typeof normalizeCharacterTraits>[0]);

    expect(normalized).toEqual([expect.objectContaining({
      id: 'trait_鬼才',
      label: '鬼才',
      source: 'legacy_migration',
      rarity: 'orange',
    })]);
  });
});
