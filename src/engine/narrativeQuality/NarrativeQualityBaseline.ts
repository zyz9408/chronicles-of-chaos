export type NarrativeQualityDimensionId =
  | 'characterDistinctiveness'
  | 'languageNaturalness'
  | 'narrativeMomentum'
  | 'factConsistency';

export type NarrativeQualityScore = 0 | 1 | 2;

export type NarrativeQualitySceneType =
  | 'negotiation'
  | 'militaryCouncil'
  | 'everyday'
  | 'crisis'
  | 'afterBattle'
  | 'privateRelationship';

export interface NarrativeQualityHistoricalNpcAnchor {
  name: string;
  role: string;
  stableFactAnchors: string[];
  decisionBias: string;
  boundary: string;
  knowledgeBoundary: string;
}

export interface NarrativeQualityEvaluationCase {
  id: string;
  sceneType: NarrativeQualitySceneType;
  currentDate: string;
  location: string;
  playerAction: string;
  situation: string;
  npc: NarrativeQualityHistoricalNpcAnchor;
  structuredSourceIds: string[];
  recentNarrativePatternRisks: string[];
  mustPreserve: string[];
  mustNotInvent: string[];
}

export interface NarrativeQualitySupplyCase {
  id: 'sufficient' | 'mixedProvision' | 'shortage';
  availableGrainStone: number;
  monthlyRequiredGrainStone: number;
  superiorProvisionGrainStone: number;
  playerBurdenGrainStone: number;
  shortageGrainStone: number;
  sustainableMonths: number;
}

export interface NarrativeQualityDimensionBaseline {
  id: NarrativeQualityDimensionId;
  score: NarrativeQualityScore;
  evidence: string;
  acceptanceTarget: string;
}

export const NARRATIVE_QUALITY_DIMENSIONS: readonly NarrativeQualityDimensionId[] = [
  'characterDistinctiveness',
  'languageNaturalness',
  'narrativeMomentum',
  'factConsistency',
];

