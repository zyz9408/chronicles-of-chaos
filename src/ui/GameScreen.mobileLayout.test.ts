import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  derivePlayerSidebarAge,
  formatMobileTopBarDateLabel,
  getWeatherGlyph,
  MobileRegionSwitcher,
  sanitizeAvgPreparingStageText,
} from './GameScreen';
import type { Actor } from '../engine/types';

describe('GameScreen mobile region switcher', () => {
  it('renders explicit profile, narrative, and systems regions with the active region exposed', () => {
    const markup = renderToStaticMarkup(createElement(MobileRegionSwitcher, {
      activeRegion: 'narrative',
      onSelect: vi.fn(),
    }));

    expect(markup).toContain('data-testid="mobile-region-switcher"');
    expect(markup).toContain('data-testid="mobile-region-profile"');
    expect(markup).toContain('data-testid="mobile-region-narrative" aria-pressed="true"');
    expect(markup).toContain('data-testid="mobile-region-systems"');
    expect(markup).toContain('角色');
    expect(markup).toContain('正文');
    expect(markup).toContain('系统');
  });

  it('moves the selected state without changing the region set', () => {
    const markup = renderToStaticMarkup(createElement(MobileRegionSwitcher, {
      activeRegion: 'systems',
      onSelect: vi.fn(),
    }));

    expect(markup).toContain('data-testid="mobile-region-systems" aria-pressed="true"');
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('projects compact weather glyphs for the mobile location row', () => {
    expect(getWeatherGlyph('雨势未歇', ['泥泞'])).toBe('☂');
    expect(getWeatherGlyph('寒雪压住道路', ['严寒'])).toBe('❄');
    expect(getWeatherGlyph('山风穿谷', ['山风'])).toBe('風');
    expect(getWeatherGlyph('天光平稳', ['日间'])).toBe('☀');
  });

  it('keeps the era, date, clock, and traditional hour in a compact mobile label', () => {
    expect(formatMobileTopBarDateLabel('中平元年（184年）03月01日 08:00（辰时）'))
      .toBe('中平元年 · 03/01 08:00 · 辰时');
    expect(formatMobileTopBarDateLabel('公元194年05月03日 17:00（酉时）'))
      .toBe('公元194年 · 05/03 17:00 · 酉时');
  });

  it('derives the sidebar age from the canonical birthday after game time advances', () => {
    const player = {
      id: 'historical_liu_xie',
      name: '刘协',
      roleType: 'player',
      summary: '十岁开局的玩家角色。',
      age: 10,
      birthDate: '公元174年04月02日',
      ageKnownAtDate: '公元184年04月02日 08:00（辰时）',
    } as Actor;

    expect(derivePlayerSidebarAge(player, '公元184年04月02日 08:00（辰时）')).toBe(10);
    expect(derivePlayerSidebarAge(player, '公元186年04月02日 08:00（辰时）')).toBe(12);
    expect(player.age).toBe(10);
  });

  it('redacts credentials from the AVG preparation stage', () => {
    const text = sanitizeAvgPreparingStageText('Authorization: Bearer sk-secret-value apiKey: "tp-hidden"');
    expect(text).not.toContain('sk-secret-value');
    expect(text).not.toContain('tp-hidden');
    expect(text).toContain('已隐藏');
  });
});
