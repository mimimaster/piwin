import { createServer } from 'node:net';
import { CODEX_OAUTH_CALLBACK_PORT } from '@piwin/contracts';

/**
 * Both loopback stacks a `localhost` callback can land on. Pi listens on
 * `127.0.0.1`, its redirect URI is `http://localhost:1455/auth/callback`, and
 * `localhost` resolves to `::1` first on macOS/Windows — an IPv6-only holder
 * (Codex CLI / CPA) would answer the browser with its own success page while
 * Pi never receives the code.
 */
const CODEX_CALLBACK_HOSTS = ['127.0.0.1', '::1'] as const;

/** No such stack on this machine, so nothing can hold the port there either. */
const MISSING_STACK_CODES = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EPROTONOSUPPORT']);

/** Pre-flight Pi Codex loopback bind. Do not rebind Pi's port or kill CPA. */
export function assertCodexCallbackPortFree(): Promise<void> {
  return CODEX_CALLBACK_HOSTS.reduce<Promise<void>>(
    (chain, host) => chain.then(() => assertCallbackPortFreeOn(host)),
    Promise.resolve(),
  );
}

function assertCallbackPortFreeOn(host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      const code = readErrorCode(error);
      if (code !== undefined && MISSING_STACK_CODES.has(code)) {
        resolve();
        return;
      }
      if (code !== 'EADDRINUSE') {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      reject(
        Object.assign(
          new Error(
            `OAuth callback port ${CODEX_OAUTH_CALLBACK_PORT} is already in use on ${host}`,
          ),
          { code: 'oauth-callback-port-busy' },
        ),
      );
    });
    server.listen(CODEX_OAUTH_CALLBACK_PORT, host, () => {
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

function readErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}
