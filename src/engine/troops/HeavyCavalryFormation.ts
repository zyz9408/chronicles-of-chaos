import type {
  HeavyCavalryFormationProjectEntry,
  HeavyCavalrySupportLevel,
  HoldingLedgerEntry,
  RuntimeState,
  TroopLedgerEntry,
} from '../types';
import {
  advanceGameClock,
  ensureGameClock,
  formatGameClock,
} from '../time/gameClock';

export const HEAVY_CAVALRY_RESERVE_HORSE_RATIO = 0.15;

export interface StartHeavyCavalryFormationInput {
  projectId: string;
  troopId: string;
  troopName: string;
  holdingId: string;
  factionId?: string;
  requestedSize: number;
  supportLevel: HeavyCavalrySupportLevel;
  supportEvidenceRefId?: string;
  personnelSource?: 'recruit_pool' | 'existing_troop';
  sourceTroopId?: string;
  leaderNpcId?: string;
  relationToPlayer: string;
  upkeepSource: NonNullable<TroopLedgerEntry['upkeepSource']>;
}

export interface HeavyCavalryFormationCost {
  money: number;
  grain: number;
  horses: number;
  arms: number;
  recruits: number;
  reserveHorses: number;
}

export interface HeavyCavalryFormationResult {
  ok: boolean;
  state: RuntimeState;
  project?: HeavyCavalryFormationProjectEntry;
  error?: string;
}

const LEGACY_HEAVY_CAVALRY_TYPES = new Set([
  '重骑兵',
  '重装骑兵',
  '具装骑兵',
  '具装甲骑',
  '甲骑',
  '铁骑',
  '铁甲骑兵',
  '披甲骑兵',
  '玄甲骑',
  'heavy cavalry',
  'heavy_cavalry',
]);

export function isHeavyCavalryTroop(troop: Pick<TroopLedgerEntry, 'logisticsClass' | 'troopType'>): boolean {
  if (troop.logisticsClass === 'heavy_cavalry') return true;
  return LEGACY_HEAVY_CAVALRY_TYPES_NORMALIZED.has((troop.troopType ?? '').trim().toLowerCase());
}

const LEGACY_HEAVY_CAVALRY_TYPES_NORMALIZED = new Set(
  [...LEGACY_HEAVY_CAVALRY_TYPES].map((value) => value.toLowerCase()),
);

export function calculateHeavyCavalryFormationCost(size: number): HeavyCavalryFormationCost {
  const normalizedSize = Math.max(0, Math.floor(size));
  const reserveHorses = Math.ceil(normalizedSize * HEAVY_CAVALRY_RESERVE_HORSE_RATIO);
  return {
    money: normalizedSize * 8,
    grain: normalizedSize * 6,
    horses: normalizedSize + reserveHorses,
    arms: normalizedSize * 2,
    recruits: normalizedSize,
    reserveHorses,
  };
}

export function resolveHeavyCavalryFormationCap(
  state: RuntimeState,
  holding: HoldingLedgerEntry,
  supportLevel: HeavyCavalrySupportLevel,
): number {
  const hasLinkedFaction = Boolean(holding.factionId && state.factions?.some(
    (faction) => faction.factionId === holding.factionId,
  ));
  if (supportLevel === 'state_level') {
    return holding.scaleLevel >= 5 && holding.horseSupply >= 95 && holding.armory >= 95 && hasLinkedFaction
      ? 1_000
      : 0;
  }
  if (supportLevel === 'major_faction') {
    return holding.scaleLevel >= 4 && holding.horseSupply >= 85 && holding.armory >= 85 && hasLinkedFaction
      ? 500
      : 0;
  }
  if (supportLevel === 'stable') {
    if (holding.horseSupply >= 70 && holding.armory >= 70 && hasLinkedFaction) return 200;
    if (holding.horseSupply >= 40 && holding.armory >= 40) return 50;
    return 0;
  }
  return 20;
}

