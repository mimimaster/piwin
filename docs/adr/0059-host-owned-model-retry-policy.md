# ADR 0059: Host-owned model retry policy

## Status

Accepted (2026-08-22)

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
- Native Pi settings other than retry budgets remain available to the session.
