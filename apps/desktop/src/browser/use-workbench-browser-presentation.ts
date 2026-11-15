import { useCallback, useMemo, useState } from 'react';
import type { HostClient } from '../host/host-client.js';
import type { WorkspaceState } from '../workbench/docking/types.js';
import { createBrowserSessionClient } from './browser-session-client.js';
import { useBrowserActivitySignal } from './use-browser-activity-signal.js';
import { browserMiniHostScope, browserMiniPlacementStorageKey } from './browser-mini-placement-store.js';
import { hasVisibleBrowserPresentation } from './browser-presentation-visibility.js';

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
  const [dismissal, setDismissal] = useState({ hostClient, sessionId, hostInstanceId, dismissed: false });
  const identityChanged = dismissal.hostClient !== hostClient || dismissal.sessionId !== sessionId ||
    dismissal.hostInstanceId !== hostInstanceId;
  if (identityChanged) setDismissal({ hostClient, sessionId, hostInstanceId, dismissed: false });
  const miniDismissed = !identityChanged && dismissal.dismissed;
  const dismissMini = useCallback(() => {
    setDismissal({ hostClient, sessionId, hostInstanceId, dismissed: true });
  }, [hostClient, sessionId, hostInstanceId]);
  return {
    client, hostInstanceId, miniDismissed, dismissMini,
    placementKey: browserMiniPlacementStorageKey(browserMiniHostScope(hostInstanceId)),
    enabled: sessionId !== null && hasVisibleBrowserPresentation({ ...input, miniDismissed, activity }),
  };
}
