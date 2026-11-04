import { useEffect, useRef, type MutableRefObject } from 'react';
import { BEFORE_RENDERER_RELAUNCH_EVENT } from '../platform/renderer-relaunch-preparation.js';

/** Native termination skips pagehide: flush lossless snapshots or veto before it happens. */
export function useComposerDraftLifecycle(input: {
  persist: () => boolean;
  canRelaunch: () => boolean;
  persistTimerRef: MutableRefObject<number | null>;
}): void {
  const { persist, persistTimerRef } = input;
  const canRelaunchRef = useRef(input.canRelaunch);
  canRelaunchRef.current = input.canRelaunch;
  useEffect(() => {
    const onHide = (): void => {
      persist();
    };
    const beforeRelaunch = (event: Event): void => {
      if (!canRelaunchRef.current() || !persist()) event.preventDefault();
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener(BEFORE_RENDERER_RELAUNCH_EVENT, beforeRelaunch);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener(BEFORE_RENDERER_RELAUNCH_EVENT, beforeRelaunch);
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      persist();
    };
  }, [persist, persistTimerRef]);
}
