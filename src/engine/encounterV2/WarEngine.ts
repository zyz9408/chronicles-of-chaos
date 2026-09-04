import {
  assertValidEncounterResultPayload,
} from './EncounterContractValidation';
import {
  SeededEncounterRandom,
  hashCanonicalValue,
  sealEncounterResult,
} from './EncounterDeterminism';
import {
  AGGRESSIVE_WAR_RULESET_VERSION,
  BALANCED_WAR_RULESET_VERSION,
  LEGACY_WAR_RULESET_VERSION,
  REBALANCED_WAR_RULESET_VERSION,
  THEATER_WAR_RULESET_VERSION,
  WAR_RULESET_VERSION,
  type EncounterActionLogEntry,
  type EncounterSide,
  type JsonPrimitive,
  type SealedEncounterResult,
  type SemanticEffect,
  type UnsealedWarResult,
  type UniqueArtPowerClass,
  type UniqueArtSemanticProfile,
  type WarCommanderResultState,
} from './EncounterContracts';
import {
  calculateWarCasualtyRate,
  calculateWarCommanderFactor,
  calculateWarV24CommanderFactor,
  calculateWarEffectiveStrength,
  calculateWarRetreatChance,
  calculateWarShockMoralePenalty,
  calculateWarIntelligenceTacticFactor,
  calculateWarMartialPressureFactor,
  clampWarValue,
  compareWarTactics,
  resolveWarEngagedStrengths,
  resolveWarRoundLimitOutcome,
  resolveWarTacticCoefficients,
  troopEnvironmentFactor,
  troopMatchupFactor,
  warMoraleCasualtyExposure,
} from './WarRules';
import {
  WAR_TACTICS,
  type WarDecision,
  type WarEngineState,
  type WarEncounterSnapshot,
  type WarExitReason,
  type WarForceSnapshot,
  type WarRoundOrder,
  type WarRoundOrders,
  type WarRuntimeForce,
  type WarTactic,
} from './WarTypes';
import { experienceRewardFromPercent } from '../character/progression';
import { getEncounterDifficultyProfile } from '../settings/GameDifficulty';

const WAR_EFFECT_OPERATIONS = new Set([
  'modify_morale',
  'modify_supply',
  'modify_fatigue',
  'modify_casualty_rate',
  'modify_effective_strength',
  'apply_status',
  'remove_status',
]);

interface WarEffectEntry {
  sourceId: string;
  sourceSide: EncounterSide;
  index: number;
  effect: SemanticEffect;
  artPowerClass?: UniqueArtPowerClass;
}

interface RoundEffectTotals {
  effectiveStrength: Record<EncounterSide, number>;
  casualtyRate: Record<EncounterSide, number>;
  morale: Record<EncounterSide, number>;
  supply: Record<EncounterSide, number>;
  fatigue: Record<EncounterSide, number>;
  percentLimit: Record<EncounterSide, number>;
  directLimit: Record<EncounterSide, number>;
  addStatuses: Record<EncounterSide, string[]>;
  removeStatuses: Record<EncounterSide, string[]>;
}

function otherSide(side: EncounterSide): EncounterSide {
  return side === 'player' ? 'enemy' : 'player';
}

function cloneState(state: WarEngineState): WarEngineState {
  return {
    ...state,
    forces: state.forces.map((force) => ({ ...force, statuses: [...force.statuses] })),
    usedWarArt: { ...state.usedWarArt },
    effectUsage: { ...state.effectUsage },
    randomState: { ...state.randomState },
    actionLog: state.actionLog.map((entry) => ({
      ...entry,
      targetIds: [...entry.targetIds],
      values: { ...entry.values },
    })),
    ...(state.pendingDecision ? { pendingDecision: { ...state.pendingDecision } } : {}),
    pursuit: { ...state.pursuit },
  };
}

function randomFromState(state: WarEngineState): SeededEncounterRandom {
  return SeededEncounterRandom.fromSnapshot(state.randomState);
}

function snapshotsByTroopId(snapshot: WarEncounterSnapshot) {
  return new Map(snapshot.forces.map((force) => [force.troopId, force] as const));
}

function activeForce(force: WarRuntimeForce): boolean {
  return force.remainingStrength > 0 && force.lifecycleStatus === 'active';
}

function sideForces(state: WarEngineState, side: EncounterSide): WarRuntimeForce[] {
  return state.forces.filter((force) => force.side === side);
}

function activeSideForces(state: WarEngineState, side: EncounterSide): WarRuntimeForce[] {
  return sideForces(state, side).filter(activeForce);
}

function weightedAverage(
  forces: WarRuntimeForce[],
  selector: (force: WarRuntimeForce) => number,
): number {
  const totalWeight = forces.reduce((sum, force) => sum + Math.max(0, force.remainingStrength), 0);
  if (totalWeight <= 0) return 0;
  return forces.reduce((sum, force) => sum + selector(force) * force.remainingStrength, 0) / totalWeight;
}

function commanderScore(state: WarEngineState, side: EncounterSide): number {
  return state.snapshot.commanders[side]?.weightedScore ?? 50;
}

const AGGRESSIVE_WAR_ART_EFFECT_LIMITS: Readonly<Record<UniqueArtPowerClass, {
  percent: number;
  direct: number;
}>> = Object.freeze({
  light: { percent: 40, direct: 15 },
  standard: { percent: 110, direct: 20 },
  heavy: { percent: 180, direct: 35 },
  ultimate: { percent: 280, direct: 50 },
});

const ENHANCED_WAR_ART_EFFECT_LIMITS: Readonly<Record<UniqueArtPowerClass, {
  percent: number;
  direct: number;
}>> = Object.freeze({
  light: { percent: 60, direct: 18 },
  standard: { percent: 150, direct: 25 },
  heavy: { percent: 240, direct: 45 },
  ultimate: { percent: 360, direct: 65 },
});

function usesWarV22(state: WarEngineState): boolean {
  return state.snapshot.intent.rulesetVersion === BALANCED_WAR_RULESET_VERSION
    || state.snapshot.intent.rulesetVersion === THEATER_WAR_RULESET_VERSION
    || state.snapshot.intent.rulesetVersion === AGGRESSIVE_WAR_RULESET_VERSION
    || state.snapshot.intent.rulesetVersion === REBALANCED_WAR_RULESET_VERSION
    || state.snapshot.intent.rulesetVersion === WAR_RULESET_VERSION;
}

function usesAggressiveCommandModel(state: WarEngineState): boolean {
  return state.snapshot.intent.rulesetVersion === AGGRESSIVE_WAR_RULESET_VERSION
    || state.snapshot.intent.rulesetVersion === REBALANCED_WAR_RULESET_VERSION
    || state.snapshot.intent.rulesetVersion === WAR_RULESET_VERSION;
}

function usesRebalancedCommandModel(state: WarEngineState): boolean {
  return state.snapshot.intent.rulesetVersion === REBALANCED_WAR_RULESET_VERSION
    || state.snapshot.intent.rulesetVersion === WAR_RULESET_VERSION;
}

function usesAttributeCommandModel(state: WarEngineState): boolean {
  return state.snapshot.intent.rulesetVersion === WAR_RULESET_VERSION;
}

function commanderFactor(state: WarEngineState, side: EncounterSide): number {
  const commander = state.snapshot.commanders[side];
  if (state.snapshot.intent.rulesetVersion === LEGACY_WAR_RULESET_VERSION) {
    return 0.75 + clampWarValue(commander?.weightedScore ?? 50, 0, 100) / 200;
  }
  if (!usesAggressiveCommandModel(state)) {
    if (!commander) return 0.80;
    if (!commander.leadershipKnown) return 0.90;
    return Number(clampWarValue(0.70 + commander.leadership * 0.006, 0.75, 1.30).toFixed(2));
  }
  const input = {
    commanderPresent: Boolean(commander),
    leadership: commander?.leadership,
    leadershipKnown: commander?.leadershipKnown,
  };
  return usesRebalancedCommandModel(state)
    ? calculateWarCommanderFactor(input)
    : calculateWarV24CommanderFactor(input);
}

