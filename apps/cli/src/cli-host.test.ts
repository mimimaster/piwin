import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCliHost } from './cli-host.js';

describe('openCliHost', () => {
  const previousUrl = process.env.PIWIN_HOST_URL;
  const previousToken = process.env.PIWIN_HOST_TOKEN;

  afterEach(() => {
    if (previousUrl === undefined) {
      delete process.env.PIWIN_HOST_URL;
    } else {
      process.env.PIWIN_HOST_URL = previousUrl;
    }
    if (previousToken === undefined) {
      delete process.env.PIWIN_HOST_TOKEN;
    } else {
      process.env.PIWIN_HOST_TOKEN = previousToken;
    }
  });

  it('opens an in-process Host when PIWIN_HOST_URL is unset', async () => {
    delete process.env.PIWIN_HOST_URL;
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cli-host-'));
    const host = await openCliHost({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      expect(host.transport).toBe('in-process');
      const ping = await host.handleCommand({ type: 'host/ping' });
      expect(ping.success).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
