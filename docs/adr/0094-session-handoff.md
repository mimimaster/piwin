# ADR 0094: Session handoff — continue in a fresh session with a summary

- **Status**: Accepted
- **Date**: 2026-10-15
- **Scope**: `@piwin/contracts`, `@piwin/host-runtime`, `@piwin/host-server`, `apps/desktop`, `apps/cli` (TUI)
- **Consults**: ADR 0035 (compact export), ADR 0032 (side chat refs), ADR 0082 (external agents)
- **Spec**: `docs/specs/2026-10-15-session-handoff.md`

## Context

A long session fills its context or drifts. Compacting in place keeps the
same session; forking copies the whole history. Users want a third move:
start clean, but keep what matters, and keep going (prior art: Amp
`/handoff`, Claude Code "continue in new session").

## Decision

1. **Host command `session/handoff { sessionId, instructions? }`.** It reuses
   the ADR 0035 ephemeral snapshot compaction (`compactTranscriptSnapshot`) as
   the only summarizer, steered by handoff instructions (goal, state,
   decisions, files, open problems, next steps). Cancel with
   `session/compact-abort` on the source session. Once accepted, cancellation
   wins even if the provider concurrently returns a successful summary.
2. **New session, created lazily.** Same scope, working directory, model,
   thinking level, knowledge bases, MCP opt-outs and orchestration settings;
   name `Handoff · <source>`; no transcript, no runtime until the first
   prompt. The source session is not changed.
3. **Origin `handoff`.** `ProductSessionOrigin` gains
   `{ kind: 'handoff', sourceSessionId, sourceSessionNameSnapshot?, createdAt }`.
   The origin badge reads 交接 / Handoff and jumps back to the source.
4. **Summary storage.** `~/.piwin/sessions/<newId>/handoff.md`, so deleting
   the session deletes the summary. A failed write deletes the new session
   (no half-handoff). Cleanup errors are reported with the original failure.
5. **Context ref `session-handoff { sessionId, sourceSessionId, label }`.**
   Part of `PromptContextRef`, not of side-chat refs. Ids only, so it is safe
   for remote clients. The Host resolves it only while preparing a prompt of
   that same session (including bounded history replay), capped at 24 000
   characters, as `<context_ref type="session_handoff">`.
6. **No auto-send.** Desktop parks the ref as a composer chip on the new
   session before switching to it; the user writes the next step. The TUI
   `/handoff [focus]` does the same through its carried-refs path (inside a
   side chat `/handoff` keeps its old meaning: carry the answer back).
7. **Gating.** Desktop shows the menu item when the Host supports
   `session/handoff` and the session supports `compact`; external agent
   sessions are refused through the existing `compact` capability.

## Consequences

- One compaction call per handoff (seconds to tens of seconds); the source
  session stays usable meanwhile.
- The summary is model-generated text and is treated like any other context
  ref: untrusted, bounded, never rendered as HTML.
- Not in v1: editing the summary before handoff, previewing it from the chip,
  carrying unfinished `SessionPlan` steps, handing off to another backend.

## Validation

See [handoff continuation validation](../evidence/2026-10-15-session-handoff-validation.md)
for cancellation/rollback regressions and browser verification, including the
pre-existing transcript `flushSync` warning fixed during this continuation.
