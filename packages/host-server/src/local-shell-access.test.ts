import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { HostCommand, HostResponse, PushSink } from '@piwin/contracts';
import { LOCAL_SHELL_ACCESS_OPEN_COMMAND_TYPE } from '@piwin/contracts';
import { decodeHostWireMessage, encodeHostWireMessage } from '@piwin/host-transport';
import type { HostRuntimePort } from './host-server.js';
import { LocalShellAccess } from './local-shell-access.js';

class FakeRuntime implements HostRuntimePort {
  public async handleCommand(command: HostCommand): Promise<HostResponse> {
    return { type: 'response', command: command.type, success: true, data: { ok: true } };
  }
  public attachPushSink(_sink: PushSink): () => void {
    return () => undefined;
  }
  public attachBrowserFrameSink(_sink: unknown): () => void {
    return () => undefined;
  }
}

type WireMessage = { type?: string; requestId?: string; code?: string };

async function connect(endpoint: string, authToken: string | undefined) {
  const socket = new WebSocket(endpoint);
  const messages: WireMessage[] = [];
  socket.on('message', (data) => messages.push(decodeHostWireMessage(data.toString()) as WireMessage));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  socket.send(
    encodeHostWireMessage({
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'cli',
      clientVersion: 'test',
      clientId: 'local-shell-test',
      lastSeq: 0,
      ...(authToken === undefined ? {} : { authToken }),
    }),
  );
  return { socket, messages };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for Host message');
}

describe('LocalShellAccess', () => {
  let access: LocalShellAccess | undefined;

  afterEach(async () => {
    await access?.dispose();
    access = undefined;
  });

  it('listens on loopback only after the first open and reuses the entrance', async () => {
    access = new LocalShellAccess({ runtime: new FakeRuntime(), instanceId: 'local-shell' });
    const first = await access.open();
    const second = await access.open();
    expect(new URL(first.endpoint).hostname).toBe('127.0.0.1');
    expect(first.authToken.length).toBeGreaterThan(20);
    expect(second).toEqual(first);
  });

  it('admits the token it handed out and refuses anything else', async () => {
    access = new LocalShellAccess({ runtime: new FakeRuntime(), instanceId: 'local-shell' });
    const { endpoint, authToken } = await access.open();

    const admitted = await connect(endpoint, authToken);
    await waitFor(() => admitted.messages.some((message) => message.type === 'host/hello'));
    admitted.socket.close();

    for (const wrong of [undefined, 'not-the-token']) {
      const refused = await connect(endpoint, wrong);
      await waitFor(() => refused.socket.readyState === WebSocket.CLOSED || refused.messages.length > 0);
      expect(refused.messages.some((message) => message.type === 'host/hello')).toBe(false);
      refused.socket.close();
    }
  });

  it('cannot be asked for its token over the WebSocket', async () => {
    access = new LocalShellAccess({ runtime: new FakeRuntime(), instanceId: 'local-shell' });
    const { endpoint, authToken } = await access.open();
    const { socket, messages } = await connect(endpoint, authToken);
    await waitFor(() => messages.some((message) => message.type === 'host/hello'));
    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'ask-for-token',
        command: { type: LOCAL_SHELL_ACCESS_OPEN_COMMAND_TYPE } as unknown as HostCommand,
      }),
    );
    await waitFor(() =>
      messages.some(
        (message) =>
          message.type === 'error' && message.requestId === 'ask-for-token' && message.code === 'command-not-allowed',
      ),
    );
    socket.close();
  });

  it('opens a fresh entrance with a new token after dispose', async () => {
    access = new LocalShellAccess({ runtime: new FakeRuntime(), instanceId: 'local-shell' });
    const first = await access.open();
    await access.dispose();
    const second = await access.open();
    expect(second.authToken).not.toBe(first.authToken);
  });
});
