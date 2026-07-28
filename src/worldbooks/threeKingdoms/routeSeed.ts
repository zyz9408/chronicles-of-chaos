import type { MapNode, MapRouteEdgeV1 } from '../../engine/types';
import { threeKingdomsOpeningLocationSeed } from './openingLocationSeed';

type RegionInfo = {
  id: string;
  name: string;
  connectedRegionIds: string[];
  commanderies: CommanderyInfo[];
};

type CommanderyInfo = {
  id: string;
  name: string;
  regionId: string;
  regionName: string;
  places: PlaceInfo[];
};

type PlaceInfo = {
  id: string;
  name: string;
  level: string;
  regionId: string;
  regionName: string;
  commanderyId: string;
  commanderyName: string;
};

type RouteContext = 'local' | 'regional' | 'interregional';

type RouteSegment = {
  fromPlaceId: string;
  toPlaceId: string;
  context: RouteContext;
};

const observedTimeNote = '世界书路线骨架，标准耗时待 LLM 亲历或确认后结构化写回。';

const interregionalRouteOverrides: Record<string, Array<{ fromPlaceId: string; toPlaceId: string }>> = {
  'region_sili|region_yuzhou': [
    { fromPlaceId: 'place_sili_yique_pass', toPlaceId: 'place_yingchuan_yangdi' },
  ],
  'region_sili|region_yanzhou': [
    { fromPlaceId: 'place_sili_hulao_pass', toPlaceId: 'place_yanzhou_chenliu' },
  ],
  'region_jizhou|region_sili': [
    { fromPlaceId: 'place_sili_mengjin', toPlaceId: 'place_jizhou_ye' },
  ],
  'region_jingzhou|region_sili': [
    { fromPlaceId: 'place_sili_yique_pass', toPlaceId: 'place_nanyang_wancheng' },
  ],
  'region_bingzhou|region_sili': [
    { fromPlaceId: 'place_sili_mengjin', toPlaceId: 'place_bingzhou_jinyang' },
  ],
};

