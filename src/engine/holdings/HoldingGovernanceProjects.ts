import type {
  CharacterUniqueArt,
  HoldingGovernanceActorRef,
  HoldingGovernanceProjectEffectRanges,
  HoldingGovernanceProjectEffects,
  HoldingGovernanceProjectEntry,
  HoldingGovernanceProjectModifiers,
  HoldingGovernanceProjectRisk,
  HoldingGovernanceProjectType,
  HoldingLedgerEntry,
  RuntimeState,
} from '../types';
import { resolveHoldingCivilAdministrationScope } from './HoldingCivilAdministration';
import {
  getHoldingGovernanceFieldUpperLimit,
  resolveHoldingCivilScaleLevel,
} from './HoldingCapacityPolicy';
import {
  advanceGameClock,
  ensureGameClock,
  formatGameClock,
  tryCreateGameClockFromDateLabel,
} from '../time/gameClock';
import { v4 as uuidv4 } from '../turn/uuid';

export interface HoldingGovernanceProjectDefinition {
  type: HoldingGovernanceProjectType;
  label: string;
  description: string;
  durationDays: number;
  moneyCostPerScale: number;
  grainCostPerScale: number;
  risk: HoldingGovernanceProjectRisk;
  allowedFields: readonly (keyof HoldingGovernanceProjectEffects)[];
}

export interface HoldingGovernanceProjectPreview {
  definition: HoldingGovernanceProjectDefinition;
  moneyCost: number;
  grainCost: number;
  durationDays: number;
  expectedEffects: HoldingGovernanceProjectEffectRanges;
  risk: HoldingGovernanceProjectRisk;
  appliedArtIds: string[];
  modifiers: HoldingGovernanceProjectModifiers;
}

export interface StartHoldingGovernanceProjectInput {
  holdingId: string;
  type: HoldingGovernanceProjectType;
  host: HoldingGovernanceActorRef;
  assistant?: HoldingGovernanceActorRef;
  projectId?: string;
}

export interface HoldingGovernanceMutationResult {
  ok: boolean;
  state: RuntimeState;
  project?: HoldingGovernanceProjectEntry;
  error?: string;
}

