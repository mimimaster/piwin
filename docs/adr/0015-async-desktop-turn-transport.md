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
   `cancelled` only after Host `run/terminal` confirms the run has stopped.
   Host no longer owns a model-stream watchdog. Parsed-stream stalls are
   detected only in `@piwin/agent-host` for OpenAI-completions, using Pi's
   `httpIdleTimeoutMs`, and they return a failed `AgentPromptOutcome`.
   `RunRegistry` is the only product Run terminal authority; every
   foreground Agent event that can affect a Run carries an explicit `runId`.
   `session/resume` with no foreground run settles leftover `streaming`
   assistant rows so a missed `message/end` cannot leave a durable zombie.

7. **Late events from a superseded run are discarded.** The host and UI track
   the current `runId` per session. Events carrying an older `runId` are logged
   at the host boundary but do not mutate the active transcript or UI state.

## Consequences

- Desktop remains interactive during arbitrarily long model turns.
- Stop, steer, and permission resolution are always reachable.
- The UI can display run phases and elapsed time instead of a single
  indeterminate "responding" state.
- Parsed-stream stalls fail the Run through the same outcome path as other
  Agent failures; user Stop remains a Host-owned abort that terminalizes
  `cancelled`.
- The JSONL sidecar protocol gains a control lane and per-session work queues,
  replacing the single global FIFO.
- ADR 0006 remains valid for framing, event push, and short request/response
  commands. Only the long-operation completion semantics are superseded.

## Amendment (2026-09-23): the output side must not block the Host

The control lane only helps if the Host's event loop keeps running. On
Windows, Node writes to a stdout **pipe** synchronously: when the Desktop's
reader falls behind (large `browser/frame` JSON, a busy WebView), a single
`process.stdout.write` blocked 2.4s and the event loop ran 3 of 50 timer ticks.
Every command — `host/status` included — stalls, the Desktop reports the Host
as unreachable, then the backlog floods in at once.

- `host serve` on Windows writes JSONL from a worker thread
  (`host-serve-worker-jsonl-writer.ts`); the blocking write happens there. The
  same probe with the worker kept 42 of 50 ticks.
- The local egress client's `canSend` is the output backlog under
  `HOST_SERVE_OUTPUT_BACKLOG_BYTES` (2 MB), so pushes wait in the egress channel
  where projections (browser frames) coalesce to the latest value and a
  response never queues behind tens of MB. The local client gets large queue
  limits so it is never closed as a slow consumer.
- macOS/Linux keep the stream writer (their stdout pipes are asynchronous, so
  the loop never blocks), but the same backpressure applies: the backlog counts
  lines waiting in the writer's drain chain plus `writableLength` — the chain
  alone is invisible to `writableLength`, which never passes one buffer.
