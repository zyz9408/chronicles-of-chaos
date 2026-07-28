import type {
  WorldlineStoryThread,
  WorldlineStoryThreadKind,
} from '../../engine/types';
import { createThreeKingdomsStoryThread } from './storyPackBuilder';
import {
  THREE_KINGDOMS_STORY_ERA_BANDS,
  THREE_KINGDOMS_STORY_REGIONS,
} from './storyPackCatalog';

type MotifBlueprint = readonly [
  subdomain: string,
  motifId: string,
  visibleTitle: string,
  hiddenTitle: string,
  visibleClue: string,
  hiddenStake: string,
  entrySignals: readonly string[],
];

interface DomainBatchBlueprint {
  domain: string;
  primaryFacet: string;
  secondaryFacet: string;
  perspectives: readonly string[];
  motifs: readonly MotifBlueprint[];
  usageBoundary?: string;
}

const COMMON_USAGE_BOUNDARY = [
  '只能作为候选压力与可调查线索。',
  '不得宣告线索属实、替玩家决定或覆盖本局人物、地点、资源、事项与纪事。',
].join('');

const BATCH_1_DOMAINS = [
  {
    domain: 'military_camp',
    primaryFacet: 'public_front',
    secondaryFacet: 'private_backdoor',
    perspectives: ['soldier', 'official'],
    motifs: [
      ['recruitment', 'muster_roll_gap', '募册人数对不上', '保甲与军吏互相推责', '点名时出现空名、重名与临时顶替', '补足名额会把乡里负担和军中缺员同时推到台前', ['征募', '点名', '兵源']],
      ['unit_integration', 'old_new_unit_friction', '新旧营伍号令不一', '旧部暗守自己的次序', '合操时两套旗号和口令彼此冲突', '粮饷、资历与归属感使表面合营难以落实', ['合营', '整编', '营伍']],
      ['training', 'training_injury_dispute', '操练伤情引出质疑', '教头与将校各护声名', '一次操练留下伤员和不同说法', '提高战力与保存兵员之间没有现成答案', ['操练', '训练', '伤兵']],
      ['guard_duty', 'night_watch_omission', '夜哨出现空档', '换岗名单被人动过', '巡营记录与实际哨位无法对应', '疲惫、徇私或试探军纪都可能解释同一处缺口', ['夜哨', '值守', '巡营']],
      ['military_law', 'unequal_military_law', '同罪不同罚', '军法背后站着不同靠山', '相近过失收到轻重不一的处置', '维持秩序与避免营伍分裂形成直接冲突', ['军法', '军纪', '处置']],
      ['rewards_punishments', 'merit_roll_contest', '功劳簿出现争名', '首功证词彼此咬合', '报功名单与在场人的记忆不一致', '赏罚结果会改变将士对下次冒险的判断', ['报功', '赏罚', '军功']],
      ['desertion', 'deserter_family_pressure', '逃卒留下两种解释', '家属与同伍都怕被牵连', '失踪时辰、随身物和巡哨口供相互矛盾', '追究逃亡可能触及欠饷、伤病或乡里急难', ['逃卒', '逃亡', '失踪士卒']],
      ['injury_illness', 'sick_roll_concealment', '病号册突然变厚', '有人装病也有人硬撑', '医者记录与队正点名呈现不同人数', '出勤压力使真实伤病和逃避差役混在一起', ['伤病', '病号', '军医']],
      ['camp_families', 'camp_family_ration', '随营家属争取口粮', '家眷名册藏着未登记人口', '配给处聚集了携老扶幼的人群', '军粮权威数值与照料责任之间需要明确边界', ['随营家属', '口粮', '营眷']],
      ['officer_relations', 'officer_order_overlap', '两名将校同时下令', '亲信只认自己的上官', '同一队伍收到互相抵触的调动安排', '命令来源、军中资历和私人关系形成三重拉扯', ['将校', '军令冲突', '上下级']],
    ],
  },
  {
    domain: 'war_pressure',
    primaryFacet: 'deadline_order',
    secondaryFacet: 'aftermath_cost',
    perspectives: ['soldier', 'official', 'civilian_refugee'],
    usageBoundary: '胜负、伤亡、战果和地盘变化只能来自 Combat / War Engine 或既有结构化结果。',
    motifs: [
      ['reconnaissance', 'scout_route_disagreement', '斥候对前路说法不一', '最危险的路反而无人愿走', '两路侦察带回不同地形与敌情', '时间压力会迫使指挥者在信息不全时取舍', ['侦察', '斥候', '探路']],
      ['ambush', 'ambush_signs_uncertain', '伏击迹象真假难辨', '诱饵与真埋伏可能同时存在', '道路旁出现新折枝、弃物和不自然的寂静', '停下核查会失去时间，贸然前进则暴露队形', ['伏击', '埋伏', '道路异常']],
      ['pursuit', 'pursuit_limit', '追击距离引发争执', '溃兵可能在等援军', '前锋不断请求继续追赶而后队逐渐脱节', '扩大战果与保存阵形无法同时做到极致', ['追击', '溃兵', '收兵']],
      ['siege', 'siege_supply_clock', '围城进度受补给牵制', '城内外都在计算谁先撑不住', '攻具、粮秣与轮值出现不同步', '围困时间越长，军心、民生和外援变量越多', ['围城', '攻城', '城下']],
      ['city_defense', 'defense_sector_gap', '城防薄弱处被指出', '各营都不愿接最险的段落', '巡城记录显示某段人手和器械不足', '补强一处会抽空另一处，责任归属也会改变', ['守城', '城防', '巡城']],
      ['naval_warfare', 'fleet_weather_window', '船队等待短暂水势', '熟悉水路者掌握不同判断', '风向、水位和船况给出的窗口并不一致', '强行出动、继续等候与改走陆路各有代价', ['水战', '船队', '水势']],
      ['cavalry_warfare', 'mount_condition_split', '战马状态拖慢骑队', '好马被集中到少数亲队', '马蹄、鞍具和饲料检查暴露出明显差异', '速度优势与公平分配之间出现现实冲突', ['骑战', '战马', '骑队']],
      ['mountain_warfare', 'mountain_guide_trust', '山路向导受到怀疑', '熟路人不肯说出全部路径', '地形标记与向导说法在岔路处分开', '怀疑向导会失去本地知识，盲信也可能陷入险地', ['山地战', '向导', '山路']],
      ['night_battle', 'night_signal_confusion', '夜间号火次序错乱', '有人借黑暗传递另一套信号', '约定的灯火、鼓声与队伍位置无法对应', '误判友军和延误战机都可能扩大混乱', ['夜战', '号火', '夜间军令']],
      ['withdrawal', 'withdrawal_order_priority', '撤军次序尚未统一', '谁负责断后触及各部利益', '辎重、伤员与前军提出不同的先行理由', '撤退不是自动失败，但必须由本地引擎裁定秩序与损失', ['撤军', '断后', '转移']],
    ],
  },
  {
    domain: 'logistics',
    primaryFacet: 'ledger_resources',
    secondaryFacet: 'night_season',
    perspectives: ['official', 'soldier', 'merchant_craftsman'],
    motifs: [
      ['grain_levy', 'levy_receipt_gap', '征粮收据与实收不符', '层层经手留下灰色余地', '乡里收据、官仓登记和运到数量出现三套记录', '任何缺口都可能来自折耗、拖欠或中途截留', ['征粮', '粮草', '收据']],
      ['warehousing', 'warehouse_seal_mismatch', '仓门封记出现异样', '保管人与点验人各有顾忌', '封泥、钥匙交接和库存册无法完全对应', '仓储责任与真实库存必须依赖本地账本核实', ['仓储', '仓门', '点仓']],
      ['transport', 'transport_team_delay', '运队迟迟不到', '脚夫与押运者互相指责', '沿途驿点记录显示队伍在不同地点停留', '天气、道路、征调和私下交易都有可能造成延误', ['运输', '运粮队', '押运']],
      ['horse_fodder', 'fodder_quality_dispute', '马料掺杂引发争执', '供料商与养马人都想撇清责任', '槽中草料、验收样品和采购单据品质不同', '战马状态只能按既有数值处理，正文估算不能替代账本', ['马料', '草料', '养马']],
      ['boats', 'boat_capacity_claim', '船只载量被反复改口', '船户怕征用也怕得罪官军', '同一批船在名册、码头和船主口中有不同载量', '水路效率与船民生计形成直接张力', ['舟船', '码头', '征船']],
      ['roads', 'road_repair_priority', '两条道路争抢修缮人手', '近路背后牵着不同地方利益', '雨后损坏和车辙显示各路实际承载不同', '选择修哪条路会改变运输时间而非凭空增加资源', ['道路', '修路', '车辙']],
      ['courier', 'relay_horse_shortage', '驿站换马出现空缺', '急件优先权受到质疑', '驿簿显示多批使者挤在同一时段', '速度、马匹消耗和文书等级需要一起核对', ['驿传', '驿马', '急件']],
      ['arms', 'weapon_acceptance_problem', '军械验收被迫暂停', '匠人与军吏争论合格标准', '抽检器械与交付样品耐用程度差异明显', '赶工交付和战场可靠性不能靠叙事口号解决', ['军械', '兵器', '验收']],
      ['ledgers', 'ledger_copy_difference', '两份账册数字相冲', '抄手改字的原因无人承认', '原簿、抄本和交接单在关键栏位不同', '应先确认权威账本，再判断错误、舞弊或补记', ['账册', '核账', '抄本']],
      ['attrition', 'routine_attrition_blind_spot', '日常折耗长期无人细算', '小损耗累积成各方争夺的缺口', '破袋、病畜、损车和短途转运散落在不同记录中', '本地资源账本仍是唯一权威，素材只提示核查方向', ['损耗', '折耗', '辎重']],
    ],
  },
  {
    domain: 'administration',
    primaryFacet: 'evidence',
    secondaryFacet: 'interest_conflict',
    perspectives: ['official', 'civilian_refugee', 'scholar_retainer'],
    motifs: [
      ['seals', 'seal_authority_overlap', '两枚印信指向不同命令', '掌印人与发令者权责错位', '文书用印、日期和签押无法形成单一链条', '执行哪道命令会决定谁承担后果', ['印信', '用印', '官府命令']],
      ['documents', 'document_arrival_order', '迟到文书改变处置顺序', '有人希望把旧令当作未见', '收发簿显示文书到达时间与口头说法不合', '程序、时效和现实局面需要重新对照', ['文书', '公文', '收发簿']],
      ['old_officials', 'old_clerk_key_knowledge', '旧吏掌握无人替代的细节', '新班底担心旧关系反噬', '仓库、户籍和地方惯例都依赖少数旧人解释', '留用与清退各自伴随治理风险', ['旧吏', '留用', '官府交接']],
      ['new_officials', 'new_official_first_order', '新官首令遭遇软抵制', '表面服从掩盖执行拖延', '下属回报整齐却缺少可核查进展', '过度强压和过早妥协都会塑造后续威信', ['新官', '政令', '执行拖延']],
      ['tax_labor', 'tax_labor_overlap', '赋税与徭役同时压到一户', '不同部门各自只认本册', '户册、役簿和地方证明显示重复征派', '减免一项可能把负担转移给其他家庭', ['赋役', '徭役', '重复征派']],
      ['household_registry', 'registry_presence_gap', '户籍与实际人口落差扩大', '豪族、流民与官府各有隐瞒动机', '走访人数、里正册页和粮食领用无法互证', '未知人口不能直接视作逃户或隐户', ['户籍', '编户', '人口核查']],
      ['performance_review', 'review_metric_distortion', '考课数字过于整齐', '下级把难题移到统计之外', '治安、税收和工程回报都恰好达到门槛', '漂亮数字与真实治理效果需要分开判断', ['考课', '政绩', '官员考核']],
      ['amnesty', 'amnesty_scope_dispute', '赦令适用范围引发争论', '不同身份争取被纳入同一条款', '案卷时间、罪名和地方执行口径并不一致', '宽免与秩序之间需要依现有法律事实裁量', ['赦令', '赦免', '案卷']],
      ['requisition', 'requisition_receipt_resistance', '征发凭据遭到抵制', '百姓担心借用变成无偿占有', '征用清单没有明确归还时间和责任人', '军政急需不能自动抹去地方损失', ['征发', '征用', '凭据']],
      ['command_chain', 'command_chain_bypass', '越级命令打乱日常执行', '中层官吏担心权力被架空', '同一事项收到直属上官与更高层的不同催办', '速度与组织秩序之间出现可见代价', ['越级命令', '上下级', '催办']],
    ],
  },
  {
    domain: 'justice_security',
    primaryFacet: 'evidence',
    secondaryFacet: 'silence',
    perspectives: ['official', 'civilian_refugee', 'wanderer_outsider'],
    motifs: [
      ['banditry', 'bandit_label_doubt', '被称作盗匪的人身份成疑', '村民不敢说明谁在供养武装', '赃物、口音和活动范围与最初指认不合', '盗匪、溃兵和地方私兵可能被混为一谈', ['盗匪', '山贼', '治安']],
      ['clan_fighting', 'clan_fight_witness_split', '械斗双方各有伤者和证词', '族老只愿私下谈条件', '现场痕迹与两族的先动手说法相反', '公开追责和地方调停可能导向不同后果', ['械斗', '宗族冲突', '伤者']],
      ['military_civilian_conflict', 'soldier_civilian_claim', '军民冲突各执一词', '围观者怕得罪驻军', '损坏物品、值守记录和口供无法闭合', '军纪与民事赔偿必须分别核对', ['军民冲突', '驻军', '赔偿']],
      ['accusation', 'anonymous_accusation_motive', '匿名告发指向重要人物', '告发内容夹着私人恩怨', '信中细节部分准确、部分无法证实', '贸然采信或压下不查都可能被人利用', ['告发', '匿名信', '检举']],
      ['testimony', 'testimony_language_gap', '关键证词出现用词差异', '转述者可能改变原意', '不同记录人写下的时间、称谓和动作不一致', '证词可靠性要结合身份、距离和利害判断', ['证词', '口供', '证人']],
      ['interrogation', 'interrogation_time_pressure', '审讯期限逼近', '嫌疑人以沉默换取时间', '现有证据不足以解释全部细节', '压力不能替代证据，刑讯也不能自动产生事实', ['审讯', '嫌疑人', '案情']],
      ['prison_break', 'prison_security_gap', '牢房出现可疑缺口', '狱卒之间互相遮掩失职', '锁具、点名和送饭时辰暴露不同漏洞', '失职、内应或临时混乱需要逐项排查', ['越狱', '牢房', '狱卒']],
      ['local_mediation', 'mediation_face_saving', '调解卡在谁先低头', '赔偿数额背后是乡里脸面', '双方私下条件接近却不愿公开承认', '解决争端不等于抹去事实或强迫和解', ['调解', '和解', '乡里纠纷']],
      ['law_conflict', 'military_civil_law_overlap', '军法与地方律令撞在一起', '两套管辖都不愿放弃权威', '涉案者同时具有军籍和地方身份', '应先确认管辖与结构化身份，不能凭情节方便裁断', ['军法民法', '管辖', '军籍']],
    ],
  },
  {
    domain: 'agriculture_disaster',
    primaryFacet: 'night_season',
    secondaryFacet: 'interest_conflict',
    perspectives: ['civilian_refugee', 'official', 'soldier'],
    motifs: [
      ['military_farming', 'garrison_farming_schedule', '屯田与操练争抢时日', '收成责任压在同一批人身上', '农时、轮训和守备安排互相重叠', '减少任何一项都会影响不同的长期安全', ['屯田', '农时', '军屯']],
      ['draft_animals', 'draft_animal_allocation', '耕牛被军民同时需要', '借牛名册藏着优先顺序', '春耕与运输都要求同一批牲畜', '牲畜状态和归属必须按现有资产核对', ['耕牛', '役畜', '借牛']],
      ['farming_season', 'farming_season_labor', '征役撞上关键农时', '地方官与军需各自强调急迫', '田间缺人和征发名册同时出现', '短期劳役可能换来长期歉收风险', ['农时', '春耕', '秋收']],
      ['irrigation', 'canal_repair_order', '水渠先修哪一段', '上游与下游互不信任', '破损位置和受益田亩分属不同村落', '工程次序会改变受益者而非凭空增加水量', ['水渠', '灌溉', '修渠']],
      ['dikes', 'dike_watch_failure', '堤防巡守出现缺班', '汛期责任被层层下推', '巡堤簿、脚印和险段状况无法对应', '是否加派人手应结合天气与工程事实', ['堤防', '巡堤', '汛期']],
      ['drought_flood', 'relief_priority_after_weather', '旱涝消息争夺赈济优先', '不同乡里夸大或压低损失', '水位、田况和报灾文书给出不同严重度', '灾情数值必须来自结构化状态或可靠调查', ['旱灾', '水灾', '报灾']],
      ['locusts', 'locust_report_response', '蝗情传闻逼近粮区', '抢先防治可能惊动市场', '虫卵、迁飞方向和乡民口述尚未一致', '不能凭传闻宣告灾害规模或产量损失', ['蝗灾', '蝗情', '田野']],
      ['epidemic', 'epidemic_market_tension', '疫病迹象影响市集与营地', '隐瞒病情与过度封锁同样危险', '医者、坊正和军营报告出现时间差', '病亡、感染和隔离必须服从现有健康状态', ['疫病', '隔离', '医者']],
      ['wasteland', 'wasteland_claims_overlap', '荒地开垦权出现重叠', '旧契与实际耕作者各有依据', '界石、契书和多年耕作痕迹不能互相印证', '安置流民与保护既有权利需要同时考虑', ['荒地', '开垦', '田契']],
      ['water_conflict', 'civil_military_water_turn', '军民争夺用水时段', '夜间改闸让矛盾升级', '灌田、饮马与营地取水集中在同一水源', '任何分配都不能虚构水量或直接改变领地资源', ['军民争水', '水源', '改闸']],
    ],
  },
  {
    domain: 'trade_market',
    primaryFacet: 'ledger_resources',
    secondaryFacet: 'familiar_network',
    perspectives: ['merchant_craftsman', 'official', 'wanderer_outsider'],
    motifs: [
      ['market', 'market_stall_reallocation', '市集摊位重新划分', '旧摊主依靠熟人守住位置', '扩大的客流让通道、税位和摊位互相挤占', '秩序调整会改变小商户生计与官府收入', ['市集', '摊位', '市场']],
      ['grain_price', 'grain_price_spread', '同城粮价差距异常', '熟客得到另一套报价', '不同街市在短时间报出明显差价', '价格波动不能自动改写本地粮仓和财富账本', ['粮价', '买粮', '米市']],
      ['salt_iron', 'licensed_goods_substitution', '官营货物夹入次品', '经手商人掌握替换环节', '封记、重量和交货品质无法一致', '查验会触及采购关系与地方供给', ['盐铁', '官营', '验货']],
      ['textiles', 'cloth_measure_dispute', '布帛尺度各用一套', '老行商依靠行规压价', '官尺、店尺和实际裁量出现差异', '布帛作为货币或物资时必须先统一计量', ['布帛', '尺码', '布价']],
      ['coinage', 'coin_quality_mix', '市面钱币轻重混杂', '兑换者从差额中获利', '同一串钱里出现不同成色和重量', '货币换算应服从现有经济合同而非正文估值', ['钱币', '成色', '兑换']],
      ['credit', 'merchant_credit_chain', '一笔赊账牵连多家商户', '口头担保比契据更被信任', '账期、担保人与实物交付顺序相互错开', '追债可能触发连锁停供而非单一纠纷', ['赊账', '信用', '商户']],
      ['merchants', 'caravan_information_price', '商旅带来的消息被标价', '真假情报与货物买卖绑在一起', '不同商队对道路安全给出相反说法', '商旅消息只能作为传闻，不能直接生成远方事实', ['商旅', '商队', '道路消息']],
      ['checkpoints', 'checkpoint_fee_layers', '关津费用层层增加', '熟人凭据绕过部分查验', '同一路程出现多张名目不同的收据', '合法征收、临时摊派和私下索取需要区分', ['关津', '过关', '路引']],
      ['hoarding', 'hoarding_evidence_unclear', '囤积指控缺少完整证据', '仓主与行会互相放风', '仓门出入、价格变化和库存传闻尚不能闭合', '不能把高价自动解释为囤积或直接没收财物', ['囤积', '仓货', '物价']],
    ],
  },
  {
    domain: 'migration_population',
    primaryFacet: 'public_front',
    secondaryFacet: 'misidentification',
    perspectives: ['civilian_refugee', 'official', 'family_member'],
    motifs: [
      ['city_entry', 'refugee_gate_queue', '入城队伍堵在门外', '身份不明者混在家眷之间', '城门查验、粮食领取和落脚安排同时拥堵', '放行速度与城内承载不能只靠一句命令解决', ['入城', '流民', '城门']],
      ['registration', 'refugee_registration_name', '附籍姓名反复变化', '同一家人使用不同籍贯证明', '口述、旧牒和同行者称呼无法完全一致', '身份核查不能把记录缺失直接当作欺骗', ['附籍', '登记流民', '籍贯']],
      ['hidden_households', 'hidden_household_count', '隐户线索指向豪族庄园', '庄内人口不愿接受官府清点', '粮食消耗、房舍和户册呈现明显落差', '人口估算不能替代正式登记与本局事实', ['隐户', '庄园人口', '清点']],
      ['fugitive_households', 'fugitive_or_displaced', '逃户与避难者难以区分', '原籍官吏急于追回人口', '离乡时间、税欠与战乱路线互相交错', '不得把迁徙者一概写成逃役者', ['逃户', '避难', '原籍']],
      ['forced_migration', 'relocation_destination', '迁民去向无人愿先承诺', '接收地担心土地和粮食不足', '迁出名册完整，安置地点却只有模糊安排', '强制迁徙不能绕过地点容量和人物自主性', ['迁民', '安置', '迁徙']],
      ['orphans', 'orphan_identity_care', '孤儿身份与照料归属不明', '认领者可能出于善意或利益', '孩子说法、邻里辨认和遗物给出不同线索', '不得据此强造亲属、年龄或身世事实', ['孤儿', '认领', '照料']],
      ['separation', 'separated_family_search', '失散家属留下相近线索', '同名与错认不断消耗希望', '衣着、口音和最后见面地点只有部分吻合', '团聚必须通过本局人物身份核实', ['失散', '寻亲', '家属']],
      ['return_home', 'return_home_property', '归乡者发现旧居已有住户', '双方都能说出一段合理来历', '契据、邻证和实际居住年限彼此冲突', '安置与产权不能由素材直接裁决', ['归乡', '旧居', '返乡']],
      ['military_households', 'military_household_obligation', '军户义务落到留守家人', '名册没有反映家庭变化', '服役者去向、户内劳力和旧编制无法同步', '兵役身份必须读取现有结构化记录', ['军户', '留守家属', '兵役']],
      ['labor_allocation', 'resettlement_labor_quota', '安置人口被分派不同劳役', '有技能者被多方争抢', '登记职业、实际能力和接收地需求并不一致', '劳役安排不能锁死人物身份或凭空增加产出', ['劳役分配', '安置人口', '工匠']],
    ],
  },
  {
    domain: 'clan_local_society',
    primaryFacet: 'familiar_network',
    secondaryFacet: 'dual_loyalty',
    perspectives: ['official', 'scholar_retainer', 'civilian_refugee'],
    motifs: [
      ['clan_mediation', 'clan_mediator_bias', '族中调停人被质疑偏袒', '旧恩怨藏在中立身份之后', '调停条件总在关键处有利于一支', '换人会伤及面子，继续则可能失去信任', ['宗族调停', '族老', '偏袒']],
      ['retainer_dependency', 'retainer_double_obligation', '部曲同时收到家主与官府召令', '生计依附与公共义务相冲', '同一批人出现在私家名册和官府征发簿', '所属关系必须按现有势力与身份核对', ['部曲', '依附', '召令']],
      ['marriage_alliance', 'marriage_alliance_terms', '婚盟条件牵出地方交换', '当事人的意愿被长辈话语遮住', '聘礼、护送和土地承诺被捆在一起', '婚姻不能绕过人物自主性、年龄和关系门禁', ['婚盟', '联姻', '聘礼']],
      ['local_reputation', 'reputation_witness_network', '乡里名望出现两套评价', '受惠者与受损者各有熟人网络', '同一人物在不同村里得到相反称呼', '口碑只是线索，不能自动改写关系或事实层', ['乡里名望', '口碑', '地方评价']],
      ['land_dispute', 'boundary_stone_moved', '界石位置受到争议', '双方都能找到熟人作证', '旧水痕、耕作范围和契书方位互不一致', '土地归属必须结合领地与契据事实', ['土地纠纷', '界石', '田界']],
      ['private_forces', 'private_force_command', '私兵听谁调遣并不清楚', '家族忠诚与地方守备发生重叠', '武装人员使用不同旗号和供给来源', '不得凭素材创建、解散或转移真实部队', ['私兵', '庄兵', '武装']],
      ['donations', 'donation_recognition', '豪族捐输要求公开回报', '善举与政治筹码难以分开', '物资清单附带题名、官职或豁免请求', '捐输数值必须进入既有账本后才算事实', ['捐输', '赈粮', '豪族']],
      ['political_exchange', 'local_support_price', '地方支持附带隐性条件', '中间人只肯分段透露价码', '人手、粮秣和举荐被放在同一场谈判中', '交换不等于自动成交或改变阵营', ['政治交换', '地方支持', '条件']],
      ['old_new_elites', 'old_new_elite_seating', '新旧豪族为座次争执', '礼仪次序映照现实权力', '宴席、议事和文书署名出现不同排序', '名分冲突可推动对话，不能直接判定势力强弱', ['新旧豪族', '座次', '地方议事']],
      ['commoner_advancement', 'commoner_patron_choice', '寒门人才面对多方招揽', '引荐者要求长期回报', '才能证明与出身偏见同时影响选择', '不得替人物接受效忠或锁定人生道路', ['寒门', '荐举', '招揽人才']],
    ],
  },
  {
    domain: 'court_legitimacy',
    primaryFacet: 'public_front',
    secondaryFacet: 'dual_loyalty',
    perspectives: ['official', 'scholar_retainer', 'family_member'],
    usageBoundary: '只提供通用名分压力，不创建或强迫具体历史政变、禅代与继承结果。',
    motifs: [
      ['edict_authenticity', 'edict_chain_doubt', '诏命传递链出现疑点', '奉诏者的利益影响解释', '副本、用印和传令路线不能完全对应', '真伪判断必须服从本局朝廷与文书事实', ['诏命', '诏书真伪', '使者']],
      ['titles', 'title_authority_overlap', '官号相近却权限不同', '称谓之争背后是实际管辖', '文书、仪仗和下属称呼各用一套名号', '不得凭称号自动改变官职或统属', ['官号', '官职', '称谓']],
      ['ritual', 'ritual_precedence', '礼仪次序引发政治解读', '每一方都想借礼制确认地位', '座次、称呼和献礼先后成为争议焦点', '礼仪压力不等于真实政权变化', ['礼仪', '朝会', '座次']],
      ['succession', 'succession_expectation', '继嗣议论提前扰动人心', '亲近者分别押注不同人选', '试探性言论在内外形成不同版本', '不得由素材宣布继承人、死亡或废立', ['继承', '继嗣', '人选']],
      ['regency', 'regency_authority_limit', '代行权力的边界模糊', '临时授权被各方作不同解释', '命令署名、时限和实际执行范围不一致', '监国或摄政身份必须来自结构化状态', ['监国', '代行权力', '授权']],
      ['powerful_minister', 'minister_access_control', '权臣门下控制进言渠道', '忠于公事与依附个人难以分开', '奏报经由不同门路得到不同速度', '不得凭素材生成政变或改变朝廷归属', ['权臣', '进言', '门下']],
      ['imperial_clan', 'clan_privilege_case', '宗室特权与地方处置冲突', '经办者担心两边问责', '身份凭证和涉事事实同时摆在案前', '血统身份不能免除对现有事实的核查', ['宗室', '特权', '问责']],
      ['public_opinion', 'legitimacy_rumor_wave', '名分流言在士人与市井间扩散', '不同群体借同一句话表达不同诉求', '书信、宴谈和街巷传闻相互放大', '舆论不能直接写成天下纪事或合法性终局', ['名分', '舆论', '流言']],
    ],
  },
  {
    domain: 'diplomacy_alliance',
    primaryFacet: 'evidence',
    secondaryFacet: 'dual_loyalty',
    perspectives: ['envoy_foreigner', 'official', 'scholar_retainer'],
    motifs: [
      ['envoys', 'envoy_rank_protocol', '使者身份与礼遇不相称', '随员掌握另一层口信', '符节、国书和自报官阶出现落差', '礼遇高低会影响谈判但不能证明使者真假', ['使者', '国书', '接待']],
      ['gifts', 'gift_hidden_condition', '礼物清单藏着额外含义', '收下与退回都可能被解读', '贵重程度、送达时机和附信口吻不一致', '礼物不能自动形成承诺或资源到账', ['外交礼物', '赠礼', '回礼']],
      ['oaths', 'oath_wording_gap', '盟誓文本留下模糊之处', '各方都保留自己的解释', '口头承诺与书面条款在关键动词上不同', '盟约效力必须依现有关系与正式写回确认', ['盟誓', '盟约', '条款']],
      ['passage', 'passage_route_condition', '借道请求附带驻留问题', '沿途势力担心客军不走', '路线、期限和补给责任没有同时写清', '借道不能自动改变地点控制或部队位置', ['借道', '过境', '客军']],
      ['joint_campaign', 'joint_command_unclear', '共同出兵却无统一号令', '盟军各自保存主力', '会师时间、攻击目标和指挥权分属不同文书', '战斗与战争结果必须交给本地引擎', ['共同出兵', '联军', '会师']],
      ['cost_sharing', 'alliance_cost_account', '军费分摊账目受到质疑', '每方都把额外支出算给对方', '粮秣、船马和劳役采用不同计价', '任何数额必须由本地资源账本确认', ['军费分摊', '盟军粮草', '账目']],
      ['prisoner_exchange', 'exchange_identity_doubt', '交换名单中的身份存疑', '有人不愿承认俘虏价值相等', '姓名、职级和抓获地点无法全部互证', '俘虏状态和交换结果必须来自既有记录', ['俘虏交换', '换俘', '名单']],
      ['hostages', 'hostage_safety_terms', '人质安排缺少安全边界', '陪同者同时忠于家族与使命', '居所、通信和随员权限没有明确', '不得替人物接受人质身份或剥夺自主性', ['人质', '质子', '安全条件']],
      ['double_promises', 'double_promise_exposure', '同一方对两边作出相冲承诺', '中间人试图维持两套说法', '不同使者带回的期限和交换条件无法并存', '揭露矛盾不等于自动毁约或转变阵营', ['双重承诺', '外交矛盾', '使者口信']],
    ],
  },
  {
    domain: 'intelligence_covert',
    primaryFacet: 'rumor_intelligence',
    secondaryFacet: 'reversal',
    perspectives: ['official', 'soldier', 'merchant_craftsman', 'wanderer_outsider'],
    motifs: [
      ['scouts', 'scout_report_pattern', '斥候军报细节过于一致', '统一口径可能掩盖共同盲点', '不同路线的回报使用相同措辞和数字', '整齐不等于真实，仍需与地图和其他来源对照', ['斥候军报', '侦察情报', '路线']],
      ['inside_agents', 'inside_agent_signal', '内应信号提前出现', '发送者身份可能已变化', '约定标记符合旧规矩却不合当前时机', '不得据此宣告内应存在或据点已被控制', ['内应', '暗号', '城内消息']],
      ['forged_documents', 'forged_order_detail', '可疑文书只有一处破绽', '过于明显的破绽也可能是诱饵', '纸张、用语与印记大体吻合但次序异常', '真伪必须结合正式文书链与本局事实', ['假文书', '伪令', '印记']],
      ['interception', 'intercepted_message_gap', '截获书信缺少关键一页', '缺失内容让各方投射自己的猜测', '封口、页码和抄录痕迹显示中途被动过', '残缺情报不能直接生成远方行动', ['截获', '密信', '缺页']],
      ['leaks', 'information_leak_circle', '机密在小范围外出现', '知情者名单并不等于泄密者名单', '传言包含只有少数人掌握的细节', '调查不能靠身份偏见替代证据', ['泄密', '机密', '知情者']],
      ['counterintelligence', 'counterspy_false_target', '反间线索指向过于方便的对象', '真正受益者藏在指控之后', '证物出现得及时且缺少独立来源', '不得凭素材锁定奸细或清除 NPC', ['反间', '奸细', '可疑证物']],
      ['rumors', 'rumor_origin_split', '同一流言出现两个源头', '传播者各自删改不利部分', '市井与军营版本在人物、地点上不同', '流言只进入传闻层，不能直接变成事实或纪事', ['流言', '谣言', '消息来源']],
      ['merchant_news', 'merchant_news_tradeoff', '商旅消息夹带交易诉求', '夸大风险有利于抬高价格', '路线安全与货价变化被放在同一套说辞里', '必须区分商业谈判与可验证情报', ['商旅消息', '路况情报', '商队']],
      ['delayed_report', 'delayed_report_choice', '迟到军报让旧命令失去基础', '送信人担心解释延误', '文书时间、驿站记录和当前局势相互错位', '应先承认信息时差，不能把旧消息写成当前事实', ['迟到军报', '延误', '驿站']],
      ['conflicting_intelligence', 'intelligence_source_tradeoff', '两份情报要求相反行动', '每个来源都有可信与可疑之处', '一份来自亲历，一份来自更广但更慢的网络', '选择采信只是决策，不得改写来源本身', ['情报冲突', '相互矛盾的情报', '核实消息']],
    ],
  },
  {
    domain: 'frontier_ethnic',
    primaryFacet: 'public_front',
    secondaryFacet: 'misidentification',
    perspectives: ['envoy_foreigner', 'merchant_craftsman', 'official'],
    usageBoundary: '不得把任何族群写成单一性格、固定敌人或天然盟友；身份与习俗必须以本局人物事实为准。',
    motifs: [
      ['frontier_trade', 'frontier_market_measure', '互市计量引发争执', '翻译与行商各保留一套说法', '牲畜、布帛和金属采用不同计价习惯', '差异不能被写成欺诈的当然证据', ['互市', '边贸', '计量']],
      ['frontier_treaty', 'frontier_treaty_custom', '盟约条款遇到礼俗差异', '同一动作在双方眼中含义不同', '文本、口头承诺和仪式次序未能互相解释', '不得强迫任何群体接受单一礼制解释', ['边地盟约', '盟约礼俗', '边疆']],
      ['submission', 'submission_group_scope', '归附者范围说不清', '首领承诺未必覆盖所有部众', '到场人数、营帐和口头名单不断变化', '归附不得自动改变所有人物与势力阵营', ['归附', '部众', '边地首领']],
      ['chief_authority', 'chief_authority_contested', '首领发言遭内部质疑', '外来者误把一人当成全部声音', '随从、长者与年轻武士表现出不同立场', '不得将族群内部差异简化为服从或叛乱', ['首领', '部落议事', '内部意见']],
      ['resettlement', 'frontier_resettlement_resource', '迁居地点引起水草争议', '旧住民担心季节性资源被占', '边界、牧道与耕地使用方式不一致', '安置必须读取地图、人口与领地事实', ['边地迁居', '水草', '安置']],
      ['translation', 'translation_term_ambiguity', '翻译在关键称谓上犹豫', '不同译法会改变礼遇与责任', '原话可以对应多个政治或亲属称谓', '不确定翻译应保留歧义而非强行定论', ['翻译', '译者', '称谓']],
      ['customs', 'custom_guest_misread', '待客礼俗被误读为挑衅', '双方都担心退让失去颜面', '座次、饮食和兵器携带习惯发生碰撞', '冲突来自具体误解，不得归因于族群天性', ['礼俗', '待客', '误会']],
      ['frontier_army_division', 'frontier_army_strategy_split', '边军对处置方式分裂', '熟悉地方者与新来将校互不服气', '巡边、互市和用兵优先级各有支持者', '不得凭素材创建战争或固定敌我关系', ['边军', '巡边', '边疆策略']],
    ],
  },
  {
    domain: 'scholars_ritual',
    primaryFacet: 'rumor_intelligence',
    secondaryFacet: 'silence',
    perspectives: ['scholar_retainer', 'official', 'family_member'],
    motifs: [
      ['recommendation', 'recommendation_reputation', '荐书赞誉与亲历评价不同', '荐主的声望被绑在候选人身上', '文书写得周全，地方口碑却有保留', '不得凭一纸荐书自动添加官职或能力', ['荐举', '荐书', '人才']],
      ['teacher_student', 'teacher_student_split', '师门内部对去留意见不一', '学生的选择牵动师长名声', '公开教诲与私下劝告指向不同道路', '不得替人物决定仕隐、效忠或断绝关系', ['师生', '门生', '去留']],
      ['letters', 'letter_tone_change', '书信语气突然改变', '代笔、审查或关系变化都有可能', '称谓、落款和惯用语出现细微偏差', '文本差异只是线索，不能直接宣告遭胁迫', ['书信', '家书', '落款']],
      ['elite_opinion', 'elite_opinion_silence', '清议场合出现反常沉默', '无人愿先承担公开立场', '私下评价活跃，正式宴谈却避开同一话题', '沉默不能被自动解释为赞成或反对', ['清议', '士人议论', '沉默']],
      ['reputation', 'reputation_old_story', '旧闻重新影响当前名声', '传播者只保留对自己有利的版本', '多年前的评价被剪去时间与背景', '旧闻不得覆盖本局后续行为和事实层', ['名声', '旧闻', '口碑']],
      ['copying', 'copying_error_spread', '抄本错误被多处引用', '先指出的人担心得罪名家', '不同版本在一处关键字上分叉', '纠错不等于否定整份文书或学说', ['抄传', '抄本', '错字']],
      ['sacrifice', 'sacrifice_resource_order', '祭祀规格与现实物资冲突', '减省仪式会被解释为失礼', '礼官、仓吏和地方长者提出不同底线', '礼仪不得凭空消耗或生成资源', ['祭祀', '祭品', '礼官']],
      ['funeral', 'funeral_obligation_conflict', '丧礼期限与公务冲突', '亲族与官署都要求当事人表态', '路程、服制和职责安排无法同时满足', '不得强迫人物放弃亲属义务或官职责任', ['丧礼', '服丧', '亲族']],
      ['banquet', 'banquet_seating_message', '宴席座次被视为政治信号', '主人希望保留模糊空间', '来客对同一安排作出不同解读', '宴饮只能推动互动，不能自动改变阵营或官职', ['宴饮', '座次', '宾客']],
    ],
  },
  {
    domain: 'family_daily_life',
    primaryFacet: 'private_backdoor',
    secondaryFacet: 'familiar_network',
    perspectives: ['family_member', 'civilian_refugee', 'merchant_craftsman'],
    usageBoundary: '关系与成人内容继续受人物自主性、年龄、同意和既有关系门禁约束。',
    motifs: [
      ['marriage', 'marriage_household_terms', '婚事谈到两家日常安排', '当事人与长辈重视的条件不同', '居所、财物和照料责任被放在同一场商议中', '不得替人物同意婚姻或改变关系阶段', ['婚事', '婚姻', '议亲']],
      ['heirs', 'heir_expectation_pressure', '继嗣期待压到家庭成员身上', '亲族用关心包裹现实利益', '家产、香火和照料问题被反复提起', '不得宣告受孕、生育、继承或人物意愿', ['继嗣', '子嗣', '家族期待']],
      ['family_property', 'family_property_use', '家产使用权引发分歧', '旧日口头承诺没有写入契据', '同一处房田被不同家庭成员长期使用', '财产变动必须走既有资产与关系写回', ['家产', '分家', '田宅']],
      ['family_letters', 'family_letter_missing', '家书中断让亲人各自猜测', '熟人带来的口信不够完整', '往常固定的回信节奏突然停下', '中断不能直接解释为死亡、背叛或灾难', ['家书', '口信', '亲人消息']],
      ['family_separation', 'family_separation_choice', '离散家人对下一站意见不一', '安全、谋生与团聚指向不同方向', '每个人掌握的道路和亲友消息不同', '不得替家庭成员决定迁徙或分离', ['离散', '家人去向', '迁居']],
      ['reunion', 'reunion_changed_roles', '重逢后旧有相处方式失效', '双方都带着未说出口的新经历', '称呼、家务和经济责任出现陌生感', '团聚不等于关系自动恢复到过去', ['团聚', '重逢', '亲属']],
      ['master_servant', 'household_service_boundary', '主仆职责边界发生争议', '长期熟悉让命令与请求混在一起', '家务、护卫和私事不断跨过原有约定', '不得把依附关系写成无条件服从', ['主仆', '家仆', '职责']],
      ['caregiving', 'caregiving_rotation', '照料病者的人手难以轮换', '亲近程度与实际能力不一致', '夜间守候、药物和家务压在少数人身上', '病情与恢复必须服从现有健康状态', ['照料', '病者', '轮值']],
      ['women_business', 'household_business_credit', '妇女经营的账款遭到拖欠', '熟人关系让追讨更难开口', '货物已交付，付款日期却不断后移', '不得因性别或身份否定其经营与财产权', ['妇女经营', '账款', '生意']],
    ],
  },
  {
    domain: 'aftermath_transition',
    primaryFacet: 'aftermath_cost',
    secondaryFacet: 'reversal',
    perspectives: ['soldier', 'official', 'civilian_refugee', 'family_member'],
    usageBoundary: '必须先有结构化战斗、战争、灾害、政权变化或已结事项结果；不得凭空补造前置事件。',
    motifs: [
      ['wounded', 'wounded_care_priority', '伤员救治次序引发争执', '身份与伤势都影响优先请求', '医者、同伍与将校提出不同救治顺序', '伤情、死亡与恢复只能读取既有结构化结果', ['aftermath:wounded', 'combat:completed', '伤兵']],
      ['captives', 'captive_processing', '俘虏处置缺少统一口径', '口供价值与看守风险互相冲突', '不同俘虏身份、伤情和态度并不相同', '俘虏数量、身份与去留必须来自战果和正式写回', ['aftermath:captives', 'war:completed', '俘虏']],
      ['remains', 'remains_identification', '遗骸辨认困难', '亲属与同伍都需要确定答案', '随身物、衣甲和战场位置只能提供部分线索', '不得凭素材新增死亡或错误确认身份', ['aftermath:remains', 'combat:completed', '遗骸']],
      ['missing', 'missing_after_conflict', '战后失踪名单不断变化', '归队迟缓与真实失踪混在一起', '点名、俘虏口供和沿途目击无法闭合', '失踪不是死亡，人物状态必须依正式结果更新', ['aftermath:missing', 'war:completed', '战后失踪']],
      ['revenge', 'revenge_pressure', '复仇呼声压过善后议程', '受害者内部也有不同选择', '公开誓言、私下劝阻和现实能力并不一致', '不得替人物决定复仇、宽恕或锁定凶手', ['aftermath:revenge', 'matter:resolved', '复仇']],
      ['reconstruction', 'reconstruction_sequence', '重建先后次序出现分歧', '每一方都把自己的设施视作最急', '道路、民居、城防和水利争用同一批人力', '建设进度和资源消耗必须进入领地账本', ['aftermath:reconstruction', 'disaster:resolved', '重建']],
      ['relief', 'relief_distribution', '赈济名单与现场需求不合', '熟人网络影响领取顺序', '登记户数、排队人群和实际受灾范围不同', '不得凭素材增减粮草、财富或人口', ['aftermath:relief', 'disaster:resolved', '赈济']],
      ['arms_recovery', 'battlefield_salvage', '战场军械回收归属不明', '不同部队都声称拥有缴获物', '器械标记、拾获地点和战果记录无法完全对应', '物品、军械和战果必须走既有权威写回', ['aftermath:arms', 'combat:completed', '军械回收']],
      ['old_officials_disposal', 'old_official_transition', '旧官吏去留影响政务衔接', '忠诚疑虑与实际能力同时存在', '印信、档案和地方关系仍掌握在旧班底手中', '政权与官职变化必须来自既有结构化事实', ['aftermath:regime_change', 'regime:changed', '旧官']],
    ],
  },
] as const satisfies readonly DomainBatchBlueprint[];

