# Browser takeover workbench — implementation plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`)
> syntax. Do not skip contracts. Do not grow `browser-session.ts` or
> `host-runtime.ts` with the new logic — compose new modules. Stop after each
> task and keep `pnpm typecheck` + touched-package tests green.

| Field | Value |
|-------|-------|
| Date | 2026-08-19 |
| Status | Ready to implement |
| Decision | [ADR 0057](../adr/0057-browser-takeover-workbench.md) (amends [ADR 0020](../adr/0020-browser-session.md)) |
| Product | Right-panel browser becomes a shared workbench: live page, human input, agent lock / Take over |

**Goal:** The user and the agent drive the **same** Host-owned Playwright Chromium. The panel is no longer a 2–4 fps screenshot monitor. Default mode is Interact (click / type / scroll / IME). The agent can take the page; the human can take it back. Streaming a coding turn that never touches the browser must **not** freeze the panel.

**Architecture:** Contracts-first. Controller lock lives in `@piwin/browser` as a pure state machine. CDP screencast + input dispatch are Host-side. Desktop only forwards coordinates/keys and renders `browser/frame` + `browser/controller`. No UI→Pi. No second iframe document. No headed OS window as the primary UI.

---

## Outcome (what “done” looks like)

1. Opening the right-panel Browser shows a live-enough page (~12–15 fps screencast, fallback to today’s screenshot loop).
2. The user can click, scroll, type, and compose Chinese in that page (IME via `insertText`).
3. Agent write tools (`navigate` / `click` / `type` / `fill_form` / `scroll` / `back` / `forward`) auto-acquire `agent` from `idle`. Banner: “Agent is using the browser” + **Take over**.
4. After Take over, the next agent write returns `code: 'browser-user-has-control'` (`retryable: false`). **Give back** returns the lock to the agent if a run still wants it.
5. Run terminal releases `agent` → `idle`. A coding turn with no browser tools leaves the panel interactive.
6. Pick mode still attaches a composer chip. Console/network drawer works while the panel is open.
7. CLI still has `browser_*` + lock; no visual panel (intentional degradation).

## Out of scope (do not implement)

- Proxy-iframe / URL rewriting
- Headed Chromium window as the primary UI (“Open in window” later)
- Multi-tab, drag-and-drop, `<input type=file>`
- Stealth / anti-bot, production Chromium bundling
- HTTP/WebSocket frame server (ADR 0020 follow-up; keep `browser/frame` data-URL)

## Global constraints

- TypeScript strict + `exactOptionalPropertyTypes`; ESM; `.js` in relative imports; `import type` for types.
- No `any`. No `!` without a same-block runtime check. No silent `catch {}`.
- No base64 in **model** context. Screencast frames may be data-URLs on `browser/frame` (UI-only, same as today).
- User input / Take over / Give back / pick are user-initiated — no permission prompt. Agent `browser_navigate` permission is unchanged (loopback allow, else ask).
- One Chromium per Host. Agent tools + user input + pick serialize on the existing browser-bus mutex, except coalesced `mouse move` which may skip the queue.
- `browser-session.ts` is ~660 lines — **split, do not append**. Hard cap 1000 lines on every new/updated source file. `region-inspector.css` is already over cap: **do not add rules there**.
- `host-runtime.ts` is a god module. Takeover may add **at most a few lines** in `onRunTerminal` / `ensureBrowserSession`. Everything else goes in `@piwin/browser` or `browser-commands.ts` / `browser-tools.ts`.
- `ToolResultErrorCode` is a closed union. `browser-user-has-control` must be added there (contracts-first), not stuffed into `execution-failed`.
- `classifyHostPush` is exhaustive (`assertNever`). Adding `browser/controller` **requires** a new case or typecheck fails.
- Intentional CLI degradation: tools + lock work; visual workbench is desktop-only.

## Controller (normative)

```text
idle  -- user input / user chrome / takeOver -->  user   (agentWantsLock unchanged)
idle  -- agent write / browser_lock lock     -->  agent  (agentWantsLock = true)
agent -- takeOver                            -->  user   (agentWantsLock stays true)
agent -- browser_unlock / run terminal       -->  idle   (agentWantsLock = false)
user  -- giveBack and agentWantsLock         -->  agent
user  -- giveBack and not agentWantsLock     -->  idle
user  -- agent acquire / browser_lock lock   -->  FAIL (never auto-steal)
```

