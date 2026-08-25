import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HostClient } from './host-client.js';
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
} from './conversation-pane-layout.js';
import {
  focusAdjacentConversationPane,
  focusConversationPaneDirection,
  resizeFocusedConversationPane,
} from './conversation-pane-navigation.js';
import {
  loadConversationPaneLayout,
  saveConversationPaneLayout,
} from './conversation-pane-storage.js';

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
}): ConversationPaneLayoutController {
  const [layout, setLayout] = useState(loadConversationPaneLayout);
  const createId: ConversationPaneIdFactory = useCallback(createLayoutId, []);

  useEffect(() => {
    if (!args.enabled) return;
    setLayout((current) => replacePrimaryConversationSession(current, args.primarySessionId));
  }, [args.enabled, args.primarySessionId]);

  useEffect(() => {
    saveConversationPaneLayout(layout);
  }, [layout]);

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

export function useConversationPaneSubscriptions(args: {
  hostClient: HostClient;
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
    void args.hostClient.updateSubscriptions(sessionIds).catch((error: unknown) => {
      console.warn('Failed to update live Chat pane subscriptions.', error);
    });
  }, [args.hostClient, signature]);
}
