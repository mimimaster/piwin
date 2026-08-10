# ADR 0043: Native model search routing and video capability discovery

## Status

Accepted — implemented (2026-08-10)

## Context

piwin currently exposes one Host-owned `web_search` tool. It can aggregate
multiple configured external sources, but some chat models can also perform
provider-native web search and return grounded content directly. Advertising
both mechanisms to one agent creates duplicate searches, inconsistent
citations, unclear permissions, and unnecessary cost.

Video generation already has a `video-generation` model capability and a
provider-neutral settings/runtime flow (ADR 0034). Its remaining usability gap
is discovery: users should not have to re-enter a model that the provider has
already returned, but name-only inference can confuse video understanding with
video generation.

## Decision

### 1. Distinguish model-native search from the external tool family

Add `native-web-search` to `ModelCapability`. The UI label is **内置搜索**,
not the ambiguous **搜索**. The existing `web-search` session tool family and
its public `web_search` tool continue to mean piwin's external search service.

A capability tag is a declaration, not executable routing. Native search is
ready only when all of the following are true:

- the selected chat model is enabled and tagged `native-web-search`;
- the active Pi SDK/RPC adapter can express native search for that provider;
- the provider-native feature is controllable for the request.

If an adapter cannot support the provider's native mechanism, the Host reports
the capability as unavailable instead of pretending the label enabled it.

### 2. Resolve exactly one search backend for each generation

Add a search-route policy distinct from the existing external multi-source
`searchStrategy`:

```ts
type SearchRoutePolicy =
  | 'native-first'
  | 'external-first'
  | 'native-only'
  | 'external-only';
```

`external-first` is the migration default because it preserves current
behavior, permission handling, and citation rendering. Host Runtime resolves
the route from the selected model, adapter support, configured external search
sources, and policy:

| Policy | First choice | Fallback |
|---|---|---|
| `native-first` | model-native search | external `web_search` |
| `external-first` | external `web_search` | model-native search |
| `native-only` | model-native search | none |
| `external-only` | external `web_search` | none |

Fallback means capability availability before the request starts; piwin does
not silently resend a completed or failed prompt through the other backend.

The resolved generation exposes one logical outlet:

- Native selected: omit the external Host `web_search` tool and enable only the
  provider-native mechanism in `agent-host`.
- External selected: disable controllable provider-native search and register
  only the Host `web_search` tool.
- Neither ready: expose neither and report the configuration issue.

Models whose search is always on and cannot be disabled must be represented as
such in model metadata. `external-only` is invalid for those models; Settings
must warn instead of claiming exclusivity.

### 3. Keep the decision at product and adapter boundaries

- `@piwin/contracts` owns the capability, policy, readiness, and resolved-route
  types.
- `@piwin/host-runtime` resolves the route while compiling the generation's
  capability snapshot.
- `@piwin/agent-host` applies provider-native search in both `PiSdkAdapter` and
  `PiRpcAdapter`; no application package imports Pi.
- Provider citation/grounding metadata is normalized into product events with
  `native` or `external` provenance. Desktop never parses provider-native
  payloads.

The agent may receive a short capability brief describing the selected route,
but prompt text is not the authority. The compiled route and registered tools
are authoritative.

### 4. Treat video discovery as enrichment with manual override

Keep the existing `video-generation` tag and make the Video settings dropdown
consume enabled models carrying that capability. Enrich discovered models in
this order:

1. exact provider discovery metadata, when available;
2. an exact, versioned registry keyed by provider/protocol and model id;
3. a model-name heuristic shown as a suggestion only;
4. explicit user override, which always wins.

A substring such as `video` must not silently enable video generation because
it may describe a vision/video-understanding chat model. The curated registry
may include aliases, API style, and default route metadata, allowing the Video
page to prefill the correct adapter settings and offer the model directly in
its default-model dropdown.

## Settings experience

- Model editor capability badges: Chat, Vision input, Image generation, Video
  generation, Speech, and Native search as applicable.
- The Native search control explains that it is provider-backed and mutually
  exclusive with external `web_search` for one generation.
- Web Settings adds **搜索路由** with the four policy choices and a live preview
  for the current default chat model: selected backend, fallback, and any
  incompatibility.
- Video Settings lists automatically recognized models first, suggested models
  second, and still allows manual model configuration.

