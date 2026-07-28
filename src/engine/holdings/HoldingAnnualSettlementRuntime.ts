import type {
  DomesticReportEntry,
  DomesticReportResourceDelta,
  HoldingLedgerEntry,
  PrivateAssetEntry,
  PrivateAssetProjectEntry,
  ResourceLedger,
  RuntimeState,
  TroopLedgerEntry,
  TurnHoldingAnnualSettlementMeta,
} from '../types';
import {
  buildHoldingAnnualSettlementReportId,
  buildHoldingMonthlyUpkeepReportId,
  HOLDING_ANNUAL_SETTLEMENT_KIND,
  HOLDING_MONTHLY_UPKEEP_KIND,
  isHoldingAnnualSettlementReport,
  isHoldingMonthlyUpkeepReport,
  isLegacyHoldingAnnualSettlementReport,
} from '../domesticReports';
import {
  calculateHoldingAnnualSettlement,
  calculateTroopMonthlyUpkeep,
  calculateTroopsMonthlyUpkeep,
  completeDuePrivateAssetProjects,
  isAnnualSettlementPrivateAsset,
  isUpkeepTroop,
} from './HoldingAnnualSettlement';

export interface HoldingAnnualSettlementPromptPreview {
  reportId: string;
  year: number;
  settledAt: string;
  income: DomesticReportResourceDelta;
  expenses: DomesticReportResourceDelta;
  netChange: DomesticReportResourceDelta;
  nextResources: ResourceLedger;
  nextHoldings: HoldingLedgerEntry[];
  nextPrivateAssets: PrivateAssetEntry[];
  nextPrivateAssetProjects: PrivateAssetProjectEntry[];
  report: DomesticReportEntry;
  completedProjectIds: string[];
  affectedHoldingIds: string[];
  affectedPrivateAssetIds: string[];
}

export interface HoldingAnnualSettlementApplicationResult {
  state: RuntimeState;
  meta?: TurnHoldingAnnualSettlementMeta;
}

export interface HoldingMonthlyUpkeepMeta {
  status: 'applied';
  settledMonths: Array<{
    monthId: string;
    year: number;
    month: number;
    settledAt: string;
    income?: DomesticReportResourceDelta;
    requiredExpenses?: DomesticReportResourceDelta;
    expenses: DomesticReportResourceDelta;
    shortage?: DomesticReportResourceDelta;
  }>;
  income?: DomesticReportResourceDelta;
  requiredExpenses?: DomesticReportResourceDelta;
  expenses: DomesticReportResourceDelta;
  netChange: DomesticReportResourceDelta;
  shortage?: DomesticReportResourceDelta;
}

export interface HoldingMonthlyUpkeepApplicationResult {
  state: RuntimeState;
  meta?: HoldingMonthlyUpkeepMeta;
}

export type HoldingMonthlyUpkeepSource = Exclude<
  NonNullable<TroopLedgerEntry['upkeepSource']>,
  'unknown'
>;

export interface HoldingMonthlyUpkeepTroopPreview {
  troopId: string;
  name: string;
  size: number;
  locationId?: string;
  source: HoldingMonthlyUpkeepSource;
  requiredExpenses: DomesticReportResourceDelta;
  superiorProvision: DomesticReportResourceDelta;
  playerRequiredExpenses: DomesticReportResourceDelta;
}

export interface HoldingMonthlyUpkeepPreview {
  activeTroopCount: number;
  sourceTroopCounts: Record<HoldingMonthlyUpkeepSource, number>;
  income: DomesticReportResourceDelta;
  requiredExpenses: DomesticReportResourceDelta;
  expenses: DomesticReportResourceDelta;
  playerRequiredExpenses: DomesticReportResourceDelta;
  provisionSurplus: DomesticReportResourceDelta;
  netChange: DomesticReportResourceDelta;
  shortage: DomesticReportResourceDelta;
  troopBreakdown: HoldingMonthlyUpkeepTroopPreview[];
  nextTroops: TroopLedgerEntry[];
}

export interface HoldingSettlementTimelineApplicationResult {
  state: RuntimeState;
  annualMeta?: TurnHoldingAnnualSettlementMeta;
  monthlyMeta?: HoldingMonthlyUpkeepMeta;
}

export interface HoldingAnnualSettlementApplicationOptions {
  previousState?: RuntimeState;
}

interface SettlementComputation {
  reportId: string;
  year: number;
  settledAt: string;
  income: DomesticReportResourceDelta;
  expenses: DomesticReportResourceDelta;
  netChange: DomesticReportResourceDelta;
  nextResources: ResourceLedger;
  nextHoldings: HoldingLedgerEntry[];
  nextPrivateAssets: PrivateAssetEntry[];
  nextPrivateAssetProjects: PrivateAssetProjectEntry[];
  report: DomesticReportEntry;
  completedProjectIds: string[];
  affectedHoldingIds: string[];
  affectedPrivateAssetIds: string[];
}

const ZERO_DELTA: DomesticReportResourceDelta = {
  money: 0,
  grain: 0,
  horses: 0,
  arms: 0,
  recruits: 0,
};

export function prepareHoldingAnnualSettlement(
  state: RuntimeState,
): HoldingAnnualSettlementPromptPreview | undefined {
  const computation = computeDueHoldingAnnualSettlement(state);
  if (!computation) return undefined;

  return {
    reportId: computation.reportId,
    year: computation.year,
    settledAt: computation.settledAt,
    income: computation.income,
    expenses: computation.expenses,
    netChange: computation.netChange,
    nextResources: computation.nextResources,
    nextHoldings: computation.nextHoldings,
    nextPrivateAssets: computation.nextPrivateAssets,
    nextPrivateAssetProjects: computation.nextPrivateAssetProjects,
    report: computation.report,
    completedProjectIds: computation.completedProjectIds,
    affectedHoldingIds: computation.affectedHoldingIds,
    affectedPrivateAssetIds: computation.affectedPrivateAssetIds,
  };
}

