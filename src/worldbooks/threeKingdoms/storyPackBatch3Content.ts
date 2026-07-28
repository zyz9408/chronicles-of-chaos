import type { WorldlineStoryThread } from '../../engine/types';
import { createThreeKingdomsStoryThread } from './storyPackBuilder';
import {
  THREE_KINGDOMS_STORY_ERA_BANDS,
  THREE_KINGDOMS_STORY_REGIONS,
} from './storyPackCatalog';

export const THREE_KINGDOMS_STORY_PACK_BATCH_3_DRAMA_FUNCTIONS = [
  'deadline_order',
  'silence',
  'dual_loyalty',
  'reversal',
  'aftermath_cost',
] as const;

type Batch3DramaFunction =
  typeof THREE_KINGDOMS_STORY_PACK_BATCH_3_DRAMA_FUNCTIONS[number];

type MotifBlueprint = readonly [
  subdomain: string,
  motifId: string,
  subject: string,
  deadlineDecision: string,
  silenceGap: string,
  dualTension: string,
  reversalEvidence: string,
  personalCost: string,
  entrySignals: readonly string[],
];

interface DomainBatchBlueprint {
  domain: string;
  perspectives: readonly [string, string, string, string, string];
  motifs: readonly MotifBlueprint[];
  usageBoundary?: string;
}

const COMMON_USAGE_BOUNDARY = [
  '只能作为候选压力、关系矛盾、核验入口与人物代价。',
  '不得替任何人物决定，不得宣告事实、结局或权威数值，不得覆盖本局状态、事项、纪事、账本与确定性裁定。',
].join('');

