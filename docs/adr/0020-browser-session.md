# ADR 0020: Agent-Controllable Browser Session

## Status

Proposed (2026-07-31) · supersedes the iframe-based `BrowserPanel` preview

## Context

piwin's "built-in browser" is currently `BrowserPanel`
(`apps/desktop/src/browser-panel.tsx`): a sandboxed iframe with a URL bar and
`sessionStorage` persistence. It has three fundamental limits:

1. **No agent control.** The host tool bridge has no browser surface. Even if it
   did, a parent page cannot script a cross-origin iframe (same-origin policy).
2. **No element selection.** The parent cannot read the DOM of a cross-origin
   iframe, so "pick a component and attach it to the composer" is impossible.
3. **Many sites cannot be framed.** `X-Frame-Options: DENY` / CSP
   `frame-ancestors` blank the panel for a large fraction of the web
   (OpenHands hit the same wall and explicitly dropped the iframe approach).

### Platform constraint

piwin's desktop shell is Tauri 2 = system webview (macOS WKWebView / Linux
WebKitGTK / Windows WebView2). **Only Windows WebView2 exposes CDP; macOS and
Linux system webviews cannot be driven by Playwright/CDP.** Therefore the agent
cannot drive the app's embedded webview. The industry pattern (OpenHands,
vercel/agent-browser, Cursor) is: **the agent drives a real Chromium it owns,
and the panel mirrors that same instance.** This keeps "what the user sees ==
what the agent controls".

### Research summary

