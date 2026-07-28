import type {
  DomesticReportEntry,
  DomesticReportResourceDelta,
  HoldingLedgerEntry,
  PrivateAssetEntry,
  PrivateAssetProjectEntry,
  RuntimeState,
} from '../engine/types';
import { calculateHoldingOutputProjection } from '../engine/holdings/HoldingAnnualSettlement';
import {
  projectHoldingSiegeSupply,
  type HoldingSiegeSupplyCondition,
} from '../engine/holdings/HoldingSiegeSupply';
import { normalizeCurrentTroopReferenceIds } from '../engine/state/troopLifecycle';
import {
  HOLDING_CIVIL_ADMINISTRATION_SCOPE_LABELS,
  holdingHasHouseholdAdministration,
  holdingHasLandAdministration,
  resolveHoldingCivilAdministrationScope,
} from '../engine/holdings/HoldingCivilAdministration';

export interface HoldingPanelRosterItem {
  holdingId: string;
  name: string;
  subtitle: string;
  statusText: string;
  scaleText: string;
  riskText: string;
}

export interface HoldingPanelDetailRow {
  label: string;
  value: string;
  detail?: string;
  tone?: 'normal' | 'warning' | 'danger';
}

export interface HoldingPanelResourceRow {
  key: keyof DomesticReportResourceDelta;
  label: string;
  value: string;
}

export interface HoldingPanelVisualProfile {
  name: string;
  locationId?: string;
  type?: HoldingLedgerEntry['type'];
  typeText: string;
  scaleText: string;
  statusText: string;
  localEliteText: string;
  collectionText: string;
  caption: string;
}

export interface DomesticReportListItem {
  reportId: string;
  title: string;
  settledAt: string;
  summary: string;
  incomeText: string;
  expenseText: string;
  netText: string;
  warnings: string[];
}

export type HoldingPanelTabKey = 'overview' | 'privateAssets' | 'controlledHoldings' | 'domesticReports';

export interface HoldingPanelTabItem {
  key: HoldingPanelTabKey;
  label: string;
  count: number;
}

export interface PrivateAssetPanelItem {
  privateAssetId: string;
  name: string;
  subtitle: string;
  statusText: string;
  scaleText: string;
  summary: string;
  conditionNotes: string[];
  riskNotes: string[];
  recentChanges: string[];
  detailRows: HoldingPanelDetailRow[];
  projectTitles: string[];
}

export interface PrivateAssetProjectPanelItem {
  projectId: string;
  assetId: string;
  title: string;
  statusText: string;
  timingText: string;
  investmentText: string;
  targetText: string;
  notes: string[];
}

export interface HoldingPanelModel {
  rosterItems: HoldingPanelRosterItem[];
  selectedHoldingId: string | null;
  selectedHolding: HoldingLedgerEntry | null;
  resourceRows: HoldingPanelResourceRow[];
  detailRows: HoldingPanelDetailRow[];
  collectionRows: HoldingPanelDetailRow[];
  landRegisterRows: HoldingPanelDetailRow[];
  administrationRows: HoldingPanelDetailRow[];
  scoreRows: HoldingPanelDetailRow[];
  visualProfile: HoldingPanelVisualProfile | null;
  relatedNpcNames: string[];
  garrisonTroopNames: string[];
  reports: DomesticReportListItem[];
  tabs: HoldingPanelTabItem[];
  overviewRows: HoldingPanelDetailRow[];
  privateAssets: PrivateAssetPanelItem[];
  privateAssetProjects: PrivateAssetProjectPanelItem[];
}

const HOLDING_TYPE_LABELS: Record<HoldingLedgerEntry['type'], string> = {
  county: '县邑',
  commandery: '郡国',
  city: '城池',
  fort: '堡垒',
  pass: '关隘',
  camp: '军营',
  estate: '庄园',
  port: '港口',
  village: '乡里',
  other: '其他',
};

const HOLDING_STATUS_LABELS: Record<HoldingLedgerEntry['status'], string> = {
  controlled: '掌控',
  contested: '争夺',
  temporary: '临管',
  lost: '失去',
  archived: '归档',
};

const PRIVATE_ASSET_TYPE_LABELS: Record<PrivateAssetEntry['type'], string> = {
  estate: '庄园',
  farmland: '田产',
  workshop: '工坊',
  ranch: '马场',
  shop: '铺面',
  ferry: '渡口',
  mine: '矿场',
  other: '其他',
};

