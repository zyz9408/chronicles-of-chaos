import type {
  RelationshipChangePayload,
  RelationshipTargetKind,
  ResourceChangedPayload,
  StatePatch,
} from '../types';
import { resolveCanonicalLedgerNumberField } from '../state/resourceLedgerIdentity';

export type PayloadNormalizationResult<T> =
  | { ok: true; payload: T }
  | { ok: false; error: string };

export type StatePatchContractNormalizationResult =
  | { ok: true; patch: StatePatch }
  | { ok: false; error: string };

export type ResourceChangedValueResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

type RecoverableStatePatchBusinessIdentity =
  | { type: 'resourceChanged'; resource: string; mode: 'delta' | 'absolute' }
  | {
      type: 'relationshipChange';
      actorId: string;
      targetId: string;
      targetKind: RelationshipTargetKind;
    };

const STRICT_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export function parseStrictFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== 'string' || !STRICT_NUMBER_PATTERN.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeResourceChangedPayload(
  payload: unknown,
): PayloadNormalizationResult<ResourceChangedPayload> {
  if (!isPayloadRecord(payload)) {
    return { ok: false, error: 'resourceChanged.payload 必须是对象' };
  }

  const resource = normalizeRequiredId(payload.resource);
  if (!resource) {
    return { ok: false, error: 'resourceChanged.resource 必须是非空字符串' };
  }
  const canonicalLedgerField = resolveCanonicalLedgerNumberField(resource);
  if (canonicalLedgerField) {
    const writebackField = canonicalLedgerField === 'money' ? 'moneyGuan' : canonicalLedgerField;
    const reconciliationHint = canonicalLedgerField === 'money'
      ? '，并同时提供 previousMoneyGuan 与 moneyDeltaGuan'
      : '';
    return {
      ok: false,
      error: `resourceChanged.resource=${resource} 是府库标准资源保留键；请改用 updateResourceLedger.${writebackField}${reconciliationHint} 写当前总量`,
    };
  }

  const hasChange = hasOwn(payload, 'change');
  const hasNewValue = hasOwn(payload, 'newValue');
  if (hasChange === hasNewValue) {
    return { ok: false, error: 'resourceChanged 必须且只能提供 change 或 newValue 之一' };
  }

  const rawMode = payload.mode;
  if (rawMode !== undefined && rawMode !== 'delta' && rawMode !== 'absolute') {
    return { ok: false, error: 'resourceChanged.mode 必须是 delta 或 absolute' };
  }

  const mode = rawMode ?? (hasChange ? 'delta' : 'absolute');
  if ((mode === 'delta' && !hasChange) || (mode === 'absolute' && !hasNewValue)) {
    return { ok: false, error: `resourceChanged.mode=${mode} 与数值字段不匹配` };
  }

  const rawValue = mode === 'delta' ? payload.change : payload.newValue;
  const value = parseStrictFiniteNumber(rawValue);
  if (value === undefined) {
    return { ok: false, error: `resourceChanged.${mode === 'delta' ? 'change' : 'newValue'} 必须是 finite number 或严格数字字符串` };
  }

  if (mode === 'delta') {
    return {
      ok: true,
      payload: { resource, mode, change: value },
    };
  }

  return {
    ok: true,
    payload: { resource, mode, newValue: value },
  };
}

export function resolveResourceChangedValue(
  payload: ResourceChangedPayload,
  currentValue: unknown,
): ResourceChangedValueResult {
  if (payload.mode === 'absolute') {
    return { ok: true, value: payload.newValue };
  }

  const current = currentValue === undefined ? 0 : currentValue;
  if (typeof current !== 'number' || !Number.isFinite(current)) {
    return { ok: false, error: 'resourceChanged 当前资源值必须是 finite number' };
  }

  const value = current + payload.change;
  if (!Number.isFinite(value)) {
    return { ok: false, error: 'resourceChanged delta 运算结果必须是 finite number' };
  }
  return { ok: true, value };
}

export function normalizeRelationshipChangePayload(
  payload: unknown,
): PayloadNormalizationResult<RelationshipChangePayload> {
  if (!isPayloadRecord(payload)) {
    return { ok: false, error: 'relationshipChange.payload 必须是对象' };
  }

  const actorId = normalizeRequiredId(payload.actorId);
  if (!actorId) {
    return { ok: false, error: 'relationshipChange.actorId 必须是非空字符串' };
  }

  const targetId = normalizeRequiredId(payload.targetId);
  if (!targetId) {
    return { ok: false, error: 'relationshipChange.targetId 必须是非空字符串' };
  }

  const factionTargetId = hasOwn(payload, 'factionId')
    ? normalizeRequiredId(payload.factionId)
    : undefined;
  if (hasOwn(payload, 'factionId') && !factionTargetId) {
    return { ok: false, error: 'relationshipChange.factionId 必须是非空字符串' };
  }
  if (factionTargetId && targetId !== factionTargetId) {
    return { ok: false, error: 'relationshipChange.targetId 与 factionId 不能指向不同目标' };
  }

  const targetKind = normalizeTargetKind(payload.targetKind);
  const targetType = normalizeTargetKind(payload.targetType);
  if (hasOwn(payload, 'targetKind') && !targetKind) {
    return { ok: false, error: 'relationshipChange.targetKind 必须是 actor 或 faction' };
  }
  if (hasOwn(payload, 'targetType') && !targetType) {
    return { ok: false, error: 'relationshipChange.targetType 必须是 actor 或 faction' };
  }
  if (targetKind && targetType && targetKind !== targetType) {
    return { ok: false, error: 'relationshipChange.targetKind 与 targetType 必须一致' };
  }
  if (!targetKind) {
    return { ok: false, error: 'relationshipChange.targetKind 必须明确为 actor 或 faction' };
  }
  if (factionTargetId && targetKind !== 'faction') {
    return { ok: false, error: 'relationshipChange.factionId 只能用于 faction target' };
  }

  const value = parseStrictFiniteNumber(payload.value);
  if (value === undefined || value < -100 || value > 100) {
    return { ok: false, error: 'relationshipChange.value 必须是 -100 到 100 的 finite number' };
  }

  const type = typeof payload.type === 'string' ? payload.type : undefined;
  const description = typeof payload.description === 'string' ? payload.description : undefined;
  return {
    ok: true,
    payload: {
      actorId,
      targetId,
      targetKind,
      targetType: targetKind,
      value,
      ...(type !== undefined ? { type } : {}),
      ...(description !== undefined ? { description } : {}),
    },
  };
}

