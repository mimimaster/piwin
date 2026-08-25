import { describe, expect, it } from 'vitest';
import type { HostCommand, HostResponse, PushSink } from '@piwin/contracts';
import { HostDevicePairing } from './device-pairing.js';
import { HostServer, type HostRuntimePort } from './host-server.js';
import { MobileAccessController } from './mobile-access-controller.js';

class FakeRuntime implements HostRuntimePort {
  public commands: HostCommand[] = [];

  public async handleCommand(command: HostCommand): Promise<HostResponse> {
    this.commands.push(command);
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

function createController(runtime = new FakeRuntime()) {
  const pairing = new HostDevicePairing();
  const controller = new MobileAccessController({
    runtime,
    pairing,
    instanceId: 'sidecar-mobile-access',
    bindHost: '127.0.0.1',
    bindPort: 0,
  });
  return { runtime, pairing, controller };
}

describe('MobileAccessController', () => {
  it('starts, mints pairing codes, and keeps hostInstanceId across stop/start', async () => {
    const { controller, runtime } = createController();
    try {
      const started = await controller.handle({
        type: 'mobile-access/start',
        profileId: 'loopback',
        advertisedEndpoint: 'ws://127.0.0.1:9',
      });
      expect(started.success).toBe(true);
      if (!started.success) {
        throw new Error(started.error);
      }
      const startedData = started.data as { hostInstanceId?: string; listening?: boolean };
      expect(startedData.listening).toBe(true);
      const instanceId = startedData.hostInstanceId;
      expect(instanceId).toBe('sidecar-mobile-access');

      const first = await controller.handle({ type: 'mobile-access/create-pairing-code' });
      expect(first.success).toBe(true);
      if (!first.success) {
        throw new Error(first.error);
      }
      const firstCode = first.data as { pairingToken: string; uri: string };
      expect(firstCode.uri.startsWith('piwin://pair?')).toBe(true);

      const second = await controller.handle({ type: 'mobile-access/create-pairing-code' });
      expect(second.success).toBe(true);
      if (!second.success) {
        throw new Error(second.error);
      }
      const secondCode = second.data as { pairingToken: string };
      expect(secondCode.pairingToken).not.toBe(firstCode.pairingToken);

      await controller.handle({ type: 'mobile-access/stop' });
      const restarted = await controller.handle({
        type: 'mobile-access/start',
        profileId: 'loopback',
      });
      expect(restarted.success).toBe(true);
      if (!restarted.success) {
        throw new Error(restarted.error);
      }
      const restartedId = (restarted.data as { hostInstanceId?: string }).hostInstanceId;
      expect(restartedId).toBe(instanceId);
      expect(runtime.commands).toEqual([]);
    } finally {
      await controller.dispose();
    }
  });

  it('lists and revokes devices without projecting secret hashes', async () => {
    const { controller, pairing } = createController();
    try {
      const completion = pairing.completePairing(pairing.mintToken().token, 'iPhone');
      const listed = await controller.handle({ type: 'mobile-access/list-devices' });
      expect(listed.success).toBe(true);
      if (!listed.success) {
        throw new Error(listed.error);
      }
      expect(JSON.stringify(listed.data)).not.toContain(completion.credential.deviceSecret);
      expect(JSON.stringify(listed.data)).not.toContain('secretHash');
      expect(listed.data).toMatchObject({
        devices: [{ id: completion.device.id, name: 'iPhone', revoked: false }],
      });

      const revoked = await controller.handle({
        type: 'mobile-access/revoke-device',
        deviceId: completion.device.id,
      });
      expect(revoked).toMatchObject({ success: true, data: { revoked: true } });
      expect(pairing.authenticate(completion.credential)).toBeUndefined();
    } finally {
      await controller.dispose();
    }
  });

  it('rejects unsupported profiles and pairing codes while stopped', async () => {
    const { controller } = createController();
    const unsupported = await controller.handle({
      type: 'mobile-access/start',
      profileId: 'lan',
    });
    expect(unsupported.success).toBe(false);
    if (unsupported.success) {
      throw new Error('expected unsupported profile to fail');
    }
    expect(unsupported.error).toMatch(/Unsupported phone-access profile/);

    const pairing = await controller.handle({ type: 'mobile-access/create-pairing-code' });
    expect(pairing.success).toBe(false);
  });
});

describe('HostServer remote allowlist', () => {
  it('rejects phone-access listen commands on the Host WebSocket', async () => {
    const server = new HostServer({
      runtime: new FakeRuntime(),
      port: 0,
      instanceId: 'host-deny-mobile-access',
    });
    const address = await server.start();
    const { WebSocket } = await import('ws');
    const { decodeHostWireMessage, encodeHostWireMessage } = await import('@piwin/host-transport');
    const socket = new WebSocket(address.url);
    const messages: unknown[] = [];
    socket.on('message', (data) => {
      messages.push(decodeHostWireMessage(data.toString()));
    });
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
        clientId: 'remote-deny-mobile-access',
        lastSeq: 0,
      }),
    );
    await waitFor(() => messages.some(isHello));

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'mobile-access-denied',
        command: { type: 'mobile-access/start', profileId: 'loopback' } as unknown as HostCommand,
      }),
    );
    await waitFor(
      () =>
        messages.some(
          (message) =>
            isError(message) && message.requestId === 'mobile-access-denied' && message.code === 'command-not-allowed',
        ),
    );

    socket.close();
    await server.stop();
  });
});

function isHello(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { type?: string }).type === 'host/hello';
}

function isError(value: unknown): value is { type: 'error'; requestId?: string; code?: string } {
  return typeof value === 'object' && value !== null && (value as { type?: string }).type === 'error';
}

async function waitFor(predicate: (messages?: unknown) => boolean): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for Host message');
}
