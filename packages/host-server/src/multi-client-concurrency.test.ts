import { describe, expect, it } from 'vitest';
import type { HostCommand, HostResponse, HostWireMessage, PushSink } from '@piwin/contracts';
import { WebSocket } from 'ws';
import { decodeHostWireMessage, encodeHostWireMessage } from '@piwin/host-transport';
import { HostServer, type HostRuntimePort } from './host-server.js';

class CountingRuntime implements HostRuntimePort {
  public promptCount = 0;
  public lastPrompt: HostCommand | undefined;
  public applyCount = 0;
  private readonly sinks = new Map<string, PushSink>();

  public async handleCommand(command: HostCommand): Promise<HostResponse> {
    if (command.type === 'host/ping') {
      return { type: 'response', command: command.type, success: true, data: { pong: true } };
    }
    if (command.type === 'session/prompt') {
      this.promptCount += 1;
      this.lastPrompt = command;
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: { sessionId: command.sessionId, runId: `run-${this.promptCount}` },
      };
    }
    if (command.type === 'settings/apply') {
      this.applyCount += 1;
      return { type: 'response', command: command.type, success: true, data: {} };
    }
    return { type: 'response', command: command.type, success: true, data: {} };
  }


  public attachPushSink(sink: PushSink): () => void {
    const id = `${this.sinks.size}`;
    this.sinks.set(id, sink);
    return () => {
      this.sinks.delete(id);
    };
  }
  public attachBrowserFrameSink(_sink: unknown): () => void {
    return () => undefined;
  }
}

class Inbox {
  private readonly messages: HostWireMessage[] = [];
  private readonly waiters: Array<{
    predicate: (message: HostWireMessage) => boolean;
    resolve: (message: HostWireMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  public push(message: HostWireMessage): void {
    const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message));
    const waiter = waiterIndex === -1 ? undefined : this.waiters.splice(waiterIndex, 1)[0];
    if (waiter === undefined) {
      this.messages.push(message);
      return;
    }
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  }

  public waitFor(predicate: (message: HostWireMessage) => boolean): Promise<HostWireMessage> {
    const messageIndex = this.messages.findIndex(predicate);
    const message = messageIndex === -1 ? undefined : this.messages.splice(messageIndex, 1)[0];
    if (message !== undefined) {
      return Promise.resolve(message);
    }
    return new Promise<HostWireMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for Host message')), 5_000);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }
}

async function openClient(
  url: string,
  clientId: string,
): Promise<{ socket: WebSocket; inbox: Inbox }> {
  const socket = new WebSocket(url);
  const inbox = new Inbox();
  socket.on('message', (data) => inbox.push(decodeHostWireMessage(data.toString())));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', (error) => reject(error));
  });
  socket.send(
    encodeHostWireMessage({
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'desktop',
      clientVersion: 'test',
      clientId,
      lastSeq: 0,
    }),
  );
  await inbox.waitFor((message) => message.type === 'host/hello');
  return { socket, inbox };
}

