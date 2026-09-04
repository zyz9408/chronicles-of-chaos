import {
  COMBAT_RULESET_VERSION,
  ENCOUNTER_CONTRACT_VERSION,
  type EncounterActionLogEntry,
  type SemanticEffect,
  type SealedEncounterResult,
  type UnsealedCombatResult,
  type UniqueArtSemanticProfile,
} from './EncounterContracts';
import {
  SeededEncounterRandom,
  sealEncounterResult,
} from './EncounterDeterminism';
import { assertValidEncounterResultPayload } from './EncounterContractValidation';
import {
  ARMOR_REDUCTION_BY_TIER,
  COMBAT_GAUGE_THRESHOLD,
  COMBAT_STABILIZE_HP_COST,
  COMBAT_STABILIZE_HP_RESTORE,
  COMBAT_STABILIZE_STAMINA_RESTORE,
  SCOPED_NORMAL_ATTACK_DAMAGE_CAP,
  canStabilizeAlly,
  calculateBlockChance,
  calculateCriticalChance,
  calculateHitChance,
  calculateNormalAttackDamage,
  calculateV21BlockChance,
  calculateV21HitChance,
  calculateV21NormalAttackDamage,
  calculateV21ScopedDamageCap,
  calculateRetreatChance,
  clamp,
  normalizeCombatStatuses,
} from './CombatRules';
import type {
  CombatAction,
  CombatDecision,
  CombatEngineState,
  CombatEncounterSnapshot,
  CombatRuntimeCombatant,
  CombatantSnapshot,
} from './CombatTypes';
import { experienceRewardFromPercent } from '../character/progression';
import { getEncounterDifficultyProfile } from '../settings/GameDifficulty';

const THREAT_XP_PERCENT = {
  minor: 10,
  standard: 20,
  major: 35,
  deadly: 50,
} as const;

function combatExperiencePercent(state: CombatEngineState): number {
  if (state.snapshot.intent.policy.lethality === 'nonlethal') return 5;
  const victoryPercent = THREAT_XP_PERCENT[state.snapshot.threatTier];
  if (state.outcome === 'player_victory' || state.outcome === 'enemy_retreat') return victoryPercent;
  if (state.outcome === 'draw') return Math.max(5, Math.round(victoryPercent * 0.5));
  return Math.max(5, Math.round(victoryPercent * 0.3));
}

function cloneCombatant(combatant: CombatRuntimeCombatant): CombatRuntimeCombatant {
  return {
    ...combatant,
    statuses: [...combatant.statuses],
    artUsage: { ...combatant.artUsage },
    itemUsage: { ...combatant.itemUsage },
    itemQuantities: { ...combatant.itemQuantities },
    modifiers: { ...combatant.modifiers },
  };
}

function cloneState(state: CombatEngineState): CombatEngineState {
  return {
    ...state,
    combatants: state.combatants.map(cloneCombatant),
    randomState: { ...state.randomState },
    actionLog: state.actionLog.map((entry) => ({
      ...entry,
      targetIds: [...entry.targetIds],
      values: { ...entry.values },
    })),
    pendingDecision: state.pendingDecision ? {
      ...state.pendingDecision,
      targetActorIds: [...state.pendingDecision.targetActorIds],
    } : undefined,
  };
}

function addStatus(combatant: CombatRuntimeCombatant, statusId: string): void {
  if (!combatant.statuses.includes(statusId)) combatant.statuses.push(statusId);
}

function removeStatus(combatant: CombatRuntimeCombatant, statusId: string): void {
  combatant.statuses = combatant.statuses.filter((candidate) => candidate !== statusId);
}

function isActive(combatant: CombatRuntimeCombatant): boolean {
  return combatant.hp > 0
    && !combatant.statuses.includes('dead')
    && !combatant.statuses.includes('captured')
    && !combatant.statuses.includes('surrendered');
}

function snapshotFor(state: CombatEngineState, actorId: string): CombatantSnapshot {
  const snapshot = state.snapshot.combatants.find((candidate) => candidate.actorId === actorId);
  if (!snapshot) throw new Error(`战斗快照中不存在角色 ${actorId}。`);
  return snapshot;
}

function runtimeFor(state: CombatEngineState, actorId: string): CombatRuntimeCombatant {
  const combatant = state.combatants.find((candidate) => candidate.actorId === actorId);
  if (!combatant) throw new Error(`战斗状态中不存在角色 ${actorId}。`);
  return combatant;
}

function effectiveMartial(state: CombatEngineState, combatant: CombatRuntimeCombatant): number {
  const penalty = combatant.statuses.includes('severely_wounded') ? 15 : 0;
  return clamp(snapshotFor(state, combatant.actorId).martial - penalty, 0, 100);
}

function effectConditionMatches(
  state: CombatEngineState,
  owner: CombatRuntimeCombatant,
  target: CombatRuntimeCombatant | undefined,
  effect: SemanticEffect,
  attacking: boolean,
): boolean {
  switch (effect.condition) {
    case 'always': return true;
    case 'self_hp_below_30': return owner.hp / owner.maxHp < 0.3;
    case 'self_stamina_below_30': return owner.stamina / owner.maxStamina < 0.3;
    case 'target_hp_below_30': return Boolean(target && target.hp / target.maxHp < 0.3);
    case 'outnumbered': {
      const allies = state.combatants.filter((candidate) => candidate.side === owner.side && isActive(candidate)).length;
      const enemies = state.combatants.filter((candidate) => candidate.side !== owner.side && isActive(candidate)).length;
      return enemies > allies;
    }
    case 'defending': return owner.defending;
    case 'attacking': return attacking;
    default: return false;
  }
}

