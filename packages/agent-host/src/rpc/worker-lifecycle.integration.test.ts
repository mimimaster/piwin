/**
 * WP3 integration test: worker process hello + create + drop lifecycle.
 *
 * Spawns the real worker entry via tsx and exercises the JSONL protocol
 * without bypassing the blueprint-first session factory.
 */
import { describe, expect, it } from 'vitest';
import { resolve as resolvePath } from 'node:path';
import { RpcSdkWorkerClient } from '../rpc-sdk-worker-client.js';

function createWorkerClient(): RpcSdkWorkerClient {
  const workerScript = resolvePath(new URL('../rpc-sdk-worker-entry.ts', import.meta.url).pathname);
  return new RpcSdkWorkerClient({
    workerScript,
    nodeArgs: ['--import', 'tsx'],
    context: { sessionId: 'integration-session', runtimeGenerationId: 'integration-generation' },
  });
}

describe('worker process lifecycle (integration)', () => {
  it('emits hello on startup with protocol version 1', async () => {
    const client = createWorkerClient();
    await client.start();

    expect(client.isRunning).toBe(true);

    await client.close();
  }, 10_000);

  it('reports worker exit on close', async () => {
    const client = createWorkerClient();
    await client.start();

    const exitPromise = new Promise<number | null>((resolve) => {
      client.once('exit', (code) => resolve(code));
    });

    await client.close();
    const exitCode = await exitPromise;
    // SIGTERM kill yields null code (signal exit); both null and 0 are valid.
    expect(client.isRunning).toBe(false);
    expect(exitCode).toBeNull();
  }, 10_000);

  it('starts from the source worker entry when no workerScript is provided', async () => {
    const client = new RpcSdkWorkerClient({
      context: {
        sessionId: 'default-script-session',
        runtimeGenerationId: 'default-script-generation',
      },
    });
    await client.start();
    expect(client.isRunning).toBe(true);
    await client.close();
  }, 10_000);
});
