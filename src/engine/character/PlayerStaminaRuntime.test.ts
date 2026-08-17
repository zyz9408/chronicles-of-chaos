import { describe, expect, it } from 'vitest';
import type { ActionIntent, RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { applyPlayerStaminaAfterTurn } from './PlayerStaminaRuntime';
import type { PlayerRecoveryKind } from './PlayerRecoveryContracts';

function makeState(stamina: number, currentDate = '公元194年05月03日 08:00（辰时）'): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: currentDate,
    currentDate,
    player: {
      id: 'player',
      name: '刘平',
      roleType: '将领',
      summary: '测试主角。',
      vitals: { hp: 100, maxHp: 100, stamina, maxStamina: 100 },
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
      turnNumber: 1,
      date: currentDate,
      playerInput: '测试行动',
      narrativeText: '测试正文。',
      statePatchSummary: '时间推进',
      timestamp: '2026-07-18T00:00:00.000Z',
    }],
    localSituationNotes: [],
  });
}

function apply(input: {
  stamina: number;
  playerInput: string;
  actionIntent: ActionIntent;
  beforeDate?: string;
  afterDate?: string;
  recoveryKind?: PlayerRecoveryKind;
}) {
  const before = makeState(input.stamina, input.beforeDate);
  const after = makeState(input.stamina, input.afterDate ?? input.beforeDate);
  return applyPlayerStaminaAfterTurn(after, {
    previousState: before,
    playerInput: input.playerInput,
    actionIntent: input.actionIntent,
    recoveryKind: input.recoveryKind ?? 'none',
  });
}

