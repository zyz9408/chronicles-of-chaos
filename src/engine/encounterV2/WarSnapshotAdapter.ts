import { isCurrentTroopLedgerEntry } from '../state/troopLifecycle';
import {
  assertValidEncounterStartIntent,
  validateSemanticProjection,
} from './EncounterContractValidation';
import { hashCanonicalValue } from './EncounterDeterminism';
import type {
  SemanticProjection,
  TraitSemanticProfile,
  TroopSemanticProfile,
  UniqueArtSemanticProfile,
} from './EncounterContracts';
import {
  calculateWarCommanderScore,
  clampWarValue,
  normalizeWarFatigue,
  normalizeWarQuality,
  normalizeWarReadiness,
  normalizeWarSupply,
} from './WarRules';
import type {
  WarCommanderSnapshot,
  WarCommanderSource,
  WarEncounterSnapshot,
  WarForceSnapshot,
  WarProjectionBundle,
  WarTroopSource,
} from './WarTypes';

export interface CreateWarEncounterSnapshotInput {
  sessionId: string;
  intent: WarEncounterSnapshot['intent'];
  playerTroops: WarTroopSource[];
  enemyTroops: WarTroopSource[];
  playerCommander?: WarCommanderSource;
  enemyCommander?: WarCommanderSource;
  projections: WarProjectionBundle;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function commanderId(source: WarCommanderSource): string {
  const actorId = source.id ?? source.npcId;
  if (!actorId || (source.id && source.npcId && source.id !== source.npcId)) {
    throw new Error(`战争主将 ${source.name || '(unnamed)'} 缺少唯一稳定 actorId。`);
  }
  return actorId;
}

function profileIsExecutableForWar(profile: SemanticProjection): boolean {
  return profile.status === 'executable' && profile.rulesetScopes.includes('war');
}

function validateProjectionBundle(bundle: WarProjectionBundle): Map<string, SemanticProjection> {
  if (!bundle || !Array.isArray(bundle.profiles)) throw new Error('战争投影包必须包含 profiles 数组。');
  const profiles = new Map<string, SemanticProjection>();
  for (const profile of bundle.profiles) {
    const validation = validateSemanticProjection(profile);
    if (!validation.valid) {
      throw new Error(`战争能力投影 ${String(profile?.sourceId ?? '(unknown)')} 校验失败：${validation.errors.join('；')}`);
    }
    if (profiles.has(profile.sourceId)) throw new Error(`战争能力投影 sourceId 重复：${profile.sourceId}。`);
    profiles.set(profile.sourceId, cloneJson(profile));
  }
  return profiles;
}

export function createValidatedWarProjectionBundle(profiles: SemanticProjection[]): WarProjectionBundle {
  const bundle = { profiles: cloneJson(profiles) };
  validateProjectionBundle(bundle);
  return deepFreeze(bundle);
}

function collectProfiles<T extends SemanticProjection>(
  ids: readonly string[],
  profiles: ReadonlyMap<string, SemanticProjection>,
  guard: (profile: SemanticProjection) => profile is T,
): T[] {
  return ids
    .map((id) => profiles.get(id))
    .filter((profile): profile is T => Boolean(profile && profileIsExecutableForWar(profile) && guard(profile)));
}

function createCommanderSnapshot(
  expectedId: string | undefined,
  source: WarCommanderSource | undefined,
  profiles: ReadonlyMap<string, SemanticProjection>,
): WarCommanderSnapshot | undefined {
  if (!expectedId) {
    if (source) throw new Error(`开战意图未声明主将，但提供了主将来源 ${commanderId(source)}。`);
    return undefined;
  }
  if (!source) throw new Error(`开战意图中的主将 ${expectedId} 没有对应角色来源。`);
  const actorId = commanderId(source);
  if (actorId !== expectedId) throw new Error(`主将来源 ${actorId} 与开战意图 ${expectedId} 不一致。`);
  const leadership = clampWarValue(finiteOr(source.abilityScores?.统率, 50), 0, 100);
  const intelligence = clampWarValue(finiteOr(source.abilityScores?.智力, 50), 0, 100);
  const martial = clampWarValue(finiteOr(source.abilityScores?.武力, 50), 0, 100);
  const charm = clampWarValue(finiteOr(source.abilityScores?.魅力, 50), 0, 100);
  const politics = clampWarValue(finiteOr(source.abilityScores?.政治, 50), 0, 100);
  const traitProfiles = collectProfiles<TraitSemanticProfile>(
    (source.traits ?? []).map((trait) => trait.id),
    profiles,
    (profile): profile is TraitSemanticProfile => profile.profileKind === 'ability' && profile.sourceType === 'trait',
  );
  const uniqueArtProfiles = collectProfiles<UniqueArtSemanticProfile>(
    (source.uniqueArts ?? []).map((art) => art.id),
    profiles,
    (profile): profile is UniqueArtSemanticProfile => profile.profileKind === 'ability' && profile.sourceType === 'unique_art',
  );
  return {
    actorId,
    name: source.name,
    leadership,
    intelligence,
    martial,
    charm,
    politics,
    weightedScore: calculateWarCommanderScore({ leadership, intelligence, martial, charm, politics }),
    traitProfiles,
    uniqueArtProfiles,
  };
}

function createForceSnapshot(
  source: WarTroopSource,
  side: WarForceSnapshot['side'],
  stableOrder: number,
  profiles: ReadonlyMap<string, SemanticProjection>,
): WarForceSnapshot {
  if (!isCurrentTroopLedgerEntry(source)) {
    throw new Error(`部队 ${source.troopId} 已是终态历史，不能进入战争快照。`);
  }
  if (source.lifecycleStatus === 'routed') {
    throw new Error(`部队 ${source.troopId} 仍处于溃散状态，不能直接进入新战争。`);
  }
  if (!Number.isFinite(source.size) || source.size <= 0) {
    throw new Error(`部队 ${source.troopId} 的 size 必须是正数。`);
  }
  if (!Number.isFinite(source.morale) || !Number.isFinite(source.training)) {
    throw new Error(`部队 ${source.troopId} 的 morale/training 必须是有限数字。`);
  }
  const projection = profiles.get(source.troopId);
  const troopProfile = projection
    && profileIsExecutableForWar(projection)
    && projection.profileKind === 'troop'
    ? projection as TroopSemanticProfile
    : undefined;
  const supply = normalizeWarSupply(source.supplies);
  return {
    troopId: source.troopId,
    name: source.name,
    side,
    stableOrder,
    initialStrength: Math.max(1, Math.round(source.size)),
    morale: Math.round(clampWarValue(source.morale, 0, 100)),
    training: Math.round(clampWarValue(source.training, 0, 100)),
    quality: normalizeWarQuality(source.quality),
    readiness: normalizeWarReadiness(source.readiness),
    supply: supply.value,
    supplyKnown: supply.known,
    supplySource: supply.source,
    fatigue: Number.isFinite(source.warFatiguePercent)
      ? Math.round(clampWarValue(source.warFatiguePercent!, 0, 100))
      : normalizeWarFatigue(source.fatigue),
    sourceLifecycleStatus: source.lifecycleStatus === 'unknown' ? 'unknown' : 'active',
    primaryClass: troopProfile?.primaryClass ?? 'mixed',
    tags: troopProfile ? [...troopProfile.tags] : [],
    ...(troopProfile ? { troopProfile } : {}),
  };
}

export function createWarEncounterSnapshot(input: CreateWarEncounterSnapshotInput): WarEncounterSnapshot {
  assertValidEncounterStartIntent(input.intent);
  if (input.intent.kind !== 'war') throw new Error('War 快照只接受 war 意图。');
  if (!input.sessionId.trim()) throw new Error('sessionId 不能为空。');
  const profiles = validateProjectionBundle(input.projections);
  const sourceMap = new Map<string, WarTroopSource>();
  for (const source of [...input.playerTroops, ...input.enemyTroops]) {
    if (!source.troopId.trim()) throw new Error('部队来源缺少稳定 troopId。');
    if (sourceMap.has(source.troopId)) throw new Error(`部队来源 ID 重复：${source.troopId}。`);
    sourceMap.set(source.troopId, source);
  }
  const ordered = [
    ...input.intent.playerForce.troopIds.map((troopId) => ({ troopId, side: 'player' as const })),
    ...input.intent.enemyForce.troopIds.map((troopId) => ({ troopId, side: 'enemy' as const })),
  ];
  const forces = ordered.map(({ troopId, side }, stableOrder) => {
    const source = sourceMap.get(troopId);
    if (!source) throw new Error(`开战意图中的部队 ${troopId} 没有对应部队来源。`);
    return createForceSnapshot(source, side, stableOrder, profiles);
  });
  const commanders = {
    player: createCommanderSnapshot(input.intent.playerForce.commanderActorId, input.playerCommander, profiles),
    enemy: createCommanderSnapshot(input.intent.enemyForce.commanderActorId, input.enemyCommander, profiles),
  };
  const hashPayload = {
    snapshotVersion: 1 as const,
    sessionId: input.sessionId,
    intent: cloneJson(input.intent),
    seed: input.intent.seed,
    objective: input.intent.objective,
    environmentTags: [...input.intent.environmentTags],
    forces,
    commanders,
  };
  const snapshot: WarEncounterSnapshot = {
    ...hashPayload,
    snapshotHash: hashCanonicalValue(hashPayload),
  };
  return deepFreeze(cloneJson(snapshot));
}
