# ADR 0079: Per-model request protocol

## Status

Accepted — 2026-09-29.

## Context

A provider row carries one `protocol` (`openai-compatible`,
`anthropic-compatible`, `google-gemini`). Local multi-vendor gateways such as
CLIProxyAPI (CPA) serve several wire formats from one base URL and one key:
OpenAI Chat/Responses under `/v1`, Gemini `generateContent` under `/v1beta`,
Anthropic Messages under `/v1/messages`.

Behind one OpenAI-compatible row, a Gemini model loses what only its native
format expresses. Measured against CPA on 2026-09-29: OpenAI
`web_search_options` → `malformed_function_call`; Responses `web_search` →
reasoning only; a passthrough `google_search` tool searched but CPA dropped
`groundingMetadata`, so no sources and no Search Suggestions. The same model
through CPA's `/v1beta/...:generateContent` with `google_search` returned
queries, sources and suggestions. `/v1/models/...:generateContent` is 404.

Users had to duplicate the gateway as a second provider per wire format.
DEEIX-Chat solves this by choosing the protocol per model route on one channel
and normalizing an OpenAI-style `/v1` base for Gemini
(`normalizeGeminiEndpointBaseURL`).

## Decision

1. `ModelConfigEntry.protocol?` optionally overrides the provider protocol for
   that model. Omitted means inherit. Base URL, key, headers and enablement stay
   on the provider. Subscription providers ignore the override (their wire is
   fixed by the subscription).
2. When the override differs from the provider protocol, the model's base URL
   is derived from the provider base URL: drop a trailing `/v1`, `/v1beta` or
   `/v1alpha`, then append the version the target protocol expects —
   `google-gemini` → `/v1beta`, `openai-compatible` → `/v1`,
   `anthropic-compatible` → root (the Anthropic client appends `/v1/messages`).
   The provider's `chatApi` applies only to models that inherit its protocol;
   an overriding model uses its protocol's default transport.
3. `resolveModelEndpoint(provider, model)` in `@piwin/contracts` is the only
   implementation. It returns a provider-shaped view for that model (effective
   `protocol`, `baseUrl`, `chatApi`). Every place that shapes a request for a
   specific model goes through it: Pi provider registration (main session,
   subagents, Pi-based completions, the native `web_search` sub-request),
   the raw-HTTP structured/lightweight completions, Gemini REST native search,
   and native-search readiness.
4. `ModelRef.protocol` keeps meaning the provider row's protocol: it is part of
   the reference identity and is already persisted (defaults, subagent
   profiles, delegates). Overriding a model's protocol never invalidates saved
   references.
5. Pi registration keeps one registration per provider id. Each model
   descriptor carries its own `api` and `baseUrl`; the registration
   `streamSimple` dispatches to Pi's lazy stream for the model's `api`. The
   worker envelope carries the per-model effective protocol and base URL
   computed by Host, so the worker never re-derives them.
6. Model discovery, connection tests and image/video/speech routes stay
   provider-level; image/video already have per-model routes (ADR 0034).
7. Settings: the model editor and Add Model on channel providers expose
   **请求协议**: 跟随服务商 / OpenAI / Anthropic / Gemini.

## Consequences

- One CPA row can hold Grok on OpenAI and Gemini on Gemini; Gemini native
  search works through it (ADR 0043 readiness follows the effective protocol).
- Thinking-level defaults, native-search adapters and structured completion
  shapes follow the effective protocol.
- A wrong override fails like a wrong provider protocol would (HTTP error at
  request time); the connection test still probes only the provider protocol.