function passiveEffects(state: CombatEngineState, owner: CombatRuntimeCombatant): SemanticEffect[] {
  const snapshot = snapshotFor(state, owner.actorId);
  const passiveUniqueArts = snapshot.uniqueArtProfiles
    .filter((profile) => profile.activation === 'passive' || profile.activation === 'hybrid');
  return [...snapshot.traitProfiles, ...snapshot.equipmentProfiles, ...passiveUniqueArts]
    .flatMap((profile) => profile.effects)
    .slice()
    .sort((left, right) => left.priority - right.priority);
}

function passiveModifier(
  state: CombatEngineState,
  owner: CombatRuntimeCombatant,
  target: CombatRuntimeCombatant | undefined,
  operation: SemanticEffect['operation'],
  triggers: readonly SemanticEffect['trigger'][],
  attacking: boolean,
): number {
  return passiveEffects(state, owner)
    .filter((effect) => triggers.includes(effect.trigger)
      && effect.operation === operation
      && effectConditionMatches(state, owner, target, effect, attacking))
    .reduce((sum, effect) => sum + effect.value, 0);
}

function markDowned(combatant: CombatRuntimeCombatant): void {
  if (combatant.hp > 0) return;
  combatant.hp = 0;
  combatant.downCount = Math.min(2, combatant.downCount + 1);
  combatant.defending = false;
  addStatus(combatant, 'downed');
  if (combatant.downCount >= 2) addStatus(combatant, 'cannot_stabilize');
}

function updateResolution(state: CombatEngineState): void {
  if (state.phase === 'resolved' || state.phase === 'awaiting_disposition') return;
  const playerActive = state.combatants.some((combatant) => combatant.side === 'player' && isActive(combatant));
  const enemyActive = state.combatants.some((combatant) => combatant.side === 'enemy' && isActive(combatant));
  if (playerActive && enemyActive) return;
  state.currentActorId = undefined;
  if (!playerActive && !enemyActive) {
    state.phase = 'resolved';
    state.outcome = 'draw';
    return;
  }
  if (!playerActive) {
    state.phase = 'resolved';
    state.outcome = 'enemy_victory';
    return;
  }
  if (state.snapshot.intent.policy.lethality === 'fatal') {
    state.phase = 'awaiting_disposition';
    state.pendingDecision = {
      kind: 'fatal_disposition',
      targetSide: 'enemy',
      targetActorIds: state.combatants.filter((combatant) => combatant.side === 'enemy').map((combatant) => combatant.actorId),
    };
    return;
  }
  state.phase = 'resolved';
  state.outcome = 'player_victory';
}

function appendLog(
  state: CombatEngineState,
  input: Omit<EncounterActionLogEntry, 'sequence' | 'actionId'>,
): void {
  const sequence = state.actionLog.length + 1;
  state.actionLog.push({
    sequence,
    actionId: `${state.snapshot.sessionId}:action:${sequence}`,
    ...input,
  });
}

export function createCombatEngineState(snapshot: CombatEncounterSnapshot): CombatEngineState {
  const random = new SeededEncounterRandom(snapshot.seed);
  const combatants = snapshot.combatants.map((combatant) => ({
    actorId: combatant.actorId,
    side: combatant.side,
    stableOrder: combatant.stableOrder,
    hp: combatant.hp,
    maxHp: combatant.maxHp,
    stamina: combatant.stamina,
    maxStamina: combatant.maxStamina,
    speed: combatant.speed,
    // A small seeded opening offset removes the permanent player-first bias
    // for equal-speed actors without weakening speed over subsequent turns.
    gauge: random.nextIntInclusive(0, 99),
    defending: false,
    downCount: 0,
    revivedOnce: false,
    statuses: normalizeCombatStatuses(combatant.combatStatuses),
    artUsage: {},
    itemUsage: {},
    itemQuantities: Object.fromEntries(combatant.inventory.map((item) => [item.itemId, item.quantity])),
    modifiers: {
      accuracy: 0,
      evasion: 0,
      block: 0,
      critical: 0,
      damageFlat: 0,
      damageMultiplier: 1,
      armor: 0,
      armorPenetration: 0,
      staminaCost: 0,
      retreat: 0,
    },
  }));
  return {
    snapshot,
    phase: 'advancing',
    combatants,
    randomState: random.snapshot(),
    actionLog: [],
  };
}

