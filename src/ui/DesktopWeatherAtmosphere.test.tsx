import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesktopWeatherAtmosphere, deriveDesktopWeatherVisual } from './DesktopWeatherAtmosphere';

describe('DesktopWeatherAtmosphere', () => {
  it.each([
    ['日头正盛，春风渐暖', ['春季', '正午'], 12, 'sunny', 'day'],
    ['天光平稳，云层压低天色', ['多云'], 10, 'cloudy', 'day'],
    ['雨势未歇', ['雨势', '泥泞'], 21, 'rain', 'night'],
    ['寒雪压住道路', ['风雪'], 9, 'snow', 'day'],
    ['雾气贴地不散', ['低能见度'], 8, 'fog', 'day'],
    ['雾霾压城', ['烟尘', '呛鼻'], 14, 'haze', 'day'],
    ['夜色深重，冬寒压地', ['夜色'], 22, 'sunny', 'night'],
  ] as const)('projects %s as %s/%s', (label, tags, hour, condition, period) => {
    expect(deriveDesktopWeatherVisual(label, [...tags], hour)).toEqual({ condition, period });
  });

  it('renders bounded rain particles without interactive content', () => {
    const markup = renderToStaticMarkup(
      <DesktopWeatherAtmosphere label="夜雨未歇" tags={['雨势']} hour={22} />,
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('data-weather-condition="rain"');
    expect(markup).toContain('data-weather-period="night"');
    expect(markup.match(/desktop-weather-particle--rain/g)).toHaveLength(24);
  });
});
