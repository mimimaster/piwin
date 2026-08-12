import { describe, expect, it } from 'vitest';
import { RpcSdkWorkerClient } from '../rpc-sdk-worker-client.js';

describe('worker secret bootstrap integration', () => {
  it('delivers the key through fd 3 before hello without putting it in JSONL', async () => {
    const canary = 'bootstrap-canary-must-not-be-logged';
    const hello = JSON.stringify({
      type: 'hello',
      protocolVersion: 1,
      workerPid: 1234,
      capabilities: {
        toolProxy: true,
        steer: true,
        followUp: true,
        preparedPrompt: true,
        providerSecretBootstrap: true,
      },
    });
    const workerCode = [
      "const fs = require('fs');",
      'const chunks = [];',
      "fs.createReadStream(null, { fd: 3 }).on('data', (chunk) => chunks.push(chunk)).on('end', () => {",
      '  const frame = Buffer.concat(chunks);',
      '  const size = frame.readUInt32BE(0);',
      "  const payload = JSON.parse(frame.subarray(4, 4 + size).toString('utf8'));",
      `  if (payload.secrets[0].value !== ${JSON.stringify(canary)}) process.exit(2);`,
      `  process.stdout.write(${JSON.stringify(hello)} + '\\n');`,
      '});',
      'setInterval(() => {}, 1000);',
    ].join(' ');
    const diagnostics: string[] = [];
    const client = new RpcSdkWorkerClient({
      workerScript: 'unused-worker-script',
      nodeArgs: ['-e', workerCode],
      bootstrapSecrets: [{ secretId: 'provider-secret-1', value: canary }],
      context: { sessionId: 'session-1', runtimeGenerationId: 'generation-1' },
      onEvent: () => undefined,
    });
    client.on('log', (message: string) => diagnostics.push(message));

    try {
      await client.start();
      expect(client.isReady).toBe(true);
      expect(diagnostics.join('\n')).not.toContain(canary);
      expect(String(Reflect.get(client, 'stdoutBuffer'))).not.toContain(canary);
    } finally {
      await client.close();
    }
  }, 10_000);

  it('rejects a worker that does not advertise the bootstrap capability', async () => {
    const hello = JSON.stringify({
      type: 'hello',
      protocolVersion: 1,
      workerPid: 1234,
      capabilities: { toolProxy: true, steer: true, followUp: true, preparedPrompt: true },
    });
    const workerCode = [
      `process.stdout.write(${JSON.stringify(hello)} + '\\n');`,
      'setInterval(() => {}, 1000);',
    ].join(' ');
    const client = new RpcSdkWorkerClient({
      workerScript: 'unused-worker-script',
      nodeArgs: ['-e', workerCode],
      bootstrapSecrets: [{ secretId: 'provider-secret-1', value: 'capability-canary' }],
      context: { sessionId: 'session-1', runtimeGenerationId: 'generation-1' },
      onEvent: () => undefined,
    });

    await expect(client.start()).rejects.toThrow(/does not support provider secret bootstrap/);
    expect(client.isRunning).toBe(false);
  }, 10_000);

  it('rejects startup cleanly when the worker closes fd 3 before reading', async () => {
    const workerCode = [
      "const fs = require('fs');",
      'fs.closeSync(3);',
      'setTimeout(() => process.exit(0), 10);',
    ].join(' ');
    const client = new RpcSdkWorkerClient({
      workerScript: 'unused-worker-script',
      nodeArgs: ['-e', workerCode],
      bootstrapSecrets: [
        { secretId: 'provider-secret-1', value: 'x'.repeat(16 * 1024) },
        { secretId: 'provider-secret-2', value: 'y'.repeat(16 * 1024) },
        { secretId: 'provider-secret-3', value: 'z'.repeat(16 * 1024) },
      ],
      context: { sessionId: 'session-1', runtimeGenerationId: 'generation-1' },
      onEvent: () => undefined,
    });

    await expect(client.start()).rejects.toThrow();
    expect(client.isRunning).toBe(false);
  }, 10_000);
});
