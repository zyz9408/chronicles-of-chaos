import type {
  Actor,
  CombatOutcomeTag,
  CombatRecord,
  InventoryItem,
  LuanShiNpc,
  RuntimeState,
  SuggestedAction,
} from '../types';
import { advanceRuntimeClock } from '../time/gameClock';
import {
  type EncounterRuntimeLedger,
  type PersonalCombatStartIntent,
  type SealedEncounterResult,
  type SemanticProjection,
  type UnsealedCombatResult,
} from './EncounterContracts';
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
import {
  createCombatEncounterSnapshot,
  createValidatedCombatProjectionBundle,
} from './CombatSnapshotAdapter';
import { createCombatEngineState } from './CombatEngine';
import type {
  CombatCharacterSource,
  CombatEncounterSnapshot,
  CombatEngineState,
  CombatThreatTier,
} from './CombatTypes';
import { canonicalizeEncounterPlayerAlias } from './EncounterIntentCanonicalization';

export interface StageCombatEncounterInput {
  saveId: string;
  intent: PersonalCombatStartIntent;
  projections: SemanticProjection[];
  createdAt: string;
}

export interface PrepareCombatEncounterForPlayInput {
  selectedPlayerActorIds?: string[];
  startedAt: string;
}

export interface PreparedCombatEncounter {
  session: NonNullable<EncounterRuntimeLedger['active']>['session'];
  snapshot: CombatEncounterSnapshot;
  engineState: CombatEngineState;
}

export interface CommitCombatResultInput {
  saveId: string;
  session: PreparedCombatEncounter['session'];
  result: SealedEncounterResult<UnsealedCombatResult>;
  committedAt: string;
  locationName?: string;
}

export interface CompleteCombatNarrativeTurnInput {
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

export function mergeEncounterSemanticProjections(
  state: RuntimeState,
  incoming: readonly SemanticProjection[],
): RuntimeState {
  if (incoming.length === 0) return state;
  const ledger = normalizeLedger(state);
  const bySourceId = new Map(ledger.semanticProjections.map((profile) => [profile.sourceId, profile]));
  for (const profile of incoming) bySourceId.set(profile.sourceId, clone(profile));
  const bundle = createValidatedCombatProjectionBundle([...bySourceId.values()]);
  return {
    ...clone(state),
    encounterV2: {
      ...ledger,
      semanticProjections: clone(bundle.profiles),
    },
  };
}

function characterId(source: CombatCharacterSource): string {
  const id = source.id ?? source.npcId;
  if (!id) throw new Error(`角色 ${source.name} 缺少稳定 ID。`);
  return id;
}

function collectCharacterSources(state: RuntimeState): Map<string, CombatCharacterSource> {
  const sources = new Map<string, CombatCharacterSource>();
  const add = (source: CombatCharacterSource) => {
    const id = characterId(source);
    if (!sources.has(id)) sources.set(id, source);
  };
  add({ ...state.player, persistent: true });
  for (const npc of state.npcs ?? []) add({ ...npc, persistent: true });
  for (const actor of state.knownActors ?? []) add({ ...actor, persistent: true });
  return sources;
}

function requireSources(
  state: RuntimeState,
  actorIds: readonly string[],
  label: string,
): CombatCharacterSource[] {
  const sources = collectCharacterSources(state);
  return actorIds.map((actorId) => {
    const source = sources.get(actorId);
    if (!source) throw new Error(`${label}参战者 ${actorId} 不存在于当前角色账本。`);
    return source;
  });
}

function calculateThreatTier(
  playerSources: readonly CombatCharacterSource[],
  enemySources: readonly CombatCharacterSource[],
): CombatThreatTier {
  const strength = (sources: readonly CombatCharacterSource[]) => sources.reduce(
    (sum, source) => sum + Math.max(1, source.level ?? 1) * (0.5 + ((source.abilityScores?.武力 ?? 50) / 100)),
    0,
  );
  const ratio = strength(enemySources) / Math.max(1, strength(playerSources));
  if (ratio < 0.7) return 'minor';
  if (ratio <= 1.2) return 'standard';
  if (ratio <= 1.7) return 'major';
  return 'deadly';
}

function collectLootableItemIds(enemySources: readonly CombatCharacterSource[]): string[] {
  return enemySources.flatMap((source) => (source.inventory ?? [])
    .filter((item) => item.quantity > 0 && item.keyItem !== true)
    .map((item) => item.id));
}

function collectCapturableEquipmentIds(enemySources: readonly CombatCharacterSource[]): string[] {
  return enemySources.flatMap((source) => (source.equipment ?? []).map((item) => item.id));
}

function createSnapshot(
  state: RuntimeState,
  sessionId: string,
  intent: PersonalCombatStartIntent,
): CombatEncounterSnapshot {
  const playerSources = requireSources(state, intent.playerParty.actorIds, '我方');
  const enemySources = requireSources(state, intent.enemyParty.actorIds, '敌方');
  const downedPlayer = playerSources.find((source) => (
    (source.id === state.player.id || source.id === 'player')
    && Number.isFinite(source.vitals?.hp)
    && (source.vitals?.hp ?? 0) <= 0
  ));
  if (downedPlayer) {
    throw new Error('玩家当前生命为 0，必须先治疗休养，不能进入战斗。');
  }
  const allowLoot = intent.policy.lootPolicy === 'actual_items_only';
  return createCombatEncounterSnapshot({
    sessionId,
    intent,
    playerSources,
    enemySources,
    projections: createValidatedCombatProjectionBundle(state.encounterV2?.semanticProjections ?? []),
    threatTier: calculateThreatTier(playerSources, enemySources),
    lootableItemIds: allowLoot ? collectLootableItemIds(enemySources) : [],
    capturableEquipmentItemIds: allowLoot ? collectCapturableEquipmentIds(enemySources) : [],
  });
}

export function stageCombatEncounter(
  inputState: RuntimeState,
  input: StageCombatEncounterInput,
): RuntimeState {
  const intent = canonicalizeEncounterPlayerAlias(inputState, input.intent);
  if (intent.kind !== 'personal_combat') throw new Error('Batch 2 只接收 personal_combat 触发。');
  if (intent.sourceTurnNumber !== inputState.turnLog.length) {
    throw new Error(`战斗触发回合 ${intent.sourceTurnNumber} 与当前已提交回合 ${inputState.turnLog.length} 不一致。`);
  }
  if (inputState.encounterV2?.active) {
    const active = inputState.encounterV2.active;
    if (active.session.intent.encounterId === intent.encounterId) return inputState;
    throw new Error(`已有未完成冲突 ${active.session.intent.encounterId}，不能启动新的战斗。`);
  }

  const withProfiles = mergeEncounterSemanticProjections(inputState, input.projections);
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
    encounterV2: {
      ...ledger,
      active: { session, checkpoint },
    },
  };
}

