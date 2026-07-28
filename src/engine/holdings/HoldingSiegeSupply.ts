import type {
  HoldingLedgerEntry,
  HoldingSiegePreparation,
  HoldingSiegeState,
  HoldingSupplyLineStatus,
  HoldingType,
} from '../types';

export type HoldingSiegeSupplyCondition = 'supplied' | 'stable' | 'strained' | 'critical' | 'exhausted';

export interface HoldingSiegeSupplyProjection {
  siegeStatusText: string;
  supplyLineText: string;
  preparationText: string;
  remainingTurns?: number;
  condition: HoldingSiegeSupplyCondition;
  supplyText: string;
}

const ENDURANCE_RULES: Record<HoldingType, { base: number; perScale: number }> = {
  county: { base: 6, perScale: 3 },
  commandery: { base: 7, perScale: 3 },
  city: { base: 6, perScale: 3 },
  fort: { base: 5, perScale: 2 },
  pass: { base: 6, perScale: 2 },
  camp: { base: 2, perScale: 1 },
  estate: { base: 3, perScale: 1 },
  port: { base: 5, perScale: 2 },
  village: { base: 3, perScale: 1 },
  other: { base: 3, perScale: 1 },
};

const PREPARATION_BONUS: Record<HoldingSiegePreparation, number> = {
  none: 0,
  prepared: 3,
  stockpiled: 6,
};

const SIEGE_STATUS_LABELS: Record<HoldingSiegeState['status'], string> = {
  blockaded: '外围封锁',
  encircled: '完全包围',
};

const SUPPLY_LINE_LABELS: Record<HoldingSupplyLineStatus, string> = {
  open: '仍畅通',
  strained: '受压',
  cut: '已中断',
};

const PREPARATION_LABELS: Record<HoldingSiegePreparation, string> = {
  none: '未作专门准备',
  prepared: '已有准备',
  stockpiled: '提前屯粮',
};

export function calculateInitialSiegeEnduranceTurns(
  holding: Pick<HoldingLedgerEntry, 'type' | 'scaleLevel'>,
  preparation: HoldingSiegePreparation,
): number {
  const rule = ENDURANCE_RULES[holding.type];
  return rule.base + rule.perScale * holding.scaleLevel + PREPARATION_BONUS[preparation];
}

export function projectHoldingSiegeSupply(
  holding: Pick<HoldingLedgerEntry, 'type' | 'scaleLevel' | 'siege'>,
  currentTurn: number,
): HoldingSiegeSupplyProjection | null {
  const siege = holding.siege;
  if (!siege) return null;

  const shared = {
    siegeStatusText: SIEGE_STATUS_LABELS[siege.status],
    supplyLineText: SUPPLY_LINE_LABELS[siege.supplyLine],
    preparationText: PREPARATION_LABELS[siege.preparation],
  };

  if (siege.supplyLine === 'open') {
    return {
      ...shared,
      condition: 'supplied',
      supplyText: '外部补给仍可进入',
    };
  }
  if (siege.supplyLine === 'strained') {
    return {
      ...shared,
      condition: 'supplied',
      supplyText: '外部补给受压，尚未完全断绝',
    };
  }

  const initialEnduranceTurns = siege.initialEnduranceTurns
    ?? calculateInitialSiegeEnduranceTurns(holding, siege.preparation);
  const cutOffAtTurn = siege.cutOffAtTurn ?? Math.max(0, Math.floor(currentTurn));
  const elapsedTurns = Math.max(0, Math.floor(currentTurn) - cutOffAtTurn);
  const remainingTurns = Math.max(0, initialEnduranceTurns - elapsedTurns);
  const condition = deriveCondition(remainingTurns, initialEnduranceTurns);

  return {
    ...shared,
    remainingTurns,
    condition,
    supplyText: formatSupplyText(condition, remainingTurns),
  };
}

function deriveCondition(
  remainingTurns: number,
  initialEnduranceTurns: number,
): Exclude<HoldingSiegeSupplyCondition, 'supplied'> {
  if (remainingTurns <= 0) return 'exhausted';
  if (remainingTurns <= Math.ceil(initialEnduranceTurns * 0.25)) return 'critical';
  if (remainingTurns <= Math.ceil(initialEnduranceTurns * 0.5)) return 'strained';
  return 'stable';
}

function formatSupplyText(
  condition: Exclude<HoldingSiegeSupplyCondition, 'supplied'>,
  remainingTurns: number,
): string {
  if (condition === 'exhausted') return '粮秣告罄';
  const prefix = condition === 'critical'
    ? '濒临断粮'
    : condition === 'strained'
      ? '补给紧张'
      : '尚可支撑';
  return `${prefix}（预计可支撑${remainingTurns}回合）`;
}
