import type { MapLayerKind, MapNode } from '../../engine/types';
import { threeKingdomsMapSeed } from './mapSeed';

type OpeningScene = {
  id: string;
  name: string;
  summary?: string;
};

type OpeningPlace = {
  id: string;
  name: string;
  level?: string;
  summary?: string;
  scenes?: OpeningScene[];
};

type OpeningCommandery = {
  id: string;
  name: string;
  level?: string;
  summary: string;
  controlHint: string;
  tensionHint: string;
  places: OpeningPlace[];
};

type HistoricalOpeningCommandery = {
  id: string;
  name: string;
  seat: string;
  seatLevel?: string;
  level?: string;
  aliases?: string[];
};

const historicalCommanderiesByRegion: Record<string, HistoricalOpeningCommandery[]> = {
  region_sili: [
    { id: 'loc_sili_henan', name: '河南尹', level: '尹', seat: '洛阳城' },
    { id: 'loc_sili_henei', name: '河内郡', seat: '怀县城' },
    { id: 'loc_sili_hedong', name: '河东郡', seat: '安邑县城' },
    { id: 'loc_sili_hongnong', name: '弘农郡', seat: '弘农县城' },
    { id: 'loc_sili_jingzhao', name: '京兆尹', level: '尹', seat: '长安城' },
    { id: 'loc_sili_zuofengyi', name: '左冯翊', level: '郡级', seat: '高陵县城' },
    { id: 'loc_sili_youfengfu', name: '右扶风', level: '郡级', seat: '槐里县城' },
  ],
  region_yuzhou: [
    { id: 'loc_yingchuan', name: '颍川郡', seat: '阳翟县城' },
    { id: 'loc_runan', name: '汝南郡', seat: '平舆县城' },
    { id: 'loc_yuzhou_liang', name: '梁国', level: '国', seat: '下邑县城' },
    { id: 'loc_yuzhou_pei', name: '沛国', level: '国', seat: '相县城' },
    { id: 'loc_yuzhou_chen', name: '陈国', level: '国', seat: '陈县城' },
    { id: 'loc_yuzhou_lu', name: '鲁国', level: '国', seat: '鲁县城' },
  ],
  region_jizhou: [
    { id: 'loc_jizhou_wei', name: '魏郡', seat: '邺城' },
    { id: 'loc_jizhou_julu', name: '巨鹿郡', seat: '瘿陶县城' },
    { id: 'loc_jizhou_changshan', name: '常山国', level: '国', seat: '元氏县城' },
    { id: 'loc_jizhou_zhongshan', name: '中山国', level: '国', seat: '卢奴县城' },
    { id: 'loc_jizhou_anping', name: '安平国', level: '国', seat: '信都县城' },
    { id: 'loc_jizhou_hejian', name: '河间国', level: '国', seat: '乐城县城' },
    { id: 'loc_jizhou_qinghe', name: '清河国', level: '国', seat: '甘陵县城' },
    { id: 'loc_jizhou_zhao', name: '赵国', level: '国', seat: '邯郸城' },
    { id: 'loc_jizhou_bohai', name: '渤海郡', seat: '南皮县城' },
  ],
  region_yanzhou: [
    { id: 'loc_yanzhou_chenliu', name: '陈留郡', seat: '陈留县城' },
    { id: 'loc_yanzhou_dongjun', name: '东郡', seat: '濮阳城' },
    { id: 'loc_yanzhou_dongping', name: '东平国', level: '国', seat: '无盐县城' },
    { id: 'loc_yanzhou_rencheng', name: '任城国', level: '国', seat: '任城县城' },
    { id: 'loc_yanzhou_taishan', name: '泰山郡', seat: '奉高县城' },
    { id: 'loc_yanzhou_jibei', name: '济北国', level: '国', seat: '卢县城' },
    { id: 'loc_yanzhou_shanyang', name: '山阳郡', seat: '昌邑县城' },
    { id: 'loc_yanzhou_jiyin', name: '济阴郡', seat: '定陶县城' },
  ],
  region_xuzhou: [
    { id: 'loc_xuzhou_donghai', name: '东海郡', seat: '郯县城' },
    { id: 'loc_xuzhou_langye', name: '琅邪国', level: '国', seat: '开阳县城' },
    { id: 'loc_xuzhou_pengcheng', name: '彭城国', level: '国', seat: '彭城' },
    { id: 'loc_xuzhou_guangling', name: '广陵郡', seat: '广陵城' },
    { id: 'loc_xuzhou_xiapi', name: '下邳国', level: '国', seat: '下邳城' },
  ],
  region_qingzhou: [
    { id: 'loc_qingzhou_jinan', name: '济南国', level: '国', seat: '东平陵县城' },
    { id: 'loc_qingzhou_pingyuan', name: '平原郡', seat: '平原县城' },
    { id: 'loc_qingzhou_lean', name: '乐安国', level: '国', seat: '临济县城' },
    { id: 'loc_qingzhou_beihai', name: '北海国', level: '国', seat: '剧县城' },
    { id: 'loc_qingzhou_donglai', name: '东莱郡', seat: '黄县城' },
    { id: 'loc_qingzhou_qi', name: '齐国', level: '国', seat: '临淄城' },
  ],
  region_jingzhou: [
    { id: 'loc_jingzhou_nanyang', name: '南阳郡', seat: '宛城' },
    { id: 'loc_jingzhou_nanjun', name: '南郡', seat: '江陵城' },
    { id: 'loc_jingzhou_jiangxia', name: '江夏郡', seat: '西陵城' },
    { id: 'loc_jingzhou_lingling', name: '零陵郡', seat: '泉陵县城' },
    { id: 'loc_jingzhou_guiyang', name: '桂阳郡', seat: '郴县城' },
    { id: 'loc_jingzhou_wuling', name: '武陵郡', seat: '临沅县城' },
    { id: 'loc_jingzhou_changsha', name: '长沙郡', seat: '临湘县城' },
  ],
  region_yangzhou: [
    { id: 'loc_yangzhou_jiujiang', name: '九江郡', seat: '寿春县城' },
    { id: 'loc_yangzhou_danyang', name: '丹阳郡', seat: '宛陵县城' },
    { id: 'loc_yangzhou_lujiang', name: '庐江郡', seat: '舒县城' },
    { id: 'loc_yangzhou_kuaiji', name: '会稽郡', seat: '山阴县城' },
    { id: 'loc_yangzhou_wu', name: '吴郡', seat: '吴县城' },
    { id: 'loc_yangzhou_yuzhang', name: '豫章郡', seat: '南昌县城' },
  ],
  region_yizhou: [
    { id: 'loc_yizhou_hanzhong', name: '汉中郡', seat: '南郑城' },
    { id: 'loc_yizhou_ba', name: '巴郡', seat: '江州城' },
    { id: 'loc_yizhou_guanghan', name: '广汉郡', seat: '雒县城' },
    { id: 'loc_yizhou_shu', name: '蜀郡', seat: '成都城' },
    { id: 'loc_yizhou_qianwei', name: '犍为郡', seat: '武阳县城' },
    { id: 'loc_yizhou_zangke', name: '牂牁郡', seat: '且兰县城' },
    { id: 'loc_yizhou_yuexi', name: '越巂郡', seat: '邛都县城' },
    { id: 'loc_yizhou_yizhou', name: '益州郡', seat: '滇池县城' },
    { id: 'loc_yizhou_yongchang', name: '永昌郡', seat: '不韦县城' },
    { id: 'loc_yizhou_guanghan_shuguo', name: '广汉属国', level: '属国', seat: '阴平县城' },
    { id: 'loc_yizhou_shu_shuguo', name: '蜀郡属国', level: '属国', seat: '汉嘉县城' },
    { id: 'loc_yizhou_qianwei_shuguo', name: '犍为属国', level: '属国', seat: '朱提县城' },
  ],
  region_liangzhou: [
    { id: 'loc_liangzhou_longxi', name: '陇西郡', seat: '狄道县城' },
    { id: 'loc_liangzhou_hanyang', name: '汉阳郡', seat: '冀县城', aliases: ['天水郡'] },
    { id: 'loc_liangzhou_wudu', name: '武都郡', seat: '下辨县城' },
    { id: 'loc_liangzhou_jincheng', name: '金城郡', seat: '允吾县城' },
    { id: 'loc_liangzhou_anding', name: '安定郡', seat: '临泾县城' },
    { id: 'loc_liangzhou_beidi', name: '北地郡', seat: '富平县城' },
    { id: 'loc_liangzhou_wuwei', name: '武威郡', seat: '姑臧城' },
    { id: 'loc_liangzhou_zhangye', name: '张掖郡', seat: '觻得县城' },
    { id: 'loc_liangzhou_jiuquan', name: '酒泉郡', seat: '禄福县城' },
    { id: 'loc_liangzhou_dunhuang', name: '敦煌郡', seat: '敦煌县城' },
    { id: 'loc_liangzhou_zhangye_shuguo', name: '张掖属国', level: '属国', seat: '居延泽南营', seatLevel: '营寨' },
    { id: 'loc_liangzhou_juyan_shuguo', name: '张掖居延属国', level: '属国', seat: '居延塞', seatLevel: '关隘' },
  ],
  region_bingzhou: [
    { id: 'loc_bingzhou_shangdang', name: '上党郡', seat: '长子县城' },
    { id: 'loc_bingzhou_taiyuan', name: '太原郡', seat: '晋阳城' },
    { id: 'loc_bingzhou_shangjun', name: '上郡', seat: '肤施县城' },
    { id: 'loc_bingzhou_xihe', name: '西河郡', seat: '离石县城' },
    { id: 'loc_bingzhou_wuyuan', name: '五原郡', seat: '九原县城' },
    { id: 'loc_bingzhou_yunzhong', name: '云中郡', seat: '云中县城' },
    { id: 'loc_bingzhou_dingxiang', name: '定襄郡', seat: '成乐县城' },
    { id: 'loc_bingzhou_yanmen', name: '雁门郡', seat: '阴馆县城' },
    { id: 'loc_bingzhou_shuofang', name: '朔方郡', seat: '临戎县城' },
  ],
  region_youzhou: [
    { id: 'loc_youzhou_zhuo', name: '涿郡', seat: '涿县城' },
    { id: 'loc_youzhou_guangyang', name: '广阳郡', seat: '蓟县城' },
    { id: 'loc_youzhou_dai', name: '代郡', seat: '高柳县城' },
    { id: 'loc_youzhou_shanggu', name: '上谷郡', seat: '沮阳县城' },
    { id: 'loc_youzhou_yuyang', name: '渔阳郡', seat: '渔阳城' },
    { id: 'loc_youzhou_youbeiping', name: '右北平郡', seat: '土垠县城' },
    { id: 'loc_youzhou_liaoxi', name: '辽西郡', seat: '阳乐县城' },
    { id: 'loc_youzhou_liaodong', name: '辽东郡', seat: '襄平县城' },
    { id: 'loc_youzhou_xuantu', name: '玄菟郡', seat: '高句骊县城' },
    { id: 'loc_youzhou_lelang', name: '乐浪郡', seat: '朝鲜县城' },
    { id: 'loc_youzhou_liaodong_shuguo', name: '辽东属国', level: '属国', seat: '昌黎县城' },
  ],
  region_jiaozhou: [
    { id: 'loc_jiaozhou_nanhai', name: '南海郡', seat: '番禺城' },
    { id: 'loc_jiaozhou_cangwu', name: '苍梧郡', seat: '广信县城' },
    { id: 'loc_jiaozhou_yulin', name: '郁林郡', seat: '布山县城' },
    { id: 'loc_jiaozhou_hepu', name: '合浦郡', seat: '合浦城' },
    { id: 'loc_jiaozhou_jiaozhi', name: '交趾郡', seat: '龙编城' },
    { id: 'loc_jiaozhou_jiuzhen', name: '九真郡', seat: '胥浦县城' },
    { id: 'loc_jiaozhou_rinan', name: '日南郡', seat: '西卷县城' },
  ],
};