function resolveSelectedPlayerIds(
  intent: PersonalCombatStartIntent,
  selected: readonly string[] | undefined,
): string[] {
  if (intent.partySelection === 'locked') return [...intent.playerParty.actorIds];
  const next = selected?.length ? [...selected] : [...intent.playerParty.actorIds];
  if (next.length < 1 || next.length > 3 || new Set(next).size !== next.length) {
    throw new Error('我方同时上场人数必须为 1—3 人且不得重复。');
  }
  const candidates = new Set(intent.playerParty.actorIds);
  for (const actorId of next) {
    if (!candidates.has(actorId)) throw new Error(`我方选择 ${actorId} 不在开战候选名单。`);
  }
  return next;
}

export function prepareCombatEncounterForPlay(
  state: RuntimeState,
  input: PrepareCombatEncounterForPlayInput,
): PreparedCombatEncounter {
  const active = state.encounterV2?.active;
  if (!active || active.session.status !== 'pending' || active.checkpoint.checkpointKind !== 'pre_encounter') {
    throw new Error('当前没有可重新进入的开战前检查点。');
  }
  if (active.session.intent.kind !== 'personal_combat') throw new Error('当前冲突不是个人战。');
  const intent: PersonalCombatStartIntent = {
    ...clone(active.session.intent),
    playerParty: {
      actorIds: resolveSelectedPlayerIds(active.session.intent, input.selectedPlayerActorIds),
    },
  };
  const snapshot = createSnapshot(state, active.session.sessionId, intent);
  const pending = createPendingEncounterSession({
    sessionId: active.session.sessionId,
    intent,
    snapshotHash: snapshot.snapshotHash,
    createdAt: active.session.createdAt,
  });
  const session = beginEncounterSession(pending, input.startedAt);
  return {
    session,
    snapshot,
    engineState: createCombatEngineState(snapshot),
  };
}

type MutableCharacter = (Actor | LuanShiNpc) & { combatStatuses?: string[] };

