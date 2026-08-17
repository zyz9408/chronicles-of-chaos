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
  if (/(not configured|未配置|missing config)/.test(normalized)) {
    return '尚未配置可用的记忆压缩 API，请先在记忆配置中完成设置。';
  }
  if (/(timeout|timed out|budget exceeded|超时)/.test(normalized)) {
    return '记忆压缩 API 请求超时，请更换可用 API 或稍后重试。';
  }
  if (/(429|rate limit|too many requests|频率|限流)/.test(normalized)) {
    return '记忆压缩 API 当前请求受限，请更换可用 API 或稍后重试。';
  }
  if (/(401|403|unauthori[sz]ed|forbidden|api key|鉴权|密钥)/.test(normalized)) {
    return '记忆压缩 API 鉴权失败，请检查或更换 API 配置。';
  }
  if (
    /(failed to fetch|fetch failed|networkerror|network error|load failed|cors|connection refused|econnrefused|name_not_resolved|网络)/.test(
      normalized,
    )
  ) {
    return '记忆压缩 API 网络连接失败，请检查接口地址、跨域设置或网络状态。';
  }
  if (
    /(\b400\b|\b404\b|\b405\b|\b422\b|response[_ -]?format|json[_ -]?object|unsupported model|model not found|unknown model)/.test(
      normalized,
    )
  ) {
    return '记忆压缩 API 的接口或模型不兼容，请检查地址、模型及 JSON 输出支持。';
  }
  if (
    /(summary result had no valid entries|invalid json|json parse|parse json|schema|invalid response|malformed json)/.test(
      normalized,
    )
  ) {
    return '记忆压缩 API 返回格式不符合要求，请更换支持结构化 JSON 输出的模型后重试。';
  }
  if (/(\b500\b|\b502\b|\b503\b|\b504\b|internal server error|bad gateway|service unavailable|gateway timeout)/.test(normalized)) {
    return '记忆压缩 API 上游服务暂时不可用，请更换可用 API 或稍后重试。';
  }
  return '记忆压缩 API 请求失败，请检查 API 设置后重试。';
}

function cloneNormalizedState(state: RuntimeState): ReturnType<typeof ensureLuanShiState> {
  return ensureLuanShiState(JSON.parse(JSON.stringify(state)) as RuntimeState);
}
