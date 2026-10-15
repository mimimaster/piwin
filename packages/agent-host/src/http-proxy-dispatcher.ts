import { EventEmitter } from 'node:events';
import * as undici from 'undici';
import { pickChildProxyEnv } from '@piwin/contracts';

/**
 * Route global `fetch` through `HTTP(S)_PROXY` / `NO_PROXY`.
 *
 * Node's built-in fetch ignores proxy variables (the bundled runtime predates
 * `NODE_USE_ENV_PROXY`), and Pi only installs its proxy dispatcher from its own
 * CLI entry — not in SDK mode. Without this, a Host behind a proxy reaches
 * nothing outside the LAN while the user's browser works fine.
 *
 * Installs only when a proxy variable is present, so direct-connection Hosts
 * keep Node's stock fetch. Idempotent per process.
 */
let installed = false;

const ignoreDispatcherError = (_error: unknown): void => {};

export function installEnvHttpProxyDispatcher(): boolean {
  if (installed) return true;
  // EnvHttpProxyAgent reads process.env itself; callers resolve into it first.
  if (Object.keys(pickChildProxyEnv(process.env)).length === 0) return false;
  const dispatcher = new undici.EnvHttpProxyAgent({ allowH2: false });
  // Undici may emit an internal "error" while tearing down an aborted stream;
  // the request itself still rejects. An unhandled EventEmitter "error" would
  // crash the Host instead.
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, 'error', ignoreDispatcherError);
  }
  undici.setGlobalDispatcher(dispatcher);
  // Keep fetch and dispatcher on one undici implementation (same reason as Pi's
  // CLI): Node's bundled fetch can mis-handle compressed bodies from npm undici.
  undici.install();
  installed = true;
  return true;
}