const BATCH_3_DOMAINS = [
  {
    domain: 'military_camp',
    perspectives: ['soldier', 'official', 'family_member', 'wanderer_outsider', 'merchant_craftsman'],
    motifs: [
      ['guard_duty', 'relief_watch_oath', '换防承诺迟迟没有兑现', '天黑前决定谁继续守最危险的哨位', '负责排班的书吏拒绝说明缺额来自何处', '值夜者同时欠旧同袍一份情与新营伍一份服从', '一张临时调令显示原定接替者被另处借走', '连续值守的伤兵与其家人', ['换防承诺', '哨位缺额', '值夜排班']],
      ['military_law', 'mercy_order_before_sentence', '宽免口信撞上即将执行的军法', '行刑鼓响前确认口信是否足以暂停处置', '携信者不肯交代宽免请求由谁发起', '执法军吏既守成文军令又受旧上官私下托付', '案卷夹页证明原处罚依据漏记了一次交接', '被罚者同伍需要共同补足的差役', ['军法宽免', '暂停处置', '案卷夹页']],
      ['recruitment', 'sponsor_recruit_quota', '保人替新募者许下无法核实的条件', '点名编伍前决定是否接受这批有附带承诺的新兵', '保人对安家钱去向保持沉默', '新募者一边依赖保人一边必须服从营中统一编制', '旧里籍显示部分所谓自愿应募者正被别处追索', '留下照料田宅的亲属', ['募兵保人', '应募条件', '点名编伍']],
      ['injury_illness', 'hidden_sick_roll', '病名册被压在操练计划之后', '下一次出营前确认哪些人不宜继续负重', '军医助手不肯说是谁要求少报病号', '带队者同时承担成行期限与保护旧部的责任', '夜间用药记录显示病势比白日点验更重', '替病者多背军械的同伍', ['病名册', '军医记录', '出营点验']],
      ['host_guest_troops', 'burial_detail_divided_command', '客军阵亡者的安葬差役无人认领', '撤营期限前决定遗体与遗物由哪一营接管', '客军校尉不肯公开失去联络的家属名单', '合营小吏同时听命于驻地主将与客军旧长', '遗物木牌表明部分死者已被错误编入本营', '等待确认死讯的随营家眷', ['客军安葬', '遗物木牌', '合营差役']],
    ],
  },
  {
    domain: 'war_pressure',
    perspectives: ['soldier', 'official', 'civilian_refugee', 'envoy_foreigner', 'family_member'],
    usageBoundary: '胜负、伤亡、战果、撤退与地盘变化只能来自 Combat / War Engine 或既有结构化事实。',
    motifs: [
      ['reconnaissance', 'scout_return_before_gate', '斥候尚未齐返而城门将闭', '闭门时刻前决定是否为失联小队保留通道', '唯一先归者避谈同伴最后去向', '守门军官同时守城规与欠斥候队长的救命之情', '带回的泥土和马蹄磨损指向另一条返程路线', '被留在门外者的亲属与接应人', ['斥候未归', '城门时刻', '返程路线']],
      ['siege', 'evacuation_lane_deadline', '围困压力下的撤离通道只能短暂开放', '敌情变化前决定哪一批非战人员先行', '熟悉暗门的老兵拒绝说明通道为何不再安全', '护送者既要服从守城部署又要照顾城内亲眷', '废井中的新绳痕显示备用路线可能仍可使用', '没有名册担保的外来家庭', ['撤离通道', '围城压力', '暗门路线']],
      ['withdrawal', 'rear_guard_relief_promise', '殿后队伍等不到约定的接替', '道路被截断前决定继续等候还是改变掩护安排', '传令骑手对第二道命令的去向保持沉默', '殿后将校同时受撤军总令与保护伤队的旧约牵制', '沿路弃置的号旗证明前军并未按原路线撤离', '推车随队的伤者和民夫', ['殿后接替', '撤军道路', '第二道命令']],
      ['prisoners', 'exchange_list_sunset', '俘虏交换名单在日落前仍未闭合', '交换点撤除前确认一个姓名异写是否属于同一人', '负责抄录的降卒不肯解释删去的一行', '谈判吏既要守双方人数对等又答应过一户家属查人', '旧伤位置与籍贯证明被漏姓名可能对应另一编号', '名单外仍被扣留者的家属', ['俘虏交换', '姓名异写', '日落期限']],
      ['night_battle', 'signal_fire_misread', '夜间信号被两支队伍解释成相反命令', '下一轮号火出现前决定暂停还是继续既定调动', '点火手拒绝说出临时更换火序的人', '联络军士同时忠于本队口令与友军事先约定', '风向记录显示第一处火光可能来自意外燃烧', '夹在两条行军线之间的向导', ['夜战信号', '号火次序', '联络口令']],
    ],
  },
  {
    domain: 'logistics',
    perspectives: ['official', 'merchant_craftsman', 'soldier', 'civilian_refugee', 'wanderer_outsider'],
    motifs: [
      ['transport', 'bridge_crossing_priority', '一座临时桥同时等待军粮与逃难车队', '涨水前决定哪一列车辆先过桥', '验桥工匠不肯公开哪段木梁最薄弱', '押运官既受军粮期限约束又曾答应放行乡里车队', '桥下冲出的旧桩证明承重估算采用了错误跨度', '排在队尾的病弱旅人', ['临时桥', '过桥次序', '涨水期限']],
      ['courier', 'sealed_packet_handoff', '两封同印急件争用最后一匹驿马', '换马站关闭前决定先送哪一路文书', '驿吏拒绝说明其中一封为何没有登记来处', '骑手同时欠发信官署职责与收信故人的私情', '封泥裂纹显示一封急件曾被重新封合', '等待命令才能获得救助的边地住户', ['驿传急件', '封泥裂纹', '最后驿马']],
      ['grain_levy', 'grain_delivery_double_receipt', '同一村社收到两处催粮文书', '仓门封闭前决定把已集粮食送往何处', '里吏不肯出示最早收到的调拨回执', '运粮人既服从县廷征发又受驻军护村承诺牵制', '纸张水印证明较新的催文反而使用旧批公纸', '已经借粮凑额的小户', ['两处催粮', '调拨回执', '仓门期限']],
      ['boats', 'pilot_low_water_secret', '船队在浅滩前等待一个未公开的水道判断', '潮位回落前决定减载、绕行或暂停', '老舵工沉默不提昨夜航标被谁移动', '船主既要守货主交期又要顾全同行船户安全', '滩头新刮痕显示近期有更重船只从另一侧通过', '被要求卸货留岸的脚夫', ['浅滩航道', '航标移动', '潮位']],
      ['arms', 'repair_queue_field_need', '军械修理次序被前线催令打乱', '下一次发放前决定先修弩机还是护具', '工坊管事不肯说明一批合格零件被留给谁', '匠人既遵守验收标准又受熟识军士求急修的请求', '断件纹路证明问题来自同一批材料而非使用不当', '继续使用缺损护具的基层士卒', ['军械修理', '零件留用', '发放期限']],
    ],
  },
  {
    domain: 'administration',
    perspectives: ['official', 'scholar_retainer', 'civilian_refugee', 'merchant_craftsman', 'family_member'],
    motifs: [
      ['seals', 'acting_seal_return', '署理印信到期却仍在发文', '新任到署前决定哪些文书需要暂停生效', '掌印吏拒绝说明印匣昨夜离库的时段', '属吏同时受旧署理照拂与新任交接纪律约束', '纸上压痕证明一份文书先盖印后补日期', '已经按文书行动的普通住户', ['署理印信', '交接期限', '印匣记录']],
      ['tax_labor', 'dual_exemption_claim', '同一户同时持有两种互相冲突的免役凭证', '点役名册封存前决定采用哪一项减免', '经手书吏不肯说明第二张凭证的签发过程', '户主既受宗族保护又欠官府前次赈济的人情', '旧收据显示所谓全免其实只抵过一季差役', '临时被补入名册的邻户劳力', ['免役凭证', '点役名册', '差役减免']],
      ['old_officials', 'archive_key_silence', '旧吏握着新官急需的档案钥匙', '考课上报前决定是否绕开旧吏重建账册', '保管人拒绝解释缺失卷宗最后一次借阅', '接替者既要查清旧账又依赖旧吏维持日常运转', '库房灰尘中的箱印表明卷宗曾被整箱移位', '因证明缺失而办不成手续的百姓', ['旧吏档案', '卷宗钥匙', '考课期限']],
      ['amnesty', 'amnesty_notice_boundary', '赦令告示没有写清适用截止日', '放还名册公布前决定一批在押者是否列入', '送令者不肯说明口头补充条件来自哪级官署', '狱吏既守旧判牍又受上级宽宥意图牵制', '驿程记录证明赦令到达早于官署承认的日期', '等候家人归来的家庭', ['赦令截止', '放还名册', '驿程记录']],
      ['command_chain', 'overlapping_requisition_orders', '两级官署同时征用同一批车具', '车队出发前决定执行哪一道先到的命令', '负责转呈的门吏对一封撤令保持沉默', '地方主事既须服从上级又答应保护本地农时', '签押次序证明后发命令并不知晓前项征用', '失去车具便赶不上播种的农户', ['重叠征用', '撤令', '车具调拨']],
    ],
  },
  {
    domain: 'justice_security',
    perspectives: ['official', 'civilian_refugee', 'wanderer_outsider', 'family_member', 'soldier'],
    motifs: [
      ['testimony', 'witness_departure_deadline', '关键证人即将随商队离境', '关津放行前决定是否完成复核或暂留证人', '证人对第二次会面始终闭口不谈', '记录吏既要维护程序又欠证人家属照料之情', '旅舍账显示证人案发时可能并不在原称地点', '因暂留而失去生计行程的证人家人', ['证人离境', '关津放行', '旅舍账']],
      ['local_mediation', 'mediation_pledge_expiry', '调解抵押物即将到期返还', '族中集会散去前决定是否延长担保', '见证长者拒绝复述一方私下承诺', '担保人同时维护两族和气与本家利益', '抵押物修补痕迹证明其价值早在调解前已经受损', '依靠和解继续耕作的小户', ['调解抵押', '担保期限', '族中集会']],
      ['accusation', 'anonymous_accuser_exit', '匿名告发者要求在夜禁前离开', '城门关闭前决定如何验证线索又不暴露来者', '来者对自己如何取得内情保持沉默', '受理吏既须保护告发渠道又与被告家有旧交', '告发所列时辰与官署签到簿出现无法忽略的冲突', '被暂扣查问的无名雇工', ['匿名告发', '夜禁', '签到簿']],
      ['military_civilian_conflict', 'camp_market_jurisdiction', '营市冲突在军法与县廷之间无人接手', '伤者病情恶化前决定由哪一方先行取证', '当值军士不肯说明参与者中是否有上级亲随', '县吏既保护民户又受驻军供给依赖牵制', '市摊欠账证明争执起因可能是旧债而非抗军', '需要继续在营市谋生的摊贩家属', ['营市冲突', '军民管辖', '伤者取证']],
      ['prison_break', 'family_bargain_after_escape', '逃犯亲属提出限时协助追索', '线索失效前决定是否接受带条件的合作', '家属拒绝说出逃犯最可能求助的人', '追捕者既受缉拿职责约束又答应保护无罪孩童', '被遗弃的绳结证明逃脱路线与家属描述不同', '因一人逃脱而被反复盘问的同住者', ['越狱追索', '亲属合作', '逃脱绳结']],
    ],
  },
  {
    domain: 'agriculture_disaster',
    perspectives: ['civilian_refugee', 'official', 'merchant_craftsman', 'family_member', 'soldier'],
    motifs: [
      ['dikes', 'dike_labor_storm_deadline', '堤段缺口与暴雨同时逼近', '水位再涨前决定从哪一村先调工料', '看堤人不肯说明上次修补为何提前松脱', '乡吏既守全渠调度又要保护本乡低田', '木桩腐痕证明缺口并非本轮雨水才形成', '被临时抽走劳力的收割家庭', ['堤防缺口', '暴雨水位', '调工料']],
      ['drought_flood', 'shared_well_night_access', '旱时共井的夜间取水次序失控', '井绳磨断前决定新的取水轮次', '守井人拒绝说出谁在夜里越次取水', '一户长者既负责公井又要照顾自家病人', '罐底泥色显示被怀疑的外来户可能从另一口井取水', '排在末轮的牲畜与幼童照料者', ['旱井取水', '夜间轮次', '井绳']],
      ['farming_season', 'seed_grain_distribution_clock', '播种窗口缩短而种粮尚未分完', '下一场雨前决定按户数还是田亩发放', '管仓者不肯解释一批种粮的预留去向', '分粮人既受官府规则约束又答应照顾失牛邻户', '发芽试验显示最早入仓的一批反而不宜留种', '错过播期的佃户家庭', ['种粮发放', '播种窗口', '发芽试验']],
      ['epidemic', 'healer_casebook_silence', '疫病处置依赖一本未公开的医案', '隔离范围扩大前决定是否改变照护办法', '行医者拒绝说明最早几例的共同接触', '助手既守病家隐私又承担向官署报病的职责', '药渣与症候记录表明被归为同病的人可能分属两类', '被统一隔离而无人照料的老人', ['疫病医案', '隔离范围', '症候记录']],
      ['tenancy', 'landlord_tenant_double_levy', '佃户同时面对地主收租与官府征粮', '收割完成前决定哪一份应先从场上扣除', '庄头不肯说明地主曾否答应代纳', '佃户既依赖庄园保护又必须保留官府完粮凭据', '去年的收据证明双方曾采用另一种分摊办法', '留不下明年种粮的佃作家庭', ['佃租征粮', '代纳承诺', '收割场']],
    ],
  },
  {
    domain: 'trade_market',
    perspectives: ['merchant_craftsman', 'official', 'civilian_refugee', 'wanderer_outsider', 'family_member'],
    motifs: [
      ['market', 'stall_closure_before_fair', '会日前临时封闭一排摊位', '晨鼓开市前决定迁摊还是复核封闭理由', '市吏拒绝说明检查名单的来源', '行首既维护市规又答应替熟识小贩保住位置', '地租票据显示被封摊位恰好涉及同一债主', '靠一日流水购粮的摊贩家庭', ['摊位封闭', '晨鼓开市', '检查名单']],
      ['credit', 'silent_guarantor_maturity', '担保人在债期前突然失联', '兑付日到来前决定是否冻结互保交易', '担保人家中只肯承认一半往来', '商号伙计既忠于东家又替担保人保管过私账', '背书墨色证明最重一笔债务后来才被补入', '依赖这条信用链进货的小商户', ['担保失联', '债期', '互保背书']],
      ['checkpoints', 'two_passes_one_caravan', '一支商队持有两张路线相反的关津凭照', '夜禁前决定从哪道关口放行', '领队对更换路线的委托人保持沉默', '押队人既受出资商号之命又答应护送同行旅客', '草料账证明商队实际行程与两张凭照都不完全相符', '被扣在关外的短途脚夫', ['双重凭照', '商队路线', '关津夜禁']],
      ['hoarding', 'hidden_stock_owner_reversal', '被指为囤积的仓货出现第三方印记', '限价告示生效前决定是否查封', '看仓人拒绝说明夜间入库者的身份', '商人既要保护寄存客户又受同行公议约束', '包装内层的旧封签证明货物可能只是转运寄存', '等待这批货开工的工匠', ['囤积查封', '第三方封签', '仓货']],
      ['textiles', 'loom_wage_due', '织作工钱在交货日仍未结清', '成布运走前决定扣货还是接受延期', '账房不肯说出定金被挪作何用', '工头既维护东家信用又与织户有长期乡里关系', '经纬用料记录显示返工责任不全在织户', '靠这笔工钱购药的照料者', ['织作工钱', '成布交货', '用料记录']],
    ],
  },
  {
    domain: 'migration_population',
    perspectives: ['civilian_refugee', 'official', 'family_member', 'soldier', 'wanderer_outsider'],
    motifs: [
      ['city_entry', 'gate_close_split_group', '入城队伍在关门前被分成两段', '落闩前决定是否让无担保者随亲属进入', '带路人不肯说明少了哪一户的路引', '守门者既服从限额又认得队中一名旧邻', '沿途施粥簿证明被疑冒认的家庭一路同行', '留在城外的老人和幼童', ['城门入城', '担保路引', '落闩']],
      ['separation', 'missing_guide_last_ferry', '寻找失散者的向导赶不上末班渡船', '收缆前决定先渡河追踪还是留岸等消息', '船夫拒绝透露刚才包船人的去向', '向导既收了寻人家庭的报酬又答应带另一批人过境', '遗落的鞋履尺寸表明目击者认错了失散者', '把最后盘缠交给向导的家属', ['失散寻人', '末班渡船', '向导']],
      ['labor_allocation', 'sponsor_family_work_roster', '安置担保与劳役名册绑在一起', '开工点名前决定一户能否保留照料人', '保甲不肯说明为何替某些户划去名字', '担保亲族既要履行公役又想保护新迁来的家人', '灶籍证明被列为壮丁的人其实长期承担照料', '失去照料者的病弱家庭成员', ['安置劳役', '担保亲族', '点名名册']],
      ['registration', 'new_document_old_identity', '新附籍文书与旧路引姓名不一致', '配给登记截止前决定是否先行登记', '代写人拒绝解释为何改动了籍贯', '申请者既依赖新地保护又不愿背弃原乡家族联系', '旧契边注证明姓名变化可能来自过继而非冒用', '因身份悬置领不到口粮的同行者', ['附籍文书', '旧路引', '配给截止']],
      ['quarantine', 'caregiver_crossing_boundary', '照料者必须在两处隔离区之间选择', '换班时辰前决定由谁继续送药送饭', '前任照料者不肯说明一次违规接触', '照料者既保护病人隐私又承担避免扩散的公共责任', '送饭木牌显示被怀疑的越界发生在标记混乱时', '无人替换照护的幼小病者', ['隔离照料', '换班时辰', '送饭木牌']],
    ],
  },
  {
    domain: 'clan_local_society',
    perspectives: ['family_member', 'scholar_retainer', 'official', 'civilian_refugee', 'soldier'],
    motifs: [
      ['clan_mediation', 'elder_silence_before_oath', '宗族和解将在祭告前定稿', '盟誓开始前决定是否接受缺少一方证言的条款', '主事长者拒绝说明自己曾给哪一房私下保证', '晚辈调解者既守宗族体面又同情受损的外姓住户', '早年分家书证明争议土地从未完全归入任何一房', '被要求用婚事巩固和解的年轻亲属', ['宗族和解', '祭告盟誓', '分家书']],
      ['land_dispute', 'harvest_boundary_deadline', '有争议的田界已经进入收割期', '谷物入场前决定由谁暂收并保管', '看界老人不肯重复曾在酒后说出的旧界址', '庄头既受豪族雇用又与佃户同乡', '新露出的旧渠槽把原先直线边界变成另一种可能', '出工却可能分不到粮的佃户', ['田界收割', '旧渠槽', '暂收谷物']],
      ['private_forces', 'retainer_dual_muster', '同一批部曲收到宗主与地方守备两份集结令', '鸣鼓前决定先往哪处报到', '传令家臣拒绝说明宗主是否知晓官府征调', '部曲首领既受家族养护又承诺保卫所在乡里', '两份名册的签押时辰证明命令几乎同时发出', '无人看守田宅的部曲家属', ['部曲集结', '两份军令', '鸣鼓']],
      ['political_exchange', 'favor_ledger_reversal', '一笔政治人情被双方记成不同性质', '荐举名单公布前决定是否兑现旧承诺', '中间人不肯公开最初交换的完整条件', '被荐者既感激资助者又不愿成为其派系工具', '私账中的用词表明所谓赠礼可能原本只是借用', '因名额被挤出的寒门候选人', ['政治人情', '荐举名单', '私账']],
      ['commoner_advancement', 'family_cost_of_patronage', '寒门子弟获得机会却要家中承担回报', '启程赴任前决定是否接受附带差役的资助', '受荐者对家人隐瞒了担保条件', '受荐者既报答举主又承担保护原生家庭的责任', '荐书附页显示举主要求的并非原先口头所说', '需要替其偿还人情的兄弟姐妹', ['寒门资助', '担保条件', '启程期限']],
    ],
  },
  {
    domain: 'court_legitimacy',
    perspectives: ['official', 'scholar_retainer', 'family_member', 'envoy_foreigner', 'soldier'],
    usageBoundary: '只提供通用名分、礼仪与权力压力，不创建或强迫具体历史政变、继承结果或政权结局。',
    motifs: [
      ['succession', 'regency_deadline_unconfirmed_heir', '监护安排必须在继承资格未明时先行生效', '朝会前决定谁能暂时代行签署', '宗室长者拒绝公开一份临终口信', '近臣既维护法定次序又受旧主托孤之情牵制', '族谱增补日期证明一名候选人的资格晚于众人认知', '被当作政治筹码安置的幼年亲属', ['继承资格', '监护安排', '朝会期限']],
      ['edict_authenticity', 'copyist_silence_sealed_edict', '一份急诏只有抄本先到', '百官散去前决定是否依抄本执行', '抄手拒绝说明正本为何没有同车送达', '传诏官既守使使命令又与受令官员有师生关系', '行款间距证明关键一句可能在抄写后被插入', '按错误命令先行调动的基层吏卒', ['急诏抄本', '正本未到', '行款间距']],
      ['titles', 'double_appointment_same_office', '同一官职出现两份有效任命', '官署开印前决定由谁主持当日事务', '尚书吏不肯说明第二份任命为何绕过常程', '属官既受先到者提拔又必须承认后到的正式节次', '驿递签收证明两份文书在途中次序曾被调换', '被两边同时要求表态的低阶属吏', ['双重任命', '官署开印', '驿递签收']],
      ['ritual', 'seating_chart_new_evidence', '典礼座次引发的名分争执突然出现旧仪注', '入殿前决定是否临时调整席位', '礼官不肯说明旧仪注为何长期未入档', '主持者既维护当下权力平衡又尊重先例', '旧仪注的批注显示当年座次属于权宜并非定制', '被公开移席而声望受损的来宾随员', ['典礼座次', '旧仪注', '入殿期限']],
      ['public_opinion', 'petitioners_pay_first_cost', '朝野争论先落到递书请愿者身上', '封事递入前决定是否公开联署名单', '起草者拒绝说明删去了哪些人的名字', '领衔者既要保护同道又受家族仕途牵制', '初稿残片显示争议主张原本比定稿温和', '被停职盘问的抄写与递送人员', ['联署封事', '请愿名单', '初稿残片']],
    ],
  },
  {
    domain: 'diplomacy_alliance',
    perspectives: ['envoy_foreigner', 'official', 'family_member', 'soldier', 'scholar_retainer'],
    motifs: [
      ['envoys', 'envoy_departure_unanswered_clause', '使者启程前仍有一项条款无人答复', '关门送行前决定留使者复议还是让其带着空白回去', '副使拒绝说明主使真正不能退让的底线', '接待官既代表本方立场又欠主使旧日人情', '会谈记录证明双方对同一动词理解不同', '随使团滞留异地的家眷与仆从', ['使者启程', '未答条款', '送行关门']],
      ['oaths', 'missing_oath_witness', '盟誓见证人在仪式前失踪', '祭台撤去前决定延期还是更换见证', '最后见过他的人不肯说明二人争执内容', '主持者既守盟友承诺又受本方要求尽快成约的压力', '见证人留下的草稿显示誓词与公开版本不同', '被派去寻找见证人的基层随员', ['盟誓见证', '祭台期限', '誓词草稿']],
      ['joint_campaign', 'allied_double_march_order', '协同行动出现两条互不相容的进军时刻', '约定会合前决定追随哪一份军令', '联络使者拒绝说明自己先把消息送给了谁', '带队者既受本军主将节制又已向盟军保证接应', '道路里程证明其中一份时刻在实际条件下无法完成', '被迫加速行军的运输民夫', ['盟军会合', '双重军令', '进军时刻']],
      ['gifts', 'gift_provenance_reversal', '外交礼物被指来自有争议的旧库', '回礼封装前决定是否退还、暂存或继续交换', '管库人不肯说明礼物入手前的转移过程', '经办人既维护本方体面又不愿让赠礼者蒙受公开羞辱', '器物底款证明它曾属于另一场未结清的交易', '被追责保管不善的库吏', ['外交礼物', '器物底款', '回礼封装']],
      ['hostages', 'hostage_household_first_cost', '担保关系恶化先影响留居异地的家庭', '换季迁居前决定是否调整护送与居所', '随侍者拒绝说明家书为何连续中断', '护卫既奉命确保人不离境又与留居者形成照料关系', '驿站退信证明家书并未送到原属地', '被限制探亲的年轻随行者', ['留居担保', '家书中断', '换季迁居']],
    ],
  },
  {
    domain: 'intelligence_covert',
    perspectives: ['official', 'wanderer_outsider', 'merchant_craftsman', 'soldier', 'family_member'],
    motifs: [
      ['scouts', 'report_before_dawn_dispatch', '斥候报告必须在黎明调兵前判断可信度', '晨鼓前决定是否据此改变巡逻方向', '共同返营者拒绝说明两人为何分路', '斥候既忠于本队又欠边民向导一份保护承诺', '马具磨痕证明报告中的路程不可能全部骑行完成', '将被撤去守卫的村落住户', ['斥候报告', '黎明调动', '马具磨痕']],
      ['leaks', 'clerk_silence_copy_route', '密令泄漏的抄送路径出现空白', '下一轮发文前决定是否停用整套文书班底', '值房小吏拒绝说出谁借走了废稿', '主簿既保护属吏又必须向上级证明清白', '废纸背面的算题显示泄漏者可能来自邻室而非抄手', '因集体停职失去薪粮的书吏家庭', ['密令泄漏', '废稿去向', '值房抄送']],
      ['inside_agents', 'inside_agent_dual_rescue', '内应要求先救出一名与任务无关的人', '接头窗口关闭前决定是否接受附加条件', '内应不肯说明被救者与自己的真实关系', '联络人既要完成刺探任务又答应不牵连无辜', '被救者的籍牌证明其可能掌握另一条独立线索', '负责在城内藏匿二人的店家', ['内应条件', '接头窗口', '救人要求']],
      ['interception', 'captured_letter_route_reversal', '截获文书的路线证据推翻原先怀疑', '收件人离城前决定继续监视还是转查递送链', '截获者拒绝说明自己为何提前等在路口', '查验者既受上级锁定目标的命令又重视新证据', '封套沾染的仓灰表明文书先经过另一处中转', '被误认同谋而遭跟踪的普通信使', ['截获文书', '中转仓灰', '收件人离城']],
      ['rumors', 'accused_courier_first_cost', '流言追查先伤及只负责递话的人', '消息扩散到军营前决定是否公开澄清', '最初听闻者不肯说出真正起话人的身份', '递话者既要保护消息来源又想保住自身名誉', '不同版本共有的错称证明源头并非被指认的商旅', '依赖递话者跑腿收入的家人', ['流言源头', '递话人', '公开澄清']],
    ],
  },
  {
    domain: 'frontier_ethnic',
    perspectives: ['envoy_foreigner', 'merchant_craftsman', 'family_member', 'soldier', 'official'],
    usageBoundary: '不得把任何族群写成单一性格、固定敌人或没有内部差异的整体。',
    motifs: [
      ['frontier_trade', 'sunset_market_safe_passage', '互市散场与安全通行时刻发生冲突', '日落封道前决定延长交易还是护送商队离开', '熟悉山口的向导不肯说明另一支队伍为何迟到', '译商既维护本地伙伴又受外来商队委托', '牲口蹄印证明迟到者绕行是为避开冲突而非毁约', '来不及售出货物的边地家庭', ['互市散场', '日落封道', '安全通行']],
      ['translation', 'interpreter_silence_kinship_term', '亲属称谓被译成政治隶属关系', '会谈中断前决定是否重译整份盟文', '译者拒绝说明自己为何避开一个关键称谓', '译者既忠于本族亲缘又受雇于主持会谈的官署', '另一名双语旅人的用法证明该词存在地区差异', '被错误归类而失去代表资格的年轻随员', ['亲属称谓', '盟文翻译', '会谈中断']],
      ['chief_authority', 'chief_kin_alliance_dual_duty', '首领亲属同时代表内部支系与对外盟约', '会盟落座前决定其发言能否约束其他支系', '随从不肯说明首领是否正式授权', '代表者既维护亲族继承权益又承诺对外停争', '礼物分配记录显示其支持者并非原先认定的同一群体', '被当作保证送来的旁支家属', ['首领代表', '支系授权', '会盟座次']],
      ['customs', 'mourning_sign_new_witness', '被视为拒礼的行为出现礼俗新证言', '送客仪式前决定是否撤回敌意指责', '最初翻译礼节的人拒绝承认自己的遗漏', '边军主事既维护军威又依赖长期互市关系', '新到老者说明该回避动作只在特定丧期出现', '因误会被暂停交易的手工业者', ['礼俗误读', '丧期回避', '新证言']],
      ['resettlement', 'resettled_child_first_cost', '迁居争议先让跨群体家庭的孩子失去归属', '冬营划定前决定孩子随哪一户登记', '两边长者都不肯谈早年的抚养约定', '照料者既服从本群体迁居安排又保护孩子现有生活', '旧项圈刻记证明孩子曾长期由另一家庭照料', '被迫离开熟悉照料者的孩子', ['迁居登记', '跨群体家庭', '冬营划定']],
    ],
  },
  {
    domain: 'scholars_ritual',
    perspectives: ['scholar_retainer', 'official', 'family_member', 'wanderer_outsider', 'merchant_craftsman'],
    motifs: [
      ['recommendation', 'recommendation_deadline_second_letter', '荐书截止前又来一封相反评价', '名册封存前决定是否重访被荐者', '第二位荐主拒绝公开撤回支持的原因', '审阅者既尊重师门意见又承担公平取士职责', '两封荐书共有一句罕见措辞，显示可能经过同一中间人', '已经卖产备行的被荐者家属', ['荐书截止', '相反评价', '名册封存']],
      ['letters', 'author_silence_public_copy', '公开流传的书信副本得不到作者确认', '清议聚会前决定引用、搁置还是查找原件', '作者对副本真伪始终保持沉默', '门生既维护老师名声又与传播者有同窗情谊', '纸边裁法证明公开本来自更早的残缺抄件', '被信中含混指责波及的无名小吏', ['书信副本', '作者沉默', '清议聚会']],
      ['teacher_student', 'student_dual_teaching_oath', '门生同时答应替两位老师整理互有冲突的讲义', '开讲前决定采用哪套次序', '门生不肯说出自己删改过哪一段', '整理者既报答启蒙师又受现任师长托付', '边注笔迹证明两套讲义曾共享早期底稿', '被卷入师门争论的同学与抄手', ['双重师承', '讲义整理', '开讲期限']],
      ['copying', 'colophon_reverses_authorship', '新见题记改变了抄本作者归属', '书市开卷前决定是否撤回原先署名', '售书人拒绝说明题记页从何处补入', '校书者既维护前辈声誉又要对读者负责', '纸纹和装订孔证明题记早于现有封面', '依赖原署名谋生的抄书工匠', ['抄本题记', '作者归属', '装订孔']],
      ['funeral', 'disciple_funeral_cost', '丧礼名分争论先由贫寒门生承担费用', '出殡前决定谁列入执绋与守灵名册', '主家不肯说明删去几名门生的缘由', '年长门生既维护师门体面又要照顾同门生计', '旧书信证明被排除者长期承担照料而非只来求名', '停工守灵而断炊的寒门学生', ['师门丧礼', '守灵名册', '出殡期限']],
    ],
  },
  {
    domain: 'family_daily_life',
    perspectives: ['family_member', 'merchant_craftsman', 'civilian_refugee', 'wanderer_outsider', 'official'],
    usageBoundary: '成人内容仍受现有年龄、同意和关系门禁，不得由 StoryPack 绕过。',
    motifs: [
      ['marriage', 'wedding_deadline_missing_consent', '婚礼日期逼近而一项本人意愿仍未确认', '迎亲队出发前决定暂停、改期或重新询问', '关键当事人只通过旁人传话而不肯亲自表态', '主持婚事的亲属既维护两家承诺又须尊重当事人选择', '旧家书证明先前答复附带了未被转告的条件', '被迫承担退礼与流言的年轻当事人', ['婚期逼近', '本人意愿', '迎亲出发']],
      ['family_letters', 'missing_reply_before_move', '全家迁居前仍等不到一封关键回信', '车队启程前决定是否为一名远亲留人留物', '代收信件的邻人不肯说明曾退回一封来信', '家中主事者既履行迁居计划又牵挂失联亲人', '驿路退件戳记显示回信曾到过附近', '被安排独自留下等候的家庭成员', ['家书未回', '全家迁居', '退件戳记']],
      ['master_servant', 'servant_dual_household_duty', '长期侍者同时被旧主人与新家庭召回', '病者换药前决定留在哪一处照料', '侍者不肯说明新家庭曾替自己赎过债', '侍者既念旧主养育之恩又承担现有家庭责任', '旧契边注证明原服务年限早已届满', '无人接手照料的病弱者', ['侍者召回', '双重家庭责任', '旧契边注']],
      ['neighbors', 'shared_drain_reversal', '邻里积水争端出现上游新证据', '下一场雨前决定先拆哪段排水沟', '修沟工不肯说明谁要求改变坡向', '里正既与一户有姻亲又须维护全巷通行', '染色水痕证明堵点来自更上游的公共路段', '已自费修缮却可能白花钱的住户', ['邻里排水', '上游证据', '雨前修沟']],
      ['caregiving', 'child_caregiver_first_cost', '照料安排争执先让年幼家人失去稳定陪伴', '医者复诊前决定谁暂停生计留家', '主要照料者不肯说明自己已经无力支撑', '亲属既要履行孝养又要养活自己的小家庭', '用药与进食记录表明病者更依赖固定照料节奏', '被频繁转交照看的孩子', ['家庭照料', '复诊期限', '照料者负担']],
    ],
  },
  {
    domain: 'aftermath_transition',
    perspectives: ['civilian_refugee', 'official', 'family_member', 'soldier', 'merchant_craftsman'],
    usageBoundary: '必须有战斗、战争、灾害、政权变化或事项终结等既成结构化结果；不得凭空宣告前置事件、伤亡、胜负或权力变化。',
    motifs: [
      ['wounded', 'treatment_priority_after_result', '既成伤情之后的治疗次序出现争执', '下一轮转运前决定谁先使用有限车位', '医吏不肯说明一名伤者为何被移出重伤簿', '护送军士既服从军中优先级又要照顾救过自己的同伴', '复诊记录显示原先列为轻伤者正在恶化', '留在原地照料伤者的家属与同伍', ['combat:completed']],
      ['missing', 'missing_roll_clerk_silence', '既成冲突后的失踪名册留下空白', '抚恤名册封存前决定是否先列入待核人员', '抄录吏拒绝说明一页名单为何被撕去', '核名者既要保护营中声誉又答应替家属查明下落', '遗物交接号证明一名失踪者曾在战后出现', '无法确认生死而不能安排生活的家庭', ['war:completed']],
      ['old_officials_disposal', 'old_official_dual_service_after_regime', '既成权力变化后旧吏同时受两份职责牵制', '新官署开印前决定是否继续留用其处理急务', '旧吏不肯说明仍替旧同僚保管哪些文书', '旧吏既维护原辖百姓又必须向新秩序证明可靠', '交接账显示其曾暗中阻止一项掠夺性征发', '依赖旧吏熟悉流程办事的普通住户', ['regime:changed']],
      ['arms_recovery', 'recovered_arms_owner_reversal', '既成战果后的军械回收出现原主新证据', '清点入库前决定争议器械暂归何处', '拾得者拒绝说明物件从哪片区域取得', '清点军士既维护缴获规则又认得器械上的旧部记号', '夹层刻字证明其中一件可能属于此前失散友军', '因缺少装备无法归队的幸存者', ['aftermath:arms_recovered']],
      ['reconstruction', 'displaced_household_cost_after_disaster', '既成灾害后的重建安排先挤压无地家庭', '雨季再来前决定临时住处与工料分配', '负责登记的人不肯说明几户为何从名单消失', '工匠头领既受官署工期约束又答应帮助旧邻复屋', '残墙地基证明部分所谓空地原有长期住户', '被安排反复迁棚的无地家庭', ['disaster:resolved']],
    ],
  },
] as const satisfies readonly DomainBatchBlueprint[];

