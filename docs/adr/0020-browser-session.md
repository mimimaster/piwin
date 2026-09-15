# ADR 0020: Agent-Controllable Browser Session

## Status

Accepted (2026-07-31) · lifecycle amendment accepted 2026-08-09 · local HTML
file-open amendment accepted 2026-09-04 · supersedes the iframe-based
`BrowserPanel` preview

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
  `locator('html').ariaSnapshot({ mode: 'ai', boxes: true })` emits an
  indentation-based line format — one `- role "name" [ref=eN] [box=x,y,w,h]` line
  per node with annotations as an order-independent bag — that is **not**
  parseable as YAML (the `yaml` package folds indented `- child` lines into the
  parent scalar and throws `MULTILINE_IMPLICIT_KEY`). The typed
  `BrowserSnapshotNode[]` tree is therefore derived with a small dedicated line
  parser; there is **no `yaml` dependency**. Refs resolve via
  `locator('aria-ref=e5')`. Both are public `playwright-core` APIs (the legacy
  `page.accessibility` was removed in 1.x and must not be used).
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
bundled via esbuild and injected at the browser context level so it survives
navigations). It is an application package below the host boundary, exactly like
`tools-web`. It does **not** import Pi, DOM host APIs, or `agent-host`. There is
**no `yaml` dependency** — the snapshot is parsed with a dedicated line parser.

#### 2.1 Service lifetime and Chromium lease

The Host-owned `BrowserSession` object and the Playwright/Chromium runtime have
different lifetimes:

- creating the service and subscribing Host push forwarding are passive; they
  do not launch Chromium;
- every mounted browser surface generates a one-shot lease ID;
  `browser/start(leaseId)` acquires only that surface's lease, launches the
  persistent context if needed, and enables the bounded frame loop;
- `browser/stop(leaseId)` releases only the matching surface lease. The final
  release stops frames and awaits `BrowserContext.close()`. Closing a persistent
  context is the authoritative Playwright path that waits for its Chromium
  child to exit;
- an asynchronous screenshot rechecks lease ownership before emitting, so a
  frame already in flight at final release is dropped instead of forwarding a
  base64 payload to a surface that no longer exists;
- released one-shot IDs are retained in a bounded tombstone set so React
  StrictMode and delayed transport delivery cannot let a late `start` resurrect
  an already-unmounted panel. Independent Desktop/mobile clients cannot release
  one another's active lease;
- the service object remains reusable after `stop`. A later panel open or
  `browser_*` agent operation lazily creates a new context against the same
  persistent profile;
- only HostRuntime disposal calls permanent `close()`, after which operations
  fail fast and cannot relaunch.

This distinction is required because frozen Host tool registrations retain the
shared service object. Treating panel close as permanent service disposal both
breaks later tool calls and leaves HostRuntime pointing at a dead resource.
Conversely, launching from `subscribe()` makes Chromium resident merely because
a Pi session was composed, even when no browser surface or tool is used.

The `@medv/finder` bundle entry is resolved relative to `@piwin/browser` via
`import.meta.url`, never relative to the Host process working directory. This
keeps post-launch initialization deterministic for repository-root, sidecar,
and packaged Host entry points.

Persistent Chromium already supplies one initial `about:blank` page. The
service reuses it instead of calling `newPage()` unconditionally and retaining
a redundant renderer. Runtime initialization is transactional: if Finder
injection or page setup fails after launch, the context is closed immediately,
the failed promise is cleared, and a later operation may retry.

### 3. Tool wiring in `@piwin/host-runtime`

`@piwin/host-runtime`, the product composition root, owns the BrowserSession and
wraps it into parent-owned `HostToolRegistration[]`. `@piwin/agent-host` remains
the Pi-only backend boundary and receives those registrations through the Host
tool port; it does not depend on `@piwin/browser`. The browser service is shared
app-wide, so agent tools and the Desktop mirror operate on the same reusable
session object.

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