const commanderyLevel = (item: HistoricalOpeningCommandery): string => {
  if (item.level) return item.level;
  if (item.name.endsWith('国')) return '国';
  if (item.name.endsWith('属国')) return '属国';
  return '郡';
};

const historicalControlHint = (item: HistoricalOpeningCommandery): string => {
  const level = commanderyLevel(item);
  if (level === '国') return `${item.name}相与地方豪族`;
  if (level === '尹') return `${item.name}官署`;
  if (level === '属国') return `${item.name}都尉与边地部族`;
  return `${item.name}太守与地方豪族`;
};

const historicalTensionHint = (regionId: string): string => {
  if (['region_liangzhou', 'region_bingzhou', 'region_youzhou'].includes(regionId)) {
    return '中高 - 边军、豪强与外部势力交错';
  }
  if (['region_yuzhou', 'region_jizhou', 'region_yanzhou', 'region_qingzhou'].includes(regionId)) {
    return '高 - 黄巾余波、豪族自保与官府征发并存';
  }
  if (regionId === 'region_jiaozhou') {
    return '低中 - 地远政疏，汉官、土豪与商路并存';
  }
  return '中 - 地方豪族、官府和乱世传闻并行';
};

const genericHistoricalCommandery = (regionId: string, item: HistoricalOpeningCommandery): OpeningCommandery => ({
  id: item.id,
  name: item.name,
  level: commanderyLevel(item),
  summary: `${item.name}为东汉末年本州郡国之一，治所可作为玩家开局的具体落点。`,
  controlHint: historicalControlHint(item),
  tensionHint: historicalTensionHint(regionId),
  places: [
      {
        id: `${item.id}_seat`,
        name: item.seat,
        level: item.seatLevel ?? (item.seat.endsWith('城') ? '城邑' : '县城'),
        summary: `${item.name}治所，适合作为史实开局落点。若玩家需要更细地点，可使用自定义地点补充。`,
      },
  ],
});

const mergeHistoricalCommanderies = (regionId: string, curatedItems: OpeningCommandery[]): OpeningCommandery[] => {
  const historicalItems = historicalCommanderiesByRegion[regionId];
  if (!historicalItems) return curatedItems;

  return historicalItems.map((historicalItem) => {
    const curatedItem = curatedItems.find((item) => (
      item.name === historicalItem.name || historicalItem.aliases?.includes(item.name)
    ));

    if (!curatedItem) return genericHistoricalCommandery(regionId, historicalItem);

    return {
      ...curatedItem,
      id: historicalItem.id,
      name: historicalItem.name,
      level: curatedItem.level ?? commanderyLevel(historicalItem),
    };
  });
};

const scene = (parentId: string, item: OpeningScene, parent: OpeningPlace, commandery: OpeningCommandery): MapNode => ({
  id: item.id,
  name: item.name,
  level: '场景',
  mapLayer: 'scene',
  summary: item.summary ?? `${parent.name}内的${item.name}，可作为开局第一幕的具体场所。`,
  connectedRegionIds: [],
  controlHint: commandery.controlHint,
  tensionHint: commandery.tensionHint,
  parentId,
});

