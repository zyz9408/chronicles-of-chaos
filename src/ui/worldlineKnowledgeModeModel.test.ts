import { describe, expect, it } from 'vitest';
import {
  createOpeningWorldlineSettings,
  getDefaultWorldlineKnowledgeBaseId,
  getDefaultWorldlineKnowledgeMode,
  getDefaultWorldlineStoryPackIds,
  getWorldlineKnowledgeModeOptions,
} from './worldlineKnowledgeModeModel';

describe('worldlineKnowledgeModeModel', () => {
  it('exposes the four opening fidelity modes in display order', () => {
    const options = getWorldlineKnowledgeModeOptions();

    expect(options.map((option) => option.mode)).toEqual(['off', 'light', 'default', 'strict']);
    expect(options.map((option) => option.label)).toEqual(['关闭', '轻微', '默认', '严谨']);
    expect(options.every((option) => option.shortDescription.length > 0)).toBe(true);
    expect(options.every((option) => option.description.length > option.shortDescription.length)).toBe(true);
  });

  it('defaults new openings to the balanced worldline knowledge mode', () => {
    expect(getDefaultWorldlineKnowledgeMode()).toBe('default');
  });

  it('binds the bundled Three Kingdoms worldbook to its matching knowledge base', () => {
    expect(getDefaultWorldlineKnowledgeBaseId('threeKingdoms')).toBe('threeKingdoms.coreKnowledge.v1');
    expect(getDefaultWorldlineKnowledgeBaseId('unknown-world')).toBeUndefined();
    expect(getDefaultWorldlineKnowledgeBaseId(null)).toBeUndefined();
  });

  it('binds the bundled Three Kingdoms worldbook to its generic StoryPack', () => {
    expect(getDefaultWorldlineStoryPackIds('threeKingdoms')).toEqual([
      'threeKingdoms.genericStory.v1',
    ]);
    expect(getDefaultWorldlineStoryPackIds('unknown-world')).toEqual([]);
    expect(getDefaultWorldlineStoryPackIds(null)).toEqual([]);
  });

  it('creates opening runtime settings from the selected worldbook and mode', () => {
    expect(createOpeningWorldlineSettings('threeKingdoms', 'strict')).toEqual({
      knowledgeMode: 'strict',
      knowledgeBaseId: 'threeKingdoms.coreKnowledge.v1',
      storyPackIds: ['threeKingdoms.genericStory.v1'],
    });

    expect(createOpeningWorldlineSettings('custom-world', 'off')).toEqual({
      knowledgeMode: 'off',
      knowledgeBaseId: undefined,
      storyPackIds: [],
    });
  });
});
