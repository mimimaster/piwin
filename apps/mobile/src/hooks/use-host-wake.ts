import { useEffect, useRef } from 'react';
import type { HostClient, HostClientState } from '@piwin/host-client';

export type HostWakeAction = 'none' | 'redial';

/**
 * What to do after the transport had its chance. iOS suspends the WebView in
 * the background and silently kills the socket; `HostClient.wake()` probes a
 * live-looking link or skips the grown backoff. Only when it had nothing to
 * wake (the first dial failed, so the transport is closed for good) does the
 * shell build a new connection. A missing client means the user disconnected
 * or never paired: stay quiet.
 */
export function decideHostWake(
  state: HostClientState | undefined,
  transportWoke: boolean,
): HostWakeAction {
  if (state === undefined || transportWoke) return 'none';
  if (state.kind === 'disconnected') return 'redial';
  // An auth / pairing rejection will not heal by retrying; the user has to
  // re-pair, and redialling on every foreground would just repeat the error.
  if (state.kind === 'error') return state.reason.includes('Host rejected the connection') ? 'none' : 'redial';
  return 'none';
}

/** Minimum gap between wake handling; iOS fires visibility + pageshow + online together. */
const WAKE_DEBOUNCE_MS = 1_500;

/**
 * Keeps the Host link honest across app suspension without any background
 * work: nothing runs while hidden (iOS would not allow it cheaply anyway);
 * on return the transport probes or redials, and `lastSeq` replay fills in
 * whatever happened meanwhile.
 */
export function useHostWake(
  clientRef: { current: HostClient | undefined },
  redial: () => void,
): void {
  const redialRef = useRef(redial);
  redialRef.current = redial;

  useEffect(() => {
    let lastWakeAt = 0;
    const onWake = (): void => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastWakeAt < WAKE_DEBOUNCE_MS) return;
      lastWakeAt = now;
      const client = clientRef.current;
      const woke = client?.wake() ?? false;
      if (decideHostWake(client?.getState(), woke) === 'redial') {
        redialRef.current();
      }
    };
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