const defaultScenes = (place: OpeningPlace): OpeningScene[] => [
  { id: `${place.id}_office`, name: place.level === '关隘' ? '关门' : '官署', summary: `${place.name}的公事所在，消息、命令与人情往来集中于此。` },
  { id: `${place.id}_market`, name: '市集', summary: `${place.name}中商旅百姓聚散之处，适合打听风声。` },
  { id: `${place.id}_inn`, name: '客舍', summary: `${place.name}里外来人落脚之处，容易遇见行商、游侠与流民。` },
];

const place = (commandery: OpeningCommandery, item: OpeningPlace): MapNode => ({
  id: item.id,
  name: item.name,
  level: item.level ?? '县城',
  mapLayer: 'place',
  summary: item.summary ?? `${commandery.name}内的具体地点，可作为玩家开局落点。`,
  connectedRegionIds: [],
  controlHint: commandery.controlHint,
  tensionHint: commandery.tensionHint,
  parentId: commandery.id,
  subLocations: (item.scenes ?? defaultScenes(item)).map((child) => scene(item.id, child, item, commandery)),
});

const commandery = (regionId: string, item: OpeningCommandery): MapNode => ({
  id: item.id,
  name: item.name,
  level: item.level ?? '郡',
  mapLayer: 'region',
  summary: item.summary,
  connectedRegionIds: [],
  controlHint: item.controlHint,
  tensionHint: item.tensionHint,
  parentId: regionId,
  subLocations: item.places.map((child) => place(item, child)),
});

