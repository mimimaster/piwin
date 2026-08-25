import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCliHostAttachTarget, resolveCliAttachedClientId } from './attach-existing-host.js';

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

  it('reuses a persisted client principal per Host target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-cli-attach-id-'));
    const first = await resolveCliAttachedClientId('ws://127.0.0.1:8787', root);
    const second = await resolveCliAttachedClientId('ws://127.0.0.1:8787', root);
    expect(first).toBe(second);
    expect(first.startsWith('cli-')).toBe(false);
  });
});
