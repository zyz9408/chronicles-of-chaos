import { v4 as createUuid } from './uuid';

export const TURN_EXECUTION_CANCELLED = 'TURN_EXECUTION_CANCELLED' as const;

export class TurnExecutionCancelledError extends Error {
  readonly code = TURN_EXECUTION_CANCELLED;

  constructor() {
    super('Turn execution cancelled');
    this.name = 'TurnExecutionCancelledError';
  }
}

export interface TurnExecutionContext {
  readonly executionId: string;
  readonly saveId: string;
  readonly sessionGeneration: number;
  readonly abortController: AbortController;
  readonly signal: AbortSignal;
}

export function isTurnExecutionCancelled(error: unknown): error is TurnExecutionCancelledError {
  return error instanceof TurnExecutionCancelledError
    || (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === TURN_EXECUTION_CANCELLED
    );
}

export class TurnExecutionOwner {
  private current: TurnExecutionContext | null = null;

  begin(saveId: string, sessionGeneration: number): TurnExecutionContext {
    this.invalidate();
    const abortController = new AbortController();
    const execution = Object.freeze({
      executionId: createUuid(),
      saveId,
      sessionGeneration,
      abortController,
      signal: abortController.signal,
    });
    this.current = execution;
    return execution;
  }

  invalidate(): boolean {
    const execution = this.current;
    if (!execution) return false;

    this.current = null;
    if (!execution.signal.aborted) {
      execution.abortController.abort(new TurnExecutionCancelledError());
    }
    return true;
  }

  abort(): boolean {
    return this.invalidate();
  }

  isCurrent(
    execution: TurnExecutionContext,
    saveId: string = execution.saveId,
    sessionGeneration: number = execution.sessionGeneration,
  ): boolean {
    return this.current === execution
      && !execution.signal.aborted
      && execution.saveId === saveId
      && execution.sessionGeneration === sessionGeneration;
  }

  assertCurrent(
    execution: TurnExecutionContext,
    saveId: string = execution.saveId,
    sessionGeneration: number = execution.sessionGeneration,
  ): void {
    if (!this.isCurrent(execution, saveId, sessionGeneration)) {
      throw new TurnExecutionCancelledError();
    }
  }

  finish(execution: TurnExecutionContext): boolean {
    if (this.current !== execution) return false;
    this.current = null;
    return true;
  }
}