describe('PlayerStaminaRuntime', () => {
  it('consumes meaningful stamina for combat and records the local settlement', () => {
    const result = apply({ stamina: 100, playerInput: '拔刀迎战，亲自杀入敌阵', actionIntent: 'combat' });

    expect(result.state.player.vitals?.stamina).toBe(90);
    expect(result.adjustment).toMatchObject({ delta: -10, category: 'combat' });
    expect(result.state.turnLog[result.state.turnLog.length - 1]?.statePatchSummary).toContain('体力 100→90（战斗消耗）');
  });

  it('charges sustained intimate activity without treating affectionate conversation as the same intensity', () => {
    const strenuous = apply({ stamina: 100, playerInput: '变换体位后入继续欢爱', actionIntent: 'other' });
    const affectionate = apply({ stamina: 100, playerInput: '相拥温存，听听她的心里话', actionIntent: 'other' });

    expect(strenuous.state.player.vitals?.stamina).toBe(94);
    expect(strenuous.adjustment?.category).toBe('intimacy');
    expect(affectionate.state.player.vitals?.stamina).toBe(99);
    expect(affectionate.adjustment?.category).toBe('ordinary');
  });

  it('restores stamina for explicit sleep according to elapsed game time and caps at max stamina', () => {
    const partial = apply({
      stamina: 30,
      playerInput: '安睡一夜，好好休息',
      actionIntent: 'rest',
      recoveryKind: 'rest',
      beforeDate: '公元194年05月03日 22:00（亥时）',
      afterDate: '公元194年05月04日 06:00（卯时）',
    });
    const capped = apply({
      stamina: 80,
      playerInput: '休养一整日',
      actionIntent: 'rest',
      recoveryKind: 'rest',
      beforeDate: '公元194年05月03日 08:00（辰时）',
      afterDate: '公元194年05月04日 08:00（辰时）',
    });

    expect(partial.state.player.vitals?.stamina).toBe(78);
    expect(partial.adjustment).toMatchObject({ delta: 48, category: 'recovery' });
    expect(capped.state.player.vitals?.stamina).toBe(100);
  });

  it('restores a small amount of hp for a completed long rest without treating a short pause as healing', () => {
    const before = makeState(30, '公元194年05月03日 22:00（亥时）');
    before.player.vitals!.hp = 50;
    const after = makeState(30, '公元194年05月04日 06:00（卯时）');
    after.player.vitals!.hp = 50;
    const longRest = applyPlayerStaminaAfterTurn(after, {
      previousState: before,
      playerInput: '安睡一夜，好好休息',
      actionIntent: 'rest',
      recoveryKind: 'rest',
    });
    const shortPause = apply({ stamina: 30, playerInput: '休息片刻', actionIntent: 'rest' });

    expect(longRest.state.player.vitals).toMatchObject({ hp: 54, stamina: 78 });
    expect(longRest.healthAdjustment).toMatchObject({
      previousHp: 50,
      nextHp: 54,
      reason: '长时间休息恢复，480分钟',
    });
    expect(shortPause.healthAdjustment).toBeUndefined();
  });

  it('treats executed convalescence as recovery even when rough intent is interact and restores hp locally', () => {
    const before = makeState(20, '公元194年05月03日 08:00（辰时）');
    before.player.vitals!.hp = 0;
    const after = makeState(20, '公元194年05月03日 14:00（未时）');
    after.player.vitals!.hp = 0;

    const result = applyPlayerStaminaAfterTurn(after, {
      previousState: before,
      playerInput: '在营中静养半日，处理伤口',
      actionIntent: 'interact',
      recoveryKind: 'treatment',
    });

    expect(result.state.player.vitals).toMatchObject({ hp: 24, stamina: 56 });
    expect(result.adjustment?.category).toBe('recovery');
    expect(result.healthAdjustment).toMatchObject({ delta: 24, previousHp: 0, nextHp: 24 });
    expect(result.state.turnLog[result.state.turnLog.length - 1]?.statePatchSummary).toContain('生命 0→24（治疗休养恢复，360分钟）');
  });

  it('classifies direct treatment and natural sleep wording as recovery instead of ordinary activity', () => {
    const treatmentBefore = makeState(20, '公元194年05月03日 08:00（辰时）');
    treatmentBefore.player.vitals!.hp = 40;
    const treatmentAfter = makeState(20, '公元194年05月03日 10:00（巳时）');
    treatmentAfter.player.vitals!.hp = 40;
    const treatment = applyPlayerStaminaAfterTurn(treatmentAfter, {
      previousState: treatmentBefore,
      playerInput: '立即接受医者包扎伤口并卧床疗伤两小时',
      actionIntent: 'interact',
      recoveryKind: 'treatment',
    });
    const sleep = apply({
      stamina: 20,
      playerInput: '在安全客舍睡满八小时',
      actionIntent: 'other',
      recoveryKind: 'rest',
      beforeDate: '公元194年05月03日 22:00（亥时）',
      afterDate: '公元194年05月04日 06:00（卯时）',
    });

    expect(treatment.state.player.vitals).toMatchObject({ hp: 48, stamina: 32 });
    expect(treatment.adjustment?.category).toBe('recovery');
    expect(treatment.healthAdjustment?.delta).toBe(8);
    expect(sleep.state.player.vitals?.stamina).toBe(68);
    expect(sleep.adjustment?.category).toBe('recovery');
  });

  it('does not drain stamina for passive waiting and does not mistake battle discussion for combat', () => {
    const waiting = apply({ stamina: 55, playerInput: '静待斥候回报', actionIntent: 'rest' });
    const discussion = apply({ stamina: 55, playerInput: '询问徐庶应该如何迎战', actionIntent: 'inquire' });
    const intimateDiscussion = apply({ stamina: 55, playerInput: '询问她是否愿意同房', actionIntent: 'inquire' });
    const restDiscussion = apply({ stamina: 55, playerInput: '商议是否先休息一夜', actionIntent: 'interact' });
    const nonCombatItemUse = apply({
      stamina: 55,
      playerInput: '领取药品，说明此物可在非战斗时直接使用',
      actionIntent: 'other',
    });

    expect(waiting.state.player.vitals?.stamina).toBe(55);
    expect(waiting.adjustment).toBeUndefined();
    expect(discussion.state.player.vitals?.stamina).toBe(54);
    expect(discussion.adjustment?.category).toBe('ordinary');
    expect(intimateDiscussion.adjustment).toMatchObject({ delta: -1, category: 'ordinary' });
    expect(restDiscussion.adjustment).toMatchObject({ delta: -1, category: 'ordinary' });
    expect(nonCombatItemUse.adjustment).toMatchObject({ delta: -1, category: 'ordinary' });
  });

  it('scales travel with elapsed time and clamps exhaustion at zero', () => {
    const travel = apply({
      stamina: 100,
      playerInput: '策马赶往白鹭洲',
      actionIntent: 'move',
      beforeDate: '公元194年05月03日 08:00（辰时）',
      afterDate: '公元194年05月03日 14:00（未时）',
    });
    const exhausted = apply({ stamina: 4, playerInput: '继续挥刀厮杀', actionIntent: 'combat' });

    expect(travel.state.player.vitals?.stamina).toBe(95);
    expect(exhausted.state.player.vitals?.stamina).toBe(0);
  });

  it('uses structured recovery semantics instead of wording or rough action intent', () => {
    const before = makeState(30, '公元194年05月03日 22:00（亥时）');
    const after = makeState(30, '公元194年05月04日 06:00（卯时）');
    const completed = applyPlayerStaminaAfterTurn(after, {
      previousState: before,
      playerInput: '投宿客栈后和衣而卧，直到天明',
      actionIntent: 'move',
      recoveryKind: 'rest',
    });
    const notCompleted = applyPlayerStaminaAfterTurn(after, {
      previousState: before,
      playerInput: '投宿客栈后和衣而卧，直到天明',
      actionIntent: 'rest',
      recoveryKind: 'none',
    });

    expect(completed.state.player.vitals?.stamina).toBe(78);
    expect(completed.adjustment?.reason).toBe('休息恢复，480分钟');
    expect(notCompleted.state.player.vitals?.stamina).toBe(29);
    expect(notCompleted.adjustment?.category).toBe('ordinary');
  });

  it('keeps vitals unchanged when recovery semantics are missing or recovery has no elapsed time', () => {
    const state = makeState(30);
    state.player.vitals!.hp = 40;
    const missing = applyPlayerStaminaAfterTurn(state, {
      previousState: makeState(30),
      playerInput: '睡了一觉',
      actionIntent: 'rest',
    });
    const noTimeAdvance = applyPlayerStaminaAfterTurn(state, {
      previousState: makeState(30),
      playerInput: '睡了一觉',
      actionIntent: 'rest',
      recoveryKind: 'rest',
    });

    expect(missing.state.player.vitals).toMatchObject({ hp: 40, stamina: 30 });
    expect(missing.diagnostic).toMatch(/未提供合法 playerRecoveryKind/);
    expect(noTimeAdvance.state.player.vitals).toMatchObject({ hp: 40, stamina: 30 });
    expect(noTimeAdvance.diagnostic).toMatch(/有效游戏时间未推进/);
  });

  it('does not drain a zero-hp player when the structured response says no recovery completed', () => {
    const before = makeState(60);
    before.player.vitals!.hp = 0;
    const after = makeState(60);
    after.player.vitals!.hp = 0;
    const result = applyPlayerStaminaAfterTurn(after, {
      previousState: before,
      playerInput: '我试图继续赶路，但伤势令我无法起身',
      actionIntent: 'move',
      recoveryKind: 'none',
    });

    expect(result.state.player.vitals).toMatchObject({ hp: 0, stamina: 60 });
    expect(result.diagnostic).toMatch(/生命为 0/);
  });
});
