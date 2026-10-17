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
   The summarizer runs on the source session's model and thinking level
   (falling back to the configured default), never Pi's built-in provider
   default. If that model is refused or fails, the command returns problem
   `summary-model-unavailable { model?, reason }` (also used by
   `session/compact-export`); Desktop names the model and asks the user to
   switch the source session's model.
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
   session; the user writes the next step. Desktop switches there only when
   the user is still on the source session when the summary lands; otherwise
   it shows a toast with an Open action. The TUI `/handoff [focus]` does the
   same through its carried-refs path (inside a side chat `/handoff` keeps its
   old meaning: carry the answer back).
7. **Entry points and gating.** Desktop offers the session menu item and the
   composer command `/handoff [focus]` when the Host supports
   `session/handoff` and the session supports `compact` (the menu checks the
   session it was opened on, not the active one). External agent sessions are
   refused through the existing `compact` capability.
8. **A model completion, not an ack.** `session/handoff` has no request
   deadline (Desktop bridge, Host serve dispatcher; TUI gets 15 minutes),
   like `session/compact`. Desktop shows a sticky progress toast whose Cancel
   sends `session/compact-abort`.
9. **Refusals are typed.** Known refusals return problem
   `session-handoff-refused { reason: cancelled | empty-transcript |
   already-running | archived | empty-summary }`; Desktop localizes them and
   treats `cancelled` as an info, not an error.
10. **Preview is a read.** `session/handoff-summary { sessionId }` returns the
    stored summary for that session, capped at the same 24 000 characters the
    prompt receives, with `truncated` when the file was longer. A missing file
    is problem `session-handoff-summary-missing`. Desktop shows it as plain
    text from the composer chip. The summary stays untrusted model output.

## Consequences

- One compaction call per handoff (seconds to tens of seconds); the source
  session stays usable meanwhile.
- The summary is model-generated text and is treated like any other context
  ref: untrusted, bounded, never rendered as HTML.
- Not in v1: editing the summary before handoff, carrying unfinished
  `SessionPlan` steps, handing off to another backend. Preview from the chip
  shipped 2026-10-17 (`session/handoff-summary`).

## Revision 2026-10-17 — usability fixes

The first version timed out: Desktop gave the command its 15 s query budget
and the Host serve dispatcher a 45 s deadline, while summaries routinely run
longer. The user saw a timeout, the Host kept going and created a session
without the parked chip. Decisions 6–9 above record the fix: no deadline,
sticky cancellable progress, no forced jump, `/handoff` in the Desktop
composer, menu gating on the menu's own session, and typed refusals.

## Validation

See [handoff continuation validation](../evidence/2026-10-15-session-handoff-validation.md)
for cancellation/rollback regressions and browser verification, including the
pre-existing transcript `flushSync` warning fixed during this continuation.
