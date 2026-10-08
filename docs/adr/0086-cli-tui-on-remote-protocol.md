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

- Desktop embedding (a docked TUI pane: PTY launch of a chosen program, a
  loopback entrance on the sidecar Host, a `tui` docking view).
- Attachments, image paste, `@` file references and skill slash commands in
  the TUI composer.