function commanderCasualtyModifierPercent(state: WarEngineState, side: EncounterSide): number {
  if (!usesAggressiveCommandModel(state)) return 0;
  const own = commanderFactor(state, side);
  const enemy = commanderFactor(state, otherSide(side));
  const coefficient = usesRebalancedCommandModel(state) ? 8 : 10;
  const limit = usesRebalancedCommandModel(state) ? 16 : 20;
  return Number(clampWarValue((enemy - own) * coefficient, -limit, limit).toFixed(2));
}

function commanderMoraleDelta(state: WarEngineState, side: EncounterSide): number {
  if (!usesAggressiveCommandModel(state)) return 0;
  const advantage = commanderFactor(state, side) - commanderFactor(state, otherSide(side));
  const coefficient = usesRebalancedCommandModel(state) ? 1.2 : 1.5;
  const limit = usesRebalancedCommandModel(state) ? 3 : 4;
  return Math.round(clampWarValue(advantage * coefficient, -limit, limit));
}

function intelligenceTacticFactor(
  state: WarEngineState,
  side: EncounterSide,
  order: WarRoundOrder,
): number {
  if (!usesAttributeCommandModel(state)) return 1;
  const own = state.snapshot.commanders[side]?.intelligence ?? 50;
  const enemy = state.snapshot.commanders[otherSide(side)]?.intelligence ?? 50;
  return calculateWarIntelligenceTacticFactor({
    ownIntelligence: own,
    enemyIntelligence: enemy,
    tactic: coefficientTactic(order),
  });
}

function martialPressureFactor(
  state: WarEngineState,
  side: EncounterSide,
  order: WarRoundOrder,
): number {
  if (!usesAttributeCommandModel(state)) return 1;
  const own = state.snapshot.commanders[side]?.martial ?? 50;
  const enemy = state.snapshot.commanders[otherSide(side)]?.martial ?? 50;
  return calculateWarMartialPressureFactor({
    ownMartial: own,
    enemyMartial: enemy,
    tactic: coefficientTactic(order),
  });
}

function martialMoralePressure(
  state: WarEngineState,
  attackingSide: EncounterSide,
  order: WarRoundOrder,
): number {
  const factor = martialPressureFactor(state, attackingSide, order);
  return factor <= 1 ? 0 : Math.round(clampWarValue((factor - 1) * 50, 0, 5));
}

function sideCommandSources(state: WarEngineState, side: EncounterSide) {
  return [
    ...(state.snapshot.commanders[side] ? [state.snapshot.commanders[side]!] : []),
    ...(state.snapshot.officers?.[side] ?? []),
  ];
}

function findWarArt(state: WarEngineState, side: EncounterSide, artId: string) {
  for (const source of sideCommandSources(state, side)) {
    const profile = source.uniqueArtProfiles.find((candidate) => candidate.sourceId === artId);
    if (profile) return { source, profile };
  }
  return undefined;
}

function mobilityScoreForSnapshot(
  primaryClass: WarEncounterSnapshot['forces'][number]['primaryClass'],
  tags: readonly string[],
  water: boolean,
): number {
  if (tags.includes('mobile')) return 1;
  if (primaryClass === 'cavalry') return water ? 0.35 : 0.95;
  if (primaryClass === 'naval') return water ? 1 : 0.25;
  if (primaryClass === 'mixed') return 0.5;
  if (primaryClass === 'ranged') return 0.4;
  return 0.3;
}

function sideMobility(state: WarEngineState, side: EncounterSide): number {
  const snapshots = snapshotsByTroopId(state.snapshot);
  const forces = activeSideForces(state, side);
  return weightedAverage(forces, (force) => {
    const snapshot = snapshots.get(force.troopId);
    return snapshot
      ? mobilityScoreForSnapshot(
          snapshot.primaryClass,
          snapshot.tags,
          state.snapshot.environmentTags.includes('water'),
        )
      : 0.3;
  });
}

function orderTactic(order: WarRoundOrder): WarTactic | undefined {
  return order.type === 'tactic' ? order.tactic : undefined;
}

function coefficientTactic(order: WarRoundOrder): WarTactic {
  return order.type === 'tactic' ? order.tactic : 'steady_advance';
}

function orderKey(order: WarRoundOrder): string {
  return order.type === 'tactic' ? order.tactic : `war_art:${order.artId}`;
}

function validWarArt(profile: UniqueArtSemanticProfile): boolean {
  return profile.status === 'executable'
    && profile.rulesetScopes.includes('war')
    && profile.effects.some((effect) => WAR_EFFECT_OPERATIONS.has(effect.operation)
      && ['war_round_start', 'before_war_resolution', 'after_war_resolution'].includes(effect.trigger)
      && (effect.target === 'own_force' || effect.target === 'enemy_force'));
}

function validateRoundOrder(state: WarEngineState, side: EncounterSide, order: WarRoundOrder): void {
  if (order.type === 'tactic') {
    if (!(WAR_TACTICS as readonly string[]).includes(order.tactic)) {
      throw new Error(`未知战争战术：${String(order.tactic)}。`);
    }
    return;
  }
  if (state.usedWarArt[side]) throw new Error(`${side} 每场战争只能使用一次战争绝艺。`);
  const art = findWarArt(state, side, order.artId);
  if (!art || !validWarArt(art.profile)) {
    throw new Error(`${side} 的战争绝艺 ${order.artId} 不存在或没有可执行战争投影。`);
  }
}

function effectConditionApplies(
  state: WarEngineState,
  sourceSide: EncounterSide,
  order: WarRoundOrder,
  effect: SemanticEffect,
): boolean {
  const sourceForces = activeSideForces(state, sourceSide);
  const otherForces = activeSideForces(state, otherSide(sourceSide));
  const morale = weightedAverage(sourceForces, (force) => force.morale);
  const supply = weightedAverage(sourceForces, (force) => force.supply);
  switch (effect.condition) {
    case 'always': return true;
    case 'low_morale': return morale < 25;
    case 'low_supply': return supply < 25;
    case 'water_environment': return state.snapshot.environmentTags.includes('water');
    case 'fortified_environment': return state.snapshot.environmentTags.includes('fortified');
    case 'outnumbered':
      return sourceForces.reduce((sum, force) => sum + force.remainingStrength, 0)
        < otherForces.reduce((sum, force) => sum + force.remainingStrength, 0);
    case 'attacking': return coefficientTactic(order) !== 'hold_position';
    case 'defending': return coefficientTactic(order) === 'hold_position';
    default: return false;
  }
}

function effectTargetSide(sourceSide: EncounterSide, effect: SemanticEffect): EncounterSide | undefined {
  if (effect.target === 'own_force') return sourceSide;
  if (effect.target === 'enemy_force') return otherSide(sourceSide);
  return undefined;
}

function allEffectEntries(
  state: WarEngineState,
  orders: WarRoundOrders,
): WarEffectEntry[] {
  const entries: WarEffectEntry[] = [];
  const runtimeByTroopId = new Map(state.forces.map((force) => [force.troopId, force] as const));
  for (const force of state.snapshot.forces) {
    const runtimeForce = runtimeByTroopId.get(force.troopId);
    if (!runtimeForce || !activeForce(runtimeForce)) continue;
    force.troopProfile?.effects.forEach((effect, index) => {
      entries.push({ sourceId: force.troopProfile!.sourceId, sourceSide: force.side, index, effect });
    });
  }
  for (const side of ['player', 'enemy'] as const) {
    for (const commandSource of sideCommandSources(state, side)) {
      for (const profile of commandSource.traitProfiles) {
        profile.effects.forEach((effect, index) => {
          entries.push({ sourceId: profile.sourceId, sourceSide: side, index, effect });
        });
      }
    }
    const order = orders[side];
    if (order.type === 'war_art') {
      const art = findWarArt(state, side, order.artId)?.profile;
      art?.effects.forEach((effect, index) => {
        entries.push({
          sourceId: art.sourceId,
          sourceSide: side,
          index,
          effect,
          ...(usesAggressiveCommandModel(state) ? { artPowerClass: art.powerClass } : {}),
        });
      });
    }
  }
  return entries;
}