export function formatHoldingAnnualSettlementPreview(
  preview: HoldingAnnualSettlementPromptPreview,
): string {
  const projectLine = preview.completedProjectIds.length > 0
    ? `到期私产工程：${preview.completedProjectIds.join('、')}`
    : '到期私产工程：无';
  const holdingLine = preview.affectedHoldingIds.length > 0
    ? `参与结算领地：${preview.affectedHoldingIds.join('、')}`
    : '参与结算领地：无';

  return [
    '年度结算待处理',
    `- reportId: ${preview.reportId}`,
    `- 年份：${preview.year}`,
    `- 结算时间：${preview.settledAt}`,
    '- 本地年度结算引擎已预计算收支；回合结束后会自动写入资源、领地腐败、私产工程和内政报告。',
    '- LLM 不要另行编造年度收支数值；如果正文需要提及，只自然承接“秋税/岁入/军费/庄园工程到期”等事实。',
    `- 收入：${formatResourceDelta(preview.income)}`,
    `- 支出：${formatResourceDelta(preview.expenses)}`,
    `- 净变：${formatResourceDelta(preview.netChange)}`,
    `- ${projectLine}`,
    `- ${holdingLine}`,
  ].join('\n');
}

export function applyHoldingAnnualSettlementRuntime(
  state: RuntimeState,
  preview?: HoldingAnnualSettlementPromptPreview,
  options: HoldingAnnualSettlementApplicationOptions = {},
): HoldingAnnualSettlementApplicationResult {
  const compatibleState = normalizeHoldingAnnualSettlementReports(state);
  const previewResult = preview
    ? applyHoldingAnnualSettlementPreview(compatibleState, preview)
    : { state: compatibleState };
  const crossedResult = options.previousState
    ? applyCrossedHoldingAnnualSettlements(previewResult.state, options.previousState)
    : { state: previewResult.state };
  const finalStatePreview = preview ? undefined : prepareHoldingAnnualSettlement(crossedResult.state);
  const finalStateResult = finalStatePreview
    ? applyHoldingAnnualSettlementPreview(crossedResult.state, finalStatePreview)
    : { state: crossedResult.state };
  const meta = finalStateResult.meta ?? crossedResult.meta ?? previewResult.meta;
  return meta ? { state: finalStateResult.state, meta } : { state: finalStateResult.state };
}

function normalizeHoldingAnnualSettlementReports(state: RuntimeState): RuntimeState {
  let nextState = upgradeLegacyHoldingAnnualSettlementReports(state);
  const canonicalYears = uniqueStrings(
    (nextState.domesticReports ?? [])
      .filter((report) => isHoldingAnnualSettlementReport(report, report.year))
      .map((report) => String(report.year)),
  );

  for (const yearText of canonicalYears) {
    const year = Number(yearText);
    if (!Number.isFinite(year)) continue;
    nextState = relocateAnnualReportConflictsInState(nextState, year);
  }
  return nextState;
}

function upgradeLegacyHoldingAnnualSettlementReports(state: RuntimeState): RuntimeState {
  const reports = state.domesticReports ?? [];
  const legacyYears = uniqueStrings(
    reports
      .filter(isLegacyHoldingAnnualSettlementReport)
      .map((report) => String(report.year)),
  );
  if (legacyYears.length === 0) return state;

  let nextReports = reports;
  let changed = false;
  for (const yearText of legacyYears) {
    const year = Number(yearText);
    if (!Number.isFinite(year) || hasHoldingAnnualSettlementReport({ ...state, domesticReports: nextReports }, year)) {
      continue;
    }

    const legacyIndex = nextReports.findIndex(
      (report) => String(report.year) === yearText && isLegacyHoldingAnnualSettlementReport(report),
    );
    if (legacyIndex < 0) continue;

    nextReports = nextReports.map((report, index) => (index === legacyIndex
      ? {
          ...report,
          reportId: buildHoldingAnnualSettlementReportId(yearText),
          source: 'system',
          kind: HOLDING_ANNUAL_SETTLEMENT_KIND,
        }
      : report));
    nextReports = normalizeAnnualReportIdConflicts(nextReports, year);
    changed = true;
  }

  return changed ? { ...state, domesticReports: nextReports } : state;
}

function applyHoldingAnnualSettlementPreview(
  state: RuntimeState,
  preview: HoldingAnnualSettlementPromptPreview,
): HoldingAnnualSettlementApplicationResult {
  if (hasHoldingAnnualSettlementReport(state, preview.year)) {
    return { state: relocateAnnualReportConflictsInState(state, preview.year) };
  }

  const computation = computeDueHoldingAnnualSettlement(state, preview.year, preview.settledAt);
  if (!computation || computation.reportId !== preview.reportId) return { state };

  return applyHoldingAnnualSettlementComputation(state, computation);
}

function applyCrossedHoldingAnnualSettlements(
  state: RuntimeState,
  previousState: RuntimeState,
): HoldingAnnualSettlementApplicationResult {
  const crossedSeptembers = listCrossedMonths(previousState, state)
    .filter(({ month }) => month === 9);
  if (crossedSeptembers.length === 0) return { state };

  let nextState = state;
  let latestMeta: TurnHoldingAnnualSettlementMeta | undefined;
  for (const crossedSeptember of crossedSeptembers) {
    if (hasHoldingAnnualSettlementReport(nextState, crossedSeptember.year)) {
      nextState = relocateAnnualReportConflictsInState(nextState, crossedSeptember.year);
      continue;
    }

    const computation = computeDueHoldingAnnualSettlement(
      nextState,
      crossedSeptember.year,
      crossedSeptember.settledAt,
    );
    if (!computation) continue;

    const applied = applyHoldingAnnualSettlementComputation(nextState, computation);
    nextState = applied.state;
    latestMeta = applied.meta;
  }

  return latestMeta ? { state: nextState, meta: latestMeta } : { state: nextState };
}

