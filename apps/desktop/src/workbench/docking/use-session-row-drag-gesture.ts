import { useEffect, useRef, type MouseEventHandler, type PointerEventHandler } from 'react';
import { DRAG_ACTIVATION_THRESHOLD_PX } from './constants.js';
import { useSessionDrag } from './docking-session-drag.js';

const TOUCH_LONG_PRESS_MS = 320;

type Gesture = {
  pointerId: number;
  pointerType: string;
  originX: number;
  originY: number;
  latestX: number;
  latestY: number;
  target: HTMLElement;
  touchActivated: boolean;
};

export type SessionRowDragGesture = {
  handleProps: {
    'data-session-drag-handle': 'true';
    onPointerDown: PointerEventHandler<HTMLElement>;
    onPointerMove: PointerEventHandler<HTMLElement>;
    onPointerUp: PointerEventHandler<HTMLElement>;
    onPointerCancel: PointerEventHandler<HTMLElement>;
  };
  onClickCapture: MouseEventHandler<HTMLButtonElement>;
};

export function useSessionRowDragGesture(args: {
  enabled: boolean;
  sessionId: string;
  label: string;
  projectScopeKey?: string;
}): SessionRowDragGesture {
  const bridge = useSessionDrag();
  const gesture = useRef<Gesture | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);

  const clearTimer = (): void => {
    if (longPressTimer.current === null) return;
    clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  useEffect(() => {
    const cancelPendingTouch = (): void => {
      const current = gesture.current;
      clearTimer();
      if (!current || current.pointerType !== 'touch' || current.touchActivated) return;
      try {
        current.target.releasePointerCapture(current.pointerId);
      } catch {
        // Capture may already be gone when the window hides.
      }
      gesture.current = null;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      cancelPendingTouch();
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') cancelPendingTouch();
    };
    window.addEventListener('blur', cancelPendingTouch);
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', cancelPendingTouch);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimer();
    };
  }, []);

  const start = (current: Gesture, activateImmediately: boolean): void => {
    bridge?.startSessionDrag({
      sessionId: args.sessionId,
      label: args.label,
      origin: { x: current.latestX, y: current.latestY },
      ...(args.projectScopeKey ? { projectScopeKey: args.projectScopeKey } : {}),
      ...(activateImmediately ? { activateImmediately: true } : {}),
    });
  };

  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (!args.enabled || !bridge) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    suppressClick.current = false;
    const current: Gesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      originX: event.clientX,
      originY: event.clientY,
      latestX: event.clientX,
      latestY: event.clientY,
      target: event.currentTarget,
      touchActivated: false,
    };
    gesture.current = current;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort in WebKit and test DOMs.
    }
    if (event.pointerType !== 'touch') {
      start(current, false);
      return;
    }
    clearTimer();
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      const latest = gesture.current;
      if (!latest || latest.pointerId !== current.pointerId || latest.touchActivated) return;
      latest.touchActivated = true;
      suppressClick.current = true;
      start(latest, true);
    }, TOUCH_LONG_PRESS_MS);
  };

  const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.latestX = event.clientX;
    current.latestY = event.clientY;
    const travelled =
      Math.abs(current.latestX - current.originX) + Math.abs(current.latestY - current.originY);
    if (current.pointerType === 'touch' && !current.touchActivated) {
      if (travelled >= DRAG_ACTIVATION_THRESHOLD_PX) {
        clearTimer();
        gesture.current = null;
      }
      return;
    }
    if (travelled >= DRAG_ACTIVATION_THRESHOLD_PX || current.touchActivated) {
      suppressClick.current = true;
      event.preventDefault();
    }
  };

  const finishPointer = (pointerId: number): void => {
    const current = gesture.current;
    if (!current || current.pointerId !== pointerId) return;
    clearTimer();
    try {
      current.target.releasePointerCapture(pointerId);
    } catch {
      // The browser may already have released capture on pointercancel.
    }
    gesture.current = null;
  };

  const onPointerUp: PointerEventHandler<HTMLElement> = (event) => finishPointer(event.pointerId);
  const onPointerCancel: PointerEventHandler<HTMLElement> = (event) => {
    suppressClick.current = false;
    finishPointer(event.pointerId);
  };
  const onClickCapture: MouseEventHandler<HTMLButtonElement> = (event) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    handleProps: {
      'data-session-drag-handle': 'true',
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
    onClickCapture,
  };
}