export const NARRATIVE_QUALITY_BASELINE_CASES: readonly NarrativeQualityEvaluationCase[] = [
  {
    id: 'cao_cao_early_office_negotiation',
    sceneType: 'negotiation',
    currentDate: '公元189年08月25日 10:00（巳时）',
    location: '司隶 - 河南尹 - 洛阳城 - 西园军署',
    playerAction: '向曹操陈述京师兵变风险，请他支持提前封闭宫门。',
    situation: '宦官与外戚冲突加剧，但兵变尚未公开发生。',
    npc: {
      name: '曹操',
      role: '西园八校尉之一、仍处汉末官场网络中的汉臣',
      stableFactAnchors: ['早期执法严厉', '重视现实可行性', '尚未拥有后期完整班底'],
      decisionBias: '先追问兵权、名义和执行链，不因一句忠义口号立即下注。',
      boundary: '不得提前写成已经掌握北方的魏王式人物。',
      knowledgeBoundary: '只知道当前京师可接触的军政消息，不预知后世结果。',
    },
    structuredSourceIds: ['tk_caocao_184_190', 'tk3k_cao_cao_early_career'],
    recentNarrativePatternRisks: ['连续用“目光一沉”起句', '先复述玩家方案再给结论'],
    mustPreserve: ['本局职位和关系优先于史实惯性', '关键封门决定仍由玩家承担'],
    mustNotInvent: ['夏侯惇、荀彧等人已经在场听命', '曹操预知董卓必然入京'],
  },
  {
    id: 'sun_jian_after_battle_supply',
    sceneType: 'afterBattle',
    currentDate: '公元190年02月12日 17:30（酉时）',
    location: '司隶 - 河南尹 - 梁县 - 前军营地',
    playerAction: '询问孙坚是继续追击，还是先处理伤兵与粮道。',
    situation: '前军刚取得局部胜利，粮道却受到盟军内部掣肘。',
    npc: {
      name: '孙坚',
      role: '讨董联军中战功突出的前线将领、名义上受袁术节制',
      stableFactAnchors: ['行动果断', '重视战机', '受制于袁术粮草供应'],
      decisionBias: '倾向抓住战机，但会把伤兵、粮道和军令归属作为现实代价。',
      boundary: '不得提前写成完全独立的江东之主。',
      knowledgeBoundary: '能够判断本部军情，不知道盟军各营未送达的秘密决议。',
    },
    structuredSourceIds: ['tk3k_sunjian_campaign'],
    recentNarrativePatternRisks: ['战后人物轮流豪言', '用风、旗、血腥味机械建立场景'],
    mustPreserve: ['局部胜利已经发生', '追击是尚未作出的新决定'],
    mustNotInvent: ['袁术已明确断粮', '玩家已经答应追击'],
  },
  {
    id: 'lv_bu_loyalty_crisis',
    sceneType: 'crisis',
    currentDate: '公元189年09月03日 22:00（亥时）',
    location: '司隶 - 河南尹 - 洛阳城 - 北军驻地',
    playerAction: '把一封来源不明的招揽信交给吕布，观察他的反应。',
    situation: '吕布仍在强势上级麾下，招揽信可能是试探或离间。',
    npc: {
      name: '吕布',
      role: '并州出身、以勇武闻名但政治归属尚不稳定的将领',
      stableFactAnchors: ['重视个人待遇与安全', '骁勇自负', '政治判断受眼前权势影响'],
      decisionBias: '先判断来信能否改善自身处境，也会警惕这是上级设下的试探。',
      boundary: '不得把勇武简单写成无脑冲动，也不得提前写成独立诸侯。',
      knowledgeBoundary: '不知道写信者未在信中透露的真实目的。',
    },
    structuredSourceIds: ['tk3k_lubu_189_190'],
    recentNarrativePatternRisks: ['每次都以大笑和拍案表现豪勇', '直接旁白解释“他很有野心”'],
    mustPreserve: ['信件来源不明', '吕布尚未接受招揽'],
    mustNotInvent: ['招揽者身份已经确认', '吕布当场背叛'],
  },
  {
    id: 'liu_biao_gentry_council',
    sceneType: 'militaryCouncil',
    currentDate: '公元190年04月06日 09:30（巳时）',
    location: '荆州 - 南郡 - 襄阳城 - 官署',
    playerAction: '建议刘表立即强征豪族私兵，清剿城外宗贼。',
    situation: '刘表初入荆州，需要地方豪族协助才能建立秩序。',
    npc: {
      name: '刘表',
      role: '汉室宗亲、新近进入荆州并依靠地方豪族立足的州牧',
      stableFactAnchors: ['重视名分', '依赖地方合作', '先求稳固秩序'],
      decisionBias: '会权衡清剿收益与激怒蒯、蔡等地方网络的政治代价。',
      boundary: '不得写成已经完全控制荆襄多年的守成之主。',
      knowledgeBoundary: '知道官署和来报掌握的地方态势，不全知各宗族密议。',
    },
    structuredSourceIds: ['tk3k_liubiao_184_190'],
    recentNarrativePatternRisks: ['所有文官都以抚须沉吟开口', '用“荆州大局”为空泛总结'],
    mustPreserve: ['豪族合作是当前约束', '强征仍只是玩家提议'],
    mustNotInvent: ['地方豪族已经一致反叛', '刘表已经批准全面强征'],
  },
  {
    id: 'xun_yu_evacuation_everyday',
    sceneType: 'everyday',
    currentDate: '公元189年09月18日 15:00（申时）',
    location: '豫州 - 颍川郡 - 颍阴县 - 荀氏别业',
    playerAction: '在族人整理行装时询问荀彧，为何如此急于离开颍川。',
    situation: '迁居准备已经开始，部分族人认为荀彧杞人忧天。',
    npc: {
      name: '荀彧',
      role: '颍川荀氏名士、弃官归乡后预判故土将遭兵灾的人物',
      stableFactAnchors: ['长于判断大势', '承担宗族责任', '此时尚未投曹'],
      decisionBias: '用可验证的道路、兵源和地方秩序变化说服族人，而非只说天命。',
      boundary: '不得让他以曹操谋主身份发言。',
      knowledgeBoundary: '能据局势推断风险，但不能确定未来具体屠戮时间与结果。',
    },
    structuredSourceIds: ['tk3k_xunyu_184_190', 'tk3k_yingchuan_gentry'],
    recentNarrativePatternRisks: ['以茶汤、竹简、衣袖重复制造名士感', '让人物长篇背诵史实'],
    mustPreserve: ['迁居是已经开始的行动', '对灾祸的判断仍是推断'],
    mustNotInvent: ['荀彧已决定投奔曹操', '颍川必在某日被屠'],
  },
  {
    id: 'kong_rong_relief_diplomacy',
    sceneType: 'negotiation',
    currentDate: '公元190年06月11日 13:00（未时）',
    location: '青州 - 北海国 - 都昌县 - 城楼',
    playerAction: '劝孔融减少辞令，直接把仅有的骑兵交给自己突围求援。',
    situation: '城外威胁加重，守军不足；孔融擅长名望与交游但不长于治军。',
    npc: {
      name: '孔融',
      role: '以文名、礼贤和士人网络见长的北海相',
      stableFactAnchors: ['重礼名与声望', '善于借人际网络求援', '军事实务并非长项'],
      decisionBias: '会先考虑使者名分、求援对象与政治信用，再决定是否交出有限兵力。',
      boundary: '不得突然表现成精于野战的军政强人。',
      knowledgeBoundary: '只知道已送达的城防与援军消息。',
    },
    structuredSourceIds: ['tk3k_kongrong_early'],
    recentNarrativePatternRisks: ['用大段典故代替回答', '把“文人”写成迂腐笑料'],
    mustPreserve: ['兵力有限', '突围授权尚未作出'],
    mustNotInvent: ['援军已经答应到来', '玩家已经获得全部骑兵'],
  },
  {
    id: 'empress_he_private_pressure',
    sceneType: 'privateRelationship',
    currentDate: '公元189年08月27日 21:00（亥时）',
    location: '司隶 - 河南尹 - 洛阳城 - 南宫内殿',
    playerAction: '私下提醒何氏，何进召外兵入京可能反过来威胁她与少帝。',
    situation: '外戚、宦官和朝臣的冲突已逼近决裂，私下信任不足。',
    npc: {
      name: '何氏',
      role: '少帝之母、身处外戚与宫廷权力冲突中心的太后',
      stableFactAnchors: ['首先维护少帝与自身地位', '受亲族关系牵制', '对宫廷安全高度敏感'],
      decisionBias: '先判断玩家消息来源和真实站队，不会因亲近语气立刻交出政治决定。',
      boundary: '亲密或私下场景不能抹掉其政治身份与风险意识。',
      knowledgeBoundary: '不知道外军和何进未向她透露的具体部署。',
    },
    structuredSourceIds: ['tk3k_luoyang_189', 'tk3k_hejin_eunuch_conflict'],
    recentNarrativePatternRisks: ['把女性人物只写成惊惧或依附', '用反复的呼吸和目光替代政治判断'],
    mustPreserve: ['玩家只是提出警告', '何氏尚未决定阻止何进'],
    mustNotInvent: ['何进已经发动兵变', '何氏向玩家作出亲密或政治承诺'],
  },
  {
    id: 'yuan_shao_coalition_council',
    sceneType: 'militaryCouncil',
    currentDate: '公元190年01月20日 11:00（午时）',
    location: '冀州 - 渤海郡 - 南皮县 - 中军帐',
    playerAction: '要求袁绍立即确定联军粮道、前锋和违令惩处办法。',
    situation: '关东诸部准备结盟，但盟主权威与各镇私利尚未协调。',
    npc: {
      name: '袁绍',
      role: '京师士族政治网络的重要人物、正在成为关东联络核心',
      stableFactAnchors: ['重视门第与名望', '擅长结交士族', '决策受盟主权威与诸镇关系牵制'],
      decisionBias: '倾向先建立名义共识和各镇责任，再避免过早承担单独失败的代价。',
      boundary: '不得把名望与谨慎简化成每次都优柔寡断。',
      knowledgeBoundary: '不知道各镇未公开的真实兵粮和密约。',
    },
    structuredSourceIds: ['tk_yuanshao_189_190', 'tk3k_coalition_loose_structure'],
    recentNarrativePatternRisks: ['众人依次表态形成会议纪要', '用“各怀鬼胎”替代具体利益分歧'],
    mustPreserve: ['盟约尚未完全落实', '军令制度仍待决定'],
    mustNotInvent: ['各镇已经无条件服从', '玩家被任命为前锋'],
  },
];

