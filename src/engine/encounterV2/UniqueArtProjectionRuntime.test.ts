import { describe, expect, it } from 'vitest';
import type { CharacterUniqueArt, RuntimeState } from '../types';
import { mergeEncounterSemanticProjections } from './EncounterRuntimeIntegration';
import {
  createCompatibilityPersonalCombatArtProjection,
  createCompatibilityWarArtProjection,
  ensureStableUniqueArtProjections,
  materializeLevelledUniqueArtProjection,
} from './UniqueArtProjectionRuntime';

function makeArt(overrides: Partial<CharacterUniqueArt> = {}): CharacterUniqueArt {
  return {
    id: 'art_player_blade',
    name: '破阵刀势',
    rarity: 'purple',
    domain: 'personalCombat',
    level: 1,
    maxLevel: 10,
    progress: 0,
    description: '以刀势抢占先机。',
    effectSummary: '提高个人战攻击表现。',
    source: 'training',
    ...overrides,
  };
}

function makeState(arts: CharacterUniqueArt[]): RuntimeState {
  return {
    engineVersion: '0.1.0',
    worldBookId: 'threeKingdoms',
    worldBookVersion: '1',
    worldBookSource: 'official',
    startDate: '公元194年05月03日 08:00',
    currentDate: '公元194年05月03日 08:00',
    player: {
      id: 'player_test',
      name: '测试主角',
      roleType: '游侠',
      uniqueArts: arts,
      summary: '测试主角',
    },
    currentLocationId: 'place_test',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
  };
}

