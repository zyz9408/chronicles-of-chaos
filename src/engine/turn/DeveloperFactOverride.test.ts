import { describe, expect, it, vi } from 'vitest';
import type { LlmClient, LlmGenerateRequest } from '../llm/LlmClient';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import {
  executeDeveloperFactOverride,
  parseDeveloperCommandInput,
} from './DeveloperFactOverride';

const apiConfig: ApiConfigArchive = {
  id: 'dev-primary',
  name: 'Developer override test',
  provider: 'openai_compatible',
  baseUrl: 'https://example.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook_ThreeKingdoms.manifest.id,
    worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
    worldBookSource: 'official',
    startDate: '公元184年03月01日',
    currentDate: '公元184年03月01日',
    player: {
      id: 'player_1',
      name: '林砚',
      roleType: 'officer',
      summary: '测试角色',
    },
    currentLocationId: 'place_jingzhou_xinye',
    currentPlaceId: 'place_jingzhou_xinye',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
  });
}

function responseWithPatches(statePatches: unknown[], narrativeText = '已修正府库粮草。'): string {
  return JSON.stringify({
    narrativeText,
    suggestedActions: [],
    ordinaryChecks: [],
    statePatches,
    statePatch: null,
  });
}

describe('parseDeveloperCommandInput', () => {
  it('only recognizes an exact case-insensitive /dev prefix followed by whitespace', () => {
    expect(parseDeveloperCommandInput('去官舍休息')).toEqual({ kind: 'normal' });
    expect(parseDeveloperCommandInput(' /DEV 府库粮草应该是2000石')).toEqual({
      kind: 'developer',
      fact: '府库粮草应该是2000石',
    });
    expect(parseDeveloperCommandInput('/dev')).toMatchObject({ kind: 'invalid' });
    expect(parseDeveloperCommandInput('/developer 改数据')).toMatchObject({ kind: 'invalid' });
    expect(parseDeveloperCommandInput('/dev府库粮草')).toMatchObject({ kind: 'invalid' });
  });
});

describe('executeDeveloperFactOverride', () => {
  it('applies a valid minimal patch without advancing time or appending a turn', async () => {
    const state = makeState();
    const client: LlmClient = {
      generate: vi.fn(async (_request: LlmGenerateRequest) => ({
        content: responseWithPatches([{
          type: 'luanshiCommand',
          reason: 'authorized developer fact',
          payload: {
            command: {
              action: 'updateResourceLedger',
              grain: 2000,
              summary: '开发者纠错：府库粮草为2000石',
            },
          },
        }]),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeDeveloperFactOverride({
      worldBook: worldBook_ThreeKingdoms,
      runtimeState: state,
      fact: '府库粮草应该是2000石',
      llmClient: client,
      resolvePrimaryConfig: async () => apiConfig,
      resolveFallbackConfig: async () => null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.state.resources?.grain).toBe(2000);
    expect(result.state.currentDate).toBe(state.currentDate);
    expect(result.state.currentTime).toEqual(state.currentTime);
    expect(result.state.turnLog).toHaveLength(0);
  });

  it('rejects time, memory and partial invalid outputs instead of applying the valid subset', async () => {
    const state = makeState();
    const client: LlmClient = {
      generate: vi.fn(async () => ({
        content: responseWithPatches([
          {
            type: 'luanshiCommand',
            reason: 'authorized developer fact',
            payload: { command: { action: 'updateResourceLedger', grain: 2000 } },
          },
          {
            type: 'timeAdvance',
            reason: 'forbidden side effect',
            payload: { hoursAdvanced: 1 },
          },
        ]),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const result = await executeDeveloperFactOverride({
      worldBook: worldBook_ThreeKingdoms,
      runtimeState: state,
      fact: '府库粮草应该是2000石',
      llmClient: client,
      resolvePrimaryConfig: async () => apiConfig,
      resolveFallbackConfig: async () => null,
    });

    expect(result).toMatchObject({ ok: false, reason: '开发者纠错不得推进游戏时间。' });
    expect(state.resources?.grain).not.toBe(2000);
  });

  it('uses the configured fallback after an invalid primary response', async () => {
    const state = makeState();
    const generate = vi.fn()
      .mockResolvedValueOnce({ content: 'not-json', provider: 'openai_compatible' as const, model: 'primary' })
      .mockResolvedValueOnce({
        content: responseWithPatches([{
          type: 'luanshiCommand',
          reason: 'authorized developer fact',
          payload: { command: { action: 'updateResourceLedger', grain: 2000 } },
        }]),
        provider: 'openai_compatible' as const,
        model: 'fallback',
      });
    const result = await executeDeveloperFactOverride({
      worldBook: worldBook_ThreeKingdoms,
      runtimeState: state,
      fact: '府库粮草应该是2000石',
      llmClient: { generate },
      resolvePrimaryConfig: async () => apiConfig,
      resolveFallbackConfig: async () => ({ ...apiConfig, id: 'dev-fallback', model: 'fallback' }),
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: true, usedFallback: true });
  });

  it('promotes only the civil scale needed for an authorized large-city cadastral correction', async () => {
    const state = makeState();
    state.holdings = [{
      holdingId: 'holding_wancheng',
      name: '宛城',
      type: 'city',
      status: 'controlled',
      summary: '玩家控制的南阳郡治。',
      locationId: 'place_nanyang_wan',
      civilAdministrationScope: 'territorial',
      civilScaleLevel: 2,
      scaleLevel: 2,
      agriculture: 70,
      commerce: 72,
      population: 80,
      publicOrder: 60,
      popularSupport: 58,
      defense: 65,
      recruitPotential: 55,
      armory: 50,
      horseSupply: 25,
      corruption: 30,
      farmlandMu: 60_000,
      registeredHouseholds: 5_000,
      updatedAt: '公元184年03月01日',
    }];
    const client: LlmClient = {
      generate: vi.fn(async () => ({
        content: responseWithPatches([{
          type: 'luanshiCommand',
          reason: 'authorized developer fact',
          payload: {
            command: {
              action: 'upsertHoldingLedger',
              operation: 'update',
              holdingId: 'holding_wancheng',
              name: '宛城',
              type: 'city',
              status: 'controlled',
              summary: '玩家控制的南阳郡治，田亩已按清册纠正。',
              locationId: 'place_nanyang_wan',
              civilAdministrationScope: 'territorial',
              civilScaleLevel: 2,
              scaleLevel: 2,
              agriculture: 70,
              commerce: 72,
              population: 80,
              publicOrder: 60,
              popularSupport: 58,
              defense: 65,
              recruitPotential: 55,
              armory: 50,
              horseSupply: 25,
              corruption: 30,
              farmlandMu: 1_200_000,
              registeredHouseholds: 90_000,
              updatedAt: '公元184年03月01日',
            },
          },
        }], '已按清册修正宛城田亩与编户。'),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeDeveloperFactOverride({
      worldBook: worldBook_ThreeKingdoms,
      runtimeState: state,
      fact: '宛城账面田亩应为1200000亩，编户应为90000户',
      llmClient: client,
      resolvePrimaryConfig: async () => apiConfig,
      resolveFallbackConfig: async () => null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.holdings?.[0]).toMatchObject({
      holdingId: 'holding_wancheng',
      civilScaleLevel: 5,
      farmlandMu: 1_200_000,
      registeredHouseholds: 90_000,
    });
  });
});