export function advanceCombatToNextAction(input: CombatEngineState): CombatEngineState {
  const state = cloneState(input);
  if (state.phase === 'resolved' || state.phase === 'awaiting_disposition') return state;
  if (state.phase === 'awaiting_action') return state;
  state.autoPauseReason = undefined;
  updateResolution(state);
  if (state.phase !== 'advancing' && state.phase !== 'auto_paused') return state;
  state.phase = 'advancing';
  const active = state.combatants.filter(isActive);
  if (active.length === 0) {
    updateResolution(state);
    return state;
  }
  const alreadyReady = active.filter((combatant) => combatant.gauge >= COMBAT_GAUGE_THRESHOLD);
  if (alreadyReady.length === 0) {
    const ticks = Math.min(...active.map((combatant) => Math.ceil((COMBAT_GAUGE_THRESHOLD - combatant.gauge) / combatant.speed)));
    for (const combatant of active) combatant.gauge += combatant.speed * ticks;
  }
  const ready = active
    .filter((combatant) => combatant.gauge >= COMBAT_GAUGE_THRESHOLD)
    .sort((left, right) => {
      const overflowDifference = (right.gauge - COMBAT_GAUGE_THRESHOLD) - (left.gauge - COMBAT_GAUGE_THRESHOLD);
      if (overflowDifference !== 0) return overflowDifference;
      if (right.speed !== left.speed) return right.speed - left.speed;
      return left.stableOrder - right.stableOrder;
    });
  const actor = ready[0];
  if (!actor) throw new Error('速度槽推进后没有可行动角色。');
  applyRoundStartPassiveUniqueArts(state, actor);
  state.phase = 'awaiting_action';
  state.currentActorId = actor.actorId;
  return state;
}

interface StrikeOptions {
  accuracyModifier: number;
  damageMultiplier: number;
  blockable: boolean;
  armorPiercing: boolean;
  canCrit: boolean;
  normalAttack: boolean;
}

function usesCombatV21(state: CombatEngineState): boolean {
  return state.snapshot.intent.rulesetVersion === COMBAT_RULESET_VERSION;
}

function leadershipAura(state: CombatEngineState, side: CombatRuntimeCombatant['side']): number {
  if (!usesCombatV21(state)) return 0;
  const activeAllies = state.combatants.filter((candidate) => candidate.side === side && isActive(candidate));
  if (activeAllies.length < 2) return 0;
  const bestLeadership = Math.max(...activeAllies.map((candidate) => snapshotFor(state, candidate.actorId).leadership ?? 50));
  return clamp(Math.trunc((bestLeadership - 50) / 10), -5, 5);
}

function calculateArtDamage(input: {
  rawDamage: number;
  damageMultiplier: number;
  critical: boolean;
  blocked: boolean;
  defending: boolean;
  armorTier: number;
}): number {
  let damage = input.rawDamage * input.damageMultiplier;
  if (input.critical && !input.blocked) damage *= 1.5;
  if (input.blocked) damage *= input.defending ? 0.2 : 0.4;
  else if (input.defending) damage *= 0.8;
  damage *= 1 - (ARMOR_REDUCTION_BY_TIER[clamp(Math.trunc(input.armorTier), 0, 5)] ?? 0);
  return Math.max(1, Math.round(damage));
}

