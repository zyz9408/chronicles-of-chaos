import type {
  ConflictRecord,
  RuntimeState,
  SuggestedAction,
  TroopLedgerEntry,
} from '../types';
import { normalizeCurrentTroopReferenceIds } from '../state/troopLifecycle';
import { advanceRuntimeClock } from '../time/gameClock';
import type {
  EncounterRuntimeLedger,
  SealedEncounterResult,
  SemanticProjection,
  UnsealedWarResult,
  WarStartIntent,
} from './EncounterContracts';
import { AGGRESSIVE_WAR_RULESET_VERSION, WAR_RULESET_VERSION } from './EncounterContracts';
import { verifyEncounterResultHash } from './EncounterDeterminism';
import {
  beginEncounterSession,
  createPendingEncounterSession,
  createPostEncounterResultCheckpoint,
  createPreEncounterCheckpoint,
  markEncounterNarrated,
  markEncounterNarrativePending,
  resolveEncounterSessionWithSealedResult,
} from './EncounterSessionState';
import { mergeEncounterSemanticProjections } from './EncounterRuntimeIntegration';
import { createInitialWarState } from './WarEngine';
import {
  createStructuredWarTroopProjection,
  createValidatedWarProjectionBundle,
  createWarEncounterSnapshot,
} from './WarSnapshotAdapter';
import { normalizeWarSupply } from './WarRules';
import {
  resolveTroopFatiguePercent,
  troopFatigueBandFromPercent,
} from '../troops/TroopFatigue';
import type {
  WarCommanderSource,
  WarEncounterSnapshot,
  WarEngineState,
  WarOfficerRole,
  WarOfficerSource,
} from './WarTypes';
import { canonicalizeEncounterPlayerAlias } from './EncounterIntentCanonicalization';
import { applyPlayerExperience } from '../character/progression';
import { applyWarUniqueArtProgress } from './EncounterUniqueArtProgression';

export interface StageWarEncounterInput {
  saveId: string;
  intent: WarStartIntent;
  projections: SemanticProjection[];
  createdAt: string;
}

export interface PrepareWarEncounterForPlayInput {
  startedAt: string;
}

export interface PreparedWarEncounter {
  session: NonNullable<EncounterRuntimeLedger['active']>['session'];
  snapshot: WarEncounterSnapshot;
  engineState: WarEngineState;
}

export interface CommitWarResultInput {
  saveId: string;
  session: PreparedWarEncounter['session'];
  result: SealedEncounterResult<UnsealedWarResult>;
  committedAt: string;
  locationName?: string;
}

