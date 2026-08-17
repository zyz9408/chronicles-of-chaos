import { describe, expect, it } from 'vitest';
import type { Actor } from '../engine/types';
import type { MemoryArchive } from '../engine/types/memory';
import { ensureLuanShiState } from '../engine/state/createInitialRuntimeState';
import { buildPlayerProfilePanelModel } from './playerProfilePanelModel';
import { readUiStyleSource } from './readUiStyleSource.test-helper';

const basePlayer: Actor = {
  id: 'player',
  name: '刘达',
  courtesyName: '子远',
  artName: '北营散人',
  aliases: ['洛阳少年', '小刘校尉'],
  commonAddress: '刘校尉',
  sex: '男',
  age: 22,
  roleType: 'player',
  socialClass: '宗室支脉',
  birthOrigin: '宗室支脉',
  birthOriginDescription: '汉室远支，名分尚在，实权未必可靠。',
  currentIdentity: '军中将校',
  currentIdentityDescription: '北军营中低阶军官，受上级节制。',
  factionName: '北军',
  allegianceTarget: '何进',
  officeTitle: '假司马',
  militaryTitle: '队率',
  nobleTitle: '无',
  identitySummary: '以宗室支脉之名在北军立身，处境微妙。',
  appearance: '黑发黑眸，衣着朴素。',
  personality: '谨慎克制，遇事先观察再出手。',
  abilityScores: { 武力: 52, 统率: 51, 智力: 49, 政治: 45, 魅力: 50, 机运: 48 },
  level: 1,
  xp: 10,
  growthPoints: 0,
  vitals: { hp: 100, maxHp: 100, stamina: 90, maxStamina: 100 },
  traits: [
    {
      id: 'trait_horse_archery',
      label: '弓马娴熟',
      description: '熟悉骑射和军中操练。',
      source: 'opening',
      promptHint: '涉及骑射、巡逻、军阵时可作为优势。',
    },
  ],
  uniqueArts: [
    {
      id: 'art_cavalry_command',
      name: 'Cavalry Command',
      rarity: 'blue',
      domain: 'warfare',
      level: 2,
      maxLevel: 5,
      progress: 45,
      description: 'Commands mounted troops with steady timing.',
      effectSummary: 'Adds advantage when leading cavalry or responding to cavalry threats.',
      source: 'opening',
      promptHint: 'Use in army judgement when cavalry command matters.',
    },
  ],
  effects: [
    {
      id: 'effect_tired',
      label: '疲惫',
      type: 'debuff',
      duration: 'short',
      description: '昨夜未眠，反应稍慢。',
      source: 'turn',
    },
  ],
  equipment: [
    {
      id: 'eq_sword',
      slot: 'weapon',
      name: '旧短刀',
      quality: '普通',
      description: '营中制式短刀。',
    },
  ],
  inventory: [{ id: 'dry_food', name: '干粮', quantity: 2 }],
  personalMoney: 45,
  reputation: {
    morality: 50,
    fame: 8,
    tags: [{ label: '略有名声', source: 'opening' }],
    summary: '只在营中略有人知。',
  },
  playerMemory: {
    summary: '初入洛阳乱局，尚无定局。',
    keyDeeds: [{ id: 'deed_1', date: '公元189年09月01日', summary: '在洛阳北军营中立足。' }],
    recentTurns: ['抵达北军大营。'],
  },
  summary: '主角。',
};

