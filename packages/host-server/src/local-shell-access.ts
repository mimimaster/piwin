import { randomUUID } from 'node:crypto';
import type { LocalShellAccessData } from '@piwin/contracts';
import type { DeviceToolBroker } from './device-tool-broker.js';
import type { HostCommandIdempotencyRegistry } from './host-command-idempotency-registry.js';
import type { HostEgressHub } from './host-egress-hub.js';
import { HostServer, type HostRuntimePort } from './host-server.js';

export type LocalShellAccessOptions = {
  runtime: HostRuntimePort;
  instanceId: string;
  piwinRoot?: string;
  onError?: (error: Error) => void;
  clientToolBroker?: DeviceToolBroker;
  /** Shared with the sidecar so every shell sees one push stream. */
  egressHub?: HostEgressHub;
  idempotencyRegistry?: HostCommandIdempotencyRegistry;
};

/**
 * Loopback entrance for shells running on the Host's own machine (the TUI in
 * a Desktop pane). Separate from phone access: it binds 127.0.0.1 only, on an
 * OS-assigned port, admits by a random token instead of device pairing, and
 * is unaffected by the phone-access switch.
 *
 * Nothing listens until the first `open()`.
 */
export class LocalShellAccess {
  private opening: Promise<LocalShellAccessData> | undefined;
  private server: HostServer | undefined;

  public constructor(private readonly options: LocalShellAccessOptions) {}

  public open(): Promise<LocalShellAccessData> {
    this.opening ??= this.start().catch((error: unknown) => {
      // A failed bind must not poison later attempts.
      this.opening = undefined;
      throw error;
    });
    return this.opening;
  }

  public async dispose(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.opening = undefined;
    await server?.stop();
  }

  private async start(): Promise<LocalShellAccessData> {
    const options = this.options;
    const authToken = randomUUID();
    const server = new HostServer({
      runtime: options.runtime,
      host: '127.0.0.1',
      port: 0,
      instanceId: options.instanceId,
      authToken,
      pairingEnabled: false,
      ...(options.piwinRoot === undefined ? {} : { piwinRoot: options.piwinRoot }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
      ...(options.clientToolBroker === undefined ? {} : { clientToolBroker: options.clientToolBroker }),
      ...(options.egressHub === undefined ? {} : { egressHub: options.egressHub }),
      ...(options.idempotencyRegistry === undefined
        ? {}
        : { idempotencyRegistry: options.idempotencyRegistry }),
    });
    const address = await server.start();
    this.server = server;
    return { endpoint: address.url, authToken };
  }
}
