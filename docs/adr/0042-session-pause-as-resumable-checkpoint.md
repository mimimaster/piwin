# ADR 0042: Pause a session turn as a resumable checkpoint

- Status: accepted
- Date: 2026-08-10
- Updated: 2026-08-25
- Related: ADR 0012, ADR 0015, ADR 0040, `docs/specs/runtime-refactor.md`

## Context

Pi 0.80.10 exposes `prompt`, `steer`, `followUp`, and `abort` on
`AgentSession`, but it does not expose a native pause/resume operation. piwin
must not fork Pi or pretend that pausing Host egress pauses agent execution.

Host still needs a durable way to interrupt a long-running turn, keep partial
transcript, and optionally continue later. The existing RunRegistry already owns
admission, cancellation, joining, and terminality, while the session package
owns the durable transcript.

## Decision

### Host protocol (implementation)

Implement pause as a cooperative, resumable checkpoint:

1. `session/pause` closes Run admission, marks the Run `pausing`, and uses the
   existing abort path to reach the current operation's cancellation boundary.
2. Completed transcript rows, partial assistant output, and tool results remain
   durable. Tool and process side effects are not rolled back.
3. The old Run ends as `interrupted` with terminal code `paused`. A checkpoint
   containing only safe session/run/message references is persisted in the
   session transcript store.
4. `session/resume-run` creates a new foreground Run in the same product
   session. It uses the normal Host prompt pipeline with an internal
   continuation instruction, so runtime activation, permissions, tools, and
   SDK/RPC parity remain in one composition path.
5. `session/abort` remains irreversible cancel. When no Run is active it may
   clear a paused checkpoint.

The first version only pauses a foreground session turn with no active child
Runs. A request with active descendants is rejected with a stable error rather
than partially pausing a Run tree.

### Product UI (shells)

Desktop exposes the checkpoint workflow without adding parallel composer chrome:

1. **One primary run control while a Run is live.** Label and icon are
   **Pause**; there is no adjacent Pause+Stop pair.
2. Clicking Pause sends `session/pause` with the exact foreground `runId` and
   shows `pausing` until the Host publishes the terminal checkpoint.
3. Once paused, the same action slot shows **Continue** and an irreversible
   discard action. Continue sends `session/resume-run`; discard clears the
   checkpoint through `session/abort`.
4. Esc / the explicit `stop-run` command remain irreversible Stop gestures for
   emergency cancellation. They are deliberately named Stop and are not shown
   as a second live composer button.

## Consequences

- Pause is not token-exact provider continuation. The resumed model must inspect
  the current transcript and tool state before continuing.
- A tool that has already changed the filesystem, network, or a process is not
  undone by pause.
- SDK and RPC backends share the Host coordinator and both use their existing
  abort/cancel mechanisms; no new Pi-native worker protocol is required.
- The paused Run remains terminal and immutable, which keeps late-event
  filtering, restart behavior, and multi-client projections deterministic.
- Desktop keeps one primary live control while making checkpoint pause and
  continue directly usable. Irreversible Stop remains an explicit command.

## Future replacement point

If Pi later adds native pause/resume, the Host command and checkpoint contract
remain stable. Only the agent-host backend operation and continuation policy
need to gain a native implementation; the RunRegistry and durable checkpoint
authority do not move into Pi. The primary shell control remains one Pause even
if its backend later becomes provider-native.
