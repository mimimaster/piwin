import { describe, expect, it } from 'vitest';
import type { HostCommand, HostResponse, HostWireMessage, PushSink } from '@piwin/contracts';
import { WebSocket } from 'ws';
import { decodeHostWireMessage, encodeHostWireMessage } from '@piwin/host-transport';
import { HostDevicePairing } from './device-pairing.js';
import { isDirectLoopbackRequest, isLoopbackAddress } from './host-connection-origin.js';
import { HostServer, type HostRuntimePort } from './host-server.js';

class FakeRuntime implements HostRuntimePort {
  public async handleCommand(command: HostCommand): Promise<HostResponse> {
    return { type: 'response', command: command.type, success: true, data: {} };
  }
  public attachPushSink(_sink: PushSink): () => void {
    return () => undefined;
  }
  public attachBrowserFrameSink(_sink: unknown): () => void {
    return () => undefined;
  }
}

function request(remoteAddress: string | undefined, headers: Record<string, string> = {}) {
  return { socket: { remoteAddress }, headers };
}

/** Sends an anonymous hello and returns the first reply (or the close). */
async function anonymousHello(url: string, headers: Record<string, string> = {}): Promise<string> {
  const socket = new WebSocket(url, { headers });
  try {
    return await new Promise<string>((resolve, reject) => {
      socket.once('error', reject);
      socket.once('open', () => {
        socket.send(
          encodeHostWireMessage({
            type: 'client/hello',
            protocolVersion: 1,
            clientType: 'desktop',
            clientVersion: 'test',
            clientId: 'origin-test',
            lastSeq: 0,
          }),
        );
      });
      socket.on('message', (data) => {
        const message = decodeHostWireMessage(data.toString()) as HostWireMessage;
        resolve(message.type === 'error' ? `error:${message.message}` : message.type);
      });
      socket.once('close', (code) => resolve(`close:${code}`));
    });
  } finally {
    socket.terminate();
  }
}

describe('isDirectLoopbackRequest', () => {
  it('accepts only an unrelayed loopback peer', () => {
    expect(isDirectLoopbackRequest(request('127.0.0.1'))).toBe(true);
    expect(isDirectLoopbackRequest(request('::1'))).toBe(true);
    expect(isDirectLoopbackRequest(request('::ffff:127.0.0.1'))).toBe(true);
    expect(isDirectLoopbackRequest(request('192.168.1.5'))).toBe(false);
    expect(isDirectLoopbackRequest(request(undefined))).toBe(false);
    for (const header of ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'tailscale-user-login']) {
      expect(isDirectLoopbackRequest(request('127.0.0.1', { [header]: 'x' }))).toBe(false);
    }
  });

  it('recognises loopback addresses strictly', () => {
    expect(isLoopbackAddress('127.8.9.10')).toBe(true);
    expect(isLoopbackAddress('1270.0.0.1')).toBe(false);
    expect(isLoopbackAddress('::2')).toBe(false);
  });
});

describe('HostServer behind a reverse proxy', () => {
  it('admits a direct local client anonymously but not one relayed by a proxy', async () => {
    const server = new HostServer({ runtime: new FakeRuntime(), port: 0, instanceId: 'proxy-test' });
    const address = await server.start();
    try {
      expect(await anonymousHello(address.url)).toBe('host/hello');
      expect(await anonymousHello(address.url, { 'X-Forwarded-For': '203.0.113.7' })).toMatch(
        /PIWIN_HOST_TOKEN/,
      );
    } finally {
      await server.stop();
    }
  });

  it('keeps pairing and token admission working behind the proxy', async () => {
    const pairing = new HostDevicePairing();
    const server = new HostServer({
      runtime: new FakeRuntime(),
      port: 0,
      instanceId: 'proxy-pairing-test',
      devicePairing: pairing,
    });
    const address = await server.start();
    try {
      expect(await anonymousHello(address.url, { 'X-Real-IP': '203.0.113.7' })).toBe(
        'error:A paired device is required',
      );
    } finally {
      await server.stop();
    }
  });

  it('never admits a keyless hello once pairing is switched off on an exposed bind', async () => {
    const server = new HostServer({
      runtime: new FakeRuntime(),
      host: '0.0.0.0',
      port: 0,
      instanceId: 'pairing-off-test',
      devicePairing: new HostDevicePairing(),
      pairingEnabled: false,
    });
    const address = await server.start();
    try {
      expect(await anonymousHello(address.url.replace('0.0.0.0', '127.0.0.1'))).toMatch(/^error:/);
    } finally {
      await server.stop();
    }
  });
});
