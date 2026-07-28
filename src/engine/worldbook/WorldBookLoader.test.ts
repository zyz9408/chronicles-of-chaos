import { describe, expect, it } from 'vitest';
import {
  threeKingdomsGenericStoryPack,
  worldBook_ThreeKingdoms,
} from '../../worldbooks/threeKingdoms';
import type { WorldBook } from '../types';
import { getWorldlineStoryPack } from '../worldline/WorldlineKnowledgeRegistry';
import { getWorldBook, initWorldBookRegistry, registerWorldBook } from './WorldBookLoader';

describe('WorldBookLoader registration identity', () => {
  it('registers the official Three Kingdoms StoryPack slot with the worldbook', () => {
    initWorldBookRegistry();

    expect(getWorldlineStoryPack(threeKingdomsGenericStoryPack.id))
      .toBe(threeKingdomsGenericStoryPack);
    expect(threeKingdomsGenericStoryPack.threads).toHaveLength(1500);
  });

  it('rejects a custom registration that collides with an official worldbook ID', () => {
    const collision: WorldBook = {
      ...worldBook_ThreeKingdoms,
      manifest: {
        ...worldBook_ThreeKingdoms.manifest,
        source: 'custom',
      },
    };

    expect(() => registerWorldBook(collision)).toThrow(/official|官方|冲突/i);
    expect(getWorldBook(worldBook_ThreeKingdoms.manifest.id)).toBe(worldBook_ThreeKingdoms);
  });

  it('registers a non-conflicting custom worldbook as the resolvable source', () => {
    const custom: WorldBook = {
      ...worldBook_ThreeKingdoms,
      manifest: {
        ...worldBook_ThreeKingdoms.manifest,
        id: 'worldbook-loader-custom-test',
        source: 'custom',
      },
    };

    registerWorldBook(custom);

    expect(getWorldBook(custom.manifest.id)).toBe(custom);
  });
});
