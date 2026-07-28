import type {
  DomesticReportEntry,
  DomesticReportPrivateAssetHighlight,
  DomesticReportProjectHighlight,
  DomesticReportResourceDelta,
  HoldingLedgerEntry,
  PrivateAssetEntry,
  PrivateAssetProjectEntry,
  ResourceLedger,
  TroopLedgerEntry,
} from '../types';
import {
  buildHoldingAnnualSettlementReportId,
  HOLDING_ANNUAL_SETTLEMENT_KIND,
} from '../domesticReports';
import { isCurrentTroopLedgerEntry } from '../state/troopLifecycle';
import {
  holdingHasLandAdministration,
  normalizeLegacyHoldingCivilAdministration,
  resolveHoldingCivilAdministrationScope,
} from './HoldingCivilAdministration';

export type HoldingLevyType = keyof DomesticReportResourceDelta;
export type HoldingLevyIntensity = 'light' | 'medium' | 'heavy' | 'exhaustive';

export interface HoldingAnnualSettlementInput {
  year: number | string;
  settledAt: string;
  holdings: HoldingLedgerEntry[];
  troops: TroopLedgerEntry[];
  privateAssets?: PrivateAssetEntry[];
  privateAssetProjects?: PrivateAssetProjectEntry[];
  currentResources: ResourceLedger;
}

export interface HoldingAnnualSettlementResult {
  income: DomesticReportResourceDelta;
  expenses: DomesticReportResourceDelta;
  netChange: DomesticReportResourceDelta;
  nextResources: ResourceLedger;
  nextHoldings: HoldingLedgerEntry[];
  report: DomesticReportEntry;
}

export interface EmergencyHoldingLevyInput {
  holding: HoldingLedgerEntry;
  levyType: HoldingLevyType;
  intensity: HoldingLevyIntensity;
  repeatedThisYear?: boolean;
}

export interface EmergencyHoldingLevyResult {
  resourceGain: DomesticReportResourceDelta;
  nextHolding: HoldingLedgerEntry;
  warnings: string[];
}

export interface PrivateAssetProjectCompletionInput {
  currentDate: string;
  privateAssets: PrivateAssetEntry[];
  projects: PrivateAssetProjectEntry[];
}

export interface PrivateAssetProjectCompletionResult {
  nextPrivateAssets: PrivateAssetEntry[];
  nextProjects: PrivateAssetProjectEntry[];
  completedProjects: PrivateAssetProjectEntry[];
  projectHighlights: DomesticReportProjectHighlight[];
}

export interface HoldingOutputProjection {
  estimatedOutput: DomesticReportResourceDelta;
  actualCollection: DomesticReportResourceDelta;
  collectionRate: {
    money: number;
    grain: number;
  };
}

const ZERO_DELTA: DomesticReportResourceDelta = {
  money: 0,
  grain: 0,
  horses: 0,
  arms: 0,
  recruits: 0,
};

const SCALE_BASE_YIELD: Record<HoldingLedgerEntry['scaleLevel'], DomesticReportResourceDelta> = {
  1: { money: 20, grain: 1000, horses: 5, arms: 20, recruits: 80 },
  2: { money: 60, grain: 3000, horses: 12, arms: 60, recruits: 200 },
  3: { money: 160, grain: 8000, horses: 30, arms: 160, recruits: 500 },
  4: { money: 400, grain: 20000, horses: 70, arms: 400, recruits: 1200 },
  5: { money: 1000, grain: 50000, horses: 150, arms: 1000, recruits: 3000 },
};

const SCALE_BASE_FARMLAND_MU: Record<HoldingLedgerEntry['scaleLevel'], number> = {
  1: 1500,
  2: 4500,
  3: 12000,
  4: 30000,
  5: 70000,
};

const SCALE_BASE_HOUSEHOLDS: Record<HoldingLedgerEntry['scaleLevel'], number> = {
  1: 250,
  2: 700,
  3: 1800,
  4: 4200,
  5: 10000,
};

const LEVY_MULTIPLIERS: Record<HoldingLevyIntensity, number> = {
  light: 0.2,
  medium: 0.4,
  heavy: 0.7,
  exhaustive: 1,
};

