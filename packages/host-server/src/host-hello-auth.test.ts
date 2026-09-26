import { describe, expect, it } from 'vitest';
import { HostDevicePairing } from './device-pairing.js';
import { authenticateHostHello } from './host-hello-auth.js';
import { assertPairingEndpointIsDialable, createPairingQrPayload } from './pairing-qr.js';

function tokensEqual(expected: string, provided: string | undefined): boolean {
  return provided === expected;
}

describe('authenticateHostHello', () => {
  it('consumes a pairing token once and rolls back when persist fails', async () => {
    const pairing = new HostDevicePairing();
    const token = pairing.mintToken();
    const failed = await authenticateHostHello(
      {
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'phone',
        lastSeq: 0,
        pairingToken: token.token,
        deviceName: 'iPhone',
      },
      {
        authToken: undefined,
        devicePairing: pairing,
        allowAnonymousHello: false,
        persistEnrollment: async () => {
          throw new Error('disk full');
        },
        tokensEqual,
      },
    );
    expect(failed.ok).toBe(false);
    expect(pairing.completePairing(token.token, 'iPhone').device.name).toBe('iPhone');
  });

  it('keeps one device record when the same phone re-pairs', async () => {
    const pairing = new HostDevicePairing();
    const context = {
      authToken: undefined,
      devicePairing: pairing,
      allowAnonymousHello: false,
      persistEnrollment: async () => undefined,
      tokensEqual,
    };
    const hello = {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'mobile',
      clientVersion: 'test',
      clientId: 'phone-install',
      lastSeq: 0,
      deviceName: 'Piwin mobile',
    } as const;
    const first = await authenticateHostHello({ ...hello, pairingToken: pairing.mintToken().token }, context);
    const second = await authenticateHostHello({ ...hello, pairingToken: pairing.mintToken().token }, context);

    expect(first.ok && second.ok).toBe(true);
    expect(pairing.list()).toHaveLength(1);
    expect(pairing.list()[0]).toMatchObject({ clientId: 'phone-install', name: 'Piwin mobile' });
  });

  it('rejects pairing plus door token together', async () => {
    const pairing = new HostDevicePairing();
    const token = pairing.mintToken();
    const result = await authenticateHostHello(
      {
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'phone',
        lastSeq: 0,
        pairingToken: token.token,
        authToken: 'door',
      },
      {
        authToken: 'door',
        devicePairing: pairing,
        allowAnonymousHello: false,
        persistEnrollment: async () => undefined,
        tokensEqual,
      },
    );
    expect(result).toEqual({ ok: false, message: 'Hello must present exactly one admission key' });
  });

  it('authenticates a previously issued device credential', async () => {
    const pairing = new HostDevicePairing();
    const completion = pairing.completePairing(pairing.mintToken().token, 'iPhone');
    const result = await authenticateHostHello(
      {
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'phone',
        lastSeq: 0,
        deviceCredential: completion.credential,
      },
      {
        authToken: 'door',
        devicePairing: pairing,
        allowAnonymousHello: false,
        persistEnrollment: async () => undefined,
        tokensEqual,
      },
    );
    expect(result).toEqual({
      ok: true,
      pairedDeviceId: completion.credential.deviceId,
    });
  });
});

describe('pairing QR', () => {
  it('refuses a wildcard or malformed QR endpoint', () => {
    expect(() => assertPairingEndpointIsDialable('ws://0.0.0.0:8787')).toThrow('wildcard');
    expect(() => assertPairingEndpointIsDialable('ws://[::]:8787')).toThrow('wildcard');
    expect(() => assertPairingEndpointIsDialable('not a url')).toThrow('valid URL');
    expect(() => assertPairingEndpointIsDialable('ws://192.168.1.5:8787')).not.toThrow();
  });

  it('builds a v1 payload without a door token field', () => {
    const payload = createPairingQrPayload({
      advertisedEndpoint: 'wss://mac.ts.net:8787',
      pairingToken: 'abc',
      hostInstanceId: 'host-1',
      expiresAt: 1,
    });
    expect(payload).toMatchObject({ v: 1, pairingToken: 'abc' });
    expect(payload).not.toHaveProperty('token');
  });
});
