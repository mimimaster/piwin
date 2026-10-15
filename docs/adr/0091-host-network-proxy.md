# ADR 0091: Host outbound proxy (env first, then macOS system proxy)

- **Status**: Accepted
- **Date**: 2026-10-15
- **Scope**: `packages/host-runtime` (`src/network-proxy/`), `packages/agent-host`
  (`http-proxy-dispatcher.ts`, `rpc-sdk-worker-client.ts`, `rpc-sdk-worker-entry.ts`),
  `packages/contracts` (`child-process-env.ts`), `apps/cli`, `apps/host`,
  `scripts/bundle-host.mjs`

## Context

On a network that needs a proxy (Clash/Surge style local proxy as the macOS
system proxy), the user's browser reaches every provider while the Host
reaches none. Grok sign-in failed with `oauth-network` within ~10 s: the POST
to `auth.x.ai/oauth2/device/code` hit `UND_ERR_CONNECT_TIMEOUT` before a device
code was ever shown.

Three gaps combined:

1. The Desktop sidecar is launched from a GUI app, so it inherits no shell
   `HTTP(S)_PROXY`.
2. Node's built-in `fetch` ignores proxy variables. `NODE_USE_ENV_PROXY` only
   exists from Node 22.21 / 24; the bundled runtime is 22.19.
3. Pi installs its undici `EnvHttpProxyAgent` only from its own CLI and RPC
   entries. piwin runs Pi in SDK mode and its own worker entry, so neither
   path got it. The isolated agent worker also starts with a trimmed env.

## Decision

1. **Resolve once at Host startup** (`applyHostNetworkProxy`, called by every
   entry that constructs a `HostRuntime`: `host serve`, `apps/host`, CLI
   in-process hosts):
   - Explicit `HTTP_PROXY` / `HTTPS_PROXY` (either case) win.
   - Otherwise on macOS, read `scutil --proxy`; enabled HTTP / HTTPS proxies
     become `HTTP_PROXY` / `HTTPS_PROXY`, the bypass list becomes `NO_PROXY`
     (plus `localhost,127.0.0.1,::1`), unless `NO_PROXY` is already set.
   - PAC and SOCKS-only setups are not translated (undici speaks HTTP
     CONNECT only). `PIWIN_SYSTEM_PROXY=0` disables the system lookup.
2. **Route fetch through it.** When any proxy variable is present, install
   undici's `EnvHttpProxyAgent` as the global dispatcher and undici's `fetch`
   as global fetch (same pairing as Pi's CLI). Without a proxy the stock fetch
   stays untouched. undici is pinned to Pi's version and bundled as an
   external, so the Host and Pi share one copy.
3. **Workers inherit it.** The isolated SDK worker receives the proxy
   variables (`pickChildProxyEnv`) and installs the same dispatcher. Other
   children (bash, MCP, hooks via `process.env`) see the variables too.
4. **Logging.** `host serve` logs one line
   `network proxy source=env|system|none https=… fetch=proxied|direct`;
   proxy credentials are redacted to scheme + host + port.

## Consequences

- Sign-in, model calls, web tools and update checks behave like the user's
  browser on the same machine.
- A system proxy changed while the Host runs applies after a Host restart. If
  the local proxy app quits while it is still the system proxy, Host requests
  fail the same way a terminal with `HTTPS_PROXY` set would.
- Windows/Linux GUI-launched Hosts still need explicit proxy variables; a
  system lookup there is future work.
