import { describe, expect, it } from 'vitest';
import { readCliHostAttachTarget } from './attach-existing-host.js';

describe('readCliHostAttachTarget', () => {
  it('returns undefined when PIWIN_HOST_URL is unset', () => {
    expect(readCliHostAttachTarget({})).toBeUndefined();
  });

  it('reads the endpoint and optional token', () => {
    expect(
      readCliHostAttachTarget({
        PIWIN_HOST_URL: 'ws://127.0.0.1:8787',
        PIWIN_HOST_TOKEN: 'secret',
      }),
    ).toEqual({ endpoint: 'ws://127.0.0.1:8787', authToken: 'secret' });
  });

  it('rejects non-ws endpoints', () => {
    expect(
      readCliHostAttachTarget({
        PIWIN_HOST_URL: 'http://127.0.0.1:8787',
      }),
    ).toBeUndefined();
  });
});
