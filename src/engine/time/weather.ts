import type { RuntimeState } from '../types';
import { isOpenCurrentMatter } from '../state/currentMatterLifecycle';
import { ensureGameClock } from './gameClock';

export interface WeatherSnapshot {
  label: string;
  tags: string[];
  impactSummary: string;
  sourceSummary: string;
}

interface SeasonProfile {
  tag: string;
  baseline: string;
  defaultImpact: string;
}

export function deriveCurrentWeather(state: RuntimeState): WeatherSnapshot {
  const clock = ensureGameClock(state);
  const season = getSeasonProfile(clock.month);
  const timePrefix = getTimePrefix(clock.hour);
  const contextText = collectWeatherContextText(state);
  const plotWeather = derivePlotWeather(contextText, season, timePrefix);
  if (plotWeather) return plotWeather;

  const regionalWeather = deriveRegionalWeather(contextText, season, timePrefix);
  if (regionalWeather) return regionalWeather;

  return {
    label: `${timePrefix}，${season.baseline}`,
    tags: compactUnique([season.tag, getTimeTag(clock.hour)]),
    impactSummary: season.defaultImpact,
    sourceSummary: '日期/季节 + 地区/地点 + 当前剧情派生。',
  };
}

export function formatWeatherForPrompt(weather: WeatherSnapshot): string {
  return [
    `当前天候：${weather.label}`,
    `天候影响：${weather.impactSummary}`,
    `天候标签：${weather.tags.join('、')}`,
  ].join('\n');
}

function getSeasonProfile(month: number): SeasonProfile {
  if (month >= 2 && month <= 4) {
    return {
      tag: month <= 3 ? '初春' : '春季',
      baseline: month <= 3 ? '初春风冷未退' : '春风渐暖',
      defaultImpact: '春寒和风向会影响夜行、露宿、火把和人群停留。',
    };
  }
  if (month >= 5 && month <= 7) {
    return {
      tag: '夏季',
      baseline: '夏日热气浮动',
      defaultImpact: '暑气会影响体力、行军速度、甲衣负担和水源需求。',
    };
  }
  if (month >= 8 && month <= 10) {
    return {
      tag: '秋季',
      baseline: '秋风渐紧',
      defaultImpact: '秋风和干燥会影响火势、尘土、粮草转运和夜间寒意。',
    };
  }
  return {
    tag: '冬季',
    baseline: '冬寒压地',
    defaultImpact: '冬寒会影响守夜、伤病、行军、牲口和露宿风险。',
  };
}

function getTimePrefix(hour: number): string {
  if (hour >= 5 && hour < 9) return '晨光微亮';
  if (hour >= 11 && hour < 15) return '日头正盛';
  if (hour >= 17 && hour < 20) return '暮色四合';
  if (hour >= 20 || hour < 5) return '夜色深重';
  return '天光平稳';
}

function getTimeTag(hour: number): string {
  if (hour >= 5 && hour < 9) return '晨光';
  if (hour >= 11 && hour < 15) return '正午';
  if (hour >= 17 && hour < 20) return '暮色';
  if (hour >= 20 || hour < 5) return '夜色';
  return '日间';
}

function derivePlotWeather(contextText: string, season: SeasonProfile, timePrefix: string): WeatherSnapshot | undefined {
  if (/暴雨|大雨|雨势|雨夜|泥泞|积水|骤雨|细雨|雨水/.test(contextText)) {
    return {
      label: season.tag === '夏季'
        ? '雨势未歇，暑气被泥水压住'
        : `${timePrefix}，雨意压低天色`,
      tags: compactUnique([season.tag, '雨势', /泥泞|黄泥|烂泥/.test(contextText) ? '泥泞' : '湿冷']),
      impactSummary: '雨势会影响行军、追踪、赶路和弓弦火种；泥泞拖慢车马，也会掩盖或冲散痕迹。',
      sourceSummary: '日期/季节 + 地区/地点 + 当前剧情派生。',
    };
  }

  if (/大雪|落雪|积雪|风雪|雪夜|霜冻|冰封/.test(contextText)) {
    return {
      label: `${timePrefix}，寒雪压住道路`,
      tags: compactUnique([season.tag, '风雪', '严寒']),
      impactSummary: '风雪会影响视野、足迹、行军、守夜和伤病恢复，牲口与火源也更关键。',
      sourceSummary: '日期/季节 + 地区/地点 + 当前剧情派生。',
    };
  }

  if (/雾霾|烟霾|霾天|沙尘|扬尘/.test(contextText)) {
    return {
      label: `${timePrefix}，雾霾压低远处轮廓`,
      tags: compactUnique([season.tag, getTimeTagFromPrefix(timePrefix), '雾霾', '低能见度']),
      impactSummary: '雾霾和浮尘会影响远望、呼吸、追踪和军队辨识，长途行军也更易疲惫。',
      sourceSummary: '日期/季节 + 地区/地点 + 当前剧情派生。',
    };
  }

  if (/大雾|浓雾|雾气|迷雾|烟岚/.test(contextText)) {
    return {
      label: `${timePrefix}，雾气贴地不散`,
      tags: compactUnique([season.tag, '雾气', '低能见度']),
      impactSummary: '雾气会影响视野、追踪、伏击、城门盘查和远处声响判断。',
      sourceSummary: '日期/季节 + 地区/地点 + 当前剧情派生。',
    };
  }

  if (/多云|阴云|乌云|阴天|云层低垂|天色阴沉/.test(contextText)) {
    return {
      label: `${timePrefix}，云层压低天色`,
      tags: compactUnique([season.tag, getTimeTagFromPrefix(timePrefix), '多云']),
      impactSummary: '云层会削弱远望与日照，暮夜来得更快，但不直接造成雨雪或道路阻断。',
      sourceSummary: '日期/季节 + 地区/地点 + 当前剧情派生。',
    };
  }

  if (/火场|火势|焚|烧|浓烟|烟尘/.test(contextText)) {
    return {
      label: `${timePrefix}，烟火气压在人群上`,
      tags: compactUnique([season.tag, '烟火', '呛鼻']),
      impactSummary: '烟火会影响视野、呼吸、混乱程度和人群逃散，也会暴露位置。',
      sourceSummary: '日期/季节 + 地区/地点 + 当前剧情派生。',
    };
  }

  return undefined;
}

