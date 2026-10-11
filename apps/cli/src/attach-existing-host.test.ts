import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readCliHostAttachTarget, resolveCliAttachedClientId } from './attach-existing-host.js';

vi.mock('@piwin/host-runtime', () => { throw new Error('Attached client loaded Host-runtime'); });

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

  it('reads paired-device admission without also presenting an auth token', () => {
    expect(readCliHostAttachTarget({
      PIWIN_HOST_URL: 'wss://host.example/agent',
      PIWIN_HOST_TOKEN: 'older-token',
      PIWIN_HOST_DEVICE_ID: 'device-1',
      PIWIN_HOST_DEVICE_SECRET: 'device-secret',
    })).toEqual({
      endpoint: 'wss://host.example/agent',
      deviceCredential: { deviceId: 'device-1', deviceSecret: 'device-secret' },
    });
  });

  it('fails closed on malformed explicit attachment and incomplete device credentials', () => {
    expect(() => readCliHostAttachTarget({ PIWIN_HOST_URL: 'http://host.example' })).toThrow();
    expect(() => readCliHostAttachTarget({
      PIWIN_HOST_URL: 'ws://host.example', PIWIN_HOST_DEVICE_ID: 'device-1',
    })).toThrow();
  });

  it('rejects non-ws endpoints', () => {
    expect(() => readCliHostAttachTarget({
      PIWIN_HOST_URL: 'http://127.0.0.1:8787',
    })).toThrow('PIWIN_HOST_URL');
  });

  it('reuses a persisted client principal per Host target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-cli-attach-id-'));
    const first = await resolveCliAttachedClientId('ws://127.0.0.1:8787', root);
    const second = await resolveCliAttachedClientId('ws://127.0.0.1:8787', root);
    expect(first).toBe(second);
    expect(first.startsWith('cli-')).toBe(false);
  });
});
