import { describe, expect, it } from 'vitest';
import type { PrivateAssetEntry, RuntimeState } from '../types';
import { completeDuePrivateAssetProjects } from './HoldingAnnualSettlement';
import {
  cancelPrivateAssetManagementProject,
  startPrivateAssetManagementProject,
} from './PrivateAssetManagementProjects';

function makeAsset(overrides: Partial<PrivateAssetEntry> = {}): PrivateAssetEntry {
  return {
    privateAssetId: 'asset_estate',
    name: '林氏庄园',
    type: 'estate',
    ownerScope: 'personal',
    status: 'active',
    summary: '一处正在经营的庄园。',
    locationId: 'loc_estate',
    managerNpcId: 'npc_manager',
    mu: 100,
    households: 12,
    workers: 16,
    updatedAt: '公元189年09月01日 08:00（辰时）',
    ...overrides,
  };
}

function makeState(asset = makeAsset()): RuntimeState {
  return {
    engineVersion: 'test', worldBookId: 'test', worldBookVersion: 'test', worldBookSource: 'official',
    startDate: '公元189年09月01日 08:00（辰时）', currentDate: '公元189年09月01日 08:00（辰时）',
    player: { id: 'player_test', name: '林砚', roleType: 'commoner', locationId: 'loc_estate', summary: 'Test.' },
    currentLocationId: 'loc_estate', knownActors: [], knownFactions: [], relationships: [], knownRumors: [],
    activeQuests: [], playerResources: {}, worldStateDelta: {}, turnLog: [], localSituationNotes: [],
    privateAssets: [asset], privateAssetProjects: [],
    npcs: [{
      npcId: 'npc_manager', name: '管事', sex: '男', age: 40, role: '管事',
      locationId: 'loc_estate', isPresent: true, isFocused: true,
      summary: 'Test.', appearance: '朴素', personality: '稳重', motivation: '经营产业',
      relationToPlayer: '雇佣', contactLevel: 20, recentAttitude: '尽职', memories: [],
    }],
    resources: { money: 10_000, grain: 10_000, horses: 0, arms: 0, recruits: 0, weapons: [], documents: [], tokens: [], importantSupplies: [] },
  };
}

describe('PrivateAssetManagementProjects', () => {
  it('starts a bounded project and deducts shared resources atomically', () => {
    const state = makeState();
    const result = startPrivateAssetManagementProject(state, {
      assetId: 'asset_estate', type: 'expand_farmland', host: { actorType: 'player', actorId: 'player_test' },
    });
    expect(result.ok).toBe(true);
    expect(result.project?.targetDelta?.mu).toBeGreaterThan(0);
    expect(result.state.resources!.money).toBeLessThan(state.resources!.money);
    expect(result.state.resources!.grain).toBeLessThan(state.resources!.grain);
    expect(result.state.privateAssets?.[0].mu).toBe(100);
  });

  it('only accepts the registered on-site manager as an NPC actor', () => {
    const state = makeState();
    const accepted = startPrivateAssetManagementProject(state, {
      assetId: 'asset_estate', type: 'recruit_tenants', host: { actorType: 'npc', actorId: 'npc_manager' },
    });
    expect(accepted.ok).toBe(true);

    const absent = makeState();
    absent.npcs![0].locationId = 'loc_elsewhere';
    const rejected = startPrivateAssetManagementProject(absent, {
      assetId: 'asset_estate', type: 'recruit_tenants', host: { actorType: 'npc', actorId: 'npc_manager' },
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain('不在产业所在地');
  });

  it('repairs a damaged asset on completion and supports cancellation without refunds', () => {
    const state = makeState(makeAsset({ status: 'damaged' }));
    const started = startPrivateAssetManagementProject(state, {
      assetId: 'asset_estate', type: 'repair', host: { actorType: 'player', actorId: 'player_test' },
    });
    expect(started.ok).toBe(true);
    const completed = completeDuePrivateAssetProjects({
      currentDate: started.project!.expectedCompleteAt!,
      privateAssets: started.state.privateAssets!,
      projects: started.state.privateAssetProjects!,
    });
    expect(completed.nextPrivateAssets[0].status).toBe('active');
    expect(completed.nextProjects[0].status).toBe('completed');

    const second = startPrivateAssetManagementProject(makeState(), {
      assetId: 'asset_estate', type: 'expand_farmland', host: { actorType: 'player', actorId: 'player_test' },
    });
    const moneyAfterStart = second.state.resources!.money;
    const cancelled = cancelPrivateAssetManagementProject(second.state, second.project!.projectId);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state.privateAssetProjects?.[0].status).toBe('cancelled');
    expect(cancelled.state.resources!.money).toBe(moneyAfterStart);
  });
});