export function calculateHeavyCavalryFormationDurationDays(
  holding: HoldingLedgerEntry,
  size: number,
): number {
  const infrastructure = (holding.horseSupply + holding.armory) / 2;
  const scaleRelief = (holding.scaleLevel - 1) * 5;
  const batchPressure = Math.min(30, Math.ceil(size / 25));
  return Math.max(60, Math.min(120, Math.round(110 - infrastructure * 0.35 - scaleRelief + batchPressure)));
}

export function validateHeavyCavalrySupportEvidence(
  state: RuntimeState,
  supportLevel: HeavyCavalrySupportLevel,
  sourceRefId?: string,
): string | undefined {
  if (supportLevel !== 'major_faction' && supportLevel !== 'state_level') return undefined;
  const refId = sourceRefId?.trim();
  if (!refId) return '大型势力或国家级重骑工程必须引用已发生的调拨、批准或军需事件。';
  const exists = state.turnEvents?.some((event) => event.eventId === refId)
    || state.conflicts?.some((conflict) => conflict.conflictId === refId);
  return exists ? undefined : `重骑工程的支持依据不存在：${refId}`;
}

export function startHeavyCavalryFormation(
  state: RuntimeState,
  input: StartHeavyCavalryFormationInput,
): HeavyCavalryFormationResult {
  const holding = state.holdings?.find((entry) => entry.holdingId === input.holdingId);
  if (!holding || holding.status !== 'controlled') {
    return { ok: false, state, error: '重骑组建必须依托当前实际控制的具体领地。' };
  }
  if ((state.heavyCavalryFormationProjects ?? []).some((project) => (
    project.status === 'active' && (project.projectId === input.projectId || project.troopId === input.troopId)
  ))) {
    return { ok: false, state, error: '该重骑组建项目或目标部队已经存在。' };
  }
  if (state.troops?.some((troop) => troop.troopId === input.troopId)) {
    return { ok: false, state, error: '目标 troopId 已存在，不能重复组建。' };
  }
  const evidenceError = validateHeavyCavalrySupportEvidence(state, input.supportLevel, input.supportEvidenceRefId);
  if (evidenceError) return { ok: false, state, error: evidenceError };
  const cap = resolveHeavyCavalryFormationCap(state, holding, input.supportLevel);
  if (cap <= 0 || input.requestedSize > cap) {
    return {
      ok: false,
      state,
      error: cap > 0
        ? `当前马源、军械、领地规模与势力支持最多允许本批组建 ${cap} 骑。`
        : '当前领地不满足所申报重骑组建等级的马源、军械、规模或势力条件。',
    };
  }
  const resources = state.resources;
  if (!resources) return { ok: false, state, error: '没有可用的府库资源账本。' };
  const cost = calculateHeavyCavalryFormationCost(input.requestedSize);
  const personnelSource = input.personnelSource ?? 'recruit_pool';
  const sourceTroop = personnelSource === 'existing_troop'
    ? resolveExistingPersonnelSource(state, holding, input)
    : undefined;
  if (personnelSource === 'existing_troop' && !sourceTroop) {
    return {
      ok: false,
      state,
      error: '现役转编必须引用玩家实际控制、仍在役且兵力充足的 operational 部队；项目未启动，也未扣除资源或兵力。',
    };
  }
  const shortages = collectHeavyCavalryFormationShortages(
    resources,
    cost,
    personnelSource === 'recruit_pool',
  );
  if (shortages.length > 0) {
    return {
      ok: false,
      state,
      error: `${shortages.join('、')}；项目未启动，也未扣除资源或兵力。`,
    };
  }

  const startedAt = state.currentDate;
  const durationDays = calculateHeavyCavalryFormationDurationDays(holding, input.requestedSize);
  const expectedCompleteAt = formatGameClock(advanceGameClock(
    ensureGameClock(state),
    { daysAdvanced: durationDays },
  ));
  const project: HeavyCavalryFormationProjectEntry = {
    projectId: input.projectId.trim(),
    troopId: input.troopId.trim(),
    troopName: input.troopName.trim(),
    holdingId: holding.holdingId,
    ...(input.factionId?.trim() ? { factionId: input.factionId.trim() } : {}),
    requestedSize: input.requestedSize,
    supportLevel: input.supportLevel,
    ...(input.supportEvidenceRefId?.trim() ? { supportEvidenceRefId: input.supportEvidenceRefId.trim() } : {}),
    status: 'active',
    startedAt,
    expectedCompleteAt,
    investedMoney: cost.money,
    investedGrain: cost.grain,
    investedHorses: cost.horses,
    investedArms: cost.arms,
    investedRecruits: cost.recruits,
    personnelSource,
    ...(sourceTroop ? { sourceTroopId: sourceTroop.troopId } : {}),
    reserveHorseCount: cost.reserveHorses,
    ...(input.leaderNpcId?.trim() ? { leaderNpcId: input.leaderNpcId.trim() } : {}),
    relationToPlayer: input.relationToPlayer.trim(),
    upkeepSource: input.upkeepSource,
    updatedAt: startedAt,
  };
  return {
    ok: true,
    project,
    state: {
      ...state,
      resources: {
        ...resources,
        money: resources.money - cost.money,
        grain: resources.grain - cost.grain,
        horses: resources.horses - cost.horses,
        arms: resources.arms - cost.arms,
        recruits: personnelSource === 'recruit_pool'
          ? resources.recruits - cost.recruits
          : resources.recruits,
      },
      troops: sourceTroop
        ? state.troops?.map((troop) => (
          troop.troopId === sourceTroop.troopId
            ? applyExistingTroopPersonnelTransfer(troop, project, startedAt)
            : troop
        ))
        : state.troops,
      heavyCavalryFormationProjects: [...(state.heavyCavalryFormationProjects ?? []), project],
    },
  };
}