const PRIVATE_ASSET_OWNER_LABELS: Record<PrivateAssetEntry['ownerScope'], string> = {
  personal: '私人',
  clan: '宗族',
  household: '家门',
  retainer: '部曲',
  faction: '自势力',
};

const PRIVATE_ASSET_STATUS_LABELS: Record<PrivateAssetEntry['status'], string> = {
  active: '经营中',
  damaged: '受损',
  occupied: '被占',
  disputed: '争议',
  archived: '归档',
};

const PRIVATE_PROJECT_TYPE_LABELS: Record<PrivateAssetProjectEntry['type'], string> = {
  expand_farmland: '扩田',
  irrigation: '修水利',
  build_workshop: '建工坊',
  expand_workshop: '扩工坊',
  build_ranch: '建马场',
  expand_ranch: '扩马场',
  recruit_tenants: '增佃户',
  repair: '修缮',
  anti_corruption: '肃贪',
  other: '其他',
};

const PRIVATE_PROJECT_STATUS_LABELS: Record<PrivateAssetProjectEntry['status'], string> = {
  planned: '筹备中',
  active: '进行中',
  completed: '完成',
  blocked: '受阻',
  cancelled: '取消',
};

const RESOURCE_LABELS: Record<keyof DomesticReportResourceDelta, string> = {
  money: '钱财',
  grain: '粮草',
  horses: '马匹',
  arms: '军械',
  recruits: '可征召人手',
};

const SCORE_ROW_CONFIG: Array<{
  key: keyof Pick<
    HoldingLedgerEntry,
    | 'agriculture'
    | 'commerce'
    | 'population'
    | 'publicOrder'
    | 'popularSupport'
    | 'defense'
    | 'recruitPotential'
    | 'armory'
    | 'horseSupply'
    | 'corruption'
  >;
  label: string;
  dangerLow?: boolean;
  dangerHigh?: boolean;
}> = [
  { key: 'agriculture', label: '农桑', dangerLow: true },
  { key: 'commerce', label: '商税', dangerLow: true },
  { key: 'population', label: '户口', dangerLow: true },
  { key: 'publicOrder', label: '治安', dangerLow: true },
  { key: 'popularSupport', label: '民心', dangerLow: true },
  { key: 'defense', label: '防务', dangerLow: true },
  { key: 'recruitPotential', label: '可征召', dangerLow: true },
  { key: 'armory', label: '军械产能', dangerLow: true },
  { key: 'horseSupply', label: '马政', dangerLow: true },
  { key: 'corruption', label: '腐败', dangerHigh: true },
];

export function buildHoldingPanelModel(runtimeState: RuntimeState, selectedHoldingId?: string | null): HoldingPanelModel {
  const troops = runtimeState.troops ?? [];
  const holdings = (runtimeState.holdings ?? [])
    .map((holding) => {
      const garrisonTroopIds = normalizeCurrentTroopReferenceIds(holding.garrisonTroopIds, troops);
      return garrisonTroopIds === holding.garrisonTroopIds
        ? holding
        : { ...holding, garrisonTroopIds };
    })
    .sort(compareHoldings);
  const privateAssets = [...(runtimeState.privateAssets ?? [])].sort(comparePrivateAssets);
  const privateAssetProjects = [...(runtimeState.privateAssetProjects ?? [])].sort(comparePrivateAssetProjects);
  const reports = [...(runtimeState.domesticReports ?? [])].sort(compareDomesticReports).map(toReportItem);
  const activePrivateProjects = privateAssetProjects.filter((project) => project.status === 'active' || project.status === 'blocked');
  const selectedHolding =
    holdings.find((holding) => holding.holdingId === selectedHoldingId) ??
    holdings[0] ??
    null;
  const detailRows = selectedHolding ? buildDetailRows(runtimeState, selectedHolding) : [];

  return {
    rosterItems: holdings.map((holding) => toRosterItem(runtimeState, holding)),
    selectedHoldingId: selectedHolding?.holdingId ?? null,
    selectedHolding,
    resourceRows: buildResourceRows(runtimeState),
    detailRows,
    collectionRows: pickRowsByLabel(detailRows, ['地方估产', '实际征收', '差额原因', '实征率']),
    landRegisterRows: pickRowsByLabel(detailRows, ['账面田亩', '编户', '地方豪强掌控', '地方豪强关系']),
    administrationRows: pickRowsByLabel(detailRows, [
      '类型',
      '状态',
      '规模',
      '民政范围',
      '地点',
      '所属势力',
      '名义归属',
      '实际控制',
      '主事人物',
      '围城态势',
      '补给线',
      '备战储备',
      '守城补给',
      '情报来源',
      '更新于',
    ]),
    scoreRows: selectedHolding ? buildScoreRows(selectedHolding) : [],
    visualProfile: selectedHolding ? buildVisualProfile(selectedHolding) : null,
    relatedNpcNames: selectedHolding?.relatedNpcIds?.map((npcId) => resolveNpcName(runtimeState, npcId)).filter(isPresentString) ?? [],
    garrisonTroopNames: selectedHolding?.garrisonTroopIds?.map((troopId) => resolveTroopName(runtimeState, troopId)).filter(isPresentString) ?? [],
    reports,
    tabs: buildTabs(holdings, privateAssets, reports),
    overviewRows: buildOverviewRows(holdings, privateAssets, activePrivateProjects, reports),
    privateAssets: privateAssets.map((asset) => toPrivateAssetItem(runtimeState, asset, privateAssetProjects)),
    privateAssetProjects: privateAssetProjects.map((project) => toPrivateAssetProjectItem(project, resolvePrivateAssetName(privateAssets, project.assetId))),
  };
}

