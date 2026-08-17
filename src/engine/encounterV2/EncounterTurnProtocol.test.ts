import { describe, expect, it } from 'vitest';
import { parseNarratorResponse } from '../turn/NarratorResponseParser';
import { buildTurnOutputRequirements } from '../turn/TurnPromptMessages';
import { quarantineEncounterTriggerResultPatches } from '../turn/TurnOrchestrator';
import type { StatePatch } from '../types';
import {
  makeCombatIntent,
  makeTraitProfile,
} from './CombatTestFixtures';
import { makeTroopProfile, makeWarIntent } from './WarTestFixtures';

describe('Combat V2 main-turn protocol', () => {
  it('accepts a validated start intent and semantic projections from structured writeback', () => {
    const intent = makeCombatIntent();
    const profile = makeTraitProfile('trait_calm');
    const response = parseNarratorResponse(JSON.stringify({
      narrativeText: '【旁白】双方已拔刃相向，胜负尚未裁定。',
      suggestedActions: [],
      statePatches: [],
      writeback: {
        encounterStartIntent: intent,
        semanticProjections: [profile],
      },
    }));

    expect(response.writeback?.encounterStartIntent).toEqual(intent);
    expect(response.writeback?.semanticProjections).toEqual([profile]);
  });

  it('keeps start, offer, and none decisions consistent with encounter authority', () => {
    const intent = makeCombatIntent();
    const start = parseNarratorResponse(JSON.stringify({
      narrativeText: '【旁白】长刀已经劈落。',
      suggestedActions: [],
      statePatches: [],
      writeback: {
        encounterTransitionDecision: { mode: 'start', reason: '兵刃已经挥出' },
        encounterStartIntent: intent,
      },
    }));
    expect(start.writeback?.encounterTransitionDecision?.mode).toBe('start');
    expect(start.writeback?.encounterStartIntent).toEqual(intent);

    const offer = parseNarratorResponse(JSON.stringify({
      narrativeText: '【旁白】双方拔刀对峙，仍可退让。',
      suggestedActions: [],
      statePatches: [],
      writeback: {
        encounterTransitionDecision: { mode: 'offer', reason: '仍可决定是否交锋' },
        encounterStartIntent: intent,
      },
    }));
    expect(offer.writeback?.encounterTransitionDecision?.mode).toBe('offer');
    expect(offer.writeback?.encounterStartIntent).toEqual(intent);

    const none = parseNarratorResponse(JSON.stringify({
      narrativeText: '【旁白】远处传来交战消息。',
      suggestedActions: [],
      statePatches: [],
      writeback: {
        encounterTransitionDecision: { mode: 'none', reason: '只是远场传闻' },
        encounterStartIntent: intent,
      },
    }));
    expect(none.writeback?.encounterTransitionDecision?.mode).toBe('none');
    expect(none.writeback?.encounterStartIntent).toBeNull();
    expect(none.writeback?.debugNotes).toContain(
      'Encounter V2 切入决定为 none，已拒绝同时返回的开战意图。',
    );
  });

  it('drops malformed encounter authority instead of trusting arbitrary JSON', () => {
    const intent = makeCombatIntent();
    intent.enemyParty.actorIds = [...intent.playerParty.actorIds];
    const response = parseNarratorResponse(JSON.stringify({
      narrativeText: '【旁白】有人试图伪造战斗触发。',
      suggestedActions: [],
      statePatches: [],
      writeback: { encounterStartIntent: intent },
    }));

    expect(response.writeback?.encounterStartIntent).toBeNull();
    expect(response.writeback?.debugNotes).toEqual([
      expect.stringContaining('Encounter V2 触发被本地拒绝'),
    ]);
  });

  it('normalizes model-authored encounter audit metadata to local turn authority', () => {
    const intent = makeCombatIntent();
    intent.createdAt = '兴平元年五月初三';
    intent.sourceTurnNumber = 0;
    const localCreatedAt = '2026-07-20T12:00:00.000Z';
    const localSourceTurnNumber = 41;
    const response = parseNarratorResponse(JSON.stringify({
      narrativeText: '【旁白】双方已拔刃相向。',
      suggestedActions: [],
      statePatches: [],
      writeback: { encounterStartIntent: intent },
    }), {
      encounterIntentCreatedAt: localCreatedAt,
      encounterIntentSourceTurnNumber: localSourceTurnNumber,
    });

    expect(response.writeback?.encounterStartIntent?.createdAt).toBe(localCreatedAt);
    expect(response.writeback?.encounterStartIntent?.sourceTurnNumber).toBe(localSourceTurnNumber);
    expect(response.writeback?.debugNotes).toContain(
      'Encounter V2 createdAt 已由本地回合时间规范化。',
    );
    expect(response.writeback?.debugNotes).toContain(
      'Encounter V2 sourceTurnNumber 已由本地回合序号规范化。',
    );
  });

  it('keeps valid projections and reports each rejected projection instead of dropping it silently', () => {
    const valid = makeTraitProfile('trait_valid');
    const response = parseNarratorResponse(JSON.stringify({
      narrativeText: '【旁白】双方已经交锋。',
      suggestedActions: [],
      statePatches: [],
      writeback: {
        semanticProjections: [valid, {
          profileKind: 'ability',
          sourceId: 'trait_invalid',
          status: 'executable',
          rulesetScopes: ['personal_combat'],
          effects: [],
          sourceType: 'trait',
          activation: 'active',
        }],
      },
    }));

    expect(response.writeback?.semanticProjections).toEqual([valid]);
    expect(response.writeback?.debugNotes).toEqual([
      expect.stringContaining('trait_invalid 被本地拒绝'),
    ]);
  });

  it('tells the main narrator to stop before outcome and never emit a V1 combat result in the trigger turn', () => {
    const requirements = buildTurnOutputRequirements();
    expect(requirements).toContain('encounterTransitionDecision');
    expect(requirements).toContain('scopedCombatants');
    expect(requirements).toContain('同伴或敌人');
    expect(requirements).toContain('encounterStartIntent');
    expect(requirements).toContain('不得裁定胜负');
    expect(requirements).toContain('不得写入 upsertCombatRecord');
  });

  it('quarantines a legacy combat result patch when the same turn starts Combat V2', () => {
    const timeAdvance = {
      type: 'timeAdvance',
      payload: { minutesAdvanced: 15, reason: '双方拔刃相向' },
      reason: '冲突发生前时间经过',
    } as StatePatch;
    const prematureResult = {
      type: 'luanshiCommand',
      payload: { command: { action: 'upsertCombatRecord', combatId: 'combat_should_not_commit' } },
      reason: '主叙事提前裁定战果',
    } as StatePatch;

    const guarded = quarantineEncounterTriggerResultPatches(
      [timeAdvance, prematureResult],
      makeCombatIntent(),
    );

    expect(guarded.removedCount).toBe(1);
    expect(guarded.patches).toEqual([timeAdvance]);
  });
});

