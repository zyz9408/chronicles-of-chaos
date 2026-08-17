import { describe, expect, it } from 'vitest';
import type { HoldingLedgerEntry, RuntimeState } from '../engine/types';
import { buildHoldingGovernancePanelModel } from './holdingGovernancePanelModel';

const holding: HoldingLedgerEntry = {
  holdingId: 'holding_yangdi',
  name: '阳翟县城',
  type: 'county',
  status: 'controlled',
  summary: '郡治初定。',
  locationId: 'place_yingchuan',
  stewardNpcId: 'npc_steward',
  governanceOfficerNpcIds: ['npc_officer', 'npc_moved'],
  scaleLevel: 2,
  agriculture: 60,
  commerce: 55,
  population: 60,
  publicOrder: 45,
  popularSupport: 50,
  defense: 45,
  recruitPotential: 45,
  armory: 30,
  horseSupply: 20,
  corruption: 40,
  farmlandMu: 8000,
  registeredHouseholds: 1200,
  updatedAt: '公元189年09月01日 10:00（巳时）',
};

const baseState = {
  currentDate: '公元189年09月11日 10:00（巳时）',
  player: {
    id: 'player_1',
    name: '刘构',
    abilityScores: { politics: 82, intelligence: 76, charm: 68 },
    uniqueArts: [{
      id: 'art_clean_government',
      name: '澄清吏治',
      rarity: 'precious',
      domain: 'governance',
      level: 3,
      progress: 20,
      description: '清查吏治。',
      effectSummary: '用于整治贪腐。',
      source: 'event',
      checkHooks: [{ scope: 'holding.anti_corruption', modifier: 12, note: '精确治理投影' }],
    }],
  },
  resources: {
    money: 5000,
    grain: 5000,
    horses: 0,
    arms: 0,
    recruits: 0,
    weapons: [],
    documents: [],
    tokens: [],
    importantSupplies: [],
  },
  holdings: [holding],
  npcs: [
    {
      npcId: 'npc_steward',
      name: '荀攸',
      locationId: 'place_yingchuan',
      abilityScores: { politics: 90, intelligence: 92, charm: 65 },
      uniqueArts: [],
    },
    {
      npcId: 'npc_officer',
      name: '陈群',
      locationId: 'place_yingchuan',
      abilityScores: { politics: 88, intelligence: 78, charm: 70 },
      uniqueArts: [],
    },
    {
      npcId: 'npc_moved',
      name: '外任官员',
      locationId: 'place_luoyang',
      abilityScores: { politics: 90 },
      uniqueArts: [],
    },
  ],
  holdingGovernanceProjects: [],
} as unknown as RuntimeState;

