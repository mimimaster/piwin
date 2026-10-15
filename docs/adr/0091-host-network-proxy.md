# ADR 0091: Host outbound proxy as an explicit setting

- **Status**: Accepted (revised 2026-10-15)
- **Date**: 2026-10-15
- **Scope**: `packages/contracts` (`network-proxy.ts`, `child-process-env.ts`, settings
  domain `network`, command `network/detect-system-proxy`), `packages/host-runtime`
  (`src/network-proxy/`, settings wiring), `packages/agent-host`
  (`http-proxy-dispatcher.ts`, `rpc-sdk-worker-client.ts`, `rpc-sdk-worker-entry.ts`),
  `apps/cli`, `apps/host`, `apps/desktop` (`settings/network-proxy-settings.tsx`),
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

The first version of this ADR read the macOS system proxy (`scutil --proxy`)
at every Host start and applied it silently. That was reverted the same day:

- It was implicit. The user never chose it, and the only way off was an
  environment variable.
- It was frozen at startup. Turning the proxy app off left a Host that could
  reach nothing until restarted.
- The macOS bypass list uses CIDR entries (`192.168.0.0/16`) that `NO_PROXY`
  readers do not understand, so LAN endpoints could be sent to the proxy.

Prior art agrees on an explicit setting. Pi's coding agent has `httpProxy` in
`settings.json` (written to `HTTP(S)_PROXY`, global `EnvHttpProxyAgent`).
CLIProxyAPI has `requests.proxy-url` (empty inherits the environment, `direct`
bypasses it, a URL overrides it; per-credential overrides on top). Neither
reads the OS proxy.

## Decision

1. **Setting.** `network.proxyUrl` in `~/.piwin/config.json`, a settings
   domain like any other:
   - omitted or empty: inherit `HTTP(S)_PROXY` / `NO_PROXY` from the Host's
     launch environment;
   - `direct` (alias `none`): ignore every proxy variable;
   - `http://…` / `https://…`: use it for all Host outbound requests. It
     overrides the launch environment (the user set it in Settings). `NO_PROXY`
     comes from the launch environment, else `localhost,127.0.0.1,::1`.
   - SOCKS and PAC are rejected by validation: undici speaks HTTP CONNECT only.
2. **Apply.** `applyHostNetworkProxy(network)` rewrites the proxy variables in
   `process.env` (both cases) and reconfigures the global undici dispatcher
   (`configureEnvHttpProxyDispatcher`, re-entrant). Every Host entry calls
   `applyHostNetworkProxyFromConfig` before constructing `HostRuntime`; a
   config that cannot be read keeps the launch environment and says so in
   the log line.
3. **Change without restart.** When `settings/apply` (or any SettingsService
   write) changes `network`, the Host re-applies it immediately, so sign-in
   and other Host-side fetches switch at once. `network` is a runtime-stale
   domain: agent workers receive proxy variables at spawn
   (`pickChildProxyEnv`), so each session moves to a replacement generation
   after its current run.
4. **System proxy is detection only.** `network/detect-system-proxy` reads the
   macOS system proxy (HTTPS, else HTTP) and returns it. Desktop Settings →
   General → Network proxy has a "Use system proxy" button that calls it and
   saves the result as `network.proxyUrl`. Other platforms report
   `supported: false`.
5. **Children inherit.** Like Pi, agent `bash`, MCP servers and hooks see the
   same proxy variables as the Host.
6. **Logging.** `host serve` logs one line
   `network proxy source=setting|direct|env|none https=… fetch=proxied|direct`;
   proxy credentials are redacted to scheme + host + port. A live change
   pushes the same line as `host/log`.

## Consequences

- Without a setting, a GUI-launched Host connects directly, as before this
  ADR. A user behind a proxy turns it on once in Settings (one click with the
  system-proxy button) and it survives restarts.
- If the configured proxy app quits, Host requests fail the same way a
  terminal with `HTTPS_PROXY` set would; the user switches the setting to
  empty or `direct`, with no Host restart.
- Per-provider proxy overrides (CLIProxyAPI's per-credential `proxy-url`) are
  not implemented; add them to provider config if a real need appears.
- `PIWIN_SYSTEM_PROXY` from the first version is gone.
