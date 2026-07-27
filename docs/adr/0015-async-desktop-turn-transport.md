# ADR 0015: Asynchronous Desktop turn transport and cancellation

## Status

Accepted (2026-07-24) · Supersedes the long-operation request/response portion
of ADR 0006. Retains JSONL as the development-sidecar framing.

## Context

The Desktop transport (ADR 0006) was designed as a request/response JSONL
bridge. `session/prompt` blocks until the entire model turn completes, and
every non-interactive command is serialized behind it in a global FIFO queue.
This produces three product failures:

1. **Stop is unreachable.** `session/abort` queues behind the in-flight
   `session/prompt`, so cancellation never reaches Pi while it matters.
2. **macOS spinning cursor.** The Tauri `host_request` command is synchronous
   Rust and blocks the native command thread for the full turn duration.
   Tauri documents that non-`async` commands execute on the main thread.
3. **Timeouts do not cancel.** The 45 s sidecar and 60 s Desktop deadlines
   reject the response wrapper but leave the underlying model/MCP work running.

The host already pushes normalized `AgentEvent` streams through `host-message`.
The synchronous request/response wait for long operations is therefore
unnecessary and harmful.

## Decision

1. **`session/prompt` is a quick acceptance command**, not a turn-completion
   RPC. It validates input, persists the user message, allocates a `runId`,
   registers an `ActiveRun`, starts the model turn as a tracked background
   task, and returns `{ sessionId, runId, acceptedAt }` immediately.

2. **Progress and terminal state arrive through normalized host push events**
   carrying the same `runId`:
   - `run/phase` — accepted, preparing, connecting-model, waiting-first-token,
     streaming, tool-running, waiting-permission, cancelling.
   - `run/terminal` — completed, cancelled, or failed, with a stable code and
     optional message.
   - Existing `message/*`, `tool/*`, `session/aborted`, and `error` events
     remain for backward compatibility during migration.

3. **One session permits at most one foreground run.** A second
   `session/prompt` is rejected with a stable `run-active` error unless it is
   explicitly a steer or follow-up operation.

4. **Control-lane commands bypass the normal queue:**
   `session/abort`, `session/compact-abort`, `session/steer`,
   `session/follow_up`, `permission/resolve`, and `extension/ui_resolve`.
   These must reach `HostRuntime` immediately, regardless of in-flight work.

5. **Tauri command completion is never used to wait for a model turn.**
   The Rust bridge accepts/enqueues a sidecar command and returns promptly.
   Later data arrives through `host-message` push events. Short control-plane
   requests (config reads, status) may retain request/response semantics with
   bounded timeouts.

6. **Cancellation is best effort across provider/MCP boundaries.** Local UI
   state reaches `cancelling` immediately upon user Stop. It reaches
   `cancelled` only after a terminal normalized event confirms the run has
   stopped. A timeout that cannot cancel the underlying work is reported as
   `failed` with a `model-turn-timeout` code, not as a silent success.

7. **Late events from a superseded run are discarded.** The host and UI track
   the current `runId` per session. Events carrying an older `runId` are logged
   at the host boundary but do not mutate the active transcript or UI state.

## Consequences

- Desktop remains interactive during arbitrarily long model turns.
- Stop, steer, and permission resolution are always reachable.
- The UI can display run phases and elapsed time instead of a single
  indeterminate "responding" state.
- Timeouts become cancellation-aware: they trigger the same abort path as
  user Stop, rather than merely rejecting a response wrapper.
- The JSONL sidecar protocol gains a control lane and per-session work queues,
  replacing the single global FIFO.
- ADR 0006 remains valid for framing, event push, and short request/response
  commands. Only the long-operation completion semantics are superseded.
