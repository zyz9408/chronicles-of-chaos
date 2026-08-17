import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { SEMANTIC_PROJECTION_VERSION, type UniqueArtSemanticProfile } from '../encounterV2/EncounterContracts';
import { settlePassiveUniqueArtsAfterRuntimeTurn } from './PlayerPassiveUniqueArtRuntime';

function makeProfile(overrides: Partial<UniqueArtSemanticProfile> = {}): UniqueArtSemanticProfile {
  return {
    profileKind: 'ability',
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    sourceId: 'art_regeneration',
    sourceType: 'unique_art',
    status: 'executable',
    rulesetScopes: ['runtime_turn'],
    activation: 'passive',
    targetMode: 'self',
    purpose: 'healing',
    powerClass: 'light',
    powerMultiplier: 1.1,
    staminaCost: 8,
    accuracyModifier: 0,
    maxHits: 1,
    perEncounterLimit: 1,
    blockable: true,
    armorPiercing: false,
    canCrit: false,
    allowAutoUse: false,
    effects: [{
      trigger: 'after_runtime_turn',
      condition: 'always',
      operation: 'restore_hp',
      target: 'self',
      value: 8,
      priority: 10,
    }],
    ...overrides,
  };
}

function makeState(date: string, profile: UniqueArtSemanticProfile | null = makeProfile()): RuntimeState {
  const state = ensureLuanShiState({
    engineVersion: '1.7.13',
    worldBookId: 'test-world',
    worldBookVersion: '1',
    worldBookSource: 'official',
    startDate: date,
    currentDate: date,
    player: {
      id: 'player_1',
      name: '林砚',
      roleType: '游侠',
      summary: '测试主角。',
      vitals: { hp: 50, maxHp: 100, stamina: 60, maxStamina: 100 },
      uniqueArts: [{
        id: 'art_regeneration',
        name: '归元生息',
        rarity: 'purple',
        domain: 'survival',
        level: 1,
        description: '稳定绝艺。',
        effectSummary: '每回合恢复生命。',
        source: 'training',
      }],
    },
    currentLocationId: 'loc_test',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [{
      turnNumber: 2,
      date,
      playerInput: '继续行动',
      narrativeText: '时间经过。',
      statePatchSummary: '时间推进',
      timestamp: '2026-08-08T00:00:00.000Z',
    }],
    localSituationNotes: [],
  });
  return profile
    ? { ...state, encounterV2: { semanticProjections: [profile], appliedResultHashes: [], narratedResultHashes: [] } }
    : state;
}

describe('PlayerPassiveUniqueArtRuntime', () => {
  it('settles structured passive recovery once after successful game-time advancement', () => {
    const before = makeState('公元194年04月20日 08:00（辰时）');
    const after = makeState('公元194年04月20日 09:00（巳时）');
    const first = settlePassiveUniqueArtsAfterRuntimeTurn(after, before);
    const second = settlePassiveUniqueArtsAfterRuntimeTurn(first.state, before);

    expect(first.state.player.vitals?.hp).toBe(58);
    expect(first.settlement).toMatchObject({ hpRecovered: 8, staminaRecovered: 0 });
    expect(first.state.turnLog[first.state.turnLog.length - 1]?.statePatchSummary)
      .toContain('被动绝艺 归元生息：生命 +8');
    expect(second.state.player.vitals?.hp).toBe(58);
    expect(second.settlement).toBeUndefined();
  });

  it('does not infer recovery from prose or settle when game time did not advance', () => {
    const before = makeState('公元194年04月20日 08:00（辰时）', null);
    const advancedWithoutProjection = makeState('公元194年04月20日 09:00（巳时）', null);
    const unchangedWithProjection = makeState('公元194年04月20日 08:00（辰时）');

    expect(settlePassiveUniqueArtsAfterRuntimeTurn(advancedWithoutProjection, before).state.player.vitals?.hp).toBe(50);
    expect(settlePassiveUniqueArtsAfterRuntimeTurn(unchangedWithProjection, before).state.player.vitals?.hp).toBe(50);
  });

  it('does not revive a downed player and enforces rarity and combined recovery caps', () => {
    const before = makeState('公元194年04月20日 08:00（辰时）');
    const cappedProfile = makeProfile({
      effects: Array.from({ length: 4 }, (_, index) => ({
        trigger: 'after_runtime_turn' as const,
        condition: 'always' as const,
        operation: 'restore_hp' as const,
        target: 'self' as const,
        value: 100,
        priority: index,
      })),
    });
    const after = makeState('公元194年04月20日 09:00（巳时）', cappedProfile);
    after.player.uniqueArts![0].rarity = 'red';
    after.player.vitals!.hp = 10;
    const capped = settlePassiveUniqueArtsAfterRuntimeTurn(after, before);
    expect(capped.state.player.vitals?.hp).toBe(35);

    const downed = makeState('公元194年04月20日 09:00（巳时）', cappedProfile);
    downed.player.vitals!.hp = 0;
    expect(settlePassiveUniqueArtsAfterRuntimeTurn(downed, before).state.player.vitals?.hp).toBe(0);
  });
});
