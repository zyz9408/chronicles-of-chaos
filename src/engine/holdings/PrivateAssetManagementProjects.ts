import type {
  HoldingGovernanceActorRef,
  HoldingGovernanceProjectModifiers,
  HoldingGovernanceProjectRisk,
  HoldingGovernanceProjectType,
  PrivateAssetEntry,
  PrivateAssetProjectDelta,
  PrivateAssetProjectEntry,
  PrivateAssetProjectType,
  RuntimeState,
} from '../types';
import { advanceGameClock, ensureGameClock, formatGameClock } from '../time/gameClock';
import { v4 as uuidv4 } from '../turn/uuid';
import { buildHoldingGovernanceActorProjection } from './HoldingGovernanceProjects';
import {
  getPrivateAssetAbsoluteScaleLimits,
  getPrivateAssetProjectDeltaLimits,
} from './PrivateAssetPolicy';

export interface PrivateAssetManagementDefinition {
  type: PrivateAssetProjectType;
  label: string;
  description: string;
  durationDays: number;
  moneyCost: number;
  grainCost: number;
  risk: HoldingGovernanceProjectRisk;
  artProjectType: HoldingGovernanceProjectType;
}

export interface PrivateAssetManagementPreview {
  definition: PrivateAssetManagementDefinition;
  moneyCost: number;
  grainCost: number;
  durationDays: number;
  risk: HoldingGovernanceProjectRisk;
  targetDelta: PrivateAssetProjectDelta;
  appliedArtIds: string[];
  modifiers: HoldingGovernanceProjectModifiers;
}

export interface StartPrivateAssetManagementInput {
  assetId: string;
  type: PrivateAssetProjectType;
  host: HoldingGovernanceActorRef;
  assistant?: HoldingGovernanceActorRef;
  projectId?: string;
}

export interface PrivateAssetManagementMutationResult {
  ok: boolean;
  state: RuntimeState;
  project?: PrivateAssetProjectEntry;
  error?: string;
}

const DEFINITIONS: Partial<Record<PrivateAssetProjectType, PrivateAssetManagementDefinition>> = {
  expand_farmland: {
    type: 'expand_farmland', label: '开垦田亩', description: '清理荒地、补足农具并逐步扩大可耕田亩。',
    durationDays: 45, moneyCost: 140, grainCost: 60, risk: 'moderate', artProjectType: 'land_survey',
  },
  irrigation: {
    type: 'irrigation', label: '修整水利', description: '修渠疏沟，改善田庄与农地的稳定产出。',
    durationDays: 60, moneyCost: 260, grainCost: 100, risk: 'moderate', artProjectType: 'irrigation',
  },
  build_workshop: {
    type: 'build_workshop', label: '兴建作坊', description: '置办场地、器具和匠役，建立第一座可结算作坊。',
    durationDays: 60, moneyCost: 320, grainCost: 70, risk: 'moderate', artProjectType: 'commerce',
  },
  expand_workshop: {
    type: 'expand_workshop', label: '扩建作坊', description: '扩充工棚与器具，提高作坊规模和匠役承载。',
    durationDays: 75, moneyCost: 480, grainCost: 90, risk: 'moderate', artProjectType: 'commerce',
  },
  build_ranch: {
    type: 'build_ranch', label: '兴建牧场', description: '修整围栏、草料与畜舍，建立可持续牧养能力。',
    durationDays: 75, moneyCost: 360, grainCost: 160, risk: 'moderate', artProjectType: 'route_patrol',
  },
  expand_ranch: {
    type: 'expand_ranch', label: '扩建牧场', description: '扩大草场、畜舍与照料人手，提高牧场容量。',
    durationDays: 75, moneyCost: 420, grainCost: 180, risk: 'moderate', artProjectType: 'route_patrol',
  },
  recruit_tenants: {
    type: 'recruit_tenants', label: '招募庄客', description: '安置佃户或雇工，补充产业长期经营所需人手。',
    durationDays: 30, moneyCost: 120, grainCost: 180, risk: 'low', artProjectType: 'refugee_resettlement',
  },
  repair: {
    type: 'repair', label: '修缮产业', description: '修复受损建筑、器具和生产条件，使产业恢复正常经营。',
    durationDays: 25, moneyCost: 180, grainCost: 80, risk: 'low', artProjectType: 'relief',
  },
};

const TYPES_BY_ASSET: Record<PrivateAssetEntry['type'], readonly PrivateAssetProjectType[]> = {
  estate: ['expand_farmland', 'irrigation', 'recruit_tenants', 'repair'],
  farmland: ['expand_farmland', 'irrigation', 'recruit_tenants', 'repair'],
  workshop: ['build_workshop', 'expand_workshop', 'recruit_tenants', 'repair'],
  ranch: ['build_ranch', 'expand_ranch', 'recruit_tenants', 'repair'],
  shop: ['recruit_tenants', 'repair'],
  ferry: ['recruit_tenants', 'repair'],
  mine: ['recruit_tenants', 'repair'],
  other: ['recruit_tenants', 'repair'],
};