export function settleDueHeavyCavalryFormationProjects(state: RuntimeState): RuntimeState {
  const projects = state.heavyCavalryFormationProjects ?? [];
  if (!projects.some((project) => project.status === 'active' && compareDates(project.expectedCompleteAt, state.currentDate) <= 0)) {
    return state;
  }
  const completedTroops: TroopLedgerEntry[] = [];
  const nextProjects = projects.map((project) => {
    if (project.status !== 'active' || compareDates(project.expectedCompleteAt, state.currentDate) > 0) return project;
    if (!state.troops?.some((troop) => troop.troopId === project.troopId)) {
      completedTroops.push({
        troopId: project.troopId,
        name: project.troopName,
        size: project.requestedSize,
        ...(project.factionId ? { factionId: project.factionId } : {}),
        troopType: '重骑兵',
        logisticsClass: 'heavy_cavalry',
        acquisitionEvidence: {
          kind: 'formation_project',
          occurredAt: state.currentDate,
          sourceRefId: project.projectId,
          summary: `完成 ${project.requestedSize} 骑重骑兵的本地组建与基础训练。`,
        },
        quality: '高',
        fatigue: '低',
        readiness: '中',
        lifecycleStatus: 'active',
        statusTags: ['重骑', '新编', '尚未精锐'],
        ...(project.leaderNpcId ? { leaderNpcId: project.leaderNpcId } : {}),
        locationId: state.holdings?.find((holding) => holding.holdingId === project.holdingId)?.locationId,
        knownLevel: '亲历',
        certainty: 'confirmed',
        morale: 60,
        training: 55,
        supplies: 100,
        upkeepSource: project.upkeepSource,
        task: '完成编组，继续操练',
        relationToPlayer: project.relationToPlayer,
        ...(project.sourceTroopId ? { parentTroopId: project.sourceTroopId } : {}),
        strengthTrend: 'increased',
        sourceNote: `heavy cavalry formation project ${project.projectId}`,
        lastChangeReason: '本地确定性重骑组建项目到期',
        updatedAt: state.currentDate,
      });
    }
    return { ...project, status: 'completed' as const, completedAt: state.currentDate, updatedAt: state.currentDate };
  });
  return {
    ...state,
    heavyCavalryFormationProjects: nextProjects,
    troops: [...(state.troops ?? []), ...completedTroops],
  };
}

