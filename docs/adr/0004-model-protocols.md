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
- OpenAI-compatible streams must provide a terminal `finish_reason`. Pi's
  native missing-finish error is preserved; gateway compatibility must not
  silently reinterpret an unterminated response as `stop`.
