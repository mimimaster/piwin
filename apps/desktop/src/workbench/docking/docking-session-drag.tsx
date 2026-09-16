import { createContext, useContext, useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import type { Point } from './drag-hit-test.js';

export type SessionDragRequest = {
  sessionId: string;
  /** Pointer position at drag start; the docking engine applies its own threshold. */
  origin: Point;
  /** Scope key of the session's project, for cross-project drop rejection. */
  projectScopeKey?: string;
};

export type SessionDragStarter = (request: SessionDragRequest) => void;

export type SessionDragBridge = {
  /** Sidebar rows call this; a no-op until the docking workspace registers. */
  startSessionDrag: SessionDragStarter;
  /** The docking workspace owns stage geometry, so it supplies the starter. */
  registerStarter: (starter: SessionDragStarter | null) => void;
};

const SessionDragContext = createContext<SessionDragBridge | null>(null);

/**
 * Bridges sidebar session rows (outside the stage) to the docking drag engine
 * (inside the stage) without threading props through the sidebar tree.
 */
export function SessionDragProvider(props: { children: ReactNode }): ReactElement {
  const starterRef = useRef<SessionDragStarter | null>(null);
  const value = useMemo<SessionDragBridge>(
    () => ({
      startSessionDrag: (request) => {
        starterRef.current?.(request);
      },
      registerStarter: (starter) => {
        starterRef.current = starter;
      },
    }),
    [],
  );
  return <SessionDragContext.Provider value={value}>{props.children}</SessionDragContext.Provider>;
}

/** Null outside docking: sidebar rows then keep their click-only behavior. */
export function useSessionDrag(): SessionDragBridge | null {
  return useContext(SessionDragContext);
}
