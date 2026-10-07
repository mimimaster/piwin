/**
 * Keeps a Host link honest across suspension.
 *
 * A phone suspends the WebView in the background and silently kills the
 * socket; a laptop does the same when the lid closes. Nothing runs while
 * hidden. On return — foreground, network back — the transport gets a chance
 * to probe a live-looking link or skip a grown backoff (`HostClient.wake`);
 * only when it had nothing to wake does the shell redial. `lastSeq` replay
 * then fills in what happened meanwhile.
 *
 * Shared by every shell; the shell attaches it to its own page events.
 */
import type { HostClientState } from './host-client.js';

export type HostWakeAction = 'none' | 'redial';

/**
 * What to do after the transport had its chance. A missing client means the
 * user disconnected or never paired: stay quiet.
 */
export function decideHostWake(
  state: HostClientState | undefined,
  transportWoke: boolean,
): HostWakeAction {
  if (state === undefined || transportWoke) return 'none';
  if (state.kind === 'disconnected') return 'redial';
  // An auth / pairing rejection will not heal by retrying; the user has to
  // re-pair, and redialling on every foreground would just repeat the error.
  if (state.kind === 'error') {
    return state.reason.includes('Host rejected the connection') ? 'none' : 'redial';
  }
  return 'none';
}

/** Minimum gap between wakes; iOS fires visibility + pageshow + online together. */
export const HOST_WAKE_DEBOUNCE_MS = 1_500;

export type HostWakeTarget = {
  wake(): boolean;
  getState(): HostClientState;
};

export type HostWakeHandlerOptions = {
  /** The live client, or `undefined` when there is nothing to keep alive. */
  getClient: () => HostWakeTarget | undefined;
  /** Build or restart the connection when the transport is closed for good. */
  redial: () => void;
  /** True while the page is in the background; wakes are ignored then. */
  isHidden: () => boolean;
  now?: () => number;
};

/** One function to call from every "the app is back" event. */
export function createHostWakeHandler(options: HostWakeHandlerOptions): () => void {
  const now = options.now ?? Date.now;
  let lastWakeAt = Number.NEGATIVE_INFINITY;
  return () => {
    if (options.isHidden()) return;
    const at = now();
    if (at - lastWakeAt < HOST_WAKE_DEBOUNCE_MS) return;
    lastWakeAt = at;
    const client = options.getClient();
    const woke = client?.wake() ?? false;
    if (decideHostWake(client?.getState(), woke) === 'redial') {
      options.redial();
    }
  };
}
