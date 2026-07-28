import {
  type EncounterCheckpoint,
  type EncounterSession,
  type EncounterSessionStatus,
  type EncounterStartIntent,
  type PostEncounterResultCheckpoint,
  type PreEncounterCheckpoint,
  type SealedEncounterResult,
  type UnsealedEncounterResult,
} from './EncounterContracts';
import {
  assertValidEncounterResultPayload,
  assertValidEncounterStartIntent,
} from './EncounterContractValidation';
import {
  canonicalStringify,
  sealEncounterResult,
  verifyEncounterResultHash,
} from './EncounterDeterminism';

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const HASH_PATTERN = /^fnv1a64:[0-9a-f]{16}$/;

export class EncounterStateTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncounterStateTransitionError';
  }
}

export interface CreatePendingEncounterSessionInput {
  sessionId: string;
  intent: EncounterStartIntent;
  snapshotHash: string;
  createdAt: string;
}

export interface CreateEncounterCheckpointInput {
  checkpointId: string;
  saveId: string;
  createdAt: string;
}

function assertStableId(value: string, field: string): void {
  if (!STABLE_ID_PATTERN.test(value)) throw new Error(`${field} 不是合法的稳定 ID。`);
}

function assertTimestamp(value: string, field: string): void {
  if (typeof value !== 'string' || value.length === 0 || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} 必须是合法时间。`);
  }
}

function assertStatus(session: EncounterSession, allowed: readonly EncounterSessionStatus[], operation: string): void {
  if (!allowed.includes(session.status)) {
    throw new EncounterStateTransitionError(
      `${operation} 不允许从 ${session.status} 状态执行；允许状态：${allowed.join(', ')}。`,
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as object).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
}

function frozenCanonicalCopy<T>(value: T): T {
  return deepFreeze(JSON.parse(canonicalStringify(value)) as T);
}

export function createPendingEncounterSession(input: CreatePendingEncounterSessionInput): EncounterSession {
  assertStableId(input.sessionId, 'sessionId');
  if (!HASH_PATTERN.test(input.snapshotHash)) throw new Error('snapshotHash 必须是合法的 fnv1a64 哈希。');
  assertTimestamp(input.createdAt, 'createdAt');
  assertValidEncounterStartIntent(input.intent);

  return frozenCanonicalCopy({
    sessionId: input.sessionId,
    status: 'pending' as const,
    intent: input.intent,
    snapshotHash: input.snapshotHash,
    createdAt: input.createdAt,
  });
}

export function beginEncounterSession(session: EncounterSession, startedAt: string): EncounterSession {
  assertStatus(session, ['pending'], '开始冲突');
  assertTimestamp(startedAt, 'startedAt');
  return frozenCanonicalCopy({ ...session, status: 'fighting' as const, startedAt });
}

function assertResultMatchesSession(session: EncounterSession, result: UnsealedEncounterResult): void {
  const expectedFields: Array<keyof Pick<
    UnsealedEncounterResult,
    'sessionId' | 'encounterId' | 'kind' | 'rulesetVersion' | 'sourceTurnNumber' | 'seed'
  >> = ['sessionId', 'encounterId', 'kind', 'rulesetVersion', 'sourceTurnNumber', 'seed'];

  for (const field of expectedFields) {
    const expected = field === 'sessionId' ? session.sessionId : session.intent[field];
    if (result[field] !== expected) {
      throw new Error(`EncounterResult.${field} 与活动会话不一致。`);
    }
  }

  if (session.intent.kind === 'personal_combat' && result.kind === 'personal_combat') {
    const expectedPlayerIds = [...session.intent.playerParty.actorIds].sort();
    const expectedEnemyIds = [...session.intent.enemyParty.actorIds].sort();
    const resultPlayerIds = result.combatants
      .filter((combatant) => combatant.side === 'player')
      .map((combatant) => combatant.actorId)
      .sort();
    const resultEnemyIds = result.combatants
      .filter((combatant) => combatant.side === 'enemy')
      .map((combatant) => combatant.actorId)
      .sort();
    if (canonicalStringify(resultPlayerIds) !== canonicalStringify(expectedPlayerIds)) {
      throw new Error('EncounterResult.combatants 的我方 actorId 与开战快照不一致。');
    }
    if (canonicalStringify(resultEnemyIds) !== canonicalStringify(expectedEnemyIds)) {
      throw new Error('EncounterResult.combatants 的敌方 actorId 与开战快照不一致。');
    }
  }

  if (session.intent.kind === 'war' && result.kind === 'war') {
    const expectedPlayerIds = [...session.intent.playerForce.troopIds].sort();
    const expectedEnemyIds = [...session.intent.enemyForce.troopIds].sort();
    const resultPlayerIds = result.forces
      .filter((force) => force.side === 'player')
      .map((force) => force.troopId)
      .sort();
    const resultEnemyIds = result.forces
      .filter((force) => force.side === 'enemy')
      .map((force) => force.troopId)
      .sort();
    if (canonicalStringify(resultPlayerIds) !== canonicalStringify(expectedPlayerIds)) {
      throw new Error('EncounterResult.forces 的我方 troopId 与开战快照不一致。');
    }
    if (canonicalStringify(resultEnemyIds) !== canonicalStringify(expectedEnemyIds)) {
      throw new Error('EncounterResult.forces 的敌方 troopId 与开战快照不一致。');
    }
  }
}

export function resolveEncounterSession(
  session: EncounterSession,
  result: UnsealedEncounterResult,
  resolvedAt: string,
): EncounterSession {
  assertStatus(session, ['fighting'], '结算冲突');
  assertTimestamp(resolvedAt, 'resolvedAt');
  if ('resultHash' in result) throw new Error('EncounterResult 已被封存，不能重复结算。');
  assertValidEncounterResultPayload(result);
  assertResultMatchesSession(session, result);
  const sealedResult = sealEncounterResult(result);

  return frozenCanonicalCopy({
    ...session,
    status: 'resolved' as const,
    resolvedAt,
    result: sealedResult,
  });
}

export function resolveEncounterSessionWithSealedResult(
  session: EncounterSession,
  result: SealedEncounterResult,
  resolvedAt: string,
): EncounterSession {
  assertStatus(session, ['fighting'], '结算冲突');
  assertTimestamp(resolvedAt, 'resolvedAt');
  if (!verifyEncounterResultHash(result)) throw new Error('EncounterResult 哈希校验失败。');
  const { resultHash: _resultHash, ...unsealed } = result;
  assertValidEncounterResultPayload(unsealed);
  assertResultMatchesSession(session, unsealed);
  return frozenCanonicalCopy({
    ...session,
    status: 'resolved' as const,
    resolvedAt,
    result,
  });
}

function requireVerifiedResult(session: EncounterSession): SealedEncounterResult {
  if (!session.result) throw new EncounterStateTransitionError('当前会话没有可用的封存结果。');
  if (!verifyEncounterResultHash(session.result)) throw new Error('EncounterResult 哈希校验失败。');
  return session.result;
}

export function markEncounterNarrativePending(session: EncounterSession, timestamp: string): EncounterSession {
  assertStatus(session, ['resolved'], '进入战后叙事');
  assertTimestamp(timestamp, 'narrativePendingAt');
  requireVerifiedResult(session);
  return frozenCanonicalCopy({ ...session, status: 'narrative_pending' as const, narrativePendingAt: timestamp });
}

export function markEncounterNarrated(session: EncounterSession, timestamp: string): EncounterSession {
  assertStatus(session, ['narrative_pending'], '完成战后叙事');
  assertTimestamp(timestamp, 'narratedAt');
  requireVerifiedResult(session);
  return frozenCanonicalCopy({ ...session, status: 'narrated' as const, narratedAt: timestamp });
}

export function abortEncounterBeforeResult(session: EncounterSession, timestamp: string): EncounterSession {
  assertStatus(session, ['pending', 'fighting'], '中止冲突');
  assertTimestamp(timestamp, 'abortedAt');
  if (session.result) throw new EncounterStateTransitionError('已有结果的会话不能按战前中止处理。');
  return frozenCanonicalCopy({ ...session, status: 'aborted_before_result' as const, abortedAt: timestamp });
}

function validateCheckpointInput(input: CreateEncounterCheckpointInput): void {
  assertStableId(input.checkpointId, 'checkpointId');
  assertStableId(input.saveId, 'saveId');
  assertTimestamp(input.createdAt, 'checkpoint.createdAt');
}

export function createPreEncounterCheckpoint(
  session: EncounterSession,
  input: CreateEncounterCheckpointInput,
): PreEncounterCheckpoint {
  assertStatus(session, ['pending'], '创建开战前检查点');
  validateCheckpointInput(input);
  return frozenCanonicalCopy({
    checkpointKind: 'pre_encounter' as const,
    checkpointId: input.checkpointId,
    saveId: input.saveId,
    sessionId: session.sessionId,
    encounterId: session.intent.encounterId,
    createdAt: input.createdAt,
    intent: session.intent,
    snapshotHash: session.snapshotHash,
  });
}

export function createPostEncounterResultCheckpoint(
  session: EncounterSession,
  input: CreateEncounterCheckpointInput,
): PostEncounterResultCheckpoint {
  assertStatus(session, ['resolved', 'narrative_pending'], '创建结算后检查点');
  validateCheckpointInput(input);
  const result = requireVerifiedResult(session);
  return frozenCanonicalCopy({
    checkpointKind: 'post_result' as const,
    checkpointId: input.checkpointId,
    saveId: input.saveId,
    sessionId: session.sessionId,
    encounterId: session.intent.encounterId,
    createdAt: input.createdAt,
    result,
  });
}

export function resolveEncounterCheckpointResumeAction(
  checkpoint: EncounterCheckpoint,
): 'restart_encounter' | 'retry_narrative' {
  return checkpoint.checkpointKind === 'pre_encounter' ? 'restart_encounter' : 'retry_narrative';
}
