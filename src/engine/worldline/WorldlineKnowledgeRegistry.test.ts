import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldlineKnowledgeBase, WorldlineStoryPack } from '../types';
import { initWorldBookRegistry } from '../worldbook/WorldBookLoader';
import {
  clearWorldlineKnowledgeRegistryForTest,
  getWorldlineKnowledgeBase,
  listWorldlineKnowledgeBasesForWorldBook,
  listWorldlineStoryPacksForWorldBook,
  registerWorldlineKnowledgeBase,
  registerWorldlineStoryPack,
} from './WorldlineKnowledgeRegistry';

const knowledgeBase: WorldlineKnowledgeBase = {
  id: 'kb_test',
  worldBookId: 'wb_test',
  name: 'Test Knowledge Base',
  version: '0.1.0',
  description: 'test',
  cards: [],
};

const storyPack: WorldlineStoryPack = {
  id: 'pack_test',
  worldBookId: 'wb_test',
  name: 'Test Story Pack',
  version: '0.1.0',
  description: 'test',
  threads: [],
};

describe('WorldlineKnowledgeRegistry', () => {
  beforeEach(() => {
    clearWorldlineKnowledgeRegistryForTest();
  });

  it('registers knowledge bases by id and worldbook', () => {
    registerWorldlineKnowledgeBase(knowledgeBase);

    expect(getWorldlineKnowledgeBase('kb_test')).toBe(knowledgeBase);
    expect(listWorldlineKnowledgeBasesForWorldBook('wb_test')).toEqual([knowledgeBase]);
    expect(listWorldlineKnowledgeBasesForWorldBook('other')).toEqual([]);
  });

  it('registers story packs by worldbook', () => {
    registerWorldlineStoryPack(storyPack);

    expect(listWorldlineStoryPacksForWorldBook('wb_test')).toEqual([storyPack]);
    expect(listWorldlineStoryPacksForWorldBook('other')).toEqual([]);
  });

  it('registers official companion knowledge bases when worldbooks initialize', () => {
    initWorldBookRegistry();

    const bases = listWorldlineKnowledgeBasesForWorldBook('threeKingdoms');
    expect(bases.some((base) => base.id === 'threeKingdoms.coreKnowledge.v1')).toBe(true);
  });
});