function deriveRegionalWeather(contextText: string, season: SeasonProfile, timePrefix: string): WeatherSnapshot | undefined {
  if (/河|江|湖|水|渡|桥|港|泽|溪|岸/.test(contextText)) {
    const coolTag = season.tag === '夏季' ? '潮热' : '微凉';
    return {
      label: `${timePrefix}，${season.tag}河风${coolTag}`,
      tags: compactUnique([season.tag, getTimeTagFromPrefix(timePrefix), '河风', coolTag]),
      impactSummary: '渡河、守桥、夜行和火把视野都会受河风与水汽影响，衣物、脚步和车马声更容易暴露。',
      sourceSummary: '日期/季节 + 地区/地点 + 当前剧情派生。',
    };
  }

  if (/山|岭|关|谷|坡|峪|寨/.test(contextText)) {
    return {
      label: `${timePrefix}，${season.tag}山风穿谷`,
      tags: compactUnique([season.tag, getTimeTagFromPrefix(timePrefix), '山风']),
      impactSummary: '山风会影响喊声、火把、伏击视野和狭路行军，坡道也会放大体力消耗。',
      sourceSummary: '日期/季节 + 地区/地点 + 当前剧情派生。',
    };
  }

  if (/塞|边|漠|沙|凉州|朔|草原|胡地/.test(contextText)) {
    return {
      label: `${timePrefix}，边地风沙贴着地面走`,
      tags: compactUnique([season.tag, getTimeTagFromPrefix(timePrefix), '风沙']),
      impactSummary: '风沙会影响远望、追踪、弓弩保养、行军方向和营地遮蔽。',
      sourceSummary: '日期/季节 + 地区/地点 + 当前剧情派生。',
    };
  }

  return undefined;
}

function getTimeTagFromPrefix(prefix: string): string {
  if (prefix.includes('暮色')) return '暮色';
  if (prefix.includes('夜色')) return '夜色';
  if (prefix.includes('晨光')) return '晨光';
  if (prefix.includes('日头')) return '正午';
  return '日间';
}

function collectWeatherContextText(state: RuntimeState): string {
  const currentLocation = state.locations?.find((location) => location.locationId === state.currentLocationId);
  const recentEvents = [...(state.turnEvents ?? [])].slice(-3).map((event) => event.summary);
  const questText = state.activeQuests
    .filter(isOpenCurrentMatter)
    .flatMap((quest) => [quest.title, quest.description, quest.currentStep]);
  const rumorText = state.knownRumors.slice(-3).map((rumor) => rumor.content);
  const situationText = [
    state.situationOverview?.summary,
    ...(state.situationOverview?.currentPressure ?? []),
    ...(state.situationOverview?.immediateHooks ?? []),
  ];
  const worldStateText = [
    state.worldStateDelta.openingLocationPath,
    state.worldStateDelta.openingSceneName,
    state.worldStateDelta.openingSceneSummary,
    state.worldStateDelta.openingSituationSummary,
  ];

  return [
    state.currentLocationId,
    currentLocation?.name,
    currentLocation?.type,
    currentLocation?.summary,
    ...worldStateText,
    ...state.localSituationNotes,
    ...recentEvents,
    ...questText,
    ...rumorText,
    ...situationText,
  ].filter(hasText).join(' ');
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function compactUnique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