function emptyRoundEffectTotals(): RoundEffectTotals {
  return {
    effectiveStrength: { player: 0, enemy: 0 },
    casualtyRate: { player: 0, enemy: 0 },
    morale: { player: 0, enemy: 0 },
    supply: { player: 0, enemy: 0 },
    fatigue: { player: 0, enemy: 0 },
    percentLimit: { player: 30, enemy: 30 },
    directLimit: { player: 15, enemy: 15 },
    addStatuses: { player: [], enemy: [] },
    removeStatuses: { player: [], enemy: [] },
  };
}

function collectRoundEffects(
  state: WarEngineState,
  orders: WarRoundOrders,
  triggers: SemanticEffect['trigger'][],
): RoundEffectTotals {
  const totals = emptyRoundEffectTotals();
  const seenStackingGroups = new Set<string>();
  const entries = allEffectEntries(state, orders)
    .filter((entry) => triggers.includes(entry.effect.trigger))
    .sort((left, right) => right.effect.priority - left.effect.priority
      || left.sourceId.localeCompare(right.sourceId)
      || left.index - right.index);

  for (const entry of entries) {
    if (!WAR_EFFECT_OPERATIONS.has(entry.effect.operation)) continue;
    if (!effectConditionApplies(state, entry.sourceSide, orders[entry.sourceSide], entry.effect)) continue;
    const targetSide = effectTargetSide(entry.sourceSide, entry.effect);
    if (!targetSide) continue;
    const usageKey = `${entry.sourceSide}:${entry.sourceId}:${entry.index}`;
    const usage = state.effectUsage[usageKey] ?? 0;
    if (entry.effect.perEncounterLimit !== undefined && usage >= entry.effect.perEncounterLimit) continue;
    if (entry.effect.stackingGroup) {
      const stackingKey = `${targetSide}:${entry.effect.operation}:${entry.effect.stackingGroup}`;
      if (seenStackingGroups.has(stackingKey)) continue;
      seenStackingGroups.add(stackingKey);
    }
    state.effectUsage[usageKey] = usage + 1;
    const warArtLimits = usesRebalancedCommandModel(state)
      ? ENHANCED_WAR_ART_EFFECT_LIMITS
      : AGGRESSIVE_WAR_ART_EFFECT_LIMITS;
    const artLimits = entry.artPowerClass ? warArtLimits[entry.artPowerClass] : undefined;
    if (artLimits) {
      totals.percentLimit[targetSide] = Math.max(totals.percentLimit[targetSide], artLimits.percent);
      totals.directLimit[targetSide] = Math.max(totals.directLimit[targetSide], artLimits.direct);
    }
    const directLimit = artLimits?.direct ?? 15;
    const percentLimit = artLimits?.percent ?? 30;
    const boundedDirect = clampWarValue(entry.effect.value, -directLimit, directLimit);
    const boundedPercent = clampWarValue(entry.effect.value, -percentLimit, percentLimit);
    switch (entry.effect.operation) {
      case 'modify_effective_strength': totals.effectiveStrength[targetSide] += boundedPercent; break;
      case 'modify_casualty_rate': totals.casualtyRate[targetSide] += boundedPercent; break;
      case 'modify_morale': totals.morale[targetSide] += boundedDirect; break;
      case 'modify_supply': totals.supply[targetSide] += boundedDirect; break;
      case 'modify_fatigue': totals.fatigue[targetSide] += boundedDirect; break;
      case 'apply_status':
        if (entry.effect.statusId) totals.addStatuses[targetSide].push(entry.effect.statusId);
        break;
      case 'remove_status':
        if (entry.effect.statusId) totals.removeStatuses[targetSide].push(entry.effect.statusId);
        break;
      default: break;
    }
  }
  const aggressiveLimits = usesAggressiveCommandModel(state);
  for (const side of ['player', 'enemy'] as const) {
    totals.effectiveStrength[side] = clampWarValue(
      totals.effectiveStrength[side],
      aggressiveLimits ? -80 : -30,
      totals.percentLimit[side],
    );
    totals.casualtyRate[side] = clampWarValue(
      totals.casualtyRate[side],
      aggressiveLimits ? -80 : -30,
      totals.percentLimit[side],
    );
    totals.morale[side] = clampWarValue(
      totals.morale[side],
      -totals.directLimit[side],
      totals.directLimit[side],
    );
    totals.supply[side] = clampWarValue(
      totals.supply[side],
      -totals.directLimit[side],
      totals.directLimit[side],
    );
    totals.fatigue[side] = clampWarValue(
      totals.fatigue[side],
      -totals.directLimit[side],
      totals.directLimit[side],
    );
    totals.addStatuses[side] = [...new Set(totals.addStatuses[side])];
    totals.removeStatuses[side] = [...new Set(totals.removeStatuses[side])];
  }
  return totals;
}

function applyDirectEffects(state: WarEngineState, totals: RoundEffectTotals): void {
  for (const force of state.forces) {
    if (!activeForce(force)) continue;
    force.morale = Math.round(clampWarValue(force.morale + totals.morale[force.side], 0, 100));
    force.supply = Math.round(clampWarValue(force.supply + totals.supply[force.side], 0, 100));
    force.fatigue = Math.round(clampWarValue(force.fatigue + totals.fatigue[force.side], 0, 100));
    const removed = new Set(totals.removeStatuses[force.side]);
    force.statuses = force.statuses.filter((status) => !removed.has(status));
    force.statuses = [...new Set([...force.statuses, ...totals.addStatuses[force.side]])];
  }
}

function sideTacticCoefficients(state: WarEngineState, side: EncounterSide, order: WarRoundOrder) {
  return resolveWarTacticCoefficients(coefficientTactic(order), {
    environmentTags: state.snapshot.environmentTags,
    mobileShare: sideMobility(state, side),
  });
}

function forceProfile(snapshot: WarForceSnapshot) {
  return {
    primaryClass: snapshot.primaryClass,
    tags: snapshot.tags,
    composition: snapshot.troopProfile?.composition,
  };
}

function forceMatchupAgainstSide(
  state: WarEngineState,
  attacker: WarRuntimeForce,
  attackerOrder: WarRoundOrder,
  defenderOrder: WarRoundOrder,
): number {
  const snapshotMap = snapshotsByTroopId(state.snapshot);
  const attackerSnapshot = snapshotMap.get(attacker.troopId);
  if (!attackerSnapshot) return 1;
  const defenders = activeSideForces(state, otherSide(attacker.side));
  const totalWeight = defenders.reduce((sum, force) => sum + force.remainingStrength, 0);
  if (totalWeight <= 0) return 1;
  return defenders.reduce((sum, defender) => {
    const defenderSnapshot = snapshotMap.get(defender.troopId);
    if (!defenderSnapshot) return sum;
    return sum + troopMatchupFactor({
      attacker: forceProfile(attackerSnapshot),
      defender: forceProfile(defenderSnapshot),
      environmentTags: state.snapshot.environmentTags,
      attackerTactic: coefficientTactic(attackerOrder),
      defenderTactic: coefficientTactic(defenderOrder),
    }) * defender.remainingStrength / totalWeight;
  }, 0);
}

function incomingMatchupForForce(
  state: WarEngineState,
  defender: WarRuntimeForce,
  attackerOrder: WarRoundOrder,
  defenderOrder: WarRoundOrder,
): number {
  const snapshotMap = snapshotsByTroopId(state.snapshot);
  const defenderSnapshot = snapshotMap.get(defender.troopId);
  if (!defenderSnapshot) return 1;
  const attackers = activeSideForces(state, otherSide(defender.side));
  const totalWeight = attackers.reduce((sum, force) => sum + force.remainingStrength, 0);
  if (totalWeight <= 0) return 1;
  return attackers.reduce((sum, attacker) => {
    const attackerSnapshot = snapshotMap.get(attacker.troopId);
    if (!attackerSnapshot) return sum;
    return sum + troopMatchupFactor({
      attacker: forceProfile(attackerSnapshot),
      defender: forceProfile(defenderSnapshot),
      environmentTags: state.snapshot.environmentTags,
      attackerTactic: coefficientTactic(attackerOrder),
      defenderTactic: coefficientTactic(defenderOrder),
    }) * attacker.remainingStrength / totalWeight;
  }, 0);
}