export const NARRATIVE_QUALITY_PASSIVE_TURN_SEQUENCE = {
  sourceId: 'matter_refugee_supply_deadline',
  sourceType: 'matter' as const,
  deadlineAt: '公元194年05月12日 12:00（午时）',
  actions: [
    '在营中休整半日。',
    '巡视营门与值夜名册。',
    '询问今日天气与道路情况。',
    '检查马具。',
    '与亲兵一起用饭。',
    '在帐中读旧军报。',
    '去校场看士卒操练。',
    '整理随身物品。',
    '听取营中普通传闻。',
    '继续留在营中等待消息。',
  ],
};

export const NARRATIVE_QUALITY_SUPPLY_CASES: readonly NarrativeQualitySupplyCase[] = [
  {
    id: 'sufficient',
    availableGrainStone: 600,
    monthlyRequiredGrainStone: 120,
    superiorProvisionGrainStone: 0,
    playerBurdenGrainStone: 120,
    shortageGrainStone: 0,
    sustainableMonths: 5,
  },
  {
    id: 'mixedProvision',
    availableGrainStone: 180,
    monthlyRequiredGrainStone: 300,
    superiorProvisionGrainStone: 200,
    playerBurdenGrainStone: 100,
    shortageGrainStone: 0,
    sustainableMonths: 1.8,
  },
  {
    id: 'shortage',
    availableGrainStone: 45,
    monthlyRequiredGrainStone: 180,
    superiorProvisionGrainStone: 60,
    playerBurdenGrainStone: 120,
    shortageGrainStone: 75,
    sustainableMonths: 0.375,
  },
];

