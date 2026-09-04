import {
  AGGRESSIVE_WAR_RULESET_VERSION,
  SUPPORTED_COMBAT_RULESET_VERSIONS,
  ENCOUNTER_CONTRACT_VERSION,
  ENCOUNTER_ENVIRONMENT_TAGS,
  ENCOUNTER_SCOPED_ARMOR_CLASSES,
  ENCOUNTER_SCOPED_COMBATANT_ARCHETYPES,
  ENCOUNTER_SCOPED_WEAPON_CLASSES,
  ITEM_QUALITY_TIERS,
  SEMANTIC_EFFECT_CONDITIONS,
  SEMANTIC_EFFECT_OPERATIONS,
  SEMANTIC_EFFECT_TARGETS,
  SEMANTIC_EFFECT_TRIGGERS,
  SEMANTIC_PROJECTION_VERSION,
  TROOP_PRIMARY_CLASSES,
  TROOP_SEMANTIC_TAGS,
  SUPPORTED_WAR_RULESET_VERSIONS,
  THEATER_WAR_RULESET_VERSION,
  WAR_RULESET_VERSION,
  type EncounterStartIntent,
  type SemanticProjection,
  type UnsealedEncounterResult,
  type UniqueArtPowerClass,
} from './EncounterContracts';
export { normalizeEquipmentQualityTier } from '../equipment/EquipmentQuality';

export interface EncounterValidationResult {
  valid: boolean;
  errors: string[];
}

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export const UNIQUE_ART_POWER_RULES: Record<UniqueArtPowerClass, { powerMultiplier: number; staminaCost: number; label: string }> = {
  light: { powerMultiplier: 1.10, staminaCost: 8, label: '轻型' },
  standard: { powerMultiplier: 1.35, staminaCost: 14, label: '标准' },
  heavy: { powerMultiplier: 1.65, staminaCost: 22, label: '重型' },
  ultimate: { powerMultiplier: 2.00, staminaCost: 32, label: '绝招' },
};

export const EQUIPMENT_QUALITY_LIMITS = {
  white: { weaponBaseDamage: 8, accuracyBonus: 3, armorPenetration: 2, blockBonus: 3, armorTier: 1 },
  green: { weaponBaseDamage: 10, accuracyBonus: 4, armorPenetration: 3, blockBonus: 4, armorTier: 2 },
  blue: { weaponBaseDamage: 14, accuracyBonus: 6, armorPenetration: 5, blockBonus: 6, armorTier: 3 },
  purple: { weaponBaseDamage: 17, accuracyBonus: 8, armorPenetration: 7, blockBonus: 8, armorTier: 4 },
  orange: { weaponBaseDamage: 21, accuracyBonus: 10, armorPenetration: 9, blockBonus: 10, armorTier: 5 },
  red: { weaponBaseDamage: 25, accuracyBonus: 12, armorPenetration: 12, blockBonus: 12, armorTier: 5 },
} as const;

export const EQUIPMENT_QUALITY_BASELINES = {
  white: { weaponBaseDamage: 6, accuracyBonus: 0, armorPenetration: 0, blockBonus: 1, armorTier: 1 },
  green: { weaponBaseDamage: 8, accuracyBonus: 1, armorPenetration: 1, blockBonus: 2, armorTier: 2 },
  blue: { weaponBaseDamage: 10, accuracyBonus: 2, armorPenetration: 2, blockBonus: 4, armorTier: 3 },
  purple: { weaponBaseDamage: 13, accuracyBonus: 4, armorPenetration: 4, blockBonus: 6, armorTier: 4 },
  orange: { weaponBaseDamage: 16, accuracyBonus: 6, armorPenetration: 6, blockBonus: 8, armorTier: 5 },
  red: { weaponBaseDamage: 19, accuracyBonus: 8, armorPenetration: 8, blockBonus: 10, armorTier: 5 },
} as const;

export const ITEM_EFFECT_LIMITS = {
  white: 10,
  green: 20,
  blue: 30,
  purple: 50,
  orange: 80,
  red: 100,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStableId(value: unknown): value is string {
  return isNonEmptyString(value) && STABLE_ID_PATTERN.test(value);
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function isKnownValue<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function validateStableIdList(
  value: unknown,
  path: string,
  errors: string[],
  minimum: number,
  maximum?: number,
): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是稳定 ID 数组。`);
    return [];
  }

  if (value.length < minimum || (maximum !== undefined && value.length > maximum)) {
    if (minimum === 1 && maximum === 3) {
      errors.push(`${path} 只能包含 1—3 个稳定 ID。`);
    } else {
      errors.push(`${path} 至少需要 ${minimum} 个稳定 ID。`);
    }
  }

  const validIds: string[] = [];
  value.forEach((candidate, index) => {
    if (!isStableId(candidate)) {
      errors.push(`${path}[${index}] 不是合法的稳定 ID。`);
      return;
    }
    validIds.push(candidate);
  });

  if (hasDuplicates(validIds)) {
    errors.push(`${path} 内的稳定 ID 不得重复。`);
  }

  return validIds;
}

function validateNoCrossSideOverlap(left: readonly string[], right: readonly string[], errors: string[]): void {
  const rightIds = new Set(right);
  if (left.some((id) => rightIds.has(id))) {
    errors.push('同一稳定 ID 不能同时出现在双方。');
  }
}

function validateWarCommitments(
  value: unknown,
  path: string,
  expectedTroopIds: readonly string[],
  errors: string[],
): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是投入兵力数组。`);
    return [];
  }
  const ids: string[] = [];
  value.forEach((candidate, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(candidate)) {
      errors.push(`${entryPath} 必须是对象。`);
      return;
    }
    if (!isStableId(candidate.troopId)) errors.push(`${entryPath}.troopId 不是合法稳定 ID。`);
    else ids.push(candidate.troopId);
    if (!isIntegerInRange(candidate.committedStrength, 1, Number.MAX_SAFE_INTEGER)) {
      errors.push(`${entryPath}.committedStrength 必须是正整数。`);
    }
  });
  if (hasDuplicates(ids)) errors.push(`${path}.troopId 不得重复。`);
  const expected = [...expectedTroopIds].sort();
  const actual = [...ids].sort();
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    errors.push(`${path} 必须逐一覆盖本侧 troopIds，不能遗漏或加入场外部队。`);
  }
  return ids;
}

