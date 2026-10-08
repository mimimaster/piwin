import { randomUUID } from 'node:crypto';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { remoteCommandRequiresIdempotencyKey } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { getPiwinRoot, HostRuntime } from '@piwin/host-runtime';
import { HostServer } from '@piwin/host-server';
import { connectCliAttachedHost, readCliHostAttachTarget } from '../attach-existing-host.js';

/**
 * The TUI always speaks the remote Host protocol, including to a Host it
 * starts itself. One code path means the standalone terminal, a Desktop-embedded
 * pane and a remote attach all see the same path-free data shapes.
 */
export type TuiHostLink = {
  client: HostClient;
  /** `owned`: this process started the Host and stops it on exit. */
  kind: 'attached' | 'owned';
  endpoint: string;
  request: (command: HostCommand) => Promise<HostResponse>;
  dispose: () => Promise<void>;
};

export type TuiHostLinkOptions = {
  mock: boolean;
  onHostError: (message: string) => void;
};

/** The TUI shows one session at a time, so it only asks for that session's pushes. */
const TUI_ATTACH_OPTIONS = { autoReconnect: true, liveSubscriptions: true } as const;

export async function openTuiHostLink(options: TuiHostLinkOptions): Promise<TuiHostLink> {
  const target = readCliHostAttachTarget();
  if (target !== undefined) {
    const client = await connectCliAttachedHost(target, undefined, TUI_ATTACH_OPTIONS);
    return {
      client,
      kind: 'attached',
      endpoint: target.endpoint,
      request: createLinkRequest(client),
      dispose: () => client.close(),
    };
  }

  const piwinRoot = getPiwinRoot();
  const runtime = new HostRuntime({ mode: 'sdk', mock: options.mock, piwinRoot });
  // Loopback only, random port, random door token: nothing else on the machine
  // is told where this Host is.
  const authToken = randomUUID();
  const server = new HostServer({
    runtime,
    mode: 'sdk',
    host: '127.0.0.1',
    port: 0,
    instanceId: runtime.getHostInstanceId(),
    authToken,
    piwinRoot,
    pairingEnabled: false,
    onError: (error) => options.onHostError(error.message),
  });
  try {
    const address = await server.start();
    const client = await connectCliAttachedHost({ endpoint: address.url, authToken }, piwinRoot, TUI_ATTACH_OPTIONS);
    return {
      client,
      kind: 'owned',
      endpoint: address.url,
      request: createLinkRequest(client),
      dispose: async () => {
        await client.close();
        await server.stop();
        await runtime.dispose();
      },
    };
  } catch (error) {
    await server.stop().catch(() => undefined);
    await runtime.dispose();
    throw error;
  }
}

/** Mutations the remote protocol dedupes get a fresh key per user gesture. */
function createLinkRequest(client: HostClient): TuiHostLink['request'] {
  return (command) =>
    remoteCommandRequiresIdempotencyKey(command.type)
      ? client.request(command, { idempotencyKey: randomUUID() })
      : client.request(command);
}

/** Unwrap a Host response or throw its error text. Shapes are the remote projections. */
export function hostData<Data>(response: HostResponse): Data {
  if (!response.success) throw new Error(response.error);
  return response.data as Data;
}