export const NARRATIVE_QUALITY_PRE_CHANGE_BASELINE: readonly NarrativeQualityDimensionBaseline[] = [
  {
    id: 'characterDistinctiveness',
    score: 0,
    evidence: '主正文人物投影未稳定包含既有 personality、motivation 与 summary。',
    acceptanceTarget: '固定人物样本平均达到 2 分，且无史实或本局事实冲突。',
  },
  {
    id: 'languageNaturalness',
    score: 0,
    evidence: '通用文风协议固定要求场景、行动、反馈、变化及感官细节，存在结构性重复诱因。',
    acceptanceTarget: '连续五回合不出现相同段落骨架三连，固定样本平均达到 2 分。',
  },
  {
    id: 'narrativeMomentum',
    score: 0,
    evidence: '多个动态投影各自提供候选，但没有统一选择本回合主要压力源。',
    acceptanceTarget: '有效高优先级压力最迟在两个合适回合内被玩家感知，同时不替玩家作决定。',
  },
  {
    id: 'factConsistency',
    score: 1,
    evidence: '结构化写回和本地结算边界可靠，但军需真值尚未投影给叙事。',
    acceptanceTarget: '人物知识、历史阶段和正式军需估计均达到 2 分。',
  },
];

export function validateNarrativeQualityBaseline(): string[] {
  const issues: string[] = [];
  const requiredScenes: readonly NarrativeQualitySceneType[] = [
    'negotiation',
    'militaryCouncil',
    'everyday',
    'crisis',
    'afterBattle',
    'privateRelationship',
  ];
  const ids = new Set(NARRATIVE_QUALITY_BASELINE_CASES.map((entry) => entry.id));
  const names = new Set(NARRATIVE_QUALITY_BASELINE_CASES.map((entry) => entry.npc.name));
  const scenes = new Set(NARRATIVE_QUALITY_BASELINE_CASES.map((entry) => entry.sceneType));

  if (ids.size !== NARRATIVE_QUALITY_BASELINE_CASES.length) issues.push('evaluation case ids must be unique');
  if (names.size < 8) issues.push('at least eight distinct historical NPCs are required');
  for (const scene of requiredScenes) {
    if (!scenes.has(scene)) issues.push(`missing scene type: ${scene}`);
  }
  for (const entry of NARRATIVE_QUALITY_BASELINE_CASES) {
    if (entry.structuredSourceIds.length === 0) issues.push(`${entry.id} has no structured source id`);
    if (entry.npc.stableFactAnchors.length < 2) issues.push(`${entry.id} has too few stable fact anchors`);
    if (entry.mustPreserve.length === 0) issues.push(`${entry.id} has no player/fact boundary`);
    if (entry.mustNotInvent.length === 0) issues.push(`${entry.id} has no invention boundary`);
  }
  if (NARRATIVE_QUALITY_PASSIVE_TURN_SEQUENCE.actions.length !== 10) {
    issues.push('passive-turn sequence must contain exactly ten actions');
  }
  const supplyIds = new Set(NARRATIVE_QUALITY_SUPPLY_CASES.map((entry) => entry.id));
  for (const required of ['sufficient', 'mixedProvision', 'shortage'] as const) {
    if (!supplyIds.has(required)) issues.push(`missing supply case: ${required}`);
  }
  for (const entry of NARRATIVE_QUALITY_SUPPLY_CASES) {
    const expectedShortage = Math.max(0, entry.playerBurdenGrainStone - entry.availableGrainStone);
    if (entry.shortageGrainStone !== expectedShortage) {
      issues.push(`${entry.id} has inconsistent shortage`);
    }
    const expectedMonths = entry.playerBurdenGrainStone > 0
      ? entry.availableGrainStone / entry.playerBurdenGrainStone
      : Number.POSITIVE_INFINITY;
    if (Number.isFinite(expectedMonths) && Math.abs(entry.sustainableMonths - expectedMonths) > 0.000_001) {
      issues.push(`${entry.id} has inconsistent sustainable months`);
    }
  }
  const dimensionIds = new Set(NARRATIVE_QUALITY_PRE_CHANGE_BASELINE.map((entry) => entry.id));
  for (const required of NARRATIVE_QUALITY_DIMENSIONS) {
    if (!dimensionIds.has(required)) issues.push(`missing baseline dimension: ${required}`);
  }

  return issues;
}