export interface CompleteWarNarrativeTurnInput {
  resultHash: string;
  narrativeText: string;
  suggestedActions: SuggestedAction[];
  completedAt: string;
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  rawResponse?: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emptyLedger(): EncounterRuntimeLedger {
  return {
    semanticProjections: [],
    appliedResultHashes: [],
    narratedResultHashes: [],
  };
}

function normalizeLedger(state: RuntimeState): EncounterRuntimeLedger {
  return {
    ...emptyLedger(),
    ...(state.encounterV2 ? clone(state.encounterV2) : {}),
    semanticProjections: clone(state.encounterV2?.semanticProjections ?? []),
    appliedResultHashes: [...(state.encounterV2?.appliedResultHashes ?? [])],
    narratedResultHashes: [...(state.encounterV2?.narratedResultHashes ?? [])],
  };
}

function actorId(source: WarCommanderSource): string {
  const id = source.id ?? source.npcId;
  if (!id) throw new Error(`战争主将 ${source.name} 缺少稳定 ID。`);
  return id;
}

function collectCommanderSources(state: RuntimeState): Map<string, WarCommanderSource> {
  const sources = new Map<string, WarCommanderSource>();
  const add = (source: WarCommanderSource) => {
    const id = actorId(source);
    if (!sources.has(id)) sources.set(id, source);
  };
  add(state.player);
  for (const npc of state.npcs ?? []) add(npc);
  for (const actor of state.knownActors ?? []) add(actor);
  return sources;
}

function requireCommander(
  sources: ReadonlyMap<string, WarCommanderSource>,
  commanderActorId: string | undefined,
  label: string,
): WarCommanderSource | undefined {
  if (!commanderActorId) return undefined;
  const source = sources.get(commanderActorId);
  if (!source) throw new Error(`${label}主将 ${commanderActorId} 不存在于当前角色账本。`);
  return source;
}

function requireTroops(state: RuntimeState, troopIds: readonly string[], label: string): TroopLedgerEntry[] {
  const byId = new Map((state.troops ?? []).map((troop) => [troop.troopId, troop]));
  return troopIds.map((troopId) => {
    const troop = byId.get(troopId);
    if (!troop) throw new Error(`${label}部队 ${troopId} 不存在于当前部队账本。`);
    return troop;
  });
}

function ensureStructuredWarTroopProjections(
  state: RuntimeState,
  intent: WarStartIntent,
): RuntimeState {
  if (intent.rulesetVersion !== AGGRESSIVE_WAR_RULESET_VERSION
    && intent.rulesetVersion !== WAR_RULESET_VERSION) return state;
  const troopIds = [...new Set([
    ...intent.playerForce.troopIds,
    ...intent.enemyForce.troopIds,
  ])];
  const projections = requireTroops(state, troopIds, '参战')
    .map(createStructuredWarTroopProjection)
    .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile));
  if (projections.length === 0) return state;
  return mergeEncounterSemanticProjections(state, projections);
}

function collectSideOfficers(input: {
  troops: readonly TroopLedgerEntry[];
  commanderActorId?: string;
  sources: ReadonlyMap<string, WarCommanderSource>;
  label: string;
}): WarOfficerSource[] {
  const collected = new Map<string, WarOfficerSource>();
  const add = (officerId: string | undefined, role: WarOfficerRole, troopId: string) => {
    if (!officerId || officerId === input.commanderActorId || officerId === 'player') return;
    const source = input.sources.get(officerId);
    if (!source) throw new Error(`${input.label}随军人员 ${officerId} 不存在于当前角色账本。`);
    const previous = collected.get(officerId);
    if (previous) {
      previous.troopIds = [...new Set([...previous.troopIds, troopId])];
      return;
    }
    collected.set(officerId, { source, role, troopIds: [troopId] });
  };
  for (const troop of input.troops) {
    add(troop.leaderNpcId, 'troop_leader', troop.troopId);
    for (const deputyNpcId of troop.deputyNpcIds ?? []) add(deputyNpcId, 'deputy', troop.troopId);
    add(troop.strategistNpcId, 'strategist', troop.troopId);
  }
  return [...collected.values()];
}

function requireTargetHolding(state: RuntimeState, intent: WarStartIntent): void {
  if (intent.objective === 'defeat_enemy') return;
  const holdingId = intent.targetHoldingId;
  if (!holdingId || !(state.holdings ?? []).some((holding) => holding.holdingId === holdingId)) {
    throw new Error(`战争目标领地 ${holdingId ?? '(missing)'} 不存在于当前领地账本。`);
  }
}

function resolveCapturingFactionId(state: RuntimeState, intent: WarStartIntent): string | undefined {
  const factionIds = new Set(
    requireTroops(state, intent.playerForce.troopIds, '我方')
      .map((troop) => troop.factionId)
      .filter((id): id is string => Boolean(id)),
  );
  if (intent.objective === 'capture_holding' && factionIds.size !== 1) {
    throw new Error('攻取领地目标要求我方参战部队归属同一稳定 factionId。');
  }
  return factionIds.size === 1 ? [...factionIds][0] : undefined;
}

