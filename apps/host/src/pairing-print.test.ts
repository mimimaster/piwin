import { describe, expect, it } from 'vitest';
import { createHostPairingAnnouncement, resolveAdvertisedEndpoint } from './pairing-print.js';

describe('host pairing print', () => {
  it('prefers an advertised URL over the bind address', () => {
    expect(resolveAdvertisedEndpoint('wss://mac.ts.net:8787', 'ws://127.0.0.1:8787')).toBe(
      'wss://mac.ts.net:8787',
    );
    expect(resolveAdvertisedEndpoint('  ', 'ws://127.0.0.1:8787')).toBe('ws://127.0.0.1:8787');
  });

  it('prints v2 JSON and a pairing URI without a door token', () => {
    const printed = createHostPairingAnnouncement({
      advertisedEndpoint: 'wss://mac.ts.net:8787',
      pairingToken: 'one-time',
      hostInstanceId: 'host-1',
      expiresAt: 1_770_000_000_000,
    });
    expect(printed.payload).toMatchObject({
      v: 1,
      pairingToken: 'one-time',
      endpoint: 'wss://mac.ts.net:8787',
    });
    expect(printed.payload).not.toHaveProperty('token');
    expect(printed.text).toContain('piwin://pair?');
    expect(printed.text).toContain('pairingToken=one-time');
  });

  it('allows a wildcard bind but refuses a wildcard QR endpoint', () => {
    expect(
      createHostPairingAnnouncement({
        advertisedEndpoint: 'ws://10.0.0.8:8787',
        pairingToken: 'one-time',
        hostInstanceId: 'host-1',
        expiresAt: 1,
      }).payload.endpoint,
    ).toBe('ws://10.0.0.8:8787');
    expect(() =>
      createHostPairingAnnouncement({
        advertisedEndpoint: 'ws://0.0.0.0:8787',
        pairingToken: 'one-time',
        hostInstanceId: 'host-1',
        expiresAt: 1,
      }),
    ).toThrow('wildcard');
  });
});
