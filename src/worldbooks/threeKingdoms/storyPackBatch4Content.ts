import type { WorldlineStoryThread, WorldlineStoryThreadKind } from '../../engine/types';
import { createThreeKingdomsStoryThread } from './storyPackBuilder';
import {
  THREE_KINGDOMS_STORY_ERA_BANDS,
  THREE_KINGDOMS_STORY_REGIONS,
} from './storyPackCatalog';

type Batch4BlueprintKind = 'SP' | 'DS' | 'DM' | 'AM';

interface Batch4MotifBlueprint {
  kind: Batch4BlueprintKind;
  subdomain: string;
  motifId: string;
  subject: string;
  condition: string;
  evidence: string;
  stake: string;
  entrySignals: readonly string[];
  variants: number;
}

interface Batch4DomainBlueprint {
  domain: string;
  usageBoundary?: string;
  motifs: readonly Batch4MotifBlueprint[];
}

const COMMON_USAGE_BOUNDARY = [
  '只能作为候选情境、结构压力、调查入口或人物代价。',
  '不得替任何人物决定，不得宣告事实、胜负、伤亡、资源变化或必然结局，不得覆盖本局状态、事项、纪事、账本与权威系统裁定。',
].join('');

const AFTERMATH_USAGE_BOUNDARY = [
  '必须先有 Combat、War、灾害、政权变化或事项终结等结构化结果。',
  '不得凭空制造前置事件、伤亡、胜负、缴获、权力变化或资源写回。',
].join('');

const WAR_USAGE_BOUNDARY = '胜负、伤亡、战果、撤退与地盘变化只能来自 Combat / War Engine 或既有结构化事实。';
const FRONTIER_USAGE_BOUNDARY = '不得把任何族群写成单一性格、固定敌人或没有内部差异的整体。';
const COURT_USAGE_BOUNDARY = '只提供通用制度、名分与交接压力，不绑定具体历史政变、继承者或政权结局。';
const FAMILY_USAGE_BOUNDARY = '成人内容仍受现有年龄、同意和关系门禁，不得由 StoryPack 绕过。';

function motif(
  kind: Batch4BlueprintKind,
  subdomain: string,
  motifId: string,
  subject: string,
  condition: string,
  evidence: string,
  stake: string,
  entrySignals: readonly string[],
  variants: number,
): Batch4MotifBlueprint {
  return {
    kind,
    subdomain,
    motifId,
    subject,
    condition,
    evidence,
    stake,
    entrySignals,
    variants,
  };
}

