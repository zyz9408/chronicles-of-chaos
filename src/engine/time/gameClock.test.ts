import { describe, expect, it } from 'vitest';
import {
  advanceGameClock,
  createGameClockFromDateLabel,
  formatGameClock,
  formatGameDateLabelForNarrative,
  formatGameDateLabelForStatusBar,
  getAncientTimeName,
} from './gameClock';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';

describe('gameClock', () => {
  it('normalizes a month-only Han era date to an exact starting time', () => {
    const clock = createGameClockFromDateLabel('189年9月');

    expect(clock).toMatchObject({
      year: 189,
      month: 9,
      day: 1,
      hour: 8,
      minute: 0,
    });
    expect(clock).not.toHaveProperty('ancientTimeName');
    expect(clock).not.toHaveProperty('label');
    expect(formatGameClock(clock)).toBe('公元189年09月01日 08:00（辰时）');
  });

  it('advances by ancient time blocks and updates day/month rollover', () => {
    const clock = createGameClockFromDateLabel('公元189年09月30日 22:00（亥时）');
    const next = advanceGameClock(clock, { timeBlocksAdvanced: 2 });

    expect(formatGameClock(next)).toBe('公元189年10月01日 02:00（丑时）');
  });

  it('maps modern hours to ancient time names', () => {
    expect(getAncientTimeName(0)).toBe('子时');
    expect(getAncientTimeName(8)).toBe('辰时');
    expect(getAncientTimeName(12)).toBe('午时');
    expect(getAncientTimeName(22)).toBe('亥时');
  });

  it('formats top bar and narrative anchors with the active era and exact clock time', () => {
    const label = '公元189年09月01日 08:00（辰时）';
    const eras = [{ eraId: 'han_zhongping', eraName: '中平', startYear: 184 }];

    expect(formatGameDateLabelForStatusBar(label, undefined, eras)).toBe('中平六年（189年）09月01日 08:00（辰时）');
    expect(formatGameDateLabelForNarrative(label, undefined, eras)).toBe('中平六年（189年）09月01日 08:00（辰时）');
  });

  it('switches to a later written era when the current date reaches it', () => {
    const eras = [
      { eraId: 'han_zhongping', eraName: '中平', startYear: 184 },
      { eraId: 'yuanfeng', eraName: '元丰', startYear: 196, startMonth: 1, startDay: 1 },
    ];

    expect(formatGameDateLabelForStatusBar('公元196年01月01日 08:00（辰时）', undefined, eras)).toBe(
      '元丰元年（196年）01月01日 08:00（辰时）',
    );
    expect(formatGameDateLabelForStatusBar('公元197年01月01日 08:00（辰时）', undefined, eras)).toBe(
      '元丰二年（197年）01月01日 08:00（辰时）',
    );
  });

  it('keeps a story-established era active across later historical fallback eras', () => {
    const state = ensureLuanShiState({
      engineVersion: '0.1.0',
      worldBookId: 'threeKingdoms',
      worldBookVersion: '0.1.0',
      worldBookSource: 'official',
      startDate: '公元194年04月01日 08:30（辰时）',
      currentDate: '公元196年01月01日 08:30（辰时）',
      player: { id: 'player', name: '主角' },
      currentLocationId: 'place_xiangyang',
      knownActors: [],
      knownFactions: [],
      relationships: [],
      knownRumors: [],
      activeQuests: [],
      playerResources: {},
      worldStateDelta: {},
      turnLog: [],
      localSituationNotes: [],
      calendarEras: [{
        eraId: 'alt_jianwu',
        eraName: '建武',
        startYear: 194,
        startMonth: 4,
        startDay: 1,
        source: 'runtime.story',
      }],
    } as any);

    expect(formatGameDateLabelForStatusBar(
      '公元196年01月01日 08:30（辰时）',
      state.currentTime,
      state.calendarEras,
    )).toBe('建武三年（196年）01月01日 08:30（辰时）');
  });

  it('lets a later story-established era supersede the previous story era', () => {
    const eras = [
      { eraId: 'alt_jianwu', eraName: '建武', startYear: 194, source: 'runtime.story' },
      { eraId: 'alt_yongping', eraName: '永平', startYear: 197, source: 'runtime.story' },
    ];

    expect(formatGameDateLabelForStatusBar('公元197年01月01日 08:30（辰时）', undefined, eras)).toBe(
      '永平元年（197年）01月01日 08:30（辰时）',
    );
  });

  it.each([
    ['公元184年01月01日 08:00（辰时）', '中平元年（184年）01月01日 08:00（辰时）'],
    ['公元189年01月01日 08:00（辰时）', '中平六年（189年）01月01日 08:00（辰时）'],
    ['公元194年01月01日 08:00（辰时）', '兴平元年（194年）01月01日 08:00（辰时）'],
    ['公元196年01月01日 08:00（辰时）', '建安元年（196年）01月01日 08:00（辰时）'],
    ['公元220年12月01日 08:00（辰时）', '黄初元年（220年）12月01日 08:00（辰时）'],
  ])('uses the centralized Three Kingdoms era seed for %s', (label, expected) => {
    const state = ensureLuanShiState({
      engineVersion: '0.1.0',
      worldBookId: 'threeKingdoms',
      worldBookVersion: '0.1.0',
      worldBookSource: 'official',
      startDate: label,
      currentDate: label,
      player: { id: 'player', name: '主角' },
      currentLocationId: 'place_luoyang',
      knownActors: [],
      knownFactions: [],
      relationships: [],
      knownRumors: [],
      activeQuests: [],
      playerResources: {},
      worldStateDelta: {},
      turnLog: [],
      localSituationNotes: [],
    } as any);

    expect(formatGameDateLabelForStatusBar(label, state.currentTime, state.calendarEras)).toBe(expected);
    expect(formatGameDateLabelForNarrative(label, state.currentTime, state.calendarEras)).toBe(expected);
  });

  it('upgrades a legacy Three Kingdoms save that persisted only the old Zhongping seed', () => {
    const label = '公元194年04月01日 12:30（午时）';
    const state = ensureLuanShiState({
      engineVersion: '0.1.0',
      worldBookId: 'threeKingdoms',
      worldBookVersion: '0.1.0',
      worldBookSource: 'official',
      startDate: label,
      currentDate: label,
      player: { id: 'player', name: '主角' },
      currentLocationId: 'place_xiangyang',
      knownActors: [],
      knownFactions: [],
      relationships: [],
      knownRumors: [],
      activeQuests: [],
      playerResources: {},
      worldStateDelta: {},
      turnLog: [],
      localSituationNotes: [],
      calendarEras: [{
        eraId: 'han_zhongping',
        eraName: '中平',
        startYear: 184,
        startMonth: 1,
        startDay: 1,
      }],
    } as any);

    expect(formatGameDateLabelForStatusBar(label, state.currentTime, state.calendarEras)).toBe(
      '兴平元年（194年）04月01日 12:30（午时）',
    );
    expect(state.calendarEras.find((era) => era.eraId === 'han_zhongping')?.source).toBe(
      'threeKingdoms.defaultEra',
    );
  });

  it('falls back to a plain year anchor when no era is known', () => {
    expect(formatGameDateLabelForNarrative('公元189年秋，洛阳风声渐紧。')).toBe('189年秋，洛阳风声渐紧。');
  });
});