const DEFINITIONS: Record<HoldingGovernanceProjectType, HoldingGovernanceProjectDefinition> = {
  land_survey: {
    type: 'land_survey',
    label: '清丈田亩',
    description: '核清隐漏与荒熟田亩，改善土地账目和农业基础。',
    durationDays: 30,
    moneyCostPerScale: 200,
    grainCostPerScale: 50,
    risk: 'moderate',
    allowedFields: ['farmlandMu', 'agriculture'],
  },
  household_registration: {
    type: 'household_registration',
    label: '编户齐民',
    description: '整理户籍与人口登记，建立可持续的民政底册。',
    durationDays: 30,
    moneyCostPerScale: 150,
    grainCostPerScale: 40,
    risk: 'moderate',
    allowedFields: ['registeredHouseholds', 'population'],
  },
  irrigation: {
    type: 'irrigation',
    label: '兴修水利',
    description: '修渠、疏浚与维护灌溉，改善田亩和农业产能。',
    durationDays: 60,
    moneyCostPerScale: 500,
    grainCostPerScale: 200,
    risk: 'moderate',
    allowedFields: ['farmlandMu', 'agriculture'],
  },
  anti_corruption: {
    type: 'anti_corruption',
    label: '整治贪腐',
    description: '清查侵吞、胥吏舞弊与征收损耗，降低腐败。',
    durationDays: 30,
    moneyCostPerScale: 250,
    grainCostPerScale: 30,
    risk: 'high',
    allowedFields: ['corruption', 'popularSupport'],
  },
  public_order: {
    type: 'public_order',
    label: '恢复治安',
    description: '整顿巡防、盗匪与基层秩序，恢复民众安全感。',
    durationDays: 20,
    moneyCostPerScale: 200,
    grainCostPerScale: 80,
    risk: 'moderate',
    allowedFields: ['publicOrder', 'popularSupport'],
  },
  refugee_resettlement: {
    type: 'refugee_resettlement',
    label: '招抚流民',
    description: '安置流民、分配生计并登记新户，扩充人口。',
    durationDays: 45,
    moneyCostPerScale: 300,
    grainCostPerScale: 300,
    risk: 'moderate',
    allowedFields: ['population', 'registeredHouseholds', 'popularSupport'],
  },
  commerce: {
    type: 'commerce',
    label: '发展工商',
    description: '修复市集、道路与作坊秩序，提高商贸活力。',
    durationDays: 60,
    moneyCostPerScale: 600,
    grainCostPerScale: 100,
    risk: 'moderate',
    allowedFields: ['commerce', 'population'],
  },
  relief: {
    type: 'relief',
    label: '储粮赈济',
    description: '调配粮秣赈济灾民，稳定民心与治安。',
    durationDays: 15,
    moneyCostPerScale: 200,
    grainCostPerScale: 600,
    risk: 'low',
    allowedFields: ['popularSupport', 'publicOrder', 'population'],
  },
  garrison_drill: {
    type: 'garrison_drill',
    label: '操练驻军',
    description: '按据点职责整顿队列、轮值与守备协同，提高驻军临战效能。',
    durationDays: 30,
    moneyCostPerScale: 250,
    grainCostPerScale: 220,
    risk: 'moderate',
    allowedFields: ['defense'],
  },
  position_fortification: {
    type: 'position_fortification',
    label: '加固防务',
    description: '修缮营垒、关墙、壕沟与拒马，强化据点正面防御。',
    durationDays: 45,
    moneyCostPerScale: 550,
    grainCostPerScale: 160,
    risk: 'moderate',
    allowedFields: ['defense'],
  },
  armory_maintenance: {
    type: 'armory_maintenance',
    label: '整修军械',
    description: '清点、修复并规范储放武器甲具，改善军械可用程度。',
    durationDays: 30,
    moneyCostPerScale: 420,
    grainCostPerScale: 80,
    risk: 'low',
    allowedFields: ['armory'],
  },
  beacon_maintenance: {
    type: 'beacon_maintenance',
    label: '整修烽燧',
    description: '修复烽燧、望楼和传警轮值，提升关隘的预警与守备能力。',
    durationDays: 25,
    moneyCostPerScale: 320,
    grainCostPerScale: 100,
    risk: 'low',
    allowedFields: ['defense'],
  },
  route_patrol: {
    type: 'route_patrol',
    label: '巡护通道',
    description: '巡查关道、驿路或水陆通道，维持警戒和军马调度能力。',
    durationDays: 20,
    moneyCostPerScale: 280,
    grainCostPerScale: 160,
    risk: 'moderate',
    allowedFields: ['defense', 'horseSupply'],
  },
};

export const HOLDING_GOVERNANCE_ART_SCOPES: Record<HoldingGovernanceProjectType, string> = {
  land_survey: 'holding.land_survey',
  household_registration: 'holding.household_registration',
  irrigation: 'holding.irrigation',
  anti_corruption: 'holding.anti_corruption',
  public_order: 'holding.public_order',
  refugee_resettlement: 'holding.refugee_resettlement',
  commerce: 'holding.commerce',
  relief: 'holding.relief',
  garrison_drill: 'holding.garrison_drill',
  position_fortification: 'holding.position_fortification',
  armory_maintenance: 'holding.armory_maintenance',
  beacon_maintenance: 'holding.beacon_maintenance',
  route_patrol: 'holding.route_patrol',
};

const LEGACY_COMPATIBLE_DOMAINS: Record<HoldingGovernanceProjectType, readonly string[]> = {
  land_survey: ['governance'],
  household_registration: ['governance'],
  irrigation: ['governance', 'craft'],
  anti_corruption: ['governance', 'strategy'],
  public_order: ['governance', 'strategy'],
  refugee_resettlement: ['governance', 'social'],
  commerce: ['governance', 'social'],
  relief: ['governance', 'social'],
  garrison_drill: ['warfare'],
  position_fortification: ['warfare', 'craft'],
  armory_maintenance: ['warfare', 'craft'],
  beacon_maintenance: ['warfare', 'strategy'],
  route_patrol: ['warfare', 'strategy'],
};

