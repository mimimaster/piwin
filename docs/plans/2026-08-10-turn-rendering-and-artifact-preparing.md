# Turn-level activity rendering and Artifact preparing feedback

## Problem

One Pi run may emit several Assistant lifecycle messages around tool calls and
provider retries. Desktop currently renders `TurnWorkDetails` for every message,
so one run repeats the same elapsed time and exposes thinking-only lifecycle
rows. The SQLite transcript recorder also drops tools when Pi emits the normal
`message/end -> tool/start -> tool/end` sequence.

Slow providers create a second presentation gap: the global run locator covers
the wait for the first token, but an incomplete SVG/HTML fence has only muted
preparing text until the first safe stream-preview snapshot exists.

## Implementation

1. Keep the completed Assistant row addressable by run after `message/end` so
   later tool events can reload and mutate it. Add a regression test using Pi's
   real event order.
2. Project Assistant messages sharing one `runId` into one turn-work message.
   Render `TurnWorkDetails` once at the first Assistant row, aggregate thinking
   and tool cards, and suppress empty lifecycle-only rows.
3. While a run is active, label aggregated work as thinking/working rather than
   the terminal "Thought for N seconds" copy.
4. Replace the incomplete Artifact fence's static preparing shell with the
   shared `ArtifactFrame` preparing state and an Artifact sheen indicator. Keep
   the existing global locator for the pre-first-token phase.
5. Update the activity presentation spec and verify focused Desktop,
   Host-runtime, package tests, typecheck, and full tests as practical.

## Verification cases

- One run with several Assistant messages renders exactly one work-details
  summary and retains all thinking/tool cards.
- A thinking-only intermediate lifecycle message creates no empty transcript
  row after its thinking is included in the turn summary.
- Active work never says "Thought for N seconds" before the run terminates.
- `message/end -> tool/start -> tool/end` persists the tool card in SQLite.
- Incomplete SVG/HTML stream preview shows an animated preparing state; reduced
  motion disables the animation; the iframe still mounts only after a safe
  render decision.
