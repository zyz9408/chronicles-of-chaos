import { describe, expect, it, vi } from 'vitest';

import { bindMapWheelZoom, stopMapWheelScroll } from './mapWheelEvent';

describe('stopMapWheelScroll', () => {
  it('prevents map zoom wheel events from scrolling the modal body', () => {
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    stopMapWheelScroll(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });
});

describe('bindMapWheelZoom', () => {
  it('uses a non-passive native wheel listener so the modal cannot scroll during map zoom', () => {
    let wheelListener: ((event: WheelEvent) => void) | undefined;
    const element = {
      addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject, _options?: AddEventListenerOptions) => {
        if (type === 'wheel') wheelListener = listener as (event: WheelEvent) => void;
      }),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement;
    const onZoomDirection = vi.fn();

    const dispose = bindMapWheelZoom(element, onZoomDirection);

    expect(element.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });

    const event = {
      deltaY: 18,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as WheelEvent;
    wheelListener?.(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(onZoomDirection).toHaveBeenCalledWith(-1);

    dispose();

    expect(element.removeEventListener).toHaveBeenCalledWith('wheel', wheelListener);
  });
});
