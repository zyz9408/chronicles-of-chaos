import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InventoryItem, LuanShiNpc, RuntimeState, TimelineAnchor, WorldBook, WorldlineKnowledgeBase } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { deletePromptOverride, savePromptOverride } from '../prompts/PromptOverrideStore';
import {
  saveAdultIntimacyStyleToStorage,
  saveNarrativeLengthToStorage,
  savePregnancyModeToStorage,
} from '../settings/DisplaySettings';
import { clearWorldlineKnowledgeRegistryForTest, registerWorldlineKnowledgeBase } from '../worldline/WorldlineKnowledgeRegistry';
import { composePrompt } from './PromptComposer';
import { buildTurnUserMessage } from './TurnPromptMessages';

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

const worldBook: WorldBook = {
  manifest: {
    id: 'test-chaos-world',
    name: '测试乱世',
    version: '0.1.0',
    author: 'test',
    language: 'zh-CN',
    genre: '乱世',
    source: 'official',
    compatibleEngineVersion: '0.1.0',
  },
  ontology: {
    regionLevels: [],
    factionTypes: [],
    actorRoleTypes: [],
    socialClasses: [],
    resourceTypes: [],
    conflictTypes: [],
    actionTypes: [],
    relationshipTypes: [],
  },
  lore: '',
  mapSeed: [],
  factionsSeed: [],
  timelineAnchors: [],
  startBookmarks: [],
  openingCrisisTemplates: [],
  characterOptions: {
    birthOrigins: [],
    identities: [],
    abilityPresets: [],
    hiddenAbilityKeys: ['机运'],
  },
  prompts: {
    narrativeBaseline: '保持乱世叙事。',
    forbiddenTopics: [],
    outputFormat: '输出正文。',
    toneGuide: '沉稳。',
  },
  validationRules: [],
};

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearWorldlineKnowledgeRegistryForTest();
});

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-chaos-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '乱世元年2月',
    currentDate: '乱世元年2月',
    player: {
      id: 'player',
      name: '主角',
      courtesyName: '子衡',
      sex: '男',
      age: 22,
      roleType: '流民',
      birthOrigin: '寒门士子',
      currentIdentity: '流民',
      appearance: '黑发黑眸，面容清秀，衣着朴素利落。',
      personality: '外冷内热，谨慎克制，遇事先观察再出手。',
      abilityScores: { 武力: 48, 统率: 51, 智力: 62, 政治: 53, 魅力: 50, 机运: 77 },
      level: 3,
      xp: 180,
      growthPoints: 1,
      vitals: { hp: 82, maxHp: 100, stamina: 41, maxStamina: 100 },
      reputation: {
        morality: 12,
        fame: 8,
        tags: [{ label: '救人有名', source: '主角救下伤者后在市镇小范围流传。' }],
        summary: '主角略有善名，但流传范围仍限于市镇。',
      },
      traits: [
        {
          id: 'trait_careful',
          label: '谨慎自守',
          description: '遇事先观望局势，不轻易暴露底牌。',
          source: 'opening',
          promptHint: '遇到未知风险时，主角默认更倾向先侦察、试探、留后路。',
        },
      ],
      effects: [
        {
          id: 'effect_tired',
          label: '奔波疲惫',
          type: 'debuff',
          duration: 'short',
          description: '体力不足。',
          source: 'travel',
          promptHint: '涉及长途奔走、追逐或持久战时应体现疲惫影响。',
        },
      ],
      equipment: [
        {
          id: 'eq_short_blade',
          slot: 'weapon',
          name: '旧短刀',
          quality: '普通',
          description: '随身防身的旧短刀。',
          promptHint: '可在近身冲突中提供防身手段，但不能当作精良军械。',
        },
      ],
      inventory: [
        { id: 'item_dry_food', name: '干粮', quantity: 3, description: '三日口粮。' },
      ],
      personalMoney: 36,
      playerMemory: {
        summary: '主角初到市镇，曾救下伤者，因此被陈衡注意。',
        keyDeeds: [
          {
            id: 'deed_rescue',
            date: '乱世元年2月',
            locationId: 'loc_market_town',
            summary: '在市镇救下伤者。',
            impact: '陈衡开始关注主角。',
          },
        ],
        recentTurns: ['上一回合主角观察陈衡，没有贸然表态。'],
      },
      summary: '流落市镇。',
      situationSummary: '想在乱世中寻一条立足之路。',
    },
    currentLocationId: 'loc_market_town',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {
      openingExtraRequest: '若与其他开局选项冲突，以此为准：不要一开局掌权，先从乡里暗流卷入。',
    },
    turnLog: [],
    localSituationNotes: [],
    locations: [
      {
        locationId: 'loc_market_town',
        name: '市镇',
        type: '聚落',
        summary: '道路交汇处的小市镇。',
        knownLevel: '亲历',
        recentEvents: [],
      },
    ],
    npcs: [
      {
        npcId: 'npc_chen_heng',
        name: '陈衡',
        sex: '男',
        age: 30,
        role: '游侠首领',
        locationId: 'loc_market_town',
        isPresent: true,
        isFocused: false,
        summary: '机警过人。',
        appearance: '目光锐利。',
        personality: '豪爽直接。',
        motivation: '寻找机会。',
        relationToPlayer: '刚刚见过主角救人。',
        contactLevel: 12,
        recentAttitude: '好奇',
        memories: [
          {
            memoryId: 'mem_chen_1',
            source: '亲历',
            content: '陈衡亲眼见到主角救下伤者。',
            createdAt: '乱世元年2月',
          },
        ],
      },
      {
        npcId: 'npc_far',
        name: '远处人物',
        sex: '男',
        age: 40,
        role: '远方商人',
        locationId: 'loc_far',
        isPresent: false,
        isFocused: false,
        summary: '与当前回合无关。',
        appearance: '普通。',
        personality: '谨慎。',
        motivation: '经商。',
        relationToPlayer: '无交集。',
        contactLevel: 0,
        recentAttitude: '陌生',
        memories: [
          {
            memoryId: 'mem_far_1',
            source: '听闻',
            content: '这条远方记忆不应进入当前 prompt。',
            createdAt: '乱世元年2月',
          },
        ],
      },
    ],
    turnEvents: [
      {
        eventId: 'evt_market_rescue',
        happenedAt: '乱世元年2月',
        locationId: 'loc_market_town',
        summary: '主角救下伤者，陈衡在场目睹。',
        presentNpcIds: ['npc_chen_heng'],
        involvedNpcIds: ['npc_chen_heng'],
        visibility: '在场可知',
      },
    ],
  });
}

function makeRelationshipProjectionState(): RuntimeState {
  const state = makeState();

  return {
    ...state,
    npcs: [
      ...(state.npcs ?? []),
      {
        npcId: 'npc_lady_he',
        name: '何氏',
        sex: '女',
        age: 22,
        role: '宫中女眷',
        locationId: 'loc_market_town',
        isPresent: true,
        isFocused: false,
        summary: '与主角有私下互信。',
        appearance: '衣着素雅。',
        personality: '谨慎克制。',
        motivation: '保全家人。',
        relationToPlayer: '已有私下互信。',
        contactLevel: 25,
        recentAttitude: '试探',
        memories: [],
      },
      {
        npcId: 'npc_archived_lady',
        name: '旧线人物',
        sex: '女',
        age: 29,
        role: '旧识',
        locationId: 'loc_capital',
        isPresent: false,
        isFocused: false,
        summary: '已经归档的旧关系人物。',
        appearance: '衣着素净。',
        personality: '沉静。',
        motivation: '远离纷争。',
        relationToPlayer: '旧识。',
        contactLevel: 10,
        recentAttitude: '疏远',
        memories: [],
      },
    ],
    heroineThreads: [
      {
        heroineThreadId: 'heroine_npc_lady_he',
        npcId: 'npc_lady_he',
        npcName: '何氏',
        status: 'active',
        stage: '互信成形',
        relationshipRole: '宫廷盟友',
        summary: '她与主角已有私下互信，但宫廷耳目会放大风险。',
        currentPull: '她等待主角履行保护承诺。',
        promiseNotes: '主角承诺护住她的家人。',
        riskNotes: '暴露会牵动宫中压力。',
        recentProgress: '上一回合两人确认暗号。',
        tags: ['宫廷', '互信'],
        milestones: [{ milestoneId: 'm_he_1', happenedAt: '乱世元年2月', summary: '第一次交换暗号' }],
        lastUpdatedAt: '乱世元年2月03日',
      },
      {
        heroineThreadId: 'heroine_archived',
        npcId: 'npc_archived_lady',
        npcName: '旧线人物',
        status: 'archived',
        stage: '旧线',
        relationshipRole: '旧线',
        summary: 'ARCHIVED_HEROINE_SHOULD_NOT_APPEAR',
        lastUpdatedAt: '乱世元年2月04日',
      },
    ],
    bondThreads: [
      {
        bondThreadId: 'bond_gate_oath',
        targetNpcIds: ['npc_chen_heng'],
        targetNames: ['陈衡'],
        bondType: 'sworn',
        status: 'active',
        summary: '城门危机中形成的非红颜结义承诺。',
        currentTension: '双方都期待彼此守住难民。',
        promiseNotes: '共同护送伤者。',
        conflictNotes: '若弃守会损害信任。',
        recentProgress: '誓约被部下知晓。',
        tags: ['结义', '守城'],
        milestones: [{ milestoneId: 'm_bond_1', happenedAt: '乱世元年2月', summary: '城门前立誓' }],
        lastUpdatedAt: '乱世元年2月03日',
      },
      {
        bondThreadId: 'bond_archived',
        targetNpcIds: ['npc_chen_heng'],
        targetNames: ['陈衡'],
        bondType: 'ally',
        status: 'archived',
        summary: 'ARCHIVED_BOND_SHOULD_NOT_APPEAR',
        lastUpdatedAt: '乱世元年2月04日',
      },
    ],
  } as RuntimeState;
}

const PRIVATE_PROFILE_SENTINELS = [
  '何氏私密摘要锚点',
  '何氏胸部私密锚点',
  '何氏小穴私密锚点',
  '何氏屁穴私密锚点',
  '何氏性癖锚点',
  '何氏敏感点锚点',
  '何氏偏好锚点',
  '何氏边界锚点',
  '何氏子宫状态锚点',
];

function makeAdultPrivateProfileState(options: {
  age?: number;
  ageKnownAtDate?: string;
  currentDate?: string;
  includeUnrelatedAdult?: boolean;
  turnLog?: RuntimeState['turnLog'];
} = {}): RuntimeState {
  const state = makeState();
  const ladyHe = {
    npcId: 'npc_lady_he',
    name: '何氏',
    sex: '女',
    age: options.age ?? 22,
    ageKnownAtDate: options.ageKnownAtDate,
    role: '宫中女眷',
    locationId: 'loc_market_town',
    isPresent: true,
    isFocused: false,
    summary: '与主角有长期关系牵引。',
    appearance: '衣着素雅。',
    personality: '谨慎克制。',
    motivation: '保全家人。',
    relationToPlayer: '已有私下互信。',
    contactLevel: 35,
    recentAttitude: '信任中带着试探',
    memories: [],
    femaleProfile: {
      relationshipNotes: '何氏公开关系档案锚点。',
      publicIntimacyNotes: '何氏公开亲昵边界锚点。',
      appearanceDescription: '何氏公开外貌锚点。',
      adultPrivateProfile: {
        enabled: true,
        ageConfirmedAdult: true,
        summary: '何氏私密摘要锚点',
        breastDescription: '何氏胸部私密锚点',
        vaginaDescription: '何氏小穴私密锚点',
        anusDescription: '何氏屁穴私密锚点',
        sexualPreferenceNotes: '何氏性癖锚点',
        sensitiveSpotNotes: '何氏敏感点锚点',
        preferenceNotes: '何氏偏好锚点',
        boundaryNotes: '何氏边界锚点',
        wombProfile: {
          status: '何氏子宫状态锚点',
        },
      },
    },
  } as LuanShiNpc;
  const unrelatedLady = {
    ...ladyHe,
    npcId: 'npc_lady_du',
    name: '杜氏',
    relationToPlayer: '只是同席在场。',
    femaleProfile: {
      relationshipNotes: '杜氏公开关系档案锚点。',
      adultPrivateProfile: {
        enabled: true,
        ageConfirmedAdult: true,
        summary: '杜氏私密摘要不应投喂',
        breastDescription: '杜氏胸部私密锚点不应投喂',
      },
    },
  } as LuanShiNpc;

  return {
    ...state,
    currentDate: options.currentDate ?? state.currentDate,
    turnLog: options.turnLog ?? state.turnLog,
    npcs: [
      ...(state.npcs ?? []),
      ladyHe,
      ...(options.includeUnrelatedAdult ? [unrelatedLady] : []),
    ],
  } as RuntimeState;
}

function expectNoPrivateProfileProjection(text: string): void {
  expect(text).not.toContain('成人私密档案');
  for (const sentinel of PRIVATE_PROFILE_SENTINELS) {
    expect(text).not.toContain(sentinel);
  }
}

function getStateWriterNpcLine(context: string, npcId: string): string {
  return context
    .split('\n')
    .filter((line) => line.includes(`npcId: ${npcId}`))
    .join('\n');
}

function makeProtagonistClonePromptState(): RuntimeState {
  const state = makeState();
  return {
    ...state,
    player: {
      ...state.player,
      name: '刘峙',
      courtesyName: '临渊',
      age: 24,
      currentIdentity: '建威校尉',
      militaryTitle: '建威校尉',
    },
    npcs: [
      ...(state.npcs ?? []),
      {
        npcId: 'npc_liuzhi',
        name: '刘峙',
        courtesyName: '临渊',
        sex: '男',
        age: 24,
        role: '建威校尉',
        locationId: 'loc_market_town',
        isPresent: true,
        isFocused: true,
        currentIdentity: '建威校尉',
        militaryTitle: '建威校尉',
        summary: 'PLAYER_CLONE_SUMMARY_SENTINEL',
        appearance: 'PLAYER_CLONE_APPEARANCE_SENTINEL',
        personality: 'PLAYER_CLONE_PERSONALITY_SENTINEL',
        motivation: 'PLAYER_CLONE_MOTIVATION_SENTINEL',
        relationToPlayer: '本人',
        contactLevel: 99,
        recentAttitude: 'PLAYER_CLONE_ATTITUDE_SENTINEL',
        abilityScores: { 武力: 72, 统率: 75, 智力: 78, 政治: 70, 魅力: 82, 机运: 65 },
        equipment: [
          {
            id: 'eq_clone_sentinel',
            slot: 'weapon',
            name: 'PLAYER_CLONE_SWORD_SENTINEL',
            quality: '精良',
            description: '不应进入 prompt。',
          },
        ],
        inventory: [
          {
            id: 'item_clone_sentinel',
            name: 'PLAYER_CLONE_SEAL_SENTINEL',
            quantity: 1,
            category: 'token',
            description: '不应进入 prompt。',
          },
        ],
        traits: [
          {
            id: 'trait_clone_sentinel',
            label: 'PLAYER_CLONE_TRAIT_SENTINEL',
            description: '不应进入 prompt。',
            source: 'error',
          },
        ],
        memories: [
          {
            memoryId: 'mem_clone_sentinel',
            source: '亲历',
            content: 'PLAYER_CLONE_MEMORY_SENTINEL',
            createdAt: '乱世元年2月',
          },
        ],
      },
      {
        npcId: 'npc_liuzhi_namesake',
        name: '刘峙',
        courtesyName: '伯山',
        sex: '男',
        age: 36,
        role: '同名宗族旁支',
        locationId: 'loc_market_town',
        isPresent: false,
        isFocused: true,
        currentIdentity: '汝南逃难士人',
        summary: 'NAMESAKE_SUMMARY_SENTINEL',
        appearance: 'NAMESAKE_APPEARANCE_SENTINEL',
        personality: '谨慎。',
        motivation: '投靠宗亲。',
        relationToPlayer: '同名族人，正寻求投靠。',
        contactLevel: 6,
        recentAttitude: '观望',
        equipment: [
          {
            id: 'eq_namesake_staff',
            slot: 'weapon',
            name: 'NAMESAKE_STAFF_SENTINEL',
            quality: '普通',
            description: '同名真实 NPC 行装。',
          },
        ],
        memories: [],
      },
    ],
  } as RuntimeState;
}

