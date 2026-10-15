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
 * Re-entrant: callers update `process.env` first, then call again when the
 * proxy setting changes. A process that never saw a proxy keeps Node's stock
 * fetch. Returns whether fetch now goes through a proxy.
 */
let undiciFetchInstalled = false;

const ignoreDispatcherError = (_error: unknown): void => {};

// Undici may emit an internal "error" while tearing down an aborted stream;
// the request itself still rejects. An unhandled EventEmitter "error" would
// crash the Host instead (same guard as Pi's CLI dispatcher).
function withErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, 'error', ignoreDispatcherError);
  }
  return dispatcher;
}

export function configureEnvHttpProxyDispatcher(): boolean {
  const hasProxy = Object.keys(pickChildProxyEnv(process.env)).some(
    (key) => !/^no_proxy$/iu.test(key),
  );
  if (!hasProxy && !undiciFetchInstalled) return false;
  // EnvHttpProxyAgent reads process.env when constructed, so a changed setting
  // needs a fresh agent. The previous one is not closed: in-flight streams keep
  // their connections and idle sockets expire on keep-alive timeout.
  const dispatcher = hasProxy
    ? withErrorListener(new undici.EnvHttpProxyAgent({ allowH2: false }))
    : withErrorListener(new undici.Agent({ allowH2: false }));
  undici.setGlobalDispatcher(dispatcher);
  if (!undiciFetchInstalled) {
    // Keep fetch and dispatcher on one undici implementation (same reason as
    // Pi's CLI): Node's bundled fetch can mis-handle compressed bodies from npm
    // undici.
    undici.install();
    undiciFetchInstalled = true;
  }
  return hasProxy;
}
