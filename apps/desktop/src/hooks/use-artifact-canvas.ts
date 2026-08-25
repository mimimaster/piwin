/**
 * Ephemeral Artifact Canvas lifecycle.
 *
 * Owns the single active Canvas target and clears it on active-session change
 * so a stale Canvas from a previous conversation cannot appear attached to a
 * new one (ADR 0029 §2.5). No persistence: a full reload shows the Canvas
 * empty state, never stale source.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArtifactCanvasTarget } from '../artifact-canvas-model';

export type UseArtifactCanvasResult = {
  activeTarget: ArtifactCanvasTarget | null;
  /** Replace the active target. Opening another Canvas replaces the first. */
  openTarget: (target: ArtifactCanvasTarget) => void;
};

/**
 * @param activeSessionId Current session id. When it changes, the active
 *   Canvas target is cleared so old session content cannot leak across
 *   conversations.
 */
export function useArtifactCanvas(activeSessionId: string | null): UseArtifactCanvasResult {
  const [activeTarget, setActiveTarget] = useState<ArtifactCanvasTarget | null>(null);
  const sessionRef = useRef(activeSessionId);

  // Clear on session switch. Compares against the last seen session id so the
  // initial mount with a non-null session does not clear a target that was
  // just opened by the same render.
  useEffect(() => {
    if (sessionRef.current !== activeSessionId) {
      sessionRef.current = activeSessionId;
      setActiveTarget(null);
    }
  }, [activeSessionId]);

  const openTarget = useCallback((target: ArtifactCanvasTarget): void => {
    setActiveTarget(target);
  }, []);

  return { activeTarget, openTarget };
}
