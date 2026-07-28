// ============================================================
// Engine Core Types - StatePatch
// 所有世界状态变更必须通过此结构
// ============================================================

/** 第一阶段允许的 patch 类型白名单 */
export type PatchType =
  | 'timeAdvance'
  | 'locationChange'
  | 'actorDiscovered'
  | 'relationshipChange'
  | 'rumorAdded'
  | 'npcAwarenessRegistered'
  | 'npcPresenceUpdated'
  | 'questAdded'
  | 'questUpdated'
  | 'resourceChanged'
  | 'localSituationChanged'
  | 'luanshiCommand';

export type ResourceChangeMode = 'delta' | 'absolute';

export interface ResourceChangedDeltaPayload extends Record<string, unknown> {
  resource: string;
  mode: 'delta';
  change: number;
}

export interface ResourceChangedAbsolutePayload extends Record<string, unknown> {
  resource: string;
  mode: 'absolute';
  newValue: number;
}

export type ResourceChangedPayload = ResourceChangedDeltaPayload | ResourceChangedAbsolutePayload;

export type RelationshipTargetKind = 'actor' | 'faction';

export interface RelationshipChangePayload extends Record<string, unknown> {
  actorId: string;
  targetId: string;
  targetKind: RelationshipTargetKind;
  targetType?: RelationshipTargetKind;
  value: number;
  type?: string;
  description?: string;
}

/** 结构化状态补丁 */
export interface StatePatch {
  type: PatchType;
  payload: Record<string, unknown>;
  reason: string;
}

/** Patch 校验结果 */
export interface PatchValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