| Concern | Reusable open source (all permissive) |
|---------|---------------------------------------|
| Browser engine + tool surface | `playwright-core`; tool semantics mirror `@playwright/mcp` (Apache-2.0): accessibility snapshot + element `ref`s (`ref=e5`) instead of brittle selectors |
| Panel mirror (user sees the agent's page) | OpenHands (MIT): backend Playwright → screenshot frames → frontend renders image, **not** iframe |
| Stable element selector for pick | `@medv/finder` (MIT) — shortest stable CSS selector, skips auto-generated ids / CSS-in-JS hashes |
| Element picker UX (hover → highlight → click) | `usertour/openpicker` (MIT), `dev-element-picker` (MIT) — reference for hover-highlight + capture payload shape |

Snapshot+`ref` is the standard every coding agent already knows (Claude Code,
Cursor, Codex). Reusing it makes piwin's `browser_*` tools zero-learning-cost.

## Decision

### 1. Remove the iframe `BrowserPanel`

Delete `BrowserPanel` and all its desktop wiring (panel tab, section meta,
memory kind, CSS). Rationale: it cannot be evolved into a controllable browser;
keeping it invites the "temporary hack" trap (AGENTS.md §1.10). The browser tab
slot is reused by the new Browser Session panel.

### 2. New application package `@piwin/browser`

A host-side capability service that owns **one** headless Chromium via
`playwright-core`:

- **Agent tool surface** — `HostToolDefinition[]` mirroring `@playwright/mcp`
  semantics: `browser_navigate`, `browser_snapshot` (a11y tree with `ref`s),
  `browser_click`, `browser_type`, `browser_fill_form`, `browser_scroll`,
  `browser_screenshot`, `browser_find`, `browser_back`/`browser_forward`,
  `browser_wait`. Snapshots use the **same ref grammar as `@playwright/mcp`**:
  `locator('html').ariaSnapshot({ mode: 'ai', boxes: true })` emits YAML with
  `[ref=eN]` and `[box=x,y,w,h]` annotations, and refs resolve via
  `locator('aria-ref=e5')`. Both are public `playwright-core` APIs (the legacy
  `page.accessibility` was removed in 1.x and must not be used). The typed
  `BrowserSnapshotNode[]` tree is derived by parsing this YAML (small dedicated
  parser; no new runtime dep beyond a `yaml` lib if we reuse it).
- **Pick surface** — `pickElementAt(x, y)` runs `document.elementFromPoint` in
  the page context (same-origin by definition, so it works on any site) and
  returns a stable CSS selector (`@medv/finder`, bundled and injected via
  `page.addInitScript`), a bounded `outerHTML` / `innerText`, the bounding rect,
  a best-effort snapshot `ref`, and an optional element-cropped screenshot saved
  under the media root. `ref` is matched against the `[box=…]` annotations from
  `ariaSnapshot({ boxes: true })` (whichever box contains the click point), so it
  is reliable for ref'd (interactive) elements; the CSS `selector` remains the
  durable anchor and is always present.
- **Mirror surface** — emits throttled screenshot frames (~2–4 fps, size-capped
  JPEG data-URLs) plus URL/title state, for the desktop panel.

Dependencies: `@piwin/contracts` (types) + `playwright-core` (+ `@medv/finder`,
+ `yaml` for snapshot parsing). It is an application package below the host
boundary, exactly like `tools-web`. It does **not** import Pi, DOM host APIs, or
`agent-host`.

### 3. Tool wiring in `@piwin/agent-host`

`agent-host` depends on application packages and registers their tool factories
with Pi (existing pattern: `createWebToolDefinitions`, `gated-bash-tool.ts`). A
new `browser-tools.ts` in `agent-host` wraps the `@piwin/browser` session into
`HostToolDefinition[]`. The browser session is shared app-wide; both the agent
tools and the desktop panel operate on the same instance.

### 4. Contracts first (`@piwin/contracts/src/browser.ts`)

New contract module `browser.ts` exported from `index.ts`:

```ts
export type BrowserSnapshotNode = {
  role: string; name?: string; ref?: string;
  level?: number; checked?: boolean; children: BrowserSnapshotNode[];
};

export type WebElementPickResult = {
  url: string; selector: string;        // stable CSS selector (@medv/finder)
  ref?: string;                          // best-effort a11y snapshot ref
  text: string;                          // bounded innerText
  html?: string;                         // bounded outerHTML
  boundingRect: { x: number; y: number; width: number; height: number };
  screenshotPath?: string;               // under ~/.piwin/media/<session>/
};

export type WebElementAttachmentRef = {
  id: string; kind: 'web-element'; url: string; selector: string;
  ref?: string; text: string; html?: string; screenshotPath?: string;
};

export type PromptAttachment = MediaAttachmentRef | WebElementAttachmentRef;

export function formatTextModelWebElementInjection(ref: WebElementAttachmentRef): string;
```

`PromptInput.attachments` widens from `MediaAttachmentRef[]` to
`PromptAttachment[]` (type change ripples to host-runtime, transcript-recorder,
mock-session, product-shell-session, and their tests — required to stay green).

The attach flow mirrors the image path-injection pattern from ADR 0005 /
`formatTextModelImageInjection` (`packages/contracts/src/media.ts`, consumed by
`host-runtime.ts` `buildModelPromptInput`): on send, web-element attachments
are rendered into model-facing text via
`formatTextModelWebElementInjection` (URL + selector + bounded text + optional
screenshot path), **no base64 dump** (AGENTS.md §3.6 / rule 6). The same
`assertInsideMediaRoot` guard reused by `validateMediaAttachment` applies to
`screenshotPath`.

### 5. Permission

`browser_navigate` is a host-gated action. Defaults differ from `web_fetch`
(deliberately, for dev-preview convenience), but **narrowly**: only **loopback**
(`localhost`, `127.0.0.1`, `::1`) is allowed by default. Everything else —
including **link-local / cloud metadata** (`169.254.169.254`, `fe80::/10`) and
private ranges (`10/8`, `172.16/12`, `192.168/16`, `fd00::/8`) — goes through the
rule engine, and with no matching rule the default decision is `ask` (not
`allow`). Rationale: the panel's primary use is previewing local dev servers,
but a blanket "private allowed" default would let a prompted agent navigate to
`http://169.254.169.254/latest/meta-data/…` (cloud credentials) without asking —
an SSRF hole. Classification reuses `isPrivateOrLocalHostname` /
`isPrivateOrLocalIpAddress` from `@piwin/tools-web` (exported; host-side only).
Element pick/attach is **user-initiated** — no permission prompt (the user is
pointing at what they already see).

### 6. Desktop panel

`BrowserPanel` is replaced by `BrowserSessionPanel`: renders the mirrored frame
stream, a URL bar bound to the session's URL/title, and a **pick mode** toggle.
In pick mode the user clicks the mirrored view; the panel forwards coordinates,
the host resolves the element, and a highlighted overlay + a composer chip
(`WebElementAttachmentRef`) appear. Sending injects the web-element description
into the model context. The overlay is drawn by scaling the element
`[box=…]` rect (already viewport-relative CSS px from
`ariaSnapshot({ boxes: true })`) to the on-screen size of the frame `<img>` —
no page-CSS→screenshot conversion is needed on the host side; the panel only
applies the `img` display scale.

**Concurrency**: the shared page is a single logical resource; agent tool calls
and user pick/panel interactions are serialized through one in-host mutex
("browser bus"). A pick in flight either queues behind an in-progress agent
tool call or cancels it — the two never interleave against a mid-navigation
page. The panel disables pick mode while an agent tool is running.

IPC: new `HostCommand` variants (`browser/navigate`, `browser/pick-at`,
`browser/start`, `browser/screenshot`, …) and `HostPush` events
(`browser/frame`, `browser/state`, `browser/picked`) in `@piwin/contracts`'s
`ipc.ts`.

### 7. CLI parity

The browser service is host-owned, so CLI sessions can call `browser_*` tools.
The visual panel is desktop-only; CLI degradation is intentional and documented
(AGENTS.md §5 anti-pattern list).

## Consequences

- **Browser binaries**: `playwright-core` does not auto-download browsers; reuse
  the chromium installed by `pnpm --dir apps/desktop e2e:install`
  (`playwright install chromium`), with a documented fallback. `pnpm doctor`
  reports missing chromium. Bundling a chromium binary for production desktop
  distribution is a **follow-up** (today the app assumes a dev machine or a
  prior playwright install).
- **Frame stream cost**: capped at ~2–4 fps, JPEG, max dimension ~1280px, and
  only emitted while the panel is visible. Screenshots never enter model context
  as base64; only paths. **Known ceiling**: pushing every frame as a base64
  data-URL over Tauri IPC (~400 KB/s at 4 fps) is fine for the MVP; a later
  iteration can serve frames from a local HTTP endpoint in `@piwin/browser` and
  have the panel `<img>` pull directly, bypassing the Rust bridge.
- **Single shared instance**: one Chromium per app run. If it crashes, browser
  tools fail fast with an actionable error and the panel shows a restart affordance.
- **`ref` lifetime**: snapshot `ref`s are valid until the next page change
  (same contract as `@playwright/mcp`). Pick results therefore carry both a
  `selector` (durable) and a `ref` (instant), so the agent can re-locate an
  attached element after navigation.
- **Headless bot-blocking**: `chromium.launch({ headless: true })` may be
  detected by some sites (Cloudflare bot mode). Documented as a known
  limitation; a headed/stealth option is deferred.
- **No `page.accessibility`**: it was removed in Playwright 1.x. All snapshot
  logic uses `ariaSnapshot({ mode: 'ai', boxes: true })` + `locator('aria-ref=…')`.
- **YAML parsing**: `ariaSnapshot` returns YAML text; deriving the typed
  `BrowserSnapshotNode[]` needs a YAML parser (`yaml` pkg) or we keep the raw
  YAML string as the tool payload. The `yaml` dependency is justified; add it to
  `@piwin/browser`.

## Alternatives considered

- **Bundle `@playwright/mcp` as an MCP server** (fastest). Rejected: two
  browser instances (MCP-internal vs panel), no panel-state access for element
  pick, coarse permission (server-trust only, not rule engine).
- **Native webview via Tauri multiwebview**. Rejected for agent control:
  no CDP on macOS/Linux. Could return later as a "user's own browsing" view.
- **Proxy-iframe interactive mirror (OpenHands-style URL rewriting)**. Deferred
  to a follow-up: real interactivity in-panel, but URL/cookie/CSP rewriting is
  substantial. The screenshot-mirror + coordinate pick covers the MVP ask.

## Open questions / deferred

- `browser_navigate` uses `web-fetch` hostGlob rules with a **loopback-only**
  default for v1. A dedicated `browser` rule kind in `PermissionRuleTarget`
  (same pattern as ADR 0019 §8) is reserved for a follow-up migration, so users
  can express browser-specific allow/deny separately from `web_fetch`.
- Interactive proxy-iframe mirror (real clicking/typing inside the panel) as a
  follow-up ADR.
- Persistent browser sessions across app restarts (save/restore profile) —
  out of scope for v1.