function createSnapshot(
  state: RuntimeState,
  sessionId: string,
  intent: WarStartIntent,
  options?: {
    repairStoredWarArtProjections?: boolean;
    preserveLegacyDeployableOverflow?: boolean;
    clampCommittedStrengthToDeployable?: boolean;
  },
): WarEncounterSnapshot {
  requireTargetHolding(state, intent);
  resolveCapturingFactionId(state, intent);
  const commanders = collectCommanderSources(state);
  const playerTroops = requireTroops(state, intent.playerForce.troopIds, '我方');
  const enemyTroops = requireTroops(state, intent.enemyForce.troopIds, '敌方');
  const alliedTheaterTroops = requireTroops(
    state,
    intent.participation?.alliedMainForceIds ?? [],
    '我方会战背景',
  );
  const enemyTheaterTroops = requireTroops(
    state,
    intent.participation?.enemyMainForceIds ?? [],
    '敌方会战背景',
  );
  const playerOfficers = collectSideOfficers({
    troops: playerTroops,
    commanderActorId: intent.playerForce.commanderActorId,
    sources: commanders,
    label: '我方',
  });
  const enemyOfficers = collectSideOfficers({
    troops: enemyTroops,
    commanderActorId: intent.enemyForce.commanderActorId,
    sources: commanders,
    label: '敌方',
  });
  const playerActorIds = new Set([
    ...(intent.playerForce.commanderActorId ? [intent.playerForce.commanderActorId] : []),
    ...playerOfficers.map((officer) => actorId(officer.source)),
  ]);
  const enemyActorIds = [
    ...(intent.enemyForce.commanderActorId ? [intent.enemyForce.commanderActorId] : []),
    ...enemyOfficers.map((officer) => actorId(officer.source)),
  ];
  const crossSideActorId = enemyActorIds.find((id) => playerActorIds.has(id));
  if (crossSideActorId) {
    throw new Error(`战争人员 ${crossSideActorId} 不能同时归属战争双方。`);
  }
  return createWarEncounterSnapshot({
    sessionId,
    intent,
    playerLevel: state.player.level ?? 1,
    warDifficulty: state.warDifficulty,
    playerTroops,
    enemyTroops,
    theaterTroops: {
      allied: alliedTheaterTroops,
      enemy: enemyTheaterTroops,
    },
    playerCommander: requireCommander(commanders, intent.playerForce.commanderActorId, '我方'),
    enemyCommander: requireCommander(commanders, intent.enemyForce.commanderActorId, '敌方'),
    playerOfficers,
    enemyOfficers,
    projections: createValidatedWarProjectionBundle(state.encounterV2?.semanticProjections ?? []),
    ...(options?.repairStoredWarArtProjections === false
      ? { repairStoredWarArtProjections: false }
      : {}),
    ...(options?.preserveLegacyDeployableOverflow === true
      ? { preserveLegacyDeployableOverflow: true }
      : {}),
    ...(options?.clampCommittedStrengthToDeployable === true
      ? { clampCommittedStrengthToDeployable: true }
      : {}),
  });
}

export function stageWarEncounter(inputState: RuntimeState, input: StageWarEncounterInput): RuntimeState {
  const intent = canonicalizeEncounterPlayerAlias(inputState, input.intent);
  if (intent.kind !== 'war') throw new Error('Batch 4 只接收 war 触发。');
  if (intent.sourceTurnNumber !== inputState.turnLog.length) {
    throw new Error(`战争触发回合 ${intent.sourceTurnNumber} 与当前已提交回合 ${inputState.turnLog.length} 不一致。`);
  }
  if (inputState.encounterV2?.active) {
    const active = inputState.encounterV2.active;
    if (active.session.intent.encounterId === intent.encounterId) return inputState;
    throw new Error(`已有未完成冲突 ${active.session.intent.encounterId}，不能启动新的战争。`);
  }

  const withIncomingProfiles = mergeEncounterSemanticProjections(inputState, input.projections);
  const withProfiles = ensureStructuredWarTroopProjections(withIncomingProfiles, intent);
  const sessionId = `session:${intent.encounterId}`;
  const snapshot = createSnapshot(withProfiles, sessionId, intent);
  const session = createPendingEncounterSession({
    sessionId,
    intent,
    snapshotHash: snapshot.snapshotHash,
    createdAt: input.createdAt,
  });
  const checkpoint = createPreEncounterCheckpoint(session, {
    checkpointId: `checkpoint:pre:${intent.encounterId}`,
    saveId: input.saveId,
    createdAt: input.createdAt,
  });
  const ledger = normalizeLedger(withProfiles);
  return {
    ...clone(withProfiles),
    encounterV2: { ...ledger, active: { session, checkpoint } },
  };
}

