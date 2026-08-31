# ADR 0043: Native model search routing and video capability discovery

## Status

Accepted — production request path repaired (2026-08-11)

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

Add `native-web-search` to `ModelCapability`. The UI label is **模型内置搜索**,
not the ambiguous **搜索**. The existing `web-search` session tool family and
its public `web_search` tool continue to mean piwin's external search service.

A capability tag is a declaration, not executable routing. Native search is
ready only when all of the following are true:

- the selected chat model is enabled and tagged `native-web-search`;
- the active Pi SDK/RPC adapter can express native search for that provider.

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

Packing default is `native-first` with no external sources enabled: a fresh
install uses the model's built-in network search when the model supports it.
A saved config that already has enabled external sources but omitted
`searchRoutePolicy` keeps `external-first` so user setup is not rewritten.
Host Runtime resolves the route from the selected model, adapter support,
configured external search sources, and policy:

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
- External selected: omit provider-native search fields and register only the
  Host `web_search` tool.
- Neither ready: expose neither and report the configuration issue.

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
- Manual model creation exposes the same Native search capability as the
  existing-model editor; users do not need an add-then-edit workaround.
- The Native search capability control explains that it is provider-backed;
  `searchRoutePolicy` remains the only switch and selects one outlet per
  generation.
- Web Settings adds **搜索路由** with the four policy choices and a live preview
  for the current default chat model: selected backend, fallback, and any
  readiness issues.
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
the same wrapper is applied by the SDK and RPC paths. The wrapper must receive
Pi's real protocol `streamSimple`; a test-only injected stream is not sufficient
evidence that production registration is wired. `agent-host` resolves Pi's lazy
OpenAI Completions, Anthropic Messages, and Google Generative AI streams and
wraps those exact implementations.

Normalized native citation metadata still requires provider-specific response
parsing or an upstream Pi event extension. Pi 0.80.10 does not retain OpenAI
annotations, Anthropic web-search result/citation blocks, or Google grounding
metadata in its normalized assistant-message event shape. The product therefore
reports `citationSupported: false` while request shaping remains available; the
existing normalizer/persistence/UI path is ready for metadata once the adapter
can actually receive it.

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
| Native web-search request shaping | `packages/agent-host/src/native-web-search.ts`, `packages/agent-host/src/pi-native-search-stream.ts` | Implemented; production SDK/RPC stream composition repaired 2026-08-11 |
| Native citation normalization | `packages/agent-host/src/native-web-search.ts` | Parser implemented; upstream Pi response metadata unavailable, reported honestly as unsupported |
| Native search evidence events | `packages/agent-host/src/event-map.ts`, `packages/contracts/src/host.ts`, `packages/session/src/transcript-store.ts`, `packages/host-runtime/src/store-transcript-recorder.ts` | Implemented; awaits adapter-visible provider metadata |
| Host `web_search` model delegation | `packages/agent-host/src/native-model-web-search.ts`, `packages/tools-web/src/model-search-delegate.ts`, `packages/host-runtime/src/model-web-search-delegate.ts` | Implemented 2026-08-11 |
| Desktop native citation rendering | `apps/desktop/src/CitationCards.tsx`, `apps/desktop/src/chat-reducer.ts`, `apps/desktop/src/chat-thread.tsx` | Implemented |
| Web Settings policy and live status | `apps/desktop/src/settings/pages/web-page.tsx`, `apps/desktop/src/settings/search-route-status.tsx`, `apps/desktop/src/settings/web-draft.ts` | Implemented |
| Model editor/add native-search badge | `apps/desktop/src/AddModelDialog.tsx`, `apps/desktop/src/model-edit-inline.tsx`, `apps/desktop/src/ModelWorkbench.tsx`, `apps/desktop/src/provider-row.tsx` | Implemented |
| Video model discovery and settings | `packages/contracts/src/model-catalog.ts`, `packages/host-runtime/src/provider-model-discovery.ts`, `packages/host-runtime/src/provider-model-capabilities.ts`, `apps/desktop/src/video-model-suggest.tsx`, `apps/desktop/src/video-model-discovery.ts`, `apps/desktop/src/VideoGenerationSettings.tsx` | Implemented |

Video runtime execution remains governed by [ADR 0034](0034-video-generation.md). ADR 0043 adds discovery, enrichment, and settings UI only; the `video-generation` capability, `routes['video-generation']`, and the existing `video_gen` adapter surface are unchanged.

Heuristic video-generation suggestions (reason `heuristic`) are transient and are not persisted until the user explicitly selects the model and submits the form. This preserves the distinction between a provider/registry-recognized video model and a name-only match that could otherwise misidentify a video-understanding model as a video generator.

