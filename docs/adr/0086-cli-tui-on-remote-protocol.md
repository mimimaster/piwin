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

## Composer inputs

- **Run Mode** is sent as `permissionPreset` on each prompt from this shell.
  Absent means the Host's own configuration, which the status line names.
- **`@` references** are resolved against the Host, not the TUI's disk: the
  TUI may be attached to a Host on another machine, and the Host owns which
  paths are inside a project. Completion reads `project/list-dir`; fragment
  search runs over a bounded breadth-first walk of those listings (300
  directories, 5 000 entries, 60 s), because the Host offers exact-name search
  only. A submitted mention that names a real entry becomes a `file` or
  `folder` context ref addressed by project id; one that names nothing stays
  text. Mentions need a project session.
- **Attachments** are read on the TUI's machine and uploaded to the Host's
  media vault through the chunked `media/save-*` commands (a single-frame
  `media/save` is capped near 700 KB on the remote protocol). The upload code
  is shared with Desktop in `@piwin/host-client`. An absolute image path
  written in a message — what a terminal inserts when a file is dropped on
  it — is attached and replaced by a marker; other paths are left as written.
  The clipboard image comes from the platform tool (`osascript`,
  `wl-paste`/`xclip`, PowerShell), since a terminal paste carries text only.
- A message sent while a run is in flight joins that run as plain text:
  references and attachments wait for a turn of their own.

## Conversation features

Each is a thin controller over existing Host commands; the TUI holds no copy
of the state beyond what it last showed.

| Command | Host commands | Notes |
|---|---|---|
| `/model` `/thinking` `/permission` `/skill` `/prompts` | `session/set-composer-profile`, prompt input fields, `skills/list`, `prompts/list` | Templates complete as slash commands; the agent expands them. |
| `/attach` `/paste` `/detach`, `@` | `media/save-*`, `project/list-dir`, `project/find-file` | See "Composer inputs". |
| Enter while running, `/queue`, `/steer` | `session/queued-turn-*`, `session/steer` | Enter queues the next turn with its attachments and refs, as Desktop does; `/steer` joins the running turn. A queued turn is echoed when the Host starts it. |
| `/plan` | `plan/get`, `plan/execute`, `plan/approve`, `plan/abort`, `plan/set-status`, `plan/clear` | Execution sends `expectedRevision`, so a plan that changed under the overlay is refused. |
| `/retry [keep]`, `/edit`, `/branches`, `/fork` | `session/prompt` (`retryUserMessageId`, `branchFromMessageId`), `session/branch-*`, `session/fork` | A switch that would strand file changes is confirmed first with the Host's list of paths. |
| `/subagents` | `session/list-children`, `subagent/results`, `subagent/result-files`, `subagent/result-diff`, `subagent/worktree-action`, `subagent/cleanup-plan`, `subagent/request-resolution` | Actions are gated by the result's `availability`; a refusal shows the Host's reason. |
| `/changes`, `/undo` | `turn-changes/list-by-runs`, `turn-changes/files`, `turn-changes/diff`, `turn-changes/undo`, `turn-changes/redo` | Turns are found by the run ids on screen. After an undo the summary is re-read, because the update push is filed under the workspace, not the session. |
| `/compact` | `session/compact` | |
| `/queue` actions, `/replace` | `session/queued-turn-reorder`, `run/intervention-submit` (`adoptQueuedTurn`), `session/prompt` (`foreground: replace-run`) | Reorder re-reads the queue for its revision first. Replace names the run it saw. |
| `/changes` repair | `turn-changes/operation`, `turn-changes/recovery-preview`, `-run`, `-verify` | The run spends the preview's token; the Host refuses if files moved since. |
| `/walkthrough [new]` | `walkthrough/list`, `walkthrough/generate`, `walkthrough/cancel` | About the latest finished answer. |
| `/side`, `/sync`, `/handoff`, `/back` | `side-chat/open`, `side-chat/list`, `side-chat/sync`, `side-chat-message` context ref | Stepping in and out is a session switch, so this controller outlives the per-session ones. A handed-off answer can only be spent by the session it was carried back to. |
| `/artifacts` | none | See below. |

### Artifacts

A terminal cannot render HTML. `/artifacts` lists the artifacts in assistant
messages using `@piwin/artifact`'s own fence index and analysis, shows their
source, and exports one for the browser on the machine the TUI runs on.

The export follows the rule Desktop renders by (AGENTS.md §3.4): the model's
document is never a top-level page. It is written as the `srcdoc` of a single
`sandbox="allow-scripts"` frame — an opaque origin with no access to the outer
page, sibling files, storage, forms or navigation — inside an outer page that
runs no script and declares the artifact's own CSP (`default-src 'none'`,
`connect-src 'none'`, inline script and style only). An artifact the policy
blocks (external resources, too large, empty) is listed with the reason and
can only be read as source, as in Desktop. Each export goes to a fresh
directory under the system temp directory with mode 0600.

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

- Still Desktop-only: rendering an artifact in place (the TUI exports it to a
  browser instead), exporting an undo backup, subagent worktree garbage
  collection, and project-scoped prompt templates (the remote protocol lists
  global ones only).
- Switching back to the chat surface ends the TUI process. Nothing is lost
  (state is the Host's), but terminal scrollback is.
- A conversation the TUI starts does not become Desktop's active session by
  itself; it appears in the sidebar like one started from any other shell.
- Split conversation panes other than the primary one always use the chat
  surface.
- With a remote (attach-only) Host there is no sidecar, so the pane reports
  that it is unavailable.
