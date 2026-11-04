import { useEffect, useRef } from 'react';
import { BEFORE_RENDERER_RELAUNCH_EVENT } from '../platform/renderer-relaunch-preparation.js';

/** Owners veto native termination while their renderer-local state is irreplaceable. */
export function useRendererRelaunchGuard(blocked: boolean | (() => boolean)): void {
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  useEffect(() => {
    const protect = (event: Event): void => {
      const current = blockedRef.current;
      if (typeof current === 'function' ? current() : current) event.preventDefault();
    };
    window.addEventListener(BEFORE_RENDERER_RELAUNCH_EVENT, protect);
    return () => window.removeEventListener(BEFORE_RENDERER_RELAUNCH_EVENT, protect);
  }, []);
}
