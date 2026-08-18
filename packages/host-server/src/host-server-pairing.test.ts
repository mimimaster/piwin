import { describe, expect, it } from 'vitest';
import type { HostCommand, HostResponse, HostWireMessage, PushSink } from '@piwin/contracts';
import { WebSocket } from 'ws';
import { decodeHostWireMessage, encodeHostWireMessage } from '@piwin/host-transport';
import { HostDevicePairing } from './device-pairing.js';
import { HostServer, type HostRuntimePort } from './host-server.js';

class FakeRuntime implements HostRuntimePort {
  public async handleCommand(command: HostCommand): Promise<HostResponse> {
    if (command.type === 'host/status') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          mode: 'sdk',
          ready: true,
          mock: true,
          piwinRoot: '/tmp/piwin',
          activeSessionIds: [],
          capabilities: {},
        },
      };
    }
    return {
      type: 'response',
      command: command.type,
      success: true,
      data: { ok: true },
    };
  }

  public attachPushSink(_sink: PushSink): () => void {
    return () => undefined;
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

describe('HostServer pairing admission', () => {
  it('rejects a non-loopback bind without a door token or pairing store', async () => {
    const server = new HostServer({
      runtime: new FakeRuntime(),
      host: '10.0.0.1',
      port: 0,
      instanceId: 'host-pairing-guard',
    });
    await expect(server.start()).rejects.toThrow('auth token or device pairing');
  });

  it('enrolls once, reconnects with the issued secret, and still denies secrets/get', async () => {
    const pairing = new HostDevicePairing();
    const minted = pairing.mintToken();
    const runtime = new FakeRuntime();
    const serverErrors: string[] = [];
    const server = new HostServer({
      runtime,
      port: 0,
      instanceId: 'host-pairing-hello',
      devicePairing: pairing,
      onError: (error) => {
        serverErrors.push(error.message);
      },
    });
    const address = await server.start();

    const firstSocket = new WebSocket(address.url);
    const firstInbox = new MessageInbox();
    firstSocket.on('message', (data) => {
      try {
        firstInbox.push(decodeHostWireMessage(data.toString()));
      } catch (error) {
        firstInbox.push({
          type: 'error',
          code: 'bad-message',
          message: error instanceof Error ? error.message : 'decode failed',
        });
      }
    });
    await waitForOpen(firstSocket);
    firstSocket.send(
      encodeHostWireMessage({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'phone-enroll',
        lastSeq: 0,
        pairingToken: minted.token,
        deviceName: 'iPhone',
      }),
    );
    const firstHello = await firstInbox.waitFor((message) => message.type === 'host/hello');
    expect(serverErrors).toEqual([]);
    expect(firstHello).toMatchObject({
      type: 'host/hello',
      authenticated: true,
      authRequired: true,
    });
    if (firstHello.type !== 'host/hello') {
      throw new Error('expected host/hello');
    }
    expect(firstHello.deviceId).toEqual(expect.any(String));
    expect(firstHello.deviceSecret).toEqual(expect.any(String));
    const deviceId = firstHello.deviceId ?? '';
    const deviceSecret = firstHello.deviceSecret ?? '';

    firstSocket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'secrets-denied',
        command: { type: 'secrets/get', providerId: 'openai' },
      }),
    );
    const denied = await firstInbox.waitFor(
      (message) => message.type === 'error' && message.requestId === 'secrets-denied',
    );
    expect(denied).toMatchObject({ type: 'error', code: 'command-not-allowed' });
    firstSocket.close();

    const replay = await openHello(address.url, {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'mobile',
      clientVersion: 'test',
      clientId: 'phone-replay',
      lastSeq: 0,
      pairingToken: minted.token,
    });
    expect(replay.hello).toMatchObject({ type: 'error', code: 'authentication-required' });
    replay.socket.close();

    const mixed = await openHello(address.url, {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'mobile',
      clientVersion: 'test',
      clientId: 'phone-mixed',
      lastSeq: 0,
      pairingToken: pairing.mintToken().token,
      authToken: 'door',
    });
    expect(mixed.hello).toMatchObject({ type: 'error', code: 'authentication-required' });
    mixed.socket.close();

    const reconnect = await openHello(address.url, {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'mobile',
      clientVersion: 'test',
      clientId: 'phone-reconnect',
      lastSeq: 0,
      deviceCredential: { deviceId, deviceSecret },
    });
    expect(reconnect.hello).toMatchObject({
      type: 'host/hello',
      authenticated: true,
      deviceId,
    });
    if (reconnect.hello.type !== 'host/hello') {
      throw new Error('expected host/hello');
    }
    expect(reconnect.hello.deviceSecret).toBeUndefined();
    reconnect.socket.close();
    await server.stop();
  });

  it('still admits an anonymous loopback hello when pairing is enabled', async () => {
    const server = new HostServer({
      runtime: new FakeRuntime(),
      port: 0,
      instanceId: 'host-pairing-loopback',
      devicePairing: new HostDevicePairing(),
    });
    const address = await server.start();
    const session = await openHello(address.url, {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'cli',
      clientVersion: 'test',
      clientId: 'loopback-anon',
      lastSeq: 0,
    });
    expect(session.hello).toMatchObject({ type: 'host/hello', authenticated: true });
    session.socket.close();
    await server.stop();
  });
});

async function openHello(
  url: string,
  hello: Extract<HostWireMessage, { type: 'client/hello' }>,
): Promise<{ socket: WebSocket; inbox: MessageInbox; hello: HostWireMessage }> {
  const socket = new WebSocket(url);
  const inbox = new MessageInbox();
  socket.on('message', (data) => inbox.push(decodeHostWireMessage(data.toString())));
  await waitForOpen(socket);
  socket.send(encodeHostWireMessage(hello));
  const message = await inbox.waitFor(
    (item) => item.type === 'host/hello' || item.type === 'error',
  );
  return { socket, inbox, hello: message };
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', (error) => reject(error));
  });
}
