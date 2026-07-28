import type { LlmTimeoutErrorFactory } from '../llm/LlmClient';

export const TURN_LLM_BUDGET_DEFAULTS = {
  mainNarrativeRequestMs: 600_000,
  singleAuxiliaryRequestMs: 120_000,
  auxiliaryRetryCount: 1,
  auxiliaryRetryDelayMs: 1_000,
  postNarrativeTotalMs: 480_000,
  wholeTurnTotalMs: 1_200_000,
} as const;

export type TurnLlmBudgetScope = 'wholeTurn' | 'postNarrative' | 'mainNarrative' | 'auxiliary';

export class TurnBudgetExceededError extends Error {
  constructor(
    public readonly scope: TurnLlmBudgetScope,
    public readonly timeoutMs: number,
  ) {
    super(`LLM budget exceeded: ${scope} after ${formatBudgetMs(timeoutMs)}`);
    this.name = 'TurnBudgetExceededError';
  }
}

export interface TurnLlmRequestBudget {
  signal?: AbortSignal;
  timeoutMs: number;
  timeoutErrorFactory: LlmTimeoutErrorFactory;
  retryCount?: number;
  retryDelayMs?: number;
}

export interface PostNarrativeLlmBudget {
  readonly signal?: AbortSignal;
  getChildRequestBudget(): TurnLlmRequestBudget;
  throwIfExceeded(): void;
}

export interface TurnLlmBudget {
  readonly signal?: AbortSignal;
  getMainNarrativeRequestBudget(): TurnLlmRequestBudget;
  getAuxiliaryRequestBudget(): TurnLlmRequestBudget;
  startPostNarrativeBudget(): PostNarrativeLlmBudget;
  throwIfExceeded(): void;
}

export function createTurnLlmBudget(
  signal?: AbortSignal,
  defaults = TURN_LLM_BUDGET_DEFAULTS,
  now: () => number = Date.now,
): TurnLlmBudget {
  const startedAt = now();
  const wholeTurnDeadline = startedAt + defaults.wholeTurnTotalMs;

  const throwIfWholeExceeded = (): void => {
    throwIfSignalAborted(signal);
    const remainingWhole = wholeTurnDeadline - now();
    if (remainingWhole <= 0) {
      throw new TurnBudgetExceededError('wholeTurn', defaults.wholeTurnTotalMs);
    }
  };

  const buildRequestBudget = (
    scope: TurnLlmBudgetScope,
    timeoutMs: number,
    allowRetry = false,
  ): TurnLlmRequestBudget => ({
    signal,
    timeoutMs: normalizeRequestTimeout(timeoutMs),
    timeoutErrorFactory: (elapsedMs) => new TurnBudgetExceededError(scope, elapsedMs),
    retryCount: allowRetry ? defaults.auxiliaryRetryCount : 0,
    retryDelayMs: allowRetry ? defaults.auxiliaryRetryDelayMs : 0,
  });

  return {
    signal,
    getMainNarrativeRequestBudget(): TurnLlmRequestBudget {
      throwIfSignalAborted(signal);
      const remainingWhole = wholeTurnDeadline - now();
      if (remainingWhole <= 0) {
        throw new TurnBudgetExceededError('wholeTurn', defaults.wholeTurnTotalMs);
      }
      const timeoutMs = Math.min(defaults.mainNarrativeRequestMs, remainingWhole);
      const scope: TurnLlmBudgetScope = remainingWhole < defaults.mainNarrativeRequestMs
        ? 'wholeTurn'
        : 'mainNarrative';
      return buildRequestBudget(scope, timeoutMs);
    },
    getAuxiliaryRequestBudget(): TurnLlmRequestBudget {
      throwIfSignalAborted(signal);
      const remainingWhole = wholeTurnDeadline - now();
      if (remainingWhole <= 0) {
        throw new TurnBudgetExceededError('wholeTurn', defaults.wholeTurnTotalMs);
      }
      const availableForAttempts = Math.max(1, remainingWhole - defaults.auxiliaryRetryDelayMs);
      const attemptCount = defaults.auxiliaryRetryCount + 1;
      const timeoutMs = Math.min(defaults.singleAuxiliaryRequestMs, Math.floor(availableForAttempts / attemptCount));
      const scope: TurnLlmBudgetScope = remainingWhole < (
        defaults.singleAuxiliaryRequestMs * attemptCount + defaults.auxiliaryRetryDelayMs
      )
        ? 'wholeTurn'
        : 'auxiliary';
      return buildRequestBudget(scope, timeoutMs, true);
    },
    startPostNarrativeBudget(): PostNarrativeLlmBudget {
      throwIfWholeExceeded();
      const postNarrativeDeadline = now() + defaults.postNarrativeTotalMs;

      const throwIfPostExceeded = (): void => {
        throwIfSignalAborted(signal);
        const remainingWhole = wholeTurnDeadline - now();
        if (remainingWhole <= 0) {
          throw new TurnBudgetExceededError('wholeTurn', defaults.wholeTurnTotalMs);
        }
        const remainingPost = postNarrativeDeadline - now();
        if (remainingPost <= 0) {
          throw new TurnBudgetExceededError('postNarrative', defaults.postNarrativeTotalMs);
        }
      };

      return {
        signal,
        getChildRequestBudget(): TurnLlmRequestBudget {
          throwIfSignalAborted(signal);
          const currentTime = now();
          const remainingWhole = wholeTurnDeadline - currentTime;
          if (remainingWhole <= 0) {
            throw new TurnBudgetExceededError('wholeTurn', defaults.wholeTurnTotalMs);
          }
          const remainingPost = postNarrativeDeadline - currentTime;
          if (remainingPost <= 0) {
            throw new TurnBudgetExceededError('postNarrative', defaults.postNarrativeTotalMs);
          }

          const attemptCount = defaults.auxiliaryRetryCount + 1;
          const availablePost = Math.max(1, remainingPost - defaults.auxiliaryRetryDelayMs);
          const availableWhole = Math.max(1, remainingWhole - defaults.auxiliaryRetryDelayMs);
          const timeoutMs = Math.min(
            defaults.singleAuxiliaryRequestMs,
            Math.floor(availablePost / attemptCount),
            Math.floor(availableWhole / attemptCount),
          );
          let scope: TurnLlmBudgetScope = 'auxiliary';
          const fullRetryWindow = defaults.singleAuxiliaryRequestMs * attemptCount
            + defaults.auxiliaryRetryDelayMs;
          if (remainingWhole < fullRetryWindow && remainingWhole <= remainingPost) {
            scope = 'wholeTurn';
          } else if (remainingPost < fullRetryWindow) {
            scope = 'postNarrative';
          }
          return buildRequestBudget(scope, timeoutMs, true);
        },
        throwIfExceeded: throwIfPostExceeded,
      };
    },
    throwIfExceeded: throwIfWholeExceeded,
  };
}

export function isTurnBudgetExceededError(error: unknown): error is TurnBudgetExceededError {
  return error instanceof TurnBudgetExceededError;
}

export function isHardTurnBudgetExceededError(error: unknown): error is TurnBudgetExceededError {
  return error instanceof TurnBudgetExceededError
    && (error.scope === 'wholeTurn' || error.scope === 'mainNarrative');
}

function normalizeRequestTimeout(timeoutMs: number): number {
  return Math.max(1, Math.floor(timeoutMs));
}

function throwIfSignalAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
  }
}

function formatBudgetMs(timeoutMs: number): string {
  if (timeoutMs >= 1000) return `${Math.round(timeoutMs / 1000)}s`;
  return `${timeoutMs}ms`;
}