function validateScopedCombatants(
  value: Record<string, unknown>,
  playerIds: readonly string[],
  enemyIds: readonly string[],
  errors: string[],
): void {
  const scopedCombatants = value.scopedCombatants;
  if (scopedCombatants === undefined) {
    for (const actorId of [...playerIds, ...enemyIds]) {
      if (actorId.includes(':scoped:')) {
        errors.push(`本场临时参战者 ${actorId} 缺少 scopedCombatants 声明。`);
      }
    }
    return;
  }
  if (!Array.isArray(scopedCombatants)) {
    errors.push('personal_combat.scopedCombatants 必须是数组。');
    return;
  }
  if (scopedCombatants.length < 1 || scopedCombatants.length > 5) {
    errors.push('personal_combat.scopedCombatants 只能包含 1—5 名本场临时参战者。');
  }

  const playerIdSet = new Set(playerIds);
  const enemyIdSet = new Set(enemyIds);
  const scopedIds: string[] = [];
  let temporaryEscortCount = 0;
  let enemyScopedCount = 0;
  scopedCombatants.forEach((candidate, index) => {
    const path = `personal_combat.scopedCombatants[${index}]`;
    if (!isRecord(candidate)) {
      errors.push(`${path} 必须是对象。`);
      return;
    }
    if (!isStableId(candidate.actorId)) {
      errors.push(`${path}.actorId 不是合法的稳定 ID。`);
    } else {
      scopedIds.push(candidate.actorId);
      const requiredPrefix = `${String(value.encounterId)}:scoped:`;
      if (!candidate.actorId.startsWith(requiredPrefix)) {
        errors.push(`${path}.actorId 必须以 ${requiredPrefix} 开头。`);
      }
      const inPlayerParty = playerIdSet.has(candidate.actorId);
      const inEnemyParty = enemyIdSet.has(candidate.actorId);
      if (inPlayerParty === inEnemyParty) {
        errors.push(`${path}.actorId 必须且只能出现在一方 actorIds。`);
      } else if (inPlayerParty) {
        temporaryEscortCount += 1;
        if (candidate.systemRole !== 'temporary_escort') {
          errors.push(`${path}.systemRole 必须为 temporary_escort。`);
        }
      } else {
        enemyScopedCount += 1;
        if (candidate.systemRole !== undefined) {
          errors.push(`${path}.systemRole 只允许本地派生的我方临时护卫使用。`);
        }
      }
    }
    if (!isNonEmptyString(candidate.name) || candidate.name.trim().length > 40) {
      errors.push(`${path}.name 必须是 1—40 字符的可读称呼。`);
    }
    if (!isKnownValue(candidate.archetype, ENCOUNTER_SCOPED_COMBATANT_ARCHETYPES)) {
      errors.push(`${path}.archetype 不在白名单中。`);
    }
    if (!isKnownValue(candidate.weaponClass, ENCOUNTER_SCOPED_WEAPON_CLASSES)) {
      errors.push(`${path}.weaponClass 不在白名单中。`);
    }
    if (!isKnownValue(candidate.armorClass, ENCOUNTER_SCOPED_ARMOR_CLASSES)) {
      errors.push(`${path}.armorClass 不在白名单中。`);
    }
  });
  if (hasDuplicates(scopedIds)) {
    errors.push('personal_combat.scopedCombatants.actorId 不得重复。');
  }
  if (temporaryEscortCount > 2) {
    errors.push('personal_combat 我方临时护卫最多 2 名。');
  }
  if (enemyScopedCount > 3) {
    errors.push('personal_combat 敌方临时参战者最多 3 名。');
  }
  const declaredIds = new Set(scopedIds);
  for (const actorId of [...playerIds, ...enemyIds]) {
    if (actorId.includes(':scoped:') && !declaredIds.has(actorId)) {
      errors.push(`本场临时参战者 ${actorId} 缺少 scopedCombatants 声明。`);
    }
  }
}

function validateEncounterPolicy(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('policy 必须是对象。');
    return;
  }

  if (!['nonlethal', 'standard', 'fatal'].includes(String(value.lethality))) {
    errors.push('policy.lethality 不在白名单中。');
  }
  for (const key of ['allowRetreat', 'allowSurrender', 'allowCapture'] as const) {
    if (typeof value[key] !== 'boolean') {
      errors.push(`policy.${key} 必须是布尔值。`);
    }
  }
  if (!['actual_items_only', 'none'].includes(String(value.lootPolicy))) {
    errors.push('policy.lootPolicy 不在白名单中。');
  }
}