User-initiated `browser/navigate` (panel URL bar, clicking a local `.html` /
`.htm` file) may open a `file:` URL in the same Chromium. Agent `browser_navigate`
still hard-denies non-http(s) schemes. Bare transcript chips such as `.html` or
`card.html` stay on Doc Preview so recovered fences are not forced through
`file:`.

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
- **Frame stream cost**: live mirror is JPEG via `page.screencast` (~12 fps,
  quality 80). CSS viewport stays 1280×800; Host-owned Chromium launches at
  `deviceScaleFactor: 2` and screencast `size` is CSS×DSF (default 2560×1600,
  longest-edge cap 2560). `browser/frame` width/height remain CSS px. Screenshots
  never enter model context as base64; only paths. **Known ceiling**: 2× JPEG
  data-URLs over Tauri IPC; a later iteration can serve frames from a local HTTP
  endpoint in `@piwin/browser` and have the panel `<img>` pull directly, bypassing
  the Rust bridge. See [browser workbench fidelity](../specs/2026-09-09-browser-workbench-fidelity.md).
- **Single shared service, leased process**: at most one Chromium runtime is
  active per Host. Mirror surfaces hold independent one-shot leases; releasing
  the final surface lease awaits process release, and later tools may relaunch.
  A tool-started runtime is shared for the browser workflow and is permanently
  released when HostRuntime disposes (a future run-scoped idle policy may retire
  tool-only runtimes earlier without changing this boundary).
- **`ref` lifetime**: snapshot `ref`s are valid until the next page change
  (same contract as `@playwright/mcp`). Pick results therefore carry both a
  `selector` (durable) and a `ref` (instant), so the agent can re-locate an
  attached element after navigation.
- **Headless bot-blocking**: `chromium.launch({ headless: true })` may be
  detected by some sites (Cloudflare bot mode). Documented as a known
  limitation; a headed/stealth option is deferred.
- **No `page.accessibility`**: it was removed in Playwright 1.x. All snapshot
  logic uses `ariaSnapshot({ mode: 'ai', boxes: true })` + `locator('aria-ref=…')`.
- **Snapshot parsing**: `ariaSnapshot({ mode: 'ai', boxes: true })` returns an
  indentation-based line format, not valid YAML — the `yaml` package folds
  indented `- child` lines into the parent scalar and throws
  `MULTILINE_IMPLICIT_KEY`. `@piwin/browser` derives the typed
  `BrowserSnapshotNode[]` with a small dedicated line parser (`src/snapshot.ts`);
  there is **no `yaml` dependency**.

## Alternatives considered

- **Bundle `@playwright/mcp` as an MCP server** (fastest). Rejected: two
  browser instances (MCP-internal vs panel), no panel-state access for element
  pick, coarse permission (server-trust only, not rule engine).
- **Native webview via Tauri multiwebview**. Rejected for agent control:
  no CDP on macOS/Linux. Could return later as a "user's own browsing" view.
- **Proxy-iframe interactive mirror (OpenHands-style URL rewriting)**. Rejected
  for the workbench in ADR 0057: a rewritten iframe is a second document
  (CSP / cookies / `X-Frame-Options`), so the user and agent diverge. In-panel
  interactivity is CDP screencast + input forwarding on the Host Chromium.

## Open questions / deferred

- `browser_navigate` uses `web-fetch` hostGlob rules with a **loopback-only**
  default for v1. A dedicated `browser` rule kind in `PermissionRuleTarget`
  (same pattern as ADR 0019 §8) is reserved for a follow-up migration, so users
  can express browser-specific allow/deny separately from `web_fetch`.
- Interactive in-panel clicking/typing: **done in ADR 0057** via CDP
  screencast + input forwarding + controller lock, **not** the proxy-iframe
  path considered here. Proxy-iframe remains rejected for the workbench
  (second document / CSP). Headed OS window stays a later escape hatch.
- Persistent browser sessions across app restarts (save/restore profile) —
  out of scope for v1.

### 2026-09-07 completeness amendment

Workbench recovery, default 1280×800 CSS viewport, public `page.screencast`
mirror, extra `browser_*` tools (including hover/select/check, tabs/dialog,
upload, console/network query), Host-owned headed launch, and explicit
loopback `connectOverCDP` shipped under
[`docs/plans/2026-09-07-browser-cdp-completeness.md`](../plans/2026-09-07-browser-cdp-completeness.md).
Chrome daily-session autoConnect remains an experiment. Dispatched writes are
never auto-replayed after recovery. Host detach of an attached CDP session
must not `context.close()` the user's browser. Live headed + loopback CDP
smoke on `79318f5c`:
[`docs/evidence/2026-09-08-host-browser-smoke-79318f5c.md`](../evidence/2026-09-08-host-browser-smoke-79318f5c.md).

