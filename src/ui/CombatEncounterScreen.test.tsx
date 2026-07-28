import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { stageCombatEncounter } from '../engine/encounterV2/EncounterRuntimeIntegration';
import { makeCombatIntent } from '../engine/encounterV2/CombatTestFixtures';
import { CombatEncounterScreen } from './CombatEncounterScreen';

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
      abilityScores: { 武力: 80, 机运: 50 },
      summary: '测试主角',
    },
    currentLocationId: 'location_hanshui_camp',
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
      playerInput: '迎击',
      narrativeText: '遭遇敌军。',
      statePatchSummary: '战斗触发',
      timestamp: '2026-07-20T00:00:00.000Z',
    }],
    localSituationNotes: [],
    npcs: [{
      npcId: 'npc_enemy_guard',
      name: '西凉悍卒',
      sex: '男',
      age: 30,
      role: '敌军',
      isPresent: true,
      isFocused: true,
      summary: '拦路敌兵',
      appearance: '披甲',
      personality: '凶悍',
      motivation: '截杀',
      relationToPlayer: '敌对',
      contactLevel: 1,
      recentAttitude: '杀意明显',
      memories: [],
    }],
  };
  const intent = { ...makeCombatIntent(), sourceTurnNumber: 1, reason: '汉水大营遭遇战' };
  return stageCombatEncounter(base, {
    saveId: 'save_batch2',
    intent,
    projections: [],
    createdAt: '2026-07-20T01:00:00.000Z',
  });
}

describe('CombatEncounterScreen', () => {
  it('keeps enemies left, player party right, and exposes speed/auto controls without layout-dependent content', () => {
    const markup = renderToStaticMarkup(
      <CombatEncounterScreen
        runtimeState={makeState()}
        locationLabel="荆州 - 南阳郡 - 新野县城"
        onResolved={async () => undefined}
        onRequestNarrative={async () => undefined}
      />,
    );

    expect(markup).toContain('data-testid="combat-v2-screen"');
    expect(markup).toContain('data-testid="combat-side-enemy"');
    expect(markup).toContain('data-testid="combat-side-player"');
    expect(markup.indexOf('data-testid="combat-side-enemy"')).toBeLessThan(markup.indexOf('data-testid="combat-side-player"'));
    expect(markup).toContain('敌方');
    expect(markup).toContain('我方');
    expect(markup).toContain('1×');
    expect(markup).toContain('2×');
    expect(markup).toContain('4×');
    expect(markup).toContain('自动战斗');
    expect(markup).toContain('荆州 - 南阳郡 - 新野县城');
    expect(markup).toContain('combat-v2-slot-heading');
    expect(markup).toContain('combat-v2-slot-resource');
    expect(markup).toContain('combat-v2-slot-gauge');
  });
});
