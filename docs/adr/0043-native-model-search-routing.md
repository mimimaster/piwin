# ADR 0043: Native model search routing and video capability discovery

## Status

Accepted — rewritten 2026-09-29 to describe the shipped design only: Host
`web_search` is the single search outlet and runs one ordered chain
(native sub-request → configured sources → DuckDuckGo floor). The superseded
main-session injection design is summarized under [History](#history).

## Context

Some chat models can run provider-native web search and return grounded
content. piwin also owns a Host `web_search` tool backed by configured sources
(Brave, Tavily, SearXNG, CLI/HTTP, Devin) and a free DuckDuckGo floor.

Offering both mechanisms side by side in one request produces duplicate
searches, inconsistent citations, tool-name collisions (Anthropic hosted vs
client `web_search`; Gemini "function + googleSearch" 400s) and grounding the
product cannot observe: official Pi (0.84.2, 0.87.1) exposes no raw provider
event/chunk callback, so main-session grounding metadata never reaches Host.

Video generation already has a provider-neutral runtime (ADR 0034); its gap is
discovery of models the provider already returned.

## Decision

### 1. One outlet, one chain

The chat model only ever sees Host `web_search`. Main-session provider
registrations are never wrapped for hosted search and never carry hosted
search fields; nothing in the main session is parsed as search evidence.

One `web_search` call tries an ordered chain and stops at the first success:

| Policy (`searchRoutePolicy`) | Chain |
|---|---|
| `native-first` (packing default) | native → sources → DuckDuckGo |
| `external-first` | sources → native → DuckDuckGo |
| `native-only` | native |
| `external-only` | sources → DuckDuckGo |

- A step that is not available is skipped: no enabled source → no `sources`
  step; no native executor → no `native` step. An untagged model is not an
  error, it simply has no native step.
- DuckDuckGo is a chain step, not a settings switch. It is omitted under
  `native-only`, and not repeated when the user enabled it as a source or when
  the `sources` step already fell back to it in the same call.
- A saved config with enabled sources and no explicit policy keeps
  `external-first`, so existing setups are not rewritten.
- There is no model switch and no whole-prompt replay. Fallback only happens
  inside the same tool call, and every step is visible in `attempts[]`.

`buildSearchChain` in `@piwin/contracts` is the only implementation of this
rule. `ResolvedSearchRoute.chain` is its only product representation: Settings
display it, the Host tool executes it, the search log records one attempt per
step. The same inputs produce the same chain in the Host route preview, the
blueprint, the session tool build and the tools-web executor.

### 2. What "native" means

`native` is a provider-native **sub-request** executed behind Host
`web_search`, not a field on the chat request.

Executor choice: a configured `WebConfig.searchDelegateModel` first (exclusive:
if it is stale the native step is absent, never silently the chat model);
otherwise the current chat model.

A model qualifies only when all of these hold:

- it is enabled and tagged `native-web-search` (UI: **模型内置搜索**);
- its adapter is expressible: a declared `nativeSearchAdapter` must be
  compatible with the provider protocol and, when the base URL identifies an
  official vendor host (including `oauth://xai`) or, on an unidentified
  gateway, an unambiguous model-id family (`gemini-*`, `grok-*`, `claude-*`,
  `gpt-*`/`o<n>`), with that vendor (xAI only takes `xai-web-search-tool`,
  OpenAI only its two shapes, Gemini only `google-search-tool`); unknown or
  incompatible fails closed. A known vendor whose search the model's protocol
  cannot express infers nothing and reports the protocol it needs; the editor
  offers a one-step switch (ADR 0079). Only an unidentifiable model on an
  unidentified gateway keeps every protocol-compatible shape. An omitted adapter is inferred from protocol /
  official vendor host / model id. The model editor offers the same set;
- all of the above use the model's effective wire (ADR 0079 per-model
  protocol): a Gemini-protocol model on an OpenAI gateway row runs
  `google-search-tool` against the rebased `/v1beta` URL;
- the provider is Host-reachable: a subscription (`source: 'subscription'`)
  qualifies only if it has an HTTPS chat surface
  (`subscription-chat-surface.ts`; today Grok → `api.x.ai`). The
  `oauth://<id>` origin is a Pi-only marker the executor cannot POST to.

Adapters (`NativeSearchAdapterKind`):

| Adapter | Request shape |
|---|---|
| `openai-responses-tool` | Responses `tools: [{type:'web_search'}]`, optional `include: ['web_search_call.action.sources']` |
| `openai-web-search-options` | Chat Completions `web_search_options` (search-preview models) |
| `xai-web-search-tool` | Responses `web_search` tool; `x_search` never implied |
| `anthropic-web-search-tool` | `web_search_20250305` / `_20260209` / `_20260318`; newer versions default `allowed_callers: ['direct']`; optional beta token merged case-insensitively |
| `google-search-tool` | `@google/genai` `config.tools[].googleSearch` |

The adapter selects the sub-request shape and is independent of the provider's
everyday `chatApi` (a Completions channel can still run the Responses tool).
The executor stamps the resolved adapter onto the request, so an inferred
adapter shapes the request exactly like a declared one.

Transport:

- `pi-tee`: official Pi `streamSimple` for the provider, wrapped only for this
  sub-request, with a `fetch` response-body tee to read provider evidence.
