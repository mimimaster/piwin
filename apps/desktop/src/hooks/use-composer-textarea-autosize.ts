import { useCallback, useEffect, useRef, type RefObject } from 'react';

export const COMPOSER_TEXTAREA_MAX_HEIGHT_PX = 160;
/** Below this length a draft may still fit under the cap, so always re-measure. */
export const COMPOSER_RESIZE_SKIP_MIN_CHARS = 4000;

export type ComposerTextareaResize = (options?: { force?: boolean }) => void;

/**
 * Grows the composer textarea with its content up to a cap.
 *
 * One frame at a time: the value effect, onInput and paste can all ask within
 * a single keystroke, and each measurement forces a layout to read
 * scrollHeight. A long draft already at the cap stays there — collapsing to
 * `auto` and re-measuring re-laid-out a whole pasted transcript per keystroke.
 * `force` (width or wholesale value changes) always re-measures.
 */
export function useComposerTextareaAutosize(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  layoutKey: unknown,
): ComposerTextareaResize {
  const frameRef = useRef<number | null>(null);
  const forcePendingRef = useRef(false);

  const requestResize = useCallback<ComposerTextareaResize>((options) => {
    if (options?.force === true) forcePendingRef.current = true;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const force = forcePendingRef.current;
      forcePendingRef.current = false;
      const element = textareaRef.current;
      if (!element) return;
      // Reads the committed DOM value, so this callback stays stable.
      if (
        !force &&
        element.value.length >= COMPOSER_RESIZE_SKIP_MIN_CHARS &&
        element.style.height === `${COMPOSER_TEXTAREA_MAX_HEIGHT_PX}px`
      ) {
        return;
      }
      element.style.height = 'auto';
      if (element.value) {
        element.style.height = `${Math.min(element.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT_PX)}px`;
      }
    });
  }, [textareaRef]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );
  useEffect(() => {
    requestResize();
  }, [value, requestResize]);
  useEffect(() => {
    requestResize({ force: true });
  }, [layoutKey, requestResize]);

  return requestResize;
}
