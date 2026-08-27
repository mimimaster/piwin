# ADR 0059: Host-owned model retry policy

## Status

Accepted (2026-08-22), amended (2026-08-27)

## Context

Pi 0.84 enables automatic agent retries by default (`maxRetries: 3`). Its
generic error classifier treats the text `Provider returned error` as
transient, even when the upstream response contains HTTP 400. A single user
prompt can therefore issue several identical provider requests and produce
several identical failure rows. Pi also has a separate provider-request retry
setting.

The Host owns product run lifecycle and user-visible retry behavior. A hidden
retry is especially unsafe for provider gateways and makes the transcript look
like the user sent the prompt repeatedly.

## Decision

`@piwin/agent-host` supplies a Pi `SettingsManager` adapter in both SDK and RPC
worker modes. It delegates all native settings, but forces agent/compaction
retry and provider-request retry budgets to zero. A failed model request is
surfaced once; retry remains an explicit user action that creates a deliberate
new prompt/run.

The Pi event mapper also keeps identical provider errors deduplicated across
`message_end`, `agent_end`, and Pi's `auto_retry_*` lifecycle. This is a
defensive boundary for older or externally configured Pi sessions; it does not
replace the retry policy.

Pi's native turn result remains authoritative. `host-runtime` does not infer a
failure from missing text, missing tools, or missing first-token progress:

- `stop` and `length` complete normally, including a thinking-only `stop`;
- `error` is mapped by `agent-host` to the normalized error event and fails the
  product Run;
- `aborted` follows the active Run cancellation path;
- tool calls remain inside Pi's native Agent Loop.

OpenAI-compatible registrations no longer set
`compat.supportsFinishReason: false`. Pi 0.84 therefore preserves its native
`Stream ended without finish_reason` transport error instead of converting an
unterminated stream to `stop`.

`httpIdleTimeoutMs` remains the single configured idle duration. Raw HTTP body
idle cannot detect gateways that keep a stalled SSE response alive with comment
frames (`: keep-alive`), because every comment is body activity. The Pi boundary
therefore applies the same duration to parsed native assistant-message progress
(`message_start`/`message_update` until `message_end`). This narrow companion
timer lives in `@piwin/agent-host`; it is disarmed during tool execution and does
not create a second Host Run state machine.

Attachment preparation is unchanged. TXT/source/config content continues to be
bounded and injected as untrusted text, while images retain the native image
content path.

## Consequences

- Deterministic provider failures such as HTTP 400 no longer trigger hidden
  duplicate model requests.
- Users see one failure card per failed prompt and can retry deliberately.
- Transient failures no longer receive Pi's silent automatic retry; a future
  Host retry policy must classify structured provider status before re-enabling
  automatic retries.
- Thinking-only `stop` is visible as an empty successful assistant turn, matching
  Pi; presentation may explain it but cannot rewrite the Run outcome.
- A stream held open by proxy keep-alives fails with a stream-stalled message,
  not a generic network label.
- Native Pi settings other than retry budgets remain available to the session.
