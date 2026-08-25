import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostCommand, HostResponse, HostWireMessage, PushSink } from '@piwin/contracts';
import {
  APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
  type ClientToolRequestFrame,
} from '@piwin/contracts';
import { WebSocket } from 'ws';
import { decodeHostWireMessage, encodeHostWireMessage } from '@piwin/host-transport';
import { HostDevicePairing } from './device-pairing.js';
import { DeviceCapabilityRegistry } from './device-capability-registry.js';
import { DeviceCapabilityStore } from './device-capability-store.js';
import { DeviceToolBroker } from './device-tool-broker.js';
import { HostServer, type HostRuntimePort } from './host-server.js';

const SENTINEL = 424242;
const DISPLAY = {
  title: '读取 Apple Health' as const,
  metricLabels: ['步数'],
  periodLabel: '今天',
  explicitTurnIntent: false,
};

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

  public snapshot(): HostWireMessage[] {
    return [...this.messages];
  }
}

describe('HostServer client-tool routing', () => {
  it('delivers one targeted request to the paired device and never fans out or replays it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-client-tool-'));
    const pairing = new HostDevicePairing();
    const minted = pairing.mintToken();
    const logs: string[] = [];
    const events: string[] = [];
    const registry = new DeviceCapabilityRegistry({
      store: new DeviceCapabilityStore(join(directory, 'capabilities.json')),
    });
    await registry.load();
    const broker = new DeviceToolBroker({
      registry,
      logger: (event) => {
        logs.push(JSON.stringify(event));
      },
    });
    const server = new HostServer({
      runtime: new FakeRuntime(),
      port: 0,
      instanceId: 'host-client-tool',
      devicePairing: pairing,
      clientToolBroker: broker,
      onError: (error) => {
        logs.push(error.message);
      },
      onConnectionEvent: (event) => {
        events.push(JSON.stringify(event));
      },
    });
    const address = await server.start();

    const phone = await openHello(address.url, {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'mobile',
      clientVersion: 'test',
      clientId: 'phone-health',
      lastSeq: 0,
      pairingToken: minted.token,
      deviceName: 'iPhone',
      capabilities: {
        hydration: true,
        clientTools: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
      },
    });
    expect(phone.hello).toMatchObject({
      type: 'host/hello',
      capabilities: { clientToolRequests: true },
    });
    if (phone.hello.type !== 'host/hello') {
      throw new Error('expected host/hello');
    }
    const deviceId = phone.hello.deviceId ?? '';
    const deviceSecret = phone.hello.deviceSecret ?? '';

    const shell = await openHello(address.url, {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'desktop',
      clientVersion: 'test',
      clientId: 'desktop-shell',
      lastSeq: 0,
    });
    expect(shell.hello.type).toBe('host/hello');

    const execution = broker.execute(
      {
        capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
        sessionId: 'session-1',
        runId: 'run-1',
        toolCallId: 'tool-1',
        arguments: { metrics: ['steps'], sentinel: SENTINEL },
        deadlineMs: 5_000,
        display: DISPLAY,
      },
      new AbortController().signal,
    );

    const request = await phone.inbox.waitFor((message) => message.type === 'client-tool/request');
    expect(request.type).toBe('client-tool/request');
    if (request.type !== 'client-tool/request') {
      throw new Error('expected request');
    }
    await delay(150);
    expect(shell.inbox.snapshot().some((message) => message.type.startsWith('client-tool/'))).toBe(
      false,
    );

    phone.socket.send(
      encodeHostWireMessage({
        type: 'client-tool/result',
        requestId: request.requestId,
        status: 'success',
        completedAt: new Date().toISOString(),
        result: { schemaVersion: 1, steps: SENTINEL },
      }),
    );
    await expect(execution).resolves.toMatchObject({ ok: true, deviceId });

    phone.socket.close();
    const replay = await openHello(address.url, {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'mobile',
      clientVersion: 'test',
      clientId: 'phone-replay',
      lastSeq: 0,
      deviceCredential: { deviceId, deviceSecret },
      capabilities: {
        hydration: true,
        boundedReplay: true,
        clientTools: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
      },
    });
    await delay(200);
    const replayed = [replay.hello, ...replay.inbox.snapshot()];
    expect(replayed.some((message) => isClientToolFrame(message))).toBe(false);

    expect(logs.join('\n')).not.toContain(String(SENTINEL));
    expect(events.join('\n')).not.toContain(String(SENTINEL));

    replay.socket.close();
    shell.socket.close();
    await server.stop();
    await broker.flush();
    await rm(directory, { recursive: true, force: true });
  });

  it('refuses anonymous and door-token clients as health executors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-client-tool-anon-'));
    const registry = new DeviceCapabilityRegistry({
      store: new DeviceCapabilityStore(join(directory, 'capabilities.json')),
    });
    await registry.load();
    const broker = new DeviceToolBroker({ registry });
    const server = new HostServer({
      runtime: new FakeRuntime(),
      port: 0,
      instanceId: 'host-client-tool-anon',
      authToken: 'door-token',
      clientToolBroker: broker,
    });
    const address = await server.start();
    const door = await openHello(address.url, {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'mobile',
      clientVersion: 'test',
      clientId: 'door-phone',
      lastSeq: 0,
      authToken: 'door-token',
      capabilities: {
        clientTools: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
      },
    });
    expect(door.hello.type).toBe('host/hello');
    await expect(
      broker.execute(
        {
          capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
          sessionId: 'session-1',
          runId: 'run-1',
          toolCallId: 'tool-1',
          arguments: { sentinel: SENTINEL },
          deadlineMs: 1_000,
          display: DISPLAY,
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ ok: false, reason: 'client-device-unavailable' });
    door.socket.close();
    await server.stop();
    await broker.flush();
    await rm(directory, { recursive: true, force: true });
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isClientToolFrame(message: HostWireMessage): boolean {
  return message.type.startsWith('client-tool/');
}

function isClientToolRequest(message: HostWireMessage): message is ClientToolRequestFrame {
  return message.type === 'client-tool/request';
}

void isClientToolRequest;