export function calculateHoldingAnnualSettlement(
  input: HoldingAnnualSettlementInput,
): HoldingAnnualSettlementResult {
  const normalizedHoldings = input.holdings.map(normalizeLegacyHoldingCivilAdministration);
  const holdingIncome = normalizedHoldings
    .filter(isIncomeHolding)
    .map(calculateHoldingIncome)
    .reduce(addDelta, { ...ZERO_DELTA });
  const privateAssetHighlights = buildPrivateAssetHighlights(input.privateAssets ?? []);
  const privateIncome = (input.privateAssets ?? [])
    .filter(isAnnualSettlementPrivateAsset)
    .map(calculatePrivateAssetIncome)
    .reduce(addDelta, { ...ZERO_DELTA });
  const income = addDelta(holdingIncome, privateIncome);
  const expenses = { ...ZERO_DELTA };
  const netChange = subtractDelta(income, expenses);
  const nextResources = applyDeltaToResources(input.currentResources, netChange);
  const nextHoldings = normalizedHoldings.map((holding) => (
    isIncomeHolding(holding)
      ? { ...holding, corruption: clampScore((holding.corruption ?? 0) + 3) }
      : { ...holding }
  ));
  const warningMessages = buildSettlementWarnings(nextHoldings, netChange);

  return {
    income,
    expenses,
    netChange,
    nextResources,
    nextHoldings,
    report: {
      reportId: buildHoldingAnnualSettlementReportId(input.year),
      source: 'system',
      kind: HOLDING_ANNUAL_SETTLEMENT_KIND,
      year: input.year,
      settledAt: input.settledAt,
      title: `${String(input.year)} annual domestic report`,
      summary: buildReportSummary(income, expenses, netChange),
      income,
      expenses,
      netChange,
      holdingHighlights: nextHoldings
        .filter(isIncomeHolding)
        .map((holding) => ({
          holdingId: holding.holdingId,
          summary: buildHoldingHighlight(holding),
        })),
      ...(privateAssetHighlights.length > 0 ? { privateAssetHighlights } : {}),
      ...(warningMessages.length > 0 ? { warnings: warningMessages } : {}),
      readByPlayer: false,
    },
  };
}

export function completeDuePrivateAssetProjects(
  input: PrivateAssetProjectCompletionInput,
): PrivateAssetProjectCompletionResult {
  const assetById = new Map(input.privateAssets.map((asset) => [asset.privateAssetId, asset]));
  const completedProjects: PrivateAssetProjectEntry[] = [];
  const projectHighlights: DomesticReportProjectHighlight[] = [];
  const updatedAssets = new Map<string, PrivateAssetEntry>();

  const nextProjects = input.projects.map((project) => {
    if (!isCompletableProject(project, input.currentDate) || !assetById.has(project.assetId)) {
      return { ...project };
    }

    const currentAsset = updatedAssets.get(project.assetId) ?? assetById.get(project.assetId);
    if (!currentAsset) return { ...project };

    const nextAsset = applyProjectDelta(currentAsset, project, input.currentDate);
    updatedAssets.set(project.assetId, nextAsset);
    const completedProject: PrivateAssetProjectEntry = {
      ...project,
      status: 'completed',
      updatedAt: input.currentDate,
    };
    completedProjects.push(completedProject);
    projectHighlights.push({
      projectId: project.projectId,
      assetId: project.assetId,
      summary: `${project.title} completed for ${nextAsset.name}.`,
    });
    return completedProject;
  });

  const nextPrivateAssets = input.privateAssets.map((asset) => (
    updatedAssets.get(asset.privateAssetId) ?? { ...asset }
  ));

  return {
    nextPrivateAssets,
    nextProjects,
    completedProjects,
    projectHighlights,
  };
}

