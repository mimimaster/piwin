import { describe, expect, it } from 'vitest';
import {
  parseWorkerFrame,
  serializeWorkerRequest,
  serializeWorkerResourceRequest,
  type WorkerFrameContext,
  type WorkerRequest,
  type WorkerToolCallFrame,
} from './rpc-sdk-worker-protocol.js';
import { RpcSdkWorkerClient } from './rpc-sdk-worker-client.js';
import type { SerializableBlueprint } from './rpc/serializable-blueprint.js';

const frameContext: WorkerFrameContext = {
  sessionId: 'ps-1',
  runtimeGenerationId: 'gen-1',
};

const minimalBlueprint: SerializableBlueprint = {
  protocolVersion: 1,
  snapshotId: 'snap-1',
  settingsRevision: 'r1',
  workingDirectory: '/tmp/work',
  scope: { kind: 'general' },
  resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
  contextManifest: { agentsFiles: [] },
  tools: {
    enabledFamilies: [],
    piBuiltinToolNames: [],
    hostTools: [],
    enabledMcpServerIds: [],
  },
  activeSkillPaths: [],
  activeExtensionPaths: [],
  activePromptPaths: [],
};

describe('parseWorkerFrame', () => {
  it('parses a valid response frame', () => {
    const line = JSON.stringify({
      type: 'response',
      id: 'req-1',
      context: frameContext,
      success: true,
      data: { sessionId: 's1' },
    });
    const frame = parseWorkerFrame(line);
    expect(frame?.type).toBe('response');
    expect(frame?.type === 'response' && frame.id).toBe('req-1');
  });

  it('parses a valid event frame', () => {
    const line = JSON.stringify({
      type: 'event',
      context: { sessionId: 's1', runtimeGenerationId: 'g1' },
      event: { type: 'text', text: 'hello' },
    });
    const frame = parseWorkerFrame(line);
    expect(frame?.type).toBe('event');
  });

  it('parses a tool-call frame (Phase 7 proxy)', () => {
    const line = JSON.stringify({
      type: 'tool-call',
      id: 'tc-1',
      context: { sessionId: 's1', runtimeGenerationId: 'g1', toolCallId: 'tc-1' },
      toolName: 'web_search',
      args: { query: 'piwin' },
    });
    const frame = parseWorkerFrame(line);
    expect(frame?.type).toBe('tool-call');
    if (frame?.type === 'tool-call') {
      expect(frame.toolName).toBe('web_search');
      expect(frame.args).toEqual({ query: 'piwin' });
    }
  });

  it('parses a hello frame', () => {
    const line = JSON.stringify({
      type: 'hello',
      protocolVersion: 1,
      workerPid: 1234,
      capabilities: { toolProxy: true, steer: true, followUp: true, preparedPrompt: true },
    });
    const frame = parseWorkerFrame(line);
    expect(frame?.type).toBe('hello');
  });

  it('parses a shutdown frame (Phase 7 §4.1)', () => {
    const line = JSON.stringify({ type: 'shutdown', reason: 'parent-dispose' });
    const frame = parseWorkerFrame(line);
    expect(frame?.type).toBe('shutdown');
    if (frame?.type === 'shutdown') {
      expect(frame.reason).toBe('parent-dispose');
    }
  });

  it('returns undefined for malformed JSON', () => {
    expect(parseWorkerFrame('not json')).toBeUndefined();
  });

  it('returns undefined for unknown frame type', () => {
    const line = JSON.stringify({ type: 'unknown', id: 'x' });
    expect(parseWorkerFrame(line)).toBeUndefined();
  });

  it('returns undefined for missing required fields', () => {
    expect(parseWorkerFrame(JSON.stringify({ type: 'response' }))).toBeUndefined();
    expect(parseWorkerFrame(JSON.stringify({ type: 'event' }))).toBeUndefined();
    expect(parseWorkerFrame(JSON.stringify({ type: 'tool-call', id: 'x' }))).toBeUndefined();
  });
});