export function validateEncounterStartIntent(value: unknown): EncounterValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ['EncounterStartIntent 必须是对象。'] };
  }

  if (value.contractVersion !== ENCOUNTER_CONTRACT_VERSION) {
    errors.push(`contractVersion 必须为 ${ENCOUNTER_CONTRACT_VERSION}。`);
  }
  for (const key of ['encounterId', 'locationId', 'seed'] as const) {
    if (!isStableId(value[key])) {
      errors.push(`${key} 不是合法的稳定 ID。`);
    }
  }
  if (!isNonEmptyString(value.reason)) errors.push('reason 不能为空。');
  if (!isIntegerInRange(value.sourceTurnNumber, 0, Number.MAX_SAFE_INTEGER)) {
    errors.push('sourceTurnNumber 必须是非负整数。');
  }
  if (!isNonEmptyString(value.createdAt) || Number.isNaN(Date.parse(value.createdAt))) {
    errors.push('createdAt 必须是合法时间。');
  }
  validateEncounterPolicy(value.policy, errors);

  if (value.kind === 'personal_combat') {
    if (!(SUPPORTED_COMBAT_RULESET_VERSIONS as readonly unknown[]).includes(value.rulesetVersion)) {
      errors.push(`personal_combat.rulesetVersion 必须为 ${SUPPORTED_COMBAT_RULESET_VERSIONS.join(' / ')}。`);
    }
    const playerParty = isRecord(value.playerParty) ? value.playerParty : undefined;
    const enemyParty = isRecord(value.enemyParty) ? value.enemyParty : undefined;
    const playerIds = validateStableIdList(
      playerParty?.actorIds,
      'personal_combat.playerParty.actorIds',
      errors,
      1,
      3,
    );
    const enemyIds = validateStableIdList(
      enemyParty?.actorIds,
      'personal_combat.enemyParty.actorIds',
      errors,
      1,
      3,
    );
    validateNoCrossSideOverlap(playerIds, enemyIds, errors);
    validateScopedCombatants(value, playerIds, enemyIds, errors);
    if (!['player_choice', 'locked'].includes(String(value.partySelection))) {
      errors.push('personal_combat.partySelection 不在白名单中。');
    }
    if (
      value.escortAvailability !== undefined
      && !['normal', 'explicitly_solo'].includes(String(value.escortAvailability))
    ) {
      errors.push('personal_combat.escortAvailability 不在白名单中。');
    }
  } else if (value.kind === 'war') {
    if (!(SUPPORTED_WAR_RULESET_VERSIONS as readonly unknown[]).includes(value.rulesetVersion)) {
      errors.push(`war.rulesetVersion 必须为 ${SUPPORTED_WAR_RULESET_VERSIONS.join(' 或 ')}。`);
    }
    const playerForce = isRecord(value.playerForce) ? value.playerForce : undefined;
    const enemyForce = isRecord(value.enemyForce) ? value.enemyForce : undefined;
    const playerIds = validateStableIdList(playerForce?.troopIds, 'war.playerForce.troopIds', errors, 1);
    const enemyIds = validateStableIdList(enemyForce?.troopIds, 'war.enemyForce.troopIds', errors, 1);
    validateNoCrossSideOverlap(playerIds, enemyIds, errors);
    for (const [path, commanderId] of [
      ['war.playerForce.commanderActorId', playerForce?.commanderActorId],
      ['war.enemyForce.commanderActorId', enemyForce?.commanderActorId],
    ] as const) {
      if (commanderId !== undefined && !isStableId(commanderId)) {
        errors.push(`${path} 不是合法的稳定 ID。`);
      }
    }
    if (!['defeat_enemy', 'capture_holding', 'break_siege', 'relieve_siege'].includes(String(value.objective))) {
      errors.push('war.objective 不在白名单中。');
    }
    if (value.targetHoldingId !== undefined && !isStableId(value.targetHoldingId)) {
      errors.push('war.targetHoldingId 不是合法的稳定 ID。');
    }
    if (
      ['capture_holding', 'break_siege', 'relieve_siege'].includes(String(value.objective))
      && value.targetHoldingId === undefined
    ) {
      errors.push('war.targetHoldingId 是领地/围城目标的必填稳定 ID。');
    }
    if (!Array.isArray(value.environmentTags)) {
      errors.push('war.environmentTags 必须是数组。');
    } else {
      const tags = value.environmentTags.filter((tag): tag is string => typeof tag === 'string');
      value.environmentTags.forEach((tag) => {
        if (!isKnownValue(tag, ENCOUNTER_ENVIRONMENT_TAGS)) {
          errors.push(`war.environmentTags 包含未知值 ${String(tag)}。`);
        }
      });
      if (hasDuplicates(tags)) errors.push('war.environmentTags 不得重复。');
    }
    const participation = isRecord(value.participation) ? value.participation : undefined;
    const requiresParticipation = value.rulesetVersion === THEATER_WAR_RULESET_VERSION
      || value.rulesetVersion === AGGRESSIVE_WAR_RULESET_VERSION
      || value.rulesetVersion === WAR_RULESET_VERSION;
    if (requiresParticipation && !participation) {
      errors.push(`${String(value.rulesetVersion)} 必须提供 participation，区分会战背景与直接参战兵力。`);
    }
    if (participation) {
      if (!['overall_command', 'subordinate_sector', 'independent'].includes(String(participation.commandScope))) {
        errors.push('war.participation.commandScope 不在白名单中。');
      }
      if (!['defeat_local_force', 'hold_position', 'assault_position', 'escort', 'raid', 'screen', 'pursuit', 'breakout']
        .includes(String(participation.mission))) {
        errors.push('war.participation.mission 不在白名单中。');
      }
      validateWarCommitments(participation.playerCommitments, 'war.participation.playerCommitments', playerIds, errors);
      validateWarCommitments(participation.enemyCommitments, 'war.participation.enemyCommitments', enemyIds, errors);
      const alliedMainForceIds = participation.alliedMainForceIds === undefined
        ? []
        : validateStableIdList(participation.alliedMainForceIds, 'war.participation.alliedMainForceIds', errors, 0);
      const enemyMainForceIds = participation.enemyMainForceIds === undefined
        ? []
        : validateStableIdList(participation.enemyMainForceIds, 'war.participation.enemyMainForceIds', errors, 0);
      validateNoCrossSideOverlap(alliedMainForceIds, enemyMainForceIds, errors);
      const directIds = new Set([...playerIds, ...enemyIds]);
      if ([...alliedMainForceIds, ...enemyMainForceIds].some((id) => directIds.has(id))) {
        errors.push('会战背景部队不得同时作为本场直接参战部队。');
      }
      if (participation.superiorCommanderActorId !== undefined
        && !isStableId(participation.superiorCommanderActorId)) {
        errors.push('war.participation.superiorCommanderActorId 不是合法稳定 ID。');
      }
      if (participation.commandScope === 'subordinate_sector') {
        if (alliedMainForceIds.length === 0) {
          errors.push('下属局部任务必须至少引用一支上级或友军主力作为会战背景。');
        }
        if (value.objective !== 'defeat_enemy') {
          errors.push('下属局部任务只能结算局部敌军，不得直接改写领地或整个围城结果。');
        }
      }
    }
  } else {
    errors.push('kind 必须是 personal_combat 或 war。');
  }

  return { valid: errors.length === 0, errors };
}

