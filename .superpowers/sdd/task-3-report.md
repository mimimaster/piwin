# Task 3 Report: Host wiring — tools, permission, IPC, attachment injection

## Status: COMPLETE

## Commit

`d9784fa` — `feat(agent-host): browser session tools, permission, ipc`

## Files changed

### New files
- `packages/agent-host/src/browser-tools.ts` — `createBrowserToolDefinitions(session, options)` returning 11 `HostToolDefinition[]` + `evaluateBrowserNavigatePermission(url, rules)`.
- `packages/agent-host/src/browser-tools.test.ts` — 38 tests: tool schema golden, execute paths, permission classification (loopback/private/public/rule-engine), navigate gate (interactive + non-interactive), mutex serialization.
- `packages/agent-host/src/commands/browser-commands.ts` — `handleBrowserCommand` IPC handler for `browser/start|navigate|pick-at|screenshot|stop` + `wireBrowserSessionPushes`.
- `packages/agent-host/src/commands/browser-commands.test.ts` — 10 tests: command dispatch, no-session failure, each command path, pick push, mutex serialization.

### Modified files
- `packages/agent-host/package.json` — added `@piwin/browser: workspace:*` dependency.
- `packages/agent-host/src/commands/host-command-context.ts` — added `getBrowserSession?: () => BrowserSession | undefined` to `HostCommandContext`.
- `packages/agent-host/src/commands/domain-command-dispatch.ts` — added `handleBrowserCommand` to the handler chain.
- `packages/agent-host/src/sdk-adapter.ts` — added `getBrowserSession?: () => BrowserSession | undefined` to `PiSdkAdapterOptions`; appends browser tools to `codingTools` (not knowledge/chat) when session is present and mode is not chat/readonly.
- `packages/agent-host/src/create-host.ts` — threaded `getBrowserSession` through both SDK and RPC branches.
- `packages/agent-host/src/rpc-adapter.ts` — added `getBrowserSession` to `PiRpcAdapterOptions` and forwarded to SDK backend.
- `packages/agent-host/src/host-runtime.ts` — owns one `BrowserSession` (lazy via dynamic `import('@piwin/browser')`); `ensureBrowserSession()` called before first Pi session creation; session subscriber wired to `this.push`; `getBrowserSession` added to `HostCommandContext`; `buildModelPromptInput` validates `screenshotPath` under media root for web-element attachments; session closed on `dispose()`.
- `packages/agent-host/src/permission-context.ts` — added `browser:` / `browser_navigate` classification (network kind, "Browser navigation requires review").
- `packages/agent-host/src/index.ts` — exported `createBrowserToolDefinitions`, `evaluateBrowserNavigatePermission`, `CreateBrowserToolsOptions`, `BrowserToolPermissionGate`, `handleBrowserCommand`, `isBrowserCommand`, `wireBrowserSessionPushes`.
- `pnpm-lock.yaml` — updated for new `@piwin/browser` dependency.

## Permission classification logic

`evaluateBrowserNavigatePermission(url, rules)` in `browser-tools.ts`:

1. **Scheme check**: only `http:` / `https:` accepted; others → `deny` (`blocked-scheme`).
2. **Rule engine**: if `rules` provided, consult `findMatchingRule({ kind: 'web-fetch', host }, rules)` first (deny → ask → allow). This reuses the existing `web-fetch` subject kind so host-allow rules for dev servers carry over.
3. **Loopback allowed by default**: `isLoopbackHost(host)` checks `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`, `0:0:0:0:0:0:0:1`, and IPv4-mapped IPv6 loopback (`::ffff:127.x.x.x`). → `allow` (`loopback-allowed`).
4. **Private/link-local → ask**: everything else that `isPrivateOrLocalHostname` flags (10/8, 172.16/12, 192.168/16, 169.254/169.254, fe80::/10, fd00::/8, 100.64/10 CGNAT, `.local`, `metadata.google.internal`) → `ask` (`private-or-local:<host>`). Never blanket-allow.
5. **Public → ask**: public hosts → `ask` (`navigate:<host>`).

Key distinction: `isPrivateOrLocalHostname` returns `true` for ALL private+loopback but does NOT distinguish loopback from other-private. The new `isLoopbackHost` helper identifies the loopback-allowed-by-default set; everything else `isPrivateOrLocalHostname` flags is the "private → ask" set.

The navigate tool's `execute` calls `requestPermission` (interactive gate) when the evaluation is `ask`; non-interactive (no gate) resolves `ask` → `deny` via `resolveNonInteractiveDecision`.

## Session threading

- **HostRuntime** owns one `BrowserSession` via `ensureBrowserSession()` (lazy dynamic import of `@piwin/browser`, called before first Pi session creation in `createSession`). The session object is cheap — Chromium launches on first actual operation.
- **sdk-adapter**: `PiSdkAdapterOptions.getBrowserSession?: () => BrowserSession | undefined` is called in `createPiSdkSession`. When present (and mode is not chat/readonly), `createBrowserToolDefinitions(session, { requestPermission, rules })` builds the tools and they're appended to `codingTools`.
- **IPC**: `HostCommandContext.getBrowserSession?: () => BrowserSession | undefined` is provided by `buildDomainContext`. `handleBrowserCommand` calls it to get the session; all operations go through the session's mutex (`runExclusive` via the session methods themselves).
- **Pushes**: the session's `subscribe()` is wired to `this.push` in `ensureBrowserSession()`, forwarding `browser/frame` and `browser/state` events to the desktop panel. `browser/picked` is pushed by the `browser/pick-at` command handler.
- **RPC adapter**: `getBrowserSession` forwarded to SDK fallback backend.

## Attachment injection (host-runtime.ts)

`buildModelPromptInput` web-element branch now validates `screenshotPath` via `assertInsideMediaRoot(mediaRoot, attachment.screenshotPath)` (same guard as `validateMediaAttachment`), then injects via `formatTextModelWebElementInjection`. Paths outside media root throw, mirroring `validateMediaAttachment` behavior.

## Test results

- `pnpm typecheck` (whole workspace): **PASS**
- `pnpm --filter @piwin/agent-host test`: **381 passed (54 files)** — includes 38 new browser-tools tests + 10 new browser-commands tests
- `pnpm --filter @piwin/contracts test`: **PASS**
- `pnpm --filter @piwin/browser test`: **38 passed (5 files)**
- `pnpm test` (full workspace): **PASS** (exit 0)

## Scope discipline

- No desktop panel changes (Task 4).
- No `@piwin/browser` internals modified.
- No pick-to-composer UI (Task 4).
- All exports intentional (browser tools, commands, permission evaluation).