export function applyEmergencyHoldingLevy(input: EmergencyHoldingLevyInput): EmergencyHoldingLevyResult {
  const holding = normalizeLegacyHoldingCivilAdministration(input.holding);
  const baseIncome = calculateHoldingIncome(holding);
  const multiplier = LEVY_MULTIPLIERS[input.intensity];
  const availableBase = baseIncome[input.levyType];
  const resourceGain = {
    ...ZERO_DELTA,
    [input.levyType]: availableBase > 0
      ? Math.max(1, Math.round(availableBase * multiplier))
      : 0,
  };
  if (availableBase <= 0) {
    return {
      resourceGain,
      nextHolding: holding,
      warnings: [`holding has no ${input.levyType} civil yield to levy`],
    };
  }
  const repeatedPenalty = input.repeatedThisYear ? 1 : 0;
  const severity = input.intensity === 'light'
    ? 1
    : input.intensity === 'medium'
      ? 2
      : input.intensity === 'heavy'
        ? 3
        : 4;
  const nextHolding: HoldingLedgerEntry = {
    ...holding,
    publicOrder: clampScore(holding.publicOrder - severity * 2 - repeatedPenalty * 4),
    popularSupport: clampScore(holding.popularSupport - severity * 3 - repeatedPenalty * 5),
    agriculture: input.levyType === 'grain'
      ? clampScore(holding.agriculture - severity * 2)
      : holding.agriculture,
    commerce: input.levyType === 'money'
      ? clampScore(holding.commerce - severity * 2)
      : holding.commerce,
    population: input.levyType === 'recruits'
      ? clampScore(holding.population - severity * 2)
      : holding.population,
    recruitPotential: input.levyType === 'recruits'
      ? clampScore(holding.recruitPotential - severity * 3)
      : holding.recruitPotential,
    armory: input.levyType === 'arms'
      ? clampScore(holding.armory - severity * 2)
      : holding.armory,
    horseSupply: input.levyType === 'horses'
      ? clampScore(holding.horseSupply - severity * 2)
      : holding.horseSupply,
    corruption: clampScore((holding.corruption ?? 0) + severity * 4 + repeatedPenalty * 5),
    recentChanges: [
      ...(input.holding.recentChanges ?? []),
      `${input.intensity} emergency levy: ${input.levyType}`,
    ],
  };
  const warnings = [
    input.intensity === 'heavy' || input.intensity === 'exhaustive'
      ? 'Emergency levy is harsh and may cause local unrest.'
      : '',
    input.repeatedThisYear ? 'repeated levy in the same year' : '',
  ].filter(Boolean);

  return {
    resourceGain,
    nextHolding,
    warnings,
  };
}

function isIncomeHolding(holding: HoldingLedgerEntry): boolean {
  return (
    holding.status === 'controlled'
    || holding.status === 'temporary'
  ) && resolveHoldingCivilAdministrationScope(holding) !== 'none';
}

export function isAnnualSettlementPrivateAsset(asset: PrivateAssetEntry): boolean {
  return asset.status === 'active' || asset.status === 'damaged';
}

export function isUpkeepTroop(troop: TroopLedgerEntry): boolean {
  return isCurrentTroopLedgerEntry(troop);
}

export function calculateHoldingOutputProjection(holding: HoldingLedgerEntry): HoldingOutputProjection {
  const civilScope = resolveHoldingCivilAdministrationScope(holding);
  if (civilScope === 'none') {
    return {
      estimatedOutput: { ...ZERO_DELTA },
      actualCollection: { ...ZERO_DELTA },
      collectionRate: { money: 1, grain: 1 },
    };
  }

  const hasLandAdministration = holdingHasLandAdministration(holding);
  const legacyIncome = calculateLegacyHoldingIncome(holding);
  if (!hasLocalEliteEconomyFields(holding)) {
    const scopedLegacyIncome = hasLandAdministration
      ? legacyIncome
      : { ...legacyIncome, grain: 0 };
    return {
      estimatedOutput: scopedLegacyIncome,
      actualCollection: scopedLegacyIncome,
      collectionRate: { money: 1, grain: 1 },
    };
  }

  const base = SCALE_BASE_YIELD[holding.scaleLevel];
  const farmlandFactor = hasLandAdministration && holding.farmlandMu !== undefined
    ? clampRatio(holding.farmlandMu / SCALE_BASE_FARMLAND_MU[holding.scaleLevel], 0.3, 3)
    : 1;
  const householdFactor = holding.registeredHouseholds !== undefined
    ? clampRatio(holding.registeredHouseholds / SCALE_BASE_HOUSEHOLDS[holding.scaleLevel], 0.3, 3)
    : 1;
  const populationModifier = 0.5 + holding.population / 200;
  const executionModifier = 0.5 + (holding.publicOrder + holding.popularSupport) / 400;
  const corruptionModifier = Math.max(0.4, 1 - (holding.corruption ?? 0) * 0.005);
  const eliteModifier = calculateEliteCollectionModifier(holding);

  const estimatedOutput = {
    grain: hasLandAdministration
      ? roundResource(base.grain * scoreFactor(holding.agriculture) * farmlandFactor)
      : 0,
    money: roundResource(base.money * scoreFactor(holding.commerce) * householdFactor * populationModifier),
    recruits: legacyIncome.recruits,
    horses: legacyIncome.horses,
    arms: legacyIncome.arms,
  };
  const collectionModifier = executionModifier * corruptionModifier * eliteModifier;
  const actualCollection = {
    grain: roundResource(estimatedOutput.grain * collectionModifier),
    money: roundResource(estimatedOutput.money * collectionModifier),
    recruits: legacyIncome.recruits,
    horses: legacyIncome.horses,
    arms: legacyIncome.arms,
  };

  return {
    estimatedOutput,
    actualCollection,
    collectionRate: {
      money: calculateCollectionRate(actualCollection.money, estimatedOutput.money),
      grain: calculateCollectionRate(actualCollection.grain, estimatedOutput.grain),
    },
  };
}