function validateSemanticEffects(value: unknown, errors: string[]): number {
  if (!Array.isArray(value)) {
    errors.push('effects 必须是数组。');
    return 0;
  }

  value.forEach((effect, index) => {
    const path = `effects[${index}]`;
    if (!isRecord(effect)) {
      errors.push(`${path} 必须是对象。`);
      return;
    }
    if (!isKnownValue(effect.trigger, SEMANTIC_EFFECT_TRIGGERS)) {
      errors.push(`${path}.trigger 包含未知值 ${String(effect.trigger)}。`);
    }
    if (!isKnownValue(effect.condition, SEMANTIC_EFFECT_CONDITIONS)) {
      errors.push(`${path}.condition 包含未知值 ${String(effect.condition)}。`);
    }
    if (!isKnownValue(effect.operation, SEMANTIC_EFFECT_OPERATIONS)) {
      errors.push(`${path}.operation 包含未知值 ${String(effect.operation)}。`);
    }
    if (!isKnownValue(effect.target, SEMANTIC_EFFECT_TARGETS)) {
      errors.push(`${path}.target 包含未知值 ${String(effect.target)}。`);
    }
    if (!isFiniteNumber(effect.value)) errors.push(`${path}.value 必须是有限数字。`);
    if (!Number.isInteger(effect.priority)) errors.push(`${path}.priority 必须是整数。`);
    for (const key of ['perRoundLimit', 'perEncounterLimit'] as const) {
      if (effect[key] !== undefined && !isIntegerInRange(effect[key], 1, 999)) {
        errors.push(`${path}.${key} 必须是正整数。`);
      }
    }
    if (effect.stackingGroup !== undefined && !isStableId(effect.stackingGroup)) {
      errors.push(`${path}.stackingGroup 不是合法的稳定 ID。`);
    }
    if (effect.statusId !== undefined && !isStableId(effect.statusId)) {
      errors.push(`${path}.statusId 不是合法的稳定 ID。`);
    }
    if (['apply_status', 'remove_status'].includes(String(effect.operation)) && !isStableId(effect.statusId)) {
      errors.push(`${path}.${String(effect.operation)} 必须声明 statusId。`);
    }
  });

  return value.length;
}

function validateSemanticBase(value: Record<string, unknown>, errors: string[]): number {
  if (value.projectionVersion !== SEMANTIC_PROJECTION_VERSION) {
    errors.push(`projectionVersion 必须为 ${SEMANTIC_PROJECTION_VERSION}。`);
  }
  if (!isStableId(value.sourceId)) errors.push('sourceId 不是合法的稳定 ID。');
  if (!['executable', 'narrative_only'].includes(String(value.status))) {
    errors.push('status 必须是 executable 或 narrative_only。');
  }
  if (!Array.isArray(value.rulesetScopes) || value.rulesetScopes.length === 0) {
    errors.push('rulesetScopes 至少包含一个规则范围。');
  } else {
    const scopes = value.rulesetScopes.filter((scope): scope is string => typeof scope === 'string');
    value.rulesetScopes.forEach((scope) => {
      if (!['personal_combat', 'war', 'runtime_turn'].includes(String(scope))) {
        errors.push(`rulesetScopes 包含未知值 ${String(scope)}。`);
      }
    });
    if (hasDuplicates(scopes)) errors.push('rulesetScopes 不得重复。');
  }

  const effectCount = validateSemanticEffects(value.effects, errors);
  if (value.status === 'narrative_only' && effectCount > 0) {
    errors.push('narrative_only 投影不得包含可执行效果。');
  }
  return effectCount;
}

