import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { simulateCombatWithLocalAi } from '../engine/encounterV2/CombatAi';
import { finalizeCombatResult } from '../engine/encounterV2/CombatEngine';
import {
  commitCombatResultToRuntime,
  prepareCombatEncounterForPlay,
  stageCombatEncounter,
} from '../engine/encounterV2/EncounterRuntimeIntegration';
import { makeCombatIntent } from '../engine/encounterV2/CombatTestFixtures';
import { CombatEncounterScreen, combatUniqueArtName } from './CombatEncounterScreen';

function makeBaseState(): RuntimeState {
  return {
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
}

function makeState(): RuntimeState {
  const base = makeBaseState();
  const intent = { ...makeCombatIntent(), sourceTurnNumber: 1, reason: '汉水大营遭遇战' };
  return stageCombatEncounter(base, {
    saveId: 'save_batch2',
    intent,
    projections: [],
    createdAt: '2026-07-20T01:00:00.000Z',
  });
}

function makeNarrativePendingState(): RuntimeState {
  const staged = makeState();
  const prepared = prepareCombatEncounterForPlay(staged, {
    selectedPlayerActorIds: ['player_liuping'],
    startedAt: '2026-07-20T01:01:00.000Z',
  });
  const result = finalizeCombatResult(
    simulateCombatWithLocalAi(prepared.engineState, { maxActions: 200 }),
    '2026-07-20T01:02:00.000Z',
    { playerActorId: staged.player.id },
  );
  return commitCombatResultToRuntime(staged, {
    saveId: 'save_batch2',
    session: prepared.session,
    result,
    committedAt: '2026-07-20T01:02:00.000Z',
  });
}

describe('CombatEncounterScreen', () => {
  it('resolves combat art controls to the authored Chinese name instead of exposing an internal id', () => {
    const state = makeBaseState();
    state.player.uniqueArts = [{
      id: 'art_anatomical_strike',
      name: '断脉绝击',
      rarity: 'orange',
      domain: 'personalCombat',
      level: 3,
      description: '洞察筋骨脉络后直击要害。',
      effectSummary: '造成高额伤害。',
      source: 'opening',
    }];

    expect(combatUniqueArtName(state, state.player.id, 'art_anatomical_strike')).toBe('断脉绝击');
    expect(combatUniqueArtName(state, state.player.id, 'art_missing')).toBe('未命名绝艺');
  });

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
    expect(markup).toContain('class="combat-v2-screen is-prestart"');
    expect(markup).toContain('data-testid="combat-v2-stage-start"');
    expect(markup).toContain('>进入战斗</button>');
    expect(markup).not.toContain('class="combat-v2-lower"');
  });

  it('uses encounter-scoped names instead of internal actor ids before combat preparation', () => {
    const encounterId = 'encounter_scoped_display';
    const scopedActorId = `${encounterId}:scoped:routed_soldier_1`;
    const state = stageCombatEncounter(makeBaseState(), {
      saveId: 'save_scoped_display',
      intent: {
        ...makeCombatIntent(['player_liuping'], [scopedActorId]),
        encounterId,
        sourceTurnNumber: 1,
        reason: '溃兵拦路。',
        scopedCombatants: [{
          actorId: scopedActorId,
          name: '持刀溃兵',
          archetype: 'militia',
          weaponClass: 'standard',
          armorClass: 'light',
        }],
      },
      projections: [],
      createdAt: '2026-07-30T05:30:00.000Z',
    });

    const markup = renderToStaticMarkup(
      <CombatEncounterScreen
        runtimeState={state}
        locationLabel="林间驿道"
        onResolved={async () => undefined}
        onRequestNarrative={async () => undefined}
      />,
    );

    expect(markup).toContain('持刀溃兵');
    expect(markup).not.toContain(`combat-v2-slot-name">${scopedActorId}`);
  });

  it('shows active post-combat narrative generation in the battlefield center', () => {
    const markup = renderToStaticMarkup(
      <CombatEncounterScreen
        runtimeState={makeNarrativePendingState()}
        locationLabel="林间驿道"
        onResolved={async () => undefined}
        onRequestNarrative={async () => undefined}
        narrativeBusy
        onCancelNarrative={() => undefined}
      />,
    );

    expect(markup).toContain('data-testid="combat-v2-stage-narrative"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('战斗已经结算');
    expect(markup).toContain('正在生成战后正文');
    expect(markup).toContain('>中止生成</button>');
    expect(markup).not.toContain('class="combat-v2-stage-seal"');
  });
});