function sideAverageValue(
  state: WarEngineState,
  side: EncounterSide,
  selector: (force: WarRuntimeForce) => number,
): number {
  const forces = activeSideForces(state, side);
  const total = forces.reduce((sum, force) => sum + force.remainingStrength, 0);
  if (total <= 0) return 1;
  return forces.reduce((sum, force) => sum + selector(force) * force.remainingStrength / total, 0);
}

function sideCoordination(state: WarEngineState, side: EncounterSide): number {
  const snapshotMap = snapshotsByTroopId(state.snapshot);
  return sideAverageValue(state, side, (force) => {
    const snapshot = snapshotMap.get(force.troopId);
    if (!snapshot) return 50;
    if (usesAggressiveCommandModel(state)) {
      const commander = state.snapshot.commanders[side];
      const leadership = !commander
        ? 10
        : commander.leadershipKnown ? commander.leadership : 25;
      if (usesRebalancedCommandModel(state)) {
        if (usesAttributeCommandModel(state)) {
          const intelligence = commander?.intelligence ?? 50;
          return snapshot.training * 0.25
            + snapshot.readiness * 0.15
            + force.morale * 0.15
            + leadership * 0.30
            + intelligence * 0.15;
        }
        return snapshot.training * 0.29
          + snapshot.readiness * 0.18
          + force.morale * 0.17
          + leadership * 0.36;
      }
      return snapshot.training * 0.25
        + snapshot.readiness * 0.15
        + force.morale * 0.15
        + leadership * 0.45;
    }
    return snapshot.training * 0.35
      + snapshot.readiness * 0.25
      + force.morale * 0.20
      + commanderScore(state, side) * 0.20;
  });
}

function sideRawEffectiveStrength(
  state: WarEngineState,
  side: EncounterSide,
  order: WarRoundOrder,
  opposingOrder: WarRoundOrder,
  tacticModifier: number,
  semanticModifierPercent: number,
): number {
  const snapshotMap = snapshotsByTroopId(state.snapshot);
  const enemyClasses = activeSideForces(state, otherSide(side))
    .map((force) => snapshotMap.get(force.troopId)?.primaryClass ?? 'mixed');
  const tactic = coefficientTactic(order);
  const coefficients = sideTacticCoefficients(state, side, order);
  const localStrength = activeSideForces(state, side).reduce((sum, force) => {
    const snapshot = snapshotMap.get(force.troopId);
    if (!snapshot) return sum;
    const environmentFactor = troopEnvironmentFactor({
      primaryClass: snapshot.primaryClass,
      tags: snapshot.tags,
      environmentTags: state.snapshot.environmentTags,
      enemyPrimaryClasses: enemyClasses,
      tactic,
    });
    const matchupFactor = usesWarV22(state)
      ? forceMatchupAgainstSide(state, force, order, opposingOrder)
      : 1;
    return sum + calculateWarEffectiveStrength({
      strength: force.remainingStrength,
      training: snapshot.training,
      morale: force.morale,
      quality: snapshot.quality,
      readiness: snapshot.readiness,
      supply: force.supply,
      fatigue: force.fatigue,
      commanderScore: commanderScore(state, side),
      commanderFactor: commanderFactor(state, side),
      environmentFactor,
      matchupFactor,
      moraleModel: usesWarV22(state) ? 'v22' : 'legacy',
      tacticFactor: coefficients.offense * tacticModifier,
      semanticModifierPercent,
    });
  }, 0);
  const theaterFactor = side === 'player'
    ? state.snapshot.theaterContext?.playerSupportFactor ?? 1
    : state.snapshot.theaterContext?.enemySupportFactor ?? 1;
  return localStrength * theaterFactor;
}

function engagedStrengths(
  state: WarEngineState,
  orders: WarRoundOrders,
  counters: ReturnType<typeof compareWarTactics>,
  semanticModifiers: Record<EncounterSide, number>,
) {
  const playerRawStrength = sideRawEffectiveStrength(
    state,
    'player',
    orders.player,
    orders.enemy,
    counters.playerModifier * intelligenceTacticFactor(state, 'player', orders.player),
    semanticModifiers.player,
  );
  const enemyRawStrength = sideRawEffectiveStrength(
    state,
    'enemy',
    orders.enemy,
    orders.player,
    counters.enemyModifier * intelligenceTacticFactor(state, 'enemy', orders.enemy),
    semanticModifiers.enemy,
  );
  if (!usesWarV22(state)) {
    return { player: playerRawStrength, enemy: enemyRawStrength };
  }
  return resolveWarEngagedStrengths({
    playerRawStrength,
    enemyRawStrength,
    playerCoordination: sideCoordination(state, 'player'),
    enemyCoordination: sideCoordination(state, 'enemy'),
  });
}

function applyOpeningCavalryShock(
  state: WarEngineState,
  orders: WarRoundOrders,
): Record<EncounterSide, number> {
  const totals: Record<EncounterSide, number> = { player: 0, enemy: 0 };
  if (!usesWarV22(state) || state.round !== 0) return totals;
  const snapshotMap = snapshotsByTroopId(state.snapshot);
  const penalties = new Map<string, number>();
  for (const defender of state.forces) {
    if (!activeForce(defender)) continue;
    const defenderSnapshot = snapshotMap.get(defender.troopId);
    if (!defenderSnapshot) continue;
    const attackers = activeSideForces(state, otherSide(defender.side));
    const totalWeight = attackers.reduce((sum, force) => sum + force.remainingStrength, 0);
    if (totalWeight <= 0) continue;
    const attackerOrder = defender.side === 'player' ? orders.enemy : orders.player;
    const defenderOrder = defender.side === 'player' ? orders.player : orders.enemy;
    const penalty = attackers.reduce((sum, attacker) => {
      const attackerSnapshot = snapshotMap.get(attacker.troopId);
      if (!attackerSnapshot) return sum;
      return sum + calculateWarShockMoralePenalty({
        attacker: forceProfile(attackerSnapshot),
        defender: forceProfile(defenderSnapshot),
        environmentTags: state.snapshot.environmentTags,
        attackerTactic: coefficientTactic(attackerOrder),
        defenderTactic: coefficientTactic(defenderOrder),
        attackerMorale: attacker.morale,
        attackerTraining: attackerSnapshot.training,
        attackerReadiness: attackerSnapshot.readiness,
        attackerSupply: attacker.supply,
        defenderTraining: defenderSnapshot.training,
        defenderQuality: defenderSnapshot.quality,
      }) * attacker.remainingStrength / totalWeight;
    }, 0);
    penalties.set(defender.troopId, Math.round(penalty));
  }
  for (const force of state.forces) {
    const penalty = penalties.get(force.troopId) ?? 0;
    if (penalty <= 0) continue;
    force.morale = Math.round(clampWarValue(force.morale - penalty, 0, 100));
    force.statuses = [...new Set([...force.statuses, 'war_status_cavalry_shock'])];
    totals[force.side] += penalty;
  }
  return totals;
}

function updateForceLifecycle(force: WarRuntimeForce, routeThreshold = 5): void {
  if (force.remainingStrength <= 0) {
    force.remainingStrength = 0;
    force.lifecycleStatus = 'destroyed';
    force.morale = 0;
    force.statuses = [...new Set([...force.statuses, 'war_status_destroyed'])];
    return;
  }
  if (force.lifecycleStatus === 'surrendered') return;
  if (force.morale <= routeThreshold) {
    force.morale = 0;
    force.lifecycleStatus = 'routed';
    force.statuses = [...new Set([...force.statuses, 'war_status_routed'])];
    return;
  }
  force.lifecycleStatus = 'active';
  const dynamicStatuses = force.statuses.filter((status) => ![
    'war_status_low_morale',
    'war_status_low_supply',
    'war_status_high_fatigue',
  ].includes(status));
  if (force.morale < 15) dynamicStatuses.push('war_status_low_morale');
  if (force.supply < 25) dynamicStatuses.push('war_status_low_supply');
  if (force.fatigue >= 80) dynamicStatuses.push('war_status_high_fatigue');
  force.statuses = [...new Set(dynamicStatuses)];
}

