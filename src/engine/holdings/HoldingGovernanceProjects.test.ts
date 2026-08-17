import { describe, expect, it } from 'vitest';
import type { HoldingLedgerEntry, RuntimeState } from '../types';
import {
  buildHoldingGovernanceProjectPreview,
  settleDueHoldingGovernanceProjects,
  startHoldingGovernanceProject,
} from './HoldingGovernanceProjects';

function makeHolding(overrides: Partial<HoldingLedgerEntry> = {}): HoldingLedgerEntry {
  return {
    holdingId: 'holding_test_county',
    name: 'Test County',
    type: 'county',
    status: 'controlled',
    summary: 'A controlled county.',
    civilAdministrationScope: 'territorial',
    scaleLevel: 2,
    agriculture: 50,
    commerce: 40,
    population: 60,
    publicOrder: 55,
    popularSupport: 50,
    defense: 45,
    recruitPotential: 40,
    armory: 30,
    horseSupply: 20,
    corruption: 35,
    farmlandMu: 12_000,
    registeredHouseholds: 1_800,
    updatedAt: '公元189年09月01日 08:00（辰时）',
    ...overrides,
  };
}

function makeState(holding = makeHolding()): RuntimeState {
  return {
    engineVersion: 'test',
    worldBookId: 'test',
    worldBookVersion: 'test',
    worldBookSource: 'official',
    startDate: '公元189年09月01日 08:00（辰时）',
    currentDate: '公元189年09月01日 08:00（辰时）',
    player: { id: 'player_test', name: 'Player', roleType: 'official', locationId: 'loc_test', summary: 'Test player.' },
    currentLocationId: 'loc_test',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    holdings: [holding],
    resources: {
      money: 10_000,
      grain: 10_000,
      horses: 0,
      arms: 0,
      recruits: 0,
      weapons: [],
      documents: [],
      tokens: [],
      importantSupplies: [],
    },
  };
}