function performStrike(
  state: CombatEngineState,
  random: SeededEncounterRandom,
  attacker: CombatRuntimeCombatant,
  defender: CombatRuntimeCombatant,
  options: StrikeOptions,
): {
  hit: boolean;
  blocked: boolean;
  critical: boolean;
  damage: number;
  hitChance: number;
  blockChance: number;
  criticalChance: number;
  martialHitModifier: number;
  intelligenceHitModifier: number;
  leadershipAccuracyModifier: number;
  martialDamageBonus: number;
} {
  const attackerSnapshot = snapshotFor(state, attacker.actorId);
  const defenderSnapshot = snapshotFor(state, defender.actorId);
  const attackerMartial = effectiveMartial(state, attacker);
  const defenderMartial = effectiveMartial(state, defender);
  const v21 = usesCombatV21(state);
  const leadershipAccuracyModifier = leadershipAura(state, attacker.side);
  const attackerAccuracy = attacker.modifiers.accuracy + options.accuracyModifier
    + passiveModifier(state, attacker, defender, 'modify_accuracy', ['before_attack'], true)
    + leadershipAccuracyModifier;
  const defenderEvasion = defender.modifiers.evasion
    + passiveModifier(state, defender, attacker, 'modify_evasion', ['before_attack'], false);
  const hitChance = v21 ? calculateV21HitChance({
    attackerMartial,
    defenderMartial,
    attackerIntelligence: attackerSnapshot.intelligence ?? 50,
    defenderIntelligence: defenderSnapshot.intelligence ?? 50,
    weaponAccuracy: attackerSnapshot.weapon.accuracyBonus,
    attackerAccuracy,
    defenderEvasion,
    attackerLuck: attackerSnapshot.luck,
    defenderLuck: defenderSnapshot.luck,
  }) : calculateHitChance({
    attackerMartial,
    defenderMartial,
    weaponAccuracy: attackerSnapshot.weapon.accuracyBonus,
    attackerAccuracy,
    defenderEvasion,
    attackerLuck: attackerSnapshot.luck,
    defenderLuck: defenderSnapshot.luck,
  });
  const martialHitModifier = (attackerMartial - defenderMartial) * (v21 ? 0.60 : 0.55);
  const intelligenceHitModifier = v21
    ? ((attackerSnapshot.intelligence ?? 50) - (defenderSnapshot.intelligence ?? 50)) * 0.10
    : 0;
  const martialDamageBonus = Math.floor(attackerMartial * (v21 ? 0.16 : 0.12));
  const hit = random.nextIntInclusive(1, 100) <= hitChance;
  if (!hit) return {
    hit: false, blocked: false, critical: false, damage: 0, hitChance, blockChance: 0,
    criticalChance: 0, martialHitModifier, intelligenceHitModifier,
    leadershipAccuracyModifier, martialDamageBonus,
  };

  const penetration = attackerSnapshot.weapon.armorPenetration + attacker.modifiers.armorPenetration
    + passiveModifier(state, attacker, defender, 'modify_armor_penetration', ['before_attack'], true);
  const defenderLeadershipAura = leadershipAura(state, defender.side);
  const blockChance = options.blockable ? (v21 ? calculateV21BlockChance({
    attackerMartial,
    defenderMartial,
    attackerIntelligence: attackerSnapshot.intelligence ?? 50,
    defenderIntelligence: defenderSnapshot.intelligence ?? 50,
    equipmentBlock: defenderSnapshot.armor.blockBonus,
    defenderBlock: defender.modifiers.block
      + passiveModifier(state, defender, attacker, 'modify_block', ['before_attack', 'on_block'], false)
      + defenderLeadershipAura,
    defendActionBonus: defender.defending ? 30 : 0,
    attackerPenetration: penetration,
  }) : calculateBlockChance({
    attackerMartial,
    defenderMartial,
    equipmentBlock: defenderSnapshot.armor.blockBonus,
    defenderBlock: defender.modifiers.block
      + passiveModifier(state, defender, attacker, 'modify_block', ['before_attack', 'on_block'], false),
    defendActionBonus: defender.defending ? 30 : 0,
    attackerPenetration: penetration,
  })) : 0;
  const blocked = options.blockable && random.nextIntInclusive(1, 100) <= blockChance;
  const criticalChance = calculateCriticalChance(
    attackerSnapshot.luck,
    defenderSnapshot.luck,
    attacker.modifiers.critical + passiveModifier(state, attacker, defender, 'modify_critical', ['before_attack'], true),
  );
  const critical = options.canCrit && !blocked && random.nextIntInclusive(1, 100) <= criticalChance;
  const variance = random.nextIntInclusive(-2, 2);
  const flatDamage = attacker.modifiers.damageFlat
    + passiveModifier(state, attacker, defender, 'modify_damage_flat', ['before_attack', 'on_hit'], true);
  const passiveMultiplier = attacker.modifiers.damageMultiplier
    * Math.max(0, passiveModifier(state, attacker, defender, 'modify_damage_multiplier', ['before_attack'], true) || 1);
  const armorTier = options.armorPiercing
    ? 0
    : clamp(
      defenderSnapshot.armor.armorTier
        + defender.modifiers.armor
        - Math.floor(Math.max(0, penetration) / 6),
      0,
      5,
    );
  const rawDamage = attackerSnapshot.weapon.baseDamage + martialDamageBonus + flatDamage + variance;
  const scopedBaseCap = attackerSnapshot.combatArchetype
    ? SCOPED_NORMAL_ATTACK_DAMAGE_CAP[attackerSnapshot.combatArchetype]
    : undefined;
  const maxDamage = v21 && scopedBaseCap !== undefined
    ? calculateV21ScopedDamageCap(scopedBaseCap, attackerMartial)
    : scopedBaseCap;
  const normalDamageInput = {
    weaponBaseDamage: attackerSnapshot.weapon.baseDamage,
    attackerMartial,
    flatDamage,
    randomVariance: variance,
    critical,
    blocked,
    defenderWasDefending: defender.defending,
    armorTier,
    maxDamage,
  };
  const baseDamage = options.normalAttack ? (v21
    ? calculateV21NormalAttackDamage(normalDamageInput)
    : calculateNormalAttackDamage(normalDamageInput)) : calculateArtDamage({
    rawDamage,
    damageMultiplier: options.damageMultiplier * passiveMultiplier,
    critical,
    blocked,
    defending: defender.defending,
    armorTier,
  });
  const playerPowerMultiplier = getEncounterDifficultyProfile(
    'combat',
    state.snapshot.combatDifficulty,
  ).playerPowerMultiplier;
  const difficultyMultiplier = attacker.side === 'player' && defender.side === 'enemy'
    ? playerPowerMultiplier
    : attacker.side === 'enemy' && defender.side === 'player'
      ? 1 / playerPowerMultiplier
      : 1;
  const damage = Math.max(1, Math.round(baseDamage * difficultyMultiplier));
  const beforeHp = defender.hp;
  defender.hp = Math.max(0, defender.hp - damage);
  if (beforeHp > 0 && defender.hp === 0) markDowned(defender);
  return {
    hit: true, blocked, critical, damage, hitChance, blockChance, criticalChance,
    martialHitModifier, intelligenceHitModifier, leadershipAccuracyModifier, martialDamageBonus,
  };
}

function resolveTargets(
  state: CombatEngineState,
  actor: CombatRuntimeCombatant,
  targetIds: readonly string[],
  art: UniqueArtSemanticProfile,
): CombatRuntimeCombatant[] {
  const activeAllies = state.combatants.filter((candidate) => candidate.side === actor.side && isActive(candidate));
  const activeEnemies = state.combatants.filter((candidate) => candidate.side !== actor.side && isActive(candidate));
  let targets: CombatRuntimeCombatant[];
  switch (art.targetMode) {
    case 'self': targets = [actor]; break;
    case 'single_ally': targets = [runtimeFor(state, targetIds[0] ?? '')]; break;
    case 'all_allies': targets = activeAllies; break;
    case 'single_enemy': targets = [runtimeFor(state, targetIds[0] ?? '')]; break;
    case 'all_enemies': targets = activeEnemies; break;
  }
  if (targets.length === 0) throw new Error(`绝艺 ${art.sourceId} 没有合法目标。`);
  for (const target of targets) {
    const needsAlly = art.targetMode === 'self' || art.targetMode.includes('ally');
    if (needsAlly !== (target.side === actor.side)) throw new Error(`绝艺 ${art.sourceId} 的目标阵营不合法。`);
    if (!isActive(target) && art.purpose !== 'healing') throw new Error(`绝艺 ${art.sourceId} 不能选择倒地目标。`);
  }
  return targets;
}