const priorityRouteSegments: RouteSegment[] = [
  { fromPlaceId: 'place_sili_luoyang', toPlaceId: 'place_sili_hangu_pass', context: 'local' },
  { fromPlaceId: 'place_sili_luoyang', toPlaceId: 'place_sili_xiaopingjin', context: 'local' },
  { fromPlaceId: 'place_sili_luoyang', toPlaceId: 'place_sili_dagu_pass', context: 'local' },
  { fromPlaceId: 'place_sili_luoyang', toPlaceId: 'place_sili_guangcheng_pass', context: 'local' },
  { fromPlaceId: 'place_sili_luoyang', toPlaceId: 'place_sili_huanyuan_pass', context: 'local' },
  { fromPlaceId: 'place_sili_luoyang', toPlaceId: 'place_sili_xuanmen_pass', context: 'local' },
  { fromPlaceId: 'place_sili_hangu_pass', toPlaceId: 'loc_sili_hongnong_seat', context: 'regional' },
  { fromPlaceId: 'loc_sili_hongnong_seat', toPlaceId: 'place_sili_baling', context: 'regional' },
  { fromPlaceId: 'place_sili_xiaopingjin', toPlaceId: 'place_sili_huai', context: 'regional' },
  { fromPlaceId: 'place_sili_mengjin', toPlaceId: 'place_sili_heyang_ferry', context: 'regional' },
  { fromPlaceId: 'place_sili_hulao_pass', toPlaceId: 'place_yanzhou_chenliu', context: 'interregional' },
  { fromPlaceId: 'place_sili_yique_pass', toPlaceId: 'place_yingchuan_yangdi', context: 'interregional' },
  { fromPlaceId: 'place_sili_huanyuan_pass', toPlaceId: 'place_yingchuan_yangdi', context: 'interregional' },
  { fromPlaceId: 'place_sili_guangcheng_pass', toPlaceId: 'place_yingchuan_changshe', context: 'interregional' },
  { fromPlaceId: 'place_sili_dagu_pass', toPlaceId: 'place_yingchuan_changshe', context: 'interregional' },
  { fromPlaceId: 'place_sili_yique_pass', toPlaceId: 'place_jingzhou_wan', context: 'interregional' },

  { fromPlaceId: 'place_sili_changan', toPlaceId: 'loc_sili_youfengfu_seat', context: 'regional' },
  { fromPlaceId: 'loc_sili_youfengfu_seat', toPlaceId: 'loc_sili_zuofengyi_seat', context: 'regional' },
  { fromPlaceId: 'loc_sili_youfengfu_seat', toPlaceId: 'place_sili_chencang', context: 'regional' },
  { fromPlaceId: 'loc_sili_youfengfu_seat', toPlaceId: 'place_sili_wuzhangyuan', context: 'regional' },
  { fromPlaceId: 'place_sili_chencang', toPlaceId: 'place_sili_sanguan_pass', context: 'regional' },
  { fromPlaceId: 'place_sili_wuzhangyuan', toPlaceId: 'place_liangzhou_jieting', context: 'interregional' },
  { fromPlaceId: 'place_liangzhou_jixian', toPlaceId: 'place_liangzhou_didao', context: 'regional' },
  { fromPlaceId: 'place_liangzhou_didao', toPlaceId: 'place_liangzhou_guzang', context: 'regional' },

  { fromPlaceId: 'place_yingchuan_yangdi', toPlaceId: 'place_yingchuan_xuxian', context: 'regional' },
  { fromPlaceId: 'place_yingchuan_xuxian', toPlaceId: 'place_yanzhou_chenliu', context: 'interregional' },
  { fromPlaceId: 'place_yingchuan_xuxian', toPlaceId: 'place_runan_pingyu', context: 'regional' },
  { fromPlaceId: 'place_runan_pingyu', toPlaceId: 'loc_yangzhou_jiujiang_seat', context: 'interregional' },
  { fromPlaceId: 'place_yanzhou_chenliu', toPlaceId: 'place_yanzhou_suanzao', context: 'local' },
  { fromPlaceId: 'place_yanzhou_chenliu', toPlaceId: 'place_yanzhou_puyang', context: 'regional' },
  { fromPlaceId: 'place_yanzhou_puyang', toPlaceId: 'place_yanzhou_yellow_river_camp', context: 'local' },
  { fromPlaceId: 'place_yanzhou_chenliu', toPlaceId: 'place_xuzhou_pengcheng_city', context: 'interregional' },
  { fromPlaceId: 'place_xuzhou_pengcheng_city', toPlaceId: 'place_xuzhou_xiapi_city', context: 'regional' },
  { fromPlaceId: 'place_xuzhou_xiapi_city', toPlaceId: 'place_xuzhou_tanxian', context: 'regional' },
  { fromPlaceId: 'place_xuzhou_xiapi_city', toPlaceId: 'place_xuzhou_si_river_port', context: 'local' },
  { fromPlaceId: 'place_xuzhou_tanxian', toPlaceId: 'place_qingzhou_juxian', context: 'interregional' },

  { fromPlaceId: 'place_jingzhou_wan', toPlaceId: 'place_jingzhou_xinye', context: 'local' },
  { fromPlaceId: 'place_jingzhou_xinye', toPlaceId: 'place_jingzhou_xiangyang', context: 'regional' },
  { fromPlaceId: 'place_jingzhou_xiangyang', toPlaceId: 'place_jingzhou_jiangling', context: 'regional' },
  { fromPlaceId: 'place_jingzhou_jiangling', toPlaceId: 'place_jingzhou_hankou_ferry', context: 'regional' },
  { fromPlaceId: 'place_jingzhou_hankou_ferry', toPlaceId: 'place_jingzhou_xiling', context: 'regional' },
  { fromPlaceId: 'place_jingzhou_jiangling', toPlaceId: 'loc_jingzhou_changsha_seat', context: 'regional' },
  { fromPlaceId: 'place_jingzhou_jiangling', toPlaceId: 'loc_jingzhou_wuling_seat', context: 'regional' },

  { fromPlaceId: 'place_yizhou_chengdu', toPlaceId: 'loc_yizhou_guanghan_seat', context: 'regional' },
  { fromPlaceId: 'loc_yizhou_guanghan_seat', toPlaceId: 'place_yizhou_jiange_pass', context: 'regional' },
  { fromPlaceId: 'place_yizhou_jiange_pass', toPlaceId: 'place_yizhou_nanzheng', context: 'regional' },
  { fromPlaceId: 'place_yizhou_nanzheng', toPlaceId: 'place_yizhou_baoxie_road', context: 'local' },
  { fromPlaceId: 'place_yizhou_nanzheng', toPlaceId: 'place_yizhou_yangping_pass', context: 'local' },
  { fromPlaceId: 'place_yizhou_nanzheng', toPlaceId: 'place_yizhou_chencang_road', context: 'local' },
  { fromPlaceId: 'place_yizhou_nanzheng', toPlaceId: 'place_yizhou_ziwu_valley', context: 'local' },
  { fromPlaceId: 'place_yizhou_nanzheng', toPlaceId: 'place_yizhou_tangluo_road', context: 'local' },
  { fromPlaceId: 'place_yizhou_baoxie_road', toPlaceId: 'place_sili_wuzhangyuan', context: 'interregional' },
  { fromPlaceId: 'place_yizhou_chencang_road', toPlaceId: 'place_sili_sanguan_pass', context: 'interregional' },
  { fromPlaceId: 'place_yizhou_ziwu_valley', toPlaceId: 'place_sili_ziwu_north_mouth', context: 'interregional' },
  { fromPlaceId: 'place_sili_ziwu_north_mouth', toPlaceId: 'place_sili_changan', context: 'regional' },
  { fromPlaceId: 'place_yizhou_tangluo_road', toPlaceId: 'place_sili_wuzhangyuan', context: 'interregional' },
  { fromPlaceId: 'place_yizhou_yangping_pass', toPlaceId: 'loc_liangzhou_wudu_seat', context: 'interregional' },
  { fromPlaceId: 'loc_liangzhou_wudu_seat', toPlaceId: 'place_liangzhou_qishan_fort', context: 'regional' },
  { fromPlaceId: 'place_liangzhou_qishan_fort', toPlaceId: 'place_liangzhou_jieting', context: 'regional' },
  { fromPlaceId: 'place_liangzhou_jieting', toPlaceId: 'place_liangzhou_jixian', context: 'regional' },
  { fromPlaceId: 'place_yizhou_jiange_pass', toPlaceId: 'loc_yizhou_guanghan_shuguo_seat', context: 'regional' },
  { fromPlaceId: 'loc_yizhou_guanghan_shuguo_seat', toPlaceId: 'place_liangzhou_yinping_road', context: 'interregional' },
  { fromPlaceId: 'place_liangzhou_yinping_road', toPlaceId: 'loc_liangzhou_wudu_seat', context: 'regional' },
  { fromPlaceId: 'place_yizhou_chengdu', toPlaceId: 'place_yizhou_jiangzhou', context: 'regional' },
  { fromPlaceId: 'place_yizhou_jiangzhou', toPlaceId: 'place_yizhou_ba_river_port', context: 'local' },

  { fromPlaceId: 'place_jizhou_ye', toPlaceId: 'place_jizhou_linyang', context: 'regional' },
  { fromPlaceId: 'place_jizhou_ye', toPlaceId: 'place_jizhou_zhending', context: 'regional' },
  { fromPlaceId: 'place_jizhou_zhending', toPlaceId: 'place_youzhou_zhuoxian', context: 'interregional' },
  { fromPlaceId: 'place_jizhou_zhending', toPlaceId: 'place_bingzhou_changzi', context: 'interregional' },
  { fromPlaceId: 'place_bingzhou_changzi', toPlaceId: 'place_bingzhou_jinyang', context: 'regional' },
  { fromPlaceId: 'place_bingzhou_jinyang', toPlaceId: 'place_bingzhou_yanmen_pass', context: 'regional' },
  { fromPlaceId: 'place_youzhou_zhuoxian', toPlaceId: 'place_youzhou_yuyang_city', context: 'regional' },
  { fromPlaceId: 'place_youzhou_yuyang_city', toPlaceId: 'place_youzhou_wuhuan_market', context: 'regional' },

  { fromPlaceId: 'place_qingzhou_linzi', toPlaceId: 'place_qingzhou_pingyuan_city', context: 'regional' },
  { fromPlaceId: 'place_qingzhou_linzi', toPlaceId: 'place_qingzhou_juxian', context: 'regional' },
  { fromPlaceId: 'place_yangzhou_wanling', toPlaceId: 'place_yangzhou_wuxian', context: 'regional' },
  { fromPlaceId: 'place_yangzhou_wuxian', toPlaceId: 'place_yangzhou_loumen_port', context: 'local' },
  { fromPlaceId: 'place_yangzhou_wuxian', toPlaceId: 'place_yangzhou_shanyin', context: 'regional' },
  { fromPlaceId: 'place_jiaozhou_panyu', toPlaceId: 'place_jiaozhou_nanhai_port', context: 'local' },
  { fromPlaceId: 'place_jiaozhou_nanhai_port', toPlaceId: 'place_jiaozhou_hepu_city', context: 'regional' },
  { fromPlaceId: 'place_jiaozhou_hepu_city', toPlaceId: 'place_jiaozhou_longbian', context: 'regional' },
];

