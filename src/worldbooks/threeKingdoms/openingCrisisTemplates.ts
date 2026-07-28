import type { OpeningCrisisTemplate } from '../../engine/types';

/**
 * 三国开局危机模板
 * 184 黄巾初起：至少 5 个
 * 190 关东讨董：2-3 个
 * 200 官渡前夜：2-3 个
 */
export const threeKingdomsOpeningCrisisTemplates: OpeningCrisisTemplate[] = [
  // ===== 184 黄巾初起 =====
  {
    id: 'crisis_184_conscription',
    label: '官府征发壮丁',
    applicableBookmarkIds: ['bookmark_184_yellow_turban'],
    applicableRegionIds: ['loc_yingchuan', 'loc_runan', 'loc_nanyang'],
    applicableOrigins: ['寒门士子', '县中小吏', '流民', '豪族旁支'],
    crisisSummary: '黄巾乱起，郡府紧急征发壮丁编入乡勇。你家在征发之列，若不去则获罪于官府，若去则九死一生。',
    firstSceneHint: '一大早，里正带着两个衙役敲开了你家门。一张征发令摊在桌上，上面赫然有你的名字。',
    riskLevel: 'high',
  },
  {
    id: 'crisis_184_yellow_turban_rumor',
    label: '乡里黄巾传闻',
    applicableBookmarkIds: ['bookmark_184_yellow_turban'],
    applicableRegionIds: ['loc_yingchuan', 'loc_runan'],
    applicableOrigins: ['寒门士子', '县中小吏', '豪族旁支', '流民', '黄巾信众'],
    crisisSummary: '乡间传闻太平道已在邻县聚众数千，不日将攻打郡城。人心惶惶，有人主张逃难，有人主张投靠，有人主张守城。',
    firstSceneHint: '今日市集上，人人面色凝重。一个从邻县逃来的商人说，太平道的法师已在那里聚众数千，打出黄旗，自称天公将军部属。',
    riskLevel: 'high',
  },
  {
    id: 'crisis_184_gentry_isolation',
    label: '豪族闭门自保',
    applicableBookmarkIds: ['bookmark_184_yellow_turban'],
    applicableRegionIds: ['loc_yingchuan'],
    applicableOrigins: ['寒门士子', '豪族旁支', '游侠'],
    crisisSummary: '颍川各大豪族纷纷收缩势力，加固庄园，召回城外族人。原本倚仗的关系网络突然收紧，你发现自己被挡在了门外。',
    firstSceneHint: '你来到荀氏庄园门前，却见大门紧闭，家丁全副武装守在墙头。门上贴着一张告示：时局不靖，暂不待客。',
    riskLevel: 'medium',
  },
  {
    id: 'crisis_184_road_danger',
    label: '道路不靖',
    applicableBookmarkIds: ['bookmark_184_yellow_turban'],
    applicableRegionIds: ['loc_yingchuan', 'loc_runan', 'loc_nanyang'],
    applicableOrigins: ['寒门士子', '游侠', '流民', '县中小吏'],
    crisisSummary: '驿道连日发生劫案，商旅断绝。你要么冒险出行，要么困守原地。每条路都有各自的危险。',
    firstSceneHint: '驿道旁的茶摊已多日没有客人。摊主告诉你，前面十里坡昨日又有商队被劫，死了三个人。官差至今没抓到人。',
    riskLevel: 'medium',
  },
  {
    id: 'crisis_184_food_shortage',
    label: '家中粮米将尽',
    applicableBookmarkIds: ['bookmark_184_yellow_turban'],
    applicableRegionIds: ['loc_yingchuan', 'loc_runan', 'loc_nanyang'],
    applicableOrigins: ['寒门士子', '流民', '县中小吏'],
    crisisSummary: '战乱导致粮道不畅，市集粮价飞涨。你家存粮仅够三五日光景，必须尽快想办法。',
    firstSceneHint: '你翻了翻米缸，见底的粮食最多还能撑三天。昨日市集上，一石米已经涨到了往常的五倍价钱。',
    riskLevel: 'high',
  },

  // ===== 190 关东讨董 =====
  {
    id: 'crisis_190_ally_recruitment',
    label: '诸侯募兵',
    applicableBookmarkIds: ['bookmark_190_anti_dong'],
    applicableRegionIds: ['loc_yingchuan', 'loc_runan', 'loc_nanyang'],
    applicableOrigins: ['寒门士子', '游侠', '流民', '豪族旁支'],
    crisisSummary: '关东联军在各地张榜募兵，军中急需文士和勇士。从军或可出人头地，但也可能成为诸侯博弈的棋子。',
    firstSceneHint: '城门口张贴着募兵告示，几个军士正在登记应募者。旁边一个文士模样的人被请进了衙门——据说是在找能写檄文的人。',
    riskLevel: 'medium',
  },
  {
    id: 'crisis_190_faction_choice',
    label: '站队之难',
    applicableBookmarkIds: ['bookmark_190_anti_dong'],
    applicableRegionIds: ['loc_yingchuan', 'loc_runan'],
    applicableOrigins: ['寒门士子', '豪族旁支', '县中小吏'],
    crisisSummary: '联军内部暗流涌动，各路诸侯明争暗斗。有人来拉拢你（或你所在家族），表态站队已刻不容缓。',
    firstSceneHint: '今日先后有两拨人登门。一边是袁绍的使者，许诺厚禄；一边是曹操的故交，晓以大义。两边都在等你回话。',
    riskLevel: 'medium',
  },

  // ===== 200 官渡前夜 =====
  {
    id: 'crisis_200_scout_danger',
    label: '兵临城下之兆',
    applicableBookmarkIds: ['bookmark_200_guandu'],
    applicableRegionIds: ['loc_yingchuan', 'loc_runan'],
    applicableOrigins: ['寒门士子', '县中小吏', '豪族旁支', '游侠', '流民'],
    crisisSummary: '袁曹两军对峙，豫州一带风声鹤唳。斥候四出，百姓惊惧。你所在之地随时可能成为战场。',
    firstSceneHint: '清晨城外隐隐传来马蹄声。登上城头望去，远处烟尘滚滚。守城的军士面色凝重："是袁军的斥候，他们已经到三十里外了。"',
    riskLevel: 'high',
  },
  {
    id: 'crisis_200_refugee_wave',
    label: '难民潮',
    applicableBookmarkIds: ['bookmark_200_guandu'],
    applicableRegionIds: ['loc_yingchuan', 'loc_runan', 'loc_nanyang'],
    applicableOrigins: ['寒门士子', '县中小吏', '豪族旁支', '游侠', '流民'],
    crisisSummary: '北方战火逼近，大批难民涌入。城中秩序开始崩坏，粮食物资紧缺。你需要决定是留下帮忙维持秩序，还是趁早离开。',
    firstSceneHint: '城门口已经堵了一整天。拖家带口的难民排成长队，守城的兵士拦不住也放不完。一个老丈拉住你的袖子："好心人，可知道哪里还有容身之处？"',
    riskLevel: 'high',
  },
  {
    id: 'crisis_200_spy_suspicion',
    label: '细作疑云',
    applicableBookmarkIds: ['bookmark_200_guandu'],
    applicableRegionIds: ['loc_yingchuan'],
    applicableOrigins: ['寒门士子', '游侠', '县中小吏'],
    crisisSummary: '城中传出消息，袁军细作已潜入，正在收买官员、散布谣言。一时间人人自危，相互猜忌。有人怀疑到了你头上。',
    firstSceneHint: '今日在茶肆，你注意到了几个生面孔。他们操着河北口音，打听城防布置。你刚想离开，其中一人却叫住了你，说有一桩买卖想与你谈谈。',
    riskLevel: 'medium',
  },
];
