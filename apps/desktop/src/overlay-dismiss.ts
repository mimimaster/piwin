import { useRef, type PointerEvent } from 'react';

type OverlayPointerTarget = {
  target: unknown;
  currentTarget: unknown;
};

/**
 * Overlay dismiss is a completed press on the dimmed surface: pointer down
 * and pointer up both on the overlay itself. Selecting text inside a dialog
 * and releasing the pointer on the overlay must not close it.
 */
export function overlayPointerBeganOnSurface(event: OverlayPointerTarget): boolean {
  return event.target === event.currentTarget;
}

export function shouldDismissOverlayOnPointerUp(args: {
  pointerBeganOnOverlay: boolean;
  target: unknown;
  currentTarget: unknown;
}): boolean {
  return args.pointerBeganOnOverlay && args.target === args.currentTarget;
}

export type OverlayDismissHandlers = {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
};

export function useOverlayDismiss(onDismiss: () => void): OverlayDismissHandlers {
  const pointerBeganOnOverlayRef = useRef(false);

  return {
    onPointerDown(event) {
      pointerBeganOnOverlayRef.current = overlayPointerBeganOnSurface(event);
    },
    onPointerUp(event) {
      const dismiss = shouldDismissOverlayOnPointerUp({
        pointerBeganOnOverlay: pointerBeganOnOverlayRef.current,
        target: event.target,
        currentTarget: event.currentTarget,
      });
      pointerBeganOnOverlayRef.current = false;
      if (dismiss) onDismiss();
    },
    onPointerCancel() {
      pointerBeganOnOverlayRef.current = false;
    },
  };
}
