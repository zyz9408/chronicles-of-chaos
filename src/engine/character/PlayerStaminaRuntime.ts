import type { ActionIntent, RuntimeState } from '../types';
import { tryCreateGameClockFromDateLabel, type GameClock } from '../time/gameClock';

export type PlayerStaminaCategory =
  | 'combat'
  | 'intimacy'
  | 'strenuous'
  | 'travel'
  | 'explore'
  | 'ordinary'
  | 'recovery';

export interface PlayerStaminaAdjustment {
  previousStamina: number;
  nextStamina: number;
  delta: number;
  category: PlayerStaminaCategory;
  reason: string;
}

export interface PlayerHealthAdjustment {
  previousHp: number;
  nextHp: number;
  delta: number;
  reason: string;
}

export interface PlayerVitalsSettlement {
  state: RuntimeState;
  adjustment?: PlayerStaminaAdjustment;
  healthAdjustment?: PlayerHealthAdjustment;
}

interface PlayerStaminaTurnContext {
  previousState: RuntimeState;
  playerInput: string;
  actionIntent: ActionIntent;
}

interface ClassifiedStaminaAction {
  category: PlayerStaminaCategory;
  reason: string;
}

const explicitRecoveryPattern = /休息|歇息|安睡|睡觉|入睡|就寝|过夜|歇一夜|睡一夜|静养|休养|疗养/;
const healthRecoveryPattern = /静养|休养|疗养|养伤|疗伤|治疗|诊治|医治|包扎|处理伤口|恢复伤势|调养伤势/;
const deliberationPattern = /询问|商议|是否|要不要|打算|计划|准备|建议|应该如何|能否/;
const passiveWaitingPattern = /等待|静待|等候|时间经过|时间推移|停留|守候/;
const combatExecutionPattern = /夜袭|劫营|冲锋|突击|厮杀|交锋|搏杀|杀入|斩杀|追击|伏击|攻城|守城|突围|擒拿|刺杀|放箭|射敌|挥刀|迎战|战斗/;
const intimateActivityPattern = /欢爱|交合|做爱|云雨|求欢|前戏|后入|插入|抽插|操干|射精|泄身|同房|房事|乘骑位|变换体位/;
const strenuousActivityPattern = /训练|操练|演武|校场|骑术|急行|强行军|连夜行军|奔跑|攀爬|游泳|搬运|挖掘|劈砍|砍柴/;

/**
 * 在正文与结构化写回都完成后，以本地确定性规则结算玩家体力。
 * 体力只反映行动负荷，不作为行动硬门禁；叙事模型仍能依据投喂的当前值自行表现疲劳。
 */
export function applyPlayerVitalsAfterTurn(
  state: RuntimeState,
  context: PlayerStaminaTurnContext,
): PlayerVitalsSettlement {
  const vitals = state.player.vitals;
  if (!vitals || !Number.isFinite(vitals.stamina) || !Number.isFinite(vitals.maxStamina) || vitals.maxStamina <= 0) {
    return { state };
  }

  const previousStamina = clamp(Math.round(vitals.stamina), 0, Math.round(vitals.maxStamina));
  const elapsedMinutes = getElapsedMinutes(context.previousState, state);
  const classified = classifyStaminaAction(context.playerInput, context.actionIntent);
  if (!classified) return { state };

  const requestedDelta = calculateStaminaDelta(classified.category, elapsedMinutes);
  const nextStamina = clamp(previousStamina + requestedDelta, 0, Math.round(vitals.maxStamina));
  const delta = nextStamina - previousStamina;
  const adjustment: PlayerStaminaAdjustment | undefined = delta === 0
    ? undefined
    : {
        previousStamina,
        nextStamina,
        delta,
        category: classified.category,
        reason: classified.reason,
      };
  const healthAdjustment = calculateHealthRecovery(vitals, context, classified.category, elapsedMinutes);
  if (!adjustment && !healthAdjustment) return { state };

  const nextState: RuntimeState = {
    ...state,
    player: {
      ...state.player,
      vitals: {
        ...vitals,
        ...(adjustment ? { stamina: nextStamina } : {}),
        ...(healthAdjustment ? { hp: healthAdjustment.nextHp } : {}),
      },
    },
    turnLog: appendVitalsSummary(state.turnLog, adjustment, healthAdjustment),
  };

  return { state: nextState, adjustment, healthAdjustment };
}

/** 保留旧导出名，避免既有调用方被迫同步改名。 */
export const applyPlayerStaminaAfterTurn = applyPlayerVitalsAfterTurn;

export function isExplicitPlayerHealthRecoveryAction(playerInput: string): boolean {
  return healthRecoveryPattern.test(playerInput.trim());
}

