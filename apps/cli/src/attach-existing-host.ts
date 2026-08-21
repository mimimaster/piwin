import { randomUUID } from 'node:crypto';
import { HostClient } from '@piwin/host-client';
import { WebSocketHostTransport } from '@piwin/host-transport';
import { createNodeHostWebSocket } from './node-host-websocket.js';

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

export async function connectCliAttachedHost(target: CliHostAttachTarget): Promise<HostClient> {
  const transport = new WebSocketHostTransport({
    endpoint: target.endpoint,
    autoReconnect: false,
    webSocketFactory: createNodeHostWebSocket,
  });
  const client = new HostClient({
    transport,
    clientId: `cli-${randomUUID()}`,
    clientType: 'cli',
    clientVersion: '0.0.0',
    capabilities: {
      pushBatching: true,
      cursorBatches: true,
      boundedReplay: true,
      hydration: false,
    },
    ...(target.authToken === undefined ? {} : { authToken: target.authToken }),
  });
  await client.connect();
  return client;
}

export const CLI_HOST_CLIENT_VERSION = '0.0.0';