export function validateSemanticProjection(value: unknown): EncounterValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ['SemanticProjection 必须是对象。'] };
  }

  const effectCount = validateSemanticBase(value, errors);

  if (value.profileKind === 'ability') {
    if (value.sourceType === 'trait') {
      if (value.activation !== 'passive') errors.push('特质只能是 passive。');
    } else if (value.sourceType === 'unique_art') {
      if (!['active', 'passive', 'hybrid'].includes(String(value.activation))) {
        errors.push('绝艺 activation 只能是 active、passive 或 hybrid。');
      }
      if (!['self', 'single_ally', 'all_allies', 'single_enemy', 'all_enemies'].includes(String(value.targetMode))) {
        errors.push(`绝艺 targetMode 包含未知值 ${String(value.targetMode)}。`);
      }
      if (!['damage', 'healing', 'protection', 'control', 'mixed'].includes(String(value.purpose))) {
        errors.push(`绝艺 purpose 包含未知值 ${String(value.purpose)}。`);
      }
      const powerClass = value.powerClass;
      if (!isKnownValue(powerClass, Object.keys(UNIQUE_ART_POWER_RULES) as UniqueArtPowerClass[])) {
        errors.push(`绝艺 powerClass 包含未知值 ${String(powerClass)}。`);
      } else {
        const rule = UNIQUE_ART_POWER_RULES[powerClass];
        if (value.powerMultiplier !== rule.powerMultiplier) {
          errors.push(`${rule.label}绝艺的伤害倍率必须为 ${rule.powerMultiplier.toFixed(2)}。`);
        }
        if (value.staminaCost !== rule.staminaCost) {
          errors.push(`${rule.label}绝艺的体力消耗必须为 ${rule.staminaCost}。`);
        }
      }
      if (!isIntegerInRange(value.maxHits, 1, 5)) {
        errors.push('绝艺 maxHits 必须是 1—5 的整数。');
      }
      if (!isFiniteNumber(value.accuracyModifier) || value.accuracyModifier < -20 || value.accuracyModifier > 20) {
        errors.push('绝艺 accuracyModifier 必须在 -20—20 之间。');
      }
      if (!isIntegerInRange(value.perEncounterLimit, 1, 99)) {
        errors.push('绝艺 perEncounterLimit 必须是正整数。');
      }
      for (const key of ['blockable', 'armorPiercing', 'canCrit', 'allowAutoUse'] as const) {
        if (typeof value[key] !== 'boolean') errors.push(`绝艺 ${key} 必须是布尔值。`);
      }
      if (value.allowAutoUse === true && !['light', 'standard'].includes(String(value.powerClass))) {
        errors.push('只有轻型或标准绝艺可声明 allowAutoUse=true。');
      }
      if (value.status === 'executable' && effectCount === 0) {
        errors.push('可执行绝艺必须至少包含一个效果。');
      }
      const effects = Array.isArray(value.effects)
        ? value.effects.filter(isRecord)
        : [];
      const runtimeEffects = effects.filter((effect) => effect.trigger === 'after_runtime_turn');
      const hasRuntimeScope = Array.isArray(value.rulesetScopes)
        && value.rulesetScopes.includes('runtime_turn');
      if (hasRuntimeScope && runtimeEffects.length === 0) {
        errors.push('runtime_turn 绝艺必须至少包含一个 after_runtime_turn 效果。');
      }
      if (runtimeEffects.length > 0) {
        if (!hasRuntimeScope) errors.push('after_runtime_turn 效果必须声明 runtime_turn 规则范围。');
        if (!['passive', 'hybrid'].includes(String(value.activation))) {
          errors.push('after_runtime_turn 效果只允许 passive 或 hybrid 绝艺。');
        }
        runtimeEffects.forEach((effect, index) => {
          if (!['restore_hp', 'restore_stamina'].includes(String(effect.operation))) {
            errors.push(`after_runtime_turn 效果[${index}] 只允许恢复生命或体力。`);
          }
          if (effect.target !== 'self') {
            errors.push(`after_runtime_turn 效果[${index}] 只能作用于 self。`);
          }
          if (!['always', 'self_hp_below_30', 'self_stamina_below_30'].includes(String(effect.condition))) {
            errors.push(`after_runtime_turn 效果[${index}] 使用了不支持的条件。`);
          }
          if (!isFiniteNumber(effect.value) || effect.value <= 0) {
            errors.push(`after_runtime_turn 效果[${index}] 必须提供正数恢复值。`);
          }
        });
      }
    } else {
      errors.push(`ability.sourceType 包含未知值 ${String(value.sourceType)}。`);
    }
  } else if (value.profileKind === 'equipment') {
    if (!['weapon', 'armor', 'mount', 'treasure'].includes(String(value.equipmentSlot))) {
      errors.push('equipmentSlot 不在白名单中。');
    }
    if (!isKnownValue(value.qualityTier, ITEM_QUALITY_TIERS)) {
      errors.push(`qualityTier 包含未知值 ${String(value.qualityTier)}。`);
    }
    if (value.weaponWeight !== undefined && !['unarmed', 'light', 'standard', 'polearm', 'heavy', 'ranged'].includes(String(value.weaponWeight))) {
      errors.push(`weaponWeight 包含未知值 ${String(value.weaponWeight)}。`);
    }
    if (value.armorWeight !== undefined && !['none', 'light', 'medium', 'heavy'].includes(String(value.armorWeight))) {
      errors.push(`armorWeight 包含未知值 ${String(value.armorWeight)}。`);
    }
    const qualityTier = isKnownValue(value.qualityTier, ITEM_QUALITY_TIERS) ? value.qualityTier : undefined;
    if (qualityTier) {
      const limits = EQUIPMENT_QUALITY_LIMITS[qualityTier];
      const baselines = EQUIPMENT_QUALITY_BASELINES[qualityTier];
      for (const key of ['weaponBaseDamage', 'accuracyBonus', 'armorPenetration', 'blockBonus'] as const) {
        const candidate = value[key];
        if (candidate !== undefined && (!isFiniteNumber(candidate) || candidate < 0 || candidate > limits[key])) {
          errors.push(`${key} 超出 ${qualityTier} 品级允许范围 0—${limits[key]}。`);
        }
      }
      if (value.armorTier !== undefined && !isIntegerInRange(value.armorTier, 0, limits.armorTier)) {
        errors.push(`armorTier 超出 ${qualityTier} 品级允许范围 0—${limits.armorTier}。`);
      }
      if (value.speedModifier !== undefined && (!isFiniteNumber(value.speedModifier) || value.speedModifier < -25 || value.speedModifier > 25)) {
        errors.push('speedModifier 必须在 -25—25 之间。');
      }
      if (value.status === 'executable' && value.equipmentSlot === 'weapon') {
        for (const key of ['weaponBaseDamage', 'accuracyBonus', 'armorPenetration'] as const) {
          const candidate = value[key];
          if (candidate !== undefined && isFiniteNumber(candidate) && candidate < baselines[key]) {
            errors.push(`${key} 低于 ${qualityTier} 品级武器保底值 ${baselines[key]}。`);
          }
        }
      }
      if (value.status === 'executable' && value.equipmentSlot === 'armor') {
        if (value.blockBonus !== undefined && isFiniteNumber(value.blockBonus)
          && value.blockBonus < baselines.blockBonus) {
          errors.push(`blockBonus 低于 ${qualityTier} 品级护甲保底值 ${baselines.blockBonus}。`);
        }
        if (value.armorTier !== undefined && isFiniteNumber(value.armorTier) && Number.isInteger(value.armorTier)
          && value.armorTier < baselines.armorTier) {
          errors.push(`armorTier 低于 ${qualityTier} 品级护甲保底值 ${baselines.armorTier}。`);
        }
      }
    }
  } else if (value.profileKind === 'item') {
    if (typeof value.combatUse !== 'boolean') errors.push('combatUse 必须是布尔值。');
    if (!isKnownValue(value.qualityTier, ITEM_QUALITY_TIERS)) {
      errors.push(`qualityTier 包含未知值 ${String(value.qualityTier)}。`);
    }
    if (typeof value.consumable !== 'boolean') errors.push('consumable 必须是布尔值。');
    if (!isIntegerInRange(value.quantityPerUse, 1, 999)) errors.push('quantityPerUse 必须是正整数。');
    if (!isIntegerInRange(value.perEncounterLimit, 1, 999)) errors.push('perEncounterLimit 必须是正整数。');
    if (value.allowAutoUse !== undefined && typeof value.allowAutoUse !== 'boolean') {
      errors.push('allowAutoUse 必须是布尔值。');
    }
    if (value.combatUse === true && (value.status !== 'executable' || effectCount === 0)) {
      errors.push('combatUse=true 的物品必须至少包含一个可执行效果。');
    }
    if (isKnownValue(value.qualityTier, ITEM_QUALITY_TIERS) && Array.isArray(value.effects)) {
      const limit = ITEM_EFFECT_LIMITS[value.qualityTier];
      value.effects.forEach((effect, index) => {
        if (isRecord(effect) && ['restore_hp', 'restore_stamina'].includes(String(effect.operation))
          && isFiniteNumber(effect.value) && effect.value > limit) {
          errors.push(`effects[${index}].value 超出 ${value.qualityTier} 品级允许强度 ${limit}。`);
        }
      });
    }
  } else if (value.profileKind === 'troop') {
    if (!isKnownValue(value.primaryClass, TROOP_PRIMARY_CLASSES)) {
      errors.push(`primaryClass 包含未知值 ${String(value.primaryClass)}。`);
    }
    if (!Array.isArray(value.tags)) {
      errors.push('部队规则标签必须是数组。');
    } else {
      if (value.tags.length > 3) errors.push('部队规则标签最多 3 个。');
      const tags = value.tags.filter((tag): tag is string => typeof tag === 'string');
      value.tags.forEach((tag) => {
        if (!isKnownValue(tag, TROOP_SEMANTIC_TAGS)) {
          errors.push(`部队规则标签包含未知值 ${String(tag)}。`);
        }
      });
      if (hasDuplicates(tags)) errors.push('部队规则标签不得重复。');
    }
    if (value.composition !== undefined) {
      if (!Array.isArray(value.composition) || value.composition.length < 2 || value.composition.length > 5) {
        errors.push('部队混编构成必须包含 2-5 个成分。');
      } else {
        let totalShare = 0;
        const componentClasses: string[] = [];
        value.composition.forEach((component, index) => {
          if (!isRecord(component)) {
            errors.push(`composition[${index}] 必须是对象。`);
            return;
          }
          if (!isKnownValue(component.primaryClass, TROOP_PRIMARY_CLASSES)
            || component.primaryClass === 'mixed') {
            errors.push(`composition[${index}].primaryClass 必须是具体兵种。`);
          } else {
            componentClasses.push(component.primaryClass);
          }
          if (!isIntegerInRange(component.sharePercent, 1, 99)) {
            errors.push(`composition[${index}].sharePercent 必须是 1-99 的整数。`);
          } else {
            totalShare += component.sharePercent;
          }
          if (component.tags !== undefined) {
            if (!Array.isArray(component.tags) || component.tags.length > 3) {
              errors.push(`composition[${index}].tags 最多 3 个。`);
            } else {
              const componentTags = component.tags.filter((tag): tag is string => typeof tag === 'string');
              component.tags.forEach((tag) => {
                if (!isKnownValue(tag, TROOP_SEMANTIC_TAGS)) {
                  errors.push(`composition[${index}].tags 包含未知值 ${String(tag)}。`);
                }
              });
              if (hasDuplicates(componentTags)) errors.push(`composition[${index}].tags 不得重复。`);
            }
          }
        });
        if (totalShare !== 100) errors.push('部队混编构成 sharePercent 总和必须恰为 100。');
        if (hasDuplicates(componentClasses)) errors.push('部队混编构成不得重复 primaryClass。');
      }
    }
  } else {
    errors.push(`profileKind 包含未知值 ${String(value.profileKind)}。`);
  }

  return { valid: errors.length === 0, errors };
}

