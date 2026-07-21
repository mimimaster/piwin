# M2 Implementation Record

| Field | Value |
|-------|-------|
| Status | **Done** (MVP implemented in code) |
| Date | 2026-07-20 |
| Spec | [m2-agent-window.md](./m2-agent-window.md) |
| Deferred | [docs/todo-deferred.md](../todo-deferred.md) |

> This is **not** a queue of unfinished work.
> It is a **completion record** for M2 Agent Window MVP.
> Anything not shipped here lives in `docs/todo-deferred.md`.

## What shipped

### A — Scaffold
- [x] Tauri 2 + Vite + React + TS (`apps/desktop`)
- [x] pnpm scripts `dev:desktop` / `dev:tauri`
- [x] 3-pane chrome
- [x] Rust/toolchain notes in desktop README

### B — Host bridge
- [x] `HostCommand` / `HostPush` / `HostResponse` in `@piwin/contracts`
- [x] CLI `piwin host serve` JSONL
- [x] Tauri sidecar bridge (`host_start` / `host_request` / `host_stop`)
- [x] Frontend `HostClient` (browser mock transport / Tauri live)
- [x] dispose on unmount

### C — Project + sessions
- [x] Project open + trust persist (`~/.piwin/projects.json`)
- [x] Trust modal
- [x] Session index (`~/.piwin/sessions-index/index.json`)
- [x] Session list hydrate + new session
- [x] Folder browse (Tauri dialog; browser prompt fallback)
- [x] Resume best-effort (in-process only; cross-process full resume is deferred)

### D — Chat UX
- [x] AgentEvent → ChatUiState reducer + unit test
- [x] Markdown renderer (no raw HTML exec)
- [x] Tool cards
- [x] Thinking collapsible
- [x] Composer send + abort
- [x] Permission modal allow/deny

### E — Models
- [x] Settings panel: provider list
- [x] OpenAI-compatible + Anthropic-compatible forms → `config/set`
- [x] Header model picker → `session/create` model

## Verify

```bash
cd ~/Projects/piwin
pnpm install
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/project test
pnpm --filter @piwin/session test
pnpm --filter @piwin/desktop typecheck
pnpm --filter @piwin/desktop test
pnpm --filter @piwin/cli typecheck
pnpm dev:desktop   # browser
pnpm dev:tauri     # native (from monorepo root only)
```

## Not part of M2

See **[docs/todo-deferred.md](../todo-deferred.md)** — do not re-open items here unless promoting them into a new milestone spec.