function resolveExistingPersonnelSource(
  state: RuntimeState,
  holding: HoldingLedgerEntry,
  input: StartHeavyCavalryFormationInput,
): TroopLedgerEntry | undefined {
  const sourceTroopId = input.sourceTroopId?.trim();
  if (!sourceTroopId || sourceTroopId === input.troopId.trim()) return undefined;
  const troop = state.troops?.find((entry) => entry.troopId === sourceTroopId);
  if (!troop || troop.detailLevel === 'intelligence' || isHeavyCavalryTroop(troop)) return undefined;
  if (troop.size < input.requestedSize) return undefined;
  if (troop.lifecycleStatus && troop.lifecycleStatus !== 'active') return undefined;

  const expectedFactionId = input.factionId?.trim()
    || holding.factionId?.trim()
    || state.player.factionId?.trim();
  const sameFaction = Boolean(expectedFactionId && troop.factionId === expectedFactionId);
  const ledByPlayer = troop.leaderNpcId === 'player' || troop.leaderNpcId === state.player.id;
  return sameFaction || ledByPlayer ? troop : undefined;
}

function collectHeavyCavalryFormationShortages(
  resources: NonNullable<RuntimeState['resources']>,
  cost: HeavyCavalryFormationCost,
  consumesRecruitPool: boolean,
): string[] {
  const shortages: string[] = [];
  if (resources.money < cost.money) shortages.push(`钱财不足（需${cost.money}贯，现${resources.money}贯）`);
  if (resources.grain < cost.grain) shortages.push(`粮草不足（需${cost.grain}石，现${resources.grain}石）`);
  if (resources.horses < cost.horses) shortages.push(`战马不足（含备用马需${cost.horses}匹，现${resources.horses}匹）`);
  if (resources.arms < cost.arms) shortages.push(`军械不足（需${cost.arms}份，现${resources.arms}份）`);
  if (consumesRecruitPool && resources.recruits < cost.recruits) {
    shortages.push(`可征召人手不足（需${cost.recruits}人，现${resources.recruits}人）`);
  }
  return shortages;
}

function applyExistingTroopPersonnelTransfer(
  troop: TroopLedgerEntry,
  project: HeavyCavalryFormationProjectEntry,
  occurredAt: string,
): TroopLedgerEntry {
  const nextSize = troop.size - project.requestedSize;
  const transferSummary = `抽调 ${project.requestedSize} 人进入重骑组建项目“${project.troopName}”。`;
  return {
    ...troop,
    previousSize: troop.size,
    size: nextSize,
    ...(troop.deployableSize === undefined
      ? {}
      : { deployableSize: Math.max(0, troop.deployableSize - project.requestedSize) }),
    lifecycleStatus: nextSize === 0 ? 'split' : (troop.lifecycleStatus ?? 'active'),
    childTroopIds: Array.from(new Set([...(troop.childTroopIds ?? []), project.troopId])),
    strengthTrend: 'decreased',
    lastChangeReason: transferSummary,
    changeHistory: [...(troop.changeHistory ?? []), {
      eventId: `${project.projectId}:personnel-transfer`,
      kind: 'reorganized',
      occurredAt,
      summary: transferSummary,
      sourceNote: `heavy cavalry formation project ${project.projectId}`,
    }],
    updatedAt: occurredAt,
  };
}

