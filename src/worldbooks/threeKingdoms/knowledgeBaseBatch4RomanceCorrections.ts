import type { WorldlineKnowledgeCard } from '../../engine/types';

interface RomanceCorrectionInput {
  id: string;
  title: string;
  summary: string;
  start: string;
  end: string;
  relatedNpcNames: string[];
  relatedPlaceIds: string[];
  relatedTags: string[];
  contradictionHint: string;
}

export interface RomanceCorrectionCatalogEntry {
  id: string;
  label: string;
  aliases: string[];
  correctionCardIds: string[];
}

function romanceCorrectionCard(input: RomanceCorrectionInput): WorldlineKnowledgeCard {
  return {
    id: input.id,
    worldBookId: 'threeKingdoms',
    kind: 'customRule',
    title: input.title,
    summary: input.summary,
    timeRange: { start: input.start, end: input.end },
    relatedNpcNames: input.relatedNpcNames,
    relatedFactionIds: [],
    relatedPlaceIds: input.relatedPlaceIds,
    relatedTags: [...new Set([...input.relatedTags, '演义史实纠偏', '本局事实最高'])],
    importance: 'normal',
    strictness: 'default',
    contradictionHint: `本局边界：${input.contradictionHint}`,
    sourceLabel: '《三国志》《后汉书》《资治通鉴》与《三国演义》对读纠偏',
  };
}

/**
 * KnowledgeBase Batch 4 新增纠偏卡。
 *
 * 已经有充分纠偏内容的典故继续复用生产卡，不在这里复制同一事件。
 * 这些 customRule 卡只在典故、人物或地点与当前上下文相关时参与检索，
 * 不会触发对应情节，也不会修改本局状态。
 */