const BATCH_4_REGULAR_DOMAINS = [
  {
    domain: 'military_camp',
    motifs: [
      motif('SP', 'guard_duty', 'veteran_watch_rotation', '老兵与新募者重新编排四季守望', '连续驻防使熟练者总被压到夜班', '更鼓簿、病假签与哨位风向可以互相核验', '轮值不均会让同伍信任和家属照料同时受损', ['老兵轮值', '四季守望', '更鼓簿'], 2),
      motif('SP', 'camp_families', 'camp_household_winter_supply', '随营家户进入冬藏后的供给边界', '军需名册没有覆盖临时投靠的照料者', '灶口、炭票和口粮领取时段能显示真实常住人口', '未登记家户会先失去取暖、照料与申诉位置', ['随营家户', '冬藏供给', '炭票'], 2),
      motif('DS', 'unit_integration', 'mixed_unit_seasonal_drill', '不同来路营伍在季节操练中合编', '口令、器械与旧部习惯无法同时沿用', '操练簿、误号记录和分组名单能辨认磨合断点', '基层士卒既要建立新协作又担心旧同袍被边缘化', ['合营操练', '口令差异', '分组名单'], 4),
      motif('DS', 'rewards_punishments', 'long_garrison_merit_ledger', '长期驻防功劳如何进入常态赏罚账', '显眼战功与多年杂役使用了不同记法', '功簿、轮差册和伤病记录可比较实际承担', '若只奖一时表现，沉默维持营务的人会失去继续投入的理由', ['驻防功簿', '常态赏罚', '轮差册'], 4),
      motif('DM', 'desertion', 'winter_leave_return_doubt', '冬季探亲逾期被误作逃亡', '山路阻断与个人失约难以仅凭归营时刻区分', '关津木牌、同行口述与衣物霜损提供多条核验路径', '当事人要在军法解释和家庭急难之间证明自己的选择', ['探亲逾期', '冬路阻断', '归营核验'], 3),
    ],
  },
  {
    domain: 'war_pressure',
    usageBoundary: WAR_USAGE_BOUNDARY,
    motifs: [
      motif('SP', 'surrender', 'seasonal_surrender_channel', '季节阻路时的请降联络渠道', '谈判窗口受渡口、山雪与粮尽传言共同挤压', '使者行程、信物封记与守门记录只能证明接触过程', '仓促回应可能伤害守信关系，却不能提前裁定真降或诈降', ['请降联络', '季节阻路', '信物封记'], 2),
      motif('SP', 'postwar_merit', 'late_service_merit_memory', '多年战争后新旧功劳记忆发生冲突', '旧部看重长期承受，新编官署依赖格式化报功', '旧功簿、同伍证言与历次调防日期可重建贡献链', '代际评价差异会影响下一轮协作但不等于战果裁定', ['长期功劳', '报功格式', '代际评价'], 2),
      motif('DS', 'ambush', 'rain_route_ambush_warning', '雨季岔路出现可能伏击的前兆', '泥泞、视野和赶路期限让侦察意见分裂', '折枝高度、车辙覆水与鸟群变化可供现场复核', '向导、押运者和行军者承担不同的误判代价', ['雨季岔路', '伏击前兆', '车辙覆水'], 4),
      motif('DM', 'pursuit', 'exhausted_pursuit_boundary', '长期疲惫下追击边界难以统一', '前队催促与后队掉队同时出现', '马汗、脚伤簿与道路里程能检验继续追赶的承载力', '停止或前进都会改变同伍对责任和照料的理解', ['追击疲劳', '掉队', '道路里程'], 3),
      motif('DM', 'naval_warfare', 'tide_signal_coordination', '潮汐水面上的协同信号出现时差', '上下游船队看到的旗火并不同步', '潮位刻痕、风向和击鼓间隔可还原传递条件', '船户熟悉水势却可能被军中口令压过声音', ['潮汐信号', '船队协同', '击鼓间隔'], 3),
      motif('DM', 'cavalry_warfare', 'winter_fodder_mobility', '冬季草料紧张改变骑队机动选择', '保留马力与赶上协同时刻互相冲突', '料袋余量、蹄铁磨损与牧地距离能限定可行路线', '养马人和骑手对什么算延误承担不同压力', ['冬季草料', '骑队机动', '蹄铁磨损'], 3),
      motif('DM', 'mountain_warfare', 'mountain_fog_guides', '山雾中多名向导给出相反行路判断', '熟路经验被季节塌方和临时封道打乱', '石壁水痕、旧路标和砍柴人行迹可交叉核验', '外来行军者依赖本地知识，也可能把风险归咎给向导', ['山雾行军', '向导分歧', '塌方旧路'], 3),
    ],
  },
  {
    domain: 'logistics',
    motifs: [
      motif('SP', 'black_market', 'winter_store_shadow_trade', '冬藏物资短缺催生的营外转手链', '合法补给慢于取暖和修具需求', '封签、炭灰与交接时辰能区分盗卖、借用和替代采购', '一刀切查禁会让依赖小额交易的军民同时失去补充渠道', ['冬藏转手', '营外交易', '封签'], 2),
      motif('SP', 'priority_conflict', 'late_route_priority_board', '制度常态化后的运输优先牌长期失真', '旧有军用次序无法容纳赈济、农时和民生日常', '候运牌、滞留天数和沿途损耗可比较真实紧迫度', '重新排序会触动长期占位者，也可能救回被忽略的小批需求', ['运输优先牌', '滞留天数', '常态调度'], 2),
      motif('DS', 'warehousing', 'humid_granary_layers', '潮湿地区仓层轮换与霉损预警', '上层干燥记录掩盖靠墙粮垛受潮', '仓温、霉点、翻垛簿与鼠迹能定位问题范围', '开仓复检会拖慢发运，不检则把风险留给领粮者', ['仓层轮换', '霉损预警', '翻垛簿'], 4),
      motif('DS', 'horse_fodder', 'regional_fodder_substitution', '跨地域运输中的马料替换', '北方草料、江淮豆秸和山地饲草不能按同一折算', '牲口进食、腹胀记录和采购重量可校正折耗', '压低成本的替料办法可能把代价转给养马人与后续路程', ['马料替换', '地域饲草', '折耗'], 4),
      motif('DS', 'roads', 'seasonal_road_maintenance', '农时与运期夹缝中的道路养护', '修路需要本地劳力，却正逢播种或收割', '塌陷位置、车轴损坏与役工日期可划分急修段', '道路获益者和出工者并非同一批人', ['季节修路', '役工日期', '车轴损坏'], 4),
      motif('DS', 'attrition', 'long_route_hidden_attrition', '长途转运中分散的小额损耗累积成缺口', '每一站都称差额在容许范围内', '封包重量、换装次数和雨水浸泡记录可串成损耗链', '末端经手人最容易替整条路线承担责任', ['长途损耗', '换装次数', '封包重量'], 4),
      motif('DM', 'seasonal_disruption', 'ice_flood_alternate_dispatch', '冰封与汛涨交替造成备用路线承诺冲突', '两套季节预案都调用同一批船车', '水尺、冰厚、车具位置和驿递时刻可检验执行可能', '地方承运者会先承受反复改令的成本', ['冰封汛涨', '备用路线', '船车冲突'], 2),
      motif('DM', 'boats', 'boatwright_family_credit', '修船工匠以家庭信用担保赶工', '军用交期与木料自然干燥周期相抵', '木纹含水、借料账和徒工工时能说明风险来自何处', '赶工若失误会落到工匠全家，而延期也会伤及运输关系', ['修船赶工', '木料干燥', '家庭信用'], 3),
    ],
  },
  {
    domain: 'administration',
    motifs: [
      motif('SP', 'frontier_execution', 'frontier_rule_translation', '边地执行把同一条文译成不同日常做法', '通行、牧地与市集规则需要经过多层口译和旧例解释', '双语告示、关口登记与当地见证可比较执行差异', '统一格式若忽略场域，会先压缩普通人的合规空间', ['边地执行', '双语告示', '地方旧例'], 2),
      motif('SP', 'government_trust', 'seasonal_office_promise_ledger', '官署多年季节承诺没有形成可追索账目', '春修、夏防、秋征、冬赈各有口头期限', '告示存根、役工日期和领取凭据可核对兑现程度', '重复失约会让百姓把新承诺也视为空话', ['季节承诺', '官府信誉', '告示存根'], 2),
      motif('DS', 'new_officials', 'late_office_handover_calendar', '晚期新官接署面对跨年度交接日历', '前任遗留事项与新制考课同时启动', '印信时刻、待办签和属吏轮值表能区分旧账新责', '急于立威可能破坏依赖旧吏维持的日常服务', ['新官交接', '跨年待办', '属吏轮值'], 5),
      motif('DS', 'performance_review', 'routine_service_review', '常态考课遗漏难以量化的日常服务', '文书数量高低无法说明调解、照料与防灾质量', '退件率、等待时长和不同住户回访可补足官样数字', '基层吏员会在真实服务与好看报表之间承受压力', ['常态考课', '等待时长', '回访'], 5),
      motif('DS', 'requisition', 'harvest_cart_requisition', '秋收车具与官署征发同日到期', '跨县运输计划没有计算村社脱粒时段', '车契、田亩、装载记录和替代路线可比较承载', '小户若失去唯一车具，会把制度便利转成家庭过冬风险', ['秋收车具', '征发时限', '替代路线'], 6),
      motif('DM', 'documents', 'old_new_form_conflict', '旧式文书在新制中仍被基层沿用', '同一申请因表式不同得到相反答复', '纸张年代、签押链和窗口退件理由可还原制度交接', '申请人不应替官署内部格式冲突承担全部成本', ['新旧表式', '退件理由', '制度交接'], 2),
      motif('DM', 'household_registry', 'second_generation_registry', '迁居第二代的籍贯与居住事实脱节', '父母旧籍、出生地和现居劳役指向不同归属', '接生记、邻里担保与历年配给可建立连续生活证据', '年轻家庭需要身份稳定，却不愿被迫割断原乡关系', ['迁居第二代', '户籍归属', '连续生活证据'], 3),
    ],
  },
  {
    domain: 'justice_security',
    motifs: [
      motif('SP', 'redemption', 'seasonal_restitution_schedule', '赎罪补偿跨越农忙后的履行次序', '一次付清与分季偿还对双方意义不同', '收据、收成和见证约定可检验真实履行能力', '过严会逼人失去生计，过松也可能让受损者长期等候', ['分季赎偿', '农忙', '履行能力'], 2),
      motif('DS', 'collective_punishment', 'household_boundary_review', '连坐名单中的同住边界需要重新核验', '雇工、寄居亲属和临时避难者被写进同一户', '灶籍、租约、日常出入与邻证可区分实际关系', '模糊边界会让无决策能力者承担他人行为后果', ['连坐边界', '寄居者', '灶籍'], 5),
      motif('DS', 'law_conflict', 'seasonal_patrol_jurisdiction', '季节性巡防越过军民辖区边界', '汛期封道让两套执法程序同时介入', '巡牌、关卡时辰和受理文书能核对谁先接手', '重复盘查会伤害通行生计，也可能遗漏真正风险', ['季节巡防', '辖区边界', '巡牌'], 5),
      motif('DS', 'testimony', 'dialect_witness_record', '跨地域证词在方言转述中变形', '同一距离、亲属称谓与时辰被记录成不同意思', '原话旁记、译述人和现场地形可帮助重建语境', '证人可能因表达差异被误认反复或隐瞒', ['方言证词', '译述', '语境核验'], 5),
      motif('DM', 'banditry', 'winter_refuge_misidentification', '冬季结伴避险者被误认为盗匪同伙', '携带工具、夜间同行与陌生口音触发怀疑', '工契、投宿记录和沿路工作痕迹可提供另一解释', '仓促定性会让流动劳动者失去求助与自证渠道', ['冬季避险', '误认盗匪', '投宿记录'], 3),
    ],
  },
  {
    domain: 'agriculture_disaster',
    motifs: [
      motif('SP', 'harvest_dispute', 'shared_threshing_calendar', '共用场院的秋收脱粒次序', '早熟与晚熟作物争用同一片晴天', '入场日期、谷物含水和借牛记录能校正先后理由', '拖延会让小户先遇霉损，抢先也会伤害邻里约定', ['秋收场院', '脱粒次序', '谷物含水'], 2),
      motif('SP', 'dikes', 'generational_dike_duty', '堤防常态维护中的代际出工分配', '旧户记得受益承诺，新迁户只看到新增差役', '历年水位、出工册和受淹田界可重估共同受益', '若只沿用旧额，新旧住户都会质疑制度公正', ['堤防出工', '新旧住户', '历年水位'], 2),
      motif('DS', 'military_farming', 'garrison_field_rotation', '驻屯田与民田轮灌进入长期调整', '军屯扩大后仍沿用早期临时水次', '渠口时刻、田块高低和收成记录可测出长期偏差', '军民都依赖稳定灌溉，单边占水会积累下一季冲突', ['屯田轮灌', '民田水次', '渠口时刻'], 5),
      motif('DS', 'locusts', 'locust_watch_seasonal_network', '跨村蝗情观察在风向变化中失去同步', '先见虫群者担心报错，后方又需要提前备料', '卵块、风向、作物叶痕和逐日记录可分层核验', '迟报会缩短应对时间，误报也会消耗本就不足的人力', ['蝗情观察', '风向', '卵块'], 5),
      motif('DS', 'wasteland', 'returned_wasteland_claims', '多年后复垦荒地出现旧有使用者', '新垦投入与旧契记忆无法直接互相取消', '地界树、税簿、灌渠与连续耕作痕迹可分别证明关系', '任何重排都会影响已经依赖这块地过活的家庭', ['荒地复垦', '旧使用者', '连续耕作'], 6),
      motif('DS', 'water_conflict', 'dry_season_civil_military_water', '旱季军民共渠的夜间放水争执', '守营、饮畜和保苗需要同一轮低水位', '水尺、闸口泥痕与夜更记录可核验实际用量', '相互指责若取代排程，最末端田户和牲畜先受影响', ['旱季共渠', '军民用水', '闸口泥痕'], 6),
      motif('DM', 'farming_season', 'late_seed_custom_conflict', '旧农法与新作物播期在晚期并存', '长辈经验、外来种子和连续气候变化给出不同建议', '发芽率、前季收成和田块水土可支持小范围试种', '选择一种办法会影响师徒声望和全家的来年口粮预期', ['新旧农法', '播期', '小范围试种'], 4),
    ],
  },
  {
    domain: 'trade_market',
    motifs: [
      motif('SP', 'lending', 'seasonal_small_loan_terms', '小额借贷跨过收获季后的利息解释', '借粮、借钱与代购被写进同一张简约凭据', '交付物、归还时节和见证人口述可拆分债务性质', '模糊条款让急需者承担超出原意的长期束缚', ['季节借贷', '归还时节', '简约凭据'], 2),
      motif('SP', 'smuggling', 'border_goods_classification', '边地物产在不同关口被归入不同禁限', '同一包药材或染料因产地与季节改变分类', '货签、用途、采集地和旧放行簿可比较执法尺度', '规则不清会把普通跨区交易推向隐蔽渠道', ['边地物产', '关口分类', '旧放行簿'], 2),
      motif('DS', 'market', 'seasonal_market_shelter', '雨季市集棚位和排水共同不足', '固定商户、临时农户与手工业者争用干燥位置', '棚租、到市时刻和积水流向可调整分区', '靠当天收入购粮的人最难承受停市或迁位', ['雨季市集', '棚位排水', '临时商户'], 5),
      motif('DS', 'grain_price', 'regional_grain_measure', '跨地域粮价被不同量器放大差异', '报价看似接近，实际斛斗与含水标准不同', '实物复量、晒粮损耗和运输距离可还原可比价格', '普通购买者若只看牌价，容易承担隐藏损耗', ['地域量器', '粮价', '实物复量'], 5),
      motif('DS', 'salt_iron', 'craft_fuel_season', '盐铁作坊的燃料供应受季节与山路影响', '官定产额没有同步调整木炭到达周期', '炉温、炭耗、雨季道路和废品率可核验实际能力', '强追产额会把风险压给匠户和周边取薪家庭', ['盐铁作坊', '燃料季节', '炉温'], 5),
      motif('DS', 'coinage', 'worn_coin_daily_exchange', '旧钱磨损让日常小额交易反复争执', '官署大额折算无法解决菜市与工钱中的细差', '称重、成色、流通地区和商户共同约定可形成临时尺度', '拒收保护一方却可能让领取旧钱者无法购买日用物', ['旧钱磨损', '小额交易', '称重'], 5),
      motif('DM', 'military_procurement', 'artisan_delivery_quality', '军需交期与工匠质量承诺发生冲突', '采购吏只按数量验收，使用者却反馈季节环境下失效', '样件、工序、材料批次和返修记录可定位责任', '压价赶工会伤及匠户信用，拖延也会影响基层使用者', ['军需采购', '工匠质量', '返修记录'], 3),
      motif('DM', 'long_distance_trade', 'family_run_trade_route', '家族商路换代后的信用交接', '年轻经办人继承旧账却不认识沿途口头约定', '家书、路引、赊欠簿和长期投宿点可重建关系网', '拒认旧诺会失去路线信任，全盘承接也可能拖垮新家庭', ['商路换代', '旧账', '投宿点'], 3),
    ],
  },
  {
    domain: 'migration_population',
    motifs: [
      motif('SP', 'fort_population', 'fort_second_generation_places', '坞堡第二代对内外身份的日常分配', '出生于堡内者既承担守备又缺少正式居住证明', '出生见证、轮守簿和外出交易记录可显示长期生活事实', '身份悬置会影响婚姻、学徒和分粮，而非只有军事归属', ['坞堡第二代', '轮守簿', '居住证明'], 2),
      motif('SP', 'registration', 'seasonal_registration_window', '附籍窗口与迁徙家庭的季节生计错开', '农忙或水路封阻使申请人无法按官署时刻到场', '沿途关津、雇工期和暂住担保可说明延误原因', '错过窗口会让家庭整季无法稳定领取与承担义务', ['附籍窗口', '季节生计', '暂住担保'], 2),
      motif('DS', 'fugitive_households', 'returned_fugitive_tax_year', '逃户归来面对跨年度旧役追索', '离乡期间、受灾减免和现居承担没有被分开计算', '旧籍、沿途居住与本年劳役记录可建立时间线', '一次追齐会破坏重新安居，全部免除也会引发邻户不平', ['逃户归来', '跨年旧役', '居住时间线'], 5),
      motif('DS', 'forced_migration', 'winter_resettlement_tools', '冬季迁民到达后缺少适合当地的生计工具', '原乡农具在山地、水网或湿热地区用途有限', '携带清单、当地物产和可借工坊能设计替换办法', '若只完成点名安置，家庭仍无法建立下一季生活', ['冬季迁民', '生计工具', '地域适配'], 5),
      motif('DS', 'orphans', 'orphan_care_network', '孤儿照料在亲族、邻里与官署之间断档', '名义监护者与实际送饭照看者并非同一人', '日常食宿、衣物修补和就学记录可确认稳定关系', '频繁转手会让孩子失去安全感，也使照料者无法获得支持', ['孤儿照料', '实际监护', '日常记录'], 5),
      motif('DS', 'military_households', 'garrison_household_generation', '军户世代更替后的义务与照料重排', '老一代伤病、新一代成家和驻地变化同时发生', '服役年限、家庭劳力和居住地可重算真实承载', '机械沿用旧额会把责任集中到最难离开的家庭成员', ['军户换代', '服役年限', '家庭劳力'], 5),
      motif('DM', 'city_entry', 'summer_gate_daily_workers', '夏季城门时刻与短工往返不合', '防疫、夜禁和市集收工时间把每日入城者夹在门外', '雇主签、门籍与实际通勤路线可识别稳定往来者', '没有固定担保的劳动者最容易失去当天生计', ['夏季入城', '短工往返', '门籍'], 3),
      motif('DM', 'separation', 'seasonal_family_search', '家人失散后的寻找路线受季节迁徙改变', '旧消息指向的渡口和市集已经换季转移', '投宿簿、施粥名册和口音线索可逐段更新搜索范围', '等待者要在继续寻找与维持现有家庭之间分配有限精力', ['家人失散', '换季迁徙', '寻找路线'], 3),
    ],
  },
  {
    domain: 'clan_local_society',
    motifs: [
      motif('SP', 'donations', 'seasonal_public_donation', '季节公用捐输与家族声望绑定', '修渠、赈济和乡学同时向同一批人募资', '捐物用途、公开名次与实际受益地可拆分不同承诺', '拒捐可能损名，勉强捐输也会挤压普通族户生计', ['季节捐输', '公用项目', '公开名次'], 2),
      motif('SP', 'marriage_alliance', 'regional_marriage_network', '跨地域婚姻网络承担交通与照料义务', '山路、水路和节令让探亲与财物交接反复延迟', '家书、陪送清单和沿途接应可核验双方实际承担', '联盟名义若压过当事人日常，会把维系成本留给年轻家庭', ['跨地域婚姻', '探亲交通', '照料义务'], 2),
      motif('DS', 'retainer_dependency', 'retainer_household_season', '长期依附部曲家庭的四季劳作边界', '农时、守宅与临时征调由不同管事安排', '田作日、口粮、轮守和私人差遣记录可比较真实负担', '依附提供保护，也可能让家庭没有拒绝重复差役的空间', ['部曲家庭', '四季劳作', '私人差遣'], 5),
      motif('DS', 'land_dispute', 'river_shift_land_boundary', '水道季节改道后旧田界失去参照', '新淤地、旧渠与税籍线条指向不同边界', '老树根、灌溉口和历年水痕可重建变化过程', '急于划定会让下游小户承担自然变化造成的损失', ['水道改道', '田界', '历年水痕'], 5),
      motif('DS', 'private_forces', 'private_guard_civil_duty', '豪族护卫长期承担地方公共差役', '护庄、巡路和灾时救援的边界逐渐混合', '轮值、报酬和官署借调记录可区分私役与公用', '普通住户既依赖其安全也担心权力无法申诉', ['豪族护卫', '公共差役', '借调记录'], 5),
      motif('DS', 'commoner_advancement', 'late_local_apprenticeship', '晚期寒门上升更多依赖地方学徒与书吏路径', '旧式荐举名额缩小，日常技能却被官署长期需要', '抄写、算账、调解和师承记录可显示持续能力', '获得位置的人仍可能欠下师门、宗族与家庭多重人情', ['寒门学徒', '书吏路径', '持续能力'], 5),
      motif('DM', 'local_reputation', 'seasonal_rescue_reputation', '一次季节救急被放大为永久乡评', '捐粮、修堤或收容行动被不同派系各自解释', '当日物资、受助名单与后续来往可限制夸大叙述', '被捧高者可能失去拒绝下一次无底线要求的空间', ['乡里名望', '季节救急', '受助名单'], 3),
      motif('DM', 'old_new_elites', 'new_old_elite_service', '新旧豪族围绕日常公共服务重新竞争', '一方掌握旧人情，另一方掌握新式文书与运输', '乡学、道路、赈济和诉讼协助可逐项比较投入', '普通住户不应被迫用站队换取基本服务', ['新旧豪族', '公共服务', '地方竞争'], 3),
    ],
  },
  {
    domain: 'court_legitimacy',
    usageBoundary: COURT_USAGE_BOUNDARY,
    motifs: [
      motif('SP', 'enfeoffment', 'late_fief_service_review', '长期制度化后册封义务与实际服务脱节', '礼仪名位延续，地方供给和护送责任却几经转手', '历次文书、实际出资和属员去向可核验承担', '只维护名目会让基层替空缺责任买单', ['晚期册封', '服务义务', '历次文书'], 2),
      motif('SP', 'omens', 'seasonal_omen_administration', '季节异常被不同官署解释成互相竞争的祥异', '灾情观察、礼仪需要和政治声望混在同一奏报', '水位、收成、星候记录与版本流传可分开事实和解释', '普通救灾不应因象征争论被推迟', ['季节祥异', '奏报版本', '救灾'], 2),
      motif('DS', 'regency', 'routine_regency_seal', '监国常态运转中的印信与日常授权', '临时授权延续多年后边界逐渐模糊', '用印范围、回避事项和历次追认记录可显示惯例', '属官需要可执行规则，也担心一次签署被解释为政治表态', ['监国常务', '印信授权', '历次追认'], 4),
      motif('DS', 'powerful_minister', 'minister_office_household', '权臣官署与私人家门共享办事网络', '公文、私札和门生请求经过同一批经手者', '纸张、递送路线和受理时段可区分渠道', '低阶属吏若无法辨别边界，会被两边同时追责', ['权臣官署', '公私渠道', '递送路线'], 4),
      motif('DS', 'imperial_clan', 'clan_generation_allowance', '宗室世代增加后的常态供给与职责', '旧制按身份给付，却没有处理迁居、疾病和实际差役差异', '族籍、居所、照料与服务记录可支持分层复核', '公开调整可能触动名分，但沉默积压会伤及依赖者', ['宗室世代', '常态供给', '职责复核'], 4),
      motif('DM', 'court_legitimacy', 'late_ritual_precedent_conflict', '晚期新旧礼制先例在日常朝仪中冲突', '恢复旧制与承认多年惯例都各有支持者', '仪注批注、座次变化和参与者回忆可重建制度演变', '礼官、抄手和低阶来宾先承担反复改令的体面代价', ['晚期名分', '新旧礼制', '仪注批注'], 4),
    ],
  },
  {
    domain: 'diplomacy_alliance',
    motifs: [
      motif('SP', 'marriage_pact', 'seasonal_marriage_passage', '婚盟履行受到季节通道与本人生活安排限制', '使团期限、道路封阻和当事人意愿不能只靠盟书概括', '往返信件、护送准备和直接表态可分别核验', '维持联盟不得绕过年龄、同意和关系边界', ['婚盟通道', '季节道路', '本人意愿'], 2),
      motif('DS', 'border_dispute', 'pasture_river_border', '牧道与季节河床让边界争议反复移动', '农耕、放牧和关卡地图使用不同参照', '旧界碑、冬夏水线和双方日常通行可重建共用范围', '把所有越界都写成敌意会伤害长期相邻群体', ['季节边界', '牧道河床', '日常通行'], 4),
      motif('DS', 'truce', 'truce_market_calendar', '停战联络与互市节令需要长期协调', '军事戒备日、商队到达和祭礼日期互相冲突', '关门簿、使者往返与市集准备可确认实际窗口', '基层商旅和边民不应替上层迟复承担全部风险', ['停战日历', '互市节令', '使者往返'], 5),
      motif('DS', 'double_promises', 'multilateral_passage_promises', '多边借道承诺把同一路口许给不同队伍', '各方掌握的时刻表和安全责任并不相同', '盟书副本、驿程与补给预备可找出冲突段', '协调失败会先让向导、脚夫和随行家庭滞留', ['多边借道', '时刻表', '安全责任'], 5),
      motif('DM', 'hostages', 'hostage_household_seasons', '长期留居担保家庭经历换季后的生活边界', '教育、探亲、侍从更替与安全限制逐年累积', '家书、出入簿和照料安排可核验真实待遇', '担保关系不能抹去留居者的家庭选择与日常尊严', ['留居担保', '换季生活', '出入簿'], 4),
    ],
  },
  {
    domain: 'intelligence_covert',
    motifs: [
      motif('SP', 'prisoner_testimony', 'captured_account_weather', '降卒口供中的天气与地形细节需要复核', '讯问者熟悉军情却未必熟悉对方地区用语', '雨雪日期、山口方向和行程速度可检验叙述边界', '表达误差不能直接被写成欺骗或忠诚判断', ['降卒口供', '天气地形', '行程速度'], 2),
      motif('DS', 'counterintelligence', 'long_term_contact_pattern', '长期反间把正常熟人往来误读为联络网', '同乡、商路与师门关系在多年迁徙后高度重叠', '会面频率、交易内容和消息时效可区分日常与异常', '无限扩大怀疑会损害真正提供信息的社会网络', ['长期反间', '熟人往来', '消息时效'], 4),
      motif('DS', 'merchant_news', 'seasonal_merchant_news_age', '商旅消息因季节路线不同而具有不同新旧程度', '近路封闭后，晚到的目击可能比早到的转述更旧', '出发日、停留点、天气和货物状态可估算信息年龄', '听取消息不等于采信，商旅也不应因误差被定性', ['商旅消息', '信息年龄', '季节路线'], 4),
      motif('DS', 'delayed_report', 'bureaucratic_report_delay', '常态文书层级让军报在平静期反而迟到', '逐级核签保护准确，也可能错过环境变化', '驿站签收、补注时间和原稿版本可定位延迟位置', '末端送报者不应替整个制度链承担责任', ['迟到军报', '逐级核签', '版本时间'], 4),
      motif('DM', 'conflicting_intelligence', 'regional_measure_intelligence', '不同地域尺度让两份情报看似矛盾', '里程、人数与粮日使用了不同地方口径', '地图比例、量器和译述习惯可统一比较基准', '若只挑符合预期的一份，会放大既有偏见', ['矛盾情报', '地域尺度', '比较基准'], 3),
      motif('DM', 'disguise', 'seasonal_worker_disguise', '季节短工身份被误作刻意伪装', '衣着、口音和临时工具与常住登记不符', '雇工牌、工钱、投宿和技能痕迹可提供生活解释', '流动者需要自证，但核验不能先假定其有隐秘目的', ['季节短工', '身份伪装', '雇工牌'], 3),
    ],
  },
  {
    domain: 'frontier_ethnic',
    usageBoundary: FRONTIER_USAGE_BOUNDARY,
    motifs: [
      motif('SP', 'frontier_trade', 'frontier_seasonal_credit', '边塞与南中互市中的季节信用', '风雪封口或雨季断路使交货日无法按平原习惯计算', '牲畜状态、山道水痕与分批交付可证明履约努力', '不同群体内部也有债主、译商和小户的利益差异', ['边地互市', '季节信用', '分批交付'], 2),
      motif('SP', 'customs', 'internal_custom_variation', '相邻群体内部的节令礼俗并不一致', '外来官吏把一个支系做法误当成所有人的统一规则', '不同村寨见证、婚丧时序和互市安排可显示内部差异', '简化分类会让无关家庭承担误会与限制', ['礼俗差异', '支系内部', '节令'], 2),
      motif('DS', 'frontier_treaty', 'seasonal_treaty_checkpoint', '盟约条款落到冬夏不同关口时出现空白', '固定通行线无法覆盖迁牧和汛期绕道', '关卡记录、牲畜路线和双方译本可补足执行语境', '条文调整需要协商，不能把季节绕行直接视为毁约', ['边疆盟约', '季节关口', '迁牧路线'], 5),
      motif('DS', 'submission', 'household_submission_choices', '归附名册掩盖家庭之间不同选择', '首领表态、支系决定和普通住户生活安排并不同步', '迁居、互市、纳物和亲属去向可显示实际参与程度', '不得把个人沉默或迟疑写成整个群体的敌意', ['归附名册', '家庭选择', '支系差异'], 5),
      motif('DS', 'chief_authority', 'seasonal_chief_council', '季节迁徙前的首领议事权需要重新确认', '放牧、耕作与互市支系拥有不同发言基础', '礼物分配、随行人数和既往调解可观察支持范围', '对外谈判者不一定能替所有内部成员作不可撤回决定', ['首领议事', '季节迁徙', '支持范围'], 5),
      motif('DS', 'resettlement', 'mountain_valley_resettlement', '山谷迁居需要匹配水源、坡地与旧有邻里', '地图上的空地可能是季节牧场或共同采集地', '泉水流量、足迹、旧棚与多方口述可核验真实使用', '安置新户不能让旧使用者突然失去生活来源', ['山谷迁居', '季节牧场', '共同采集'], 5),
      motif('DS', 'translation', 'regional_measure_translation', '盟文中的距离与贡物量使用不同地域尺度', '译成统一数字后反而丢失原有弹性范围', '双语账、实物量器和旧次履行可还原各自含义', '译者需要解释差异，而不是替任何一方暗自定夺', ['盟文翻译', '地域尺度', '双语账'], 5),
      motif('DS', 'frontier_army_division', 'frontier_garrison_season', '边军内部围绕冬夏驻点与家属安排分裂', '本地兵、外调兵和协防者承担的路程不同', '换防簿、家属居所、草料与水源可比较真实成本', '内部差异不应被写成族群整体是否可靠', ['边军分歧', '冬夏驻点', '家属安排'], 6),
    ],
  },
  {
    domain: 'scholars_ritual',
    motifs: [
      motif('SP', 'study_travel', 'seasonal_study_hospitality', '游学者随季节路线依赖地方接待网络', '渡口封闭、书院开讲和家庭盘缠各有时限', '投宿信、讲席日和旅费来源可重建选择条件', '求学路线会形成新关系债，却不应被直接解释为派系归属', ['季节游学', '地方接待', '旅费来源'], 2),
      motif('DS', 'sacrifice', 'local_seasonal_sacrifice', '地方祭祀随水土与农时形成不同次序', '新任礼官试图用统一日程替换地方长期做法', '祭品来源、参与范围和历年灾情可说明仪式功能', '调整礼序若忽视日常，会先影响承担准备的普通家庭', ['地方祭祀', '农时礼序', '祭品来源'], 6),
      motif('DS', 'recommendation', 'late_skill_recommendation', '晚期荐举开始评价长期行政与技艺服务', '门第声望、日常能力和新式考课口径互相竞争', '历年办事、师承、失误修正和受助者反馈可分层核验', '被荐者可能有真实能力，也可能背负举主关系债', ['晚期荐举', '日常能力', '长期服务'], 6),
      motif('DS', 'banquet', 'seasonal_small_banquet', '节令小宴成为跨身份交换消息的日常场域', '座次、食材来源和来宾停留时长引出不同解读', '采买账、请柬与仆役见闻可限定公开与私下内容', '不参加可能伤及熟人关系，参加也不等于认同所有议论', ['节令小宴', '座次', '采买账'], 6),
      motif('DM', 'classics', 'late_commentary_generation', '晚期经学注本在师徒世代间不断增补', '旧章句、新政务需求和地方抄本形成多层文本', '墨色、边注、引用顺序与师承可区分各次改动', '年轻整理者若承认混合来源，会同时触动几位老师声望', ['晚期经学', '注本增补', '师徒世代'], 2),
      motif('DM', 'local_education', 'winter_school_household', '冬季乡学与家庭劳作争用少年时间', '教化日程没有考虑照料、织作和取薪需要', '出勤、家务时段和借灯用纸记录可设计弹性安排', '坚持全日授课会先排除贫寒家庭，停课也会中断上升路径', ['冬季乡学', '家庭劳作', '弹性授课'], 3),
    ],
  },
  {
    domain: 'family_daily_life',
    usageBoundary: FAMILY_USAGE_BOUNDARY,
    motifs: [
      motif('SP', 'inns', 'seasonal_inn_long_stay', '道路封阻让短住旅客变成长住邻居', '旅舍押金、炊食和照料规则仍按数日停留设计', '投宿簿、共灶支出和互助记录可重算责任', '旅客需要生计与尊严，店家家庭也不能无限承担成本', ['季节封路', '旅舍长住', '共灶支出'], 2),
      motif('DS', 'family_separation', 'multi_generation_separation', '长期离散让两代人形成不同家庭记忆', '长辈坚持旧约，年轻人只熟悉现居照料关系', '家书、汇款、照料事实与共同经历可并列而非互相取消', '团聚安排不能把任何一方现有生活当作空白', ['长期离散', '两代记忆', '照料事实'], 5),
      motif('DS', 'reunion', 'seasonal_reunion_household', '换季团聚后家务、财物与居所需要重新协商', '欢迎归来不等于旧有位置可以原样恢复', '床位、劳作、共同支出和直接意愿可逐项确认', '若用亲情压过协商，最依赖现有秩序的人会先失去安全感', ['换季团聚', '家务协商', '共同支出'], 5),
      motif('DS', 'urban_entertainment', 'seasonal_troupe_neighborhood', '节令班社演出与邻里作息发生冲突', '夜场收入、噪声、灯火和街道通行各有现实需要', '排演时刻、观众流向和摊贩收益可支持分段安排', '简单禁演会伤及艺人与小贩，放任也会挤压居民休息', ['节令班社', '邻里作息', '夜场收入'], 6),
      motif('DS', 'women_business', 'regional_household_workshop', '妇女经营的家庭作坊进入跨地域订单', '远途信用、季节原料和亲族照料改变原有分工', '进货账、工时、交付与照料安排可确认实际贡献', '扩大经营不应自动把决定权转给出资亲族或外来商人', ['家庭作坊', '跨地域订单', '实际贡献'], 6),
      motif('DM', 'marriage', 'seasonal_household_residence', '婚后四季居住与照料安排需要本人持续协商', '农忙、探亲、病者照护和双方生计不能由一次婚约穷尽', '往返时段、劳作安排与直接表达可支持调整', '关系承诺不得覆盖当事人的年龄、同意与日常自主', ['婚后居住', '四季照料', '本人协商'], 3),
      motif('DM', 'caregiving', 'long_term_caregiver_rotation', '长期疾病照料进入家庭轮替疲劳', '最熟练者被默认无限承担，其他人又缺少学习机会', '用药、夜间起身、误工与情绪记录可设计渐进交接', '照料者的疲惫需要被看见，病者也不应被当成负担对象', ['长期照料', '轮替疲劳', '渐进交接'], 3),
    ],
  },
] as const satisfies readonly Batch4DomainBlueprint[];

