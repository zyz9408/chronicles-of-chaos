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
  AGGRESSIVE_WAR_RULESET_VERSION,
  LEGACY_WAR_RULESET_VERSION,
  SEMANTIC_PROJECTION_VERSION,
  THEATER_WAR_RULESET_VERSION,
  WAR_RULESET_VERSION,
} from './EncounterContracts';
import {
  calculateWarCommanderScore,
  clampWarValue,
  normalizeWarQuality,
  normalizeWarReadiness,
  normalizeWarSupply,
} from './WarRules';
import { resolveTroopFatiguePercent } from '../troops/TroopFatigue';
import type {
  WarCommanderSnapshot,
  WarCommanderSource,
  WarEncounterSnapshot,
  WarForceSnapshot,
  WarOfficerSnapshot,
  WarOfficerSource,
  WarProjectionBundle,
  WarTroopSource,
} from './WarTypes';
import {
  ensureUniqueArtCompatibilityProfiles,
  materializeLevelledUniqueArtProjection,
} from './UniqueArtProjectionRuntime';
import { normalizeEncounterDifficulty } from '../settings/GameDifficulty';

export interface CreateWarEncounterSnapshotInput {
  sessionId: string;
  intent: WarEncounterSnapshot['intent'];
  playerLevel?: number;
  warDifficulty?: WarEncounterSnapshot['warDifficulty'];
  playerTroops: WarTroopSource[];
  enemyTroops: WarTroopSource[];
  theaterTroops?: {
    allied: WarTroopSource[];
    enemy: WarTroopSource[];
  };
  playerCommander?: WarCommanderSource;
  enemyCommander?: WarCommanderSource;
  playerOfficers?: WarOfficerSource[];
  enemyOfficers?: WarOfficerSource[];
  projections: WarProjectionBundle;
  /**
   * Keep false only when reconstructing a pre-compatibility checkpoint for a
   * hash migration check. Normal callers must use the compatibility repair.
   */
  repairStoredWarArtProjections?: boolean;
  /**
   * Keep true only while verifying a checkpoint created before deployable
   * strength was capped by total troop strength. New snapshots must never
   * allow deployableSize to exceed size.
   */
  preserveLegacyDeployableOverflow?: boolean;
  /**
   * Compatibility-only repair for a verified legacy checkpoint whose frozen
   * commitment was valid against stale deployableSize but exceeds survivors.
   * New staging must keep rejecting such an overcommitment.
   */
  clampCommittedStrengthToDeployable?: boolean;
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
  includeV21Fields = true,
  useAggressiveWarScaling = false,
  useEnhancedWarScaling = false,
): WarCommanderSnapshot | undefined {
  if (!expectedId) {
    if (source) throw new Error(`开战意图未声明主将，但提供了主将来源 ${commanderId(source)}。`);
    return undefined;
  }
  if (!source) throw new Error(`开战意图中的主将 ${expectedId} 没有对应角色来源。`);
  const actorId = commanderId(source);
  if (actorId !== expectedId) throw new Error(`主将来源 ${actorId} 与开战意图 ${expectedId} 不一致。`);
  const leadershipKnown = typeof source.abilityScores?.统率 === 'number'
    && Number.isFinite(source.abilityScores.统率);
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
  ).map((profile) => {
    const art = (source.uniqueArts ?? []).find((candidate) => candidate.id === profile.sourceId);
    return art
      ? materializeLevelledUniqueArtProjection(art, profile, 'war', {
          aggressiveWarScaling: useAggressiveWarScaling,
          enhancedWarScaling: useEnhancedWarScaling,
        })
      : profile;
  });
  const snapshot: WarCommanderSnapshot = {
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
  if (includeV21Fields) {
    snapshot.leadershipKnown = leadershipKnown;
    snapshot.uniqueArtLabels = Object.fromEntries(
      (source.uniqueArts ?? [])
        .filter((art) => uniqueArtProfiles.some((profile) => profile.sourceId === art.id))
        .map((art) => [art.id, art.name]),
    );
  }
  return snapshot;
}

