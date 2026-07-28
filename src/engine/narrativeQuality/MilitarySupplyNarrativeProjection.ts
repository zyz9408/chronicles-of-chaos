import type {
  DomesticReportResourceDelta,
  RuntimeState,
} from '../types';
import {
  calculateHoldingMonthlyUpkeepPreview,
  type HoldingMonthlyUpkeepSource,
  type HoldingMonthlyUpkeepTroopPreview,
} from '../holdings/HoldingAnnualSettlementRuntime';
import { tryCreateGameClockFromDateLabel } from '../time/gameClock';

type SustainableResource = 'money' | 'grain' | 'horses' | 'arms';

export interface MilitarySupplySourceShare {
  source: HoldingMonthlyUpkeepSource;
  troopCount: number;
  /** 按现役建制数计算，仅供解释供给结构，不是跨资源折算比例。 */
  countRatio: number;
}

export interface MilitarySupplyCurrentLocationTroop {
  troopId: string;
  name: string;
  size: number;
  source: HoldingMonthlyUpkeepSource;
  requiredExpenses: DomesticReportResourceDelta;
}

export interface MilitarySupplyNarrativeProjectionData {
  currentResources: Pick<DomesticReportResourceDelta, SustainableResource>;
  activeTroopCount: number;
  monthlyRequired: DomesticReportResourceDelta;
  externalProvision: DomesticReportResourceDelta;
  playerRequired: DomesticReportResourceDelta;
  playerStockDraw: DomesticReportResourceDelta;
  shortage: DomesticReportResourceDelta;
  sourceShares: MilitarySupplySourceShare[];
  sustainableMonths?: number;
  limitingResource?: SustainableResource;
  nextMonthlyUpkeepAt?: string;
  nextAnnualSettlementAt?: string;
  currentLocationTroops: MilitarySupplyCurrentLocationTroop[];
}

export interface MilitarySupplyNarrativeProjection {
  data: MilitarySupplyNarrativeProjectionData | undefined;
  text: string;
}

const RESOURCE_ORDER: SustainableResource[] = ['money', 'grain', 'horses', 'arms'];
const SOURCE_LABELS: Record<HoldingMonthlyUpkeepSource, string> = {
  player_resources: '玩家库存承担',
  superior_provision: '上级供给',
  mixed: '混合供给',
};

const RESOURCE_LABELS: Record<SustainableResource, string> = {
  money: '钱财',
  grain: '粮草',
  horses: '马匹',
  arms: '军械',
};

function isZeroDelta(delta: DomesticReportResourceDelta): boolean {
  return delta.money === 0
    && delta.grain === 0
    && delta.horses === 0
    && delta.arms === 0
    && delta.recruits === 0;
}

function clampStockDraw(
  required: DomesticReportResourceDelta,
  provisionSurplus: DomesticReportResourceDelta,
): DomesticReportResourceDelta {
  return {
    money: Math.max(0, required.money - provisionSurplus.money),
    grain: Math.max(0, required.grain - provisionSurplus.grain),
    horses: Math.max(0, required.horses - provisionSurplus.horses),
    arms: Math.max(0, required.arms - provisionSurplus.arms),
    recruits: Math.max(0, required.recruits - provisionSurplus.recruits),
  };
}

function calculateSustainability(
  currentResources: MilitarySupplyNarrativeProjectionData['currentResources'],
  playerStockDraw: DomesticReportResourceDelta,
  shortage: DomesticReportResourceDelta,
): Pick<MilitarySupplyNarrativeProjectionData, 'sustainableMonths' | 'limitingResource'> {
  const shortageResource = RESOURCE_ORDER.find((resource) => shortage[resource] > 0);
  if (shortageResource) {
    return { sustainableMonths: 0, limitingResource: shortageResource };
  }

  const ratios = RESOURCE_ORDER
    .filter((resource) => playerStockDraw[resource] > 0)
    .map((resource) => ({
      resource,
      months: currentResources[resource] / playerStockDraw[resource],
    }))
    .sort((left, right) => left.months - right.months || RESOURCE_ORDER.indexOf(left.resource) - RESOURCE_ORDER.indexOf(right.resource));
  if (ratios.length === 0) return {};
  return {
    sustainableMonths: ratios[0].months,
    limitingResource: ratios[0].resource,
  };
}

function buildSourceShares(
  sourceTroopCounts: Record<HoldingMonthlyUpkeepSource, number>,
  activeTroopCount: number,
): MilitarySupplySourceShare[] {
  const sources: HoldingMonthlyUpkeepSource[] = [
    'player_resources',
    'superior_provision',
    'mixed',
  ];
  return sources.map((source) => ({
    source,
    troopCount: sourceTroopCounts[source],
    countRatio: activeTroopCount > 0 ? sourceTroopCounts[source] / activeTroopCount : 0,
  }));
}

function selectCurrentLocationTroops(
  state: RuntimeState,
  troopBreakdown: HoldingMonthlyUpkeepTroopPreview[],
): MilitarySupplyCurrentLocationTroop[] {
  const currentLocationIds = new Set([
    state.currentLocationId,
    state.currentPlaceId,
    state.currentSceneId,
  ].filter((value): value is string => Boolean(value)));
  return troopBreakdown
    .filter((troop) => Boolean(troop.locationId && currentLocationIds.has(troop.locationId)))
    .sort((left, right) => right.size - left.size || left.name.localeCompare(right.name))
    .slice(0, 4)
    .map((troop) => ({
      troopId: troop.troopId,
      name: troop.name,
      size: troop.size,
      source: troop.source,
      requiredExpenses: { ...troop.requiredExpenses },
    }));
}