const BATCH_4_AFTERMATH_DOMAIN = {
  domain: 'aftermath_transition',
  usageBoundary: AFTERMATH_USAGE_BOUNDARY,
  motifs: [
    motif('AM', 'captives', 'released_captive_home_registry', '既成释放结果后的归家登记', '旧俘名、现居和家庭接纳没有同步更新', '释放记录与归家后的实际生活可共同核验', '归来者及其家人需要恢复日常而非永久受疑', ['aftermath:captives_released'], 5),
    motif('AM', 'captives', 'captive_exchange_dependents', '既成交换结果后的随行家属安置', '名单只记录被交换者，没有覆盖照料者与孩子', '交换名册与同行关系可界定需要继续帮助的人', '家庭不能因不在正式名单上而失去基本过渡支持', ['aftermath:captives_released'], 5),
    motif('AM', 'remains', 'remains_identity_return', '既成战斗结果后的遗骸身份复核', '器物、衣着与口述只能提供不完整线索', 'Combat 结果、遗物编号和家属描述需要交叉确认', '错误认领会给多个家庭留下难以修复的伤害', ['combat:completed'], 5),
    motif('AM', 'remains', 'seasonal_burial_access', '既成伤亡结果后的季节安葬通路', '冰雪、汛水或山路封阻影响送返与祭告', 'War 结果和道路状态可限定可行处置', '延迟需要被解释并照顾家属，而不是伪造已经完成的安葬', ['war:completed'], 5),
    motif('AM', 'remains', 'unclaimed_remains_public_duty', '既成冲突结果后的无主遗骸公共责任', '军营、地方和途经者都认为应由别人接手', '结果名册与发现位置可确定临时保管边界', '无名者仍需要有尊严的记录与处置程序', ['combat:completed'], 5),
    motif('AM', 'missing', 'missing_person_seasonal_trace', '既成战争结果后的季节失踪线索', '迁徙、渡口变化与旧消息时效互相纠缠', 'War 结果与沿途登记可逐段缩小查找范围', '家庭需要现实安排，也保留继续核验的可能', ['war:completed'], 5),
    motif('AM', 'missing', 'missing_status_household_decision', '既成事项终结后的失踪身份悬置', '家产、照料和再登记都等待一个无法强求的答案', '事项结果与后续见证只能支持阶段性判断', '制度需要临时办法，不能擅自宣告人物生死', ['matter:resolved'], 5),
    motif('AM', 'revenge', 'revenge_pressure_after_funeral', '既成伤亡结果后的丧礼复仇压力', '家属悲痛、同伍承诺与地方调解互相拉扯', 'Combat 结果只确认前置结果，不替任何人决定报复', '拒绝复仇与选择追索都可能改变关系，需要保留人物主动权', ['combat:completed'], 5),
    motif('AM', 'revenge', 'misidentified_enemy_after_war', '既成战争结果后的仇怨对象误认', '口音、旗号和转述把不同队伍混为一体', 'War 结果与可核验身份记录能阻止扩大归罪', '不能把群体标签当作个人责任证明', ['war:completed'], 5),
    motif('AM', 'revenge', 'intergenerational_revenge_debt', '既成旧事终结后的代际仇债', '年轻人被要求继承并未亲历的承诺', '事项结果与家族记录只能说明来由，不能制造义务', '人物可协商纪念、补偿或拒绝继续伤害', ['matter:resolved'], 5),
    motif('AM', 'reconstruction', 'rebuild_water_route_priority', '既成灾害结果后的水路重建次序', '码头、灌渠和民居争用同一批木石', '灾害结果与实际通行需求可比较恢复优先级', '先恢复一种功能会让另一些家庭继续承担过渡成本', ['disaster:resolved'], 5),
    motif('AM', 'reconstruction', 'postwar_workshop_recovery', '既成战争结果后的工坊复业', '工具、师徒与订单关系都已分散', 'War 结果和现存器具账可限定可恢复范围', '复业不能凭空恢复资源，也要照顾失去原岗位的人', ['war:completed'], 5),
    motif('AM', 'relief', 'relief_second_round_appeal', '既成灾害结果后的第二轮赈济申诉', '首轮名单没有覆盖迟归者与寄居家庭', '灾害结果、领取凭据和现居事实可支持复核', '补发要防止重复，也不能让弱势者永远错过窗口', ['disaster:resolved'], 5),
    motif('AM', 'relief', 'seasonal_relief_transition', '既成救灾结果从急赈转入季节生计', '口粮、种子、修屋与照料需求不再能用同一标准', '灾害结果与家庭恢复阶段可区分支持方式', '停止急赈不等于所有家庭已经恢复', ['disaster:resolved'], 5),
    motif('AM', 'relief', 'local_relief_credit', '既成事项终结后的民间垫付归还', '商户、宗族与邻里先行供给却缺少统一凭据', '事项结果与零散账目可核验真实支出', '清偿制度不能让善意垫付变成永久人情控制', ['matter:resolved'], 5),
    motif('AM', 'arms_recovery', 'recovered_arms_craft_reuse', '既成军械回收结果后的工匠复检', '可修、可拆与危险器件混在同一批清单', '回收结果与工艺检验可限定再利用范围', '不得把待检器械直接写成可用资源或确定库存', ['aftermath:arms_recovered'], 5),
    motif('AM', 'arms_recovery', 'village_tool_reclaim', '既成军械回收结果后的民用工具认领', '战时征用的斧锄与军械部件标记相近', '回收编号和原使用痕迹可支持逐件核验', '村户需要恢复生计，军中也需要避免错误放还', ['aftermath:arms_recovered'], 5),
    motif('AM', 'old_officials_disposal', 'old_clerk_service_transfer', '既成政权变化后的旧吏服务交接', '熟悉民生日常的人同时背负忠诚怀疑', '政权结果与实际办事记录可分开能力和立场', '留用或停用都不能凭 StoryPack 直接决定', ['regime:changed'], 5),
    motif('AM', 'old_officials_disposal', 'archive_custody_after_regime', '既成政权变化后的档案保管责任', '印信更换早于田籍、狱案与赈济账交接', '政权结果和封存清单可建立可追索移交', '普通人不应因权力交替失去原有手续证明', ['regime:changed'], 5),
    motif('AM', 'public_trust', 'post_disaster_notice_correction', '既成灾害结果后的公告纠错', '最初数字与后续复核不一致', '灾害结果和修订时间线可区分未知、误记与隐瞒', '承认修正可能暂损声望，却能避免让百姓依错误信息行动', ['disaster:resolved'], 5),
    motif('AM', 'public_trust', 'regime_daily_service_trust', '既成政权变化后的日常服务信任', '旗号与官名已换，市场、诉讼和照料窗口仍待稳定', '政权结果与窗口实际运转可检验承诺', '百姓是否信任应由持续经验形成，不能由叙事直接宣告', ['regime:changed'], 5),
    motif('AM', 'public_trust', 'resolved_matter_public_explanation', '既成事项终结后的公开说明', '处置已结束，但理由与边界没有被普通受影响者理解', '事项结果与可公开记录能支持有限解释', '说明不能泄露无关隐私，也不能篡改已封存结果', ['matter:resolved'], 5),
    motif('AM', 'victory_distribution', 'victory_household_compensation', '既成胜利结果后的家庭补偿次序', '报功名单与长期照料负担关注不同贡献', 'War 结果和经核实的承担记录可供讨论', '分配仍由权威系统决定，候选只揭示被忽略的家庭成本', ['war:completed'], 5),
    motif('AM', 'victory_distribution', 'allied_victory_shared_cost', '既成胜利结果后的盟友成本核对', '公开荣誉与运输、救护、向导投入没有同表记录', 'War 结果和各方账目可比较而不能自动改写战果', '争议需要协商，不能预设哪一方必然获利或背叛', ['war:completed'], 5),
    motif('AM', 'victory_distribution', 'victory_recovered_market', '既成胜利结果后的市场恢复份额', '军用优先、工匠复业和民生日用争用释放物资', 'War 结果与真实库存账才能限定可分配范围', 'StoryPack 不写回资源，只提出不同恢复顺序的社会代价', ['war:completed'], 5),
  ],
} as const satisfies Batch4DomainBlueprint;