describe('serializeWorkerRequest', () => {
  it('serializes a blueprint-first session/create request', () => {
    const request: WorkerRequest = {
      type: 'request',
      id: 'req-1',
      method: 'session/create',
      context: frameContext,
      payload: {
        method: 'session/create',
        productSessionId: 'ps-1',
        blueprint: minimalBlueprint,
      },
    };
    const parsed = JSON.parse(serializeWorkerRequest(request));
    expect(parsed.type).toBe('request');
    expect(parsed.payload.productSessionId).toBe('ps-1');
    expect(parsed.payload.blueprint.snapshotId).toBe('snap-1');
    expect(parsed.payload.blueprint.protocolVersion).toBe(1);
  });

  it('serializes a prepared prompt with native images', () => {
    const request: WorkerRequest = {
      type: 'request',
      id: 'r2',
      method: 'session/prompt',
      context: frameContext,
      payload: {
        method: 'session/prompt',
        sessionId: 's1',
        text: 'describe this',
        images: [{ mimeType: 'image/png', dataBase64: 'AAAA' }],
      },
    };
    const parsed = JSON.parse(serializeWorkerRequest(request)) as WorkerRequest;
    expect(parsed.payload).toMatchObject({
      sessionId: 's1',
      text: 'describe this',
      images: [{ mimeType: 'image/png', dataBase64: 'AAAA' }],
    });
  });

  it('serializes steer and follow-up requests', () => {
    const steer: WorkerRequest = {
      type: 'request',
      id: 'r1',
      method: 'session/steer',
      context: frameContext,
      payload: { method: 'session/steer', sessionId: 's1', message: 'go on' },
    };
    const followUp: WorkerRequest = {
      type: 'request',
      id: 'r2',
      method: 'session/follow-up',
      context: frameContext,
      payload: { method: 'session/follow-up', sessionId: 's1', message: 'thanks' },
    };
    expect(JSON.parse(serializeWorkerRequest(steer)).method).toBe('session/steer');
    expect(JSON.parse(serializeWorkerRequest(followUp)).method).toBe('session/follow-up');
  });
});

