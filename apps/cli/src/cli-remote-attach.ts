import type { HostBookEntry, HostClientHello, HostHello } from '@piwin/contracts';
import {
  createChannelDialer,
  createLegacyConnector,
  createRemoteHostTransport,
  dialFirstReachable,
  HostDialPlan,
  migrateLegacyHost,
  type HostBook,
  type RemoteHostSecrets,
} from '@piwin/host-client';
import { HostHandshakeError, type RelayInnerSocket } from '@piwin/host-transport';
import WebSocket from 'ws';
import type { CliRemoteHosts } from './cli-remote-hosts.js';
import { createNodeHostWebSocket } from './node-host-websocket.js';

export const CLI_CLIENT_VERSION = '0.0.0';

/** An ADR 0101 attach target: a host book entry and its secrets. */
export type CliRemoteHostTarget = {
  remoteHost: { entry: HostBookEntry; secrets: RemoteHostSecrets; hostBook: HostBook };
};

export const createNodeRelayInnerSocket = (url: string): RelayInnerSocket =>
  new WebSocket(url) as unknown as RelayInnerSocket;

/** `PIWIN_HOST=<alias|hostId|name>`; throws for an unknown or secret-less Host. */
export async function readRemoteHostTarget(
  hosts: CliRemoteHosts,
  selector: string,
): Promise<CliRemoteHostTarget> {
  const entry = await hosts.findHost(selector);
  if (entry === undefined) {
    throw new Error(`No paired Host matches "${selector}". Run \`piwin hosts list\`.`);
  }
  const secrets = await hosts.vault.read(entry.hostId);
  if (secrets === undefined) {
    throw new Error(`The credential for ${entry.hostName} is missing; pair it again.`);
  }
  return { remoteHost: { entry, secrets, hostBook: hosts.hostBook } };
}

/**
 * ADR 0101 §10 for the CLI: a non-loopback `PIWIN_HOST_URL` with a token or
 * device credential migrates once into the host book. Later runs find the
 * cached mapping and attach over the channel. An older Host (or a failed
 * migration) keeps the legacy attach.
 */
export async function migrateLegacyCliTarget(input: {
  hosts: CliRemoteHosts;
  endpoint: string;
  clientId: string;
  credential?: { deviceId: string; deviceSecret: string };
  authToken?: string;
  log?: (line: string) => void;
}): Promise<CliRemoteHostTarget | undefined> {
  const log = input.log ?? ((line: string) => console.error(line));
  const cached = await input.hosts.readLegacyMigration(input.endpoint);
  if (cached !== undefined) {
    const target = await readRemoteHostTarget(input.hosts, cached).catch(() => undefined);
    if (target !== undefined) return target;
  }
  const outcome = await migrateLegacyHost({
    record: {
      endpoint: input.endpoint,
      clientId: input.clientId,
      deviceName: 'piwin CLI',
      ...(input.credential === undefined ? {} : { credential: input.credential }),
      ...(input.authToken === undefined ? {} : { authToken: input.authToken }),
    },
    hostBook: input.hosts.hostBook,
    vault: input.hosts.vault,
    connectLegacy: createLegacyConnector(
      {
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'cli',
        clientVersion: CLI_CLIENT_VERSION,
      },
      createNodeHostWebSocket,
    ),
    verifyChannel: async (entry, secrets) => {
      const result = await dialEntry(entry, secrets, input.clientId);
      await result.close();
    },
  });
  if (outcome.status === 'migrated') {
    await input.hosts.writeLegacyMigration(input.endpoint, outcome.entry.hostId);
    log(
      `[piwin] migrated ${input.endpoint} to the encrypted channel as "${outcome.entry.hostName}". ` +
        `PIWIN_HOST_URL/PIWIN_HOST_TOKEN/PIWIN_HOST_DEVICE_* can go; use PIWIN_HOST=${outcome.entry.hostId}.`,
    );
    return readRemoteHostTarget(input.hosts, outcome.entry.hostId);
  }
  if (outcome.status === 'failed') {
    log(`[piwin] could not migrate ${input.endpoint} yet: ${outcome.error.message}`);
  }
  return undefined;
}

/** One-shot hello over the first reachable path (relay, then direct). */
export function dialEntry(
  entry: HostBookEntry,
  secrets: RemoteHostSecrets,
  clientId: string,
): Promise<{ hello: HostHello; close: () => Promise<void> }> {
  const dial = createChannelDialer(createNodeRelayInnerSocket);
  const hello: HostClientHello = {
    type: 'client/hello',
    protocolVersion: 1,
    clientType: 'cli',
    clientVersion: CLI_CLIENT_VERSION,
    clientId,
    lastSeq: 0,
    deviceCredential: secrets.credential,
  };
  return dialFirstReachable(new HostDialPlan(entry), (choice) =>
    dial({ choice, target: entry, clientKeyPair: secrets.clientKeyPair, hello }),
  );
}

/**
 * Transport for a remote Host. Long-lived shells (TUI) reconnect across both
 * paths; one-shot commands try the relay, then direct, once each.
 */
export async function connectRemoteHostTransport(
  target: CliRemoteHostTarget,
  options: { autoReconnect: boolean },
  connect: (transport: ReturnType<typeof createRemoteHostTransport>['transport']) => Promise<void>,
): Promise<void> {
  const { entry, secrets, hostBook } = target.remoteHost;
  const onEndpoints = (endpoints: Parameters<HostBook['applyEndpoints']>[1]): void => {
    void hostBook.applyEndpoints(entry.hostId, endpoints).catch(() => undefined);
  };
  const build = (pathEntry: HostBookEntry, autoReconnect: boolean) =>
    createRemoteHostTransport({
      entry: pathEntry,
      clientKeyPair: secrets.clientKeyPair,
      createInnerSocket: createNodeRelayInnerSocket,
      // HostClient installs its own hello (with the device credential).
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'cli',
        clientVersion: CLI_CLIENT_VERSION,
        clientId: 'pending',
        lastSeq,
      }),
      onEndpoints,
      transportOptions: { autoReconnect },
    }).transport;
  if (options.autoReconnect) {
    await connect(build(entry, true));
    return;
  }
  let lastError: unknown = new Error('This Host has no relay or direct address');
  for (const choice of new HostDialPlan(entry).candidates()) {
    const { relayUrl: _relay, directUrl: _direct, ...rest } = entry;
    const single: HostBookEntry =
      choice.path === 'relay'
        ? { ...rest, ...(entry.relayUrl === undefined ? {} : { relayUrl: entry.relayUrl }) }
        : { ...rest, ...(entry.directUrl === undefined ? {} : { directUrl: entry.directUrl }) };
    try {
      await connect(build(single, false));
      return;
    } catch (error) {
      if (error instanceof HostHandshakeError) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