const BATCH_4_DOMAINS = [
  ...BATCH_4_REGULAR_DOMAINS,
  BATCH_4_AFTERMATH_DOMAIN,
] as const satisfies readonly Batch4DomainBlueprint[];

const KIND_BY_BLUEPRINT: Record<Batch4BlueprintKind, WorldlineStoryThreadKind> = {
  SP: 'structuralPressure',
  DS: 'domainSituation',
  DM: 'dramaMotif',
  AM: 'aftermath',
};

export const THREE_KINGDOMS_STORY_PACK_BATCH_4_ERA_QUOTAS = {
  '184_191': 80,
  '192_207': 80,
  '208_222': 80,
  '223_249': 80,
  '250_280': 180,
} as const;

export const THREE_KINGDOMS_STORY_PACK_BATCH_4_REGION_QUOTAS = {
  north_plain: 50,
  frontier: 90,
  guanzhong: 55,
  bashu: 65,
  jingxiang: 60,
  jiangdong: 60,
  huainan: 55,
  nanzhong: 65,
} as const;

export const THREE_KINGDOMS_STORY_PACK_BATCH_4_ROLE_QUOTAS = {
  soldier: 50,
  official: 45,
  civilian_refugee: 80,
  merchant_craftsman: 70,
  scholar_retainer: 65,
  wanderer_outsider: 70,
  family_member: 65,
  envoy_foreigner: 55,
} as const;

