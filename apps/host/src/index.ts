#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { HostRuntime } from '@piwin/host-runtime';
import {
  HostDevicePairing,
  HostDevicePairingFileStore,
  HostServer,
  assertPairingBindIsAdvertisable,
} from '@piwin/host-server';
import { createHostPairingAnnouncement, resolveAdvertisedEndpoint } from './pairing-print.js';

const mode = process.env.PIWIN_HOST_MODE === 'rpc' ? 'rpc' : 'sdk';
const mock = process.env.PIWIN_MOCK === '1';
const host = process.env.PIWIN_HOST_BIND ?? '127.0.0.1';
const port = parsePort(process.env.PIWIN_HOST_PORT) ?? 8787;
const authToken = process.env.PIWIN_HOST_TOKEN;
const pairingEnabled = process.env.PIWIN_HOST_PAIRING === '1';
// ADR 0047 §12: remote extension activation executes code on this Host and
// stays denied unless the operator opts in explicitly.
const allowRemoteExtensionActivation = process.env.PIWIN_HOST_ALLOW_EXTENSION_ACTIVATION === '1';

const runtime = new HostRuntime({
  mode,
  mock,
  ...(process.env.PIWIN_ROOT === undefined ? {} : { piwinRoot: process.env.PIWIN_ROOT }),
});

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

const server = new HostServer({
  runtime,
  mode,
  host,
  port,
  ...(authToken === undefined ? {} : { authToken }),
  ...(devicePairing === undefined ? {} : { devicePairing }),
  ...(devicePairingStore === undefined ? {} : { devicePairingStore }),
  allowRemoteExtensionActivation,
  onError: (error) => console.error(`[piwin-host] ${error.message}`),
});

try {
  const address = await server.start();
  console.log(`[piwin-host] listening at ${address.url} (${mode}${mock ? ', mock' : ''})`);
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
      hostInstanceId: server.getInstanceId(),
      expiresAt: minted.expiresAt,
    });
    console.log(announcement.text);
  }
} catch (error) {
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