function visibleSummary(blueprint: MotifBlueprint, index: number): string {
  const [,, visibleTitle,, visibleClue, hiddenStake] = blueprint;
  const templates = [
    `${visibleClue}，使“${visibleTitle}”成为眼前可核查的矛盾。更深一层还牵连：${hiddenStake}。`,
    `围绕“${visibleTitle}”，${visibleClue}。应先对照本局人物、地点和账目；后续压力来自：${hiddenStake}。`,
    `${visibleClue}，表面问题落在“${visibleTitle}”。若继续推进，还需处理：${hiddenStake}。`,
    `“${visibleTitle}”没有现成结论。${visibleClue}，而${hiddenStake}使简单处置可能带来新的代价。`,
    `${visibleClue}。当前可从“${visibleTitle}”入手调查，同时还需考虑：${hiddenStake}。`,
  ];
  return templates[index % templates.length];
}

function hiddenSummary(blueprint: MotifBlueprint, index: number): string {
  const [,,, hiddenTitle, visibleClue, hiddenStake] = blueprint;
  const templates = [
    `“${hiddenTitle}”尚未公开摊牌，背后还牵连：${hiddenStake}。${visibleClue}只能作为待核查线索。`,
    `“${hiddenTitle}”逐渐浮出水面，其背后的现实压力是：${hiddenStake}。${visibleClue}提供入口，却不足以单独证明任何结论。`,
    `有人试图回避“${hiddenTitle}”，因为${hiddenStake}。${visibleClue}若被重新核对，可能迫使关系人作出回应。`,
    `“${hiddenTitle}”把私人顾虑带进公共事务。${visibleClue}留下一处突破口，同时也暴露出：${hiddenStake}。`,
    `${visibleClue}未能解释全部异常，反而让“${hiddenTitle}”受到关注；${hiddenStake}使真相与利益难以同时澄清。`,
  ];
  return templates[index % templates.length];
}

