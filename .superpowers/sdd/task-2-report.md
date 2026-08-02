# Task 2 Report: `@piwin/browser` package

## Status

**COMPLETE.** New `@piwin/browser` package scaffolded, implemented, unit-tested (30 tests, browser-free), verified against real Chromium 149 via a one-time probe, workspace typecheck + full test suite green. Committed to `feat/browser-session` (no push).

## What was built

```
packages/browser/
  package.json        @piwin/browser, private, type: module, main/types/exports -> ./src/index.ts
  tsconfig.json       extends ../../tsconfig.base.json, outDir dist, rootDir src, include src/**/*.ts
  src/index.ts        public exports: session factory + session types + error classes ONLY
  src/browser-session.ts  createBrowserSession: lazy headless chromium, one page, browser-bus mutex,
                          navigate/click/type/fillForm/scroll/screenshot/back/forward/find/wait,
                          pickElementAt, subscribe (state+frame pushes), runExclusive, close, abort support
  src/snapshot.ts     parseAriaSnapshot (pure, line-based) + matchRefByPoint (ref-by-box matching)
  src/pick.ts         @medv/finder esbuild bundle injection + elementFromPoint pick flow
  src/frames.ts       createFrameLoop: throttled ~4fps JPEG frame capture, skips when no subscriber
  src/mutex.ts        createExclusiveQueue: promise-chain serialization ("browser bus")
  src/*.test.ts       colocated unit tests (30 tests, all browser-free, mock page/chromium)
```

Root `tsconfig.json` gained `{ "path": "packages/browser" }` in `references`.

Public API (index.ts) is intentionally narrow: `createBrowserSession`, `BrowserSession`,
`BrowserSessionOptions`, `BrowserSessionState`, `BrowserSessionEvent` (`browser/state` | `browser/frame`
extracted from contracts `HostPush`), `ScreenshotResult`, `RunExclusive`, and the error classes
(`BrowserSessionError`, `NavigateError`, `BrowserUnavailableError`, `AbortOperationError`). No internal
leakage.

## The real ariaSnapshot YAML format (for later tasks)

`page.locator('html').ariaSnapshot({ mode: 'ai', boxes: true })` returns an **indentation-based custom
line format**, NOT parseable YAML (verified: `yaml.parse` throws `MULTILINE_IMPLICIT_KEY`; it also folds
indented `- child` lines into the parent scalar). Real Chromium 149 output on a page with header/nav/main/footer:

```yaml
- document [ref=e1] [box=0,0,1280,308]:
  - generic [active] [ref=e2] [box=8,8,1264,292]:
    - banner [ref=e3] [box=8,8,1264,18]: Site header
    - navigation [ref=e4] [box=8,42,1264,36]:
      - list [ref=e5] [box=8,42,1264,36]:
        - listitem [ref=e6] [box=48,42,1224,18]:
          - link "Home" [ref=e7] [cursor=pointer] [box=48,42,39,18]:
            - /url: /a
    - main [ref=e10] [box=8,99,1264,166]:
      - heading "My page" [level=1] [ref=e11] [box=8,99,1264,37]
      - paragraph [ref=e12] [box=8,158,1264,18]: Hello world this is a paragraph.
      - button "Submit form" [ref=e13] [box=8,193,88,21]
      - checkbox "Agree terms" [checked] [ref=e14] [box=104,195,13,13]
      - text: Agree
      - textbox "Name" [ref=e15] [box=166,193,153,21]
      - list [ref=e16] [box=8,230,1264,36]:
        - listitem [ref=e17] [box=48,230,1224,18]: One
    - contentinfo [ref=e19] [box=8,282,1264,18]: Footer note
```

Grammar per line: `- <role> ["name"] [annotation]... [ref=eN] [box=x,y,w,h][: text]`

- **Nesting**: 2-space indent; children of a node are the lines indented under it. A node having children
  *also* ends with `:` (e.g. `document …:`), but the `:` is NOT required for a node to have children in the
  parser (indentation alone decides). Leaf text comes after `: `.
- **Annotations order is variable** (see `heading` has `[level=1]` before `[ref=e11]`; `link` has
  `[cursor=pointer]` before `[box=…]`). Parse them as a bag, keyed by `key=value` (or bare `[checked]`).
  Observed keys: `ref`, `box`, `level`, `checked` (bare = true), `active`, `cursor=pointer`, plus
  `selected`/`expanded`/etc. possible. `box` is viewport CSS px `x,y,w,h`.
