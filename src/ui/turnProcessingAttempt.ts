import type { TurnProcessingStage, TurnProcessingStageEvent } from '../engine/types';

export interface FailedTurnProcessingAttempt {
  actionText: string;
  failedAt: string;
  error: string;
  processingStages: TurnProcessingStageEvent[];
}

export interface FailedTurnProcessingAttemptInput {
  actionText: string;
  error: unknown;
  events: TurnProcessingStageEvent[];
  fallbackStage: TurnProcessingStage;
  fallbackLabel: string;
  failedAt?: string;
}

export function buildFailedTurnProcessingAttempt({
  actionText,
  error,
  events,
  fallbackStage,
  fallbackLabel,
  failedAt = new Date().toISOString(),
}: FailedTurnProcessingAttemptInput): FailedTurnProcessingAttempt {
  const errorText = error instanceof Error ? error.message : String(error || '未知错误');
  const processingStages = [...events];
  const activeStage = findLastUnfinishedStage(processingStages);
  const lastEvent = processingStages[processingStages.length - 1];

  if (activeStage) {
    processingStages.push({
      ...activeStage,
      status: 'failed',
      elapsedMs: calculateElapsedMs(activeStage.startedAt, failedAt),
      detail: errorText,
    });
  } else if (lastEvent?.status !== 'failed') {
    processingStages.push({
      stage: lastEvent?.stage ?? fallbackStage,
      label: lastEvent?.label || fallbackLabel || '执行回合',
      status: 'failed',
      startedAt: failedAt,
      elapsedMs: 0,
      detail: errorText,
      provider: lastEvent?.provider,
      model: lastEvent?.model,
    });
  }

  return {
    actionText,
    failedAt,
    error: errorText,
    processingStages,
  };
}

function findLastUnfinishedStage(
  events: TurnProcessingStageEvent[],
): TurnProcessingStageEvent | undefined {
  const completedKeys = new Set<string>();

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const key = buildAttemptKey(event);
    if (event.status !== 'started') {
      completedKeys.add(key);
      continue;
    }
    if (!completedKeys.has(key)) return event;
  }

  return undefined;
}

function buildAttemptKey(event: TurnProcessingStageEvent): string {
  return [
    event.stage,
    event.label,
    event.startedAt ?? '',
    event.provider ?? '',
    event.model ?? '',
  ].join('\u0000');
}

function calculateElapsedMs(startedAt: string | undefined, failedAt: string): number | undefined {
  if (!startedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(failedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return Math.max(0, end - start);
}
