import { createServer } from 'node:net';
import { CODEX_OAUTH_CALLBACK_PORT } from '@piwin/contracts';

/** Pre-flight Pi Codex loopback bind. Do not rebind Pi's port or kill CPA. */
export function assertCodexCallbackPortFree(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      const code =
        error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
          ? 'oauth-callback-port-busy'
          : undefined;
      reject(
        Object.assign(error instanceof Error ? error : new Error(String(error)), {
          ...(code !== undefined ? { code } : {}),
        }),
      );
    });
    server.listen(CODEX_OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve();
      });
    });
  });
}