export function prepareWarEncounterForPlay(
  state: RuntimeState,
  input: PrepareWarEncounterForPlayInput,
): PreparedWarEncounter {
  const active = state.encounterV2?.active;
  if (!active || active.session.status !== 'pending' || active.checkpoint.checkpointKind !== 'pre_encounter') {
    throw new Error('当前没有可重新进入的开战前检查点。');
  }
  if (active.session.intent.kind !== 'war') throw new Error('当前冲突不是战争。');
  const warIntent = active.session.intent;
  const tryCreateSnapshot = (options?: Parameters<typeof createSnapshot>[3]) => {
    try {
      return createSnapshot(state, active.session.sessionId, warIntent, options);
    } catch {
      return undefined;
    }
  };
  let snapshot = tryCreateSnapshot();
  if (!snapshot) {
    // A legacy checkpoint may have frozen an amount that was valid only
    // because deployableSize had already drifted above the surviving size.
    // Repair it only after the stored hash exactly matches that old behavior.
    const exactLegacyOverflow = [
      tryCreateSnapshot({ preserveLegacyDeployableOverflow: true }),
      tryCreateSnapshot({
        repairStoredWarArtProjections: false,
        preserveLegacyDeployableOverflow: true,
      }),
    ].some((candidate) => candidate?.snapshotHash === active.session.snapshotHash);
    if (!exactLegacyOverflow) {
      // Re-run without swallowing the original contract error.
      createSnapshot(state, active.session.sessionId, warIntent);
      throw new Error('战争快照无法重建。');
    }
    snapshot = createSnapshot(state, active.session.sessionId, warIntent, {
      clampCommittedStrengthToDeployable: true,
    });
  }
  let snapshotHash = snapshot.snapshotHash;
  if (snapshotHash !== active.session.snapshotHash) {
    // Pending checkpoints may predate either stored-art compatibility repair
    // or the deployable-strength cap. Accept only an exact legacy hash, then
    // continue with the current corrected snapshot. Other state drift remains
    // a hard failure.
    const legacySnapshots = [
      tryCreateSnapshot({
        repairStoredWarArtProjections: false,
      }),
      tryCreateSnapshot({
        preserveLegacyDeployableOverflow: true,
      }),
      tryCreateSnapshot({
        repairStoredWarArtProjections: false,
        preserveLegacyDeployableOverflow: true,
      }),
    ];
    if (!legacySnapshots.some((legacySnapshot) => (
      legacySnapshot?.snapshotHash === active.session.snapshotHash
    ))) {
      throw new Error('战争快照与开战前检查点不一致。');
    }
    snapshotHash = snapshot.snapshotHash;
  }
  return {
    session: {
      ...beginEncounterSession(active.session, input.startedAt),
      snapshotHash,
    },
    snapshot,
    engineState: createInitialWarState(snapshot),
  };
}

function normalizedLifecycle(troop: TroopLedgerEntry): 'active' | 'unknown' {
  return troop.lifecycleStatus === 'unknown' ? 'unknown' : 'active';
}

function assertSetValue(current: unknown, before: unknown, after: unknown, field: string): void {
  if (current === after) return;
  if (current !== before) throw new Error(`${field} 当前值与战争快照不一致，拒绝覆盖。`);
}

