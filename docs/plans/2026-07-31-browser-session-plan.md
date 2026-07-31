# Browser Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ADR 0020 — replace the iframe `BrowserPanel` with a real agent-controllable browser: remove the iframe preview, add a host-owned Playwright-driven browser service (`@piwin/browser`), wire `browser_*` tools into the host (snapshot/`ref` semantics matching `@playwright/mcp`), mirror the same instance into a desktop panel (screenshot frame stream), and support **element pick → attach to composer → model context injection** so the agent knows exactly which component the user means.

**Architecture:** Contracts-first. New `@piwin/contracts/src/browser.ts` (`WebElementAttachmentRef`, `WebElementPickResult`, `BrowserSnapshotNode`, `PromptAttachment` union, `formatTextModelWebElementInjection`); widen `PromptInput.attachments` to `PromptAttachment[]`. New application package `@piwin/browser` (depends on `@piwin/contracts` + `playwright-core` + `@medv/finder`; no Pi, no DOM, no agent-host). `@piwin/agent-host/browser-tools.ts` wraps the session into `HostToolDefinition[]` (existing pattern: `tools-web`, `gated-bash-tool.ts`). Desktop `BrowserSessionPanel` mirrors frames via new IPC commands/events. No UI→Pi, no circular deps, host boundary preserved.

**Tech Stack:** TypeScript (strict, NodeNext, ESM), vitest, pnpm workspace, Tauri 2 (desktop), `playwright-core` + `@medv/finder`.

**ADR:** `docs/adr/0020-browser-session.md`

## Global Constraints

- TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — never weaken without ADR.
- ESM only; relative imports use `.js` extensions (NodeNext).
- No `any`; prefer `unknown` + narrowing. No non-null assertion `!` except after runtime check in same block.
- No silent `catch {}` — AGENTS.md §3.3: log at boundary with context, or rethrow.
- Colocated tests: `foo.ts` + `foo.test.ts` in same `src/` dir.
- `pnpm typecheck` and `pnpm test` must stay green after every task.
- Keep diffs minimal — do not refactor unrelated code.
- No base64 in model context (AGENTS.md §3.6): frames/pick screenshots go to UI as data-URLs or are saved to `~/.piwin/media/<session>/` and injected as **paths** only.
- `browser_navigate`: **loopback only** (`localhost`, `127.0.0.1`, `::1`) allowed by default; **link-local/cloud metadata (`169.254.169.254`, `fe80::/10`) and private ranges (`10/8`, `172.16/12`, `192.168/16`, `fd00::/8`) go through the rule engine with default `ask`** — never blanket-allow private (SSRF). Agent navigations still honor the rule engine (bundled `ask`/`deny` + user `permissions.json`). Element pick/attach is user-initiated (no prompt).
- Snapshot `ref`s valid until next page change (`@playwright/mcp` semantics); pick results carry both a durable `selector` and instant `ref`.
- **No `page.accessibility`** — removed in Playwright 1.x. Snapshots use `locator('html').ariaSnapshot({ mode: 'ai', boxes: true })` (public API; indentation-based line format with `[ref=eN]` + `[box=x,y,w,h]` annotations); refs resolve via `locator('aria-ref=e5')`. The output is **not** parseable YAML (`yaml` folds the indented `- child` lines and throws `MULTILINE_IMPLICIT_KEY`) → parse into `BrowserSnapshotNode[]` with a dedicated line parser (**no `yaml` dep**).
- `@medv/finder` runs **in the page context** — bundle and inject via `page.addInitScript` before `elementFromPoint` picks.
- Agent tools + user pick share **one page**; serialize via an in-host mutex ("browser bus"); pick mode disabled while an agent tool runs (concurrency, ADR §6).
- `playwright-core` does not download browsers; reuse chromium from `pnpm --dir apps/desktop e2e:install` (`playwright install chromium`), document fallback, add a doctor check. Production chromium bundling is a follow-up (ADR Consequences).
- New package `@piwin/browser` must be added to root `tsconfig.json` `references` (pnpm workspace already globs `packages/*`).
- `exactOptionalPropertyTypes` is on: never assign `undefined` to optional fields (`ref?`, `html?`, `screenshotPath?`) — use conditional spread in builders.
- Intentional CLI degradation: `browser_*` tools work in CLI sessions; the visual panel is desktop-only (documented, not a bug).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `apps/desktop/src/browser-panel.tsx` | iframe preview | **Delete** (Task 0) |
| `apps/desktop/src/browser-panel.test.ts` | iframe tests | **Delete** (Task 0) — **port** `normalizeUrl` + tests to `normalize-url.ts` (new panel's URL bar needs it) |
| `apps/desktop/src/normalize-url.ts` | URL bar normalization (ported from browser-panel) | Create (Task 0) |
| `apps/desktop/src/App.tsx` | remove `BrowserPanel` import + `browserContent` | Modify (Task 0) |
| `apps/desktop/src/right-panel.tsx` | remove `browserContent` prop + `case 'browser'` | Modify (Task 0) |
| `apps/desktop/src/right-panel-memory.ts` | remove `'browser'` from `RightPanelTabKind` + `ALLOWED_KINDS` | Modify (Task 0) |
| `apps/desktop/src/right-panel-sections.tsx` | remove browser `SECTION_META` entry + `IconBrowser` import | Modify (Task 0) |
| `apps/desktop/src/shell-icons.tsx` | remove `IconBrowser` (verified only used by sections) | Modify (Task 0) |
| `apps/desktop/src/styles/region-inspector.css` | remove `.browser-panel*` styles; keep `.canvas-panel`/`.side-chat-panel` group | Modify (Task 0) |
| `packages/contracts/src/browser.ts` | browser contracts + `formatTextModelWebElementInjection` | Create (Task 1) |
| `packages/contracts/src/host.ts` | `PromptInput.attachments` → `PromptAttachment[]` | Modify (Task 1) |
| `packages/contracts/src/ipc.ts` | browser `HostCommand` + `HostPush` variants | Modify (Task 1) |
| `packages/contracts/src/index.ts` | export `browser.js` | Modify (Task 1) |
| `packages/browser/package.json` | workspace pkg: contracts + playwright-core + @medv/finder (no yaml) | Create (Task 2) |
| `packages/browser/tsconfig.json` | package tsconfig (extends base) | Create (Task 2) |
| `packages/browser/src/browser-session.ts` | owns Chromium, navigate/snapshot/click/type/pick | Create (Task 2) |
| `packages/browser/src/snapshot.ts` | `ariaSnapshot({ mode:'ai', boxes:true })` line format → `BrowserSnapshotNode[]` (ref + box parse, no yaml) | Create (Task 2) |
| `packages/browser/src/pick.ts` | `elementFromPoint` + injected `@medv/finder` selector + ref-by-box + bounded text/html + crop | Create (Task 2) |
| `packages/browser/src/frames.ts` | throttled screenshot frame capture (JPEG, size-capped) | Create (Task 2) |
| `packages/browser/src/index.ts` | public exports (no Pi, no DOM) | Create (Task 2) |
| `packages/browser/src/*.test.ts` | unit tests: snapshot shape, selector stability, pick bounds, frame throttle | Create (Task 2) |
| `packages/agent-host/src/browser-tools.ts` | wrap session into `HostToolDefinition[]` | Create (Task 3) |
| `packages/agent-host/src/browser-tools.test.ts` | tool schema + execute wiring (mock session) | Create (Task 3) |
| `packages/agent-host/src/sdk-adapter.ts` | register browser tools into session | Modify (Task 3) |
| `packages/agent-host/src/host-runtime.ts` | `buildModelPromptInput` handles `WebElementAttachmentRef` + injection; browser session lifecycle | Modify (Task 3) |
| `packages/agent-host/src/commands/browser-commands.ts` | IPC handlers: `browser/navigate`, `browser/pick-at`, `browser/start`, `browser/screenshot` | Create (Task 3) |
| `packages/agent-host/src/commands/browser-commands.test.ts` | IPC command fixtures | Create (Task 3) |
| `packages/agent-host/src/permission-context.ts` | `browser-navigate` action kind (inverted private default) | Modify (Task 3) |
| `apps/desktop/src/browser-session-panel.tsx` | mirrored frame stream + URL bar + pick mode + composer chip | Create (Task 4) |
| `apps/desktop/src/browser-session-panel.test.tsx` | panel render + pick forwarding (mock host) | Create (Task 4) |
| `apps/desktop/src/host-client.ts` / adapters | browser commands/events plumbing | Modify (Task 4) |
| `apps/desktop/src/App.tsx` | wire `BrowserSessionPanel` back into `browserContent` (new slot) | Modify (Task 4) |
| `apps/desktop/src/composer-dock.tsx` / `MediaPreview.tsx` | render `WebElementAttachmentRef` chips (composer + chat preview) | Modify (Task 4) |
| `apps/desktop/src/run-activity-icon.ts` | keep `tool.includes('browser')` → 'web' (already present) | No change |
| `docs/architecture.md` | add `@piwin/browser` to package map + browser section | Modify (Task 5) |
| `docs/plans/2026-07-31-browser-session-plan.md` | this plan | Create (Task 5) |
| `apps/cli/src` | optional `browser` status note in `doctor` (chromium presence) | Modify (Task 5) |

---

## Task 0: Remove the iframe `BrowserPanel`

**Why:** ADR 0020 §1. Clean cut before adding the new browser — the iframe cannot be evolved into a controllable browser, and keeping it invites a permanent hack.

- [ ] **Step 1: Port `normalizeUrl`** — copy `normalizeUrl` (`browser-panel.tsx:11`) + its test cases to `apps/desktop/src/normalize-url.ts` (new panel's URL bar reuses it). Then delete `browser-panel.tsx` and `browser-panel.test.ts`.
- [ ] **Step 2: Remove desktop references**
  - `App.tsx`: remove `import { BrowserPanel } from './browser-panel'` and `browserContent={<BrowserPanel />}` (leave the prop slot for Task 4).
  - `right-panel.tsx`: remove `browserContent?: ReactNode` prop and `case 'browser'`.
  - `right-panel-memory.ts`: remove `'browser'` from `RightPanelTabKind` and `ALLOWED_KINDS`.
  - `right-panel-sections.tsx`: remove the browser `SECTION_META` entry and `IconBrowser` import.
  - `shell-icons.tsx`: remove `IconBrowser` (verified only referenced by sections).
  - `region-inspector.css`: remove `.browser-panel*` rules; keep `.canvas-panel`, `.side-chat-panel`.
- [ ] **Step 3: Verify green** — `pnpm typecheck && pnpm test`. Confirm no lingering `browser-panel`/`IconBrowser`/`'browser'` references (grep). Do **not** touch `run-activity-icon.ts` (agent tool icon mapping — keep) or `app-dialogs.tsx` (unrelated "Browser preview cannot open…" copy).

## Task 1: Contracts — browser types and attachment union

**Files:** create `packages/contracts/src/browser.ts`; modify `host.ts`, `ipc.ts`, `index.ts`.

**Why:** ADR 0020 §4. Contracts-first (AGENTS.md §1.3). Attach flow mirrors ADR 0005 / `formatTextModelImageInjection`.

- [ ] **Step 1: Create `browser.ts`**

```ts
export type BrowserSnapshotNode = {
  role: string; name?: string; ref?: string;
  level?: number; checked?: boolean; children: BrowserSnapshotNode[];
};

export type WebElementPickResult = {
  url: string; selector: string; ref?: string;
  text: string; html?: string;
  boundingRect: { x: number; y: number; width: number; height: number };
  screenshotPath?: string;
};

export type WebElementAttachmentRef = {
  id: string; kind: 'web-element'; url: string; selector: string;
  ref?: string; text: string; html?: string; screenshotPath?: string;
};

export type PromptAttachment = MediaAttachmentRef | WebElementAttachmentRef;

export function formatTextModelWebElementInjection(ref: WebElementAttachmentRef): string;
```
  - Injection format (model-facing, **no base64**):
    `[attached web element]\nurl: <url>\nselector: <selector>\ntext: <text bounded>\n[html: <bounded>]\n[screenshot path: <path>]`
  - Bounds: `text` ≤ ~2 KB, `html` ≤ ~8 KB (constant in `browser.ts`).
- [ ] **Step 2: Widen attachments** in `host.ts`: `PromptInput.attachments?: PromptAttachment[]` and `AgentMessageView.attachments?: PromptAttachment[]`. Import `MediaAttachmentRef` type (keep `MediaAttachmentRef` exported for back-compat; add `PromptAttachment`).
- [ ] **Step 3: IPC variants** in `ipc.ts`:
  - `HostCommand`: `browser/start`, `browser/navigate { url }`, `browser/pick-at { x, y }`, `browser/screenshot { path? }`, `browser/stop`.
  - `HostPush`: `browser/frame { dataUrl, width, height, ts }`, `browser/state { url?, title?, ts }`, `browser/picked { result: WebElementPickResult }`.
- [ ] **Step 4: Export** `browser.js` from `index.ts`.
- [ ] **Step 5: Typecheck ripple** — update implementers of `PromptInput.attachments` (`host-runtime.ts`, `transcript-recorder.ts`, `mock-session.ts`, `product-shell-session.ts`, and tests) to compile against `PromptAttachment[]`. Existing `MediaAttachmentRef` usages keep working via the union; add narrowing in consumers that assume image fields.

## Task 2: `@piwin/browser` package — Playwright session service

**Files:** `packages/browser/` (package.json, tsconfig, src/browser-session.ts, src/snapshot.ts, src/pick.ts, src/frames.ts, src/index.ts, tests).

**Why:** ADR 0020 §2. Pure capability service below the host boundary; agent tools + panel both consume one instance.

- [ ] **Step 1: Scaffold package** — `package.json` (`@piwin/browser`, workspace `type: module`, deps `@piwin/contracts: workspace:*`, `playwright-core`, `@medv/finder` — **no `yaml`**; scripts build/typecheck/test like `tools-web`). tsconfig extends base. **Add `packages/browser` to root `tsconfig.json` `references`.**
- [ ] **Step 2: `browser-session.ts`** — `createBrowserSession(options)`:
  - Lazy `chromium.launch({ headless: true })`; resolve executable from `playwright install chromium` path (reuse e2e install via `pnpm --dir apps/desktop e2e:install`); fail fast with actionable error if missing.
  - One page/context; `navigate(url)`, `snapshot()`, `click(ref|selector)`, `type(ref|selector, text)`, `fillForm`, `scroll`, `screenshot(path?)`, `back/forward`, `find(text)`, `wait`.
  - **Serialization mutex ("browser bus")**: all operations (tool calls + pick) acquire one in-process lock; a pick in flight queues or cancels against an in-progress tool call. Expose `runExclusive<T>(fn)`.
  - Emits URL/title + throttled frames via subscriber callbacks (unsubscribe fn returned).
  - Abortable long ops via `AbortSignal`.
- [ ] **Step 3: `snapshot.ts`** — snapshot via **`page.locator('html').ariaSnapshot({ mode: 'ai', boxes: true })`** (NOT `page.accessibility` — removed in 1.x). The output is an indentation-based line format (`- role "name" [ref=eN] [box=x,y,w,h]`, annotations as an order-independent bag), **not** parseable YAML — derive `BrowserSnapshotNode[]` with a small dedicated line parser (**no `yaml` dep**), preserving `[ref=eN]` and `[box=x,y,w,h]` (viewport CSS px). Refs resolve via `page.locator('aria-ref=e5')`. Pure + unit-testable: raw snapshot fixture → expected tree.
- [ ] **Step 4: `pick.ts`** — `pickElementAt(page, x, y)`:
  - **Inject `@medv/finder` via `page.addInitScript`** (page-context lib; re-inject on every navigation) so `findElement` is available inside `page.evaluate`.
  - `page.evaluate(elementFromPoint(x,y))` → clamp to element; compute stable selector via `@medv/finder`; extract bounded `innerText`/`outerHTML`; bounding rect.
  - Best-effort `ref`: match the click point against the latest `ariaSnapshot({ mode:'ai', boxes:true })` `[box=…]` annotations → the enclosing ref'd element's `ref` (reliable for interactive elements; else omit). CSS `selector` is the durable anchor.
  - Optional element-cropped screenshot (clip to rect) saved by caller.
- [ ] **Step 5: `frames.ts`** — throttled frame capture: `page.screenshot({ type:'jpeg', quality: 70 })` at ≤ ~4 fps, max dimension ~1280, base64 data-URL; skip when no subscriber. Documented ceiling: data-URL over IPC is MVP; local HTTP frame server is a follow-up.
- [ ] **Step 6: Unit tests** — snapshot shape/ref/box parsing from line-format fixture; pick selector stability + bounds + ref-by-box matching; frame throttle (n calls → ≤ n/fps emissions); navigate rejects non-http(s); mutex serializes concurrent calls.
- [ ] **Step 7: Public exports** in `index.ts` — session factory + types; nothing else.

## Task 3: Host wiring — tools, permission, IPC, attachment injection

**Files:** create `browser-tools.ts` (+ test) and `commands/browser-commands.ts` (+ test) in `agent-host`; modify `sdk-adapter.ts`, `host-runtime.ts`, `permission-context.ts`.

**Why:** ADR 0020 §3, §5. Host registers tools; same pattern as `tools-web`/`gated-bash-tool`.

- [ ] **Step 1: `browser-tools.ts`** — `createBrowserToolDefinitions(session)` returns `HostToolDefinition[]`:
  - `browser_navigate { url }` — gated by permission (see Step 3).
  - `browser_snapshot {}` → JSON tree with `ref`s.
  - `browser_click { ref | selector }`, `browser_type { ref | selector, text }`, `browser_fill_form { fields[] }`, `browser_scroll { direction }`, `browser_screenshot { path? }`, `browser_find { text }`, `browser_back`, `browser_forward`, `browser_wait { ms }`.
  - Descriptions mirror `@playwright/mcp` so agents know the semantics.
- [ ] **Step 2: Register in `sdk-adapter.ts`** — append browser tools alongside web/knowledge tools when a browser session is available.
- [ ] **Step 3: Permission** — `permission-context.ts`: `browser-navigate` subject. In `browser-tools.ts`, before navigate: **loopback (`localhost`/`127.0.0.1`/`::1`) allowed by default (dev preview); link-local (`169.254.169.254`, `fe80::/10`) and private ranges (`10/8`, `172.16/12`, `192.168/16`, `fd00::/8`) go through the rule engine with default `ask`** — never blanket-allow private (SSRF, ADR §5). Reuse `isPrivateOrLocalHostname` / `isPrivateOrLocalIpAddress` from `@piwin/tools-web` (both exported) for classification.
- [ ] **Step 4: `host-runtime.ts`** — `buildModelPromptInput`: when `attachment.kind === 'web-element'`, validate `screenshotPath` stays under media root via `assertInsideMediaRoot` (same guard `validateMediaAttachment` uses), inject `formatTextModelWebElementInjection`. Host owns one `BrowserSession` per app run (lazy start on first browser command/panel open; dispose on host shutdown). Wrap tool calls + pick through the session's mutex so agent actions and user picks never interleave.
- [ ] **Step 5: `browser-commands.ts`** — IPC handlers for `browser/*` commands; wire `browser/frame|state|picked` pushes. All handlers acquire the session mutex (single logical resource).
- [ ] **Step 6: Tests** — tool schema golden (names/params); execute path with a mock session; permission: loopback allowed, link-local/private default `ask`, public follows rules; injection output golden; attachment outside media root rejected (mirror `validateMediaAttachment`); mutex serializes a concurrent tool call + pick.

## Task 4: Desktop — browser session panel + pick-to-composer

**Files:** create `browser-session-panel.tsx` (+ test); modify `host-client.ts`/adapters, `App.tsx`, composer attachments.

**Why:** ADR 0020 §6. User sees == agent controls; pick → attach → inject.

- [ ] **Step 1: `host-client.ts`/adapters** — expose `browser` commands + subscribe to `browser/*` pushes (mirror existing command/event plumbing).
- [ ] **Step 2: `browser-session-panel.tsx`** — renders frame stream (`<img>` from data-URL), URL bar bound to `browser/state` (reuse `normalize-url.ts`), pick-mode toggle. In pick mode: click → forward **scaled coordinates** (screenshot px ÷ `img` CSS scale → viewport CSS px, matching `ariaSnapshot` `[box=…]` units) → `browser/pick-at` → on `browser/picked`, draw overlay highlight from `boundingRect` + add a composer chip. Disable pick mode while an agent tool is running (ADR §6 concurrency). Use `normalizeUrl` from `normalize-url.ts` for the URL bar.
- [ ] **Step 3: Composer** — in `composer-dock.tsx` render `WebElementAttachmentRef` chips (URL + selector + bounded text preview); on send, host injects model-facing text. Extend `MediaPreview.tsx`/`chat-thread.tsx` if a chat-side preview is desired. `exactOptionalPropertyTypes`: build attachment objects with conditional spread (no `ref: undefined`).
- [ ] **Step 4: Wire in `App.tsx`** — set `browserContent={<BrowserSessionPanel />}` (reuse the slot vacated in Task 0).
- [ ] **Step 5: Tests** — panel renders a frame + URL bar; pick forwarding calls `browser/pick-at` with scaled coords and shows chip on `browser/picked` (mock host client).
- [ ] **Step 6: Manual smoke** — open panel → navigate to localhost:3000 → agent drives the same page via `browser_navigate`/`browser_click` → pick an element → attach → send → model sees URL/selector/text.

## Task 5: Docs + CLI parity + verification

**Files:** modify `docs/architecture.md`, `apps/cli/src` (doctor), this plan.

**Why:** AGENTS.md §3.10 (docs on architecture/user-visible change), intentional CLI degradation documented.

- [ ] **Step 1: `docs/architecture.md`** — add `@piwin/browser` to package map (§4) + a "Browser Session" subsection (§7-area) describing agent tools, panel mirror, pick→attach, permission default.
- [ ] **Step 2: CLI doctor** — report chromium presence (reuse `playwright-core` executable check) with actionable install hint.
- [ ] **Step 3: Final verification** — `pnpm typecheck`, `pnpm test`, `pnpm --dir apps/desktop e2e` (browser-shell smoke unaffected), and manual browser smoke listed in PR notes.

---

## Definition of Done

- [ ] `browser-panel.tsx` + `.test.ts` deleted; `normalizeUrl` ported to `normalize-url.ts` with tests; no `browser-panel`/`IconBrowser`/panel `'browser'` references remain.
- [ ] `@piwin/browser` package typechecks + unit tests pass (snapshot/ref/box via `ariaSnapshot({mode:'ai',boxes:true})`, pick selector + ref-by-box, bounds, frame throttle, mutex serialization). Uses a dedicated line parser (**no `yaml` dep**); **no `page.accessibility`** anywhere.
- [ ] `@piwin/browser` added to root `tsconfig.json` `references`; package builds under `exactOptionalPropertyTypes` (conditional spread for optional fields).
- [ ] Host registers `browser_*` tools; `browser_navigate` permission: **loopback allowed by default, link-local/private default `ask`** (no SSRF hole); attachment injection no-base64, `screenshotPath` guarded by `assertInsideMediaRoot`.
- [ ] Desktop panel mirrors the agent's browser; pick → scaled-coordinate forwarding → composer chip → model-facing injection works end-to-end; pick mode disabled during agent tool runs.
- [ ] `docs/architecture.md` updated; CLI doctor reports chromium.
- [ ] ADR 0020 referenced from this plan; no AGENTS.md violations (host boundary, contracts-first, no UI→Pi, no base64 in context).
