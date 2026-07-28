export interface MapWheelEventBoundary {
  preventDefault: () => void;
  stopPropagation: () => void;
  cancelable?: boolean;
}

export function stopMapWheelScroll(event: MapWheelEventBoundary): void {
  if (event.cancelable !== false) {
    event.preventDefault();
  }
  event.stopPropagation();
}

export type MapWheelZoomDirection = -1 | 1;

export function bindMapWheelZoom(
  element: HTMLElement,
  onZoomDirection: (direction: MapWheelZoomDirection) => void,
): () => void {
  const handleWheel = (event: WheelEvent) => {
    stopMapWheelScroll(event);
    onZoomDirection(event.deltaY > 0 ? -1 : 1);
  };

  element.addEventListener('wheel', handleWheel, { passive: false });

  return () => {
    element.removeEventListener('wheel', handleWheel);
  };
}
