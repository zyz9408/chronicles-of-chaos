import { describe, expect, it } from 'vitest';
import {
  resolveThreeKingdomsPortraitSet,
  resolveThreeKingdomsSceneResource,
} from './ThreeKingdomsAvgResolver';

describe('ThreeKingdomsAvgResolver', () => {
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
