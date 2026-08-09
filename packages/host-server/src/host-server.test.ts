import { describe, expect, it } from 'vitest';
import type {
  HostCommand,
  HostPush,
  HostResponse,
  HostWireMessage,
  PushSink,
} from '@piwin/contracts';
import { WebSocket } from 'ws';
import { decodeHostWireMessage, encodeHostWireMessage } from '@piwin/host-transport';
import { HostServer, type HostRuntimePort } from './host-server.js';

class FakeRuntime implements HostRuntimePort {
  private readonly sinks = new Map<string, PushSink>();
  public lastPrompt: HostCommand | undefined;

  public async handleCommand(command: HostCommand): Promise<HostResponse> {
    if (command.type === 'host/ping') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: { pong: true },
      };
    }
    if (command.type === 'host/status') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          mode: 'sdk',
          ready: true,
          mock: true,
          piwinRoot: '/Users/private/.piwin',
          activeSessionIds: ['session-1'],
          capabilities: {},
        },
      };
    }
    if (command.type === 'project/list') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          projects: [
            {
              path: '/Users/private/Projects/example',
              trust: 'trusted',
              displayName: 'example',
              lastOpenedAt: '2026-08-08T00:00:00.000Z',
            },
          ],
        },
      };
    }
    if (command.type === 'session/messages') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          sessionId: command.sessionId,
          messages: [
            {
              id: 'message-1',
              role: 'assistant',
              text: 'done',
              createdAt: '2026-08-08T00:00:00.000Z',
              status: 'done',
              attachments: [{ path: '/Users/private/.piwin/media/secret.png' }],
            },
          ],
        },
      };
    }
    if (command.type === 'session/list-page') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          status: 'page',
          sessions: [
            {
              id: 'session-1',
              scope: { kind: 'general' },
              workingDirectory: '/Users/private/General',
              projectPath: '/Users/private/Projects/example',
              name: 'Remote chat',
              updatedAt: '2026-08-09T00:00:00.000Z',
              messageCount: 2,
            },
          ],
          page: {
            revision: 'a'.repeat(64),
            pageIndex: 0,
            pageCount: 2,
            totalCount: 7,
            nextCursor: 'opaque-next',
          },
        },
      };
    }
    if (command.type === 'session/transcript-page') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          status: 'page',
          messages: [
            {
              id: 'message-older',
              role: 'assistant',
              text: 'older remote message',
              createdAt: '2026-08-08T00:00:00.000Z',
              status: 'done',
              attachments: [{ path: '/Users/private/.piwin/media/secret.png' }],
            },
          ],
          page: {
            revision: 'b'.repeat(64),
            totalCount: 80,
            startIndex: 48,
            endIndex: 64,
            messageBytes: 256,
            olderCursor: 'opaque-transcript-older',
          },
        },
      };
    }
    if (command.type === 'media/save') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          asset: {
            id: 'asset-1',
            sessionId: command.input.sessionId,
            absolutePath: '/Users/private/.piwin/media/asset-1.png',
            mimeType: command.input.mimeType,
            byteSize: 4,
            createdAt: '2026-08-09T00:00:00.000Z',
          },
        },
      };
    }
    if (command.type === 'session/prompt') {
      this.lastPrompt = command;
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: { sessionId: command.sessionId, runId: 'run-1' },
      };
    }
    return {
      type: 'response',
      command: command.type,
      success: true,
      data: { sessions: [] },
    };
  }

  public attachPushSink(sink: PushSink): () => void {
    this.sinks.set(sink.id, sink);
    return () => this.sinks.delete(sink.id);
  }

  public detachPushSink(id: string): void {
    this.sinks.delete(id);
  }

  public emit(push: HostPush): void {
    for (const sink of this.sinks.values()) {
      sink.push(push);
    }
  }
}

class MessageInbox {
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
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for Host message'));
      }, 5_000);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }
}