function buildTimeRange(index: number, fullRange: boolean): { start: string; end: string } {
  if (fullRange) return { start: '公元184年', end: '公元280年' };
  const eraBand = THREE_KINGDOMS_STORY_ERA_BANDS[index % THREE_KINGDOMS_STORY_ERA_BANDS.length];
  return {
    start: `公元${eraBand.startYear}年`,
    end: `公元${eraBand.endYear}年`,
  };
}

function buildKind(domain: string, index: number, secondary: boolean): WorldlineStoryThreadKind {
  if (domain === 'aftermath_transition') return 'aftermath';
  if (secondary) return index % 3 === 0 ? 'structuralPressure' : 'dramaMotif';
  return index % 4 === 0 ? 'structuralPressure' : 'domainSituation';
}

function buildBatch1Threads(): WorldlineStoryThread[] {
  const threads: WorldlineStoryThread[] = [];
  let globalIndex = 0;
  const domainBlueprints: readonly DomainBatchBlueprint[] = BATCH_1_DOMAINS;

  for (const domain of domainBlueprints) {
    for (const blueprint of domain.motifs) {
      const [
        subdomain,
        motifId,
        visibleTitle,
        hiddenTitle,
        ,
        ,
        entrySignals,
      ] = blueprint;
      const eraBand = THREE_KINGDOMS_STORY_ERA_BANDS[
        globalIndex % THREE_KINGDOMS_STORY_ERA_BANDS.length
      ];
      const region = THREE_KINGDOMS_STORY_REGIONS[
        globalIndex % THREE_KINGDOMS_STORY_REGIONS.length
      ];
      const usageBoundary = [COMMON_USAGE_BOUNDARY, domain.usageBoundary ?? ''].join('');
      const common = {
        domain: domain.domain,
        subdomain,
        motifId,
        entrySignals: [...entrySignals],
        escalationShapes: [
          `${visibleTitle}引发公开追问`,
          `${hiddenTitle}迫使相关方说明立场`,
        ],
        rolePerspectives: [...domain.perspectives],
        relatedTags: [
          ...entrySignals,
          `domain:${domain.domain}`,
        ],
        promptSafeVersion: '1.0.0',
        usageBoundary,
      };

      threads.push(createThreeKingdomsStoryThread({
        ...common,
        kind: buildKind(domain.domain, globalIndex, false),
        facet: domain.primaryFacet,
        title: visibleTitle,
        summary: visibleSummary(blueprint, globalIndex),
        timeRange: buildTimeRange(globalIndex, true),
        reusePolicy: domain.domain === 'aftermath_transition'
          ? 'save_single_use'
          : 'context_reusable',
        cooldownTurns: domain.domain === 'aftermath_transition' ? 20 : 10,
      }));

      threads.push(createThreeKingdomsStoryThread({
        ...common,
        kind: buildKind(domain.domain, globalIndex, true),
        facet: domain.secondaryFacet,
        title: hiddenTitle,
        summary: hiddenSummary(blueprint, globalIndex),
        timeRange: buildTimeRange(globalIndex, false),
        relatedTags: [
          ...entrySignals,
          `domain:${domain.domain}`,
          `era:${eraBand.id}`,
          `region:${region}`,
        ],
        reusePolicy: domain.domain === 'aftermath_transition'
          ? 'save_single_use'
          : 'motif_reusable',
        cooldownTurns: domain.domain === 'aftermath_transition' ? 24 : 12,
      }));

      globalIndex += 1;
    }
  }

  return threads;
}

export const THREE_KINGDOMS_STORY_PACK_BATCH_1_BLUEPRINTS = BATCH_1_DOMAINS;
export const THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS = buildBatch1Threads();