export const THREE_KINGDOMS_STORY_PACK_BATCH_4_FACET_QUOTAS = {
  public_front: 35,
  private_backdoor: 40,
  ledger_resources: 45,
  night_season: 80,
  familiar_network: 40,
  rumor_intelligence: 35,
  deadline_order: 25,
  aftermath_cost: 45,
  misidentification: 30,
  evidence: 40,
  silence: 25,
  reversal: 25,
  interest_conflict: 20,
  dual_loyalty: 15,
} as const;

const ERA_CONTEXT: Record<keyof typeof THREE_KINGDOMS_STORY_PACK_BATCH_4_ERA_QUOTAS, string> = {
  '184_191': '秩序频繁重组，临时规则与地方自救仍在磨合。',
  '192_207': '多方长期并立，跨辖区协作与反复迁徙改变了旧有关系。',
  '208_222': '区域制度逐渐成形，水陆交通与联盟承诺需要转入日常执行。',
  '223_249': '长期战争疲劳开始沉入家庭、官署与地方生计，恢复成本越来越具体。',
  '250_280': '世代更替与长期战争疲劳并存，制度已经常态化，新旧官吏、旧制新制和恢复责任都进入持续交接。',
};

const REGION_CONTEXT: Record<keyof typeof THREE_KINGDOMS_STORY_PACK_BATCH_4_REGION_QUOTAS, string> = {
  north_plain: '北方平原道路开阔却受风雪、河泛与远距驿程牵制',
  frontier: '边塞关隘、风沙与迁牧路线使通行和互市具有季节边界',
  guanzhong: '关中塬地、谷口与灌渠把城郭供给和乡里农时连在一起',
  bashu: '巴蜀山道、栈路与峡江水势让短距离也可能承担高转运成本',
  jingxiang: '荆襄江汉水网、渡口与湖泽使陆路规则不能直接套到舟船',
  jiangdong: '江东潮汐、圩田与密集水路让市场和农时随水位变化',
  huainan: '淮南陂塘、河渠和平原交错，旱涝转换会迅速改变路线与物价',
  nanzhong: '南中山谷、雨季与多样地方社会要求翻译、协商并承认群体内部差异',
};

