#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { HostRuntime } from '@piwin/host-runtime';
import {
  HostDevicePairing,
  HostDevicePairingFileStore,
  HostServer,
  assertPairingBindIsAdvertisable,
  createDeviceToolBrokerForHost,
  type HostConnectionEvent,
} from '@piwin/host-server';
import { createHostPairingAnnouncement, resolveAdvertisedEndpoint } from './pairing-print.js';
import { resolveAgentWorkerScript } from './resolve-agent-worker-script.js';

const mode = process.env.PIWIN_HOST_MODE === 'rpc' ? 'rpc' : 'sdk';
const mock = process.env.PIWIN_MOCK === '1';
const host = process.env.PIWIN_HOST_BIND ?? '127.0.0.1';
const port = parsePort(process.env.PIWIN_HOST_PORT) ?? 8787;
const authTokenRaw = process.env.PIWIN_HOST_TOKEN?.trim();
// Empty PIWIN_HOST_TOKEN= must not enable a token that nothing can satisfy.
const authToken =
  authTokenRaw === undefined || authTokenRaw.length === 0 ? undefined : authTokenRaw;
const pairingEnabled = process.env.PIWIN_HOST_PAIRING === '1';
// Admitted clients are the operator. This flag is accepted for compatibility.
const allowRemoteExtensionActivation = process.env.PIWIN_HOST_ALLOW_EXTENSION_ACTIVATION === '1';
const hostBuildId = process.env.PIWIN_HOST_BUILD_ID?.trim() || '0.0.0-dev';
const minClientVersion = process.env.PIWIN_HOST_MIN_CLIENT_VERSION?.trim() || undefined;
const allowCleartext = process.env.PIWIN_HOST_ALLOW_CLEARTEXT === '1';

const agentWorkerScript = resolveAgentWorkerScript();
const clientToolBroker = await createDeviceToolBrokerForHost(resolvePiwinRoot());
const runtime = new HostRuntime({
  mode,
  mock,
  ...(process.env.PIWIN_ROOT === undefined ? {} : { piwinRoot: process.env.PIWIN_ROOT }),
  ...(agentWorkerScript === undefined ? {} : { agentWorkerScript }),
  ...(clientToolBroker === undefined ? {} : { clientToolExecution: clientToolBroker }),
});
const hostInstanceId = runtime.getHostInstanceId();

let devicePairing: HostDevicePairing | undefined;
let devicePairingStore: HostDevicePairingFileStore | undefined;
if (pairingEnabled) {
  try {
    assertPairingBindIsAdvertisable(host);
  } catch (error) {
    await runtime.dispose();
    console.error(`[piwin-host] ${toError(error).message}`);
    process.exitCode = 1;
    throw error;
  }
  const pairing = new HostDevicePairing();
  const store = new HostDevicePairingFileStore(join(resolvePiwinRoot(), 'devices', 'pairing.json'));
  try {
    await store.load(pairing);
  } catch (error) {
    await runtime.dispose();
    console.error(`[piwin-host] failed to load pairing store: ${toError(error).message}`);
    process.exitCode = 1;
    throw error;
  }
  devicePairing = pairing;
  devicePairingStore = store;
}

if (authToken !== undefined && !isLoopbackBind(host) && !allowCleartext) {
  console.warn(
    '[piwin-host] warning: door token will ride a cleartext WebSocket on a non-loopback bind. Prefer Tailscale Serve / TLS reverse proxy, or set PIWIN_HOST_ALLOW_CLEARTEXT=1 for a trusted private network.',
  );
}

const server = new HostServer({
  runtime,
  mode,
  host,
  port,
  instanceId: hostInstanceId,
  hostBuildId,
  ...(minClientVersion === undefined ? {} : { minClientVersion }),
  ...(authToken === undefined ? {} : { authToken }),
  ...(devicePairing === undefined ? {} : { devicePairing }),
  ...(devicePairingStore === undefined ? {} : { devicePairingStore }),
  allowRemoteExtensionActivation,
  ...(clientToolBroker === undefined ? {} : { clientToolBroker }),
  onError: (error) => console.error(`[piwin-host] ${error.message}`),
  onConnectionEvent: (event) => {
    logConnectionEvent(event);
    if (event.deviceId && event.phase === 'hello-ok') {
      runtime.noteAuthDeviceConnected(event.deviceId);
    }
    if (event.deviceId && (event.phase === 'close' || event.phase === 'idle-terminate')) {
      runtime.noteAuthDeviceDisconnected(event.deviceId);
    }
  },
});

try {
  const address = await server.start();
  console.log(
    `[piwin-host] listening at ${address.url} (${mode}${mock ? ', mock' : ''}; build=${hostBuildId})`,
  );
  if (devicePairing !== undefined && devicePairingStore !== undefined) {
    const minted = devicePairing.mintToken();
    await devicePairingStore.save(devicePairing);
    const announcement = createHostPairingAnnouncement({
      bindHost: host,
      advertisedEndpoint: resolveAdvertisedEndpoint(
        process.env.PIWIN_HOST_ADVERTISED_URL,
        address.url,
      ),
      pairingToken: minted.token,
      hostInstanceId,
      expiresAt: minted.expiresAt,
    });
    console.log(announcement.text);
  }
} catch (error) {
  await server.stop().catch(() => undefined);
  await runtime.dispose();
  console.error(`[piwin-host] failed to start: ${toError(error).message}`);
  process.exitCode = 1;
}

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await server.stop();
  await runtime.dispose();
};

process.once('SIGINT', () => {
  void shutdown().catch((error: unknown) => {
    console.error(`[piwin-host] shutdown failed: ${toError(error).message}`);
    process.exitCode = 1;
  });
});
process.once('SIGTERM', () => {
  void shutdown().catch((error: unknown) => {
    console.error(`[piwin-host] shutdown failed: ${toError(error).message}`);
    process.exitCode = 1;
  });
});

function logConnectionEvent(event: HostConnectionEvent): void {
  const parts = [
    `phase=${event.phase}`,
    `conn=${event.connectionId}`,
    ...(event.clientId === undefined ? [] : [`client=${event.clientId}`]),
    ...(event.deviceId === undefined ? [] : [`device=${event.deviceId}`]),
    ...(event.code === undefined ? [] : [`code=${event.code}`]),
    ...(event.reason === undefined || event.reason.length === 0 ? [] : [`reason=${event.reason}`]),
    ...(event.seq === undefined ? [] : [`seq=${event.seq}`]),
  ];
  console.log(`[piwin-host] connection ${parts.join(' ')}`);
}

function isLoopbackBind(bindHost: string): boolean {
  return bindHost === '127.0.0.1' || bindHost === 'localhost' || bindHost === '::1';
}

function resolvePiwinRoot(): string {
  const override = process.env.PIWIN_ROOT?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return join(homedir(), '.piwin');
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error('PIWIN_HOST_PORT must be an integer between 0 and 65535');
  }
  return parsed;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Unknown Host error');
}