function calculateHoldingIncome(holding: HoldingLedgerEntry): DomesticReportResourceDelta {
  return calculateHoldingOutputProjection(holding).actualCollection;
}

function calculateLegacyHoldingIncome(holding: HoldingLedgerEntry): DomesticReportResourceDelta {
  const base = SCALE_BASE_YIELD[holding.scaleLevel];
  const populationModifier = 0.5 + holding.population / 200;
  const stabilityModifier = 0.5 + (holding.publicOrder + holding.popularSupport) / 400;
  const corruptionModifier = Math.max(0.4, 1 - (holding.corruption ?? 0) * 0.005);

  return {
    grain: roundResource(base.grain * scoreFactor(holding.agriculture) * populationModifier * stabilityModifier * corruptionModifier),
    money: roundResource(base.money * scoreFactor(holding.commerce) * populationModifier * stabilityModifier * corruptionModifier),
    recruits: roundResource(base.recruits * scoreFactor(holding.recruitPotential) * scoreFactor(holding.popularSupport) * scoreFactor(holding.publicOrder)),
    horses: roundResource(base.horses * scoreFactor(holding.horseSupply) * stabilityModifier),
    arms: roundResource(base.arms * scoreFactor(holding.armory) * stabilityModifier),
  };
}

function hasLocalEliteEconomyFields(holding: HoldingLedgerEntry): boolean {
  return holding.farmlandMu !== undefined
    || holding.registeredHouseholds !== undefined
    || holding.eliteControlledShare !== undefined
    || holding.localEliteRelation !== undefined;
}

function calculateEliteCollectionModifier(holding: HoldingLedgerEntry): number {
  const controlledShare = clampRatio((holding.eliteControlledShare ?? 0) / 100, 0, 1);
  const relation = Math.max(-100, Math.min(100, holding.localEliteRelation ?? 0));
  const interceptionRate = clampRatio(0.45 - relation * 0.0025, 0.2, 0.7);
  return clampRatio(1 - controlledShare * interceptionRate, 0.2, 1);
}

function calculateCollectionRate(actual: number, estimated: number): number {
  if (estimated <= 0) return 1;
  return Math.round((actual / estimated) * 100) / 100;
}

function calculatePrivateAssetIncome(asset: PrivateAssetEntry): DomesticReportResourceDelta {
  const conditionMultiplier = asset.status === 'damaged' ? 0.5 : 1;
  const mu = Math.max(0, asset.mu ?? 0);
  const households = Math.max(0, asset.households ?? 0);
  const workers = Math.max(0, asset.workers ?? 0);
  const workshopScale = Math.max(0, asset.workshopScale ?? 0);
  const ranchCapacity = Math.max(0, asset.ranchCapacity ?? 0);

  const grainFromLand = mu * 1.6 + households * 18;
  const moneyFromTenants = households * 1.2 + workers * 0.4;
  const armsFromWorkshop = workshopScale * 12 + workers * (asset.type === 'workshop' ? 0.2 : 0.05);
  const horsesFromRanch = ranchCapacity * (asset.type === 'ranch' ? 0.18 : 0.08);

  return {
    money: roundResource((moneyFromTenants + workshopScale * 4) * conditionMultiplier),
    grain: roundResource(grainFromLand * conditionMultiplier),
    horses: roundResource(horsesFromRanch * conditionMultiplier),
    arms: roundResource(armsFromWorkshop * conditionMultiplier),
    recruits: 0,
  };
}

