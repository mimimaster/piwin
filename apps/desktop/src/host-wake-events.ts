/**
 * Binds the shared Host wake handler (@piwin/host-client `host-wake`) to this
 * page: returning to the foreground or regaining the network probes or
 * redials the remote Host link at once instead of waiting out a heartbeat and
 * a grown backoff. Also the entry point for the reconnect banner's "retry".
 */
import { createHostWakeHandler, type HostWakeTarget } from '@piwin/host-client';

type ActiveLink = {
  getClient: () => HostWakeTarget | undefined;
  redial: () => void;
};

let activeLink: ActiveLink | undefined;

export function attachHostWakeEvents(link: ActiveLink): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {};
  }
  activeLink = link;
  const onWake = createHostWakeHandler({
    getClient: link.getClient,
    redial: link.redial,
    isHidden: () => document.visibilityState === 'hidden',
  });
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('online', onWake);
  window.addEventListener('pageshow', onWake);
  return () => {
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('online', onWake);
    window.removeEventListener('pageshow', onWake);
    if (activeLink === link) {
      activeLink = undefined;
    }
  };
}

/**
 * The user asked to retry now. Unlike a page event this is never debounced;
 * a transport with nothing to wake is redialled.
 */
export function retryHostConnectionNow(): void {
  const link = activeLink;
  if (link === undefined) {
    return;
  }
  const client = link.getClient();
  if (client?.wake() !== true) {
    link.redial();
  }
}
