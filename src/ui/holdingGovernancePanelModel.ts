import type {
  CharacterUniqueArt,
  HoldingGovernanceActorRef,
  HoldingGovernanceProjectEffectRanges,
  HoldingGovernanceProjectEffects,
  HoldingGovernanceProjectEntry,
  HoldingGovernanceProjectRisk,
  HoldingGovernanceProjectStatus,
  HoldingGovernanceProjectType,
  HoldingLedgerEntry,
  RuntimeState,
} from '../engine/types';
import {
  buildHoldingGovernanceActorProjection,
  buildHoldingGovernanceProjectPreview,
  getHoldingGovernanceProjectDefinition,
  getHoldingGovernanceProjectTypes,
  validateHoldingGovernanceActorRef,
  validateHoldingGovernanceProjectApplicability,
} from '../engine/holdings/HoldingGovernanceProjects';
import { tryCreateGameClockFromDateLabel } from '../engine/time/gameClock';

export interface HoldingGovernanceActorOption {
  key: string;
  actorRef: HoldingGovernanceActorRef;
  label: string;
  subtitle: string;
}

export interface HoldingGovernanceProjectOption {
  type: HoldingGovernanceProjectType;
  label: string;
  description: string;
  disabledReason?: string;
}

export interface HoldingGovernanceEffectRow {
  field: keyof HoldingGovernanceProjectEffects;
  label: string;
  value: string;
}

export interface HoldingGovernancePreviewModel {
  title: string;
  description: string;
  moneyCostText: string;
  grainCostText: string;
  durationText: string;
  riskText: string;
  effectRows: HoldingGovernanceEffectRow[];
  appliedArtNames: string[];
  modifierSummary: string;
}

export interface HoldingGovernanceProjectItem {
  projectId: string;
  title: string;
  status: HoldingGovernanceProjectStatus;
  statusText: string;
  timingText: string;
  hostText: string;
  assistantText?: string;
  investmentText: string;
  riskText: string;
  progressPercent: number;
  progressText: string;
  expectedEffectRows: HoldingGovernanceEffectRow[];
  appliedArtNames: string[];
  resultSummary?: string;
  resultRows: HoldingGovernanceEffectRow[];
  blockedReason?: string;
}

export interface HoldingGovernancePanelModel {
  projectOptions: HoldingGovernanceProjectOption[];
  actorOptions: HoldingGovernanceActorOption[];
  assistantEligibilityHint?: string;
  selectedType: HoldingGovernanceProjectType;
  selectedHostKey: string;
  selectedAssistantKey: string;
  selectedHost: HoldingGovernanceActorRef;
  selectedAssistant?: HoldingGovernanceActorRef;
  preview?: HoldingGovernancePreviewModel;
  startError?: string;
  canStart: boolean;
  activeProject?: HoldingGovernanceProjectItem;
  projectHistory: HoldingGovernanceProjectItem[];
}

export interface BuildHoldingGovernancePanelModelInput {
  selectedType?: HoldingGovernanceProjectType;
  selectedHostKey?: string;
  selectedAssistantKey?: string;
}

const EFFECT_LABELS: Record<keyof HoldingGovernanceProjectEffects, string> = {
  farmlandMu: '田亩',
  registeredHouseholds: '编户',
  population: '人口状况',
  agriculture: '农桑',
  commerce: '工商',
  publicOrder: '治安',
  popularSupport: '民心',
  corruption: '腐败',
  defense: '防务',
  recruitPotential: '征募基础',
  armory: '军械',
  horseSupply: '军马',
};

const RISK_LABELS: Record<HoldingGovernanceProjectRisk, string> = {
  low: '低',
  moderate: '中',
  high: '高',
};

const STATUS_LABELS: Record<HoldingGovernanceProjectStatus, string> = {
  active: '进行中',
  blocked: '已受阻',
  completed: '已完成',
  cancelled: '已取消',
};

function actorKey(actor: HoldingGovernanceActorRef): string {
  return `${actor.actorType}:${actor.actorId}`;
}

