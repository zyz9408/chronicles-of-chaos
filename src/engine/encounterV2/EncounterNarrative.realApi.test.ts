import { describe, expect, it } from 'vitest';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { verifyEncounterResultHash } from './EncounterDeterminism';
import { generateWarNarrative } from './EncounterNarrative';
import { createInitialWarState, createSealedWarResult, executeWarRound } from './WarEngine';
import { createWarEncounterSnapshot } from './WarSnapshotAdapter';
import { makeTroopProfile, makeWarCommander, makeWarIntent, makeWarTroop } from './WarTestFixtures';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_REAL_API_SMOKE === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`真实 API 冒烟缺少环境变量 ${name}。`);
  return value;
}

function makeSealedWarResult() {
  const playerTroop = makeWarTroop('troop_real_api_player', {
    name: '荆州主力营',
    size: 4_000,
    morale: 90,
    training: 90,
  });
  const enemyTroop = makeWarTroop('troop_real_api_enemy', {
    name: '新野守军',
    size: 100,
    morale: 20,
    training: 30,
  });
  const intent = makeWarIntent([playerTroop.troopId], [enemyTroop.troopId]);
  intent.encounterId = 'encounter_war_real_api_smoke';
  intent.seed = 'war-real-api-smoke-seed';
  const snapshot = createWarEncounterSnapshot({
    sessionId: 'session_war_real_api_smoke',
    intent,
    playerTroops: [playerTroop],
    enemyTroops: [enemyTroop],
    playerCommander: makeWarCommander('player_liuping'),
    enemyCommander: makeWarCommander('npc_enemy_commander'),
    projections: {
      profiles: [
        makeTroopProfile(playerTroop.troopId, 'infantry', ['assault']),
        makeTroopProfile(enemyTroop.troopId, 'infantry', ['defensive']),
      ],
    },
  });
  let state = createInitialWarState(snapshot);
  while (state.phase === 'awaiting_round') {
    state = executeWarRound(state, {
      player: { type: 'tactic', tactic: 'all_out_assault' },
      enemy: { type: 'tactic', tactic: 'hold_position' },
    });
  }
  return createSealedWarResult(state, '2026-07-20T10:00:00.000Z');
}

describe.skipIf(!REAL_API_ENABLED)('Encounter V2 real API result-only smoke', () => {
  it('turns a sealed WarResult into prose without changing any deterministic field', async () => {
    const result = makeSealedWarResult();
    const before = structuredClone(result);
    const config: ApiConfigArchive = {
      id: 'api_real_smoke',
      name: 'Batch 5 真实 API 冒烟',
      provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
      baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
      apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
      model: requireEnvironment('COC_V2_TEST_API_MODEL'),
      temperature: 0.4,
      maxOutputTokens: 900,
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: '2026-07-20T10:00:00.000Z',
    };

    const generated = await generateWarNarrative({
      config,
      client: new BrowserLlmClient(),
      prompt: {
        result,
        encounterReason: '新野水门攻防战',
        locationLabel: '荆州 - 南阳郡 - 新野水门',
        forceNames: {
          troop_real_api_player: '荆州主力营',
          troop_real_api_enemy: '新野守军',
        },
        commanderNames: {
          player_liuping: '刘平',
          npc_enemy_commander: '张绣',
        },
        recentNarratives: ['两军已经在水门前列阵。'],
      },
    });

    expect(generated.narrativeText.trim().length).toBeGreaterThan(40);
    expect(generated.suggestedActions.length).toBeLessThanOrEqual(8);
    expect(result).toEqual(before);
    expect(verifyEncounterResultHash(result)).toBe(true);
  }, 240_000);
});
