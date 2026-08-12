# Desktop streaming response viewport

| Field | Value |
|---|---|
| Status | Implemented; replaces the earlier prompt-anchor attempt from 2026-08-11 |
| Date | 2026-08-11 |
| Scope | `apps/desktop` presentation only |

## Problem

The earlier implementation pinned each submitted user prompt near the top of
the transcript and disabled follow-tail while that anchor existed. Its tail
spacer created visible blank space, but a long response continued below the
viewport instead of pushing older content upward. The result was not a locked
reading perspective: users had to choose “Follow latest” to see live output.

## Decision

Use the mature current-response viewport pattern used by coding-agent chat
surfaces:

1. The newest turn receives a minimum height equal to 75% of the measured
   transcript scrollport, rather than an arbitrary fixed tail spacer.
2. The transcript owns a responsive 72–96px output-floor gap above the composer.
3. A newly submitted live turn restores follow-tail. While following, response
   growth keeps the transcript at its real bottom: content grows downward until
   it reaches the output floor, then older content is pushed upward.
4. Wheel/trackpad or scrollbar navigation immediately detaches follow-tail;
   streaming updates must not steal the user's historical reading position.
5. “Jump to latest” is the only recovery control and restores follow-tail.
6. The waiting/activity row is part of the current response turn, so the same
   viewport remains stable before the first assistant text arrives.
7. Session scroll memory, older-page anchoring, transcript bounds, and
   virtualization remain unchanged.

## Verification

- Pure tests cover the 75% response-height calculation.
- Transcript viewport tests cover live-turn follow, response-height measurement,
  Artifact growth, manual scroll-away, session restoration, and older-page loading.
- ChatThread tests verify that both optimistic waiting states live inside the
  current response viewport.
- Focused Desktop tests: 39 tests passed across the response-height,
  transcript-scroll, transcript-viewport, and ChatThread suites.
- Playwright geometry regression: passed against the real Desktop web shell. It
  verifies the 75% current-response viewport, the 72px output floor at the test
  viewport, manual-scroll detachment during response growth, and jump-to-latest.
- Desktop typecheck, production build, and package-boundary architecture check:
  passed.
- Full Desktop unit run: all 182 files and 1,176 tests passed. Vitest still
  exits non-zero after completion because an existing asynchronous MarkdownView
  teardown reaches `window` after jsdom disposal; the isolated MarkdownView run
  passes all 43 tests.
- Root workspace typecheck remains blocked by an unrelated existing strictness
  error in `packages/host-runtime/src/capabilities/search-route-resolver.test.ts`.
