import { describe, expect, it } from 'vitest';
import { decodeBase64Url, encodeBase64Url } from './base64url.js';
import {
  openRelayUserBundle,
  RelayUserBundleError,
  sealRelayUserBundle,
  type ScryptParams,
} from './relay-user-bundle.js';

// Production uses N=2^17; tests use the smallest allowed cost to stay fast.
const FAST: ScryptParams = { N: 2 ** 14, r: 8, p: 1 };
const SECRET = Uint8Array.from({ length: 32 }, (_, index) => index);

async function expectReason(promise: Promise<unknown>, reason: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(RelayUserBundleError);
  await expect(promise).rejects.toMatchObject({ reason });
}

describe('relay user bundle', () => {
  it('round-trips the key and the normalized name', async () => {
    const bundle = await sealRelayUserBundle(
      { userSecretKey: SECRET, name: ' Yorick ' },
      'correct horse',
      FAST,
    );
    expect(bundle.startsWith('piwin-user-bundle:v1:')).toBe(true);
    expect(await openRelayUserBundle(bundle, 'correct horse')).toEqual({
      userSecretKey: SECRET,
      name: 'Yorick',
    });
  });

  it('uses fresh salt and nonce each time', async () => {
    const first = await sealRelayUserBundle({ userSecretKey: SECRET, name: 'a' }, 'pw', FAST);
    const second = await sealRelayUserBundle({ userSecretKey: SECRET, name: 'a' }, 'pw', FAST);
    expect(first).not.toBe(second);
  });

  it('rejects a wrong passphrase and a tampered ciphertext', async () => {
    const bundle = await sealRelayUserBundle({ userSecretKey: SECRET, name: 'a' }, 'pw', FAST);
    await expectReason(openRelayUserBundle(bundle, 'not pw'), 'wrong-passphrase');
    const envelope = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(bundle.slice('piwin-user-bundle:v1:'.length))),
    ) as Record<string, unknown>;
    const ct = decodeBase64Url(String(envelope.ct)) ?? new Uint8Array();
    ct[0] = (ct[0] ?? 0) ^ 1;
    const tampered = `piwin-user-bundle:v1:${encodeBase64Url(
      new TextEncoder().encode(JSON.stringify({ ...envelope, ct: encodeBase64Url(ct) })),
    )}`;
    await expectReason(openRelayUserBundle(tampered, 'pw'), 'wrong-passphrase');
  });

  it('refuses bundles that claim an out-of-bounds scrypt cost', async () => {
    const bundle = await sealRelayUserBundle({ userSecretKey: SECRET, name: 'a' }, 'pw', FAST);
    const envelope = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(bundle.slice('piwin-user-bundle:v1:'.length))),
    ) as Record<string, unknown>;
    for (const N of [2 ** 13, 2 ** 21, 3000]) {
      const bomb = `piwin-user-bundle:v1:${encodeBase64Url(
        new TextEncoder().encode(JSON.stringify({ ...envelope, N })),
      )}`;
      await expectReason(openRelayUserBundle(bomb, 'pw'), 'malformed');
    }
  });

  it('rejects garbage', async () => {
    for (const text of ['', 'nope', 'piwin-user-bundle:v1:!!!', 'piwin-user-bundle:v1:e30']) {
      await expectReason(openRelayUserBundle(text, 'pw'), 'malformed');
    }
  });

  it('refuses to seal a bad key, an empty name or weak parameters', async () => {
    await expect(
      sealRelayUserBundle({ userSecretKey: new Uint8Array(31), name: 'a' }, 'pw', FAST),
    ).rejects.toThrow();
    await expect(
      sealRelayUserBundle({ userSecretKey: SECRET, name: ' ' }, 'pw', FAST),
    ).rejects.toThrow();
    await expect(
      sealRelayUserBundle({ userSecretKey: SECRET, name: 'a' }, 'pw', { N: 2 ** 10, r: 8, p: 1 }),
    ).rejects.toThrow();
  });
});
