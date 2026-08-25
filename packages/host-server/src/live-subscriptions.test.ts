import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostPush, HostResponse } from '@piwin/contracts';
import { HostClient } from '@piwin/host-client';
import { HostRuntime } from '@piwin/host-runtime';
import { WebSocketHostTransport, type WebSocketLike } from '@piwin/host-transport';
import { WebSocket } from 'ws';
import { HostServer } from './host-server.js';

function createNodeWebSocket(endpoint: string): WebSocketLike {
  const socket = new WebSocket(endpoint);
  const wrapper: WebSocketLike = {
    get readyState() {
      return socket.readyState;
    },
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data) {
      socket.send(data);
    },
    close(code, reason) {
      socket.close(code, reason);
    },
  };
  socket.on('open', () => wrapper.onopen?.());
  socket.on('message', (data) => wrapper.onmessage?.({ data: String(data) }));
  socket.on('error', (error) => wrapper.onerror?.(error));
  socket.on('close', (code, reason) => wrapper.onclose?.({ code, reason: String(reason) }));
  return wrapper;
}

type TestClient = {
  id: string;
  client: HostClient;
  pushes: HostPush[];
};

async function connectClient(
  url: string,
  clientId: string,
  options?: { liveSubscriptions?: boolean; sessionIds?: string[] },
): Promise<TestClient> {
  const transport = new WebSocketHostTransport({
    endpoint: url,
    autoReconnect: false,
    webSocketFactory: createNodeWebSocket,
  });
  const client = new HostClient({
    transport,
    clientId,
    clientType: 'desktop',
    clientVersion: 'test',
    capabilities: {
      pushBatching: true,
      cursorBatches: true,
      boundedReplay: true,
      hydration: true,
      ...(options?.liveSubscriptions === true ? { liveSubscriptions: true } : {}),
    },
    ...(options?.sessionIds === undefined ? {} : { subscriptions: { sessionIds: options.sessionIds } }),
    requestTimeoutMs: 15_000,
  });
  const pushes: HostPush[] = [];
  client.subscribePush((push) => {
    pushes.push(push);
  });
  await client.connect();
  return { id: clientId, client, pushes };
}

function requireSuccess(response: HostResponse, label: string): HostResponse & { success: true } {
  if (!response.success) {
    throw new Error(`${label} failed: ${response.error}`);
  }
  return response;
}

describe('live session subscriptions', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    const pending = cleanups.splice(0);
    for (const cleanup of pending.reverse()) {
      await cleanup();
    }
  });

  async function startServer(): Promise<{ runtime: HostRuntime; server: HostServer; url: string }> {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-live-sub-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      testFixture: 'hang-until-abort',
    });
    const server = new HostServer({ runtime, port: 0, instanceId: runtime.getHostInstanceId() });
    const address = await server.start();
    cleanups.push(async () => {
      await server.stop();
      await runtime.dispose();
    });
    return { runtime, server, url: address.url };
  }

  async function createSession(client: TestClient, name: string): Promise<string> {
    const created = requireSuccess(
      await client.client.request(
        {
          type: 'session/create',
          input: { scope: { kind: 'general' }, sessionName: name },
        },
        { idempotencyKey: `create-${name}-${randomUUID()}` },
      ),
      'session/create',
    );
    return (created.data as { sessionId: string }).sessionId;
  }

  it('filters high-rate session A pushes for a client subscribed only to B', async () => {
    const { url } = await startServer();
    const full = await connectClient(url, 'full-fanout');
    cleanups.push(async () => full.client.close());
    const sessionA = await createSession(full, 'A');
    const sessionB = await createSession(full, 'B');
    const filtered = await connectClient(url, 'only-b', {
      liveSubscriptions: true,
      sessionIds: [sessionB],
    });
    cleanups.push(async () => filtered.client.close());
    const seqBefore = filtered.client.getLastSeq();
    requireSuccess(
      await full.client.request(
        {
          type: 'session/prompt',
          sessionId: sessionA,
          input: { text: 'stream-a' },
          foreground: { kind: 'if-idle' },
        },
        { idempotencyKey: `prompt-a-${randomUUID()}` },
      ),
      'prompt A',
    );
    await vi.waitFor(() => {
      if (!full.pushes.some((push) => push.type === 'transcript/append' && push.sessionId === sessionA)) {
        throw new Error('full client missing session A transcript');
      }
    });
    expect(
      filtered.pushes.some((push) => push.type === 'transcript/append' && push.sessionId === sessionA),
    ).toBe(false);
    expect(
      filtered.pushes.some((push) => push.type === 'event' && push.sessionId === sessionA),
    ).toBe(false);
    expect(filtered.client.getLastSeq()).toBeGreaterThanOrEqual(seqBefore);
  });

  it('keeps full fan-out for clients that do not advertise liveSubscriptions', async () => {
    const { url } = await startServer();
    const client = await connectClient(url, 'legacy');
    cleanups.push(async () => client.client.close());
    const sessionId = await createSession(client, 'legacy-session');
    requireSuccess(
      await client.client.request(
        {
          type: 'session/prompt',
          sessionId,
          input: { text: 'hello' },
          foreground: { kind: 'if-idle' },
        },
        { idempotencyKey: `prompt-${randomUUID()}` },
      ),
      'prompt',
    );
    await vi.waitFor(() => {
      if (!client.pushes.some((push) => push.type === 'transcript/append')) {
        throw new Error('legacy client did not receive transcript');
      }
    });
  });

  it('applies a mid-stream subscription update with a fence', async () => {
    const { url } = await startServer();
    const operator = await connectClient(url, 'operator');
    cleanups.push(async () => operator.client.close());
    const sessionA = await createSession(operator, 'switch-a');
    const sessionB = await createSession(operator, 'switch-b');
    const mobile = await connectClient(url, 'mobile-switch', {
      liveSubscriptions: true,
      sessionIds: [sessionA],
    });
    cleanups.push(async () => mobile.client.close());
    const applied = await mobile.client.updateSubscriptions([sessionB]);
    expect(applied.fenceSeq).toBeGreaterThanOrEqual(0);
    expect(applied.revision).toBe(1);
  });
});
