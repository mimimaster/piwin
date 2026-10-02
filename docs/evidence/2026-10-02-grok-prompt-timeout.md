# Grok prompt deadline regression — 2026-10-02

## Observed failure

The Desktop test environment on port 1420 uses `~/.piwin-test`. Session
`session-muqh3fg6-sm1dsqgj` is bound to Grok CLI 1.0.46,
`grok-4.7-build-fast`, effort `high`, through a session-backend extension.
Read-only inspection of its transcript found:

- User message: `2026-10-02T04:38:35.184Z` (12:38:35 Shanghai).
- Last assistant message began: `2026-10-02T04:39:05.387Z`.
- Last thinking content ended: `2026-10-02T04:39:05.772Z`.
- Failure recorded: `2026-10-02T04:39:05.780Z`,
  `session/prompt timed out after 30000ms`.

This was a total request deadline, not a 30-second gap in model output.
`AgentPluginBridge.request` applied the control timeout to prompt completion
without considering streaming events. The plugin response represents a whole
turn, which can include many assistant messages and tool calls.

## Correction and verification

Prompt completion has no generic control deadline. Ordinary plugin requests
retain their deadline; cancel, process exit and disposal still settle pending
work. No vendor code or installed extension revision needs modification.

Two fixture regressions failed against the original bridge with the exact
reported error: a streaming turn and a silent thinking turn both rejected
after advancing the Host clock beyond 30 seconds. The corrected bridge must
keep them pending, accept the terminal completion once, and allow cancellation
after the same elapsed time. Existing process-exit and control-timeout cases
remain part of the verification suite.

## Usage timing follow-up

At the owner's request, the generic plugin session now measures first content
and elapsed turn time before async event preparation. Finalized usage without
TTFT receives these values and `timingScope: turn`. Aggregate output token
counts produce turn-average TPS in the existing usage table; the visible turn
label and tooltip distinguish it from a single model request's generation
speed. Tools and approval waits remain in the average. Timing supplied by an
adapter is preserved. Historical replay is unchanged.

Verification completed:

- Host bridge/control/session/product/lifecycle suite: 40 tests passed.
- Host timing, bridge, session, usage integration and coordinator: 50 passed.
  The integration drives a real fixture child process through an installed
  extension and `session/prompt` into `usage/list-recent`, checking latency,
  duration, token counts, turn scope and a single ledger row.
- Contracts usage/parser: 14 passed; session ledger: 16 passed.
- Desktop usage table: 15 passed, including the turn-average label/tooltip.
- Root `pnpm typecheck` and package-boundary checks passed.

No real Grok prompt was sent and no user transcript was modified. An
already-running Host must reload the corrected source for new turns to use it.

## Correction: an aggregate ledger row is not one model call

The owner's observation of continuous Grok work was correct. Inspecting only
the finalized Host ledger caused an incorrect conclusion about the number of
model calls. That ledger gets an aggregate record at turn completion, while
Grok has already made numerous requests inside the turn.

The bound native session is `01a0fae8-2f47-79b0-9564-73498c21cb9c`.
A read-only query through the newly built standalone adapter, at
`2026-10-02T05:22:22.013Z` (13:22 Shanghai), returned **171 completed requests**
for product session `session-muqh3fg6-sm1dsqgj` since the reported prompt.
All 171 matched first-token events. Three latest samples:

| Completed at (UTC) | Output tokens | Model duration | First-token latency |
| --- | ---: | ---: | ---: |
| 05:17:46.597 | 399 | 7367 ms | 4367 ms |
| 05:17:53.438 | 196 | 6813 ms | 5126 ms |
| 05:18:05.242 | 429 | 8485 ms | 3838 ms |

Tokens and duration come from native `shell.turn.inference_done` records;
TTFT uses `ttft_ms` when present, otherwise the first-token event timestamp
minus the inferred request start (`end - model_elapsed_ms`). This timestamp
correlation is not a provider-reported TTFT. Missing matches remain absent.
Native `totalTokens` context occupancy is never differenced to infer billing.

The correction adds an optional normalized `catalog/usage` query, implemented
in the separate Grok plugin repository, and merges completed request detail
into recent calls on each refresh. Historical logs are read without waiting
for a new prompt or turn completion. Aggregate turn records are suppressed
only in this detailed view; no user ledger/transcript is rewritten.

Final verification:

- Contracts, session ledger, Desktop usage and Host regression suites:
  139 tests across 14 files passed.
- Grok plugin: all 33 tests across 8 files passed; plugin typecheck passed.
- Integration verifies two requests visible during a pending turn, rejects
  invalid/foreign records, and refreshes to three after a control revision
  change while the original session remains cancellable.
- Standalone plugin bundle and matching extension manifest built successfully.

The source fix exists in both repositories. The running port-1420 Host and
its selected immutable extension revision have not been replaced; applying
the corrected Host/plugin requires their normal reload/update. Active user
tasks were not interrupted for deployment.
