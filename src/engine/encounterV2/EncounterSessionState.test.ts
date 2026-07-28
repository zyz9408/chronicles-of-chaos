import { describe, expect, it } from 'vitest';
import {
  COMBAT_RULESET_VERSION,
  ENCOUNTER_CONTRACT_VERSION,
  ENCOUNTER_SAVE_POLICY,
  ENCOUNTER_SIDE_LAYOUT,
  type EncounterStartIntent,
  type UnsealedCombatResult,
} from './EncounterContracts';
import {
  EncounterStateTransitionError,
  abortEncounterBeforeResult,
  beginEncounterSession,
  createPendingEncounterSession,
  createPostEncounterResultCheckpoint,
  createPreEncounterCheckpoint,
  markEncounterNarrated,
  markEncounterNarrativePending,
  resolveEncounterSession,
  resolveEncounterCheckpointResumeAction,
} from './EncounterSessionState';

function createIntent(): EncounterStartIntent {
  return {
    contractVersion: ENCOUNTER_CONTRACT_VERSION,
    encounterId: 'encounter_state_001',
    kind: 'personal_combat',
    rulesetVersion: COMBAT_RULESET_VERSION,
    sourceTurnNumber: 29,
    locationId: 'location_hanshui_camp',
    reason: '状态机测试冲突。',
    seed: 'encounter_state_001:seed',
    createdAt: '2026-07-20T00:00:00.000Z',
    playerParty: { actorIds: ['player_liuping'] },
    enemyParty: { actorIds: ['npc_enemy_guard'] },
    partySelection: 'locked',
    policy: {
      lethality: 'standard',
      allowRetreat: true,
      allowSurrender: false,
      allowCapture: false,
      lootPolicy: 'actual_items_only',
    },
  };
}

function createResult(): UnsealedCombatResult {
  return {
    contractVersion: ENCOUNTER_CONTRACT_VERSION,
    sessionId: 'session_state_001',
    encounterId: 'encounter_state_001',
    kind: 'personal_combat',
    rulesetVersion: COMBAT_RULESET_VERSION,
    sourceTurnNumber: 29,
    seed: 'encounter_state_001:seed',
    resolvedAt: '2026-07-20T00:15:00.000Z',
    outcome: 'player_victory',
    elapsedMinutes: 15,
    actionLog: [],
    deltas: [],
    combatants: [
      { actorId: 'player_liuping', side: 'player', hp: 100, stamina: 80, downCount: 0, statuses: [] },
      { actorId: 'npc_enemy_guard', side: 'enemy', hp: 0, stamina: 20, downCount: 1, statuses: ['downed'] },
    ],
    experienceAward: 30,
    lootItemIds: [],
    capturedEquipmentItemIds: [],
  };
}

function createPending() {
  return createPendingEncounterSession({
    sessionId: 'session_state_001',
    intent: createIntent(),
    snapshotHash: 'fnv1a64:0123456789abcdef',
    createdAt: '2026-07-20T00:00:00.000Z',
  });
}