function sideTerminalReason(state: WarEngineState, side: EncounterSide): WarExitReason | undefined {
  const forces = sideForces(state, side);
  if (forces.length === 0) return 'force_destroyed';
  if (forces.every((force) => force.lifecycleStatus === 'destroyed')) return 'force_destroyed';
  if (forces.every((force) => !activeForce(force))) return 'force_routed';
  return undefined;
}

export function evaluateWarObjectiveAchieved(
  state: WarEngineState,
  outcome: NonNullable<WarEngineState['outcome']>,
): boolean {
  const playerHasForce = sideForces(state, 'player').some((force) => force.remainingStrength > 0
    && force.lifecycleStatus !== 'destroyed'
    && force.lifecycleStatus !== 'surrendered');
  const enemyNeutralized = outcome === 'player_victory'
    || outcome === 'enemy_retreat'
    || sideForces(state, 'enemy').every((force) => !activeForce(force));
  switch (state.snapshot.objective) {
    case 'defeat_enemy':
      return enemyNeutralized;
    case 'capture_holding':
      return playerHasForce && enemyNeutralized;
    case 'break_siege':
      return playerHasForce && (enemyNeutralized || outcome === 'player_retreat');
    case 'relieve_siege':
      return playerHasForce && enemyNeutralized;
    default:
      return false;
  }
}

function resolveTerminalSides(state: WarEngineState): void {
  const playerReason = sideTerminalReason(state, 'player');
  const enemyReason = sideTerminalReason(state, 'enemy');
  if (!playerReason && !enemyReason) return;
  state.phase = 'resolved';
  if (playerReason && enemyReason) {
    state.outcome = 'draw';
    state.objectiveAchieved = false;
    state.exitReason = playerReason === 'force_destroyed' && enemyReason === 'force_destroyed'
      ? 'force_destroyed'
      : 'force_routed';
    return;
  }
  if (enemyReason) {
    state.outcome = 'player_victory';
    state.objectiveAchieved = evaluateWarObjectiveAchieved(state, state.outcome);
    state.exitReason = enemyReason;
    return;
  }
  state.outcome = 'enemy_victory';
  state.objectiveAchieved = evaluateWarObjectiveAchieved(state, state.outcome);
  state.exitReason = playerReason;
}

function appendActionLog(
  state: WarEngineState,
  input: {
    actionType: string;
    actorSide: EncounterSide;
    targetSide: EncounterSide;
    randomDrawStart: number;
    randomDrawEnd: number;
    summaryKey: string;
    values: Record<string, JsonPrimitive>;
  },
): void {
  const sequence = state.actionLog.length + 1;
  const actorId = state.snapshot.commanders[input.actorSide]?.actorId ?? `war_force:${input.actorSide}`;
  const targetIds = sideForces(state, input.targetSide).map((force) => force.troopId);
  const entry: EncounterActionLogEntry = {
    sequence,
    actionId: `${state.snapshot.sessionId}:war-action-${sequence}`,
    actorId,
    targetIds,
    actionType: input.actionType,
    randomDrawStart: input.randomDrawStart,
    randomDrawEnd: input.randomDrawEnd,
    summaryKey: input.summaryKey,
    values: input.values,
  };
  state.actionLog.push(entry);
}

export function createInitialWarState(snapshot: WarEncounterSnapshot): WarEngineState {
  const random = new SeededEncounterRandom(snapshot.seed);
  return {
    snapshot,
    phase: 'awaiting_round',
    round: 0,
    forces: snapshot.forces.map((force) => ({
      troopId: force.troopId,
      side: force.side,
      stableOrder: force.stableOrder,
      initialStrength: force.initialStrength,
      remainingStrength: force.initialStrength,
      casualties: 0,
      capturedCount: 0,
      morale: force.morale,
      supply: force.supply,
      fatigue: force.fatigue,
      lifecycleStatus: 'active',
      statuses: [],
    })),
    usedWarArt: {},
    effectUsage: {},
    randomState: random.snapshot(),
    actionLog: [],
    objectiveAchieved: false,
    pursuit: {
      status: 'not_available',
      extraCasualties: 0,
      extraCaptured: 0,
    },
  };
}

