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
  public sessionListData: unknown = { sessions: [], totalCount: 0, truncated: false };
  public foregroundRun: { status: string } | null = null;
  public pendingPermissions: unknown[] = [];
  public activitySummary: unknown = { items: [], truncated: false };

  public async handleCommand(command: HostCommand): Promise<HostResponse> {
    if (command.type === 'host/ping') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: { pong: true },
      };
    }
    if (command.type === 'skills/read') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          status: 'ready',
          skillId: command.skillId ?? 'unknown',
          name: 'Executing Plans',
          effectiveSource: 'user',
          origin: 'unknown',
          displayRef: `skill:${command.skillId ?? 'unknown'}`,
          content: '# Executing Plans\n\nRemote-safe body',
          byteSize: 40,
          truncated: false,
          provenance: 'current-resource',
        },
      };
    }
    if (command.type === 'media/read') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          status: 'ready',
          assetId: command.input.assetId,
          sessionId: command.input.sessionId,
          mimeType: 'image/png',
          byteSize: 4,
          base64Data: 'AQIDBA==',
        },
      };
    }
    if (command.type === 'preview/read-trusted-text') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          status: 'ready',
          relativePath: command.input.relativePath,
          displayRef: command.input.relativePath,
          content: '# trusted\n',
          byteSize: 10,
          truncated: false,
          readOnly: true,
        },
      };
    }
    if (command.type === 'session/tool-output') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          status: 'ready',
          output: '# Snapshot body\n\nRead by the agent.',
          truncated: false,
          redacted: false,
          provenance: 'tool-snapshot',
        },
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
          generalWorkspacePath: '/Users/private/.piwin/workspace',
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
    if (command.type === 'session/list') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: this.sessionListData,
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
    if (command.type === 'session/foreground-run') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: { sessionId: command.sessionId, run: this.foregroundRun },
      };
    }
    if (command.type === 'permission/pending-list') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: { permissions: this.pendingPermissions },
      };
    }
    if (command.type === 'activity/summary') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: this.activitySummary,
      };
    }
    if (command.type === 'models/configured') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          defaultProviderId: 'custom-anthropic',
          defaultModelId: 'deepseek-v4-flash',
          models: [
            {
              providerId: 'custom-anthropic',
              protocol: 'openai-compatible',
              modelId: 'deepseek-v4-flash',
              label: 'Flash',
            },
          ],
          apiKey: 'sk-leak',
          baseUrl: 'http://127.0.0.1:8317/v1',
        },
      };
    }
    if (command.type === 'settings/get') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          root: '/Users/private/.piwin',
          snapshot: {
            schemaVersion: 2,
            revision: 'settings-revision',
            runtimeRevision: 'runtime-revision',
            domainRevisions: {},
            config: {
              hostMode: 'sdk',
              providers: [
                {
                  id: 'custom-anthropic',
                  protocol: 'openai-compatible',
                  name: 'Private provider',
                  baseUrl: 'http://127.0.0.1:8317/v1',
                  apiKeyRef: 'keychain:private',
                  headers: { Authorization: 'Bearer secret' },
                  models: [{ id: 'deepseek-v4-flash', label: 'Flash' }],
                },
              ],
              media: { maxPasteBytes: 1024, allowedMimeTypes: ['image/png'] },
              artifact: {
                enabled: true,
                triggerMode: 'automatic',
                decisionPrompt: { mode: 'default', customPrompt: '' },
                maxBytes: 1024,
              },
              subagents: {
                profiles: [],
                maxConcurrency: 4,
                maxTasksPerRun: 8,
                processIsolation: 'required',
                parallelWritePolicy: 'worktree-only',
                dirtyBasePolicy: 'ask',
              },
              desktop: {
                lastSession: {
                  sessionId: 'session-private',
                  scope: {
                    kind: 'project',
                    projectPath: '/Users/private/Projects/piwin',
                  },
                },
              },
            },
          },
        },
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
  it('serves a bounded General session/list without Host paths', async () => {
    const runtime = new FakeRuntime();
    runtime.sessionListData = {
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
      totalCount: 7,
      truncated: true,
    };
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-list-test' });
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
        clientId: 'desktop-list-test',
        lastSeq: 0,
      }),
    );
    const hello = await inbox.waitFor((message) => message.type === 'host/hello');
    expect(hello).toMatchObject({
      type: 'host/hello',
      capabilities: {
        sessionRead: true,
        sessionControl: true,
        permissionResolve: true,
      },
    });
    if (hello.type !== 'host/hello') {
      throw new Error('Expected host/hello');
    }
    expect(hello.capabilities.allowedCommands).toBeUndefined();

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'list-request',
        command: {
          type: 'session/list',
          scope: { kind: 'general' },
          order: 'alphabetical',
          maxItems: 2000,
        },
      }),
    );
    const response = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'list-request',
    );
    expect(JSON.stringify(response)).not.toContain('/Users/private');
    expect(JSON.stringify(response)).not.toContain('projectPath');
    expect(JSON.stringify(response)).not.toContain('workingDirectory');
    expect(response).toMatchObject({
      type: 'response',
      response: {
        success: true,
        data: {
          sessions: [{ sessionId: 'session-1', name: 'Remote chat', scope: 'general' }],
          totalCount: 7,
          truncated: true,
        },
      },
    });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'list-project-rejected',
        command: {
          type: 'session/list',
          scope: { kind: 'project', projectPath: '/Users/private/Projects/example' },
        },
      }),
    );
    const projectRejected = await inbox.waitFor(
      (message) => message.type === 'error' && message.requestId === 'list-project-rejected',
    );
    expect(projectRejected).toMatchObject({
      type: 'error',
      code: 'command-not-allowed',
    });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'list-max-rejected',
        command: {
          type: 'session/list',
          scope: { kind: 'general' },
          maxItems: 0,
        },
      }),
    );
    const maxRejected = await inbox.waitFor(
      (message) => message.type === 'error' && message.requestId === 'list-max-rejected',
    );
    expect(maxRejected).toMatchObject({
      type: 'error',
      code: 'command-not-allowed',
    });

    socket.close();
    await server.stop();
  });

  it('allows all-scope session/list, opaque project create, and models/configured', async () => {
    const runtime = new FakeRuntime();
    runtime.sessionListData = {
      sessions: [
        {
          id: 'session-project',
          scope: { kind: 'project', projectPath: '/Users/private/Projects/piwin' },
          workingDirectory: '/Users/private/Projects/piwin',
          projectPath: '/Users/private/Projects/piwin',
          name: 'Piwin work',
          updatedAt: '2026-08-17T00:00:00.000Z',
          messageCount: 1,
        },
      ],
      totalCount: 1,
      truncated: false,
    };
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-mobile-allow' });
    const address = await server.start();
    const socket = new WebSocket(address.url);
    const inbox = new MessageInbox();
    socket.on('message', (data) => inbox.push(decodeHostWireMessage(data.toString())));

    await waitForOpen(socket);
    socket.send(
      encodeHostWireMessage({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'mobile-allow-test',
        lastSeq: 0,
      }),
    );
    await inbox.waitFor((message) => message.type === 'host/hello');

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'list-all',
        command: { type: 'session/list', allScopes: true, maxItems: 80 },
      }),
    );
    const listAll = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'list-all',
    );
    expect(JSON.stringify(listAll)).not.toContain('/Users/private');
    expect(listAll).toMatchObject({
      type: 'response',
      response: {
        success: true,
        data: {
          sessions: [
            {
              sessionId: 'session-project',
              scope: 'project',
              projectId: expect.stringMatching(/^project-[a-f0-9]{24}$/),
            },
          ],
        },
      },
    });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'create-project',
        idempotencyKey: 'create-project-1',
        command: {
          type: 'session/create',
          input: {
            projectId: 'project-aaaaaaaaaaaaaaaaaaaaaaaa',
            sessionName: 'Mobile session',
          },
        },
      }),
    );
    const created = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'create-project',
    );
    expect(created).toMatchObject({ type: 'response', response: { success: true } });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'create-path-rejected',
        idempotencyKey: 'create-path-1',
        command: {
          type: 'session/create',
          input: {
            scope: { kind: 'project', projectPath: '/Users/private/Projects/piwin' },
          },
        },
      }),
    );
    const pathRejected = await inbox.waitFor(
      (message) => message.type === 'error' && message.requestId === 'create-path-rejected',
    );
    expect(pathRejected).toMatchObject({ type: 'error', code: 'command-not-allowed' });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'models-configured',
        command: { type: 'models/configured' },
      }),
    );
    const models = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'models-configured',
    );
    expect(JSON.stringify(models)).not.toContain('apiKey');
    expect(JSON.stringify(models)).not.toContain('8317');

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'settings-get',
        command: { type: 'settings/get' },
      }),
    );
    const settings = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'settings-get',
    );
    expect(settings).toMatchObject({
      type: 'response',
      response: {
        success: true,
        data: {
          snapshot: {
            config: {
              subagents: { maxConcurrency: 4 },
              providers: [{ id: 'custom-anthropic', models: [{ id: 'deepseek-v4-flash' }] }],
            },
          },
        },
      },
    });
    const serializedSettings = JSON.stringify(settings);
    expect(serializedSettings).not.toContain('/Users/private');
    expect(serializedSettings).not.toContain('keychain:private');
    expect(serializedSettings).not.toContain('Bearer secret');
    expect(serializedSettings).not.toContain('"root"');
    expect(serializedSettings).not.toContain('/Users/private/Projects/piwin');

    socket.close();
    await server.stop();
  });

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
    // Post-hydration fence is at snapshotSeq (= live head); the continuous
    // window from that fence must report complete:true even though the
    // pre-fence journal gap that triggered hydration was incomplete.
    expect(replayDone).toMatchObject({ type: 'replay/done', complete: true });

    socket.close();
    await server.stop();
  });

  it('sends snapshot then complete replay/done when hydration is disabled', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({
      runtime,
      port: 0,
      instanceId: 'host-snapshot-test',
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
        clientId: 'desktop-snapshot-test',
        lastSeq: 0,
        capabilities: {
          pushBatching: true,
          cursorBatches: true,
          boundedReplay: true,
          hydration: false,
        },
      }),
    );

    await inbox.waitFor((message) => message.type === 'host/hello');
    const snapshot = await inbox.waitFor((message) => message.type === 'snapshot');
    expect(snapshot).toMatchObject({
      type: 'snapshot',
      reason: 'replay-too-old',
    });
    const replayDone = await inbox.waitFor((message) => message.type === 'replay/done');
    expect(replayDone).toMatchObject({ type: 'replay/done', complete: true });

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
        idempotencyKey: 'prompt-media-1',
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
          foreground: { kind: 'if-idle' },
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

  it('rejects a path-free prompt attachment with the same requestId', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-media-reject-test' });
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
        clientId: 'desktop-media-reject',
        lastSeq: 0,
      }),
    );
    await inbox.waitFor((message) => message.type === 'host/hello');

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'prompt-missing-path',
        idempotencyKey: 'prompt-missing-path-1',
        command: {
          type: 'session/prompt',
          id: 'prompt-missing-path',
          sessionId: 'session-1',
          input: {
            text: 'inspect this image',
            attachments: [
              {
                id: 'asset-1',
                kind: 'media',
                mimeType: 'image/png',
                byteSize: 4,
                source: 'paste',
              } as never,
            ],
          },
          foreground: { kind: 'if-idle' },
        },
      }),
    );
    const rejected = await inbox.waitFor(
      (message) =>
        (message.type === 'error' || message.type === 'response') &&
        message.requestId === 'prompt-missing-path',
    );
    expect(rejected).toMatchObject({
      type: 'error',
      requestId: 'prompt-missing-path',
      code: 'command-not-allowed',
    });
    expect(runtime.lastPrompt).toBeUndefined();

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

  it('serves remote-safe skills/read and tool-output snapshots', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-skill-read-test' });
    const address = await server.start();
    const socket = new WebSocket(address.url);
    const inbox = new MessageInbox();
    socket.on('message', (data) => inbox.push(decodeHostWireMessage(data.toString())));
    await waitForOpen(socket);
    socket.send(
      encodeHostWireMessage({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'mobile-skill-read-test',
        lastSeq: 0,
      }),
    );
    const hello = await inbox.waitFor((message) => message.type === 'host/hello');
    expect(hello).toMatchObject({
      type: 'host/hello',
      capabilities: { skillPreview: true, toolOutputRead: true },
    });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'skill-read-request',
        command: { type: 'skills/read', id: 'skill-read-request', skillId: 'executing-plans' },
      }),
    );
    const skillResponse = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'skill-read-request',
    );
    expect(JSON.stringify(skillResponse)).not.toContain('/Users/private');
    expect(skillResponse).toMatchObject({
      type: 'response',
      response: {
        success: true,
        data: {
          status: 'ready',
          skillId: 'executing-plans',
          displayRef: 'skill:executing-plans',
          provenance: 'current-resource',
        },
      },
    });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'tool-output-request',
        command: {
          type: 'session/tool-output',
          id: 'tool-output-request',
          sessionId: 'session-1',
          messageId: 'message-1',
          toolCallId: 'tc-1',
        },
      }),
    );
    const toolOutputResponse = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'tool-output-request',
    );
    expect(JSON.stringify(toolOutputResponse)).not.toContain('/Users/private');
    expect(toolOutputResponse).toMatchObject({
      type: 'response',
      response: {
        success: true,
        data: {
          status: 'ready',
          provenance: 'tool-snapshot',
          output: expect.stringContaining('Read by the agent'),
        },
      },
    });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'skill-legacy-rejected',
        command: {
          type: 'skills/read',
          id: 'skill-legacy-rejected',
          legacyPath: '/Users/private/.piwin/skills/executing-plans/SKILL.md',
        },
      }),
    );
    const rejected = await inbox.waitFor(
      (message) => message.type === 'error' && message.requestId === 'skill-legacy-rejected',
    );
    expect(rejected).toMatchObject({
      type: 'error',
      code: 'command-not-allowed',
    });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'ingest-local-rejected',
        command: {
          type: 'preview/read-local-file',
          id: 'ingest-local-rejected',
          input: { sessionId: 'session-1', absolutePath: '/tmp/ncg-boot2.png' },
        },
      }),
    );
    const ingestRejected = await inbox.waitFor(
      (message) => message.type === 'error' && message.requestId === 'ingest-local-rejected',
    );
    expect(ingestRejected).toMatchObject({
      type: 'error',
      code: 'command-not-allowed',
    });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'export-local-rejected',
        command: {
          type: 'preview/export-local-file',
          id: 'export-local-rejected',
          input: { absolutePath: '/tmp/out.zip' },
        },
      }),
    );
    const exportRejected = await inbox.waitFor(
      (message) => message.type === 'error' && message.requestId === 'export-local-rejected',
    );
    expect(exportRejected).toMatchObject({
      type: 'error',
      code: 'command-not-allowed',
    });

    socket.close();
    await server.stop();
  });

  it('serves media/read by logical id and rejects traversal ids (ADR 0052)', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-media-read-test' });
    const address = await server.start();
    const socket = new WebSocket(address.url);
    const inbox = new MessageInbox();
    socket.on('message', (data) => inbox.push(decodeHostWireMessage(data.toString())));
    await waitForOpen(socket);
    socket.send(
      encodeHostWireMessage({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'mobile-media-read-test',
        lastSeq: 0,
      }),
    );
    await inbox.waitFor((message) => message.type === 'host/hello');

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'media-read-request',
        command: {
          type: 'media/read',
          id: 'media-read-request',
          input: { sessionId: 'session-1', assetId: 'asset-42' },
        },
      }),
    );
    const mediaRead = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'media-read-request',
    );
    // base64 bytes pass through untouched; no host path is present.
    expect(JSON.stringify(mediaRead)).not.toContain('/Users/private');
    expect(mediaRead).toMatchObject({
      type: 'response',
      response: { success: true, data: { status: 'ready', mimeType: 'image/png' } },
    });

    // Traversal-shaped ids must not reach the runtime.
    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'media-read-traversal',
        command: {
          type: 'media/read',
          id: 'media-read-traversal',
          input: { sessionId: '..', assetId: 'id_rsa' },
        },
      }),
    );
    const rejected = await inbox.waitFor(
      (message) => message.type === 'error' && message.requestId === 'media-read-traversal',
    );
    expect(rejected).toMatchObject({ type: 'error', code: 'command-not-allowed' });

    socket.close();
    await server.stop();
  });

  it('serves preview/read-trusted-text by relative path and rejects traversal or media vault', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-trusted-text-test' });
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
        clientId: 'desktop-trusted-text-test',
        lastSeq: 0,
      }),
    );
    await inbox.waitFor((message) => message.type === 'host/hello');

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'trusted-ok',
        command: {
          type: 'preview/read-trusted-text',
          input: { relativePath: 'config.json' },
        },
      }),
    );
    const trustedOk = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'trusted-ok',
    );
    expect(JSON.stringify(trustedOk)).not.toContain('/Users/private');
    expect(trustedOk).toMatchObject({
      type: 'response',
      response: {
        success: true,
        data: { status: 'ready', relativePath: 'config.json', readOnly: true },
      },
    });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'trusted-traversal',
        command: {
          type: 'preview/read-trusted-text',
          input: { relativePath: '../etc/passwd' },
        },
      }),
    );
    const traversal = await inbox.waitFor(
      (message) => message.type === 'error' && message.requestId === 'trusted-traversal',
    );
    expect(traversal).toMatchObject({ type: 'error', code: 'command-not-allowed' });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'trusted-media',
        command: {
          type: 'preview/read-trusted-text',
          input: { relativePath: 'media/sess-1/a.png' },
        },
      }),
    );
    const mediaDenied = await inbox.waitFor(
      (message) => message.type === 'error' && message.requestId === 'trusted-media',
    );
    expect(mediaDenied).toMatchObject({ type: 'error', code: 'command-not-allowed' });

    socket.close();
    await server.stop();
  });

  it('admits remote extension activation by default for the operator shell', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-ext-deny-test' });
    const address = await server.start();
    const socket = new WebSocket(address.url);
    const inbox = new MessageInbox();
    socket.on('message', (data) => inbox.push(decodeHostWireMessage(data.toString())));
    await waitForOpen(socket);
    socket.send(
      encodeHostWireMessage({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'mobile-ext-deny-test',
        lastSeq: 0,
      }),
    );
    await inbox.waitFor((message) => message.type === 'host/hello');

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'ext-enable-denied',
        command: {
          type: 'extensions/set_enabled',
          id: 'ext-enable-denied',
          extensionId: 'demo',
          enabled: true,
        },
      }),
    );
    const enableDenied = await inbox.waitFor(
      (message) =>
        (message.type === 'response' || message.type === 'error') &&
        message.requestId === 'ext-enable-denied',
    );
    expect(enableDenied).toMatchObject({ type: 'response' });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'ext-apply-denied',
        command: {
          type: 'extensions/apply',
          id: 'ext-apply-denied',
          sessionId: 'session-1',
          when: 'now',
        },
      }),
    );
    const applyDenied = await inbox.waitFor(
      (message) =>
        (message.type === 'response' || message.type === 'error') &&
        message.requestId === 'ext-apply-denied',
    );
    expect(applyDenied).toMatchObject({ type: 'response' });

    // Observation stays allowed: all clients may read the shared registry.
    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'ext-list-allowed',
        command: { type: 'extensions/list', id: 'ext-list-allowed' },
      }),
    );
    const listAllowed = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'ext-list-allowed',
    );
    expect(listAllowed).toMatchObject({ type: 'response' });

    socket.close();
    await server.stop();
  });

  it('allows remote extension activation only with the explicit opt-in', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({
      runtime,
      port: 0,
      instanceId: 'host-ext-optin-test',
      allowRemoteExtensionActivation: true,
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
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'mobile-ext-optin-test',
        lastSeq: 0,
      }),
    );
    await inbox.waitFor((message) => message.type === 'host/hello');

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'ext-enable-allowed',
        command: {
          type: 'extensions/set_enabled',
          id: 'ext-enable-allowed',
          extensionId: 'demo',
          enabled: true,
        },
      }),
    );
    const enableAllowed = await inbox.waitFor(
      (message) =>
        (message.type === 'response' || message.type === 'error') &&
        message.requestId === 'ext-enable-allowed',
    );
    expect(enableAllowed).toMatchObject({ type: 'response' });

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

  it('rejects a non-loopback Origin when no allowlist is configured', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({
      runtime,
      port: 0,
      instanceId: 'host-origin-default-test',
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

  it('rejects a remote session/prompt that omits foreground admission', async () => {
    const runtime = new FakeRuntime();
    runtime.foregroundRun = { status: 'running' };
    const server = new HostServer({
      runtime,
      port: 0,
      instanceId: 'host-prompt-idle-test',
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
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'mobile-prompt-idle-test',
        lastSeq: 0,
      }),
    );
    await inbox.waitFor((message) => message.type === 'host/hello');
    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'busy-prompt',
        command: {
          type: 'session/prompt',
          sessionId: 'session-1',
          input: { text: 'hello' },
        },
      }),
    );
    const busy = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'busy-prompt',
    );
    expect(busy).toMatchObject({
      type: 'response',
      response: { success: false },
    });
    expect(runtime.lastPrompt).toBeUndefined();
    socket.close();
    await server.stop();
  });

  it('admits a remote session/prompt that carries a transcript selection', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({
      runtime,
      port: 0,
      instanceId: 'host-prompt-selection-test',
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
        clientId: 'desktop-prompt-selection-test',
        lastSeq: 0,
      }),
    );
    await inbox.waitFor((message) => message.type === 'host/hello');
    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'selection-prompt',
        idempotencyKey: 'selection-1',
        command: {
          type: 'session/prompt',
          sessionId: 'session-1',
          input: {
            text: '我选中了啥发给你',
            contextRefs: [
              {
                kind: 'selection',
                snapshotText: '已完全对齐仓库现状与架构约束。',
                label: '已完全对齐仓库现状与架…',
              },
            ],
          },
          foreground: { kind: 'if-idle' },
        },
      }),
    );
    const admitted = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'selection-prompt',
    );
    expect(admitted).toMatchObject({
      type: 'response',
      response: { success: true },
    });
    expect(runtime.lastPrompt).toMatchObject({
      type: 'session/prompt',
      input: { text: '我选中了啥发给你' },
    });
    socket.close();
    await server.stop();
  });

  it('serves activity/summary without Host paths and rejects oversized pages', async () => {
    const runtime = new FakeRuntime();
    runtime.activitySummary = {
      items: [
        {
          sessionId: 'session-1',
          runId: 'run-1',
          status: 'running',
          pendingPermission: true,
          permissionRequestId: 'perm-1',
          permissionAction: 'bash',
          detail: 'rm -rf /Users/private/secret',
          projectPath: '/Users/private/Projects/piwin',
          cwd: '/Users/private',
        },
      ],
      truncated: false,
      workingDirectory: '/Users/private/General',
    };
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-activity-summary' });
    const address = await server.start();
    const socket = new WebSocket(address.url);
    const inbox = new MessageInbox();
    socket.on('message', (data) => inbox.push(decodeHostWireMessage(data.toString())));
    await waitForOpen(socket);
    socket.send(
      encodeHostWireMessage({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'mobile-activity-summary',
        lastSeq: 0,
      }),
    );
    await inbox.waitFor((message) => message.type === 'host/hello');

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'activity-request',
        command: { type: 'activity/summary' },
      }),
    );
    const response = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'activity-request',
    );
    expect(JSON.stringify(response)).not.toContain('/Users/private');
    expect(JSON.stringify(response)).not.toContain('projectPath');
    expect(JSON.stringify(response)).not.toContain('detail');
    expect(response).toMatchObject({
      type: 'response',
      response: {
        success: true,
        data: {
          items: [
            {
              sessionId: 'session-1',
              runId: 'run-1',
              status: 'running',
              pendingPermission: true,
              permissionRequestId: 'perm-1',
              permissionAction: 'bash',
            },
          ],
          truncated: false,
        },
      },
    });

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'activity-too-large',
        command: { type: 'activity/summary', maxItems: 65 },
      }),
    );
    const rejected = await inbox.waitFor(
      (message) => message.type === 'error' && message.requestId === 'activity-too-large',
    );
    expect(rejected).toMatchObject({
      type: 'error',
      code: 'command-not-allowed',
    });

    socket.close();
    await server.stop();
  });

  it('answers host/ping without waiting on a slow runtime command', async () => {
    let releaseStatus: () => void = () => undefined;
    const statusGate = new Promise<void>((resolve) => {
      releaseStatus = resolve;
    });
    const runtime = new FakeRuntime();
    const original = runtime.handleCommand.bind(runtime);
    runtime.handleCommand = async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'host/status') {
        await statusGate;
        return {
          type: 'response',
          command: 'host/status',
          success: true,
          data: { ready: true, mode: 'sdk', mock: false },
        };
      }
      return original(command);
    };
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-ping-fast' });
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
        clientId: 'desktop-ping-fast',
        lastSeq: 0,
      }),
    );
    await inbox.waitFor((message) => message.type === 'host/hello');

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'status-blocked',
        command: { type: 'host/status' },
      }),
    );
    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'ping-live',
        command: { type: 'host/ping' },
      }),
    );
    const ping = await inbox.waitFor(
      (message) => message.type === 'response' && message.requestId === 'ping-live',
    );
    expect(ping).toMatchObject({
      type: 'response',
      response: { command: 'host/ping', success: true, data: { pong: true } },
    });
    releaseStatus();
    socket.close();
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
