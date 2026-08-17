import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { makeHealingItemProfile } from '../encounterV2/CombatTestFixtures';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import {
  previewPlayerRestorativeItemUse,
  applyPlayerRestorativeItemUse,
} from './PlayerRestorativeItemRuntime';

function makeState(overrides: {
  hp?: number;
  stamina?: number;
  quantity?: number;
  profiles?: RuntimeState['encounterV2'];
} = {}): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '公元194年05月03日 08:00（辰时）',
    currentDate: '公元194年05月03日 08:00（辰时）',
    player: {
      id: 'player',
      name: '刘平',
      roleType: '将领',
      summary: '测试主角。',
      vitals: {
        hp: overrides.hp ?? 40,
        maxHp: 100,
        stamina: overrides.stamina ?? 50,
        maxStamina: 100,
      },
      inventory: [{
        id: 'item_medicine',
        name: '金创药',
        quantity: overrides.quantity ?? 2,
        category: 'consumable',
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
    turnLog: [],
    localSituationNotes: [],
    encounterV2: overrides.profiles ?? {
      semanticProjections: [makeHealingItemProfile('item_medicine')],
      appliedResultHashes: [],
      narratedResultHashes: [],
    },
  });
}

describe('PlayerRestorativeItemRuntime', () => {
  it('restores hp locally and decrements the exact inventory item without advancing a turn', () => {
    const state = makeState();
    const result = applyPlayerRestorativeItemUse(state, 'item_medicine');

    expect(result.applied).toBe(true);
    expect(result.state).not.toBe(state);
    expect(result.state.player.vitals).toMatchObject({ hp: 60, stamina: 50 });
    expect(result.state.player.inventory).toEqual([
      expect.objectContaining({ id: 'item_medicine', quantity: 1 }),
    ]);
    expect(result.state.currentDate).toBe(state.currentDate);
    expect(result.state.turnLog).toEqual(state.turnLog);
    expect(result.summary).toContain('生命 40→60');
    expect(state.player.vitals?.hp).toBe(40);
    expect(state.player.inventory?.[0]?.quantity).toBe(2);
  });

  it('removes a consumed stack at zero and allows a healing item to recover from zero hp', () => {
    const state = makeState({ hp: 0, quantity: 1 });
    const result = applyPlayerRestorativeItemUse(state, 'item_medicine');

    expect(result.applied).toBe(true);
    expect(result.state.player.vitals?.hp).toBe(20);
    expect(result.state.player.inventory).toEqual([]);
    expect(result.summary).toContain('物品已用尽');
  });

  it('applies structured hp and stamina effects with local maximum clamping', () => {
    const profile = makeHealingItemProfile('item_medicine');
    profile.effects = [
      { ...profile.effects[0], operation: 'restore_hp', value: 20, priority: 20 },
      { ...profile.effects[0], operation: 'restore_stamina', value: 20, priority: 30 },
    ];
    const state = makeState({
      hp: 90,
      stamina: 80,
      profiles: {
        semanticProjections: [profile],
        appliedResultHashes: [],
        narratedResultHashes: [],
      },
    });
    const result = applyPlayerRestorativeItemUse(state, 'item_medicine');

    expect(result.state.player.vitals).toMatchObject({ hp: 100, stamina: 100 });
    expect(result.preview).toMatchObject({ hpRestore: 10, staminaRestore: 20 });
  });

  it('does not consume an item when all supported vitals are already full', () => {
    const state = makeState({ hp: 100, stamina: 100 });
    const result = applyPlayerRestorativeItemUse(state, 'item_medicine');

    expect(result.applied).toBe(false);
    expect(result.state).toBe(state);
    expect(result.preview.blockReason).toBe('already_full');
    expect(result.state.player.inventory?.[0]?.quantity).toBe(2);
  });

  it('does not infer recovery from an item name when the structured profile is absent', () => {
    const state = makeState({
      profiles: {
        semanticProjections: [],
        appliedResultHashes: [],
        narratedResultHashes: [],
      },
    });
    const preview = previewPlayerRestorativeItemUse(state, 'item_medicine');

    expect(preview).toMatchObject({
      hasRestorativeUse: false,
      canUse: false,
      blockReason: 'profile_missing',
    });
  });

  it('routes item use through Combat V2 while an encounter is active', () => {
    const state = makeState();
    state.encounterV2 = {
      ...state.encounterV2!,
      active: {} as NonNullable<RuntimeState['encounterV2']>['active'],
    };
    const result = applyPlayerRestorativeItemUse(state, 'item_medicine');

    expect(result.applied).toBe(false);
    expect(result.preview).toMatchObject({
      hasRestorativeUse: true,
      blockReason: 'active_encounter',
    });
    expect(result.state.player.inventory?.[0]?.quantity).toBe(2);
  });

  it('keeps mixed or non-self combat items inside Combat V2 instead of partially applying them', () => {
    const profile = makeHealingItemProfile('item_medicine');
    profile.effects.push({
      trigger: 'before_action',
      condition: 'always',
      operation: 'apply_status',
      target: 'self',
      value: 1,
      priority: 30,
      statusId: 'fortified',
    });
    const state = makeState({
      profiles: {
        semanticProjections: [profile],
        appliedResultHashes: [],
        narratedResultHashes: [],
      },
    });
    const preview = previewPlayerRestorativeItemUse(state, 'item_medicine');

    expect(preview).toMatchObject({
      hasRestorativeUse: false,
      canUse: false,
      blockReason: 'profile_not_restorative',
    });
  });
});
