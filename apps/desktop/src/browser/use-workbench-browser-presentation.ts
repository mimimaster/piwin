import { useCallback, useMemo, useState } from 'react';
import type { HostClient } from '../host/host-client.js';
import type { WorkspaceState } from '../workbench/docking/types.js';
import { createBrowserSessionClient } from './browser-session-client.js';
import { useBrowserActivitySignal } from './use-browser-activity-signal.js';
import { browserMiniHostScope, browserMiniPlacementStorageKey } from './browser-mini-placement-store.js';
import { hasBrowserMiniActivity, type BrowserMiniActivity } from './browser-mini-policy.js';
import {
  hasVisibleBrowserPresentation,
  isFullBrowserSurfaceVisible,
} from './browser-presentation-visibility.js';

type MiniDismissalEntry = {
  dismissedWhileAgent: boolean;
  hadActivity: boolean;
};

type MiniDismissalState = {
  hostClient: HostClient;
  hostInstanceId: string | null;
  bySession: Map<string, MiniDismissalEntry>;
};

/**
 * Strictly idempotent reconciliation of per-conversation mini dismissal state.
 * Returns the exact input reference whenever nothing changed so render-phase
 * synchronization never triggers redundant renders.
 */
function reconcileMiniDismissalState(
  state: MiniDismissalState,
  input: {
    hostClient: HostClient;
    hostInstanceId: string | null;
    sessionId: string | null;
    fullVisible: boolean;
    activity: BrowserMiniActivity;
  },
): MiniDismissalState {
  if (state.hostClient !== input.hostClient || state.hostInstanceId !== input.hostInstanceId) {
    return {
      hostClient: input.hostClient,
      hostInstanceId: input.hostInstanceId,
      bySession: new Map(),
    };
  }
  if (input.sessionId === null) return state;
  const entry = state.bySession.get(input.sessionId);
  if (entry === undefined) return state;

  const hasActivity = hasBrowserMiniActivity(input.activity);
  const agentDriving = input.activity.owner === 'agent';

  if (input.fullVisible || (entry.hadActivity && !hasActivity) || (!entry.dismissedWhileAgent && agentDriving)) {
    const nextBySession = new Map(state.bySession);
    nextBySession.delete(input.sessionId);
    return { ...state, bySession: nextBySession };
  }

  const nextHadActivity = entry.hadActivity || hasActivity;
  const nextDismissedWhileAgent = entry.dismissedWhileAgent && agentDriving;
  if (nextHadActivity !== entry.hadActivity || nextDismissedWhileAgent !== entry.dismissedWhileAgent) {
    const nextBySession = new Map(state.bySession);
    nextBySession.set(input.sessionId, {
      hadActivity: nextHadActivity,
      dismissedWhileAgent: nextDismissedWhileAgent,
    });
    return { ...state, bySession: nextBySession };
  }

  return state;
}

export function useWorkbenchBrowserPresentation(input: {
  hostClient: HostClient;
  sessionId: string | null;
  covered: boolean;
  phone: boolean;
  rightPanelOpen: boolean;
  rightPanelBrowser: boolean;
  rightDockedBodyVisible?: boolean;
  dockingState: WorkspaceState | null;
}) {
  const { hostClient, sessionId } = input;
  const hostInstanceId = hostClient.getHostInstanceId();
  const activity = useBrowserActivitySignal(hostClient, sessionId, hostInstanceId);
  const client = useMemo(() => createBrowserSessionClient(hostClient, sessionId ?? undefined),
    // The same transport object can attach to a new Host process; old scoped
    // callbacks must not keep the previous process's presentation identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostClient, sessionId, hostInstanceId]);
  const [dismissal, setDismissal] = useState<MiniDismissalState>(() => ({
    hostClient,
    hostInstanceId,
    bySession: new Map(),
  }));
  const fullVisible = !input.covered && isFullBrowserSurfaceVisible(input);
  const nextDismissal = reconcileMiniDismissalState(dismissal, {
    hostClient,
    hostInstanceId,
    sessionId,
    fullVisible,
    activity,
  });
  if (nextDismissal !== dismissal) setDismissal(nextDismissal);
  const miniDismissed = sessionId !== null && nextDismissal.bySession.has(sessionId);

  const dismissMini = useCallback(() => {
    if (sessionId === null) return;
    setDismissal((current) => {
      const base =
        current.hostClient === hostClient && current.hostInstanceId === hostInstanceId
          ? current
          : { hostClient, hostInstanceId, bySession: new Map<string, MiniDismissalEntry>() };
      const nextBySession = new Map(base.bySession);
      nextBySession.set(sessionId, {
        dismissedWhileAgent: activity.owner === 'agent',
        hadActivity: hasBrowserMiniActivity(activity),
      });
      return { ...base, bySession: nextBySession };
    });
  }, [activity, hostClient, hostInstanceId, sessionId]);

  const closeBrowser = useCallback(() => {
    dismissMini();
    void client
      .browserClose()
      .then((response) => {
        if (!response.success) console.warn('[browser] close failed', response.error);
      })
      .catch((error: unknown) => {
        console.warn('[browser] close failed', error);
      });
  }, [client, dismissMini]);

  return {
    client,
    hostInstanceId,
    miniDismissed,
    dismissMini,
    closeBrowser,
    placementKey: browserMiniPlacementStorageKey(browserMiniHostScope(hostInstanceId)),
    enabled: sessionId !== null && hasVisibleBrowserPresentation({ ...input, miniDismissed, activity }),
  };
}