function modifierKey(operation: SemanticEffect['operation']): keyof CombatRuntimeCombatant['modifiers'] | undefined {
  switch (operation) {
    case 'modify_accuracy': return 'accuracy';
    case 'modify_evasion': return 'evasion';
    case 'modify_block': return 'block';
    case 'modify_critical': return 'critical';
    case 'modify_damage_flat': return 'damageFlat';
    case 'modify_damage_multiplier': return 'damageMultiplier';
    case 'modify_armor': return 'armor';
    case 'modify_armor_penetration': return 'armorPenetration';
    case 'modify_stamina_cost': return 'staminaCost';
    case 'modify_retreat': return 'retreat';
    default: return undefined;
  }
}

function applyExecutableEffects(target: CombatRuntimeCombatant, effects: readonly SemanticEffect[]): void {
  for (const effect of [...effects].sort((left, right) => left.priority - right.priority)) {
    switch (effect.operation) {
      case 'restore_hp':
        if (target.hp > 0) target.hp = Math.min(target.maxHp, target.hp + Math.max(0, Math.round(effect.value)));
        break;
      case 'restore_stamina':
        target.stamina = Math.min(target.maxStamina, target.stamina + Math.max(0, Math.round(effect.value)));
        break;
      case 'restore_hp_to_max':
        if (target.hp > 0) target.hp = target.maxHp;
        break;
      case 'restore_stamina_to_max':
        target.stamina = target.maxStamina;
        break;
      case 'apply_status':
        if (effect.statusId) addStatus(target, effect.statusId);
        break;
      case 'remove_status':
        if (effect.statusId) removeStatus(target, effect.statusId);
        break;
      default: {
        const key = modifierKey(effect.operation);
        if (key) target.modifiers[key] += effect.value;
      }
    }
  }
}

function applyRoundStartPassiveUniqueArts(
  state: CombatEngineState,
  actor: CombatRuntimeCombatant,
): void {
  const profiles = snapshotFor(state, actor.actorId).uniqueArtProfiles
    .filter((profile) => profile.activation === 'passive' || profile.activation === 'hybrid');
  let restoredHp = 0;
  let restoredStamina = 0;
  for (const profile of profiles) {
    for (const effect of [...profile.effects].sort((left, right) => left.priority - right.priority)) {
      if (effect.trigger !== 'round_start'
        || (effect.operation !== 'restore_hp' && effect.operation !== 'restore_stamina')
        || (effect.target !== 'self' && effect.target !== 'current_attacker')
        || !effectConditionMatches(state, actor, actor, effect, false)) {
        continue;
      }
      if (effect.operation === 'restore_hp') {
        if (actor.hp <= 0 || restoredHp >= 25) continue;
        const before = actor.hp;
        applyExecutableEffects(actor, [{ ...effect, value: Math.min(effect.value, 25 - restoredHp) }]);
        restoredHp += actor.hp - before;
      } else {
        if (restoredStamina >= 25) continue;
        const before = actor.stamina;
        applyExecutableEffects(actor, [{ ...effect, value: Math.min(effect.value, 25 - restoredStamina) }]);
        restoredStamina += actor.stamina - before;
      }
    }
  }
}

function resolveEffectTargets(
  state: CombatEngineState,
  actor: CombatRuntimeCombatant,
  suppliedTargetIds: readonly string[],
  effect: SemanticEffect,
): CombatRuntimeCombatant[] {
  const supplied = suppliedTargetIds.map((targetId) => runtimeFor(state, targetId));
  const activeAllies = state.combatants.filter((candidate) => candidate.side === actor.side && isActive(candidate));
  const activeEnemies = state.combatants.filter((candidate) => candidate.side !== actor.side && isActive(candidate));
  switch (effect.target) {
    case 'self':
    case 'current_attacker':
      if (supplied.length > 0 && (supplied.length !== 1 || supplied[0].actorId !== actor.actorId)) {
        throw new Error(`效果 ${effect.operation} 的目标只能是使用者自身。`);
      }
      return [actor];
    case 'single_ally': {
      if (supplied.length !== 1 || supplied[0].side !== actor.side || !isActive(supplied[0])) {
        throw new Error(`效果 ${effect.operation} 需要一个有效己方目标。`);
      }
      return supplied;
    }
    case 'single_enemy':
    case 'current_defender': {
      if (supplied.length !== 1 || supplied[0].side === actor.side || !isActive(supplied[0])) {
        throw new Error(`效果 ${effect.operation} 需要一个有效敌方目标。`);
      }
      return supplied;
    }
    case 'all_allies':
    case 'own_force':
      return activeAllies;
    case 'all_enemies':
    case 'enemy_force':
      return activeEnemies;
  }
}