function applyTroopDeltas(
  state: RuntimeState,
  result: SealedEncounterResult<UnsealedWarResult>,
  snapshot: WarEncounterSnapshot,
): void {
  const troops = state.troops ?? [];
  const byId = new Map(troops.map((troop) => [troop.troopId, troop]));
  const snapshotByTroopId = new Map(snapshot.forces.map((force) => [force.troopId, force]));
  for (const frozen of result.deltas) {
    if (frozen.targetKind !== 'troop') throw new Error(`不支持的 War V2 战果目标：${frozen.targetKind}。`);
    const delta = clone(frozen);
    const troop = byId.get(delta.targetId);
    if (!troop) throw new Error(`战争战果部队 ${delta.targetId} 不存在。`);
    if (delta.field === 'size') {
      const beforeSize = Number(delta.beforeValue);
      const afterSize = Number(delta.afterValue);
      const currentSize = troop.size;
      assertSetValue(currentSize, beforeSize, afterSize, `${troop.troopId}.size`);
      troop.previousSize = troop.size;
      troop.size = afterSize;
      if (troop.deployableSize !== undefined) {
        const currentDeployable = Math.min(
          Math.max(0, Math.round(troop.deployableSize)),
          Math.max(0, currentSize),
        );
        const casualtyLoss = currentSize === afterSize
          ? 0
          : Math.max(0, beforeSize - afterSize);
        troop.deployableSize = Math.min(
          afterSize,
          Math.max(0, currentDeployable - casualtyLoss),
        );
      }
    } else if (delta.field === 'morale') {
      assertSetValue(troop.morale, Number(delta.beforeValue), Number(delta.afterValue), `${troop.troopId}.morale`);
      troop.morale = Number(delta.afterValue);
    } else if (delta.field === 'supplies') {
      const current = normalizeWarSupply(troop.supplies).value;
      assertSetValue(current, Number(delta.beforeValue), Number(delta.afterValue), `${troop.troopId}.supplies`);
      troop.supplies = Number(delta.afterValue);
    } else if (delta.field === 'warFatiguePercent') {
      const current = resolveTroopFatiguePercent(troop);
      assertSetValue(current, Number(delta.beforeValue), Number(delta.afterValue), `${troop.troopId}.warFatiguePercent`);
      troop.warFatiguePercent = Number(delta.afterValue);
      troop.fatigue = troopFatigueBandFromPercent(troop.warFatiguePercent);
    } else if (delta.field === 'lifecycleStatus') {
      assertSetValue(normalizedLifecycle(troop), delta.beforeValue, delta.afterValue, `${troop.troopId}.lifecycleStatus`);
      troop.lifecycleStatus = delta.afterValue as TroopLedgerEntry['lifecycleStatus'];
    } else {
      throw new Error(`不支持的 War V2 部队字段：${delta.field}。`);
    }
  }

  for (const force of result.forces) {
    const troop = byId.get(force.troopId);
    if (!troop) continue;
    const frozenForce = snapshotByTroopId.get(force.troopId);
    const isDetachment = frozenForce?.commitmentKind === 'detachment';
    troop.lastBattleId = result.encounterId;
    // A War V2 result is a sealed record of a battle the player directly
    // participated in.  Once a troop appears in that result, its existence and
    // battlefield state are no longer hearsay.  Keep this deterministic fact in
    // the local ledger instead of waiting for a later narrator patch.
    troop.knownLevel = '亲历';
    troop.certainty = 'confirmed';
    troop.lastKnownAt = state.currentDate;
    troop.strengthTrend = force.remainingStrength < force.initialStrength ? 'decreased' : 'stable';
    troop.lastChangeReason = `War V2 ${result.encounterId} 结算`;
    troop.updatedAt = state.currentDate;
    troop.statusTags = [...new Set([
      ...(troop.statusTags ?? []),
      ...(isDetachment ? [] : force.statuses),
    ])];
    if (troop.lifecycleStatus === 'destroyed') troop.destroyedInBattleId = result.encounterId;
    const changeKind = troop.lifecycleStatus === 'destroyed'
      ? 'destroyed'
      : troop.lifecycleStatus === 'routed'
        ? 'routed'
        : troop.lifecycleStatus === 'surrendered'
          ? 'surrendered'
          : isDetachment && ['routed', 'destroyed', 'surrendered'].includes(force.lifecycleStatus)
            ? 'defeated'
            : 'strength_changed';
    const changeEvent = {
      eventId: `war:${result.encounterId}:${troop.troopId}`,
      kind: changeKind as NonNullable<TroopLedgerEntry['changeHistory']>[number]['kind'],
      occurredAt: state.currentDate,
      summary: isDetachment
        ? `${troop.name}本场投入${force.initialStrength}人，伤亡${force.casualties}人；原建制继续存续。`
        : `${troop.name}参加本场战争，伤亡${force.casualties}人，战后状态为${force.lifecycleStatus}。`,
      sourceNote: `War V2 ${result.encounterId}`,
    };
    const changeHistory = troop.changeHistory ?? [];
    if (!changeHistory.some((event) => event.eventId === changeEvent.eventId)) {
      troop.changeHistory = [...changeHistory, changeEvent].slice(-40);
    }
  }

  for (const faction of state.factions ?? []) {
    faction.relatedTroopIds = normalizeCurrentTroopReferenceIds(faction.relatedTroopIds, troops);
  }
  for (const holding of state.holdings ?? []) {
    holding.garrisonTroopIds = normalizeCurrentTroopReferenceIds(holding.garrisonTroopIds, troops);
  }
}