describe('composePrompt', () => {
  it('places permanent prompts after the resolved main template without treating them as the player action', () => {
    const prompt = composePrompt(
      worldBook,
      undefined,
      [],
      undefined,
      makeState(),
      '巡视营寨',
      {
        persistentPromptGuide: [
          '## 玩家启用的永久提示词',
          '以下内容不是本回合行动。',
          '1. 对话更符合历史人物个性。',
        ].join('\n'),
      },
    );

    expect(prompt.userPrompt).toContain('## 玩家启用的永久提示词');
    expect(prompt.userPrompt).toContain('1. 对话更符合历史人物个性。');
    expect(prompt.userPrompt).toContain('巡视营寨');
    expect(prompt.userPrompt.indexOf('巡视营寨'))
      .toBeLessThan(prompt.userPrompt.indexOf('## 玩家启用的永久提示词'));
  });

  it('requires narrativeText to use display-friendly speaker labels for dialogue bubbles', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我与陈衡交谈');

    expect(prompt.userPrompt).toContain('narrativeText 显示格式');
    expect(prompt.userPrompt).toContain('【旁白】');
    expect(prompt.userPrompt).toContain('【角色名】');
    expect(prompt.userPrompt).toContain('当前主角姓名');
    expect(prompt.userPrompt).toContain('不要使用 `【你】`');
    expect(prompt.userPrompt).toContain('临时出现的军士、门吏、仆从、路人等人物');
    expect(prompt.userPrompt).toContain('不要把直接台词塞进 `【旁白】` 段');
    expect(prompt.userPrompt).not.toContain('或 `【你】` 开头');
    expect(prompt.userPrompt).toContain('不要在正文里输出 XML 标签或旧式命令块');
    expect(prompt.userPrompt).toContain('必须在 writeback.npcProfileSuggestions 写入人物志');
    expect(prompt.userPrompt).toContain('本回合直接出场、发话、发令、参与战斗、参与任务推进或被玩家当面处理的有名有姓人物');
    expect(prompt.userPrompt).toContain('必须在 writeback.npcProfileSuggestions 建档或更新');
    expect(prompt.userPrompt).toContain('不得只写入正文、当前事项、风声线索、天下纪事或 npcAwarenessRegistered');
    expect(prompt.userPrompt).toContain('如果当前势力账本为空');
    expect(prompt.userPrompt).toContain('必须用 upsertFactionLedger 写回相关当前势力');
  });

  it('injects the saved long narrative length target into the main prompt', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    saveNarrativeLengthToStorage('long', storage);

    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我与陈衡详谈局势');

    expect(prompt.userPrompt).toContain('## 正文篇幅要求');
    expect(prompt.userPrompt).toContain('当前设置：长篇');
    expect(prompt.userPrompt).toContain('1600-2400 字');
    expect(prompt.userPrompt).toContain('narrativeText 正文');
    expect(prompt.userPrompt).toContain('不要把建议行动、状态写回、公开思路摘要计入正文篇幅');
  });

  it('uses era-style current date in narrative context instead of 公元 labels', () => {
    const state = {
      ...makeState(),
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      calendarEras: [{ eraId: 'han_zhongping', eraName: '中平', startYear: 184 }],
      turnEvents: [
        {
          eventId: 'evt_public_date',
          happenedAt: '公元189年09月01日 08:30（辰时）',
          locationId: 'loc_market_town',
          summary: '主角听见城门外军情。',
          presentNpcIds: [],
          involvedNpcIds: [],
          visibility: '在场可知',
        },
      ],
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我观察局势');

    expect(prompt.narrativeContext).toContain('当前日期：中平六年（189年）09月01日 08:00（辰时）');
    expect(prompt.narrativeContext).toContain('中平六年（189年）09月01日 08:30（辰时） 主角听见城门外军情。');
    expect(prompt.narrativeContext).not.toContain('当前日期：公元189年');
    expect(prompt.narrativeContext).not.toContain('近期事件：公元189年');
    expect(prompt.systemPrompt).toContain('正文不得使用“公元18xx年”');
    expect(prompt.systemPrompt).toContain('中平六年（189年）');
    expect(prompt.systemPrompt).toContain('剧情正式建立的新年号优先于世界书的史实兜底年号');
    expect(prompt.stateWriterContext).toContain('source 写 "runtime.story"');
  });

  it('uses the default worldbook toneGuide when no override exists', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const defaultToneGuide = 'DEFAULT_TONE_GUIDE_SENTINEL';
    const customToneGuide = 'USER_TONE_GUIDE_SENTINEL';
    const prompt = composePrompt(
      { ...worldBook, prompts: { ...worldBook.prompts, toneGuide: defaultToneGuide } },
      undefined,
      [],
      undefined,
      makeState(),
      'observe',
    );

    expect(prompt.systemPrompt).toContain(defaultToneGuide);
    expect(prompt.systemPrompt).not.toContain(customToneGuide);
  });

  it('uses the saved worldbook.toneGuide override in the main system prompt', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const defaultToneGuide = 'DEFAULT_TONE_GUIDE_SENTINEL';
    const customToneGuide = 'USER_TONE_GUIDE_SENTINEL';

    savePromptOverride('worldbook.toneGuide', customToneGuide, storage);

    const prompt = composePrompt(
      { ...worldBook, prompts: { ...worldBook.prompts, toneGuide: defaultToneGuide } },
      undefined,
      [],
      undefined,
      makeState(),
      'observe',
    );

    expect(prompt.systemPrompt).toContain(customToneGuide);
    expect(prompt.systemPrompt).not.toContain(defaultToneGuide);
  });

  it('returns to the default worldbook toneGuide after deleting the override', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const defaultToneGuide = 'DEFAULT_TONE_GUIDE_SENTINEL';
    const customToneGuide = 'USER_TONE_GUIDE_SENTINEL';

    savePromptOverride('worldbook.toneGuide', customToneGuide, storage);
    deletePromptOverride('worldbook.toneGuide', storage);

    const prompt = composePrompt(
      { ...worldBook, prompts: { ...worldBook.prompts, toneGuide: defaultToneGuide } },
      undefined,
      [],
      undefined,
      makeState(),
      'observe',
    );

    expect(prompt.systemPrompt).toContain(defaultToneGuide);
    expect(prompt.systemPrompt).not.toContain(customToneGuide);
  });

  it('feeds worldline knowledge policy and selected hints into the main prompt budget', () => {
    const knowledgeBase: WorldlineKnowledgeBase = {
      id: 'kb_prompt_composer_test',
      worldBookId: 'test-chaos-world',
      name: 'Prompt Composer Test Knowledge',
      version: '0.1.0',
      description: 'Test-only worldline knowledge base.',
      cards: [
        {
          id: 'kb_luoyang_anchor',
          worldBookId: 'test-chaos-world',
          kind: 'eraAnchor',
          title: 'Luoyang pressure anchor',
          summary: 'WORLDLINE_HINT_SENTINEL: do not let generic history override this save.',
          relatedPlaceIds: ['loc_market_town'],
          importance: 'critical',
          strictness: 'light',
          contradictionHint: 'LOCAL_FACTS_FIRST_SENTINEL',
        },
      ],
    };
    registerWorldlineKnowledgeBase(knowledgeBase);
    const state = {
      ...makeState(),
      worldlineSettings: {
        knowledgeMode: 'default',
        knowledgeBaseId: knowledgeBase.id,
        storyPackIds: [],
      },
    } as RuntimeState;
    const anchors: TimelineAnchor[] = [
      {
        id: 'anchor_1',
        label: 'Anchor One',
        approximateDate: '189',
        summary: 'ANCHOR_ONE_SENTINEL',
        activeFactionHints: [],
        regionalTensionHints: [],
        suggestedThemes: [],
      },
      {
        id: 'anchor_2',
        label: 'Anchor Two',
        approximateDate: '189',
        summary: 'ANCHOR_TWO_SENTINEL',
        activeFactionHints: [],
        regionalTensionHints: [],
        suggestedThemes: [],
      },
      {
        id: 'anchor_3',
        label: 'Anchor Three',
        approximateDate: '189',
        summary: 'ANCHOR_THREE_SENTINEL',
        activeFactionHints: [],
        regionalTensionHints: [],
        suggestedThemes: [],
      },
      {
        id: 'anchor_4',
        label: 'Anchor Four',
        approximateDate: '189',
        summary: 'ANCHOR_FOUR_SHOULD_NOT_APPEAR',
        activeFactionHints: [],
        regionalTensionHints: [],
        suggestedThemes: [],
      },
    ];

    const prompt = composePrompt(worldBook, undefined, anchors, undefined, state, 'observe');

    expect(prompt.systemPrompt).toContain('本局事实 > 玩家行动');
    expect(prompt.systemPrompt).toContain('KnowledgeBase');
    expect(prompt.systemPrompt).toContain('ANCHOR_ONE_SENTINEL');
    expect(prompt.systemPrompt).toContain('ANCHOR_THREE_SENTINEL');
    expect(prompt.systemPrompt).not.toContain('ANCHOR_FOUR_SHOULD_NOT_APPEAR');
    expect(prompt.narrativeContext).toContain('Worldline Knowledge');
    expect(prompt.narrativeContext).toContain('WORLDLINE_HINT_SENTINEL');
    expect(prompt.narrativeContext).toContain('LOCAL_FACTS_FIRST_SENTINEL');
    expect(prompt.runtimeTokenEstimate.contextBreakdown.map((layer) => layer.id)).toContain('situationWorldlineHints');
  });

  it('uses overrides for the worldbook baseline and main system/user/state writer prompts', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);

    savePromptOverride('worldbook.narrativeBaseline', 'USER_BASELINE_SENTINEL', storage);
    savePromptOverride('main.systemPrompt', 'SYSTEM_TEMPLATE_SENTINEL {worldbook.narrativeBaseline} {playerInput}', storage);
    savePromptOverride('main.userPrompt', 'USER_TEMPLATE_SENTINEL {narrativeContext} {playerInput}', storage);
    savePromptOverride('main.stateWriterProtocol', 'STATE_WRITER_SENTINEL {stateWriterContext}', storage);

    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), 'PLAYER_INPUT_SENTINEL');

    expect(prompt.systemPrompt).toContain('SYSTEM_TEMPLATE_SENTINEL');
    expect(prompt.systemPrompt).toContain('USER_BASELINE_SENTINEL');
    expect(prompt.systemPrompt).toContain('PLAYER_INPUT_SENTINEL');
    expect(prompt.userPrompt).toContain('USER_TEMPLATE_SENTINEL');
    expect(prompt.userPrompt).toContain('当前地点：市镇');
    expect(prompt.userPrompt).toContain('PLAYER_INPUT_SENTINEL');
    expect(prompt.stateWriterContext).toContain('STATE_WRITER_SENTINEL');
    expect(prompt.stateWriterContext).toContain('currentLocationId: loc_market_town');
  });

  it('surfaces existing non-present NPCs linked by current matters as writeback reuse candidates', () => {
    const baseState = makeState();
    const state = {
      ...baseState,
      npcs: [
        ...(baseState.npcs ?? []),
        {
          npcId: 'npc_wei_yan',
          name: '魏延',
          courtesyName: '文长',
          sex: '男',
          age: 24,
          role: '左曲武将',
          locationId: 'loc_xiangyang_camp',
          isPresent: false,
          isFocused: false,
          birthOrigin: '荆州南阳郡义阳县',
          currentIdentity: '襄阳城东大营屯长',
          summary: '尚未与主角当面接触，但已在军中传闻里出现。',
          appearance: '身形高大，眉目锐利。',
          personality: '刚烈自负，重视武勇。',
          motivation: '想在乱世中凭军功出头。',
          relationToPlayer: '尚未接触。',
          contactLevel: 0,
          recentAttitude: '未接触',
          memories: [],
        },
      ],
      activeQuests: [
        {
          id: 'quest_visit_wei_yan',
          title: '拜访魏延',
          description: '军中传闻魏延字文长，正在襄阳城东大营听候调遣。',
          status: 'active',
          currentStep: '主角准备前往城东大营与魏延见面。',
          priority: 'high',
          relatedNpcIds: ['npc_wei_yan'],
          createdAt: '中平十一年04月01日',
          updatedAt: '中平十一年04月01日',
        },
      ],
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我去城东大营见魏延。');

    expect(prompt.stateWriterContext).toContain('npcReuseCandidates:');
    expect(prompt.stateWriterContext).toContain('npcId: npc_wei_yan');
    expect(prompt.stateWriterContext).toContain('npcName: 魏延');
    expect(prompt.stateWriterContext).toContain('courtesyName: 文长');
    expect(prompt.stateWriterContext).toContain('currentIdentity: 襄阳城东大营屯长');
  });

  it('filters polluted protagonist self-clone NPCs from prompt projection while preserving same-name real NPCs', () => {
    const prompt = composePrompt(
      worldBook,
      undefined,
      [],
      undefined,
      makeProtagonistClonePromptState(),
      '我请刘峙伯山上前说明流民情况',
    );
    const combined = buildTurnUserMessage(prompt.userPrompt, prompt.stateWriterContext);

    expect(combined).not.toContain('PLAYER_CLONE_SUMMARY_SENTINEL');
    expect(combined).not.toContain('PLAYER_CLONE_SWORD_SENTINEL');
    expect(combined).not.toContain('PLAYER_CLONE_SEAL_SENTINEL');
    expect(combined).not.toContain('PLAYER_CLONE_TRAIT_SENTINEL');
    expect(combined).not.toContain('PLAYER_CLONE_MEMORY_SENTINEL');
    expect(combined).toContain('npcId: npc_liuzhi_namesake');
    expect(combined).toContain('汝南逃难士人');
    expect(combined).toContain('同名族人');
    expect(combined).toContain('NAMESAKE_STAFF_SENTINEL');
  });

  it('injects the common adult intimacy protocol and relationship immersion style by default', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);

    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我与成年伴侣独处');

    expect(prompt.userPrompt).toContain('## 成人亲密描写指南');
    expect(prompt.userPrompt).toContain('当剧情已经自然进入成人亲密场景');
    expect(prompt.userPrompt).toContain('不要淡出、不要空泛跳过');
    expect(prompt.userPrompt).toContain('## 成人亲密描写风格：关系沉浸');
    expect(prompt.userPrompt).toContain('以人物关系、心理变化、身份处境和场景压力为中心');
    expect(prompt.userPrompt).toContain('直白用语是两种成人描写风格的共同最低要求');
    expect(prompt.userPrompt).toContain('关系沉浸只改变叙事重心，不降低用语直白程度');
    expect(prompt.userPrompt).toContain('关系沉浸同样使用直白身体词和明确动作');
    expect(prompt.userPrompt).toContain('肉棒、龟头、阴茎、小穴、阴蒂、乳头、蜜液、精液、穴口');
    expect(prompt.userPrompt).toContain('禁止委婉语、含蓄代称与比喻遮蔽');
    expect(prompt.userPrompt).toContain('先立当前近景、双方站位或姿势、衣物状态与正在发生的动作');
    expect(prompt.userPrompt).toContain('每个动作必须引出对方可观察的身体、语言或情绪反馈');
    expect(prompt.userPrompt).toContain('不要重演最近正文已经反复使用的动作顺序和反应套路');
    expect(prompt.userPrompt).toContain('直接词表只在当前动作确实涉及对应部位时选用');
    expect(prompt.userPrompt).toContain('updateNpcFemaleProfile');
    expect(prompt.userPrompt).toContain('红颜系统');
    expect(prompt.userPrompt).toContain('adultPrivateProfile 已被投喂且当前剧情自然进入亲密/成人场景');
    expect(prompt.userPrompt).toContain('身体字段作为正文描写锚点');
    expect(prompt.userPrompt).toContain('不得机械罗列档案，也不得忽略已记录的稳定私密信息');
    expect(prompt.userPrompt).toContain('正文 NSFW 与档案信息分工');
    expect(prompt.userPrompt).toContain('正文写正在发生的动作、接触、摩擦');
    expect(prompt.userPrompt).toContain('身体字段是长期私密锚点和未来文生图锚点');
    expect(prompt.userPrompt).toContain('偏好、边界、敏感、风险、子宫和初夜字段是长期信息');
    expect(prompt.userPrompt).toContain('不得把 adultPrivateProfile 写成正文小作文');
    expect(prompt.userPrompt).toContain('避免诗化比喻、审美套话');
    expect(prompt.userPrompt).toContain('当前剧情事实 > 当前人物状态 > 女性档案稳定锚点 > 风格指南');
    expect(prompt.userPrompt).toContain('女性档案记录她的长期私密信息');
    expect(prompt.userPrompt).toContain('红颜系统记录她与主角这条关系线推进到哪里');
    expect(prompt.userPrompt).toContain('身体/情绪反应、稳定互动习惯');
    expect(prompt.userPrompt).not.toContain('长期稳定正文描写');
    expect(prompt.userPrompt).not.toContain('绕过年龄门禁');
    expect(prompt.userPrompt).not.toContain('无视年龄门禁');
    expect(prompt.userPrompt).toContain('## 关系沉浸最终复核');
    expect(prompt.userPrompt).toContain('具体部位、接触和动作仍必须直白清楚');
    expect(prompt.userPrompt).toContain('年龄是角色事实和门禁依据，不是情色风格标签');
    expect(prompt.userPrompt).toContain('正文可以在首次描写、身份辨识、年龄相关剧情或自然需要时写数字年龄、年龄段或成熟风格词');
    expect(prompt.userPrompt).toContain('“三十多岁”“四十出头”“熟女”“熟透”等年龄或成熟描述词都允许，不设禁词');
    expect(prompt.userPrompt).toContain('近期正文已经连续或高频使用同一年龄描述');
    expect(prompt.userPrompt).toContain('若本回合是首次或自然使用，应予保留');
    expect(prompt.userPrompt).toContain('静默对照已投喂的最近正文');
    expect(prompt.userPrompt).toContain('年龄称谓、身体修饰、动作起手、反应句式与场景收束');
    expect(prompt.userPrompt).toContain('若近期已经反复出现同一表达或同一动作骨架');
    const runtimeMessage = buildTurnUserMessage(
      prompt.userPrompt,
      prompt.stateWriterContext,
      prompt.adultIntimacyFinalReminder,
    );
    expect(runtimeMessage.endsWith(prompt.adultIntimacyFinalReminder)).toBe(true);
    expect(runtimeMessage.indexOf('## 关系沉浸最终复核'))
      .toBeGreaterThan(runtimeMessage.indexOf('## 回合输出要求'));
    expect(prompt.userPrompt.indexOf('## 关系沉浸最终复核'))
      .toBeGreaterThan(prompt.userPrompt.indexOf('地点 canonical 身份规则'));
    expect(prompt.userPrompt).not.toContain('## 直白写实最终复核');
  });

  it('injects the narrative prose style guide before adult intimacy guidance', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);

    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我观察陈衡的反应');

    const proseGuideIndex = prompt.userPrompt.indexOf('## 正文文风指南');
    const adultGuideIndex = prompt.userPrompt.indexOf('## 成人亲密描写指南');

    expect(proseGuideIndex).toBeGreaterThan(0);
    expect(adultGuideIndex).toBeGreaterThan(proseGuideIndex);
    expect(prompt.userPrompt).toContain('只选一至两种最适合当前因果的推进方式');
    expect(prompt.userPrompt).toContain('不得按“场面铺陈 → 玩家行动复述 → NPC 反馈 → 总结变化”的固定顺序');
    expect(prompt.userPrompt).toContain('默认从本回合最先发生变化的答复、动作、阻力或账目开始');
    expect(prompt.userPrompt).toContain('人物反应的表达顺序');
    expect(prompt.userPrompt).toContain('从“近期正文回放”中先识别已经用过的人物反应方式');
    expect(prompt.userPrompt).toContain('改用近期未出现');
    expect(prompt.userPrompt).toContain('普通正文优先直述事实');
    expect(prompt.userPrompt).toContain('NPC 的明确答复、条件或反对理由必须在前两段出现');
    expect(prompt.userPrompt).toContain('第一句 NPC 台词之前最多一条短旁白');
    expect(prompt.userPrompt).toContain('玩家方案只用一句话承接');
    expect(prompt.userPrompt).toContain('答复型回合的 narrativeText 第一段必须是被问 NPC 的台词');
    expect(prompt.userPrompt).toContain('表情姿态与环境氛围合计最多一处');
    expect(prompt.userPrompt).toContain('至少一半正文用于具体条件、账目、执行动作或可见后果');
    expect(prompt.userPrompt).not.toContain('目光、眼神、视线、眼底或眸色');
    expect(prompt.userPrompt).toContain('没有逐字引号时，不得把它扩写成 `【主角名】` 直接台词');
    expect(prompt.userPrompt).toContain('玩家只输入行动意图或概述时，禁止自行扩写 `【主角名】` 台词');
    expect(prompt.userPrompt).not.toContain('正文推进顺序：场面先立住');
    expect(prompt.userPrompt).not.toContain('每回合至少给出');
    expect(prompt.userPrompt).toContain('写清关键互动、行动反馈、人物取舍和局面变化');
    expect(prompt.userPrompt).toContain('行动尝试必须写出可观察反馈');
    expect(prompt.userPrompt).toContain('NPC 要保留自己的事务、节奏、顾虑和边界');
    expect(prompt.userPrompt).toContain('情绪变化必须有触发证据');
    expect(prompt.userPrompt).toContain('只写玩家当前能看见、听见或合理感知到的信息');
    expect(prompt.userPrompt).toContain('对照“近期正文回放”检查重复模式');
    expect(prompt.userPrompt).toContain('不是词语黑名单');
    expect(prompt.userPrompt).toContain('回合结尾优先落在新局面、新反馈、新可见细节或可互动点上');
    expect(prompt.userPrompt).not.toContain('雪中悍刀行');
    expect(prompt.userPrompt).not.toContain('世子很凶');
    expect(prompt.userPrompt).not.toContain('娱乐春秋');
  });

  it('uses prompt overrides for narrative prose style guidance at runtime', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    savePromptOverride('main.narrativeProseStyleGuide', 'NARRATIVE_PROSE_OVERRIDE_SENTINEL', storage);

    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我观察陈衡的反应');

    expect(prompt.userPrompt).toContain('NARRATIVE_PROSE_OVERRIDE_SENTINEL');
    expect(prompt.userPrompt).not.toContain('只选一至两种最适合当前因果的推进方式');
  });

  it('runs one silent prose review after output requirements and before the adult final reminder', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);

    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我继续观察局势');
    const runtimeMessage = buildTurnUserMessage(
      prompt.userPrompt,
      prompt.stateWriterContext,
      prompt.adultIntimacyFinalReminder,
      prompt.narrativeProseFinalReview,
    );

    expect(prompt.narrativeProseFinalReview).toContain('## 正文提交前静默终检');
    expect(prompt.narrativeProseFinalReview).toContain('同一次主正文生成');
    expect(prompt.narrativeProseFinalReview).toContain('不得新增第二次正文 API');
    expect(prompt.narrativeProseFinalReview).toContain('整组删去，直接从答复、动作、阻力或账目开始');
    expect(prompt.narrativeProseFinalReview).toContain('先概括近期已经使用过的反应方式');
    expect(prompt.narrativeProseFinalReview).toContain('改写为近期未出现且能提供新信息的');
    expect(prompt.narrativeProseFinalReview).toContain('删去仅用于增强程度的修辞性比较');
    expect(prompt.narrativeProseFinalReview).toContain('只写气氛、沉默、表情或天气而没有新事实的旁白段落');
    expect(prompt.narrativeProseFinalReview).toContain('答复型回合第一段不是被问 NPC 的台词时');
    expect(prompt.narrativeProseFinalReview).toContain('表情姿态与环境氛围合计不得超过一处');
    expect(prompt.narrativeProseFinalReview).not.toContain('目光、眼神、视线、眼底或眸色');
    expect(prompt.narrativeProseFinalReview).toContain('若没有，narrativeText 中 `【主角名】` 台词段数量必须为 0');
    expect(prompt.narrativeProseFinalReview).toContain('不是词语黑名单');
    expect(runtimeMessage.indexOf(prompt.narrativeProseFinalReview))
      .toBeGreaterThan(runtimeMessage.indexOf('## 回合输出要求'));
    expect(runtimeMessage.indexOf(prompt.adultIntimacyFinalReminder))
      .toBeGreaterThan(runtimeMessage.indexOf(prompt.narrativeProseFinalReview));
    expect(runtimeMessage.endsWith(prompt.adultIntimacyFinalReminder)).toBe(true);
    expect(runtimeMessage.split('## 正文提交前静默终检')).toHaveLength(2);
  });

  it('uses prompt overrides for the prose final review at runtime', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    savePromptOverride('main.narrativeProseFinalReview', 'NARRATIVE_FINAL_REVIEW_OVERRIDE_SENTINEL', storage);

    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我继续观察局势');

    expect(prompt.narrativeProseFinalReview).toBe('NARRATIVE_FINAL_REVIEW_OVERRIDE_SENTINEL');
    expect(prompt.userPrompt).toContain('NARRATIVE_FINAL_REVIEW_OVERRIDE_SENTINEL');
    expect(prompt.userPrompt).not.toContain('## 正文提交前静默终检');
  });

  it('projects at most one structured narrative momentum cue without taking the player decision', () => {
    const state = makeState();
    state.currentDate = '公元194年05月10日 10:00（巳时）';
    state.currentTime = { year: 194, month: 5, day: 10, hour: 10, minute: 0 };
    state.activeQuests = [
      {
        id: 'quest_due_grain_road',
        title: '守住粮道',
        description: '粮道将在午前遭袭。',
        status: 'active',
        priority: 'high',
        severity: 'critical',
        stakes: '粮道失守会迫使大营断粮。',
        deadlineAt: '公元194年05月10日 09:00（巳时）',
        createdAt: '公元194年05月09日 08:00（辰时）',
        updatedAt: '公元194年05月09日 20:00（戌时）',
      },
    ];

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我先留在营中观察消息');

    expect(prompt.narrativeMomentumCue).toMatchObject({
      sourceType: 'matter',
      sourceId: 'quest_due_grain_road',
      urgency: 'high',
    });
    expect(prompt.narrativeContext).toContain('Narrative Momentum / 本回合主要压力');
    expect(prompt.narrativeContext).toContain('sourceId=quest_due_grain_road');
    expect(prompt.narrativeContext).toContain('本回合最多只处理这一个主要压力源');
    expect(prompt.narrativeContext).toContain('不得替玩家接受任务、结盟、宣战、婚配、处分人物或消耗关键资源');
    expect(composePrompt(worldBook, undefined, [], undefined, makeState(), '我继续观察').narrativeMomentumCue)
      .toBeUndefined();
  });

  it('projects source-aware military supply truth as read-only narrative context', () => {
    const state = makeState();
    state.currentDate = '公元189年08月15日 10:00（巳时）';
    state.currentTime = { year: 189, month: 8, day: 15, hour: 10, minute: 0 };
    state.resources = {
      money: 50,
      grain: 1000,
      horses: 20,
      arms: 20,
      recruits: 0,
      weapons: [],
      documents: [],
      tokens: [],
      importantSupplies: [],
    };
    state.troops = [{
      troopId: 'troop_prompt_supply',
      name: '营中步卒',
      size: 100,
      factionId: 'faction_player',
      troopType: '步卒',
      quality: '中',
      lifecycleStatus: 'active',
      morale: 70,
      training: 65,
      supplies: 60,
      task: '驻防',
      relationToPlayer: '你直接统领',
      locationId: state.currentLocationId,
      upkeepSource: 'player_resources',
    }];

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我请军需官核对下月开支');

    expect(prompt.militarySupplyNarrativeProjection).toMatchObject({
      activeTroopCount: 1,
      currentResources: { money: 50, grain: 1000 },
      nextMonthlyUpkeepAt: '189-09-01 08:00',
      nextAnnualSettlementAt: '189-09-01 08:00',
    });
    expect(prompt.narrativeContext).toContain('Military Supply Truth / 军需叙事真值（本地只读）');
    expect(prompt.narrativeContext).toContain('正式军需官、账房或有账册依据者必须以此为数值锚点');
    expect(prompt.narrativeContext).toContain('必须逐项复述投影中的数值与单位');
    expect(prompt.narrativeContext).toContain('普通人物可以不知道精确值');
    expect(prompt.narrativeContext).toContain('不得写入或覆盖本地月度军需与九月年度结算');
  });

  it('projects established heroine and bond threads into the main prompt as compact continuity context', () => {
    const prompt = composePrompt(
      worldBook,
      undefined,
      [],
      undefined,
      makeRelationshipProjectionState(),
      '我观察何氏与陈衡的反应',
    );

    expect(prompt.narrativeContext).toContain('关系线承接');
    expect(prompt.narrativeContext).toContain('已成立长期关系线');
    expect(prompt.narrativeContext).toContain('不是待生成任务池');
    expect(prompt.narrativeContext).toContain('heroine_npc_lady_he');
    expect(prompt.narrativeContext).toContain('互信成形');
    expect(prompt.narrativeContext).toContain('bond_gate_oath');
    expect(prompt.narrativeContext).toContain('sworn');
    expect(prompt.narrativeContext).not.toContain('ARCHIVED_HEROINE_SHOULD_NOT_APPEAR');
    expect(prompt.narrativeContext).not.toContain('ARCHIVED_BOND_SHOULD_NOT_APPEAR');
    expect(prompt.userPrompt).toContain('关系线承接');
  });

  it('uses prompt overrides for relationship thread projection guidance at runtime', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    savePromptOverride('main.relationshipThreadProjectionGuide', 'RELATIONSHIP_GUIDE_OVERRIDE_SENTINEL', storage);

    const prompt = composePrompt(
      worldBook,
      undefined,
      [],
      undefined,
      makeRelationshipProjectionState(),
      '我观察关系变化',
    );

    expect(prompt.narrativeContext).toContain('RELATIONSHIP_GUIDE_OVERRIDE_SENTINEL');
    expect(prompt.narrativeContext).not.toContain('不是待生成任务池');
  });

  it('tells the state writer not to create new pregnancy opportunities when the setting is off', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    savePregnancyModeToStorage('off', storage);

    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '继续当前剧情');

    expect(prompt.stateWriterContext).toContain('怀孕与子嗣承接当前设置=off');
    expect(prompt.stateWriterContext).toContain('当前已关闭：不得输出 recordPregnancyRisk');
    expect(prompt.stateWriterContext).toContain('既有孕期仍由引擎推进');
  });

  it('injects direct realism guidance when the adult intimacy style setting selects it', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    saveAdultIntimacyStyleToStorage('directRealism', storage);

    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我与成年伴侣独处');

    expect(prompt.userPrompt).toContain('## 成人亲密描写指南');
    expect(prompt.userPrompt).toContain('## 成人亲密描写风格：直白写实');
    expect(prompt.userPrompt).toContain('动作、触感、呼吸、体温、身体反应和感官细节更直接');
    expect(prompt.userPrompt).toContain('少修饰，不用诗化比喻、审美套话或含蓄代称替代具体动作与反应');
    expect(prompt.userPrompt).toContain('直白写实是成人场景内的最高文体约束');
    expect(prompt.userPrompt).toContain('禁止委婉语、含蓄代称与以景代事');
    expect(prompt.userPrompt).toContain('肉棒、龟头、阴茎、小穴、阴蒂、乳头、蜜液、精液、穴口、臀缝');
    expect(prompt.userPrompt).toContain('当前动作 → 接触部位 → 力度与节奏 → 摩擦、湿度与体液');
    expect(prompt.userPrompt).toContain('禁止用“像、仿佛、如同、宛如、似”等比喻句作替代');
    expect(prompt.userPrompt).toContain('先立当前近景、双方站位或姿势、衣物状态与正在发生的动作');
    expect(prompt.userPrompt).toContain('每个动作必须引出对方可观察的身体、语言或情绪反馈');
    expect(prompt.userPrompt).toContain('直接词表只在当前动作确实涉及对应部位时选用');
    expect(prompt.userPrompt).toContain('## 直白写实最终复核');
    expect(prompt.userPrompt).toContain('输出前静默逐句复查成人段落');
    expect(prompt.userPrompt).toContain('年龄是角色事实和门禁依据，不是情色风格标签');
    expect(prompt.userPrompt).toContain('正文可以在首次描写、身份辨识、年龄相关剧情或自然需要时写数字年龄、年龄段或成熟风格词');
    expect(prompt.userPrompt).toContain('“三十多岁”“四十出头”“熟女”“熟透”等年龄或成熟描述词都允许，不设禁词');
    expect(prompt.userPrompt).toContain('近期正文已经连续或高频使用同一年龄描述');
    expect(prompt.userPrompt).toContain('若本回合是首次或自然使用，应予保留');
    expect(prompt.userPrompt).toContain('静默对照已投喂的最近正文');
    expect(prompt.userPrompt).toContain('若近期已经反复出现同一表达或同一动作骨架');
    expect(prompt.userPrompt.indexOf('## 直白写实最终复核'))
      .toBeGreaterThan(prompt.userPrompt.indexOf('地点 canonical 身份规则'));
    expect(prompt.userPrompt).not.toContain('## 成人亲密描写风格：关系沉浸');
  });

  it('uses prompt overrides for adult intimacy guidance at runtime', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    saveAdultIntimacyStyleToStorage('directRealism', storage);
    savePromptOverride('nsfw.adultIntimacy.commonProtocol', 'COMMON_ADULT_PROTOCOL_OVERRIDE_SENTINEL', storage);
    savePromptOverride('nsfw.adultIntimacy.directRealism', 'DIRECT_REALISM_OVERRIDE_SENTINEL', storage);

    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我与成年伴侣独处');

    expect(prompt.userPrompt).toContain('COMMON_ADULT_PROTOCOL_OVERRIDE_SENTINEL');
    expect(prompt.userPrompt).toContain('DIRECT_REALISM_OVERRIDE_SENTINEL');
    expect(prompt.userPrompt).not.toContain('动作、触感、呼吸、体温、身体反应和感官细节更直接');
    expect(prompt.userPrompt).toContain('年龄复核');
    expect(prompt.userPrompt).toContain('年龄是角色事实和门禁依据，不是情色风格标签');
  });

  it('projects player and relevant NPC unique arts into prompt context', () => {
    const state = makeState();
    const enrichedState = {
      ...state,
      player: {
        ...state.player,
        uniqueArts: [
          {
            id: 'art_calm_blade',
            name: '静刃识机',
            rarity: 'blue',
            domain: 'personalCombat',
            level: 2,
            maxLevel: 5,
            progress: 35,
            description: '乱局中凭短兵与观察捕捉破绽。',
            effectSummary: '个人战中有利于先察敌势、守中反击。',
            source: 'opening',
            promptHint: '单挑、近身冲突或伏击自保时，应体现主角冷静辨机。',
            checkHooks: [{ scope: 'combat', modifier: 6, note: '短兵交锋时更易抓住破绽。' }],
          },
        ],
      },
      npcs: (state.npcs ?? []).map((npc) =>
        npc.npcId === 'npc_chen_heng'
          ? ({
              ...npc,
              uniqueArts: [
                {
                  id: 'art_river_brave',
                  name: '江湖胆气',
                  rarity: 'green',
                  domain: 'social',
                  level: 1,
                  description: '能在市井冲突中稳住局面。',
                  effectSummary: '交涉或冲突时不易被威吓。',
                  source: 'profile',
                  promptHint: '陈衡在市井谈判和冲突中会显得胆气足。',
                },
              ],
            } as LuanShiNpc)
          : npc,
      ),
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, '我观察陈衡');

    expect(prompt.narrativeContext).toContain('绝艺：静刃识机');
    expect(prompt.narrativeContext).toContain('personalCombat');
    expect(prompt.narrativeContext).toContain('Lv.2/5');
    expect(prompt.narrativeContext).toContain('个人战中有利于先察敌势、守中反击');
    expect(prompt.userPrompt).toContain('江湖胆气');
    expect(prompt.userPrompt).toContain('交涉或冲突时不易被威吓');
  });

  it('projects relevant NPC loadout into state writer context', () => {
    const state = makeState();
    const enrichedState = {
      ...state,
      npcs: (state.npcs ?? []).map((npc) =>
        npc.npcId === 'npc_chen_heng'
          ? ({
              ...npc,
              isFocused: true,
              equipment: [
                {
                  id: 'eq_chen_heng_sabre',
                  slot: 'weapon',
                  name: '环首刀',
                  quality: '军中旧制',
                  description: '陈衡随身旧刀。',
                  promptHint: '近身格斗可形成小幅优势。',
                },
              ],
              inventory: [
                {
                  id: 'item_chen_heng_pass',
                  name: '营门木符',
                  quantity: 1,
                  category: 'token',
                  description: '营门出入资格。',
                  keyItem: true,
                },
              ],
            } as LuanShiNpc)
          : npc,
      ),
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, '请陈衡陪我夜探营门。');

    expect(prompt.stateWriterContext).toContain('npcLoadout: 装备=武器-环首刀');
    expect(prompt.stateWriterContext).toContain('携物=营门木符x1');
    expect(prompt.stateWriterContext).toContain('payload.command.action=updateNpcLoadout');
    expect(prompt.stateWriterContext).toContain('NPC 装备、携物');
    expect(prompt.stateWriterContext).toContain('必须包含 npcId/npcName');
    expect(prompt.stateWriterContext).toContain('参战 NPC 的武器、防具、坐骑、宝物、关键携物、特质和绝艺');
    expect(prompt.userPrompt).toContain('直接参与或对抗 NPC 的六维、特质、绝艺、装备和携物');
  });

  it.each([
    {
      scene: '普通判定',
      playerInput: '我请陈衡判断门吏话中真假',
      compatibleItem: {
        id: 'item_chen_heng_counting_sticks',
        name: '旧算筹',
        quantity: 1,
        category: 'misc',
        quality: '旧物',
        description: '陈衡随手记录人情往来的杂物。',
        statBonuses: { 交涉: 3 },
        promptHint: '盘问与核对口供时可辅助判断。',
        checkHooks: [{ scope: 'ordinaryCheck.deception', modifier: 3, note: '记录可供比对。' }],
        unlocks: ['核对旧账'],
        risks: ['记录不全可能误导'],
      } as InventoryItem,
      incompatibleItem: {
        id: 'item_chen_heng_combat_wrap',
        name: '旧战腕带',
        quantity: 1,
        category: 'misc',
        quality: '旧物',
        description: '平日收在行囊底部。',
        statBonuses: { 格挡: 4 },
        promptHint: '只在近身交锋中提供帮助。',
        checkHooks: [{ scope: 'personalCombat.guard', modifier: 4, note: '缓冲兵刃冲击。' }],
      } as InventoryItem,
      expectedAnchors: [
        'statBonuses=交涉+3',
        'promptHint=盘问与核对口供时可辅助判断。',
        'checkHooks=ordinaryCheck.deception:+3(记录可供比对。)',
      ],
    },
    {
      scene: '个人战',
      playerInput: '我与陈衡并肩迎战追兵',
      compatibleItem: {
        id: 'item_chen_heng_wrist_wrap',
        name: '旧护腕内衬',
        quantity: 1,
        category: 'misc',
        quality: '旧物',
        description: '陈衡平日随身携带的护腕内衬。',
        statBonuses: { 格挡: 2 },
        promptHint: '近身缠斗时可减轻手腕冲击。',
        checkHooks: [{ scope: 'personalCombat.guard', modifier: 2, note: '护腕缓冲冲击。' }],
        unlocks: ['稳住持刀手'],
        risks: ['浸水后变得沉重'],
      } as InventoryItem,
      incompatibleItem: {
        id: 'item_chen_heng_testimony_notes',
        name: '旧口供札记',
        quantity: 1,
        category: 'misc',
        quality: '旧物',
        description: '平日收在行囊底部。',
        statBonuses: { 辨伪: 4 },
        promptHint: '只在核对口供时提供帮助。',
        checkHooks: [{ scope: 'ordinaryCheck.deception', modifier: 4, note: '可比对前后说辞。' }],
      } as InventoryItem,
      expectedAnchors: [
        'statBonuses=格挡+2',
        'promptHint=近身缠斗时可减轻手腕冲击。',
        'checkHooks=personalCombat.guard:+2(护腕缓冲冲击。)',
      ],
    },
  ])('projects only scene-compatible non-key NPC inventory judgement anchors for $scene', ({
    playerInput,
    compatibleItem,
    incompatibleItem,
    expectedAnchors,
  }) => {
    const state = makeState();
    const enrichedState = {
      ...state,
      npcs: (state.npcs ?? []).map((npc) => {
        if (npc.npcId === 'npc_chen_heng') {
          return {
            ...npc,
            inventory: [compatibleItem, incompatibleItem],
          } as LuanShiNpc;
        }
        return {
          ...npc,
          inventory: [{
            id: 'item_far_unrelated',
            name: 'UNRELATED_NPC_LOADOUT_SENTINEL',
            quantity: 1,
            category: 'misc',
            promptHint: 'UNRELATED_NPC_ANCHOR_SENTINEL',
            checkHooks: [{ scope: 'ordinaryCheck.remote', modifier: 99, note: '不应泄漏。' }],
          }],
        } as LuanShiNpc;
      }),
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, playerInput);
    const llmUserMessage = buildTurnUserMessage(prompt.userPrompt, prompt.stateWriterContext);

    expect(playerInput).not.toContain(compatibleItem.name);
    expect(playerInput).not.toContain(compatibleItem.description);
    expect(playerInput).not.toContain(compatibleItem.category);
    expect(playerInput).not.toContain(compatibleItem.quality);
    expect(llmUserMessage).toContain(`携物=${compatibleItem.name}x1`);
    for (const anchor of expectedAnchors) expect(llmUserMessage).toContain(anchor);
    expect(llmUserMessage).not.toContain(incompatibleItem.name);
    expect(llmUserMessage).not.toContain(incompatibleItem.promptHint);
    expect(llmUserMessage).not.toContain('UNRELATED_NPC_LOADOUT_SENTINEL');
    expect(llmUserMessage).not.toContain('UNRELATED_NPC_ANCHOR_SENTINEL');
  });

  it.each([
    {
      scene: '普通判定',
      playerInput: '请陈衡替伤者包扎止血',
      actionIntent: 'interact' as const,
      compatibleEquipmentHook: 'ordinaryCheck.medicine:+2(ORDINARY_EQUIPMENT_HOOK)',
      incompatibleEquipmentHook: 'combat.guard:+5(COMBAT_EQUIPMENT_HOOK)',
      compatibleInventoryHook: 'ordinaryCheck.medicine:+3(ORDINARY_INVENTORY_HOOK)',
      incompatibleInventoryHook: 'personalCombat.ranged:+6(COMBAT_INVENTORY_HOOK)',
    },
    {
      scene: '个人战',
      playerInput: '命陈衡放箭射敌',
      actionIntent: 'combat' as const,
      compatibleEquipmentHook: 'combat.guard:+5(COMBAT_EQUIPMENT_HOOK)',
      incompatibleEquipmentHook: 'ordinaryCheck.medicine:+2(ORDINARY_EQUIPMENT_HOOK)',
      compatibleInventoryHook: 'personalCombat.ranged:+6(COMBAT_INVENTORY_HOOK)',
      incompatibleInventoryHook: 'ordinaryCheck.medicine:+3(ORDINARY_INVENTORY_HOOK)',
    },
  ])('filters mixed NPC equipment and inventory hooks in the final $scene projection', ({
    playerInput,
    actionIntent,
    compatibleEquipmentHook,
    incompatibleEquipmentHook,
    compatibleInventoryHook,
    incompatibleInventoryHook,
  }) => {
    const state = makeState();
    const enrichedState = {
      ...state,
      npcs: (state.npcs ?? []).map((npc) => npc.npcId === 'npc_chen_heng'
        ? ({
            ...npc,
            equipment: [{
              id: 'eq_mixed_hooks',
              slot: 'weapon',
              name: '混合判定短弓',
              quality: '旧物',
              description: '可用于救治时固定夹板，也可在交锋中放箭。',
              checkHooks: [
                { scope: 'ordinaryCheck.medicine', modifier: 2, note: 'ORDINARY_EQUIPMENT_HOOK' },
                { scope: 'combat.guard', modifier: 5, note: 'COMBAT_EQUIPMENT_HOOK' },
              ],
            }],
            inventory: [
              {
                id: 'item_mixed_hooks',
                name: '混合判定布卷',
                quantity: 1,
                category: 'misc',
                checkHooks: [
                  { scope: 'ordinaryCheck.medicine', modifier: 3, note: 'ORDINARY_INVENTORY_HOOK' },
                  { scope: 'personalCombat.ranged', modifier: 6, note: 'COMBAT_INVENTORY_HOOK' },
                ],
              },
              {
                id: 'item_explicit_token',
                name: '显式令符',
                quantity: 1,
                category: 'token',
                keyItem: true,
                checkHooks: actionIntent === 'combat'
                  ? [{ scope: 'ordinaryCheck.identity', modifier: 4, note: 'INCOMPATIBLE_KEY_ITEM_HOOK' }]
                  : [{ scope: 'personalCombat.command', modifier: 4, note: 'INCOMPATIBLE_KEY_ITEM_HOOK' }],
              },
            ],
          } as LuanShiNpc)
        : npc),
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, playerInput, { actionIntent });
    const llmUserMessage = buildTurnUserMessage(prompt.userPrompt, prompt.stateWriterContext);

    expect(llmUserMessage).toContain('装备=武器-混合判定短弓');
    expect(llmUserMessage).toContain('混合判定布卷x1');
    expect(llmUserMessage).toContain('显式令符x1');
    expect(llmUserMessage).toContain(compatibleEquipmentHook);
    expect(llmUserMessage).toContain(compatibleInventoryHook);
    expect(llmUserMessage).not.toContain(incompatibleEquipmentHook);
    expect(llmUserMessage).not.toContain(incompatibleInventoryHook);
    expect(llmUserMessage).not.toContain('INCOMPATIBLE_KEY_ITEM_HOOK');
    expect(llmUserMessage).not.toContain('显式令符x1（token，关键，checkHooks=');
    expect(llmUserMessage).not.toContain('checkHooks=、');
  });

  it('projects unclassified legacy hooks only for explicitly mentioned NPC loadout items', () => {
    const state = makeState();
    const enrichedState = {
      ...state,
      npcs: (state.npcs ?? []).map((npc) => npc.npcId === 'npc_chen_heng'
        ? ({
            ...npc,
            equipment: [
              {
                id: 'eq_named_legacy_scope',
                slot: 'treasure',
                name: '明示旧药箱',
                quality: '旧物',
                description: '收纳救治器具。',
                checkHooks: [
                  { scope: 'medicine', modifier: 2, note: 'EXPLICIT_UNKNOWN_EQUIPMENT_HOOK' },
                  { scope: 'ordinaryCheck.medicine', modifier: 1, note: 'EXPLICIT_ORDINARY_EQUIPMENT_HOOK' },
                  { scope: 'personalCombat.guard', modifier: 8, note: 'EXPLICIT_COMBAT_EQUIPMENT_HOOK' },
                ],
              },
              {
                id: 'eq_unmentioned_legacy_scope',
                slot: 'weapon',
                name: '未点名旧针具',
                quality: '旧物',
                description: '收在箱底。',
                checkHooks: [{ scope: '医疗', modifier: 9, note: 'UNMENTIONED_UNKNOWN_EQUIPMENT_HOOK' }],
              },
            ],
            inventory: [
              {
                id: 'item_named_legacy_scope',
                name: '明示银针包',
                quantity: 1,
                category: 'misc',
                checkHooks: [
                  { scope: '医疗', modifier: 3, note: 'EXPLICIT_UNKNOWN_INVENTORY_HOOK' },
                  { scope: 'ordinaryCheck.medicine', modifier: 1, note: 'EXPLICIT_ORDINARY_INVENTORY_HOOK' },
                  { scope: 'combat.melee', modifier: 8, note: 'EXPLICIT_COMBAT_INVENTORY_HOOK' },
                ],
              },
              {
                id: 'item_unmentioned_legacy_scope',
                name: '未点名旧药布',
                quantity: 1,
                category: 'misc',
                checkHooks: [{ scope: 'medicine', modifier: 9, note: 'UNMENTIONED_UNKNOWN_INVENTORY_HOOK' }],
              },
              {
                id: 'item_key_legacy_scope',
                name: '未点名关键令符',
                quantity: 1,
                category: 'token',
                keyItem: true,
                checkHooks: [{ scope: 'medicine', modifier: 9, note: 'KEY_ITEM_UNKNOWN_HOOK' }],
              },
            ],
          } as LuanShiNpc)
        : npc),
    } as RuntimeState;
    const playerInput = '我请陈衡打开明示旧药箱，取出明示银针包替伤者疗伤';

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, playerInput, { actionIntent: 'interact' });
    const llmUserMessage = buildTurnUserMessage(prompt.userPrompt, prompt.stateWriterContext);

    expect(llmUserMessage).toContain('装备=宝物-明示旧药箱');
    expect(llmUserMessage).toContain('明示银针包x1');
    expect(llmUserMessage).toContain('语义判断hooks=medicine:+2(EXPLICIT_UNKNOWN_EQUIPMENT_HOOK)');
    expect(llmUserMessage).toContain('语义判断hooks=医疗:+3(EXPLICIT_UNKNOWN_INVENTORY_HOOK)');
    expect(llmUserMessage).toContain('EXPLICIT_ORDINARY_EQUIPMENT_HOOK');
    expect(llmUserMessage).toContain('EXPLICIT_ORDINARY_INVENTORY_HOOK');
    expect(llmUserMessage).not.toContain('EXPLICIT_COMBAT_EQUIPMENT_HOOK');
    expect(llmUserMessage).not.toContain('EXPLICIT_COMBAT_INVENTORY_HOOK');
    expect(llmUserMessage).not.toContain('UNMENTIONED_UNKNOWN_EQUIPMENT_HOOK');
    expect(llmUserMessage).not.toContain('UNMENTIONED_UNKNOWN_INVENTORY_HOOK');
    expect(llmUserMessage).toContain('未点名关键令符x1');
    expect(llmUserMessage).not.toContain('KEY_ITEM_UNKNOWN_HOOK');
  });

  it('prioritizes explicitly mentioned NPC inventory over incompatible anchors and keeps the six-item cap', () => {
    const state = makeState();
    const incompatibleItems: InventoryItem[] = Array.from({ length: 6 }, (_, index): InventoryItem => ({
      id: `item_incompatible_anchor_${index + 1}`,
      name: `无关判定锚点${index + 1}`,
      quantity: 1,
      category: 'misc',
      ...(index < 3
        ? {
            promptHint: '只在个人战中生效。',
            checkHooks: [{ scope: 'personalCombat.melee', modifier: 1, note: '当前普通场景不适用。' }],
          }
        : {
            statBonuses: { 泛化加成: 1 },
            promptHint: '没有结构化 scope 的泛化提示。',
            unlocks: ['泛化解锁'],
            risks: ['泛化风险'],
          }),
    }));
    const explicitlyMentionedItems: InventoryItem[] = Array.from({ length: 7 }, (_, index) => ({
      id: `item_explicit_${index + 1}`,
      name: `明示携物${index + 1}`,
      quantity: 1,
      category: 'misc',
      description: '等待玩家明确点名。',
    }));
    const playerInput = `我请陈衡搜查并核对${explicitlyMentionedItems.map((item) => item.name).join('、')}`;
    const enrichedState = {
      ...state,
      npcs: (state.npcs ?? []).map((npc) => npc.npcId === 'npc_chen_heng'
        ? ({ ...npc, inventory: [...incompatibleItems, ...explicitlyMentionedItems] } as LuanShiNpc)
        : npc),
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, playerInput);
    const llmUserMessage = buildTurnUserMessage(prompt.userPrompt, prompt.stateWriterContext);

    expect(llmUserMessage).toContain(`携物=${explicitlyMentionedItems[0].name}x1`);
    for (const item of incompatibleItems) expect(llmUserMessage).not.toContain(item.name);
    for (const item of explicitlyMentionedItems.slice(0, 6)) expect(llmUserMessage).toContain(`${item.name}x1`);
    expect(llmUserMessage).not.toContain(`${explicitlyMentionedItems[6].name}x1`);
  });

  it('使用切片上下文，包含当前 NPC 记忆并排除无关远处记忆', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我观察陈衡');

    expect(prompt.userPrompt).toContain('当前地点：市镇');
    expect(prompt.userPrompt).toContain('在场人物：陈衡');
    expect(prompt.userPrompt).toContain('陈衡亲眼见到主角救下伤者。');
    expect(prompt.userPrompt).not.toContain('这条远方记忆不应进入当前 prompt。');
  });

  it('背包只投喂当前相关物品，不把全部本地物品塞入主 prompt', () => {
    const state = makeState();
    const enrichedState = {
      ...state,
      player: {
        ...state.player,
        inventory: [
          ...(state.player.inventory ?? []),
          {
            id: 'item_gate_token',
            name: '官署符传',
            quantity: 1,
            category: 'token',
            description: '可在官署门前验明身份。',
          },
          {
            id: 'item_secret_scroll',
            name: '密令竹简',
            quantity: 1,
            category: 'document',
            keyItem: true,
            quality: '蓝',
            description: 'KEY_ITEM_LONG_DESCRIPTION_SENTINEL 这段完整说明只应留在本地背包详情，不应默认塞入主 prompt。',
          },
          {
            id: 'item_unrelated_sentinal',
            name: 'UNRELATED_INVENTORY_SENTINEL',
            quantity: 1,
            category: 'misc',
            description: '与当前行动无关的本地物品。',
            statBonuses: { 玩家锚点不应放宽: 9 },
            promptHint: 'UNRELATED_PLAYER_ANCHOR_SENTINEL',
            checkHooks: [{ scope: 'ordinaryCheck.unrelated', modifier: 9, note: '不应进入主 prompt。' }],
          },
        ],
      },
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, '我拿官署符传去官署门前求见');

    expect(prompt.narrativeContext).toContain('当前相关背包');
    expect(prompt.narrativeContext).toContain('官署符传');
    expect(prompt.narrativeContext).toContain('密令竹简');
    expect(prompt.narrativeContext).toContain('document');
    expect(prompt.narrativeContext).not.toContain('KEY_ITEM_LONG_DESCRIPTION_SENTINEL');
    expect(prompt.narrativeContext).not.toContain('可在官署门前验明身份。');
    expect(prompt.narrativeContext).not.toContain('UNRELATED_INVENTORY_SENTINEL');
    expect(prompt.userPrompt).not.toContain('UNRELATED_INVENTORY_SENTINEL');
    expect(prompt.userPrompt).not.toContain('UNRELATED_PLAYER_ANCHOR_SENTINEL');
  });

  it('向状态写回投影完整物品稳定 ID，正文上下文仍只使用相关自然名称', () => {
    const state = makeState();
    const inventoryState = {
      ...state,
      player: {
        ...state.player,
        personalMoney: 235,
        inventory: [
          {
            id: 'item_caishi_supply_order',
            name: '蔡氏私库调拨手令',
            quantity: 1,
            category: 'documents',
            keyItem: true,
            description: '提取粮草时交回。',
          },
          ...Array.from({ length: 7 }, (_, index) => ({
            id: `item_unrelated_${index + 1}`,
            name: `无关物品${index + 1}`,
            quantity: 1,
            category: 'misc',
            description: '本回合没有提及。',
          })),
        ],
      },
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, inventoryState, '我凭手令提取粮草并交回手令');

    expect(prompt.stateWriterContext).toContain('playerEconomySnapshot:');
    expect(prompt.stateWriterContext).toContain('personalMoney: 235');
    expect(prompt.stateWriterContext).toContain('itemId: item_caishi_supply_order');
    expect(prompt.stateWriterContext).toContain('name: 蔡氏私库调拨手令');
    expect(prompt.stateWriterContext).toContain('quantity: 1');
    expect(prompt.stateWriterContext).toContain('itemId: item_unrelated_7');
    expect(prompt.stateWriterContext).toContain('单一物品操作范围');
    expect(prompt.stateWriterContext).toContain('不得因为其他物品同属手令、凭证、文书、药品');
    expect(prompt.stateWriterContext).toContain('玩家行动必须逐项明确点名这些物品');
    expect(prompt.narrativeContext).toContain('蔡氏私库调拨手令');
    expect(prompt.narrativeContext).not.toContain('item_caishi_supply_order');
    expect(prompt.narrativeContext).not.toContain('无关物品7');
  });

  it('主角装备常驻投喂短锚点，不展开装备完整说明和提示', () => {
    const state = makeState();
    const enrichedState = {
      ...state,
      player: {
        ...state.player,
        equipment: [
          {
            id: 'eq_named_spear',
            slot: 'weapon',
            name: '青纹长矛',
            quality: '精良',
            description: 'EQUIPMENT_LONG_DESCRIPTION_SENTINEL 这段装备完整说明只应留在本地详情。',
            promptHint: 'EQUIPMENT_PROMPT_HINT_SENTINEL 这段判定提示不应每回合常驻投喂。',
          },
        ],
      },
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, '我观察陈衡');

    expect(prompt.narrativeContext).toContain('装备：武器-青纹长矛（精良）');
    expect(prompt.narrativeContext).not.toContain('EQUIPMENT_LONG_DESCRIPTION_SENTINEL');
    expect(prompt.narrativeContext).not.toContain('EQUIPMENT_PROMPT_HINT_SENTINEL');
  });

  it('projects NPC dynamic simulation intents as advisory context rather than settled facts', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我询问陈衡', {
      npcIntentPackage: {
        protocolVersion: 'coc.v2.npcIntent.v1',
        generatedAt: '乱世元年2月',
        source: 'npcSimulation',
        intents: [
          {
            npcId: 'npc_chen_heng',
            npcName: '陈衡',
            shouldAct: true,
            intent: '陈衡先不答应，只反问主角想要什么。',
            trigger: '听到主角直接询问时触发',
            perceptionBasis: '陈衡在场，能听见主角发问。',
            relationshipBasis: '刚认识但对主角有好奇。',
            emotionalState: '谨慎试探',
            confidence: 0.74,
          },
        ],
      },
    });

    expect(prompt.narrativeContext).toContain('未裁定 NPC 意图建议');
    expect(prompt.narrativeContext).toContain('这不是已发生事实');
    expect(prompt.narrativeContext).toContain('陈衡先不答应');
    expect(prompt.userPrompt).toContain('未裁定 NPC 意图建议');
  });

  it('projects remote NPC presence beats as advisory context rather than settled facts', () => {
    const state = {
      ...makeState(),
      npcAwarenessIndex: [
        {
          awarenessId: 'aware_zhang_miao',
          name: '张邈',
          sourceType: 'rumor',
          sourceIds: ['signal_recruit'],
          contactLevel: 0,
          historicalImportance: 70,
          playerRelevance: ['same-location', 'recruiting-troops'],
          unresolvedHooks: ['张邈正在招募兵马，可能注意到本地有名望或兵力的人'],
          knownToPlayer: true,
          archiveVisible: false,
          updatedAt: '乱世元年2月',
        },
      ],
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我在本地打探招募动向');

    expect(prompt.narrativeContext).toContain('远场 NPC 存在感候选');
    expect(prompt.narrativeContext).toContain('张邈');
    expect(prompt.narrativeContext).toContain('未裁定建议');
    expect(prompt.narrativeContext).toContain('不是已发生事实');
    expect(prompt.userPrompt).toContain('远场 NPC 存在感候选');
    expect(prompt.stateWriterContext).toContain('payload.type=npcPresenceUpdated');
    expect(prompt.stateWriterContext).toContain('payload.type=npcAwarenessRegistered');
    expect(prompt.stateWriterContext).toContain('entity state changes require separate structured writeback');
  });

  it('将 NPC 记忆按人物分块限量投喂，带上游戏内时间和来源', () => {
    const state = makeState();
    const enrichedState = {
      ...state,
      npcs: (state.npcs ?? []).map((npc) =>
        npc.npcId === 'npc_chen_heng'
          ? ({
              ...npc,
              memories: [
                { memoryId: 'mem_chen_1', source: '亲历', content: '陈衡第1条旧记忆不应投喂。', createdAt: '乱世元年2月01日' },
                { memoryId: 'mem_chen_2', source: '亲历', content: '陈衡第2条旧记忆也不应投喂。', createdAt: '乱世元年2月02日' },
                { memoryId: 'mem_chen_3', source: '亲历', content: '陈衡第3条近期记忆应投喂。', createdAt: '乱世元年2月03日' },
                { memoryId: 'mem_chen_4', source: '误会', content: '陈衡第4条最新误会应投喂。', createdAt: '乱世元年2月04日' },
              ],
            } as LuanShiNpc)
          : npc,
      ),
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, '我继续观察陈衡');

    expect(prompt.narrativeContext).toContain('NPC记忆投影：');
    expect(prompt.narrativeContext).toContain('陈衡（在场/普通，近期4/4条）');
    expect(prompt.narrativeContext).toContain('乱世元年2月03日｜亲历：陈衡第3条近期记忆应投喂。');
    expect(prompt.narrativeContext).toContain('乱世元年2月04日｜误会：陈衡第4条最新误会应投喂。');
    expect(prompt.narrativeContext).toContain('陈衡第1条旧记忆不应投喂。');
    expect(prompt.narrativeContext).toContain('陈衡第2条旧记忆也不应投喂。');
    expect(prompt.narrativeContext).not.toContain('这条远方记忆不应进入当前 prompt。');
  });

  it('投影已有分层记忆档案，但只包含当前相关的摘要层', () => {
    const state = makeState();
    const enrichedState = {
      ...state,
      memoryArchive: {
        recentTurnSummaries: [
          {
            id: 'recent_1',
            turnNumber: 1,
            createdAt: '乱世元年2月01日',
            brief: '主角救下伤者，陈衡开始注意主角。',
            playerActionSummary: '主角出手救人。',
            visibleConsequence: '陈衡目睹此事。',
            importance: 'medium',
          },
        ],
        midTermSummaries: [
          {
            summaryId: 'mid_market',
            title: '市镇风波',
            fromCreatedAt: '乱世元年2月01日',
            toCreatedAt: '乱世元年2月03日',
            summary: '主角在市镇连续卷入流民与游侠纠纷。',
            relatedNpcIds: ['npc_chen_heng'],
            relatedLocationIds: ['loc_market_town'],
            updatedAt: '乱世元年2月03日',
          },
        ],
        longTermFacts: [
          {
            factId: 'fact_promise',
            category: 'promise',
            createdAt: '乱世元年2月02日',
            summary: '主角曾承诺护送伤者离开市镇。',
            importance: 'high',
            relatedNpcIds: ['npc_chen_heng'],
            relatedLocationIds: ['loc_market_town'],
          },
        ],
        npcInteractionSummaries: [
          {
            npcId: 'npc_chen_heng',
            npcName: '陈衡',
            summary: '陈衡因主角救人而产生兴趣，但仍在试探。',
            fromCreatedAt: '乱世元年2月01日',
            toCreatedAt: '乱世元年2月03日',
            updatedAt: '乱世元年2月03日',
          },
          {
            npcId: 'npc_far',
            npcName: '远处人物',
            summary: '这条离场无关 NPC 摘要不应投喂。',
            updatedAt: '乱世元年2月03日',
          },
        ],
        locationMemorySummaries: [
          {
            locationId: 'loc_market_town',
            locationName: '市镇',
            summary: '市镇近日流民增多，游侠与官吏都在观望。',
            updatedAt: '乱世元年2月03日',
          },
          {
            locationId: 'loc_far',
            locationName: '远方',
            summary: '这条远方地点摘要不应投喂。',
            updatedAt: '乱世元年2月03日',
          },
        ],
        settings: {
          recentRawTurnLimit: 4,
          recentTurnLimit: 20,
          npcRecentMemoryDefaultLimit: 2,
          npcRecentMemoryImportantLimit: 5,
          focusedNpcRecentMemoryLimit: 2,
          midTermSummaryLimit: 3,
          longTermFactLimit: 8,
          vectorResultLimit: 6,
        },
      },
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, '我观察陈衡和市镇局势');

    expect(prompt.narrativeContext).toContain('近期剧情记忆：');
    expect(prompt.narrativeContext).toContain('乱世元年2月01日｜主角救下伤者，陈衡开始注意主角。');
    expect(prompt.narrativeContext).toContain('中期剧情摘要：');
    expect(prompt.narrativeContext).toContain('市镇风波（乱世元年2月01日-乱世元年2月03日）：主角在市镇连续卷入流民与游侠纠纷。');
    expect(prompt.narrativeContext).toContain('长期档案记忆：');
    expect(prompt.narrativeContext).toContain('promise｜high：主角曾承诺护送伤者离开市镇。');
    expect(prompt.narrativeContext).toContain('NPC长期互动摘要：');
    expect(prompt.narrativeContext).toContain('陈衡：陈衡因主角救人而产生兴趣，但仍在试探。');
    expect(prompt.narrativeContext).toContain('地点记忆摘要：');
    expect(prompt.narrativeContext).toContain('市镇：市镇近日流民增多，游侠与官吏都在观望。');
    expect(prompt.narrativeContext).not.toContain('这条离场无关 NPC 摘要不应投喂。');
    expect(prompt.narrativeContext).not.toContain('这条远方地点摘要不应投喂。');
  });

  it('按玩家输入检索旧记忆时不重复投喂已在中期和长期层出现的来源', () => {
    const state = makeState();
    const enrichedState = {
      ...state,
      memoryArchive: {
        recentTurnSummaries: [],
        midTermSummaries: [
          {
            summaryId: 'mid_gate',
            title: '城门戒严阶段',
            fromCreatedAt: '乱世元年2月01日',
            toCreatedAt: '乱世元年2月20日',
            summary: '主角曾在城门戒严期间承诺护送伤者出城。',
            relatedNpcIds: ['npc_chen_heng'],
            relatedLocationIds: ['loc_market_town'],
            updatedAt: '乱世元年2月20日',
          },
          {
            summaryId: 'mid_far',
            title: '远方茶路',
            fromCreatedAt: '乱世元年1月01日',
            toCreatedAt: '乱世元年1月03日',
            summary: '远方茶路涨价。',
            relatedLocationIds: ['loc_far'],
            updatedAt: '乱世元年1月03日',
          },
        ],
        longTermFacts: [
          {
            factId: 'fact_promise',
            category: 'promise',
            createdAt: '乱世元年2月10日',
            summary: '主角曾承诺护送伤者出城。',
            importance: 'high',
            relatedNpcIds: ['npc_chen_heng'],
            relatedLocationIds: ['loc_market_town'],
          },
        ],
        npcInteractionSummaries: [],
        locationMemorySummaries: [],
        settings: {
          recentRawTurnLimit: 4,
          recentTurnLimit: 20,
          recentTurnCompressThreshold: 30,
          recentTurnKeepAfterCompress: 12,
          npcRecentMemoryDefaultLimit: 2,
          npcRecentMemoryImportantLimit: 5,
          focusedNpcRecentMemoryLimit: 2,
          npcMemoryCompressThreshold: 40,
          npcMemoryKeepAfterCompress: 12,
          locationMemoryCompressThreshold: 30,
          taskMemoryCompressThreshold: 30,
          midTermSummaryLimit: 3,
          longTermFactLimit: 8,
          vectorResultLimit: 3,
          maxPromptMemoryTokens: 40000,
          recentStoryTokenBudget: 12000,
          npcMemoryTokenBudget: 12000,
          midTermTokenBudget: 6000,
          longTermFactTokenBudget: 5000,
          locationMemoryTokenBudget: 3000,
          retrievalTokenBudget: 8000,
          enableAutoMemorySummary: true,
          preferDedicatedMemorySummaryApi: true,
        },
      },
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, '我问陈衡，护送伤者出城的承诺还算不算数？');

    expect(prompt.narrativeContext).not.toContain('检索到的相关旧记忆：');
    expect(prompt.narrativeContext.match(/主角曾承诺护送伤者出城。/g)).toHaveLength(1);
    expect(prompt.narrativeContext).toContain('主角曾在城门戒严期间承诺护送伤者出城。');
    expect(prompt.narrativeContext).not.toContain('远方茶路涨价。');
  });

  it('分离叙事上下文和状态写入上下文', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我观察陈衡');

    expect(prompt.narrativeContext).toContain('当前地点：市镇');
    expect(prompt.narrativeContext).toContain('在场人物：陈衡');
    expect(prompt.narrativeContext).not.toContain('npc_chen_heng');

    expect(prompt.stateWriterContext).toContain('currentLocationId: loc_market_town');
    expect(prompt.stateWriterContext).toContain('npcId: npc_chen_heng');
    expect(prompt.stateWriterContext).toContain('eventId: evt_market_rescue');
    expect(prompt.stateWriterContext).toContain('pushNpcMemory');
    expect(prompt.stateWriterContext).toContain('recordTurnEvent');
    expect(prompt.stateWriterContext).toContain('不是顶层 statePatch.type');
    expect(prompt.stateWriterContext).toContain('type=luanshiCommand');
    expect(prompt.stateWriterContext).toContain('payload.command.action 不得遗漏');
    expect(prompt.stateWriterContext).toContain('不得把 recordTurnEvent、upsertTroopLedger、upsertHeroineThread、upsertBondThread');
  });

  it('将主角外貌和性格作为叙事约束送入 prompt', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我观察陈衡');

    expect(prompt.narrativeContext).toContain('主角档案');
    expect(prompt.narrativeContext).toContain('姓名：主角，字子衡');
    expect(prompt.narrativeContext).toContain('外貌：黑发黑眸，面容清秀，衣着朴素利落。');
    expect(prompt.narrativeContext).toContain('性格：外冷内热，谨慎克制，遇事先观察再出手。');
    expect(prompt.narrativeContext).toContain('外貌用于 NPC 第一印象');
    expect(prompt.narrativeContext).toContain('性格必须影响主角默认行事风格');
    expect(prompt.narrativeContext).toContain('智力62');
    expect(prompt.narrativeContext).not.toContain('机运77');
  });

  it('将主角成长、声名、特质、状态、装备和履历摘要送入 prompt', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我观察陈衡');

    expect(prompt.narrativeContext).toContain('阅历：Lv.3');
    expect(prompt.narrativeContext).toContain('经验 180');
    expect(prompt.narrativeContext).toContain('成长点 1');
    expect(prompt.narrativeContext).toContain('生命：82/100');
    expect(prompt.narrativeContext).toContain('体力：41/100');
    expect(prompt.narrativeContext).toContain('德行：12（略有德名）');
    expect(prompt.narrativeContext).toContain('名声：8（略有善名）');
    expect(prompt.narrativeContext).toContain('救人有名');
    expect(prompt.narrativeContext).toContain('特质：谨慎自守');
    expect(prompt.narrativeContext).toContain('遇到未知风险时，主角默认更倾向先侦察、试探、留后路。');
    expect(prompt.narrativeContext).toContain('当前状态：奔波疲惫');
    expect(prompt.narrativeContext).toContain('涉及长途奔走、追逐或持久战时应体现疲惫影响。');
    expect(prompt.narrativeContext).toContain('装备：武器-旧短刀');
    expect(prompt.narrativeContext).not.toContain('可在近身冲突中提供防身手段');
    expect(prompt.narrativeContext).not.toContain('背包：干粮x3');
    expect(prompt.narrativeContext).toContain('个人钱财：36钱');
    expect(prompt.narrativeContext).toContain('主角履历摘要：主角初到市镇');
    expect(prompt.narrativeContext).toContain('玩家关键事迹：');
    expect(prompt.narrativeContext).toContain('乱世元年2月：在市镇救下伤者。（影响：陈衡开始关注主角。）');
    expect(prompt.narrativeContext).not.toContain('近期主角行为：上一回合主角观察陈衡');
    expect(prompt.narrativeContext).not.toContain('随身资源账本');
  });

  it('limits key deeds through the memory package and tells the writer to omit ordinary stage actions', () => {
    const state = makeState();
    state.player.playerMemory!.keyDeeds = Array.from({ length: 25 }, (_, index) => ({
      id: `deed_${index + 1}`,
      date: `乱世元年${index + 1}月`,
      summary: `长期事迹${index + 1}`,
      impact: `持续影响${index + 1}`,
    }));

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我观察陈衡');

    expect(prompt.narrativeContext).toContain('长期事迹25');
    expect(prompt.narrativeContext).not.toContain('长期事迹5（');
    expect(prompt.stateWriterContext).toContain('keyDeed 是低频终身里程碑');
    expect(prompt.stateWriterContext).toContain('只允许身份/官爵变化、重大胜败');
    expect(prompt.stateWriterContext).toContain('不得把出发、赶路、抵达、准备');
    expect(prompt.stateWriterContext).toContain('拉开序幕');
    expect(prompt.stateWriterContext).toContain('无法说明长期不可逆影响时必须省略 keyDeed');
  });

  it('将日期、地区和当前剧情派生出的天候送入 prompt', () => {
    const state = makeState();
    state.currentDate = '公元189年03月05日 18:00';
    state.currentTime = { year: 189, month: 3, day: 5, hour: 18, minute: 0 };
    state.currentLocationId = 'loc_bridge';
    state.worldStateDelta = {
      ...state.worldStateDelta,
      openingLocationPath: '司隶 / 洛水断桥',
      openingSceneSummary: '断桥边挤满难民，河风带着潮气。',
    };
    state.localSituationNotes = ['断桥边的难民缩在车架旁，河风吹得火把一明一暗。'];
    state.locations = [
      {
        locationId: 'loc_bridge',
        name: '洛水断桥',
        type: '渡口',
        summary: '洛水边的断桥，河面潮冷，车马难行。',
        knownLevel: '亲历',
        recentEvents: [],
      },
    ];

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '观察断桥和难民');

    expect(prompt.narrativeContext).toContain('当前天候：暮色四合，初春河风微凉');
    expect(prompt.narrativeContext).toContain('天候影响：渡河、守桥、夜行和火把视野');
    expect(prompt.narrativeContext).toContain('天候标签：初春、暮色、河风、微凉');
  });

  it('将开局额外要求作为最高优先级上下文送入 prompt', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '开始');

    expect(prompt.narrativeContext).toContain('开局额外要求（最高优先级）');
    expect(prompt.narrativeContext).toContain('若与其他开局选项冲突，以此为准');
    expect(prompt.narrativeContext).toContain('不要一开局掌权');
  });

  it('要求 LLM 用 timeAdvance 显式写回合理经过时间', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我与陈衡交谈');

    expect(prompt.systemPrompt).toContain('timeAdvance');
    expect(prompt.systemPrompt).toContain('15-30 分钟');
    expect(prompt.systemPrompt).toContain('赶路、战斗、等待、军务');
    expect(prompt.systemPrompt).toContain('长期训练、屯田、养伤、潜伏、赶造或等待');
    expect(prompt.systemPrompt).toContain('数十日至一年以内');
    expect(prompt.systemPrompt).toContain('每月 30 天、每年 12 个月');
    expect(prompt.systemPrompt).toContain('reason');
    expect(prompt.systemPrompt).toContain('category');
  });

  it('将当前时间作为上下文锚点而不是每回合固定开场模板', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我与陈衡交谈');

    expect(prompt.systemPrompt).toContain('当前时间是上下文锚点，不是每回合固定开场模板');
    expect(prompt.systemPrompt).toContain('时间入文必须服务叙事');
    expect(prompt.systemPrompt).toContain('大幅跳时、跨日、抵达新地点、重大军政事件');
    expect(prompt.systemPrompt).toContain('普通回合优先从玩家上一轮行动的后果、眼前人物反应、现场变化开头');
    expect(prompt.systemPrompt).toContain('若正文使用了明确时间推进或等待、赶路、疗伤等耗时描写，statePatches 必须写入 timeAdvance');
  });

  it('要求 LLM 使用 statePatches 数组同时写入时间和其他状态', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我与陈衡交谈');

    expect(prompt.userPrompt).toContain('statePatches');
    expect(prompt.userPrompt).toContain('多个状态变更');
    expect(prompt.userPrompt).toContain('timeAdvance');
    expect(prompt.userPrompt).toContain('兼容旧格式');
  });

  it('documents strict resourceChanged and relationshipChange patch contracts', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我与陈衡交谈');

    expect(prompt.stateWriterContext).toContain('payload.type=resourceChanged');
    expect(prompt.stateWriterContext).toContain("mode=delta");
    expect(prompt.stateWriterContext).toContain("mode=absolute");
    expect(prompt.stateWriterContext).toContain('只操作 playerResources 的通用键');
    expect(prompt.stateWriterContext).toContain('不替代 updateResourceLedger');
    expect(prompt.stateWriterContext).toContain('没有明确非空 resource 键时不得输出 resourceChanged');
    expect(prompt.stateWriterContext).toContain('payload.type=relationshipChange');
    expect(prompt.stateWriterContext).toContain("targetKind=actor/faction");
    expect(prompt.stateWriterContext).toContain('actorId、targetId、targetKind、value');
    expect(prompt.stateWriterContext).toContain('targetType 不得单独提供');
  });

  it('明确 NPC 记忆默认写回路径，避免同一条记忆双写', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我与陈衡交谈');

    expect(prompt.userPrompt).toContain('NPC 记忆默认写入 writeback.npcMemorySuggestions');
    expect(prompt.userPrompt).toContain('不要把同一 NPC 的同一事件记忆同时写入 statePatches.pushNpcMemory 和 writeback.npcMemorySuggestions');
    expect(prompt.stateWriterContext).toContain('pushNpcMemory 仅用于需要立即强制写入的特殊情况');
    expect(prompt.stateWriterContext).toContain('不得再在 writeback.npcMemorySuggestions 写入同一 NPC、同一事件、同一内容的记忆');
  });

  it('在回合输出要求里固定主剧情响应协议 V1 字段', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我与陈衡交谈');

    expect(prompt.userPrompt).toContain('protocolVersion');
    expect(prompt.userPrompt).toContain('lsfy.turn.v1');
    expect(prompt.userPrompt).toContain('turnSummary');
    expect(prompt.userPrompt).toContain('plotPlanSuggestions');
    expect(prompt.userPrompt).toContain('routeWriteSuggestions');
    expect(prompt.userPrompt).toContain('writeback: 结构化写回对象');
  });

  it('用通用世界书/时代包协议描述输出，不把三国写死进引擎 prompt', () => {
    const genericWorldBook: WorldBook = {
      ...worldBook,
      manifest: {
        ...worldBook.manifest,
        id: 'northern-song-test',
        name: '北宋风云测试包',
        genre: '历史乱世',
      },
      prompts: {
        ...worldBook.prompts,
        narrativeBaseline: '这是北宋风云测试包的叙事基线。',
      },
    };

    const prompt = composePrompt(genericWorldBook, undefined, [], undefined, makeState(), '我与陈衡交谈');

    expect(prompt.systemPrompt).toContain('当前世界书/时代包：北宋风云测试包');
    expect(prompt.userPrompt).toContain('writeback');
    expect(prompt.userPrompt).toContain('protagonistMemory');
    expect(prompt.userPrompt).toContain('npcMemorySuggestions');
    expect(prompt.userPrompt).toContain('locationWriteSuggestions');
    expect(prompt.userPrompt).toContain('questChanges');
    expect(prompt.userPrompt).toContain('worldEventSummary');
    expect(prompt.systemPrompt).not.toContain('三国');
    expect(prompt.userPrompt).not.toContain('三国');
  });

  it('projects relevant current matters and documents quest patch protocol', () => {
    const state = {
      ...makeState(),
      activeQuests: [
        {
          id: 'quest_local',
          title: '护送伤者',
          description: '把伤者送出市镇。',
          status: 'active',
          currentStep: '寻找北门小路。',
          stakes: '拖延太久会被追兵堵住。',
          outcomeSummary: '救援承诺已经惊动本地巡兵。',
          consequenceTags: ['巡兵注意', '路线压力'],
          affectedNpcIds: ['npc_chen_heng'],
          affectedFactionIds: ['faction_local_patrol'],
          affectedPlaceIds: ['loc_market_town'],
          affectedForceIds: ['force_patrol_unit'],
          affectedHoldingIds: ['holding_market_gate'],
          followUpHooks: ['巡兵可能提前封门'],
          severity: 'moderate',
          relatedLocationIds: ['loc_market_town'],
          priority: 'medium',
          createdAt: '乱世元年2月',
          updatedAt: '乱世元年2月',
        },
        {
          id: 'quest_far',
          title: '远方旧事',
          description: '暂时不相关。',
          status: 'active',
          relatedLocationIds: ['loc_far'],
          priority: 'low',
          createdAt: '乱世元年2月',
          updatedAt: '乱世元年2月',
        },
      ],
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我准备护送伤者');

    expect(prompt.narrativeContext).toContain('当前事项');
    expect(prompt.narrativeContext).toContain('护送伤者');
    expect(prompt.narrativeContext).toContain('寻找北门小路');
    expect(prompt.narrativeContext).toContain('救援承诺已经惊动本地巡兵');
    expect(prompt.narrativeContext).toContain('巡兵注意');
    expect(prompt.narrativeContext).not.toContain('远方旧事');
    expect(prompt.stateWriterContext).toContain('payload.type=questAdded');
    expect(prompt.stateWriterContext).toContain('payload.type=questUpdated');
    expect(prompt.stateWriterContext).toContain('outcomeSummary');
    expect(prompt.stateWriterContext).toContain('consequenceTags');
    expect(prompt.stateWriterContext).toContain('affectedNpcIds');
    expect(prompt.stateWriterContext).toContain('affectedForceIds');
    expect(prompt.stateWriterContext).toContain('followUpHooks');
    expect(prompt.stateWriterContext).toContain('不能只写入当前事项后果摘要');
    expect(prompt.stateWriterContext).toContain('当前事项');
    expect(prompt.userPrompt).toContain('questChanges');
    expect(prompt.userPrompt).toContain('outcomeSummary');
    expect(prompt.userPrompt).toContain('affectedForceIds');
    expect(prompt.userPrompt).toContain('experienceReward');
    expect(prompt.stateWriterContext).toContain('第一次 action=complete');
    expect(prompt.stateWriterContext).toContain('不得直接伪造 level/xp/growthPoints');
  });

  it('projects every open current matter into the compact lifecycle review instead of starving entries after the first four', () => {
    const activeQuests = Array.from({ length: 7 }, (_, index) => ({
      id: `quest_lifecycle_${index + 1}`,
      title: `Lifecycle matter ${index + 1}`,
      description: `Matter ${index + 1}`,
      status: 'active' as const,
      currentStep: `Step ${index + 1}`,
      createdAt: `day ${index + 1}`,
      updatedAt: `day ${index + 1}`,
    }));
    const state = {
      ...makeState(),
      activeQuests: [
        ...activeQuests,
        {
          id: 'quest_lifecycle_closed',
          title: 'Closed matter',
          description: 'Already completed.',
          status: 'completed',
          relatedNpcIds: ['npc_chen_heng'],
          outcomeSummary: 'The promised supplies were delivered and stored.',
          archivedAt: 'day 2',
          createdAt: 'day 1',
          updatedAt: 'day 2',
        },
      ],
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, 'I deal with the seventh matter');

    expect(prompt.stateWriterContext).toContain('openCurrentMatterLifecycleLedger:');
    for (const quest of activeQuests) {
      expect(prompt.stateWriterContext).toContain(`questId: ${quest.id}`);
    }
    const openLedger = prompt.stateWriterContext.split('resolvedCurrentMatterContinuityLedger:')[0];
    expect(openLedger).not.toContain('questId: quest_lifecycle_closed');
    expect(prompt.stateWriterContext).toContain('resolvedCurrentMatterContinuityLedger:');
    expect(prompt.stateWriterContext).toContain('questId: quest_lifecycle_closed');
    expect(prompt.stateWriterContext).toContain('The promised supplies were delivered and stored.');
    expect(prompt.narrativeContext).toContain('已结事项连续性');
    expect(prompt.narrativeContext).toContain('不得把原承诺、交付或任务重新写成尚未发生');
    expect(prompt.stateWriterContext).toContain('逐项审阅全部未结事项');
    expect(prompt.stateWriterContext).toContain('完成、失败、失效后同回合进入历史归档');
  });

  it('projects relevant signals and documents rumorAdded signal protocol', () => {
    const state = {
      ...makeState(),
      knownRumors: [
        {
          id: 'signal_local',
          title: 'North gate closure',
          content: 'Patrols may close the north gate before nightfall.',
          source: 'market caravan',
          signalType: 'rumor',
          confidence: 'medium',
          potentialOutcomeSummary: 'The escort route may become unsafe.',
          consequenceTags: ['route-risk'],
          affectedNpcIds: ['npc_chen_heng'],
          affectedPlaceIds: ['loc_market_town'],
          followUpHooks: ['verify north gate guards'],
          severity: 'moderate',
          relatedLocationIds: ['loc_market_town'],
          verified: false,
          createdAt: 'chaos year 1 month 2',
        },
        {
          id: 'signal_far_low',
          content: 'A distant tea road rumor should not enter this prompt.',
          source: 'far trader',
          signalType: 'rumor',
          confidence: 'low',
          relatedLocationIds: ['loc_far'],
          severity: 'minor',
          verified: false,
          createdAt: 'chaos year 1 month 2',
        },
      ],
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, 'check the north gate');

    expect(prompt.narrativeContext).toContain('Patrols may close the north gate before nightfall.');
    expect(prompt.narrativeContext).toContain('confidence=medium');
    expect(prompt.narrativeContext).toContain('potentialOutcome=The escort route may become unsafe.');
    expect(prompt.narrativeContext).toContain('route-risk');
    expect(prompt.narrativeContext).not.toContain('A distant tea road rumor should not enter this prompt.');
    expect(prompt.stateWriterContext).toContain('payload.type=rumorAdded');
    expect(prompt.stateWriterContext).toContain('potentialOutcomeSummary');
    expect(prompt.stateWriterContext).toContain('confidence(low/medium/high)');
    expect(prompt.stateWriterContext).toContain('signalType(rumor/clue/report/omen)');
    expect(prompt.stateWriterContext).toContain('entity state changes require separate structured writeback');
    expect(prompt.userPrompt).toContain('signalChanges');
  });

  it('projects relevant world chronicles and documents worldEventSummary chronicle protocol', () => {
    const state = {
      ...makeState(),
      worldTrends: [
        {
          trendId: 'trend_gate_lockdown',
          title: 'Capital gate lockdown',
          severity: 'high',
          summary: 'The capital gates are locked down after a palace order.',
          knownToPlayer: true,
          scope: 'regional',
          certainty: 'confirmed',
          status: 'cooling',
          locationId: 'loc_market_town',
          affectedFactionIds: ['faction_guard'],
          consequenceTags: ['gate-lockdown'],
          outcomeSummary: 'Travel through the gate now requires official permission.',
          progressSummary: 'Gate restrictions remain in force.',
          nextCheckAt: 'day 2',
          sourceSignalIds: ['signal_gate'],
          updatedAt: 'day 1',
        },
        {
          trendId: 'trend_private',
          title: 'Hidden court order',
          severity: 'critical',
          summary: 'This private event should not be projected.',
          knownToPlayer: false,
          updatedAt: 'day 1',
        },
      ],
    } as any as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, 'check the capital gate');

    expect(prompt.narrativeContext).toContain('Chronicles / 纪事');
    expect(prompt.narrativeContext).toContain('Capital gate lockdown');
    expect(prompt.narrativeContext).toContain('outcome=Travel through the gate now requires official permission.');
    expect(prompt.narrativeContext).not.toContain('Hidden court order');
    expect(prompt.stateWriterContext).toContain('worldEventSummary');
    expect(prompt.stateWriterContext).toContain('sourceSignalIds');
    expect(prompt.stateWriterContext).toContain('entity state changes require separate structured writeback');
    expect(prompt.userPrompt).toContain('"worldEventSummary"');
    expect(prompt.userPrompt).toContain('"sourceSignalIds"');
  });

  it('uses the compact situation projection instead of repeating each dynamic subsystem block', () => {
    const state = {
      ...makeState(),
      activeQuests: [
        {
          id: 'quest_active',
          title: 'Escort the wounded',
          description: 'Move the wounded out of the market town.',
          status: 'active',
          currentStep: 'Find the north gate path.',
          priority: 'high',
          createdAt: 'chaos year 1 month 2',
          updatedAt: 'chaos year 1 month 2',
        },
      ],
      knownRumors: [
        {
          id: 'signal_gate',
          title: 'North gate closure',
          content: 'Patrols may close the north gate before nightfall.',
          source: 'market caravan',
          status: 'open',
          confidence: 'medium',
          severity: 'major',
          verified: false,
          createdAt: 'chaos year 1 month 2',
        },
      ],
      worldTrends: [
        {
          trendId: 'trend_lockdown',
          title: 'Capital gate lockdown',
          severity: 'high',
          summary: 'The capital gates are locked down after a palace order.',
          knownToPlayer: true,
          status: 'active',
          scope: 'regional',
          sourceConflictIds: ['conflict_gate'],
          progressSummary: 'The gate remains closed.',
          nextCheckAt: 'chaos year 1 month 3',
          happenedAt: 'chaos year 1 month 2',
          updatedAt: 'chaos year 1 month 2',
        },
      ],
      plotPlan: [
        {
          plotId: 'plot_delayed_pressure',
          title: 'Delayed pressure',
          horizon: '中期',
          status: '进行中',
          priority: '高',
          description: 'A hidden pressure exists but should not resolve yet.',
          notBeforeAt: '0189-09-20 08:00',
        },
      ],
      npcAwarenessIndex: [
        {
          awarenessId: 'aware_remote',
          name: 'Remote ally',
          sourceType: 'rumor',
          sourceIds: ['signal_gate'],
          contactLevel: 2,
          playerRelevance: ['old promise'],
          unresolvedHooks: ['may send a letter'],
          knownToPlayer: true,
          archiveVisible: false,
          updatedAt: 'chaos year 1 month 2',
        },
      ],
    } as any as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, 'check the north gate');

    expect(prompt.narrativeContext).toContain('Situation Projection');
    expect(prompt.narrativeContext).toContain('Escort the wounded');
    expect(prompt.narrativeContext).toContain('North gate closure');
    expect(prompt.narrativeContext).toContain('Capital gate lockdown');
    expect(prompt.narrativeContext).toContain('Delayed pressure');
    expect(prompt.narrativeContext).toContain('Remote ally');
    expect(countOccurrences(prompt.narrativeContext, 'North gate closure')).toBe(1);
    expect(countOccurrences(prompt.narrativeContext, 'Capital gate lockdown')).toBe(1);
  });

  it('projects temporal adjudication hints without auto-resolving dynamic state', () => {
    const state = {
      ...makeState(),
      currentDate: '0189-09-10 08:00',
      currentTime: { year: 189, month: 9, day: 10, hour: 8, minute: 0 },
      activeQuests: [
        {
          id: 'quest_time_sensitive',
          title: 'Time sensitive escort',
          description: 'Escort before dawn.',
          status: 'active',
          deadlineAt: '0189-09-09 08:00',
          createdAt: '0189-09-08 08:00',
          updatedAt: '0189-09-08 08:00',
        },
      ],
      knownRumors: [
        {
          id: 'signal_time_sensitive',
          content: 'A bridge watch may expire soon.',
          source: 'traveler',
          expiresAt: '0189-09-09 20:00',
          verified: false,
          createdAt: '0189-09-08 08:00',
        },
      ],
      plotPlan: [
        {
          plotId: 'plot_future_pressure',
          title: 'Future pressure',
          horizon: '中期',
          status: '进行中',
          description: 'This pressure should remain foreshadowing for now.',
          priority: '高',
          notBeforeAt: '0189-09-20 08:00',
        },
      ],
    } as any as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, 'wait and observe');

    expect(prompt.narrativeContext).toContain('timeProjection');
    expect(prompt.narrativeContext).toContain('quest_time_sensitive');
    expect(prompt.narrativeContext).toContain('needs adjudication');
    expect(prompt.narrativeContext).toContain('signal_time_sensitive');
    expect(prompt.narrativeContext).toContain('possibly stale');
    expect(prompt.narrativeContext).toContain('plot_future_pressure');
    expect(prompt.narrativeContext).toContain('foreshadow only');
    expect(prompt.userPrompt).toContain('"notBeforeAt"');
    expect(prompt.userPrompt).toContain('"lastAdvancedAt"');
  });

  it('返回 Prompt 模块调试信息和 token 粗估算', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我观察陈衡');

    expect(prompt.modules.map((module) => module.id)).toEqual([
      'stable-prefix',
      'worldbook-core',
      'current-context',
      'state-writer',
    ]);
    expect(prompt.estimatedTokens).toBeGreaterThan(0);
    expect(prompt.modules.every((module) => module.estimatedTokens > 0)).toBe(true);
  });

  it('返回真实回合 prompt token 分层估算', () => {
    const state = {
      ...makeState(),
      activeQuests: [
        {
          id: 'quest_runtime_budget',
          title: '护送陈衡出镇',
          description: '陈衡请求主角护送他离开市镇。',
          status: 'active',
          priority: 'high',
          currentStep: '寻找北门小路。',
          createdAt: '乱世元年2月',
          updatedAt: '乱世元年2月',
        },
      ],
      knownRumors: [
        {
          id: 'signal_runtime_budget',
          title: '北门将闭',
          content: '市井传闻北门天黑前可能封闭。',
          source: '市井传闻',
          signalType: 'rumor',
          confidence: 'medium',
          severity: 'major',
          verified: false,
          createdAt: '乱世元年2月',
        },
      ],
      worldTrends: [
        {
          trendId: 'trend_runtime_budget',
          title: '市镇戒严',
          summary: '市镇因流民与军吏冲突进入戒严。',
          knownToPlayer: true,
          severity: '高',
          status: 'active',
          scope: 'regional',
          affectedFactionIds: ['faction_patrol'],
          progressSummary: '戒严仍在持续。',
          nextCheckAt: '乱世元年3月',
          happenedAt: '乱世元年2月',
          updatedAt: '乱世元年2月',
        },
      ],
      plotPlan: [
        {
          plotId: 'plot_runtime_budget',
          title: '北门暗线',
          horizon: '近期',
          status: '进行中',
          priority: '高',
          description: '有人正试探北门守备是否松动。',
        },
      ],
      npcAwarenessIndex: [
        {
          awarenessId: 'aware_runtime_budget',
          name: '远方旧识',
          sourceType: 'rumor',
          sourceIds: ['signal_runtime_budget'],
          contactLevel: 10,
          historicalImportance: 0,
          playerRelevance: ['old promise'],
          unresolvedHooks: ['may send a letter'],
          knownToPlayer: true,
          archiveVisible: false,
          updatedAt: '乱世元年2月',
        },
      ],
      memoryArchive: {
        ...makeState().memoryArchive,
        recentTurnSummaries: [
          {
            id: 'recent_runtime_budget',
            turnNumber: 1,
            createdAt: '乱世元年2月',
            brief: '主角答应陈衡寻找出路。',
            playerActionSummary: '主角询问北门情况。',
            importance: 'medium',
          },
        ],
      },
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我观察陈衡');
    const layerIds = prompt.runtimeTokenEstimate.layers.map((layer) => layer.id);
    const breakdownIds = prompt.runtimeTokenEstimate.contextBreakdown.map((layer) => layer.id);

    expect(prompt.estimatedTokens).toBe(prompt.runtimeTokenEstimate.total.estimatedTokens);
    expect(layerIds).toEqual([
      'systemPrompt',
      'userPrompt',
      'stateWriterContext',
      'turnOutputRequirements',
    ]);
    expect(breakdownIds).toEqual(expect.arrayContaining([
      'narrativeContext',
      'memoryContext',
      'situationProjection',
      'situationCurrentMatters',
      'situationSignals',
      'situationChronicles',
      'situationPlotPlans',
      'situationRemoteNpcBeats',
      'stateWriterContext',
    ]));
    expect(prompt.runtimeTokenEstimate.total.estimatedTokens).toBeGreaterThan(prompt.modules[0].estimatedTokens);
    expect(prompt.runtimeTokenEstimate.contextBreakdown.find((layer) => layer.id === 'memoryContext')?.estimatedTokens).toBeGreaterThan(0);
    expect(prompt.runtimeTokenEstimate.contextBreakdown.find((layer) => layer.id === 'situationProjection')?.estimatedTokens).toBeGreaterThan(0);
  });

  it('将 NPC 六维、隐藏机运、特质作用和建档写回协议送入 prompt', () => {
    const state = makeState();
    const enrichedState = {
      ...state,
      npcs: (state.npcs ?? []).map((npc) =>
        npc.npcId === 'npc_chen_heng'
          ? ({
              ...npc,
              abilityScores: { 武力: 68, 统率: 52, 智力: 55, 政治: 35, 魅力: 61, 机运: 54 },
              traits: [
                {
                  id: 'trait_local_brave',
                  label: '市井豪侠',
                  description: '熟悉地方人情与游侠门路。',
                  source: 'event',
                  promptHint: '市井交涉、拉拢游侠、处理地方纷争时更活络。',
                  checkHooks: [{ scope: '市井交涉', modifier: 8, note: '熟悉地方门路。' }],
                },
              ],
            } as any)
          : npc,
      ),
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, '我观察陈衡');

    expect(prompt.narrativeContext).toContain('能力：武力68、统率52、智力55、政治35、魅力61、机运54');
    expect(prompt.narrativeContext).toContain('特质：市井豪侠');
    expect(prompt.narrativeContext).toContain('市井交涉、拉拢游侠、处理地方纷争时更活络。');
    expect(prompt.stateWriterContext).toContain('upsertNpcProfile');
    expect(prompt.stateWriterContext).toContain('abilityScores');
    expect(prompt.stateWriterContext).toContain('机运');
    expect(prompt.stateWriterContext).toContain('promptHint/checkHooks');
    expect(prompt.stateWriterContext).toContain('traits[].source 不得省略或写空字符串');
    expect(prompt.stateWriterContext).toContain('traits[].rarity');
    expect(prompt.stateWriterContext).toContain('npcProfileSuggestions[].uniqueArts');
    expect(prompt.stateWriterContext).toContain('npcProfileSuggestions[].equipment');
    expect(prompt.stateWriterContext).toContain('npcProfileSuggestions[].inventory');
    expect(prompt.stateWriterContext).toContain('重要 NPC 行装');
    expect(prompt.stateWriterContext).toContain('white/green/blue/red/gold');
    expect(prompt.stateWriterContext).toContain('必须提供明确年龄');
    expect(prompt.stateWriterContext).toContain('不得生成“年龄未知”的 NPC');
  });

  it('将成年女性档案写回协议适配为 updateNpcFemaleProfile', () => {
    const state = makeState();

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我观察人物志');
    const protocol = prompt.stateWriterContext;

    expect(protocol).toContain('payload.command.action=updateNpcFemaleProfile');
    expect(protocol).toContain('npcProfileSuggestions[].femaleProfile');
    expect(protocol).toContain('relationshipNotes');
    expect(protocol).toContain('publicIntimacyNotes');
    expect(protocol).toContain('appearanceExtension');
    expect(protocol).toContain('emotionalBoundary');
    expect(protocol).toContain('adultPrivateProfile.summary');
    expect(protocol).toContain('adultPrivateProfile.preferenceNotes');
    expect(protocol).toContain('adultPrivateProfile.boundaryNotes');
    expect(protocol).toContain('adultPrivateProfile.sensitiveNotes');
    expect(protocol).toContain('adultPrivateProfile.relationshipRiskNotes');
    expect(protocol).toContain('身体字段是长期私密锚点和未来文生图锚点');
    expect(protocol).toContain('偏好、边界、敏感、风险、子宫和初夜字段是长期信息');
    expect(protocol).toContain('不得写成正文小作文');
    expect(protocol).not.toContain('长期稳定正文描写');
    expect(protocol).toContain('birthday');
    expect(protocol).toContain('birthday 仅作为女性档案展示字段，不作为年龄锚点');
    expect(protocol).toContain('出生年份/日期写 NPC 基础档案 birthDate');
    expect(protocol).toContain('addressToPlayer');
    expect(protocol).toContain('appearanceDescription');
    expect(protocol).toContain('bodyDescription');
    expect(protocol).toContain('clothingStyle');
    expect(protocol).toContain('personalityCore');
    expect(protocol).toContain('affectionProgressionCondition');
    expect(protocol).toContain('relationshipProgressionCondition');
    expect(protocol).toContain('relationshipNetwork');
    expect(protocol).toContain('adultPrivateProfile.breastDescription');
    expect(protocol).toContain('adultPrivateProfile.vaginaDescription');
    expect(protocol).toContain('adultPrivateProfile.anusDescription');
    expect(protocol).toContain('adultPrivateProfile.sexualPreferenceNotes');
    expect(protocol).toContain('adultPrivateProfile.sensitiveSpotNotes');
    expect(protocol).toContain('adultPrivateProfile.wombProfile');
    expect(protocol).toContain('adultPrivateProfile.virgin');
    expect(protocol).toContain('adultPrivateProfile.firstNightPartner');
    expect(protocol).toContain('adultPrivateProfile.firstNightTime');
    expect(protocol).toContain('adultPrivateProfile.firstNightDescription');
    expect(protocol).toContain('updatedAt');
    expect(protocol).toContain('source');
    expect(protocol).toContain('同一个 npcId');
    expect(protocol).toContain('已有 NPC 必须复用上下文提供的 npcId');
    expect(protocol).toContain('不得生成漂移 ID');
    expect(protocol).toContain('完整稳定锚点');
    expect(protocol).toContain('后续正文与文生图');
    expect(protocol).toContain('红颜、夫人外交、内宅牵引或长期亲密关系目标');
    expect(protocol).toContain('adultPrivateProfile 作为长期私密锚点');
    expect(protocol).toContain('不得因为尚未进入成人场景就忽略已形成的长期私密边界、偏好与风险锚点');
    expect(protocol).toContain('身体字段是长期私密锚点和未来文生图锚点，应直白、具体、稳定');
    expect(protocol).toContain('偏好、边界、敏感、风险、子宫和初夜字段是长期信息');
    expect(protocol).toContain('年龄与出生信息只写 NPC 基础档案 age/birthDate');
    expect(protocol).toContain('“三十多岁”“四十出头”“熟女”“熟透”等词都允许在正文自然使用');
    expect(protocol).toContain('不设禁词');
    expect(protocol).toContain('每回合必读标签');
    expect(protocol).toContain('不得写成正文小作文');
    expect(protocol).toContain('不得只写 adultPrivateProfile.summary');
    expect(protocol).toContain('未知 / 不详 / 待补充 / 略 / 普通 / 正常');
    expect(protocol).toContain('wombProfile.pregnancy、pendingPregnancyChecks、lastPregnancyCheck、pregnancyHistory 是引擎管理真值');
    expect(protocol).toContain('payload.command.action=recordPregnancyRisk');
    expect(protocol).toContain('发生一次也不等于必然怀孕');
    expect(protocol).toContain('同一游戏日的多次有效行为合并为一次概率加成');
    expect(protocol).toContain('不同游戏日各自建立延后判定批次');
    expect(protocol).toContain('后续未决批次自动失效');
    expect(protocol).toContain('payload.command.action=resolvePregnancy');
    expect(protocol).toContain('不得随机编造流产、死胎或致命难产');
    expect(protocol).toContain('不另建子嗣管理系统');
  });

  it('在 npcProfileSuggestions femaleProfile 模板中列出 Alpha 成人私密正文档案字段', () => {
    const state = makeState();

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我观察人物志');
    const schema = prompt.userPrompt;

    expect(schema).toContain('"femaleProfile"');
    expect(schema).toContain('"adultPrivateProfile"');
    expect(schema).toContain('"breastDescription"');
    expect(schema).toContain('"vaginaDescription"');
    expect(schema).toContain('"anusDescription"');
    expect(schema).toContain('"sexualPreferenceNotes"');
    expect(schema).toContain('"sensitiveSpotNotes"');
    expect(schema).toContain('"wombProfile"');
    expect(schema).toContain('"virgin"');
    expect(schema).toContain('"firstNightPartner"');
    expect(schema).toContain('"firstNightTime"');
    expect(schema).toContain('"firstNightDescription"');
    expect(schema).toContain('正文描写');
    expect(schema).toContain('后续正文与文生图锚点');
    expect(schema).toContain('稳定档案真值');
  });

  it('exposes heroine and non-heroine bond writeback protocols separately', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), 'inspect bonds');
    const protocol = prompt.stateWriterContext;
    const heroineRule = protocol.split('\n').find((line) => line.includes('payload.command.action=upsertHeroineThread')) ?? '';
    const bondRule = protocol.split('\n').find((line) => line.includes('payload.command.action=upsertBondThread')) ?? '';

    expect(protocol).toContain('payload.command.action=upsertHeroineThread');
    expect(protocol).toContain('heroineThreadId');
    expect(protocol).toContain('relationshipRole');
    expect(protocol).toContain('currentPull');
    expect(protocol).toContain('promiseNotes');
    expect(protocol).toContain('payload.command.action=upsertBondThread');
    expect(protocol).toContain('bondThreadId');
    expect(protocol).toContain('bondType');
    expect(protocol).toContain('sworn/kinship/mentor/lordVassal/ally/debt/rival/enemy/other');
    expect(protocol).toContain('不用于红颜');
    expect(heroineRule).toContain('新建时必须完整包含');
    expect(heroineRule).toContain('更新已有 heroineThreadId 时，可仅包含 heroineThreadId 与明确变化字段');
    expect(heroineRule).toContain('同一 npcId 只能保留一条红颜关系线');
    expect(heroineRule).toContain('逐字复用已投喂的 heroineThreadId');
    expect(heroineRule).toContain('null 只能清空可选字段');
    expect(heroineRule).toContain('必须复用人物志中现存成年 NPC 的 npcId');
    expect(heroineRule).toContain('未知 npcId 不得写入');
    expect(heroineRule).not.toMatch(/新建时必须完整包含[^。]*lastUpdatedAt/);
    expect(heroineRule).toContain('lastUpdatedAt 可省略并由系统填入当前游戏时间');
    expect(heroineRule).toContain('lastUpdatedAt 显式 null 不允许');
    expect(heroineRule).toContain('tags、milestones 也可用显式空数组清空');
    expect(bondRule).toContain('新建时必须完整包含');
    expect(bondRule).toContain('更新已有 bondThreadId 时，可仅包含 bondThreadId 与明确变化字段');
    expect(bondRule).toContain('null 只能清空可选字段');
    expect(bondRule).toContain('targetNpcIds 必须逐项复用人物志中现存 NPC 的 npcId');
    expect(bondRule).toContain('无法确认 ID 时仅写 targetNames，不得臆造 targetNpcIds');
    expect(bondRule).not.toMatch(/新建时必须完整包含[^。]*lastUpdatedAt/);
    expect(bondRule).toContain('lastUpdatedAt 可省略并由系统填入当前游戏时间');
    expect(bondRule).toContain('lastUpdatedAt 显式 null 不允许');
    expect(bondRule).toContain('tags、milestones 也可用显式空数组清空');
  });

  it('政务行动有成年女性在场时只投喂公开女性档案，不投喂成人私密锚点', () => {
    const state = makeAdultPrivateProfileState();

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我让何氏在旁记录，查阅户籍钱粮并处置县中政务');

    expect(prompt.narrativeContext).toContain('何氏公开关系档案锚点。');
    expect(prompt.narrativeContext).toContain('何氏公开亲昵边界锚点。');
    expectNoPrivateProfileProjection(prompt.narrativeContext);
    expectNoPrivateProfileProjection(getStateWriterNpcLine(prompt.stateWriterContext, 'npc_lady_he'));
  });

  it('普通剧情投喂已确认怀孕事实，但不泄露原始私密记录', () => {
    const state = makeAdultPrivateProfileState({ currentDate: '公元189年11月01日 08:00（辰时）' });
    const wombProfile = state.npcs?.find((npc) => npc.npcId === 'npc_lady_he')
      ?.femaleProfile?.adultPrivateProfile?.wombProfile;
    if (!wombProfile) throw new Error('missing womb profile fixture');
    wombProfile.pregnancy = {
      pregnancyId: 'preg_prompt_test',
      status: 'confirmed',
      cycleKey: 'cycle_prompt_test',
      firstExposureAt: '公元189年09月01日 08:00（辰时）',
      checkAt: '公元189年09月24日 08:00（辰时）',
      exposureCount: 1,
      chanceBasisPoints: 1800,
      rollBasisPoints: 100,
      fatherCharacterIds: ['player'],
      paternityStatus: 'known',
      disclosure: 'private',
      conceptionAt: '公元189年09月01日 08:00（辰时）',
      confirmedAt: '公元189年10月16日 08:00（辰时）',
      estimatedDueAt: '公元190年06月01日 08:00（辰时）',
      deliveryWindowStartAt: '公元190年05月21日 08:00（辰时）',
      deliveryWindowEndAt: '公元190年06月11日 08:00（辰时）',
    };

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我让何氏在旁记录今日政务');

    expect(prompt.narrativeContext).toContain('怀孕事实：已确认怀孕、孕期第3月');
    expect(prompt.narrativeContext).toContain('父系：主角');
    expectNoPrivateProfileProjection(prompt.narrativeContext);
  });

  it('战斗行动有成年女性在场时不投喂成人私密锚点', () => {
    const state = makeAdultPrivateProfileState();

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我命何氏退后，拔刀迎战来袭敌兵');

    expect(prompt.narrativeContext).toContain('何氏公开关系档案锚点。');
    expectNoPrivateProfileProjection(prompt.narrativeContext);
    expectNoPrivateProfileProjection(getStateWriterNpcLine(prompt.stateWriterContext, 'npc_lady_he'));
  });

  it.each([
    '我公开拜访何氏，在厅中向众人寒暄行礼',
    '我与何氏在宴会上公开交谈，问她近况',
    '我召何氏到议事厅旁听军府议事',
  ])('公开社交、拜访或议事不投喂成人私密锚点: %s', (playerInput) => {
    const state = makeAdultPrivateProfileState();

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, playerInput);

    expect(prompt.narrativeContext).toContain('何氏公开关系档案锚点。');
    expectNoPrivateProfileProjection(prompt.narrativeContext);
    expectNoPrivateProfileProjection(getStateWriterNpcLine(prompt.stateWriterContext, 'npc_lady_he'));
  });

  it.each([
    '我陪伴何氏在廊下散步',
    '我告诉何氏我喜欢她，希望彼此更亲近',
    '我与何氏见面，称赞她的美貌与气度',
  ])('普通亲近、陪伴或喜欢措辞不投喂成人私密锚点: %s', (playerInput) => {
    const state = makeAdultPrivateProfileState();

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, playerInput);

    expect(prompt.narrativeContext).toContain('何氏公开关系档案锚点。');
    expectNoPrivateProfileProjection(prompt.narrativeContext);
    expectNoPrivateProfileProjection(getStateWriterNpcLine(prompt.stateWriterContext, 'npc_lady_he'));
  });

  it('明确成人互动并命名相关成年 NPC 时投喂该 NPC 成人私密锚点', () => {
    const state = makeAdultPrivateProfileState();

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我与何氏入内室，确认只有彼此后继续成人亲密互动');
    const stateWriterLine = getStateWriterNpcLine(prompt.stateWriterContext, 'npc_lady_he');

    expect(prompt.narrativeContext).toContain('成人私密档案');
    expect(prompt.narrativeContext).toContain('何氏私密摘要锚点');
    expect(prompt.narrativeContext).toContain('何氏胸部私密锚点');
    expect(prompt.narrativeContext).toContain('何氏小穴私密锚点');
    expect(prompt.narrativeContext).toContain('何氏子宫状态锚点');
    expect(stateWriterLine).toContain('何氏私密摘要锚点');
    expect(stateWriterLine).toContain('何氏偏好锚点');
  });

  it.each([
    '我询问何氏是否愿意与我同房',
    '我与何氏讨论是否入内室同房',
  ])('询问或讨论明确成人私密行动并命名相关成年 NPC 时投喂成人私密锚点: %s', (playerInput) => {
    const state = makeAdultPrivateProfileState();

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, playerInput);
    const stateWriterLine = getStateWriterNpcLine(prompt.stateWriterContext, 'npc_lady_he');

    expect(prompt.narrativeContext).toContain('成人私密档案');
    expect(prompt.narrativeContext).toContain('何氏私密摘要锚点');
    expect(stateWriterLine).toContain('何氏私密摘要锚点');
  });

  it.each([
    '我打听何氏是否听说过房事传闻',
    '我与何氏讨论成人话题的坊间传闻',
    '我与何氏讨论同房传闻',
    '我和何氏谈论房事传闻',
  ])('询问或讨论成人话题但无私密行动推进时仍不投喂成人私密锚点: %s', (playerInput) => {
    const state = makeAdultPrivateProfileState();

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, playerInput);

    expect(prompt.narrativeContext).toContain('何氏公开关系档案锚点。');
    expectNoPrivateProfileProjection(prompt.narrativeContext);
    expectNoPrivateProfileProjection(getStateWriterNpcLine(prompt.stateWriterContext, 'npc_lady_he'));
  });

  it('最近正文已自然进入成人亲密场景且当前继续该私密场景时投喂相关成人私密锚点', () => {
    const state = makeAdultPrivateProfileState({
      turnLog: [
        {
          turnNumber: 5,
          date: '乱世元年2月',
          playerInput: '我与何氏入内室，确认彼此边界',
          narrativeText: '【旁白】主角与何氏已经在内室自然进入成人亲密场景，彼此都确认了私密边界。',
          statePatchSummary: '进入私密场景',
          timestamp: '2026-07-13T02:00:00.000Z',
        },
      ],
    });

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我继续安抚她，让这一段私密场景自然延续');

    expect(prompt.narrativeContext).toContain('成人私密档案');
    expect(prompt.narrativeContext).toContain('何氏私密摘要锚点');
    expect(getStateWriterNpcLine(prompt.stateWriterContext, 'npc_lady_he')).toContain('何氏边界锚点');
  });

  it('成人私密场景只投喂当前互动相关 NPC，不投喂无关成年女性私密字段', () => {
    const state = makeAdultPrivateProfileState({ includeUnrelatedAdult: true });

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我与何氏入内室，确认只有彼此后继续成人亲密互动');

    expect(prompt.narrativeContext).toContain('何氏私密摘要锚点');
    expect(prompt.narrativeContext).not.toContain('杜氏私密摘要不应投喂');
    expect(prompt.narrativeContext).not.toContain('杜氏胸部私密锚点不应投喂');
    expect(getStateWriterNpcLine(prompt.stateWriterContext, 'npc_lady_du')).not.toContain('杜氏私密摘要不应投喂');
  });

  it('成人风格指南、女性档案写回协议和红颜写回协议不随私密投喂门禁关闭', () => {
    const state = makeAdultPrivateProfileState();

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我让何氏在厅中旁听政务');

    expect(prompt.userPrompt).toContain('## 成人亲密描写指南');
    expect(prompt.stateWriterContext).toContain('payload.command.action=updateNpcFemaleProfile');
    expect(prompt.stateWriterContext).toContain('adultPrivateProfile.summary');
    expect(prompt.stateWriterContext).toContain('payload.command.action=upsertHeroineThread');
    expectNoPrivateProfileProjection(prompt.narrativeContext);
    expectNoPrivateProfileProjection(getStateWriterNpcLine(prompt.stateWriterContext, 'npc_lady_he'));
  });

  it('派生当前年龄成年后，在明确成人场景门禁开启时可投喂已有成人私密档案', () => {
    const state = makeAdultPrivateProfileState({
      age: 17,
      ageKnownAtDate: '公元189年09月01日 08:00（辰时）',
      currentDate: '公元190年09月01日 08:00（辰时）',
    });

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我与何氏入内室，继续成人亲密互动');

    expect(prompt.narrativeContext).toContain('何氏公开关系档案锚点。');
    expect(prompt.narrativeContext).toContain('何氏私密摘要锚点');
    expect(getStateWriterNpcLine(prompt.stateWriterContext, 'npc_lady_he')).toContain('何氏私密摘要锚点');
  });

  it('未成年女性 NPC 不向 prompt 投喂成人私密档案', () => {
    const state = makeState();
    const enrichedState = {
      ...state,
      npcs: (state.npcs ?? []).map((npc) =>
        npc.npcId === 'npc_chen_heng'
          ? ({
              ...npc,
              name: '何氏',
              sex: '女',
              age: 17,
              femaleProfile: {
                relationshipNotes: '保持普通社交记录。',
                publicIntimacyNotes: '可以保留大众文学尺度的亲近张力。',
                adultPrivateProfile: {
                  enabled: true,
                  ageConfirmedAdult: true,
                  summary: '未成年不应投喂私密摘要。',
                },
              },
            } as any)
          : npc,
      ),
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, '我观察何氏');

    expect(prompt.narrativeContext).toContain('可以保留大众文学尺度的亲近张力。');
    expect(prompt.narrativeContext).not.toContain('未成年不应投喂私密摘要。');
    expect(prompt.stateWriterContext).not.toContain('未成年不应投喂私密摘要。');
  });

  it('缺失年龄的异常女性 NPC 不向 prompt 投喂成人私密档案', () => {
    const state = makeState();
    const enrichedState = {
      ...state,
      npcs: (state.npcs ?? []).map((npc) =>
        npc.npcId === 'npc_chen_heng'
          ? ({
              ...npc,
              name: '何氏',
              sex: '女',
              age: undefined,
              femaleProfile: {
                relationshipNotes: '保持普通社交记录。',
                publicIntimacyNotes: '可以保留大众文学尺度的亲近张力。',
                adultPrivateProfile: {
                  enabled: true,
                  ageConfirmedAdult: true,
                  summary: '缺失年龄不应投喂私密摘要。',
                },
              },
            } as any)
          : npc,
      ),
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, '我观察何氏');

    expect(prompt.narrativeContext).toContain('可以保留大众文学尺度的亲近张力。');
    expect(prompt.narrativeContext).not.toContain('缺失年龄不应投喂私密摘要。');
    expect(prompt.stateWriterContext).not.toContain('缺失年龄不应投喂私密摘要。');
  });

  it('将人物身份字段和身份写回命令送入 prompt', () => {
    const state = makeState();
    const enrichedState = {
      ...state,
      player: {
        ...state.player,
        artName: '潜夫',
        aliases: ['寒门小郎'],
        commonAddress: '刘小郎',
        factionName: '无所属',
        allegianceTarget: '暂无',
        officeTitle: '无',
        militaryTitle: '无',
        nobleTitle: '无',
        identitySummary: '寒门士子出身，暂以流民身份在市镇立足。',
      } as any,
      npcs: (state.npcs ?? []).map((npc) =>
        npc.npcId === 'npc_chen_heng'
          ? ({
              ...npc,
              courtesyName: '伯衡',
              aliases: ['市井豪侠'],
              commonAddress: '陈首领',
              currentIdentity: '游侠首领',
              factionName: '市镇游侠',
              allegianceTarget: '自身',
              identitySummary: '陈衡是市镇游侠首领，暂未正式投靠任何势力。',
            } as any)
          : npc,
      ),
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, enrichedState, '我观察陈衡');

    expect(prompt.narrativeContext).toContain('号潜夫');
    expect(prompt.narrativeContext).toContain('别称：寒门小郎');
    expect(prompt.narrativeContext).toContain('常用称呼：刘小郎');
    expect(prompt.narrativeContext).toContain('所属势力：无所属');
    expect(prompt.narrativeContext).toContain('效力对象：暂无');
    expect(prompt.narrativeContext).toContain('官职：无');
    expect(prompt.narrativeContext).toContain('军职：无');
    expect(prompt.narrativeContext).toContain('爵位/封号：无');
    expect(prompt.narrativeContext).toContain('身份摘要：寒门士子出身');
    expect(prompt.narrativeContext).toContain('在场人物：陈衡（字伯衡，别称：市井豪侠，常用称呼：陈首领，当前身份：游侠首领，所属势力：市镇游侠');
    expect(prompt.narrativeContext).toContain('身份摘要：陈衡是市镇游侠首领');
    expect(prompt.stateWriterContext).toContain('updateCharacterIdentity');
    expect(prompt.stateWriterContext).toContain('protagonistProfile');
    expect(prompt.stateWriterContext).toContain('不得用 protagonistProfile 反复改写已有出身');
    expect(prompt.stateWriterContext).toContain('称呼只供识别显示');
    expect(prompt.stateWriterContext).toContain('稳定身份事实不得只写入记忆');
    expect(prompt.stateWriterContext).toContain('必须同步 updateCharacterIdentity');
    expect(prompt.stateWriterContext).toContain('currentIdentity 发生变化');
    expect(prompt.stateWriterContext).toContain('currentIdentityDescription');
    expect(prompt.stateWriterContext).toContain('不得沿用旧身份说明');
  });

  it('uses caller-provided retrieved memories instead of recomputing local retrieval', () => {
    const prompt = composePrompt(
      worldBook,
      undefined,
      [],
      undefined,
      makeState(),
      'query without local sentinel',
      {
        retrievedMemories: [
          {
            retrievalMode: 'vector',
            sourceType: 'longTermFact',
            sourceId: 'fact_vector_only',
            title: 'vector',
            text: 'VECTOR_RETRIEVAL_SENTINEL should be injected into the narrative context.',
            time: 'day 10',
            score: 0.99,
            reason: 'embedding cosine similarity',
          },
        ],
      },
    );

    expect(prompt.narrativeContext).toContain('VECTOR_RETRIEVAL_SENTINEL');
    expect(prompt.memoryContextPackage.retrievedMemories.map((memory) => memory.sourceId)).toContain('fact_vector_only');
    expect(prompt.memoryContextPackage.budget.layerTokenEstimates.retrievedMemories).toBeGreaterThan(0);
    expect(prompt.memoryContextPackage.budget.estimatedTokens).toBeGreaterThan(0);
  });

  it('projects resource, faction, and troop ledgers and exposes ledger writeback commands', () => {
    const state = {
      ...makeState(),
      resources: {
        money: 120,
        grain: 300,
        horses: 12,
        arms: 40,
        recruits: 80,
        weapons: ['环首刀x20'],
        documents: ['军令一封'],
        tokens: ['北军符节'],
        importantSupplies: ['箭矢三箱'],
      },
      playerResources: { 粮饷: 36, 粮草: 50 },
      factions: [
        {
          factionId: 'faction_local_guard',
          name: '市镇守卒',
          type: '地方武装',
          summary: '维持市镇秩序的小股守卒。',
          stanceToPlayer: '观望',
          knownLevel: '亲历',
          recentActions: ['封锁北门'],
          aliases: ['北门守军旧部'],
          nominalAllegiance: '郡府',
          legalIdentity: '地方守备',
          actualController: '陈衡',
          knownSphere: '北门、市镇守卒与巡防',
          corePersonNpcIds: ['npc_chen_heng'],
          relatedTroopIds: ['troop_local'],
          sourceNote: '亲眼见到守卒听命封门',
          lastKnownAt: '乱世元年2月',
          updatedAt: '乱世元年2月',
        },
      ],
      troops: [
        {
          troopId: 'troop_local',
          name: '北门守卒',
          size: 80,
            previousSize: 100,
            factionId: 'faction_local_guard',
            previousFactionId: 'faction_dongzhuo',
            allegianceChangedAt: 'luanshi-year-2-month-2',
            allegianceChangeReason: 'false surrender followed by uprising',
            troopType: '步卒',
          quality: '中',
          fatigue: '高',
          readiness: '低',
          lifecycleStatus: 'active',
          statusTags: ['断粮'],
          leaderNpcId: 'npc_chen_heng',
          locationId: 'loc_market_town',
          lastKnownLocationId: 'loc_market_town',
          lastKnownAt: '乱世元年2月',
          knownLevel: '亲历',
          certainty: 'confirmed',
          morale: 45,
          training: 35,
          supplies: '口粮不足',
          task: '守住北门',
          relationToPlayer: '谨慎观望',
          orderStatus: 'issued',
          orderIssuedAt: 'luanshi-year-2-month-2 09:00',
          orderSummary: 'Send the north gate troop to the east gate after the courier arrives.',
          destinationLocationId: 'loc_east_gate',
          routeId: 'route_market_to_east_gate',
          movementStatus: 'waitingOrder',
          estimatedArrivalAt: 'luanshi-year-2-month-2 18:00',
          movementNotes: 'Remote order is pending; do not rewrite locationId until arrival or reliable report.',
          lastBattleId: 'battle_north_gate',
          strengthTrend: 'decreased',
          lastChangeReason: '遭伏击减员',
          updatedAt: '乱世元年2月',
        },
      ],
      conflicts: [
        {
          conflictId: 'battle_north_gate',
          type: '伏击',
          title: '北门夜袭',
          summary: '北门守卒在夜间遭遇伏击。',
          occurredAt: '乱世元年2月',
          outcome: '守卒溃退，减员二十余人。',
          scope: 'selfRelated',
          recordLevel: 'full',
          involvedTroopIds: ['troop_local'],
          involvedFactionIds: ['faction_local_guard'],
          resultLevel: 'loss',
          judgement: {
            method: 'warJudgementV1',
            perspectiveSide: 'local_guard',
            baselineAdvantage: 'slightDisadvantage',
            scoreBreakdown: {
              troopBase: -10,
              commander: -4,
              tactical: -12,
              turningPoint: -8,
              playerAction: 0,
              total: -34,
              notes: ['夜袭与断粮造成守军崩溃。'],
            },
            commanderAssessment: '守卒头目压不住夜袭恐慌。',
            tacticalAssessment: '巷口伏击抵消守军人数。',
          },
          turningPoints: [
            {
              type: 'ambush',
              side: 'bandits',
              summary: '伏兵从巷口逼近，守卒未能重整。',
              impact: 'major',
              relatedTroopIds: ['troop_local'],
              scoreModifier: -12,
            },
          ],
          resultTags: ['rout', 'troopLoss'],
          reportText: '夜色压住北门火光，伏兵从巷口逼近，守卒仓促退入门楼。',
          troopEffects: ['troop_local 减员约二十人'],
        },
      ],
      holdings: [
        {
          holdingId: 'holding_market_town',
          name: '北门市镇',
          type: 'city',
          status: 'controlled',
          summary: '刚被玩家势力稳住的小城，粮仓不丰但还有兵源可用。',
          locationId: 'loc_market_town',
          factionId: 'faction_local_guard',
          nominalAllegiance: '郡府',
          actualController: '刘构',
          stewardNpcId: 'npc_chen_heng',
          scaleLevel: 2,
          agriculture: 42,
          commerce: 36,
          population: 48,
          publicOrder: 38,
          popularSupport: 45,
          defense: 52,
          recruitPotential: 44,
          armory: 22,
          horseSupply: 8,
          corruption: 31,
          farmlandMu: 2400,
          registeredHouseholds: 380,
          eliteControlledShare: 55,
          localEliteRelation: 35,
          localTreasury: 20,
          localGranary: 180,
          siege: {
            status: 'encircled',
            supplyLine: 'cut',
            preparation: 'prepared',
            cutOffAtTurn: 1,
            initialEnduranceTurns: 15,
          },
          garrisonTroopIds: ['troop_local'],
          relatedNpcIds: ['npc_chen_heng'],
          riskNotes: ['西门外仍有盗匪眼线'],
          recentChanges: ['北门封锁解除'],
          sourceNote: '亲自接管城门后清点',
          updatedAt: '乱世元年2月',
        },
      ],
      privateAssets: [
        {
          privateAssetId: 'asset_market_estate',
          name: 'Market estate',
          type: 'estate',
          ownerScope: 'personal',
          status: 'active',
          summary: 'A small family estate supplying the player household.',
          locationId: 'loc_market_town',
          locationDescription: 'north of the market town',
          managerNpcId: 'npc_chen_heng',
          mu: 120,
          households: 16,
          workers: 10,
          workshopScale: 2,
          ranchCapacity: 6,
          riskNotes: ['tenant disputes'],
          recentChanges: ['new irrigation ditch opened'],
          updatedAt: 'luanshi-year-2-month-2',
        },
      ],
      privateAssetProjects: [
        {
          projectId: 'project_expand_estate',
          assetId: 'asset_market_estate',
          title: 'Expand tenant fields',
          type: 'expand_farmland',
          status: 'active',
          startedAt: 'luanshi-year-2-month-1',
          expectedCompleteAt: 'luanshi-year-2-month-8',
          investedMoney: 12,
          investedGrain: 80,
          targetDelta: { mu: 40, households: 6 },
          progressNotes: ['clearing has begun'],
          updatedAt: 'luanshi-year-2-month-2',
        },
      ],
      domesticReports: [
        {
          reportId: 'domestic_luanshi_y1',
          year: '乱世元年',
          settledAt: '乱世元年九月',
          title: '北门市镇秋收清册',
          summary: '陈衡整顿仓吏后，粮税略有恢复，但腐败仍在侵蚀府库。',
          income: { money: 30, grain: 260, horses: 0, arms: 4, recruits: 20 },
          expenses: { money: 12, grain: 80, horses: 0, arms: 1, recruits: 0 },
          netChange: { money: 18, grain: 180, horses: 0, arms: 3, recruits: 20 },
          holdingHighlights: [{ holdingId: 'holding_market_town', summary: '粮仓恢复到可撑过一季。' }],
          privateAssetHighlights: [{ privateAssetId: 'asset_market_estate', summary: 'Estate fields added private grain.' }],
          projectHighlights: [{ projectId: 'project_expand_estate', assetId: 'asset_market_estate', summary: 'Expansion remains in progress.' }],
          warnings: ['腐败仍偏高'],
          readByPlayer: false,
        },
      ],
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我查看营中粮草');

    expect(prompt.narrativeContext).toContain('资源账本');
    expect(prompt.narrativeContext).toContain('粮草300');
    expect(prompt.narrativeContext).toContain('军械40');
    expect(prompt.narrativeContext).toContain('可征召人手80');
    expect(prompt.narrativeContext).toContain('玩家资源：粮饷36、粮草50');
    expect(prompt.narrativeContext).toContain('势力账本');
    expect(prompt.narrativeContext).toContain('factionId=faction_local_guard');
    expect(prompt.narrativeContext).toContain('市镇守卒');
    expect(prompt.narrativeContext).toContain('名义归属=郡府');
    expect(prompt.narrativeContext).toContain('合法身份=地方守备');
    expect(prompt.narrativeContext).toContain('实际主事=陈衡');
    expect(prompt.narrativeContext).toContain('范围=北门、市镇守卒与巡防');
    expect(prompt.narrativeContext).toContain('核心人物=npc_chen_heng');
    expect(prompt.narrativeContext).toContain('关联部队=troop_local');
    expect(prompt.narrativeContext).toContain('部队账本');
    expect(prompt.narrativeContext).toContain('troopId=troop_local');
    expect(prompt.narrativeContext).toContain('北门守卒');
    expect(prompt.narrativeContext).toContain('兵种=步卒');
    expect(prompt.narrativeContext).toContain('规模变化=100->80');
    expect(prompt.narrativeContext).toContain('疲劳=高');
    expect(prompt.narrativeContext).toContain('lastKnownLocationId=loc_market_town');
    expect(prompt.narrativeContext).toContain('消息时间=乱世元年2月');
    expect(prompt.narrativeContext).toContain('certainty=confirmed');
    expect(prompt.narrativeContext).toContain('orderStatus=issued');
    expect(prompt.narrativeContext).toContain('destinationLocationId=loc_east_gate');
    expect(prompt.narrativeContext).toContain('movementStatus=waitingOrder');
    expect(prompt.narrativeContext).toContain('estimatedArrivalAt=luanshi-year-2-month-2 18:00');
    expect(prompt.narrativeContext).toContain('previousFactionId=faction_dongzhuo');
    expect(prompt.narrativeContext).toContain('allegianceChangedAt=luanshi-year-2-month-2');
    expect(prompt.narrativeContext).toContain('allegianceChangeReason=false surrender followed by uprising');
    expect(prompt.narrativeContext).toContain('lastBattle=battle_north_gate');
    expect(prompt.narrativeContext).toContain('战事记录');
    expect(prompt.narrativeContext).toContain('北门夜袭');
    expect(prompt.narrativeContext).toContain('conflictId=battle_north_gate');
    expect(prompt.narrativeContext).toContain('守卒溃退');
    expect(prompt.narrativeContext).toContain('resultLevel=loss');
    expect(prompt.narrativeContext).toContain('judgement=warJudgementV1');
    expect(prompt.narrativeContext).toContain('turningPoints=ambush:伏兵从巷口逼近，守卒未能重整。');
    expect(prompt.narrativeContext).toContain('领地账本');
    expect(prompt.narrativeContext).toContain('holdingId=holding_market_town');
    expect(prompt.narrativeContext).toContain('北门市镇');
    expect(prompt.narrativeContext).toContain('status=controlled');
    expect(prompt.narrativeContext).toContain('田亩=2400');
    expect(prompt.narrativeContext).toContain('编户=380');
    expect(prompt.narrativeContext).toContain('地方豪强掌控=55%');
    expect(prompt.narrativeContext).toContain('地方豪强关系=+35');
    expect(prompt.narrativeContext).toContain('农业=42');
    expect(prompt.narrativeContext).toContain('腐败=31');
    expect(prompt.narrativeContext).toContain('围城=完全包围');
    expect(prompt.narrativeContext).toContain('补给线=已中断');
    expect(prompt.narrativeContext).toContain('守城补给=');
    expect(prompt.narrativeContext).not.toContain('府库=20');
    expect(prompt.narrativeContext).not.toContain('粮仓=180');
    expect(prompt.narrativeContext).toContain('私人产业账本');
    expect(prompt.narrativeContext).toContain('privateAssetId=asset_market_estate');
    expect(prompt.narrativeContext).toContain('Market estate');
    expect(prompt.narrativeContext).toContain('亩=120');
    expect(prompt.narrativeContext).toContain('户=16');
    expect(prompt.narrativeContext).toContain('工坊=2');
    expect(prompt.narrativeContext).toContain('私产工程账本');
    expect(prompt.narrativeContext).toContain('projectId=project_expand_estate');
    expect(prompt.narrativeContext).toContain('assetId=asset_market_estate');
    expect(prompt.narrativeContext).toContain('mu+40');
    expect(prompt.narrativeContext).toContain('households+6');
    expect(prompt.narrativeContext).toContain('内政报告');
    expect(prompt.narrativeContext).toContain('reportId=domestic_luanshi_y1');
    expect(prompt.narrativeContext).toContain('income=money=30/grain=260/arms=4/recruits=20');
    expect(prompt.narrativeContext).toContain('net=money=18/grain=180/arms=3/recruits=20');
    expect(prompt.stateWriterContext).toContain('payload.command.action=updateResourceLedger');
    expect(prompt.stateWriterContext).toContain('arms、recruits');
    expect(prompt.stateWriterContext).toContain('weapons/documents/tokens/importantSupplies 必须是字符串数组');
    expect(prompt.stateWriterContext).toContain('["箭矢三箱"]');
    expect(prompt.stateWriterContext).toContain('playerResources 只能');
    expect(prompt.stateWriterContext).toContain('备注、来源、说明');
    expect(prompt.stateWriterContext).toContain('领取军饷粮草、缴获粮草军械、豪族捐赠钱粮');
    expect(prompt.stateWriterContext).toContain('payload.command.action=upsertHoldingLedger');
    expect(prompt.stateWriterContext).toContain('稳定 holdingId');
    expect(prompt.stateWriterContext).toContain('已有领地再次更新时必须复用原 holdingId');
    expect(prompt.stateWriterContext).toContain('不得用同一 locationId 另造 holding_xxx 新条目');
    expect(prompt.stateWriterContext).toContain('scaleLevel 只能是 1-5');
    expect(prompt.stateWriterContext).toContain('county/commandery/city/fort/pass/camp/estate/port/village/other');
    expect(prompt.stateWriterContext).toContain('controlled/contested/temporary/lost/archived');
    expect(prompt.stateWriterContext).toContain('默认守城士卒不自动写入部队账本');
    expect(prompt.stateWriterContext).toContain('siege.status');
    expect(prompt.stateWriterContext).toContain('siege.supplyLine');
    expect(prompt.stateWriterContext).toContain('siege.preparation');
    expect(prompt.stateWriterContext).toContain('farmlandMu、registeredHouseholds');
    expect(prompt.stateWriterContext).toContain('eliteControlledShare、localEliteRelation');
    expect(prompt.stateWriterContext).toContain('地方豪强关系');
    expect(prompt.stateWriterContext).toContain('没有实际控制、临时控制、争夺、治理或失去具体领地时，不得输出 upsertHoldingLedger');
    expect(prompt.stateWriterContext).toContain('私人庄园、田产、工坊、马场、铺面等应使用 upsertPrivateAsset');
    expect(prompt.stateWriterContext).toContain('若本回合或开局事实已经明确私人产业或控制领地，必须写入对应账本');
    expect(prompt.stateWriterContext).toContain('不得输出 localTreasury/localGranary');
    expect(prompt.stateWriterContext).toContain('围城解除时写 siege.status=none');
    expect(prompt.stateWriterContext).toContain('可支撑回合由本地计算');
    expect(prompt.stateWriterContext).toContain('不得机械一次性全部触发');
    expect(prompt.stateWriterContext).toContain('本地计算');
    expect(prompt.stateWriterContext).toContain('不得直接写 estimatedOutput/actualCollection/collectionRate');
    expect(prompt.stateWriterContext).toContain('riskNotes/recentChanges=array');
    expect(prompt.stateWriterContext).toContain('非九月额外征收');
    expect(prompt.stateWriterContext).toContain('payload.command.action=upsertDomesticReport');
    expect(prompt.stateWriterContext).toContain('system: 命名空间只由本地规则写入');
    expect(prompt.stateWriterContext).toContain('source=llm');
    expect(prompt.stateWriterContext).not.toContain('LLM 负责把计算结果写成有信息量的报告');
    expect(prompt.stateWriterContext).toContain('privateAssetHighlights');
    expect(prompt.stateWriterContext).toContain('projectHighlights');
    expect(prompt.stateWriterContext).toContain('payload.command.action=upsertPrivateAsset');
    expect(prompt.stateWriterContext).toContain('payload.command.action=upsertPrivateAssetProject');
    expect(prompt.stateWriterContext).toContain('updatedAt 是引擎管理的技术时间戳');
    expect(prompt.stateWriterContext).toContain('空值由引擎按当前游戏时间补齐');
    expect(prompt.stateWriterContext).toContain('money、grain、horses、arms、recruits');
    expect(prompt.stateWriterContext).toContain('本地九月年度结算报告无需模型生成');
    expect(prompt.stateWriterContext).toContain('部队粮草、军饷、马匹、军械维持由本地按月扣除');
    expect(prompt.stateWriterContext).toContain('payload.command.action=upsertFactionLedger');
    expect(prompt.stateWriterContext).toContain('type 必须使用中文势力类型');
    expect(prompt.stateWriterContext).toContain('不得输出 warlord');
    expect(prompt.stateWriterContext).toContain('不得输出 clan/local_government/government');
    expect(prompt.stateWriterContext).toContain('stanceToPlayer 必须写简短关系文本');
    expect(prompt.stateWriterContext).toContain('稳定 factionId');
    expect(prompt.stateWriterContext).toContain('名义归属');
    expect(prompt.stateWriterContext).toContain('合法身份');
    expect(prompt.stateWriterContext).toContain('实际主事');
    expect(prompt.stateWriterContext).toContain('已知势力范围');
    expect(prompt.stateWriterContext).toContain('recentActions 不得省略');
    expect(prompt.stateWriterContext).toContain('同一行动主体不得因别名、官署名、头衔变化另建势力');
    expect(prompt.stateWriterContext).toContain('抽象占位势力');
    expect(prompt.stateWriterContext).toContain('营、曲、残部、亲兵、前锋');
    expect(prompt.stateWriterContext).toContain('不得把部队单位写成独立势力');
    expect(prompt.stateWriterContext).toContain('payload.command.action=upsertTroopLedger');
    expect(prompt.stateWriterContext).toContain('relationToPlayer 必须写简短关系文本');
    expect(prompt.stateWriterContext).toContain('不得写数字评分');
    expect(prompt.stateWriterContext).toContain('玩家亲自统领');
    expect(prompt.stateWriterContext).toContain('leaderNpcId 写 player');
    expect(prompt.stateWriterContext).toContain('副将、军侯、带兵副手');
    expect(prompt.stateWriterContext).toContain('不得把副手写成主将');
    expect(prompt.stateWriterContext).toContain('factionId 指向真实归属势力');
    expect(prompt.stateWriterContext).toContain('morale/training');
    expect(prompt.stateWriterContext).toContain('0-100');
    expect(prompt.stateWriterContext).toContain('新建部队必须包含 quality、readiness、fatigue、lifecycleStatus');
    expect(prompt.stateWriterContext).toContain('strengthTrend 只能写 increased/decreased/stable/unknown');
    expect(prompt.stateWriterContext).toContain('upkeepSource 是内部军需来源字段');
    expect(prompt.stateWriterContext).toContain('player_resources/superior_provision/mixed/unknown');
    expect(prompt.stateWriterContext).toContain('size 是当前已入账兵力绝对值');
    expect(prompt.stateWriterContext).toContain('操练、训练、整顿、打散编入、以老带新');
    expect(prompt.stateWriterContext).toContain('不得把同一批已入账新卒重复加到 size');
    expect(prompt.stateWriterContext).toContain('troopType 只能写具体兵种');
    expect(prompt.stateWriterContext).toContain('不得写“部队/军队/人马/队伍”');
    expect(prompt.stateWriterContext).toContain('番号、营名、郡兵、亲兵、某某部写 specialDesignation');
    expect(prompt.stateWriterContext).toContain('同一支部队必须复用稳定 troopId');
    expect(prompt.stateWriterContext).toContain('previousFactionId');
    expect(prompt.stateWriterContext).toContain('部队换旗、起义、倒戈、假降转公开、被收编时不得因此新建部队');
    expect(prompt.stateWriterContext).toContain('lastKnownAt');
    expect(prompt.stateWriterContext).toContain('orderStatus');
    expect(prompt.stateWriterContext).toContain('orderStatus 只能用 none/issued/inTransit/delivered/delayed/lost/cancelled');
    expect(prompt.stateWriterContext).toContain('不得自造 ordered');
    expect(prompt.stateWriterContext).toContain('movementStatus');
    expect(prompt.stateWriterContext).toContain('destinationLocationId');
    expect(prompt.stateWriterContext).toContain('estimatedArrivalAt');
    expect(prompt.stateWriterContext).toContain('远程军令不得立刻改写 locationId');
    expect(prompt.stateWriterContext).toContain('knownLevel 表示证据来源层级');
    expect(prompt.stateWriterContext).toContain('可靠军报可以是 knownLevel=听闻、certainty=confirmed');
    expect(prompt.stateWriterContext).toContain('knownLevel=推测 与 certainty=confirmed 互相矛盾');
    expect(prompt.stateWriterContext).toContain('更换 destinationLocationId 表示开始新的移动周期');
    expect(prompt.stateWriterContext).toContain('不得沿用上一趟行军的路线或时间');
    expect(prompt.stateWriterContext).toContain('mergedIntoTroopId');
    expect(prompt.stateWriterContext).toContain('lifecycleStatus=destroyed');
    expect(prompt.stateWriterContext).toContain('终态旧建制只保留历史');
    expect(prompt.stateWriterContext).toContain('不得继续计入当前兵力');
    expect(prompt.stateWriterContext).toContain('payload.command.action=upsertConflictRecord');
    expect(prompt.stateWriterContext).toContain('sourceConflictIds');
    expect(prompt.stateWriterContext).toContain('relatedConflictIds');
    expect(prompt.stateWriterContext).toContain('sourceType=conflict');
    expect(prompt.stateWriterContext).toContain('伏击/追击/围城/抢粮');
    expect(prompt.stateWriterContext).toContain('对峙');
    expect(prompt.stateWriterContext).toContain('type 只能用 个人战斗/战争/军事冲突/对峙/其他/野战/伏击/追击/围城/守城/夜袭/抢粮/营寨战/巷战/水战');
    expect(prompt.stateWriterContext).toContain('防御反击不得自造为 type');
    expect(prompt.stateWriterContext).toContain('覆灭/招降/合并/溃退');
    expect(prompt.stateWriterContext).toContain('部队实体变化必须额外使用 upsertTroopLedger');
    expect(prompt.stateWriterContext).toContain('judgement.method=warJudgementV1');
    expect(prompt.stateWriterContext).toContain('scoreBreakdown');
    expect(prompt.stateWriterContext).toContain('updateCharacterUniqueArts');
    expect(prompt.stateWriterContext).toContain('relationToPlayer/recentAttitude 必须写自然中文短句');
    expect(prompt.stateWriterContext).toContain('不得写 neutral/hostile/submissive');
    expect(prompt.stateWriterContext).toContain('personalCombat/warfare/strategy/social/governance/survival/craft/other');
    expect(prompt.stateWriterContext).toContain('turningPoint,playerAction,uniqueArts,total');
    expect(prompt.stateWriterContext).toContain('主帅被斩');
    expect(prompt.stateWriterContext).toContain('underdogReason');
  });

  it('does not feed terminal troop ids back through faction or holding ledger references', () => {
    const state = {
      ...makeState(),
      factions: [{
        factionId: 'faction_player', name: '主角军', type: '军府', summary: '主角直属军府。',
        stanceToPlayer: 'self', knownLevel: '亲历', recentActions: ['完成整编'],
        relatedTroopIds: ['troop_old_camp', 'troop_new_camp'],
      }],
      troops: [
        {
          troopId: 'troop_old_camp', name: '旧步兵营', size: 300, morale: 50, training: 50,
          supplies: 50, task: '历史建制', relationToPlayer: '你直接统领', lifecycleStatus: 'merged',
          mergedIntoTroopId: 'troop_new_camp', locationId: 'loc_market_town',
        },
        {
          troopId: 'troop_new_camp', name: '新主力营', size: 500, morale: 70, training: 70,
          supplies: 70, task: '整编待命', relationToPlayer: '你直接统领', lifecycleStatus: 'active',
          factionId: 'faction_player', locationId: 'loc_market_town',
        },
      ],
      holdings: [{
        holdingId: 'holding_main_camp', name: '中军营', type: 'camp', status: 'controlled', summary: '主角营地。',
        locationId: 'loc_market_town', factionId: 'faction_player', scaleLevel: 1,
        agriculture: 0, commerce: 0, population: 10, publicOrder: 80, popularSupport: 70,
        defense: 60, recruitPotential: 20, armory: 50, horseSupply: 30, corruption: 0,
        garrisonTroopIds: ['troop_old_camp', 'troop_new_camp'], updatedAt: '乱世元年2月',
      }],
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '查看整编后的现役部队');

    expect(prompt.narrativeContext).toContain('关联部队=troop_new_camp');
    expect(prompt.narrativeContext).toContain('驻防部队=troop_new_camp');
    expect(prompt.narrativeContext).toContain('troopId=troop_new_camp');
    expect(prompt.narrativeContext).not.toContain('troop_old_camp');
    expect(prompt.narrativeContext).not.toContain('腐败=0');
    expect(prompt.stateWriterContext).toContain('不得写 corruption');
    expect(prompt.stateWriterContext).toContain('税收、征收或经营收益');
  });

  it('prioritizes holdings linked by current matters over unrelated active holdings', () => {
    const unrelatedHoldings = Array.from({ length: 7 }, (_, index) => ({
      holdingId: `holding_unrelated_${index + 1}`,
      name: `远方庄园${index + 1}`,
      type: 'estate' as const,
      status: 'controlled' as const,
      summary: '远方暂不相关的庄园。',
      locationId: 'loc_far',
      scaleLevel: 1 as const,
      agriculture: 30,
      commerce: 20,
      population: 20,
      publicOrder: 50,
      popularSupport: 50,
      defense: 20,
      recruitPotential: 10,
      armory: 5,
      horseSupply: 1,
      corruption: 20,
      updatedAt: `乱世元年2月0${index + 1}日`,
    }));
    const state = {
      ...makeState(),
      activeQuests: [
        {
          id: 'quest_bridge_holding',
          title: '守住桥头庄',
          description: '桥头庄是当前唯一明确牵连的领地。',
          status: 'active',
          priority: 'low',
          affectedHoldingIds: ['holding_bridge'],
          createdAt: '乱世元年2月',
          updatedAt: '乱世元年2月',
        },
      ],
      holdings: [
        ...unrelatedHoldings,
        {
          holdingId: 'holding_bridge',
          name: '桥头庄',
          type: 'estate',
          status: 'controlled',
          summary: '桥头庄控制渡口粮道，正被当前事项牵连。',
          locationId: 'loc_far',
          stewardNpcId: 'npc_chen_heng',
          scaleLevel: 1,
          agriculture: 38,
          commerce: 24,
          population: 30,
          publicOrder: 44,
          popularSupport: 41,
          defense: 35,
          recruitPotential: 21,
          armory: 9,
          horseSupply: 2,
          corruption: 28,
          updatedAt: '乱世元年2月',
        },
      ],
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我询问桥头庄的粮道');

    expect(prompt.narrativeContext).toContain('holdingId=holding_bridge');
    expect(prompt.narrativeContext).toContain('桥头庄控制渡口粮道');
  });

  it('projects compact relevant personal combat records into narrative context', () => {
    const state = {
      ...makeState(),
      combatRecords: [
        {
          combatId: 'combat_gate_duel',
          kind: 'duel',
          title: '北门短兵交锋',
          summary: '主角在北门以旧短刀逼退敌将亲兵。',
          occurredAt: '乱世元年2月',
          locationId: 'loc_market_town',
          locationName: '市镇北门',
          participants: [
            { npcId: 'player', name: '主角', side: 'player', role: '持刀者', outcome: '逼退敌人' },
            { npcId: 'npc_chen_heng', name: '陈衡', side: 'ally', role: '掩护者', outcome: '稳住队伍' },
          ],
          playerInvolved: true,
          resultLevel: 'win',
          outcome: '主角逼退亲兵，陈衡得以整队。',
          significance: 'notable',
          relatedNpcIds: ['npc_chen_heng'],
          relatedQuestIds: ['quest_rescue'],
          judgement: {
            method: 'combatJudgementV1',
            perspectiveSide: 'player',
            advantageBand: 'slightAdvantage',
            decisiveMoment: '主角抓住对方换手破绽。',
            scoreBreakdown: {
              personalBase: 4,
              equipment: -1,
              uniqueArts: 3,
              playerAction: 5,
              total: 11,
            },
          },
          outcomeTags: ['forceRetreat'],
          briefText: '旧短刀贴近格开长柄，主角逼退亲兵。',
          updatedAt: '乱世元年2月',
        },
      ],
    } as RuntimeState;

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我问陈衡还记不记得北门交锋');

    expect(prompt.narrativeContext).toContain('个人战记录');
    expect(prompt.narrativeContext).toContain('combatId=combat_gate_duel');
    expect(prompt.narrativeContext).toContain('北门短兵交锋');
    expect(prompt.narrativeContext).toContain('combatJudgementV1');
  });

  it('documents personal combat writeback and reputation protocol', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我向敌将叫阵单挑');

    expect(prompt.stateWriterContext).toContain('payload.command.action=upsertCombatRecord');
    expect(prompt.stateWriterContext).toContain('combatJudgementV1');
    expect(prompt.stateWriterContext).toContain('briefText 建议 20-40 字');
    expect(prompt.stateWriterContext).toContain('reportText 建议 180-240 字');
    expect(prompt.stateWriterContext).toContain('结合环境、对手、招式/动作、关键转折和结果余波');
    expect(prompt.stateWriterContext).toContain('reportText/briefText 不得包含【旁白】');
    expect(prompt.stateWriterContext).toContain('kind 只能用 duel/melee/assassination/escape/capture/battlefieldDuel/other');
    expect(prompt.stateWriterContext).toContain('participants 必须是对象数组');
    expect(prompt.stateWriterContext).toContain('advantageBand 只能用 overwhelmingAdvantage');
    expect(prompt.stateWriterContext).toContain('scoreBreakdown.notes 必须是字符串数组');
    expect(prompt.stateWriterContext).toContain('战争 scoreBreakdown.total 绝对值不得超过 250');
    expect(prompt.stateWriterContext).toContain('战争 scoreBreakdown.total 必须等于已写分项之和');
    expect(prompt.stateWriterContext).toContain('战争 underdogReason 必须是非空字符串');
    expect(prompt.stateWriterContext).toContain('turningPoints[].type 只能用 duelVictory/duelDefeat/commanderSlain/commanderCaptured/commanderWounded/commanderFled/ambush/fireAttack/supplyDestroyed/gateBreached/reinforcementArrived/moraleCollapse/terrainBreakthrough/playerAction/other');
    expect(prompt.stateWriterContext).toContain('scoreBreakdown 各数值字段（包括 total）绝对值不得超过 200');
    expect(prompt.stateWriterContext).toContain('turningPoints[].impact 只能用 minor/moderate/major/critical');
    expect(prompt.stateWriterContext).toContain('recordTurnEvent.visibility 必须且只能单选 私密/在场可知/传闻扩散/公开');
    expect(prompt.stateWriterContext).toContain('updateNpcLoadout.equipmentChanges action 只能用 upsert/remove/unequip');
    expect(prompt.stateWriterContext).toContain('upsertTroopLedger 不得输出空对象或缺少 troopId 的占位对象');
    expect(prompt.stateWriterContext).toContain('movementStatus 只能用 none/waitingOrder/preparing/marching/arrived/blocked/interrupted/cancelled');
    expect(prompt.stateWriterContext).toContain('不得自造 departed');
    expect(prompt.stateWriterContext).toContain('upsertNpcProfile 即使更新已有 NPC 也必须提供完整必填字段');
    expect(prompt.stateWriterContext).toContain('不得输出 updateNpcProfile');
    expect(prompt.stateWriterContext).toContain('payload.command.action=updateCharacterReputation');
    expect(prompt.stateWriterContext).toContain('tags 必须是对象数组 [{label, source}]');
    expect(prompt.stateWriterContext).toContain('不要写字符串数组');
    expect(prompt.stateWriterContext).toContain('relatedConflictIds');
    expect(prompt.stateWriterContext).toContain('worldEventSummary');
    expect(prompt.stateWriterContext).toContain('upsertConflictRecord');
    expect(prompt.stateWriterContext).toContain('turningPoint,uniqueArts,total');
  });

  it('documents inline judgement markers for ordinary checks, battles, and personal combats', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我观察军阵后向敌将叫阵');

    expect(prompt.userPrompt).toContain('[[判定:checkId]]');
    expect(prompt.userPrompt).toContain('[[判定:battle:conflictId]]');
    expect(prompt.userPrompt).toContain('[[判定:combat:combatId]]');
    expect(prompt.userPrompt).toContain('不要把所有判定标记集中在开头或末尾');
    expect(prompt.userPrompt).toContain('不得出现没有对应 ordinaryChecks 项的孤儿标记');
    expect(prompt.stateWriterContext).toContain('[[判定:battle:conflictId]]');
    expect(prompt.stateWriterContext).toContain('[[判定:combat:combatId]]');
  });

  it('documents player loadout partial writeback boundaries', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我收起金疮药并换上偃月刀');

    expect(prompt.stateWriterContext).toContain('payload.command.action=updatePlayerLoadout');
    expect(prompt.stateWriterContext).toContain('inventoryChanges:[{action:"upsert"');
    expect(prompt.stateWriterContext).toContain('不要用 action:"add"');
    expect(prompt.stateWriterContext).toContain('equipFromInventory.itemId 必须非空');
    expect(prompt.stateWriterContext).toContain('没有实际换装不要输出空 itemId');
    expect(prompt.stateWriterContext).toContain('inventoryChanges.remove/setQuantity.itemId 必须非空');
    expect(prompt.stateWriterContext).toContain('没有明确目标 itemId 时省略该候选');
    expect(prompt.stateWriterContext).toContain('personalMoneyDelta');
    expect(prompt.stateWriterContext).toContain('不能与 personalMoney 同时提供');
    expect(prompt.stateWriterContext).toContain('不得写入 playerResources.money/钱财');
    expect(prompt.stateWriterContext).toContain('一次性凭证的权益已经兑现');
    expect(prompt.stateWriterContext).toContain('同一回合必须用 inventoryChanges.remove 或 setQuantity');
    expect(prompt.stateWriterContext).toContain('仅出示、核验或仍可重复使用的长期凭证不得移除');
    expect(prompt.stateWriterContext).toContain('先核对玩家行动与最终正文已经成立的事实');
    expect(prompt.stateWriterContext).toContain('仅在正文中提到、看见或回忆既有物品');
    expect(prompt.stateWriterContext).toContain('不得再次 upsert');
    expect(prompt.stateWriterContext).toContain('购买成立时必须同时写入物品获得与负数 personalMoneyDelta');
  });

  it('documents narrow NPC presence writeback and strict physical presence semantics', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我离开门候，独自前往城内');

    expect(prompt.stateWriterContext).toContain('payload.command.action=updateNpcPresence');
    expect(prompt.stateWriterContext).toContain('同城但不在当前场景');
    expect(prompt.stateWriterContext).toContain('不等于在场');
  });

  it('projects a stale location-mismatched NPC as focused with isPresent false', () => {
    const state = makeState();
    state.npcs![0].locationId = 'loc_remote';
    state.npcs![0].isPresent = true;
    state.npcs![0].isFocused = true;
    state.turnEvents = [];

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我留在市镇整理行囊');

    expect(prompt.stateWriterContext).toContain('focusedNpcs:');
    expect(prompt.stateWriterContext).toContain('npcId: npc_chen_heng');
    expect(prompt.stateWriterContext).toContain('isPresent: false');
  });

  it('projects stable NPC narrative anchors with bounded text but omits routine appearance', () => {
    const state = makeState();
    const npc = state.npcs![0];
    npc.summary = `SUMMARY_START_${'甲'.repeat(180)}_SUMMARY_TAIL_SENTINEL`;
    npc.personality = `PERSONALITY_START_${'乙'.repeat(150)}_PERSONALITY_TAIL_SENTINEL`;
    npc.motivation = `MOTIVATION_START_${'丙'.repeat(150)}_MOTIVATION_TAIL_SENTINEL`;
    npc.appearance = 'APPEARANCE_SENTINEL';

    const prompt = composePrompt(worldBook, undefined, [], undefined, state, '我请陈衡说明他的打算');

    expect(prompt.narrativeContext).toContain('人物定位：SUMMARY_START_');
    expect(prompt.narrativeContext).toContain('核心性格：PERSONALITY_START_');
    expect(prompt.narrativeContext).toContain('当前动机：MOTIVATION_START_');
    expect(prompt.narrativeContext).not.toContain('SUMMARY_TAIL_SENTINEL');
    expect(prompt.narrativeContext).not.toContain('PERSONALITY_TAIL_SENTINEL');
    expect(prompt.narrativeContext).not.toContain('MOTIVATION_TAIL_SENTINEL');
    expect(prompt.narrativeContext).not.toContain('稳定外貌：APPEARANCE_SENTINEL');
    expect(prompt.narrativeContext.length).toBeLessThan(30_000);
  });

  it('projects stable appearance only for first contact or an explicit observation action', () => {
    const state = makeState();
    state.npcs![0].appearance = '身形高挑，左眉有一道旧疤。';

    const ordinaryPrompt = composePrompt(worldBook, undefined, [], undefined, state, '我请陈衡安排巡夜');
    const observationPrompt = composePrompt(worldBook, undefined, [], undefined, state, '我端详陈衡的衣着与神色');
    state.npcs![0].contactLevel = 0;
    const firstContactPrompt = composePrompt(worldBook, undefined, [], undefined, state, '我向陈衡报上姓名');

    expect(ordinaryPrompt.narrativeContext).not.toContain('稳定外貌：身形高挑，左眉有一道旧疤。');
    expect(observationPrompt.narrativeContext).toContain('稳定外貌：身形高挑，左眉有一道旧疤。');
    expect(firstContactPrompt.narrativeContext).toContain('稳定外貌：身形高挑，左眉有一道旧疤。');
  });

  it('documents historical NPC profile continuity without random personality rewriting', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我与陈衡商议守城');

    expect(prompt.narrativeContext).toContain('人物底档用于稳定判断与行动取向');
    expect(prompt.narrativeContext).toContain('不得机械复读为固定口癖');
    expect(prompt.stateWriterContext).toContain('历史重点人物档案优先服从资料库、本局既有档案与已成立记忆');
    expect(prompt.stateWriterContext).toContain('不得为了“更有戏”随机覆盖 personality 或 motivation');
  });

  it('projects the complete troop stable index and the canonical movement writeback contract', () => {
    const state = makeState();
    state.troops = Array.from({ length: 7 }, (_, index) => ({
      troopId: `troop_stable_${index + 1}`,
      name: index === 0 ? '玄甲前锋' : `常备营第${index + 1}部`,
      aliases: index === 0 ? ['北亭旧部'] : undefined,
      size: 100 + index,
      morale: 50,
      training: 50,
      supplies: 50,
      task: '待命',
      relationToPlayer: index === 0 ? '友军' : '你直接统领',
      lifecycleStatus: 'active',
      locationId: index === 0 ? 'loc_market_town' : undefined,
      lastKnownLocationId: index === 0 ? 'loc_market_town' : undefined,
      movementStatus: index === 0 ? 'waitingOrder' : 'none',
      updatedAt: `乱世元年2月0${index + 1}日`,
    }));

    const prompt = composePrompt(
      worldBook,
      undefined,
      [],
      undefined,
      state,
      '传令北亭旧部留在原地，并核对玄甲前锋的位置。',
    );

    expect(prompt.stateWriterContext).toContain('troopStableIndex:');
    for (const troop of state.troops) {
      expect(prompt.stateWriterContext).toContain(`troopId: ${troop.troopId}`);
    }
    expect(prompt.stateWriterContext.indexOf('troopId: troop_stable_1'))
      .toBeLessThan(prompt.stateWriterContext.indexOf('troopId: troop_stable_7'));
    expect(prompt.stateWriterContext).toContain('全部已登记部队的紧凑稳定 ID 真值表');
    expect(prompt.stateWriterContext).toContain('不得发明 unknown/loc_unknown 占位 ID');
    expect(prompt.stateWriterContext).toContain('movementStatus=arrived 时当前位置、最后已知位置和目标地点必须一致');
    expect(prompt.stateWriterContext).toContain('远场部队位置未确认时应省略位置字段');
  });
});