describe('EncounterSessionState', () => {
  it('follows the only successful state path and preserves a single result hash', () => {
    const pending = createPending();
    const fighting = beginEncounterSession(pending, '2026-07-20T00:01:00.000Z');
    const resolved = resolveEncounterSession(fighting, createResult(), '2026-07-20T00:15:00.000Z');
    const narrativePending = markEncounterNarrativePending(resolved, '2026-07-20T00:15:01.000Z');
    const narrated = markEncounterNarrated(narrativePending, '2026-07-20T00:16:00.000Z');

    expect([pending.status, fighting.status, resolved.status, narrativePending.status, narrated.status]).toEqual([
      'pending',
      'fighting',
      'resolved',
      'narrative_pending',
      'narrated',
    ]);
    expect(resolved.result?.resultHash).toBe(narrativePending.result?.resultHash);
    expect(narrativePending.result?.resultHash).toBe(narrated.result?.resultHash);
  });

  it('rejects skipped, repeated and post-result abort transitions', () => {
    const pending = createPending();
    expect(() => markEncounterNarrativePending(pending, '2026-07-20T00:01:00.000Z')).toThrow(EncounterStateTransitionError);
    const fighting = beginEncounterSession(pending, '2026-07-20T00:01:00.000Z');
    expect(() => beginEncounterSession(fighting, '2026-07-20T00:02:00.000Z')).toThrow(EncounterStateTransitionError);
    const resolved = resolveEncounterSession(fighting, createResult(), '2026-07-20T00:15:00.000Z');
    expect(() => abortEncounterBeforeResult(resolved, '2026-07-20T00:16:00.000Z')).toThrow(EncounterStateTransitionError);
  });

  it('rejects a result from a different session or seed', () => {
    const fighting = beginEncounterSession(createPending(), '2026-07-20T00:01:00.000Z');
    const wrongSession = { ...createResult(), sessionId: 'session_other' };
    const wrongSeed = { ...createResult(), seed: 'different-seed' };

    expect(() => resolveEncounterSession(fighting, wrongSession, '2026-07-20T00:15:00.000Z')).toThrow('sessionId');
    expect(() => resolveEncounterSession(fighting, wrongSeed, '2026-07-20T00:15:00.000Z')).toThrow('seed');
  });

  it('rejects a result whose participant ledger differs from the frozen start intent', () => {
    const fighting = beginEncounterSession(createPending(), '2026-07-20T00:01:00.000Z');
    const wrongParticipants = createResult();
    wrongParticipants.combatants[1].actorId = 'npc_replacement_guard';

    expect(() => resolveEncounterSession(fighting, wrongParticipants, '2026-07-20T00:15:00.000Z'))
      .toThrow('敌方 actorId');
  });

  it('allows abort only before a result exists', () => {
    const pending = createPending();
    const pendingAbort = abortEncounterBeforeResult(pending, '2026-07-20T00:00:30.000Z');
    const fighting = beginEncounterSession(createPending(), '2026-07-20T00:01:00.000Z');
    const fightingAbort = abortEncounterBeforeResult(fighting, '2026-07-20T00:02:00.000Z');

    expect(pendingAbort.status).toBe('aborted_before_result');
    expect(fightingAbort.status).toBe('aborted_before_result');
    expect(pendingAbort.result).toBeUndefined();
  });

  it('creates only pre-encounter and post-result checkpoints', () => {
    const pending = createPending();
    const pre = createPreEncounterCheckpoint(pending, {
      checkpointId: 'checkpoint_pre_001',
      saveId: 'save_001',
      createdAt: '2026-07-20T00:00:00.000Z',
    });
    const fighting = beginEncounterSession(pending, '2026-07-20T00:01:00.000Z');
    const resolved = resolveEncounterSession(fighting, createResult(), '2026-07-20T00:15:00.000Z');
    const post = createPostEncounterResultCheckpoint(resolved, {
      checkpointId: 'checkpoint_post_001',
      saveId: 'save_001',
      createdAt: '2026-07-20T00:15:01.000Z',
    });

    expect(pre.checkpointKind).toBe('pre_encounter');
    expect(post.checkpointKind).toBe('post_result');
    expect(resolveEncounterCheckpointResumeAction(pre)).toBe('restart_encounter');
    expect(resolveEncounterCheckpointResumeAction(post)).toBe('retry_narrative');
    expect(() => createPreEncounterCheckpoint(fighting, {
      checkpointId: 'checkpoint_invalid',
      saveId: 'save_001',
      createdAt: '2026-07-20T00:02:00.000Z',
    })).toThrow(EncounterStateTransitionError);
  });

  it('locks the no-mid-encounter-save policy', () => {
    expect(ENCOUNTER_SAVE_POLICY).toEqual({
      allowMidEncounterSave: false,
      allowPreEncounterCheckpoint: true,
      allowPostResultCheckpoint: true,
    });
    expect(Object.isFrozen(ENCOUNTER_SAVE_POLICY)).toBe(true);
  });

  it('locks the shared battlefield orientation to enemy-left and player-right', () => {
    expect(ENCOUNTER_SIDE_LAYOUT).toEqual({ enemy: 'left', player: 'right' });
    expect(Object.isFrozen(ENCOUNTER_SIDE_LAYOUT)).toBe(true);
  });
});