export function normalizeStatePatchContract(patch: StatePatch): StatePatch {
  const result = normalizeStatePatchContractResult(patch);
  return result.ok ? result.patch : patch;
}

export function normalizeStatePatchContractResult(
  patch: StatePatch,
): StatePatchContractNormalizationResult {
  if (patch.type === 'resourceChanged') {
    const result = normalizeResourceChangedPayload(patch.payload);
    return result.ok
      ? { ok: true, patch: { ...patch, payload: result.payload } }
      : result;
  }

  if (patch.type === 'relationshipChange') {
    const result = normalizeRelationshipChangePayload(patch.payload);
    return result.ok
      ? { ok: true, patch: { ...patch, payload: result.payload } }
      : result;
  }

  return { ok: true, patch };
}

export function matchesRecoverableStatePatchBusinessIdentity(
  originalPatch: StatePatch,
  repairedPatch: StatePatch,
): boolean {
  const original = getRecoverableStatePatchBusinessIdentity(originalPatch);
  const repaired = getRecoverableStatePatchBusinessIdentity(repairedPatch);
  if (!original || !repaired || original.type !== repaired.type) return false;

  if (original.type === 'resourceChanged' && repaired.type === 'resourceChanged') {
    return original.resource === repaired.resource && original.mode === repaired.mode;
  }

  if (original.type === 'relationshipChange' && repaired.type === 'relationshipChange') {
    return original.actorId === repaired.actorId
      && original.targetId === repaired.targetId
      && original.targetKind === repaired.targetKind;
  }

  return false;
}

function getRecoverableStatePatchBusinessIdentity(
  patch: StatePatch,
): RecoverableStatePatchBusinessIdentity | undefined {
  if (!isPayloadRecord(patch.payload)) return undefined;

  if (patch.type === 'resourceChanged') {
    const resource = normalizeRequiredId(patch.payload.resource);
    if (!resource) return undefined;

    const hasChange = hasOwn(patch.payload, 'change');
    const hasNewValue = hasOwn(patch.payload, 'newValue');
    const explicitMode = patch.payload.mode;
    const mode = explicitMode === 'delta' || explicitMode === 'absolute'
      ? explicitMode
      : explicitMode === undefined && hasChange !== hasNewValue
        ? hasChange ? 'delta' : 'absolute'
        : undefined;
    return mode ? { type: 'resourceChanged', resource, mode } : undefined;
  }

  if (patch.type !== 'relationshipChange') return undefined;
  const actorId = normalizeRequiredId(patch.payload.actorId);
  const targetId = normalizeRequiredId(patch.payload.targetId);
  if (!actorId || !targetId) return undefined;

  const factionId = hasOwn(patch.payload, 'factionId')
    ? normalizeRequiredId(patch.payload.factionId)
    : undefined;
  if (hasOwn(patch.payload, 'factionId') && (!factionId || factionId !== targetId)) {
    return undefined;
  }

  const targetKind = normalizeOptionalTargetKind(patch.payload, 'targetKind');
  const targetType = normalizeOptionalTargetKind(patch.payload, 'targetType');
  if (targetKind === null || targetType === null) return undefined;
  if (targetKind && targetType && targetKind !== targetType) return undefined;

  const kindHint = targetKind ?? targetType ?? (factionId ? 'faction' : undefined);
  if (!kindHint) return undefined;
  if (factionId && kindHint !== 'faction') return undefined;
  return { type: 'relationshipChange', actorId, targetId, targetKind: kindHint };
}

function normalizeRequiredId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeTargetKind(value: unknown): RelationshipTargetKind | undefined {
  return value === 'actor' || value === 'faction' ? value : undefined;
}

function normalizeOptionalTargetKind(
  payload: Record<string, unknown>,
  key: 'targetKind' | 'targetType',
): RelationshipTargetKind | undefined | null {
  if (!hasOwn(payload, key)) return undefined;
  return normalizeTargetKind(payload[key]) ?? null;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPayloadRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
