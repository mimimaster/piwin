/**
 * Tap-to-select for scrollable option lists (touch and mouse).
 *
 * A row is chosen on pointer-up only when the pointer stayed put: moving more
 * than TAP_SLOP_PX, a scroll of the list (call `cancel` from its onScroll),
 * or pointercancel drops the gesture. The pressed look waits PRESS_DELAY_MS so
 * a swipe that starts on a row never flashes it. Keyboard activation (click
 * with detail 0) selects directly.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent, type MouseEvent } from 'react';

export const TAP_SLOP_PX = 8;
export const PRESS_DELAY_MS = 120;

type Gesture = { key: string; pointerId: number; x: number; y: number; timer: number | undefined };

export type TapRowProps = {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
};

export function useTapSelect(
  onSelect: (key: string) => void,
  options: { preventFocusLoss?: boolean } = {},
): { pressedKey: string | null; rowProps: (key: string) => TapRowProps; cancel: () => void } {
  const gesture = useRef<Gesture | null>(null);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const preventFocusLoss = options.preventFocusLoss === true;

  const cancel = useCallback((): void => {
    const current = gesture.current;
    if (current?.timer !== undefined) window.clearTimeout(current.timer);
    gesture.current = null;
    setPressedKey(null);
  }, []);

  useEffect(() => cancel, [cancel]);

  const rowProps = useCallback(
    (key: string): TapRowProps => ({
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        // Keeps an autofocused search field (and a Radix popover) from losing
        // focus before the pointer comes back up.
        if (preventFocusLoss) event.preventDefault();
        cancel();
        const timer = window.setTimeout(() => {
          if (gesture.current?.key === key) setPressedKey(key);
        }, PRESS_DELAY_MS);
        gesture.current = { key, pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer };
      },
      onPointerMove: (event) => {
        const current = gesture.current;
        if (current === null || current.pointerId !== event.pointerId) return;
        if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > TAP_SLOP_PX) cancel();
      },
      onPointerUp: (event) => {
        const current = gesture.current;
        if (current === null || current.pointerId !== event.pointerId || current.key !== key) {
          cancel();
          return;
        }
        const moved = Math.hypot(event.clientX - current.x, event.clientY - current.y) > TAP_SLOP_PX;
        cancel();
        if (!moved) selectRef.current(key);
      },
      onPointerCancel: cancel,
      onPointerLeave: (event) => {
        // Touch pointers "leave" on lift; only a mouse drag-off cancels here.
        if (event.pointerType === 'mouse') cancel();
      },
      onClick: (event) => {
        // Pointer taps were already handled on pointer-up; detail 0 = keyboard.
        if (event.detail === 0) selectRef.current(key);
      },
    }),
    [cancel, preventFocusLoss],
  );

  return { pressedKey, rowProps, cancel };
}
