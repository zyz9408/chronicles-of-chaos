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
  publicTitle: string,
  evidenceTitle: string,
  costTitle: string,
  publicClue: string,
  evidenceClue: string,
  personalStake: string,
  entrySignals: readonly string[],
];

interface DomainBatchBlueprint {
  domain: string;
  facets: readonly [string, string, string];
  perspectives: readonly [string, string, string];
  motifs: readonly MotifBlueprint[];
  usageBoundary?: string;
}

const COMMON_USAGE_BOUNDARY = [
  '只能作为候选矛盾、可核验线索与人物压力。',
  '不得宣告事实成立、替任何人物决定，或覆盖本局状态、账本、事项、纪事与确定性裁定。',
].join('');

const BATCH_2_DOMAINS = [
  {
    domain: 'military_camp',
    facets: ['public_front', 'evidence', 'aftermath_cost'],
    perspectives: ['soldier', 'official', 'family_member'],
    motifs: [
      ['host_guest_troops', 'guest_troop_ration_precedence', '客军与本营争领给养', '两套领粮凭据', '同袍情分被配给撕开', '客军坚持此前承诺，本营则要求先照顾长期驻守者', '领粮木筹、到营日期和口头许诺呈现不同次序', '基层士卒可能被迫在旧同袍与现编营伍之间选边', ['客军', '本营', '领粮次序']],
      ['training', 'drill_ground_civilian_use', '操场征用挤压民用空地', '界桩与操练痕迹不一致', '训练安排落到附近住户身上', '扩大操练范围与附近百姓原有使用发生冲突', '旧界桩、车辙和近期号令指向不同边界', '负责传令的人会同时承受军令压力与乡里怨气', ['操场', '征用空地', '操练范围']],
      ['camp_families', 'camp_market_debt_chain', '营外赊欠集中到期', '欠券经手人层层变化', '家眷生计牵动军心', '随营小市的商贩开始催收长期赊账', '欠券笔迹、担保人和实际领货者并不完全对应', '欠债家眷与当值士卒可能互相隐瞒真实困境', ['营外市集', '赊欠', '随营家眷']],
      ['officer_relations', 'messenger_credit_dispute', '传令失误引发将校争执', '口令转述链留下缺口', '小吏承担上级分歧的代价', '两名将校都声称自己的命令被错误传达', '值房记录、传令时辰和接令人口供无法闭合', '传令者若如实说明，可能同时得罪两套指挥关系', ['传令', '将校争执', '口令']],
    ],
  },
  {
    domain: 'war_pressure',
    facets: ['deadline_order', 'evidence', 'aftermath_cost'],
    perspectives: ['official', 'soldier', 'civilian_refugee'],
    usageBoundary: '胜负、伤亡、战果和地盘变化只能来自 Combat / War Engine 或既有结构化结果。',
    motifs: [
      ['surrender', 'surrender_terms_uncertain', '请降条件尚未说清', '降书与口头承诺有出入', '接纳或拒绝都有人承担风险', '来使要求保全人员与旧有编制，但措辞留有余地', '降书副本、来使转述和守军旗号不能互相印证', '前线接洽者可能成为停战失败或纵敌的替罪者', ['请降', '降书', '受降条件']],
      ['prisoners', 'prisoner_guard_burden', '俘虏看守拖累前线人手', '俘名册与实际人数不合', '看守者和被俘者都面临失控压力', '押解、看守与继续行军争抢有限人手', '俘名册、伤情记录和分队交接数出现差异', '基层看守若处置失当，可能同时遭军法和报复威胁', ['战俘', '俘虏看守', '押解']],
      ['postwar_merit', 'casualty_merit_conflict', '报功与抚恤次序相撞', '功簿和伤亡簿指向不同叙事', '死伤者家属等待一个说法', '庆功安排早于伤亡核对，引发营中不满', '首功证词、阵亡登记和遗物交接不能完全对应', '报功者的声名可能建立在他人尚未被确认的损失上', ['战后争功', '抚恤', '伤亡核对']],
      ['city_defense', 'civilian_defense_duty', '守城差役分配失衡', '轮守名册藏着替役', '城内家庭被迫重新安排生计', '城防轮值集中落到少数坊里与行业', '门籍、轮守牌和实际到岗者显示多次顶替', '替役者、出钱者与留家照料者都可能认为自己承担更多', ['守城差役', '轮守', '城防民役']],
    ],
  },
  {
    domain: 'logistics',
    facets: ['ledger_resources', 'evidence', 'interest_conflict'],
    perspectives: ['official', 'merchant_craftsman', 'soldier'],
    motifs: [
      ['black_market', 'diverted_supply_trace', '军需物资流入私市', '批号与包装留下转手痕迹', '追查会触及补给链上的熟人', '私市出现本应受管制的同批物资', '封记残片、批号和商贩进货日期能拼出部分路径', '经手人可能在填补短缺、牟利和受人胁迫之间各有说法', ['军需黑市', '盗卖', '批号']],
      ['priority_conflict', 'medicine_grain_priority', '药材与粮运争抢车船', '调拨单先后次序矛盾', '伤员和饥军都在等待', '两项紧急运输同时要求优先通行', '调拨时辰、签押层级和沿途接收记录不一致', '执行者无论先送哪一批，都可能面对另一方的直接损失', ['运输优先级', '药材', '粮运']],
      ['seasonal_disruption', 'river_freeze_reroute', '水路骤断迫使改道', '沿途里程和存粮记录不匹配', '脚夫船户承担改道成本', '季节变化使原定水路无法按期使用', '驿站登记、船况和陆路雇工报价显示不同可行方案', '临时改道可能让原班人手失去生计或被迫承担额外危险', ['季节断运', '水路中断', '改道']],
      ['ledgers', 'duplicate_transport_receipt', '同批货物出现两张收据', '印记与纸张年代不合', '仓吏与押运者互相防备', '两个接收点都声称收过同一批物资', '收据印记、纸张磨损和运单编号存在可核查矛盾', '查清重复记录可能暴露临时周转，也可能牵连无辜经手人', ['重复收据', '运单', '仓册']],
    ],
  },
  {
    domain: 'administration',
    facets: ['public_front', 'evidence', 'silence'],
    perspectives: ['official', 'civilian_refugee', 'scholar_retainer'],
    motifs: [
      ['frontier_execution', 'distant_order_drift', '远地执行偏离原令', '层层转抄改变关键措辞', '基层官吏不敢说明现实困难', '边地收到的命令与中枢意图出现明显距离', '原件、转抄件和实际告示在期限与对象上不同', '执行者若指出命令不可行，可能被视作拖延或抗命', ['边地执行', '转抄命令', '远地官署']],
      ['government_trust', 'repeated_requisition_trust', '反复征发耗尽官府信用', '旧收据迟迟未能兑付', '守信者开始劝家人躲避差役', '同一地区短期内再次收到征调要求', '历次收据、归还记录和承诺期限留下连续缺口', '原本配合官府的住户可能因累积失信改变选择', ['官府信誉', '反复征发', '旧收据']],
      ['documents', 'document_copy_delay', '副本迟到改变处置节奏', '抄手记录暴露停滞时段', '等待公文的人错过自救窗口', '关键文书的正本与副本未同时送达', '抄写班次、用纸数量和递送记录可以定位延误环节', '被处置者可能在程序补齐前就承受名誉与生计损失', ['文书副本', '递送延误', '抄写']],
      ['household_registry', 'widow_orphan_registry_gap', '孤寡户籍归属引发争议', '旧籍与抚恤名册互相脱节', '无人出面的家庭最容易被遗漏', '迁徙和战乱后留下的孤寡人口没有统一归属', '旧里籍、亲属证明和近期配给名册记录不同', '代为申报者可能是在照料，也可能借机控制财产与身份', ['孤寡户籍', '抚恤名册', '附籍']],
    ],
  },
  {
    domain: 'justice_security',
    facets: ['public_front', 'evidence', 'silence'],
    perspectives: ['official', 'civilian_refugee', 'wanderer_outsider'],
    motifs: [
      ['redemption', 'redemption_labor_dispute', '赎罪劳役是否抵偿引发争论', '服役记录缺少关键签押', '想重新生活的人仍被旧案牵住', '当事人声称已完成约定劳役，受害一方不予认可', '工役名册、监领签押和同役证词存在缺口', '若证明不足，当事人可能永久停留在半赦半罪的状态', ['赎罪', '劳役抵偿', '旧案']],
      ['collective_punishment', 'collective_punishment_scope', '连坐范围不断扩大', '亲属与同居记录边界模糊', '无力自证的人最先受到波及', '追责者要求把更多关系人纳入处置', '户籍、同居时段和经济往来并不能指向同一种关联', '旁支亲属和雇工可能因沉默而被默认成共谋者', ['连坐', '亲属范围', '共同居住']],
      ['testimony', 'coerced_witness_signal', '证人突然改口', '伤痕与供词时辰可供复核', '证人害怕两边报复', '关键证人的前后说法出现明显变化', '问话时辰、看守交接和身体状况留下可核查痕迹', '说真话未必能让证人免于来自原告或官府的压力', ['证人改口', '证词', '问话']],
      ['accusation', 'retaliatory_case_chain', '告发像是旧怨延续', '告发前后的往来记录异常', '旁观者不愿卷入长期报复', '新案与此前田产或婚姻纠纷存在重叠人物', '契券、拜访记录和递状时间能显示冲突升级顺序', '知情者可能保持沉默，以免成为下一轮告发对象', ['报复告发', '递状', '旧怨']],
      ['prison_break', 'prison_break_inside_help', '越狱可能得到内部协助', '锁具损伤不像强行破坏', '值夜者面临自证与互保', '逃脱路线避开了通常最严密的岗哨', '锁舌、灯油消耗和换岗记录指向熟悉内部的人', '基层狱卒可能因恐惧、收买或照顾病人而留下便利', ['越狱', '内部协助', '锁具']],
      ['banditry', 'stolen_goods_return', '赃物归还次序引发冲突', '物主标记和领取凭据不全', '失而复得也可能制造新冤屈', '追回物品不足以满足所有报失者', '刻记、修补痕迹和原始清单只能确认部分归属', '先领回者可能被怀疑冒领，后到者则可能失去唯一生计', ['赃物归还', '失物认领', '盗匪']],
      ['clan_fighting', 'funeral_retaliation_risk', '丧礼可能成为械斗续场', '吊唁名单暴露双方动员', '守丧者被迫承担宗族对抗', '两族都准备在丧礼上展示人数与立场', '来客名帖、器械携带和沿途聚集可以提前核验风险', '死者近亲可能既想体面送葬，又无力拒绝族中报复要求', ['丧礼械斗', '宗族报复', '吊唁']],
      ['local_mediation', 'guarantor_failure', '调解担保人拒绝履约', '担保文书对责任写得含糊', '和解双方重新失去安全感', '一方违约后，原担保人声称只负责见证', '担保用语、见证签名和抵押物交接存在解释空间', '若担保失效，曾接受调解的人可能转向私力报复', ['调解担保', '和解违约', '见证']],
      ['law_conflict', 'jurisdiction_gap', '案件在军府与县廷之间搁置', '移送文书缺少接收回执', '受害者被程序空隙消耗', '军人、民户和驻地分属不同处置体系', '移送日期、身份记录和接收印记显示责任被来回推送', '等待裁断的人可能因拖延失去证据、住处或保护', ['军民管辖', '案件移送', '接收回执']],
      ['interrogation', 'confession_retraction', '认罪后又当庭翻供', '供状细节与现场条件冲突', '翻供者和录供者都承受质疑', '当事人称此前供词并非自愿或并不准确', '供状中的路径、时辰和物件可与现场逐项比对', '若翻供被忽视或全盘接受，都可能让真正责任继续隐藏', ['翻供', '供状', '审讯']],
    ],
  },
  {
    domain: 'agriculture_disaster',
    facets: ['public_front', 'ledger_resources', 'aftermath_cost'],
    perspectives: ['civilian_refugee', 'official', 'family_member'],
    motifs: [
      ['tenancy', 'rent_after_disaster', '灾后租额是否减免僵持不下', '田契与实际受灾范围不合', '佃户和地主都面临下一季断裂', '收成受损后双方对原租约是否继续有效意见相反', '田契亩数、受损地块和已交实物可以分别核验', '若无法重订条件，佃户可能离田，地主也可能失去耕作人手', ['灾后佃租', '田契', '减租']],
      ['harvest_dispute', 'wet_grain_measure', '湿粮折算引发收成争执', '量具与晾晒时辰影响结果', '交粮者担心劳动被低估', '仓方与农户对同批谷物应折多少各执一词', '量器、含水状态和过秤记录能解释部分差异', '争执若拖过农时，家庭口粮和官仓征收都会承压', ['湿粮', '收成折算', '过秤']],
      ['draft_animals', 'sick_ox_liability', '病牛责任落不到一处', '借用前后的伤病记录断开', '一头耕牛牵动多个家庭农时', '官府借用、邻里代养和原主各自否认照料失误', '蹄伤、饲料记录和归还日期能缩小责任时段', '无论归责给谁，错过耕期的损失都不会自动消失', ['病牛', '耕牛借用', '归还']],
      ['irrigation', 'upstream_night_diversion', '上游夜间改水引发冲突', '新掘沟痕可判断分水方向', '下游家庭担心秧田断水', '下游清晨发现水量骤减，上游否认私改渠口', '新土、闸板磨痕和夜间脚印提供有限证据', '负责看渠的人可能在乡情、收买与共同缺水之间沉默', ['夜间改水', '渠口', '灌溉争议']],
    ],
  },
  {
    domain: 'trade_market',
    facets: ['ledger_resources', 'evidence', 'interest_conflict'],
    perspectives: ['merchant_craftsman', 'official', 'civilian_refugee'],
    motifs: [
      ['lending', 'harvest_backed_loan', '以未来收成作保的借贷到期', '借券与实际交付数不一致', '债务可能吞掉一家下一季生计', '出借方要求按原约收取粮物，借方声称灾情改变条件', '借券、见证人和分次交付记录存在差异', '担保亲族可能在维持信用与保护借户之间被迫选边', ['借贷', '借券', '收成抵押']],
      ['smuggling', 'checkpoint_avoidance_network', '绕关货路被人揭发', '脚店账目勾连多段行程', '搬运者可能只是最容易被抓的人', '官道外出现稳定运货路线，引起关津怀疑', '脚店投宿、牲口草料和货包标记可以连接部分环节', '真正获利者可能远离现场，基层脚夫却承担全部风险', ['走私', '绕关', '脚店账目']],
      ['military_procurement', 'procurement_quality_tradeoff', '军需采购在价格与品质间摇摆', '样品和交货成色不同', '工匠声誉与前线需求正面冲突', '限期采购迫使经办者考虑较差但更快的供货', '验收样品、批量货物和工坊出料记录可以交叉检查', '拒收会延误军需，放行则可能让使用者承担隐患', ['军需采购', '验收样品', '交货品质']],
      ['long_distance_trade', 'remote_market_price_gap', '异地价差吸引商队冒险', '沿路费用吞噬账面利润', '商队内部对去留出现分裂', '远方行情看似有利，但消息已经经过多手', '关津费用、雇护开支和旧行情能重算真实风险', '出资者、领队与脚夫对可接受损失有不同底线', ['异地贸易', '远方行情', '商队']],
      ['credit', 'broken_guarantee_chain', '商号担保链出现断点', '印押与实际债主对不上', '守约者也可能被连带拖垮', '一家商号停兑后，多笔互保交易同时受到影响', '契纸印押、转让背书和到期次序能显示风险传播路径', '最末端的小商户可能为从未见过的债务承担代价', ['信用担保', '停兑', '互保']],
      ['coinage', 'exchange_discount_dispute', '不同钱样折价引起骚动', '称量结果与市面惯例不一', '领到军饷和卖货的人感受不同', '官府、商贩和百姓对旧钱折价没有统一尺度', '重量、成色和近期交易凭据可以解释部分价差', '统一尺度会让某一类持钱者立即承受损失', ['钱样折价', '换钱', '成色']],
      ['grain_price', 'transport_price_pass_through', '运费上涨推高粮价', '账簿分不清真实成本与借机加价', '低收入家庭最先减少口粮', '商人称道路受阻导致加价，市民怀疑趁势囤售', '沿途费用、损耗和同日不同铺价可以交叉核验', '强压价格与放任上涨都可能让供货者或买粮者退出市场', ['粮价', '运费', '市场加价']],
      ['market', 'stall_tax_reclassification', '摊税改名后负担上升', '旧票据和新名目重复出现', '小贩不敢停业也无力全交', '市吏把同一处收费拆成多个名目', '摊位票、入市票和清洁工役记录显示可能重复征收', '出面申诉者可能失去摊位，沉默者则继续承担累积成本', ['摊税', '市集收费', '票据']],
      ['salt_iron', 'counterfeit_license', '盐铁凭照真假难辨', '印泥配方与编号可查', '合法商户担心被假照拖累', '一批货物持有格式近似却细节异常的凭照', '编号次序、印泥颜色和签发地记录能够交叉核验', '追查假照可能揭出冒用，也可能暴露官吏私下放行', ['盐铁凭照', '假照', '专卖货物']],
      ['merchants', 'caravan_joint_loss', '合伙商队争分途中损失', '共同账本缺少分摊规则', '同行关系可能在回程前破裂', '货损后各出资人对谁应承担风险说法不同', '装载清单、护送安排和合伙契约没有覆盖全部意外', '若无法先稳定关系，剩余货物与人员可能无人愿意继续照管', ['商队合伙', '货损分摊', '共同账本']],
    ],
  },
  {
    domain: 'migration_population',
    facets: ['public_front', 'evidence', 'aftermath_cost'],
    perspectives: ['civilian_refugee', 'official', 'family_member'],
    motifs: [
      ['fort_population', 'fort_gate_ration', '坞堡入居资格与口粮绑定', '门籍和配给名册人数不同', '堡内亲族与新来者互相猜疑', '坞堡要求新来者先承担守备和劳役', '门籍、守夜牌和领粮名册显示不同居住范围', '没有担保的家庭可能在安全与自主之间失去选择', ['坞堡人口', '入堡', '配给名册']],
      ['quarantine', 'quarantine_kin_separation', '隔离把同一家人分在两处', '接触时辰记录存在空白', '照料病人与保护家人难以兼顾', '隔离边界和照料安排引发亲属争执', '出入牌、送饭记录和发病时序可以核验接触风险', '负责照料的人可能因一次隐瞒让整个家庭失去信任', ['疫区隔离', '亲属分离', '出入牌']],
      ['return_home', 'absent_owner_claim', '归乡者面对他人占用旧宅', '旧契与现居凭据并存', '两户人都把住处当作最后依靠', '原住户返乡后要求收回被安置给他人的房地', '旧契、安置文书和实际修缮投入能分别证明不同权利', '直接逐出任何一方都可能制造新的流离家庭', ['归乡', '旧宅', '安置文书']],
      ['hidden_households', 'child_registration_gap', '未登记孩童影响家庭附籍', '出生口述缺少书面佐证', '孩子身份决定一家能否留下', '迁徙家庭申报的孩童未出现在旧籍或配给记录中', '亲属证词、年龄痕迹和沿途名册只能提供部分证明', '若要求过严会排除真实家庭，过松则可能引发冒领争议', ['孩童附籍', '隐户', '家庭登记']],
    ],
  },
  {
    domain: 'clan_local_society',
    facets: ['private_backdoor', 'evidence', 'dual_loyalty'],
    perspectives: ['family_member', 'official', 'scholar_retainer'],
    motifs: [
      ['marriage_alliance', 'dowry_security_dispute', '嫁资保管成为两族角力', '财物清单与实际交接不合', '婚姻中的个人被当作担保', '两家对嫁资应由谁保管和何时归还意见相反', '陪送清单、见证签名和现存物件能够逐项核对', '当事人可能为了维持婚盟而无法公开表达自身损失', ['嫁资', '婚姻联盟', '财物交接']],
      ['commoner_advancement', 'patron_competition', '寒门才士被多家争取', '荐书措辞暗含不同条件', '受荐者难以同时报答所有人', '多个豪族都愿意提供门路，却要求不同回报', '荐书、宴请次序和随从接触可以显示各方投入', '接受一家帮助可能被另一家解释为背弃旧恩', ['寒门荐举', '门路', '豪族争取']],
      ['retainer_dependency', 'inherited_retainer_debt', '旧主债务落到部曲后代', '欠券没有明确继承条款', '依附关系延伸到下一代', '豪族要求后代继续偿还前代受养与借支', '欠券、服役年限和历次抵扣记录无法形成统一余额', '后代可能既依赖宗族保护，又想摆脱没有终点的义务', ['部曲债务', '依附', '欠券']],
      ['donations', 'public_granary_donation_credit', '捐粮名册引发名望竞争', '实交数量与题名次序不同', '小户捐输被大族声名遮蔽', '赈济名册把少数大族置于最显眼位置', '入仓凭据、题名顺序和公开宣称可以逐项比对', '负责登记者可能在真实贡献与地方权势之间保持沉默', ['捐粮', '题名', '赈济名册']],
    ],
  },
  {
    domain: 'court_legitimacy',
    facets: ['public_front', 'evidence', 'dual_loyalty'],
    perspectives: ['official', 'scholar_retainer', 'family_member'],
    usageBoundary: '只提供通用政治压力，不创建或强迫具体历史政变。',
    motifs: [
      ['enfeoffment', 'seal_before_land', '册命先到而封地未定', '印册与地方文书衔接不上', '受封者夹在名义与现实之间', '名号已经公开，但实际管辖和供给仍无人承认', '册文、印信和地方移交文书在范围上不一致', '受封者若强行主张可能激化地方抵触，退让又损害名分', ['册封', '封地移交', '印册']],
      ['omens', 'omen_interpretation_competition', '同一异象被解释成不同政治信号', '记录者删改了部分细节', '说出不同解释的人可能被贴上立场', '朝野人士争相赋予异常天象或物候不同意义', '最初记录、转述版本和公开奏报之间存在措辞变化', '观察者可能为了自保而附和权势更大的一种解释', ['祥瑞', '异象解释', '奏报']],
      ['court_legitimacy', 'local_ritual_alignment', '地方礼仪是否随新名分调整', '旧仪注与新告示并存', '基层执行者承担政治表态风险', '官署要求改变称谓和礼次，地方仍沿用旧例', '仪注、告示日期和实际典礼次序能够互相核验', '执行过快或过慢都可能被上级视为立场问题', ['朝野名分', '地方礼仪', '称谓']],
      ['titles', 'acting_office_dispute', '署理官与正式官职权限冲突', '两套签押都在流通', '属吏不知应服从哪一方', '临时署理者继续发令，而正式任命消息也已到达', '印信使用、任命日期和文书流向显示权力重叠', '选择执行其中一套命令可能让基层属吏卷入上层争权', ['署理官', '正式任命', '官号']],
    ],
  },
  {
    domain: 'diplomacy_alliance',
    facets: ['public_front', 'dual_loyalty', 'reversal'],
    perspectives: ['envoy_foreigner', 'official', 'family_member'],
    motifs: [
      ['marriage_pact', 'marriage_pact_household_terms', '婚盟公开条件尚未落定', '私下承诺涉及随行与居所', '联姻当事人承担联盟变化', '双方只确认了联姻方向，具体礼数与责任仍有分歧', '使者笔记、礼单和家族口信透露不同附加条件', '政治关系一旦变化，当事人的处境可能先于盟约受到冲击', ['婚盟', '联姻条件', '礼单']],
      ['border_dispute', 'border_marker_dual_map', '双方地图对边界画法不同', '旧界碑与新巡逻线不重合', '边地居民被两边同时征索', '使者各自出示有利于己方的边界说法', '旧界碑、税籍和巡逻记录能证明不同层次的实际控制', '当地家庭可能为了通行和耕作同时向两边妥协', ['边界争议', '界碑', '边地巡逻']],
      ['truce', 'truce_clock_mismatch', '停战起止时辰理解不一', '军令送达时间造成空档', '前线人员可能为时间差付出代价', '双方同意停战，却未统一以何时何地为生效点', '停战书、鼓角记录和信使到达时辰可以交叉核验', '一次误动可能被解释为违约，也可能只是命令未送达', ['停战', '生效时辰', '停战书']],
      ['envoys', 'interpreter_protocol_gap', '使者措辞被翻译成更强硬的意思', '原话与译文在关键动词上不同', '译者同时面对两方压力', '会谈因一句措辞突然转冷', '随员笔记、重复问答和译者用词能定位差异', '译者若承认误差可能失去信任，若不说明则会扩大误会', ['使者翻译', '会谈措辞', '译文']],
      ['gifts', 'return_gift_imbalance', '回礼轻重被视作政治信号', '礼单价值与公开陈列不同', '经办人被迫解释上层态度', '收到礼物后，回礼方案在节俭与示好之间摇摆', '入库清单、公开陈列和实际回赠物件存在差异', '任何选择都可能被对方或本方解读成亲疏变化', ['外交回礼', '礼单', '使者礼物']],
      ['passage', 'passage_supply_damage', '借道军队造成沿途损耗', '通行约定没有覆盖补偿', '沿路百姓向谁索赔并不清楚', '借道方按约通过，但牲畜和道路受到额外影响', '原约、沿路征用凭据和损坏记录能区分部分责任', '地主、地方官与盟军都可能把赔偿推给另一方', ['借道', '沿途损耗', '通行约定']],
      ['cost_sharing', 'delayed_alliance_contribution', '盟军分摊迟迟未到', '承诺数量与发运记录有差距', '先行垫付者开始怀疑联盟', '一方已经承担开支，另一方仍以道路或审批为由拖延', '盟书、发运凭据和接收记录可以确认拖延环节', '继续垫付会加深依赖，停止则可能破坏共同安排', ['军费分摊', '盟军出资', '延迟交付']],
      ['hostages', 'hostage_escort_change', '人质护送路线临时改变', '新命令来源无法确认', '随行亲属担心被当作筹码', '护送队收到要求改道的口信', '原路线、口信印记和沿途接应安排相互冲突', '护送者若拒绝可能违命，服从则可能把人带入未知风险', ['人质护送', '临时改道', '接应']],
      ['prisoner_exchange', 'exchange_missing_name', '交换名单漏掉关键人员', '姓名异写造成身份疑点', '家属把希望寄托在一张名单上', '双方名单人数相近，但具体姓名无法完全对应', '籍贯、伤情和姓名异写可以帮助识别同一人', '贸然替换名额可能救回一人，也可能让另一人失去机会', ['俘虏交换', '交换名单', '姓名异写']],
      ['double_promises', 'courier_promise_collision', '两路使者带回互相冲突的承诺', '授权范围没有写进文书', '执行者面临双重失信', '不同谈判渠道都声称获得了优先保证', '使者授权、会谈日期和承诺对象可以判断是否越权', '满足一方承诺可能立即暴露对另一方的隐瞒', ['双重承诺', '两路使者', '授权']],
    ],
  },
  {
    domain: 'intelligence_covert',
    facets: ['rumor_intelligence', 'evidence', 'misidentification'],
    perspectives: ['official', 'merchant_craftsman', 'wanderer_outsider'],
    motifs: [
      ['inside_agents', 'inside_agent_payment_signal', '内应联络因报酬中断', '钱物交接留下替代记号', '联络人可能被双方放弃', '原有接头信号停止，新的索价却突然出现', '货币来源、包裹系法和交接地点能验证部分身份', '真假内应都可能利用付款争议诱使对方暴露', ['内应', '接头报酬', '联络信号']],
      ['forged_documents', 'forged_document_material_source', '伪文书纸墨来源受到追查', '纸张裁切指向同一批次', '抄手和店家可能无意卷入', '多份可疑文书使用了相近材料', '纸纹、墨色和裁切边缘能连接采购与制作环节', '材料供应者未必知情，却可能成为最容易被控制的证人', ['假文书', '纸墨来源', '裁切']],
      ['prisoner_testimony', 'borrowed_prisoner_story', '数名降卒讲出过于相似的经历', '共同错序显示口供可能互相借用', '真正知情者害怕与假口供一同受罚', '多份口供在细节和措辞上异常一致', '事件次序、用词习惯和分开问话记录可以检查是否串供', '若把一致当作可靠，可能放过编造；一概否定又会压住真实线索', ['降卒口供', '串供', '分开问话']],
      ['disguise', 'borrowed_identity_detail', '伪装身份在日常细节上露出缺口', '路引与生活习惯指向不同来历', '被冒用身份的人也可能受到追查', '来客能答出公开信息，却回避熟人和日常习惯', '路引纸张、口音用词和随身物件可与自称经历交叉核验', '贸然揭穿可能惊动同伙，放任则可能让无辜身份承担后果', ['身份伪装', '路引', '来历核验']],
    ],
  },
  {
    domain: 'frontier_ethnic',
    facets: ['familiar_network', 'misidentification', 'dual_loyalty'],
    perspectives: ['envoy_foreigner', 'merchant_craftsman', 'family_member'],
    usageBoundary: '不得把任何族群写成单一性格、固定敌人或没有内部差异的整体。',
    motifs: [
      ['frontier_trade', 'seasonal_market_route', '季节互市临时迁址', '旧路标让商队走错方向', '熟悉旧市的人失去交易优势', '水草和治安变化迫使互市地点调整', '路标、营火痕迹和向导口述可以确认新旧路线', '迁址可能帮助一部分商户，也会切断另一些人的熟客网络', ['边疆互市', '季节迁址', '商路']],
      ['frontier_treaty', 'grazing_boundary_terms', '盟约中的牧地范围解释不一', '季节界线没有固定标记', '逐水草而居的家庭承受边界僵化', '双方对可使用草场的时段和范围各有理解', '旧约措辞、泉眼位置和往年迁徙路线能提供参照', '强行固定边界可能保护一方权益，也可能破坏原有季节安排', ['边疆盟约', '牧地边界', '草场']],
      ['submission', 'submission_internal_factions', '归附群体内部意见分裂', '印信只代表其中一支', '普通家庭担心被首领决定命运', '来使宣称代表全体，但同行者态度并不一致', '印信来源、随行名单和各部落营地反应可供核验', '接受单一代表可能忽视内部差异，拒绝又可能推开愿意合作者', ['归附', '内部派别', '代表资格']],
      ['chief_authority', 'chief_successor_recognition', '首领继承尚未获得共同承认', '礼物往来显示支持分散', '亲族关系与部众选择彼此冲突', '多名继承人都声称掌握传统和现实支持', '会盟座次、礼物去向和随从构成能显示不同支持网络', '外部势力承认其中一人，可能改变原有内部平衡', ['首领继承', '承认', '支持网络']],
      ['resettlement', 'old_graves_new_fields', '新垦地触及旧有墓地', '地表标记被风雨掩盖', '迁居者与守墓家族都怕失去根基', '安置官划出的土地被另一群体认作祖先墓域', '残存石记、祭扫路径和老人口述可以缩小范围', '任何简单划分都可能让一方感到生计或祖先被轻视', ['边疆迁居', '旧墓', '新垦地']],
      ['translation', 'hostage_term_ambiguity', '“质子”与“随侍”被译成同一意思', '双方文书使用不同关系词', '年轻随行者的身份取决于解释', '会谈中对人员留驻性质产生理解分歧', '原文、译文和礼遇安排能显示双方期待不同', '若按人质对待可能破坏信任，按宾客对待又可能失去担保作用', ['边疆翻译', '质子', '随侍']],
      ['customs', 'mourning_protocol_misread', '守丧礼俗被误判为敌意', '服饰与禁忌有明确时段', '知情者来不及解释双方反应', '一方的回避和沉默被另一方视为拒绝合作', '丧期、服饰和接待习惯可以解释行为来源', '若误会继续，个人礼俗可能被扩大成群体立场', ['边疆礼俗', '守丧', '接待误会']],
      ['frontier_army_division', 'garrison_trade_strategy_split', '边军对互市与封锁意见相反', '巡逻记录显示两种策略交替', '边民在政策摇摆中承担损失', '守将强调安全，地方军吏则依赖贸易维持关系', '关口开闭、冲突频率和商队记录可比较策略后果', '执行者可能既服从军令，又不愿切断长期熟人网络', ['边军分歧', '互市封锁', '巡逻']],
      ['frontier_trade', 'dual_weight_system', '互市双方使用不同衡器', '同一货物出现两套重量', '翻秤人被怀疑偏袒一方', '交易因衡器差异不断发生小额争执', '标准石、商户旧账和现场复秤能够定位差别', '统一衡器会让一方习惯性折价突然消失，引发新的利益冲突', ['互市衡器', '复秤', '边疆贸易']],
      ['frontier_treaty', 'treaty_renewal_gifts', '续盟礼物被理解成贡纳', '礼单称谓暴露不同期待', '送礼者不愿承认地位下降', '例行续盟所送物品被双方赋予不同政治含义', '旧礼单、称谓和回礼规模可以比较历次关系', '坚持某种解释可能维护体面，也可能让实际合作中断', ['续盟', '盟约礼物', '称谓']],
    ],
  },
  {
    domain: 'scholars_ritual',
    facets: ['public_front', 'rumor_intelligence', 'silence'],
    perspectives: ['scholar_retainer', 'official', 'wanderer_outsider'],
    motifs: [
      ['study_travel', 'study_route_patronage', '游学路线受资助者影响', '旅费来源藏在书信往来中', '求学者的选择被视作政治靠拢', '年轻士人改变原定拜师地点，引发同门猜测', '旅费、引荐书和投宿安排能显示背后支持', '接受资助可能获得机会，也会让学术选择带上人情债', ['游学', '拜师', '旅费']],
      ['classics', 'variant_classic_text', '经文异本引起讲席争论', '抄本差异可追到不同传承', '学生夹在两位老师之间', '同一章句出现影响制度解释的不同文字', '抄本年代、批注和传授来源可以梳理版本链', '公开支持一种解释可能被理解为否定另一位师长', ['经学异本', '章句', '讲席']],
      ['local_education', 'school_grain_shortage', '乡学经费与粮食不足', '捐助名册没有对应支出', '学生最先失去持续学习机会', '地方教化计划无法同时维持师资和学生供给', '捐助、支粮和授课日期能核验资源是否真正到位', '停办会中断寒门路径，强撑则可能占用赈济与公用资源', ['地方教化', '乡学', '经费']],
      ['recommendation', 'private_favor_recommendation', '荐举名单被质疑夹带私恩', '荐书评价与旧交往高度重合', '真正有才者也会受到连带怀疑', '数名被荐者都与同一圈子关系密切', '宴请、师承和荐书措辞可以显示关系网络', '揭露私恩可能纠正偏袒，也可能毁掉没有参与运作的被荐者', ['荐举私恩', '荐书', '关系网络']],
      ['teacher_student', 'disputed_lineage', '两支门生争论师承正统', '讲义来源显示彼此借用', '后辈被迫继承前代分歧', '两方都声称更完整地保存老师学说', '早期讲义、书信和共同用语可以重建传授过程', '承认相互影响可能缓和争执，却会削弱各自名望', ['师承争议', '讲义', '门生']],
      ['letters', 'intercepted_private_letter', '私信内容被公开转述', '转述删去了前后语境', '写信人与收信人同时失去安全感', '一封私人书信成为清议和官场谈资', '原件、摘抄和不同人口中的转述可以比较删改', '主动澄清可能扩大传播，沉默则让别人定义信中意思', ['私信泄露', '书信', '公开转述']],
      ['elite_opinion', 'anonymous_critique_source', '匿名议论冲击地方名声', '用典习惯指向有限圈子', '被议论者难以面对无形对手', '一篇无名文字在士人间迅速抄传', '纸张、笔迹和特有用典可以缩小作者范围', '追查作者可能压制恶意，也可能被解释为不能容纳批评', ['匿名清议', '抄传', '用典']],
      ['reputation', 'borrowed_reputation', '有人借名士声望为自己背书', '引语在早期文本中并不存在', '被借名者很难公开切割所有追随者', '某项主张被宣称得到知名人士认可', '早期书信、在场证人和引语版本能检查来源', '澄清可能伤害支持者，默认则会让声名承担陌生立场', ['借名', '名声背书', '引语']],
      ['copying', 'variant_manuscript_market', '异本在书市被当作秘传抬价', '错字链暴露共同底本', '抄手信誉与生计一起受考验', '多份所谓独家抄本同时出现', '共同错字、页序和纸张来源可以确认是否同源', '揭穿秘传会保护读者，也可能让无意转抄者失去收入', ['异本抄书', '书市', '共同错字']],
      ['banquet', 'banquet_refusal_meaning', '拒宴被解释成政治表态', '回帖措辞其实指向家庭缘故', '缺席者无法控制外界解读', '一次没有出席的宴饮引发站队猜测', '回帖、送礼和家中近期事务能提供其他解释', '公开说明私事可能换来理解，也可能暴露不愿示人的家庭压力', ['拒宴', '宴饮', '回帖']],
    ],
  },
  {
    domain: 'family_daily_life',
    facets: ['private_backdoor', 'familiar_network', 'aftermath_cost'],
    perspectives: ['family_member', 'merchant_craftsman', 'civilian_refugee'],
    usageBoundary: '成人内容仍受现有年龄、同意和关系门禁，不得由 StoryPack 绕过。',
    motifs: [
      ['neighbors', 'shared_wall_dispute', '邻里共墙修缮争执', '旧地契没有写清维护责任', '日常往来被小事持续消耗', '雨损后两户都要求对方先出工料', '墙基位置、旧修补痕迹和地契边注可以核验', '若争执升级，取水、照料和夜间互助等长期关系都会受影响', ['邻里', '共墙', '修缮']],
      ['inns', 'inn_luggage_mixup', '旅舍行囊被错领', '寄存木牌与房号对不上', '陌生旅人首先受到怀疑', '清晨有人发现贵重行囊不在原处', '木牌、进出时辰和包裹绑法能区分误领与偷取', '店家若急于定罪可能失去信誉，拖延又会让旅人离开', ['旅舍', '行囊', '寄存木牌']],
      ['urban_entertainment', 'performance_debt', '演出班社因欠资无法散场', '赏钱承诺只有口头见证', '艺人和雇主都怕当众失面', '宴后班社要求兑现此前许诺的酬劳', '席间见证、账房记录和实际赏钱能够核验部分承诺', '公开争执会影响生计与名声，私下拖欠则把压力留给弱势一方', ['市井娱乐', '班社酬劳', '赏钱']],
      ['marriage', 'delayed_wedding_obligation', '婚期一再推迟引发猜疑', '聘礼保管和书信说法不同', '当事人的年龄与生活安排被悬置', '两家都声称只是等待更合适时机', '聘礼交接、家书和实际筹备支出可以显示真实准备', '继续拖延可能保护家庭免于眼前困难，也会消耗双方信任', ['婚期推迟', '聘礼', '婚姻']],
      ['heirs', 'adopted_biological_claim', '收养与亲生继嗣权利相撞', '早年约书与族谱记录不一致', '孩子被卷入成人财产安排', '家庭人口变化后，旧有继嗣约定受到挑战', '收养约书、抚养事实和族谱增补可以分别核验', '任何重排都可能让某个孩子失去长期依靠与身份认同', ['继嗣', '收养', '族谱']],
      ['family_property', 'dowry_ownership_after_return', '归宁后嫁资归属不清', '陪送清单与现存财物错位', '亲族保护与个人财产权冲突', '婚姻关系变化后，两家都主张部分财物', '陪送清单、使用痕迹和保管地点能够逐项确认', '当事人可能依赖娘家庇护，也不愿放弃自身处置权', ['家产', '嫁资归属', '归宁']],
      ['family_letters', 'false_death_rumor_letter', '家书带回未经证实的死讯', '落款与递送路线存在疑点', '家人面对哀悼与等待的两难', '一封转手多次的家书声称远行亲人已死', '落款、纸张和沿途递送记录不足以完全确认消息', '立即处置家产或改组家庭都可能在消息反转后留下伤害', ['家书死讯', '远行亲人', '落款']],
      ['master_servant', 'freed_servant_claim', '放免承诺是否有效引发争议', '口头许诺缺少完整文书', '长期侍奉者争取重新开始', '主人家内部对是否曾允诺放免说法不同', '见证人口述、赏赐记录和不完整文书可以互相补证', '若继续依附，个人生计有保障却失去自主；离开则可能失去庇护', ['放免', '主仆', '侍奉']],
      ['caregiving', 'medicine_choice_family_split', '家人对治疗方式意见相反', '药方与病情变化可逐日核对', '照料者承担结果与指责', '病势反复使家庭在继续原方或另请医者间分裂', '用药时辰、症状记录和不同医者意见能提供比较', '任何选择都不能保证结果，负责照料者却可能被事后归责', ['疾病照料', '药方', '家人争议']],
      ['women_business', 'widow_partnership_terms', '寡居经营者与合伙人争权', '出资和日常经营贡献不同', '维持生计需要面对亲族干预', '商铺盈利后，亲族和合伙人都要求更多决定权', '出资凭据、进货账和实际经营时段可以区分贡献', '经营者若依赖亲族保护，可能同时失去对自己生计的控制', ['妇女经营', '合伙', '商铺账']],
    ],
  },
  {
    domain: 'aftermath_transition',
    facets: ['aftermath_cost', 'evidence', 'interest_conflict'],
    perspectives: ['civilian_refugee', 'official', 'family_member'],
    usageBoundary: '必须有战斗、战争、灾害、政权变化或事项终结等既成结构化结果，不得凭空宣告前置事件发生。',
    motifs: [
      ['public_trust', 'relief_complaint_after_result', '赈济过后仍有住户申诉', '发放凭据显示覆盖不均', '被遗漏者对新秩序失去信任', '结构化灾后结果已成立，但救济覆盖范围受到质疑', '领取凭据、住户名册和发放时段可以核验差异', '若申诉无人回应，真实遗漏与冒领怀疑都会侵蚀公共信任', ['disaster:resolved', '赈济申诉', '发放凭据']],
      ['victory_distribution', 'victory_share_after_war', '胜利后的内部份额尚未谈妥', '封存战果与分配名单不一致', '共同冒险者开始重新计算关系', '结构化战争结果已封存，但奖赏和缴获分配仍有争议', 'WarResult、报功簿和实际分配名单可以逐项比对', '若贡献与所得长期不相称，下一次协作意愿可能下降', ['war:completed', '胜利分配', '封存战果']],
      ['wounded', 'wounded_return_household', '伤者归家改变家庭分工', '医案与可承担劳作不同', '照料和生计压力同时出现', '结构化战斗结果确认伤情后，原有家庭安排无法照旧运行', 'CombatResult、医案和日常行动表现可以限定实际能力', '伤者想维持尊严，家人则必须重新分配劳作与照料', ['combat:completed', '伤者归家', '家庭照料']],
      ['captives', 'returned_captive_suspicion', '获释者归来仍受怀疑', '俘名册与获释过程留有空白', '重返群体的人难以证明忠诚', '结构化俘虏处置结果成立后，归来者的经历引发猜测', '俘名册、交换记录和同行人口述可以核验部分过程', '若所有沉默都被当作背叛，归来者可能再次失去归属', ['aftermath:captives_released', '获释归来', '俘名册']],
    ],
  },
] as const satisfies readonly DomainBatchBlueprint[];