export function applyHeavyCavalryShortageDegradation(
  troop: TroopLedgerEntry,
  shortageRatio: number,
): TroopLedgerEntry {
  if (!isHeavyCavalryTroop(troop) || shortageRatio <= 0) return troop;
  const ratio = Math.min(1, shortageRatio);
  const supplies = typeof troop.supplies === 'number' ? troop.supplies : 100;
  const deployableLoss = ratio >= 0.75 ? Math.ceil(troop.size * 0.08) : 0;
  const nextTraining = Math.max(0, troop.training - Math.ceil(ratio * 8));
  const nextReadiness = ratio >= 0.5 ? '低' : troop.readiness === '高' ? '中' : troop.readiness;
  const severeMonths = ratio >= 0.75 ? readSevereShortageMonths(troop.statusTags) + 1 : 0;
  const statusTags = (troop.statusTags ?? []).filter((tag) => !tag.startsWith('重骑后勤严重短缺:'));
  if (severeMonths > 0) statusTags.push(`重骑后勤严重短缺:${severeMonths}`);
  if (severeMonths >= 3) {
    const shouldDisband = (troop.deployableSize ?? troop.size) <= Math.max(5, Math.floor(troop.size * 0.25));
    if (shouldDisband) {
      return {
        ...troop,
        size: 0,
        deployableSize: 0,
        previousSize: troop.size,
        lifecycleStatus: 'disbanded',
        readiness: '低',
        supplies: 0,
        training: nextTraining,
        statusTags: [...statusTags, '长期欠饷缺马解散'],
        strengthTrend: 'decreased',
        lastChangeReason: '重骑连续多月严重欠饷、缺马或缺械，剩余可出战人员不足以维持建制',
      };
    }
    return {
      ...troop,
      logisticsClass: 'ordinary',
      troopType: '骑兵',
      quality: troop.quality === '精锐' ? '高' : troop.quality,
      readiness: '低',
      supplies: Math.max(0, Math.round(supplies - ratio * 50)),
      training: nextTraining,
      deployableSize: Math.max(0, troop.size - deployableLoss),
      statusTags: [...statusTags, '缺马退化为普通骑兵'],
      strengthTrend: 'decreased',
      lastChangeReason: '重骑连续三个月严重缺马缺械，退化为普通骑兵',
    };
  }
  return {
    ...troop,
    readiness: nextReadiness,
    supplies: Math.max(0, Math.round(supplies - ratio * 50)),
    training: nextTraining,
    deployableSize: Math.max(0, troop.size - deployableLoss),
    statusTags,
    strengthTrend: 'decreased',
    lastChangeReason: '重骑军费、马匹或军械维护不足，整备与可出战人数下降',
  };
}

export function clearHeavyCavalryShortageMarker(troop: TroopLedgerEntry): TroopLedgerEntry {
  if (!isHeavyCavalryTroop(troop)) return troop;
  const statusTags = (troop.statusTags ?? []).filter((tag) => !tag.startsWith('重骑后勤严重短缺:'));
  if (statusTags.length === (troop.statusTags ?? []).length && troop.deployableSize === undefined) return troop;
  return {
    ...troop,
    statusTags,
    deployableSize: troop.size,
  };
}

function readSevereShortageMonths(tags?: string[]): number {
  const value = tags?.find((tag) => tag.startsWith('重骑后勤严重短缺:'))?.split(':')[1];
  return Math.max(0, Number.parseInt(value ?? '0', 10) || 0);
}

function compareDates(left: string, right: string): number {
  return dateKey(left) - dateKey(right);
}

function dateKey(value: string): number {
  const parts = value.match(/\d+/g) ?? [];
  const [year = '0', month = '0', day = '0', hour = '0', minute = '0'] = parts;
  return Number(`${year.padStart(4, '0')}${month.padStart(2, '0')}${day.padStart(2, '0')}${hour.padStart(2, '0')}${minute.padStart(2, '0')}`);
}
