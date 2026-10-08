# ADR 0086: The CLI's TUI is a remote-protocol shell rendered with pi-tui

| Field | Value |
|-------|-------|
| Status | **Accepted** |
| Date | 2026-10-08 |
| Related | [0003-dual-mode-host.md](./0003-dual-mode-host.md), [0037-mobile-remote-shell.md](./0037-mobile-remote-shell.md), AGENTS.md §1 |

## Context

The CLI had one-shot commands (`piwin chat <text>`, `piwin session …`) and no
interactive shell. Owner direction: add a terminal UI that shows the same
sessions Desktop does, so a terminal and the Desktop window are two views of
one Host.

Two things in the existing rules stood in the way of the obvious build:

- AGENTS.md §1.1–1.2 forbade every `@earendil-works/pi-*` import outside
  `packages/agent-host`. Pi's own terminal library, `pi-tui`, is the renderer
  that already handles differential redraw, wide characters, IME cursor
  placement, bracketed paste and Kitty keys.
- The CLI's one-shot commands talk to an in-process `HostRuntime` and see local
  shapes (absolute paths, unprojected sessions). A second shell built on that
  path would not match what Desktop and the phone see.

## Decision

1. **`piwin tui` always speaks the remote Host protocol.** With
   `PIWIN_HOST_URL` set it attaches to that Host. Otherwise it starts a Host
   in-process, bound to `127.0.0.1` on a random port with a random door token
   and pairing off, and connects to it through the same WebSocket client. There
   is one code path; the TUI never calls `HostRuntime` methods directly.
2. **The TUI owns no session data.** Everything shown comes from Host
   responses and pushes; every change goes back as a `HostCommand`. The session
   picker reads and writes the Host's session index, so rename, archive and
   creation are visible to every other shell.
3. **The TUI negotiates `liveSubscriptions`** and subscribes to the one session
   it is showing. One-shot CLI commands keep the unfiltered stream.
4. **`@earendil-works/pi-tui` is allowed under `apps/cli/src/tui/` only.** It
   carries no agent, model or session semantics. It is pinned to the Pi version
   the Host uses. `scripts/check-package-boundaries.mjs` allows exactly this
   package in exactly this directory; every other Pi import outside
   `agent-host` still fails the check.
5. **The transcript model is the TUI's own.** `transcript-model.ts` folds the
   durable page and the `AgentEvent` stream into rows. It reuses
   `@piwin/host-client`'s foreground-run projection and nothing from Desktop's
   reducer, which is bound to React state and Desktop-only concerns.
6. **`--embedded` pins the TUI to one session** and disables its session
   switching, for a host application that owns navigation.
7. **Desktop can draw the conversation area with the TUI.** A "对话 / 终端"
   switch on the conversation stage replaces transcript, permission bar and
   composer with an xterm surface on a Desktop PTY running the same program
   the sidecar Host runs, as `tui --embedded`. With an active session it runs
   `--session <id>` and restarts when the active session changes; with none
   it starts a new conversation, scoped by `--project-path` to the active
   project when that project is registered on the Host. The choice is a
   device preference (`piwin.desktop.conversation-surface`), not session
   state. The switch is offered only where a local Host exists.
8. **The sidecar gets a loopback entrance for local shells.** The sidecar
   speaks JSONL on stdio, which a second process cannot share. A local-only
   sidecar command, `local-shell-access/open`, starts a `HostServer` on
   `127.0.0.1` with an OS-assigned port, a random per-run token and pairing
   off, sharing the sidecar's egress hub and idempotency registry. Nothing
   listens until the first request. It is independent of phone access: a
   different listener, no device pairing, and the phone-access switch does not
   affect it.
9. **The token does not pass through the webview on the way to the TUI.**
   `pty_open_tui` (Rust) asks the sidecar for the entrance and puts the
   endpoint and token in the child's environment. `local-shell-access/*` is
   refused on every WebSocket connection, like `mobile-access/*`.

## Consequences

- A terminal attached to the Host Desktop uses sees the same sessions, live.
- Desktop and the TUI each fold `AgentEvent` into rows. A new event type that
  changes what a transcript shows has to be handled in both. If a third shell
  needs the same fold, extract it into `@piwin/host-client` then.
- A user turn's text is not on the event stream. The TUI shows its own prompts
  from a local echo; a prompt sent from another shell appears after the next
  reload of the session, not live.
- Tool calls render after a message's text, because the remote transcript
  shape carries text and tools as separate fields without interleaving order.
- Any process running as the same OS user that learns the entrance's port and
  token has the authority Desktop itself has over the Host. The token lives in
  the sidecar's memory and in the TUI child's environment only.
- The in-process Host is a real Host: it takes the `~/.piwin` Host lock paths a
  sidecar would. Running `piwin tui` without `PIWIN_HOST_URL` while Desktop's
  Host is up means two Hosts on one config root, exactly as with other
  in-process CLI commands.

## Found while building

`resolveLoginShellPath` ran the user's interactive login shell with
`execFile`. An interactive shell takes the terminal's foreground process group
while it runs, so a Host started from a terminal was a background job for that
window: raw mode failed with `EIO`. `execFile` drops the `detached` option;
the probe now uses `spawn` with `detached: true`, which gives the shell its own
session and no terminal to take.

## Not done

- Attachments, image paste, `@` file references and skill slash commands in
  the TUI composer.
- Switching back to the chat surface ends the TUI process. Nothing is lost
  (state is the Host's), but terminal scrollback is.
- A conversation the TUI starts does not become Desktop's active session by
  itself; it appears in the sidebar like one started from any other shell.
- Split conversation panes other than the primary one always use the chat
  surface.
- With a remote (attach-only) Host there is no sidecar, so the pane reports
  that it is unavailable.