export function executeWarRound(input: WarEngineState, orders: WarRoundOrders): WarEngineState {
  if (input.phase !== 'awaiting_round') throw new Error('当前不是等待战争轮次的状态。');
  if (input.round >= 10) throw new Error('战争已经达到 10 轮上限。');
  validateRoundOrder(input, 'player', orders.player);
  validateRoundOrder(input, 'enemy', orders.enemy);
  const state = cloneState(input);
  const v22 = usesWarV22(state);
  if (orders.player.type === 'war_art') state.usedWarArt.player = orders.player.artId;
  if (orders.enemy.type === 'war_art') state.usedWarArt.enemy = orders.enemy.artId;
  const random = randomFromState(state);
  const randomDrawStart = random.draws;

  const preEffects = collectRoundEffects(state, orders, ['war_round_start', 'before_war_resolution']);
  applyDirectEffects(state, preEffects);
  const openingShock = applyOpeningCavalryShock(state, orders);
  const playerCoefficients = sideTacticCoefficients(state, 'player', orders.player);
  const enemyCoefficients = sideTacticCoefficients(state, 'enemy', orders.enemy);
  const counters = compareWarTactics(orderTactic(orders.player), orderTactic(orders.enemy));
  const playerIntelligenceFactor = intelligenceTacticFactor(state, 'player', orders.player);
  const enemyIntelligenceFactor = intelligenceTacticFactor(state, 'enemy', orders.enemy);
  const playerMartialPressure = martialPressureFactor(state, 'player', orders.player);
  const enemyMartialPressure = martialPressureFactor(state, 'enemy', orders.enemy);
  const effective = engagedStrengths(state, orders, counters, preEffects.effectiveStrength);
  const warDifficultyProfile = getEncounterDifficultyProfile('war', state.snapshot.warDifficulty);
  const playerEffective = effective.player * warDifficultyProfile.playerPowerMultiplier;
  const enemyEffective = effective.enemy;
  const playerPerturbation = random.nextIntInclusive(950, 1050) / 1_000;
  const enemyPerturbation = random.nextIntInclusive(950, 1050) / 1_000;
  const playerCasualtyRate = calculateWarCasualtyRate({
    enemyEffectiveStrength: enemyEffective,
    ownEffectiveStrength: playerEffective,
    enemyOffense: enemyCoefficients.offense,
    ownExposure: playerCoefficients.exposure,
    perturbation: playerPerturbation,
    semanticModifierPercent: preEffects.casualtyRate.player,
    commanderModifierPercent: commanderCasualtyModifierPercent(state, 'player')
      + (enemyMartialPressure - 1) * 100,
  });
  const enemyCasualtyRate = calculateWarCasualtyRate({
    enemyEffectiveStrength: playerEffective,
    ownEffectiveStrength: enemyEffective,
    enemyOffense: playerCoefficients.offense,
    ownExposure: enemyCoefficients.exposure,
    perturbation: enemyPerturbation,
    semanticModifierPercent: preEffects.casualtyRate.enemy,
    commanderModifierPercent: commanderCasualtyModifierPercent(state, 'enemy')
      + (playerMartialPressure - 1) * 100,
  });
  const roundWinner: EncounterSide | undefined = playerEffective > enemyEffective * 1.02
    ? 'player'
    : enemyEffective > playerEffective * 1.02
      ? 'enemy'
      : undefined;
  const incomingMatchups = new Map<string, number>();
  if (v22) {
    for (const force of state.forces) {
      if (!activeForce(force)) continue;
      incomingMatchups.set(force.troopId, incomingMatchupForForce(
        state,
        force,
        force.side === 'player' ? orders.enemy : orders.player,
        force.side === 'player' ? orders.player : orders.enemy,
      ));
    }
  }
  const averageIncoming: Record<EncounterSide, number> = {
    player: sideAverageValue(state, 'player', (force) => incomingMatchups.get(force.troopId) ?? 1),
    enemy: sideAverageValue(state, 'enemy', (force) => incomingMatchups.get(force.troopId) ?? 1),
  };
  const averageMoraleExposure: Record<EncounterSide, number> = {
    player: sideAverageValue(state, 'player', (force) => warMoraleCasualtyExposure(force.morale)),
    enemy: sideAverageValue(state, 'enemy', (force) => warMoraleCasualtyExposure(force.morale)),
  };
  const forceRates = new Map<string, number>();
  for (const force of state.forces) {
    if (!activeForce(force)) continue;
    const baseRate = force.side === 'player' ? playerCasualtyRate : enemyCasualtyRate;
    if (!v22) {
      forceRates.set(force.troopId, baseRate);
    } else {
      const matchupScale = clampWarValue(
        (incomingMatchups.get(force.troopId) ?? 1) / Math.max(0.01, averageIncoming[force.side]),
        0.55,
        1.75,
      );
      const moraleScale = clampWarValue(
        warMoraleCasualtyExposure(force.morale) / Math.max(0.01, averageMoraleExposure[force.side]),
        0.70,
        1.50,
      );
      forceRates.set(force.troopId, clampWarValue(baseRate * matchupScale * moraleScale, 0.005, 0.08));
    }
  }
  let playerCasualties = 0;
  let enemyCasualties = 0;
  for (const force of state.forces) {
    if (!activeForce(force)) continue;
    const rate = forceRates.get(force.troopId) ?? (force.side === 'player' ? playerCasualtyRate : enemyCasualtyRate);
    const casualties = Math.min(
      force.remainingStrength,
      Math.max(1, Math.round(force.remainingStrength * rate)),
    );
    force.remainingStrength -= casualties;
    force.casualties += casualties;
    if (force.side === 'player') playerCasualties += casualties;
    else enemyCasualties += casualties;
    const coefficients = force.side === 'player' ? playerCoefficients : enemyCoefficients;
    force.supply = Math.round(clampWarValue(force.supply - coefficients.supplyCost, 0, 100));
    force.fatigue = Math.round(clampWarValue(force.fatigue + coefficients.fatigueCost, 0, 100));
    let moraleDelta = -Math.max(1, Math.round(rate * (v22 ? 70 : 50)));
    if (v22) {
      const roundLossShare = casualties / Math.max(1, force.initialStrength);
      if (roundLossShare >= 0.06) moraleDelta -= 4;
      else if (roundLossShare >= 0.03) moraleDelta -= 2;
    }
    if (roundWinner === force.side) moraleDelta += v22 ? 2 : 1;
    else if (roundWinner) moraleDelta -= v22 ? 5 : 3;
    if (counters.winner && counters.winner !== force.side) moraleDelta -= v22 ? 3 : 2;
    if (force.supply < 25) moraleDelta -= 2;
    moraleDelta += commanderMoraleDelta(state, force.side);
    moraleDelta -= force.side === 'player'
      ? martialMoralePressure(state, 'enemy', orders.enemy)
      : martialMoralePressure(state, 'player', orders.player);
    force.morale = Math.round(clampWarValue(force.morale + moraleDelta, 0, 100));
  }

  const afterEffects = collectRoundEffects(state, orders, ['after_war_resolution']);
  applyDirectEffects(state, afterEffects);
  state.forces.forEach((force) => updateForceLifecycle(force, v22 ? 5 : 0));
  state.round += 1;
  state.randomState = random.snapshot();
  appendActionLog(state, {
    actionType: 'war_round',
    actorSide: 'player',
    targetSide: 'enemy',
    randomDrawStart,
    randomDrawEnd: random.draws,
    summaryKey: counters.winner ? 'war_round_tactic_counter' : 'war_round_exchange',
    values: {
      round: state.round,
      playerOrder: orderKey(orders.player),
      enemyOrder: orderKey(orders.enemy),
      playerCommanderFactor: commanderFactor(state, 'player'),
      enemyCommanderFactor: commanderFactor(state, 'enemy'),
      playerIntelligenceTacticFactorBps: Math.round(playerIntelligenceFactor * 10_000),
      enemyIntelligenceTacticFactorBps: Math.round(enemyIntelligenceFactor * 10_000),
      playerMartialPressureBps: Math.round(playerMartialPressure * 10_000),
      enemyMartialPressureBps: Math.round(enemyMartialPressure * 10_000),
      playerEffective: Math.round(playerEffective),
      enemyEffective: Math.round(enemyEffective),
      warDifficulty: warDifficultyProfile.id,
      playerDifficultyMultiplierBps: Math.round(warDifficultyProfile.playerPowerMultiplier * 10_000),
      playerCasualties,
      enemyCasualties,
      playerCasualtyRateBps: Math.round(playerCasualtyRate * 10_000),
      enemyCasualtyRateBps: Math.round(enemyCasualtyRate * 10_000),
      ...(v22 ? {
        playerOpeningShock: openingShock.player,
        enemyOpeningShock: openingShock.enemy,
      } : {}),
      roundWinner: roundWinner ?? 'draw',
      counterWinner: counters.winner ?? null,
    },
  });
  resolveTerminalSides(state);
  if (state.phase !== 'resolved' && state.round >= 10) {
    const finalEffective = engagedStrengths(state, orders, counters, { player: 0, enemy: 0 });
    const finalPlayerEffective = finalEffective.player
      * getEncounterDifficultyProfile('war', state.snapshot.warDifficulty).playerPowerMultiplier;
    const finalEnemyEffective = finalEffective.enemy;
    state.phase = 'resolved';
    state.outcome = resolveWarRoundLimitOutcome({
      playerEffectiveStrength: finalPlayerEffective,
      enemyEffectiveStrength: finalEnemyEffective,
    });
    state.objectiveAchieved = evaluateWarObjectiveAchieved(state, state.outcome);
    state.exitReason = 'round_limit';
    const finalLog = state.actionLog[state.actionLog.length - 1];
    if (finalLog) {
      finalLog.values.roundLimitPlayerEffective = Math.round(finalPlayerEffective);
      finalLog.values.roundLimitEnemyEffective = Math.round(finalEnemyEffective);
      finalLog.values.roundLimitOutcome = state.outcome;
    }
  }
  return state;
}

function applyRetreatFailureLosses(state: WarEngineState, side: EncounterSide): number {
  const own = activeSideForces(state, side);
  const enemy = activeSideForces(state, otherSide(side));
  const ownStrength = own.reduce((sum, force) => sum + force.remainingStrength, 0);
  const enemyStrength = enemy.reduce((sum, force) => sum + force.remainingStrength, 0);
  const rate = clampWarValue(0.02 * Math.sqrt(Math.max(1, enemyStrength) / Math.max(1, ownStrength)) * 1.5, 0.01, 0.06);
  let casualties = 0;
  for (const force of own) {
    const loss = Math.min(force.remainingStrength, Math.max(1, Math.round(force.remainingStrength * rate)));
    force.remainingStrength -= loss;
    force.casualties += loss;
    casualties += loss;
    force.morale = Math.round(clampWarValue(force.morale - 8, 0, 100));
    force.supply = Math.round(clampWarValue(force.supply - 2, 0, 100));
    force.fatigue = Math.round(clampWarValue(force.fatigue + 3, 0, 100));
    updateForceLifecycle(force, usesWarV22(state) ? 5 : 0);
  }
  return casualties;
}