export const threeKingdomsRouteSeed: MapRouteEdgeV1[] = buildThreeKingdomsRouteSeed(
  threeKingdomsOpeningLocationSeed,
);

function buildThreeKingdomsRouteSeed(roots: MapNode[]): MapRouteEdgeV1[] {
  const topology = collectTopology(roots);
  const routes: MapRouteEdgeV1[] = [];
  const seenPairs = new Set<string>();

  const addRoute = (
    from: PlaceInfo | undefined,
    to: PlaceInfo | undefined,
    context: RouteContext,
  ) => {
    if (!from || !to || from.id === to.id) return;
    const pairKey = makePairKey(from.id, to.id);
    if (seenPairs.has(pairKey)) return;
    seenPairs.add(pairKey);

    const routeKind = inferRouteKind(from, to, context);
    const riskLevel = inferRiskLevel(from, to, context, routeKind);
    routes.push({
      routeId: `route_tk_${pairKey}`,
      fromPlaceId: from.id,
      toPlaceId: to.id,
      name: `${from.name}—${to.name}`,
      routeKind,
      status: riskLevel >= 55 ? '可通行但风险较高' : '可通行，耗时待确认',
      source: 'worldbook',
      knownLevel: '听闻',
      riskLevel,
      notes: observedTimeNote,
    });
  };

  for (const route of priorityRouteSegments) {
    addRoute(
      topology.placeById.get(route.fromPlaceId),
      topology.placeById.get(route.toPlaceId),
      route.context,
    );
  }

  for (const region of topology.regions) {
    for (const commandery of region.commanderies) {
      const hub = commandery.places[0];
      for (const place of commandery.places.slice(1)) {
        addRoute(hub, place, 'local');
      }
    }

    const commanderyHubs = region.commanderies
      .map((commandery) => commandery.places[0])
      .filter((place): place is PlaceInfo => Boolean(place));

    for (let index = 0; index < commanderyHubs.length - 1; index += 1) {
      addRoute(
        getCommanderyExit(topology.commanderyByHubPlaceId.get(commanderyHubs[index].id)),
        commanderyHubs[index + 1],
        'regional',
      );
    }
  }

  for (const region of topology.regions) {
    for (const connectedRegionId of region.connectedRegionIds) {
      if (region.id.localeCompare(connectedRegionId) > 0) continue;
      const connectedRegion = topology.regionById.get(connectedRegionId);
      const overrideRoutes = getInterregionalRouteOverrides(region.id, connectedRegionId);
      if (overrideRoutes.length > 0) {
        for (const overrideRoute of overrideRoutes) {
          addRoute(
            topology.placeById.get(overrideRoute.fromPlaceId),
            topology.placeById.get(overrideRoute.toPlaceId),
            'interregional',
          );
        }
        continue;
      }

      addRoute(getRegionGateway(region), getRegionGateway(connectedRegion), 'interregional');
    }
  }

  return routes;
}

