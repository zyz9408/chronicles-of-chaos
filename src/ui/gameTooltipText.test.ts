import { describe, expect, it } from 'vitest';
import type { CharacterEquipmentItem, CharacterUniqueArt } from '../engine/types';
import {
  TRAIT_RARITY_LEGEND_TITLE,
  buildEquipmentTooltipTitle,
  buildUniqueArtTooltipTitle,
  formatEquipmentQualityLabel,
  formatKnownSourceLabel,
  normalizeTraitRarity,
  normalizeUniqueArtRarity,
} from './gameTooltipText';

describe('game tooltip text', () => {
  it('explains trait rarity levels and their narrative weight', () => {
    expect(TRAIT_RARITY_LEGEND_TITLE).toContain('白');
    expect(TRAIT_RARITY_LEGEND_TITLE).toContain('绿');
    expect(TRAIT_RARITY_LEGEND_TITLE).toContain('蓝');
    expect(TRAIT_RARITY_LEGEND_TITLE).toContain('紫');
    expect(TRAIT_RARITY_LEGEND_TITLE).toContain('橙');
    expect(TRAIT_RARITY_LEGEND_TITLE).toContain('红');
    expect(TRAIT_RARITY_LEGEND_TITLE).not.toContain('金：');
    expect(TRAIT_RARITY_LEGEND_TITLE).toContain('叙事权重');
    expect(TRAIT_RARITY_LEGEND_TITLE).toContain('不等于固定数值加成');
  });

  it('builds detailed equipment and treasure tooltip text', () => {
    const item: CharacterEquipmentItem = {
      id: 'treasure_manual',
      slot: 'treasure',
      name: '残本《孙子兵法》',
      quality: '普通',
      description: '残缺兵书，能在筹划行军时提供思路。',
      condition: '纸页残破',
      promptHint: '涉及军略、守御、行军判断时，可作为轻度优势。',
      checkHooks: [{ scope: '统率/谋划', modifier: 4, note: '读过残本，能多想一步。' }],
      unlocks: ['可尝试辨认军令漏洞'],
      risks: ['纸页易损，雨天携带需保护'],
    };

    const tooltip = buildEquipmentTooltipTitle(item);

    expect(tooltip).toContain('残本《孙子兵法》');
    expect(tooltip).toContain('品质：普通');
    expect(tooltip).toContain('状态：纸页残破');
    expect(tooltip).toContain('作用：统率·谋划 +4，读过残本，能多想一步。');
    expect(tooltip).toContain('可解锁：可尝试辨认军令漏洞');
    expect(tooltip).toContain('风险：纸页易损，雨天携带需保护');
  });

  it('formats known color quality codes as Chinese player-facing labels', () => {
    const item: CharacterEquipmentItem = {
      id: 'eq_prefect_sword',
      slot: 'weapon',
      name: '太守佩剑',
      quality: 'blue',
      description: '象征郡府权威。',
    };

    expect(formatEquipmentQualityLabel('blue')).toBe('蓝');
    expect(buildEquipmentTooltipTitle(item)).toContain('品质：蓝');
    expect(buildEquipmentTooltipTitle(item)).not.toContain('blue');
    expect(formatEquipmentQualityLabel('fine')).toBe('精良');
    expect(formatEquipmentQualityLabel('normal')).toBe('普通');
  });

  it('formats common internal source labels for player-facing panels', () => {
    expect(formatKnownSourceLabel('origin')).toBe('出身');
    expect(formatKnownSourceLabel('birthOrigin')).toBe('出身');
    expect(formatKnownSourceLabel('identity')).toBe('身份');
    expect(formatKnownSourceLabel('observation')).toBe('现场观察');
    expect(formatKnownSourceLabel('history')).toBe('史实资料');
    expect(formatKnownSourceLabel('runtime.story')).toBe('剧情推进');
    expect(formatKnownSourceLabel('opening')).toBe('开局');
    expect(formatKnownSourceLabel('writeback')).toBe('剧情记录');
  });

  it('renders the shared six-tier trait and unique-art quality scale', () => {
    const art: CharacterUniqueArt = {
      id: 'art_legendary_command',
      name: '神机节制',
      rarity: 'orange',
      domain: 'warfare',
      level: 3,
      description: '在复杂战局中稳定调度各部。',
      effectSummary: '强化军略与临阵调度。',
      source: 'history',
    };

    expect(normalizeUniqueArtRarity('purple')).toBe('purple');
    expect(normalizeUniqueArtRarity('orange')).toBe('orange');
    expect(normalizeUniqueArtRarity('gold')).toBe('red');
    expect(normalizeTraitRarity('purple')).toBe('purple');
    expect(normalizeTraitRarity('orange')).toBe('orange');
    expect(normalizeTraitRarity('gold')).toBe('red');
    expect(buildUniqueArtTooltipTitle(art)).toContain('品级：传说');
  });
});
