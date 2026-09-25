import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { useMobileLive, type MobileLiveCallController } from '../../hooks/use-mobile-live.js';
import type { InkstoneHostContextValue } from './inkstone-host-context.js';

/**
 * One Live call per app, owned above the routes. The call's media driver
 * (microphone / speaker) must outlive the voice page so the user can keep
 * talking while reading the transcript — the capsule is its handle.
 */
const LiveCallContext = createContext<MobileLiveCallController | null>(null);

export function LiveCallProvider({
  hostContext,
  children,
}: {
  hostContext: InkstoneHostContextValue | null;
  children: ReactNode;
}): ReactElement {
  const host = hostContext?.host;
  const live = useMobileLive({
    hostClient: host?.client,
    sessionId: host?.activeSessionId,
    ensureSession: async () => host?.handleCreateSession(),
  });
  return <LiveCallContext.Provider value={hostContext === null ? null : live}>{children}</LiveCallContext.Provider>;
}

export function useLiveCall(): MobileLiveCallController | null {
  return useContext(LiveCallContext);
}