function publicSummary(blueprint: MotifBlueprint, index: number): string {
  const [,, publicTitle,,, publicClue] = blueprint;
  const templates = [
    `“${publicTitle}”成为公开争议：${publicClue}。各方立场开始显形，但事实与责任仍需依本局证据核验。`,
    `${publicClue}，使“${publicTitle}”无法再被当作小事略过。公开处置会改变关系，却不能预设结论。`,
    `围绕“${publicTitle}”，${publicClue}。现有信息足以形成选择压力，不足以替人物决定应对方式。`,
    `“${publicTitle}”被带到众人面前；${publicClue}。不同身份会看到不同利害，走向仍服从本局事实。`,
  ];
  return templates[index % templates.length];
}

function evidenceSummary(blueprint: MotifBlueprint, index: number): string {
  const [,,, evidenceTitle,,, evidenceClue] = blueprint;
  const templates = [
    `“${evidenceTitle}”提供可复核入口：${evidenceClue}。这些痕迹只能缩小范围，不能单独裁定责任或结果。`,
    `${evidenceClue}，让“${evidenceTitle}”值得进一步查验。记录之间的差异仍需与本局权威状态交叉核对。`,
    `调查“${evidenceTitle}”时可先核对：${evidenceClue}。证据可能修正传言，也可能暴露新的解释缺口。`,
    `“${evidenceTitle}”并非定论；${evidenceClue}。只有完成核验，相关方的说法才具有更高可信度。`,
  ];
  return templates[index % templates.length];
}