const openingCommanderiesByRegion: Record<string, OpeningCommandery[]> = {
  region_sili: [
    {
      id: 'loc_sili_henan',
      name: '河南尹',
      level: '尹',
      summary: '洛阳所在，宫禁、朝署、士人与军兵密集，天下消息在此汇流。',
      controlHint: '汉廷中枢',
      tensionHint: '极高 - 宦官、外戚与军阀权力交错',
      places: [
        {
          id: 'place_sili_luoyang',
          name: '洛阳城',
          level: '城邑',
          summary: '东汉都城，宫阙、官署、南北市与士人宅第交错。',
          scenes: [
            { id: 'scene_sili_luoyang_palace_gate', name: '宫门外', summary: '宫门紧闭，禁军与宦官心腹把守，朝中风声先从这里露出端倪。' },
            { id: 'scene_sili_luoyang_shangshu', name: '尚书台门前', summary: '公文与诏令往来频繁，小吏、门生、士人都在此打探消息。' },
            { id: 'scene_sili_luoyang_south_market', name: '南市', summary: '商旅云集，流言最快也最杂。' },
            { id: 'scene_sili_luoyang_inn', name: '客舍', summary: '外郡士人和游侠暂住之处，夜里常有人低声议论朝局。' },
          ],
        },
        { id: 'place_sili_mengjin', name: '孟津渡口', level: '渡口', summary: '黄河南岸要渡，军令、粮船和逃难者都可能经过。' },
        { id: 'place_sili_yique_pass', name: '伊阙关', level: '关隘', summary: '洛阳南面的门户，进出京畿者多受盘查。' },
        { id: 'place_sili_hulao_pass', name: '虎牢关', level: '关隘', summary: '洛阳东面的险关，控扼成皋道路，关东兵马入京多绕不开此处。' },
        { id: 'place_sili_hangu_pass', name: '函谷关', level: '关隘', summary: '洛阳西出的重关，连通弘农与关中，道路险峻且盘查严密。' },
        { id: 'place_sili_xiaopingjin', name: '小平津', level: '渡口', summary: '洛阳北侧黄河津渡，渡河后可入河内、河北诸道。' },
        { id: 'place_sili_dagu_pass', name: '大谷关', level: '关隘', summary: '洛阳东南山口，山道狭窄，适合小队往来与伏击。' },
        { id: 'place_sili_guangcheng_pass', name: '广成关', level: '关隘', summary: '洛阳南向外缘关道，接近颍川、南阳之间的道路。' },
        { id: 'place_sili_huanyuan_pass', name: '轘辕关', level: '关隘', summary: '洛阳东南险关，扼守通向颍川的山路。' },
        { id: 'place_sili_xuanmen_pass', name: '旋门关', level: '关隘', summary: '京畿外缘关口之一，守军、商旅与探马消息混杂。' },
      ],
    },
    {
      id: 'loc_sili_jingzhao',
      name: '京兆尹',
      level: '尹',
      summary: '长安一带，旧都余威仍在，西来兵马常经此地。',
      controlHint: '京兆官署',
      tensionHint: '高 - 旧都与西凉势力相接',
      places: [
        { id: 'place_sili_changan', name: '长安城', level: '城邑', summary: '旧都城郭仍显宏阔，官署、军营与市井杂处。' },
        { id: 'place_sili_baling', name: '霸陵驿', level: '驿站', summary: '长安东面的驿站，官差、商旅和军使往来不断。' },
        { id: 'place_sili_lantian', name: '蓝田县城', level: '县城', summary: '关中东南门户，乡里豪强和官府都盯着山道。' },
        { id: 'place_sili_ziwu_north_mouth', name: '子午谷北口', level: '谷口', summary: '子午道北出关中之处，山路险窄，若有奇兵穿谷，长安南面最先受惊。' },
      ],
    },
    {
      id: 'loc_sili_youfengfu',
      name: '右扶风',
      level: '郡级',
      summary: '关中西部郡级区域，陈仓、散关一线控扼入蜀与入陇的山口。',
      controlHint: '右扶风官署与关中军镇',
      tensionHint: '高 - 关中西门，蜀道与陇右消息交会',
      places: [
        { id: 'loc_sili_youfengfu_seat', name: '槐里县城', level: '县城', summary: '右扶风治所，关中西行的官道、军令和粮运多在此分派。' },
        { id: 'place_sili_chencang', name: '陈仓城', level: '城邑', summary: '关中西南要城，北接渭水，南控散关与陈仓道，是蜀军北出时绕不开的门户。' },
        { id: 'place_sili_sanguan_pass', name: '散关', level: '关隘', summary: '陈仓南面的险关，扼守陈仓道北口，关楼、栈道与山谷互相逼仄。' },
        { id: 'place_sili_wuzhangyuan', name: '五丈原', level: '营垒', summary: '渭水南岸原野，向西连陇右，向南接斜谷、傥骆诸道，适合扎营对峙。' },
      ],
    },
    {
      id: 'loc_sili_henei',
      name: '河内郡',
      summary: '黄河北岸要地，近接洛阳，世家与地方军力并存。',
      controlHint: '河内太守',
      tensionHint: '中高 - 京畿侧翼',
      places: [
        { id: 'place_sili_huai', name: '怀县城', level: '县城', summary: '河内郡治，官府与地方豪族关系紧密。' },
        { id: 'place_sili_wen', name: '温县', level: '县城', summary: '河内名县，士族、商旅与河道消息交错。' },
        { id: 'place_sili_heyang_ferry', name: '河阳津', level: '渡口', summary: '黄河渡津，连接京畿与河北的交通点。' },
      ],
    },
  ],
  region_yuzhou: [
    {
      id: 'loc_yingchuan',
      name: '颍川郡',
      summary: '士族云集之地，荀氏、陈氏、钟氏等大族根基深厚，太平道暗流也在乡里蔓延。',
      controlHint: '颍川太守名义管辖，豪族实际影响极重',
      tensionHint: '高 - 士族、官府与黄巾暗流并存',
      places: [
        {
          id: 'place_yingchuan_yangdi',
          name: '阳翟县城',
          level: '县城',
          summary: '颍川要县，官署、市集、学馆俱全，士人往来频繁。',
          scenes: [
            { id: 'scene_yingchuan_yangdi_yamen', name: '县衙', summary: '县中公事所在，差役、书吏与告状百姓都聚在门前。' },
            { id: 'scene_yingchuan_yangdi_market', name: '市集', summary: '南北货物与乡里传闻交汇，三教九流都能遇见。' },
            { id: 'scene_yingchuan_yangdi_inn', name: '客舍', summary: '外来士人、商旅、游侠落脚之处。' },
            { id: 'scene_yingchuan_yangdi_gate', name: '城门', summary: '进出县城必经之地，流民与兵差常在此冲突。' },
          ],
        },
        { id: 'place_yingchuan_xuxian', name: '许县', level: '县城', summary: '颍川东部要县，乡里豪族和官府关系盘根错节。' },
        { id: 'place_yingchuan_changshe', name: '长社', level: '县城', summary: '兵灾与黄巾风声渐近，城中守备开始紧张。' },
        {
          id: 'place_yingchuan_zhang_wubao',
          name: '张氏坞堡',
          level: '坞堡',
          summary: '地方豪族自保的庄堡，高墙、私兵与粮仓构成另一套秩序。',
          scenes: [
            { id: 'scene_yingchuan_zhang_gate', name: '坞堡门前', summary: '庄客巡守，外人进出都要说明来意。' },
            { id: 'scene_yingchuan_zhang_courtyard', name: '内院', summary: '族中长辈与管事议事之处。' },
            { id: 'scene_yingchuan_zhang_granary', name: '粮仓', summary: '粮食与私兵命脉所在，饥民传闻常绕着这里打转。' },
          ],
        },
        {
          id: 'place_yingchuan_huangjin_altar',
          name: '太平道坛场附近',
          level: '聚落',
          summary: '乡里暗中传道之处，符水、讲经与避灾传闻正在扩散。',
          scenes: [
            { id: 'scene_yingchuan_altar_outer', name: '坛场外', summary: '信众三三两两聚集，外人难分求医、求粮还是求反。' },
            { id: 'scene_yingchuan_altar_tent', name: '讲经棚', summary: '太平道门徒低声讲论苍天已死。' },
            { id: 'scene_yingchuan_altar_water', name: '符水棚', summary: '病人与流民排队求符水，官府耳目也可能混在其中。' },
          ],
        },
      ],
    },
    {
      id: 'loc_runan',
      name: '汝南郡',
      summary: '袁氏根基所在，士族势力深厚，地方豪强与门生故吏网络密集。',
      controlHint: '汝南太守与袁氏旧故',
      tensionHint: '中高 - 豪族互相观望',
      places: [
        { id: 'place_runan_pingyu', name: '平舆县城', level: '县城', summary: '汝南腹地县城，袁氏门生故吏消息灵通。' },
        { id: 'place_runan_xincai', name: '新蔡县城', level: '县城', summary: '汝南南部要县，商旅与乡兵往来频繁。' },
        { id: 'place_runan_yuan_estate', name: '袁氏旧庄', level: '坞堡', summary: '袁氏旁支与门客往来之所，寻常百姓难以接近。' },
      ],
    },
    {
      id: 'loc_nanyang',
      name: '南阳郡',
      summary: '帝乡大郡，人口稠密，商业繁华，北接中原风波。',
      controlHint: '南阳太守',
      tensionHint: '中高 - 北方乱局波及',
      places: [
        { id: 'place_nanyang_wan', name: '宛城', level: '城邑', summary: '南阳郡治，商贾、工匠、士人和军吏都在此汇聚。' },
        { id: 'place_nanyang_xinye', name: '新野县城', level: '县城', summary: '南阳南部要县，连接荆州腹地与中原。' },
        { id: 'place_nanyang_bowang_road', name: '博望坡驿道', level: '驿站', summary: '南阳道途节点，商旅与军使常在此歇脚。' },
      ],
    },
  ],
  region_jizhou: [
    {
      id: 'loc_jizhou_julu',
      name: '巨鹿郡',
      summary: '太平道声势最盛之地之一，黄巾起事策源地。',
      controlHint: '汉廷名义管辖，黄巾势力深厚',
      tensionHint: '极高 - 黄巾核心',
      places: [
        {
          id: 'place_jizhou_julu_county',
          name: '巨鹿县城',
          level: '县城',
          summary: '巨鹿郡内要县，城内官府紧张，城外信众涌动。',
          scenes: [
            { id: 'scene_jizhou_julu_yamen', name: '县衙', summary: '官吏试图压住黄巾风声，却越来越力不从心。' },
            { id: 'scene_jizhou_julu_market', name: '市集', summary: '符水、粮价和起事流言在摊贩间飞快传播。' },
            { id: 'scene_jizhou_julu_road', name: '城外驿道', summary: '信众、流民和官差都在路上留下痕迹。' },
          ],
        },
        { id: 'place_jizhou_guangzong', name: '广宗聚落', level: '聚落', summary: '黄巾信众活动频繁的乡里聚落。' },
        { id: 'place_jizhou_taiping_camp', name: '太平道营寨', level: '营寨', summary: '太平道徒秘密聚集之处，外人难以分辨其虚实。' },
      ],
    },
    {
      id: 'loc_jizhou_wei',
      name: '魏郡',
      summary: '河北腹地，邺城一带人口与粮赋丰厚。',
      controlHint: '郡府与地方豪族',
      tensionHint: '中高 - 河北门户',
      places: [
        { id: 'place_jizhou_ye', name: '邺城', level: '城邑', summary: '河北重城，粮仓、官署和士族宅第密集。' },
        { id: 'place_jizhou_linyang', name: '黎阳津', level: '渡口', summary: '黄河要津，南北军旅商贾往来之处。' },
      ],
    },
    {
      id: 'loc_jizhou_changshan',
      name: '常山国',
      level: '国',
      summary: '山地与平原交界，豪强、游侠与边地消息皆可相遇。',
      controlHint: '地方官府',
      tensionHint: '中 - 豪强自保',
      places: [
        { id: 'place_jizhou_zhending', name: '真定县城', level: '县城', summary: '常山要县，乡兵与游侠名声颇盛。' },
        { id: 'place_jizhou_hill_village', name: '山口村寨', level: '聚落', summary: '山地村寨，避乱者与私兵常有往来。' },
      ],
    },
  ],
  region_yanzhou: [
    {
      id: 'loc_yanzhou_chenliu',
      name: '陈留郡',
      summary: '中原要冲，士人、商旅和兵马来往密集。',
      controlHint: '陈留太守',
      tensionHint: '高 - 四战之地',
      places: [
        { id: 'place_yanzhou_chenliu', name: '陈留县城', level: '县城', summary: '郡治所在，交通四达，消息繁杂。' },
        { id: 'place_yanzhou_suanzao', name: '酸枣聚兵处', level: '营寨', summary: '关东诸侯聚兵之地，军令与私议并行。' },
      ],
    },
    {
      id: 'loc_yanzhou_dongjun',
      name: '东郡',
      summary: '黄河沿线要地，军政与粮道关系紧密。',
      controlHint: '东郡太守',
      tensionHint: '高 - 兵灾隐伏',
      places: [
        { id: 'place_yanzhou_puyang', name: '濮阳城', level: '城邑', summary: '东郡重城，军吏和商旅汇聚。' },
        { id: 'place_yanzhou_yellow_river_camp', name: '河岸军营', level: '营寨', summary: '守河军营，粮船和军令都要经过此处。' },
      ],
    },
    {
      id: 'loc_yanzhou_taishan',
      name: '泰山郡',
      summary: '山地豪强与盗匪出没，官府控制力有限。',
      controlHint: '泰山太守',
      tensionHint: '高 - 山地不靖',
      places: [
        { id: 'place_yanzhou_fenggao', name: '奉高县城', level: '县城', summary: '泰山郡治附近，山民、豪强和官吏都在试探彼此。' },
        { id: 'place_yanzhou_mountain_pass', name: '泰山山口', level: '关隘', summary: '山道险要，过路者常被盘问。' },
      ],
    },
  ],
  region_jingzhou: [
    {
      id: 'loc_jingzhou_nanjun',
      name: '南郡',
      summary: '荆州中枢，江汉交汇，北上南下皆经此地。',
      controlHint: '荆州牧与南郡官府',
      tensionHint: '中 - 富庶而受各方注目',
      places: [
        { id: 'place_jingzhou_jiangling', name: '江陵城', level: '城邑', summary: '荆州重城，水陆交通、府库与军营齐备。' },
        { id: 'place_jingzhou_xiangyang', name: '襄阳城', level: '城邑', summary: '汉水重镇，北望中原，士族势力深厚。' },
      ],
    },
    {
      id: 'loc_jingzhou_nanyang',
      name: '南阳郡',
      summary: '帝乡大郡，人口稠密，北接中原风波。',
      controlHint: '南阳太守',
      tensionHint: '中高 - 北方乱局波及',
      places: [
        { id: 'place_jingzhou_wan', name: '宛城', level: '城邑', summary: '南阳郡治，商旅和士人往来密集。' },
        { id: 'place_jingzhou_xinye', name: '新野县城', level: '县城', summary: '连接荆北与中原的县城。' },
      ],
    },
    {
      id: 'loc_jingzhou_jiangxia',
      name: '江夏郡',
      summary: '长江中游要地，水陆交通汇集。',
      controlHint: '江夏太守',
      tensionHint: '中 - 江防与商路并重',
      places: [
        { id: 'place_jingzhou_xiling', name: '西陵城', level: '城邑', summary: '江夏要城，水军与商船消息交杂。' },
        { id: 'place_jingzhou_hankou_ferry', name: '汉口渡', level: '渡口', summary: '江汉交汇的渡口，行人和货物不断。' },
      ],
    },
  ],
  region_yangzhou: [
    {
      id: 'loc_yangzhou_wu',
      name: '吴郡',
      summary: '江东核心郡国，士族、豪强与水网社会交织。',
      controlHint: '吴郡太守',
      tensionHint: '中 - 江东豪族势大',
      places: [
        { id: 'place_yangzhou_wuxian', name: '吴县城', level: '县城', summary: '吴郡治所，江东士族与商旅汇聚。' },
        { id: 'place_yangzhou_loumen_port', name: '娄门港口', level: '港口', summary: '水网港口，粮船、商船和舟师消息不断。' },
      ],
    },
    {
      id: 'loc_yangzhou_kuaiji',
      name: '会稽郡',
      summary: '东南大郡，山海交错，豪族与越地势力并存。',
      controlHint: '会稽太守',
      tensionHint: '中 - 山越隐患',
      places: [
        { id: 'place_yangzhou_shanyin', name: '山阴县城', level: '县城', summary: '会稽核心县城，士族与商旅频繁往来。' },
        { id: 'place_yangzhou_mountain_yue', name: '山越聚落', level: '聚落', summary: '山中部族聚落，外来政令难以深入。' },
      ],
    },
    {
      id: 'loc_yangzhou_danyang',
      name: '丹阳郡',
      summary: '山地与江淮之间的兵源重地。',
      controlHint: '丹阳太守',
      tensionHint: '中高 - 山民与兵源并重',
      places: [
        { id: 'place_yangzhou_wanling', name: '宛陵县城', level: '县城', summary: '丹阳郡治，山民、军户和豪强关系复杂。' },
        { id: 'place_yangzhou_danyang_camp', name: '丹阳募兵营', level: '营寨', summary: '募兵与练兵之处，乡勇和军吏往来。' },
      ],
    },
  ],
  region_yizhou: [
    {
      id: 'loc_yizhou_shu',
      name: '蜀郡',
      summary: '成都平原核心，富庶安稳，远离中原战火。',
      controlHint: '益州牧与蜀郡官府',
      tensionHint: '低中 - 富庶中有暗流',
      places: [
        { id: 'place_yizhou_chengdu', name: '成都城', level: '城邑', summary: '蜀地大城，官府、商旅和门阀势力交错。' },
        { id: 'place_yizhou_pixian', name: '郫县城', level: '县城', summary: '成都近郊县城，粮产丰厚，乡里关系深。' },
      ],
    },
    {
      id: 'loc_yizhou_hanzhong',
      name: '汉中郡',
      summary: '秦蜀咽喉，进出益州的北方门户。',
      controlHint: '汉中太守',
      tensionHint: '中高 - 山道要冲',
      places: [
        { id: 'place_yizhou_nanzheng', name: '南郑城', level: '城邑', summary: '汉中郡治，山道军旅和商贾汇聚。' },
        { id: 'place_yizhou_baoxie_road', name: '褒斜道口', level: '关隘', summary: '入蜀山道节点，险要而消息闭塞。' },
        { id: 'place_yizhou_yangping_pass', name: '阳平关', level: '关隘', summary: '汉中西北门户，出武都、祁山必经此线，关前山势逼仄，军旅难以展开。' },
        { id: 'place_yizhou_chencang_road', name: '陈仓道口', level: '道口', summary: '由汉中北趋陈仓的山道入口，栈道险长，适合奇袭也容易被断粮。' },
        { id: 'place_yizhou_ziwu_valley', name: '子午谷口', level: '谷口', summary: '子午道南口，直指长安南面，路险而短，常被视作冒险奇计。' },
        { id: 'place_yizhou_tangluo_road', name: '傥骆道口', level: '道口', summary: '由汉中北出关中的偏险山道，绕远而隐蔽，粮运压力极大。' },
        { id: 'place_yizhou_jiange_pass', name: '剑阁关', level: '关隘', summary: '蜀道北口险关，栈道与山峡交错，是益州北出汉中的关键节点。' },
      ],
    },
    {
      id: 'loc_yizhou_ba',
      name: '巴郡',
      summary: '江州一带，水路与山地交错，豪强部族并存。',
      controlHint: '巴郡太守',
      tensionHint: '中 - 水陆杂处',
      places: [
        { id: 'place_yizhou_jiangzhou', name: '江州城', level: '城邑', summary: '巴郡重城，水道商旅与地方势力交织。' },
        { id: 'place_yizhou_ba_river_port', name: '巴江码头', level: '港口', summary: '江船停泊，货物和传闻顺水而来。' },
      ],
    },
  ],
  region_liangzhou: [
    {
      id: 'loc_liangzhou_longxi',
      name: '陇西郡',
      summary: '西北旧郡，羌汉杂处，边军气息浓厚。',
      controlHint: '陇西太守与边军',
      tensionHint: '高 - 羌乱与军镇',
      places: [
        { id: 'place_liangzhou_didao', name: '狄道县城', level: '县城', summary: '陇西要县，边军、羌人和商旅关系复杂。' },
        { id: 'place_liangzhou_frontier_camp', name: '陇西边营', level: '营寨', summary: '边军驻扎之处，军功和危险并存。' },
      ],
    },
    {
      id: 'loc_liangzhou_wudu',
      name: '武都郡',
      summary: '汉中与陇右之间的山地郡，羌汉杂处，祁山、阴平等道都牵动北伐进退。',
      controlHint: '武都太守与边地豪强',
      tensionHint: '高 - 山道、羌胡与蜀魏军争交错',
      places: [
        { id: 'loc_liangzhou_wudu_seat', name: '下辨县城', level: '县城', summary: '武都郡治，北通陇右，南接汉中，军情与羌部消息频繁往来。' },
        { id: 'place_liangzhou_qishan_fort', name: '祁山堡', level: '营寨', summary: '祁山道上的军垒，向东可窥街亭、天水，向南接武都山道。' },
        { id: 'place_liangzhou_yinping_road', name: '阴平道口', level: '道口', summary: '蜀北偏西的险远山道，地僻路长，适合小队潜行，也最怕断绝补给。' },
      ],
    },
    {
      id: 'loc_liangzhou_tianshui',
      name: '天水郡',
      summary: '陇右要地，士族、边军和羌胡关系复杂。',
      controlHint: '天水太守',
      tensionHint: '高 - 边地动荡',
      places: [
        { id: 'place_liangzhou_jixian', name: '冀县城', level: '县城', summary: '天水郡治，边地士人与军户聚集。' },
        { id: 'place_liangzhou_jieting', name: '街亭', level: '亭障', summary: '天水东南的山道节点，控扼陇右与关中之间的转折，驻军失守便会牵动全局。' },
        { id: 'place_liangzhou_qiang_market', name: '羌汉互市', level: '市镇', summary: '羌汉商旅交易之处，和平与冲突都在此生长。' },
      ],
    },
    {
      id: 'loc_liangzhou_wuwei',
      name: '武威郡',
      summary: '河西门户，军镇、商路与羌胡消息汇聚。',
      controlHint: '武威太守',
      tensionHint: '中高 - 河西军镇',
      places: [
        { id: 'place_liangzhou_guzang', name: '姑臧城', level: '城邑', summary: '河西重城，军政和商路消息密集。' },
        { id: 'place_liangzhou_hexi_post', name: '河西驿站', level: '驿站', summary: '长途商旅和军使歇脚之处。' },
      ],
    },
  ],
  region_youzhou: [
    {
      id: 'loc_youzhou_zhuo',
      name: '涿郡',
      summary: '幽州南部，近接冀州，边地豪侠与士人并见。',
      controlHint: '涿郡太守',
      tensionHint: '中 - 边地与中原交界',
      places: [
        { id: 'place_youzhou_zhuoxian', name: '涿县城', level: '县城', summary: '幽州南部门户，游侠、士人和军户交杂。' },
        { id: 'place_youzhou_zhuo_village', name: '桑干河村落', level: '聚落', summary: '河边村落，民风强悍，消息来自南北两路。' },
      ],
    },
    {
      id: 'loc_youzhou_yuyang',
      name: '渔阳郡',
      summary: '东北边防郡国，骑兵、商旅与外族消息频繁。',
      controlHint: '渔阳太守与边军',
      tensionHint: '中高 - 外患压力',
      places: [
        { id: 'place_youzhou_yuyang_city', name: '渔阳城', level: '城邑', summary: '边郡重城，骑兵和商旅常在此集结。' },
        { id: 'place_youzhou_fort', name: '边塞烽燧', level: '关隘', summary: '塞上烽燧，外患消息最早抵达。' },
      ],
    },
    {
      id: 'loc_youzhou_youbeiping',
      name: '右北平郡',
      summary: '边塞郡国，乌桓鲜卑活动近在咫尺。',
      controlHint: '右北平太守',
      tensionHint: '高 - 边塞不宁',
      places: [
        { id: 'place_youzhou_tuyin', name: '土垠县城', level: '县城', summary: '右北平要县，汉胡杂处。' },
        { id: 'place_youzhou_wuhuan_market', name: '乌桓互市', level: '市镇', summary: '边地交易场所，也常有探马和密使出没。' },
      ],
    },
  ],
  region_bingzhou: [
    {
      id: 'loc_bingzhou_taiyuan',
      name: '太原郡',
      summary: '并州腹地，边军传统深厚，豪强与军户并存。',
      controlHint: '太原太守',
      tensionHint: '中高 - 边军重地',
      places: [
        { id: 'place_bingzhou_jinyang', name: '晋阳城', level: '城邑', summary: '并州重城，军户和豪强势力深厚。' },
        { id: 'place_bingzhou_fenhe_ferry', name: '汾河渡口', level: '渡口', summary: '晋阳近旁水陆要点，商旅军差往来。' },
      ],
    },
    {
      id: 'loc_bingzhou_yanmen',
      name: '雁门郡',
      summary: '北方边塞，胡骑压力与军功机会并存。',
      controlHint: '雁门太守与边军',
      tensionHint: '高 - 边患前线',
      places: [
        { id: 'place_bingzhou_yinguan', name: '阴馆县城', level: '县城', summary: '边塞县城，守军与民户同受外患压力。' },
        { id: 'place_bingzhou_yanmen_pass', name: '雁门关口', level: '关隘', summary: '塞北门户，军令和烽火都很急。' },
      ],
    },
    {
      id: 'loc_bingzhou_shangdang',
      name: '上党郡',
      summary: '山地要冲，连接河内、太原与冀州。',
      controlHint: '上党太守',
      tensionHint: '中高 - 山地通道',
      places: [
        { id: 'place_bingzhou_changzi', name: '长子县城', level: '县城', summary: '上党要县，山道与兵道汇聚。' },
        { id: 'place_bingzhou_mountain_fort', name: '上党山寨', level: '山寨', summary: '山中豪强自保之处，官府难以深管。' },
      ],
    },
  ],
  region_xuzhou: [
    {
      id: 'loc_xuzhou_xiapi',
      name: '下邳国',
      level: '国',
      summary: '徐州重镇，水陆道路汇集。',
      controlHint: '徐州牧与下邳相',
      tensionHint: '中高 - 四战之地',
      places: [
        { id: 'place_xuzhou_xiapi_city', name: '下邳城', level: '城邑', summary: '徐州要城，官府、豪族与军旅消息密集。' },
        { id: 'place_xuzhou_si_river_port', name: '泗水码头', level: '港口', summary: '水路交通处，货船和兵船都可能停泊。' },
      ],
    },
    {
      id: 'loc_xuzhou_donghai',
      name: '东海郡',
      summary: '徐州北部大郡，士族与海岸道路相连。',
      controlHint: '东海太守',
      tensionHint: '中 - 海岸交通',
      places: [
        { id: 'place_xuzhou_tanxian', name: '郯县城', level: '县城', summary: '东海郡治，士族与官府往来密切。' },
        { id: 'place_xuzhou_coastal_post', name: '海边驿亭', level: '驿站', summary: '海岸道路上的歇脚处，商旅消息新鲜。' },
      ],
    },
    {
      id: 'loc_xuzhou_pengcheng',
      name: '彭城国',
      level: '国',
      summary: '楚地旧都，兵家道路与商旅往来频繁。',
      controlHint: '彭城相',
      tensionHint: '中高 - 兵道要地',
      places: [
        { id: 'place_xuzhou_pengcheng_city', name: '彭城', level: '城邑', summary: '徐州西部重城，军道和商路交会。' },
        { id: 'place_xuzhou_pei_county', name: '沛县城', level: '县城', summary: '楚沛旧地，乡里豪杰与市井游侠不少。' },
      ],
    },
  ],
  region_qingzhou: [
    {
      id: 'loc_qingzhou_qi',
      name: '齐国',
      level: '国',
      summary: '临淄所在，齐地旧都，黄巾与地方豪强压力并存。',
      controlHint: '齐相与地方豪族',
      tensionHint: '高 - 黄巾流动',
      places: [
        { id: 'place_qingzhou_linzi', name: '临淄城', level: '城邑', summary: '齐地重城，市井繁华但暗流不断。' },
        { id: 'place_qingzhou_qi_market', name: '齐地大市', level: '市镇', summary: '商旅、游侠、黄巾余部传闻汇聚之地。' },
      ],
    },
    {
      id: 'loc_qingzhou_beihai',
      name: '北海国',
      level: '国',
      summary: '海岸重地，士人与黄巾余部交错。',
      controlHint: '北海相',
      tensionHint: '高 - 兵乱频仍',
      places: [
        { id: 'place_qingzhou_juxian', name: '剧县城', level: '县城', summary: '北海核心县城，官府与士人尚在维持秩序。' },
        { id: 'place_qingzhou_coastal_village', name: '海边村落', level: '聚落', summary: '近海村落，逃难者和走私商旅不时出没。' },
      ],
    },
    {
      id: 'loc_qingzhou_pingyuan',
      name: '平原郡',
      summary: '黄河北岸郡国，冀青之间的平原通道。',
      controlHint: '平原太守',
      tensionHint: '中高 - 流民与兵灾',
      places: [
        { id: 'place_qingzhou_pingyuan_city', name: '平原县城', level: '县城', summary: '平原郡治，流民、乡兵和官府压力并存。' },
        { id: 'place_qingzhou_yellow_river_road', name: '黄河驿道', level: '驿站', summary: '沿河道路，兵荒马乱中消息不绝。' },
      ],
    },
  ],
  region_jiaozhou: [
    {
      id: 'loc_jiaozhou_nanhai',
      name: '南海郡',
      summary: '岭南门户，海路贸易与地方土豪并存。',
      controlHint: '南海太守',
      tensionHint: '低中 - 远离中原',
      places: [
        { id: 'place_jiaozhou_panyu', name: '番禺城', level: '城邑', summary: '岭南重城，海货、土豪和汉官势力交错。' },
        { id: 'place_jiaozhou_nanhai_port', name: '南海港口', level: '港口', summary: '海商船只停泊处，远方消息随潮而来。' },
      ],
    },
    {
      id: 'loc_jiaozhou_jiaozhi',
      name: '交趾郡',
      summary: '南方大郡，汉民、土著与商旅杂处。',
      controlHint: '交趾太守',
      tensionHint: '低中 - 地远政疏',
      places: [
        { id: 'place_jiaozhou_longbian', name: '龙编城', level: '城邑', summary: '交趾郡治，南方商路与地方势力汇聚。' },
        { id: 'place_jiaozhou_river_village', name: '红河村寨', level: '聚落', summary: '水道村寨，地方习俗与汉法并存。' },
      ],
    },
    {
      id: 'loc_jiaozhou_hepu',
      name: '合浦郡',
      summary: '海滨郡国，珠贝、海路和南方商旅往来。',
      controlHint: '合浦太守',
      tensionHint: '低中 - 海路消息',
      places: [
        { id: 'place_jiaozhou_hepu_city', name: '合浦城', level: '城邑', summary: '海滨城邑，珠贝贸易闻名。' },
        { id: 'place_jiaozhou_pearl_port', name: '珠市港', level: '港口', summary: '珠贝买卖和海商消息最集中的地方。' },
      ],
    },
  ],
};