function applyHoldingAnnualSettlementComputation(
  state: RuntimeState,
  computation: SettlementComputation,
): HoldingAnnualSettlementApplicationResult {

  const nextState = cloneRuntimeState(state);
  nextState.resources = computation.nextResources;
  nextState.holdings = mergeHoldingsById(nextState.holdings ?? [], computation.nextHoldings);
  nextState.privateAssets = mergePrivateAssetsById(nextState.privateAssets ?? [], computation.nextPrivateAssets);
  nextState.privateAssetProjects = mergePrivateAssetProjectsById(
    nextState.privateAssetProjects ?? [],
    computation.nextPrivateAssetProjects,
  );
  nextState.domesticReports = [
    ...normalizeAnnualReportIdConflicts(nextState.domesticReports ?? [], computation.year),
    computation.report,
  ];

  const meta: TurnHoldingAnnualSettlementMeta = {
    status: 'applied',
    reportId: computation.reportId,
    year: computation.year,
    settledAt: computation.settledAt,
    income: computation.income,
    expenses: computation.expenses,
    netChange: computation.netChange,
    completedProjectIds: computation.completedProjectIds,
    affectedHoldingIds: computation.affectedHoldingIds,
    affectedPrivateAssetIds: computation.affectedPrivateAssetIds,
  };

  appendSettlementTurnLogSummary(nextState, meta);
  return { state: nextState, meta };
}

export function applyHoldingMonthlyUpkeepRuntime(
  state: RuntimeState,
  previousState: RuntimeState,
): HoldingMonthlyUpkeepApplicationResult {
  return applyHoldingMonthlyUpkeepForMonths(state, listCrossedMonths(previousState, state), true);
}

export function applyHoldingSettlementTimelineRuntime(
  state: RuntimeState,
  previousState: RuntimeState,
  preview?: HoldingAnnualSettlementPromptPreview,
): HoldingSettlementTimelineApplicationResult {
  let nextState = normalizeHoldingAnnualSettlementReports(state);
  let annualMeta: TurnHoldingAnnualSettlementMeta | undefined;
  let monthlyMeta: HoldingMonthlyUpkeepMeta | undefined;

  if (preview) {
    const appliedPreview = applyHoldingAnnualSettlementPreview(nextState, preview);
    nextState = appliedPreview.state;
    annualMeta = appliedPreview.meta;
  }

  for (const month of listCrossedMonths(previousState, nextState)) {
    if (month.month === 9) {
      const annualResult = applyHoldingAnnualSettlementBoundary(nextState, month);
      nextState = annualResult.state;
      annualMeta = annualResult.meta ?? annualMeta;
    }

    const monthlyResult = applyHoldingMonthlyUpkeepForMonths(nextState, [month], false);
    nextState = monthlyResult.state;
    monthlyMeta = mergeMonthlyUpkeepMeta(monthlyMeta, monthlyResult.meta);
  }

  if (!preview) {
    const finalPreview = prepareHoldingAnnualSettlement(nextState);
    if (finalPreview) {
      const finalResult = applyHoldingAnnualSettlementPreview(nextState, finalPreview);
      nextState = finalResult.state;
      annualMeta = finalResult.meta ?? annualMeta;
    }
  }

  if (monthlyMeta) appendMonthlyUpkeepTurnLogSummary(nextState, monthlyMeta);
  return {
    state: nextState,
    ...(annualMeta ? { annualMeta } : {}),
    ...(monthlyMeta ? { monthlyMeta } : {}),
  };
}

function applyHoldingAnnualSettlementBoundary(
  state: RuntimeState,
  month: CrossedMonth,
): HoldingAnnualSettlementApplicationResult {
  if (hasHoldingAnnualSettlementReport(state, month.year)) {
    return { state: relocateAnnualReportConflictsInState(state, month.year) };
  }
  const computation = computeDueHoldingAnnualSettlement(state, month.year, month.settledAt);
  return computation
    ? applyHoldingAnnualSettlementComputation(state, computation)
    : { state };
}

function mergeMonthlyUpkeepMeta(
  current: HoldingMonthlyUpkeepMeta | undefined,
  next: HoldingMonthlyUpkeepMeta | undefined,
): HoldingMonthlyUpkeepMeta | undefined {
  if (!next) return current;
  if (!current) return next;
  return {
    status: 'applied',
    settledMonths: [...current.settledMonths, ...next.settledMonths],
    income: addDelta(current.income ?? ZERO_DELTA, next.income ?? ZERO_DELTA),
    requiredExpenses: addDelta(
      current.requiredExpenses ?? ZERO_DELTA,
      next.requiredExpenses ?? ZERO_DELTA,
    ),
    expenses: addDelta(current.expenses, next.expenses),
    netChange: addDelta(current.netChange, next.netChange),
    shortage: addDelta(current.shortage ?? ZERO_DELTA, next.shortage ?? ZERO_DELTA),
  };
}

