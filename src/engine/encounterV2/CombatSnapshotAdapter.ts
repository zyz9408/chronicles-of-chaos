import {
  assertValidEncounterStartIntent,
  validateSemanticProjection,
} from './EncounterContractValidation';
import { hashCanonicalValue } from './EncounterDeterminism';
import type {
  EquipmentSemanticProfile,
  ItemCombatProfile,
  SemanticProjection,
  TraitSemanticProfile,
  UniqueArtSemanticProfile,
} from './EncounterContracts';
import { calculateDerivedSpeed, clamp } from './CombatRules';
import type {
  CombatArmorSnapshot,
  CombatCharacterSource,
  CombatEncounterSnapshot,
  CombatProjectionBundle,
  CombatThreatTier,
  CombatWeaponSnapshot,
  CombatantSnapshot,
} from './CombatTypes';

export interface CreateCombatEncounterSnapshotInput {
  sessionId: string;
  intent: CombatEncounterSnapshot['intent'];
  playerSources: CombatCharacterSource[];
  enemySources: CombatCharacterSource[];
  projections: CombatProjectionBundle;
  threatTier: CombatThreatTier;
  lootableItemIds: string[];
  capturableEquipmentItemIds: string[];
}

const MOUNT_SPEED_BY_QUALITY = {
  white: 0,
  green: 5,
  blue: 10,
  purple: 15,
  orange: 20,
  red: 25,
} as const;

const TREASURE_SPEED_BY_QUALITY = {
  white: 0,
  green: 2,
  blue: 4,
  purple: 6,
  orange: 10,
  red: 15,
} as const;

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

