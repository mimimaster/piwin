import type { DesktopRemoteHostTarget } from './remote-host-session';
import { isDesktopTauriRuntime } from './shell-runtime.js';

/**
 * Transport identity for the desktop host client. `detectTransport` resolves
 * the requested options to one concrete transport; `isTauriRuntime` tells the
 * packaged shell apart from a plain browser (Vite) session.
 */

export type HostClientOptions = {
  /**
   * true  → in-browser mock (Vite only)
   * false → Tauri sidecar `piwin host serve` JSONL bridge
   * 'auto'→ mock outside Tauri, live inside Tauri
   * 'remote' → standalone Host over WebSocket (never touches the JSONL sidecar)
   */
  transport?: boolean | 'auto' | 'mock' | 'live' | 'remote';
  /** When using live transport, start host with --mock (agent mock, not UI mock). Default true for scaffold. */
  hostMock?: boolean;
  remoteTarget?: DesktopRemoteHostTarget;
};

export type TransportMode = 'mock' | 'live' | 'remote';

export function detectTransport(options: HostClientOptions): TransportMode {
  const requested = options.transport ?? 'auto';
  if (requested === 'mock' || requested === true) {
    return 'mock';
  }
  if (requested === 'live' || requested === false) {
    return 'live';
  }
  if (requested === 'remote') {
    return 'remote';
  }
  return isTauriRuntime() ? 'live' : 'mock';
}

/** Desktop app only; the mobile shell has no sidecar and always attaches remotely. */
export function isTauriRuntime(): boolean {
  return isDesktopTauriRuntime();
}