function validateActionLog(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push('actionLog 必须是数组。');
    return;
  }
  const sequences: number[] = [];
  const actionIds: string[] = [];
  value.forEach((entry, index) => {
    const path = `actionLog[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${path} 必须是对象。`);
      return;
    }
    if (!isIntegerInRange(entry.sequence, 1, Number.MAX_SAFE_INTEGER)) errors.push(`${path}.sequence 必须是正整数。`);
    else sequences.push(entry.sequence);
    if (!isStableId(entry.actionId)) errors.push(`${path}.actionId 不是合法的稳定 ID。`);
    else actionIds.push(entry.actionId);
    if (!isStableId(entry.actorId)) errors.push(`${path}.actorId 不是合法的稳定 ID。`);
    validateStableIdList(entry.targetIds, `${path}.targetIds`, errors, 0);
    if (!isNonEmptyString(entry.actionType)) errors.push(`${path}.actionType 不能为空。`);
    if (!isIntegerInRange(entry.randomDrawStart, 0, Number.MAX_SAFE_INTEGER)) {
      errors.push(`${path}.randomDrawStart 必须是非负整数。`);
    }
    if (!isIntegerInRange(entry.randomDrawEnd, 0, Number.MAX_SAFE_INTEGER)) {
      errors.push(`${path}.randomDrawEnd 必须是非负整数。`);
    } else if (isFiniteNumber(entry.randomDrawStart) && entry.randomDrawEnd < entry.randomDrawStart) {
      errors.push(`${path}.randomDrawEnd 不得小于 randomDrawStart。`);
    }
    if (!isNonEmptyString(entry.summaryKey)) errors.push(`${path}.summaryKey 不能为空。`);
    if (!isRecord(entry.values)) errors.push(`${path}.values 必须是对象。`);
  });
  if (new Set(sequences).size !== sequences.length) errors.push('actionLog.sequence 不得重复。');
  if (hasDuplicates(actionIds)) errors.push('actionLog.actionId 不得重复。');
}

function validateDeltas(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push('deltas 必须是数组。');
    return;
  }
  const keys: string[] = [];
  value.forEach((delta, index) => {
    const path = `deltas[${index}]`;
    if (!isRecord(delta)) {
      errors.push(`${path} 必须是对象。`);
      return;
    }
    if (!isStableId(delta.idempotencyKey)) errors.push(`${path}.idempotencyKey 不是合法的幂等键。`);
    else keys.push(delta.idempotencyKey);
    if (!['actor', 'troop', 'item', 'equipment', 'world'].includes(String(delta.targetKind))) {
      errors.push(`${path}.targetKind 不在白名单中。`);
    }
    if (!isStableId(delta.targetId)) errors.push(`${path}.targetId 不是合法的稳定 ID。`);
    if (!isNonEmptyString(delta.field)) errors.push(`${path}.field 不能为空。`);
    if (!['set', 'increment', 'decrement', 'add', 'remove'].includes(String(delta.operation))) {
      errors.push(`${path}.operation 不在白名单中。`);
    }
  });
  if (hasDuplicates(keys)) errors.push('deltas.idempotencyKey 不得重复。');
}

