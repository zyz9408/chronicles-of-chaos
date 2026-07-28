import React, { useCallback, useEffect, useRef } from 'react';

interface PressAndHoldButtonProps {
  label: string;
  disabled?: boolean;
  onActivate: () => void;
  children: React.ReactNode;
}

const HOLD_DELAY_MS = 360;
const HOLD_INTERVAL_MS = 75;

export const PressAndHoldButton: React.FC<PressAndHoldButtonProps> = ({
  label,
  disabled = false,
  onActivate,
  children,
}) => {
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);
  const suppressKeyboardClickRef = useRef(false);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (delayRef.current !== null) {
      clearTimeout(delayRef.current);
      delayRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (disabled || activeRef.current) return;
    activeRef.current = true;
    onActivate();
    delayRef.current = setTimeout(() => {
      intervalRef.current = setInterval(onActivate, HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  }, [disabled, onActivate]);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);

  return (
    <button
      type="button"
      aria-label={label}
      title={`${label}（按住可连续调整）`}
      data-press-and-hold="true"
      disabled={disabled}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        suppressKeyboardClickRef.current = true;
        start();
      }}
      onKeyUp={(event) => {
        if (event.key === 'Enter' || event.key === ' ') stop();
      }}
      onBlur={stop}
      onClick={(event) => {
        // 键盘激活会在 keyup 后再派发 detail=0 的 click；只让没有键盘前置事件的
        // 屏幕阅读器/程序化 click 补触发一次。
        if (suppressKeyboardClickRef.current) {
          suppressKeyboardClickRef.current = false;
          return;
        }
        if (event.detail === 0 && !activeRef.current) onActivate();
      }}
    >
      {children}
    </button>
  );
};
