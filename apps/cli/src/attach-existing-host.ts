import type { HostAttachTarget } from '@piwin/contracts';
import { HostClient, isLoopbackHostEndpoint } from '@piwin/host-client';
import { getPiwinRoot } from '@piwin/host-runtime/paths';
import { WebSocketHostTransport } from '@piwin/host-transport';
import { createNodeHostWebSocket } from './node-host-websocket.js';
import { readCliClientPrincipalId } from './cli-client-principal.js';
import {
  connectRemoteHostTransport,
  migrateLegacyCliTarget,
  readRemoteHostTarget,
  type CliRemoteHostTarget,
} from './cli-remote-attach.js';
import { openCliRemoteHosts } from './cli-remote-hosts.js';

/** A legacy endpoint (`PIWIN_HOST_URL`) or an ADR 0101 host book entry. */
export type CliHostAttachTarget = HostAttachTarget | CliRemoteHostTarget;

/**
 * Which Host a CLI command attaches to (ADR 0101 §8), in order:
 * `PIWIN_HOST=<alias|hostId>`; `PIWIN_HOST_URL` (a non-loopback one with a
 * token or device credential migrates to the channel once); the
 * `piwin hosts use` default. Undefined means an in-process Host.
 */
export async function resolveCliHostAttachTarget(
  env: NodeJS.ProcessEnv = process.env,
  piwinRoot: string = getPiwinRoot(),
): Promise<CliHostAttachTarget | undefined> {
  const hosts = openCliRemoteHosts(piwinRoot);
  const selector = env.PIWIN_HOST?.trim();
  if (selector !== undefined && selector.length > 0) {
    return readRemoteHostTarget(hosts, selector);
  }
  const legacy = readCliHostAttachTarget(env);
  if (legacy !== undefined) {
    if (
      !isLoopbackHostEndpoint(legacy.endpoint) &&
      (legacy.deviceCredential !== undefined || legacy.authToken !== undefined)
    ) {
      const migrated = await migrateLegacyCliTarget({
        hosts,
        endpoint: legacy.endpoint,
        clientId: await resolveCliAttachedClientId(legacy.endpoint, piwinRoot),
        ...(legacy.deviceCredential === undefined ? {} : { credential: legacy.deviceCredential }),
        ...(legacy.authToken === undefined ? {} : { authToken: legacy.authToken }),
      });
      if (migrated !== undefined) return migrated;
    }
    return legacy;
  }
  const defaultHostId = await hosts.readDefaultHostId();
  return defaultHostId === undefined ? undefined : readRemoteHostTarget(hosts, defaultHostId);
}

export function isRemoteHostTarget(target: CliHostAttachTarget): target is CliRemoteHostTarget {
  return 'remoteHost' in target;
}

/** Human label for messages: the endpoint or the Host's name. */
export function describeCliHostTarget(target: CliHostAttachTarget): string {
  return isRemoteHostTarget(target) ? target.remoteHost.entry.hostName : target.endpoint;
}

export function readCliHostAttachTarget(
  env: NodeJS.ProcessEnv = process.env,
): HostAttachTarget | undefined {
  const endpoint = env.PIWIN_HOST_URL?.trim();
  if (endpoint === undefined || endpoint.length === 0) {
    return undefined;
  }
  if (!isCliHostEndpoint(endpoint)) {
    throw new Error('PIWIN_HOST_URL must be a ws:// or wss:// Host endpoint');
  }
  const deviceId = env.PIWIN_HOST_DEVICE_ID?.trim();
  const deviceSecret = env.PIWIN_HOST_DEVICE_SECRET?.trim();
  if (deviceId || deviceSecret) {
    if (!deviceId || !deviceSecret) {
      throw new Error('PIWIN_HOST_DEVICE_ID and PIWIN_HOST_DEVICE_SECRET must be provided together');
    }
    return { endpoint, deviceCredential: { deviceId, deviceSecret } };
  }
  const authToken = env.PIWIN_HOST_TOKEN?.trim();
  return {
    endpoint,
    ...(authToken === undefined || authToken.length === 0 ? {} : { authToken }),
  };
}

function isCliHostEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'ws:' || url.protocol === 'wss:';
  } catch {
    return false;
  }
}

export async function resolveCliAttachedClientId(
  endpoint: string,
  piwinRoot?: string,
): Promise<string> {
  return readCliClientPrincipalId(piwinRoot ?? getPiwinRoot(), endpoint);
}

export type CliHostAttachOptions = {
  /** Long-lived shells (TUI) reconnect; one-shot commands fail fast. */
  autoReconnect?: boolean;
  /**
   * Receive session pushes only for sessions named through
   * `updateSubscriptions`. One-shot commands leave it off and get every push.
   */
  liveSubscriptions?: boolean;
};

export async function connectCliAttachedHost(
  target: CliHostAttachTarget,
  piwinRoot?: string,
  options: CliHostAttachOptions = {},
): Promise<HostClient> {
  const capabilities = {
    pushBatching: true,
    cursorBatches: true,
    boundedReplay: true,
    hydration: false,
    ...(options.liveSubscriptions === true ? { liveSubscriptions: true } : {}),
  };
  if (isRemoteHostTarget(target)) {
    const { entry, secrets } = target.remoteHost;
    const clientId = await resolveCliAttachedClientId(`remote:${entry.hostId}`, piwinRoot);
    let connected: HostClient | undefined;
    await connectRemoteHostTransport(
      target,
      { autoReconnect: options.autoReconnect ?? false },
      async (transport) => {
        const candidate = new HostClient({
          transport,
          clientId,
          clientType: 'cli',
          clientVersion: CLI_HOST_CLIENT_VERSION,
          capabilities,
          deviceCredential: secrets.credential,
        });
        try {
          await candidate.connect();
          connected = candidate;
        } catch (error) {
          await candidate.close().catch(() => undefined);
          throw error;
        }
      },
    );
    if (connected === undefined) {
      throw new Error(`Could not reach ${entry.hostName}`);
    }
    return connected;
  }
  const clientId = await resolveCliAttachedClientId(target.endpoint, piwinRoot);
  const transport = new WebSocketHostTransport({
    endpoint: target.endpoint,
    autoReconnect: options.autoReconnect ?? false,
    webSocketFactory: createNodeHostWebSocket,
  });
  const client = new HostClient({
    transport,
    clientId,
    clientType: 'cli',
    clientVersion: CLI_HOST_CLIENT_VERSION,
    capabilities,
    ...(target.deviceCredential !== undefined
      ? { deviceCredential: target.deviceCredential }
      : target.authToken === undefined ? {} : { authToken: target.authToken }),
  });
  await client.connect();
  return client;
}

export const CLI_HOST_CLIENT_VERSION = '0.0.0';
