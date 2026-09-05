import { describe, expect, it } from 'vitest';
import {
  avgPortraitProfileKey,
  createAvgPortraitMatchProfile,
  scoreAvgPortraitSimilarity,
  selectSimilarAvgPortraitCandidate,
} from './AvgPortraitLibrary';

describe('AVG generated portrait library matching', () => {
  it('requires a structured binary sex and normalizes reusable profile facts', () => {
    expect(createAvgPortraitMatchProfile({ sex: '其他', roleFamily: '军士' })).toBeUndefined();
    expect(createAvgPortraitMatchProfile({
      sex: '男', age: 24, roleFamily: ' 军士 ', professionTags: ['步卒', '步卒', undefined],
    })).toEqual({
      schemaVersion: 1,
      sex: 'male',
      ageBand: 'young_adult',
      roleFamily: '军士',
      professionTags: ['步卒'],
      socialTierTags: [],
    });
  });

  it('prefers age and role similarity while never crossing sex', () => {
    const subject = createAvgPortraitMatchProfile({ sex: '男', age: 26, roleFamily: '军士', professionTags: ['步卒'] })!;
    const matching = createAvgPortraitMatchProfile({ sex: 'male', ageBand: 'young_adult', roleFamily: '军士', professionTags: ['步卒'] })!;
    const otherRole = createAvgPortraitMatchProfile({ sex: '男', age: 42, roleFamily: '军士' })!;
    const wrongSex = createAvgPortraitMatchProfile({ sex: '女', age: 26, roleFamily: '军士', professionTags: ['步卒'] })!;

    expect(scoreAvgPortraitSimilarity(subject, matching)).toBeGreaterThan(scoreAvgPortraitSimilarity(subject, otherRole)!);
    expect(scoreAvgPortraitSimilarity(subject, wrongSex)).toBeUndefined();
    expect(selectSimilarAvgPortraitCandidate(subject, 'npc-new', [
      { key: 'other', portraitProfile: otherRole },
      { key: 'matching', portraitProfile: matching },
      { key: 'wrong-sex', portraitProfile: wrongSex },
    ])?.key).toBe('matching');
  });

  it('builds a stable profile key independent of duplicate tag input', () => {
    const first = createAvgPortraitMatchProfile({ sex: '女', age: 33, roleFamily: '商人', professionTags: ['行商', '行商'] })!;
    const second = createAvgPortraitMatchProfile({ sex: 'female', ageBand: 'adult', roleFamily: '商人', professionTags: ['行商'] })!;
    expect(avgPortraitProfileKey(first)).toBe(avgPortraitProfileKey(second));
  });

  it('leaves unrelated professions and incompatible or unknown ages unmatched', () => {
    const subject = createAvgPortraitMatchProfile({ sex: '男', age: 26, roleFamily: '军士' })!;
    for (const input of [{ age: 26, roleFamily: '文官' }, { age: 75, roleFamily: '军士' }, { age: 16, roleFamily: '军士' }, { roleFamily: '军士' }]) {
      expect(scoreAvgPortraitSimilarity(subject, createAvgPortraitMatchProfile({ sex: '男', ...input })!)).toBeUndefined();
    }
  });
});
