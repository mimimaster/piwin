import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { isRightPanelTab, type StoredRightPanelState } from './right-panel-memory';
import { rightPanelTabKind, type RightPanelTab } from './right-panel-sections';
import { readSessionKeyedValue, writeSessionKeyedValue } from './session-keyed-memory';

export const RIGHT_PANEL_TABS_BY_SESSION_STORAGE_KEY = 'piwin.desktop.rightPanelTabs.bySession.v1';

/**
 * The right panel's own tabs follow the conversation (docked tools follow it
 * through the docking workspace). A session with remembered tabs gets them
 * back; one without (a new conversation) keeps what is showing — the layout of
 * the previous session in this project — minus side chats, which belong to the
 * session that opened them.
 */
export function useRightPanelFollowsSession(args: {
  /** Undefined: the host does not scope the panel to a session. */
  sessionId: string | null | undefined;
  openTabs: readonly RightPanelTab[];
  activeTab: RightPanelTab | null;
  setOpenTabs: Dispatch<SetStateAction<RightPanelTab[]>>;
  onTabChange: (tab: RightPanelTab | null) => void;
  keepsTab: (tab: RightPanelTab) => boolean;
}): void {
  const { sessionId, openTabs, activeTab, setOpenTabs, onTabChange, keepsTab } = args;
  // Starts unset so the session open at launch gets its own layout back too.
  const followedRef = useRef<string | null | undefined>(undefined);
  const keepsTabRef = useRef(keepsTab);
  keepsTabRef.current = keepsTab;

  // Declared before the writer: read the incoming session's tabs before the
  // writer records the outgoing ones under its id.
  useEffect(() => {
    if (sessionId === undefined || followedRef.current === sessionId) return;
    followedRef.current = sessionId;
    if (sessionId === null) return;
    const stored = readSessionKeyedValue(
      RIGHT_PANEL_TABS_BY_SESSION_STORAGE_KEY,
      sessionId,
      parseStoredTabs,
    );
    if (!stored) {
      setOpenTabs((current) =>
        current.some(isSideChatTab) ? current.filter((tab) => !isSideChatTab(tab)) : current,
      );
      if (activeTab !== null && isSideChatTab(activeTab)) onTabChange(null);
      return;
    }
    setOpenTabs(stored.openTabs.filter(keepsTabRef.current));
    onTabChange(stored.activeTab);
    // Only a session switch restores; tab edits are recorded by the writer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || followedRef.current !== sessionId) return;
    writeSessionKeyedValue(RIGHT_PANEL_TABS_BY_SESSION_STORAGE_KEY, sessionId, {
      openTabs: [...openTabs],
      activeTab,
    } satisfies StoredRightPanelState);
  }, [activeTab, openTabs, sessionId]);
}

function isSideChatTab(tab: RightPanelTab): boolean {
  return rightPanelTabKind(tab) === 'sideChat';
}

function parseStoredTabs(value: unknown): StoredRightPanelState | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as { openTabs?: unknown; activeTab?: unknown };
  if (!Array.isArray(record.openTabs)) return null;
  return {
    openTabs: record.openTabs.filter(isRightPanelTab),
    activeTab: isRightPanelTab(record.activeTab) ? record.activeTab : null,
  };
}