describe('RpcSdkWorkerClient startup and framing', () => {
  it('returns a ToolResult when the parent tool handler throws', async () => {
    const client = new RpcSdkWorkerClient({
      onToolCall: async () => {
        throw new Error('parent tool failed');
      },
    });
    let written = '';
    Reflect.set(client, 'child', {
      stdin: {
        write: (chunk: string) => {
          written += chunk;
          return true;
        },
      },
    });
    const frame: WorkerToolCallFrame = {
      type: 'tool-call',
      id: 'tool-call-1',
      context: { sessionId: 'session-1', runtimeGenerationId: 'generation-1' },
      toolName: 'bash',
      args: { command: 'false' },
    };
    const handleToolCall = Reflect.get(client, 'handleToolCall') as (
      input: WorkerToolCallFrame,
      signal: AbortSignal,
    ) => Promise<void>;

    await handleToolCall.call(client, frame, new AbortController().signal);

    const result = JSON.parse(written) as {
      type: string;
      ok: boolean;
      code?: string;
      message?: string;
      result?: { ok: boolean; code?: string; message?: string };
    };
    expect(result.type).toBe('tool-result');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('execution-failed');
    expect(result.message).toBe('parent tool failed');
    expect(result.result).toEqual({
      ok: false,
      code: 'execution-failed',
      message: 'parent tool failed',
    });
  });

  it('preserves a hello frame split across stdout chunks', async () => {
    const helloFrame = JSON.stringify({
      type: 'hello',
      protocolVersion: 1,
      workerPid: 1234,
      capabilities: { toolProxy: true, steer: true, followUp: true, preparedPrompt: true },
    });
    const workerCode = [
      `const helloFrame = ${JSON.stringify(helloFrame)};`,
      'process.stdout.write(helloFrame.slice(0, 9));',
      "setTimeout(() => process.stdout.write(helloFrame.slice(9) + '\\n'), 10);",
      'setInterval(() => {}, 1000);',
    ].join(' ');
    const client = new RpcSdkWorkerClient({
      workerScript: 'unused-worker-script',
      nodeArgs: ['-e', workerCode],
      helloTimeoutMs: 1_000,
      context: { sessionId: 'test-session', runtimeGenerationId: 'test-generation' },
    });

    await client.start();
    expect(client.isReady).toBe(true);
    await client.close();
  });

  it('kills a worker that times out during hello startup', async () => {
    const client = new RpcSdkWorkerClient({
      workerScript: 'unused-worker-script',
      nodeArgs: ['-e', 'setInterval(() => {}, 1000);'],
      helloTimeoutMs: 25,
      context: { sessionId: 'test-session', runtimeGenerationId: 'test-generation' },
    });

    await expect(client.start()).rejects.toThrow(/hello timeout/);
    expect(client.isRunning).toBe(false);
    expect(client.isReady).toBe(false);
  });

  it('does not inherit arbitrary parent environment variables', async () => {
    const secretEnvironmentKey = 'PIWIN_WORKER_TEST_SECRET';
    const previousSecret = process.env[secretEnvironmentKey];
    process.env[secretEnvironmentKey] = 'must-not-cross-worker-boundary';
    const helloFrame = JSON.stringify({
      type: 'hello',
      protocolVersion: 1,
      workerPid: 1234,
      capabilities: { toolProxy: true, steer: true, followUp: true, preparedPrompt: true },
    });
    const workerCode = [
      `if (process.env.${secretEnvironmentKey}) process.exit(2);`,
      `process.stdout.write(${JSON.stringify(helloFrame)} + '\\n');`,
      'setInterval(() => {}, 1000);',
    ].join(' ');
    const client = new RpcSdkWorkerClient({
      workerScript: 'unused-worker-script',
      nodeArgs: ['-e', workerCode],
      helloTimeoutMs: 1_000,
      context: { sessionId: 'test-session', runtimeGenerationId: 'test-generation' },
    });

    try {
      await client.start();
      expect(client.isReady).toBe(true);
    } finally {
      await client.close();
      if (previousSecret === undefined) {
        delete process.env[secretEnvironmentKey];
      } else {
        process.env[secretEnvironmentKey] = previousSecret;
      }
    }
  });

  it('cleans up a worker that advertises an incompatible protocol', async () => {
    const incompatibleHello = JSON.stringify({
      type: 'hello',
      protocolVersion: 2,
      workerPid: 1234,
      capabilities: {},
    });
    const client = new RpcSdkWorkerClient({
      workerScript: 'unused-worker-script',
      nodeArgs: [
        '-e',
        [
          `process.stdout.write(${JSON.stringify(incompatibleHello)} + '\\n');`,
          'setInterval(() => {}, 1000);',
        ].join(' '),
      ],
      helloTimeoutMs: 1_000,
      context: { sessionId: 'test-session', runtimeGenerationId: 'test-generation' },
    });

    await expect(client.start()).rejects.toThrow(/protocol version 2 incompatible/);
    expect(client.isRunning).toBe(false);
  });

  it('waits for prompt completion beyond the removed two-second default', async () => {
    const helloFrame = JSON.stringify({
      type: 'hello',
      protocolVersion: 1,
      workerPid: 1234,
      capabilities: { toolProxy: true, steer: true, followUp: true, preparedPrompt: true },
    });
    const workerCode = [
      `process.stdout.write(${JSON.stringify(helloFrame)} + '\\n');`,
      "process.stdin.on('data', (chunk) => {",
      '  const request = JSON.parse(chunk.toString());',
      "  if (request.payload?.method === 'session/prompt') {",
      "    setTimeout(() => process.stdout.write(JSON.stringify({ type: 'response', id: request.id, context: request.context, success: true, data: {} }) + '\\n'), 2_100);",
      '  }',
      '});',
      'setInterval(() => {}, 1000);',
    ].join(' ');
    const client = new RpcSdkWorkerClient({
      workerScript: 'unused-worker-script',
      nodeArgs: ['-e', workerCode],
      helloTimeoutMs: 1_000,
      context: { sessionId: 'session-1', runtimeGenerationId: 'generation-1' },
    });

    try {
      await client.start();
      await expect(client.prompt('session-1', 'long generation')).resolves.toBeUndefined();
    } finally {
      await client.close();
    }
  }, 10_000);
});

describe('worker resource frames (ADR 0040 §8)', () => {
  it('parses a valid resource-response frame', () => {
    const line = JSON.stringify({
      type: 'resource-response',
      id: 'res-1',
      memory: { rssBytes: 123, heapUsedBytes: 45, heapTotalBytes: 100, externalBytes: 5 },
      sampledAtMs: 12345,
    });
    const frame = parseWorkerFrame(line);
    expect(frame?.type).toBe('resource-response');
    if (frame?.type === 'resource-response') {
      expect(frame.id).toBe('res-1');
      expect(frame.memory.rssBytes).toBe(123);
      expect(frame.memory.heapTotalBytes).toBe(100);
    }
  });

  it('rejects malformed resource-response frames', () => {
    expect(
      parseWorkerFrame(
        JSON.stringify({
          type: 'resource-response',
          id: 'x',
          memory: { rssBytes: 1 },
          sampledAtMs: 0,
        }),
      ),
    ).toBeUndefined();
    expect(
      parseWorkerFrame(JSON.stringify({ type: 'resource-response', id: 'x' })),
    ).toBeUndefined();
  });

  it('serializes an internal resource request', () => {
    const line = serializeWorkerResourceRequest({ type: 'resource-request', id: 'res-2' });
    expect(JSON.parse(line)).toEqual({ type: 'resource-request', id: 'res-2' });
  });
});
