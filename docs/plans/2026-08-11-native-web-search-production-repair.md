# Native web-search production repair plan

## Context

ADR 0043 introduced the `native-web-search` model capability, route policy,
request shaping, and citation surfaces. The implementation was marked complete,
but the production SDK/RPC provider-registration paths did not install the
`streamSimple` wrapper used by the request shaper. The unit tests supplied a
fake base stream directly and therefore did not cover the missing production
composition. The manual Add Model dialog also omitted the capability.

## Scope

1. Expose the `native-web-search` capability while manually adding a model,
   using the same capability field as the existing model editor.
2. Resolve Pi's built-in lazy `streamSimple` implementation for every supported
   product protocol inside `@piwin/agent-host`, then wrap it in both SDK and RPC
   provider registrations without importing Pi from another package.
3. Keep Host `web_search` function tools intact when stripping provider-native
   search fields, and emit protocol-correct request shapes.
4. Derive request support from the selected provider protocol. Report native
   citation support as unavailable until Pi preserves provider grounding
   metadata in its normalized assistant events.
5. Add regression tests for production registration without an injected test
   stream, manual model creation, payload shaping, and capability honesty.

## Non-goals

- Automatically tagging discovered models based only on model names.
- Modifying the user's `~/.piwin/config.json`; the user remains the authority on
  which gateway/model combinations support provider-native search.
- Forking Pi provider implementations to recover citation metadata that Pi
  currently discards.

## Exit criteria

- A newly added model can persist `capabilities: ['native-web-search']` in one
  step, and native request shaping follows the resolved search policy.
- Production SDK and RPC registrations contain a wrapped `streamSimple` when a
  tagged model or resolved search route requires it.
- Native search request shaping is applied to the real Pi provider stream.
- External Host `web_search` schemas are not removed by native-field cleanup.
- Settings does not claim citation normalization support that the active Pi
  event surface cannot provide.
- Relevant Desktop, Host Runtime, Agent Host, typecheck, and architecture tests
  pass.
