import type { WorldlineKnowledgeCard, WorldlineKnowledgeCardKind } from '../../engine/types';
import {
  THREE_KINGDOMS_MAJOR_EVENT_MANIFEST,
  type ThreeKingdomsMajorEventManifestEntry,
} from './knowledgeBaseMajorEventManifest';

interface LateEventInput {
  id: string;
  manifestId: string;
  summary: string;
  relatedNpcNames: string[];
  relatedPlaceIds: string[];
  relatedTags?: string[];
  structuralPressure: string;
  contradictionHint: string;
}

interface ContextCardInput {
  id: string;
  kind: WorldlineKnowledgeCardKind;
  title: string;
  summary: string;
  start: string;
  end: string;
  relatedNpcNames?: string[];
  relatedFactionIds?: string[];
  relatedPlaceIds?: string[];
  relatedTags: string[];
  importance?: WorldlineKnowledgeCard['importance'];
  strictness?: WorldlineKnowledgeCard['strictness'];
  contradictionHint: string;
}

const manifestById = new Map(
  THREE_KINGDOMS_MAJOR_EVENT_MANIFEST.map((entry) => [entry.id, entry] as const),
);

function requireManifestEntry(manifestId: string): ThreeKingdomsMajorEventManifestEntry {
  const entry = manifestById.get(manifestId);
  if (!entry) {
    throw new Error(`Missing KnowledgeBase manifest entry: ${manifestId}`);
  }
  return entry;
}

function lateHistoricalEventCard(input: LateEventInput): WorldlineKnowledgeCard {
  const manifest = requireManifestEntry(input.manifestId);
  return {
    id: input.id,
    worldBookId: 'threeKingdoms',
    kind: 'event',
    title: manifest.title,
    summary: input.summary,
    timeRange: {
      start: manifest.historicalWindow.earliest ?? manifest.historicalWindow.typical,
      end: manifest.historicalWindow.latest ?? manifest.historicalWindow.typical,
    },
    relatedNpcNames: input.relatedNpcNames,
    relatedFactionIds: [],
    relatedPlaceIds: input.relatedPlaceIds,
    relatedTags: [...new Set([
      manifest.title,
      ...manifest.aliases,
      ...(input.relatedTags ?? []),
    ])],
    importance: 'major',
    strictness: 'strict',
    contradictionHint: `本局边界：${input.contradictionHint}`,
    sourceLabel: '《三国志》《晋书》《资治通鉴》后期历史锚点整理',
    historicalEvent: {
      historicalWindow: { ...manifest.historicalWindow },
      structuralPressure: input.structuralPressure,
      divergencePolicy: { ...manifest.divergencePolicy },
    },
  };
}

function contextCard(input: ContextCardInput): WorldlineKnowledgeCard {
  return {
    id: input.id,
    worldBookId: 'threeKingdoms',
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    timeRange: { start: input.start, end: input.end },
    relatedNpcNames: input.relatedNpcNames ?? [],
    relatedFactionIds: input.relatedFactionIds ?? [],
    relatedPlaceIds: input.relatedPlaceIds ?? [],
    relatedTags: input.relatedTags,
    importance: input.importance ?? 'normal',
    strictness: input.strictness ?? 'default',
    contradictionHint: `本局边界：${input.contradictionHint}`,
    sourceLabel: '《三国志》《晋书》制度、社会与人物阶段整理',
  };
}

/**
 * KnowledgeBase Batch 3：235—280 年重大事件收尾。
 *
 * 卡片只提供历史参照与偏转边界；事件是否发生、何时发生及结果如何，
 * 仍由本局事实、玩家行动和结构化状态决定。
 */
