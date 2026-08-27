# ADR 0004: User-configured dual protocol surface

## Status

Accepted (2026-07-19)

## Context

Users bring their own keys/gateways. Hardcoding a single vendor is wrong.

## Decision

v1 first-class protocol configs:

1. **OpenAI-compatible**
2. **Anthropic-compatible**

Users fill baseUrl/apiKey/models. Host maps into Pi providers.

## Consequences

- Provider UI = form + advanced JSON
- No vendor login product requirement in v1
- Gateway products (LiteLLM, local proxies) work via OpenAI-compatible
- OpenAI-compatible streams must provide a terminal `finish_reason`. Missing
  `finish_reason` stays Pi's native protocol/transport error. Host does not
  reinterpret an unterminated response as `stop`, and it does not add a
  Host-owned finish-reason watchdog. The only compatibility timer is the
  OpenAI-completions parsed-stream guard in `@piwin/agent-host`, using Pi's
  `httpIdleTimeoutMs`.
