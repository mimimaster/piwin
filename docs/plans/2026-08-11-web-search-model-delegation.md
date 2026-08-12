# `web_search` model delegation plan

## Goal

Allow the Host-owned `web_search` tool to delegate a query to one enabled,
configured model tagged with `native-web-search`. The selected delegate is
independent from the active chat model, so a text-only or non-search model can
use Gemini (or another configured native-search model) as its search backend.

## Semantics

- `WebConfig.searchDelegateModel` is an optional configured `ModelRef`.
- When set and valid, the delegate is the exclusive backend for the Host
  `web_search` tool; ordinary DuckDuckGo/Brave/Tavily/CLI sources are retained
  in config but are not called.
- Delegated search remains the `external` route in ADR 0043 terminology: the
  active chat model calls one Host tool, and the Host invokes the configured
  delegate model with provider-native search enabled.
- A stale, disabled, untagged, or unsupported delegate fails closed and is
  reported unavailable instead of silently calling a different backend.
- Provider credentials remain Host-owned. Config stores only `ModelRef`.

## Vertical slice

1. Add the optional delegate model reference to `@piwin/contracts`, config
   defaults/normalization, and search-route preview input/readiness.
2. Add a narrow `@piwin/agent-host` native-search completion adapter that uses
   Pi's real protocol stream and returns text without exposing Pi types.
3. Add a `@piwin/tools-web` delegate port and strict parser for normalized
   `SearchHit[]`; select it exclusively when configured.
4. Compose provider/model validation, secret resolution, and the adapter in
   `@piwin/host-runtime` for both SDK and RPC Host tool execution.
5. Add a Web Settings selector populated only by enabled configured models
   tagged `native-web-search`, with clear replacement semantics.
6. Verify pure/config/UI/Host/agent adapter tests, then run typecheck, full
   tests, architecture checks, Desktop build, and a credential-safe Gemini
   smoke test when the local configured model is usable.

## Non-goals

- Auto-tagging models by name.
- Running delegate and ordinary search sources in parallel.
- Persisting raw provider keys in Web config.
- Treating the delegated model as the active chat model's own native route.

The active chat model has no separate native-search mode. The unified
`searchRoutePolicy` is the only route switch: native-selected requests receive
provider-native search fields, while external-selected requests have those
fields removed and expose Host `web_search` instead.

## Verification (2026-08-11)

- Target suites: contracts 18, agent-host 22, tools-web 14, host-runtime 73,
  Desktop 24 — all passed.
- `pnpm typecheck`, `pnpm test:architecture`, and
  `pnpm --filter @piwin/desktop build` passed.
- Credential-safe live smoke used the existing
  `custom-openai/gemini-3.6-flash-high` endpoint with the capability tag added
  only to an in-memory config clone. It returned two parseable official Node.js
  source hits; no key, raw response, or config mutation was emitted.
- Full `pnpm test` completed every Desktop assertion but remains red because
  unrelated `MarkdownView.test.tsx` work leaves React scheduler callbacks after
  environment teardown. The failing Plan Run timing assertion from an earlier
  full run passed immediately in isolation.
