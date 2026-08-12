# Compact transcript tool activity

| Field | Value |
|---|---|
| Status | Superseded |
| Date | 2026-08-11 |
| Surface | Desktop transcript only |

## Goal

> Superseded on 2026-08-11 by
> [Model-turn tool timeline](../specs/model-turn-tool-timeline.md). Field
> inspection showed that Run-level aggregation erases Assistant response
> boundaries, and automatic collapse reverses explicit user interaction. This
> file remains as implementation history, not the target design.

Keep tool execution inspectable without letting it take over the conversation:

1. Completed calls occupy one summary row in the transcript.
2. While work is active, only the latest running call is visible and expanded.
3. Starting a new call closes any previously opened audit trail so the composer
   is not pushed off-screen during a long run.
4. Clicking the summary reveals the full chronological history on demand.
5. Tool output remains detail content and is never promoted into the row title.

## Boundaries

- Keep `AgentEvent`, transcript persistence, permissions, and Host/Pi execution
  unchanged.
- Reuse `ToolCallCard` for detailed rows and the existing normalized
  `ToolPresentation` facts for classification.
- Running calls render bounded streaming output; completed cards unmount until
  the user opens the summary.
- Errors stay represented by a failure count and remain inspectable in history.
- Host presentation must derive titles from inputs, commands, targets, or stable
  tool names—never stdout/stderr.

## Verification

- Host unit coverage preventing raw output from becoming a summary.
- Component coverage for completed rollup, current-call focus, manual audit
  expansion, failure counts, and automatic collapse on the next live call.
- Desktop and agent-host typecheck plus focused tests.

## Result

- Completed activity now occupies one row regardless of call count.
- Only the current call mounts during execution; its long output starts folded.
- Full history remains available by expanding the summary.
- Raw output no longer becomes a tool title when arguments are unavailable.
- Focused Desktop regression suite: 31 tests passed.
- Full agent-host suite: 23 files and 190 tests passed.
- Desktop and agent-host typechecks passed; Desktop production build passed.
- Full Desktop assertions: 182 files and 1,178 tests passed; Vitest still exits
  non-zero because three pre-existing `MarkdownView` teardown callbacks access
  `window` after the test environment is gone.
- Local production-preview smoke verified the completed one-row summary and
  on-demand audit expansion in the rendered app.