describe('buildPlayerProfilePanelModel', () => {
  it('displays the canonical birthday and derives the current age instead of trusting the snapshot', () => {
    const model = buildPlayerProfilePanelModel(
      { ...basePlayer, age: 99, birthDate: '公元166年09月02日' },
      undefined,
      '公元189年09月01日 08:00（辰时）',
    );

    expect(model.basicRows).toContainEqual({ label: '基本', value: '男 / 22岁' });
    expect(model.basicRows).toContainEqual({ label: '出生日期', value: '公元166年09月02日' });
  });

  it('builds a dedicated player profile model with identity, traits, equipment and memory', () => {
    const model = buildPlayerProfilePanelModel(basePlayer);

    expect(model.title).toBe('刘达');
    expect(model.subtitle).toBe('字子远 · 号北营散人 · 刘校尉');
    expect(model.basicRows).toContainEqual({ label: '别称', value: '洛阳少年、 小刘校尉' });
    expect(model.basicRows).toContainEqual({ label: '外貌', value: '黑发黑眸，衣着朴素。' });
    expect(model.basicRows).toContainEqual({ label: '性格', value: '谨慎克制，遇事先观察再出手。' });
    expect(model.identityRows).toContainEqual({ label: '当前身份', value: '军中将校', detail: '北军营中低阶军官，受上级节制。' });
    expect(model.identityRows).toContainEqual({ label: '军职', value: '队率' });
    expect(model.identityRows).toContainEqual({ label: '效力对象', value: '何进' });
    expect(model.identityRows.map((row) => row.label)).not.toContain('身份摘要');
    expect(model.narrativeRows).toEqual([]);
    expect(model.traitCards[0]).toMatchObject({ label: '弓马娴熟', kind: 'trait' });
    expect(model.traitCards[0].tooltip).toContain('骑射');
    expect(model.uniqueArtCards[0]).toMatchObject({
      label: 'Cavalry Command',
      kind: 'uniqueArt',
      rarity: 'blue',
    });
    expect(model.uniqueArtCards[0].tooltip).toContain('Lv.2 / 5');
    expect(model.uniqueArtCards[0].tooltip).toContain('Adds advantage');
    expect(model.effectCards[0]).toMatchObject({ label: '疲惫', kind: 'debuff' });
    expect(model.equipmentRows[0]).toMatchObject({ label: '武器', value: '旧短刀·普通' });
    expect(model.equipmentRows[0].tooltip).toContain('品质：普通');
    expect(model.equipmentRows[0].tooltip).toContain('说明：营中制式短刀。');
    expect(model.inventoryPreview).toEqual(['干粮x2']);
    expect(model.reputation).toEqual({
      fame: 8,
      morality: 50,
      fameLabel: '略有善名',
      moralityLabel: '略有德名',
      fameDisplay: '略有善名',
      moralityDisplay: '略有德名',
      tags: ['略有名声（开局）'],
      summary: '只在营中略有人知。',
    });
    expect(model.summaryRows).toEqual([
      expect.objectContaining({ label: '身份', value: '军中将校', detail: expect.stringContaining('北军') }),
      { label: '声名', value: '略有善名' },
      { label: '德行', value: '略有德名' },
      { label: '钱财', value: '45钱' },
      { label: '行装', value: '1件装备 / 1类携物' },
    ]);
    expect(model.inventoryRows).toEqual([
      expect.objectContaining({ label: '杂物', value: '干粮 x2' }),
    ]);
    expect(model.memoryRows).toContainEqual({ label: '履历摘要', value: '初入洛阳乱局，尚无定局。' });
    expect(model.memorySections.map((section) => section.title)).toEqual(['过往概括', '近期记忆', '关键事迹']);
  });

  it('projects recent, mid-term, and long-term protagonist memory into the player profile model', () => {
    const memoryArchive: MemoryArchive = {
      ...ensureLuanShiState({ player: basePlayer } as any).memoryArchive,
      recentTurnSummaries: [
        {
          id: 'recent_1',
          turnNumber: 8,
          createdAt: '189-09-01 12:30',
          brief: 'The protagonist checked the camp after noon.',
          playerActionSummary: 'Inspected the camp.',
          visibleConsequence: 'The soldiers settled down.',
          importance: 'medium',
        },
      ],
      midTermSummaries: [
        {
          summaryId: 'mid_1',
          title: 'Luoyang escape arc',
          fromCreatedAt: '189-09-01 08:00',
          toCreatedAt: '189-09-01 12:00',
          summary: 'The protagonist gathered scattered soldiers and stabilized a small camp.',
          updatedAt: '189-09-01 12:00',
        },
      ],
      longTermFacts: [
        {
          factId: 'fact_1',
          category: 'consequence',
          createdAt: '189-09-01 12:00',
          summary: 'The protagonist is now trusted by the rescued soldiers.',
          importance: 'high',
        },
        {
          factId: 'fact_identity',
          category: 'identity',
          createdAt: '189-09-01 12:10',
          summary: 'The protagonist now acts as the camp commander.',
          importance: 'critical',
        },
        {
          factId: 'fact_relationship',
          category: 'relationship',
          createdAt: '189-09-01 12:20',
          summary: 'The rescued soldiers now trust the protagonist.',
          importance: 'high',
        },
        {
          factId: 'fact_world',
          category: 'world',
          createdAt: '189-09-01 12:30',
          summary: 'The capital remains under military pressure.',
          importance: 'high',
        },
      ],
    };

    const playerWithAsciiRecentMemory: Actor = {
      ...basePlayer,
      playerMemory: {
        summary: basePlayer.playerMemory!.summary,
        keyDeeds: basePlayer.playerMemory!.keyDeeds,
        recentTurns: ['Reached the northern camp and assessed the survivors.'],
      },
    };

    const model = buildPlayerProfilePanelModel(playerWithAsciiRecentMemory, memoryArchive);
    const memoryValues = model.memoryRows.map((row) => row.value);

    expect(memoryValues).toContain('Reached the northern camp and assessed the survivors.');
    expect(memoryValues).toContain('The protagonist checked the camp after noon.');
    expect(memoryValues).toContain('The protagonist gathered scattered soldiers and stabilized a small camp.');
    expect(memoryValues).toContain('The protagonist is now trusted by the rescued soldiers.');
    const longTermLabels = model.memorySections
      .find((section) => section.title === '长期事实')
      ?.rows.map((row) => row.label);
    expect(longTermLabels).toEqual(expect.arrayContaining(['身份｜关键', '关系｜重要', '世界局势｜重要', '后果｜重要']));
    expect(model.memorySections.map((section) => section.title)).toEqual([
      '过往概括',
      '近期记忆',
      '每回合摘要',
      '关键事迹',
      '中期摘要',
      '长期事实',
    ]);
  });

  it('renders grouped protagonist memory and full-value hover titles in GameScreen', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const memorySource = readFileSync(new URL('./MemoryPanel.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const css = await readUiStyleSource();

    expect(source).toContain('profileRowTitle(row)');
    expect(source).toContain('playerProfileModel.summaryRows.map');
    expect(source).toContain('character-summary-grid');
    expect(source).toContain('player-profile-section-grid');
    expect(source).toContain('player-profile-basic-card');
    expect(source).toContain('player-profile-row-stack');
    expect(source).toContain('profileRowClassName(row)');
    expect(source).toContain('playerProfileModel.inventoryRows.map');
    expect(source).toContain('<MemoryPanel');
    expect(source).toContain('sections={playerProfileModel.memorySections}');
    expect(memorySource).toContain("label: '短期记忆'");
    expect(memorySource).toContain("label: '中期记忆'");
    expect(memorySource).toContain("label: '长期记忆'");
    expect(memorySource).toContain('role="tablist"');
    expect(memorySource).toContain('player-memory-section-title');
    expect(source).toContain('deriveCurrentWeather(runtimeState)');
    expect(source).toContain('gtb-weather-row');
    expect(source).toContain('<span className="gtb-title">乱世风云录</span>\n            <div className="gtb-weather-row"');
    expect(source).not.toContain('<span>{getLocationName(runtimeState.currentLocationId)}</span>\n            </div>\n            <div className="gtb-weather-row"');
    expect(source).toContain('allocatePlayerGrowthPoint');
    expect(source).toContain('CORE_PLAYER_ATTRIBUTE_KEYS');
    expect(source).toContain('handleAllocateGrowthPoint');
    expect(source).toContain('player-profile-section-head');
    expect(source).toContain('player-ability-plus');
    expect(source).toContain("{reputationModel?.fameDisplay ?? '声名未显'}");
    expect(source).toContain("{reputationModel?.moralityDisplay ?? '德行未定'}");
    expect(source).not.toContain('名声 {reputationModel?.fame ?? 0}');
    expect(source).not.toContain('德行 {reputationModel?.morality ?? 0}');
    expect(source).not.toContain('rep-natural-language');
    expect(source).not.toContain('reputationModel.tags');
    expect(source).not.toContain('reputationModel.summary');
    expect(source).not.toContain('<small>PLAYER PROFILE</small>');
    expect(source).not.toContain('<small>BACKPACK</small>');
    expect(source).not.toContain('<small>UNIQUE ARTS</small>');
    expect(css).toContain('.character-summary-grid');
    expect(css).toContain('.player-profile-section-grid');
    expect(css).toContain('align-items: stretch;');
    expect(css).toContain('.player-profile-row--compact');
    expect(css).toContain('.player-profile-row--long strong');
    expect(css).toContain('white-space: normal;');
    expect(css).toContain('.player-memory-section');
    expect(css).toContain('.memory-panel-tabs');
    expect(css).toContain('.memory-panel-content');
    expect(css).toContain('.gtb-weather-row');
    expect(css).toContain('.player-profile-growth-points');
    expect(css).toContain('.player-ability-plus');
  });
});