const SEASON_CONTEXT = [
  { id: 'spring', label: '春', text: '春耕、融水与道路初通同时争用劳力' },
  { id: 'summer', label: '夏', text: '夏汛、暑疫与水路涨落压缩处置时窗' },
  { id: 'autumn', label: '秋', text: '秋收、转运与储藏准备叠在同一段晴日' },
  { id: 'winter', label: '冬', text: '冬藏、冰雪与取暖需求暴露长期承载差异' },
] as const;

const ROLE_CONTEXT: Record<keyof typeof THREE_KINGDOMS_STORY_PACK_BATCH_4_ROLE_QUOTAS, string> = {
  soldier: '军人从轮值、通行与同伍照料观察',
  official: '官吏从程序、交接与公共责任观察',
  civilian_refugee: '百姓或流民从生计、居所与被看见的需要观察',
  merchant_craftsman: '商人或工匠从信用、技艺与交付条件观察',
  scholar_retainer: '士人或门客从文本、声望与传承关系观察',
  wanderer_outsider: '游侠或边缘人物从跨界经验与自证压力观察',
  family_member: '家庭成员从照料、共同生活与长期承诺观察',
  envoy_foreigner: '使者或外来者从翻译、往返与多边责任观察',
};

const FACET_CONTEXT: Record<keyof typeof THREE_KINGDOMS_STORY_PACK_BATCH_4_FACET_QUOTAS, string> = {
  public_front: '公开处置要让不同承担者分别陈述，而不是用声量替代证据。',
  private_backdoor: '私下协商可以暴露真实顾虑，但不得把关系承诺写成既成交易。',
  ledger_resources: '资源与账目只能提出核验入口，实际数值仍服从权威账本。',
  night_season: '夜间与季节条件改变可见度、路程和照料能力，需要保留现场差异。',
  familiar_network: '熟人网络既能提供帮助也会制造人情压力，不能自动等同串联。',
  rumor_intelligence: '传言必须标记时效与来源，只能影响调查方向，不能成为事实。',
  deadline_order: '期限会迫使各方公开优先级，但逾期后果仍由本局行动决定。',
  aftermath_cost: '抽象处置必须看见具体人物与家庭成本，不得据此虚构权威结果。',
  misidentification: '相似身份、口音或物件可能造成误认，必须保留更正路径。',
  evidence: '线索只能缩小解释范围，需要与本局记录和行动交叉核验。',
  silence: '沉默可能来自恐惧、照料或利益，不能直接被写成认罪。',
  reversal: '新材料可以推翻简单解释，却不预设另一套解释必真。',
  interest_conflict: '不同利益需要被摊开协商，不能把一方需求写成天然正当。',
  dual_loyalty: '两份责任可以同时真实存在，人物仍可协商第三条路径。',
};