function isPresentString(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function formatHoldingController(runtimeState: RuntimeState, value?: string): string | undefined {
  if (!isPresentString(value)) return undefined;
  const normalized = value.trim();
  if (
    normalized.toLowerCase() === 'player'
    || normalized === runtimeState.player?.id
  ) return '主角';
  const factionName = runtimeState.factions?.find((faction) => faction.factionId === normalized)?.name;
  if (factionName) return factionName;
  const npcName = runtimeState.npcs?.find((npc) => npc.npcId === normalized)?.name;
  if (npcName) return npcName;
  if (/^faction[_:-]/i.test(normalized)) return '未登记势力';
  if (/^npc[_:-]/i.test(normalized)) return '未登记人物';
  return normalized;
}

function toRosterItem(runtimeState: RuntimeState, holding: HoldingLedgerEntry): HoldingPanelRosterItem {
  return {
    holdingId: holding.holdingId,
    name: holding.name,
    subtitle: [
      formatHoldingType(holding.type),
      formatHoldingController(runtimeState, holding.actualController) ?? holding.nominalAllegiance,
    ].filter(Boolean).join(' / '),
    statusText: formatHoldingStatus(holding.status),
    scaleText: `${holding.scaleLevel}级`,
    riskText: summarizeRisk(holding),
  };
}

function buildTabs(
  holdings: HoldingLedgerEntry[],
  privateAssets: PrivateAssetEntry[],
  reports: DomesticReportListItem[],
): HoldingPanelTabItem[] {
  return [
    { key: 'overview', label: '总览', count: 1 },
    { key: 'privateAssets', label: '私人产业', count: privateAssets.filter((asset) => asset.status !== 'archived').length },
    { key: 'controlledHoldings', label: '控制领地', count: holdings.length },
    { key: 'domesticReports', label: '内政报告', count: reports.length },
  ];
}

function buildOverviewRows(
  holdings: HoldingLedgerEntry[],
  privateAssets: PrivateAssetEntry[],
  activePrivateProjects: PrivateAssetProjectEntry[],
  reports: DomesticReportListItem[],
): HoldingPanelDetailRow[] {
  return [
    { label: '控制领地', value: String(holdings.filter((holding) => holding.status !== 'archived').length), tone: 'normal' },
    { label: '私人产业', value: String(privateAssets.filter((asset) => asset.status !== 'archived').length), tone: 'normal' },
    { label: '进行工程', value: String(activePrivateProjects.length), tone: activePrivateProjects.some((project) => project.status === 'blocked') ? 'warning' : 'normal' },
    { label: '内政报告', value: String(reports.length), tone: 'normal' },
  ];
}

function buildResourceRows(runtimeState: RuntimeState): HoldingPanelResourceRow[] {
  const resources = runtimeState.resources;
  return (Object.keys(RESOURCE_LABELS) as Array<keyof DomesticReportResourceDelta>).map((key) => ({
    key,
    label: RESOURCE_LABELS[key],
    value: formatResourceValue(key, resources?.[key] ?? 0),
  }));
}

function buildDetailRows(runtimeState: RuntimeState, holding: HoldingLedgerEntry): HoldingPanelDetailRow[] {
  const civilScope = resolveHoldingCivilAdministrationScope(holding);
  const hasHouseholdAdministration = holdingHasHouseholdAdministration(holding);
  const hasLandAdministration = holdingHasLandAdministration(holding);
  const outputProjection = calculateHoldingOutputProjection(holding);
  const localEliteRelation = summarizeLocalEliteRelation(holding.localEliteRelation);
  const siegeProjection = projectHoldingSiegeSupply(holding, runtimeState.turnLog?.length ?? 0);
  return [
    makeRow('类型', formatHoldingType(holding.type)),
    makeRow('状态', formatHoldingStatus(holding.status), undefined, holding.status === 'contested' ? 'warning' : holding.status === 'lost' ? 'danger' : 'normal'),
    makeRow('规模', `${holding.scaleLevel}级`),
    makeRow('民政范围', HOLDING_CIVIL_ADMINISTRATION_SCOPE_LABELS[civilScope]),
    makeRow('地点', resolveLocationName(runtimeState, holding.locationId)),
    makeRow('所属势力', resolveFactionName(runtimeState, holding.factionId)),
    makeRow('名义归属', holding.nominalAllegiance),
    makeRow('实际控制', formatHoldingController(runtimeState, holding.actualController)),
    makeRow('主事人物', resolveNpcName(runtimeState, holding.stewardNpcId)),
    ...(hasLandAdministration ? [
      makeRow('账面田亩', holding.farmlandMu !== undefined ? `${holding.farmlandMu}亩` : '未清丈', undefined, holding.farmlandMu !== undefined ? 'normal' : 'warning'),
    ] : []),
    ...(hasHouseholdAdministration ? [
      makeRow('编户', holding.registeredHouseholds !== undefined ? `${holding.registeredHouseholds}户` : '未登记', undefined, holding.registeredHouseholds !== undefined ? 'normal' : 'warning'),
      makeRow('地方豪强掌控', holding.eliteControlledShare !== undefined ? `${holding.eliteControlledShare}%` : '未详', undefined, getLocalEliteControlTone(holding.eliteControlledShare)),
      makeRow('地方豪强关系', localEliteRelation.label, localEliteRelation.detail),
      makeRow('地方估产', formatHoldingResourcePair(outputProjection.estimatedOutput)),
      makeRow('实际征收', formatHoldingResourcePair(outputProjection.actualCollection), undefined, getCollectionRateTone(outputProjection.collectionRate.grain, outputProjection.collectionRate.money)),
      makeRow(
        '差额原因',
        summarizeCollectionGapReason(holding, outputProjection.collectionRate),
        formatCollectionGapDetail(outputProjection.estimatedOutput, outputProjection.actualCollection),
        getCollectionRateTone(outputProjection.collectionRate.grain, outputProjection.collectionRate.money),
      ),
      makeRow('实征率', `粮草 ${formatPercent(outputProjection.collectionRate.grain)} / 钱财 ${formatPercent(outputProjection.collectionRate.money)}`, undefined, getCollectionRateTone(outputProjection.collectionRate.grain, outputProjection.collectionRate.money)),
    ] : []),
    ...(siegeProjection ? [
      makeRow('围城态势', siegeProjection.siegeStatusText, undefined, holding.siege?.status === 'encircled' ? 'danger' : 'warning'),
      makeRow('补给线', siegeProjection.supplyLineText, undefined, holding.siege?.supplyLine === 'cut' ? 'danger' : holding.siege?.supplyLine === 'strained' ? 'warning' : 'normal'),
      makeRow('备战储备', siegeProjection.preparationText),
      makeRow('守城补给', siegeProjection.supplyText, undefined, siegeSupplyTone(siegeProjection.condition)),
    ] : []),
    makeRow('情报来源', holding.sourceNote),
    makeRow('更新于', holding.updatedAt),
  ].filter((row): row is HoldingPanelDetailRow => row !== null);
}

function summarizeCollectionGapReason(
  holding: HoldingLedgerEntry,
  collectionRate: { money: number; grain: number },
): string {
  const lowestRate = Math.min(collectionRate.money, collectionRate.grain);
  if (lowestRate >= 0.98) return '理论产出与实际征收基本一致';

  const reasons: string[] = [];
  if (holding.publicOrder + holding.popularSupport < 180) reasons.push('治安与民心影响征收执行');
  if ((holding.corruption ?? 0) > 10) reasons.push(`腐败造成损耗（${holding.corruption}）`);
  if ((holding.eliteControlledShare ?? 0) > 0) {
    const relation = summarizeLocalEliteRelation(holding.localEliteRelation).label;
    reasons.push(`地方豪强掌控 ${holding.eliteControlledShare}%（${relation}）`);
  }
  return reasons.length > 0 ? reasons.join('；') : '征收链仍有未明损耗';
}

function formatCollectionGapDetail(
  estimated: DomesticReportResourceDelta,
  actual: DomesticReportResourceDelta,
): string {
  const grainGap = Math.max(0, (estimated.grain ?? 0) - (actual.grain ?? 0));
  const moneyGap = Math.max(0, (estimated.money ?? 0) - (actual.money ?? 0));
  return `较理论少收：粮草 ${grainGap}石 / 钱财 ${moneyGap}贯`;
}

function siegeSupplyTone(condition: HoldingSiegeSupplyCondition): HoldingPanelDetailRow['tone'] {
  if (condition === 'exhausted' || condition === 'critical') return 'danger';
  if (condition === 'strained') return 'warning';
  return 'normal';
}

function buildVisualProfile(holding: HoldingLedgerEntry): HoldingPanelVisualProfile {
  const civilScope = resolveHoldingCivilAdministrationScope(holding);
  const outputProjection = calculateHoldingOutputProjection(holding);
  const typeText = formatHoldingType(holding.type);
  const scaleText = `${holding.scaleLevel}级`;
  const statusText = formatHoldingStatus(holding.status);
  const localEliteText = civilScope === 'none'
    ? '无民政辖境'
    : holding.eliteControlledShare !== undefined
      ? `豪强掌控 ${holding.eliteControlledShare}%`
      : '豪强掌控 未详';
  const collectionText = civilScope === 'none'
    ? '不参与民政结算'
    : `实征 粮草 ${formatPercent(outputProjection.collectionRate.grain)} / 钱财 ${formatPercent(outputProjection.collectionRate.money)}`;

  return {
    name: holding.name,
    locationId: holding.locationId,
    type: holding.type,
    typeText,
    scaleText,
    statusText,
    localEliteText,
    collectionText,
    caption: `${typeText} · ${scaleText} · ${statusText} · ${collectionText}`,
  };
}

function formatHoldingResourcePair(resources: DomesticReportResourceDelta): string {
  return `粮草 ${resources.grain ?? 0}石 / 钱财 ${resources.money ?? 0}贯`;
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function summarizeLocalEliteRelation(value?: number): { label: string; detail: string } {
  const relation = clampScore(value ?? 0, -100, 100);
  if (relation <= -70) return { label: '敌视抵制', detail: formatSignedScore(relation) };
  if (relation <= -30) return { label: '冷淡掣肘', detail: formatSignedScore(relation) };
  if (relation < 30) return { label: '观望自保', detail: formatSignedScore(relation) };
  if (relation < 60) return { label: '可以商议', detail: formatSignedScore(relation) };
  if (relation < 85) return { label: '积极配合', detail: formatSignedScore(relation) };
  return { label: '倚为支柱', detail: formatSignedScore(relation) };
}

function formatSignedScore(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function getLocalEliteControlTone(value?: number): HoldingPanelDetailRow['tone'] {
  if (value === undefined) return 'normal';
  if (value >= 75) return 'danger';
  if (value >= 45) return 'warning';
  return 'normal';
}

function getCollectionRateTone(grainRate: number, moneyRate: number): HoldingPanelDetailRow['tone'] {
  const lowRate = Math.min(grainRate, moneyRate);
  if (lowRate < 0.45) return 'danger';
  if (lowRate < 0.7) return 'warning';
  return 'normal';
}

function clampScore(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function buildScoreRows(holding: HoldingLedgerEntry): HoldingPanelDetailRow[] {
  const civilScope = resolveHoldingCivilAdministrationScope(holding);
  const visibleConfigs = SCORE_ROW_CONFIG.filter((config) => {
    if (civilScope === 'none') {
      return ['defense', 'armory', 'horseSupply'].includes(config.key);
    }
    if (civilScope === 'households') return config.key !== 'agriculture';
    return true;
  });
  return visibleConfigs.map((config) => {
    const value = holding[config.key] ?? 0;
    return {
      label: config.label,
      value: `${value}`,
      tone: getScoreTone(value, config),
    };
  });
}

function toPrivateAssetItem(
  runtimeState: RuntimeState,
  asset: PrivateAssetEntry,
  projects: PrivateAssetProjectEntry[],
): PrivateAssetPanelItem {
  const relatedProjects = projects.filter((project) => project.assetId === asset.privateAssetId && project.status !== 'cancelled');
  return {
    privateAssetId: asset.privateAssetId,
    name: asset.name,
    subtitle: [formatPrivateAssetType(asset.type), formatPrivateAssetOwner(asset.ownerScope)].join(' / '),
    statusText: formatPrivateAssetStatus(asset.status),
    scaleText: formatPrivateAssetScale(asset),
    summary: asset.summary,
    conditionNotes: toStringArray(asset.conditionNotes),
    riskNotes: toStringArray(asset.riskNotes),
    recentChanges: toStringArray(asset.recentChanges),
    detailRows: [
      makeRow('类型', formatPrivateAssetType(asset.type)),
      makeRow('归属', formatPrivateAssetOwner(asset.ownerScope)),
      makeRow('状态', formatPrivateAssetStatus(asset.status), undefined, asset.status === 'active' ? 'normal' : asset.status === 'damaged' || asset.status === 'disputed' ? 'warning' : 'danger'),
      makeRow('地点', resolveLocationName(runtimeState, asset.locationId)),
      makeRow('管事', resolveNpcName(runtimeState, asset.managerNpcId)),
      makeRow('田亩', asset.mu !== undefined ? `${asset.mu}亩` : undefined),
      makeRow('佃户', asset.households !== undefined ? `${asset.households}户` : undefined),
      makeRow('工匠/仆役', asset.workers !== undefined ? `${asset.workers}人` : undefined),
      makeRow('工坊', asset.workshopScale !== undefined ? `${asset.workshopScale}级` : undefined),
      makeRow('马场', asset.ranchCapacity !== undefined ? `${asset.ranchCapacity}匹容量` : undefined),
      makeRow('来源', asset.sourceNote),
      makeRow('更新于', asset.updatedAt),
    ].filter((row): row is HoldingPanelDetailRow => row !== null),
    projectTitles: relatedProjects.map((project) => project.title),
  };
}

function toPrivateAssetProjectItem(project: PrivateAssetProjectEntry, assetName?: string): PrivateAssetProjectPanelItem {
  const notes = [
    ...toStringArray(project.progressNotes),
    ...toStringArray(project.riskNotes),
  ];
  return {
    projectId: project.projectId,
    assetId: project.assetId,
    title: project.title,
    statusText: formatPrivateProjectStatus(project.status),
    timingText: [project.startedAt, project.expectedCompleteAt ? `预计 ${project.expectedCompleteAt}` : undefined].filter(Boolean).join(' 至 '),
    investmentText: [
      project.investedMoney !== undefined ? `${project.investedMoney}贯` : undefined,
      project.investedGrain !== undefined ? `${project.investedGrain}石` : undefined,
    ].filter(Boolean).join(' / ') || '未记录',
    targetText: [
      assetName ? `资产：${assetName}` : undefined,
      `${formatPrivateProjectType(project.type)} ${formatProjectDelta(project.targetDelta)}`.trim(),
    ].filter(Boolean).join('；'),
    notes,
  };
}

function toReportItem(report: DomesticReportEntry): DomesticReportListItem {
  return {
    reportId: report.reportId,
    title: report.title,
    settledAt: report.settledAt,
    summary: report.summary,
    incomeText: formatDelta(report.income),
    expenseText: formatDelta(report.expenses),
    netText: formatSignedDelta(report.netChange),
    warnings: report.warnings ?? [],
  };
}

function makeRow(
  label: string,
  value?: string | number | null,
  detail?: string,
  tone: HoldingPanelDetailRow['tone'] = 'normal',
): HoldingPanelDetailRow | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const displayValue = String(value).trim();
  if (displayValue.length === 0) return null;
  return {
    label,
    value: displayValue,
    ...(detail && detail.trim().length > 0 ? { detail: detail.trim() } : {}),
    tone,
  };
}

function pickRowsByLabel(rows: HoldingPanelDetailRow[], labels: string[]): HoldingPanelDetailRow[] {
  const labelSet = new Set(labels);
  return rows.filter((row) => labelSet.has(row.label));
}

function summarizeRisk(holding: HoldingLedgerEntry): string {
  const flags: string[] = [];
  if (holding.status === 'contested') flags.push('争夺中');
  if (holdingHasHouseholdAdministration(holding)) {
    if (holding.publicOrder <= 35) flags.push('治安低');
    if (holding.popularSupport <= 35) flags.push('民心低');
  }
  if ((holding.corruption ?? 0) >= 70) flags.push('腐败高');
  return flags.length > 0 ? flags.join(' / ') : '平稳';
}

function getScoreTone(
  value: number,
  config: (typeof SCORE_ROW_CONFIG)[number],
): HoldingPanelDetailRow['tone'] {
  if (config.dangerHigh && value >= 70) return 'danger';
  if (config.dangerHigh && value >= 50) return 'warning';
  if (config.dangerLow && value <= 30) return 'danger';
  if (config.dangerLow && value <= 45) return 'warning';
  return 'normal';
}

function formatHoldingType(type?: string): string {
  if (!type?.trim()) return '领地';
  const key = type.trim();
  return HOLDING_TYPE_LABELS[key as HoldingLedgerEntry['type']] ?? (looksLikeEngineeringText(key) ? '领地' : key);
}

function formatHoldingStatus(status?: string): string {
  if (!status?.trim()) return '状态未明';
  const key = status.trim();
  return HOLDING_STATUS_LABELS[key as HoldingLedgerEntry['status']] ?? (looksLikeEngineeringText(key) ? '状态未明' : key);
}

function formatPrivateAssetType(type?: string): string {
  if (!type?.trim()) return '产业';
  const key = type.trim();
  return PRIVATE_ASSET_TYPE_LABELS[key as PrivateAssetEntry['type']] ?? (looksLikeEngineeringText(key) ? '产业' : key);
}

function formatPrivateAssetOwner(ownerScope?: string): string {
  if (!ownerScope?.trim()) return '归属未明';
  const key = ownerScope.trim();
  return PRIVATE_ASSET_OWNER_LABELS[key as PrivateAssetEntry['ownerScope']] ?? (looksLikeEngineeringText(key) ? '归属未明' : key);
}

function formatPrivateAssetStatus(status?: string): string {
  if (!status?.trim()) return '状态未明';
  const key = status.trim();
  return PRIVATE_ASSET_STATUS_LABELS[key as PrivateAssetEntry['status']] ?? (looksLikeEngineeringText(key) ? '状态未明' : key);
}

function formatPrivateProjectType(type?: string): string {
  if (!type?.trim()) return '工程';
  const key = type.trim();
  return PRIVATE_PROJECT_TYPE_LABELS[key as PrivateAssetProjectEntry['type']] ?? (looksLikeEngineeringText(key) ? '工程' : key);
}

function formatPrivateProjectStatus(status?: string): string {
  if (!status?.trim()) return '进度未明';
  const key = status.trim();
  return PRIVATE_PROJECT_STATUS_LABELS[key as PrivateAssetProjectEntry['status']] ?? (looksLikeEngineeringText(key) ? '进度未明' : key);
}

function looksLikeEngineeringText(value: string): boolean {
  return /[A-Za-z_]/.test(value);
}

function formatPrivateAssetScale(asset: PrivateAssetEntry): string {
  const parts = [
    asset.mu !== undefined ? `${asset.mu}亩` : undefined,
    asset.households !== undefined ? `${asset.households}户` : undefined,
    asset.workshopScale !== undefined ? `工坊${asset.workshopScale}` : undefined,
    asset.ranchCapacity !== undefined ? `马场${asset.ranchCapacity}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '规模未详';
}

function formatProjectDelta(delta?: PrivateAssetProjectEntry['targetDelta']): string {
  if (!delta) return '';
  const parts = [
    delta.mu !== undefined ? `田亩+${delta.mu}` : undefined,
    delta.households !== undefined ? `佃户+${delta.households}` : undefined,
    delta.workers !== undefined ? `工匠/仆役+${delta.workers}` : undefined,
    delta.workshopScale !== undefined ? `工坊+${delta.workshopScale}` : undefined,
    delta.ranchCapacity !== undefined ? `马场容量+${delta.ranchCapacity}` : undefined,
  ].filter(Boolean);
  return parts.join(' / ');
}

function formatResourceValue(key: keyof DomesticReportResourceDelta, value: number): string {
  if (key === 'money') return `${value}贯`;
  if (key === 'grain') return `${value}石`;
  if (key === 'recruits') return `${value}人`;
  return `${value}`;
}

function formatDelta(delta: DomesticReportResourceDelta): string {
  return (Object.keys(RESOURCE_LABELS) as Array<keyof DomesticReportResourceDelta>)
    .map((key) => `${RESOURCE_LABELS[key]} ${formatResourceValue(key, delta[key])}`)
    .join('，');
}

function formatSignedDelta(delta: DomesticReportResourceDelta): string {
  return (Object.keys(RESOURCE_LABELS) as Array<keyof DomesticReportResourceDelta>)
    .map((key) => `${RESOURCE_LABELS[key]} ${formatSignedResourceValue(key, delta[key])}`)
    .join('，');
}

function formatSignedResourceValue(key: keyof DomesticReportResourceDelta, value: number): string {
  const prefix = value > 0 ? '+' : '';
  if (key === 'money') return `${prefix}${value}贯`;
  if (key === 'grain') return `${prefix}${value}石`;
  if (key === 'recruits') return `${prefix}${value}人`;
  return `${prefix}${value}`;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }
  return [];
}

function resolveFactionName(runtimeState: RuntimeState, factionId?: string): string | undefined {
  if (!factionId) return undefined;
  return runtimeState.factions?.find((faction) => faction.factionId === factionId)?.name ?? '未登记势力';
}

function resolveLocationName(runtimeState: RuntimeState, locationId?: string): string | undefined {
  if (!locationId) return undefined;
  return runtimeState.locations?.find((location) => location.locationId === locationId)?.name ?? '未登记地点';
}

function resolveNpcName(runtimeState: RuntimeState, npcId?: string): string | undefined {
  if (!npcId) return undefined;
  return runtimeState.npcs?.find((npc) => npc.npcId === npcId)?.name ?? '未登记人物';
}

function resolveTroopName(runtimeState: RuntimeState, troopId?: string): string | undefined {
  if (!troopId) return undefined;
  return runtimeState.troops?.find((troop) => troop.troopId === troopId)?.name ?? '未登记部队';
}

function resolvePrivateAssetName(privateAssets: PrivateAssetEntry[], assetId?: string): string | undefined {
  if (!assetId) return undefined;
  return privateAssets.find((asset) => asset.privateAssetId === assetId)?.name ?? '未登记产业';
}

function compareHoldings(a: HoldingLedgerEntry, b: HoldingLedgerEntry): number {
  const byStatus = statusRank(a.status) - statusRank(b.status);
  if (byStatus !== 0) return byStatus;
  const byScale = b.scaleLevel - a.scaleLevel;
  if (byScale !== 0) return byScale;
  return b.updatedAt.localeCompare(a.updatedAt, 'zh-Hans-CN') || a.name.localeCompare(b.name, 'zh-Hans-CN');
}

function comparePrivateAssets(a: PrivateAssetEntry, b: PrivateAssetEntry): number {
  const byStatus = privateAssetStatusRank(a.status) - privateAssetStatusRank(b.status);
  if (byStatus !== 0) return byStatus;
  return b.updatedAt.localeCompare(a.updatedAt, 'zh-Hans-CN') || a.name.localeCompare(b.name, 'zh-Hans-CN');
}

function comparePrivateAssetProjects(a: PrivateAssetProjectEntry, b: PrivateAssetProjectEntry): number {
  const byStatus = privateProjectStatusRank(a.status) - privateProjectStatusRank(b.status);
  if (byStatus !== 0) return byStatus;
  return b.updatedAt.localeCompare(a.updatedAt, 'zh-Hans-CN') || a.title.localeCompare(b.title, 'zh-Hans-CN');
}

function statusRank(status: HoldingLedgerEntry['status']): number {
  if (status === 'controlled') return 0;
  if (status === 'temporary') return 1;
  if (status === 'contested') return 2;
  if (status === 'lost') return 3;
  return 4;
}

function privateAssetStatusRank(status: PrivateAssetEntry['status']): number {
  if (status === 'active') return 0;
  if (status === 'disputed') return 1;
  if (status === 'damaged') return 2;
  if (status === 'occupied') return 3;
  return 4;
}

function privateProjectStatusRank(status: PrivateAssetProjectEntry['status']): number {
  if (status === 'active') return 0;
  if (status === 'blocked') return 1;
  if (status === 'completed') return 2;
  return 3;
}

function compareDomesticReports(a: DomesticReportEntry, b: DomesticReportEntry): number {
  return b.settledAt.localeCompare(a.settledAt, 'zh-Hans-CN') || String(b.year).localeCompare(String(a.year), 'zh-Hans-CN');
}
