import { describe, expect, it } from 'vitest';
import { resolveTroopVisualAsset } from './troopVisualAssets';

describe('troopVisualAssets', () => {
  it('selects troop panel visuals from troop type, size and quality only', () => {
    const visual = resolveTroopVisualAsset({
      troopTypeText: '骑兵',
      sizeText: '500人',
      qualityText: '精锐',
      caption: '骑兵 · 500人 · 精锐度 精锐',
    });

    expect(visual.assetKey).toBe('troop_force_cavalry_medium_elite_v01.png');
    expect(visual.label).toBe('骑兵 · 中队 · 精锐度 高');
  });

  it('keeps naval forces on naval visuals instead of cavalry fallbacks', () => {
    const visual = resolveTroopVisualAsset({
      troopTypeText: '水军',
      sizeText: '800人',
      qualityText: '精锐',
      caption: '水军 · 800人 · 精锐度 精锐',
    });

    expect(visual.assetKey).toBe('troop_force_naval_medium_elite_v01.png');
    expect(visual.label).toBe('水军 · 中队 · 精锐度 高');
    expect(visual.assetKey).not.toContain('cavalry');
  });

  it('falls back to infantry line for ordinary foot soldiers', () => {
    const visual = resolveTroopVisualAsset({
      troopTypeText: '步卒',
      sizeText: '200人',
      qualityText: '中',
      caption: '步卒 · 200人 · 精锐度 中',
    });

    expect(visual.assetKey).toBe('troop_force_infantry_small_standard_v01.png');
    expect(visual.label).toBe('步卒 · 小队 · 精锐度 中');
  });

  it('selects logistics visuals from supply wording', () => {
    const visual = resolveTroopVisualAsset({
      troopTypeText: '辎重队',
      sizeText: '1600人',
      qualityText: '粗劣',
      caption: '辎重队 · 1600人 · 精锐度 粗劣',
    });

    expect(visual.assetKey).toBe('troop_force_logistics_large_poor_v01.png');
    expect(visual.label).toBe('辎重 · 大队 · 精锐度 低');
  });

  it('selects archer visuals for bow and crossbow units', () => {
    const visual = resolveTroopVisualAsset({
      troopTypeText: '弓弩',
      sizeText: '800人',
      qualityText: '普通',
      caption: '弓弩 · 800人 · 精锐度 普通',
    });

    expect(visual.assetKey).toBe('troop_force_archer_medium_standard_v01.png');
    expect(visual.label).toBe('弓弩 · 中队 · 精锐度 中');
  });

  it('keeps mixed cavalry-infantry units on mixed visuals', () => {
    const visual = resolveTroopVisualAsset({
      troopTypeText: '骑步混编',
      sizeText: '三千人',
      qualityText: '上',
      caption: '骑步混编 · 三千人 · 精锐度 上',
    });

    expect(visual.assetKey).toBe('troop_force_mixed_large_elite_v01.png');
    expect(visual.label).toBe('混编 · 大队 · 精锐度 高');
  });
});