function costSummary(blueprint: MotifBlueprint, index: number): string {
  const [,,,, costTitle,,, personalStake] = blueprint;
  const templates = [
    `“${costTitle}”指向具体人物代价：${personalStake}。压力会收紧可选空间，但不能替相关人物作出决定。`,
    `${personalStake}，使“${costTitle}”不只是制度问题。若继续拖延，关系代价可能先于事实裁断显现。`,
    `从人物处境看，“${costTitle}”意味着${personalStake}。候选冲突可以推动回应，不得锁死其选择。`,
    `“${costTitle}”把抽象矛盾落到日常关系中：${personalStake}。后续仍应由本局行动与状态决定。`,
  ];
  return templates[index % templates.length];
}

function buildKind(domain: string, variantIndex: number): WorldlineStoryThreadKind {
  if (domain === 'aftermath_transition') return 'aftermath';
  if (variantIndex === 0) return 'domainSituation';
  if (variantIndex === 1) return 'structuralPressure';
  return 'dramaMotif';
}

function buildBatch2Threads(): WorldlineStoryThread[] {
  const threads: WorldlineStoryThread[] = [];
  let globalIndex = 0;
  const domainBlueprints: readonly DomainBatchBlueprint[] = BATCH_2_DOMAINS;

  for (const domain of domainBlueprints) {
    for (const blueprint of domain.motifs) {
      const [
        subdomain,
        motifId,
        publicTitle,
        evidenceTitle,
        costTitle,
        ,
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
      const titles = [publicTitle, evidenceTitle, costTitle] as const;
      const summaries = [
        publicSummary(blueprint, globalIndex),
        evidenceSummary(blueprint, globalIndex),
        costSummary(blueprint, globalIndex),
      ] as const;

      for (let variantIndex = 0; variantIndex < 3; variantIndex += 1) {
        const fullRange = variantIndex === 0;
        threads.push(createThreeKingdomsStoryThread({
          kind: buildKind(domain.domain, variantIndex),
          domain: domain.domain,
          subdomain,
          motifId,
          facet: domain.facets[variantIndex],
          title: titles[variantIndex],
          summary: summaries[variantIndex],
          entrySignals: [...entrySignals],
          escalationShapes: [
            `${publicTitle}要求相关方公开回应`,
            `${evidenceTitle}推动进一步核验`,
            `${costTitle}使拖延产生人物代价`,
          ],
          rolePerspectives: [domain.perspectives[variantIndex]],
          relatedTags: [
            ...entrySignals,
            `domain:${domain.domain}`,
            `era:${eraBand.id}`,
            `region:${region}`,
          ],
          timeRange: fullRange
            ? { start: '公元184年', end: '公元280年' }
            : {
              start: `公元${eraBand.startYear}年`,
              end: `公元${eraBand.endYear}年`,
            },
          reusePolicy: domain.domain === 'aftermath_transition'
            ? 'save_single_use'
            : variantIndex === 0
              ? 'context_reusable'
              : 'motif_reusable',
          cooldownTurns: domain.domain === 'aftermath_transition'
            ? 24
            : 10 + (variantIndex * 2),
          promptSafeVersion: '1.0.0',
          usageBoundary,
        }));
      }

      globalIndex += 1;
    }
  }

  return threads;
}

export const THREE_KINGDOMS_STORY_PACK_BATCH_2_BLUEPRINTS = BATCH_2_DOMAINS;
export const THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS = buildBatch2Threads();
