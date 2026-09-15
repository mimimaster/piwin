import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HostClient } from '../../host-client.js';
import { shouldRevealBrowserInspector } from '../../browser-inspector-reveal.js';
import type { RightPanelTab } from '../../right-panel.js';
import { PERSIST_DEBOUNCE_MS } from './constants.js';
import { tryOpenDockingTool } from './docking-tool-bridge.js';
import { createWorkspaceIdFactory, type WorkspaceIdFactory } from './ids.js';
import { selectLiveSessionIds } from './live-budget.js';
import {
  backupConversationPaneV1,
  loadWorkspaceState,
  saveWorkspaceState,
} from './persist.js';
import type { WorkspaceState } from './types.js';
import { createWorkspaceState, openSessionView, openToolView as applyOpenToolView } from './view-commands.js';
import type { MovableToolKind } from './types.js';

export type DockingWorkspaceController = {
  enabled: boolean;
  state: WorkspaceState;
  notice: string | null;
  liveSessionIds: string[];
  createId: WorkspaceIdFactory;
  dismissNotice: () => void;
  pushNotice: (message: string) => void;
  setState: (update: (current: WorkspaceState) => WorkspaceState) => void;
  openOrFocusSession: (sessionId: string) => void;
  openToolView: (kind: MovableToolKind) => void;
};

export function useDockingWorkspace(args: {
  enabled: boolean;
  scopeKey?: string;
  hostClient?: HostClient;
  hiddenMruSessionIds?: readonly string[];
  inspectorTab?: RightPanelTab | null;
}): DockingWorkspaceController {
  const createId = useMemo(() => createWorkspaceIdFactory(), []);
  const [state, setState] = useState<WorkspaceState>(() => createWorkspaceState(createId));
  const [notice, setNotice] = useState<string | null>(null);
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | undefined>(undefined);
  const [hydrated, setHydrated] = useState(false);
  const persistTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!args.enabled) return;
    const storage = typeof window === 'undefined' ? undefined : window.localStorage;
    if (!storage) return;
    if (hydrated && loadedScopeKey === args.scopeKey) return;
    backupConversationPaneV1(storage, args.scopeKey);
    const loaded = loadWorkspaceState(createId, storage, args.scopeKey);
    setState(loaded.state);
    setNotice(loaded.notice);
    setLoadedScopeKey(args.scopeKey);
    setHydrated(true);
    if (loaded.migrated) {
      saveWorkspaceState(loaded.state, storage, args.scopeKey);
    }
  }, [args.enabled, args.scopeKey, createId, hydrated, loadedScopeKey]);

  useEffect(() => {
    if (!args.enabled || !hydrated || loadedScopeKey !== args.scopeKey) return;
    const storage = typeof window === 'undefined' ? undefined : window.localStorage;
    if (!storage) return;
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      saveWorkspaceState(state, storage, args.scopeKey);
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    };
  }, [args.enabled, args.scopeKey, hydrated, loadedScopeKey, state]);

  const liveSessionIds = useMemo(
    () => selectLiveSessionIds(state, args.hiddenMruSessionIds ?? []),
    [args.hiddenMruSessionIds, state],
  );
  const liveSignature = liveSessionIds.join('\u0000');

  useEffect(() => {
    if (!args.enabled || !args.hostClient) return;
    void args.hostClient.updateSubscriptions(liveSessionIds).catch((error: unknown) => {
      console.warn('Failed to update docking workspace live subscriptions.', error);
    });
  }, [args.enabled, args.hostClient, liveSignature, liveSessionIds]);

  const apply = useCallback((update: (current: WorkspaceState) => WorkspaceState) => {
    setState((current) => update(current));
  }, []);

  const openOrFocusSession = useCallback(
    (sessionId: string) => {
      setState((current) => {
        const result = openSessionView(current, sessionId, createId);
        return result.ok ? result.state : current;
      });
    },
    [createId],
  );

  const openToolView = useCallback(
    (kind: MovableToolKind) => {
      setState((current) => {
        const result = applyOpenToolView(current, kind, createId);
        if (!result.ok) {
          const message = result.message;
          window.setTimeout(() => setNotice(message), 0);
          return current;
        }
        return result.state;
      });
    },
    [createId],
  );

  useEffect(() => {
    if (!args.enabled) return;
    tryOpenDockingTool({
      enabled: true,
      tab: args.inspectorTab ?? null,
      openToolView,
    });
  }, [args.enabled, args.inspectorTab, openToolView]);

  useEffect(() => {
    if (!args.enabled || !args.hostClient) return;
    return args.hostClient.subscribe((message) => {
      if (shouldRevealBrowserInspector(message)) openToolView('browser');
    });
  }, [args.enabled, args.hostClient, openToolView]);

  const dismissNotice = useCallback(() => setNotice(null), []);
  const pushNotice = useCallback((message: string) => setNotice(message), []);

  return useMemo(
    () => ({
      enabled: args.enabled,
      state,
      notice,
      liveSessionIds,
      createId,
      dismissNotice,
      pushNotice,
      setState: apply,
      openOrFocusSession,
      openToolView,
    }),
    [apply, args.enabled, createId, dismissNotice, liveSessionIds, notice, openOrFocusSession, openToolView, pushNotice, state],
  );
}