/**
 * Materialize only combat facts already guaranteed by structured local state.
 * This deliberately does not parse troop names, prose or free-form labels.
 */
export function createStructuredWarTroopProjection(
  source: WarTroopSource,
): TroopSemanticProfile | undefined {
  if (source.logisticsClass !== 'heavy_cavalry') return undefined;
  return {
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    profileKind: 'troop',
    sourceId: source.troopId,
    status: 'executable',
    rulesetScopes: ['war'],
    effects: [],
    primaryClass: 'cavalry',
    tags: ['heavy', 'mobile', 'assault'],
  };
}

function createOfficerSnapshots(
  officers: readonly WarOfficerSource[] | undefined,
  profiles: ReadonlyMap<string, SemanticProjection>,
  useAggressiveWarScaling = false,
  useEnhancedWarScaling = false,
): WarOfficerSnapshot[] {
  return (officers ?? []).map((officer) => {
    const base = createCommanderSnapshot(
      commanderId(officer.source),
      officer.source,
      profiles,
      true,
      useAggressiveWarScaling,
      useEnhancedWarScaling,
    );
    if (!base) throw new Error('随军人员快照创建失败。');
    return {
      ...base,
      role: officer.role,
      troopIds: [...new Set(officer.troopIds)],
    };
  });
}

function createForceSnapshot(
  source: WarTroopSource,
  side: WarForceSnapshot['side'],
  stableOrder: number,
  profiles: ReadonlyMap<string, SemanticProjection>,
  committedStrength?: number,
  includeV23Fields = false,
  useStructuredProjection = false,
  preserveLegacyDeployableOverflow = false,
  clampCommittedStrengthToDeployable = false,
): WarForceSnapshot {
  if (source.detailLevel === 'intelligence') {
    throw new Error(`部队 ${source.troopId} 只有军情档案，补齐作战字段前不能直接进入战争。`);
  }
  if (source.lifecycleStatus === 'routed') {
    throw new Error(`部队 ${source.troopId} 仍处于溃散状态，不能直接进入新战争。`);
  }
  if (!isCurrentTroopLedgerEntry(source)) {
    throw new Error(`部队 ${source.troopId} 已是终态历史，不能进入战争快照。`);
  }
  const sourceSize = Math.max(0, Math.round(source.size));
  const storedDeployableSize = source.deployableSize ?? sourceSize;
  const deployableSize = preserveLegacyDeployableOverflow
    ? storedDeployableSize
    : Math.min(sourceSize, storedDeployableSize);
  if (!Number.isFinite(deployableSize) || deployableSize <= 0) {
    throw new Error(`部队 ${source.troopId} 的 size 必须是正数。`);
  }
  if (!Number.isFinite(source.morale) || !Number.isFinite(source.training)) {
    throw new Error(`部队 ${source.troopId} 的 morale/training 必须是有限数字。`);
  }
  const projection = profiles.get(source.troopId)
    ?? (useStructuredProjection ? createStructuredWarTroopProjection(source) : undefined);
  const troopProfile = projection
    && profileIsExecutableForWar(projection)
    && projection.profileKind === 'troop'
    ? projection as TroopSemanticProfile
    : undefined;
  const supply = normalizeWarSupply(source.supplies);
  const deployableStrength = Math.max(1, Math.round(deployableSize));
  const sourceStrength = preserveLegacyDeployableOverflow
    ? Math.max(deployableStrength, sourceSize)
    : sourceSize;
  const requestedCommittedStrength = committedStrength ?? deployableStrength;
  const frozenCommittedStrength = clampCommittedStrengthToDeployable
    && Number.isInteger(requestedCommittedStrength)
    && requestedCommittedStrength > deployableStrength
    ? deployableStrength
    : requestedCommittedStrength;
  if (!Number.isInteger(frozenCommittedStrength) || frozenCommittedStrength < 1 || frozenCommittedStrength > deployableStrength) {
    throw new Error(`部队 ${source.troopId} 的局部投入兵力必须在 1—${deployableStrength} 之间。`);
  }
  const snapshot: WarForceSnapshot = {
    troopId: source.troopId,
    name: source.name,
    side,
    stableOrder,
    initialStrength: frozenCommittedStrength,
    morale: Math.round(clampWarValue(source.morale, 0, 100)),
    training: Math.round(clampWarValue(source.training, 0, 100)),
    quality: normalizeWarQuality(source.quality),
    readiness: normalizeWarReadiness(source.readiness),
    supply: supply.value,
    supplyKnown: supply.known,
    supplySource: supply.source,
    fatigue: resolveTroopFatiguePercent(source),
    sourceLifecycleStatus: source.lifecycleStatus === 'unknown' ? 'unknown' : 'active',
    primaryClass: troopProfile?.primaryClass ?? 'mixed',
    tags: troopProfile ? [...troopProfile.tags] : [],
    ...(troopProfile ? { troopProfile } : {}),
  };
  if (includeV23Fields) {
    snapshot.sourceStrength = sourceStrength;
    snapshot.commitmentKind = frozenCommittedStrength < sourceStrength ? 'detachment' : 'full';
  }
  return snapshot;
}