function buildActorOptions(state: RuntimeState, holding: HoldingLedgerEntry): HoldingGovernanceActorOption[] {
  const playerRef: HoldingGovernanceActorRef = { actorType: 'player', actorId: state.player.id };
  const appointedNpcIds = new Set([
    holding.stewardNpcId,
    ...(holding.governanceOfficerNpcIds ?? []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0));
  const npcOptions = (state.npcs ?? [])
    .filter((npc) => appointedNpcIds.has(npc.npcId) && Boolean(holding.locationId) && npc.locationId === holding.locationId)
    .map((npc): HoldingGovernanceActorOption => ({
      key: actorKey({ actorType: 'npc', actorId: npc.npcId }),
      actorRef: { actorType: 'npc', actorId: npc.npcId },
      label: npc.name,
      subtitle: holding.stewardNpcId === npc.npcId ? '本领地管事 · 当前在场' : '治理官员 · 当前在场',
    }));
  return [
    {
      key: actorKey(playerRef),
      actorRef: playerRef,
      label: state.player.name,
      subtitle: '主角亲自主持',
    },
    ...npcOptions,
  ];
}

function resolveArtName(state: RuntimeState, actorRefs: HoldingGovernanceActorRef[], artId: string): string {
  for (const actor of actorRefs) {
    const arts: CharacterUniqueArt[] | undefined = actor.actorType === 'player'
      ? state.player.uniqueArts
      : state.npcs?.find((npc) => npc.npcId === actor.actorId)?.uniqueArts;
    const art = arts?.find((candidate) => candidate.id === artId);
    if (art) return art.name;
  }
  return '已记录绝艺';
}

function actorLabel(state: RuntimeState, actor: HoldingGovernanceActorRef): string {
  if (actor.actorType === 'player') return state.player.name;
  return state.npcs?.find((npc) => npc.npcId === actor.actorId)?.name ?? '已离场人物';
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function formatEffectRanges(ranges: HoldingGovernanceProjectEffectRanges): HoldingGovernanceEffectRow[] {
  return Object.entries(ranges).map(([field, range]) => ({
    field: field as keyof HoldingGovernanceProjectEffects,
    label: EFFECT_LABELS[field as keyof HoldingGovernanceProjectEffects],
    value: range.min === range.max
      ? formatSigned(range.min)
      : `${formatSigned(range.min)} 至 ${formatSigned(range.max)}`,
  }));
}

function formatEffects(effects: HoldingGovernanceProjectEffects | undefined): HoldingGovernanceEffectRow[] {
  if (!effects) return [];
  return Object.entries(effects).map(([field, value]) => ({
    field: field as keyof HoldingGovernanceProjectEffects,
    label: EFFECT_LABELS[field as keyof HoldingGovernanceProjectEffects],
    value: formatSigned(value),
  }));
}

function toClockOrdinal(label: string): number | undefined {
  const clock = tryCreateGameClockFromDateLabel(label);
  if (!clock) return undefined;
  return (((clock.year * 12 + clock.month) * 30 + clock.day) * 24 + clock.hour) * 60 + clock.minute;
}

function calculateProgress(project: HoldingGovernanceProjectEntry, currentDate: string): number {
  if (project.status === 'completed') return 100;
  if (project.status !== 'active') return 0;
  const start = toClockOrdinal(project.startedAt);
  const end = toClockOrdinal(project.expectedCompleteAt);
  const current = toClockOrdinal(currentDate);
  if (start === undefined || end === undefined || current === undefined || end <= start) return 0;
  return Math.max(0, Math.min(99, Math.round(((current - start) / (end - start)) * 100)));
}

function toProjectItem(state: RuntimeState, project: HoldingGovernanceProjectEntry): HoldingGovernanceProjectItem {
  const definition = getHoldingGovernanceProjectDefinition(project.type);
  const progressPercent = calculateProgress(project, state.currentDate);
  const actorRefs = [project.host, ...(project.assistant ? [project.assistant] : [])];
  return {
    projectId: project.projectId,
    title: definition.label,
    status: project.status,
    statusText: STATUS_LABELS[project.status],
    timingText: `${project.startedAt} → ${project.expectedCompleteAt}`,
    hostText: actorLabel(state, project.host),
    ...(project.assistant ? { assistantText: actorLabel(state, project.assistant) } : {}),
    investmentText: `${project.investedMoney}贯 / ${project.investedGrain}石`,
    riskText: RISK_LABELS[project.risk],
    progressPercent,
    progressText: project.status === 'active' ? `${progressPercent}%` : STATUS_LABELS[project.status],
    expectedEffectRows: formatEffectRanges(project.expectedEffects),
    appliedArtNames: (project.appliedArtIds ?? []).map((artId) => resolveArtName(state, actorRefs, artId)),
    ...(project.result?.summary ? { resultSummary: project.result.summary } : {}),
    resultRows: formatEffects(project.result?.deltas),
    ...(project.blockedReason ? { blockedReason: project.blockedReason } : {}),
  };
}

export function buildHoldingGovernancePanelModel(
  state: RuntimeState,
  holding: HoldingLedgerEntry,
  input: BuildHoldingGovernancePanelModelInput = {},
): HoldingGovernancePanelModel {
  const projectOptions = getHoldingGovernanceProjectTypes(holding).map((type) => {
    const definition = getHoldingGovernanceProjectDefinition(type);
    const disabledReason = validateHoldingGovernanceProjectApplicability(holding, type);
    return {
      type,
      label: definition.label,
      description: definition.description,
      ...(disabledReason ? { disabledReason } : {}),
    };
  });
  const selectedType = projectOptions.some((option) => option.type === input.selectedType)
    ? input.selectedType!
    : projectOptions.find((option) => !option.disabledReason)?.type ?? projectOptions[0]?.type ?? 'public_order';
  const actorOptions = buildActorOptions(state, holding);
  const selectedHostOption = actorOptions.find((option) => option.key === input.selectedHostKey) ?? actorOptions[0];
  const selectedAssistantOption = input.selectedAssistantKey
    ? actorOptions.find((option) => option.key === input.selectedAssistantKey)
    : undefined;
  const selectedHost = selectedHostOption.actorRef;
  const selectedAssistant = selectedAssistantOption?.actorRef;
  const assistantEligibilityHint = actorOptions.some((option) => option.key !== selectedHostOption.key)
    ? undefined
    : '暂无可选协助者：NPC 须已写入人物志，被任命为本领地管事或治理官员，且当前位置与本领地一致。';
  const holdingProjects = (state.holdingGovernanceProjects ?? [])
    .filter((project) => project.holdingId === holding.holdingId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt, 'zh-Hans-CN'));
  const activeProjectEntry = holdingProjects.find((project) => project.status === 'active');
  const applicabilityError = validateHoldingGovernanceProjectApplicability(holding, selectedType);
  const hostError = validateHoldingGovernanceActorRef(state, holding, selectedHost);
  const assistantError = selectedAssistant
    ? validateHoldingGovernanceActorRef(state, holding, selectedAssistant)
    : undefined;
  const sameActor = Boolean(selectedAssistant && actorKey(selectedAssistant) === actorKey(selectedHost));
  const projection = buildHoldingGovernanceActorProjection(state, selectedType, selectedHost, selectedAssistant);
  const preview = buildHoldingGovernanceProjectPreview(holding, selectedType, projection);
  const insufficientResources = (state.resources?.money ?? 0) < preview.moneyCost
    || (state.resources?.grain ?? 0) < preview.grainCost;
  const startError = activeProjectEntry
    ? '该领地已有进行中的治理项目。'
    : applicabilityError
      ?? hostError
      ?? (sameActor ? '主持者与协助者不能是同一角色。' : undefined)
      ?? (assistantError ? `协助者不可用：${assistantError}` : undefined)
      ?? (insufficientResources ? '势力钱粮不足，暂时不能开工。' : undefined);
  const actorRefs = [selectedHost, ...(selectedAssistant ? [selectedAssistant] : [])];
  const previewModel: HoldingGovernancePreviewModel = {
    title: preview.definition.label,
    description: preview.definition.description,
    moneyCostText: `${preview.moneyCost}贯`,
    grainCostText: `${preview.grainCost}石`,
    durationText: `${preview.durationDays}天`,
    riskText: RISK_LABELS[preview.risk],
    effectRows: formatEffectRanges(preview.expectedEffects),
    appliedArtNames: preview.appliedArtIds.map((artId) => resolveArtName(state, actorRefs, artId)),
    modifierSummary: `主持能力 ${preview.modifiers.hostAbilityScore}`
      + `${preview.modifiers.assistantAbilityScore !== undefined ? ` · 协助 ${preview.modifiers.assistantAbilityScore}` : ''}`
      + ` · 工期 ${Math.round(preview.modifiers.durationMultiplier * 100)}%`
      + ` · 成本 ${Math.round(preview.modifiers.costMultiplier * 100)}%`
      + ` · 效果 ${Math.round(preview.modifiers.effectMultiplier * 100)}%`,
  };
  const projectHistory = holdingProjects.map((project) => toProjectItem(state, project));

  return {
    projectOptions,
    actorOptions,
    ...(assistantEligibilityHint ? { assistantEligibilityHint } : {}),
    selectedType,
    selectedHostKey: selectedHostOption.key,
    selectedAssistantKey: selectedAssistantOption?.key ?? '',
    selectedHost,
    ...(selectedAssistant ? { selectedAssistant } : {}),
    preview: previewModel,
    ...(startError ? { startError } : {}),
    canStart: !startError,
    ...(activeProjectEntry ? { activeProject: toProjectItem(state, activeProjectEntry) } : {}),
    projectHistory,
  };
}