function applyHoldingMonthlyUpkeepForMonths(
  state: RuntimeState,
  months: CrossedMonth[],
  appendSummary: boolean,
): HoldingMonthlyUpkeepApplicationResult {
  let compatibleState = state;
  const crossedMonths: CrossedMonth[] = [];
  for (const month of months) {
    if (hasHoldingMonthlyUpkeepReport(compatibleState, month.year, month.month)) {
      compatibleState = relocateMonthlyUpkeepReportConflictsInState(
        compatibleState,
        month.year,
        month.month,
      );
    } else {
      crossedMonths.push(month);
    }
  }
  if (!compatibleState.resources) return { state: compatibleState };

  if (crossedMonths.length === 0) return { state: compatibleState };

  const requiredMonthlyExpenses = calculateTroopsMonthlyUpkeep(compatibleState.troops ?? []);
  if (isZeroDelta(requiredMonthlyExpenses)) return { state: compatibleState };

  const nextState = cloneRuntimeState(compatibleState);
  let nextResources: ResourceLedger = { ...compatibleState.resources };
  let nextTroops: TroopLedgerEntry[] = cloneData(compatibleState.troops ?? []);
  const settledMonths: HoldingMonthlyUpkeepMeta['settledMonths'] = [];
  let totalIncome = { ...ZERO_DELTA };
  let totalRequiredExpenses = { ...ZERO_DELTA };
  let totalExpenses = { ...ZERO_DELTA };
  let totalNetChange = { ...ZERO_DELTA };
  let totalShortage = { ...ZERO_DELTA };

  for (const crossedMonth of crossedMonths) {
    const computation = calculateHoldingMonthlyUpkeepPreview({
      ...nextState,
      troops: nextTroops,
      resources: nextResources,
    });
    if (!computation) continue;
    nextResources = applyResourceDelta(nextResources, computation.netChange);
    nextTroops = computation.nextTroops;
    totalIncome = addDelta(totalIncome, computation.income);
    totalRequiredExpenses = addDelta(totalRequiredExpenses, computation.requiredExpenses);
    totalExpenses = addDelta(totalExpenses, computation.expenses);
    totalNetChange = addDelta(totalNetChange, computation.netChange);
    totalShortage = addDelta(totalShortage, computation.shortage);
    settledMonths.push({
      monthId: crossedMonth.monthId,
      year: crossedMonth.year,
      month: crossedMonth.month,
      settledAt: crossedMonth.settledAt,
      income: { ...computation.income },
      requiredExpenses: { ...computation.requiredExpenses },
      expenses: { ...computation.expenses },
      shortage: { ...computation.shortage },
    });
    nextState.domesticReports = [
      ...normalizeMonthlyUpkeepReportIdConflicts(
        nextState.domesticReports ?? [],
        crossedMonth.year,
        crossedMonth.month,
      ),
      buildMonthlyUpkeepReport(
        crossedMonth,
        computation.requiredExpenses,
        computation.expenses,
        computation.shortage,
        computation.income,
        computation.netChange,
      ),
    ];
  }

  nextState.resources = nextResources;
  nextState.troops = nextTroops;
  const meta: HoldingMonthlyUpkeepMeta = {
    status: 'applied',
    settledMonths,
    income: totalIncome,
    requiredExpenses: totalRequiredExpenses,
    expenses: totalExpenses,
    netChange: totalNetChange,
    shortage: totalShortage,
  };
  if (appendSummary) appendMonthlyUpkeepTurnLogSummary(nextState, meta);
  return { state: nextState, meta };
}

function computeDueHoldingAnnualSettlement(
  state: RuntimeState,
  forcedYear?: number,
  forcedSettledAt?: string,
): SettlementComputation | undefined {
  const date = getCurrentYearMonth(state);
  const year = forcedYear ?? date?.year;
  if (!year) return undefined;
  if (!forcedYear && date?.month !== 9) return undefined;

  const reportId = buildHoldingAnnualSettlementReportId(year);
  if (hasHoldingAnnualSettlementReport(state, year)) return undefined;
  if (!state.resources) return undefined;

  const hasSettlementInput = (state.holdings ?? []).some(
    (holding) => holding.status === 'controlled' || holding.status === 'temporary',
  )
    || (state.privateAssets ?? []).some(isAnnualSettlementPrivateAsset)
    || (state.privateAssetProjects ?? []).some((project) => project.status === 'active');
  if (!hasSettlementInput) return undefined;

  const settledAt = forcedSettledAt ?? state.currentDate ?? `${year}-09-01`;
  const projectCompletion = completeDuePrivateAssetProjects({
    currentDate: settledAt,
    privateAssets: state.privateAssets ?? [],
    projects: state.privateAssetProjects ?? [],
  });
  const settlement = calculateHoldingAnnualSettlement({
    year,
    settledAt,
    holdings: state.holdings ?? [],
    troops: state.troops ?? [],
    privateAssets: projectCompletion.nextPrivateAssets,
    privateAssetProjects: projectCompletion.nextProjects,
    currentResources: state.resources,
  });

  const affectedHoldingIds = (state.holdings ?? [])
    .filter((holding) => holding.status === 'controlled' || holding.status === 'temporary')
    .map((holding) => holding.holdingId);
  const completedProjectIds = projectCompletion.completedProjects.map((project) => project.projectId);
  const affectedPrivateAssetIds = uniqueStrings(
    projectCompletion.completedProjects.map((project) => project.assetId).filter(Boolean),
  );

  const report: DomesticReportEntry = {
    ...settlement.report,
    title: `${year}年内政收支`,
    summary: buildDomesticReportSummary(settlement.income, settlement.expenses, settlement.netChange, completedProjectIds),
    ...(projectCompletion.projectHighlights.length > 0
      ? { projectHighlights: projectCompletion.projectHighlights }
      : {}),
  };

  return {
    reportId,
    year,
    settledAt,
    income: settlement.income,
    expenses: settlement.expenses,
    netChange: settlement.netChange,
    nextResources: settlement.nextResources,
    nextHoldings: settlement.nextHoldings,
    nextPrivateAssets: projectCompletion.nextPrivateAssets,
    nextPrivateAssetProjects: projectCompletion.nextProjects,
    report,
    completedProjectIds,
    affectedHoldingIds,
    affectedPrivateAssetIds,
  };
}

