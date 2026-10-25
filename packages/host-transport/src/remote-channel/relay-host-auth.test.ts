import { ed25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import { encodeBase64Url } from './base64url.js';
import {
  createRelayChallengeNonce,
  relayHostAuthMessage,
  signRelayHostAuth,
  verifyRelayHostAuth,
} from './relay-host-auth.js';
import { formatRelayEnrollmentLine, parseRelayEnrollmentLine } from './relay-enrollment-line.js';
import { deriveHostId, deriveUserId } from './remote-identity.js';

function identities() {
  const hostSigningSecretKey = ed25519.utils.randomSecretKey();
  const userSecretKey = ed25519.utils.randomSecretKey();
  return {
    hostSigningSecretKey,
    userSecretKey,
    hostId: deriveHostId(ed25519.getPublicKey(hostSigningSecretKey)),
    userId: deriveUserId(ed25519.getPublicKey(userSecretKey)),
  };
}

describe('relay host auth', () => {
  it('verifies a correctly signed answer to the issued nonce', () => {
    const ids = identities();
    const nonce = createRelayChallengeNonce();
    const frame = signRelayHostAuth({ nonce, ...ids, enrollToken: 'token' });
    expect(frame.enrollToken).toBe('token');
    const verdict = verifyRelayHostAuth(frame, { nonce, userId: ids.userId, hostId: ids.hostId });
    expect(verdict.ok).toBe(true);
  });

  it('rejects an answer to a different nonce (replay)', () => {
    const ids = identities();
    const frame = signRelayHostAuth({ nonce: createRelayChallengeNonce(), ...ids });
    const verdict = verifyRelayHostAuth(frame, {
      nonce: createRelayChallengeNonce(),
      userId: ids.userId,
      hostId: ids.hostId,
    });
    expect(verdict).toEqual({ ok: false, reason: 'bad-host-signature' });
  });

  it('rejects claiming a user id the key does not derive', () => {
    const ids = identities();
    const nonce = createRelayChallengeNonce();
    const frame = signRelayHostAuth({ nonce, ...ids });
    const other = identities();
    expect(verifyRelayHostAuth(frame, { nonce, userId: other.userId, hostId: ids.hostId })).toEqual(
      {
        ok: false,
        reason: 'user-id-mismatch',
      },
    );
    expect(verifyRelayHostAuth(frame, { nonce, userId: ids.userId, hostId: other.hostId })).toEqual(
      {
        ok: false,
        reason: 'host-id-mismatch',
      },
    );
  });

  it('rejects a host that holds only the public user key (forged user signature)', () => {
    const ids = identities();
    const nonce = createRelayChallengeNonce();
    const frame = signRelayHostAuth({ nonce, ...ids });
    const forged = { ...frame, userSig: frame.hostSig };
    expect(verifyRelayHostAuth(forged, { nonce, userId: ids.userId, hostId: ids.hostId })).toEqual({
      ok: false,
      reason: 'bad-user-signature',
    });
  });

  it('rejects malformed keys and signatures without throwing', () => {
    const ids = identities();
    const nonce = createRelayChallengeNonce();
    const frame = signRelayHostAuth({ nonce, ...ids });
    for (const broken of [
      { ...frame, hostPub: 'not base64url!' },
      { ...frame, userPub: encodeBase64Url(new Uint8Array(31)) },
      { ...frame, hostSig: encodeBase64Url(new Uint8Array(63)) },
    ]) {
      expect(
        verifyRelayHostAuth(broken, { nonce, userId: ids.userId, hostId: ids.hostId }),
      ).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
    expect(
      verifyRelayHostAuth(frame, { nonce: 'short', userId: ids.userId, hostId: ids.hostId }),
    ).toEqual({ ok: false, reason: 'malformed' });
  });

  it('binds the signed message to its domain, nonce and both ids', () => {
    const nonce = encodeBase64Url(new Uint8Array(32).fill(7));
    const message = relayHostAuthMessage(nonce, 'u'.repeat(22), 'h'.repeat(22));
    const prefix = new TextDecoder().decode(message.subarray(0, 20));
    expect(prefix).toBe('piwin-relay-v1\0host\0');
    expect(message).toHaveLength(20 + 32 + 22 + 22);
  });
});

describe('relay enrollment line', () => {
  it('round-trips and derives the user id', () => {
    const publicKey = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
    const line = formatRelayEnrollmentLine({ publicKey, name: ' Yorick: home ' });
    expect(line.startsWith('piwin-user:v1:')).toBe(true);
    expect(parseRelayEnrollmentLine(`  ${line}\n`)).toEqual({
      userId: deriveUserId(publicKey),
      publicKey: encodeBase64Url(publicKey),
      name: 'Yorick: home',
    });
  });

  it('rejects wrong prefixes, bad keys and empty names', () => {
    const key = encodeBase64Url(new Uint8Array(32).fill(1));
    for (const line of [
      `piwin-user:v2:${key}:name`,
      `piwin-user:v1:${key}:`,
      `piwin-user:v1:${key}`,
      `piwin-user:v1:${encodeBase64Url(new Uint8Array(31))}:name`,
      'piwin-user:v1::name',
      'garbage',
    ]) {
      expect(parseRelayEnrollmentLine(line)).toBeUndefined();
    }
  });

  it('refuses to format an empty name or a wrong-size key', () => {
    expect(() => formatRelayEnrollmentLine({ publicKey: new Uint8Array(32), name: ' ' })).toThrow();
    expect(() => formatRelayEnrollmentLine({ publicKey: new Uint8Array(31), name: 'a' })).toThrow();
  });
});