export const HOLDING_GOVERNANCE_PROJECT_TYPES = Object.keys(DEFINITIONS) as HoldingGovernanceProjectType[];

const CIVIL_PROJECT_TYPES: readonly HoldingGovernanceProjectType[] = [
  'land_survey',
  'household_registration',
  'irrigation',
  'anti_corruption',
  'public_order',
  'refugee_resettlement',
  'commerce',
  'relief',
];

const MILITARY_PROJECT_TYPES = new Set<HoldingGovernanceProjectType>([
  'garrison_drill',
  'position_fortification',
  'armory_maintenance',
  'beacon_maintenance',
  'route_patrol',
]);

const MILITARY_PROJECTS_BY_HOLDING_TYPE: Partial<Record<
  HoldingLedgerEntry['type'],
  readonly HoldingGovernanceProjectType[]
>> = {
  camp: ['garrison_drill', 'position_fortification', 'armory_maintenance'],
  fort: ['position_fortification', 'garrison_drill', 'armory_maintenance'],
  pass: ['position_fortification', 'beacon_maintenance', 'route_patrol', 'armory_maintenance'],
  port: ['route_patrol', 'position_fortification'],
};

export function getHoldingGovernanceProjectTypes(
  holding: HoldingLedgerEntry,
): HoldingGovernanceProjectType[] {
  const scope = resolveHoldingCivilAdministrationScope(holding);
  return [
    ...(scope === 'none' ? [] : CIVIL_PROJECT_TYPES),
    ...(MILITARY_PROJECTS_BY_HOLDING_TYPE[holding.type] ?? []),
  ];
}

export function getHoldingGovernanceProjectDefinition(
  type: HoldingGovernanceProjectType,
): HoldingGovernanceProjectDefinition {
  return DEFINITIONS[type];
}

export function buildHoldingGovernanceProjectPreview(
  holding: HoldingLedgerEntry,
  type: HoldingGovernanceProjectType,
  projection?: {
    appliedArtIds: string[];
    modifiers: HoldingGovernanceProjectModifiers;
  },
): HoldingGovernanceProjectPreview {
  const definition = DEFINITIONS[type];
  const civilScope = resolveHoldingCivilAdministrationScope(holding);
  const scale = CIVIL_PROJECT_TYPES.includes(type)
    ? resolveHoldingCivilScaleLevel(holding, civilScope)
    : holding.scaleLevel;
  const modifiers = projection?.modifiers ?? defaultProjectModifiers();
  const scaledEffects = scaleEffectRanges(buildExpectedEffectRanges(type, scale), modifiers.effectMultiplier);
  return {
    definition,
    moneyCost: Math.max(0, Math.round(definition.moneyCostPerScale * scale * modifiers.costMultiplier)),
    grainCost: Math.max(0, Math.round(definition.grainCostPerScale * scale * modifiers.costMultiplier)),
    durationDays: Math.max(1, Math.ceil(definition.durationDays * modifiers.durationMultiplier)),
    expectedEffects: capEffectRangesToHoldingCapacity(holding, scaledEffects),
    risk: reduceRisk(definition.risk, modifiers.riskStepsReduced),
    appliedArtIds: projection?.appliedArtIds ?? [],
    modifiers,
  };
}

export function validateHoldingGovernanceActorRef(
  state: RuntimeState,
  holding: HoldingLedgerEntry,
  actor: HoldingGovernanceActorRef,
): string | undefined {
  if (actor.actorType === 'player') {
    return actor.actorId === state.player.id ? undefined : '主持者不是当前玩家。';
  }
  if (actor.actorType !== 'npc') return '治理角色类型无效。';
  const npc = state.npcs?.find((item) => item.npcId === actor.actorId);
  if (!npc) return '主持 NPC 已不存在。';
  const isAppointed = holding.stewardNpcId === npc.npcId
    || holding.governanceOfficerNpcIds?.includes(npc.npcId);
  if (!isAppointed) return '该 NPC 尚未被结构化任命为本领地管事或治理官员。';
  if (!holding.locationId || npc.locationId !== holding.locationId) {
    return '该 NPC 当前不在目标领地。';
  }
  return undefined;
}