describe('War V2 main-turn protocol', () => {
  it('accepts a validated war start intent and troop projections', () => {
    const intent = makeWarIntent();
    const profile = makeTroopProfile('troop_player_infantry', 'infantry');
    const response = parseNarratorResponse(JSON.stringify({
      narrativeText: '【旁白】两军已列阵，战果尚未裁定。',
      suggestedActions: [],
      statePatches: [],
      writeback: { encounterStartIntent: intent, semanticProjections: [profile] },
    }));
    expect(response.writeback?.encounterStartIntent).toEqual(intent);
    expect(response.writeback?.semanticProjections).toEqual([profile]);
  });

  it('documents the direct-command war boundary and stable holding target', () => {
    const requirements = buildTurnOutputRequirements();
    expect(requirements).toContain('kind:"war"');
    expect(requirements).toContain('targetHoldingId');
    expect(requirements).toContain('同响应 statePatches');
    expect(requirements).toContain('upsertHoldingLedger / upsertTroopLedger');
    expect(requirements).toContain('禁止按名称或正文猜孤立 ID');
    expect(requirements).toContain('不得写入 upsertConflictRecord');
    expect(requirements).toContain('远场战争');
  });

  it('quarantines only the legacy conflict result when the same turn starts War V2', () => {
    const timeAdvance = {
      type: 'timeAdvance',
      payload: { minutesAdvanced: 15, reason: '两军列阵' },
      reason: '冲突发生前时间经过',
    } as StatePatch;
    const prematureConflict = {
      type: 'luanshiCommand',
      payload: { command: { action: 'upsertConflictRecord', conflictId: 'conflict_should_not_commit' } },
      reason: '主叙事提前裁定战争',
    } as StatePatch;
    const unrelatedCombat = {
      type: 'luanshiCommand',
      payload: { command: { action: 'upsertCombatRecord', combatId: 'historical_personal_combat' } },
      reason: '另一项已完成个人战记录',
    } as StatePatch;
    const guarded = quarantineEncounterTriggerResultPatches(
      [timeAdvance, prematureConflict, unrelatedCombat],
      makeWarIntent(),
    );
    expect(guarded.removedCount).toBe(1);
    expect(guarded.patches).toEqual([timeAdvance, unrelatedCombat]);
  });
});