export const THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_MAJOR_EVENTS: WorldlineKnowledgeCard[] = [
  lateHistoricalEventCard({
    id: 'tk3k_238_liaodong_campaign',
    manifestId: 'tk3k_manifest_238_liaodong',
    summary: '景初二年（238），司马懿率魏军远征辽东。公孙渊退守襄平，魏军经历霖雨、围城与长距离补给后攻破政权，辽东诸郡重新纳入曹魏；此战也显著增加司马懿的军政声望。',
    relatedNpcNames: ['司马懿', '公孙渊', '曹叡'],
    relatedPlaceIds: ['region_youzhou', 'loc_sili_henan'],
    relatedTags: ['辽东公孙氏', '襄平围城', '海东诸郡'],
    structuralPressure: '辽东割据、东北边郡控制和跨千里远征补给，会持续牵动中原政权与辽东势力的关系。',
    contradictionHint: '若公孙氏已归附、辽东控制者不同或司马懿不具备统兵条件，不得复制襄平围城及固定败亡。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_239_wei_regency',
    manifestId: 'tk3k_manifest_239_wei_regency',
    summary: '239 年曹叡去世，年幼的曹芳即位，曹爽与司马懿受遗诏辅政。辅政人选经过临终改组，并非自然形成的稳定二元权力；宫禁、中书、禁军与外镇军功共同决定后续朝局。',
    relatedNpcNames: ['曹叡', '曹芳', '曹爽', '司马懿', '刘放', '孙资'],
    relatedPlaceIds: ['loc_sili_henan'],
    relatedTags: ['魏明帝崩', '幼主辅政', '曹爽司马懿'],
    structuralPressure: '幼主继位会放大辅政资格、宫禁控制、禁军与外镇军权之间的竞争。',
    contradictionHint: '若曹叡、曹芳、曹爽或司马懿的身份命运已经改变，必须依据本局重组继承和辅政，不得强行通向高平陵。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_244_xingshi_campaign',
    manifestId: 'tk3k_manifest_244_xingshi',
    summary: '244 年曹爽率大军由骆谷等道伐蜀，汉中守将王平主张据险固守，费祎率援军赶至。魏军因山道、转运和蜀军阻击陷入困境后撤，伤亡与畜力损失削弱曹爽的军事声望。',
    relatedNpcNames: ['曹爽', '王平', '费祎', '夏侯玄'],
    relatedPlaceIds: ['region_yizhou', 'region_liangzhou'],
    relatedTags: ['骆谷伐蜀', '汉中防御', '曹爽失利'],
    structuralPressure: '汉中山道、运粮距离与守方险要会持续限制大军越秦岭作战。',
    contradictionHint: '若汉中控制、参战将领或魏蜀关系已改变，只保留山地后勤压力，不得指定曹爽败退。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_251_wangling_revolt',
    manifestId: 'tk3k_manifest_251_wangling',
    summary: '高平陵之后，王凌与令狐愚等不满司马氏控制朝政，曾谋迎楚王曹彪取代曹芳。计划泄露后司马懿迅速东下，王凌归降并自尽，曹彪亦被处置，淮南外镇与中央的裂痕由此公开化。',
    relatedNpcNames: ['王凌', '令狐愚', '曹彪', '曹芳', '司马懿'],
    relatedPlaceIds: ['region_yangzhou', 'loc_sili_henan'],
    relatedTags: ['淮南一叛', '楚王曹彪', '外镇反司马'],
    structuralPressure: '掌握重兵的淮南外镇与中央实际控制者之间，会围绕皇权名义、征召和兵权持续冲突。',
    contradictionHint: '若高平陵未发生、司马氏未掌权或王凌阵营改变，不得换名复演迎立曹彪及固定结局。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_252_sunquan_succession',
    manifestId: 'tk3k_manifest_252_sunquan_death',
    summary: '252 年孙权去世，幼子孙亮即位，诸葛恪等受命辅政。二宫之争留下的宗室、外戚和大族裂痕并未消失；东兴胜利短暂提高诸葛恪声望，却不能消除幼主朝廷的结构风险。',
    relatedNpcNames: ['孙权', '孙亮', '诸葛恪', '滕胤', '孙峻'],
    relatedPlaceIds: ['region_yangzhou'],
    relatedTags: ['吴大帝崩', '孙亮即位', '吴国辅政'],
    structuralPressure: '长期君主去世后，幼主、辅政大臣、宗室和江东大族需要重新分配宫廷与军队控制权。',
    contradictionHint: '若孙权继承安排、太子或东吴控制结构已改变，不得指定孙亮和诸葛恪形成相同辅政格局。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_253_zhugeke_fall',
    manifestId: 'tk3k_manifest_253_zhugeke',
    summary: '诸葛恪在东兴获胜后大举攻魏，新城之役因疫病、补给和久攻受挫。回国后其威望和政治处境急转直下，孙峻联合孙亮发动政变杀死诸葛恪，吴国辅政权力转入新的宗室集团。',
    relatedNpcNames: ['诸葛恪', '孙亮', '孙峻'],
    relatedPlaceIds: ['region_yangzhou'],
    relatedTags: ['新城之役', '孙峻政变', '吴国权臣'],
    structuralPressure: '军功型辅政者若在远征中耗损声望，宫廷、宗室与军中反对力量会迅速重组。',
    contradictionHint: '若诸葛恪未辅政、远征结果或孙峻地位不同，不得强制政变杀恪，只保留权臣问责压力。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_255_shouchun_revolt',
    manifestId: 'tk3k_manifest_255_shouchun',
    summary: '255 年毌丘俭、文钦在寿春举兵，反对司马师废曹芳、控制魏廷。叛军未能整合淮南与周边兵力，司马师抱病统军镇压；毌丘俭败死，文钦逃吴，淮南与吴国联系进一步加深。',
    relatedNpcNames: ['毌丘俭', '文钦', '司马师', '曹芳'],
    relatedPlaceIds: ['region_yangzhou', 'loc_sili_henan'],
    relatedTags: ['淮南二叛', '寿春举兵', '司马师'],
    structuralPressure: '废立皇帝与中央征召会激化外镇将领对司马氏合法性和自身安全的疑虑。',
    contradictionHint: '若曹芳未被废、司马氏未控魏廷或淮南将领归属变化，不得照搬寿春举兵及败亡路线。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_256_duangu_defeat',
    manifestId: 'tk3k_manifest_256_duangu',
    summary: '256 年姜维与胡济约期会师，胡济未至，蜀军在段谷被邓艾击败，军队和将领承受明显损失。姜维随后自贬，蜀汉内部对连续用兵、调度协同与后勤负担的争论加剧。',
    relatedNpcNames: ['姜维', '胡济', '邓艾'],
    relatedPlaceIds: ['region_liangzhou', 'region_yizhou'],
    relatedTags: ['姜维段谷败绩', '会师失约', '北伐代价'],
    structuralPressure: '跨山远征的会师协同、粮运和有限兵力，会放大一次失约或战败对蜀汉国力与朝议的冲击。',
    contradictionHint: '若姜维未主兵、胡济按期会合或战局不同，不得指定段谷败绩、自贬和固定损失。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_257_zhugedan_revolt',
    manifestId: 'tk3k_manifest_257_zhugedan',
    summary: '257—258 年诸葛诞拒绝入朝，在寿春举兵并向吴求援。司马昭奉魏帝与太后出征，长期合围；城内粮尽、文钦被杀及吴援受挫后，寿春失守，淮南三次大规模反抗至此被压平。',
    relatedNpcNames: ['诸葛诞', '司马昭', '文钦', '孙綝', '钟会'],
    relatedPlaceIds: ['region_yangzhou', 'loc_sili_henan'],
    relatedTags: ['淮南三叛', '寿春围城', '吴军援救'],
    structuralPressure: '中央要求外镇入朝、地方屯田兵与邻国援助，会共同决定边镇是否选择反抗及能否久守。',
    contradictionHint: '若诸葛诞已归附、吴国不援或司马昭未掌权，不得复制寿春围城和固定清洗。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_260_caomao_death',
    manifestId: 'tk3k_manifest_260_caomao',
    summary: '260 年曹髦不甘受制，率近侍出宫讨司马昭。贾充部下成济在冲突中杀死皇帝，魏廷随后处置成济并改立曹奂。此事暴露曹魏皇权名义与司马氏实际权力已难并存。',
    relatedNpcNames: ['曹髦', '司马昭', '贾充', '成济', '曹奂'],
    relatedPlaceIds: ['loc_sili_henan'],
    relatedTags: ['甘露之变', '曹髦讨司马昭', '魏帝遇害'],
    structuralPressure: '名义皇帝与实际控制者长期分离，会把宫禁安全、废立与禅代合法性推向公开冲突。',
    contradictionHint: '若曹髦、司马昭或魏廷控制结构已经改变，不得强制弑君和改立曹奂。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_264_zhonghui_revolt',
    manifestId: 'tk3k_manifest_264_zhonghui',
    summary: '蜀亡后，钟会在成都排挤并拘押邓艾，继而与姜维谋据蜀地反司马昭。军中将领与士卒并未形成稳定支持，兵变很快失控，钟会、姜维被杀，邓艾亦在押解途中遇害。',
    relatedNpcNames: ['钟会', '姜维', '邓艾', '司马昭'],
    relatedPlaceIds: ['region_yizhou'],
    relatedTags: ['成都之变', '钟会姜维之变', '灭蜀后军权'],
    structuralPressure: '灭国后庞大远征军、降军、功臣赏罚与占领区接管，会制造统帅和中央之间的新权力风险。',
    contradictionHint: '若蜀未亡、钟会邓艾姜维命运或军队忠诚已改变，不得安排同样兵变与三人死亡。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_265_jin_replaces_wei',
    manifestId: 'tk3k_manifest_265_jin',
    summary: '265 年司马昭死后，司马炎继承晋王与相国地位，迫使魏帝曹奂禅让，建立西晋。代魏是司马氏数十年掌握军政、封爵晋升与九锡程序的终点；蜀亡不等于此时已经天下统一。',
    relatedNpcNames: ['司马昭', '司马炎', '曹奂'],
    relatedPlaceIds: ['loc_sili_henan'],
    relatedTags: ['晋代魏', '魏元帝禅让', '西晋建立'],
    structuralPressure: '实际控制者完成军政垄断后，仍需处理宗室、百官、封爵礼制和新王朝合法性。',
    contradictionHint: '若曹魏、司马氏或禅让条件不存在，应判为偏转，不得让其他势力换名复刻晋代魏。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_269_late_wu_standoff',
    manifestId: 'tk3k_manifest_269_wu_late',
    summary: '孙皓统治后期，东吴仍拥有长江防线、荆扬军镇与陆抗等将领，并非蜀亡后立刻崩溃；但宫廷清洗、重役、地方叛乱和交州反复削弱内部承受力，晋吴形成长期对峙。',
    relatedNpcNames: ['孙皓', '陆抗', '丁奉', '羊祜'],
    relatedPlaceIds: ['region_yangzhou', 'region_jingzhou'],
    relatedTags: ['吴末政局', '晋吴对峙', '长江防线'],
    structuralPressure: '长江防线、荆扬军镇与地方财政可延缓统一，但宫廷治理和民力决定吴国能否长期维持。',
    contradictionHint: '若孙皓未即位、吴国治理改善或晋不存在，不得自动套用暴政亡国叙事。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_272_xiling_campaign',
    manifestId: 'tk3k_manifest_272_xiling',
    summary: '272 年吴将步阐据西陵降晋。陆抗一面围西陵，一面阻击羊祜、杨肇等晋军，最终击退援军并收复西陵。此战显示吴国后期仍具有效边防组织，也暴露边镇归属与中央信任问题。',
    relatedNpcNames: ['陆抗', '步阐', '羊祜', '杨肇', '孙皓'],
    relatedPlaceIds: ['region_jingzhou'],
    relatedTags: ['陆抗西陵破晋', '步阐降晋', '晋吴边境'],
    structuralPressure: '荆州边镇的将领安全、要塞控制和跨江援军会决定晋吴边境的攻守转换。',
    contradictionHint: '若步阐未降、陆抗不在或边境控制不同，不得指定吴军获胜，只保留边镇忠诚与要塞压力。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_279_jin_conquest_wu',
    manifestId: 'tk3k_manifest_279_jin_campaign',
    summary: '279 年末西晋分多路伐吴：王濬、唐彬率巴蜀舟师顺江而下，杜预等从荆州推进，王浑等压向建业方向。战争依赖多年造船、上游控制、江防突破和多军协同，不是单将直取建业。',
    relatedNpcNames: ['司马炎', '王濬', '唐彬', '杜预', '王浑', '孙皓'],
    relatedPlaceIds: ['region_yizhou', 'region_jingzhou', 'region_yangzhou'],
    relatedTags: ['六路伐吴', '王濬楼船', '长江水陆并进'],
    structuralPressure: '统一战争需要上游造船、长江沿线据点、多路协调与足以承受远征的财政民力。',
    contradictionHint: '若晋未建国、吴国防线或上游控制已改变，不得照搬六路部署、将领名单和史实进军速度。',
  }),
  lateHistoricalEventCard({
    id: 'tk3k_280_wu_fall',
    manifestId: 'tk3k_manifest_280_wu_fall',
    summary: '太康元年（280），晋军突破西陵、江陵等长江防线并多路逼近建业，孙皓出降，东吴政权终结。晋随后接收吴地官民与军镇；统一并不意味着战争破坏、地方整合和南北制度差异立即消失。',
    relatedNpcNames: ['司马炎', '孙皓', '王濬', '杜预', '王浑'],
    relatedPlaceIds: ['region_jingzhou', 'region_yangzhou', 'loc_sili_henan'],
    relatedTags: ['三国归晋', '孙皓降晋', '太康统一'],
    structuralPressure: '末期政权的防线、军心、民力和中央信任崩解后，胜方仍要承担接收军镇与地方整合成本。',
    contradictionHint: '若吴或晋不存在、吴已胜出或天下格局不同，必须判为偏转，绝不能换名安排“三国归晋”。',
  }),
];