export function buildHoldingGovernanceActorProjection(
  state: RuntimeState,
  type: HoldingGovernanceProjectType,
  host: HoldingGovernanceActorRef,
  assistant?: HoldingGovernanceActorRef,
): { appliedArtIds: string[]; modifiers: HoldingGovernanceProjectModifiers } {
  const hostActor = resolveGovernanceActor(state, host);
  const assistantActor = assistant ? resolveGovernanceActor(state, assistant) : undefined;
  const hostAbilityScore = governanceAbilityScore(hostActor?.abilityScores);
  const assistantAbilityScore = governanceAbilityScore(assistantActor?.abilityScores);
  const hostArts = selectGovernanceArts(hostActor?.uniqueArts, type);
  const assistantArts = selectGovernanceArts(assistantActor?.uniqueArts, type);
  const hostArtPower = artProjectionPower(hostArts, type);
  const assistantArtPower = artProjectionPower(assistantArts, type) * 0.5;
  const assistantAbilityContribution = assistant ? assistantAbilityScore * 0.5 : 0;
  const abilityContribution = hostAbilityScore + assistantAbilityContribution;
  const artContribution = hostArtPower + assistantArtPower;
  const durationReduction = Math.min(0.25, abilityContribution * 0.0015 + artContribution * 0.005);
  const costReduction = Math.min(0.15, abilityContribution * 0.0008 + artContribution * 0.003);
  const effectIncrease = Math.min(0.3, abilityContribution * 0.0015 + artContribution * 0.006);
  const riskStepsReduced = abilityContribution + artContribution >= 85 ? 1 : 0;
  return {
    appliedArtIds: [...new Set([...hostArts, ...assistantArts].map((art) => art.id))],
    modifiers: {
      hostAbilityScore,
      ...(assistant ? { assistantAbilityScore } : {}),
      durationMultiplier: roundMultiplier(1 - durationReduction),
      costMultiplier: roundMultiplier(1 - costReduction),
      effectMultiplier: roundMultiplier(1 + effectIncrease),
      riskStepsReduced,
    },
  };
}

export function validateHoldingGovernanceProjectApplicability(
  holding: HoldingLedgerEntry,
  type: HoldingGovernanceProjectType,
): string | undefined {
  if (holding.status !== 'controlled' && holding.status !== 'temporary') {
    return '只有当前受控或临时控制的领地可以启动治理项目。';
  }
  const scope = resolveHoldingCivilAdministrationScope(holding);
  if (MILITARY_PROJECT_TYPES.has(type)) {
    if (!(MILITARY_PROJECTS_BY_HOLDING_TYPE[holding.type] ?? []).includes(type)) {
      return '该项目不适用于此类据点。';
    }
  } else {
    if (scope === 'none') return '该领地没有民政治理范围，不能启动民政项目。';
    if ((type === 'land_survey' || type === 'irrigation') && scope === 'households') {
      return '该领地只辖民户、不辖田亩，不能启动土地类项目。';
    }
    if (type === 'anti_corruption' && holding.corruption === undefined) {
      return '该领地没有可结算的腐败字段，不能启动整治贪腐。';
    }
  }
  const effects = capEffectRangesToHoldingCapacity(
    holding,
    buildExpectedEffectRanges(type, holding.scaleLevel),
  );
  if (!Object.values(effects).some((range) => range.min !== 0 || range.max !== 0)) {
    return '该项目可改善的指标均已达到当前类型与规模上限。';
  }
  return undefined;
}

