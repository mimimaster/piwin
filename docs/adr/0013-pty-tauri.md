# ADR 0013: Interactive PTY via Tauri (not Node node-pty)

| Field | Value |
|-------|-------|
| Status | **Accepted** |
| Date | 2026-07-21 |
| Supersedes (product path) | W2 draft preference for `node-pty` in Node host ([`w2-subagent-compaction-pty.md`](../specs/w2-subagent-compaction-pty.md) §5) |
| Related | ADR 0001 (Tauri desktop), ADR 0006 (desktop host transport), [`product-depth-competitive-alignment.md`](../specs/product-depth-competitive-alignment.md) L4 |

## Context

Product needs an interactive shell dock (resize, ANSI, real TTY semantics). Industry UI stack is **xterm.js in the renderer**. Process side options:

1. **Node `node-pty`** inside the agent-host sidecar (W2 draft).
2. **Tauri Rust PTY** (plugin / `portable-pty` / similar) owned by the desktop process.
3. Keep **line-oriented piped shell** forever and never claim “Terminal”.

Native packaging, code signing, and OS integration already live on the Tauri side (ADR 0001). Putting a second native PTY stack in the Node host doubles build/matrix pain and fights “Tauri owns OS surface” direction.

Product Depth locked decision **L4** (user 2026-07-21): **Tauri for PTY**.

## Decision

1. **Product interactive PTY is implemented in `apps/desktop` Tauri (Rust)**, not as the primary responsibility of `@piwin/agent-host` via `node-pty`.
2. **Renderer uses `xterm.js`** (and fit/search addons as needed). Bytes and resize go through **Tauri commands/events**, not through the Node host JSONL channel for PTY I/O.
3. **Trust / project binding** still consults product rules:
   - PTY open requires an open **trusted** project (same policy as destructive shell).
   - Desktop may call host `project/*` / status before spawning; host does not need to multiplex PTY streams.
   - **Authoritative enforcement** of trusted cwd is at the **Rust/Tauri boundary** (`pty_open` → host `project/authorize-terminal`); React checks are usability guidance only (PSR D3).
4. **Terminal availability is a desktop capability**, not a host capability flag.
   - Host `capabilities.pty` describes the host-owned piped shell / future host PTY surface only.
   - Do **not** treat host `capabilities.pty === false` as proof that the Tauri interactive Terminal is unavailable.
   - Existing Node **`PtyHost` piped shell** remains the non-Tauri / mock **Shell preview** path; UI wording must stay honest per surface.
5. **CLI** does not require full xterm; optional later thin spawn is out of this ADR’s desktop path.
6. Do **not** add Electron solely for terminal.

## Architecture

```text
apps/desktop (React)
  TerminalDock + xterm.js
       │ invoke("pty_open" | "pty_write" | "pty_resize" | "pty_close")
       │ listen("pty_data" | "pty_exit")
       ▼
apps/desktop/src-tauri (Rust)
  PTY session map (id → master fd / child)
  cwd = trusted project path
       │
       ▼
OS pseudo-terminal + user shell

Parallel (unchanged):
  UI ↔ Node HostRuntime  for agent sessions, tools, MCP, permissions
```

### Ownership cheat sheet

| Concern | Owner |
|---------|--------|
| PTY bytes, resize, kill | Tauri |
| xterm rendering | Desktop web UI |
| Project trust gate | Host records authoritative; Tauri `pty_open` re-authorizes via host before spawn; desktop prechecks are guidance only |
| Agent one-shot bash | Pi / host tools (not this PTY) |
| Long-lived non-interactive jobs | `@piwin/process` |
| Line-oriented Shell preview | Host `PtyHost` until replaced |

## Consequences

### Positive

- Aligns OS-native work with Tauri (ADR 0001).
- Avoids shipping/native-build `node-pty` for every host platform matrix.
- Cleaner separation: agent kernel process ≠ interactive terminal process.

### Negative / work

- Need Rust PTY integration + capability/permission config in Tauri.
- Two IPC worlds (host JSONL vs Tauri events) — document carefully; do not route PTY data through host “just because”.
- CLI parity for interactive TTY is not automatic (acceptable for desktop-first PTY).

### Explicit non-goals

- Agent-driven interactive PTY tool in v1 (ManagedProcess + bash remain).
- Replacing PermissionPolicy with terminal hooks.

## Implementation notes (non-normative)

- Spike crate/plugin choice early (e.g. community Tauri PTY plugin vs thin `portable-pty` wrapper); pin versions in desktop `Cargo.toml`.
- Session dispose on window destroy and on project close.
- Never spawn PTY for untrusted projects.
- When live, label UI “Terminal” only after Tauri presence + authorization/capability probe succeed.
- Do not flip host `capabilities.pty` solely because the Tauri path is green; keep host flag scoped to host-owned shell/PTY.

## Status of older drafts

- [`w2-subagent-compaction-pty.md`](../specs/w2-subagent-compaction-pty.md) CE-PTY acceptance still applies (pwd, resize, dispose, trust) but **implementation vehicle is Tauri**, not Node node-pty.
- Product Depth Track F (`PD-PTY-*`) is the execution backlog.

## References

- Tauri 2: https://v2.tauri.app/
- xterm.js: https://github.com/xtermjs/xterm.js
- ADR 0001 Desktop = Tauri 2