describe('multi-client concurrency (HostServer)', () => {
  it('rejects a remote mutation without an idempotency key', async () => {
    const runtime = new CountingRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'mc-key' });
    const address = await server.start();
    const { socket, inbox } = await openClient(address.url, 'client-a');
    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'no-key',
        command: {
          type: 'session/prompt',
          sessionId: 's1',
          input: { text: 'hi' },
          foreground: { kind: 'if-idle' },
        },
      }),
    );
    const response = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'no-key',
    );
    expect(response).toMatchObject({
      type: 'response',
      response: { success: false, problem: { code: 'idempotency-key-required' } },
    });
    expect(runtime.promptCount).toBe(0);
    socket.close();
    await server.stop();
  });

  it('replays the same idempotency key as one prompt', async () => {
    const runtime = new CountingRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'mc-replay' });
    const address = await server.start();
    const { socket, inbox } = await openClient(address.url, 'client-a');
    const command = {
      type: 'session/prompt' as const,
      sessionId: 's1',
      input: { text: 'hi' },
      foreground: { kind: 'if-idle' as const },
    };
    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'p1',
        idempotencyKey: 'gesture-1',
        command,
      }),
    );
    await inbox.waitFor((message) => message.type === 'response' && message.requestId === 'p1');
    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'p2',
        idempotencyKey: 'gesture-1',
        command,
      }),
    );
    await inbox.waitFor((message) => message.type === 'response' && message.requestId === 'p2');
    expect(runtime.promptCount).toBe(1);
    socket.close();
    await server.stop();
  });

  it('14. a new hostInstanceId does not replay the old idempotency table', async () => {
    const runtime = new CountingRuntime();
    const first = new HostServer({ runtime, port: 0, instanceId: 'instance-a' });
    const address = await first.start();
    const { socket, inbox } = await openClient(address.url, 'client-a');
    const command = {
      type: 'session/prompt' as const,
      sessionId: 's1',
      input: { text: 'hi' },
      foreground: { kind: 'if-idle' as const },
    };
    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'old-instance',
        idempotencyKey: 'surviving-key',
        command,
      }),
    );
    await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'old-instance',
    );
    expect(runtime.promptCount).toBe(1);
    socket.close();
    await first.stop();

    const second = new HostServer({ runtime, port: 0, instanceId: 'instance-b' });
    const next = await second.start();
    const replay = await openClient(next.url, 'client-a');
    replay.socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'new-instance',
        idempotencyKey: 'surviving-key',
        command,
      }),
    );
    await replay.inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'new-instance',
    );
    expect(runtime.promptCount).toBe(2);
    replay.socket.close();
    await second.stop();
  });

  it('accepts a remote settings/apply of desktop restore', async () => {
    const runtime = new CountingRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'mc-desktop' });
    const address = await server.start();
    const { socket, inbox } = await openClient(address.url, 'client-a');
    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'apply-desktop',
        idempotencyKey: 'settings-1',
        command: {
          type: 'settings/apply',
          input: {
            expectedRevision: 'rev-1',
            expectedDomainRevisions: { desktop: 'hash-1' },
            mutations: [{ kind: 'replace-domain', domain: 'desktop', value: {} }],
          },
        },
      }),
    );
    const accepted = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'apply-desktop',
    );
    expect(accepted).toMatchObject({ type: 'response' });
    expect(runtime.applyCount).toBe(1);
    socket.close();
    await server.stop();
  });

  it('rejects a raw Host path context ref and accepts a Host-issued message ref', async () => {
    const runtime = new CountingRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'mc-refs' });
    const address = await server.start();
    const { socket, inbox } = await openClient(address.url, 'client-a');
    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'unsafe-ref',
        idempotencyKey: 'ref-1',
        command: {
          type: 'session/prompt',
          sessionId: 's1',
          input: {
            text: 'see this',
            contextRefs: [
              {
                kind: 'file',
                projectPath: '/Users/private/Projects/piwin',
                relativePath: 'src/a.ts',
                label: 'src/a.ts',
              },
            ],
          },
          foreground: { kind: 'if-idle' },
        },
      }),
    );
    const unsafe = await inbox.waitFor(
      (message) => message.type === 'error' && message.requestId === 'unsafe-ref',
    );
    expect(unsafe).toMatchObject({ type: 'error', code: 'command-not-allowed' });
    expect(runtime.promptCount).toBe(0);

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'safe-ref',
        idempotencyKey: 'ref-2',
        command: {
          type: 'session/prompt',
          sessionId: 's1',
          input: {
            text: 'see this',
            contextRefs: [
              {
                kind: 'main-message',
                sourceSessionId: 's1',
                messageId: 'm1',
                label: 'turn',
              },
            ],
          },
          foreground: { kind: 'if-idle' },
        },
      }),
    );
    await inbox.waitFor((message) => message.type === 'response' && message.requestId === 'safe-ref');
    expect(runtime.promptCount).toBe(1);
    socket.close();
    await server.stop();
  });
});
