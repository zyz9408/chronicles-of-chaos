import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { deriveCurrentWeather } from './weather';

function makeWeatherState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    engineVersion: '0.1.0',
    worldBookId: 'test-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '公元189年03月05日 18:00',
    currentDate: '公元189年03月05日 18:00',
    currentTime: { year: 189, month: 3, day: 5, hour: 18, minute: 0 },
    player: { id: 'player', name: '刘备', roleType: 'player', summary: '主角。' },
    currentLocationId: 'loc_bridge',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {
      openingLocationPath: '司隶 / 洛水断桥',
      openingSceneSummary: '断桥边挤满难民，河风带着潮气。',
    },
    turnLog: [],
    localSituationNotes: ['断桥边的难民缩在车架旁，河风吹得火把一明一暗。'],
    locations: [
      {
        locationId: 'loc_bridge',
        name: '洛水断桥',
        type: '渡口',
        summary: '洛水边的断桥，河面潮冷，车马难行。',
        knownLevel: '亲历',
        recentEvents: [],
      },
    ],
    ...overrides,
  };
}

describe('deriveCurrentWeather', () => {
  it('derives a spring dusk river weather snapshot from date, region and current scene', () => {
    const weather = deriveCurrentWeather(makeWeatherState());

    expect(weather.label).toBe('暮色四合，初春河风微凉');
    expect(weather.tags).toEqual(expect.arrayContaining(['初春', '暮色', '河风', '微凉']));
    expect(weather.impactSummary).toContain('渡河、守桥、夜行和火把视野');
    expect(weather.sourceSummary).toContain('日期/季节');
    expect(weather.sourceSummary).toContain('地区/地点');
    expect(weather.sourceSummary).toContain('当前剧情');
  });

  it('lets current plot weather override the seasonal baseline', () => {
    const weather = deriveCurrentWeather(makeWeatherState({
      currentDate: '公元189年06月12日 14:00',
      currentTime: { year: 189, month: 6, day: 12, hour: 14, minute: 0 },
      localSituationNotes: ['暴雨压低天色，土路泥泞，军士踩得满靴黄泥。'],
      worldStateDelta: {
        openingLocationPath: '豫州 / 官道',
        openingSceneSummary: '暴雨与泥泞让车队难行。',
      },
    }));

    expect(weather.label).toBe('雨势未歇，暑气被泥水压住');
    expect(weather.tags).toEqual(expect.arrayContaining(['夏季', '雨势', '泥泞']));
    expect(weather.impactSummary).toContain('行军、追踪、赶路和弓弦火种');
  });

  it('does not let a completed matter keep overriding current weather', () => {
    const weather = deriveCurrentWeather(makeWeatherState({
      currentLocationId: 'loc_market',
      worldStateDelta: {},
      localSituationNotes: [],
      locations: [{
        locationId: 'loc_market',
        name: '市集',
        type: '市集',
        summary: '街巷安静，商贩正在收摊。',
        knownLevel: '亲历',
        recentEvents: [],
      }],
      activeQuests: [{
        id: 'quest_old_storm',
        title: '穿过暴雨',
        description: '泥泞与积水曾经阻断道路。',
        status: 'completed',
        createdAt: '公元189年03月01日 12:00',
        updatedAt: '公元189年03月02日 12:00',
      }],
    }));

    expect(weather.label).toBe('暮色四合，初春风冷未退');
    expect(weather.tags).not.toContain('雨势');
  });

  it('derives distinct cloudy and haze snapshots for desktop ambience projection', () => {
    const cloudy = deriveCurrentWeather(makeWeatherState({
      currentLocationId: 'loc_market',
      worldStateDelta: {},
      localSituationNotes: ['阴云低垂，云层压住天光，但尚未落雨。'],
      locations: [{
        locationId: 'loc_market',
        name: '市集',
        type: '市集',
        summary: '商贩正在收摊。',
        knownLevel: '亲历',
        recentEvents: [],
      }],
    }));
    const haze = deriveCurrentWeather(makeWeatherState({
      currentLocationId: 'loc_gate',
      worldStateDelta: {},
      localSituationNotes: ['城外沙尘扬起，雾霾遮住远处旗号。'],
      locations: [{
        locationId: 'loc_gate',
        name: '北门',
        type: '城门',
        summary: '城门外视野开阔。',
        knownLevel: '亲历',
        recentEvents: [],
      }],
    }));

    expect(cloudy.tags).toContain('多云');
    expect(cloudy.label).toContain('云层压低天色');
    expect(haze.tags).toEqual(expect.arrayContaining(['雾霾', '低能见度']));
    expect(haze.label).toContain('雾霾');
  });
});