function updateCharacterById(
  state: RuntimeState,
  actorId: string,
  update: (character: MutableCharacter) => void,
): void {
  let matched = false;
  if (state.player.id === actorId) {
    update(state.player);
    matched = true;
  }
  for (const actor of state.knownActors) {
    if (actor.id !== actorId) continue;
    update(actor);
    matched = true;
  }
  for (const npc of state.npcs ?? []) {
    if (npc.npcId !== actorId) continue;
    update(npc);
    matched = true;
  }
  if (!matched) throw new Error(`战果目标角色 ${actorId} 不存在。`);
}

function applySetNumber(current: number, before: number, after: number, field: string): number {
  if (current === after) return current;
  if (current !== before) throw new Error(`${field} 当前值 ${current} 与战斗快照 ${before} 不一致，拒绝覆盖。`);
  return after;
}

function applyActorDelta(
  state: RuntimeState,
  delta: UnsealedCombatResult['deltas'][number],
): void {
  updateCharacterById(state, delta.targetId, (character) => {
    if (delta.field === 'vitals.hp') {
      const before = Number(delta.beforeValue);
      const after = Number(delta.afterValue);
      const vitals = character.vitals ?? { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 };
      vitals.hp = applySetNumber(vitals.hp, before, after, `${delta.targetId}.vitals.hp`);
      character.vitals = vitals;
      return;
    }
    if (delta.field === 'vitals.stamina') {
      const before = Number(delta.beforeValue);
      const after = Number(delta.afterValue);
      const vitals = character.vitals ?? { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 };
      vitals.stamina = applySetNumber(vitals.stamina, before, after, `${delta.targetId}.vitals.stamina`);
      character.vitals = vitals;
      return;
    }
    if (delta.field === 'combatStatuses') {
      const before = JSON.stringify(character.combatStatuses ?? []);
      const expectedBefore = JSON.stringify(delta.beforeValue);
      const expectedAfter = JSON.stringify(delta.afterValue);
      if (before !== expectedBefore && before !== expectedAfter) {
        throw new Error(`${delta.targetId}.combatStatuses 与战斗快照不一致，拒绝覆盖。`);
      }
      character.combatStatuses = clone(delta.afterValue as string[]);
      return;
    }
    if (delta.field === 'xp') {
      const before = Number(delta.beforeValue);
      const after = Number(delta.afterValue);
      const current = 'xp' in character && typeof character.xp === 'number' ? character.xp : 0;
      const next = applySetNumber(current, before, after, `${delta.targetId}.xp`);
      if ('xp' in character) character.xp = next;
      return;
    }
    throw new Error(`不支持的角色战果字段：${delta.field}。`);
  });
}

function applyItemDelta(state: RuntimeState, delta: UnsealedCombatResult['deltas'][number]): void {
  const holders: Array<Actor | LuanShiNpc> = [state.player, ...state.knownActors, ...(state.npcs ?? [])]
    .filter((character) => character.inventory?.some((item) => item.id === delta.targetId));
  const unique = [...new Set(holders)];
  if (unique.length !== 1) throw new Error(`物品 ${delta.targetId} 必须有且只有一个持有人。`);
  const holder = unique[0];
  const item = holder.inventory!.find((candidate) => candidate.id === delta.targetId)!;
  item.quantity = applySetNumber(item.quantity, Number(delta.beforeValue), Number(delta.afterValue), `${delta.targetId}.quantity`);
  if (item.quantity <= 0) holder.inventory = holder.inventory!.filter((candidate) => candidate.id !== delta.targetId);
}

function applyResultDeltas(state: RuntimeState, result: SealedEncounterResult<UnsealedCombatResult>): void {
  for (const frozenDelta of result.deltas) {
    const delta = clone(frozenDelta) as UnsealedCombatResult['deltas'][number];
    if (delta.targetKind === 'actor') applyActorDelta(state, delta);
    else if (delta.targetKind === 'item' && delta.field === 'quantity') applyItemDelta(state, delta);
    else throw new Error(`不支持的 Combat V2 战果增量：${delta.targetKind}.${delta.field}。`);
  }
}

function takeInventoryItem(character: Actor | LuanShiNpc, itemId: string): InventoryItem | undefined {
  const item = character.inventory?.find((candidate) => candidate.id === itemId);
  if (!item) return undefined;
  character.inventory = character.inventory?.filter((candidate) => candidate.id !== itemId);
  return clone(item);
}

function enemyCharacters(state: RuntimeState, result: SealedEncounterResult<UnsealedCombatResult>): Array<Actor | LuanShiNpc> {
  const ids = new Set(result.combatants.filter((entry) => entry.side === 'enemy').map((entry) => entry.actorId));
  return [...state.knownActors, ...(state.npcs ?? [])]
    .filter((character) => ids.has('id' in character ? character.id : character.npcId));
}