- `gemini-rest`: direct non-streaming `generateContent` for Gemini API keys
  (Pi's Google adapter rejects a custom fetch). Vertex / OAuth fail closed.
- Subscriptions: the provider is rewritten to its HTTPS surface with the
  `auth.json` OAuth access token as bearer plus provider shaping headers
  (Grok: `X-XAI-Token-Auth: xai-grok-cli`). The auth path follows the Host
  root, so a remote Host reads its own `auth.json`.

A native step counts as success only when it returns hits or a grounded
answer. An empty result (for example a WebSocket transport that exposes no
body) is a failed step and the chain continues; hits are never guessed from
model prose.

### 3. Tagging

Owner decision 2026-09-29: search-capable models are tagged by default.

- A newly pulled (provider discovery) or newly added (Add Model) chat model is
  tagged, with the inferred adapter, when its vendor exposes hosted search and
  its effective request protocol can express it. The vendor comes from an
  official host or, on a self-hosted gateway such as CLIProxyAPI, from the
  model-id family (`gemini-*`, `grok-*`, `claude-*`, `gpt-*`/`o<n>`), subject
  to each vendor's version floor.
- Not tagged: pass-through aggregators (OpenRouter), subscription origins Host
  cannot reach, a protocol that cannot express the vendor's search (Gemini on
  an OpenAI row — switching the model to the Gemini protocol, ADR 0079, makes
  it eligible), embeddings/media and unknown families.
- Subscription catalog sync applies the same rule to newly seen models of a
  subscription with a Host-reachable surface (Grok).
- Existing entries are never retagged: config cannot tell "never set" from "the
  user turned it off", so the user's choice wins. In Add Model, ticking or
  unticking the box by hand stops the default from following later edits.
- A tag is a declaration; readiness still requires §2.

### 4. Results, citations and logs

- `WebSearchResult` may carry `answer`, `searchQueries`, `citations`,
  `searchSuggestionsHtml` and `nativeDiagnostic`. Only the model-visible part
  reaches the model; suggestions and diagnostics ride in
  `ToolResult.details.native`.
- `NativeSearchDiagnostic` is bounded to provider id, adapter, transport, event
  detection, hit count, duration and a bounded error. Never query, prompt,
  headers, bodies or credentials.
- Gemini Search Suggestions render unmodified in a script-free sandboxed
  iframe; the parent intercepts clicks and opens only Google `/search` URLs in
  the system browser (Google grounding terms).
- When the whole chain fails, the error lists every step's reason
  (`native:xai/grok-4.7: …; duckduckgo: …`), not just the last one.
- `~/.piwin/logs/web-search.jsonl` records successes and failures with
  attempts, timing and a native summary. Suggestions HTML and issued query
  texts stay out of the log.
- Message-level `SearchEvidence` is read-only legacy: assistant messages from
  the retired main-session design (v0.1.0) still carry it and still render.
  Nothing produces it anymore.

### 5. Settings

- Model editor and Add Model expose **模型内置搜索** plus the request
  adapter; adapter-specific options appear only when relevant.
- Web Settings shows **搜索优先级** (the four policies), an optional search
  delegate model (only enabled, ready, tagged models), and a live preview of
  the chain for the current default chat model with readiness issues.
- The `web-search` immediate restriction clamps the live generation when a
  configured delegate goes stale (the live executor is still bound to it) or
  under `native-only` without a ready delegate.
- Cost: a native step costs one extra model call; a cheaper tagged delegate
  avoids paying the chat model twice.

### 6. Video discovery

Keep the `video-generation` capability and make the Video settings dropdown
consume enabled models carrying it. Enrich discovered models in this order:

1. exact provider discovery metadata, when available;
2. an exact, versioned registry keyed by provider/protocol and model id;
3. a model-name heuristic shown as a suggestion only;
4. explicit user override, which always wins.

A substring such as `video` must not silently enable video generation (it may
describe a video-understanding chat model). Heuristic suggestions are not
persisted until the user selects the model. Runtime execution stays governed by
[ADR 0034](0034-video-generation.md).

## Ownership

- `@piwin/contracts`: capability, policy, `buildSearchChain`,
  `ResolvedSearchRoute`, adapter compatibility/inference, result and
  diagnostic types.
- `@piwin/host-runtime`: route resolution (`resolveGenerationSearchRoute`, the
  single entry for blueprint, side chat, session tools and Settings preview),
  executor selection, subscription surface and credentials.
- `@piwin/tools-web`: runs the chain inside `web_search`; the native executor
  is a narrow port (`WebSearchModelDelegate`).
- `@piwin/agent-host`: the only Pi importer; `completeNativeModelWebSearch`
  is the only caller that wraps a registration for hosted search.
- Desktop renders the tool card, citations, suggestions and route preview; it
  never parses provider-native payloads.

## Consequences

- One rule decides the chain, so the Settings preview, the executed tool and
  the log agree by construction.
- Native search costs a second model call; sources and the DuckDuckGo floor
  keep `web_search` available when native is absent or fails.
- Subscriptions without a Host-reachable surface cannot be native executors
  even when tagged.
- Legacy message-level citations remain readable; new citations live on the
  tool card only.

## History

- 2026-08-11: first implementation injected hosted search into the
  main-session chat request per resolved route and parsed grounding from Pi
  events. Production wiring was repaired to use Pi's real protocol streams,
  and `searchDelegateModel` was added to back Host `web_search`.
- 2026-08-13: `nativeSearchAdapter` declared the request shape separately
  from the capability tag.
- 2026-09-28: DuckDuckGo became a floor for generations without native search;
  four-provider request shapes and header merging were fixed.
- 2026-09-29: main-session injection was retired because Pi exposes no raw
  provider events, so grounding was unobservable and tool names collided.
  Native search moved behind Host `web_search` as a sub-request. The
  main-session wrapper, route plumbing into Pi registrations, main-session
  citation guessing and the live `message/search_evidence` event were
  removed; the chain became the only route representation (`selected` /
  `fallback` summaries removed); subscription reachability and pull-time
  tagging for Grok subscriptions were added.