function buildVariantContent(
  blueprint: MotifBlueprint,
  dramaFunction: Batch3DramaFunction,
): { title: string; summary: string; escalationShapes: string[] } {
  const [
    ,,
    subject,
    deadlineDecision,
    silenceGap,
    dualTension,
    reversalEvidence,
    personalCost,
  ] = blueprint;

  if (dramaFunction === 'deadline_order') {
    return {
      title: deadlineDecision,
      summary: `围绕“${subject}”，${deadlineDecision}。期限会迫使各方公开回应并暴露优先级，但不能替任何人物选择，也不能把催迫本身当成事实裁定。`,
      escalationShapes: [
        `${deadlineDecision}使回避空间缩小`,
        `公开回应暴露各方真正优先级`,
        `逾期后仍由本局行动决定后果`,
      ],
    };
  }
  if (dramaFunction === 'silence') {
    return {
      title: silenceGap,
      summary: `“${subject}”出现关键沉默：${silenceGap}。信息缺口会改变互信和调查方向；沉默可能来自恐惧、利益或保护他人，不能直接视作有罪。`,
      escalationShapes: [
        `${silenceGap}让现有说法无法闭合`,
        `旁人开始用各自关系解释沉默`,
        `核验缺口而不把沉默写成定罪`,
      ],
    };
  }
  if (dramaFunction === 'dual_loyalty') {
    return {
      title: dualTension,
      summary: `“${subject}”牵出两份不能轻易割舍的责任：${dualTension}。人物必须回应彼此冲突的承诺，却仍可协商、延后或寻找第三条路径。`,
      escalationShapes: [
        `${dualTension}同时提出要求`,
        `任何单边表态都会改变另一段关系`,
        `保留人物寻找兼顾方案的主动权`,
      ],
    };
  }
  if (dramaFunction === 'reversal') {
    return {
      title: reversalEvidence,
      summary: `围绕“${subject}”出现重新定义问题的证据：${reversalEvidence}。它足以推翻原先的简单解释，却不预设新解释必真，仍须与本局记录和行动交叉核验。`,
      escalationShapes: [
        `${reversalEvidence}动摇原先问题定义`,
        `旧对立被迫重新排列`,
        `新解释继续接受本局证据核验`,
      ],
    };
  }
  return {
    title: personalCost,
    summary: `若“${subject}”继续悬置，${personalCost}会先承受具体代价。人物损失把抽象矛盾落到关系和日常选择上，但不得据此宣告伤亡、资源变化或必然结局。`,
    escalationShapes: [
      `${personalCost}先承担拖延成本`,
      `受影响者要求从旁观位置进入对话`,
      `代价推动回应但不锁死结果`,
    ],
  };
}