export function getPrivateAssetManagementProjectTypes(asset: PrivateAssetEntry): PrivateAssetProjectType[] {
  return TYPES_BY_ASSET[asset.type].filter((type) => {
    if (type === 'repair') return asset.status === 'damaged';
    if (type === 'build_workshop') return (asset.workshopScale ?? 0) <= 0;
    if (type === 'expand_workshop') return (asset.workshopScale ?? 0) > 0;
    if (type === 'build_ranch') return (asset.ranchCapacity ?? 0) <= 0;
    if (type === 'expand_ranch') return (asset.ranchCapacity ?? 0) > 0;
    return true;
  });
}

export function getPrivateAssetManagementDefinition(type: PrivateAssetProjectType): PrivateAssetManagementDefinition {
  const definition = DEFINITIONS[type];
  if (!definition) throw new Error(`不支持直接经营的私产项目：${type}`);
  return definition;
}

export function validatePrivateAssetManagementActor(
  state: RuntimeState,
  asset: PrivateAssetEntry,
  actor: HoldingGovernanceActorRef,
): string | undefined {
  if (actor.actorType === 'player') return actor.actorId === state.player.id ? undefined : '经营者不是当前玩家。';
  if (actor.actorType !== 'npc') return '经营角色类型无效。';
  const npc = state.npcs?.find((item) => item.npcId === actor.actorId);
  if (!npc) return '产业管事已不存在。';
  if (asset.managerNpcId !== npc.npcId) return '该 NPC 尚未被结构化登记为本产业管事。';
  if (!asset.locationId || npc.locationId !== asset.locationId) return '产业管事当前不在产业所在地。';
  return undefined;
}

export function validatePrivateAssetManagementApplicability(
  asset: PrivateAssetEntry,
  type: PrivateAssetProjectType,
): string | undefined {
  if (!['active', 'damaged'].includes(asset.status)) return '只有正常或受损的现有产业可以启动经营项目。';
  if (!getPrivateAssetManagementProjectTypes(asset).includes(type)) return '该项目不适用于当前产业类型或状态。';
  const delta = buildBaseTargetDelta(asset, type);
  if (type !== 'repair' && !Object.values(delta).some((value) => (value ?? 0) > 0)) {
    return '该项目涉及的产业规模已经达到本地硬上限。';
  }
  return undefined;
}

export function buildPrivateAssetManagementPreview(
  state: RuntimeState,
  asset: PrivateAssetEntry,
  type: PrivateAssetProjectType,
  host: HoldingGovernanceActorRef,
  assistant?: HoldingGovernanceActorRef,
): PrivateAssetManagementPreview {
  const definition = getPrivateAssetManagementDefinition(type);
  const projection = buildHoldingGovernanceActorProjection(state, definition.artProjectType, host, assistant);
  const ownerScale = asset.ownerScope === 'faction' ? 1.5 : asset.ownerScope === 'clan' ? 1.25 : 1;
  return {
    definition,
    moneyCost: Math.round(definition.moneyCost * ownerScale * projection.modifiers.costMultiplier),
    grainCost: Math.round(definition.grainCost * ownerScale * projection.modifiers.costMultiplier),
    durationDays: Math.max(1, Math.ceil(definition.durationDays * projection.modifiers.durationMultiplier)),
    risk: reduceRisk(definition.risk, projection.modifiers.riskStepsReduced),
    targetDelta: scaleTargetDelta(asset, buildBaseTargetDelta(asset, type), projection.modifiers.effectMultiplier),
    appliedArtIds: projection.appliedArtIds,
    modifiers: projection.modifiers,
  };
}