| Actor | Allowed when | Denied when |
|-------|--------------|-------------|
| User pointer / key / IME / pick | `idle` (promotes to `user`) or `user` | `agent` |
| User URL bar / reload / back / forward | `idle` or `user` | `agent` (controls disabled; Take over is the path) |
| Agent write tools | `idle` (auto-lock) or `agent` | `user` → `browser-user-has-control` |
| Agent read tools (`snapshot`, `screenshot`, `find`, `wait`) | any owner | never (still on mutex) |
| Take over | always (no prompt) | — |
| Give back | `user` | no-op otherwise |

`state.streaming` is **not** the lock. Delete `agentRunning` from the panel.

---

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/contracts/src/browser.ts` | `BrowserController`, `BrowserInputEvent`, `BrowserControllerPush`, `BROWSER_USER_HAS_CONTROL` | Modify (T1) |
| `packages/contracts/src/browser.test.ts` | type-level / constant tests if needed | Modify (T1) |
| `packages/contracts/src/ipc.ts` | `browser/input`, `browser/lock`, `browser/unlock`; `browser/controller` push | Modify (T1) |
| `packages/contracts/src/tool-result.ts` | add `'browser-user-has-control'` to `ToolResultErrorCode` | Modify (T1) |
| `packages/host-transport/src/host-push-policy.ts` | classify `browser/controller` as **control** | Modify (T1) |
| `packages/host-transport/src/host-push-policy.test.ts` | golden for `browser/controller` | Modify (T1) |
| `packages/browser/src/controller.ts` | pure lock state machine | Create (T2) |
| `packages/browser/src/controller.test.ts` | transition table | Create (T2) |
| `packages/browser/src/screencast.ts` | CDP `Page.startScreencast` + ack; start/stop | Create (T3) |
| `packages/browser/src/screencast.test.ts` | ack + emit + stop; start-fail | Create (T3) |
| `packages/browser/src/input.ts` | dispatch `BrowserInputEvent[]` onto Playwright `Page` | Create (T3) |
| `packages/browser/src/input.test.ts` | mouse/key/insertText mapping | Create (T3) |
| `packages/browser/src/browser-session.ts` | compose controller + screencast + input; `actor` on writes; `dispatchInput`; `releaseAgentControl` | Modify (T3) |
| `packages/browser/src/browser-session.test.ts` | auto-lock, deny user-has-control, screencast fallback, console-on-lease | Modify (T3) |
| `packages/browser/src/index.ts` | export new types/errors | Modify (T3) |
| `packages/host-runtime/src/browser-tools.ts` | `browser_lock`; write-tool gate; descriptions | Modify (T4) |
| `packages/host-runtime/src/browser-tools.test.ts` | schema 12 tools; user-has-control; lock/unlock | Modify (T4) |
| `packages/host-runtime/src/commands/browser-commands.ts` | `browser/input` `lock` `unlock` | Modify (T4) |
| `packages/host-runtime/src/commands/browser-commands.test.ts` | new commands + mutex | Modify (T4) |
| `packages/host-runtime/src/host-runtime.ts` | `onRunTerminal` → `releaseAgentControl()` only | Modify (T4) |
| `apps/desktop/src/host-client.ts` | `browserInput` / `browserLock` / `browserUnlock` | Modify (T5) |
| `apps/desktop/src/host-client-mock.ts` | mock arms for input/lock/unlock + controller push | Modify (T5) |
| `apps/desktop/src/browser-workbench-ime.ts` | compositionend / paste → `insertText`; special keys | Create (T5) |
| `apps/desktop/src/browser-workbench-ime.test.ts` | IME mapping | Create (T5) |
| `apps/desktop/src/browser-workbench-pointer.ts` | display px → CSS viewport events; move coalesce | Create (T5) |
| `apps/desktop/src/browser-workbench-pointer.test.ts` | scale + coalesce | Create (T5) |
| `apps/desktop/src/browser-console-drawer.tsx` | console/network list | Create (T5) |
| `apps/desktop/src/browser-console-drawer.test.tsx` | cap + render | Create (T5) |
| `apps/desktop/src/browser-session-panel.tsx` | Interact default, banner, wire IME/pointer/drawer | Modify (T5) |
| `apps/desktop/src/browser-session-panel.test.tsx` | interact vs pick; takeover; streaming does not block | Modify (T5) |
| `apps/desktop/src/App.tsx` | stop passing `agentRunning={state.streaming}` | Modify (T5) |
| `apps/desktop/src/styles/browser-session.css` | **move** existing `.browser-session-*` + new workbench rules | Create (T5) |
| `apps/desktop/src/styles.css` | `@import` the new stylesheet | Modify (T5) |
| `apps/desktop/src/styles/region-inspector.css` | delete moved `.browser-session-*` block | Modify (T5) |
| `docs/architecture.md` §8 | workbench + controller | Modify (T6) |

---

## Task 1: Contracts + push policy

**Why:** New IPC and a closed `ToolResultErrorCode` must land before any implementer. `classifyHostPush` will not compile until it handles `browser/controller`.

- [ ] **Step 1 — `packages/contracts/src/browser.ts`**

Append (keep existing pick/injection helpers):

```ts
export type BrowserController = 'idle' | 'user' | 'agent';