export function startHoldingGovernanceProject(
  state: RuntimeState,
  input: StartHoldingGovernanceProjectInput,
): HoldingGovernanceMutationResult {
  const holding = state.holdings?.find((item) => item.holdingId === input.holdingId);
  if (!holding) return { ok: false, state, error: '未找到目标领地。' };
  const applicabilityError = validateHoldingGovernanceProjectApplicability(holding, input.type);
  if (applicabilityError) return { ok: false, state, error: applicabilityError };
  if ((state.holdingGovernanceProjects ?? []).some((project) => (
    project.holdingId === holding.holdingId && project.status === 'active'
  ))) {
    return { ok: false, state, error: '该领地已有进行中的治理项目。' };
  }

  const hostError = validateHoldingGovernanceActorRef(state, holding, input.host);
  if (hostError) return { ok: false, state, error: hostError };
  if (input.assistant) {
    if (input.assistant.actorType === input.host.actorType && input.assistant.actorId === input.host.actorId) {
      return { ok: false, state, error: '主持者与协助者不能是同一角色。' };
    }
    const assistantError = validateHoldingGovernanceActorRef(state, holding, input.assistant);
    if (assistantError) return { ok: false, state, error: `协助者不可用：${assistantError}` };
  }

  const actorProjection = buildHoldingGovernanceActorProjection(
    state,
    input.type,
    input.host,
    input.assistant,
  );
  const preview = buildHoldingGovernanceProjectPreview(holding, input.type, actorProjection);
  const resources = state.resources ?? {
    money: 0,
    grain: 0,
    horses: 0,
    arms: 0,
    recruits: 0,
    weapons: [],
    documents: [],
    tokens: [],
    importantSupplies: [],
  };
  if (resources.money < preview.moneyCost || resources.grain < preview.grainCost) {
    return { ok: false, state, error: '势力钱粮不足，项目没有开工，也未扣除资源。' };
  }

  const startedAt = state.currentDate;
  const expectedCompleteAt = formatGameClock(advanceGameClock(
    ensureGameClock(state),
    { daysAdvanced: preview.durationDays },
  ));
  const project: HoldingGovernanceProjectEntry = {
    projectId: input.projectId?.trim() || `holding-governance:${holding.holdingId}:${input.type}:${uuidv4()}`,
    holdingId: holding.holdingId,
    type: input.type,
    status: 'active',
    host: { ...input.host, actorId: input.host.actorId.trim() },
    ...(input.assistant ? { assistant: { ...input.assistant, actorId: input.assistant.actorId.trim() } } : {}),
    startedAt,
    expectedCompleteAt,
    investedMoney: preview.moneyCost,
    investedGrain: preview.grainCost,
    baseline: captureHoldingBaseline(holding),
    expectedEffects: cloneEffectRanges(preview.expectedEffects),
    risk: preview.risk,
    modifiers: { ...preview.modifiers },
    ...(preview.appliedArtIds.length > 0 ? { appliedArtIds: [...preview.appliedArtIds] } : {}),
    updatedAt: startedAt,
  };

  return {
    ok: true,
    project,
    state: {
      ...state,
      resources: {
        ...resources,
        money: resources.money - preview.moneyCost,
        grain: resources.grain - preview.grainCost,
      },
      holdingGovernanceProjects: [...(state.holdingGovernanceProjects ?? []), project],
    },
  };
}

export function cancelHoldingGovernanceProject(
  state: RuntimeState,
  projectId: string,
): HoldingGovernanceMutationResult {
  const project = state.holdingGovernanceProjects?.find((item) => item.projectId === projectId);
  if (!project || project.status !== 'active') {
    return { ok: false, state, error: '未找到可取消的进行中治理项目。' };
  }
  const updated: HoldingGovernanceProjectEntry = {
    ...project,
    status: 'cancelled',
    cancelledAt: state.currentDate,
    updatedAt: state.currentDate,
  };
  return {
    ok: true,
    project: updated,
    state: {
      ...state,
      holdingGovernanceProjects: state.holdingGovernanceProjects?.map((item) => (
        item.projectId === projectId ? updated : item
      )),
    },
  };
}

