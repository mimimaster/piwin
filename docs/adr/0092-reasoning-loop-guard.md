# ADR 0092: Reasoning-loop guard in the model stream

- **Status**: Accepted
- **Date**: 2026-10-15
- **Scope**: `packages/agent-host` (`reasoning-loop-guard.ts`, both Pi session
  factories), `packages/contracts` (`text-repetition.ts`, moved from
  `host-runtime/src/tools/`)

## Context

DeepSeek V4.1 Flash in thinking mode can degenerate mid-response: it streams
the same reasoning passage verbatim, over and over, until it hits the output
token limit. The user waits minutes, pays for the whole ceiling, and gets no
answer.

Nothing in piwin stopped this:

- Pi only reacts when the message ends (`stopReason: "length"`).
- The Host idle-loop notice (docs/plans/2026-09-28-run-idle-loop-notice.md)
  watches tool-call signatures and reply text, never reasoning. It is also
  display-only.
- DeepSeek's own harness guard (`dsh-repeat-tool-reminder`) targets a
  different failure: the same tool call repeated across turns. It reminds the
  model after a tool result, which never happens inside one runaway response.

## Decision

Guard reasoning inside the stream, in `agent-host`, by wrapping
`ModelRuntime.streamSimple` in both the SDK backend and the RPC worker (so
dual host modes behave the same).

1. **Detect**: accumulate the response's `thinking_delta` text and, as it
   grows (every 512 chars or 1/8 of its length), look for a verbatim periodic
   tail: one unit of at least 24 chars, at least 5 copies back to back,
   covering at least 600 chars. Exact repetition only; the finder is the one
   the idle-loop notice already uses, now parameterized and moved to
   `@piwin/contracts` so the worker process can use it too.
2. **Cut and retry**: abort the upstream request, drop what it still emits,
   and issue a fresh request into the same stream object Pi is iterating.
   The retry context is the original context plus one ephemeral user note
   that quotes the looped passage and asks the model to reason briefly and
   act. Up to 2 retries per model call.
3. **Fail fast otherwise**: once the budget is spent, or when the attempt has
   already streamed answer text or tool-call arguments (a retry would
   duplicate visible output), end the response with `stopReason: "error"` and
   a `Reasoning loop: …` message instead of running to the token limit. The
   wording avoids Pi's retryable-error patterns, so Pi does not auto-retry the
   same context.
4. A caller abort (user Stop) always wins; the guard never retries an aborted
   call.

The looped attempt is never persisted: Pi's agent-loop keeps only the partial
message of the live attempt, and the retry note exists only in that request.

## Consequences

- A degenerate response costs at most a few thousand reasoning chars per
  attempt instead of the full output ceiling.
- Live clients still show the discarded attempt's reasoning deltas until the
  message ends; there is no "reasoning reset" event yet. The persisted message
  is clean.
- The discarded attempt's token usage is not counted, because providers
  report usage at stream end.
- Near-verbatim loops (changing numbers, paraphrase) are not detected.
- Thresholds are constants, not settings. Revisit if a model reasons in
  legitimately repetitive blocks.

## Alternatives considered

- **Port `repeat-tool-reminder` (tool-call reminder after N identical calls)**:
  useful for a different loop, but cannot stop a single runaway response.
- **Host-side detection + abort the Run + hidden follow-up prompt**: needs Run
  lifecycle changes and a synthetic prompt path, and would end the Run the
  user started. The stream layer can retry transparently instead.
- **Sampling penalties**: DeepSeek documented thinking mode (V3.x reasoner)
  as ignoring `frequency_penalty`/`presence_penalty`, and a penalty would
  apply to every model anyway. Not relied on.