export const THREE_KINGDOMS_KNOWLEDGE_BASE_BATCH_4_NEW_CORRECTION_CARDS: WorldlineKnowledgeCard[] = [
  romanceCorrectionCard({
    id: 'tk3k_romance_taoyuan_oath_correction',
    title: '“桃园结义”的史实边界',
    summary: '《三国志》记刘备与关羽、张飞寝则同床、恩若兄弟，张飞又以兄事关羽；桃园设誓、同年同月同日死等完整仪式属于文学定型。史实核心是长期亲密追随，不是可强制复演的开局桥段。',
    start: '公元184年',
    end: '公元190年',
    relatedNpcNames: ['刘备', '关羽', '张飞'],
    relatedPlaceIds: ['region_youzhou'],
    relatedTags: ['桃园结义', '桃园三结义', '刘关张结义', '恩若兄弟'],
    contradictionHint: '若本局三人没有相识、关系已经改变或另有结盟过程，不得补写桃园誓盟；若本局确曾正式结义，则以本局记录为准。',
  }),
  romanceCorrectionCard({
    id: 'tk3k_romance_straw_boats_correction',
    title: '“草船借箭”的史实边界',
    summary: '赤壁前孙刘结盟、周瑜统军、黄盖诈降火攻是可确认的历史骨架；诸葛亮限期造箭并以草船向曹营取箭的完整故事属于文学组织，不能据此预设诸葛亮控制东吴军务或必然完成同样奇谋。',
    start: '公元208年',
    end: '公元209年',
    relatedNpcNames: ['诸葛亮', '周瑜', '鲁肃', '曹操', '孙权'],
    relatedPlaceIds: ['region_jingzhou', 'region_yangzhou'],
    relatedTags: ['草船借箭', '借箭', '赤壁奇谋', '赤壁之战'],
    contradictionHint: '若本局出现借船取箭或相似计策，应按当事人、天气、船队和行动结果记录，不得自动套用诸葛亮草船借箭。',
  }),
  romanceCorrectionCard({
    id: 'tk3k_romance_east_wind_correction',
    title: '“借东风”的史实边界',
    summary: '赤壁火攻需要风向、船阵、诈降和水军协同，但诸葛亮设坛作法借来东风是文学神异化描写。史实锚点只能说明火攻条件与周瑜、黄盖的军事组织，不能把天气变化归为诸葛亮法术。',
    start: '公元208年',
    end: '公元209年',
    relatedNpcNames: ['诸葛亮', '周瑜', '黄盖', '曹操'],
    relatedPlaceIds: ['region_jingzhou', 'region_yangzhou'],
    relatedTags: ['借东风', '七星坛', '东南风', '赤壁火攻'],
    contradictionHint: '天气与火攻成败必须服从本局天气、部署和战斗结果；不得为了“借东风”强改天气或强制火攻成功。',
  }),
  romanceCorrectionCard({
    id: 'tk3k_romance_huarong_pass_correction',
    title: '“华容道义释曹操”的史实边界',
    summary: '曹操赤壁败后经华容一带艰难撤退有史实依据；关羽奉诸葛亮之命设伏并因旧义放走曹操，是文学增设的道德戏剧。撤军路线可以检索，关羽守关、军令状与义释结果不能当作既定事实。',
    start: '公元208年',
    end: '公元209年',
    relatedNpcNames: ['曹操', '关羽', '诸葛亮'],
    relatedPlaceIds: ['region_jingzhou'],
    relatedTags: ['华容道', '义释曹操', '关云长义释曹操', '赤壁撤退'],
    contradictionHint: '若本局赤壁胜负、曹操路线或关羽阵营不同，不得安排华容道重演；即使发生拦截，也按本局战斗和人物选择处理。',
  }),
  romanceCorrectionCard({
    id: 'tk3k_romance_single_blade_meeting_correction',
    title: '“单刀赴会”的史实边界',
    summary: '孙刘争夺荆州时，鲁肃与关羽确曾隔兵会谈，史料强调双方各留兵马、将领单刀赴会；文学后来突出关羽只身压服吴将。史实核心是高风险边界谈判，不是关羽单方面震慑东吴的固定胜局。',
    start: '公元215年',
    end: '公元216年',
    relatedNpcNames: ['关羽', '鲁肃', '孙权', '刘备'],
    relatedPlaceIds: ['region_jingzhou'],
    relatedTags: ['单刀赴会', '鲁肃会关羽', '湘水划界', '荆州谈判'],
    contradictionHint: '若本局孙刘边界、关羽鲁肃身份或双方关系已改变，只保留谈判风险，不得强制复制会面、对白或结果。',
  }),
  romanceCorrectionCard({
    id: 'tk3k_romance_bone_scraping_correction',
    title: '“刮骨疗毒”的史实边界',
    summary: '《三国志·关羽传》确记关羽旧箭伤逢阴雨骨痛，医者破臂刮骨，关羽饮酒谈笑自若；本传没有把医者写成华佗，也没有把此事固定为襄樊战后庞德毒箭所致。史实核心与后世拼接应分开。',
    start: '公元200年',
    end: '公元219年',
    relatedNpcNames: ['关羽', '华佗', '庞德'],
    relatedPlaceIds: ['region_jingzhou'],
    relatedTags: ['刮骨疗毒', '刮骨去毒', '华佗刮骨', '关羽箭伤'],
    contradictionHint: '若本局关羽没有相应伤势，不得凭典故补伤或治疗；若确有治疗，医者、时间和伤因以本局记录为准。',
  }),
  romanceCorrectionCard({
    id: 'tk3k_romance_empty_fort_correction',
    title: '“空城计”的史实边界',
    summary: '诸葛亮在西城开门抚琴、以空城惊退司马懿的场面是《三国演义》著名叙事，不见于《三国志·诸葛亮传》的北伐骨架。它可以作为虚张声势的策略意象，但不是 228 年必然发生的历史事件。',
    start: '公元228年',
    end: '公元229年',
    relatedNpcNames: ['诸葛亮', '司马懿'],
    relatedPlaceIds: ['region_liangzhou', 'region_sili'],
    relatedTags: ['空城计', '西城抚琴', '诸葛亮弹琴', '司马懿退兵'],
    contradictionHint: '若本局没有相同城防、统帅和敌情，不得生成空城计；若玩家或 NPC 实际实施类似计谋，则按本局判定结果成立。',
  }),
  romanceCorrectionCard({
    id: 'tk3k_romance_six_qishan_campaigns_correction',
    title: '“六出祁山”的史实边界',
    summary: '诸葛亮北伐包含祁山、陈仓、武都阴平、斜谷与五丈原等不同路线和阶段，并非六次都从祁山出兵。“六出祁山”是后世文学概括，不能据此补足固定次数、路线或必败结局。',
    start: '公元228年',
    end: '公元234年',
    relatedNpcNames: ['诸葛亮', '司马懿', '曹真', '郝昭'],
    relatedPlaceIds: ['region_liangzhou', 'region_sili', 'region_yizhou'],
    relatedTags: ['六出祁山', '诸葛亮北伐', '祁山北伐', '陈仓', '武都阴平', '五丈原'],
    contradictionHint: '北伐次数、路线、对手和结果必须按本局已发生战事统计，不得为凑“六出”新增或重演战役。',
  }),
];