export function startPrivateAssetManagementProject(
  state: RuntimeState,
  input: StartPrivateAssetManagementInput,
): PrivateAssetManagementMutationResult {
  const asset = state.privateAssets?.find((item) => item.privateAssetId === input.assetId);
  if (!asset) return { ok: false, state, error: '未找到目标私人产业。' };
  const applicabilityError = validatePrivateAssetManagementApplicability(asset, input.type);
  if (applicabilityError) return { ok: false, state, error: applicabilityError };
  if ((state.privateAssetProjects ?? []).some((project) => project.assetId === asset.privateAssetId && project.status === 'active')) {
    return { ok: false, state, error: '该产业已有进行中的经营项目。' };
  }
  const hostError = validatePrivateAssetManagementActor(state, asset, input.host);
  if (hostError) return { ok: false, state, error: hostError };
  if (input.assistant) {
    if (input.assistant.actorType === input.host.actorType && input.assistant.actorId === input.host.actorId) {
      return { ok: false, state, error: '主持者与协助者不能是同一角色。' };
    }
    const assistantError = validatePrivateAssetManagementActor(state, asset, input.assistant);
    if (assistantError) return { ok: false, state, error: `协助者不可用：${assistantError}` };
  }
  const preview = buildPrivateAssetManagementPreview(state, asset, input.type, input.host, input.assistant);
  const resources = state.resources;
  if ((resources?.money ?? 0) < preview.moneyCost || (resources?.grain ?? 0) < preview.grainCost) {
    return { ok: false, state, error: '当前共用钱粮账本不足，项目未开工也未扣除资源。' };
  }
  const expectedCompleteAt = formatGameClock(advanceGameClock(ensureGameClock(state), { daysAdvanced: preview.durationDays }));
  const project: PrivateAssetProjectEntry = {
    projectId: input.projectId?.trim() || `private-management:${asset.privateAssetId}:${input.type}:${uuidv4()}`,
    assetId: asset.privateAssetId,
    title: preview.definition.label,
    type: input.type,
    status: 'active',
    startedAt: state.currentDate,
    expectedCompleteAt,
    investedMoney: preview.moneyCost,
    investedGrain: preview.grainCost,
    targetDelta: { ...preview.targetDelta },
    host: { ...input.host },
    ...(input.assistant ? { assistant: { ...input.assistant } } : {}),
    risk: preview.risk,
    modifiers: { ...preview.modifiers },
    ...(preview.appliedArtIds.length > 0 ? { appliedArtIds: [...preview.appliedArtIds] } : {}),
    progressNotes: ['由玩家在私人产业界面立项；资源已按本地合同扣除。'],
    updatedAt: state.currentDate,
  };
  return {
    ok: true,
    project,
    state: {
      ...state,
      resources: { ...resources!, money: resources!.money - preview.moneyCost, grain: resources!.grain - preview.grainCost },
      privateAssetProjects: [...(state.privateAssetProjects ?? []), project],
    },
  };
}

export function cancelPrivateAssetManagementProject(
  state: RuntimeState,
  projectId: string,
): PrivateAssetManagementMutationResult {
  const project = state.privateAssetProjects?.find((item) => item.projectId === projectId);
  if (!project || project.status !== 'active') return { ok: false, state, error: '未找到可取消的进行中私产项目。' };
  const updated = { ...project, status: 'cancelled' as const, cancelledAt: state.currentDate, updatedAt: state.currentDate };
  return {
    ok: true,
    project: updated,
    state: { ...state, privateAssetProjects: (state.privateAssetProjects ?? []).map((item) => item.projectId === projectId ? updated : item) },
  };
}

function buildBaseTargetDelta(asset: PrivateAssetEntry, type: PrivateAssetProjectType): PrivateAssetProjectDelta {
  const limits = getPrivateAssetProjectDeltaLimits(asset.type, asset.ownerScope);
  switch (type) {
    case 'expand_farmland': return { mu: Math.max(1, Math.round(limits.mu * 0.45)) };
    case 'irrigation': return { mu: Math.max(1, Math.round(limits.mu * 0.25)) };
    case 'build_workshop':
    case 'expand_workshop': return { workshopScale: 1, workers: Math.max(1, Math.round(limits.workers * 0.2)) };
    case 'build_ranch':
    case 'expand_ranch': return { ranchCapacity: Math.max(1, Math.round(limits.ranchCapacity * 0.5)), workers: Math.max(1, Math.round(limits.workers * 0.15)) };
    case 'recruit_tenants': return asset.type === 'estate' || asset.type === 'farmland'
      ? { households: Math.max(1, Math.round(limits.households * 0.35)), workers: Math.max(1, Math.round(limits.workers * 0.2)) }
      : { workers: Math.max(1, Math.round(limits.workers * 0.35)) };
    default: return {};
  }
}

function scaleTargetDelta(asset: PrivateAssetEntry, delta: PrivateAssetProjectDelta, multiplier: number): PrivateAssetProjectDelta {
  const absolute = getPrivateAssetAbsoluteScaleLimits(asset.type, asset.ownerScope);
  const current: Record<keyof PrivateAssetProjectDelta, number> = {
    mu: asset.mu ?? 0, households: asset.households ?? 0, workers: asset.workers ?? 0,
    workshopScale: asset.workshopScale ?? 0, ranchCapacity: asset.ranchCapacity ?? 0,
  };
  const result: PrivateAssetProjectDelta = {};
  for (const [field, value] of Object.entries(delta)) {
    const key = field as keyof PrivateAssetProjectDelta;
    const scaled = key === 'workshopScale' ? value : Math.max(1, Math.round(value * multiplier));
    const capped = Math.max(0, Math.min(absolute[key] - current[key], scaled));
    if (capped > 0) result[key] = capped;
  }
  return result;
}

function reduceRisk(risk: HoldingGovernanceProjectRisk, steps: number): HoldingGovernanceProjectRisk {
  const order: HoldingGovernanceProjectRisk[] = ['low', 'moderate', 'high'];
  return order[Math.max(0, order.indexOf(risk) - Math.max(0, Math.floor(steps)))] ?? risk;
}
