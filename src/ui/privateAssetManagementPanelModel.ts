import type {
  CharacterUniqueArt,
  HoldingGovernanceActorRef,
  HoldingGovernanceProjectRisk,
  PrivateAssetEntry,
  PrivateAssetProjectDelta,
  PrivateAssetProjectEntry,
  PrivateAssetProjectStatus,
  PrivateAssetProjectType,
  RuntimeState,
} from '../engine/types';
import {
  buildPrivateAssetManagementPreview,
  getPrivateAssetManagementDefinition,
  getPrivateAssetManagementProjectTypes,
  validatePrivateAssetManagementActor,
  validatePrivateAssetManagementApplicability,
} from '../engine/holdings/PrivateAssetManagementProjects';
import { tryCreateGameClockFromDateLabel } from '../engine/time/gameClock';

export interface PrivateAssetManagementActorOption {
  key: string;
  actorRef: HoldingGovernanceActorRef;
  label: string;
  subtitle: string;
}

export interface PrivateAssetManagementPanelModel {
  projectOptions: Array<{ type: PrivateAssetProjectType; label: string; description: string; disabledReason?: string }>;
  actorOptions: PrivateAssetManagementActorOption[];
  selectedType: PrivateAssetProjectType;
  selectedHostKey: string;
  selectedAssistantKey: string;
  selectedHost: HoldingGovernanceActorRef;
  selectedAssistant?: HoldingGovernanceActorRef;
  assistantEligibilityHint?: string;
  preview: {
    title: string;
    description: string;
    moneyCostText: string;
    grainCostText: string;
    durationText: string;
    riskText: string;
    effectRows: Array<{ field: keyof PrivateAssetProjectDelta; label: string; value: string }>;
    appliedArtNames: string[];
    modifierSummary: string;
  };
  activeProject?: ReturnType<typeof toProjectItem>;
  projectHistory: Array<ReturnType<typeof toProjectItem>>;
  startError?: string;
  canStart: boolean;
}

export interface BuildPrivateAssetManagementPanelModelInput {
  selectedType?: PrivateAssetProjectType;
  selectedHostKey?: string;
  selectedAssistantKey?: string;
}

const DELTA_LABELS: Record<keyof PrivateAssetProjectDelta, string> = {
  mu: '田亩', households: '户数', workers: '人手', workshopScale: '作坊规模', ranchCapacity: '牧养容量',
};
const RISK_LABELS: Record<HoldingGovernanceProjectRisk, string> = { low: '低', moderate: '中', high: '高' };
const STATUS_LABELS: Record<PrivateAssetProjectStatus, string> = {
  planned: '待开工', active: '进行中', blocked: '已受阻', completed: '已完成', cancelled: '已取消',
};

function actorKey(actor: HoldingGovernanceActorRef): string { return `${actor.actorType}:${actor.actorId}`; }

function buildActorOptions(state: RuntimeState, asset: PrivateAssetEntry): PrivateAssetManagementActorOption[] {
  const playerRef: HoldingGovernanceActorRef = { actorType: 'player', actorId: state.player.id };
  const manager = asset.managerNpcId
    ? state.npcs?.find((npc) => npc.npcId === asset.managerNpcId && Boolean(asset.locationId) && npc.locationId === asset.locationId)
    : undefined;
  return [
    { key: actorKey(playerRef), actorRef: playerRef, label: state.player.name, subtitle: '主角亲自主持' },
    ...(manager ? [{
      key: actorKey({ actorType: 'npc', actorId: manager.npcId }),
      actorRef: { actorType: 'npc' as const, actorId: manager.npcId },
      label: manager.name,
      subtitle: '本产业管事 · 当前在场',
    }] : []),
  ];
}

function artName(state: RuntimeState, refs: HoldingGovernanceActorRef[], id: string): string {
  for (const ref of refs) {
    const arts: CharacterUniqueArt[] | undefined = ref.actorType === 'player'
      ? state.player.uniqueArts
      : state.npcs?.find((npc) => npc.npcId === ref.actorId)?.uniqueArts;
    const art = arts?.find((item) => item.id === id);
    if (art) return art.name;
  }
  return '已记录绝艺';
}

function actorLabel(state: RuntimeState, actor?: HoldingGovernanceActorRef): string {
  if (!actor) return '无';
  return actor.actorType === 'player'
    ? state.player.name
    : state.npcs?.find((npc) => npc.npcId === actor.actorId)?.name ?? '已离场人物';
}

function effectRows(delta: PrivateAssetProjectDelta = {}) {
  return Object.entries(delta).map(([field, value]) => ({
    field: field as keyof PrivateAssetProjectDelta,
    label: DELTA_LABELS[field as keyof PrivateAssetProjectDelta],
    value: `+${value}`,
  }));
}

function ordinal(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const clock = tryCreateGameClockFromDateLabel(value);
  return clock ? (((clock.year * 12 + clock.month) * 30 + clock.day) * 24 + clock.hour) * 60 + clock.minute : undefined;
}