### 2026-09-15 model-facing tool contract amendment

Slice A of
[`docs/specs/2026-09-12-browser-workbench-refactor.md`](../specs/2026-09-12-browser-workbench-refactor.md)
landed the model-facing half of the workbench refactor. Host tools keep the
ADR 0020 boundary (packages own their domain, Host composes) and stay
first-class direct tools — no `piwin_toolbox` ceremony.

- **Capability guidance**: `packages/host-runtime/src/browser-system-prompt.ts`
  injects one short browser workflow via the blueprint compiler, and only when
  the compiled Host surface actually exposes `browser_status` and
  `browser_snapshot`. Tool descriptions stay short instead of repeating a
  tutorial.
- **Status**: `browser_status` is documented as a side-effect-free entry point
  and now returns `controller`, `agentWantsLock`, `pendingDialog`, `mirror`
  plus a stable `nextAction` (`continue`, `read-only-or-wait-for-user`,
  `wait-for-recovery`, `restart`, `navigate-or-observe-will-start`).
- **Page identity**: navigation/click/type successes attach a lightweight
  `page` (`url`, `title`, `generation`, `pageId`, `pendingDialog`). Snapshots and
  screenshots are never attached automatically.
- **Control wording**: every write tool shares one suffix — idle writes
  auto-acquire agent control, a user-held lock returns
  `browser-user-has-control`, and read-only tools stay available meanwhile.
- **`browser_find`**: returns up to 20 candidates `{ text, ref? }` plus the
  total match count, derived from the same accessibility snapshot that produces
  refs. A node without a ref is reported as text only; no selector is invented.
- **`browser_scroll`**: accepts an optional `ref`/`selector` container and a
  bounded `amount` (1–2000 CSS px, default 400). Without a target the page root
  scrolls.
- **`browser_select_option`** accepts values only; labels and indices were
  removed from the description because they were never converted.
- **Screenshot evidence**: `browser_screenshot` reports
  `evidence.status` (`delivered` / `delegated` / `unavailable`). Media
  persistence failure no longer degrades to a dimensions-only success. Captures
  above the native image budget are re-encoded by
  `@piwin/media` `createModelImageDerivative` into a bounded JPEG for the model
  while the full-resolution original stays in the media library.
- **Error recovery**: browser error details carry `recovery` — the action to
  take instead of blindly retrying — while `retryable` keeps its narrow meaning
  ("the same call may be retried"). The previously unused `details.recovery`
  field was renamed `runtimeRecovery` to free the name for the spec'd action.
- **File size**: shared registration/result/prepare helpers moved to
  `browser-tool-helpers.ts`; `browser-tool-registrations.ts` left the >1000-line
  band (AGENTS.md §3.2).

Slices B–E of the same spec landed 2026-09-15 on Desktop + Host:

- **Slice B**: two-layer icon chrome, follow/fixed/mobile/custom viewport,
  fit/100% display, density warning, controller status dot.
- **Slice C**: Pointer Events with capture, modifier keys, pick-at as a
  read-only overlay, `generation + pageId + documentRevision` stale-target
  checks on input/pick.
- **Slice D**: `browser/capture` returns a media attachment (never base64);
  Desktop annotation overlay freezes the current frame and can add a PNG to
  the composer.
- **Slice E**: `browser/frame` uses a discriminated payload. Local sidecar
  keeps `inline` JPEG data URLs. Remote Host projects `{ kind: 'binary' }`
  and sends JPEG on the authenticated WebSocket (`PBF1` envelope, 12 MiB
  cap). Clients without the capability get `{ kind: 'unavailable' }` instead
  of `[redacted]`. Desktop decodes, pairs by `frameId`, and never replaces
  `<img src>` until `img.decode()` succeeds.

`HOST_WIRE_HARD_FRAME_BYTES` stays 1 MiB. `dataUrl` remains in
`REMOTE_SECRET_KEYS`.