## 2026-08-11 production-wiring repair

The initial implementation's request-shaping unit tests injected a fake base
`streamSimple`. Production registration passed no stream, causing the wrapper to
return `undefined`; Host routing could hide external `web_search` without
actually enabling provider-native search. The repair:

- resolves Pi's real lazy protocol stream inside `@piwin/agent-host` for both
  SDK and RPC registrations;
- adds regression coverage for the production call shape without a test stream;
- preserves Host function tools named `web_search` when removing provider-native
  tool entries;
- uses `web_search_options` for OpenAI Chat Completions and
  `config.tools[].googleSearch` for the `@google/genai` request object;
- derives request support from the selected provider protocol and does not claim
  citation support Pi cannot currently deliver; and
- makes Side Chat and regular sessions follow the selected search policy
  without a model-level override.

## 2026-08-11 Host `web_search` model delegation

Web Settings may store an optional `WebConfig.searchDelegateModel` referring to
one enabled configured model tagged `native-web-search`. This is distinct from
the active chat model's native route: the active model still calls the
Host-owned `web_search` tool, and Host delegates that tool call to the selected
search model through provider-native request shaping.

The delegated model is the exclusive external backend while configured. Saved
DuckDuckGo, Brave, Tavily, and CLI sources remain intact but are not invoked.
If the reference becomes stale, disabled, untagged, or unsupported, route
resolution fails closed instead of silently spending against another source.
The selector therefore lists only enabled, adapter-supported configured models
carrying the capability tag and surfaces invalid saved references explicitly.

Dependency ownership remains one-way:

- `@piwin/contracts` owns the optional `ModelRef` and readiness shape;
- `@piwin/tools-web` owns the narrow delegate port and strict `SearchHit[]`
  response parser;
- `@piwin/host-runtime` validates the configured reference, resolves the
  Host-owned provider secret lazily, and composes the tool backend; and
- `@piwin/agent-host` alone imports Pi and performs the provider-native model
  completion.

The implementation does not infer the capability from model names or persist
provider credentials in Web config. A live smoke test used the configured
`custom-openai/gemini-3.6-flash-high` endpoint with an in-memory capability tag
and returned parseable official-source hits without mutating user config.

## 2026-08-13 request-shaping adapter declaration (`nativeSearchAdapter`)

The transport protocol alone is not evidence that a gateway accepts the
protocol's canonical native-search fields: an openai-compatible vendor gateway
may require a proprietary header/extra_body/tool shape. Models may therefore
declare HOW native search must be expressed, separately from the
`native-web-search` capability tag (which only declares that the model CAN):

```ts
// ModelConfigEntry.nativeSearchAdapter?: NativeSearchAdapterKind
type NativeSearchAdapterKind =
  | 'openai-web-search-options'   // chat/completions web_search_options field
  | 'openai-responses-tool'       // Responses API web_search_preview tool
  | 'anthropic-web-search-tool'   // Anthropic web_search_20250305 tool entry
  | 'google-search-tool'          // Gemini googleSearch tool in config.tools
  | 'vendor-specific';            // shape the generic adapter cannot express
```

Resolution rules (`resolveNativeSearchAdapterSupport`):

- **Omitted** (legacy configs): fall back to the protocol's canonical shaping —
  `openai-compatible`, `anthropic-compatible`, and `google-gemini` report
  request support; unknown protocols do not.
- **Declared**: the kind must be expressible for the model's provider protocol
  (`openai-*` kinds only on `openai-compatible`, etc.). A mismatch fails
  closed.
- **`vendor-specific`**: never expressible by the generic adapter; native
  readiness reports unsupported until a dedicated adapter exists. Under
  `native-first` the route falls back to external `web_search`; under
  `native-only` the generation exposes neither outlet and reports the issue.
- `citationSupported` stays `false` independently of the declaration (Pi
  0.80.10 does not deliver provider grounding metadata).

The declaration is enforced everywhere native readiness is computed: main
session and side-chat blueprint compilation, lazy session host-tool builds, and
`findReadyWebSearchDelegate` for the Host `web_search` delegation backend (a
delegate whose declared shape is not expressible is not "ready" and fails
closed). The main-session blueprint path initially resolved by protocol only
and was repaired on 2026-08-13 with regression coverage.

Known limitations (recorded intentionally):

- `nativeSearchAdapter` is config.json-only; the Desktop model editor and CLI
  expose no entry yet. This is an intentional, temporary degradation.
- A value outside the enum fails closed silently (treated as inexpressible);
  no settings diagnostic surfaces the typo yet.
- The Web Settings delegate dropdown lists models by capability tag and
  protocol without filtering on declared-adapter expressibility; runtime
  readiness still fails closed for such a selection.