function toProjectItem(state: RuntimeState, project: PrivateAssetProjectEntry) {
  const start = ordinal(project.startedAt);
  const end = ordinal(project.expectedCompleteAt);
  const current = ordinal(state.currentDate);
  const progressPercent = project.status === 'completed' ? 100
    : project.status !== 'active' || start === undefined || end === undefined || current === undefined || end <= start ? 0
      : Math.max(0, Math.min(99, Math.round(((current - start) / (end - start)) * 100)));
  const refs = [project.host, project.assistant].filter((item): item is HoldingGovernanceActorRef => Boolean(item));
  return {
    projectId: project.projectId,
    title: project.title,
    statusText: STATUS_LABELS[project.status],
    timingText: `${project.startedAt}${project.expectedCompleteAt ? ` → ${project.expectedCompleteAt}` : ''}`,
    progressPercent,
    progressText: project.status === 'active' ? `${progressPercent}%` : STATUS_LABELS[project.status],
    hostText: actorLabel(state, project.host),
    assistantText: actorLabel(state, project.assistant),
    investmentText: `${project.investedMoney ?? 0}贯 / ${project.investedGrain ?? 0}石`,
    riskText: project.risk ? RISK_LABELS[project.risk] : '未记录',
    effectRows: effectRows(project.targetDelta),
    appliedArtNames: (project.appliedArtIds ?? []).map((id) => artName(state, refs, id)),
  };
}

export function buildPrivateAssetManagementPanelModel(
  state: RuntimeState,
  asset: PrivateAssetEntry,
  input: BuildPrivateAssetManagementPanelModelInput = {},
): PrivateAssetManagementPanelModel {
  const projectOptions = getPrivateAssetManagementProjectTypes(asset).map((type) => {
    const definition = getPrivateAssetManagementDefinition(type);
    const disabledReason = validatePrivateAssetManagementApplicability(asset, type);
    return { type, label: definition.label, description: definition.description, ...(disabledReason ? { disabledReason } : {}) };
  });
  const selectedType = projectOptions.some((option) => option.type === input.selectedType)
    ? input.selectedType!
    : projectOptions[0]?.type ?? 'repair';
  const actors = buildActorOptions(state, asset);
  const hostOption = actors.find((actor) => actor.key === input.selectedHostKey) ?? actors[0];
  const assistantOption = actors.find((actor) => actor.key === input.selectedAssistantKey);
  const selectedHost = hostOption.actorRef;
  const selectedAssistant = assistantOption?.actorRef;
  const projects = (state.privateAssetProjects ?? [])
    .filter((project) => project.assetId === asset.privateAssetId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt, 'zh-Hans-CN'));
  const activeEntry = projects.find((project) => project.status === 'active');
  const projection = buildPrivateAssetManagementPreview(state, asset, selectedType, selectedHost, selectedAssistant);
  const sameActor = selectedAssistant && actorKey(selectedAssistant) === actorKey(selectedHost);
  const startError = activeEntry ? '该产业已有进行中的经营项目。'
    : validatePrivateAssetManagementApplicability(asset, selectedType)
      ?? validatePrivateAssetManagementActor(state, asset, selectedHost)
      ?? (sameActor ? '主持者与协助者不能是同一角色。' : undefined)
      ?? (selectedAssistant ? validatePrivateAssetManagementActor(state, asset, selectedAssistant) : undefined)
      ?? (((state.resources?.money ?? 0) < projection.moneyCost || (state.resources?.grain ?? 0) < projection.grainCost)
        ? '当前共用钱粮账本不足，暂时不能开工。' : undefined);
  const refs = [selectedHost, ...(selectedAssistant ? [selectedAssistant] : [])];
  return {
    projectOptions,
    actorOptions: actors,
    selectedType,
    selectedHostKey: hostOption.key,
    selectedAssistantKey: assistantOption?.key ?? '',
    selectedHost,
    ...(selectedAssistant ? { selectedAssistant } : {}),
    ...(actors.length < 2 ? { assistantEligibilityHint: '暂无可选协助者：须先由结构化写回登记产业管事，且该 NPC 当前在产业所在地。' } : {}),
    preview: {
      title: projection.definition.label,
      description: projection.definition.description,
      moneyCostText: `${projection.moneyCost}贯`,
      grainCostText: `${projection.grainCost}石`,
      durationText: `${projection.durationDays}天`,
      riskText: RISK_LABELS[projection.risk],
      effectRows: effectRows(projection.targetDelta),
      appliedArtNames: projection.appliedArtIds.map((id) => artName(state, refs, id)),
      modifierSummary: `主持能力 ${projection.modifiers.hostAbilityScore}`
        + `${projection.modifiers.assistantAbilityScore !== undefined ? ` · 协助 ${projection.modifiers.assistantAbilityScore}` : ''}`
        + ` · 工期 ${Math.round(projection.modifiers.durationMultiplier * 100)}%`
        + ` · 成本 ${Math.round(projection.modifiers.costMultiplier * 100)}%`
        + ` · 效果 ${Math.round(projection.modifiers.effectMultiplier * 100)}%`,
    },
    ...(activeEntry ? { activeProject: toProjectItem(state, activeEntry) } : {}),
    projectHistory: projects.map((project) => toProjectItem(state, project)),
    ...(startError ? { startError } : {}),
    canStart: !startError,
  };
}
