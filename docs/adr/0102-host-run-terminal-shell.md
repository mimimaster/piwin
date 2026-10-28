# ADR 0102: The Host runs the terminal shell for shells without a terminal

| Field | Value |
|-------|-------|
| Status | **Accepted — implemented** (owner decision 2026-10-28: both phases at once; first version on the sidecar Host only; Grok opens in the conversation view on phones) |
| Date | 2026-10-28 |
| Scope | `@piwin/contracts`, `@piwin/process`, `@piwin/host-runtime`, `@piwin/host-server`, `apps/cli` (`host serve`), `apps/desktop` |
| Amends | [0013](./0013-pty-tauri.md) (decision 7: Host-owned terminal streams), [0086](./0086-cli-tui-on-remote-protocol.md) (where the TUI process runs) |
| Related | [0082](./0082-grok-build-acp-backend.md) (native agent CLI on the Host), [0084](./0084-mobile-shell-default-web-interface.md) (phone default interface), [0101](./0101-content-blind-relay-per-device-e2ee.md) |
| Plan | [`plans/2026-10-28-phone-tui.md`](../plans/2026-10-28-phone-tui.md) |

## Context

The conversation's 对话 / CLI switch shows the same conversation in a
terminal: Pi's own TUI (`piwin tui --embedded`, ADR 0086) or a native agent's
CLI (Grok, ADR 0082). Desktop starts Pi's TUI in its own terminal (Tauri
`pty_open_tui`). Native agent CLIs already ran in a terminal on the Host's
machine, streamed as `pty/output` and driven with `pty/write | resize | close`.

The phone and the browser shell have no terminal of their own, so neither
switch appeared there. Their front-end gate asked "is this the Desktop app"
for both terminals, though only Pi's needed Desktop.

## Decision

1. **Route per agent, not per shell.** `resolveConversationCliRoute` picks
   `desktop-pty` (Pi's TUI in Desktop's terminal) or `host-pty` (a terminal on
   the Host's machine, streamed over the Host connection). Native agent CLIs
   are always `host-pty`. On a shell without its own terminal that reaches the
   Host remotely, Pi's TUI is `host-pty` too, when the Host advertises it.
   Desktop keeps its own terminal for Pi even when the Host could run it.
2. **`tui/open`** (contracts `embedded-tui.ts`) asks the Host to start
   `piwin tui --embedded [--session <id> | --project-path <path>]` in a
   terminal on its machine. The client names a session, or a project (an
   opaque id remotely), and a grid size, nothing else. Session ids follow the
   native launcher's rule (`[A-Za-z0-9._:-]{1,128}`, no leading `-`).
   Projects must be ones the Host has. The working directory is that project
   when trusted, otherwise the general workspace. I/O reuses `pty/*`.
3. **The TUI connects back to the same Host** through the loopback entrance
   (`LocalShellAccess`, ADR 0086). Its environment selects only this Host:
   `PIWIN_HOST_URL` / `PIWIN_HOST_TOKEN` from the entrance, inherited
   `PIWIN_HOST` and `PIWIN_HOST_DEVICE_*` removed. `VISUAL` and `EDITOR` are
   emptied: the TUI's external editor would otherwise be `vi` on the Host,
   a shell for whoever holds the phone. `PIWIN_IMAGES=iterm2` as on Desktop.
4. **Only `host serve` provides it in this version.** The runtime needs two
   ports: the loopback entrance and how to start its own CLI (`process.execPath`
   with the same loader flags and entry script, debugger flags dropped). The
   sidecar has both. Without them `tui/open` answers `embedded-tui-unavailable`,
   and both `host/status` and the remote capability summary leave
   `embeddedTui` off, so shells hide Pi's CLI switch. The standalone
   `apps/host` does not provide it yet.
5. **One terminal registry per Host** (`host-runtime/src/terminal`). Native
   agent CLIs and the Host-run TUI share one `InteractiveTerminalManager`
   (node-pty, eight terminals), one output buffer per terminal, and one router
   for `pty/*`. Each owner decides what client input, client close and exit
   mean (a native agent keeps its writer across a client close).
6. **Reopening is reattaching.** The Host reads the TUI's session
   announcements (OSC 777) from its output. `tui/open` for a session a
   running TUI already shows hands back that terminal instead of starting
   another. It replays no bytes: it narrows the grid by one column and
   restores it, and pi-tui repaints the whole screen on a width change. After
   the Host connection drops and returns, the client does the same
   (`XtermSurfaceHandle.redraw`). Phones disappear without closing, so at most
   four Host-run TUIs live at once; opening a fifth closes the one with the
   oldest input.
7. **Touch screens** (`pointer: coarse`) get a key bar under the terminal:
   Ctrl (sticky for the next key), Esc, Tab, arrows, `/`, paste. Taps keep the
   terminal's focus so the keyboard stays up. Grok opens in the conversation
   view there; the CLI is one tap away. The phone title bar keeps the
   conversation / CLI switch while hiding the other desktop segment controls.

## Consequences

- The phone and the browser shell get the same terminal shell as Desktop for
  Pi, and native agent CLIs, on a sidecar Host. A standalone `apps/host` still
  offers native agent CLIs only.
- A phone in the CLI view runs a process on the Host's machine with the
  sidecar's authority over its own Host. A paired phone already has that
  authority through commands; the process is fixed (piwin itself), its
  arguments are validated, and it opens no login shell.
- The terminal keeps running while the phone is away. Up to four such
  processes idle on the Host until reopened or replaced.
- On a narrow phone the TUI gets about 46 columns. Its layout holds at that
  width in the browser check; a real device is still to be tried.
- Not covered: Chinese IME composition and the key bar's position against the
  real iOS keyboard (device check), and the standalone Host.