function collectTopology(roots: MapNode[]): {
  regions: RegionInfo[];
  regionById: Map<string, RegionInfo>;
  placeById: Map<string, PlaceInfo>;
  commanderyByHubPlaceId: Map<string, CommanderyInfo>;
} {
  const regions = roots.map((region): RegionInfo => ({
    id: region.id,
    name: region.name,
    connectedRegionIds: region.connectedRegionIds ?? [],
    commanderies: (region.subLocations ?? [])
      .filter((node) => node.mapLayer === 'region')
      .map((commandery) => ({
        id: commandery.id,
        name: commandery.name,
        regionId: region.id,
        regionName: region.name,
        places: collectPlaces(commandery, {
          regionId: region.id,
          regionName: region.name,
          commanderyId: commandery.id,
          commanderyName: commandery.name,
        }),
      }))
      .filter((commandery) => commandery.places.length > 0),
  }));

  const placeById = new Map<string, PlaceInfo>();
  const commanderyByHubPlaceId = new Map<string, CommanderyInfo>();
  for (const region of regions) {
    for (const commandery of region.commanderies) {
      if (commandery.places[0]) {
        commanderyByHubPlaceId.set(commandery.places[0].id, commandery);
      }
      for (const place of commandery.places) {
        placeById.set(place.id, place);
      }
    }
  }

  return {
    regions,
    regionById: new Map(regions.map((region) => [region.id, region])),
    placeById,
    commanderyByHubPlaceId,
  };
}