function addPlayerInventoryItem(state: RuntimeState, item: InventoryItem): void {
  state.player.inventory = state.player.inventory ?? [];
  const existing = state.player.inventory.find((candidate) => candidate.id === item.id);
  if (existing) existing.quantity += item.quantity;
  else state.player.inventory.push(item);
}

function transferResultLoot(state: RuntimeState, result: SealedEncounterResult<UnsealedCombatResult>): void {
  const enemies = enemyCharacters(state, result);
  for (const itemId of result.lootItemIds) {
    const matches = enemies.map((enemy) => ({ enemy, item: enemy.inventory?.find((item) => item.id === itemId) }))
      .filter((entry): entry is { enemy: Actor | LuanShiNpc; item: InventoryItem } => Boolean(entry.item));
    if (matches.length !== 1) throw new Error(`战利品 ${itemId} 的来源不唯一。`);
    const item = takeInventoryItem(matches[0].enemy, itemId);
    if (item) addPlayerInventoryItem(state, item);
  }
  for (const equipmentId of result.capturedEquipmentItemIds) {
    const matches = enemies.map((enemy) => ({
      enemy,
      item: enemy.equipment?.find((item) => item.id === equipmentId),
    })).filter((entry) => Boolean(entry.item));
    if (matches.length !== 1) throw new Error(`缴获装备 ${equipmentId} 的来源不唯一。`);
    const { enemy, item } = matches[0];
    enemy.equipment = enemy.equipment?.filter((candidate) => candidate.id !== equipmentId);
    if (item) {
      addPlayerInventoryItem(state, {
        ...clone(item),
        quantity: 1,
        category: 'equipment',
        equipSlot: item.slot,
      });
    }
  }
}

function resultOutcomeText(result: SealedEncounterResult<UnsealedCombatResult>): string {
  const labels: Record<UnsealedCombatResult['outcome'], string> = {
    player_victory: '我方胜利',
    enemy_victory: '我方战败',
    draw: '双方战平',
    player_retreat: '我方撤离',
    enemy_retreat: '敌方撤退',
    surrender: '一方投降',
  };
  return labels[result.outcome];
}

function resultLevel(result: SealedEncounterResult<UnsealedCombatResult>): CombatRecord['resultLevel'] {
  if (result.outcome === 'player_victory' || result.outcome === 'enemy_retreat') return 'win';
  if (result.outcome === 'draw') return 'stalemate';
  return 'loss';
}

function resultTags(result: SealedEncounterResult<UnsealedCombatResult>): CombatOutcomeTag[] {
  const tags = new Set<CombatOutcomeTag>();
  if (result.outcome === 'player_retreat' || result.outcome === 'enemy_retreat') tags.add('forceRetreat');
  for (const combatant of result.combatants) {
    if (combatant.statuses.includes('dead')) tags.add('kill');
    if (combatant.statuses.includes('captured')) tags.add('capture');
    if (combatant.statuses.includes('severely_wounded')) tags.add('seriousWound');
    else if (combatant.downCount > 0) tags.add('wound');
  }
  return [...tags];
}

function upsertLocalCombatRecord(
  state: RuntimeState,
  session: PreparedCombatEncounter['session'],
  result: SealedEncounterResult<UnsealedCombatResult>,
  snapshot: CombatEncounterSnapshot,
  occurredAt: string,
  locationName?: string,
): void {
  const participantNames = new Map(snapshot.combatants.map((combatant) => [combatant.actorId, combatant.name]));
  const outcome = resultOutcomeText(result);
  const record: CombatRecord = {
    combatId: session.intent.encounterId,
    kind: 'melee',
    title: session.intent.reason,
    summary: `${session.intent.reason}，本地规则裁定结果为${outcome}。`,
    occurredAt,
    locationId: session.intent.locationId,
    locationName,
    participants: result.combatants.map((combatant) => ({
      participantId: combatant.actorId,
      npcId: combatant.actorId === state.player.id ? undefined : combatant.actorId,
      name: participantNames.get(combatant.actorId) ?? combatant.actorId,
      side: combatant.side === 'player'
        ? (combatant.actorId === state.player.id ? 'player' : 'ally')
        : 'enemy',
      outcome: combatant.statuses.join('、') || (combatant.hp > 0 ? '仍可行动' : '倒地'),
    })),
    playerInvolved: result.combatants.some((combatant) => combatant.actorId === state.player.id),
    resultLevel: resultLevel(result),
    outcomeTags: resultTags(result),
    outcome,
    significance: snapshot.threatTier === 'deadly' ? 'major' : 'notable',
    chronicleWorthy: snapshot.threatTier === 'deadly',
    relatedNpcIds: result.combatants
      .map((combatant) => combatant.actorId)
      .filter((actorId) => actorId !== state.player.id),
    briefText: `行动 ${result.actionLog.length} 次，耗时 ${result.elapsedMinutes} 分钟。`,
    visualTags: result.actionLog.map((entry) => entry.summaryKey),
    updatedAt: state.currentDate,
  };
  state.combatRecords = state.combatRecords ?? [];
  const index = state.combatRecords.findIndex((entry) => entry.combatId === record.combatId);
  if (index >= 0) state.combatRecords[index] = record;
  else state.combatRecords.push(record);
}

