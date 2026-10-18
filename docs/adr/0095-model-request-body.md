# ADR 0095: Per-model custom request body

- **Status**: Accepted
- **Date**: 2026-10-18
- **Scope**: `@piwin/contracts`, `@piwin/agent-host`, `@piwin/host-runtime`, `@piwin/host-server`, `apps/desktop`
- **Consults**: ADR 0079 (per-model request protocol and headers), ADR 0043 (native search)

## Context

Gateways and vendors expose request-body knobs piwin has no first-class field
for. The owner's minimum bar is OpenRouter upstream routing
(`{"provider": {"order": ["anthropic"], "allow_fallbacks": false}}`); others
are vendor sampling parameters, `reasoning` shapes, or removing a field a
gateway rejects. Per-model headers already exist (ADR 0079) but the editor
only offered rows, which is awkward for pasting a header set.

## Decision

1. **Contract.** `ModelConfigEntry.extraBody?: ModelRequestBody` — a JSON
   object stored in `config.json`. `@piwin/contracts` `model-request-body.ts`
   owns validation (`validateModelRequestBody`), resolution
   (`resolveModelRequestBody`) and the merge (`mergeModelRequestBody`); no other
   module re-implements them.
2. **Merge semantics.** The body is deep-merged into the request piwin built,
   last: objects merge key by key, arrays and scalars replace, `null` deletes
   the key. Reserved top-level keys that piwin generates are never touched:
   `model`, `modelId`, `messages`, `input`, `instructions`, `contents`,
   `system`, `tools`, `stream`. Validation rejects them (rather than silently
   dropping) so the user sees why.
3. **Limits.** 16 KB serialized and 8 levels of nesting. Invalid or oversized
   bodies are rejected by config validation and, defensively, resolve to
   "no body" at request time.
4. **Subscriptions ignore it** (their wire is fixed), same as per-model
   protocol and headers.
5. **One application point per path.**
   - Pi-backed requests (main session in SDK and RPC worker modes, subagents,
     Pi-based one-shot completions, the native `web_search` sub-request) wrap
     the registration `streamSimple` innermost with
     `wrapStreamSimpleForModelRequestBody`. Its `onPayload` calls any earlier
     hook first, so native-search, Gemini isolation, cloud rewrites and caller
     hooks all run before the user body is merged. The worker receives the
     Host-resolved body in the provider envelope and never re-reads config.
   - One-shot completions keep the product stream whenever the model has a
     body (`completionNeedsRegistrationStream`), so OpenRouter routing also
     applies to titles, walkthroughs and summaries.
   - Raw-HTTP lightweight/structured completions and the per-model test merge
     the body into their OpenAI/Anthropic payloads. Gemini REST paths skip it:
     the body is written against the Pi SDK shape (`config.*`), not the REST
     `generationConfig` shape.
6. **Wire shapes are the user's job.** The body is what that wire sends:
   OpenAI Chat/Responses fields at the top level, Anthropic Messages fields,
   Gemini SDK fields under `config`, Bedrock model fields under
   `additionalModelRequestFields`. The editor shows a hint for the effective
   protocol.
7. **Remote shells.** The remote settings projection omits `extraBody` like it
   omits `headers`; only the Host and the local Desktop edit it.
8. **Desktop UI — 自定义请求.** A collapsible section in Add Model and the
   inline model editor (hidden on subscriptions). It starts collapsed,
   including when overrides exist or the provider base URL is OpenRouter;
   collapsed, it summarizes counts or flags invalid JSON. Users expand it
   explicitly to edit the overrides.
   - 请求头: rows or a JSON object, toggled; switching to rows requires valid
     JSON.
   - 请求体: a JSON editor with per-wire placeholder, format button, templates
     (OpenRouter upstream, sampling, delete-a-field via `null`), a live
     "每次请求都会合并：…" summary, and localized errors (the reserved-key
     error lists the protected fields).
   - **OpenRouter 上游路由** helper (OpenRouter base URLs only): an ordered
     upstream list with quick-pick slugs, "只使用这些上游" (`allow_fallbacks:
     false`) and sort (价格/吞吐/延迟). It edits `provider.order`,
     `provider.allow_fallbacks` and `provider.sort` in the same JSON and keeps
     any other `provider` fields; it is disabled while the JSON is invalid.
   - Drafts keep the raw text, so half-typed JSON is never rewritten; saving is
     blocked until it parses.

## Consequences

- OpenRouter routing, vendor parameters and field removal need no new piwin
  fields; a wrong body fails like a wrong provider setting (HTTP error at
  request time), and the per-model test surfaces it.
- The quick-pick slug list is static; uncommon upstreams are typed by slug.
- The provider-level connection test does not use model bodies; the per-model
  test does.