export function attemptWarRetreat(input: WarEngineState, side: EncounterSide): WarEngineState {
  if (input.phase !== 'awaiting_round') throw new Error('当前不是可撤退的战争轮次状态。');
  if (!input.snapshot.intent.policy.allowRetreat) throw new Error('本场战争政策不允许撤退。');
  if (activeSideForces(input, side).length === 0) throw new Error(`${side} 已无可撤退部队。`);
  const state = cloneState(input);
  const random = randomFromState(state);
  const randomDrawStart = random.draws;
  const ownForces = activeSideForces(state, side);
  const enemyForces = activeSideForces(state, otherSide(side));
  const baseChance = calculateWarRetreatChance({
    ownMobility: sideMobility(state, side),
    enemyMobility: sideMobility(state, otherSide(side)),
    ownMorale: weightedAverage(ownForces, (force) => force.morale),
    enemyMorale: weightedAverage(enemyForces, (force) => force.morale),
    ownFatigue: weightedAverage(ownForces, (force) => force.fatigue),
    ownCommanderScore: commanderScore(state, side),
    enemyCommanderScore: commanderScore(state, otherSide(side)),
  });
  const difficulty = getEncounterDifficultyProfile('war', state.snapshot.warDifficulty);
  const difficultyChanceAdjustment = side === 'player'
    ? Math.round((difficulty.playerPowerMultiplier - 1) * 40)
    : 0;
  const chance = Math.round(clampWarValue(baseChance + difficultyChanceAdjustment, 10, 95));
  const roll = random.nextIntInclusive(1, 100);
  state.round += 1;
  let failureCasualties = 0;
  if (roll <= chance) {
    state.phase = 'awaiting_decision';
    state.pendingDecision = {
      kind: 'pursuit',
      decidingSide: otherSide(side),
      fleeingSide: side,
    };
    state.pursuit = {
      status: 'pending',
      pursuingSide: otherSide(side),
      fleeingSide: side,
      extraCasualties: 0,
      extraCaptured: 0,
    };
  } else {
    failureCasualties = applyRetreatFailureLosses(state, side);
    resolveTerminalSides(state);
    if (state.phase !== 'resolved' && state.round >= 10) {
      state.phase = 'resolved';
      state.outcome = 'draw';
      state.objectiveAchieved = false;
      state.exitReason = 'round_limit';
    }
  }
  state.randomState = random.snapshot();
  appendActionLog(state, {
    actionType: 'war_retreat',
    actorSide: side,
    targetSide: otherSide(side),
    randomDrawStart,
    randomDrawEnd: random.draws,
    summaryKey: roll <= chance ? 'war_retreat_success' : 'war_retreat_failed',
    values: { chance, roll, failureCasualties },
  });
  return state;
}

export function offerWarSurrender(input: WarEngineState, side: EncounterSide): WarEngineState {
  if (input.phase !== 'awaiting_round') throw new Error('当前不是可提出投降的战争轮次状态。');
  if (!input.snapshot.intent.policy.allowSurrender) throw new Error('本场战争政策不允许投降。');
  if (activeSideForces(input, side).length === 0) throw new Error(`${side} 已无可投降部队。`);
  const state = cloneState(input);
  state.phase = 'awaiting_decision';
  state.pendingDecision = {
    kind: 'surrender_offer',
    decidingSide: otherSide(side),
    offeringSide: side,
  };
  appendActionLog(state, {
    actionType: 'war_surrender_offer',
    actorSide: side,
    targetSide: otherSide(side),
    randomDrawStart: state.randomState.draws,
    randomDrawEnd: state.randomState.draws,
    summaryKey: 'war_surrender_offered',
    values: { offeringSide: side },
  });
  return state;
}

function resolvePursuit(state: WarEngineState, pursue: boolean): void {
  const decision = state.pendingDecision;
  if (!decision || decision.kind !== 'pursuit') throw new Error('当前没有待处理的追击选择。');
  const pursuingSide = decision.decidingSide;
  const fleeingSide = decision.fleeingSide;
  const random = randomFromState(state);
  const randomDrawStart = random.draws;
  let extraCasualties = 0;
  let extraCaptured = 0;
  if (pursue) {
    const pursuers = activeSideForces(state, pursuingSide);
    const fleeing = activeSideForces(state, fleeingSide);
    const pursuerStrength = pursuers.reduce((sum, force) => sum + force.remainingStrength, 0);
    const fleeingStrength = fleeing.reduce((sum, force) => sum + force.remainingStrength, 0);
    const mobilityEdge = sideMobility(state, pursuingSide) - sideMobility(state, fleeingSide);
    const perturbation = random.nextIntInclusive(950, 1050) / 1_000;
    const rate = clampWarValue(
      0.025 * Math.sqrt(Math.max(1, pursuerStrength) / Math.max(1, fleeingStrength))
        * (1 + mobilityEdge * 0.4)
        * perturbation,
      0.01,
      0.06,
    );
    for (const force of fleeing) {
      const loss = Math.min(force.remainingStrength, Math.max(1, Math.round(force.remainingStrength * rate)));
      force.remainingStrength -= loss;
      force.casualties += loss;
      extraCasualties += loss;
      if (state.snapshot.intent.policy.allowCapture) {
        const captured = Math.min(force.remainingStrength, Math.max(0, Math.round(loss * 0.25)));
        force.capturedCount += captured;
        extraCaptured += captured;
      }
      force.morale = Math.round(clampWarValue(force.morale - 5, 0, 100));
      updateForceLifecycle(force, usesWarV22(state) ? 5 : 0);
    }
  }
  state.randomState = random.snapshot();
  state.phase = 'resolved';
  state.pendingDecision = undefined;
  state.outcome = fleeingSide === 'enemy' ? 'enemy_retreat' : 'player_retreat';
  state.objectiveAchieved = evaluateWarObjectiveAchieved(state, state.outcome);
  state.exitReason = 'retreat';
  state.pursuit = {
    status: pursue ? 'resolved' : 'declined',
    pursuingSide,
    fleeingSide,
    extraCasualties,
    extraCaptured,
  };
  appendActionLog(state, {
    actionType: 'war_pursuit',
    actorSide: pursuingSide,
    targetSide: fleeingSide,
    randomDrawStart,
    randomDrawEnd: random.draws,
    summaryKey: pursue ? 'war_pursuit_resolved' : 'war_pursuit_declined',
    values: { pursued: pursue, extraCasualties, extraCaptured },
  });
}

function acceptSurrender(state: WarEngineState): void {
  const decision = state.pendingDecision;
  if (!decision || decision.kind !== 'surrender_offer') throw new Error('当前没有待处理的投降选择。');
  for (const force of sideForces(state, decision.offeringSide)) {
    if (force.lifecycleStatus === 'destroyed') continue;
    force.lifecycleStatus = 'surrendered';
    force.capturedCount = state.snapshot.intent.policy.allowCapture ? force.remainingStrength : 0;
    force.statuses = [...new Set([
      ...force.statuses,
      'war_status_surrendered',
      ...(force.capturedCount > 0 ? ['war_status_captured'] : []),
    ])];
  }
  state.phase = 'resolved';
  state.pendingDecision = undefined;
  state.outcome = 'surrender';
  state.objectiveAchieved = evaluateWarObjectiveAchieved(state, state.outcome);
  state.exitReason = 'surrender';
  appendActionLog(state, {
    actionType: 'war_surrender_resolution',
    actorSide: decision.decidingSide,
    targetSide: decision.offeringSide,
    randomDrawStart: state.randomState.draws,
    randomDrawEnd: state.randomState.draws,
    summaryKey: 'war_surrender_accepted',
    values: { offeringSide: decision.offeringSide },
  });
}

export function resolveWarDecision(input: WarEngineState, decision: WarDecision): WarEngineState {
  if (input.phase !== 'awaiting_decision' || !input.pendingDecision) {
    throw new Error('当前没有待处理的战争决定。');
  }
  const state = cloneState(input);
  if (state.pendingDecision?.kind === 'pursuit') {
    if (decision.choice === 'pursue') resolvePursuit(state, true);
    else if (decision.choice === 'stop_pursuit') resolvePursuit(state, false);
    else throw new Error('追击选择只能是 pursue 或 stop_pursuit。');
    return state;
  }
  if (decision.choice === 'reject_surrender') {
    const pending = state.pendingDecision;
    if (!pending || pending.kind !== 'surrender_offer') throw new Error('当前没有待处理的投降选择。');
    state.pendingDecision = undefined;
    state.phase = 'awaiting_round';
    appendActionLog(state, {
      actionType: 'war_surrender_resolution',
      actorSide: pending.decidingSide,
      targetSide: pending.offeringSide,
      randomDrawStart: state.randomState.draws,
      randomDrawEnd: state.randomState.draws,
      summaryKey: 'war_surrender_rejected',
      values: { offeringSide: pending.offeringSide },
    });
    return state;
  }
  if (decision.choice === 'accept_surrender') {
    acceptSurrender(state);
    return state;
  }
  throw new Error('投降选择只能是 accept_surrender 或 reject_surrender。');
}

