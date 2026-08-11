# Desktop transcript turn-anchor polish

| Field | Value |
|---|---|
| Status | Implemented |
| Date | 2026-08-11 |
| Scope | `apps/desktop` presentation only |

## Problem

The transcript currently uses one follow-tail policy for both history and a
newly submitted turn. Every message, tool, thinking, or Artifact height update
writes `scrollTop = scrollHeight`, so the user's new prompt stays against the
composer and the response begins below the useful reading area.

## Decision

1. A newly submitted top-level prompt starts a **turn anchor** keyed by the
   optimistic user-message id.
2. While attached, the prompt is kept near the top of the transcript viewport
   and live assistant work grows below it.
3. A temporary tail spacer makes that placement possible even before the
   response has enough height to fill the viewport.
4. Wheel/trackpad or scrollbar navigation immediately releases the anchor and
   preserves user control.
5. “Follow latest” releases the anchor and restores the existing follow-tail
   behavior.
6. Session scroll-memory, older-page anchoring, transcript bounds, and
   virtualization remain unchanged.

## Verification

- 85 focused Desktop tests pass across activity copy, tool cards, transcript
  anchoring, viewport recovery, and turn rendering.
- Local browser QA confirms a long-history prompt remains 28px below the
  transcript viewport top while the response grows; “Follow latest” removes
  the temporary spacer and returns to the tail.
- Strict Desktop diagnostics pass when the pre-existing unused
  `ultraEnabled` parameter check is suppressed. The standard typecheck remains
  blocked by that unrelated dirty-worktree change in
  `model-thinking-policy.ts`.
- The full Desktop suite now accepts the event-derived activity wording; its
  remaining failures are pre-existing model-thinking, document extraction,
  and renderer CSS assertions outside this scope.