function applyWarObjective(
  state: RuntimeState,
  intent: WarStartIntent,
  result: SealedEncounterResult<UnsealedWarResult>,
): void {
  if (intent.participation?.commandScope === 'subordinate_sector') return;
  if (!result.objectiveAchieved || intent.objective === 'defeat_enemy') return;
  const holding = (state.holdings ?? []).find((entry) => entry.holdingId === intent.targetHoldingId);
  if (!holding) throw new Error(`战争目标领地 ${intent.targetHoldingId} 在结算时不存在。`);
  if (intent.objective === 'capture_holding') {
    const factionId = resolveCapturingFactionId(state, intent);
    if (!factionId) throw new Error('攻取领地结算缺少唯一我方势力。');
    const faction = state.factions?.find((entry) => entry.factionId === factionId);
    holding.factionId = factionId;
    holding.actualController = faction?.name ?? factionId;
    holding.garrisonTroopIds = normalizeCurrentTroopReferenceIds(intent.playerForce.troopIds, state.troops ?? []);
  }
  holding.status = 'controlled';
  delete holding.siege;
  holding.updatedAt = state.currentDate;
  holding.recentChanges = [
    ...(holding.recentChanges ?? []),
    `${state.currentDate}：War V2 目标 ${intent.objective} 已完成。`,
  ];
}

function outcomeLabel(outcome: UnsealedWarResult['outcome']): string {
  const labels: Record<UnsealedWarResult['outcome'], string> = {
    player_victory: '我方胜利',
    enemy_victory: '我方战败',
    draw: '双方战平',
    player_retreat: '我方撤退',
    enemy_retreat: '敌方撤退',
    surrender: '一方投降',
  };
  return labels[outcome];
}

function resultLevel(result: SealedEncounterResult<UnsealedWarResult>): ConflictRecord['resultLevel'] {
  if (result.outcome === 'player_victory' || result.outcome === 'enemy_retreat') return 'decisiveWin';
  if (result.outcome === 'draw') return 'stalemate';
  if (result.outcome === 'player_retreat') return 'minorLoss';
  return 'decisiveLoss';
}

function warRecordType(intent: WarStartIntent): ConflictRecord['type'] {
  if (intent.environmentTags.includes('water')) return '水战';
  if (intent.objective === 'capture_holding') return '围城';
  if (intent.objective === 'break_siege' || intent.objective === 'relieve_siege') return '守城';
  return '野战';
}

