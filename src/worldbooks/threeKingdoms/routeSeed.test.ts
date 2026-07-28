import { describe, expect, it } from 'vitest';
import { buildMapV1Index, validateMapRouteEdge } from '../../engine/map/mapV1';
import { buildCurrentMapProjection } from '../../engine/map/runtimeMap';
import type { RuntimeState } from '../../engine/types';
import { ensureLuanShiState } from '../../engine/state/createInitialRuntimeState';
import { worldBook_ThreeKingdoms } from './index';

function makeLuoyangState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook_ThreeKingdoms.manifest.id,
    worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
    worldBookSource: worldBook_ThreeKingdoms.manifest.source,
    startDate: '189-09-01T08:00:00',
    currentDate: '公元189年09月01日 08:00（辰时）',
    player: {
      id: 'player',
      name: '刘达',
      roleType: 'traveler',
      summary: '',
    },
    currentLocationId: 'place_sili_luoyang',
    currentPlaceId: 'place_sili_luoyang',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
  });
}

describe('threeKingdoms routeSeed', () => {
  it('provides a nationwide topology route skeleton without isolated concrete places', () => {
    const index = buildMapV1Index(worldBook_ThreeKingdoms.openingLocationSeed ?? worldBook_ThreeKingdoms.mapSeed);
    const routes = worldBook_ThreeKingdoms.routeSeed ?? [];
    const endpointIds = new Set<string>();

    for (const route of routes) {
      expect(validateMapRouteEdge(index, route).valid, route.routeId).toBe(true);
      expect(route.routeKind, route.routeId).toBeTruthy();
      expect(route.standardTravelMinutes, route.routeId).toBeUndefined();
      endpointIds.add(route.fromPlaceId);
      endpointIds.add(route.toPlaceId);
    }

    const isolatedPlaces = index.places
      .filter((place) => !endpointIds.has(place.id))
      .map((place) => `${place.id}:${place.name}`);

    expect(routes.length).toBeGreaterThan(120);
    expect(isolatedPlaces).toEqual([]);
  });

  it('shows nearby topology routes for a Luoyang opening before route travel times are confirmed', () => {
    const projection = buildCurrentMapProjection(worldBook_ThreeKingdoms, makeLuoyangState(), {
      routeLimit: 24,
    });
    const nextStopIds = projection.nearbyRoutes.map((route) => route.toPlaceId);

    expect(projection.nearbyRoutes.length).toBeGreaterThan(0);
    expect(nextStopIds).toEqual(expect.arrayContaining([
      'place_sili_mengjin',
      'place_sili_yique_pass',
      'place_sili_hulao_pass',
      'place_sili_hangu_pass',
      'place_sili_xiaopingjin',
    ]));
    expect(nextStopIds).not.toEqual(expect.arrayContaining([
      'place_sili_huai',
      'place_yingchuan_yangdi',
      'place_yanzhou_chenliu',
      'loc_sili_hongnong_seat',
      'place_sili_changan',
    ]));
    expect(projection.nearbyRoutes.every((route) => route.travelTimeText === undefined)).toBe(true);
  });

  it('uses gates and ferries as intermediate nodes instead of making Luoyang a cross-region hub', () => {
    const routes = worldBook_ThreeKingdoms.routeSeed ?? [];
    const routePairs = new Set(
      routes.map((route) => [route.fromPlaceId, route.toPlaceId].sort().join('->')),
    );

    expect(routePairs.has(['place_sili_luoyang', 'place_yanzhou_chenliu'].sort().join('->'))).toBe(false);
    expect(routePairs.has(['place_sili_luoyang', 'place_yingchuan_yangdi'].sort().join('->'))).toBe(false);
    expect(routePairs.has(['place_sili_luoyang', 'place_sili_huai'].sort().join('->'))).toBe(false);
    expect(routePairs.has(['place_sili_luoyang', 'loc_sili_hongnong_seat'].sort().join('->'))).toBe(false);
    expect(routePairs.has(['place_sili_luoyang', 'place_sili_changan'].sort().join('->'))).toBe(false);
    expect(routePairs.has(['place_sili_hulao_pass', 'place_yanzhou_chenliu'].sort().join('->'))).toBe(true);
    expect(routePairs.has(['place_sili_yique_pass', 'place_yingchuan_yangdi'].sort().join('->'))).toBe(true);
    expect(routePairs.has(['place_sili_hangu_pass', 'loc_sili_hongnong_seat'].sort().join('->'))).toBe(true);
    expect(routePairs.has(['place_sili_mengjin', 'place_sili_huai'].sort().join('->'))).toBe(true);
  });

  it('keeps major Three Kingdoms corridors as chained first-hop topology instead of distant shortcuts', () => {
    const routes = worldBook_ThreeKingdoms.routeSeed ?? [];
    const routePairs = new Set(routes.map((route) => pairKey(route.fromPlaceId, route.toPlaceId)));

    expect(routePairs.has(pairKey('place_jingzhou_wan', 'place_jingzhou_xinye'))).toBe(true);
    expect(routePairs.has(pairKey('place_jingzhou_xinye', 'place_jingzhou_xiangyang'))).toBe(true);
    expect(routePairs.has(pairKey('place_jingzhou_xiangyang', 'place_jingzhou_jiangling'))).toBe(true);
    expect(routePairs.has(pairKey('place_jingzhou_wan', 'place_jingzhou_jiangling'))).toBe(false);

    expect(routePairs.has(pairKey('place_xuzhou_pengcheng_city', 'place_xuzhou_xiapi_city'))).toBe(true);
    expect(routePairs.has(pairKey('place_xuzhou_xiapi_city', 'place_xuzhou_tanxian'))).toBe(true);
    expect(routePairs.has(pairKey('place_yanzhou_chenliu', 'place_xuzhou_xiapi_city'))).toBe(false);

    expect(routePairs.has(pairKey('place_yizhou_chengdu', 'loc_yizhou_guanghan_seat'))).toBe(true);
    expect(routePairs.has(pairKey('loc_yizhou_guanghan_seat', 'place_yizhou_jiange_pass'))).toBe(true);
    expect(routePairs.has(pairKey('place_yizhou_jiange_pass', 'place_yizhou_nanzheng'))).toBe(true);
    expect(routePairs.has(pairKey('place_yizhou_chengdu', 'place_yizhou_jiange_pass'))).toBe(false);
    expect(routePairs.has(pairKey('place_yizhou_chengdu', 'place_yizhou_nanzheng'))).toBe(false);
  });

  it('covers Shu northern expedition corridors as mountain-route chains rather than Hanzhong shortcuts', () => {
    const routes = worldBook_ThreeKingdoms.routeSeed ?? [];
    const routePairs = new Set(routes.map((route) => pairKey(route.fromPlaceId, route.toPlaceId)));

    expect(routePairs.has(pairKey('place_yizhou_nanzheng', 'place_yizhou_yangping_pass'))).toBe(true);
    expect(routePairs.has(pairKey('place_yizhou_nanzheng', 'place_yizhou_baoxie_road'))).toBe(true);
    expect(routePairs.has(pairKey('place_yizhou_nanzheng', 'place_yizhou_chencang_road'))).toBe(true);
    expect(routePairs.has(pairKey('place_yizhou_nanzheng', 'place_yizhou_ziwu_valley'))).toBe(true);
    expect(routePairs.has(pairKey('place_yizhou_nanzheng', 'place_yizhou_tangluo_road'))).toBe(true);

    expect(routePairs.has(pairKey('place_yizhou_baoxie_road', 'place_sili_wuzhangyuan'))).toBe(true);
    expect(routePairs.has(pairKey('place_yizhou_chencang_road', 'place_sili_sanguan_pass'))).toBe(true);
    expect(routePairs.has(pairKey('place_sili_sanguan_pass', 'place_sili_chencang'))).toBe(true);
    expect(routePairs.has(pairKey('place_yizhou_ziwu_valley', 'place_sili_ziwu_north_mouth'))).toBe(true);
    expect(routePairs.has(pairKey('place_sili_ziwu_north_mouth', 'place_sili_changan'))).toBe(true);
    expect(routePairs.has(pairKey('place_yizhou_tangluo_road', 'place_sili_wuzhangyuan'))).toBe(true);

    expect(routePairs.has(pairKey('place_yizhou_yangping_pass', 'loc_liangzhou_wudu_seat'))).toBe(true);
    expect(routePairs.has(pairKey('loc_liangzhou_wudu_seat', 'place_liangzhou_qishan_fort'))).toBe(true);
    expect(routePairs.has(pairKey('place_liangzhou_qishan_fort', 'place_liangzhou_jieting'))).toBe(true);
    expect(routePairs.has(pairKey('place_liangzhou_jieting', 'place_liangzhou_jixian'))).toBe(true);

    expect(routePairs.has(pairKey('place_yizhou_nanzheng', 'place_sili_changan'))).toBe(false);
    expect(routePairs.has(pairKey('place_yizhou_nanzheng', 'place_liangzhou_jixian'))).toBe(false);
  });
});

function pairKey(fromPlaceId: string, toPlaceId: string): string {
  return [fromPlaceId, toPlaceId].sort().join('->');
}