function getCurrentYearMonth(state: RuntimeState): { year: number; month: number } | undefined {
  if (state.currentTime?.year && state.currentTime?.month) {
    return {
      year: state.currentTime.year,
      month: state.currentTime.month,
    };
  }

  const parts = state.currentDate.match(/\d+/g);
  if (!parts || parts.length < 2) return undefined;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return undefined;
  return { year, month };
}

function hasHoldingAnnualSettlementReport(state: RuntimeState, year: number): boolean {
  return (state.domesticReports ?? []).some((report) => isHoldingAnnualSettlementReport(report, year));
}

function hasHoldingMonthlyUpkeepReport(state: RuntimeState, year: number, month: number): boolean {
  return (state.domesticReports ?? []).some((report) => isHoldingMonthlyUpkeepReport(report, year, month));
}

function normalizeAnnualReportIdConflicts(
  reports: DomesticReportEntry[],
  year: number,
): DomesticReportEntry[] {
  const reportId = buildHoldingAnnualSettlementReportId(year);
  return normalizeSystemReportIdConflicts(
    reports,
    reportId,
    (report) => isHoldingAnnualSettlementReport(report, year),
  );
}

function normalizeMonthlyUpkeepReportIdConflicts(
  reports: DomesticReportEntry[],
  year: number,
  month: number,
): DomesticReportEntry[] {
  const reportId = buildHoldingMonthlyUpkeepReportId(year, month);
  return normalizeSystemReportIdConflicts(
    reports,
    reportId,
    (report) => isHoldingMonthlyUpkeepReport(report, year, month),
  );
}

function normalizeSystemReportIdConflicts(
  reports: DomesticReportEntry[],
  reportId: string,
  isCanonical: (report: DomesticReportEntry) => boolean,
): DomesticReportEntry[] {
  const canonicalReport = reports.find(isCanonical);
  const usedIds = new Set(reports.map((report) => report.reportId));
  const normalizedReports: DomesticReportEntry[] = [];
  let keptCanonical = false;
  let changed = false;

  for (const report of reports) {
    if (report.reportId !== reportId) {
      normalizedReports.push(report);
      continue;
    }

    if (isCanonical(report) && !keptCanonical) {
      keptCanonical = true;
      normalizedReports.push(report);
      continue;
    }

    if (canonicalReport && isCanonical(report) && areStructurallyEqual(report, canonicalReport)) {
      changed = true;
      continue;
    }

    const baseId = `legacy-conflict:${report.reportId}:year-${String(report.year)}`;
    let suffix = 1;
    let relocatedId = `${baseId}:${suffix}`;
    while (usedIds.has(relocatedId)) {
      suffix += 1;
      relocatedId = `${baseId}:${suffix}`;
    }
    usedIds.add(relocatedId);
    normalizedReports.push({ ...report, reportId: relocatedId });
    changed = true;
  }

  return changed ? normalizedReports : reports;
}

function relocateAnnualReportConflictsInState(state: RuntimeState, year: number): RuntimeState {
  const reports = state.domesticReports ?? [];
  const relocatedReports = normalizeAnnualReportIdConflicts(reports, year);
  return relocatedReports === reports ? state : { ...state, domesticReports: relocatedReports };
}

function relocateMonthlyUpkeepReportConflictsInState(
  state: RuntimeState,
  year: number,
  month: number,
): RuntimeState {
  const reports = state.domesticReports ?? [];
  const relocatedReports = normalizeMonthlyUpkeepReportIdConflicts(reports, year, month);
  return relocatedReports === reports ? state : { ...state, domesticReports: relocatedReports };
}

function areStructurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => areStructurallyEqual(value, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined).sort();
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) => key === rightKeys[index] && areStructurallyEqual(leftRecord[key], rightRecord[key]),
  );
}

function appendSettlementTurnLogSummary(
  state: RuntimeState,
  meta: TurnHoldingAnnualSettlementMeta,
): void {
  const latestLog = state.turnLog[state.turnLog.length - 1];
  if (!latestLog) return;

  const summary = `年度结算[${meta.reportId}]：收入${formatResourceDelta(meta.income)}；支出${formatResourceDelta(meta.expenses)}；净变${formatResourceDelta(meta.netChange)}`;
  latestLog.statePatchSummary = latestLog.statePatchSummary
    ? `${latestLog.statePatchSummary}；${summary}`
    : summary;
  latestLog.displayMeta = {
    ...latestLog.displayMeta,
    holdingAnnualSettlement: meta,
  };
}

function appendMonthlyUpkeepTurnLogSummary(
  state: RuntimeState,
  meta: HoldingMonthlyUpkeepMeta,
): void {
  const latestLog = state.turnLog[state.turnLog.length - 1];
  if (!latestLog) return;

  const months = meta.settledMonths.map(({ year, month }) => `${year}年${pad2(month)}月`).join('、');
  const incomeText = meta.income && !isZeroDelta(meta.income)
    ? `供给${formatResourceAmountList(meta.income)}；`
    : '';
  const shortageText = meta.shortage && !isZeroDelta(meta.shortage)
    ? `；缺口${formatResourceAmountList(meta.shortage)}`
    : '';
  const summary = `月度军需[${months}]：${incomeText}消耗${formatResourceAmountList(meta.expenses)}；净变${formatResourceDelta(meta.netChange)}${shortageText}`;
  latestLog.statePatchSummary = latestLog.statePatchSummary
    ? `${latestLog.statePatchSummary}；${summary}`
    : summary;
}

