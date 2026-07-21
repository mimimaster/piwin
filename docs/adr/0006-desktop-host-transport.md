# ADR 0006: Desktop host transport = Tauri sidecar + JSONL

## Status

Accepted (2026-07-20) · Implemented (host bridge M2.B)

## Context

Desktop must use the same `@piwin/agent-host` as CLI without importing Pi into the WebView.

## Decision

1. Node host process exposes `HostCommand` / `HostPush` from `@piwin/contracts`.
2. CLI entry: `piwin host serve` speaks JSONL on stdin/stdout.
3. Tauri 2 spawns that process from Rust (`host_start` / `host_request` / `host_stop`).
4. Frontend `HostClient`:
   - browser Vite → in-process mock transport
   - Tauri runtime → invoke + `host-message` events
5. Apps never import `@earendil-works/*`.

## Commands (Rust)

| Command | Role |
|---------|------|
| `host_start { mock }` | spawn `pnpm --filter @piwin/cli exec tsx src/index.ts host serve [--mock]` |
| `host_request { command, timeoutMs? }` | write JSONL, wait for `type=response` with matching id |
| `host_stop` | kill child |
| `host_is_running` | probe |

## Events

| Event | Payload |
|-------|---------|
| `host-message` | HostServerMessage (status/event/response) |
| `host-log` | `{ level, message }` |

## Consequences

- Shared protocol between CLI tests and desktop
- First-run requires `pnpm` + `tsx` on PATH for the host process
- Agent can still be mock (`--mock`) while transport is live
