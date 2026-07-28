import { describe, expect, it } from 'vitest';
import {
  TurnExecutionCancelledError,
  TurnExecutionOwner,
  isTurnExecutionCancelled,
} from './TurnExecutionContext';

describe('TurnExecutionOwner', () => {
  it('begins an immutable execution bound to one save and session generation', () => {
    const owner = new TurnExecutionOwner();

    const execution = owner.begin('save-a', 3);

    expect(execution).toMatchObject({
      saveId: 'save-a',
      sessionGeneration: 3,
    });
    expect(execution.executionId).toEqual(expect.any(String));
    expect(execution.signal).toBe(execution.abortController.signal);
    expect(Object.isFrozen(execution)).toBe(true);
    expect(owner.isCurrent(execution, 'save-a', 3)).toBe(true);
  });

  it('invalidates the active execution with a typed cancellation error', () => {
    const owner = new TurnExecutionOwner();
    const execution = owner.begin('save-a', 1);

    expect(owner.invalidate()).toBe(true);

    expect(execution.signal.aborted).toBe(true);
    expect(execution.signal.reason).toBeInstanceOf(TurnExecutionCancelledError);
    expect(isTurnExecutionCancelled(execution.signal.reason)).toBe(true);
    expect(owner.isCurrent(execution, 'save-a', 1)).toBe(false);
  });

  it('rejects ownership when the current save or session generation differs', () => {
    const owner = new TurnExecutionOwner();
    const execution = owner.begin('save-a', 2);

    expect(owner.isCurrent(execution, 'save-b', 2)).toBe(false);
    expect(owner.isCurrent(execution, 'save-a', 3)).toBe(false);
    expect(() => owner.assertCurrent(execution, 'save-b', 2)).toThrow(TurnExecutionCancelledError);
  });

  it('starting a new execution aborts the old one and rejects its late completion', () => {
    const owner = new TurnExecutionOwner();
    const oldExecution = owner.begin('save-a', 4);
    const currentExecution = owner.begin('save-b', 5);

    expect(oldExecution.signal.aborted).toBe(true);
    expect(() => owner.assertCurrent(oldExecution, 'save-a', 4)).toThrow(TurnExecutionCancelledError);
    expect(owner.finish(oldExecution)).toBe(false);
    expect(owner.isCurrent(currentExecution, 'save-b', 5)).toBe(true);
  });

  it('finishes only the matching current execution', () => {
    const owner = new TurnExecutionOwner();
    const execution = owner.begin('save-a', 1);

    expect(owner.finish(execution)).toBe(true);
    expect(owner.finish(execution)).toBe(false);
    expect(execution.signal.aborted).toBe(false);
    expect(owner.isCurrent(execution, 'save-a', 1)).toBe(false);
  });

  it('makes abort and invalidate idempotent', () => {
    const owner = new TurnExecutionOwner();
    const execution = owner.begin('save-a', 1);

    expect(owner.abort()).toBe(true);
    const cancellationReason = execution.signal.reason;

    expect(owner.abort()).toBe(false);
    expect(owner.invalidate()).toBe(false);
    expect(execution.signal.reason).toBe(cancellationReason);
  });
});
