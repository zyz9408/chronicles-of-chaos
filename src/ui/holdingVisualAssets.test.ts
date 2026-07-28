import { describe, expect, it } from 'vitest';
import type { HoldingPanelVisualProfile } from './holdingPanelModel';
import { resolveHoldingVisualAsset, resolveHoldingVisualAssetKey } from './holdingVisualAssets';

function makeProfile(overrides: Partial<HoldingPanelVisualProfile>): HoldingPanelVisualProfile {
  return {
    name: '颍川郡',
    locationId: 'place_yingchuan',
    type: 'county',
    typeText: '县邑',
    scaleText: '3级',
    statusText: '掌控',
    localEliteText: '豪强掌控 55%',
    collectionText: '实征 粮草 60% / 钱财 58%',
    caption: '县邑 · 3级 · 掌控 · 实征 粮草 60% / 钱财 58%',
    ...overrides,
  };
}

describe('holdingVisualAssets', () => {
  it('selects central regional scenery when no special city is matched', () => {
    const profile = makeProfile({});

    expect(resolveHoldingVisualAssetKey(profile)).toBe('holding_scene_region_central_normal_medium_v01.png');
    expect(resolveHoldingVisualAsset(profile)).toEqual({
      assetKey: 'holding_scene_region_central_normal_medium_v01.png',
      label: profile.caption,
    });
  });

  it('prioritizes a concrete holding type before special-city and regional scenery', () => {
    expect(resolveHoldingVisualAssetKey(makeProfile({
      name: '洛阳北营',
      locationId: 'place_luoyang_gate',
      type: 'camp',
      typeText: '军营',
      scaleText: '1级',
      statusText: '临管',
      caption: '军营 · 1级 · 临管 · 实征 粮草 60% / 钱财 58%',
    }))).toBe('holding_scene_type_camp_ruined_small_v01.png');

    expect(resolveHoldingVisualAssetKey(makeProfile({
      name: '襄阳城',
      locationId: 'place_xiangyang',
      type: 'city',
      typeText: '城池',
    }))).toBe('holding_scene_special_xiangyang_normal_medium_v01.png');
  });

  it('routes every dedicated holding type to its own scene family', () => {
    const fixtures = [
      ['堡垒', 'fort'],
      ['关隘', 'pass'],
      ['军营', 'camp'],
      ['庄园', 'estate'],
      ['港口', 'port'],
      ['乡里', 'village'],
    ] as const;

    for (const [typeText, key] of fixtures) {
      expect(resolveHoldingVisualAssetKey(makeProfile({
        name: `颍川${typeText}`,
        type: key,
        typeText,
      }))).toBe(`holding_scene_type_${key}_normal_medium_v01.png`);
    }
  });

  it('uses visual keywords only for other holdings and keeps the regional fallback', () => {
    expect(resolveHoldingVisualAssetKey(makeProfile({
      name: '云梦泽渡口',
      locationId: 'place_yunmeng_ferry',
      type: 'other',
      typeText: '其他',
    }))).toBe('holding_scene_visual_ferry_normal_medium_v01.png');

    for (const name of ['汉水船坞', '江夏水寨']) {
      expect(resolveHoldingVisualAssetKey(makeProfile({ name, type: 'other', typeText: '其他' })))
        .toBe('holding_scene_type_port_normal_medium_v01.png');
    }

    expect(resolveHoldingVisualAssetKey(makeProfile({ name: '山前营寨', type: 'other', typeText: '其他' })))
      .toBe('holding_scene_type_camp_normal_medium_v01.png');
    expect(resolveHoldingVisualAssetKey(makeProfile({ name: '峡谷关口', type: 'other', typeText: '其他' })))
      .toBe('holding_scene_type_pass_normal_medium_v01.png');
    expect(resolveHoldingVisualAssetKey(makeProfile({ name: '颍川别院', type: 'other', typeText: '其他' })))
      .toBe('holding_scene_region_central_normal_medium_v01.png');
  });

  it('selects regional scenery from location and name hints', () => {
    expect(resolveHoldingVisualAssetKey(makeProfile({
      name: '吴郡县城',
      locationId: 'place_jiangdong_wu',
    }))).toBe('holding_scene_region_jiangdong_normal_medium_v01.png');

    expect(resolveHoldingVisualAssetKey(makeProfile({
      name: '南中郡治',
      locationId: 'place_yizhou_nanzhong',
      scaleText: '5级',
      collectionText: '实征 粮草 78% / 钱财 76%',
    }))).toBe('holding_scene_region_southwest_prosperous_large_v01.png');
  });

  it('matches prosperity buckets from control condition, scale, and collection rate', () => {
    expect(resolveHoldingVisualAssetKey(makeProfile({
      scaleText: '2级',
      collectionText: '实征 粮草 26% / 钱财 25%',
    }))).toBe('holding_scene_region_central_ruined_small_v01.png');

    expect(resolveHoldingVisualAssetKey(makeProfile({
      scaleText: '5级',
      collectionText: '实征 粮草 80% / 钱财 76%',
    }))).toBe('holding_scene_region_central_prosperous_large_v01.png');
  });
});
