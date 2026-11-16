import { useEffect, useRef, useState } from 'react';
import type { RightPanelTab } from './right-panel-sections.js';
import { existingTabForKind, rightPanelTabKind } from './right-panel-instances.js';

function findRequestedTab(requested: RightPanelTab, tabs: readonly RightPanelTab[]): RightPanelTab | null {
  if (tabs.includes(requested)) return requested;
  return requested === rightPanelTabKind(requested) ? existingTabForKind(requested, tabs) : null;
}

/** Listed tabs are explicit navigation; retained terminal owners have a separate lifetime. */
export function useRightPanelNavigation(input: {
  open: boolean;
  requestedTab: RightPanelTab | null;
  sessionId: string | null | undefined;
  scopeKey: string | undefined;
  dockedTabs: readonly RightPanelTab[];
  keepsTab: (tab: RightPanelTab) => boolean;
  onTabChange: (tab: RightPanelTab | null) => void;
  onSessionChange: (tab: RightPanelTab | null) => void;
}) {
  const { open, requestedTab, sessionId, keepsTab, onTabChange, onSessionChange } = input;
  const [openTabs, setOpenTabs] = useState<RightPanelTab[]>([]);
  const [listedTabs, setListedTabs] = useState<RightPanelTab[]>([]);
  const [launcher, setLauncher] = useState(requestedTab === null);
  const ownersRef = useRef(openTabs);
  ownersRef.current = openTabs;
  const dockedRef = useRef(input.dockedTabs);
  dockedRef.current = input.dockedTabs;
  const dockedKey = input.dockedTabs.join('|');
  const previousRequest = useRef<{ open: boolean; tab: RightPanelTab | null }>({ open: false, tab: null });
  const contextKey = `${input.scopeKey ?? ''}\u0000${sessionId ?? ''}`;
  const previousSession = useRef(contextKey);

  useEffect(() => {
    const previous = previousRequest.current;
    previousRequest.current = { open, tab: requestedTab };
    if (!open) return;
    if (requestedTab === null) {
      if (!previous.open || previous.tab !== requestedTab) {
        setLauncher(true);
        setListedTabs([]);
      }
      return;
    }
    const docked = findRequestedTab(requestedTab, dockedRef.current);
    const local = docked === null && keepsTab(requestedTab);
    const resolved = docked ?? findRequestedTab(requestedTab, ownersRef.current) ?? requestedTab;
    if (resolved !== requestedTab) onTabChange(resolved);
    if (local) setOpenTabs((current) => current.includes(resolved) ? current : [...current, resolved]);
    setListedTabs((current) => current.includes(resolved) ? current : [...current, resolved]);
    setLauncher(false);
  }, [dockedKey, keepsTab, onTabChange, open, requestedTab]);

  useEffect(() => {
    if (previousSession.current === contextKey) return;
    previousSession.current = contextKey;
    setLauncher(true);
    setListedTabs([]);
    onSessionChange(null);
  }, [contextKey, onSessionChange]);

  return { openTabs, setOpenTabs, listedTabs, setListedTabs, launcher, setLauncher };
}
