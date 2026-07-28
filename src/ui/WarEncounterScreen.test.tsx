import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { stageWarEncounter } from '../engine/encounterV2/WarRuntimeIntegration';
import { makeTroopProfile, makeWarIntent, makeWarTroop } from '../engine/encounterV2/WarTestFixtures';
import { WarEncounterScreen } from './WarEncounterScreen';

function makeState(): RuntimeState {
  const base: RuntimeState = {
    engineVersion: '0.1.0',
    worldBookId: 'sanguo',
    worldBookVersion: '1',
    worldBookSource: 'official',
    startDate: '公元194年05月03日 02:00',
    currentDate: '公元194年05月03日 02:00',
    player: {
      id: 'player_liuping',
      name: '刘平',
      roleType: '将领',
      abilityScores: { 统率: 90, 智力: 80, 武力: 85 },
      traits: [],
      uniqueArts: [],
      summary: '测试主角',
    },
    currentLocationId: 'location_xinye_field',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [{
      turnNumber: 1,
      date: '公元194年05月03日 02:00',
      playerInput: '迎战',
      narrativeText: '两军列阵。',
      statePatchSummary: '战争触发',
      timestamp: '2026-07-20T00:00:00.000Z',
    }],
    localSituationNotes: [],
    npcs: [{
      npcId: 'npc_enemy_commander',
      name: '敌军主将',
      sex: '男',
      age: 35,
      role: '敌将',
      isPresent: false,
      isFocused: true,
      summary: '敌军主将',
      appearance: '披甲',
      personality: '谨慎',
      motivation: '守城',
      relationToPlayer: '敌对',
      contactLevel: 1,
      recentAttitude: '严阵以待',
      abilityScores: { 统率: 60, 智力: 55, 武力: 50 },
      traits: [],
      uniqueArts: [],
      memories: [],
    }],
    troops: [
      makeWarTroop('troop_player_infantry', { name: '主力步兵营', factionId: 'faction_player' }),
      makeWarTroop('troop_enemy_cavalry', { name: '西凉骑兵', factionId: 'faction_enemy' }),
    ],
  };
  const intent = { ...makeWarIntent(), sourceTurnNumber: 1, reason: '枯林坡大战' };
  return stageWarEncounter(base, {
    saveId: 'save_batch4',
    intent,
    projections: [
      makeTroopProfile('troop_player_infantry', 'infantry', ['heavy']),
      makeTroopProfile('troop_enemy_cavalry', 'cavalry', ['mobile']),
    ],
    createdAt: '2026-07-20T04:00:00.000Z',
  });
}

describe('WarEncounterScreen', () => {
  it('keeps the enemy left and player right with fixed force lists, speed and auto controls', () => {
    const markup = renderToStaticMarkup(
      <WarEncounterScreen
        runtimeState={makeState()}
        locationLabel="荆州 - 南阳郡 - 枯林坡"
        onResolved={async () => undefined}
        onRequestNarrative={async () => undefined}
      />,
    );

    expect(markup).toContain('data-testid="war-v2-screen"');
    expect(markup).toContain('data-testid="war-side-enemy"');
    expect(markup).toContain('data-testid="war-side-player"');
    expect(markup.indexOf('data-testid="war-side-enemy"')).toBeLessThan(markup.indexOf('data-testid="war-side-player"'));
    expect(markup).toContain('war-v2-force-list');
    expect(markup).toContain('敌军');
    expect(markup).toContain('我军');
    expect(markup).toContain('1×');
    expect(markup).toContain('2×');
    expect(markup).toContain('4×');
    expect(markup).toContain('自动指挥');
    expect(markup).toContain('荆州 - 南阳郡 - 枯林坡');
    expect(markup).toContain('war-v2-force-facts');
    expect(markup).not.toContain('war-v2-force-meter');
  });
});
