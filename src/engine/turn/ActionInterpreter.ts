// ============================================================
// Engine - ActionInterpreter
// 粗略识别玩家行动类型
// ============================================================

import type { ActionIntent } from '../types';

/** 明确在讨论、询问战斗，而不是正在执行战斗。 */
const nonExecutionContextKeywords: ReadonlyArray<readonly [ActionIntent, readonly string[]]> = [
  ['inquire', ['询问', '打听', '请教']],
  ['interact', ['讨论', '商议', '讲解', '讲讲']],
];

const boundedSequenceConnectors = ['随后', '然后', '接着', '继而', '而后'] as const;
const compactSequenceConnectors = ['后立即', '后立刻', '之后再', '之后便', '之后就'] as const;
const clauseBoundaryCharacters = '，,。.;；！？!?：:\n\r';
const questionMarkers = ['是否', '可否', '能否', '如何', '妥当', '吗', '？', '?'] as const;

/** 行动关键词按判定优先级排列。 */
const actionKeywords: ReadonlyArray<readonly [ActionIntent, readonly string[]]> = [
  ['combat', ['攻击', '战斗', '搏斗', '厮杀', '动手', '抵抗', '迎战', '杀敌', '击杀', '斩杀', '杀死', '放箭', '射敌', '挥刀', '防守', '单挑', '刺杀', '突围', '擒拿', '交锋']],
  ['move', ['去', '前往', '出发', '赶往', '走向', '北上', '南下', '东行', '西去', '到', '赴', '奔赴']],
  ['inquire', ['打听', '询问', '了解', '探听', '消息', '传闻', '得知', '听说', '寻找', '找']],
  ['interact', ['拜访', '求见', '拜见', '交谈', '谈话', '对话', '见', '会面', '求', '请']],
  ['rest', ['休息', '歇息', '睡觉', '过夜', '停留', '等待', '等']],
  ['trade', ['买', '卖', '交易', '购买', '出售', '换取', '杀价', '市集', '粮']],
  ['explore', ['探索', '查看', '观察', '打探', '侦察', '巡视', '逛逛', '走走']],
];

/**
 * 粗粒度解析玩家行动意图
 */
export function interpretAction(input: string): ActionIntent {
  const finalActionClause = extractFinalActionClause(input);
  const clause = finalActionClause && shouldPreserveNonExecutionContext(input, finalActionClause)
    ? input
    : finalActionClause ?? input;
  return interpretActionClause(clause);
}

function shouldPreserveNonExecutionContext(input: string, finalActionClause: string): boolean {
  const firstTerminalClause = extractFirstTerminalClause(finalActionClause);
  return hasNonExecutionContext(input)
    && questionMarkers.some((marker) => firstTerminalClause.includes(marker));
}

function extractFirstTerminalClause(input: string): string {
  for (let index = 0; index < input.length; index += 1) {
    if (clauseBoundaryCharacters.includes(input[index])) {
      return input.slice(0, index + 1);
    }
  }
  return input;
}

function hasNonExecutionContext(input: string): boolean {
  return nonExecutionContextKeywords.some(([, keywords]) => (
    keywords.some((keyword) => input.includes(keyword))
  ));
}

function extractFinalActionClause(input: string): string | undefined {
  let clauseStart = -1;
  for (const connector of boundedSequenceConnectors) {
    let connectorIndex = input.indexOf(connector);
    while (connectorIndex >= 0) {
      if (hasClauseBoundaryBefore(input, connectorIndex)) {
        clauseStart = Math.max(clauseStart, connectorIndex + connector.length);
      }
      connectorIndex = input.indexOf(connector, connectorIndex + connector.length);
    }
  }
  for (const connector of compactSequenceConnectors) {
    const connectorIndex = input.lastIndexOf(connector);
    if (connectorIndex >= 0) clauseStart = Math.max(clauseStart, connectorIndex + connector.length);
  }
  if (clauseStart < 0) return undefined;
  const clause = input.slice(clauseStart).trim();
  return clause || undefined;
}

function hasClauseBoundaryBefore(input: string, connectorIndex: number): boolean {
  let boundaryIndex = connectorIndex - 1;
  while (boundaryIndex >= 0 && /\s/.test(input[boundaryIndex])) boundaryIndex -= 1;
  return boundaryIndex < 0 || clauseBoundaryCharacters.includes(input[boundaryIndex]);
}

function interpretActionClause(input: string): ActionIntent {
  const lowerInput = input.toLowerCase();

  for (const [intent, keywords] of nonExecutionContextKeywords) {
    if (keywords.some((keyword) => lowerInput.includes(keyword))) return intent;
  }

  for (const [intent, keywords] of actionKeywords) {
    for (const keyword of keywords) {
      if (lowerInput.includes(keyword)) {
        return intent;
      }
    }
  }

  return 'other';
}

/**
 * 判断行动是否匹配特定意图
 */
export function matchesIntent(input: string, intent: ActionIntent): boolean {
  return interpretAction(input) === intent;
}