const VARIANT_FOCUS: Record<Batch4BlueprintKind, readonly string[]> = {
  SP: ['规则入口', '承受方'],
  DS: ['场域条件', '参与者关系', '可核记录', '资源承载', '通路差异', '时序变化'],
  DM: ['承诺冲突', '误判来源', '人物代价', '证据反转'],
  AM: ['家庭重排', '账册复核', '关系修补', '公共处置', '长期记忆'],
};

type QuotaKey<T extends Readonly<Record<string, number>>> = Extract<keyof T, string>;

function buildSpreadQuota<T extends Readonly<Record<string, number>>>(
  quotas: T,
): Array<QuotaKey<T>> {
  const remaining = new Map(
    Object.entries(quotas).map(([key, value]) => [key as QuotaKey<T>, value]),
  );
  const result: Array<QuotaKey<T>> = [];

  while ([...remaining.values()].some((value) => value > 0)) {
    for (const key of remaining.keys()) {
      const value = remaining.get(key) ?? 0;
      if (value <= 0) continue;
      result.push(key);
      remaining.set(key, value - 1);
    }
  }

  return result;
}

function chooseDistinctFacets(
  remaining: Map<keyof typeof THREE_KINGDOMS_STORY_PACK_BATCH_4_FACET_QUOTAS, number>,
  count: number,
  motifIndex: number,
): Array<keyof typeof THREE_KINGDOMS_STORY_PACK_BATCH_4_FACET_QUOTAS> {
  const keys = [...remaining.keys()];
  const ranked = keys
    .map((key, index) => ({
      key,
      remaining: remaining.get(key) ?? 0,
      tieBreak: (index - motifIndex + keys.length) % keys.length,
    }))
    .filter((entry) => entry.remaining > 0)
    .sort((left, right) => (
      right.remaining - left.remaining || left.tieBreak - right.tieBreak
    ));
  const selected = ranked.slice(0, count).map((entry) => entry.key);

  if (selected.length !== count) {
    throw new Error(`Batch 4 facet quota exhausted for motif ${motifIndex}.`);
  }
  for (const key of selected) {
    remaining.set(key, (remaining.get(key) ?? 0) - 1);
  }
  return selected;
}