export function executeCombatAction(input: CombatEngineState, action: CombatAction): CombatEngineState {
  const state = cloneState(input);
  if (state.phase !== 'awaiting_action' || state.currentActorId !== action.actorId) {
    throw new Error(`当前不轮到 ${action.actorId} 行动。`);
  }
  const actor = runtimeFor(state, action.actorId);
  if (!isActive(actor)) throw new Error(`${action.actorId} 当前不能行动。`);
  const random = SeededEncounterRandom.fromSnapshot(state.randomState);
  const randomDrawStart = random.draws;
  actor.gauge = Math.max(0, actor.gauge - COMBAT_GAUGE_THRESHOLD);
  actor.defending = false;
  let targetIds: string[] = [];
  let summaryKey = '';
  const values: EncounterActionLogEntry['values'] = {};

  switch (action.type) {
    case 'normal_attack': {
      const target = runtimeFor(state, action.targetId);
      if (target.side === actor.side || !isActive(target)) throw new Error('普通攻击目标不合法。');
      targetIds = [target.actorId];
      const strike = performStrike(state, random, actor, target, {
        accuracyModifier: 0,
        damageMultiplier: 1,
        blockable: true,
        armorPiercing: false,
        canCrit: true,
        normalAttack: true,
      });
      Object.assign(values, strike);
      summaryKey = strike.hit ? 'combat.normal_attack.hit' : 'combat.normal_attack.miss';
      break;
    }
    case 'defend':
      actor.defending = true;
      actor.stamina = Math.min(actor.maxStamina, actor.stamina + 6);
      values.staminaRestored = 6;
      summaryKey = 'combat.defend';
      break;
    case 'unique_art': {
      const art = snapshotFor(state, actor.actorId).uniqueArtProfiles.find((candidate) => candidate.sourceId === action.artId);
      if (!art) throw new Error(`绝艺 ${action.artId} 没有可执行投影。`);
      if (art.activation === 'passive') throw new Error(`被动绝艺 ${action.artId} 不能作为主动行动使用。`);
      const used = actor.artUsage[art.sourceId] ?? 0;
      if (used >= art.perEncounterLimit) throw new Error(`绝艺 ${art.sourceId} 已达到本场使用次数。`);
      const staminaCost = Math.max(0, Math.round(art.staminaCost + actor.modifiers.staminaCost));
      if (actor.stamina < staminaCost) throw new Error(`使用绝艺 ${art.sourceId} 的体力不足。`);
      const targets = resolveTargets(state, actor, action.targetIds, art);
      targetIds = targets.map((target) => target.actorId);
      actor.stamina -= staminaCost;
      actor.artUsage[art.sourceId] = used + 1;
      let hitsLanded = 0;
      let blockedHits = 0;
      let criticalHits = 0;
      let totalDamage = 0;
      let attributeStrike: ReturnType<typeof performStrike> | undefined;
      if (art.purpose === 'damage' || art.purpose === 'mixed') {
        const damageTargets = targets.filter((target) => target.side !== actor.side && isActive(target));
        for (let hitIndex = 0; hitIndex < art.maxHits; hitIndex += 1) {
          const target = damageTargets[hitIndex % damageTargets.length];
          if (!target || !isActive(target)) continue;
          const strike = performStrike(state, random, actor, target, {
            accuracyModifier: art.accuracyModifier,
            damageMultiplier: art.powerMultiplier / art.maxHits,
            blockable: art.blockable,
            armorPiercing: art.armorPiercing,
            canCrit: art.canCrit,
            normalAttack: false,
          });
          attributeStrike ??= strike;
          if (strike.hit) hitsLanded += 1;
          if (strike.blocked) blockedHits += 1;
          if (strike.critical) criticalHits += 1;
          totalDamage += strike.damage;
        }
      }
      if (art.purpose !== 'damage') {
        for (const effect of art.effects) {
          const effectTargets = effect.target === 'self' || effect.target === 'current_attacker'
            ? [actor]
            : targets;
          for (const target of effectTargets) applyExecutableEffects(target, [effect]);
        }
      }
      Object.assign(values, {
        artId: art.sourceId,
        staminaCost,
        hitsAttempted: art.maxHits,
        hitsLanded,
        blockedHits,
        criticalHits,
        totalDamage,
        ...(attributeStrike ? {
          hitChance: attributeStrike.hitChance,
          blockChance: attributeStrike.blockChance,
          criticalChance: attributeStrike.criticalChance,
          martialHitModifier: attributeStrike.martialHitModifier,
          intelligenceHitModifier: attributeStrike.intelligenceHitModifier,
          leadershipAccuracyModifier: attributeStrike.leadershipAccuracyModifier,
          martialDamageBonus: attributeStrike.martialDamageBonus,
        } : {}),
      });
      summaryKey = 'combat.unique_art';
      break;
    }
    case 'use_item': {
      const item = snapshotFor(state, actor.actorId).itemProfiles.find((candidate) => candidate.sourceId === action.itemId);
      if (!item || !item.combatUse) throw new Error(`物品 ${action.itemId} 没有可执行 combatUse 投影。`);
      const used = actor.itemUsage[item.sourceId] ?? 0;
      if (used >= item.perEncounterLimit) throw new Error(`物品 ${item.sourceId} 已达到本场使用次数。`);
      const quantity = actor.itemQuantities[item.sourceId] ?? 0;
      if (quantity < item.quantityPerUse) throw new Error(`物品 ${item.sourceId} 数量不足。`);
      if (item.effects.length === 0) throw new Error(`物品 ${item.sourceId} 没有可执行效果。`);
      const affectedTargetIds = new Set<string>();
      for (const effect of [...item.effects].sort((left, right) => left.priority - right.priority)) {
        const effectTargets = resolveEffectTargets(state, actor, action.targetIds, effect);
        for (const target of effectTargets) {
          applyExecutableEffects(target, [effect]);
          affectedTargetIds.add(target.actorId);
        }
      }
      if (item.consumable) actor.itemQuantities[item.sourceId] = quantity - item.quantityPerUse;
      actor.itemUsage[item.sourceId] = used + 1;
      targetIds = [...affectedTargetIds];
      Object.assign(values, { itemId: item.sourceId, quantityUsed: item.consumable ? item.quantityPerUse : 0 });
      summaryKey = 'combat.use_item';
      break;
    }
    case 'stabilize': {
      const target = runtimeFor(state, action.targetId);
      if (target.side !== actor.side || target.hp !== 0 || target.downCount === 0) throw new Error('救援目标不是己方倒地角色。');
      if (target.downCount >= 2) throw new Error('角色第二次倒地后本场不能再次救援。');
      if (target.revivedOnce) throw new Error('角色本场已经接受过一次救援。');
      if (!canStabilizeAlly(actor, target)) {
        throw new Error(`救援者生命必须高于 ${COMBAT_STABILIZE_HP_COST} 点，才能承担援护代价。`);
      }
      actor.hp -= COMBAT_STABILIZE_HP_COST;
      target.hp = COMBAT_STABILIZE_HP_RESTORE;
      target.stamina = COMBAT_STABILIZE_STAMINA_RESTORE;
      target.revivedOnce = true;
      target.speed = Math.max(60, target.speed - 15);
      removeStatus(target, 'downed');
      addStatus(target, 'severely_wounded');
      targetIds = [target.actorId];
      Object.assign(values, {
        rescuerHpSpent: COMBAT_STABILIZE_HP_COST,
        hpRestored: COMBAT_STABILIZE_HP_RESTORE,
        staminaRestored: COMBAT_STABILIZE_STAMINA_RESTORE,
      });
      summaryKey = 'combat.stabilize';
      break;
    }
    case 'retreat': {
      if (!state.snapshot.intent.policy.allowRetreat) throw new Error('本场冲突不允许撤退。');
      const own = state.combatants.filter((candidate) => candidate.side === actor.side);
      const enemy = state.combatants.filter((candidate) => candidate.side !== actor.side);
      const ownActive = own.filter(isActive);
      const enemyActive = enemy.filter(isActive);
      const ownAverageSpeed = ownActive.reduce((sum, candidate) => sum + candidate.speed, 0) / Math.max(1, ownActive.length);
      const enemyAverageSpeed = enemyActive.reduce((sum, candidate) => sum + candidate.speed, 0) / Math.max(1, enemyActive.length);
      const modifier = actor.modifiers.retreat
        + passiveModifier(state, actor, undefined, 'modify_retreat', ['on_retreat_check'], false);
      const chance = calculateRetreatChance({
        ownAverageSpeed,
        enemyAverageSpeed,
        ownDowned: own.filter((candidate) => candidate.downCount > 0).length,
        modifier,
      });
      const roll = random.nextIntInclusive(1, 100);
      const success = roll <= chance;
      Object.assign(values, { chance, roll, success });
      if (success) {
        state.phase = 'resolved';
        state.outcome = actor.side === 'player' ? 'player_retreat' : 'enemy_retreat';
      } else {
        for (const combatant of ownActive) {
          combatant.stamina = Math.max(0, combatant.stamina - 8);
          addStatus(combatant, 'retreat_failed');
        }
      }
      summaryKey = success ? 'combat.retreat.success' : 'combat.retreat.failure';
      break;
    }
    case 'surrender':
      if (!state.snapshot.intent.policy.allowSurrender) throw new Error('本场冲突不允许投降。');
      targetIds = state.combatants.filter((candidate) => candidate.side === actor.side).map((candidate) => candidate.actorId);
      if (actor.side === 'enemy') {
        state.phase = 'awaiting_disposition';
        state.pendingDecision = { kind: 'enemy_surrender', targetSide: 'enemy', targetActorIds: targetIds };
      } else {
        for (const combatant of state.combatants.filter((candidate) => candidate.side === 'player')) addStatus(combatant, 'surrendered');
        state.phase = 'resolved';
        state.outcome = 'surrender';
      }
      summaryKey = 'combat.surrender';
      break;
  }

  state.randomState = random.snapshot();
  appendLog(state, {
    actorId: actor.actorId,
    targetIds,
    actionType: action.type,
    randomDrawStart,
    randomDrawEnd: random.draws,
    summaryKey,
    values,
  });
  if (state.phase === 'awaiting_action') state.phase = 'advancing';
  state.currentActorId = undefined;
  updateResolution(state);
  return state;
}

