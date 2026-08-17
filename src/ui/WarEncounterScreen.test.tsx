import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import {
  commitWarResultToRuntime,
  prepareWarEncounterForPlay,
  stageWarEncounter,
} from '../engine/encounterV2/WarRuntimeIntegration';
import {
  createSealedWarResult,
  executeWarRound,
  resolveWarDecision,
  resumeWarAfterAutoPause,
} from '../engine/encounterV2/WarEngine';
import { makeTroopProfile, makeWarIntent, makeWarTroop } from '../engine/encounterV2/WarTestFixtures';
import type { WarEngineState } from '../engine/encounterV2/WarTypes';
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
      makeWarTroop('troop_enemy_cavalry', { name: '西凉骑兵', factionId: 'faction_enemy', troopType: '轻骑兵' }),
      makeWarTroop('troop_imperial_main', {
        name: '皇甫嵩所部主力',
        detailLevel: 'intelligence',
        size: 0,
        lifecycleStatus: 'unknown',
        strengthEstimate: { min: 20_000, max: 30_000 },
      }),
      makeWarTroop('troop_enemy_main', {
        name: '黄巾主力',
        detailLevel: 'intelligence',
        size: 0,
        lifecycleStatus: 'unknown',
        strengthEstimate: { min: 60_000, max: 80_000 },
      }),
    ],
  };
  const baseIntent = makeWarIntent(
    ['troop_player_infantry'],
    ['troop_enemy_cavalry'],
    { commandScope: 'subordinate_sector', enemy: [600] },
  );
  const intent = {
    ...baseIntent,
    sourceTurnNumber: 1,
    reason: '枯林坡大战',
    participation: {
      ...baseIntent.participation!,
      alliedMainForceIds: ['troop_imperial_main'],
      enemyMainForceIds: ['troop_enemy_main'],
    },
  };
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

function finishWar(input: WarEngineState): WarEngineState {
  let state = input;
  for (let guard = 0; guard < 80 && state.phase !== 'resolved'; guard += 1) {
    if (state.phase === 'awaiting_round') {
      state = executeWarRound(state, {
        player: { type: 'tactic', tactic: 'all_out_assault' },
        enemy: { type: 'tactic', tactic: 'steady_advance' },
      });
    } else if (state.phase === 'awaiting_decision' && state.pendingDecision) {
      state = resolveWarDecision(state, {
        choice: state.pendingDecision.kind === 'pursuit' ? 'pursue' : 'accept_surrender',
      });
    } else if (state.phase === 'auto_paused') {
      state = resumeWarAfterAutoPause(state);
    }
  }
  if (state.phase !== 'resolved') throw new Error('war fixture did not resolve');
  return state;
}

function makeNarrativePendingState(): RuntimeState {
  const staged = makeState();
  const prepared = prepareWarEncounterForPlay(staged, { startedAt: '2026-07-20T04:01:00.000Z' });
  const result = createSealedWarResult(finishWar(prepared.engineState), '2026-07-20T04:10:00.000Z');
  return commitWarResultToRuntime(staged, {
    saveId: 'save_batch4',
    session: prepared.session,
    result,
    committedAt: '2026-07-20T04:10:00.000Z',
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
    expect(markup).toContain('我方直接参战');
    expect(markup).toContain('1×');
    expect(markup).toContain('2×');
    expect(markup).toContain('4×');
    expect(markup).toContain('自动指挥');
    expect(markup).toContain('荆州 - 南阳郡 - 枯林坡');
    expect(markup).toContain('war-v2-force-facts');
    expect(markup).toContain('兵种 轻骑兵');
    expect(markup).not.toContain('war-v2-force-meter');
    expect(markup).toContain('class="war-v2-screen is-prestart"');
    expect(markup).toContain('data-testid="war-v2-stage-start"');
    expect(markup).toContain('>进入战争</button>');
    expect(markup).toContain('战区背景：友军约 25000 人 · 敌军主力约 70000 人');
    expect(markup).toContain('不归你直接调遣，也不作为本场伤亡结算对象');
    expect(markup).toContain('本场投入 600 / 建制 1000');
    expect(markup).not.toContain('class="war-v2-lower"');
  });

  it('shows active post-war narrative generation in the battlefield center', () => {
    const markup = renderToStaticMarkup(
      <WarEncounterScreen
        runtimeState={makeNarrativePendingState()}
        locationLabel="荆州 - 南阳郡 - 枯林坡"
        onResolved={async () => undefined}
        onRequestNarrative={async () => undefined}
        narrativeBusy
        onCancelNarrative={() => undefined}
      />,
    );

    expect(markup).toContain('data-testid="war-v2-stage-narrative"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('战争已经结算');
    expect(markup).toContain('正在生成战后正文');
    expect(markup).toContain('>中止生成</button>');
    expect(markup).not.toContain('class="war-v2-center-seal"');
  });
});