export function settleDueHoldingGovernanceProjects(state: RuntimeState): RuntimeState {
  const projects = state.holdingGovernanceProjects ?? [];
  if (!projects.some((project) => project.status === 'active' && isDue(project.expectedCompleteAt, state.currentDate))) {
    return state;
  }
  let holdings = [...(state.holdings ?? [])];
  let changed = false;
  const nextProjects = projects.map((project) => {
    if (project.status !== 'active' || !isDue(project.expectedCompleteAt, state.currentDate)) return project;
    const holdingIndex = holdings.findIndex((holding) => holding.holdingId === project.holdingId);
    const holding = holdingIndex >= 0 ? holdings[holdingIndex] : undefined;
    if (!holding || holding.status === 'lost' || holding.status === 'archived') {
      changed = true;
      return {
        ...project,
        status: 'blocked' as const,
        blockedReason: holding ? '领地已经失去控制。' : '目标领地已不存在。',
        updatedAt: state.currentDate,
      };
    }
    const applicabilityError = validateHoldingGovernanceProjectApplicability(holding, project.type);
    if (applicabilityError) {
      changed = true;
      return {
        ...project,
        status: 'blocked' as const,
        blockedReason: applicabilityError,
        updatedAt: state.currentDate,
      };
    }
    const hostError = validateHoldingGovernanceActorRef(state, holding, project.host);
    if (hostError) {
      changed = true;
      return {
        ...project,
        status: 'blocked' as const,
        blockedReason: hostError,
        updatedAt: state.currentDate,
      };
    }

    const deltas = resolveDeterministicProjectDeltas(project, holding);
    holdings[holdingIndex] = applyGovernanceDeltas(holding, project.type, deltas, state.currentDate);
    changed = true;
    return {
      ...project,
      status: 'completed' as const,
      result: {
        completedAt: state.currentDate,
        deltas,
        summary: `${DEFINITIONS[project.type].label}已经按本地治理合同完成结算。`,
      },
      updatedAt: state.currentDate,
    };
  });
  return changed ? { ...state, holdings, holdingGovernanceProjects: nextProjects } : state;
}

function captureHoldingBaseline(holding: HoldingLedgerEntry): HoldingGovernanceProjectEntry['baseline'] {
  return {
    holdingStatus: holding.status,
    civilAdministrationScope: resolveHoldingCivilAdministrationScope(holding),
    civilScaleLevel: resolveHoldingCivilScaleLevel(
      holding,
      resolveHoldingCivilAdministrationScope(holding),
    ),
    scaleLevel: holding.scaleLevel,
    farmlandMu: holding.farmlandMu,
    registeredHouseholds: holding.registeredHouseholds,
    population: holding.population,
    agriculture: holding.agriculture,
    commerce: holding.commerce,
    publicOrder: holding.publicOrder,
    popularSupport: holding.popularSupport,
    corruption: holding.corruption,
    defense: holding.defense,
    recruitPotential: holding.recruitPotential,
    armory: holding.armory,
    horseSupply: holding.horseSupply,
  };
}

function buildExpectedEffectRanges(
  type: HoldingGovernanceProjectType,
  scale: number,
): HoldingGovernanceProjectEffectRanges {
  switch (type) {
    case 'land_survey':
      return { farmlandMu: range(100 * scale, 250 * scale), agriculture: range(1, 3) };
    case 'household_registration':
      return { registeredHouseholds: range(20 * scale, 50 * scale), population: range(2, 5) };
    case 'irrigation':
      return { farmlandMu: range(50 * scale, 150 * scale), agriculture: range(3, 7) };
    case 'anti_corruption':
      return { corruption: range(-10, -5), popularSupport: range(1, 4) };
    case 'public_order':
      return { publicOrder: range(4, 9), popularSupport: range(1, 4) };
    case 'refugee_resettlement':
      return {
        population: range(3, 8),
        registeredHouseholds: range(30 * scale, 80 * scale),
        popularSupport: range(0, 3),
      };
    case 'commerce':
      return { commerce: range(3, 8), population: range(1, 4) };
    case 'relief':
      return { popularSupport: range(4, 10), publicOrder: range(1, 5), population: range(0, 3) };
    case 'garrison_drill':
      return { defense: range(3, 7) };
    case 'position_fortification':
      return { defense: range(5, 10) };
    case 'armory_maintenance':
      return { armory: range(4, 10) };
    case 'beacon_maintenance':
      return { defense: range(3, 7) };
    case 'route_patrol':
      return { defense: range(1, 4), horseSupply: range(2, 5) };
  }
}

