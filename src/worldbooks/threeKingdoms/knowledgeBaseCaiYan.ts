import type { WorldlineKnowledgeCard } from '../../engine/types';

const CAI_YAN_SOURCE_LABEL = '《后汉书·列女传·董祀妻》及相关研究；生年采用公元174年推定';

/**
 * 蔡琰人物资料卡。
 *
 * 174 年是本资料库采用的历史推定年；史料没有留下月日。运行态若需要
 * 完整 birthDate，只能把月日视作本局固定设定，不能反向宣称为史实。
 */
export const THREE_KINGDOMS_KNOWLEDGE_BASE_CAI_YAN: WorldlineKnowledgeCard[] = [
  {
    id: 'tk3k_caiyan_early_174_194',
    worldBookId: 'threeKingdoms',
    kind: 'personTimeline',
    title: '蔡琰早年与蔡邕家学',
    summary: '蔡琰，陈留圉人，蔡邕之女，名琰，字文姬（又见昭姬）。本资料库采用公元174年为出生年；史料不载月日，运行时月日只能作为本局固定设定。她承蔡邕家学，通文辞音律，初嫁河东卫仲道，夫亡无子后归宁。',
    timeRange: { start: '公元174年', end: '公元194年' },
    relatedNpcNames: ['蔡琰', '蔡文姬', '蔡昭姬', '蔡邕', '卫仲道'],
    relatedFactionIds: ['faction_gentry_clan'],
    relatedPlaceIds: ['loc_yanzhou_chenliu', 'region_yanzhou'],
    relatedTags: ['蔡琰', '蔡文姬', '蔡邕家学', '公元174年生', '陈留圉', '卫仲道'],
    importance: 'major',
    strictness: 'default',
    contradictionHint: '出生年不随剧情改写；史料未载的月日若已在本局建档，应保持稳定但不得标成史实。婚姻和去向若被玩家干预，以本局为准。',
    sourceLabel: CAI_YAN_SOURCE_LABEL,
  },
  {
    id: 'tk3k_caiyan_xiongnu_194_207',
    worldBookId: 'threeKingdoms',
    kind: 'personTimeline',
    title: '蔡琰兴平被掳与十二年胡中经历',
    summary: '兴平年间天下丧乱，蔡琰被胡骑掳走，没于南匈奴左贤王，在胡中十二年并生二子。这段经历源于战乱与强制离散，不应写成她主动投奔匈奴、代表某一政治势力，或轻易抹去其与原生家庭和子女的牵连。',
    timeRange: { start: '公元194年', end: '公元207年' },
    relatedNpcNames: ['蔡琰', '蔡文姬', '蔡昭姬', '蔡邕'],
    relatedFactionIds: [],
    relatedPlaceIds: ['region_bingzhou', 'region_yanzhou'],
    relatedTags: ['蔡琰', '兴平丧乱', '南匈奴', '左贤王', '胡中十二年', '二子'],
    importance: 'major',
    strictness: 'default',
    contradictionHint: '若本局提前阻止被掳、改变匈奴关系或改变蔡琰去向，不得强制复刻十二年经历；未被改写时才作为人物轨迹惯性。',
    sourceLabel: CAI_YAN_SOURCE_LABEL,
  },
  {
    id: 'tk3k_caiyan_return_after_207',
    worldBookId: 'threeKingdoms',
    kind: 'personTimeline',
    title: '蔡琰归汉、再嫁董祀与典籍记忆',
    summary: '约建安十二年，曹操念及与蔡邕旧交，以金璧赎蔡琰归汉，后使其再嫁陈留董祀。董祀犯法当死时，蔡琰曾亲赴曹操处求情使其获免。她还能凭记忆默写蔡邕旧藏约四百篇，体现的是家学、记忆与文献传承，不是军政权力。',
    timeRange: { start: '公元207年', end: '公元220年' },
    relatedNpcNames: ['蔡琰', '蔡文姬', '蔡昭姬', '蔡邕', '曹操', '董祀'],
    relatedFactionIds: [],
    relatedPlaceIds: ['loc_yanzhou_chenliu', 'region_yanzhou'],
    relatedTags: ['蔡琰归汉', '曹操赎归', '董祀', '四百篇', '典籍传承'],
    importance: 'major',
    strictness: 'default',
    contradictionHint: '赎归、婚姻、董祀案件及文献保存均须服从本局人物关系与事件结果；不得因历史名望自动赋予蔡琰官职、兵权或超常能力。',
    sourceLabel: CAI_YAN_SOURCE_LABEL,
  },
  {
    id: 'tk3k_caiyan_writings_boundary',
    worldBookId: 'threeKingdoms',
    kind: 'customRule',
    title: '蔡琰作品与后世叙事边界',
    summary: '《后汉书》收录并归于蔡琰的《悲愤诗》是理解其乱离经历的重要文本；《胡笳十八拍》虽长期题为蔡琰所作，作者归属仍有争议。不得把后世戏曲、绘画和文学改编中的全部细节当成本局不可改变的史实。',
    timeRange: { start: '公元194年', end: '公元220年' },
    relatedNpcNames: ['蔡琰', '蔡文姬', '蔡昭姬'],
    relatedFactionIds: [],
    relatedPlaceIds: ['region_yanzhou', 'region_bingzhou'],
    relatedTags: ['悲愤诗', '胡笳十八拍', '作品归属', '史实纠偏', '文姬归汉'],
    importance: 'normal',
    strictness: 'default',
    contradictionHint: '作品归属与后世改编应保留史料不确定性；正文可引用文化意象，但不能据此强制蔡琰经历固定桥段。',
    sourceLabel: CAI_YAN_SOURCE_LABEL,
  },
];
