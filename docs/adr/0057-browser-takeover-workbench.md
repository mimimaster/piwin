# ADR 0057: Browser takeover workbench

## Status

Accepted (2026-08-19)

Amends [ADR 0020](./0020-browser-session.md) §6 / deferred interactive
mirror. Does **not** replace the Host-owned Playwright Chromium, snapshot/`ref`
tools, or element-pick attach path.

## Context

The right-panel `BrowserSessionPanel` is a JPEG screenshot mirror (~2–4 fps)
of the Host-owned Chromium. The user can type a URL and pick an element; they
cannot click, type, or scroll the page. While any agent run is streaming,
pick is disabled (`agentRunning={state.streaming}`), which is the wrong mutex:
a coding turn that never touches the browser still locks the panel.

Cursor / Devin / Codex-style coding-agent browsers are a **shared workbench**:
the same page is visible to both sides, the agent can drive it, and the human
can take over (login, 2FA, “that’s the wrong button”). ADR 0020 deferred an
OpenHands-style proxy-iframe as the path to in-panel interactivity. That path
does not preserve “what the user sees == what the agent controls”.

### Platform constraint (unchanged from ADR 0020)

Tauri 2 system webviews do not expose CDP on macOS/Linux. The agent still
cannot drive the Desktop webview. The workbench must keep mirroring the
Playwright Chromium the Host already owns.

## Decision

### 1. Interactive mirror = CDP screencast + input forwarding

Keep one Host-owned Chromium. Replace the `page.screenshot()` interval with
Chrome DevTools `Page.startScreencast` (JPEG, ack every frame, ~12–15 fps,
size-capped). The panel still renders `browser/frame` (same push shape). User
pointer/keyboard events are forwarded to that page via Playwright
`page.mouse` / `page.keyboard` / `page.keyboard.insertText`.

Fallback: if CDP screencast cannot start, keep the existing screenshot loop so
the panel never goes blank.

A later iteration may serve frames over a local HTTP/WebSocket to skip base64
Tauri IPC (already noted in ADR 0020). Out of scope here.

### 2. Explicit controller lock (not “is the LLM streaming”)

The shared page has one controller:

```text
idle  -- user pointer/key / URL chrome -->  user
idle  -- agent write tool / browser_lock -->  agent
agent -- Take over / run terminal / browser_unlock -->  user | idle
user  -- Give back (run still active) / idle timeout -->  agent | idle
```

Invariants:

- **Never auto-steal from the user.** If the controller is `user`, agent write
  tools fail with a stable result (`code: 'browser-user-has-control'`), not a
  thrown crash. The model can ask the user to give the browser back.
- **Write tools auto-acquire `agent` only from `idle`.** Chained
  `click`/`type`/`navigate` in one run do not lose the lock between calls.
- **Read tools stay allowed** under any controller: `browser_snapshot`,
  `browser_screenshot`, `browser_find`, `browser_wait`. They still serialize
  on the existing browser-bus mutex.
- **User chrome** (URL bar, reload, back/forward) is a user write: disabled
  while `agent` holds the lock, with the Take over button as the explicit
  path. Opening the URL bar is not an implicit steal.
- **Take over / Give back are user-initiated** — no permission prompt (same
  as pick).
- **Run terminal** of the run that first acquired `agent` (success, error,
  abort) releases that claim → `idle` (or keeps `user` and clears
  `agentWantsLock`). Other runs, including subagents and other sessions, do
  not release the shared lock.
- Panel `agentRunning={state.streaming}` is **not** the lock. Streaming a
  coding turn that never uses the browser must not freeze the workbench.

New Host tool: `browser_lock` `{ action: 'lock' | 'unlock' }`. Optional; write
tools already auto-lock from idle. Unlock lets the model yield without ending
the run.

### 3. Rejected alternatives (recorded)

| Path | Why not as the v1 workbench |
|------|-----------------------------|
| Proxy-iframe / URL rewriting (ADR 0020 deferred) | Second document; CSP / `X-Frame-Options` / cookie rewrite; user and agent diverge |
| Headed OS Chromium window as the primary UI | Leaves the right-panel workbench; window management; still needs the same lock. Keep as a later escape hatch (“Open in window”) |
| Coordinate-click on 4 fps screenshots only | Usable as a prototype, not a workbench (IME, hover, scroll feel dead) |
| Drive the Tauri webview via CDP | Impossible on macOS/Linux (ADR 0020) |

### 4. Input surface (v1)

Forwarded when controller is `user` (or `idle`, which promotes to `user`):

- mouse down / up / move (move coalesced) / wheel
- click, dblclick, contextmenu
- keys: Enter, Tab, Escape, Backspace, arrows, modifiers
- **IME / paste via `insertText`** — required (Chinese composition must not go
  through `keyboard.type` character-by-character). Desktop captures
  `compositionend` / paste on a hidden IME surface and sends `insertText`.

Deferred: drag-and-drop, `<input type=file>`, multi-tab, headed/stealth,
production Chromium bundling.

Pick mode stays a **modifier** on user control: click attaches a
`WebElementAttachmentRef` instead of dispatching a page click. Default mode
is Interact, not Pick.

### 5. Console / network as workbench chrome

`browser/console` and `browser/network` pushes already exist but are off by
default and have no panel. When a mirror lease is held, capture is on and the
panel shows a collapsible drawer. This is part of the workbench, not a later
unrelated feature — debugging the app the agent just started is why the
browser is in the IDE.

### 6. Split before growing `@piwin/browser`

`browser-session.ts` is already past the ~400-line split trigger. Takeover
lands in new modules composed by the session: controller, screencast, input.
Do not grow the session file past the 1000-line cap.

## Consequences

- Desktop panel becomes an interactive surface; CLI still has tools + lock
  and no visual panel (intentional degradation, ADR 0020). When the agent
  acquires the workbench (`browser/controller` owner `agent`) or navigates,
  Desktop opens the right-sidebar Browser tab so the mirror is visible.
- Screencast at ~15 fps is more IPC than 4 fps screenshots. Cap dimension and
  quality; drop frames if the panel is hidden; ack CDP frames or Chrome stops.
- Models that ignore `browser-user-has-control` will retry and fail until the
  user gives the browser back — tool descriptions must state this.
- Permission rules for `browser_navigate` are unchanged. User input is not a
  navigate.
- Headless bot-blocking remains; headed/stealth stays a follow-up.

### 2026-09-07 completeness amendment

Mirror primary path is Playwright 1.61 public `page.screencast.start({ onFrame })`
with screenshot fallback. Screencast-only death does not restart Chromium.
See [`docs/plans/2026-09-07-browser-cdp-completeness.md`](../plans/2026-09-07-browser-cdp-completeness.md).

## References

- [ADR 0020 — Agent-controllable browser session](./0020-browser-session.md)
- [Plan — browser takeover workbench](../plans/2026-08-19-browser-takeover-workbench.md)
