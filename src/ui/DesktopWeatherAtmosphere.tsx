import type { CSSProperties } from 'react';

export type DesktopWeatherCondition = 'sunny' | 'cloudy' | 'rain' | 'snow' | 'fog' | 'haze';
export type DesktopWeatherPeriod = 'day' | 'night';

export interface DesktopWeatherVisual {
  condition: DesktopWeatherCondition;
  period: DesktopWeatherPeriod;
}

interface DesktopWeatherAtmosphereProps {
  label: string;
  tags?: string[];
  hour: number;
}

type WeatherParticleKind = 'rain' | 'snow' | 'cloud' | 'fog' | 'haze';

type WeatherParticleStyle = CSSProperties & {
  '--weather-x': string;
  '--weather-y': string;
  '--weather-delay': string;
  '--weather-duration': string;
  '--weather-size': string;
};

export function deriveDesktopWeatherVisual(
  label: string,
  tags: string[] = [],
  hour: number,
): DesktopWeatherVisual {
  const clue = `${label} ${tags.join(' ')}`;
  const period: DesktopWeatherPeriod =
    hour < 5 || hour >= 19 || /夜色|深夜|夜间|月色/.test(clue) ? 'night' : 'day';

  let condition: DesktopWeatherCondition = 'sunny';
  if (/雪|霜|冰封|严寒/.test(clue)) condition = 'snow';
  else if (/雨|骤雨|积水|泥泞|湿冷/.test(clue)) condition = 'rain';
  else if (/雾霾|烟霾|霾|烟尘|浓烟|风沙|沙尘|扬尘|呛鼻/.test(clue)) condition = 'haze';
  else if (/雾|烟岚|低能见度/.test(clue)) condition = 'fog';
  else if (/多云|阴云|乌云|阴天|云层|天色阴沉/.test(clue)) condition = 'cloudy';

  return { condition, period };
}

function particleStyle(index: number, kind: WeatherParticleKind): WeatherParticleStyle {
  const baseDuration = {
    rain: 0.86,
    snow: 5.8,
    cloud: 15,
    fog: 10.5,
    haze: 7.2,
  }[kind];
  const stepDuration = {
    rain: 0.08,
    snow: 0.55,
    cloud: 2.1,
    fog: 1.7,
    haze: 0.65,
  }[kind];
  const baseSize = {
    rain: 12,
    snow: 3,
    cloud: 100,
    fog: 230,
    haze: 2,
  }[kind];

  return {
    '--weather-x': `${(index * 37 + 11) % 101}%`,
    '--weather-y': `${(index * 23 + 7) % 83}%`,
    '--weather-delay': `${-((index * 17 + 5) % 47) / 10}s`,
    '--weather-duration': `${baseDuration + (index % 5) * stepDuration}s`,
    '--weather-size': `${baseSize + (index % 4) * (kind === 'cloud' ? 24 : kind === 'fog' ? 42 : 1)}px`,
  };
}

function renderParticles(kind: WeatherParticleKind, count: number) {
  return Array.from({ length: count }, (_, index) => (
    <span
      key={`${kind}-${index}`}
      className={`desktop-weather-particle desktop-weather-particle--${kind}`}
      style={particleStyle(index, kind)}
    />
  ));
}

export function DesktopWeatherAtmosphere({
  label,
  tags = [],
  hour,
}: DesktopWeatherAtmosphereProps): React.ReactElement {
  const visual = deriveDesktopWeatherVisual(label, tags, hour);
  const cloudCount = visual.condition === 'cloudy' ? 4 : ['rain', 'snow'].includes(visual.condition) ? 2 : 0;

  return (
    <div
      className={`desktop-weather-atmosphere desktop-weather-atmosphere--${visual.condition} desktop-weather-atmosphere--${visual.period}`}
      data-testid="desktop-weather-atmosphere"
      data-weather-condition={visual.condition}
      data-weather-period={visual.period}
      aria-hidden="true"
    >
      <span className="desktop-weather-tone" />
      {visual.condition === 'sunny' ? <span className="desktop-weather-celestial" /> : null}
      {cloudCount > 0 ? (
        <span className="desktop-weather-field desktop-weather-field--cloud">
          {renderParticles('cloud', cloudCount)}
        </span>
      ) : null}
      {visual.condition === 'rain' ? (
        <span className="desktop-weather-field desktop-weather-field--rain">
          {renderParticles('rain', 24)}
        </span>
      ) : null}
      {visual.condition === 'snow' ? (
        <span className="desktop-weather-field desktop-weather-field--snow">
          {renderParticles('snow', 18)}
        </span>
      ) : null}
      {visual.condition === 'fog' ? (
        <span className="desktop-weather-field desktop-weather-field--fog">
          {renderParticles('fog', 3)}
        </span>
      ) : null}
      {visual.condition === 'haze' ? (
        <span className="desktop-weather-field desktop-weather-field--haze">
          {renderParticles('haze', 16)}
        </span>
      ) : null}
    </div>
  );
}
