import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { CODEX_OAUTH_CALLBACK_PORT } from '@piwin/contracts';
import { assertCodexCallbackPortFree } from './subscription-oauth-callback-port.js';

describe('assertCodexCallbackPortFree', () => {
  let occupied: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    const server = occupied;
    occupied = undefined;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  async function bindPort(host: string): Promise<boolean> {
    occupied = createServer();
    const server = occupied;
    const bound = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(CODEX_OAUTH_CALLBACK_PORT, host, () => resolve(true));
    });
    if (!bound) {
      occupied = undefined;
    }
    return bound;
  }

  async function closeOccupied(): Promise<void> {
    const server = occupied;
    occupied = undefined;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  it('fails when 1455 is bound on IPv4 and resolves after it is released', async () => {
    const bound = await bindPort('127.0.0.1');
    await expect(assertCodexCallbackPortFree()).rejects.toMatchObject({
      code: 'oauth-callback-port-busy',
    });
    if (!bound) {
      return;
    }
    await closeOccupied();
    await assertCodexCallbackPortFree();
  });

  it('fails when 1455 is bound on IPv6 only', async () => {
    const bound = await bindPort('::1');
    if (!bound) {
      // No IPv6 loopback on this machine; the IPv4 case above covers the check.
      return;
    }
    // `localhost` prefers ::1, so an IPv6-only holder swallows the callback.
    await expect(assertCodexCallbackPortFree()).rejects.toMatchObject({
      code: 'oauth-callback-port-busy',
    });
    await closeOccupied();
    await assertCodexCallbackPortFree();
  });
});