function buildPrivateAssetHighlights(
  assets: PrivateAssetEntry[],
): DomesticReportPrivateAssetHighlight[] {
  return assets.filter(isAnnualSettlementPrivateAsset).map((asset) => ({
    privateAssetId: asset.privateAssetId,
    summary: `${asset.name}: ${asset.summary}`,
  }));
}

function isCompletableProject(project: PrivateAssetProjectEntry, currentDate: string): boolean {
  if (project.status !== 'active') return false;
  if (!project.expectedCompleteAt) return false;
  return compareLooseDates(project.expectedCompleteAt, currentDate) <= 0;
}

function applyProjectDelta(
  asset: PrivateAssetEntry,
  project: PrivateAssetProjectEntry,
  currentDate: string,
): PrivateAssetEntry {
  const delta = project.targetDelta ?? {};
  const workshopScaleDelta = delta.workshopScale ?? 0;
  const currentWorkshopScale = asset.workshopScale ?? 0;
  const nextWorkshopScale = currentWorkshopScale + workshopScaleDelta;

  return {
    ...asset,
    mu: addOptionalNumber(asset.mu, delta.mu),
    households: addOptionalNumber(asset.households, delta.households),
    workers: addOptionalNumber(asset.workers, delta.workers),
    workshopScale: nextWorkshopScale > 0
      ? clampScale(nextWorkshopScale)
      : asset.workshopScale,
    ranchCapacity: addOptionalNumber(asset.ranchCapacity, delta.ranchCapacity),
    recentChanges: [
      ...(asset.recentChanges ?? []),
      `project completed: ${project.title}`,
    ],
    updatedAt: currentDate,
  };
}

function addOptionalNumber(current: number | undefined, delta: number | undefined): number | undefined {
  if (delta === undefined) return current;
  return Math.max(0, Math.round((current ?? 0) + delta));
}

function clampScale(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, Math.round(value))) as 1 | 2 | 3 | 4 | 5;
}

function compareLooseDates(left: string, right: string): number {
  const leftKey = looseDateKey(left);
  const rightKey = looseDateKey(right);
  if (leftKey !== null && rightKey !== null) return leftKey - rightKey;
  return left.localeCompare(right);
}

function looseDateKey(value: string): number | null {
  const parts = value.match(/\d+/g);
  if (!parts || parts.length === 0) return null;
  const [year = '0', month = '0', day = '0', hour = '0', minute = '0'] = parts;
  return Number(year.padStart(4, '0') + month.padStart(2, '0') + day.padStart(2, '0') + hour.padStart(2, '0') + minute.padStart(2, '0'));
}

function calculateTroopUpkeep(troop: TroopLedgerEntry): DomesticReportResourceDelta {
  const typeMultiplier = getTroopTypeUpkeepMultiplier(troop);
  const qualityMultiplier = getTroopQualityUpkeepMultiplier(troop);
  const size = Math.max(0, troop.size);

  return {
    grain: roundResource(size * 12 * typeMultiplier.grain * qualityMultiplier),
    money: roundResource(size * 0.6 * typeMultiplier.money * qualityMultiplier),
    horses: roundResource(size * typeMultiplier.horses * qualityMultiplier),
    arms: roundResource(size * 0.05 * typeMultiplier.arms * qualityMultiplier),
    recruits: 0,
  };
}

export function calculateTroopMonthlyUpkeep(troop: TroopLedgerEntry): DomesticReportResourceDelta {
  const yearlyUpkeep = calculateTroopUpkeep(troop);
  return {
    money: roundResource(yearlyUpkeep.money / 12),
    grain: roundResource(yearlyUpkeep.grain / 12),
    horses: roundResource(yearlyUpkeep.horses / 12),
    arms: roundResource(yearlyUpkeep.arms / 12),
    recruits: 0,
  };
}