function upsertWarRecord(
  state: RuntimeState,
  session: PreparedWarEncounter['session'],
  result: SealedEncounterResult<UnsealedWarResult>,
  snapshot: WarEncounterSnapshot,
  occurredAt: string,
  locationName?: string,
): void {
  const factionIds = [...new Set(snapshot.forces
    .map((force) => state.troops?.find((troop) => troop.troopId === force.troopId)?.factionId)
    .filter((id): id is string => Boolean(id)))];
  const troopNames = new Map(snapshot.forces.map((force) => [force.troopId, force.name]));
  const label = outcomeLabel(result.outcome);
  const isLocalMission = (session.intent as WarStartIntent).participation?.commandScope === 'subordinate_sector';
  const record: ConflictRecord = {
    conflictId: result.encounterId,
    type: warRecordType(session.intent as WarStartIntent),
    title: session.intent.reason,
    summary: `${session.intent.reason}，${isLocalMission ? '局部任务' : '本地战争'}判定为${label}。`,
    occurredAt,
    outcome: label,
    scope: 'selfRelated',
    recordLevel: 'full',
    locationId: session.intent.locationId,
    locationName,
    sides: ['我方', '敌方'],
    commanderNpcIds: result.commanders.map((commander) => commander.actorId),
    involvedTroopIds: result.forces.map((force) => force.troopId),
    involvedFactionIds: factionIds,
    involvedNpcIds: result.commanders.map((commander) => commander.actorId),
    result: label,
    resultLevel: resultLevel(result),
    winnerSide: result.outcome === 'player_victory' ? '我方' : result.outcome === 'enemy_victory' ? '敌方' : undefined,
    loserSide: result.outcome === 'player_victory' ? '敌方' : result.outcome === 'enemy_victory' ? '我方' : undefined,
    judgement: {
      method: 'warEngineV2',
      perspectiveSide: '我方',
      tacticalAssessment: `完成 ${result.roundsCompleted} 轮${isLocalMission ? '会战局部任务' : '本地战争'}确定性结算。`,
    },
    resultTags: [result.objective, result.exitReason, result.objectiveAchieved ? 'objective_achieved' : 'objective_failed'],
    decisiveFactors: [`战争目标：${result.objective}`, `结束原因：${result.exitReason}`],
    troopEffects: result.forces.map((force) => (
      `${troopNames.get(force.troopId) ?? force.troopId}：${force.initialStrength} → ${force.remainingStrength}，伤亡 ${force.casualties}`
    )),
    placeEffects: result.objectiveAchieved && (session.intent as WarStartIntent).targetHoldingId
      ? [`目标领地 ${(session.intent as WarStartIntent).targetHoldingId} 已完成 ${result.objective}`]
      : [],
    imageKey: (session.intent as WarStartIntent).environmentTags.includes('water')
      ? 'riverbattle water'
      : (session.intent as WarStartIntent).objective === 'capture_holding'
        ? 'siege outerwall'
        : result.pursuit.status === 'resolved'
          ? 'rout pursuit'
          : 'openfield formation',
    updatedAt: state.currentDate,
  };
  state.conflicts = state.conflicts ?? [];
  const index = state.conflicts.findIndex((entry) => entry.conflictId === record.conflictId);
  if (index >= 0) state.conflicts[index] = record;
  else state.conflicts.push(record);
}