function buildBatch3Threads(): WorldlineStoryThread[] {
  const threads: WorldlineStoryThread[] = [];
  let motifIndex = 0;
  const domainBlueprints: readonly DomainBatchBlueprint[] = BATCH_3_DOMAINS;

  for (const domain of domainBlueprints) {
    for (const blueprint of domain.motifs) {
      const [subdomain, motifId,,,,,,, entrySignals] = blueprint;
      const usageBoundary = [COMMON_USAGE_BOUNDARY, domain.usageBoundary ?? ''].join('');

      THREE_KINGDOMS_STORY_PACK_BATCH_3_DRAMA_FUNCTIONS
        .forEach((dramaFunction, functionIndex) => {
          const eraBand = THREE_KINGDOMS_STORY_ERA_BANDS[
            (motifIndex + functionIndex) % THREE_KINGDOMS_STORY_ERA_BANDS.length
          ];
          const region = THREE_KINGDOMS_STORY_REGIONS[
            ((motifIndex * 3) + functionIndex) % THREE_KINGDOMS_STORY_REGIONS.length
          ];
          const content = buildVariantContent(blueprint, dramaFunction);

          threads.push(createThreeKingdomsStoryThread({
            kind: domain.domain === 'aftermath_transition' ? 'aftermath' : 'dramaMotif',
            domain: domain.domain,
            subdomain,
            motifId,
            facet: dramaFunction,
            title: content.title,
            summary: content.summary,
            entrySignals: [...entrySignals],
            escalationShapes: content.escalationShapes,
            rolePerspectives: [domain.perspectives[functionIndex]],
            relatedTags: [
              ...entrySignals,
              `domain:${domain.domain}`,
              `era:${eraBand.id}`,
              `region:${region}`,
              `drama:${dramaFunction}`,
            ],
            timeRange: functionIndex === 0
              ? { start: '公元184年', end: '公元280年' }
              : {
                start: `公元${eraBand.startYear}年`,
                end: `公元${eraBand.endYear}年`,
              },
            reusePolicy: domain.domain === 'aftermath_transition'
              ? 'save_single_use'
              : 'motif_reusable',
            cooldownTurns: domain.domain === 'aftermath_transition'
              ? 24
              : 10 + (functionIndex * 2),
            promptSafeVersion: '1.0.0',
            usageBoundary,
          }));
        });

      motifIndex += 1;
    }
  }

  return threads;
}

export const THREE_KINGDOMS_STORY_PACK_BATCH_3_BLUEPRINTS = BATCH_3_DOMAINS;
export const THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS = buildBatch3Threads();