/**
 * 10—16 张制度/社会卡。本批采用 12 张，补足后期叙事最常误判的
 * 选官、军户、财政、人口与后勤边界。
 */
export const THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_SYSTEM_SOCIAL: WorldlineKnowledgeCard[] = [
  contextCard({
    id: 'tk3k_system_nine_rank_selection',
    kind: 'customRule',
    title: '九品官人法与中正选官',
    summary: '曹魏建立前后，陈群推动九品官人法，由州郡中正评定人物品第，为战乱后的选官提供统一尺度。它早期仍兼顾乡论、才德和中央需要，不应一出现就写成后世完全由门阀垄断的定型制度。',
    start: '公元220年',
    end: '公元280年',
    relatedNpcNames: ['陈群', '曹丕'],
    relatedFactionIds: ['faction_gentry_clan'],
    relatedTags: ['九品中正制', '九品官人法', '州郡中正', '选官'],
    importance: 'major',
    contradictionHint: '选官方式、品第效力和士族影响必须服从本局政权制度，不能只凭姓氏自动授官。',
  }),
  contextCard({
    id: 'tk3k_system_tuntian_transition',
    kind: 'customRule',
    title: '屯田从战时供给到地方财政',
    summary: '曹操时期的屯田包含民屯和军屯，用于恢复荒地、安置流民和供应军粮；到曹魏后期，各地典农、屯田客与郡县治理逐渐交织。屯田产出受水利、役使、战乱和分成影响，不是固定百分比的无限粮仓。',
    start: '公元196年',
    end: '公元280年',
    relatedNpcNames: ['曹操', '枣祗', '任峻'],
    relatedFactionIds: ['faction_local_government'],
    relatedTags: ['屯田制', '民屯', '军屯', '典农', '军粮'],
    contradictionHint: '屯田规模、归属和实收必须按本局人口、田地、水利与战争损耗计算。',
  }),
  contextCard({
    id: 'tk3k_system_military_households',
    kind: 'customRule',
    title: '士家、军户与长期兵役',
    summary: '魏吴等政权把部分军人及其家属编入持续承担兵役的户籍体系，形成士家、兵户或将领部曲。军队因此具备延续性，也带来家属控制、逃亡、补员和世袭压力；不能把所有士兵都当临时自由募兵。',
    start: '公元200年',
    end: '公元280年',
    relatedTags: ['士家', '军户', '兵户', '世袭兵役', '家属'],
    contradictionHint: '任何部队的补员、解散和继承都必须服从本局兵源与户籍，不能凭称号自动恢复满员。',
  }),
  contextCard({
    id: 'tk3k_system_household_registration_gap',
    kind: 'customRule',
    title: '户籍人口与实际人口的落差',
    summary: '战乱、逃亡、依附豪强和军户分籍使官方户口远低于社会实际人口。控制一座城只能取得账册与征收名义，不能立刻掌握全部流民、隐户和坞堡人口；恢复编户需要治安、减役与基层合作。',
    start: '公元184年',
    end: '公元280年',
    relatedFactionIds: ['faction_local_government', 'faction_gentry_clan'],
    relatedTags: ['编户', '隐户', '流民', '依附人口', '户籍'],
    contradictionHint: '人口、税基和兵源以本局登记、迁徙与豪强关系为准，不能从历史总数硬推当前产出。',
  }),
  contextCard({
    id: 'tk3k_system_wei_secretariat_regency',
    kind: 'customRule',
    title: '曹魏中书、尚书与辅政权力',
    summary: '曹魏中枢同时存在中书起草机密诏令、尚书执行政务、侍中近侍议政及大将军等辅政职位。幼主时期谁控制宫禁、诏令和禁军往往比名义官位更重要，不能把一纸任命等同于完整实际控制。',
    start: '公元220年',
    end: '公元265年',
    relatedNpcNames: ['曹叡', '曹爽', '司马懿', '刘放', '孙资'],
    relatedTags: ['中书监', '尚书台', '辅政', '宫禁', '诏令'],
    importance: 'major',
    contradictionHint: '中枢实际控制者必须读取本局任命、宫禁和军权事实，不能依据史实名单自动判定。',
  }),
  contextCard({
    id: 'tk3k_system_shuhan_finance',
    kind: 'customRule',
    title: '蜀汉盐铁、铸币与转运财政',
    summary: '蜀汉国土较小，财政依赖益州农业、盐铁收益、铸币和汉中—成都转运体系。账面钱币、粮石与实物供给不能互相无损折算；北伐增加运输、役夫和牲畜消耗，胜利也不会自动补平财政。',
    start: '公元214年',
    end: '公元263年',
    relatedNpcNames: ['刘巴', '诸葛亮', '姜维'],
    relatedPlaceIds: ['region_yizhou'],
    relatedTags: ['盐府校尉', '司金中郎将', '直百钱', '蜀汉财政', '转运'],
    contradictionHint: '蜀汉或替代政权的财政能力必须按本局产地、币值、道路和征收实况计算。',
  }),
  contextCard({
    id: 'tk3k_system_wu_troop_inheritance',
    kind: 'customRule',
    title: '东吴部曲领兵与继承',
    summary: '东吴将领常长期统领部曲，身故后亲属可能承接兵众与职任，但仍需要君主认可并受军府调度。这增强将门延续性，也使中央与江东大族相互依赖；不能写成私人军队当然世袭或随意合并。',
    start: '公元200年',
    end: '公元280年',
    relatedNpcNames: ['孙权', '陆逊', '陆抗'],
    relatedPlaceIds: ['region_yangzhou', 'region_jingzhou'],
    relatedTags: ['世袭领兵', '部曲', '将门', '江东大族'],
    contradictionHint: '部队继承、拆分与调动必须读取本局统属、君主任命和将领存亡，不能只凭亲属关系生成新军。',
  }),
  contextCard({
    id: 'tk3k_system_three_states_law',
    kind: 'customRule',
    title: '魏蜀吴律令并非一套法律',
    summary: '魏、蜀、吴各自承接汉律并形成不同法令与施政传统；曹魏编修新律，蜀汉有蜀科等治理依据，东吴法令又受军政与江东社会影响。案件不能直接套用后世明清律名，也不能假定三国同法。',
    start: '公元220年',
    end: '公元280年',
    relatedNpcNames: ['陈群', '刘巴', '伊籍', '诸葛亮'],
    relatedTags: ['魏律', '蜀科', '吴法', '律令', '司法'],
    contradictionHint: '审判与刑罚必须服从本局政权、成文法和已建立制度，不能凭历史标签自动定罪。',
  }),
  contextCard({
    id: 'tk3k_system_regional_currency',
    kind: 'customRule',
    title: '区域货币、谷帛与实物结算',
    summary: '三国时期钱币信用与铸币政策因地区和政权不同，谷物、布帛等实物仍广泛承担计价与支付。大额名义钱数不等于同等购买力，跨境贸易还受币制、运输和战争影响。',
    start: '公元184年',
    end: '公元280年',
    relatedTags: ['五铢钱', '直百钱', '大泉', '谷帛', '币值'],
    contradictionHint: '财富与军费应按本局币制、物价、实物库存和运输条件解释，不能把所有钱币一比一通兑。',
  }),
  contextCard({
    id: 'tk3k_system_campaign_logistics',
    kind: 'customRule',
    title: '大军远征的运输损耗',
    summary: '三国战争的瓶颈常在道路、漕运、牲畜、役夫和沿途仓储，而非只有账面粮草。秦岭、陇右、辽东和长江等战区各有不同运输条件；军粮从仓库到前线必然产生时间与损耗。',
    start: '公元184年',
    end: '公元280年',
    relatedPlaceIds: ['region_liangzhou', 'region_yizhou', 'region_jingzhou', 'region_youzhou'],
    relatedTags: ['后勤', '漕运', '粮道', '役夫', '运输损耗'],
    importance: 'major',
    contradictionHint: '行军消耗必须读取本局距离、道路、季节、补给线和部队规模，不采信正文中的随口估数。',
  }),
  contextCard({
    id: 'tk3k_society_frontier_migration',
    kind: 'place',
    title: '边疆族群、迁徙与多重归属',
    summary: '乌桓、鲜卑、羌、氐及南方山越等群体内部并不统一，可能与汉地政权结盟、受封、迁居、反叛或保持独立。迁徙人口也会改变边郡兵源和土地关系，不能把族名直接等同固定敌对势力。',
    start: '公元184年',
    end: '公元280年',
    relatedPlaceIds: ['region_youzhou', 'region_liangzhou', 'region_yangzhou'],
    relatedTags: ['乌桓', '鲜卑', '羌氐', '山越', '迁徙', '边郡'],
    contradictionHint: '各部归属、首领和人口迁徙必须服从本局盟约与战争，不得按族名自动敌对。',
  }),
  contextCard({
    id: 'tk3k_society_war_epidemic_recovery',
    kind: 'place',
    title: '战争、疫病与地方恢复周期',
    summary: '反复征发、饥荒和疫病会同时减少劳力、牲畜与基层官吏，使城池即使易主也难立刻恢复。人口回流、复耕、水利和税籍重建往往需要多年，不能在一回合内把战损地区恢复到满额产出。',
    start: '公元184年',
    end: '公元280年',
    relatedTags: ['疫病', '饥荒', '复耕', '人口回流', '战后恢复'],
    contradictionHint: '地方恢复速度必须按本局伤亡、迁徙、治安和政策计算，不能套用统一满额增长。',
  }),
];

