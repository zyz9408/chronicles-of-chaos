import { describe, expect, it } from 'vitest';
import type { RuntimeState, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { composePrompt } from './PromptComposer';

const worldBook: WorldBook = {
  manifest: {
    id: 'test-world', name: 'Test World', version: '0.1.0', author: 'test', language: 'zh-CN',
    genre: 'historical-chaos', source: 'official', compatibleEngineVersion: '0.1.0',
  },
  ontology: {
    regionLevels: [], factionTypes: [], actorRoleTypes: [], socialClasses: [], resourceTypes: [],
    conflictTypes: [], actionTypes: [], relationshipTypes: [],
  },
  lore: '', mapSeed: [], factionsSeed: [], timelineAnchors: [], startBookmarks: [], openingCrisisTemplates: [],
  characterOptions: { birthOrigins: [], identities: [], abilityPresets: [], hiddenAbilityKeys: [] },
  prompts: { narrativeBaseline: 'Keep continuity.', forbiddenTopics: [], outputFormat: 'JSON.', toneGuide: 'Calm.' },
  validationRules: [],
};

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0', worldBookId: 'test-world', worldBookVersion: '0.1.0', worldBookSource: 'official',
    startDate: '0189-09-01 08:00', currentDate: '0189-09-10 12:00',
    currentTime: { year: 189, month: 9, day: 10, hour: 12, minute: 0 },
    player: { id: 'player', name: 'Player', roleType: 'traveler', summary: 'Test.' },
    currentLocationId: 'place_gate', knownActors: [], knownFactions: [], relationships: [], knownRumors: [],
    activeQuests: [], playerResources: {}, worldStateDelta: {}, turnLog: [], localSituationNotes: [],
    npcs: [{
      npcId: 'npc_scout', name: '斥候', sex: '男', age: 26, role: '斥候', locationId: 'place_river',
      isPresent: false, isFocused: true, summary: '侦察渡口。', appearance: '短褐。', personality: '谨慎。',
      motivation: '查清敌情。', relationToPlayer: '受命。', contactLevel: 30, recentAttitude: '专注', memories: [],
      backgroundActivity: {
        activityId: 'activity_scout_river', summary: '沿河侦察渡口。', status: 'active',
        locationId: 'place_river', dueAt: '0189-09-10 11:00', visibility: 'playerKnown',
      },
    }] as any,
    worldTrends: [{
      trendId: 'trend_border_pressure', title: 'Border pressure', severity: '高',
      summary: 'Enemy scouts remain active.', progressSummary: 'Scouts reached the river.',
      nextCheckAt: '0189-09-10 11:00', lastAdvancedAt: '0189-09-10 09:00',
      knownToPlayer: true, status: 'active', scope: 'regional', sourceConflictIds: ['conflict_border'],
      updatedAt: '0189-09-10 09:00',
    }],
  });
}

describe('world evolution prompt projection', () => {
  it('projects the relevant activity and documents bounded structured writeback', () => {
    const prompt = composePrompt(worldBook, undefined, [], undefined, makeState(), '我等待斥候回报');

    expect(prompt.narrativeContext).toContain('activity_scout_river');
    expect(prompt.narrativeContext).toContain('review due');
    expect(prompt.narrativeContext).toContain('trend_border_pressure');
    expect(prompt.narrativeContext).toContain('world event review due');
    expect(prompt.stateWriterContext).toContain('payload.command.action=updateNpcBackgroundActivity');
    expect(prompt.stateWriterContext).toContain('dueAt 只是下一复核时间');
    expect(prompt.userPrompt).toContain('progressSummary');
    expect(prompt.userPrompt).toContain('nextCheckAt');
    expect(prompt.userPrompt).toContain('lastAdvancedAt');
  });
});
