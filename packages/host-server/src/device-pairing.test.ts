import { describe, expect, it } from 'vitest';
import { HostDevicePairing } from './device-pairing.js';

function createDeterministicPairing() {
  let now = 1_700_000_000_000;
  let sequence = 0;
  const pairing = new HostDevicePairing({
    now: () => now,
    randomBytes: (size) => {
      sequence += 1;
      return Uint8Array.from({ length: size }, (_, index) => (sequence + index) % 255);
    },
    tokenTtlMs: 1_000,
    maxPendingTokens: 2,
    maxDevices: 2,
  });
  return { pairing, advance: (ms: number) => (now += ms) };
}

describe('HostDevicePairing', () => {
  it('consumes a token once and authenticates the issued credential', () => {
    const { pairing } = createDeterministicPairing();
    const token = pairing.mintToken();
    expect(token.challenge).toBeUndefined();
    const completion = pairing.completePairing(token.token, 'iPhone');

    expect(completion.device.name).toBe('iPhone');
    expect(pairing.authenticate(completion.credential)).toMatchObject({
      id: completion.device.id,
      name: 'iPhone',
    });
    expect(() => pairing.completePairing(token.token)).toThrow('invalid or expired');
  });

  it('rejects wrong, expired, and revoked credentials', () => {
    const { pairing, advance } = createDeterministicPairing();
    const expired = pairing.mintToken();
    advance(1_001);
    expect(() => pairing.completePairing(expired.token)).toThrow('invalid or expired');

    const completion = pairing.completePairing(pairing.mintToken().token);
    expect(
      pairing.authenticate({
        deviceId: completion.credential.deviceId,
        deviceSecret: 'wrong-secret',
      }),
    ).toBeUndefined();
    expect(pairing.revoke(completion.credential.deviceId)).toBe(true);
    expect(pairing.authenticate(completion.credential)).toBeUndefined();
    expect(pairing.revoke(completion.credential.deviceId)).toBe(false);
  });

  it('invalidates unused pairing tokens without revoking devices', () => {
    const { pairing } = createDeterministicPairing();
    const unused = pairing.mintToken();
    const completion = pairing.completePairing(pairing.mintToken().token, 'iPhone');
    pairing.invalidatePendingTokens();
    expect(() => pairing.completePairing(unused.token)).toThrow('invalid or expired');
    expect(pairing.authenticate(completion.credential)?.id).toBe(completion.device.id);
  });

  it('bounds pending tokens and paired devices', () => {
    const { pairing } = createDeterministicPairing();
    const first = pairing.mintToken();
    pairing.mintToken();
    const newest = pairing.mintToken();
    expect(() => pairing.completePairing(first.token)).toThrow('invalid or expired');
    pairing.completePairing(newest.token);
    pairing.completePairing(pairing.mintToken().token);
    expect(() => pairing.completePairing(pairing.mintToken().token)).toThrow('capacity is full');
  });

  it('round-trips export/restore without raw secrets', () => {
    const { pairing } = createDeterministicPairing();
    const completion = pairing.completePairing(pairing.mintToken().token, 'iPhone');
    const snapshot = pairing.exportState();
    expect(JSON.stringify(snapshot)).not.toContain(completion.credential.deviceSecret);

    const restored = new HostDevicePairing();
    restored.restoreState(snapshot);
    expect(restored.authenticate(completion.credential)?.id).toBe(completion.device.id);
  });
});
