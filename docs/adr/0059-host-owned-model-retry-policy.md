# ADR 0059: Pi-native model retry authority

## Status

Accepted (2026-08-22), amended (2026-08-27) — Pi native retry restored

## Context

Pi 0.84 enables automatic agent retries by default (`maxRetries: 3`). An earlier
piwin amendment forced those budgets to zero because Pi's generic classifier
can treat prose such as `Provider returned error` as transient. That left the
product with "no retry anywhere": ADR 0059 claimed Host retry ownership while
implementing none.

The Host still owns the product Run lifecycle. It does not own model-request
retry. Retry attempts stay inside one Pi prompt / one product Run.

## Decision

`@piwin/agent-host` does not override Pi retry settings. Native
`retry.enabled`, `retry.maxRetries`, `retry.baseDelayMs`, and provider retry
timeout/budget/delay pass through from the user's Pi SettingsManager.

All native retry attempts remain inside the same product Run. Pi
`auto_retry_start` / `auto_retry_end` map to `AgentEvent` `model/retry`. Host
projects non-finished retry as `connecting-model`. Intermediate retry failures
do not terminalize the Run; only the final `AgentPromptOutcome` does.

User-visible Retry after a failed Run is a new product Run. It is separate
from Pi native retry inside the old Run.

Pi 0.84's generic classifier may still retry deterministic provider prose.
That is pinned-kernel behavior. Do not add a Host retry classifier to
compensate. A later Pi pin can be evaluated under the conformance suite.

The Pi event mapper still deduplicates identical provider error *display*
events across `message_end`, `agent_end`, and `auto_retry_*`. That is display
dedup, not a second retry policy.

Pi's native turn result remains authoritative:

- `stop` and `length` complete normally, including a thinking-only `stop`;
- `error` maps to a structured `AgentFailure` and fails the product Run;
- `aborted` follows the Host-owned abort reason, or a failed transport
  outcome when no Host abort exists;
- tool calls remain inside Pi's native Agent Loop.

OpenAI-compatible registrations do not set
`compat.supportsFinishReason: false`. Missing `finish_reason` stays Pi's
native protocol/transport error.

`httpIdleTimeoutMs` remains the single configured idle duration. The
OpenAI-completions parsed-stream guard in `@piwin/agent-host` applies that
same duration to assistant-message progress so SSE keep-alive comments cannot
hide a stalled token stream. It is not a Host watchdog.

## Consequences

- User-configured Pi retry settings actually run.
- Retry activity is visible inside one Run and does not create a duplicate
  error card for intermediate attempts.
- Users still start an explicit new Run after a final failure.
- Thinking-only `stop` remains a successful empty assistant turn.
- A stream held open by proxy keep-alives fails as `model-stream-stalled`,
  not a generic network label.