/**
 * Batch 4 有限纠偏清单：15 个高频典故全部映射到唯一生产卡。
 * 其中 7 项复用既有卡，8 项由本批新增。
 */
export const THREE_KINGDOMS_ROMANCE_CORRECTION_CATALOG: RomanceCorrectionCatalogEntry[] = [
  {
    id: 'taoyuan_oath',
    label: '桃园结义',
    aliases: ['桃园三结义', '刘关张结义'],
    correctionCardIds: ['tk3k_romance_taoyuan_oath_correction'],
  },
  {
    id: 'three_heroes_lubu',
    label: '三英战吕布',
    aliases: ['虎牢关三英战吕布'],
    correctionCardIds: ['tk3k_hulao_pass_myth'],
  },
  {
    id: 'warm_wine_huaxiong',
    label: '温酒斩华雄',
    aliases: ['关羽斩华雄'],
    correctionCardIds: ['tk3k_huaxiong_as_corrected'],
  },
  {
    id: 'diaochan_chain',
    label: '貂蝉与连环计',
    aliases: ['貂蝉', '美人连环计'],
    correctionCardIds: ['tk3k_wangyun'],
  },
  {
    id: 'three_offers_xuzhou',
    label: '三让徐州',
    aliases: ['陶谦三让徐州'],
    correctionCardIds: ['tk3k_194_xuzhou_succession'],
  },
  {
    id: 'three_visits',
    label: '三顾茅庐',
    aliases: ['三顾草庐'],
    correctionCardIds: ['tk3k_207_longzhong_correction'],
  },
  {
    id: 'straw_boats',
    label: '草船借箭',
    aliases: ['草船借矢'],
    correctionCardIds: ['tk3k_romance_straw_boats_correction'],
  },
  {
    id: 'east_wind',
    label: '借东风',
    aliases: ['孔明借东风'],
    correctionCardIds: ['tk3k_romance_east_wind_correction'],
  },
  {
    id: 'huarong_pass',
    label: '华容道',
    aliases: ['义释曹操'],
    correctionCardIds: ['tk3k_romance_huarong_pass_correction'],
  },
  {
    id: 'single_blade_meeting',
    label: '单刀赴会',
    aliases: ['关云长单刀赴会'],
    correctionCardIds: ['tk3k_romance_single_blade_meeting_correction'],
  },
  {
    id: 'bone_scraping',
    label: '刮骨疗毒',
    aliases: ['刮骨去毒'],
    correctionCardIds: ['tk3k_romance_bone_scraping_correction'],
  },
  {
    id: 'seven_captures',
    label: '七擒孟获',
    aliases: ['七擒七纵'],
    correctionCardIds: ['tk3k_225_nanzhong_correction'],
  },
  {
    id: 'empty_fort',
    label: '空城计',
    aliases: ['西城抚琴'],
    correctionCardIds: ['tk3k_romance_empty_fort_correction'],
  },
  {
    id: 'six_qishan_campaigns',
    label: '六出祁山',
    aliases: ['孔明六出祁山'],
    correctionCardIds: ['tk3k_romance_six_qishan_campaigns_correction'],
  },
  {
    id: 'dead_zhuge',
    label: '死诸葛走生仲达',
    aliases: ['死诸葛吓走活仲达'],
    correctionCardIds: ['tk3k_234_wuzhangyuan_correction'],
  },
];