function buildSummary(input: {
  blueprint: Batch4MotifBlueprint;
  globalIndex: number;
  variantIndex: number;
  eraId: keyof typeof THREE_KINGDOMS_STORY_PACK_BATCH_4_ERA_QUOTAS;
  region: keyof typeof THREE_KINGDOMS_STORY_PACK_BATCH_4_REGION_QUOTAS;
  role: keyof typeof THREE_KINGDOMS_STORY_PACK_BATCH_4_ROLE_QUOTAS;
  facet: keyof typeof THREE_KINGDOMS_STORY_PACK_BATCH_4_FACET_QUOTAS;
  season: typeof SEASON_CONTEXT[number];
}): string {
  const {
    blueprint,
    globalIndex,
    variantIndex,
    eraId,
    region,
    role,
    facet,
    season,
  } = input;
  const focus = VARIANT_FOCUS[blueprint.kind][variantIndex];
  const location = REGION_CONTEXT[region];
  const era = ERA_CONTEXT[eraId];
  const roleView = ROLE_CONTEXT[role];
  const facetRule = FACET_CONTEXT[facet];
  const cores = [
    `${location}；${season.text}。围绕“${blueprint.subject}”的${focus}，${blueprint.condition}。`,
    `${season.text}，而${location}。这使“${blueprint.subject}”不能按单一旧例处理：${blueprint.condition}。`,
    `在${location}的条件下，${blueprint.subject}进入${season.label}季处置；${blueprint.condition}。`,
    `${blueprint.subject}落到${location}时，${season.text}；${blueprint.condition}，各方因此从${focus}提出不同办法。`,
    `${season.label}季的现实约束把“${blueprint.subject}”带到具体场域：${location}；${blueprint.condition}。`,
    `${location}改变了${blueprint.subject}的日常执行，${season.text}又放大${focus}上的分歧；${blueprint.condition}。`,
  ];
  const evidenceAndStake = [
    `可先核对${blueprint.evidence}。${blueprint.stake}。`,
    `${blueprint.evidence}提供可复核入口；同时，${blueprint.stake}。`,
    `调查不应越过${blueprint.evidence}，并须看见：${blueprint.stake}。`,
    `现有线索包括${blueprint.evidence}；处置若悬置，${blueprint.stake}。`,
    `各方可围绕${blueprint.evidence}交叉查验，因为${blueprint.stake}。`,
    `先把${blueprint.evidence}排成时间线，再回应${blueprint.stake}。`,
  ];

  return [
    era,
    cores[globalIndex % cores.length],
    evidenceAndStake[(globalIndex + variantIndex) % evidenceAndStake.length],
    roleView,
    facetRule,
    blueprint.kind === 'AM'
      ? '本条只讨论结构化结果之后的社会后续，不创建前置结果。'
      : '本条只形成候选压力与核验入口，不宣告事实或锁定结局。',
  ].join('');
}

function buildBatch4Threads(): WorldlineStoryThread[] {
  const eraSequence = buildSpreadQuota(THREE_KINGDOMS_STORY_PACK_BATCH_4_ERA_QUOTAS);
  const regionSequence = buildSpreadQuota(THREE_KINGDOMS_STORY_PACK_BATCH_4_REGION_QUOTAS);
  const roleSequence = buildSpreadQuota(THREE_KINGDOMS_STORY_PACK_BATCH_4_ROLE_QUOTAS);
  const facetRemaining = new Map<
    keyof typeof THREE_KINGDOMS_STORY_PACK_BATCH_4_FACET_QUOTAS,
    number
  >(
    Object.entries(THREE_KINGDOMS_STORY_PACK_BATCH_4_FACET_QUOTAS)
      .map(([key, value]) => [
        key as keyof typeof THREE_KINGDOMS_STORY_PACK_BATCH_4_FACET_QUOTAS,
        value,
      ]),
  );
  const threads: WorldlineStoryThread[] = [];
  let motifIndex = 0;
  let globalIndex = 0;
  const domainBlueprints: readonly Batch4DomainBlueprint[] = BATCH_4_DOMAINS;

  for (const domain of domainBlueprints) {
    for (const blueprint of domain.motifs) {
      const facets = chooseDistinctFacets(facetRemaining, blueprint.variants, motifIndex);
      for (let variantIndex = 0; variantIndex < blueprint.variants; variantIndex += 1) {
        const eraId = eraSequence[globalIndex];
        const region = regionSequence[globalIndex];
        const role = roleSequence[globalIndex];
        const facet = facets[variantIndex];
        const season = SEASON_CONTEXT[globalIndex % SEASON_CONTEXT.length];
        const eraBand = THREE_KINGDOMS_STORY_ERA_BANDS
          .find((candidate) => candidate.id === eraId);
        if (!eraBand || !THREE_KINGDOMS_STORY_REGIONS.includes(region)) {
          throw new Error(`Batch 4 quota metadata missing at thread ${globalIndex}.`);
        }

        const focus = VARIANT_FOCUS[blueprint.kind][variantIndex];
        const usageBoundary = [
          COMMON_USAGE_BOUNDARY,
          domain.usageBoundary ?? '',
        ].join('');
        threads.push(createThreeKingdomsStoryThread({
          kind: KIND_BY_BLUEPRINT[blueprint.kind],
          domain: domain.domain,
          subdomain: blueprint.subdomain,
          motifId: blueprint.motifId,
          facet,
          title: `${blueprint.subject}：${REGION_CONTEXT[region].split('，')[0]}${season.label}季${focus}`,
          summary: buildSummary({
            blueprint,
            globalIndex,
            variantIndex,
            eraId,
            region,
            role,
            facet,
            season,
          }),
          entrySignals: [...blueprint.entrySignals],
          escalationShapes: [
            `${focus}让各方说明实际承担与优先级`,
            `${blueprint.evidence}推动核验而非定罪`,
            `${blueprint.stake}要求保留人物回应空间`,
          ],
          rolePerspectives: [role],
          relatedTags: [
            ...blueprint.entrySignals,
            `domain:${domain.domain}`,
            `era:${eraId}`,
            `region:${region}`,
            `season:${season.id}`,
            `batch:4`,
            ...(eraId === '250_280' ? ['semantic:late_era'] : []),
            'semantic:regional',
            'semantic:seasonal',
          ],
          timeRange: {
            start: `公元${eraBand.startYear}年`,
            end: `公元${eraBand.endYear}年`,
          },
          reusePolicy: blueprint.kind === 'AM'
            ? 'save_single_use'
            : blueprint.kind === 'DS'
              ? 'context_reusable'
              : 'motif_reusable',
          cooldownTurns: blueprint.kind === 'AM'
            ? 24
            : 10 + ((variantIndex % 4) * 2),
          promptSafeVersion: '1.0.0',
          usageBoundary,
        }));
        globalIndex += 1;
      }
      motifIndex += 1;
    }
  }

  if (globalIndex !== 500 || motifIndex !== 126) {
    throw new Error(`Batch 4 expected 500 threads / 126 motifs, got ${globalIndex} / ${motifIndex}.`);
  }
  if ([...facetRemaining.values()].some((value) => value !== 0)) {
    throw new Error('Batch 4 facet quotas were not fully consumed.');
  }

  return threads;
}

export const THREE_KINGDOMS_STORY_PACK_BATCH_4_BLUEPRINTS = BATCH_4_DOMAINS;
export const THREE_KINGDOMS_STORY_PACK_BATCH_4_THREADS = buildBatch4Threads();
