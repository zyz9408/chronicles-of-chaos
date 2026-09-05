import { describe, expect, it } from 'vitest';
import {
  resolveThreeKingdomsPortraitSet,
  resolveThreeKingdomsSceneResource,
} from './ThreeKingdomsAvgResolver';

describe('ThreeKingdomsAvgResolver', () => {
  it('strict pack matching rejects unknown identity, unrelated jobs, minors and wrong saved bindings', () => {
    const subject = { actorId: 'avg-local:gate:guard', name: '城头守卒', roleType: '军士', sex: 'male', ageBand: 'adult' };
    const selected = resolveThreeKingdomsPortraitSet(subject, { strict: true, preferredPortraitSetId: 'avg:threeKingdoms:generic:camp_cook_female_individual_a' });
    expect(selected?.profile.sex).toBe('male');
    expect(selected?.profile.professionTags?.some((tag) => ['infantry_spearman', 'infantry_swordsman_shield', 'constable'].includes(tag))).toBe(true);
    expect(resolveThreeKingdomsPortraitSet({ ...subject, sex: undefined }, { strict: true })).toBeUndefined();
    expect(resolveThreeKingdomsPortraitSet({ ...subject, ageBand: 'unknown' }, { strict: true })).toBeUndefined();
    expect(resolveThreeKingdomsPortraitSet({ ...subject, ageBand: 'child' }, { strict: true })).toBeUndefined();
    expect(resolveThreeKingdomsPortraitSet({ ...subject, name: '某人', roleType: '不存在的职业' }, { strict: true })).toBeUndefined();
  });
  it('resolves a historical actor by accepted registry label', () => {
    expect(resolveThreeKingdomsPortraitSet({ actorId: 'npc_cao_cao', name: '曹操', sex: '男' })?.portraitSetId)
      .toBe('avg:threeKingdoms:fixed:tk3k.male.cao_cao');
  });

  it('keeps generic portrait selection stable and sex-safe', () => {
    const subject = { actorId: 'npc_generated_guard_7', name: '守门军士', roleType: '军士', sex: '男' };
    const first = resolveThreeKingdomsPortraitSet(subject);
    const second = resolveThreeKingdomsPortraitSet(subject);
    expect(first?.portraitSetId).toBe(second?.portraitSetId);
    expect(first?.profile.sex).toBe('male');
  });

  it('resolves accepted scenes by runtime place id and a unique alias', () => {
    expect(resolveThreeKingdomsSceneResource({ runtimePlaceId: 'place_yingchuan_yangdi' })?.sceneResourceId)
      .toBe('avg:threeKingdoms:scene:place_yingchuan_yangdi');
    expect(resolveThreeKingdomsSceneResource({ labels: ['颍川阳翟县城南门'] })?.sceneResourceId)
      .toBe('avg:threeKingdoms:scene:place_yingchuan_yangdi');
  });
});