function resolveDeterministicProjectDeltas(
  project: HoldingGovernanceProjectEntry,
  holding: HoldingLedgerEntry,
): HoldingGovernanceProjectEffects {
  const allowedFields = new Set(DEFINITIONS[project.type].allowedFields);
  const deltas: HoldingGovernanceProjectEffects = {};
  for (const [field, value] of Object.entries(project.expectedEffects)) {
    if (!allowedFields.has(field as keyof HoldingGovernanceProjectEffects) || !value) continue;
    const midpoint = Math.round((value.min + value.max) / 2);
    const key = field as keyof HoldingGovernanceProjectEffects;
    const projectScale = CIVIL_PROJECT_TYPES.includes(project.type)
      ? resolveHoldingCivilScaleLevel(holding, resolveHoldingCivilAdministrationScope(holding))
      : holding.scaleLevel;
    const perProjectCapped = capProjectDelta(key, midpoint, projectScale);
    const capped = capDeltaToHoldingCapacity(holding, key, perProjectCapped);
    deltas[key] = capped;
  }
  return deltas;
}

function applyGovernanceDeltas(
  holding: HoldingLedgerEntry,
  type: HoldingGovernanceProjectType,
  deltas: HoldingGovernanceProjectEffects,
  updatedAt: string,
): HoldingLedgerEntry {
  const allowedFields = new Set(DEFINITIONS[type].allowedFields);
  const next = { ...holding };
  for (const [field, delta] of Object.entries(deltas)) {
    const key = field as keyof HoldingGovernanceProjectEffects;
    if (!allowedFields.has(key) || typeof delta !== 'number' || !Number.isFinite(delta)) continue;
    const current = typeof holding[key] === 'number' ? holding[key] as number : 0;
    const capacityLimit = getHoldingGovernanceFieldUpperLimit(
      holding,
      key,
      resolveHoldingCivilAdministrationScope(holding),
    );
    const value = Math.max(0, Math.min(capacityLimit, current + delta));
    if (key === 'farmlandMu' || key === 'registeredHouseholds' || key === 'population') {
      (next as unknown as Record<string, unknown>)[key] = Math.round(value);
    } else {
      (next as unknown as Record<string, unknown>)[key] = Math.round(value);
    }
  }
  next.updatedAt = updatedAt;
  next.recentChanges = [
    ...(holding.recentChanges ?? []).slice(-7),
    `${DEFINITIONS[type].label}完成`,
  ];
  return next;
}

function capProjectDelta(
  field: keyof HoldingGovernanceProjectEffects,
  value: number,
  scale: number,
): number {
  const absoluteLimit = field === 'farmlandMu'
    ? 500 * scale
    : field === 'registeredHouseholds'
      ? 100 * scale
      : 12;
  return Math.max(-absoluteLimit, Math.min(absoluteLimit, value));
}

function capDeltaToHoldingCapacity(
  holding: HoldingLedgerEntry,
  field: keyof HoldingGovernanceProjectEffects,
  delta: number,
): number {
  const current = typeof holding[field] === 'number' ? holding[field] as number : 0;
  const upperLimit = getHoldingGovernanceFieldUpperLimit(
    holding,
    field,
    resolveHoldingCivilAdministrationScope(holding),
  );
  if (delta >= 0) {
    return Math.max(0, Math.min(Math.max(0, upperLimit - current), delta));
  }
  return Math.min(0, Math.max(-current, delta));
}

function capEffectRangesToHoldingCapacity(
  holding: HoldingLedgerEntry,
  ranges: HoldingGovernanceProjectEffectRanges,
): HoldingGovernanceProjectEffectRanges {
  const capped: HoldingGovernanceProjectEffectRanges = {};
  for (const [field, fieldRange] of Object.entries(ranges)) {
    const key = field as keyof HoldingGovernanceProjectEffects;
    capped[key] = {
      min: capDeltaToHoldingCapacity(holding, key, fieldRange.min),
      max: capDeltaToHoldingCapacity(holding, key, fieldRange.max),
    };
  }
  return capped;
}

function range(min: number, max: number): { min: number; max: number } {
  return { min, max };
}

function cloneEffectRanges(value: HoldingGovernanceProjectEffectRanges): HoldingGovernanceProjectEffectRanges {
  return Object.fromEntries(
    Object.entries(value).map(([field, fieldRange]) => [field, { ...fieldRange }]),
  );
}

