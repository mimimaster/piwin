/**
 * Right-panel presentation is conversation-scoped on a session switch.
 *
 * Full width was chosen for the previous conversation's content, so it never
 * carries over. The Canvas target is cleared on the same switch (ADR 0029
 * §2.5, `useArtifactCanvas`), so a panel left on the Canvas tab would only
 * show the empty state — it folds away instead.
 */
import { useEffect, useRef } from 'react';
import type { RightPanelTab } from '../right-panel';
import { rightPanelTabKind } from '../right-panel-instances';

export type UseSessionSwitchPanelResetArgs = {
  /** Must be the id that clears the Canvas target (`state.activeSessionId`). */
  activeSessionId: string | null;
  rightPanelOpen: boolean;
  rightPanelTab: RightPanelTab | null;
  setFullWidth: (next: boolean) => void;
  dismissInspector: () => void;
};

export function useSessionSwitchPanelReset(args: UseSessionSwitchPanelResetArgs): void {
  const { activeSessionId, setFullWidth, dismissInspector } = args;
  const sessionRef = useRef(activeSessionId);
  // Panel state is read at switch time only; opening or retabbing the panel
  // inside one conversation must not trigger a reset.
  const panelRef = useRef({ open: args.rightPanelOpen, tab: args.rightPanelTab });
  panelRef.current = { open: args.rightPanelOpen, tab: args.rightPanelTab };

  useEffect(() => {
    if (sessionRef.current === activeSessionId) return;
    sessionRef.current = activeSessionId;
    setFullWidth(false);
    const { open, tab } = panelRef.current;
    if (open && tab !== null && rightPanelTabKind(tab) === 'canvas') {
      dismissInspector();
    }
  }, [activeSessionId, dismissInspector, setFullWidth]);
}
