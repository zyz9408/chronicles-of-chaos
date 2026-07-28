import type {
  MemorySummaryMaintenance,
  RuntimeState,
} from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { shouldCreateRecentTurnSummaryTask } from './MemorySummaryProjection';

export interface QueueMemorySummaryMaintenanceInput {
  queuedAt: string;
  triggerTurnNumber: number;
}

export interface FailMemorySummaryMaintenanceInput {
  attemptedAt: string;
  reason?: string;
}

export function getMemorySummaryMaintenance(
  state: RuntimeState,
): MemorySummaryMaintenance | undefined {
  return ensureLuanShiState(state).memoryArchive.memorySummaryMaintenance;
}

export function hasPendingMemorySummaryMaintenance(state: RuntimeState): boolean {
  return getMemorySummaryMaintenance(state)?.status === 'pending';
}

export function shouldRunAutomaticMemorySummaryMaintenance(state: RuntimeState): boolean {
  return shouldCreateRecentTurnSummaryTask(state)
    && !hasPendingMemorySummaryMaintenance(state);
}

export function queueMemorySummaryMaintenance(
  state: RuntimeState,
  input: QueueMemorySummaryMaintenanceInput,
): RuntimeState {
  const normalized = cloneNormalizedState(state);
  const existing = normalized.memoryArchive.memorySummaryMaintenance;
  normalized.memoryArchive.memorySummaryMaintenance = existing ?? {
    status: 'pending',
    queuedAt: input.queuedAt,
    triggerTurnNumber: Math.max(0, Math.floor(input.triggerTurnNumber)),
  };
  return normalized;
}

export function failMemorySummaryMaintenance(
  state: RuntimeState,
  input: FailMemorySummaryMaintenanceInput,
): RuntimeState {
  const normalized = cloneNormalizedState(state);
  const existing = normalized.memoryArchive.memorySummaryMaintenance;
  normalized.memoryArchive.memorySummaryMaintenance = {
    status: 'pending',
    queuedAt: existing?.queuedAt ?? input.attemptedAt,
    triggerTurnNumber: existing?.triggerTurnNumber ?? normalized.turnLog.length,
    lastAttemptAt: input.attemptedAt,
    lastFailureReason: toPlayerSafeMemorySummaryFailureReason(input.reason),
  };
  return normalized;
}

export function clearMemorySummaryMaintenance(state: RuntimeState): RuntimeState {
  const normalized = cloneNormalizedState(state);
  delete normalized.memoryArchive.memorySummaryMaintenance;
  return normalized;
}

export function toPlayerSafeMemorySummaryFailureReason(reason?: string): string {
  const normalized = reason?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';
  if (!normalized) return '记忆压缩 API 请求失败，请检查 API 设置后重试。';
  if (/(timeout|timed out|budget exceeded|超时)/.test(normalized)) {
    return '记忆压缩 API 请求超时，请更换可用 API 或稍后重试。';
  }
  if (/(429|rate limit|too many requests|频率|限流)/.test(normalized)) {
    return '记忆压缩 API 当前请求受限，请更换可用 API 或稍后重试。';
  }
  if (/(401|403|unauthori[sz]ed|forbidden|api key|鉴权|密钥)/.test(normalized)) {
    return '记忆压缩 API 鉴权失败，请检查或更换 API 配置。';
  }
  if (/(not configured|未配置|missing config)/.test(normalized)) {
    return '尚未配置可用的记忆压缩 API，请先在设置中完成配置。';
  }
  return '记忆压缩 API 请求失败，请检查 API 设置后重试。';
}

function cloneNormalizedState(state: RuntimeState): ReturnType<typeof ensureLuanShiState> {
  return ensureLuanShiState(JSON.parse(JSON.stringify(state)) as RuntimeState);
}