describe('HoldingGovernanceProjects', () => {
  it('rejects civil projects on a no-civil-administration facility', () => {
    const state = makeState(makeHolding({
      holdingId: 'holding_camp',
      type: 'camp',
      civilAdministrationScope: 'none',
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 0,
      popularSupport: 0,
      recruitPotential: 0,
      corruption: undefined,
      farmlandMu: undefined,
      registeredHouseholds: undefined,
    }));
    const result = startHoldingGovernanceProject(state, {
      holdingId: 'holding_camp',
      type: 'land_survey',
      host: { actorType: 'player', actorId: 'player_test' },
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(result.state.holdingGovernanceProjects).toBeUndefined();
  });

  it('offers military-site projects and never grows a score beyond 100', () => {
    const camp = makeHolding({
      holdingId: 'holding_camp',
      type: 'camp',
      civilAdministrationScope: 'none',
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 0,
      popularSupport: 0,
      recruitPotential: 0,
      corruption: undefined,
      farmlandMu: undefined,
      registeredHouseholds: undefined,
      defense: 96,
    });
    const started = startHoldingGovernanceProject(makeState(camp), {
      holdingId: camp.holdingId,
      type: 'position_fortification',
      host: { actorType: 'player', actorId: 'player_test' },
    });
    expect(started.ok).toBe(true);
    expect(started.project?.expectedEffects.defense).toEqual({ min: 4, max: 4 });

    const settled = settleDueHoldingGovernanceProjects({
      ...started.state,
      currentDate: started.project!.expectedCompleteAt,
    });
    expect(settled.holdings?.[0].defense).toBe(100);
    expect(settled.holdingGovernanceProjects?.[0].result?.deltas.defense).toBe(4);

    const rejected = startHoldingGovernanceProject(settled, {
      holdingId: camp.holdingId,
      type: 'position_fortification',
      host: { actorType: 'player', actorId: 'player_test' },
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain('达到当前类型与规模上限');
  });

  it('deducts project costs atomically and captures the starting baseline', () => {
    const state = makeState();
    const preview = buildHoldingGovernanceProjectPreview(state.holdings![0], 'land_survey');
    const started = startHoldingGovernanceProject(state, {
      holdingId: 'holding_test_county',
      type: 'land_survey',
      host: { actorType: 'player', actorId: 'player_test' },
      projectId: 'governance:test:land-survey',
    });
    expect(started.ok).toBe(true);
    expect(started.state.resources).toMatchObject({
      money: 10_000 - preview.moneyCost,
      grain: 10_000 - preview.grainCost,
    });
    expect(started.project).toMatchObject({
      projectId: 'governance:test:land-survey',
      status: 'active',
      baseline: {
        holdingStatus: 'controlled',
        civilAdministrationScope: 'territorial',
        farmlandMu: 12_000,
        registeredHouseholds: 1_800,
      },
    });
    expect(state.resources).toMatchObject({ money: 10_000, grain: 10_000 });
  });

  it('does not create or charge a project when resources are insufficient', () => {
    const state = makeState();
    state.resources = { ...state.resources!, money: 0 };
    const result = startHoldingGovernanceProject(state, {
      holdingId: 'holding_test_county',
      type: 'commerce',
      host: { actorType: 'player', actorId: 'player_test' },
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(result.state.resources?.grain).toBe(10_000);
  });

  it('settles only the project allowlist at completion and keeps other holding fields intact', () => {
    const started = startHoldingGovernanceProject(makeState(), {
      holdingId: 'holding_test_county',
      type: 'anti_corruption',
      host: { actorType: 'player', actorId: 'player_test' },
      projectId: 'governance:test:anti-corruption',
    });
    const before = started.state.holdings![0];
    const dueState = {
      ...started.state,
      currentDate: started.project!.expectedCompleteAt,
    };
    const settled = settleDueHoldingGovernanceProjects(dueState);
    const after = settled.holdings![0];
    expect(settled.holdingGovernanceProjects?.[0].status).toBe('completed');
    expect(after.corruption).toBeLessThan(before.corruption!);
    expect(after.popularSupport).toBeGreaterThan(before.popularSupport);
    expect(after.farmlandMu).toBe(before.farmlandMu);
    expect(after.population).toBe(before.population);
    expect(after.commerce).toBe(before.commerce);
    expect(settled.holdingGovernanceProjects?.[0].result?.deltas).toEqual({
      corruption: expect.any(Number),
      popularSupport: expect.any(Number),
    });
  });

  it('blocks a due project if the holding was lost and survives JSON export/import', () => {
    const started = startHoldingGovernanceProject(makeState(), {
      holdingId: 'holding_test_county',
      type: 'public_order',
      host: { actorType: 'player', actorId: 'player_test' },
      projectId: 'governance:test:public-order',
    });
    const imported = JSON.parse(JSON.stringify(started.state)) as RuntimeState;
    imported.currentDate = started.project!.expectedCompleteAt;
    imported.holdings![0] = { ...imported.holdings![0], status: 'lost' };
    const settled = settleDueHoldingGovernanceProjects(imported);
    expect(settled.holdingGovernanceProjects?.[0]).toMatchObject({
      projectId: 'governance:test:public-order',
      status: 'blocked',
      blockedReason: '领地已经失去控制。',
    });
    expect(settled.holdings![0].publicOrder).toBe(55);
  });

  it('requires an appointed NPC at the holding and applies exact governance art projection', () => {
    const state = makeState(makeHolding({
      locationId: 'loc_test',
      governanceOfficerNpcIds: ['npc_steward'],
    }));
    state.npcs = [{
      npcId: 'npc_steward',
      name: 'Steward',
      sex: '男',
      age: 40,
      role: 'official',
      locationId: 'loc_test',
      isPresent: false,
      isFocused: false,
      summary: 'An appointed official.',
      appearance: 'Plain robes.',
      personality: 'Methodical.',
      motivation: 'Govern well.',
      relationToPlayer: 'Serves the player.',
      contactLevel: 30,
      recentAttitude: 'Focused.',
      memories: [],
      abilityScores: { 政治: 90, 智力: 85, 魅力: 70 },
      uniqueArts: [{
        id: 'art_clean_registers',
        name: 'Clean Registers',
        rarity: 'orange',
        domain: 'governance',
        level: 6,
        maxLevel: 10,
        progress: 0,
        description: 'Audits corrupt registers.',
        effectSummary: 'Improves anti-corruption governance.',
        source: 'background',
        checkHooks: [{ scope: 'holding.anti_corruption', modifier: 15, note: 'Exact governance projection.' }],
      }],
    }];
    const baseline = buildHoldingGovernanceProjectPreview(state.holdings![0], 'anti_corruption');
    const started = startHoldingGovernanceProject(state, {
      holdingId: 'holding_test_county',
      type: 'anti_corruption',
      host: { actorType: 'npc', actorId: 'npc_steward' },
      projectId: 'governance:test:npc-host',
    });
    expect(started.ok).toBe(true);
    expect(started.project?.appliedArtIds).toEqual(['art_clean_registers']);
    expect(started.project?.modifiers.hostAbilityScore).toBeGreaterThan(80);
    expect(started.project!.investedMoney).toBeLessThan(baseline.moneyCost);
    expect(started.project!.expectedEffects.corruption!.min).toBeLessThan(baseline.expectedEffects.corruption!.min);

    const unappointed = makeState(makeHolding({ locationId: 'loc_test' }));
    unappointed.npcs = state.npcs;
    const rejected = startHoldingGovernanceProject(unappointed, {
      holdingId: 'holding_test_county',
      type: 'anti_corruption',
      host: { actorType: 'npc', actorId: 'npc_steward' },
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain('尚未被结构化任命');
  });

  it('blocks settlement when an NPC host moves away after starting', () => {
    const state = makeState(makeHolding({
      locationId: 'loc_test',
      stewardNpcId: 'npc_steward',
    }));
    state.npcs = [{
      npcId: 'npc_steward',
      name: 'Steward',
      sex: '男',
      age: 40,
      role: 'official',
      locationId: 'loc_test',
      isPresent: false,
      isFocused: false,
      summary: 'A steward.',
      appearance: 'Plain robes.',
      personality: 'Methodical.',
      motivation: 'Govern well.',
      relationToPlayer: 'Serves the player.',
      contactLevel: 30,
      recentAttitude: 'Focused.',
      memories: [],
      abilityScores: { 政治: 75, 智力: 70, 魅力: 60 },
    }];
    const started = startHoldingGovernanceProject(state, {
      holdingId: 'holding_test_county',
      type: 'public_order',
      host: { actorType: 'npc', actorId: 'npc_steward' },
      projectId: 'governance:test:moved-host',
    });
    const moved = {
      ...started.state,
      currentDate: started.project!.expectedCompleteAt,
      npcs: started.state.npcs?.map((npc) => ({ ...npc, locationId: 'loc_elsewhere' })),
    };
    const settled = settleDueHoldingGovernanceProjects(moved);
    expect(settled.holdingGovernanceProjects?.[0].status).toBe('blocked');
    expect(settled.holdingGovernanceProjects?.[0].blockedReason).toContain('当前不在目标领地');
    expect(settled.holdings![0].publicOrder).toBe(55);
  });

  it('blocks settlement when an active NPC host no longer exists', () => {
    const state = makeState(makeHolding({
      locationId: 'loc_test',
      stewardNpcId: 'npc_steward',
    }));
    state.npcs = [{
      npcId: 'npc_steward',
      name: 'Steward',
      sex: '男',
      age: 40,
      role: 'official',
      locationId: 'loc_test',
      isPresent: false,
      isFocused: false,
      summary: 'A steward.',
      appearance: 'Plain robes.',
      personality: 'Methodical.',
      motivation: 'Govern well.',
      relationToPlayer: 'Serves the player.',
      contactLevel: 30,
      recentAttitude: 'Focused.',
      memories: [],
      abilityScores: { 政治: 75, 智力: 70, 魅力: 60 },
    }];
    const started = startHoldingGovernanceProject(state, {
      holdingId: 'holding_test_county',
      type: 'anti_corruption',
      host: { actorType: 'npc', actorId: 'npc_steward' },
      projectId: 'governance:test:deleted-host',
    });
    const withoutHost = {
      ...started.state,
      currentDate: started.project!.expectedCompleteAt,
      npcs: [],
    };
    const settled = settleDueHoldingGovernanceProjects(withoutHost);
    expect(settled.holdingGovernanceProjects?.[0]).toMatchObject({
      status: 'blocked',
      blockedReason: '主持 NPC 已不存在。',
    });
    expect(settled.holdings![0].corruption).toBe(35);
  });
});