- **Names**: `"…"` quoted, may contain spaces. Roles with visible text and no quoted name get the text in
  `name` (`paragraph …: Hello world` → name `Hello world`).
- **ARIA property children**: `- /url: /a` appears as a child of `link`. Preserved as role `/url`.
- **refs resolve** via `locator('aria-ref=e7')` (not CSS).
- Boxes can lie outside their parent's box (absolute-positioned elements) — don't validate containment.

## Key design decisions & deviations

1. **`yaml` dependency REMOVED (deviation from task brief/ADR 0020).** The brief and ADR listed `yaml`
   for snapshot parsing, but `yaml.parse` **cannot parse the real format** (verified empirically: it
   throws `MULTILINE_IMPLICIT_KEY` on the trailing-colon parent lines and folds indented children into the
   parent scalar). `snapshot.ts` therefore uses a ~100-line pure line parser (role/name/annotation
   extraction + indentation stack). `yaml` was removed from `@piwin/browser` to avoid an unused dependency
   (AGENTS.md §3.10.5). Re-add only if a later task actually needs YAML handling.
2. **`@medv/finder` bundle footer (critical for injection).** esbuild IIFE output is `var FinderModule = …`.
   Playwright evaluates `addInitScript({ content })` strings inside a function wrapper, so that top-level
   `var` is **function-scoped and never reaches `window`**. Fix: esbuild `footer: { js: 'window.FinderModule = FinderModule;' }`.
   Verified: without the footer, `window.FinderModule` is `undefined` in the page; with it, it is present.
3. **Context-level injection.** `injectFinder` is applied to the **BrowserContext before `newPage`**
   (not the page after), so the init script also runs on the initial `about:blank` and on every navigation.
   Note `page.setContent()` does NOT trigger init scripts — only real navigations do.
4. **No DOM lib.** tsconfig.base is `lib: ["ES2022"]` and playwright-core does not pull DOM lib in
   transitively (verified: no `/// <reference lib="dom" />`). All page-context code is a **script string**
   evaluated via `page.evaluate` (see `pickPageScript` in pick.ts).
5. **`exactOptionalPropertyTypes`**: all optional-field builders use conditional spread (`...(ref !== undefined ? { ref } : {})`).
6. **Browse-context pick**: `document.elementFromPoint(clampedX, clampedY)`, `@medv/finder` selector,
   bounded innerText/outerHTML (reuses contracts `MAX_WEB_ELEMENT_*_BYTES`), bounding rect, and best-effort
   ref via `matchRefByPoint` (deepest snapshot box containing the point).
7. **Errors** carry stable `name` (base `BrowserSessionError` with `override name: string`, subclasses
   override to their own literal).

## Verification

- `pnpm typecheck` (whole workspace): green.
- `pnpm test` (whole workspace): green, incl. `@piwin/browser` 30/30.
- Real-browser probe (run once against installed Chromium 149, then deleted): ariaSnapshot parsed to
  correct tree/refs/boxes; `pickElementAt` returned `selector:"button"`, `text:"Submit form"`,
  `ref:"e4"`, correct html/rect; `navigate`+`snapshot`+`subscribe` emitted `browser/state`+`browser/frame`.

## Tests (30, browser-free)

- `snapshot.test.ts` (7): real-format fixture → tree/ref/box/level/checked/name; `/url` children; matchRefByPoint deepest + miss.
- `pick.test.ts` (6): ref-by-box match; omit ref when no box; omit html when empty; snapshot-failure survival;
  PickError on no element; finder bundle contains global + footer + injectable.
- `frames.test.ts` (3): throttle (burst → 1 emission; 4fps ceiling); no emission without subscriber; no
  concurrent capture overlap.
- `browser-session.test.ts` (12): navigate rejects non-http(s)/empty without launching; accepts http(s);
  lazy-launch fail-fast with `pnpm --dir apps/desktop e2e:install` hint; headless once + page reuse;
  headed config; aria-ref vs css locator; runExclusive serialization; subscribe streams state+frame then
  stops; type/snapshot/wait-abort/screenshot-to-file/close.
- `mutex.test.ts` (2): serialization; queue survives a rejection.

## Concerns / for the parent agent

- **pnpm-lock.yaml is modified but intentionally NOT committed** (per the strict staging instruction
  `git add packages/browser tsconfig.json`). It registers `@medv/finder@4.0.2` + `esbuild@^0.25.0` for
  `@piwin/browser`. If the lockfile is left uncommitted, a fresh `pnpm install --frozen-lockfile` will
  fail. Recommend the parent commit the lockfile change (e.g. a follow-up `chore` or amend).