/**
 * 唯一的按供给来源月度军需计算入口。
 * 实际月度扣除与叙事只读投影必须共同调用此函数，禁止在提示层复制军需公式。
 */
export function calculateHoldingMonthlyUpkeepPreview(
  state: RuntimeState,
): HoldingMonthlyUpkeepPreview | undefined {
  if (!state.resources) return undefined;

  const troops = state.troops ?? [];
  const resources = state.resources;
  let income = { ...ZERO_DELTA };
  let requiredExpenses = { ...ZERO_DELTA };
  let provisionExpenses = { ...ZERO_DELTA };
  let provisionSurplus = { ...ZERO_DELTA };
  let shortage = { ...ZERO_DELTA };
  let playerRequiredExpenses = { ...ZERO_DELTA };
  let activeTroopCount = 0;
  const sourceTroopCounts: Record<HoldingMonthlyUpkeepSource, number> = {
    player_resources: 0,
    superior_provision: 0,
    mixed: 0,
  };
  const troopBreakdown: HoldingMonthlyUpkeepTroopPreview[] = [];
  const nextTroops = troops.map((troop) => ({ ...troop }));
  const troopShortageByIndex = new Map<number, DomesticReportResourceDelta>();
  const playerExpenseTroops: Array<{ index: number; required: DomesticReportResourceDelta }> = [];

  for (let index = 0; index < nextTroops.length; index += 1) {
    const troop = nextTroops[index];
    if (!isUpkeepTroop(troop)) continue;

    const required = calculateTroopMonthlyUpkeep(troop);
    if (isZeroDelta(required)) continue;

    const source = resolveTroopUpkeepSource(troop, state);
    activeTroopCount += 1;
    sourceTroopCounts[source] += 1;
    requiredExpenses = addDelta(requiredExpenses, required);
    let troopSuperiorProvision = { ...ZERO_DELTA };
    let troopPlayerRequiredExpenses = { ...ZERO_DELTA };

    if (source === 'superior_provision') {
      const provision = scaleDelta(required, getSuperiorProvisionRatio(troop));
      troopSuperiorProvision = provision;
      const coveredByProvision = minDelta(required, provision);
      const troopSurplus = subtractDelta(provision, coveredByProvision);
      const troopShortage = subtractDelta(required, coveredByProvision);
      income = addDelta(income, provision);
      provisionExpenses = addDelta(provisionExpenses, coveredByProvision);
      provisionSurplus = addDelta(provisionSurplus, troopSurplus);
      shortage = addDelta(shortage, troopShortage);
      troopShortageByIndex.set(index, troopShortage);
    } else if (source === 'mixed') {
      const provision = scaleDelta(required, getSuperiorProvisionRatio(troop) * 0.6);
      troopSuperiorProvision = provision;
      const coveredByProvision = minDelta(required, provision);
      const playerPortion = subtractDelta(required, coveredByProvision);
      troopPlayerRequiredExpenses = playerPortion;
      income = addDelta(income, provision);
      provisionExpenses = addDelta(provisionExpenses, coveredByProvision);
      playerRequiredExpenses = addDelta(playerRequiredExpenses, playerPortion);
      playerExpenseTroops.push({ index, required: playerPortion });
    } else {
      troopPlayerRequiredExpenses = required;
      playerRequiredExpenses = addDelta(playerRequiredExpenses, required);
      playerExpenseTroops.push({ index, required });
    }

    troopBreakdown.push({
      troopId: troop.troopId,
      name: troop.name,
      size: troop.size,
      ...(troop.locationId ? { locationId: troop.locationId } : {}),
      source,
      requiredExpenses: { ...required },
      superiorProvision: { ...troopSuperiorProvision },
      playerRequiredExpenses: { ...troopPlayerRequiredExpenses },
    });
  }

  const resourcesAfterProvisionSurplus = applyResourceDelta(resources, provisionSurplus);
  const playerActualExpenses = calculateAffordableExpense(resourcesAfterProvisionSurplus, playerRequiredExpenses);
  const playerShortage = subtractDelta(playerRequiredExpenses, playerActualExpenses);
  shortage = addDelta(shortage, playerShortage);
  distributePlayerShortage(playerExpenseTroops, playerShortage, playerRequiredExpenses, troopShortageByIndex);

  for (const [index, troopShortage] of troopShortageByIndex.entries()) {
    nextTroops[index] = applyTroopSupplyShortage(nextTroops[index], troopShortage);
  }

  const expenses = addDelta(provisionExpenses, playerActualExpenses);
  const netChange = subtractDelta(provisionSurplus, playerActualExpenses);
  return {
    activeTroopCount,
    sourceTroopCounts,
    income,
    requiredExpenses,
    expenses,
    playerRequiredExpenses,
    provisionSurplus,
    netChange,
    shortage,
    troopBreakdown,
    nextTroops,
  };
}

function resolveTroopUpkeepSource(
  troop: TroopLedgerEntry,
  state: RuntimeState,
): HoldingMonthlyUpkeepSource {
  if (troop.upkeepSource && troop.upkeepSource !== 'unknown') return troop.upkeepSource;
  if (troop.factionId === 'faction_player') return 'player_resources';

  const hasManagedBase = (state.holdings ?? []).some(
    (holding) => holding.status === 'controlled' || holding.status === 'temporary',
  );
  if (!hasManagedBase && isPlayerRelatedTroop(troop)) return 'superior_provision';
  return 'player_resources';
}