function classifyStaminaAction(
  playerInput: string,
  actionIntent: ActionIntent,
): ClassifiedStaminaAction | undefined {
  const input = playerInput.trim();

  // “等待/停留”可被粗意图识别为 rest，但不等于真正睡眠或休养。
  if (passiveWaitingPattern.test(input) && !explicitRecoveryPattern.test(input)) return undefined;
  // 显式执行休息优先于粗意图；“在营中静养半日”即使被识别成 interact 也必须恢复。
  if (
    explicitRecoveryPattern.test(input)
    && !((actionIntent === 'inquire' || actionIntent === 'interact') && deliberationPattern.test(input))
  ) {
    return { category: 'recovery', reason: '休息恢复' };
  }

  // 询问和商议只结算交谈本身，后文提到的战斗、亲密或休息计划都不代表已经执行。
  if (actionIntent === 'inquire' || actionIntent === 'interact') {
    return { category: 'ordinary', reason: '日常行动消耗' };
  }

  if (actionIntent === 'combat' || combatExecutionPattern.test(input)) {
    return { category: 'combat', reason: '战斗消耗' };
  }
  if (intimateActivityPattern.test(input)) return { category: 'intimacy', reason: '亲密活动消耗' };
  if (strenuousActivityPattern.test(input)) return { category: 'strenuous', reason: '高强度行动消耗' };
  if (actionIntent === 'move') return { category: 'travel', reason: '赶路消耗' };
  if (actionIntent === 'explore') return { category: 'explore', reason: '探索消耗' };
  return { category: 'ordinary', reason: '日常行动消耗' };
}

function calculateHealthRecovery(
  vitals: NonNullable<RuntimeState['player']['vitals']>,
  context: PlayerStaminaTurnContext,
  category: PlayerStaminaCategory,
  elapsedMinutes?: number,
): PlayerHealthAdjustment | undefined {
  if (
    category !== 'recovery'
    || !isExplicitPlayerHealthRecoveryAction(context.playerInput)
    || !Number.isFinite(vitals.hp)
    || !Number.isFinite(vitals.maxHp)
    || vitals.maxHp <= 0
  ) {
    return undefined;
  }
  const previousHp = clamp(Math.round(vitals.hp), 0, Math.round(vitals.maxHp));
  const requestedDelta = !elapsedMinutes || elapsedMinutes <= 0
    ? 8
    : Math.min(30, Math.max(8, Math.floor(elapsedMinutes / 60) * 4));
  const nextHp = clamp(previousHp + requestedDelta, 0, Math.round(vitals.maxHp));
  if (nextHp === previousHp) return undefined;
  return {
    previousHp,
    nextHp,
    delta: nextHp - previousHp,
    reason: '治疗休养恢复',
  };
}

function calculateStaminaDelta(category: PlayerStaminaCategory, elapsedMinutes?: number): number {
  switch (category) {
    case 'combat':
      return -10;
    case 'intimacy':
      return -6;
    case 'strenuous':
      return -6;
    case 'travel':
      return -(3 + Math.min(4, Math.floor((elapsedMinutes ?? 0) / 180)));
    case 'explore':
      return -4;
    case 'recovery': {
      if (!elapsedMinutes || elapsedMinutes <= 0) return 18;
      return Math.min(60, Math.max(12, Math.floor(elapsedMinutes / 60) * 6));
    }
    case 'ordinary':
    default:
      return -1;
  }
}

function getElapsedMinutes(previousState: RuntimeState, nextState: RuntimeState): number | undefined {
  const before = previousState.currentTime ?? tryCreateGameClockFromDateLabel(previousState.currentDate);
  const after = nextState.currentTime ?? tryCreateGameClockFromDateLabel(nextState.currentDate);
  if (!before || !after) return undefined;

  const difference = toAbsoluteMinutes(after) - toAbsoluteMinutes(before);
  return difference > 0 ? difference : undefined;
}

function toAbsoluteMinutes(clock: GameClock): number {
  return (((((clock.year * 12) + (clock.month - 1)) * 30 + (clock.day - 1)) * 24 + clock.hour) * 60)
    + clock.minute;
}

function appendVitalsSummary(
  turnLog: RuntimeState['turnLog'],
  adjustment?: PlayerStaminaAdjustment,
  healthAdjustment?: PlayerHealthAdjustment,
): RuntimeState['turnLog'] {
  if (turnLog.length === 0) return turnLog;
  const summary = [
    adjustment
      ? `体力 ${adjustment.previousStamina}→${adjustment.nextStamina}（${adjustment.reason}）`
      : undefined,
    healthAdjustment
      ? `生命 ${healthAdjustment.previousHp}→${healthAdjustment.nextHp}（${healthAdjustment.reason}）`
      : undefined,
  ].filter(Boolean).join('；');
  const lastIndex = turnLog.length - 1;
  return turnLog.map((entry, index) => (
    index === lastIndex
      ? {
          ...entry,
          statePatchSummary: [entry.statePatchSummary, summary].filter(Boolean).join('；'),
        }
      : entry
  ));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
