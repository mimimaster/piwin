import { describe, expect, it } from 'vitest';
import {
  decodeWorkerSecretBootstrap,
  encodeWorkerSecretBootstrap,
  WORKER_SECRET_BOOTSTRAP_MAX_VALUE_BYTES,
} from './worker-secret-bootstrap.js';

describe('worker secret bootstrap framing', () => {
  it('round-trips opaque ids and ephemeral values', () => {
    const frame = encodeWorkerSecretBootstrap([
      { secretId: 'provider-secret-1', value: 'canary-key-value' },
      { secretId: 'provider-secret-2', value: 'second-key-value' },
    ]);

    expect(decodeWorkerSecretBootstrap(frame)).toEqual(
      new Map([
        ['provider-secret-1', 'canary-key-value'],
        ['provider-secret-2', 'second-key-value'],
      ]),
    );
  });

  it('rejects duplicate ids and oversized values', () => {
    expect(() =>
      encodeWorkerSecretBootstrap([
        { secretId: 'duplicate', value: 'one' },
        { secretId: 'duplicate', value: 'two' },
      ]),
    ).toThrow(/duplicate ids/);

    expect(() =>
      encodeWorkerSecretBootstrap([
        { secretId: 'large', value: 'x'.repeat(WORKER_SECRET_BOOTSTRAP_MAX_VALUE_BYTES + 1) },
      ]),
    ).toThrow(/exceeds its limits/);
  });

  it('rejects malformed length prefixes without exposing payload values', () => {
    const frame = encodeWorkerSecretBootstrap([{ secretId: 'secret', value: 'canary' }]);
    frame.writeUInt32BE(frame.byteLength, 0);
    expect(() => decodeWorkerSecretBootstrap(frame)).toThrow(/frame length is invalid/);
  });
});