function isPlayerRelatedTroop(troop: TroopLedgerEntry): boolean {
  if (troop.leaderNpcId === 'player') return true;
  const text = [
    troop.relationToPlayer,
    troop.name,
    troop.specialDesignation,
    troop.sourceNote,
    troop.lastChangeReason,
    ...(troop.statusTags ?? []),
  ].join(' ');
  return /(?:self|player|own|你|主角|己方|自势力|直属|直接统领|受控|亲兵|私兵|麾下)/i.test(text);
}

function getSuperiorProvisionRatio(troop: TroopLedgerEntry): number {
  const supplies = typeof troop.supplies === 'number' ? troop.supplies : undefined;
  if (supplies === undefined) return 1;
  if (supplies >= 80) return 1.1;
  if (supplies >= 60) return 1;
  if (supplies >= 40) return 0.9;
  return 0.75;
}

function distributePlayerShortage(
  troopExpenses: Array<{ index: number; required: DomesticReportResourceDelta }>,
  playerShortage: DomesticReportResourceDelta,
  playerRequiredExpenses: DomesticReportResourceDelta,
  troopShortageByIndex: Map<number, DomesticReportResourceDelta>,
): void {
  if (isZeroDelta(playerShortage) || troopExpenses.length === 0) return;
  const ratio = calculateDeltaMagnitude(playerRequiredExpenses) > 0
    ? calculateDeltaMagnitude(playerShortage) / calculateDeltaMagnitude(playerRequiredExpenses)
    : 0;
  if (ratio <= 0) return;

  for (const troopExpense of troopExpenses) {
    const estimatedShortage = scaleDelta(troopExpense.required, ratio);
    const previousShortage = troopShortageByIndex.get(troopExpense.index) ?? { ...ZERO_DELTA };
    troopShortageByIndex.set(troopExpense.index, addDelta(previousShortage, estimatedShortage));
  }
}

function applyTroopSupplyShortage(
  troop: TroopLedgerEntry,
  shortage: DomesticReportResourceDelta,
): TroopLedgerEntry {
  if (typeof troop.supplies !== 'number' || isZeroDelta(shortage)) return troop;
  const required = calculateTroopMonthlyUpkeep(troop);
  const requiredMagnitude = calculateDeltaMagnitude(required);
  if (requiredMagnitude <= 0) return troop;
  const shortageRatio = calculateDeltaMagnitude(shortage) / requiredMagnitude;
  const penalty = Math.max(1, Math.ceil(shortageRatio * 50));
  return {
    ...troop,
    supplies: Math.max(0, Math.round(troop.supplies - penalty)),
  };
}

function calculateDeltaMagnitude(delta: DomesticReportResourceDelta): number {
  return Math.abs(delta.money)
    + Math.abs(delta.grain)
    + Math.abs(delta.horses)
    + Math.abs(delta.arms)
    + Math.abs(delta.recruits);
}

function buildDomesticReportSummary(
  income: DomesticReportResourceDelta,
  expenses: DomesticReportResourceDelta,
  netChange: DomesticReportResourceDelta,
  completedProjectIds: string[],
): string {
  const projectSummary = completedProjectIds.length > 0
    ? `到期工程 ${completedProjectIds.join('、')} 已并入本年结算。`
    : '本年无到期私产工程。';
  return `本年收入 ${formatResourceDelta(income)}；军费与维持支出 ${formatResourceDelta(expenses)}；最终净变 ${formatResourceDelta(netChange)}。${projectSummary}`;
}

function buildMonthlyUpkeepReport(
  month: CrossedMonth,
  requiredExpenses: DomesticReportResourceDelta,
  expenses: DomesticReportResourceDelta,
  shortage: DomesticReportResourceDelta,
  income: DomesticReportResourceDelta = { ...ZERO_DELTA },
  netChange: DomesticReportResourceDelta = subtractDelta(income, expenses),
): DomesticReportEntry {
  const hasShortage = !isZeroDelta(shortage);
  const hasIncome = !isZeroDelta(income);
  const provisionText = hasIncome
    ? `；上级或外部供给 ${formatResourceAmountList(income)}`
    : '';
  const netText = `；库存净变 ${formatResourceDelta(netChange)}`;
  const summary = hasShortage
    ? `本月部队粮草、军饷、马匹和军械维持应支出 ${formatResourceAmountList(requiredExpenses)}${provisionText}；实际消耗 ${formatResourceAmountList(expenses)}${netText}；缺口 ${formatResourceAmountList(shortage)}。`
    : `本月部队粮草、军饷、马匹和军械维持应支出 ${formatResourceAmountList(requiredExpenses)}${provisionText}；实际消耗 ${formatResourceAmountList(expenses)}${netText}。`;
  return {
    reportId: month.monthId,
    source: 'system',
    kind: HOLDING_MONTHLY_UPKEEP_KIND,
    year: `${month.year}-${pad2(month.month)}`,
    settledAt: month.settledAt,
    title: `${month.year}年${pad2(month.month)}月军需消耗`,
    summary,
    income: { ...income },
    expenses: { ...expenses },
    netChange,
    ...(hasShortage ? { warnings: [`军需缺口：${formatResourceAmountList(shortage)}`] } : {}),
    readByPlayer: false,
  };
}

function formatResourceDelta(delta: DomesticReportResourceDelta): string {
  const parts = [
    ['钱财', delta.money],
    ['粮草', delta.grain],
    ['马匹', delta.horses],
    ['军械', delta.arms],
    ['可征召人手', delta.recruits],
  ]
    .filter(([, value]) => value !== 0)
    .map(([label, value]) => `${label}${formatSignedNumber(Number(value))}`);

  return parts.length > 0 ? parts.join('、') : '无变化';
}