describe('HostServer', () => {
  it('serves bounded General session pages without Host paths', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-page-test' });
    const address = await server.start();
    const socket = new WebSocket(address.url);
    const inbox = new MessageInbox();
    socket.on('message', (data) => inbox.push(decodeHostWireMessage(data.toString())));

    await waitForOpen(socket);
    socket.send(
      encodeHostWireMessage({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'desktop',
        clientVersion: 'test',
        clientId: 'desktop-page-test',
        lastSeq: 0,
      }),
    );
    await inbox.waitFor((message) => message.type === 'host/hello');

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'page-request',
        command: {
          type: 'session/list-page',
          query: {
            scope: { kind: 'general' },
            lifecycle: 'active',
            order: 'updated',
            limit: 6,
          },
        },
      }),
    );
    const response = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'page-request',
    );
    expect(JSON.stringify(response)).not.toContain('/Users/private');
    expect(response).toMatchObject({
      type: 'response',
      response: {
        success: true,
        data: {
          status: 'page',
          sessions: [{ sessionId: 'session-1', name: 'Remote chat', scope: 'general' }],
          page: { pageIndex: 0, pageCount: 2, totalCount: 7, nextCursor: 'opaque-next' },
        },
      },
    });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'transcript-page-request',
        command: {
          type: 'session/transcript-page',
          query: {
            sessionId: 'session-1',
            limit: 16,
            maximumBytes: 256 * 1024,
            beforeCursor: 'opaque-transcript-cursor',
          },
        },
      }),
    );
    const transcriptResponse = await inbox.waitFor(
      (message) =>
        message.type === 'response' && message.requestId === 'transcript-page-request',
    );
    expect(JSON.stringify(transcriptResponse)).not.toContain('/Users/private');
    expect(transcriptResponse).toMatchObject({
      type: 'response',
      response: {
        success: true,
        data: {
          status: 'page',
          messages: [{ id: 'message-older', attachmentCount: 1 }],
          page: {
            totalCount: 80,
            startIndex: 48,
            endIndex: 64,
            messageBytes: 256,
            olderCursor: 'opaque-transcript-older',
          },
        },
      },
    });

    socket.close();
    await server.stop();
  });

  it('serves a handshake, safe read model, and sequenced pushes', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-test' });
    const address = await server.start();
    const socket = new WebSocket(address.url);
    const inbox = new MessageInbox();
    socket.on('message', (data) => {
      inbox.push(decodeHostWireMessage(data.toString()));
    });
    await waitForOpen(socket);

    socket.send(
      encodeHostWireMessage({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'mobile-test',
        lastSeq: 0,
      }),
    );

    const hello = await inbox.waitFor((message) => message.type === 'host/hello');
    expect(hello).toMatchObject({ type: 'host/hello', hostInstanceId: 'host-test' });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'project-request',
        command: { type: 'project/list', id: 'project-request' },
      }),
    );
    const response = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'project-request',
    );
    if (response.type !== 'response' || !response.response.success) {
      throw new Error('Expected successful project response');
    }
    expect(response.response.data).toEqual({
      projects: [
        expect.objectContaining({
          projectId: expect.stringMatching(/^project-/),
          displayName: 'example',
        }),
      ],
    });
    expect(JSON.stringify(response.response.data)).not.toContain('/Users/private');

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'messages-request',
        command: { type: 'session/messages', id: 'messages-request', sessionId: 'session-1' },
      }),
    );
    const messagesResponse = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'messages-request',
    );
    expect(messagesResponse).toMatchObject({
      type: 'response',
      response: {
        success: true,
        data: {
          messages: [{ attachmentCount: 1 }],
        },
      },
    });
    expect(JSON.stringify(messagesResponse)).not.toContain('/Users/private');

    runtime.emit({ type: 'host/status', mode: 'sdk', ready: true, mock: true });
    const push = await inbox.waitFor((message) => message.type === 'push');
    expect(push).toMatchObject({ type: 'push', seq: 1, push: { type: 'host/status' } });

    const reconnectingSocket = new WebSocket(address.url);
    const reconnectingInbox = new MessageInbox();
    reconnectingSocket.on('message', (data) => {
      reconnectingInbox.push(decodeHostWireMessage(data.toString()));
    });
    await waitForOpen(reconnectingSocket);
    reconnectingSocket.send(
      encodeHostWireMessage({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'mobile-reconnect',
        lastSeq: 0,
      }),
    );
    await reconnectingInbox.waitFor((message) => message.type === 'host/hello');
    const replayedPush = await reconnectingInbox.waitFor((message) => message.type === 'push');
    expect(replayedPush).toMatchObject({ type: 'push', seq: 1 });

    socket.close();
    reconnectingSocket.close();
    await server.stop();
  });

  it('negotiates cursor batches for capable clients', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-batch-test' });
    const address = await server.start();
    const socket = new WebSocket(address.url);
    const inbox = new MessageInbox();
    socket.on('message', (data) => {
      inbox.push(decodeHostWireMessage(data.toString()));
    });
    await waitForOpen(socket);

    socket.send(
      encodeHostWireMessage({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'desktop',
        clientVersion: 'test',
        clientId: 'desktop-batch-test',
        lastSeq: 0,
        capabilities: {
          pushBatching: true,
          cursorBatches: true,
          boundedReplay: true,
          hydration: true,
        },
      }),
    );

    await inbox.waitFor((message) => message.type === 'host/hello');
    runtime.emit({ type: 'host/log', level: 'info', message: 'batched' });
    const batch = await inbox.waitFor((message) => message.type === 'push/batch');
    expect(batch).toMatchObject({
      type: 'push/batch',
      hostInstanceId: 'host-batch-test',
      afterSeq: 0,
      throughSeq: 1,
      items: [{ seq: 1, push: { type: 'host/log', message: 'batched' } }],
    });

    socket.close();
    await server.stop();
  });

  it('sends an explicit hydration frame when the replay cursor is too old', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({
      runtime,
      port: 0,
      instanceId: 'host-hydration-test',
      maxReplay: 1,
    });
    const address = await server.start();
    runtime.emit({ type: 'host/log', level: 'info', message: 'first' });
    runtime.emit({ type: 'host/log', level: 'info', message: 'second' });
    await waitForDrain();

    const socket = new WebSocket(address.url);
    const inbox = new MessageInbox();
    socket.on('message', (data) => {
      inbox.push(decodeHostWireMessage(data.toString()));
    });
    await waitForOpen(socket);
    socket.send(
      encodeHostWireMessage({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'desktop',
        clientVersion: 'test',
        clientId: 'desktop-hydration-test',
        lastSeq: 0,
        capabilities: {
          pushBatching: true,
          cursorBatches: true,
          boundedReplay: true,
          hydration: true,
        },
        subscriptions: { sessionIds: ['session-1'] },
      }),
    );

    await inbox.waitFor((message) => message.type === 'host/hello');
    const hydration = await inbox.waitFor((message) => message.type === 'hydration');
    expect(hydration).toMatchObject({
      type: 'hydration',
      reason: 'replay-too-old',
      snapshot: {
        hostInstanceId: 'host-hydration-test',
        sessions: [],
        messagesBySession: { 'session-1': [{ id: 'message-1', status: 'done' }] },
      },
    });
    const replayDone = await inbox.waitFor((message) => message.type === 'replay/done');
    expect(replayDone).toMatchObject({ type: 'replay/done', complete: false });

    socket.close();
    await server.stop();
  });

  it('stores remote media and translates asset refs without returning Host paths', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-media-test' });
    const address = await server.start();
    const socket = new WebSocket(address.url);
    const inbox = new MessageInbox();
    socket.on('message', (data) => {
      inbox.push(decodeHostWireMessage(data.toString()));
    });
    await waitForOpen(socket);
    socket.send(
      encodeHostWireMessage({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'mobile-media-test',
        lastSeq: 0,
      }),
    );
    await inbox.waitFor((message) => message.type === 'host/hello');

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'media-request',
        command: {
          type: 'media/save',
          id: 'media-request',
          input: {
            sessionId: 'session-1',
            mimeType: 'image/png',
            source: 'file-picker',
            base64Data: 'AQIDBA==',
          },
        },
      }),
    );
    const mediaResponse = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'media-request',
    );
    expect(JSON.stringify(mediaResponse)).not.toContain('/Users/private');
    expect(mediaResponse).toMatchObject({
      type: 'response',
      response: { success: true, data: { asset: { id: 'asset-1', mimeType: 'image/png' } } },
    });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'prompt-with-media',
        command: {
          type: 'session/prompt',
          id: 'prompt-with-media',
          sessionId: 'session-1',
          input: {
            text: 'inspect this image',
            attachments: [
              {
                id: 'asset-1',
                kind: 'media',
                path: 'remote-asset:asset-1',
                mimeType: 'image/png',
                byteSize: 4,
                source: 'file-picker',
              },
            ],
          },
        },
      }),
    );
    await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'prompt-with-media',
    );
    expect(runtime.lastPrompt).toMatchObject({
      type: 'session/prompt',
      input: { attachments: [{ path: '/Users/private/.piwin/media/asset-1.png' }] },
    });

    socket.close();
    await server.stop();
  });

  it('rejects a wrong token before attaching an egress client', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({
      runtime,
      port: 0,
      instanceId: 'host-auth-test',
      authToken: 'secret',
    });
    const address = await server.start();
    const socket = new WebSocket(address.url);
    const inbox = new MessageInbox();
    socket.on('message', (data) => inbox.push(decodeHostWireMessage(data.toString())));
    await waitForOpen(socket);
    socket.send(
      encodeHostWireMessage({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'desktop',
        clientVersion: 'test',
        clientId: 'wrong-token',
        lastSeq: 0,
        authToken: 'wrong',
      }),
    );
    const error = await inbox.waitFor((message) => message.type === 'error');
    expect(error).toMatchObject({ type: 'error', code: 'authentication-required' });
    socket.close();
    await server.stop();
  });

  it('rejects an Origin outside the configured loopback allowlist', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({
      runtime,
      port: 0,
      instanceId: 'host-origin-test',
      allowedOrigins: ['tauri://localhost'],
    });
    const address = await server.start();
    const socket = new WebSocket(address.url, { origin: 'http://evil.invalid' });
    const closeCode = new Promise<number>((resolve) =>
      socket.once('close', (code) => resolve(code)),
    );
    await waitForOpen(socket);
    await expect(closeCode).resolves.toBe(4009);
    await server.stop();
  });
});

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', (error) => reject(error));
  });
}

function waitForDrain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40));
}
