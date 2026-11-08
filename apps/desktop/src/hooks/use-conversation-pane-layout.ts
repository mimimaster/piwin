import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LiveSessionInventory } from '../workbench/live-session-inventory.js';
import {
  applyConversationPanePreset,
  bindConversationPaneSession,
  closeConversationPane,
  CONVERSATION_PANE_MAX_COUNT,
  focusConversationPane,
  listConversationPaneLeaves,
  replacePrimaryConversationSession,
  setConversationPaneSplitRatio,
  splitConversationPane,
  toggleMaximizedConversationPane,
  type ConversationPaneDirection,
  type ConversationPaneIdFactory,
  type ConversationPaneLayout,
  type ConversationPaneOrientation,
  type ConversationPanePreset,
} from '../conversation/conversation-pane-layout.js';
import {
  focusAdjacentConversationPane,
  focusConversationPaneDirection,
  resizeFocusedConversationPane,
} from '../conversation/conversation-pane-navigation.js';
import {
  loadConversationPaneLayout,
  saveConversationPaneLayout,
} from '../conversation/conversation-pane-storage.js';

export type ConversationPaneLayoutController = {
  layout: ConversationPaneLayout;
  update: (update: (layout: ConversationPaneLayout) => ConversationPaneLayout) => void;
  focus: (paneId: string) => void;
  focusAdjacent: (offset: -1 | 1) => void;
  focusDirection: (direction: ConversationPaneDirection) => void;
  split: (paneId: string, orientation: ConversationPaneOrientation) => void;
  close: (paneId: string) => void;
  bindSession: (paneId: string, sessionId: string | null) => void;
  applyPreset: (count: ConversationPanePreset) => void;
  setRatio: (splitId: string, ratio: number) => void;
  resizeFocused: (direction: ConversationPaneDirection) => void;
  toggleMaximized: (paneId?: string) => void;
};

function createLayoutId(kind: 'pane' | 'split'): string {
  return `conversation-${kind}-${crypto.randomUUID()}`;
}

export function useConversationPaneLayout(args: {
  enabled: boolean;
  primarySessionId: string | null;
  scopeKey?: string;
}): ConversationPaneLayoutController {
  const [layout, setLayout] = useState(() => loadConversationPaneLayout(undefined, args.scopeKey));
  const [loadedScopeKey, setLoadedScopeKey] = useState(args.scopeKey);
  const createId: ConversationPaneIdFactory = useCallback(createLayoutId, []);

  useEffect(() => {
    if (!args.enabled) return;
    if (loadedScopeKey !== args.scopeKey) {
      setLayout(loadConversationPaneLayout(undefined, args.scopeKey));
      setLoadedScopeKey(args.scopeKey);
      return;
    }
    setLayout((current) => replacePrimaryConversationSession(current, args.primarySessionId));
  }, [args.enabled, args.primarySessionId, args.scopeKey, loadedScopeKey]);

  useEffect(() => {
    if (!args.enabled) return;
    if (loadedScopeKey !== args.scopeKey) return;
    saveConversationPaneLayout(layout, undefined, args.scopeKey);
  }, [args.enabled, args.scopeKey, layout, loadedScopeKey]);

  const update = useCallback(
    (transform: (current: ConversationPaneLayout) => ConversationPaneLayout): void => {
      setLayout((current) => transform(current));
    },
    [],
  );

  return useMemo(
    () => ({
      layout,
      update,
      focus: (paneId: string) => update((current) => focusConversationPane(current, paneId)),
      focusAdjacent: (offset: -1 | 1) =>
        update((current) => focusAdjacentConversationPane(current, offset)),
      focusDirection: (direction: ConversationPaneDirection) =>
        update((current) => focusConversationPaneDirection(current, direction)),
      split: (paneId: string, orientation: ConversationPaneOrientation) =>
        update((current) => splitConversationPane(current, paneId, orientation, createId)),
      close: (paneId: string) => update((current) => closeConversationPane(current, paneId)),
      bindSession: (paneId: string, sessionId: string | null) =>
        update((current) => bindConversationPaneSession(current, paneId, sessionId)),
      applyPreset: (count: ConversationPanePreset) =>
        update((current) => applyConversationPanePreset(current, count, createId)),
      setRatio: (splitId: string, ratio: number) =>
        update((current) => setConversationPaneSplitRatio(current, splitId, ratio)),
      resizeFocused: (direction: ConversationPaneDirection) =>
        update((current) => resizeFocusedConversationPane(current, direction)),
      toggleMaximized: (paneId?: string) =>
        update((current) => toggleMaximizedConversationPane(current, paneId)),
    }),
    [createId, layout, update],
  );
}

/**
 * Declares this layout's live sessions to the shared inventory — it no longer
 * calls `updateSubscriptions` itself (S04a: one writer only). Side chats are
 * contributed by the inventory writer, so this hook declares only what the
 * pane layout owns: pane leaf sessions, or just the active session when panes
 * are off (docking owns the workspace then; the union dedupes the overlap).
 */
export function useConversationPaneSubscriptions(args: {
  inventory: LiveSessionInventory;
  activeSessionId: string | null;
  paneLayout: ConversationPaneLayout;
  panesEnabled: boolean;
}): void {
  const sessionIds = useMemo(() => {
    const candidates = args.panesEnabled
      ? [
          args.activeSessionId,
          ...listConversationPaneLeaves(args.paneLayout.root).map((leaf) => leaf.sessionId),
        ]
      : [args.activeSessionId];
    return Array.from(
      new Set(candidates.filter((sessionId): sessionId is string => sessionId !== null)),
    ).slice(0, CONVERSATION_PANE_MAX_COUNT);
  }, [args.activeSessionId, args.paneLayout.root, args.panesEnabled]);
  const signature = sessionIds.join('\u0000');

  useEffect(() => {
    args.inventory.setContribution('panes', sessionIds);
    return () => args.inventory.setContribution('panes', null);
  }, [args.inventory, signature, sessionIds]);
}