export function commitCombatResultToRuntime(
  inputState: RuntimeState,
  input: CommitCombatResultInput,
): RuntimeState {
  if (!verifyEncounterResultHash(input.result)) throw new Error('Combat V2 战果哈希校验失败。');
  const ledger = normalizeLedger(inputState);
  if (ledger.appliedResultHashes.includes(input.result.resultHash)) return inputState;
  const active = ledger.active;
  if (!active || active.checkpoint.checkpointKind !== 'pre_encounter') {
    throw new Error('缺少开战前检查点，不能提交战果。');
  }
  if (active.session.sessionId !== input.session.sessionId) throw new Error('战果会话与活动检查点不一致。');

  const snapshot = createSnapshot(inputState, input.session.sessionId, input.session.intent as PersonalCombatStartIntent);
  if (snapshot.snapshotHash !== input.session.snapshotHash) throw new Error('战斗快照哈希与会话不一致。');
  const resolved = resolveEncounterSessionWithSealedResult(input.session, input.result, input.committedAt);
  const narrativePending = markEncounterNarrativePending(resolved, input.committedAt);
  const postCheckpoint = createPostEncounterResultCheckpoint(resolved, {
    checkpointId: `checkpoint:post:${input.session.intent.encounterId}`,
    saveId: input.saveId,
    createdAt: input.committedAt,
  });

  const next = clone(inputState);
  const occurredAt = next.currentDate;
  applyResultDeltas(next, input.result);
  transferResultLoot(next, input.result);
  advanceRuntimeClock(next, { minutesAdvanced: input.result.elapsedMinutes });
  upsertLocalCombatRecord(next, input.session, input.result, snapshot, occurredAt, input.locationName);
  next.encounterV2 = {
    ...ledger,
    appliedResultHashes: [...ledger.appliedResultHashes, input.result.resultHash],
    active: { session: narrativePending, checkpoint: postCheckpoint },
  };
  return next;
}

export function completeCombatNarrativeTurn(
  inputState: RuntimeState,
  input: CompleteCombatNarrativeTurnInput,
): RuntimeState {
  const ledger = normalizeLedger(inputState);
  if (ledger.narratedResultHashes.includes(input.resultHash)) return inputState;
  const active = ledger.active;
  if (
    !active
    || active.session.status !== 'narrative_pending'
    || active.checkpoint.checkpointKind !== 'post_result'
    || active.checkpoint.result.resultHash !== input.resultHash
  ) {
    throw new Error('当前没有与该战果匹配的待生成战后正文。');
  }
  const next = clone(inputState);
  const result = active.checkpoint.result;
  const record = next.combatRecords?.find((entry) => entry.combatId === result.encounterId);
  if (!record) throw new Error(`战果 ${result.encounterId} 缺少本地战斗记录。`);
  record.reportText = input.narrativeText;
  record.updatedAt = next.currentDate;

  const turnNumber = next.turnLog.length + 1;
  next.turnLog.push({
    turnNumber,
    date: next.currentDate,
    playerInput: `【战斗结算】${active.session.intent.reason}`,
    narrativeText: input.narrativeText.length > 240 ? `${input.narrativeText.slice(0, 240)}…` : input.narrativeText,
    fullNarrativeText: input.narrativeText,
    statePatchSummary: `Combat V2 战果 ${input.resultHash} 已幂等合并`,
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

export function assertEncounterPersistenceAllowed(state: RuntimeState): void {
  if (state.encounterV2?.active?.session.status === 'fighting') {
    throw new Error('战斗进行中禁止存档，战争同样如此；请完成当前冲突，或读取开战前检查点重新开始。');
  }
}