function formatSignedNumber(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatResourceAmountList(delta: DomesticReportResourceDelta): string {
  const parts = [
    ['钱财', delta.money, '贯'],
    ['粮草', delta.grain, '石'],
    ['马匹', delta.horses, ''],
    ['军械', delta.arms, ''],
    ['可征召人手', delta.recruits, '人'],
  ]
    .filter(([, value]) => value !== 0)
    .map(([label, value, unit]) => `${label}${Number(value)}${unit}`);

  return parts.length > 0 ? parts.join('、') : '无';
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

interface CrossedMonth {
  year: number;
  month: number;
  monthId: string;
  settledAt: string;
}

function listCrossedMonths(previousState: RuntimeState, currentState: RuntimeState): CrossedMonth[] {
  const previous = getClockMonth(previousState);
  const current = getClockMonth(currentState);
  if (!previous || !current) return [];

  const previousIndex = monthIndex(previous.year, previous.month);
  const currentIndex = monthIndex(current.year, current.month);
  if (currentIndex <= previousIndex) return [];

  const months: CrossedMonth[] = [];
  for (let index = previousIndex + 1; index <= currentIndex; index += 1) {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    months.push({
      year,
      month,
      monthId: buildHoldingMonthlyUpkeepReportId(year, month),
      settledAt: `${year}-${pad2(month)}-01 08:00`,
    });
  }
  return months;
}

function getClockMonth(state: RuntimeState): { year: number; month: number } | undefined {
  if (state.currentTime?.year && state.currentTime?.month) {
    return { year: state.currentTime.year, month: state.currentTime.month };
  }
  return getCurrentYearMonth(state);
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function isZeroDelta(delta: DomesticReportResourceDelta): boolean {
  return delta.money === 0
    && delta.grain === 0
    && delta.horses === 0
    && delta.arms === 0
    && delta.recruits === 0;
}

function addDelta(
  current: DomesticReportResourceDelta,
  next: DomesticReportResourceDelta,
): DomesticReportResourceDelta {
  return {
    money: current.money + next.money,
    grain: current.grain + next.grain,
    horses: current.horses + next.horses,
    arms: current.arms + next.arms,
    recruits: current.recruits + next.recruits,
  };
}

function subtractDelta(
  current: DomesticReportResourceDelta,
  next: DomesticReportResourceDelta,
): DomesticReportResourceDelta {
  return {
    money: current.money - next.money,
    grain: current.grain - next.grain,
    horses: current.horses - next.horses,
    arms: current.arms - next.arms,
    recruits: current.recruits - next.recruits,
  };
}

function minDelta(
  current: DomesticReportResourceDelta,
  next: DomesticReportResourceDelta,
): DomesticReportResourceDelta {
  return {
    money: Math.min(current.money, next.money),
    grain: Math.min(current.grain, next.grain),
    horses: Math.min(current.horses, next.horses),
    arms: Math.min(current.arms, next.arms),
    recruits: Math.min(current.recruits, next.recruits),
  };
}

function scaleDelta(delta: DomesticReportResourceDelta, ratio: number): DomesticReportResourceDelta {
  return {
    money: Math.max(0, Math.round(delta.money * ratio)),
    grain: Math.max(0, Math.round(delta.grain * ratio)),
    horses: Math.max(0, Math.round(delta.horses * ratio)),
    arms: Math.max(0, Math.round(delta.arms * ratio)),
    recruits: Math.max(0, Math.round(delta.recruits * ratio)),
  };
}

function applyResourceDelta(resources: ResourceLedger, delta: DomesticReportResourceDelta): ResourceLedger {
  return {
    ...resources,
    money: Math.max(0, resources.money + delta.money),
    grain: Math.max(0, resources.grain + delta.grain),
    horses: Math.max(0, resources.horses + delta.horses),
    arms: Math.max(0, resources.arms + delta.arms),
    recruits: Math.max(0, resources.recruits + delta.recruits),
  };
}

function calculateAffordableExpense(
  resources: ResourceLedger,
  required: DomesticReportResourceDelta,
): DomesticReportResourceDelta {
  return {
    money: Math.min(resources.money, required.money),
    grain: Math.min(resources.grain, required.grain),
    horses: Math.min(resources.horses, required.horses),
    arms: Math.min(resources.arms, required.arms),
    recruits: Math.min(resources.recruits, required.recruits),
  };
}

function cloneRuntimeState(state: RuntimeState): RuntimeState {
  return JSON.parse(JSON.stringify(state)) as RuntimeState;
}

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeHoldingsById(
  current: HoldingLedgerEntry[],
  updates: HoldingLedgerEntry[],
): HoldingLedgerEntry[] {
  return mergeById(current, updates, (holding) => holding.holdingId);
}

function mergePrivateAssetsById(
  current: PrivateAssetEntry[],
  updates: PrivateAssetEntry[],
): PrivateAssetEntry[] {
  return mergeById(current, updates, (asset) => asset.privateAssetId);
}

function mergePrivateAssetProjectsById(
  current: PrivateAssetProjectEntry[],
  updates: PrivateAssetProjectEntry[],
): PrivateAssetProjectEntry[] {
  return mergeById(current, updates, (project) => project.projectId);
}

function mergeById<T>(
  current: T[],
  updates: T[],
  getId: (value: T) => string,
): T[] {
  const updateById = new Map(updates.map((value) => [getId(value), value]));
  const merged = current.map((value) => {
    const id = getId(value);
    return updateById.get(id) ?? value;
  });
  const currentIds = new Set(current.map(getId));
  updates.forEach((value) => {
    if (!currentIds.has(getId(value))) {
      merged.push(value);
    }
  });
  return merged;
}
