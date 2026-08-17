import { describe, expect, it, vi } from 'vitest';
import gameScreenSource from './GameScreen.tsx?raw';
import {
  buildTurnSubmitButtonModel,
  isRightControlKey,
  shouldSubmitActionFromKeyboard,
} from './GameScreen';

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
    expect(enabled.shortcutHint).toBe('右 Ctrl + Enter');
    expect(enabled.disabled).toBe(false);
    enabled.onClick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(disabled.disabled).toBe(true);
  });

  it('submits only for right Control plus Enter while ordinary Enter remains a newline', () => {
    const enterEvent = {
      key: 'Enter',
      code: 'Enter',
      location: 0,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      isComposing: false,
    };

    expect(isRightControlKey({ key: 'Control', code: 'ControlRight', location: 2 })).toBe(true);
    expect(isRightControlKey({ key: 'Control', code: 'ControlLeft', location: 1 })).toBe(false);
    expect(shouldSubmitActionFromKeyboard(enterEvent, false)).toBe(false);
    expect(shouldSubmitActionFromKeyboard({ ...enterEvent, ctrlKey: true }, false)).toBe(false);
    expect(shouldSubmitActionFromKeyboard({ ...enterEvent, ctrlKey: true }, true)).toBe(true);
    expect(shouldSubmitActionFromKeyboard({ ...enterEvent, ctrlKey: true, shiftKey: true }, true)).toBe(false);
    expect(shouldSubmitActionFromKeyboard({ ...enterEvent, ctrlKey: true, repeat: true }, true)).toBe(false);
    expect(shouldSubmitActionFromKeyboard({ ...enterEvent, ctrlKey: true, isComposing: true }, true)).toBe(false);
  });

  it('wires cancellation to the owned execution and restores the interrupted action', () => {
    expect(gameScreenSource).toContain('const handleCancelGeneration = useCallback(() => {');
    expect(gameScreenSource).toContain('executionOwner.abort()');
    expect(gameScreenSource).toContain('currentInput.trim() ? currentInput : interruptedAction');
    expect(gameScreenSource).toContain('settleExecutionUi(execution');
    expect(gameScreenSource).toContain('回车换行；右 Ctrl + Enter 执行动作');
  });
});
