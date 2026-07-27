# PO-PTY-00 — Tauri PTY spike note

| Field | Value |
|-------|-------|
| Date | 2026-07-22 |
| Decision | **GO shipped (code)** — portable-pty + xterm dual-path; host `capabilities.pty` remains false (desktop-owned) |
| Related | ADR 0013, product-optimization-program Track D |

## Spike goals

1. Spawn interactive shell with cwd = trusted project.
2. Stream PTY bytes to renderer.
3. Kill on window / project close (no orphans).
4. Packaging risk notes for macOS.

## Current baseline

- Node host `pty/*` = **line-oriented piped shell preview** (`capabilities.pty=false`, `shellPreview=true`).
- Desktop `TerminalDock` already consumes host pty events as a **Shell** surface, not xterm.
- Tauri app exists (`apps/desktop/src-tauri`) with host bridge; **no** portable-pty integration yet.

## Recommended stack (GO)

| Layer | Choice |
|-------|--------|
| Rust | `portable-pty` (or curated Tauri PTY plugin when stable) |
| Commands | `pty_open` / `pty_write` / `pty_resize` / `pty_close` |
| Events | `pty_data` / `pty_exit` |
| UI | `xterm.js` + fit addon |
| Trust | Desktop checks trusted project before open; host JSONL not used for PTY I/O |

## Packaging / risk

- macOS: entitlements for process spawn; codesign path must include any native deps.
- Windows: ConPTY via portable-pty; later residual.
- Do **not** add `node-pty` as product primary (ADR 0013).

## Exit for this spike

| Criterion | Result |
|-----------|--------|
| Design path clear | **Yes — GO** |
| Code green on machine today | **No full interactive PTY yet** |
| Product capability flip | Keep `pty:false` until xterm + Rust open/write/kill demo works |

## Follow-up (PO-PTY-01..04)

1. Add Rust module + Tauri commands (minimal echo shell OK).
2. Wire TerminalDock to Tauri when available; fall back to Shell preview.
3. Flip `capabilities.pty` only when live path works.
4. If blocked by packaging, freeze Shell preview wording permanently (PO-PTY-04).

## Freeze policy (active until live PTY)

UI/docs continue to say **Shell preview**, never "interactive Terminal", until `capabilities.pty === true`.


## Implementation status (2026-07-22)

| Layer | Status |
|-------|--------|
| Rust `portable-pty` | `apps/desktop/src-tauri/src/pty_host.rs` — open/write/resize/close/close_all |
| Events | `pty_data`, `pty_exit` |
| xterm.js | `XtermSurface` + `@xterm/xterm` + fit addon |
| Dual path | Tauri → interactive Terminal; browser mock → Shell preview (host `pty/*`) |
| Trust | Desktop refuses open when project untrusted / no project |
| Host `capabilities.pty` | Still **false** (honest: interactive PTY is not host IPC) |

Manual smoke (desktop): `pnpm --dir apps/desktop dev:tauri` → trust project → Terminal tab → type commands, resize, restart, project close kills PTY.