describe('UniqueArtProjectionRuntime', () => {
  it('persists bounded compatibility projections for combat domains only', () => {
    const state = makeState([
      makeArt(),
      makeArt({ id: 'art_player_command', name: '军势调度', domain: 'warfare' }),
      makeArt({ id: 'art_player_governance', name: '清丈法', domain: 'governance' }),
    ]);

    const repaired = ensureStableUniqueArtProjections(state);
    const profiles = repaired.encounterV2?.semanticProjections ?? [];

    expect(profiles.map((profile) => profile.sourceId)).toEqual([
      'art_player_blade',
      'art_player_command',
    ]);
    expect(profiles[0]).toEqual(expect.objectContaining({
      status: 'executable',
      rulesetScopes: ['personal_combat'],
    }));
    expect(profiles[1]).toEqual(expect.objectContaining({
      status: 'executable',
      rulesetScopes: ['war'],
    }));
  });

  it('is idempotent after the old-save repair has been persisted', () => {
    const first = ensureStableUniqueArtProjections(makeState([makeArt()]));
    const second = ensureStableUniqueArtProjections(first);

    expect(second).toBe(first);
    expect(second.encounterV2?.semanticProjections).toEqual(first.encounterV2?.semanticProjections);
  });

  it('defers persistence repair while a legacy pre-encounter checkpoint hash is active', () => {
    const state = makeState([makeArt()]);
    const intent = {
      contractVersion: 1 as const,
      encounterId: 'legacy',
      kind: 'personal_combat' as const,
      rulesetVersion: 'combat-v2.0.0' as const,
      sourceTurnNumber: 0,
      locationId: 'place_test',
      reason: 'legacy test',
      seed: 'legacy-seed',
      createdAt: '2026-08-03T00:00:00.000Z',
      policy: {
        lethality: 'standard' as const,
        allowRetreat: true,
        allowSurrender: true,
        allowCapture: true,
        lootPolicy: 'none' as const,
      },
      playerParty: { actorIds: ['player_test'] },
      enemyParty: { actorIds: ['npc_test'] },
      partySelection: 'locked' as const,
    };
    state.encounterV2 = {
      semanticProjections: [],
      appliedResultHashes: [],
      narratedResultHashes: [],
      active: {
        session: {
          sessionId: 'session:legacy',
          status: 'pending',
          intent,
          snapshotHash: 'fnv1a64:legacy',
          createdAt: '2026-08-03T00:00:00.000Z',
        },
        checkpoint: {
          checkpointKind: 'pre_encounter',
          checkpointId: 'checkpoint:legacy',
          saveId: 'save:legacy',
          sessionId: 'session:legacy',
          encounterId: 'legacy',
          intent,
          snapshotHash: 'fnv1a64:legacy',
          createdAt: '2026-08-03T00:00:00.000Z',
        },
      },
    };

    expect(ensureStableUniqueArtProjections(state)).toBe(state);
  });

  it('materializes stronger encounter values from higher levels without mutating the ledger profile', () => {
    const baseArt = makeArt({ rarity: 'orange' });
    const baseProfile = createCompatibilityPersonalCombatArtProjection(baseArt);
    const before = JSON.parse(JSON.stringify(baseProfile));
    const levelOne = materializeLevelledUniqueArtProjection(baseArt, baseProfile, 'personal_combat');
    const levelTen = materializeLevelledUniqueArtProjection(
      { ...baseArt, level: 10 },
      baseProfile,
      'personal_combat',
    );

    expect(levelTen.powerMultiplier).toBeGreaterThan(levelOne.powerMultiplier);
    expect(levelTen.staminaCost).toBeLessThan(levelOne.staminaCost);
    expect(levelTen.accuracyModifier).toBeGreaterThan(levelOne.accuracyModifier);
    expect(levelTen.effects[0].value).toBeGreaterThan(levelOne.effects[0].value);
    expect(baseProfile).toEqual(before);
  });

  it('keeps an orange personal-combat art visibly above a weak stored projection', () => {
    const art = makeArt({ rarity: 'orange', level: 1 });
    const weakStoredProfile = createCompatibilityPersonalCombatArtProjection(art);
    weakStoredProfile.powerClass = 'light';
    weakStoredProfile.powerMultiplier = 1.10;
    weakStoredProfile.accuracyModifier = 0;
    weakStoredProfile.armorPiercing = false;

    const materialized = materializeLevelledUniqueArtProjection(
      art,
      weakStoredProfile,
      'personal_combat',
    );

    expect(materialized.powerClass).toBe('heavy');
    expect(materialized.powerMultiplier).toBeGreaterThanOrEqual(2.49);
    expect(materialized.accuracyModifier).toBeGreaterThanOrEqual(10);
    expect(materialized.armorPiercing).toBe(true);
    expect(weakStoredProfile.powerClass).toBe('light');
    expect(weakStoredProfile.powerMultiplier).toBe(1.10);
  });

  it('does not let later encounter turns overwrite an established unique-art projection', () => {
    const art = makeArt();
    const established = createCompatibilityPersonalCombatArtProjection(art);
    established.accuracyModifier = 3;
    const state = {
      ...makeState([art]),
      encounterV2: {
        semanticProjections: [established],
        appliedResultHashes: [],
        narratedResultHashes: [],
      },
    };
    const drifted = createCompatibilityPersonalCombatArtProjection(art);
    drifted.accuracyModifier = 19;

    const merged = mergeEncounterSemanticProjections(state, [drifted]);
    const stored = merged.encounterV2?.semanticProjections.find((profile) => profile.sourceId === art.id);

    expect(stored).toEqual(established);
  });

  it('adds a structured passive recovery extension without replacing an established active projection', () => {
    const art = makeArt({
      effectSummary: '挥刀破阵，并在每个游戏回合后调息恢复生命。',
    });
    const established = createCompatibilityPersonalCombatArtProjection(art);
    established.accuracyModifier = 7;
    established.effects = [{
      trigger: 'on_hit',
      condition: 'always',
      operation: 'apply_status',
      target: 'single_enemy',
      value: 1,
      priority: 12,
      perEncounterLimit: 1,
      statusId: 'status_test_staggered',
    }];
    const incoming = {
      ...structuredClone(established),
      activation: 'hybrid' as const,
      rulesetScopes: ['personal_combat', 'runtime_turn'] as ('personal_combat' | 'runtime_turn')[],
      effects: [{
        trigger: 'after_runtime_turn' as const,
        condition: 'always' as const,
        operation: 'restore_hp' as const,
        target: 'self' as const,
        value: 8,
        priority: 30,
        perRoundLimit: 1,
      }],
    };
    const state = {
      ...makeState([art]),
      encounterV2: {
        semanticProjections: [established],
        appliedResultHashes: [],
        narratedResultHashes: [],
      },
    };

    const merged = mergeEncounterSemanticProjections(state, [incoming]);
    const stored = merged.encounterV2?.semanticProjections.find((profile) => profile.sourceId === art.id);

    expect(stored).toMatchObject({
      activation: 'hybrid',
      accuracyModifier: 7,
      rulesetScopes: expect.arrayContaining(['personal_combat', 'runtime_turn']),
    });
    expect(stored?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: 'on_hit', operation: 'apply_status' }),
      expect.objectContaining({ trigger: 'after_runtime_turn', operation: 'restore_hp', value: 8 }),
    ]));
  });

  it('persists the provider projection for a newly acquired art instead of replacing it with compatibility data', () => {
    const art = makeArt();
    const providerProjection = createCompatibilityPersonalCombatArtProjection(art);
    providerProjection.purpose = 'control';
    providerProjection.accuracyModifier = 7;
    providerProjection.effects = [{
      trigger: 'on_hit',
      condition: 'always',
      operation: 'apply_status',
      target: 'single_enemy',
      value: 1,
      priority: 12,
      perEncounterLimit: 1,
      statusId: 'status_test_staggered',
    }];

    const merged = mergeEncounterSemanticProjections(makeState([art]), [providerProjection]);
    const stored = merged.encounterV2?.semanticProjections.find((profile) => profile.sourceId === art.id);

    expect(stored).toEqual(providerProjection);
  });

  it('applies the same level contract to warfare while keeping discrete effects stable', () => {
    const art = makeArt({
      id: 'art_player_command',
      name: '军势调度',
      rarity: 'red',
      domain: 'warfare',
    });
    const baseProfile = createCompatibilityWarArtProjection(art);
    baseProfile.effects.push({
      trigger: 'after_war_resolution',
      condition: 'always',
      operation: 'apply_status',
      target: 'enemy_force',
      value: 1,
      priority: 50,
      perEncounterLimit: 1,
      statusId: 'status_test_disordered',
    });
    const levelOne = materializeLevelledUniqueArtProjection(art, baseProfile, 'war');
    const levelTen = materializeLevelledUniqueArtProjection(
      { ...art, level: 10 },
      baseProfile,
      'war',
    );

    expect(levelTen.effects[0].value).toBeGreaterThan(levelOne.effects[0].value);
    expect(levelTen.effects[1].value).toBe(levelOne.effects[1].value);
    expect(levelTen.staminaCost).toBeLessThan(levelOne.staminaCost);
    expect(baseProfile.effects[1].value).toBe(1);
  });

  it('gives orange warfare arts a decisive frozen effect floor in the current ruleset', () => {
    const art = makeArt({
      id: 'art_player_command',
      name: '军势调度',
      rarity: 'orange',
      domain: 'warfare',
      level: 1,
    });
    const weakStoredProfile = createCompatibilityWarArtProjection(art);
    weakStoredProfile.powerClass = 'light';
    weakStoredProfile.effects[0].value = 1;

    const materialized = materializeLevelledUniqueArtProjection(
      art,
      weakStoredProfile,
      'war',
      { aggressiveWarScaling: true, enhancedWarScaling: true },
    );

    expect(materialized.powerClass).toBe('ultimate');
    expect(materialized.effects[0].value).toBe(20);
    expect(weakStoredProfile.effects[0].value).toBe(1);
  });
});