function validateCombatResult(value: Record<string, unknown>, errors: string[]): void {
  if (!(SUPPORTED_COMBAT_RULESET_VERSIONS as readonly unknown[]).includes(value.rulesetVersion)) {
    errors.push(`personal_combat.rulesetVersion 必须为 ${SUPPORTED_COMBAT_RULESET_VERSIONS.join(' / ')}。`);
  }
  if (!Array.isArray(value.combatants)) {
    errors.push('combatants 必须是数组。');
  } else {
    const actorIds: string[] = [];
    const sides = new Set<string>();
    value.combatants.forEach((combatant, index) => {
      const path = `combatants[${index}]`;
      if (!isRecord(combatant)) {
        errors.push(`${path} 必须是对象。`);
        return;
      }
      if (!isStableId(combatant.actorId)) errors.push(`${path}.actorId 不是合法的稳定 ID。`);
      else actorIds.push(combatant.actorId);
      if (!['player', 'enemy'].includes(String(combatant.side))) errors.push(`${path}.side 不在白名单中。`);
      else sides.add(String(combatant.side));
      if (!isFiniteNumber(combatant.hp) || combatant.hp < 0 || combatant.hp > 100) {
        errors.push(`${path}.hp 必须在 0—100 之间。`);
      }
      if (!isFiniteNumber(combatant.stamina) || combatant.stamina < 0 || combatant.stamina > 100) {
        errors.push(`${path}.stamina 必须在 0—100 之间。`);
      }
      if (!isIntegerInRange(combatant.downCount, 0, 2)) errors.push(`${path}.downCount 必须是 0—2 的整数。`);
      if (!Array.isArray(combatant.statuses) || combatant.statuses.some((status) => !isStableId(status))) {
        errors.push(`${path}.statuses 必须是稳定状态 ID 数组。`);
      }
    });
    if (hasDuplicates(actorIds)) errors.push('combatants.actorId 不得重复。');
    if (value.combatants.length < 2 || !sides.has('player') || !sides.has('enemy')) {
      errors.push('combatants 必须同时包含至少一名我方和一名敌方角色。');
    }
  }
  if (!isIntegerInRange(value.experienceAward, 0, Number.MAX_SAFE_INTEGER)) {
    errors.push('experienceAward 必须是非负整数。');
  }
  validateStableIdList(value.lootItemIds, 'lootItemIds', errors, 0);
  validateStableIdList(value.capturedEquipmentItemIds, 'capturedEquipmentItemIds', errors, 0);
}

