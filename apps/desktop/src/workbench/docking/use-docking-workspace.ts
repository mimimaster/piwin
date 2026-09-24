import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HostClient } from '../../host-client.js';
import { shouldRevealBrowserInspector } from '../../browser-inspector-reveal.js';
import type { RightPanelTab } from '../../right-panel.js';
import type { SurfaceTitlebar } from '../../surface-titlebar.js';
import { PERSIST_DEBOUNCE_MS } from './constants.js';
import { tryOpenDockingTool } from './docking-tool-bridge.js';
import { createWorkspaceIdFactory, type WorkspaceIdFactory } from './ids.js';
import { selectLiveSessionIds } from './live-budget.js';
import {
  backupConversationPaneV1,
  loadWorkspaceState,
  saveWorkspaceState,
} from './persist.js';
import { findViewGroupId, isRightGroupId } from './topology.js';
import type { WorkspaceState } from './types.js';
import { createWorkspaceState, openSessionView, openToolView as applyOpenToolView } from './view-commands.js';
import { isMovableToolKind, type MovableToolKind } from './types.js';

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
  /** Ask the workbench right panel to show the focused right-group tool. */
  requestRightReveal: () => void;
  /** Elements the workbench right panel lends to the right tool group. */
  rightHost: DockingRightHost;
  setRightSlot: (node: HTMLElement | null) => void;
  setRightPanelElement: (node: HTMLElement | null) => void;
  setRightTitlebar: (titlebar: SurfaceTitlebar | null) => void;
};

/**
 * The right tool group has no chrome of its own: it lives inside the
 * workbench right panel, which provides the body slot, the drop target, and
 * the titlebar slots a docked browser takes over.
 */
export type DockingRightHost = {
  open: boolean;
  slot: HTMLElement | null;
  panel: HTMLElement | null;
  titlebar: SurfaceTitlebar | null;
};

export function useDockingWorkspace(args: {
  enabled: boolean;
  scopeKey?: string;
  hostClient?: HostClient;
  hiddenMruSessionIds?: readonly string[];
  inspectorTab?: RightPanelTab | null;
  rightPanelOpen?: boolean;
  /** A tool was opened or dropped into the right group: show it there. */
  onRevealRightTool?: (kind: MovableToolKind) => void;
}): DockingWorkspaceController {
  const createId = useMemo(() => createWorkspaceIdFactory(), []);
  const [state, setState] = useState<WorkspaceState>(() => createWorkspaceState(createId));
  const [notice, setNotice] = useState<string | null>(null);
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | undefined>(undefined);
  const [hydrated, setHydrated] = useState(false);
  const persistTimer = useRef<number | null>(null);
  const [rightSlot, setRightSlot] = useState<HTMLElement | null>(null);
  const [rightPanelElement, setRightPanelElement] = useState<HTMLElement | null>(null);
  const [rightTitlebar, setRightTitlebarState] = useState<SurfaceTitlebar | null>(null);
  const [revealTick, setRevealTick] = useState(0);
  const revealRef = useRef(args.onRevealRightTool);
  revealRef.current = args.onRevealRightTool;

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
      setRevealTick((tick) => tick + 1);
    },
    [createId],
  );

  const requestRightReveal = useCallback(() => setRevealTick((tick) => tick + 1), []);

  // Only explicit opens and drops reveal; plain focus changes (closing a tab,
  // hydrating a layout) must not pop the right panel open.
  const handledRevealTick = useRef(0);
  useEffect(() => {
    if (!args.enabled || revealTick === handledRevealTick.current) return;
    handledRevealTick.current = revealTick;
    const focused = state.focusedViewId;
    const view = focused ? state.views[focused] : undefined;
    if (!view || !isMovableToolKind(view.kind)) return;
    const groupId = findViewGroupId(state, view.viewId);
    if (!groupId || !isRightGroupId(state, groupId)) return;
    revealRef.current?.(view.kind);
  }, [args.enabled, revealTick, state]);

  const setRightTitlebar = useCallback((titlebar: SurfaceTitlebar | null) => {
    setRightTitlebarState((current) =>
      current?.tabsSlot === titlebar?.tabsSlot && current?.actionsSlot === titlebar?.actionsSlot
        ? current
        : titlebar,
    );
  }, []);

  const rightPanelOpen = args.rightPanelOpen === true;
  const rightHost = useMemo<DockingRightHost>(
    () => ({ open: rightPanelOpen, slot: rightSlot, panel: rightPanelElement, titlebar: rightTitlebar }),
    [rightPanelElement, rightPanelOpen, rightSlot, rightTitlebar],
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
      requestRightReveal,
      rightHost,
      setRightSlot,
      setRightPanelElement,
      setRightTitlebar,
    }),
    [
      apply,
      args.enabled,
      createId,
      dismissNotice,
      liveSessionIds,
      notice,
      openOrFocusSession,
      openToolView,
      pushNotice,
      requestRightReveal,
      rightHost,
      setRightTitlebar,
      state,
    ],
  );
}
