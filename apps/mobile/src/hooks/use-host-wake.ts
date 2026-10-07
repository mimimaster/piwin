import { useEffect, useRef } from 'react';
import { createHostWakeHandler, type HostClient } from '@piwin/host-client';

/**
 * Attaches the shared Host wake handler (see @piwin/host-client `host-wake`)
 * to this page's "the app is back" events.
 */
export function useHostWake(
  clientRef: { current: HostClient | undefined },
  redial: () => void,
): void {
  const redialRef = useRef(redial);
  redialRef.current = redial;

  useEffect(() => {
    const onWake = createHostWakeHandler({
      getClient: () => clientRef.current,
      redial: () => redialRef.current(),
      isHidden: () => document.visibilityState === 'hidden',
    });
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);
    window.addEventListener('pageshow', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
      window.removeEventListener('pageshow', onWake);
    };
  }, [clientRef]);
}
