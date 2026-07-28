import type { DomesticReportEntry } from './types';

export const SYSTEM_DOMESTIC_REPORT_ID_PREFIX = 'system:';
export const HOLDING_ANNUAL_SETTLEMENT_KIND = 'holdingAnnualSettlement';
export const HOLDING_MONTHLY_UPKEEP_KIND = 'holdingMonthlyUpkeep';

interface DomesticReportIdentityLike {
  reportId?: unknown;
  year?: unknown;
  source?: unknown;
  kind?: unknown;
}

const LEGACY_ANNUAL_SETTLEMENT_RESOURCE_KEYS = [
  'money',
  'grain',
  'horses',
  'arms',
  'recruits',
] as const;

export function buildHoldingAnnualSettlementReportId(year: number | string): string {
  return `${SYSTEM_DOMESTIC_REPORT_ID_PREFIX}holding-annual:${String(year)}`;
}

export function buildHoldingMonthlyUpkeepReportId(
  year: number | string,
  month: number | string,
): string {
  return `${SYSTEM_DOMESTIC_REPORT_ID_PREFIX}holding-monthly-upkeep:${String(year)}-${String(month).padStart(2, '0')}`;
}

export function claimsReservedSystemDomesticReportIdentity(report: DomesticReportIdentityLike): boolean {
  return normalizeIdentityToken(report.reportId).startsWith(SYSTEM_DOMESTIC_REPORT_ID_PREFIX)
    || normalizeIdentityToken(report.source) === 'system'
    || normalizeIdentityToken(report.kind) === HOLDING_ANNUAL_SETTLEMENT_KIND.toLowerCase()
    || normalizeIdentityToken(report.kind) === HOLDING_MONTHLY_UPKEEP_KIND.toLowerCase();
}

export function isHoldingMonthlyUpkeepReport(
  report: DomesticReportEntry,
  year: number | string,
  month: number | string,
): boolean {
  return report.reportId === buildHoldingMonthlyUpkeepReportId(year, month)
    && String(report.year) === `${String(year)}-${String(month).padStart(2, '0')}`
    && report.source === 'system'
    && report.kind === HOLDING_MONTHLY_UPKEEP_KIND;
}

export function isHoldingAnnualSettlementReport(
  report: DomesticReportEntry,
  year: number | string,
): boolean {
  return report.reportId === buildHoldingAnnualSettlementReportId(year)
    && String(report.year) === String(year)
    && report.source === 'system'
    && report.kind === HOLDING_ANNUAL_SETTLEMENT_KIND;
}

export function isLegacyHoldingAnnualSettlementReport(report: DomesticReportEntry): boolean {
  const year = String(report.year);
  if (report.reportId !== `domestic_${year}`) return false;
  if (report.source !== undefined || report.kind !== undefined) return false;
  if (report.title !== `${year}年内政收支`) return false;
  if (!isReasonableLegacySeptemberDate(report.settledAt, year)) return false;
  if (!hasCompleteNumericDelta(report.income)
    || !hasCompleteNumericDelta(report.expenses)
    || !hasCompleteNumericDelta(report.netChange)) return false;
  if (!hasConsistentNetChange(report)) return false;

  const summaryPrefix = `本年收入 ${formatLegacyResourceDelta(report.income)}`
    + `；军费与维持支出 ${formatLegacyResourceDelta(report.expenses)}`
    + `；最终净变 ${formatLegacyResourceDelta(report.netChange)}。`;
  if (!report.summary.startsWith(summaryPrefix)) return false;

  const projectSummary = report.summary.slice(summaryPrefix.length);
  return projectSummary === '本年无到期私产工程。'
    || (projectSummary.startsWith('到期工程 ')
      && projectSummary.endsWith(' 已并入本年结算。')
      && projectSummary.length > '到期工程  已并入本年结算。'.length);
}

function hasCompleteNumericDelta(value: unknown): value is DomesticReportEntry['income'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return LEGACY_ANNUAL_SETTLEMENT_RESOURCE_KEYS.every(
    (key) => typeof record[key] === 'number' && Number.isFinite(record[key]),
  );
}

function hasConsistentNetChange(report: DomesticReportEntry): boolean {
  return LEGACY_ANNUAL_SETTLEMENT_RESOURCE_KEYS.every(
    (key) => report.netChange[key] === report.income[key] - report.expenses[key],
  );
}

function isReasonableLegacySeptemberDate(value: unknown, year: string): boolean {
  if (typeof value !== 'string') return false;
  const parts = value.match(/\d+/g)?.map(Number) ?? [];
  if (parts.length < 2 || !Number.isFinite(Number(year))) return false;
  if (parts[0] !== Number(year) || parts[1] !== 9) return false;
  return parts[2] === undefined || (parts[2] >= 1 && parts[2] <= 30);
}

function formatLegacyResourceDelta(delta: DomesticReportEntry['income']): string {
  const labels: Record<(typeof LEGACY_ANNUAL_SETTLEMENT_RESOURCE_KEYS)[number], string> = {
    money: '钱财',
    grain: '粮草',
    horses: '马匹',
    arms: '军械',
    recruits: '可征召人手',
  };
  const parts = LEGACY_ANNUAL_SETTLEMENT_RESOURCE_KEYS
    .filter((key) => delta[key] !== 0)
    .map((key) => `${labels[key]}${delta[key] > 0 ? '+' : ''}${String(delta[key])}`);
  return parts.length > 0 ? parts.join('、') : '无变化';
}

function normalizeIdentityToken(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