function collectPlaces(
  node: MapNode,
  scope: Pick<PlaceInfo, 'regionId' | 'regionName' | 'commanderyId' | 'commanderyName'>,
): PlaceInfo[] {
  const places: PlaceInfo[] = [];
  const visit = (current: MapNode) => {
    if (current.mapLayer === 'place') {
      places.push({
        id: current.id,
        name: current.name,
        level: current.level,
        ...scope,
      });
      return;
    }

    for (const child of current.subLocations ?? []) {
      visit(child);
    }
  };

  for (const child of node.subLocations ?? []) {
    visit(child);
  }
  return places;
}

function getRegionHub(region: RegionInfo | undefined): PlaceInfo | undefined {
  return region?.commanderies.find((commandery) => commandery.places.length > 0)?.places[0];
}

function getCommanderyExit(commandery: CommanderyInfo | undefined): PlaceInfo | undefined {
  if (!commandery) return undefined;
  const hub = commandery.places[0];
  return (
    commandery.places.find((place) => place.id !== hub?.id && isGatewayPlace(place)) ??
    commandery.places.find((place) => place.id !== hub?.id) ??
    hub
  );
}

function getRegionGateway(region: RegionInfo | undefined): PlaceInfo | undefined {
  if (!region) return undefined;
  return (
    region.commanderies.flatMap((commandery) => commandery.places).find(isGatewayPlace) ??
    getRegionHub(region)
  );
}

function isGatewayPlace(place: PlaceInfo): boolean {
  return /关|渡|津|港口|码头|驿站|道口|塞|谷/.test(`${place.name}${place.level}`);
}

function getInterregionalRouteOverrides(
  regionId: string,
  connectedRegionId: string,
): Array<{ fromPlaceId: string; toPlaceId: string }> {
  const key = [regionId, connectedRegionId].sort().join('|');
  return interregionalRouteOverrides[key] ?? [];
}

function makePairKey(fromPlaceId: string, toPlaceId: string): string {
  return [fromPlaceId, toPlaceId]
    .sort()
    .map((id) => id.replace(/^place_/, ''))
    .join('__');
}

function inferRouteKind(
  from: PlaceInfo,
  to: PlaceInfo,
  context: 'local' | 'regional' | 'interregional',
): string {
  const text = `${from.name}${from.level}${from.regionName}${to.name}${to.level}${to.regionName}`;
  if (/海|湾|倭|港口|航路/.test(text)) return '海路';
  if (/江|河|水|渡|津|浦|码头/.test(text)) return /渡|津/.test(text) ? '渡口' : '水路';
  if (/关|塞|道口/.test(text)) return '关道';
  if (/山|岭|谷|峡|寨/.test(text)) return '山道';
  if (/边|羌|胡|乌桓|鲜卑|西域|大漠|塞/.test(text)) return '边道';
  if (context === 'local' && /坞堡|营寨|聚落|驿站|市镇/.test(text)) return '小路';
  return '官道';
}

function inferRiskLevel(
  from: PlaceInfo,
  to: PlaceInfo,
  context: 'local' | 'regional' | 'interregional',
  routeKind: string,
): number {
  const text = `${from.name}${from.level}${from.regionName}${to.name}${to.level}${to.regionName}`;
  let risk = context === 'local' ? 25 : context === 'regional' ? 35 : 45;
  if (/黄巾|营寨|山寨|坞堡|边|羌|胡|乌桓|鲜卑|西域|大漠|倭|海/.test(text)) {
    risk += 15;
  }
  if (routeKind === '水路' || routeKind === '渡口' || routeKind === '山道' || routeKind === '海路') {
    risk += 5;
  }
  return Math.min(risk, 75);
}