/**
 * 后期关键人物与势力终局，避免 249 年后只剩事件名而缺少行为阶段。
 */
export const THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_ENDINGS: WorldlineKnowledgeCard[] = [
  contextCard({
    id: 'tk3k_simashi_249_255',
    kind: 'personTimeline',
    title: '司马师掌权阶段',
    summary: '高平陵后司马师承接司马懿的军政网络，控制魏廷并处理曹芳废立、淮南反抗和外部战事。他的权力来自中枢与军队，而非皇帝名号；255 年病重去世后由司马昭承接。',
    start: '公元249年',
    end: '公元255年',
    relatedNpcNames: ['司马师', '司马懿', '司马昭', '曹芳'],
    relatedPlaceIds: ['loc_sili_henan', 'region_yangzhou'],
    relatedTags: ['司马师', '魏廷实际控制', '废立', '淮南'],
    importance: 'major',
    contradictionHint: '司马师能否掌权及其死亡时间以本局人物状态和政治结果为准。',
  }),
  contextCard({
    id: 'tk3k_simazhao_255_265',
    kind: 'personTimeline',
    title: '司马昭掌权与晋国奠基',
    summary: '司马昭继兄掌权后镇压诸葛诞、应对曹髦之死并组织灭蜀，逐步进爵晋公、晋王。其势力扩张是军功、官僚合作和皇权衰退的累积，不应在 255 年即写成已经建立西晋。',
    start: '公元255年',
    end: '公元265年',
    relatedNpcNames: ['司马昭', '司马师', '曹髦', '钟会', '邓艾', '司马炎'],
    relatedPlaceIds: ['loc_sili_henan', 'region_yizhou'],
    relatedTags: ['司马昭', '晋公', '晋王', '灭蜀', '禅代准备'],
    importance: 'major',
    contradictionHint: '司马昭的爵位、军功和继承安排必须服从本局，不能跳过中间阶段直接代魏。',
  }),
  contextCard({
    id: 'tk3k_simayan_265_280',
    kind: 'personTimeline',
    title: '司马炎建晋与统一阶段',
    summary: '司马炎在 265 年代魏建晋，先整合曹魏旧官僚与宗室封国，再围绕是否伐吴长期权衡；羊祜、杜预、王濬等推动军备与战略，至 280 年灭吴。统一是政治与多年军事准备的结果。',
    start: '公元265年',
    end: '公元280年',
    relatedNpcNames: ['司马炎', '羊祜', '杜预', '王濬'],
    relatedPlaceIds: ['loc_sili_henan', 'region_jingzhou', 'region_yangzhou'],
    relatedTags: ['晋武帝', '西晋', '伐吴', '统一'],
    importance: 'major',
    contradictionHint: '司马炎是否即位、晋的版图与伐吴决策必须服从本局政权事实。',
  }),
  contextCard({
    id: 'tk3k_lukang_264_274',
    kind: 'personTimeline',
    title: '陆抗主持吴国西线',
    summary: '陆抗承接陆逊在荆州军政中的影响，孙皓时期长期镇守西陵，既整顿边防也反复劝谏减轻刑役。272 年西陵之战是其代表战绩；274 年去世后，吴国失去重要的边防统筹者。',
    start: '公元264年',
    end: '公元274年',
    relatedNpcNames: ['陆抗', '陆逊', '孙皓', '羊祜'],
    relatedPlaceIds: ['region_jingzhou'],
    relatedTags: ['陆抗', '西陵', '吴国边防', '劝谏'],
    importance: 'major',
    contradictionHint: '陆抗的职务、战绩和去世时间以本局为准，不得因历史名望自动取得军权。',
  }),
  contextCard({
    id: 'tk3k_sunhao_264_280',
    kind: 'personTimeline',
    title: '孙皓统治与吴国终局',
    summary: '孙皓在孙休死后被迎立，初期曾施惠政，随后因猜忌、刑罚、迁都与重役广受批评；但吴国仍有军镇、官僚和长江防线运作。不能把其十八年统治压缩成“暴君即刻亡国”。',
    start: '公元264年',
    end: '公元280年',
    relatedNpcNames: ['孙皓', '孙休', '陆抗', '丁奉'],
    relatedPlaceIds: ['region_yangzhou', 'region_jingzhou'],
    relatedTags: ['孙皓', '吴末', '建业', '武昌', '晋吴对峙'],
    importance: 'major',
    contradictionHint: '孙皓是否即位、治理风格和吴国存续必须以本局人物与政权状态为准。',
  }),
  contextCard({
    id: 'tk3k_faction_wei_to_jin_transition',
    kind: 'faction',
    title: '曹魏到西晋的权力转移',
    summary: '249—265 年的曹魏仍保留皇帝、百官和国家名义，但军政实权逐步集中于司马氏。高平陵、淮南三叛、皇帝废立、灭蜀和晋王封爵是连续过程；不能把曹魏在 249 年后直接改名为西晋。',
    start: '公元249年',
    end: '公元266年',
    relatedNpcNames: ['曹芳', '曹髦', '曹奂', '司马懿', '司马师', '司马昭', '司马炎'],
    relatedPlaceIds: ['loc_sili_henan', 'region_yangzhou'],
    relatedTags: ['曹魏', '司马氏', '实际控制者', '晋代魏'],
    importance: 'major',
    contradictionHint: '势力名称、法统与实际控制者必须分栏读取本局账本，不得按年份自动切换。',
  }),
  contextCard({
    id: 'tk3k_faction_late_wu_structure',
    kind: 'faction',
    title: '孙权以后东吴的多次权力重组',
    summary: '孙权死后，东吴先后经历诸葛恪、孙峻、孙綝等辅政权臣与孙亮、孙休、孙皓三朝，宫廷控制者多次更换；与此同时荆州军镇、江东大族和宗室仍各有力量，不能把吴末视为单一中央状态。',
    start: '公元252年',
    end: '公元280年',
    relatedNpcNames: ['孙亮', '孙休', '孙皓', '诸葛恪', '孙峻', '孙綝', '陆抗'],
    relatedPlaceIds: ['region_yangzhou', 'region_jingzhou'],
    relatedTags: ['吴国继承', '辅政权臣', '江东大族', '荆州军镇'],
    importance: 'major',
    contradictionHint: '东吴各阶段君主、辅政者和军镇归属必须依本局势力账本，不得按史实时间自动替换。',
  }),
];

export const THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_CARDS: WorldlineKnowledgeCard[] = [
  ...THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_MAJOR_EVENTS,
  ...THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_SYSTEM_SOCIAL,
  ...THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_3_ENDINGS,
];
