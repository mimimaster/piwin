import type { HostBookEntry, HostClientCapabilities } from '@piwin/contracts';
import {
  createRemoteHostTransport,
  HostClient,
  type HostClientCursorStore,
  type HostClientLastSeqStore,
  type RemoteHostSecrets,
} from '@piwin/host-client';
import {
  channelHostBook,
  channelInnerSocketFactory,
  updatePrimedChannelHost,
} from './channel-host-book.js';

/**
 * Workbench Host client over the ADR 0101 channel: relay first, direct
 * fallback, Host key pinned from the host book. Address changes the Host
 * announces flow back into the host book and the primed copy.
 */
export function createChannelDesktopHostClient(input: {
  entry: HostBookEntry;
  secrets: RemoteHostSecrets;
  clientId: string;
  clientVersion: string;
  capabilities: HostClientCapabilities;
  autoReconnect: boolean;
  lastSeqStore: HostClientLastSeqStore;
  cursorStore: HostClientCursorStore;
}): HostClient {
  const { entry, secrets } = input;
  const remote = createRemoteHostTransport({
    entry,
    clientKeyPair: secrets.clientKeyPair,
    createInnerSocket: channelInnerSocketFactory(),
    // HostClient installs its own hello with the device credential.
    createHello: (lastSeq) => ({
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'desktop',
      clientVersion: input.clientVersion,
      clientId: input.clientId,
      lastSeq,
    }),
    onEndpoints: (endpoints) => {
      void channelHostBook()
        .applyEndpoints(entry.hostId, endpoints)
        .then((updated) => {
          if (updated !== undefined) updatePrimedChannelHost(updated);
        })
        .catch((error: unknown) => console.warn('[piwin] host book update failed', error));
    },
    transportOptions: { autoReconnect: input.autoReconnect, heartbeatIntervalMs: 30_000 },
  });
  return new HostClient({
    transport: remote.transport,
    clientId: input.clientId,
    clientType: 'desktop',
    clientVersion: input.clientVersion,
    capabilities: input.capabilities,
    deviceCredential: secrets.credential,
    lastSeqStore: input.lastSeqStore,
    cursorStore: input.cursorStore,
  });
}