function defaultProjectModifiers(): HoldingGovernanceProjectModifiers {
  return {
    hostAbilityScore: 0,
    durationMultiplier: 1,
    costMultiplier: 1,
    effectMultiplier: 1,
    riskStepsReduced: 0,
  };
}

function resolveGovernanceActor(
  state: RuntimeState,
  actor: HoldingGovernanceActorRef,
): Pick<RuntimeState['player'], 'abilityScores' | 'uniqueArts'> | undefined {
  return actor.actorType === 'player'
    ? state.player
    : state.npcs?.find((npc) => npc.npcId === actor.actorId);
}

function governanceAbilityScore(scores?: Record<string, number>): number {
  const politics = ability(scores, ['政治', 'politics', 'governance']);
  const intelligence = ability(scores, ['智力', 'intelligence', 'strategy']);
  const charm = ability(scores, ['魅力', 'charm', 'social']);
  return Math.round(politics * 0.5 + intelligence * 0.3 + charm * 0.2);
}

function ability(scores: Record<string, number> | undefined, keys: string[]): number {
  for (const key of keys) {
    const value = scores?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  }
  return 0;
}

function selectGovernanceArts(
  arts: readonly CharacterUniqueArt[] | undefined,
  type: HoldingGovernanceProjectType,
): CharacterUniqueArt[] {
  const exactScope = HOLDING_GOVERNANCE_ART_SCOPES[type];
  const compatibleDomains = LEGACY_COMPATIBLE_DOMAINS[type];
  return (arts ?? []).filter((art) => (
    art.checkHooks?.some((hook) => hook.scope === exactScope)
    || compatibleDomains.includes(art.domain)
  ));
}

function artProjectionPower(
  arts: readonly CharacterUniqueArt[],
  type: HoldingGovernanceProjectType,
): number {
  const exactScope = HOLDING_GOVERNANCE_ART_SCOPES[type];
  const power = arts.reduce((sum, art) => {
    const exactHooks = art.checkHooks?.filter((hook) => hook.scope === exactScope) ?? [];
    if (exactHooks.length > 0) {
      const hookPower = Math.max(...exactHooks.map((hook) => (
        typeof hook.modifier === 'number' && Number.isFinite(hook.modifier)
          ? Math.max(0, hook.modifier)
          : Math.max(1, art.level * 2)
      )));
      return sum + Math.min(20, hookPower);
    }
    return sum + Math.min(5, Math.max(1, art.level));
  }, 0);
  return Math.min(25, power);
}

function scaleEffectRanges(
  ranges: HoldingGovernanceProjectEffectRanges,
  multiplier: number,
): HoldingGovernanceProjectEffectRanges {
  const scaled: HoldingGovernanceProjectEffectRanges = {};
  for (const [field, fieldRange] of Object.entries(ranges)) {
    const scaleValue = (value: number) => value < 0
      ? -Math.max(1, Math.round(Math.abs(value) * multiplier))
      : Math.round(value * multiplier);
    scaled[field as keyof HoldingGovernanceProjectEffects] = {
      min: scaleValue(fieldRange.min),
      max: scaleValue(fieldRange.max),
    };
  }
  return scaled;
}

function reduceRisk(risk: HoldingGovernanceProjectRisk, steps: number): HoldingGovernanceProjectRisk {
  const order: HoldingGovernanceProjectRisk[] = ['low', 'moderate', 'high'];
  const index = order.indexOf(risk);
  return order[Math.max(0, index - Math.max(0, Math.floor(steps)))] ?? risk;
}

function roundMultiplier(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isDue(expectedCompleteAt: string, currentDate: string): boolean {
  const expected = tryCreateGameClockFromDateLabel(expectedCompleteAt);
  const current = tryCreateGameClockFromDateLabel(currentDate);
  if (!expected || !current) return expectedCompleteAt <= currentDate;
  return toClockOrdinal(current) >= toClockOrdinal(expected);
}

function toClockOrdinal(clock: { year: number; month: number; day: number; hour: number; minute: number }): number {
  return (((clock.year * 12 + clock.month) * 30 + clock.day) * 24 + clock.hour) * 60 + clock.minute;
}
