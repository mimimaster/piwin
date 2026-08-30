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

  it('fails when 1455 is bound and resolves after it is released', async () => {
    occupied = createServer();
    const bound = await new Promise<boolean>((resolve) => {
      occupied?.once('error', () => resolve(false));
      occupied?.listen(CODEX_OAUTH_CALLBACK_PORT, '127.0.0.1', () => resolve(true));
    });
    await expect(assertCodexCallbackPortFree()).rejects.toMatchObject({
      code: 'oauth-callback-port-busy',
    });
    if (!bound) {
      occupied = undefined;
      return;
    }
    await new Promise<void>((resolve) => {
      occupied?.close(() => resolve());
    });
    occupied = undefined;
    await assertCodexCallbackPortFree();
  });
});