export type BrowserInputEvent =
  | {
      type: 'mouse';
      action: 'down' | 'up' | 'move' | 'wheel';
      x: number;
      y: number;
      button?: 'left' | 'middle' | 'right';
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
    }
  | { type: 'key'; action: 'down' | 'up'; key: string }
  | { type: 'insertText'; text: string };

/** Stable tool / session error when the human holds the workbench. */
export const BROWSER_USER_HAS_CONTROL = 'browser-user-has-control';

export type BrowserControllerPush = {
  type: 'browser/controller';
  owner: BrowserController;
  ts: number;
  /** True while a run acquired agent control and has not released it. */
  agentWantsLock?: boolean;
  reason?: string;
};
```

Optional fields: conditional spread only (`exactOptionalPropertyTypes`).

- [ ] **Step 2 — `ipc.ts`**

`HostCommand` (next to existing `browser/*`):

```ts
| { id?: string; type: 'browser/input'; events: BrowserInputEvent[] }
| { id?: string; type: 'browser/lock'; owner: 'agent' | 'user' }
| { id?: string; type: 'browser/unlock'; owner: 'agent' | 'user' }
```

`HostPushVariant`:

```ts
| BrowserControllerPush
```

Import `BrowserInputEvent` / `BrowserControllerPush` from `./browser.js`.
Keep `browser/frame` shape: `{ dataUrl, width, height, ts }`.

**Coordinate invariant (document in a 3-line comment on the frame variant):**
`width` / `height` are **CSS viewport px** (screencast `metadata.deviceWidth/Height` or Playwright `viewportSize`), not JPEG bitmap px. The panel maps clicks with these values vs `img.clientWidth`, never `img.naturalWidth`.

- [ ] **Step 3 — `tool-result.ts`**

Add `'browser-user-has-control'` to `ToolResultErrorCode`. Grep the repo for exhaustive switches on that union and update (expect `host-tool-execution-router` alias only; no extra mapping required).

- [ ] **Step 4 — `classifyHostPush`**

```ts
case 'browser/controller':
  return control([deliveryKey('browser', 'controller')]);
```

Control (not projection): lock transitions must not be coalesced away. Add a test in `host-push-policy.test.ts`.

- [ ] **Step 5 — Verify**

```bash
pnpm --dir packages/contracts typecheck
pnpm --dir packages/host-transport test
pnpm --dir packages/contracts test
```

`host-transport` typecheck/test **must** fail until Step 4 is done — that is the acceptance signal that the new push is wired.

---

## Task 2: Pure controller

**Why:** Lock policy must be testable without Chromium or IPC.

- [ ] **Step 1 — `packages/browser/src/controller.ts`**

```ts
export type BrowserControllerState = {
  owner: BrowserController;
  agentWantsLock: boolean;
};

export type AcquireResult =
  | { ok: true; state: BrowserControllerState; changed: boolean }
  | { ok: false; code: typeof BROWSER_USER_HAS_CONTROL; state: BrowserControllerState };

export function createBrowserController(): {
  snapshot(): BrowserControllerState;
  acquire(owner: 'agent' | 'user'): AcquireResult;
  release(owner: 'agent' | 'user'): BrowserControllerState;
  takeOver(): BrowserControllerState;      // always → user
  giveBack(): BrowserControllerState;      // user → agent if agentWantsLock else idle
  releaseAgentControl(): BrowserControllerState; // run terminal / unlock
};
```

Rules:

- `acquire('user')` from `idle` → `user`; from `user` → ok unchanged; from `agent` → **fail** (human chrome must not steal; panel disables chrome instead). `takeOver()` is the only user path that steals from `agent`.
- `acquire('agent')` from `idle` → `agent` + `agentWantsLock=true`; from `agent` → ok; from `user` → `{ ok: false, code: BROWSER_USER_HAS_CONTROL }`.
- `takeOver()` always sets `owner='user'`. Does not clear `agentWantsLock`.
- `giveBack()`: if `owner!=='user'` return snapshot; if `agentWantsLock` → `agent`; else → `idle`.
- `releaseAgentControl()`: if `owner==='agent'` → `idle`; always `agentWantsLock=false`. If owner is `user`, keep `user` but clear `agentWantsLock` (Give back then goes idle).
- No timers in this module. No Playwright. No I/O.

- [ ] **Step 2 — `controller.test.ts`**

Cover every row in the transition table above, plus:

- agent acquire while user fails and does not mutate owner
- takeOver from agent keeps `agentWantsLock`
- releaseAgentControl while user keeps owner user and clears `agentWantsLock`
- giveBack after that → idle
- giveBack after takeOver (run still wants lock) → agent

- [ ] **Step 3 — Verify**

```bash
pnpm --dir packages/browser test -- src/controller.test.ts
```

Export nothing from `index.ts` yet unless tests import from `./controller.js` directly (preferred: tests colocate, public API waits for Task 3).

---

## Task 3: Screencast + input + session composition

**Why:** This is the Host-owned workbench engine. Panel remains a dumb mirror.

### Screencast

- [ ] **Step 1 — `screencast.ts`**

```ts
export type ScreencastHandle = {
  stop(): Promise<void>;
};

export async function startScreencast(
  page: Page,
  options: {
    maxDimension: number;
    quality?: number; // default 55
    emit: (frame: { dataUrl: string; width: number; height: number; ts: number }) => void;
  },
): Promise<ScreencastHandle>;
```

Implementation:

1. `const cdp = await page.context().newCDPSession(page)`
2. `cdp.on('Page.screencastFrame', async (event) => { ... })`
3. Parse `event` as `unknown`: `data` (base64 jpeg), `sessionId`, `metadata.deviceWidth`, `metadata.deviceHeight`.
4. `emit({ dataUrl: 'data:image/jpeg;base64,'+data, width: deviceWidth, height: deviceHeight, ts: Date.now() })`
5. **Always** `await cdp.send('Page.screencastFrameAck', { sessionId })` — even if emit is dropped. Missing ack stalls Chrome.
6. `await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth, maxHeight })` with both max dims = `maxDimension`.
7. `stop()`: `Page.stopScreencast`, detach/close session, unsubscribe. Swallow stop errors after logging once (page already closed).

If `startScreencast` throws, caller falls back to existing `createFrameLoop` screenshot path. Do not leave a half-open CDP session: stop/detach in the catch.

- [ ] **Step 2 — `screencast.test.ts`**

Mock `page.context().newCDPSession` returning `{ on, send, detach }`. Assert:

- start sends `Page.startScreencast`
- a faked `Page.screencastFrame` causes ack **and** emit with CSS width/height from metadata
- emit exception still acks
- stop sends `Page.stopScreencast`

### Input

- [ ] **Step 3 — `input.ts`**

```ts
export async function dispatchBrowserInput(page: Page, events: BrowserInputEvent[]): Promise<void>;
```

- `mouse down/up/move`: `page.mouse.move(x,y)` then `down`/`up` with button. `clickCount` on down for dblclick (Playwright `mouse.down({ clickCount })` if available; else two down/up pairs).
- `wheel`: `page.mouse.wheel(deltaX ?? 0, deltaY ?? 0)` after move to `(x,y)`.
- `key down/up`: `page.keyboard.down(key)` / `up(key)`. `key` is a Playwright key name (`Enter`, `Backspace`, `Tab`, `Escape`, `ArrowLeft`, …) or a single character.
- `insertText`: `page.keyboard.insertText(text)` — **never** `keyboard.type` for this event (IME).
- Ignore unknown `type` via narrowing; do not `as`.
- Empty `events` is a no-op.

- [ ] **Step 4 — `input.test.ts`**

Mock `page.mouse` / `page.keyboard`. Golden: one down+up, one insertText, one wheel. Assert `type` is not called for `insertText`.

### Session wiring

- [ ] **Step 5 — `BrowserUserHasControlError`**

In `browser-session.ts` (or a tiny `errors.ts` if session would cross ~900 lines — prefer `errors.ts` if the file would exceed 800 after this task):

```ts
export class BrowserUserHasControlError extends BrowserSessionError {
  override name = 'BrowserUserHasControlError';
  readonly code = BROWSER_USER_HAS_CONTROL;
}
```

- [ ] **Step 6 — Extend `BrowserSession`**

```ts
dispatchInput(events: BrowserInputEvent[], options?: { signal?: AbortSignal }): Promise<void>;
takeOver(): Promise<BrowserControllerState>;
giveBack(): Promise<BrowserControllerState>;
lock(owner: 'agent' | 'user'): Promise<BrowserControllerState>; // uses acquire; throws BrowserUserHasControlError
unlock(owner: 'agent' | 'user'): Promise<BrowserControllerState>;
releaseAgentControl(): Promise<void>;
controllerState(): BrowserControllerState;
```

`BrowserSessionEvent` union adds `BrowserControllerPush`.

Write methods (`navigate`, `click`, `type`, `fillForm`, `scroll`, `back`, `forward`) take optional `{ actor?: 'agent' | 'user'; signal?: AbortSignal }`. Default `actor: 'agent'` for tools.

Before a write:

```ts
const result = actor === 'user' ? controller.acquire('user') : controller.acquire('agent');
if (!result.ok) throw new BrowserUserHasControlError('The user has the browser. Wait or ask them to give it back.');
if (result.changed) emitController(result.state, actor === 'agent' ? 'agent-write' : 'user-write');
```

`dispatchInput`:

- `acquire('user')`; if fail, throw `BrowserUserHasControlError` (panel should not send while agent owns).
- Mouse-only batches that are **all** `move`: may call `dispatchBrowserInput` without `runExclusive`. Any down/up/wheel/key/insertText uses `runExclusive`.
- Cap: reject `events.length > 64` with `BrowserSessionError`.

`pickElementAt` uses `actor: 'user'` acquire (same as input). Fail when agent owns.

Panel `browser/navigate` (user chrome): `navigate(url, { actor: 'user' })` — fails if agent owns (command returns `success: false`). Agent tool keeps default actor agent.

`start(leaseId)`:

1. Existing lease + `getPage()`.
2. Turn **on** console/network capture for this runtime if not already attached (refactor `attachConsoleAndNetworkListeners` so lease start can enable it; default-off at process boot remains OK).
3. Try `startScreencast`; on success stop the screenshot `frameLoop` if running. On failure, `frameLoop.start()` as today.
4. Emit controller snapshot (`idle` unless already owned).

`stop` final lease: `screencast.stop()`, `frameLoop.stop()`, existing `releaseRuntime()`.

`close` / `releaseRuntime`: also `releaseAgentControl` + stop screencast.

- [ ] **Step 7 — Tests in `browser-session.test.ts`**

Extend `buildPage()` mock: `mouse: { move, down, up, wheel }`, `keyboard: { type, down, up, insertText }`, `context: () => ({ newCDPSession })`.

Cases:

- write from idle emits `browser/controller` owner agent
- second write while agent does not fail
- `dispatchInput` from idle → user + mouse.down called
- `dispatchInput` while agent → `BrowserUserHasControlError`, no mouse call
- `takeOver` then `click()` (agent default) → `BrowserUserHasControlError`
- `giveBack` then `click()` succeeds
- `releaseAgentControl` after agent write → idle
- CDP start failure → screenshot `page.screenshot` still used (existing frame test)
- CDP start success → `screenshot` interval not required for frames; screencast emit reaches subscriber
- mirror lease enables console listener (`page.on` called with `'console'`)

- [ ] **Step 8 — `index.ts`**

Export `BrowserUserHasControlError`, `BROWSER_USER_HAS_CONTROL` (re-export from contracts is fine), controller state types if they are part of `BrowserSession`.

- [ ] **Step 9 — Verify**

```bash
pnpm --dir packages/browser typecheck
pnpm --dir packages/browser test
```

`wc -l packages/browser/src/*.ts` — no file ≥ 1000. If `browser-session.ts` would exceed 900, extract `errors.ts` / lease helpers first.

---

## Task 4: Host tools + IPC + run terminal

**Why:** Models and the panel share the same lock. Run end must drop `agent` even if the model never calls unlock.

- [ ] **Step 1 — `browser-tools.ts`**

Add `browser_lock`:

```ts
{
  name: 'browser_lock',
  description:
    'Lock or unlock the shared browser workbench. action=lock acquires agent control when idle. If the user has taken over, this fails with browser-user-has-control — do not retry-steal; ask them to give the browser back. action=unlock yields to idle.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['lock', 'unlock'] },
    },
    required: ['action'],
  },
}
```

Execute: `session.lock('agent')` / `session.unlock('agent')`. Catch `BrowserUserHasControlError` →

```ts
{
  ok: false,
  code: 'browser-user-has-control',
  message: error.message,
  retryable: false,
}
```

Wrap **write** executors (`navigate`, `click`, `type`, `fill_form`, `scroll`, `back`, `forward`) in the same catch. Do **not** wrap snapshot/screenshot/find/wait.

Update write-tool descriptions with one sentence: “Fails with browser-user-has-control if the human took over the workbench; wait or ask them to give it back.”

`permissionSpec('browser:lock')` — same family as other writes (`risk: 'unknown'`). Unlock is still a write to the lock, not to the page.

Schema golden currently expects **11** tools — change to **12** and include `browser_lock`.

- [ ] **Step 2 — `browser-commands.ts`**

Add types to `TYPES`. Handlers (user-initiated, no permission prompt):

| Command | Session method | Notes |
|---------|----------------|-------|
| `browser/input` | `dispatchInput(events)` | empty array → ok; map `BrowserUserHasControlError` to `fail(...)` with that message |
| `browser/lock` `owner:'user'` | `takeOver()` | panel Take over |
| `browser/lock` `owner:'agent'` | `lock('agent')` | panel Give back is **not** this; see unlock |
| `browser/unlock` `owner:'user'` | `giveBack()` | panel Give back |
| `browser/unlock` `owner:'agent'` | `unlock('agent')` / `releaseAgentControl` | rare from panel; tools use `browser_lock` |

Keep `browser/navigate` as **user chrome**: `navigate(url, { actor: 'user' })`. Failure when agent owns → `fail` so the disabled URL bar is not the only guard.

Push `browser/controller` via existing `wireBrowserSessionPushes` (session already emits it).

- [ ] **Step 3 — `host-runtime.ts` (surgical)**

In `onRunTerminal` (around the existing `releaseRun` + `run/terminal` push), add:

```ts
void this.browserSession?.releaseAgentControl();
```

Do not await inside the callback (keep it sync like today’s push). `releaseAgentControl` is async — void it and let the session mutex serialize. If the method is missing during tests that stub `browserSession`, optional-call is enough.

Do **not** change `ensureBrowserSession()` options except if console-on-lease is entirely session-internal (preferred).

- [ ] **Step 4 — Tests**

`browser-tools.test.ts`:

- 12 names include `browser_lock`
- mock session `click` throws `BrowserUserHasControlError` → result `ok:false`, `code:'browser-user-has-control'`, `retryable:false`
- `browser_lock lock` calls `lock('agent')`
- snapshot still succeeds when a `controllerState` says owner user (mock does not throw)

`browser-commands.test.ts`:

- `isBrowserCommand` true for input/lock/unlock
- `browser/input` calls `dispatchInput`
- `browser/lock` owner user calls `takeOver`
- `browser/unlock` owner user calls `giveBack`
- missing session still fails as today

HostRuntime: **do not** add a giant new host-runtime test. If an existing browser session test file exists, add one case; otherwise a focused test next to `ensureBrowserSession` is optional. The command + controller tests cover the behavior.

- [ ] **Step 5 — Verify**

```bash
pnpm --dir packages/host-runtime typecheck
pnpm --dir packages/host-runtime test -- src/browser-tools.test.ts src/commands/browser-commands.test.ts
```

Grep `agent-host` for `createBrowserToolDefinitions` / `BrowserSession` mock completeness (tools now call `lock`). Update any `Partial<BrowserSession>` test doubles that break typecheck.

---

## Task 5: Desktop workbench

**Why:** This is the user-visible workbench. Keep the panel file from becoming a dump.

### Client + mock

- [ ] **Step 1 — `host-client.ts`**

```ts
browserInput(events: BrowserInputEvent[]): Promise<HostResponse>;
browserLock(owner: 'agent' | 'user'): Promise<HostResponse>;
browserUnlock(owner: 'agent' | 'user'): Promise<HostResponse>;
```

- [ ] **Step 2 — `host-client-mock.ts`**

Add switch arms only (do not split this oversized file in this task unless typecheck forces it):

- `browser/input` → success (record last events on `this.mockBrowserLastInput` if useful for tests)
- `browser/lock` owner user → emit `browser/controller` `{ owner:'user', agentWantsLock:true, ts }`
- `browser/unlock` owner user → emit `{ owner:'agent', agentWantsLock:true, ts }` (Give back while run wants lock)
- `browser/lock` owner agent → emit `{ owner:'agent', agentWantsLock:true, ts }`
- `browser/unlock` owner agent → emit `{ owner:'idle', agentWantsLock:false, ts }`

`browser/start` should also emit `{ owner:'idle', ts }` so the panel initializes.

### Pointer + IME (pure helpers)

- [ ] **Step 3 — `browser-workbench-pointer.ts`**

```ts
export function viewportFromDisplay(input: {
  displayX: number;
  displayY: number;
  displayWidth: number;
  displayHeight: number;
  viewportWidth: number;  // browser/frame.width (CSS px)
  viewportHeight: number;
}): { x: number; y: number };

export function coalesceMouseMoves(events: BrowserInputEvent[]): BrowserInputEvent[];
```

Scale: `x = round(displayX / displayWidth * viewportWidth)` (same as pick, but **must** use push CSS size, not `img.naturalWidth`).

Coalesce: keep order; collapse consecutive `mouse/move` to the last one.

- [ ] **Step 4 — `browser-workbench-ime.ts`**

No React. Functions:

```ts
export function keyEventToBrowserInput(event: {
  type: 'keydown' | 'keyup';
  key: string;
  isComposing: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): BrowserInputEvent[] | 'ignore' | 'prevent-and-ignore';

export function compositionEndToInsertText(data: string): BrowserInputEvent | null;
export function pasteToInsertText(text: string): BrowserInputEvent | null;
```

Rules:

- If `isComposing`, `'ignore'` (let the hidden textarea handle composition).
- `compositionend` with non-empty `data` → `{ type:'insertText', text: data }`.
- Paste → `insertText` of clipboard text (cap 8 KB).
- `keydown` of `Enter|Tab|Escape|Backspace|Delete|Arrow*` → `{ type:'key', action:'down', key }` (Playwright names).
- Printable non-composing single char: also `insertText` (not `key` of `a`) so layout-independent.
- Cmd/Ctrl shortcuts (copy/paste/cut except we handle paste): `'prevent-and-ignore'` or allow copy from the page via CDP later — v1: ignore meta combinations other than paste.

Tests: Chinese composition (`isComposing` then `compositionEndToInsertText('你好')`); Enter; paste; ignore composing keydowns.

### Panel

- [ ] **Step 5 — Split UI**

`browser-session-panel.tsx` (~373 lines today):

- Remove prop `agentRunning`.
- Default mode **Interact**. Pick remains a toggle; pick click → existing `browser/pick-at`. Interact pointer → `browserInput`.
- Subscribe to `browser/controller`. Banner `data-testid="browser-session-agent-banner"` when `owner==='agent'`: copy “Agent is using the browser” + button Take over → `browserLock('user')`.
- Button Give back `data-testid="browser-session-give-back"` when `owner==='user' && agentWantsLock` → `browserUnlock('user')`.
- URL bar / Go / Refresh `disabled={owner==='agent'}`.
- Hidden `<textarea data-testid="browser-session-ime">` positioned over the frame when Interact and owner is not agent: `opacity:0`, `aria-label="Browser keyboard"`. After a successful interact click, `.focus()`. Wire IME helpers.
- Wheel on the frame: `preventDefault`, send `mouse/wheel` with CSS coords.
- Pointer move: rAF-coalesce then `coalesceMouseMoves`.
- Frame mapping uses `frame.width/height` from the push (CSS), **not** `img.naturalWidth`. Update existing pick tests if they stub `naturalWidth` only — set both the push size and the img client size.

`browser-console-drawer.tsx`: collapsed by default; toggle `data-testid="browser-session-dev-toggle"`. Lists last **100** console lines + last **50** network rows from `browser/console` and `browser/network`. No request bodies.

- [ ] **Step 6 — CSS**

Create `apps/desktop/src/styles/browser-session.css`. **Cut** the existing `.browser-session-*` block out of `region-inspector.css` into this file. Add banner / disabled urlbar / ime / drawer rules here. Import from `styles.css` **after** `region-inspector.css`.

- [ ] **Step 7 — `App.tsx`**

```tsx
<DeferredBrowserSessionPanel
  hostClient={hostClient}
  onAddWebElement={addWebElement}
/>
```

Grep `agentRunning` — should be gone from browser files.

- [ ] **Step 8 — Panel tests** (extend `browser-session-panel.test.tsx`)

Keep existing pick tests (they must still pass without `agentRunning`).

New:

1. Interact click (pick off) calls `browserInput` with a `mouse` down/up at scaled CSS coords — **not** `browserPickAt`.
2. Pick toggle still calls `browserPickAt`.
3. Push `browser/controller` owner agent → banner visible, URL input disabled, interact click does **not** send input.
4. Take over click → `browserLock('user')`.
5. After mock lock push owner user + `agentWantsLock` → Give back visible → `browserUnlock('user')`.
6. `compositionEndToInsertText` is unit-tested in the IME file; panel test may dispatch `compositionend` on the textarea if cheap.
7. **No banner** when only “streaming” is simulated — panel has no such prop; this is the regression for the old `agentRunning` freeze.

- [ ] **Step 9 — Verify**

```bash
pnpm --dir apps/desktop typecheck
pnpm --dir apps/desktop exec vitest run src/browser-session-panel.test.tsx src/browser-workbench-ime.test.ts src/browser-workbench-pointer.test.ts src/browser-console-drawer.test.tsx
```

`wc -l` the new/changed TSX/TS under `apps/desktop/src/browser*.ts*` — all < 1000, panel < ~500 preferred (split if not).

---

## Task 6: Docs + line-count + full verify

- [ ] **Step 1 — `docs/architecture.md` §8**

Replace “throttled JPEG frame pushes (~2–4 fps)” with:

- CDP screencast (~12–15 fps) falling back to screenshot frames
- Interact workbench + pick modifier
- Controller `idle | user | agent`; never auto-steal; `browser-user-has-control`
- Console/network drawer while the mirror lease is held
- `browser_lock` in the tool list
- Streaming ≠ lock

Keep permission, CLI degradation, Chromium install paragraphs.

- [ ] **Step 2 — Confirm ADR 0020 / 0057**

0020 deferred list already points at 0057. Do not rewrite 0057 unless implementation forced a decision change (if so, amend the ADR in the same PR).

- [ ] **Step 3 — Line-count gate**

```bash
wc -l packages/browser/src/*.ts packages/host-runtime/src/browser-tools.ts packages/host-runtime/src/commands/browser-commands.ts apps/desktop/src/browser*.ts*
```

Reject any file ≥ 1000. `region-inspector.css` must not grow.

- [ ] **Step 4 — Package tests**

```bash
pnpm --dir packages/contracts typecheck
pnpm --dir packages/browser typecheck && pnpm --dir packages/browser test
pnpm --dir packages/host-runtime typecheck
pnpm --dir packages/host-runtime test -- src/browser-tools.test.ts src/commands/browser-commands.test.ts
pnpm --dir packages/host-transport test -- src/host-push-policy.test.ts
pnpm --dir apps/desktop typecheck
pnpm --dir apps/desktop exec vitest run src/browser-session-panel.test.tsx src/browser-workbench-ime.test.ts src/browser-workbench-pointer.test.ts src/browser-console-drawer.test.tsx
```

Root `pnpm typecheck` before considering the slice mergeable (implementers of `HostCommand` / `HostPush` / `BrowserSession` / `ToolResultErrorCode` will fail until updated).

---

## Definition of Done

- [ ] `browser/input`, `browser/lock`, `browser/unlock`, `browser/controller` exist in contracts; `classifyHostPush` handles controller as control.
- [ ] `ToolResultErrorCode` includes `browser-user-has-control`; write tools and `browser_lock` return it with `retryable: false` when the user owns the page.
- [ ] Pure controller tests encode the transition table; agent cannot acquire from user.
- [ ] Screencast acks every frame; start failure falls back to screenshot loop; `browser/frame` width/height are CSS viewport px.
- [ ] User IME uses `insertText`; tests cover compositionend → 你好.
- [ ] Panel default Interact; pick still attaches; Take over / Give back wired; `agentRunning` / `state.streaming` no longer freeze the workbench.
- [ ] Console/network drawer exists; capture on while a mirror lease is held.
- [ ] Run terminal releases agent control.
- [ ] `docs/architecture.md` §8 matches the workbench. No file over 1000 lines. No new CSS in `region-inspector.css`.
- [ ] CLI visual panel still absent by design.

## Manual smoke (after implementation, Desktop)

1. Right panel → Browser → `http://localhost:<dev>`: page is live, can click a button, type in an input, compose Chinese, scroll.
2. Prompt the agent to click a specific control: banner appears, user clicks do nothing, Take over restores input, agent’s next click reports user-has-control in the tool card.
3. Give back: agent can click again.
4. Ask the agent to only edit a file (no browser tools): panel stays interactive the whole stream.
5. Pick an element → composer chip still injects.
6. Open the drawer: a `console.log` on the page and a document request show up.
7. Close the panel: Chromium lease releases (existing stop behavior).

## Stop / do not

- Do not drive the Tauri WKWebView via CDP.
- Do not add a second Chromium for the panel.
- Do not use `keyboard.type` for IME.
- Do not treat `state.streaming` as browser lock.
- Do not auto-steal from `user`.
- Do not dump takeover into `host-runtime.ts` or `browser-session.ts` past the split listed above.
- Do not implement headed-window or proxy-iframe in this slice.
