import { describe, expect, it } from 'vitest';
import { buildMapV1Index, buildPlaceDisplayPath, isStandableMapNode } from '../engine/map/mapV1';
import { worldBook_ThreeKingdoms } from '../worldbooks/threeKingdoms';
import {
  attachCustomOpeningPlaces,
  buildOpeningLocationSelection,
  createCustomOpeningPlace,
} from './openingLocation';

const threeKingdomsOpeningLocations = worldBook_ThreeKingdoms.openingLocationSeed ?? worldBook_ThreeKingdoms.mapSeed;

describe('buildOpeningLocationSelection', () => {
  it('builds an opening picker that stops at concrete place instead of scene', () => {
    const selection = buildOpeningLocationSelection(
      threeKingdomsOpeningLocations,
      'region_yuzhou',
      'loc_yingchuan',
      'place_yingchuan_yangdi',
    );

    expect(selection.regions.map((node) => node.name)).toContain('豫州');
    expect(selection.commanderies.map((node) => node.name)).toEqual(['颍川郡', '汝南郡', '梁国', '沛国', '陈国', '鲁国']);
    expect(selection.places.map((node) => node.name)).toEqual(
      expect.arrayContaining(['阳翟县城', '许县', '长社', '张氏坞堡', '太平道坛场附近']),
    );
    expect(selection.places.map((node) => node.name)).not.toEqual(
      expect.arrayContaining(['颍川郡', '市集', '官署']),
    );
    expect(selection.scenes.map((node) => node.name)).toEqual(
      expect.arrayContaining(['县衙', '市集', '客舍', '城门']),
    );
    expect(selection.pathLabel).toBe('豫州 - 颍川郡 - 阳翟县城');
  });

  it('keeps generated opening places concrete for every Three Kingdoms region', () => {
    const regionIds = threeKingdomsOpeningLocations.map((node) => node.id);

    for (const regionId of regionIds) {
      const selection = buildOpeningLocationSelection(threeKingdomsOpeningLocations, regionId, '', '', '');
      expect(selection.commanderies.length, regionId).toBeGreaterThan(0);
      expect(selection.commanderies[0]?.subLocations?.length ?? 0, regionId).toBeGreaterThan(0);
      expect(selection.commanderies[0]?.subLocations?.[0]?.subLocations?.length ?? 0, regionId).toBeGreaterThan(0);
    }

    const sili = buildOpeningLocationSelection(
      threeKingdomsOpeningLocations,
      'region_sili',
      'loc_sili_henan',
      'place_sili_luoyang',
    );
    expect(sili.commanderies.map((node) => node.name)).toEqual(
      expect.arrayContaining(['河南尹', '京兆尹', '河内郡']),
    );
    expect(sili.pathLabel).toBe('司隶 - 河南尹 - 洛阳城');

    const jizhou = buildOpeningLocationSelection(
      threeKingdomsOpeningLocations,
      'region_jizhou',
      'loc_jizhou_julu',
      'place_jizhou_julu_county',
    );
    expect(jizhou.pathLabel).toBe('冀州 - 巨鹿郡 - 巨鹿县城');
  });

  it('marks Three Kingdoms opening locations with Map V1 layers', () => {
    for (const region of threeKingdomsOpeningLocations) {
      expect(region.mapLayer, region.name).toBe('region');

      for (const commandery of region.subLocations ?? []) {
        expect(commandery.mapLayer, `${region.name} / ${commandery.name}`).toBe('region');

        for (const place of commandery.subLocations ?? []) {
          expect(place.mapLayer, `${region.name} / ${commandery.name} / ${place.name}`).toBe('place');

          for (const scene of place.subLocations ?? []) {
            expect(scene.mapLayer, `${region.name} / ${commandery.name} / ${place.name} / ${scene.name}`).toBe('scene');
          }
        }
      }
    }
  });

  it('lets Map V1 helpers treat only concrete opening places as standable', () => {
    const index = buildMapV1Index(threeKingdomsOpeningLocations);

    expect(isStandableMapNode(index.nodeById.region_yuzhou)).toBe(false);
    expect(isStandableMapNode(index.nodeById.loc_yingchuan)).toBe(false);
    expect(isStandableMapNode(index.nodeById.place_yingchuan_yangdi)).toBe(true);
    expect(isStandableMapNode(index.nodeById.scene_yingchuan_yangdi_market)).toBe(false);
    expect(buildPlaceDisplayPath(index, 'place_yingchuan_yangdi', 'scene_yingchuan_yangdi_market')).toBe(
      '豫州 - 颍川郡 - 阳翟县城 - 市集',
    );
  });

  it('uses the Three Kingdoms worldbook commandery catalog instead of hard-coding a small Yuzhou slice', () => {
    const expectedCommanderiesByRegion: Record<string, string[]> = {
      region_sili: ['河南尹', '河内郡', '河东郡', '弘农郡', '京兆尹', '左冯翊', '右扶风'],
      region_yuzhou: ['颍川郡', '汝南郡', '梁国', '沛国', '陈国', '鲁国'],
      region_jizhou: ['魏郡', '巨鹿郡', '常山国', '中山国', '安平国', '河间国', '清河国', '赵国', '渤海郡'],
      region_yanzhou: ['陈留郡', '东郡', '东平国', '任城国', '泰山郡', '济北国', '山阳郡', '济阴郡'],
      region_xuzhou: ['东海郡', '琅邪国', '彭城国', '广陵郡', '下邳国'],
      region_qingzhou: ['济南国', '平原郡', '乐安国', '北海国', '东莱郡', '齐国'],
      region_jingzhou: ['南阳郡', '南郡', '江夏郡', '零陵郡', '桂阳郡', '武陵郡', '长沙郡'],
      region_yangzhou: ['九江郡', '丹阳郡', '庐江郡', '会稽郡', '吴郡', '豫章郡'],
      region_yizhou: ['汉中郡', '巴郡', '广汉郡', '蜀郡', '犍为郡', '牂牁郡', '越巂郡', '益州郡', '永昌郡', '广汉属国', '蜀郡属国', '犍为属国'],
      region_liangzhou: ['陇西郡', '汉阳郡', '武都郡', '金城郡', '安定郡', '北地郡', '武威郡', '张掖郡', '酒泉郡', '敦煌郡', '张掖属国', '张掖居延属国'],
      region_bingzhou: ['上党郡', '太原郡', '上郡', '西河郡', '五原郡', '云中郡', '定襄郡', '雁门郡', '朔方郡'],
      region_youzhou: ['涿郡', '广阳郡', '代郡', '上谷郡', '渔阳郡', '右北平郡', '辽西郡', '辽东郡', '玄菟郡', '乐浪郡', '辽东属国'],
      region_jiaozhou: ['南海郡', '苍梧郡', '郁林郡', '合浦郡', '交趾郡', '九真郡', '日南郡'],
    };

    for (const [regionId, expectedCommanderies] of Object.entries(expectedCommanderiesByRegion)) {
      const selection = buildOpeningLocationSelection(threeKingdomsOpeningLocations, regionId, '', '');
      expect(selection.commanderies.map((node) => node.name), regionId).toEqual(expectedCommanderies);
      expect(selection.commanderies.every((node) => (node.subLocations?.length ?? 0) > 0), regionId).toBe(true);
    }
  });

  it('includes external regions and reasonable second-level external choices', () => {
    const regionNames = threeKingdomsOpeningLocations.map((node) => node.name);
    expect(regionNames).toEqual(expect.arrayContaining(['西域', '大漠', '朝鲜半岛', '倭地']));

    const westernRegions = buildOpeningLocationSelection(
      threeKingdomsOpeningLocations,
      'region_western_regions',
      '',
      '',
    );
    expect(westernRegions.commanderies.map((node) => node.name)).toEqual(
      expect.arrayContaining(['敦煌西道', '龟兹绿洲', '于阗绿洲']),
    );
    expect(westernRegions.places.map((node) => node.name)).toEqual(
      expect.arrayContaining(['玉门关外驿站', '楼兰故城']),
    );
  });

  it('can attach a player-defined opening place under the selected commandery', () => {
    const customPlace = createCustomOpeningPlace({
      id: 'custom_place_hidden_village',
      parentId: 'loc_yingchuan',
      name: '隐谷村',
      summary: '颍川山谷中的避乱村落，外人很少知道入口。',
    });
    expect(customPlace.mapLayer).toBe('place');

    const merged = attachCustomOpeningPlaces(threeKingdomsOpeningLocations, [customPlace]);
    const selection = buildOpeningLocationSelection(
      merged,
      'region_yuzhou',
      'loc_yingchuan',
      'custom_place_hidden_village',
    );

    expect(selection.places.map((node) => node.name)).toContain('隐谷村');
    expect(selection.selectedPlace?.summary).toBe('颍川山谷中的避乱村落，外人很少知道入口。');
    expect(selection.pathLabel).toBe('豫州 - 颍川郡 - 隐谷村');
  });
});