const externalRegionSeeds: MapNode[] = [
  {
    id: 'region_western_regions',
    name: '西域',
    level: '外域',
    summary: '玉门关以西的绿洲、商路与旧都护故地。离中原极远，但丝路消息仍会传入乱世。',
    connectedRegionIds: ['region_liangzhou'],
    controlHint: '汉廷影响微弱，绿洲诸国与商旅势力交错',
    tensionHint: '中高 - 道路遥远，局势多变',
  },
  {
    id: 'region_steppe',
    name: '大漠',
    level: '外域',
    summary: '塞北草原与漠南部族活动范围，骑兵、互市、归附与劫掠并存。',
    connectedRegionIds: ['region_liangzhou', 'region_bingzhou', 'region_youzhou'],
    controlHint: '部族首领与边军互相试探',
    tensionHint: '高 - 边患与互市并存',
  },
  {
    id: 'region_korean_peninsula',
    name: '朝鲜半岛',
    level: '外域',
    summary: '辽东之外的郡县旧地与三韩诸部，受中原变局间接牵动。',
    connectedRegionIds: ['region_youzhou'],
    controlHint: '郡县旧制、地方豪族与诸部并存',
    tensionHint: '中 - 边外秩序复杂',
  },
  {
    id: 'region_wa',
    name: '倭地',
    level: '外域',
    summary: '海东诸岛，汉地多闻其名而少知其实，适合异域商旅、使者或漂泊者开局。',
    connectedRegionIds: ['region_qingzhou', 'region_xuzhou', 'region_yangzhou'],
    controlHint: '诸岛部族与地方首领',
    tensionHint: '中 - 海路遥远，风闻多于实证',
  },
];

