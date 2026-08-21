import { useEffect, useRef, useState } from 'react';
import { HostClient } from './host-client.js';
import {
  loadDesktopRemoteHostTarget,
  sameDesktopRemoteHostTarget,
  subscribeDesktopRemoteHostTargetChange,
} from './remote-host-session.js';

export function createWorkbenchHostClient(): HostClient {
  const remoteTarget = loadDesktopRemoteHostTarget();
  if (remoteTarget !== undefined) {
    return new HostClient({
      transport: 'remote',
      remoteTarget,
      hostMock: false,
    });
  }
  return new HostClient({ transport: 'auto', hostMock: false });
}

/**
 * One HostClient for the workbench. Created again after unmount cleanup so
 * React StrictMode's mount→unmount→remount does not keep a disposed instance.
 */
export function useWorkbenchHostClient(): HostClient {
  const [hostClient, setHostClient] = useState(createWorkbenchHostClient);
  const hostClientRef = useRef<HostClient | null>(hostClient);

  useEffect(() => {
    let client = hostClientRef.current;
    if (client === null) {
      client = createWorkbenchHostClient();
      hostClientRef.current = client;
      setHostClient(client);
    }
    let currentTarget = loadDesktopRemoteHostTarget();
    const unsubscribe = subscribeDesktopRemoteHostTargetChange(() => {
      const nextTarget = loadDesktopRemoteHostTarget();
      if (sameDesktopRemoteHostTarget(currentTarget, nextTarget)) {
        return;
      }
      currentTarget = nextTarget;
      const previous = hostClientRef.current;
      const next = createWorkbenchHostClient();
      hostClientRef.current = next;
      setHostClient(next);
      if (previous !== null) {
        void previous.dispose();
      }
    });
    return () => {
      unsubscribe();
      const live = hostClientRef.current;
      hostClientRef.current = null;
      if (live !== null) {
        void live.dispose();
      }
    };
  }, []);

  return hostClient;
}