## Consequences

- The agent never has to choose between two competing search tools.
- Existing external search behavior remains backward compatible.
- A model badge alone cannot make native search work; adapter support and
  request shaping are mandatory.
- Native and external search can have different permission and citation
  semantics, so the selected backend must be visible in activity/evidence UI.
- Video setup becomes mostly selection instead of duplicate entry while
  preserving a safe manual override for new vendors.

## Feasibility against the current Pi boundary

The workspace currently uses Pi 0.80.10. Pi does not expose a ready-made
provider-native web-search capability, but its provider registration accepts a
custom `streamSimple` implementation and its stream options expose an
`onPayload` request transform. `agent-host` can therefore wrap the selected
provider stream, inject provider-native search request fields, and preserve the
normal Pi session loop without forking Pi.

Both current backends construct provider registrations inside `agent-host`, so
the same wrapper can be applied by the SDK and RPC paths. Request enablement is
therefore executable with the existing dependency boundary. Normalized native
citation metadata still requires provider-specific response parsing or an
upstream Pi event extension; lack of citation normalization must not be
reported as full native-search readiness.

## Implementation slices

1. Contracts and config normalization, including migration default.
2. Pure search-route resolver with all readiness/policy combinations tested.
3. SDK/RPC adapter support and normalized native citation fixtures.
4. Model capability editor plus Web policy/status UI.
5. Curated video registry, discovery enrichment, and Video dropdown wiring.

## Implementation status

| Component | Files | Status |
|---|---|---|
| Contracts (policy, readiness, resolved route, preview, event, transcript) | `packages/contracts/src/web.ts`, `packages/contracts/src/config.ts`, `packages/contracts/src/host.ts`, `packages/contracts/src/session-transcript.ts` | Implemented |
| Search-route resolver and Host preview | `packages/host-runtime/src/capabilities/search-route-resolver.ts`, `packages/host-runtime/src/capabilities/search-route-preview.ts` | Implemented |
| Host tool composition and capability snapshot | `packages/host-runtime/src/blueprint-compiler.ts`, `packages/host-runtime/src/capabilities/session-capability-resolver.ts` | Implemented |
| SDK/RPC provider registration wrappers | `packages/agent-host/src/pi-model-runtime.ts`, `packages/agent-host/src/rpc/worker-pi-session-factory.ts` | Implemented |
| Native web-search request shaping + citation normalization | `packages/agent-host/src/native-web-search.ts` | Implemented |
| Native search evidence events | `packages/agent-host/src/event-map.ts`, `packages/contracts/src/host.ts`, `packages/session/src/transcript-store.ts`, `packages/host-runtime/src/store-transcript-recorder.ts` | Implemented |
| Desktop native citation rendering | `apps/desktop/src/CitationCards.tsx`, `apps/desktop/src/chat-reducer.ts`, `apps/desktop/src/chat-thread.tsx` | Implemented |
| Web Settings policy and live status | `apps/desktop/src/settings/pages/web-page.tsx`, `apps/desktop/src/settings/search-route-status.tsx`, `apps/desktop/src/settings/web-draft.ts` | Implemented |
| Model editor native-search badge | `apps/desktop/src/model-edit-inline.tsx`, `apps/desktop/src/ModelWorkbench.tsx`, `apps/desktop/src/provider-row.tsx` | Implemented |
| Video model discovery and settings | `packages/contracts/src/model-catalog.ts`, `packages/host-runtime/src/provider-model-discovery.ts`, `packages/host-runtime/src/provider-model-capabilities.ts`, `apps/desktop/src/video-model-suggest.tsx`, `apps/desktop/src/video-model-discovery.ts`, `apps/desktop/src/VideoGenerationSettings.tsx` | Implemented |

Video runtime execution remains governed by [ADR 0034](0034-video-generation.md). ADR 0043 adds discovery, enrichment, and settings UI only; the `video-generation` capability, `routes['video-generation']`, and the existing `video_gen` adapter surface are unchanged.

Heuristic video-generation suggestions (reason `heuristic`) are transient and are not persisted until the user explicitly selects the model and submits the form. This preserves the distinction between a provider/registry-recognized video model and a name-only match that could otherwise misidentify a video-understanding model as a video generator.
