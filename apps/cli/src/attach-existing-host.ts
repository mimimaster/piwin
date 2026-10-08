import { HostClient } from '@piwin/host-client';
import { getPiwinRoot } from '@piwin/host-runtime';
import { WebSocketHostTransport } from '@piwin/host-transport';
import { createNodeHostWebSocket } from './node-host-websocket.js';
import { readCliClientPrincipalId } from './cli-client-principal.js';

export type CliHostAttachTarget = {
  endpoint: string;
  authToken?: string;
};

export function readCliHostAttachTarget(
  env: NodeJS.ProcessEnv = process.env,
): CliHostAttachTarget | undefined {
  const endpoint = env.PIWIN_HOST_URL?.trim();
  if (endpoint === undefined || endpoint.length === 0) {
    return undefined;
  }
  if (!isCliHostEndpoint(endpoint)) {
    return undefined;
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
    clientVersion: '0.0.0',
    capabilities: {
      pushBatching: true,
      cursorBatches: true,
      boundedReplay: true,
      hydration: false,
      ...(options.liveSubscriptions === true ? { liveSubscriptions: true } : {}),
    },
    ...(target.authToken === undefined ? {} : { authToken: target.authToken }),
  });
  await client.connect();
  return client;
}

export const CLI_HOST_CLIENT_VERSION = '0.0.0';