export function estimateWarTheaterStrength(source: WarTroopSource): number {
  if (source.strengthEstimate) {
    return Math.max(0, Math.round((source.strengthEstimate.min + source.strengthEstimate.max) / 2));
  }
  return Math.max(0, Math.round(source.deployableSize ?? source.size ?? 0));
}

function theaterSupportFactors(alliedStrength: number, enemyStrength: number): { player: number; enemy: number } {
  if (alliedStrength <= 0 && enemyStrength <= 0) return { player: 1, enemy: 1 };
  const ratio = (alliedStrength + 100) / (enemyStrength + 100);
  const pressure = Math.max(-0.12, Math.min(0.12, Math.log2(ratio) * 0.04));
  return {
    player: Number((1 + pressure).toFixed(4)),
    enemy: Number((1 - pressure).toFixed(4)),
  };
}

export function createWarEncounterSnapshot(input: CreateWarEncounterSnapshotInput): WarEncounterSnapshot {
  assertValidEncounterStartIntent(input.intent);
  if (input.intent.kind !== 'war') throw new Error('War 快照只接受 war 意图。');
  if (!input.sessionId.trim()) throw new Error('sessionId 不能为空。');
  const profiles = validateProjectionBundle(input.projections);
  const useAggressiveWarScaling = input.intent.rulesetVersion === AGGRESSIVE_WAR_RULESET_VERSION
    || input.intent.rulesetVersion === WAR_RULESET_VERSION;
  const useEnhancedWarScaling = input.intent.rulesetVersion === WAR_RULESET_VERSION;
  if (useAggressiveWarScaling) {
    for (const source of [...input.playerTroops, ...input.enemyTroops]) {
      if (profiles.has(source.troopId)) continue;
      const structuredProjection = createStructuredWarTroopProjection(source);
      if (structuredProjection) profiles.set(source.troopId, structuredProjection);
    }
  }
  if (input.repairStoredWarArtProjections !== false) {
    ensureUniqueArtCompatibilityProfiles(
      profiles,
      [
        ...(input.playerCommander ? [input.playerCommander] : []),
        ...(input.enemyCommander ? [input.enemyCommander] : []),
        ...(input.playerOfficers ?? []).map((officer) => officer.source),
        ...(input.enemyOfficers ?? []).map((officer) => officer.source),
      ].flatMap((source) => source.uniqueArts ?? []),
    );
  }
  const compatibilityValidation = [...profiles.values()].map((profile) => validateSemanticProjection(profile));
  const compatibilityErrors = compatibilityValidation.flatMap((validation) => validation.valid ? [] : validation.errors);
  if (compatibilityErrors.length > 0) {
    throw new Error(`战争能力投影兼容修复校验失败：${compatibilityErrors.join('；')}`);
  }
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
  const commitmentByTroopId = new Map(
    input.intent.participation
      ? [
          ...input.intent.participation.playerCommitments,
          ...input.intent.participation.enemyCommitments,
        ].map((entry) => [entry.troopId, entry.committedStrength] as const)
      : [],
  );
  const includeV23Fields = input.intent.rulesetVersion === THEATER_WAR_RULESET_VERSION
    || input.intent.rulesetVersion === AGGRESSIVE_WAR_RULESET_VERSION
    || input.intent.rulesetVersion === WAR_RULESET_VERSION;
  const forces = ordered.map(({ troopId, side }, stableOrder) => {
    const source = sourceMap.get(troopId);
    if (!source) throw new Error(`开战意图中的部队 ${troopId} 没有对应部队来源。`);
    return createForceSnapshot(
      source,
      side,
      stableOrder,
      profiles,
      commitmentByTroopId.get(troopId),
      includeV23Fields,
      useAggressiveWarScaling,
      input.preserveLegacyDeployableOverflow === true,
      input.clampCommittedStrengthToDeployable === true,
    );
  });
  const isLegacyRuleset = input.intent.rulesetVersion === LEGACY_WAR_RULESET_VERSION;
  const playerCommander = createCommanderSnapshot(
    input.intent.playerForce.commanderActorId,
    input.playerCommander,
    profiles,
    !isLegacyRuleset,
    useAggressiveWarScaling,
    useEnhancedWarScaling,
  );
  const enemyCommander = createCommanderSnapshot(
    input.intent.enemyForce.commanderActorId,
    input.enemyCommander,
    profiles,
    !isLegacyRuleset,
    useAggressiveWarScaling,
    useEnhancedWarScaling,
  );
  const commanders: WarEncounterSnapshot['commanders'] = {
    ...(playerCommander ? { player: playerCommander } : {}),
    ...(enemyCommander ? { enemy: enemyCommander } : {}),
  };
  const playerLevel = Math.max(1, Math.floor(finiteOr(input.playerLevel, 1)));
  const officers = isLegacyRuleset ? undefined : {
    player: createOfficerSnapshots(input.playerOfficers, profiles, useAggressiveWarScaling, useEnhancedWarScaling),
    enemy: createOfficerSnapshots(input.enemyOfficers, profiles, useAggressiveWarScaling, useEnhancedWarScaling),
  };
  const alliedEstimatedStrength = (input.theaterTroops?.allied ?? [])
    .reduce((sum, troop) => sum + estimateWarTheaterStrength(troop), 0);
  const enemyEstimatedStrength = (input.theaterTroops?.enemy ?? [])
    .reduce((sum, troop) => sum + estimateWarTheaterStrength(troop), 0);
  const theaterFactors = theaterSupportFactors(alliedEstimatedStrength, enemyEstimatedStrength);
  const theaterContext = input.intent.participation ? {
    commandScope: input.intent.participation.commandScope,
    mission: input.intent.participation.mission,
    alliedMainForceIds: [...(input.intent.participation.alliedMainForceIds ?? [])],
    enemyMainForceIds: [...(input.intent.participation.enemyMainForceIds ?? [])],
    alliedEstimatedStrength,
    enemyEstimatedStrength,
    playerSupportFactor: theaterFactors.player,
    enemySupportFactor: theaterFactors.enemy,
    ...(input.intent.participation.superiorCommanderActorId
      ? { superiorCommanderActorId: input.intent.participation.superiorCommanderActorId }
      : {}),
  } : undefined;
  const hashPayload = {
    snapshotVersion: includeV23Fields
      ? 3 as const
      : isLegacyRuleset ? 1 as const : 2 as const,
    sessionId: input.sessionId,
    intent: cloneJson(input.intent),
    seed: input.intent.seed,
    warDifficulty: normalizeEncounterDifficulty('war', input.warDifficulty),
    objective: input.intent.objective,
    environmentTags: [...input.intent.environmentTags],
    forces,
    commanders,
    ...(officers ? { officers } : {}),
    ...(theaterContext ? { theaterContext } : {}),
  };
  const snapshot: WarEncounterSnapshot = {
    ...hashPayload,
    // playerLevel 继续排除在哈希外；旧 V2.0 快照仍使用原始 v1 结构。
    playerLevel,
    snapshotHash: hashCanonicalValue(hashPayload),
  };
  return deepFreeze(cloneJson(snapshot));
}
