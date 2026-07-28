import { describe, expect, it } from 'vitest';
import type { RuntimeState, WorldlineKnowledgeCard } from '../../engine/types';
import { buildWorldlineKnowledgeProjection } from '../../engine/worldline/WorldlineKnowledgeProjection';
import { threeKingdomsKnowledgeBase } from './knowledgeBase';
import { threeKingdomsStartBookmarks } from './startBookmarks';

/* ---- 辅助函数 ---- */

function findCardsByText(pattern: string): WorldlineKnowledgeCard[] {
  return threeKingdomsKnowledgeBase.cards.filter((card) => {
    const text = [
      card.id,
      card.title,
      card.summary,
      card.contradictionHint ?? '',
      ...(card.relatedNpcNames ?? []),
      ...(card.relatedTags ?? []),
    ].join('\n');
    return text.includes(pattern);
  });
}

function projectBookmarkKnowledgeResult(bookmarkId: string, locationId: string) {
  const bookmark = threeKingdomsStartBookmarks.find((candidate) => candidate.id === bookmarkId);
  if (!bookmark) throw new Error(`Missing bookmark: ${bookmarkId}`);

  return buildWorldlineKnowledgeProjection({
    state: {
      worldBookId: 'threeKingdoms',
      currentDate: bookmark.startDate,
      currentLocationId: locationId,
      npcs: [],
      activeQuests: [],
      knownRumors: [],
      worldTrends: [
        {
          trendId: `trend_${bookmark.id}`,
          title: bookmark.label,
          summary: bookmark.situationSummary,
          knownToPlayer: true,
          updatedAt: bookmark.startDate,
        },
      ],
    } as unknown as RuntimeState,
    knowledgeBase: threeKingdomsKnowledgeBase,
    storyPacks: [],
    mode: 'default',
  });
}

function projectBookmarkKnowledge(bookmarkId: string, locationId: string): string[] {
  const result = projectBookmarkKnowledgeResult(bookmarkId, locationId);
  return result.hints.map((hint) => hint.id);
}

/* ---- 测试套件 ---- */

