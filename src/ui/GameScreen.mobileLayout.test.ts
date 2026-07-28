import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  formatMobileTopBarDateLabel,
  getWeatherGlyph,
  MobileRegionSwitcher,
} from './GameScreen';

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
});
