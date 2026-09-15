/**
 * Pointer Events + IME bridge for the browser workbench (spec §4.4).
 *
 * pointerdown takes capture and sends mouse down; captured moves send move;
 * pointerup sends up and releases. Cancel, blur, unmount, or an agent lock
 * release any held buttons. Pick mode consumes the pointerup as pick-at and
 * never dispatches the same gesture to the page.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { BrowserController, BrowserInputEvent, BrowserTargetIdentity } from '@piwin/contracts';
import { viewportFromFilledDisplay } from '../browser-workbench-pointer';

export type BrowserInputHost = {
  browserInput: (
    events: BrowserInputEvent[],
    target?: BrowserTargetIdentity,
  ) => Promise<unknown>;
  browserPickAt: (
    x: number,
    y: number,
    target?: BrowserTargetIdentity,
  ) => Promise<{ success: boolean }>;
};

export type UseBrowserInputOptions = {
  hostClient: BrowserInputHost;
  imgRef: { current: HTMLImageElement | null };
  viewportWidth: number;
  viewportHeight: number;
  interactEnabled: boolean;
  pickMode: boolean;
  owner: BrowserController;
  target?: BrowserTargetIdentity;
  onPickStart?: () => void;
  onPickFailed?: () => void;
  onPickSettled?: () => void;
};

function mouseButton(button: number): 'left' | 'middle' | 'right' {
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'left';
}

export function useBrowserInput(options: UseBrowserInputOptions): {
  onPointerDown: (event: ReactPointerEvent<HTMLImageElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLImageElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLImageElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLImageElement>) => void;
  onClick: (event: ReactMouseEvent<HTMLImageElement>) => void;
  onWheel: (event: { preventDefault: () => void; deltaX: number; deltaY: number; clientX: number; clientY: number }) => void;
  sendKeyEvents: (events: BrowserInputEvent[]) => void;
  releaseHeldButtons: () => void;
} {
  const pressedRef = useRef<{ button: 'left' | 'middle' | 'right'; x: number; y: number } | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastPointerUpAtRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const toViewport = useCallback(
    (event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
      const img = options.imgRef.current;
      if (!img || options.viewportWidth === 0) return null;
      const rect = img.getBoundingClientRect();
      return viewportFromFilledDisplay({
        displayX: event.clientX - rect.left,
        displayY: event.clientY - rect.top,
        displayWidth: img.clientWidth,
        displayHeight: img.clientHeight,
        viewportWidth: options.viewportWidth,
        viewportHeight: options.viewportHeight,
      });
    },
    [options.imgRef, options.viewportWidth, options.viewportHeight],
  );

  const send = useCallback(
    (events: BrowserInputEvent[]): void => {
      const current = optionsRef.current;
      if (!current.interactEnabled || events.length === 0) return;
      void current.hostClient.browserInput(events, current.target);
    },
    [],
  );

  const releaseHeldButtons = useCallback((): void => {
    const pressed = pressedRef.current;
    pressedRef.current = null;
    if (pressed === null) return;
    send([
      {
        type: 'mouse',
        action: 'up',
        x: pressed.x,
        y: pressed.y,
        button: pressed.button,
      },
    ]);
  }, [send]);

  useEffect(() => {
    if (options.owner === 'agent') releaseHeldButtons();
  }, [options.owner, releaseHeldButtons]);

  useEffect(() => {
    const onBlur = (): void => releaseHeldButtons();
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      releaseHeldButtons();
    };
  }, [releaseHeldButtons]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLImageElement>): void => {
      if (options.pickMode) return;
      if (!options.interactEnabled) return;
      const point = toViewport(event);
      if (!point) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const button = mouseButton(event.button);
      const clickCount = event.detail > 1 ? event.detail : 1;
      pressedRef.current = { button, x: point.x, y: point.y };
      lastPointRef.current = point;
      send([
        {
          type: 'mouse',
          action: 'down',
          x: point.x,
          y: point.y,
          button,
          ...(clickCount > 1 ? { clickCount } : {}),
        },
      ]);
    },
    [options.interactEnabled, options.pickMode, send, toViewport],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLImageElement>): void => {
      if (options.pickMode || !options.interactEnabled) return;
      const point = toViewport(event);
      if (!point) return;
      lastPointRef.current = point;
      if (pressedRef.current !== null) {
        pressedRef.current = { ...pressedRef.current, x: point.x, y: point.y };
      }
      send([{ type: 'mouse', action: 'move', x: point.x, y: point.y }]);
    },
    [options.interactEnabled, options.pickMode, send, toViewport],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLImageElement>): void => {
      const point = toViewport(event) ?? lastPointRef.current;
      lastPointerUpAtRef.current = Date.now();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (options.pickMode) {
        if (!point) return;
        options.onPickStart?.();
        void options.hostClient
          .browserPickAt(point.x, point.y, options.target)
          .then((response) => {
            if (!response.success) options.onPickFailed?.();
          })
          .catch(() => options.onPickFailed?.())
          .finally(() => options.onPickSettled?.());
        return;
      }
      if (!options.interactEnabled || pressedRef.current === null) return;
      const button = pressedRef.current.button;
      pressedRef.current = null;
      if (!point) return;
      const clickCount = event.detail > 1 ? event.detail : 1;
      send([
        {
          type: 'mouse',
          action: 'up',
          x: point.x,
          y: point.y,
          button,
          ...(clickCount > 1 ? { clickCount } : {}),
        },
      ]);
    },
    [options, send, toViewport],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLImageElement>): void => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      releaseHeldButtons();
    },
    [releaseHeldButtons],
  );

  const onWheel = useCallback(
    (event: {
      preventDefault: () => void;
      deltaX: number;
      deltaY: number;
      clientX: number;
      clientY: number;
    }): void => {
      if (!options.interactEnabled || options.pickMode) return;
      event.preventDefault();
      const point = toViewport(event);
      if (!point) return;
      send([
        {
          type: 'mouse',
          action: 'wheel',
          x: point.x,
          y: point.y,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
        },
      ]);
    },
    [options.interactEnabled, options.pickMode, send, toViewport],
  );

  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLImageElement>): void => {
      if (Date.now() - lastPointerUpAtRef.current < 100) return;
      const point = toViewport(event);
      if (!point) return;
      if (options.pickMode) {
        options.onPickStart?.();
        void options.hostClient
          .browserPickAt(point.x, point.y, options.target)
          .then((response) => {
            if (!response.success) options.onPickFailed?.();
          })
          .catch(() => options.onPickFailed?.())
          .finally(() => options.onPickSettled?.());
        return;
      }
      if (!options.interactEnabled) return;
      const button = mouseButton(event.button);
      const clickCount = event.detail > 1 ? event.detail : 1;
      send([
        {
          type: 'mouse',
          action: 'down',
          x: point.x,
          y: point.y,
          button,
          ...(clickCount > 1 ? { clickCount } : {}),
        },
        {
          type: 'mouse',
          action: 'up',
          x: point.x,
          y: point.y,
          button,
          ...(clickCount > 1 ? { clickCount } : {}),
        },
      ]);
    },
    [options, send, toViewport],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClick,
    onWheel,
    sendKeyEvents: send,
    releaseHeldButtons,
  };
}