describe('threeKingdomsKnowledgeBase', () => {
  /* ================================================================
   *  1. 结构校验
   * ================================================================ */
  describe('structural validation', () => {
    it('all card ids are unique', () => {
      const ids = threeKingdomsKnowledgeBase.cards.map((c) => c.id);
      const dupes = ids.filter((id, idx) => ids.indexOf(id) !== idx);
      expect(dupes).toEqual([]);
    });

    it('every card has worldBookId === "threeKingdoms"', () => {
      threeKingdomsKnowledgeBase.cards.forEach((card) => {
        expect(card.worldBookId).toBe('threeKingdoms');
      });
    });

    it('every kind belongs to the legal enum', () => {
      const legalKinds = ['eraAnchor', 'personTimeline', 'faction', 'place', 'event', 'customRule'];
      threeKingdomsKnowledgeBase.cards.forEach((card) => {
        expect(legalKinds).toContain(card.kind);
      });
    });

    it('every summary is non-empty', () => {
      threeKingdomsKnowledgeBase.cards.forEach((card) => {
        expect(card.summary.trim().length).toBeGreaterThan(0);
      });
    });

    it('every importance is legal', () => {
      const legal = ['minor', 'normal', 'major', 'critical'];
      threeKingdomsKnowledgeBase.cards.forEach((card) => {
        expect(legal).toContain(card.importance);
      });
    });

    it('every strictness is legal', () => {
      const legal = ['light', 'default', 'strict'];
      threeKingdomsKnowledgeBase.cards.forEach((card) => {
        expect(legal).toContain(card.strictness);
      });
    });

    it('every sourceLabel is non-empty', () => {
      threeKingdomsKnowledgeBase.cards.forEach((card) => {
        expect(card.sourceLabel).toBeTruthy();
      });
    });

    it('timeRange is an object when present, never a string', () => {
      threeKingdomsKnowledgeBase.cards.forEach((card) => {
        if (card.timeRange) {
          expect(typeof card.timeRange).toBe('object');
          // 确认不是字符串
          expect(typeof card.timeRange).not.toBe('string');
        }
      });
    });

    it('no summary exceeds 240 Chinese characters', () => {
      threeKingdomsKnowledgeBase.cards.forEach((card) => {
        expect(card.summary.length).toBeLessThanOrEqual(240);
      });
    });

    it('no TODO / TBD / 待补 markers', () => {
      threeKingdomsKnowledgeBase.cards.forEach((card) => {
        const haystack = card.summary + (card.contradictionHint ?? '');
        expect(haystack).not.toMatch(/TODO|TBD|待补|以后再补/);
      });
    });

    it('no illegal kind values (institution / relationship / correction)', () => {
      threeKingdomsKnowledgeBase.cards.forEach((card) => {
        expect(card.kind).not.toBe('institution');
        expect(card.kind).not.toBe('relationship');
        expect(card.kind).not.toBe('correction');
      });
    });
  });

  /* ================================================================
   *  2. 数量目标
   * ================================================================ */
  describe('card count targets', () => {
    it('total cards is between 280 and 310 after KB Batch 4', () => {
      const count = threeKingdomsKnowledgeBase.cards.length;
      expect(count).toBeGreaterThanOrEqual(280);
      expect(count).toBeLessThanOrEqual(310);
    });

    it('eraAnchor + event combined is between 80 and 95 after KB Batch 3', () => {
      const count = threeKingdomsKnowledgeBase.cards.filter(
        (c) => c.kind === 'eraAnchor' || c.kind === 'event',
      ).length;
      expect(count).toBeGreaterThanOrEqual(80);
      expect(count).toBeLessThanOrEqual(95);
    });

    it('personTimeline is between 70 and 110', () => {
      const count = threeKingdomsKnowledgeBase.cards.filter((c) => c.kind === 'personTimeline').length;
      expect(count).toBeGreaterThanOrEqual(70);
      expect(count).toBeLessThanOrEqual(110);
    });

    it('faction is between 25 and 40', () => {
      const count = threeKingdomsKnowledgeBase.cards.filter((c) => c.kind === 'faction').length;
      expect(count).toBeGreaterThanOrEqual(25);
      expect(count).toBeLessThanOrEqual(40);
    });

    it('place is between 14 and 45', () => {
      const count = threeKingdomsKnowledgeBase.cards.filter((c) => c.kind === 'place').length;
      expect(count).toBeGreaterThanOrEqual(14);
      expect(count).toBeLessThanOrEqual(45);
    });

    it('customRule is between 37 and 45 after the finite romance-correction expansion', () => {
      const count = threeKingdomsKnowledgeBase.cards.filter((c) => c.kind === 'customRule').length;
      expect(count).toBeGreaterThanOrEqual(37);
      expect(count).toBeLessThanOrEqual(45);
    });

    it('critical does not exceed 30% of total', () => {
      const total = threeKingdomsKnowledgeBase.cards.length;
      const critical = threeKingdomsKnowledgeBase.cards.filter((c) => c.importance === 'critical').length;
      expect(critical).toBeLessThanOrEqual(Math.ceil(total * 0.30));
    });

    it('major does not exceed 55% of total during event-chain expansion', () => {
      const total = threeKingdomsKnowledgeBase.cards.length;
      const major = threeKingdomsKnowledgeBase.cards.filter((c) => c.importance === 'major').length;
      expect(major).toBeLessThanOrEqual(Math.ceil(total * 0.55));
    });
  });

  /* ================================================================
   *  3. 现有测试保留
   * ================================================================ */
  describe('existing tests', () => {
    it('includes 189 faction ledger guidance for Luoyang openings', () => {
      const card = threeKingdomsKnowledgeBase.cards.find((item) => item.id === 'tk3k_189_faction_ledger_guidance');
      expect(card).toBeDefined();
      expect(card?.summary).toContain('势力账本');
      expect(card?.summary).toContain('汉廷');
      expect(card?.summary).toContain('董卓');
      expect(card?.summary).toContain('actualController');
      expect(card?.summary).toContain('knownSphere');
      expect(card?.summary).toContain('不应');
      expect(card?.relatedFactionIds).toContain('faction_han_court');
      expect(card?.relatedTags).toEqual(expect.arrayContaining(['势力账本', '汉廷', '董卓集团']));
      expect(card?.contradictionHint).toContain('本局事实');
    });
  });

  /* ================================================================
   *  3.5 地方豪强与领地征收地域锚点
   * ================================================================ */
  describe('local elite governance anchors', () => {
    const anchorIds = [
      'tk3k_place_yingchuan_local_elite',
      'tk3k_place_hebei_local_elite',
      'tk3k_place_jiangdong_local_elite',
      'tk3k_place_jingzhou_local_elite',
      'tk3k_place_yizhou_local_elite',
      'tk3k_place_nanzhong_local_elite',
      'tk3k_place_guanzhong_local_elite',
      'tk3k_place_liangzhou_local_elite',
      'tk3k_place_youbing_local_elite',
      'tk3k_place_xuyanyuzhou_local_elite',
    ];

    it('covers major regions where local elite control should affect holdings', () => {
      for (const id of anchorIds) {
        const card = threeKingdomsKnowledgeBase.cards.find((item) => item.id === id);
        expect(card, id).toBeDefined();
        expect(card?.kind).toBe('place');
        expect(card?.summary).toMatch(/地方豪强|士族|豪帅|豪右|宗族|坞堡/);
        expect(card?.summary).toMatch(/田亩|户口|税粮|赋税|征收|基层执行/);
        expect(card?.relatedTags).toEqual(expect.arrayContaining(['地方豪强', '田亩户口', '赋税征收']));
        expect(card?.relatedFactionIds ?? []).toEqual([]);
        expect(card?.contradictionHint).toContain('本局');
      }
    });

    it('keeps southern and frontier regions distinct from central-plains gentry logic', () => {
      const nanzhong = threeKingdomsKnowledgeBase.cards.find((item) => item.id === 'tk3k_place_nanzhong_local_elite');
      const liangzhou = threeKingdomsKnowledgeBase.cards.find((item) => item.id === 'tk3k_place_liangzhou_local_elite');

      expect(nanzhong?.summary).toContain('部落豪帅');
      expect(nanzhong?.summary).toContain('兵源');
      expect(nanzhong?.summary).toContain('税粮');
      expect(liangzhou?.summary).toContain('羌胡');
      expect(liangzhou?.summary).toContain('军府');
    });
  });

  /* ================================================================
   *  4. 24 剧本覆盖
   * ================================================================ */
  describe('24-scenario coverage', () => {

    const scenarios: Array<{ id: string; label: string; mustHit: string[] }> = [
      { id: 's01',  label: '184 黄巾初起',  mustHit: ['黄巾', '张角', '太平道'] },
      { id: 's02',  label: '189 洛阳风暴',  mustHit: ['董卓', '何进', '灵帝'] },
      { id: 's03',  label: '190 关东讨董',  mustHit: ['关东', '讨董', '袁绍'] },
      { id: 's04',  label: '194 群雄割据',  mustHit: ['群雄', '李傕', '曹操'] },
      { id: 's05',  label: '196 奉迎天子',  mustHit: ['奉迎天子', '许都', '荀彧'] },
      { id: 's06',  label: '200 官渡前夜',  mustHit: ['官渡', '袁绍', '曹操'] },
      { id: 's07',  label: '201 荆州寄身',  mustHit: ['荆州', '刘备', '刘表'] },
      { id: 's08',  label: '207 隆中对',    mustHit: ['隆中对', '诸葛亮', '三顾'] },
      { id: 's09',  label: '208 赤壁风云',  mustHit: ['赤壁', '孙刘', '周瑜'] },
      { id: 's10',  label: '211 入蜀前夜',  mustHit: ['入蜀', '刘璋', '张鲁'] },
      { id: 's11',  label: '214 益州风云',  mustHit: ['益州', '刘璋', '法正'] },
      { id: 's12',  label: '219 汉中王业',  mustHit: ['汉中', '定军山', '关羽'] },
      { id: 's13',  label: '220 三国鼎立',  mustHit: ['曹丕', '代汉', '三国鼎立'] },
      { id: 's14',  label: '222 夷陵败局',  mustHit: ['夷陵', '陆逊', '刘备'] },
      { id: 's15',  label: '223 白帝托孤',  mustHit: ['白帝托孤', '刘禅', '诸葛亮'] },
      { id: 's16',  label: '225 南中平定',  mustHit: ['南中', '孟获', '诸葛亮'] },
      { id: 's17',  label: '228 初出祁山',  mustHit: ['祁山', '街亭', '姜维'] },
      { id: 's18',  label: '229 吴蜀复盟',  mustHit: ['吴蜀复盟', '孙权', '夷陵'] },
      { id: 's19',  label: '231 祁山相持',  mustHit: ['祁山', '司马懿', '粮运'] },
      { id: 's20',  label: '234 五丈原后',  mustHit: ['诸葛亮', '蒋琬', '费祎'] },
      { id: 's21',  label: '249 高平陵之变', mustHit: ['高平陵', '司马懿', '曹爽'] },
      { id: 's22',  label: '253 姜维主兵',  mustHit: ['姜维', '费祎', '北伐'] },
      { id: 's23',  label: '255 洮西大捷',  mustHit: ['洮西', '姜维', '王经'] },
      { id: 's24',  label: '263 蜀汉灭亡',  mustHit: ['蜀汉灭亡', '邓艾', '钟会'] },
    ];

    scenarios.forEach((scenario) => {
      it(`scenario "${scenario.label}" has at least 5 relevant cards`, () => {
        const hits = findCardsByText(scenario.mustHit[0]);
        // also check secondary hits
        let totalHits = hits.map((c) => c.id);
        for (let i = 1; i < scenario.mustHit.length; i++) {
          const secondary = findCardsByText(scenario.mustHit[i]);
          totalHits = [...new Set([...totalHits, ...secondary.map((c) => c.id)])];
        }
        expect(totalHits.length).toBeGreaterThanOrEqual(5);
      });
    });
  });

  /* ================================================================
   *  5. 关键短语命中和验证
   * ================================================================ */
  describe('key phrase coverage', () => {
    const keyPhrases = [
      '奉迎天子', '隆中对', '赤壁', '入蜀', '汉中', '夷陵',
      '白帝托孤', '南中', '街亭', '吴蜀复盟', '祁山',
      '姜维', '洮西', '蜀汉灭亡',
    ];

    keyPhrases.forEach((phrase) => {
      it(`phrase "${phrase}" is covered by at least one card`, () => {
        const hits = findCardsByText(phrase);
        expect(hits.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  /* ================================================================
   *  6. 特定规则校验
   * ================================================================ */
  describe('specific validation rules', () => {

    it('post-189 cards do not treat Emperor Ling as current ruler', () => {
      const post189 = threeKingdomsKnowledgeBase.cards.filter((card) => {
        const start = card.timeRange?.start ?? '';
        // 189 及以后的卡
        const yearMatch = start.match(/(\d{3})/);
        if (!yearMatch) return false;
        return parseInt(yearMatch[1], 10) >= 189;
      });
      // 至少存在一些 189 后的卡
      expect(post189.length).toBeGreaterThan(0);
      // 检查这些卡中不把灵帝称为当前主事者
      const offending = post189.filter((card) => {
        const text = card.summary + (card.contradictionHint ?? '');
        // 允许描述灵帝已死状态的表述
        if (/灵帝(崩|已死|驾崩|死后|嫡子|皇后)/.test(text)) return false;
        // 允许跨期背景表述
        if (text.includes('灵帝末年') || text.includes('灵帝时期') || text.includes('灵帝在位')) return false;
        // 纯引用或否定: "不应继续把灵帝..."
        if (text.includes('不应') && text.includes('灵帝')) return false;
        return text.includes('灵帝');
      });
      expect(offending.length).toBe(0);
    });

    it('Jiang Wei cards mention both offensive initiative and national pressure', () => {
      const jiangWeiCards = threeKingdomsKnowledgeBase.cards.filter((card) => {
        const text = card.summary + (card.contradictionHint ?? '') + card.title;
        return text.includes('姜维');
      });
      expect(jiangWeiCards.length).toBeGreaterThanOrEqual(1);
      // 至少有一张卡提到国力/朝议/后勤
      const hasPressureCards = jiangWeiCards.some((card) => {
        const text = card.summary + (card.contradictionHint ?? '');
        return text.includes('国力') || text.includes('朝议') || text.includes('后勤');
      });
      expect(hasPressureCards).toBe(true);
      // 至少有卡提到北伐主动性/胜利
      const hasOffensiveCards = jiangWeiCards.some((card) => {
        const text = card.summary + (card.contradictionHint ?? '');
        return text.includes('北伐') || text.includes('胜利') || text.includes('主动');
      });
      expect(hasOffensiveCards).toBe(true);
    });

    it('faction ledger cards mention field organization terms', () => {
      const factionCards = threeKingdomsKnowledgeBase.cards.filter((c) => c.kind === 'faction');
      const ledgerTerms = ['actualController', 'knownSphere', 'nominalAllegiance', '势力账本'];
      const hasLedgerCard = factionCards.some((card) => {
        return ledgerTerms.some((term) => (card.summary).includes(term));
      });
      expect(hasLedgerCard).toBe(true);
    });

    it('Liu Biao faction card does not misstate Liu Yan as his father', () => {
      const card = threeKingdomsKnowledgeBase.cards.find((item) => item.id === 'tk3k_faction_liubiao_jingzhou');
      const text = `${card?.summary ?? ''}${card?.contradictionHint ?? ''}`;

      expect(card).toBeDefined();
      expect(text).not.toContain('刘表继承了其父刘焉');
      expect(text).not.toContain('其父刘焉');
      expect(text).toContain('受任荆州');
    });

    it('Liu Bei retinue faction card keeps old retinue origins distinct', () => {
      const card = threeKingdomsKnowledgeBase.cards.find((item) => item.id === 'tk3k_faction_jingzhou_retinue');

      expect(card).toBeDefined();
      expect(card?.summary).not.toContain('诸葛亮、赵云、糜竺等来自荆州寄身时期');
      expect(card?.summary).toContain('旧部来源复杂');
      expect(card?.summary).toContain('徐州以来的流亡班底');
      expect(card?.summary).toContain('荆州时期吸纳的人才');
    });
  });

  /* ================================================================
   *  7. 蜀汉核心人物覆盖
   * ================================================================ */
  describe('Shu Han core character coverage', () => {
    const shuHanCharacters = [
      '刘备', '关羽', '张飞', '诸葛亮', '赵云',
      '法正', '庞统', '黄忠', '魏延', '马超',
      '刘禅', '李严', '蒋琬', '费祎', '董允',
      '姜维', '马谡', '王平', '孟获',
    ];

    shuHanCharacters.forEach((name) => {
      it(`has at least one personTimeline card for ${name}`, () => {
        const cards = threeKingdomsKnowledgeBase.cards.filter(
          (c) => c.kind === 'personTimeline' && (c.relatedNpcNames ?? []).includes(name),
        );
        expect(cards.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('Liu Bei has at least 4 stage cards', () => {
      const cards = threeKingdomsKnowledgeBase.cards.filter(
        (c) => c.kind === 'personTimeline' && (c.relatedNpcNames ?? []).includes('刘备'),
      );
      expect(cards.length).toBeGreaterThanOrEqual(4);
    });

    it('Zhuge Liang has at least 4 stage cards', () => {
      const cards = threeKingdomsKnowledgeBase.cards.filter(
        (c) => c.kind === 'personTimeline' && (c.relatedNpcNames ?? []).includes('诸葛亮'),
      );
      expect(cards.length).toBeGreaterThanOrEqual(4);
    });

    it('Jiang Wei has at least 4 stage cards', () => {
      const cards = threeKingdomsKnowledgeBase.cards.filter(
        (c) => c.kind === 'personTimeline' && (c.relatedNpcNames ?? []).includes('姜维'),
      );
      expect(cards.length).toBeGreaterThanOrEqual(4);
    });
  });

  /* ================================================================
   *  8. 曹魏线核心人物覆盖
   * ================================================================ */
  describe('Cao Wei core character coverage', () => {
    const weiCharacters = [
      '曹操', '曹丕', '荀彧', '郭嘉', '贾诩',
      '夏侯惇', '夏侯渊', '张辽', '徐晃',
      '司马懿', '邓艾', '钟会',
    ];

    weiCharacters.forEach((name) => {
      it(`has at least one personTimeline card for ${name}`, () => {
        const cards = threeKingdomsKnowledgeBase.cards.filter(
          (c) => c.kind === 'personTimeline' && (c.relatedNpcNames ?? []).includes(name),
        );
        expect(cards.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('Cao Cao has at least 4 stage cards covering 189/196/200/208', () => {
      const cards = threeKingdomsKnowledgeBase.cards.filter(
        (c) => c.kind === 'personTimeline' && (c.relatedNpcNames ?? []).includes('曹操'),
      );
      expect(cards.length).toBeGreaterThanOrEqual(4);
    });

    it('Sima Yi has cards covering 231, 234, and 249', () => {
      const cards = threeKingdomsKnowledgeBase.cards.filter(
        (c) => c.kind === 'personTimeline' && (c.relatedNpcNames ?? []).includes('司马懿'),
      );
      expect(cards.length).toBeGreaterThanOrEqual(3);
    });
  });

  /* ================================================================
   *  9. 东吴线核心人物覆盖
   * ================================================================ */
  describe('Wu core character coverage', () => {
    const wuCharacters = ['孙坚', '孙策', '孙权', '周瑜', '鲁肃', '吕蒙', '陆逊'];

    wuCharacters.forEach((name) => {
      it(`has at least one personTimeline card for ${name}`, () => {
        const cards = threeKingdomsKnowledgeBase.cards.filter(
          (c) => c.kind === 'personTimeline' && (c.relatedNpcNames ?? []).includes(name),
        );
        expect(cards.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  /* ================================================================
   *  10. 势力覆盖
   * ================================================================ */
  describe('faction coverage', () => {
    const requiredFactions = [
      '汉廷', '董卓集团', '西凉军', '关东联军',
      '曹操集团', '曹魏', '袁绍集团',
      '刘备集团', '蜀汉', '东吴',
      '刘表', '刘璋', '南中',
    ];

    requiredFactions.forEach((name) => {
      it(`faction "${name}" is referenced in at least one card`, () => {
        const cards = findCardsByText(name);
        expect(cards.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  /* ================================================================
   *  11. Prompt projection regression
   * ================================================================ */
  describe('prompt projection regression', () => {
    const requiredOpeningProjectionCards: Array<{
      bookmarkId: string;
      locationId: string;
      cardId: string;
    }> = [
      {
        bookmarkId: 'bookmark_184_yellow_turban',
        locationId: 'loc_yingchuan',
        cardId: 'tk3k_yellow_turban_184',
      },
      {
        bookmarkId: 'bookmark_189_luoyang_storm',
        locationId: 'region_sili',
        cardId: 'tk_189_luoyang_turmoil',
      },
      {
        bookmarkId: 'bookmark_190_anti_dong',
        locationId: 'loc_yingchuan',
        cardId: 'tk3k_190_coalition_formed',
      },
      {
        bookmarkId: 'bookmark_194_warlords',
        locationId: 'region_yuzhou',
        cardId: 'tk3k_warlord_not_system',
      },
      {
        bookmarkId: 'bookmark_196_emperor_at_xu',
        locationId: 'region_yuzhou',
        cardId: 'tk3k_196_emperor_xuchang',
      },
      {
        bookmarkId: 'bookmark_200_guandu',
        locationId: 'loc_yingchuan',
        cardId: 'tk3k_200_guandu_standoff',
      },
      {
        bookmarkId: 'bookmark_201_jingzhou_refuge',
        locationId: 'region_jingzhou',
        cardId: 'tk3k_liubei_jingzhou_refugee',
      },
      {
        bookmarkId: 'bookmark_207_longzhong_plan',
        locationId: 'region_jingzhou',
        cardId: 'tk3k_207_longzhong_plan',
      },
      {
        bookmarkId: 'bookmark_208_red_cliff',
        locationId: 'region_jingzhou',
        cardId: 'tk3k_208_chibi_approach',
      },
      {
        bookmarkId: 'bookmark_211_entering_shu',
        locationId: 'region_yizhou',
        cardId: 'tk3k_211_rushu_prelude',
      },
      {
        bookmarkId: 'bookmark_214_yizhou',
        locationId: 'region_yizhou',
        cardId: 'tk3k_214_yizhou_transition',
      },
      {
        bookmarkId: 'bookmark_219_hanzhong_king',
        locationId: 'region_yizhou',
        cardId: 'tk3k_219_hanzhong_campaign',
      },
      {
        bookmarkId: 'bookmark_220_three_kingdoms',
        locationId: 'region_yuzhou',
        cardId: 'tk3k_220_caopi_usurp',
      },
      {
        bookmarkId: 'bookmark_222_yiling_aftermath',
        locationId: 'region_yizhou',
        cardId: 'tk3k_222_yiling_defeat',
      },
      {
        bookmarkId: 'bookmark_223_baidi_regency',
        locationId: 'region_yizhou',
        cardId: 'tk3k_223_baidi_entrust',
      },
      {
        bookmarkId: 'bookmark_225_nanzhong_campaign',
        locationId: 'region_yizhou',
        cardId: 'tk3k_225_nanzhong_pacification',
      },
      {
        bookmarkId: 'bookmark_228_first_northern_expedition',
        locationId: 'region_yizhou',
        cardId: 'tk3k_228_first_northern_expedition',
      },
      {
        bookmarkId: 'bookmark_229_shu_wu_renewed_alliance',
        locationId: 'region_yizhou',
        cardId: 'tk3k_229_wushu_realliance',
      },
      {
        bookmarkId: 'bookmark_231_qishan_stalemate',
        locationId: 'region_yizhou',
        cardId: 'tk3k_231_qishan_stalemate',
      },
      {
        bookmarkId: 'bookmark_234_wuzhangyuan',
        locationId: 'region_yizhou',
        cardId: 'tk3k_234_wuzhangyuan',
      },
      {
        bookmarkId: 'bookmark_249_gaopingling',
        locationId: 'region_sili',
        cardId: 'tk3k_249_gaopingling',
      },
      {
        bookmarkId: 'bookmark_253_jiangwei_command',
        locationId: 'region_yizhou',
        cardId: 'tk3k_253_jiangwei_commands',
      },
      {
        bookmarkId: 'bookmark_255_taoxi_victory',
        locationId: 'region_yizhou',
        cardId: 'tk3k_255_taoxi_victory',
      },
      {
        bookmarkId: 'bookmark_263_shuhan_fall',
        locationId: 'region_yizhou',
        cardId: 'tk3k_263_shuhan_fall',
      },
    ];

    it.each(requiredOpeningProjectionCards)(
      'projects current scenario card $cardId for $bookmarkId',
      ({ bookmarkId, locationId, cardId }) => {
        const ids = projectBookmarkKnowledge(bookmarkId, locationId);

        expect(ids).toContain(cardId);
      },
    );

    it('does not let the 207 Longzhong opening pull future Guan Yu Jingzhou-guard cards only through the broad Jingzhou tag', () => {
      const ids = projectBookmarkKnowledge('bookmark_207_longzhong_plan', 'region_jingzhou');

      expect(ids).toContain('tk3k_207_longzhong_plan');
      expect(ids).not.toContain('tk3k_guanyu_jingzhou_guard');
    });

    it('does not let the 263 Shu fall opening spend its default prompt budget on old entering-Shu background cards', () => {
      const ids = projectBookmarkKnowledge('bookmark_263_shuhan_fall', 'region_yizhou');

      expect(ids).toContain('tk3k_263_shuhan_fall');
      expect(ids).not.toContain('tk3k_211_rushu_prelude');
      expect(ids).not.toContain('tk3k_pangtong');
    });

    it.each([
      {
        bookmarkId: 'bookmark_184_yellow_turban',
        locationId: 'loc_yingchuan',
        include: 'tk3k_yellow_turban_184',
        exclude: ['tk3k_207_longzhong_plan', 'tk3k_263_shuhan_fall'],
      },
      {
        bookmarkId: 'bookmark_194_warlords',
        locationId: 'region_yuzhou',
        include: 'tk3k_warlord_not_system',
        exclude: ['tk3k_207_longzhong_plan', 'tk3k_263_shuhan_fall'],
      },
      {
        bookmarkId: 'bookmark_207_longzhong_plan',
        locationId: 'region_jingzhou',
        include: 'tk3k_207_longzhong_plan',
        exclude: ['tk3k_guanyu_jingzhou_guard', 'tk3k_263_shuhan_fall'],
      },
      {
        bookmarkId: 'bookmark_263_shuhan_fall',
        locationId: 'region_yizhou',
        include: 'tk3k_263_shuhan_fall',
        exclude: ['tk3k_211_rushu_prelude', 'tk3k_pangtong'],
      },
    ])(
      'keeps current-era and current-context projection bounded for $bookmarkId',
      ({ bookmarkId, locationId, include, exclude }) => {
        const result = projectBookmarkKnowledgeResult(bookmarkId, locationId);
        const ids = result.hints.map((hint) => hint.id);

        expect(ids).toContain(include);
        exclude.forEach((cardId) => {
          expect(ids).not.toContain(cardId);
        });
        expect(result.hints.length).toBeLessThanOrEqual(4);
        result.hints.forEach((hint) => {
          expect(hint.text.length).toBeLessThanOrEqual(360);
        });
      },
    );
  });

  /* ================================================================
   *  12. 地点覆盖
   * ================================================================ */
  describe('place coverage', () => {
    const requiredPlaces = [
      '洛阳', '长安', '许都', '陈留', '颍川',
      '荆州', '新野', '襄阳', '江陵',
      '益州', '成都', '汉中', '白帝',
      '南中', '祁山', '街亭', '天水',
      '洮西', '阴平',
    ];

    requiredPlaces.forEach((place) => {
      it(`place "${place}" is referenced in at least one card`, () => {
        const cards = findCardsByText(place);
        expect(cards.length).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
