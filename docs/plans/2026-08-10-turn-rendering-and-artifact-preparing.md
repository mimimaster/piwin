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
2. ~~Project Assistant messages sharing one `runId` into one turn-work message.
   Render `TurnWorkDetails` once at the first Assistant row, aggregate thinking
   and tool cards, and suppress empty lifecycle-only rows.~~
   **Superseded (2026-08-13)** by the append-only
   [causal agent event stream](2026-08-12-causal-agent-event-stream.md): no
   single aggregated run summary; rows render in causal event order.
3. ~~While a run is active, label aggregated work as thinking/working rather
   than the terminal "Thought for N seconds" copy.~~
   **Superseded (2026-08-13)** together with step 2 — there is no aggregated
   work summary to label; active thinking labels live on the causal rows.
4. Replace the incomplete Artifact fence's static preparing shell with the
   shared `ArtifactFrame` preparing state and an Artifact sheen indicator. Keep
   the existing global locator for the pre-first-token phase.
   **Reversed (2026-08-13)** — see the follow-up section below; the preparing
   shell and loading overlay were removed again after user feedback.
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

## Follow-up (2026-08-13): preparing/loading states removed

User feedback: the animated "preparing" intermediate state and the in-frame
loading shell felt like a regression against the original progressive streaming
render, and a transcript re-render (e.g. clicking the composer) reset painted
frames back to the waiting shell while collapsing their height.

Reversal:

- `evaluateArtifactDescriptor` no longer returns `preparing` in
  `stream-preview` mode. Empty / not-yet-streamable sources mount the live
  iframe immediately (empty or sanitized body) and stream snapshots draw the UI
  block by block. Real blocks (size, external resources) are unchanged.
- `ArtifactFrame` no longer renders the preparing shell or the loading overlay;
  the iframe paints immediately after the init grant (no opacity gating).
- The height-reset `useLayoutEffect` now keys on the stable `documentKey`
  (srcdoc identity) instead of the per-render `decision` object, so equivalent
  re-renders no longer reset height/status. Streaming SVG still seeds from the
  viewBox estimate on every snapshot (grow-only).
- The sandboxed height bridge re-measures when late-loading media (`img`,
  `video`, nested `svg`) fires `load`, so a mid-load "trim" measurement can no
  longer lock a cropped frame.
- The live-host budget / recycled "paused to save memory" placeholder is kept
  (it is the actual memory optimization), only the waiting animations were
  removed.

The `preparing` decision kind remains in `@piwin/artifact` types for API
stability but is no longer emitted by the evaluation pipeline.