export function commitWarResultToRuntime(inputState: RuntimeState, input: CommitWarResultInput): RuntimeState {
  if (!verifyEncounterResultHash(input.result)) throw new Error('War V2 战果哈希校验失败。');
  if (input.result.kind !== 'war') throw new Error('War V2 只接受战争战果。');
  const ledger = normalizeLedger(inputState);
  if (ledger.appliedResultHashes.includes(input.result.resultHash)) return inputState;
  const active = ledger.active;
  if (!active || active.checkpoint.checkpointKind !== 'pre_encounter') {
    throw new Error('缺少开战前检查点，不能提交战争战果。');
  }
  if (active.session.sessionId !== input.session.sessionId) throw new Error('战争战果会话与活动检查点不一致。');
  if (input.session.intent.kind !== 'war') throw new Error('战争结算会话类型不正确。');

  const snapshot = createSnapshot(inputState, input.session.sessionId, input.session.intent, {
    clampCommittedStrengthToDeployable: true,
  });
  if (snapshot.snapshotHash !== input.session.snapshotHash) throw new Error('战争快照哈希与会话不一致。');
  const resolved = resolveEncounterSessionWithSealedResult(input.session, input.result, input.committedAt);
  const narrativePending = markEncounterNarrativePending(resolved, input.committedAt);
  const postCheckpoint = createPostEncounterResultCheckpoint(resolved, {
    checkpointId: `checkpoint:post:${input.session.intent.encounterId}`,
    saveId: input.saveId,
    createdAt: input.committedAt,
  });

  let next = clone(inputState);
  const occurredAt = next.currentDate;
  next.player = applyPlayerExperience(
    next.player,
    input.result.experienceAward,
    '战争历练',
  ).player;
  applyTroopDeltas(next, input.result, snapshot);
  applyWarObjective(next, input.session.intent, input.result);
  next = applyWarUniqueArtProgress(next, snapshot, input.result, occurredAt);
  advanceRuntimeClock(next, { minutesAdvanced: input.result.elapsedMinutes });
  upsertWarRecord(next, input.session, input.result, snapshot, occurredAt, input.locationName);
  next.encounterV2 = {
    ...ledger,
    appliedResultHashes: [...ledger.appliedResultHashes, input.result.resultHash],
    active: { session: narrativePending, checkpoint: postCheckpoint },
  };
  return next;
}

export function completeWarNarrativeTurn(
  inputState: RuntimeState,
  input: CompleteWarNarrativeTurnInput,
): RuntimeState {
  const ledger = normalizeLedger(inputState);
  if (ledger.narratedResultHashes.includes(input.resultHash)) return inputState;
  const active = ledger.active;
  if (
    !active
    || active.session.status !== 'narrative_pending'
    || active.session.intent.kind !== 'war'
    || active.checkpoint.checkpointKind !== 'post_result'
    || active.checkpoint.result.kind !== 'war'
    || active.checkpoint.result.resultHash !== input.resultHash
  ) {
    throw new Error('当前没有与该战果匹配的待生成战后正文。');
  }
  const next = clone(inputState);
  const record = next.conflicts?.find((entry) => entry.conflictId === active.session.intent.encounterId);
  if (!record) throw new Error(`战争战果 ${active.session.intent.encounterId} 缺少本地战事记录。`);
  record.reportText = input.narrativeText;
  record.updatedAt = next.currentDate;

  const turnNumber = next.turnLog.length + 1;
  next.turnLog.push({
    turnNumber,
    date: next.currentDate,
    playerInput: `【战争结算】${active.session.intent.reason}`,
    narrativeText: input.narrativeText.length > 240 ? `${input.narrativeText.slice(0, 240)}…` : input.narrativeText,
    fullNarrativeText: input.narrativeText,
    statePatchSummary: `War V2 战果 ${input.resultHash} 已幂等合并`,
    timestamp: input.completedAt,
    suggestedActions: clone(input.suggestedActions),
    displayMeta: {
      title: `第 ${turnNumber} 回合`,
      provider: input.provider,
      model: input.model,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      totalTokens: input.totalTokens,
      rawResponse: input.rawResponse,
    },
  });
  markEncounterNarrated(active.session, input.completedAt);
  const nextLedger = normalizeLedger(next);
  nextLedger.narratedResultHashes = [...nextLedger.narratedResultHashes, input.resultHash];
  delete nextLedger.active;
  next.encounterV2 = nextLedger;
  return next;
}