function validateWarResult(value: Record<string, unknown>, errors: string[]): void {
  if (!(SUPPORTED_WAR_RULESET_VERSIONS as readonly unknown[]).includes(value.rulesetVersion)) {
    errors.push(`war.rulesetVersion 必须为 ${SUPPORTED_WAR_RULESET_VERSIONS.join(' 或 ')}。`);
  }
  if (!Array.isArray(value.forces)) {
    errors.push('forces 必须是数组。');
  } else {
    const troopIds: string[] = [];
    const sides = new Set<string>();
    value.forces.forEach((force, index) => {
      const path = `forces[${index}]`;
      if (!isRecord(force)) {
        errors.push(`${path} 必须是对象。`);
        return;
      }
      if (!isStableId(force.troopId)) errors.push(`${path}.troopId 不是合法的稳定 ID。`);
      else troopIds.push(force.troopId);
      if (!['player', 'enemy'].includes(String(force.side))) errors.push(`${path}.side 不在白名单中。`);
      else sides.add(String(force.side));
      if (!isIntegerInRange(force.initialStrength, 1, Number.MAX_SAFE_INTEGER)) {
        errors.push(`${path}.initialStrength 必须是正整数。`);
      }
      if (!isIntegerInRange(force.remainingStrength, 0, Number.MAX_SAFE_INTEGER)) {
        errors.push(`${path}.remainingStrength 必须是非负整数。`);
      }
      if (!isIntegerInRange(force.casualties, 0, Number.MAX_SAFE_INTEGER)) {
        errors.push(`${path}.casualties 必须是非负整数。`);
      }
      if (!isIntegerInRange(force.capturedCount, 0, Number.MAX_SAFE_INTEGER)) {
        errors.push(`${path}.capturedCount 必须是非负整数。`);
      }
      if (Number.isInteger(force.capturedCount) && Number.isInteger(force.remainingStrength)
        && Number(force.capturedCount) > Number(force.remainingStrength)) {
        errors.push(`${path}.capturedCount 不得超过 remainingStrength。`);
      }
      if (Number.isInteger(force.initialStrength) && Number.isInteger(force.remainingStrength)
        && Number.isInteger(force.casualties)
        && Number(force.initialStrength) - Number(force.remainingStrength) !== Number(force.casualties)) {
        errors.push(`${path}.casualties 必须等于 initialStrength - remainingStrength。`);
      }
      for (const key of ['morale', 'supply', 'fatigue'] as const) {
        if (!isFiniteNumber(force[key]) || force[key] < 0 || force[key] > 100) {
          errors.push(`${path}.${key} 必须在 0—100 之间。`);
        }
      }
      if (!['active', 'routed', 'surrendered', 'destroyed'].includes(String(force.lifecycleStatus))) {
        errors.push(`${path}.lifecycleStatus 不在战争终态白名单中。`);
      }
      if (force.lifecycleStatus === 'destroyed' && force.remainingStrength !== 0) {
        errors.push(`${path}.lifecycleStatus=destroyed 时 remainingStrength 必须为 0。`);
      }
      if (force.lifecycleStatus === 'active' && Number(force.remainingStrength) <= 0) {
        errors.push(`${path}.lifecycleStatus=active 时 remainingStrength 必须大于 0。`);
      }
      if (force.lifecycleStatus === 'routed' && force.morale !== 0) {
        errors.push(`${path}.lifecycleStatus=routed 时 morale 必须为 0。`);
      }
      for (const key of ['routed', 'surrendered', 'captured'] as const) {
        if (typeof force[key] !== 'boolean') errors.push(`${path}.${key} 必须是布尔值。`);
      }
      if (typeof force.routed === 'boolean' && force.routed !== (force.lifecycleStatus === 'routed')) {
        errors.push(`${path}.routed 必须与 lifecycleStatus=routed 一致。`);
      }
      if (typeof force.surrendered === 'boolean' && force.surrendered !== (force.lifecycleStatus === 'surrendered')) {
        errors.push(`${path}.surrendered 必须与 lifecycleStatus=surrendered 一致。`);
      }
      if (typeof force.captured === 'boolean' && Number.isInteger(force.capturedCount)
        && force.captured !== (Number(force.capturedCount) > 0)) {
        errors.push(`${path}.captured 必须与 capturedCount 一致。`);
      }
      if (!Array.isArray(force.statuses) || force.statuses.some((status) => !isStableId(status))) {
        errors.push(`${path}.statuses 必须是稳定状态 ID 数组。`);
      }
    });
    if (hasDuplicates(troopIds)) errors.push('forces.troopId 不得重复。');
    if (value.forces.length < 2 || !sides.has('player') || !sides.has('enemy')) {
      errors.push('forces 必须同时包含至少一支我方和一支敌方部队。');
    }
  }
  if (!['defeat_enemy', 'capture_holding', 'break_siege', 'relieve_siege'].includes(String(value.objective))) {
    errors.push('objective 不在战争目标白名单中。');
  }
  if (typeof value.objectiveAchieved !== 'boolean') errors.push('objectiveAchieved 必须是布尔值。');
  if (!isIntegerInRange(value.experienceAward, 0, Number.MAX_SAFE_INTEGER)) {
    errors.push('war.experienceAward 必须是非负整数。');
  }
  if (!['objective_achieved', 'force_routed', 'force_destroyed', 'retreat', 'surrender', 'round_limit'].includes(String(value.exitReason))) {
    errors.push('exitReason 不在战争退出原因白名单中。');
  }
  if (!isIntegerInRange(value.roundsCompleted, 0, 10)) errors.push('roundsCompleted 必须是 0—10 的整数。');
  if (!isRecord(value.pursuit)) {
    errors.push('pursuit 必须是对象。');
  } else {
    if (!['not_available', 'declined', 'resolved'].includes(String(value.pursuit.status))) {
      errors.push('pursuit.status 不在白名单中。');
    }
    for (const key of ['pursuingSide', 'fleeingSide'] as const) {
      if (value.pursuit[key] !== undefined && !['player', 'enemy'].includes(String(value.pursuit[key]))) {
        errors.push(`pursuit.${key} 不在白名单中。`);
      }
    }
    for (const key of ['extraCasualties', 'extraCaptured'] as const) {
      if (!isIntegerInRange(value.pursuit[key], 0, Number.MAX_SAFE_INTEGER)) {
        errors.push(`pursuit.${key} 必须是非负整数。`);
      }
    }
  }
  if (!Array.isArray(value.commanders)) {
    errors.push('commanders 必须是数组。');
  } else {
    const commanderIds: string[] = [];
    value.commanders.forEach((commander, index) => {
      const path = `commanders[${index}]`;
      if (!isRecord(commander)) {
        errors.push(`${path} 必须是对象。`);
        return;
      }
      if (!isStableId(commander.actorId)) errors.push(`${path}.actorId 不是合法的稳定 ID。`);
      else commanderIds.push(commander.actorId);
      if (!['player', 'enemy'].includes(String(commander.side))) errors.push(`${path}.side 不在白名单中。`);
      if (!['active', 'wounded', 'missing', 'captured', 'dead'].includes(String(commander.outcome))) {
        errors.push(`${path}.outcome 不在白名单中。`);
      }
    });
    if (hasDuplicates(commanderIds)) errors.push('commanders.actorId 不得重复。');
  }
  validateStableIdList(value.capturedItemIds, 'capturedItemIds', errors, 0);
}

export function validateEncounterResultPayload(value: unknown): EncounterValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ['EncounterResult 必须是对象。'] };
  }
  if (value.contractVersion !== ENCOUNTER_CONTRACT_VERSION) {
    errors.push(`contractVersion 必须为 ${ENCOUNTER_CONTRACT_VERSION}。`);
  }
  for (const key of ['sessionId', 'encounterId', 'seed'] as const) {
    if (!isStableId(value[key])) errors.push(`${key} 不是合法的稳定 ID。`);
  }
  if (!isIntegerInRange(value.sourceTurnNumber, 0, Number.MAX_SAFE_INTEGER)) {
    errors.push('sourceTurnNumber 必须是非负整数。');
  }
  if (!isNonEmptyString(value.resolvedAt) || Number.isNaN(Date.parse(value.resolvedAt))) {
    errors.push('resolvedAt 必须是合法时间。');
  }
  if (!['player_victory', 'enemy_victory', 'draw', 'player_retreat', 'enemy_retreat', 'surrender'].includes(String(value.outcome))) {
    errors.push('outcome 不在白名单中。');
  }
  if (!isFiniteNumber(value.elapsedMinutes) || value.elapsedMinutes < 0) {
    errors.push('elapsedMinutes 必须是非负有限数字。');
  }
  validateActionLog(value.actionLog, errors);
  validateDeltas(value.deltas, errors);

  if (value.kind === 'personal_combat') validateCombatResult(value, errors);
  else if (value.kind === 'war') validateWarResult(value, errors);
  else errors.push('kind 必须是 personal_combat 或 war。');

  return { valid: errors.length === 0, errors };
}

export function assertValidEncounterStartIntent(value: unknown): asserts value is EncounterStartIntent {
  const validation = validateEncounterStartIntent(value);
  if (!validation.valid) throw new Error(validation.errors.join('\n'));
}

export function assertValidSemanticProjection(value: unknown): asserts value is SemanticProjection {
  const validation = validateSemanticProjection(value);
  if (!validation.valid) throw new Error(validation.errors.join('\n'));
}

export function assertValidEncounterResultPayload(value: unknown): asserts value is UnsealedEncounterResult {
  const validation = validateEncounterResultPayload(value);
  if (!validation.valid) throw new Error(validation.errors.join('\n'));
}