- **`yaml` removed** (see above) — task brief/ADR listed it; flagging so the parent can override if a
  later task depends on it. Re-add is `pnpm --filter @piwin/browser add yaml`.
- **Abort support is partial**: `wait()` fully abortable; other ops check the signal upfront but a
  mid-flight `page.goto`/`click` cannot be cancelled without Playwright route interception (documented
  limitation, out of v1 scope).
- **State push is chatty** on navigate (pushInitialState + `framenavigated` + `load` + post-goto emit) —
  up to ~4 `browser/state` events per navigation. Harmless; a later task may coalesce.
- **Finder selector quality** depends on the page; on minimal pages it may return a bare tag (`button`).
  The CSS selector is always valid, `ref` is best-effort (per ADR).
- **`setContent` does not run init scripts** — if Task 3/host tests inject fixtures via setContent, the
  finder global won't exist; use real navigations or `page.goto(data:…)`.

## Fix round 1

Review findings fixed in a corrective commit on top of the original work (`fix(browser): frame capture
error handling + snapshot text parsing`). Scope: `@piwin/browser` only. Not fixed per controller:
M-4, M-5, M-7, M-8, M-9 (recorded in ledger).

### Changes

- **I-1 (frames.ts:44-62)** — `attemptCapture` had `try/finally` with no `catch`, so a rejecting
  `options.capture()` escaped as an unhandled rejection from `void attemptCapture()` call sites and
  failed `navigate()`'s `await frameLoop.requestFrame()`. Added a `catch` that swallows the capture
  error with a comment (best-effort frame capture must not break navigation / produce unhandled
  rejections); the `finally` still resets `inFlight`/`pending`.
- **I-2 (snapshot.ts:102-153)** — `parseNodeLine` ran `applyAnnotations` over the whole remaining
  string including the `: text` suffix, and `rest_.replace(/\[[^\]]*\]/g,'')` stripped bracket tokens
  out of leaf text (`- text: see [1]` → name `see `) and fabricated annotations from text
  (`- paragraph: ref [ref=e9] x` → bogus `node.ref='e9'`). Added `splitTextSuffix` which splits the
  `: text` suffix off BEFORE annotation scanning (first `:` at bracket-depth zero; annotation tokens
  never contain `:`; text may contain colons/brackets). Annotations are applied only to the prefix;
  leaf text becomes the name when no quoted name is present (quoted name still wins).
- **M-1 (snapshot.ts:181)** — `match[1]!` → `match[1] ?? ''` (AGENTS.md §3.1).
- **M-6 (snapshot.ts:189-200)** — box guard checked only `x`; now `Number.isFinite` on all four fields.
- **M-2 (browser-session.ts)** — added `BrowserSessionClosedError` (stable name, exported from
  `index.ts`); `getPage()` now throws it when `closed`, so ops after `close()` fail fast instead of
  silently relaunching. `close()` stays idempotent (`if (closed) return`).
- **M-3 (browser-session.ts wait)** — the abort listener was never removed on the normal resolve path,
  leaking listeners on reused signals. The timer callback now `removeEventListener`s the abort handler
  before resolving (the abort path still self-removes via `{ once: true }`).

### Tests added

- `frames.test.ts` (+2): capture rejection → `requestFrame()` resolves (does not reject, navigate-style
  await safe) and the loop still emits on a later success; a pending request behind a rejecting capture
  both resolve and the pending drain retries (loop not wedged).
- `snapshot.test.ts` (+3): `- text: see [1]` → name `see [1]` (brackets preserved); `- paragraph: ref
  [ref=e9] x` → name `ref [ref=e9] x` with NO `node.ref`; annotations still extracted when they precede
  the text part.
- `browser-session.test.ts` (+3): ops after `close()` throw `BrowserSessionClosedError` (no relaunch,
  `launchMock` called once); `close()` is idempotent; `wait()` removes its abort listener on the normal
  resolve path (`vi.spyOn` on `removeEventListener`).

### Verification

- `pnpm typecheck` (whole workspace): green, exit 0.
- `pnpm --filter @piwin/browser test`: 5 files, **38 passed** (was 30; +8 new), exit 0.
- `pnpm test` (whole workspace): all packages green (browser 38/38; desktop 338; cli 19; no failures),
  exit 0.

### Files touched (all under `packages/browser`, committed)

- `src/frames.ts`, `src/frames.test.ts`
- `src/snapshot.ts`, `src/snapshot.test.ts`
- `src/browser-session.ts`, `src/browser-session.test.ts`
- `src/index.ts`