export function resumeWarAfterAutoPause(input: WarEngineState): WarEngineState {
  if (input.phase !== 'auto_paused') throw new Error('当前战争没有处于自动暂停。');
  return { ...cloneState(input), phase: 'awaiting_round', autoPauseReason: undefined };
}

function commanderOutcome(
  state: WarEngineState,
  side: EncounterSide,
): WarCommanderResultState['outcome'] {
  const commander = state.snapshot.commanders[side];
  if (!commander) return 'active';
  const forces = sideForces(state, side);
  if (forces.some((force) => force.lifecycleStatus === 'surrendered') && state.snapshot.intent.policy.allowCapture) {
    return 'captured';
  }
  const terminal = forces.every((force) => !activeForce(force));
  const casualtyRatio = forces.reduce((sum, force) => sum + force.casualties, 0)
    / Math.max(1, forces.reduce((sum, force) => sum + force.initialStrength, 0));
  const rollHash = hashCanonicalValue({ seed: state.snapshot.seed, side, actorId: commander.actorId, outcome: state.outcome });
  const roll = Number.parseInt(rollHash.slice(-4), 16) % 100;
  if (terminal && state.snapshot.intent.policy.lethality === 'fatal' && roll < 10) return 'dead';
  if (terminal && state.snapshot.intent.policy.allowCapture && roll < 35) return 'captured';
  if (terminal && roll < 65) return 'wounded';
  if (terminal && roll < 85) return 'missing';
  if (casualtyRatio >= 0.3 && roll < 35) return 'wounded';
  return 'active';
}

function buildWarDeltas(state: WarEngineState): UnsealedWarResult['deltas'] {
  const snapshotMap = snapshotsByTroopId(state.snapshot);
  return state.forces.flatMap((force) => {
    const snapshot = snapshotMap.get(force.troopId);
    if (!snapshot) return [];
    const sourceStrength = snapshot.sourceStrength ?? snapshot.initialStrength;
    const resolvedSourceStrength = Math.max(0, sourceStrength - force.casualties);
    const commitmentRatio = Math.min(1, snapshot.initialStrength / Math.max(1, sourceStrength));
    const blendLocalOutcome = (before: number, localAfter: number) => Math.round(
      clampWarValue(before + (localAfter - before) * commitmentRatio, 0, 100),
    );
    const resolvedLifecycle = snapshot.commitmentKind === 'detachment'
      ? snapshot.sourceLifecycleStatus
      : force.lifecycleStatus;
    const entries: Array<{ field: string; beforeValue: JsonPrimitive; afterValue: JsonPrimitive }> = [
      { field: 'size', beforeValue: sourceStrength, afterValue: resolvedSourceStrength },
      { field: 'morale', beforeValue: snapshot.morale, afterValue: blendLocalOutcome(snapshot.morale, force.morale) },
      { field: 'supplies', beforeValue: snapshot.supply, afterValue: blendLocalOutcome(snapshot.supply, force.supply) },
      { field: 'warFatiguePercent', beforeValue: snapshot.fatigue, afterValue: blendLocalOutcome(snapshot.fatigue, force.fatigue) },
      { field: 'lifecycleStatus', beforeValue: snapshot.sourceLifecycleStatus, afterValue: resolvedLifecycle },
    ];
    return entries
      .filter((entry) => entry.beforeValue !== entry.afterValue)
      .map((entry) => ({
        idempotencyKey: `${state.snapshot.sessionId}:troop:${force.troopId}:${entry.field}`,
        targetKind: 'troop' as const,
        targetId: force.troopId,
        field: entry.field,
        operation: 'set' as const,
        beforeValue: entry.beforeValue,
        afterValue: entry.afterValue,
      }));
  });
}

function warExperiencePercent(state: WarEngineState): number {
  const success = state.objectiveAchieved
    || state.outcome === 'player_victory'
    || state.outcome === 'enemy_retreat';
  let percent = success ? 20 : 10;
  if (state.objectiveAchieved) percent += 20;
  if (success) {
    const playerStrength = state.snapshot.forces
      .filter((force) => force.side === 'player')
      .reduce((sum, force) => sum + force.initialStrength, 0);
    const enemyStrength = state.snapshot.forces
      .filter((force) => force.side === 'enemy')
      .reduce((sum, force) => sum + force.initialStrength, 0);
    if (playerStrength > 0 && enemyStrength >= playerStrength * 1.5) percent += 20;
    else if (playerStrength > 0 && enemyStrength > playerStrength) percent += 10;
  }
  return Math.min(60, percent);
}

export function createSealedWarResult(
  state: WarEngineState,
  resolvedAt: string,
): SealedEncounterResult<UnsealedWarResult> {
  if (state.phase !== 'resolved' || !state.outcome || !state.exitReason) {
    throw new Error('战争尚未结算，不能封存 WarResult。');
  }
  if (Number.isNaN(Date.parse(resolvedAt))) throw new Error('resolvedAt 必须是合法时间。');
  const commanders: WarCommanderResultState[] = (['player', 'enemy'] as const)
    .flatMap((side) => {
      const commander = state.snapshot.commanders[side];
      return commander ? [{ actorId: commander.actorId, side, outcome: commanderOutcome(state, side) }] : [];
    });
  const result: UnsealedWarResult = {
    contractVersion: state.snapshot.intent.contractVersion,
    sessionId: state.snapshot.sessionId,
    encounterId: state.snapshot.intent.encounterId,
    kind: 'war',
    rulesetVersion: state.snapshot.intent.rulesetVersion,
    sourceTurnNumber: state.snapshot.intent.sourceTurnNumber,
    seed: state.snapshot.seed,
    resolvedAt,
    outcome: state.outcome,
    elapsedMinutes: Math.max(15, state.round * 60 + (state.pursuit.status === 'resolved' ? 30 : 0)),
    actionLog: state.actionLog.map((entry) => ({ ...entry, targetIds: [...entry.targetIds], values: { ...entry.values } })),
    deltas: buildWarDeltas(state),
    objective: state.snapshot.objective,
    objectiveAchieved: state.objectiveAchieved,
    exitReason: state.exitReason,
    forces: state.forces.map((force) => ({
      troopId: force.troopId,
      side: force.side,
      initialStrength: force.initialStrength,
      remainingStrength: force.remainingStrength,
      casualties: force.casualties,
      capturedCount: force.capturedCount,
      morale: force.morale,
      supply: force.supply,
      fatigue: force.fatigue,
      lifecycleStatus: force.lifecycleStatus,
      routed: force.lifecycleStatus === 'routed',
      surrendered: force.lifecycleStatus === 'surrendered',
      captured: force.capturedCount > 0,
      statuses: [...force.statuses],
    })),
    roundsCompleted: state.round,
    pursuit: {
      status: state.pursuit.status === 'pending' ? 'not_available' : state.pursuit.status,
      ...(state.pursuit.pursuingSide ? { pursuingSide: state.pursuit.pursuingSide } : {}),
      ...(state.pursuit.fleeingSide ? { fleeingSide: state.pursuit.fleeingSide } : {}),
      extraCasualties: state.pursuit.extraCasualties,
      extraCaptured: state.pursuit.extraCaptured,
    },
    commanders,
    experienceAward: experienceRewardFromPercent(
      state.snapshot.playerLevel,
      warExperiencePercent(state),
    ),
    capturedItemIds: [],
  };
  assertValidEncounterResultPayload(result);
  return sealEncounterResult(result);
}