function sourceActorId(source: CombatCharacterSource): string {
  const actorId = source.id ?? source.npcId;
  if (!actorId || (source.id && source.npcId && source.id !== source.npcId)) {
    throw new Error(`参战来源 ${source.name || '(unnamed)'} 缺少唯一稳定 actorId。`);
  }
  return actorId;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function profileIsExecutableForCombat(profile: SemanticProjection): boolean {
  return profile.status === 'executable' && profile.rulesetScopes.includes('personal_combat');
}

function validateProjectionBundle(bundle: CombatProjectionBundle): Map<string, SemanticProjection> {
  if (!bundle || !Array.isArray(bundle.profiles)) throw new Error('战斗投影包必须包含 profiles 数组。');
  const profiles = new Map<string, SemanticProjection>();
  for (const profile of bundle.profiles) {
    const validation = validateSemanticProjection(profile);
    if (!validation.valid) {
      throw new Error(`能力语义投影 ${String(profile?.sourceId ?? '(unknown)')} 校验失败：${validation.errors.join('；')}`);
    }
    if (profiles.has(profile.sourceId)) throw new Error(`能力语义投影 sourceId 重复：${profile.sourceId}。`);
    profiles.set(profile.sourceId, cloneJson(profile));
  }
  return profiles;
}

export function createValidatedCombatProjectionBundle(
  profiles: SemanticProjection[],
): CombatProjectionBundle {
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
    .filter((profile): profile is T => Boolean(profile && profileIsExecutableForCombat(profile) && guard(profile)));
}

function createCombatantSnapshot(
  source: CombatCharacterSource,
  side: CombatantSnapshot['side'],
  stableOrder: number,
  profiles: ReadonlyMap<string, SemanticProjection>,
): CombatantSnapshot {
  const actorId = sourceActorId(source);
  const traitIds = (source.traits ?? []).map((trait) => trait.id);
  const artIds = (source.uniqueArts ?? []).map((art) => art.id);
  const equipment = source.equipment ?? [];
  const equipmentIds = equipment.map((item) => item.id);
  const itemIds = (source.inventory ?? []).map((item) => item.id);

  const traitProfiles = collectProfiles<TraitSemanticProfile>(
    traitIds,
    profiles,
    (profile): profile is TraitSemanticProfile => profile.profileKind === 'ability' && profile.sourceType === 'trait',
  );
  const uniqueArtProfiles = collectProfiles<UniqueArtSemanticProfile>(
    artIds,
    profiles,
    (profile): profile is UniqueArtSemanticProfile => profile.profileKind === 'ability' && profile.sourceType === 'unique_art',
  );
  const equipmentProfiles = collectProfiles<EquipmentSemanticProfile>(
    equipmentIds,
    profiles,
    (profile): profile is EquipmentSemanticProfile => profile.profileKind === 'equipment',
  );
  const itemProfiles = collectProfiles<ItemCombatProfile>(
    itemIds,
    profiles,
    (profile): profile is ItemCombatProfile => profile.profileKind === 'item' && profile.combatUse,
  );

  for (const profile of equipmentProfiles) {
    const item = equipment.find((candidate) => candidate.id === profile.sourceId);
    if (!item || item.slot !== profile.equipmentSlot) {
      throw new Error(`装备投影 ${profile.sourceId} 的槽位与真实装备不一致。`);
    }
  }

  const equipmentBySlot = new Map<EquipmentSemanticProfile['equipmentSlot'], EquipmentSemanticProfile>();
  for (const profile of equipmentProfiles) {
    if (equipmentBySlot.has(profile.equipmentSlot)) {
      throw new Error(`${actorId} 的 ${profile.equipmentSlot} 存在多个可执行装备投影。`);
    }
    equipmentBySlot.set(profile.equipmentSlot, profile);
  }

  const weaponProfile = equipmentBySlot.get('weapon');
  const armorProfile = equipmentBySlot.get('armor');
  const mountProfile = equipmentBySlot.get('mount');
  const treasureProfile = equipmentBySlot.get('treasure');
  const weapon: CombatWeaponSnapshot = weaponProfile ? {
    sourceId: weaponProfile.sourceId,
    weight: weaponProfile.weaponWeight ?? 'standard',
    baseDamage: weaponProfile.weaponBaseDamage ?? 5,
    accuracyBonus: weaponProfile.accuracyBonus ?? 0,
    armorPenetration: weaponProfile.armorPenetration ?? 0,
  } : {
    sourceId: null,
    weight: 'unarmed',
    baseDamage: 5,
    accuracyBonus: 0,
    armorPenetration: 0,
  };
  const armor: CombatArmorSnapshot = armorProfile ? {
    sourceId: armorProfile.sourceId,
    weight: armorProfile.armorWeight ?? 'medium',
    armorTier: armorProfile.armorTier ?? 0,
    blockBonus: armorProfile.blockBonus ?? 0,
  } : {
    sourceId: null,
    weight: 'none',
    armorTier: 0,
    blockBonus: 0,
  };

  const mountSpeed = mountProfile
    ? mountProfile.speedModifier ?? MOUNT_SPEED_BY_QUALITY[mountProfile.qualityTier]
    : 0;
  const treasureSpeed = treasureProfile
    ? treasureProfile.speedModifier ?? TREASURE_SPEED_BY_QUALITY[treasureProfile.qualityTier]
    : 0;
  const traitSpeed = traitProfiles.flatMap((profile) => profile.effects)
    .filter((effect) => effect.trigger === 'battle_start'
      && effect.condition === 'always'
      && effect.operation === 'modify_speed'
      && effect.target === 'self')
    .reduce((sum, effect) => sum + effect.value, 0);

  const hp = clamp(Math.round(finiteOr(source.vitals?.hp, 100)), 0, 100);
  const stamina = clamp(Math.round(finiteOr(source.vitals?.stamina, 100)), 0, 100);
  return {
    actorId,
    name: source.name,
    side,
    stableOrder,
    persistent: source.persistent !== false,
    level: Math.max(1, Math.trunc(finiteOr(source.level, 1))),
    xp: Math.max(0, Math.trunc(finiteOr(source.xp, 0))),
    martial: clamp(finiteOr(source.abilityScores?.武力, 50), 0, 100),
    luck: clamp(finiteOr(source.abilityScores?.机运, 50), 0, 100),
    hp,
    maxHp: 100,
    stamina,
    maxStamina: 100,
    speed: calculateDerivedSpeed({
      weaponWeight: weapon.weight,
      armorWeight: armor.weight,
      equipmentSpeed: mountSpeed + treasureSpeed,
      traitSpeed,
    }),
    weapon,
    armor,
    traitProfiles,
    uniqueArtProfiles,
    equipmentProfiles,
    itemProfiles,
    inventory: (source.inventory ?? []).map((item) => ({
      itemId: item.id,
      quantity: Math.max(0, Math.trunc(finiteOr(item.quantity, 0))),
    })),
    equipmentItemIds: equipmentIds,
  };
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} 不得包含重复 ID。`);
}

export function createCombatEncounterSnapshot(input: CreateCombatEncounterSnapshotInput): CombatEncounterSnapshot {
  assertValidEncounterStartIntent(input.intent);
  if (input.intent.kind !== 'personal_combat') throw new Error('Combat 快照只接受 personal_combat 意图。');
  if (!input.sessionId.trim()) throw new Error('sessionId 不能为空。');
  const profiles = validateProjectionBundle(input.projections);
  const allSources = [...input.playerSources, ...input.enemySources];
  const sourcesById = new Map<string, CombatCharacterSource>();
  for (const source of allSources) {
    const actorId = sourceActorId(source);
    if (sourcesById.has(actorId)) throw new Error(`参战来源 ID 重复：${actorId}。`);
    sourcesById.set(actorId, source);
  }

  const orderedParticipants = [
    ...input.intent.playerParty.actorIds.map((actorId) => ({ actorId, side: 'player' as const })),
    ...input.intent.enemyParty.actorIds.map((actorId) => ({ actorId, side: 'enemy' as const })),
  ];
  const combatants = orderedParticipants.map(({ actorId, side }, stableOrder) => {
    const source = sourcesById.get(actorId);
    if (!source) throw new Error(`开战意图中的参战者 ${actorId} 没有对应角色来源。`);
    return createCombatantSnapshot(source, side, stableOrder, profiles);
  });

  assertUnique(input.lootableItemIds, 'lootableItemIds');
  assertUnique(input.capturableEquipmentItemIds, 'capturableEquipmentItemIds');
  const enemyInventoryIds = new Set(combatants
    .filter((combatant) => combatant.side === 'enemy')
    .flatMap((combatant) => combatant.inventory.map((item) => item.itemId)));
  const enemyEquipmentIds = new Set(combatants
    .filter((combatant) => combatant.side === 'enemy')
    .flatMap((combatant) => combatant.equipmentItemIds));
  for (const itemId of input.lootableItemIds) {
    if (!enemyInventoryIds.has(itemId)) throw new Error(`战利品 ${itemId} 不存在于冻结敌方背包。`);
  }
  for (const itemId of input.capturableEquipmentItemIds) {
    if (!enemyEquipmentIds.has(itemId)) throw new Error(`待处置装备 ${itemId} 不存在于冻结敌方装备。`);
  }

  const hashPayload = {
    snapshotVersion: 1 as const,
    sessionId: input.sessionId,
    intent: cloneJson(input.intent),
    seed: input.intent.seed,
    threatTier: input.threatTier,
    combatants,
    lootableItemIds: [...input.lootableItemIds],
    capturableEquipmentItemIds: [...input.capturableEquipmentItemIds],
  };
  const snapshot: CombatEncounterSnapshot = {
    ...hashPayload,
    snapshotHash: hashCanonicalValue(hashPayload),
  };
  return deepFreeze(cloneJson(snapshot));
}
