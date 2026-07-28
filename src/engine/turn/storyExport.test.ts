import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { createStoryExport } from './storyExport';

function createState(): RuntimeState {
  return {
    engineVersion: '0.1.0',
    worldBookId: 'three-kingdoms',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '公元194年05月01日 08:00',
    currentDate: '公元194年05月01日 09:00',
    currentTime: { year: 194, month: 5, day: 1, hour: 9, minute: 0 },
    player: { id: 'player', name: '刘平', roleType: 'player', summary: '主角。' },
    currentLocationId: 'location_test',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    localSituationNotes: [],
    turnLog: [
      {
        turnNumber: 1,
        date: '公元194年05月01日 08:30',
        playerInput: '[true opening generation]',
        narrativeText: '开场摘要。',
        fullNarrativeText: '完整开场正文。',
        statePatchSummary: '',
        timestamp: '2026-07-25T00:00:00.000Z',
      },
      {
        turnNumber: 2,
        date: '公元194年05月01日 09:00',
        playerInput: '巡视营寨',
        narrativeText: '巡视摘要。',
        fullNarrativeText: '完整巡视正文。',
        statePatchSummary: '',
        timestamp: '2026-07-25T00:01:00.000Z',
      },
    ],
  };
}

describe('createStoryExport', () => {
  it('exports the latest full narrative without internal opening input', () => {
    const artifact = createStoryExport(createState(), {
      range: 'latestTurn',
      format: 'markdown',
      includeDates: true,
      includePlayerActions: true,
    });

    expect(artifact.turnCount).toBe(1);
    expect(artifact.fileName).toBe('刘平-乱世风云录-第2回合.md');
    expect(artifact.content).toContain('完整巡视正文');
    expect(artifact.content).toContain('玩家行动：巡视营寨');
    expect(artifact.content).not.toContain('完整开场正文');
  });

  it('exports all turns as a standalone html file', () => {
    const artifact = createStoryExport(createState(), {
      range: 'all',
      format: 'html',
      includeDates: false,
      includePlayerActions: true,
    });

    expect(artifact.turnCount).toBe(2);
    expect(artifact.fileName).toBe('刘平-乱世风云录-全2回合.html');
    expect(artifact.content).toContain('<!doctype html>');
    expect(artifact.content).toContain('完整开场正文');
    expect(artifact.content).not.toContain('[true opening generation]');
  });
});