function resolveBoundaries(state: RuntimeState): Pick<
  MilitarySupplyNarrativeProjectionData,
  'nextMonthlyUpkeepAt' | 'nextAnnualSettlementAt'
> {
  const clock = state.currentTime ?? tryCreateGameClockFromDateLabel(state.currentDate);
  if (!clock) return {};
  const nextMonth = clock.month === 12
    ? { year: clock.year + 1, month: 1 }
    : { year: clock.year, month: clock.month + 1 };
  const annualYear = clock.month < 9 ? clock.year : clock.year + 1;
  return {
    nextMonthlyUpkeepAt: `${nextMonth.year}-${String(nextMonth.month).padStart(2, '0')}-01 08:00`,
    nextAnnualSettlementAt: `${annualYear}-09-01 08:00`,
  };
}

function formatResourceAmounts(delta: DomesticReportResourceDelta): string {
  const values: Array<[string, number, string]> = [
    ['钱财', delta.money, '贯'],
    ['粮草', delta.grain, '石'],
    ['马匹', delta.horses, '匹'],
    ['军械', delta.arms, '件'],
    ['可征召人手', delta.recruits, '人'],
  ];
  const parts = values
    .filter(([, amount]) => amount !== 0)
    .map(([label, amount, unit]) => `${label}${amount}${unit}`);
  return parts.length > 0 ? parts.join('、') : '无';
}

function formatMonths(months: number): string {
  if (!Number.isFinite(months)) return '未知';
  const rounded = Math.floor(months * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatProjection(data: MilitarySupplyNarrativeProjectionData): string {
  const sourceText = data.sourceShares
    .map((share) => `${SOURCE_LABELS[share.source]}${share.troopCount}支/${Math.round(share.countRatio * 100)}%`)
    .join('；');
  const sustainabilityText = data.sustainableMonths === undefined
    ? '按当前供给结构无需消耗玩家库存'
    : data.sustainableMonths <= 0
      ? `当前已经存在军需缺口（首先受限：${RESOURCE_LABELS[data.limitingResource ?? 'grain']}）`
      : `按当前库存与供给结构约可维持${formatMonths(data.sustainableMonths)}个月（首先受限：${RESOURCE_LABELS[data.limitingResource ?? 'grain']}）`;
  const boundaryText = [
    data.nextMonthlyUpkeepAt ? `下次月度维护=${data.nextMonthlyUpkeepAt}` : '',
    data.nextAnnualSettlementAt ? `下次九月结算=${data.nextAnnualSettlementAt}` : '',
  ].filter(Boolean).join('；');
  const localTroopText = data.currentLocationTroops.length > 0
    ? `当前地点部队：${data.currentLocationTroops.map((troop) => `${troop.name}${troop.size}人/${SOURCE_LABELS[troop.source]}/月需${formatResourceAmounts(troop.requiredExpenses)}`).join('；')}`
    : '';

  return [
    'Military Supply Truth / 军需叙事真值（本地只读）',
    `当前库存：钱财${data.currentResources.money}贯、粮草${data.currentResources.grain}石、马匹${data.currentResources.horses}匹、军械${data.currentResources.arms}件。`,
    `全部现役部队${data.activeTroopCount}支：下月总维护${formatResourceAmounts(data.monthlyRequired)}；上级或外部预计供给${formatResourceAmounts(data.externalProvision)}；玩家库存应承担${formatResourceAmounts(data.playerRequired)}；当前缺口${formatResourceAmounts(data.shortage)}。`,
    `供给结构（按现役建制数，不是跨资源折算）：${sourceText}。`,
    `${sustainabilityText}。`,
    boundaryText,
    localTroopText,
    '叙事权限：正式军需官、账房或有账册依据者必须以此为数值锚点；玩家本回合明确要求核账、逐项报告或精确数字时，必须逐项复述投影中的数值与单位，不得省略、改算或用模糊估计替代。普通人物可以不知道精确值；敌方、传闻或撒谎者只有在正文明确来源不可靠时才可给出错误估计。',
    '写回边界：这些数值只供叙事读取，不得写入或覆盖本地月度军需与九月年度结算；只有正文明确发生的额外事件资源变化，才可沿既有结构化写回链提交。',
  ].filter(Boolean).join('\n');
}

export function buildMilitarySupplyNarrativeProjection(
  state: RuntimeState,
): MilitarySupplyNarrativeProjection {
  const preview = calculateHoldingMonthlyUpkeepPreview(state);
  if (!preview || preview.activeTroopCount === 0 || isZeroDelta(preview.requiredExpenses)) {
    return { data: undefined, text: '' };
  }

  const currentResources = {
    money: state.resources?.money ?? 0,
    grain: state.resources?.grain ?? 0,
    horses: state.resources?.horses ?? 0,
    arms: state.resources?.arms ?? 0,
  };
  const playerStockDraw = clampStockDraw(
    preview.playerRequiredExpenses,
    preview.provisionSurplus,
  );
  const sustainability = calculateSustainability(
    currentResources,
    playerStockDraw,
    preview.shortage,
  );
  const data: MilitarySupplyNarrativeProjectionData = {
    currentResources,
    activeTroopCount: preview.activeTroopCount,
    monthlyRequired: { ...preview.requiredExpenses },
    externalProvision: { ...preview.income },
    playerRequired: { ...preview.playerRequiredExpenses },
    playerStockDraw,
    shortage: { ...preview.shortage },
    sourceShares: buildSourceShares(preview.sourceTroopCounts, preview.activeTroopCount),
    ...sustainability,
    ...resolveBoundaries(state),
    currentLocationTroops: selectCurrentLocationTroops(state, preview.troopBreakdown),
  };
  return { data, text: formatProjection(data) };
}
