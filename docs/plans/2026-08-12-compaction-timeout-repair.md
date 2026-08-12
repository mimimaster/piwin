# Compaction transport timeout repair

| Field | Value |
|-------|-------|
| Status | Implemented |
| Date | 2026-08-12 |

## Problem

Manual context compaction awaits a model-generated summary, but Desktop treated
`session/compact` as a five-second acknowledgement command. The Host serve
dispatcher independently imposed a 45-second command deadline. Either layer
could report failure and discard response correlation while Pi continued
compacting in the background.

## Decision

- Keep the existing request/result contract and normalized
  `compaction/start` / `compaction/end` events.
- Disable transport and dispatcher wall-clock deadlines only for
  `session/compact` and `session/compact-export`.
- Keep `session/compact-abort` on the short control lane so the user retains a
  bounded cancellation path.
- Preserve all existing deadlines for status, acknowledgement, query, and
  other operation commands.

This is a transport-semantics repair, not a new compaction algorithm. Provider
context-overflow errors remain visible as the real operation result instead of
being hidden behind an unrelated shell timeout.

## Verification

- Desktop HostClient regression test asserts compaction sends the explicit
  no-deadline sentinel.
- Host serve dispatcher regression test asserts compaction remains correlated
  beyond the ordinary command deadline and returns its eventual result.
- Rust Host bridge test fixes the zero-timeout sentinel semantics.
- Desktop and CLI full tests/typechecks, Rust Host bridge tests, and package
  architecture boundaries pass.