export function calculateTroopsMonthlyUpkeep(troops: TroopLedgerEntry[]): DomesticReportResourceDelta {
  return troops
    .filter(isUpkeepTroop)
    .map(calculateTroopMonthlyUpkeep)
    .reduce(addDelta, { ...ZERO_DELTA });
}

function getTroopTypeUpkeepMultiplier(troop: TroopLedgerEntry): DomesticReportResourceDelta {
  const label = `${troop.troopType ?? ''} ${troop.specialDesignation ?? ''}`.toLowerCase();
  if (label.includes('cavalry') || label.includes('horse') || label.includes('骑')) {
    return { money: 1.5, grain: 1.3, horses: 0.15, arms: 1.2, recruits: 0 };
  }
  if (label.includes('archer') || label.includes('crossbow') || label.includes('bow') || label.includes('弓') || label.includes('弩')) {
    return { money: 1.1, grain: 1, horses: 0, arms: 1.2, recruits: 0 };
  }
  if (label.includes('naval') || label.includes('water') || label.includes('ship') || label.includes('水')) {
    return { money: 1.3, grain: 1.2, horses: 0, arms: 1.1, recruits: 0 };
  }
  if (label.includes('militia') || label.includes('levy') || label.includes('民') || label.includes('杂')) {
    return { money: 0.7, grain: 0.8, horses: 0, arms: 0.7, recruits: 0 };
  }
  return { money: 1, grain: 1, horses: 0, arms: 1, recruits: 0 };
}

function getTroopQualityUpkeepMultiplier(troop: TroopLedgerEntry): number {
  if (troop.quality === '低') return 0.85;
  if (troop.quality === '高') return 1.25;
  if (troop.quality === '精锐') return 1.5;
  return 1;
}

function scoreFactor(value: number): number {
  return clampScore(value) / 100;
}

function roundResource(value: number): number {
  return Math.max(0, Math.round(value));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampRatio(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
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
  income: DomesticReportResourceDelta,
  expenses: DomesticReportResourceDelta,
): DomesticReportResourceDelta {
  return {
    money: income.money - expenses.money,
    grain: income.grain - expenses.grain,
    horses: income.horses - expenses.horses,
    arms: income.arms - expenses.arms,
    recruits: income.recruits - expenses.recruits,
  };
}

function applyDeltaToResources(resources: ResourceLedger, delta: DomesticReportResourceDelta): ResourceLedger {
  return {
    ...resources,
    money: Math.max(0, resources.money + delta.money),
    grain: Math.max(0, resources.grain + delta.grain),
    horses: Math.max(0, resources.horses + delta.horses),
    arms: Math.max(0, resources.arms + delta.arms),
    recruits: Math.max(0, resources.recruits + delta.recruits),
  };
}

function buildReportSummary(
  income: DomesticReportResourceDelta,
  expenses: DomesticReportResourceDelta,
  netChange: DomesticReportResourceDelta,
): string {
  return [
    `Income money ${income.money}, grain ${income.grain}, horses ${income.horses}, arms ${income.arms}, recruits ${income.recruits}.`,
    `Expenses money ${expenses.money}, grain ${expenses.grain}, horses ${expenses.horses}, arms ${expenses.arms}.`,
    `Net money ${netChange.money}, grain ${netChange.grain}, horses ${netChange.horses}, arms ${netChange.arms}, recruits ${netChange.recruits}.`,
  ].join(' ');
}

function buildHoldingHighlight(holding: HoldingLedgerEntry): string {
  return `${holding.name}: order ${holding.publicOrder}, support ${holding.popularSupport}, corruption ${holding.corruption ?? 0}.`;
}

function buildSettlementWarnings(
  holdings: HoldingLedgerEntry[],
  netChange: DomesticReportResourceDelta,
): string[] {
  const warnings: string[] = [];
  if (netChange.money < 0) warnings.push('money deficit after yearly upkeep');
  if (netChange.grain < 0) warnings.push('grain deficit after yearly upkeep');
  for (const holding of holdings) {
    if (!isIncomeHolding(holding)) continue;
    if ((holding.corruption ?? 0) >= 70) warnings.push(`${holding.name} corruption is high`);
    if (holding.publicOrder <= 30) warnings.push(`${holding.name} public order is low`);
    if (holding.popularSupport <= 30) warnings.push(`${holding.name} popular support is low`);
  }
  return warnings;
}