describe('holdingGovernancePanelModel', () => {
  it('only offers the player and explicitly appointed NPCs who are currently at the holding', () => {
    const model = buildHoldingGovernancePanelModel(baseState, holding, { selectedType: 'public_order' });

    expect(model.actorOptions.map((actor) => actor.label)).toEqual(['刘构', '荀攸', '陈群']);
    expect(model.actorOptions.map((actor) => actor.label)).not.toContain('外任官员');
    expect(model.assistantEligibilityHint).toBeUndefined();
    expect(model.canStart).toBe(true);
  });

  it('explains the appointment and location requirements when no NPC can assist', () => {
    const unstaffedHolding = {
      ...holding,
      stewardNpcId: undefined,
      governanceOfficerNpcIds: undefined,
    } as HoldingLedgerEntry;

    const model = buildHoldingGovernancePanelModel(baseState, unstaffedHolding, { selectedType: 'public_order' });

    expect(model.actorOptions.map((actor) => actor.label)).toEqual(['刘构']);
    expect(model.assistantEligibilityHint).toBe(
      '暂无可选协助者：NPC 须已写入人物志，被任命为本领地管事或治理官员，且当前位置与本领地一致。',
    );
  });

  it('projects exact governance arts into the visible preview without creating resources', () => {
    const model = buildHoldingGovernancePanelModel(baseState, holding, { selectedType: 'anti_corruption' });

    expect(model.preview).toMatchObject({
      title: '整治贪腐',
      appliedArtNames: ['澄清吏治'],
    });
    expect(model.preview?.effectRows.map((row) => row.label)).toEqual(['腐败', '民心']);
    expect(model.preview?.modifierSummary).toContain('效果');
    expect(baseState.resources!.money).toBe(5000);
    expect(baseState.resources!.grain).toBe(5000);
  });

  it('disables starting when money or grain is insufficient', () => {
    const state = {
      ...baseState,
      resources: { ...baseState.resources, money: 0, grain: 0 },
    } as unknown as RuntimeState;
    const model = buildHoldingGovernancePanelModel(state, holding, { selectedType: 'relief' });

    expect(model.canStart).toBe(false);
    expect(model.startError).toBe('势力钱粮不足，暂时不能开工。');
  });

  it('shows active progress and completed atomic result rows', () => {
    const state = {
      ...baseState,
      holdingGovernanceProjects: [
        {
          projectId: 'project_active',
          holdingId: holding.holdingId,
          type: 'public_order',
          status: 'active',
          host: { actorType: 'player', actorId: 'player_1' },
          startedAt: '公元189年09月01日 10:00（巳时）',
          expectedCompleteAt: '公元189年09月21日 10:00（巳时）',
          investedMoney: 400,
          investedGrain: 160,
          baseline: { holdingStatus: 'controlled', civilAdministrationScope: 'territorial', scaleLevel: 2 },
          expectedEffects: { publicOrder: { min: 4, max: 9 } },
          risk: 'moderate',
          modifiers: { hostAbilityScore: 75, durationMultiplier: 1, costMultiplier: 1, effectMultiplier: 1, riskStepsReduced: 0 },
          updatedAt: '公元189年09月01日 10:00（巳时）',
        },
        {
          projectId: 'project_done',
          holdingId: holding.holdingId,
          type: 'anti_corruption',
          status: 'completed',
          host: { actorType: 'player', actorId: 'player_1' },
          startedAt: '公元189年07月01日 10:00（巳时）',
          expectedCompleteAt: '公元189年08月01日 10:00（巳时）',
          investedMoney: 500,
          investedGrain: 60,
          baseline: { holdingStatus: 'controlled', civilAdministrationScope: 'territorial', scaleLevel: 2 },
          expectedEffects: { corruption: { min: -10, max: -5 } },
          risk: 'high',
          modifiers: { hostAbilityScore: 75, durationMultiplier: 1, costMultiplier: 1, effectMultiplier: 1, riskStepsReduced: 0 },
          result: {
            completedAt: '公元189年08月01日 10:00（巳时）',
            deltas: { corruption: -8, popularSupport: 2 },
            summary: '整治贪腐完成。',
          },
          updatedAt: '公元189年08月01日 10:00（巳时）',
        },
      ],
    } as unknown as RuntimeState;
    const model = buildHoldingGovernancePanelModel(state, holding, { selectedType: 'public_order' });

    expect(model.activeProject).toMatchObject({ projectId: 'project_active', progressPercent: 50 });
    expect(model.canStart).toBe(false);
    expect(model.projectHistory.find((project) => project.projectId === 'project_done')?.resultRows).toEqual([
      { field: 'corruption', label: '腐败', value: '-8' },
      { field: 'popularSupport', label: '民心', value: '+2' },
    ]);
  });

  it('shows different operational projects for camps and passes', () => {
    const militaryBase = {
      ...holding,
      civilAdministrationScope: 'none' as const,
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 0,
      popularSupport: 0,
      recruitPotential: 0,
      corruption: undefined,
      farmlandMu: undefined,
      registeredHouseholds: undefined,
    };
    const campModel = buildHoldingGovernancePanelModel(baseState, {
      ...militaryBase,
      holdingId: 'holding_camp',
      type: 'camp',
    });
    const passModel = buildHoldingGovernancePanelModel(baseState, {
      ...militaryBase,
      holdingId: 'holding_pass',
      type: 'pass',
    });

    expect(campModel.projectOptions.map((option) => option.type)).toEqual([
      'garrison_drill',
      'position_fortification',
      'armory_maintenance',
    ]);
    expect(passModel.projectOptions.map((option) => option.type)).toEqual([
      'position_fortification',
      'beacon_maintenance',
      'route_patrol',
      'armory_maintenance',
    ]);
    expect(passModel.projectOptions.map((option) => option.label)).toContain('整修烽燧');
    expect(campModel.projectOptions.map((option) => option.label)).not.toContain('整修烽燧');
  });
});