const externalOpeningCommanderiesByRegion: Record<string, OpeningCommandery[]> = {
  region_western_regions: [
    {
      id: 'loc_western_dunhuang_route',
      name: '敦煌西道',
      summary: '凉州出关后的商旅道路，汉地军使、粟特商旅与逃亡者都可能经过。',
      controlHint: '边军旧吏与商旅互保',
      tensionHint: '中高 - 官道远离中原控制',
      places: [
        { id: 'place_western_yumen_post', name: '玉门关外驿站', level: '驿站', summary: '出关后第一处能稳定落脚的驿站，商旅和军使消息杂乱。' },
        { id: 'place_western_loulan_ruins', name: '楼兰故城', level: '城邑', summary: '沙海边缘的旧城，商旅传闻与失落旧事纠缠。' },
        { id: 'place_western_oasis_caravan', name: '沙州商队营地', level: '营寨', summary: '商队临时扎营之处，钱货、人情与风险并行。' },
      ],
    },
    {
      id: 'loc_western_kucha_oasis',
      name: '龟兹绿洲',
      summary: '西域绿洲重地，商旅、僧侣、乐人和地方王族往来频繁。',
      controlHint: '绿洲王族与商队势力',
      tensionHint: '中 - 远方乱局带来贸易波动',
      places: [
        { id: 'place_western_kucha_city', name: '龟兹城', level: '城邑', summary: '绿洲城邑，商货、语言和风俗都与汉地不同。' },
        { id: 'place_western_kucha_market', name: '绿洲市镇', level: '市镇', summary: '丝路货物汇集之处，也适合异域身份开局。' },
      ],
    },
    {
      id: 'loc_western_khotan_oasis',
      name: '于阗绿洲',
      summary: '西域南道绿洲，玉石、商旅与沙海道路构成当地秩序。',
      controlHint: '绿洲贵族与商旅结社',
      tensionHint: '中 - 商路风险高',
      places: [
        { id: 'place_western_khotan_city', name: '于阗城', level: '城邑', summary: '玉石贸易闻名的绿洲城。' },
        { id: 'place_western_jade_camp', name: '采玉营地', level: '营寨', summary: '绿洲外的采玉营地，苦役、商人和护卫混杂。' },
      ],
    },
  ],
  region_steppe: [
    {
      id: 'loc_steppe_xiongnu',
      name: '南匈奴部',
      summary: '内附与游牧之间摇摆的部族区域，与并州、凉州边军关系密切。',
      controlHint: '部族贵人与汉边军互相牵制',
      tensionHint: '高 - 归附、互市与劫掠交错',
      places: [
        { id: 'place_steppe_royal_camp', name: '单于庭附近', level: '营寨', summary: '部族贵人议事与牧民聚集之处。' },
        { id: 'place_steppe_horse_market', name: '边塞马市', level: '市镇', summary: '马匹、铁器和消息交易之处。' },
      ],
    },
    {
      id: 'loc_steppe_xianbei',
      name: '鲜卑部落',
      summary: '塞北游牧势力，骑兵强悍，部落联盟松散。',
      controlHint: '鲜卑首领与部落贵人',
      tensionHint: '高 - 边境压力持续',
      places: [
        { id: 'place_steppe_xianbei_camp', name: '鲜卑牧营', level: '营寨', summary: '游牧营地，战马、毡帐和部族盟誓构成日常。' },
        { id: 'place_steppe_desert_spring', name: '漠南泉眼', level: '聚落', summary: '大漠行路者争夺的水源点。' },
      ],
    },
    {
      id: 'loc_steppe_wuhuan',
      name: '乌桓部落',
      summary: '幽州边外部族，与汉地互市和军事冲突都很频繁。',
      controlHint: '乌桓首领与幽州边吏',
      tensionHint: '中高 - 互市表面下有冲突',
      places: [
        { id: 'place_steppe_wuhuan_market', name: '乌桓互市', level: '市镇', summary: '边地交易点，汉胡商旅与探马都可能出现。' },
        { id: 'place_steppe_border_camp', name: '塞外哨营', level: '营寨', summary: '边外临时营地，适合斥候、商旅或逃亡者开局。' },
      ],
    },
  ],
  region_korean_peninsula: [
    {
      id: 'loc_korea_lelang',
      name: '乐浪郡',
      summary: '汉郡旧地，官署、地方豪族与半岛诸部来往密切。',
      controlHint: '郡县旧吏与地方豪族',
      tensionHint: '中 - 边外郡县秩序松动',
      places: [
        { id: 'place_korea_lelang_city', name: '乐浪郡治', level: '城邑', summary: '半岛郡县旧治，汉吏、商旅与本地人混居。' },
        { id: 'place_korea_river_port', name: '浿水渡口', level: '渡口', summary: '水路渡口，郡县与诸部消息交汇。' },
      ],
    },
    {
      id: 'loc_korea_daifang',
      name: '带方郡',
      summary: '半岛南向交通节点，连接郡县和三韩诸部。',
      controlHint: '地方郡吏与商旅势力',
      tensionHint: '中 - 远离中枢',
      places: [
        { id: 'place_korea_daifang_city', name: '带方城', level: '城邑', summary: '半岛南向城邑，商旅和使者经此往来。' },
        { id: 'place_korea_samhan_market', name: '三韩互市', level: '市镇', summary: '边外交易处，语言和风俗复杂。' },
      ],
    },
    {
      id: 'loc_korea_samhan',
      name: '三韩诸部',
      summary: '半岛南部诸部族区域，汉地所知有限，适合边外身份开局。',
      controlHint: '诸部首领',
      tensionHint: '中 - 地方秩序由部族维系',
      places: [
        { id: 'place_korea_han_village', name: '韩部聚落', level: '聚落', summary: '半岛南部聚落，部族、渔猎和贸易维系生活。' },
        { id: 'place_korea_coast_port', name: '南岸港口', level: '港口', summary: '通往海东诸岛的港口。' },
      ],
    },
  ],
  region_wa: [
    {
      id: 'loc_wa_northern_kyushu',
      name: '筑紫诸国',
      summary: '海东诸岛靠近汉地航路的区域，商旅和使者较容易抵达。',
      controlHint: '诸岛地方首领',
      tensionHint: '中 - 海路带来外来消息',
      places: [
        { id: 'place_wa_hakata_port', name: '博多湾港口', level: '港口', summary: '海船停泊之处，汉地货物和异乡传闻汇集。' },
        { id: 'place_wa_island_market', name: '海岛市集', level: '市镇', summary: '诸岛商贸点，语言不通也能交易。' },
      ],
    },
    {
      id: 'loc_wa_yamatai',
      name: '邪马台传闻地',
      summary: '汉地风闻中的倭地中心，位置与实情都带着传说色彩。',
      controlHint: '地方女王与部族贵人',
      tensionHint: '中 - 风闻多于确证',
      places: [
        { id: 'place_wa_yamatai_settlement', name: '邪马台聚落', level: '聚落', summary: '传闻中的大型聚落，礼俗与汉地迥异。' },
        { id: 'place_wa_sacred_grove', name: '祭祀林地', level: '聚落', summary: '当地祭祀之地，外人贸然进入容易引发误会。' },
      ],
    },
    {
      id: 'loc_wa_sea_route',
      name: '海东航路',
      summary: '从半岛、青徐或江东去往海东的航路，不稳定但充满机会。',
      controlHint: '海商、船主与地方首领',
      tensionHint: '中高 - 海路危险',
      places: [
        { id: 'place_wa_sea_camp', name: '海船营地', level: '营寨', summary: '船队临时停泊修整之处。' },
        { id: 'place_wa_hidden_cove', name: '隐秘海湾', level: '港口', summary: '避风海湾，适合流亡者、商旅或海盗传闻开局。' },
      ],
    },
  ],
};