export function resolveCombatDecision(input: CombatEngineState, decision: CombatDecision): CombatEngineState {
  const state = cloneState(input);
  if (state.phase !== 'awaiting_disposition' || !state.pendingDecision) throw new Error('当前没有待处理的战斗处置。');
  const pending = state.pendingDecision;
  const targets = pending.targetActorIds.map((actorId) => runtimeFor(state, actorId));
  if (pending.kind === 'fatal_disposition') {
    if (decision.choice === 'kill') {
      if (state.snapshot.intent.policy.lethality !== 'fatal') throw new Error('非 fatal 冲突不能执行致死处置。');
      for (const target of targets.filter((candidate) => candidate.hp === 0)) addStatus(target, 'dead');
    } else if (decision.choice === 'capture') {
      if (!state.snapshot.intent.policy.allowCapture) throw new Error('本场冲突不允许俘虏。');
      for (const target of targets) addStatus(target, 'captured');
    } else if (decision.choice !== 'spare') {
      throw new Error('致死处置只能选择 spare / capture / kill。');
    }
    state.outcome = 'player_victory';
    state.phase = 'resolved';
  } else {
    if (decision.choice === 'reject_surrender') {
      state.phase = 'advancing';
    } else if (decision.choice === 'accept_surrender') {
      for (const target of targets) addStatus(target, state.snapshot.intent.policy.allowCapture ? 'captured' : 'surrendered');
      state.outcome = 'surrender';
      state.phase = 'resolved';
    } else {
      throw new Error('投降处置只能选择 accept_surrender / reject_surrender。');
    }
  }
  state.pendingDecision = undefined;
  return state;
}

