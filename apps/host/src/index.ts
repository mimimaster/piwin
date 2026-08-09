#!/usr/bin/env node
import { HostRuntime } from '@piwin/host-runtime';
import { HostServer } from '@piwin/host-server';

const mode = process.env.PIWIN_HOST_MODE === 'rpc' ? 'rpc' : 'sdk';
const mock = process.env.PIWIN_MOCK === '1';
const host = process.env.PIWIN_HOST_BIND ?? '127.0.0.1';
const port = parsePort(process.env.PIWIN_HOST_PORT) ?? 8787;
const authToken = process.env.PIWIN_HOST_TOKEN;

const runtime = new HostRuntime({
  mode,
  mock,
  ...(process.env.PIWIN_ROOT === undefined ? {} : { piwinRoot: process.env.PIWIN_ROOT }),
});
const server = new HostServer({
  runtime,
  mode,
  host,
  port,
  ...(authToken === undefined ? {} : { authToken }),
  onError: (error) => console.error(`[piwin-host] ${error.message}`),
});

try {
  const address = await server.start();
  console.log(`[piwin-host] listening at ${address.url} (${mode}${mock ? ', mock' : ''})`);
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
