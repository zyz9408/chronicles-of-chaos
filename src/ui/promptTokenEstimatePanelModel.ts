import {
  getPromptRegistry,
  type PromptEditLevel,
  type PromptRegistryCategory,
  type PromptRegistryEntry,
  type PromptRiskLevel,
} from '../engine/prompts/PromptRegistry';
import { getPromptOverride } from '../engine/prompts/PromptOverrideStore';
import { estimatePromptTokens, type TokenEstimateResult } from '../engine/prompts/PromptTokenEstimator';
import { getEditLevelLabel, getPromptCategoryLabel, getRiskLevelLabel } from './promptRegistryPanelModel';

export interface PromptTokenEstimateRow extends TokenEstimateResult {
  promptId: string;
  title: string;
  category: PromptRegistryCategory;
  categoryZh: string;
  riskLevel: PromptRiskLevel;
  riskLevelZh: string;
  editLevel: PromptEditLevel;
  editLevelZh: string;
  isCustomized: boolean;
  isHighRisk: boolean;
  isLocked: boolean;
  order: number;
  defaultChars: number;
  overrideChars: number;
}

export interface PromptTokenCategorySummary extends TokenEstimateResult {
  category: PromptRegistryCategory;
  categoryZh: string;
  entryCount: number;
  customizedCount: number;
  highOrLockedCount: number;
  order: number;
}

export interface PromptTokenEstimatePanelModel {
  rows: PromptTokenEstimateRow[];
  categorySummaries: PromptTokenCategorySummary[];
  defaultTotals: TokenEstimateResult;
  overrideTotals: TokenEstimateResult;
  effectiveTotals: TokenEstimateResult;
  customizedCount: number;
  highRiskCustomizedCount: number;
  highTokenRows: PromptTokenEstimateRow[];
  isTotalHigh: boolean;
}

export interface PromptTokenEstimatePanelModelOptions {
  storage?: Storage;
}

const HIGH_ROW_TOKEN_THRESHOLD = 4000;
const HIGH_TOTAL_TOKEN_THRESHOLD = 20000;

function getDefaultPromptContent(entry: PromptRegistryEntry): string {
  return entry.defaultContent ?? entry.defaultContentTemplate ?? '';
}

function hasEstimateContent(entry: PromptRegistryEntry): boolean {
  return getDefaultPromptContent(entry).trim().length > 0;
}

function addEstimates(estimates: TokenEstimateResult[]): TokenEstimateResult {
  return estimates.reduce<TokenEstimateResult>(
    (total, estimate) => ({
      chars: total.chars + estimate.chars,
      estimatedTokens: total.estimatedTokens + estimate.estimatedTokens,
      lowerBound: total.lowerBound + estimate.lowerBound,
      upperBound: total.upperBound + estimate.upperBound,
    }),
    {
      chars: 0,
      estimatedTokens: 0,
      lowerBound: 0,
      upperBound: 0,
    },
  );
}

function isHighRiskOrLocked(entry: PromptRegistryEntry): boolean {
  return entry.riskLevel === 'high' || entry.editLevel === 'locked' || entry.protocolBound;
}

export function getPromptTokenEstimateRows(
  options: PromptTokenEstimatePanelModelOptions = {},
): PromptTokenEstimateRow[] {
  return getPromptRegistry()
    .filter(hasEstimateContent)
    .map((entry) => {
      const defaultContent = getDefaultPromptContent(entry);
      const override = getPromptOverride(entry.id, options.storage);
      const effectiveContent = override?.content ?? defaultContent;
      const estimate = estimatePromptTokens(effectiveContent);
      const highRisk = isHighRiskOrLocked(entry);

      return {
        promptId: entry.id,
        title: entry.displayTitleZh ?? entry.title,
        category: entry.category,
        categoryZh: entry.displayCategoryZh ?? getPromptCategoryLabel(entry.category),
        riskLevel: entry.riskLevel,
        riskLevelZh: getRiskLevelLabel(entry.riskLevel),
        editLevel: entry.editLevel,
        editLevelZh: getEditLevelLabel(entry.editLevel),
        isCustomized: Boolean(override),
        isHighRisk: highRisk,
        isLocked: entry.editLevel === 'locked' || entry.protocolBound,
        order: entry.order,
        defaultChars: Array.from(defaultContent).length,
        overrideChars: override ? Array.from(override.content).length : 0,
        ...estimate,
      };
    })
    .sort((left, right) => (
      Number(right.isCustomized) - Number(left.isCustomized)
      || right.estimatedTokens - left.estimatedTokens
      || left.category.localeCompare(right.category)
      || left.order - right.order
    ));
}

export function getPromptTokenCategorySummaries(rows: PromptTokenEstimateRow[]): PromptTokenCategorySummary[] {
  const categories = new Map<PromptRegistryCategory, PromptTokenEstimateRow[]>();

  for (const row of rows) {
    categories.set(row.category, [...(categories.get(row.category) ?? []), row]);
  }

  return Array.from(categories.entries())
    .map(([category, categoryRows]) => ({
      category,
      categoryZh: categoryRows[0]?.categoryZh ?? getPromptCategoryLabel(category),
      entryCount: categoryRows.length,
      customizedCount: categoryRows.filter((row) => row.isCustomized).length,
      highOrLockedCount: categoryRows.filter((row) => row.isHighRisk || row.isLocked).length,
      order: Math.min(...categoryRows.map((row) => row.order)),
      ...addEstimates(categoryRows),
    }))
    .sort((left, right) => right.estimatedTokens - left.estimatedTokens || left.order - right.order);
}

export function getPromptTokenEstimatePanelModel(
  options: PromptTokenEstimatePanelModelOptions = {},
): PromptTokenEstimatePanelModel {
  const rows = getPromptTokenEstimateRows(options);
  const overrideEstimates = rows
    .filter((row) => row.isCustomized)
    .map((row) => estimatePromptTokens(getPromptOverride(row.promptId, options.storage)?.content ?? ''));
  const defaultEstimates = getPromptRegistry()
    .filter(hasEstimateContent)
    .map((entry) => estimatePromptTokens(getDefaultPromptContent(entry)));
  const effectiveTotals = addEstimates(rows);

  return {
    rows,
    categorySummaries: getPromptTokenCategorySummaries(rows),
    defaultTotals: addEstimates(defaultEstimates),
    overrideTotals: addEstimates(overrideEstimates),
    effectiveTotals,
    customizedCount: rows.filter((row) => row.isCustomized).length,
    highRiskCustomizedCount: rows.filter((row) => row.isCustomized && (row.isHighRisk || row.isLocked)).length,
    highTokenRows: rows.filter((row) => row.estimatedTokens >= HIGH_ROW_TOKEN_THRESHOLD),
    isTotalHigh: effectiveTotals.estimatedTokens >= HIGH_TOTAL_TOKEN_THRESHOLD,
  };
}
