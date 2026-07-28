import { describe, expect, it, vi } from 'vitest';
import gameScreenSource from './GameScreen.tsx?raw';
import { buildTurnSubmitButtonModel } from './GameScreen';

describe('GameScreen turn cancellation control', () => {
  it('reuses the submit button as an enabled cancellation control while a turn is running', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const model = buildTurnSubmitButtonModel({
      hasInput: false,
      isProcessing: true,
      isCancelling: false,
      onSubmit,
      onCancel,
    });

    expect(model).toMatchObject({
      label: '中止生成',
      disabled: false,
      className: 'submit-btn submit-btn-cancel',
    });
    model.onClick();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('prevents duplicate cancellation requests until the active execution settles', () => {
    const onCancel = vi.fn();
    const model = buildTurnSubmitButtonModel({
      hasInput: true,
      isProcessing: true,
      isCancelling: true,
      onSubmit: vi.fn(),
      onCancel,
    });

    expect(model.label).toBe('正在中止…');
    expect(model.disabled).toBe(true);
  });

  it('keeps the ordinary submit behavior and blank-input gate when idle', () => {
    const onSubmit = vi.fn();
    const enabled = buildTurnSubmitButtonModel({
      hasInput: true,
      isProcessing: false,
      isCancelling: false,
      onSubmit,
      onCancel: vi.fn(),
    });
    const disabled = buildTurnSubmitButtonModel({
      hasInput: false,
      isProcessing: false,
      isCancelling: false,
      onSubmit,
      onCancel: vi.fn(),
    });

    expect(enabled.label).toBe('执行行动');
    expect(enabled.disabled).toBe(false);
    enabled.onClick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(disabled.disabled).toBe(true);
  });

  it('wires cancellation to the owned execution and restores the interrupted action', () => {
    expect(gameScreenSource).toContain('const handleCancelGeneration = useCallback(() => {');
    expect(gameScreenSource).toContain('executionOwner.abort()');
    expect(gameScreenSource).toContain('currentInput.trim() ? currentInput : interruptedAction');
    expect(gameScreenSource).toContain('settleExecutionUi(execution');
  });
});