const allOpeningCommanderiesByRegion: Record<string, OpeningCommandery[]> = {
  ...openingCommanderiesByRegion,
  ...externalOpeningCommanderiesByRegion,
};

const getOpeningCommanderiesForRegion = (regionId: string): OpeningCommandery[] => {
  const curatedItems = allOpeningCommanderiesByRegion[regionId] ?? [];
  return mergeHistoricalCommanderies(regionId, curatedItems);
};

const buildFallbackCommanderies = (region: MapNode): MapNode[] => {
  const fallback: OpeningCommandery = {
    id: `${region.id}_core`,
    name: `${region.name}核心郡`,
    summary: `${region.name}内的开局区域，用于世界书尚未细化时承接玩家开局。`,
    controlHint: region.controlHint,
    tensionHint: region.tensionHint,
    places: [
      {
        id: `${region.id}_seat`,
        name: `${region.name}治所`,
        level: '城邑',
        summary: `${region.name}内的具体治所，可作为开局落点。`,
      },
    ],
  };

  return [commandery(region.id, fallback)];
};

const openingLayerByDepth = (depth: number): MapLayerKind => {
  if (depth <= 1) return 'region';
  if (depth === 2) return 'place';
  return 'scene';
};

const withOpeningMapLayers = (node: MapNode, depth: number): MapNode => ({
  ...node,
  mapLayer: openingLayerByDepth(depth),
  subLocations: node.subLocations?.map((child) => withOpeningMapLayers(child, depth + 1)),
});

export const threeKingdomsOpeningLocationSeed: MapNode[] = [...threeKingdomsMapSeed, ...externalRegionSeeds].map((region) => {
  const openingCommanderies = getOpeningCommanderiesForRegion(region.id);

  return withOpeningMapLayers({
    ...region,
    subLocations: openingCommanderies.length > 0
      ? openingCommanderies.map((item) => commandery(region.id, item))
      : buildFallbackCommanderies(region),
  }, 0);
});
