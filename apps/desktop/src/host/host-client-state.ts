import type { HostMode, HostServerMessage } from '@piwin/contracts';
import type { DesktopRemoteHostTarget } from './remote-host-session';
import {
  detectTransport,
  type HostClientOptions,
  type TransportMode,
} from './host-client-transport-detect.js';

export type HostClientListener = (message: HostServerMessage) => void;

/**
 * Mutable HostClient instance state. HostClient remains the composition root;
 * the push, live and remote layers read this state, and the layer that owns a
 * field is the only one that writes it.
 */
export abstract class HostClientState {
  protected readonly listeners = new Set<HostClientListener>();
  protected readonly transport: TransportMode;
  protected readonly hostMock: boolean;
  protected readonly remoteTarget: DesktopRemoteHostTarget | undefined;
  protected mode: HostMode = 'sdk';
  protected ready = false;
  protected requestCounter = 0;
  /** Stage 1 local egress cursor, scoped to the current host process. */
  protected hostInstanceId: string | null = null;
  protected lastHostSeq = 0;
  /** Prevent Strict Mode/HMR from registering the Tauri event bridge twice. */
  protected pendingConnection: Promise<void> | null = null;

  /**
   * transport / hostMock / remoteTarget are fixed for the client's lifetime
   * (ADR 0003) and read read-only by the layers below.
   */
  protected constructor(options: HostClientOptions = {}) {
    this.transport = detectTransport(options);
    this.hostMock = options.hostMock !== false;
    this.remoteTarget = options.remoteTarget;
  }
}
