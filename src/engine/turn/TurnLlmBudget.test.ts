import { describe, expect, it } from 'vitest';
import {
  createTurnLlmBudget,
  isHardTurnBudgetExceededError,
  TurnBudgetExceededError,
} from './TurnLlmBudget';

describe('TurnLlmBudget', () => {
  it('gives the cancellable main narrative a 10 minute hard scope without automatic retry', () => {
    let now = 0;
    const budget = createTurnLlmBudget(undefined, undefined, () => now);

    const requestBudget = budget.getMainNarrativeRequestBudget();
    const timeoutError = requestBudget.timeoutErrorFactory(requestBudget.timeoutMs);

    expect(requestBudget.timeoutMs).toBe(600_000);
    expect(requestBudget.retryCount).toBe(0);
    expect(timeoutError).toBeInstanceOf(TurnBudgetExceededError);
    expect((timeoutError as TurnBudgetExceededError).scope).toBe('mainNarrative');
    expect(isHardTurnBudgetExceededError(timeoutError)).toBe(true);

    now = 1_200_001;
    expect(() => budget.getAuxiliaryRequestBudget()).toThrow(TurnBudgetExceededError);
  });

  it('gives ordinary auxiliary requests two minutes and one timeout retry', () => {
    const budget = createTurnLlmBudget(undefined, undefined, () => 0);

    const requestBudget = budget.getAuxiliaryRequestBudget();
    const timeoutError = requestBudget.timeoutErrorFactory(requestBudget.timeoutMs);

    expect(requestBudget.timeoutMs).toBe(120_000);
    expect(requestBudget.retryCount).toBe(1);
    expect(requestBudget.retryDelayMs).toBe(1_000);
    expect(timeoutError).toBeInstanceOf(TurnBudgetExceededError);
    expect((timeoutError as TurnBudgetExceededError).scope).toBe('auxiliary');
    expect(isHardTurnBudgetExceededError(timeoutError)).toBe(false);
  });

  it('reserves room for one retry inside the remaining post-narrative budget', () => {
    let now = 0;
    const budget = createTurnLlmBudget(undefined, undefined, () => now);
    const postBudget = budget.startPostNarrativeBudget();

    now = 360_000;
    const requestBudget = postBudget.getChildRequestBudget();
    const timeoutError = requestBudget.timeoutErrorFactory(requestBudget.timeoutMs);

    expect(requestBudget.timeoutMs).toBe(59_500);
    expect(requestBudget.retryCount).toBe(1);
    expect(timeoutError).toBeInstanceOf(TurnBudgetExceededError);
    expect((timeoutError as TurnBudgetExceededError).scope).toBe('postNarrative');
    expect(isHardTurnBudgetExceededError(timeoutError)).toBe(false);

    now = 480_001;
    expect(() => postBudget.getChildRequestBudget()).toThrow(TurnBudgetExceededError);
  });
});