function elapsedMinutes(actionCount: number): number {
  if (actionCount <= 12) return 15;
  if (actionCount <= 30) return 30;
  return 45;
}

export function finalizeCombatResult(
  state: CombatEngineState,
  resolvedAt: string,
  options: { playerActorId: string },
): SealedEncounterResult<UnsealedCombatResult> {
  if (state.phase !== 'resolved' || !state.outcome) throw new Error('战斗尚未形成可封存结果。');
  const victory = state.outcome === 'player_victory';
  const rewardEligible = victory && state.snapshot.intent.policy.lethality !== 'nonlethal';
  const playerCombatant = state.snapshot.combatants.find((combatant) => (
    combatant.actorId === options.playerActorId && combatant.side === 'player'
  ));
  if (!playerCombatant) {
    throw new Error(`Combat V2 结算找不到当前玩家 ${options.playerActorId} 的我方快照。`);
  }
  const experienceAward = experienceRewardFromPercent(
    playerCombatant.level,
    combatExperiencePercent(state),
  );
  const deltas: UnsealedCombatResult['deltas'] = [];
  for (const initial of state.snapshot.combatants) {
    if (!initial.persistent) continue;
    const current = runtimeFor(state, initial.actorId);
    for (const [field, beforeValue, afterValue] of [
      ['vitals.hp', initial.hp, current.hp],
      ['vitals.stamina', initial.stamina, current.stamina],
      [
        'combatStatuses',
        normalizeCombatStatuses(initial.combatStatuses),
        normalizeCombatStatuses(current.statuses),
      ],
    ] as const) {
      if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
      deltas.push({
        idempotencyKey: `${state.snapshot.sessionId}:actor:${initial.actorId}:${field}`,
        targetKind: 'actor',
        targetId: initial.actorId,
        field,
        operation: 'set',
        beforeValue,
        afterValue,
      });
    }
    for (const item of initial.inventory) {
      const afterQuantity = current.itemQuantities[item.itemId] ?? 0;
      if (item.quantity === afterQuantity) continue;
      deltas.push({
        idempotencyKey: `${state.snapshot.sessionId}:item:${item.itemId}:quantity`,
        targetKind: 'item',
        targetId: item.itemId,
        field: 'quantity',
        operation: 'set',
        beforeValue: item.quantity,
        afterValue: afterQuantity,
      });
    }
  }
  if (experienceAward > 0) {
    deltas.push({
      idempotencyKey: `${state.snapshot.sessionId}:actor:${playerCombatant.actorId}:xp`,
      targetKind: 'actor',
      targetId: playerCombatant.actorId,
      field: 'xp',
      operation: 'increment',
      beforeValue: playerCombatant.xp,
      afterValue: playerCombatant.xp + experienceAward,
    });
  }
  const allowLoot = rewardEligible && state.snapshot.intent.policy.lootPolicy === 'actual_items_only';
  const result: UnsealedCombatResult = {
    contractVersion: ENCOUNTER_CONTRACT_VERSION,
    sessionId: state.snapshot.sessionId,
    encounterId: state.snapshot.intent.encounterId,
    kind: 'personal_combat',
    rulesetVersion: state.snapshot.intent.rulesetVersion,
    sourceTurnNumber: state.snapshot.intent.sourceTurnNumber,
    seed: state.snapshot.seed,
    resolvedAt,
    outcome: state.outcome,
    elapsedMinutes: elapsedMinutes(state.actionLog.length),
    actionLog: state.actionLog.map((entry) => ({ ...entry, targetIds: [...entry.targetIds], values: { ...entry.values } })),
    deltas,
    combatants: state.combatants.map((combatant) => ({
      actorId: combatant.actorId,
      side: combatant.side,
      hp: combatant.hp,
      stamina: combatant.stamina,
      downCount: combatant.downCount,
      statuses: [...combatant.statuses].sort(),
    })),
    experienceAward,
    lootItemIds: allowLoot ? [...state.snapshot.lootableItemIds] : [],
    capturedEquipmentItemIds: allowLoot ? [...state.snapshot.capturableEquipmentItemIds] : [],
  };
  assertValidEncounterResultPayload(result);
  return sealEncounterResult(result);
}
